import { describe, it, expect } from 'vitest';
import { calculateLlmCost, deriveProvider, isDeepSeekPeakHour } from '../../src/utils/cost-calculator';

describe('Cost Calculator Unit Tests — Updated 2026 Provider Pricing & Peak Hours', () => {
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

  it('should calculate accurate flat cost for minimax-m2.7-highspeed', () => {
    // 284 prompt tokens (0 cached), 150 completion tokens
    // Miss: 0.284k * ($0.03/1000 * 18000) = 0.284 * 540 = Rp 0.15336
    // Output: 0.15k * ($0.12/1000 * 18000) = 0.15 * 2160 = Rp 0.324
    const result = calculateLlmCost('minimax-m2.7-highspeed', 284, 150, 0);
    expect(result.provider).toBe('MiniMax');
    expect(result.promptCostIdr).toBe(0.1534);
    expect(result.completionCostIdr).toBe(0.324);
    expect(result.totalCostIdr).toBe(0.4774);
  });

  it('should calculate accurate cost for mimo-v2.5', () => {
    // 10,000 prompt tokens (8,000 cached, 2,000 miss), 1,000 completion tokens
    // Miss: 2k * ($0.14/1000 * 18000) = Rp 5.04
    // Hit: 8k * ($0.003/1000 * 18000) = Rp 0.432
    // Output: 1k * ($0.28/1000 * 18000) = Rp 5.04
    const result = calculateLlmCost('mimo-v2.5', 10000, 1000, 8000);
    expect(result.provider).toBe('Mimo');
    expect(result.promptCostIdr).toBe(5.472);
    expect(result.completionCostIdr).toBe(5.04);
    expect(result.totalCostIdr).toBe(10.512);
  });

  it('should detect DeepSeek Peak Hours correctly (07:30 - 19:30 WIB / 00:30 - 12:30 UTC)', () => {
    // 10:19 AM WIB = 03:19 UTC -> Peak
    const peakDate = new Date('2026-08-24T03:19:00Z');
    expect(isDeepSeekPeakHour(peakDate)).toBe(true);

    // 23:00 PM WIB = 16:00 UTC -> Off-Peak
    const offPeakDate = new Date('2026-08-24T16:00:00Z');
    expect(isDeepSeekPeakHour(offPeakDate)).toBe(false);

    // 07:00 AM WIB = 00:00 UTC -> Off-Peak
    const earlyMorningDate = new Date('2026-08-24T00:00:00Z');
    expect(isDeepSeekPeakHour(earlyMorningDate)).toBe(false);
  });

  it('should calculate accurate cost for deepseek-v4-flash during Peak Hours ($0.44/1M in, $1.32/1M out)', () => {
    // 1,006 prompt tokens (0 cached), 1,500 completion tokens at 10:19 AM WIB (03:19 UTC)
    // Peak Miss: 1.006k * ($0.44/1000 * 18000) = 1.006 * 7920 = Rp 7.96752
    // Peak Output: 1.5k * ($1.32/1000 * 18000) = 1.5 * 23760 = Rp 35.64
    const peakDate = new Date('2026-08-24T03:19:00Z');
    const result = calculateLlmCost('deepseek-v4-flash', 1006, 1500, 0, peakDate);
    expect(result.provider).toBe('DeepSeek');
    expect(result.isPeak).toBe(true);
    expect(result.promptCostIdr).toBe(7.9675);
    expect(result.completionCostIdr).toBe(35.64);
    expect(result.totalCostIdr).toBe(43.6075);
  });

  it('should calculate accurate cost for deepseek-v4-flash during Off-Peak Hours ($0.22/1M in, $0.66/1M out)', () => {
    // 1,006 prompt tokens (0 cached), 1,500 completion tokens at 23:00 WIB (16:00 UTC)
    // Off-Peak Miss: 1.006k * ($0.22/1000 * 18000) = 1.006 * 3960 = Rp 3.98376
    // Off-Peak Output: 1.5k * ($0.66/1000 * 18000) = 1.5 * 11880 = Rp 17.82
    const offPeakDate = new Date('2026-08-24T16:00:00Z');
    const result = calculateLlmCost('deepseek-v4-flash', 1006, 1500, 0, offPeakDate);
    expect(result.provider).toBe('DeepSeek');
    expect(result.isPeak).toBe(false);
    expect(result.promptCostIdr).toBe(3.9838);
    expect(result.completionCostIdr).toBe(17.82);
    expect(result.totalCostIdr).toBe(21.8038);
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

