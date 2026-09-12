/**
 * src/v3/guardrails/pronoun-validator.ts
 * Validator kata ganti klinik (aturan emas 7): balasan Bidan Yusi WAJIB
 * memakai "kami"/"Bidan kami" — "saya"/"aku" di luar kalimat perkenalan
 * resmi Turn-0 adalah pelanggaran.
 *
 * Sesi 834128 ("beritahu saya") + Mandat Minimalisasi Regex: deteksi MURNI
 * (token-exact, tanpa penggantian string di tengah kalimat). Perbaikan
 * dilakukan via reprompt LLM di agent-runner — BUKAN mutilasi regex.
 * (Penggantian string "saya→kami" sengaja sudah dihapus dari pipeline
 * sanitizer; lihat OutputSanitizer.cleanOutboundReply butir 7.)
 */

export interface PronounCheckResult {
  isValid: boolean;
  violations: string[];
}

/** Kata ganti orang-pertama tunggal yang dilarang (token kata utuh). */
const BANNED_PRONOUNS = new Set(['saya', 'aku', 'gw', 'gue']);

const stripEdge = (t: string): string => {
  let s = t;
  while (s.length > 0) {
    const c = s.charCodeAt(0);
    const isAlnum = (c >= 48 && c <= 57) || (c >= 97 && c <= 122);
    if (isAlnum) break;
    s = s.slice(1);
  }
  while (s.length > 0) {
    const c = s.charCodeAt(s.length - 1);
    const isAlnum = (c >= 48 && c <= 57) || (c >= 97 && c <= 122);
    if (isAlnum) break;
    s = s.slice(0, -1);
  }
  return s;
};

export function detectFirstPersonSlip(
  replyText: string,
  opts?: { isFollowUp?: boolean }
): PronounCheckResult {
  const violations: string[] = [];
  if (!replyText || !replyText.trim()) return { isValid: true, violations };
  const lower = replyText.toLowerCase();
  // Pengecualian TUNGGAL: kalimat perkenalan resmi Turn-0
  // ("Perkenalkan, saya Bidan Yusi ...") — di chat lanjutan tidak ada
  // pengecualian apa pun.
  let scannable = lower;
  if (!opts?.isFollowUp && lower.includes('perkenalkan') && lower.includes('saya bidan yusi')) {
    scannable = scannable.replace('saya bidan yusi', 'bidan yusi');
  }
  const tokens = scannable.split(' ').map(stripEdge).filter((t) => t.length > 0);
  const hits = [...new Set(tokens.filter((t) => BANNED_PRONOUNS.has(t)))];
  if (hits.length > 0) {
    violations.push(
      `Balasan memakai kata ganti orang-pertama (${hits.map((h) => `"${h}"`).join(', ')}) — wajib "kami"/"Bidan kami" (aturan emas 7).`
    );
  }
  return { isValid: violations.length === 0, violations };
}
