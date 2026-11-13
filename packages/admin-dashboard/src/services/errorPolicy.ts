import { toast } from '../lib/toastBridge';

/**
 * Kontrak error dashboard (T-1.4).
 *
 * Sebelum ini, kegagalan ditangkap dengan `catch {}` di ~150 tempat: ada yang
 * memang boleh diabaikan, ada yang seharusnya memberi tahu staf. Tiga pembungkus
 * ini membuat pilihan itu eksplisit, sehingga tidak ada lagi kegagalan yang
 * hilang tanpa keputusan.
 */

/** Kegagalan opsional: tidak mengganggu pengguna, cukup jejak di konsol. */
export function fireAndForget(p: Promise<unknown>, label: string): void {
  void p.catch((e) => console.debug(`[opsional] ${label}`, e));
}

/** Kegagalan opsional dengan satu percobaan ulang senyap. */
export function retrySilently<T>(fn: () => Promise<T>, label: string, retries = 1): Promise<T | null> {
  const attempt = (n: number): Promise<T | null> =>
    fn().catch((e) => {
      if (n > 0) return attempt(n - 1);
      console.debug(`[dilewati] ${label}`, e);
      return null;
    });
  return attempt(retries);
}

/** Kegagalan wajib terlihat: pengguna harus tahu dan bisa mencoba lagi. */
export async function mustSucceed<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    toast(`${label} gagal: ${e?.message || 'coba lagi'}`, 'error');
    throw e;
  }
}
