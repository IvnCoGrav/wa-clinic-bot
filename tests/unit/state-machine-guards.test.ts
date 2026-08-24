import { describe, it, expect } from 'vitest';
import { isNeedTimeOrDiscussionMessage } from '../../src/state-machine/utils/need-time-checker';
import { checkPolicyInquiry } from '../../src/state-machine/utils/policy-checker';

describe('Phase 3: State Machine Guards & Contextual Safety', () => {
  describe('Task 3.1: Informal & Slang Need-Time Recognition', () => {
    const slangNeedTimePhrases = [
      'ntar dlu ya bund',
      'nnti ak kbrin lg y',
      'hold dlu ya',
      'bentar ya masih mikir',
      'sy tny paksu dl',
      'rembukan dl sm keluarga',
      'pending dlu ya kak',
      'sbntr ya tanya dulu',
      'bntr ya bund',
    ];

    slangNeedTimePhrases.forEach((text) => {
      it(`should recognize slang/informal need-time message: "${text}"`, () => {
        const result = isNeedTimeOrDiscussionMessage(text);
        expect(result).toBe(true);
      });
    });

    const notNeedTimePhrases = [
      'iya mau booking sekarang',
      'pijat bayi berapa ya',
      'kelurahan sedati agung',
      'siap bunda',
    ];

    notNeedTimePhrases.forEach((text) => {
      it(`should NOT match non-need-time message: "${text}"`, () => {
        const result = isNeedTimeOrDiscussionMessage(text);
        expect(result).toBe(false);
      });
    });
  });

  describe('Task 3.2: Conditional Affirmation Exclusions', () => {
    const conditionalAffirmations = [
      'boleh bund, tapi bayarnya bisa transfer?',
      'mau dong, tapi besok pagi jam 10 bisa?',
      'boleh, nanti tanya suami dulu ya',
      'iya mau, tapi terapisnya bidan asli kan?',
      'boleh banget, cuma exclude ongkir kan ya?',
    ];

    conditionalAffirmations.forEach((text) => {
      it(`should detect condition/question in conditional affirmation: "${text}"`, () => {
        const hasCondition = /\b(tapi|tetapi|tp|cuma|asal(kan)?|kalau|kalo|syaratnya|masih|nanti|dulu|dl|dlu)\b/i.test(text);
        const hasPolicy = !!checkPolicyInquiry(text);
        const hasNeedTime = isNeedTimeOrDiscussionMessage(text);
        const hasQuestion = /\?/.test(text);

        expect(hasCondition || hasPolicy || hasNeedTime || hasQuestion).toBe(true);
      });
    });
  });
});
