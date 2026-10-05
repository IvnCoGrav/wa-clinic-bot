import { describe, it, expect } from 'vitest';
import { queueService } from '../../src/services/queue.service';

/**
 * Phase 4 (audit 6285743192813) — In-flight inbound coalescing.
 *
 * Akar: pesan baru masuk saat balasan lama masih dalam typing delay → dua
 * balasan bertabrakan. Fix: penanda turn TERBARU per phone; turn in-flight yang
 * sudah disalip ditandai `superseded` dan draf usangnya dibatalkan sebelum
 * bubble terkirim (gerbang state, bukan heuristik durasi).
 */
describe('QueueService in-flight turn supersession', () => {
  it('turn yang belum disalip TIDAK superseded', () => {
    queueService.markLatestTurn('628111', 't1');
    expect(queueService.isTurnSuperseded('628111', 't1')).toBe(false);
  });

  it('turn lama superseded setelah pesan baru masuk; turn terbaru tidak', () => {
    queueService.markLatestTurn('628222', 't1');
    queueService.markLatestTurn('628222', 't2');
    expect(queueService.isTurnSuperseded('628222', 't1')).toBe(true);
    expect(queueService.isTurnSuperseded('628222', 't2')).toBe(false);
  });

  it('terisolasi per-phone', () => {
    queueService.markLatestTurn('628333', 'tA');
    queueService.markLatestTurn('628444', 'tB');
    expect(queueService.isTurnSuperseded('628333', 'tA')).toBe(false);
  });

  it('tanpa turnId → tidak pernah abort (fail-open)', () => {
    expect(queueService.isTurnSuperseded('628555', undefined)).toBe(false);
    expect(queueService.isTurnSuperseded('', 't1')).toBe(false);
  });
});
