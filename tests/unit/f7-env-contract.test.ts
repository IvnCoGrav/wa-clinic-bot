import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * F7 / G11(a) — pemisahan env per service.
 * Worker tidak membuka HTTP, jadi secret inbound webhook TIDAK boleh ada di
 * `.env.worker`. Generator + checker adalah gerbang deterministik, bukan disiplin
 * manual operator.
 */

const ROOT = path.resolve(__dirname, '../..');
const GENERATOR = path.join(ROOT, 'scripts', 'generate-worker-env.mjs');
const CHECKER = path.join(ROOT, 'scripts', 'check-env-contract.mjs');

let tmpDir: string;
let sourceEnv: string;
let workerEnv: string;

function writeEnv(file: string, lines: string[]): void {
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf-8');
}

function readWorkerKeys(): string[] {
  return fs
    .readFileSync(workerEnv, 'utf-8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.slice(0, l.indexOf('=')))
    .filter(Boolean);
}

describe('F7 — kontrak env worker (G11a)', () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f7-env-'));
    sourceEnv = path.join(tmpDir, '.env');
    workerEnv = path.join(tmpDir, '.env.worker');
    writeEnv(sourceEnv, [
      'ADMIN_API_KEY=admin-secret',
      'WAHA_API_KEY=waha-secret',
      'BACKUP_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'WAHA_WEBHOOK_SECRET=inbound-waha-secret',
      'TELEGRAM_WEBHOOK_SECRET=inbound-telegram-secret',
      'WABA_APP_SECRET=inbound-meta-secret',
      'WABA_WEBHOOK_VERIFY_TOKEN=meta-verify',
      'WAHA_ALLOW_UNSIGNED_WEBHOOK=true',
      'WAHA_SWAGGER_PASSWORD=swagger-secret',
      'WAHA_DASHBOARD_PASSWORD=dashboard-secret',
      'VITE_CARTO_API_KEY=build-only',
      'TELEGRAM_BOT_TOKEN=612345:token',
      'WAHA_BASE_URL=http://waha:3000',
    ]);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('menyalin key operasional & membuang seluruh secret inbound webhook', () => {
    execFileSync(process.execPath, [GENERATOR, '--in', sourceEnv, '--out', workerEnv], {
      cwd: ROOT,
      stdio: 'pipe',
    });

    const keys = readWorkerKeys();
    expect(keys).toEqual(
      expect.arrayContaining(['ADMIN_API_KEY', 'WAHA_API_KEY', 'BACKUP_ENCRYPTION_KEY'])
    );
    expect(keys).toEqual(expect.arrayContaining(['TELEGRAM_BOT_TOKEN']));

    for (const denied of [
      'WAHA_WEBHOOK_SECRET',
      'TELEGRAM_WEBHOOK_SECRET',
      'WABA_APP_SECRET',
      'WABA_WEBHOOK_VERIFY_TOKEN',
      'WAHA_ALLOW_UNSIGNED_WEBHOOK',
      'WAHA_SWAGGER_PASSWORD',
      'WAHA_DASHBOARD_PASSWORD',
    ]) {
      expect(keys).not.toContain(denied);
    }
    expect(keys.some((k) => k.startsWith('VITE_'))).toBe(false);
  });

  it('nilai secret tidak pernah dicetak ke stdout generator', () => {
    const out = execFileSync(process.execPath, [GENERATOR, '--in', sourceEnv, '--out', workerEnv], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    expect(out).not.toContain('inbound-waha-secret');
    expect(out).not.toContain('admin-secret');
    expect(out).not.toContain('swagger-secret');
  });

  it('checker PASS untuk hasil generator dan FAIL bila secret inbound disusupkan', () => {
    execFileSync(process.execPath, [GENERATOR, '--in', sourceEnv, '--out', workerEnv], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    expect(() =>
      execFileSync(process.execPath, [CHECKER, '--env', workerEnv], { cwd: ROOT, stdio: 'pipe' })
    ).not.toThrow();

    fs.appendFileSync(workerEnv, 'WAHA_WEBHOOK_SECRET=bocor\n');
    expect(() =>
      execFileSync(process.execPath, [CHECKER, '--env', workerEnv], { cwd: ROOT, stdio: 'pipe' })
    ).toThrow();
  });

  it('generator gagal (fail-closed) bila key wajib worker tidak ada', () => {
    const incomplete = path.join(tmpDir, '.env.incomplete');
    const out = path.join(tmpDir, '.env.incomplete.worker');
    writeEnv(incomplete, ['WAHA_API_KEY=waha-secret']);

    expect(() =>
      execFileSync(process.execPath, [GENERATOR, '--in', incomplete, '--out', out], {
        cwd: ROOT,
        stdio: 'pipe',
      })
    ).toThrow();
  });

  it('compose: worker memakai .env.worker, app memakai .env', () => {
    const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf-8').split(/\r?\n/);
    const block = (name: string) => {
      const start = compose.findIndex((l) => new RegExp(`^\\s{2}${name}:\\s*$`).test(l));
      const out: string[] = [];
      for (let i = start + 1; start >= 0 && i < compose.length; i++) {
        if (/^\s{2}[A-Za-z0-9_.-]+:\s*$/.test(compose[i])) break;
        out.push(compose[i]);
      }
      return out.join('\n');
    };

    expect(block('app')).toMatch(/^\s*-\s*\.env\s*$/m);
    expect(block('worker')).toMatch(/^\s*-\s*\.env\.worker\s*$/m);
    expect(block('worker')).not.toMatch(/^\s*-\s*\.env\s*$/m);
  });

  it('deploy-prod menjalankan generator + checker sebelum compose up', () => {
    const deploy = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-prod.sh'), 'utf-8');
    const gen = deploy.indexOf('generate-worker-env.mjs');
    const check = deploy.indexOf('check-env-contract.mjs');
    const up = deploy.indexOf('docker compose up -d --no-deps app worker');

    expect(gen).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(gen);
    expect(up).toBeGreaterThan(check);
  });
});
