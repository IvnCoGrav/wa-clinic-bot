/**
 * shareloc-solicitation.ts — Satu-satunya pola deteksi "mengajak customer
 * mengirim shareloc / titik lokasi" (Aturan Emas 21).
 *
 * Dipakai oleh:
 *  - guardrail output AI (`guardrail-pipeline.ts`) — pengaman lapis kedua.
 *  - lint template Quick Reply / template bisnis saat disimpan (gerbang kode
 *    deterministik, bukan mengandalkan kepatuhan teks prompt).
 *
 * Regex di sini HANYA untuk validasi teknis teks keluar (bukan gatekeeper
 * intent pesan customer), sesuai mandat minimalisasi regex.
 */

const SHARELOC_WORD = /\bshare\s*loc(?:ation|k|t)?\b/i;
const NEGATION_WINDOW = /dilarang menanyakan|tanpa menanyakan|tanpa meminta|jangan menanyakan|jangan meminta|tidak meminta|tidak menanyakan|bukan untuk meminta/i;
const SEND_VERB = /\b(kirim\w*|seret\w*|bagikan\w*|minta\w*|mohon\w*)\b/i;
const LOCATION_OBJECT = /\b(titik\s*lokasi\w*|share\s*location\w*|shareloc\w*|sharelock\w*|shareloct\w*|pin\s*(?:lokasi|peta|maps)\w*|lokasi\s*(?:whatsapp|terkini|terbaru|rumah)\w*)/i;

function around(text: string, index: number, length: number): string {
  return text.slice(Math.max(0, index - 60), index + length + 60);
}

/**
 * True bila teks mengajak/menyuruh customer mengirim shareloc atau titik lokasi.
 * Negasi eksplisit ("tanpa menanyakan shareloc") tidak dihitung.
 */
export function hasShareLocationSolicitation(text: string): boolean {
  const lower = String(text || '').toLowerCase();
  if (!lower) return false;

  // 1. Kata "shareloc/sharelock/shareloct/share location" itu sendiri —
  //    menyebutkannya ke customer pada alur pra-booking = ajakan shareloc.
  const word = SHARELOC_WORD.exec(lower);
  if (word) {
    const ctx = around(lower, word.index, word[0].length);
    if (!NEGATION_WINDOW.test(ctx)) return true;
  }

  // 2. Ajakan mengirim titik lokasi tanpa kata "shareloc".
  const sendMatches = [...lower.matchAll(new RegExp(SEND_VERB.source, 'gi'))];
  for (const m of sendMatches) {
    const idx = m.index ?? -1;
    if (idx < 0) continue;
    const window = lower.slice(Math.max(0, idx - 40), idx + 80);
    if (LOCATION_OBJECT.test(window) && !NEGATION_WINDOW.test(around(lower, idx, m[0].length))) {
      return true;
    }
  }

  return false;
}

/** Alasan singkat untuk log/validasi (null bila tidak ada pelanggaran). */
export function detectSharelocSolicitation(text: string): string | null {
  return hasShareLocationSolicitation(text) ? 'shareloc_solicitation' : null;
}
