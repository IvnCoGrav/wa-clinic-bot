import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMResponseGenerator } from '../../src/integrations/llm/generator';
import { prisma } from '../../src/db/client';
import axios from 'axios';

vi.mock('axios');

describe('Customer Memory — Preference Extraction (D2, Tahap 1)', () => {
  const tenantId = 'tenant-test';
  const customerId = 'cust_mem_1';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_API_KEY = 'sk-test-valid-key';
  });

  it('returns extracted_preferences when LLM outputs a non-empty object', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({
      id: customerId,
      tenant_id: tenantId,
      name: 'Bunda Rina',
      phone: '08123456789',
      reservations: [],
      preferences: null,
    } as any);

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                reasoning: 'Customer menyebut fakta anak.',
                answer: 'Baik Bunda, kami paham si kecil berkulit sensitif.',
                extracted_preferences: { child_name: 'Lala', child_age_months: 5, skin_sensitive: true },
              }),
            },
          },
        ],
      },
    } as any);

    const generator = new LLMResponseGenerator();
    const res = await generator.generateFaqResponseWithDetails(
      'Anak saya kulitnya sensitif bund',
      [],
      'conv_1',
      tenantId,
      undefined,
      customerId
    );

    expect(res.extracted_preferences).toEqual({ child_name: 'Lala', child_age_months: 5, skin_sensitive: true });
  });

  it('returns extracted_preferences as undefined when LLM returns empty object', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({
      id: customerId,
      tenant_id: tenantId,
      name: 'Bunda Rina',
      phone: '08123456789',
      reservations: [],
      preferences: null,
    } as any);

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                reasoning: 'Tidak ada fakta permanen baru.',
                answer: 'Jam operasional kami 08.00-20.00.',
                extracted_preferences: {},
              }),
            },
          },
        ],
      },
    } as any);

    const generator = new LLMResponseGenerator();
    const res = await generator.generateFaqResponseWithDetails(
      'jam operasional?',
      [],
      'conv_1',
      tenantId,
      undefined,
      customerId
    );

    expect(res.extracted_preferences).toBeUndefined();
  });

  it('returns undefined extracted_preferences on fallback (empty/no API key)', async () => {
    process.env.LLM_API_KEY = 'mock';
    const generator = new LLMResponseGenerator();
    const res = await generator.generateFaqResponseWithDetails(
      'halo',
      [],
      'conv_1',
      tenantId,
      undefined,
      customerId
    );
    expect(res.answer).toBe('');
    expect(res.usedFallback).toBe(true);
    expect(res.extracted_preferences).toBeUndefined();
  });

  it('injects preferences into GROUND TRUTH section of system prompt', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({
      id: customerId,
      tenant_id: tenantId,
      name: 'Bunda Rina',
      phone: '08123456789',
      reservations: [],
      preferences: { skin_sensitive: true, child_name: 'Lala' },
    } as any);

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                reasoning: 'x',
                answer: 'Baik.',
                extracted_preferences: {},
              }),
            },
          },
        ],
      },
    } as any);

    const generator = new LLMResponseGenerator();
    await generator.generateFaqResponseWithDetails('tanya apa', [], 'conv_1', tenantId, undefined, customerId);

    const mockedPost = vi.mocked(axios.post).mock.calls[0][1] as any;
    const systemPrompt = mockedPost.messages[0].content;
    expect(systemPrompt).toContain('- Preferensi:');
    expect(systemPrompt).toContain('skin_sensitive: true');
    expect(systemPrompt).toContain('child_name: Lala');
  });
});