import { describe, it, expect, beforeEach, vi } from 'vitest';
import { phrasingService } from '../../src/integrations/llm/phrasing.service';
import { llmResponseGenerator } from '../../src/integrations/llm/generator';
import { openerTracker } from '../../src/integrations/llm/opener-tracker';
import { callChatCompletionsWithFallback } from '../../src/integrations/llm/model-fallback';
import { AiModelConfigService } from '../../src/config/ai-models.config';

vi.mock('../../src/integrations/llm/model-fallback', () => ({
  callChatCompletionsWithFallback: vi.fn().mockResolvedValue({
    data: { choices: [{ message: { content: 'Halo Bunda! Terima kasih sudah menghubungi kami.' } }] },
  }),
  getFallbackModel: vi.fn().mockReturnValue('mock-fallback'),
}));
vi.mock('../../src/config/ai-models.config', () => ({
  AiModelConfigService: {
    getModelConfig: vi.fn().mockReturnValue({ modelName: 'mock-model', temperature: 0.7 }),
  },
}));

describe('Phrasing Service & Humanizer Layer Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    openerTracker.clear();
    process.env.HUMANIZER_ENABLED = 'true';
    process.env.LLM_API_KEY = 'mock_key';
  });

  describe('1. Fallback & Config Guards', () => {
    it('returns fallbackTemplate when HUMANIZER_ENABLED is false', async () => {
      process.env.HUMANIZER_ENABLED = 'false';
      process.env.LLM_API_KEY = 'real_key_123';

      const result = await phrasingService.generate({
        intent: 'ongkir_info',
        facts: { distanceKm: 7.2, normalPrice: 15000, promoPrice: 10000 },
        fallbackTemplate: 'Fallback Ongkir 10.000',
      });

      expect(result).toBe('Fallback Ongkir 10.000');
    });

    it('returns fallbackTemplate when LLM_API_KEY is mock or empty', async () => {
      process.env.HUMANIZER_ENABLED = 'true';
      process.env.LLM_API_KEY = 'mock_key';

      const result = await phrasingService.generate({
        intent: 'location_escalation',
        fallbackTemplate: 'Mohon tunggu sebentar',
      });

      expect(result).toBe('Mohon tunggu sebentar');
    });
  });

  describe('5. Greeting Constraint (Humanizer 10%)', () => {
    const callMock = vi.mocked(callChatCompletionsWithFallback);

    beforeEach(() => {
      process.env.HUMANIZER_ENABLED = 'true';
      process.env.LLM_API_KEY = 'real-key-for-greeting-test';
      vi.mocked(AiModelConfigService.getModelConfig).mockReturnValue({ modelName: 'mock-model', temperature: 0.7 } as any);
      callMock.mockClear();
      callMock.mockResolvedValue({
        data: { choices: [{ message: { content: 'Halo Bunda! Terima kasih sudah menghubungi kami.' } }] },
      });
    });

    it('menambahkan constraint 10% pada system prompt untuk intent greeting', async () => {
      await phrasingService.generate({
        intent: 'greeting',
        fallbackTemplate: 'Halo Bunda! Terima kasih sudah menghubungi kami.',
      });

      expect(callMock).toHaveBeenCalledTimes(1);
      const call = callMock.mock.calls[0][0];
      const systemPrompt = (call.payload as any).messages.find((m: any) => m.role === 'system').content;
      expect(systemPrompt).toContain('ATURAN KHUSUS GREETING');
      expect(systemPrompt).toContain('Pertahankan MINIMAL 90%');
      expect(systemPrompt).toContain('SEKITAR 10%');
    });

    it('tidak menambahkan constraint greeting untuk intent selain greeting', async () => {
      await phrasingService.generate({
        intent: 'ongkir_info',
        fallbackTemplate: 'Ongkir Rp10.000 ya bunda',
      });

      const call = callMock.mock.calls[0][0];
      const systemPrompt = (call.payload as any).messages.find((m: any) => m.role === 'system').content;
      expect(systemPrompt).not.toContain('ATURAN KHUSUS GREETING');
    });

    it('menambahkan constraint sapaan waktu hanya untuk greeting dan melarang untuk intent lain', async () => {
      await phrasingService.generate({
        intent: 'greeting',
        fallbackTemplate: 'Halo Bunda!',
      });

      const call1 = callMock.mock.calls[0][0];
      const prompt1 = (call1.payload as any).messages.find((m: any) => m.role === 'system').content;
      expect(prompt1).toContain('REKOMENDASI SAPAAN WAKTU');

      callMock.mockClear();
      await phrasingService.generate({
        intent: 'faq_question',
        fallbackTemplate: 'Pijat hamil aman untuk kehamilan > 12 minggu',
      });

      const call2 = callMock.mock.calls[0][0];
      const prompt2 = (call2.payload as any).messages.find((m: any) => m.role === 'system').content;
      expect(prompt2).toContain('DILARANG SAPAAN WAKTU');
      expect(prompt2).not.toContain('REKOMENDASI SAPAAN WAKTU');
    });

    it('menambahkan constraint khusus ongkir_info pada system prompt', async () => {
      await phrasingService.generate({
        intent: 'ongkir_info',
        facts: { distanceKm: 15.8, normalPrice: 25000, promoPrice: 20000 },
        fallbackTemplate: 'Ongkir Rp20.000 ya bund',
      });

      const call = callMock.mock.calls[0][0];
      const systemPrompt = (call.payload as any).messages.find((m: any) => m.role === 'system').content;
      expect(systemPrompt).toContain('ATURAN KHUSUS ONGKIR INFO (SANGAT KETAT)');
      expect(systemPrompt).toContain('Pertahankan MINIMAL 85%');
    });

    it('trigger fallback ke static template jika output LLM mengandung halusinasi saran perjalanan', async () => {
      callMock.mockResolvedValueOnce({
        data: { choices: [{ message: { content: 'Ongkirnya 20.000 ya bund. Tetap sabar ya dalam perjalanan nanti kalau sudah sampai bisa istirahat' } }] },
      });

      const result = await phrasingService.generate({
        intent: 'ongkir_info',
        facts: { distanceKm: 15.8, normalPrice: 25000, promoPrice: 20000 },
        fallbackTemplate: 'Template Ongkir Statis 20.000',
      });

      expect(result).toBe('Template Ongkir Statis 20.000');
    });

    it('malformed JSON TIDAK pernah bocor ke customer — dipakai regex, atau fallback template statis', async () => {
      // JSON terpotong dengan field "message" lengkap → diekstrak via regex.
      callMock.mockResolvedValueOnce({
        data: { choices: [{ message: { content: '{"message": "Ongkirnya 20.000 ya bund, terima kasih"}' } }] },
      });
      const resultWithMsg = await phrasingService.generate({
        intent: 'ongkir_info',
        facts: { normalPrice: 20000 },
        fallbackTemplate: 'Template Ongkir Statis 20.000',
      });
      expect(resultWithMsg).toContain('Ongkirnya 20.000');
      expect(resultWithMsg).not.toMatch(/^\s*\{/);
      expect(resultWithMsg).not.toContain('"message"');

      // JSON terpotong TANPA field "message" yang bisa diekstrak → fallback template statis.
      callMock.mockResolvedValueOnce({
        data: { choices: [{ message: { content: '{"reasoning": "ongkir", "message": "Ongkirnya 20.000 ya bund' } }] },
      });
      const resultNoMsg = await phrasingService.generate({
        intent: 'ongkir_info',
        facts: { normalPrice: 20000 },
        fallbackTemplate: 'Template Ongkir Statis 20.000',
      });
      expect(resultNoMsg).toBe('Template Ongkir Statis 20.000');
      expect(resultNoMsg).not.toMatch(/^\s*\{/);
      expect(resultNoMsg).not.toContain('"message"');
    });

    it('JSON valid tapi tanpa field message → tidak mengirim JSON mentah (fallback template statis)', async () => {
      callMock.mockResolvedValueOnce({
        data: { choices: [{ message: { content: '{"intent": "ongkir_info"}' } }] },
      });
      const result = await phrasingService.generate({
        intent: 'ongkir_info',
        facts: { normalPrice: 20000 },
        fallbackTemplate: 'Template Ongkir Statis 20.000',
      });
      expect(result).toBe('Template Ongkir Statis 20.000');
      expect(result).not.toMatch(/^\s*\{/);
    });

    it('response body kosong/anomali tidak throw — jatuh ke fallback template statis', async () => {
      callMock.mockResolvedValueOnce({ data: {} } as any);
      const result = await phrasingService.generate({
        intent: 'ongkir_info',
        facts: { normalPrice: 20000 },
        fallbackTemplate: 'Template Ongkir Statis 20.000',
      });
      expect(result).toBe('Template Ongkir Statis 20.000');

      callMock.mockResolvedValueOnce({ data: { choices: [] } } as any);
      const result2 = await phrasingService.generate({
        intent: 'ongkir_info',
        facts: { normalPrice: 20000 },
        fallbackTemplate: 'Template Ongkir Statis 20.000',
      });
      expect(result2).toBe('Template Ongkir Statis 20.000');
    });

    it('membersihkan double greeting dan mengganti kata lokasi menjadi rumahnya pada output LLM', async () => {
      callMock.mockResolvedValueOnce({
        data: { choices: [{ message: { content: 'Selamat Siang, Selamat datang, Bunda! ✨ Boleh tahu dimana lokasinya ya, Bunda? 🙏🏻' } }] },
      });

      const result = await phrasingService.generate({
        intent: 'greeting',
        fallbackTemplate: 'Halo Bunda! Boleh tau rumahnya dimana ya bunda?. 😊',
      });

      expect(result).not.toContain('Selamat Siang, Selamat datang');
      expect(result).toContain('Selamat datang');
      expect(result).not.toContain('lokasinya');
      expect(result).toContain('rumahnya di mana');
    });

    it('menghormati nilai HUMANIZER_GREETING_CHANGE_PERCENT', async () => {
      process.env.HUMANIZER_GREETING_CHANGE_PERCENT = '5';
      await phrasingService.generate({
        intent: 'greeting',
        fallbackTemplate: 'Halo Bunda!',
      });

      const call = callMock.mock.calls[0][0];
      const systemPrompt = (call.payload as any).messages.find((m: any) => m.role === 'system').content;
      expect(systemPrompt).toContain('Pertahankan MINIMAL 95%');
      expect(systemPrompt).toContain('SEKITAR 5%');
      delete process.env.HUMANIZER_GREETING_CHANGE_PERCENT;
    });
  });

  describe('2. Opener Tracker (Anti-Repetisi Minimal)', () => {
    it('records and retrieves up to 3 recent openers per conversation', () => {
      openerTracker.record('conv1', 'Halo Bunda! Terima kasih sudah menghubungi kami...');
      openerTracker.record('conv1', 'Baik Bunda, lokasi homecare sudah kami catat...');
      openerTracker.record('conv1', 'Mohon tunggu sebentar ya bund...');
      openerTracker.record('conv1', 'Selamat pagi Bunda! Apa kabar...');

      const openers = openerTracker.getOpeners('conv1');
      expect(openers.length).toBe(3);
      expect(openers[0]).toContain('lokasi homecare');
      expect(openers[2]).toContain('Selamat pagi');
    });

    it('isolates openers per conversationId', () => {
      openerTracker.record('conv1', 'Halo Bunda A');
      openerTracker.record('conv2', 'Halo Bunda B');

      expect(openerTracker.getOpeners('conv1')[0]).toContain('Halo Bunda A');
      expect(openerTracker.getOpeners('conv2')[0]).toContain('Halo Bunda B');
    });
  });

  describe('3. Robust sanitizeTeamReferral (Anti-Dangling Connector)', () => {
    it('replaces text shorter than 15 characters with full fallback message', () => {
      const result = llmResponseGenerator.sanitizeTeamReferral('Halo bund.');
      expect(result).toContain('Kami siap membantu memberikan rekomendasi');
    });

    it('strips leading dangling connectors ("Namun,", "Untuk harga,")', () => {
      const input = 'Namun, layanan kami tersedia jam 8 pagi sampai 5 sore ya bund.';
      const result = llmResponseGenerator.sanitizeTeamReferral(input);
      expect(result.startsWith('Namun')).toBe(false);
      expect(result).toContain('Layanan kami tersedia jam 8 pagi');
    });

    it('strips trailing dangling connectors ("... tapi", "... untuk")', () => {
      const input = 'Untuk info selengkapnya bisa ditanyakan langsung ke kami tapi';
      const result = llmResponseGenerator.sanitizeTeamReferral(input);
      expect(result.endsWith('tapi')).toBe(false);
      expect(result.length).toBeGreaterThan(15);
    });

    it('handles LLM referral phrases that get stripped without leaving dangling fragment', () => {
      const input = 'Namun, untuk harga yang paling akurat, bisa langsung tanya ke tim kami aja ya bund 😊';
      const result = llmResponseGenerator.sanitizeTeamReferral(input);
      expect(result).toContain('Kami siap membantu memberikan rekomendasi');
    });
  });

  describe('4. Safe Emergency Fallback in generateFaqResponse (non-catalog chunk)', () => {
    it('fallback darurat TIDAK meng-echo teks RAG/KB mentah & TIDAK memaksa CTA treatment', async () => {
      const answer = await llmResponseGenerator.generateFaqResponse(
        'Sinar moksa itu apa',
        [{
          id: '1',
          tenantId: 'default',
          sourceType: 'faq' as any,
          title: 'Sinar Moksa',
          content: 'Jawaban: Sinar moksa adalah terapi inframerah hangat.',
          documentName: 'faq',
        }],
        'conv123',
        'default',
        'Sinar Moksa'
      );

      // Tidak ada echo RAG mentah (dokumen KB) yang berpotensi keliru/misleading.
      expect(answer).not.toContain('Sinar moksa adalah terapi inframerah hangat.');
      // Tidak ada hard-sell nama treatment pada pesan darurat.
      expect(answer).not.toContain('Sinar Moksa');
      // Tidak ada bocor JSON/internal.
      expect(answer).not.toMatch(/\{[^{}]*"/);
      expect(answer).not.toContain('reasoning');
      // Jawaban KOSONG = sinyal eskalasi senyap ke antrean human handling
      // (bukan skenario apology "mohon maaf antrean").
      expect(answer).toBe('');
      expect(answer).not.toMatch(/mohon maaf|antrean|belum bisa/i);
    });
  });
});
