/**
 * pricelist-gate.ts — Gerbang keputusan deterministik pengiriman gambar pricelist.
 *
 * Modul MURNI (zero LLM, zero regex hafalan kalimat, zero I/O). Keputusan
 * bersandar pada KONTRAK DATA yang sudah dihitung pipeline lain:
 *  - intent semantik dari `extractFastIntents` (token data-driven), dan
 *  - hasil eksekusi tool `calculate_delivery` yang sesungguhnya (raw result,
 *    bukan payload LLM-safe). Field yang dibaca: `success` & `isOutOfCoverage`
 *    (kontrak CalculateDeliveryOutput di calculate-delivery.tool.ts).
 *
 * Dua trigger:
 *  - EXPLICIT_REQUEST: customer meminta gambar/katalog (ask_pricelist_image).
 *    Selalu force-resend (menembus kuota 1x) — rate-limit ditangani pemanggil.
 *  - POST_DELIVERY: ongkir berhasil dihitung & dalam jangkauan untuk PERTAMA
 *    kali (pricelistSent=false). Anti-spam: 1x per customer.
 */

export interface PricelistGateInput {
  /** Intent semantik (mis. dari extractFastIntents) — termasuk 'ask_pricelist_image'. */
  intents: string[];
  /** Hasil tool eksekusi turn ini (raw result sebelum di-mask untuk LLM). */
  executedTools: Array<{ name: string; result?: any }>;
  /** Status kuota 1x: true bila customer sudah pernah menerima gambar pricelist. */
  pricelistSent: boolean;
}

export type PricelistGateReason = 'EXPLICIT_REQUEST' | 'POST_DELIVERY' | 'NONE';

export interface PricelistGateVerdict {
  send: boolean;
  forceResend: boolean;
  reason: PricelistGateReason;
}

const NONE_VERDICT: PricelistGateVerdict = { send: false, forceResend: false, reason: 'NONE' };

export function evaluatePricelistTrigger(input: PricelistGateInput): PricelistGateVerdict {
  // 1. Prioritas utama: permintaan eksplisit customer (bypass kuota 1x).
  if ((input.intents || []).includes('ask_pricelist_image')) {
    return { send: true, forceResend: true, reason: 'EXPLICIT_REQUEST' };
  }

  // 2. Trigger post-delivery: ongkir sukses & dalam jangkauan, pertama kali.
  const delivery = (input.executedTools || []).find((t) => t?.name === 'calculate_delivery');
  const deliveryOk =
    delivery?.result?.success === true && delivery.result.isOutOfCoverage !== true;
  if (deliveryOk && !input.pricelistSent) {
    return { send: true, forceResend: false, reason: 'POST_DELIVERY' };
  }

  return NONE_VERDICT;
}
