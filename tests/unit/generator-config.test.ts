import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { LLMResponseGenerator } from '../../src/integrations/llm/generator';
import { AiModelConfigService } from '../../src/config/ai-models.config';

vi.mock('axios');

describe('LLMResponseGenerator - AiModelConfigService Integration', () => {
  const generator = new LLMResponseGenerator();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_API_KEY = 'sk-test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('harus mengirim payload ke axios sesuai dengan config dari AiModelConfigService untuk CHAT_REPLY', async () => {
    // 1. Setup mock AiModelConfigService
    vi.spyOn(AiModelConfigService, 'getModelConfig').mockReturnValue({
      task: 'CHAT_REPLY',
      provider: 'OpenAI',
      modelName: 'custom-model-123',
      temperature: 0.85,
      maxTokens: 500
    });

    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: 'test',
              needs_clarification: false,
              answer: 'Test Answer'
            })
          }
        }]
      }
    } as any);

    // 2. Eksekusi
    await generator.generateFaqResponse('Test question', [], 'conv-test', 'tenant-test');

    // 3. Verifikasi axios.post payload
    expect(axios.post).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(axios.post).mock.calls[0][1] as any;

    expect(payload.model).toBe('custom-model-123');
    expect(payload.temperature).toBe(0.85);
    expect(payload.max_tokens).toBe(500);
    expect(payload.response_format).toEqual({ type: 'json_object' });
  });

  it('regresi: tanpa mock khusus, harus menggunakan default config (deepseek-v4-flash)', async () => {
    // Hapus spyOn agar memanggil fungsi aslinya
    vi.restoreAllMocks();
    
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              reasoning: 'test',
              needs_clarification: false,
              answer: 'Default Answer'
            })
          }
        }]
      }
    } as any);

    await generator.generateFaqResponse('Test question', [], 'conv-test', 'tenant-test');

    expect(axios.post).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(axios.post).mock.calls[0][1] as any;

    // Pastikan default behavior dari AiModelConfigService untuk CHAT_REPLY
    const defaultModel = AiModelConfigService.getModelConfig('CHAT_REPLY').modelName;
    expect(payload.model).toBe(defaultModel);
    expect(payload.temperature).toBe(0.6);
    expect(payload.max_tokens).toBe(1024);
  });
});
