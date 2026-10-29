import { describe, expect, it } from 'vitest';
import {
  TREATMENT_CATEGORY_META,
  getTreatmentCategoryMeta,
  normalizeTreatmentCategory,
} from '../../packages/admin-dashboard/src/utils/treatmentCategoryIcon';

/**
 * F-33: kartu kalender menulis kategori treatment sebagai teks (BABY/MOMS/BOTH/KIDS)
 * dan memakan lebar yang seharusnya untuk nama pasien. Kategori kini dipetakan ke
 * ikon + label aksesibilitas.
 *
 * Nilai enum kanonis: prisma/schema.prisma:35-40 (TreatmentCategory).
 */
describe('normalizeTreatmentCategory', () => {
  it('mengenali seluruh nilai enum TreatmentCategory', () => {
    expect(normalizeTreatmentCategory('BABY')).toBe('BABY');
    expect(normalizeTreatmentCategory('KIDS')).toBe('KIDS');
    expect(normalizeTreatmentCategory('MOMS')).toBe('MOMS');
    expect(normalizeTreatmentCategory('BOTH')).toBe('BOTH');
  });

  it('tahan terhadap huruf kecil dan spasi berlebih dari serialisasi API', () => {
    expect(normalizeTreatmentCategory('baby')).toBe('BABY');
    expect(normalizeTreatmentCategory('  Moms  ')).toBe('MOMS');
    expect(normalizeTreatmentCategory('both')).toBe('BOTH');
  });

  it('mengembalikan null untuk nilai yang tidak dikenal', () => {
    expect(normalizeTreatmentCategory('BUNDLE')).toBeNull();
    expect(normalizeTreatmentCategory('PAKET')).toBeNull();
    expect(normalizeTreatmentCategory('')).toBeNull();
    expect(normalizeTreatmentCategory('   ')).toBeNull();
    expect(normalizeTreatmentCategory(null)).toBeNull();
    expect(normalizeTreatmentCategory(undefined)).toBeNull();
  });

  it('tidak tertipu properti bawaan objek (prototype pollution)', () => {
    expect(normalizeTreatmentCategory('constructor')).toBeNull();
    expect(normalizeTreatmentCategory('toString')).toBeNull();
    expect(normalizeTreatmentCategory('__proto__')).toBeNull();
  });
});

describe('getTreatmentCategoryMeta', () => {
  it('memberi ikon + label untuk setiap kategori', () => {
    for (const key of ['BABY', 'KIDS', 'MOMS', 'BOTH'] as const) {
      const meta = getTreatmentCategoryMeta(key);
      expect(meta).not.toBeNull();
      expect(meta!.label.length).toBeGreaterThan(0);
      expect(meta!.Icon).toBeTruthy();
    }
  });

  it('setiap kategori memakai ikon berbeda (bisa dibedakan sekilas)', () => {
    const icons = (['BABY', 'KIDS', 'MOMS', 'BOTH'] as const).map(
      (k) => getTreatmentCategoryMeta(k)!.Icon
    );
    expect(new Set(icons).size).toBe(4);
  });

  it('kembali null untuk kategori kosong/tak dikenal', () => {
    expect(getTreatmentCategoryMeta(null)).toBeNull();
    expect(getTreatmentCategoryMeta('BUNDLE')).toBeNull();
  });

  it('palet meta hanya berisi 4 kategori enum (tidak menambah kategori bisnis)', () => {
    expect(Object.keys(TREATMENT_CATEGORY_META).sort()).toEqual(['BABY', 'BOTH', 'KIDS', 'MOMS']);
  });
});
