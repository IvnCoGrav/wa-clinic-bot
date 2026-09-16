/**
 * interval-registry.ts — Registry `setInterval` yang bisa dihentikan saat shutdown.
 *
 * Masalah yang diselesaikan (PLAN 8 FASE 1): `app.ts` menjalankan 8 cron via
 * `setInterval` tanpa menyimpan handle, sehingga saat proses berhenti cron-nya
 * terus menembak DB setelah `prisma.$disconnect()` dan memicu error beruntun.
 *
 * Pemakaian: ganti `setInterval(fn, ms)` menjadi `trackInterval(fn, ms)`.
 */

export type IntervalHandle = ReturnType<typeof setInterval>;

const handles: IntervalHandle[] = [];

/** Mendaftarkan interval agar dapat dibersihkan saat shutdown. */
export function trackInterval(fn: () => void | Promise<void>, ms: number): IntervalHandle {
  const handle = setInterval(fn, ms);
  handles.push(handle);
  return handle;
}

/** Menghentikan seluruh interval terdaftar. Aman dipanggil berulang. */
export function clearAllIntervals(): void {
  for (const h of handles) {
    try {
      clearInterval(h);
    } catch {
      // noop — best effort saat shutdown
    }
  }
  handles.length = 0;
}

/** Jumlah interval aktif (untuk test/observability). */
export function activeIntervalCount(): number {
  return handles.length;
}
