import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { resolvePaymentProofPolicy } from '../../src/services/payment-proof-config.service';
import {
  clampPaymentProofWindowDays,
  PAYMENT_PROOF_WINDOW_DEFAULT_DAYS,
  PAYMENT_PROOF_WINDOW_MAX_DAYS,
  PAYMENT_PROOF_WINDOW_MIN_DAYS,
} from '../../src/domain/payment-proof-window';

const TENANT = 'default-tenant';

describe('payment-proof policy (jendela pencocokan bukti bayar)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('DB offline / tenant tidak ditemukan → fallback 7/7', async () => {
    const policy = await resolvePaymentProofPolicy(TENANT);
    expect(policy).toEqual({ windowBeforeDays: 7, windowAfterDays: 7 });
  });

  it('membaca nilai tersimpan di Tenant.settings', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      settings: { paymentProofWindowDaysBefore: 3, paymentProofWindowDaysAfter: 10 },
    } as any);

    const policy = await resolvePaymentProofPolicy(TENANT);
    expect(policy).toEqual({ windowBeforeDays: 3, windowAfterDays: 10 });
  });

  it('mendukung alias snake_case dari settings lama', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      settings: { payment_proof_window_days_before: 5, payment_proof_window_days_after: 14 },
    } as any);

    const policy = await resolvePaymentProofPolicy(TENANT);
    expect(policy).toEqual({ windowBeforeDays: 5, windowAfterDays: 14 });
  });

  it('nilai invalid (negatif/string/null) jatuh ke fallback 7/7', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      settings: {
        paymentProofWindowDaysBefore: -3,
        paymentProofWindowDaysAfter: 'abc',
      },
    } as any);

    const policy = await resolvePaymentProofPolicy(TENANT);
    expect(policy).toEqual({ windowBeforeDays: 7, windowAfterDays: 7 });
  });

  describe('clampPaymentProofWindowDays (batas 1..30)', () => {
    it('menjepit nilai terlalu besar ke 30', () => {
      expect(clampPaymentProofWindowDays(999)).toBe(PAYMENT_PROOF_WINDOW_MAX_DAYS);
    });

    it('menjepit 0 dan negatif ke 1 (otomasi tidak bisa dimatikan lewat field ini)', () => {
      expect(clampPaymentProofWindowDays(0)).toBe(PAYMENT_PROOF_WINDOW_MIN_DAYS);
      expect(clampPaymentProofWindowDays(-5)).toBe(PAYMENT_PROOF_WINDOW_MIN_DAYS);
    });

    it('membulatkan desimal dan memakai fallback untuk non-angka', () => {
      expect(clampPaymentProofWindowDays(7.4)).toBe(7);
      expect(clampPaymentProofWindowDays(7.6)).toBe(8);
      expect(clampPaymentProofWindowDays(undefined)).toBe(PAYMENT_PROOF_WINDOW_DEFAULT_DAYS);
      expect(clampPaymentProofWindowDays('7' as any)).toBe(PAYMENT_PROOF_WINDOW_DEFAULT_DAYS);
    });
  });
});
