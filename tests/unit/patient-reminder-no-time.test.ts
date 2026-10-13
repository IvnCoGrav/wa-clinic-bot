import { describe, it, expect } from 'vitest';
import {
  getRollingFollowUpMessage,
  FollowUpTemplateType,
} from '../../src/config/followup-templates';
import { TEMPLATES } from '../../src/config/persona';
import { getBrandIdentity } from '../../src/config/brand';

describe('Patient Reminder & Booking Confirmation - No Time Leak (Opsi A)', () => {
  const brandName = getBrandIdentity().businessName;
  const timeRegex = /\bjam\b|\bpukul\b|\d{1,2}:\d{2}|WIB/i;

  const testNames = ['R', 'Bunda Rina', 'ibu siti', 'dr. Sarah', 'Aisyah'];
  const testTimes = ['09:30 WIB', '10:00', '14:15 WIB', '', undefined];

  describe('1. REMINDER_H0 (Hari-H) 3 varian tidak boleh membocorkan jam', () => {
    const type: FollowUpTemplateType = 'REMINDER_H0';

    for (let variantIndex = 0; variantIndex < 3; variantIndex++) {
      it(`Varian #${variantIndex + 1} tidak mengandung kata jam/pukul/waktu pada berbagai input nama dan time`, () => {
        for (const name of testNames) {
          for (const time of testTimes) {
            const { text } = getRollingFollowUpMessage(type, {
              name,
              time,
              index: variantIndex,
            });

            // Wajib tidak ada indikator jam
            expect(text).not.toMatch(timeRegex);
            // Wajib menyebut brand identity
            expect(text).toContain(brandName);
            // Tidak boleh kosong atau undefined
            expect(text.length).toBeGreaterThan(20);
          }
        }
      });
    }
  });

  describe('2. REMINDER_H1 (H-1 Malam) 3 varian tidak boleh membocorkan jam', () => {
    const type: FollowUpTemplateType = 'REMINDER_H1';

    for (let variantIndex = 0; variantIndex < 3; variantIndex++) {
      it(`Varian #${variantIndex + 1} tidak mengandung kata jam/pukul/waktu pada berbagai input nama dan time`, () => {
        for (const name of testNames) {
          for (const time of testTimes) {
            const { text } = getRollingFollowUpMessage(type, {
              name,
              time,
              index: variantIndex,
            });

            // Wajib tidak ada indikator jam
            expect(text).not.toMatch(timeRegex);
            // Wajib menyebut brand identity
            expect(text).toContain(brandName);
            // Tidak boleh kosong atau undefined
            expect(text.length).toBeGreaterThan(20);
          }
        }
      });
    }
  });

  describe('3. reservationConfirmed persona template tidak boleh membocorkan jam janji temu', () => {
    it('menghasilkan konfirmasi booking tanpa kata jam atau nilai jam pada tanggal', () => {
      const output = TEMPLATES.reservationConfirmed({
        date: 'Senin, 20 Oktober 2026',
        time: '09:00 WIB',
        name: 'Bunda Rina',
        address: 'Jl. Melati No. 12',
        kec: 'Coblong',
        kota: 'Bandung',
        phone: '628123456789',
        treatmentDetail: '• Baby Massage (60 mnt) = Rp 120.000',
        treatmentPrice: 120000,
        ongkir: 15000,
        promoDiscount: 0,
        total: 135000,
      });

      // Format baris tanggal harus "Hari dan tanggal : Senin, 20 Oktober 2026" tanpa "jam ..."
      expect(output).toContain('Hari dan tanggal : Senin, 20 Oktober 2026');
      expect(output).not.toContain('09:00');
      expect(output).not.toMatch(/Hari dan tanggal\s*:[^\n]*\bjam\b/i);
    });
  });

  describe('4. Negative control: template lain seperti NEXT_TREATMENT tetap berfungsi normal', () => {
    it('NEXT_TREATMENT_1 menghasilkan pesan yang valid dan menyapa dengan benar', () => {
      const { text } = getRollingFollowUpMessage('NEXT_TREATMENT_1', {
        name: 'Bunda Rina',
        babyName: 'Kenzo',
        index: 0,
      });

      expect(text.length).toBeGreaterThan(20);
      expect(text).toContain(brandName);
    });
  });
});
