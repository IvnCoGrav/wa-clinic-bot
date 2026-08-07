import Fastify from 'fastify';
import dotenv from 'dotenv';
import { webhookRoutes } from './routes/webhook.route';
import { wabaWebhookRoutes } from './routes/waba-webhook.route';
import { adminRoutes } from './routes/admin.route';
import { healthRoutes } from './routes/health.route';
import { trackingRoutes } from './routes/tracking.route';
import { landingRoutes } from './routes/landing.route';
import { mediaRoutes } from './routes/media.route';
import rateLimit from '@fastify/rate-limit';
import { initializeConsoleWrapper } from './utils/context';
import { installLogBuffer } from './utils/log-buffer';

dotenv.config();
// URUTAN PENTING: installLogBuffer HARUS sebelum initializeConsoleWrapper.
// Keduanya menimpa console.log/warn/error; kalau buffer dipasang di atas wrapper
// konteks (yang punya marker __wrapped/original), pemanggilan ulang
// initializeConsoleWrapper akan me-re-wrap buffer dan membuat rekursi tak hingga.
// Urutan benar = buffer paling dalam, context wrapper paling luar.
installLogBuffer();
initializeConsoleWrapper();

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

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
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


  // Register Rate Limiting (global, admin routes have the tightest budget)
  app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
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
  app.register(healthRoutes);
  app.register(trackingRoutes);
  app.register(landingRoutes);
  app.register(mediaRoutes);

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

    // Start LLM-as-Judge AI quality evaluation cron (interval 6 jam default)
    if (process.env.ENABLE_AI_EVAL_CRON === 'true') {
      const intervalHours = parseInt(process.env.AI_EVAL_INTERVAL_HOURS || '6', 10);
      import('./services/cron.service').then(({ CronService }) => {
        const cron = new CronService();
        setInterval(() => cron.runQualityEvaluation(), intervalHours * 60 * 60 * 1000);
        console.log(`🧪 AI quality evaluation cron started (every ${intervalHours}h)`);
      }).catch(e => console.error('[AI EVAL START ERROR]', e));
    }
  });
}

