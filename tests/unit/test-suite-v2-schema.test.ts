/**
 * test-suite-v2-schema.test.ts — Validasi kontrak dataset pengujian v2.
 *
 * Fase 0 (red): fixture belum ada → test merah (red baseline TDD yang diharapkan).
 * Fase 1 (green): setelah `scripts/build-test-suite-v2.ts` menghasilkan fixture.
 *
 * Komentar Bahasa Indonesia (konsisten repo).
 */
import { describe, it, expect, skip } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  TestSuiteV2Schema,
  EpisodesFixtureSchema,
  RAW_PHONE_RE,
  RAW_EMAIL_RE,
} from '../fixtures/test-suite-v2.schema';

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'test-suite-v2.json');
const EPISODES_FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'test-suite-episodes.json');

// Load data at module level (sync) so tests see it
function loadV2() {
  if (!fs.existsSync(FIXTURE_PATH)) return null;
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const result = TestSuiteV2Schema.safeParse(parsed);
  return result.success ? result.data : null;
}

function loadEpisodes() {
  if (!fs.existsSync(EPISODES_FIXTURE_PATH)) return null;
  const raw = fs.readFileSync(EPISODES_FIXTURE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const result = EpisodesFixtureSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

const tsv2Data = loadV2();
const episodesData = loadEpisodes();

describe('test-suite-v2.json — integritas dataset', () => {
  it('file fixture tersedia', () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);
  });

  it('json fixture valid terhadap schema', () => {
    expect(tsv2Data).not.toBeNull();
  });

  if (!tsv2Data) {
    it('skipped — test-suite-v2.json not loaded', () => skip('test-suite-v2.json not loaded'));
  } else {
    const { meta, cases } = tsv2Data;

    it('total kasus tepat 119 (100 asli + 19 baru)', () => {
      expect(cases.length).toBe(119);
      expect(meta.total).toBe(119);
      expect(meta.total).toBe(cases.length);
    });

    it('id unik dan mengikuti pola prefix terdaftar', () => {
      const ids = cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      const prefixes = new Set(ids.map((id) => id.split('-')[0]));
      expect([...prefixes].every((p) => ['CASE', 'RF', 'CX', 'ADV', 'OPS'].includes(p))).toBe(true);
    });

    it('100 kasus asli ber-id CASE-001..CASE-100 dan punya source_id 1..100; 19 kasus baru source_id null', () => {
      const source = cases.filter((c) => c.id.startsWith('CASE-'));
      const added = cases.filter((c) => !c.id.startsWith('CASE-'));
      expect(source).toHaveLength(100);
      expect(added).toHaveLength(19);
      expect(source.map((c) => c.source_id).sort((a: any, b: any) => a - b)).toEqual(
        Array.from({ length: 100 }, (_, i) => i + 1)
      );
      expect(added.every((c) => c.source_id === null)).toBe(true);
    });

    it('tiap kasus punya tenant_id, flowCategory, caseObjective, dan customerDialogueFlow non-kosong', () => {
      for (const c of cases) {
        expect(c.tenant_id.length).toBeGreaterThan(0);
        expect(c.flowCategory.length).toBeGreaterThan(0);
        expect(c.caseObjective.length).toBeGreaterThan(0);
        expect(c.customerDialogueFlow.length).toBeGreaterThanOrEqual(1);
        expect(c.customerDialogueFlow.every((t) => t.trim().length > 0)).toBe(true);
      }
    });

    it('kasus red-flag (RF) dan adversarial (ADV) wajib punya ≥3 parafrase', () => {
      const multi = cases.filter((c) => /^(RF|ADV)-\d{2}$/.test(c.id));
      expect(multi.length).toBeGreaterThanOrEqual(12);
      for (const c of multi) {
        expect(c.paraphrases?.length ?? 0, `${c.id} butuh ≥3 parafrase`).toBeGreaterThanOrEqual(3);
      }
    });

    it('tidak ada nomor HP asli atau email bocor di fixture (PII hygiene)', () => {
      const serialized = JSON.stringify(cases);
      const leaks = [
        ...(serialized.match(RAW_PHONE_RE) ?? []),
        ...(serialized.match(RAW_EMAIL_RE) ?? []),
      ];
      expect(leaks).toEqual([]);
    });

    it('nomor HP placeholder mengikuti pola 628XXXXXXXXX_caseXXX', () => {
      const serialized = JSON.stringify(cases);
      const placeholders = serialized.match(/628X{9}_case\d{3}/g) ?? [];
      expect(placeholders.length).toBeGreaterThanOrEqual(1);
      expect(serialized.match(/\b62\d{9}\b/g) ?? []).toEqual([]);
    });
  }
});

describe('test-suite-episodes.json — integritas episode atomik', () => {
  it('file fixture episode tersedia', () => {
    expect(fs.existsSync(EPISODES_FIXTURE_PATH)).toBe(true);
  });

  it('json fixture episode valid terhadap schema', () => {
    expect(episodesData).not.toBeNull();
  });

  if (!episodesData) {
    it('skipped — test-suite-episodes.json not loaded', () => skip('test-suite-episodes.json not loaded'));
  } else {
    const { meta, episodes } = episodesData;

    it('meta version = 2.0-episodes dan total_episodes konsisten', () => {
      expect(meta.version).toBe('2.0-episodes');
      expect(meta.total_episodes).toBe(episodes.length);
      expect(meta.tenant_id.length).toBeGreaterThan(0);
    });

    it('episodeId unik dan mengikuti pola {CASE|RF|CX|ADV|OPS}-XXX_EPnn', () => {
      const ids = episodes.map((e) => e.episodeId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id).toMatch(/^(CASE-\d{3}|RF-\d{2}|CX-\d{2}|ADV-\d{2}|OPS-\d{2})_EP\d{2}$/);
      }
    });

    it('sourceCaseId valid dan episodeIndex berurutan per kasus induk', () => {
      const bySource = new Map<string, number[]>();
      for (const e of episodes) {
        const arr = bySource.get(e.sourceCaseId) || [];
        arr.push(e.episodeIndex);
        bySource.set(e.sourceCaseId, arr);
      }
      for (const [sourceId, indices] of bySource) {
        const sorted = [...indices].sort((a, b) => a - b);
        expect(indices).toEqual(sorted);
        expect(indices[0]).toBe(0);
      }
    });

    it('customerDialogueFlow 2-5 turn per episode', () => {
      for (const e of episodes) {
        expect(e.customerDialogueFlow.length).toBeGreaterThanOrEqual(2);
        expect(e.customerDialogueFlow.length).toBeLessThanOrEqual(5);
        expect(e.customerDialogueFlow.every((t) => t.trim().length > 0)).toBe(true);
      }
    });

    it('tiap episode punya tier valid', () => {
      const validTiers = [
        'TIER1_NORMAL_INQUIRY', 'TIER1_LOCATION_FEE', 'TIER1_BOOKING_FLOW',
        'TIER2_LINGUISTIC_TYPO_SLANG', 'TIER2_BURST_AND_AMBIGUOUS',
        'TIER3_CLINICAL_SYMPTOM_SOP', 'TIER3_POST_VACCINE_OR_AGE',
        'TIER4_SCHEDULE_CONFLICT_RESCHEDULE', 'TIER4_PRICE_NEGOTIATION_OR_DISPUTE',
        'TIER5_RED_FLAG_EMERGENCY', 'TIER5_SECURITY_ADVERSARIAL',
      ];
      for (const e of episodes) {
        expect(validTiers).toContain(e.tier);
      }
    });

    it('tidak ada nomor HP asli atau email bocor di fixture episode (PII hygiene)', () => {
      const serialized = JSON.stringify(episodes);
      const leaks = [
        ...(serialized.match(RAW_PHONE_RE) ?? []),
        ...(serialized.match(RAW_EMAIL_RE) ?? []),
      ];
      expect(leaks).toEqual([]);
    });

    it('seedTurnIds konsisten dengan panjang customerDialogueFlow', () => {
      for (const e of episodes) {
        expect(e.seedTurnIds.length).toBe(e.customerDialogueFlow.length);
        expect(e.seedTurnIds.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
      }
    });

    it('distribusi tier di meta konsisten dengan episode', () => {
      const counted: Record<string, number> = {};
      for (const e of episodes) counted[e.tier] = (counted[e.tier] || 0) + 1;
      for (const [tier, cnt] of Object.entries(meta.tier_distribution)) {
        expect(counted[tier] ?? 0).toBe(cnt);
      }
    });
  }
});