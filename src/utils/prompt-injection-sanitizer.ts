/**
 * prompt-injection-sanitizer.ts — Pertahanan prompt injection deterministik
 * (Mandat Anti-Case-by-Case: gerbang KODE, bukan sekadar teks "DILARANG...").
 *
 * Masalah: pesan customer dibungkus `<customer_message>...</customer_message>`
 * di `agent-runner`, tetapi teks mentah dapat memuat:
 *  - tag penutup palsu `</customer_message>` yang MEMUTUS isolasi (breakout),
 *  - tag peran palsu (`<system>`, `<assistant>`, ...) yang dibaca LLM sebagai
 *    perintah sistem,
 *  - penanda peran `SYSTEM:` yang menyerupai instruksi sistem.
 *
 * Perbaikan: normalisasi delimiter & penanda peran SEBELUM pesan dikirim ke
 * LLM. Murni, deterministik, tanpa I/O. Bukan daftar kalimat hafalan — hanya
 * token struktural (delimiter/tag/peran).
 */

export interface SanitizedCustomerInput {
  clean: string;
  blockedPatterns: string[];
}

/** Tag peran yang menyerupai delimiter sistem (teknis, bukan semantik). */
const ROLE_TAGS = ['system', 'assistant', 'developer', 'tool', 'function', 'user'];
const WRAPPER_TAG = 'customer_message';

export function sanitizeCustomerInput(text: string | undefined): SanitizedCustomerInput {
  const raw = typeof text === 'string' ? text : '';
  if (!raw) return { clean: '', blockedPatterns: [] };
  const blocked = new Set<string>();
  let out = raw;

  // 1. Netralkan delimiter wrapper (breakout isolasi) — buka & tutup.
  if (new RegExp(`</?${WRAPPER_TAG}>`, 'i').test(out)) {
    blocked.add('wrapper_delimiter');
    out = out.replace(new RegExp(`</?${WRAPPER_TAG}>`, 'gi'), ' ');
  }

  // 2. Netralkan tag peran <system>...</system> dsb.
  for (const role of ROLE_TAGS) {
    const re = new RegExp(`</?${role}>`, 'gi');
    if (re.test(out)) {
      blocked.add(`role_tag:${role}`);
      out = out.replace(re, ' ');
    }
  }

  // 3. Netralkan penanda peran "SYSTEM:" (awal baris / setelah newline).
  if (/^\s*(system|assistant|developer|tool)\s*:/im.test(out)) {
    blocked.add('role_marker');
    out = out.replace(/^\s*(system|assistant|developer|tool)\s*:/gim, ' ');
  }

  // 4. Penanda instruksi-peran lintas bahasa (parafrase umum).
  const INSTRUCTION_PATTERNS: Array<[RegExp, string]> = [
    [/ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i, 'ignore_instructions'],
    [/abaikan\s+(semua\s+)?(instruksi|perintah|aturan)/i, 'ignore_instructions_id'],
    [/lupa(kan)?\s+(dulu\s+)?(semua\s+)?(aturan|instruksi|perintah)/i, 'forget_rules_id'],
    [/\bprompt\s*(sistem|system|kamu)?\b/i, 'prompt_probe'],
  ];
  for (const [re, label] of INSTRUCTION_PATTERNS) {
    if (re.test(out)) blocked.add(label);
  }

  // Rapikan spasi berlebih hasil netralisasi (tanpa mengubah teks normal).
  out = out.replace(/[ \t]{2,}/g, ' ').trim();
  return { clean: out, blockedPatterns: [...blocked] };
}

/**
 * Bungkus pesan customer dalam delimiter isolasi TUNGGAL. Delimiter di dalam
 * teks sudah dinetralkan lebih dulu oleh `sanitizeCustomerInput`, sehingga
 * jumlah pembuka/penutup selalu tepat satu (anti-breakout).
 */
export function wrapCustomerMessage(text: string | undefined): string {
  const { clean } = sanitizeCustomerInput(text);
  return `<customer_message>\n${clean}\n</customer_message>`;
}
