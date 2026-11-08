import { describe, it, expect } from 'vitest';
import {
  copilotSessionKey,
  createCopilotSession,
  readCopilotSession,
  writeCopilotSession,
  pruneMessages,
  markInterrupted,
  sliceHistoryForContext,
  COPILOT_SESSION_TTL_MS,
  COPILOT_MAX_MESSAGES,
  COPILOT_MAX_CHARS_PER_MESSAGE,
  type KVAdapter,
  type CopilotSessionV1,
} from '../../packages/admin-dashboard/src/utils/copilotSessionStore';

class MemoryKV implements KVAdapter {
  store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

describe('copilotSessionStore (murni, offline)', () => {
  const testKey = copilotSessionKey('tenant-a', 'admin@clinic.id');

  it('menghasilkan key terisolasi per tenant & admin email (lowercased, trimmed)', () => {
    expect(testKey).toBe('copilot:session:tenant-a:admin@clinic.id');
    expect(copilotSessionKey('  TENANT-B ', ' Admin2@Clinic.ID ')).toBe('copilot:session:tenant-b:admin2@clinic.id');
    expect(copilotSessionKey('', '')).toBe('copilot:session:default-tenant:anon');
  });

  it('TTL: 47j59m masih valid; 48j01m menjadi null dan data terhapus dari storage', () => {
    const kv = new MemoryKV();
    const now = 1_700_000_000_000;
    const session = createCopilotSession('cust-1', now);
    session.messages.push({ role: 'user', content: 'Halo' });

    writeCopilotSession(kv, testKey, session, now);
    expect(kv.getItem(testKey)).not.toBeNull();

    // 47 jam 59 menit setelahnya -> masih valid
    const withinTtl = now + (47 * 60 + 59) * 60 * 1000;
    const readValid = readCopilotSession(kv, testKey, withinTtl);
    expect(readValid).not.toBeNull();
    expect(readValid?.messages).toHaveLength(1);

    // 48 jam 1 menit setelahnya -> expired, dihapus, return null
    const expiredTime = now + (48 * 60 + 1) * 60 * 1000;
    const readExpired = readCopilotSession(kv, testKey, expiredTime);
    expect(readExpired).toBeNull();
    expect(kv.getItem(testKey)).toBeNull();
  });

  it('sliding TTL: writeCopilotSession selalu memperbarui expiresAt relatif ke now saat menulis', () => {
    const kv = new MemoryKV();
    const t0 = 1_000_000_000;
    const session = createCopilotSession(null, t0);
    writeCopilotSession(kv, testKey, session, t0);

    const firstRead = readCopilotSession(kv, testKey, t0);
    expect(firstRead?.expiresAt).toBe(t0 + COPILOT_SESSION_TTL_MS);

    // 10 jam kemudian ada turn baru
    const t1 = t0 + 10 * 3600 * 1000;
    firstRead!.messages.push({ role: 'user', content: 'Tanya lagi' });
    writeCopilotSession(kv, testKey, firstRead!, t1);

    const secondRead = readCopilotSession(kv, testKey, t1);
    expect(secondRead?.savedAt).toBe(t1);
    expect(secondRead?.expiresAt).toBe(t1 + COPILOT_SESSION_TTL_MS);
  });

  it('pruneMessages: membatasi pesan maksimal 60 buah (buang yang paling lama)', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Pesan ${i}`,
    }));
    const pruned = pruneMessages(messages);
    expect(pruned).toHaveLength(COPILOT_MAX_MESSAGES);
    expect(pruned[0].content).toBe('Pesan 40');
    expect(pruned[pruned.length - 1].content).toBe('Pesan 99');
  });

  it('pruneMessages: memotong teks yang melebihi 4.000 karakter dan membubuhkan ellipsis …', () => {
    const longContent = 'A'.repeat(10_000);
    const pruned = pruneMessages([{ role: 'user', content: longContent }]);
    expect(pruned[0].content.length).toBe(COPILOT_MAX_CHARS_PER_MESSAGE);
    expect(pruned[0].content.endsWith('…')).toBe(true);
  });

  it('data rusak: JSON rusak, version != 1, atau messages bukan array dikembalikan sebagai null', () => {
    const kv = new MemoryKV();
    kv.setItem(testKey, '{ invalid json');
    expect(readCopilotSession(kv, testKey)).toBeNull();

    kv.setItem(testKey, JSON.stringify({ version: 2, messages: [] }));
    expect(readCopilotSession(kv, testKey)).toBeNull();

    kv.setItem(testKey, JSON.stringify({ version: 1, messages: 'not an array' }));
    expect(readCopilotSession(kv, testKey)).toBeNull();
  });

  it('penanganan kuota penuh: jika setItem melempar dua kali, return false tanpa melempar error', () => {
    const errorKv: KVAdapter = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    const session = createCopilotSession(null);
    expect(() => writeCopilotSession(errorKv, testKey, session)).not.toThrow();
    expect(writeCopilotSession(errorKv, testKey, session)).toBe(false);
  });

  it('markInterrupted: placeholder assistant yang kosong ditandai interrupted dan diberi pesan ramah', () => {
    const messages = [
      { role: 'user' as const, content: 'Berapa pasien hari ini?' },
      { role: 'assistant' as const, content: '   ' },
    ];
    const fixed = markInterrupted(messages);
    expect(fixed[1].interrupted).toBe(true);
    expect(fixed[1].content).toBe('Jawaban terputus sebelum selesai. Silakan tanya ulang.');
  });

  it('sliceHistoryForContext: memotong riwayat deterministik berbasis customerId', () => {
    // 1. Array kosong -> kosong
    expect(sliceHistoryForContext([], 'cust-1')).toEqual([]);

    // 2. Semua pesan dalam konteks yang sama -> riwayat utuh
    const sameContext = [
      { role: 'user' as const, content: '1', contextCustomerId: 'cust-1' },
      { role: 'assistant' as const, content: '2', contextCustomerId: 'cust-1' },
    ];
    expect(sliceHistoryForContext(sameContext, 'cust-1')).toEqual(sameContext);

    // 3. Konteks berubah di tengah -> hanya pesan setelah titik perubahan
    const mixedContext = [
      { role: 'user' as const, content: 'Tanya umum', contextCustomerId: null },
      { role: 'user' as const, content: 'Pasien A', contextCustomerId: 'cust-A' },
      { role: 'assistant' as const, content: 'Jawab A', contextCustomerId: 'cust-A' },
      { role: 'user' as const, content: 'Pasien B', contextCustomerId: 'cust-B' },
      { role: 'assistant' as const, content: 'Jawab B', contextCustomerId: 'cust-B' },
    ];
    const slicedForB = sliceHistoryForContext(mixedContext, 'cust-B');
    expect(slicedForB).toEqual([
      { role: 'user', content: 'Pasien B', contextCustomerId: 'cust-B' },
      { role: 'assistant', content: 'Jawab B', contextCustomerId: 'cust-B' },
    ]);

    // 4. Beralih ke pertanyaan tanpa konteks (null) -> hanya ambil pesan setelah titik perubahan
    const slicedForNull = sliceHistoryForContext(mixedContext, null);
    expect(slicedForNull).toEqual([]); // Karena pesan terakhir memiliki context 'cust-B'

    const trailingNullContext = [
      { role: 'user' as const, content: 'Pasien B', contextCustomerId: 'cust-B' },
      { role: 'user' as const, content: 'Omzet hari ini?', contextCustomerId: null },
      { role: 'assistant' as const, content: 'Rp 5.000.000', contextCustomerId: null },
    ];
    expect(sliceHistoryForContext(trailingNullContext, null)).toHaveLength(2);
  });

  it('durabilitas browser crash: readCopilotSession secara otomatis memulihkan sesi in-flight dengan pesan interrupted', () => {
    const kv = new MemoryKV();
    const now = 1_700_000_000_000;
    // Skenario: user kirim pertanyaan, placeholder assistant kosong disimpan, lalu browser ditutup tiba-tiba
    const session = createCopilotSession('cust-1', now);
    session.messages.push(
      { role: 'user', content: 'Hitung omzet bulan ini' },
      { role: 'assistant', content: '' } // placeholder kosong belum selesai
    );
    writeCopilotSession(kv, testKey, session, now);

    // Saat dibuka kembali
    const rehydrated = readCopilotSession(kv, testKey, now + 1000);
    expect(rehydrated).not.toBeNull();
    expect(rehydrated?.messages).toHaveLength(2);
    expect(rehydrated?.messages[1].interrupted).toBe(true);
    expect(rehydrated?.messages[1].content).toBe('Jawaban terputus sebelum selesai. Silakan tanya ulang.');
  });
});
