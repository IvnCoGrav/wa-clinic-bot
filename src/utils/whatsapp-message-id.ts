/**
 * whatsapp-message-id.ts
 *
 * Util leaf murni untuk validasi dan klasifikasi WhatsApp Message ID lintas provider (WAHA & WABA).
 * Sengaja diletakkan di layer utils (tanpa I/O dan tanpa import service/driver)
 * untuk menghindari circular dependency `service -> factory -> driver -> service`.
 */

export type ReplyProvider = 'WAHA' | 'WABA';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// WAHA NOWEB/Baileys: false_<jid>@<server>_<stanza>[_<participant>]
const WAHA_SERIALIZED_RE = /^(true|false)_[^_@\s]+@[^_\s]+_.+$/;

// Meta Cloud API message id (base64-ish).
const WABA_WAMID_RE = /^wamid\.[A-Za-z0-9+/=._-]+$/;

/**
 * Validasi apakah sebuah message ID sah digunakan sebagai `reply_to` pada provider target.
 * WAHA mewajibkan format serialized (false/true_jid_stanza); WABA mewajibkan prefix wamid.
 * Stanza mentah, ID optimistik temp_*, atau UUID internal DB ditolak keras.
 */
export function isValidReplyToForProvider(
  provider: ReplyProvider,
  id?: string | null
): boolean {
  const value = (id ?? '').trim();
  if (!value) return false;
  if (value.startsWith('temp_')) return false;
  if (UUID_RE.test(value)) return false;
  return provider === 'WABA'
    ? WABA_WAMID_RE.test(value)
    : WAHA_SERIALIZED_RE.test(value);
}

/**
 * Memeriksa apakah pesan error dari gateway disebabkan oleh ketidakcocokan format reply_to message ID.
 * Digunakan sebagai pemicu graceful fallback retry tanpa reply_to di driver WAHA.
 */
export function isReplyIdFormatError(message?: string | null): boolean {
  return /message id be in format/i.test(message ?? '');
}
