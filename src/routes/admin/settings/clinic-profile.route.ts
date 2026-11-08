import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { DEFAULT_TENANT_ID } from '../../../config/tenant';
import { auditService } from '../../../services/audit.service';
import { resolveTenantId } from './shared';

export async function registerClinicProfileRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/admin/settings/mql
   */
  fastify.get('/api/admin/settings/mql', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { customerService } = await import('../../../services/customer.service');
      const settings = await customerService.getMqlSettings(resolveTenantId(request));
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
        const { customerService } = await import('../../../services/customer.service');
        const updated = await customerService.updateMqlSettings(resolveTenantId(request), {
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
  fastify.get('/api/admin/settings/media', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { mediaService } = await import('../../../services/media.service');
      let tenantRetention: number | null = null;
      try {
        const tenant = await prisma.tenant.findUnique({ where: { id: resolveTenantId(request) } });
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
        const tenantId = resolveTenantId(request);
        const updated = await prisma.tenant.upsert({
          where: { id: tenantId },
          create: {
            id: tenantId,
            slug: tenantId,
            name: `Default Clinic`,
            media_retention_days: Math.floor(mediaRetentionDays),
          },
          update: { media_retention_days: Math.floor(mediaRetentionDays) },
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
      const { getPricelistImageUrl, DEFAULT_PRICELIST_IMAGE } = await import('../../../services/pricelist-config.service');
      const tenantId = resolveTenantId(request);
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { pricelist_image_url: true },
      });
      const storedUrl = tenant?.pricelist_image_url ?? null;
      return reply.status(200).send({
        success: true,
        data: {
          pricelistImageUrl: storedUrl,
          effectiveUrl: await getPricelistImageUrl(tenantId),
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
          const { mediaService } = await import('../../../services/media.service');
          const rawB64 = imageB64.replace(/^data:image\/[^;]+;base64,/, '');
          const saved = await mediaService.saveOutboundMedia({
            tenantId: resolveTenantId(request),
            imageB64: rawB64,
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

        const { setPricelistImageUrl } = await import('../../../services/pricelist-config.service');
        const result = await setPricelistImageUrl(resolveTenantId(request), storedUrl);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_PRICELIST_IMAGE',
          targetId: resolveTenantId(request),
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
   * GET /api/admin/settings/pricelist-promo
   * Mengambil konfigurasi promo pricelist & logo brand tenant.
   */
  fastify.get('/api/admin/settings/pricelist-promo', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveTenantId(request);
      const {
        getPricelistPromoConfigAsync,
        DISABLED_PRICELIST_PROMO,
      } = await import('../../../config/pricelist-promo');

      const tenant = await (prisma as any).tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });
      const currentSettings = (tenant?.settings as any) || {};
      const brandLogoUrl = currentSettings.brand?.logoUrl || null;
      const promo = await getPricelistPromoConfigAsync(tenantId);

      return reply.status(200).send({
        success: true,
        data: {
          promo,
          brandLogoUrl,
          defaults: DISABLED_PRICELIST_PROMO,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/settings/pricelist-promo
   * Memperbarui konfigurasi promo pricelist & logo brand tenant.
   */
  fastify.put(
    '/api/admin/settings/pricelist-promo',
    async (
      request: FastifyRequest<{
        Body: {
          promo?: any;
          brandLogoUrl?: string | null;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = resolveTenantId(request);
        const { promo, brandLogoUrl } = request.body || {};

        if (brandLogoUrl !== undefined && brandLogoUrl !== null) {
          const trimmedLogo = typeof brandLogoUrl === 'string' ? brandLogoUrl.trim() : '';
          if (trimmedLogo) {
            const isValid = /^https?:\/\//i.test(trimmedLogo) || /^\/assets\/[a-zA-Z0-9._-]+$/i.test(trimmedLogo);
            if (!isValid) {
              return reply.status(400).send({
                success: false,
                error: 'brandLogoUrl harus berupa URL publik (http/https) atau path /assets/...',
              });
            }
          }
        }

        const {
          sanitizePricelistPromoConfig,
          DISABLED_PRICELIST_PROMO,
          __clearPricelistPromoCacheForTest,
        } = await import('../../../config/pricelist-promo');
        const { __clearBrandCacheForTest } = await import('../../../config/brand');

        const tenant = await (prisma as any).tenant.findUnique({
          where: { id: tenantId },
          select: { settings: true },
        });

        const currentSettings = (tenant?.settings as Record<string, any>) || {};
        const existingBrand = currentSettings.brand || {};
        const updatedBrand = { ...existingBrand };

        if (brandLogoUrl !== undefined) {
          if (brandLogoUrl === null || (typeof brandLogoUrl === 'string' && !brandLogoUrl.trim())) {
            delete updatedBrand.logoUrl;
          } else {
            updatedBrand.logoUrl = (brandLogoUrl as string).trim();
          }
        }

        let updatedPromo = currentSettings.promo;
        if (promo !== undefined) {
          updatedPromo = sanitizePricelistPromoConfig(promo);
        }

        const updatedSettings = {
          ...currentSettings,
          ...(promo !== undefined ? { promo: updatedPromo } : {}),
          brand: updatedBrand,
        };

        await (prisma as any).tenant.update({
          where: { id: tenantId },
          data: { settings: updatedSettings },
        });

        __clearPricelistPromoCacheForTest(tenantId);
        __clearBrandCacheForTest(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_PRICELIST_PROMO_SETTINGS',
          targetId: tenantId,
          payload: {
            promo: updatedPromo,
            brandLogoUrl: updatedBrand.logoUrl || null,
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: 'Pengaturan promo pricelist & logo berhasil diperbarui.',
          data: {
            promo: updatedPromo || DISABLED_PRICELIST_PROMO,
            brandLogoUrl: updatedBrand.logoUrl || null,
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/settings/payment-info
   * Mengambil informasi pembayaran klinik (QRIS, rekening bank, instruksi).
   */
  fastify.get('/api/admin/settings/payment-info', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { StaffReservationService } = await import('../../../services/staff-reservation.service');
      const paymentInfo = await StaffReservationService.getPaymentInfo(tenantId);
      return reply.status(200).send({
        success: true,
        data: paymentInfo,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/settings/payment-info
   * Memperbarui informasi pembayaran klinik (QRIS image, bank accounts, instruksi).
   * Menerima upload base64 (imageB64) untuk gambar QRIS, atau URL string (qrisImageUrl).
   */
  fastify.put(
    '/api/admin/settings/payment-info',
    {
      bodyLimit: 12 * 1024 * 1024,
    },
    async (
      request: FastifyRequest<{
        Body: {
          qrisImageUrl?: string | null;
          imageB64?: string;
          mimeType?: string;
          fileName?: string;
          bankAccounts?: Array<{ bank: string; accountNumber: string; accountName: string }>;
          instructions?: string;
          customTemplate?: string | null;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { qrisImageUrl, imageB64, mimeType, fileName, bankAccounts, instructions, customTemplate } = request.body || {};

      try {
        let finalQrisUrl: string | null | undefined = undefined;

        if (imageB64) {
          const { mediaService } = await import('../../../services/media.service');
          const rawB64 = imageB64.replace(/^data:image\/[^;]+;base64,/, '');
          const saved = await mediaService.saveOutboundMedia({
            tenantId,
            imageB64: rawB64,
            mimeType: mimeType || 'image/png',
            fileName: fileName || 'qris-klinik.png',
          });
          finalQrisUrl = saved.hdUrl;
        } else if (qrisImageUrl !== undefined) {
          finalQrisUrl = typeof qrisImageUrl === 'string' ? qrisImageUrl.trim() || null : null;
        }

        // Ambil data settings tenant saat ini
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { settings: true },
        });

        const currentSettings = (tenant?.settings as any) || {};
        const existingPaymentInfo = currentSettings.paymentInfo || {};

        const updatedPaymentInfo = {
          qrisImageUrl: finalQrisUrl !== undefined
            ? finalQrisUrl
            : existingPaymentInfo.qrisImageUrl || null,
          bankAccounts: Array.isArray(bankAccounts)
            ? bankAccounts.map((b) => ({
                bank: String(b.bank || '').trim(),
                accountNumber: String(b.accountNumber || '').trim(),
                accountName: String(b.accountName || '').trim(),
              })).filter((b) => b.bank && b.accountNumber)
            : existingPaymentInfo.bankAccounts || [],
          instructions: instructions !== undefined
            ? (instructions ? String(instructions).trim() : undefined)
            : existingPaymentInfo.instructions,
          customTemplate: customTemplate !== undefined
            ? (typeof customTemplate === 'string' && customTemplate.trim() ? customTemplate : null)
            : (existingPaymentInfo.customTemplate ?? null),
        };

        const updatedSettings = {
          ...currentSettings,
          paymentInfo: updatedPaymentInfo,
        };

        await prisma.tenant.update({
          where: { id: tenantId },
          data: { settings: updatedSettings },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_PAYMENT_INFO_SETTINGS',
          targetId: tenantId,
          payload: updatedPaymentInfo,
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: 'Informasi pembayaran klinik berhasil diperbarui.',
          data: updatedPaymentInfo,
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/customer-service
   */
  fastify.get('/api/admin/customer-service', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(request);
    const tenant =
      (await prisma.tenant.findUnique({
        where: { id: tenantId },
      })) || (await prisma.tenant.findFirst());

    return reply.status(200).send({
      success: true,
      data: {
        csName: tenant?.cs_name || 'Cs Yusi',
        whatsappNumber: tenant?.whatsapp_number || process.env.DEFAULT_WHATSAPP_PHONE || '',
        formatVisit: tenant?.format_visit || 'Promo[%ID%]',
        greetingsText: (tenant as any)?.greetings_text || tenant?.format_visit || 'Promo [%ID%]',
        formatCheckout: tenant?.format_checkout || 'list untuk reservasi :',
        formatPurchase: tenant?.format_purchase || 'Payment',
        formatValue: tenant?.format_value || 'Treatment = %VALUE%',
        landingDomain: (tenant as any)?.landing_domain || '',
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
      greetingsText?: string;
      formatCheckout?: string;
      formatPurchase?: string;
      formatValue?: string;
      landingDomain?: string;
    };

    const tenantId = resolveTenantId(request);
    let tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
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
        ...(body.greetingsText !== undefined ? { greetings_text: body.greetingsText } : {}),
        ...(body.formatCheckout !== undefined ? { format_checkout: body.formatCheckout } : {}),
        ...(body.formatPurchase !== undefined ? { format_purchase: body.formatPurchase } : {}),
        ...(body.formatValue !== undefined ? { format_value: body.formatValue } : {}),
        ...(body.landingDomain !== undefined ? { landing_domain: body.landingDomain } : {}),
      } as any,
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
        landingDomain: (updated as any).landing_domain || '',
      },
    });
  });

  /**
   * GET /api/admin/settings
   */
  fastify.get('/api/admin/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const { AiModelConfigService } = await import('../../../config/ai-models.config');
    let brand: { businessName: string; botDisplayName: string } | null = null;
    try {
      const { getBrandIdentityAsync } = await import('../../../config/brand');
      const identity = await getBrandIdentityAsync(resolveTenantId(request));
      brand = { businessName: identity.businessName, botDisplayName: identity.botDisplayName };
    } catch (brandErr: any) {
      console.warn('[SETTINGS] Gagal memuat brand tenant:', brandErr?.message || brandErr);
    }
    const tenantId = resolveTenantId(request);
    return reply.status(200).send({
      success: true,
      globalBotActive: AiModelConfigService.isBotActive(tenantId),
      brand,
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

      const tenantId = resolveTenantId(request);
      const { AiModelConfigService } = await import('../../../config/ai-models.config');
      const oldVal = AiModelConfigService.isBotActive(tenantId);
      await AiModelConfigService.setBotActive(tenantId, globalBotActive);

      if (globalBotActive) {
        const { conversationService } = await import('../../../services/conversation.service');
        await conversationService.releaseDisabledBotConversations(tenantId).catch((err: any) => {
          console.warn('[GLOBAL BOT TOGGLE] Gagal release percakapan:', err.message);
        });
      }

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'GLOBAL_BOT_TOGGLE',
        targetId: tenantId,
        payload: { oldVal, newVal: globalBotActive, tenantId },
        ipAddress: request.ip,
      });

      try {
        const { getLiveChatHub } = await import('../../../services/live-chat-hub.service');
        await getLiveChatHub()
          .publish({
            type: 'bot.active_changed' as any,
            tenantId,
            payload: { globalBotActive },
          } as any)
          .catch(() => {});
      } catch {
        // Best-effort
      }

      return reply.status(200).send({
        success: true,
        message: `Status respon AI bot otomatis berhasil diubah menjadi: ${globalBotActive ? 'ON' : 'OFF'}.`,
        globalBotActive,
      });
    }
  );

  /**
   * GET /api/admin/settings/clinic-policies — Ambil semua kebijakan SOP per-tenant
   */
  fastify.get('/api/admin/settings/clinic-policies', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const policies = await (prisma as any).clinicPolicy.findMany({
        where: { tenant_id: tenantId },
        orderBy: { topic: 'asc' },
      });
      if (!policies || policies.length === 0) {
        const { getStaticFallbackTopics } = await import('../../../v3/tools/clinic-faq.tool');
        const fallback = getStaticFallbackTopics();
        return reply.status(200).send({ success: true, data: fallback, source: 'fallback' });
      }
      return reply.status(200).send({ success: true, data: policies });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/settings/clinic-policies/:topic — Edit summary & template teks kebijakan
   */
  fastify.put(
    '/api/admin/settings/clinic-policies/:topic',
    async (
      request: FastifyRequest<{ Params: { topic: string }; Body: { factual_summary?: string; suggested_reply?: string; title?: string } }>,
      reply: FastifyReply
    ) => {
      const { topic } = request.params;
      const { factual_summary, suggested_reply, title } = request.body || {};
      if (!factual_summary && !suggested_reply) {
        return reply.status(400).send({ success: false, error: 'factual_summary atau suggested_reply wajib diisi' });
      }
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      try {
        const existing = await (prisma as any).clinicPolicy.findUnique({
          where: { tenant_id_topic: { tenant_id: tenantId, topic } },
        });
        const data: any = {};
        if (factual_summary !== undefined) data.factual_summary = factual_summary;
        if (suggested_reply !== undefined) data.suggested_reply = suggested_reply;
        if (title !== undefined) data.title = title;
        data.is_active = true;
        const policy = existing
          ? await (prisma as any).clinicPolicy.update({ where: { id: existing.id }, data })
          : await (prisma as any).clinicPolicy.create({
              data: {
                tenant_id: tenantId,
                topic,
                title: title || topic,
                factual_summary: factual_summary || '',
                suggested_reply: suggested_reply || '',
                is_active: true,
              },
            });
        const { clearClinicPolicyCache } = await import('../../../v3/tools/clinic-faq.tool');
        clearClinicPolicyCache(tenantId, topic);
        if (topic === 'greeting') {
          try {
            const { invalidateGreetingTemplateCache } = await import('../../../services/greeting-template.service');
            invalidateGreetingTemplateCache(tenantId);
          } catch {}
        }
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_CLINIC_POLICY',
          targetId: topic,
          payload: data,
          ipAddress: request.ip,
        });
        return reply.status(200).send({ success: true, data: policy });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}
