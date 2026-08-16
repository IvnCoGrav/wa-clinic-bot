import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { hashPassword } from '../../utils/bcrypt';
import { StaffAuthService } from '../../services/staff-auth.service';
import { auditService } from '../../services/audit.service';
import { StaffRole } from '@prisma/client';

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

      return reply.status(200).send({ success: true, data: staffList });
    } catch (err: any) {
      console.error('[ADMIN STAFF API] Error fetching staff list:', err.message);
      return reply.status(500).send({ success: false, error: 'Gagal mengambil data staff.' });
    }
  });

  /**
   * POST /api/admin/staff
   * Membuat akun staff baru (nama, nomor HP, password awal).
   */
  fastify.post(
    '/api/admin/staff',
    async (
      request: FastifyRequest<{
        Body: {
          name?: string;
          phone?: string;
          password?: string;
          role?: StaffRole;
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

      try {
        const existing = await prisma.staff.findFirst({
          where: { phone, tenant_id: DEFAULT_TENANT_ID },
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
            phone: phone.trim(),
            password_hash,
            role,
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
        return reply.status(500).send({ success: false, error: 'Gagal membuat akun staff.' });
      }
    }
  );

  /**
   * PATCH /api/admin/staff/:id
   * Mengupdate profil staff, password, atau status keaktifan (aktif/nonaktif).
   * Jika dinonaktifkan (active = false), otomatis membatalkan seluruh sesi aktif staff.
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
          role?: StaffRole;
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
        if (phone !== undefined) updateData.phone = phone.trim();
        if (role !== undefined) updateData.role = role;
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
        // putuskan seluruh sesi aktif staff seketika (role lain tidak boleh akses portal terapis)
        if (role !== undefined || active === false || updateData.password_hash) {
          await StaffAuthService.revokeAllSessions(id);
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: active === false ? 'DEACTIVATE_STAFF' : 'UPDATE_STAFF',
          targetId: id,
          payload: { changes: Object.keys(updateData) },
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(200).send({ success: true, data: updatedStaff });
      } catch (err: any) {
        console.error('[ADMIN STAFF API] Error updating staff:', err.message);
        return reply.status(500).send({ success: false, error: 'Gagal memperbarui data staff.' });
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
}
