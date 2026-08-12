/**
 * Timer pengukuran durasi yang aman untuk eksekusi PARALEL.
 *
 * console.time()/timeEnd() dengan label statis bertabrakan saat beberapa proses
 * asinkron berjalan bersamaan — memicu warning "Label already exists" dan
 * "No such label for console.timeEnd()" (terlihat di log produksi).
 * measure() memakai performance.now() + counter monoton per label, sehingga
 * setiap invokasi punya label unik tanpa memakai label global console.
 */

const counters = new Map<string, number>();

function nextSeq(label: string): number {
  const seq = (counters.get(label) || 0) + 1;
  counters.set(label, seq);
  return seq;
}

/**
 * Ukur durasi fn() dan log `label#seq xxxx.xxxms` (format mirip console.time).
 * Timer SELALU ditutup (blok finally), termasuk saat fn() throw / early-return.
 */
import { isSimpleLogMode } from './stage-logger';

export async function measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const seq = nextSeq(label);
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = performance.now() - start;
    if (!isSimpleLogMode()) {
      console.log(`${label}#${seq} ${ms.toFixed(3)}ms`);
    }
  }
}
