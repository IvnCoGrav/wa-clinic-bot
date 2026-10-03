import { describe, it, expect } from 'vitest';
import { supportsThinkingParam } from '../../../src/config/ai-models.config';

/**
 * Insiden "Wonokusumo" (2026-10-03): flag `thinking: { type: 'disabled' }`
 * dipasang untuk GLM (Call 1) lalu tertinggal saat router dipindah ke DeepSeek
 * netra. Parameter asing memicu degenerasi grammar → looping DSML hingga token
 * habis → tool call gagal → fallback buntu. Gerbang kapabilitas WAJIB fail-safe:
 * hanya GLM yang boleh menerima flag; sisanya TIDAK.
 */
describe('Call 1 provider-aware capability gate (thinking param)', () => {
  it('mengirim thinking HANYA untuk keluarga GLM', () => {
    expect(supportsThinkingParam('SumoPod', 'glm-5.3-flash')).toBe(true);
    expect(supportsThinkingParam('', 'glm-4.6')).toBe(true);
    expect(supportsThinkingParam('some-glm-provider', '')).toBe(true);
  });

  it('DILARANG mengirim thinking ke DeepSeek netra (akar insiden)', () => {
    expect(supportsThinkingParam('SumoPod', 'deepseek-v4-flash-0731:netra')).toBe(false);
    expect(supportsThinkingParam('Kenari', 'deepseek-v4-1-flash')).toBe(false);
  });

  it('model OpenAI-compatible lain tidak menerima flag (fail-safe)', () => {
    expect(supportsThinkingParam('SumoPod', 'gpt-4o-mini')).toBe(false);
    expect(supportsThinkingParam('SumoPod', 'qwen3.7-flash-2026-07-15')).toBe(false);
    expect(supportsThinkingParam('SumoPod', 'MiniMax-M2.7-highspeed')).toBe(false);
  });

  it('provider/model tak dikenal → default JANGAN kirim (fail-safe)', () => {
    expect(supportsThinkingParam(undefined, undefined)).toBe(false);
    expect(supportsThinkingParam('Internal Engine', 'Regex/Keywords')).toBe(false);
    expect(supportsThinkingParam('', '')).toBe(false);
  });
});
