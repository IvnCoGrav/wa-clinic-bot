import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, generateEncryptionKey } from '../../src/utils/encryption';

describe('Encryption Utils (AES-256-GCM)', () => {
  const key = 'a'.repeat(64); // 32 bytes in hex

  beforeEach(() => {
    process.env.WABA_TOKEN_ENCRYPTION_KEY = key;
  });

  afterEach(() => {
    delete process.env.WABA_TOKEN_ENCRYPTION_KEY;
    vi.restoreAllMocks();
  });

  it('should throw if encryption key not configured', () => {
    delete process.env.WABA_TOKEN_ENCRYPTION_KEY;
    const savedAdmin = process.env.ADMIN_API_KEY;
    const savedApp = process.env.APP_SECRET;
    delete process.env.ADMIN_API_KEY;
    delete process.env.APP_SECRET;
    try {
      expect(() => encryptSecret('secret')).toThrow(/not configured/);
    } finally {
      if (savedAdmin !== undefined) process.env.ADMIN_API_KEY = savedAdmin;
      if (savedApp !== undefined) process.env.APP_SECRET = savedApp;
    }
  });

  it('should fallback to ADMIN_API_KEY when WABA key missing', () => {
    delete process.env.WABA_TOKEN_ENCRYPTION_KEY;
    process.env.ADMIN_API_KEY = 'fallback-admin-key-for-test';
    const encrypted = encryptSecret('secret-fallback');
    expect(encrypted).not.toBe('secret-fallback');
    expect(decryptSecret(encrypted)).toBe('secret-fallback');
  });

  it('should throw if key is not 32 bytes', () => {
    process.env.WABA_TOKEN_ENCRYPTION_KEY = 'short';
    expect(() => encryptSecret('secret')).toThrow(/32-byte/);
  });

  it('should encrypt and decrypt roundtrip', () => {
    const token = 'EAAWABAaccess_token_123';
    const encrypted = encryptSecret(token);
    expect(encrypted).not.toBe(token);
    expect(decryptSecret(encrypted)).toBe(token);
  });

  it('should produce unique ciphertext for same input (random IV)', () => {
    const token = 'same-token';
    const e1 = encryptSecret(token);
    const e2 = encryptSecret(token);
    expect(e1).not.toBe(e2);
    expect(decryptSecret(e1)).toBe(token);
    expect(decryptSecret(e2)).toBe(token);
  });

  it('should return empty string for empty input', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });

  it('should throw on corrupted payload', () => {
    const encrypted = encryptSecret('real-token');
    const corrupted = encrypted.slice(0, -4) + 'AAAA';
    expect(() => decryptSecret(corrupted)).toThrow();
  });

  it('should generate a 32-byte key', () => {
    const generated = generateEncryptionKey();
    expect(Buffer.from(generated, 'hex').length).toBe(32);
  });
});
