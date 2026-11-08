import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_ENV = 'WABA_TOKEN_ENCRYPTION_KEY';
const BACKUP_KEY_ENV = 'BACKUP_ENCRYPTION_KEY';

function getKey(): Buffer {
  const key = process.env[KEY_ENV] || '';
  if (key.length > 0) {
    const keyBuffer = Buffer.from(key, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error(`${KEY_ENV} must be a 32-byte key encoded as 64 hex characters.`);
    }
    return keyBuffer;
  }

  // S-001 / Fase 1.1: Di lingkungan produksi, dilarang keras fallback ke ADMIN_API_KEY
  // tanpa kunci mandiri WABA_TOKEN_ENCRYPTION_KEY, kecuali jika bendera transisi aktif.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_ADMIN_KEY_ENCRYPTION_FALLBACK !== 'true') {
    throw new Error(`${KEY_ENV} not configured. Production environment requires explicit 32-byte (64 hex chars) key.`);
  }

  // Fallback deterministik SHA-256 dari ADMIN_API_KEY / APP_SECRET (dev/test saja)
  const fallbackSeed = process.env.ADMIN_API_KEY || process.env.APP_SECRET || '';
  if (fallbackSeed.length === 0) {
    throw new Error(`${KEY_ENV} not configured. Must be a 32-byte (64 hex chars) key.`);
  }
  return crypto.createHash('sha256').update(fallbackSeed, 'utf8').digest();
}

/**
 * Mengambil kunci enkripsi backup mandiri (AES-256-GCM 32-byte / 64 hex).
 * Fail-closed: gagal bila tidak dikonfigurasi.
 */
export function getBackupEncryptionKey(): Buffer {
  const key = process.env[BACKUP_KEY_ENV] || '';
  if (key.length > 0) {
    const keyBuffer = Buffer.from(key, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error(`${BACKUP_KEY_ENV} must be a 32-byte key encoded as 64 hex characters.`);
    }
    return keyBuffer;
  }
  throw new Error(`${BACKUP_KEY_ENV} not configured. Must be a 32-byte (64 hex chars) key.`);
}

export function encryptWithKey(plainText: string, key: Buffer): string {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptWithKey(payload: string, key: Buffer): string {
  if (!payload) return '';
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

/**
 * Enkripsi biner buffer dengan AES-256-GCM (magic bytes 'ENC1' + IV 12b + AuthTag 16b + Ciphertext).
 */
export function encryptBufferWithKey(buffer: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const magic = Buffer.from('ENC1', 'ascii');
  return Buffer.concat([magic, iv, authTag, encrypted]);
}

/**
 * Dekripsi biner buffer terenkripsi AES-256-GCM.
 */
export function decryptBufferWithKey(payload: Buffer, key: Buffer): Buffer {
  if (payload.length < 4 + 12 + 16 + 1) {
    throw new Error('Payload backup terlalu pendek atau tidak valid.');
  }
  const magic = payload.subarray(0, 4).toString('ascii');
  if (magic !== 'ENC1') {
    throw new Error('Format backup tidak terenkripsi atau magic header tidak valid.');
  }
  const iv = payload.subarray(4, 4 + 12);
  const authTag = payload.subarray(4 + 12, 4 + 12 + 16);
  const encrypted = payload.subarray(4 + 12 + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function isEncryptedBackupBuffer(payload: Buffer): boolean {
  if (payload.length < 4) return false;
  return payload.subarray(0, 4).toString('ascii') === 'ENC1';
}

export function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  const key = getKey();
  return encryptWithKey(plainText, key);
}

export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const key = getKey();
  return decryptWithKey(payload, key);
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * SEC-AUDIT-11: baca kredensial yang mungkin sudah terenkripsi (AES-256-GCM)
 * atau masih plaintext legacy. Decrypt gagal / kunci tak tersedia → anggap
 * plaintext apa adanya. Dual-read agar migrasi bertahap tanpa downtime.
 */
export function decryptSecretCompat(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const decrypted = decryptSecret(raw);
    // Payload terenkripsi valid → selalu hasil decrypt (walau kebetulan mirip plaintext).
    return decrypted;
  } catch {
    return raw;
  }
}

/**
 * SEC-AUDIT-11: enkripsi bila kunci tersedia; bila tidak (mis. test/dev tanpa
 * key), kembalikan apa adanya agar tidak crash. Caller tetap aman karena
 * decryptSecretCompat membaca keduanya.
 */
export function encryptSecretIfPossible(plainText: string): string {
  if (!plainText) return '';
  try {
    return encryptSecret(plainText);
  } catch {
    return plainText;
  }
}
