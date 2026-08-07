import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { LLMResponseGenerator } from '../../src/integrations/llm/generator';
import { faqCacheService } from '../../src/services/faq-cache.service';
import { messageService } from '../../src/services/message.service';
import { customerService } from '../../src/services/customer.service';
import { Direction } from '@prisma/client';

vi.mock('axios');

describe('FAQ Cache Service & Security Skip Rules', () => {
  let generator: LLMResponseGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_API_KEY = 'sk-test-faq-cache';
    faqCacheService.clearMemoryCache();
    generator = new LLMResponseGenerator();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Pertanyaan generik tanpa history/customerId/anaphora: MISS pertama kali (LLM dipanggil), HIT kedua kali (LLM 1x)', async () => {
    const question = 'Jam berapa operasional klinik?';
    const mockAnswer = 'Klinik kami buka setiap hari jam 08.00 - 20.00 WIB ya Bunda 😊';

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: 'Customer menanyakan jam buka operasional.',
              answer: mockAnswer,
            })
          }
        }]
      }
    } as any);

    // Call 1: Cache MISS -> axios.post dipanggil
    const res1 = await generator.generateFaqResponse(question, [], undefined, 'tenant-cache-1');
    expect(res1).toContain('08.00 - 20.00');
    expect(axios.post).toHaveBeenCalledTimes(1);

    // Call 2: Cache HIT -> axios.post TIDAK dipanggil lagi (tetap 1x)
    const res2 = await generator.generateFaqResponse(question, [], undefined, 'tenant-cache-1');
    expect(res2).toContain('08.00 - 20.00');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('2. Pertanyaan sama tapi conversationId punya historyMessages: Cache SKIPPED (LLM dipanggil tiap kali)', async () => {
    const question = 'Jam berapa operasional klinik?';
    const mockAnswer = 'Klinik buka jam 8 pagi Bunda 😊';

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: 'Multi-turn history',
              answer: mockAnswer,
            })
          }
        }]
      }
    } as any);

    // Mock historyMessages untuk conv-history-1
    vi.spyOn(messageService, 'getRecentMessages').mockResolvedValue([
      { direction: Direction.INBOUND, content: 'Halo' },
      { direction: Direction.OUTBOUND, content: 'Halo Bunda!' }
    ] as any);

    // Call 1: มี history -> SKIPPED
    await generator.generateFaqResponse(question, [], 'conv-history-1', 'tenant-cache-2');
    expect(axios.post).toHaveBeenCalledTimes(1);

    // Call 2: ada history lagi -> SKIPPED (LLM dipanggil lagi = 2x)
    await generator.generateFaqResponse(question, [], 'conv-history-1', 'tenant-cache-2');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('3. Pertanyaan sama tapi customerId dengan ground truth berisi data: Cache SKIPPED', async () => {
    const question = 'Treatment apa yang cocok?';
    const mockAnswer = 'Untuk Bunda dengan riwayat pijat hamil, kami sarankan paket nifas 😊';

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: 'Customer punya ground truth',
              answer: mockAnswer,
            })
          }
        }]
      }
    } as any);

    vi.spyOn(customerService, 'getCustomerGroundTruth').mockResolvedValue({
      name: 'Bunda Rina',
      activeServices: [],
      historicalServices: ['Pijat Hamil Trimester 3'],
    });

    await generator.generateFaqResponse(question, [], undefined, 'tenant-cache-3', undefined, 'cust-gt-1');
    expect(axios.post).toHaveBeenCalledTimes(1);

    await generator.generateFaqResponse(question, [], undefined, 'tenant-cache-3', undefined, 'cust-gt-1');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('4. Pertanyaan mengandung kata referensial ("berapa itu"): Cache SKIPPED', async () => {
    const question = 'Kalau yang itu berapa itu bund?';
    const mockAnswer = 'Harganya 150rb ya Bunda 😊';

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: 'Anaphora referential query',
              answer: mockAnswer,
            })
          }
        }]
      }
    } as any);

    await generator.generateFaqResponse(question, [], undefined, 'tenant-cache-4');
    expect(axios.post).toHaveBeenCalledTimes(1);

    await generator.generateFaqResponse(question, [], undefined, 'tenant-cache-4');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('5. invalidateAll dipanggil: entry lama untuk tenant tersebut dihapus dari cache', async () => {
    const question = 'Dimana lokasi klinik?';
    const mockAnswer = 'Klinik kami di Surabaya ya Bunda 😊';

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: 'Lokasi query',
              answer: mockAnswer,
            })
          }
        }]
      }
    } as any);

    // Populate cache
    await generator.generateFaqResponse(question, [], undefined, 'tenant-inv-1');
    expect(axios.post).toHaveBeenCalledTimes(1);

    // Invalidate
    await faqCacheService.invalidateAll('tenant-inv-1');

    // Call lagi -> Cache MISS lagi karena sudah di-invalidate (LLM dipanggil = 2x)
    await generator.generateFaqResponse(question, [], undefined, 'tenant-inv-1');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('6. Fallback in-memory: dapat menyimpan, mengambil, dan invalidate tanpa Redis (offline resilience)', async () => {
    const key = 'faq:tenant-test:hash123';
    const val = 'Jawaban FAQ In-Memory';

    await faqCacheService.set(key, val, 60);
    const retrieved = await faqCacheService.get(key);
    expect(retrieved).toBe(val);

    await faqCacheService.invalidateAll('tenant-test');
    const afterInvalidate = await faqCacheService.get(key);
    expect(afterInvalidate).toBeNull();
  });
});
