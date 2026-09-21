import { describe, it, expect } from 'vitest';
import { getGazetteerCoordinates } from '../../src/utils/gazetteer';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';

/**
 * Spatial Scoping Hardening (foundational) — matriks adversarial.
 * Menjalankan npx vitest run tests/unit/spatial-scoping.test.ts
 * Tanpa hardcode nama jalan/kawasan; kebenaran kota bersumber dari dataset.
 */
describe('Spatial Scoping Hardening (foundational)', () => {
  // =========================================================================
  // 1. Kupang Gunung Barat (Sawahan, Kota Surabaya) — anti-hijack ke Jabon
  // =========================================================================
  it('1a. "Surabaya, Kupang gn barat gang 3 no 1C" -> JANGAN ke Kupang/Jabon/Sidoarjo', async () => {
    const r = await geocodingService.geocodeText('Surabaya, Kupang gn barat gang 3 no 1C');
    expect(String(r.kota || '').toLowerCase()).not.toContain('sidoarjo');
    expect((r.kelurahan || '').toLowerCase()).not.toBe('kupang');
  });

  it('1b. parafrase "Kupang Gunung Barat" + sebutan Surabaya tidak boleh ke Jabon', async () => {
    for (const q of [
      'kupang gunung barat sby',
      'jl kupang gn. barat surabaya',
      'kupang gn barat surabaya',
      'kupang gunung barat kota surabaya',
    ]) {
      const r = await geocodingService.geocodeText(q);
      expect(String(r.kota || '').toLowerCase(), `query=${q}`).not.toContain('sidoarjo');
      expect((r.kelurahan || '').toLowerCase(), `query=${q}`).not.toBe('kupang');
    }
  });

  it('1c. getGazetteerCoordinates (jalur delivery) juga tidak boleh ke Jabon untuk Surabaya', () => {
    const g = getGazetteerCoordinates('surabaya kupang gn barat gang 3 no 1c');
    expect(g).toBeNull();
    const g2 = getGazetteerCoordinates('surabaya kupang gunung barat');
    expect(g2).toBeNull();
  });

  // =========================================================================
  // 2 & 3. Disambiguasi Kebonsari dua kota
  // =========================================================================
  it('2. "kebonsari surabaya" -> Kebonsari/Jambangan/Kota Surabaya', async () => {
    const r = await geocodingService.geocodeText('kebonsari surabaya');
    expect(r.isPrecise).toBe(true);
    expect(r.kelurahan).toBe('Kebonsari');
    expect(r.kecamatan).toBe('Jambangan');
    expect(r.kota?.toLowerCase()).toContain('surabaya');
    const g = getGazetteerCoordinates('kebonsari surabaya');
    expect(g?.kecamatan).toBe('Jambangan');
  });

  it('3. "kebonsari sidoarjo" -> Kebonsari/Candi/Kabupaten Sidoarjo', async () => {
    const r = await geocodingService.geocodeText('kebonsari sidoarjo');
    expect(r.isPrecise).toBe(true);
    expect(r.kelurahan).toBe('Kebonsari');
    expect(r.kecamatan).toBe('Candi');
    expect(r.kota?.toLowerCase()).toContain('sidoarjo');
    const g = getGazetteerCoordinates('kebonsari sidoarjo');
    expect(g?.kecamatan).toBe('Candi');
  });

  it('4. guard regresi: "kebonsari candi" tetap Candi Sidoarjo', async () => {
    const r = await geocodingService.geocodeText('kebonsari candi');
    expect(r.isPrecise).toBe(true);
    expect(r.kecamatan).toBe('Candi');
    expect(r.kota?.toLowerCase()).toContain('sidoarjo');
    const g = getGazetteerCoordinates('kebonsari candi');
    expect(g?.kecamatan).toBe('Candi');
    expect(g?.kota).toContain('Sidoarjo');
  });

  // =========================================================================
  // 5-7. Sidoarjo asli & frasa majemuk tetap lestari
  // =========================================================================
  it('5. "Kupang Jabon Sidoarjo" / "kupang baru jabon" tetap Jabon Sidoarjo', async () => {
    for (const q of ['Kupang Jabon Sidoarjo', 'kupang baru jabon']) {
      const r = await geocodingService.geocodeText(q);
      expect(r.isPrecise, `query=${q}`).toBe(true);
      expect(r.kecamatan, `query=${q}`).toBe('Jabon');
      expect(r.kota?.toLowerCase(), `query=${q}`).toContain('sidoarjo');
    }
    const g = getGazetteerCoordinates('kupang jabon sidoarjo');
    expect(g?.kecamatan).toBe('Jabon');
  });

  it('6. "kupang" telanjang (tanpa kota) -> ambigu, TIDAK menebak kota', async () => {
    const r = await geocodingService.geocodeText('kupang');
    expect(r.isPrecise).toBe(false);
  });

  it('7. "Dukuh Kupang" & "Kupang Krajan" ter-resolve ke frasa penuh masing-masing', async () => {
    const dk = await geocodingService.geocodeText('Dukuh Kupang');
    expect(dk.isPrecise).toBe(true);
    expect(dk.kecamatan).toBe('Dukuh Pakis');
    expect(dk.kota?.toLowerCase()).toContain('surabaya');

    const kk = await geocodingService.geocodeText('Kupang Krajan');
    expect(kk.isPrecise).toBe(true);
    expect(kk.kecamatan).toBe('Sawahan');
    expect(kk.kota?.toLowerCase()).toContain('surabaya');
  });

  // =========================================================================
  // 8. Pabean dua level / dua kota
  // =========================================================================
  it('8. "Pabean Sedati" -> Pabean/Sedati/Sidoarjo; "Pabean Cantian Surabaya" tidak dibajak', async () => {
    const ps = await geocodingService.geocodeText('Pabean Sedati');
    expect(ps.isPrecise).toBe(true);
    expect(ps.kecamatan).toBe('Sedati');
    expect(ps.kota?.toLowerCase()).toContain('sidoarjo');

    const pc = await geocodingService.geocodeText('Pabean Cantian Surabaya');
    expect(String(pc.kota || '').toLowerCase()).not.toContain('sidoarjo');

    const g = getGazetteerCoordinates('pabean cantian surabaya');
    expect(g?.kecamatan).toBe('Pabean Cantian');
    expect(g?.kota).toContain('Surabaya');
  });

  // =========================================================================
  // 9. Wilayah klinik lestari
  // =========================================================================
  it('9. "Kureksari Waru Sidoarjo" tetap presisi', async () => {
    const r = await geocodingService.geocodeText('Kureksari Waru Sidoarjo');
    expect(r.isPrecise).toBe(true);
    expect(r.kecamatan).toBe('Waru');
    expect(r.kota?.toLowerCase()).toContain('sidoarjo');
  });
});