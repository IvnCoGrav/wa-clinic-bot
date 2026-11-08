import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { backupService } from '../../src/services/backup.service';
import { prisma } from '../../src/db/client';
import { isValidEncryptedHeader, BACKUP_STORAGE_DIR } from '../../src/utils/backup-file';
import { getBackupEncryptionKey, decryptBufferWithKey } from '../../src/utils/encryption';

describe('Backup Restore Drill Automation (Task 3.6)', () => {
  const createdFiles: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const f of createdFiles) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
    }
  });

  it('completes the full lifecycle: dump -> encrypt -> verify header -> decrypt -> gunzip -> manifest -> restore', async () => {
    // 1. Mock DB data
    vi.spyOn(prisma.customer, 'findMany').mockResolvedValue([{ id: 'c1', name: 'Bunda Drill', phone: '62811111111' }] as any);
    vi.spyOn(prisma.child, 'findMany').mockResolvedValue([{ id: 'ch1', customer_id: 'c1', name: 'Bayi Drill' }] as any);
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.reservationArchive, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.clinicService, 'findMany').mockResolvedValue([{ id: 'srv1', name: 'Pijat Laktasi' }] as any);
    vi.spyOn(prisma.deliveryTier, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.staff, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.tenantPersona, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.tenantAiConfig, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.knowledgeChunk, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.conversation, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.message, 'findMany').mockResolvedValue([] as any);

    // Mock upsert for restore
    vi.spyOn(prisma.customer, 'upsert').mockResolvedValue({ id: 'c1' } as any);
    vi.spyOn(prisma.child, 'upsert').mockResolvedValue({ id: 'ch1' } as any);
    vi.spyOn(prisma.clinicService, 'upsert').mockResolvedValue({ id: 'srv1' } as any);

    // 2. Create encrypted dump
    const dump = await backupService.createDatabaseDump('tenant-drill', { prefix: 'wa_clinic_drill' });
    createdFiles.push(dump.filePath);

    expect(fs.existsSync(dump.filePath)).toBe(true);
    expect(dump.sizeBytes).toBeGreaterThan(0);

    // 3. Header check
    expect(isValidEncryptedHeader(dump.filePath)).toBe(true);

    // 4. Raw gunzip must fail
    const rawBuffer = fs.readFileSync(dump.filePath);
    expect(() => zlib.gunzipSync(rawBuffer)).toThrow();

    // 5. Decrypt using BACKUP_ENCRYPTION_KEY
    const key = getBackupEncryptionKey();
    const decryptedBuffer = decryptBufferWithKey(rawBuffer, key);
    expect(decryptedBuffer.length).toBeGreaterThan(0);

    // 6. Gunzip decrypted buffer
    const decompressedJson = zlib.gunzipSync(decryptedBuffer).toString('utf-8');
    const parsed = JSON.parse(decompressedJson);

    expect(parsed.meta.schemaVersion).toBe('2.0');
    expect(parsed.meta.format).toBe('JSON_GZIP_ENCRYPTED_V1');
    expect(parsed.meta.tableCounts.customers).toBe(1);
    expect(parsed.meta.tableCounts.children).toBe(1);
    expect(parsed.meta.tableCounts.services).toBe(1);

    // 7. Test getBackupFileCounts on the encrypted file
    const counts = backupService.getBackupFileCounts(dump.filePath);
    expect(counts).not.toBeNull();
    expect(counts?.customers).toBe(1);
    expect(counts?.children).toBe(1);

    // 8. Restore from the encrypted dump
    const restoreResult = await backupService.restoreDatabaseFromDump(dump.filePath, 'tenant-drill', { force: true });
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.tablesRestored).toBeGreaterThanOrEqual(3);
  });
});
