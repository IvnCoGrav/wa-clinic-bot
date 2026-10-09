import { describe, it, expect } from 'vitest';
import { formatMetaFbc } from '../../src/services/capi.service';

describe('Fase 3.3: Meta _fbc Format Canonical Validator', () => {
  it('should format raw fbclid into standard Meta _fbc format: fb.1.<creationTime>.<fbclid>', () => {
    const creationTime = 1680000000000;
    const fbclid = 'IwAR1234567890abcdef';
    const formatted = formatMetaFbc(fbclid, creationTime);

    expect(formatted).toBe('fb.1.1680000000000.IwAR1234567890abcdef');
  });

  it('should preserve already valid _fbc strings without altering the timestamp', () => {
    const validFbc = 'fb.1.1712000000000.EAIaIQobChMI_real_fbclid';
    const formatted = formatMetaFbc(validFbc, 9999999999999);

    expect(formatted).toBe(validFbc);
  });

  it('should repair and reformat malformed or dirty _fbc strings', () => {
    const dirtyFbc = 'fb.1.invalid_timestamp.xyz123';
    const formatted = formatMetaFbc(dirtyFbc, 1720000000000);

    expect(formatted).toBe('fb.1.1720000000000.xyz123');
  });

  it('should return undefined for empty, null, or undefined values', () => {
    expect(formatMetaFbc(null)).toBeUndefined();
    expect(formatMetaFbc(undefined)).toBeUndefined();
    expect(formatMetaFbc('')).toBeUndefined();
    expect(formatMetaFbc('   ')).toBeUndefined();
  });
});
