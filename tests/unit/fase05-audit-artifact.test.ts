import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * S-10 — gerbang audit Fase 5 (staff web app).
 *
 * Temuan lama: laporan mengklaim "7 file suites, 16 tests", tetapi artefak
 * `fase-05.json` hanya berisi 1 file/16 test dan path-nya dari mesin lain
 * (`C:/Users/Ivan/...`). Test ini mengunci artefak agar selalu konsisten
 * dengan repo & laporan, sehingga klaim tidak bisa melenceng lagi.
 */
describe('S-10 artefak audit Fase 5', () => {
  const root = process.cwd();
  const artifactPath = path.join(root, 'docs/audit/2026-11-02/fase-05.json');
  const reportPath = path.join(root, 'docs/audit/2026-11-02/fase-05/LAPORAN_FASE_05.md');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const report = fs.readFileSync(reportPath, 'utf8');
  const files: string[] = (artifact.testResults ?? []).map((r: any) => String(r.name));

  it('artefak fase-05 konsisten dengan laporan (jumlah file & test)', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    expect(artifact.numTotalTests).toBe(150);
    expect(artifact.numPassedTests).toBe(150);
    expect(artifact.numFailedTests).toBe(0);
    expect(report).toContain('15 file suites, 150 tests passed');
  });

  it('semua path artefak berasal dari repo ini (bukan mesin lain)', () => {
    for (const name of files) {
      const normalized = name.replace(/\\/g, '/');
      // Artefak auditable dipakai lintas mesin (lokal & CI), jadi path wajib
      // relatif terhadap root repo. Path absolut menandakan artefak dibuat di
      // mesin lain dan tidak bisa diverifikasi di mesin ini.
      expect(/^([A-Za-z]:\/|\/)/.test(normalized), `path absolut mesin lain: ${name}`).toBe(false);
      expect(normalized).toContain('tests/unit/');
      expect(fs.existsSync(path.join(root, normalized)), `file tidak ada di repo: ${name}`).toBe(true);
    }
  });

  it('laporan tidak lagi memuat klaim lama 7 suite/16 test', () => {
    expect(report).not.toContain('7 file suites, 16 tests');
    expect(report).toContain('S-10');
  });
});
