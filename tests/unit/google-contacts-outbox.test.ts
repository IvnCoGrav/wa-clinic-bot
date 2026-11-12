import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { DistributedKv } from '../../src/utils/distributed-kv';
import {
  GoogleContactsOutbox,
  MAX_OUTBOX_ATTEMPTS,
  OUTBOX_BACKOFF_MS,
  googleContactsOutbox,
} from '../../src/services/google-contacts-outbox.service';
import { googleContactsService } from '../../src/services/google-contacts.service';
import { googleOAuthClientManager } from '../../src/integrations/google-contacts/google-oauth.client';

/**
 * I-007 — antrean retry Google Contacts.
 *
 * Kontrak yang dijaga:
 * 1. Kegagalan sinkronisasi masuk antrean (tidak hilang diam-diam).
 * 2. Satu customer = satu item; kegagalan berulang tidak menumpuk.
 * 3. Backoff eksponensial & batas percobaan; setelah batas → dibuang + log.
 * 4. drainAll memproses semua tenant yang punya antrean.
 * 5. Lookup customer pada sync WAJIB difilter tenant.
 */

let clock = 1_700_000_000_000;
const now = () => clock;

function makeOutbox() {
  return new GoogleContactsOutbox(new DistributedKv({ forceMemory: true }), now);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  clock = 1_700_000_000_000;
  await googleContactsOutbox.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await googleContactsOutbox.clear();
});

describe('enqueue', () => {
  it('mencatat item dengan percobaan pertama & jadwal backoff', async () => {
    const outbox = makeOutbox();
    const item = await outbox.enqueue('tenant-a', 'cust-1', 'chat', 'jaringan putus');

    expect(item).toMatchObject({
      tenantId: 'tenant-a',
      customerId: 'cust-1',
      trigger: 'chat',
      attempts: 1,
      nextAttemptAt: clock + OUTBOX_BACKOFF_MS[0],
      lastError: 'jaringan putus',
    });
    expect(await outbox.pendingCount('tenant-a')).toBe(1);
  });

  it('kegagalan berulang untuk customer sama tidak menggandakan item', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue('tenant-a', 'cust-1', 'chat', 'error-1');
    await outbox.enqueue('tenant-a', 'cust-1', 'reservation', 'error-2');

    const items = await outbox.list('tenant-a');
    expect(items).toHaveLength(1);
    expect(items[0].attempts).toBe(1); // tidak menambah hitungan saat enqueue
    expect(items[0].lastError).toBe('error-2');
    expect(items[0].trigger).toBe('reservation');
  });

  it('tenant berbeda punya antrean terpisah', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue('tenant-a', 'cust-1');
    await outbox.enqueue('tenant-b', 'cust-1');

    expect(await outbox.pendingCount('tenant-a')).toBe(1);
    expect(await outbox.pendingCount('tenant-b')).toBe(1);
  });
});

describe('drain', () => {
  it('melewati item yang belum jatuh tempo', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue('tenant-a', 'cust-1');
    const spy = vi.spyOn(googleContactsService, 'syncCustomer').mockResolvedValue({ success: true, action: 'updated' } as any);

    const result = await outbox.drain('tenant-a');

    expect(result).toMatchObject({ processed: 0, deferred: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('sukses → item dihapus dari antrean', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue('tenant-a', 'cust-1');
    clock += OUTBOX_BACKOFF_MS[0];
    vi.spyOn(googleContactsService, 'syncCustomer').mockResolvedValue({ success: true, action: 'updated' } as any);

    const result = await outbox.drain('tenant-a');

    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    expect(await outbox.pendingCount('tenant-a')).toBe(0);
  });

  it('gagal → attempts naik & backoff berikutnya dipakai', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue('tenant-a', 'cust-1');
    clock += OUTBOX_BACKOFF_MS[0];
    vi.spyOn(googleContactsService, 'syncCustomer').mockResolvedValue({ success: false, error: 'rate limit' } as any);

    const result = await outbox.drain('tenant-a');

    expect(result).toMatchObject({ processed: 1, failed: 1, succeeded: 0 });
    const [item] = await outbox.list('tenant-a');
    expect(item.attempts).toBe(2);
    expect(item.nextAttemptAt).toBe(clock + OUTBOX_BACKOFF_MS[1]);
    expect(item.lastError).toBe('rate limit');
  });

  it('melewati MAX_OUTBOX_ATTEMPTS → dibuang, bukan retry selamanya', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue('tenant-a', 'cust-1');
    vi.spyOn(googleContactsService, 'syncCustomer').mockResolvedValue({ success: false, error: 'tetap gagal' } as any);

    let drops = 0;
    for (let i = 0; i < MAX_OUTBOX_ATTEMPTS + 2; i++) {
      const result = await outbox.drain('tenant-a', { force: true });
      drops += result.dropped;
      if ((await outbox.pendingCount('tenant-a')) === 0) break;
    }

    expect(drops).toBe(1);
    expect(await outbox.pendingCount('tenant-a')).toBe(0);
    expect(googleContactsService.syncCustomer).toHaveBeenCalledTimes(MAX_OUTBOX_ATTEMPTS - 1);
  });

  it('drain tidak mengantrekan ulang kegagalannya sendiri (fromOutbox)', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue('tenant-a', 'cust-1');
    const spy = vi
      .spyOn(googleContactsService, 'syncCustomer')
      .mockResolvedValue({ success: false, error: 'gagal' } as any);

    await outbox.drain('tenant-a', { force: true });

    expect(spy).toHaveBeenCalledWith('tenant-a', 'cust-1', {
      trigger: 'manual',
      fromOutbox: true,
    });
    // Enqueue oleh wrapper service TIDAK terjadi (spy menggantikan method asli),
    // jadi antrean hanya berisi item yang sama dengan attempts naik.
    expect(await outbox.pendingCount('tenant-a')).toBe(1);
  });
});

describe('drainAll', () => {
  it('memproses antrean semua tenant', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue('tenant-a', 'cust-1');
    await outbox.enqueue('tenant-b', 'cust-2');
    clock += OUTBOX_BACKOFF_MS[0];
    vi.spyOn(googleContactsService, 'syncCustomer').mockResolvedValue({ success: true, action: 'created' } as any);

    const summary = await outbox.drainAll();

    expect(summary['tenant-a'].succeeded).toBe(1);
    expect(summary['tenant-b'].succeeded).toBe(1);
    expect(await outbox.pendingCount('tenant-a')).toBe(0);
    expect(await outbox.pendingCount('tenant-b')).toBe(0);
  });
});

describe('syncCustomer otomatis mengantrekan kegagalan', () => {
  function stubGoogleIntegration() {
    (prisma as any).tenantGoogleIntegration = {
      findUnique: vi.fn().mockResolvedValue({
        tenant_id: 'tenant-a',
        is_enabled: true,
        refresh_token: 'refresh-token',
        auto_sync_on_chat: true,
        auto_sync_on_reserve: true,
        naming_template: '{{name}}',
        contact_label: 'Pasien',
      }),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    };
  }

  it('lookup customer difilter tenant dan kegagalan API masuk antrean', async () => {
    stubGoogleIntegration();
    const findFirst = vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
      id: 'cust-1',
      tenant_id: 'tenant-a',
      name: 'Bunda A',
      phone: '628111111111',
      children: [],
      reservations: [],
      is_sandbox_test: false,
      google_resource_name: null,
      google_synced_at: null,
      updated_at: new Date(),
    } as any);
    vi.spyOn(googleOAuthClientManager, 'getAuthenticatedClient').mockResolvedValue(null);

    const res = await googleContactsService.syncCustomer('tenant-a', 'cust-1', { trigger: 'chat' });

    expect(res.success).toBe(false);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cust-1', tenant_id: 'tenant-a' } })
    );
    const items = await googleContactsOutbox.list('tenant-a');
    expect(items).toHaveLength(1);
    expect(items[0].customerId).toBe('cust-1');
    expect(items[0].lastError).toMatch(/OAuth/i);
  });

  it('customer tidak ditemukan TIDAK diantrekan (kegagalan permanen)', async () => {
    stubGoogleIntegration();
    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue(null);

    const res = await googleContactsService.syncCustomer('tenant-a', 'cust-hilang');

    expect(res.success).toBe(false);
    expect(await googleContactsOutbox.pendingCount('tenant-a')).toBe(0);
  });

  it('kegagalan dari drain (fromOutbox) tidak mengantrekan ulang', async () => {
    stubGoogleIntegration();
    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue(null);
    vi.spyOn(googleOAuthClientManager, 'getAuthenticatedClient').mockResolvedValue(null);

    await googleContactsService.syncCustomer('tenant-a', 'cust-1', {
      trigger: 'manual',
      fromOutbox: true,
    });

    expect(await googleContactsOutbox.pendingCount('tenant-a')).toBe(0);
  });

  it('status integrasi menampilkan jumlah antrean (outboxPending)', async () => {
    stubGoogleIntegration();
    vi.spyOn(prisma.customer, 'count').mockResolvedValue(0);
    await googleContactsOutbox.enqueue('tenant-a', 'cust-1');

    const status = await googleContactsService.getIntegrationStatus('tenant-a');

    expect(status.outboxPending).toBe(1);
  });
});
