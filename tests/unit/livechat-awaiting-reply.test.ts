import { describe, expect, it } from 'vitest';
import {
  computeIsAwaitingReply,
  hasStaffReaction,
} from '../../src/services/livechat-reply-state';

const NOW = new Date('2026-11-11T10:00:00+07:00').getTime();
const fiveMinutesAgo = new Date(NOW - 5 * 60 * 1000).toISOString();

function inbound(over = {}) {
  return {
    direction: 'INBOUND',
    created_at: fiveMinutesAgo,
    sender_type: 'CUSTOMER',
    payload_raw: {},
    ...over,
  };
}

describe('hasStaffReaction', () => {
  it('mengenali reaksi staf', () => {
    expect(hasStaffReaction({ reactions: [{ emoji: '👍', fromMe: true }] })).toBe(true);
  });

  it('mengabaikan reaksi customer', () => {
    expect(hasStaffReaction({ reactions: [{ emoji: '👍', fromMe: false }] })).toBe(false);
  });

  it('mengabaikan emoji kosong (penghapusan reaksi)', () => {
    expect(hasStaffReaction({ reactions: [{ emoji: '   ', fromMe: true }] })).toBe(false);
  });

  it('aman untuk payload rusak / kosong', () => {
    expect(hasStaffReaction(null)).toBe(false);
    expect(hasStaffReaction({})).toBe(false);
    expect(hasStaffReaction({ reactions: 'bukan array' })).toBe(false);
    expect(hasStaffReaction({ reactions: [null, undefined, 42] })).toBe(false);
  });
});

describe('computeIsAwaitingReply', () => {
  it('pesan customer terakhir tanpa reaksi → menunggu dibalas', () => {
    expect(computeIsAwaitingReply(inbound(), 0, false, NOW)).toBe(true);
  });

  it('pesan customer terakhir yang diberi emot staf → TIDAK menunggu dibalas', () => {
    const msg = inbound({ payload_raw: { reactions: [{ emoji: '🙏', fromMe: true }] } });
    expect(computeIsAwaitingReply(msg, 0, false, NOW)).toBe(false);
  });

  it('reaksi customer pada pesannya sendiri tidak memadamkan status', () => {
    const msg = inbound({ payload_raw: { reactions: [{ emoji: '🙏', fromMe: false }] } });
    expect(computeIsAwaitingReply(msg, 0, false, NOW)).toBe(true);
  });

  it('pesan terakhir dari staf (OUTBOUND) → sudah dibalas', () => {
    expect(computeIsAwaitingReply(inbound({ direction: 'OUTBOUND' }), 0, false, NOW)).toBe(false);
  });

  it('masih unread → bukan "menunggu dibalas"', () => {
    expect(computeIsAwaitingReply(inbound(), 3, false, NOW)).toBe(false);
  });

  it('ditandai manual unread → tidak dihitung menunggu dibalas', () => {
    expect(computeIsAwaitingReply(inbound(), 0, true, NOW)).toBe(false);
  });

  it('catatan internal tidak dihitung sebagai pesan customer', () => {
    expect(computeIsAwaitingReply(inbound({ sender_type: 'INTERNAL_NOTE' }), 0, false, NOW)).toBe(false);
  });

  it('lebih dari 24 jam tidak lagi menunggu dibalas', () => {
    const old = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
    expect(computeIsAwaitingReply(inbound({ created_at: old }), 0, false, NOW)).toBe(false);
  });

  it('reaksi staf pada pesan lama tidak menutupi pesan customer baru', () => {
    // Simulasi: pesan lama sudah diberi emot, tetapi pesan terakhir (baru) belum.
    const lastUnreacted = inbound({ payload_raw: { reactions: [] } });
    expect(computeIsAwaitingReply(lastUnreacted, 0, false, NOW)).toBe(true);
  });
});
