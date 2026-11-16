import { describe, it, expect } from 'vitest';
import {
  findReuseBaselineIncreases,
  findArchitectureBaselineIncreases
} from '../../scripts/reuse/lib/baseline-ratchet.mjs';

/**
 * Uji adversarial gerbang integritas baseline: setiap KENAIKAN (termasuk
 * pertukaran item lama dengan item baru berjumlah sama) wajib terdeteksi.
 */
describe('baseline-ratchet — anti kenaikan terselubung', () => {
  const emptyReuse = { duplicationGroups: [], structuralGroups: [], forbiddenViolations: [], deadExports: [], largeFiles: [] };

  it('baseline kosong + tidak ada pelanggaran → aman', () => {
    const increases = findReuseBaselineIncreases(
      { duplication: { groups: [] }, forbidden: { violations: [] }, deadExports: { deadExports: [] }, fileSize: { files: [] } },
      emptyReuse
    );
    expect(increases).toEqual([]);
  });

  it('duplikasi fungsi baru terdeteksi walau jumlah grup sama (tukar hash)', () => {
    const prev = {
      duplication: {
        groups: [{ hash: 'sha256:lama', files: [{ file: 'a.ts' }] }],
        structuralGroups: []
      },
      forbidden: { violations: [] },
      deadExports: { deadExports: [] },
      fileSize: { files: [] }
    };
    const cur = {
      ...emptyReuse,
      duplicationGroups: [{ hash: 'sha256:baru', files: [{ file: 'b.ts', line: 1 }] }]
    };
    const increases = findReuseBaselineIncreases(prev, cur);
    expect(increases.map((i) => i.category)).toContain('duplikasi fungsi');
  });

  it('duplikasi struktural baru terdeteksi', () => {
    const prev = { duplication: { groups: [], structuralGroups: [] }, forbidden: { violations: [] }, deadExports: { deadExports: [] }, fileSize: { files: [] } };
    const cur = {
      ...emptyReuse,
      structuralGroups: [{ structHash: 'sha256:x', tokenCount: 50, files: [{ file: 'x.ts', line: 2 }] }]
    };
    expect(findReuseBaselineIncreases(prev, cur).map((i) => i.category)).toContain('duplikasi struktural');
  });

  it('deklarasi terlarang baru terdeteksi walau jumlah sama', () => {
    const prev = {
      duplication: { groups: [], structuralGroups: [] },
      forbidden: { violations: [{ capabilityId: 'a', name: 'x', file: 'f1.ts' }] },
      deadExports: { deadExports: [] },
      fileSize: { files: [] }
    };
    const cur = {
      ...emptyReuse,
      forbiddenViolations: [{ capabilityId: 'a', name: 'y', file: 'f2.ts' }]
    };
    expect(findReuseBaselineIncreases(prev, cur).map((i) => i.category)).toContain('deklarasi terlarang');
  });

  it('dead export baru terdeteksi walau jumlah sama', () => {
    const prev = {
      duplication: { groups: [], structuralGroups: [] },
      forbidden: { violations: [] },
      deadExports: { deadExports: [{ file: 'a.ts', name: 'lama' }] },
      fileSize: { files: [] }
    };
    const cur = { ...emptyReuse, deadExports: [{ file: 'b.ts', name: 'baru' }] };
    expect(findReuseBaselineIncreases(prev, cur).map((i) => i.category)).toContain('dead export');
  });

  it('file raksasa yang bertambah panjang terdeteksi', () => {
    const prev = {
      duplication: { groups: [], structuralGroups: [] },
      forbidden: { violations: [] },
      deadExports: { deadExports: [] },
      fileSize: { files: [{ file: 'big.ts', lines: 1600 }] }
    };
    const cur = { ...emptyReuse, largeFiles: [{ file: 'big.ts', lines: 1601 }] };
    expect(findReuseBaselineIncreases(prev, cur).map((i) => i.category)).toContain('file > batas baris');
  });

  it('siklus import baru terdeteksi walau jumlah siklus sama', () => {
    const prev = { cycles: [['a.ts', 'b.ts']], layerViolations: [], adminIntegrations: [], prismaBudget: { totalCalls: 1, files: { 'r.ts': 1 } } };
    const cur = { cycles: [['a.ts', 'c.ts']], layerViolations: [], adminIntegrations: [], prismaBudget: { totalCalls: 1, files: { 'r.ts': 1 } } };
    expect(findArchitectureBaselineIncreases(prev, cur).map((i) => i.category)).toContain('siklus import');
  });

  it('panggilan Prisma per file yang naik terdeteksi', () => {
    const prev = { cycles: [], layerViolations: [], adminIntegrations: [], prismaBudget: { totalCalls: 5, files: { 'r.ts': 5 } } };
    const cur = { ...prev, prismaBudget: { totalCalls: 5, files: { 'r.ts': 5, 'baru.ts': 1 } } };
    // total tetap 5 (data tidak konsisten), tetapi file baru tetap harus terdeteksi.
    expect(findArchitectureBaselineIncreases(prev, cur).map((i) => i.category)).toContain('panggilan Prisma di route');
  });

  it('baseline yang turun / sama tidak dianggap kenaikan', () => {
    const prev = {
      cycles: [['a.ts', 'b.ts']],
      layerViolations: [{ rule: 'R', file: 'f.ts', target: 't.ts' }],
      adminIntegrations: [{ file: 'a', target: 'b' }],
      prismaBudget: { totalCalls: 10, files: { 'r.ts': 10 } }
    };
    const cur = {
      cycles: [],
      layerViolations: [],
      adminIntegrations: [],
      prismaBudget: { totalCalls: 9, files: { 'r.ts': 9 } }
    };
    expect(findArchitectureBaselineIncreases(prev, cur)).toEqual([]);
  });
});
