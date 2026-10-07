import { describe, it, expect } from 'vitest';
import {
  isReservationPaid,
  getPaymentDisplayStatus,
  getPaymentDisplayLabel,
} from '../../src/domain/reservation-payment';

/**
 * Kontrak seam kanonis status finansial (Revisi-1 Opsi B).
 *
 * Prinsip: "selesai dikerjakan" BUKAN bukti "uang diterima". Reservasi
 * `completed` tanpa `purchase_occurred_at` HARUS TIDAK dilabeli
 * "Tagih di Tempat" (yang mengesankan kunjungan belum terjadi), tapi
 * `SELESAI_BELUM_VERIFIKASI`.
 */
describe('reservation-payment — seam kanonis status bayar (tri-state)', () => {
  it('completed + purchase_occurred_at NULL → SELESAI_BELUM_VERIFIKASI (bukan TAGIH_DI_TEMPAT)', () => {
    expect(getPaymentDisplayStatus({ status: 'completed', purchase_occurred_at: null })).toBe(
      'SELESAI_BELUM_VERIFIKASI'
    );
  });

  it('completed + purchase_occurred_at ada → LUNAS', () => {
    expect(getPaymentDisplayStatus({ status: 'completed', purchase_occurred_at: new Date() })).toBe('LUNAS');
  });

  it('confirmed + purchase_occurred_at NULL → TAGIH_DI_TEMPAT', () => {
    expect(getPaymentDisplayStatus({ status: 'confirmed', purchase_occurred_at: null })).toBe('TAGIH_DI_TEMPAT');
  });

  it('en_route + purchase_occurred_at ada (dibayar di muka) → LUNAS', () => {
    expect(getPaymentDisplayStatus({ status: 'en_route', purchase_occurred_at: '2026-10-01T04:30:00.000Z' })).toBe(
      'LUNAS'
    );
  });

  // Adversarial: bentuk tanggal berbeda tetap konsisten (ISO string vs Date vs undefined).
  it('adversarial: purchase_occurred_at sebagai ISO string tetap LUNAS', () => {
    expect(isReservationPaid({ purchase_occurred_at: '2026-10-01T04:30:00.000Z' })).toBe(true);
    expect(getPaymentDisplayStatus({ status: 'completed', purchase_occurred_at: '2026-10-01T04:30:00.000Z' })).toBe(
      'LUNAS'
    );
  });

  it('adversarial: status null/undefined tanpa tanggal → TAGIH_DI_TEMPAT (fail-safe, bukan crash)', () => {
    expect(getPaymentDisplayStatus(null)).toBe('TAGIH_DI_TEMPAT');
    expect(getPaymentDisplayStatus(undefined)).toBe('TAGIH_DI_TEMPAT');
    expect(getPaymentDisplayStatus({ status: null, purchase_occurred_at: null })).toBe('TAGIH_DI_TEMPAT');
  });

  it('adversarial: status COMPLETED huruf besar tetap dikenali (case-insensitive)', () => {
    expect(getPaymentDisplayStatus({ status: 'COMPLETED', purchase_occurred_at: null })).toBe(
      'SELESAI_BELUM_VERIFIKASI'
    );
  });

  it('cancelled tanpa tanggal → TAGIH_DI_TEMPAT (seam tidak menebak; pemanggil menyaring cancelled)', () => {
    expect(getPaymentDisplayStatus({ status: 'cancelled', purchase_occurred_at: null })).toBe('TAGIH_DI_TEMPAT');
  });

  it('label deterministik per status', () => {
    expect(getPaymentDisplayLabel('LUNAS')).toBe('Lunas');
    expect(getPaymentDisplayLabel('SELESAI_BELUM_VERIFIKASI')).toContain('verifikasi');
    expect(getPaymentDisplayLabel('TAGIH_DI_TEMPAT')).toBe('Tagih di Tempat');
  });
});
