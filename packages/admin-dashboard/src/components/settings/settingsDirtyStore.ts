import { useEffect, useId, useSyncExternalStore } from 'react';

/**
 * Pendaftar perubahan belum disimpan untuk panel-panel di halaman Settings.
 *
 * Kenapa store eksternal, bukan Context: panel Settings di-render bersyarat per
 * kategori, jadi saat admin pindah kategori panel langsung di-unmount dan
 * draft-nya hilang. Store ini memungkinkan halaman induk mengetahui bahwa ada
 * draft kotor sebelum panel tersebut dibuang dari layar.
 */

const dirtyIds = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Untuk pengujian: memantau berapa kali perubahan status diumumkan. */
export const subscribeSettingsDirty = subscribe;

/** Snapshot harus primitif agar useSyncExternalStore stabil. */
function getSnapshot() {
  return isAnySettingsDirty() ? 1 : 0;
}

/** Dipakai juga oleh pengujian unit (tanpa React). */
export function isAnySettingsDirty(): boolean {
  return dirtyIds.size > 0;
}

/** Untuk pengujian: bersihkan seluruh penanda antar skenario. */
export function resetSettingsDirtyForTest(): void {
  dirtyIds.clear();
  emit();
}

export function reportSettingsDirty(id: string, dirty: boolean) {
  const wasDirty = dirtyIds.has(id);
  if (dirty === wasDirty) return;
  if (dirty) dirtyIds.add(id);
  else dirtyIds.delete(id);
  emit();
}

/** Dipakai halaman induk (Settings) untuk tahu ada draft yang belum disimpan. */
export function useAnySettingsDirty(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot) === 1;
}

/**
 * Dipanggil di dalam panel: `useReportDirty(dirty)`.
 * Otomatis melepas tanda saat panel di-unmount supaya tidak ada sisa status.
 */
export function useReportDirty(dirty: boolean) {
  const id = useId();
  useEffect(() => {
    reportSettingsDirty(id, dirty);
    return () => reportSettingsDirty(id, false);
  }, [id, dirty]);
}
