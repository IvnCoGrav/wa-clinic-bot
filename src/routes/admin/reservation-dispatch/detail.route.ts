import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { tenantOf } from '../route-helpers';
import { memoryReservations } from '../stores';
import { withPaymentEvaluation } from './shared';
import {
  extractNotesFromRawText,
  extractBabyDetails,
} from '../../../utils/reservation-text-parser';

export async function registerDetailRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/admin/reservation/:id
   * Ambil detail single reservation lengkap dengan customer, children, staff
   */
  fastify.get(
    '/api/admin/reservation/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const tenantId = tenantOf(request);
      try {
        const reservation = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
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
            // R4 — kartu buku alamat terkait (label/ongkir) untuk tampilan detail.
            customer_address: true,
          },
        });
        if (!reservation) {
          // memory fallback
          const mem = memoryReservations.get(id);
          if (!mem || mem.tenant_id !== tenantId) return reply.status(404).send({ success: false, error: 'Reservation tidak ditemukan' });
          // Paritas relasi DB: lengkapi assigned_staff bila belum ada (tanpa hardcode nama)
          let memStaff: any = mem.assigned_staff || null;
          if (!memStaff && mem.assigned_staff_id) {
            try {
              const s = await prisma.staff.findFirst({
                where: { id: mem.assigned_staff_id, tenant_id: tenantId },
                select: { id: true, name: true, phone: true },
              });
              memStaff = s || null;
            } catch {
              memStaff = null;
            }
          }
          return reply.status(200).send({
            success: true,
            data: withPaymentEvaluation({
              ...mem,
              assigned_staff: memStaff,
              notes: (mem as any).notes || extractNotesFromRawText(mem.raw_text),
              baby_details: extractBabyDetails(mem.raw_text),
            }),
          });
        }
        const { computeCurrentAge, resolveMomGestationalInfo } = await import('../../../utils/age-calculator');
        const enrichedChildren = ((reservation as any).customer?.children || []).map((c: any) => ({
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
        }));
        return reply.status(200).send({
          success: true,
          data: withPaymentEvaluation({
            ...reservation,
            notes: (reservation as any).notes || extractNotesFromRawText(reservation.raw_text),
            baby_details: extractBabyDetails(reservation.raw_text),
            mom_gestational_info: resolveMomGestationalInfo({
              text: `${(reservation as any).raw_text || ''} ${(reservation as any).treatment_detail || ''}`,
              treatmentCategory: (reservation as any).treatment_category,
              registeredAt: (reservation as any).created_at,
              gestationalWeeks: (reservation as any).gestational_weeks,
              momStage: (reservation as any).mom_stage,
              hplDate: (reservation as any).hpl_date,
            }),
            customer: (reservation as any).customer
              ? { ...(reservation as any).customer, children: enrichedChildren }
              : undefined,
          }),
        });
      } catch (err: any) {
        const mem = memoryReservations.get(id);
        if (mem && mem.tenant_id === tenantId) {
          return reply.status(200).send({
            success: true,
            data: withPaymentEvaluation({
              ...mem,
              notes: (mem as any).notes || extractNotesFromRawText(mem.raw_text),
              baby_details: extractBabyDetails(mem.raw_text),
            }),
          });
        }
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}
