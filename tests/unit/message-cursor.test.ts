import { describe, it, expect } from 'vitest';
import { decodeMessageCursor, encodeMessageCursor } from '../../src/utils/message-cursor';

/**
 * Regresi AUDIT LIVE CHAT #316 / T-09.
 * Cursor lama hanya timestamp → pesan dengan detik sama terlewat di batas halaman.
 */
describe('message-cursor — komposit (created_at, id)', () => {
  const iso = '2026-11-06T02:00:00.000Z';

  it('encode + decode roundtrip mempertahankan timestamp & id', () => {
    const cursor = encodeMessageCursor(iso, 'msg_123');
    expect(cursor).toBe(`${iso}|msg_123`);
    const decoded = decodeMessageCursor(cursor);
    expect(decoded?.createdAt.toISOString()).toBe(iso);
    expect(decoded?.id).toBe('msg_123');
  });

  it('menerima Date sebagai input', () => {
    const cursor = encodeMessageCursor(new Date(iso), 'msg_abc');
    expect(cursor).toBe(`${iso}|msg_abc`);
  });

  it('kompatibel mundur: cursor lama tanpa id tetap valid', () => {
    const decoded = decodeMessageCursor(iso);
    expect(decoded?.createdAt.toISOString()).toBe(iso);
    expect(decoded?.id).toBeUndefined();
    expect(encodeMessageCursor(iso)).toBe(iso);
    expect(encodeMessageCursor(iso, '   ')).toBe(iso);
  });

  it('menolak input kosong/tidak valid (fail-safe, bukan crash)', () => {
    expect(encodeMessageCursor(null)).toBeNull();
    expect(encodeMessageCursor('bukan-tanggal')).toBeNull();
    expect(decodeMessageCursor(null)).toBeNull();
    expect(decodeMessageCursor('')).toBeNull();
    expect(decodeMessageCursor('bukan-tanggal')).toBeNull();
    expect(decodeMessageCursor('bukan-tanggal|msg_1')).toBeNull();
    expect(decodeMessageCursor(new Date(Number.NaN))).toBeNull();
  });

  it('id kosong setelah separator diperlakukan sebagai cursor timestamp saja', () => {
    const decoded = decodeMessageCursor(`${iso}|`);
    expect(decoded?.createdAt.toISOString()).toBe(iso);
    expect(decoded?.id).toBeUndefined();
  });
});
