/**
 * Kebijakan password staf (S-012).
 *
 * Tanpa aturan minimal, akun lapangan bisa memakai password 1 karakter dan
 * mudah ditebak. Fungsi murni agar bisa diuji tanpa DB.
 */
export interface PasswordPolicyResult {
  ok: boolean;
  error?: string;
}

export const STAFF_PASSWORD_MIN_LENGTH = 8;
export const STAFF_PASSWORD_MAX_LENGTH = 72; // batas aman bcrypt

export function validateStaffPassword(password: unknown): PasswordPolicyResult {
  if (typeof password !== 'string' || !password) {
    return { ok: false, error: 'Password wajib diisi.' };
  }
  if (password.length < STAFF_PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Password minimal ${STAFF_PASSWORD_MIN_LENGTH} karakter.` };
  }
  if (password.length > STAFF_PASSWORD_MAX_LENGTH) {
    return { ok: false, error: `Password maksimal ${STAFF_PASSWORD_MAX_LENGTH} karakter.` };
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, error: 'Password wajib memuat huruf dan angka.' };
  }
  return { ok: true };
}

/** Role bawaan (bukan custom tenant). */
export const BUILTIN_STAFF_ROLES = new Set([
  'THERAPIST',
  'ADMIN_CS',
  'SPV_CS',
  'ADVERTISER',
  'SUPER_ADMIN',
]);

export function normalizeStaffRole(input: unknown): string {
  return String(input ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}
