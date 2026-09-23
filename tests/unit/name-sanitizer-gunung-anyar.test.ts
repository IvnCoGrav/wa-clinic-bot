import { describe, it, expect } from 'vitest';
import { sanitizeCustomerNameForGreeting, formatGreetingBunda } from '../../src/utils/name-sanitizer';

/**
 * MT-1.5 + MT-3.3 — Kasus Bunda Mutia "gunung anyar" (CONFIRMED district missing).
 * Sebelum fix: "Bunda Mutia gunung anyar Gubeng" → "Mutia gunung" (sisa token).
 * Sesudah fix: → "Mutia" (Gubeng + gunung anyar ter-strip).
 */
describe('Name Sanitizer — gunung anyar (Bunda Mutia / Bunda Devia)', () => {
  it('Bunda Mutia gunung anyar Gubeng → Mutia (greeting Bunda Mutia)', () => {
    const clean = sanitizeCustomerNameForGreeting('Bunda Mutia gunung anyar Gubeng');
    expect(clean).toBe('Mutia');
    expect(formatGreetingBunda(clean)).toBe('Bunda Mutia');
  });

  it('Bunda Mutia Gunung Anyar Tambak → Mutia (paling spesifik dulu)', () => {
    expect(sanitizeCustomerNameForGreeting('Bunda Mutia Gunung Anyar Tambak')).toBe('Mutia');
  });

  it('gunung anyar tanpa Gubeng juga ter-strip', () => {
    expect(sanitizeCustomerNameForGreeting('Bunda Mutia gunung anyar')).toBe('Mutia');
    expect(sanitizeCustomerNameForGreeting('Mutia gunung anyar')).toBe('Mutia');
  });

  it('Bunda Devia Babatan Wiyung → Devia (kontrol, tidak regresi)', () => {
    const clean = sanitizeCustomerNameForGreeting('Bunda Devia Babatan Wiyung');
    expect(clean).toBe('Devia');
    expect(formatGreetingBunda(clean)).toBe('Bunda Devia');
  });

  it('adversarial: variasi koma, kapital, dan tambahan alamat', () => {
    expect(sanitizeCustomerNameForGreeting('Bunda Mutia, Gunung Anyar')).toBe('Mutia');
    expect(sanitizeCustomerNameForGreeting('Bunda Mutia GUNUNG ANYAR gubeng')).toBe('Mutia');
    expect(sanitizeCustomerNameForGreeting('Bunda Mutia gunung anyar Tambak')).toBe('Mutia');
  });
});
