import { describe, it, expect } from 'vitest';
import { evaluatePricelistTrigger } from '../../src/v3/agent/pipeline/pricelist-gate';

/**
 * Fase 4 (anti harga ganda): gambar pricelist otomatis (POST_DELIVERY) DILARANG
 * dikirim bila balasan sudah memuat total resmi. Permintaan eksplisit customer
 * tetap selalu dilayani.
 */
describe('pricelist gate — anti harga ganda', () => {
  const deliveryOk = [{ name: 'calculate_delivery', result: { success: true, isOutOfCoverage: false } }];

  it('POST_DELIVERY jalan saat balasan belum memuat total', () => {
    const v = evaluatePricelistTrigger({ intents: [], executedTools: deliveryOk as any, pricelistSent: false });
    expect(v.send).toBe(true);
    expect(v.reason).toBe('POST_DELIVERY');
  });

  it('POST_DELIVERY DI-SKIP saat balasan sudah memuat total resmi', () => {
    const v = evaluatePricelistTrigger({
      intents: [], executedTools: deliveryOk as any, pricelistSent: false, replyHasTotals: true,
    });
    expect(v.send).toBe(false);
    expect(v.reason).toBe('NONE');
  });

  it('permintaan eksplisit customer tetap dikirim walau sudah ada total', () => {
    const v = evaluatePricelistTrigger({
      intents: ['ask_pricelist_image'], executedTools: deliveryOk as any, pricelistSent: true, replyHasTotals: true,
    });
    expect(v.send).toBe(true);
    expect(v.reason).toBe('EXPLICIT_REQUEST');
  });
});
