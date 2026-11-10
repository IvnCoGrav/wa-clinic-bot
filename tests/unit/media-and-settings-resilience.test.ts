import { describe, it, expect, vi } from 'vitest';
import { mediaService } from '../../src/services/media.service';
import { deepMergeSettings, updateTenantSettingsSafely } from '../../src/routes/admin/settings-helpers';

describe('F4.4 Media Security & Settings JSONB Resilience (S-014, W-007, Cfg-008)', () => {
  describe('S-014 & Media Security: Path Traversal & SSRF Protection', () => {
    it('menolak path traversal pada filePathFromRelativeUrl', () => {
      const traversalUrls = [
        '/media/inbound/../etc/passwd',
        '/media/outbound/default-tenant/../../../etc/shadow',
        '/media/inbound/tenant-1/..%2f..%2fconfig',
      ];

      for (const url of traversalUrls) {
        const result = mediaService.filePathFromRelativeUrl(url);
        // Harus null jika mengandung traversal atau tidak match format canonical
        expect(result).toBeNull();
      }
    });

    it('mengizinkan format relative url media yang valid dan di bawah MEDIA_ROOT', () => {
      const validUrl = '/media/outbound/default-tenant/test-image.jpg';
      const result = mediaService.filePathFromRelativeUrl(validUrl);
      expect(result).not.toBeNull();
      expect(result).toContain('outbound');
      expect(result).toContain('default-tenant');
      expect(result).toContain('test-image.jpg');
    });
  });

  describe('Cfg-008: Settings JSONB Deep Merge & Atomic Safe-Update', () => {
    it('deepMergeSettings menggabungkan nested objek tanpa menimpa sibling property', () => {
      const target = {
        brand: {
          name: 'Klinik Sehat',
          logoUrl: 'https://example.com/old-logo.png',
        },
        promo: {
          enabled: true,
          badgeText: 'Diskon 10%',
        },
        paymentInfo: {
          qrisImageUrl: 'https://example.com/qris.png',
          bankAccounts: [{ bank: 'BCA', accountNumber: '1234567890' }],
        },
      };

      const patch = {
        brand: {
          logoUrl: 'https://example.com/new-logo.png', // hanya ubah logo
        },
        paymentInfo: {
          instructions: 'Transfer sebelum 2 jam', // tambah instructions
        },
      };

      const merged = deepMergeSettings(target, patch);

      // Pastikan logoUrl berubah
      expect(merged.brand.logoUrl).toBe('https://example.com/new-logo.png');
      // Pastikan name tetap utuh
      expect(merged.brand.name).toBe('Klinik Sehat');
      // Pastikan promo tidak hilang
      expect(merged.promo.enabled).toBe(true);
      expect(merged.promo.badgeText).toBe('Diskon 10%');
      // Pastikan bankAccounts tetap utuh dan instructions bertambah
      expect(merged.paymentInfo.bankAccounts).toHaveLength(1);
      expect(merged.paymentInfo.instructions).toBe('Transfer sebelum 2 jam');
    });

    it('updateTenantSettingsSafely mengelola _version dan _updatedAt serta memanggil prisma.tenant.update', async () => {
      const mockPrisma = {
        tenant: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'tenant-123',
            settings: {
              brand: { name: 'Klinik A' },
              _version: 3,
            },
          }),
          update: vi.fn().mockImplementation(async ({ data }) => data),
        },
      };

      const result = await updateTenantSettingsSafely(mockPrisma, 'tenant-123', (current) => {
        return {
          ...current,
          metaPurchasePolicy: 'DUAL_EVENT',
        };
      });

      expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: 'tenant-123' },
        select: { settings: true },
      });

      expect(result._version).toBe(4); // increment dari 3 ke 4
      expect(typeof result._updatedAt).toBe('string');
      expect(result.brand.name).toBe('Klinik A');
      expect(result.metaPurchasePolicy).toBe('DUAL_EVENT');

      expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-123' },
        data: { settings: result },
      });
    });

    it('updateTenantSettingsSafely melempar 404 jika tenant tidak ditemukan', async () => {
      const mockPrisma = {
        tenant: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };

      await expect(
        updateTenantSettingsSafely(mockPrisma, 'unknown-tenant', (c) => c)
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'TENANT_NOT_FOUND',
      });
    });
  });
});
