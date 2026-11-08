/**
 * Account Lockout Service
 *
 * Mencegah brute-force attacks pada akun spesifik (Admin / Staff).
 * Beroperasi di tingkat identifier akun (nomor HP / email / username), terpisah
 * dari IP rate-limiter, sehingga penyerang yang merotasi IP tetap terkunci.
 *
 * Aturan:
 * - 5 kali percobaan gagal berturut-turut untuk identifier yang sama -> akun dikunci selama 15 menit.
 * - Login berhasil -> reset hitungan kegagalan.
 * - Identifier dinormalisasi (lowercase, trim, normalisasi prefiks telepon 62 -> 0).
 */

export const ACCOUNT_LOCKOUT_MAX_ATTEMPTS = 5;
export const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 menit
export const ACCOUNT_LOCKOUT_MAX_ENTRIES = 5000;

interface LockoutEntry {
  failedCount: number;
  lockedUntil: number;
  lastAttempt: number;
}

const accountLockoutMap = new Map<string, LockoutEntry>();

/**
 * Normalisasi identifier akun (email, username, atau nomor WhatsApp).
 */
export function normalizeAccountIdentifier(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim().toLowerCase();
  // Normalisasi format no HP internasional/lokal (+62 / 62 -> 0)
  return trimmed.replace(/^(\+62|62)/, '0');
}

/**
 * Periksa apakah identifier akun saat ini sedang dalam status terkunci.
 */
export function checkAccountLockout(rawIdentifier: string): { locked: boolean; remainingSeconds: number } {
  const key = normalizeAccountIdentifier(rawIdentifier);
  if (!key) return { locked: false, remainingSeconds: 0 };

  const entry = accountLockoutMap.get(key);
  if (!entry) return { locked: false, remainingSeconds: 0 };

  const now = Date.now();
  if (entry.lockedUntil > now) {
    return {
      locked: true,
      remainingSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
    };
  }

  // Jika waktu lockout sudah lewat, bersihkan
  if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
    accountLockoutMap.delete(key);
  }

  return { locked: false, remainingSeconds: 0 };
}

/**
 * Catat percobaan login gagal untuk identifier akun.
 * Mengembalikan status terkunci jika sudah mencapai ambang batas (>= 5x).
 */
export function recordAccountFailedAttempt(
  rawIdentifier: string
): { locked: boolean; failedCount: number; remainingSeconds: number } {
  const key = normalizeAccountIdentifier(rawIdentifier);
  if (!key) return { locked: false, failedCount: 0, remainingSeconds: 0 };

  const now = Date.now();
  let entry = accountLockoutMap.get(key);

  if (!entry || (entry.lockedUntil > 0 && entry.lockedUntil <= now)) {
    // Mulai entri baru jika belum ada atau lockout sebelumnya sudah kedaluwarsa
    entry = { failedCount: 1, lockedUntil: 0, lastAttempt: now };
  } else {
    // Jika percobaan terakhir lebih dari durasi lockout, reset hitungan
    if (now - entry.lastAttempt > ACCOUNT_LOCKOUT_DURATION_MS) {
      entry.failedCount = 1;
      entry.lockedUntil = 0;
    } else {
      entry.failedCount += 1;
    }
    entry.lastAttempt = now;
  }

  if (entry.failedCount >= ACCOUNT_LOCKOUT_MAX_ATTEMPTS) {
    entry.lockedUntil = now + ACCOUNT_LOCKOUT_DURATION_MS;
    accountLockoutMap.set(key, entry);
    console.warn(`[ACCOUNT LOCKOUT] Akun '${key}' dikunci selama 15 menit setelah ${entry.failedCount} kali percobaan gagal.`);
    return {
      locked: true,
      failedCount: entry.failedCount,
      remainingSeconds: Math.ceil(ACCOUNT_LOCKOUT_DURATION_MS / 1000),
    };
  }

  accountLockoutMap.set(key, entry);
  return {
    locked: false,
    failedCount: entry.failedCount,
    remainingSeconds: 0,
  };
}

/**
 * Reset status lockout dan hitungan gagal (dipanggil saat login berhasil).
 */
export function resetAccountLockout(rawIdentifier: string): void {
  const key = normalizeAccountIdentifier(rawIdentifier);
  if (key) {
    accountLockoutMap.delete(key);
  }
}

/**
 * Pembersihan entri usang berkala (FIFO & TTL).
 */
export function pruneAccountLockouts(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of accountLockoutMap.entries()) {
    if (entry.lockedUntil <= now && now - entry.lastAttempt > ACCOUNT_LOCKOUT_DURATION_MS) {
      accountLockoutMap.delete(key);
      removed++;
    }
  }

  while (accountLockoutMap.size > ACCOUNT_LOCKOUT_MAX_ENTRIES) {
    const oldestKey = accountLockoutMap.keys().next().value;
    if (oldestKey) {
      accountLockoutMap.delete(oldestKey);
      removed++;
    } else {
      break;
    }
  }

  return removed;
}

/**
 * Helper khusus pengetesan unit test (reset map ke state kosong).
 */
export function _clearAccountLockoutMapForTest(): void {
  accountLockoutMap.clear();
}
