import { describe, it, expect } from 'vitest';
import { sanitizeModelForProvider } from '../../src/config/ai-models.config';

describe('sanitizeModelForProvider — pencegahan mismatch provider/model (Kenari)', () => {
  it('meremap model native OpenAI ke default Kenari saat baseUrl kenari.id', () => {
    expect(sanitizeModelForProvider('gpt-4o-mini', 'https://kenari.id/v1')).toBe('deepseek-v4-1-flash');
    expect(sanitizeModelForProvider('gpt-4o', 'https://kenari.id/v1')).toBe('deepseek-v4-1-flash');
    expect(sanitizeModelForProvider('o1-mini', 'https://kenari.id/v1')).toBe('deepseek-v4-1-flash');
    expect(sanitizeModelForProvider('o3-mini', 'https://kenari.id/v1')).toBe('deepseek-v4-1-flash');
  });

  it('mempertahankan model Kenari yang valid (tidak over-remap)', () => {
    expect(sanitizeModelForProvider('deepseek-v4-1-flash', 'https://kenari.id/v1')).toBe('deepseek-v4-1-flash');
    expect(sanitizeModelForProvider('gemini-2-5-flash-lite', 'https://kenari.id/v1')).toBe('gemini-2-5-flash-lite');
    expect(sanitizeModelForProvider('muse-spark-1-3-contributor', 'https://kenari.id/v1')).toBe('muse-spark-1-3-contributor');
  });

  it('case-insensitive terhadap host Kenari (KENARI.ID / variasi)', () => {
    expect(sanitizeModelForProvider('gpt-4o-mini', 'https://KENARI.ID/v1')).toBe('deepseek-v4-1-flash');
  });

  it('tidak meremap bila baseUrl bukan Kenari (mis. OpenAI asli)', () => {
    expect(sanitizeModelForProvider('gpt-4o-mini', 'https://api.openai.com/v1')).toBe('gpt-4o-mini');
  });

  it('aturan OpenAI asli tetap utuh: model non-OpenAI dipaksa gpt-4o-mini', () => {
    expect(sanitizeModelForProvider('deepseek-v4-1-flash', 'https://api.openai.com/v1')).toBe('gpt-4o-mini');
  });

  it('model kosong → default aman (provider-aware)', () => {
    expect(sanitizeModelForProvider('', 'https://kenari.id/v1')).toBe('deepseek-v4-1-flash');
    expect(sanitizeModelForProvider('', 'https://ai.sumopod.com/v1')).toBe('MiniMax-M2.7-highspeed');
    expect(sanitizeModelForProvider('', 'https://api.openai.com/v1')).toBe('gpt-4o-mini');
  });

  it('SumoPod: model DeepSeek legacy/asing di-remap ke model SumoPod kanonik', () => {
    expect(sanitizeModelForProvider('deepseek-v4-1-flash', 'https://ai.sumopod.com/v1')).toBe('deepseek-v4-flash');
    expect(sanitizeModelForProvider('deepseek-chat', 'https://ai.sumopod.com/v1')).toBe('deepseek-v4-flash');
    expect(sanitizeModelForProvider('gpt-4o', 'https://ai.sumopod.com/v1')).toBe('MiniMax-M2.7-highspeed');
  });

  it('DeepSeek Direct: model DeepSeek legacy di-remap ke model Direct kanonik', () => {
    expect(sanitizeModelForProvider('deepseek-v4-1-flash', 'https://api.deepseek.com')).toBe('deepseek-chat');
    expect(sanitizeModelForProvider('deepseek-chat', 'https://api.deepseek.com')).toBe('deepseek-chat');
  });

  it('Kenari: model katalog asing di-remap ke model Kenari kanonik (anti-400)', () => {
    expect(sanitizeModelForProvider('MiniMax-M2.7-highspeed', 'https://kenari.id/v1')).toBe('deepseek-v4-1-flash');
    expect(sanitizeModelForProvider('gpt-4o-mini', 'https://kenari.id/v1')).toBe('deepseek-v4-1-flash');
  });
});
