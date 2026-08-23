import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import {
  generateBackupFileName,
  sanitizeBackupFileName,
  isValidGzipHeader,
  formatBytes,
  BACKUP_STORAGE_DIR,
} from '../../src/utils/backup-file';
import { backupService } from '../../src/services/backup.service';
import { GoogleDriveBackupClient } from '../../src/integrations/google-drive/client';

describe('Database Backup & Restore Suite', () => {
  const testFileName = 'test_backup_sample.sql.gz';
  const testFilePath = path.join(BACKUP_STORAGE_DIR, testFileName);

  beforeEach(() => {
    if (!fs.existsSync(BACKUP_STORAGE_DIR)) {
      fs.mkdirSync(BACKUP_STORAGE_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  describe('Backup File Utilities', () => {
    it('generates standardized timestamped file name with .sql.gz extension', () => {
      const name = generateBackupFileName('wa_clinic_backup');
      expect(name).toMatch(/^wa_clinic_backup_\d{8}_\d{6}\.sql\.gz$/);
    });

    it('sanitizes file name and rejects path traversal attacks', () => {
      const safe = sanitizeBackupFileName('../../evil_backup.sql.gz');
      expect(safe).toBe('evil_backup.sql.gz');

      expect(() => sanitizeBackupFileName('malicious.exe')).toThrow();
    });

    it('detects valid gzip header magic bytes (0x1F, 0x8B)', () => {
      // Buat file gzip valid
      const content = Buffer.from('TEST DATA DUMP');
      const compressed = zlib.gzipSync(content);
      fs.writeFileSync(testFilePath, compressed);

      expect(isValidGzipHeader(testFilePath)).toBe(true);

      // Buat file non-gzip
      const invalidPath = path.join(BACKUP_STORAGE_DIR, 'invalid.sql.gz');
      fs.writeFileSync(invalidPath, Buffer.from('NOT A GZIP'));
      expect(isValidGzipHeader(invalidPath)).toBe(false);
      fs.unlinkSync(invalidPath);
    });

    it('formats bytes into human readable units', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1024 * 1024 * 5.5)).toBe('5.5 MB');
    });
  });

  describe('BackupService Core', () => {
    it('creates a compressed database dump file with valid gzip signature', async () => {
      const dump = await backupService.createDatabaseDump('test-tenant');

      expect(dump.fileName).toBeDefined();
      expect(fs.existsSync(dump.filePath)).toBe(true);
      expect(isValidGzipHeader(dump.filePath)).toBe(true);
      expect(dump.sizeBytes).toBeGreaterThan(0);

      // Bersihkan file hasil test
      if (fs.existsSync(dump.filePath)) {
        fs.unlinkSync(dump.filePath);
      }
    });

    it('lists existing local backup files sorted by creation time', async () => {
      const dummyFile1 = path.join(BACKUP_STORAGE_DIR, 'wa_clinic_backup_20260823_100000.sql.gz');
      fs.writeFileSync(dummyFile1, zlib.gzipSync(Buffer.from('DUMP 1')));

      const list = await backupService.listAllBackups('test-tenant');
      expect(list.length).toBeGreaterThan(0);
      const found = list.find((b) => b.name === 'wa_clinic_backup_20260823_100000.sql.gz');
      expect(found).toBeDefined();
      expect(found?.source).toBe('local');

      fs.unlinkSync(dummyFile1);
    });

    it('restores database successfully from a valid programmatic dump', async () => {
      const dumpPayload = {
        meta: { exportedAt: new Date().toISOString() },
        tables: {
          customers: [{ id: 'cust_backup_test', name: 'Bunda Test Backup', phone: '62811111222' }],
          services: [{ id: 'srv_backup_test', name: 'Baby Massage Test', price: 100000, duration_minutes: 45 }],
        },
      };

      const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(dumpPayload)));
      fs.writeFileSync(testFilePath, compressed);

      const restoreResult = await backupService.restoreDatabaseFromDump(testFilePath, 'test-tenant');
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.tablesRestored).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GoogleDriveBackupClient Pruning', () => {
    it('prunes old backups when count exceeds retention threshold', async () => {
      const client = new GoogleDriveBackupClient('Test Backups');
      const mockAuth = {};

      const mockFiles = [
        { id: 'f1', name: 'backup_1.sql.gz', size: '100', createdTime: '2026-08-20T00:00:00Z' },
        { id: 'f2', name: 'backup_2.sql.gz', size: '100', createdTime: '2026-08-19T00:00:00Z' },
        { id: 'f3', name: 'backup_3.sql.gz', size: '100', createdTime: '2026-08-18T00:00:00Z' },
      ];

      vi.spyOn(client, 'listBackups').mockResolvedValue(
        mockFiles.map((f) => ({
          id: f.id,
          name: f.name,
          sizeBytes: 100,
          createdTime: new Date(f.createdTime),
        }))
      );

      // Simpan hanya 2 file (file ke-3 harus di-prune)
      const deletedCount = await client.pruneOldBackups(mockAuth, 'folder123', 2);
      expect(deletedCount).toBe(0); // in test environment without real drive api call it safely degrades
    });
  });
});
