import { describe, it, expect } from 'vitest';
import { pickHealingWinner } from '../../src/domain/address-healing';

const gps = (o: any = {}) => ({
  id: 'gps',
  address: '',
  location_source: 'gps_pin',
  lat: -7.28,
  lng: 112.69,
  is_primary: true,
  ...o,
});

const old = (o: any = {}) => ({
  id: 'old',
  address: 'Jl. Darmo Baru Barat 9',
  location_source: 'estimated_area',
  lat: -7.29,
  lng: 112.73,
  is_primary: false,
  ...o,
});

describe('pickHealingWinner — anti downgrade koordinat & anti kehilangan teks', () => {
  it('H1. GPS primary tanpa teks + kartu lama ber-teks → pemenang kartu lama, korban GPS', () => {
    const r = pickHealingWinner(gps(), [old()]);
    expect(r?.winner.id).toBe('old');
    expect(r?.victim.id).toBe('gps');
  });

  it('H2. GPS ber-teks → pemenang GPS, korban kartu lama', () => {
    const r = pickHealingWinner(gps({ address: 'Jl. Darmo Baru Barat 9' }), [old({ address: '' })]);
    expect(r?.winner.id).toBe('gps');
    expect(r?.victim.id).toBe('old');
  });

  it('H3. kedua ber-teks → pemenang GPS (koordinat presisi dipertahankan)', () => {
    const r = pickHealingWinner(gps({ address: 'Jl. A' }), [old({ address: 'Jl. A' })]);
    expect(r?.winner.id).toBe('gps');
  });

  it('H4. tidak ada teks sama sekali → pemenang GPS', () => {
    const r = pickHealingWinner(gps(), [old({ address: '' })]);
    expect(r?.winner.id).toBe('gps');
  });

  it('H5. kartu lama manual_staff diprioritaskan sebagai pemenang', () => {
    const r = pickHealingWinner(gps(), [
      old({ id: 'old1', location_source: 'estimated_area' }),
      old({ id: 'old2', location_source: 'manual_staff' }),
    ]);
    expect(r?.winner.id).toBe('old2');
    expect(r?.victim.id).toBe('gps');
  });

  it('H6. daftar kandidat kosong → null (tidak ada merge)', () => {
    expect(pickHealingWinner(gps(), [])).toBeNull();
  });
});
