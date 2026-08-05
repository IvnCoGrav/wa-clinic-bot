import { describe, it, expect, beforeEach, vi } from 'vitest';
import { phrasingService } from '../../src/integrations/llm/phrasing.service';
import { llmResponseGenerator } from '../../src/integrations/llm/generator';
import { openerTracker } from '../../src/integrations/llm/opener-tracker';

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

  describe('4. Unified Single-Voice CTA in generateFaqResponse', () => {
    it('produces integrated CTA without separate generic double voice in fallback mode', async () => {
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

      expect(answer).toContain('Sinar moksa adalah terapi inframerah hangat.');
      expect(answer).toContain('Sinar Moksa');
      expect(answer).not.toContain('%\n\n%'); // no unformatted gaps
      expect(answer.length).toBeGreaterThan(30);
    });
  });
});
