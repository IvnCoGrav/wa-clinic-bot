import { describe, it, expect } from 'vitest';
import { verifyDayMentioned as originalVerifyDayMentioned } from '../../src/v3/tools/save-reservation.tool';
import {
  verifyDayMentioned as extractedVerifyDayMentioned,
  isDateConfirmed,
  isSameDayRequestText as extractedIsSameDay,
} from '../../src/utils/date-confirmation';

describe('Date Confirmation Parity Test (Before vs After)', () => {
  const testCases: Array<{
    name: string;
    bookingDate: string | undefined;
    evidence: string[] | undefined;
  }> = [
    {
      name: 'Tanpa evidence (kompatibilitas)',
      bookingDate: 'Sabtu, 20 September 2026',
      evidence: undefined,
    },
    {
      name: 'Evidence kosong',
      bookingDate: 'Sabtu',
      evidence: [],
    },
    {
      name: 'Booking date kosong',
      bookingDate: '',
      evidence: ['Saya mau hari Sabtu'],
    },
    {
      name: 'Booking date spasi',
      bookingDate: '   ',
      evidence: ['Saya mau hari Sabtu'],
    },
    {
      name: 'Hari disebut tegas (Sabtu)',
      bookingDate: 'Sabtu',
      evidence: ['Halo kak', 'Bisa booking hari Sabtu ya'],
    },
    {
      name: 'Hari disebut dengan kalimat tanya saja (audit fail-closed)',
      bookingDate: 'Sabtu',
      evidence: ['Bisa hari Sabtu?'],
    },
    {
      name: 'Hari disebut tanya lalu ditegaskan di turn berikutnya',
      bookingDate: 'Sabtu',
      evidence: ['Bisa hari Sabtu?', 'Iya saya fix ambil hari Sabtu'],
    },
    {
      name: 'Same-day request (sekarang)',
      bookingDate: 'sekarang',
      evidence: ['bisa sekarang kak?'],
    },
    {
      name: 'Same-day request alias (nanti sore)',
      bookingDate: 'hari ini',
      evidence: ['kalau nanti sore apakah bidan ready?'],
    },
    {
      name: 'Bukan hari tapi usia minggu (3 minggu)',
      bookingDate: 'Minggu',
      evidence: ['anak saya baru 3 minggu nih kak'],
    },
    {
      name: 'Hari Minggu asli vs usia minggu',
      bookingDate: 'Minggu',
      evidence: ['anak saya 3 minggu', 'mau booking hari Minggu besok'],
    },
    {
      name: 'Tanggal numerik ada di chat (tgl 25)',
      bookingDate: '2026-09-25',
      evidence: ['saya mau tanggal 25 ya kak'],
    },
    {
      name: 'Tanggal numerik tidak ada di chat (tgl 15 vs 25)',
      bookingDate: '2026-09-15',
      evidence: ['saya bisanya tgl 25'],
    },
    {
      name: 'Customer hanya bilang siap (tanpa bukti hari)',
      bookingDate: 'Besok',
      evidence: ['siap', 'baik kak'],
    },
    {
      name: 'Customer konfirmasi besok',
      bookingDate: 'Besok',
      evidence: ['iya besok boleh kak'],
    },
  ];

  for (const tc of testCases) {
    it(`Paritas 100%: ${tc.name}`, () => {
      const originalResult = originalVerifyDayMentioned(tc.bookingDate, tc.evidence);
      const extractedResult = extractedVerifyDayMentioned(tc.bookingDate, tc.evidence);

      // 1. Output string/null wajib byte-for-byte identik
      expect(extractedResult).toBe(originalResult);

      // 2. isDateConfirmed wajib konsisten dengan error null/non-null
      const verdict = isDateConfirmed(tc.bookingDate, tc.evidence);
      expect(verdict.confirmed).toBe(originalResult === null);
      expect(verdict.rejectionReason).toBe(originalResult);
    });
  }
});
