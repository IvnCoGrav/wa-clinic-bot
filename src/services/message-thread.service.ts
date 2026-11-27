/**
 * Modul kanonis BACA thread pesan Live Chat (paginasi dua arah).
 *
 * Dipisah dari `message.service.ts` (mutasi pesan) agar batas modul jelas dan
 * file tidak menjadi God Object. Semua query di sini tenant-scoped via
 * `conversation_id + tenant_id`; tidak ada data bisnis di-hardcode.
 *
 * Kontrak halaman: `hasMore` = masih ada pesan LEBIH LAMA, `hasNewer` = masih
 * ada pesan LEBIH BARU, `newestCursor` = cursor komposit pesan terakhir batch.
 */
import { prisma } from '../db/client';
import { decodeMessageCursor, encodeMessageCursor } from '../utils/message-cursor';
import { memoryMessages } from './message-memory.store';

export interface MessageThreadPage {
  messages: any[];
  hasMore: boolean;
  hasNewer: boolean;
  newestCursor: string | null;
}

interface ThreadCursor {
  createdAt: Date;
  id?: string;
}

/** Metadata pin/hide bubble Live Chat — dipakai semua varian paginasi pesan. */
function enrichLiveChatMessage(m: any) {
  return {
    ...m,
    is_message_pinned: !!(m.is_message_pinned || m.payload_raw?.is_pinned),
    is_message_hidden: !!(m.is_message_hidden || m.payload_raw?.is_hidden),
    pinned_by: m.pinned_by || m.payload_raw?.pinned_by || null,
    pinned_at: m.pinned_at || m.payload_raw?.pinned_at || null,
    hidden_by: m.hidden_by || m.payload_raw?.hidden_by || null,
    hidden_at: m.hidden_at || m.payload_raw?.hidden_at || null,
  };
}

/** Filter "setelah cursor" dengan tie-breaker id (kembaran filter `before`). */
function afterCursorWhere(cursor: ThreadCursor) {
  return cursor.id
    ? { OR: [{ created_at: { gt: cursor.createdAt } }, { created_at: cursor.createdAt, id: { gt: cursor.id } }] }
    : { created_at: { gt: cursor.createdAt } };
}

/** Pesan `later` lebih baru dari `anchor` menurut urutan komposit (created_at, id). */
function isMessageNewerThan(later: any, anchor: any): boolean {
  const t = new Date(later?.created_at).getTime();
  const a = new Date(anchor?.created_at).getTime();
  if (Number.isNaN(t) || Number.isNaN(a)) return false;
  if (t !== a) return t > a;
  if (!anchor?.id) return false;
  return String(later?.id) > String(anchor.id);
}

function sortByCreatedAtThenId(a: any, b: any): number {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (ta !== tb) return ta - tb;
  return String(a.id).localeCompare(String(b.id));
}

class MessageThreadService {
  /**
   * Varian paged: mengambil `limit` pesan + flag hasMore (take limit+1).
   * Backward-compatible: tanpa `before` hasilnya identik dengan 50 pesan terakhir.
   *
   * Dua arah: `before` (riwayat lama) dan `after` (pesan lebih baru). `focusMessageId`
   * mengembalikan jendela di sekitar pesan target plus penanda `hasNewer`/`newestCursor`
   * agar frontend bisa melanjutkan ke pesan terbaru.
   */
  public async getRecentMessagesWithHasMore(
    conversationId: string,
    limit: number,
    tenantId: string,
    before?: string | Date,
    focusMessageId?: string,
    after?: string | Date
  ): Promise<MessageThreadPage> {
    // Cursor komposit (created_at, id) — tie-breaker anti "riwayat bolong" (T-09).
    const beforeCursor = decodeMessageCursor(before);
    const afterCursor = decodeMessageCursor(after);
    if (afterCursor) {
      return this.getMessagesAfterCursor(conversationId, limit, tenantId, afterCursor);
    }

    // Focus-window: kembalikan batch yang pasti memuat pesan target (search-to-message direct jump).
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
          const anchor = { createdAt: (target as any).created_at as Date, id: (target as any).id as string };
          // Urutan komposit (created_at, id) agar batas jendela konsisten dengan cursor `after`.
          const beforeRows = await prisma.message.findMany({
            where: {
              conversation_id: conversationId,
              tenant_id: tenantId,
              OR: [
                { created_at: { lt: anchor.createdAt } },
                { created_at: anchor.createdAt, id: { lte: anchor.id } },
              ],
            },
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            take: half + 1,
          });
          const afterRows = await prisma.message.findMany({
            where: {
              conversation_id: conversationId,
              tenant_id: tenantId,
              OR: [
                { created_at: { gt: anchor.createdAt } },
                { created_at: anchor.createdAt, id: { gt: anchor.id } },
              ],
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            take: half,
          });
          const combined = [...beforeRows.reverse(), ...afterRows];
          // Pastikan target ada di hasil (guard idempoten bila created_at kembar)
          const hasTarget = combined.some(
            (m: any) =>
              m.id === (target as any).id ||
              ((m as any).wa_message_id && (m as any).wa_message_id === (target as any).wa_message_id)
          );
          const messages = hasTarget
            ? combined
            : [...combined, target].sort(
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
          const newest = messages.length > 0 ? (messages[messages.length - 1] as any) : null;
          let hasNewer = false;
          if (newest) {
            const newerCount = await prisma.message.count({
              where: { conversation_id: conversationId, tenant_id: tenantId, ...afterCursorWhere(newest) },
            });
            hasNewer = newerCount > 0;
          }
          return {
            messages: messages.map(enrichLiveChatMessage),
            hasMore,
            hasNewer,
            newestCursor: newest ? encodeMessageCursor(newest.created_at, newest.id) : null,
          };
        }
      } catch (_) {
        // Fallback memory di bawah bila DB offline
      }

      // Memory fallback untuk focus-window (DB offline / target hanya di memori)
      const memAll = memoryMessages
        .filter((m) => m.conversation_id === conversationId && m.tenant_id === tenantId)
        .sort(sortByCreatedAtThenId);
      const targetIdx = memAll.findIndex((m) => m.id === focusMessageId || m.wa_message_id === focusMessageId);
      if (targetIdx >= 0) {
        const half = Math.max(10, Math.floor(limit / 2));
        const start = Math.max(0, targetIdx - half);
        const end = Math.min(memAll.length, targetIdx + half + 1);
        const window = memAll.slice(start, end);
        const newest = window.length > 0 ? (window[window.length - 1] as any) : null;
        const hasNewer = newest ? memAll.some((m) => isMessageNewerThan(m, newest)) : false;
        return {
          messages: window.map(enrichLiveChatMessage),
          hasMore: start > 0,
          hasNewer,
          newestCursor: newest ? encodeMessageCursor(newest.created_at, newest.id) : null,
        };
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
      const page = rows.slice(0, limit);
      const newest = page.length > 0 ? (page[page.length - 1] as any) : null;
      return {
        messages: page.reverse().map(enrichLiveChatMessage),
        hasMore,
        hasNewer: false,
        newestCursor: newest ? encodeMessageCursor(newest.created_at, newest.id) : null,
      };
    } catch (_) {
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
      const page = all.slice(0, limit).reverse();
      const newest = page.length > 0 ? (page[page.length - 1] as any) : null;
      return {
        messages: page.map(enrichLiveChatMessage),
        hasMore: all.length > limit,
        hasNewer: false,
        newestCursor: newest ? encodeMessageCursor(newest.created_at, newest.id) : null,
      };
    }
  }

  /**
   * Halaman pesan yang LEBIH BARU dari cursor (arah `after`).
   * Kronologis lama→baru, `hasNewer` menandakan masih ada halaman berikutnya.
   */
  private async getMessagesAfterCursor(
    conversationId: string,
    limit: number,
    tenantId: string,
    cursor: ThreadCursor
  ): Promise<MessageThreadPage> {
    const where = afterCursorWhere(cursor);
    try {
      const rows = await prisma.message.findMany({
        where: { conversation_id: conversationId, tenant_id: tenantId, ...where },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit);
      const newest = messages.length > 0 ? (messages[messages.length - 1] as any) : null;
      return {
        messages: messages.map(enrichLiveChatMessage),
        hasMore,
        hasNewer: hasMore,
        newestCursor: newest ? encodeMessageCursor(newest.created_at, newest.id) : null,
      };
    } catch (_) {
      // Memory fallback (DB offline)
      const all = memoryMessages
        .filter((m) => m.conversation_id === conversationId && m.tenant_id === tenantId)
        .filter((m) => isMessageNewerThan(m, { created_at: cursor.createdAt, id: cursor.id }))
        .sort(sortByCreatedAtThenId);
      const messages = all.slice(0, limit);
      const newest = messages.length > 0 ? (messages[messages.length - 1] as any) : null;
      return {
        messages: messages.map(enrichLiveChatMessage),
        hasMore: all.length > limit,
        hasNewer: all.length > limit,
        newestCursor: newest ? encodeMessageCursor(newest.created_at, newest.id) : null,
      };
    }
  }
}

export const messageThreadService = new MessageThreadService();
