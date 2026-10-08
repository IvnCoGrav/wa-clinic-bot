import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import { buildApp } from '../../src/app';

/**
 * Suite: HTTP 206 Partial Content (Streaming Range)
 * Endpoint diuji:
 * 1. /media/:scope/:tenant/:file (disk stream)
 * 2. /api/files/:session/:file (WAHA buffer proxy)
 */
describe('Media route — HTTP 206 Range Streaming & RFC 7233 Compliance', () => {
  const app = buildApp();
  const key = 'test_admin_key_media_range';
  const saved: string[] = [];

  beforeEach(() => {
    process.env.ADMIN_API_KEY = key;
  });

  afterEach(() => {
    for (const rel of saved) {
      try {
        const abs = mediaServiceFilePath(rel);
        if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }
    saved.length = 0;
    vi.restoreAllMocks();
  });

  describe('GET /media/inbound/:tenant/:file (disk stream)', () => {
    it('mengembalikan status 200 dan Accept-Ranges: bytes saat tanpa header Range', async () => {
      const { mediaService } = await import('../../src/services/media.service');
      const sampleContent = '0123456789ABCDEF0123456789ABCDEF'; // 32 bytes
      const res0 = await mediaService.saveInboundMedia({
        tenantId: 'default-tenant',
        buffer: Buffer.from(sampleContent),
        mimeType: 'audio/ogg',
      });
      saved.push(res0.hdUrl);

      const res = await app.inject({
        method: 'GET',
        url: res0.hdUrl,
        headers: { 'x-api-key': key },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-length']).toBe(String(Buffer.byteLength(sampleContent)));
      expect(res.body).toBe(sampleContent);
    });

    it('mengembalikan status 206 dan Content-Range saat diberi Range byte spesifik (e.g. bytes=0-9)', async () => {
      const { mediaService } = await import('../../src/services/media.service');
      const sampleContent = '0123456789ABCDEF0123456789ABCDEF'; // 32 bytes
      const totalSize = Buffer.byteLength(sampleContent);
      const res0 = await mediaService.saveInboundMedia({
        tenantId: 'default-tenant',
        buffer: Buffer.from(sampleContent),
        mimeType: 'audio/ogg',
      });
      saved.push(res0.hdUrl);

      const res = await app.inject({
        method: 'GET',
        url: res0.hdUrl,
        headers: {
          'x-api-key': key,
          range: 'bytes=0-9',
        },
      });

      expect(res.statusCode).toBe(206);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-range']).toBe(`bytes 0-9/${totalSize}`);
      expect(res.headers['content-length']).toBe('10');
      expect(res.body).toBe('0123456789');
    });

    it('mengembalikan status 206 untuk open-ended range (bytes=10-)', async () => {
      const { mediaService } = await import('../../src/services/media.service');
      const sampleContent = '0123456789ABCDEF'; // 16 bytes
      const totalSize = Buffer.byteLength(sampleContent);
      const res0 = await mediaService.saveInboundMedia({
        tenantId: 'default-tenant',
        buffer: Buffer.from(sampleContent),
        mimeType: 'audio/ogg',
      });
      saved.push(res0.hdUrl);

      const res = await app.inject({
        method: 'GET',
        url: res0.hdUrl,
        headers: {
          'x-api-key': key,
          range: 'bytes=10-',
        },
      });

      expect(res.statusCode).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes 10-${totalSize - 1}/${totalSize}`);
      expect(res.headers['content-length']).toBe(String(totalSize - 10));
      expect(res.body).toBe('ABCDEF');
    });

    it('mengembalikan status 416 Range Not Satisfiable saat range di luar batas file', async () => {
      const { mediaService } = await import('../../src/services/media.service');
      const sampleContent = '0123456789'; // 10 bytes
      const res0 = await mediaService.saveInboundMedia({
        tenantId: 'default-tenant',
        buffer: Buffer.from(sampleContent),
        mimeType: 'audio/ogg',
      });
      saved.push(res0.hdUrl);

      const res = await app.inject({
        method: 'GET',
        url: res0.hdUrl,
        headers: {
          'x-api-key': key,
          range: 'bytes=500-600',
        },
      });

      expect(res.statusCode).toBe(416);
      expect(res.headers['content-range']).toBe('bytes */10');
    });

    it('mengembalikan status 416 saat format Range invalid', async () => {
      const { mediaService } = await import('../../src/services/media.service');
      const sampleContent = '0123456789'; // 10 bytes
      const res0 = await mediaService.saveInboundMedia({
        tenantId: 'default-tenant',
        buffer: Buffer.from(sampleContent),
        mimeType: 'audio/ogg',
      });
      saved.push(res0.hdUrl);

      const res = await app.inject({
        method: 'GET',
        url: res0.hdUrl,
        headers: {
          'x-api-key': key,
          range: 'bytes=xyz',
        },
      });

      expect(res.statusCode).toBe(416);
      expect(res.headers['content-range']).toBe('bytes */10');
    });
  });

  describe('GET /api/files/:session/:file (WAHA buffer proxy)', () => {
    it('mengembalikan status 200 dan Accept-Ranges: bytes tanpa Range header', async () => {
      const { wahaClient } = await import('../../src/integrations/waha/client');
      const sampleBuffer = Buffer.from('FAKE-AUDIO-PAYLOAD-FOR-WAHA-TEST-BYTES');
      vi.spyOn(wahaClient, 'fetchFile').mockResolvedValueOnce({
        data: sampleBuffer,
        contentType: 'audio/ogg',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/files/default/voice_sample.oga',
        headers: { 'x-api-key': key },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-length']).toBe(String(sampleBuffer.length));
      expect(res.rawPayload.equals(sampleBuffer)).toBe(true);
    });

    it('mengembalikan status 206 dan slice buffer saat diberikan Range bytes=5-14', async () => {
      const { wahaClient } = await import('../../src/integrations/waha/client');
      const sampleBuffer = Buffer.from('0123456789ABCDEF0123456789ABCDEF'); // 32 bytes
      vi.spyOn(wahaClient, 'fetchFile').mockResolvedValueOnce({
        data: sampleBuffer,
        contentType: 'audio/ogg',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/files/default/voice_sample.oga',
        headers: {
          'x-api-key': key,
          range: 'bytes=5-14',
        },
      });

      expect(res.statusCode).toBe(206);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-range']).toBe(`bytes 5-14/${sampleBuffer.length}`);
      expect(res.headers['content-length']).toBe('10');
      expect(res.body).toBe('56789ABCDE');
    });

    it('mengembalikan status 416 saat range di luar batas buffer WAHA', async () => {
      const { wahaClient } = await import('../../src/integrations/waha/client');
      const sampleBuffer = Buffer.from('12345'); // 5 bytes
      vi.spyOn(wahaClient, 'fetchFile').mockResolvedValueOnce({
        data: sampleBuffer,
        contentType: 'audio/ogg',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/files/default/voice_sample.oga',
        headers: {
          'x-api-key': key,
          range: 'bytes=100-200',
        },
      });

      expect(res.statusCode).toBe(416);
      expect(res.headers['content-range']).toBe('bytes */5');
    });

    it('menolak akses tanpa autentikasi (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/files/default/voice_sample.oga',
      });
      expect(res.statusCode).toBe(401);
    });
  });
});

function mediaServiceFilePath(rel: string): string {
  const m = rel.match(/^\/media\/inbound\/([^/]+)\/(.+)$/);
  if (!m) return '';
  return `${process.cwd()}/storage/media/inbound/${m[1]}/${m[2]}`;
}
