import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import {
  getCronHealthSnapshotAsync,
  getCronHealthSnapshot,
  resetCronHealth,
} from '../../src/lifecycle/cron-health';
import { GoogleContactsOutbox, MAX_OUTBOX_ATTEMPTS } from '../../src/services/google-contacts-outbox.service';
import { DistributedKv } from '../../src/utils/distributed-kv';
import { googleContactsService } from '../../src/services/google-contacts.service';

describe('F5 — cron heartbeat & outbox claim', () => {
  beforeEach(() => {
    resetCronHealth();
    process.env.ADMIN_API_KEY = 'test_admin_key_f5';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SEPARATE_WORKER;
  });

  describe('cron health lintas proses (DB heartbeat)', () => {
    it('membaca heartbeat worker dari DB dan menandai DEGRADED saat kegagalan beruntun', async () => {
      (prisma as any).cronJobHeartbeat = {
        findMany: vi.fn().mockResolvedValue([
          {
            job_name: 'sheets-sync',
            last_started_at: new Date(Date.now() - 60_000),
            last_finished_at: new Date(Date.now() - 30_000),
            last_status: 'FAILED',
            last_error: 'boom',
            consecutive_failures: 3,
          },
        ]),
      };

      const snapshot = await getCronHealthSnapshotAsync();
      expect(snapshot.status).toBe('DEGRADED');
      expect(snapshot.failingJobs).toContain('sheets-sync');
      expect(snapshot.jobs[0].name).toBe('sheets-sync');
    });

    it('job yang mulai tapi tidak pernah selesai (stuck) dianggap gagal', async () => {
      (prisma as any).cronJobHeartbeat = {
        findMany: vi.fn().mockResolvedValue([
          {
            job_name: 'media-cleanup',
            last_started_at: new Date(Date.now() - 60 * 60_000),
            last_finished_at: null,
            last_status: null,
            last_error: null,
            consecutive_failures: 0,
          },
        ]),
      };

      const snapshot = await getCronHealthSnapshotAsync();
      expect(snapshot.failingJobs).toContain('media-cleanup');
      expect(snapshot.status).toBe('DEGRADED');
    });

    it('tabel kosong → fallback registry in-memory (bukan crash)', async () => {
      (prisma as any).cronJobHeartbeat = { findMany: vi.fn().mockResolvedValue([]) };
      const snapshot = await getCronHealthSnapshotAsync();
      const local = getCronHealthSnapshot();
      expect(snapshot.status).toBe(local.status);
      expect(snapshot.jobs).toEqual(local.jobs);
    });

    it('/ready tidak READY saat mode worker terpisah tidak punya heartbeat', async () => {
      process.env.SEPARATE_WORKER = 'true';
      (prisma as any).cronJobHeartbeat = { findMany: vi.fn().mockResolvedValue([]) };
      const app = buildApp();
      const res = await app.inject({ method: 'GET', url: '/ready' });
      const body = res.json();
      expect(body.status).toBe('NOT_READY');
      // M19-09: detail cron tidak lagi bocor di endpoint publik.
      expect(body.checks).toBeUndefined();
      expect(res.statusCode).toBe(503);
      await app.close();
    });
  });

  describe('Google contacts outbox', () => {
    it('tidak memproses item jika lock dipegang proses lain', async () => {
      const kv = new DistributedKv({ forceMemory: true });
      const outbox = new GoogleContactsOutbox(kv, () => 1_700_000_000_000);
      await outbox.enqueue('tenant-a', 'cust-1', 'chat', 'err');
      vi.spyOn(kv, 'setNx').mockResolvedValue(false);
      const syncSpy = vi.spyOn(googleContactsService, 'syncCustomer').mockResolvedValue({ success: true } as any);

      const res = await outbox.drain('tenant-a', { force: true });
      expect(res.processed).toBe(1);
      expect(res.deferred).toBe(1);
      expect(syncSpy).not.toHaveBeenCalled();
    });

    it('item yang habis percobaan masuk dead-letter, bukan hilang diam-diam', async () => {
      const kv = new DistributedKv({ forceMemory: true });
      const outbox = new GoogleContactsOutbox(kv, () => 1_700_000_000_000);
      await outbox.enqueue('tenant-a', 'cust-dead', 'chat', 'awal');
      // Naikkan attempts mendekati batas.
      await kv.set(
        'gcontact:outbox:tenant-a:cust-dead',
        JSON.stringify({
          tenantId: 'tenant-a',
          customerId: 'cust-dead',
          trigger: 'chat',
          attempts: MAX_OUTBOX_ATTEMPTS - 1,
          nextAttemptAt: 0,
          lastError: 'awal',
        }),
        7 * 24 * 60 * 60 * 1000
      );
      vi.spyOn(googleContactsService, 'syncCustomer').mockRejectedValue(new Error('gagal terus'));

      const res = await outbox.drain('tenant-a', { force: true });
      expect(res.dropped).toBe(1);
      const dead = await kv.get('gcontact:outbox:dead:tenant-a:cust-dead');
      expect(dead).toBeTruthy();
      expect(JSON.parse(dead as string).lastError).toMatch(/gagal terus/);
    });
  });
});
