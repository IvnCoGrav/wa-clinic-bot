import { describe, it, expect } from 'vitest';

describe('Question Override Guard Unit Tests', () => {
  it('should detect question signals in "Saya ingin tanya untuk pijat bayi min. di usia brp ya?"', () => {
    const userText = 'Selamat sore. Saya ingin tanya untuk pijat bayi min. di usia brp ya?';
    const isQuestionMessage = /\?/.test(userText) || /\b(tanya|bertanya|berapa|brp|apakah|bagaimana|kapan|dimana|usia|umur)\b/i.test(userText);
    expect(isQuestionMessage).toBe(true);
  });

  it('should not mark pure affirmation as question', () => {
    const userText = 'Iya saya mau booking hari senin';
    const isQuestionMessage = /\?/.test(userText) || /\b(tanya|bertanya|berapa|brp|apakah|bagaimana|kapan|dimana|usia|umur)\b/i.test(userText);
    expect(isQuestionMessage).toBe(false);
  });
});
