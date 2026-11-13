import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Mencegah kehilangan ketikan pada form konfigurasi panjang.
 * Aktif hanya ketika memang ada perubahan (dirty === true), sehingga navigasi
 * normal tidak terganggu.
 */
export function useDirtyGuard(dirty: boolean, label = 'Perubahan belum disimpan') {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = label;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, label]);
}

/**
 * Membandingkan isi form dengan kondisi terakhir yang dimuat dari server.
 *
 * `ready` menandai data sudah selesai dimuat. Selama `ready` masih false,
 * baseline belum diambil, jadi form yang baru dibuka tidak dianggap kotor.
 * Setiap kali panel memuat ulang data (ready turun ke false), baseline diambil
 * kembali — itulah sebabnya pemanggilan setelah simpan tidak perlu reset manual.
 */
export function useSnapshotDirty(values: unknown[], ready = true) {
  const serialized = JSON.stringify(values);
  const baselineRef = useRef<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!ready) {
      baselineRef.current = null;
      return;
    }
    if (baselineRef.current === null) baselineRef.current = serialized;
  }, [ready, serialized, tick]);

  const dirty = ready && baselineRef.current !== null && serialized !== baselineRef.current;

  const resetBaseline = useCallback(() => {
    baselineRef.current = null;
    setTick((n) => n + 1);
  }, []);

  return { dirty, resetBaseline };
}
