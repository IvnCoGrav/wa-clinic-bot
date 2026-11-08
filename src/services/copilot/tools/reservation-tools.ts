import { prisma } from '../../../db/client';
import { formatWibDateYYYYMMDD, formatWibTime, WIB_OFFSET_MS } from '../../../utils/wib-time';
import { isReservationPaid, getPaymentDisplayStatus } from '../../../domain/reservation-payment';
import { getOperationalHours } from '../../../config/operational-hours';
import {
  CopilotTool,
  MAX_ROWS,
  MAX_FETCH_ROWS,
  ACTIVE_RESERVATION_STATUSES,
  RESERVATION_STATUS_VALUES,
  resolveReservationDateFilter,
  formatCustomerDisplayName,
} from './types';

/** Tool 1: jadwal reservasi berdasarkan filter (tanggal/status/terapis/status pembayaran). */
export const queryReservationsByFilter: CopilotTool = {
  name: 'query_reservations_by_filter',
  description:
    'Mengambil daftar reservasi berdasarkan filter tanggal (YYYY-MM-DD, WIB), status operasional, nama terapis, ' +
    'atau status pembayaran ("unpaid" / "paid"). ' +
    'Termasuk status bayar per reservasi (LUNAS, TAGIH_DI_TEMPAT, SELESAI_BELUM_VERIFIKASI), nominal belum tertagih, ' +
    'jam selesai treatment, deteksi tabrakan waktu (scheduleCollisions), dan celah slot kosong (freeSlots). ' +
    'Gunakan untuk: "jadwal besok", "siapa belum bayar", "tagihan menggantung", "slot kosong terapis X", "apakah ada bentrok".',
  parameters: {
    date: { type: 'string', description: 'Tanggal format YYYY-MM-DD (WIB). Kosong = jadwal aktif mendatang.' },
    status: { type: 'string', description: `${RESERVATION_STATUS_VALUES.join(' | ')}. Kosong = jadwal aktif (confirmed/en_route/pending/hold). Gunakan "all" untuk semua status.` },
    staffName: { type: 'string', description: 'Nama terapis (sebagian). Kosong = semua.' },
    paymentStatus: { type: 'string', description: 'Filter status bayar: "unpaid" (belum bayar / tagihan menggantung) | "paid" (lunas) | "all".' },
  },
  run: async (tenantId, args) => {
    // 1. Ambil jam operasional klinis data-driven dari settings tenant / ClinicPolicy (bukan hardcode)
    const opHours = await getOperationalHours(tenantId);
    const clinicStartHour = opHours.startHourWib; // default 8
    const clinicEndHour = opHours.endHourWib;     // default 17 atau override DB

    // 2. Ambil batas durasi jeda/slot minimum dari Tenant.settings (default 45 menit)
    let minSlotMinutes = 45;
    try {
      const tenant = await (prisma as any).tenant?.findUnique?.({
        where: { id: tenantId },
        select: { settings: true },
      });
      const customMin = Number(
        (tenant?.settings as any)?.copilot?.minSlotDurationMinutes ??
        (tenant?.settings as any)?.minSlotDurationMinutes
      );
      if (Number.isInteger(customMin) && customMin > 0) {
        minSlotMinutes = customMin;
      }
    } catch {}

    const where: any = { tenant_id: tenantId };
    // Default (tanpa tanggal valid) = jadwal aktif mendatang, bukan 20 baris tertua.
    where.booking_date = resolveReservationDateFilter(args.date);
    const pStatus = args.paymentStatus ? String(args.paymentStatus).toLowerCase() : undefined;
    if (args.status && args.status !== 'all') {
      where.status = String(args.status);
    } else if (pStatus === 'unpaid' || pStatus === 'paid' || args.status === 'all') {
      where.status = { in: [...ACTIVE_RESERVATION_STATUSES, 'completed'] };
    } else {
      where.status = { in: ACTIVE_RESERVATION_STATUSES };
    }
    if (args.staffName) {
      where.assigned_staff = { name: { contains: String(args.staffName), mode: 'insensitive' } };
    }
    const rows = await prisma.reservation.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            // conversationId untuk deep-link Live Chat (1 query, tanpa N+1).
            conversations: {
              select: { id: true },
              orderBy: { last_message_at: 'desc' },
              take: 1,
            },
          },
        },
        assigned_staff: { select: { name: true } },
      },
      orderBy: { booking_date: 'asc' },
      take: MAX_FETCH_ROWS, // Data utuh untuk perhitungan slot/bentrok; tampilan tetap dipotong MAX_ROWS
    });

    let mappedRows = rows.map((r) => {
      const nameInfo = formatCustomerDisplayName(r.customer?.name, (r.customer as any)?.phone);
      const bDate = r.booking_date ? new Date(r.booking_date) : null;
      const durationMinutes = (r.duration_minutes && r.duration_minutes > 0) ? r.duration_minutes : 60;
      const endDate = bDate ? new Date(bDate.getTime() + durationMinutes * 60000) : null;
      const isPaid = isReservationPaid(r);
      const paymentStatus = getPaymentDisplayStatus(r);
      const treatmentFee = r.purchase_value || 0;
      const deliveryFee = r.delivery_fee || 0;
      const totalFee = treatmentFee + deliveryFee;
      const unpaidAmount = isPaid ? 0 : totalFee;

      return {
        id: r.id,
        customerId: r.customer?.id || null,
        customerName: nameInfo.displayName,
        rawCustomerName: nameInfo.rawName,
        conversationId: r.customer?.conversations?.[0]?.id || null,
        treatment: r.treatment_detail || r.treatment_category,
        bookingDateWib: bDate ? formatWibDateYYYYMMDD(bDate) : null,
        bookingTimeWib: bDate ? formatWibTime(bDate) : null,
        durationMinutes,
        bookingEndTimeWib: endDate ? formatWibTime(endDate) : null,
        status: r.status,
        staff: r.assigned_staff?.name || null,
        isPaid,
        paymentStatus,
        totalFee,
        unpaidAmount,
        _startTimeMs: bDate ? bDate.getTime() : null,
        _endTimeMs: endDate ? endDate.getTime() : null,
      };
    });

    if (pStatus === 'unpaid') {
      mappedRows = mappedRows.filter((r) => !r.isPaid);
    } else if (pStatus === 'paid') {
      mappedRows = mappedRows.filter((r) => r.isPaid);
    }

    // Ambiguitas NAMA terapis ditentukan dari RESOLUSI NAMA STAF, bukan dari
    // hasil reservasi kosong. Filter tanggal/status/bayar bisa menghasilkan 0 baris
    // pada nama yang sah — regresi: "siapa belum bayar untuk Bidan Yusi" saat semua
    // lunas HARAM berubah menjadi pertanyaan klarifikasi.
    let ambiguous = false;
    let candidates: string[] = [];
    if (args.staffName) {
      try {
        const staffList = await prisma.staff.findMany({
          where: { tenant_id: tenantId, active: true },
          select: { name: true },
        });
        const staffNames = staffList
          .map((s: any) => String(s.name || '').trim())
          .filter(Boolean);
        const cleanStaffName = (name: string) =>
          name.replace(/^(bidan|terapis|dr|dokter)\s+/i, '').trim().toLowerCase();
        const q = cleanStaffName(String(args.staffName));

        if (q.length === 0) {
          if (staffNames.length > 0) {
            ambiguous = true;
            candidates = staffNames;
          }
        } else {
          const exact = staffNames.filter((name: string) => cleanStaffName(name) === q);
          const partial = staffNames.filter((name: string) => cleanStaffName(name).includes(q));
          if (exact.length === 1 || (exact.length === 0 && partial.length === 1)) {
            // Nama terapis teridentifikasi tunggal → hasil kosong berarti memang tidak ada data.
            ambiguous = false;
          } else if (partial.length > 1) {
            ambiguous = true;
            candidates = partial;
          } else if (staffNames.length > 0) {
            ambiguous = true;
            candidates = staffNames;
          }
        }
      } catch {}
    }

    const fetchTruncated = rows.length >= MAX_FETCH_ROWS;

    // Deteksi tabrakan jadwal (collision) deterministik: irisan interval pada terapis yang SAMA
    const scheduleCollisions: Array<{
      staff: string;
      reservation1Id: string;
      reservation2Id: string;
      timeRange1: string;
      timeRange2: string;
      conflictMinutes: number;
    }> = [];
    const staffReservationsMap = new Map<string, any[]>();
    for (const r of mappedRows) {
      if (!r.staff || !r._startTimeMs || !r._endTimeMs) continue;
      if (['cancelled', 'rejected'].includes(String(r.status).toLowerCase())) continue;
      if (!staffReservationsMap.has(r.staff)) staffReservationsMap.set(r.staff, []);
      staffReservationsMap.get(r.staff)!.push(r);
    }
    for (const [staff, resList] of staffReservationsMap.entries()) {
      if (resList.length > 1) {
        for (let i = 0; i < resList.length; i++) {
          for (let j = i + 1; j < resList.length; j++) {
            const a = resList[i];
            const b = resList[j];
            if (a._startTimeMs < b._endTimeMs && b._startTimeMs < a._endTimeMs) {
              const conflictStart = Math.max(a._startTimeMs, b._startTimeMs);
              const conflictEnd = Math.min(a._endTimeMs, b._endTimeMs);
              const conflictMinutes = Math.round((conflictEnd - conflictStart) / 60000);
              scheduleCollisions.push({
                staff,
                reservation1Id: a.id,
                reservation2Id: b.id,
                timeRange1: `${a.bookingTimeWib}–${a.bookingEndTimeWib}`,
                timeRange2: `${b.bookingTimeWib}–${b.bookingEndTimeWib}`,
                conflictMinutes,
              });
            }
          }
        }
      }
    }

    // Deteksi celah / slot kosong (freeSlots) deterministik per terapis (jam kerja 08:00 - 18:00 WIB, jeda >= 45 min)
    const freeSlots: Array<{
      staff: string;
      dateWib: string;
      startTimeWib: string;
      endTimeWib: string;
      durationMinutes: number;
    }> = [];
    const staffDateMap = new Map<string, any[]>();
    for (const r of mappedRows) {
      if (!r.staff || !r.bookingDateWib || !r._startTimeMs || !r._endTimeMs) continue;
      if (['cancelled', 'rejected'].includes(String(r.status).toLowerCase())) continue;
      const key = `${r.staff}::${r.bookingDateWib}`;
      if (!staffDateMap.has(key)) staffDateMap.set(key, []);
      staffDateMap.get(key)!.push(r);
    }
    for (const [key, resList] of staffDateMap.entries()) {
      const [staff, dateWib] = key.split('::');
      const [y, m, d] = dateWib.split('-').map(Number);
      if (!y || !m || !d) continue;
      const clinicStartUtcMs = Date.UTC(y, m - 1, d, clinicStartHour, 0, 0, 0) - WIB_OFFSET_MS;
      const clinicEndUtcMs = Date.UTC(y, m - 1, d, clinicEndHour, 0, 0, 0) - WIB_OFFSET_MS;
      const sorted = [...resList].sort((a, b) => a._startTimeMs - b._startTimeMs);

      let cursorMs = clinicStartUtcMs;
      for (const res of sorted) {
        if (res._startTimeMs > cursorMs) {
          const gapMinutes = Math.round((res._startTimeMs - cursorMs) / 60000);
          if (gapMinutes >= minSlotMinutes) {
            freeSlots.push({
              staff,
              dateWib,
              startTimeWib: formatWibTime(new Date(cursorMs)),
              endTimeWib: formatWibTime(new Date(res._startTimeMs)),
              durationMinutes: gapMinutes,
            });
          }
        }
        cursorMs = Math.max(cursorMs, res._endTimeMs);
      }
      if (cursorMs < clinicEndUtcMs) {
        const remainingMinutes = Math.round((clinicEndUtcMs - cursorMs) / 60000);
        if (remainingMinutes >= minSlotMinutes) {
          freeSlots.push({
            staff,
            dateWib,
            startTimeWib: formatWibTime(new Date(cursorMs)),
            endTimeWib: formatWibTime(new Date(clinicEndUtcMs)),
            durationMinutes: remainingMinutes,
          });
        }
      }
    }

    const unpaidRows = mappedRows.filter((r) => !r.isPaid);
    const totalUnpaidAmount = unpaidRows.reduce((sum, r) => sum + r.unpaidAmount, 0);
    const unpaidCustomers = unpaidRows.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      treatment: r.treatment,
      bookingDateWib: r.bookingDateWib,
      bookingTimeWib: r.bookingTimeWib,
      staff: r.staff,
      unpaidAmount: r.unpaidAmount,
      paymentStatus: r.paymentStatus,
    }));

    const summaryFacts = {
      totalReservations: mappedRows.length,
      scheduleCollisions,
      hasCollision: scheduleCollisions.length > 0,
      freeSlots,
      operationalHours: { startHourWib: clinicStartHour, endHourWib: clinicEndHour },
      minSlotDurationMinutes: minSlotMinutes,
      totalUnpaidReservations: unpaidRows.length,
      totalUnpaidAmount,
      unpaidCustomers: unpaidCustomers.slice(0, 10),
      fetchTruncated,
    };

    const cleanRows = mappedRows.map(({ _startTimeMs, _endTimeMs, ...rest }) => rest);
    const displayRows = cleanRows.slice(0, MAX_ROWS);

    return {
      tool: 'query_reservations_by_filter',
      args,
      count: displayRows.length,
      totalCount: cleanRows.length,
      truncated: cleanRows.length > MAX_ROWS,
      fetchTruncated,
      ambiguous,
      candidates,
      summaryFacts,
      rows: displayRows,
    };
  },
};
