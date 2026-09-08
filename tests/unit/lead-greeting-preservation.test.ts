import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { isPureLeadGreeting, stripAdTags } from '../../src/utils/lead-greeting-detector';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';
import { sanitizeGreetingRepetitionForFollowUp } from '../../src/utils/language-sanitizer';
import { PersonaPromptBuilder } from '../../src/v3/agent/persona';
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

  it('Case 3: OutputSanitizer memotong perkenalan Turn-0 pada chat lanjutan', () => {
    // Phase 4 minimal: hanya potong bila 2 paragraf dan paragraf pertama murni sapaan
    const turn0Repeat =
      'Halo Bunda! ✨ Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa.\n\nKalau boleh tahu, si kecil saat ini ada keluhan tertentu tidak ya Bunda?';
    const cleaned = OutputSanitizer.sanitizeFollowUpGreetingRepetition(turn0Repeat, true);
    expect(cleaned).not.toContain('Terima kasih sudah menghubungi kami');
    expect(cleaned).not.toContain('Perkenalkan, saya Bidan Yusi');
    expect(cleaned).toContain('Kalau boleh tahu');
    // Single-paragraf tidak dipotong (minimal regex)
    const singlePara = 'Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms. Untuk pijat bayi, kami sarankan *Pijat Bayi Ceria*';
    expect(OutputSanitizer.sanitizeFollowUpGreetingRepetition(singlePara, true)).toBe(singlePara);
    // Preservasi: Turn-0 tidak dipotong bila bukan follow-up
    expect(OutputSanitizer.sanitizeFollowUpGreetingRepetition(turn0Repeat, false)).toBe(turn0Repeat);
  });

  it('Case 3: cleanOutboundReply(isFollowUp=true) tidak mengulang sapaan pembuka', () => {
    const raw =
      'Halo Bunda! ✨ Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa.\n\nUntuk pijat bayi, kami sarankan *Pijat Bayi Ceria* ya Bunda 😊';
    const out = OutputSanitizer.cleanOutboundReply(raw, 'pijat buat baby apa ya kak rekomendasinya', true);
    expect(out).not.toContain('Terima kasih sudah menghubungi kami');
    expect(out).not.toContain('Perkenalkan, saya Bidan Yusi');
    expect(out).toContain('Pijat Bayi Ceria');
  });

  it('Case 3: language-sanitizer follow-up memotong perkenalan diri', () => {
    const raw = 'Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. Jawaban rekomendasi.';
    const out = sanitizeGreetingRepetitionForFollowUp(raw, true);
    expect(out).not.toContain('Perkenalkan, saya Bidan Yusi');
    expect(out).toContain('Jawaban rekomendasi');
  });

  it('Case 3: persona CHAT LANJUTAN melarang keras pengulangan sapaan', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('DILARANG KERAS');
    expect(prompt).toContain('Perkenalkan, saya Bidan Yusi');
  });

  it('Case 3: V3 follow-up membersihkan balasan LLM yang mengulang Turn-0', async () => {
    const repeatedGreeting =
      'Halo Bunda! ✨ Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa.\n\nUntuk rekomendasi pijat baby, kami sarankan *Pijat Bayi Ceria* ya Bunda 😊';
    (axios.post as any).mockResolvedValueOnce({
      data: { choices: [{ message: { role: 'assistant', content: repeatedGreeting } }] },
    });
    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-follow-1',
      conversationId: 'mock-follow-conv-1',
      phone: '6286666666666',
      chatId: '6286666666666@c.us',
      incomingText: 'pijat buat baby apa ya kak rekomendasinya',
      history: [
        { role: 'user', content: 'halo' },
        { role: 'assistant', content: TEMPLATES.greeting({ isIslamic: false }) },
      ],
    });
    expect(axios.post).toHaveBeenCalled();
    expect(result.replyText).not.toContain('Terima kasih sudah menghubungi kami');
    expect(result.replyText).not.toContain('Perkenalkan, saya Bidan Yusi');
  });
});
