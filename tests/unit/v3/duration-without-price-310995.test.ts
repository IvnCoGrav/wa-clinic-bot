import { describe, it, expect } from 'vitest';
import { executeGetCatalog } from '../../../src/v3/tools/get-catalog.tool';

/**
 * Sesi 310995: customer bertanya DURASI tanpa harga
 * ("Ni durasi pijatnya ada? Berapa lama?") → asksDuration:true, inquirePrice:false.
 * Temuan: durationMinutes ikut dihapus oleh blok !showPrices, sehingga LLM tidak
 * tahu durasi resmi dan mengabaikan pertanyaan. Scoping harga & durasi WAJIB
 * independen: durasi mengalir bila showDuration, TANPA membawa nominal harga.
 */
describe('Durasi tanpa harga (sesi 310995)', () => {
  it('asksDuration=true + inquirePrice=false → durationMinutes HADIR, harga TIDAK', async () => {
    const out = await executeGetCatalog({ inquirePrice: false, asksDuration: true, symptoms: ['batuk'] });
    expect(out.success).toBe(true);
    expect(out.treatments.length).toBeGreaterThan(0);
    // Durasi tersedia untuk LLM…
    expect(out.treatments.some((t) => typeof t.durationMinutes === 'number')).toBe(true);
    expect(out.message).toMatch(/menit/i);
    // …tetapi nominal harga tetap DILARANG bocor.
    for (const t of out.treatments) {
      expect(t.originalPrice).toBeUndefined();
      expect(t.promoPrice).toBeUndefined();
    }
    expect(out.message).not.toMatch(/Rp/i);
  });

  it('asksDuration unset + inquirePrice=false → durasi TETAP disembunyikan (regresi terjaga)', async () => {
    const out = await executeGetCatalog({ inquirePrice: false, symptoms: ['batuk'] });
    for (const t of out.treatments) {
      expect(t.durationMinutes).toBeUndefined();
    }
    expect(out.message).not.toMatch(/menit/i);
  });

  it('durasi-tanpa-harga: panduan konsultasi mengizinkan sebut durasi, tetap larang nominal', async () => {
    const out = await executeGetCatalog({
      inquirePrice: false,
      asksDuration: true,
      specificTreatmentName: 'Lahap Juara',
    });
    expect(out.success).toBe(true);
    // Durasi resmi muncul di output, bukan di-redam oleh mode konsultasi.
    expect(out.message).toMatch(/menit/i);
    expect(out.message).not.toMatch(/Rp/i);
  });
});
