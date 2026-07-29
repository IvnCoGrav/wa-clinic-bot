import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client';
import { safeCompare } from '../utils/auth';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import crypto from 'crypto';

// In-Memory map untuk melacak hasil tracking klik saat database offline (Unit Test / Dev fallback)
export const memoryAdClicks = new Map<string, any>();

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
        const tenant = await prisma.tenant.findFirst({
          where: {
            OR: [
              { slug: slug },
              { id: slug },
            ],
          },
          select: {
            id: true,
            slug: true,
            name: true,
            whatsapp_number: true,
            meta_pixel_id: true,
            landing_type: true,
            landing_content: true,
            raw_html_content: true,
            // CRITICAL SECURITY PROOF: meta_capi_access_token is EXPLICITLY OMITTED from SELECT projection!
          },
        });

        const landingJson = (tenant?.landing_content as any) || {};

        // Dynamic multi-tenant content model
        const content = {
          tenant_id: tenant?.id || DEFAULT_TENANT_ID,
          slug: tenant?.slug || slug || 'default',
          landing_type: tenant?.landing_type || 'STRUCTURED_JSON',
          raw_html_content: tenant?.raw_html_content || null,
          clinic_name: tenant?.name || landingJson.clinic_name || 'Kala Baby & Moms Spa',

          headline: landingJson.headline || 'Solusi Pijat & Perawatan Bayi Profesional di Rumah Anda',
          subheadline: landingJson.subheadline || 'Bidan bersertifikasi resmi datang langsung ke lokasi Anda. Bebas macet, nyaman, & steril.',
          benefits: landingJson.benefits || [
            'Terapis Bidan Terlatih & Certified Spa Specialist',
            'Peralatan Steril & Hygienic Standard Rumah Sakit',
            'Gratis Ongkir Layanan Home-Treatment hingga 5 km',
            'Bebas Pilih Jadwal Fleksibel Sesuai Kenyamanan Bunda',
          ],
          faq: landingJson.faq || [
            {
              question: 'Bagaimana cara memesan layanan home-treatment?',
              answer: 'Cukup klik tombol "Chat via WhatsApp" di bawah ini. Customer Service kami akan langsung membantu menentukan lokasi & jadwal kunjungan.'
            },
            {
              question: 'Berapa jarak jangkauan layanan klinik?',
              answer: 'Kami melayani area home-treatment hingga jarak 30 km dari lokasi spa kami dengan ongkir terjangkau.'
            },
            {
              question: 'Apakah peralatan pijat bayi higienis?',
              answer: 'Ya, seluruh peralatan, minyak pijat alami, dan handuk disterilisasi sebelum dan sesudah setiap sesi perawatan.'
            }
          ],
          whatsapp_number: tenant?.whatsapp_number || landingJson.whatsapp_number || process.env.DEFAULT_WHATSAPP_PHONE || '6287751148065',
          meta_pixel_id: tenant?.meta_pixel_id || landingJson.meta_pixel_id || process.env.FB_PIXEL_ID || '123456789012345',
        };

        return reply.status(200).send(content);
      } catch (err: any) {
        console.error(`[TENANT SLUG RESOLVE ERROR] Failed to fetch tenant for slug ${slug}:`, err.message);
        // Fail-open default content
        return reply.status(200).send({
          tenant_id: DEFAULT_TENANT_ID,
          slug: slug || 'default',
          clinic_name: 'Kala Baby & Moms Spa',
          headline: 'Solusi Pijat & Perawatan Bayi Profesional di Rumah Anda',
          subheadline: 'Bidan bersertifikasi resmi datang langsung ke lokasi Anda.',
          benefits: [
            'Terapis Bidan Terlatih & Certified',
            'Peralatan Steril Standard Hospital',
            'Gratis Ongkir hingga 5 km',
          ],
          faq: [
            { question: 'Bagaimana cara booking?', answer: 'Klik tombol Chat via WhatsApp untuk terhubung dengan CS.' }
          ],
          whatsapp_number: process.env.DEFAULT_WHATSAPP_PHONE || '6287751148065',
          meta_pixel_id: process.env.FB_PIXEL_ID || '123456789012345',
        });
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
      const ipAddress = request.ip || (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || null;
      const userAgent = request.headers['user-agent'] || null;

      const clickData = {
        fbclid,
        fbp,
        fbc,
        ipAddress,
        userAgent,
        landingUrl,
        utmSource,
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
}


