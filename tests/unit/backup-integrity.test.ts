import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { backupService } from '../../src/services/backup.service';
import { prisma } from '../../src/db/client';
import { encryptBufferWithKey, getBackupEncryptionKey } from '../../src/utils/encryption';

describe('Backup Integrity & Fail-Closed Encryption (Task 0.4)', () => {
  let createdFiles: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const f of createdFiles) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
    }
    createdFiles = [];
  });

  it('should FAIL-CLOSED (throw Error) when table export fails during backup dump', async () => {
    // Simulasikan database error pada salah satu tabel utama
    vi.spyOn(prisma.customer, 'findMany').mockRejectedValue(new Error('Postgres connection reset during dump'));

    // Pada kode lama, error ditelan oleh `.catch(() => [])` dan dump tetap selesai dengan sukses (fail-open).
    // Pada model fail-closed, kegagalan pembacaan tabel wajib melempar error dan membatalkan backup.
    await expect(backupService.createDatabaseDump('tenant-test')).rejects.toThrow();
  });

  it('should produce an ENCRYPTED file that cannot be unpacked as raw gzip without encryption key', async () => {
    // Setup mock data minimal
    vi.spyOn(prisma.customer, 'findMany').mockResolvedValue([{ id: 'c1' }] as any);
    vi.spyOn(prisma.child, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.reservationArchive, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.clinicService, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.deliveryTier, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.staff, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.tenantPersona, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.tenantAiConfig, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.knowledgeChunk, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.conversation, 'findMany').mockResolvedValue([] as any);
    vi.spyOn(prisma.message, 'findMany').mockResolvedValue([] as any);

    const result = await backupService.createDatabaseDump('tenant-test');
    createdFiles.push(result.filePath);

    const rawBytes = fs.readFileSync(result.filePath);

    // Pada kode lama, file adalah raw gzip biasa (magic bytes 0x1f, 0x8b).
    // Siapa pun yang mengambil file bisa langsung gunzip dan membaca JSON plaintext.
    // Pada model terenkripsi (Fase 3), file WAJIB terenkripsi (AES-256-GCM) dan gunzip langsung HARUS gagal.
    const canBeGunzippedDirectly = (() => {
      try {
        const decompressed = zlib.gunzipSync(rawBytes).toString('utf-8');
        return decompressed.includes('"tables"');
      } catch {
        return false;
      }
    })();

    // Ekspektasi: file TIDAK boleh bisa di-gunzip langsung menghasilkan JSON plaintext tanpa dekripsi
    expect(canBeGunzippedDirectly).toBe(false);
  });

  it('should verify encrypted SQL pg_dump payload (format-aware, bukan hanya JSON)', () => {
    const key = getBackupEncryptionKey();
    const sql = [
      '--',
      '-- PostgreSQL database dump',
      '--',
      '',
      'CREATE TABLE public.customers (id text);',
      'COPY public.customers (id) FROM stdin;',
      'c1',
      '\\.',
      '',
      // Padding agar melewati ambang minimum dump SQL (1 KB).
      ...Array.from({ length: 80 }, (_, i) => `-- padding ${i} ${'x'.repeat(20)}`),
    ].join('\n');
    const encrypted = encryptBufferWithKey(zlib.gzipSync(Buffer.from(sql, 'utf-8')), key);
    const file = path.join(process.cwd(), 'storage', 'backups', `test-sql-${Date.now()}.sql.gz`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encrypted);
    createdFiles.push(file);

    const counts = backupService.getBackupFileCounts(file);
    expect(counts).not.toBeNull();
    expect(counts!.__format_sql).toBe(1);
  });

  it('should emit CRITICAL AlertType.BACKUP_FAILED and return status failed when backup fails (Task 3.7)', async () => {
    const { cronService } = await import('../../src/services/cron.service');
    const { alertService, AlertType, AlertSeverity } = await import('../../src/services/alert.service');

    const alertSpy = vi.spyOn(alertService, 'notifyAlert').mockResolvedValue(undefined as any);
    vi.spyOn(backupService, 'createDatabaseDump').mockRejectedValue(new Error('Disk space exhausted'));

    const result = await cronService.runWeeklyBackup('tenant-alert-test');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Disk space exhausted');
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AlertType.BACKUP_FAILED,
        severity: AlertSeverity.CRITICAL,
        tenantId: 'tenant-alert-test',
      })
    );
  });
});
