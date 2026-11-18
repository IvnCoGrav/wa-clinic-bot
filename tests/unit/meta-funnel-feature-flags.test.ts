import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isCapiStrictDelivery,
  isAuditPiiRedaction,
  getAdClickDedupMode,
  getPurchaseValueGuard,
  isCtaFallbackCapi,
  isTrackingOriginEnforced,
  isCspReportEnabled,
  isPixelHealthEnabled,
} from '../../src/config/feature-flags';

describe('Meta Funnel Feature Flags (Fase 0)', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('default semua flag adalah off / warn / false', () => {
    delete process.env.CAPI_STRICT_DELIVERY;
    delete process.env.AUDIT_PII_REDACTION;
    delete process.env.AD_CLICK_DEDUP_MODE;
    delete process.env.PURCHASE_VALUE_GUARD;
    delete process.env.CTA_FALLBACK_CAPI;
    delete process.env.TRACKING_ORIGIN_ENFORCE;
    delete process.env.CSP_REPORT_ENABLED;
    delete process.env.PIXEL_HEALTH_ENABLED;

    expect(isCapiStrictDelivery()).toBe(false);
    expect(isAuditPiiRedaction()).toBe(false);
    expect(getAdClickDedupMode()).toBe('off');
    expect(getPurchaseValueGuard()).toBe('warn');
    expect(isCtaFallbackCapi()).toBe(false);
    expect(isTrackingOriginEnforced()).toBe(false);
    expect(isCspReportEnabled()).toBe(false);
    expect(isPixelHealthEnabled()).toBe(false);
  });

  it('membaca nilai true dari environment variable', () => {
    process.env.CAPI_STRICT_DELIVERY = 'true';
    process.env.AUDIT_PII_REDACTION = 'true';
    process.env.AD_CLICK_DEDUP_MODE = 'swap';
    process.env.PURCHASE_VALUE_GUARD = 'block';
    process.env.CTA_FALLBACK_CAPI = 'true';
    process.env.TRACKING_ORIGIN_ENFORCE = 'true';
    process.env.CSP_REPORT_ENABLED = 'true';
    process.env.PIXEL_HEALTH_ENABLED = 'true';

    expect(isCapiStrictDelivery()).toBe(true);
    expect(isAuditPiiRedaction()).toBe(true);
    expect(getAdClickDedupMode()).toBe('swap');
    expect(getPurchaseValueGuard()).toBe('block');
    expect(isCtaFallbackCapi()).toBe(true);
    expect(isTrackingOriginEnforced()).toBe(true);
    expect(isCspReportEnabled()).toBe(true);
    expect(isPixelHealthEnabled()).toBe(true);
  });
});
