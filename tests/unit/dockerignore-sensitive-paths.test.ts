import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * F7 (M17-02): build context WAJIB mengecualikan arsip/data sensitif.
 * Docker mengirim seluruh konteks ke daemon; `.dockerignore` adalah satu-satunya
 * gerbang agar dump backup, log forensik, snapshot live-chat, dan kunci privat
 * tidak ikut terkirim/tertanam di layer image.
 */

const ROOT = path.resolve(__dirname, '../..');
const ignorePath = path.join(ROOT, '.dockerignore');

const lines = fs
  .readFileSync(ignorePath, 'utf-8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

function ignores(entry: string): boolean {
  return lines.includes(entry);
}

describe('F7 — .dockerignore menutup path sensitif', () => {
  it.each([
    'logs',
    'backups',
    'audit',
    'data',
    'docs/live-snapshots',
    '.agents',
    '.opencode',
    'opencode.json',
    'skills-lock.json',
    'scripts/*.json',
  ])('mengecualikan %s', (entry) => {
    expect(ignores(entry)).toBe(true);
  });

  it('mengecualikan kunci privat dan file env', () => {
    expect(ignores('*.pem')).toBe(true);
    expect(ignores('*.key')).toBe(true);
    expect(ignores('.env')).toBe(true);
    expect(ignores('.env.*')).toBe(true);
  });

  it('TIDAK mengecualikan aset build dashboard yang dibutuhkan Vite', () => {
    // Fallback katalog layanan dashboard ada di src/data dan wajib ikut build.
    const offenders = lines.filter(
      (l) => l === 'src/data' || l === 'packages/admin-dashboard/src/data' || l === '**/data'
    );
    expect(offenders).toEqual([]);
  });

  it('setiap pola direktori runtime punya pasangan glob rekursif', () => {
    for (const dir of ['logs', 'backups', 'audit', 'data']) {
      expect(lines).toContain(`${dir}/**`);
    }
  });
});
