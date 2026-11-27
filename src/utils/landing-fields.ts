/**
 * Kontrak format field landing yang berasal dari admin/tenant.
 *
 * Nilai ini disisipkan ke HTML dan konteks <script> pada halaman publik, jadi
 * hanya bentuk yang sempit yang boleh masuk DB (bukan sekadar trim).
 */
const PIXEL_ID_PATTERN = /^[A-Za-z0-9_-]{5,32}$/;
const PHONE_MIN_DIGITS = 8;
const PHONE_MAX_DIGITS = 15;

export type ParseResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function parseMetaPixelId(raw: unknown): ParseResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'metaPixelId harus berupa string' };
  const t = raw.trim();
  if (!t) return { ok: true, value: null };
  if (!PIXEL_ID_PATTERN.test(t)) {
    return { ok: false, error: 'metaPixelId hanya boleh huruf, angka, dan garis bawah (5-32 karakter)' };
  }
  return { ok: true, value: t };
}

export function parseWhatsappNumber(raw: unknown): ParseResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'whatsappNumber harus berupa string' };
  const t = raw.trim();
  if (!t) return { ok: true, value: null };
  const digits = t.replace(/\D/g, '');
  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
    return { ok: false, error: `whatsappNumber harus ${PHONE_MIN_DIGITS}-${PHONE_MAX_DIGITS} digit` };
  }
  return { ok: true, value: digits };
}

/** Validasi nilai yang dibaca dari DB sebelum dirender (data lama). */
export function sanitizePixelForRender(raw: unknown): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  return PIXEL_ID_PATTERN.test(t) ? t : '';
}

export function sanitizePhoneForRender(raw: unknown): string {
  const digits = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
  // Render-only: menerima nomor legacy yang lebih pendek, tetapi tetap hanya digit.
  return digits.length >= 6 && digits.length <= 15 ? digits : '';
}
