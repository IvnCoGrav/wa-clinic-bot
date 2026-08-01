import Fastify from 'fastify';
import dotenv from 'dotenv';
import { webhookRoutes } from './routes/webhook.route';
import { adminRoutes } from './routes/admin.route';
import { healthRoutes } from './routes/health.route';
import { trackingRoutes } from './routes/tracking.route';
import rateLimit from '@fastify/rate-limit';
import { initializeConsoleWrapper } from './utils/context';

dotenv.config();
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


  // Register Webhook, Admin, Health, & Tracking Routes
  app.register(webhookRoutes);
  app.register(adminRoutes);
  app.register(healthRoutes);
  app.register(trackingRoutes);

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
      await loadServicesFromDb(DEFAULT_TENANT_ID);
      await getDeliveryTiersFromDb(DEFAULT_TENANT_ID);
      await loadPersonaFromDb(DEFAULT_TENANT_ID);
      await AiModelConfigService.loadConfigsFromDb(DEFAULT_TENANT_ID);
      console.log('📦 Tenant data initialized (catalog + delivery tiers + persona + AI config)');
    } catch (initErr) {
      console.warn('[INIT TENANT DATA] Failed to sync tenant data:', (initErr as Error).message);
    }

    // Start background WAHA status monitor
    import('./services/waha-monitor.service').then(({ WahaMonitorService }) => {
      WahaMonitorService.getInstance().start();
    }).catch(e => console.error('[MONITOR START ERROR]', e));
  });
}

