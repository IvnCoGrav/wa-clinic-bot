import { describe, it, expect } from 'vitest';
import { extractWahaErrorDetail } from '../../src/integrations/waha/client';
import { isReplyIdFormatError } from '../../src/utils/whatsapp-message-id';

/**
 * Regresi Issue #365: WAHA NOWEB membungkus pesan error di `exception.message`,
 * bukan `message`/`error` di root response. Tanpa ekstraksi ini, fallback
 * "kirim tanpa quote" tidak pernah terpicu.
 */
describe('extractWahaErrorDetail — bentuk error WAHA nyata', () => {
  it('membaca exception.message dari body WAHA NOWEB (Issue #365)', () => {
    const body = {
      statusCode: 500,
      exception: {
        message:
          'Message id be in format false_11111111111@c.us_AAAAAAAAAAAAAAAAAAAA[_participant]',
      },
      request: {
        path: '/api/sendText',
        body: { reply_to: 'temp_1795220000994' },
      },
    };

    const detail = extractWahaErrorDetail(body, 'Request failed with status code 500');

    expect(detail).toContain('Message id be in format');
    expect(isReplyIdFormatError(detail)).toBe(true);
  });

  it('membaca error.message berbentuk objek', () => {
    const body = { error: { message: 'invalid reply_to message id' } };
    expect(extractWahaErrorDetail(body)).toBe('invalid reply_to message id');
  });

  it('membaca error berbentuk string', () => {
    const body = { error: 'invalid reply_to message id' };
    expect(extractWahaErrorDetail(body)).toBe('invalid reply_to message id');
  });

  it('membaca message di root body', () => {
    const body = { message: 'reply_to tidak valid' };
    expect(extractWahaErrorDetail(body)).toBe('reply_to tidak valid');
  });

  it('jatuh ke fallback axios jika body tidak informatif', () => {
    const body = { statusCode: 500, exception: {} };
    expect(extractWahaErrorDetail(body, 'Request failed with status code 500')).toBe(
      'Request failed with status code 500'
    );
  });

  it('body null/undefined tetap aman', () => {
    expect(extractWahaErrorDetail(undefined)).toBe('Unknown WAHA error');
    expect(extractWahaErrorDetail(null, 'fallback')).toBe('fallback');
  });

  it('tidak salah mengklasifikasikan error timeout sebagai error format ID', () => {
    const detail = extractWahaErrorDetail(undefined, 'timeout of 30000ms exceeded');
    expect(isReplyIdFormatError(detail)).toBe(false);
  });
});
