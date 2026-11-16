import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures/architecture-gate');
const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/reuse/check-architecture.mjs');

function runArchGate(args: string[] = []) {
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

describe('Architecture & Structural Integrity Gate (Fase 3)', () => {
  it('1. Siklus ketergantungan baru (circular imports) memicu kegagalan NO_NEW_CYCLE', () => {
    const tempDir = path.resolve(process.cwd(), 'tests/fixtures/arch-temp-cycle');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    fs.copyFileSync(path.resolve(FIXTURES_DIR, 'cycle-a.ts'), path.resolve(tempDir, 'cycle-a.ts'));
    fs.copyFileSync(path.resolve(FIXTURES_DIR, 'cycle-b.ts'), path.resolve(tempDir, 'cycle-b.ts'));

    try {
      const res = runArchGate([
        `--root=${tempDir}`,
        '--only=cycles',
        '--json'
      ]);

      expect(res.status).toBe(1);
      expect(res.json.passed).toBe(false);
      const cycleViolations = res.json.newViolations.filter((v: any) => v.type === 'NO_NEW_CYCLE');
      expect(cycleViolations.length).toBeGreaterThan(0);
      expect(cycleViolations[0].cycle).toContain(path.relative(process.cwd(), path.resolve(tempDir, 'cycle-a.ts')).replace(/\\/g, '/'));
      expect(cycleViolations[0].cycle).toContain(path.relative(process.cwd(), path.resolve(tempDir, 'cycle-b.ts')).replace(/\\/g, '/'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('2. utils/** yang mengimpor services/** memicu kegagalan LAYER_UTILS', () => {
    const tempDir = path.resolve(process.cwd(), 'tests/fixtures/arch-temp-utils/utils');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    fs.copyFileSync(
      path.resolve(FIXTURES_DIR, 'utils/utils-imports-service.ts'),
      path.resolve(tempDir, 'utils-imports-service.ts')
    );

    try {
      const res = runArchGate([
        `--root=${path.dirname(tempDir)}`,
        '--only=layers',
        '--json'
      ]);

      expect(res.status).toBe(1);
      expect(res.json.passed).toBe(false);
      const layerViolations = res.json.newViolations.filter((v: any) => v.type === 'LAYER_UTILS');
      expect(layerViolations.length).toBeGreaterThan(0);
      expect(layerViolations[0].target).toContain('src/services/customer.service.ts');
    } finally {
      fs.rmSync(path.dirname(tempDir), { recursive: true, force: true });
    }
  });

  it('3. Route baru yang memanggil Prisma melebihi baseline memicu PRISMA_BUDGET_EXCEEDED', () => {
    const tempDir = path.resolve(process.cwd(), 'tests/fixtures/arch-temp-routes/routes');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    fs.copyFileSync(
      path.resolve(FIXTURES_DIR, 'routes/route-prisma-budget.ts'),
      path.resolve(tempDir, 'route-prisma-budget.ts')
    );

    try {
      const res = runArchGate([
        `--root=${path.dirname(tempDir)}`,
        '--only=prisma-budget',
        '--json'
      ]);

      expect(res.status).toBe(1);
      expect(res.json.passed).toBe(false);
      const prismaViolations = res.json.newViolations.filter((v: any) => v.type === 'PRISMA_BUDGET_EXCEEDED');
      expect(prismaViolations.length).toBeGreaterThan(0);
      expect(prismaViolations[0].calls).toBe(3);
    } finally {
      fs.rmSync(path.dirname(tempDir), { recursive: true, force: true });
    }
  });

  it('4. File clean murni lolos evaluasi tanpa pelanggaran (exit 0)', () => {
    const tempDir = path.resolve(process.cwd(), 'tests/fixtures/arch-temp-clean');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    fs.copyFileSync(path.resolve(FIXTURES_DIR, 'clean.ts'), path.resolve(tempDir, 'clean.ts'));

    try {
      const res = runArchGate([
        `--root=${tempDir}`,
        '--json'
      ]);

      expect(res.status).toBe(0);
      expect(res.json.passed).toBe(true);
      expect(res.json.newViolations).toHaveLength(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('5. Gate pada repo nyata (src/) berjalan < 10 detik dan 0 pelanggaran baru', () => {
    const startTime = Date.now();
    const res = runArchGate([
      '--root=src',
      '--json'
    ]);
    const duration = Date.now() - startTime;

    expect(res.status).toBe(0);
    expect(res.json.passed).toBe(true);
    expect(res.json.summary.newViolations).toBe(0);
    expect(duration).toBeLessThan(10000); // Harus selesai dalam < 10 detik
  });

  it('6. Perintah CI "node scripts/reuse/check-architecture.mjs --warn --json > architecture-report.json" menghasilkan JSON yang 100% valid', () => {
    const reportPath = path.resolve(process.cwd(), 'architecture-report.test.json');

    try {
      const res = spawnSync(process.execPath, [
        SCRIPT_PATH,
        '--warn',
        '--json'
      ], { encoding: 'utf8' });

      expect(res.status).toBe(0);
      fs.writeFileSync(reportPath, res.stdout, 'utf8');

      const fileContent = fs.readFileSync(reportPath, 'utf8');
      const parsed = JSON.parse(fileContent);

      expect(parsed).toBeDefined();
      expect(parsed.passed).toBe(true);
      expect(parsed.warnMode).toBe(true);
      expect(parsed.summary).toBeDefined();
      expect(parsed.summary.newViolations).toBe(0);
      expect(parsed.currentCyclesCount).toBe(6);
      expect(parsed.currentPrismaTotal).toBe(285);
    } finally {
      if (fs.existsSync(reportPath)) {
        fs.unlinkSync(reportPath);
      }
    }
  });

  it('7. Type-only import cycle TIDAK memicu kegagalan NO_NEW_CYCLE (pass)', () => {
    const tempDir = path.resolve(process.cwd(), 'tests/fixtures/arch-temp-type-cycle');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    fs.copyFileSync(path.resolve(FIXTURES_DIR, 'type-only-cycle-a.ts'), path.resolve(tempDir, 'type-only-cycle-a.ts'));
    fs.copyFileSync(path.resolve(FIXTURES_DIR, 'type-only-cycle-b.ts'), path.resolve(tempDir, 'type-only-cycle-b.ts'));

    try {
      const res = runArchGate([
        `--root=${tempDir}`,
        '--only=cycles',
        '--json'
      ]);

      expect(res.status).toBe(0);
      expect(res.json.passed).toBe(true);
      expect(res.json.newViolations).toHaveLength(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('8. Rute admin yang menambah import integrasi baru memicu kegagalan ADMIN_NO_NEW_INTEGRATION', () => {
    const tempDir = path.resolve(process.cwd(), 'tests/fixtures/arch-temp-admin/routes/admin');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    fs.copyFileSync(
      path.resolve(FIXTURES_DIR, 'routes/admin/admin-new-integration.ts'),
      path.resolve(tempDir, 'admin-new-integration.ts')
    );

    try {
      const res = runArchGate([
        `--root=${path.resolve(tempDir, '../..')}`,
        '--only=admin-integrations',
        '--json'
      ]);

      expect(res.status).toBe(1);
      expect(res.json.passed).toBe(false);
      const adminViolations = res.json.newViolations.filter((v: any) => v.type === 'ADMIN_NO_NEW_INTEGRATION');
      expect(adminViolations.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(path.resolve(tempDir, '../..'), { recursive: true, force: true });
    }
  });
});
