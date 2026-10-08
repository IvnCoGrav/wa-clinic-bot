import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { responseCacheService } from '../../services/response-cache.service';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';
import { memoryReservations, filterMemoryByTenant } from './stores';
import { wibDayRangeToUtc } from '../../utils/time-wib';
import { extractNotesFromRawText, extractBabyDetails } from '../../utils/reservation-text-parser';
import { computeCurrentAge, resolveMomGestationalInfo } from '../../utils/age-calculator';
import { parseReservationText } from '../../utils/reservation-text-parser';
import { tenantOf, sanitizeDurationMinutes } from './route-helpers';
import { reservationCoreService, ReservationConflictError } from '../../services/reservation-core.service';
import { auditService } from '../../services/audit.service';
import { customerService } from '../../services/customer.service';
import { staffNotificationService } from '../../services/staff-notification.service';

/**
 * Reservation CRUD Routes — Read/Write dasar reservasi.
 * Dipisah dari reservations.subroute.ts (God Controller) secara bertahap (Fase 2.3 audit arsitektur).
 * Routes: count, daily-slots, list, parse, quick-hold, create, detail, status, set-date, proof, assign-staff, delete, capi-queue
 */
export async function reservationCrudRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/reservations/count
   */
  fastify.get('/api/admin/reservations/count', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = tenantOf(request);
    const cacheKey = `reservations:count:${tenantId}`;
    const cached = responseCacheService.get<number>(cacheKey);
    if (cached !== null && cached !== undefined) {
      return reply
        .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
        .status(200)
        .send({ success: true, count: cached });
    }

    try {
      const count = await prisma.reservation.count({
        where: { tenant_id: tenantId },
      });
      responseCacheService.set(cacheKey, count, 15);
      return reply
        .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
        .status(200)
        .send({ success: true, count });
    } catch (err: any) {
      return reply
        .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
        .status(200)
        .send({ success: true, count: filterMemoryByTenant(memoryReservations.values(), tenantId).length });
    }
  });

  /**
   * GET /api/admin/reservations/daily-slots
   * Aggregasi slot harian untuk Mobile Slot Checker (visual availability)
   */
  fastify.get(
    '/api/admin/reservations/daily-slots',
    async (
      request: FastifyRequest<{ Querystring: { date?: string } }>,
      reply: FastifyReply
    ) => {
      const dateStr = (request.query?.date || '').trim();
      const tenantId = tenantOf(request);
      // R2: deterministik WIB via wibDayRangeToUtc (Asia/Jakarta), bukan server-local
      let dayStart: Date;
      let dayEnd: Date;
      let y: number, m: number, d: number;
      const wibRange = dateStr ? wibDayRangeToUtc(dateStr) : null;
      if (wibRange) {
        dayStart = wibRange.start;
        dayEnd = wibRange.end;
        [y, m, d] = dateStr.split('-').map(Number);
        m = m - 1;
      } else {
        const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        const todayRange = wibDayRangeToUtc(todayKey)!;
        dayStart = todayRange.start;
        dayEnd = todayRange.end;
        [y, m, d] = todayKey.split('-').map(Number);
        m = m - 1;
      }

      const SLOTS = ['09:00', '10:00', '10:30', '11:00', '13:00', '14:00', '14:30', '15:00', '16:00'];
      const slotMins = SLOTS.map((t) => {
        const [h, mm] = t.split(':').map(Number);
        return h * 60 + mm;
      });
      const slotWindow = [60, 30, 30, 90, 60, 30, 30, 60, 90]; // menit per slot, sinkron QuickHoldModal

      try {
        const staffList = await prisma.staff.findMany({
          where: { tenant_id: tenantId, active: true },
        });
        // Filter therapist role if exists
        const therapists = staffList.filter((s: any) => !s.role || s.role === 'THERAPIST' || String(s.role).toLowerCase().includes('therapist'));
        const effectiveStaff = therapists.length > 0 ? therapists : staffList.filter((s: any) => s.active !== false);
        const totalTherapists = effectiveStaff.length || 2;

        const reservations = await prisma.reservation.findMany({
          where: {
            tenant_id: tenantId,
            booking_date: { gte: dayStart, lte: dayEnd },
            status: { in: ['confirmed', 'hold'] },
          },
          include: {
            customer: { select: { name: true, kelurahan: true, kecamatan: true } },
            assigned_staff: { select: { id: true, name: true } },
          },
          orderBy: { booking_date: 'asc' },
        });

        const slots = SLOTS.map((time, idx) => {
          const startMin = slotMins[idx];
          const endMin = startMin + slotWindow[idx];
          const bookings: any[] = [];
          const bookedStaffIds = new Set<string>();
          for (const r of reservations) {
            if (!r.booking_date) continue;
            const rd = new Date(r.booking_date);
            const wibHour = (rd.getUTCHours() + 7) % 24;
            const rMin = wibHour * 60 + rd.getUTCMinutes();
            // Interval hunian [mulai, selesai): dukung treatment >1 jam via duration_minutes (default 60)
            const rDur = Number((r as any).duration_minutes) > 0 ? Number((r as any).duration_minutes) : 60;
            if (rMin < endMin && rMin + rDur > startMin) {
              bookings.push({
                staffName: r.assigned_staff?.name || 'Tanpa Bidan',
                staffId: r.assigned_staff?.id || null,
                customerName: r.customer?.name || 'Customer',
                area: r.customer?.kelurahan || r.customer?.kecamatan || '-',
                status: r.status,
                treatment: r.treatment_detail || r.raw_text || '',
              });
              if (r.assigned_staff?.id) bookedStaffIds.add(r.assigned_staff.id);
            }
          }
          const availableCount = Math.max(0, totalTherapists - bookings.length);
          let status: 'full' | 'available' | 'hold' = 'available';
          if (availableCount === 0) status = 'full';
          else if (bookings.some((b) => b.status === 'hold')) status = 'hold';
          else status = 'available';
          const availableStaff = effectiveStaff
            .filter((s: any) => !bookedStaffIds.has(s.id))
            .map((s: any) => ({ id: s.id, name: s.name }));
          return { time, status, availableCount, availableStaff, bookings };
        });

        return reply.status(200).send({
          success: true,
          date: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          totalTherapists,
          slots,
        });
      } catch (err: any) {
        console.error(JSON.stringify({
          event: 'AVAILABILITY_QUERY_FAILED',
          tenantId: tenantId,
          error: err?.message, timestamp: new Date().toISOString(),
        }));
        return reply.status(503).send({
          success: false,
          error: 'AVAILABILITY_UNAVAILABLE',
          message: 'Ketersediaan slot tidak dapat diverifikasi saat ini. Coba lagi.',
        });
      }
    }
  );

  /**
   * GET /api/admin/reservations
   * List reservasi dengan filter, pagination, sorting, stats — disinkronkan WIB via wibDayRangeToUtc.
   * Fallback ke memory store bila DB offline (untuk dev/test offline).
   */
  fastify.get(
    '/api/admin/reservations',
    async (
      request: FastifyRequest<{
        Querystring: {
          page?: string;
          pageSize?: string;
          status?: string;
          staffId?: string;
          category?: string;
          search?: string;
          startDate?: string;
          endDate?: string;
          sortBy?: string;
          sortOrder?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const page = Math.max(1, parseInt(request.query?.page || '1', 10) || 1);
      const pageSize = Math.min(500, Math.max(1, parseInt(request.query?.pageSize || '20', 10) || 20));
      const statusParam = request.query?.status?.trim();
      const staffIdParam = request.query?.staffId?.trim();
      const categoryParam = request.query?.category?.trim();
      const searchParam = request.query?.search?.trim();
      const startDateParam = request.query?.startDate?.trim();
      const endDateParam = request.query?.endDate?.trim();
      const sortByParam = request.query?.sortBy?.trim() || 'booking_date';
      const sortOrderParam = (request.query?.sortOrder?.toLowerCase() === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc';

      const now = new Date();
      const overdueThreshold = new Date(Date.now() - 3 * 3600 * 1000);

      const tenantId = tenantOf(request);
      const where: any = { tenant_id: tenantId };

      // Status filter
      if (statusParam && statusParam !== 'all') {
        if (statusParam === 'upcoming') {
          where.AND = [
            ...(where.AND || []),
            {
              OR: [
                { booking_date: null },
                { booking_date: { gte: overdueThreshold } },
              ],
            },
            { status: { notIn: ['cancelled', 'rejected'] } },
          ];
        } else if (statusParam === 'overdue') {
          where.AND = [
            ...(where.AND || []),
            { booking_date: { lt: overdueThreshold } },
            { status: { notIn: ['completed', 'cancelled', 'rejected'] } },
          ];
        } else {
          where.status = statusParam;
        }
      }

      // Staff filter
      if (staffIdParam && staffIdParam !== 'all') {
        if (staffIdParam === 'unassigned') {
          where.assigned_staff_id = null;
        } else {
          where.assigned_staff_id = staffIdParam;
        }
      }

      // Category filter
      if (categoryParam && categoryParam !== 'all') {
        where.treatment_category = categoryParam;
      }

      // Search query (customer name, phone, treatment detail, kelurahan, kecamatan, kota, raw text)
      if (searchParam) {
        where.AND = [
          ...(where.AND || []),
          {
            OR: [
              { treatment_detail: { contains: searchParam, mode: 'insensitive' } },
              { raw_text: { contains: searchParam, mode: 'insensitive' } },
              { customer: { name: { contains: searchParam, mode: 'insensitive' } } },
              { customer: { phone: { contains: searchParam } } },
              { customer: { kelurahan: { contains: searchParam, mode: 'insensitive' } } },
              { customer: { kecamatan: { contains: searchParam, mode: 'insensitive' } } },
              { customer: { kota: { contains: searchParam, mode: 'insensitive' } } },
            ],
          },
        ];
      }

      // Date range filter (Calendar view & Day queries — selaras WIB UTC+7, R3 pure)
      if (startDateParam && endDateParam) {
        let start: Date;
        let end: Date;
        const sRange = wibDayRangeToUtc(startDateParam);
        const eRange = wibDayRangeToUtc(endDateParam);
        if (sRange) start = sRange.start; else start = new Date(startDateParam);
        if (eRange) end = eRange.end; else end = new Date(endDateParam);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          where.booking_date = { gte: start, lte: end };
        }
      } else if (startDateParam) {
        const sRange = wibDayRangeToUtc(startDateParam);
        let start: Date;
        if (sRange) start = sRange.start; else start = new Date(startDateParam);
        if (!isNaN(start.getTime())) where.booking_date = { gte: start };
      } else if (endDateParam) {
        const eRange = wibDayRangeToUtc(endDateParam);
        let end: Date;
        if (eRange) end = eRange.end; else end = new Date(endDateParam);
        if (!isNaN(end.getTime())) where.booking_date = { lte: end };
      }

      // Sort Order
      let orderBy: any = [{ booking_date: sortOrderParam }, { created_at: 'desc' }];
      if (sortByParam === 'created_at') {
        orderBy = { created_at: sortOrderParam };
      } else if (sortByParam === 'booking_date') {
        orderBy = [{ booking_date: sortOrderParam }, { created_at: 'desc' }];
      } else if (sortByParam === 'status') {
        orderBy = [{ status: sortOrderParam }, { booking_date: 'asc' }];
      } else if (sortByParam === 'category' || sortByParam === 'treatment_category') {
        orderBy = [{ treatment_category: sortOrderParam }, { booking_date: 'asc' }];
      } else if (sortByParam === 'customer') {
        orderBy = [{ customer: { name: sortOrderParam } }, { booking_date: 'asc' }];
      }

      try {
        const tenantBaseWhere = { tenant_id: tenantId };
        const cacheKeyStats = `reservations:stats:${tenantId}`;
        let stats = responseCacheService.get<any>(cacheKeyStats);

        let rows: any[];
        let total: number;

        if (stats) {
          [rows, total] = await Promise.all([
            prisma.reservation.findMany({
              where,
              include: {
                customer: {
                  include: {
                    children: true,
                    reservations: {
                      where: { status: { notIn: ['cancelled', 'rejected'] } },
                      select: { id: true, purchase_value: true },
                    },
                  },
                },
                assigned_staff: {
                  select: { id: true, name: true, phone: true },
                },
              },
              orderBy,
              skip: (page - 1) * pageSize,
              take: pageSize,
            }),
            prisma.reservation.count({ where }),
          ]);
        } else {
          const [fetchedRows, fetchedTotal, totalCount, upcomingCount, overdueCount, confirmedCount, completedCount, cancelledCount, holdCount] =
            await Promise.all([
              prisma.reservation.findMany({
                where,
                include: {
                  customer: {
                    include: {
                      children: true,
                      reservations: {
                        where: { status: { notIn: ['cancelled', 'rejected'] } },
                        select: { id: true, purchase_value: true },
                      },
                    },
                  },
                  assigned_staff: {
                    select: { id: true, name: true, phone: true },
                  },
                },
                orderBy,
                skip: (page - 1) * pageSize,
                take: pageSize,
              }),
              prisma.reservation.count({ where }),
              prisma.reservation.count({ where: tenantBaseWhere }),
              prisma.reservation.count({
                where: {
                  ...tenantBaseWhere,
                  OR: [{ booking_date: null }, { booking_date: { gte: overdueThreshold } }],
                  status: { notIn: ['cancelled', 'rejected'] },
                },
              }),
              prisma.reservation.count({
                where: {
                  ...tenantBaseWhere,
                  booking_date: { lt: overdueThreshold },
                  status: { notIn: ['completed', 'cancelled', 'rejected'] },
                },
              }),
              prisma.reservation.count({ where: { ...tenantBaseWhere, status: { in: ['confirmed', 'en_route'] } } }),
              prisma.reservation.count({ where: { ...tenantBaseWhere, status: 'completed' } }),
              prisma.reservation.count({ where: { ...tenantBaseWhere, status: 'cancelled' } }),
              prisma.reservation.count({ where: { ...tenantBaseWhere, status: 'hold' } }),
            ]);

          rows = fetchedRows;
          total = fetchedTotal;
          stats = {
            total: totalCount,
            upcoming: upcomingCount,
            overdue: overdueCount,
            confirmed: confirmedCount,
            completed: completedCount,
            cancelled: cancelledCount,
            hold: holdCount,
          };
          responseCacheService.set(cacheKeyStats, stats, 15);
        }

        const { computeCurrentAge, resolveMomGestationalInfo } = await import('../../utils/age-calculator');
        const data = rows.map((r) => ({
          ...r,
          notes: (r as any).notes || extractNotesFromRawText(r.raw_text),
          baby_details: extractBabyDetails(r.raw_text),
          mom_gestational_info: resolveMomGestationalInfo({
            text: `${r.raw_text || ''} ${r.treatment_detail || ''}`,
            treatmentCategory: (r as any).treatment_category,
            registeredAt: (r as any).created_at,
          }),
          customer: r.customer
            ? {
                ...r.customer,
                totalTreatments: ((r.customer as any).reservations?.length ?? 0) > 0 ? (r.customer as any).reservations.length : 1,
                ltv: ((r.customer as any).reservations || []).reduce((acc: number, curr: any) => acc + (curr.purchase_value || 0), 0) || (r.purchase_value || 0),
                children:
                  (r.customer as any).children?.map((c: any) => ({
                    id: c.id,
                    name: c.name,
                    birth_date: c.birth_date,
                    raw_age_text: c.raw_age_text,
                    age_months_at_registration: c.age_months_at_registration,
                    current_age: computeCurrentAge({
                      birthDate: c.birth_date,
                      ageMonthsAtRegistration: c.age_months_at_registration,
                      registeredAt: c.created_at,
                      rawAgeText: c.raw_age_text,
                    }),
                  })) || [],
              }
            : undefined,
        }));
        return reply
          .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
          .status(200)
          .send({
            success: true,
            data,
            total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            stats,
          });
      } catch (err: any) {
        try {
          console.warn('[Admin API] Reservations query failed, retrying without children relation:', err.message);
          const rows = await prisma.reservation.findMany({
            where,
            include: { customer: true },
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
          });
          const total = await prisma.reservation.count({ where });
          const data = rows.map((r) => ({
            ...r,
            notes: (r as any).notes || extractNotesFromRawText(r.raw_text),
            baby_details: extractBabyDetails(r.raw_text),
            customer: r.customer ? { ...r.customer, children: [] } : undefined,
          }));
          return reply
            .status(200)
            .send({
              success: true,
              data,
              total,
              page,
              pageSize,
              totalPages: Math.max(1, Math.ceil(total / pageSize)),
              stats: { total, upcoming: total, overdue: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0 },
            });
        } catch (err2: any) {
          console.warn('[Admin API] Database error fetching reservations, falling back to memory:', err2.message);
          // Paritas relasi DB di memory: tempel assigned_staff dari peta staff tenant
          // (tanpa hardcode nama). DB offline → peta kosong, UI fallback ke staffList via FK.
          let memStaffMap = new Map<string, any>();
          try {
            const staffRows = await prisma.staff.findMany({
              where: { tenant_id: tenantId },
              select: { id: true, name: true, phone: true },
            });
            memStaffMap = new Map(staffRows.map((s: any) => [s.id, s]));
          } catch { /* DB offline */ }
          let data = filterMemoryByTenant(memoryReservations.values(), tenantId).map((r) => ({
            ...r,
            assigned_staff: (r as any).assigned_staff || (r.assigned_staff_id ? (memStaffMap.get(r.assigned_staff_id) || null) : null),
            notes: (r as any).notes || extractNotesFromRawText(r.raw_text),
            baby_details: extractBabyDetails(r.raw_text),
          }));

          // Memory filtering
          if (statusParam && statusParam !== 'all') {
            if (statusParam === 'upcoming') {
              data = data.filter((r) => (!r.booking_date || new Date(r.booking_date).getTime() >= overdueThreshold.getTime()) && r.status !== 'cancelled');
            } else if (statusParam === 'overdue') {
              data = data.filter((r) => r.booking_date && new Date(r.booking_date).getTime() < overdueThreshold.getTime() && r.status !== 'completed' && r.status !== 'cancelled');
            } else {
              data = data.filter((r) => r.status === statusParam);
            }
          }
          if (staffIdParam && staffIdParam !== 'all') {
            if (staffIdParam === 'unassigned') {
              data = data.filter((r) => !r.assigned_staff_id);
            } else {
              data = data.filter((r) => r.assigned_staff_id === staffIdParam);
            }
          }
          if (categoryParam && categoryParam !== 'all') {
            data = data.filter((r) => r.treatment_category === categoryParam);
          }
          if (searchParam) {
            const q = searchParam.toLowerCase();
            data = data.filter((r) =>
              (r.treatment_detail || '').toLowerCase().includes(q) ||
              (r.raw_text || '').toLowerCase().includes(q) ||
              (r.customer?.name || '').toLowerCase().includes(q) ||
              (r.customer?.phone || '').includes(q) ||
              (r.customer?.kelurahan || '').toLowerCase().includes(q) ||
              (r.customer?.kecamatan || '').toLowerCase().includes(q) ||
              (r.customer?.kota || '').toLowerCase().includes(q)
            );
          }
          if (startDateParam && endDateParam) {
            const start = new Date(startDateParam).getTime();
            const end = new Date(endDateParam).getTime();
            data = data.filter((r) => {
              if (!r.booking_date) return false;
              const t = new Date(r.booking_date).getTime();
              return t >= start && t <= end;
            });
          }

          data.sort((a: any, b: any) => {
            if (sortByParam === 'booking_date') {
              const timeA = a.booking_date ? new Date(a.booking_date).getTime() : (sortOrderParam === 'asc' ? Infinity : -Infinity);
              const timeB = b.booking_date ? new Date(b.booking_date).getTime() : (sortOrderParam === 'asc' ? Infinity : -Infinity);
              if (timeA !== timeB) {
                return sortOrderParam === 'asc' ? timeA - timeB : timeB - timeA;
              }
            } else if (sortByParam === 'status') {
              const sA = (a.status || '').toLowerCase();
              const sB = (b.status || '').toLowerCase();
              if (sA !== sB) {
                return sortOrderParam === 'asc' ? sA.localeCompare(sB) : sB.localeCompare(sA);
              }
            } else if (sortByParam === 'category' || sortByParam === 'treatment_category') {
              const cA = (a.treatment_category || '').toLowerCase();
              const cB = (b.treatment_category || '').toLowerCase();
              if (cA !== cB) {
                return sortOrderParam === 'asc' ? cA.localeCompare(cB) : cB.localeCompare(cA);
              }
            } else if (sortByParam === 'customer') {
              const nA = (a.customer?.name || '').toLowerCase();
              const nB = (b.customer?.name || '').toLowerCase();
              if (nA !== nB) {
                return sortOrderParam === 'asc' ? nA.localeCompare(nB) : nB.localeCompare(nA);
              }
            }
            const cAtA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const cAtB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return sortOrderParam === 'asc' ? cAtA - cAtB : cAtB - cAtA;
          });

          const total = data.length;
          const paginated = data.slice((page - 1) * pageSize, page * pageSize);
          const allMemory = Array.from(memoryReservations.values());

          return reply
            .status(200)
            .send({
              success: true,
              data: paginated,
              total,
              page,
              pageSize,
              totalPages: Math.max(1, Math.ceil(total / pageSize)),
              stats: { total, upcoming: total, overdue: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0, hold: 0 },
            });
        }
      }
    }
);

  /**
   * POST /api/admin/reservation/parse
   */
  fastify.post(
    '/api/admin/reservation/parse',
    async (request: FastifyRequest<{ Body: { customerId: string; rawText: string; force?: boolean; customerAddressId?: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      const { customerId, rawText, force } = request.body || {};
      const customerAddressId = (request.body as any)?.customerAddressId || null;
      if (!customerId || !rawText) {
        return reply.status(400).send({ error: 'customerId and rawText are required' });
      }
 
      const parseResult = parseReservationText(rawText);
      if (!parseResult.success || !parseResult.reservation) {
        return reply.status(400).send({
          success: false,
          error: parseResult.error,
          missingFields: parseResult.missingFields,
        });
      }
 
      const parsed = parseResult.reservation;
      try {
        let reservation: any;
        try {
          const result = await reservationCoreService.saveReservation({
            tenantId: tenantId,
            customerId,
            customerAddressId,
            chatId: (await customerService.getCustomerById(customerId, tenantId))?.phone
              ? `${(await customerService.getCustomerById(customerId, tenantId))?.phone}@c.us`
              : '',
            bookingDate: parsed.bookingDate,
            treatmentCategory: parsed.treatmentCategory,
            treatmentDetail: parsed.treatmentDetail,
            rawText,
            babies: parsed.babies || [],
            customerName: parsed.name,
            kecamatan: parsed.kec,
            kota: parsed.kota,
            // Integritas spasial: parser form TIDAK punya field kelurahan; `parsed.address`
            // adalah alamat jalan/perumahan lengkap. DILARANG menyalinnya ke kolom
            // `kelurahan` (sumber pencemaran "Banjarmukti Residence" → kolom desa yang
            // membuat gazetteer salah mencocokkan desa). Alamat lengkap hidup di
            // preferences.address; kolom kelurahan hanya diisi entitas desa resmi
            // hasil geocoding/gazetteer.
            kelurahan: undefined,
            address: parsed.address,
            source: 'ADMIN_PANEL',
            force: force === true,
            status: 'confirmed',
          });
          reservation = result.reservation;
        } catch (conflictErr: any) {
          if (conflictErr instanceof ReservationConflictError) {
            return reply.status(409).send({
              success: false,
              error: conflictErr.code,
              message: conflictErr.code === 'DUPLICATE_BOOKING'
                ? 'Customer sudah memiliki reservasi aktif pada tanggal & jam yang sama.'
                : 'Terapis sudah memiliki jadwal lain yang tumpang tindih.',
              existingReservation: conflictErr.existingReservation,
            });
          }
          throw conflictErr;
        }
 
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_RESERVATION',
          targetId: reservation.id,
          payload: { customerId, rawText, force: force === true },
          ipAddress: request.ip,
        });
 
        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        // FIX R2.4 (F1): DILARANG membalas sukses palsu saat DB gagal di produksi.
        // Fallback in-memory hanya untuk dev/test (konsisten dengan approve-purchase).
        if (process.env.NODE_ENV === 'production') {
          console.error('[Admin API] /parse gagal simpan reservasi (production):', (error as Error).message);
          return reply.status(500).send({ success: false, error: 'DATABASE_ERROR' });
        }
        const mockReservation = {
          id: `res_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          tenant_id: tenantId,
          customer_id: customerId,
          treatment_category: parsed.treatmentCategory,
          treatment_detail: parsed.treatmentDetail,
          booking_date: parsed.bookingDate,
          raw_text: rawText,
          status: 'confirmed',
          created_at: new Date(),
          updated_at: new Date(),
        };
        memoryReservations.set(mockReservation.id, mockReservation);
        return reply.status(200).send({
          success: true,
          data: mockReservation,
          note: 'Fallback in-memory mode (DB offline)',
        });
      }
    }
  );
 
  /**
   * POST /api/admin/reservation/quick-hold
   * Quick Booking / Slot Hold (Tahan Slot Ditawarkan ke Customer)
   */
  fastify.post(
    '/api/admin/reservation/quick-hold',
    async (
      request: FastifyRequest<{
        Body: {
          customerId?: string;
          customerPhone?: string;
          customerName?: string;
          bookingDate: string; // ISO datetime
          assignedStaffId?: string;
          notes?: string;
          treatmentCategory?: 'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE';
          treatmentDetail?: string;
          durationMinutes?: number;
          force?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const {
        customerId: reqCustomerId,
        customerPhone,
        customerName,
        bookingDate,
        assignedStaffId,
        notes,
        treatmentCategory = 'BABY',
        treatmentDetail = '[HOLD] Slot Ditawarkan',
      } = request.body || {};
      const durationMinutes = sanitizeDurationMinutes((request.body as any)?.durationMinutes);
      const force = (request.body as any)?.force === true;
 
      if (!bookingDate) {
        return reply.status(400).send({ success: false, error: 'bookingDate wajib diisi.' });
      }
 
      const parsedDate = new Date(bookingDate);
      if (isNaN(parsedDate.getTime())) {
        return reply.status(400).send({ success: false, error: 'Format bookingDate tidak valid.' });
      }
 
      let customerId = reqCustomerId;
      if (!customerId && customerPhone) {
        const cleanPhone = customerPhone.replace(/\D/g, '');
        const targetPhone = cleanPhone.startsWith('0') ? '62' + cleanPhone.slice(1) : cleanPhone;
        const cust = await customerService.getOrCreateCustomer(targetPhone, customerName, tenantId);
        customerId = cust.id;
      } else if (customerId && customerName) {
        await customerService.updateCustomerName(customerId, customerName, tenantId).catch(() => {});
      }
 
      if (!customerId) {
        return reply.status(400).send({ success: false, error: 'customerId atau customerPhone wajib diisi.' });
      }
 
      const dbCategory: 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' =
        treatmentCategory === 'BUNDLE' ? 'BOTH' :
        treatmentCategory === 'KIDS' ? 'KIDS' :
        (treatmentCategory as 'BABY' | 'KIDS' | 'MOMS' | 'BOTH');
 
      const rawNotes = notes ? `\nCatatan Hold: ${notes}` : '';
      // W1: sertakan alamat jalan customer saat hold agar jejak alamat tidak hilang
      // (sebelumnya rawText hanya memuat tanggal → edit/detail tanpa alamat).
      const holdCustomer = await customerService.getCustomerById(customerId, tenantId).catch(() => null);
      const holdAddress = holdCustomer
        ? (((holdCustomer as any).preferences?.address) || ((holdCustomer as any).preferences?.full_address) || '').trim()
        : '';
      const rawText = `[Admin Quick Hold] Ditawarkan: ${parsedDate.toLocaleString('id-ID')}${holdAddress ? `\nAlamat: ${holdAddress}` : ''}${rawNotes}`;
 
      try {
        let coreResult: any;
        try {
          coreResult = await reservationCoreService.saveReservation({
            tenantId: tenantId,
            customerId,
            customerAddressId: (request.body as any)?.customerAddressId || null,
            bookingDate: parsedDate,
            treatmentCategory: dbCategory,
            treatmentDetail,
            durationMinutes,
            assignedStaffId: assignedStaffId || null,
            rawText,
            customerName,
            address: holdAddress || undefined,
            source: 'ADMIN_PANEL',
            force,
            status: 'hold',
          });
        } catch (conflictErr: any) {
          if (conflictErr instanceof ReservationConflictError) {
            return reply.status(409).send({
              success: false,
              error: conflictErr.code,
              message: conflictErr.code === 'DUPLICATE_BOOKING'
                ? 'Customer sudah memiliki reservasi aktif pada slot yang sama.'
                : 'Terapis sudah memiliki jadwal lain yang tumpang tindih.',
              existingReservation: conflictErr.existingReservation,
            });
          }
          throw conflictErr;
        }
        // Ambil ulang lengkap dengan relasi untuk respons dashboard.
        let reservation: any = coreResult.reservation;
        try {
          const full = await prisma.reservation.findFirst({
            where: { id: coreResult.reservation.id },
            include: {
              customer: { include: { children: true } },
              assigned_staff: { select: { id: true, name: true, phone: true } },
            },
          });
          if (full) reservation = full;
        } catch {}
 
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_QUICK_HOLD_RESERVATION',
          targetId: reservation.id,
          payload: { customerId, bookingDate: parsedDate, assignedStaffId, status: 'hold', durationMinutes, force },
          ipAddress: request.ip,
        });
 
        return reply.status(201).send({ success: true, data: reservation });
      } catch (error: any) {
        // FIX R2.4 (F1): produksi DILARANG membalas 201 sukses palsu saat DB gagal.
        if (process.env.NODE_ENV === 'production') {
          console.error('[Admin API] quick-hold gagal simpan (production):', error?.message);
          return reply.status(500).send({ success: false, error: 'DATABASE_ERROR' });
        }
        const mockReservation = {
          id: `res_hold_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          tenant_id: tenantId,
          customer_id: customerId,
          treatment_category: dbCategory,
          treatment_detail: treatmentDetail,
          booking_date: parsedDate,
          duration_minutes: durationMinutes,
          assigned_staff_id: assignedStaffId || null,
          raw_text: rawText,
          status: 'hold',
          created_at: new Date(),
          updated_at: new Date(),
        };
        memoryReservations.set(mockReservation.id, mockReservation);
        return reply.status(201).send({ success: true, data: mockReservation, note: 'Fallback in-memory mode' });
      }
    }
  );
 
  /**
   * POST /api/admin/reservation
   */
  fastify.post(
    '/api/admin/reservation',
    async (
      request: FastifyRequest<{
        Body: {
          customerId: string;
          treatmentCategory: 'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE';
          treatmentDetail: string;
          bookingDate?: string;
          assignedStaffId?: string;
          status?: 'hold' | 'confirmed';
          notes?: string;
          babies?: Array<{ name: string; ageText?: string }>;
          purchaseValue?: number;
          ongkir?: number;
          durationMinutes?: number;
          address?: string;
          landmark?: string;
          force?: boolean;
          customerAddressId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { customerId, treatmentCategory, treatmentDetail, bookingDate, assignedStaffId, status, notes, babies, purchaseValue } = request.body || {};
      const customerAddressId = (request.body as any)?.customerAddressId || null;
      const durationMinutes = sanitizeDurationMinutes((request.body as any)?.durationMinutes);
      const force = (request.body as any)?.force === true;
      const address = (request.body as any)?.address as string | undefined;
      const landmark = (request.body as any)?.landmark as string | undefined;
 
      if (!customerId || !treatmentCategory || !treatmentDetail) {
        return reply.status(400).send({ error: 'customerId, treatmentCategory, dan treatmentDetail wajib diisi.' });
      }
      if (!['BABY', 'MOMS', 'BOTH', 'KIDS', 'BUNDLE'].includes(treatmentCategory)) {
        return reply.status(400).send({ error: 'treatmentCategory tidak valid.' });
      }
 
      const customer = await customerService.getCustomerById(customerId, tenantId);
      if (!customer) {
        return reply.status(404).send({ error: 'Customer tidak ditemukan.' });
      }
      // QA sandbox labeling: nomor dummy via jalur manual tetap ditandai sandbox.
      try {
        const ph = String((customer as any)?.phone || '');
        if (/^6289999/.test(ph) && !(customer as any)?.is_sandbox_test) {
          await prisma.customer.update({ where: { id: customerId }, data: { is_sandbox_test: true } });
        }
      } catch {}
 
      // Validasi aturan Add-on: Tidak bisa berdiri sendiri tanpa layanan utama
      const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
      const itemsInDetail = treatmentDetail.split(/[,+\n]/).map((s) => s.trim()).filter(Boolean);
      const treatmentValidation = treatmentCatalogService.validateReservationTreatments(itemsInDetail);
      if (!treatmentValidation.valid) {
        return reply.status(400).send({ error: treatmentValidation.error });
      }
 
      const parsedDate = bookingDate ? new Date(bookingDate) : null;
      if (bookingDate && parsedDate && isNaN(parsedDate.getTime())) {
        return reply.status(400).send({ error: 'Format bookingDate tidak valid.' });
      }
 
      const dbCategory: 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' =
        treatmentCategory === 'BUNDLE' ? 'BOTH' :
        treatmentCategory === 'KIDS' ? 'KIDS' :
        (treatmentCategory as 'BABY' | 'KIDS' | 'MOMS' | 'BOTH');
 
      const reservationStatus = status === 'hold' ? 'hold' : 'confirmed';
      const rawNotes = notes ? `\nCatatan: ${notes}` : '';
      const finalPurchaseValue = purchaseValue !== undefined && purchaseValue !== null && !isNaN(Number(purchaseValue)) ? Number(purchaseValue) : null;
      // Fase 1R — Pemisahan mutlak purchase_value (murni layanan) dan ongkir.
      // R2.6: ongkir TIDAK lagi ditulis sebelum save reservasi (mencegah partial
      // write bila core save gagal). Diterapkan SETELAH save sukses di bawah.
      // KB-6: bila ongkir tidak diisi admin, pakai referensi ongkir terakhir
      // customer agar tidak perlu input ulang di next treatment.
      const rawOngkir = (request.body as any)?.ongkir;
      let parsedOngkir: number | null =
        rawOngkir !== undefined && rawOngkir !== null && String(rawOngkir).trim() !== '' && !isNaN(Number(rawOngkir)) && Number(rawOngkir) >= 0
          ? Math.round(Number(rawOngkir))
          : null;
      if (parsedOngkir === null) {
        try {
          const { customerService } = await import('../../services/customer.service');
          const ref = await customerService.getLastDeliveryFee(customerId, tenantId);
          if (ref !== null) parsedOngkir = ref;
        } catch {}
      }
 
      try {
        let coreResult: any;
        try {
          coreResult = await reservationCoreService.saveReservation({
            tenantId: tenantId,
            customerId,
            customerAddressId,
            chatId: `${customer.phone}@c.us`,
            bookingDate: parsedDate,
            treatmentCategory: dbCategory,
            treatmentDetail,
            durationMinutes,
            assignedStaffId: assignedStaffId || null,
            purchaseValue: finalPurchaseValue,
            // KB-6: snapshot ongkir per-reservasi.
            deliveryFee: parsedOngkir,
            rawText: `[Admin Manual] ${treatmentCategory}: ${treatmentDetail}${address?.trim() ? `\nAlamat: ${address.trim()}` : ''}${rawNotes}`,
            babies: (babies || []).map((b) => ({ name: b.name, age: b.ageText || '' })),
            customerName: customer.name,
            kecamatan: customer.kecamatan || undefined,
            kota: customer.kota || undefined,
            kelurahan: customer.kelurahan || undefined,
            // Integritas spasial: alamat jalan fisik hidup di preferences.address
            // (di-persist via lifecycle); kolom kelurahan tetap entitas desa resmi.
            address: address?.trim() || undefined,
            source: 'ADMIN_PANEL',
            force,
            status: reservationStatus as 'hold' | 'confirmed',
          });
        } catch (conflictErr: any) {
          if (conflictErr instanceof ReservationConflictError) {
            return reply.status(409).send({
              success: false,
              error: conflictErr.code,
              message: conflictErr.code === 'DUPLICATE_BOOKING'
                ? 'Customer sudah memiliki reservasi aktif pada tanggal & jam yang sama.'
                : 'Terapis sudah memiliki jadwal lain yang tumpang tindih.',
              existingReservation: conflictErr.existingReservation,
            });
          }
          throw conflictErr;
        }
 
        // R2.6: ongkir diterapkan SETELAH reservasi tersimpan (bukan sebelum),
        // sehingga kegagalan save tidak meninggalkan ongkir customer ter-update.
        if (parsedOngkir !== null) {
          try {
            await prisma.customer.update({
              where: { id: customerId, tenant_id: tenantId },
              data: { ongkir: parsedOngkir },
            });
          } catch (e) {
            console.warn('[Admin API] Gagal update Customer.ongkir saat CREATE reservation:', (e as Error).message);
          }
        }
 
        // Persist patokan/landmark ke preferences (tidak melewati saveReservation
        // karena ReservationMutationParams tidak memiliki field landmark).
        if (landmark?.trim()) {
          try {
            await customerService.updateCustomer(customerId, { landmark: landmark.trim() }, tenantId).catch(() => {});
          } catch {}
        }
 
        // Ambil ulang lengkap dengan relasi untuk respons dashboard.
        let reservation: any = coreResult.reservation;
        try {
          const full = await prisma.reservation.findFirst({
            where: { id: coreResult.reservation.id },
            include: {
              customer: { include: { children: true } },
              assigned_staff: { select: { id: true, name: true, phone: true } },
            },
          });
          if (full) reservation = full;
        } catch {}
 
        if (assignedStaffId) {
          staffNotificationService.scheduleReservationAssignmentNotification(reservation.id, assignedStaffId).catch((err) => {
            console.error('[Admin API] Failed to schedule staff notification on create:', err.message);
          });
        }
 
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_RESERVATION_MANUAL',
          targetId: reservation.id,
          payload: { customerId, treatmentCategory, assignedStaffId, status: reservationStatus, source: 'admin_panel', force },
          ipAddress: request.ip,
        });
        // Override disengaja (force) dicatat khusus agar mudah diaudit.
        if (force) {
          await auditService.logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'CREATE_RESERVATION_FORCE_OVERRIDE',
            targetId: reservation.id,
            payload: { customerId, bookingDate: parsedDate, assignedStaffId, reason: 'admin force override konflik jadwal' },
            ipAddress: request.ip,
          }).catch(() => {});
        }
 
        return reply.status(201).send({ success: true, data: reservation });
      } catch (error: any) {
        // FIX R2.4 (F1): produksi DILARANG membalas 201 sukses palsu saat DB gagal.
        if (process.env.NODE_ENV === 'production') {
          console.error('[Admin API] create reservation manual gagal (production):', error?.message);
          return reply.status(500).send({ success: false, error: 'DATABASE_ERROR' });
        }
        const mockReservation = {
          id: `res_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          tenant_id: tenantId,
          customer_id: customerId,
          treatment_category: dbCategory,
          treatment_detail: treatmentDetail,
          booking_date: parsedDate,
          duration_minutes: durationMinutes,
          assigned_staff_id: assignedStaffId || null,
          raw_text: `[Admin Manual] ${treatmentCategory}: ${treatmentDetail}${rawNotes}`,
          status: reservationStatus,
          created_at: new Date(),
          updated_at: new Date(),
        };
        memoryReservations.set(mockReservation.id, mockReservation);
        return reply.status(201).send({ success: true, data: mockReservation, note: 'Fallback in-memory mode' });
      }
    }
  );
  }

export default reservationCrudRoutes;