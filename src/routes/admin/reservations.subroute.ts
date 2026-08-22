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
          treatmentCategory: 'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE';
          treatmentDetail: string;
          bookingDate?: string;
          assignedStaffId?: string;
          status?: 'pending' | 'confirmed';
          notes?: string;
          babies?: Array<{ name: string; ageText?: string }>;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { customerId, treatmentCategory, treatmentDetail, bookingDate, assignedStaffId, status, notes, babies } = request.body || {};

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

      try {
        const reservation = await prisma.reservation.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            customer_id: customerId,
            treatment_category: dbCategory,
            treatment_detail: treatmentDetail,
            booking_date: parsedDate,
            assigned_staff_id: assignedStaffId || null,
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
        });

        if (assignedStaffId) {
          const { staffNotificationService } = await import('../../services/staff-notification.service');
          staffNotificationService.sendReservationAssignmentNotification(reservation.id, assignedStaffId).catch((err) => {
            console.error('[Admin API] Failed to send Telegram notification to assigned staff on create:', err.message);
          });
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

        const formats = await getTenantCapiFormats(DEFAULT_TENANT_ID);
        const resolvedVal =
          extractValueByFormat(existing.raw_text || '', formats.formatValue) ??
          existing.purchase_value ??
          extractRupiahAmount(existing.raw_text || '', formats.formatValue) ??
          (await resolveTreatmentValue(existing.treatment_detail || existing.raw_text));

        capiService
          .sendCapiEvent({
            eventName: 'Purchase',
            customer: existing.customer,
            adClick: existing.customer?.adClick || undefined,
            value: resolvedVal,
            currency: 'IDR',
            tenantId: DEFAULT_TENANT_ID,
            eventTime: Math.floor(occurredAt.getTime() / 1000),
            customData: {
              source: 'ADMIN_MODERATION_APPROVE',
              reservationId: existing.id,
              purchaseOccurredAt: occurredAt.toISOString(),
            },
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

          const value =
            extractValueByFormat(r.raw_text || '', formats.formatValue) ??
            r.purchase_value ??
            extractRupiahAmount(r.raw_text || '', formats.formatValue) ??
            (await resolveTreatmentValue(sanitizedTreatmentDetail || ''));

          // Self-heal purchase_value in DB if previously stored as total price (including ongkir)
          if (r.id && value !== undefined && r.purchase_value !== value) {
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
              name: r.customer?.name || 'Bunda',
              phone: r.customer?.phone || '',
            },
            attribution: {
              isPaid: !!r.customer?.adClick,
              trackingCode: r.customer?.adClick?.trackingCode || null,
              landingUrl: canonicalLandingUrl,
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
