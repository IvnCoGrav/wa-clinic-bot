import { describe, it, expect, beforeEach } from 'vitest';
import {
  isReservationFormMessage,
  registerTenantFormHeaders,
  clearTenantFormHeadersCacheForTest,
  parseReservationText,
} from '../../src/utils/reservation-text-parser';
import { updateTenantSettingsSafely } from '../../src/routes/admin/settings-helpers';

/**
 * FASE F (Batch F4.5) — Adversarial Multi-Phrasing & Edge-Case Resilience Tests
 *
 * Memastikan sistem tidak rapuh terhadap variasi penulisan bahasa manusia nyata (slang, typo,
 * huruf besar-kecil acak, susunan acak), mencegah false-positive pada percakapan non-booking,
 * dan menjaga isolasi batas antar-tenant saat eksekusi paralel.
 */
describe('Batch F4.5: Adversarial Multi-Phrasing & Edge-Case Hardening', () => {
  beforeEach(() => {
    clearTenantFormHeadersCacheForTest();
  });

  describe('1. Adversarial Real-World Human Booking Form Phrasing', () => {
    it('mengenali form dengan kapitalisasi acak (spongebob/mixed case)', () => {
      const mixedCase = `FoRmAT ReSeRvAsI :
nAmA bUnDa: Bunda Laras
aLaMat : Jl. Melati No. 12
nO hP: 081234567890
tReAtMeNt: Pijat Bayi Rileks
jAdWal : 2026-11-15`;

      expect(isReservationFormMessage(mixedCase)).toBe(true);
      const parsed = parseReservationText(mixedCase);
      expect(parsed.success).toBe(true);
      expect(parsed.reservation?.name).toBe('Bunda Laras');
    });

    it('mengenali form dengan singkatan informal sehari-hari (almt, nm, trtment, tgl)', () => {
      const slangForm = `format booking
nm bunda: Citra
almt : Perum Griya Asri Blok B-2
no telp : 08987654321
trtment : Baby spa & massage
tgl : 25 November 2026`;

      expect(isReservationFormMessage(slangForm)).toBe(true);
    });

    it('mengenali form terstruktur tanpa header eksplisit jika memiliki >= 2 field bertitik dua', () => {
      const noHeaderColonFields = `Nama Bunda : Ibu Indah
Alamat & Shareloc : Jl. Pahlawan No. 45
No WA : 08551234567
Treatment : Pijat laktasi
Jadwal : besok pagi`;

      expect(isReservationFormMessage(noHeaderColonFields)).toBe(true);
      const parsed = parseReservationText(noHeaderColonFields);
      expect(parsed.success).toBe(true);
      expect(parsed.reservation?.name).toBe('Ibu Indah');
    });

    it('mengenali pesan booking model narasi bebas (free-form paragraph)', () => {
      const narrativeBooking = 'Halo bidan, saya mau booking treatment buat anak saya umur 8 bulan alamat di Jalan Ketintang Baru 3 Surabaya ya.';
      expect(isReservationFormMessage(narrativeBooking)).toBe(true);
    });
  });

  describe('2. Anti False-Positive (Percakapan Non-Booking Berisi Kata Mirip)', () => {
    it('TIDAK mendeteksi form pada pesan customer yang sekadar bertanya seputar reservasi', () => {
      const queryChats = [
        'Halo admin, kalau mau booking reservasi biasanya minimal berapa hari sebelumnya ya?',
        'Kemarin kakak saya sudah reservasi, mau tanya kalau ganti jam apakah bisa?',
        'Siang bidan, mau tanya pricelist untuk booking pijat bayi berapa ya?',
        'Apakah jadwal reservasi untuk hari minggu masih ada yang kosong?',
        'Kak, kemarin saya tanya reservasi tapi belum sempat transfer.',
      ];

      for (const text of queryChats) {
        expect(isReservationFormMessage(text)).toBe(false);
      }
    });

    it('TIDAK mendeteksi form pada konsultasi keluhan medis tanpa komitmen booking', () => {
      const medicalQuestions = [
        'Bidan, anak saya batuk pilek sudah 3 hari, ada rekomendasi treatment?',
        'Anak saya newborn 2 minggu sering rewel di malam hari, biasanya dipijat bagian apa ya?',
        'Baby saya GTM parah gamau makan nasi sama sekali bund.',
      ];

      for (const text of medicalQuestions) {
        expect(isReservationFormMessage(text)).toBe(false);
      }
    });
  });

  describe('3. Multi-Tenant Custom Form Header Isolation', () => {
    it('mengisolasi header kustom tenant secara ketat', () => {
      // Daftarkan header kustom untuk dua tenant berbeda (bukan kata sinyal default)
      registerTenantFormHeaders('tenant_alfa', ['order layanan alfa care', 'booking khusus bidan alfa']);
      registerTenantFormHeaders('tenant_beta', ['registrasi khusus klinik beta']);

      const msgAlfa = 'order layanan alfa care\nmohon diproses ya';
      const msgBeta = 'registrasi khusus klinik beta\nmohon dijadwalkan';

      // Tenant Alfa mengenali header miliknya, tetapi TIDAK mengenali header Tenant Beta
      expect(isReservationFormMessage(msgAlfa, { tenantId: 'tenant_alfa' })).toBe(true);
      expect(isReservationFormMessage(msgBeta, { tenantId: 'tenant_alfa' })).toBe(false);

      // Tenant Beta mengenali header miliknya, tetapi TIDAK mengenali header Tenant Alfa
      expect(isReservationFormMessage(msgBeta, { tenantId: 'tenant_beta' })).toBe(true);
      expect(isReservationFormMessage(msgAlfa, { tenantId: 'tenant_beta' })).toBe(false);

      // Default/Global tenant tanpa header khusus tidak mengenali custom header keduanya
      expect(isReservationFormMessage(msgAlfa)).toBe(false);
      expect(isReservationFormMessage(msgBeta)).toBe(false);
    });
  });

  describe('4. Multi-Tenant Concurrent Mutation Resilience', () => {
    it('memastikan mutasi konkuren dua tenant berbeda tidak saling mengganggu', async () => {
      const tenantStores: Record<string, any> = {
        'tenant-t1': {
          id: 'tenant-t1',
          settings: { brand: { name: 'Klinik T1' }, _version: 1 },
          updated_at: new Date('2026-11-10T08:00:00Z'),
        },
        'tenant-t2': {
          id: 'tenant-t2',
          settings: { brand: { name: 'Klinik T2' }, _version: 1 },
          updated_at: new Date('2026-11-10T08:00:00Z'),
        },
      };

      const mockPrisma = {
        tenant: {
          findUnique: async ({ where }: any) => {
            const row = tenantStores[where.id];
            if (!row) return null;
            return {
              id: row.id,
              settings: JSON.parse(JSON.stringify(row.settings)),
              updated_at: new Date(row.updated_at.getTime()),
            };
          },
          updateMany: async ({ where, data }: any) => {
            const row = tenantStores[where.id];
            if (!row) return { count: 0 };
            if (row.updated_at.getTime() === where.updated_at.getTime()) {
              row.settings = JSON.parse(JSON.stringify(data.settings));
              row.updated_at = new Date(row.updated_at.getTime() + 100);
              return { count: 1 };
            }
            return { count: 0 };
          },
        },
      };

      // Jalankan 2 pembaruan bersamaan pada 2 tenant independen
      const p1 = updateTenantSettingsSafely(mockPrisma, 'tenant-t1', (c) => ({
        ...c,
        brand: { ...c.brand, serviceType: 'Homecare' },
      }));

      const p2 = updateTenantSettingsSafely(mockPrisma, 'tenant-t2', (c) => ({
        ...c,
        brand: { ...c.brand, serviceType: 'Klinik & Homecare' },
      }));

      const [res1, res2] = await Promise.all([p1, p2]);

      expect(res1.brand.serviceType).toBe('Homecare');
      expect(res1._version).toBe(2);

      expect(res2.brand.serviceType).toBe('Klinik & Homecare');
      expect(res2._version).toBe(2);

      // Pastikan data tenant 1 dan tenant 2 terpisah secara absolut
      expect(tenantStores['tenant-t1'].settings.brand.name).toBe('Klinik T1');
      expect(tenantStores['tenant-t2'].settings.brand.name).toBe('Klinik T2');
    });
  });
});
