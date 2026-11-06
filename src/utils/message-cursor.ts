/**
 * Cursor paginasi pesan Live Chat (audit #316 / T-09).
 *
 * Sebelumnya cursor hanya `created_at`. Pesan WhatsApp dapat berbagi timestamp
 * yang sama (presisi detik), sehingga `created_at < cursor` melewatkan pesan di
 * batas halaman → riwayat "bolong". Cursor komposit `(created_at, id)` memberi
 * tie-breaker deterministik.
 *
 * Format: `<ISO>|<id>` — tetap kompatibel dengan cursor lama `<ISO>`.
 */

export interface MessageCursor {
  createdAt: Date;
  id?: string;
}

export function encodeMessageCursor(
  createdAt?: string | Date | null,
  id?: string | null
): string | null {
  if (!createdAt) return null;
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  const trimmedId = typeof id === 'string' ? id.trim() : '';
  return trimmedId ? `${iso}|${trimmedId}` : iso;
}

export function decodeMessageCursor(input?: string | Date | null): MessageCursor | null {
  if (!input) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : { createdAt: input };
  }

  const raw = String(input).trim();
  if (!raw) return null;

  const separator = raw.indexOf('|');
  const isoPart = separator >= 0 ? raw.slice(0, separator) : raw;
  const idPart = separator >= 0 ? raw.slice(separator + 1).trim() : '';

  const createdAt = new Date(isoPart);
  if (Number.isNaN(createdAt.getTime())) return null;

  return idPart ? { createdAt, id: idPart } : { createdAt };
}
