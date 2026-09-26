/**
 * Lead Greeting Detector — modul mandiri (0 token, 0ms) untuk mengevaluasi
 * apakah pesan masuk adalah Pure Lead Opener (sapaan pembuka murni).
 *
 * Dipakai konsisten oleh State Machine / V3 Agent / Slot Engine tanpa
 * duplikasi regex. Logika diselaraskan dengan PRIORITY 2C DecisionMatrix
 * (INITIAL LEAD GREETING) namun tanpa ketergantungan pada slate/history —
 * murni evaluasi teks + guard pertanyaan spesifik.
 */

import { getGazetteerAreas, getGazetteerKecamatanNames } from '../utils/gazetteer';

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
  /\b(berapa|brp|harga|harganya|tarif|biaya|ongkir|pricelist|usia|umur|bulan|tahun|jadwal|slot|kapan|besok|lusa|batuk|pilek|bapil|flu|demam|panas|kembung|diare|muntah|ruam|gatal|rewel|sakit|nyeri|bengkak|sesak|asma|kejang|darurat|gejala|sakitnya|keluh)\b|\b\d+\s*(?:bln|bulan|thn|tahun|menit|jam|hari|minggu)\b|\bjam\s*\d+|\b(senin|selasa|rabu|kamis|jumat|sabtu|minggu|hari\s+ini|sekarang)\b/i;

const ISLAMIC_RE = /assalamu\x27?alaikum|assalamualaikum|ass(?![a-z])|askum|samlikum/i;

// Sanitasi tag tracking iklan sebelum evaluasi (Promo[...], [ID: ...]).
const AD_TAG_RE = /(?:Promo|ID|Iklan|Diskon)?\s*\[\s*[\w\s:.-]{1,12}?\s*\]/gi;

export function stripAdTags(text: string): string {
  if (!text) return '';
  return text.replace(AD_TAG_RE, '').trim();
}

/**
 * Deteksi salam Islami pembuka secara mandiri (tanpa mensyaratkan sapaan
 * murni): dipakai memilih varian header sapaan Turn-0 pada giliran yang
 * memuat konten lain (mis. lokasi). Domain linguistik yang sama dengan
 * ISLAMIC_RE di modul ini — bukan regex intent baru.
 */
export function hasIslamicSalutation(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return ISLAMIC_RE.test(stripAdTags(text));
}

function hasPreciseLocationEntity(text: string): boolean {
  const lower = text.toLowerCase();
  if (!lower.trim()) return false;
  // Google Maps link
  if (lower.includes('google.com/maps') || lower.includes('goo.gl') || lower.includes('share.google') || lower.includes('maps.app')) {
    return true;
  }
  // Street markers (token utuh)
  const stripEdge = (t: string): string => {
    let s = t;
    while (s.length > 0) {
      const c = s.charCodeAt(0);
      if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) break;
      s = s.slice(1);
    }
    while (s.length > 0) {
      const c = s.charCodeAt(s.length - 1);
      if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) break;
      s = s.slice(0, -1);
    }
    return s;
  };
  const STREET_MARKERS = new Set([
    'jl', 'jln', 'jalan', 'gang', 'gg', 'perum', 'perumahan',
    'komplek', 'kompleks', 'blok', 'cluster', 'ruko', 'patokan',
  ]);
  const toks = lower.split(' ').map(stripEdge).filter((t) => t.length > 0);
  if (toks.some((t) => STREET_MARKERS.has(t))) return true;
  // Explicit location phrases
  const LOCATION_PHRASES = [
    'alamat', 'domisili', 'tinggal di', 'rumah di', 'rumahnya di',
    'lokasi rumah', 'kelurahan', 'kecamatan',
  ];
  if (LOCATION_PHRASES.some((p) => lower.includes(p))) return true;
  // Known kelurahan/kecamatan as WHOLE words (not substrings)
  try {
    const areas = new Set<string>();
    for (const [areaLower] of getGazetteerAreas().entries()) {
      if (areaLower.length >= 4) areas.add(areaLower);
    }
    const kecNames = new Set<string>();
    for (const n of getGazetteerKecamatanNames() || []) {
      if (n && n.length >= 4) kecNames.add(n.toLowerCase());
    }
    const words = lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    for (const w of words) {
      if (areas.has(w) || kecNames.has(w)) return true;
    }
  } catch {}
  return false;
}

export function isPureLeadGreeting(text: string): LeadGreetingResult {
  const notIslamic = { isLeadGreeting: false, isIslamic: false };
  if (!text || typeof text !== 'string') return notIslamic;

  const cleanText = stripAdTags(text);
  if (!cleanText) return notIslamic;

  // Guard: entitas lokasi presisi (jalan/perumahan/kelurahan/kecamatan/Google Maps/frasa alamat)
  // → bukan sapaan murni, wajib diteruskan ke Geocoder & LLM
  if (hasPreciseLocationEntity(cleanText)) return notIslamic;

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
    ).test(cleanText);

  if (!isPureLeadOpener) return notIslamic;
  return { isLeadGreeting: true, isIslamic };
}
