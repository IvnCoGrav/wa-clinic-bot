import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { wahaClient } from '../../src/integrations/waha/client';
import { prisma } from '../../src/db/client';

describe('Fitur 1 — WhatsApp Provider QR API', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
  });

  it('1. GET /api/admin/whatsapp-provider/qr tanpa API key → 401 (fail-closed)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/whatsapp-provider/qr',
    });

    expect(response.statusCode).toBe(401);
  });

  it('2. GET /api/admin/whatsapp-provider/qr dengan key → 200 WORKING + qr null (session aktif)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/whatsapp-provider/qr',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.provider).toBe('WAHA');
    expect(body.data.status).toBe('WORKING');
    expect(body.data.sessionId).toBe('default');
    expect(body.data.qr).toBeNull();
  });

  it('3. Menggunakan tenant.waha_session_id + QR dikembalikan saat status SCAN_QR_CODE', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({ waha_session_id: 'tenant-b' } as any);
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('SCAN_QR_CODE');
    vi.spyOn(wahaClient, 'getAuthQr').mockResolvedValue({ mimetype: 'image/png', data: 'QUJD' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/whatsapp-provider/qr',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.sessionId).toBe('tenant-b');
    expect(body.data.qr).toEqual({ mimetype: 'image/png', data: 'QUJD' });
  });

  it('4. Status FAILED → qr null + pesan informatif (UI tidak berasumsi QR selalu ada)', async () => {
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('FAILED');

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/whatsapp-provider/qr',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.status).toBe('FAILED');
    expect(body.data.qr).toBeNull();
    expect(body.data.message).toContain('FAILED');
  });

  it('5. POST /api/admin/whatsapp-provider/session/start memanggil startSession + audit', async () => {
    vi.spyOn(wahaClient, 'startSession').mockResolvedValue('STARTED');
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('WORKING');

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/whatsapp-provider/session/start',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('WORKING');
    expect(wahaClient.startSession).toHaveBeenCalled();
  });
});
