import { describe, it, expect } from 'vitest';
import { treatmentCatalogService, ClinicServiceItem } from '../../src/services/treatment-catalog.service';

describe('Treatment Catalog - Bundle & Add-on Business Logic Unit Tests', () => {
  describe('Bundle Logic & Validation', () => {
    it('should identify default bundle services correctly', () => {
      const cukurPijat = treatmentCatalogService.getServiceById('baby-cukur-pijat-terapi');
      expect(cukurPijat).toBeDefined();
      expect(treatmentCatalogService.isBundleService(cukurPijat!)).toBe(true);

      const components = treatmentCatalogService.getBundleComponents(cukurPijat!);
      expect(components.length).toBe(2);
      expect(components.map((c) => c.id)).toContain('baby-cukur');
      expect(components.map((c) => c.id)).toContain('baby-massage-pulih-ceria');
    });

    it('should reject a bundle with fewer than 2 items', () => {
      const result = treatmentCatalogService.validateBundle({
        id: 'invalid-bundle-1',
        name: 'Paket 1 Layanan',
        bundleItemIds: ['baby-massage-ceria'],
        originalPrice: 80000,
        promoPrice: 60000,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('minimal 2 layanan eksisting');
    });

    it('should reject a bundle containing duplicate item IDs', () => {
      const result = treatmentCatalogService.validateBundle({
        id: 'invalid-bundle-dup',
        name: 'Paket Duplikat',
        bundleItemIds: ['baby-massage-ceria', 'baby-massage-ceria'],
        originalPrice: 160000,
        promoPrice: 100000,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('tidak boleh duplikat');
    });

    it('should reject a bundle referencing non-existent service IDs', () => {
      const result = treatmentCatalogService.validateBundle({
        id: 'invalid-bundle-missing',
        name: 'Paket Gaib',
        bundleItemIds: ['baby-massage-ceria', 'layanan-yang-tidak-ada-123'],
        originalPrice: 150000,
        promoPrice: 100000,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('tidak ditemukan dalam katalog');
    });

    it('should reject a bundle composed of another bundle (no recursive nesting)', () => {
      const result = treatmentCatalogService.validateBundle({
        id: 'nested-bundle',
        name: 'Paket Bersarang',
        bundleItemIds: ['baby-massage-ceria', 'baby-cukur-pijat-terapi'],
        originalPrice: 195000,
        promoPrice: 140000,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('tidak boleh disusun dari bundle lain');
    });

    it('should reject a bundle where bundle price is NOT cheaper than individual normal prices sum', () => {
      // baby-cukur (30.000) + baby-massage-pulih-ceria (90.000) = 120.000
      const resultSamePrice = treatmentCatalogService.validateBundle({
        id: 'bundle-expensive',
        name: 'Paket Mahal',
        bundleItemIds: ['baby-cukur', 'baby-massage-pulih-ceria'],
        promoPrice: 120000, // equal to sum
      });

      expect(resultSamePrice.valid).toBe(false);
      expect(resultSamePrice.error).toContain('harus lebih murah dari total harga normal');

      const resultMoreExpensive = treatmentCatalogService.validateBundle({
        id: 'bundle-more-expensive',
        name: 'Paket Lebih Mahal',
        bundleItemIds: ['baby-cukur', 'baby-massage-pulih-ceria'],
        promoPrice: 125000, // > sum
      });

      expect(resultMoreExpensive.valid).toBe(false);
      expect(resultMoreExpensive.error).toContain('harus lebih murah dari total harga normal');
    });

    it('should accept a valid bundle where bundle price is cheaper than components total normal price', () => {
      // baby-cukur (30.000) + baby-massage-pulih-ceria (90.000) = 120.000
      const result = treatmentCatalogService.validateBundle({
        id: 'bundle-valid-hemat',
        name: 'Paket Cukur Sehat Hemat',
        bundleItemIds: ['baby-cukur', 'baby-massage-pulih-ceria'],
        promoPrice: 85000, // cheaper by 35.000
      });

      expect(result.valid).toBe(true);
      expect(result.calculatedOriginalPrice).toBe(120000);
      expect(result.calculatedDuration).toBe(55); // 15 + 40
      expect(result.componentNames?.length).toBe(2);
    });
  });

  describe('Add-on Logic & Validation', () => {
    it('should identify add-on services correctly', () => {
      expect(treatmentCatalogService.isAddonService('add-on-sinar-moksa')).toBe(true);
      expect(treatmentCatalogService.isAddonService('add-on-nebulizer')).toBe(true);
      expect(treatmentCatalogService.isAddonService('add-on-nebulizer-obat')).toBe(true);
      expect(treatmentCatalogService.isAddonService('baby-massage-ceria')).toBe(false);
    });

    it('should reject a reservation containing ONLY add-on services', () => {
      const onlyAddonResult1 = treatmentCatalogService.validateReservationTreatments(['add-on-sinar-moksa']);
      expect(onlyAddonResult1.valid).toBe(false);
      expect(onlyAddonResult1.error).toContain('Layanan add-on tidak bisa berdiri sendiri');

      const onlyAddonResult2 = treatmentCatalogService.validateReservationTreatments([
        'add-on-sinar-moksa',
        'add-on-nebulizer',
      ]);
      expect(onlyAddonResult2.valid).toBe(false);
      expect(onlyAddonResult2.error).toContain('Layanan add-on tidak bisa berdiri sendiri');
    });

    it('should accept a reservation with main service and add-on services combined', () => {
      const validComboResult = treatmentCatalogService.validateReservationTreatments([
        'baby-massage-ceria',
        'add-on-sinar-moksa',
      ]);
      expect(validComboResult.valid).toBe(true);
    });

    it('should accept a reservation with a bundle service', () => {
      const validBundleResult = treatmentCatalogService.validateReservationTreatments(['baby-cukur-pijat-terapi']);
      expect(validBundleResult.valid).toBe(true);
    });

    it('should accept a reservation with standalone main services', () => {
      const validMainResult = treatmentCatalogService.validateReservationTreatments(['kids-massage-ceria']);
      expect(validMainResult.valid).toBe(true);
    });
  });

  describe('Catalog Text Formatting with Bundle and Add-on representation', () => {
    it('should format catalog text with bundle and add-on badges and component details', () => {
      const text = treatmentCatalogService.formatCatalogText(true);
      expect(text).toContain('[Paket Bundle Hemat]');
      expect(text).toContain('Termasuk Layanan:');
      expect(text).toContain('[Add-on]');
      expect(text).toContain('Layanan Tambahan (Add-on - Wajib digabung layanan utama)');
    });
  });
});
