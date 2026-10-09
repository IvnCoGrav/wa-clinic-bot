import { describe, it, expect } from 'vitest';
import { parseCapiValue, resolveTreatmentValue, extractValueByFormat } from '../../src/services/capi.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Fase 2.1: CAPI Value Guards & Treatment Category Resolvers', () => {
  describe('1. parseCapiValue validation & normalization', () => {
    it('should parse Indonesian thousand dot notation into numeric values', () => {
      expect(parseCapiValue('90.000')).toBe(90000);
      expect(parseCapiValue('150.000')).toBe(150000);
      expect(parseCapiValue('1.250.000')).toBe(1250000);
    });

    it('should parse standard numeric values and raw numeric strings', () => {
      expect(parseCapiValue(120000)).toBe(120000);
      expect(parseCapiValue('120000')).toBe(120000);
      expect(parseCapiValue(85000.5)).toBe(85000.5);
    });

    it('should reject 0 by default when allowZero is false or omitted', () => {
      expect(parseCapiValue(0)).toBeUndefined();
      expect(parseCapiValue('0')).toBeUndefined();
      expect(parseCapiValue('0.000')).toBeUndefined();
    });

    it('should allow 0 only when allowZero is explicitly true', () => {
      expect(parseCapiValue(0, true)).toBe(0);
      expect(parseCapiValue('0', true)).toBe(0);
    });

    it('should reject negative values, NaN, null, undefined, and non-numeric strings', () => {
      expect(parseCapiValue(-50000)).toBeUndefined();
      expect(parseCapiValue('-100.000')).toBeUndefined();
      expect(parseCapiValue(NaN)).toBeUndefined();
      expect(parseCapiValue(null)).toBeUndefined();
      expect(parseCapiValue(undefined)).toBeUndefined();
      expect(parseCapiValue('')).toBeUndefined();
      expect(parseCapiValue('   ')).toBeUndefined();
      expect(parseCapiValue('bukan_angka')).toBeUndefined();
      expect(parseCapiValue({})).toBeUndefined();
    });
  });

  describe('2. resolveTreatmentValue category fallback guard', () => {
    it('should NOT arbitrarily classify generic "pijat" or "homecare" as BABY', async () => {
      // In prior versions, generic words like "pijat" fell back to BABY.
      // Now, only specific words like baby/bayi should resolve to BABY.
      const val = await resolveTreatmentValue('mau tanya layanan pijat homecare', DEFAULT_TENANT_ID);
      // Because "pijat" and "homecare" are generic and not explicitly "baby/bayi",
      // it should return undefined instead of defaulting to Baby price.
      expect(val).toBeUndefined();
    });
  });

  describe('3. extractValueByFormat template matching', () => {
    it('should correctly extract rupiah amounts using template patterns', () => {
      const template = 'Treatment = %VALUE%';
      const text = 'Data booking:\nTreatment = Rp 140.000\nTanggal: Besok';
      const extracted = extractValueByFormat(text, template);
      expect(extracted).toBe(140000);
    });
  });
});
