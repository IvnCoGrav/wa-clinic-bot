import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import { buildApp } from '../../src/app';

/**
 * Plan B Fase 2 — MIME audio & streaming header.
 * Regresi: voice note WhatsApp (.oga/.ogg = Ogg Opus) sebelumnya jatuh ke
 * application/octet-stream → pemutar audio mobile (Safari/iOS) menolak.
 * Acceptance: /media/inbound/:tenant/:file.ogg → Content-Type audio/ogg + Accept-Ranges.
 */
describe('Media route — MIME audio & Accept-Ranges', () => {
  const app = buildApp();
  const key = 'test_admin_key_media_audio';
  const saved: string[] = [];

  beforeEach(() => {
    process.env.ADMIN_API_KEY = key;
  });

  afterEach(() => {
    for (const rel of saved) {
      try {
        const abs = mediaServiceFilePath(rel);
        if (abs) fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }
    saved.length = 0;
    vi.restoreAllMocks();
  });

  it('menyajikan file .ogg inbound sebagai audio/ogg dengan Accept-Ranges: bytes', async () => {
    const { mediaService } = await import('../../src/services/media.service');
    const res0 = await mediaService.saveInboundMedia({
      tenantId: 'default-tenant',
      buffer: Buffer.from('OggS-NOT-A-REAL-FILE-just-bytes'),
      mimeType: 'audio/ogg',
    });
    saved.push(res0.hdUrl);

    const res = await app.inject({
      method: 'GET',
      url: res0.hdUrl,
      headers: { 'x-api-key': key },
    });

    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('audio/ogg');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('menolak akses media inbound tanpa autentikasi (401)', async () => {
    const { mediaService } = await import('../../src/services/media.service');
    const res0 = await mediaService.saveInboundMedia({
      tenantId: 'default-tenant',
      buffer: Buffer.from('OggS-x'),
      mimeType: 'audio/ogg',
    });
    saved.push(res0.hdUrl);

    const res = await app.inject({ method: 'GET', url: res0.hdUrl });
    expect(res.statusCode).toBe(401);
  });
});

function mediaServiceFilePath(rel: string): string {
  // filePathFromRelativeUrl butuh instance; import dinamis tidak bisa di afterEach sync.
  // Hitung manual: storage/media/inbound/<tenant>/<file>
  const m = rel.match(/^\/media\/inbound\/([^/]+)\/(.+)$/);
  if (!m) return '';
  return `${process.cwd()}/storage/media/inbound/${m[1]}/${m[2]}`;
}
