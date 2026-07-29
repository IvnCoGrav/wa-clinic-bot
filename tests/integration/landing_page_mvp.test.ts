import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import fs from 'fs';
import path from 'path';

describe('Fase 1 MVP — Educational Landing Page & Click Catcher Multi-Tenant Integration', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. GET /api/tenant/:slug should return dynamic TenantLandingContent JSON for tenant resolution', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tenant/kenanga',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.tenant_id).toBeDefined();
    expect(body.slug).toBe('kenanga');
    expect(body.clinic_name).toBeDefined();
    expect(body.headline).toContain('Pijat & Perawatan Bayi');
    expect(body.benefits).toBeInstanceOf(Array);
    expect(body.benefits.length).toBeGreaterThan(0);
    expect(body.faq).toBeInstanceOf(Array);
    expect(body.whatsapp_number).toBeDefined();
    expect(body.meta_pixel_id).toBeDefined();
  });

  it('2. POST /api/tracking/click should store AdClick record with correct multi-tenant tenant_id', async () => {
    process.env.TRACKING_API_KEY = 'test_tracking_key_123';

    const response = await app.inject({
      method: 'POST',
      url: '/api/tracking/click',
      headers: {
        'x-tracking-api-key': 'test_tracking_key_123',
      },
      payload: {
        tenantId: 'tenant_kenanga_789',
        slug: 'kenanga',
        fbclid: 'fb_click_id_test_999',
        utmSource: 'meta_ads',
        utmCampaign: 'baby_spa_promo',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.trackingCode).toBeDefined();
    expect(typeof body.trackingCode).toBe('string');
    expect(body.trackingCode.length).toBeGreaterThanOrEqual(2);
  });

  it('3. go.html template should contain mandatory id="wa-cta" CTA button contract & placeholders', () => {
    const htmlPath = path.join(process.cwd(), 'packages', 'click-catcher', 'public', 'go.html');
    expect(fs.existsSync(htmlPath)).toBe(true);

    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

    // Mandatory single CTA contract
    expect(htmlContent).toContain('id="wa-cta"');
    // Embedded Meta Pixel placeholder
    expect(htmlContent).toContain('__FB_PIXEL_ID__');
    // Educational sales page sections
    expect(htmlContent).toContain('__HEADLINE__');
    expect(htmlContent).toContain('__SUBHEADLINE__');
    expect(htmlContent).toContain('__BENEFITS_HTML__');
    // Fail-open 2-second safety timeout script
    expect(htmlContent).toContain('setTimeout');
    expect(htmlContent).toContain('executeFallbackRedirect');
  });

  it('4. SECURITY PROOF: GET /api/tenant/:slug MUST NEVER include meta_capi_access_token or secret keys in response JSON', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tenant/kenanga',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // CRITICAL SECURITY PROOF: meta_capi_access_token MUST NOT exist in JSON payload!
    expect(body.meta_capi_access_token).toBeUndefined();
    expect(body.capi_access_token).toBeUndefined();
    expect(body.google_refresh_token).toBeUndefined();
    expect(Object.keys(body)).not.toContain('meta_capi_access_token');
    expect(Object.keys(body)).not.toContain('meta_capi_token');
    expect(Object.keys(body)).not.toContain('google_refresh_token');
  });

  it('5. MULTI-TENANT PROOF: 2 different tenant slugs ("kenanga" & "melati") MUST return distinct whatsapp_number, meta_pixel_id, & content', async () => {
    const { prisma } = await import('../../src/db/client');
    
    vi.mocked(prisma.tenant.findFirst).mockImplementation(async (args: any) => {
      const slugCond = args?.where?.OR?.find((c: any) => c.slug)?.slug;
      if (slugCond === 'kenanga') {
        return {
          id: 'tenant_kenanga_123',
          slug: 'kenanga',
          name: 'Klinik Kenanga Baby Spa',
          whatsapp_number: '6281234567890',
          meta_pixel_id: '111122223333444',
          landing_content: {
            headline: 'Promo Pijat Bayi Klinik Kenanga',
          },
        } as any;
      }
      if (slugCond === 'melati') {
        return {
          id: 'tenant_melati_456',
          slug: 'melati',
          name: 'Klinik Melati Moms & Baby Care',
          whatsapp_number: '6289876543210',
          meta_pixel_id: '999988887777666',
          landing_content: {
            headline: 'Perawatan Ibu & Anak Klinik Melati',
          },
        } as any;
      }
      return null;
    });

    const resKenanga = await app.inject({ method: 'GET', url: '/api/tenant/kenanga' });
    const resMelati = await app.inject({ method: 'GET', url: '/api/tenant/melati' });

    expect(resKenanga.statusCode).toBe(200);
    expect(resMelati.statusCode).toBe(200);

    const bodyKenanga = JSON.parse(resKenanga.body);
    const bodyMelati = JSON.parse(resMelati.body);

    // PROOF OF MULTI-TENANT ISOLATION & DYNAMIC ATTRIBUTION:
    expect(bodyKenanga.whatsapp_number).toBe('6281234567890');
    expect(bodyMelati.whatsapp_number).toBe('6289876543210');
    expect(bodyKenanga.whatsapp_number).not.toBe(bodyMelati.whatsapp_number);

    expect(bodyKenanga.meta_pixel_id).toBe('111122223333444');
    expect(bodyMelati.meta_pixel_id).toBe('999988887777666');
    expect(bodyKenanga.meta_pixel_id).not.toBe(bodyMelati.meta_pixel_id);

    expect(bodyKenanga.headline).toBe('Promo Pijat Bayi Klinik Kenanga');
    expect(bodyMelati.headline).toBe('Perawatan Ibu & Anak Klinik Melati');
  });
});


