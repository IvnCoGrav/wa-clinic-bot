/**
 * src/v3/guardrails/numeric-fact-validator.ts
 * Memvalidasi apakah semua nominal rupiah di teks balasan cocok dengan data tool resmi.
 *
 * Composite Pricing: selain harga tunggal resmi, total aritmatika yang sah
 * (layanan + ongkir, layanan + add-on, akumulasi keranjang/session) ikut
 * diotorisasi agar balasan cerdas LLM yang menghitung total tidak dibuang
 * sebagai false-positive halusinasi.
 */

import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';

export interface NumericValidationResult {
  isValid: boolean;
  violations: string[];
}

export interface NumericValidationOptions {
  tenantId?: string;
  session?: {
    totalPrice?: number;
    cartItems?: Array<{ price: number; promoPrice?: number | null }>;
    location?: { ongkirPromo?: number | null; ongkirNormal?: number | null };
  };
}

export function validateNumericFacts(
  replyText: string,
  executedTools: Array<{ name: string; result: any }>,
  opts?: NumericValidationOptions
): NumericValidationResult {
  const violations: string[] = [];

  // Ekstrak semua nominal Rp di teks balasan (misal "Rp 70.000" -> 70000).
  // Regex ini ekstraksi numerik teknis (bukan gatekeeper intent / mutilasi semantik).
  const priceMatches = replyText.match(/Rp\s*(\d{1,3}(?:\.\d{3})*)/gi);
  if (!priceMatches) {
    return { isValid: true, violations: [] };
  }

  // Kumpulkan himpunan harga resmi yang disetujui dari tool yang dieksekusi di turn ini
  const authorizedNumbers = new Set<number>();
  authorizedNumbers.add(0); // Gratis ongkir

  const servicePromo: number[] = [];
  const serviceOriginal: number[] = [];
  const addonPrices: number[] = [];
  const ongkirPromoList: number[] = [];
  const ongkirNormalList: number[] = [];

  const pushNum = (arr: number[], v: any): void => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) arr.push(Math.round(n));
  };

  for (const t of executedTools) {
    if (t.name === 'get_catalog_and_price' && Array.isArray(t.result?.treatments)) {
      for (const item of t.result.treatments) {
        if (item.promoPrice) {
          authorizedNumbers.add(item.promoPrice);
          pushNum(servicePromo, item.promoPrice);
        }
        if (item.originalPrice) {
          authorizedNumbers.add(item.originalPrice);
          pushNum(serviceOriginal, item.originalPrice);
        }
      }
    }
    if (t.name === 'calculate_delivery' && t.result?.success) {
      if (t.result.ongkirPromo != null) {
        authorizedNumbers.add(t.result.ongkirPromo);
        pushNum(ongkirPromoList, t.result.ongkirPromo);
      }
      if (t.result.ongkirNormal != null) {
        authorizedNumbers.add(t.result.ongkirNormal);
        pushNum(ongkirNormalList, t.result.ongkirNormal);
      }
    }
  }

  // Harga add-on & layanan DINAMIS dari katalog aktif (tenant-aware, tanpa hardcode).
  // Menggantikan hardcode authorizedNumbers.add(10000) untuk Sinar Moksa.
  try {
    const tenantId = opts?.tenantId || DEFAULT_TENANT_ID;
    const all = treatmentCatalogService.getAllServices(true, tenantId) || [];
    for (const s of all) {
      if (typeof s.promoPrice === 'number') authorizedNumbers.add(s.promoPrice);
      if (typeof s.originalPrice === 'number') authorizedNumbers.add(s.originalPrice);
      let isAddon = s.category === 'ADD_ON';
      try {
        if (typeof treatmentCatalogService.isAddonService === 'function') {
          isAddon = isAddon || treatmentCatalogService.isAddonService(s);
        }
      } catch (_) {}
      if (isAddon) {
        pushNum(addonPrices, s.promoPrice);
        pushNum(addonPrices, s.originalPrice);
      }
    }
  } catch (_) {
    // Katalog offline → lanjut dengan data turn saja (tidak pernah melempar).
  }

  // Ongkir dari session (turn sebelumnya sudah QUOTED) ikut mengotorisasi komposit.
  const sess = opts?.session;
  if (sess?.location?.ongkirPromo != null) pushNum(ongkirPromoList, sess.location.ongkirPromo);
  if (sess?.location?.ongkirNormal != null) pushNum(ongkirNormalList, sess.location.ongkirNormal);

  // Validasi Aritmatika Komposit:
  // - Layanan Promo + Ongkir Promo / Normal (dan silang, agar tidak false-positive
  //   saat campuran promo treatment + ongkir normal dikutip di turn berbeda).
  const serviceAll = [...servicePromo, ...serviceOriginal];
  const ongkirAll = [...ongkirPromoList, ...ongkirNormalList];
  for (const sp of serviceAll) {
    for (const op of ongkirAll) {
      authorizedNumbers.add(sp + op);
    }
  }
  // - Layanan + Add-on (dan + ongkir): combo resmi katalog.
  for (const sp of serviceAll) {
    for (const ap of addonPrices) {
      authorizedNumbers.add(sp + ap);
      for (const op of ongkirAll) {
        authorizedNumbers.add(sp + ap + op);
      }
    }
  }
  // - Nilai session.totalPrice & akumulasi cartItems (sumber kebenaran keranjang).
  if (typeof sess?.totalPrice === 'number' && Number.isFinite(sess.totalPrice)) {
    authorizedNumbers.add(Math.round(sess.totalPrice));
  }
  if (Array.isArray(sess?.cartItems) && sess.cartItems.length > 0) {
    let subPromo = 0;
    let subPrice = 0;
    for (const it of sess.cartItems) {
      const p = typeof it.promoPrice === 'number' ? it.promoPrice : it.price;
      const o = typeof it.price === 'number' ? it.price : p;
      authorizedNumbers.add(Math.round(p));
      authorizedNumbers.add(Math.round(o));
      subPromo += p;
      subPrice += o;
    }
    authorizedNumbers.add(Math.round(subPromo));
    authorizedNumbers.add(Math.round(subPrice));
    for (const op of ongkirAll) {
      authorizedNumbers.add(Math.round(subPromo + op));
      authorizedNumbers.add(Math.round(subPrice + op));
    }
  }

  // Cek setiap angka di teks
  for (const m of priceMatches) {
    const rawVal = parseInt(m.replace(/[^0-9]/g, ''), 10);
    // Abaikan jika angka < 5000 (bukan harga)
    if (rawVal >= 5000 && !authorizedNumbers.has(rawVal)) {
      violations.push(`Nominal Rp ${rawVal.toLocaleString('id-ID')} tidak ditemukan di data katalog/ongkir tool resmi.`);
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}
