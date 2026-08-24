import { prisma } from '../db/client';
import { Direction, Prisma } from '@prisma/client';
import { getLiveChatHub } from './live-chat-hub.service';

// In-Memory store fallback untuk idempotency check jika DB belum terkoneksi saat dev local
const memoryWaMessageIds = new Set<string>();

// In-Memory store fallback untuk record pesan (agar Live Chat panel tetap jalan saat DB offline)
const memoryMessages: any[] = [];

// In-Memory registry untuk bot outbound yang sedang dalam proses simulasi mengetik/kirim (in-flight)
interface InFlightBotOutbound {
  chatId: string;
  phone: string;
  content: string;
  tenantId: string;
  expiresAt: number;
}
const inFlightBotOutbounds: InFlightBotOutbound[] = [];

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

export function extractShortMessageId(waMessageId: string): string {
  if (!waMessageId) return '';
  const match = waMessageId.match(/(?:true|false)_[^@]+@[^_]+_([A-Za-z0-9_\-]+)$/);
  if (match) return match[1];
  return waMessageId;
}

export class MessageService {
  /**
   * Daftarkan konten outbound bot sebelum atau saat sedang proses pengiriman bubble (in-flight).
   * Mencegah webhook echo dari WAHA salah mendeteksi bubble bot sebagai balasan manual admin.
   */
  public registerInFlightBotOutbound(chatId: string, content: string, tenantId: string, ttlMs = 45000): void {
    if (!chatId || !content) return;
    const cleanPhone = chatId.replace(/@.*$/, '').replace(/[^\d]/g, '');
    const cleanContent = content.trim();
    if (!cleanContent) return;

    const expiresAt = Date.now() + ttlMs;
    inFlightBotOutbounds.push({
      chatId,
      phone: cleanPhone,
      content: cleanContent,
      tenantId,
      expiresAt,
    });
  }

  /**
   * Hapus registrasi in-flight bot outbound setelah pengiriman selesai/dibatalkan.
   */
  public clearInFlightBotOutbound(chatId: string, tenantId?: string): void {
    const cleanPhone = chatId ? chatId.replace(/@.*$/, '').replace(/[^\d]/g, '') : '';
    const now = Date.now();
    for (let i = inFlightBotOutbounds.length - 1; i >= 0; i--) {
      const entry = inFlightBotOutbounds[i];
      if (entry.expiresAt <= now || (cleanPhone && entry.phone === cleanPhone && (!tenantId || entry.tenantId === tenantId))) {
        inFlightBotOutbounds.splice(i, 1);
      }
    }
  }

  /**
   * Pengecekan apakah pesan outbound yang diterima di webhook merupakan bubble bot yang sedang in-flight.
   */
  public isInFlightBotOutbound(
    chatIdOrPhone: string,
    content: string,
    tenantId: string,
    customWindowMs = 60000
  ): boolean {
    if (!chatIdOrPhone || !content) return false;
    const cleanPhone = chatIdOrPhone.replace(/@.*$/, '').replace(/[^\d]/g, '');
    const normalizedContent = content.trim().toLowerCase().replace(/\s+/g, ' ');
    const now = Date.now();

    // Cleanup expired
    for (let i = inFlightBotOutbounds.length - 1; i >= 0; i--) {
      if (inFlightBotOutbounds[i].expiresAt <= now) {
        inFlightBotOutbounds.splice(i, 1);
      }
    }

    const matched = inFlightBotOutbounds.find((entry) => {
      if (tenantId && entry.tenantId !== tenantId) return false;
      const phoneMatch = !cleanPhone || !entry.phone || entry.phone === cleanPhone || entry.chatId.includes(cleanPhone);
      if (!phoneMatch) return false;

      // Custom window check jika ditentukan
      if (customWindowMs && now - (entry.expiresAt - 60000) > customWindowMs) {
        return false;
      }

      const entryNorm = entry.content.toLowerCase().trim().replace(/\s+/g, ' ');
      if (entryNorm === normalizedContent) return true;

      // Substring / prefix match (antisipasi WAHA memotong/trimming teks)
      const checkLen = Math.min(entryNorm.length, normalizedContent.length, 60);
      if (checkLen >= 15 && entryNorm.slice(0, checkLen) === normalizedContent.slice(0, checkLen)) {
        return true;
      }
      return false;
    });

    if (matched) {
      console.log(`[IN-FLIGHT BOT MATCH] Outbound echo matched in-flight bot bubble for ${chatIdOrPhone}: "${content.slice(0, 40)}..."`);
      return true;
    }

    return false;
  }
  /**
   * Pengecekan Idempotensi: Memeriksa apakah wa_message_id dari Meta sudah pernah diproses.
   * Mengembalikan true jika pesan SUDAH PERNAH diproses sebelumnya (duplicate/retry).
   */
  public async isDuplicateMessage(waMessageId: string, tenantId: string): Promise<boolean> {
    if (!waMessageId) return false;

    const shortId = extractShortMessageId(waMessageId);
    const keysToCheck = [
      `${tenantId}:${waMessageId}`,
      shortId !== waMessageId ? `${tenantId}:${shortId}` : null,
    ].filter(Boolean) as string[];

    // 1. Cek memory store dulu
    for (const key of keysToCheck) {
      if (memoryWaMessageIds.has(key)) {
        return true;
      }
    }

    // Tambahkan kedua key ke memory store sebagai lock in-flight agar request paralel tertahan
    for (const key of keysToCheck) {
      memoryWaMessageIds.add(key);
    }

    try {
      // 2. Query ke Prisma DB
      const orConditions: any[] = [{ wa_message_id: waMessageId }];
      if (shortId && shortId !== waMessageId) {
        orConditions.push({ wa_message_id: shortId });
        orConditions.push({ wa_message_id: { endsWith: `_${shortId}` } });
      }

      const existing = await prisma.message.findFirst({
        where: {
          tenant_id: tenantId,
          OR: orConditions,
        },
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
   * Pengecekan deduplikasi outbound: memeriksa apakah pesan outbound dengan konten serupa
   * baru saja dicatat (misal via Live Chat / Staff Dashboard) dalam window detik tertentu.
   * Jika ada, tautkan wa_message_id pesan tersebut agar tidak membuat baris baru ganda di database.
   */
  public async checkAndAttachOutboundDuplicate(
    conversationId: string,
    content: string,
    waMessageId: string,
    tenantId: string,
    windowSeconds = 60,
    isImage = false
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - windowSeconds * 1000);
    const normalizedContent = (content || '').trim();
    const isImagePlaceholder = isImage || !normalizedContent || /^\[(IMAGE|MEDIA|GAMBAR)/i.test(normalizedContent);
    const shortId = extractShortMessageId(waMessageId);

    // 1. Cek memoryMessages fallback
    const memMsg = memoryMessages.find(
      (m) =>
        m.conversation_id === conversationId &&
        m.tenant_id === tenantId &&
        m.direction === 'OUTBOUND' &&
        new Date(m.created_at) >= cutoff &&
        (
          (isImagePlaceholder && (!m.content || /^\[(IMAGE|MEDIA|GAMBAR)/i.test((m.content || '').trim()) || !!(m.payload_raw as any)?.media)) ||
          (!isImagePlaceholder && (m.content || '').trim().toLowerCase() === normalizedContent.toLowerCase())
        )
    );
    if (memMsg) {
      if (!memMsg.wa_message_id && waMessageId) {
        memMsg.wa_message_id = waMessageId;
        memoryWaMessageIds.add(`${tenantId}:${waMessageId}`);
        if (shortId && shortId !== waMessageId) {
          memoryWaMessageIds.add(`${tenantId}:${shortId}`);
        }
      }
      return true;
    }

    // 2. Cek DB Prisma
    try {
      let whereClause: any = {
        conversation_id: conversationId,
        tenant_id: tenantId,
        direction: 'OUTBOUND',
        created_at: { gte: cutoff },
      };

      if (isImagePlaceholder) {
        whereClause.OR = [
          { content: { startsWith: '[IMAGE' } },
          { content: { startsWith: '[MEDIA' } },
          { content: { startsWith: '[GAMBAR' } },
          { content: '[IMAGE]' },
          { content: '[MEDIA]' },
        ];
      } else {
        whereClause.content = {
          equals: normalizedContent,
          mode: 'insensitive',
        };
      }

      const existing = await prisma.message.findFirst({
        where: whereClause,
        orderBy: { created_at: 'desc' },
      });

      if (existing) {
        if (!existing.wa_message_id && waMessageId) {
          await prisma.message.update({
            where: { id: existing.id },
            data: { wa_message_id: waMessageId },
          });
        }
        memoryWaMessageIds.add(`${tenantId}:${waMessageId}`);
        if (shortId && shortId !== waMessageId) {
          memoryWaMessageIds.add(`${tenantId}:${shortId}`);
        }
        return true;
      }
    } catch (_) {}

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
    skipMqlEvaluation?: boolean;
    createdAt?: Date;
    readAt?: Date | null;
    isHistorical?: boolean;
  }) {
    if (data.waMessageId) {
      memoryWaMessageIds.add(`${data.tenantId}:${data.waMessageId}`);
      const shortId = extractShortMessageId(data.waMessageId);
      if (shortId && shortId !== data.waMessageId) {
        memoryWaMessageIds.add(`${data.tenantId}:${shortId}`);
      }
    }

    const effectiveReadAt = data.readAt !== undefined
      ? data.readAt
      : data.isHistorical
        ? (data.createdAt || new Date())
        : undefined;

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
          sender_type: data.senderType ?? (data.direction === 'INBOUND' || (data.direction as any) === Direction.INBOUND ? 'CUSTOMER' : 'BOT'),
          sender_name: data.senderName ?? undefined,
          delivery_status: data.deliveryStatus ?? undefined,
          meta_error_code: data.metaErrorCode ?? undefined,
          meta_error_desc: data.metaErrorDesc ?? undefined,
          created_at: data.createdAt || undefined,
          read_at: effectiveReadAt ?? undefined,
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
        created_at: data.createdAt || new Date(),
        read_at: effectiveReadAt ?? null,
      };
      memoryMessages.push(fallbackMessage);
      return fallbackMessage;
    } finally {
      // Jika pesan INBOUND (dari customer) dan bukan sinkronisasi riwayat masa lalu (skipMqlEvaluation), increment bubble count & evaluasi status MQL
      if (!data.skipMqlEvaluation && (data.direction === Direction.INBOUND || (data.direction as string) === 'INBOUND')) {
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
            isHistorical: !!data.isHistorical,
          },
        })
        .catch(() => {});

      // Web Push Background Notification: kirim ke perangkat yang sedang offline/background (hanya pesan live real-time, bukan riwayat)
      if ((data.direction === 'INBOUND' || (data.direction as any) === Direction.INBOUND) && !data.isHistorical) {
        void (async () => {
          try {
            const { webPushService } = await import('./web-push.service');
            const { customerService } = await import('./customer.service');
            const { conversationService } = await import('./conversation.service');

            let senderName = data.senderName || 'Pelanggan';
            let customerId = '';
            try {
              const conv = await conversationService.getConversationById(data.conversationId, data.tenantId);
              if (conv?.customer_id) {
                customerId = conv.customer_id;
                const customer = await customerService.getCustomerById(conv.customer_id, data.tenantId);
                if (customer) {
                  if (customer.name) senderName = customer.name;
                }
              }
            } catch {}

            const avatarUrl = customerId
              ? `/media/avatar/${customerId}.jpg`
              : `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=008069&color=fff&size=256&bold=true`;

            const snippet = data.content
              ? (data.content.length > 120 ? data.content.slice(0, 117) + '...' : data.content)
              : '📷 Mengirim lampiran gambar / media';

            const media = extractMediaFromPayload(data.payloadRaw);
            const imageUrl = media?.url || avatarUrl;

            await webPushService.sendPushToTenant(data.tenantId, {
              title: senderName,
              body: snippet,
              icon: avatarUrl,
              badge: '/admin/favicon.ico',
              image: imageUrl,
              url: `/admin/#/live-chat?conversationId=${data.conversationId}`,
              tag: `chat-${data.conversationId}`,
            });
          } catch {}
        })();
      }
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

    const suffix = waMessageId.includes('_') ? waMessageId.split('_').pop() : waMessageId;

    let matchedMessageId: string | null = null;
    let matchedConversationId: string | null = null;

    // 1. Update memory store fallback
    for (const mem of memoryMessages) {
      if (
        mem.wa_message_id === waMessageId ||
        mem.id === waMessageId ||
        (suffix && mem.wa_message_id && (mem.wa_message_id.endsWith(suffix) || waMessageId.endsWith(mem.wa_message_id)))
      ) {
        mem.delivery_status = status;
        if (status === 'delivered') mem.delivered_at = ts;
        if (status === 'read') mem.read_at = ts;
        matchedMessageId = mem.id;
        matchedConversationId = mem.conversation_id;
      }
    }

    let isMatched = false;
    try {
      let whereClause: any = { wa_message_id: waMessageId, tenant_id: tenantId };
      if (suffix && suffix !== waMessageId) {
        whereClause = {
          OR: [
            { wa_message_id: waMessageId, tenant_id: tenantId },
            { wa_message_id: suffix, tenant_id: tenantId },
            { id: waMessageId, tenant_id: tenantId },
          ],
        };
      }

      try {
        const existing = await (prisma.message as any).findFirst?.({
          where: whereClause,
          select: { id: true, conversation_id: true },
        });
        if (existing) {
          matchedMessageId = existing.id;
          matchedConversationId = existing.conversation_id;
        }
      } catch (_) {}

      const result = await (prisma.message as any).updateMany({
        where: whereClause,
        data,
      });
      isMatched = result.count > 0;
    } catch (error) {
      console.warn('DB updateDeliveryStatus error (using fallback):', (error as Error).message);
    }

    // 3. Publish real-time SSE event ke Live Chat Monitor
    try {
      getLiveChatHub()
        .publish({
          type: 'message.status_updated',
          tenantId,
          payload: {
            messageId: matchedMessageId,
            waMessageId,
            conversationId: matchedConversationId,
            status,
            deliveredAt: data.delivered_at || null,
            readAt: data.read_at || null,
          },
        })
        .catch(() => {});
    } catch {}

    return { matched: isMatched || !!matchedMessageId };
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

  /**
   * Menandai pesan telah ditarik / dihapus untuk semua orang.
   * Memperbarui konten pesan menjadi teks penanda ditarik dan mem-broadcast update via SSE.
   */
  public async markMessageDeleted(messageId: string, tenantId: string): Promise<boolean> {
    const revokedContent = '🚫 Pesan ini telah ditarik';
    let conversationId: string | null = null;

    try {
      const msg = await prisma.message.findFirst({
        where: {
          id: messageId,
          tenant_id: tenantId,
        },
      });

      if (!msg) {
        // Cek via wa_message_id
        const msgWa = await prisma.message.findFirst({
          where: { wa_message_id: messageId, tenant_id: tenantId },
        });
        if (msgWa) {
          conversationId = msgWa.conversation_id;
          await prisma.message.update({
            where: { id: msgWa.id },
            data: {
              content: revokedContent,
              payload_raw: {
                ...(typeof msgWa.payload_raw === 'object' && msgWa.payload_raw ? msgWa.payload_raw : {}),
                is_revoked: true,
                revoked_at: new Date().toISOString(),
              },
            },
          });
        }
      } else {
        conversationId = msg.conversation_id;
        await prisma.message.update({
          where: { id: msg.id },
          data: {
            content: revokedContent,
            payload_raw: {
              ...(typeof msg.payload_raw === 'object' && msg.payload_raw ? msg.payload_raw : {}),
              is_revoked: true,
              revoked_at: new Date().toISOString(),
            },
          },
        });
      }
    } catch (error) {
      console.warn('DB markMessageDeleted error (using memory fallback):', (error as Error).message);
      // Fallback in-memory
      const inMem = memoryMessages.find(
        (m) => (m.id === messageId || m.wa_message_id === messageId) && m.tenant_id === tenantId
      );
      if (inMem) {
        inMem.content = revokedContent;
        inMem.payload_raw = { ...inMem.payload_raw, is_revoked: true };
        conversationId = inMem.conversation_id;
      }
    }

    // Broadcast update via LiveChatHub
    try {
      const hub = getLiveChatHub();
      await hub.publish({
        type: 'message.updated',
        tenantId,
        payload: {
          conversationId,
          messageId,
          content: revokedContent,
          isRevoked: true,
        },
      });
    } catch (hubErr: any) {
      console.warn('[HUB] Failed to publish message.updated event:', hubErr.message);
    }

    return true;
  }

  /**
   * Update konten pesan yang diedit (Edit Message).
   * Memperbarui tabel messages (payload_raw.is_edited = true, edited_at), memory fallback, dan broadcast event SSE 'message.updated'.
   */
  public async updateMessageContent(
    messageId: string,
    newContent: string,
    tenantId: string
  ): Promise<boolean> {
    let conversationId = '';

    try {
      let msg = await prisma.message.findFirst({
        where: {
          id: messageId,
          tenant_id: tenantId,
        },
      });

      if (!msg) {
        msg = await prisma.message.findFirst({
          where: { wa_message_id: messageId, tenant_id: tenantId },
        });
      }

      if (msg) {
        conversationId = msg.conversation_id;
        await prisma.message.update({
          where: { id: msg.id },
          data: {
            content: newContent,
            payload_raw: {
              ...(typeof msg.payload_raw === 'object' && msg.payload_raw ? msg.payload_raw : {}),
              is_edited: true,
              edited_at: new Date().toISOString(),
            },
          },
        });
      }
    } catch (error) {
      console.warn('DB updateMessageContent error (using memory fallback):', (error as Error).message);
      const inMem = memoryMessages.find(
        (m) => (m.id === messageId || m.wa_message_id === messageId) && m.tenant_id === tenantId
      );
      if (inMem) {
        inMem.content = newContent;
        inMem.payload_raw = { ...inMem.payload_raw, is_edited: true, edited_at: new Date().toISOString() };
        conversationId = inMem.conversation_id;
      }
    }

    // Broadcast update via LiveChatHub
    try {
      const hub = getLiveChatHub();
      await hub.publish({
        type: 'message.updated',
        tenantId,
        payload: {
          conversationId,
          messageId,
          content: newContent,
          isEdited: true,
          editedAt: new Date().toISOString(),
        },
      });
    } catch (hubErr: any) {
      console.warn('[HUB] Failed to publish message.updated event:', hubErr.message);
    }

    return true;
  }

  /**
   * Menandai semua pesan inbound pada sebuah percakapan sebagai telah dibaca (read_at = now).
   * Menyetel is_manual_unread = false.
   */
  public async markConversationMessagesAsRead(conversationId: string, tenantId: string): Promise<void> {
    const now = new Date();

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

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          is_manual_unread: false,
        },
      }).catch(() => {});
    } catch (error) {
      // Memory fallback
    }

    // 2. Update memory store fallback
    for (const m of memoryMessages) {
      if (m.conversation_id === conversationId && m.tenant_id === tenantId && m.direction === 'INBOUND' && !m.read_at) {
        m.read_at = now;
      }
    }

    try {
      const { conversationService } = await import('./conversation.service');
      await conversationService.setManualUnread(conversationId, tenantId, false);
    } catch {}
  }

  /**
   * Menandai percakapan sebagai belum dibaca (manual mark as unread).
   * Mengosongkan read_at pada pesan inbound terakhir dan menyetel is_manual_unread = true.
   */
  public async markConversationAsUnread(conversationId: string, tenantId: string): Promise<void> {
    // 1. Update di DB Prisma
    try {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          is_manual_unread: true,
        },
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
        await prisma.message.update({
          where: { id: lastInbound.id },
          data: { read_at: null },
        });
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
      const { conversationService } = await import('./conversation.service');
      await conversationService.setManualUnread(conversationId, tenantId, true);
    } catch {}
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
        },
      });

      const manualUnread = await prisma.conversation.count({
        where: {
          tenant_id: tenantId,
          is_manual_unread: true,
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
      const { conversationService } = await import('./conversation.service');
      const convs = await conversationService.listConversations(tenantId, 1000, 0, 'all');
      for (const c of convs) {
        if (c.is_manual_unread) {
          await conversationService.setManualUnread(c.id, tenantId, false);
        }
      }
    } catch {}

    return updatedCount;
  }

  public getMemoryMessages(): any[] {
    return memoryMessages;
  }
}

export const messageService = new MessageService();
