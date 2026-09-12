import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

/**
 * Sesi 834128 — etalase promo umum ("apakah ada promo kak ?") WAJIB
 * mendahulukan layanan inti pijat/spa, bukan penunjang (mandi/cukur/tindik).
 * Mekanisme: Core Services First data-driven via durasi katalog DB
 * (layanan kilat < 30 mnt tenggelam) — tanpa hardcode nama layanan.
 * Aturan emas 3: tanpa asksDuration, TIDAK ADA "menit" di output.
 */
describe('Catalog Promo Core-First (sesi 834128)', () => {
  it('promo umum -> urutan 1-2 adalah pijat inti, bukan mandi/cukur/tindik', async () => {
    const out = await executeGetCatalog({ inquirePrice: true });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(2);
    expect(out.treatments[0].name).toMatch(/pijat/i);
    expect(out.treatments[1].name).toMatch(/pijat/i);
    for (const t of out.treatments.slice(0, 2)) {
      expect(t.name).not.toMatch(/memandikan|cukur|tindik/i);
    }
  });

  it('promo umum tanpa asksDuration -> TIDAK ADA durasi menit di output', async () => {
    const out = await executeGetCatalog({ inquirePrice: true });
    expect(out.success).toBe(true);
    for (const t of out.treatments) {
      expect(t.durationMinutes).toBeUndefined();
    }
    expect(out.message).not.toMatch(/menit/i);
  });

  it('asksDuration=true -> durasi tetap hadir (butuh legit)', async () => {
    const out = await executeGetCatalog({ inquirePrice: true, asksDuration: true });
    expect(out.success).toBe(true);
    expect(out.treatments.some((t) => typeof t.durationMinutes === 'number')).toBe(true);
    expect(out.message).toMatch(/menit/i);
  });
});
