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
    expect(sanitizeModelForProvider('qwen3-8-flash', 'https://kenari.id/v1')).toBe('qwen3-8-flash');
    expect(sanitizeModelForProvider('minimax-m2-7', 'https://kenari.id/v1')).toBe('minimax-m2-7');
    expect(sanitizeModelForProvider('step-3-7-flash:free', 'https://kenari.id/v1')).toBe('step-3-7-flash:free');
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

  it('model kosong → default aman', () => {
    expect(sanitizeModelForProvider('', 'https://kenari.id/v1')).toBe('deepseek-v4-1-flash');
  });
});
