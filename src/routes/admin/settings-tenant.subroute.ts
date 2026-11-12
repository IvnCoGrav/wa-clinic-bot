import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { auditService } from '../../services/audit.service';
import { requireTenantId, resolveTenantId, updateTenantSettingsSafely } from './settings-helpers';
import {
  applyTenantSettingsPatch,
  getTenantSettingsView,
  parseTenantSettingsPatch,
} from '../../config/tenant-settings.config';
import { clearClinicLocationCache } from '../../config/clinic-location';
import { clearOperationalHoursCache } from '../../config/operational-hours';
import { clearStaffNotificationConfigCache } from '../../config/staff-notification-config';
import { clearBrandCache } from '../../config/brand';

/**
 * Cfg-011 — endpoint baca/tulis setelan tenant yang sebelumnya hanya punya
 * jalur baca (clinicLocation, operationalHours, staffNotification,
 * deliverySettings.estimateTtlDays, copilot.styleTone, brand lengkap).
 *
 * Keamanan: prefix `/api/admin/tenant-settings` terdaftar sebagai Super Admin
 * only di `admin.route.ts` (RBAC guard) — staf operasional tidak boleh membaca
 * maupun menulis lewat jalur ini.
 *
 * UI (sub-tab) sengaja belum dibuat di fase ini; kontrak backend disiapkan
 * lebih dulu agar dashboard dapat memakainya tanpa perubahan API lagi.
 */
export async function settingsTenantRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/tenant-settings
   * Nilai EFEKTIF (default + override tenant) untuk ditampilkan di form admin.
   */
  fastify.get('/api/admin/tenant-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveTenantId(request);
      const data = await getTenantSettingsView(tenantId);
      return reply.status(200).send({ success: true, tenantId, data });
    } catch (err: any) {
      return reply.status(err?.statusCode || 500).send({
        success: false,
        error: err?.message || 'Gagal memuat setelan tenant.',
      });
    }
  });

  /**
   * PATCH /api/admin/tenant-settings
   * Body boleh memuat sebagian section; kunci lain di `Tenant.settings`
   * (aiConfig, integrationGuards, dll.) TIDAK tersentuh.
   */
  fastify.patch(
    '/api/admin/tenant-settings',
    async (
      request: FastifyRequest<{ Body: Record<string, unknown> }>,
      reply: FastifyReply
    ) => {
      const parsed = parseTenantSettingsPatch(request.body);
      if (!parsed.ok) {
        return reply.status(400).send({
          success: false,
          error: 'VALIDATION_ERROR',
          errors: parsed.errors,
        });
      }

      try {
        const tenantId = requireTenantId(request);
        const saved = await updateTenantSettingsSafely(prisma, tenantId, (current) =>
          applyTenantSettingsPatch(current, parsed.patch)
        );

        // Setelan dibaca lewat cache 5 menit — bersihkan agar perubahan langsung
        // terlihat tanpa menunggu TTL (dan tanpa restart).
        clearClinicLocationCache(tenantId);
        clearOperationalHoursCache(tenantId);
        clearStaffNotificationConfigCache(tenantId);
        clearBrandCache(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_TENANT_SETTINGS',
          payload: parsed.patch,
          tenantId,
          ipAddress: request.ip,
        });

        const data = await getTenantSettingsView(tenantId);
        return reply.status(200).send({
          success: true,
          tenantId,
          data,
          message: 'Setelan tenant berhasil diperbarui.',
          version: (saved as any)?._version,
        });
      } catch (err: any) {
        return reply.status(err?.statusCode || 500).send({
          success: false,
          error: err?.message || 'Gagal menyimpan setelan tenant.',
          code: err?.code,
        });
      }
    }
  );
}
