import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * F7 / M17-13 — bundel migrasi memuat .env + PII penuh.
 * Kontrak skrip: wajib terenkripsi ENC1, checksum wajib diverifikasi, mode file
 * privat, dan host key SSH diverifikasi (bukan `StrictHostKeyChecking=no`).
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, 'scripts', file), 'utf-8');

describe('F7 — kontrak skrip migrasi VPS', () => {
  const exp = read('vps-migrate-export.sh');
  const imp = read('vps-migrate-import.sh');

  it('export: umask 077 + direktori sementara privat', () => {
    expect(exp).toMatch(/^umask 077$/m);
    expect(exp).toContain('chmod 700 "$TMP_DIR"');
    expect(exp).toContain('chmod 600 "$TMP_DIR/.env"');
  });

  it('export: bundel WAJIB dienkripsi ENC1 sebelum transfer (fail-closed)', () => {
    expect(exp).toContain('encrypt-backup.ts');
    expect(exp).toContain('"ENC1"');
    expect(exp).toMatch(/BACKUP_ENCRYPTION_KEY/);
    // Plaintext tidak boleh ditransfer.
    expect(exp).not.toMatch(/scp[^\n]*\$BUNDLE_TAR"/);
  });

  it('export: host key SSH diverifikasi (tidak memakai StrictHostKeyChecking=no)', () => {
    expect(exp).not.toContain('StrictHostKeyChecking=no');
    expect(exp).toContain('StrictHostKeyChecking=accept-new');
  });

  it('export: checksum ditulis relatif (dapat diverifikasi di server tujuan)', () => {
    expect(exp).toMatch(/cd "\$BACKUP_DIR" && sha256sum/);
  });

  it('import: checksum WAJIB, bukan opsional', () => {
    expect(imp).toContain('CHECKSUM_FILE="$BUNDLE_FILE.sha256"');
    expect(imp).toMatch(/checksum .*tidak ada/i);
    expect(imp).not.toMatch(/if \[ -f "\$BUNDLE_FILE\.sha256" \]/);
  });

  it('import: dekripsi ENC1 sebelum ekstraksi + .env mode 600', () => {
    expect(imp).toContain('decrypt-backup.ts');
    expect(imp).toContain('chmod 600 "$APP_DIR/.env"');
    expect(imp).toContain('umask 077');
  });

  it('import: checksum diverifikasi dari direktori berkas (path relatif)', () => {
    expect(imp).toMatch(/cd "\$\(dirname "\$BUNDLE_FILE"\)" && sha256sum -c/);
  });

  it('skrip dekripsi tersedia dan memakai utilitas enkripsi kanonis', () => {
    const dec = read('decrypt-backup.ts');
    expect(dec).toContain('decryptBufferWithKey');
    expect(dec).toContain('isEncryptedBackupBuffer');
    expect(dec).toContain('getBackupEncryptionKey');
  });

  it('tidak ada lagi transfer .env plaintext ke host lain', () => {
    expect(exp).not.toMatch(/scp[^\n]*\.env/);
    expect(imp).not.toMatch(/scp[^\n]*\.env/);
  });
});
