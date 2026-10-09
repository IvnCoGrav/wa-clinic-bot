import { describe, it, expect } from 'vitest';
import { maskPhone, maskName } from '../../src/services/capi.service';

describe('PII Masking Helper (Fase 5.1)', () => {
  describe('maskPhone', () => {
    it('masks regular phone number keeping first 4 and last 4 digits', () => {
      expect(maskPhone('628123456789')).toBe('6281****6789');
      expect(maskPhone('081234567890')).toBe('0812****7890');
    });

    it('masks phoneKey format phone:tenantId preserving tenantId', () => {
      expect(maskPhone('628123456789:default-tenant')).toBe('6281****6789:default-tenant');
      expect(maskPhone('081234567890:klinik-cahaya')).toBe('0812****7890:klinik-cahaya');
    });

    it('masks medium phone numbers (5-7 chars)', () => {
      expect(maskPhone('123456')).toBe('12****56');
      expect(maskPhone('1234567')).toBe('12****67');
    });

    it('masks very short phone numbers (<= 4 chars)', () => {
      expect(maskPhone('1234')).toBe('****');
      expect(maskPhone('12')).toBe('****');
    });

    it('returns placeholder for null, undefined, or empty phone', () => {
      expect(maskPhone(null)).toBe('(no-phone)');
      expect(maskPhone(undefined)).toBe('(no-phone)');
      expect(maskPhone('')).toBe('(no-phone)');
      expect(maskPhone('   ')).toBe('(no-phone)');
    });
  });

  describe('maskName', () => {
    it('masks middle characters of each word in full name', () => {
      expect(maskName('Siti Aminah')).toBe('S**i A****h');
      expect(maskName('Budi')).toBe('B**i');
    });

    it('handles short words appropriately', () => {
      expect(maskName('Al')).toBe('A*');
      expect(maskName('A')).toBe('A*');
    });

    it('returns placeholder for null, undefined, or empty name', () => {
      expect(maskName(null)).toBe('(no-name)');
      expect(maskName(undefined)).toBe('(no-name)');
      expect(maskName('')).toBe('(no-name)');
      expect(maskName('   ')).toBe('(no-name)');
    });
  });
});
