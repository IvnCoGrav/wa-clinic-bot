import axios from 'axios';
import crypto from 'crypto';
import { ParamBuilder, PII_DATA_TYPE } from 'capi-param-builder-nodejs';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { GRAPH_API_VERSION, GRAPH_API_BASE_URL } from '../integrations/whatsapp/graph.constants';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { hasBypassLabel, checkCustomerBypass } from '../utils/customer-bypass';
import { prisma } from '../db/client';
import { maskPhoneWithTenantSuffix } from '../utils/pii-masker';
import { normalizePhoneToE164 } from '../utils/phone-normalizer';
import {
  DEFAULT_CAPI_MATCHING_GEO,
  buildDeterministicPurchaseEventId,
  decryptCapiToken,
  formatMetaFbc,
  formatStructuredCapiEventLog,
  isPublicIp,
  normalizeCapiMatchingGeo,
  parseCapiValue,
  parseStructuredCapiEventLog,
  resolveCanonicalLandingUrl,
} from './capi.helpers';
import type { CapiMatchingGeo, StructuredCapiEventLog } from './capi.helpers';

/**
 * Helper murni CAPI kini hidup di `capi.helpers.ts`; re-export menjaga kontrak
 * impor lama (`services/capi.service`) tanpa menggandakan implementasi.
 */
export {
  buildDeterministicPurchaseEventId,
  buildLegacyPurchaseEventId,
  decryptCapiToken,
  extractValueByFormat,
  formatMetaFbc,
  formatStructuredCapiEventLog,
  isPublicIp,
  maskName,
  normalizeCapiMatchingGeo,
  parseCapiValue,
  parseStructuredCapiEventLog,
  resolveCanonicalLandingUrl,
  sha256Hash,
} from './capi.helpers';
export type { CapiMatchingGeo, StructuredCapiEventLog } from './capi.helpers';

/**
 * Normalisasi HP E.164 didelegasikan ke normalizer kanonis
 * (`src/utils/phone-normalizer.ts`) — satu sumber kebenaran, termasuk strip
 * suffix WhatsApp/device.
 */
export { normalizePhoneToE164 };

// Inisialisasi Circuit Breaker untuk CAPI calls
export const capiBreaker = new CircuitBreaker(
  async (url: string, payload: any) => {
    return axios.post(url, payload, { timeout: 5000 });
  },
  async () => {
    // PENTING: fallback ini TIDAK boleh dianggap sukses oleh caller — ditandai
    // `isFallback: true` supaya sendCapiEvent tidak mencatat [CAPI SUCCESS] palsu.
    return {
      isFallback: true,
      data: { success: false, note: 'Circuit Breaker Active Fallback (CAPI)' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as any,
    };
  },

  {
    name: 'Meta CAPI',
    failureThreshold: 0.5,
    slidingWindowSize: 10,
    cooldownPeriodMs: 30000, // 30 seconds
  }
);

/**
 * Mask nomor telepon privasi log (4+4, suffix tenantId). Didelegasikan ke src/utils/pii-masker.ts.
 * @deprecated Gunakan `maskPhoneWithTenantSuffix` langsung dari `src/utils/pii-masker`.
 */
export { maskPhoneWithTenantSuffix as maskPhone };

/**
 * Resolusi nilai treatment dari katalog tenant kini hidup di
 * `treatment-value.service.ts` (CAPI tidak lagi memiliki pengetahuan katalog).
 */
export { resolveTreatmentValue } from './treatment-value.service';

export interface TenantCapiCredentials {
  pixelId?: string;
  accessToken?: string;
  source: 'db' | 'env' | 'none';
}

/**
 * Resolusi kredensial Meta CAPI/Pixel per-tenant — SATU-SATUNYA sumber kebenaran.
 * Dipakai oleh sendCapiEvent maupun testCapiConnection agar tidak ada drift.
 *
 * Kebijakan isolasi multi-tenant (fail-closed, anti-leakage):
 * - Kredensial DB tenant (meta_pixel_id / meta_capi_access_token) SELALU menang bila valid.
 * - Fallback ke process.env (FB_PIXEL_ID / FB_CAPI_ACCESS_TOKEN) HANYA bila
 *   tenantId === DEFAULT_TENANT_ID secara eksplisit (backward compat klinik sendiri).
 * - Tenant non-default tanpa kredensial DB valid → source 'none' (caller WAJIB skip,
 *   tidak boleh menyentuh env) — mencegah event bocor ke akun iklan pemilik bot.
 * - tenantId kosong/undefined → source 'none' (seluruh caller produksi wajib mengirim tenantId).
 * - DB error / token gagal decrypt pada tenant non-default → 'none' (fail-closed),
 *   bukan fallback env.
 */
export async function resolveTenantCapiCredentials(tenantId?: string): Promise<TenantCapiCredentials> {
  const isDefaultTenant = tenantId === DEFAULT_TENANT_ID;

  if (tenantId && !isDefaultTenant) {
    try {
      const { prisma } = await import('../db/client');
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      let pixelId: string | undefined;
      let accessToken: string | undefined;
      if (tenant?.meta_pixel_id) pixelId = tenant.meta_pixel_id;
      if (tenant?.meta_capi_access_token) {
        const decrypted = decryptCapiToken(tenant.meta_capi_access_token);
        if (decrypted) {
          accessToken = decrypted;
        } else {
          const token = tenant.meta_capi_access_token;
          const mask = token.length > 10 ? `${token.substring(0, 4)}…${token.slice(-4)}` : '(token sangat pendek)';
          console.warn(`[CAPI ISOLATION] Token CAPI tenant ${tenantId} gagal didecrypt (${mask}) — event di-skip, TIDAK fallback ke env.`);
        }
      }
      if (pixelId && accessToken) return { pixelId, accessToken, source: 'db' };
      console.warn(`[CAPI ISOLATION] Kredensial CAPI tenant ${tenantId} tidak lengkap di DB — event di-skip, TIDAK fallback ke env.`);
      return { source: 'none' };
    } catch (err) {
      console.warn(`[CAPI ISOLATION] Gagal baca config CAPI tenant ${tenantId} — event di-skip (fail-closed):`, (err as Error).message);
      return { source: 'none' };
    }
  }

  if (!isDefaultTenant) {
    console.warn('[CAPI ISOLATION] Permintaan CAPI tanpa tenantId — event di-skip (fail-closed). Seluruh caller wajib mengirim tenantId.');
    return { source: 'none' };
  }

  // default-tenant: DB menang, env fallback (backward compat).
  let pixelId = process.env.FB_PIXEL_ID;
  let accessToken = process.env.FB_CAPI_ACCESS_TOKEN;
  let source: 'db' | 'env' | 'none' = 'none';
  try {
    const { prisma } = await import('../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant?.meta_pixel_id) pixelId = tenant.meta_pixel_id;
    if (tenant?.meta_capi_access_token) {
      const decrypted = decryptCapiToken(tenant.meta_capi_access_token);
      if (decrypted) {
        accessToken = decrypted;
      } else {
        const token = tenant.meta_capi_access_token;
        const mask = token.length > 10 ? `${token.substring(0, 4)}…${token.slice(-4)}` : '(token sangat pendek)';
        console.warn(`[CAPI WARNING] Token CAPI tenant ${tenantId} gagal didecrypt (${mask}), pakai env fallback.`);
      }
    }
    if (tenant?.meta_pixel_id || tenant?.meta_capi_access_token) source = 'db';
  } catch (err) {
    console.warn(`[CAPI WARNING] Gagal baca config CAPI tenant ${tenantId}, pakai env fallback:`, (err as Error).message);
  }
  if (source === 'none' && pixelId && accessToken) source = 'env';
  return { pixelId, accessToken, source };
}

/**
 * Format kata kunci funnel CAPI per tenant (format_checkout / format_purchase).
 * Tenant-aware: dibaca dari kolom tenant DB, fallback ke nilai default bila
 * tenant tidak punya config / DB offline (konsisten dengan pola credentials CAPI).
 */
export async function getTenantCapiFormats(tenantId?: string): Promise<{
  formatCheckout: string;
  formatPurchase: string;
  formatVisit: string;
  greetingsText: string;
  formatValue: string;
}> {
  const defaults = {
    formatCheckout: 'list untuk reservasi :',
    formatPurchase: 'Payment',
    formatVisit: 'Promo[%ID%]',
    greetingsText: 'Promo [%ID%]',
    formatValue: 'Treatment = %VALUE%',
  };
  if (!tenantId) return defaults;
  try {
    const { prisma } = await import('../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    return {
      formatCheckout: tenant?.format_checkout?.trim() || defaults.formatCheckout,
      formatPurchase: tenant?.format_purchase?.trim() || defaults.formatPurchase,
      formatVisit: tenant?.format_visit?.trim() || defaults.formatVisit,
      greetingsText: (tenant as any)?.greetings_text?.trim() || tenant?.format_visit?.trim() || defaults.greetingsText,
      formatValue: (tenant as any)?.format_value?.trim() || defaults.formatValue,
    };
  } catch {
    return defaults;
  }
}

/**
 * Pola teknis universal penanda bot/sistem yang tidak boleh dianggap balasan manual admin.
 */
export const UNIVERSAL_BOT_ECHO_PREFIXES = [
  '[AUTOMATED]',
  '[IMAGE:',
  '[LOCATION:',
  '[AUDIO:',
  '[DOCUMENT:',
  '[VIDEO:',
] as const;

/**
 * Pola salam otomatis HP dan kebijakan klinis untuk deteksi echo (tenant-aware).
 * Dipakai webhook untuk memfilter pesan keluar HP yang bukan balasan admin manual.
 * Sumber: Tenant.greetings_text, format_visit, name, dan ClinicPolicy.suggested_reply.
 */
export async function getTenantEchoPatterns(tenantId?: string): Promise<string[]> {
  if (!tenantId) return [];
  try {
    const { prisma } = await import('../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return [];
    const patterns: string[] = [];
    if (tenant.greetings_text?.trim()) patterns.push(tenant.greetings_text.trim());
    if (tenant.format_visit?.trim()) patterns.push(tenant.format_visit.trim());
    if (tenant.name?.trim()) {
      const name = tenant.name.trim();
      patterns.push(name);
      patterns.push(`Pricelist ${name}`);
    }

    // Ambil cuplikan respons standar / darurat dari ClinicPolicy bila ada
    try {
      const policies = await prisma.clinicPolicy.findMany({
        where: { tenant_id: tenantId, is_active: true },
        select: { suggested_reply: true },
      });
      for (const policy of policies) {
        if (policy.suggested_reply?.trim()) {
          const snippet = policy.suggested_reply.trim().slice(0, 40);
          if (snippet) patterns.push(snippet);
        }
      }
    } catch {
      // ClinicPolicy optional / offline fallback
    }

    return Array.from(new Set(patterns.filter(Boolean)));
  } catch {
    return [];
  }
}

/**
 * Resolusi konteks New vs Repeat untuk event `Purchase` (standar Meta: event_name
 * tetap `Purchase`; pembeda disematkan ke `custom_data` agar Value-Based Bidding
 * & ROAS tidak terganggu). Basis: jumlah reservasi confirmed/completed MILIK
 * customer DI LUAR reservasi yang sedang dikirim — bukan berdasarkan follow-up
 * pending (semantik lama yang rapuh). Fail-safe DB offline → new (0).
 *
 * `order_number` = urutan transaksi ke-(priorCount + 1).
 */
async function resolveNewVsRepeatContext(params: {
  customerId?: string | null;
  tenantId?: string | null;
  reservationId?: string | null;
}): Promise<{ priorCount: number; isRepeat: boolean; orderNumber: number }> {
  const { customerId, tenantId, reservationId } = params;
  if (!customerId) return { priorCount: 0, isRepeat: false, orderNumber: 1 };
  try {
    const { prisma } = await import('../db/client');
    const priorCount = await prisma.reservation.count({
      where: {
        customer_id: customerId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        status: { in: ['confirmed', 'en_route', 'completed'] },
        ...(reservationId ? { id: { not: reservationId } } : {}),
      },
    });
    return {
      priorCount,
      isRepeat: priorCount > 0,
      orderNumber: priorCount + 1,
    };
  } catch {
    return { priorCount: 0, isRepeat: false, orderNumber: 1 };
  }
}

/**
 * @deprecated Queue-First: seluruh event Purchase WAJIB lewat antrean moderasi CAPI (/capi-queue).
 * Flag tenant auto_send_purchase_capi dinonaktifkan untuk mencegah pengiriman CAPI ganda/bypass kasir.
 * Kebijakan moderasi Purchase CAPI per tenant (auto_send_purchase_capi).
 * Default false = moderasi manual aktif (event ditahan ke queue admin review).
 * Tenant-aware: dibaca dari kolom tenant DB; fallback false bila DB offline.
 */
export type MetaPurchasePolicy = 'SUPPRESS_REPEAT' | 'DUAL_EVENT' | 'ALL_WITH_TAG';

export type MetaRepeatDecision =
  | { action: 'SEND'; eventName: string; optOut: boolean; segmentation: 'new_customer_to_business' }
  | { action: 'SUPPRESS' }
  | { action: 'SEND_REPEAT'; eventName: string; optOut: boolean; segmentation: 'existing_customer_to_business' };

/**
 * Membaca kebijakan perutean event Purchase CAPI Meta untuk pelanggan repeat.
 * Disimpan di `Tenant.settings.metaPurchasePolicy` (tanpa alter table/migrasi).
 * Default: 'DUAL_EVENT' — repeat order tetap dikirim sebagai
 * `ReturningCustomerPurchase` sehingga sinyal LTV tidak hilang, namun event
 * `Purchase` yang dioptimasi kampanye akuisisi tetap murni pasien baru.
 * Fail-safe: jika tenant undefined atau DB offline, fallback ke 'DUAL_EVENT'.
 */
export async function getTenantMetaPurchasePolicy(tenantId?: string): Promise<MetaPurchasePolicy> {
  const envPolicy = process.env.DEFAULT_META_PURCHASE_POLICY as MetaPurchasePolicy | undefined;
  const defaultPolicy: MetaPurchasePolicy =
    envPolicy === 'DUAL_EVENT' || envPolicy === 'ALL_WITH_TAG' || envPolicy === 'SUPPRESS_REPEAT'
      ? envPolicy
      : 'DUAL_EVENT';

  if (!tenantId) return defaultPolicy;
  try {
    const { prisma } = await import('../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const settings = (tenant?.settings as any) || {};
    const policy = settings.metaPurchasePolicy;
    if (policy === 'DUAL_EVENT' || policy === 'ALL_WITH_TAG' || policy === 'SUPPRESS_REPEAT') {
      return policy;
    }
    return defaultPolicy;
  } catch {
    return defaultPolicy;
  }
}

/**
 * Params ADVANCED MATCHING geografis per tenant (state/provinsi & negara).
 * Sumber kebenaran: `Tenant.settings.capiMatchingGeo` (data-driven, admin-editable,
 * tanpa migrasi). Default fail-safe hanya untuk tenant yang belum mengonfigurasi.
 */
export async function getTenantCapiMatchingGeo(tenantId?: string): Promise<CapiMatchingGeo> {
  if (!tenantId) return DEFAULT_CAPI_MATCHING_GEO;
  try {
    const { prisma } = await import('../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    return normalizeCapiMatchingGeo((tenant?.settings as any)?.capiMatchingGeo);
  } catch {
    return DEFAULT_CAPI_MATCHING_GEO;
  }
}

export async function getTenantAutoSendPurchaseCapi(tenantId?: string): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const { prisma } = await import('../db/client');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    return tenant?.auto_send_purchase_capi ?? false;
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget helper: kirim event CAPI jika customer punya atribusi adClick,
 * log error via console tanpa melempar exception (tidak merusak critical path).
 */
export function fireCapiEvent(params: {
  eventName: string;
  customer: any;
  adClick?: any;
  value?: number;
  currency?: string;
  tenantId?: string;
  customData?: Record<string, any>;
  eventTime?: number;
}): void {
  capiService.sendCapiEvent(params).catch((err) => {
    console.error(`[CAPI ERROR] Failed to send ${params.eventName} event:`, err.message);
  });
}


export class CapiService {
  private organicContactCooldown = new Map<string, number>();
  private paidContactCooldown = new Map<string, { timestamp: number; campaignKey?: string }>();
  private checkoutCooldown = new Map<string, number>();

  public __clearCooldowns(): void {
    this.organicContactCooldown.clear();
    this.paidContactCooldown.clear();
    this.checkoutCooldown.clear();
  }

  /**
   * Mengirimkan server-side event ke Meta Conversions API (CAPI).
   */
  public async sendCapiEvent(params: {
    eventName: string;
    customer: any;
    adClick?: any;
    value?: number;
    currency?: string;
    tenantId?: string;
    customData?: Record<string, any>;
    eventTime?: number;
    eventId?: string;
    customUserData?: Record<string, any>;
    customEventId?: string;
    reservationId?: string;
    testEventCode?: string;
  }): Promise<{
    success: boolean;
    message?: string;
    status?: number;
    fbtrace_id?: string;
    events_received?: number;
    eventsReceived?: number;
    deliveryConfirmed?: boolean;
    sentEventId?: string;
    metaResponse?: any;
    sentPayload?: any;
    pixelId?: string;
    skipped?: boolean;
    policy?: MetaPurchasePolicy;
  }> {
    const { eventName, customer, adClick, value, currency, tenantId, customData, eventTime, eventId, customUserData, customEventId, reservationId, testEventCode } = params;

    // 1. Meta CAPI Sandbox / Dummy Test Guard & Non-Customer Bypass Guard (Skip / Admin CS)
    //    Staf internal (CS/Bidan via nomor resmi klinik) juga dikecualikan: bukan pelanggan.
    //    Pengecualian: PageView adalah sinyal WEB anonim (BEACON, tanpa nomor WA),
    //    tidak boleh dipalatkan filter dummy-contact nomor HP.
    const isPageViewEvent = eventName === 'PageView';
    if (
      !isPageViewEvent && (
      customer?.is_sandbox_test ||
      customer?.is_internal_staff ||
      isDummyOrTestContact(customer?.phone, customer?.name, customer?.is_sandbox_test) ||
      customer?.is_admin_labeled === true ||
      hasBypassLabel(customer) ||
      (await checkCustomerBypass({ customerId: customer?.id, phone: customer?.phone, tenantId }))
      )
    ) {
      console.log(`[CAPI GUARD] Skipped sending ${eventName} to Meta CAPI for sandbox/dummy/bypass/internal-staff contact (skip/admin cs): ${maskPhoneWithTenantSuffix(customer?.phone)}`);
      return { success: false, message: 'Skipped: Sandbox, dummy test, or non-customer bypass contact (skip/admin cs)' };
    }

    // 1b. Centralized Event Cooldown Guard (Anti-Burst & Idempotency)
    //     Fase 1.1: Memisahkan cooldown organik vs berbayar agar chat organik tidak memblokir iklan berbayar
    const phoneKey = (customer?.phone || '').replace(/\D/g, '');
    const isPaidTouch = Boolean(
      customData?.isPaidTouch ||
      adClick?.ctwa_clid ||
      adClick?.trackingCode ||
      (customer as any)?.adClick?.trackingCode ||
      (customer as any)?.adClick?.ctwa_clid
    );
    const campaignKey = adClick?.utmCampaign || adClick?.adId || (customer as any)?.adClick?.utmCampaign || '';
    if (phoneKey) {
      const now = Date.now();
      if (eventName === 'Contact') {
        if (isPaidTouch) {
          const lastPaid = this.paidContactCooldown.get(phoneKey);
          if (lastPaid && now - lastPaid.timestamp < 24 * 60 * 60 * 1000 && (!campaignKey || lastPaid.campaignKey === campaignKey)) {
            console.log(`[CAPI GUARD] Skipped Contact event for ${maskPhoneWithTenantSuffix(phoneKey)}: Centralized 24h paid cooldown active.`);
            return { success: false, message: 'Skipped: Paid Contact event 24h cooldown active' };
          }
          this.paidContactCooldown.set(phoneKey, { timestamp: now, campaignKey });
        } else {
          const lastOrganic = this.organicContactCooldown.get(phoneKey);
          if (lastOrganic && now - lastOrganic < 24 * 60 * 60 * 1000) {
            console.log(`[CAPI GUARD] Skipped Contact event for ${maskPhoneWithTenantSuffix(phoneKey)}: Centralized 24h organic cooldown active.`);
            return { success: false, message: 'Skipped: Organic Contact event 24h cooldown active' };
          }
          this.organicContactCooldown.set(phoneKey, now);
        }
      } else if (eventName === 'InitiateCheckout') {
        const lastSent = this.checkoutCooldown.get(phoneKey);
        if (lastSent && now - lastSent < 60 * 60 * 1000) {
          console.log(`[CAPI GUARD] Skipped InitiateCheckout event for ${maskPhoneWithTenantSuffix(phoneKey)}: Centralized 1h cooldown active.`);
          return { success: false, message: 'Skipped: InitiateCheckout event 1h cooldown active' };
        }
        this.checkoutCooldown.set(phoneKey, now);
      }
    }


    let effectiveAdClick = adClick || (customer as any)?.adClick;
    let fullCustomer = customer;
    if (customer?.id || customer?.phone) {
      try {
        const { prisma } = await import('../db/client');
        const dbCust = await prisma.customer.findFirst({
          where: {
            ...(customer.id ? { id: customer.id } : { phone: customer.phone }),
            ...(tenantId ? { tenant_id: tenantId } : {}),
          },
        });
        if (dbCust) {
          fullCustomer = { ...dbCust, ...customer };
        }
        if (!effectiveAdClick && (fullCustomer?.id || fullCustomer?.phone)) {
          effectiveAdClick = await prisma.adClick.findFirst({
            where: {
              ...(tenantId ? { tenant_id: tenantId } : {}),
              OR: [
                ...(fullCustomer?.id ? [{ customerId: fullCustomer.id }] : []),
                ...(fullCustomer?.phone ? [{ phone: fullCustomer.phone }] : []),
              ],
            },
            orderBy: [{ matchedAt: 'desc' }, { createdAt: 'desc' }],
          });
        }
      } catch {}
    }

    const isPaid = !!effectiveAdClick;

    // 2. Tenant-aware credentials — SATU pintu via resolveTenantCapiCredentials (fail-closed, anti-leakage).
    const { pixelId, accessToken } = await resolveTenantCapiCredentials(tenantId);

    if (!pixelId || !accessToken) {
      console.warn(`[CAPI WARNING] CAPI credentials missing for tenant ${tenantId || '(tanpa tenantId)'}: FB_PIXEL_ID=${pixelId ? 'configured' : 'missing'}, FB_CAPI_ACCESS_TOKEN=${accessToken ? 'configured' : 'missing'}`);
      return { success: false, message: `Skipped: Credentials missing for tenant ${tenantId || 'unknown'}` };
    }

    // Satu kali baca tenant untuk: domain landing, fallback domain, WABA id, dan
    // geo matching (state/country). Semua data-driven dari Tenant.settings/kolom DB.
    let tenantRecord: any = null;
    if (tenantId) {
      try {
        tenantRecord = await prisma.tenant.findUnique({ where: { id: tenantId } });
      } catch {}
    }
    const tenantSettings = (tenantRecord?.settings as any) || {};
    const matchingGeo = normalizeCapiMatchingGeo(tenantSettings.capiMatchingGeo);

    try {
      // 2. NORMALIZE & HASH PII (Nomor HP, Nama, External ID, Kota, Zipcode, Country) menggunakan Meta ParamBuilder
      const builder = new ParamBuilder();
      const rawPhone = fullCustomer?.phone || effectiveAdClick?.phone || '';
      const normalizedPhone = normalizePhoneToE164(rawPhone);
      const hashedPhone = builder.getNormalizedAndHashedPII(normalizedPhone, PII_DATA_TYPE.PHONE);

      // Advanced Matching: Nama Depan & Nama Belakang dari Customer / AdClick
      let hashedFn: string | undefined;
      let hashedLn: string | undefined;
      let rawName = (fullCustomer?.name || fullCustomer?.pushName || effectiveAdClick?.name || '').trim();

      // Self-heal: jika rawName kosong atau hanya honorific/generic (misal "Mbak", "Bunda", "Pasien")
      const lowerRaw = rawName.toLowerCase();
      const isRawGeneric = !rawName || ['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'ny', 'pasien', 'customer', '-'].includes(lowerRaw);
      if (isRawGeneric && fullCustomer?.id) {
        try {
          const { prisma } = await import('../db/client');
          const latestRes = await prisma.reservation.findFirst({
            where: {
              customer_id: fullCustomer.id,
              status: { not: 'cancelled' },
              ...(tenantId ? { tenant_id: tenantId } : {}),
            },
            orderBy: { created_at: 'desc' },
          });
          if (latestRes?.raw_text) {
            const { parseReservationText } = await import('../utils/reservation-text-parser');
            const pr = parseReservationText(latestRes.raw_text);
            if (pr.success && pr.reservation?.name) {
              rawName = pr.reservation.name;
            }
          }
        } catch {}
      }

      if (rawName) {
        // Strip honorifics di awal nama, catatan kurung (mis. "(Homecare)"), dan simbol/emoji non-huruf
        const cleanedName = rawName
          .replace(/^(?:bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.|mrs|mrs\.)\s+/i, '')
          .replace(/\([^)]*\)/g, '')
          .replace(/[^\p{L}\s'-]/gu, '')
          .replace(/\s+/g, ' ')
          .trim();
        const lowerClean = cleanedName.toLowerCase();
        const isGenericAlone = ['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'pasien', 'customer', '-'].includes(lowerClean);
        if (cleanedName && !isGenericAlone && cleanedName.length > 1) {
          const parts = cleanedName.split(/\s+/);
          const firstName = parts[0];
          if (firstName && firstName.length > 1) {
            hashedFn = builder.getNormalizedAndHashedPII(firstName, PII_DATA_TYPE.FIRST_NAME) || undefined;
            const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
            if (lastName && lastName.length > 1) {
              hashedLn = builder.getNormalizedAndHashedPII(lastName, PII_DATA_TYPE.LAST_NAME) || undefined;
            }
          }
        }
      }

      // Advanced Matching: External ID (hashed customer.id / phone ID)
      // Guard A-017: Jangan kirim external_id jika menggunakan ID sintetis (pv_, temp_, synthetic_)
      let hashedExternalId: string | undefined;
      const rawExternalId = fullCustomer?.id ? String(fullCustomer.id) : undefined;
      const isSyntheticExternalId = rawExternalId
        ? rawExternalId.startsWith('pv_') || rawExternalId.startsWith('temp_') || rawExternalId.startsWith('synthetic_')
        : false;
      if (rawExternalId && !isSyntheticExternalId) {
        hashedExternalId = builder.getNormalizedAndHashedPII(rawExternalId, PII_DATA_TYPE.EXTERNAL_ID) || undefined;
      }

      // Advanced Matching: City (Kota), State (Provinsi), Zipcode (Kode Pos), Country (Negara), & Gender
      let hashedCity: string | undefined;
      let hashedState: string | undefined;
      let hashedZip: string | undefined;
      let hashedCountry: string | undefined;
      let hashedGender: string | undefined;

      const rawCity = (fullCustomer?.kota || fullCustomer?.pending_kota || '').trim();
      if (rawCity) {
        hashedCity = builder.getNormalizedAndHashedPII(rawCity, PII_DATA_TYPE.CITY) || undefined;
      }
      hashedState = builder.getNormalizedAndHashedPII(matchingGeo.state, PII_DATA_TYPE.STATE) || undefined;
      let rawZip = (fullCustomer?.zipcode || fullCustomer?.pending_zipcode || '').trim();
      let gazetteerZip: string | null = null;
      if (!rawZip) {
        try {
          const { resolveZipcode } = await import('../utils/gazetteer-zipcode-resolver');
          const prefs = (fullCustomer as any)?.preferences || {};
          const addrText = (prefs.address || prefs.full_address || (fullCustomer as any)?.address || '').trim();
          const nameText = (fullCustomer?.name || '').trim();

          // Fallback historis: `raw_text` reservasi sering memuat "Kec: Waru"
          // saat kolom kecamatan/address belum terisi. Ambil reservasi yang
          // dikirim (reservationId) atau reservasi terakhir customer.
          let reservationText = '';
          let reservationKec = '';
          let reservationKota = '';
          try {
            const res = reservationId
              ? await prisma.reservation.findFirst({
                  where: {
                    id: reservationId,
                    ...(tenantId ? { tenant_id: tenantId } : {}),
                  },
                  select: { raw_text: true },
                })
              : fullCustomer?.id
                ? await prisma.reservation.findFirst({
                    where: {
                      customer_id: fullCustomer.id,
                      ...(tenantId ? { tenant_id: tenantId } : {}),
                      status: { not: 'cancelled' },
                    },
                    orderBy: { created_at: 'desc' },
                    select: { raw_text: true },
                  })
                : null;
            if (res?.raw_text) {
              reservationText = String(res.raw_text);
              const { parseReservationText } = await import('../utils/reservation-text-parser');
              const pr = parseReservationText(reservationText);
              if (pr.success && pr.reservation) {
                reservationKec = pr.reservation.kec || '';
                reservationKota = pr.reservation.kota || '';
              }
            }
          } catch {
            // DB offline / reservasi tidak ada — tetap coba data customer.
          }

          const gazInput = {
            kelurahan: (fullCustomer?.kelurahan || fullCustomer?.pending_kelurahan || '') as string,
            kecamatan: (fullCustomer?.kecamatan || fullCustomer?.pending_kecamatan || reservationKec || '') as string,
            kota: (fullCustomer?.kota || fullCustomer?.pending_kota || reservationKota || '') as string,
            text: `${nameText} ${addrText} ${reservationText}`.trim(),
          };
          gazetteerZip = resolveZipcode(gazInput);
          if (gazetteerZip) {
            rawZip = gazetteerZip;
            const custId = fullCustomer?.id;
            if (custId) {
              // Seam kanonis: non-destruktif + fallback memori + tenant guard.
              void (async () => {
                try {
                  const { customerService } = await import('./customer.service');
                  await customerService.updateCustomerZipcodeIfEmpty(
                    custId,
                    gazetteerZip,
                    tenantId || fullCustomer?.tenant_id || DEFAULT_TENANT_ID
                  );
                } catch {}
              })();
            }
            console.log(`[CAPI] zp enriched via Gazetteer: ${gazetteerZip} (kec=${gazInput.kecamatan || '-'}, text="${gazInput.text.slice(0, 40)}")`);
          }
        } catch (e) {
          // gazetteer resolver unavailable — silent
        }
      }
      if (rawZip) {
        hashedZip = builder.getNormalizedAndHashedPII(rawZip, PII_DATA_TYPE.ZIP_CODE) || undefined;
      }
      hashedCountry = builder.getNormalizedAndHashedPII(matchingGeo.country, PII_DATA_TYPE.COUNTRY) || undefined;

      // Gender: kirim 'f' (female) jika treatment berkaitan dengan Moms / Ibu Hamil / Postpartum
      const treatmentText = (
        (customData?.treatment || '') + ' ' +
        (customData?.content_name || '') + ' ' +
        (fullCustomer?.last_discussed_treatment || '')
      ).toLowerCase();
      const isMomsTreatment =
        customData?.treatmentCategory === 'MOMS' ||
        customData?.treatmentCategory === 'BOTH' ||
        treatmentText.includes('moms') ||
        treatmentText.includes('ibu') ||
        treatmentText.includes('hamil') ||
        treatmentText.includes('laktasi') ||
        treatmentText.includes('nifas') ||
        treatmentText.includes('postpartum');

      if (isMomsTreatment) {
        hashedGender = builder.getNormalizedAndHashedPII('f', PII_DATA_TYPE.GENDER) || undefined;
      }

      // Gunakan server-side ParamBuilder untuk memproses parameter browser/IP & menambahkan appendix
      const mockCookies: Record<string, string> = {};
      if (effectiveAdClick?.fbp) mockCookies._fbp = effectiveAdClick.fbp;
      if (effectiveAdClick?.fbc) mockCookies._fbc = effectiveAdClick.fbc;
      if (effectiveAdClick?.ipAddress) mockCookies._fbi = effectiveAdClick.ipAddress;

      const mockQueries: Record<string, string> = {};
      if (effectiveAdClick?.fbclid) mockQueries.fbclid = effectiveAdClick.fbclid;

      let host = 'localhost';
      try {
        if (effectiveAdClick?.landingUrl) {
          host = new URL(effectiveAdClick.landingUrl).hostname;
        }
      } catch {}

      builder.processRequest(
        host,
        mockQueries,
        mockCookies,
        null, // referer
        effectiveAdClick?.ipAddress || null, // xForwardedFor
        effectiveAdClick?.ipAddress || null // remoteAddress
      );

      const rawFbc = builder.getFbc() || effectiveAdClick?.fbc || effectiveAdClick?.fbclid;
      const fbcTs = effectiveAdClick?.createdAt ? new Date(effectiveAdClick.createdAt).getTime() : Date.now();
      const fbc = formatMetaFbc(rawFbc, fbcTs);
      const fbp = builder.getFbp() || effectiveAdClick?.fbp;
      const clientIp = builder.getClientIpAddress() || effectiveAdClick?.ipAddress;

      // 3. CONSTRUCT USER DATA (Meta specs: hash phone/name/external_id/city/state/zip/country/gender, keep IP/UA/Cookies clean)
      const userData: any = {};
      if (hashedPhone) {
        userData.ph = [hashedPhone];
      }
      if (hashedFn) {
        userData.fn = [hashedFn];
      }
      if (hashedLn) {
        userData.ln = [hashedLn];
      }
      if (hashedExternalId) {
        userData.external_id = [hashedExternalId];
      }
      if (hashedCity) {
        userData.ct = [hashedCity];
      }
      if (hashedState) {
        userData.st = [hashedState];
      }
      if (hashedZip) {
        userData.zp = [hashedZip];
      }
      if (hashedCountry) {
        userData.country = [hashedCountry];
      }
      if (hashedGender) {
        userData.ge = [hashedGender];
      }
      if (clientIp && isPublicIp(clientIp)) {
        userData.client_ip_address = clientIp;
      }
      if (effectiveAdClick?.userAgent) {
        userData.client_user_agent = effectiveAdClick.userAgent;
      }
      if (fbc) {
        userData.fbc = fbc;
      }
      if (fbp) {
        userData.fbp = fbp;
      }
      // CTWA (Click-to-WhatsApp): Meta menghendaki ctwa_clid MENTAH (bukan hashed,
      // bukan PII) di user_data untuk mengatribusikan konversi ke iklan klik-WA.
      const isCtwaBusinessMessaging = Boolean(effectiveAdClick?.ctwa_clid);
      if (isCtwaBusinessMessaging) {
        userData.ctwa_clid = effectiveAdClick.ctwa_clid;
      }

      // 4. CONSTRUCT EVENT DATA payload
      //    event_id = trackingCode ad click (auto-derive) atau synthetic ID untuk organic
      let wabaBusinessAccountId = '';
      let tenantDomain = ((tenantRecord as any)?.landing_domain as string | undefined || '').trim();
      // Fallback domain juga konfigurasi tenant (`settings.capiFallbackLandingDomain`),
      // BUKAN hardcode domain bisnis tertentu di dalam kode.
      if (!tenantDomain) {
        const fallbackDomain = typeof tenantSettings.capiFallbackLandingDomain === 'string'
          ? tenantSettings.capiFallbackLandingDomain.trim()
          : '';
        if (fallbackDomain) tenantDomain = fallbackDomain;
      }
      wabaBusinessAccountId = String(((tenantRecord as any)?.waba_business_account_id || '')).trim();

      const eventSourceUrlFromAdClick = resolveCanonicalLandingUrl(effectiveAdClick?.landingUrl, tenantDomain);
      // PageView adalah event WEB (Meta docs: website events WAJIB event_source_url +
      // client_user_agent) — action_source 'website'. Konversi via percakapan
      // WhatsApp tetap 'chat', CTWA ber-WABA memakai 'business_messaging'.
      const isWebsiteEvent = eventName === 'PageView';
      let eventSourceUrl = eventSourceUrlFromAdClick;
      if (!eventSourceUrl && isWebsiteEvent && tenantDomain) {
        try {
          const parsedDomain = new URL(tenantDomain.startsWith('http') ? tenantDomain : `https://${tenantDomain}`);
          eventSourceUrl = `${parsedDomain.origin}${parsedDomain.pathname && parsedDomain.pathname !== '/' ? parsedDomain.pathname : '/'}`;
        } catch {}
      }

      // 3b. Business Messaging envelope (Meta CTWA spec):
      //     Konversi dari iklan Click-to-WhatsApp WAJIB memakai
      //       action_source: 'business_messaging', messaging_channel: 'whatsapp',
      //       user_data.whatsapp_business_account_id + user_data.ctwa_clid (mentah).
      //     State-gated: modalitas ini HANYA diaktifkan bila tenant punya WABA
      //     business account id; tanpa itu envelope tidak lengkap dan berisiko
      //     ditolak Meta (400), jadi kita fail-open ke action_source 'chat' lama.
      const useBusinessMessaging = isCtwaBusinessMessaging && Boolean(wabaBusinessAccountId);
      if (isCtwaBusinessMessaging && !wabaBusinessAccountId) {
        console.warn(
          `[CAPI CTWA] ctwa_clid ada untuk tenant ${tenantId || '(tanpa tenantId)'} tetapi ` +
          `waba_business_account_id belum dikonfigurasi — memakai action_source 'chat' (envelope business_messaging tidak lengkap).`
        );
      }
      if (useBusinessMessaging) {
        userData.whatsapp_business_account_id = wabaBusinessAccountId;
      }

      // 4a. TEMPORAL GUARD — Meta CAPI menolak event_time >7 hari (HTTP 400 subcode 2804003).
      //     Jika eventTime lebih tua dari 7 hari (604.800 detik), jepit ke waktu sekarang
      //     agar konversi tetap diterima Meta. Simpan waktu asli di custom_data.
      const META_7DAY_LIMIT_SEC = 604800; // 7 hari pas dalam detik
      const nowSec = Math.floor(Date.now() / 1000);
      let effectiveEventTime = eventTime ?? nowSec;
      const originalEventTime = effectiveEventTime;
      const eventAgeSec = nowSec - effectiveEventTime;

      if (eventAgeSec > META_7DAY_LIMIT_SEC) {
        console.warn(
          `[CAPI TEMPORAL GUARD] event_time ${effectiveEventTime} melampaui batas 7 hari Meta ` +
          `(usia ${Math.floor(eventAgeSec / 86400)} hari). Dijepit ke waktu sekarang agar konversi tetap diterima Meta.`
        );
        effectiveEventTime = nowSec;
      } else if (effectiveEventTime > nowSec + 120) {
        console.warn(
          `[CAPI TEMPORAL GUARD] event_time ${effectiveEventTime} berada di masa depan ` +
          `(selisih ${effectiveEventTime - nowSec} detik). Dijepit ke waktu sekarang agar tidak ditolak Meta.`
        );
        effectiveEventTime = nowSec;
      }

      const eventData: any = {
        event_name: eventName,
        event_time: effectiveEventTime,
        event_source_url: eventSourceUrl,
        action_source: useBusinessMessaging ? 'business_messaging' : (isWebsiteEvent ? 'website' : 'chat'),
        user_data: userData,
        custom_data: {
          ...(customData || {}),
          delivery_category: 'home_delivery',
          traffic_source: isPaid ? 'paid' : 'organic',
          // Simpan waktu asli jika dijepit agar jejak audit tetap ada
          ...(effectiveEventTime !== originalEventTime
            ? { original_event_time: originalEventTime }
            : {}),
          ...(effectiveAdClick?.utmSource ? { utm_source: effectiveAdClick.utmSource } : {}),
          ...(effectiveAdClick?.utmMedium ? { utm_medium: effectiveAdClick.utmMedium } : {}),
          ...(effectiveAdClick?.utmCampaign ? { utm_campaign: effectiveAdClick.utmCampaign } : {}),
        },
      };
      // messaging_channel adalah field TOP-LEVEL event (bukan custom_data) — spesifikasi
      // Meta Business Messaging CAPI untuk ads that click to WhatsApp.
      if (useBusinessMessaging) {
        eventData.messaging_channel = 'whatsapp';
      }
      if (customEventId) {
        eventData.event_id = customEventId;
      } else if (eventId) {
        eventData.event_id = eventId;
      } else if (eventName === 'Purchase') {
        // Kontrak baru: satu kunci bisnis imutabel satu event_id.
        if (reservationId) {
          eventData.event_id = buildDeterministicPurchaseEventId(tenantId, reservationId);
        } else {
          // Tanpa reservasi (trigger manual dsb.): id mengikat pada anchor WAKTU
          // KONVERSI (eventTime / adClick.createdAt / customer.created_at), BUKAN
          // tanggal pengiriman (Date.now) agar retry & resend tidak membuat id baru.
          let anchorSec: number | undefined;
          if (typeof eventTime === 'number') {
            anchorSec = eventTime;
          } else {
            const anchorRaw = effectiveAdClick?.createdAt || fullCustomer?.created_at || customer?.created_at;
            if (anchorRaw) {
              try {
                const ts = new Date(anchorRaw as any).getTime();
                if (!Number.isNaN(ts)) anchorSec = Math.floor(ts / 1000);
              } catch {}
            }
          }
          eventData.event_id = `${effectiveAdClick?.trackingCode || 'org'}_pur_${customer.id}_${anchorSec ?? originalEventTime}`;
        }
      } else if (eventName === 'PageView') {
        // PageView: pertahankan eventID browser murni untuk deduplikasi Pixel ↔ CAPI
        eventData.event_id = effectiveAdClick?.trackingCode || `pv_${customer.id}_${Math.floor(Date.now() / 1000)}`;
      } else if (effectiveAdClick?.trackingCode) {
        // P0-3 (A-004): Meta deduplikasi memakai pasangan (event_name, event_id).
        // Event yang memiliki browser Pixel counterpart di landing (/cta, go.html) WAJIB memakai
        // trackingCode murni agar browser↔server terdedup (tidak terhitung ganda).
        // Suffix hanya untuk event server-only tanpa counterpart browser.
        const BROWSER_DEDUP_EVENTS = new Set([
          'AddToCart',
          'Lead',
          'InitiateCheckout',
          'Contact',
          'ViewContent',
          'CompleteRegistration',
          'Search',
          'StartTrial',
          'Subscribe',
          'CustomizeProduct',
        ]);
        if (BROWSER_DEDUP_EVENTS.has(eventName)) {
          eventData.event_id = effectiveAdClick.trackingCode;
        } else {
          const suffix = `_${eventName.toLowerCase()}`;
          eventData.event_id = effectiveAdClick.trackingCode.endsWith(suffix)
            ? effectiveAdClick.trackingCode
            : `${effectiveAdClick.trackingCode}${suffix}`;
        }
      } else if (effectiveAdClick?.ctwa_clid) {
        // ID stabil satu perjalanan untuk CTWA native tanpa promo code (server-only, tanpa browser pixel)
        const suffix = `_${eventName.toLowerCase()}`;
        eventData.event_id = `ctwa_${effectiveAdClick.ctwa_clid.slice(0, 20)}_${customer.id}${suffix}`;
      } else {
        eventData.event_id = `org_${customer.id}_${eventName.toLowerCase()}_${Math.floor(Date.now() / 1000)}`;
      }
      // Merge customUserData dari editan admin modal JSON (prioritas admin)
      // Guard A-005: Normalisasi & hash nilai jika admin mengirim format pseudo-string "sha256(value)"
      if (customUserData && typeof customUserData === 'object') {
        const sanitizedUserData: Record<string, any> = {};
        for (const [k, v] of Object.entries(customUserData)) {
          if (typeof v === 'string') {
            const m = v.match(/^sha256\((.*)\)$/i);
            if (m) {
              const inner = m[1].trim();
              if (/^[a-f0-9]{64}$/i.test(inner)) {
                sanitizedUserData[k] = [inner.toLowerCase()];
              } else {
                const mappedType = k === 'ph' ? PII_DATA_TYPE.PHONE
                  : k === 'fn' ? PII_DATA_TYPE.FIRST_NAME
                  : k === 'ln' ? PII_DATA_TYPE.LAST_NAME
                  : k === 'ct' ? PII_DATA_TYPE.CITY
                  : k === 'st' ? PII_DATA_TYPE.STATE
                  : k === 'zp' ? PII_DATA_TYPE.ZIP_CODE
                  : k === 'country' ? PII_DATA_TYPE.COUNTRY
                  : k === 'ge' ? PII_DATA_TYPE.GENDER
                  : k === 'external_id' ? PII_DATA_TYPE.EXTERNAL_ID
                  : null;
                if (mappedType) {
                  const hashed = builder.getNormalizedAndHashedPII(inner, mappedType);
                  sanitizedUserData[k] = hashed ? [hashed] : undefined;
                } else {
                  sanitizedUserData[k] = [crypto.createHash('sha256').update(inner).digest('hex')];
                }
              }
            } else if (/^[a-f0-9]{64}$/i.test(v)) {
              sanitizedUserData[k] = [v.toLowerCase()];
            } else {
              sanitizedUserData[k] = v;
            }
          } else {
            sanitizedUserData[k] = v;
          }
        }
        Object.assign(userData, sanitizedUserData);
      }

      const parsedVal = parseCapiValue(value, customData?.allowZero === true);
      if (parsedVal !== undefined) {
        eventData.custom_data.value = parsedVal;
        eventData.custom_data.currency = currency || 'IDR';
      }


      // Resolusi New vs Repeat HANYA untuk Purchase: standard event name dipertahankan,
      // pembeda disematkan ke custom_data (advertiser dapat membuat Custom Conversion).
      if (eventName === 'Purchase') {
        const explicitRepeat = customData?.is_repeat_order;
        const explicitOrderNumber = customData?.order_number;
        const newVsRepeat = await resolveNewVsRepeatContext({
          customerId: fullCustomer?.id || customer?.id,
          tenantId,
          reservationId,
        });
        const isRepeat = typeof explicitRepeat === 'boolean' ? explicitRepeat : newVsRepeat.isRepeat;
        eventData.custom_data.is_repeat_order = isRepeat;
        eventData.custom_data.customer_type = isRepeat ? 'repeat' : 'new';
        eventData.custom_data.order_number =
          typeof explicitOrderNumber === 'number' ? explicitOrderNumber : newVsRepeat.orderNumber;
        eventData.custom_data.prior_orders_count = newVsRepeat.priorCount;

        // Meta Blueprint Standards: order_id & customer_segmentation
        if (reservationId) {
          eventData.custom_data.order_id = String(reservationId);
        }

        // Kebijakan repeat customer di level tenant (SUPPRESS_REPEAT / DUAL_EVENT / ALL_WITH_TAG)
        const dbIsRepeat = newVsRepeat.isRepeat; // Otoritas kebenaran DB
        if (typeof explicitRepeat === 'boolean' && explicitRepeat !== dbIsRepeat) {
          console.warn(`[CAPI] Admin override is_repeat_order=${explicitRepeat} (DB=${dbIsRepeat}) — customer_segmentation mengikuti DB.`);
        }
        eventData.custom_data.customer_segmentation = dbIsRepeat
          ? 'existing_customer_to_business'
          : 'new_customer_to_business';

        const forceSend = customData?.force_send_repeat_purchase === true; // Escape hatch admin
        const policy = dbIsRepeat ? await getTenantMetaPurchasePolicy(tenantId) : 'SUPPRESS_REPEAT';

        if (dbIsRepeat && !forceSend) {
          if (policy === 'SUPPRESS_REPEAT') {
            console.log(`[CAPI POLICY GUARD] Purchase event for repeat customer ${maskPhoneWithTenantSuffix(customer?.phone)} SUPPRESSED per tenant acquisition policy (${policy}).`);
            console.log(formatStructuredCapiEventLog({
              event: eventData.event_name || eventName,
              event_id: eventData.event_id || 'unknown',
              tenant: tenantId || 'unknown',
              status: null,
              events_received: 0,
              fbtrace_id: null,
              source: eventData.custom_data?.source || 'unknown',
              skipped: true,
              degraded: false,
              reason: 'Repeat purchase suppressed (CAC protection)',
            }));
            return {
              success: true,
              skipped: true,
              policy,
              sentEventId: eventData.event_id,
              events_received: 0,
              eventsReceived: 0,
              deliveryConfirmed: false,
              message: 'Repeat purchase suppressed (CAC protection).',
            };
          }
          if (policy === 'DUAL_EVENT') {
            console.log(`[CAPI POLICY] Transforming Purchase to ReturningCustomerPurchase for repeat customer ${maskPhoneWithTenantSuffix(customer?.phone)}.`);
            eventData.event_name = 'ReturningCustomerPurchase';
            if (eventData.event_id && !customEventId) {
              eventData.event_id = `returning_${eventData.event_id}`;
            }
          } else {
            // ALL_WITH_TAG: Resmi Meta opt_out=true (atribusi saja, tidak melatih optimizer)
            console.log(`[CAPI POLICY] Tagging Purchase with opt_out=true for repeat customer ${maskPhoneWithTenantSuffix(customer?.phone)}.`);
            eventData.opt_out = true;
          }
        }
        if (forceSend && dbIsRepeat) {
          console.warn(`[CAPI POLICY] force_send_repeat_purchase override by admin for ${maskPhoneWithTenantSuffix(customer?.phone)}`);
        }
      }

      // Mandat payload bersih (A-011) + P0-7 (A-006): baca testEventCode dari param, snake_case, maupun camelCase
      const rawTestCode = testEventCode || customData?.test_event_code || customData?.testEventCode;
      const effectiveTestCode = typeof rawTestCode === 'string' ? rawTestCode.trim() || undefined : undefined;
      const internalFieldsToStrip = [
        'force_send_repeat_purchase',
        'allowZero',
        'allowAged',
        'testEventCode',
        'test_event_code',
        'fuzzyScore',
        'effectiveScore',
        'mql_bubble_count',
        'ruleTriggered',
        'matchSource',
        'rawPayload',
        'reason',
        'adminSender',
      ];
      if (eventData.custom_data) {
        for (const field of internalFieldsToStrip) {
          delete eventData.custom_data[field];
        }
      }

      const payload: any = {
        data: [eventData],
        ...(effectiveTestCode ? { test_event_code: effectiveTestCode } : {}),
      };

      const url = `${GRAPH_API_BASE_URL}/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

      console.log(`[CAPI] Sending event ${eventName} to Meta for customer ${maskPhoneWithTenantSuffix(customer.phone)}`);

      // 5. EXECUTE VIA CIRCUIT BREAKER
      const response: any = await capiBreaker.execute(url, payload);

      // Fallback breaker aktif (error/400/500) → event TIDAK terkirim. Jangan
      // mencatat SUCCESS palsu: fallback mengembalikan fake status 200.
      if (response?.isFallback) {
        console.error(`[CAPI FALLBACK] Event ${eventName} untuk customer ${maskPhoneWithTenantSuffix(customer.phone)} TIDAK terkirim ke Meta (circuit breaker fallback aktif).`);
        console.log(formatStructuredCapiEventLog({
          event: eventData.event_name || eventName,
          event_id: eventData.event_id || 'unknown',
          tenant: tenantId || 'unknown',
          status: 503,
          events_received: 0,
          fbtrace_id: null,
          source: eventData.custom_data?.source || 'unknown',
          skipped: false,
          degraded: true,
          reason: 'Circuit breaker fallback',
        }));
        return {
          success: false,
          message: 'Circuit breaker fallback: event tidak terkirim',
          sentEventId: eventData.event_id,
          events_received: 0,
          eventsReceived: 0,
          deliveryConfirmed: false,
        };
      }

      if (response && response.status === 200) {
        const eventsReceived = Number(response.data?.events_received ?? 0);
        const deliveryConfirmed = response.status === 200 && eventsReceived > 0;
        const { isCapiStrictDelivery } = await import('../config/feature-flags');
        const strictDelivery = isCapiStrictDelivery();
        const effectiveSuccess = strictDelivery ? deliveryConfirmed : true;

        if (deliveryConfirmed) {
          console.log(`[CAPI SUCCESS] Successfully sent event ${eventName} to Meta CAPI.`);
        } else {
          console.warn(`[CAPI UNCONFIRMED] Meta responded HTTP 200 with events_received=${eventsReceived} for ${eventName} (strictDelivery=${strictDelivery}).`);
        }
        console.log(formatStructuredCapiEventLog({
          event: eventData.event_name || eventName,
          event_id: eventData.event_id || 'unknown',
          tenant: tenantId || 'unknown',
          status: response.status,
          events_received: eventsReceived,
          fbtrace_id: response.data?.fbtrace_id ?? null,
          source: eventData.custom_data?.source || 'unknown',
          skipped: false,
          degraded: !deliveryConfirmed,
          ...(!deliveryConfirmed ? { reason: `events_received=${eventsReceived}` } : {}),
        }));
        return {
          success: effectiveSuccess,
          ...(!effectiveSuccess ? { message: `Meta CAPI mengembalikan HTTP 200 tetapi events_received=${eventsReceived} (delivery unconfirmed)` } : {}),
          status: response.status,
          fbtrace_id: response.data?.fbtrace_id,
          events_received: eventsReceived,
          eventsReceived,
          deliveryConfirmed,
          sentEventId: eventData.event_id,
          metaResponse: response.data,
          sentPayload: payload,
          pixelId,
        };
      } else {
        console.error(`[CAPI FAILURE] Meta responded with status ${response?.status || 'unknown'}:`, response?.data);
        console.log(formatStructuredCapiEventLog({
          event: eventData.event_name || eventName,
          event_id: eventData.event_id || 'unknown',
          tenant: tenantId || 'unknown',
          status: response?.status ?? 500,
          events_received: 0,
          fbtrace_id: response?.data?.error?.fbtrace_id ?? null,
          source: eventData.custom_data?.source || 'unknown',
          skipped: false,
          degraded: true,
          reason: `Status code ${response?.status || 'unknown'}`,
        }));
        return {
          success: false,
          status: response?.status,
          fbtrace_id: response?.data?.error?.fbtrace_id,
          events_received: 0,
          eventsReceived: 0,
          deliveryConfirmed: false,
          sentEventId: eventData.event_id,
          message: `Status code ${response?.status || 'unknown'}`,
          metaResponse: response?.data,
          sentPayload: payload,
          pixelId,
        };
      }
    } catch (error: any) {
      // 6. SILENT FAIL: Log error tetapi jangan throw Exception agar tidak merusak critical path caller
      console.error(`[CAPI ERROR] Conversions API failed silently:`, error.message);
      console.log(formatStructuredCapiEventLog({
        event: eventName,
        event_id: 'unknown',
        tenant: tenantId || 'unknown',
        status: 500,
        events_received: 0,
        fbtrace_id: null,
        source: 'unknown',
        skipped: false,
        degraded: true,
        reason: error.message,
      }));
      return {
        success: false,
        message: error.message,
        sentEventId: undefined,
        events_received: 0,
        eventsReceived: 0,
        deliveryConfirmed: false,
      };
    }
  }

  /**
   * LIVE TEST CAPI — memverifikasi Pixel ID & Access Token Meta valid tanpa
   * menunggu transaksi riil. Berbeda dari sendCapiEvent: panggilan dibuat LANGSUNG
   * ke Graph API (tanpa Circuit Breaker) agar response body error Meta yang asli
   * (mis. OAuthException code 190 = token expired) bisa dilihat admin di dashboard.
   *
   * @param params.eventName   Nama event test (default 'Contact')
   * @param params.value       Nilai konversi opsional (untuk Purchase)
   * @param params.currency    Mata uang (default 'IDR')
   * @param params.testEventCode  Kode Test Events dari Meta Events Manager (opsional).
   *                              Bila diisi, event tidak akan dihitung di Ads Manager.
   * @param params.tenantId    Tenant-aware fail-closed: env fallback HANYA untuk
   *                              DEFAULT_TENANT_ID; tenant lain tanpa DB config → skip.
   * @param params.ipAddress   IP request admin (dipakai sebagai client_ip_address test)
   * @param params.userAgent   User-Agent request admin
   */
  public async testCapiConnection(params: {
    eventName?: string;
    value?: number;
    currency?: string;
    testEventCode?: string;
    tenantId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{
    success: boolean;
    status: number | null;
    message: string;
    metaErrorCode?: number;
    metaErrorSubcode?: number;
    responseBody?: any;
    pixelIdConfigured: boolean;
    tokenConfigured: boolean;
    source: 'db' | 'env' | 'none';
  }> {
    // 1. Resolve credentials tenant-aware — SATU pintu via resolveTenantCapiCredentials (fail-closed).
    const { pixelId, accessToken, source } = await resolveTenantCapiCredentials(params.tenantId);

    const pixelIdConfigured = Boolean(pixelId);
    const tokenConfigured = Boolean(accessToken);

    if (!pixelId || !accessToken) {
      return {
        success: false,
        status: null,
        message: `Kredensial CAPI tidak lengkap (Pixel ID ${pixelIdConfigured ? 'OK' : 'MISSING'}, Access Token ${tokenConfigured ? 'OK' : 'MISSING'}). Konfigurasi dulu di Operational Settings.`,
        pixelIdConfigured,
        tokenConfigured,
        source,
      };
    }

    // 2. Bangun payload event test minimal (event_id unik agar tidak bertabrakan dengan event riil)
    const eventName = params.eventName || 'Contact';
    const builder = new ParamBuilder();
    const testNormalizedPhone = '6288888888888';
    const hashedPhone = builder.getNormalizedAndHashedPII(testNormalizedPhone, PII_DATA_TYPE.PHONE);
    const hashedFn = builder.getNormalizedAndHashedPII('Tester', PII_DATA_TYPE.FIRST_NAME);
    const hashedCountry = builder.getNormalizedAndHashedPII('id', PII_DATA_TYPE.COUNTRY);

    const eventData: any = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: `capi_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      action_source: 'chat',
      user_data: {
        ph: hashedPhone ? [hashedPhone] : undefined,
        fn: hashedFn ? [hashedFn] : undefined,
        country: hashedCountry ? [hashedCountry] : undefined,
        client_ip_address: isPublicIp(params.ipAddress) ? params.ipAddress : undefined,
        client_user_agent: params.userAgent || 'Admin CAPI Test Connection',
      },
      custom_data: {
        traffic_source: 'test',
      },
    };
    if (params.value !== undefined && params.value !== null && !Number.isNaN(Number(params.value))) {
      eventData.custom_data.value = Number(params.value);
      eventData.custom_data.currency = params.currency || 'IDR';
    }
    const trimmedTestCode = params.testEventCode?.trim() || undefined;
    const payload: any = {
      data: [eventData],
      ...(trimmedTestCode ? { test_event_code: trimmedTestCode } : {}),
    };
    const url = `${GRAPH_API_BASE_URL}/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

    console.log(`[CAPI TEST] Sending test ${eventName} event to Meta (pixel ${pixelId})...`);

    // 3. Kirim LANGSUNG (tanpa breaker) agar error asli Meta terbaca
    try {
      const response = await axios.post(url, payload, { timeout: 10000 });
      return {
        success: true,
        status: response.status,
        message: `Event test '${eventName}' diterima Meta (HTTP ${response.status}). Kredensial valid.`,
        responseBody: response.data,
        pixelIdConfigured,
        tokenConfigured,
        source,
      };
    } catch (err: any) {
      const status = err?.response?.status || null;
      const errorBody = err?.response?.data?.error || null;
      const metaErrorCode = errorBody?.code;
      const metaErrorSubcode = errorBody?.error_subcode;

      let hint = '';
      if (metaErrorCode === 190) {
        hint = ' → Access Token invalid/expired. Rotate token di Operational Settings.';
      } else if (metaErrorCode === 100) {
        hint = ' → Kemungkinan Pixel ID salah atau parameter tidak valid.';
      } else if (metaErrorCode === 10) {
        hint = ' → Access token tidak memiliki izin untuk pixel ini.';
      }

      return {
        success: false,
        status,
        message: `${errorBody?.message || err?.message || 'Gagal menghubungi Meta Graph API'}${hint}`,
        metaErrorCode,
        metaErrorSubcode,
        responseBody: errorBody,
        pixelIdConfigured,
        tokenConfigured,
        source,
      };
    }
  }
}

export const capiService = new CapiService();
