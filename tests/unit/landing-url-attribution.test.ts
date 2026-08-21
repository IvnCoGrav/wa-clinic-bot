import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { capiService } from '../../src/services/capi.service';
import { memoryAdClicks } from '../../src/routes/tracking.route';

describe('Meta Full-Funnel Attribution & Landing URL Preservation', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    memoryAdClicks.clear();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    process.env.TRACKING_API_KEY = 'test_tracking_key';
    process.env.FB_PIXEL_ID = 'TEST_PIXEL_ID_123';
    process.env.FB_CAPI_ACCESS_TOKEN = 'TEST_CAPI_TOKEN_123';
    process.env.DEFAULT_WHATSAPP_PHONE = '6281234567890';
    vi.mocked(prisma.tenant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
  });

  it('1. GET /cta captures external landing_url and stores in AdClick record', async () => {
    const targetLandingUrl = 'https://kalababyspa.online/reservasionline?utm_source=ig&utm_medium=paid&utm_campaign=120250056175160235&fbclid=PAcGRvZgJleHRu';
    
    const res = await app.inject({
      method: 'GET',
      url: `/cta?landing_url=${encodeURIComponent(targetLandingUrl)}&utm_source=ig&fbclid=PAcGRvZgJleHRu`,
      headers: {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
        'x-forwarded-for': '114.124.205.12',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');

    // Cek bahwa tracking code terbentuk dan tersimpan di in-memory store
    const entries = Array.from(memoryAdClicks.entries());
    expect(entries.length).toBeGreaterThan(0);

    const [trackingCode, record] = entries[0];
    expect(trackingCode).toBeDefined();
    expect(record.landingUrl).toBe(targetLandingUrl);
    expect(record.utmSource).toBe('ig');
    expect(record.fbclid).toBe('PAcGRvZgJleHRu');

    // Cek bahwa HTML mengandung AddToCart pixel dan waUrl dengan Promo[code]
    expect(res.body).toContain("fbq('track', 'AddToCart'");
    expect(res.body).toContain(`Promo%5B${trackingCode}%5D`);
  });

  it('2. GET /cta cleanly merges query params if landing_url is provided without query string', async () => {
    const baseLandingUrl = 'https://kalababyspa.online/reservasionline';
    
    const res = await app.inject({
      method: 'GET',
      url: `/cta?landing_url=${encodeURIComponent(baseLandingUrl)}&utm_source=ig&utm_campaign=promo2026&fbclid=CLID999`,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'x-forwarded-for': '180.244.10.5',
      },
    });

    expect(res.statusCode).toBe(200);

    const entries = Array.from(memoryAdClicks.entries());
    const [, record] = entries[0];
    expect(record.landingUrl).toContain('https://kalababyspa.online/reservasionline?');
    expect(record.landingUrl).toContain('utm_source=ig');
    expect(record.landingUrl).toContain('utm_campaign=promo2026');
    expect(record.landingUrl).toContain('fbclid=CLID999');
  });

  it('3. capiService.sendCapiEvent constructs event_source_url and hashes PII (phone, name) for Contact event', async () => {
    const mockCustomer = {
      id: 'cust-123',
      phone: '089667285350',
      name: 'Bunda Sarah',
      pushName: 'Bunda',
      kota: 'Surabaya',
      zipcode: '60111',
    };

    const mockAdClick = {
      trackingCode: 'ck',
      landingUrl: 'https://kalababyspa.online/reservasionline?utm_source=ig&fbclid=PAcGRvZ',
      fbp: 'fb.1.1787293849.1029384756',
      fbc: 'fb.1.1787293849.ck',
      utmSource: 'ig',
      utmMedium: 'paid',
      utmCampaign: '120250056175160235',
      ipAddress: '114.124.205.12',
      userAgent: 'Mozilla/5.0 (iPhone)',
    };

    let sentUrl = '';
    let sentPayload: any = null;

    // Spy on capiBreaker.execute
    const { capiBreaker } = await import('../../src/services/capi.service');
    const spy = vi.spyOn(capiBreaker, 'execute').mockImplementation(async (url: string, payload: any) => {
      sentUrl = url;
      sentPayload = payload;
      return { status: 200, data: { events_received: 1, fbtrace_id: 'TRACE_123' } };
    });

    const result = await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer: mockCustomer,
      adClick: mockAdClick,
      tenantId: 'default-tenant',
      customData: {
        source: 'WHATSAPP_INBOUND_CTA',
      },
    });

    expect(result.success).toBe(true);
    expect(sentPayload).toBeDefined();
    expect(sentPayload.data.length).toBe(1);

    const event = sentPayload.data[0];
    expect(event.event_name).toBe('Contact');
    expect(event.event_id).toBe('ck');
    expect(event.event_source_url).toBe('https://kalababyspa.online/reservasionline?utm_source=ig&fbclid=PAcGRvZ');
    expect(event.action_source).toBe('chat');

    // PII Hashing verification
    expect(event.user_data.ph).toBeDefined();
    expect(Array.isArray(event.user_data.ph)).toBe(true);
    expect(event.user_data.ph[0]).toMatch(/^[a-f0-9]{64}(\.[a-zA-Z0-9_-]+)?$/); // SHA-256 with ParamBuilder appendix

    expect(event.user_data.fn).toBeDefined();
    expect(Array.isArray(event.user_data.fn)).toBe(true);
    expect(event.user_data.fn[0]).toMatch(/^[a-f0-9]{64}(\.[a-zA-Z0-9_-]+)?$/); // SHA-256 with ParamBuilder appendix

    expect(event.user_data.fbp).toContain('fb.1.1787293849.1029384756');
    expect(event.user_data.fbc).toContain('fb.1.1787293849.ck');

    spy.mockRestore();
  });

  it('4. capiService.sendCapiEvent constructs Purchase event with exact treatment GMV and initial landing URL', async () => {
    const mockCustomer = {
      id: 'cust-123',
      phone: '6289667285350',
      name: 'Bunda',
      kota: 'Surabaya',
      zipcode: '60111',
    };

    const mockAdClick = {
      trackingCode: 'ck',
      landingUrl: 'https://kalababyspa.online/reservasionline?utm_source=ig&utm_campaign=120250056175160235&fbclid=PAcGRvZ',
      fbp: 'fb.1.1787293849.1029384756',
      fbc: 'fb.1.1787293849.ck',
      utmSource: 'ig',
      utmMedium: 'paid',
      utmCampaign: '120250056175160235',
    };

    let sentPayload: any = null;

    const { capiBreaker } = await import('../../src/services/capi.service');
    const spy = vi.spyOn(capiBreaker, 'execute').mockImplementation(async (url: string, payload: any) => {
      sentPayload = payload;
      return { status: 200, data: { events_received: 1, fbtrace_id: 'TRACE_PURCHASE' } };
    });

    const result = await capiService.sendCapiEvent({
      eventName: 'Purchase',
      customer: mockCustomer,
      adClick: mockAdClick,
      value: 85000,
      currency: 'IDR',
      tenantId: 'default-tenant',
      customData: {
        content_name: 'Pijat Bayi Pulih Ceria',
        content_type: 'product',
        contents: [{ id: 'treatment_1', item_name: 'Pijat Bayi Pulih Ceria', quantity: 1 }],
      },
    });

    expect(result.success).toBe(true);
    const event = sentPayload.data[0];
    expect(event.event_name).toBe('Purchase');
    expect(event.event_id).toBe('ck');
    expect(event.event_source_url).toBe('https://kalababyspa.online/reservasionline?utm_source=ig&utm_campaign=120250056175160235&fbclid=PAcGRvZ');
    expect(event.custom_data.value).toBe(85000);
    expect(event.custom_data.currency).toBe('IDR');
    expect(event.custom_data.content_name).toBe('Pijat Bayi Pulih Ceria');

    spy.mockRestore();
  });

  it('5. resolveCanonicalLandingUrl automatically fixes legacy /cta URLs and extracts nested landing_url', async () => {
    const { resolveCanonicalLandingUrl } = await import('../../src/services/capi.service');

    // Case A: legacy URL with /cta?divisi=... mapped to tenant landing domain
    const legacyUrl = 'https://app.kalababyspa.online/cta?divisi=iklan-utama&fbclid=PAcGRvZ&utm_source=ig';
    const resolvedA = resolveCanonicalLandingUrl(legacyUrl, 'https://kalababyspa.online/reservasionline');
    expect(resolvedA).toBe('https://kalababyspa.online/reservasionline?fbclid=PAcGRvZ&utm_source=ig');

    // Case B: legacy URL when tenant domain is empty in DB -> auto strips app. and points to /reservasionline
    const resolvedEmpty = resolveCanonicalLandingUrl(legacyUrl, '');
    expect(resolvedEmpty).toBe('https://kalababyspa.online/reservasionline?fbclid=PAcGRvZ&utm_source=ig');

    // Case C: URL containing nested landing_url query param
    const nestedUrl = 'https://app.kalababyspa.online/cta?landing_url=https%3A%2F%2Fkalababyspa.online%2Freservasionline%3Futm_source%3Dig&fbclid=PAcGRvZ';
    const resolvedC = resolveCanonicalLandingUrl(nestedUrl, 'https://kalababyspa.online/reservasionline');
    expect(resolvedC).toBe('https://kalababyspa.online/reservasionline?utm_source=ig');

    // Case D: relative path /cta?fbclid=...
    const relativeUrl = '/cta?fbclid=PAc123&utm_campaign=promo';
    const resolvedD = resolveCanonicalLandingUrl(relativeUrl, 'https://kalababyspa.online/reservasionline');
    expect(resolvedD).toBe('https://kalababyspa.online/reservasionline?fbclid=PAc123&utm_campaign=promo');

    // Case E: already clean landing URL remains unchanged
    const cleanUrl = 'https://kalababyspa.online/reservasionline?fbclid=PAc123';
    const resolvedE = resolveCanonicalLandingUrl(cleanUrl, 'https://kalababyspa.online/reservasionline');
    expect(resolvedE).toBe(cleanUrl);
  });

  it('6. extractValueByFormat accurately extracts pure Treatment GMV (70.000) instead of Total including shipping (85.000)', async () => {
    const { extractValueByFormat } = await import('../../src/services/capi.service');

    const reservationMsg = `Berikut reservasi 

Hari dan tanggal :  jumat, 21/8/26 jam 12.00-12.30
Nama Bunda:  Mery 
Alamat & Shareloc :Natura Residence Cluster Summerland C2 - 3A buduran 
Kec : Buduran
Kota : Sidoarjo
No. Hp : 089667285350

Pilihan treatment (Baby & Kids)

Nama Bayi : Hansen
Usia Bayi/Anak : 1 tahun 
Treatment : pijat bayi pulih ceria 

Payment :
Treatment = 70.000
Ongkir 13km = 25.000
Promo ongkir = - 10.000
*Total = 85.000*

Terimakasih.`;

    const pureValue = extractValueByFormat(reservationMsg, 'Treatment = %VALUE%');
    expect(pureValue).toBe(70000);
  });
});
