import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';

export async function wabaAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/whatsapp-provider
   */
  fastify.get('/api/admin/whatsapp-provider', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });

      let wahaStatus = 'UNKNOWN';
      try {
        const { wahaClient } = await import('../../integrations/waha/client');
        wahaStatus = await wahaClient.getSessionStatus();
      } catch (err: any) {
        wahaStatus = `FAILED: ${err.message}`;
      }

      const { wabaTemplateService } = await import('../../services/waba-template.service');
      const templates = await wabaTemplateService.getAllTemplateMappings(DEFAULT_TENANT_ID);

      const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
      const wahaOutboundCutoff = await whatsappProviderService.isOutboundCutOff(DEFAULT_TENANT_ID);

      return reply.status(200).send({
        success: true,
        data: {
          provider: tenant?.whatsapp_provider || 'WAHA',
          wahaSessionId: tenant?.waha_session_id || 'default',
          wahaStatus,
          wahaOutboundCutoff,
          waba: {
            configured: !!(tenant?.waba_phone_number_id && tenant?.waba_access_token),
            phoneNumberId: tenant?.waba_phone_number_id || null,
            businessAccountId: tenant?.waba_business_account_id || null,
            hasAccessToken: !!tenant?.waba_access_token,
            hasWebhookVerifyToken: !!tenant?.waba_webhook_verify_token,
          },
          templates,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/whatsapp-provider/qr
   */
  fastify.get(
    '/api/admin/whatsapp-provider/qr',
    async (request: FastifyRequest<{ Querystring: { tenantId?: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = request.query?.tenantId || DEFAULT_TENANT_ID;
        const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
        const data = await whatsappProviderService.getQrForTenant(tenantId);
        return reply.status(200).send({ success: true, data });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/whatsapp-provider/session/start
   */
  fastify.post(
    '/api/admin/whatsapp-provider/session/start',
    async (request: FastifyRequest<{ Body: { tenantId?: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;
        const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
        const data = await whatsappProviderService.startSessionForTenant(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'WAHA_SESSION_START',
          targetId: data.sessionId,
          payload: { status: data.status },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/whatsapp-provider/session/reset
   */
  fastify.post(
    '/api/admin/whatsapp-provider/session/reset',
    async (request: FastifyRequest<{ Body: { tenantId?: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;
        const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
        const data = await whatsappProviderService.resetSessionForTenant(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'WAHA_SESSION_RESET',
          targetId: data.sessionId,
          payload: { status: data.status },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/whatsapp-provider/session/disconnect
   */
  fastify.post(
    '/api/admin/whatsapp-provider/session/disconnect',
    async (request: FastifyRequest<{ Body: { tenantId?: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = request.body?.tenantId || DEFAULT_TENANT_ID;
        const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
        const data = await whatsappProviderService.disconnectSessionForTenant(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'WAHA_SESSION_DISCONNECT',
          targetId: data.sessionId,
          payload: { status: data.status },
          ipAddress: request.ip,
        });

        return reply
          .status(200)
          .send({ success: true, data, message: 'Session WAHA berhasil terputus (Disconnected).' });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/whatsapp-provider/cutoff
   * Mengubah status cut-off internal aliran outbound bot ke WAHA (Emergency Kill-Switch).
   */
  fastify.patch(
    '/api/admin/whatsapp-provider/cutoff',
    async (
      request: FastifyRequest<{
        Body: { cutOff: boolean; tenantId?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { cutOff, tenantId = DEFAULT_TENANT_ID } = request.body || {};
      if (typeof cutOff !== 'boolean') {
        return reply.status(400).send({ error: 'Body harus berisi field "cutOff" bertipe boolean.' });
      }

      try {
        const { whatsappProviderService } = await import('../../services/whatsapp-provider.service');
        const previousState = await whatsappProviderService.isOutboundCutOff(tenantId);
        const newState = await whatsappProviderService.setOutboundCutOff(tenantId, cutOff);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'WAHA_INTERNAL_CUTOFF_TOGGLE',
          targetId: tenantId,
          payload: { previousState, newState },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          wahaOutboundCutoff: newState,
          message: newState
            ? 'Koneksi internal outbound ke WAHA berhasil diputus (Cut-Off Darurat Aktif). Sesi WhatsApp tetap login.'
            : 'Koneksi internal outbound ke WAHA berhasil disambungkan kembali (Normal).',
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/whatsapp-provider
   */
  fastify.patch(
    '/api/admin/whatsapp-provider',
    async (
      request: FastifyRequest<{
        Body: {
          provider?: 'WAHA' | 'WABA';
          waha_session_id?: string;
          waba_phone_number_id?: string;
          waba_business_account_id?: string;
          waba_access_token?: string;
          waba_webhook_verify_token?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const {
        provider,
        waha_session_id,
        waba_phone_number_id,
        waba_business_account_id,
        waba_access_token,
        waba_webhook_verify_token,
      } = body;

      if (provider && provider !== 'WAHA' && provider !== 'WABA') {
        return reply.status(400).send({ error: 'provider harus "WAHA" atau "WABA"' });
      }

      try {
        const existing = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
        const data: any = {};

        if (provider) data.whatsapp_provider = provider;
        if (waha_session_id) data.waha_session_id = waha_session_id;
        if (waba_phone_number_id !== undefined) data.waba_phone_number_id = waba_phone_number_id || null;
        if (waba_business_account_id !== undefined) data.waba_business_account_id = waba_business_account_id || null;
        if (waba_webhook_verify_token !== undefined) data.waba_webhook_verify_token = waba_webhook_verify_token || null;
        if (waba_access_token) {
          const { encryptSecret } = await import('../../utils/encryption');
          data.waba_access_token = encryptSecret(waba_access_token);
        }

        const tenant = existing
          ? await prisma.tenant.update({ where: { id: DEFAULT_TENANT_ID }, data })
          : await prisma.tenant.create({
              data: {
                id: DEFAULT_TENANT_ID,
                slug: DEFAULT_TENANT_ID,
                name: 'Default Clinic',
                ...data,
              },
            });

        const { resetGateway } = await import('../../integrations/whatsapp/factory');
        resetGateway();

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_WHATSAPP_PROVIDER',
          targetId: DEFAULT_TENANT_ID,
          payload: {
            provider: tenant.whatsapp_provider,
            waha_session_id: tenant.waha_session_id,
            waba_phone_number_id: tenant.waba_phone_number_id,
            waba_configured: !!(tenant.waba_phone_number_id && tenant.waba_access_token),
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `WhatsApp provider diubah ke ${tenant.whatsapp_provider}.`,
          data: { provider: tenant.whatsapp_provider },
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/waba-templates
   */
  fastify.get('/api/admin/waba-templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { wabaTemplateService } = await import('../../services/waba-template.service');
      const templates = await wabaTemplateService.getAllTemplateMappings(DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: templates });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/waba-templates
   */
  fastify.post(
    '/api/admin/waba-templates',
    async (
      request: FastifyRequest<{
        Body: {
          type: string;
          variant: number;
          templateName: string;
          category?: 'UTILITY' | 'MARKETING';
          languageCode?: string;
          status?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED';
          isActive?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { type, variant, templateName, category, languageCode, status, isActive } = request.body || {};
      if (!type || !variant || !templateName) {
        return reply.status(400).send({ error: 'type, variant, dan templateName wajib diisi' });
      }

      try {
        const { wabaTemplateService } = await import('../../services/waba-template.service');
        await wabaTemplateService.saveTemplateMapping(DEFAULT_TENANT_ID, type, variant, {
          templateName,
          category: category || 'UTILITY',
          languageCode: languageCode || 'id',
          status: status || 'APPROVED',
          isActive,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_WABA_TEMPLATE',
          targetId: `${type}#${variant}`,
          payload: { type, variant, templateName },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, message: 'WABA template mapping berhasil disimpan!' });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );
}
