import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OTW_SEND_DEADLINE_MS,
  buildOtwPayload,
  createOtwRequestId,
  sendOtwWithDeadline,
} from '../../packages/admin-dashboard/src/pages/staff/otwDeparture';
import {
  enqueuePendingOtw,
  markPendingOtwAttempt,
  readPendingOtw,
  removePendingOtw,
  type PendingOtwItem,
} from '../../packages/admin-dashboard/src/pages/staff/otwPendingStore';
import { flushPendingOtwQueue } from '../../packages/admin-dashboard/src/pages/staff/otwFlush';

/**
 * REPLAY insiden 2026-11-24 (Bidan Thabita, reservasi 8878ffbf…):
 * tap OTW 08:55:49 → Google Maps terbuka → Chrome dibekukan OS → WhatsApp tidak
 * pernah terkirim (`otw_sent_at` NULL).
 *
 * Test ini memutar ulang garis waktu tersebut memakai modul produksi
 * (`otwDeparture` + `otwPendingStore` + `otwFlush`) dengan jam palsu, bukan mock
 * perilaku. Tiga hal yang dijaga:
 * 1. Peta tidak boleh dibuka sebelum hasil pengiriman diketahui (≤10 dtk).
 * 2. Saat OS membekukan app, pesan TIDAK hilang — masuk antrean pending.
 * 3. Saat app kembali: server otoritatif (tidak kirim ganda) atau kirim ulang
 *    dengan `requestId` yang sama (server bisa mendeteksi duplikat).
 */

// 08:55:49 WIB = 01:55:49 UTC, jadwal 09:00 WIB.
const TAP_MS = Date.parse('2026-11-24T01:55:49.000Z');
const BOOKING_ISO = '2026-11-24T02:00:00.000Z';

const installSessionStorage = () => {
  const store = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  };
  return store;
};

const pendingItem = (over: Partial<PendingOtwItem> = {}): PendingOtwItem => ({
  requestId: 'otw_8878ffbf',
  reservationId: '8878ffbf-5dab-4803-a98d-657dc193893a',
  customerName: 'Bunda Elvira',
  conversationId: 'conv-elvira',
  draft: 'Halo Bunda Elvira, saya sudah dalam perjalanan',
  depart: { lat: -7.28, lng: 112.74, accuracy: 18 },
  dest: { lat: -7.31, lng: 112.78 },
  createdAt: new Date(TAP_MS).toISOString(),
  attempts: 1,
  lastError: null,
  ...over,
});

describe('Replay insiden OTW 2026-11-24 (Bidan Thabita)', () => {
  beforeEach(() => {
    installSessionStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TAP_MS));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('peta tertahan sampai hasil kirim diketahui; app dibekukan → pesan masuk pending; resume → rekonsiliasi tanpa WA ganda', async () => {
    let resolvePost: ((value: any) => void) | undefined;
    const post = vi.fn(
      () =>
        new Promise((resolve) => {
          // Meniru request yang tidak pernah selesai karena Chrome di-suspend OS.
          resolvePost = resolve;
        })
    );

    let navigatedAtMs: number | null = null;
    const openMaps = () => {
      navigatedAtMs = Date.now();
    };

    const sending = sendOtwWithDeadline({ post, deadlineMs: OTW_SEND_DEADLINE_MS });
    let outcome: string | null = null;
    void sending.then((r) => {
      outcome = r.status;
      // Komponen hanya membuka peta setelah outcome diketahui.
      openMaps();
    });

    // t = 9 dtk: Bidan masih menunggu, peta BELUM terbuka (inti perbaikan).
    await vi.advanceTimersByTimeAsync(9_000);
    expect(outcome).toBeNull();
    expect(navigatedAtMs).toBeNull();

    // t = 10 dtk: batas tunggu habis → pending, peta baru boleh terbuka.
    await vi.advanceTimersByTimeAsync(1_000);
    await sending;
    expect(outcome).toBe('pending');
    expect(navigatedAtMs).not.toBeNull();
    expect(navigatedAtMs! - TAP_MS).toBe(OTW_SEND_DEADLINE_MS);

    // Komponen menyimpan pesan ke antrean dengan kunci idempoten.
    enqueuePendingOtw(pendingItem());
    expect(readPendingOtw()).toHaveLength(1);

    // t = +20 menit: Bidan kembali ke portal. Ternyata request keepalive SUDAH
    // berhasil di server (WA terkirim, otw_sent_at terisi).
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);

    const report = await flushPendingOtwQueue({
      list: readPendingOtw(),
      getTask: () => ({ bookingDate: BOOKING_ISO, status: 'en_route', otwSentAt: '2026-11-24T01:56:10.000Z' }),
      send: vi.fn(),
      remove: removePendingOtw,
      mark: markPendingOtwAttempt,
    });

    expect(report.reconciled).toBe(1);
    expect(report.sent).toBe(0);
    expect(report.failed).toBe(0);
    expect(readPendingOtw()).toHaveLength(0);

    // Respons telat yang akhirnya mendarat tidak boleh melempar / mengubah apa pun.
    resolvePost?.({ success: true, data: { status: 'en_route' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(readPendingOtw()).toHaveLength(0);
  });

  it('bila request benar-benar mati: kirim ulang saat resume dengan requestId SAMA, lalu tidak diulang lagi', async () => {
    enqueuePendingOtw(pendingItem({ requestId: 'otw_fixed_key' }));
    const send = vi.fn(async () => ({ status: 'sent' as const }));

    const first = await flushPendingOtwQueue({
      list: readPendingOtw(),
      getTask: () => ({ bookingDate: BOOKING_ISO, status: 'confirmed', otwSentAt: null }),
      send,
      remove: removePendingOtw,
      mark: markPendingOtwAttempt,
    });

    expect(first.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    // Kunci WAJIB sama dengan percobaan pertama agar server bisa menjawab alreadySent.
    expect((send.mock.calls[0] as any[])[0].requestId).toBe('otw_fixed_key');
    expect(readPendingOtw()).toHaveLength(0);

    // Resume berikutnya: antrean kosong → tidak ada kiriman tambahan.
    await flushPendingOtwQueue({
      list: readPendingOtw(),
      getTask: () => ({ bookingDate: BOOKING_ISO, status: 'en_route', otwSentAt: '2026-11-24T01:56:10.000Z' }),
      send,
      remove: removePendingOtw,
      mark: markPendingOtwAttempt,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sinyal putus-nyambung: gagal di resume pertama (item bertahan), sukses di resume kedua', async () => {
    enqueuePendingOtw(pendingItem({ requestId: 'otw_flaky' }));
    const send = vi
      .fn()
      .mockResolvedValueOnce({ status: 'failed', error: 'Failed to fetch' })
      .mockResolvedValueOnce({ status: 'already-sent' });

    const offline = await flushPendingOtwQueue({
      list: readPendingOtw(),
      getTask: () => ({ bookingDate: BOOKING_ISO, status: 'confirmed', otwSentAt: null }),
      send,
      remove: removePendingOtw,
      mark: markPendingOtwAttempt,
    });

    expect(offline.failed).toBe(1);
    const kept = readPendingOtw();
    expect(kept).toHaveLength(1);
    expect(kept[0].attempts).toBe(2);
    expect(kept[0].lastError).toBe('Failed to fetch');

    const online = await flushPendingOtwQueue({
      list: readPendingOtw(),
      getTask: () => ({ bookingDate: BOOKING_ISO, status: 'confirmed', otwSentAt: null }),
      send,
      remove: removePendingOtw,
      mark: markPendingOtwAttempt,
    });

    expect(online.alreadySent).toBe(1);
    expect(readPendingOtw()).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('jadwal sudah lewat 16 menit saat Bidan kembali → pesan TIDAK dikirim telat', async () => {
    enqueuePendingOtw(pendingItem());
    const send = vi.fn(async () => ({ status: 'sent' as const }));

    const lateMs = Date.parse(BOOKING_ISO) + 16 * 60 * 1000;
    const report = await flushPendingOtwQueue({
      list: readPendingOtw(),
      getTask: () => ({ bookingDate: BOOKING_ISO, status: 'confirmed', otwSentAt: null }),
      send,
      remove: removePendingOtw,
      mark: markPendingOtwAttempt,
      nowMs: lateMs,
    });

    expect(report.dropped).toBe(1);
    expect(report.outcomes[0].outcome).toBe('dropped-expired');
    expect(send).not.toHaveBeenCalled();
    expect(readPendingOtw()).toHaveLength(0);
  });

  it('payload yang dikirim ulang memuat requestId & markEnRoute yang sama (kontrak server)', () => {
    const payload = buildOtwPayload({
      requestId: 'otw_fixed_key',
      draft: 'Halo Bunda Elvira',
      depart: { lat: -7.28, lng: 112.74, accuracy: 18 },
      dest: { lat: -7.31, lng: 112.78 },
      now: new Date(TAP_MS),
    });

    expect(payload.body.requestId).toBe('otw_fixed_key');
    expect(payload.body.markEnRoute).toBe(true);
    expect(payload.etaMinutes).toBeGreaterThan(0);
  });

  it('requestId yang dibuat otomatis selalu berprefix otw_ (mudah dilacak di log server)', () => {
    expect(createOtwRequestId().startsWith('otw_')).toBe(true);
  });
});
