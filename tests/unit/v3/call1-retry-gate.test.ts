import { describe, it, expect } from 'vitest';
import { shouldRetryCall1, MAX_CALL1_RETRIES } from '../../../src/v3/agent/pipeline/generation-stage';

/**
 * Fase 2 (insiden Waru 6281390541340): retry Call 1 TEPAT 1x saat degenerasi
 * netra (stream terpotong + DSML + nol tool valid). Turn sehat tidak memicu.
 */
describe('Fase 2 — gate retry Call 1 (degenerasi)', () => {
  it('konstanta retry dibatasi 1 (anti infinite loop)', () => {
    expect(MAX_CALL1_RETRIES).toBe(1);
  });

  it('degenerasi nyata (finish=length, DSML, nol tool) → retry', () => {
    expect(shouldRetryCall1({
      finishReason: 'length', completionTokens: 2048, maxTokens: 2048,
      parsedCount: 0, hasDsml: true,
    })).toBe(true);
  });

  it('completion menyentuh plafon walau finish bukan length → retry', () => {
    expect(shouldRetryCall1({
      finishReason: 'stop', completionTokens: 2035, maxTokens: 2048,
      parsedCount: 0, hasDsml: true,
    })).toBe(true);
  });

  it('sukses normal (tool terparse) → JANGAN retry', () => {
    expect(shouldRetryCall1({
      finishReason: 'tool_calls', completionTokens: 62, maxTokens: 2048,
      parsedCount: 1, hasDsml: false,
    })).toBe(false);
  });

  it('kosong tanpa DSML (mis. direct reply) → JANGAN retry', () => {
    expect(shouldRetryCall1({
      finishReason: 'stop', completionTokens: 300, maxTokens: 2048,
      parsedCount: 0, hasDsml: false,
    })).toBe(false);
  });

  it('di bawah plafon & finish stop & DSML tapi ada tool → JANGAN retry', () => {
    expect(shouldRetryCall1({
      finishReason: 'stop', completionTokens: 100, maxTokens: 2048,
      parsedCount: 1, hasDsml: true,
    })).toBe(false);
  });

  it('boundary plafon: 2031 (< max-16) tanpa finish length → JANGAN retry', () => {
    expect(shouldRetryCall1({
      finishReason: 'stop', completionTokens: 2031, maxTokens: 2048,
      parsedCount: 0, hasDsml: true,
    })).toBe(false);
  });
});
