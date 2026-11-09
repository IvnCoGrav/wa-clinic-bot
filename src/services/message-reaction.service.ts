import { prisma } from '../db/client';
import { getLiveChatHub } from './live-chat-hub.service';
import { extractShortMessageId } from './message.service';
import { memoryMessages } from './message-memory.store';

/**
 * Service terspesialisasi untuk operasi Reaksi Emoji pada pesan.
 * Didekomposisi dari message.service.ts (SM-01).
 */
export class MessageReactionService {
  /**
   * Menambahkan, mengubah, atau menghapus reaksi emoji pada sebuah pesan.
   * Bila emoji kosong (""), reaksi dari actor tersebut akan dihapus.
   */
  public async addOrUpdateReaction(
    messageId: string,
    tenantId: string,
    reaction: {
      emoji: string;
      fromMe: boolean;
      senderName?: string;
      actorId?: string;
    }
  ): Promise<{ success: boolean; messageId?: string; conversationId?: string; reactions?: any[] }> {
    let conversationId = '';
    let targetMessageId = messageId;
    let reactions: any[] = [];

    const actorKey = reaction.fromMe ? 'ME' : (reaction.actorId || reaction.senderName || 'CUSTOMER');

    const cleanId = extractShortMessageId(messageId);
    const orConds: any[] = [
      { id: messageId, tenant_id: tenantId },
      { wa_message_id: messageId, tenant_id: tenantId },
    ];
    if (cleanId) {
      if (cleanId !== messageId) {
        orConds.push({ wa_message_id: cleanId, tenant_id: tenantId });
      }
      orConds.push({ wa_message_id: { endsWith: `_${cleanId}` }, tenant_id: tenantId });
    }
    try {
      let msg = await prisma.message.findFirst({
        where: { OR: orConds },
      });

      if (msg) {
        conversationId = msg.conversation_id;
        targetMessageId = msg.id;
        const currentPayload = (typeof msg.payload_raw === 'object' && msg.payload_raw ? msg.payload_raw : {}) as any;
        const existingReactions = Array.isArray(currentPayload.reactions) ? [...currentPayload.reactions] : [];

        if (!reaction.emoji) {
          // Hapus reaksi dari actor ini
          reactions = existingReactions.filter((r: any) => (r.fromMe ? 'ME' : (r.actorId || r.senderName || 'CUSTOMER')) !== actorKey);
        } else {
          // Hapus reaksi lama dari actor ini, lalu tambahkan yang baru
          reactions = existingReactions.filter((r: any) => (r.fromMe ? 'ME' : (r.actorId || r.senderName || 'CUSTOMER')) !== actorKey);
          reactions.push({
            emoji: reaction.emoji,
            fromMe: reaction.fromMe,
            senderName: reaction.senderName,
            actorId: reaction.actorId,
            createdAt: new Date().toISOString(),
          });
        }

        await prisma.message.updateMany({
          where: { id: msg.id, tenant_id: tenantId },
          data: {
            payload_raw: {
              ...currentPayload,
              reactions,
            },
          },
        });
      }
    } catch (error) {
      console.warn('DB addOrUpdateReaction error (using memory fallback):', (error as Error).message);
    }

    // Memory store fallback sync — dukung short/long WA ID (pakai cleanId konsisten dengan DB)
    const inMem = memoryMessages.find(
      (m) =>
        (m.id === messageId ||
          m.wa_message_id === messageId ||
          (cleanId && (m.wa_message_id === cleanId || (m.wa_message_id && String(m.wa_message_id).endsWith(`_${cleanId}`))))) &&
        m.tenant_id === tenantId
    );
    if (inMem) {
      conversationId = inMem.conversation_id;
      targetMessageId = inMem.id;
      const currentPayload = inMem.payload_raw || {};
      const existingReactions = Array.isArray(currentPayload.reactions) ? [...currentPayload.reactions] : [];

      if (!reaction.emoji) {
        reactions = existingReactions.filter((r: any) => (r.fromMe ? 'ME' : (r.actorId || r.senderName || 'CUSTOMER')) !== actorKey);
      } else {
        reactions = existingReactions.filter((r: any) => (r.fromMe ? 'ME' : (r.actorId || r.senderName || 'CUSTOMER')) !== actorKey);
        reactions.push({
          emoji: reaction.emoji,
          fromMe: reaction.fromMe,
          senderName: reaction.senderName,
          actorId: reaction.actorId,
          createdAt: new Date().toISOString(),
        });
      }
      inMem.payload_raw = { ...currentPayload, reactions };
    }

    // Broadcast update via LiveChatHub — ganda untuk kompatibilitas listener SSE (colon + dot)
    try {
      const hub = getLiveChatHub();
      if (hub && conversationId) {
        const payload = { conversationId, messageId: targetMessageId, waMessageId: messageId, reactions };
        await hub.publish({ type: 'message:reaction' as any, tenantId, payload } as any);
        await hub.publish({ type: 'message.reaction' as any, tenantId, payload } as any);
      }
    } catch (hubErr: any) {
      console.warn('[HUB] Failed to publish message:reaction event:', hubErr.message);
    }

    return { success: true, messageId: targetMessageId, conversationId, reactions };
  }
}

export const messageReactionService = new MessageReactionService();
