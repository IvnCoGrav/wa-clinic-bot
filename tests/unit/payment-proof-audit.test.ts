import { describe, it, expect } from 'vitest';
import {
  classifyReservationForAudit,
  summarizeAuditFindings,
  PAYMENT_PROOF_FINDING,
  type ReservationAuditInput,
} from '../../src/domain/payment-proof-audit';

const NOW = new Date('2026-11-19T03:00:00.000Z'); // 10:00 WIB
const DAY = 24 * 60 * 60 * 1000;

function base(overrides: Partial<ReservationAuditInput> = {}): ReservationAuditInput {
  return {
    status: 'confirmed',
    bookingDate: new Date(NOW.getTime() + 2 * DAY),
    proofUrl: null,
    purchaseOccurredAt: null,
    receiptAmount: null,
    expectedTotal: 155000,
    paymentMethod: null,
    proofFileExists: null,
    windowBeforeDays: 7,
    windowAfterDays: 7,
    now: NOW,
    ...overrides,
  };
}

describe('payment-proof-audit (klasifikasi murni)', () => {
  it('menandai reservasi aktif tanpa bukti sebagai MISSING_PROOF', () => {
    const res = classifyReservationForAudit(base());
    expect(res.codes).toContain(PAYMENT_PROOF_FINDING.MISSING_PROOF);
    expect(res.severity).toBe('MEDIUM');
    expect(res.codes).not.toContain(PAYMENT_PROOF_FINDING.OUTSIDE_MATCH_WINDOW);
  });

  it('booking +26 jam (replika kasus transfer H-1) TIDAK di luar jendela', () => {
    const res = classifyReservationForAudit(
      base({ bookingDate: new Date(NOW.getTime() + 26.3 * 60 * 60 * 1000) })
    );
    expect(res.codes).toContain(PAYMENT_PROOF_FINDING.MISSING_PROOF);
    expect(res.codes).not.toContain(PAYMENT_PROOF_FINDING.OUTSIDE_MATCH_WINDOW);
  });

  it('booking +8 hari di luar jendela 7 hari ditandai OUTSIDE_MATCH_WINDOW', () => {
    const res = classifyReservationForAudit(
      base({ bookingDate: new Date(NOW.getTime() + 8 * DAY) })
    );
    expect(res.codes).toContain(PAYMENT_PROOF_FINDING.OUTSIDE_MATCH_WINDOW);
  });

  it('booking tanpa tanggal memakai fallback terakhir dan ditandai OUTSIDE_MATCH_WINDOW', () => {
    const res = classifyReservationForAudit(base({ status: 'pending', bookingDate: null }));
    expect(res.codes).toContain(PAYMENT_PROOF_FINDING.MISSING_PROOF);
    expect(res.codes).toContain(PAYMENT_PROOF_FINDING.OUTSIDE_MATCH_WINDOW);
    expect(res.notes.join(' ')).toContain('tanpa tanggal');
  });

  it('bukti di folder inbound ditandai PRUNABLE_STORAGE (HIGH)', () => {
    const res = classifyReservationForAudit(
      base({
        proofUrl: '/media/inbound/default-tenant/abc.jpg',
        proofFileExists: true,
        purchaseOccurredAt: NOW,
        receiptAmount: 155000,
      })
    );
    expect(res.codes).toContain(PAYMENT_PROOF_FINDING.PROOF_IN_PRUNABLE_STORAGE);
    expect(res.severity).toBe('HIGH');
  });

  it('bukti di payment-proofs tetapi berkas hilang ditandai PROOF_FILE_MISSING (HIGH)', () => {
    const res = classifyReservationForAudit(
      base({
        proofUrl: '/media/payment-proofs/default-tenant/abc.jpg',
        proofFileExists: false,
        purchaseOccurredAt: NOW,
        receiptAmount: 155000,
      })
    );
    expect(res.codes).toContain(PAYMENT_PROOF_FINDING.PROOF_FILE_MISSING);
    expect(res.severity).toBe('HIGH');
    expect(res.codes).not.toContain(PAYMENT_PROOF_FINDING.PROOF_IN_PRUNABLE_STORAGE);
  });

  it('lunas non-tunai tanpa bukti ditandai PAID_WITHOUT_PROOF (MEDIUM)', () => {
    const res = classifyReservationForAudit(
      base({ purchaseOccurredAt: NOW, paymentMethod: 'Transfer BCA' })
    );
    expect(res.codes).toContain(PAYMENT_PROOF_FINDING.PAID_WITHOUT_PROOF);
    expect(res.severity).toBe('MEDIUM');
    expect(res.codes).not.toContain(PAYMENT_PROOF_FINDING.MISSING_PROOF);
  });

  it('lunas tunai tanpa bukti hanya LOW (wajar)', () => {
    const res = classifyReservationForAudit(
      base({ purchaseOccurredAt: NOW, paymentMethod: 'CASH' })
    );
    expect(res.codes).toContain(PAYMENT_PROOF_FINDING.PAID_WITHOUT_PROOF);
    expect(res.severity).toBe('LOW');
  });

  it('nominal bukti berbeda dari tagihan ditandai AMOUNT_MISMATCH', () => {
    const res = classifyReservationForAudit(
      base({
        proofUrl: '/media/payment-proofs/default-tenant/abc.jpg',
        proofFileExists: true,
        purchaseOccurredAt: NOW,
        receiptAmount: 150000,
        expectedTotal: 155000,
      })
    );
    expect(res.codes).toContain(PAYMENT_PROOF_FINDING.AMOUNT_MISMATCH);
    expect(res.notes.join(' ')).toContain('150000');
  });

  it('nominal cocok tidak menghasilkan AMOUNT_MISMATCH', () => {
    const res = classifyReservationForAudit(
      base({
        proofUrl: '/media/payment-proofs/default-tenant/abc.jpg',
        proofFileExists: true,
        purchaseOccurredAt: NOW,
        receiptAmount: 155000,
      })
    );
    expect(res.codes).not.toContain(PAYMENT_PROOF_FINDING.AMOUNT_MISMATCH);
  });

  it('status cancelled/rejected diabaikan sepenuhnya', () => {
    const res = classifyReservationForAudit(base({ status: 'cancelled', proofUrl: null }));
    expect(res.codes).toHaveLength(0);
    expect(res.severity).toBe('NONE');
    expect(res.notes).toContain('SKIPPED_TERMINAL_STATUS');
  });

  it('summarizeAuditFindings menghitung per severity dan per kode', () => {
    const summary = summarizeAuditFindings([
      { severity: 'HIGH', codes: [PAYMENT_PROOF_FINDING.PROOF_FILE_MISSING] },
      { severity: 'MEDIUM', codes: [PAYMENT_PROOF_FINDING.MISSING_PROOF] },
      { severity: 'MEDIUM', codes: [PAYMENT_PROOF_FINDING.MISSING_PROOF] },
      { severity: 'LOW', codes: [PAYMENT_PROOF_FINDING.PAID_WITHOUT_PROOF] },
    ]);
    expect(summary.total).toBe(4);
    expect(summary.bySeverity.HIGH).toBe(1);
    expect(summary.bySeverity.MEDIUM).toBe(2);
    expect(summary.bySeverity.LOW).toBe(1);
    expect(summary.byCode[PAYMENT_PROOF_FINDING.MISSING_PROOF]).toBe(2);
  });
});
