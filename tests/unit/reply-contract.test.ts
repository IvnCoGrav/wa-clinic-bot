import { describe, it, expect } from 'vitest';
import {
  replyMentionsRupiah,
  replyMentionsDay,
  checkReplyContract,
} from '../../src/v3/agent/pipeline/guardrail-pipeline';

/**
 * Fase 1 (Lapis 1 kontrak jawaban): cek DATA vs JAWABAN — bukan daftar kata
 * baru untuk menebak maksud customer. Sinyal dari bendera AI/sesi (priceAsked,
 * priceDataAvailable, scheduleExpected), bukan pindai teks customer.
 */
describe('reply contract (lapis 1)', () => {
  it('deteksi rupiah teknis (Rp + angka)', () => {
    expect(replyMentionsRupiah('Promo jadi *Rp 60.000* ya Bunda')).toBe(true);
    expect(replyMentionsRupiah('Rp 100.000 totalnya')).toBe(true);
    expect(replyMentionsRupiah('harganya enam puluh ribu')).toBe(false);
    expect(replyMentionsRupiah('')).toBe(false);
  });

  it('deteksi hari dari seam DAY_EVIDENCE_WORDS yang ada', () => {
    expect(replyMentionsDay('bisa hari Selasa ya Bunda')).toBe(true);
    expect(replyMentionsDay('bisa besok ya')).toBe(true);
    expect(replyMentionsDay('untuk hari ini bisa')).toBe(true);
    expect(replyMentionsDay('baik ya Bunda')).toBe(false);
  });

  it('tanpa sinyal harga -> tidak menuduh', () => {
    const r = checkReplyContract('Siap Bunda', { priceAsked: false, priceDataAvailable: false });
    expect(r.missingPrice).toBe(false);
    expect(r.missingSchedule).toBe(false);
  });

  it('customer tanya harga + data ada + balasan tanpa Rp -> missingPrice', () => {
    const r = checkReplyContract('Untuk *Pijat Ceria* ya Bunda', {
      priceAsked: true,
      priceDataAvailable: true,
    });
    expect(r.missingPrice).toBe(true);
  });

  it('customer tanya harga + balasan ada Rp -> OK', () => {
    const r = checkReplyContract('Promo jadi *Rp 60.000* ya Bunda', {
      priceAsked: true,
      priceDataAvailable: true,
    });
    expect(r.missingPrice).toBe(false);
  });

  it('tanya harga tapi data harga TIDAK ada -> tidak dipaksa menyebut Rp', () => {
    const r = checkReplyContract('Baik Bunda, akan kami cekkan dulu', {
      priceAsked: true,
      priceDataAvailable: false,
    });
    expect(r.missingPrice).toBe(false);
  });

  it('jadwal diharapkan + tanpa hari & tanpa CTA -> missingSchedule', () => {
    const r = checkReplyContract('Baik Bunda, kami siapkan perlengkapannya.', {
      scheduleExpected: true,
    });
    expect(r.missingSchedule).toBe(true);
  });

  it('jadwal diharapkan + sudah ada CTA pertanyaan -> tidak missingSchedule', () => {
    const r = checkReplyContract('Baik Bunda, mau kami bantu carikan jadwalnya?', {
      scheduleExpected: true,
    });
    expect(r.missingSchedule).toBe(false);
  });

  it('jadwal diharapkan + sudah ada hari -> tidak missingSchedule', () => {
    const r = checkReplyContract('Baik Bunda, kami cek untuk hari Selasa ya.', {
      scheduleExpected: true,
    });
    expect(r.missingSchedule).toBe(false);
  });

  it('adversarial 6 parafrasa balasan harga (beberapa tanpa kata "harga")', () => {
    const withRupiah = [
      'Promo bulan ini *Rp 60.000* saja Bunda',
      'untuk paket ceria jadi 60rb ya', // tanpa 'Rp' -> dianggap missing (jujur)
      '*Rp 80.000* normal, promo *Rp 60.000*',
      'total keseluruhan *Rp 100.000*',
      'ongkir promo *Rp 15.000* ya Bunda',
      'cukup *Rp 50.000* saja',
    ];
    const results = withRupiah.map((t) =>
      checkReplyContract(t, { priceAsked: true, priceDataAvailable: true }).missingPrice
    );
    // Yang memuat 'Rp <angka>' WAJIB lolos; yang hanya '60rb' jujur dianggap missing.
    expect(results[0]).toBe(false);
    expect(results[1]).toBe(true);
    expect(results[2]).toBe(false);
    expect(results[3]).toBe(false);
    expect(results[4]).toBe(false);
    expect(results[5]).toBe(false);
  });
});
