import { describe, it, expect } from 'vitest';
import { AiModelConfigService, isRuntimeLlmProvider } from '../../src/config/ai-models.config';

/** CFG-12: hanya provider yang benar-benar diproses runtime yang boleh disimpan. */
describe('AI provider runtime validation (CFG-12)', () => {
  it('hanya Kenari/SumoPod yang dianggap provider runtime', () => {
    expect(isRuntimeLlmProvider('Kenari')).toBe(true);
    expect(isRuntimeLlmProvider('sumopod')).toBe(true);
    expect(isRuntimeLlmProvider('OpenAI')).toBe(false);
    expect(isRuntimeLlmProvider('DeepSeek')).toBe(false);
    expect(isRuntimeLlmProvider(undefined)).toBe(false);
  });

  it('updateTaskConfig menolak provider katalog yang tidak punya adapter', () => {
    expect(() =>
      AiModelConfigService.updateTaskConfig('CHAT_REPLY', { provider: 'OpenAI' }, 'tenant-cfg12', { persist: false })
    ).toThrow(/INVALID_PROVIDER/);
  });

  it('provider runtime tetap diterima', () => {
    expect(() =>
      AiModelConfigService.updateTaskConfig(
        'CHAT_REPLY',
        { provider: 'Kenari', modelName: 'deepseek-v4-flash' },
        'tenant-cfg12',
        { persist: false }
      )
    ).not.toThrow();
  });
});
