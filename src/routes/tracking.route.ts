import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client';
import { safeCompare } from '../utils/auth';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import crypto from 'crypto';

// In-Memory map untuk melacak hasil tracking klik saat database offline (Unit Test / Dev fallback)
export const memoryAdClicks = new Map<string, any>();

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
      // 1. AUTH CHECK: Timing-safe fail-closed comparison
      const trackingApiKey = process.env.TRACKING_API_KEY;
      if (!trackingApiKey) {
        return reply.status(401).send({ error: 'Unauthorized: Tracking API Key is not configured on the server.' });
      }

      const clientKey = request.headers['x-tracking-api-key'] as string;
      if (!clientKey || !safeCompare(clientKey, trackingApiKey)) {
        return reply.status(401).send({ error: 'Unauthorized: Invalid or missing X-Tracking-Api-Key header.' });
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

      // 3. CAPTURE IP & USER-AGENT dari request headers langsung (no spoofing)
      const cookiesHeader = request.headers.cookie || '';
      const fbiMatch = cookiesHeader.match(/_fbi=([^;]+)/);
      const cookieIp = fbiMatch ? decodeURIComponent(fbiMatch[1]).split('.')[0] : null;

      const ipAddress = cookieIp || request.ip || (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || null;
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

      const ipAddress = (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || request.ip || null;
      const tenant_id = body.tenantId || body.tenant_id || DEFAULT_TENANT_ID;

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
      };

      try {
        await (prisma as any).landingPageView.create({
          data: viewData,
        });
      } catch (err: any) {
        // Fallback in-memory jika DB offline
        pruneMemoryMap(memoryPageViews, 2000);
        memoryPageViews.set(`view_${Date.now()}_${Math.random().toString(36).substring(7)}`, {
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


