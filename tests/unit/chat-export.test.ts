import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/db/client', () => ({
  prisma: {
    message: { findMany: vi.fn().mockRejectedValue(new Error('Database offline')) },
    aiEvaluation: { findMany: vi.fn().mockRejectedValue(new Error('Database offline')) },
  },
}));

import {
  buildDailyChatMarkdown,
  roleLabel,
  formatTime,
  formatLocalDate,
  parseDateRange,
  type ExportConversation,
} from '../../src/services/chat-export.service';

const makeConversation = (overrides: Partial<ExportConversation> = {}): ExportConversation => ({
  id: 'conv-1',
  current_state: 'LOCATION_CONFIRMED',
  previous_state: 'AWAITING_LOCATION',
  is_human_handling: false,
  escalation_reason: null,
  consecutive_unknown_count: 0,
  review_flagged: false,
  last_discussed_treatment: null,
  customer_phone: '628123456789',
  customer_name: 'Bunda Anisa',
  customer_kelurahan: 'Mulyosari',
  messages: [],
  ...overrides,
});

describe('roleLabel — penanda peran untuk pembaca AI', () => {
  it('CUSTOMER -> USER', () => expect(roleLabel('CUSTOMER', null)).toBe('USER'));
  it('BOT -> BOT', () => expect(roleLabel('BOT', null)).toBe('BOT'));
  it('ADMIN + nama -> HUMAN_AGENT (nama)', () =>
    expect(roleLabel('ADMIN', 'Bidan Yusi')).toBe('HUMAN_AGENT (Bidan Yusi)'));
  it('HUMAN tanpa nama -> HUMAN_AGENT', () => expect(roleLabel('HUMAN', null)).toBe('HUMAN_AGENT'));
  it('sender tak dikenal -> SENDER_<TYPE>', () => expect(roleLabel('WAHA', null)).toBe('SENDER_WAHA'));
  it('null -> UNKNOWN', () => expect(roleLabel(null, null)).toBe('UNKNOWN'));
});

describe('formatTime / formatLocalDate / parseDateRange', () => {
  it('formatTime memformat HH:MM:SS', () => {
    const d = new Date(2026, 7, 13, 10, 5, 7);
    expect(formatTime(d)).toBe('10:05:07');
  });

  it('formatTime menerima string ISO', () => {
    expect(formatTime(new Date('2026-08-13T10:05:07Z'))).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('formatLocalDate menghasilkan YYYY-MM-DD', () => {
    const d = new Date(2026, 7, 13, 15, 30);
    expect(formatLocalDate(d)).toBe('2026-08-13');
  });

  it('parseDateRange memvalidasi & menghitung rentang hari', () => {
    const range = parseDateRange('2026-08-13')!;
    expect(range.start.toISOString()).toBe('2026-08-13T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-08-13T23:59:59.999Z');
  });

  it('parseDateRange menolak format salah', () => {
    expect(parseDateRange('13-08-2026')).toBeNull();
    expect(parseDateRange('2026-13-99')).toBeNull();
    expect(parseDateRange('abc')).toBeNull();
  });
});

describe('buildDailyChatMarkdown — struktur file ekspor', () => {
  it('menampilkan header + statistik total', () => {
    const conv = makeConversation({
      messages: [
        { id: 'm1', direction: 'INBOUND', content: 'Halo mba', sender_type: 'CUSTOMER', sender_name: null, created_at: new Date(2026, 7, 13, 10, 0, 5) },
        { id: 'm2', direction: 'OUTBOUND', content: 'Halo Bunda!', sender_type: 'BOT', sender_name: null, created_at: new Date(2026, 7, 13, 10, 0, 7) },
      ],
    });
    const result = buildDailyChatMarkdown('2026-08-13', [conv]);

    expect(result.success).toBe(true);
    expect(result.fileName).toBe('daily-chats-2026-08-13.md');
    expect(result.content).toContain('# Daily Chat Export — 2026-08-13');
    expect(result.content).toContain('Total percakapan: 1 | Total pesan: 2');
    expect(result.content).toContain('Di-handle manusia: 0 | Dieskalasi: 0 | Ditandai review: 0');
    expect(result.stats.totalConversations).toBe(1);
    expect(result.stats.totalMessages).toBe(2);
  });

  it('menandai balasan manusia sebagai HUMAN_AGENT dengan nama staf', () => {
    const conv = makeConversation({
      is_human_handling: true,
      messages: [
        { id: 'm1', direction: 'INBOUND', content: 'Saya mau booking', sender_type: 'CUSTOMER', sender_name: null, created_at: new Date(2026, 7, 13, 9, 0, 0) },
        { id: 'm2', direction: 'OUTBOUND', content: 'Baik Bunda, kami proses ya', sender_type: 'ADMIN', sender_name: 'Bidan Yusi', created_at: new Date(2026, 7, 13, 9, 1, 0) },
      ],
    });
    const result = buildDailyChatMarkdown('2026-08-13', [conv]);

    expect(result.content).toContain('**HUMAN_AGENT (Bidan Yusi)**:');
    expect(result.content).toContain('**Di-handle manusia**: Ya');
  });

  it('menampilkan skor AI pada balasan BOT jika ada', () => {
    const conv = makeConversation({
      messages: [
        { id: 'm1', direction: 'INBOUND', content: 'brp harga?', sender_type: 'CUSTOMER', sender_name: null, created_at: new Date(2026, 7, 13, 8, 0, 0) },
        { id: 'm2', direction: 'OUTBOUND', content: 'Harga Rp 150.000', sender_type: 'BOT', sender_name: null, created_at: new Date(2026, 7, 13, 8, 0, 2), ai_score: 4, ai_reasoning: 'clear answer', ai_feedback: 'natural' },
      ],
    });
    const result = buildDailyChatMarkdown('2026-08-13', [conv]);
    expect(result.content).toContain('**BOT** (skor AI: 4/5):');
  });

  it('menampilkan flag eskalasi & unknown count', () => {
    const conv = makeConversation({
      escalation_reason: 'UNKNOWN_REPEATED',
      consecutive_unknown_count: 2,
      review_flagged: true,
      messages: [
        { id: 'm1', direction: 'INBOUND', content: '???', sender_type: 'CUSTOMER', sender_name: null, created_at: new Date(2026, 7, 13, 7, 0, 0) },
      ],
    });
    const result = buildDailyChatMarkdown('2026-08-13', [conv]);
    expect(result.content).toContain('**Alasan eskalasi**: UNKNOWN_REPEATED');
    expect(result.content).toContain('**Pesan tidak dikenal beruntun**: 2');
    expect(result.content).toContain('**Flag review**: Ya');
    expect(result.stats.escalated).toBe(1);
    expect(result.stats.humanHandled).toBe(0);
  });

  it('menyisipkan lompatan baris multi-line dengan blockquote markdown', () => {
    const conv = makeConversation({
      messages: [
        { id: 'm1', direction: 'INBOUND', content: 'Baris 1\nBaris 2', sender_type: 'CUSTOMER', sender_name: null, created_at: new Date(2026, 7, 13, 7, 0, 0) },
      ],
    });
    const result = buildDailyChatMarkdown('2026-08-13', [conv]);
    expect(result.content).toContain('**USER**: Baris 1');
    expect(result.content).toContain('  > Baris 2');
  });

  it('percakapan kosong menghasilkan placeholder "Tidak ada percakapan"', () => {
    const result = buildDailyChatMarkdown('2026-08-13', []);
    expect(result.success).toBe(true);
    expect(result.content).toContain('_Tidak ada percakapan pada tanggal ini._');
    expect(result.stats.totalConversations).toBe(0);
  });

  it('menampilkan state transisi (previous → current)', () => {
    const conv = makeConversation({
      messages: [
        { id: 'm1', direction: 'INBOUND', content: 'halo', sender_type: 'CUSTOMER', sender_name: null, created_at: new Date(2026, 7, 13, 6, 0, 0) },
      ],
    });
    const result = buildDailyChatMarkdown('2026-08-13', [conv]);
    expect(result.content).toContain('AWAITING_LOCATION → LOCATION_CONFIRMED');
  });
});
