import { describe, it, expect } from 'vitest';
import { buildInvalidReplyFallback } from '../../src/v3/agent/pipeline/guardrail-pipeline';

/**
 * Regression: Mid-Conversation Greeting Reset — template sapaan pembuka
 * DILARANG muncul di tengah obrolan (isFollowUp=true).
 */
describe('buildInvalidReplyFallback — anti greeting-reset', () => {
  it('Turn-0 boleh memakai greeting pembuka', () => {
    const text = buildInvalidReplyFallback(false, 'Bunda', 'Kala Moms and Baby Spa');
    expect(text).toContain('Terima kasih sudah menghubungi kami');
  });

  it('follow-up DILARANG memakai greeting pembuka', () => {
    const text = buildInvalidReplyFallback(true, 'Bunda', 'Kala Moms and Baby Spa');
    expect(text).not.toContain('Terima kasih sudah menghubungi kami');
    expect(text).toContain('Bunda');
  });

  it('fallback gender greeting bila kosong', () => {
    const text = buildInvalidReplyFallback(true, '', 'Kala Moms and Baby Spa');
    expect(text).toContain('Bunda');
  });
});
