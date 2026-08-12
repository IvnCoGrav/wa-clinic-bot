import { prisma } from '../db/client';
import { Direction, Prisma } from '@prisma/client';
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

// Ambil metadata media (gambar Live Chat) dari payload_raw untuk di-render dashboard.
function extractMediaFromPayload(payloadRaw: any): any {
  const media = payloadRaw?.media;
  if (media && (media.url || media.hdUrl)) return media;
  return undefined;
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
    deliveryStatus?: 'sent' | 'delivered' | 'read' | 'failed';
    metaErrorCode?: string;
    metaErrorDesc?: string;
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
          delivery_status: data.deliveryStatus ?? undefined,
          meta_error_code: data.metaErrorCode ?? undefined,
          meta_error_desc: data.metaErrorDesc ?? undefined,
        },
      });
      if (saved) return saved;
      throw new Error('Prisma create returned null/undefined (DB offline)');
    } catch (error) {
      console.warn('DB logMessage error (using fallback):', (error as Error).message);
      const fallbackMessage: any = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        tenant_id: data.tenantId,
        conversation_id: data.conversationId,
        direction: data.direction,
        content: data.content,
        wa_message_id: data.waMessageId || null,
        payload_raw: data.payloadRaw ? JSON.parse(JSON.stringify(data.payloadRaw)) : undefined,
        sender_type: data.senderType || resolveSenderType(data),
        sender_name: data.senderName || null,
        delivery_status: data.deliveryStatus ?? null,
        meta_error_code: data.metaErrorCode ?? null,
        meta_error_desc: data.metaErrorDesc ?? null,
        created_at: new Date(),
      };
      memoryMessages.push(fallbackMessage);
      return fallbackMessage;
    } finally {
      // Jika pesan INBOUND (dari customer), increment bubble count & evaluasi status MQL
      if (data.direction === Direction.INBOUND || (data.direction as string) === 'INBOUND') {
        try {
          const { conversationService } = await import('./conversation.service');
          const { customerService } = await import('./customer.service');
          const conv = await conversationService.getConversationById(data.conversationId, data.tenantId);
          if (conv?.customer_id) {
            customerService.incrementCustomerMessageCount(conv.customer_id, data.tenantId).catch(() => {});
          }
        } catch (mqlErr: any) {
          console.warn('[MQL] Failed to increment bubble count:', mqlErr.message);
        }
      }

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
            media: extractMediaFromPayload(data.payloadRaw),
          },
        })
        .catch(() => {});
    }
  }

  /**
   * Hapus pesan milik percakapan tertentu dari memory fallback store (dipakai saat
   * hard wipe /reset supaya tidak menyisakan pesan stale di memori / live chat).
   */
  public clearMessageMemory(conversationId: string): void {
    for (let i = memoryMessages.length - 1; i >= 0; i--) {
      if (memoryMessages[i].conversation_id === conversationId) {
        memoryMessages.splice(i, 1);
      }
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
    timestamp?: number,
    metaErrorCode?: string | null,
    metaErrorDesc?: string | null,
    metaPricingCategory?: string | null
  ): Promise<{ matched: boolean }> {
    if (!waMessageId) return { matched: false };

    const data: any = { delivery_status: status };
    const ts = timestamp ? new Date(timestamp * 1000) : new Date();
    if (status === 'delivered') data.delivered_at = ts;
    if (status === 'read') data.read_at = ts;
    if (metaErrorCode !== undefined) data.meta_error_code = metaErrorCode;
    if (metaErrorDesc !== undefined) data.meta_error_desc = metaErrorDesc;
    if (metaPricingCategory !== undefined) data.meta_pricing_category = metaPricingCategory;

    try {
      const result = await (prisma.message as any).updateMany({
        where: { wa_message_id: waMessageId, tenant_id: tenantId },
        data,
      });
      return { matched: result.count > 0 };
    } catch (error) {
      console.warn('DB updateDeliveryStatus error (using fallback):', (error as Error).message);
      return { matched: false };
    }
  }

  /**
   * Mengambil pesan-pesan outbound terakhir yang memiliki aiReasoning pada payload_raw.
   */
  public async getRecentMessagesWithReasoning(tenantId: string, limit: number = 50): Promise<any[]> {
    try {
      const res = await prisma.message.findMany({
        where: {
          tenant_id: tenantId,
          direction: Direction.OUTBOUND,
          payload_raw: {
            path: ['aiReasoning'],
            not: Prisma.JsonNull,
          },
        },
        orderBy: { created_at: 'desc' },
        take: limit,
      });
      if (Array.isArray(res)) return res;
    } catch (error) {
      // DB offline / fallback
    }
    // Memory fallback untuk offline / unit test
    return memoryMessages
      .filter(m => m.tenant_id === tenantId && (m.direction === Direction.OUTBOUND || (m.direction as string) === 'OUTBOUND') && (m.payload_raw?.aiReasoning || m.payloadRaw?.aiReasoning))
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, limit);
  }

  public getMemoryMessages(): any[] {
    return memoryMessages;
  }
}


export const messageService = new MessageService();
