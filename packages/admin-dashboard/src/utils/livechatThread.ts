/**
 * Deduplikasi pesan thread Live Chat (audit #316).
 *
 * Dulu dedupe memakai "teks + direction identik dalam <2 detik" → pesan SAH
 * yang dikirim beruntun (mis. pasien mengetik "Ya" dua kali, atau admin
 * mengirim template yang sama) dibuang dari riwayat. Dedupe yang benar hanya
 * berdasarkan identitas pesan: `id` internal atau `wa_message_id`.
 */

export interface ThreadMessageLike {
  id?: string | null;
  wa_message_id?: string | null;
}

export function dedupeThreadMessages<T extends ThreadMessageLike>(
  messages: T[] | null | undefined
): T[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const seenIds = new Set<string>();
  const seenWaIds = new Set<string>();
  const result: T[] = [];

  for (const message of messages) {
    const id = message?.id ? String(message.id) : '';
    const waId = message?.wa_message_id ? String(message.wa_message_id) : '';

    if (id && seenIds.has(id)) continue;
    if (waId && seenWaIds.has(waId)) continue;

    if (id) seenIds.add(id);
    if (waId) seenWaIds.add(waId);
    result.push(message);
  }

  return result;
}
