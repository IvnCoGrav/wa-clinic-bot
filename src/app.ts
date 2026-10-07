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
import { shouldLogAuthAccess, buildAuthAccessLogEntry, emitAuthAccessLog } from './utils/auth-access-log';
import { startBackgroundCrons } from './lifecycle/background-crons';

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

  // SEC-AUDIT-01: Telegram webhook kini fail-closed (menolak bila secret kosong),
  // sehingga secret WAJIB ada di production — sejajar dengan WAHA_WEBHOOK_SECRET.
  const telegramSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!telegramSecret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Critical Security Configuration Missing: TELEGRAM_WEBHOOK_SECRET must be defined in production environment.');
    } else {
      console.warn('\n⚠️ [SECURITY WARNING] TELEGRAM_WEBHOOK_SECRET environment variable is not defined. Telegram webhook endpoint will reject ALL requests (fail-closed) until it is configured.\n');
    }
  }

  const app = Fastify({
    logger: {
      level: process.env.FASTIFY_LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : (process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info')),
    },
  });

  // Observabilitas forensik jalur auth (KNOWN_ISSUES #143): catat SATU baris JSON
  // ringkas untuk respons 401/503 pada rute auth/admin/staff. Token penuh tidak
  // pernah masuk log (hanya hash prefix-8). Deterministik, terpusat, tanpa duplikasi.
  app.addHook('onResponse', async (request, reply) => {
    try {
      const path = request.url.split('?')[0];
      if (!shouldLogAuthAccess(path, reply.statusCode)) return;
      emitAuthAccessLog(
        buildAuthAccessLogEntry({
          method: request.method,
          path,
          statusCode: reply.statusCode,
          latencyMs: reply.elapsedTime,
          cookieHeader: request.headers['cookie'] as string | undefined,
          ip: request.ip,
          reqId: request.id,
        })
      );
    } catch {
      // Observabilitas TIDAK boleh mengganggu jalur request.
    }
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


  // Register HTTP Response Compression (Brotli, Gzip & Deflate untuk payload > 1KB)
  app.register(compress, {
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate'],
  });

  // Register Rate Limiting (global protection for public endpoints)
  app.register(rateLimit, {
    max: process.env.NODE_ENV === 'test' ? 100 : 1000,
    timeWindow: '1 minute',
    // SEC-AUDIT-13: sebelumnya hampir semua rute dikecualikan total (allowList
    // return true) → flood webhook/SSE/API admin tanpa batas. Kini hanya request
    // yang benar-benar tidak boleh di-throttle (SSE long-lived) yang di-skip;
    // webhook & API admin tetap dibatasi dengan kuota tinggi agar tidak DoS.
    allowList: (request) => {
      const url = request.url || '';
      // SSE Real-time stream: koneksi long-lived, jangan dihitung per-event.
      if (url.includes('/events') || url.includes('/stream')) {
        return true;
      }
      return false;
    },
    keyGenerator: (request) => {
      const url = request.url || '';
      const clientIp = request.ip;
      // Webhook WAHA/WABA mengirim ratusan event bertubi-tubi saat connect/sync:
      // kuota tinggi khusus webhook (bukan bebas tanpa batas).
      if (url.startsWith('/webhook') || url.startsWith('/api/webhook')) {
        return `webhook:${clientIp}`;
      }
      const apiKey = request.headers['x-api-key'] as string;
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
  app.get('/geo/*', async (req, reply) => reply.redirect('/admin' + req.url));

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

  // PLAN 8 FASE 1: graceful shutdown (SIGTERM/SIGINT) — hentikan cron lebih dulu,
  // lalu drain queue/burst, lalu putuskan koneksi. Lihat src/lifecycle/shutdown.ts.
  import('./lifecycle/shutdown').then(({ registerShutdownHooks }) => {
    registerShutdownHooks(server);
  }).catch((e: any) => {
    console.warn('[SHUTDOWN INIT] Gagal mendaftarkan shutdown hooks:', e?.message);
  });

  server.listen({ port: PORT, host: HOST }, async (err, address) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
    console.log(`\n🚀 WhatsApp Clinic Bot Engine listening on ${address}`);
    console.log(`📌 Webhook URL: ${address}/webhook`);
    console.log(`📌 Admin Endpoint: ${address}/api/admin/human-handling-conversations\n`);

    // Init data tenant (SaaS-ready): seed catalog & delivery tiers dari DB
    // PLAN 8 FASE 4: iterasi SELURUH tenant aktif (bukan hanya default).
    // DB offline → fallback [DEFAULT_TENANT_ID] (perilaku single-tenant tidak berubah).
    try {
      const { DEFAULT_TENANT_ID } = await import('./config/tenant');
      const { loadServicesFromDb } = await import('./services/treatment-catalog.service');
      const { getDeliveryTiersFromDb } = await import('./services/delivery.service');
      const { loadPersonaFromDb } = await import('./config/persona');
      const { AiModelConfigService } = await import('./config/ai-models.config');
      const { AiEligibilityConfigService } = await import('./config/ai-eligibility-config');
      let tenantIds: string[] = [DEFAULT_TENANT_ID];
      try {
        const { prisma } = await import('./db/client');
        const tenants = await prisma.tenant.findMany({ select: { id: true } });
        if (tenants.length > 0) tenantIds = tenants.map((t: any) => t.id);
      } catch {
        console.warn('[INIT TENANT DATA] DB offline — fallback ke DEFAULT_TENANT_ID.');
      }
      for (const tid of tenantIds) {
        await loadServicesFromDb(tid);
        await getDeliveryTiersFromDb(tid);
        await loadPersonaFromDb(tid);
        await AiModelConfigService.loadConfigsFromDb(tid);
        const aiScopeLoaded = await AiEligibilityConfigService.loadConfigsFromDb(tid);
        if (!aiScopeLoaded) {
          console.warn(
            `[AI_ROLLOUT_SCOPE] DB unreachable at boot for tenant ${tid}, defaulting to fail-closed (NEW_ONLY, cutoff=now).`
          );
        }
      }
      console.log(`📦 Tenant data initialized for ${tenantIds.length} tenant(s) (catalog + delivery tiers + persona + AI config + AI router + idle greeting + AI scope)`);
    } catch (initErr) {
      console.warn('[INIT TENANT DATA] Failed to sync tenant data:', (initErr as Error).message);
    }

    // Auto-sync WAHA webhook events per tenant (PLAN 8 FASE 4).
    import('./config/tenant').then(({ DEFAULT_TENANT_ID }) => {
      import('./services/whatsapp-provider.service').then(({ whatsappProviderService }) => {
        import('./db/client').then(({ prisma }) => {
          prisma.tenant.findMany({ select: { id: true } })
            .then((tenants: any[]) => {
              const ids = tenants.length > 0 ? tenants.map((t) => t.id) : [DEFAULT_TENANT_ID];
              return Promise.all(ids.map((tid) =>
                whatsappProviderService.syncSessionWebhooks(tid).catch((err: any) => {
                  console.warn(`[WAHA SYNC] Gagal sinkronisasi webhook events tenant ${tid}:`, err?.message || err);
                })
              ));
            })
            .catch(() => {
              whatsappProviderService.syncSessionWebhooks(DEFAULT_TENANT_ID).catch((err: any) => {
                console.warn('[WAHA SYNC] Gagal sinkronisasi webhook events:', err?.message || err);
              });
            });
        }).catch(() => {
          whatsappProviderService.syncSessionWebhooks(DEFAULT_TENANT_ID).catch((err: any) => {
            console.warn('[WAHA SYNC] Gagal sinkronisasi webhook events:', err?.message || err);
          });
        });
      });
    });

    // Start background WAHA status monitor
    import('./services/waha-monitor.service').then(({ WahaMonitorService }) => {
      WahaMonitorService.getInstance().start();
    }).catch(e => console.error('[MONITOR START ERROR]', e));

    // Stage 5 Fase 5: recover turn durable yang belum selesai (Redis down / crash)
    // + retention ledger. Non-blocking; beri jeda agar queue/Redis siap.
    setTimeout(() => {
      import('./services/turn-recovery.service').then(({ turnRecoveryService }) => {
        void turnRecoveryService.replayPendingTurns().catch(() => {});
        void turnRecoveryService.cleanupOldTurns(60).catch(() => {});
      }).catch(() => {});
    }, 15000);

    // Inisialisasi background cron & sweep worker:
    // Bila SEPARATE_WORKER === 'true', dilewati (dijalankan oleh container/proses src/worker.ts)
    if (process.env.SEPARATE_WORKER === 'true') {
      console.log('👷 [APP] SEPARATE_WORKER=true terdeteksi: melewati background crons & sweeps (dijalankan di worker process).');
    } else {
      startBackgroundCrons();
    }
  });
}

