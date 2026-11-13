import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveLandingContent, defaultLandingContent, LandingContent } from '../services/landing-content.service';
import { getPricelistPayload, serializePayloadForHtml } from '../services/pricelist.service';
import { isCatalogDegraded, getCatalogSource } from '../services/treatment-catalog.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { prisma } from '../db/client';

const RESERVED_SLUGS = new Set([
  'go',
  'promo',
  'cta',
  'health',
  'api',
  'admin',
  'public',
  'assets',
  'favicon.ico',
  'pricelist',
  'layanan',
]);

const ONLOAD_EVENTS = ['ViewContent', 'Search'];
const CLICK_EVENTS = [
  'Lead',
  // 'Purchase' DILARANG untuk event klik CTA (Purchase kanonis hanya dari pembayaran real via purchase-detection.service)
  'InitiateCheckout',
  'AddToCart',
  'CompleteRegistration',
  'Contact',
  'StartTrial',
  'Subscribe',
  'CustomizeProduct',
];

let templateCache: string | null = null;

function readLandingTemplate(): string {
  if (templateCache) return templateCache;
  const htmlPath = path.join(__dirname, '../landing/public/go.html');
  templateCache = fs.readFileSync(htmlPath, 'utf-8');
  return templateCache;
}

// Pricelist: template dibaca sekali, tetapi data katalog DIINJEKSI per-request
// (harga berubah via admin). Jangan cache HTML terhidrasi — hanya template mentah.
/**
 * Basis URL publik untuk metadata berbagi (canonical, og:url, og:image).
 * Urutan: env eksplisit → header reverse-proxy → host request.
 */
function resolvePublicBaseUrl(request?: FastifyRequest): string {
  const envBase = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (envBase) return envBase;
  if (!request) return '';
  const proto = String(request.headers['x-forwarded-proto'] || request.protocol || 'https')
    .split(',')[0]
    .trim();
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || '').trim();
  return host ? `${proto}://${host}` : '';
}

function escapeHtmlAttribute(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Isi placeholder metadata publik. Tanpa ini, pratinjau tautan di WhatsApp
 * menampilkan URL mentah tanpa judul/gambar.
 */
function applyPublicMetadata(
  html: string,
  opts: { baseUrl?: string; path?: string; title?: string; description?: string; clinicName?: string }
): string {
  const base = (opts.baseUrl || '').replace(/\/+$/, '');
  const canonical = base && opts.path ? `${base}${opts.path}` : '';
  const image = base ? `${base}/admin/pwa-512x512.png` : '';
  return html
    .replace(/__CANONICAL_URL__/g, canonical)
    .replace(/__OG_TITLE__/g, escapeHtmlAttribute(opts.title || ''))
    .replace(/__OG_DESCRIPTION__/g, escapeHtmlAttribute(opts.description || ''))
    .replace(/__OG_IMAGE__/g, image)
    .replace(/__CLINIC_NAME_SAFE__/g, escapeHtmlAttribute(opts.clinicName || ''));
}

let pricelistTemplateCache: string | null = null;

/**
 * Halaman pengganti saat katalog tidak bisa dibaca dari database.
 *
 * Sengaja mandiri (tanpa template katalog) supaya tidak ada harga lama yang ikut
 * tampil. Pesan jelas + jalur WhatsApp agar pengunjung tetap bisa bertanya.
 */
function renderCatalogUnavailablePage(brandName: string, whatsappNumber: string): string {
  const brand = escapeHtmlAttribute(brandName || 'Klinik kami');
  const digits = String(whatsappNumber || '').replace(/\D/g, '');
  const waHref = digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent('Halo, saya ingin menanyakan layanan dan harga terbaru.')}`
    : `https://wa.me/?text=${encodeURIComponent('Halo, saya ingin menanyakan layanan dan harga terbaru.')}`;
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>Katalog belum tersedia — ${brand}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
           font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
           background: #f0f2f5; color: #111b21; }
    .card { background: #fff; border: 1px solid #e9edef; border-radius: 20px; padding: 24px;
            max-width: 420px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,.06); }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 14px; line-height: 1.5; color: #54656f; margin: 0 0 18px; }
    a { display: inline-block; background: #008069; color: #fff; text-decoration: none;
        font-weight: 700; font-size: 14px; padding: 12px 20px; border-radius: 12px; }
    a:hover { background: #00a884; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Katalog belum tersedia</h1>
    <p>Maaf, daftar layanan dan harga sedang tidak dapat dimuat. Silakan hubungi kami lewat WhatsApp untuk info terbaru.</p>
    <a href="${waHref}" target="_blank" rel="noopener">Hubungi via WhatsApp</a>
  </main>
</body>
</html>`;
}

function readPricelistTemplate(): string {
  if (pricelistTemplateCache) return pricelistTemplateCache;
  const htmlPath = path.join(__dirname, '../landing/public/pricelist.html');
  pricelistTemplateCache = fs.readFileSync(htmlPath, 'utf-8');
  return pricelistTemplateCache;
}

// Halaman /layanan MENGGANTIKAN dirinya: katalog publik tunggal adalah
// /pricelist. Semua rute /layanan diarahkan permanen ke sana agar tautan lama
// (iklan, chat) tidak berakhir 404 dan tidak ada dua permukaan harga.
const RETIRED_CATALOG_TARGET = '/pricelist';


/**
 * Hydrate pricelist HTML: suntik payload katalog terbaru ke <head> agar tampil
 * instan (0 roundtrip) di in-app browser WhatsApp, tanpa FOUC.
 */
async function renderPricelist(reply: FastifyReply, request: FastifyRequest): Promise<FastifyReply> {
  const query = (request.query || {}) as Record<string, string>;
  const slug = (query.slug || 'default').toLowerCase();

  let tenantId = DEFAULT_TENANT_ID;
  let whatsappFallback = '';
  try {
    const content = await resolveLandingContent(slug);
    if (content) {
      tenantId = content.tenant_id || DEFAULT_TENANT_ID;
      whatsappFallback = content.whatsapp_number || '';
    }
  } catch (err: any) {
    request.log.warn(`[PRICELIST] Resolusi konten slug '${slug}' gagal (fallback default): ${err.message}`);
  }

  let payloadJson: string;
  let brandName = '';
  let fallbackNumber = '';
  try {
    const payload = await getPricelistPayload(tenantId, { slug, whatsappFallback });
    brandName = payload.brand?.businessName || '';
    fallbackNumber = payload.whatsapp_number || '';
    // Fail closed: bila katalog berasal dari seed in-memory (DB error/kosong),
    // jangan pernah menyajikan harga lama seolah data terkini.
    // Pengecualian NODE_ENV=test: fixture tes sengaja berjalan tanpa DB dan
    // menguji transformasi payload; jalur fail-closed diuji terpisah.
    const degraded = isCatalogDegraded(tenantId) || (payload.sections?.length ?? 0) === 0;
    if (degraded && process.env.NODE_ENV !== 'test') {
      request.log.error(
        { tenantId, source: getCatalogSource(tenantId) },
        '[PRICELIST] Katalog tidak tersedia dari database; halaman dialihkan ke mode fail-closed'
      );
      return reply
        .status(503)
        .header('Retry-After', '60')
        .header('Cache-Control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(renderCatalogUnavailablePage(brandName, fallbackNumber));
    }
    payloadJson = serializePayloadForHtml(payload);
  } catch (err: any) {
    request.log.error(err, '[PRICELIST] Gagal membangun payload dinamis');
    return reply
      .status(503)
      .header('Retry-After', '60')
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(renderCatalogUnavailablePage('', whatsappFallback));
  }

  let html: string;
  try {
    html = readPricelistTemplate();
  } catch (err: any) {
    request.log.error(err, 'Failed to load pricelist template');
    return reply.status(404).send({ error: 'Pricelist template missing' });
  }

  const injection = `<script id="pricelist-data" type="application/json">${payloadJson}</script>\n</head>`;
  html = html.replace('</head>', injection);
  if (brandName) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>Pricelist — ${brandName}</title>`);
  }
  html = applyPublicMetadata(html, {
    baseUrl: resolvePublicBaseUrl(request),
    path: '/pricelist',
    title: brandName ? `Pricelist — ${brandName}` : 'Pricelist',
    description: brandName
      ? `Daftar harga layanan ${brandName}. Harga terbaru langsung dari sistem klinik.`
      : 'Daftar harga layanan homecare.',
    clinicName: brandName,
  });

  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  return reply.type('text/html; charset=utf-8').status(200).send(html);
}

async function renderLanding(reply: FastifyReply, request: FastifyRequest, content: LandingContent, slug: string) {
  const nonce = crypto.randomBytes(16).toString('base64');

  reply.header(
    'Content-Security-Policy',
    `script-src 'nonce-${nonce}' https://connect.facebook.net; frame-ancestors 'none'; upgrade-insecure-requests;`
  );
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-Content-Type-Options', 'nosniff');

  if (content.landing_type === 'RAW_HTML' && content.raw_html_content) {
    const { TenantHtmlService } = await import('../services/tenant-html.service');
    const sanitizedHtml = TenantHtmlService.validateAndSanitize(content.raw_html_content);

    const injectedHtml = TenantHtmlService.injectTracking(
      sanitizedHtml,
      // Isolasi multi-tenant: env FB_PIXEL_ID HANYA untuk default-tenant.
      content.meta_pixel_id ||
        (content.tenant_id === DEFAULT_TENANT_ID ? process.env.FB_PIXEL_ID || '' : ''),
      nonce,
      {
        trackingApiBaseUrl: '',
        trackingApiKey: '',
        whatsappNumber: content.whatsapp_number || process.env.DEFAULT_WHATSAPP_PHONE || '',
        tenantId: content.tenant_id,
        tenantSlug: content.slug || slug,
      },
      content.events || []
    );

    return reply.type('text/html').status(200).send(injectedHtml);
  }

  let htmlContent: string;
  try {
    htmlContent = readLandingTemplate();
  } catch (err: any) {
    reply.log.error(err, 'Failed to load landing page template');
    return reply.status(500).send({ error: 'Landing page template missing.' });
  }

  const benefitsHtml = (content.benefits || [])
    .map((b: string) => `<div class="benefit-item"><span class="benefit-icon">✓</span><span>${b}</span></div>`)
    .join('\n');

  const events: string[] = content.events || [];
  const eventsOnload = events
    .filter((e) => ONLOAD_EVENTS.includes(e))
    .map((e) => `      fbq('track', '${e}');`)
    .join('\n');
  const eventsOnclick = events
    .filter((e) => {
      if (e === 'Purchase') {
        console.warn(`[TAXONOMY GATE] Event 'Purchase' ditolak untuk klik tombol CTA (slug=${slug}). Purchase hanya boleh ditembakkan pasca-pembayaran.`);
        return false;
      }
      return CLICK_EVENTS.includes(e);
    })
    .map((e) => `      if (typeof fbq !== 'undefined') { fbq('track', '${e}', {}, { eventID: trackingCode }); }`)
    .join('\n');

  const resolvedPixelId =
    content.meta_pixel_id ||
    (content.tenant_id === DEFAULT_TENANT_ID ? process.env.FB_PIXEL_ID || '' : '');

  // Isolasi multi-tenant (Q4): tanpa pixel valid, blok Meta Pixel dihapus total
  // dari template (tidak ada fbevents.js / fbq('init') / noscript img).
  if (!resolvedPixelId) {
    htmlContent = htmlContent.replace(/<!-- Meta Pixel Code -->[\s\S]*?<!-- End Meta Pixel Code -->/g, '');
  }

  htmlContent = htmlContent
    .replace(/__CLINIC_NAME__/g, content.clinic_name || 'Moms & Baby Spa Homecare')
    .replace(/__HEADLINE__/g, content.headline || 'Solusi Pijat & Perawatan Bayi')
    .replace(/__SUBHEADLINE__/g, content.subheadline || 'Bidan bersertifikasi resmi datang ke lokasi Anda.')
    .replace(/__BENEFITS_HTML__/g, benefitsHtml)
    .replace(/__TRACKING_API_BASE_URL__/g, '')
    .replace(/__TRACKING_API_KEY__/g, '')
    .replace(/__FB_PIXEL_ID__/g, resolvedPixelId)
    .replace(/__DEFAULT_WHATSAPP_PHONE__/g, content.whatsapp_number || process.env.DEFAULT_WHATSAPP_PHONE || '')
    .replace(/__TENANT_ID__/g, content.tenant_id)
    .replace(/__TENANT_SLUG__/g, content.slug || slug)
    .replace(/__EVENTS_ONLOAD__/g, eventsOnload)
    .replace(/__EVENTS_ONCLICK__/g, eventsOnclick);

  htmlContent = applyPublicMetadata(htmlContent, {
    baseUrl: resolvePublicBaseUrl(request),
    path: `/${content.slug || slug}`,
    title: content.title || content.clinic_name || 'Layanan Homecare',
    description: content.subheadline || content.headline || 'Layanan homecare klinik.',
    clinicName: content.clinic_name,
  });

  htmlContent = htmlContent
    .replace(/<script>/g, `<script nonce="${nonce}">`)
    .replace(/<script src=/g, `<script nonce="${nonce}" src=`);

  return reply.type('text/html').status(200).send(htmlContent);
}

async function resolveExternalTrackerPixel(rawTenant?: string): Promise<string> {
  const isValidPixel = (v: unknown): v is string => typeof v === 'string' && /^\d{5,20}$/.test(v);
  const hint = typeof rawTenant === 'string' && rawTenant.trim() ? rawTenant.trim() : null;
  const isDefaultRequest = !hint;

  let dbReachable = true;
  let pixel: string | null = null;
  try {
    const { prisma } = await import('../db/client');
    const tenant = await prisma.tenant.findFirst({
      where: hint ? { OR: [{ id: hint }, { slug: hint }] } : { id: DEFAULT_TENANT_ID },
      select: { meta_pixel_id: true },
    });
    pixel = tenant?.meta_pixel_id ?? null;
  } catch {
    dbReachable = false;
  }

  if (isValidPixel(pixel)) return pixel;
  // Tenant non-default tanpa pixel: JANGAN pinjam pixel env milik default-tenant.
  if (dbReachable && !isDefaultRequest) return '';
  // Tanpa hint / DB offline: fallback env hanya untuk default-tenant (perilaku lama).
  const envPixel = process.env.FB_PIXEL_ID;
  return isValidPixel(envPixel) ? envPixel : '';
}

export async function landingRoutes(fastify: FastifyInstance) {
  // /go — pintu masuk kampanye iklan (selalu tersedia, fail-open generik)
  fastify.get('/go', async (request: FastifyRequest, reply: FastifyReply) => {
    const slug = (request.query as any)?.slug || 'default';
    const content = (await resolveLandingContent(slug)) || defaultLandingContent(slug);
    return renderLanding(reply, request, content, slug);
  });

  // /cta — lightweight redirect ke WhatsApp dengan Meta Pixel & tracking code
  fastify.get(
    '/cta',
    {
      // Fase 3c (issue #136): endpoint publik yang membuat baris AdClick +
      // fallback PageView — tanpa batas, 1 IP bisa membanjiri data atribusi.
      // Sejajar /api/tracking/click (60/menit/IP); lebih → 429 + Retry-After.
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.ip,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query || {}) as Record<string, string>;
    const tenantSlug = query.slug || 'default';
    const content = (await resolveLandingContent(tenantSlug)) || defaultLandingContent(tenantSlug);

    // Isolasi multi-tenant (Q5): override pixel via query ?p= HANYA untuk default-tenant
    // (anti-spoofing attribution); tenant lain selalu memakai pixel DB-nya sendiri.
    // Env FB_PIXEL_ID juga HANYA untuk default-tenant.
    const isDefaultTenant = content.tenant_id === DEFAULT_TENANT_ID;
    const pixelId =
      (isDefaultTenant ? query.p : undefined) ||
      content.meta_pixel_id ||
      (isDefaultTenant ? process.env.FB_PIXEL_ID || '' : '');
    
    // SELALU gunakan nomor WA dari pengaturan Customer Service / Tenant (Single Source of Truth), dengan fallback query.phone & env.
    const phone = content.whatsapp_number || query.phone || process.env.DEFAULT_WHATSAPP_PHONE || '';
    
    let rawMsg = query.msg || query.greetings || '';
    if (!rawMsg) {
      // Fail-open (bug pre-existing #136): query greetings tanpa try/catch membuat
      // GET /cta 500 "Database offline" saat DB down — padahal kontrak route ini
      // selalu 200 + redirect (test lama luput karena mock di-override per-test).
      try {
        const { prisma } = await import('../db/client');
        const tenantRec = await prisma.tenant.findFirst({ where: { slug: tenantSlug } });
        rawMsg = (tenantRec as any)?.greetings_text || tenantRec?.format_visit || '';
      } catch (greetErr: any) {
        request.log.warn(`[CTA GREETING LOOKUP] Gagal ambil greeting tenant (fail-open): ${greetErr.message}`);
      }
      if (!rawMsg) {
        rawMsg = 'Halo Bu Bidan, saya tertarik dengan layanan home-treatment';
      }
    }

    // Capture attribution & generate tracking code if needed (BOT diabaikan kecuali test eksplisit)
    let trackingCode = '';
    const ua = request.headers['user-agent'] || '';
    const isTest = query.is_test === 'true' || query.test === '1' || query.debug === 'true' || query.utm_source === 'test' || query.divisi === 'test';
    
    try {
      const { generateTrackingCode, memoryAdClicks, isBotOrCrawler } = await import('./tracking.route');
      const isBot = !isTest && isBotOrCrawler(ua);

      if (!isBot) {
        // SEC-AUDIT-15 / M-06: XFF kiri bisa dipalsukan klien; `request.ip`
        // mengikuti trustProxy (hop proxy tepercaya) sehingga otoritatif.
        const ip = request.ip || '';
        const host = (request.headers['x-forwarded-host'] as string) || request.headers.host || '';
        const proto = (request.headers['x-forwarded-proto'] as string) || 'https';

        let tenantDomain = '';
        if (content?.tenant_id) {
          try {
            const { prisma } = await import('../db/client');
            const tenant = await prisma.tenant.findUnique({ where: { id: content.tenant_id } });
            if ((tenant as any)?.landing_domain) {
              tenantDomain = (tenant as any).landing_domain.trim().replace(/\/$/, '');
            }
          } catch {}
        }

        let fullLandingUrl = query.landing_url || (
          request.url.startsWith('http') 
            ? request.url 
            : (tenantDomain ? `${tenantDomain}${request.url}` : (host ? `${proto}://${host}${request.url}` : request.url))
        );

        // Jika landing_url diberikan tanpa query string tetapi request /cta membawa parameter tracking, gabungkan agar utuh
        if (query.landing_url && !query.landing_url.includes('?')) {
          const ctaQueryIdx = request.url.indexOf('?');
          if (ctaQueryIdx !== -1) {
            const rawParams = new URLSearchParams(request.url.slice(ctaQueryIdx + 1));
            rawParams.delete('landing_url');
            rawParams.delete('slug');
            rawParams.delete('p');
            rawParams.delete('msg');
            rawParams.delete('greetings');
            const remainingQuery = rawParams.toString();
            if (remainingQuery) {
              fullLandingUrl = `${query.landing_url}?${remainingQuery}`;
            }
          }
        }

        // Kanonikalisasi landingUrl SEBELUM disimpan — cegah AdClick.landingUrl tersimpan sebagai app.* /cta (kasus Aisyah 929).
        // Jika landing_url tidak dikirim (external-tracker belum terpasang atau klik sebelum scan), fallback app.kalababyspa/cta akan
        // dipetakan ke Tenant.landing_domain + /reservasionline agar event_source_url konsisten dengan PageView.
        if (!query.landing_url) {
          request.log.warn(`[CTA LANDING_URL MISSING] No landing_url param from ${host}${request.url} — fallback ke kanonikalisasi. Pasang external-tracker.js di LP eksternal.`);
        }
        try {
          const { resolveCanonicalLandingUrl } = await import('../services/capi.service');
          const canonical = resolveCanonicalLandingUrl(fullLandingUrl, tenantDomain);
          if (canonical) fullLandingUrl = canonical;
        } catch {}

        const clickData = {
          fbclid: query.fbclid || null,
          fbp: query.fbp || null,
          fbc: query.fbc || null,
          ipAddress: ip.trim(),
          userAgent: ua,
          landingUrl: fullLandingUrl,
          utmSource: isTest ? (query.utm_source || 'test') : (query.utm_source || query.divisi || null),
          utmMedium: query.utm_medium || null,
          utmCampaign: query.utm_campaign || null,
          phone: query.phone || null, // URL parameter 'phone' hanya dipakai sebagai metadata atribusi di AdClick
          tenant_id: content.tenant_id,
        };

        try {
          const { trackingCode: tc, record } = await generateTrackingCode(clickData);
          trackingCode = tc;
          memoryAdClicks.set(trackingCode, record);
        } catch (dbErr: any) {
          // DB offline fallback ke in-memory store
          const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
          let tc = '';
          for (let i = 0; i < 2; i++) {
            tc += chars.charAt(crypto.randomInt(chars.length));
          }
          const clickRecord = {
            id: `cuid_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            trackingCode: tc,
            ...clickData,
            matchedAt: null,
            customerId: null,
            createdAt: new Date(),
          };
          trackingCode = tc;
          memoryAdClicks.set(trackingCode, clickRecord);
        }

        // Fase 3b (issue #136): fallback PageView — klik CTA tanpa beacon tercatat
        // tidak boleh membuat views = 0. Gate deterministik berbasis data-state:
        // tracker SELALU menstempel `landing_url` ke link /cta yang diprosesnya
        // (dan beacon PageView ikut terkirim saat boot) → klik TANPA `landing_url`
        // = LP tanpa tracker / link manual → sintesis view `source='cta-fallback'`.
        // Klik DENGAN `landing_url` = tracker aktif → beacon sudah ada → jangan sintesis.
        // Dedup: fbclid sama sudah tercatat (race klik-dini) → jangan baris kedua.
        // Tanpa fbclid tidak ada kunci dedup andal → langsung sintesis.
        // Mode test tidak menyintesis (anti-polusi data).
        if (!query.landing_url && !isTest) {
          try {
            const { prisma } = await import('../db/client');
            const fbclidQ = query.fbclid || null;
            let alreadyTracked = false;
            if (fbclidQ) {
              const existingView = await (prisma as any).landingPageView.findFirst({
                where: { tenant_id: content.tenant_id, fbclid: fbclidQ },
              });
              alreadyTracked = !!existingView; // beacon sudah ada → jangan sintesis
            }
            if (!alreadyTracked) {
              const viewData = {
                tenant_id: content.tenant_id,
                landingUrl: fullLandingUrl,
                fbclid: fbclidQ,
                fbp: query.fbp || null,
                fbc: query.fbc || null,
                ipAddress: request.ip || null,
                userAgent: ua,
                utmSource: isTest ? (query.utm_source || 'test') : (query.utm_source || query.divisi || null),
                utmMedium: query.utm_medium || null,
                utmCampaign: query.utm_campaign || null,
                utmContent: query.utm_content || null,
                utmTerm: query.utm_term || null,
                utmId: query.utm_id || null,
                eventId: null, // klik tidak punya eventID kembar — baris murni sintesis
                referrer: null,
                source: 'cta-fallback',
              };
              await (prisma as any).landingPageView.create({ data: viewData });
            }
          } catch (fbErr: any) {
            if (fbErr?.code === 'P2002') {
              // Duplikat (retry/race) → dedup, bukan error
            } else {
              // DB offline → fail-open ke memory (paritas dengan beacon)
              try {
                const { memoryPageViews, pruneMemoryMap } = await import('./tracking.route');
                pruneMemoryMap(memoryPageViews, 2000);
                memoryPageViews.set(`cta_${Date.now()}_${Math.random().toString(36).substring(7)}`, {
                  source: 'cta-fallback',
                  tenant_id: content.tenant_id,
                  landingUrl: fullLandingUrl,
                  fbclid: query.fbclid || null,
                  createdAt: new Date(),
                });
              } catch {}
            }
          }
        }
      }
    } catch (err: any) {
      request.log.warn(`[CTA TRACKING ERROR] ${err.message}`);
    }

    // Insert tracking code into message text matching Promo[code] or [code] format
    let finalMsg = rawMsg.replace(/\r\n/g, '\n');
    if (trackingCode) {
      if (finalMsg.includes('[%ID%]')) {
        finalMsg = finalMsg.replace(/\[%ID%\]/g, `[${trackingCode}]`);
      } else if (finalMsg.includes('%ID%')) {
        finalMsg = finalMsg.replace(/%ID%/g, `[${trackingCode}]`);
      } else if (!finalMsg.includes(`[${trackingCode}]`)) {
        finalMsg = finalMsg.replace(/^(?:Promo\s*)?\[\s*[\w\s-]{2,32}?\s*\]\s*/i, '').trim();
        finalMsg = `Promo[${trackingCode}]\n\n${finalMsg}`.trim();
      }
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(finalMsg)}`;

    const nonce = crypto.randomBytes(16).toString('base64');
    reply.header(
      'Content-Security-Policy',
      `script-src 'nonce-${nonce}' https://connect.facebook.net; frame-ancestors 'none'; upgrade-insecure-requests;`
    );
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');

    const pixelBlock = pixelId
      ? `
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '${pixelId}');
  fbq('track', 'AddToCart', { content_name: 'WhatsApp CTA', content_category: 'CTWA' }${trackingCode ? `, { eventID: '${trackingCode}' }` : ''});`
      : '';

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redirecting to WhatsApp...</title>
  <script nonce="${nonce}">
    ${pixelBlock}
    setTimeout(function() {
      window.location.href = ${JSON.stringify(waUrl)};
    }, 300);
  </script>
</head>
<body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #334155;">
  <div style="text-align: center;">
    <p>Menghubungkan ke WhatsApp...</p>
    <a href="${waUrl}" style="color: #25d366; font-weight: bold;">Klik di sini jika tidak otomatis teralihkan</a>
  </div>
</body>
</html>`;

    return reply.type('text/html').status(200).send(html);
  });

  // /promo/:slug — landing per-slug (strict 404)
  fastify.get('/promo/:slug', async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
    const slug = (request.params.slug || '').toLowerCase();
    const content = await resolveLandingContent(slug);
    if (!content) {
      return reply.status(404).send({ error: `Not Found: landing '${slug}' tidak ditemukan.` });
    }
    return renderLanding(reply, request, content, slug);
  });

  // /assets/:filename — serve static assets dari public/ (clientParamBuilder.bundle.js, external-tracker.js)
  fastify.get(
    '/assets/:filename',
    async (
      request: FastifyRequest<{ Params: { filename: string }; Querystring: { tenant?: string } }>,
      reply: FastifyReply
    ) => {
    const { filename } = request.params;
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return reply.status(400).send({ error: 'Invalid filename' });
    }
    try {
      const filePath = path.join(__dirname, '../landing/public', filename);
      let content: Buffer = await fs.promises.readFile(filePath);
      if (filename.endsWith('.js')) {
        reply.type('application/javascript');
      } else if (filename.endsWith('.css')) {
        reply.type('text/css');
      } else if (filename.endsWith('.svg')) {
        reply.type('image/svg+xml');
      } else if (filename.endsWith('.png')) {
        reply.type('image/png');
      } else if (filename.endsWith('.webp')) {
        reply.type('image/webp');
      }

      // M-02: pixel default tracker diambil dari DB tenant (bukan hardcode).
      // `?tenant=<id|slug>` diverifikasi ke DB; tanpa itu → default-tenant.
      if (filename === 'external-tracker.js') {
        const pixelId = await resolveExternalTrackerPixel(request.query?.tenant);
        content = Buffer.from(
          content.toString('utf8').replace('__DEFAULT_PIXEL_ID__', pixelId),
          'utf8'
        );
        reply.header('Cache-Control', 'public, max-age=300');
      }

      return reply.send(content);
    } catch {
      return reply.status(404).send({ error: 'Not Found' });
    }
  }
  );

  // /pricelist & alias — serve landing page pricelist resmi (terhidrasi dari DB)
  fastify.get('/pricelist', async (request: FastifyRequest, reply: FastifyReply) => {
    return renderPricelist(reply, request);
  });

  // /layanan dipensiunkan: katalog publik tunggal ada di /pricelist.
  // 301 permanen supaya tautan lama (iklan/chat) tidak 404 dan tidak ada
  // dua permukaan harga yang bisa menyimpang.
  fastify.get('/layanan', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect(301, RETIRED_CATALOG_TARGET);
  });

  fastify.get('/layanan.html', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect(301, RETIRED_CATALOG_TARGET);
  });

  // /api/pricelist — katalog JSON publik (tenant-aware via ?slug=)
  fastify.get(
    '/api/pricelist',
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
      const query = (request.query || {}) as Record<string, string>;
      const slug = (query.slug || 'default').toLowerCase();

      let tenantId = DEFAULT_TENANT_ID;
      let whatsappFallback = '';
      try {
        const content = await resolveLandingContent(slug);
        if (content) {
          tenantId = content.tenant_id || DEFAULT_TENANT_ID;
          whatsappFallback = content.whatsapp_number || '';
        }
      } catch (err: any) {
        request.log.warn(`[PRICELIST API] Resolusi slug '${slug}' gagal (fallback default): ${err.message}`);
      }

      const payload = await getPricelistPayload(tenantId, { slug, whatsappFallback });
      return reply.status(200).send({ success: true, data: payload });
    }
  );

  fastify.get('/pricelist.html', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect('/pricelist');
  });

  fastify.get('/pricelist-baru.html', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect('/pricelist');
  });

  // /:slug — landing per-slug (strict 404)
  fastify.get('/:slug', async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
    const slug = (request.params.slug || '').toLowerCase();
    if (RESERVED_SLUGS.has(slug)) {
      return reply.status(404).send({ error: `Not Found: '${slug}' is a reserved system keyword.` });
    }
    const content = await resolveLandingContent(slug);
    if (!content) {
      return reply.status(404).send({ error: `Not Found: landing '${slug}' tidak ditemukan.` });
    }
    return renderLanding(reply, request, content, slug);
  });
}
