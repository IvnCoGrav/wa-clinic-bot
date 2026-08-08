import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../../services/ai-eligibility.service';

export async function settingsAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/settings/mql
   */
  fastify.get('/api/admin/settings/mql', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { customerService } = await import('../../services/customer.service');
      const settings = await customerService.getMqlSettings(DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: settings });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/settings/mql
   */
  fastify.put(
    '/api/admin/settings/mql',
    async (
      request: FastifyRequest<{
        Body: { mqlThresholdBubbles?: number; mqlAutoLeadEnabled?: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const { mqlThresholdBubbles, mqlAutoLeadEnabled } = request.body || {};
      if (mqlThresholdBubbles !== undefined && (typeof mqlThresholdBubbles !== 'number' || mqlThresholdBubbles < 1)) {
        return reply.status(400).send({ success: false, error: 'mqlThresholdBubbles harus berupa angka > 0' });
      }

      try {
        const { customerService } = await import('../../services/customer.service');
        const updated = await customerService.updateMqlSettings(DEFAULT_TENANT_ID, {
          mqlThresholdBubbles,
          mqlAutoLeadEnabled,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_MQL_SETTINGS',
          payload: updated,
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, data: updated, message: 'Setting MQL berhasil diperbarui.' });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/settings/media
   */
  fastify.get('/api/admin/settings/media', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { mediaService } = await import('../../services/media.service');
      let tenantRetention: number | null = null;
      try {
        const tenant = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
        tenantRetention = tenant?.media_retention_days ?? null;
      } catch {}
      return reply.status(200).send({
        success: true,
        data: {
          tenantMediaRetentionDays: tenantRetention,
          envFallbackRetentionDays: mediaService.getEnvRetentionDays(),
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/settings/media
   */
  fastify.put(
    '/api/admin/settings/media',
    async (
      request: FastifyRequest<{
        Body: { mediaRetentionDays?: number };
      }>,
      reply: FastifyReply
    ) => {
      const { mediaRetentionDays } = request.body || {};
      if (
        typeof mediaRetentionDays !== 'number' ||
        !Number.isFinite(mediaRetentionDays) ||
        mediaRetentionDays < 1 ||
        mediaRetentionDays > 3650
      ) {
        return reply.status(400).send({ success: false, error: 'mediaRetentionDays harus berupa angka 1-3650 (hari).' });
      }

      try {
        const updated = await prisma.tenant.update({
          where: { id: DEFAULT_TENANT_ID },
          data: { media_retention_days: Math.floor(mediaRetentionDays) },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_MEDIA_RETENTION',
          payload: { mediaRetentionDays: updated.media_retention_days },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          data: { mediaRetentionDays: updated.media_retention_days },
          message: 'Retensi media Live Chat berhasil diperbarui.',
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/settings/pricelist-image
   */
  fastify.get('/api/admin/settings/pricelist-image', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { getPricelistImageUrl, DEFAULT_PRICELIST_IMAGE } = await import('../../services/pricelist-config.service');
      const tenant = await prisma.tenant.findUnique({
        where: { id: DEFAULT_TENANT_ID },
        select: { pricelist_image_url: true },
      });
      return reply.status(200).send({
        success: true,
        data: {
          pricelistImageUrl: tenant?.pricelist_image_url ?? null,
          effectiveUrl: await getPricelistImageUrl(DEFAULT_TENANT_ID),
          envFallbackUrl: process.env.CLINIC_PRICELIST_IMAGE_URL || null,
          defaultUrl: DEFAULT_PRICELIST_IMAGE,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/settings/pricelist-image
   * Menerima imageUrl (URL publik / path /media/outbound/...) ATAU upload base64
   * (imageB64+mimeType+fileName) yang disimpan sebagai media outbound tenant.
   */
  fastify.put(
    '/api/admin/settings/pricelist-image',
    {
      bodyLimit: 12 * 1024 * 1024, // izinkan upload gambar via base64
    },
    async (
      request: FastifyRequest<{
        Body: { imageUrl?: string | null; imageB64?: string; mimeType?: string; fileName?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { imageUrl, imageB64, mimeType, fileName } = request.body || {};

      let storedUrl: string | null = null;
      try {
        if (imageB64) {
          // Upload gambar baru → simpan sebagai media outbound tenant, lalu
          // simpan relative URL-nya (resolve otomatis per provider saat kirim).
          const { mediaService } = await import('../../services/media.service');
          const saved = await mediaService.saveOutboundMedia({
            tenantId: DEFAULT_TENANT_ID,
            imageB64,
            mimeType,
            fileName,
          });
          storedUrl = saved.hdUrl;
        } else {
          storedUrl = typeof imageUrl === 'string' ? imageUrl.trim() || null : null;
          if (storedUrl !== null && !/^https?:\/\//i.test(storedUrl) && !storedUrl.startsWith('/media/outbound/')) {
            return reply
              .status(400)
              .send({ success: false, error: 'imageUrl harus berupa URL publik (http/https) atau path /media/outbound/...' });
          }
        }

        const { setPricelistImageUrl } = await import('../../services/pricelist-config.service');
        const result = await setPricelistImageUrl(DEFAULT_TENANT_ID, storedUrl);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_PRICELIST_IMAGE',
          targetId: DEFAULT_TENANT_ID,
          payload: { pricelist_image_url: result.url },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: 'Gambar pricelist berhasil diperbarui.',
          data: { pricelistImageUrl: result.url },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/persona
   */
  fastify.get('/api/admin/persona', async (request: FastifyRequest, reply: FastifyReply) => {
    const { loadPersonaFromDb, getMaxCharsPerReply } = await import('../../config/persona');
    const persona = await loadPersonaFromDb(DEFAULT_TENANT_ID);
    return reply.status(200).send({ success: true, persona, maxCharsPerReply: getMaxCharsPerReply(DEFAULT_TENANT_ID) });
  });

  /**
   * POST /api/admin/persona
   */
  fastify.post(
    '/api/admin/persona',
    async (
      request: FastifyRequest<{
        Body: { persona: string; maxCharsPerReply?: number | null | '' };
      }>,
      reply: FastifyReply
    ) => {
      const { persona, maxCharsPerReply } = request.body || {};
      if (!persona || !persona.trim()) {
        return reply.status(400).send({ error: 'System persona prompt is required' });
      }

      try {
        const { savePersonaToDb, getMaxCharsPerReply } = await import('../../config/persona');
        let maxChars: number | null | undefined;
        if (maxCharsPerReply === undefined) {
          maxChars = undefined;
        } else if (maxCharsPerReply === '' || maxCharsPerReply === null) {
          maxChars = null;
        } else {
          maxChars = Math.max(0, Number(maxCharsPerReply));
        }
        await savePersonaToDb(persona, DEFAULT_TENANT_ID, maxChars);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'BOT_PERSONA_CHANGE',
          targetId: 'SYSTEM_PERSONA',
          payload: {
            details: `System persona prompt updated to: ${persona.substring(0, 100)}...${
              maxChars === undefined ? '' : ` | max_chars_per_reply=${maxChars}`
            }`,
          },
        });

        const savedMaxChars = maxChars === undefined ? getMaxCharsPerReply(DEFAULT_TENANT_ID) : maxChars;
        return reply.status(200).send({
          success: true,
          message: 'System persona prompt berhasil diperbarui secara live!',
          persona,
          maxCharsPerReply: savedMaxChars,
        });
      } catch (err: any) {
        return reply.status(500).send({ error: `Gagal memperbarui persona: ${err.message}` });
      }
    }
  );

  /**
   * GET /api/admin/customer-service
   */
  fastify.get('/api/admin/customer-service', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant =
      (await prisma.tenant.findFirst({
        where: { id: DEFAULT_TENANT_ID },
      })) || (await prisma.tenant.findFirst());

    return reply.status(200).send({
      success: true,
      data: {
        csName: tenant?.cs_name || 'Cs Yusi',
        whatsappNumber: tenant?.whatsapp_number || '6287751148065',
        formatVisit: tenant?.format_visit || 'Promo[%ID%]',
        formatCheckout: tenant?.format_checkout || 'list untuk reservasi :',
        formatPurchase: tenant?.format_purchase || 'Payment',
        formatValue: tenant?.format_value || 'Treatment = %VALUE%',
      },
    });
  });

  /**
   * POST /api/admin/customer-service
   */
  fastify.post('/api/admin/customer-service', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as {
      csName?: string;
      whatsappNumber?: string;
      formatVisit?: string;
      formatCheckout?: string;
      formatPurchase?: string;
      formatValue?: string;
    };

    let tenant = await prisma.tenant.findFirst({ where: { id: DEFAULT_TENANT_ID } });
    if (!tenant) {
      tenant = await prisma.tenant.findFirst();
    }

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant tidak ditemukan' });
    }

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        ...(body.csName !== undefined ? { cs_name: body.csName } : {}),
        ...(body.whatsappNumber !== undefined ? { whatsapp_number: body.whatsappNumber } : {}),
        ...(body.formatVisit !== undefined ? { format_visit: body.formatVisit } : {}),
        ...(body.formatCheckout !== undefined ? { format_checkout: body.formatCheckout } : {}),
        ...(body.formatPurchase !== undefined ? { format_purchase: body.formatPurchase } : {}),
        ...(body.formatValue !== undefined ? { format_value: body.formatValue } : {}),
      },
    });

    return reply.status(200).send({
      success: true,
      message: 'Konfigurasi Customer Service berhasil diperbarui',
      data: {
        csName: updated.cs_name,
        whatsappNumber: updated.whatsapp_number,
        formatVisit: updated.format_visit,
        formatCheckout: updated.format_checkout,
        formatPurchase: updated.format_purchase,
        formatValue: updated.format_value,
      },
    });
  });

  /**
   * GET /api/admin/ai-models
   */
  fastify.get('/api/admin/ai-models', async (request: FastifyRequest, reply: FastifyReply) => {
    const { AiModelConfigService } = await import('../../config/ai-models.config');
    const configs = AiModelConfigService.getAllTaskConfigs();
    return reply.status(200).send({ success: true, data: configs });
  });

  /**
   * PATCH /api/admin/ai-models/:task
   */
  fastify.patch(
    '/api/admin/ai-models/:task',
    async (
      request: FastifyRequest<{
        Params: { task: string };
        Body: { provider?: string; modelName?: string; maxTokens?: number; temperature?: number };
      }>,
      reply: FastifyReply
    ) => {
      const { task } = request.params;
      const upperTask = task.toUpperCase();

      if (upperTask === 'MEDICAL_CHECK') {
        return reply.status(400).send({
          error:
            'Bad Request: Deteksi medis (MEDICAL_CHECK) bersifat deterministik (Regex/Keywords) demi keselamatan customer dan tidak dapat diubah via model AI dinamis.',
        });
      }

      const { AiModelConfigService } = await import('../../config/ai-models.config');
      const oldConfig = AiModelConfigService.getModelConfig(upperTask as any);

      try {
        const updated = AiModelConfigService.updateTaskConfig(upperTask as any, request.body || {});

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_MODEL_CONFIG_CHANGE',
          targetId: upperTask,
          payload: {
            task: upperTask,
            oldConfig: { provider: oldConfig.provider, modelName: oldConfig.modelName },
            newConfig: { provider: updated.provider, modelName: updated.modelName },
            changedAt: new Date(),
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Model AI untuk task ${upperTask} berhasil diubah ke ${updated.provider}/${updated.modelName}. Audit trail telah dicatat.`,
          data: updated,
        });
      } catch (err: any) {
        return reply.status(400).send({
          error: err.message || 'Bad Request: Perubahan konfigurasi model AI gagal.',
        });
      }
    }
  );

  /**
   * GET /api/admin/settings
   */
  fastify.get('/api/admin/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const { AiModelConfigService } = await import('../../config/ai-models.config');
    return reply.status(200).send({
      success: true,
      globalBotActive: AiModelConfigService.globalBotActive,
    });
  });

  /**
   * PATCH /api/admin/settings
   */
  fastify.patch(
    '/api/admin/settings',
    async (
      request: FastifyRequest<{
        Body: { globalBotActive: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const { globalBotActive } = request.body || {};
      if (globalBotActive === undefined || typeof globalBotActive !== 'boolean') {
        return reply.status(400).send({ error: 'Body must contain globalBotActive boolean value.' });
      }

      const { AiModelConfigService } = await import('../../config/ai-models.config');
      const oldVal = AiModelConfigService.globalBotActive;
      AiModelConfigService.globalBotActive = globalBotActive;

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'GLOBAL_BOT_TOGGLE',
        targetId: 'SYSTEM',
        payload: { oldVal, newVal: globalBotActive },
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        success: true,
        message: `Status respon AI bot otomatis berhasil diubah menjadi: ${globalBotActive ? 'ON' : 'OFF'}.`,
        globalBotActive,
      });
    }
  );

  /**
   * GET /api/admin/capi-config
   */
  fastify.get('/api/admin/capi-config', async (_request: FastifyRequest, reply: FastifyReply) => {
    const envPixel = process.env.FB_PIXEL_ID;
    const envToken = process.env.FB_CAPI_ACCESS_TOKEN;
    let tenant: any = null;

    try {
      tenant = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
    } catch (err) {
      console.warn('[CAPI CONFIG] DB unavailable, pakai env fallback:', (err as Error).message);
    }

    const metaPixelId = tenant?.meta_pixel_id || null;
    const hasCapiAccessToken = !!tenant?.meta_capi_access_token;
    const source = metaPixelId || hasCapiAccessToken ? 'db' : envPixel && envToken ? 'env' : 'none';

    return reply.status(200).send({
      success: true,
      data: {
        metaPixelId,
        hasCapiAccessToken,
        capiTokenSource: source,
        envPixelConfigured: !!envPixel,
        envTokenConfigured: !!envToken,
      },
    });
  });

  /**
   * PATCH /api/admin/capi-config
   */
  fastify.patch(
    '/api/admin/capi-config',
    async (
      request: FastifyRequest<{
        Body: { metaPixelId?: string | null; capiAccessToken?: string | null };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const { metaPixelId, capiAccessToken } = body;

      try {
        const existing = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
        const data: any = {};

        if (metaPixelId !== undefined) {
          data.meta_pixel_id = metaPixelId ? String(metaPixelId).trim() || null : null;
        }
        if (capiAccessToken !== undefined) {
          if (capiAccessToken) {
            const { encryptSecret } = await import('../../utils/encryption');
            data.meta_capi_access_token = encryptSecret(String(capiAccessToken).trim());
          } else {
            data.meta_capi_access_token = null;
          }
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

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_CAPI_CONFIG',
          targetId: DEFAULT_TENANT_ID,
          payload: {
            meta_pixel_id: tenant.meta_pixel_id || null,
            capi_token_configured: !!tenant.meta_capi_access_token,
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: 'Konfigurasi Meta Pixel & CAPI berhasil disimpan.',
          data: {
            metaPixelId: tenant.meta_pixel_id || null,
            hasCapiAccessToken: !!tenant.meta_capi_access_token,
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/ai-router
   */
  fastify.get('/api/admin/ai-router', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { AiRouterConfigService } = await import('../../config/ai-router-config');
      const cfg = AiRouterConfigService.getConfig(DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: cfg });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PATCH /api/admin/ai-router
   */
  fastify.patch(
    '/api/admin/ai-router',
    async (
      request: FastifyRequest<{
        Body: { enabled?: boolean; shadowMode?: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const patch: { enabled?: boolean; shadowMode?: boolean } = {};
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      if (typeof body.shadowMode === 'boolean') patch.shadowMode = body.shadowMode;

      if (Object.keys(patch).length === 0) {
        return reply.status(400).send({ error: 'Body harus berisi enabled dan/atau shadowMode (boolean).' });
      }

      try {
        const { AiRouterConfigService } = await import('../../config/ai-router-config');
        const cfg = await AiRouterConfigService.saveConfig(DEFAULT_TENANT_ID, patch);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_AI_ROUTER_CONFIG',
          targetId: DEFAULT_TENANT_ID,
          payload: cfg,
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Konfigurasi AI Router diperbarui: enabled=${cfg.enabled}, shadowMode=${cfg.shadowMode}.`,
          data: cfg,
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/ai-rollout-scope
   */
  fastify.get('/api/admin/ai-rollout-scope', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { AiEligibilityConfigService } = await import('../../config/ai-eligibility-config');
      const cfg = AiEligibilityConfigService.getConfig(DEFAULT_TENANT_ID);

      let summary = { totalCustomers: 0, newCustomers: 0, legacyCustomers: 0, silencedByScope: 0 };
      try {
        const [totalCustomers, newCustomers, silencedByScope] = await Promise.all([
          prisma.customer.count({ where: { tenant_id: DEFAULT_TENANT_ID } }),
          prisma.customer.count({
            where: { tenant_id: DEFAULT_TENANT_ID, created_at: { gte: cfg.ai_scope_cutoff_at } },
          }),
          prisma.conversation.count({
            where: {
              tenant_id: DEFAULT_TENANT_ID,
              is_human_handling: true,
              escalation_reason: AI_ELIGIBILITY_ESCALATION_REASON,
            },
          }),
        ]);
        summary = {
          totalCustomers,
          newCustomers,
          legacyCustomers: Math.max(0, totalCustomers - newCustomers),
          silencedByScope,
        };
      } catch (dbErr: any) {
        console.warn('[AI ROLLOUT SCOPE] DB offline, summary di-skip:', dbErr.message);
      }

      return reply.status(200).send({ success: true, data: cfg, summary });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PATCH /api/admin/ai-rollout-scope
   */
  fastify.patch(
    '/api/admin/ai-rollout-scope',
    async (
      request: FastifyRequest<{
        Body: { aiCustomerScope?: 'NEW_ONLY' | 'ALL'; aiScopeCutoffAt?: string };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const patch: { ai_customer_scope?: 'NEW_ONLY' | 'ALL'; ai_scope_cutoff_at?: Date } = {};
      if (body.aiCustomerScope === 'NEW_ONLY' || body.aiCustomerScope === 'ALL') {
        patch.ai_customer_scope = body.aiCustomerScope;
      }
      if (body.aiScopeCutoffAt && !isNaN(Date.parse(body.aiScopeCutoffAt))) {
        patch.ai_scope_cutoff_at = new Date(body.aiScopeCutoffAt);
      }

      if (Object.keys(patch).length === 0) {
        return reply
          .status(400)
          .send({ error: 'Body harus berisi aiCustomerScope (NEW_ONLY|ALL) dan/atau aiScopeCutoffAt (ISO date).' });
      }

      try {
        const { AiEligibilityConfigService } = await import('../../config/ai-eligibility-config');
        const cfg = await AiEligibilityConfigService.saveConfig(DEFAULT_TENANT_ID, patch);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_AI_ROLLOUT_SCOPE',
          targetId: DEFAULT_TENANT_ID,
          payload: cfg,
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `AI Rollout Scope diperbarui: scope=${cfg.ai_customer_scope}, cutoff=${cfg.ai_scope_cutoff_at.toISOString()}.`,
          data: cfg,
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/conversation-behavior
   */
  fastify.get('/api/admin/conversation-behavior', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { IdleGreetingConfigService } = await import('../../config/idle-greeting.config');
      const idleGreeting = IdleGreetingConfigService.getConfig(DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: { idleGreeting } });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PATCH /api/admin/conversation-behavior
   */
  fastify.patch(
    '/api/admin/conversation-behavior',
    async (
      request: FastifyRequest<{
        Body: {
          idleGreeting?: { enabled?: boolean; minHours?: number };
        };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const idlePatch: { enabled?: boolean; minHours?: number } = {};

      if (body.idleGreeting && typeof body.idleGreeting === 'object') {
        if (typeof body.idleGreeting.enabled === 'boolean') idlePatch.enabled = body.idleGreeting.enabled;
        if (typeof body.idleGreeting.minHours === 'number') idlePatch.minHours = body.idleGreeting.minHours;
      }

      if (Object.keys(idlePatch).length === 0) {
        return reply.status(400).send({
          error: 'Body harus berisi idleGreeting.enabled (boolean) dan/atau idleGreeting.minHours (number).',
        });
      }

      try {
        const { IdleGreetingConfigService } = await import('../../config/idle-greeting.config');
        const cfg = await IdleGreetingConfigService.saveConfig(DEFAULT_TENANT_ID, idlePatch);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_CONVERSATION_BEHAVIOR',
          targetId: DEFAULT_TENANT_ID,
          payload: { idleGreeting: cfg },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Konfigurasi perilaku percakapan diperbarui: idleGreeting.enabled=${cfg.enabled}, idleGreeting.minHours=${cfg.minHours}.`,
          data: { idleGreeting: cfg },
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/services
   */
  fastify.get('/api/admin/services', async (request, reply) => {
    const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
    const services = treatmentCatalogService.getAllServices(false);
    return reply.status(200).send({ success: true, count: services.length, data: services });
  });

  /**
   * POST /api/admin/services
   */
  fastify.post('/api/admin/services', async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
    const serviceData = request.body as any;

    if (!serviceData || !serviceData.id || !serviceData.name || serviceData.originalPrice === undefined) {
      return reply.status(400).send({
        error:
          'Data layanan tidak lengkap. Required fields: id, name, originalPrice, promoPrice, durationMinutes, ageTier, category',
      });
    }

    const updated = treatmentCatalogService.upsertService({
      id: serviceData.id,
      name: serviceData.name,
      category: serviceData.category || 'BABY',
      ageTier: serviceData.ageTier || { minAgeMonths: 0, maxAgeMonths: null, label: 'Umum' },
      durationMinutes: Number(serviceData.durationMinutes) || 45,
      originalPrice: Number(serviceData.originalPrice) || 0,
      promoPrice: Number(serviceData.promoPrice) || 0,
      description: serviceData.description || '',
      isActive: serviceData.isActive ?? true,
    });

    await auditService.logAdminAction({
      apiKey: (request as any).adminKeyUsed,
      adminIdentity: (request as any).adminIdentity,
      action: 'UPSERT_SERVICE',
      targetId: serviceData.id,
      payload: serviceData,
      ipAddress: request.ip,
    });

    return reply.status(200).send({ success: true, message: 'Service saved successfully', data: updated });
  });

  /**
   * PUT /api/admin/services/:id
   */
  fastify.put(
    '/api/admin/services/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
      const { id } = request.params;
      const body = request.body || {};
      const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
      const existing = treatmentCatalogService.getServiceById(id);
      if (!existing) {
        return reply.status(404).send({ error: 'Service not found' });
      }
      const updated = treatmentCatalogService.upsertService({
        ...existing,
        ...body,
        id,
      });
      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'UPDATE_CLINIC_SERVICE',
        targetId: id,
        payload: { name: updated.name },
        ipAddress: request.ip,
      });
      return reply.status(200).send({ success: true, data: updated });
    }
  );

  /**
   * DELETE /api/admin/services/:id
   */
  fastify.delete(
    '/api/admin/services/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
      const deleted = treatmentCatalogService.deleteService(id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Service not found' });
      }
      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'DELETE_CLINIC_SERVICE',
        targetId: id,
        ipAddress: request.ip,
      });
      return reply.status(200).send({ success: true, message: 'Service deleted successfully' });
    }
  );

  /**
   * GET /api/admin/delivery-tiers
   */
  fastify.get('/api/admin/delivery-tiers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { getDeliveryTiersFromDb } = await import('../../services/delivery.service');
      const tiers = await getDeliveryTiersFromDb(DEFAULT_TENANT_ID);
      return reply.status(200).send({
        success: true,
        data: tiers,
      });
    } catch (err: any) {
      const { activeDeliveryTiers } = await import('../../services/delivery.service');
      return reply.status(200).send({
        success: true,
        data: activeDeliveryTiers,
        note: 'Fallback file mode',
      });
    }
  });

  /**
   * POST /api/admin/delivery-tiers
   */
  fastify.post(
    '/api/admin/delivery-tiers',
    async (request: FastifyRequest<{ Body: { tiers: any[] } }>, reply: FastifyReply) => {
      const { tiers } = request.body || {};
      if (!tiers || !Array.isArray(tiers)) {
        return reply.status(400).send({ error: 'Body must contain tiers array' });
      }
      const { saveDeliveryTiersToDb } = await import('../../services/delivery.service');
      const success = await saveDeliveryTiersToDb(tiers, DEFAULT_TENANT_ID);
      if (!success) {
        return reply.status(500).send({ error: 'Failed to save delivery tiers' });
      }
      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'UPDATE_DELIVERY_TIERS',
        targetId: 'SYSTEM',
        ipAddress: request.ip,
      });
      return reply.status(200).send({ success: true, message: 'Delivery tiers updated successfully' });
    }
  );

  /**
   * PATCH /api/admin/follow-ups/:id/reschedule
   */
  fastify.patch(
    '/api/admin/follow-ups/:id/reschedule',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { scheduledAt: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { scheduledAt } = request.body || {};
      if (!scheduledAt) return reply.status(400).send({ error: 'scheduledAt is required' });

      try {
        const updated = await prisma.followUp.update({
          where: { id },
          data: { scheduled_at: new Date(scheduledAt), status: 'PENDING' },
        });
        return reply.status(200).send({ success: true, data: updated });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/follow-up-templates
   */
  fastify.get('/api/admin/follow-up-templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { followUpService } = await import('../../services/follow-up.service');
      const templates = await followUpService.getAllTemplates(DEFAULT_TENANT_ID);
      return reply.status(200).send({ success: true, data: templates });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PUT /api/admin/follow-up-templates
   */
  fastify.put(
    '/api/admin/follow-up-templates',
    async (
      request: FastifyRequest<{ Body: { type: string; variant: number; text: string } }>,
      reply: FastifyReply
    ) => {
      const { type, variant, text } = request.body || {};
      if (!type || !variant || !text) {
        return reply.status(400).send({ error: 'type, variant, dan text wajib diisi' });
      }

      try {
        const { followUpService } = await import('../../services/follow-up.service');
        await followUpService.saveTemplate(type, variant, text, DEFAULT_TENANT_ID);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_FOLLOWUP_TEMPLATE',
          targetId: `${type}#${variant}`,
          payload: { type, variant },
          ipAddress: request.ip,
        });

        return reply.status(200).send({ success: true, message: 'Template berhasil disimpan!' });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * DELETE /api/admin/follow-up-templates/:type/:variant
   */
  fastify.delete(
    '/api/admin/follow-up-templates/:type/:variant',
    async (
      request: FastifyRequest<{ Params: { type: string; variant: string } }>,
      reply: FastifyReply
    ) => {
      const { type, variant } = request.params;
      try {
        const { followUpService } = await import('../../services/follow-up.service');
        await followUpService.resetTemplate(type, parseInt(variant, 10), DEFAULT_TENANT_ID);
        return reply.status(200).send({ success: true, message: 'Template dikembalikan ke default.' });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/health
   */
  fastify.get('/api/admin/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const { wahaClient } = await import('../../integrations/waha/client');
    const wahaStatus = await wahaClient.getSessionStatus();
    const uptime = process.uptime();

    // Laporkan status Redis yang SEBENARNYA (bukan hardcode fallback) agar admin
    // bisa mendeteksi degradasi durable queue / live-chat / FAQ cache saat Redis turun.
    const { broadcastQueueService } = await import('../../services/broadcast-queue.service');
    const { faqCacheService } = await import('../../services/faq-cache.service');
    const { queueService } = await import('../../services/queue.service');
    const broadcastRedis = broadcastQueueService.isRedisEnabled();
    const faqCacheRedis = faqCacheService.isRedisEnabled();
    const messageQueueRedis = queueService.isRedisEnabled();
    const redisQueue = broadcastRedis && faqCacheRedis && messageQueueRedis
      ? 'ACTIVE'
      : 'IN_MEMORY_FALLBACK_ACTIVE';

    return reply.status(200).send({
      success: true,
      timestamp: new Date().toISOString(),
      wahaStatus,
      redisQueue,
      haversineLocationEngine: 'ACTIVE_MULTIPLIER_1.25X',
      telegramEmergencyAlerts: 'CONFIGURED',
      systemUptimeSeconds: uptime,
      data: {
        wahaStatus,
        redisQueue,
        redisDetail: {
          messageQueue: messageQueueRedis ? 'ACTIVE' : 'IN_MEMORY_FALLBACK_ACTIVE',
          broadcastQueue: broadcastRedis ? 'ACTIVE' : 'IN_MEMORY_FALLBACK_ACTIVE',
          faqCache: faqCacheRedis ? 'ACTIVE' : 'IN_MEMORY_FALLBACK_ACTIVE',
        },
        haversineLocationEngine: 'ACTIVE_MULTIPLIER_1.25X',
        telegramEmergencyAlerts: 'CONFIGURED',
        systemUptimeSeconds: uptime,
      },
    });
  });
}

