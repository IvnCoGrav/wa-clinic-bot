import { prisma } from '../../db/client';
import { Direction, Prisma } from '@prisma/client';
import { decodeMessageCursor } from '../../utils/message-cursor';
import { memoryMessages, updateScopedConversation } from './shared';

export class MessageQueryService {
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
   * Mengambil satu pesan berdasarkan ID internal atau wa_message_id (DB dengan in-memory fallback).
   */
  public async getMessageById(messageId: string, tenantId: string): Promise<any | null> {
    if (!messageId) return null;
    try {
      const message = await prisma.message.findFirst({
        where: {
          OR: [
            { id: messageId },
            { wa_message_id: messageId },
          ],
          tenant_id: tenantId,
        },
      });
      if (message) return message;
    } catch (_) {}

    // Fallback memory store
    const found = memoryMessages.find(
      (m) =>
        (m.id === messageId || m.wa_message_id === messageId) &&
        m.tenant_id === tenantId
    );
    return found || null;
  }

  /**
   * Mengambil pesan-pesan terakhir untuk percakapan tertentu (terurut kronologis).
   * Param opsional `before`: cursor ISO timestamp / Date — hanya pesan dengan
   * created_at < before yang diambil (untuk infinite scroll up).
   */
  public async getRecentMessages(conversationId: string, limit: number, tenantId: string, before?: string | Date): Promise<any[]> {
    const beforeDate = before ? new Date(before) : null;
    const validBefore = beforeDate && !isNaN(beforeDate.getTime()) ? beforeDate : null;
    try {
      const messages = await prisma.message.findMany({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          ...(validBefore ? { created_at: { lt: validBefore } } : {}),
        },
        orderBy: { created_at: 'desc' },
        take: limit,
      });
      return messages.reverse(); // Kembalikan ke urutan kronologis (lama -> baru)
    } catch (error) {
      // Memory fallback: ambil pesan terakhir (kronologis) untuk percakapan tsb
      return memoryMessages
        .filter((m) => m.conversation_id === conversationId && m.tenant_id === tenantId && (!validBefore || new Date(m.created_at) < validBefore))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(-limit);
    }
  }

  /**
   * Mengambil pesan yang disematkan (pinned message) dalam percakapan.
   */
  public async getPinnedMessage(conversationId: string, tenantId: string): Promise<any | null> {
    try {
      let pinnedId: string | null = null;
      try {
        const conv = await prisma.conversation.findFirst({
          where: { id: conversationId, tenant_id: tenantId },
          select: { session_data: true },
        });
        pinnedId = (conv?.session_data as any)?.pinned_message_id || null;
      } catch (_) {}

      if (!pinnedId) {
        try {
          const { conversationService } = await import('../conversation.service');
          const inMemConv = await conversationService.getConversationById(conversationId, tenantId);
          pinnedId = (inMemConv?.session_data as any)?.pinned_message_id || null;
        } catch (_) {}
      }

      if (pinnedId) {
        let msg: any = null;
        try {
          msg = await prisma.message.findFirst({
            where: {
              OR: [
                { id: pinnedId, conversation_id: conversationId, tenant_id: tenantId },
                { wa_message_id: pinnedId, conversation_id: conversationId, tenant_id: tenantId },
              ],
            },
          });
        } catch (_) {}

        if (!msg) {
          msg = memoryMessages.find(
            (m) =>
              (m.id === pinnedId || m.wa_message_id === pinnedId) &&
              m.conversation_id === conversationId &&
              m.tenant_id === tenantId
          );
        }

        if (msg) {
          const isRevoked = msg.content === '🚫 Pesan ini telah ditarik' || !!(msg.payload_raw as any)?.is_revoked;
          if (isRevoked) {
            // Pointer basi: pesan telah ditarik. Bersihkan pointer secara proaktif.
            try {
              const conv = await prisma.conversation.findFirst({
                where: { id: conversationId, tenant_id: tenantId },
                select: { id: true, session_data: true },
              });
              if (conv) {
                const session = conv.session_data && typeof conv.session_data === 'object' ? { ...(conv.session_data as any) } : {};
                delete session.pinned_message_id;
                await updateScopedConversation(conv.id, tenantId, { session_data: session });
              }
            } catch (_) {}
            try {
              const { conversationService } = await import('../conversation.service');
              const inMemConv = await conversationService.getConversationById(conversationId, tenantId);
              if (inMemConv && inMemConv.session_data) {
                delete (inMemConv.session_data as any).pinned_message_id;
              }
            } catch (_) {}
            return null;
          }

          return {
            id: msg.id,
            wa_message_id: msg.wa_message_id ?? null,
            content: msg.content,
            sender_name: msg.sender_name ?? null,
            sender_type: msg.sender_type ?? null,
            created_at: msg.created_at,
            is_message_pinned: true,
            pinned_by: (msg.payload_raw as any)?.pinned_by ?? null,
            pinned_at: (msg.payload_raw as any)?.pinned_at ?? null,
          };
        }
      }

      // Fallback: cari di memoryMessages bila DB offline atau belum ada session_data pointer
      const memPinned = memoryMessages.find(
        (m) =>
          m.conversation_id === conversationId &&
          m.tenant_id === tenantId &&
          m.payload_raw?.is_pinned &&
          !m.payload_raw?.is_revoked &&
          m.content !== '🚫 Pesan ini telah ditarik'
      );
      if (memPinned) {
        return {
          id: memPinned.id,
          wa_message_id: memPinned.wa_message_id ?? null,
          content: memPinned.content,
          sender_name: memPinned.sender_name ?? null,
          sender_type: memPinned.sender_type ?? null,
          created_at: memPinned.created_at,
          is_message_pinned: true,
          pinned_by: memPinned.payload_raw?.pinned_by ?? null,
          pinned_at: memPinned.payload_raw?.pinned_at ?? null,
        };
      }

      return null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Varian paged: mengambil `limit` pesan + flag hasMore (take limit+1).
   * Backward-compatible: tanpa `before` hasilnya identik dengan getRecentMessages.
   * Dilengkapi enrich metadata pin/hide bubble chat dan ringkasan pinnedMessage.
   */
  public async getRecentMessagesWithHasMore(
    conversationId: string,
    limit: number,
    tenantId: string,
    before?: string | Date,
    focusMessageId?: string,
    getPinnedMessageFn?: (conversationId: string, tenantId: string) => Promise<any | null>
  ): Promise<{ messages: any[]; hasMore: boolean; pinnedMessage?: any }> {
    const fetchPinned = getPinnedMessageFn || this.getPinnedMessage.bind(this);
    const enrichMessage = (m: any) => ({
      ...m,
      is_message_pinned: !!(m.is_message_pinned || m.payload_raw?.is_pinned),
      is_message_hidden: !!(m.is_message_hidden || m.payload_raw?.is_hidden),
      pinned_by: m.pinned_by || m.payload_raw?.pinned_by || null,
      pinned_at: m.pinned_at || m.payload_raw?.pinned_at || null,
      hidden_by: m.hidden_by || m.payload_raw?.hidden_by || null,
      hidden_at: m.hidden_at || m.payload_raw?.hidden_at || null,
    });

    // Cursor komposit (created_at, id) — tie-breaker anti "riwayat bolong" (T-09).
    const beforeCursor = decodeMessageCursor(before);
    const validBefore = beforeCursor?.createdAt || null;
    // Focus-window: kembalikan batch yang pasti memuat pesan target (search-to-message direct jump).
    // Tenant-aware via conversation_id + tenant_id; tanpa hardcode bisnis.
    if (focusMessageId && !beforeCursor) {
      try {
        const target = await prisma.message.findFirst({
          where: {
            conversation_id: conversationId,
            tenant_id: tenantId,
            OR: [{ id: focusMessageId }, { wa_message_id: focusMessageId }],
          },
        });
        if (target) {
          const half = Math.max(10, Math.floor(limit / 2));
          const beforeRows = await prisma.message.findMany({
            where: {
              conversation_id: conversationId,
              tenant_id: tenantId,
              created_at: { lte: (target as any).created_at },
            },
            orderBy: { created_at: 'desc' },
            take: half + 1,
          });
          const afterRows = await prisma.message.findMany({
            where: {
              conversation_id: conversationId,
              tenant_id: tenantId,
              created_at: { gt: (target as any).created_at },
            },
            orderBy: { created_at: 'asc' },
            take: half,
          });
          const combined = [...beforeRows.reverse(), ...afterRows];
          // Pastikan target ada di hasil (guard idempoten bila created_at kembar)
          const hasTarget = combined.some(
            (m: any) => m.id === (target as any).id || ((m as any).wa_message_id && (m as any).wa_message_id === (target as any).wa_message_id)
          );
          const messages = hasTarget ? combined : [...combined, target].sort(
            (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          const oldest = messages.length > 0 ? new Date((messages[0] as any).created_at) : null;
          let hasMore = false;
          if (oldest) {
            const olderCount = await prisma.message.count({
              where: { conversation_id: conversationId, tenant_id: tenantId, created_at: { lt: oldest } },
            });
            hasMore = olderCount > 0;
          }
          const pinnedMessage = await fetchPinned(conversationId, tenantId);
          return { messages: messages.map(enrichMessage), hasMore, pinnedMessage };
        }
      } catch (_) {
        // Fallback memory di bawah bila DB offline
      }
      // Memory fallback untuk focus-window (DB offline / target hanya di memori)
      const memAll = memoryMessages
        .filter((m) => m.conversation_id === conversationId && m.tenant_id === tenantId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const targetIdx = memAll.findIndex((m) => m.id === focusMessageId || m.wa_message_id === focusMessageId);
      if (targetIdx >= 0) {
        const half = Math.max(10, Math.floor(limit / 2));
        const start = Math.max(0, targetIdx - half);
        const end = Math.min(memAll.length, targetIdx + half + 1);
        const pinnedMessage = await fetchPinned(conversationId, tenantId);
        return { messages: memAll.slice(start, end).map(enrichMessage), hasMore: start > 0, pinnedMessage };
      }
      // Target tak ditemukan → lanjut ke path normal di bawah
    }
    const beforeWhere = beforeCursor
      ? beforeCursor.id
        ? {
            OR: [
              { created_at: { lt: beforeCursor.createdAt } },
              { created_at: beforeCursor.createdAt, id: { lt: beforeCursor.id } },
            ],
          }
        : { created_at: { lt: beforeCursor.createdAt } }
      : {};
    try {
      const rows = await prisma.message.findMany({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          ...beforeWhere,
        },
        // Tie-breaker id WAJIB konsisten dengan filter `id: { lt: ... }` di atas.
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const pinnedMessage = await fetchPinned(conversationId, tenantId);
      return { messages: rows.slice(0, limit).reverse().map(enrichMessage), hasMore, pinnedMessage };
    } catch (error) {
      const isOlderThanCursor = (m: any): boolean => {
        if (!beforeCursor) return true;
        const t = new Date(m.created_at).getTime();
        const c = beforeCursor.createdAt.getTime();
        if (Number.isNaN(t)) return false;
        if (t !== c) return t < c;
        return beforeCursor.id ? String(m.id) < beforeCursor.id : false;
      };
      const all = memoryMessages
        .filter((m) => m.conversation_id === conversationId && m.tenant_id === tenantId && isOlderThanCursor(m))
        .sort((a, b) => {
          const ta = new Date(a.created_at).getTime();
          const tb = new Date(b.created_at).getTime();
          if (ta !== tb) return tb - ta;
          return String(b.id).localeCompare(String(a.id));
        });
      const pinnedMessage = await fetchPinned(conversationId, tenantId);
      return { messages: all.slice(0, limit).reverse().map(enrichMessage), hasMore: all.length > limit, pinnedMessage };
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
}

export const messageQueryService = new MessageQueryService();
