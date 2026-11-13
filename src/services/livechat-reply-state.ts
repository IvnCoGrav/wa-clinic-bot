/**
 * Aturan "menunggu dibalas" untuk Live Chat.
 *
 * Keputusan produk (2026-11-11): memberi reaksi emot pada pesan customer
 * dianggap sudah membalas, jadi percakapan tidak lagi berstatus
 * "menunggu dibalas".
 *
 * Yang dihitung hanya reaksi dari staf (`fromMe: true`). Reaksi customer pada
 * pesannya sendiri tidak boleh memadamkan status. Reaksi pada pesan lama juga
 * tidak berlaku: yang dinilai adalah pesan customer TERAKHIR — kalau customer
 * mengirim pesan baru setelahnya, pesan baru itu tetap menunggu dibalas.
 */

export interface AwaitingReplyMessage {
  direction?: string | null;
  created_at?: string | Date | null;
  sender_type?: string | null;
  payload_raw?: unknown;
}

const AWAITING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** True bila pesan punya minimal satu reaksi emot dari staf. */
export function hasStaffReaction(payloadRaw: unknown): boolean {
  if (!payloadRaw || typeof payloadRaw !== 'object') return false;
  const reactions = (payloadRaw as any).reactions;
  if (!Array.isArray(reactions)) return false;
  return reactions.some(
    (r: any) => r && r.fromMe === true && typeof r.emoji === 'string' && r.emoji.trim() !== ''
  );
}

/**
 * Hitung status menunggu dibalas.
 * `unreadCount > 0` berarti belum dibaca → bukan "menunggu dibalas" (masih unread).
 */
export function computeIsAwaitingReply(
  lastRealMsg: AwaitingReplyMessage | null | undefined,
  unreadCount: number,
  isManualUnread: boolean,
  now: number = Date.now()
): boolean {
  if (isManualUnread) return false;
  if (unreadCount !== 0) return false;
  if (!lastRealMsg) return false;
  if (lastRealMsg.sender_type === 'INTERNAL_NOTE') return false;

  const direction = String(lastRealMsg.direction || '').toUpperCase();
  if (direction !== 'INBOUND') return false;

  // Sudah diberi emot oleh staf → dianggap dibalas.
  if (hasStaffReaction(lastRealMsg.payload_raw)) return false;

  const createdAt = lastRealMsg.created_at ? new Date(lastRealMsg.created_at).getTime() : NaN;
  if (!Number.isFinite(createdAt)) return false;
  return now - createdAt <= AWAITING_MAX_AGE_MS;
}
