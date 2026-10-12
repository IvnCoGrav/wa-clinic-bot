import { describe, it, expect } from 'vitest';
import {
  upsertAddressIntoList,
  ensureSinglePrimary,
  addressesMatch,
  type SavedCustomerAddress,
} from '../../src/domain/customer-address';

/**
 * REVISI-1 Tahap 1.1 (TDD) — Jebakan Alamat Utama Kosong / Ghost Primary.
 *
 * Skenario nyata: entri alamat dibuat lebih dulu TANPA teks jalan (mis. hanya
 * "Waru, Waru" dari estimasi/gazetteer, is_primary=true), lalu admin/CS
 * melengkapi teks jalan ("Jl. Melati 5"). Perilaku benar = ENRICHMENT (merge
 * ke entri yang sama, primary bertahan). Perilaku bug = entri rumah KEDUA
 * (is_primary=false) sementara entri kosong tetap primary selamanya.
 *
 * Varian data (bukan hafalan kalimat): kombinasikan jalan × kelurahan ×
 * kecamatan × koordinat, termasuk arah cermin dan kasus rumah-2 sah.
 */
const NOW = new Date('2026-10-12T00:00:00.000Z').toISOString();

function mkAddr(over: Partial<SavedCustomerAddress>): SavedCustomerAddress {
  return {
    id: over.id || `addr-${Math.random().toString(36).slice(2)}`,
    label: over.label || 'Rumah',
    address: over.address ?? '',
    kelurahan: over.kelurahan ?? null,
    kecamatan: over.kecamatan ?? null,
    kota: over.kota ?? null,
    lat: over.lat ?? null,
    lng: over.lng ?? null,
    distanceKm: over.distanceKm ?? null,
    ongkir: over.ongkir ?? null,
    landmark: over.landmark ?? null,
    locationSource: over.locationSource ?? 'estimated_area',
    isPrimary: over.isPrimary ?? false,
    createdAt: over.createdAt || NOW,
    lastUsedAt: over.lastUsedAt || NOW,
  } as SavedCustomerAddress;
}

describe('Enrichment alamat kosong (ghost primary)', () => {
  it('E1. tambah teks jalan ke entri kosong se-wilayah → MERGE, primary bertahan', () => {
    const ghost = mkAddr({ id: 'g1', address: '', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', isPrimary: true });
    const { list, entry } = upsertAddressIntoList([ghost], {
      address: 'Jl. Melati No. 5', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo',
      lat: -7.35, lng: 112.72, locationSource: 'manual_staff',
    }, NOW);
    // Satu entri (bukan rumah kedua), ID lama dipertahankan, primary tetap.
    expect(list).toHaveLength(1);
    expect(entry.id).toBe('g1');
    expect(entry.address).toBe('Jl. Melati No. 5');
    expect(entry.isPrimary).toBe(true);
    expect(list.filter((a) => a.isPrimary)).toHaveLength(1);
  });

  it('E2. arah cermin: entri ber-jalan + input area-sama-tanpa-jalan → merge, jalan lama tidak terhapus', () => {
    const home = mkAddr({ id: 'h1', address: 'Jl. Kenanga No. 5', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', isPrimary: true, lat: -7.35, lng: 112.72 });
    const { list, entry } = upsertAddressIntoList([home], {
      kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo',
    }, NOW);
    expect(list).toHaveLength(1);
    expect(entry.address).toBe('Jl. Kenanga No. 5');
    expect(entry.isPrimary).toBe(true);
  });

  it('E3. dua rumah beda jalan satu kecamatan (keduanya ber-teleks) → TETAP 2 entri (anti-regresi rumah-2)', () => {
    const home1 = mkAddr({ id: 'h1', address: 'Jl. Melati No. 5', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', isPrimary: true });
    const { list } = upsertAddressIntoList([home1], {
      address: 'Jl. Kenanga No. 8', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo',
    }, NOW);
    expect(list).toHaveLength(2);
    expect(list.find((a) => a.id === 'h1')?.isPrimary).toBe(true);
  });

  it('E4. koordinat <150 m beda teks → merge (aturan lama dikunci)', () => {
    const home = mkAddr({ id: 'h1', address: 'Jl. A No. 1', kelurahan: 'Waru', kecamatan: 'Waru', isPrimary: true, lat: -7.3500, lng: 112.7200 });
    const { list } = upsertAddressIntoList([home], {
      address: 'Jl. B No. 2', kelurahan: 'Waru', kecamatan: 'Waru', lat: -7.3505, lng: 112.7205,
    }, NOW);
    expect(list).toHaveLength(1);
  });

  it('E5. ensureSinglePrimary: ghost kosong + sekunder isi → primary pindah ke entri isi', () => {
    const ghost = mkAddr({ id: 'g1', address: '', kelurahan: 'Waru', kecamatan: 'Waru', isPrimary: true });
    const full = mkAddr({ id: 'f1', address: 'Jl. Melati No. 5', kelurahan: 'Waru', kecamatan: 'Waru', isPrimary: false, lat: -7.35, lng: 112.72 });
    // Simulasi hasil healing: kosongkan flag ghost, pastikan tepat 1 primary yang isi.
    const healed = ensureSinglePrimary([
      { ...ghost, isPrimary: false },
      { ...full, isPrimary: true },
    ]);
    expect(healed.filter((a) => a.isPrimary)).toHaveLength(1);
    expect(healed.find((a) => a.isPrimary)?.id).toBe('f1');
  });

  it('E6. addressesMatch asimetris se-wilayah → true; beda kecamatan → false', () => {
    const empty = { address: '', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo' };
    const full = { address: 'Jl. Melati No. 5', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo' };
    expect(addressesMatch(empty as any, full as any)).toBe(true);
    expect(addressesMatch(full as any, empty as any)).toBe(true);
    const otherKec = { address: 'Jl. Melati No. 5', kelurahan: 'Kedungrejo', kecamatan: 'Waru', kota: 'Sidoarjo' };
    // Beda kelurahan (salah satu sisi) + satu sisi kosong → tidak asal merge.
    const emptyOther = { address: '', kelurahan: 'Kedungrejo', kecamatan: 'Waru', kota: 'Sidoarjo' };
    expect(addressesMatch(empty as any, { ...full, kelurahan: 'Kedungrejo' } as any)).toBe(false);
    expect(addressesMatch(emptyOther as any, otherKec as any)).toBe(true);
  });

  it('E7. sisi kosong tanpa kelurahan + sisi isi se-kecamatan → merge (pengayaan bertahap)', () => {
    const emptyNoKel = { address: '', kelurahan: null, kecamatan: 'Waru', kota: 'Sidoarjo' };
    const full = { address: 'Jl. Melati No. 5', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo' };
    expect(addressesMatch(emptyNoKel as any, full as any)).toBe(true);
  });
});
