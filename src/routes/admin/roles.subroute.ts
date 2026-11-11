import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { resolveSessionTenantId } from './route-helpers';

export interface CustomRolePayload {
  key: string;
  label: string;
  description?: string;
  allowedPaths?: string[];
  defaultRedirect?: string;
}

// In-memory fallback store jika database offline
const defaultFallbackRoles = [
  { key: 'therapist', label: 'Terapis', description: 'Akses tugas harian lapangan dan chat pasien.', isSystem: true, allowedPaths: ['/staff/today'], defaultRedirect: '/staff/today' },
  { key: 'admin_cs', label: 'Admin CS', description: 'Akses reservasi, live chat, dan manajemen pelanggan.', isSystem: true, allowedPaths: ['/tenant/reservations', '/tenant/live-chat', '/tenant/customers', '/tenant/today-treatments'], defaultRedirect: '/tenant/reservations' },
  { key: 'spv_cs', label: 'Supervisor CS', description: 'Akses penuh operasional dan laporan.', isSystem: true, allowedPaths: ['*'], defaultRedirect: '/tenant/overview' },
];
const memoryCustomRolesByTenant: Map<string, Map<string, any>> = new Map();

/** Fallback memori TERISOLASI per tenant (Cfg-014: sebelumnya global → bocor). */
function getMemoryRoleMap(tenantId: string): Map<string, any> {
  let map = memoryCustomRolesByTenant.get(tenantId);
  if (!map) {
    map = new Map(defaultFallbackRoles.map((r) => [r.key, r]));
    memoryCustomRolesByTenant.set(tenantId, map);
  }
  return map;
}

const SYSTEM_ROLE_KEYS = new Set(defaultFallbackRoles.map((r) => r.key));

export async function rolesAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/roles
   * Mengambil daftar custom role yang tersimpan di database per-tenant.
   */
  fastify.get('/api/admin/roles', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveSessionTenantId(request);
    try {
      const dbRoles = await prisma.customRole.findMany({
        where: { tenant_id: tenantId },
        orderBy: { created_at: 'asc' },
      });

      const roles = dbRoles.map((r) => ({
        key: r.key,
        label: r.label,
        description: r.description || '',
        isSystem: r.is_system,
        allowedPaths: r.allowed_paths,
        defaultRedirect: r.default_redirect,
      }));

      return reply.status(200).send({
        success: true,
        data: roles,
      });
    } catch (err: any) {
      // Ar-005: jangan "false success" di produksi. Fallback memori hanya untuk
      // dev/test; produksi wajib jujur bahwa daftar role tidak tersedia.
      if (process.env.NODE_ENV === 'production') {
        console.error('[ADMIN ROLES API] Database tidak tersedia:', err.message);
        return reply.status(503).send({
          success: false,
          code: 'DATABASE_UNAVAILABLE',
          error: 'Daftar role tidak dapat dimuat dari database. Coba lagi.',
        });
      }
      console.warn('[ADMIN ROLES API] Database error, using fallback (non-production):', err.message);
      const fallbackList = Array.from(getMemoryRoleMap(tenantId).values());
      return reply.status(200).send({
        success: true,
        degraded: true,
        data: fallbackList,
      });
    }
  });

  /**
   * POST /api/admin/roles
   * Membuat atau meng-upsert custom role baru ke database.
   */
  fastify.post(
    '/api/admin/roles',
    async (
      request: FastifyRequest<{
        Body: CustomRolePayload;
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = resolveSessionTenantId(request);
      const { key, label, description, allowedPaths = [], defaultRedirect = '/admin/overview' } =
        request.body || {};

      if (!key || !label) {
        return reply.status(400).send({
          success: false,
          error: 'Key identifier dan label nama role wajib diisi.',
        });
      }

      if (!Array.isArray(allowedPaths)) {
        return reply.status(400).send({
          success: false,
          error: 'allowedPaths harus berupa array string.',
        });
      }

      const cleanKey = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

      // Cfg-014: role sistem tidak boleh ditimpa lewat API (allowedPaths bisa
      // dieksploitasi untuk memberi akses penuh). Perubahan role sistem hanya
      // lewat kode/migrasi.
      if (SYSTEM_ROLE_KEYS.has(cleanKey)) {
        return reply.status(409).send({
          success: false,
          code: 'SYSTEM_ROLE_IMMUTABLE',
          error: `Role sistem '${cleanKey}' tidak dapat diubah lewat API.`,
        });
      }

      // Task 2.1.4: Tolak allowedPaths: ['*'] untuk role non-super-admin
      if (cleanKey !== 'super_admin' && allowedPaths.some((p) => p === '*')) {
        return reply.status(400).send({
          success: false,
          error: "Karakter '*' (akses penuh) hanya diizinkan khusus untuk role super_admin.",
        });
      }

      // Validasi registry path: setiap path harus diawali '/'
      for (const p of allowedPaths) {
        if (typeof p !== 'string' || !p.trim() || (!p.startsWith('/') && p !== '*')) {
          return reply.status(400).send({
            success: false,
            error: `Path '${p}' tidak valid. Setiap path harus diawali dengan tanda '/'.`,
          });
        }
      }

      try {
        const roleRecord = await prisma.customRole.upsert({
          where: {
            tenant_id_key: {
              tenant_id: tenantId,
              key: cleanKey,
            },
          },
          update: {
            label: label.trim(),
            description: description ? description.trim() : null,
            allowed_paths: allowedPaths,
            default_redirect: defaultRedirect,
          },
          create: {
            tenant_id: tenantId,
            key: cleanKey,
            label: label.trim(),
            description: description ? description.trim() : null,
            allowed_paths: allowedPaths,
            default_redirect: defaultRedirect,
            is_system: false,
          },
        });

        getMemoryRoleMap(tenantId).set(cleanKey, {
          key: roleRecord.key,
          label: roleRecord.label,
          description: roleRecord.description || '',
          isSystem: roleRecord.is_system,
          allowedPaths: roleRecord.allowed_paths,
          defaultRedirect: roleRecord.default_redirect,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPSERT_CUSTOM_ROLE',
          targetId: roleRecord.id,
          payload: { key: cleanKey, label, allowedPathsCount: allowedPaths.length },
          ipAddress: request.ip,
          tenantId,
        });

        return reply.status(200).send({
          success: true,
          data: {
            key: roleRecord.key,
            label: roleRecord.label,
            description: roleRecord.description || '',
            isSystem: roleRecord.is_system,
            allowedPaths: roleRecord.allowed_paths,
            defaultRedirect: roleRecord.default_redirect,
          },
        });
      } catch (err: any) {
        console.error('[ADMIN ROLES API] Error saving custom role:', err.message);
        return reply.status(500).send({
          success: false,
          error: err.message || 'Gagal menyimpan custom role ke database.',
        });
      }
    }
  );

  /**
   * DELETE /api/admin/roles/:key
   * Menghapus custom role dari database.
   */
  fastify.delete(
    '/api/admin/roles/:key',
    async (
      request: FastifyRequest<{
        Params: { key: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = resolveSessionTenantId(request);
      const { key } = request.params;
      const cleanKey = key.trim().toLowerCase();

      try {
        await prisma.customRole.deleteMany({
          where: {
            tenant_id: tenantId,
            key: cleanKey,
            is_system: false,
          },
        });

        memoryCustomRolesByTenant.get(tenantId)?.delete(cleanKey);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'DELETE_CUSTOM_ROLE',
          targetId: cleanKey,
          payload: { key: cleanKey },
          ipAddress: request.ip,
          tenantId,
        });

        return reply.status(200).send({
          success: true,
          message: `Role ${cleanKey} berhasil dihapus.`,
        });
      } catch (err: any) {
        console.error('[ADMIN ROLES API] Error deleting custom role:', err.message);
        return reply.status(500).send({
          success: false,
          error: err.message || 'Gagal menghapus custom role dari database.',
        });
      }
    }
  );
}
