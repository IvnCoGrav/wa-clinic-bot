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

export interface PriceAnswerResult {
  replyText: string;
  /** Jika set → bot juga mengirim pricelist image dengan caption ini. */
  pricelist?: { caption: string; force: boolean };
}

/** Deteksi intent tanya harga (NLU intent ask_price atau kata kunci harga). */
export function isAskPrice(userText: string, nluIntents?: string[]): boolean {
  const lower = (userText || '').toLowerCase();

  // Pertanyaan kebijakan transport untuk multi-anak/multi-treatment bukan tanya harga katalog
  if (isMultiChildTransportQuestion(userText)) {
    return false;
  }

  // Kata harga EKSPLISIT → kuat, langsung harga.
  if (
    /\b(harga(nya)?|biaya(nya)?|ongkir(nya)?|ongkos(nya)?|tarif(nya)?|pricelists?|daftar\s+harga|berapa\s+harga)\b/i.test(
      lower
    )
  ) {
    return true;
  }

  // Tanpa kata harga eksplisit: hanya andalkan NLU ask_price JIKA bukan jadwal/waktu/buka/usia.
  // (Fallback NLU menandai 'berapa' sebagai ask_price juga — "jam buka berapa?" bukan harga,
  //  "usia berapa boleh pijat?" pun bukan harga.)
  if (nluIntents?.includes('ask_price')) {
    if (nluIntents.includes('ask_schedule')) return false;
    if (/\b(jam|buka|jadwal|operasional|waktu|hari|besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu|usia|umur)\b/i.test(lower)) {
      return false;
    }
    return true;
  }

  return false;
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