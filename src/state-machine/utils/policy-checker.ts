import { isMultiChildTransportQuestion } from './transport-policy-checker';

/**
 * policy-checker.ts
 * Dedicated checker for customer policy inquiries (ongkir inclusion, payment method,
 * therapist credentials, coverage area, multi-child transport, operating hours).
 *
 * Prevents policy confirmation questions (e.g. "brrti blm termasuk ongkir yaaaa")
 * from being hijacked by anaphora price calculation (isAskPrice).
 */

export type PolicyInquiryType =
  | 'ONGKIR_INCLUSION'
  | 'PAYMENT_METHOD'
  | 'THERAPIST_QUALIFICATION'
  | 'COVERAGE_AREA'
  | 'MULTI_CHILD_TRANSPORT'
  | 'OPERATING_HOURS';

export interface PolicyInquiryResult {
  type: PolicyInquiryType;
  confidence: number;
}

export function checkPolicyInquiry(text: string): PolicyInquiryType | null {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase().trim();

  // 1. Multi-Child / Multi-Treatment Transport Policy
  if (isMultiChildTransportQuestion(lower)) {
    return 'MULTI_CHILD_TRANSPORT';
  }

  // 2. Ongkir Inclusion / Exclusion Confirmation Policy
  const hasTransportWord = /\b(ongkir(nya)?|biaya\s+kirim|transport(nya)?|ongkos(nya)?|biaya\s+antar)\b/i.test(lower);
  const isAskingInclusion =
    /\b(blm|belum|sdh|sudah|udah|udh|gak|ga|tidak)\s+(termasuk|include|sama|masuk)\b/i.test(lower) ||
    /\b(termasuk|include|exclude|sama)\s+(ongkir|transport|biaya|ongkos)\b/i.test(lower) ||
    /\b(ongkir|transport|biaya)\s+(terpisah|sendiri|lagi|tambah(an)?|ekstra|exclude)\b/i.test(lower) ||
    /\b(ongkir(nya)?|transport(nya)?)\s+(bayar\s+lagi|bayar\s+pisah|bayar\s+terpisah|bayar\s+sendiri|dihitung\s+pisah)\b/i.test(lower) ||
    /\b(udah|sudah)\s+sama\s+(ongkir|transport)\b/i.test(lower) ||
    /\b(sama\s+ongkir|plus\s+ongkir|termasuk\s+ongkir)\s+(belum|blm|kah|\?)\b/i.test(lower) ||
    /\bexclude\s+ongkir\b/i.test(lower);

  if (hasTransportWord && isAskingInclusion) {
    return 'ONGKIR_INCLUSION';
  }

  // Also match standalone phrases like "blm termasuk ongkir ya" even if word variations exist
  if (/\b(blm|belum|gak|ga|tidak)\s+termasuk\s+ongkir\b/i.test(lower) || /\b(udah|sudah)\s+sama\s+ongkir\b/i.test(lower)) {
    return 'ONGKIR_INCLUSION';
  }

  // 3. Payment Method Policy
  const hasPaymentWord = /\b(bayar(nya)?|pembayaran(nya)?|transfer(nya)?|cash|tunai|qris|debit|rekening|dp|down\s*payment|cod)\b/i.test(lower);
  const isPaymentQuestion =
    /\b(bisa|boleh|ada|metode|cara|sistem|gimana|bagaimana|lewat|pake|pakai|harus|apakah)\b/i.test(lower) ||
    lower.includes('?');

  if (hasPaymentWord && isPaymentQuestion) {
    // Avoid false positive if text is about booking schedule or price question like "harga bayar berapa"
    if (!/\b(harga|tarif|biaya\s+treatment|berapa\s+paket)\b/i.test(lower) || /\b(transfer|qris|cash|tunai|rekening|dp|cod)\b/i.test(lower)) {
      return 'PAYMENT_METHOD';
    }
  }

  // 4. Therapist Qualification / Credentials Policy
  const hasTherapistWord = /\b(terapis(nya)?|bidan(nya)?|nakes|perawat|tenaga|petugas|bubid)\b/i.test(lower);
  const isAskingCredentials =
    /\b(asli|resmi|str|sertifikat|bersertifikat|pengalaman|lulusan|profesional|kuliah|ijazah|kualifikasi)\b/i.test(lower) ||
    /\b(apakah|apakh|yg\s+datang|yang\s+datang|siapa)\s+(terapis(nya)?\s+)?(bidan|nakes|perawat)\b/i.test(lower) ||
    (/\b(apakah|siapa)\b/i.test(lower) && /\bterapis\b/i.test(lower) && /\b(bidan|nakes|perawat)\b/i.test(lower));

  if (hasTherapistWord && isAskingCredentials) {
    return 'THERAPIST_QUALIFICATION';
  }

  // 5. Coverage Area Policy (General Inquiries)
  const isCoverageQuestion =
    /\b(melayani|jangkauan|coverage|area|wilayah|daerah)\s+(mana\s+aja|mana\s+saja|apa\s+saja|mana|kemana\s+aja)\b/i.test(lower) ||
    /\b(sampai\s+mana\s+(aja|saja)?)\b/i.test(lower) ||
    /\b(bisa\s+ke\s+daerah\s+mana\s+(aja|saja)?)\b/i.test(lower) ||
    /\b(sidoarjo|surabaya)\s+(mana\s+aja|mana\s+saja|sebelah\s+mana)\b/i.test(lower);

  if (isCoverageQuestion) {
    return 'COVERAGE_AREA';
  }

  // 6. Operating Hours Policy
  // Contoh:
  // - "buka jam berapa sampai jam berapa?"
  // - "jam operasionalnya kapan?"
  // - "hari apa aja buka?"
  const isOperatingHoursQuestion =
    /\b(jam\s+operasional(nya)?|jam\s+buka(nya)?|buka\s+jam\s+berapa|hari\s+apa\s+aja\s+buka|buka\s+tiap\s+hari\s+kah)\b/i.test(lower);

  if (isOperatingHoursQuestion) {
    return 'OPERATING_HOURS';
  }

  return null;
}
