import Fastify from 'fastify';
import dotenv from 'dotenv';
import { webhookRoutes } from './routes/webhook.route';
import { wabaWebhookRoutes } from './routes/waba-webhook.route';
import { adminRoutes } from './routes/admin.route';
import { staffRoutes } from './routes/staff.route';
import { healthRoutes } from './routes/health.route';
import { trackingRoutes } from './routes/tracking.route';
import { landingRoutes } from './routes/landing.route';
import { mediaRoutes } from './routes/media.route';
import { telegramWebhookRoutes } from './routes/telegram-webhook.route';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import { initializeConsoleWrapper } from './utils/context';
import { installLogBuffer } from './utils/log-buffer';

dotenv.config();
// URUTAN PENTING: installLogBuffer HARUS sebelum initializeConsoleWrapper.
// Keduanya menimpa console.log/warn/error; kalau buffer dipasang di atas wrapper
// konteks (yang punya marker __contextWrapped/original), pemanggilan ulang
// initializeConsoleWrapper akan me-re-wrap buffer dan membuat rekursi tak hingga.
// Urutan benar = buffer paling dalam, context wrapper paling luar.
installLogBuffer();
initializeConsoleWrapper();

// Rehydrate persistent logs asynchronously on startup (non-blocking)
import('./utils/log-buffer').then(({ rehydrateLogBuffer }) => {
  rehydrateLogBuffer().catch(() => {});
});
import('./utils/llm-execution-logger').then(({ rehydrateLlmBuffer }) => {
  rehydrateLlmBuffer().catch(() => {});
});

export function buildApp() {
  if (!process.env.ADMIN_API_KEY) {
    throw new Error('Critical Configuration Missing: ADMIN_API_KEY environment variable must be defined for secure admin API endpoints.');
  }

  const webhookSecret = process.env.WAHA_WEBHOOK_SECRET;
  if (!webhookSecret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Critical Security Configuration Missing: WAHA_WEBHOOK_SECRET must be defined in production environment.');
    } else {
      console.warn('\n⚠️ [SECURITY WARNING] WAHA_WEBHOOK_SECRET environment variable is not defined. Webhook endpoint will accept requests without secret token validation.\n');
    }
  }

  const wabaAppSecret = process.env.WABA_APP_SECRET;
  if (!wabaAppSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('\n⚠️ [SECURITY NOTICE] WABA_APP_SECRET environment variable is not defined globally. WABA webhook requests will rely on per-tenant DB secrets or fail-closed.\n');
    } else {
      console.warn('\n⚠️ [SECURITY WARNING] WABA_APP_SECRET environment variable is not defined. WABA webhook endpoint will skip signature verification in dev mode.\n');
    }
  }

  const app = Fastify({
    logger: {
      level: process.env.FASTIFY_LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : (process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info')),
    },
  });

  // Simpan raw body (Buffer) untuk verifikasi X-Hub-Signature-256 Meta.
  // Meta menandatangani bytes asli request — re-stringify JSON.parse mengubah
  // urutan kunci/whitespace sehingga HMAC selalu mismatch di production.
  // Registrasi content-type string (bukan regex) agar menimpa parser default
  // Fastify utk 'application/json' (matching string menang atas regex).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch (err: any) {
      err.statusCode = 400;
      done(err);
    }
  });


  // Register HTTP Response Compression (Gzip & Deflate untuk payload > 1KB)
  app.register(compress, {
    threshold: 1024,
    encodings: ['gzip', 'deflate'],
  });

  // Register Rate Limiting (global protection for public endpoints)
  app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    allowList: (request) => {
      const url = request.url || '';
      // Webhooks WAHA/WABA mengirim ratusan event bertubi-tubi saat WA connect/sync
      if (url.startsWith('/webhook') || url.startsWith('/api/webhook')) {
        return true;
      }
      // SSE Real-time stream events
      if (url.includes('/events') || url.includes('/stream')) {
        return true;
      }
      // Static assets & SPA
      if (url.startsWith('/admin') || url.startsWith('/assets') || url.startsWith('/landing')) {
        return true;
      }
      // Internal Admin Dashboard API endpoints (termasuk reservasi, customer, dan live chat)
      if (url.startsWith('/api/admin')) {
        return true;
      }
      return false;
    },
    keyGenerator: (request) => {
      const apiKey = request.headers['x-api-key'] as string;
      const clientIp = request.ip;
      if (apiKey) {
        return `${apiKey}-${clientIp}`;
      }
      return clientIp;
    },

    errorResponseBuilder: (request, context) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Please try again in ${context.after}.`,
      };
    },
  });


  // Alias: /admin (tanpa trailing slash) → SPA admin dashboard di /admin/*.
  // SPA + assets + tambahan login.html diserve handler internal di admin.route.ts.
  app.get('/admin', async (_req, reply) => reply.redirect('/admin/'));

  // Register Webhook, Admin, Health, & Tracking Routes
  app.register(webhookRoutes);
  app.register(wabaWebhookRoutes);
  app.register(adminRoutes);
  app.register(staffRoutes);
  app.register(healthRoutes);
  app.register(trackingRoutes);
  app.register(landingRoutes);
  app.register(mediaRoutes);
  app.register(telegramWebhookRoutes);

  return app;
}

if (require.main === module) {
  const server = buildApp();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const HOST = process.env.HOST || '0.0.0.0';

  server.listen({ port: PORT, host: HOST }, async (err, address) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
    console.log(`\n🚀 WhatsApp Clinic Bot Engine listening on ${address}`);
    console.log(`📌 Webhook URL: ${address}/webhook`);
    console.log(`📌 Admin Endpoint: ${address}/api/admin/human-handling-conversations\n`);

    // Init data tenant (SaaS-ready): seed catalog & delivery tiers dari DB
    try {
      const { DEFAULT_TENANT_ID } = await import('./config/tenant');
      const { loadServicesFromDb } = await import('./services/treatment-catalog.service');
      const { getDeliveryTiersFromDb } = await import('./services/delivery.service');
      const { loadPersonaFromDb } = await import('./config/persona');
      const { AiModelConfigService } = await import('./config/ai-models.config');
      const { AiRouterConfigService } = await import('./config/ai-router-config');
      const { IdleGreetingConfigService } = await import('./config/idle-greeting.config');
      const { AiEligibilityConfigService } = await import('./config/ai-eligibility-config');
      await loadServicesFromDb(DEFAULT_TENANT_ID);
      await getDeliveryTiersFromDb(DEFAULT_TENANT_ID);
      await loadPersonaFromDb(DEFAULT_TENANT_ID);
      await AiModelConfigService.loadConfigsFromDb(DEFAULT_TENANT_ID);
      await AiRouterConfigService.loadConfigsFromDb(DEFAULT_TENANT_ID);
      await IdleGreetingConfigService.loadConfigsFromDb(DEFAULT_TENANT_ID);
      const aiScopeLoaded = await AiEligibilityConfigService.loadConfigsFromDb(DEFAULT_TENANT_ID);
      if (!aiScopeLoaded) {
        console.warn(
          '[AI_ROLLOUT_SCOPE] DB unreachable at boot, defaulting to fail-closed (NEW_ONLY, cutoff=now). ' +
          'AI akan silence untuk customer yang belum eligible sampai config berhasil di-load ulang.'
        );
      }
      console.log('📦 Tenant data initialized (catalog + delivery tiers + persona + AI config + AI router + idle greeting + AI scope)');
    } catch (initErr) {
      console.warn('[INIT TENANT DATA] Failed to sync tenant data:', (initErr as Error).message);
    }

    // Start background WAHA status monitor
    import('./services/waha-monitor.service').then(({ WahaMonitorService }) => {
      WahaMonitorService.getInstance().start();
    }).catch(e => console.error('[MONITOR START ERROR]', e));

    // Start label reconciliation cron (Task 7 / flag: ENABLE_LABEL_RECONCILIATION_CRON)
    if (process.env.ENABLE_LABEL_RECONCILIATION_CRON === 'true') {
      const intervalHours = parseInt(process.env.LABEL_RECONCILIATION_INTERVAL_HOURS || '4', 10);
      import('./services/cron.service').then(({ CronService }) => {
        const cron = new CronService();
        setInterval(() => cron.runLabelReconciliation(), intervalHours * 60 * 60 * 1000);
        console.log(`🏷️ Label reconciliation cron started (every ${intervalHours}h)`);
      }).catch(e => console.error('[LABEL RECONCILIATION START ERROR]', e));
    }

    // Start media cleanup cron (hapus file media Live Chat yang melebihi retensi)
    if (process.env.ENABLE_MEDIA_CLEANUP_CRON === 'true') {
      const intervalHours = parseInt(process.env.MEDIA_CLEANUP_INTERVAL_HOURS || '24', 10);
      import('./services/cron.service').then(({ CronService }) => {
        const cron = new CronService();
        setInterval(() => cron.runMediaCleanup(), intervalHours * 60 * 60 * 1000);
        console.log(`🖼️ Media cleanup cron started (every ${intervalHours}h)`);
      }).catch(e => console.error('[MEDIA CLEANUP START ERROR]', e));
    }

    // Start message retention cron (hapus record chat teks yang melebihi retensi)
    if (process.env.ENABLE_MESSAGE_RETENTION_CRON === 'true') {
      const intervalHours = parseInt(process.env.MESSAGE_RETENTION_INTERVAL_HOURS || '24', 10);
      import('./services/cron.service').then(({ CronService }) => {
        const cron = new CronService();
        setInterval(() => cron.runMessageRetentionCleanup(), intervalHours * 60 * 60 * 1000);
        console.log(`🧾 Message retention cron started (every ${intervalHours}h)`);
      }).catch(e => console.error('[MESSAGE RETENTION START ERROR]', e));
    }

    // Start LLM-as-Judge AI quality evaluation cron (interval 6 jam default)
    if (process.env.ENABLE_AI_EVAL_CRON === 'true') {
      const intervalHours = parseInt(process.env.AI_EVAL_INTERVAL_HOURS || '6', 10);
      import('./services/cron.service').then(({ CronService }) => {
        const cron = new CronService();
        setInterval(() => cron.runQualityEvaluation(), intervalHours * 60 * 60 * 1000);
        console.log(`🧪 AI quality evaluation cron started (every ${intervalHours}h)`);
      }).catch(e => console.error('[AI EVAL START ERROR]', e));
    }

    // Start daily chat export cron (regenerate file markdown harian untuk analisa AI)
    if (process.env.ENABLE_CHAT_EXPORT_CRON === 'true') {
      const intervalHours = parseInt(process.env.CHAT_EXPORT_INTERVAL_HOURS || '6', 10);
      import('./services/cron.service').then(({ CronService }) => {
        const cron = new CronService();
        setInterval(() => cron.runDailyChatExport(), intervalHours * 60 * 60 * 1000);
        console.log(`📤 Daily chat export cron started (every ${intervalHours}h)`);
      }).catch(e => console.error('[CHAT EXPORT START ERROR]', e));
    }

    // Start Daily Ops Report cron (runs interval to check per tenant settings or env fallback)
    import('./services/daily-report.service').then(({ dailyReportService }) => {
      const { prisma } = require('./db/client');
      const { getAllTenantIds } = require('./services/media.service');
      
      setInterval(async () => {
        try {
          const nowUtc = new Date();
          const wibTime = new Date(nowUtc.getTime() + (7 * 60 * 60 * 1000));
          const currentWibHour = wibTime.getUTCHours();
          
          const envEnabled = process.env.ENABLE_DAILY_REPORT_CRON === 'true';
          const envHour = parseInt(process.env.DAILY_REPORT_HOUR || '7', 10);
          
          const tenants = await getAllTenantIds();
          for (const tId of tenants) {
            const tenant = await prisma.tenant.findUnique({ where: { id: tId } });
            const isEnabled = tenant ? (tenant.daily_report_enabled || envEnabled) : envEnabled;
            const targetHour = tenant ? (tenant.daily_report_hour ?? envHour) : envHour;
            
            if (isEnabled && currentWibHour === targetHour) {
              await dailyReportService.sendDailyReport(tId);
            }
          }
        } catch (err: any) {
          console.error('[DAILY REPORT CRON ERROR]', err.message);
        }
      }, 30 * 60 * 1000);
      console.log(`📈 Daily Ops Report cron background worker started (checking every 30m WIB)`);
    }).catch(e => console.error('[DAILY REPORT START ERROR]', e));

    // Start Follow-Up Queue Worker & Morning Jobs (setiap 15 menit & pagi 06:00 WIB)
    import('./services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      
      // 1. Follow-Up worker: jalankan setiap 15 menit HANYA jika ENABLE_FOLLOWUP_WORKER === 'true'
      if (process.env.ENABLE_FOLLOWUP_WORKER === 'true') {
        const followUpIntervalMinutes = parseInt(process.env.FOLLOWUP_WORKER_INTERVAL_MINUTES || '15', 10);
        setInterval(() => cron.runFollowUpWorker(), followUpIntervalMinutes * 60 * 1000);
        console.log(`⏱️ Follow-Up Queue worker started (every ${followUpIntervalMinutes}m)`);
      } else {
        console.log(`🛑 Follow-Up Worker is DISABLED (ENABLE_FOLLOWUP_WORKER is not 'true')`);
      }

      // 2. Morning Jobs (Pengingat H-0 & Review H+1 pada 06:00 WIB) & Weekly Auto-Backup (Senin 02:00 WIB)
      let lastMorningRunDate = '';
      let lastWeeklyBackupRunDate = '';
      setInterval(async () => {
        try {
          const nowUtc = new Date();
          const wibTime = new Date(nowUtc.getTime() + 7 * 60 * 60 * 1000);
          const wibHour = wibTime.getUTCHours();
          const wibDay = wibTime.getUTCDay(); // 0 = Minggu, 1 = Senin
          const todayDateStr = wibTime.toISOString().slice(0, 10);

          if (wibHour === 6 && lastMorningRunDate !== todayDateStr) {
            lastMorningRunDate = todayDateStr;
            await cron.runMorningJobs();
          }

          // Auto-Backup Mingguan ke Google Drive (Setiap Senin 02:00 WIB)
          if (wibDay === 1 && wibHour === 2 && lastWeeklyBackupRunDate !== todayDateStr) {
            lastWeeklyBackupRunDate = todayDateStr;
            await cron.runWeeklyBackup();
          }
        } catch (err: any) {
          console.error('[CRON SCHEDULE ERROR]', err.message);
        }
      }, 15 * 60 * 1000);
      console.log(`🌅 Morning Jobs (06:00 WIB) & Weekly Backup (Senin 02:00 WIB) cron registered`);
    }).catch(e => console.error('[CRON SERVICE START ERROR]', e));
  });
}

