import { describe, it, expect } from 'vitest';
import { supportsThinkingParam, AiModelConfigService } from '../../../src/config/ai-models.config';
import { extractReasoningAndCleanContent } from '../../../src/v3/agent/pipeline/generation-stage';
import { DEFAULT_TENANT_ID } from '../../../src/config/tenant';

/**
 * Insiden latensi 24,8 dtk (12/10/2026): Call 2 ke glm-5.3-flash tidak membawa
 * `thinking: { type: 'disabled' }` sehingga ±1.022 token habis untuk reasoning
 * internal. Fase 2 mematikan reasoning di Call 2 memakai gate kapabilitas yang
 * sama seperti Call 1. Test ini mengunci DUA kontrak:
 *  1. Gate: flag thinking HANYA untuk GLM (termasuk via config CHAT_REPLY),
 *     TIDAK untuk DeepSeek/OpenAI-compatible (anti-regresi Wonokusumo 03/10).
 *  2. Bentuk respons GLM saat thinking mati (plain content tanpa kanal
 *     reasoning) WAJIB lolos sebagai balasan tak-kosong — mematikan reasoning
 *     tidak boleh menghasilkan balasan kosong.
 */
describe('Call 2 thinking.disabled (insiden 12/10/2026)', () => {
  it('config CHAT_REPLY default (GLM) lolos gate thinking', () => {
    const cfg = AiModelConfigService.getModelConfig('CHAT_REPLY', DEFAULT_TENANT_ID);
    expect(supportsThinkingParam(cfg.provider, cfg.modelName)).toBe(true);
  });

  it('model DeepSeek/OpenAI-compatible tetap DILARANG menerima flag di Call 2', () => {
    expect(supportsThinkingParam('SumoPod', 'deepseek-v4-flash-0731:netra')).toBe(false);
    expect(supportsThinkingParam('Kenari', 'deepseek-v4-1-flash')).toBe(false);
    expect(supportsThinkingParam('SumoPod', 'qwen3.7-flash-2026-07-15')).toBe(false);
    expect(supportsThinkingParam('SumoPod', 'gpt-4o-mini')).toBe(false);
  });

  // Ragam parafrase nyata balasan Bidan (multi-phrasing, bukan satu kalimat hafalan).
  it.each([
    'Halo Bunda! Perkenalkan, saya Bidan Yusi dari Kala.',
    'Baik Bunda, untuk keluhan kembung pada newborn kami sarankan Pijat Pulih Ceria ya.',
    'Siap Bunda, jadwal besok pagi masih tersedia. Mau kami bantu booking?',
    'Sama-sama Bunda! Kabari kami lagi ya kalau ada keluhan lain.',
    'Bunda tinggal di daerah mana ya? Biar kami hitungkan ongkirnya.',
  ])('respons plain tanpa kanal reasoning lolos utuh & tak-kosong: "%s"', (text) => {
    const { reasoning, cleanContent } = extractReasoningAndCleanContent({ content: text });
    expect(reasoning).toBeNull();
    expect(cleanContent).toBe(text);
    expect(cleanContent.trim().length).toBeGreaterThan(0);
  });
});
