import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { customerService } from '../../services/customer.service';
import { googleCalendarService } from '../../services/google-calendar.service';
import { capiService, resolveTreatmentValue } from '../../services/capi.service';
import { parseReservationText, extractBabyDetails } from '../../utils/reservation-text-parser';
import { memoryReservations } from './stores';

export async function reservationAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/reservations/count
   */
  fastify.get('/api/admin/reservations/count', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const count = await prisma.reservation.count({
        where: { tenant_id: DEFAULT_TENANT_ID },
      });
      return reply.status(200).send({ success: true, count });
    } catch (err: any) {
      return reply.status(200).send({ success: true, count: memoryReservations.size });
    }
  });

  /**
   * GET /api/admin/reservations
   */
  fastify.get(
    '/api/admin/reservations',
    async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string } }>, reply: FastifyReply) => {
      const page = Math.max(1, parseInt(request.query?.page || '1', 10) || 1);
      const pageSize = Math.min(500, Math.max(1, parseInt(request.query?.pageSize || '100', 10) || 100));
      try {
        const where = { tenant_id: DEFAULT_TENANT_ID };
        const [rows, total] = await Promise.all([
          prisma.reservation.findMany({
            where,
            include: {
              customer: {
                include: { children: true },
              },
            },
            orderBy: {
              created_at: 'desc',
            },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          prisma.reservation.count({ where }),
        ]);

        const { computeCurrentAge } = await import('../../utils/age-calculator');
        const data = rows.map((r) => ({
          ...r,
          baby_details: extractBabyDetails(r.raw_text),
          customer: r.customer
            ? {
                ...r.customer,
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
        return reply.status(200).send({
          success: true,
          data,
          total,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        });
      } catch (err: any) {
        try {
          console.warn('[Admin API] Reservations query failed, retrying without children relation:', err.message);
          const rows = await prisma.reservation.findMany({
            where: { tenant_id: DEFAULT_TENANT_ID },
            include: { customer: true },
            orderBy: { created_at: 'desc' },
          });
          const data = rows.map((r) => ({
            ...r,
            baby_details: extractBabyDetails(r.raw_text),
            customer: r.customer ? { ...r.customer, children: [] } : undefined,
          }));
          return reply
            .status(200)
            .send({ success: true, data, total: data.length, page: 1, pageSize: data.length, totalPages: 1 });
        } catch (err2: any) {
          console.warn('[Admin API] Database error fetching reservations, falling back to memory:', err2.message);
          const data = Array.from(memoryReservations.values()).map((r) => ({
            ...r,
            baby_details: extractBabyDetails(r.raw_text),
          }));
          return reply
            .status(200)
            .send({ success: true, data, total: data.length, page: 1, pageSize: data.length, totalPages: 1 });
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
          treatmentCategory: 'BABY' | 'MOMS' | 'BOTH';
          treatmentDetail: string;
          bookingDate?: string;
          babies?: Array<{ name: string; ageText?: string }>;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { customerId, treatmentCategory, treatmentDetail, bookingDate, babies } = request.body || {};

      if (!customerId || !treatmentCategory || !treatmentDetail) {
        return reply.status(400).send({ error: 'customerId, treatmentCategory, dan treatmentDetail wajib diisi.' });
      }
      if (!['BABY', 'MOMS', 'BOTH'].includes(treatmentCategory)) {
        return reply.status(400).send({ error: 'treatmentCategory harus BABY, MOMS, atau BOTH.' });
      }

      const customer = await customerService.getCustomerById(customerId, DEFAULT_TENANT_ID);
      if (!customer) {
        return reply.status(404).send({ error: 'Customer tidak ditemukan.' });
      }

      const parsedDate = bookingDate ? new Date(bookingDate) : null;
      if (bookingDate && parsedDate && isNaN(parsedDate.getTime())) {
        return reply.status(400).send({ error: 'Format bookingDate tidak valid.' });
      }

      try {
        const reservation = await prisma.reservation.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            customer_id: customerId,
            treatment_category: treatmentCategory,
            treatment_detail: treatmentDetail,
            booking_date: parsedDate,
            raw_text: `[Admin Manual] ${treatmentCategory}: ${treatmentDetail}`,
            status: 'pending',
          },
        });

        const { reservationLifecycleService } = await import('../../services/reservation-lifecycle.service');
        await reservationLifecycleService.onReservationCreated({
          customerId,
          reservationId: reservation.id,
          tenantId: DEFAULT_TENANT_ID,
          chatId: `${customer.phone}@c.us`,
          babies: (babies || []).map((b) => ({ name: b.name, age: b.ageText || '' })),
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_RESERVATION_MANUAL',
          targetId: reservation.id,
          payload: { customerId, treatmentCategory, source: 'admin_panel' },
          ipAddress: request.ip,
        });

        return reply.status(201).send({ success: true, data: reservation });
      } catch (error: any) {
        const mockReservation = {
          id: `res_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          tenant_id: DEFAULT_TENANT_ID,
          customer_id: customerId,
          treatment_category: treatmentCategory,
          treatment_detail: treatmentDetail,
          booking_date: parsedDate,
          raw_text: `[Admin Manual] ${treatmentCategory}: ${treatmentDetail}`,
          status: 'pending',
          created_at: new Date(),
          updated_at: new Date(),
        };
        memoryReservations.set(mockReservation.id, mockReservation);
        return reply.status(201).send({ success: true, data: mockReservation, note: 'Fallback in-memory mode' });
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
   * DELETE /api/admin/reservation/:id
   */
  fastify.delete(
    '/api/admin/reservation/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
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
          mock.status = 'cancelled';
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({ success: true, data: mock, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }
    }
  );
}
