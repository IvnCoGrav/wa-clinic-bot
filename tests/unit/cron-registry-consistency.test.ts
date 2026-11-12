import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * K-013: dokumentasi jumlah cron wajib selaras dengan registrasi runtime.
 * Definisi kanonis = `src/lifecycle/background-crons.ts` (createExclusiveCronTask).
 * Dokumentasi membedakan "interval cron" (25) dari "pekerja logis" (26) karena
 * Morning Jobs & Weekly Backup berbagi satu interval.
 */
describe('Konsistensi registri cron (K-013)', () => {
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, 'src/lifecycle/background-crons.ts'), 'utf8');
  const docs = fs.readFileSync(path.join(root, 'docs/FEATURE_INVENTORY.md'), 'utf8');

  const registeredIds = [...source.matchAll(/createExclusiveCronTask\('([^']+)'/g)].map((m) => m[1]);

  it('registrasi runtime tetap 25 interval cron dengan id unik', () => {
    expect(registeredIds.length).toBe(25);
    expect(new Set(registeredIds).size).toBe(25);
  });

  it('pekerja logis yang berbagi interval tetap terdaftar', () => {
    expect(registeredIds).toContain('morning-jobs-and-backup');
    expect(registeredIds).toContain('nightly-watchdog');
  });

  it('K-009: cleanup sandbox & snapshot retensi terdaftar sebagai cron', () => {
    expect(registeredIds).toContain('sandbox-cleanup');
    expect(registeredIds).toContain('staff-retention-snapshot');
  });

  it('I-007: worker outbox Google Contacts terdaftar', () => {
    expect(registeredIds).toContain('google-contacts-outbox');
  });

  it('dokumentasi menyebut 25 interval dan 26 pekerja logis (bukan 26 interval)', () => {
    expect(docs).toContain('25 interval cron');
    expect(docs).toContain('26 pekerja logis');
    expect(docs).not.toContain('26 background worker mandiri');
  });
});
