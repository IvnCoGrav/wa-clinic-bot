import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';

export interface CustomRolePayload {
  key: string;
  label: string;
  description?: string;
  allowedPaths?: string[];
  defaultRedirect?: string;
}

// In-memory fallback store jika database offline
const memoryCustomRoles: Map<string, any> = new Map();

export async function rolesAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/roles
   * Mengambil daftar custom role yang tersimpan di database per-tenant.
   */
  fastify.get('/api/admin/roles', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const dbRoles = await prisma.customRole.findMany({
        where: { tenant_id: DEFAULT_TENANT_ID },
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
      console.warn('[ADMIN ROLES API] Database error, using fallback:', err.message);
      const fallbackList = Array.from(memoryCustomRoles.values());
      return reply.status(200).send({
        success: true,
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
      const { key, label, description, allowedPaths = [], defaultRedirect = '/admin/overview' } =
        request.body || {};

      if (!key || !label) {
        return reply.status(400).send({
          success: false,
          error: 'Key identifier dan label nama role wajib diisi.',
        });
      }

      const cleanKey = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

      try {
        const roleRecord = await prisma.customRole.upsert({
          where: {
            tenant_id_key: {
              tenant_id: DEFAULT_TENANT_ID,
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
            tenant_id: DEFAULT_TENANT_ID,
            key: cleanKey,
            label: label.trim(),
            description: description ? description.trim() : null,
            allowed_paths: allowedPaths,
            default_redirect: defaultRedirect,
            is_system: false,
          },
        });

        memoryCustomRoles.set(cleanKey, {
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
          tenantId: DEFAULT_TENANT_ID,
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
      const { key } = request.params;
      const cleanKey = key.trim().toLowerCase();

      try {
        await prisma.customRole.deleteMany({
          where: {
            tenant_id: DEFAULT_TENANT_ID,
            key: cleanKey,
            is_system: false,
          },
        });

        memoryCustomRoles.delete(cleanKey);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'DELETE_CUSTOM_ROLE',
          targetId: cleanKey,
          payload: { key: cleanKey },
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
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
