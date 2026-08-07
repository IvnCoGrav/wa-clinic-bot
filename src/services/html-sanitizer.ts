import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';

export interface ServerTrackingConfig {
  trackingApiBaseUrl: string;
  trackingApiKey: string;
  whatsappNumber: string;
  tenantId: string;
  tenantSlug: string;
}

export class TenantHtmlService {
  /**
   * Validates and sanitizes raw HTML uploaded by a tenant.
   * Throws detailed errors if validation fails.
   */
  static validateAndSanitize(htmlString: string): string {
    if (!htmlString || typeof htmlString !== 'string') {
      throw new Error('Invalid HTML input: Content must be a non-empty string.');
    }

    // 1. Check Payload Size Limit (< 500 KB)
    const byteSize = Buffer.byteLength(htmlString, 'utf-8');
    if (byteSize > 500 * 1024) {
      throw new Error(`Payload Too Large: HTML size (${Math.round(byteSize / 1024)} KB) exceeds maximum limit of 500 KB.`);
    }

    // 2. Check Critical Deny-List Tags & Meta
    if (/<base\b/i.test(htmlString)) {
      throw new Error('Forbidden tag: <base> is not allowed as it can hijack relative URL resolution.');
    }

    if (/<meta\s+[^>]*http-equiv=["']?refresh["']?/i.test(htmlString)) {
      throw new Error("Forbidden tag: <meta http-equiv='refresh'> is not allowed as it can auto-redirect users away.");
    }

    if (/<meta\s+[^>]*http-equiv=["']?content-security-policy["']?/i.test(htmlString)) {
      throw new Error("Forbidden tag: <meta http-equiv='content-security-policy'> is not allowed as it overrides server CSP.");
    }

    // 3. Load into Cheerio for CTA Contract & Visibility Inspection
    let $: cheerio.CheerioAPI;
    try {
      $ = cheerio.load(htmlString);
    } catch (parseErr: any) {
      throw new Error('Bad Request: Malformed or unparseable HTML content.');
    }
    const ctaElements = $('#wa-cta');


    if (ctaElements.length === 0) {
      throw new Error("CTA Contract Violation: Mandatory element with id='wa-cta' is missing.");
    }

    if (ctaElements.length > 1) {
      throw new Error("CTA Contract Violation: Duplicate id='wa-cta' found. Exactly one element with id='wa-cta' is allowed.");
    }

    // 4. Robust CTA Visibility Check
    const cta = ctaElements.first();
    const styleAttr = (cta.attr('style') || '').toLowerCase();

    const isHiddenByStyle = 
      /display\s*:\s*none/i.test(styleAttr) ||
      /visibility\s*:\s*hidden/i.test(styleAttr) ||
      /opacity\s*:\s*0(?![.0-9])/i.test(styleAttr) ||
      /width\s*:\s*0/i.test(styleAttr) ||
      /height\s*:\s*0/i.test(styleAttr) ||
      /left\s*:\s*-[0-9]{3,}/i.test(styleAttr) ||
      /position\s*:\s*absolute.*left\s*:\s*-/i.test(styleAttr);

    if (isHiddenByStyle) {
      throw new Error("CTA Contract Violation: Element with id='wa-cta' is hidden or non-interactive.");
    }

    // 5. Expanded HTML Sanitization via sanitize-html
    const sanitized = sanitizeHtml(htmlString, {
      allowVulnerableTags: true,
      allowedTags: [
        'html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',

        'ul', 'ol', 'li', 'b', 'i', 'strong', 'em', 'strike', 'code', 'hr', 'br', 'table', 'thead',
        'tbody', 'tr', 'th', 'td', 'style', 'section', 'header', 'footer', 'main', 'nav', 'article',
        'aside', 'figure', 'figcaption', 'title', 'meta', 'link'
      ],
      // FORBID script, iframe, object, embed, form, input, button[type="submit"]
      disallowedTagsMode: 'discard',
      allowedAttributes: {
        '*': ['id', 'class', 'style', 'title', 'lang', 'dir'],
        'a': ['href', 'target', 'rel'],
        'img': ['src', 'alt', 'width', 'height', 'loading'],
        'link': ['rel', 'href', 'type'],
        'meta': ['name', 'content', 'charset', 'viewport']
      },
      allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
      allowProtocolRelative: false,
      transformTags: {
        'style': (tagName: string, attribs: Record<string, string>) => {
          return { tagName, attribs };
        }
      }
    });

    // Final check for CSS injection hazards in style tags
    if (/expression\s*\(/i.test(sanitized) || /behavior\s*:/i.test(sanitized) || /@import\s+/i.test(sanitized)) {
      throw new Error('Forbidden CSS: Dangerous CSS expressions (@import, expression, behavior) are not allowed.');
    }

    return sanitized;
  }

  /**
   * Injects Meta Pixel & Click-Catcher tracking scripts into sanitized HTML.
   * Uses cryptographically generated nonce for strict CSP compliance.
   * Enforces Zero Trust for tenant DOM attributes (reads only serverConfig).
   */
  static injectTracking(
    htmlString: string,
    metaPixelId: string,
    nonce: string,
    config: ServerTrackingConfig,
    events: string[] = []
  ): string {
    const $ = cheerio.load(htmlString);

    // Event yang di-fire saat landing load (setelah PageView)
    const ONLOAD_EVENTS: string[] = ['ViewContent', 'Search'];
    // Event yang di-fire saat klik CTA (konversi/intent) sebelum redirect
    const CLICK_EVENTS: string[] = ['Lead', 'Purchase', 'InitiateCheckout', 'AddToCart', 'CompleteRegistration', 'Contact', 'StartTrial', 'Subscribe', 'CustomizeProduct'];

    const pixelOnloadLines = events
      .filter((e) => ONLOAD_EVENTS.includes(e))
      .map((e) => `        fbq('track', '${e}');`)
      .join('\n');

    const clickPixelEvents = JSON.stringify(events.filter((e) => CLICK_EVENTS.includes(e)));

    // 1. Inject Meta Pixel into <head> with nonce
    const pixelSnippet = `
      <script nonce="${nonce}">
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${metaPixelId}');
        fbq('track', 'PageView');
${pixelOnloadLines}
      </script>
    `;

    if ($('head').length > 0) {
      $('head').append(pixelSnippet);
    } else {
      $.root().prepend(`<head>${pixelSnippet}</head>`);
    }

    // 2. Inject Click-Catcher Script before </body> with nonce (Zero Trust for tenant DOM attributes)
    const clickCatcherSnippet = `
      <script nonce="${nonce}">
        (function() {
          const trackingApiBaseUrl = ${JSON.stringify(config.trackingApiBaseUrl)};
          const trackingApiKey = ${JSON.stringify(config.trackingApiKey)};
          const defaultPhone = ${JSON.stringify(config.whatsappNumber)};
          const tenantId = ${JSON.stringify(config.tenantId)};
          const tenantSlug = ${JSON.stringify(config.tenantSlug)};

          function getQueryParam(name) {
            const urlParams = new URLSearchParams(window.location.search);
            return urlParams.get(name);
          }

          function getCookie(name) {
            const value = '; ' + document.cookie;
            const parts = value.split('; ' + name + '=');
            if (parts.length === 2) return parts.pop().split(';').shift();
            return null;
          }

          const fbclid = getQueryParam('fbclid');
          const utmSource = getQueryParam('utm_source');
          const utmMedium = getQueryParam('utm_medium');
          const utmCampaign = getQueryParam('utm_campaign');
          const fbp = getCookie('_fbp');
          const fbc = getCookie('_fbc');

          const clickPixelEvents = ${clickPixelEvents};

          const ctaBtn = document.getElementById('wa-cta');
          let isRedirecting = false;

          function executeFallbackRedirect(phone) {
            if (isRedirecting) return;
            isRedirecting = true;
            const targetPhone = phone || defaultPhone;
            const fallbackUrl = 'https://wa.me/' + targetPhone + '?text=Halo%20Bunda%2C%20saya%20tertarik%20dengan%20layanan%20home-treatment';
            window.location.href = fallbackUrl;
          }

          if (ctaBtn) {
            ctaBtn.addEventListener('click', function(e) {
              e.preventDefault();
              if (isRedirecting) return;

              ctaBtn.style.opacity = '0.7';

              const safetyTimeout = setTimeout(function() {
                executeFallbackRedirect(defaultPhone);
              }, 2000);

              if (!trackingApiKey) {
                clearTimeout(safetyTimeout);
                executeFallbackRedirect(defaultPhone);
                return;
              }

              const payload = {
                fbclid: fbclid || null,
                fbp: fbp || null,
                fbc: fbc || null,
                landingUrl: window.location.href,
                utmSource: utmSource || null,
                utmMedium: utmMedium || null,
                utmCampaign: utmCampaign || null,
                tenantId: tenantId,
                slug: tenantSlug,
              };

              fetch((trackingApiBaseUrl ? trackingApiBaseUrl.replace(/\/+$/, '') : '') + '/api/tracking/click', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Tracking-Api-Key': trackingApiKey,
                },
                body: JSON.stringify(payload),
              })
              .then(function(res) {
                if (!res.ok) throw new Error('API Response Error');
                return res.json();
              })
              .then(function(data) {
                clearTimeout(safetyTimeout);
                if (isRedirecting) return;
                isRedirecting = true;

                const trackingCode = data.trackingCode || 'promo';
                clickPixelEvents.forEach(function(ev) { if (window.fbq) fbq('track', ev, {}, { eventID: trackingCode }); });
                const redirectUrl = 'https://wa.me/' + defaultPhone + '?text=Promo%5B' + trackingCode + '%5D%20Halo%20Bunda%2C%20saya%20tertarik%20dengan%20layanan%20home-treatment';
                window.location.href = redirectUrl;
              })
              .catch(function(err) {
                clearTimeout(safetyTimeout);
                executeFallbackRedirect(defaultPhone);
              });
            });
          }
        })();
      </script>
    `;

    if ($('body').length > 0) {
      $('body').append(clickCatcherSnippet);
    } else {
      $.root().append(`<body>${clickCatcherSnippet}</body>`);
    }

    return $.html();
  }
}
