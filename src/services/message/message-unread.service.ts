import { prisma } from '../../db/client';
import { Direction } from '@prisma/client';
import { getLiveChatHub } from '../live-chat-hub.service';
import { responseCacheService } from '../response-cache.service';
import {
  memoryMessages,
  updateScopedMessage,
  updateScopedConversation,
} from './shared';

export class MessageUnreadService {
  /**
   * Menandai semua pesan inbound pada sebuah percakapan sebagai telah dibaca (read_at = now).
   * Menyetel is_manual_unread = false.
   */
  public async markConversationMessagesAsRead(conversationId: string, tenantId: string): Promise<void> {
    const now = new Date();
    let dbPersisted = false;

    // 1. Update di DB Prisma
    try {
      await prisma.message.updateMany({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          direction: Direction.INBOUND,
          read_at: null,
        },
        data: {
          read_at: now,
        },
      });

      // Jangan telan error update conversation: `dbPersisted` harus mencerminkan
      // status baca yang benar-benar tersinkron (T-01).
      await updateScopedConversation(conversationId, tenantId, {
        is_manual_unread: false,
      });
      dbPersisted = true;
    } catch (error) {
      // Memory fallback. JANGAN klaim persisten — lihat gerbang publish di bawah.
      console.warn('[MESSAGE] mark-as-read DB gagal, memakai memory fallback:', (error as Error)?.message);
    }

    // 2. Update memory store fallback
    for (const m of memoryMessages) {
      if (m.conversation_id === conversationId && m.tenant_id === tenantId && m.direction === 'INBOUND' && !m.read_at) {
        m.read_at = now;
      }
    }

    try {
      const { conversationService } = await import('../conversation.service');
      await conversationService.setManualUnread(conversationId, tenantId, false);
    } catch {}

    // Broadcast ke seluruh dashboard agar badge unread admin lain padam real-time
    // (bukan hanya klien yang memicu mark-as-read).
    //
    // GERBANG KODE (audit #316 / T-01): HANYA siarkan unread=0 bila update DB
    // benar-benar berhasil. Sebelumnya kegagalan DB ditelan lalu semua dashboard
    // diberi tahu "sudah dibaca" — badge padam, lalu unread muncul lagi saat reload.
    if (dbPersisted) {
      try {
        const hub = getLiveChatHub();
        await hub.publish({
          type: 'conversation.updated',
          tenantId,
          payload: {
            conversationId,
            unreadCount: 0,
            isManualUnread: false,
          },
        });
      } catch (hubErr: any) {
        console.warn('[HUB] Failed to publish conversation.updated (mark-as-read):', hubErr.message);
      }
    } else {
      console.warn('[MESSAGE] Skip broadcast unread=0: status baca belum tersinkron ke DB.');
    }

    responseCacheService.invalidatePrefix('livechat:');
  }

  /**
   * Menandai percakapan sebagai belum dibaca (manual mark as unread).
   * Mengosongkan read_at pada pesan inbound terakhir dan menyetel is_manual_unread = true.
   */
  public async markConversationAsUnread(conversationId: string, tenantId: string): Promise<void> {
    // 1. Update di DB Prisma
    try {
      await updateScopedConversation(conversationId, tenantId, {
        is_manual_unread: true,
      });

      // Cari pesan inbound terakhir dan set read_at = null
      const lastInbound = await prisma.message.findFirst({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          direction: Direction.INBOUND,
        },
        orderBy: { created_at: 'desc' },
      });

      if (lastInbound) {
        await updateScopedMessage(lastInbound.id, tenantId, { read_at: null });
      }
    } catch (error) {
      // Memory fallback
    }

    // 2. Update memory store fallback
    const memInbounds = memoryMessages
      .filter((m) => m.conversation_id === conversationId && m.tenant_id === tenantId && m.direction === 'INBOUND')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (memInbounds.length > 0) {
      memInbounds[0].read_at = null;
    }

    try {
      const { conversationService } = await import('../conversation.service');
      await conversationService.setManualUnread(conversationId, tenantId, true);
    } catch {}
    responseCacheService.invalidatePrefix('livechat:');
  }

  /**
   * Mengambil jumlah pesan unread secara batch per conversation_id.
   */
  public async getUnreadCountsBatch(conversationIds: string[], tenantId: string): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!conversationIds.length) return result;

    try {
      const rows = await prisma.message.groupBy({
        by: ['conversation_id'],
        where: {
          conversation_id: { in: conversationIds },
          tenant_id: tenantId,
          direction: Direction.INBOUND,
          read_at: null,
        },
        _count: { id: true },
      });

      for (const r of rows) {
        result.set(r.conversation_id, r._count.id);
      }
    } catch {
      // Fallback ke memory store
      for (const cid of conversationIds) {
        const unreadMem = memoryMessages.filter(
          (m) => m.conversation_id === cid && m.tenant_id === tenantId && m.direction === 'INBOUND' && !m.read_at
        ).length;
        if (unreadMem > 0) {
          result.set(cid, unreadMem);
        }
      }
    }

    return result;
  }

  /**
   * Mengambil total unread count seluruh percakapan pada tenant secara instan (agregat cepat).
   */
  public async getTotalUnreadCount(tenantId: string): Promise<number> {
    try {
      const inboundUnread = await prisma.message.count({
        where: {
          tenant_id: tenantId,
          direction: Direction.INBOUND,
          read_at: null,
          conversation: {
            customer: {
              is_sandbox_test: false,
            },
          },
        },
      });

      const manualUnread = await prisma.conversation.count({
        where: {
          tenant_id: tenantId,
          is_manual_unread: true,
          customer: {
            is_sandbox_test: false,
          },
          messages: {
            none: {
              direction: Direction.INBOUND,
              read_at: null,
            },
          },
        },
      });

      return inboundUnread + manualUnread;
    } catch {
      // Memory store fallback
      const unreadMemMessages = memoryMessages.filter(
        (m) => m.tenant_id === tenantId && m.direction === 'INBOUND' && !m.read_at
      ).length;
      return unreadMemMessages;
    }
  }

  /**
   * Menandai SEMUA pesan pada semua percakapan dalam sebuah tenant sebagai telah dibaca (read_at = now).
   * Menyetel is_manual_unread = false pada semua percakapan.
   */
  public async markAllMessagesAsRead(tenantId: string): Promise<number> {
    const now = new Date();
    let updatedCount = 0;

    // 1. Update di database PostgreSQL
    try {
      const res = await prisma.message.updateMany({
        where: {
          tenant_id: tenantId,
          direction: Direction.INBOUND,
          read_at: null,
        },
        data: {
          read_at: now,
        },
      });
      updatedCount = res.count;

      await prisma.conversation.updateMany({
        where: {
          tenant_id: tenantId,
          is_manual_unread: true,
        },
        data: {
          is_manual_unread: false,
        },
      });
    } catch (error) {
      // Memory fallback
    }

    // 2. Update memory store fallback
    for (const m of memoryMessages) {
      if (m.tenant_id === tenantId && m.direction === 'INBOUND' && !m.read_at) {
        m.read_at = now;
        updatedCount++;
      }
    }

    try {
      const { conversationService } = await import('../conversation.service');
      const convResult = await conversationService.listConversations(tenantId, 1000, 0, 'all');
      const convs = Array.isArray(convResult) ? convResult : convResult.items;
      for (const c of convs) {
        if (c.is_manual_unread) {
          await conversationService.setManualUnread(c.id, tenantId, false);
        }
      }
    } catch {}

    responseCacheService.invalidatePrefix('livechat:');
    return updatedCount;
  }

  public getMemoryMessages(): any[] {
    return memoryMessages;
  }
}

export const messageUnreadService = new MessageUnreadService();
