/**
 * test-suite-v2.schema.ts — Kontrak zod untuk dataset pengujian v2.
 *
 * Satu sumber kebenaran struktur `tests/fixtures/test-suite-v2.json`.
 * Data lahir dari `scripts/build-test-suite-v2.ts` (DB-driven), diverifikasi
 * oleh `tests/unit/test-suite-v2-schema.test.ts` (red→green TDD: schema test
 * ditulis lebih dulu, fixture lahir nyusul).
 *
 * Semua komentar dalam Bahasa Indonesia (konsisten repo).
 */
import { z } from 'zod';

/** Prioritas bisnis — super-set dari 3 nilai sumber + 4 kategori kasus baru. */
export const PriorityV2 = z.enum([
  'RESERVATION_TRACK_RECORD',
  'MQL_HIGH_INTENT',
  'RICH_CLINICAL_QUESTION',
  'RED_FLAG_MEDICAL',
  'COMPLAINT_FRAUD',
  'ADVERSARIAL_SECURITY',
  'OPERATIONAL_SCHEDULE',
]);
export type PriorityV2 = z.infer<typeof PriorityV2>;

export const ExpectedReservationFieldsSchema = z
  .object({
    name: z.string().optional(),
    date: z.string().optional(),
    day: z.string().optional(),
    address_kelurahan: z.string().optional(),
    address_kecamatan: z.string().optional(),
    city: z.string().optional(),
    child_age_months: z.number().int().optional(),
    treatment_name: z.string().optional(),
    phone_masked: z.string().optional(),
  })
  .strict();

export const ExpectedBehaviorSchema = z
  .object({
    /** Harga akhir (treatment + ongkir − promo). Null = tidak relevan untuk kasus ini. */
    expected_total_price: z.number().int().nullable().optional(),
    expected_reservation_fields: ExpectedReservationFieldsSchema.optional(),
    /** Topik SOP klinis yang tersentuh (mis. "vaksin-jeda-48jam", "usia-minimal-pijat", "demam-redflag"). */
    expected_sop_compliance: z.array(z.string()).optional(),
    /** State machine akhir yang diharapkan (mis. HUMAN_HANDLING, AWAITING_INTEREST). */
    expected_final_state: z.string().optional(),
    /** Tool yang WAJIB di-masking (tidak boleh sampai ke LLM) pada turn tertentu. */
    expected_tools_masked: z.array(z.string()).optional(),
    /** true bila hari & tanggal yang disebut customer tidak match di kalender 2026. */
    date_mismatch_flag: z.boolean().optional(),
    /** true bila balasan bidan lama di transcript terbukti salah (aturan resmi baru lebih benar). */
    known_issue_in_original_transcript: z.boolean().optional(),
    issue_note: z.string().optional(),
  })
  .strict();

export const TestCaseV2Schema = z
  .object({
    id: z.string().regex(/^(CASE-\d{3}|RF-\d{2}|CX-\d{2}|ADV-\d{2}|OPS-\d{2})$/),
    /** id numerik asli di scratch/all-100-test-cases.json (1..100), atau null untuk kasus baru. */
    source_id: z.number().int().nullable(),
    tenant_id: z.string(),
    priority: PriorityV2,
    flowCategory: z.string().min(1),
    caseObjective: z.string().min(1),
    totalTurns: z.number().int().nonnegative(),
    /** Turn input customer — dipertahankan verbatim (gaya bahasa asli) setelah anonimisasi teknis. */
    customerDialogueFlow: z.array(z.string()).min(1),
    expected_behavior: ExpectedBehaviorSchema,
    /** Variasi parafrase nyata (wajib ≥3 untuk RF/ADV) — tiap varian = sub-run terisolasi. */
    paraphrases: z.array(z.string()).optional(),
  })
  .strict();

export const ReferenceRulesSchema = z
  .object({
    generated_at: z.string().datetime(),
    tenant_id: z.string(),
    db_hash: z.string(),
    sources: z.array(z.string()),
    pricing_tiers: z.array(
      z
        .object({
          maxDist: z.number(),
          fee: z.number().int(),
          promoDiscount: z.number().int(),
        })
        .strict()
    ),
    services: z.array(
      z
        .object({
          service_id: z.string(),
          name: z.string(),
          category: z.string(),
          min_age_months: z.number().int(),
          max_age_months: z.number().int().nullable(),
          age_label: z.string(),
          duration_minutes: z.number().int(),
          promo_price: z.number().int(),
        })
        .strict()
    ),
    clinic_policies: z.array(
      z
        .object({
          topic: z.string(),
          factual_summary: z.string(),
        })
        .strict()
    ),
  })
  .strict();

export const TestSuiteV2Schema = z
  .object({
    meta: z
      .object({
        version: z.literal('2.0'),
        generated_at: z.string().datetime(),
        tenant_id: z.string(),
        source_count: z.number().int(),
        total: z.number().int(),
      })
      .strict(),
    cases: z.array(TestCaseV2Schema),
  })
  .strict();

export type TestCaseV2 = z.infer<typeof TestCaseV2Schema>;
export type ReferenceRules = z.infer<typeof ReferenceRulesSchema>;
export type TestSuiteV2 = z.infer<typeof TestSuiteV2Schema>;

/** Episode Tier — 5 tingkatan skenario komprehensif */
export const EpisodeTier = z.enum([
  'TIER1_NORMAL_INQUIRY',
  'TIER1_LOCATION_FEE',
  'TIER1_BOOKING_FLOW',
  'TIER2_LINGUISTIC_TYPO_SLANG',
  'TIER2_BURST_AND_AMBIGUOUS',
  'TIER3_CLINICAL_SYMPTOM_SOP',
  'TIER3_POST_VACCINE_OR_AGE',
  'TIER4_SCHEDULE_CONFLICT_RESCHEDULE',
  'TIER4_PRICE_NEGOTIATION_OR_DISPUTE',
  'TIER5_RED_FLAG_EMERGENCY',
  'TIER5_SECURITY_ADVERSARIAL',
]);
export type EpisodeTier = z.infer<typeof EpisodeTier>;

export const EpisodeExpectedBehaviorSchema = z.object({
  expected_final_state: z.string().optional(),
  expected_reservation_fields: ExpectedReservationFieldsSchema.optional(),
  expected_sop_compliance: z.array(z.string()).optional(),
  expected_tools_masked: z.array(z.string()).optional(),
  expected_total_price: z.number().int().nullable().optional(),
});
export type EpisodeExpectedBehavior = z.infer<typeof EpisodeExpectedBehaviorSchema>;

export const EpisodeSchema = z.object({
  episodeId: z.string().regex(/^(CASE-\d{3}|RF-\d{2}|CX-\d{2}|ADV-\d{2}|OPS-\d{2})_EP\d{2}$/),
  sourceCaseId: z.string().regex(/^(CASE-\d{3}|RF-\d{2}|CX-\d{2}|ADV-\d{2}|OPS-\d{2})$/),
  episodeIndex: z.number().int().nonnegative(),
  tier: EpisodeTier,
  customerDialogueFlow: z.array(z.string()).min(2).max(5),
  expectedBehavior: EpisodeExpectedBehaviorSchema,
  seedTurnIds: z.array(z.number().int().nonnegative()),
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const EpisodesFixtureMetaSchema = z.object({
  version: z.literal('2.0-episodes'),
  generated_at: z.string().datetime(),
  tenant_id: z.string(),
  source_version: z.string(),
  source_total_cases: z.number().int(),
  total_episodes: z.number().int(),
  tier_distribution: z.record(EpisodeTier, z.number().int().nonnegative()),
});

export const EpisodesFixtureSchema = z.object({
  meta: EpisodesFixtureMetaSchema,
  episodes: z.array(EpisodeSchema),
});
export type EpisodesFixture = z.infer<typeof EpisodesFixtureSchema>;

/** Regex hygiene PII — HANYA untuk gate keamanan fixture, bukan untuk intent pengguna. */
export const RAW_PHONE_RE = /\b(?:62\d{8,12}|08\d{7,11}|\+?62[\s-]?\d{9,13})\b/g;
export const RAW_EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;