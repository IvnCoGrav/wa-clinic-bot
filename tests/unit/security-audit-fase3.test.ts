import { describe, it, expect, beforeEach, vi } from 'vitest';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { encryptSecret, decryptSecretCompat, encryptSecretIfPossible } from '../../src/utils/encryption';
import { escapeCsvCell } from '../../src/services/financial-analytics.service';
import { backupService } from '../../src/services/backup.service';
import { BACKUP_STORAGE_DIR } from '../../src/utils/backup-file';

/**
 * SEC-AUDIT Fase 3 adversarial:
 * - 3-1 enkripsi + dual-read (bukan sekadar menulis terenkripsi).
 * - 3-2 restore SQL mentah ditolak.
 * - 3-3 formula injection CSV dinetralkan.
 */
describe('Security Audit Fase 3 (data & resource)', () => {
  describe('3-1 dual-read kredensial (encrypt → decrypt, legacy → apa adanya)', () => {
    beforeEach(() => {
      process.env.WABA_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    });

    it('nilai terenkripsi di-decrypt kembali ke plaintext asli', () => {
      const secret = 'refresh-token-google-abc123';
      const enc = encryptSecret(secret);
      expect(enc).not.toBe(secret);
      expect(enc).not.toContain(secret);
      expect(decryptSecretCompat(enc)).toBe(secret);
    });

    it('plaintext legacy (bukan payload AES) dikembalikan apa adanya', () => {
      expect(decryptSecretCompat('token-legacy-plaintext')).toBe('token-legacy-plaintext');
    });

    it('nilai null/undefined/kosong → string kosong, tanpa throw', () => {
      expect(decryptSecretCompat(null)).toBe('');
      expect(decryptSecretCompat(undefined)).toBe('');
      expect(decryptSecretCompat('')).toBe('');
    });

    it('encryptSecretIfPossible tetap mengembalikan plaintext bila kunci tak ada (no crash)', () => {
      delete process.env.WABA_TOKEN_ENCRYPTION_KEY;
      delete process.env.ADMIN_API_KEY;
      delete process.env.APP_SECRET;
      const out = encryptSecretIfPossible('tok');
      expect(out).toBe('tok');
    });
  });

  describe('3-2 restore SQL mentah ditolak (anti arbitrary SQL)', () => {
    beforeEach(() => {
      if (!fs.existsSync(BACKUP_STORAGE_DIR)) fs.mkdirSync(BACKUP_STORAGE_DIR, { recursive: true });
    });

    it('dump SQL mentah (.sql.gz berisi DROP) → reject, bukan dieksekusi', async () => {
      const sqlPath = path.join(BACKUP_STORAGE_DIR, 'audit3_raw.sql.gz');
      fs.writeFileSync(sqlPath, zlib.gzipSync(Buffer.from('DROP TABLE customers; DELETE FROM reservations;')));
      try {
        await expect(backupService.restoreDatabaseFromDump(sqlPath, 'default-tenant')).rejects.toThrow(
          /Format backup tidak didukung/i
        );
      } finally {
        if (fs.existsSync(sqlPath)) fs.unlinkSync(sqlPath);
      }
    });

    it('dump JSON internal tetap diterima (jalur restore sah tidak rusak)', async () => {
      const jsonPath = path.join(BACKUP_STORAGE_DIR, 'audit3_json.json.gz');
      const payload = {
        meta: { exportedAt: new Date().toISOString() },
        tables: { customers: [{ id: 'c1', name: 'Audit', phone: '628000' }] },
      };
      fs.writeFileSync(jsonPath, zlib.gzipSync(Buffer.from(JSON.stringify(payload))));
      try {
        const res = await backupService.restoreDatabaseFromDump(jsonPath, 'default-tenant');
        expect(res.success).toBe(true);
      } finally {
        if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
      }
    });
  });

  describe('3-3 formula injection CSV dinetralkan', () => {
    it('prefix = + - @ TAB CR diberi kutip tunggal', () => {
      expect(escapeCsvCell('=cmd|calc')).toBe(`"'=cmd|calc"`);
      expect(escapeCsvCell('+SUM(A1)')).toBe(`"'+SUM(A1)"`);
      expect(escapeCsvCell('-2+3')).toBe(`"'-2+3"`);
      expect(escapeCsvCell('@import')).toBe(`"'@import"`);
      expect(escapeCsvCell('\tx')).toBe(`"'\tx"`);
    });

    it('teks normal tidak diubah + kutip ganda di-escape', () => {
      expect(escapeCsvCell('Bunda Sari')).toBe(`"Bunda Sari"`);
      expect(escapeCsvCell('Dinda "D"')).toBe(`"Dinda ""D"""`);
    });

    it('angka biasa (tarif) tidak diberi prefix', () => {
      expect(escapeCsvCell(150000)).toBe(`"150000"`);
    });
  });
});
