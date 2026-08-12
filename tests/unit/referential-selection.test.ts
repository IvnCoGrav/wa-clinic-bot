import { describe, it, expect } from 'vitest';

describe('Referential Selection Guard Unit Tests', () => {
  const testReferential = (text: string) =>
    /\b(yang\s+(tadi|itu|barusan|pertama|kedua)|itu\s+(aja|saja)|tadi\s+(aja|saja)|yg\s+(tadi|itu|barusan))\b/i.test(text);

  it('should detect "yang tadi saja bunda"', () => {
    expect(testReferential('yang tadi saja bunda')).toBe(true);
  });

  it('should detect "itu aja bund"', () => {
    expect(testReferential('itu aja bund')).toBe(true);
  });

  it('should detect "yg tadi aja"', () => {
    expect(testReferential('yg tadi aja')).toBe(true);
  });

  it('should detect "yang barusan"', () => {
    expect(testReferential('yang barusan')).toBe(true);
  });

  it('should NOT detect pure affirmation "iya boleh"', () => {
    expect(testReferential('iya boleh')).toBe(false);
  });

  it('should NOT detect general question "berapa harganya"', () => {
    expect(testReferential('berapa harganya')).toBe(false);
  });
});
