import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { isPureLeadGreeting, stripAdTags } from '../../src/utils/lead-greeting-detector';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { TEMPLATES } from '../../src/config/persona';
import { prisma } from '../../src/db/client';

vi.mock('axios');

/**
 * Preservasi teks asli Live Chat & greeting statis deterministik.
 * Offline, tanpa LLM live — gate mengembalikan template sebelum axios dipanggil.
 */
describe('Lead Greeting Preservation & Static Greeting Gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (axios.post as any).mockRejectedValue(new Error('LLM must not be called'));
  });

  it('detektor: sapaan iklan Promo[b8] adalah pure lead greeting non-Islami', () => {
    const res = isPureLeadGreeting(
      'Promo[b8]\n\nHalo Bu Bidan, saya tertarik dengan layanan home-treatment'
    );
    expect(res.isLeadGreeting).toBe(true);
    expect(res.isIslamic).toBe(false);
  });

  it('detektor: varian salam Islami terdeteksi + flag isIslamic', () => {
    const res = isPureLeadGreeting('Promo[pr01] Assalamualaikum Bu Bidan mau tanya layanan');
    expect(res.isLeadGreeting).toBe(true);
    expect(res.isIslamic).toBe(true);
  });

  it('detektor: sapaan + tanya harga bukan sapaan murni (diteruskan ke LLM)', () => {
    const res = isPureLeadGreeting('Promo[b8] Halo Bu Bidan, tarif pijat bayi berapa ya?');
    expect(res.isLeadGreeting).toBe(false);
  });

  it('detektor: sapaan pendek dan pertanyaan jadwal', () => {
    expect(isPureLeadGreeting('Halo').isLeadGreeting).toBe(true);
    expect(isPureLeadGreeting('P').isLeadGreeting).toBe(true);
    expect(isPureLeadGreeting('Hari sabtu bisa?').isLeadGreeting).toBe(false);
  });

  it('stripAdTags membersihkan tag tracking', () => {
    expect(stripAdTags('Promo[b8]\n\nHalo')).toBe('Halo');
    expect(stripAdTags('[ID: abc] Halo kak')).toBe('Halo kak');
  });

  it('V3 gate: sapaan iklan dibalas 100% TEMPLATES.greeting() tanpa LLM', async () => {
    const raw = 'Promo[b8]\n\nHalo Bu Bidan, saya tertarik dengan layanan home-treatment';
    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-lead-1',
      conversationId: 'mock-lead-conv-1',
      phone: '6281111111111',
      chatId: '6281111111111@c.us',
      incomingText: raw,
      originalText: raw,
    });
    expect(result.replyText).toBe(TEMPLATES.greeting({ isIslamic: false }));
    expect(result.replyText).toContain('Perkenalkan, saya Bidan Yusi');
    expect(result.replyText).toContain('Kalau boleh tau rumahnya dimana ya Bunda? 😊');
    expect(result.shouldSendReply).toBe(true);
    expect(result.executedTools).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('V3 gate: DB audit mencatat teks mentah lengkap dengan Promo[b8]', async () => {
    const raw = 'Promo[b8]\n\nHalo Bu Bidan, saya tertarik dengan layanan home-treatment';
    await V3AgentRunner.processMessage({
      customerId: 'mock-lead-2',
      conversationId: 'mock-lead-conv-2',
      phone: '6282222222222',
      chatId: '6282222222222@c.us',
      incomingText: raw,
      originalText: raw,
    });
    const calls = (prisma.message.create as any).mock.calls;
    const inbound = calls.find((c: any) => c?.[0]?.data?.direction === 'INBOUND');
    expect(inbound).toBeDefined();
    expect(inbound[0].data.content).toContain('Promo[b8]');
    expect(inbound[0].data.content).toContain('saya tertarik dengan layanan home-treatment');
  });

  it('V3 gate: salam Islami dibalas sapaan Waalaikumsalam', async () => {
    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-lead-3',
      conversationId: 'mock-lead-conv-3',
      phone: '6283333333333',
      chatId: '6283333333333@c.us',
      incomingText: 'Promo[pr01] Assalamualaikum Bu Bidan mau tanya layanan',
    });
    expect(result.replyText.startsWith('Waalaikumsalam Bunda')).toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('V3 gate: multi-intent (sapaan + harga) diteruskan ke LLM, tidak dipotong statis', async () => {
    (axios.post as any).mockResolvedValueOnce({
      data: { choices: [{ message: { role: 'assistant', content: 'MOCK LLM REPLY HARGA' } }] },
    });
    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-lead-4',
      conversationId: 'mock-lead-conv-4',
      phone: '6284444444444',
      chatId: '6284444444444@c.us',
      incomingText: 'Promo[b8] Halo Bu Bidan, tarif pijat bayi berapa ya?',
    });
    expect(axios.post).toHaveBeenCalled();
    expect(result.replyText).toContain('MOCK LLM REPLY HARGA');
  });

  it('V3: payload LLM hanya menerima teks bersih tanpa tag Promo', async () => {
    let captured: any = null;
    (axios.post as any).mockImplementationOnce(async (_url: string, payload: any) => {
      captured = payload;
      return { data: { choices: [{ message: { role: 'assistant', content: 'MOCK OK' } }] } };
    });
    await V3AgentRunner.processMessage({
      customerId: 'mock-lead-5',
      conversationId: 'mock-lead-conv-5',
      phone: '6285555555555',
      chatId: '6285555555555@c.us',
      incomingText: 'Halo Bu Bidan, tarif pijat bayi berapa ya?',
      originalText: 'Promo[b8]\n\nHalo Bu Bidan, tarif pijat bayi berapa ya?',
    });
    const userMsg = captured.messages.find((m: any) => m.role === 'user');
    expect(userMsg.content).not.toContain('Promo[');
    expect(userMsg.content).toContain('tarif pijat bayi berapa ya?');
  });
});
