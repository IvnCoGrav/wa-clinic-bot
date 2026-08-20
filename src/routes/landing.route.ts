import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveLandingContent, defaultLandingContent, LandingContent } from '../services/landing-content.service';

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
      content.meta_pixel_id || process.env.FB_PIXEL_ID || '',
      nonce,
      {
        trackingApiBaseUrl: '',
        trackingApiKey: process.env.TRACKING_API_KEY || '',
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

  htmlContent = htmlContent
    .replace(/__CLINIC_NAME__/g, content.clinic_name || 'Moms & Baby Spa Homecare')
    .replace(/__HEADLINE__/g, content.headline || 'Solusi Pijat & Perawatan Bayi')
    .replace(/__SUBHEADLINE__/g, content.subheadline || 'Bidan bersertifikasi resmi datang ke lokasi Anda.')
    .replace(/__BENEFITS_HTML__/g, benefitsHtml)
    .replace(/__TRACKING_API_BASE_URL__/g, '')
    .replace(/__TRACKING_API_KEY__/g, process.env.TRACKING_API_KEY || '')
    .replace(/__FB_PIXEL_ID__/g, content.meta_pixel_id || process.env.FB_PIXEL_ID || '')
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
  fastify.get('/cta', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query || {}) as Record<string, string>;
    const tenantSlug = query.slug || 'default';
    const content = (await resolveLandingContent(tenantSlug)) || defaultLandingContent(tenantSlug);

    const pixelId = query.p || content.meta_pixel_id || process.env.FB_PIXEL_ID || '';
    
    // SELALU gunakan nomor WA dari pengaturan Customer Service / Tenant (Single Source of Truth), dengan fallback query.phone & env.
    const phone = content.whatsapp_number || query.phone || process.env.DEFAULT_WHATSAPP_PHONE || '';
    
    let rawMsg = query.msg || query.greetings || '';
    if (!rawMsg) {
      const { prisma } = await import('../db/client');
      const tenantRec = await prisma.tenant.findFirst({ where: { slug: tenantSlug } });
      rawMsg = (tenantRec as any)?.greetings_text || tenantRec?.format_visit || 'Halo Bu Bidan, saya tertarik dengan layanan home-treatment';
    }

    // Capture attribution & generate tracking code if needed
    let trackingCode = '';
    try {
      const { generateTrackingCode, memoryAdClicks } = await import('./tracking.route');
      const ip = (request.headers['x-forwarded-for'] as string) || request.ip || '';
      const ua = request.headers['user-agent'] || '';
      const { trackingCode: tc, record } = await generateTrackingCode({
        fbclid: query.fbclid || null,
        fbp: query.fbp || null,
        fbc: query.fbc || null,
        ipAddress: ip.split(',')[0].trim(),
        userAgent: ua,
        landingUrl: request.url,
        utmSource: query.utm_source || query.divisi || null,
        utmMedium: query.utm_medium || null,
        utmCampaign: query.utm_campaign || null,
        phone: query.phone || null, // URL parameter 'phone' hanya dipakai sebagai metadata atribusi di AdClick
        tenant_id: content.tenant_id,
      });
      trackingCode = tc;
      memoryAdClicks.set(trackingCode, record);
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
