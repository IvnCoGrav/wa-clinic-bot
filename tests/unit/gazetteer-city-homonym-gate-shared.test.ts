import { describe, it, expect, beforeEach } from 'vitest';
import {
  getGazetteerCoordinates,
  isCityHomonymKecamatan,
  __resetGazetteerCache,
} from '../../src/utils/gazetteer';

/**
 * Audit Kasus Suko (Bunda Chris 6281390541340) — gerbang homonim kota bersama.
 * Satu helper `isCityHomonymKecamatan` dipakai SEMUA seam tulis (lifecycle,
 * tool calculate_delivery, google-contacts, backfill) agar tidak bercabang.
 * Berbasis DATASET (matchedLevel + canonical cities), bukan hafalan kalimat.
 */
describe('isCityHomonymKecamatan — gerbang homonim kota (shared)', () => {
  beforeEach(() => {
    __resetGazetteerCache();
  });

  it('kecamatan "Sidoarjo" (homonim kota) → true', () => {
    const hit = getGazetteerCoordinates('Sidoarjo');
    expect(hit!.matchedLevel).toBe('kecamatan');
    expect(hit!.kecamatan).toBe('Sidoarjo');
    expect(isCityHomonymKecamatan(hit)).toBe(true);
  });

  it('kecamatan asli "Jambangan" → false (sentroid sah)', () => {
    const hit = getGazetteerCoordinates('Jambangan');
    expect(hit).not.toBeNull();
    expect(isCityHomonymKecamatan(hit)).toBe(false);
  });

  it('kecamatan "Buduran" (bukan nama kota) → false', () => {
    const hit = getGazetteerCoordinates('Buduran');
    expect(hit!.kecamatan).toBe('Buduran');
    expect(isCityHomonymKecamatan(hit)).toBe(false);
  });

  it('hasil selevel kelurahan → false (bukan sentroid tebakan)', () => {
    const hit = getGazetteerCoordinates('sidokerto buduran');
    expect(hit!.matchedLevel).toBe('kelurahan');
    expect(isCityHomonymKecamatan(hit)).toBe(false);
  });

  it('null → false (tiada hasil, tidak mengunci apa pun)', () => {
    expect(isCityHomonymKecamatan(null)).toBe(false);
  });
});

describe('google-contacts classifyImportedAreaTag — tag kota luas', () => {
  it('tag "Sidoarjo" TIDAK menandai kelurahan Suko (cukup kecamatan)', async () => {
    const { classifyImportedAreaTag } = await import('../../src/services/google-contacts.service');
    const out = classifyImportedAreaTag('Sidoarjo');
    expect(out.kelurahan).toBeUndefined();
    expect(out.kecamatan).toBe('Sidoarjo');
  });

  it('tag "Manukan Kulon" tetap kelurahan resmi (non-regresi)', async () => {
    const { classifyImportedAreaTag } = await import('../../src/services/google-contacts.service');
    const out = classifyImportedAreaTag('Manukan Kulon');
    expect(out.kelurahan).toBe('Manukan Kulon');
    expect(out.kecamatan).toBe('Tandes');
  });
});

describe('calculate_delivery centroid — homonim kota tidak dikunci ke Suko', () => {
  it('"Sidoarjo Persada" (nama kota + detail) → tidak sentroid Suko', async () => {
    const { executeCalculateDelivery } = await import('../../src/v3/tools/calculate-delivery.tool');
    const res: any = await executeCalculateDelivery({ locationText: 'Sidoarjo Persada' });
    // Boleh gagal (minta kelurahan) atau apa pun — yang MUTLAK: bukan sentroid Suko.
    const isSuko =
      res.lat != null &&
      Math.abs(res.lat - -7.44615) < 0.02 &&
      Math.abs(res.lng - 112.678558) < 0.02;
    expect(isSuko).toBe(false);
    expect(res.isEstimatedCentroid).not.toBe(true);
  });
});
