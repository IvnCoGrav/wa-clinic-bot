/**
 * interval-registry.ts — Registry `setInterval` dan `setTimeout` yang bisa dihentikan saat shutdown.
 *
 * Masalah yang diselesaikan:
 * - `app.ts` menjalankan cron via `setInterval` tanpa menyimpan handle.
 * - `burst-coalesce.service.ts` membuat timer timeout tanpa registrasi lifecycle (SM-10).
 *
 * Pemakaian:
 * - ganti `setInterval(fn, ms)` menjadi `trackInterval(fn, ms)`.
 * - ganti `setTimeout(fn, ms)` menjadi `trackTimeout(fn, ms)`.
 */

export type IntervalHandle = ReturnType<typeof setInterval>;
export type TimeoutHandle = ReturnType<typeof setTimeout>;

const intervalHandles: IntervalHandle[] = [];
const timeoutHandles = new Set<TimeoutHandle>();

/** Mendaftarkan interval agar dapat dibersihkan saat shutdown. */
export function trackInterval(fn: () => void | Promise<void>, ms: number): IntervalHandle {
  const handle = setInterval(fn, ms);
  intervalHandles.push(handle);
  return handle;
}

/** Menghentikan seluruh interval terdaftar. Aman dipanggil berulang. */
export function clearAllIntervals(): void {
  for (const h of intervalHandles) {
    try {
      clearInterval(h);
    } catch {
      // noop — best effort saat shutdown
    }
  }
  intervalHandles.length = 0;
  clearAllTimeouts();
}

/** Jumlah interval aktif (untuk test/observability). */
export function activeIntervalCount(): number {
  return intervalHandles.length;
}

/** Mendaftarkan timeout agar dapat dibersihkan saat shutdown atau saat di-clear manual. */
export function trackTimeout(fn: () => void | Promise<void>, ms: number): TimeoutHandle {
  let handle: TimeoutHandle;
  handle = setTimeout(async () => {
    timeoutHandles.delete(handle);
    try {
      await fn();
    } catch (err: any) {
      console.error('[INTERVAL REGISTRY] Error in tracked timeout:', err?.message || err);
    }
  }, ms);
  timeoutHandles.add(handle);
  return handle;
}

/** Menghentikan timeout terdaftar secara aman. */
export function clearTimeoutTracked(handle?: TimeoutHandle | null): void {
  if (!handle) return;
  try {
    clearTimeout(handle);
  } catch {}
  timeoutHandles.delete(handle);
}

/** Menghentikan interval terdaftar secara spesifik dan menghapusnya dari registry. */
export function clearIntervalTracked(handle?: IntervalHandle | null): void {
  if (!handle) return;
  try {
    clearInterval(handle);
  } catch {}
  const idx = intervalHandles.indexOf(handle);
  if (idx !== -1) {
    intervalHandles.splice(idx, 1);
  }
}

/** Menghentikan seluruh timeout terdaftar. */
export function clearAllTimeouts(): void {
  for (const h of timeoutHandles) {
    try {
      clearTimeout(h);
    } catch {}
  }
  timeoutHandles.clear();
}

/** Jumlah timeout aktif. */
export function activeTimeoutCount(): number {
  return timeoutHandles.size;
}
