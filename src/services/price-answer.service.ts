/**
 * price-answer.service.ts — Jawaban otomatis untuk pertanyaan Harga.
 *
 * Desain (keputusan bisnis):
 * - Pertanyaan harga SPESIFIK (nama treatment disebut) → tampilkan harga treatment tsb.
 *   - Sudah ada lokasi → CTA assumptive-close yes-yes: "Mau coba {name} bunda ?"
 *   - Belum ada lokasi → tampilkan harga lalu tetap minta lokasi.
 * - Pertanyaan harga GENERIK (tanpa nama treatment) → kirim PRICELIST IMAGE
 *   (caption: "pricelist dari kami bunda, mau pilih yang mana bund ?").
 *   - Jangan kirim ulang jika pricelist sudah pernah dikirim (pricelist_sent=true),
 *     KECUALI customer mengindikasikan pricelist-nya hilang/tidak terkirim.
 *
 * Harga diambil dari treatment catalog (DB → file → default). Tidak ada LLM →
 * anti-halusinasi harga (persona melarang mengarang harga).
 */
import { treatmentCatalogService } from './treatment-catalog.service';
import { TEMPLATES } from '../config/persona';
import { isMultiChildTransportQuestion } from '../state-machine/utils/transport-policy-checker';
import { parseAgeTextToMonths } from '../utils/age-calculator';

import { checkPolicyInquiry, PolicyInquiryType } from '../state-machine/utils/policy-checker';

export interface PriceAnswerResult {
  replyText: string;
  /** Jika set → bot juga mengirim pricelist image dengan caption ini. */
  pricelist?: { caption: string; force: boolean };
}

/** Deteksi intent tanya harga (NLU intent ask_price atau kata kunci harga). */
export function isAskPrice(userText: string, nluIntents?: string[]): boolean {
  const lower = (userText || '').toLowerCase();

  // Pertanyaan kebijakan (ongkir inclusion, payment, therapist, multi-child) BUKAN tanya harga treatment
  const policyType = checkPolicyInquiry(userText);
  if (policyType) {
    return false;
  }

  // Pertanyaan promo umum (misal "promonya apa masih berlangsung ya?")
  if (isGeneralPromoInquiry(userText)) {
    return true;
  }

  // Kata harga EKSPLISIT → kuat, langsung harga.
  if (
    /\b(harga(nya)?|biaya(nya)?|ongkir(nya)?|ongkos(nya)?|tarif(nya)?|pricelists?|daftar\s+harga|berapa\s+harga)\b/i.test(
      lower
    )
  ) {
    return true;
  }

  // Tanpa kata harga eksplisit: hanya andalkan NLU ask_price JIKA bukan jadwal/waktu/buka/usia/durasi.
  // (Fallback NLU menandai 'berapa' sebagai ask_price juga — "jam buka berapa?" bukan harga,
  //  "usia berapa boleh pijat?" pun bukan harga, "berapa lama?" pun bukan harga.)
  if (nluIntents?.includes('ask_price')) {
    if (nluIntents.includes('ask_schedule')) return false;
    if (/\b(jam|buka|jadwal|operasional|waktu|hari|besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu|usia|umur|lama|durasi|menit|kali)\b/i.test(lower)) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Bangun balasan untuk pertanyaan kebijakan (Ongkir Inclusion, Payment, Therapist, dsb).
 */
export function buildPolicyAnswer(
  policyType: PolicyInquiryType,
  context?: { kelurahan?: string; ongkir?: number }
): string {
  switch (policyType) {
    case 'ONGKIR_INCLUSION':
      return TEMPLATES.ongkirInclusionPolicy({
        kelurahan: context?.kelurahan,
        ongkir: context?.ongkir,
      });
    case 'PAYMENT_METHOD':
      return TEMPLATES.paymentMethodPolicy();
    case 'THERAPIST_QUALIFICATION':
      return TEMPLATES.therapistQualificationPolicy();
    case 'COVERAGE_AREA':
      return TEMPLATES.coverageAreaPolicy();
    case 'MULTI_CHILD_TRANSPORT':
      return TEMPLATES.multiChildTransportPolicy();
    case 'OPERATING_HOURS':
      return `Kala Baby Spa buka setiap hari (Senin - Minggu) pukul 08.00 - 17.00 WIB untuk layanan homecare ya Bunda 😊 Mau dijadwalkan untuk jam berapa bund?`;
    default:
      return TEMPLATES.interestUnrelatedFollowUp();
  }
}

/**
 * Deteksi customer menanyakan promo secara umum (misal: "promonya apa masih berlangsung ya?", "ada promo apa saja?")
 * tanpa menyebutkan nama treatment spesifik.
 */
export function isGeneralPromoInquiry(userText: string): boolean {
  const lower = (userText || '').toLowerCase().trim();
  const isPromoQuery = /\b(promo(nya)?|diskon(nya)?|potongan\s+harga)\b/i.test(lower);
  const isAvailabilityQuestion = /\b(masih|ada|berlangsung|berlaku|aktif|bisa|dapat|apa\s+saja|apa\s+aja|gimana|infonya|info)\b/i.test(lower);
  return isPromoQuery && isAvailabilityQuestion;
}

/**
 * Deteksi customer minta pricelist dikirim ulang (hilang / tidak terkirim).
 */
export function isPricelistLostRequest(userText: string): boolean {
  const lower = (userText || '').toLowerCase();
  return (
    /\bpricelist/i.test(lower) &&
    /\b(hilang|ulang|kirim\s+ulang|kirim\s+lagi|kirim\s+dong|nggak?\s+(masuk|terkirim|kelihatan|dapet|dapat|terima|sampai)|tidak\s+(terkirim|kelihatan|sampai|dapet)|gak\s+(masuk|terkirim)|bisa\s+(kirim|bagi)\s+ulang)\b/i.test(lower)
  );
}

/**
 * Bangun balasan harga.
 *
 * @param opts.hasLocation          customer sudah punya lokasi terkunci (kelurahan + lat + lng)?
 * @param opts.pricelistAlreadySent pricelist image pernah dikirim (customer.pricelist_sent)?
 * @param opts.candidateTreatmentName nama treatment yang baru direkomendasikan bot (resolusi anaphora
 *   "berapa itu/ini/tadi?") — dipakai kalau pesan customer tidak menyebut nama treatment.
 */
export function buildPriceAnswer(
  userText: string,
  opts: { hasLocation: boolean; pricelistAlreadySent: boolean; candidateTreatmentName?: string }
): PriceAnswerResult {
  // ---- Customer minta pricelist dikirim ulang (hilang / tidak terkirim) → kirim ulang gambar ----
  // Dicek PALING AWAL supaya pesan "pricelist hilang" tidak tertangkap sebagai pencarian treatment.
  const force = isPricelistLostRequest(userText);
  if (force) {
    return {
      replyText: TEMPLATES.pricelistIntro(),
      pricelist: { caption: TEMPLATES.pricelistPrompt(), force: true },
    };
  }

  let items = treatmentCatalogService.searchCatalogItems(userText);

  // ---- Pertanyaan Promo Umum (Promo validity / availability) ----
  // Jika customer tanya promo secara umum tanpa nama treatment dan tanpa konteks anaphora aktif
  if (isGeneralPromoInquiry(userText) && items.length === 0 && !opts.candidateTreatmentName) {
    return {
      replyText: TEMPLATES.promoOngoingInfo(),
    };
  }

  // ---- RESOLUSI ANAPHORA: pesan generik ("berapa itu?") tanpa nama treatment ----
  // Jika tidak ada treatment terdeteksi dari pesan customer, pakai kandidat treatment yang baru
  // saja direkomendasikan bot (dari konteks percakapan) supaya bot menjawab HARGA spesifik,
  // bukan pricelist generik.
  if (items.length === 0 && opts.candidateTreatmentName) {
    items = treatmentCatalogService.searchCatalogItems(opts.candidateTreatmentName);
  }

  // ---- GENERIK (tidak ada treatment spesifik terdeteksi) → pricelist image ----
  if (items.length === 0) {
    // Kirim ulang hanya jika: belum pernah terkirim ATAU customer minta kirim ulang.
    if (!opts.pricelistAlreadySent) {
      return {
        replyText: TEMPLATES.pricelistIntro(),
        pricelist: { caption: TEMPLATES.pricelistPrompt(), force: false },
      };
    }
    // Sudah pernah terkirim & bukan minta ulang → cukup teks caption.
    return { replyText: TEMPLATES.pricelistPrompt() };
  }

  // ---- SPESIFIK → tampilkan harga (kalimat ngobrol, bukan format brosur) ----
  const ageMonths = parseAgeTextToMonths(userText);
  let ageQueryStr: string | undefined;
  const ageMatch = userText.match(/\b(?:usia|umur|anak|bayi|balita)?\s*(\d+(?:[.,]\d+)?\s*(?:tahun|thn|th|bulan|bln|hari|hr))\b/i);
  if (ageMatch) {
    ageQueryStr = ageMatch[1].trim();
  } else if (ageMonths !== null) {
    ageQueryStr = ageMonths >= 12 ? `${Math.round(ageMonths / 12)} tahun` : `${ageMonths} bulan`;
  }

  const list = items
    .slice(0, 2)
    .map((s) =>
      TEMPLATES.priceInfo({
        name: s.name,
        ageQuery: ageQueryStr,
        ageTierLabel: s.ageTier.label,
        durationMinutes: s.durationMinutes,
        normalPrice: s.originalPrice,
        promoPrice: s.promoPrice,
        isRecommendation: !!ageQueryStr,
      })
    )
    .join('\n\n');

  const first = items[0];
  const cleanName = first.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const cta = opts.hasLocation ? TEMPLATES.priceCta(cleanName) : TEMPLATES.askLocationShort();

  return { replyText: `${list}\n\n${cta}` };
}