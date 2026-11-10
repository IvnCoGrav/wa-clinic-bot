import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isReservationFormMessage,
  registerTenantFormHeaders,
  getTenantFormHeaders,
  DEFAULT_FORM_HEADER_SIGNALS,
} from '../../src/utils/reservation-text-parser';
import { conversationService } from '../../src/services/conversation.service';
import { ConversationState } from '../../src/types';

describe('State Machine Residuals Tests (F4.3: SM-02 & SM-04)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('SM-02: Data-Driven & Tenant-Configured Reservation Form Headers', () => {
    it('mengenali header default reservasi generik', () => {
      expect(isReservationFormMessage('Format Reservasi:\nNama: Siti\nAlamat: Rungkut')).toBe(true);
      expect(isReservationFormMessage('Form Booking:\nNama: Siti\nAlamat: Rungkut')).toBe(true);
      expect(isReservationFormMessage('Berikut list untuk reservasi:\nNama: Siti')).toBe(true);
    });

    it('mendukung customHeaders ad-hoc via options', () => {
      const customText = 'Formulir Pasien Baru Mandiri:\nSaya mau daftar periksa anak saya';
      expect(isReservationFormMessage(customText)).toBe(false); // default belum kenal header ini
      expect(
        isReservationFormMessage(customText, {
          customHeaders: ['formulir pasien baru mandiri'],
        })
      ).toBe(true);
    });

    it('mendukung pendaftaran header per-tenant (registerTenantFormHeaders)', () => {
      const tenantId = 'tenant-klinik-sehat';
      registerTenantFormHeaders(tenantId, ['format pendaftaran homecare']);

      const headers = getTenantFormHeaders(tenantId);
      expect(headers).toContain('format pendaftaran homecare');

      const msg = 'Format Pendaftaran Homecare:\nNama: Anisa';
      expect(isReservationFormMessage(msg, { tenantId })).toBe(true);
    });

    it('mengenali format terstruktur 2 field colon tanpa memerlukan form header', () => {
      const structuredNoHeader = 'Nama Pasien : Adik Arka\nAlamat : Jl. Melati No. 4';
      expect(isReservationFormMessage(structuredNoHeader)).toBe(true);
    });

    it('menolak chat biasa / konsultasi santai (anti-false-positive)', () => {
      expect(isReservationFormMessage('Halo mbak, mau tanya dong ada promo apa bulan ini?')).toBe(false);
      expect(isReservationFormMessage('Anak saya batuk pilek sudah 3 hari, bisa konsul?')).toBe(false);
      expect(isReservationFormMessage('')).toBe(false);
    });
  });

  describe('SM-04: Atomic Session Reset via Prisma $transaction', () => {
    it('menjalankan reset transaksi $transaction mencakup customer dan conversation', async () => {
      const { prisma } = await import('../../src/db/client');

      let transactionCalled = false;
      vi.spyOn(prisma, '$transaction').mockImplementation(async (queries: any) => {
        transactionCalled = true;
        return [true, true];
      });

      await conversationService.resetConversationToInitial('conv-test-1', 'cust-test-1', 'tenant-test');

      expect(transactionCalled).toBe(true);
    });

    it('degradasi secara aman saat basis data offline (fail-safe fallback)', async () => {
      const { prisma } = await import('../../src/db/client');
      vi.spyOn(prisma, '$transaction').mockRejectedValue(new Error('Database offline'));

      // Memastikan fungsi tidak throw dan menangani error secara graceful
      await expect(
        conversationService.resetConversationToInitial('conv-test-2', 'cust-test-2', 'default-tenant')
      ).resolves.not.toThrow();
    });
  });
});
