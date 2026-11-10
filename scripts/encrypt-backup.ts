/**
 * scripts/encrypt-backup.ts
 *
 * Enkripsi biner file backup dengan AES-256-GCM (format ENC1) menggunakan
 * utilitas yang sama dengan backup.service.ts. Dipakai scripts/backup.sh agar
 * arsip tar.gz tidak pernah tersimpan sebagai plaintext.
 *
 * Penggunaan:
 *   npx tsx scripts/encrypt-backup.ts <input> <output>
 */

import fs from 'fs';
import { encryptBufferWithKey, getBackupEncryptionKey } from '../src/utils/encryption';

const [input, output] = process.argv.slice(2);

if (!input || !output) {
  console.error('Usage: npx tsx scripts/encrypt-backup.ts <input> <output>');
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`[BACKUP ENCRYPT] Input tidak ditemukan: ${input}`);
  process.exit(1);
}

try {
  const key = getBackupEncryptionKey();
  const plain = fs.readFileSync(input);
  const encrypted = encryptBufferWithKey(plain, key);
  fs.writeFileSync(output, encrypted);
  fs.unlinkSync(input);
  console.log(`[BACKUP ENCRYPT] ${output} (${encrypted.length} bytes, ENC1/AES-256-GCM)`);
} catch (err: any) {
  console.error('[BACKUP ENCRYPT] Gagal:', err?.message || err);
  process.exit(1);
}
