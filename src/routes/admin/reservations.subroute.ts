import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { customerService } from '../../services/customer.service';
import { googleCalendarService } from '../../services/google-calendar.service';
import { capiService, resolveTreatmentValue, extractValueByFormat, getTenantCapiFormats, resolveCanonicalLandingUrl } from '../../services/capi.service';
import { extractRupiahAmount } from '../../services/purchase-detection.service';
import { parseReservationText, extractBabyDetails } from '../../utils/reservation-text-parser';
import { memoryReservations } from './stores';
import { responseCacheService } from '../../services/response-cache.service';

export async function reservationAdminRoutes(fastify: FastifyInstance) {
  // Invalidate cache saat ada create/update/delete reservasi
  fastify.addHook('onResponse', async (request) => {
    const method = request.method;
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && request.url.includes('/reservations')) {
      responseCacheService.invalidatePrefix('reservations:');
    }
  });

  /**
   * GET /api/admin/reservations/count
   */
  fastify.get('/api/admin/reservations/count', async (request: FastifyRequest, reply: FastifyReply) => {
    const cacheKey = `reservations:count:${DEFAULT_TENANT_ID}`;
    const cached = responseCacheService.get<number>(cacheKey);
    if (cached !== null && cached !== undefined) {
      return reply
        .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
        .status(200)
        .send({ success: true, count: cached });
    }

    try {
      const count = await prisma.reservation.count({
        where: { tenant_id: DEFAULT_TENANT_ID },
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
        .send({ success: true, count: memoryReservations.size });
    }
  });

  /**
   * GET /api/admin/reservations
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

      const where: any = { tenant_id: DEFAULT_TENANT_ID };

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

      // Search query (customer name, phone, treatment detail, address, raw text)
      if (searchParam) {
        where.AND = [
          ...(where.AND || []),
          {
            OR: [
              { treatment_detail: { contains: searchParam, mode: 'insensitive' } },
              { address: { contains: searchParam, mode: 'insensitive' } },
              { raw_text: { contains: searchParam, mode: 'insensitive' } },
              { customer: { name: { contains: searchParam, mode: 'insensitive' } } },
              { customer: { phone: { contains: searchParam } } },
            ],
          },
        ];
      }

      // Date range filter (Calendar view)
      if (startDateParam && endDateParam) {
        const start = new Date(startDateParam);
        const end = new Date(endDateParam);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          where.booking_date = {
            gte: start,
            lte: end,
          };
        }
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
        const tenantBaseWhere = { tenant_id: DEFAULT_TENANT_ID };
        const cacheKeyStats = `reservations:stats:${DEFAULT_TENANT_ID}`;
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
          const [fetchedRows, fetchedTotal, totalCount, upcomingCount, overdueCount, pendingCount, confirmedCount, completedCount, cancelledCount] =
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
              prisma.reservation.count({ where: { ...tenantBaseWhere, status: 'pending' } }),
              prisma.reservation.count({ where: { ...tenantBaseWhere, status: 'confirmed' } }),
              prisma.reservation.count({ where: { ...tenantBaseWhere, status: 'completed' } }),
              prisma.reservation.count({ where: { ...tenantBaseWhere, status: 'cancelled' } }),
            ]);

          rows = fetchedRows;
          total = fetchedTotal;
          stats = {
            total: totalCount,
            upcoming: upcomingCount,
            overdue: overdueCount,
            pending: pendingCount,
            confirmed: confirmedCount,
            completed: completedCount,
            cancelled: cancelledCount,
          };
          responseCacheService.set(cacheKeyStats, stats, 15);
        }

        const { computeCurrentAge } = await import('../../utils/age-calculator');
        const data = rows.map((r) => ({
          ...r,
          baby_details: extractBabyDetails(r.raw_text),
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
          let data = Array.from(memoryReservations.values()).map((r) => ({
            ...r,
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
              (r.address || '').toLowerCase().includes(q) ||
              (r.raw_text || '').toLowerCase().includes(q) ||
              (r.customer?.name || '').toLowerCase().includes(q) ||
              (r.customer?.phone || '').includes(q)
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
              stats: {
                total: allMemory.length,
                upcoming: allMemory.filter((r) => !r.booking_date || new Date(r.booking_date).getTime() >= overdueThreshold.getTime()).length,
                overdue: allMemory.filter((r) => r.booking_date && new Date(r.booking_date).getTime() < overdueThreshold.getTime() && r.status !== 'completed' && r.status !== 'cancelled').length,
                pending: allMemory.filter((r) => r.status === 'pending').length,
                confirmed: allMemory.filter((r) => r.status === 'confirmed').length,
                completed: allMemory.filter((r) => r.status === 'completed').length,
                cancelled: allMemory.filter((r) => r.status === 'cancelled').length,
              },
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
    async (request: FastifyRequest<{ Body: { customerId: string; rawText: string } }>, reply: FastifyReply) => {
      const { customerId, rawText } = request.body || {};
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
        const reservation = await prisma.reservation.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            customer_id: customerId,
            treatment_category: parsed.treatmentCategory,
            treatment_detail: parsed.treatmentDetail,
            booking_date: parsed.bookingDate,
            raw_text: rawText,
            status: 'pending',
          },
        });

        const parsedCustomer = await customerService.getCustomerById(customerId, DEFAULT_TENANT_ID);
        const { reservationLifecycleService } = await import('../../services/reservation-lifecycle.service');
        await reservationLifecycleService.onReservationCreated({
          customerId,
          reservationId: reservation.id,
          tenantId: DEFAULT_TENANT_ID,
          chatId: parsedCustomer?.phone ? `${parsedCustomer.phone}@c.us` : '',
          babies: parsed.babies || [],
          customerName: parsed.name,
          kecamatan: parsed.kec,
          kota: parsed.kota,
          kelurahan: parsed.address,
          address: parsed.address,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_RESERVATION',
          targetId: reservation.id,
          payload: { customerId, rawText },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        const mockReservation = {
          id: `res_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          tenant_id: DEFAULT_TENANT_ID,
          customer_id: customerId,
          treatment_category: parsed.treatmentCategory,
          treatment_detail: parsed.treatmentDetail,
          booking_date: parsed.bookingDate,
          raw_text: rawText,
          status: 'pending',
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
          status?: 'pending' | 'confirmed';
          notes?: string;
          babies?: Array<{ name: string; ageText?: string }>;
          purchaseValue?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { customerId, treatmentCategory, treatmentDetail, bookingDate, assignedStaffId, status, notes, babies, purchaseValue } = request.body || {};

      if (!customerId || !treatmentCategory || !treatmentDetail) {
        return reply.status(400).send({ error: 'customerId, treatmentCategory, dan treatmentDetail wajib diisi.' });
      }
      if (!['BABY', 'MOMS', 'BOTH', 'KIDS', 'BUNDLE'].includes(treatmentCategory)) {
        return reply.status(400).send({ error: 'treatmentCategory tidak valid.' });
      }

      const customer = await customerService.getCustomerById(customerId, DEFAULT_TENANT_ID);
      if (!customer) {
        return reply.status(404).send({ error: 'Customer tidak ditemukan.' });
      }

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

      const dbCategory: 'BABY' | 'MOMS' | 'BOTH' = 
        treatmentCategory === 'KIDS' ? 'BABY' : 
        treatmentCategory === 'BUNDLE' ? 'BOTH' : 
        (treatmentCategory as 'BABY' | 'MOMS' | 'BOTH');

      const reservationStatus = status === 'confirmed' ? 'confirmed' : 'pending';
      const rawNotes = notes ? `\nCatatan: ${notes}` : '';
      const finalPurchaseValue = purchaseValue !== undefined && purchaseValue !== null && !isNaN(Number(purchaseValue)) ? Number(purchaseValue) : null;

      try {
        const reservation = await prisma.reservation.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            customer_id: customerId,
            treatment_category: dbCategory,
            treatment_detail: treatmentDetail,
            booking_date: parsedDate,
            assigned_staff_id: assignedStaffId || null,
            purchase_value: finalPurchaseValue,
            raw_text: `[Admin Manual] ${treatmentCategory}: ${treatmentDetail}${rawNotes}`,
            status: reservationStatus,
          },
          include: {
            customer: { include: { children: true } },
            assigned_staff: { select: { id: true, name: true, phone: true } },
          },
        });

        const { reservationLifecycleService } = await import('../../services/reservation-lifecycle.service');
        await reservationLifecycleService.onReservationCreated({
          customerId,
          reservationId: reservation.id,
          tenantId: DEFAULT_TENANT_ID,
          chatId: `${customer.phone}@c.us`,
          babies: (babies || []).map((b) => ({ name: b.name, age: b.ageText || '' })),
          customerName: customer.name,
          kecamatan: customer.kecamatan || undefined,
          kota: customer.kota || undefined,
          kelurahan: customer.kelurahan || undefined,
        });

        if (assignedStaffId) {
          const { staffNotificationService } = await import('../../services/staff-notification.service');
          staffNotificationService.sendReservationAssignmentNotification(reservation.id, assignedStaffId).catch((err) => {
            console.error('[Admin API] Failed to send Telegram notification to assigned staff on create:', err.message);
          });
        }

        if (reservationStatus === 'confirmed' && parsedDate) {
          try {
            const { followUpService } = await import('../../services/follow-up.service');
            await followUpService.createReservationFollowUps({
              reservationId: reservation.id,
              customerId,
              bookingDate: parsedDate,
              treatmentCategory: dbCategory,
              tenantId: DEFAULT_TENANT_ID,
            });
          } catch (fuErr: any) {
            console.warn('[Admin API] Failed to create follow-ups for manual reservation:', fuErr.message);
          }
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_RESERVATION_MANUAL',
          targetId: reservation.id,
          payload: { customerId, treatmentCategory, assignedStaffId, status: reservationStatus, source: 'admin_panel' },
          ipAddress: request.ip,
        });

        return reply.status(201).send({ success: true, data: reservation });
      } catch (error: any) {
        const mockReservation = {
          id: `res_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          tenant_id: DEFAULT_TENANT_ID,
          customer_id: customerId,
          treatment_category: dbCategory,
          treatment_detail: treatmentDetail,
          booking_date: parsedDate,
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

  /**
   * GET /api/admin/reservation/:id
   * Ambil detail single reservation lengkap dengan customer, children, staff
   */
  fastify.get(
    '/api/admin/reservation/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const reservation = await prisma.reservation.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
          include: {
            customer: {
              include: {
                adClick: true,
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
        });
        if (!reservation) {
          // memory fallback
          const mem = memoryReservations.get(id);
          if (!mem) return reply.status(404).send({ success: false, error: 'Reservation tidak ditemukan' });
          return reply.status(200).send({ success: true, data: { ...mem, baby_details: extractBabyDetails(mem.raw_text) } });
        }
        return reply.status(200).send({
          success: true,
          data: { ...reservation, baby_details: extractBabyDetails(reservation.raw_text) },
        });
      } catch (err: any) {
        const mem = memoryReservations.get(id);
        if (mem) return reply.status(200).send({ success: true, data: { ...mem, baby_details: extractBabyDetails(mem.raw_text) } });
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation/:id/confirm
   */
  fastify.patch(
    '/api/admin/reservation/:id/confirm',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
          include: {
            customer: {
              include: {
                adClick: true,
              },
            },
          },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        let calendarEventId: string | null = null;
        try {
          const customerName = existing.customer?.name || 'Bunda';
          calendarEventId = await googleCalendarService.createEvent(existing, customerName);
        } catch (err) {
          console.error('[Admin API] Google Calendar Event creation failed:', err);
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: {
            status: 'confirmed',
            google_calendar_event_id: calendarEventId,
          },
        });

        if (existing.booking_date) {
          try {
            const { followUpService } = await import('../../services/follow-up.service');
            await followUpService.createReservationFollowUps({
              reservationId: id,
              customerId: existing.customer_id,
              bookingDate: existing.booking_date,
              treatmentCategory: existing.treatment_category,
              tenantId: existing.tenant_id || DEFAULT_TENANT_ID,
            });
          } catch (fuErr: any) {
            console.warn('[Admin API] Failed to schedule follow-ups on confirmation:', fuErr.message);
          }
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CONFIRM_RESERVATION',
          targetId: id,
          payload: { status: 'confirmed' },
          ipAddress: request.ip,
        });

        if (existing.customer) {
          resolveTreatmentValue(existing.treatment_detail)
            .then((value) => {
              capiService
                .sendCapiEvent({
                  eventName: 'Purchase',
                  customer: existing.customer,
                  adClick: existing.customer.adClick || undefined,
                  value,
                  currency: 'IDR',
                  tenantId: DEFAULT_TENANT_ID,
                  customData: { source: 'ADMIN_CONFIRM' },
                })
                .catch((err) => {
                  console.error('[CAPI ERROR] Failed to send Purchase event:', err.message);
                });
            })
            .catch(() => {});

          try {
            await prisma.reservation.update({
              where: { id },
              data: { purchase_event_sent_at: new Date() },
            });
          } catch (sentErr) {
            console.warn('[CAPI] Gagal set purchase_event_sent_at:', (sentErr as Error).message);
          }
        }

        if (process.env.ENABLE_LIFECYCLE_LABELS === 'true' && existing.customer?.phone) {
          const { wahaClient } = await import('../../integrations/waha/client');
          wahaClient
            .removeLabel(`${existing.customer.phone}@c.us`, 'pending payment')
            .catch((err: any) =>
              console.warn('[LIFECYCLE LABEL] removeLabel "pending payment" on confirm failed:', err.message)
            );
        }

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
          mock.status = 'confirmed';
          mock.google_calendar_event_id = `mock_cal_event_${Date.now()}`;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);

          if (mock.customer) {
            resolveTreatmentValue(mock.treatment_detail)
              .then((value) => {
                capiService
                  .sendCapiEvent({
                    eventName: 'Purchase',
                    customer: mock.customer,
                    adClick: mock.customer.adClick || undefined,
                    value,
                    currency: 'IDR',
                    tenantId: DEFAULT_TENANT_ID,
                    customData: { source: 'ADMIN_CONFIRM' },
                  })
                  .catch((err) => {
                    console.error('[CAPI MOCK ERROR] Failed to send Purchase event:', err.message);
                  });
              })
              .catch(() => {});
            mock.purchase_event_sent_at = new Date();
          }

          if (process.env.ENABLE_LIFECYCLE_LABELS === 'true' && mock.customer?.phone) {
            const { wahaClient } = await import('../../integrations/waha/client');
            wahaClient
              .removeLabel(`${mock.customer.phone}@c.us`, 'pending payment')
              .catch((err: any) =>
                console.warn(
                  '[LIFECYCLE LABEL] removeLabel "pending payment" on confirm (memory) failed:',
                  err.message
                )
              );
          }

          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation/:id/complete
   * Menandai reservasi telah selesai treatment (status: 'completed')
   */
  fastify.patch(
    '/api/admin/reservation/:id/complete',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: {
            status: 'completed',
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'COMPLETE_RESERVATION',
          targetId: id,
          payload: { status: 'completed' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
          mock.status = 'completed';
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation/:id
   * Edit lengkap rincian reservasi: data pasien, anak/bayi, jadwal, layanan, tarif, status, penugasan terapis, dll.
   */
  fastify.patch(
    '/api/admin/reservation/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          treatmentCategory?: 'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE';
          treatmentDetail?: string;
          bookingDate?: string | null;
          assignedStaffId?: string | null;
          purchaseValue?: number;
          status?: 'pending' | 'confirmed' | 'completed' | 'cancelled';
          notes?: string;
          rawText?: string;
          paymentMethod?: 'CASH' | 'TRANSFER' | 'QRIS' | null;
          customerName?: string;
          customerPhone?: string;
          address?: string;
          kecamatan?: string;
          kota?: string;
          kelurahan?: string;
          landmark?: string;
          babies?: Array<{ name: string; ageText?: string; birthDate?: string }>;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const body = request.body || {};
      const {
        treatmentCategory,
        treatmentDetail,
        bookingDate,
        assignedStaffId,
        purchaseValue,
        status,
        notes,
        rawText,
        paymentMethod,
        customerName,
        customerPhone,
        address,
        kecamatan,
        kota,
        kelurahan,
        landmark,
        babies,
      } = body;

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
          include: { customer: { include: { children: true } } },
        });

        if (!existing) {
          throw new Error('Reservation not found');
        }

        const updateData: any = {};
        if (treatmentCategory !== undefined) updateData.treatment_category = treatmentCategory;
        if (treatmentDetail !== undefined) updateData.treatment_detail = treatmentDetail;
        if (purchaseValue !== undefined) updateData.purchase_value = purchaseValue;
        if (status !== undefined) updateData.status = status;
        if (notes !== undefined) updateData.notes = notes;
        if (rawText !== undefined) updateData.raw_text = rawText;
        if (paymentMethod !== undefined) updateData.payment_method = paymentMethod;

        if (assignedStaffId !== undefined) {
          updateData.assigned_staff_id = assignedStaffId || null;
        }

        let parsedBookingDate: Date | null | undefined = undefined;
        if (bookingDate !== undefined) {
          if (bookingDate === null || bookingDate === '') {
            updateData.booking_date = null;
            parsedBookingDate = null;
          } else {
            const d = new Date(bookingDate);
            if (!isNaN(d.getTime())) {
              updateData.booking_date = d;
              parsedBookingDate = d;
            }
          }
        }

        const updated = await prisma.reservation.update({
          where: { id },
          data: updateData,
          include: {
            customer: {
              include: {
                children: true,
              },
            },
            assigned_staff: true,
          },
        });

        // Sync customer details if provided
        if (existing.customer_id && (customerName || customerPhone || address || kecamatan || kota || kelurahan || landmark)) {
          const custUpdate: any = {};
          if (customerName) custUpdate.name = customerName;
          if (customerPhone) custUpdate.phone = customerPhone.replace(/\D/g, '');
          if (address) custUpdate.address = address;
          if (kecamatan) custUpdate.kecamatan = kecamatan;
          if (kota) custUpdate.kota = kota;
          if (kelurahan) custUpdate.kelurahan = kelurahan;
          if (landmark) {
            const currentPrefs = (existing.customer?.preferences as any) || {};
            custUpdate.preferences = { ...currentPrefs, landmark };
          }
          await prisma.customer.update({
            where: { id: existing.customer_id },
            data: custUpdate,
          });
        }

        // Sync babies if provided
        if (existing.customer_id && Array.isArray(babies) && babies.length > 0) {
          for (const b of babies) {
            if (!b.name) continue;
            const existingChild = existing.customer?.children?.find((c: any) => c.name.toLowerCase() === b.name.toLowerCase());
            if (existingChild) {
              await prisma.child.update({
                where: { id: existingChild.id },
                data: {
                  raw_age_text: b.ageText || existingChild.raw_age_text,
                },
              });
            } else {
              await prisma.child.create({
                data: {
                  tenant_id: DEFAULT_TENANT_ID,
                  customer_id: existing.customer_id,
                  name: b.name,
                  raw_age_text: b.ageText || '',
                },
              });
            }
          }
        }

        // Google Calendar sync
        if (updated.google_calendar_event_id && parsedBookingDate) {
          try {
            const cName = customerName || existing.customer?.name || 'Bunda';
            await googleCalendarService.updateEvent(updated.google_calendar_event_id, updated, cName);
          } catch (gcErr) {
            console.error('[Admin API] Google Calendar Event update failed:', gcErr);
          }
        }

        // Reschedule follow-ups if date changed
        if (parsedBookingDate) {
          try {
            const { followUpService } = await import('../../services/follow-up.service');
            await followUpService.onReservationRescheduled(id, parsedBookingDate, existing.tenant_id || DEFAULT_TENANT_ID);
          } catch (fuErr: any) {
            console.warn('[Admin API] Failed to reschedule follow-ups on reservation edit:', fuErr.message);
          }
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_RESERVATION_DETAIL',
          targetId: id,
          payload: body,
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: updated });
      } catch (error: any) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
          if (treatmentCategory !== undefined) mock.treatment_category = treatmentCategory;
          if (treatmentDetail !== undefined) mock.treatment_detail = treatmentDetail;
          if (purchaseValue !== undefined) mock.purchase_value = purchaseValue;
          if (status !== undefined) mock.status = status;
          if (notes !== undefined) mock.notes = notes;
          if (rawText !== undefined) mock.raw_text = rawText;
          if (paymentMethod !== undefined) mock.payment_method = paymentMethod;
          if (assignedStaffId !== undefined) mock.assigned_staff_id = assignedStaffId;
          if (bookingDate !== undefined) mock.booking_date = bookingDate ? new Date(bookingDate) : null;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation/:id/status
   * Mengubah status reservasi secara fleksibel ('pending' | 'confirmed' | 'completed' | 'cancelled')
   */
  fastify.patch(
    '/api/admin/reservation/:id/status',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: 'pending' | 'confirmed' | 'completed' | 'cancelled' };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status } = request.body || {};

      if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
        return reply.status(400).send({ error: 'Status tidak valid. Pilihan: pending, confirmed, completed, cancelled.' });
      }

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: { status },
        });

        try {
          const { followUpService } = await import('../../services/follow-up.service');
          if (status === 'confirmed' && existing.booking_date) {
            await followUpService.createReservationFollowUps({
              reservationId: id,
              customerId: existing.customer_id,
              bookingDate: existing.booking_date,
              treatmentCategory: existing.treatment_category,
              tenantId: existing.tenant_id || DEFAULT_TENANT_ID,
            });
          } else if (status === 'cancelled') {
            await followUpService.onReservationCancelled(id, existing.tenant_id || DEFAULT_TENANT_ID);
          }
        } catch (fuErr: any) {
          console.warn('[Admin API] Failed to sync follow-ups on status update:', fuErr.message);
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_RESERVATION_STATUS',
          targetId: id,
          payload: { status },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
          mock.status = status;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation/:id/set-date
   */
  fastify.patch(
    '/api/admin/reservation/:id/set-date',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { bookingDate: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { bookingDate } = request.body || {};
      if (!bookingDate) {
        return reply.status(400).send({ error: 'bookingDate is required' });
      }

      const parsedDate = new Date(bookingDate);
      if (isNaN(parsedDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid date format. Use ISO string or YYYY-MM-DD.' });
      }

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
          include: { customer: true },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: { booking_date: parsedDate },
        });

        try {
          const { followUpService } = await import('../../services/follow-up.service');
          await followUpService.onReservationRescheduled(id, parsedDate, existing.tenant_id || DEFAULT_TENANT_ID);
        } catch (fuErr: any) {
          console.warn('[Admin API] Failed to reschedule follow-ups on date update:', fuErr.message);
        }

        if (reservation.google_calendar_event_id) {
          try {
            const customerName = existing.customer?.name || 'Bunda';
            await googleCalendarService.updateEvent(reservation.google_calendar_event_id, reservation, customerName);
          } catch (err) {
            console.error('[Admin API] Google Calendar Event update failed:', err);
          }
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'SET_RESERVATION_DATE',
          targetId: id,
          payload: { bookingDate },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
          mock.booking_date = parsedDate;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * PUT /api/admin/reservation/:id/proof
   * Upload / hapus bukti bayar dari modal Manage reservasi.
   * Gambar dikompres max 800px (sharp) lalu disimpan sebagai media outbound
   * tenant (inline MQL & retensi media). remove=true menghapus proof_url.
   */
  fastify.put(
    '/api/admin/reservation/:id/proof',
    { bodyLimit: 12 * 1024 * 1024 },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { imageB64?: string; mimeType?: string; fileName?: string; remove?: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { imageB64, mimeType, fileName, remove } = request.body || {};

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        let proofUrl: string | null = null;
        if (!remove && imageB64) {
          const { mediaService } = await import('../../services/media.service');
          const rawB64 = imageB64.replace(/^data:image\/[^;]+;base64,/, '');
          const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
          const saved = await mediaService.saveOutboundMedia({
            tenantId: DEFAULT_TENANT_ID,
            imageB64: resized.toString('base64'),
            mimeType: mimeType && mimeType !== 'application/octet-stream' ? mimeType : 'image/jpeg',
            fileName: fileName || `proof-${id}.jpg`,
          });
          proofUrl = saved.hdUrl;
        }

        const updated = await prisma.reservation.update({
          where: { id },
          data: { proof_url: proofUrl },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: remove ? 'ADMIN_REMOVE_PROOF' : 'ADMIN_UPLOAD_PROOF',
          targetId: id,
          payload: remove ? { removed: true } : { proofUrl },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: updated });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
          mock.proof_url = remove ? null : mock.proof_url;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * PATCH /api/admin/reservation/:id/assign-staff
   * Menugaskan atau mengubah penugasan staff (terapis) pada reservasi.
   */
  fastify.patch(
    '/api/admin/reservation/:id/assign-staff',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { assigned_staff_id?: string | null } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { assigned_staff_id } = request.body || {};

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
          include: { customer: true },
        });
        if (!existing) {
          return reply.status(404).send({ success: false, error: 'Reservasi tidak ditemukan.' });
        }

        let staffName: string | null = null;
        if (assigned_staff_id) {
          const staff = await prisma.staff.findFirst({
            where: { id: assigned_staff_id, tenant_id: DEFAULT_TENANT_ID },
            select: { id: true, name: true },
          });
          if (!staff) {
            return reply.status(400).send({ success: false, error: 'Staff yang dipilih tidak valid.' });
          }
          staffName = staff.name;
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: { assigned_staff_id: assigned_staff_id || null },
          include: {
            assigned_staff: {
              select: { id: true, name: true, phone: true },
            },
          },
        });

        if (assigned_staff_id) {
          const { staffNotificationService } = await import('../../services/staff-notification.service');
          staffNotificationService.sendReservationAssignmentNotification(id, assigned_staff_id).catch((err) => {
            console.error('[Admin API] Failed to send Telegram notification to assigned staff:', err.message);
          });
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'ASSIGN_RESERVATION_STAFF',
          targetId: id,
          payload: { assigned_staff_id, staffName },
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error: any) {
        console.error('[Admin API] Failed to assign staff to reservation:', error.message);
        return reply.status(500).send({ success: false, error: 'Gagal menugaskan staff ke reservasi.' });
      }
    }
  );

  /**
   * DELETE /api/admin/reservation/:id
   * Mendukung soft-cancel (default) atau hard delete permanen (?hard=true)
   */
  fastify.delete(
    '/api/admin/reservation/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { hard?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const isHardDelete = request.query?.hard === 'true';
      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
          include: { customer: true },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        if (existing.google_calendar_event_id) {
          try {
            await googleCalendarService.deleteEvent(existing.google_calendar_event_id);
          } catch (err) {
            console.error('[Admin API] Google Calendar Event deletion failed:', err);
          }
        }

        if (isHardDelete) {
          // Unlink child relation jika ada
          await prisma.child.updateMany({
            where: { reservation_id: id },
            data: { reservation_id: null },
          }).catch(() => {});

          await prisma.reservation.delete({
            where: { id },
          });

          await auditService.logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'DELETE_RESERVATION_PERMANENT',
            targetId: id,
            payload: { hard: true },
            ipAddress: request.ip,
          });

          return reply.status(200).send({ success: true, message: 'Reservasi berhasil dihapus permanen.' });
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: { status: 'cancelled' },
        });

        const activeNoPurchaseFollowUps = await prisma.followUp.findFirst({
          where: {
            customer_id: existing.customer_id,
            type: 'NO_PURCHASE',
            status: { in: ['PENDING', 'QUEUED'] },
            tenant_id: DEFAULT_TENANT_ID,
          },
        });

        if (!activeNoPurchaseFollowUps) {
          const stages = [1, 2, 3];
          const days = [3, 7, 14];

          await Promise.all(
            stages.map((stage, idx) => {
              const scheduledAt = new Date();
              scheduledAt.setDate(scheduledAt.getDate() + days[idx]);

              return prisma.followUp.create({
                data: {
                  tenant_id: DEFAULT_TENANT_ID,
                  customer_id: existing.customer_id,
                  type: 'NO_PURCHASE',
                  stage,
                  scheduled_at: scheduledAt,
                  status: 'PENDING',
                },
              });
            })
          );
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CANCEL_RESERVATION',
          targetId: id,
          payload: { status: 'cancelled' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
          if (isHardDelete) {
            memoryReservations.delete(id);
            return reply.status(200).send({ success: true, message: 'Reservasi berhasil dihapus permanen (memory).' });
          }
          mock.status = 'cancelled';
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );

  /**
   * POST /api/admin/reservation/:id/approve-purchase
   * Moderasi outlier: admin menyetujui event Purchase yang ditahan queue
   * (purchase_review_status='pending'). Event dikirim ke Meta CAPI dengan
   * event_time HISTORIS (purchase_occurred_at) agar attribution akurat.
   * Event >7 hari ditolak — Meta akan drop event yang terlalu lama.
  /**
   * POST /api/admin/reservation/:id/approve-purchase
   * Moderasi outlier: admin menyetujui event Purchase yang ditahan queue
   * (purchase_review_status='pending'). Event dikirim ke Meta CAPI dengan
   * event_time HISTORIS (purchase_occurred_at) agar attribution akurat.
   * Event >7 hari ditolak — Meta akan drop event yang terlalu lama.
   */
  fastify.post(
    '/api/admin/reservation/:id/approve-purchase',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        if (id.startsWith('lead_')) {
          const customerId = id.replace('lead_', '');
          const customer = await prisma.customer.findFirst({
            where: { id: customerId, tenant_id: DEFAULT_TENANT_ID },
            include: { adClick: true },
          });
          if (!customer) {
            return reply.status(404).send({ success: false, error: 'Customer not found' });
          }
          const occurredDate = customer.mql_triggered_at || customer.created_at || new Date();
          const occurredAt = new Date(occurredDate);

          capiService
            .sendCapiEvent({
              eventName: 'Lead',
              customer,
              adClick: customer.adClick || undefined,
              tenantId: DEFAULT_TENANT_ID,
              eventTime: Math.floor(occurredAt.getTime() / 1000),
              customData: {
                source: 'ADMIN_MODERATION_APPROVE_LEAD',
                mql_bubble_count: customer.mql_bubble_count || 5,
              },
            })
            .then((result) => {
              if (!result.success) {
                console.error(`[CAPI ERROR] Approved Lead send failed for ${id}: ${result.message}`);
              }
            })
            .catch((err) => {
              console.error('[CAPI ERROR] Failed to send approved Lead event:', err.message);
            });

          await auditService.logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'MQL_LEAD_EVENT_SENT',
            targetId: customerId,
            payload: { mql_triggered_at: occurredAt.toISOString() },
            ipAddress: request.ip,
          });

          return reply.status(200).send({ success: true, message: 'Lead event disetujui & dikirim ke Meta CAPI' });
        }

        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
          include: {
            customer: {
              include: { adClick: true },
            },
          },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }
        if (existing.purchase_review_status !== 'pending') {
          return reply.status(400).send({
            success: false,
            error: `Purchase event sudah diproses (status: ${existing.purchase_review_status}).`,
          });
        }

        const occurredDate = existing.purchase_occurred_at || existing.created_at || new Date();
        const occurredAt = new Date(occurredDate);
        const daysOld = Math.floor((Date.now() - occurredAt.getTime()) / (24 * 60 * 60 * 1000));
        let warning: string | undefined;
        if (daysOld > 7) {
          warning = `Event terjadi ${daysOld} hari lalu (>7 hari). Meta CAPI kemungkinan akan mengabaikan event ini.`;
        }

        const body = (request.body || {}) as { customPayload?: any };
        const customPayload = body.customPayload;

        const formats = await getTenantCapiFormats(DEFAULT_TENANT_ID);
        
        let autoResolvedVal = existing.purchase_value && existing.purchase_value > 0 ? existing.purchase_value : undefined;
        if (!autoResolvedVal) {
          const raw = existing.raw_text || '';
          if (raw && /payment|pembayaran|total\s*[:=]|treatment\s*[:=]/i.test(raw)) {
            try {
              const { parsePaymentSection } = await import('../../utils/conversation-transaction-extractor');
              const fin = parsePaymentSection(raw);
              if (fin.treatmentPrice > 0) autoResolvedVal = fin.treatmentPrice;
              else if (fin.totalPrice > 0) autoResolvedVal = Math.max(0, fin.totalPrice - fin.ongkir + fin.promo);
            } catch {}
          }
          if (!autoResolvedVal) {
            autoResolvedVal =
              extractValueByFormat(raw, formats.formatValue) ??
              extractRupiahAmount(raw, formats.formatValue) ??
              (await resolveTreatmentValue(existing.treatment_detail || raw));
          }
        }

        const resolvedVal = (customPayload && typeof customPayload.custom_data?.value === 'number')
          ? customPayload.custom_data.value
          : (autoResolvedVal ?? 60000);

        const eventName = (customPayload && typeof customPayload.event_name === 'string')
          ? customPayload.event_name
          : 'Purchase';

        const eventTime = (customPayload && typeof customPayload.event_time === 'number')
          ? customPayload.event_time
          : Math.floor(occurredAt.getTime() / 1000);

        const customData = customPayload?.custom_data
          ? {
              ...customPayload.custom_data,
              source: 'ADMIN_MODERATION_APPROVE_CUSTOM',
              reservationId: existing.id,
              purchaseOccurredAt: occurredAt.toISOString(),
            }
          : {
              source: 'ADMIN_MODERATION_APPROVE',
              reservationId: existing.id,
              purchaseOccurredAt: occurredAt.toISOString(),
            };

        // Jika nama customer masih generic (misal "Mbak" / "Bunda"), update nama customer di DB dari raw_text
        if (existing.raw_text && existing.customer) {
          try {
            const { parseReservationText } = await import('../../utils/reservation-text-parser');
            const pr = parseReservationText(existing.raw_text);
            if (pr.success && pr.reservation?.name) {
              const cleanName = pr.reservation.name.replace(/^(?:bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.)\s+/i, '').trim();
              if (cleanName && !['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'pasien', 'customer', '-'].includes(cleanName.toLowerCase())) {
                const kec = pr.reservation.kec || existing.customer.kecamatan || '';
                const formattedName = `Bunda ${cleanName}${kec ? ` ${kec}` : ''}`.trim();
                const { customerService } = await import('../../services/customer.service');
                await customerService.updateCustomerName(existing.customer.id, formattedName, DEFAULT_TENANT_ID).catch(() => {});
                existing.customer.name = formattedName;
              }
            }
          } catch {}
        }

        capiService
          .sendCapiEvent({
            eventName,
            customer: existing.customer,
            adClick: existing.customer?.adClick || undefined,
            value: resolvedVal,
            currency: customPayload?.custom_data?.currency || 'IDR',
            tenantId: DEFAULT_TENANT_ID,
            eventTime,
            customData,
          })
          .then((result) => {
            if (!result.success) {
              console.error(`[CAPI ERROR] Approved Purchase send failed for ${id}: ${result.message}`);
            }
          })
          .catch((err) => {
            console.error('[CAPI ERROR] Failed to send approved Purchase event:', err.message);
          });

        const reservation = await prisma.reservation.update({
          where: { id },
          data: {
            purchase_occurred_at: occurredDate,
            purchase_value: resolvedVal ?? undefined,
            purchase_review_status: 'approved',
            purchase_event_sent_at: new Date(),
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'APPROVE_PURCHASE_EVENT',
          targetId: id,
          payload: { purchase_occurred_at: occurredAt.toISOString(), value: resolvedVal },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation, warning });
      } catch (error) {
        console.error('[CAPI APPROVE ERROR]', (error as Error).message);
        // Fallback in-memory hanya untuk dev/test — di production harus fail agar UI tidak tampil success palsu
        if (process.env.NODE_ENV !== 'production') {
          const mock = memoryReservations.get(id);
          if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
            mock.purchase_review_status = 'approved';
            mock.purchase_event_sent_at = new Date();
            mock.updated_at = new Date();
            memoryReservations.set(id, mock);
            return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
          }
        }
        const msg = (error as Error).message || 'Reservation not found';
        const status = msg.includes('not found') || msg.includes('Not found') ? 404 : 500;
        return reply.status(status).send({ success: false, error: msg });
      }
    }
  );

  /**
    * POST /api/admin/reservation/:id/reject-purchase
   * Moderasi outlier: admin menandai transaksi sebagai outlier / dibatalkan
   * (purchase_review_status='ignored_outlier'). Event TIDAK dikirim ke Meta CAPI
   * agar tidak mencemari data optimasi Ads Manager.
   */
  fastify.post(
    '/api/admin/reservation/:id/reject-purchase',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        if (id.startsWith('lead_')) {
          const customerId = id.replace('lead_', '');
          await auditService.logAdminAction({
            apiKey: (request as any).adminKeyUsed,
            adminIdentity: (request as any).adminIdentity,
            action: 'MQL_LEAD_EVENT_REJECTED',
            targetId: customerId,
            payload: { reason: 'ADMIN_MANUAL_OUTLIER_REJECT' },
            ipAddress: request.ip,
          });

          return reply.status(200).send({ success: true, message: 'Lead event diabaikan' });
        }

        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
          include: {
            customer: {
              include: { adClick: true },
            },
          },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }
        if (existing.purchase_review_status !== 'pending') {
          return reply.status(400).send({
            success: false,
            error: `Purchase event sudah diproses (status: ${existing.purchase_review_status}).`,
          });
        }

        const reservation = await prisma.reservation.update({
          where: { id },
          data: { purchase_review_status: 'ignored_outlier' },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'REJECT_PURCHASE_OUTLIER',
          targetId: id,
          payload: { reason: 'ADMIN_MANUAL_OUTLIER_REJECT' },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error) {
        console.error('[CAPI REJECT ERROR]', (error as Error).message);
        if (process.env.NODE_ENV !== 'production') {
          const mock = memoryReservations.get(id);
          if (mock && mock.tenant_id === DEFAULT_TENANT_ID) {
            mock.purchase_review_status = 'ignored_outlier';
            mock.updated_at = new Date();
            memoryReservations.set(id, mock);
            return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
          }
        }
        const msg = (error as Error).message || 'Reservation not found';
        const status = msg.includes('not found') || msg.includes('Not found') ? 404 : 500;
        return reply.status(status).send({ success: false, error: msg });
      }
    }
  );

  /**
    * GET /api/admin/capi-queue
   * Meja kerja Advertiser (Meta CAPI Queue): daftar reservasi & lead yang masuk ke sistem
   * beserta data atribusi (paid/organic + UTM) dan estimasi sisa usia event sebelum Meta drop (7 hari).
   */
  fastify.get('/api/admin/capi-queue', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    reply.header('Pragma', 'no-cache');
    try {
      const rows = await prisma.reservation.findMany({
        where: {
          tenant_id: DEFAULT_TENANT_ID,
          status: { not: 'cancelled' },
        },
        orderBy: { created_at: 'desc' },
        include: {
          customer: {
            include: { adClick: true, children: true },
          },
        },
      });

      const formats = await getTenantCapiFormats(DEFAULT_TENANT_ID);
      const now = Date.now();

      let tenantLandingDomain = '';
      try {
        const tenant = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
        if ((tenant as any)?.landing_domain) {
          tenantLandingDomain = (tenant as any).landing_domain.trim();
        }
      } catch {}

      const reservationData = await Promise.all(
        rows.map(async (r) => {
          const occurredDate = r.purchase_occurred_at || r.created_at || new Date();
          const occurredAt = new Date(occurredDate).getTime();
          const ageMs = Math.max(0, now - occurredAt);
          const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
          const daysOld = Math.floor(ageMs / (24 * 60 * 60 * 1000));

          // Sanitize treatment_detail on the fly (hapus part yang berisi placeholder teks template)
          let sanitizedTreatmentDetail = r.treatment_detail || '';
          if (
            sanitizedTreatmentDetail.includes('Mohon bisa diisi') ||
            sanitizedTreatmentDetail.includes('bisa diisi Bunda') ||
            sanitizedTreatmentDetail.toLowerCase().includes('jika hamil') ||
            sanitizedTreatmentDetail.toLowerCase().includes('jika ada')
          ) {
            const parts = sanitizedTreatmentDetail.split('|').map(p => p.trim());
            const filtered = parts.filter(p => {
              const low = p.toLowerCase();
              return (
                !low.includes('mohon bisa diisi') &&
                !low.includes('bisa diisi bunda') &&
                !low.includes('jika hamil') &&
                !low.includes('jika ada')
              );
            });
            sanitizedTreatmentDetail = filtered.length > 0 ? filtered.join(' | ') : 'Treatment Homecare';
          }

          let calculatedValue = r.purchase_value && r.purchase_value > 0 ? r.purchase_value : undefined;
          if (!calculatedValue) {
            const raw = r.raw_text || '';
            if (raw && /payment|pembayaran|total\s*[:=]|treatment\s*[:=]/i.test(raw)) {
              try {
                const { parsePaymentSection } = await import('../../utils/conversation-transaction-extractor');
                const fin = parsePaymentSection(raw);
                if (fin.treatmentPrice > 0) calculatedValue = fin.treatmentPrice;
                else if (fin.totalPrice > 0) calculatedValue = Math.max(0, fin.totalPrice - fin.ongkir + fin.promo);
              } catch {}
            }
            if (!calculatedValue) {
              calculatedValue =
                extractValueByFormat(raw, formats.formatValue) ??
                extractRupiahAmount(raw, formats.formatValue) ??
                (await resolveTreatmentValue(sanitizedTreatmentDetail || raw));
            }
          }

          const value = calculatedValue ?? 60000;

          // Self-heal purchase_value in DB if previously null/0 or stored as total price (including ongkir)
          if (r.id && value > 0 && r.purchase_value !== value) {
            prisma.reservation
              .update({
                where: { id: r.id },
                data: { purchase_value: value },
              })
              .catch(() => {});
          }

          let distanceKm = r.customer?.distance_km ? `${r.customer.distance_km} km` : null;
          if (!distanceKm && r.raw_text) {
            const m = r.raw_text.match(/ongkir\s*([\d.,]+)\s*km/i);
            if (m && m[1]) distanceKm = `${m[1]} km`;
          }

          const rawLandingUrl = r.customer?.adClick?.landingUrl || null;
          const canonicalLandingUrl = resolveCanonicalLandingUrl(rawLandingUrl, tenantLandingDomain) || rawLandingUrl;

          // Self-heal AdClick record in DB if landingUrl was legacy /cta
          if (r.customer?.adClick?.id && canonicalLandingUrl && canonicalLandingUrl !== rawLandingUrl) {
            prisma.adClick
              .update({
                where: { id: r.customer.adClick.id },
                data: { landingUrl: canonicalLandingUrl },
              })
              .catch(() => {});
          }

          const childName = (r.customer as any)?.children?.[0]?.name || null;

          return {
            id: r.id,
            status: r.status,
            eventType: 'Purchase',
            treatment_detail: sanitizedTreatmentDetail,
            raw_text: r.raw_text,
            child_name: childName,
            purchase_occurred_at: r.purchase_occurred_at || r.created_at,
            purchase_event_sent_at: r.purchase_event_sent_at,
            purchase_review_status: r.purchase_review_status || 'pending',
            value: value ?? 0,
            distanceKm,
            customer: {
              id: r.customer?.id,
              name: r.customer?.name || 'Bunda',
              phone: r.customer?.phone || '',
              kota: r.customer?.kota || (r.customer as any)?.pending_kota || null,
              kecamatan: r.customer?.kecamatan || (r.customer as any)?.pending_kecamatan || null,
              zipcode: r.customer?.zipcode || (r.customer as any)?.pending_zipcode || null,
            },
            attribution: {
              isPaid: !!r.customer?.adClick,
              trackingCode: r.customer?.adClick?.trackingCode || null,
              landingUrl: canonicalLandingUrl,
              fbp: r.customer?.adClick?.fbp || null,
              fbc: r.customer?.adClick?.fbc || null,
              fbclid: r.customer?.adClick?.fbclid || null,
              ipAddress: r.customer?.adClick?.ipAddress || null,
              userAgent: r.customer?.adClick?.userAgent || null,
            },
            utm: {
              campaign: r.customer?.adClick?.utmCampaign || null,
              source: r.customer?.adClick?.utmSource || null,
              medium: r.customer?.adClick?.utmMedium || null,
            },
            ageHours,
            daysOld,
            expiresInDays: Math.max(0, 7 - daysOld),
            metaDropRisk: daysOld > 7,
          };
        })
      );

      // Unsent MQL Leads
      let mqlLeadItems: any[] = [];
      try {
        const leadAuditLogs = await prisma.auditLog.findMany({
          where: {
            tenant_id: DEFAULT_TENANT_ID,
            action: { in: ['MQL_LEAD_EVENT_SENT', 'MQL_LEAD_EVENT_REJECTED'] },
          },
          select: { target_id: true },
        });
        const processedCustomerIds: string[] = Array.from(
          new Set(
            leadAuditLogs
              .map((a) => a.target_id)
              .filter((id): id is string => typeof id === 'string' && id.length > 0)
          )
        );

        const unsentMqlCustomers = await prisma.customer.findMany({
          where: {
            tenant_id: DEFAULT_TENANT_ID,
            OR: [
              { is_mql: true },
              { mql_bubble_count: { gte: 5 } },
            ],
            id: { notIn: processedCustomerIds },
          },
          include: {
            adClick: true,
          },
          orderBy: { created_at: 'desc' },
          take: 20,
        });

        mqlLeadItems = unsentMqlCustomers.map((c: any) => {
          const occurredDate = c.mql_triggered_at || c.created_at || new Date();
          const occurredAt = new Date(occurredDate).getTime();
          const ageMs = Math.max(0, now - occurredAt);
          const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
          const daysOld = Math.floor(ageMs / (24 * 60 * 60 * 1000));

          const rawLandingUrl = c.adClick?.landingUrl || null;
          const canonicalLandingUrl = resolveCanonicalLandingUrl(rawLandingUrl, tenantLandingDomain) || rawLandingUrl;

          // Self-heal AdClick record in DB if landingUrl was legacy /cta
          if (c.adClick?.id && canonicalLandingUrl && canonicalLandingUrl !== rawLandingUrl) {
            prisma.adClick
              .update({
                where: { id: c.adClick.id },
                data: { landingUrl: canonicalLandingUrl },
              })
              .catch(() => {});
          }

          return {
            id: `lead_${c.id}`,
            status: 'mql_lead',
            eventType: 'Lead',
            treatment_detail: 'Lead Prospek MQL (Percakapan Aktif)',
            raw_text: `Customer teridentifikasi MQL (${c.mql_bubble_count || 5}+ pesan)`,
            purchase_occurred_at: occurredDate,
            purchase_event_sent_at: null,
            purchase_review_status: 'pending',
            value: 0,
            distanceKm: c.distance_km ? `${c.distance_km} km` : null,
            customer: {
              name: c.name || 'Bunda',
              phone: c.phone || '',
            },
            attribution: {
              isPaid: !!c.adClick,
              trackingCode: c.adClick?.trackingCode || null,
              landingUrl: canonicalLandingUrl,
            },
            utm: {
              campaign: c.adClick?.utmCampaign || null,
              source: c.adClick?.utmSource || null,
              medium: c.adClick?.utmMedium || null,
            },
            ageHours,
            daysOld,
            expiresInDays: Math.max(0, 7 - daysOld),
            metaDropRisk: daysOld > 7,
          };
        });
      } catch (leadErr) {
        console.warn('[CAPI QUEUE] Could not fetch unsent MQL leads:', leadErr);
      }

      const data = [...reservationData, ...mqlLeadItems];
      const pending = data.filter((d) => d.purchase_review_status === 'pending').length;

      return reply.status(200).send({ success: true, data, total: data.length, pending });
    } catch (err: any) {
      const rows = Array.from(memoryReservations.values()).filter((r) => r.status !== 'cancelled');
      return reply.status(200).send({
        success: true,
        data: rows,
        total: rows.length,
        pending: rows.filter((r) => (r.purchase_review_status || 'pending') === 'pending').length,
        note: 'Fallback in-memory mode (DB offline)',
      });
    }
  });
}
