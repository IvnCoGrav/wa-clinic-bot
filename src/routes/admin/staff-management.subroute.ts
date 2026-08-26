import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { hashPassword } from '../../utils/bcrypt';
import { StaffAuthService } from '../../services/staff-auth.service';
import { auditService } from '../../services/audit.service';

export async function staffManagementAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/staff
   * Mengambil daftar staff (terapis) untuk keperluan manajemen dan dropdown penugasan.
   */
  fastify.get('/api/admin/staff', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const staffList = await prisma.staff.findMany({
        where: { tenant_id: DEFAULT_TENANT_ID },
        select: {
          id: true,
          tenant_id: true,
          name: true,
          phone: true,
          role: true,
          active: true,
          telegram_chat_id: true,
          created_at: true,
          updated_at: true,
          _count: {
            select: { reservations: true },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      return reply.status(200).send({
        success: true,
        count: staffList.length,
        data: staffList,
      });
    } catch (err: any) {
      console.error('[ADMIN STAFF API] Error fetching staff:', err.message);
      return reply.status(500).send({
        success: false,
        error: 'Gagal mengambil daftar staff.',
      });
    }
  });

  /**
   * POST /api/admin/staff
   * Membuat akun staff baru (Terapis, Admin CS, Advertiser, SPVCS, atau custom role lainnya).
   */
  fastify.post(
    '/api/admin/staff',
    async (
      request: FastifyRequest<{
        Body: {
          name?: string;
          phone?: string;
          password?: string;
          role?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { name, phone, password, role = 'THERAPIST' } = request.body || {};

      if (!name || !phone || !password) {
        return reply.status(400).send({
          success: false,
          error: 'Nama, nomor HP, dan password wajib diisi.',
        });
      }

      const cleanPhone = phone.trim().replace(/^(\+62|62)/, '0');
      const finalRole = (role ? String(role).trim().toUpperCase() : 'THERAPIST');

      try {
        const existing = await prisma.staff.findFirst({
          where: {
            OR: [
              { phone: cleanPhone, tenant_id: DEFAULT_TENANT_ID },
              { phone: phone.trim(), tenant_id: DEFAULT_TENANT_ID },
            ],
          },
        });

        if (existing) {
          return reply.status(409).send({
            success: false,
            error: 'Nomor HP staff sudah terdaftar.',
          });
        }

        const password_hash = await hashPassword(password);

        const newStaff = await prisma.staff.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            name: name.trim(),
            phone: cleanPhone,
            password_hash,
            role: finalRole,
            active: true,
          },
          select: {
            id: true,
            tenant_id: true,
            name: true,
            phone: true,
            role: true,
            active: true,
            created_at: true,
            updated_at: true,
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_STAFF',
          targetId: newStaff.id,
          payload: { name: newStaff.name, phone: newStaff.phone, role: newStaff.role },
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(201).send({ success: true, data: newStaff });
      } catch (err: any) {
        console.error('[ADMIN STAFF API] Error creating staff:', err.message);
        return reply.status(500).send({
          success: false,
          error: err.message || 'Gagal membuat akun staff.',
        });
      }
    }
  );

  /**
   * PATCH /api/admin/staff/:id
   * Mengupdate profil staff, password, role, atau status keaktifan (aktif/nonaktif).
   * Jika dinonaktifkan (active = false) atau role diubah, otomatis membatalkan seluruh sesi aktif staff.
   */
  fastify.patch(
    '/api/admin/staff/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          name?: string;
          phone?: string;
          password?: string;
          role?: string;
          active?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { name, phone, password, role, active } = request.body || {};

      try {
        const existing = await prisma.staff.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
        });

        if (!existing) {
          return reply.status(404).send({ success: false, error: 'Staff tidak ditemukan.' });
        }

        const updateData: any = {};
        if (name !== undefined) updateData.name = name.trim();
        if (phone !== undefined) updateData.phone = phone.trim().replace(/^(\+62|62)/, '0');
        if (role !== undefined) updateData.role = String(role).trim().toUpperCase();
        if (active !== undefined) updateData.active = active;
        if (password && password.trim()) {
          updateData.password_hash = await hashPassword(password);
        }

        const updatedStaff = await prisma.staff.update({
          where: { id },
          data: updateData,
          select: {
            id: true,
            tenant_id: true,
            name: true,
            phone: true,
            role: true,
            active: true,
            created_at: true,
            updated_at: true,
          },
        });

        // Jika role diubah, akun dinonaktifkan, atau password direset,
        // putuskan seluruh sesi aktif staff seketika
        if (role !== undefined || active === false || updateData.password_hash) {
          await StaffAuthService.revokeAllSessions(id);
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_STAFF',
          targetId: id,
          payload: { changes: Object.keys(updateData) },
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(200).send({ success: true, data: updatedStaff });
      } catch (err: any) {
        console.error('[ADMIN STAFF API] Error updating staff:', err.message);
        return reply.status(500).send({
          success: false,
          error: err.message || 'Gagal memperbarui data staff.',
        });
      }
    }
  );

  /**
   * DELETE /api/admin/staff/:id
   * Menghapus akun staff secara permanen dari sistem.
   * Otomatis mencabut seluruh sesi aktif dan melepas penugasan reservasi.
   */
  fastify.delete(
    '/api/admin/staff/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const existing = await prisma.staff.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
        });

        if (!existing) {
          return reply.status(404).send({ success: false, error: 'Staff tidak ditemukan.' });
        }

        // Putuskan semua sesi aktif staff
        await StaffAuthService.revokeAllSessions(id);

        // Hapus akun staff
        await prisma.staff.delete({
          where: { id },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'DELETE_STAFF',
          targetId: id,
          payload: { name: existing.name, phone: existing.phone, role: existing.role },
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(200).send({
          success: true,
          message: `Akun staff "${existing.name}" berhasil dihapus.`,
        });
      } catch (err: any) {
        console.error('[ADMIN STAFF API] Error deleting staff:', err.message);
        return reply.status(500).send({ success: false, error: 'Gagal menghapus akun staff.' });
      }
    }
  );

  /**
   * POST /api/admin/staff/:id/send-briefing
   * Mengirimkan briefing jadwal harian ke Telegram pribadi staf/bidan tertentu (bisa menentukan tanggal).
   */
  fastify.post(
    '/api/admin/staff/:id/send-briefing',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body?: { date?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const targetDate = request.body?.date ? new Date(request.body.date) : new Date();

      try {
        const { staffNotificationService } = await import('../../services/staff-notification.service');
        const result = await staffNotificationService.sendStaffDailyBriefing(id, targetDate);

        if (!result.sent) {
          return reply.status(400).send({
            success: false,
            error: result.reason || 'Gagal mengirimkan briefing jadwal ke Telegram staf.',
            data: result,
          });
        }

        return reply.status(200).send({
          success: true,
          message: `Briefing jadwal berhasil dikirim ke Telegram staf (${result.count || 0} jadwal).`,
          data: result,
        });
      } catch (err: any) {
        console.error('[ADMIN STAFF API] Error sending briefing to staff:', err.message);
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/staff/trigger-morning-briefing
   * Memicu pengiriman Morning Briefing ke seluruh staf aktif yang bertugas hari ini.
   */
  fastify.post(
    '/api/admin/staff/trigger-morning-briefing',
    async (
      request: FastifyRequest<{
        Body?: { date?: string; tenant_id?: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = request.body?.tenant_id || DEFAULT_TENANT_ID;
      const targetDate = request.body?.date ? new Date(request.body.date) : new Date();

      try {
        const { staffNotificationService } = await import('../../services/staff-notification.service');
        const stats = await staffNotificationService.sendAllStaffMorningBriefings(tenantId, targetDate);

        return reply.status(200).send({
          success: true,
          message: `Morning Briefing selesai dikirim ke ${stats.briefedStaff}/${stats.totalStaff} staf (${stats.totalReservations} total jadwal).`,
          data: stats,
        });
      } catch (err: any) {
        console.error('[ADMIN STAFF API] Error triggering morning briefings:', err.message);
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/staff/:id/telegram-pairing
   * Mengambil token dan tautan pairing Telegram unik staf untuk dibagikan admin ke staf
   */
  fastify.get(
    '/api/admin/staff/:id/telegram-pairing',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const { staffNotificationService } = await import('../../services/staff-notification.service');
        const info = await staffNotificationService.getStaffPairingInfo(id);

        if (!info) {
          return reply.status(404).send({ success: false, error: 'Staff tidak ditemukan.' });
        }

        return reply.status(200).send({ success: true, data: info });
      } catch (err: any) {
        console.error('[ADMIN STAFF API] Error fetching staff telegram pairing:', err.message);
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/staff/:id/telegram-pairing/regenerate
   * Membuat ulang token pairing Telegram staf
   */
  fastify.post(
    '/api/admin/staff/:id/telegram-pairing/regenerate',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        const { staffNotificationService } = await import('../../services/staff-notification.service');
        const info = await staffNotificationService.regenerateStaffPairingToken(id);

        if (!info) {
          return reply.status(404).send({ success: false, error: 'Staff tidak ditemukan.' });
        }

        return reply.status(200).send({ success: true, data: info });
      } catch (err: any) {
        console.error('[ADMIN STAFF API] Error regenerating staff telegram pairing token:', err.message);
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}
