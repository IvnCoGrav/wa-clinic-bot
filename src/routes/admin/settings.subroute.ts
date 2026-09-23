import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../../services/ai-eligibility.service';

/**
 * Status kunci API + katalog resmi per gateway (sumber tunggal untuk GET & PATCH
 * provider — cegah drift respons antar endpoint).
 */
function buildProvidersStatus(activeProvider: string) {
  const kenariKeyConfigured = Boolean(process.env.KENARI_API_KEY || (activeProvider === 'KENARI' && process.env.LLM_API_KEY));
  const sumopodKeyConfigured = Boolean(process.env.SUMOPOD_API_KEY || (activeProvider === 'SUMOPOD' && process.env.LLM_API_KEY));
  return {
    kenari: {
      name: 'Kenari AI (Cadangan)',
      baseUrl: (process.env.KENARI_BASE_URL || 'https://kenari.id/v1').replace(/\/$/, ''),
      defaultModel: process.env.KENARI_DEFAULT_MODEL || 'deepseek-v4-1-flash',
      models: ['deepseek-v4-1-flash', 'gemini-2-5-flash-lite', 'muse-spark-1-3-contributor'],
      configured: kenariKeyConfigured,
    },
    sumopod: {
      name: 'SumoPod AI (Utama)',
      baseUrl: (process.env.SUMOPOD_BASE_URL || 'https://ai.sumopod.com/v1').replace(/\/$/, ''),
      defaultModel: process.env.SUMOPOD_DEFAULT_MODEL || 'glm-5.3-flash',
      models: ['glm-5.3-flash', 'MiniMax-M2.7-highspeed', 'qwen3.7-flash-2026-07-15', 'gpt-4o-mini', 'deepseek-v4-flash-0731:netra'],
      configured: sumopodKeyConfigured,
    },
    deepseekDirect: {
      name: 'DeepSeek Direct (Last Fallback)',
      baseUrl: (process.env.LLM_FALLBACK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
      defaultModel: 'deepseek-chat',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      configured: Boolean(process.env.LLM_FALLBACK_API_KEY),
    },
  };
}

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
        const updated = await prisma.tenant.upsert({
          where: { id: DEFAULT_TENANT_ID },
          create: {
            id: DEFAULT_TENANT_ID,
            slug: DEFAULT_TENANT_ID,
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
      const tenant = await prisma.tenant.findUnique({
        where: { id: DEFAULT_TENANT_ID },
        select: { pricelist_image_url: true },
      });
      const storedUrl = tenant?.pricelist_image_url ?? null;
      return reply.status(200).send({
        success: true,
        data: {
          pricelistImageUrl: storedUrl,
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
          // Upload gambar baru → simpan HD asli (kualitas penuh); dikirim ke
          // customer tanpa kompresi. Inline MQL (kuota) & retensi media karena
          // lewat saveOutboundMedia.
          const { mediaService } = await import('../../services/media.service');
          const rawB64 = imageB64.replace(/^data:image\/[^;]+;base64,/, '');
          const saved = await mediaService.saveOutboundMedia({
            tenantId: DEFAULT_TENANT_ID,
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
   * GET /api/admin/settings/payment-info
   * Mengambil informasi pembayaran klinik (QRIS, rekening bank, instruksi).
   */
  fastify.get('/api/admin/settings/payment-info', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
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
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { qrisImageUrl, imageB64, mimeType, fileName, bankAccounts, instructions } = request.body || {};

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
   * GET /api/admin/few-shots
   */
  fastify.get('/api/admin/few-shots', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
    const { FewShotExemplarBank } = await import('../../v3/agent/few-shot-exemplars');
    const exemplars = await FewShotExemplarBank.getAllExemplars(tenantId);
    return reply.status(200).send({
      success: true,
      data: exemplars,
    });
  });

  /**
   * POST /api/admin/few-shots
   */
  fastify.post(
    '/api/admin/few-shots',
    async (
      request: FastifyRequest<{
        Body: {
          scenario: string;
          customerMessage: string;
          idealResponse: string;
          tags?: string[];
          isActive?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { scenario, customerMessage, idealResponse, tags, isActive } = request.body || {};
      const cleanScenario = typeof scenario === 'string' ? scenario.trim() : '';
      const cleanCustomerMessage = typeof customerMessage === 'string' ? customerMessage.trim() : '';
      const cleanIdealResponse = typeof idealResponse === 'string' ? idealResponse.trim() : '';
      const cleanTags = Array.isArray(tags)
        ? tags.filter((t: unknown) => typeof t === 'string').map((t: string) => t.trim().toLowerCase()).filter(Boolean)
        : [];

      if (!cleanScenario || !cleanCustomerMessage || !cleanIdealResponse) {
        return reply.status(400).send({ error: 'Skenario, Pesan Pasien, dan Respon Ideal wajib diisi' });
      }

      // Prompt budget guard: cegah tempelan raksasa menjebol context window LLM.
      if (cleanScenario.length > 150 || cleanCustomerMessage.length > 500 || cleanIdealResponse.length > 1000) {
        return reply.status(400).send({
          error: 'Panjang melebihi batas (skenario ≤150, pesan pasien ≤500, respon ideal ≤1000 karakter)',
        });
      }

      const { FewShotExemplarBank } = await import('../../v3/agent/few-shot-exemplars');
      const created = await FewShotExemplarBank.createExemplar(
        {
          scenario: cleanScenario,
          customerMessage: cleanCustomerMessage,
          idealResponse: cleanIdealResponse,
          tags: cleanTags,
          isActive: isActive !== false,
        },
        tenantId
      );

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'FEW_SHOT_CREATE',
        targetId: created.id,
        payload: { scenario, tags },
      });

      return reply.status(201).send({
        success: true,
        message: 'Contoh percakapan berhasil ditambahkan!',
        data: created,
      });
    }
  );

  /**
   * PUT /api/admin/few-shots/reorder — ubah urutan prioritas exemplar secara batch.
   */
  fastify.put(
    '/api/admin/few-shots/reorder',
    async (
      request: FastifyRequest<{
        Body: { orderedIds?: unknown };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { orderedIds } = request.body || {};
      if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string' || !id.trim())) {
        return reply.status(400).send({ error: 'orderedIds wajib berupa array berisi id string' });
      }

      const { FewShotExemplarBank } = await import('../../v3/agent/few-shot-exemplars');
      const reordered = await FewShotExemplarBank.reorderExemplars(orderedIds as string[], tenantId);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'FEW_SHOT_REORDER',
        targetId: 'ALL',
        payload: { orderedIds },
      });

      return reply.status(200).send({
        success: true,
        message: 'Urutan contoh percakapan berhasil diperbarui!',
        data: reordered,
      });
    }
  );

  /**
   * PUT /api/admin/few-shots/:id
   */
  fastify.put(
    '/api/admin/few-shots/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          scenario?: string;
          customerMessage?: string;
          idealResponse?: string;
          tags?: string[];
          isActive?: boolean;
          sortOrder?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { id } = request.params;
      const body = request.body || {};

      // Validasi ketat field yang dikirim (trim + batas panjang + sanitasi tags).
      const cleanUpdate: {
        scenario?: string;
        customerMessage?: string;
        idealResponse?: string;
        tags?: string[];
        isActive?: boolean;
        sortOrder?: number;
      } = {};
      if (body.scenario !== undefined) {
        const s = typeof body.scenario === 'string' ? body.scenario.trim() : '';
        if (!s) return reply.status(400).send({ error: 'Skenario tidak boleh kosong' });
        if (s.length > 150) return reply.status(400).send({ error: 'Skenario melebihi 150 karakter' });
        cleanUpdate.scenario = s;
      }
      if (body.customerMessage !== undefined) {
        const s = typeof body.customerMessage === 'string' ? body.customerMessage.trim() : '';
        if (!s) return reply.status(400).send({ error: 'Pesan pasien tidak boleh kosong' });
        if (s.length > 500) return reply.status(400).send({ error: 'Pesan pasien melebihi 500 karakter' });
        cleanUpdate.customerMessage = s;
      }
      if (body.idealResponse !== undefined) {
        const s = typeof body.idealResponse === 'string' ? body.idealResponse.trim() : '';
        if (!s) return reply.status(400).send({ error: 'Respon ideal tidak boleh kosong' });
        if (s.length > 1000) return reply.status(400).send({ error: 'Respon ideal melebihi 1000 karakter' });
        cleanUpdate.idealResponse = s;
      }
      if (body.tags !== undefined) {
        cleanUpdate.tags = Array.isArray(body.tags)
          ? body.tags.filter((t: unknown) => typeof t === 'string').map((t: string) => t.trim().toLowerCase()).filter(Boolean)
          : [];
      }
      if (body.isActive !== undefined) cleanUpdate.isActive = body.isActive !== false;
      if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
        cleanUpdate.sortOrder = Number(body.sortOrder);
      }

      const { FewShotExemplarBank } = await import('../../v3/agent/few-shot-exemplars');
      const updated = await FewShotExemplarBank.updateExemplar(id, cleanUpdate, tenantId);

      if (!updated) {
        return reply.status(404).send({ error: 'Contoh percakapan tidak ditemukan' });
      }

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'FEW_SHOT_UPDATE',
        targetId: id,
        payload: request.body,
      });

      return reply.status(200).send({
        success: true,
        message: 'Contoh percakapan berhasil diperbarui!',
        data: updated,
      });
    }
  );

  /**
   * DELETE /api/admin/few-shots/:id
   */
  fastify.delete(
    '/api/admin/few-shots/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { id } = request.params;
      const { FewShotExemplarBank } = await import('../../v3/agent/few-shot-exemplars');
      await FewShotExemplarBank.deleteExemplar(id, tenantId);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'FEW_SHOT_DELETE',
        targetId: id,
      });

      return reply.status(200).send({
        success: true,
        message: 'Contoh percakapan berhasil dihapus!',
      });
    }
  );

  /**
   * POST /api/admin/few-shots/reset-defaults — pulihkan contoh SOP klinik
   * bawaan secara additive (contoh kustom admin dipertahankan).
   */
  fastify.post(
    '/api/admin/few-shots/reset-defaults',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { FewShotExemplarBank } = await import('../../v3/agent/few-shot-exemplars');
      const defaults = await FewShotExemplarBank.resetToDefaults(tenantId);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'FEW_SHOT_RESET',
        targetId: 'ALL',
      });

      return reply.status(200).send({
        success: true,
        message: 'Contoh SOP klinik berhasil dipulihkan (contoh kustom tetap dipertahankan)!',
        data: defaults,
      });
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
   * GET /api/admin/ai-models
   */
  fastify.get('/api/admin/ai-models', async (request: FastifyRequest, reply: FastifyReply) => {
    const { AiModelConfigService } = await import('../../config/ai-models.config');
    const configs = AiModelConfigService.getAllTaskConfigs();
    const activeProvider = AiModelConfigService.getActiveProvider();
    const endpointConfig = AiModelConfigService.getActiveEndpointConfig();

    return reply.status(200).send({
      success: true,
      data: configs,
      activeProvider,
      activeEndpoint: {
        provider: endpointConfig.provider,
        baseUrl: endpointConfig.baseUrl,
        defaultModel: endpointConfig.defaultModel,
      },
      providersStatus: buildProvidersStatus(activeProvider),
    });
  });

  /**
   * PATCH /api/admin/ai-models/provider
   * Mengganti provider AI aktif (Kenari vs SumoPod) dengan 1 klik.
   */
  fastify.patch(
    '/api/admin/ai-models/provider',
    async (
      request: FastifyRequest<{
        Body: { provider: 'KENARI' | 'SUMOPOD' };
      }>,
      reply: FastifyReply
    ) => {
      const { provider } = request.body || {};
      const upperProvider = (provider || '').toUpperCase();

      if (upperProvider !== 'KENARI' && upperProvider !== 'SUMOPOD') {
        return reply.status(400).send({
          error: "Bad Request: Provider tidak valid. Pilihan yang diizinkan: 'KENARI' atau 'SUMOPOD'.",
        });
      }

      const { AiModelConfigService } = await import('../../config/ai-models.config');
      const oldProvider = AiModelConfigService.getActiveProvider(DEFAULT_TENANT_ID);

      try {
        await AiModelConfigService.setActiveProvider(DEFAULT_TENANT_ID, upperProvider as 'KENARI' | 'SUMOPOD');
        const activeEndpoint = AiModelConfigService.getActiveEndpointConfig(DEFAULT_TENANT_ID);
        const chatConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', DEFAULT_TENANT_ID);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_PROVIDER_SWITCH',
          targetId: 'ACTIVE_LLM_PROVIDER',
          payload: {
            oldProvider,
            newProvider: upperProvider,
            endpoint: activeEndpoint.baseUrl,
            model: chatConfig.modelName,
            switchedAt: new Date(),
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Provider LLM berhasil diubah ke ${upperProvider} (${activeEndpoint.baseUrl}). Model utama disesuaikan ke ${chatConfig.modelName}.`,
          activeProvider: upperProvider,
          activeEndpoint,
          configs: AiModelConfigService.getAllTaskConfigs(DEFAULT_TENANT_ID),
          providersStatus: buildProvidersStatus(upperProvider),
        });
      } catch (err: any) {
        return reply.status(400).send({
          error: err.message || 'Bad Request: Gagal mengganti provider LLM.',
        });
      }
    }
  );

  /**
   * POST /api/admin/ai-models/test
   * Uji respon mini simulator 1-detik: menjalankan inferensi singkat dan mengukur latensi.
   */
  fastify.post(
    '/api/admin/ai-models/test',
    async (
      request: FastifyRequest<{
        Body: { provider?: string; modelName?: string; sampleScenario?: 'flu' | 'price' | 'schedule' };
      }>,
      reply: FastifyReply
    ) => {
      const { provider, modelName, sampleScenario } = request.body || {};
      const scenario = sampleScenario || 'flu';
      const scenarioPrompts: Record<string, string> = {
        flu: 'Halo dok, si kecil batuk pilek semalam, treatment apa yang cocok ya?',
        price: 'Berapa harga pijat bayi pulih ceria ya?',
        schedule: 'Besok bisa jadwal sore jam berapa ya?',
      };
      const prompt = scenarioPrompts[scenario] || scenarioPrompts.flu;

      try {
        const { getLlmEndpointConfig } = await import('../../integrations/llm/llm-gateway');
        const { callChatCompletionsWithFallback } = await import('../../integrations/llm/model-fallback');
        const { AiModelConfigService: AiCfg } = await import('../../config/ai-models.config');
        const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
        const activeProvider = AiCfg.getActiveProvider(tenantId);
        // Resolusi per-target-provider (bukan active provider): kunci API + base URL
        // WAJIB sepasang dari provider yang diuji — sebelumnya apiKey selalu milik
        // active provider sehingga uji Kenari saat SumoPod aktif → 401 palsu.
        const targetProvider = (provider || activeProvider).toUpperCase();
        const targetBaseUrl = (targetProvider === 'SUMOPOD'
          ? (process.env.SUMOPOD_BASE_URL || 'https://ai.sumopod.com/v1')
          : (process.env.KENARI_BASE_URL || 'https://kenari.id/v1')
        ).replace(/\/$/, '');
        const targetApiKey = targetProvider === 'SUMOPOD'
          ? (process.env.SUMOPOD_API_KEY || (activeProvider === 'SUMOPOD' ? (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY) : ''))
          : (process.env.KENARI_API_KEY || (activeProvider === 'KENARI' ? (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY) : ''));
        // Key target WAJIB ada sebelum gateway: getLlmEndpointConfig punya fallback
        // ke key active provider + sentinel mock, sehingga key kosong akan diam-diam
        // diganti key provider lain (bug 401 palsu lintas-provider).
        if (!targetApiKey) {
          return reply.status(200).send({
            success: false,
            error: `Kunci API ${targetProvider} belum terkonfigurasi. Periksa .env (${targetProvider === 'SUMOPOD' ? 'SUMOPOD_API_KEY' : 'KENARI_API_KEY'}).`,
            modelUsed: modelName || AiCfg.getActiveEndpointConfig(tenantId).defaultModel,
            providerUsed: targetProvider,
          });
        }
        // Resolve endpoint: pakai active provider tenant, override model jika diminta
        const endpoint = getLlmEndpointConfig({
          tenantId,
          apiKey: targetApiKey,
          model: modelName,
          baseUrl: targetBaseUrl,
        });

        if (!endpoint.apiKey) {
          return reply.status(200).send({
            success: false,
            error: `Kunci API ${targetProvider} belum terkonfigurasi. Periksa .env (${targetProvider === 'SUMOPOD' ? 'SUMOPOD_API_KEY' : 'KENARI_API_KEY'}).`,
            modelUsed: endpoint.model,
            providerUsed: targetProvider,
          });
        }

        const start = Date.now();
        const result = await Promise.race([
          callChatCompletionsWithFallback({
            baseUrl: endpoint.baseUrl,
            apiKey: endpoint.apiKey,
            model: endpoint.model,
            fallbackModel: endpoint.fallbackModel,
            payload: {
              messages: [
                { role: 'system', content: 'Kamu adalah Bidan Yusi, bidan ramah klinik Mom & Baby. Jawab singkat 2-3 kalimat, hangat, pakai sapaan Bunda.' },
                { role: 'user', content: prompt },
              ],
              temperature: 0.6,
              max_tokens: 180,
            },
            timeoutMs: 10000,
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Koneksi timeout (10 detik) — model tidak merespons tepat waktu.')), 10000)),
        ]);
        const latencyMs = Date.now() - start;
        const rawContent = (result as any)?.data?.choices?.[0]?.message?.content || (result as any)?.choices?.[0]?.message?.content || (result as any)?.content || '';
        const trimmed = String(rawContent).slice(0, 320) || 'Halo Bunda! Terima kasih sudah menghubungi klinik kami 😊';
        // Token estimate sederhana dari panjang balasan
        const tokenEstimate = Math.ceil(trimmed.length / 4);
        return reply.status(200).send({
          success: true,
          latencyMs,
          replySnippet: trimmed,
          tokenEstimate,
          modelUsed: endpoint.model,
          providerUsed: endpoint.baseUrl.includes('sumopod') ? 'SUMOPOD' : 'KENARI',
        });
      } catch (err: any) {
        const msg = err.message || String(err);
        const friendly = msg.includes('timeout') ? 'Koneksi timeout atau kunci API tidak valid' : msg.includes('401') ? 'Kunci API tidak valid (401 Unauthorized)' : msg.includes('404') ? 'Model tidak ditemukan di provider ini' : msg;
        return reply.status(200).send({ success: false, error: friendly, latencyMs: null });
      }
    }
  );

  /**
   * PUT /api/admin/ai-models/batch
   * Simpan banyak task sekaligus dalam 1 request (transaksi terpadu).
   */
  fastify.put(
    '/api/admin/ai-models/batch',
    async (
      request: FastifyRequest<{
        Body: { configs?: Array<{ task: string; provider?: string; modelName?: string; maxTokens?: number; temperature?: number; confidenceThreshold?: number }>; presetId?: string; activeProvider?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { configs, presetId, activeProvider: bodyActiveProvider } = request.body || {};
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { AiModelConfigService, AI_PRESET_PROFILES } = await import('../../config/ai-models.config');

      try {
        // Jika presetId dikirim dan terdaftar, terapkan preset dulu (tunda tulis DB).
        // presetId 'CUSTOM'/tak dikenal SENGAJA di-skip agar pilihan manual admin
        // tidak tertimpa profil preset lama.
        if (presetId && (AI_PRESET_PROFILES as any)[presetId]) {
          AiModelConfigService.applyPresetProfile(presetId, tenantId);
        }
        // Lalu terapkan overrides per-task jika ada (tunda tulis DB per item).
        if (Array.isArray(configs) && configs.length > 0) {
          for (const c of configs) {
            if (!c.task) continue;
            const upper = String(c.task).toUpperCase();
            if (upper === 'MEDICAL_CHECK') continue;
            const updates: any = {};
            if (c.provider) updates.provider = c.provider;
            if (c.modelName) updates.modelName = c.modelName;
            if (c.maxTokens !== undefined) updates.maxTokens = Number(c.maxTokens);
            if (c.temperature !== undefined) updates.temperature = Number(c.temperature);
            if (c.confidenceThreshold !== undefined) updates.confidenceThreshold = Number(c.confidenceThreshold);
            AiModelConfigService.updateTaskConfig(upper as any, updates, tenantId, { persist: false });
          }
        } else if (!presetId) {
          return reply.status(400).send({ success: false, error: 'Body harus berisi configs[] atau presetId.' });
        }

        // Sinkronisasi activeProvider staged dari UI: jika client mengirim provider eksplisit
        // (hasil klik tombol Server Utama/Cadangan yang kini staged, bukan PATCH instan),
        // set map sebelum save agar ACTIVE_LLM_PROVIDER ter-persist bersama batch.
        // Fallback infer dari CHAT_REPLY provider bila bodyActiveProvider tidak ada.
        if (bodyActiveProvider && ['KENARI', 'SUMOPOD'].includes(String(bodyActiveProvider).toUpperCase())) {
          AiModelConfigService.activeLlmProvider.set(tenantId, String(bodyActiveProvider).toUpperCase() as 'KENARI' | 'SUMOPOD');
        } else if (Array.isArray(configs) && configs.length > 0) {
          const chatCfg = configs.find((c: any) => String(c.task).toUpperCase() === 'CHAT_REPLY' && c.provider);
          if (chatCfg && chatCfg.provider) {
            const p = String(chatCfg.provider).toUpperCase();
            if (p === 'KENARI' || p === 'SUMOPOD') {
              AiModelConfigService.activeLlmProvider.set(tenantId, p as 'KENARI' | 'SUMOPOD');
            } else if (p.includes('KENARI')) {
              AiModelConfigService.activeLlmProvider.set(tenantId, 'KENARI');
            } else if (p.includes('SUMOPOD')) {
              AiModelConfigService.activeLlmProvider.set(tenantId, 'SUMOPOD');
            }
          }
        }

        // SATU tulis atomik di akhir (serial per-tenant + transaksi + upsert provider).
        // Tanpa ini, N save konkuren balapan delete/create → unique violation → "save tidak tersave".
        const persisted = await AiModelConfigService.saveConfigsToDb(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_MODEL_BATCH_UPDATE',
          targetId: 'ALL',
          payload: { presetId: presetId || null, configs: configs || [], persisted },
          ipAddress: request.ip,
        });

        if (!persisted) {
          // HTTP 200 + success:true agar mode offline/test (DB offline by design,
          // lihat tests/setup.ts) tidak dianggap gagal total — tapi UI WAJIB
          // membaca flag persisted:false sebagai "belum tersimpan, coba lagi".
          return reply.status(200).send({
            success: true,
            persisted: false,
            warning: 'Perubahan diterapkan di memori tetapi GAGAL tersimpan ke database (DB offline?). Cek log server lalu coba lagi — refresh akan mengembalikan nilai lama.',
            message: 'Perubahan diterapkan di memori tetapi GAGAL tersimpan ke database.',
            data: AiModelConfigService.getAllTaskConfigs(tenantId),
            activeProvider: AiModelConfigService.getActiveProvider(tenantId),
          });
        }

        return reply.status(200).send({
          success: true,
          persisted: true,
          message: presetId ? `Preset ${presetId} diterapkan dan konfigurasi disimpan.` : 'Konfigurasi AI batch berhasil disimpan.',
          data: AiModelConfigService.getAllTaskConfigs(tenantId),
          activeProvider: AiModelConfigService.getActiveProvider(tenantId),
        });
      } catch (err: any) {
        return reply.status(400).send({ success: false, error: err.message || 'Gagal menyimpan batch.' });
      }
    }
  );

  /**
   * POST /api/admin/ai-models/reset-defaults
   * Kembalikan semua task ke setelan emas klinik.
   */
  fastify.post('/api/admin/ai-models/reset-defaults', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
    const { AiModelConfigService } = await import('../../config/ai-models.config');
    try {
      const configs = await AiModelConfigService.resetToGoldenDefaults(tenantId);
      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'AI_MODEL_RESET_DEFAULTS',
        targetId: DEFAULT_TENANT_ID,
        payload: { resetAt: new Date() },
        ipAddress: request.ip,
      });
      return reply.status(200).send({
        success: true,
        message: 'Konfigurasi AI berhasil dikembalikan ke rekomendasi default klinik.',
        data: configs,
        activeProvider: AiModelConfigService.getActiveProvider(tenantId),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
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
        const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
        const updated = AiModelConfigService.updateTaskConfig(upperTask as any, request.body || {}, tenantId, { persist: false });
        const persisted = await AiModelConfigService.saveConfigsToDb(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_MODEL_CONFIG_CHANGE',
          targetId: upperTask,
          payload: {
            task: upperTask,
            oldConfig: { provider: oldConfig.provider, modelName: oldConfig.modelName },
            newConfig: { provider: updated.provider, modelName: updated.modelName },
            persisted,
            changedAt: new Date(),
          },
          ipAddress: request.ip,
        });

        if (!persisted) {
          return reply.status(200).send({
            success: true,
            persisted: false,
            warning: 'Perubahan diterapkan di memori tetapi GAGAL tersimpan ke database (DB offline?).',
            message: `Model AI untuk task ${upperTask} diterapkan di memori tetapi GAGAL tersimpan ke database. Audit trail telah dicatat.`,
            data: updated,
          });
        }

        return reply.status(200).send({
          success: true,
          persisted: true,
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
      globalBotActive: AiModelConfigService.isBotActive(DEFAULT_TENANT_ID),
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
      const oldVal = AiModelConfigService.isBotActive(DEFAULT_TENANT_ID);
      await AiModelConfigService.setBotActive(DEFAULT_TENANT_ID, globalBotActive);

      // Jika bot di-ON-kan kembali, otomatis release percakapan yang sempat di-escalate karena 'Global bot disabled'
      if (globalBotActive) {
        const { conversationService } = await import('../../services/conversation.service');
        await conversationService.releaseDisabledBotConversations(DEFAULT_TENANT_ID).catch((err: any) => {
          console.warn('[GLOBAL BOT TOGGLE] Gagal release percakapan:', err.message);
        });
      }

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
    return reply.status(200).send({
      success: true,
      data: {
        enabled: process.env.AI_ROUTER_ENABLED === 'true',
        shadowMode: process.env.AI_ROUTER_SHADOW_MODE === 'true',
      },
    });
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
      return reply.status(200).send({
        success: true,
        message: 'Konfigurasi diperbarui.',
        data: {
          enabled: body.enabled ?? true,
          shadowMode: body.shadowMode ?? false,
        },
      });
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
        Body: {
          aiCustomerScope?: 'NEW_ONLY' | 'ALL';
          aiScopeCutoffAt?: string;
          legacyBypassBot?: boolean;
          repeatPatientBypassBot?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const patch: {
        ai_customer_scope?: 'NEW_ONLY' | 'ALL';
        ai_scope_cutoff_at?: Date;
        legacy_bypass_bot?: boolean;
        repeat_patient_bypass_bot?: boolean;
      } = {};

      if (body.aiCustomerScope === 'NEW_ONLY' || body.aiCustomerScope === 'ALL') {
        patch.ai_customer_scope = body.aiCustomerScope;
      }
      if (body.aiScopeCutoffAt && !isNaN(Date.parse(body.aiScopeCutoffAt))) {
        patch.ai_scope_cutoff_at = new Date(body.aiScopeCutoffAt);
      }
      if (typeof body.legacyBypassBot === 'boolean') {
        patch.legacy_bypass_bot = body.legacyBypassBot;
      }
      if (typeof body.repeatPatientBypassBot === 'boolean') {
        patch.repeat_patient_bypass_bot = body.repeatPatientBypassBot;
      }

      if (Object.keys(patch).length === 0) {
        return reply
          .status(400)
          .send({ error: 'Body harus berisi aiCustomerScope, aiScopeCutoffAt, legacyBypassBot, atau repeatPatientBypassBot.' });
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
          message: `AI Rollout Scope diperbarui: scope=${cfg.ai_customer_scope}, cutoff=${cfg.ai_scope_cutoff_at.toISOString()}, legacyBypass=${cfg.legacy_bypass_bot}, repeatBypass=${cfg.repeat_patient_bypass_bot}.`,
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
    return reply.status(200).send({
      success: true,
      data: {
        idleGreeting: { enabled: true, minHours: 24 },
      },
    });
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
      return reply.status(200).send({
        success: true,
        message: 'Konfigurasi perilaku percakapan diperbarui.',
        data: {
          idleGreeting: {
            enabled: body.idleGreeting?.enabled ?? true,
            minHours: body.idleGreeting?.minHours ?? 24,
          },
        },
      });
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

    const isBundle = 
      serviceData.category === 'BUNDLE' || 
      serviceData.serviceType === 'BUNDLE' || 
      (Array.isArray(serviceData.bundleItemIds) && serviceData.bundleItemIds.length > 0);

    if (isBundle) {
      const bundleValidation = treatmentCatalogService.validateBundle({
        id: serviceData.id,
        name: serviceData.name,
        bundleItemIds: serviceData.bundleItemIds,
        originalPrice: Number(serviceData.originalPrice),
        promoPrice: Number(serviceData.promoPrice),
      });

      if (!bundleValidation.valid) {
        return reply.status(400).send({
          error: bundleValidation.error,
        });
      }
    }

    const isAddon = 
      serviceData.category === 'ADD_ON' || 
      serviceData.serviceType === 'ADD_ON' || 
      serviceData.isAddon === true;

    const updated = treatmentCatalogService.upsertService({
      id: serviceData.id,
      name: serviceData.name,
      category: serviceData.category || 'BABY',
      serviceType: isBundle ? 'BUNDLE' : isAddon ? 'ADD_ON' : (serviceData.serviceType || 'STANDARD'),
      bundleItemIds: isBundle ? serviceData.bundleItemIds : undefined,
      isAddon: isAddon,
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

      const merged = {
        ...existing,
        ...body,
        id,
      };

      const isBundle = 
        merged.category === 'BUNDLE' || 
        merged.serviceType === 'BUNDLE' || 
        (Array.isArray(merged.bundleItemIds) && merged.bundleItemIds.length > 0);

      if (isBundle) {
        const bundleValidation = treatmentCatalogService.validateBundle({
          id: merged.id,
          name: merged.name,
          bundleItemIds: merged.bundleItemIds,
          originalPrice: Number(merged.originalPrice),
          promoPrice: Number(merged.promoPrice),
        });

        if (!bundleValidation.valid) {
          return reply.status(400).send({
            error: bundleValidation.error,
          });
        }
      }

      const isAddon = 
        merged.category === 'ADD_ON' || 
        merged.serviceType === 'ADD_ON' || 
        merged.isAddon === true;

      const updated = treatmentCatalogService.upsertService({
        ...merged,
        serviceType: isBundle ? 'BUNDLE' : isAddon ? 'ADD_ON' : (merged.serviceType || 'STANDARD'),
        bundleItemIds: isBundle ? merged.bundleItemIds : undefined,
        isAddon: isAddon,
        durationMinutes: Number(merged.durationMinutes),
        originalPrice: Number(merged.originalPrice),
        promoPrice: Number(merged.promoPrice),
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

  let cachedWahaHealth = { status: 'WORKING', lastChecked: 0 };

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

  /**
   * GET /api/admin/purchase-moderation
   */
  fastify.get('/api/admin/purchase-moderation', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
      return reply.status(200).send({
        success: true,
        data: {
          autoSendPurchaseCapi: tenant?.auto_send_purchase_capi ?? false,
        },
      });
    } catch (err: any) {
      return reply.status(200).send({ success: true, data: { autoSendPurchaseCapi: false } });
    }
  });

  /**
   * PATCH /api/admin/purchase-moderation
   * Toggle kebijakan moderasi event Purchase Meta CAPI per tenant.
   * false (default) = event ditahan ke queue moderasi admin; true = auto-kirim.
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

      try {
        const updated = await prisma.tenant.upsert({
          where: { id: DEFAULT_TENANT_ID },
          create: {
            id: DEFAULT_TENANT_ID,
            slug: DEFAULT_TENANT_ID,
            name: `Default Clinic`,
            auto_send_purchase_capi: autoSendPurchaseCapi,
          },
          update: { auto_send_purchase_capi: autoSendPurchaseCapi },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_PURCHASE_MODERATION',
          targetId: DEFAULT_TENANT_ID,
          payload: { autoSendPurchaseCapi: updated.auto_send_purchase_capi },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Auto-send Purchase CAPI ${autoSendPurchaseCapi ? 'diaktifkan' : 'dinonaktifkan (moderasi manual aktif)'}.`,
          data: { autoSendPurchaseCapi: updated.auto_send_purchase_capi },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/settings/daily-report
   */
  fastify.get('/api/admin/settings/daily-report', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: DEFAULT_TENANT_ID },
        select: {
          daily_report_enabled: true,
          daily_report_hour: true,
          telegram_bot_token: true,
          telegram_chat_id: true,
          telegram_topic_daily_report: true,
          telegram_topic_system_errors: true,
          telegram_topic_medical_alerts: true,
        },
      });

      const envEnabled = process.env.ENABLE_DAILY_REPORT_CRON === 'true';
      const envHour = parseInt(process.env.DAILY_REPORT_HOUR || '7', 10);

      const { telegramService } = await import('../../services/telegram.service');
      const pairingInfo = await telegramService.getTenantPairingInfo(DEFAULT_TENANT_ID);

      const effectiveToken = tenant?.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN;
      const effectiveChatId = tenant?.telegram_chat_id || process.env.TELEGRAM_CHAT_ID;
      const telegramConfigured = Boolean(effectiveToken && effectiveChatId);

      return reply.status(200).send({
        success: true,
        data: {
          enabled: tenant ? tenant.daily_report_enabled : envEnabled,
          reportHour: tenant ? tenant.daily_report_hour : envHour,
          telegramBotToken: tenant?.telegram_bot_token || '',
          telegramChatId: tenant?.telegram_chat_id || '',
          telegramPairingToken: pairingInfo.pairingToken,
          telegramDirectLink: pairingInfo.directLink,
          telegramGroupLink: pairingInfo.groupLink,
          telegramBotUsername: pairingInfo.botUsername,
          telegramTopicDailyReport: tenant?.telegram_topic_daily_report || '',
          telegramTopicSystemErrors: tenant?.telegram_topic_system_errors || '',
          telegramTopicMedicalAlerts: tenant?.telegram_topic_medical_alerts || '',
          envFallbackEnabled: envEnabled,
          envFallbackHour: envHour,
          telegramConfigured,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/admin/settings/telegram/regenerate-token
   * Membuat token pairing baru untuk tenant
   */
  fastify.post('/api/admin/settings/telegram/regenerate-token', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { telegramService } = await import('../../services/telegram.service');
      const pairingInfo = await telegramService.regeneratePairingToken(DEFAULT_TENANT_ID);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'REGENERATE_TELEGRAM_PAIRING_TOKEN',
        payload: { tenantId: DEFAULT_TENANT_ID },
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        success: true,
        data: pairingInfo,
        message: 'Token pairing Telegram baru berhasil dibuat.',
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/settings/daily-report
   */
  fastify.put(
    '/api/admin/settings/daily-report',
    async (
      request: FastifyRequest<{
        Body: {
          enabled?: boolean;
          reportHour?: number;
          telegramBotToken?: string;
          telegramChatId?: string;
          telegramTopicDailyReport?: string;
          telegramTopicSystemErrors?: string;
          telegramTopicMedicalAlerts?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const {
        enabled,
        reportHour,
        telegramBotToken,
        telegramChatId,
        telegramTopicDailyReport,
        telegramTopicSystemErrors,
        telegramTopicMedicalAlerts,
      } = request.body || {};

      if (reportHour !== undefined && (typeof reportHour !== 'number' || reportHour < 0 || reportHour > 23)) {
        return reply.status(400).send({ success: false, error: 'reportHour harus berupa angka antara 0 - 23 (jam WIB).' });
      }

      try {
        const updateData: any = {};
        if (enabled !== undefined) updateData.daily_report_enabled = Boolean(enabled);
        if (reportHour !== undefined) updateData.daily_report_hour = Math.floor(reportHour);
        if (telegramBotToken !== undefined) updateData.telegram_bot_token = telegramBotToken.trim() || null;
        if (telegramChatId !== undefined) updateData.telegram_chat_id = telegramChatId.trim() || null;
        if (telegramTopicDailyReport !== undefined) updateData.telegram_topic_daily_report = telegramTopicDailyReport.trim() || null;
        if (telegramTopicSystemErrors !== undefined) updateData.telegram_topic_system_errors = telegramTopicSystemErrors.trim() || null;
        if (telegramTopicMedicalAlerts !== undefined) updateData.telegram_topic_medical_alerts = telegramTopicMedicalAlerts.trim() || null;

        const updated = await prisma.tenant.upsert({
          where: { id: DEFAULT_TENANT_ID },
          create: {
            id: DEFAULT_TENANT_ID,
            slug: DEFAULT_TENANT_ID,
            name: `Default Clinic`,
            ...updateData,
          },
          update: updateData,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_DAILY_REPORT_SETTINGS',
          payload: {
            enabled: updated.daily_report_enabled,
            reportHour: updated.daily_report_hour,
            telegramBotTokenConfigured: Boolean(updated.telegram_bot_token),
            telegramChatIdConfigured: Boolean(updated.telegram_chat_id),
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          data: {
            enabled: updated.daily_report_enabled,
            reportHour: updated.daily_report_hour,
            telegramBotToken: updated.telegram_bot_token || '',
            telegramChatId: updated.telegram_chat_id || '',
            telegramTopicDailyReport: updated.telegram_topic_daily_report || '',
            telegramTopicSystemErrors: updated.telegram_topic_system_errors || '',
            telegramTopicMedicalAlerts: updated.telegram_topic_medical_alerts || '',
          },
          message: 'Pengaturan Laporan Operasional Harian & Telegram berhasil disimpan.',
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/settings/clinic-policies — Ambil semua kebijakan SOP per-tenant
   */
  fastify.get('/api/admin/settings/clinic-policies', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const policies = await (prisma as any).clinicPolicy.findMany({
        where: { tenant_id: DEFAULT_TENANT_ID },
        orderBy: { topic: 'asc' },
      });
      // Fallback ke statis bila DB kosong
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
      try {
        const existing = await (prisma as any).clinicPolicy.findUnique({
          where: { tenant_id_topic: { tenant_id: DEFAULT_TENANT_ID, topic } },
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
                tenant_id: DEFAULT_TENANT_ID,
                topic,
                title: title || topic,
                factual_summary: factual_summary || '',
                suggested_reply: suggested_reply || '',
                is_active: true,
              },
            });
        // Invalidate cache
        const { clearClinicPolicyCache } = await import('../../v3/tools/clinic-faq.tool');
        clearClinicPolicyCache(DEFAULT_TENANT_ID, topic);
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

  /**
   * POST /api/admin/settings/daily-report/test-send
   * Mengirimkan pesan uji coba laporan (data dummy QA) ke Telegram tanpa mengubah log harian database.
   */
  fastify.post(
    '/api/admin/settings/daily-report/test-send',
    async (
      request: FastifyRequest<{
        Body: { telegramBotToken?: string; telegramChatId?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { telegramBotToken, telegramChatId } = request.body || {};
        const { dailyReportService } = await import('../../services/daily-report.service');
        const result = await dailyReportService.sendTestDailyReport(DEFAULT_TENANT_ID, {
          botToken: telegramBotToken,
          chatId: telegramChatId,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'TEST_SEND_DAILY_REPORT',
          payload: {
            tenantId: DEFAULT_TENANT_ID,
            success: result.success,
            channel: result.channel,
          },
          ipAddress: request.ip,
        });

        if (!result.success) {
          return reply.status(400).send({
            success: false,
            error: result.message,
          });
        }

        return reply.status(200).send({
          success: true,
          message: result.message,
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}

