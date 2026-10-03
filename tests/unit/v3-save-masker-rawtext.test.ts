import { describe, it, expect, vi } from 'vitest';
import { evaluateToolMasking } from '../../src/v3/tools/tool-masker';
import { ALL_V3_TOOLS } from '../../src/v3/tools/tool-registry';
import { CustomerGoalSession } from '../../src/v3/domain/types';

/**
 * C.1 (audit #199) — save_reservation DILARANG dibuka bila lokasi hanya
 * `rawText` kota luas (mis. "Surabaya") tanpa kelurahan/kecamatan/kota presisi.
 * Keputusan user: tahan + notifikasi admin (bukan diam-diam, bukan buka).
 */
describe('C.1 — gate lokasi presisi save_reservation', () => {
  const base: CustomerGoalSession = {
    genderGreeting: 'Bunda',
    cartItems: [{ name: 'Pijat Bayi Ceria', price: 60000, type: 'PRIMARY' }],
  };

  it('rawText kota luas saja → save_reservation DIBLOK (LOCATION_IMPRECISE)', () => {
    const session: CustomerGoalSession = { ...base, location: { rawText: 'Surabaya' } as any };
    const res = evaluateToolMasking(ALL_V3_TOOLS, session, 'Oke besok fix ya', []);
    expect(res.maskedToolNames).toContain('save_reservation');
    expect(res.reason).toMatch(/IMPRECISE|LOCATION/);
  });

  it('lokasi presisi kelurahan → save_reservation DIBUKA (jika tanggal+komitmen)', () => {
    const session: CustomerGoalSession = { ...base, location: { kelurahan: 'Kedungkendo', kecamatan: 'Candi' } as any };
    const res = evaluateToolMasking(ALL_V3_TOOLS, session, 'Oke besok fix ya', []);
    expect(res.maskedToolNames).not.toContain('save_reservation');
  });

  it('lokasi presisi kota (dalam coverage) → tetap DIBUKA', () => {
    const session: CustomerGoalSession = { ...base, location: { kota: 'Kabupaten Sidoarjo' } as any };
    const res = evaluateToolMasking(ALL_V3_TOOLS, session, 'Oke besok fix ya', []);
    expect(res.maskedToolNames).not.toContain('save_reservation');
  });
});
