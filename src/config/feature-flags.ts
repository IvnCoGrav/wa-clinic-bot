/**
 * feature-flags.ts
 * CFG-20: Dotenv diinisialisasi pada entry point aplikasi (app.ts / worker.ts).
 *
 * Cek apakah Tool-Masking Shadow Mode aktif.
 * Default: false (langsung enforce mode aktif, tanpa shadow mode — sistem
 * belum live ke klien; evaluasi pasif digantikan gate deterministik).
 */
export function isToolMaskingShadowMode(): boolean {
  return process.env.TOOL_MASKING_SHADOW_MODE === 'true';
}

/**
 * Cek apakah Tool-Masking Enforce Mode aktif (Direct Enforce).
 * Default: true (aktif secara default; nonaktif hanya jika TOOL_MASKING_ENFORCE
 * disetel eksplisit 'false', mis. untuk pengujian shadow).
 */
export function isToolMaskingEnforced(): boolean {
  return process.env.TOOL_MASKING_ENFORCE !== 'false';
}

/**
 * Meta Funnel Remediation & Guard Flags (Fase 0-6)
 */

/** Konfirmasi penerimaan event CAPI ketat (200/0 tidak menandai sent). Default: true. */
export function isCapiStrictDelivery(): boolean {
  return process.env.CAPI_STRICT_DELIVERY !== 'false';
}

/** Redaksi PII aktif pada penulisan audit_logs */
export function isAuditPiiRedaction(): boolean {
  return process.env.AUDIT_PII_REDACTION === 'true';
}

/** Mode penanganan dedup klik iklan repeat */
export function getAdClickDedupMode(): 'off' | 'swap' | 'reject' {
  const mode = (process.env.AD_CLICK_DEDUP_MODE || 'off').toLowerCase().trim();
  if (mode === 'swap' || mode === 'reject') return mode;
  return 'off';
}

/** Guard perubahan purchase_value pasca kirim CAPI */
export function getPurchaseValueGuard(): 'off' | 'warn' | 'block' {
  const guard = (process.env.PURCHASE_VALUE_GUARD || 'warn').toLowerCase().trim();
  if (guard === 'off' || guard === 'block') return guard;
  return 'warn';
}

/** Tembakkan PageView CAPI untuk traffic /cta-fallback */
export function isCtaFallbackCapi(): boolean {
  return process.env.CTA_FALLBACK_CAPI === 'true';
}

/** Enforce validasi origin/domain pada endpoint tracking */
export function isTrackingOriginEnforced(): boolean {
  return process.env.TRACKING_ORIGIN_ENFORCE === 'true';
}

/** Terima dan catat laporan pelanggaran CSP browser */
export function isCspReportEnabled(): boolean {
  return process.env.CSP_REPORT_ENABLED === 'true';
}

/** Probe kesehatan meta pixel di background */
export function isPixelHealthEnabled(): boolean {
  return process.env.PIXEL_HEALTH_ENABLED === 'true';
}



