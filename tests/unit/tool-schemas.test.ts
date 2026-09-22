import { describe, it, expect } from 'vitest';
import { validateToolArgs } from '../../src/v3/tools/tool-schemas';

describe('tool-schemas defensive preprocess (PLAN 12 Fase 1)', () => {
  it('get_catalog_and_price symptoms sebagai string koma → array bersih', () => {
    const r = validateToolArgs('get_catalog_and_price', { symptoms: 'anak baru jatuh, susah makan, tidak mau makan' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.symptoms).toEqual(['anak baru jatuh', 'susah makan', 'tidak mau makan']);
    }
  });

  it('get_catalog_and_price symptoms string dengan titik-koma + baris baru', () => {
    const r = validateToolArgs('get_catalog_and_price', { symptoms: 'batuk; pilek\n gtm' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.symptoms).toEqual(['batuk', 'pilek', 'gtm']);
    }
  });

  it('get_catalog_and_price symptoms sebagai array tetap lolos', () => {
    const r = validateToolArgs('get_catalog_and_price', { symptoms: ['batuk', 'pilek'] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.symptoms).toEqual(['batuk', 'pilek']);
  });

  it('get_catalog_and_price tanpa symptoms → default []', () => {
    const r = validateToolArgs('get_catalog_and_price', {});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.symptoms).toEqual([]);
  });

  it('save_reservation additionalTreatments string koma → array', () => {
    const r = validateToolArgs('save_reservation', {
      treatmentName: 'Pijat Bayi Ceria',
      bookingDate: '2026-09-23',
      additionalTreatments: 'Pijat Laktasi, Sinar Moksa',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.additionalTreatments).toEqual(['Pijat Laktasi', 'Sinar Moksa']);
  });

  it('get_catalog_and_price symptoms string kosong dipisah → []', () => {
    const r = validateToolArgs('get_catalog_and_price', { symptoms: ' , , ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.symptoms).toEqual([]);
  });
});
