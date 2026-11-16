import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './paths.mjs';

export const DEFAULT_EXCEPTIONS_FILE = path.join(ROOT_DIR, 'scripts/reuse/exceptions.json');

/**
 * Memuat dan mengelompokkan exception registry ke dalam active vs expired.
 */
export function loadExceptions(filePath = DEFAULT_EXCEPTIONS_FILE, now = new Date()) {
  if (!fs.existsSync(filePath)) {
    return { active: [], expired: [], errors: [] };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const active = [];
    const expired = [];
    const errors = [];

    for (const exc of data.exceptions || []) {
      if (!exc.rule) {
        errors.push(`Entri exception wajib memiliki "rule": ${JSON.stringify(exc)}`);
        continue;
      }
      if (!exc.expiresAt) {
        errors.push(`Entri exception "${exc.rule}" wajib memiliki "expiresAt" (tidak ada dispensasi abadi): ${JSON.stringify(exc)}`);
        continue;
      }

      const expiryDate = new Date(exc.expiresAt);
      if (isNaN(expiryDate.getTime())) {
        errors.push(`Format tanggal expiresAt "${exc.expiresAt}" tidak valid pada exception "${exc.rule}"`);
        continue;
      }

      if (expiryDate < now) {
        expired.push(exc);
      } else {
        active.push(exc);
      }
    }

    return { active, expired, errors };
  } catch (err) {
    return { active: [], expired: [], errors: [`Gagal membaca exceptions.json: ${err.message}`] };
  }
}

/**
 * Mencocokkan sebuah pelanggaran terhadap daftar exception aktif.
 * Mengembalikan objek exception bila cocok (sehingga pelanggaran dapat dikecualikan), atau null jika tidak cocok.
 */
export function matchException(violation, activeExceptions) {
  if (!activeExceptions || activeExceptions.length === 0) return null;

  for (const exc of activeExceptions) {
    // 1. Rule wajib cocok
    if (exc.rule !== violation.type) continue;

    // 2. Pencocokan spesifik (fingerprint, file, atau name)
    // Jangan izinkan wildcard kosong yang mengecualikan seluruh kategori tanpa target spesifik
    let hasTarget = false;

    // A. Match Fingerprint / Hash
    if (exc.fingerprint) {
      hasTarget = true;
      if (violation.hash && violation.hash === exc.fingerprint) return exc;
      if (violation.fingerprint && violation.fingerprint === exc.fingerprint) return exc;
    }

    // B. Match File
    if (exc.file) {
      hasTarget = true;
      if (violation.file && violation.file === exc.file) return exc;
      if (Array.isArray(violation.files) && violation.files.some(f => f.file === exc.file)) return exc;
      if (Array.isArray(violation.cycle) && violation.cycle.includes(exc.file)) return exc;
    }

    // C. Match Symbol Name
    if (exc.name) {
      hasTarget = true;
      if (violation.name && violation.name === exc.name) return exc;
      if (Array.isArray(violation.files) && violation.files.some(f => f.name === exc.name)) return exc;
    }

    // Bila exception tidak mencantumkan fingerprint, file, ataupun name, tolak (tidak boleh blanket exception)
    if (!hasTarget) {
      continue;
    }
  }

  return null;
}
