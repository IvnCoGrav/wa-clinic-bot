import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WahaClient, MOCK_QR_BASE64 } from '../../src/integrations/waha/client';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

function newClient(session = 'default'): WahaClient {
  process.env.WAHA_SESSION = session;
  return new WahaClient();
}

describe('WahaClient — getAuthQr / getSessionStatus / startSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.WAHA_BASE_URL;
  });

  describe('mode mock (WAHA_MOCK / NODE_ENV=test)', () => {
    it('getAuthQr mengembalikan QR deterministik tanpa HTTP', async () => {
      const client = newClient();
      const qr = await client.getAuthQr();
      expect(qr).toEqual({ mimetype: 'image/png', data: MOCK_QR_BASE64 });
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('getSessionStatus mengembalikan WORKING tanpa HTTP', async () => {
      const client = newClient();
      expect(await client.getSessionStatus()).toBe('WORKING');
    });

    it('startSession mengembalikan WORKING tanpa HTTP', async () => {
      const client = newClient();
      expect(await client.startSession()).toBe('WORKING');
    });
  });

  describe('mode HTTP asli (shouldMock dinonaktifkan)', () => {
    function forceRealHttp() {
      vi.spyOn(WahaClient.prototype as any, 'shouldMock', 'get').mockReturnValue(false);
    }

    it('getAuthQr sukses → { mimetype, data } dari response WAHA', async () => {
      forceRealHttp();
      mockedAxios.get.mockResolvedValueOnce({ data: { mimetype: 'image/png', data: 'QUJD' } });

      const client = newClient();
      const qr = await client.getAuthQr();

      expect(qr).toEqual({ mimetype: 'image/png', data: 'QUJD' });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/default/auth/qr'),
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json' }),
        })
      );
    });

    it('getAuthQr memakai session override per-tenant di URL', async () => {
      forceRealHttp();
      mockedAxios.get.mockResolvedValueOnce({ data: { data: 'QUJD' } });

      const client = newClient();
      await client.getAuthQr('tenant-b');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/tenant-b/auth/qr'),
        expect.anything()
      );
    });

    it('getAuthQr default mimetype image/png bila WAHA tidak mengirim mimetype', async () => {
      forceRealHttp();
      mockedAxios.get.mockResolvedValueOnce({ data: { data: 'QUJD' } });

      const client = newClient();
      const qr = await client.getAuthQr();
      expect(qr?.mimetype).toBe('image/png');
    });

    it('getAuthQr mengembalikan null bila data QR kosong/tidak ada', async () => {
      forceRealHttp();
      mockedAxios.get.mockResolvedValueOnce({ data: {} });

      const client = newClient();
      expect(await client.getAuthQr()).toBeNull();
    });

    it('getAuthQr mengembalikan null saat request gagal (tidak throw)', async () => {
      forceRealHttp();
      mockedAxios.get.mockRejectedValueOnce({ response: { data: { status: 404 } } });

      const client = newClient();
      expect(await client.getAuthQr()).toBeNull();
    });

    it('getSessionStatus memakai session override dan mengembalikan status WAHA', async () => {
      forceRealHttp();
      mockedAxios.get.mockResolvedValueOnce({ data: { status: 'SCAN_QR_CODE' } });

      const client = newClient();
      expect(await client.getSessionStatus('tenant-b')).toBe('SCAN_QR_CODE');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/tenant-b'),
        expect.anything()
      );
    });

    it('getSessionStatus mengembalikan DISCONNECTED saat request gagal', async () => {
      forceRealHttp();
      mockedAxios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const client = newClient();
      expect(await client.getSessionStatus()).toBe('DISCONNECTED');
    });

    it('startSession POST ke /api/sessions/{name}/start dan mengembalikan STARTED', async () => {
      forceRealHttp();
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      const client = newClient();
      expect(await client.startSession()).toBe('STARTED');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/default/start'),
        expect.anything(),
        expect.anything()
      );
    });

    it('startSession mengembalikan FAILED saat request gagal', async () => {
      forceRealHttp();
      mockedAxios.post.mockRejectedValueOnce({ response: { data: { status: 500 } } });

      const client = newClient();
      expect(await client.startSession()).toBe('FAILED');
    });
  });
});
