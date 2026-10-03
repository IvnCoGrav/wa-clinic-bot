import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';

/**
 * D.3 (audit #199) — keamanan akses media:
 *  - Kredensial via query string (?apiKey/?key/?token) DILARANG.
 *  - Hanya cookie sesi / X-API-KEY header / Authorization: Bearer yang sah.
 */
describe('D.3 — media proxy tidak menerima kredensial via query string', () => {
  const app = buildApp();
  const adminKey = 'test_admin_key_d3_media';

  beforeEach(() => {
    process.env.ADMIN_API_KEY = adminKey;
  });

  it('?apiKey=<valid> via query → DITOLAK (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/files/default/inbound_photo_123.jpg?apiKey=${adminKey}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('?token=<valid> via query → DITOLAK (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/files/default/inbound_photo_123.jpg?token=${adminKey}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('X-API-KEY header valid → lolos auth (bukan 401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/files/default/inbound_photo_123.jpg',
      headers: { 'x-api-key': adminKey },
    });
    expect(res.statusCode).not.toBe(401);
  });
});
