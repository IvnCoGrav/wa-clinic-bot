import { describe, it, expect } from 'vitest';
import {
  isCtwaFuzzyAttribution,
  buildCapiJsonPayload,
} from '../../packages/admin-dashboard/src/pages/tenant/MetaCapiQueue';

describe('CTWA Fuzzy Attribution & Badging (Frontend Parity)', () => {
  it('identifies trackingCode starting with ctwa_fuzzy_ as CTWA Fuzzy', () => {
    const attribution = {
      isPaid: true,
      trackingCode: 'ctwa_fuzzy_abc123',
      ctwa_clid: null,
      fbc: null,
      fbclid: null,
      fbp: null,
      ipAddress: null,
      userAgent: null,
    };
    expect(isCtwaFuzzyAttribution(attribution)).toBe(true);
  });

  it('identifies utm.medium === "ctwa_fuzzy" as CTWA Fuzzy even without trackingCode prefix', () => {
    const attribution = {
      isPaid: true,
      trackingCode: 'custom_code',
      ctwa_clid: null,
      fbc: null,
      fbclid: null,
      fbp: null,
      ipAddress: null,
      userAgent: null,
    };
    const utm = {
      campaign: 'ctwa_campaign',
      source: 'whatsapp',
      medium: 'ctwa_fuzzy',
    };
    expect(isCtwaFuzzyAttribution(attribution, utm)).toBe(true);
  });

  it('does NOT identify web LP paid traffic as CTWA Fuzzy', () => {
    const attribution = {
      isPaid: true,
      trackingCode: 'mh',
      ctwa_clid: null,
      fbc: null,
      fbclid: '12345678',
      fbp: null,
      ipAddress: null,
      userAgent: null,
    };
    const utm = {
      campaign: 'promo_september',
      source: 'meta',
      medium: 'paid_ad',
    };
    expect(isCtwaFuzzyAttribution(attribution, utm)).toBe(false);
  });

  it('does NOT identify organic traffic as CTWA Fuzzy', () => {
    const attribution = {
      isPaid: false,
      trackingCode: null,
      ctwa_clid: null,
      fbc: null,
      fbclid: null,
      fbp: null,
      ipAddress: null,
      userAgent: null,
    };
    expect(isCtwaFuzzyAttribution(attribution)).toBe(false);
  });

  describe('buildCapiJsonPayload Parity & Fake Data Elimination', () => {
    const baseItem: any = {
      id: 'lead_1234567890',
      eventType: 'Purchase',
      value: 150000,
      treatment_detail: 'Pijat Batuk Pilek',
      customer: {
        id: 'cust_abc',
        name: 'Bunda Narita',
        phone: '081234567890',
        kota: 'Sidoarjo',
      },
      utm: {},
      attribution: {
        isPaid: true,
        trackingCode: null,
        ctwa_clid: null,
        fbc: null,
        fbclid: null,
        fbp: null,
        ipAddress: null,
        userAgent: null,
        landingUrl: null,
      },
      purchase_occurred_at: '2026-10-10T10:00:00Z',
    };

    it('Scenario Bunda Narita (CTWA Fuzzy): does NOT synthesize fake fbc, does NOT inject fake IP/UA/fbp, and keeps action_source as chat even if WABA configured', () => {
      const fuzzyItem = {
        ...baseItem,
        attribution: {
          ...baseItem.attribution,
          trackingCode: 'ctwa_fuzzy_lead_9999',
          isPaid: true,
        },
        utm: {
          medium: 'ctwa_fuzzy',
        },
      };

      const payload = buildCapiJsonPayload(fuzzyItem, true); // WABA is true

      // Paritas Backend capi.service.ts:1108
      expect(payload.action_source).toBe('chat');
      expect((payload as any).messaging_channel).toBeUndefined();

      // Fake data elimination: no fake FBC from fuzzy tracking code
      expect(payload.user_data.fbc).toBeUndefined();

      // Fake data elimination: no fake IP/UA/FBP for CTWA
      expect(payload.user_data.client_ip_address).toBeUndefined();
      expect(payload.user_data.client_user_agent).toBeUndefined();
      expect(payload.user_data.fbp).toBeUndefined();
    });

    it('Scenario CTWA Native: uses business_messaging when WABA configured, retains ctwa_clid, and does NOT inject fake IP/UA/fbp', () => {
      const nativeItem = {
        ...baseItem,
        attribution: {
          ...baseItem.attribution,
          ctwa_clid: 'official_ctwa_click_id_xyz',
          isPaid: true,
        },
      };

      const payloadWithWaba = buildCapiJsonPayload(nativeItem, true);
      expect(payloadWithWaba.action_source).toBe('business_messaging');
      expect(payloadWithWaba.messaging_channel).toBe('whatsapp');
      expect(payloadWithWaba.user_data.ctwa_clid).toBe('official_ctwa_click_id_xyz');
      expect(payloadWithWaba.user_data.client_ip_address).toBeUndefined();
      expect(payloadWithWaba.user_data.client_user_agent).toBeUndefined();
      expect(payloadWithWaba.user_data.fbp).toBeUndefined();

      const payloadNoWaba = buildCapiJsonPayload(nativeItem, false);
      expect(payloadNoWaba.action_source).toBe('chat');
      expect((payloadNoWaba as any).messaging_channel).toBeUndefined();
    });

    it('Scenario Web LP (Paid Promo): action_source chat, allows sample IP/UA/fbp fallback for browser ads preview', () => {
      const webLpItem = {
        ...baseItem,
        attribution: {
          ...baseItem.attribution,
          trackingCode: 'promo_lp_1',
          isPaid: true,
        },
        utm: {
          medium: 'cpc',
        },
      };

      const payload = buildCapiJsonPayload(webLpItem, false);
      expect(payload.action_source).toBe('chat');
      expect(payload.user_data.client_ip_address).toBe('114.122.34.56');
      expect(payload.user_data.client_user_agent).toBeDefined();
      expect(payload.user_data.fbp).toBe('fb.1.1787293849.1029384756');
      expect(payload.user_data.fbc).toContain('promo_lp_1');
    });
  });
});
