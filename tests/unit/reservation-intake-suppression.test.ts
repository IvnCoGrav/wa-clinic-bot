import { describe, it, expect } from 'vitest';
import {
  hasExistingReservationForSchedule,
  shouldShowNeutralExistingReservationBanner,
} from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';
import { parseReservationText } from '../../src/utils/reservation-text-parser';

/**
 * Suite Uji Fondasional: Supresi Form Intake & Pencegahan Reservasi Ganda
 *
 * Menguji kepatuhan kontrak lintas lapisan:
 * 1. Resolusi irisan kategori layanan (MOMS vs BOTH, BUNDLE vs BOTH, KIDS vs BOTH)
 * 2. Isolasi keluhan medis bebas dari kolom treatmentDetail (keluhan masuk ke notes, bukan nama layanan)
 * 3. Status filter supresi (confirmed/completed/hold/pending vs cancelled/failed)
 * 4. Kepatuhan batas kalender WIB same-day vs beda hari
 *
 * Prinsip: Adversarial & multi-parafrase nyata pengguna (anti-overfitting / anti-hafalan kata).
 */

describe('Fase 0 - Supresi Form Intake & Deteksi Reservasi Ganda', () => {
  // Tanggal patokan: 2026-10-16 10:00 WIB (03:00 UTC)
  const targetBookingDate = new Date('2026-10-16T03:00:00.000Z');

  describe('Grup 1: Irisan Kategori Layanan Same-Day (hasExistingReservationForSchedule)', () => {
    it('MOMS (target) vs BOTH (DB) pada hari yang sama harus ter-supresi (return true)', () => {
      const existingReservations = [
        {
          booking_date: '2026-10-16T03:00:00.000Z',
          status: 'confirmed',
          treatment_category: 'BOTH',
          treatment_detail: 'Layanan Homecare Ibu & Anak',
        },
      ];

      const isSuppressed = hasExistingReservationForSchedule(
        existingReservations,
        targetBookingDate,
        'Pijat Nifas & Laktasi',
        'MOMS'
      );

      expect(isSuppressed).toBe(true);
    });

    it('BUNDLE (target) vs BOTH (DB) pada hari yang sama harus ter-supresi (return true)', () => {
      const existingReservations = [
        {
          booking_date: '2026-10-16T03:00:00.000Z',
          status: 'confirmed',
          treatment_category: 'BOTH',
          treatment_detail: 'Paket Bunda & Bayi Sehat',
        },
      ];

      const isSuppressed = hasExistingReservationForSchedule(
        existingReservations,
        targetBookingDate,
        'Paket Bundling Newborn & Ibu',
        'BUNDLE'
      );

      expect(isSuppressed).toBe(true);
    });

    it('BOTH (target) vs BABY (DB) pada hari yang sama harus ter-supresi (return true)', () => {
      const existingReservations = [
        {
          booking_date: '2026-10-16T03:00:00.000Z',
          status: 'confirmed',
          treatment_category: 'BABY',
          treatment_detail: 'Pijat Bayi Ceria',
        },
      ];

      const isSuppressed = hasExistingReservationForSchedule(
        existingReservations,
        targetBookingDate,
        'Paket Ibu dan Bayi',
        'BOTH'
      );

      expect(isSuppressed).toBe(true);
    });

    it('KIDS (target) vs BOTH (DB) pada hari yang sama harus ter-supresi (return true)', () => {
      const existingReservations = [
        {
          booking_date: '2026-10-16T03:00:00.000Z',
          status: 'confirmed',
          treatment_category: 'BOTH',
          treatment_detail: 'Layanan Homecare Keluarga',
        },
      ];

      const isSuppressed = hasExistingReservationForSchedule(
        existingReservations,
        targetBookingDate,
        'Pijat Batuk Pilek Anak',
        'KIDS'
      );

      expect(isSuppressed).toBe(true);
    });

    it('KIDS (target) vs BABY (DB) pada hari yang sama dalam klaster anak harus beririsan (return true)', () => {
      const existingReservations = [
        {
          booking_date: '2026-10-16T03:00:00.000Z',
          status: 'confirmed',
          treatment_category: 'BABY',
          treatment_detail: 'Pijat Anak Sehat',
        },
      ];

      const isSuppressed = hasExistingReservationForSchedule(
        existingReservations,
        targetBookingDate,
        'Pijat Anak Sehat',
        'KIDS'
      );

      expect(isSuppressed).toBe(true);
    });

    it('MOMS (target) vs BABY (DB) murni tanpa overlap kategori/treatment -> false', () => {
      const existingReservations = [
        {
          booking_date: '2026-10-16T03:00:00.000Z',
          status: 'confirmed',
          treatment_category: 'BABY',
          treatment_detail: 'Pijat Bayi Kolik',
        },
      ];

      const isSuppressed = hasExistingReservationForSchedule(
        existingReservations,
        targetBookingDate,
        'Pijat Nifas',
        'MOMS'
      );

      expect(isSuppressed).toBe(false);
    });
  });

  describe('Grup 2: Integritas Parser Teks - Anti-Hijack Keluhan Medis ke Treatment Detail', () => {
    // 6 Ragam variasi kalimat keluhan bebas nyata dari customer pada form WhatsApp
    const complaintPhrasings = [
      'belum tau bun, mau konsultasi keluhan nifas badan pegal linu dan meriang',
      'mau tanya dulu untuk nifas meriang dan jahitan masih ngilu abis sc',
      'belum fix paketnya mau konsul asi mampet dan payudara bengkak nyeri',
      'konsul bidan dulu anak demam batuk pilek grok grok nafas bunyi',
      'nanti dipilihkan bidan aja ya bun keluhan pusing mual pasca bersalin',
      'blm tau mba keluhan badan capek abis lahiran kemarin butuh relaksasi',
    ];

    complaintPhrasings.forEach((complaintText, index) => {
      it(`Variasi ${index + 1}: Keluhan medis tidak boleh mencemari treatmentDetail, wajib masuk momProfile.notes ("${complaintText.slice(0, 35)}...")`, () => {
        const rawForm = `Berikut list untuk reservasi :

Hari dan tanggal : Jumat, 16 Oktober 2026 jam 10.00
Nama Bunda: Bunda Isna
Alamat & Shareloc : Jl. Anggrek No. 25
Kec : Waru
Kota : Sidoarjo
No. Hp : 081234567890

Pilihan treatment (Baby & Kids)

Nama Bayi :
Usia Bayi/Anak :
Treatment :

Pilihan treatment (Moms) :

Usia Kehamilan (Jika hamil):
Treatment : ${complaintText}
`;

        const parsed = parseReservationText(rawForm);
        expect(parsed.success).toBe(true);
        expect(parsed.reservation).toBeDefined();

        const res = parsed.reservation!;
        // treatmentDetail HARUS bersih dari kalimat keluhan panjang
        expect(res.treatmentDetail).not.toContain(complaintText);
        // Teks keluhan wajib dialokasikan ke momProfile.notes
        expect(res.momProfile?.notes).toContain(complaintText);
      });
    });
  });

  describe('Grup 3: Filter Status Reservasi Same-Day', () => {
    // Unifikasi #257-PR: en_route ikut menghambat (Bidan sudah di jalan).
    const activeStatuses = ['confirmed', 'en_route', 'completed', 'hold', 'pending', 'in_progress'];
    const inactiveStatuses = ['cancelled', 'failed', 'no_show', 'rejected'];

    activeStatuses.forEach((st) => {
      it(`Status aktif "${st}" wajib men-supresi banner intake (return true)`, () => {
        const existingReservations = [
          {
            booking_date: '2026-10-16T03:00:00.000Z',
            status: st,
            treatment_category: 'MOMS',
            treatment_detail: 'Pijat Nifas',
          },
        ];

        expect(
          hasExistingReservationForSchedule(
            existingReservations,
            targetBookingDate,
            'Pijat Nifas',
            'MOMS'
          )
        ).toBe(true);
      });
    });

    inactiveStatuses.forEach((st) => {
      it(`Status non-aktif "${st}" TIDAK boleh men-supresi (return false, customer boleh booking ulang)`, () => {
        const existingReservations = [
          {
            booking_date: '2026-10-16T03:00:00.000Z',
            status: st,
            treatment_category: 'MOMS',
            treatment_detail: 'Pijat Nifas',
          },
        ];

        expect(
          hasExistingReservationForSchedule(
            existingReservations,
            targetBookingDate,
            'Pijat Nifas',
            'MOMS'
          )
        ).toBe(false);
      });
    });
  });

  describe('Grup 4: Perbandingan Kalender Tanggal Same-Day vs Beda Hari', () => {
    it('Hari berbeda pada bulan yang sama -> return false', () => {
      const existingReservations = [
        {
          booking_date: '2026-10-17T03:00:00.000Z', // Besoknya
          status: 'confirmed',
          treatment_category: 'MOMS',
          treatment_detail: 'Pijat Nifas',
        },
      ];

      expect(
        hasExistingReservationForSchedule(
          existingReservations,
          targetBookingDate,
          'Pijat Nifas',
          'MOMS'
        )
      ).toBe(false);
    });

    it('Jam berbeda di hari kalender WIB yang sama -> return true untuk kategori yang sama', () => {
      const existingReservations = [
        {
          booking_date: '2026-10-16T08:00:00.000Z', // 15:00 WIB (sore di hari yang sama)
          status: 'confirmed',
          treatment_category: 'MOMS',
          treatment_detail: 'Pijat Nifas',
        },
      ];

      expect(
        hasExistingReservationForSchedule(
          existingReservations,
          targetBookingDate,
          'Pijat Nifas',
          'MOMS'
        )
      ).toBe(true);
    });
  });

  describe('Grup 5: Kontrak Penampil Banner Netral (shouldShowNeutralExistingReservationBanner)', () => {
    const dummyMatchedReservation = {
      id: 'res-123',
      booking_date: '2026-10-16T08:00:00.000Z',
      status: 'confirmed',
    };

    it('Supresi total (return false) jika activeConfirmedReservation sudah tampil di layar (anti dobel-banner)', () => {
      const result = shouldShowNeutralExistingReservationBanner({
        showFormReservasiBanner: false,
        activeConfirmedReservation: { id: 'res-confirmed-friday', booking_date: '2026-10-16T08:00:00.000Z' },
        formBannerKey: 'conv-1|Sabtu 17 Okt|15.00|Pijat',
        dismissedFormBanner: null,
        hasExistingReservationForExtractedSchedule: true,
        matchedExistingReservation: dummyMatchedReservation,
      });

      expect(result).toBe(false);
    });

    it('Mencegah klaim palsu (return false) bila tanggal diekstrak (e.g. Sabtu 17 Okt) BELUM ada di DB', () => {
      const result = shouldShowNeutralExistingReservationBanner({
        showFormReservasiBanner: false,
        activeConfirmedReservation: null,
        formBannerKey: 'conv-1|Sabtu 17 Okt|15.00|Pijat',
        dismissedFormBanner: null,
        hasExistingReservationForExtractedSchedule: false, // Tidak ada di DB!
        matchedExistingReservation: null,
      });

      expect(result).toBe(false);
    });

    it('Supresi (return false) bila banner form reservasi baru sedang aktif', () => {
      const result = shouldShowNeutralExistingReservationBanner({
        showFormReservasiBanner: true,
        activeConfirmedReservation: null,
        formBannerKey: 'conv-1|Sabtu 17 Okt|15.00|Pijat',
        dismissedFormBanner: null,
        hasExistingReservationForExtractedSchedule: true,
        matchedExistingReservation: dummyMatchedReservation,
      });

      expect(result).toBe(false);
    });

    it('Supresi (return false) bila banner sudah di-dismiss user', () => {
      const result = shouldShowNeutralExistingReservationBanner({
        showFormReservasiBanner: false,
        activeConfirmedReservation: null,
        formBannerKey: 'conv-1|Sabtu 17 Okt|15.00|Pijat',
        dismissedFormBanner: 'conv-1|Sabtu 17 Okt|15.00|Pijat',
        hasExistingReservationForExtractedSchedule: true,
        matchedExistingReservation: dummyMatchedReservation,
      });

      expect(result).toBe(false);
    });

    it('Tampil (return true) HANYA bila tidak ada activeConfirmedReservation dan jadwal benar-benar cocok di DB', () => {
      const result = shouldShowNeutralExistingReservationBanner({
        showFormReservasiBanner: false,
        activeConfirmedReservation: null,
        formBannerKey: 'conv-1|Jum 16 Okt|15.00|Pijat',
        dismissedFormBanner: null,
        hasExistingReservationForExtractedSchedule: true,
        matchedExistingReservation: dummyMatchedReservation,
      });

      expect(result).toBe(true);
    });
  });
});
