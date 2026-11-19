import { describe, it, expect } from 'vitest';
import { evaluatePurchaseValueMutation } from '../../src/domain/purchase-value-guard';

/**
 * Kontrak D3 (keputusan bisnis 2026-11-19):
 * nilai transaksi TETAP boleh diubah setelah event Purchase terkirim.
 * Guard hanya memperingatkan (default `warn`); `block` harus opt-in eksplisit.
 */
describe('purchase-value-guard — evaluasi murni mutasi nilai pasca CAPI', () => {
  const SENT_AT = new Date('2026-11-18T10:00:00.000Z');

  it('pengisian awal (null/0 -> nilai) bukan mutasi dan tidak memicu guard', () => {
    expect(
      evaluatePurchaseValueMutation({
        previousValue: null,
        nextValue: 85000,
        purchaseEventSentAt: SENT_AT,
      })
    ).toMatchObject({ changed: false, afterDelivery: true, blocked: false, warning: undefined });

    expect(
      evaluatePurchaseValueMutation({
        previousValue: 0,
        nextValue: 85000,
        purchaseEventSentAt: SENT_AT,
      })
    ).toMatchObject({ changed: false, blocked: false, warning: undefined });
  });

  it('nilai sama persis tidak menghasilkan warning', () => {
    expect(
      evaluatePurchaseValueMutation({
        previousValue: 85000,
        nextValue: 85000,
        purchaseEventSentAt: SENT_AT,
      })
    ).toMatchObject({ changed: false, blocked: false, warning: undefined });
  });

  it('nilai berubah setelah event terkirim -> warning, tetapi TETAP tidak diblokir pada mode warn', () => {
    const verdict = evaluatePurchaseValueMutation({
      previousValue: 85000,
      nextValue: 95000,
      purchaseEventSentAt: SENT_AT.toISOString(),
      mode: 'warn',
    });
    expect(verdict.changed).toBe(true);
    expect(verdict.afterDelivery).toBe(true);
    expect(verdict.blocked).toBe(false);
    expect(verdict.warning).toContain('85000');
    expect(verdict.warning).toContain('95000');
    expect(verdict.warning).toContain(SENT_AT.toISOString());
  });

  it('mode block hanya memblokir bila event sudah terkirim', () => {
    expect(
      evaluatePurchaseValueMutation({
        previousValue: 85000,
        nextValue: 95000,
        purchaseEventSentAt: null,
        mode: 'block',
      }).blocked
    ).toBe(false);

    expect(
      evaluatePurchaseValueMutation({
        previousValue: 85000,
        nextValue: 95000,
        purchaseEventSentAt: SENT_AT,
        mode: 'block',
      }).blocked
    ).toBe(true);
  });

  it('mode off tidak memblokir dan tidak menulis warning', () => {
    const verdict = evaluatePurchaseValueMutation({
      previousValue: 85000,
      nextValue: 95000,
      purchaseEventSentAt: SENT_AT,
      mode: 'off',
    });
    expect(verdict.changed).toBe(true);
    expect(verdict.blocked).toBe(false);
    expect(verdict.warning).toBeUndefined();
  });

  it('nilai string numerik dinormalisasi dan NaN tidak dianggap mutasi', () => {
    expect(
      evaluatePurchaseValueMutation({
        previousValue: '85000' as unknown as number,
        nextValue: '95000' as unknown as number,
        purchaseEventSentAt: SENT_AT,
      }).changed
    ).toBe(true);

    expect(
      evaluatePurchaseValueMutation({
        previousValue: 85000,
        nextValue: 'bukan-angka' as unknown as number,
        purchaseEventSentAt: SENT_AT,
      }).changed
    ).toBe(false);
  });

  it('tanggal terkirim berupa string tidak valid tetap menghasilkan warning yang aman', () => {
    const verdict = evaluatePurchaseValueMutation({
      previousValue: 100000,
      nextValue: 90000,
      purchaseEventSentAt: 'bukan-tanggal',
    });
    expect(verdict.blocked).toBe(false);
    expect(verdict.warning).toContain('bukan-tanggal');
  });
});
