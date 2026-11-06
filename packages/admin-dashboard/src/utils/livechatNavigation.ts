/**
 * Transisi view berdasarkan URL percakapan (audit #316 / T-08).
 *
 * Aturan:
 *  - URL punya conversationId → buka thread.
 *  - URL tidak punya, tetapi sebelumnya punya → kembali ke daftar (back).
 *  - Selain itu (mis. `?action=export` berubah saat di daftar) → jangan ubah view.
 */
export type UrlViewTransition = 'open' | 'close' | 'none';

export function resolveUrlViewTransition(
  previousConversationId: string | null | undefined,
  nextConversationId: string | null | undefined
): UrlViewTransition {
  if (nextConversationId) return 'open';
  if (previousConversationId) return 'close';
  return 'none';
}
