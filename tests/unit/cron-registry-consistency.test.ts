import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * K-013: dokumentasi jumlah cron wajib selaras dengan registrasi runtime.
 * Definisi kanonis = `src/lifecycle/background-crons.ts` (createExclusiveCronTask).
 * Dokumentasi membedakan "interval cron" (22) dari "pekerja logis" (23) karena
 * Morning Jobs & Weekly Backup berbagi satu interval.
 */
describe('Konsistensi registri cron (K-013)', () => {
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, 'src/lifecycle/background-crons.ts'), 'utf8');
  const docs = fs.readFileSync(path.join(root, 'docs/FEATURE_INVENTORY.md'), 'utf8');

  const registeredIds = [...source.matchAll(/createExclusiveCronTask\('([^']+)'/g)].map((m) => m[1]);

  it('registrasi runtime tetap 22 interval cron dengan id unik', () => {
    expect(registeredIds.length).toBe(22);
    expect(new Set(registeredIds).size).toBe(22);
  });

  it('pekerja logis yang berbagi interval tetap terdaftar', () => {
    expect(registeredIds).toContain('morning-jobs-and-backup');
    expect(registeredIds).toContain('nightly-watchdog');
  });

  it('dokumentasi menyebut 22 interval dan 23 pekerja logis (bukan 23 interval)', () => {
    expect(docs).toContain('22 interval cron');
    expect(docs).toContain('23 pekerja logis');
    expect(docs).not.toContain('23 background worker mandiri');
  });
});
