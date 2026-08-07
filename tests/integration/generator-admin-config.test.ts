import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { buildApp } from '../../src/app';
import { LLMResponseGenerator } from '../../src/integrations/llm/generator';

vi.mock('axios');

describe('End-to-End: Admin PATCH Config -> LLMResponseGenerator', () => {
  let app: any;
  let generator: LLMResponseGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    process.env.LLM_API_KEY = 'sk-test';
    app = buildApp();
    generator = new LLMResponseGenerator();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mengubah config via API harus berdampak langsung pada payload generator', async () => {
    // 1. Panggil endpoint admin untuk mengubah config CHAT_REPLY
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/ai-models/CHAT_REPLY',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { provider: 'OpenAI', modelName: 'gpt-4o-tester' },
    });
    
    expect(response.statusCode).toBe(200);

    // 2. Setup mock axios
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({ reasoning: 'test', needs_clarification: false, answer: 'test' })
          }
        }]
      }
    } as any);

    // 3. Generate response
    await generator.generateFaqResponse('Test', [], 'conv-1', 'tenant-1');

    // 4. Assert axios dipanggil dengan model baru (dari endpoint admin, bukan fallback)
    expect(axios.post).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(axios.post).mock.calls[0][1] as any;
    expect(payload.model).toBe('gpt-4o-tester');
  });
});
