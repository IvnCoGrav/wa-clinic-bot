import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { auditService } from '../../../services/audit.service';
import { resolveTenantId } from './shared';

export async function registerIntegrationsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/admin/settings/meta-purchase-policy
   * Mengambil kebijakan pengiriman CAPI Purchase untuk repeat customer.
   */
  fastify.get('/api/admin/settings/meta-purchase-policy', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveTenantId(request);
      const { getTenantMetaPurchasePolicy } = await import('../../../services/capi.service');
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
   * Memperbarui kebijakan pengiriman CAPI Purchase.
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
        const tenantId = resolveTenantId(request);
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
      const tenantId = resolveTenantId(request);

      try {
        const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
        const data: any = {};

        if (metaPixelId !== undefined) {
          data.meta_pixel_id = metaPixelId ? String(metaPixelId).trim() || null : null;
        }
        if (capiAccessToken !== undefined) {
          if (capiAccessToken) {
            const { encryptSecret } = await import('../../../utils/encryption');
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
   * GET /api/admin/settings/daily-report
   */
  fastify.get('/api/admin/settings/daily-report', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveTenantId(request);
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
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

      const { telegramService } = await import('../../../services/telegram.service');
      const pairingInfo = await telegramService.getTenantPairingInfo(tenantId);

      const effectiveToken = tenant?.telegram_bot_token
        ? (await import('../../../utils/encryption')).decryptSecretCompat(tenant.telegram_bot_token)
        : process.env.TELEGRAM_BOT_TOKEN;
      const effectiveChatId = tenant?.telegram_chat_id || process.env.TELEGRAM_CHAT_ID;
      const telegramConfigured = Boolean(effectiveToken && effectiveChatId);

      return reply.status(200).send({
        success: true,
        data: {
          enabled: tenant ? tenant.daily_report_enabled : envEnabled,
          reportHour: tenant ? tenant.daily_report_hour : envHour,
          telegramBotTokenConfigured: Boolean(tenant?.telegram_bot_token),
          telegramBotToken: '',
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
      const tenantId = resolveTenantId(request);
      const { telegramService } = await import('../../../services/telegram.service');
      const pairingInfo = await telegramService.regeneratePairingToken(tenantId);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'REGENERATE_TELEGRAM_PAIRING_TOKEN',
        targetId: tenantId,
        payload: { tenantId },
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

      const tenantId = resolveTenantId(request);
      try {
        const updateData: any = {};
        if (enabled !== undefined) updateData.daily_report_enabled = Boolean(enabled);
        if (reportHour !== undefined) updateData.daily_report_hour = Math.floor(reportHour);
        if (telegramBotToken !== undefined && String(telegramBotToken).trim()) {
          const { encryptSecretIfPossible } = await import('../../../utils/encryption');
          updateData.telegram_bot_token = encryptSecretIfPossible(String(telegramBotToken).trim());
        }
        if (telegramChatId !== undefined) updateData.telegram_chat_id = telegramChatId.trim() || null;
        if (telegramTopicDailyReport !== undefined) updateData.telegram_topic_daily_report = telegramTopicDailyReport.trim() || null;
        if (telegramTopicSystemErrors !== undefined) updateData.telegram_topic_system_errors = telegramTopicSystemErrors.trim() || null;
        if (telegramTopicMedicalAlerts !== undefined) updateData.telegram_topic_medical_alerts = telegramTopicMedicalAlerts.trim() || null;

        const updated = await prisma.tenant.upsert({
          where: { id: tenantId },
          create: {
            id: tenantId,
            slug: tenantId,
            name: `Clinic ${tenantId}`,
            ...updateData,
          },
          update: updateData,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_DAILY_REPORT_SETTINGS',
          targetId: tenantId,
          payload: {
            enabled: updated.daily_report_enabled,
            reportHour: updated.daily_report_hour,
            telegramBotTokenConfigured: Boolean(updated.telegram_bot_token),
            telegramChatIdConfigured: Boolean(updated.telegram_chat_id),
            tenantId,
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          data: {
            enabled: updated.daily_report_enabled,
            reportHour: updated.daily_report_hour,
            telegramBotTokenConfigured: Boolean(updated.telegram_bot_token),
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
   * GET /api/admin/settings/notifications — konfigurasi Nightly Watchdog.
   */
  fastify.get('/api/admin/settings/notifications', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(request);
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          nightly_report_enabled: true,
          nightly_report_hour: true,
          nightly_report_minute: true,
          admin_whatsapp_numbers: true,
          notification_channels: true,
          whatsapp_provider: true,
        },
      });
      return reply.status(200).send({
        success: true,
        data: {
          nightlyReportEnabled: tenant?.nightly_report_enabled ?? false,
          nightlyReportHour: tenant?.nightly_report_hour ?? 21,
          nightlyReportMinute: tenant?.nightly_report_minute ?? 0,
          adminWhatsappNumbers: tenant?.admin_whatsapp_numbers || [],
          notificationChannels: tenant?.notification_channels || ['TELEGRAM'],
          whatsappProvider: tenant?.whatsapp_provider || 'WAHA',
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/settings/notifications — simpan konfigurasi Nightly Watchdog.
   */
  fastify.put(
    '/api/admin/settings/notifications',
    async (
      request: FastifyRequest<{
        Body: {
          nightlyReportEnabled?: boolean;
          nightlyReportHour?: number;
          nightlyReportMinute?: number;
          adminWhatsappNumbers?: string[];
          notificationChannels?: string[];
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = resolveTenantId(request);
      const {
        nightlyReportEnabled,
        nightlyReportHour,
        nightlyReportMinute,
        adminWhatsappNumbers,
        notificationChannels,
      } = request.body || {};

      if (nightlyReportHour !== undefined && (typeof nightlyReportHour !== 'number' || nightlyReportHour < 0 || nightlyReportHour > 23)) {
        return reply.status(400).send({ success: false, error: 'nightlyReportHour harus 0-23 (jam WIB).' });
      }
      if (nightlyReportMinute !== undefined && (typeof nightlyReportMinute !== 'number' || nightlyReportMinute < 0 || nightlyReportMinute > 59)) {
        return reply.status(400).send({ success: false, error: 'nightlyReportMinute harus 0-59.' });
      }
      if (adminWhatsappNumbers !== undefined && !Array.isArray(adminWhatsappNumbers)) {
        return reply.status(400).send({ success: false, error: 'adminWhatsappNumbers harus array nomor.' });
      }

      try {
        const { normalizePhoneToE164 } = await import('../../../services/capi.service');
        const cleanNumbers = Array.isArray(adminWhatsappNumbers)
          ? adminWhatsappNumbers
              .map((n) => normalizePhoneToE164(String(n || '')))
              .filter((n) => n.length >= 8)
          : undefined;
        const allowedChannels = ['TELEGRAM', 'WHATSAPP', 'SYSTEM'];
        const cleanChannels = Array.isArray(notificationChannels)
          ? notificationChannels.map((c) => String(c).toUpperCase()).filter((c) => allowedChannels.includes(c))
          : undefined;

        const updateData: any = {};
        if (nightlyReportEnabled !== undefined) updateData.nightly_report_enabled = Boolean(nightlyReportEnabled);
        if (nightlyReportHour !== undefined) updateData.nightly_report_hour = Math.floor(nightlyReportHour);
        if (nightlyReportMinute !== undefined) updateData.nightly_report_minute = Math.floor(nightlyReportMinute);
        if (cleanNumbers !== undefined) updateData.admin_whatsapp_numbers = cleanNumbers;
        if (cleanChannels !== undefined) updateData.notification_channels = cleanChannels;

        const updated = await prisma.tenant.upsert({
          where: { id: tenantId },
          create: { id: tenantId, slug: tenantId, name: 'Default Clinic', ...updateData },
          update: updateData,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_NOTIFICATION_SETTINGS',
          targetId: tenantId,
          payload: {
            nightlyReportEnabled: updated.nightly_report_enabled,
            nightlyReportHour: updated.nightly_report_hour,
            numbersCount: (updated.admin_whatsapp_numbers || []).length,
            channels: updated.notification_channels,
          },
          ipAddress: request.ip,
          tenantId,
        });

        return reply.status(200).send({
          success: true,
          message: 'Pengaturan notifikasi berhasil disimpan.',
          data: {
            nightlyReportEnabled: updated.nightly_report_enabled,
            nightlyReportHour: updated.nightly_report_hour,
            nightlyReportMinute: updated.nightly_report_minute,
            adminWhatsappNumbers: updated.admin_whatsapp_numbers || [],
            notificationChannels: updated.notification_channels || [],
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/settings/notifications/test — kirim simulasi (data dummy) untuk verifikasi kanal.
   */
  fastify.post('/api/admin/settings/notifications/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(request);
    try {
      const { notificationDeliveryService } = await import('../../../services/notification-delivery.service');
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, telegram_chat_id: true, admin_whatsapp_numbers: true, notification_channels: true },
      });

      const testMsg = `🧪 [TEST] Notifikasi Klinik\n\nIni pesan uji coba Nightly Watchdog (data dummy). Jika Anda menerima ini, kanal notifikasi aktif.\nWaktu: ${new Date().toISOString()}`;
      const results: any[] = [];

      const channels = tenant?.notification_channels || ['TELEGRAM'];
      if (channels.includes('TELEGRAM') && tenant?.telegram_chat_id) {
        const r = await notificationDeliveryService.send({
          tenantId,
          channel: 'TELEGRAM',
          recipient: tenant.telegram_chat_id,
          type: 'TEST_SIMULATION',
          title: 'Test Notifikasi',
          messageContent: testMsg,
          metadata: { is_test: true },
        });
        results.push({ channel: 'TELEGRAM', logId: r.logId, status: r.status, success: r.success, error: r.error });
      }
      if (channels.includes('WHATSAPP')) {
        for (const num of tenant?.admin_whatsapp_numbers || []) {
          const r = await notificationDeliveryService.send({
            tenantId,
            channel: 'WHATSAPP',
            recipient: num,
            type: 'TEST_SIMULATION',
            title: 'Test Notifikasi',
            messageContent: testMsg,
            metadata: { is_test: true },
          });
          results.push({ channel: 'WHATSAPP', recipient: num, logId: r.logId, status: r.status, success: r.success, error: r.error });
        }
      }

      if (results.length === 0) {
        return reply.status(200).send({ success: false, message: 'Tidak ada kanal terkonfigurasi untuk diuji. Isi Chat ID Telegram atau nomor WhatsApp admin.', data: results });
      }

      const anySent = results.some((r) => r.status === 'SENT');
      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'TEST_NOTIFICATION_SEND',
        targetId: tenantId,
        payload: { results },
        ipAddress: request.ip,
        tenantId,
      });

      return reply.status(200).send({
        success: anySent,
        message: anySent ? 'Pesan uji coba terkirim.' : 'Pesan uji coba gagal/di-skip (lihat detail kanal).',
        data: results,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/admin/settings/notifications/logs — riwayat pengiriman notifikasi.
   */
  fastify.get('/api/admin/settings/notifications/logs', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(request);
    try {
      const rows = await prisma.adminNotificationLog.findMany({
        where: { tenant_id: tenantId },
        orderBy: { sent_at: 'desc' },
        take: 100,
      });
      return reply.status(200).send({ success: true, data: rows });
    } catch (err: any) {
      return reply.status(200).send({ success: true, data: [], note: `DB offline: ${err?.message}` });
    }
  });

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
        const tenantId = resolveTenantId(request);
        const { telegramBotToken, telegramChatId } = request.body || {};
        const { dailyReportService } = await import('../../../services/daily-report.service');
        const result = await dailyReportService.sendTestDailyReport(tenantId, {
          botToken: telegramBotToken,
          chatId: telegramChatId,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'TEST_SEND_DAILY_REPORT',
          targetId: tenantId,
          payload: {
            tenantId,
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
