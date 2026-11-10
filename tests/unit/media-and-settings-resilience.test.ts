import { describe, it, expect, vi } from 'vitest';
import { mediaService } from '../../src/services/media.service';
import { deepMergeSettings, updateTenantSettingsSafely } from '../../src/routes/admin/settings-helpers';
import { isValidExternalUrl, isSafeIpAddress } from '../../src/routes/media.route';
import { getClinicLocationAsync, __clearClinicLocationCacheForTest } from '../../src/config/clinic-location';

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

    it('memblokir IPv4-mapped IPv6 dan alamat IP private/internal pada SSRF guard (S-014)', () => {
      expect(isSafeIpAddress('127.0.0.1')).toBe(false);
      expect(isSafeIpAddress('169.254.169.254')).toBe(false);
      expect(isSafeIpAddress('10.0.0.1')).toBe(false);
      expect(isSafeIpAddress('192.168.1.1')).toBe(false);
      expect(isSafeIpAddress('::ffff:127.0.0.1')).toBe(false);
      expect(isSafeIpAddress('::ffff:169.254.169.254')).toBe(false);
      expect(isSafeIpAddress('::ffff:10.0.0.1')).toBe(false);

      expect(isSafeIpAddress('8.8.8.8')).toBe(true);
      expect(isSafeIpAddress('1.1.1.1')).toBe(true);

      // isValidExternalUrl testing
      expect(isValidExternalUrl('http://127.0.0.1/avatar.jpg')).toBe(false);
      expect(isValidExternalUrl('http://[::ffff:127.0.0.1]/avatar.jpg')).toBe(false);
      expect(isValidExternalUrl('http://[::ffff:169.254.169.254]/avatar.jpg')).toBe(false);
      expect(isValidExternalUrl('http://localhost/avatar.jpg')).toBe(false);
      expect(isValidExternalUrl('https://example.com/valid-avatar.jpg')).toBe(true);
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
        select: { settings: true, updated_at: true },
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

    it('updateTenantSettingsSafely mencegah lost-update pada mutasi concurrent (Cfg-008)', async () => {
      // Simulasikan state tenant di DB dengan timestamp updated_at
      let dbTenant: any = {
        id: 'tenant-occ',
        settings: {
          brand: { name: 'Klinik Kala', logoUrl: 'https://example.com/logo.png' },
          promo: { enabled: true, discountPercent: 10 },
          _version: 1,
        },
        updated_at: new Date('2026-11-10T10:00:00.000Z'),
      };

      const mockPrisma = {
        tenant: {
          findUnique: vi.fn().mockImplementation(async () => {
            // Mengembalikan klon independen dari state DB saat ini
            return {
              id: dbTenant.id,
              settings: JSON.parse(JSON.stringify(dbTenant.settings)),
              updated_at: new Date(dbTenant.updated_at.getTime()),
            };
          }),
          updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
            // Optimistic concurrency check: hanya update bila updated_at di DB cocok dengan where
            if (dbTenant.updated_at.getTime() === where.updated_at.getTime()) {
              dbTenant.settings = JSON.parse(JSON.stringify(data.settings));
              // Simulasikan increment updated_at DB saat row termutasi
              dbTenant.updated_at = new Date(dbTenant.updated_at.getTime() + 100);
              return { count: 1 };
            }
            // Terjadi conflict: row sudah dimutasi oleh operasi lain
            return { count: 0 };
          }),
        },
      };

      // Jalankan dua update paralel secara konkuren
      // Update 1: Nonaktifkan promo
      const op1 = updateTenantSettingsSafely(mockPrisma, 'tenant-occ', (current) => ({
        ...current,
        promo: { ...(current.promo || {}), enabled: false },
      }));

      // Update 2: Ubah nama brand (tapi logoUrl harus tetap ada!)
      const op2 = updateTenantSettingsSafely(mockPrisma, 'tenant-occ', (current) => ({
        ...current,
        brand: { ...(current.brand || {}), name: 'Kala Mom & Baby' },
      }));

      const [res1, res2] = await Promise.all([op1, op2]);

      expect(res1).toBeDefined();
      expect(res2).toBeDefined();

      // State akhir di DB wajib mempertahankan perubahan kedua operasi tanpa ada yang hilang!
      expect(dbTenant.settings.brand.name).toBe('Kala Mom & Baby');
      expect(dbTenant.settings.brand.logoUrl).toBe('https://example.com/logo.png'); // PROPERTI SAUDARA TIDAK HILANG
      expect(dbTenant.settings.promo.enabled).toBe(false); // PROPERTI PROMO TIDAK HILANG
      expect(dbTenant.settings._version).toBe(3); // Dua kali increment versi
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

  describe('CFG-14: Clinic Location Cache TTL', () => {
    it('getClinicLocationAsync menggunakan cache dengan TTL dan fallback default', async () => {
      __clearClinicLocationCacheForTest('tenant-ttl-test');
      const loc = await getClinicLocationAsync('tenant-ttl-test');
      expect(loc).toBeDefined();
      expect(loc.lat).toBeDefined();
      expect(loc.lng).toBeDefined();
      expect(typeof loc.name).toBe('string');
      expect(typeof loc.maxCoverageKm).toBe('number');
    });
  });
});
