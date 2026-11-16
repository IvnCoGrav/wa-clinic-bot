import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { collectMetrics, generateReport, readJsonStrict, BASELINE_DIR, ROOT_DIR } from '../../scripts/reuse/report-reuse.mjs';

describe('Report Reuse Dynamic Data-Driven (Fase 7 - P2)', () => {
  it('reads real baseline numbers directly without hardcoded fallbacks', () => {
    const metrics = collectMetrics();

    // Pastikan angka sesuai dengan data aktual di JSON
    const deadJson = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, 'dead-exports.json'), 'utf8'));
    const forbiddenJson = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, 'forbidden-declarations.json'), 'utf8'));
    const archJson = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, 'architecture.json'), 'utf8'));

    expect(metrics.deadExports).toBe(deadJson.deadExports.length);
    expect(metrics.forbiddenDeclarations).toBe(forbiddenJson.violations.length);
    expect(metrics.prismaRouteCalls).toBe(archJson.prismaBudget.totalCalls);
    expect(metrics.architectureCycles).toBe(archJson.cycles.length);
  });

  it('fails loudly when a baseline file is missing (no silent fallback)', () => {
    const emptyTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-empty-'));
    expect(() => collectMetrics(emptyTempDir, ROOT_DIR)).toThrowError(/File baseline tidak ditemukan/);
    fs.rmSync(emptyTempDir, { recursive: true, force: true });
  });

  it('fails loudly when a baseline file is missing required keys', () => {
    const corruptTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-corrupt-'));
    // Buat file yang tidak memiliki key deadExports
    fs.writeFileSync(path.join(corruptTempDir, 'duplication.json'), JSON.stringify({ groups: [] }));
    fs.writeFileSync(path.join(corruptTempDir, 'forbidden-declarations.json'), JSON.stringify({ violations: [] }));
    fs.writeFileSync(path.join(corruptTempDir, 'file-size.json'), JSON.stringify({ files: [] }));
    fs.writeFileSync(path.join(corruptTempDir, 'dead-exports.json'), JSON.stringify({ wrongKey: [] })); // missing deadExports!
    fs.writeFileSync(path.join(corruptTempDir, 'architecture.json'), JSON.stringify({ prismaBudget: { totalCalls: 0 }, cycles: [] }));

    expect(() => collectMetrics(corruptTempDir, ROOT_DIR)).toThrowError(/Kunci wajib "deadExports" tidak ditemukan/);
    fs.rmSync(corruptTempDir, { recursive: true, force: true });
  });

  it('dynamically reflects changes when baseline data changes', () => {
    const mockBaselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-mock-'));

    fs.writeFileSync(path.join(mockBaselineDir, 'duplication.json'), JSON.stringify({
      version: 1,
      groups: [{ hash: 'sha:1' }, { hash: 'sha:2' }] // 2 groups
    }));
    fs.writeFileSync(path.join(mockBaselineDir, 'forbidden-declarations.json'), JSON.stringify({
      version: 1,
      violations: [{ name: 'bannedA' }] // 1 violation
    }));
    fs.writeFileSync(path.join(mockBaselineDir, 'file-size.json'), JSON.stringify({
      version: 1,
      files: [{ file: 'large.ts', lines: 1600 }] // 1 file
    }));
    fs.writeFileSync(path.join(mockBaselineDir, 'dead-exports.json'), JSON.stringify({
      version: 1,
      deadExports: [{ name: 'expA' }, { name: 'expB' }, { name: 'expC' }] // 3 exports
    }));
    fs.writeFileSync(path.join(mockBaselineDir, 'architecture.json'), JSON.stringify({
      version: 1,
      cycles: [['a.ts', 'b.ts']], // 1 cycle
      prismaBudget: { totalCalls: 123, files: {} } // 123 calls
    }));

    const result = generateReport(mockBaselineDir, ROOT_DIR);
    expect(result.current.duplicationGroups).toBe(2);
    expect(result.current.forbiddenDeclarations).toBe(1);
    expect(result.current.filesOver1500).toBe(1);
    expect(result.current.deadExports).toBe(3);
    expect(result.current.architectureCycles).toBe(1);
    expect(result.current.prismaRouteCalls).toBe(123);

    // Delta harus terhitung otomatis:
    // awal: 285, sekarang: 123 -> delta: -162
    const prismaRow = result.rows.find(r => r.kategori === 'Panggilan Prisma di Rute');
    expect(prismaRow).toBeDefined();
    expect(prismaRow?.sekarang).toBe(123);
    expect(prismaRow?.sekarang - prismaRow?.awal).toBe(123 - 285);

    fs.rmSync(mockBaselineDir, { recursive: true, force: true });
  });
});
