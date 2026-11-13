/**
 * Helper reaksi pesan Live Chat yang murni dan bisa diuji terpisah.
 */

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
export const EXTRA_REACTIONS = ['🔥', '👏', '🎉', '💯', '✨', '🤝', '🌸', '💐', '👶', '🍼', '🤱', '💪'];

export interface MessageReaction {
  emoji: string;
  fromMe: boolean;
  senderName?: string;
  actorId?: string;
}

export interface GroupedReaction {
  emoji: string;
  count: number;
  senders: string[];
}

/**
 * Kelompokkan reaksi per emoji dengan urutan kemunculan pertama.
 * Reaksi tanpa emoji diabaikan; pengirim sendiri dilabeli "Anda".
 */
export function groupReactions(reactions: readonly MessageReaction[] | null | undefined): GroupedReaction[] {
  if (!reactions || reactions.length === 0) return [];
  const grouped = new Map<string, GroupedReaction>();
  for (const reaction of reactions) {
    if (!reaction?.emoji) continue;
    const entry = grouped.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, senders: [] };
    entry.count += 1;
    entry.senders.push(reaction.fromMe ? 'Anda' : reaction.senderName || 'Customer');
    grouped.set(reaction.emoji, entry);
  }
  return Array.from(grouped.values());
}

interface SenderLabelInput {
  direction: string;
  sender_type?: string | null;
  sender_name?: string | null;
}

/** Label pengirim untuk pratinjau balasan. */
export function senderLabel(message: SenderLabelInput): string {
  if (message.direction === 'INBOUND') return 'Customer';
  const type = (message.sender_type || '').toUpperCase();
  return type === 'ADMIN' || type === 'HUMAN' || type === 'STAFF'
    ? message.sender_name || 'Admin'
    : 'Bot';
}
