import { describe, it, expect } from 'vitest';
import { resolveStreetAddress, extractAddressFromRawText } from '../../src/utils/reservation-address';
import {
  resolveStreetAddress as feResolve,
  extractAddressFromRawText as feExtract,
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
});
