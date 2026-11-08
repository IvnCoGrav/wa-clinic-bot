import { prisma } from '../../db/client';
import { getLiveChatHub } from '../live-chat-hub.service';
import { responseCacheService } from '../response-cache.service';
import {
  memoryMessages,
  extractShortMessageId,
  updateScopedMessage,
  updateScopedConversation,
} from './shared';

export class MessageActionsService {
  /**
   * Menandai pesan telah ditarik / dihapus untuk semua orang.
   * Memperbarui konten pesan menjadi teks penanda ditarik, membersihkan status pin bila sedang disematkan,
   * dan mem-broadcast update via SSE.
   */
  public async markMessageDeleted(messageId: string, tenantId: string): Promise<boolean> {
    const revokedContent = '🚫 Pesan ini telah ditarik';
    let conversationId: string | null = null;
    let wasPinned = false;

    // ID kanonik untuk SSE (lihat updateMessageContent): frontend match via id internal.
    let resolvedMessageId = messageId;
    let resolvedWaMessageId: string | null = null;

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
          resolvedMessageId = msgWa.id;
          resolvedWaMessageId = msgWa.wa_message_id ?? null;
          wasPinned = !!(msgWa.payload_raw as any)?.is_pinned;
          const updatedPayload = {
            ...(typeof msgWa.payload_raw === 'object' && msgWa.payload_raw ? (msgWa.payload_raw as any) : {}),
            is_revoked: true,
            revoked_at: new Date().toISOString(),
            is_pinned: false,
          };
          delete updatedPayload.pinned_by;
          delete updatedPayload.pinned_at;

          await updateScopedMessage(msgWa.id, tenantId, {
            content: revokedContent,
            payload_raw: updatedPayload,
          });
        }
      } else {
        conversationId = msg.conversation_id;
        resolvedMessageId = msg.id;
        resolvedWaMessageId = msg.wa_message_id ?? null;
        wasPinned = !!(msg.payload_raw as any)?.is_pinned;
        const updatedPayload = {
          ...(typeof msg.payload_raw === 'object' && msg.payload_raw ? (msg.payload_raw as any) : {}),
          is_revoked: true,
          revoked_at: new Date().toISOString(),
          is_pinned: false,
        };
        delete updatedPayload.pinned_by;
        delete updatedPayload.pinned_at;

        await updateScopedMessage(msg.id, tenantId, {
          content: revokedContent,
          payload_raw: updatedPayload,
        });
      }

      // Bersihkan pointer session_data.pinned_message_id bila merujuk ke pesan ini atau pesan sedang di-pin
      if (conversationId) {
        try {
          const conv = await prisma.conversation.findFirst({
            where: { id: conversationId, tenant_id: tenantId },
            select: { id: true, session_data: true },
          });
          const session = conv?.session_data && typeof conv.session_data === 'object' ? { ...(conv.session_data as any) } : {};
          if (session.pinned_message_id === resolvedMessageId || session.pinned_message_id === resolvedWaMessageId || wasPinned) {
            delete session.pinned_message_id;
            await updateScopedConversation(conv!.id, tenantId, { session_data: session });
          }
        } catch (_) {}
      }
    } catch (error) {
      console.warn('DB markMessageDeleted error (using memory fallback):', (error as Error).message);
    }

    // Update memory fallback
    const inMem = memoryMessages.find(
      (m) => (m.id === messageId || m.wa_message_id === messageId) && m.tenant_id === tenantId
    );
    if (inMem) {
      conversationId = inMem.conversation_id;
      resolvedMessageId = inMem.id;
      resolvedWaMessageId = inMem.wa_message_id ?? null;
      wasPinned = !!inMem.payload_raw?.is_pinned;
      inMem.content = revokedContent;
      inMem.payload_raw = {
        ...(inMem.payload_raw || {}),
        is_revoked: true,
        revoked_at: new Date().toISOString(),
        is_pinned: false,
      };
      delete inMem.payload_raw.pinned_by;
      delete inMem.payload_raw.pinned_at;

      if (conversationId) {
        try {
          const { conversationService } = await import('../conversation.service');
          const inMemConv = await conversationService.getConversationById(conversationId, tenantId);
          if (inMemConv && inMemConv.session_data) {
            const session = { ...inMemConv.session_data };
            if (session.pinned_message_id === resolvedMessageId || session.pinned_message_id === resolvedWaMessageId || wasPinned) {
              delete session.pinned_message_id;
              inMemConv.session_data = session;
            }
          }
        } catch (_) {}
      }
    }

    if (!conversationId) return false;

    // Invalidate livechat response cache
    try {
      await responseCacheService.invalidatePrefix('livechat:');
    } catch (_) {}

    // Broadcast event SSE 'message.updated'
    try {
      const hub = getLiveChatHub();
      await hub.publish({
        type: 'message.updated',
        tenantId,
        payload: {
          conversationId,
          messageId: resolvedMessageId,
          waMessageId: resolvedWaMessageId,
          content: revokedContent,
          isRevoked: true,
          revokedAt: new Date().toISOString(),
          isMessagePinned: false,
          payload_raw: { is_revoked: true, is_pinned: false },
        },
      });
    } catch (hubErr: any) {
      console.warn('[HUB] Failed to publish message.updated event for revoke:', hubErr.message);
    }

    return true;
  }

  /**
   * Sematkan / lepas sematan pesan WhatsApp (Pin/Unpin Message).
   */
  public async toggleMessagePin(
    conversationId: string,
    messageId: string,
    tenantId: string,
    pinnedBy: string = 'Admin',
    isPinned?: boolean
  ): Promise<{ success: boolean; isPinned: boolean; messageId: string; pinnedMessage?: any; message?: any; error?: string }> {
    try {
      // 1. Cari pesan dengan verifikasi kepemilikan tenant & conversation (anti-IDOR)
      let msg: any = null;
      try {
        msg = await prisma.message.findFirst({
          where: {
            OR: [
              { id: messageId, conversation_id: conversationId, tenant_id: tenantId },
              { wa_message_id: messageId, conversation_id: conversationId, tenant_id: tenantId },
            ],
          },
        });
      } catch (err: any) {
        console.warn('DB findFirst error in toggleMessagePin (using memory fallback):', err.message);
      }

      if (!msg) {
        msg = memoryMessages.find(
          (m) =>
            (m.id === messageId || m.wa_message_id === messageId) &&
            m.conversation_id === conversationId &&
            m.tenant_id === tenantId
        );
      }

      if (!msg) {
        return { success: false, error: 'Pesan tidak ditemukan dalam percakapan ini.', isPinned: false, messageId };
      }

      const isRevoked = msg.content === '🚫 Pesan ini telah ditarik' || !!(msg.payload_raw as any)?.is_revoked;
      if (isRevoked) {
        return { success: false, error: 'Pesan yang telah ditarik tidak dapat disematkan.', isPinned: false, messageId: msg.id };
      }

      const currentPinned = !!(msg.payload_raw as any)?.is_pinned;
      const nextPinned = typeof isPinned === 'boolean' ? isPinned : !currentPinned;
      const nowIso = new Date().toISOString();

      let targetDbId = msg.id;
      let targetWaId = msg.wa_message_id ?? null;

      // 2. Persistensi: Transaksi DB atau Fallback Memori
      try {
        await prisma.$transaction(async (tx) => {
          const conv = await tx.conversation.findFirst({
            where: { id: conversationId, tenant_id: tenantId },
          });
          if (!conv) {
            throw new Error('Percakapan tidak ditemukan.');
          }

          const existingSession =
            conv.session_data && typeof conv.session_data === 'object'
              ? { ...(conv.session_data as any) }
              : {};

          if (nextPinned) {
            // Single-pin atomik: jika ada pesan lama yang sedang disematkan, unpin pesan lama
            const prevPinnedId = existingSession.pinned_message_id;
            if (prevPinnedId && prevPinnedId !== msg.id) {
              const oldMsg = await tx.message.findFirst({
                where: {
                  OR: [
                    { id: prevPinnedId, conversation_id: conversationId, tenant_id: tenantId },
                    { wa_message_id: prevPinnedId, conversation_id: conversationId, tenant_id: tenantId },
                  ],
                },
              });
              if (oldMsg) {
                const oldPayload =
                  oldMsg.payload_raw && typeof oldMsg.payload_raw === 'object'
                    ? { ...(oldMsg.payload_raw as any) }
                    : {};
                delete oldPayload.pinned_by;
                delete oldPayload.pinned_at;
                oldPayload.is_pinned = false;
                await tx.message.update({
                  where: { id: oldMsg.id },
                  data: { payload_raw: oldPayload },
                });
              }
            }

            // Tulis flag pin pada pesan target
            const targetPayload =
              msg.payload_raw && typeof msg.payload_raw === 'object'
                ? { ...(msg.payload_raw as any) }
                : {};
            targetPayload.is_pinned = true;
            targetPayload.pinned_by = pinnedBy;
            targetPayload.pinned_at = nowIso;

            await tx.message.updateMany({
              where: { id: msg.id, tenant_id: tenantId },
              data: { payload_raw: targetPayload },
            });

            // Merge aman session_data (jangan menimpa data booking/cart)
            existingSession.pinned_message_id = msg.id;
            await tx.conversation.updateMany({
              where: { id: conv.id, tenant_id: tenantId },
              data: { session_data: existingSession },
            });
          } else {
            // Unpin pesan target
            const targetPayload =
              msg.payload_raw && typeof msg.payload_raw === 'object'
                ? { ...(msg.payload_raw as any) }
                : {};
            targetPayload.is_pinned = false;
            delete targetPayload.pinned_by;
            delete targetPayload.pinned_at;

            await tx.message.updateMany({
              where: { id: msg.id, tenant_id: tenantId },
              data: { payload_raw: targetPayload },
            });

            // Hapus pointer jika merujuk ke pesan ini
            if (
              existingSession.pinned_message_id === msg.id ||
              existingSession.pinned_message_id === msg.wa_message_id
            ) {
              delete existingSession.pinned_message_id;
              await tx.conversation.updateMany({
                where: { id: conv.id, tenant_id: tenantId },
                data: { session_data: existingSession },
              });
            }
          }
        });
      } catch (dbErr: any) {
        console.warn('DB transaction error in toggleMessagePin (using memory fallback):', dbErr.message);
        // Fallback in-memory
        if (nextPinned) {
          // Unpin pesan lama di memori
          for (const m of memoryMessages) {
            if (m.conversation_id === conversationId && m.tenant_id === tenantId && m.id !== msg.id) {
              if (m.payload_raw) {
                m.payload_raw.is_pinned = false;
                delete m.payload_raw.pinned_by;
                delete m.payload_raw.pinned_at;
              }
            }
          }
          if (msg.payload_raw) {
            msg.payload_raw.is_pinned = true;
            msg.payload_raw.pinned_by = pinnedBy;
            msg.payload_raw.pinned_at = nowIso;
          } else {
            msg.payload_raw = { is_pinned: true, pinned_by: pinnedBy, pinned_at: nowIso };
          }
        } else {
          if (msg.payload_raw) {
            msg.payload_raw.is_pinned = false;
            delete msg.payload_raw.pinned_by;
            delete msg.payload_raw.pinned_at;
          }
        }

        // Sinkronkan pointer session_data pada memori
        try {
          const { conversationService } = await import('../conversation.service');
          const inMemConv = await conversationService.getConversationById(conversationId, tenantId);
          if (inMemConv) {
            const sess = inMemConv.session_data && typeof inMemConv.session_data === 'object'
              ? { ...inMemConv.session_data }
              : {};
            if (nextPinned) {
              sess.pinned_message_id = msg.id;
            } else if (sess.pinned_message_id === msg.id || sess.pinned_message_id === msg.wa_message_id) {
              delete sess.pinned_message_id;
            }
            inMemConv.session_data = sess;
          }
        } catch (_) {}
      }

      // Sinkronkan cache memori lokal bila ada
      const inMem = memoryMessages.find(
        (m) => (m.id === msg.id || m.wa_message_id === msg.id) && m.tenant_id === tenantId
      );
      if (inMem) {
        inMem.payload_raw = {
          ...(inMem.payload_raw || {}),
          is_pinned: nextPinned,
          ...(nextPinned ? { pinned_by: pinnedBy, pinned_at: nowIso } : {}),
        };
        if (!nextPinned) {
          delete inMem.payload_raw.pinned_by;
          delete inMem.payload_raw.pinned_at;
        }
        if (nextPinned) {
          for (const other of memoryMessages) {
            if (other.conversation_id === conversationId && other.tenant_id === tenantId && other.id !== inMem.id) {
              if (other.payload_raw) {
                other.payload_raw.is_pinned = false;
                delete other.payload_raw.pinned_by;
                delete other.payload_raw.pinned_at;
              }
            }
          }
        }
      }

      // 3. Invalidate response cache livechat
      try {
        await responseCacheService.invalidatePrefix('livechat:');
      } catch (_) {}

      // 4. Siarkan event SSE 'message.updated'
      try {
        const hub = getLiveChatHub();
        await hub.publish({
          type: 'message.updated',
          tenantId,
          payload: {
            conversationId,
            messageId: targetDbId,
            waMessageId: targetWaId,
            content: msg.content,
            sender_name: msg.sender_name,
            sender_type: msg.sender_type,
            created_at: msg.created_at,
            isMessagePinned: nextPinned,
            pinnedBy: nextPinned ? pinnedBy : undefined,
            pinnedAt: nextPinned ? nowIso : undefined,
            payload_raw: { is_pinned: nextPinned },
          },
        });
      } catch (hubErr: any) {
        console.warn('[HUB] Failed to publish message.updated event for pin:', hubErr.message);
      }

      const pinnedMessageData = nextPinned
        ? {
            id: targetDbId,
            wa_message_id: targetWaId,
            content: msg.content,
            sender_name: msg.sender_name,
            sender_type: msg.sender_type,
            created_at: msg.created_at,
            is_message_pinned: true,
            pinned_by: pinnedBy,
            pinned_at: nowIso,
          }
        : null;

      const messageObj = {
        id: targetDbId,
        wa_message_id: targetWaId,
        content: msg.content,
        sender_name: msg.sender_name,
        sender_type: msg.sender_type,
        created_at: msg.created_at,
        is_message_pinned: nextPinned,
        pinned_by: nextPinned ? pinnedBy : null,
        pinned_at: nextPinned ? nowIso : null,
      };

      return {
        success: true,
        isPinned: nextPinned,
        messageId: targetDbId,
        pinnedMessage: pinnedMessageData,
        message: messageObj,
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Gagal mengubah status sematan pesan.', isPinned: false, messageId };
    }
  }

  /**
   * Menyembunyikan / menampilkan kembali bubble chat internal (UI only).
   * Data percakapan, database WhatsApp pasien, CRM, dan audit tetap utuh (zero side effect ke gateway WA).
   */
  public async toggleMessageHide(
    conversationId: string,
    messageId: string,
    tenantId: string,
    hiddenBy: string = 'Admin',
    isHidden?: boolean
  ): Promise<{ success: boolean; isHidden: boolean; messageId: string; message?: any; error?: string }> {
    try {
      // 1. Cari pesan dengan verifikasi tenant & conversation (anti-IDOR)
      let msg: any = null;
      try {
        msg = await prisma.message.findFirst({
          where: {
            OR: [
              { id: messageId, conversation_id: conversationId, tenant_id: tenantId },
              { wa_message_id: messageId, conversation_id: conversationId, tenant_id: tenantId },
            ],
          },
        });
      } catch (err: any) {
        console.warn('DB findFirst error in toggleMessageHide (using memory fallback):', err.message);
      }

      if (!msg) {
        msg = memoryMessages.find(
          (m) =>
            (m.id === messageId || m.wa_message_id === messageId) &&
            m.conversation_id === conversationId &&
            m.tenant_id === tenantId
        );
      }

      if (!msg) {
        return { success: false, error: 'Pesan tidak ditemukan dalam percakapan ini.', isHidden: false, messageId };
      }

      // Validasi kontrak HIDE: catatan internal & pesan revoked tidak boleh di-hide
      const senderUpper = (msg.sender_type || '').toUpperCase();
      if (senderUpper === 'INTERNAL_NOTE') {
        return { success: false, error: 'Catatan internal tidak dapat disembunyikan.', isHidden: false, messageId: msg.id };
      }
      const isRevoked = msg.content === '🚫 Pesan ini telah ditarik' || !!(msg.payload_raw as any)?.is_revoked;
      if (isRevoked) {
        return { success: false, error: 'Pesan yang telah ditarik tidak dapat disembunyikan.', isHidden: false, messageId: msg.id };
      }

      const currentHidden = !!(msg.payload_raw as any)?.is_hidden;
      const nextHidden = typeof isHidden === 'boolean' ? isHidden : !currentHidden;
      const nowIso = new Date().toISOString();

      let targetDbId = msg.id;
      let targetWaId = msg.wa_message_id ?? null;

      // 2. Persistensi: DB atau Fallback Memori
      try {
        const payload =
          msg.payload_raw && typeof msg.payload_raw === 'object'
            ? { ...(msg.payload_raw as any) }
            : {};
        payload.is_hidden = nextHidden;
        if (nextHidden) {
          payload.hidden_by = hiddenBy;
          payload.hidden_at = nowIso;
        } else {
          delete payload.hidden_by;
          delete payload.hidden_at;
        }

        await updateScopedMessage(msg.id, tenantId, { payload_raw: payload });
      } catch (dbErr: any) {
        console.warn('DB update error in toggleMessageHide (using memory fallback):', dbErr.message);
        if (msg.payload_raw) {
          msg.payload_raw.is_hidden = nextHidden;
          if (nextHidden) {
            msg.payload_raw.hidden_by = hiddenBy;
            msg.payload_raw.hidden_at = nowIso;
          } else {
            delete msg.payload_raw.hidden_by;
            delete msg.payload_raw.hidden_at;
          }
        } else {
          msg.payload_raw = nextHidden ? { is_hidden: true, hidden_by: hiddenBy, hidden_at: nowIso } : { is_hidden: false };
        }
      }

      // Sinkronkan memory fallback
      const inMem = memoryMessages.find(
        (m) => (m.id === msg.id || m.wa_message_id === msg.id) && m.tenant_id === tenantId
      );
      if (inMem) {
        inMem.payload_raw = {
          ...(inMem.payload_raw || {}),
          is_hidden: nextHidden,
          ...(nextHidden ? { hidden_by: hiddenBy, hidden_at: nowIso } : {}),
        };
        if (!nextHidden) {
          delete inMem.payload_raw.hidden_by;
          delete inMem.payload_raw.hidden_at;
        }
      }

      // 3. Invalidate cache
      try {
        await responseCacheService.invalidatePrefix('livechat:');
      } catch (_) {}

      // 4. Siarkan event SSE
      try {
        const hub = getLiveChatHub();
        await hub.publish({
          type: 'message.updated',
          tenantId,
          payload: {
            conversationId,
            messageId: targetDbId,
            waMessageId: targetWaId,
            content: msg.content,
            isMessageHidden: nextHidden,
            hiddenBy: nextHidden ? hiddenBy : undefined,
            hiddenAt: nextHidden ? nowIso : undefined,
            payload_raw: { is_hidden: nextHidden },
          },
        });
      } catch (hubErr: any) {
        console.warn('[HUB] Failed to publish message.updated event for hide:', hubErr.message);
      }

      const messageObj = {
        id: targetDbId,
        wa_message_id: targetWaId,
        content: msg.content,
        sender_name: msg.sender_name,
        sender_type: msg.sender_type,
        created_at: msg.created_at,
        is_message_hidden: nextHidden,
        hidden_by: nextHidden ? hiddenBy : null,
        hidden_at: nextHidden ? nowIso : null,
      };

      return {
        success: true,
        isHidden: nextHidden,
        messageId: targetDbId,
        message: messageObj,
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Gagal mengubah status sembunyi pesan.', isHidden: false, messageId };
    }
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

    // WAHA mengirim id pesan target dalam berbagai bentuk: serialized
    // `true_{chatId}_{key}`, raw key `{key}`, atau id aksi edit. Cocokkan
    // terhadap id internal, wa_message_id persis, maupun suffix key — pola
    // yang sama dengan addOrUpdateReaction/updateDeliveryStatus.
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

    // ID kanonik untuk SSE: frontend mencocokkan bubble via `m.id` internal.
    // Kalau input berupa raw key/serialized WAHA, resolve ke id internal agar
    // event tidak terbuang (sebelumnya payload memakai raw key → tidak match).
    let resolvedMessageId = messageId;
    let resolvedWaMessageId: string | null = null;

    try {
      const msg = await prisma.message.findFirst({
        where: { OR: orConds },
      });

      if (msg) {
        conversationId = msg.conversation_id;
        resolvedMessageId = msg.id;
        resolvedWaMessageId = msg.wa_message_id ?? null;
        await updateScopedMessage(msg.id, tenantId, {
          content: newContent,
          payload_raw: {
            ...(typeof msg.payload_raw === 'object' && msg.payload_raw ? msg.payload_raw : {}),
            is_edited: true,
            edited_at: new Date().toISOString(),
          },
        });
      }
    } catch (error) {
      console.warn('DB updateMessageContent error (using memory fallback):', (error as Error).message);
      const inMem = memoryMessages.find(
        (m) => (m.id === messageId || m.wa_message_id === messageId || (cleanId && m.wa_message_id && m.wa_message_id.endsWith(`_${cleanId}`))) && m.tenant_id === tenantId
      );
      if (inMem) {
        inMem.content = newContent;
        inMem.payload_raw = { ...inMem.payload_raw, is_edited: true, edited_at: new Date().toISOString() };
        conversationId = inMem.conversation_id;
        resolvedMessageId = inMem.id;
        resolvedWaMessageId = inMem.wa_message_id ?? null;
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
          messageId: resolvedMessageId,
          waMessageId: resolvedWaMessageId,
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
   * Menambahkan, mengubah, atau menghapus reaksi emotikon pada pesan WhatsApp.
   * Format payload_raw.reactions: Array<{ emoji: string; fromMe: boolean; senderName?: string; actorId?: string; createdAt: string }>
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

        await updateScopedMessage(msg.id, tenantId, {
          payload_raw: {
            ...currentPayload,
            reactions,
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

export const messageActionsService = new MessageActionsService();
