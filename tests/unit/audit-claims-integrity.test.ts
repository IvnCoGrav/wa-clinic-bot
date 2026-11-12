import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Ar-009: rujukan `file:line` di laporan audit wajib valid (tidak basi). */
describe('Gerbang integritas rujukan audit (Ar-009)', () => {
  const root = process.cwd();
  const script = path.join(root, 'scripts/verify-audit-claims.mjs');

  it('laporan Fase 1 & 11 saat ini lolos verifikasi', () => {
    const out = execFileSync(process.execPath, [script, '--all'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(out).toContain('AUDIT CLAIM GATE');
    expect(out).not.toContain('MISSING_FILE');
  });

  it('menolak rujukan file yang tidak ada', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-claims-'));
    const report = path.join(dir, 'LAPORAN_PALSU.md');
    fs.writeFileSync(report, '| Bukti | `src/tidak-ada-file-ini.ts:10` |\n', 'utf8');
    try {
      expect(() =>
        execFileSync(process.execPath, [script, report], { cwd: root, encoding: 'utf8' })
      ).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('menolak nomor baris di luar ukuran file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-claims-'));
    const report = path.join(dir, 'LAPORAN_BASI.md');
    fs.writeFileSync(report, '| Bukti | `src/config/tenant.ts:999999` |\n', 'utf8');
    try {
      expect(() =>
        execFileSync(process.execPath, [script, report], { cwd: root, encoding: 'utf8' })
      ).toThrow(/OUT_OF_RANGE|AUDIT CLAIM GATE/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
