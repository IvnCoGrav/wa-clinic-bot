/**
 * Guard deterministik untuk mencegah render-churn pada form reservasi (KNOWN #341).
 *
 * Parent (Live Chat) mengirim prop objek/array baru setiap render (SSE). Effect
 * form tidak boleh memakai identitas objek sebagai pemicu; gunakan kunci stabil
 * (ID / konten) + ref `shouldRunGuard`.
 */

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** Kunci stabil untuk auto-populate customer: id prop, fallback id eksplisit. */
export function buildAutoPopulateKey(
  initialCustomerId?: string | null,
  explicitCustomerId?: string | null
): string {
  return String(initialCustomerId || explicitCustomerId || '').trim();
}

/** Kunci slot target (tanggal + jam + staf) agar objek baru dengan isi sama tidak memicu reset. */
export function buildSlotTargetKey(target: any): string {
  if (!target) return '';
  const date = target.date instanceof Date ? target.date.toISOString() : String(target.date ?? '');
  const time = String(target.timeStr ?? target.hour ?? '');
  const staff = String(target.staffId ?? '');
  return `${date}|${time}|${staff}`.trim();
}

/** Kunci konten data anak (nama + usia) — bukan identitas array. */
export function buildBabiesContentKey(babies: Array<{ name?: string | null; ageText?: string | null }> | null | undefined): string {
  if (!Array.isArray(babies) || babies.length === 0) return '';
  return babies.map((b) => `${norm(b?.name)}:${norm(b?.ageText)}`).join('|');
}

/** True bila kunci baru valid dan berbeda dari yang terakhir dijalankan. */
export function shouldRunGuard(prevKey: string | null, nextKey: string): boolean {
  const next = String(nextKey || '').trim();
  if (!next) return false;
  return prevKey !== next;
}
