import { describe, it, expect } from 'vitest';
import { buildPriceAnswer, isAskPrice, isPricelistLostRequest } from '../../src/services/price-answer.service';

/**
 * Price-answer unit tests (Task: Resolusi Anaphora).
 * "berapa itu bund?" yang merujuk ke treatment yang barusan direkomendasikan bot
 * harus menampilkan HARGA spesifik — bukan pricelist generik.
 */

describe('isAskPrice', () => {
  it('mendeteksi pertanyaan harga generik "berapa itu bund?"', () => {
    expect(isAskPrice('berapa itu bund ?', ['ask_price'])).toBe(true);
  });

  it('tidak salah-detect jadwal "jam buka berapa?" sebagai harga', () => {
    expect(isAskPrice('jam buka berapa?', ['ask_price', 'ask_schedule'])).toBe(false);
  });

  it('tidak detect tanpa intent NLU dan tanpa kata kunci harga', () => {
    expect(isAskPrice('halo kak', [])).toBe(false);
  });
});

describe('isPricelistLostRequest', () => {
  it('mendeteksi minta kirim ulang pricelist', () => {
    expect(isPricelistLostRequest('pricelist tidak terkirim')).toBe(true);
  });

  it('tidak false-positive untuk pertanyaan harga biasa', () => {
    expect(isPricelistLostRequest('berapa harga pijat bayi?')).toBe(false);
  });
});

describe('buildPriceAnswer — Resolusi Anaphora', () => {
  const baseOpts = { hasLocation: true, pricelistAlreadySent: false };

  it('pesan generik + kandidat treatment dari riwayat → tampilkan harga SPESIFIK', () => {
    const res = buildPriceAnswer('berapa itu bund ?', {
      ...baseOpts,
      candidateTreatmentName: 'Pijat Bayi Pulih Ceria',
    });
    expect(res.replyText).toContain('Pijat Bayi Pulih Ceria');
    expect(res.replyText).toContain('Rp70.000');
    expect(res.replyText).not.toContain('pricelist dari kami');
    expect(res.pricelist).toBeUndefined();
  });

  it('tanpa kandidat & tanpa nama treatment → tetap pricelist generik (tidak regresi)', () => {
    const res = buildPriceAnswer('berapa itu bund ?', baseOpts);
    expect(res.pricelist).toBeTruthy();
    expect(res.pricelist!.caption).toContain('pricelist dari kami');
  });

  it('pesan berisi nama treatment eksplisit → harga spesifik tanpa riwayat', () => {
    const res = buildPriceAnswer('harga pijat bayi ceria berapa ya?', baseOpts);
    expect(res.replyText).toContain('Pijat Bayi Ceria');
    expect(res.replyText).toContain('Rp60.000');
    expect(res.pricelist).toBeUndefined();
  });

  it('minta pricelist ulang tetap prioritas (walau ada kandidat)', () => {
    const res = buildPriceAnswer('pricelist tidak terkirim bund', {
      ...baseOpts,
      candidateTreatmentName: 'Pijat Bayi Ceria',
    });
    expect(res.pricelist?.force).toBe(true);
  });

  it('sudah pernah kirim pricelist & generik tanpa kandidat → hanya caption teks', () => {
    const res = buildPriceAnswer('berapa itu bund ?', {
      hasLocation: true,
      pricelistAlreadySent: true,
    });
    expect(res.pricelist).toBeUndefined();
    expect(res.replyText).toContain('pricelist dari kami');
  });
});
