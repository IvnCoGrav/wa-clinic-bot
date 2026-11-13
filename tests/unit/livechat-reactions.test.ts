import { describe, expect, it } from 'vitest';
import {
  groupReactions,
  senderLabel,
  type MessageReaction,
} from '../../packages/admin-dashboard/src/utils/liveChatReactions';

describe('Live Chat reactions', () => {
  it('mengembalikan array kosong untuk input kosong', () => {
    expect(groupReactions([])).toEqual([]);
    expect(groupReactions(null)).toEqual([]);
    expect(groupReactions(undefined)).toEqual([]);
  });

  it('mengabaikan reaksi tanpa emoji', () => {
    const reactions: MessageReaction[] = [
      { emoji: '', fromMe: false, senderName: 'Bunda' },
      { emoji: '❤️', fromMe: true },
    ];
    expect(groupReactions(reactions)).toEqual([
      { emoji: '❤️', count: 1, senders: ['Anda'] },
    ]);
  });

  it('mengelompokkan emoji sama dan mempertahankan urutan kemunculan', () => {
    const reactions: MessageReaction[] = [
      { emoji: '👍', fromMe: false, senderName: 'Sari' },
      { emoji: '❤️', fromMe: true },
      { emoji: '👍', fromMe: true },
      { emoji: '👍', fromMe: false },
    ];
    expect(groupReactions(reactions)).toEqual([
      { emoji: '👍', count: 3, senders: ['Sari', 'Anda', 'Customer'] },
      { emoji: '❤️', count: 1, senders: ['Anda'] },
    ]);
  });

  it('tidak menggabungkan emoji berbeda', () => {
    const reactions: MessageReaction[] = [
      { emoji: '👍', fromMe: true },
      { emoji: '🙏', fromMe: true },
    ];
    expect(groupReactions(reactions)).toHaveLength(2);
  });
});

describe('Live Chat sender label', () => {
  it('melabeli pesan masuk sebagai Customer', () => {
    expect(senderLabel({ direction: 'INBOUND', sender_type: 'STAFF' })).toBe('Customer');
  });

  it('memakai nama staf untuk pesan keluar dari admin/staff', () => {
    expect(senderLabel({ direction: 'OUTBOUND', sender_type: 'STAFF', sender_name: 'Bidan Rina' })).toBe('Bidan Rina');
    expect(senderLabel({ direction: 'OUTBOUND', sender_type: 'ADMIN' })).toBe('Admin');
  });

  it('melabeli pesan bot sebagai Bot', () => {
    expect(senderLabel({ direction: 'OUTBOUND', sender_type: 'BOT' })).toBe('Bot');
    expect(senderLabel({ direction: 'OUTBOUND' })).toBe('Bot');
  });
});
