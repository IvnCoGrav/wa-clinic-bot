/** Batas ukuran media masuk (chat) — satu sumber untuk service dan driver. */
export const MAX_INBOUND_MEDIA_BYTES = 20 * 1024 * 1024; // 20 MB gambar/audio/video
export const MAX_INBOUND_DOCUMENT_BYTES = 100 * 1024 * 1024; // 100 MB dokumen
export const MAX_INBOUND_BYTES = MAX_INBOUND_DOCUMENT_BYTES;

const FORBIDDEN_INBOUND_MIME =
  /^(text\/html|application\/xhtml|image\/svg|application\/javascript|text\/javascript|application\/xml|text\/xml)/i;

export function isForbiddenInboundMime(mimeType?: string | null): boolean {
  return FORBIDDEN_INBOUND_MIME.test(String(mimeType || '').trim());
}

export function inboundLimitForMime(mimeType?: string | null): number {
  const mime = String(mimeType || '').trim().toLowerCase();
  const isDocument = /^(application|text)\//.test(mime) && !mime.startsWith('image/');
  return isDocument ? MAX_INBOUND_DOCUMENT_BYTES : MAX_INBOUND_MEDIA_BYTES;
}

/** Guard kanonis sebelum byte media masuk diproses/disimpan. */
export function assertInboundMediaBudget(byteLength: number, mimeType?: string | null): void {
  if (isForbiddenInboundMime(mimeType)) {
    throw new Error('INBOUND_MIME_REJECTED');
  }
  const maxBytes = inboundLimitForMime(mimeType);
  if (byteLength > maxBytes) {
    throw new Error(`INBOUND_MEDIA_TOO_LARGE: ${byteLength} > ${maxBytes}`);
  }
}
