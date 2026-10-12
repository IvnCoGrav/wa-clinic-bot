import { describe, it, expect } from 'vitest';
import { buildEffectiveTaskAddress } from '../../src/services/staff-reservation.service';

/**
 * REVISI-1 Tahap 2.2 — "Penghapusan diam-diam": entri alamat reservasi yang
 * kosong DILARANG menghapus teks jalan profil customer. Helper tunggal ini
 * dipakai getTodayTasks / getUpcomingSchedule / getCompletedTasks.
 */
describe('buildEffectiveTaskAddress (anti-timpa alamat kosong)', () => {
  const cust = {
    address: 'Jl. Melati No. 5',
    kelurahan: 'Waru',
    preferences: { address: 'Jl. Melati No. 5', landmark: 'Depan masjid' },
  };

  it('addr null → kembalikan customer apa adanya', () => {
    expect(buildEffectiveTaskAddress(null, cust)).toBe(cust);
    expect(buildEffectiveTaskAddress(undefined, cust)).toBe(cust);
  });

  it('addr.address kosong → fallback preferences.address + landmark profil bertahan', () => {
    const addr = { address: '', kelurahan: 'Waru', kecamatan: 'Waru', lat: -7.35, lng: 112.72, landmark: null, location_source: 'estimated_area' };
    const eff = buildEffectiveTaskAddress(addr, cust);
    expect(eff.address).toBe('Jl. Melati No. 5');
    expect(eff.preferences.address).toBe('Jl. Melati No. 5');
    expect(eff.preferences.landmark).toBe('Depan masjid');
    // Geometri tetap milik baris reservasi.
    expect(eff.lat).toBe(-7.35);
    expect(eff.location_source).toBe('estimated_area');
  });

  it('addr.address isi → pakai baris reservasi (perilaku lama dipertahankan)', () => {
    const addr = { address: 'Jl. Kenanga No. 8', kelurahan: 'Waru', lat: -7.36, lng: 112.73, landmark: 'Gang buntu', location_source: 'manual_staff' };
    const eff = buildEffectiveTaskAddress(addr, cust);
    expect(eff.address).toBe('Jl. Kenanga No. 8');
    expect(eff.preferences.address).toBe('Jl. Kenanga No. 8');
    expect(eff.preferences.landmark).toBe('Gang buntu');
  });

  it('spasi kosong + profil kosong → string kosong rapi (trim, bukan undefined)', () => {
    const eff = buildEffectiveTaskAddress({ address: '   ', landmark: null }, { preferences: {} });
    expect(eff.address).toBe('');
    expect(eff.preferences.address).toBe('');
  });
});
