import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import {
  buildIsolatedRepromptMessages,
  attemptNumericReprompt,
} from '../../../src/v3/agent/pipeline/guardrail-pipeline';

vi.mock('axios');

/**
 * Sesi 310843 (kaset rusak Turn 3): reprompt history+draf+correction tetap
 * collapse — PRONOUN_REPROMPT_FIXED mengadopsi salinan Turn 1 dari riwayat.
 * Kontrak baru: Isolated Single-Turn Reprompt — payload HANYA system editor
 * + user draft, TANPA riwayat chat. Pencontekan lintas-turn mustahil
 * secara konstruksi.
 */
describe('Reprompt Payload Integrity (sesi 310843, isolated engine)', () => {
  it('payload terisolasi: tepat 2 pesan (system editor + user draft), tanpa riwayat', () => {
    const out = buildIsolatedRepromptMessages('Draf salah turn ini', 'KOREKSI');
    expect(out.length).toBe(2);
    expect(out[0].role).toBe('system');
    expect(out[0].content).toContain('Kala Moms and Baby Spa');
    expect(out[1].role).toBe('user');
    expect(out[1].content).toContain('Draf salah turn ini');
    expect(out[1].content).toContain('KOREKSI');
  });

  it('TIDAK ADA kebocoran riwayat turn lama ke payload', () => {
    const historyMarker = 'PESAN_TURN_1_WARU_HOMECARE_UNIK';
    const out = buildIsolatedRepromptMessages('Draf turn 3', 'KOREKSI saya→kami');
    const blob = JSON.stringify(out);
    expect(blob).not.toContain(historyMarker);
    expect(out.some((m: any) => m.role === 'assistant')).toBe(false);
  });

  it('draf kosong -> tetap 2 pesan aman (anti HTTP 400), koreksi terbawa', () => {
    for (const draft of ['', '   ', undefined]) {
      const out = buildIsolatedRepromptMessages(draft, 'KOREKSI');
      expect(out.length).toBe(2);
      expect(out[1].content).toContain('KOREKSI');
    }
  });

  it('attemptNumericReprompt memakai payload terisolasi + memanggil LLM sekali', async () => {
    (axios.post as any).mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Total resmi *Rp 195.000* ya Bunda.' } }] },
    });
    const out = await attemptNumericReprompt({
      tenantId: 'default-tenant',
      phone: '6281',
      conversationId: 'conv-x',
      baseUrl: 'https://unit.test/v1',
      apiKey: 'k',
      selectedModel: 'm',
      basePayload: { model: 'm', temperature: 0.65 },
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'HISTORY_LAMA' }],
      currentDraft: 'Totalnya Rp 120.000 ya Bunda.',
      violations: ['Nominal Rp 120.000 tidak sesuai total resmi.'],
      expectedTotals: [195000],
      addUsage: vi.fn(),
      auditUsage: vi.fn(),
    });
    expect(out).toContain('195.000');
    const sentBody = (axios.post as any).mock.calls[0][1];
    const sent = sentBody.messages;
    expect(sent.length).toBe(2);
    expect(sent[0].role).toBe('system');
    expect(sent[1].role).toBe('user');
    expect(JSON.stringify(sent)).not.toContain('HISTORY_LAMA');
    expect(sent[1].content).toContain('Totalnya Rp 120.000 ya Bunda.');
    expect(sent[1].content).toContain('195.000');
  });
});
