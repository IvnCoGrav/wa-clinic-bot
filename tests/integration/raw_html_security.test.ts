import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { TenantHtmlService } from '../../src/services/tenant-html.service';

describe('Fase 1.5 — Raw HTML Custom Upload & 17-Layer Security Addendum Tests', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
  });

  it('1. Deny-List: HTML containing <base>, <meta refresh>, or <meta CSP> MUST be rejected (400 Bad Request)', async () => {
    // 1a. Base tag
    const resBase = await app.inject({
      method: 'PUT',
      url: '/api/admin/tenant/tenant_test_1/html',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { rawHtml: '<html><head><base href="https://evil.com/"></head><body><a id="wa-cta" href="#">CTA</a></body></html>' },
    });
    expect(resBase.statusCode).toBe(400);
    expect(JSON.parse(resBase.body).error).toContain('Forbidden tag: <base>');

    // 1b. Meta refresh
    const resRefresh = await app.inject({
      method: 'PUT',
      url: '/api/admin/tenant/tenant_test_1/html',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { rawHtml: '<html><head><meta http-equiv="refresh" content="0;url=http://evil.com"></head><body><a id="wa-cta" href="#">CTA</a></body></html>' },
    });
    expect(resRefresh.statusCode).toBe(400);
    expect(JSON.parse(resRefresh.body).error).toContain('http-equiv');
  });

  it('2. CTA Contract: Missing id="wa-cta" or duplicate id="wa-cta" MUST be rejected (400 Bad Request)', async () => {
    // 2a. Missing id="wa-cta"
    const resMissing = await app.inject({
      method: 'PUT',
      url: '/api/admin/tenant/tenant_test_2/html',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { rawHtml: '<html><body><h1>No CTA Button Here</h1></body></html>' },
    });
    expect(resMissing.statusCode).toBe(400);
    expect(JSON.parse(resMissing.body).error).toContain('id=\'wa-cta\' is missing');

    // 2b. Duplicate id="wa-cta"
    const resDuplicate = await app.inject({
      method: 'PUT',
      url: '/api/admin/tenant/tenant_test_2/html',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { rawHtml: '<html><body><a id="wa-cta" href="#">CTA 1</a><a id="wa-cta" href="#">CTA 2</a></body></html>' },
    });
    expect(resDuplicate.statusCode).toBe(400);
    expect(JSON.parse(resDuplicate.body).error).toContain('Duplicate id=\'wa-cta\' found');
  });

  it('3. Robust Visibility Guard: Hiding id="wa-cta" via display:none, visibility:hidden, opacity:0, or position:absolute left:-9999px MUST be rejected', () => {
    // 3a. display:none
    expect(() => TenantHtmlService.validateAndSanitize(
      '<html><body><a id="wa-cta" style="display:none" href="#">CTA</a></body></html>'
    )).toThrow('hidden or non-interactive');

    // 3b. visibility:hidden
    expect(() => TenantHtmlService.validateAndSanitize(
      '<html><body><a id="wa-cta" style="visibility:hidden" href="#">CTA</a></body></html>'
    )).toThrow('hidden or non-interactive');

    // 3c. opacity:0
    expect(() => TenantHtmlService.validateAndSanitize(
      '<html><body><a id="wa-cta" style="opacity:0" href="#">CTA</a></body></html>'
    )).toThrow('hidden or non-interactive');

    // 3d. position:absolute; left:-9999px
    expect(() => TenantHtmlService.validateAndSanitize(
      '<html><body><a id="wa-cta" style="position:absolute; left:-9999px" href="#">CTA</a></body></html>'
    )).toThrow('hidden or non-interactive');
  });

  it('4. Expanded Tag Sanitization: <iframe>, <form>, <button type="submit">, and dangerous CSS MUST be stripped', () => {
    const maliciousHtml = `
      <html>
        <head>
          <style>
            @import url('https://evil.com/evil.css');
            body { background: expression(alert(1)); }
          </style>
        </head>
        <body>
          <iframe src="https://phishing.com"></iframe>
          <form action="https://harvest.com"><input type="text" name="pass"/><button type="submit">Submit</button></form>
          <a id="wa-cta" href="#">Chat WA</a>
        </body>
      </html>
    `;

    expect(() => TenantHtmlService.validateAndSanitize(maliciousHtml)).toThrow(/Forbidden CSS/i);

    const htmlNoCssHazard = `
      <html>
        <body>
          <iframe src="https://phishing.com"></iframe>
          <form action="https://harvest.com"><input type="text" name="pass"/></form>
          <a id="wa-cta" href="#">Chat WA</a>
        </body>
      </html>
    `;

    const sanitized = TenantHtmlService.validateAndSanitize(htmlNoCssHazard);
    expect(sanitized).not.toContain('<iframe');
    expect(sanitized).not.toContain('<form');
    expect(sanitized).not.toContain('<input');
    expect(sanitized).toContain('id="wa-cta"');
  });

  it('5. Injected Script Nonce & Zero Trust: Injected script MUST use nonce and read server-side config exclusively', () => {
    const rawHtml = '<html><head></head><body><a id="wa-cta" data-phone="6289999999">Chat WA</a></body></html>';
    const sanitized = TenantHtmlService.validateAndSanitize(rawHtml);
    const nonce = 'random_nonce_12345';
    
    const injected = TenantHtmlService.injectTracking(sanitized, '123456789', nonce, {
      trackingApiBaseUrl: 'http://localhost:3000',
      trackingApiKey: 'api_key_test',
      whatsappNumber: '6287751148065',
      tenantId: 'tenant_1',
      tenantSlug: 'kenanga'
    });

    expect(injected).toContain(`script nonce="${nonce}"`);
    expect(injected).toContain('6287751148065'); // Reads server config phone
    expect(injected).toContain('kenanga');
    expect(injected).toContain('fbq(\'init\', \'123456789\')');
  });

  it('6. Payload Size Limit: HTML > 500 KB MUST return 413 Payload Too Large', async () => {
    const hugeHtml = '<html><body><a id="wa-cta" href="#">CTA</a>' + 'A'.repeat(501 * 1024) + '</body></html>';

    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/tenant/tenant_huge/html',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { rawHtml: hugeHtml },
    });

    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body).error).toContain('Payload Too Large');
  });

  it('7. Successful Upload: Valid Raw HTML upload returns 200 OK and sets landing_type = RAW_HTML', async () => {
    const validHtml = '<html><head><title>Promo Kenanga</title></head><body><div class="card"><h1>Special Offer</h1><a id="wa-cta" href="#">Chat Admin WA</a></div></body></html>';

    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/tenant/kenanga/html',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { rawHtml: validHtml },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.landingType).toBe('RAW_HTML');
  });

  it('8. Defense in Depth: Invalid non-string input MUST return graceful error and not crash process', async () => {
    const resInvalid = await app.inject({
      method: 'PUT',
      url: '/api/admin/tenant/tenant_invalid/html',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { rawHtml: null },
    });
    expect(resInvalid.statusCode).toBe(400);
    expect(JSON.parse(resInvalid.body).error).toContain('rawHtml field is required');
  });
});

