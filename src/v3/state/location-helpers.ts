/**
 * location-helpers.ts — Pure helpers tanpa dependensi state (anti-circular).
 * Dipisah dari conversation-summarizer.ts agar goal-tracker.ts tidak perlu
 * mengimpor summarizer (yang mengimpor CustomerGoalSession dari goal-tracker).
 */

export function isAskedLocationRecently(history: Array<{ role: string; content: string }>): boolean {
  const recentAssistantMsgs = (history || []).filter((h) => h.role === 'assistant').slice(-2);
  return recentAssistantMsgs.some((m) => {
    const c = (m.content || '').toLowerCase();
    return c.includes('daerah atau kelurahan')
      || c.includes('kelurahan mana')
      || c.includes('rumahnya dimana')
      || c.includes('rumah bunda dimana')
      || c.includes('daerah mana')
      || c.includes('lokasi rumah')
      || c.includes('alamat rumah');
  });
}

/**
 * Afirmasi singkat atas konfirmasi lokasi (insiden Demak 2026-10-03): "iya",
 * "ya betul", "tepat", "oke" — TANPA kata tanya/negasi. Closed-class function
 * words (setingkat sapaan), bukan hafalan kalimat: dipakai state-gated hanya
 * saat `session.pendingLocation` terisi, untuk mempromosikan kandidat Google
 * menjadi lokasi terkonfirmasi. Deterministik, 0 token.
 */
const LOCATION_AFFIRM_TOKENS = new Set([
  'iya', 'iyaa', 'ya', 'yah', 'yes', 'yoi', 'yup', 'betul', 'bener', 'benar',
  'tepat', 'beneran', 'oke', 'ok', 'okay', 'okey', 'sip', 'siap', 'setuju',
  'lanjut', 'boleh', 'nah', 'itu', 'iyaa',
]);
const LOCATION_NEGATE_TOKENS = new Set([
  'bukan', 'salah', 'keliru', 'tidak', 'nggak', 'ngga', 'gak', 'engga', 'salah',
  'ganti', 'pindah', 'lain', 'bedaterima', 'tapi',
]);

export function isLocationConfirmationAffirmative(text: string | undefined): boolean {
  const lower = (text || '').toLowerCase().trim();
  if (!lower) return false;
  if (lower.includes('?')) return false;
  const toks = lower.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
  if (toks.length === 0 || toks.length > 6) return false;
  if (toks.some((t) => LOCATION_NEGATE_TOKENS.has(t))) return false;
  return toks.some((t) => LOCATION_AFFIRM_TOKENS.has(t));
}
