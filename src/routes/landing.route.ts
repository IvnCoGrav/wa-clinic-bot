import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveLandingContent, defaultLandingContent, LandingContent } from '../services/landing-content.service';

const RESERVED_SLUGS = new Set([
  'go',
  'promo',
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
    .map((e) => `      fbq('track', '${e}');`)
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
    .replace(/<script>/g, `<script nonce="${nonce}">`);

  return reply.type('text/html').status(200).send(htmlContent);
}

export async function landingRoutes(fastify: FastifyInstance) {
  // /go — pintu masuk kampanye iklan (selalu tersedia, fail-open generik)
  fastify.get('/go', async (request: FastifyRequest, reply: FastifyReply) => {
    const slug = (request.query as any)?.slug || 'default';
    const content = (await resolveLandingContent(slug)) || defaultLandingContent(slug);
    return renderLanding(reply, content, slug);
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
