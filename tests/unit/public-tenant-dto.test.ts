import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { toPublicTenantDto, type LandingContent } from '../../src/services/landing-content.service';

function content(): LandingContent {
  return {
    tenant_id: 'tenant-rahasia',
    slug: 'promo',
    title: 'Promo',
    landing_type: 'RAW_HTML',
    raw_html_content: '<script>alert(1)</script>',
    events: [],
    clinic_name: 'Klinik',
    headline: 'H',
    subheadline: 'S',
    benefits: ['B'],
    faq: [{ question: 'Q', answer: 'A' }],
    whatsapp_number: '+62 812-3456-7890',
    meta_pixel_id: '1234567890',
  };
}

describe('public tenant DTO', () => {
  it('hanya mengirim field publik, tanpa HTML mentah/tenant_id/pixel', () => {
    const dto = toPublicTenantDto(content());
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('raw_html_content');
    expect(serialized).not.toContain('tenant-rahasia');
    expect(serialized).not.toContain('meta_pixel_id');
    expect(serialized).not.toContain('<script>');
    expect(dto.whatsapp_number).toBe('6281234567890');
    expect(dto.slug).toBe('promo');
  });

  describe('GET /api/tenant/:slug', () => {
    beforeEach(() => {
      process.env.ADMIN_API_KEY = 'test_admin_key';
    });

    it('slug tak dikenal → 404, bukan konten default 200', async () => {
      const app = buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/tenant/tidak-ada' });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('raw_html_content');
      await app.close();
    });
  });
});
