import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { memoryQuickReplies } from '../../src/routes/admin/quick-replies.subroute';

describe('Integration: Quick Replies Media & BodyLimit Hardening', () => {
  const ADMIN_KEY = 'test_admin_key_quick_replies_int';
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
  });

  beforeEach(() => {
    memoryQuickReplies.clear();
  });

  it('POST /api/admin/quick-replies accepts ~3MB base64 payload without 413 error', async () => {
    // 3 MB base64 payload
    const largeB64 = 'data:image/jpeg;base64,' + 'A'.repeat(3 * 1024 * 1024);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/quick-replies',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': DEFAULT_TENANT_ID,
      },
      payload: {
        shortcut: 'brosur_besar',
        title: 'Brosur Besar HD',
        content: 'Berikut brosur layanan kami ya Bunda {name}',
        category: 'Umum',
        media_type: 'CUSTOM_IMAGE',
        imageB64: largeB64,
        fileName: 'brosur.jpg',
        mimeType: 'image/jpeg',
      },
    });

    // Harus bukan 413 (Payload Too Large). Dalam mock DB offline, route menangani fallback in-memory (201).
    expect(res.statusCode).not.toBe(413);
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.shortcut).toBe('brosur_besar');
  });

  it('POST /api/admin/quick-replies rejects payloads > 12MB with strict 413', async () => {
    // 12.5 MB payload
    const oversizedB64 = 'data:image/jpeg;base64,' + 'B'.repeat(12.5 * 1024 * 1024);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/quick-replies',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': DEFAULT_TENANT_ID,
      },
      payload: {
        shortcut: 'oversized_media',
        title: 'Oversized Media',
        content: 'Konten',
        category: 'Umum',
        media_type: 'CUSTOM_IMAGE',
        imageB64: oversizedB64,
      },
    });

    expect(res.statusCode).toBe(413);
  });

  it('POST & PUT with media_type: PRICELIST are valid and not rejected with 400', async () => {
    // POST PRICELIST
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/admin/quick-replies',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': DEFAULT_TENANT_ID,
      },
      payload: {
        shortcut: 'pricelist_resmi',
        title: 'Pricelist Resmi',
        content: 'Berikut pricelist lengkap {clinic_name}',
        category: 'Umum',
        media_type: 'PRICELIST',
      },
    });

    expect(postRes.statusCode).not.toBe(400);
    expect(postRes.statusCode).toBe(201);
    const postBody = JSON.parse(postRes.body);
    expect(postBody.success).toBe(true);
    expect(postBody.data.media_type).toBe('PRICELIST');
    const createdId = postBody.data.id;

    // PUT PRICELIST
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/quick-replies/${createdId}`,
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': DEFAULT_TENANT_ID,
      },
      payload: {
        title: 'Pricelist Resmi Updated',
        media_type: 'PRICELIST',
      },
    });

    expect(putRes.statusCode).not.toBe(400);
    expect(putRes.statusCode).toBe(200);
    const putBody = JSON.parse(putRes.body);
    expect(putBody.success).toBe(true);
    expect(putBody.data.title).toBe('Pricelist Resmi Updated');
    expect(putBody.data.media_type).toBe('PRICELIST');
  });

  it('POST with invalid media_type is rejected with 400 by validator', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/quick-replies',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': DEFAULT_TENANT_ID,
      },
      payload: {
        shortcut: 'ngaco',
        title: 'Judul',
        content: 'Isi template',
        category: 'Umum',
        media_type: 'NGACO',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('media_type tidak valid');
  });
});
