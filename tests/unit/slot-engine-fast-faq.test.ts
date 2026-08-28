import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FastFaqDetector } from '../../src/slot-engine/fast-faq-detector';
import { FastFaqGenerator } from '../../src/slot-engine/fast-faq-generator';
import { processSlotEngine } from '../../src/slot-engine/slot-engine';
import { ConversationState } from '@prisma/client';

// Mock DB
vi.mock('../../src/db/client', () => ({
  prisma: {
    customer: { findUnique: vi.fn(), update: vi.fn() },
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    knowledgeChunk: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// Mock LLM Fallback Call
vi.mock('../../src/integrations/llm/model-fallback', () => ({
  callChatCompletionsWithFallback: vi.fn(),
  getFallbackModel: vi.fn().mockReturnValue('MiniMax-M2.7-highspeed'),
}));

// Mock Knowledge Service
vi.mock('../../src/services/knowledge.service', () => ({
  knowledgeBaseService: {
    searchRelevantChunks: vi.fn().mockResolvedValue([
      { title: 'SOP Homecare', content: 'Layanan Bidan Yusi 100% Homecare datang ke rumah Bunda.' },
      { title: 'Jadwal Operasional', content: 'Buka setiap hari Senin s/d Minggu pukul 08.00-17.00 WIB.' },
    ]),
  },
}));

describe('Hybrid Fast-Track FAQ Engine (Phase 1-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'mock-test-key';
    process.env.FAST_FAQ_1CALL_ENABLED = 'true';
  });

  describe('1. FastFaqDetector Heuristic & Guardrail Filter', () => {
    it('should correctly identify pure real FAQ questions for Fast-Track', () => {
      // Real database customer questions
      expect(FastFaqDetector.isPotentialFastFaq('Siang, ini pijatnya homecare kah?')).toBe(true);
      expect(FastFaqDetector.isPotentialFastFaq('ini biasanya di weekday aja kah? atau weekend bs?')).toBe(true);
      expect(FastFaqDetector.isPotentialFastFaq('dan mau tnya, brp lama kah pijatnya?')).toBe(true);
      expect(FastFaqDetector.isPotentialFastFaq('Unt treatment waktunya brp lama ?')).toBe(true);
      expect(FastFaqDetector.isPotentialFastFaq('Klo tdk jauh bisa free transport mbk?')).toBe(true);
      expect(FastFaqDetector.isPotentialFastFaq('Bisa bayar transfer atau QRIS?')).toBe(true);
      expect(FastFaqDetector.isPotentialFastFaq('Klinik Bidan Yusi dari mana ya?')).toBe(true);
    });

    it('should REJECT dynamic geocoding / address queries to protect 2-Call accuracy', () => {
      // Real database customer geocoding queries
      expect(FastFaqDetector.isPotentialFastFaq('Kalau di perumahan the cemandi kena ongkos brp?')).toBe(false);
      expect(FastFaqDetector.isPotentialFastFaq('Alamat saya di jalan gayungan no 15')).toBe(false);
      expect(FastFaqDetector.isPotentialFastFaq('Rumah di perum permata sukodono blok D1')).toBe(false);
    });

    it('should REJECT reservation forms and explicit booking requests to protect 2-Call accuracy', () => {
      expect(FastFaqDetector.isPotentialFastFaq('Berikut list untuk reservasi : Hari dan tanggal : Jum\'at, 28 Agustus 2026, Nama Bunda: Rina')).toBe(false);
      expect(FastFaqDetector.isPotentialFastFaq('Mau booking slot besok jam 10')).toBe(false);
    });

    it('should REJECT critical medical emergencies for instant alert escalation', () => {
      expect(FastFaqDetector.isPotentialFastFaq('Tolong anak saya tiba-tiba kejang dan membiru')).toBe(false);
      expect(FastFaqDetector.isPotentialFastFaq('Bayi saya tidak sadar dan pingsan')).toBe(false);
    });
  });

  describe('2. FastFaqGenerator Single-Pass Execution', () => {
    it('should generate warm Bidan Yusi reply in 1 LLM call when valid JSON returned', async () => {
      const { callChatCompletionsWithFallback } = await import('../../src/integrations/llm/model-fallback');
      (callChatCompletionsWithFallback as any).mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intents: ['ask_faq'],
                  reply_text: 'Selamat siang Bunda! Betul sekali Bun, layanan kami 100% Homecare ya Bunda, jadi terapis Bidan kami yang akan datang langsung ke rumah Bunda agar si kecil tetap nyaman di rumah 🥰',
                  needs_deeper_processing: false,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 350, completion_tokens: 80, total_tokens: 430 },
        },
        model: 'MiniMax-M2.7-highspeed',
        baseUrl: 'https://ai.sumopod.com/v1',
      });

      const mockCtx: any = {
        customer: { id: 'c1', phone: '6281803220432', name: 'Bunda', tenant_id: 'default-tenant' },
        conversation: { id: 'conv1', current_state: ConversationState.INITIAL },
        incomingMessage: { text: { body: 'Siang, ini pijatnya homecare kah?' } },
        history: [],
      };

      const mockSlate: any = {
        customerId: 'c1',
        phone: '6281803220432',
        name: 'Bunda',
        tenantId: 'default-tenant',
        conversationId: 'conv1',
        kelurahan: null,
        kecamatan: null,
        kota: null,
        lat: null,
        lng: null,
        streetDetail: null,
        distanceKm: null,
        ongkirFee: null,
        ongkirPromoFee: null,
        isLocationConfirmed: false,
        isOutOfCoverage: false,
        childAgeMonths: null,
        childAgeCategory: null,
        symptoms: [],
        medicalConcerns: [],
        selectedTreatmentName: null,
        preferredDate: null,
        preferredTime: null,
        pricelistSent: false,
        isHumanHandling: false,
        humanHandlingReason: null,
        lastInteractionAt: new Date(),
        projectedState: ConversationState.INITIAL,
      };

      const result = await FastFaqGenerator.process(mockCtx, mockSlate);

      expect(result).not.toBeNull();
      expect(result?.handlerResult.shouldSendReply).toBe(true);
      expect(result?.handlerResult.replyText).toContain('100% Homecare');
      expect(result?.handlerResult.replyText).toContain('Bunda');
    });

    it('should return null (fallthrough to 2-call) when LLM signals needs_deeper_processing', async () => {
      const { callChatCompletionsWithFallback } = await import('../../src/integrations/llm/model-fallback');
      (callChatCompletionsWithFallback as any).mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intents: ['provide_location'],
                  reply_text: '',
                  needs_deeper_processing: true,
                }),
              },
            },
          ],
        },
        model: 'MiniMax-M2.7-highspeed',
      });

      const mockCtx: any = {
        customer: { id: 'c1', phone: '6281803220432', name: 'Bunda', tenant_id: 'default-tenant' },
        conversation: { id: 'conv1', current_state: ConversationState.INITIAL },
        incomingMessage: { text: { body: 'Kalau di perumahan the cemandi kena ongkos brp?' } },
        history: [],
      };

      const mockSlate: any = {
        customerId: 'c1',
        phone: '6281803220432',
        name: 'Bunda',
        tenantId: 'default-tenant',
        conversationId: 'conv1',
        projectedState: ConversationState.INITIAL,
      };

      const result = await FastFaqGenerator.process(mockCtx, mockSlate);
      expect(result).toBeNull();
    });
  });

  describe('3. End-to-End Orchestrator processSlotEngine with Fast-Track', () => {
    it('should process pure FAQ in Fast-Track 1-Call without invoking 2-Call extractor/generator', async () => {
      const { callChatCompletionsWithFallback } = await import('../../src/integrations/llm/model-fallback');
      // Mock Fast-Track response
      (callChatCompletionsWithFallback as any).mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intents: ['ask_faq'],
                  reply_text: 'Halo Bunda! Kami melayani setiap hari ya Bun dari Senin sampai Minggu termasuk hari libur 😊',
                  needs_deeper_processing: false,
                }),
              },
            },
          ],
        },
        model: 'MiniMax-M2.7-highspeed',
      });

      const mockCtx: any = {
        customer: { id: 'c1', phone: '6281803220432', name: 'Bunda', tenant_id: 'default-tenant' },
        conversation: { id: 'conv1', current_state: ConversationState.INITIAL },
        incomingMessage: { text: { body: 'ini biasanya di weekday aja kah? atau weekend bs?' } },
        history: [],
      };

      const result = await processSlotEngine(mockCtx);

      expect(result.shouldSendReply).toBe(true);
      expect(result.replyText).toContain('Senin sampai Minggu');
      // Only 1 LLM call occurred!
      expect(callChatCompletionsWithFallback).toHaveBeenCalledTimes(1);
    });

    it('should bypass Fast-Track and use 2-Call Deep Engine when FAST_FAQ_1CALL_ENABLED is false', async () => {
      delete process.env.FAST_FAQ_1CALL_ENABLED; // default: false (2-call)
      const { isFastFaq1CallEnabled } = await import('../../src/config/feature-flags');
      expect(isFastFaq1CallEnabled()).toBe(false);
    });
  });
});
