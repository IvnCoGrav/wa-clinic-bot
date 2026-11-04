import { prisma } from '../../db/client';
import { Direction } from '@prisma/client';
import { wibDayBoundsUtc, startOfTodayWib, formatWibDateYYYYMMDD, getWibDayName, formatWibTime, WIB_OFFSET_MS } from '../../utils/wib-time';
import { isDummyOrTestContact } from '../../utils/dummy-filter';
import { maskPhoneNumber } from '../../utils/pii-masker';
import { hasScheduleSignal, extractTimeHint, extractTimeOfDayHint, isScheduleCheckEngagement, isScheduleAvailabilityText } from '../../v3/agent/pipeline/medical-signal-detector';
import { hasBookingCommitSignal } from '../../utils/date-confirmation';

/**
 * copilot-tools.ts (Fase 6r + fixing plan) — Tools database Copilot Admin
 * (read-only, tenant-scoped).
 *
 * Kontrak fondasional:
 * - Grounding 100% pada hasil query DB. Tool mengembalikan array; LLM DILARANG mengarang.
 * - Window token: `take` dibatasi (default 20) agar tidak meledakkan context window.
 * - Definisi deterministik (state DB), BUKAN pencocokan kata kunci ("harga"/"penawaran").
 * - Semua query tenant-scoped (anti IDOR lintas-tenant).
 * - Default tanpa tanggal → hanya jadwal AKTIF MENDATANG (anti past-trap).
 */

export interface CopilotToolResult {
  tool: string;
  args: Record<string, any>;
  rows: any[];
  count: number;
  note?: string;
}

export interface CopilotTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  run: (tenantId: string, args: Record<string, any>) => Promise<CopilotToolResult>;
}

const MAX_ROWS = 20;
/**
 * Batas ambil data MENTAH untuk perhitungan deterministik (slot kosong, bentrok,
 * tagihan). Berbeda dari `MAX_ROWS` yang hanya membatasi baris yang dikirim ke LLM.
 */
const MAX_FETCH_ROWS = 200;

/** Status reservasi "jadwal aktif" — Single Source of Truth di domain/reservation-status. */
import { ACTIVE_RESERVATION_STATUSES } from '../../domain/reservation-status';
import { isReservationPaid, getPaymentDisplayStatus, type PaymentDisplayStatus } from '../../domain/reservation-payment';
import { getOperationalHours } from '../../config/operational-hours';
export { ACTIVE_RESERVATION_STATUSES };

/**
 * Seluruh status reservasi yang dikenali kontrak tool. Menu status DILARANG
 * menyempit: bila `rejected`/`en_route` absen dari deskripsi, router LLM tidak
 * pernah bisa memilihnya walau data & filter DB mampu (akar "siapa yang saya tolak"
 * selalu kosong). Ini kontrak domain, bukan katalog bisnis.
 */
export const RESERVATION_STATUS_VALUES = [
  'confirmed',
  'en_route',
  'pending',
  'hold',
  'completed',
  'cancelled',
  'rejected',
] as const;

/** Validasi string tanggal "YYYY-MM-DD" (bukan kalimat bebas dari LLM). */
export function isValidIsoDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;
  const d = new Date(`${value.trim()}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

/**
 * Resolusi filter `booking_date` untuk query reservasi (murni, mudah diuji).
 * - tanggal valid → rentang hari WIB tsb
 * - tanpa tanggal / tanggal tidak valid → hanya jadwal aktif mendatang (anti past-trap)
 */
export function resolveReservationDateFilter(
  date: unknown,
  now: Date = new Date()
): { gte: Date; lte?: Date } {
  if (isValidIsoDate(date)) {
    const { start, end } = wibDayBoundsUtc(0, new Date(`${String(date).trim()}T12:00:00Z`));
    return { gte: start, lte: end };
  }
  return { gte: startOfTodayWib(now) };
}

/**
 * Format nama display pelanggan dengan privasi & higienitas (anti-kebocoran username teknis).
 * - Bila nama kosong atau hanya honorifik ("Bunda"), sematkan nomor HP tersamar bila ada.
 * - Bila nama berupa username teknis (mengandung angka atau underscore, mis. "aguspurnomo68301"),
 *   ganti dengan "Bunda (<masked_phone>)".
 * - Nama manusia asli (mis. "Chaterina", "Cindy Amalia", "Bunda Megga") DIPERTAHANKAN apa adanya.
 * Mengembalikan displayName untuk LLM dan rawName untuk grounding link token.
 */
export function formatCustomerDisplayName(
  name: string | null | undefined,
  phone: string | null | undefined
): { displayName: string; rawName: string } {
  const raw = (name || '').trim();
  const phoneSuffix = phone ? maskPhoneNumber(phone) : '';
  const cleanHonorific = raw.replace(/\b(bunda|ibu|mbak|bu|kak|ny|tante)\b/gi, ' ').trim();

  // 1. Tanpa nama atau hanya honorifik saja (mis. "Bunda", "Ibu")
  if (!raw || !cleanHonorific) {
    const disp = phoneSuffix ? `Bunda (${phoneSuffix})` : (raw || 'Bunda');
    return { displayName: disp, rawName: raw || 'Bunda' };
  }

  // 2. Username teknis sistem / nomor akun (mengandung digit atau underscore, mis. "aguspurnomo68301", "cust_01")
  // Wajib ada digit ATAU underscore, dan tanpa spasi (nama manusia punya spasi atau hanya huruf)
  const isSystemUsername =
    !/\s/.test(raw) &&
    ((/^(?=.*\d)[a-z0-9_]{6,}$/i.test(raw)) || /^[a-z0-9_]*_[a-z0-9_]*$/i.test(raw));

  if (isSystemUsername) {
    const disp = phoneSuffix ? `Bunda (${phoneSuffix})` : raw;
    return { displayName: disp, rawName: raw };
  }

  // 3. Nama normal manusia (mis. "Chaterina", "Cindy Amalia", "Bunda Megga")
  return { displayName: raw, rawName: raw };
}

/**
 * Pola spam telekomunikasi & broadcast komersial operator.
 * Memadukan kata kunci operator/telekomunikasi dengan produk (kuota/roaming/pulsa/dll)
 * agar TIDAK salah mendeteksi istilah klinik (mis. "paket persalinan", "voucher USG").
 */
export function isTelecomSpamLine(line: string): boolean {
  const lower = (line || '').toLowerCase().trim();
  if (!lower) return false;

  // 1. Operator brand jelas
  const hasOperatorBrand = /\b(im3|indosat|telkomsel|xl\s*axiata|smartfren|tri\s*indonesia|myim3|mytelkomsel)\b/i.test(lower);
  // 2. Layanan telekomunikasi spesifik
  const hasTelecomService = /\b(simpelroam|roaming|kuota\s*(data|internet|hingga)|isi\s*pulsa|paket\s*(data|roaming|nelpon|unlimited)|cashback\s*pulsa|top\s*up\s*pulsa)\b/i.test(lower);

  if (hasOperatorBrand && hasTelecomService) return true;
  if (hasTelecomService && /\b(gb|gigabyte|mbps|roaming|simpelroam)\b/i.test(lower)) return true;
  if (/\b(simpelroam|myim3|mytelkomsel)\b/i.test(lower)) return true;

  return false;
}

/**
 * Bersihkan baris spam komersial dari teks pesan.
 * Jika seluruh teks adalah spam, kembalikan string kosong.
 */
export function stripCommercialSpam(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const lines = text.split('\n');
  const validLines = lines.filter((l) => !isTelecomSpamLine(l));
  return validLines.join('\n').trim();
}

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

/** Tool 2: chat yang belum dibalas (state: pesan nyata terakhir INBOUND). */
export const queryUnrepliedChats: CopilotTool = {
  name: 'query_unreplied_chats',
  description:
    'Mengambil daftar percakapan yang pesan terakhirnya dari customer (belum dibalas admin). ' +
    'Gunakan untuk "chat menggantung", "siapa yang belum dibalas".',
  parameters: {
    limit: { type: 'number', description: `Maksimum baris (default ${MAX_ROWS}).` },
  },
  run: async (tenantId, args) => {
    const take = Math.min(Math.max(parseInt(String(args.limit || MAX_ROWS), 10) || MAX_ROWS, 1), MAX_ROWS);
    // Anti-N+1: satu query dengan relasi messages terbatas (take 1) — bukan loop findFirst.
    const convs = await prisma.conversation.findMany({
      where: { tenant_id: tenantId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        messages: {
          where: { sender_type: { not: 'INTERNAL_NOTE' } },
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { direction: true, content: true, created_at: true },
        },
      },
      orderBy: { last_message_at: 'desc' },
      take: 50,
    });
    const rows: any[] = [];
    for (const c of convs) {
      if (rows.length >= take) break;
      const cust: any = c.customer;
      if (cust && cust.phone && isDummyOrTestContact(cust.phone, cust.name, false)) continue;
      const lastReal = (c as any).messages?.[0];
      if (lastReal && (lastReal.direction as any) === Direction.INBOUND) {
        const nameInfo = formatCustomerDisplayName(cust?.name, cust?.phone);
        rows.push({
          conversationId: c.id,
          customerId: c.customer?.id || null,
          customerName: nameInfo.displayName,
          rawCustomerName: nameInfo.rawName,
          lastMessage: lastReal.content,
          lastInboundAt: lastReal.created_at,
          waitingMinutes: Math.floor((Date.now() - new Date(lastReal.created_at).getTime()) / 60000),
        });
      }
    }
    const summaryFacts = {
      totalUnreplied: rows.length,
      waitingOver15Min: rows.filter((r) => (r.waitingMinutes || 0) >= 15).length,
    };
    return { tool: 'query_unreplied_chats', args, count: rows.length, summaryFacts, rows };
  },
};

/**
 * Tool 3: prospek yang BELUM punya jadwal aktif — customer tanpa reservasi
 * berstatus confirmed/pending/hold. Definisi state-based (bukan keyword):
 * mencakup prospek murni maupun yang reservasi lamanya sudah selesai/batal.
 * Kontak sandbox & dummy disaring; nomor HP tidak diteruskan ke LLM (privasi).
 */
export const queryUnscheduledProspects: CopilotTool = {
  name: 'query_unscheduled_prospects',
  description:
    'Daftar customer yang BELUM punya jadwal aktif (tanpa reservasi confirmed/pending/hold). ' +
    'Gunakan untuk pertanyaan "siapa yang belum terjadwal", "prospek yang belum booking", ' +
    '"siapa saja yang belum ada jadwalnya".',
  parameters: {
    limit: { type: 'number', description: `Maksimum baris (default ${MAX_ROWS}).` },
  },
  run: async (tenantId, args) => {
    const take = Math.min(Math.max(parseInt(String(args.limit || MAX_ROWS), 10) || MAX_ROWS, 1), MAX_ROWS);
    const customers = await prisma.customer.findMany({
      where: {
        tenant_id: tenantId,
        is_sandbox_test: false,
        reservations: { none: { status: { in: ACTIVE_RESERVATION_STATUSES } } },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        updated_at: true,
        conversations: {
          select: { id: true, last_message_at: true },
          orderBy: { last_message_at: 'desc' },
          take: 1,
        },
      },
      orderBy: { updated_at: 'desc' },
      take: 100,
    });
    const rows: any[] = [];
    for (const c of customers) {
      if (rows.length >= take) break;
      // Saring kontak dummy/test di level aplikasi (pola nomor tak bisa diindeks DB).
      if (isDummyOrTestContact(c.phone, c.name, false)) continue;
      const conv = (c as any).conversations?.[0] || null;
      const nameInfo = formatCustomerDisplayName(c.name, c.phone);
      rows.push({
        customerId: c.id,
        customerName: nameInfo.displayName,
        rawCustomerName: nameInfo.rawName,
        conversationId: conv?.id || null,
        lastActivityAt: conv?.last_message_at || (c as any).updated_at || null,
      });
    }
    return { tool: 'query_unscheduled_prospects', args, count: rows.length, rows };
  },
};

/**
 * Sinyal minat jadwal dari STATE sesi (bukan keyword pesan):
 * - booking.requestedTimeHint (kata waktu dari customer: "besok", "selasa", dsb.),
 * - booking.preferredDate (tanggal yang dinegosiasikan),
 * - booking.pendingScheduleCheck (sedang menunggu cek slot admin/bidan),
 * - cartItems (layanan terkunci di keranjang yang siap dijadwalkan),
 * - backwards-compatible dengan inquiryDate lama.
 *
 * Catatan anti-overfit: `lastDiscussedTreatment` BUKAN sinyal tunggal — pernah
 * membahas nama treatment di masa lalu tidak sama dengan minat jadwal. Ia hanya
 * dipakai sebagai sinyal bila sesi sudah punya state booking/keranjang (dicek di
 * pemanggil lewat `booking`/`cartItems`), atau saat `sessionData` tak tersedia.
 */
export function hasScheduleIntentSignal(sessionData: any, lastDiscussedTreatment: string | null): boolean {
  if (!sessionData || typeof sessionData !== 'object') {
    return Boolean(lastDiscussedTreatment && String(lastDiscussedTreatment).trim());
  }
  const booking = sessionData.booking || {};
  if (booking.requestedTimeHint && String(booking.requestedTimeHint).trim()) return true;
  if (booking.preferredDate && String(booking.preferredDate).trim()) return true;
  if (booking.pendingScheduleCheck === true) return true;
  if (sessionData.inquiryDate && String(sessionData.inquiryDate).trim()) return true;
  if (Array.isArray(sessionData.cartItems) && sessionData.cartItems.length > 0) return true;
  return false;
}

/**
 * Evaluasi kecocokan tanggal yang diminta customer pada sesi dengan filter tanggal admin.
 * Deterministik: cocokkan ISO, kata relatif ("besok"/"hari ini"), atau nama hari — BUKAN
 * substring bebas dua arah (mencegah "sen" cocok dengan "senin" secara keliru).
 */
export function matchesInquiryDate(sessionData: any, targetDate: unknown, now: Date = new Date()): boolean {
  if (!targetDate) return true;
  const target = String(targetDate).trim().toLowerCase();
  if (!target) return true;

  const booking = sessionData?.booking || {};
  const prefDate = String(booking.preferredDate || sessionData?.inquiryDate || '').trim().toLowerCase();
  const timeHint = String(booking.requestedTimeHint || '').trim().toLowerCase();

  const todayStr = formatWibDateYYYYMMDD(now);
  const tomorrowStr = formatWibDateYYYYMMDD(wibDayBoundsUtc(1, now).start);
  const todayDayName = getWibDayName(now).toLowerCase();
  const tomorrowDayName = getWibDayName(wibDayBoundsUtc(1, now).start).toLowerCase();

  // 1. Cocok persis string tanggal (YYYY-MM-DD).
  if (prefDate && prefDate === target) return true;

  // 2. Target = besok (kata / ISO besok / nama hari besok).
  if (target === 'besok' || target === tomorrowStr || target === tomorrowDayName) {
    if (prefDate === tomorrowStr) return true;
    if (matchesDayToken(timeHint, 'besok') || matchesDayToken(timeHint, tomorrowDayName)) return true;
  }

  // 3. Target = hari ini (kata / ISO hari ini / nama hari ini).
  if (target === 'hari ini' || target === todayStr || target === todayDayName) {
    if (prefDate === todayStr) return true;
    if (matchesDayToken(timeHint, 'hari ini') || matchesDayToken(timeHint, todayDayName)) return true;
  }

  // 4. Target nama hari eksplisit (mis. "senin") → cocokkan token hari pada hint.
  if (matchesDayToken(timeHint, target)) return true;

  return false;
}

/** Cocokkan token hari/frasa utuh (word-boundary), bukan substring bebas. */
function matchesDayToken(text: string, token: string): boolean {
  if (!text || !token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(text);
}

/**
 * Sinyal minat jadwal dari TEKS pesan customer (detektor kanonik pipeline
 * produksi — single source of truth, BUKAN keyword baru):
 * - `isScheduleCheckEngagement`: ack/komitmen/pertanyaan ketersediaan, dan
 * - `hasScheduleSignal` ATAU `isScheduleAvailabilityText` ATAU `extractTimeHint`
 *   ATAU `hasBookingCommitSignal` (petunjuk waktu/hari, "bisa", verba komitmen).
 * Menangkap varian nyata seperti "Bsk bisa pijat full body oksi tah?" (singkatan
 * "bsk" + kata ketersediaan "bisa" tanpa kata jadwal eksplisit).
 */
export function hasTextScheduleSignal(text: string): boolean {
  if (!text || !text.trim()) return false;
  const clean = stripCommercialSpam(text);
  if (!clean) return false;
  if (!isScheduleCheckEngagement(clean)) return false;
  return (
    hasScheduleSignal(clean) ||
    isScheduleAvailabilityText(clean) ||
    extractTimeHint(clean) !== null ||
    hasBookingCommitSignal(clean)
  );
}

/**
 * Tool 4: tanya jadwal yang belum booking (stalled inquiry).
 *
 * Definisi deterministik (state + riwayat pesan, bukan keyword hafalan):
 * - ada pesan INBOUND dalam `sinceDays` hari terakhir,
 * - ada sinyal minat jadwal — dari state sesi (`requestedTimeHint`/`preferredDate`/
 *   `pendingScheduleCheck`/`cartItems`) ATAU dari teks pesan customer itu sendiri
 *   memakai detektor kanonik `hasScheduleSignal` (dipakai pipeline produksi),
 * - TANPA reservasi aktif (confirmed/pending/hold),
 * - TANPA balasan ADMIN setelah inbound terakhir (masih menggantung),
 * - bila ada parameter `date`, hanya mengambil yang sinyal tanggalnya cocok
 *   (state sesi atau petunjuk waktu dari teks).
 *
 * Akar masalah yang ditutup (2026-09-28): di produksi `session_data.booking` NYARIS
 * TIDAK PERNAH terisi (0 dari 780 percakapan) sehingga recall tool ini = nol.
 * Bukti paling andal & selalu tersedia adalah riwayat pesan → sinyal jadwal diambil
 * dari teks inbound memakai detektor kanonik (bukan keyword baru).
 *
 * Batas jujur: `session_data` JSON tak bisa diindeks DB → filter sinyal di aplikasi
 * (setelah query inbound terbatas). Tenant-scoped, tanpa phone ke LLM.
 */
export const queryStalledInquiries: CopilotTool = {
  name: 'query_stalled_inquiries',
  description:
    'Daftar pasien yang menanyakan/minta jadwal tapi BELUM booking (tanpa reservasi aktif, ' +
    'belum dibalas admin setelah pesan terakhir). Mendukung filter tanggal bila admin menanyakan hari/tanggal tertentu.',
  parameters: {
    date: { type: 'string', description: 'Tanggal format YYYY-MM-DD (WIB) atau kata relatif ("besok", "hari ini"). Kosong = semua.' },
    sinceDays: { type: 'number', description: 'Jendela hari ke belakang (default 7).' },
    limit: { type: 'number', description: `Maksimum baris (default ${MAX_ROWS}).` },
  },
  run: async (tenantId, args) => {
    const take = Math.min(Math.max(parseInt(String(args.limit || MAX_ROWS), 10) || MAX_ROWS, 1), MAX_ROWS);
    const sinceDays = Math.min(Math.max(parseInt(String(args.sinceDays || 7), 10) || 7, 1), 90);
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const convs = await prisma.conversation.findMany({
      where: { tenant_id: tenantId, last_message_at: { gte: since } },
      select: {
        id: true,
        session_data: true,
        last_discussed_treatment: true,
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            reservations: { select: { status: true } },
          },
        },
        messages: {
          where: { sender_type: { not: 'INTERNAL_NOTE' } },
          orderBy: { created_at: 'desc' },
          // Ambil beberapa pesan terakhir: sinyal jadwal bisa muncul di turn
          // customer sebelum balasan bot terakhir (bukan hanya pesan terakhir).
          // 8 pesan agar alur negosiasi (minta → ditawari jam → diam) terbaca utuh.
          take: 8,
          select: { direction: true, content: true, created_at: true },
        },
      },
      orderBy: { last_message_at: 'desc' },
      take: 200,
    });

    const rows: any[] = [];
    for (const c of convs) {
      if (rows.length >= take) break;
      const cust: any = c.customer;
      if (!cust) continue;
      if (isDummyOrTestContact(cust.phone, cust.name, false)) continue;

      // Tanpa reservasi aktif → masih prospek.
      const hasActive = (cust.reservations || []).some((r: any) =>
        ACTIVE_RESERVATION_STATUSES.includes(r.status)
      );
      if (hasActive) continue;

      const msgs: any[] = (c as any).messages || [];
      // Saring dan bersihkan pesan dari spam komersial
      const cleanedMsgs = msgs
        .map((m) => ({
          direction: m.direction,
          content: stripCommercialSpam(m.content || ''),
          created_at: m.created_at,
        }))
        .filter((m) => m.content.length > 0);

      const lastReal = cleanedMsgs[0];
      // Pesan nyata terakhir harus INBOUND (belum dibalas admin) → menggantung.
      if (!lastReal || (lastReal.direction as any) !== Direction.INBOUND) continue;

      // Sinyal jadwal: state sesi ATAU teks pesan customer (detektor kanonik).
      const inboundTexts = cleanedMsgs
        .filter((m) => (m.direction as any) === Direction.INBOUND && typeof m.content === 'string')
        .map((m) => m.content as string);
      const textHint = inboundTexts.map((t) => extractTimeHint(t)).find((h) => h) || null;
      const textSignal = inboundTexts.some((t) => hasTextScheduleSignal(t));
      const stateSignal = hasScheduleIntentSignal(c.session_data, c.last_discussed_treatment);
      if (!stateSignal && !textSignal) continue;

      // Filter tanggal bila admin menanyakan hari/tanggal tertentu — cocokkan
      // dari state sesi ATAU petunjuk waktu teks (reuse matcher kanonik).
      if (args.date) {
        const textSessionLike = textHint ? { booking: { requestedTimeHint: textHint } } : null;
        const dateOk =
          matchesInquiryDate(c.session_data, args.date) ||
          (textSessionLike ? matchesInquiryDate(textSessionLike, args.date) : false);
        if (!dateOk) continue;
      }

      // Jam yang PERNAH ditawarkan admin (dari teks balasan OUTBOUND) — agar admin
      // tahu titik percakapan berhenti ("sudah ditawari jam 10, belum balas").
      // Reuse detektor jam kanonik; bukan regex per-kasus.
      const offeredTime =
        cleanedMsgs
          .filter((m) => (m.direction as any) === Direction.OUTBOUND && typeof m.content === 'string')
          .map((m) => extractTimeOfDayHint(m.content as string))
          .find((h) => h) || null;

      const booking = (c.session_data as any)?.booking;
      const nameInfo = formatCustomerDisplayName(cust.name, cust.phone);
      rows.push({
        customerId: cust.id,
        customerName: nameInfo.displayName,
        rawCustomerName: nameInfo.rawName,
        conversationId: c.id,
        treatment: c.last_discussed_treatment || null,
        requestedTime: booking?.requestedTimeHint || booking?.preferredDate || textHint || null,
        offeredTime,
        lastMessage: lastReal.content,
        lastInboundAt: lastReal.created_at,
        waitingMinutes: Math.floor((Date.now() - new Date(lastReal.created_at).getTime()) / 60000),
      });
    }
    return { tool: 'query_stalled_inquiries', args, count: rows.length, rows };
  },
};

/**
 * Tool 5: profil & riwayat pasien (kunjungan lampau + catatan admin).
 * Tenant-scoped; nomor HP DISAMARKAN via `maskPhoneNumber` (privasi — nomor mentah
 * tidak pernah sampai ke LLM). Row berkunci `customerName` agar tercakup grounding.
 */
export const getCustomerHistory: CopilotTool = {
  name: 'get_customer_history',
  description:
    'Menarik profil pelanggan beserta riwayat kunjungan lampau dan catatan admin. ' +
    'Gunakan bila admin menanyakan riwayat/preferensi seorang pasien (mis. "Bunda X sebelumnya ambil perawatan apa").',
  parameters: {
    name: { type: 'string', description: 'Nama pelanggan (sebagian).' },
    customerId: { type: 'string', description: 'ID pelanggan bila sudah diketahui (opsional).' },
  },
  run: async (tenantId, args) => {
    const name = args.name ? String(args.name).trim() : '';
    const customerId = args.customerId ? String(args.customerId).trim() : '';
    if (!name && !customerId) {
      return { tool: 'get_customer_history', args, count: 0, rows: [], note: 'Sebutkan nama atau ID pelanggan.' };
    }

    const select = {
      id: true,
      name: true,
      phone: true,
      kecamatan: true,
      kota: true,
      ltv_cache: true,
      admin_notes: true,
      preferences: true,
      reservations: {
        select: { booking_date: true, treatment_detail: true, treatment_category: true, status: true },
        orderBy: { booking_date: 'desc' as const },
        take: 5,
      },
      conversations: { select: { id: true }, orderBy: { last_message_at: 'desc' as const }, take: 1 },
    };

    let customers: any[] = [];
    if (customerId) {
      const one = await prisma.customer.findFirst({ where: { tenant_id: tenantId, id: customerId }, select });
      customers = one ? [one] : [];
    } else {
      customers = await prisma.customer.findMany({
        where: { tenant_id: tenantId, is_sandbox_test: false, name: { contains: name, mode: 'insensitive' } },
        select,
        orderBy: { updated_at: 'desc' },
        take: 3,
      });
    }

    const rows: any[] = [];
    for (const c of customers) {
      if (isDummyOrTestContact(c.phone, c.name, false)) continue;
      const reservations = (c as any).reservations || [];
      const conv = (c as any).conversations?.[0] || null;
      const nameInfo = formatCustomerDisplayName(c.name, c.phone);
      rows.push({
        customerId: c.id,
        customerName: nameInfo.displayName,
        rawCustomerName: nameInfo.rawName,
        phone: maskPhoneNumber(c.phone),
        kecamatan: c.kecamatan || null,
        kota: c.kota || null,
        ltvTotal: (c as any).ltv_cache || 0,
        adminNotes: c.admin_notes ? String(c.admin_notes).slice(0, 500) : null,
        preferences: (c as any).preferences || null,
        pastReservationsCount: reservations.length,
        lastVisits: reservations.slice(0, 3).map((r: any) => {
          const visitDate = r.booking_date ? new Date(r.booking_date) : null;
          return {
            dateWib: visitDate ? formatWibDateYYYYMMDD(visitDate) : null,
            timeWib: visitDate ? formatWibTime(visitDate) : null,
            treatment: r.treatment_detail || r.treatment_category,
            status: r.status,
          };
        }),
        conversationId: conv?.id || null,
      });
    }
    return { tool: 'get_customer_history', args, count: rows.length, rows };
  },
};

/**
 * Tokenisasi query bahasa alami menjadi kata kunci generik (murni, deterministik).
 *
 * BUKAN daftar hafalan kata/frasa: teks APA PUN dipecah menjadi token huruf (≥4 huruf,
 * unik, maks 8). Membuat pertanyaan kalimat ("SOP jeda pijat setelah vaksin?") cocok
 * dengan baris DB ("...jeda...vaksin...") tanpa pencocokan kalimat-per-kalimat
 * (anti-overfitting) dan tanpa regex gatekeeper intent.
 */
export function extractSearchTokens(query: string, maxTokens = 8): string[] {
  const tokens = String(query || '').toLowerCase().match(/[a-z]{4,}/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
      if (out.length >= maxTokens) break;
    }
  }
  return out;
}

/**
 * Bangun klausa OR Prisma untuk pencarian teks: frasa utuh (presisi) + tiap token
 * (recall). Murni — mudah diuji. Dipakai `lookup_catalog_and_policy` agar bahasa
 * alami admin tetap grounding ke DB.
 */
export function buildTextSearchOr(fields: string[], query: string): any[] {
  const q = String(query || '').trim();
  const likes: string[] = [];
  if (q) likes.push(q);
  for (const t of extractSearchTokens(q)) {
    if (!likes.some((l) => l.toLowerCase() === t)) likes.push(t);
  }
  const or: any[] = [];
  for (const f of fields) {
    for (const l of likes) {
      or.push({ [f]: { contains: l, mode: 'insensitive' as const } });
    }
  }
  return or;
}

export type MatchQuality = 'exact' | 'partial' | 'none';

/**
 * Peringkat deterministik katalog & kebijakan (Fase 4):
 * 1. Frasa persis di judul/nama (+1000) atau di deskripsi (+500).
 * 2. Jumlah kata cocok unik (+100 per kata di judul, +25 di deskripsi).
 * 3. Bonus kecocokan seluruh kata pencarian (+300).
 * 4. Posisi kata cocok di judul (makin di depan makin tinggi).
 */
export function rankCatalogAndPolicyRows(rows: any[], query: string): any[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    return rows.map((r) => ({ ...r, matchQuality: 'none' as MatchQuality }));
  }

  const tokens = extractSearchTokens(q).filter((t) => t.length >= 2);

  const scored = rows.map((row) => {
    const title = String(row.title || '').toLowerCase();
    const body = String(row.body || '').toLowerCase();

    let score = 0;
    let matchQuality: MatchQuality = 'none';

    // 1. Frasa persis di judul (skor tertinggi)
    if (title.includes(q)) {
      score += 1000;
      matchQuality = 'exact';
    } else if (body.includes(q)) {
      score += 500;
      matchQuality = 'exact';
    }

    // 2. Jumlah kata cocok unik
    let matchingTokensInTitle = 0;
    let matchingTokensInBody = 0;
    for (const t of tokens) {
      if (title.includes(t)) matchingTokensInTitle++;
      else if (body.includes(t)) matchingTokensInBody++;
    }

    const totalMatchingTokens = matchingTokensInTitle + matchingTokensInBody;
    score += matchingTokensInTitle * 100 + matchingTokensInBody * 25;

    // Bonus jika SEMUA kata pencarian cocok
    if (tokens.length > 1 && totalMatchingTokens >= tokens.length) {
      score += 300;
      if (matchQuality === 'none') {
        matchQuality = matchingTokensInTitle === tokens.length ? 'exact' : 'partial';
      }
    } else if (totalMatchingTokens > 0 && matchQuality === 'none') {
      matchQuality = 'partial';
    }

    // 3. Posisi kecocokan di judul (makin di depan makin relevan)
    const titlePos = title.indexOf(q);
    if (titlePos >= 0) {
      score += Math.max(0, 50 - titlePos);
    } else if (tokens.length > 0) {
      const firstTokenPos = title.indexOf(tokens[0]);
      if (firstTokenPos >= 0) {
        score += Math.max(0, 30 - firstTokenPos);
      }
    }

    return { row: { ...row, matchQuality }, score };
  });

  // Urutkan skor tertinggi ke terendah
  scored.sort((a, b) => b.score - a.score);

  return scored.map((s) => s.row);
}

/**
 * Tool 6: katalog layanan resmi & SOP/kebijakan klinik (grounding medis).
 * Sumber: `ClinicService` (harga/durasi), `ClinicPolicy` (SOP), `KnowledgeChunk` (FAQ/dokumen).
 * Semua tenant-scoped, `take` dibatasi. Row TANPA `customerName` (bukan entitas pasien).
 *
 * Pencarian memakai frasa + token generik (`buildTextSearchOr`) sehingga pertanyaan
 * kalimat alami ("SOP jeda pijat setelah vaksin?") tetap cocok ke baris DB — TANPA
 * menghafal kalimat pengguna.
 */
export const lookupCatalogAndPolicy: CopilotTool = {
  name: 'lookup_catalog_and_policy',
  description:
    'Mencari katalog layanan resmi (harga normal/promo, durasi, usia) dan dokumen SOP/kebijakan klinik ' +
    '(mis. jeda pasca vaksin, penanganan komplain). Terima pertanyaan kalimat alami; query dipecah otomatis. ' +
    'Gunakan untuk pertanyaan SOP/prosedur/layanan.',
  parameters: {
    query: { type: 'string', description: 'Topik SOP atau nama layanan; boleh kalimat alami.' },
    type: { type: 'string', description: 'TREATMENT | POLICY | ALL (default ALL).' },
  },
  run: async (tenantId, args) => {
    const q = args.query ? String(args.query).trim() : '';
    const type = (args.type ? String(args.type).toUpperCase() : 'ALL') as 'TREATMENT' | 'POLICY' | 'ALL';

    const wantTreatments = type === 'TREATMENT' || type === 'ALL';
    const wantPolicy = type === 'POLICY' || type === 'ALL';
    const wantKnowledge = type === 'ALL';

    const [services, policies, chunks] = await Promise.all([
      wantTreatments
        ? prisma.clinicService.findMany({
            where: { tenant_id: tenantId, is_active: true, ...(q ? { OR: buildTextSearchOr(['name', 'description'], q) } : {}) },
            take: 60,
          }).catch(() => [])
        : Promise.resolve([] as any[]),
      wantPolicy
        ? prisma.clinicPolicy.findMany({
            where: { tenant_id: tenantId, is_active: true, ...(q ? { OR: buildTextSearchOr(['topic', 'title', 'factual_summary'], q) } : {}) },
            take: 30,
          }).catch(() => [])
        : Promise.resolve([] as any[]),
      wantKnowledge
        ? prisma.knowledgeChunk.findMany({
            where: { tenant_id: tenantId, ...(q ? { OR: buildTextSearchOr(['title', 'content', 'keywords'], q) } : {}) },
            take: 30,
          }).catch(() => [])
        : Promise.resolve([] as any[]),
    ]);

    const rawRows: any[] = [];
    for (const s of (services || []) as any[]) {
      rawRows.push({
        kind: 'TREATMENT',
        source: `ClinicService:${s.service_id}`,
        title: s.name,
        category: s.category,
        ageLabel: s.age_label,
        durationMinutes: s.duration_minutes,
        originalPrice: s.original_price,
        promoPrice: s.promo_price,
        body: s.description ? String(s.description).slice(0, 800) : null,
      });
    }
    for (const p of (policies || []) as any[]) {
      rawRows.push({
        kind: 'POLICY',
        source: `ClinicPolicy:${p.topic}`,
        title: p.title,
        body: String(p.factual_summary || '').slice(0, 800),
      });
    }
    for (const k of (chunks || []) as any[]) {
      rawRows.push({
        kind: 'KNOWLEDGE',
        source: `KnowledgeChunk:${k.title}`,
        title: k.title,
        body: String(k.content || '').slice(0, 800),
      });
    }

    // Peringkat deterministik sebelum dipotong ke batas MAX_ROWS
    const rankedRows = rankCatalogAndPolicyRows(rawRows, q);

    return {
      tool: 'lookup_catalog_and_policy',
      args,
      count: Math.min(rankedRows.length, MAX_ROWS),
      rows: rankedRows.slice(0, MAX_ROWS),
    };
  },
};

/**
 * Tool 7: penjelas status percakapan (Pilar 3 — Explainability).
 *
 * Menjawab pertanyaan diagnostik admin/CS: "kenapa nomor X dialihkan ke CS?",
 * "kenapa bot diam di chat ini?", "status percakapan Bunda Y?".
 *
 * Grounding penuh dari KOLOM RIIL (bukan `metadata` fiktif):
 * - `Conversation.is_human_handling` → bot aktif vs diambil alih manusia,
 * - `Conversation.escalation_reason` / `current_state` (termasuk `HUMAN_HANDLING`),
 * - `Conversation.human_handling_since`, `last_message_at`,
 * - `Conversation.session_data` (state mesin bot v3: booking, keluhan aktif),
 * - 5 `Message` terakhir (arah + isi) sebagai kronologi.
 *
 * Keamanan: tenant-scoped (anti-IDOR), saring sandbox/dummy, nomor HP DISAMARKAN
 * (`maskPhoneNumber`). Definisi status murni dari state DB — TANPA pencocokan kata
 * kunci kalimat.
 */
export const explainConversationState: CopilotTool = {
  name: 'explain_conversation_state',
  description:
    'Menjelaskan status satu percakapan: apakah bot masih aktif atau sudah diambil alih manusia ' +
    '(CS/bidan), alasan eskalasi, state mesin bot, waktu, dan 5 pesan terakhir. ' +
    'Gunakan untuk "kenapa nomor X dialihkan ke CS", "kenapa bot diam", "status chat ini".',
  parameters: {
    phone: { type: 'string', description: 'Nomor HP pasien (sebagian). Opsional bila customerName diisi.' },
    customerName: { type: 'string', description: 'Nama pasien (sebagian). Opsional bila phone diisi.' },
  },
  run: async (tenantId, args) => {
    const phone = args.phone ? String(args.phone).trim() : '';
    const name = args.customerName ? String(args.customerName).trim() : '';
    if (!phone && !name) {
      return {
        tool: 'explain_conversation_state',
        args,
        count: 0,
        rows: [],
        note: 'Sebutkan nomor HP atau nama pasien untuk dijelaskan statusnya.',
      };
    }

    const where: any = { tenant_id: tenantId, is_sandbox_test: false };
    if (phone) where.phone = { contains: phone };
    if (name) where.name = { contains: name, mode: 'insensitive' };

    const customers = await prisma.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        conversations: {
          orderBy: { last_message_at: 'desc' },
          take: 3,
          select: {
            id: true,
            current_state: true,
            previous_state: true,
            is_human_handling: true,
            human_handling_since: true,
            escalation_reason: true,
            last_message_at: true,
            session_data: true,
            last_discussed_treatment: true,
            messages: {
              where: { sender_type: { not: 'INTERNAL_NOTE' } },
              orderBy: { created_at: 'desc' },
              take: 5,
              select: { direction: true, sender_type: true, content: true, created_at: true },
            },
          },
        },
      },
      orderBy: { updated_at: 'desc' },
      take: 3,
    });

    const rows: any[] = [];
    for (const c of customers as any[]) {
      // Saring kontak dummy/test di level aplikasi (pola nomor tak bisa diindeks DB).
      if (isDummyOrTestContact(c.phone, c.name, false)) continue;
      const convs: any[] = c.conversations || [];
      if (convs.length === 0) {
        rows.push({
          customerName: c.name || 'Bunda',
          phone: maskPhoneNumber(c.phone),
          statusBot: 'BELUM_ADA_PERCAKAPAN',
          statusLabel: 'Belum ada percakapan tercatat.',
          escalationReason: null,
          currentState: null,
          humanHandlingSince: null,
          lastActivityAt: null,
          lastMessages: [],
        });
        continue;
      }
      for (const conv of convs) {
        rows.push(buildConversationExplanation(c, conv));
        if (rows.length >= MAX_ROWS) break;
      }
      if (rows.length >= MAX_ROWS) break;
    }

    return { tool: 'explain_conversation_state', args, count: rows.length, rows };
  },
};

/**
 * Bentuk penjelasan deterministik dari state DB (murni — mudah diuji).
 * Status bot diturunkan dari kolom, bukan tebakan teks:
 * - `is_human_handling` → DIAMBIL_ALIH_MANUSIA,
 * - `current_state === 'COMPLETED'` → SELESAI,
 * - selain itu → BOT_AKTIF.
 */
export function buildConversationExplanation(customer: any, conv: any): any {
  const session = conv?.session_data && typeof conv.session_data === 'object' ? conv.session_data : {};
  const messages: any[] = (conv?.messages || []).slice(0, 5).map((m: any) => ({
    direction: m.direction,
    sender: m.sender_type || (m.direction === Direction.INBOUND ? 'CUSTOMER' : 'BOT'),
    content: typeof m.content === 'string' ? m.content.slice(0, 300) : null,
    at: m.created_at,
  }));

  let statusBot = 'BOT_AKTIF';
  if (conv?.is_human_handling === true || conv?.current_state === 'HUMAN_HANDLING') {
    statusBot = 'DIAMBIL_ALIH_MANUSIA';
  } else if (conv?.current_state === 'COMPLETED') {
    statusBot = 'SELESAI';
  }

  return {
    customerName: customer?.name || 'Bunda',
    phone: maskPhoneNumber(customer?.phone),
    conversationId: conv?.id || null,
    statusBot,
    isHumanHandling: conv?.is_human_handling === true,
    escalationReason: conv?.escalation_reason || null,
    currentState: conv?.current_state || null,
    previousState: conv?.previous_state || null,
    humanHandlingSince: conv?.human_handling_since || null,
    lastActivityAt: conv?.last_message_at || null,
    lastDiscussedTreatment: conv?.last_discussed_treatment || null,
    // Sinyal state mesin bot yang aman & relevan (tanpa PII/ID teknis).
    booking: session.booking || null,
    cartItemCount: Array.isArray(session.cartItems) ? session.cartItems.length : 0,
    pendingLocation: session.pendingLocation || null,
    lastMessages: messages,
  };
}

/**
 * Batas paginasi statistik. Dulu tool memakai `take: 2000` sehingga rentang
 * >5 hari terpotong diam-diam (31 hari produksi = ±9.700 pesan → undercount ±80%).
 * Sekarang semua halaman dibaca sampai habis dengan batas aman 20 × 5.000.
 */
const STATS_MESSAGE_PAGE = 5_000;
const STATS_CONV_PAGE = 2_000;
const STATS_MAX_PAGES = 20;

export const queryChatStats: CopilotTool = {
  name: 'query_chat_stats',
  description:
    'Mengambil agregasi statistik pesan chat (inbound/outbound) dan percakapan dalam rentang waktu. ' +
    'Gunakan untuk menjawab: "berapa chat hari ini", "chat per jam", "berapa percakapan baru minggu ini". ' +
    'Mengembalikan maksimal 31 bucket harian (atau 24 bucket jam) TERBARU dari rentang yang diminta. ' +
    'Bila hasil lebih dari satu bucket, baris terakhir bucket="TOTAL" berisi agregat seluruh rentang — ' +
    'pakai angka TOTAL itu untuk pertanyaan total, JANGAN menjumlahkan bucket sendiri.',
  parameters: {
    dateFrom: { type: 'string', description: 'Tanggal awal rentang WIB (YYYY-MM-DD). Default hari ini.' },
    dateTo: { type: 'string', description: 'Tanggal akhir rentang WIB (YYYY-MM-DD). Default sama dengan dateFrom.' },
    groupBy: { type: 'string', description: 'Pengelompokan: "day" (per hari) atau "hour" (per jam). Default "day".' },
  },
  run: async (tenantId, args) => {
    const todayStr = formatWibDateYYYYMMDD();
    const dFromStr = isValidIsoDate(args.dateFrom) ? String(args.dateFrom).trim() : todayStr;
    const dToStr = isValidIsoDate(args.dateTo) ? String(args.dateTo).trim() : dFromStr;

    const startUtc = wibDayBoundsUtc(0, new Date(`${dFromStr}T12:00:00Z`)).start;
    const endUtc = wibDayBoundsUtc(0, new Date(`${dToStr}T12:00:00Z`)).end;
    const groupBy = args.groupBy === 'hour' ? 'hour' : 'day';
    // Kapasitas bucket (hari/jam). Rentang efektif dibatasi ke kapasitas ini agar
    // tidak menarik data jauh melebihi yang bisa ditampilkan (mis. "tahun ini").
    const maxBuckets = groupBy === 'hour' ? 24 : 31;
    const maxRangeMs = maxBuckets * 24 * 60 * 60 * 1000;
    const effectiveStartUtc =
      endUtc.getTime() - startUtc.getTime() > maxRangeMs
        ? new Date(endUtc.getTime() - maxRangeMs)
        : startUtc;

    // Paginasi penuh (bukan `take: 2000`). Tanpa ini, pertanyaan seperti
    // "berapa chat bulan ini" melaporkan sebagian kecil angka sebenarnya tanpa error.
    const messages: Array<{ direction: any; created_at: Date; conversation_id: string | null }> = [];
    let messageCursor: string | undefined;
    for (let page = 0; page < STATS_MAX_PAGES; page++) {
      const batch = await prisma.message.findMany({
        where: {
          tenant_id: tenantId,
          created_at: { gte: effectiveStartUtc, lte: endUtc },
          // Konsisten dengan tool lain: customer sandbox/test tidak boleh mengotori statistik.
          conversation: { customer: { is_sandbox_test: false } },
        },
        select: {
          id: true,
          direction: true,
          created_at: true,
          conversation_id: true,
        },
        orderBy: { id: 'asc' },
        take: STATS_MESSAGE_PAGE,
        ...(messageCursor ? { cursor: { id: messageCursor }, skip: 1 } : {}),
      });
      messages.push(...batch);
      if (batch.length < STATS_MESSAGE_PAGE) break;
      messageCursor = batch[batch.length - 1].id;
    }

    const conversations: Array<{ id: string; created_at: Date; is_human_handling: boolean; is_frustrated: boolean }> = [];
    let convCursor: string | undefined;
    for (let page = 0; page < STATS_MAX_PAGES; page++) {
      const batch = await prisma.conversation.findMany({
        where: {
          tenant_id: tenantId,
          created_at: { gte: effectiveStartUtc, lte: endUtc },
          customer: { is_sandbox_test: false },
        },
        select: {
          id: true,
          created_at: true,
          is_human_handling: true,
          is_frustrated: true,
        },
        orderBy: { id: 'asc' },
        take: STATS_CONV_PAGE,
        ...(convCursor ? { cursor: { id: convCursor }, skip: 1 } : {}),
      });
      conversations.push(...batch);
      if (batch.length < STATS_CONV_PAGE) break;
      convCursor = batch[batch.length - 1].id;
    }

    const bucketsMap = new Map<string, {
      bucket: string;
      inboundMessages: number;
      outboundMessages: number;
      newConversations: number;
      activeConvIds: Set<string>;
      humanHandling: number;
      frustrated: number;
    }>();

    const getBucketKey = (d: Date): string => {
      if (groupBy === 'hour') {
        const wib = new Date(d.getTime() + WIB_OFFSET_MS);
        return `${formatWibDateYYYYMMDD(d)} ${String(wib.getUTCHours()).padStart(2, '0')}:00`;
      }
      return formatWibDateYYYYMMDD(d);
    };

    const getOrCreateBucket = (key: string) => {
      let b = bucketsMap.get(key);
      if (!b) {
        b = {
          bucket: key,
          inboundMessages: 0,
          outboundMessages: 0,
          newConversations: 0,
          activeConvIds: new Set<string>(),
          humanHandling: 0,
          frustrated: 0,
        };
        bucketsMap.set(key, b);
      }
      return b;
    };

    const allActiveConvIds = new Set<string>();
    for (const m of messages) {
      const b = getOrCreateBucket(getBucketKey(new Date(m.created_at)));
      if ((m.direction as any) === Direction.INBOUND) {
        b.inboundMessages++;
      } else {
        b.outboundMessages++;
      }
      if (m.conversation_id) {
        b.activeConvIds.add(m.conversation_id);
        allActiveConvIds.add(m.conversation_id);
      }
    }

    for (const c of conversations) {
      const b = getOrCreateBucket(getBucketKey(new Date(c.created_at)));
      b.newConversations++;
      if (c.is_human_handling) b.humanHandling++;
      if (c.is_frustrated) b.frustrated++;
    }

    const sortedKeys = Array.from(bucketsMap.keys()).sort();
    // Rentang lebih panjang dari kapasitas bucket → tampilkan bucket TERBARU,
    // bukan yang paling awal (perilaku lama memotong justru data terbaru).
    const keptKeys = sortedKeys.length > maxBuckets ? sortedKeys.slice(-maxBuckets) : sortedKeys;
    const rows = keptKeys.map((k) => {
      const b = bucketsMap.get(k)!;
      return {
        bucket: b.bucket,
        inboundMessages: b.inboundMessages,
        outboundMessages: b.outboundMessages,
        newConversations: b.newConversations,
        activeConversations: b.activeConvIds.size,
        humanHandling: b.humanHandling,
        frustrated: b.frustrated,
      };
    });

    if (rows.length === 0) {
      rows.push({
        bucket: dFromStr,
        inboundMessages: 0,
        outboundMessages: 0,
        newConversations: 0,
        activeConversations: 0,
        humanHandling: 0,
        frustrated: 0,
      });
    } else if (rows.length > 1) {
      // Baris TOTAL deterministik. Tanpa ini, LLM harus menjumlahkan 31 bucket
      // sendiri dan hasilnya terbukti salah (30 hari dilaporkan ~75% dari aslinya).
      // activeConversations memakai DISTINCT seluruh rentang, bukan penjumlahan
      // bucket (supaya percakapan yang muncul di 2 hari tidak dihitung ganda).
      rows.push({
        bucket: 'TOTAL',
        inboundMessages: rows.reduce((s, r) => s + r.inboundMessages, 0),
        outboundMessages: rows.reduce((s, r) => s + r.outboundMessages, 0),
        newConversations: rows.reduce((s, r) => s + r.newConversations, 0),
        activeConversations: allActiveConvIds.size,
        humanHandling: rows.reduce((s, r) => s + r.humanHandling, 0),
        frustrated: rows.reduce((s, r) => s + r.frustrated, 0),
      });
    }

    return { tool: 'query_chat_stats', args, count: rows.length, rows };
  },
};

export const queryRevenue: CopilotTool = {
  name: 'query_revenue',
  description:
    'Mengambil rekap omzet/pendapatan dari reservasi klinik (jasa, ongkir, diskon, kuitansi terpisah). ' +
    'Gunakan untuk menjawab: "omzet minggu ini", "omzet per treatment", "berapa yang sudah dibayar". ' +
    'basis = booking_date (tanggal treatment), BUKAN tanggal pembayaran. ' +
    'Bila hasil lebih dari satu bucket, baris terakhir bucket="TOTAL" berisi agregat — pakai itu untuk total.',
  parameters: {
    dateFrom: { type: 'string', description: 'Tanggal awal rentang WIB (YYYY-MM-DD).' },
    dateTo: { type: 'string', description: 'Tanggal akhir rentang WIB (YYYY-MM-DD).' },
    groupBy: { type: 'string', description: 'Pengelompokan: "day" | "treatment" | "staff". Default "day".' },
    status: { type: 'string', description: 'Status reservasi: "completed" | "confirmed" | "all". Default "completed".' },
  },
  run: async (tenantId, args) => {
    const dFromStr = isValidIsoDate(args.dateFrom) ? String(args.dateFrom).trim() : undefined;
    const dToStr = isValidIsoDate(args.dateTo) ? String(args.dateTo).trim() : dFromStr;

    const where: any = {
      tenant_id: tenantId,
      // Konsisten dengan tool lain: reservasi customer sandbox/test tidak dihitung.
      customer: { is_sandbox_test: false },
    };

    if (dFromStr) {
      const startUtc = wibDayBoundsUtc(0, new Date(`${dFromStr}T12:00:00Z`)).start;
      const endUtc = wibDayBoundsUtc(0, new Date(`${dToStr}T12:00:00Z`)).end;
      where.booking_date = { gte: startUtc, lte: endUtc };
    }

    const st = String(args.status || 'completed').toLowerCase();
    if (st === 'confirmed') {
      where.status = 'confirmed';
    } else if (st === 'all') {
      where.status = { in: ['completed', 'confirmed'] };
    } else {
      where.status = 'completed';
    }

    const reservations = await prisma.reservation.findMany({
      where,
      include: {
        assigned_staff: { select: { id: true, name: true } },
      },
      orderBy: { booking_date: 'asc' },
      take: 1000,
    });

    const groupBy = ['treatment', 'staff'].includes(String(args.groupBy || '')) ? String(args.groupBy) : 'day';

    const bucketsMap = new Map<string, {
      bucket: string;
      reservations: number;
      purchaseValue: number;
      deliveryFee: number;
      discount: number;
      receiptAmount: number;
      lunasRevenue: number;
      pendingRevenue: number;
      totalRevenue: number;
    }>();

    for (const r of reservations) {
      let key = 'Semua';
      if (groupBy === 'day') {
        key = r.booking_date ? formatWibDateYYYYMMDD(new Date(r.booking_date)) : 'Tanpa Tanggal';
      } else if (groupBy === 'treatment') {
        key = (r.treatment_detail || String(r.treatment_category || 'Lainnya')).trim();
      } else if (groupBy === 'staff') {
        key = r.assigned_staff?.name || 'Belum Ditugaskan';
      }

      let b = bucketsMap.get(key);
      if (!b) {
        b = {
          bucket: key,
          reservations: 0,
          purchaseValue: 0,
          deliveryFee: 0,
          discount: 0,
          receiptAmount: 0,
          lunasRevenue: 0,
          pendingRevenue: 0,
          totalRevenue: 0,
        };
        bucketsMap.set(key, b);
      }

      const pVal = r.purchase_value || 0;
      const dFee = r.delivery_fee || 0;
      const totalFee = pVal + dFee;
      const isLunas = isReservationPaid(r);

      b.reservations++;
      b.purchaseValue += pVal;
      b.deliveryFee += dFee;
      b.discount += r.discount_amount || 0;
      b.receiptAmount += r.receipt_amount || 0;
      b.totalRevenue += totalFee;
      if (isLunas) {
        b.lunasRevenue += totalFee;
      } else {
        b.pendingRevenue += totalFee;
      }
    }

    // SSOT finansial: selaras dengan FinancialAnalyticsService (lunas vs pending berbasis purchase_occurred_at).
    const allBuckets = Array.from(bucketsMap.values()).map((b) => {
      const netRevenue = (b.purchaseValue || 0) + (b.deliveryFee || 0) - (b.discount || 0);
      const paidAmount = b.lunasRevenue;
      const pendingAmount = b.pendingRevenue;
      return {
        ...b,
        netRevenue,
        paidAmount,
        pendingAmount,
        basis: 'booking_date' as const,
      };
    });

    const rows = allBuckets.slice(-60);

    const totalReservations = allBuckets.reduce((s, r) => s + r.reservations, 0);
    const totalPurchase = allBuckets.reduce((s, r) => s + r.purchaseValue, 0);
    const totalDelivery = allBuckets.reduce((s, r) => s + r.deliveryFee, 0);
    const totalDiscount = allBuckets.reduce((s, r) => s + r.discount, 0);
    const totalReceipt = allBuckets.reduce((s, r) => s + r.receiptAmount, 0);
    const totalRevenue = totalPurchase + totalDelivery;
    const totalNetRevenue = totalRevenue - totalDiscount;
    const totalLunasRevenue = allBuckets.reduce((s, r) => s + r.lunasRevenue, 0);
    const totalPendingRevenue = allBuckets.reduce((s, r) => s + r.pendingRevenue, 0);

    const summaryFacts = {
      totalReservations,
      totalPurchase,
      totalDelivery,
      totalDiscount,
      totalRevenue,
      netRevenue: totalNetRevenue,
      lunasRevenue: totalLunasRevenue,
      pendingRevenue: totalPendingRevenue,
      paidAmount: totalLunasRevenue,
      pendingAmount: totalPendingRevenue,
      receiptAmount: totalReceipt,
    };

    if (rows.length > 1) {
      // Agregat deterministik: LLM tidak perlu (dan tidak boleh) menjumlahkan sendiri.
      rows.push({
        bucket: 'TOTAL',
        reservations: totalReservations,
        purchaseValue: totalPurchase,
        deliveryFee: totalDelivery,
        discount: totalDiscount,
        receiptAmount: totalReceipt,
        lunasRevenue: totalLunasRevenue,
        pendingRevenue: totalPendingRevenue,
        totalRevenue,
        netRevenue: totalNetRevenue,
        paidAmount: totalLunasRevenue,
        pendingAmount: totalPendingRevenue,
        basis: 'booking_date' as const,
      });
    }

    return { tool: 'query_revenue', args, count: rows.length, summaryFacts, rows };
  },
};

/**
 * Normalisasi status/tipe follow-up dari argumen LLM.
 *
 * Latar bug produksi: argumen mentah diteruskan langsung ke Prisma. Satu nilai
 * di luar enum (mis. "gagal", "terkirim") memicu PrismaClientValidationError →
 * seluruh turn Copilot gagal dengan "gangguan layanan AI". Sekarang nilai tak
 * dikenal diabaikan (filter tidak dipasang) dan sinonim umum dipetakan.
 */
const FOLLOWUP_STATUS_VALUES = new Set(['PENDING', 'QUEUED', 'SENT', 'CANCELLED', 'FAILED', 'SKIPPED']);
const FOLLOWUP_STATUS_ALIASES: Record<string, string> = {
  pending: 'PENDING',
  menunggu: 'PENDING',
  queued: 'QUEUED',
  antre: 'QUEUED',
  antrian: 'QUEUED',
  sent: 'SENT',
  terkirim: 'SENT',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  batal: 'CANCELLED',
  dibatalkan: 'CANCELLED',
  failed: 'FAILED',
  gagal: 'FAILED',
  skipped: 'SKIPPED',
  skip: 'SKIPPED',
  dilewati: 'SKIPPED',
};
const FOLLOWUP_TYPE_VALUES = new Set([
  'NO_PURCHASE',
  'NEXT_TREATMENT',
  'REMINDER_H1',
  'REVIEW_H1_BABY',
  'REVIEW_H1_MOMS',
  'WINBACK_60D',
]);
const FOLLOWUP_TYPE_ALIASES: Record<string, string> = {
  no_purchase: 'NO_PURCHASE',
  belum_beli: 'NO_PURCHASE',
  belum_purchase: 'NO_PURCHASE',
  next_treatment: 'NEXT_TREATMENT',
  treatment_berikutnya: 'NEXT_TREATMENT',
  reminder_h1: 'REMINDER_H1',
  pengingat_h1: 'REMINDER_H1',
  review_h1_baby: 'REVIEW_H1_BABY',
  review_h1_moms: 'REVIEW_H1_MOMS',
  winback_60d: 'WINBACK_60D',
};

function normalizeEnumArg(raw: unknown, values: Set<string>, aliases: Record<string, string>): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const key = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return undefined;
  const upper = key.toUpperCase();
  if (values.has(upper)) return upper;
  return aliases[key];
}

export function normalizeFollowUpStatus(raw: unknown): string | undefined {
  return normalizeEnumArg(raw, FOLLOWUP_STATUS_VALUES, FOLLOWUP_STATUS_ALIASES);
}

export function normalizeFollowUpType(raw: unknown): string | undefined {
  return normalizeEnumArg(raw, FOLLOWUP_TYPE_VALUES, FOLLOWUP_TYPE_ALIASES);
}

export const queryFollowups: CopilotTool = {
  name: 'query_followups',
  description:
    'Mengambil antrean follow-up customer berdasarkan status, tipe template, dan jatuh tempo. ' +
    'Gunakan untuk menjawab: "follow-up yang gagal", "follow-up jatuh tempo hari ini", "siapa yang belum di-follow up".',
  parameters: {
    status: { type: 'string', description: 'Status: "QUEUED" | "SENT" | "FAILED" | "CANCELLED" | "SKIPPED".' },
    type: { type: 'string', description: 'Tipe: "NO_PURCHASE" | "NEXT_TREATMENT" | "REMINDER_H1" | "REVIEW_H1_BABY" | "REVIEW_H1_MOMS" | "WINBACK_60D".' },
    dueBefore: { type: 'string', description: 'Batas tanggal jadwal WIB (YYYY-MM-DD). Kosong = seluruh antrean mendatang mulai yang paling mendesak.' },
    limit: { type: 'number', description: 'Maksimum baris (default 60, maks 60).' },
  },
  run: async (tenantId, args) => {
    const take = Math.min(Math.max(parseInt(String(args.limit || 60), 10) || 60, 1), 60);
    const where: any = {
      tenant_id: tenantId,
      // Konsisten dengan tool lain: customer sandbox/test tidak masuk antrean nyata.
      customer: { is_sandbox_test: false },
    };

    // Validasi enum: nilai mentah dari LLM TIDAK boleh langsung masuk Prisma.
    const status = normalizeFollowUpStatus(args.status);
    if (status) where.status = status;
    const type = normalizeFollowUpType(args.type);
    if (type) where.type = type;
    if (isValidIsoDate(args.dueBefore)) {
      const endUtc = wibDayBoundsUtc(0, new Date(`${String(args.dueBefore).trim()}T12:00:00Z`)).end;
      where.scheduled_at = { lte: endUtc };
    }

    let totalQueued = 0;
    try {
      totalQueued = await prisma.followUp.count({ where });
    } catch {
      totalQueued = 0;
    }

    let followups: any[] = [];
    try {
      followups = await prisma.followUp.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              conversations: {
                select: { id: true },
                orderBy: { last_message_at: 'desc' },
                take: 1,
              },
            },
          },
        },
        orderBy: { scheduled_at: 'asc' },
        take,
      });
    } catch {
      followups = [];
    }

    if (totalQueued === 0 && followups.length > 0) {
      totalQueued = followups.length;
    }

    let rangeEarliest: string | null = null;
    let rangeLatest: string | null = null;
    if (followups.length > 0) {
      const first = followups[0].scheduled_at;
      rangeEarliest = first ? formatWibDateYYYYMMDD(new Date(first)) : null;
      const last = followups[followups.length - 1].scheduled_at;
      rangeLatest = last ? formatWibDateYYYYMMDD(new Date(last)) : null;

      if (totalQueued > followups.length) {
        try {
          const latestItem = await prisma.followUp.findFirst({
            where,
            orderBy: { scheduled_at: 'desc' },
            select: { scheduled_at: true },
          });
          if (latestItem?.scheduled_at) {
            rangeLatest = formatWibDateYYYYMMDD(new Date(latestItem.scheduled_at));
          }
        } catch {}
      }
    }

    const rows = followups.map((f: any) => {
      const nameInfo = formatCustomerDisplayName(f.customer?.name, f.customer?.phone);
      const schedDate = f.scheduled_at ? new Date(f.scheduled_at) : null;
      const sentDate = f.sent_at ? new Date(f.sent_at) : null;
      return {
        customerName: nameInfo.displayName,
        rawCustomerName: nameInfo.rawName,
        conversationId: f.customer?.conversations?.[0]?.id || null,
        type: f.type,
        status: f.status,
        scheduledDateWib: schedDate ? formatWibDateYYYYMMDD(schedDate) : null,
        scheduledTimeWib: schedDate ? formatWibTime(schedDate) : null,
        scheduledAt: schedDate ? formatWibDateYYYYMMDD(schedDate) : null,
        sentAt: sentDate ? formatWibDateYYYYMMDD(sentDate) : null,
        treatmentCategory: f.treatment_category || null,
      };
    });

    return {
      tool: 'query_followups',
      args,
      count: rows.length,
      totalQueued,
      truncated: totalQueued > rows.length,
      rangeEarliest,
      rangeLatest,
      rows,
    };
  },
};

export const COPILOT_TOOLS: CopilotTool[] = [
  queryReservationsByFilter,
  queryUnrepliedChats,
  queryUnscheduledProspects,
  queryStalledInquiries,
  getCustomerHistory,
  lookupCatalogAndPolicy,
  explainConversationState,
  queryChatStats,
  queryRevenue,
  queryFollowups,
];

export function getCopilotTool(name: string): CopilotTool | undefined {
  return COPILOT_TOOLS.find((t) => t.name === name);
}
