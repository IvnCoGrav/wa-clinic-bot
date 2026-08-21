import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { WahaClient } from '../../src/integrations/waha/client';
import { reservationLifecycleService } from '../../src/services/reservation-lifecycle.service';
import { clearLabelCache } from '../../src/integrations/waha/label-cache';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

/**
 * Perbaikan label WAHA — Task 1 & 2.
 * Cover: TTL cache getChatLabels, invalidate setelah mutasi, batchUpdateLabels
 * atomik (1x GET session + 1x GET chat + 1x PUT), per-chat lock (race), dan
 * onReservationCreated paralel untuk customer berbeda (label tidak tertukar).
 */

function forceRealHttp() {
  vi.spyOn(WahaClient.prototype as any, 'shouldMock', 'get').mockReturnValue(false);
}

const SESSION_LABELS = [
  { id: 'l1', name: 'new customer' },
  { id: 'l2', name: 'legacy' },
  { id: 'l3', name: 'repeat' },
  { id: 'l4', name: 'pending payment' },
  { id: 'l5', name: 'hold' },
];

/**
 * Pasang mock axios stateful yang me-route berdasarkan URL:
 * GET /api/{session}/labels          → daftar label session
 * GET /api/{session}/labels/chats/{id} → label chat (dari store)
 * PUT /api/{session}/labels/chats/{id} → update store
 * Mengembalikan store label per-chat agar test bisa memeriksa state akhir.
 */
function installLabelApi(initialChatLabels: Record<string, any[]>): Record<string, any[]> {
  const store: Record<string, any[]> = { ...initialChatLabels };
  mockedAxios.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/default/labels')) {
      return { data: { value: SESSION_LABELS } };
    }
    const m = url.match(/labels\/chats\/(.+)$/);
    if (m) {
      return { data: { value: store[m[1]] || [] } };
    }
    throw new Error(`unexpected GET url: ${url}`);
  });
  mockedAxios.post.mockImplementation(async (url: string) => {
    throw new Error(`unexpected POST url: ${url}`);
  });
  mockedAxios.put.mockImplementation(async (url: string, body: any) => {
    const m = url.match(/labels\/chats\/(.+)$/);
    if (!m) throw new Error(`unexpected PUT url: ${url}`);
    store[m[1]] = body.labels.map((ref: any) => SESSION_LABELS.find((l) => l.id === ref.id)!);
    return { status: 200 };
  });
  return store;
}

function chatLabelsGetCalls(): string[][] {
  return mockedAxios.get.mock.calls.filter(([u]) => String(u).includes('/labels/chats/'));
}

function chatLabelsPutCalls(): [string, any][] {
  return mockedAxios.put.mock.calls.filter(([u]) => String(u).includes('/labels/chats/')) as [string, any][];
}

describe('WahaClient — label cache TTL & invalidate (Task 1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearLabelCache();
    delete process.env.WAHA_BASE_URL;
    delete process.env.WAHA_RETRY_ATTEMPTS;
    delete process.env.WAHA_RETRY_BACKOFF_MS;
  });

  it('getChatLabels dipanggil 2x berturut-turut (< TTL) untuk chat yang sama → hanya 1 axios call', async () => {
    forceRealHttp();
    installLabelApi({ '628123456789@c.us': [{ id: 'l1', name: 'new customer' }] });
    const client = new WahaClient();

    const a = await client.getChatLabels('628123456789@c.us');
    const b = await client.getChatLabels('628123456789@c.us');

    expect(a).toEqual(['new customer']);
    expect(b).toEqual(['new customer']);
    expect(chatLabelsGetCalls()).toHaveLength(1);
  });

  it('setelah addLabel sukses, getChatLabels berikutnya TIDAK mengembalikan cache lama (ter-invalidate)', async () => {
    forceRealHttp();
    installLabelApi({ '628123456789@c.us': [{ id: 'l1', name: 'new customer' }] });
    const client = new WahaClient();

    await client.getChatLabels('628123456789@c.us'); // isi cache
    const ok = await client.addLabel('628123456789@c.us', 'hold');
    expect(ok).toBe(true);

    const labels = await client.getChatLabels('628123456789@c.us');
    expect(labels).toContain('hold');
    // GET /labels/chats: 1x (populate cache) + 1x (di dalam addLabel) + 1x (fresh setelah invalidate)
    expect(chatLabelsGetCalls()).toHaveLength(3);
  });

  it('removeLabel sukses juga meng-invalidate cache (label lama tidak muncul lagi)', async () => {
    forceRealHttp();
    installLabelApi({
      '628123456789@c.us': [
        { id: 'l1', name: 'new customer' },
        { id: 'l5', name: 'hold' },
      ],
    });
    const client = new WahaClient();

    await client.getChatLabels('628123456789@c.us'); // isi cache: [new customer, hold]
    const ok = await client.removeLabel('628123456789@c.us', 'hold');
    expect(ok).toBe(true);

    const labels = await client.getChatLabels('628123456789@c.us');
    expect(labels).toEqual(['new customer']);
    expect(labels).not.toContain('hold');
  });

  it('resolusi LID juga di-cache: 2x getPhoneNumberFromLid → hanya 1 axios call /lids/', async () => {
    forceRealHttp();
    mockedAxios.get.mockResolvedValue({ data: { pn: '6285794210526@c.us' } });
    const client = new WahaClient();

    const p1 = await client.getPhoneNumberFromLid('79903991054369@lid');
    const p2 = await client.getPhoneNumberFromLid('79903991054369@lid');

    expect(p1).toBe('6285794210526');
    expect(p2).toBe('6285794210526');
    const lidCalls = mockedAxios.get.mock.calls.filter(([u]) => String(u).includes('/lids/') || String(u).includes('/contacts'));
    expect(lidCalls).toHaveLength(1);
  });
});

describe('WahaClient — batchUpdateLabels atomik & race (Task 2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearLabelCache();
    delete process.env.WAHA_BASE_URL;
    delete process.env.WAHA_RETRY_ATTEMPTS;
    delete process.env.WAHA_RETRY_BACKOFF_MS;
  });

  it('add [repeat], remove [new customer, pending payment] → PUT payload final [legacy, repeat] (legacy aman)', async () => {
    forceRealHttp();
    installLabelApi({
      '628123456789@c.us': [
        { id: 'l1', name: 'new customer' },
        { id: 'l2', name: 'legacy' },
      ],
    });
    const client = new WahaClient();

    const ok = await client.batchUpdateLabels('628123456789@c.us', {
      add: ['repeat'],
      remove: ['new customer', 'pending payment'],
    });

    expect(ok).toBe(true);
    const put = chatLabelsPutCalls()[0];
    expect(put[1]).toEqual({ labels: [{ id: 'l2' }, { id: 'l3' }] });
    // hanya 1x GET daftar label session + 1x GET label chat (bukan per-operasi)
    const sessionGets = mockedAxios.get.mock.calls.filter(([u]) => String(u).endsWith('/api/default/labels'));
    expect(sessionGets).toHaveLength(1);
    expect(chatLabelsGetCalls()).toHaveLength(1);
  });

  it('2 batchUpdateLabels nyaris bersamaan untuk chat SAMA dengan perubahan berbeda → hasil akhir union (per-chat lock)', async () => {
    forceRealHttp();
    installLabelApi({
      '628123456789@c.us': [
        { id: 'l1', name: 'new customer' },
        { id: 'l2', name: 'legacy' },
      ],
    });
    const originalPut = mockedAxios.put.getMockImplementation()!;
    let putCount = 0;
    // Delay PUT pertama supaya race window nyata (tanpa lock, call kedua
    // membaca state sebelum PUT pertama selesai → lost update)
    mockedAxios.put.mockImplementation(async (url: string, body: any) => {
      putCount++;
      if (putCount === 1) await new Promise((r) => setTimeout(r, 40));
      return originalPut(url, body);
    });

    const client = new WahaClient();
    await Promise.all([
      client.batchUpdateLabels('628123456789@c.us', { add: ['repeat'], remove: ['new customer'] }),
      client.batchUpdateLabels('628123456789@c.us', { add: ['hold'], remove: ['new customer'] }),
    ]);

    const puts = chatLabelsPutCalls();
    expect(puts).toHaveLength(2);
    const finalIds = puts[puts.length - 1][1].labels.map((x: any) => x.id);
    expect(finalIds).toEqual(['l2', 'l3', 'l5']); // legacy + repeat + hold (union kedua perubahan)
  });

  it('5x onReservationCreated paralel untuk 5 customer BERBEDA → label tidak salah tertukar antar customer', async () => {
    forceRealHttp();
    process.env.ENABLE_LIFECYCLE_LABELS = 'true';

    const chats: Record<string, any[]> = {};
    const phones: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const phone = `62811100000${i}`;
      chats[`${phone}@c.us`] = [{ id: 'l1', name: 'new customer' }];
      phones.push(phone);
    }
    installLabelApi(chats);

    await Promise.all(
      phones.map((phone, i) =>
        reservationLifecycleService.onReservationCreated({
          customerId: `cust-label-${i}`,
          reservationId: `res-label-${i}`,
          tenantId: DEFAULT_TENANT_ID,
          chatId: `${phone}@c.us`,
        })
      )
    );

    // batchUpdateLabels dijalankan fire-and-forget dari lifecycle service —
    // tunggu sampai semua PUT selesai sebelum memeriksa payload-nya.
    await vi.waitFor(() => {
      expect(chatLabelsPutCalls()).toHaveLength(5);
    }, { timeout: 5000, interval: 10 });

    const puts = chatLabelsPutCalls();
    expect(puts).toHaveLength(5);

    // DB offline → priorConfirmedCount = 0 → tiap chat hanya dapat 'pending payment'
    for (const phone of phones) {
      const putForChat = puts.find(([u]) => String(u).includes(`chats/${phone}@c.us`));
      expect(putForChat, `PUT untuk ${phone} harus ada`).toBeTruthy();
      const ids = putForChat![1].labels.map((x: any) => x.id);
      expect(ids).toEqual(['l4']); // pending payment saja — new customer hilang, tidak ada label milik chat lain
    }
  });
});
