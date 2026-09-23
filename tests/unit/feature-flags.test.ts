import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isToolMaskingShadowMode, isToolMaskingEnforced } from '../../src/config/feature-flags';

describe('Feature Flags — Tool Masking (V3 aktif)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    delete process.env.TOOL_MASKING_SHADOW_MODE;
    delete process.env.TOOL_MASKING_ENFORCE;
  });

  describe('isToolMaskingShadowMode', () => {
    it('should return true when TOOL_MASKING_SHADOW_MODE is true', () => {
      process.env.TOOL_MASKING_SHADOW_MODE = 'true';
      expect(isToolMaskingShadowMode()).toBe(true);
    });

    it('should return false when TOOL_MASKING_SHADOW_MODE is unset or false', () => {
      delete process.env.TOOL_MASKING_SHADOW_MODE;
      expect(isToolMaskingShadowMode()).toBe(false);
    });
  });

  describe('isToolMaskingEnforced', () => {
    it('should return true by default (enforce aktif)', () => {
      delete process.env.TOOL_MASKING_ENFORCE;
      expect(isToolMaskingEnforced()).toBe(true);
    });

    it('should return false when TOOL_MASKING_ENFORCE is false', () => {
      process.env.TOOL_MASKING_ENFORCE = 'false';
      expect(isToolMaskingEnforced()).toBe(false);
    });

    it('should return true when TOOL_MASKING_ENFORCE is true', () => {
      process.env.TOOL_MASKING_ENFORCE = 'true';
      expect(isToolMaskingEnforced()).toBe(true);
    });
  });
});
