import { prisma } from '../../db/client';
import { Direction } from '@prisma/client';
import { getLiveChatHub } from '../live-chat-hub.service';
import { isDummyOrTestContact } from '../../utils/dummy-filter';
import { responseCacheService } from '../response-cache.service';
import {
  memoryMessages,
  MAX_MEMORY_MESSAGES,
  addMemoryWaMessageId,
  extractShortMessageId,
  resolveSenderType,
  extractMediaFromPayload,
  extractLocationFromPayload,
  sanitizePayloadForSse,
  updateScopedMessage,
} from './shared';

export class MessageLoggingService {
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
      addMemoryWaMessageId(`${data.tenantId}:${data.waMessageId}`);
      const shortId = extractShortMessageId(data.waMessageId);
      if (shortId && shortId !== data.waMessageId) {
        addMemoryWaMessageId(`${data.tenantId}:${shortId}`);
      }
    }

    const effectiveMsgDate = data.createdAt || new Date();
    const effectiveReadAt = data.readAt !== undefined
      ? data.readAt
      : data.isHistorical
        ? effectiveMsgDate
        : undefined;

    let saved: any = null;
    // PLAN 8 FASE 5c: tulis via Repository seam (fail-closed di produksi).
    // DB error → THROW (pemanggil/queue menangani via retry), BUKAN objek fiktif.
    const repo = (await import('../../repositories/message.repository')).getMessageRepository();
    const [savedMsg] = await Promise.all([
      repo.create({
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
      }),
      prisma.conversation?.update
        ? prisma.conversation
            .update({
              where: { id: data.conversationId },
              data: {
                last_message_at: effectiveMsgDate,
                updated_at: new Date(),
              },
            })
            ?.catch?.((convErr: any) => {
              console.warn('[MESSAGE LOG CONV UPDATE WARN]', convErr.message);
            })
        : Promise.resolve(),
    ]);
    saved = savedMsg;
    if (!saved) {
      throw new Error('Prisma create returned null/undefined (DB offline)');
    }
    memoryMessages.push(saved);
    // FIFO ring buffer: buang record tertua agar RAM tidak tumbuh tanpa batas.
    if (memoryMessages.length > MAX_MEMORY_MESSAGES) {
      memoryMessages.splice(0, memoryMessages.length - MAX_MEMORY_MESSAGES);
    }

    // Efek samping pasca-simpan (dulu blok finally): resolusi sandbox, MQL,
    // reschedule follow-up, publish livechat, web push. Semua best-effort dengan
    // try/catch sendiri — kegagalannya tidak membatalkan penyimpanan yang sukses.
    {
      // Resolusi info customer & deteksi apakah berasal dari percakapan Sandbox/QA Test
      let isSandboxCustomer = false;
      // Staf internal (CS/Bidan via nomor resmi klinik) — diperlakukan seperti non-pelanggan:
      // tidak memicu MQL, follow-up, push CRM, atau CAPI.
      let isInternalStaff = false;
      let resolvedCustomer: any = null;
      let conversationForSse: any = null;
      try {
        const { conversationService } = await import('../conversation.service');
        const { customerService } = await import('../customer.service');
        const conv = await conversationService.getConversationById(data.conversationId, data.tenantId);
        conversationForSse = conv;
        if (conv?.customer_id) {
          resolvedCustomer = await customerService.getCustomerById(conv.customer_id, data.tenantId);
          if (resolvedCustomer) {
            isInternalStaff = Boolean(resolvedCustomer.is_internal_staff);
            isSandboxCustomer = Boolean(
              resolvedCustomer.is_sandbox_test ||
              isDummyOrTestContact(resolvedCustomer.phone, resolvedCustomer.name, resolvedCustomer.is_sandbox_test)
            );
          }
        }
      } catch {}

      // Non-pelanggan = sandbox/QA test ATAU staf internal → tidak ada otomasi CRM.
      const isNonCustomer = isSandboxCustomer || isInternalStaff;

      // Jika pesan INBOUND (dari customer) dan bukan sinkronisasi riwayat masa lalu (skipMqlEvaluation), increment bubble count & evaluasi status MQL (hanya customer riil)
      if (!data.skipMqlEvaluation && (data.direction === Direction.INBOUND || (data.direction as string) === 'INBOUND')) {
        try {
          const { customerService } = await import('../customer.service');
          if (resolvedCustomer?.id && !isNonCustomer) {
            customerService.incrementCustomerMessageCount(resolvedCustomer.id, data.tenantId).catch(() => {});
          }
        } catch (mqlErr: any) {
          console.warn('[MQL] Failed to increment bubble count:', mqlErr.message);
        }
      }

      // Event-Driven Last-Chat Sliding Window: pesan masuk riil customer menggeser
      // jadwal NO_PURCHASE aktif agar selalu relatif ke chat terakhir (bukan chat pertama).
      // Fire-and-forget: tidak memblokir alur webhook/state-machine; riwayat/sandbox/staf internal dikecualikan.
      if (
        !data.skipMqlEvaluation &&
        !data.isHistorical &&
        (data.direction === Direction.INBOUND || (data.direction as string) === 'INBOUND') &&
        resolvedCustomer?.id &&
        !isNonCustomer
      ) {
        void (async () => {
          try {
            const { followUpService } = await import('../follow-up.service');
            await followUpService.rescheduleNoPurchaseOnInboundChat(
              resolvedCustomer.id,
              data.tenantId,
              effectiveMsgDate
            );
          } catch (_) {}
        })();
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
            senderName: data.senderName || resolvedCustomer?.name || null,
            messageId: saved?.id || null,
            waMessageId: data.waMessageId || null,
            createdAt: saved?.created_at || new Date(),
            media: extractMediaFromPayload(data.payloadRaw),
            location: extractLocationFromPayload(data.payloadRaw),
            contact: data.payloadRaw?.contact || undefined,
            payloadRaw: sanitizePayloadForSse(data.payloadRaw),
            isHistorical: !!data.isHistorical,
            isSandboxTest: isSandboxCustomer,
            isInternalStaff: isInternalStaff,
            // State kendali percakapan (AI Bot vs Manusia) — dipakai PWA terapis untuk
            // memutuskan apakah pesan ini layak memicu suara/banner (hanya saat eskalasi manusia).
            isHumanHandling: Boolean(
              conversationForSse?.is_human_handling ||
                (conversationForSse as any)?.current_state === 'HUMAN_HANDLING'
            ),
          },
        })
        .catch(() => {});

      // Invalidate live chat cached lists & unread badge for instant update
      responseCacheService.invalidatePrefix('livechat:');

      // Web Push Background Notification: delegasikan ke InboundNotificationRouter untuk isolasi peran dan routing terarah
      // Staf internal dikecualikan (percakapan koordinasi CS/Bidan bukan tiket CRM pelanggan).
      if ((data.direction === 'INBOUND' || (data.direction as any) === Direction.INBOUND) && !data.isHistorical && !isNonCustomer) {
        void (async () => {
          try {
            const { inboundNotificationRouter } = await import('../inbound-notification-router.service');
            await inboundNotificationRouter.routeInboundMessage({
              tenantId: data.tenantId,
              conversationId: data.conversationId,
              customerId: resolvedCustomer?.id || '',
              senderName: resolvedCustomer?.name || data.senderName || 'Pelanggan',
              content: data.content,
              payloadRaw: data.payloadRaw,
            });
          } catch {}
        })();
      }
    }

    return saved;
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
   * Melampirkan metadata media ke record pesan yang sudah tersimpan (dipakai jalur
   * unduhan BACKGROUND media berat: video/audio/dokumen). Meng-update payload_raw.media
   * di DB + memory fallback, lalu menyiarkan `message.updated` agar bubble yang sudah
   * tampil di Live Chat langsung memperoleh player audio / tautan unduhan tanpa refresh.
   *
   * Idempoten & best-effort: tidak pernah melempar ke pemanggil fire-and-forget.
   */
  public async attachMediaToMessage(
    conversationId: string,
    waMessageId: string,
    tenantId: string,
    media: any
  ): Promise<boolean> {
    if (!waMessageId || !media) return false;
    let resolvedId: string | null = null;

    // 1. Update DB (tenant-scoped, dual-ID).
    try {
      const existing = await prisma.message.findFirst({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          wa_message_id: waMessageId,
        },
      });
      if (existing) {
        resolvedId = existing.id;
        await updateScopedMessage(existing.id, tenantId, {
          payload_raw: {
            ...(typeof existing.payload_raw === 'object' && existing.payload_raw ? existing.payload_raw : {}),
            media: {
              ...(typeof (existing.payload_raw as any)?.media === 'object' && (existing.payload_raw as any)?.media
                ? (existing.payload_raw as any).media
                : {}),
              ...media,
            },
          },
        });
      }
    } catch (error) {
      console.warn('DB attachMediaToMessage error (using memory fallback):', (error as Error).message);
    }

    // 2. Update memory fallback.
    const inMem = memoryMessages.find(
      (m) => m.wa_message_id === waMessageId && m.conversation_id === conversationId && m.tenant_id === tenantId
    );
    if (inMem) {
      inMem.payload_raw = {
        ...(typeof inMem.payload_raw === 'object' && inMem.payload_raw ? inMem.payload_raw : {}),
        media: {
          ...(typeof (inMem.payload_raw as any)?.media === 'object' && (inMem.payload_raw as any)?.media
            ? (inMem.payload_raw as any).media
            : {}),
          ...media,
        },
      };
      if (!resolvedId) resolvedId = inMem.id || null;
    }

    if (!resolvedId && !inMem) return false;

    // 3. Broadcast ke seluruh dashboard.
    try {
      await getLiveChatHub().publish({
        type: 'message.updated',
        tenantId,
        payload: {
          conversationId,
          messageId: resolvedId,
          waMessageId,
          media,
        },
      });
    } catch (hubErr: any) {
      console.warn('[HUB] Failed to publish message.updated (attachMedia):', hubErr.message);
    }

    return true;
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
      if (mem.tenant_id !== tenantId) continue;
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
}

export const messageLoggingService = new MessageLoggingService();
