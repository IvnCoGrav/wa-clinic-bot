import { describe, it, expect, beforeAll } from 'vitest';

/**
 * #157k — TZ drift parser V3.
 *
 * Container produksi `TZ=undefined` (UTC). Sebelum fix, parser memakai
 * `setHours(9,0,0,0)` (jam LOKAL server) → booking "jam 9" tersimpan sebagai
 * 09:00 UTC = 16:00 WIB (geser 7 jam). Parser WAJIB menghasilkan 09:00 WIB
 * = 02:00 UTC, terlepas dari TZ proses.
 *
 * Test ini MEMAKSA TZ=UTC agar bug benar-benar tereproduksi (di mesin dev
 * ber-TZ WIB, bug lama tidak terlihat).
 */
let parseIndonesianDate: typeof import('../../src/utils/indonesian-date-parser').parseIndonesianDate;

beforeAll(async () => {
  process.env.TZ = 'UTC';
  ({ parseIndonesianDate } = await import('../../src/utils/indonesian-date-parser'));
});

describe('#157k indonesian-date-parser — jam default 09:00 WIB (02:00 UTC), TZ server = UTC', () => {
  // 2026-09-29T01:00:00Z = Selasa, 08:00 WIB
  const REF = new Date('2026-09-29T01:00:00.000Z');

  it('prasyarat: TZ proses UTC', () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
  });

  it('ISO date → 09:00 WIB (bukan 09:00 UTC)', () => {
    const r = parseIndonesianDate('2026-10-14', REF);
    expect(r.isRecognized).toBe(true);
    expect(r.date.toISOString()).toBe('2026-10-14T02:00:00.000Z');
  });

  it('"besok" → hari berikutnya 09:00 WIB', () => {
    const r = parseIndonesianDate('besok ya bund', REF);
    expect(r.date.toISOString()).toBe('2026-09-30T02:00:00.000Z');
  });

  it('"hari ini" → hari yang sama 09:00 WIB', () => {
    const r = parseIndonesianDate('hari ini', REF);
    expect(r.date.toISOString()).toBe('2026-09-29T02:00:00.000Z');
  });

  it('"lusa" → +2 hari 09:00 WIB', () => {
    const r = parseIndonesianDate('lusa', REF);
    expect(r.date.toISOString()).toBe('2026-10-01T02:00:00.000Z');
  });

  it('"12 september" lampau → digulir ke tahun depan, tetap 09:00 WIB', () => {
    const r = parseIndonesianDate('12 september', REF);
    expect(r.date.toISOString()).toBe('2027-09-12T02:00:00.000Z');
  });

  it('nama hari "sabtu" → Sabtu terdekat ke depan 09:00 WIB', () => {
    // REF = Selasa 29 Sep 2026 → Sabtu terdekat = 3 Okt 2026
    const r = parseIndonesianDate('sabtu', REF);
    expect(r.date.toISOString()).toBe('2026-10-03T02:00:00.000Z');
  });

  it('batas hari WIB: instant 16:30 UTC (= 23:30 WIB) → "hari ini" tetap 29 Sep', () => {
    const refLateWib = new Date('2026-09-29T16:30:00.000Z');
    const r = parseIndonesianDate('hari ini', refLateWib);
    expect(r.date.toISOString()).toBe('2026-09-29T02:00:00.000Z');
  });

  it('batas hari WIB: instant 17:30 UTC (= 00:30 WIB besok) → "hari ini" = 30 Sep', () => {
    const refNextWibDay = new Date('2026-09-29T17:30:00.000Z');
    const r = parseIndonesianDate('hari ini', refNextWibDay);
    expect(r.date.toISOString()).toBe('2026-09-30T02:00:00.000Z');
  });
});
