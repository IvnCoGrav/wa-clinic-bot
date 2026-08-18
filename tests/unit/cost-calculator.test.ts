import { describe, it, expect } from 'vitest';
import { calculateLlmCost, deriveProvider } from '../../src/utils/cost-calculator';

describe('Cost Calculator Unit Tests — Updated 2026 Provider Pricing', () => {
  it('should calculate accurate cost for primary model qwen3.7-flash-2026-07-15', () => {
    // 10,000 prompt tokens (8,000 cached, 2,000 miss), 1,000 completion tokens
    // Miss: 2k * ($0.03/1000 * 18000) = 2 * 540 = 1080 / 1000 * 2 = Rp 1.08
    // Hit: 8k * ($0.006/1000 * 18000) = 8 * 108 = 864 / 1000 * 8 = Rp 0.864
    // Output: 1k * ($0.13/1000 * 18000) = 1 * 2340 = Rp 2.34
    const result = calculateLlmCost('qwen3.7-flash-2026-07-15', 10000, 1000, 8000);
    expect(result.provider).toBe('Alibaba Qwen');
    expect(result.totalCostIdr).toBeGreaterThan(0);
    expect(result.promptCostIdr).toBe(1.944);
    expect(result.completionCostIdr).toBe(2.34);
    expect(result.totalCostIdr).toBe(4.284);
  });

  it('should calculate accurate cost for fallback model gpt-5-nano', () => {
    // 5,000 prompt tokens (4,000 cached, 1,000 miss), 500 completion tokens
    // Miss: 1k * ($0.05/1000 * 18000) = Rp 0.90
    // Hit: 4k * ($0.005/1000 * 18000) = 4 * Rp 0.09 = Rp 0.36
    // Output: 0.5k * ($0.40/1000 * 18000) = 0.5 * Rp 7.20 = Rp 3.60
    const result = calculateLlmCost('gpt-5-nano', 5000, 500, 4000);
    expect(result.provider).toBe('OpenAI');
    expect(result.promptCostIdr).toBe(1.26);
    expect(result.completionCostIdr).toBe(3.6);
    expect(result.totalCostIdr).toBe(4.86);
  });

  it('should calculate accurate cost for deepseek-chat (DeepSeek Direct)', () => {
    const result = calculateLlmCost('deepseek-chat', 10000, 1000, 8000);
    expect(result.provider).toBe('DeepSeek Direct');
    expect(result.totalCostIdr).toBeGreaterThan(0);
  });

  it('should calculate accurate cost for embedding models with 0 completion cost', () => {
    const smallResult = calculateLlmCost('text-embedding-3-small', 10000, 0);
    expect(smallResult.provider).toBe('OpenAI');
    expect(smallResult.completionCostIdr).toBe(0);
    // 10k * ($0.02/1000 * 18000) = 10 * 360 / 1000 = Rp 3.6
    expect(smallResult.totalCostIdr).toBe(3.6);

    const largeResult = calculateLlmCost('text-embedding-3-large', 10000, 0);
    expect(largeResult.totalCostIdr).toBe(23.4);

    const geminiResult = calculateLlmCost('gemini-embedding-001', 10000, 0);
    expect(geminiResult.totalCostIdr).toBe(27);
  });

  it('should accurately derive providers from base URLs', () => {
    expect(deriveProvider('https://ai.sumopod.com/v1')).toBe('SumoPod');
    expect(deriveProvider('https://api.deepseek.com/v1')).toBe('DeepSeek Direct');
    expect(deriveProvider('https://api.deepseek.com')).toBe('DeepSeek Direct');
    expect(deriveProvider('https://api.openai.com/v1')).toBe('OpenAI');
  });
});
