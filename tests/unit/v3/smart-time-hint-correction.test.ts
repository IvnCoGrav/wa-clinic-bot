import { describe, it, expect } from 'vitest';
import { ContextGrounder } from '../../../src/v3/agent/pipeline/context-grounder';

/**
 * Fase 6 K1 (Issue #78 item 3) — Smart Multi-Day Time-Hint Resolver.
 * Seam: ContextGrounder.extractTimeHint (murni, deterministik).
 * Kontrak: koreksi dalam satu kalimat dimenangkan token hari TERAKHIR
 * (latest-wins); filter usia ("3 minggu") dan frasa khusus lestari.
 */
describe('Smart Time-Hint Correction (latest-wins)', () => {
  it('koreksi eksplisit: "Sabtu... ganti Minggu" -> Minggu', () => {
    expect(
      ContextGrounder.extractTimeHint('Saya mau booking Sabtu... eh gak jadi, ganti Minggu ya')
    ).toBe('minggu');
  });

  it('kontras "bukan Senin tapi Rabu" -> Rabu', () => {
    expect(ContextGrounder.extractTimeHint('Bukan Senin tapi Rabu jam 10')).toBe('rabu');
  });

  it('usia bukan hari: "Bayi usia 3 minggu mau pijat hari Kamis" -> Kamis', () => {
    expect(ContextGrounder.extractTimeHint('Bayi usia 3 minggu mau pijat hari Kamis')).toBe('kamis');
  });

  it('frasa khusus lestari: "Hari biasa aja mbak" -> hari biasa', () => {
    expect(ContextGrounder.extractTimeHint('Hari biasa aja mbak')).toBe('hari biasa');
  });

  it('"Besok lusa bisa?" -> lusa (terakhir menang)', () => {
    expect(ContextGrounder.extractTimeHint('Besok lusa bisa?')).toBe('lusa');
  });

  it('satu hari tak berubah (jalur lama): "hari jumat jam 10" -> jumat', () => {
    expect(ContextGrounder.extractTimeHint('hari jumat jam 10')).toBe('jumat');
  });

  it('usia murni tanpa hari: "Anak 3 minggu rewel" -> null', () => {
    expect(ContextGrounder.extractTimeHint('Anak 3 minggu rewel')).toBeNull();
  });
});
