import { describe, it, expect, beforeEach } from 'vitest';
import { getGazetteerCoordinates, __resetGazetteerCache } from '../../src/utils/gazetteer';

beforeEach(() => {
  __resetGazetteerCache();
});

describe('gazetteer city homonim resilience — anti Sidoarjo Kota hijacking', () => {
  const sidoarjoCases: Array<[string, string]> = [
    ['buduran, Sidoarjo', 'Buduran'],
    ['waru, Sidoarjo', 'Waru'],
    ['taman, Sidoarjo', 'Taman'],
    ['candi, Sidoarjo', 'Candi'],
    ['sedati, Sidoarjo', 'Sedati'],
    ['krian, Sidoarjo', 'Krian'],
    ['porong, Sidoarjo', 'Porong'],
    ['wonoayu, Sidoarjo', 'Wonoayu'],
    ['gedangan, Sidoarjo', 'Gedangan'],
    ['sukodono, Sidoarjo', 'Sukodono'],
  ];

  for (const [q, expKec] of sidoarjoCases) {
    it(`${q} → Kecamatan ${expKec} (bukan Sidoarjo)`, () => {
      const hit = getGazetteerCoordinates(q);
      expect(hit).not.toBeNull();
      expect(hit!.kecamatan).toBe(expKec);
      expect(hit!.kecamatan).not.toBe('Sidoarjo');
      expect(hit!.kota).toBe('Kabupaten Sidoarjo');
    });
  }

  it('menganti, Gresik → Kecamatan Menganti (no-hijack)', () => {
    const hit = getGazetteerCoordinates('menganti, Gresik');
    expect(hit).not.toBeNull();
    expect(hit!.kecamatan).toBe('Menganti');
    expect(hit!.kota).toBe('Kabupaten Gresik');
  });

  it('driyorejo, Gresik → Kecamatan Driyorejo (no-hijack)', () => {
    const hit = getGazetteerCoordinates('driyorejo, Gresik');
    expect(hit).not.toBeNull();
    expect(hit!.kecamatan).toBe('Driyorejo');
    expect(hit!.kota).toBe('Kabupaten Gresik');
  });

  it('sidoarjo → Kecamatan Sidoarjo (non-regresi)', () => {
    const hit = getGazetteerCoordinates('sidoarjo');
    expect(hit).not.toBeNull();
    expect(hit!.kecamatan).toBe('Sidoarjo');
  });

  it('sidoarjo kota → Kecamatan Sidoarjo (non-regresi)', () => {
    const hit = getGazetteerCoordinates('sidoarjo kota');
    expect(hit).not.toBeNull();
    expect(hit!.kecamatan).toBe('Sidoarjo');
  });

  it('kecamatan sidoarjo → Kecamatan Sidoarjo (non-regresi)', () => {
    const hit = getGazetteerCoordinates('kecamatan sidoarjo');
    expect(hit).not.toBeNull();
    expect(hit!.kecamatan).toBe('Sidoarjo');
  });

  it('Damarsih, Buduran → Desa Damarsi, Kec. Buduran (typo 1-edit generik)', () => {
    const hit = getGazetteerCoordinates('Damarsih, Buduran');
    expect(hit).not.toBeNull();
    expect(hit!.kelurahan).toBe('Damarsi');
    expect(hit!.kecamatan).toBe('Buduran');
  });

  it('Damarsi, Buduran exact → Damarsi (kontrol exact tetap)', () => {
    const hit = getGazetteerCoordinates('Damarsi, Buduran');
    expect(hit).not.toBeNull();
    expect(hit!.kelurahan).toBe('Damarsi');
    expect(hit!.kecamatan).toBe('Buduran');
  });

  it('buduran, Sidoarjo tidak lagi ke Suko/Sidoarjo (koordinat bukan Suko)', () => {
    const hit = getGazetteerCoordinates('buduran, Sidoarjo');
    // Suko Sidoarjo = -7.44615,112.678558 ; Buduran centroid = -7.4279939,112.7226611
    expect(hit!.lat).not.toBeCloseTo(-7.44615, 2);
    expect(hit!.lng).not.toBeCloseTo(112.678558, 2);
  });
});
