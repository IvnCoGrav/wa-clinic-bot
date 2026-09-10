import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

/**
 * Fondational Akar 1 — Tool Output Scoping: bila customer TIDAK bertanya
 * harga (inquirePrice === false), angka harga/durasi DILARANG mengalir ke
 * konteks LLM (objek treatment maupun string message).
 */
describe('Tool Output Scoping (no-price context)', () => {
  it('inquirePrice=false -> treatments tanpa angka + message tanpa Rp/menit', async () => {
    const out = await executeGetCatalog({ inquirePrice: false, symptoms: ['batuk'] });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(0);
    for (const t of out.treatments) {
      expect(t.originalPrice).toBeUndefined();
      expect(t.promoPrice).toBeUndefined();
      expect(t.durationMinutes).toBeUndefined();
    }
    expect(out.message).not.toMatch(/Rp/i);
    expect(out.message).not.toMatch(/menit/i);
    expect(out.suggestedPriceReply).toBeUndefined();
    if (out.recommendationReason) {
      expect(out.recommendationReason).not.toMatch(/Rp/i);
    }
  });

  it('inquirePrice=true -> angka tetap hadir (harga memang diminta)', async () => {
    const out = await executeGetCatalog({ inquirePrice: true, symptoms: ['batuk'] });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(0);
    expect(out.treatments.some((t) => typeof t.promoPrice === 'number')).toBe(true);
    expect(out.treatments.some((t) => typeof t.durationMinutes === 'number')).toBe(true);
  });
});
