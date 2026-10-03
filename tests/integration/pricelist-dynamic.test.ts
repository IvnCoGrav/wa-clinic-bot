import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import {
  treatmentCatalogService,
  ClinicServiceItem,
} from '../../src/services/treatment-catalog.service';
import {
  toDisplayName,
  buildSections,
  brandPrefixOf,
  serializePayloadForHtml,
  getPricelistPayload,
} from '../../src/services/pricelist.service';

/**
 * Integrasi dinamis Pricelist Landing Page:
 * - GET /pricelist  : HTML terhidrasi (server-side injection #pricelist-data).
 * - GET /api/pricelist : JSON publik tenant-aware.
 * - Transformer data-driven (tanpa hardcode nama/harga/nomor WA).
 */

function extractInjectedPayload(html: string): any {
  const m = html.match(/<script id="pricelist-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Blok #pricelist-data tidak ditemukan di HTML');
  return JSON.parse(m[1]);
}

function makeService(over: Partial<ClinicServiceItem> & { id: string; name: string }): ClinicServiceItem {
  return {
    category: 'BABY',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: 24, label: '0 - 24 Bulan' },
    durationMinutes: 40,
    originalPrice: 100000,
    promoPrice: 80000,
    description: 'Deskripsi uji',
    isActive: true,
    ...over,
  } as ClinicServiceItem;
}

describe('Pricelist dinamis — transformer (unit, data-driven)', () => {
  it('A. toDisplayName membersihkan prefix brand + kategori generik', () => {
    expect(toDisplayName('Kala Baby – Cukur Rambut', 'Kala', ['Baby'])).toBe('Cukur Rambut');
    expect(toDisplayName('Kala Kids – Pijat Ceria', 'Kala', ['Kids'])).toBe('Pijat Ceria');
    expect(toDisplayName('Kala Mom – Oksitosin Massage (Punggung)', 'Kala', ['Mom', 'Moms']))
      .toBe('Oksitosin Massage (Punggung)');
    expect(toDisplayName('Kala Bundle – Laktasi Total (Breast + Oksitosin Full Body)', 'Kala', ['Bundle']))
      .toBe('Laktasi Total (Breast + Oksitosin Full Body)');
    expect(toDisplayName('Kala Terapi – Infrared (Sinar Moksa)', 'Kala', ['Terapi', 'Add-on', 'Addon']))
      .toBe('Infrared (Sinar Moksa)');
    expect(toDisplayName('Kala Newborn – Paket Pendampingan 14 Sesi', 'Kala', ['Baby']))
      .toBe('Paket Pendampingan 14 Sesi');
  });

  it('B. tidak memutilasi nama layanan tanpa prefix brand (anti-overfit)', () => {
    expect(toDisplayName('Custom Service', 'Kala', ['Baby'])).toBe('Custom Service');
    expect(toDisplayName('Selapan: Cukur + Pijat Ceria', 'Kala', ['Bundle']))
      .toBe('Selapan: Cukur + Pijat Ceria');
  });

  it('C. brandPrefixOf mengambil token pertama businessName; aman saat kosong', () => {
    expect(brandPrefixOf('Kala Moms and Baby Spa')).toBe('Kala');
    expect(brandPrefixOf('')).toBe('');
    expect(brandPrefixOf(undefined)).toBe('');
  });

  it('D. merge varian usia: nama identik & prefix-age-suffix (guard label unik)', () => {
    const sections = buildSections([
      makeService({ id: 'a', name: 'Kala Baby – Pijat Ceria Newborn', ageTier: { minAgeMonths: 0, maxAgeMonths: 6, label: '0 - 6 Bulan' }, promoPrice: 60000, originalPrice: 80000 }),
      makeService({ id: 'b', name: 'Kala Baby – Pijat Ceria', ageTier: { minAgeMonths: 7, maxAgeMonths: 24, label: '7 - 24 Bulan' }, promoPrice: 70000, originalPrice: 80000 }),
      makeService({ id: 'c', name: 'Kala Kids – Pijat Ceria', category: 'KIDS', ageTier: { minAgeMonths: 24, maxAgeMonths: 48, label: '2 - 4 Tahun' } }),
      makeService({ id: 'd', name: 'Kala Kids – Pijat Ceria', category: 'KIDS', ageTier: { minAgeMonths: 72, maxAgeMonths: 96, label: '6 - 8 Tahun' } }),
      makeService({ id: 'e', name: 'Kala Mom – Induksi Massage', category: 'MOMS', ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil Aterm' } }),
      makeService({ id: 'f', name: 'Kala Mom – Induksi Massage Fullbody', category: 'MOMS', ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil Aterm' } }),
    ], 'Kala');

    const baby = sections.find((s) => s.id === 'baby')!;
    expect(baby.items).toHaveLength(1);
    expect(baby.items[0].n).toBe('Pijat Ceria');
    expect(baby.items[0].v).toHaveLength(2);
    // Diurutkan menaik berdasarkan usia
    expect(baby.items[0].v[0][0]).toBe('0 - 6 Bulan');

    const kids = sections.find((s) => s.id === 'kids')!;
    expect(kids.items).toHaveLength(1);
    expect(kids.items[0].v).toHaveLength(2);

    // Layanan berbeda dengan label usia SAMA dilarang digabung
    const moms = sections.find((s) => s.id === 'moms')!;
    expect(moms.items).toHaveLength(2);
  });

  it('E. serializePayloadForHtml meng-escape breakout </script>', () => {
    const payload = {
      tenantId: 't',
      slug: 'default',
      brand: { botDisplayName: 'B', businessName: 'X', serviceType: 's', addressTermForCustomer: 'Bunda' },
      whatsapp_number: '628',
      sections: [
        {
          id: 'baby', tab: 'x', icon: 'i', title: 'X', meta: '', note: '',
          items: [{ id: '1', n: '</script><script>alert(1)</script>', t: 1, k: 'x', v: [['0', 1, 2] as [string, number, number]] }],
        },
      ],
    };
    const out = serializePayloadForHtml(payload);
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c/script');
  });
});

describe('Pricelist dinamis — route & API (offline DB)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    process.env.DEFAULT_WHATSAPP_PHONE = '6281234567890';
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.tenant.findFirst).mockResolvedValue(null as any);
  });

  it('1. GET /pricelist menyajikan HTML terhidrasi + data katalog dinamis', async () => {
    const res = await app.inject({ method: 'GET', url: '/pricelist' });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/html');

    const body = res.body;
    expect(body).toContain('id="pricelist-data"');
    expect(body).toContain('ctaDrawer');
    expect(body).toContain('Pijat Pulih Ceria');

    const payload = extractInjectedPayload(body);
    expect(payload.whatsapp_number).toBe('6281234567890');
    expect(payload.brand.businessName).toBeTruthy();
    expect(Array.isArray(payload.sections)).toBe(true);
    expect(payload.sections.length).toBeGreaterThanOrEqual(4);

    for (const sec of payload.sections) {
      expect(sec.items.length).toBeGreaterThan(0);
      for (const item of sec.items) {
        expect(item.v.length).toBeGreaterThan(0);
        for (const v of item.v) {
          expect(Number.isInteger(v[1])).toBe(true);
          expect(Number.isInteger(v[2])).toBe(true);
          expect(v[2]).toBeGreaterThanOrEqual(v[1]);
        }
      }
    }
  });

  it('2. GET /api/pricelist mengembalikan JSON publik berschema benar', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pricelist' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.brand).toBeTruthy();
    expect(Array.isArray(body.data.sections)).toBe(true);
    expect(body.data.whatsapp_number).toBe('6281234567890');
  });

  it('3. Isolasi multi-tenant: slug lain → nomor WA & katalog terisolasi', async () => {
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValueOnce({
      id: 'lp-x',
      tenant_id: 'tenant-xyz',
      slug: 'partner',
      title: 'Partner',
      landing_type: 'STRUCTURED_JSON',
      html_content: null,
      structured_content: null,
      events: [],
      meta_pixel_id: null,
      whatsapp_number: null,
      is_active: true,
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: 'tenant-xyz',
      whatsapp_number: '628999000111',
    } as any);

    const res = await app.inject({ method: 'GET', url: '/api/pricelist?slug=partner' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.tenantId).toBe('tenant-xyz');
    expect(body.data.whatsapp_number).toBe('628999000111');
    // Katalog tenant tanpa seed tidak boleh membocorkan katalog default.
    expect(body.data.sections).toHaveLength(0);
  });

  it('4. Adversarial XSS: deskripsi </script> tidak breakout dari blok JSON', async () => {
    const evil = makeService({
      id: '__xss_test__',
      name: 'Kala Baby – XSS Probe',
      description: 'Jahat </script><script>alert(1)</script> & <img src=x>',
    });
    treatmentCatalogService.upsertService(evil, DEFAULT_TENANT_ID);
    try {
      const res = await app.inject({ method: 'GET', url: '/pricelist' });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('</script><script>alert(1)');
      expect(res.body).toContain('\\u003c/script');
      // Hanya ada 2 penutup script sah: script aplikasi + penutup tag data.
      expect((res.body.match(/<\/script>/g) || []).length).toBe(2);
      // Payload tetap valid & terbaca
      const payload = extractInjectedPayload(res.body);
      const probe = payload.sections.flatMap((s: any) => s.items).find((i: any) => i.id === '__xss_test__');
      expect(probe).toBeTruthy();
    } finally {
      treatmentCatalogService.deleteService('__xss_test__', DEFAULT_TENANT_ID);
    }
  });

  it('5. Live mutability: perubahan harga katalog langsung tercermin', async () => {
    const original = treatmentCatalogService.getServiceById('baby-massage-ceria');
    expect(original).toBeTruthy();
    const snapshot: ClinicServiceItem = JSON.parse(JSON.stringify(original));
    try {
      treatmentCatalogService.upsertService(
        { ...original!, promoPrice: 54321, originalPrice: 65432 },
        DEFAULT_TENANT_ID
      );
      const res = await app.inject({ method: 'GET', url: '/api/pricelist' });
      const payload = JSON.parse(res.body).data;
      const item = payload.sections
        .flatMap((s: any) => s.items)
        .find((i: any) => i.id === 'baby-massage-ceria');
      expect(item).toBeTruthy();
      const prices = item.v.map((v: any) => v[1]);
      expect(prices).toContain(54321);
    } finally {
      treatmentCatalogService.upsertService(snapshot, DEFAULT_TENANT_ID);
    }
  });

  it('6. Regresi: /go, /pricelist.html redirect, /health tetap utuh', async () => {
    const go = await app.inject({ method: 'GET', url: '/go' });
    expect(go.statusCode).toBe(200);
    expect(go.headers['content-type']).toContain('text/html');

    const redir = await app.inject({ method: 'GET', url: '/pricelist.html' });
    expect(redir.statusCode).toBe(302);
    expect(redir.headers.location).toBe('/pricelist');

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
  });

  it('7. getPricelistPayload tidak melempar saat DB offline', async () => {
    const payload = await getPricelistPayload(DEFAULT_TENANT_ID, { slug: 'default', whatsappFallback: '628000' });
    expect(payload.sections.length).toBeGreaterThan(0);
    expect(payload.brand.businessName).toBeTruthy();
  });
});
