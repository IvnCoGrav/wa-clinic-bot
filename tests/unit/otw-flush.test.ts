import { describe, it, expect, vi } from 'vitest';
import { flushPendingOtwQueue, type OtwFlushTaskSnapshot } from '../../packages/admin-dashboard/src/pages/staff/otwFlush';
import type { PendingOtwItem } from '../../packages/admin-dashboard/src/pages/staff/otwPendingStore';
import type { SendOtwResult } from '../../packages/admin-dashboard/src/pages/staff/otwDeparture';

/**
 * Fase 4 plan 2026-11-24: rekonsiliasi OTW pending saat aplikasi aktif kembali.
 * Diuji sebagai perilaku: tidak ada jaringan, tidak ada storage, tidak ada React.
 */

const booking = new Date('2026-11-24T02:00:00.000Z'); // 09:00 WIB
const nowMs = booking.getTime() - 30 * 60 * 1000; // H-30 menit

const item = (over: Partial<PendingOtwItem> = {}): PendingOtwItem => ({
  requestId: 'otw_1',
  reservationId: 'res-1',
  customerName: 'Bunda Rina',
  conversationId: 'conv-1',
  draft: 'Halo Bunda Rina, saya OTW',
  depart: { lat: -7.3, lng: 112.7, accuracy: 20 },
  dest: { lat: -7.28, lng: 112.74 },
  createdAt: new Date().toISOString(),
  attempts: 1,
  lastError: null,
  ...over,
});

const task = (over: Partial<OtwFlushTaskSnapshot> = {}): OtwFlushTaskSnapshot => ({
  bookingDate: booking.toISOString(),
  status: 'confirmed',
  otwSentAt: null,
  ...over,
});

const makeDeps = (opts: {
  list: PendingOtwItem[];
  tasks?: Record<string, OtwFlushTaskSnapshot | undefined>;
  results?: SendOtwResult[];
}) => {
  const removed: string[] = [];
  const marks: Array<{ requestId: string; patch: any }> = [];
  const sentIds: string[] = [];
  const results = [...(opts.results ?? [])];

  const deps = {
    list: opts.list,
    getTask: vi.fn((id: string) => (opts.tasks ? opts.tasks[id] : task())),
    send: vi.fn(async (it: PendingOtwItem) => {
      sentIds.push(it.requestId);
      return results.shift() ?? ({ status: 'sent' } as SendOtwResult);
    }),
    remove: vi.fn((id: string) => void removed.push(id)),
    mark: vi.fn((id: string, patch: any) => void marks.push({ requestId: id, patch })),
    nowMs,
  };

  return { deps, removed, marks, sentIds };
};

describe('flushPendingOtwQueue', () => {
  it('server sudah mencatat otwSentAt → reconciled tanpa mengirim WA lagi', async () => {
    const { deps, removed, sentIds } = makeDeps({
      list: [item()],
      tasks: { 'res-1': task({ otwSentAt: '2026-11-24T01:00:00.000Z', status: 'en_route' }) },
    });

    const report = await flushPendingOtwQueue(deps);

    expect(report.reconciled).toBe(1);
    expect(sentIds).toEqual([]);
    expect(removed).toEqual(['otw_1']);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('task belum termuat → deferred, item TIDAK dibuang', async () => {
    const { deps, removed } = makeDeps({ list: [item()], tasks: {} });

    const report = await flushPendingOtwQueue(deps);

    expect(report.deferred).toBe(1);
    expect(removed).toEqual([]);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('status sudah tiba/selesai → dropped-closed (tidak kirim "saya OTW" telat)', async () => {
    const { deps, removed } = makeDeps({
      list: [item(), item({ requestId: 'otw_2', reservationId: 'res-2' })],
      tasks: {
        'res-1': task({ status: 'arrived' }),
        'res-2': task({ status: 'completed' }),
      },
    });

    const report = await flushPendingOtwQueue(deps);

    expect(report.dropped).toBe(2);
    expect(removed).toEqual(['otw_1', 'otw_2']);
    expect(report.outcomes.map((o) => o.outcome)).toEqual(['dropped-closed', 'dropped-closed']);
  });

  it('lewat toleransi 15 menit → dropped-expired', async () => {
    const { deps, removed } = makeDeps({
      list: [item()],
      tasks: { 'res-1': task({ bookingDate: new Date(nowMs - 16 * 60 * 1000).toISOString() }) },
    });

    const report = await flushPendingOtwQueue(deps);

    expect(report.dropped).toBe(1);
    expect(report.outcomes[0].outcome).toBe('dropped-expired');
    expect(removed).toEqual(['otw_1']);
  });

  it('masih terlalu dini → deferred (jangan kirim pesan OTW pagi-pagi)', async () => {
    const { deps } = makeDeps({
      list: [item()],
      tasks: { 'res-1': task({ bookingDate: new Date(nowMs + 180 * 60 * 1000).toISOString() }) },
    });

    const report = await flushPendingOtwQueue(deps);

    expect(report.deferred).toBe(1);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('kirim ulang sukses → item dihapus dari antrean', async () => {
    const { deps, removed, sentIds } = makeDeps({
      list: [item()],
      results: [{ status: 'sent' }],
    });

    const report = await flushPendingOtwQueue(deps);

    expect(report.sent).toBe(1);
    expect(sentIds).toEqual(['otw_1']);
    expect(removed).toEqual(['otw_1']);
    expect(deps.mark).not.toHaveBeenCalled();
  });

  it('server menjawab duplikat → already-sent, item dihapus (bukan error)', async () => {
    const { deps, removed } = makeDeps({ list: [item()], results: [{ status: 'already-sent' }] });

    const report = await flushPendingOtwQueue(deps);

    expect(report.alreadySent).toBe(1);
    expect(removed).toEqual(['otw_1']);
  });

  it('gagal kirim → item DIPERTAHANKAN + error dicatat untuk percobaan berikutnya', async () => {
    const { deps, removed, marks } = makeDeps({
      list: [item()],
      results: [{ status: 'failed', error: 'Gateway WhatsApp tidak tersedia.' }],
    });

    const report = await flushPendingOtwQueue(deps);

    expect(report.failed).toBe(1);
    expect(removed).toEqual([]);
    expect(marks).toEqual([
      { requestId: 'otw_1', patch: { lastError: 'Gateway WhatsApp tidak tersedia.' } },
    ]);
  });

  it('timeout saat kirim ulang → tetap pending, tidak dianggap gagal permanen', async () => {
    const { deps, removed, marks } = makeDeps({ list: [item()], results: [{ status: 'pending' }] });

    const report = await flushPendingOtwQueue(deps);

    expect(report.deferred).toBe(1);
    expect(report.failed).toBe(0);
    expect(removed).toEqual([]);
    expect(marks[0].patch.lastError).toContain('Belum terkonfirmasi');
  });

  it('send() yang melempar → dicatat gagal, antrean tidak hilang', async () => {
    const { deps, removed } = makeDeps({ list: [item()] });
    deps.send = vi.fn(async () => {
      throw new Error('offline total');
    }) as any;

    const report = await flushPendingOtwQueue(deps);

    expect(report.failed).toBe(1);
    expect(removed).toEqual([]);
    expect(deps.mark).toHaveBeenCalledWith('otw_1', { lastError: 'offline total' });
  });

  it('mengirim berurutan, bukan paralel (hindari serbuan gateway)', async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      list: [item(), item({ requestId: 'otw_2', reservationId: 'res-2' })],
      tasks: { 'res-1': task(), 'res-2': task() },
    });
    deps.send = vi.fn(async (it: PendingOtwItem) => {
      order.push(`start:${it.requestId}`);
      await Promise.resolve();
      order.push(`end:${it.requestId}`);
      return { status: 'sent' } as SendOtwResult;
    }) as any;

    await flushPendingOtwQueue(deps);

    expect(order).toEqual(['start:otw_1', 'end:otw_1', 'start:otw_2', 'end:otw_2']);
  });

  it('antrean kosong → laporan kosong tanpa memanggil apa pun', async () => {
    const { deps } = makeDeps({ list: [] });

    const report = await flushPendingOtwQueue(deps);

    expect(report.outcomes).toEqual([]);
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.getTask).not.toHaveBeenCalled();
  });
});
