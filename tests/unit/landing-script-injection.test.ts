import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { TenantHtmlService } from '../../src/services/html-sanitizer';
import { injectScriptNonce } from '../../src/routes/landing.route';

const CTA_HTML = `<!DOCTYPE html><html><head><title>x</title></head><body>
<a id="wa-cta" href="https://wa.me/628">Chat</a>
</body></html>`;

describe('landing script-context injection', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = 'test_admin_key_landing';
    process.env.DEFAULT_WHATSAPP_PHONE = '6281234567890';
    process.env.FB_PIXEL_ID = '1234567890';
  });

  it('injectTracking tidak membiarkan </script> atau kutip memutus blok script', () => {
    const html = TenantHtmlService.injectTracking(
      CTA_HTML,
      `123';alert(1)//`,
      'nonce-test',
      {
        trackingApiBaseUrl: `https://app.example.com</script><script>alert(1)</script>`,
        trackingApiKey: `k';alert(2)//`,
        whatsappNumber: `</script><img src=x onerror=alert(3)>`,
        tenantId: `t');alert(4)//`,
        tenantSlug: `s</script>`,
      },
      ['Lead']
    );

    expect(html).not.toContain('</script><script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(3)>');
    expect(html.toLowerCase()).not.toContain("alert(1)//');");
    expect(html).toContain('\\u003c');
  });

  it('/cta mengabaikan pixel override yang tidak valid', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/cta?slug=default&p=${encodeURIComponent(`123';alert(1)//`)}`,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; TestBot/1.0)' },
    });
    // Entah redirect 200 atau fail-closed 503; yang penting payload tidak dieksekusi.
    expect([200, 503]).toContain(res.statusCode);
    expect(res.body).not.toContain("alert(1)//");
    expect(res.body).not.toContain('123\';');
    await app.close();
  });

  it('/cta memakai pixel valid dari env bila override ditolak', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/cta?slug=default&p=${encodeURIComponent('@@invalid@@')}`,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; TestBot/1.0)' },
    });
    if (res.statusCode === 200) {
      expect(res.body).toContain(`fbq('init', "1234567890")`);
    }
    await app.close();
  });

  describe('injectScriptNonce (anti-duplicate CSP nonce)', () => {
    it('menyuntikkan nonce secara tepat pada <script>, <script id=...>, dan <script type=...>', () => {
      const sample = `
        <script type="application/ld+json">{"@context":"schema"}</script>
        <script id="pricelist-data" type="application/json">{"data":1}</script>
        <script>console.log("hello");</script>
      `;
      const injected = injectScriptNonce(sample, 'NONCE123');
      expect(injected).toContain('<script nonce="NONCE123" type="application/ld+json">');
      expect(injected).toContain('<script nonce="NONCE123" id="pricelist-data" type="application/json">');
      expect(injected).toContain('<script nonce="NONCE123">');
      // Anti-regresi: tidak boleh ada tag script dengan atribut nonce ganda
      expect(injected).not.toMatch(/<script[^>]*nonce="[^"]*"[^>]*nonce=/i);
    });

    it('idempotent: dipanggil 2x tidak melipatgandakan atribut nonce', () => {
      const sample = `<script>console.log("test");</script>`;
      const once = injectScriptNonce(sample, 'NONCE123');
      const twice = injectScriptNonce(once, 'NONCE123');
      expect(twice).toBe('<script nonce="NONCE123">console.log("test");</script>');
      expect(twice).not.toContain('nonce="NONCE123" nonce="NONCE123"');
    });

    it('mengabaikan tag script yang sudah memiliki nonce bawaan', () => {
      const sample = `<script nonce="EXISTING_NONCE">console.log("test");</script>`;
      const res = injectScriptNonce(sample, 'NEW_NONCE');
      expect(res).toBe(sample);
    });
  });
});
