import Fastify from 'fastify';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import crypto from 'crypto';

// Load environment variables
dotenv.config();

const fastify = Fastify({
  logger: true,
});

const PORT = parseInt(process.env.PORT || '3002', 10);
const HOST = '0.0.0.0';

// In-Memory TTL Cache for Tenant Landing Content (5 Minutes TTL)
interface CacheEntry {
  content: any;
  expiresAt: number;
}
const tenantCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 Minutes

/**
 * Fetches tenant landing content from backend API with 2-second Fail-Open Timeout
 */
async function fetchTenantContent(slug: string): Promise<any> {
  const cached = tenantCache.get(slug);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.content;
  }

  const trackingApiBaseUrl = process.env.TRACKING_API_BASE_URL || 'http://localhost:3000';
  const defaultPhone = process.env.DEFAULT_WHATSAPP_PHONE || '';
  const fbPixelId = process.env.FB_PIXEL_ID || '';
  const defaultClinicName = process.env.CLINIC_NAME || 'Moms & Baby Spa Homecare';

  const defaultContent = {
    tenant_id: 'DEFAULT_TENANT_ID',
    slug,
    clinic_name: defaultClinicName,
    headline: 'Solusi Pijat & Perawatan Bayi Profesional di Rumah Anda',
    subheadline: 'Bidan bersertifikasi resmi datang langsung ke lokasi Anda. Bebas macet, nyaman, & steril.',
    benefits: [
      'Terapis Bidan Terlatih & Certified Spa Specialist',
      'Peralatan Steril & Hygienic Standard Rumah Sakit',
      'Gratis Ongkir Layanan Home-Treatment hingga 5 km',
      'Bebas Pilih Jadwal Fleksibel Sesuai Kenyamanan Bunda',
    ],
    faq: [
      { question: 'Bagaimana cara booking?', answer: 'Klik tombol Chat via WhatsApp untuk terhubung dengan CS.' }
    ],
    whatsapp_number: defaultPhone,
    meta_pixel_id: fbPixelId,
    landing_type: 'STRUCTURED_JSON',
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s Fail-Open Timeout

    const response = await fetch(`${trackingApiBaseUrl}/api/tenant/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      tenantCache.set(slug, {
        content: data,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return data;
    }
  } catch (err: any) {
    console.warn(`[CLICK CATCHER FAIL-OPEN] Backend slug resolution failed/timed out for ${slug}: ${err.message}. Using default generic clinic content.`);
  }

  return defaultContent;
}

// Expose health check endpoint
fastify.get('/health', async (request, reply) => {
  return reply.status(200).send({ status: 'OK' });
});

// Purge cache tenant landing content (dipanggil backend setelah upload/reset raw HTML)
fastify.post('/api/tracking/cache-purge', async (request: any, reply: any) => {
  const trackingApiKey = process.env.TRACKING_API_KEY || '';
  const clientKey = (request.headers['x-tracking-api-key'] as string) || '';
  if (!trackingApiKey || clientKey !== trackingApiKey) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid or missing X-Tracking-Api-Key header.' });
  }

  const body = (request.body || {}) as { slug?: string };
  const slug = (body.slug || '').toString().toLowerCase();
  if (slug) {
    tenantCache.delete(slug);
  } else {
    tenantCache.clear();
  }

  return reply.status(200).send({ success: true, purged: slug || '*' });
});

// Render Landing Page for /go, /:slug, or /promo/:slug
const renderLandingHandler = async (request: any, reply: any) => {
  try {
    const slug = request.params.slug || request.query.slug || 'default';
    const content = await fetchTenantContent(slug);

    // Generate cryptographically secure random nonce per request for strict CSP compliance (No unsafe-inline)
    const nonce = crypto.randomBytes(16).toString('base64');

    // Anti-Clickjacking, MIME-sniffing protection & Strict Nonce-based CSP Response Headers
    reply.header('Content-Security-Policy', `script-src 'nonce-${nonce}' https://connect.facebook.net; frame-ancestors 'none'; upgrade-insecure-requests;`);
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');


    // Handle RAW_HTML landing pages (Sanitize-at-render)
    if (content.landing_type === 'RAW_HTML' && content.raw_html_content) {
      const { TenantHtmlService } = await import('./html-sanitizer');
      const sanitizedHtml = TenantHtmlService.validateAndSanitize(content.raw_html_content);


      const injectedHtml = TenantHtmlService.injectTracking(
        sanitizedHtml,
        content.meta_pixel_id || process.env.FB_PIXEL_ID || '',
        nonce,
        {
          trackingApiBaseUrl: process.env.TRACKING_API_BASE_URL || '',
          trackingApiKey: process.env.TRACKING_API_KEY || '',
          whatsappNumber: content.whatsapp_number || process.env.DEFAULT_WHATSAPP_PHONE || '',
          tenantId: content.tenant_id || 'DEFAULT_TENANT_ID',
          tenantSlug: slug,
        },
        content.events || []
      );

      return reply.type('text/html').status(200).send(injectedHtml);
    }

    // Default STRUCTURED_JSON landing page rendering
    const htmlPath = path.join(__dirname, '../public/go.html');
    if (!fs.existsSync(htmlPath)) {
      request.log.error(`HTML file not found at ${htmlPath}`);
      return reply.status(500).send({ error: 'Redirection page template missing.' });
    }

    let htmlContent = fs.readFileSync(htmlPath, 'utf-8');

    // Build benefits list HTML
    const benefitsHtml = (content.benefits || [])
      .map((b: string) => `<div class="benefit-item"><span class="benefit-icon">✓</span><span>${b}</span></div>`)
      .join('\n');

    const trackingApiBaseUrl = process.env.TRACKING_API_BASE_URL || '';
    const trackingApiKey = process.env.TRACKING_API_KEY || '';

    // Per-landing pixel events (placeholder __EVENTS_ONLOAD__ / __EVENTS_ONCLICK__ di go.html)
    const ONLOAD_EVENTS = ['ViewContent', 'Search'];
    const CLICK_EVENTS = ['Lead', 'Purchase', 'InitiateCheckout', 'AddToCart', 'CompleteRegistration', 'Contact', 'StartTrial', 'Subscribe', 'CustomizeProduct'];
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
      .replace(/__TRACKING_API_BASE_URL__/g, trackingApiBaseUrl)
      .replace(/__TRACKING_API_KEY__/g, trackingApiKey)
      .replace(/__FB_PIXEL_ID__/g, content.meta_pixel_id || process.env.FB_PIXEL_ID || '')
      .replace(/__DEFAULT_WHATSAPP_PHONE__/g, content.whatsapp_number || process.env.DEFAULT_WHATSAPP_PHONE || '')
      .replace(/__TENANT_ID__/g, content.tenant_id || 'DEFAULT_TENANT_ID')
      .replace(/__TENANT_SLUG__/g, slug)
      .replace(/__EVENTS_ONLOAD__/g, eventsOnload)
      .replace(/__EVENTS_ONCLICK__/g, eventsOnclick)
      // Strict CSP: beri nonce pada script inline go.html supaya Pixel & tracking tidak diblokir
      .replace(/<script>/g, `<script nonce="${nonce}">`);

    return reply
      .type('text/html')
      .status(200)
      .send(htmlContent);
  } catch (error) {
    request.log.error(error, 'Failed to serve go.html redirection page');
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
};

export const RESERVED_SLUGS = new Set([
  'go',
  'promo',
  'health',
  'api',
  'admin',
  'public',
  'assets',
  'favicon.ico',
]);

fastify.get('/go', renderLandingHandler);
fastify.get('/promo/:slug', renderLandingHandler);
fastify.get('/:slug', async (request: any, reply: any) => {
  const slug = (request.params.slug || '').toLowerCase();
  if (RESERVED_SLUGS.has(slug)) {
    return reply.status(404).send({ error: `Not Found: '${slug}' is a reserved system keyword and cannot be used as a tenant slug.` });
  }
  return renderLandingHandler(request, reply);
});

// Start listening
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`[Click Catcher] Running at http://localhost:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
