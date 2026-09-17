/**
 * PromptComposer (Fase 3.4) — menyatukan layer & direktif fase menjadi prompt
 * final Call 1 (router) dan Call 2 (system).
 *
 * Jaminan kompatibilitas: urutan perakitan sama persis dengan template
 * monolitik `persona.ts` sebelumnya, sehingga output byte-identik (gerbang
 * diff baseline) dan invarian prompt-cache (prefix stabil >20k char,
 * identik antar-turn) tetap terpenuhi.
 */
import type { CustomerGoalSession } from '../../state/goal-tracker';
import { GoalTracker } from '../../state/goal-tracker';
import { getBrandIdentity, getBrandIdentityAsync, DEFAULT_BRAND_IDENTITY } from '../../../config/brand';
import { DEFAULT_TENANT_ID } from '../../../config/tenant';
import { FewShotExemplarBank } from '../few-shot-exemplars';
import type { ExtractedEntities } from '../../../types/nlu';
import { TenantPromptConfigService } from '../../../services/tenant-prompt-config.service';
import {
  buildPersonaHeader,
  GAYA_BICARA_BLOCK,
  EMPATI_IDENTITAS_BLOCK,
  OPERATIONAL_POLICY_BLOCK,
  FEW_SHOT_EXAMPLES_BLOCK,
  TONE_NEG_CONSTRAINTS,
  TONE_NEG_CONSTRAINTS_TAIL,
  FORMAT_NEG_CONSTRAINTS,
  buildGreetingTail,
  buildGreetingInstruction,
} from './layers/core-persona.layer';
import {
  OVERCLAIM_BLOCK,
  SAFETY_NEG_CONSTRAINTS_HEAD,
  INJECTION_DEFENSE_BLOCK,
} from './layers/global-safety.layer';
import {
  LOCATION_HIERARCHY_BLOCK,
  NO_GUESS_CITY_RULE,
  LOCATION_NEG_CONSTRAINTS,
} from './phases/location-rules.phase';
import {
  buildPricingCatalogBlock,
  NO_TREATMENT_ASSUMPTION_RULE,
  CATALOG_GROUNDING_NEG_CONSTRAINTS,
} from './phases/pricing-catalog.phase';
import {
  SCHEDULING_HIERARCHY_BLOCK,
  buildScheduleNegConstraintsHead,
  SCHEDULE_NEG_CONSTRAINTS_TAIL,
  TOOL_GUIDANCE_BLOCK,
} from './phases/scheduling.phase';
import {
  buildRouterToolRoutingBlock,
} from './phases/router-tool-routing.layer';
import {
  buildRouterDirectReplyBlock,
} from './phases/router-direct-reply.layer';
import {
  getRealTimeTemporalGrounding,
} from '../../../utils/temporal-grounding';

export const EXAMPLES_START_MARKER = '[CONTOH GAYA CHAT WHATSAPP BIDAN YUSI (FEW-SHOT EXAMPLES)]';
export const EXAMPLES_END_MARKER = '[ATURAN ANTI-OVERCLAIM MEDIS]';
/**
 * PLAN 9 FASE 9.1 — Batas prefix statis vs tail dinamis.
 * Semua teks SEBELUM penanda ini byte-identik antar-turn (kandidat prompt caching);
 * SESUDAHNYA berisi status sesi + sapaan + few-shot dinamis yang berubah per-turn.
 */
export const STABLE_PREFIX_MARKER = '__STATIC_PERSONA_BLOCK_END__';

export interface DynamicPromptExemplar {
  id: string;
  scenario: string;
  customerMessage: string;
  idealResponse: string;
  tags: string[];
}

export interface DynamicPromptResult {
  systemPrompt: string;
  exemplars: DynamicPromptExemplar[];
  usedDynamicExamples: boolean;
}

const NEGATIVE_CONSTRAINTS_HEADER = '[NEGATIVE CONSTRAINTS MUTLAK (ATURAN EMAS KLINIK - WAJIB 100% PATUH)]';

function buildNegativeConstraintsBlock(session?: CustomerGoalSession): string {
  return [
    NEGATIVE_CONSTRAINTS_HEADER,
    TONE_NEG_CONSTRAINTS,
    buildScheduleNegConstraintsHead(session),
    TONE_NEG_CONSTRAINTS_TAIL,
    SAFETY_NEG_CONSTRAINTS_HEAD,
    NO_GUESS_CITY_RULE,
    NO_TREATMENT_ASSUMPTION_RULE,
    FORMAT_NEG_CONSTRAINTS,
    LOCATION_NEG_CONSTRAINTS,
    CATALOG_GROUNDING_NEG_CONSTRAINTS,
    INJECTION_DEFENSE_BLOCK,
    SCHEDULE_NEG_CONSTRAINTS_TAIL,
  ].join('\n');
}

export interface RouterPromptOpts {
  contextSummary?: string;
  phaseDirective?: string;
  history?: Array<{ role: string; content: string }>;
  askedLocationRecently?: boolean;
  /**
   * Fase 3 (router layering) — sadar masking deterministik. True bila
   * save_reservation di-mask gate pre-LLM: bullet panjang diganti satu baris
   * status ringkas. Tidak disetel/false → teks kanonis byte-identik.
   */
  isSaveReservationMasked?: boolean;
}

export interface SystemPromptOpts {
  history?: Array<{ role: string; content: string }>;
  askedLocationRecently?: boolean;
  /**
   * Fase 3.5 — injeksi fase operasional dinamis (OPT-IN).
   * Tidak disetel → rakitan penuh identik eksisting (safe-mode, byte-identik).
   */
  phaseInjection?: PhaseInjectionOpts;
}

/**
 * Fase 3.5 — fokus percakapan untuk injeksi direktif selektif.
 * - EARLY_LOCATION: Turn-0 / lokasi belum diketahui (klarifikasi domisili).
 * - CONSULTATION: lokasi diketahui, layanan belum final (rekomendasi klinis).
 * - SCHEDULING: layanan/hari dibahas (negosiasi jadwal & reservasi).
 */
export type PhaseFocus = 'EARLY_LOCATION' | 'CONSULTATION' | 'SCHEDULING';

export interface PhaseInjectionOpts {
  /** Fokus aktif (biasanya dari derivePhaseFocus; bisa manual). */
  focus?: PhaseFocus[];
  /**
   * slim=false (default): rakitan penuh + blok penekanan fokus di wilayah
   * volatil (prefix stabil byte-identik → cache hit lestari).
   * slim=true: hierarki pra-marker ikut dirampingkan per fokus (prefix
   * berbeda per-profil; hanya untuk pemakaian eksplisit).
   */
  slim?: boolean;
}

/** Turunan murni: fokus dari status sesi (lokasi → keranjang/booking). */
export function derivePhaseFocus(session: CustomerGoalSession): PhaseFocus[] {
  const loc = (session as any)?.location || {};
  const locationKnown = Boolean(loc.kelurahan || loc.kecamatan || loc.kota || loc.rawText);
  if (!locationKnown) return ['EARLY_LOCATION'];
  const cartActive = Array.isArray((session as any)?.cartItems) && (session as any).cartItems.length > 0;
  const bookingActive = Boolean((session as any)?.booking?.preferredDate);
  if (cartActive || bookingActive) return ['CONSULTATION', 'SCHEDULING'];
  return ['CONSULTATION'];
}

const PHASE_FOCUS_LINES: Record<PhaseFocus, string> = {
  EARLY_LOCATION:
    'Fokus turn ini: klarifikasi domisili (kelurahan/perumahan) sebelum cek jadwal; tunda rincian nota multi-anak.',
  CONSULTATION:
    'Fokus turn ini: rekomendasi klinis dari katalog + mode konsultasi/transaksional; tunda negosiasi hari.',
  SCHEDULING:
    'Fokus turn ini: konfirmasi hari + gating save_reservation; jangan ulangi deskripsi katalog.',
};

function buildPhaseFocusBlock(focus: PhaseFocus[]): string {
  const lines = focus.map((f) => `- ${f}: ${PHASE_FOCUS_LINES[f]}`);
  return `[PHASE_FOCUS: ${focus.join('+')}]\n${lines.join('\n')}`;
}

/** Rakitan hierarki penuh (urutan kanonis Fase 3 — JANGAN diubah). */
function buildHierarchyFull(): string {
  return `${LOCATION_HIERARCHY_BLOCK}\n${buildPricingCatalogBlock()}\n${SCHEDULING_HIERARCHY_BLOCK}`;
}

/** Subset hierarki per fokus (urutan kanonis dipertahankan). */
function buildHierarchySlim(focus: PhaseFocus[]): string {
  const wantLocation = focus.includes('EARLY_LOCATION') || focus.includes('CONSULTATION');
  // SCHEDULING ramping: paket/keluhan dianggap selesai diputuskan (lihat
  // neg-constraints + tool guidance yang selalu utuh); totals resmi tetap
  // dipasok tool via cartTotalReply/suggestedPriceReply per-turn.
  const wantPricing = focus.includes('CONSULTATION');
  const wantScheduling = focus.includes('SCHEDULING');
  const parts: string[] = [];
  if (wantLocation) parts.push(LOCATION_HIERARCHY_BLOCK);
  if (wantPricing) parts.push(buildPricingCatalogBlock());
  if (wantScheduling) parts.push(SCHEDULING_HIERARCHY_BLOCK);
  return parts.join('\n');
}

/**
 * Router Prompt untuk Call 1 (~800 - 1.200 token).
 * Khusus untuk evaluasi apakah perlu memanggil Tools atau langsung respon ramah singkat.
 * Menghilangkan 90% bloat (hierarki 18k char, negative constraints 9k char, few-shots 7k char).
 */
export function composeRouterPrompt(
  session: CustomerGoalSession,
  isFollowUp: boolean = false,
  opts?: RouterPromptOpts
): string {
  const brand = getBrandIdentity();
  const goalSummary = GoalTracker.formatGoalSessionForPrompt(session, opts);
  // FM2 (sesi 180166): jangkar kalender real-time di ekor dinamis agar LLM
  // tak menebak tanggal (router prompt memang volatil per-turn).
  const temporalSuffix = `\n\n${getRealTimeTemporalGrounding().block}`;

  return `Kamu adalah Bidan Yusi, asisten AI konsultan resmi dari "${brand.businessName}" (layanan homecare treatment ibu dan bayi di area Surabaya dan Sidoarjo).

${buildRouterToolRoutingBlock({ isSaveReservationMasked: opts?.isSaveReservationMasked })}
${buildRouterDirectReplyBlock(session, isFollowUp, brand.businessName)}

${opts?.contextSummary ? `${opts.contextSummary}\n\n` : ''}${opts?.phaseDirective ? `${opts.phaseDirective}\n\n` : ''}${goalSummary}${temporalSuffix}`;
}
/**
 * Varian async tenant-aware (Plan 4): Call 1 Router Prompt menyerap konfigurasi
 * persona dinamis dari DB (`TenantPromptConfigService`) + identitas brand
 * per-tenant (`getBrandIdentityAsync`).
 *
 * Fondasi: base = prompt statis `composeRouterPrompt` (fallback penuh bila DB
 * offline — perilaku Call 1 eksisting terpin). Bila tenant punya konfigurasi
 * aktif, section dashboard disuntik sebagai blok overlay; bila brand tenant
 * di-override, nama bisnis default diganti. Tanpa baris DB → output identik
 * dengan varian sinkron.
 */
export async function composeRouterPromptAsync(
  session: CustomerGoalSession,
  isFollowUp: boolean = false,
  opts?: RouterPromptOpts & { tenantId?: string }
): Promise<string> {
  const tenantId = opts?.tenantId || DEFAULT_TENANT_ID;
  const base = composeRouterPrompt(session, isFollowUp, {
    contextSummary: opts?.contextSummary,
    phaseDirective: opts?.phaseDirective,
    history: opts?.history,
    askedLocationRecently: opts?.askedLocationRecently,
    isSaveReservationMasked: opts?.isSaveReservationMasked,
  });

  const [dbPrompt, brand] = await Promise.all([
    TenantPromptConfigService.getActivePromptConfig(tenantId).catch(() => null),
    getBrandIdentityAsync(tenantId).catch(() => getBrandIdentity()),
  ]);

  let prompt = base;
  const defaultBiz = DEFAULT_BRAND_IDENTITY.businessName;
  if (brand.businessName !== defaultBiz) {
    prompt = prompt.split(defaultBiz).join(brand.businessName);
  }
  if (dbPrompt) {
    prompt += `\n\n[KONFIGURASI PERSONA TENANT (DASHBOARD — BERLAKU MENYELURUH)]\n${dbPrompt.personalityTone}\n\n${dbPrompt.answeringHierarchy}\n\n${dbPrompt.negativeConstraints}\n\n${dbPrompt.medicalOverclaimRules}`;
  }
  return prompt;
}

/**
 * Membangun System Prompt Bidan Yusi yang hangat, manusiawi, luwes,
 * dan kontekstual selayaknya Bidan asli di WhatsApp tanpa celah pelanggaran SOP.
 */
export function composeSystemPrompt(
  session: CustomerGoalSession,
  isFollowUp: boolean = false,
  opts?: SystemPromptOpts
): string {
  const goalSummary = GoalTracker.formatGoalSessionForPrompt(session, opts);
  const brand = getBrandIdentity();
  const greetingInstruction = buildGreetingInstruction(isFollowUp, brand.businessName);
  const negConstraints = buildNegativeConstraintsBlock(session);
  const injection = opts?.phaseInjection;
  const focus = injection?.focus && injection.focus.length > 0 ? [...new Set(injection.focus)] : null;
  const hierarchy = focus && injection?.slim ? buildHierarchySlim(focus) : buildHierarchyFull();
  const focusSuffix = focus ? `\n\n${buildPhaseFocusBlock(focus)}` : '';

  return `${buildPersonaHeader(brand.businessName)}

${GAYA_BICARA_BLOCK}

${EMPATI_IDENTITAS_BLOCK}

${hierarchy}

${OPERATIONAL_POLICY_BLOCK}

${FEW_SHOT_EXAMPLES_BLOCK}

${OVERCLAIM_BLOCK}

  ${negConstraints}

${TOOL_GUIDANCE_BLOCK}

${STABLE_PREFIX_MARKER}
${goalSummary}${focusSuffix}

${getRealTimeTemporalGrounding().block}

${buildGreetingTail(session.genderGreeting, greetingInstruction)}`;
}

/**
 * Varian async: memuat contoh chat DINAMIS dari bank few_shot_exemplars
 * (DB Koleksi Emas, fallback in-memory) yang paling relevan dengan pesan
 * masuk, lalu MENGGANTIKAN blok contoh statis di prompt. Fallback aman ke
 * prompt statis bila bank kosong / DB tidak terjangkau.
 */
export async function composeSystemPromptAsync(
  session: CustomerGoalSession,
  isFollowUp: boolean = false,
  opts?: SystemPromptOpts & { tenantId?: string; incomingText?: string }
): Promise<DynamicPromptResult> {
  const tenantId = opts?.tenantId || DEFAULT_TENANT_ID;
  const incomingText = opts?.incomingText || '';
  // Coba ambil prompt versioned dari DB; fallback ke hardcode bila tidak ada
  let base: string;
  try {
    const dbPrompt = await TenantPromptConfigService.getActivePromptConfig(tenantId);
    if (dbPrompt) {
      const goalSummary = GoalTracker.formatGoalSessionForPrompt(session, opts);
      const brand = getBrandIdentity();
      const greetingInstruction = buildGreetingInstruction(isFollowUp, brand.businessName);
      base = `Kamu adalah Bidan Yusi, bidan konsultan resmi dari "${brand.businessName}" — layanan homecare treatment profesional untuk ibu dan bayi langsung ke rumah di area Surabaya dan Sidoarjo.

${dbPrompt.personalityTone}

${dbPrompt.answeringHierarchy}

[CONTOH GAYA CHAT WHATSAPP BIDAN YUSI (FEW-SHOT EXAMPLES)]
(PENTING: seluruh nominal rupiah, nama paket, dan durasi pada contoh di bawah adalah ILUSTRASI POLA BAHASA — BUKAN data resmi. Harga dan durasi yang WAJIB dipakai HANYA dari hasil tool turn ini. Jangan pernah menyalin angka dari contoh.)

${dbPrompt.medicalOverclaimRules}

${dbPrompt.negativeConstraints}

[PANDUAN PENGGUNAAN TOOLS]
1. calculate_delivery: WAJIB panggil saat lokasi disebut
2. get_catalog_and_price: saat tanya harga/keluhan
3. get_clinic_policy_faq: saat tanya kebijakan klinik
4. save_reservation: saat booking
5. escalate_to_human: darurat

${STABLE_PREFIX_MARKER}
${goalSummary}

${getRealTimeTemporalGrounding().block}

[ATURAN SAPAAN PEMBUKA — WAJIB]
- Gunakan sapaan "${session.genderGreeting}" untuk customer ini (atau "Bapak" jika customer laki-laki/suami), wajar 1-2 kali per pesan.
${greetingInstruction}`;
    } else {
      base = composeSystemPrompt(session, isFollowUp, opts);
    }
  } catch {
    base = composeSystemPrompt(session, isFollowUp, opts);
  }

  // Light intent extraction untuk seleksi exemplar — data-driven via gazetteer,
  // BUKAN gatekeeper perilaku LLM (duplikasi ringan disengaja agar modul prompt
  // tidak bergantung ke fasad persona dan menghindari circular import).
  const { extractFastIntents } = await import('../persona');
  try {
    // Hangatkan cache bank dari DB (atau fallback in-memory saat offline).
    await FewShotExemplarBank.getAllExemplars(tenantId);
    const lightExtraction: ExtractedEntities = {
      intents: extractFastIntents(incomingText) as ExtractedEntities['intents'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: null,
      symptoms: [],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0,
    };
    const picked = FewShotExemplarBank.selectRelevantExemplars(
      lightExtraction,
      undefined,
      incomingText,
      tenantId
    ).slice(0, 2);
    if (!picked || picked.length === 0) {
      return { systemPrompt: base, exemplars: [], usedDynamicExamples: false };
    }

    const startIdx = base.indexOf(EXAMPLES_START_MARKER);
    const endIdx = base.indexOf(EXAMPLES_END_MARKER);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      return { systemPrompt: base, exemplars: [], usedDynamicExamples: false };
    }

    const dynamicBlock =
      `[CONTOH GAYA CHAT WHATSAPP BIDAN YUSI (DINAMIS DARI BANK — TIRU POLA & NADANYA)]:\n` +
      FewShotExemplarBank.formatExemplarsForPrompt(picked);
    // PLAN 9 FASE 9.1: buang blok contoh STATIS dari body, lalu sisipkan blok
    // DINAMIS tepat SETELAH penanda stabil (wilayah volatil) — sehingga prefix
    // statis tetap byte-identik antar-turn dan layak prompt caching.
    const withoutStaticExamples = base.slice(0, startIdx) + base.slice(endIdx);
    const stableIdx = withoutStaticExamples.indexOf(STABLE_PREFIX_MARKER);
    const systemPrompt =
      stableIdx >= 0
        ? withoutStaticExamples.slice(0, stableIdx) +
          STABLE_PREFIX_MARKER +
          '\n' + dynamicBlock + '\n\n' +
          withoutStaticExamples.slice(stableIdx + STABLE_PREFIX_MARKER.length)
        : withoutStaticExamples.slice(0, startIdx) + dynamicBlock + '\n\n' + withoutStaticExamples.slice(startIdx);
    const exemplars: DynamicPromptExemplar[] = picked.map((e) => ({
      id: e.id,
      scenario: e.scenario,
      customerMessage: e.customerMessage,
      idealResponse: e.idealResponse,
      tags: e.tags || [],
    }));
    return { systemPrompt, exemplars, usedDynamicExamples: true };
  } catch {
    return { systemPrompt: base, exemplars: [], usedDynamicExamples: false };
  }
}
