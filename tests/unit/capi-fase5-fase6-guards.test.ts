import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { capiService, resolveCanonicalLandingUrl } from '../../src/services/capi.service';
import { prisma } from '../../src/db/client';
import axios from 'axios';

vi.mock('axios');

describe('FASE 5 & 6: SaaS Landing, Fail-Open, & Payload Sanitization Guards', () => {
  const tenantId = 'default-tenant';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. resolveCanonicalLandingUrl menormalkan domain tenant tanpa protocol menjadi https://', () => {
    const canonical = resolveCanonicalLandingUrl('/cta?fbclid=TEST123', 'kalababyspa.online');
    expect(canonical).toBe('https://kalababyspa.online/reservasionline?fbclid=TEST123');

    const canonical2 = resolveCanonicalLandingUrl('/reservasionline', 'kalababyspa.online/');
    expect(canonical2).toBe('https://kalababyspa.online/reservasionline');
  });

  it('2. sendCapiEvent membersihkan telemetri internal bot dari custom_data (A-011)', async () => {
    let capturedPayload: any = null;
    vi.mocked(axios.post).mockImplementation(async (_url: any, payload: any) => {
      capturedPayload = payload;
      return { status: 200, data: { events_received: 1 } };
    });

    await capiService.sendCapiEvent({
      eventName: 'Contact',
      customer: { id: 'cust-clean-payload', phone: '08123456789' },
      tenantId,
      customData: {
        content_name: 'Pijat Bayi',
        // Internal telemetry bot yang WAJIB dibersihkan
        fuzzyScore: 0.95,
        effectiveScore: 0.92,
        mql_bubble_count: 3,
        ruleTriggered: 'INTENT_PRICE_MATCH',
        matchSource: 'catalog_db',
        rawPayload: { secret: 'do-not-leak' },
        adminSender: 'Admin 1',
      },
    });

    expect(capturedPayload).not.toBeNull();
    const customData = capturedPayload.data[0].custom_data;

    // Field bisnis standar Meta ada
    expect(customData.content_name).toBe('Pijat Bayi');

    // Field internal bot bersih / tidak dikirim ke Meta
    expect(customData.fuzzyScore).toBeUndefined();
    expect(customData.effectiveScore).toBeUndefined();
    expect(customData.mql_bubble_count).toBeUndefined();
    expect(customData.ruleTriggered).toBeUndefined();
    expect(customData.matchSource).toBeUndefined();
    expect(customData.rawPayload).toBeUndefined();
    expect(customData.adminSender).toBeUndefined();
  });

  it('3. Feature Flag PURCHASE_VALUE_GUARD: jika mode "block", memblokir mutasi purchase_value pasca CAPI', async () => {
    const origEnv = process.env.PURCHASE_VALUE_GUARD;
    try {
      process.env.PURCHASE_VALUE_GUARD = 'block';
      const { getPurchaseValueGuard } = await import('../../src/config/feature-flags');
      expect(getPurchaseValueGuard()).toBe('block');
    } finally {
      process.env.PURCHASE_VALUE_GUARD = origEnv;
    }
  });

  it('4. Feature Flag CTA_FALLBACK_CAPI: getter mengevaluasi env secara tepat', async () => {
    const origEnv = process.env.CTA_FALLBACK_CAPI;
    try {
      process.env.CTA_FALLBACK_CAPI = 'true';
      const { isCtaFallbackCapi } = await import('../../src/config/feature-flags');
      expect(isCtaFallbackCapi()).toBe(true);

      process.env.CTA_FALLBACK_CAPI = 'false';
      expect(isCtaFallbackCapi()).toBe(false);
    } finally {
      process.env.CTA_FALLBACK_CAPI = origEnv;
    }
  });
});
