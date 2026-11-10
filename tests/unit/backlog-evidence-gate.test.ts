import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Uji adversarial gerbang bukti backlog (Fase 1).
 * Memastikan gate GAGAL pada pelanggaran nyata, bukan hanya lolos di happy path.
 */
const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, 'scripts/verify-backlog-evidence.mjs');
const REGISTER = path.join(ROOT, 'docs/plans/REMAINING_BACKLOG_2026-11-09.md');
const MANIFEST = path.join(ROOT, 'docs/audit/2026-11-10/backlog-evidence.json');
const BASELINE = path.join(ROOT, 'docs/audit/2026-11-10/legacy-fixed-baseline.json');

let tmpDir: string;
let manifest: Record<string, any>;
let baseline: Record<string, any>;

type Fixture = { manifest?: Record<string, any>; baseline?: Record<string, any> };

function runGate(fixture: Fixture = {}) {
  const manifestPath = path.join(tmpDir, `manifest-${Math.random().toString(36).slice(2)}.json`);
  const baselinePath = path.join(tmpDir, `baseline-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(fixture.manifest ?? manifest));
  fs.writeFileSync(baselinePath, JSON.stringify(fixture.baseline ?? baseline));

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      BACKLOG_REGISTER: REGISTER,
      BACKLOG_MANIFEST: manifestPath,
      BACKLOG_BASELINE: baselinePath,
    },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  };
}

function cloneManifest() {
  return JSON.parse(JSON.stringify(manifest));
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-gate-'));
  manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Backlog Evidence Gate (Fase 1)', () => {
  it('lolos pada register + manifest saat ini', () => {
    const result = runGate();
    expect(result.output).toContain('PASS');
    expect(result.status).toBe(0);
  });

  it('gagal bila FIXED kehilangan bukti (mass-flip tanpa sumber)', () => {
    const m = cloneManifest();
    delete m.verified['S-002'];
    const result = runGate({ manifest: m });
    expect(result.status).toBe(1);
    expect(result.output).toContain('S-002: FIXED tanpa bukti');
  });

  it('gagal bila "contains" bukti tidak cocok dengan file sumber', () => {
    const m = cloneManifest();
    m.verified['S-003'].evidence[0].contains = 'string-yang-tidak-ada-di-file-mana-pun';
    const result = runGate({ manifest: m });
    expect(result.status).toBe(1);
    expect(result.output).toContain('tidak ditemukan di src/services/role-scope.service.ts');
  });

  it('gagal bila baseline FIXED historis tumbuh melewati 158', () => {
    const b = JSON.parse(JSON.stringify(baseline));
    b.ids.push('X-999');
    b.count = b.ids.length;
    const result = runGate({ baseline: b });
    expect(result.status).toBe(1);
    expect(result.output).toContain('baseline tumbuh');
  });

  it('gagal bila KNOWN tidak punya acceptance criteria', () => {
    const m = cloneManifest();
    delete m.known['DOM-02'].acceptance;
    const result = runGate({ manifest: m });
    expect(result.status).toBe(1);
    expect(result.output).toContain('KNOWN wajib punya "acceptance"');
  });

  it('gagal bila DUPLICATE tidak punya alasan', () => {
    const m = cloneManifest();
    delete m.duplicate['S-04'].reason;
    const result = runGate({ manifest: m });
    expect(result.status).toBe(1);
    expect(result.output).toContain('DUPLICATE wajib punya "reason"');
  });
});
