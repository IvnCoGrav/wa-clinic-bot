import { IdleGreetingConfigService } from '../../config/idle-greeting.config';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

// Greeting murni: kata sapaan di awal + sisanya hanya honorifik/penegas singkat.
// Sama seperti GREETING_RE + GREETING_PURITY_RE di ai-router.ts — diduplikasi di sini
// agar helper bisa dipakai tanpa bergantung pada modul router (dan guard intent spesifik
// ditambahkan di bawah via NLU intents). Sumber tunggal tetap ai-router; regex ini hanya
// fallback deterministik saat NLU tidak tersedia/fallback.
const PURE_GREETING_RE =
  /^(halo|haloo+|hallo|hallo+|\bhai\b|hi|hei|hei+|p|pp|assalamu'?alaikum|assalamualaikum|salam|permisi|pagi|siang|sore|malam|selamat\s+(pagi|siang|sore|malam|datang)|bubid)\b/i;
const GREETING_TAIL_RE = /^(bunda|bund|bubid|babid|kak|ka|min|mbak|mas|gan|sis|admin|ya|ok|oke|salam|permisi|p)\s*[.!?,]*$/i;

// Kata kunci intent spesifik yang membatalkan "sapaan murni" — kalau ada, pesan bukan
// sekadar sapaan basa-basi (ada kebutuhan nyata di baliknya).
const SPECIFIC_INTENTS = [
  'provide_location',
  'ask_price',
  'ask_schedule',
  'faq_question',
  'express_interest',
  'affirmation',
  'negation',
  'complaint',
] as const;

const SPECIFIC_KEYWORD_RE =
  /\b(berapa|harga|tarif|ongkir|biaya|promo|pricelist|jadwal|slot|buka|tanggal|hari|jam|pukul|booking|reservasi|daftar|pesan|treatment|pijat|spa|massage|prenatal|laktasi|bayi|anak|nebulizer|moksa|selapan|tindik|cukur)\b/i;

/**
 * Deteksi sapaan basa-basi pada sesi idle panjang (fitur warm reopening greeting).
 *
 * Syarat (SEMUA harus terpenuhi):
 *   1. Fitur aktif per tenant (tenants.idle_greeting_enabled).
 *   2. Percakapan bukan baru (ada last_message_at lama) dan idle >= min_hours.
 *   3. Pesan terklasifikasi sapaan murni: NLU intent `greeting` TANPA intent spesifik lain,
 *      ATAU fallback regex greeting murni tanpa kata kunci spesifik (harga/lokasi/jadwal/treatment).
 *
 * `lastMessageAt` diambil dari conversation.last_message_at — sumber yang sama dengan
 * idle reset 24 jam (machine.ts) & peredaman greeting 48 jam (greeting.ts), agar tidak
 * ada divergensi antar mekanisme idle.
 */
export function isPureIdleGreeting(params: {
  messageText: string;
  lastMessageAt?: Date | string | null;
  nluIntents?: string[];
  tenantId?: string;
}): boolean {
  const tenantId = params.tenantId || DEFAULT_TENANT_ID;

  // 1. Fitur aktif?
  if (!IdleGreetingConfigService.isEnabled(tenantId)) {
    return false;
  }

  // 2. Idle cukup lama? (lastMessageAt wajib ada dan bukan percakapan baru)
  const last = params.lastMessageAt;
  if (!last) {
    return false;
  }
  const lastTime = new Date(last).getTime();
  if (!Number.isFinite(lastTime) || lastTime <= 0) {
    return false;
  }
  const minMs = IdleGreetingConfigService.getMinHours(tenantId) * 60 * 60 * 1000;
  if (Date.now() - lastTime < minMs) {
    return false;
  }

  const text = params.messageText || '';

  // 3a. NLU confident & non-fallback: sapaan murni = intent `greeting` tanpa intent spesifik.
  const intents = params.nluIntents || [];
  if (intents.length > 0) {
    const hasGreeting = intents.includes('greeting');
    const hasSpecific = intents.some((i) => (SPECIFIC_INTENTS as readonly string[]).includes(i));
    if (hasGreeting && !hasSpecific) {
      return true;
    }
    // NLU bilang greeting TAPI ada intent spesifik → bukan sapaan basa-basi.
    if (hasGreeting) {
      return false;
    }
    // NLU tidak mendeteksi greeting → biarkan regex fallback memutuskan.
  }

  // 3b. Fallback regex deterministik (NLU off/fallback/ambigu).
  const lower = text.trim().toLowerCase();
  if (!PURE_GREETING_RE.test(lower)) {
    return false;
  }
  const rest = lower.replace(PURE_GREETING_RE, '').trim();
  if (rest.length > 0 && !GREETING_TAIL_RE.test(rest)) {
    return false;
  }
  if (SPECIFIC_KEYWORD_RE.test(text)) {
    return false;
  }
  return true;
}
