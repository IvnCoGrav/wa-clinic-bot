/**
 * test-suite-v2-schema.test.ts — Validasi kontrak dataset pengujian v2.
 *
 * Fase 0 (red): fixture belum ada → test merah (red baseline TDD yang diharapkan).
 * Fase 1 (green): setelah `scripts/build-test-suite-v2.ts` menghasilkan fixture.
 *
 * Komentar Bahasa Indonesia (konsisten repo).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  TestSuiteV2Schema,
  RAW_PHONE_RE,
  RAW_EMAIL_RE,
} from '../fixtures/test-suite-v2.schema';

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'test-suite-v2.json');

describe('test-suite-v2.json — integritas dataset', () => {
  let raw: string | null = null;
  let tsv2: ReturnType<typeof TestSuiteV2Schema['safeParse']> | null = null;

  it('file fixture tersedia', () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);
    raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
  });

  it('json fixture valid terhadap schema', () => {
    if (raw == null) return; // sudah gagal di test sebelumnya
    const parsed = JSON.parse(raw);
    tsv2 = TestSuiteV2Schema.safeParse(parsed);
    expect(tsv2.success, tsv2.success ? '' : JSON.stringify(tsv2.error.issues.slice(0, 3))).toBe(true);
  });

  if (tsv2 == null) return;

  const { meta, cases } = tsv2.data;

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
    // Placeholder TIDAK boleh lolos sebagai nomor asli (harus tetap mengandung X)
    expect(serialized.match(/\b62\d{9}\b/g) ?? []).toEqual([]);
  });
});