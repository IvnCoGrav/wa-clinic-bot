import { describe, it, expect } from 'vitest';
import { ALL_V3_TOOLS } from '../../../src/v3/tools/tool-registry';
import { evaluateToolMasking } from '../../../src/v3/tools/tool-masker';
import { CustomerGoalSession } from '../../../src/v3/domain/types';

/**
 * A-007: `kota` luas / centroid BUKAN lokasi presisi. Reservasi hanya boleh
 * dikunci bila ada bukti presisi (kelurahan/kecamatan/rawText non-broad/
 * jarak+ongkir non-centroid). Tanpa ini, pemilihan kota membuka
 * `save_reservation` padahal rute bidan belum terverifikasi.
 *
 * Adversarial: variasi input kota/centroid, bukan kalimat hafalan.
 */
describe('Tool Masker — presisi lokasi vs kota/centroid (A-007)', () => {
  const base: CustomerGoalSession = {
    genderGreeting: 'Bunda',
    cartItems: [{ name: 'Pijat Bayi Ceria', price: 100000, type: 'PRIMARY' }],
  };

  it('kota saja (tanpa kelurahan/kecamatan/jarak) → save_reservation DIBLOKIR', () => {
    const session: CustomerGoalSession = {
      ...base,
      location: { rawText: 'Surabaya', kota: 'Surabaya' },
    };
    const res = evaluateToolMasking(ALL_V3_TOOLS, session, 'Oke fix ambil hari Sabtu ya');
    expect(res.isSaveReservationAllowed).toBe(false);
    expect(res.maskedToolNames).toContain('save_reservation');
  });

  it('estimasi centroid (jarak+ongkir ada) → save_reservation DIBLOKIR', () => {
    const session: CustomerGoalSession = {
      ...base,
      location: {
        rawText: 'Surabaya',
        kota: 'Surabaya',
        distanceKm: 12,
        ongkirNormal: 25000,
        isEstimatedCentroid: true,
      },
    };
    const res = evaluateToolMasking(ALL_V3_TOOLS, session, 'Oke fix ambil hari Sabtu ya');
    expect(res.isSaveReservationAllowed).toBe(false);
    expect(res.maskedToolNames).toContain('save_reservation');
  });

  it('kelurahan presisi tetap membuka save_reservation', () => {
    const session: CustomerGoalSession = {
      ...base,
      location: { rawText: 'Waru', kelurahan: 'Waru', kota: 'Sidoarjo' },
    };
    const res = evaluateToolMasking(ALL_V3_TOOLS, session, 'Oke fix ambil hari Sabtu ya');
    expect(res.isSaveReservationAllowed).toBe(true);
    expect(res.maskedToolNames).not.toContain('save_reservation');
  });
});
