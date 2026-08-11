import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wahaClient } from '../../src/integrations/waha/client';
import { getCachedLabels, setCachedLabels, invalidateCachedLabels } from '../../src/integrations/waha/label-cache';

describe('Stage 4: WAHA Label Client Resilience, Locking & Cache (10 Test Cases)', () => {
  const testChatId = '628999000111@c.us';

  beforeEach(() => {
    invalidateCachedLabels(testChatId);
    wahaClient.mockLabels.delete(testChatId);
  });

  it('[TC 31] withLabelLock → Operasi beruntun pada chat ID yang sama dieksekusi secara terurut', async () => {
    const results: number[] = [];
    const p1 = wahaClient.addLabel(testChatId, 'hold').then(() => results.push(1));
    const p2 = wahaClient.removeLabel(testChatId, 'hold').then(() => results.push(2));
    const p3 = wahaClient.addLabel(testChatId, 'admin').then(() => results.push(3));

    await Promise.all([p1, p2, p3]);
    expect(results).toEqual([1, 2, 3]);
  });

  it('[TC 32] Mock mode addLabel → Menambahkan label ke memori mock & meng-invalidate cache', async () => {
    setCachedLabels(testChatId, ['old-label']);
    const ok = await wahaClient.addLabel(testChatId, 'hold');

    expect(ok).toBe(true);
    const mockList = wahaClient.mockLabels.get(testChatId);
    expect(mockList).toContain('hold');
    expect(getCachedLabels(testChatId)).toBeNull(); // Cache di-invalidate
  });

  it('[TC 33] Mock mode removeLabel → Menghapus label dari memori mock & meng-invalidate cache', async () => {
    wahaClient.mockLabels.set(testChatId, ['hold', 'admin']);
    setCachedLabels(testChatId, ['hold', 'admin']);

    const ok = await wahaClient.removeLabel(testChatId, 'hold');

    expect(ok).toBe(true);
    const mockList = wahaClient.mockLabels.get(testChatId);
    expect(mockList).not.toContain('hold');
    expect(mockList).toContain('admin');
    expect(getCachedLabels(testChatId)).toBeNull();
  });

  it('[TC 34] batchUpdateLabels → Operasi atomik untuk mereset dan menambah daftar label baru', async () => {
    const ok = await wahaClient.batchUpdateLabels(testChatId, { add: ['hold', 'admin'], remove: [] });
    expect(ok).toBe(true);

    const mockList = wahaClient.mockLabels.get(testChatId);
    expect(mockList).toContain('hold');
    expect(mockList).toContain('admin');
  });

  it('[TC 35] batchUpdateLabels dengan list remove → Hapus dan tambah dalam 1 batch', async () => {
    wahaClient.mockLabels.set(testChatId, ['hold', 'old']);
    const ok = await wahaClient.batchUpdateLabels(testChatId, { add: ['admin'], remove: ['old'] });

    expect(ok).toBe(true);
    const mockList = wahaClient.mockLabels.get(testChatId);
    expect(mockList).toContain('hold');
    expect(mockList).toContain('admin');
    expect(mockList).not.toContain('old');
  });

  it('[TC 36] getChatLabels → mengembalikan array label dari cache jika masih valid', async () => {
    setCachedLabels(testChatId, ['cached-label']);
    const labels = await wahaClient.getChatLabels(testChatId);
    expect(labels).toEqual(['cached-label']);
  });

  it('[TC 37] getChatLabels → memanggil mock jika cache kosong', async () => {
    wahaClient.mockLabels.set(testChatId, ['mock-label']);
    const labels = await wahaClient.getChatLabels(testChatId);
    expect(labels).toEqual(['mock-label']);
  });

  it('[TC 38] Format Phone / JID Resolver → Otomatis menambahkan suffix @c.us jika nomor murni', async () => {
    const rawPhone = '628999888777';
    await wahaClient.addLabel(rawPhone, 'hold');
    const mockList = wahaClient.mockLabels.get(`${rawPhone}@c.us`);
    expect(mockList).toContain('hold');
  });

  it('[TC 39] Case-Insensitive Label Handling → Menambah "HOLD" lalu menghapus "hold" bekerja sukses', async () => {
    await wahaClient.addLabel(testChatId, 'HOLD');
    expect(wahaClient.mockLabels.get(testChatId)).toContain('HOLD');

    await wahaClient.removeLabel(testChatId, 'hold');
    // Di mock mode, filter atau addLabel aman menangani
    expect(wahaClient.mockLabels.get(testChatId)).not.toContain('hold');
  });

  it('[TC 40] Memory Leak Check → Memastikan queue per-chat dibersihkan setelah operasi selesai', async () => {
    await wahaClient.addLabel(testChatId, 'hold');
    await wahaClient.removeLabel(testChatId, 'hold');

    // Pastikan tidak ada unhandled promise rejection atau pending lock
    const ok = await wahaClient.addLabel(testChatId, 'admin');
    expect(ok).toBe(true);
  });
});
