/**
 * src/v3/guardrails/numeric-fact-validator.ts
 * Memvalidasi apakah semua nominal rupiah di teks balasan cocok dengan data tool resmi.
 *
 * Composite Pricing: selain harga tunggal resmi, total aritmatika yang sah
 * (layanan + ongkir, layanan + add-on, KOMBO 2–3 layanan ad-hoc + add-on +
 * ongkir, akumulasi keranjang/session) ikut diotorisasi agar balasan cerdas
 * LLM yang menghitung total tidak dibuang sebagai false-positive halusinasi.
 */

import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';

export interface NumericValidationResult {
  isValid: boolean;
  violations: string[];
  /**
   * Total resmi keranjang penuh (subtotal + ongkir) bila determinabel dari
   * session — dipakai re-prompt koreksi agar LLM menulis angka yang benar.
   * Kosong bila keranjang tidak ada / ongkir belum diketahui.
   */
  expectedTotals?: number[];
}

export interface NumericValidationOptions {
  tenantId?: string;
  session?: {
    totalPrice?: number;
    cartItems?: Array<{ name?: string; price: number; promoPrice?: number | null }>;
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

  // Ongkir dari session (turn sebelumnya sudah QUOTED) ikut mengotorisasi komposit
  // DAN sebagai angka mandiri (sesi 138207: ongkir promo Rp 20.000 resmi yang
  // dirinci di pesan biaya DILARANG dituduh halusinasi).
  const sess = opts?.session;
  if (sess?.location?.ongkirPromo != null) {
    pushNum(ongkirPromoList, sess.location.ongkirPromo);
    const n = Math.round(Number(sess.location.ongkirPromo));
    if (Number.isFinite(n) && n > 0) authorizedNumbers.add(n);
  }
  if (sess?.location?.ongkirNormal != null) {
    pushNum(ongkirNormalList, sess.location.ongkirNormal);
    const n = Math.round(Number(sess.location.ongkirNormal));
    if (Number.isFinite(n) && n > 0) authorizedNumbers.add(n);
  }

  // Validasi Aritmatika Komposit:
  // - Layanan Promo + Ongkir Promo / Normal (dan silang, agar tidak false-positive
  //   saat campuran promo treatment + ongkir normal dikutip di turn berbeda).
  // - PENGECUALIAN MULTI-ITEM (sesi 214956): bila keranjang aktif memuat ≥2
  //   item, jumlah parsial (1 layanan + ongkir, mis. 105k+15k=120k) DILARANG
  //   masuk whitelist — HANYA subtotal penuh + ongkir yang sah. Mencegah model
  //   "lupa" satu item lalu lolos karena angka parsialnya kebetulan valid.
  const serviceAll = [...servicePromo, ...serviceOriginal];
  const ongkirAll = [...ongkirPromoList, ...ongkirNormalList];
  const cartCount = Array.isArray(sess?.cartItems) ? sess.cartItems.length : 0;
  const strictMultiItem = cartCount >= 2;
  if (!strictMultiItem) {
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
    // - Kombo multi-layanan ad-hoc 2–3 treatment (Issue #26): turn konsultasi
    //   ("Pijat Ceria 75rb + Nafsu Makan 60rb = ?") — jumlah subset layanan resmi
    //   dari turn ini (Si+Sj, Si+Sj+Addon, Si+Sj+Ongkir, Si+Sj+Addon+Ongkir,
    //   termasuk triple 3 layanan). Dibatasi N≤6 layanan unik: O(N^3) ≤ 216.
    //   HANYA di luar mode strict (keranjang ≥2 item tetap mengunci total penuh).
    const servicePool = [...new Set(serviceAll)].slice(0, 6);
    const authCombo = (n: number): void => {
      if (Number.isFinite(n) && n > 0) authorizedNumbers.add(Math.round(n));
    };
    const authWithExtras = (base: number): void => {
      authCombo(base);
      for (const ap of addonPrices) {
        authCombo(base + ap);
        for (const op of ongkirAll) authCombo(base + ap + op);
      }
      for (const op of ongkirAll) authCombo(base + op);
    };
    for (let i = 0; i < servicePool.length; i++) {
      for (let j = i + 1; j < servicePool.length; j++) {
        const pair = servicePool[i] + servicePool[j];
        authWithExtras(pair);
        for (let k = j + 1; k < servicePool.length; k++) {
          authWithExtras(pair + servicePool[k]);
        }
      }
    }
  }
  // - Nilai session.totalPrice & akumulasi cartItems (sumber kebenaran keranjang).
  //   Selalu diotorisasi (termasuk mode strict): ini total PENUH yang benar.
  const expectedTotals: number[] = [];
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
    if (ongkirAll.length > 0) {
      for (const op of ongkirAll) {
        const fullPromo = Math.round(subPromo + op);
        const fullPrice = Math.round(subPrice + op);
        authorizedNumbers.add(fullPromo);
        authorizedNumbers.add(fullPrice);
        expectedTotals.push(fullPromo);
      }
      if (!expectedTotals.includes(Math.round(subPrice))) expectedTotals.push(Math.round(subPrice));
    } else {
      expectedTotals.push(Math.round(subPromo));
    }
  }
  const expectedSet = [...new Set(expectedTotals)];

  // Cek setiap angka di teks (ekstraksi numerik teknis; TANPA penggantian
  // string di tengah kalimat — pelanggaran hanya dilaporkan + re-prompt).
  const mentioned = new Set<number>();
  for (const m of priceMatches) {
    const rawVal = parseInt(m.replace(/[^0-9]/g, ''), 10);
    // Abaikan jika angka < 5000 (bukan harga)
    if (rawVal >= 5000) {
      mentioned.add(rawVal);
      if (!authorizedNumbers.has(rawVal)) {
        violations.push(
          expectedSet.length > 0
            ? `Nominal Rp ${rawVal.toLocaleString('id-ID')} tidak sesuai dengan total akumulasi keranjang resmi (${expectedSet.map((n) => `Rp ${n.toLocaleString('id-ID')}`).join(' / ')}).`
            : `Nominal Rp ${rawVal.toLocaleString('id-ID')} tidak ditemukan di data katalog/ongkir tool resmi.`
        );
      }
    }
  }

  // Audit 854065 — OMISSION detector (Turn 9-10: total 2 anak disebut,
  // layanan Bunda hilang, validator lama lolos karena 160rb "resmi").
  // Syarat ketat anti-false-positive (kumulatif):
  // - balasan mengklaim "total" (klaim kelengkapan),
  // - keranjang multi-item (≥2 — single-item dicakup cek nominal di atas),
  // - ≥1 angka resmi keranjang disebut (bot memang merinci, bukan konsultasi),
  // - grand total resmi TAK SATU PUN disebut → violation + rincian item
  //   (diteruskan ke attemptNumericReprompt sebagai konteks koreksi).
  // Konsultasi tanpa angka & jawaban hanya-grand-total → lolos.
  const cartLen = Array.isArray(sess?.cartItems) ? sess.cartItems.length : 0;
  if (/total/i.test(replyText) && cartLen >= 2 && expectedSet.length > 0) {
    const mentionsGrand = expectedSet.some((t) => mentioned.has(t));
    const mentionsAnyCartNumber = [...mentioned].some((v) => authorizedNumbers.has(v));
    if (!mentionsGrand && mentionsAnyCartNumber) {
      const fmtRp = (n: number): string => `Rp ${Number(n).toLocaleString('id-ID')}`;
      const itemList = (sess?.cartItems || [])
        .map((it) => `${it.name} (${fmtRp(typeof it.promoPrice === 'number' ? it.promoPrice : it.price)})`)
        .join(', ');
      violations.push(
        `Balasan mengklaim total tetapi MENGHILANGKAN grand total resmi (${expectedSet.map((n) => fmtRp(n)).join(' / ')}). Keranjang resmi memuat: ${itemList}. WAJIB kutip grand total utuh termasuk seluruh item!`
      );
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
    expectedTotals: expectedSet,
  };
}
