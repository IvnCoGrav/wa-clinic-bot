import { describe, it, expect } from 'vitest';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

describe('Treatment Catalog Service Unit Tests', () => {
  it('should retrieve all default active services', () => {
    const services = treatmentCatalogService.getAllServices();
    expect(services.length).toBeGreaterThan(0);
    
    // Verify required fields: id, name, durationMinutes, originalPrice, promoPrice, ageTier, description
    services.forEach((s) => {
      expect(s.id).toBeDefined();
      expect(s.name).toBeDefined();
      expect(s.durationMinutes).toBeGreaterThan(0);
      expect(s.originalPrice).toBeGreaterThan(0);
      expect(s.promoPrice).toBeGreaterThan(0);
      expect(s.ageTier.label).toBeDefined();
      expect(s.description).toBeDefined();
    });
  });

  it('should filter services by category correctly', () => {
    const babyServices = treatmentCatalogService.getServicesByCategory('BABY');
    expect(babyServices.every((s) => s.category === 'BABY' || s.category === 'BOTH')).toBe(true);

    const momsServices = treatmentCatalogService.getServicesByCategory('MOMS');
    expect(momsServices.every((s) => s.category === 'MOMS' || s.category === 'BOTH')).toBe(true);
  });

  it('should filter baby/kids services by age in months', () => {
    // 3 months old baby -> should match 0-24 months treatment
    const threeMonthServices = treatmentCatalogService.getServicesByAge(3);
    expect(threeMonthServices.some((s) => s.id === 'baby-massage-ceria')).toBe(true);
    expect(threeMonthServices.some((s) => s.id === 'kids-massage-ceria')).toBe(false);

    // 30 months old toddler (2.5 yrs) -> should match 2-7 years treatment
    const thirtyMonthServices = treatmentCatalogService.getServicesByAge(30);
    expect(thirtyMonthServices.some((s) => s.id === 'kids-massage-ceria')).toBe(true);
    expect(thirtyMonthServices.some((s) => s.id === 'baby-massage-ceria')).toBe(false);
  });

  it('should allow upserting a new service item for future admin UI management', () => {
    const newService = {
      id: 'custom-kids-spa',
      name: 'Custom Kids Bubble Spa',
      category: 'KIDS' as const,
      ageTier: { minAgeMonths: 12, maxAgeMonths: 48, label: '1 - 4 Tahun' },
      durationMinutes: 60,
      originalPrice: 160000,
      promoPrice: 130000,
      description: 'Layanan mandi berbusa dan pijat relaksasi anak.',
      isActive: true,
    };

    treatmentCatalogService.upsertService(newService);

    const retrieved = treatmentCatalogService.getServiceById('custom-kids-spa');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Custom Kids Bubble Spa');
    expect(retrieved?.originalPrice).toBe(160000);
    expect(retrieved?.promoPrice).toBe(130000);
  });

  it('should format catalog text clearly for LLM / WhatsApp response', () => {
    const text = treatmentCatalogService.formatCatalogText();
    expect(text).toContain('Pijat Bayi Ceria');
    expect(text).toContain('Harga Normal');
    expect(text).toContain('Promo');
    expect(text).toContain('Durasi');
  });
});
