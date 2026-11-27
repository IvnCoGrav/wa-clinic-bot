/**
 * scripts/decrypt-backup.ts
 *
 * Dekripsi file backup/bundle migrasi berformat ENC1 (AES-256-GCM) memakai
 * utilitas yang sama dengan backup.service.ts. Dipakai scripts/vps-migrate-import.sh
 * agar bundel migrasi tidak pernah berpindah server sebagai plaintext.
 *
 * Penggunaan:
 *   npx tsx scripts/decrypt-backup.ts <input.enc> <output>
 */

import fs from 'fs';
import {
  decryptBufferWithKey,
  getBackupEncryptionKey,
  isEncryptedBackupBuffer,
} from '../src/utils/encryption';

const [input, output] = process.argv.slice(2);

if (!input || !output) {
  console.error('Usage: npx tsx scripts/decrypt-backup.ts <input.enc> <output>');
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`[BACKUP DECRYPT] Input tidak ditemukan: ${input}`);
  process.exit(1);
}

try {
  const raw = fs.readFileSync(input);
  if (!isEncryptedBackupBuffer(raw)) {
    console.error('[BACKUP DECRYPT] File bukan bundel ENC1 yang valid — dekripsi dibatalkan.');
    process.exit(1);
  }
  const key = getBackupEncryptionKey();
  const plain = decryptBufferWithKey(raw, key);
  fs.writeFileSync(output, plain);
  console.log(`[BACKUP DECRYPT] ${output} (${plain.length} bytes)`);
} catch (err: any) {
  console.error('[BACKUP DECRYPT] Gagal:', err?.message || err);
  process.exit(1);
}
