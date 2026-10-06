import { describe, it, expect } from 'vitest';
import { extractAddressQueryFromUrlString } from '../../src/utils/google-maps-url-resolver';

/**
 * Audit Kasus Suko (Bunda Chris 6281390541340): link Google Maps bentuk
 * `/maps/place/<nama tempat>` atau `/maps/search/<teks>` TIDAK membawa `?q=`
 * sehingga teks alamatnya dulu hilang. Fungsi ini kini WAJIB mengurai segmen
 * pathname memakai API URL standar (bukan regex pola alamat hardcode).
 *
 * Adversarial: beragam varian nyata (plus-encoding, %20, prefix kec/kota,
 * koordinat angka yang BUKAN alamat, body HTML, dan non-regresi ?q=).
 */
describe('extractAddressQueryFromUrlString — link /maps/place/ & /maps/search/', () => {
  it('place/Jl.+Kyai+Hadi... (kasus Suko) -> teks alamat lengkap', () => {
    const q = extractAddressQueryFromUrlString(
      'https://www.google.com/maps/place/Jl.+Kyai+Hadi,+Tambaksumur,+Kec.+Waru,+Kabupaten+Sidoarjo,+Jawa+Timur+61256/@-7.346,112.779,17z'
    );
    expect(q).not.toBeNull();
    expect(q!).toMatch(/Kyai Hadi/i);
    expect(q!).toMatch(/Waru/i);
  });

  it('place/ dengan %20 encoding -> teks alamat ter-decode', () => {
    const q = extractAddressQueryFromUrlString(
      'https://www.google.com/maps/place/Jl.%20Kyai%20Hadi%20Tambaksumur%20Waru'
    );
    expect(q).toBe('Jl. Kyai Hadi Tambaksumur Waru');
  });

  it('search/ (varian lain) -> teks alamat', () => {
    const q = extractAddressQueryFromUrlString('https://www.google.com/maps/search/Berbek+Waru');
    expect(q).toBe('Berbek Waru');
  });

  it('place/ berisi koordinat angka -> null (ranah pola koordinat, bukan alamat)', () => {
    expect(extractAddressQueryFromUrlString('https://www.google.com/maps/place/-7.34,112.77')).toBeNull();
  });

  it('non-regresi: ?q=Nama+Tempat tetap terbaca', () => {
    expect(
      extractAddressQueryFromUrlString('https://www.google.com/maps/search/?api=1&q=Waterplace+Residence')
    ).toBe('Waterplace Residence');
  });

  it('non-regresi: ?q=koordinat angka tetap null', () => {
    expect(extractAddressQueryFromUrlString('https://maps.google.com/?q=-7.3488600,112.7516770')).toBeNull();
  });

  it('non-regresi: shortlink tanpa koordinat/teks -> null tanpa throw', () => {
    expect(extractAddressQueryFromUrlString('https://maps.app.goo.gl/9tino2KDgFKrq8aj8')).toBeNull();
  });

  it('non-regresi: body HTML dengan q= mentah tetap terbaca (fallback regex)', () => {
    expect(
      extractAddressQueryFromUrlString('<a href="/maps?q=Kenjeran+Park+Surabaya&z=14">x</a>')
    ).toBe('Kenjeran Park Surabaya');
  });
});
