import { describe, it, expect } from 'vitest';
import { resolveStreetAddress, extractAddressFromRawText } from '../../src/utils/reservation-address';
import {
  resolveStreetAddress as feResolve,
  extractAddressFromRawText as feExtract,
  resolveReservationAddress,
  resolveReservationRegion,
  formatReservationArea,
} from '../../packages/admin-dashboard/src/utils/reservationAddress';

const FORM_RAW = `Berikut list untuk reservasi :
Nama Bunda: Puput
Alamat & Shareloc : Perum Central Park Juanda, Kec. Sedati, Sidoarjo
Treatment : Pijat Bayi Ceria`;

describe('seam alamat reservasi (W2/W3)', () => {
  it('ekstraksi dari raw_text form', () => {
    expect(extractAddressFromRawText(FORM_RAW)).toContain('Perum Central Park Juanda');
  });
  it('raw_text menang atas preferences', () => {
    const res = { raw_text: FORM_RAW, customer: { preferences: { address: 'Alamat Lama' } } };
    expect(resolveStreetAddress(res)).toContain('Perum Central Park Juanda');
  });
  it('fallback ke preferences.address saat raw_text kosong/null', () => {
    expect(resolveStreetAddress({ raw_text: null, customer: { preferences: { address: 'Jl. Melati No 5' } } })).toBe('Jl. Melati No 5');
    expect(resolveStreetAddress({ raw_text: '[Admin Manual] Pijat', customer: { preferences: { full_address: 'Jl. Mawar 1' } } })).toBe('Jl. Mawar 1');
  });
  it('placeholder "-" TIDAK dianggap alamat (fallback ke prefs)', () => {
    const res = { raw_text: 'Alamat : -', customer: { preferences: { address: 'Jl. Kenanga 9' } } };
    expect(resolveStreetAddress(res)).toBe('Jl. Kenanga 9');
  });
  it('kosong total -> string kosong (bukan crash)', () => {
    expect(resolveStreetAddress({ raw_text: null, customer: { preferences: {} } })).toBe('');
    expect(resolveStreetAddress(null)).toBe('');
    expect(resolveStreetAddress(undefined, { preferences: {} })).toBe('');
  });
  it('varian "Alamat &amp; Shareloc" dan "Alamat Lengkap"', () => {
    expect(extractAddressFromRawText('Alamat &amp; Shareloc : Jl. Samping 3')).toBe('Jl. Samping 3');
    expect(extractAddressFromRawText('Alamat Lengkap : Jl. Tengah No 10 RT 2')).toContain('Jl. Tengah No 10');
  });
  it('paritas backend ↔ frontend seam', () => {
    const res = { raw_text: FORM_RAW, customer: { preferences: { address: 'X' } } };
    expect(feResolve(res)).toBe(resolveStreetAddress(res));
    expect(feExtract(FORM_RAW)).toBe(extractAddressFromRawText(FORM_RAW));
    expect(feResolve({ raw_text: null, customer: { preferences: {} } })).toBe('');
  });

  // ── Multi-rumah: kartu alamat tertaut adalah OTORITAS per-jadwal ──────────
  const CARD_GUNUNG_ANYAR = {
    label: 'Rumah Gunung Anyar',
    address: 'Gunung anyar lor no 94',
    kelurahan: 'Gunung Anyar Lor',
    kecamatan: 'Gunung Anyar',
    kota: 'Surabaya',
    distance_km: 5.2,
    ongkir: 12000,
    is_primary: false,
  };
  const ROOT_TANDES = {
    kelurahan: 'Karangpoh',
    kecamatan: 'Tandes',
    kota: 'Surabaya',
    distance_km: 19.77,
    ongkir: 15000,
    preferences: { address: 'Gadel, tandes' },
  };

  it('kartu tertaut menang atas raw_text dan preferences', () => {
    const res = {
      raw_text: `Alamat & Shareloc : Gadel, tandes`,
      customer_address: CARD_GUNUNG_ANYAR,
      customer: ROOT_TANDES,
    };
    expect(resolveStreetAddress(res)).toBe('Gunung anyar lor no 94');
    expect(feResolve(res)).toBe('Gunung anyar lor no 94');
    expect(feResolve(res)).toBe(resolveStreetAddress(res));
  });

  it('resolveReservationAddress: wilayah/jarak/ongkir ikut kartu, bukan profil induk', () => {
    const view = resolveReservationAddress({
      raw_text: `Alamat & Shareloc : Gadel, tandes`,
      customer_address: CARD_GUNUNG_ANYAR,
      customer: ROOT_TANDES,
    });
    expect(view.street).toBe('Gunung anyar lor no 94');
    expect(view.regionLabel).toBe('Gunung Anyar Lor, Gunung Anyar, Surabaya');
    expect(view.distanceKm).toBe(5.2);
    expect(view.ongkir).toBe(12000);
    expect(view.source).toBe('card');
    expect(view.cardIsPrimary).toBe(false);
  });

  it('tanpa kartu → fallback profil induk (perilaku lama tidak berubah)', () => {
    const view = resolveReservationAddress({ raw_text: null, customer: ROOT_TANDES });
    expect(view.street).toBe('Gadel, tandes');
    expect(view.regionLabel).toBe('Karangpoh, Tandes, Surabaya');
    expect(view.distanceKm).toBe(19.77);
    expect(view.ongkir).toBe(15000);
    expect(view.source).toBe('customer');
  });

  it('format wilayah (kalender) juga memakai kartu bila ada', () => {
    expect(resolveReservationRegion({ customer_address: CARD_GUNUNG_ANYAR, customer: ROOT_TANDES }).regionLabel)
      .toBe('Gunung Anyar Lor, Gunung Anyar, Surabaya');
    expect(formatReservationArea({ customer_address: CARD_GUNUNG_ANYAR, customer: ROOT_TANDES }, { includeKota: true }))
      .toBe('Gunung Anyar Lor, Gunung Anyar');
    expect(formatReservationArea({ customer: ROOT_TANDES }, { includeKota: true }))
      .toBe('Karangpoh, Tandes');
  });
});
