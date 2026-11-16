import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures/reuse-gate');
const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/reuse/check-reuse.mjs');

function runGate(args: string[] = []) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: 'utf8'
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    json: tryParseJson(result.stdout || '')
  };
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

describe('Reuse Gate Self-Test & Adversarial Checks (Fase 2)', () => {
  it('1. Dua fungsi identik di dua file berbeda memicu kegagalan DUPLICATE_FUNCTION', () => {
    const res = runGate([
      `--root=${FIXTURES_DIR}`,
      '--only=duplication',
      '--json'
    ]);

    expect(res.status).toBe(1);
    expect(res.json).toBeDefined();
    expect(res.json.passed).toBe(false);

    const dupViolations = res.json.newViolations.filter((v: any) => v.type === 'DUPLICATE_FUNCTION');
    expect(dupViolations.length).toBeGreaterThan(0);
    expect(dupViolations[0].files.some((f: any) => f.file.includes('duplicate-a'))).toBe(true);
    expect(dupViolations[0].files.some((f: any) => f.file.includes('duplicate-b'))).toBe(true);
  });

  it('2. Banned declaration memicu kegagalan FORBIDDEN_DECLARATION', () => {
    const res = runGate([
      `--root=${FIXTURES_DIR}`,
      '--only=forbidden',
      '--json'
    ]);

    expect(res.status).toBe(1);
    expect(res.json).toBeDefined();

    const banned = res.json.newViolations.find((v: any) => v.type === 'FORBIDDEN_DECLARATION');
    expect(banned).toBeDefined();
    expect(banned.name).toBe('isClinicLocationQuestion');
    expect(banned.file).toContain('banned.fixture.ts');
  });

  it('3. Unused export memicu kegagalan DEAD_EXPORT', () => {
    const res = runGate([
      `--root=${FIXTURES_DIR}`,
      '--only=dead-exports',
      '--json'
    ]);

    expect(res.status).toBe(1);
    expect(res.json).toBeDefined();

    const dead = res.json.newViolations.find((v: any) => v.type === 'DEAD_EXPORT' && v.name === 'completelyUnusedFunctionXYZ123');
    expect(dead).toBeDefined();
    expect(dead.file).toContain('unused-export.fixture.ts');
  });

  it('4. File melebihi kuota baris memicu kegagalan FILE_TOO_LARGE', () => {
    // oversized.fixture.ts memiliki ~35 baris, uji dengan max-lines=20
    const res = runGate([
      `--root=${FIXTURES_DIR}`,
      '--only=file-size',
      '--max-lines=20',
      '--json'
    ]);

    expect(res.status).toBe(1);
    expect(res.json).toBeDefined();

    const large = res.json.newViolations.find((v: any) => v.type === 'FILE_TOO_LARGE' && v.file.includes('oversized.fixture.ts'));
    expect(large).toBeDefined();
    expect(large.lines).toBeGreaterThan(20);
  });

  it('5. Clean fixture lolos evaluasi dengan exit 0 jika diisolasi', () => {
    const tempCleanDir = path.resolve(process.cwd(), 'tests/fixtures/reuse-gate-temp-clean');
    if (!fs.existsSync(tempCleanDir)) fs.mkdirSync(tempCleanDir, { recursive: true });

    const cleanSource = fs.readFileSync(path.resolve(FIXTURES_DIR, 'clean.fixture.ts'), 'utf8');
    fs.writeFileSync(path.resolve(tempCleanDir, 'clean.fixture.ts'), cleanSource, 'utf8');

    try {
      const res = runGate([
        `--root=${tempCleanDir}`,
        '--only=duplication',
        '--json'
      ]);

      expect(res.status).toBe(0);
      expect(res.json.passed).toBe(true);
      expect(res.json.newViolations).toHaveLength(0);
    } finally {
      fs.rmSync(tempCleanDir, { recursive: true, force: true });
    }
  });

  it('6. Re-export modul yang sah tidak dianggap sebagai dead export / duplikasi', () => {
    const tempDir = path.resolve(process.cwd(), 'tests/fixtures/reuse-gate-temp-reexport');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    fs.copyFileSync(path.resolve(FIXTURES_DIR, 'clean.fixture.ts'), path.resolve(tempDir, 'clean.fixture.ts'));
    fs.copyFileSync(path.resolve(FIXTURES_DIR, 'allowed-reexport.fixture.ts'), path.resolve(tempDir, 'allowed-reexport.fixture.ts'));

    try {
      const res = runGate([
        `--root=${tempDir}`,
        '--only=duplication',
        '--json'
      ]);

      expect(res.status).toBe(0);
      expect(res.json.passed).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('7. Salinan yang variabelnya diganti nama MENGGAGALKAN gate (STRUCTURAL_DUPLICATION), bukan sekadar peringatan', () => {
    const tempDir = path.resolve(process.cwd(), 'tests/fixtures/reuse-gate-temp-renamed');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    fs.copyFileSync(path.resolve(FIXTURES_DIR, 'clean.fixture.ts'), path.resolve(tempDir, 'clean.fixture.ts'));
    fs.copyFileSync(path.resolve(FIXTURES_DIR, 'renamed-copy.fixture.ts'), path.resolve(tempDir, 'renamed-copy.fixture.ts'));

    try {
      const res = runGate([
        `--root=${tempDir}`,
        '--only=duplication',
        '--json'
      ]);

      // Hash exact berbeda (nama variabel beda), jadi bukan DUPLICATE_FUNCTION…
      expect(res.status).toBe(1);
      expect(res.json.passed).toBe(false);
      const types = res.json.newViolations.map((v: any) => v.type);
      expect(types).toContain('STRUCTURAL_DUPLICATION');
      expect(types).not.toContain('DUPLICATE_FUNCTION');

      // …tetapi pola strukturalnya tetap terdeteksi.
      expect(res.json.summary.structuralWarnings).toBeGreaterThan(0);
      expect(res.json.structuralWarnings.some((w: any) =>
        w.files.some((f: any) => f.file.includes('clean.fixture.ts')) &&
        w.files.some((f: any) => f.file.includes('renamed-copy.fixture.ts'))
      )).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('8. Adversarial: --update-baseline tanpa --allow-update wajib gagal (exit 1)', () => {
    const res = runGate([
      '--update-baseline'
    ]);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('--allow-update');
  });

  it('9. Mode --warn selalu exit 0 meskipun ada pelanggaran baru', () => {
    const res = runGate([
      `--root=${FIXTURES_DIR}`,
      '--only=duplication',
      '--warn',
      '--json'
    ]);

    expect(res.status).toBe(0);
    expect(res.json.passed).toBe(true);
    expect(res.json.warnMode).toBe(true);
    expect(res.json.newViolations.length).toBeGreaterThan(0);
  });

  it('10. Gate pada repo nyata (src/) berjalan < 60 detik dan 0 pelanggaran baru', () => {
    const startTime = Date.now();
    const res = runGate([
      '--root=src',
      '--json'
    ]);
    const duration = Date.now() - startTime;

    expect(res.status).toBe(0);
    expect(res.json.passed).toBe(true);
    expect(res.json.summary.newViolations).toBe(0);
    // Batas waktu harus tahan terhadap suite paralel penuh (CPU contention):
    // gate di mesin ini 18–45 dtk tergantung beban, jadi 60 dtk tetap menjaga
    // deteksi "menggantung" tanpa false-failure saat `npm test` penuh.
    expect(duration).toBeLessThan(60000);
  });

  it('11. Interface atau type baru yang tidak dipakai TIDAK dianggap DEAD_EXPORT (pass)', () => {
    const tempDir = path.resolve(process.cwd(), 'tests/fixtures/reuse-gate-temp-interface');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const code = `
export interface CompletelyUnusedInterfaceContractXYZ {
  id: string;
  count: number;
}
export type CompletelyUnusedTypeAliasXYZ = 'alpha' | 'beta';
`;
    fs.writeFileSync(path.resolve(tempDir, 'types-only.fixture.ts'), code, 'utf8');

    try {
      const res = runGate([
        `--root=${tempDir}`,
        '--only=dead-exports',
        '--json'
      ]);

      expect(res.status).toBe(0);
      expect(res.json.passed).toBe(true);
      expect(res.json.newViolations).toHaveLength(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('12. Function / variable / class baru yang tidak dipakai WAJIB memicu DEAD_EXPORT (fail)', () => {
    const tempDir = path.resolve(process.cwd(), 'tests/fixtures/reuse-gate-temp-runtime-dead');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const code = `
export function completelyUnusedRuntimeFunctionXYZ() {
  return 'unused';
}
export const completelyUnusedRuntimeConstXYZ = 12345;
export class CompletelyUnusedRuntimeClassXYZ {}
`;
    fs.writeFileSync(path.resolve(tempDir, 'runtime-dead.fixture.ts'), code, 'utf8');

    try {
      const res = runGate([
        `--root=${tempDir}`,
        '--only=dead-exports',
        '--json'
      ]);

      expect(res.status).toBe(1);
      expect(res.json.passed).toBe(false);
      const deadNames = res.json.newViolations.map((v: any) => v.name);
      expect(deadNames).toContain('completelyUnusedRuntimeFunctionXYZ');
      expect(deadNames).toContain('completelyUnusedRuntimeConstXYZ');
      expect(deadNames).toContain('CompletelyUnusedRuntimeClassXYZ');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('13. Perintah CI "node scripts/reuse/check-reuse.mjs --warn --json > reuse-report.json" menghasilkan JSON yang 100% valid', () => {
    const reportPath = path.resolve(process.cwd(), 'reuse-report.test.json');

    try {
      // Jalankan perintah node langsung (seperti di CI)
      const res = spawnSync(process.execPath, [
        SCRIPT_PATH,
        '--warn',
        '--json'
      ], { encoding: 'utf8' });

      expect(res.status).toBe(0);
      fs.writeFileSync(reportPath, res.stdout, 'utf8');

      // Baca kembali dan pastikan parse JSON berhasil tanpa error primitive
      const fileContent = fs.readFileSync(reportPath, 'utf8');
      const parsed = JSON.parse(fileContent);

      expect(parsed).toBeDefined();
      expect(parsed.passed).toBe(true);
      expect(parsed.warnMode).toBe(true);
      expect(parsed.summary).toBeDefined();
      expect(parsed.summary.totalViolations).toBeGreaterThan(0);
      expect(parsed.summary.newViolations).toBe(0);
      expect(Array.isArray(parsed.newViolations)).toBe(true);
      expect(Array.isArray(parsed.structuralWarnings)).toBe(true);
    } finally {
      if (fs.existsSync(reportPath)) {
        fs.unlinkSync(reportPath);
      }
    }
  });

  it('14. --update-baseline DILARANG menaikkan baseline (butuh --allow-increase + alasan)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reuse-ratchet-'));
    const srcDir = path.join(tempDir, 'src');
    const baselineDir = path.join(tempDir, 'baselines');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(baselineDir, { recursive: true });

    // Fungsi identik (>40 token) di dua file → duplikasi baru.
    const duplicated = `export function processAlpha(input: number, factor: number): number {
  const total = input + factor;
  const doubled = total * 2;
  const shifted = doubled - 1;
  const squared = shifted * shifted;
  const halved = squared / 2;
  const result = halved + total;
  return result;
}`;
    fs.writeFileSync(path.join(srcDir, 'alpha.ts'), duplicated, 'utf8');
    fs.writeFileSync(path.join(srcDir, 'beta.ts'), duplicated, 'utf8');

    fs.writeFileSync(
      path.join(baselineDir, 'duplication.json'),
      JSON.stringify({ version: 2, groups: [], structuralGroups: [] }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(baselineDir, 'forbidden-declarations.json'),
      JSON.stringify({ version: 1, violations: [] }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(baselineDir, 'dead-exports.json'),
      JSON.stringify({ version: 1, deadExports: [] }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(baselineDir, 'file-size.json'),
      JSON.stringify({ version: 1, maxLines: 1500, files: [] }),
      'utf8'
    );

    const baseArgs = [
      `--root=${srcDir}`,
      `--baseline-dir=${baselineDir}`,
      '--update-baseline',
      '--allow-update'
    ];

    try {
      const rejected = runGate(baseArgs);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain('DILARANG naik');

      const withoutReason = runGate([...baseArgs, '--allow-increase']);
      expect(withoutReason.status).toBe(1);
      expect(withoutReason.stderr).toContain('--reason');

      const accepted = runGate([
        ...baseArgs,
        '--allow-increase',
        '--reason=inisialisasi baseline uji adversarial'
      ]);
      expect(accepted.status).toBe(0);

      const updated = JSON.parse(
        fs.readFileSync(path.join(baselineDir, 'duplication.json'), 'utf8')
      );
      expect(updated.groups.length).toBe(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
