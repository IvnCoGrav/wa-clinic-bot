/**
 * scripts/build-episode-fixture.ts — Generator Episode Fixture dari Test Suite V2.
 *
 * Input: tests/fixtures/test-suite-v2.json (119 kasus existing)
 * Output: tests/fixtures/test-suite-episodes.json (episode atomik 2-5 turn)
 *
 * Diprioritaskan dari evidence-map (Phase 0): 43 inkonsisten + 51 panjang + RF/ADV.
 * PII: reuse anonymizeText/scrubAddressNumbers + gate RAW_PHONE_RE/RAW_EMAIL_RE.
 *
 * Jalankan: npx tsx scripts/build-episode-fixture.ts
 */

import fs from 'fs';
import path from 'path';
import {
  sliceSuiteToEpisodes,
  EpisodeSchema,
  EpisodeExpectedBehaviorSchema,
  EpisodeTier,
  type Episode,
} from './lib/conversation-episode-slicer';
import {
  TestSuiteV2Schema,
  RAW_PHONE_RE,
  RAW_EMAIL_RE,
} from '../tests/fixtures/test-suite-v2.schema';

// ============ Reuse PII helpers dari build-test-suite-v2.ts ============

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  return digits;
}

const PHONE_RE = /(?:\+?62[\s-]?\d{9,13}|\b628\d{8,12}\b|\b08\d{8,12}\b)/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;

function scrubAddressNumbers(s: string): string {
  return s
    .replace(/\b(?:no|nomor|nmr)\.?\s*(?:hp|telp|tel|wa(?:tsap)?|whatsapp)\b/gi, 'HP')
    .replace(/\b(?:no|nomor|nmr)\.?[:\s]*(?:rumah|blok|unit)?\s*\d[\dA-Za-z-./]*\b/gi, '(no.disamarkan)')
    .replace(/\brt\s*\d{1,3}\s*(?:[/,]?\s*rw\s*\d{1,3})?\b/gi, 'RT/RW disamarkan')
    .replace(/\brw\s*\d{1,3}\b/gi, 'RW disamarkan');
}

function anonymizeText(text: string, caseId3: string, phoneMap: Map<string, string>): string {
  let out = text.replace(PHONE_RE, (tok) => {
    const norm = normalizePhone(tok);
    let place = phoneMap.get(norm);
    if (!place) {
      const altNo = phoneMap.size;
      place = `628XXXXXXXXX_${caseId3}${altNo === 0 ? '' : `_alt${altNo}`}`;
      phoneMap.set(norm, place);
    }
    return place;
  });
  out = out.replace(EMAIL_RE, '[surel-disunting]');
  out = scrubAddressNumbers(out);
  return out;
}

function anonymizeEpisodeTurns(turns: string[], caseId: string): string[] {
  const caseId3 = caseId.replace(/^(CASE|RF|CX|ADV|OPS)-/, '');
  const phoneMap = new Map<string, string>();
  return turns.map(t => anonymizeText(t, caseId3, phoneMap));
}

// ============ Priority mapping untuk evidence-based selection ============

interface EvidenceMapEntry {
  caseId: string;
  reason: string[];
  priority: number; // lebih tinggi = lebih penting
}

function loadEvidenceMap(): EvidenceMapEntry[] {
  const mapPath = path.join(__dirname, '..', 'test-results', 'evidence-map.md');
  if (!fs.existsSync(mapPath)) {
    // Fallback: prioritas default dari analisis awal
    return [];
  }
  // Parse markdown sederhana (opsional, bisa di-skip)
  return [];
}

function computePriority(caseId: string, flowCategory: string, totalTurns: number, hasResvFields: boolean, expectedFinal: string): number {
  let score = 0;
  // RF/ADV/CX/OPS selalu prioritas tinggi
  if (['RF-', 'ADV-', 'CX-', 'OPS-'].some(p => caseId.startsWith(p))) score += 100;
  // Inkonsisten: resvFields + AWAITING_INTEREST
  if (hasResvFields && expectedFinal === 'AWAITING_INTEREST') score += 50;
  // Panjang (>20 turn)
  if (totalTurns >= 20) score += 30;
  // Medis/klinis
  if (flowCategory.toLowerCase().includes('medis') || flowCategory.toLowerCase().includes('clinical')) score += 20;
  return score;
}

async function main() {
  const ROOT = path.join(__dirname, '..');
  const IN_SUITE = path.join(ROOT, 'tests', 'fixtures', 'test-suite-v2.json');
  const OUT_EPISODES = path.join(ROOT, 'tests', 'fixtures', 'test-suite-episodes.json');

  console.log('[BUILD] Membaca test-suite-v2.json...');
  const raw = fs.readFileSync(IN_SUITE, 'utf8');
  const parsed = JSON.parse(raw);
  const suiteParse = TestSuiteV2Schema.safeParse(parsed);
  if (!suiteParse.success) {
    console.error('[FATAL] Fixture V2 tidak valid:', JSON.stringify(suiteParse.error.issues.slice(0, 3), null, 2));
    process.exit(1);
  }
  const { meta, cases } = suiteParse.data;
  console.log(`[BUILD] Loaded ${cases.length} kasus (meta.version=${meta.version}, tenant=${meta.tenant_id})`);

  // Prioritaskan kasus evidence-based
  const prioritized = cases
    .map(c => ({
      ...c,
      _priority: computePriority(c.id, c.flowCategory, c.totalTurns,
        !!(c.expected_behavior?.expected_reservation_fields),
        c.expected_behavior?.expected_final_state || 'AWAITING_INTEREST'
      ),
    }))
    .sort((a, b) => b._priority - a._priority);

  console.log('[BUILD] Top-10 prioritas:');
  prioritized.slice(0, 10).forEach((c, i) => console.log(`  ${i+1}. ${c.id} (${c.flowCategory}) turns=${c.totalTurns} priority=${c._priority}`));

  // Slice semua kasus (bisa difilter nanti via runner)
  console.log('[BUILD] Slicing ke episode atomik...');
  const episodes = sliceSuiteToEpisodes(suiteParse.data, {});
  console.log(`[BUILD] Hasil: ${episodes.length} episode`);

  // Anonimisasi PII per episode
  console.log('[BUILD] Anonimisasi PII...');
  let piiPhoneHits = 0;
  let piiEmailHits = 0;
  for (const ep of episodes) {
    const anonTurns = anonymizeEpisodeTurns(ep.customerDialogueFlow, ep.sourceCaseId);
    ep.customerDialogueFlow = anonTurns;
    // Gate PII
    for (const t of anonTurns) {
      const phoneHits = t.match(RAW_PHONE_RE)?.length || 0;
      const emailHits = t.match(RAW_EMAIL_RE)?.length || 0;
      piiPhoneHits += phoneHits;
      piiEmailHits += emailHits;
    }
  }
  console.log(`[BUILD] PII gate: RAW_PHONE_RE=${piiPhoneHits} hit, RAW_EMAIL_RE=${piiEmailHits} hit`);
  if (piiPhoneHits > 0 || piiEmailHits > 0) {
    console.error('[FATAL] Kebocoran PII di episode fixture!');
    process.exit(1);
  }

  // Validasi schema per episode
  console.log('[BUILD] Validasi schema Episode...');
  const validEpisodes: Episode[] = [];
  for (const ep of episodes) {
    const res = EpisodeSchema.safeParse(ep);
    if (!res.success) {
      console.error(`[FATAL] Episode ${ep.episodeId} invalid:`, JSON.stringify(res.error.issues.slice(0, 3), null, 2));
      process.exit(1);
    }
    validEpisodes.push(res.data);
  }

  // Statistik tier
  const tierCount: Record<EpisodeTier, number> = {
    'TIER1_NORMAL_INQUIRY': 0,
    'TIER1_LOCATION_FEE': 0,
    'TIER1_BOOKING_FLOW': 0,
    'TIER2_LINGUISTIC_TYPO_SLANG': 0,
    'TIER2_BURST_AND_AMBIGUOUS': 0,
    'TIER3_CLINICAL_SYMPTOM_SOP': 0,
    'TIER3_POST_VACCINE_OR_AGE': 0,
    'TIER4_SCHEDULE_CONFLICT_RESCHEDULE': 0,
    'TIER4_PRICE_NEGOTIATION_OR_DISPUTE': 0,
    'TIER5_RED_FLAG_EMERGENCY': 0,
    'TIER5_SECURITY_ADVERSARIAL': 0,
  };
  for (const ep of validEpisodes) tierCount[ep.tier]++;
  console.log('[BUILD] Distribusi Tier:');
  for (const [tier, cnt] of Object.entries(tierCount)) {
    if (cnt > 0) console.log(`  ${tier}: ${cnt}`);
  }

  // Output fixture
  const outFixture = {
    meta: {
      version: '2.0-episodes',
      generated_at: new Date().toISOString(),
      tenant_id: meta.tenant_id,
      source_version: meta.version,
      source_total_cases: cases.length,
      total_episodes: validEpisodes.length,
      tier_distribution: tierCount,
    },
    episodes: validEpisodes,
  };

  fs.writeFileSync(OUT_EPISODES, JSON.stringify(outFixture, null, 2), 'utf8');
  console.log(`[BUILD] Selesai → ${OUT_EPISODES}`);
}

main().catch(e => {
  console.error('[FATAL]', e);
  process.exit(1);
});