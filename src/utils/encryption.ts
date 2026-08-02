import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_ENV = 'WABA_TOKEN_ENCRYPTION_KEY';

function getKey(): Buffer {
  const key = process.env[KEY_ENV] || '';
  if (key.length === 0) {
    throw new Error(`${KEY_ENV} not configured. Must be a 32-byte (64 hex chars) key.`);
  }
  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error(`${KEY_ENV} must be a 32-byte key encoded as 64 hex characters.`);
  }
  return keyBuffer;
}

export function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const key = getKey();
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < 12 + 16 + 1) {
    throw new Error('Invalid encrypted payload.');
  }
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 12 + 16);
  const encrypted = raw.subarray(12 + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
