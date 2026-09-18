import { describe, it, expect } from 'vitest';
import { extractFastIntents } from '../../../src/v3/agent/persona';
import { ToolExecutionPipeline } from '../../../src/v3/agent/pipeline/tool-pipeline';

/**
 * Fase 1 — Deterministic Tool-Arg Gate.
 *
 * Kontrak: keputusan "customer bertanya harga/ongkir atau tidak" adalah aturan
 * bisnis DETERMINISTIK berbasis teks customer (via extractFastIntents),
 * BUKAN boolean yang diisi LLM router. Test ini mengunci sumber kebenaran
 * intent yang dipakai seam tool-pipeline.
 *
 * Bukti regresi asal (Kasus #9 T3): LLM mengisi asksDeliveryFee:true pada
 * pesan murni lokasi "Wisma indah 2 K5 gunung anyar tambak".
 */
describe('Fase 1 — deterministic price/ongkir intent gate', () => {
  const hasAskPrice = (t: string): boolean => extractFastIntents(t).includes('ask_price');

  it('pesan MURNI LOKASI (tanpa kata biaya) → ask_price FALSE', () => {
    const phrases = [
      'Wisma indah 2 K5 gunung anyar tambak',
      'Di tenggilis kak',
      'kutisari indah surabaya',
      'rumah saya di babatan pilang wiyung',
      'kalau ke jade hamlet menganti',
    ];
    for (const p of phrases) {
      expect(hasAskPrice(p), `"${p}" tidak boleh memicu ask_price`).toBe(false);
    }
  });

  it('pertanyaan ongkir/biaya eksplisit → ask_price TRUE', () => {
    const phrases = [
      'Ongkirnya brp ya?',
      'Berapa biaya ke Wisma Indah?',
      'ada ongkir ga kak?',
      'totalnya berapa ya bund',
      'tarifnya berapa kak',
      'ada promo gak?',
      'harganya berapa mbak',
    ];
    for (const p of phrases) {
      expect(hasAskPrice(p), `"${p}" harus memicu ask_price`).toBe(true);
    }
  });

  it('pertanyaan durasi murni BUKAN harga (anti false-positive)', () => {
    expect(hasAskPrice('pijat bayi biasanya brp menit kak')).toBe(false);
    expect(hasAskPrice('durasi perawatannya berapa lama ya')).toBe(false);
  });

  it('pertanyaan usia/jadwal BUKAN harga', () => {
    expect(hasAskPrice('bayi usia berapa minimal boleh dipijat')).toBe(false);
    expect(hasAskPrice('besok ada slot kosong kak?')).toBe(false);
  });

  it('detectPriceIntent: nominal eksplisit terdeteksi, "1 jam" tidak', async () => {
    const nominal = await ToolExecutionPipeline.detectPriceIntent('Kalau 100rb berapa menit?');
    expect(nominal.mentionsNominal).toBe(true);

    const jam = await ToolExecutionPipeline.detectPriceIntent('1 jam');
    expect(jam.mentionsNominal).toBe(false);
    expect(jam.asksPrice).toBe(false);
  });
});
