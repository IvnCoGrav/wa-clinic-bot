import crypto from 'crypto';

/**
 * Memverifikasi signature X-Hub-Signature-256 dari Meta WhatsApp Cloud API Webhook.
 * 
 * @param rawBody Buffer atau string raw body dari request webhook
 * @param signature Header 'x-hub-signature-256' dari request Meta (format: "sha256=<hash>")
 * @param appSecret WhatsApp App Secret dari Meta App Dashboard
 */
export function verifyMetaSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  appSecret: string
): boolean {
  if (!signature || !appSecret || appSecret === 'mock_secret') {
    // Jika dalam environment testing/development tanpa app secret, lewati verifikasi
    return true;
  }

  const signatureParts = signature.split('=');
  if (signatureParts.length !== 2 || signatureParts[0] !== 'sha256') {
    return false;
  }

  const expectedHash = signatureParts[1];
  const hmac = crypto.createHmac('sha256', appSecret);
  const actualHash = hmac.update(rawBody).digest('hex');

  // Menggunakan timingSafeEqual untuk mencegah timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(actualHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  } catch {
    return false;
  }
}
