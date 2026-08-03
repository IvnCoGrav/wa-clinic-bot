import { prisma } from '../db/client';
import { Direction } from '@prisma/client';
import { getLiveChatHub } from './live-chat-hub.service';

// In-Memory store fallback untuk idempotency check jika DB belum terkoneksi saat dev local
const memoryWaMessageIds = new Set<string>();

// In-Memory store fallback untuk record pesan (agar Live Chat panel tetap jalan saat DB offline)
const memoryMessages: any[] = [];

// Sender default untuk payload Live Chat: outbound tanpa penanda = bot, inbound = customer
function resolveSenderType(data: { direction: Direction; senderType?: string }): string {
  if (data.senderType) return data.senderType;
  return data.direction === Direction.OUTBOUND ? 'BOT' : 'CUSTOMER';
}

export class MessageService {
  /**
   * Pengecekan Idempotensi: Memeriksa apakah wa_message_id dari Meta sudah pernah diproses.
   * Mengembalikan true jika pesan SUDAH PERNAH diproses sebelumnya (duplicate/retry).
   */
  public async isDuplicateMessage(waMessageId: string, tenantId: string): Promise<boolean> {
    if (!waMessageId) return false;

    const memoryKey = `${tenantId}:${waMessageId}`;

    // 1. Cek memory store dulu
    if (memoryWaMessageIds.has(memoryKey)) {
      return true;
    }

    // Tambahkan ke memory store sebagai lock in-flight agar request paralel tertahan
    memoryWaMessageIds.add(memoryKey);

    try {
      // 2. Query ke Prisma DB
      const existing = await prisma.message.findFirst({
        where: { wa_message_id: waMessageId, tenant_id: tenantId },
      });

      if (existing) {
        return true;
      }
    } catch (error) {
      // Jika DB connection error dalam testing environment, gunakan fallback memory store
    }

    return false;
  }

  /**
   * Menyimpan record pesan (Audit Trail) ke tabel messages dan menambahkan wa_message_id ke idempotency store.
   */
  public async logMessage(data: {
    conversationId: string;
    direction: Direction;
    content: string;
    waMessageId?: string;
    payloadRaw?: any;
    tenantId: string;
    senderType?: string;
    senderName?: string;
  }) {
    if (data.waMessageId) {
      memoryWaMessageIds.add(`${data.tenantId}:${data.waMessageId}`);
    }

    let saved: any = null;
    try {
      saved = await prisma.message.create({
        data: {
          tenant_id: data.tenantId,
          conversation_id: data.conversationId,
          direction: data.direction,
          content: data.content,
          wa_message_id: data.waMessageId || null,
          payload_raw: data.payloadRaw ? JSON.parse(JSON.stringify(data.payloadRaw)) : undefined,
          sender_type: data.senderType ?? undefined,
          sender_name: data.senderName ?? undefined,
        },
      });
      return saved;
    } catch (error) {
      console.warn('DB logMessage error (using fallback):', (error as Error).message);
      const fallbackMessage: any = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        tenant_id: data.tenantId,
        conversation_id: data.conversationId,
        direction: data.direction,
        content: data.content,
        wa_message_id: data.waMessageId || null,
        sender_type: data.senderType || resolveSenderType(data),
        sender_name: data.senderName || null,
        created_at: new Date(),
      };
      memoryMessages.push(fallbackMessage);
      return fallbackMessage;
    } finally {
      // Live Chat publish: fire-and-forget, tidak memblokir alur webhook/state-machine.
      getLiveChatHub()
        .publish({
          type: 'message.created',
          tenantId: data.tenantId,
          payload: {
            conversationId: data.conversationId,
            direction: data.direction,
            content: data.content,
            senderType: resolveSenderType(data),
            senderName: data.senderName || null,
            messageId: saved?.id || null,
            createdAt: saved?.created_at || new Date(),
          },
        })
        .catch(() => {});
    }
  }

  /**
   * Mengambil pesan inbound (masuk) terakhir dari customer untuk thread percakapan tertentu.
   */
  public async getLastInboundMessage(conversationId: string, tenantId: string): Promise<any> {
    try {
      return await prisma.message.findFirst({
        where: { conversation_id: conversationId, tenant_id: tenantId, direction: Direction.INBOUND },
        orderBy: { created_at: 'desc' },
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Mengambil pesan-pesan terakhir untuk percakapan tertentu (terurut kronologis).
   */
  public async getRecentMessages(conversationId: string, limit: number, tenantId: string): Promise<any[]> {
    try {
      const messages = await prisma.message.findMany({
        where: { conversation_id: conversationId, tenant_id: tenantId },
        orderBy: { created_at: 'desc' },
        take: limit,
      });
      return messages.reverse(); // Kembalikan ke urutan kronologis (lama -> baru)
    } catch (error) {
      // Memory fallback: ambil pesan terakhir (kronologis) untuk percakapan tsb
      return memoryMessages
        .filter((m) => m.conversation_id === conversationId && m.tenant_id === tenantId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(-limit);
    }
  }

  /**
   * Update status delivery pesan dari webhook status Meta (sent/delivered/read/failed).
   * Idempoten: updateMany by wa_message_id + tenant_id. DB offline → silent.
   */
  public async updateDeliveryStatus(
    waMessageId: string,
    tenantId: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
    timestamp?: number
  ): Promise<{ matched: boolean }> {
    if (!waMessageId) return { matched: false };

    const data: any = { delivery_status: status };
    const ts = timestamp ? new Date(timestamp * 1000) : new Date();
    if (status === 'delivered') data.delivered_at = ts;
    if (status === 'read') data.read_at = ts;

    try {
      const result = await prisma.message.updateMany({
        where: { wa_message_id: waMessageId, tenant_id: tenantId },
        data,
      });
      return { matched: result.count > 0 };
    } catch (error) {
      console.warn('DB updateDeliveryStatus error (using fallback):', (error as Error).message);
      return { matched: false };
    }
  }
}


export const messageService = new MessageService();
