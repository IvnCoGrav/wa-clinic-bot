/**
 * Lead Greeting Detector — modul mandiri (0 token, 0ms) untuk mengevaluasi
 * apakah pesan masuk adalah Pure Lead Opener (sapaan pembuka murni).
 *
 * Dipakai konsisten oleh State Machine / V3 Agent / Slot Engine tanpa
 * duplikasi regex. Logika diselaraskan dengan PRIORITY 2C DecisionMatrix
 * (INITIAL LEAD GREETING) namun tanpa ketergantungan pada slate/history —
 * murni evaluasi teks + guard pertanyaan spesifik.
 */

export interface LeadGreetingResult {
  isLeadGreeting: boolean;
  isIslamic: boolean;
}

const HONORIFICS =
  '(?:kak+|ka(?:k)?|sis(?:t)?|min|mimin|admin|bun(?:da|d)?|bu(?:nda)?|ibu|bidan|bu\\s+bidan|mbak+|mba|dok(?:ter)?|gan|om|tante|say(?:ang)?)';
const PARTICLES = '(?:dong|ya(?:a)?|deh|sih|nih|yuk|tolong|mohon|kah|gak|nggak|ta)';
const GREETINGS =
  '(?:halo|hola|hai|hi|hei|hey|p+|tes|test|ping|assalamu\\x27?alaikum|assalamualaikum|ass|askum|samlikum|(?:selamat|selmat|slmt|met)\\s+(?:pagi|siang|sore|malam|subuh)|pagi|siang|sore|malam|subuh|permisi|punten|spada)';
const INQUIRY_ACTIONS =
  '(?:mau\\s+tanya(?:-?tanya)?|tanya|boleh\\s+tanya|bisa\\s+konsultasi|mau\\s+konsultasi|minta\\s+info|info(?:\\s+lengkap)?|mau\\s+info|mau\\s+tau|mau\\s+tahu|tertarik|saya\\s+tertarik|bisa|apakah\\s+bisa|bisa\\s+homecare|melayani\\s+homecare|ada\\s+homecare|bisa\\s+dipanggil|bisa\\s+panggil|homecare|home\\s*treatment|home\\s*service|mau\\s+(?:treatment|treatmen|pijat|massage|spa|reservasi|booking|pesan|order)|bisa\\s+(?:treatment|treatmen|pijat|massage|spa)|treatment|pijat|layanan|perawatan|paket|ada\\s+(?:layanan|treatment|perawatan|paket|apa\\s*(?:aja|saja))|apa\\s*(?:aja|saja))';
const TAIL_ELEMENT = `(?:\\s+(?:${HONORIFICS}|${PARTICLES}))*`;

// Guard pertanyaan spesifik: harga, gejala/keluhan medis, jadwal, usia.
const SPECIFIC_QUESTION_RE =
  /\b(berapa|brp|harga|harganya|tarif|biaya|ongkir|pricelist|usia|umur|bulan|tahun|jadwal|slot|kapan|besok|lusa|batuk|pilek|bapil|flu|demam|panas|kembung|diare|muntah|ruam|gatal|rewel|sakit|nyeri|bengkak|sesak|asma|kejang|darurat|gejala|sakitnya|keluh)\b|\b\d+\s*(?:bln|bulan|thn|tahun|menit|jam|hari|minggu)\b|\bjam\s*\d+/i;

const ISLAMIC_RE = /assalamu\x27?alaikum|assalamualaikum|ass(?![a-z])|askum|samlikum/i;

// Sanitasi tag tracking iklan sebelum evaluasi (Promo[...], [ID: ...]).
const AD_TAG_RE = /(?:Promo|ID|Iklan|Diskon)?\s*\[\s*[\w\s:.-]{1,12}?\s*\]/gi;

export function stripAdTags(text: string): string {
  if (!text) return '';
  return text.replace(AD_TAG_RE, '').trim();
}

export function isPureLeadGreeting(text: string): LeadGreetingResult {
  const notIslamic = { isLeadGreeting: false, isIslamic: false };
  if (!text || typeof text !== 'string') return notIslamic;

  const cleanText = stripAdTags(text);
  if (!cleanText) return notIslamic;

  // Guard: ada pertanyaan spesifik (harga/klinik/gejala/jadwal/usia) → bukan sapaan murni
  if (SPECIFIC_QUESTION_RE.test(cleanText)) return notIslamic;

  const isIslamic = ISLAMIC_RE.test(cleanText);

  const isPureLeadOpener =
    new RegExp(
      `^(?:${GREETINGS}|${INQUIRY_ACTIONS})${TAIL_ELEMENT}(?:\\s+(?:${GREETINGS}|${INQUIRY_ACTIONS})${TAIL_ELEMENT})*[!.\\s?~-]*$`,
      'i'
    ).test(cleanText) ||
    new RegExp(
      `^${HONORIFICS}${TAIL_ELEMENT}\\s+(?:${GREETINGS}|${INQUIRY_ACTIONS})${TAIL_ELEMENT}[!.\\s?~-]*$`,
      'i'
    ).test(cleanText) ||
    /\b(tertarik\s+dengan\s+layanan|layanan\s+homecare|home\s*treatment|home\s*service|info\s+lengkap|mau\s+tanya\s+layanan|tanya\s+layanan|mau\s+reservasi|mau\s+booking|bisa\s+reservasi|bisa\s+booking|cara\s+reservasi|cara\s+booking|bagaimana\s+caranya|gimana\s+caranya|alur\s+reservasi|alur\s+booking|mau\s+pesan|cara\s+pesan|info\s+reservasi|mau\s+treatment|mau\s+pijat|mau\s+massage|layanan\s+apa\s*(?:aja|saja)|perawatan\s+apa\s*(?:aja|saja)|treatment\s+apa\s*(?:aja|saja)|ada\s+perawatan\s+apa|ada\s+treatment\s+apa|ada\s+layanan\s+apa|mau\s+tau\s+layanan|mau\s+tahu\s+layanan|mau\s+tau\s+treatment|mau\s+tahu\s+treatment)\b/i.test(
      cleanText
    );

  if (!isPureLeadOpener) return notIslamic;
  return { isLeadGreeting: true, isIslamic };
}
