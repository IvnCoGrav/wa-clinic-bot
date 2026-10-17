import { describe, it, expect } from 'vitest';
import { detectKindFromMagic, kindFromMime, resolveExtForSave } from '../../src/utils/media-kind';

describe('Media Kind Sniffer (media-kind.ts)', () => {
  it('4.1a: mendeteksi JPEG dari magic bytes ffd8ff', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const res = detectKindFromMagic(buf);
    expect(res).toEqual({ kind: 'image', ext: 'jpg' });
  });

  it('4.1b: mendeteksi PNG dari magic bytes 89504e47', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const res = detectKindFromMagic(buf);
    expect(res).toEqual({ kind: 'image', ext: 'png' });
  });

  it('4.1c: mendeteksi GIF dari magic bytes GIF8', () => {
    const buf = Buffer.from('GIF89a...');
    const res = detectKindFromMagic(buf);
    expect(res).toEqual({ kind: 'image', ext: 'gif' });
  });

  it('4.1d: mendeteksi WebP dari magic bytes RIFF....WEBP', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
      Buffer.from('VP8 '),
    ]);
    const res = detectKindFromMagic(buf);
    expect(res).toEqual({ kind: 'image', ext: 'webp' });
  });

  it('4.1e: mendeteksi Ogg (audio voice note) dari magic bytes OggS', () => {
    const buf = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(10)]);
    const res = detectKindFromMagic(buf);
    expect(res).toEqual({ kind: 'audio', ext: 'ogg' });
  });

  it('4.1f: mendeteksi MP4 (video) dari ftyp di byte 4-7', () => {
    const buf = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.alloc(8),
    ]);
    const res = detectKindFromMagic(buf);
    expect(res).toEqual({ kind: 'video', ext: 'mp4' });
  });

  it('4.1g: mendeteksi PDF dari magic bytes %PDF', () => {
    const buf = Buffer.from('%PDF-1.4 header text');
    const res = detectKindFromMagic(buf);
    expect(res).toEqual({ kind: 'document', ext: 'pdf' });
  });

  it('4.1h: mendeteksi ZIP/DOCX dari magic bytes PK..', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const res = detectKindFromMagic(buf);
    expect(res).toEqual({ kind: 'document', ext: 'zip' });
  });

  it('4.1i: mendeteksi WebM dari magic bytes 1A 45 DF A3', () => {
    const buf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42]);
    const res = detectKindFromMagic(buf);
    expect(res).toEqual({ kind: 'video', ext: 'webm' });
  });

  it('4.1j: kindFromMime mengelompokkan mime type dengan tepat dan memaksa sniff pada application/octet-stream', () => {
    expect(kindFromMime('image/png')).toBe('image');
    expect(kindFromMime('audio/ogg; codecs=opus')).toBe('audio');
    expect(kindFromMime('video/mp4')).toBe('video');
    expect(kindFromMime('application/pdf')).toBe('document');
    expect(kindFromMime('application/octet-stream')).toBeNull();
    expect(kindFromMime('')).toBeNull();
  });

  it('4.1k: resolveExtForSave memprioritaskan magic bytes ril di atas klaim MIME type palsu', () => {
    // Skenario produksi: file dikirim dengan header image/jpeg tapi isinya Ogg audio
    const fakeJpgBuffer = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(20)]);
    const ext = resolveExtForSave('image/jpeg', fakeJpgBuffer);
    expect(ext).toBe('ogg'); // Sniffing magic bytes menang mutlak!
  });

  it('4.1l: resolveExtForSave tidak pernah me-return jpg untuk format tak dikenal (fallback ke bin)', () => {
    const unknownBuffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const ext = resolveExtForSave('application/unknown-format', unknownBuffer);
    expect(ext).toBe('bin');
  });
});
