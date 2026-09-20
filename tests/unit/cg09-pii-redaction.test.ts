import { describe, it, expect } from 'vitest';
import { maskCustomerName } from '../../src/utils/llm-execution-logger';
import { hashPiiPhone } from '../../src/utils/logger-sanitizer';

/**
 * CG-09 (RC-09) — redaksi PII pada berkas JSONL (at-rest).
 * Nomor di-hash, nama di-mask; buffer in-memory tetap mentah (diuji di test lain).
 */
describe('CG-09 PII redaction', () => {
  it('maskCustomerName menyamarkan tiap kata', () => {
    expect(maskCustomerName('Bunda Sari')).toBe('B*** S***');
    expect(maskCustomerName('A')).toBe('A');
    expect(maskCustomerName('')).toBe('');
  });

  it('hashPiiPhone mempertahankan prefix 3 digit + hash, bukan nomor mentah', () => {
    const out = hashPiiPhone('6289620099380');
    expect(out).not.toBe('6289620099380');
    expect(out.startsWith('628')).toBe(true);
    expect(out).toContain('***');
  });
});
