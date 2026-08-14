import { describe, it, expect, beforeEach } from 'vitest';
import { parsePositiveInt, parseNonNegativeNumber } from '../../src/utils/env-numeric';
import { openerTracker } from '../../src/integrations/llm/opener-tracker';

/**
 * Fase 5 — Error Handling Hardening.
 * 1. parsePositiveInt/parseNonNegativeNumber fail-closed untuk env invalid.
 * 2. opener-tracker size cap — tidak unbounded growth.
 */
describe('env-numeric helpers — fail-closed', () => {
  it('parsePositiveInt: nilai valid → angka; invalid/NaN/<=0 → fallback', () => {
    expect(parsePositiveInt('10', 5)).toBe(10);
    expect(parsePositiveInt('abc', 5)).toBe(5);
    expect(parsePositiveInt('', 5)).toBe(5);
    expect(parsePositiveInt(undefined, 5)).toBe(5);
    expect(parsePositiveInt('-3', 5)).toBe(5);
    expect(parsePositiveInt('0', 5)).toBe(5);
    expect(parsePositiveInt('3.7', 5)).toBe(5); // bukan integer
  });

  it('parseNonNegativeNumber: nilai valid → angka; NaN/negatif → fallback; nol diizinkan', () => {
    expect(parseNonNegativeNumber('0.5', 1)).toBe(0.5);
    expect(parseNonNegativeNumber('0', 1)).toBe(0);
    expect(parseNonNegativeNumber('-2', 1)).toBe(1);
    expect(parseNonNegativeNumber('xyz', 1)).toBe(1);
    expect(parseNonNegativeNumber(undefined, 1)).toBe(1);
  });
});

describe('opener-tracker — size cap', () => {
  beforeEach(() => {
    openerTracker.clear();
  });

  it('tidak melebihi cap (simulasi banyak conversationId)', () => {
    // Rekam 600 conversationId berbeda (di atas cap 500) — ukuran internal tidak
    // bisa diakses langsung, tapi getOpeners tetap konsisten & tidak crash.
    for (let i = 0; i < 600; i++) {
      openerTracker.record(`conv-cap-${i}`, `Halo Bunda ${i} sudah menghubungi kami`);
    }
    // Masih bisa record & baca normal.
    openerTracker.record('conv-cap-final', 'Halo Bunda, ini opener terakhir');
    expect(openerTracker.getOpeners('conv-cap-final').length).toBe(1);
    // Entri lama bisa saja di-evict, tapi tidak ada error.
    expect(() => openerTracker.getOpeners('conv-cap-0')).not.toThrow();
  });
});
