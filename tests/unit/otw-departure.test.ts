import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OTW_SEND_DEADLINE_MS,
  buildOtwPayload,
  createOtwRequestId,
  describeOtwError,
  resolveFlushDecision,
  sendOtwWithDeadline,
} from '../../packages/admin-dashboard/src/pages/staff/otwDeparture';
import {
  OTW_PENDING_KEY,
  OTW_PENDING_TTL_MS,
  clearPendingOtw,
  enqueuePendingOtw,
  markPendingOtwAttempt,
  readPendingOtw,
  removePendingOtw,
  type PendingOtwItem,
} from '../../packages/admin-dashboard/src/pages/staff/otwPendingStore';

/**
 * Fase 2/3 plan 2026-11-24: perilaku keberangkatan OTW diuji sebagai perilaku
 * (bukan cocok-cocokan teks sumber). Skenario adversarial: sinyal mati, timeout,
 * retry duplikat, outbox kedaluwarsa, dan payload rusak di storage.
 */

const installSessionStorage = () => {
  const store = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  return store;
};

const baseItem = (over: Partial<PendingOtwItem> = {}): PendingOtwItem => ({
  requestId: 'otw_req_1',
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

describe('buildOtwPayload', () => {
  it('GPS + tujuan lengkap → ETA, jam tiba WIB, dan koordinat ikut terkirim', () => {
    const payload = buildOtwPayload({
      requestId: 'otw_x',
      draft: 'Halo Bunda',
      depart: { lat: -7.3, lng: 112.7, accuracy: 15 },
      dest: { lat: -7.28, lng: 112.74 },
      now: new Date('2026-11-24T02:00:00.000Z'), // 09:00 WIB
    });

    expect(payload.requestId).toBe('otw_x');
    expect(payload.body.requestId).toBe('otw_x');
    expect(payload.body.markEnRoute).toBe(true);
    expect(payload.body.customText).toBe('Halo Bunda');
    expect(payload.etaMinutes).toBeGreaterThan(0);
    expect(payload.body.etaMinutes).toBe(payload.etaMinutes);
    expect(payload.body.arrivalWib).toBe(payload.arrivalWib);
    expect(payload.arrivalWib).toMatch(/^\d{2}:\d{2}$/);
    expect(payload.body).toMatchObject({ lat: -7.3, lng: 112.7, accuracy: 15 });
  });

  it('tanpa GPS → tetap sah, tanpa eta/koordinat (fail-open, bukan gagal)', () => {
    const payload = buildOtwPayload({
      requestId: 'otw_y',
      draft: 'Halo Bunda',
      depart: null,
      dest: { lat: -7.28, lng: 112.74 },
    });

    expect(payload.etaMinutes).toBeNull();
    expect(payload.arrivalWib).toBeNull();
    expect(payload.body.etaMinutes).toBeUndefined();
    expect(payload.body.lat).toBeUndefined();
  });

  it('tujuan tanpa koordinat → ETA tidak dikarang', () => {
    const payload = buildOtwPayload({
      requestId: 'otw_z',
      draft: 'Halo',
      depart: { lat: -7.3, lng: 112.7 },
      dest: { lat: null, lng: null },
    });

    expect(payload.etaMinutes).toBeNull();
    expect(payload.body.arrivalWib).toBeUndefined();
  });
});

describe('sendOtwWithDeadline', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it('respons sukses → sent', async () => {
    const result = await sendOtwWithDeadline({
      post: async () => ({ success: true, data: { status: 'en_route' } }),
    });
    expect(result.status).toBe('sent');
    expect(result.data).toEqual({ status: 'en_route' });
  });

  it('respons sudah pernah terkirim → already-sent (bukan gagal)', async () => {
    const result = await sendOtwWithDeadline({
      post: async () => ({ success: true, data: { alreadySent: true, otwSentAt: '2026-11-24T01:00:00.000Z' } }),
    });
    expect(result.status).toBe('already-sent');
  });

  it('HTTP 400 dengan error objek → failed + pesan terbaca', async () => {
    const result = await sendOtwWithDeadline({
      post: async () => {
        throw new Error('Anda tidak memiliki hak akses untuk mengirim pesan OTW pada jadwal terapis lain.');
      },
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('hak akses');
  });

  it('respons success:false → failed membawa pesan server', async () => {
    const result = await sendOtwWithDeadline({
      post: async () => ({ success: false, error: { code: 'WAHA_DOWN', message: 'Gateway WhatsApp tidak tersedia.' } }),
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Gateway WhatsApp tidak tersedia.');
  });

  it('batas waktu habis → pending, dan respons yang datang terlambat tidak melempar', async () => {
    vi.useFakeTimers();
    let resolvePost: ((value: any) => void) | undefined;

    const pending = sendOtwWithDeadline({
      post: () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
      deadlineMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.status).toBe('pending');

    // Request keepalive tetap hidup: respons telat harus diabaikan dengan tenang.
    resolvePost?.({ success: true, data: { status: 'en_route' } });
    await vi.advanceTimersByTimeAsync(0);
    await expect(Promise.resolve()).resolves.toBeUndefined();
  });

  it('post() yang melempar sinkron → failed, tidak melempar ke pemanggil', async () => {
    const result = await sendOtwWithDeadline({
      post: () => {
        throw new Error('fetch belum siap');
      },
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('fetch belum siap');
  });

  it('default deadline = 10 detik (kontrak UX)', () => {
    expect(OTW_SEND_DEADLINE_MS).toBe(10_000);
  });

  it('describeOtwError menerima string, Error, dan objek tanpa message', () => {
    expect(describeOtwError('gagal total')).toBe('gagal total');
    expect(describeOtwError(new Error('putus'))).toBe('putus');
    expect(describeOtwError({ code: 'X' })).toBe('kesalahan tidak diketahui');
    expect(describeOtwError(null)).toBe('kesalahan tidak diketahui');
  });
});

describe('resolveFlushDecision (jendela server)', () => {
  const booking = new Date('2026-11-24T02:00:00.000Z'); // 09:00 WIB

  it('di dalam jendela (H-30 mnt) → flush', () => {
    const nowMs = booking.getTime() - 30 * 60 * 1000;
    expect(resolveFlushDecision({ bookingDate: booking, status: 'confirmed', nowMs })).toBe('flush');
  });

  it('lewat toleransi 15 menit → gagal permanen, bukan dikirim telat', () => {
    const nowMs = booking.getTime() + 16 * 60 * 1000;
    expect(resolveFlushDecision({ bookingDate: booking, status: 'confirmed', nowMs })).toBe('drop_expired');
  });

  it('terlalu dini (H-3 jam) → tunggu, jangan buang', () => {
    const nowMs = booking.getTime() - 180 * 60 * 1000;
    expect(resolveFlushDecision({ bookingDate: booking, status: 'confirmed', nowMs })).toBe('wait');
  });

  it.each(['completed', 'cancelled', 'rejected', 'arrived', 'COMPLETED'])(
    'status %s → outbox ditutup (tidak kirim "saya OTW" setelah tiba)',
    (status) => {
      expect(resolveFlushDecision({ bookingDate: booking, status, nowMs: booking.getTime() })).toBe('drop_closed');
    }
  );

  it('waktu booking tidak valid → drop_expired (fail-closed, tanpa pesan telat)', () => {
    expect(resolveFlushDecision({ bookingDate: null, status: 'confirmed' })).toBe('drop_expired');
    expect(resolveFlushDecision({ bookingDate: 'bukan-tanggal', status: 'confirmed' })).toBe('drop_expired');
  });
});

describe('createOtwRequestId', () => {
  it('berprefix otw_ dan unik antar percobaan', () => {
    const a = createOtwRequestId();
    const b = createOtwRequestId();
    expect(a.startsWith('otw_')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('otwPendingStore (anti-kehilangan pesan saat pending)', () => {
  beforeEach(() => {
    installSessionStorage();
  });

  it('enqueue lalu baca kembali', () => {
    enqueuePendingOtw(baseItem());
    const list = readPendingOtw();
    expect(list).toHaveLength(1);
    expect(list[0].requestId).toBe('otw_req_1');
  });

  it('enqueue requestId yang sama TIDAK menduplikasi (retry aman)', () => {
    enqueuePendingOtw(baseItem());
    enqueuePendingOtw(baseItem({ attempts: 2 }));
    const list = readPendingOtw();
    expect(list).toHaveLength(1);
    expect(list[0].attempts).toBe(2);
  });

  it('TTL habis → antrean dibersihkan', () => {
    const now = Date.now();
    enqueuePendingOtw(baseItem(), now);
    expect(readPendingOtw(now + OTW_PENDING_TTL_MS + 1)).toHaveLength(0);
    expect((globalThis as any).sessionStorage.getItem(OTW_PENDING_KEY)).toBeNull();
  });

  it('JSON rusak → antrean kosong, tidak melempar', () => {
    (globalThis as any).sessionStorage.setItem(OTW_PENDING_KEY, '{rusak');
    expect(readPendingOtw()).toEqual([]);
  });

  it('item tidak valid disaring', () => {
    (globalThis as any).sessionStorage.setItem(
      OTW_PENDING_KEY,
      JSON.stringify({ savedAt: Date.now(), items: [{ foo: 1 }, baseItem()] })
    );
    expect(readPendingOtw()).toHaveLength(1);
  });

  it('maksimal 20 item (anti-bloat storage)', () => {
    for (let i = 0; i < 25; i += 1) {
      enqueuePendingOtw(baseItem({ requestId: `otw_${i}`, reservationId: `res-${i}` }));
    }
    expect(readPendingOtw()).toHaveLength(20);
  });

  it('markPendingOtwAttempt menaikkan attempts + lastError', () => {
    enqueuePendingOtw(baseItem());
    markPendingOtwAttempt('otw_req_1', { lastError: 'Timeout' });
    const [item] = readPendingOtw();
    expect(item.attempts).toBe(2);
    expect(item.lastError).toBe('Timeout');
  });

  it('removePendingOtw & clearPendingOtw membersihkan', () => {
    enqueuePendingOtw(baseItem());
    removePendingOtw('otw_req_1');
    expect(readPendingOtw()).toHaveLength(0);

    enqueuePendingOtw(baseItem());
    clearPendingOtw();
    expect(readPendingOtw()).toHaveLength(0);
  });
});
