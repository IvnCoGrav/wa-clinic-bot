import { describe, it, expect } from 'vitest';
import { mediaService } from '../../src/services/media.service';
import {
  assertInboundMediaBudget,
  inboundLimitForMime,
  isForbiddenInboundMime,
  MAX_INBOUND_MEDIA_BYTES,
  MAX_INBOUND_DOCUMENT_BYTES,
} from '../../src/utils/media-limits';

describe('F3 — budget media inbound', () => {
  it('menerima media gambar/audio/video sampai 20 MB', () => {
    expect(() => assertInboundMediaBudget(MAX_INBOUND_MEDIA_BYTES, 'image/jpeg')).not.toThrow();
    expect(() => assertInboundMediaBudget(MAX_INBOUND_MEDIA_BYTES, 'audio/ogg')).not.toThrow();
    expect(() => assertInboundMediaBudget(MAX_INBOUND_MEDIA_BYTES, 'video/mp4')).not.toThrow();
  });

  it('menolak media > 20 MB', () => {
    expect(() => assertInboundMediaBudget(MAX_INBOUND_MEDIA_BYTES + 1, 'image/jpeg')).toThrow(
      /INBOUND_MEDIA_TOO_LARGE/
    );
  });

  it('dokumen punya plafon 100 MB', () => {
    expect(inboundLimitForMime('application/pdf')).toBe(MAX_INBOUND_DOCUMENT_BYTES);
    expect(() => assertInboundMediaBudget(MAX_INBOUND_DOCUMENT_BYTES, 'application/pdf')).not.toThrow();
    expect(() => assertInboundMediaBudget(MAX_INBOUND_DOCUMENT_BYTES + 1, 'application/pdf')).toThrow(
      /INBOUND_MEDIA_TOO_LARGE/
    );
  });

  it('mime yang dapat mengeksekusi markup ditolak', () => {
    for (const mime of ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/javascript', 'text/xml']) {
      expect(isForbiddenInboundMime(mime)).toBe(true);
      expect(() => assertInboundMediaBudget(10, mime)).toThrow(/INBOUND_MIME_REJECTED/);
    }
  });

  it('mime kosong diperlakukan sebagai media biasa', () => {
    expect(inboundLimitForMime(undefined)).toBe(MAX_INBOUND_MEDIA_BYTES);
    expect(() => assertInboundMediaBudget(10, undefined)).not.toThrow();
  });

  it('saveInboundMedia menolak HTML walau ukurannya kecil', async () => {
    await expect(
      mediaService.saveInboundMedia({
        tenantId: 'default-tenant',
        buffer: Buffer.from('<html><script>alert(1)</script></html>'),
        mimeType: 'text/html',
      })
    ).rejects.toThrow(/INBOUND_MIME_REJECTED/);
  });
});
