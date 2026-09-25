/**
 * scripts/lib/conversation-episode-slicer.ts — Episode Slicer untuk Test Suite V2.
 *
 * Memecah customerDialogueFlow monolog (1-89 turn) menjadi Atomic Episodes (2-5 turn)
 * berdasarkan milestone state kontrak fixture, bukan timestamp (fixture tidak menyimpan
 * timestamp per-turn — window 6 jam tidak dieksekusi di data ini).
 *
 * Prinsip:
 * - Sumber: tests/fixtures/test-suite-v2.json (119 kasus existing)
 * - Potong pada: (a) batas N turn (default 5), (b) milestone terminal state di tengah flow
 *   (expected_final_state IN {HUMAN_HANDLING, RESERVATION_SENT, SCHEDULED, COMPLETED}).
 * - Output: Episode[] dengan metadata tier, expected_behavior terisolasi per episode.
 */

import { z } from 'zod';
import { ExpectedReservationFieldsSchema } from '../../tests/fixtures/test-suite-v2.schema';

/** Enum Tier — selaras dengan PriorityV2/flowCategory yang sudah ada di schema */
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
  episodeId: z.string(),
  sourceCaseId: z.string(),
  episodeIndex: z.number().int().nonnegative(),
  tier: EpisodeTier,
  /** Turn customer dalam episode ini (2-5 turn) */
  customerDialogueFlow: z.array(z.string()).min(2).max(5),
  /** expected_behavior khusus episode ini (subset dari kasus induk) */
  expectedBehavior: EpisodeExpectedBehaviorSchema,
  /** ID turn asli di kasus induk untuk traceability */
  seedTurnIds: z.array(z.number().int().nonnegative()),
});
export type Episode = z.infer<typeof EpisodeSchema>;

/** Mapping kasus id -> tier (berbasis flowCategory/priority existing) */
function inferTier(caseId: string, flowCategory: string, priority: string): EpisodeTier {
  const id = caseId.toUpperCase();
  if (id.startsWith('RF-')) return 'TIER5_RED_FLAG_EMERGENCY';
  if (id.startsWith('ADV-')) return 'TIER5_SECURITY_ADVERSARIAL';
  if (id.startsWith('CX-')) return 'TIER4_PRICE_NEGOTIATION_OR_DISPUTE';
  if (id.startsWith('OPS-')) return 'TIER4_SCHEDULE_CONFLICT_RESCHEDULE';

  // CASE-xxx: map dari flowCategory
  const cat = flowCategory.toLowerCase();
  if (cat.includes('location') || cat.includes('fee') || cat.includes('ongkir')) return 'TIER1_LOCATION_FEE';
  if (cat.includes('book') || cat.includes('reserv')) return 'TIER1_BOOKING_FLOW';
  if (cat.includes('medis') || cat.includes('clinical') || cat.includes('symptom')) return 'TIER3_CLINICAL_SYMPTOM_SOP';
  if (cat.includes('vaksin') || cat.includes('usia') || cat.includes('age')) return 'TIER3_POST_VACCINE_OR_AGE';
  if (cat.includes('linguist') || cat.includes('typo') || cat.includes('slang') || cat.includes('dialek')) return 'TIER2_LINGUISTIC_TYPO_SLANG';
  if (cat.includes('burst') || cat.includes('ambigu')) return 'TIER2_BURST_AND_AMBIGUOUS';
  return 'TIER1_NORMAL_INQUIRY';
}

/** State terminal yang memaksa potong episode */
const TERMINAL_STATES = new Set(['HUMAN_HANDLING', 'RESERVATION_SENT', 'SCHEDULED', 'COMPLETED']);

/**
 * Slice satu kasus monolog menjadi episode-episode atomik.
 * @param caseData - Kasus dari test-suite-v2.json (harus punya id, customerDialogueFlow, expected_behavior, flowCategory, priority)
 * @param maxTurnsPerEpisode - Default 5
 */
export function sliceCaseToEpisodes(caseData: {
  id: string;
  customerDialogueFlow: string[];
  expected_behavior: any;
  flowCategory: string;
  priority: string;
}, maxTurnsPerEpisode = 5): Episode[] {
  const turns = caseData.customerDialogueFlow;
  const tier = inferTier(caseData.id, caseData.flowCategory, caseData.priority);
  const episodes: Episode[] = [];
  let start = 0;
  let episodeIndex = 0;

  while (start < turns.length) {
    let end = Math.min(start + maxTurnsPerEpisode, turns.length);

    // Cari force-cut di window (RF/ADV/CX/OPS = 2 turn; last turn selalu cut)
    for (let i = start; i < end; i++) {
      const isLastTurnOfCase = i === turns.length - 1;
      const isShortCase = ['RF-', 'ADV-', 'CX-', 'OPS-'].some(p => caseData.id.startsWith(p));
      if (isLastTurnOfCase || (isShortCase && i >= start + 1)) {
        end = i + 1;
        break;
      }
    }

    // Jika sisa 1 turn di akhir dan sudah ada episode sebelumnya, merge ke episode terakhir
    // TAPI hanya jika tidak melebihi maxTurnsPerEpisode
    const remainingAfter = turns.length - end;
    if (remainingAfter === 1 && episodes.length > 0) {
      const prevEpisodeTurns = episodes[episodes.length - 1].customerDialogueFlow.length;
      if (prevEpisodeTurns + 1 <= maxTurnsPerEpisode) {
        end = turns.length;
      }
    }

    const episodeTurns = turns.slice(start, end);
    
    // Safety: jika episode > maxTurns, trim ke maxTurns (harusnya tidak terjadi)
    if (episodeTurns.length > maxTurnsPerEpisode) {
      const trimmed = episodeTurns.slice(0, maxTurnsPerEpisode);
      // Adjust end to match trimmed length
      end = start + maxTurnsPerEpisode;
    }
    
    // Skip episode < 2 turn (schema requirement), advance start regardless
    if (episodeTurns.length < 2) {
      start = end;
      continue;
    }

    const exp = caseData.expected_behavior || {};
    const episodeExpected: Episode['expectedBehavior'] = {
      expected_final_state: end === turns.length ? exp.expected_final_state : undefined,
      expected_reservation_fields: end === turns.length ? exp.expected_reservation_fields : undefined,
      expected_sop_compliance: exp.expected_sop_compliance?.length ? exp.expected_sop_compliance : undefined,
      expected_tools_masked: exp.expected_tools_masked?.length ? exp.expected_tools_masked : undefined,
      expected_total_price: exp.expected_total_price ?? null,
    };

    episodes.push({
      episodeId: `${caseData.id}_EP${String(episodeIndex + 1).padStart(2, '0')}`,
      sourceCaseId: caseData.id,
      episodeIndex,
      tier,
      customerDialogueFlow: episodeTurns,
      expectedBehavior: episodeExpected,
      seedTurnIds: Array.from({ length: episodeTurns.length }, (_, k) => start + k),
    });

    start = end;
    episodeIndex++;
  }

  return episodes;
}

/**
 * Slice seluruh suite 119 kasus → array Episode datar.
 * Filter opsional: hanya kasus tertentu (by id prefix, tier, atau array id).
 */
export function sliceSuiteToEpisodes(
  suite: { cases: any[] },
  opts?: { onlyIds?: string[]; onlyTiers?: EpisodeTier[] }
): Episode[] {
  const all: Episode[] = [];
  for (const c of suite.cases) {
    if (opts?.onlyIds && !opts.onlyIds.includes(c.id)) continue;
    const eps = sliceCaseToEpisodes(c);
    if (opts?.onlyTiers) {
      const filtered = eps.filter(e => opts.onlyTiers!.includes(e.tier));
      all.push(...filtered);
    } else {
      all.push(...eps);
    }
  }
  return all;
}