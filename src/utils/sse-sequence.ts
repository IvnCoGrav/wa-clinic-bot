/**
 * sse-sequence.ts
 *
 * Penomoran event Server-Sent Events (SSE) monotonik proses-wide.
 *
 * Fase 0.4 (Resilience sinyal 1-bar): sebelumnya id event dibuat acak
 * (`Date.now()-random`), sehingga klien TIDAK bisa mendeteksi bahwa ia
 * melewatkan event saat tab tidur lalu bangun. Dengan penomoran naik
 * monotonik, klien bisa mengetahui ada gap (`id > lastId + 1`) dan
 * merekonsiliasi lewat fetch data (bukan mengandalkan replay server).
 *
 * Murni & tanpa dependensi → mudah diuji deterministik.
 */
export interface MonotonicSseSequencer {
  /** Ambil id berikutnya (selalu > semua id sebelumnya). */
  next(): string;
  /** Nilai terakhir yang dikeluarkan (null bila belum ada). */
  peek(): string | null;
}

export function createMonotonicSseSequencer(seed: number = Date.now()): MonotonicSseSequencer {
  let current = Number.isFinite(seed) ? seed : Date.now();
  return {
    next(): string {
      current += 1;
      return String(current);
    },
    peek(): string | null {
      return current == null ? null : String(current);
    },
  };
}
