import path from 'path';

export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'other';

export interface MagicDetectionResult {
  kind: MediaKind;
  ext: string;
}

/**
 * Sniff magic bytes buffer untuk menentukan MediaKind dan ekstensi kanonis.
 * Standar magic bytes:
 * - JPEG: ffd8ff
 * - PNG: 89504e47 (\x89PNG)
 * - GIF: GIF8 (47494638)
 * - WebP: RIFF....WEBP
 * - Ogg (audio/voice note): OggS (4f676753)
 * - MP4/M4A/MOV: byte 4-8 = 'ftyp'
 * - WebM/MKV: 1a45dfa3
 * - PDF: %PDF (25504446)
 * - ZIP/DOCX/XLSX: 504b0304 (PK\x03\x04)
 */
export function detectKindFromMagic(buf: Buffer | null | undefined): MagicDetectionResult | null {
  if (!buf || buf.length < 4) return null;

  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { kind: 'image', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { kind: 'image', ext: 'png' };
  }

  // GIF: GIF8 (47 49 46 38)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { kind: 'image', ext: 'gif' };
  }

  // WebP: RIFF (byte 0-3) + WEBP (byte 8-11)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return { kind: 'image', ext: 'webp' };
  }

  // Ogg (audio / voice note): OggS (4F 67 67 53)
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return { kind: 'audio', ext: 'ogg' };
  }

  // MP3: ID3 header
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return { kind: 'audio', ext: 'mp3' };
  }

  // MP4 / M4A: bytes 4..7 === 'ftyp'
  if (
    buf.length >= 8 &&
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
  ) {
    if (buf.length >= 12) {
      const brand = buf.subarray(8, 12).toString('ascii').trim().toLowerCase();
      if (brand === 'm4a' || brand === 'm4b') {
        return { kind: 'audio', ext: 'm4a' };
      }
    }
    return { kind: 'video', ext: 'mp4' };
  }

  // WebM / Matroska: 1A 45 DF A3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { kind: 'video', ext: 'webm' };
  }

  // PDF: %PDF (25 50 44 46)
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { kind: 'document', ext: 'pdf' };
  }

  // ZIP / DOCX / XLSX: 50 4B 03 04 (PK\x03\x04)
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return { kind: 'document', ext: 'zip' };
  }

  return null;
}

/**
 * Memetakan MIME type ke MediaKind.
 * Jika MIME generik (application/octet-stream atau kosong), mengembalikan null untuk memaksa sniffing magic bytes.
 */
export function kindFromMime(mime: string | null | undefined): MediaKind | null {
  const clean = (mime || '').split(';')[0].trim().toLowerCase();
  if (!clean || clean === 'application/octet-stream' || clean === 'binary/octet-stream') {
    return null;
  }
  if (clean.startsWith('image/')) return 'image';
  if (clean.startsWith('audio/')) return 'audio';
  if (clean.startsWith('video/')) return 'video';
  if (
    clean === 'application/pdf' ||
    clean === 'application/msword' ||
    clean.includes('officedocument') ||
    clean === 'text/plain' ||
    clean === 'application/zip'
  ) {
    return 'document';
  }
  return null;
}

/**
 * Menentukan ekstensi penyimpanan file:
 * 1. Otoritas tertinggi: Sniff magic bytes buffer (konten ril).
 * 2. Fallback: MIME type spesifik.
 * 3. Default aman: 'bin' (DILARANG default 'jpg').
 */
export function resolveExtForSave(mime: string | null | undefined, buf?: Buffer | null): string {
  if (buf && buf.length >= 4) {
    const magic = detectKindFromMagic(buf);
    if (magic) return magic.ext;
  }

  const clean = (mime || '').split(';')[0].trim().toLowerCase();
  switch (clean) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'audio/ogg':
    case 'audio/opus':
      return 'ogg';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/aac':
      return 'm4a';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'application/pdf':
      return 'pdf';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'text/plain':
      return 'txt';
    default:
      if (clean.startsWith('image/')) return 'jpg';
      if (clean.startsWith('audio/')) return 'ogg';
      if (clean.startsWith('video/')) return 'mp4';
      if (clean.startsWith('text/')) return 'txt';
      return 'bin';
  }
}
