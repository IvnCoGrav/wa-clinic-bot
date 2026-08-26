import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizePhoneForFlagCheck,
  isSlotFillingEnabledForCustomer,
  isSlotFillingShadowMode,
} from '../../src/config/feature-flags';

describe('Feature Flags & Sandbox Infrastructure (Part 1)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    delete process.env.SLOT_FILLING_ENGINE_ENABLED;
    delete process.env.SLOT_FILLING_WHITELIST_PHONES;
    delete process.env.SLOT_FILLING_SHADOW_MODE;
  });

  describe('normalizePhoneForFlagCheck', () => {
    it('should normalize leading 0 to 62', () => {
      expect(normalizePhoneForFlagCheck('088235780925')).toBe('6288235780925');
      expect(normalizePhoneForFlagCheck('081234567890')).toBe('6281234567890');
    });

    it('should preserve already normalized 62 prefix', () => {
      expect(normalizePhoneForFlagCheck('6288235780925')).toBe('6288235780925');
    });

    it('should strip spaces, dashes, and plus signs', () => {
      expect(normalizePhoneForFlagCheck('+62 882-3578-0925')).toBe('6288235780925');
    });
  });

  describe('isSlotFillingEnabledForCustomer', () => {
    it('should enable for whitelisted testing phone 088235780925 by default', () => {
      delete process.env.SLOT_FILLING_ENGINE_ENABLED;
      process.env.SLOT_FILLING_WHITELIST_PHONES = '6288235780925';

      expect(isSlotFillingEnabledForCustomer('088235780925')).toBe(true);
      expect(isSlotFillingEnabledForCustomer('6288235780925')).toBe(true);
      expect(isSlotFillingEnabledForCustomer('+62 882-3578-0925')).toBe(true);
    });

    it('should reject non-whitelisted customer when master flag is false', () => {
      delete process.env.SLOT_FILLING_ENGINE_ENABLED;
      process.env.SLOT_FILLING_WHITELIST_PHONES = '6288235780925';

      expect(isSlotFillingEnabledForCustomer('081299998888')).toBe(false);
      expect(isSlotFillingEnabledForCustomer('6281299998888')).toBe(false);
    });

    it('should enable for ALL customers when SLOT_FILLING_ENGINE_ENABLED is true', () => {
      process.env.SLOT_FILLING_ENGINE_ENABLED = 'true';

      expect(isSlotFillingEnabledForCustomer('081299998888')).toBe(true);
      expect(isSlotFillingEnabledForCustomer('62855554444')).toBe(true);
    });
  });

  describe('isSlotFillingShadowMode', () => {
    it('should return true when SLOT_FILLING_SHADOW_MODE is true', () => {
      process.env.SLOT_FILLING_SHADOW_MODE = 'true';
      expect(isSlotFillingShadowMode()).toBe(true);
    });

    it('should return false when SLOT_FILLING_SHADOW_MODE is unset or false', () => {
      delete process.env.SLOT_FILLING_SHADOW_MODE;
      expect(isSlotFillingShadowMode()).toBe(false);
    });
  });
});
