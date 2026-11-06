import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Regresi AUDIT LIVE CHAT FASE 0 (#316).
 *
 * Akar masalah K-05: route balasan mengirim `error` sebagai OBJEK
 * ({ code, message }), sementara klien melakukan `new Error(errorData.error)`
 * → pesan menjadi "[object Object]" dan admin tidak tahu penyebab kegagalan
 * (WABA 24 jam, cut-off darurat, sandbox, dll).
 */

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

describe('extractApiErrorPayload — kontrak error Live Chat', () => {
  beforeEach(() => {
    (globalThis as any).sessionStorage = new MemoryStorage();
    (globalThis as any).localStorage = new MemoryStorage();
  });

  it('mengekstrak pesan & kode dari error berbentuk objek (bukan [object Object])', async () => {
    const { extractApiErrorPayload } = await import('../../packages/admin-dashboard/src/services/api');
    const parsed = extractApiErrorPayload({
      success: false,
      error: { code: 'WABA_OUTSIDE_WINDOW', message: 'Balasan admin melewati 24h window WABA.' },
      data: { success: false },
    });
    expect(parsed.message).toBe('Balasan admin melewati 24h window WABA.');
    expect(parsed.code).toBe('WABA_OUTSIDE_WINDOW');
    expect(parsed.message).not.toContain('[object Object]');
  });

  it('tetap kompatibel dengan error berbentuk string', async () => {
    const { extractApiErrorPayload } = await import('../../packages/admin-dashboard/src/services/api');
    const parsed = extractApiErrorPayload({ success: false, error: 'Gagal mengirim pesan ke WhatsApp.' });
    expect(parsed.message).toBe('Gagal mengirim pesan ke WhatsApp.');
    expect(parsed.code).toBe('Gagal mengirim pesan ke WhatsApp.');
  });

  it('mengutamakan message di root bila ada (kontrak lama)', async () => {
    const { extractApiErrorPayload } = await import('../../packages/admin-dashboard/src/services/api');
    const parsed = extractApiErrorPayload({ message: 'Percakapan tidak ditemukan.', error: { code: 'NOT_FOUND' } });
    expect(parsed.message).toBe('Percakapan tidak ditemukan.');
    expect(parsed.code).toBe('NOT_FOUND');
  });

  it('tidak melempar untuk payload kosong/aneh (fail-safe)', async () => {
    const { extractApiErrorPayload } = await import('../../packages/admin-dashboard/src/services/api');
    expect(extractApiErrorPayload(null)).toEqual({ message: undefined, code: undefined });
    expect(extractApiErrorPayload({})).toEqual({ message: undefined, code: undefined });
    expect(extractApiErrorPayload({ error: 123 })).toEqual({ message: undefined, code: undefined });
  });
});
