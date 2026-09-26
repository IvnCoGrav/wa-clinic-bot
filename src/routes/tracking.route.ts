import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client';
import { safeCompare } from '../utils/auth';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import crypto from 'crypto';

// In-Memory map untuk melacak hasil tracking klik saat database offline (Unit Test / Dev fallback)
export const memoryAdClicks = new Map<string, any>();

/**
 * SEC-AUDIT-15: cache singkat host landing terdaftar (60 dtk) agar guard origin
 * tidak menghantam DB setiap request. Sumber data = `Tenant.landing_domain`
 * (dikelola admin via settings) — bukan hardcode domain di kode.
 * Fase 3a (issue #136): index diperkaya `host → tenant_id` sehingga dipakai bersama
 * oleh origin-check DAN resolusi tenant PageView (satu query, dua konsumen).
 */
let cachedLandingHosts: { at: number; hosts: Set<string>; byHost: Map<string, string> } | null = null;

async function getLandingHostIndex(): Promise<{ hosts: Set<string>; byHost: Map<string, string> }> {
  const now = Date.now();
  if (!cachedLandingHosts || now - cachedLandingHosts.at > 60_000) {
    const tenants = await prisma.tenant.findMany({
      where: { landing_domain: { not: null } },
      select: { id: true, landing_domain: true },
    });
    const hosts = new Set<string>();
    const byHost = new Map<string, string>();
    for (const t of tenants as any[]) {
      const d = String(t?.landing_domain || '').trim().toLowerCase().replace(/\/$/, '');
      if (!d) continue;
      try {
        const h = new URL(d.includes('://') ? d : `https://${d}`).hostname;
        hosts.add(h);
        if (t?.id) byHost.set(h, t.id);
      } catch {}
    }
    cachedLandingHosts = { at: now, hosts, byHost };
  }
  return cachedLandingHosts;
}

function originHostname(request: FastifyRequest): string | null {
  const origin = (request.headers['origin'] || request.headers['referer'] || '') as string;
  if (!origin) return null;
  try {
    // API URL standar (bukan regex hafalan) untuk ekstraksi host.
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Origin dipercaya bila same-origin (landing diserve server ini: /promo, /go, /cta)
 * ATAU host-nya terdaftar sebagai `landing_domain` salah satu tenant di DB.
 * DB offline → hanya same-origin (fail-closed, bukan fail-open).
 */
async function isTrustedTrackingOrigin(request: FastifyRequest): Promise<boolean> {
  const host = originHostname(request);
  if (!host) return false;
  if (host === (request.hostname || '').toLowerCase()) return true;
  try {
    const { hosts } = await getLandingHostIndex();
    return hosts.has(host);
  } catch {
    return false;
  }
}

/**
 * Resolusi tenant untuk baris PageView (Fase 3a, issue #136) — menggantikan
 * hardcode `DEFAULT_TENANT_ID`. Otoritas berurutan (maksimal 1 query, fail-open):
 *  1. Hint script-tag `external-tracker.js?tenant=<id|slug>` → TERVERIFIKASI ke DB;
 *     hint tak dikenal → default-tenant (anti-spoof — hint tidak boleh dibutakan).
 *  2. Tanpa hint → host `landingUrl` vs index `Tenant.landing_domain` (data-driven).
 *  3. DB offline → hint apa adanya; tanpa hint → default-tenant.
 */
export async function resolveViewTenantId(
  rawHint: unknown,
  landingUrl: unknown,
): Promise<string> {
  const hint = typeof rawHint === 'string' && rawHint.trim() ? rawHint.trim() : null;
  if (hint) {
    try {
      const t = (await prisma.tenant.findFirst({
        where: { OR: [{ id: hint }, { slug: hint }] },
        select: { id: true },
      })) as any;
      return t?.id || DEFAULT_TENANT_ID;
    } catch {
      return hint; // DB offline: pertahankan hint (fail-open)
    }
  }

  const url = typeof landingUrl === 'string' && landingUrl ? landingUrl : null;
  if (url) {
    let host: string | null = null;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      host = null;
    }
    if (host) {
      try {
        const { byHost } = await getLandingHostIndex();
        return byHost.get(host) || DEFAULT_TENANT_ID;
      } catch {
        return DEFAULT_TENANT_ID; // DB offline & tanpa hint → default (fail-open)
      }
    }
  }
  return DEFAULT_TENANT_ID;
}

/**
 * Mendeteksi crawler/bot otomatis (Meta link preview bot, Googlebot, Twitterbot, dsb.)
 * agar tidak mengotori tabel AdClick di database dan tidak merusak kalkulasi grafik konversi.
 */
export function isBotOrCrawler(ua?: string | null): boolean {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  return (
    lower.includes('facebookexternalhit') ||
    lower.includes('facebot') ||
    lower.includes('meta-externalagent') ||
    lower.includes('meta-externalfetcher') ||
    lower.includes('googlebot') ||
    lower.includes('bingbot') ||
    lower.includes('twitterbot') ||
    lower.includes('whatsapp/') ||
    lower.includes('telegrambot') ||
    lower.includes('ahrefsbot') ||
    lower.includes('semrushbot') ||
    lower.includes('mj12bot') ||
    lower.includes('bytespider') ||
    lower.includes('petalbot') ||
    lower.includes('headlesschrome') ||
    lower.includes('phantomjs')
  );
}

/**
 * Prunes in-memory map stores if size exceeds maxLimit (FIFO deletion) to prevent memory leaks when DB is offline long-term.
 */
export function pruneMemoryMap(map: Map<string, any>, maxLimit = 1000): void {
  if (map.size > maxLimit) {
    const keysToDelete = Array.from(map.keys()).slice(0, map.size - maxLimit);
    for (const key of keysToDelete) {
      map.delete(key);
    }
  }
}


/**
 * Alphabet yang digunakan untuk generate kode tracking.
 * Karakter ambigu yang sengaja di-exclude:
 *   '0' (nol)  ↔ 'o' (huruf o) → bisa salah baca
 *   '1' (satu) ↔ 'l' (huruf L kecil) ↔ 'i' (huruf i kapital) → bisa salah baca
 * Hasil: 32 karakter unik, mudah dibaca manusia.
 */
const TRACKING_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Keyspace per panjang:
 *   2 karakter → 32² = 1.024 kombinasi
 *   3 karakter → 32³ = 32.768 kombinasi
 *   4 karakter → 32⁴ = 1.048.576 kombinasi (batas maksimal, nyaris tidak pernah dicapai)
 */
const RETRY_LENGTHS = [2, 3, 4] as const;
const MAX_ATTEMPTS_PER_LENGTH = 5;

/**
 * Internal helper: generate string random sepanjang `length` karakter dari TRACKING_ALPHABET.
 * Menggunakan crypto.randomInt untuk distribusi uniform yang kuat secara kriptografis.
 */
function _randomCode(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += TRACKING_ALPHABET.charAt(crypto.randomInt(TRACKING_ALPHABET.length));
  }
  return result;
}

/**
 * Generate kode tracking unik dan langsung INSERT ke database (insert-and-catch-conflict).
 *
 * Strategi concurrency-safe:
 * - Tidak ada SELECT sebelum INSERT → tidak ada race condition antara 2 request bersamaan.
 * - DB UNIQUE constraint yang menjadi penentu. Kalau P2002, retry dengan kode baru.
 * - Setelah 5 percobaan gagal di panjang yang sama, eskalasi ke panjang berikutnya (2→3→4).
 * - Kalau 4 karakter juga habis setelah 5 percobaan → throw Error('Keyspace exhausted').
 *
 * @param data  - Data AdClick yang akan disimpan (tanpa trackingCode, diisi oleh fungsi ini)
 * @param db    - Prisma client (injectable untuk unit testing)
 * @returns     Record AdClick yang berhasil dibuat beserta kode tracking-nya
 */
export async function generateTrackingCode(
  data: {
    fbclid?: string | null;
    fbp?: string | null;
    fbc?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    landingUrl?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    phone?: string | null;
    tenant_id: string;
  },
  db: typeof prisma = prisma
): Promise<{ trackingCode: string; record: any }> {
  for (const length of RETRY_LENGTHS) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_LENGTH; attempt++) {
      const trackingCode = _randomCode(length);
      try {
        const record = await db.adClick.create({
          data: {
            trackingCode,
            ...data,
          },
        });
        return { trackingCode, record };
      } catch (error: any) {
        if (error?.code === 'P2002') {
          // Unique constraint violation → coba kode lain di panjang yang sama
          continue;
        }
        // Error lain (DB offline, dsb.) → lempar keluar agar caller bisa fallback
        throw error;
      }
    }
    // 5 percobaan gagal di length ini → eskalasi ke length berikutnya
  }
  throw new Error(`[Tracking] Keyspace exhausted: semua ${RETRY_LENGTHS.join('/')} karakter collision setelah ${MAX_ATTEMPTS_PER_LENGTH} percobaan masing-masing.`);
}
export async function trackingRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/tenant/:slug
   * Mengambil data konfigurasi & konten landing page terstruktur untuk tenant berdasarkan slug
   */
  fastify.get(
    '/api/tenant/:slug',

    async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const { slug } = request.params;

      try {
        const { resolveLandingContent, defaultLandingContent } = await import('../services/landing-content.service');
        const content = await resolveLandingContent(slug);
        if (content) {
          return reply.status(200).send(content);
        }
        // Fail-open: slug tak dikenal / DB offline → konten generik (perilaku legacy)
        return reply.status(200).send(defaultLandingContent(slug));
      } catch (err: any) {
        console.error(`[TENANT SLUG RESOLVE ERROR] Failed to resolve content for slug ${slug}:`, err.message);
        const { defaultLandingContent } = await import('../services/landing-content.service');
        return reply.status(200).send(defaultLandingContent(slug));
      }
    }
  );


  /**
   * POST /api/tracking/click
   * REST Endpoint internal untuk menyimpan data fbclid/fbp/fbc/UTMs saat click-through 
   * di landing page, lalu mengembalikan trackingCode unik.
   */
  fastify.post(
    '/api/tracking/click',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.ip,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // 1. AUTH / ORIGIN CHECK: Enforce valid API Key if provided or required
      const trackingApiKey = process.env.TRACKING_API_KEY;
      const clientKey = request.headers['x-tracking-api-key'] as string;

      if (clientKey) {
        if (!trackingApiKey || !safeCompare(clientKey, trackingApiKey)) {
          return reply.status(401).send({ error: 'Unauthorized: Invalid X-Tracking-Api-Key header.' });
        }
      } else if (!(await isTrustedTrackingOrigin(request))) {
        // SEC-AUDIT-15: `origin.startsWith('http')` lama bernilai true untuk domain
        // penyerang mana pun. Tanpa key, hanya origin same-origin / landing_domain
        // tenant terdaftar yang lolos — berlaku bahkan saat TRACKING_API_KEY unset.
        return reply.status(401).send({ error: 'Unauthorized: Missing X-Tracking-Api-Key header or untrusted origin.' });
      }

      // 2. PARSE BODY: Mengabaikan sepenuhnya ipAddress/userAgent yang mungkin dikirim oleh attacker/iseng di body
      const body = (request.body || {}) as any;
      const fbclid = body.fbclid || null;
      const fbp = body.fbp || null;
      const fbc = body.fbc || null;
      const landingUrl = body.landingUrl || null;
      const utmSource = body.utmSource || null;
      const utmMedium = body.utmMedium || null;
      const utmCampaign = body.utmCampaign || null;
      const phone = body.phone || null;
      const tenant_id = body.tenantId || body.tenant_id || DEFAULT_TENANT_ID;

      // 3. CAPTURE IP & USER-AGENT dari socket peer langsung (no spoofing).
      // SEC-AUDIT-15: cookie `_fbi` dan header XFF dikendalikan klien (tanpa
      // trustProxy) sehingga DILARANG menimpa request.ip. Catatan deploy: bila
      // di belakang reverse proxy, IP tercatat = IP proxy (lihat KNOWN_ISSUES 129).
      const ipAddress = request.ip || null;
      const userAgent = request.headers['user-agent'] || null;

      // 3b. BOT / CRAWLER FILTER: Abaikan bot Meta / crawler agar tidak mencemari database & grafik
      const isTestMode = body.is_test === true || body.is_test === 'true' || body.test === '1' || body.utmSource === 'test' || utmSource === 'test';
      if (!isTestMode && isBotOrCrawler(userAgent)) {
        return reply.status(200).send({ trackingCode: null, ignored: true, reason: 'bot_crawler_ignored' });
      }

      const clickData = {
        fbclid,
        fbp,
        fbc,
        ipAddress,
        userAgent,
        landingUrl,
        utmSource: isTestMode && !utmSource ? 'test' : utmSource,
        utmMedium,
        utmCampaign,
        phone,
        tenant_id,
      };

      // 4. INSERT-AND-CATCH-CONFLICT: Retry-and-escalate (2 → 3 → 4 karakter)
      try {
        const { trackingCode } = await generateTrackingCode(clickData);
        return reply.status(200).send({ trackingCode });
      } catch (error: any) {
        if (error?.message?.includes('Keyspace exhausted')) {
          return reply.status(503).send({ error: 'Service temporarily unavailable: tracking code keyspace exhausted.' });
        }

        // DB offline → fallback ke in-memory
        const trackingCode = _randomCode(2);
        const clickRecord = {
          id: `cuid_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          trackingCode,
          ...clickData,
          matchedAt: null,
          customerId: null,
          createdAt: new Date(),
        };
        memoryAdClicks.set(trackingCode, clickRecord);
        return reply.status(200).send({ trackingCode });
      }
    }
  );

  /**
   * OPTIONS & POST /api/tracking/pageview
   * Menerima sinyal PageView dari external-tracker.js di landing page eksternal (WordPress, Berdu, Scalev, dsb.)
   */
  fastify.options('/api/tracking/pageview', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    return reply.status(204).send();
  });

  fastify.post(
    '/api/tracking/pageview',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.ip,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type');

      const body = (request.body || {}) as any;
      const userAgent = request.headers['user-agent'] || null;

      // Filter bot crawler Meta / search bot agar data tetap bersih
      if (isBotOrCrawler(userAgent)) {
        return reply.status(200).send({ success: true, ignored: true });
      }

      // SEC-AUDIT-15: XFF dapat dispoof klien; socket peer (request.ip) otoritatif.
      const ipAddress = request.ip || null;
      // Fase 3a (issue #136): tenant diveresolusi (hint script-tag terverifikasi →
      // host landing_domain → default), bukan lagi dibutakan ke default-tenant.
      const tenant_id = await resolveViewTenantId(
        body.tenantId ?? body.tenant_id ?? body.tenantSlug ?? body.tenant_slug,
        body.landingUrl,
      );

      const viewData = {
        tenant_id,
        landingUrl: body.landingUrl || null,
        fbclid: body.fbclid || null,
        fbp: body.fbp || null,
        fbc: body.fbc || null,
        ipAddress,
        userAgent,
        utmSource: body.utm_source || body.utmSource || null,
        utmMedium: body.utm_medium || body.utmMedium || null,
        utmCampaign: body.utm_campaign || body.utmCampaign || null,
        utmContent: body.utm_content || body.utmContent || null,
        utmTerm: body.utm_term || body.utmTerm || null,
        utmId: body.utm_id || body.utmId || null,
        // Fase 2 (issue #135): eventID kembar browser↔CAPI disimpan agar baris
        // bisa di-join & didedup (sebelumnya hanya diteruskan ke CAPI);
        // referrer dari external-tracker; source = asal baris (beacon).
        eventId: body.eventID || null,
        referrer: body.referrer || null,
        source: 'beacon',
      };

      try {
        await (prisma as any).landingPageView.create({
          data: viewData,
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          // Dedup idempoten: eventID sudah pernah masuk (retry klien/ganda beacon)
          // → SUKSES, bukan fallback. Jangan gorok memory agar tidak dobel.
          return reply.status(200).send({ success: true, deduped: true });
        }
        // Fallback in-memory jika DB offline — key = eventId bila ada agar
        // retry berikutnya bisa dicocokkan/diagnostik.
        pruneMemoryMap(memoryPageViews, 2000);
        const memKey = viewData.eventId || `view_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        memoryPageViews.set(memKey, {
          ...viewData,
          createdAt: new Date(),
        });
      }

      // Hybrid Deduplication: Tembakkan event PageView ke Meta CAPI dengan eventID yang sama
      if (body.eventID) {
        try {
          const { capiService } = await import('../services/capi.service');
          capiService.sendCapiEvent({
            eventName: 'PageView',
            customer: { phone: '', id: `pv_${Date.now()}` },
            adClick: {
              fbclid: viewData.fbclid,
              fbp: viewData.fbp,
              fbc: viewData.fbc,
              ipAddress: viewData.ipAddress,
              userAgent: viewData.userAgent,
              landingUrl: viewData.landingUrl,
              trackingCode: body.eventID,
              utmSource: viewData.utmSource,
              utmMedium: viewData.utmMedium,
              utmCampaign: viewData.utmCampaign,
            },
            tenantId: tenant_id,
            customData: {
              traffic_source: viewData.fbclid ? 'paid' : 'organic',
            },
          }).catch(() => {});
        } catch (_) {}
      }

      return reply.status(200).send({ success: true });
    }
  );
}

export const memoryPageViews = new Map<string, any>();


