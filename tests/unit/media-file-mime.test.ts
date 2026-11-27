import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { wahaClient } from '../../src/integrations/waha/client';

describe('/api/files MIME hardening', () => {
  const app = buildApp();

  beforeEach(() => {
    process.env.ADMIN_API_KEY = 'test_admin_key_media';
  });

  it('tidak meneruskan text/html dari upstream sebagai HTML', async () => {
    vi.spyOn(wahaClient, 'fetchFile').mockResolvedValue({
      data: Buffer.from('<script>alert(1)</script>'),
      contentType: 'text/html; charset=utf-8',
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/files/session-1/payload.html',
      headers: { 'x-api-key': 'test_admin_key_media' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');
    expect(res.headers['content-type']).not.toContain('text/html');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-disposition'])).toContain('attachment');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('tetap menyajikan MIME aman yang memang diizinkan', async () => {
    vi.spyOn(wahaClient, 'fetchFile').mockResolvedValue({
      data: Buffer.from([0xff, 0xd8, 0xff]),
      contentType: 'image/jpeg',
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/files/session-1/photo.jpg',
      headers: { 'x-api-key': 'test_admin_key_media' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
  });
});
