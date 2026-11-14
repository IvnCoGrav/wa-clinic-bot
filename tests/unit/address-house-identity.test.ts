import { describe, it, expect } from 'vitest';
import {
  addressesMatch,
  hasHouseEvidence,
  houseIdentityMatch,
  stripUrlsFromAddress,
  streetIdentity,
} from '../../src/domain/customer-address';

/**
 * Regresi insiden 2026-11-14 (6285852555576): pelanggan mengirim ulang alamat
 * rumah yang SAMA via chat, ditempeli link Google Maps, tetapi sistem membuat
 * kartu "Rumah waru 2" tanpa koordinat. Akar masalah: dedup hanya mencocokkan
 * teks alamat identik persis.
 */
describe('Identitas rumah berbasis teks alamat', () => {
  const rumah1 = {
    address: 'jl tropodo 1 gg merah delima no.225A (rumah pertama abu putih)',
    kelurahan: 'Tropodo',
    kecamatan: 'waru',
    kota: 'sidoarjo',
    lat: -7.3588392,
    lng: 112.7583752,
  };

  it('membuang URL Google Maps dari teks alamat', () => {
    expect(
      stripUrlsFromAddress('https://maps.app.goo.gl/JTxKqgfNucwmENBG7\ntropodo 1 Gg merah delima no.225A')
    ).toBe('tropodo 1 gg merah delima no.225a');
    expect(stripUrlsFromAddress('Alamat: https://goo.gl/maps/abc123, Jl. Mawar No. 3')).toBe(
      'alamat: jl. mawar no. 3'
    );
  });

  it('membentuk kunci jalan tanpa prefix/keterangan generik', () => {
    expect(streetIdentity(rumah1.address).key).toBe('tropodo 1 merah delima 225a');
    expect(streetIdentity('Tropodo 1 Gg. Merah Delima No. 225A').key).toBe(
      'tropodo 1 merah delima 225a'
    );
    expect(streetIdentity(rumah1.address).houseNumber).toBe('225a');
  });

  it('alamat + URL + keterangan berbeda tetap rumah yang SAMA', () => {
    expect(houseIdentityMatch(rumah1.address, 'https://maps.app.goo.gl/xxx\ntropodo 1 Gg merah delima no.225A')).toBe(true);
    expect(houseIdentityMatch(rumah1.address, 'Tropodo 1 Gg merah delima no 225a')).toBe(true);
    expect(houseIdentityMatch(rumah1.address, 'jl tropodo 1 gg merah delima no.225A')).toBe(true);
  });

  it('nomor rumah berbeda di jalan sama BUKAN rumah yang sama', () => {
    expect(houseIdentityMatch('Jl. Melati No. 12, Grogol', 'Jl. Melati No. 14 (depan portal), Grogol')).toBe(false);
    expect(houseIdentityMatch('Jl. Tropodo 1 no.225A', 'Jl. Tropodo 1 no.225B')).toBe(false);
  });

  it('nomor rumah sama tetapi jalan berbeda BUKAN rumah yang sama', () => {
    expect(houseIdentityMatch('Jl. Melati No. 12', 'Jl. Mawar No. 12')).toBe(false);
    expect(houseIdentityMatch('Jl. Tropodo 2 no.225', 'Jl. Tropodo 1 no.225')).toBe(false);
  });

  it('tanpa nomor eksplisit: hanya teks kanonis identik yang dianggap sama', () => {
    expect(houseIdentityMatch('Jl. Puyuh, Sepanjang', 'Jalan Puyuh Sepanjang')).toBe(true);
    expect(houseIdentityMatch('Jl. Puyuh, Sepanjang', 'Jl. Puyuh')).toBe(false);
    expect(houseIdentityMatch('Perumahan Buduran Asri Blok C-10', 'Perumahan Buduran Asli Blok C-10')).toBe(false);
  });

  it('addressesMatch memakai identitas rumah sehingga tidak membuat rumah kedua', () => {
    expect(
      addressesMatch(rumah1, {
        address: 'https://maps.app.goo.gl/JTxKqgfNucwmENBG7\ntropodo 1 Gg merah delima no.225A',
        kelurahan: 'Tropodo',
        kecamatan: 'waru',
        kota: 'sidoarjo',
      })
    ).toBe(true);
  });

  it('addressesMatch tetap menolak rumah kedua di kelurahan berbeda', () => {
    expect(
      addressesMatch(rumah1, {
        address: 'jl tropodo 1 gg merah delima no.225A',
        kelurahan: 'Buduran',
        kecamatan: 'waru',
        kota: 'sidoarjo',
      })
    ).toBe(false);
  });

  it('tidak melemahkan dedup rumah-2 yang sah (<150 m tetap menang, nomor beda tetap terpisah)', () => {
    expect(houseIdentityMatch('Jl. Melati No. 12', 'Jl. Melati No. 14')).toBe(false);
    expect(houseIdentityMatch('Perumahan Buduran Asri Blok C-10', 'Perumahan Buduran Asri Blok B-5')).toBe(false);
  });

  it('kata yang mirip token generik bukan alasan menggabungkan dua rumah berbeda', () => {
    // "rumah-1"/"rumah-2" adalah nama jalan pada fixture: tidak boleh dianggap generik.
    expect(houseIdentityMatch('Jl. rumah-1 No. 1', 'Jl. rumah-2 No. 1')).toBe(false);
    expect(houseIdentityMatch('Jl. Depan Pasar No. 5', 'Jl. Belakang Pasar No. 5')).toBe(false);
  });

  it('gerbang bukti rumah: obrolan biasa tidak boleh melahirkan kartu alamat', () => {
    expect(hasHouseEvidence('nanti dikabari ya kak')).toBe(false);
    expect(hasHouseEvidence('Sesuai ini masuk GG merah delima rumah pertama putih abu')).toBe(false);
    expect(hasHouseEvidence('https://maps.app.goo.gl/abc123')).toBe(false);
    expect(hasHouseEvidence('tropodo 1 Gg merah delima no.225A')).toBe(true);
    expect(hasHouseEvidence('Perumahan Buduran Asri Blok C')).toBe(true);
    expect(hasHouseEvidence('Jl. Jojoran 1 Perintis 2 dlm/25')).toBe(true);
  });
});
