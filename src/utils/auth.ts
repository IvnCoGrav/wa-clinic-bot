import crypto from 'crypto';

/**
 * timingSafeEqual wrapper yang menangani perbandingan string secara konstan (timing-safe).
 * Membantu menghindari serangan brute force / timing attacks pada API Key.
 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    // Jalankan hashing sha256 agar panjang buffer selalu sama sebelum TimingSafeEqual,
    // menghindari kebocoran informasi panjang kunci.
    const hashA = crypto.createHash('sha256').update(aBuffer).digest();
    const hashB = crypto.createHash('sha256').update(bBuffer).digest();
    return crypto.timingSafeEqual(hashA, hashB);
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}
