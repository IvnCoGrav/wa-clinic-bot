import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sanitizePricelistPromoConfig,
  getPricelistPromoConfigAsync,
  DISABLED_PRICELIST_PROMO,
  __clearPricelistPromoCacheForTest,
} from '../../src/config/pricelist-promo';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Pricelist Promo Config — Unit & Sanitizer Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearPricelistPromoCacheForTest();
  });

  describe('sanitizePricelistPromoConfig', () => {
    it('1. mengembalikan DISABLED_PRICELIST_PROMO untuk input null / non-object', () => {
      expect(sanitizePricelistPromoConfig(null)).toEqual(DISABLED_PRICELIST_PROMO);
      expect(sanitizePricelistPromoConfig(undefined)).toEqual(DISABLED_PRICELIST_PROMO);
      expect(sanitizePricelistPromoConfig('string')).toEqual(DISABLED_PRICELIST_PROMO);
      expect(sanitizePricelistPromoConfig(123)).toEqual(DISABLED_PRICELIST_PROMO);
    });

    it('2. clamp discountPercent antara 0 dan 100', () => {
      const over = sanitizePricelistPromoConfig({ discountPercent: 150 });
      expect(over.discountPercent).toBe(100);

      const under = sanitizePricelistPromoConfig({ discountPercent: -20 });
      expect(under.discountPercent).toBe(0);

      const nan = sanitizePricelistPromoConfig({ discountPercent: 'not-a-number' });
      expect(nan.discountPercent).toBe(0);

      const valid = sanitizePricelistPromoConfig({ discountPercent: 25 });
      expect(valid.discountPercent).toBe(25);
    });

    it('3. clamp delaySeconds antara 0 dan 60', () => {
      const over = sanitizePricelistPromoConfig({ delaySeconds: 120 });
      expect(over.delaySeconds).toBe(60);

      const under = sanitizePricelistPromoConfig({ delaySeconds: -5 });
      expect(under.delaySeconds).toBe(0);

      const nan = sanitizePricelistPromoConfig({ delaySeconds: 'abc' });
      expect(nan.delaySeconds).toBe(5); // Default fallback adalah 5

      const valid = sanitizePricelistPromoConfig({ delaySeconds: 12 });
      expect(valid.delaySeconds).toBe(12);
    });

    it('4. membersihkan karakter @ di awal nama akun instagram', () => {
      const res1 = sanitizePricelistPromoConfig({ instagramAccount: '@kala_babyspa' });
      expect(res1.instagramAccount).toBe('kala_babyspa');

      const res2 = sanitizePricelistPromoConfig({ instagramAccount: '  kala_babyspa  ' });
      expect(res2.instagramAccount).toBe('kala_babyspa');
    });

    it('5. menyaring rules yang tidak valid / kosong', () => {
      const res = sanitizePricelistPromoConfig({
        rules: [
          { title: 'Follow IG', body: 'Follow akun resmi' },
          null,
          undefined,
          'not an object',
          { title: '   ', body: '' }, // Kosong dua-duanya harus dibuang
          { title: 'Hanya Judul', body: '' },
          { title: '', body: 'Hanya Isi' },
        ],
      });

      expect(res.rules).toHaveLength(3);
      expect(res.rules[0]).toEqual({ title: 'Follow IG', body: 'Follow akun resmi' });
      expect(res.rules[1]).toEqual({ title: 'Hanya Judul', body: '' });
      expect(res.rules[2]).toEqual({ title: '', body: 'Hanya Isi' });
    });
  });

  describe('getPricelistPromoConfigAsync', () => {
    it('6. fallback graceful ke DISABLED_PRICELIST_PROMO saat DB offline / throw', async () => {
      vi.mocked(prisma.tenant.findUnique).mockRejectedValueOnce(new Error('Database offline'));
      const conf = await getPricelistPromoConfigAsync(DEFAULT_TENANT_ID);
      expect(conf).toEqual(DISABLED_PRICELIST_PROMO);
      expect(conf.enabled).toBe(false);
    });

    it('7. memuat data promo dari DB dan menyimpannya di in-memory cache', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
        id: 'tenant-test-promo',
        settings: {
          promo: {
            enabled: true,
            discountPercent: 20,
            instagramAccount: 'testspa',
          },
        },
      } as any);

      const firstCall = await getPricelistPromoConfigAsync('tenant-test-promo');
      expect(firstCall.enabled).toBe(true);
      expect(firstCall.discountPercent).toBe(20);
      expect(firstCall.instagramAccount).toBe('testspa');

      // Panggilan kedua harus membaca dari cache (tidak memanggil DB lagi)
      const secondCall = await getPricelistPromoConfigAsync('tenant-test-promo');
      expect(secondCall).toEqual(firstCall);
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);

      // Setelah cache dibersihkan, panggilan berikutnya akan query DB lagi
      __clearPricelistPromoCacheForTest('tenant-test-promo');
      vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null as any);
      const thirdCall = await getPricelistPromoConfigAsync('tenant-test-promo');
      expect(thirdCall.enabled).toBe(false);
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(2);
    });
  });
});
