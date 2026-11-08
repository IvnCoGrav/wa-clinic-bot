import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { tenantOf } from '../route-helpers';
import { memoryReservations } from '../stores';
import { auditService } from '../../../services/audit.service';

export async function registerProofAssignRoutes(fastify: FastifyInstance): Promise<void> {
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
      const tenantId = tenantOf(request);
      const { id } = request.params;
      const { imageB64, mimeType, fileName, remove } = request.body || {};

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
        });
        if (!existing) {
          throw new Error('Reservation not found');
        }

        let proofUrl: string | null = null;
        if (!remove && imageB64) {
          const { mediaService } = await import('../../../services/media.service');
          const rawB64 = imageB64.replace(/^data:image\/[^;]+;base64,/, '');
          const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
          const saved = await mediaService.saveOutboundMedia({
            tenantId: tenantId,
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
        if (mock && mock.tenant_id === tenantId) {
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
      const tenantId = tenantOf(request);
      const { id } = request.params;
      const { assigned_staff_id } = request.body || {};

      try {
        const existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: { customer: true },
        });
        if (!existing) {
          return reply.status(404).send({ success: false, error: 'Reservasi tidak ditemukan.' });
        }

        let staffName: string | null = null;
        if (assigned_staff_id) {
          const staff = await prisma.staff.findFirst({
            where: { id: assigned_staff_id, tenant_id: tenantId },
            select: { id: true, name: true },
          });
          if (!staff) {
            return reply.status(400).send({ success: false, error: 'Staff yang dipilih tidak valid.' });
          }
          staffName = staff.name;
        }

        const isForce = Boolean((request.body as any)?.force);
        if (assigned_staff_id && existing.booking_date && existing.status !== 'cancelled' && !isForce) {
          const { findOverlappingStaffReservations } = await import('../../../services/reservation-core.service');
          const staffConflicts = await findOverlappingStaffReservations({
            tenantId,
            staffId: assigned_staff_id,
            bookingDate: existing.booking_date,
            durationMinutes: existing.duration_minutes ?? 60,
            excludeId: existing.id,
          });
          if (staffConflicts.length > 0) {
            return reply.status(409).send({
              success: false,
              code: 'STAFF_COLLISION',
              error: 'Jadwal terapis bentrok dengan reservasi lain.',
              conflict: staffConflicts[0],
            });
          }
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

        // 6.3 Log pergantian penugasan bidan (ReservationStaffAssignmentLog)
        if (existing?.assigned_staff_id !== (assigned_staff_id || null)) {
          try {
            const p = prisma.reservationStaffAssignmentLog?.create({
              data: {
                tenant_id: tenantId,
                reservation_id: id,
                from_staff_id: existing?.assigned_staff_id || null,
                to_staff_id: assigned_staff_id || null,
                reason: (request.body as any)?.assignmentReason || (request.body as any)?.reason || 'cs_dispatch',
                actor: (request as any).adminUser?.name || (request as any).staffName || (request as any).adminIdentity || 'admin',
              },
            });
            void Promise.resolve(p).catch((err: any) => console.warn('[STAFF-ASSIGN-LOG] Failed to create log on assign:', err.message));
          } catch (err: any) {
            console.warn('[STAFF-ASSIGN-LOG] Exception initiating log on assign:', err.message);
          }
        }

        if (assigned_staff_id) {
          const { staffNotificationService } = await import('../../../services/staff-notification.service');
          staffNotificationService.scheduleReservationAssignmentNotification(id, assigned_staff_id).catch((err) => {
            console.error('[Admin API] Failed to schedule staff notification on assign:', err.message);
          });
        }

        // Cermin Sheets: update kolom Bidan di baris yang sama HANYA bila status completed.
        // Fire-and-forget; harga write-once tidak tersentuh (lihat sheets-sync).
        if ((reservation?.status || existing?.status) === 'completed') {
          import('../../../services/sheets/sheets-sync.service')
            .then(({ sheetsSyncService }) => sheetsSyncService.enqueue(id, tenantId))
            .catch((err) => console.warn('[Admin API] sheets enqueue on assign failed:', err?.message));
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'ASSIGN_RESERVATION_STAFF',
          targetId: id,
          payload: { assigned_staff_id, staffName },
          ipAddress: request.ip,
          tenantId: tenantId,
        });

        return reply.status(200).send({ success: true, data: reservation });
      } catch (error: any) {
        console.error('[Admin API] Failed to assign staff to reservation:', error.message);
        return reply.status(500).send({ success: false, error: 'Gagal menugaskan staff ke reservasi.' });
      }
    }
  );
}
