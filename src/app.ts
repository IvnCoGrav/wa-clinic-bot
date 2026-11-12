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
import { trackTimeout } from './lifecycle/interval-registry';
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

  const trustProxyConfig = process.env.TRUST_PROXY_ANY === 'true'
    ? true
    : (process.env.TRUST_PROXY_CIDRS
        ? (process.env.TRUST_PROXY_CIDRS.includes(',')
            ? process.env.TRUST_PROXY_CIDRS.split(',').map((s) => s.trim()).filter(Boolean)
            : process.env.TRUST_PROXY_CIDRS.trim())
        : ['127.0.0.1/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);

  const app = Fastify({
    trustProxy: trustProxyConfig,
    logger: {
      level: process.env.FASTIFY_LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : (process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info')),
    },
  });

  // Task S2.2: Fastify central error handler (log detail server, respons generik aman tanpa bocor stack trace)
  app.setErrorHandler((error, request, reply) => {
    const statusCode = (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600)
      ? error.statusCode
      : 500;

    request.log.error({
      err: error,
      reqId: request.id,
      method: request.method,
      url: request.url,
      statusCode,
    }, error.message || 'Unhandled error occurred');

    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: error.code || 'VALIDATION_ERROR',
        message: error.message,
      });
    }

    const isProd = process.env.NODE_ENV === 'production';
    if (statusCode >= 500) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        code: error.code || 'INTERNAL_SERVER_ERROR',
        message: isProd ? 'An internal server error occurred' : (error.message || 'Internal Server Error'),
      });
    }

    return reply.status(statusCode).send({
      statusCode,
      error: error.name || 'Client Error',
      code: error.code || 'CLIENT_ERROR',
      message: error.message || 'Client error occurred',
    });
  });

  // Task S2.2: Fastify central 404 handler terstruktur untuk route yang tidak terdaftar
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${request.method}:${request.url} not found`,
    });
  });

  // S-011: header keamanan untuk SPA admin yang diserve Fastify (dev/staging).
  // Di produksi Caddy menambahkan header yang sama; ini defense-in-depth agar
  // dashboard tidak pernah tampil tanpa CSP saat diakses langsung ke app.
  // Catatan: `'unsafe-inline'` pada script-src masih diperlukan karena
  // `packages/admin-dashboard/index.html` memuat skrip anti-flicker tema inline
  // (area dashboard milik pengguna); `'unsafe-eval'` dan `https:` bebas SUDAH
  // dihapus karena build Vite tidak membutuhkannya.
  const ADMIN_CSP =
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https: blob:; " +
    "font-src 'self' data: https:; " +
    "connect-src 'self' https: wss: ws:; " +
    "media-src 'self' blob: https:; " +
    "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none';";
  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.url.split('?')[0];
    if (path === '/admin' || path.startsWith('/admin/')) {
      reply.header('Content-Security-Policy', ADMIN_CSP);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      reply.header('X-Frame-Options', 'SAMEORIGIN');
      reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    }
    return payload;
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
  // Simpan raw body (Buffer) untuk verifikasi X-Hub-Signature-256 Meta dan dukung
  // Beacon navigator.sendBeacon bertipe 'text/plain;charset=UTF-8' (zero-preflight simple request).
  app.addContentTypeParser(['application/json', 'text/plain'], { parseAs: 'buffer' }, (req, body, done) => {
    (req as any).rawBody = body;
    const str = body.toString('utf8');
    const isTextPlain = ((req.headers['content-type'] as string) || '').toLowerCase().includes('text/plain');

    if (!str.trim()) {
      return done(null, {});
    }

    try {
      done(null, JSON.parse(str));
    } catch (err: any) {
      if (isTextPlain) {
        // Fail-safe untuk payload text/plain non-JSON
        return done(null, str);
      }
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
    // SEC-AUDIT-13 & Task 1.4.3: Hanya request yang benar-benar tidak boleh di-throttle
    // (SSE real-time stream long-lived pada path kanonis) yang di-skip.
    // Parsing URL secara ketat agar /foo/events atau spoofing path tidak lolos.
    allowList: (request) => {
      const rawUrl = request.url || '';
      let pathname = rawUrl;
      try {
        pathname = new URL(rawUrl, 'http://localhost').pathname;
      } catch {
        pathname = rawUrl.split('?')[0];
      }
      const sseAllowedPrefixes = [
        '/api/admin/live-chat/events',
        '/api/admin/events',
        '/api/events',
      ];
      return sseAllowedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    },
    keyGenerator: (request) => {
      const url = request.url || '';
      const clientIp = request.ip;
      // Webhook WAHA/WABA mengirim ratusan event bertubi-tubi saat connect/sync:
      // kuota tinggi khusus webhook (bukan bebas tanpa batas).
      if (url.startsWith('/webhook') || url.startsWith('/api/webhook')) {
        return `webhook:${clientIp}`;
      }
      const apiKey = request.headers['x-api-key'] as string | undefined;
      const validAdminKey = process.env.ADMIN_API_KEY;
      // S-005 / Fase 1.4.2: Hanya x-api-key yang SAH yang diberikan bucket terpisah.
      // Kunci palsu/acak ditolak dari pembuatan bucket baru dan dijatuhkan ke bucket IP.
      if (apiKey && validAdminKey && apiKey === validAdminKey) {
        return `admin-key:${apiKey}`;
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

  // AUDIT FASE 3 (K-03b): humanizer (typing/sendSeen/sendText) WAJIB memakai
  // transport tenant-nya, bukan session WAHA env global.
  void (async () => {
    try {
      const [{ typingService }, factory, transport] = await Promise.all([
        import('./services/typing.service'),
        import('./integrations/whatsapp/factory'),
        import('./integrations/whatsapp/transport'),
      ]);
      typingService.setTransportResolver(async (tenantId: string) => {
        const gateway = await factory.resolveGatewayForTenant(tenantId);
        if (gateway.providerType === 'WAHA') {
          return transport.createWahaTransport(await factory.getWahaClientForTenant(tenantId));
        }
        return transport.createGatewayTransport(gateway);
      });
    } catch (err: any) {
      console.warn('[TYPING TRANSPORT] Gagal memasang resolver per-tenant:', err?.message || err);
    }
  })();

  return app;
}

if (require.main === module) {
  (async () => {
    const PORT = parseInt(process.env.PORT || '3000', 10);
    const HOST = process.env.HOST || '0.0.0.0';

    // Task S2.4: Inisialisasi runtime tenant SEBELUM server.listen() agar request pertama tidak melihat cache kosong.
    // Production: kegagalan init = tolak listen (jangan melayani dengan katalog/persona kosong).
    // Development: tetap listen dengan warning agar debugging lokal tidak terhambat.
    let tenantRuntimeReady = true;
    try {
      const { initializeTenantRuntime } = await import('./lifecycle/tenant-bootstrap');
      const bootstrap = await initializeTenantRuntime();
      tenantRuntimeReady = bootstrap.success;
      if (!bootstrap.success) {
        console.error('[BOOT INIT] Tenant runtime gagal diinisialisasi:', bootstrap.error?.message || 'unknown error');
      }
    } catch (bootstrapErr: any) {
      tenantRuntimeReady = false;
      console.error('[BOOT INIT] Gagal inisialisasi tenant runtime:', bootstrapErr?.message || bootstrapErr);
    }

    if (!tenantRuntimeReady && process.env.NODE_ENV === 'production') {
      throw new Error('Tenant runtime bootstrap failed; refusing to listen in production.');
    }

    const server = await buildApp();

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
    trackTimeout(() => {
      import('./services/turn-recovery.service').then(({ turnRecoveryService }) => {
        void turnRecoveryService.replayPendingTurns(50, { resetProcessingOnBoot: true }).catch(() => {});
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
  })().catch((err) => {
    console.error('[FATAL BOOT ERROR]', err);
    process.exit(1);
  });
}
