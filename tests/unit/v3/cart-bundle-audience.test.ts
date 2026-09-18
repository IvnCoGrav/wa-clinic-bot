import { describe, it, expect } from 'vitest';
import {
  resolveServiceAudience,
  treatmentCatalogService,
  type ClinicServiceItem,
} from '../../../src/services/treatment-catalog.service';
import { CartManager } from '../../../src/v3/state/cart-manager';

/**
 * Plan regresi Fase 2 — audiens bundle data-driven dari KOMPOSISI komponen
 * katalog, bukan hafalan substring ID ('moms'/'laktasi'/'kelahiran').
 * Kasus utama: paket "Breast + Oksitoksin Fullbody Massage" (BUNDLE
 * berkomponen ibu) wajib ber-audiens MOMS → berlabel [Untuk Bunda].
 */
function svc(partial: Partial<ClinicServiceItem>): ClinicServiceItem {
  return {
    id: 'x',
    name: 'X',
    category: 'BUNDLE',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: '-' },
    durationMinutes: 60,
    originalPrice: 100000,
    promoPrice: 80000,
    description: '-',
    isActive: true,
    ...partial,
  } as ClinicServiceItem;
}

const MOMS_A = svc({ id: 'moms-paket-laktasi', name: 'Paket Laktasi', category: 'MOMS' });
const MOMS_B = svc({ id: 'moms-oksitosin-fullbody', name: 'Oksitosin Fullbody', category: 'MOMS' });
const BABY_A = svc({ id: 'baby-cukur', name: 'Cukur Bayi', category: 'BABY' });
const BABY_B = svc({ id: 'baby-massage-ceria', name: 'Pijat Bayi Ceria', category: 'BABY' });

const OKSITOSIN_BUNDLE = svc({
  id: 'moms-laktasi-oksitosin-full',
  name: 'Breast + Oksitoksin Fullbody Massage',
  category: 'BUNDLE',
  bundleItemIds: ['moms-paket-laktasi', 'moms-oksitosin-fullbody'],
});

describe('resolveServiceAudience — derivasi komposisi bundle', () => {
  const lookup = (id: string) =>
    ({ 'moms-paket-laktasi': MOMS_A, 'moms-oksitosin-fullbody': MOMS_B, 'baby-cukur': BABY_A, 'baby-massage-ceria': BABY_B } as Record<string, ClinicServiceItem>)[id];

  it('bundle oksitosin (komponen ibu) → MOMS', () => {
    expect(resolveServiceAudience(OKSITOSIN_BUNDLE, lookup)).toBe('MOMS');
  });

  it('bundle bayi (komponen bayi) → BABY', () => {
    const b = svc({ id: 'baby-paket-selapan', category: 'BUNDLE', bundleItemIds: ['baby-cukur', 'baby-massage-ceria'] });
    expect(resolveServiceAudience(b, lookup)).toBe('BABY');
  });

  it('ANTI-HAFALAN: bundle ID acak tanpa kata moms/laktasi tapi komponen ibu → MOMS', () => {
    const b = svc({ id: 'paket-acak-xyz-123', name: 'Paket Acak Xyz', category: 'BUNDLE', bundleItemIds: ['moms-paket-laktasi', 'moms-oksitosin-fullbody'] });
    expect(b.id).not.toMatch(/moms|laktasi|kelahiran|oksitosin|asi/i);
    expect(resolveServiceAudience(b, lookup)).toBe('MOMS');
  });

  it('bundle campuran ibu+anak → BOTH', () => {
    const b = svc({ id: 'mix-1', category: 'BUNDLE', bundleItemIds: ['moms-paket-laktasi', 'baby-cukur'] });
    expect(resolveServiceAudience(b, lookup)).toBe('BOTH');
  });

  it('bundle tanpa lookup → GENERAL (netral, aman)', () => {
    expect(resolveServiceAudience(OKSITOSIN_BUNDLE)).toBe('GENERAL');
  });

  it('kategori langsung dipetakan 1:1', () => {
    expect(resolveServiceAudience(svc({ category: 'MOMS' }))).toBe('MOMS');
    expect(resolveServiceAudience(svc({ category: 'BABY' }))).toBe('BABY');
    expect(resolveServiceAudience(svc({ category: 'KIDS' }))).toBe('KIDS');
    expect(resolveServiceAudience(svc({ category: 'ADD_ON' }))).toBe('GENERAL');
  });
});

describe('detectRecipientScope — bundle ber-audiens ibu → MOMS', () => {
  it('bundle oksitosin + audience MOMS → MOMS (label Bunda)', () => {
    expect(CartManager.detectRecipientScope('promo paket buat ibu', OKSITOSIN_BUNDLE, 'MOMS')).toBe('MOMS');
  });

  it('bundle bayi + audience BABY → CHILD_1', () => {
    const b = svc({ id: 'baby-paket-selapan', category: 'BUNDLE', bundleItemIds: ['baby-cukur'] });
    expect(CartManager.detectRecipientScope('paket untuk anak saya', b, 'BABY')).toBe('CHILD_1');
  });

  it('bundle tanpa audience → GENERAL (perilaku lama dipertahankan)', () => {
    expect(CartManager.detectRecipientScope('promo paket', OKSITOSIN_BUNDLE)).toBe('GENERAL');
  });
});

describe('filterServicesByAudience — tanpa hafalan ID', () => {
  const catalog = [MOMS_A, MOMS_B, BABY_A, BABY_B, OKSITOSIN_BUNDLE];

  it('konteks MOMS meloloskan bundle oksitosin', () => {
    const out = treatmentCatalogService.filterServicesByAudience(catalog, { audienceIntent: 'MOMS' });
    expect(out.map((s) => s.id)).toContain('moms-laktasi-oksitosin-full');
  });

  it('konteks usia anak memblokir bundle oksitosin', () => {
    const out = treatmentCatalogService.filterServicesByAudience(catalog, { ageMonths: 6 });
    expect(out.map((s) => s.id)).not.toContain('moms-laktasi-oksitosin-full');
    expect(out.map((s) => s.id)).toContain('baby-cukur');
  });

  it('ANTI-HAFALAN: bundle ID acak berkomponen ibu lolos filter MOMS', () => {
    const randomBundle = svc({
      id: 'paket-acak-xyz-123',
      name: 'Paket Acak Xyz',
      category: 'BUNDLE',
      bundleItemIds: ['moms-paket-laktasi', 'moms-oksitosin-fullbody'],
    });
    const out = treatmentCatalogService.filterServicesByAudience([...catalog, randomBundle], { audienceIntent: 'MOMS' });
    expect(out.map((s) => s.id)).toContain('paket-acak-xyz-123');
  });
});
