import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { auditService } from '../../services/audit.service';
import { requireTenantId, resolveTenantId } from './settings-helpers';

let cachedWahaHealth = { status: 'WORKING', lastChecked: 0 };

export async function settingsGeneralRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/settings/mql
   */
  fastify.get('/api/admin/settings/mql', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { customerService } = await import('../../services/customer.service');
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
        const { customerService } = await import('../../services/customer.service');
        const updated = await customerService.updateMqlSettings(requireTenantId(request), {
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
      const { mediaService } = await import('../../services/media.service');
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
        const tenantId = requireTenantId(request);
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
      const { getPricelistImageUrl, DEFAULT_PRICELIST_IMAGE } = await import('../../services/pricelist-config.service');
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
   */
  fastify.put(
    '/api/admin/settings/pricelist-image',
    {
      bodyLimit: 12 * 1024 * 1024,
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
          const { mediaService } = await import('../../services/media.service');
          const rawB64 = imageB64.replace(/^data:image\/[^;]+;base64,/, '');
          const saved = await mediaService.saveOutboundMedia({
            tenantId: requireTenantId(request),
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

        const { setPricelistImageUrl } = await import('../../services/pricelist-config.service');
        const result = await setPricelistImageUrl(requireTenantId(request), storedUrl);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_PRICELIST_IMAGE',
          targetId: requireTenantId(request),
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
   */
  fastify.get('/api/admin/settings/pricelist-promo', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveTenantId(request);
      const {
        getPricelistPromoConfigAsync,
        DISABLED_PRICELIST_PROMO,
      } = await import('../../config/pricelist-promo');

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
        const tenantId = requireTenantId(request);
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
        } = await import('../../config/pricelist-promo');
        const { __clearBrandCacheForTest } = await import('../../config/brand');

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
   * GET /api/admin/settings/meta-purchase-policy
   */
  fastify.get('/api/admin/settings/meta-purchase-policy', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveTenantId(request);
      const { getTenantMetaPurchasePolicy } = await import('../../services/capi.service');
      const policy = await getTenantMetaPurchasePolicy(tenantId);
      return reply.status(200).send({
        success: true,
        data: {
          policy,
          options: [
            {
              value: 'DUAL_EVENT',
              label: 'Dual Event (Disarankan)',
              description:
                'Order pertama dikirim sebagai Purchase (target optimasi akuisisi), repeat order dikirim sebagai ReturningCustomerPurchase sehingga sinyal LTV pelanggan lama tetap terkirim tanpa mengotori metrik CAC.',
            },
            {
              value: 'SUPPRESS_REPEAT',
              label: 'Akuisisi Murni (Tanpa Sinyal Repeat)',
              description:
                'Repeat order tidak dikirim sama sekali ke Meta. Metrik CAC bersih, tetapi sinyal pembeli lama dan potensi LTV hilang dari optimizer.',
            },
            {
              value: 'ALL_WITH_TAG',
              label: 'Kirim Semua + opt_out',
              description:
                'Semua order tetap dikirim sebagai Purchase dengan opt_out=true pada repeat order. Perhatian: opt_out hanya mengeluarkan event dari optimasi delivery; event tetap dihitung di laporan atribusi (angka Purchase tidak berkurang).',
            },
          ],
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/settings/meta-purchase-policy
   */
  fastify.put(
    '/api/admin/settings/meta-purchase-policy',
    async (
      request: FastifyRequest<{
        Body: {
          policy: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = requireTenantId(request);
        const { policy } = request.body || {};

        const validPolicies = ['SUPPRESS_REPEAT', 'DUAL_EVENT', 'ALL_WITH_TAG'];
        if (!policy || !validPolicies.includes(policy)) {
          return reply.status(400).send({
            success: false,
            error: `Kebijakan tidak valid. Pilihan yang tersedia: ${validPolicies.join(', ')}`,
          });
        }

        const tenant = await (prisma as any).tenant.findUnique({
          where: { id: tenantId },
          select: { settings: true },
        });

        if (!tenant) {
          return reply.status(404).send({
            success: false,
            error: `Tenant dengan ID ${tenantId} tidak ditemukan.`,
          });
        }

        const currentSettings = (tenant.settings as Record<string, any>) || {};
        const updatedSettings = {
          ...currentSettings,
          metaPurchasePolicy: policy,
        };

        await (prisma as any).tenant.update({
          where: { id: tenantId },
          data: { settings: updatedSettings },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_META_PURCHASE_POLICY',
          targetId: tenantId,
          payload: {
            previousPolicy: currentSettings.metaPurchasePolicy || 'DUAL_EVENT',
            newPolicy: policy,
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: 'Kebijakan Meta Purchase CAPI berhasil diperbarui.',
          data: {
            policy,
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/settings/payment-info
   */
  fastify.get('/api/admin/settings/payment-info', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveTenantId(request);
      const { StaffReservationService } = await import('../../services/staff-reservation.service');
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
      const tenantId = requireTenantId(request);
      const { qrisImageUrl, imageB64, mimeType, fileName, bankAccounts, instructions, customTemplate } = request.body || {};

      try {
        let finalQrisUrl: string | null | undefined = undefined;

        if (imageB64) {
          const { mediaService } = await import('../../services/media.service');
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
   * GET /api/admin/settings
   */
  fastify.get('/api/admin/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const { AiModelConfigService } = await import('../../config/ai-models.config');
    let brand: { businessName: string; botDisplayName: string } | null = null;
    try {
      const { getBrandIdentityAsync } = await import('../../config/brand');
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

      const tenantId = requireTenantId(request);
      const { AiModelConfigService } = await import('../../config/ai-models.config');
      const oldVal = AiModelConfigService.isBotActive(tenantId);
      await AiModelConfigService.setBotActive(tenantId, globalBotActive);

      if (globalBotActive) {
        const { conversationService } = await import('../../services/conversation.service');
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
        const { getLiveChatHub } = await import('../../services/live-chat-hub.service');
        await getLiveChatHub()
          .publish({
            type: 'bot.active_changed' as any,
            tenantId,
            payload: { globalBotActive },
          } as any)
          .catch(() => {});
      } catch {
        // Best-effort: perubahan status sudah tersimpan.
      }

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
  fastify.get('/api/admin/capi-config', async (request: FastifyRequest, reply: FastifyReply) => {
    const envPixel = process.env.FB_PIXEL_ID;
    const envToken = process.env.FB_CAPI_ACCESS_TOKEN;
    let tenant: any = null;
    const tenantId = resolveTenantId(request);

    try {
      tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
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
      const tenantId = requireTenantId(request);

      try {
        const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
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
          ? await prisma.tenant.update({ where: { id: tenantId }, data })
          : await prisma.tenant.create({
              data: {
                id: tenantId,
                slug: tenantId,
                name: `Clinic ${tenantId}`,
                ...data,
              },
            });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_CAPI_CONFIG',
          targetId: tenantId,
          payload: {
            meta_pixel_id: tenant.meta_pixel_id || null,
            capi_token_configured: !!tenant.meta_capi_access_token,
            tenantId,
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
   * GET /api/admin/health
   */
  fastify.get('/api/admin/health', async (request: FastifyRequest, reply: FastifyReply) => {
    let wahaStatus = cachedWahaHealth.status;
    const now = Date.now();
    if (now - cachedWahaHealth.lastChecked > 10000) {
      try {
        const { wahaClient } = await import('../../integrations/waha/client');
        wahaStatus = await Promise.race([
          wahaClient.getSessionStatus(),
          new Promise<string>((resolve) => setTimeout(() => resolve(cachedWahaHealth.status), 1200))
        ]);
        cachedWahaHealth = { status: wahaStatus, lastChecked: now };
      } catch (_) {}
    }
    const uptime = process.uptime();

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

  /**
   * GET /api/admin/purchase-moderation
   */
  fastify.get('/api/admin/purchase-moderation', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveTenantId(request);
      await prisma.tenant.findUnique({ where: { id: tenantId } });
      return reply.status(200).send({
        success: true,
        deprecated: true,
        note: 'Queue-First: seluruh event Purchase wajib lewat antrean moderasi /capi-queue',
        data: {
          autoSendPurchaseCapi: false,
          deprecated: true,
        },
      });
    } catch {
      return reply.status(200).send({ success: true, data: { autoSendPurchaseCapi: false, deprecated: true } });
    }
  });

  /**
   * PATCH /api/admin/purchase-moderation
   */
  fastify.patch(
    '/api/admin/purchase-moderation',
    async (
      request: FastifyRequest<{
        Body: { autoSendPurchaseCapi: boolean };
      }>,
      reply: FastifyReply
    ) => {
      const { autoSendPurchaseCapi } = request.body || {};
      if (typeof autoSendPurchaseCapi !== 'boolean') {
        return reply.status(400).send({ error: 'Body harus berisi autoSendPurchaseCapi (boolean).' });
      }

      const tenantId = requireTenantId(request);
      try {
        await prisma.tenant.upsert({
          where: { id: tenantId },
          create: {
            id: tenantId,
            slug: tenantId,
            name: `Clinic ${tenantId}`,
            auto_send_purchase_capi: false,
          },
          update: { auto_send_purchase_capi: false },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_PURCHASE_MODERATION',
          targetId: tenantId,
          payload: { autoSendPurchaseCapi: false, requested: autoSendPurchaseCapi, policy: 'QUEUE_FIRST', tenantId },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          deprecated: true,
          note: 'Queue-First: seluruh event Purchase masuk antrean moderasi /capi-queue.',
          message: 'Kebijakan Queue-First aktif: seluruh transaksi diarahkan ke antrean moderasi CAPI.',
          data: { autoSendPurchaseCapi: false, deprecated: true },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/settings/clinic-policies
   */
  fastify.get('/api/admin/settings/clinic-policies', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveTenantId(request);
      const policies = await (prisma as any).clinicPolicy.findMany({
        where: { tenant_id: tenantId },
        orderBy: { topic: 'asc' },
      });
      if (!policies || policies.length === 0) {
        const { getStaticFallbackTopics } = await import('../../v3/tools/clinic-faq.tool');
        const fallback = getStaticFallbackTopics();
        return reply.status(200).send({ success: true, data: fallback, source: 'fallback' });
      }
      return reply.status(200).send({ success: true, data: policies });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/settings/clinic-policies/:topic
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
      const tenantId = requireTenantId(request);
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
        const { clearClinicPolicyCache } = await import('../../v3/tools/clinic-faq.tool');
        clearClinicPolicyCache(tenantId, topic);
        if (topic === 'greeting') {
          try {
            const { invalidateGreetingTemplateCache } = await import('../../services/greeting-template.service');
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
