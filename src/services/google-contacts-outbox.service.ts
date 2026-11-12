import { distributedKv, type DistributedKv } from '../utils/distributed-kv';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * google-contacts-outbox.service.ts — antrean retry sinkronisasi Google Contacts
 * (I-007).
 *
 * Latar: `syncCustomer` dipanggil best-effort dari jalur chat/reservasi. Bila
 * Google API/OAuth sedang gagal (token expired, rate limit, jaringan), customer
 * TIDAK pernah dicoba lagi — kontak hilang diam-diam dari Google Contacts.
 *
 * Desain:
 * - Antrean disimpan di KV bersama (`distributedKv`, Redis) dengan TTL 7 hari,
 *   jadi retry tetap hidup saat proses restart dan dibagi app ↔ worker. Tanpa
 *   migrasi tabel baru; bila Redis mati, antrean jatuh ke memori (degradasi
 *   jujur, dicatat di KNOWN_ISSUES).
 * - Backoff eksponensial 1m → 5m → 30m → 2j → 6j → 12j, maksimal 6 percobaan.
 * - Idempoten: satu customer = satu item (kunci `gcontact:outbox:<tenant>:<id>`),
 *   jadi kegagalan berulang tidak menumpuk antrean.
 * - `drainAll()` dijalankan cron background (interval 5 menit).
 */

export interface GoogleContactsOutboxItem {
  tenantId: string;
  customerId: string;
  trigger: string;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
}

export interface GoogleContactsOutboxDrainResult {
  processed: number;
  succeeded: number;
  failed: number;
  deferred: number;
  dropped: number;
}

export const MAX_OUTBOX_ATTEMPTS = 6;
export const OUTBOX_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
];
const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const itemKey = (tenantId: string, customerId: string) =>
  `gcontact:outbox:${tenantId}:${customerId}`;
const indexKey = (tenantId: string) => `gcontact:outbox:index:${tenantId}`;
const TENANTS_KEY = 'gcontact:outbox:tenants';

function safeParse(raw: string | null): GoogleContactsOutboxItem | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as GoogleContactsOutboxItem;
  } catch {
    return null;
  }
}

export class GoogleContactsOutbox {
  constructor(
    private readonly kv: DistributedKv = distributedKv,
    private readonly now: () => number = Date.now
  ) {}

  /** Catat satu kegagalan sinkronisasi (idempoten per customer). */
  async enqueue(
    tenantId: string = DEFAULT_TENANT_ID,
    customerId: string,
    trigger: string = 'manual',
    error?: string
  ): Promise<GoogleContactsOutboxItem | null> {
    if (!tenantId || !customerId) return null;

    const key = itemKey(tenantId, customerId);
    let existing: GoogleContactsOutboxItem | null = null;
    try {
      existing = safeParse(await this.kv.get(key));
    } catch {
      existing = null;
    }

    const item: GoogleContactsOutboxItem = existing
      ? { ...existing, trigger, lastError: error }
      : {
          tenantId,
          customerId,
          trigger,
          attempts: 1,
          nextAttemptAt: this.now() + OUTBOX_BACKOFF_MS[0],
          lastError: error,
        };

    try {
      await this.kv.set(key, JSON.stringify(item), OUTBOX_TTL_MS);
      await this.kv.sadd(indexKey(tenantId), customerId, OUTBOX_TTL_MS);
      await this.kv.sadd(TENANTS_KEY, tenantId, OUTBOX_TTL_MS);
      return item;
    } catch (err: any) {
      console.warn('[GoogleContactsOutbox] Gagal menulis antrean:', err?.message || err);
      return null;
    }
  }

  /** Daftar item antrean tenant (termasuk yang belum jatuh tempo). */
  async list(tenantId: string = DEFAULT_TENANT_ID): Promise<GoogleContactsOutboxItem[]> {
    let ids: string[] = [];
    try {
      ids = await this.kv.smembers(indexKey(tenantId));
    } catch {
      return [];
    }
    const items: GoogleContactsOutboxItem[] = [];
    for (const id of ids) {
      try {
        const item = safeParse(await this.kv.get(itemKey(tenantId, id)));
        if (item) items.push(item);
        else await this.kv.srem(indexKey(tenantId), id);
      } catch {
        /* abaikan item rusak */
      }
    }
    return items.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt);
  }

  async pendingCount(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    try {
      return (await this.kv.smembers(indexKey(tenantId))).length;
    } catch {
      return 0;
    }
  }

  private async remove(tenantId: string, customerId: string): Promise<void> {
    try {
      await this.kv.del(itemKey(tenantId, customerId));
      await this.kv.srem(indexKey(tenantId), customerId);
    } catch {
      /* best-effort */
    }
  }

  /**
   * Proses item yang sudah jatuh tempo. `force` mengabaikan `nextAttemptAt`
   * (dipakai admin/test), backoff normal dipakai cron.
   */
  async drain(
    tenantId: string = DEFAULT_TENANT_ID,
    opts: { force?: boolean; limit?: number } = {}
  ): Promise<GoogleContactsOutboxDrainResult> {
    const result: GoogleContactsOutboxDrainResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      deferred: 0,
      dropped: 0,
    };

    const items = await this.list(tenantId);
    const limit = Math.max(1, opts.limit ?? 50);

    for (const item of items.slice(0, limit)) {
      if (!opts.force && this.now() < item.nextAttemptAt) {
        result.deferred++;
        continue;
      }
      result.processed++;

      let success = false;
      let errorMessage: string | undefined;
      try {
        // Import dinamis: hindari siklus modul (service → outbox → service).
        const { googleContactsService } = await import('./google-contacts.service');
        const res = await googleContactsService.syncCustomer(tenantId, item.customerId, {
          trigger: 'manual',
          fromOutbox: true,
        });
        success = res.success && res.action !== 'skipped';
        errorMessage = res.error;
      } catch (err: any) {
        errorMessage = err?.message || String(err);
      }

      if (success) {
        await this.remove(tenantId, item.customerId);
        result.succeeded++;
        continue;
      }

      const attempts = (item.attempts || 0) + 1;
      if (attempts >= MAX_OUTBOX_ATTEMPTS) {
        await this.remove(tenantId, item.customerId);
        result.dropped++;
        console.warn(JSON.stringify({
          event: 'GOOGLE_CONTACTS_OUTBOX_DROPPED',
          tenantId,
          customerId: item.customerId,
          attempts,
          lastError: errorMessage,
          timestamp: new Date(this.now()).toISOString(),
        }));
        continue;
      }

      const backoff = OUTBOX_BACKOFF_MS[Math.min(attempts - 1, OUTBOX_BACKOFF_MS.length - 1)];
      const next: GoogleContactsOutboxItem = {
        ...item,
        attempts,
        nextAttemptAt: this.now() + backoff,
        lastError: errorMessage,
      };
      try {
        await this.kv.set(itemKey(tenantId, item.customerId), JSON.stringify(next), OUTBOX_TTL_MS);
        await this.kv.sadd(indexKey(tenantId), item.customerId, OUTBOX_TTL_MS);
        await this.kv.sadd(TENANTS_KEY, tenantId, OUTBOX_TTL_MS);
      } catch {
        /* biarkan item lama; percobaan berikutnya mencoba lagi */
      }
      result.failed++;
    }

    return result;
  }

  /** Proses antrean semua tenant (dipanggil cron). */
  async drainAll(opts: { force?: boolean; limitPerTenant?: number } = {}): Promise<Record<string, GoogleContactsOutboxDrainResult>> {
    let tenants: string[] = [];
    try {
      tenants = await this.kv.smembers(TENANTS_KEY);
    } catch {
      return {};
    }

    const summary: Record<string, GoogleContactsOutboxDrainResult> = {};
    for (const tenant of tenants) {
      summary[tenant] = await this.drain(tenant, {
        force: opts.force,
        limit: opts.limitPerTenant,
      });
      // Tenant tanpa item lagi tidak perlu dipindai terus-menerus.
      if ((await this.pendingCount(tenant)) === 0) {
        try {
          await this.kv.srem(TENANTS_KEY, tenant);
        } catch {
          /* best-effort */
        }
      }
    }
    return summary;
  }

  /** Kosongkan antrean (test/maintenance). */
  async clear(tenantId?: string): Promise<void> {
    const tenants = tenantId ? [tenantId] : await this.kv.smembers(TENANTS_KEY).catch(() => []);
    for (const tenant of tenants) {
      const items = await this.list(tenant);
      for (const item of items) await this.remove(tenant, item.customerId);
      try {
        await this.kv.srem(TENANTS_KEY, tenant);
      } catch {
        /* best-effort */
      }
    }
  }
}

export const googleContactsOutbox = new GoogleContactsOutbox();
