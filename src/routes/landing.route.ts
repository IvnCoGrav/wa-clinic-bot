import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveLandingContent, defaultLandingContent, LandingContent } from '../services/landing-content.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';

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
]);

const ONLOAD_EVENTS = ['ViewContent', 'Search'];
const CLICK_EVENTS = [
  'Lead',
  'Purchase',
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

async function renderLanding(reply: FastifyReply, content: LandingContent, slug: string) {
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
    .filter((e) => CLICK_EVENTS.includes(e))
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
    .replace(/__EVENTS_ONCLICK__/g, eventsOnclick)
    .replace(/<script>/g, `<script nonce="${nonce}">`)
    .replace(/<script src=/g, `<script nonce="${nonce}" src=`);

  return reply.type('text/html').status(200).send(htmlContent);
}

export async function landingRoutes(fastify: FastifyInstance) {
  // /go — pintu masuk kampanye iklan (selalu tersedia, fail-open generik)
  fastify.get('/go', async (request: FastifyRequest, reply: FastifyReply) => {
    const slug = (request.query as any)?.slug || 'default';
    const content = (await resolveLandingContent(slug)) || defaultLandingContent(slug);
    return renderLanding(reply, content, slug);
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
        const ip = (request.headers['x-forwarded-for'] as string) || request.ip || '';
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
          ipAddress: ip.split(',')[0].trim(),
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
        // Tanpa fbclid tidak ada kunci dedup andal (IP semua visitor = IP proxy di
        // belakang Caddy, KNOWN_ISSUES #129) → langsung sintesis.
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
    return renderLanding(reply, content, slug);
  });

  // /assets/:filename — serve static assets dari public/ (clientParamBuilder.bundle.js, external-tracker.js)
  fastify.get('/assets/:filename', async (request: FastifyRequest<{ Params: { filename: string } }>, reply: FastifyReply) => {
    const { filename } = request.params;
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return reply.status(400).send({ error: 'Invalid filename' });
    }
    try {
      const filePath = path.join(__dirname, '../landing/public', filename);
      const content = await fs.promises.readFile(filePath);
      if (filename.endsWith('.js')) {
        reply.type('application/javascript');
      } else if (filename.endsWith('.css')) {
        reply.type('text/css');
      }
      return reply.send(content);
    } catch {
      return reply.status(404).send({ error: 'Not Found' });
    }
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
    return renderLanding(reply, content, slug);
  });
}
