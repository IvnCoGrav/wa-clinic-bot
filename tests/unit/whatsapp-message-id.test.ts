import { describe, it, expect } from 'vitest';
import {
  isValidReplyToForProvider,
  isReplyIdFormatError,
} from '../../src/utils/whatsapp-message-id';

describe('whatsapp-message-id utils', () => {
  describe('isValidReplyToForProvider', () => {
    it('WAHA: menerima serialized message ID format WhatsApp', () => {
      expect(isValidReplyToForProvider('WAHA', 'false_628123@c.us_3EB0ABC')).toBe(true);
      expect(
        isValidReplyToForProvider('WAHA', 'true_628123@c.us_3EB0ABC_628999@c.us')
      ).toBe(true);
    });

    it('WAHA: menolak temp_ client ID', () => {
      expect(isValidReplyToForProvider('WAHA', 'temp_1795220000994')).toBe(false);
    });

    it('WAHA: menolak internal UUID database', () => {
      expect(
        isValidReplyToForProvider(
          'WAHA',
          '9f1c7d2e-3b4a-4d5e-8f9a-0b1c2d3e4f5a'
        )
      ).toBe(false);
    });

    it('WAHA: menolak raw stanza ID tanpa serialized prefix', () => {
      expect(isValidReplyToForProvider('WAHA', '3EB0ABCDEF123456')).toBe(false);
    });

    it('WABA: menerima format wamid resmi Meta Cloud API', () => {
      expect(
        isValidReplyToForProvider(
          'WABA',
          'wamid.HBgMNTY4MTIzNDU2Nzg5FQIAEhggM0VCMDEyMzQ1Njc4OTBBQkNERUYAA=='
        )
      ).toBe(true);
      expect(isValidReplyToForProvider('WABA', 'wamid.HBgMNTY4...')).toBe(true);
    });

    it('WABA: menolak serialized WAHA format', () => {
      expect(isValidReplyToForProvider('WABA', 'false_628123@c.us_3EB0ABC')).toBe(false);
    });

    it('Keduanya: menolak null, string kosong, atau whitespace', () => {
      expect(isValidReplyToForProvider('WAHA', null)).toBe(false);
      expect(isValidReplyToForProvider('WAHA', '')).toBe(false);
      expect(isValidReplyToForProvider('WAHA', '   ')).toBe(false);
      expect(isValidReplyToForProvider('WABA', null)).toBe(false);
      expect(isValidReplyToForProvider('WABA', '')).toBe(false);
      expect(isValidReplyToForProvider('WABA', '   ')).toBe(false);
    });
  });

  describe('isReplyIdFormatError', () => {
    it('mengembalikan true untuk error format ID spesifik dari WAHA NOWEB', () => {
      const err =
        'Error: Message id be in format false_11111111111@c.us_AAAAAAAAAAAAAAAAAAAA[_participant]';
      expect(isReplyIdFormatError(err)).toBe(true);
      expect(isReplyIdFormatError('message id be in format')).toBe(true);
    });

    it('mengembalikan false untuk error timeout atau error jaringan lain', () => {
      expect(isReplyIdFormatError('Connection timeout')).toBe(false);
      expect(isReplyIdFormatError('ECONNREFUSED')).toBe(false);
      expect(isReplyIdFormatError(null)).toBe(false);
      expect(isReplyIdFormatError('')).toBe(false);
    });
  });
});
