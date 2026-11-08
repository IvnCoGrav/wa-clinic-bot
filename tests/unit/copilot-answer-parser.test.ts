import { describe, it, expect } from 'vitest';
import {
  parseCopilotAnswer,
  splitInlineLink,
  extractLiveChatConversationId,
  COPILOT_MAX_VISIBLE_ROWS,
  COPILOT_TOOL_PAGE,
} from '../../packages/admin-dashboard/src/utils/copilotAnswerParser';

describe('copilotAnswerParser (murni, offline)', () => {
  it('ekstrak live chat conversationId dengan aman dan tolak link eksternal', () => {
    expect(extractLiveChatConversationId('/admin/live-chat?conversationId=conv-123')).toBe('conv-123');
    expect(extractLiveChatConversationId('/admin/live-chat?id=conv-456')).toBe('conv-456');
    expect(extractLiveChatConversationId('https://google.com?conversationId=hacker')).toBeUndefined();
    expect(extractLiveChatConversationId('/admin/reservations?id=123')).toBeUndefined();
  });

  it('splitInlineLink: mengekstrak link internal kanonis pertama dan menyisakan link lain/eksternal', () => {
    const single = splitInlineLink('Bunda Siti · [Buka Chat](/admin/live-chat?conversationId=conv-1)');
    expect(single.conversationId).toBe('conv-1');
    expect(single.text).toBe('Bunda Siti ·');

    // Dua link: hanya link Live Chat kanonis pertama yang diekstrak, link eksternal tetap dalam teks
    const doubleLink = splitInlineLink(
      'Bunda Maya — [Buka Chat](/admin/live-chat?conversationId=conv-2) · lihat juga [Panduan](https://example.com/guide)'
    );
    expect(doubleLink.conversationId).toBe('conv-2');
    expect(doubleLink.text).toContain('[Panduan](https://example.com/guide)');
  });

  it('menguraikan heading # dan ### tanpa membocorkan karakter tanda pagar', () => {
    const text1 = '# Ringkasan Hari Ini';
    const blocks1 = parseCopilotAnswer(text1);
    expect(blocks1).toHaveLength(1);
    expect(blocks1[0]).toEqual({
      type: 'heading',
      text: 'Ringkasan Hari Ini',
    });

    const text3 = '### 🟠 Perlu Tindak Lanjut — Tunggu > 5 Jam';
    const blocks3 = parseCopilotAnswer(text3);
    expect(blocks3).toHaveLength(1);
    expect(blocks3[0]).toEqual({
      type: 'heading',
      text: '🟠 Perlu Tindak Lanjut — Tunggu > 5 Jam',
    });
  });

  it('membersihkan pembungkus **bold** pada nama pasien dan menguraikan baris pola produksi nyata', () => {
    const text = '1. **Bunda Zelikadewi** — belum ada tawaran jadwal — menunggu ~6 hari · [Buka Chat](/admin/live-chat?conversationId=conv-z)';
    const blocks = parseCopilotAnswer(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'row',
      name: 'Bunda Zelikadewi',
      status: 'belum ada tawaran jadwal',
      detail: 'menunggu ~6 hari',
      conversationId: 'conv-z',
    });
  });

  it('baris dengan dua tautan tetap mengekstrak tautan pertama dan mempertahankan tautan sekunder di teks', () => {
    const text = '1. Bunda Multi — Menunggu · link lain [Panduan](/admin/live-chat?conversationId=other) [Buka Chat](/admin/live-chat?conversationId=first)';
    const blocks = parseCopilotAnswer(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('row');
    if (blocks[0].type === 'row') {
      expect(blocks[0].conversationId).toBe('other');
      expect(blocks[0].detail).toContain('[Buka Chat](/admin/live-chat?conversationId=first)');
    }
  });

  it('menguraikan baris daftar bernomor dengan link chat menjadi blok row terstruktur', () => {
    const text = '1. Bunda X — menunggu ~3,7 hari · [Buka Chat](/admin/live-chat?conversationId=conv-x)';
    const blocks = parseCopilotAnswer(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'row',
      name: 'Bunda X',
      status: 'menunggu ~3,7 hari',
      detail: undefined,
      conversationId: 'conv-x',
    });
  });

  it('menguraikan baris dengan detail tambahan setelah status', () => {
    const text = '- Pasien Y — Jadwal Ulang · Bidan Ani [Buka Chat](/admin/live-chat?conversationId=conv-y)';
    const blocks = parseCopilotAnswer(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('row');
    if (blocks[0].type === 'row') {
      expect(blocks[0].name).toBe('Pasien Y');
      expect(blocks[0].status).toBe('Jadwal Ulang');
      expect(blocks[0].detail).toBe('Bidan Ani');
      expect(blocks[0].conversationId).toBe('conv-y');
    }
  });

  it('bullet tanpa link atau tanpa pemisah terurai sebagai blok list biasa', () => {
    const text = '- Pesan ini hanya catatan biasa tanpa link';
    const blocks = parseCopilotAnswer(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'list',
      text: 'Pesan ini hanya catatan biasa tanpa link',
      conversationId: undefined,
    });
  });

  it('menangani format CRLF Windows secara mulus', () => {
    const text = '### Judul\r\n\r\nParagraf pertama\r\n- Item 1\r\n- Item 2';
    const blocks = parseCopilotAnswer(text);
    expect(blocks).toHaveLength(4);
    expect(blocks[0].type).toBe('heading');
    expect(blocks[1].type).toBe('paragraph');
    expect(blocks[2].type).toBe('list');
    expect(blocks[3].type).toBe('list');
  });

  it('tahan terhadap string kosong atau input bukan string', () => {
    expect(parseCopilotAnswer('')).toEqual([]);
    expect(parseCopilotAnswer('   \n  \n ')).toEqual([]);
    expect(parseCopilotAnswer(null as any)).toEqual([]);
    expect(parseCopilotAnswer(undefined as any)).toEqual([]);
  });

  it('tahan terhadap baris sangat panjang (5.000 karakter)', () => {
    const longLine = 'Bunda Sangat Panjang '.repeat(250);
    const blocks = parseCopilotAnswer(longLine);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].text.length).toBeGreaterThan(4000);
  });

  it('idempoten: pemanggilan berkali-kali pada input yang sama menghasilkan output identik', () => {
    const text = `### Ringkasan\n1. Bunda A — Belum Bayar · [Buka Chat](/admin/live-chat?conversationId=1)\nAda catatan tambahan.`;
    const res1 = parseCopilotAnswer(text);
    const res2 = parseCopilotAnswer(text);
    expect(res1).toEqual(res2);
  });

  it('memastikan konstanta COPILOT_MAX_VISIBLE_ROWS dan COPILOT_TOOL_PAGE sesuai spesifikasi', () => {
    expect(COPILOT_MAX_VISIBLE_ROWS).toBe(8);
    expect(COPILOT_TOOL_PAGE.query_followups.path).toBe('/admin/follow-ups');
    expect(COPILOT_TOOL_PAGE.query_unreplied_chats.path).toBe('/admin/live-chat');
  });
});
