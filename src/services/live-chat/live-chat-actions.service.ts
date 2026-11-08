import { prisma } from '../../db/client';
import { Direction } from '@prisma/client';
import { conversationService, buildConversationUpdatedPayload } from '../conversation.service';
import { customerService } from '../customer.service';
import { messageService } from '../message.service';
import { resolveGatewayForTenant } from '../../integrations/whatsapp/factory';
import { ClientIdempotencyStore } from '../../utils/client-idempotency';
import { alertService, AlertType, AlertSeverity } from '../alert.service';
import { liveChatQueryService } from './live-chat-query.service';
import {
  AdminReplyResult,
  SendAdminReplyParams,
  SendReactionParams,
  RevokeMessageParams,
  EditMessageParams,
} from './types';

const WABA_WINDOW_MS = 24 * 60 * 60 * 1000;

export function parseInternalNoteCommand(
  text: string | undefined | null,
  forceInternal = false
): { isInternal: boolean; cleanNote: string } {
  const trimmed = (text || '').trim();
  const lower = trimmed.toLowerCase();
  const isNotesCmd =
    lower === '/notes' || (lower.startsWith('/notes') && /\s/.test(lower.charAt(6)));

  if (isNotesCmd) {
    return { isInternal: true, cleanNote: trimmed.slice(6).trim() };
  }
  if (forceInternal) {
    return { isInternal: true, cleanNote: trimmed };
  }
  return { isInternal: false, cleanNote: '' };
}

export class LiveChatActionsService {
  public static recentReplies = new ClientIdempotencyStore(2000, 500);
  public static recentClientTemps = new ClientIdempotencyStore(5 * 60 * 1000, 500);

  public async getManualReplyEscalates(tenantId: string): Promise<boolean> {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      return tenant ? !!tenant.manual_reply_escalates : true;
    } catch (error) {
      return true;
    }
  }

  public async sendAdminReply(params: {
    conversationId: string;
    text?: string;
    imageB64?: string;
    mediaUrl?: string;
    thumbB64?: string;
    mimeType?: string;
    fileName?: string;
    tenantId: string;
    adminName?: string;
    acknowledgeOutsideWindow?: boolean;
    forceEscalate?: boolean;
    replyToMessageId?: string;
    isInternalNote?: boolean;
    clientTempId?: string;
    dispatchOrigin?: boolean;
  }): Promise<AdminReplyResult> {
    const {
      conversationId,
      text,
      imageB64,
      mediaUrl,
      thumbB64,
      mimeType,
      fileName,
      tenantId,
      adminName,
      acknowledgeOutsideWindow,
      forceEscalate,
      replyToMessageId,
      clientTempId,
      dispatchOrigin,
    } = params;

    const prevClientTemp = LiveChatActionsService.recentClientTemps.get(clientTempId);
    if (prevClientTemp) {
      return {
        success: true,
        conversationId,
        messageId: prevClientTemp.messageId,
        id: prevClientTemp.id,
      };
    }

    const hasText = !!text && !!text.trim();
    const hash = `${conversationId}:${hasText ? text!.trim() : ''}:${!!imageB64 || !!mediaUrl}:${replyToMessageId || ''}:${clientTempId || ''}`;
    const lastSent = LiveChatActionsService.recentReplies.get(hash);
    if (lastSent) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_REPLY',
          message: 'Pesan yang sama sedang diproses/sudah dikirim dalam 2 detik terakhir.',
        },
      };
    }
    const hasImage = !!imageB64 || !!mediaUrl;
    if (!hasText && !hasImage) {
      return { success: false, error: { code: 'EMPTY_REPLY', message: 'Isi balasan tidak boleh kosong.' } };
    }

    const conversation = await conversationService.getConversationById(conversationId, tenantId);
    if (!conversation) {
      return {
        success: false,
        error: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${conversationId} tidak ditemukan.` },
      };
    }

    const noteCmd = parseInternalNoteCommand(text, params.isInternalNote);
    if (noteCmd.isInternal) {
      if (!noteCmd.cleanNote) {
        return { success: false, error: { code: 'EMPTY_NOTE', message: 'Catatan internal tidak boleh kosong.' } };
      }
      const savedNote = await messageService.logMessage({
        tenantId,
        conversationId,
        direction: Direction.OUTBOUND,
        content: noteCmd.cleanNote,
        senderType: 'INTERNAL_NOTE',
        senderName: adminName || 'Staff',
        skipMqlEvaluation: true,
      });
      return { success: true, isInternal: true, messageId: savedNote?.id, id: savedNote?.id };
    }

    const customer = await customerService.getCustomerById(conversation.customer_id, tenantId);
    if (!customer || !customer.phone) {
      return {
        success: false,
        error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer dari conversation tidak ditemukan.' },
      };
    }

    if (customer.is_sandbox_test) {
      return {
        success: false,
        error: {
          code: 'SANDBOX_REPLY_BLOCKED',
          message:
            'Balasan admin ke chat test/simulasi (sandbox) diblokir untuk melindungi WhatsApp asli. Gunakan hanya untuk pemantauan.',
        },
      };
    }

    let dispatchWarning: string | undefined = undefined;
    try {
      const isSharelocSend = /\[LOCATION[:\s]*Lat/i.test(text || '') || Boolean((params as any).location);
      const isDispatchMediaSend =
        (!!imageB64 || !!mediaUrl) && (params.dispatchOrigin === true || params.forceEscalate === true);
      if (isSharelocSend || isDispatchMediaSend) {
        const { wibDayBoundsUtc } = await import('../../utils/wib-time');
        const { start, end } = wibDayBoundsUtc(0);

        const todayRes = await prisma.reservation.findFirst({
          where: {
            tenant_id: tenantId,
            customer_id: conversation.customer_id,
            booking_date: { gte: start, lte: end },
            status: { in: ['confirmed', 'en_route'] },
          },
        });

        const completedTodayRes = await prisma.reservation.findFirst({
          where: {
            tenant_id: tenantId,
            customer_id: conversation.customer_id,
            booking_date: { gte: start, lte: end },
            status: 'completed',
          },
        });

        const { staffTripTrackingService } = await import('../staff-trip-tracking.service');
        const activeTrip = todayRes?.id ? staffTripTrackingService.getTrip(tenantId, todayRes.id) : null;
        const otwActive = Boolean((todayRes as any)?.otw_sent_at && !(todayRes as any)?.arrived_at);

        if (!todayRes && !completedTodayRes && !activeTrip && !otwActive) {
          dispatchWarning = 'NO_ACTIVE_RESERVATION_TODAY';
          const { auditService } = await import('../audit.service');
          await auditService
            .logAdminAction({
              apiKey: 'internal',
              tenantId,
              action: 'UNREGISTERED_VISIT_DISPATCH_DETECTED',
              adminIdentity: adminName || 'Staff',
              payload: {
                conversationId,
                customerId: conversation.customer_id,
                isSharelocSend,
                isDispatchMediaSend,
              },
            })
            .catch(() => {});
        }
      }
    } catch (_) {}

    const gateway = await resolveGatewayForTenant(tenantId);

    const { whatsappProviderService } = await import('../whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      return {
        success: false,
        error: {
          code: 'OUTBOUND_CUTOFF_ACTIVE',
          message:
            'Koneksi outbound WhatsApp sedang diputus oleh Administrator (Cut-Off Darurat aktif). Mohon aktifkan kembali koneksi di menu Pengaturan Provider WhatsApp atau toggle Bot di atas.',
        },
        provider: gateway.providerType,
      };
    }

    let replyToWaMessageId: string | undefined = undefined;
    let quotedMeta: any = undefined;

    if (replyToMessageId) {
      try {
        const quotedMsg = await messageService.getMessageById(replyToMessageId, tenantId);
        if (quotedMsg) {
          replyToWaMessageId = quotedMsg.wa_message_id || quotedMsg.id;
          quotedMeta = {
            id: quotedMsg.id,
            wa_message_id: quotedMsg.wa_message_id,
            direction: quotedMsg.direction,
            sender_name:
              quotedMsg.sender_name || (quotedMsg.direction === 'INBOUND' ? customer.name || 'Customer' : 'Admin'),
            sender_type: quotedMsg.sender_type,
            content: quotedMsg.content,
            media: (quotedMsg as any).payload_raw?.media || undefined,
          };
        } else {
          replyToWaMessageId = replyToMessageId;
        }
      } catch (err: any) {
        console.warn(`[Live Chat] Gagal mengambil detail quoted message:`, err.message);
        replyToWaMessageId = replyToMessageId;
      }
    }

    if (gateway.providerType === 'WABA' && hasImage && !process.env.PUBLIC_BASE_URL) {
      return {
        success: false,
        error: {
          code: 'MEDIA_PUBLIC_URL_REQUIRED',
          message:
            'Konfigurasi PUBLIC_BASE_URL diperlukan untuk mengirim gambar via WABA. Set variabel lingkungan PUBLIC_BASE_URL ke domain publik bot.',
        },
        provider: gateway.providerType,
      };
    }

    if (!hasImage && gateway.providerType === 'WABA') {
      const lastInboundAt =
        typeof (this as any)?.getLastInboundAt === 'function'
          ? await (this as any).getLastInboundAt(conversationId, tenantId)
          : await liveChatQueryService.getLastInboundAt(conversationId, tenantId);
      if (
        lastInboundAt &&
        Date.now() - new Date(lastInboundAt).getTime() > WABA_WINDOW_MS &&
        !acknowledgeOutsideWindow
      ) {
        return {
          success: false,
          error: {
            code: 'WABA_OUTSIDE_WINDOW',
            message: `Balasan admin melewati 24h window percakapan WABA (last_inbound ${lastInboundAt.toISOString()}). Gunakan template HSM atau set acknowledgeOutsideWindow=true.`,
          },
        };
      }
    }

    let sendResult: any = { success: false };
    let content = (hasText ? text!.trim() : '') || '';
    let mediaMeta: any;
    let sendTarget = '';

    if (hasImage) {
      const { mediaService } = await import('../media.service');
      let hdUrl = '';
      let thumbUrl: string | null = null;

      if (mediaUrl) {
        hdUrl = mediaUrl;
        thumbUrl = mediaService.resolveThumbRelativeUrl(mediaUrl);
      } else {
        const saved = await mediaService.saveOutboundMedia({
          tenantId,
          imageB64: imageB64!,
          thumbB64,
          mimeType,
          fileName,
        });
        hdUrl = saved.hdUrl;
        thumbUrl = saved.thumbUrl;
      }

      const resolved = mediaService.resolveOutboundForProvider(hdUrl, gateway.providerType);
      if (!resolved) {
        return {
          success: false,
          error: { code: 'MEDIA_PUBLIC_URL_REQUIRED', message: 'Gagal me-resolve URL media untuk pengiriman.' },
          provider: gateway.providerType,
        };
      }
      sendTarget = resolved;

      mediaMeta = {
        url: thumbUrl || hdUrl,
        hdUrl: hdUrl,
        thumbUrl: thumbUrl ?? undefined,
        mimeType,
        caption: hasText ? text!.trim() : null,
        fileName,
      };
    }

    if (typeof gateway.markAsRead === 'function') {
      await gateway.markAsRead(customer.phone).catch(() => {});
    }

    let imageCaption = content || undefined;
    let followUpTexts: string[] = [];
    if (hasImage && content) {
      const { splitImageCaption } = await import('../caption-splitter');
      const splitResult = splitImageCaption(content, 1000);
      imageCaption = splitResult.imageCaption;
      followUpTexts = splitResult.followUpTexts;
    }

    LiveChatActionsService.recentReplies.set(hash, {});

    let attempts = 0;
    const maxAttempts = 2;

    const sendOptions = replyToWaMessageId ? { replyToMessageId: replyToWaMessageId } : undefined;

    while (attempts < maxAttempts) {
      attempts++;
      if (hasImage) {
        sendResult = sendOptions
          ? await gateway.sendImageMessage(customer.phone, sendTarget, imageCaption, sendOptions)
          : await gateway.sendImageMessage(customer.phone, sendTarget, imageCaption);
      } else {
        sendResult = sendOptions
          ? await gateway.sendTextMessage(customer.phone, content, sendOptions)
          : await gateway.sendTextMessage(customer.phone, content);
      }

      if (sendResult.success) {
        break;
      } else if (attempts < maxAttempts) {
        console.warn(`[Live Chat] Percobaan ${attempts} gagal kirim ke ${customer.phone}, retry dalam 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (hasImage && sendResult?.success && followUpTexts.length > 0) {
      for (const followUp of followUpTexts) {
        try {
          await gateway.sendTextMessage(customer.phone, followUp);
        } catch (fErr: any) {
          console.error(
            `[Live Chat] Gagal mengirim pesan teks lanjutan setelah gambar ke ${customer.phone}:`,
            fErr?.message || fErr
          );
        }
      }
    }

    if (hasImage && !hasText) {
      content = '[IMAGE]';
    }

    if (!sendResult.success) {
      if (hasImage && mediaMeta?.hdUrl) {
        console.warn(
          `[LIVE CHAT MEDIA] Pengiriman gambar ke WhatsApp gagal, tetapi file tetap tersimpan di storage: ${mediaMeta.hdUrl}`
        );
      }

      alertService.notifyAlert({
        type: AlertType.THIRD_PARTY_OUTAGE,
        severity: AlertSeverity.CRITICAL,
        provider: gateway.providerType,
        message: `Admin/Terapis (${adminName || 'Admin'}) gagal membalas chat ke ${customer.phone} setelah ${maxAttempts}x percobaan. Pesan: "${content.substring(
          0,
          50
        )}${content.length > 50 ? '...' : ''}". Harap periksa status WAHA/WABA.`,
        metadata: {
          error: sendResult.error,
          conversationId,
        },
      });

      return {
        success: false,
        error: sendResult.error || {
          code: 'SEND_FAILED',
          message: 'Gagal mengirim pesan ke WhatsApp setelah percobaan ulang.',
        },
        provider: gateway.providerType,
      };
    }

    const payloadRaw: Record<string, any> = {};
    if (mediaMeta) payloadRaw.media = mediaMeta;
    if (quotedMeta) payloadRaw.quoted_message = quotedMeta;
    if (replyToWaMessageId) payloadRaw.reply_to = replyToWaMessageId;
    if (params.dispatchOrigin === true) payloadRaw.dispatchOrigin = true;
    if (params.forceEscalate === true) payloadRaw.forceEscalate = true;

    let logged: any = null;
    let persistenceWarning: string | undefined;
    try {
      logged = await messageService.logMessage({
        tenantId,
        conversationId,
        direction: Direction.OUTBOUND,
        content,
        waMessageId: sendResult.messageId,
        senderType: 'ADMIN',
        senderName: adminName || 'Admin',
        payloadRaw: Object.keys(payloadRaw).length > 0 ? payloadRaw : undefined,
      });
    } catch (persistErr: any) {
      console.error(
        '[LIVE CHAT] Pesan sudah terkirim ke WhatsApp tetapi gagal dicatat ke DB:',
        persistErr?.message || persistErr
      );
      persistenceWarning = 'MESSAGE_SENT_NOT_PERSISTED';
    }

    try {
      await messageService.markConversationMessagesAsRead(conversationId, tenantId);
      await conversationService.setManualUnread(conversationId, tenantId, false);
    } catch (_) {}

    if (logged?.sender_type === 'ADMIN') {
      try {
        const clearRes = await prisma.conversation.updateMany({
          where: { id: conversationId, tenant_id: tenantId },
          data: { is_frustrated: false, frustrated_at: null, frustrated_reason: null },
        });
        const cleared =
          clearRes.count > 0
            ? await prisma.conversation.findFirst({ where: { id: conversationId, tenant_id: tenantId } })
            : null;
        if (!cleared) throw new Error('Conversation not found for tenant');
        try {
          const { getLiveChatHub } = await import('../live-chat-hub.service');
          await getLiveChatHub().publish({
            type: 'conversation.updated',
            tenantId,
            payload: buildConversationUpdatedPayload(cleared),
          });
        } catch (_) {}
      } catch (_) {}
    }

    try {
      const { humanBackgroundEnrichmentService } = await import('../human-background-enrichment.service');
      humanBackgroundEnrichmentService.enrichFromAdminOutboundAsync(content, customer.id, tenantId);
    } catch (_) {}

    try {
      const { isReservationFormMessage, parseReservationText } = await import('../../utils/reservation-text-parser');
      if (isReservationFormMessage(content)) {
        const parseResult = parseReservationText(content);
        if (parseResult.success && parseResult.reservation) {
          const parsed = parseResult.reservation;
          const { upsertReservationForm } = await import('../reservation-lifecycle.service');
          await upsertReservationForm({
            tenantId,
            customerId: customer.id,
            chatId: `${customer.phone}@c.us`,
            treatmentCategory: parsed.treatmentCategory,
            treatmentDetail: parsed.treatmentDetail,
            bookingDate: parsed.bookingDate,
            rawText: content,
            purchaseValue: parsed.payment?.totalPrice || parsed.payment?.treatmentPrice || undefined,
            babies: parsed.babies || [],
            customerName: parsed.name,
            kecamatan: parsed.kec,
            kota: parsed.kota,
            kelurahan: undefined,
            address: parsed.address?.trim() || undefined,
            source: 'ADMIN_OUTBOUND_AUTO_CAPTURE',
          }).catch((err) => console.warn('[LIVE CHAT OUTBOUND AUTO-CAPTURE UPSERT WARN]', err?.message || err));

          if (parsed.address?.trim()) {
            const { customerService: custSvc } = await import('../customer.service');
            await custSvc
              .updateCustomer(
                customer.id,
                {
                  address: parsed.address.trim(),
                  kecamatan: parsed.kec?.trim() || undefined,
                  kota: parsed.kota?.trim() || undefined,
                },
                tenantId
              )
              .catch(() => {});
          }
        }
      }
    } catch (adminCaptureErr: any) {
      console.warn('[LIVE CHAT OUTBOUND AUTO-CAPTURE ERROR]', adminCaptureErr?.message || adminCaptureErr);
    }

    let updated: any = conversation;
    const manualReplyEscalates =
      typeof (this as any)?.getManualReplyEscalates === 'function'
        ? await (this as any).getManualReplyEscalates(tenantId)
        : await this.getManualReplyEscalates(tenantId);
    if (conversation.is_human_handling) {
      updated = await conversationService.resetHumanHandlingTimer(conversationId, tenantId);
    } else if (forceEscalate || manualReplyEscalates) {
      updated = await conversationService.escalateToHumanHandling(
        conversation,
        customer.phone,
        'Balasan manual admin (auto-escalation via Live Chat)',
        tenantId,
        'manual_reply'
      );
    }

    try {
      const { getTenantCapiFormats, fireCapiEvent } = await import('../capi.service');
      const formats = await getTenantCapiFormats(tenantId);
      const checkoutKeyword = formats.formatCheckout.toLowerCase().replace(/\s+/g, ' ').trim();
      const replyLower = (text || '').toLowerCase();
      if (checkoutKeyword.length > 0 && hasText && replyLower.includes(checkoutKeyword)) {
        let adClick: any;
        try {
          adClick = await prisma.adClick.findUnique({ where: { customerId: customer.id } });
        } catch (_) {
          adClick = undefined;
        }
        fireCapiEvent({
          eventName: 'InitiateCheckout',
          customer,
          adClick: adClick || undefined,
          tenantId,
          customData: { source: 'ADMIN_FORM_SENT' },
        });
      }
    } catch (capiErr) {
      console.warn('[CAPI] InitiateCheckout (admin form) skipped:', (capiErr as Error).message);
    }

    LiveChatActionsService.recentClientTemps.set(clientTempId, {
      messageId: sendResult.messageId,
      id: logged?.id,
    });

    return {
      success: true,
      conversationId,
      messageId: sendResult.messageId,
      id: logged?.id,
      provider: gateway.providerType,
      conversation: updated ? buildConversationUpdatedPayload(updated) : undefined,
      warning: persistenceWarning || dispatchWarning,
    };
  }

  public async getGatewayCapability(tenantId: string): Promise<{
    provider: string;
    supportsRevoke: boolean;
    supportsEdit: boolean;
    supportsReaction: boolean;
  }> {
    const gateway = await resolveGatewayForTenant(tenantId);
    return {
      provider: gateway.providerType,
      supportsRevoke: !!gateway.supportsRevoke,
      supportsEdit: !!gateway.supportsEdit,
      supportsReaction: (gateway as any).supportsReaction ?? true,
    };
  }

  public async sendReaction(params: {
    conversationId: string;
    messageId: string;
    emoji: string;
    tenantId: string;
    adminName?: string;
  }): Promise<{ success: boolean; reactions?: any[]; error?: string }> {
    const { conversationId, messageId, emoji, tenantId, adminName = 'Admin' } = params;

    const conversation = await conversationService.getConversationById(conversationId, tenantId);
    if (!conversation) {
      return { success: false, error: 'Percakapan tidak ditemukan.' };
    }

    const customer = await customerService.getCustomerById(conversation.customer_id, tenantId);
    if (!customer?.phone) {
      return { success: false, error: 'Data nomor WhatsApp customer tidak ditemukan.' };
    }

    const { whatsappProviderService } = await import('../whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      return {
        success: false,
        error: 'Koneksi outbound WhatsApp sedang diputus oleh Administrator (Cut-Off Darurat aktif).',
      };
    }

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
    } catch {
      msg = null;
    }
    if (!msg) {
      const memoryMsgs = messageService.getMemoryMessages();
      msg = memoryMsgs.find(
        (m) => (m.id === messageId || m.wa_message_id === messageId) && m.conversation_id === conversationId
      );
    }

    if (!msg) {
      return { success: false, error: 'Pesan tidak ditemukan.' };
    }

    const targetWaId = msg.wa_message_id || msg.id;
    if (!customer.is_sandbox_test && targetWaId) {
      const gateway = await resolveGatewayForTenant(tenantId);
      if (typeof gateway.sendReactionMessage === 'function') {
        try {
          const reactionRes = await gateway.sendReactionMessage(customer.phone, targetWaId, emoji);
          if (!reactionRes.success) {
            console.warn(`[REACTION WARNING] Failed to send reaction to WhatsApp:`, reactionRes.error?.message);
          }
        } catch (gwErr: any) {
          console.warn(`[REACTION ERROR] Gateway sendReaction error:`, gwErr.message);
        }
      }
    }

    const updateRes = await messageService.addOrUpdateReaction(msg.id, tenantId, {
      emoji,
      fromMe: true,
      senderName: adminName,
    });

    const { auditService } = await import('../audit.service');
    await auditService.logAdminAction({
      apiKey: 'LIVE_CHAT',
      adminIdentity: adminName,
      action: 'SEND_REACTION',
      targetId: msg.id,
      payload: {
        conversationId,
        messageId: msg.id,
        waMessageId: msg.wa_message_id,
        emoji,
        customerPhone: customer.phone,
      },
      tenantId,
    });

    return { success: true, reactions: updateRes.reactions };
  }

  public async revokeMessage(params: {
    conversationId: string;
    messageId: string;
    tenantId: string;
    adminName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { conversationId, messageId, tenantId, adminName = 'Admin' } = params;

    const gateway = await resolveGatewayForTenant(tenantId);
    if (!gateway.supportsRevoke) {
      return {
        success: false,
        error: `Provider WhatsApp tenant (${gateway.providerType}) tidak mendukung fitur tarik pesan untuk semua orang (Delete for Everyone).`,
      };
    }

    const conversation = await conversationService.getConversationById(conversationId, tenantId);
    if (!conversation) {
      return { success: false, error: 'Percakapan tidak ditemukan.' };
    }

    const customer = await customerService.getCustomerById(conversation.customer_id, tenantId);
    if (!customer?.phone) {
      return { success: false, error: 'Data nomor WhatsApp customer tidak ditemukan.' };
    }

    const { whatsappProviderService } = await import('../whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      return {
        success: false,
        error: 'Koneksi outbound WhatsApp sedang diputus oleh Administrator (Cut-Off Darurat aktif).',
      };
    }

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
    } catch {
      msg = null;
    }
    if (!msg) {
      const memoryMsgs = messageService.getMemoryMessages();
      msg = memoryMsgs.find(
        (m) => (m.id === messageId || m.wa_message_id === messageId) && m.conversation_id === conversationId
      );
    }

    if (!msg) {
      return { success: false, error: 'Pesan tidak ditemukan.' };
    }

    if (msg.direction !== Direction.OUTBOUND && msg.direction !== 'OUTBOUND') {
      return { success: false, error: 'Hanya pesan keluar (outbound) yang dapat ditarik.' };
    }

    const targetWaId = msg.wa_message_id || msg.id;
    const deleteResult = await gateway.deleteMessage(customer.phone, targetWaId, true);
    if (!deleteResult.success) {
      const rawError = deleteResult.error || '';
      const friendlyError = rawError.includes('404')
        ? 'Pesan tidak ditemukan di server WhatsApp (kemungkinan sudah ditarik atau sesi WhatsApp telah ter-reset).'
        : rawError || 'Gagal menarik pesan dari WhatsApp.';
      return { success: false, error: friendlyError };
    }

    await messageService.markMessageDeleted(msg.id, tenantId);

    const { auditService } = await import('../audit.service');
    await auditService.logAdminAction({
      apiKey: 'LIVE_CHAT',
      adminIdentity: adminName,
      action: 'REVOKE_MESSAGE',
      targetId: msg.id,
      payload: {
        conversationId,
        messageId: msg.id,
        waMessageId: msg.wa_message_id,
        customerPhone: customer.phone,
      },
      tenantId,
    });

    return { success: true };
  }

  public async editMessage(params: {
    conversationId: string;
    messageId: string;
    newContent: string;
    tenantId: string;
    adminName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { conversationId, messageId, newContent, tenantId, adminName } = params;

    if (!newContent || !newContent.trim()) {
      return { success: false, error: 'Isi pesan baru tidak boleh kosong.' };
    }

    const gateway = await resolveGatewayForTenant(tenantId);
    if (!gateway.supportsEdit) {
      return {
        success: false,
        error: `Provider WhatsApp (${gateway.providerType}) tidak mendukung fitur edit pesan.`,
      };
    }

    const conversation = await conversationService.getConversationById(conversationId, tenantId);
    if (!conversation) {
      return { success: false, error: 'Percakapan tidak ditemukan.' };
    }

    const customer = await customerService.getCustomerById(conversation.customer_id, tenantId);
    if (!customer?.phone) {
      return { success: false, error: 'Data nomor WhatsApp customer tidak ditemukan.' };
    }

    const { whatsappProviderService } = await import('../whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      return {
        success: false,
        error: 'Koneksi outbound WhatsApp sedang diputus oleh Administrator (Cut-Off Darurat aktif).',
      };
    }

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
    } catch {
      msg = null;
    }
    if (!msg) {
      const memoryMsgs = messageService.getMemoryMessages();
      msg = memoryMsgs.find(
        (m) => (m.id === messageId || m.wa_message_id === messageId) && m.conversation_id === conversationId
      );
    }

    if (!msg) {
      return { success: false, error: 'Pesan tidak ditemukan.' };
    }

    if (msg.direction !== Direction.OUTBOUND && msg.direction !== 'OUTBOUND') {
      return { success: false, error: 'Hanya pesan keluar (outbound) yang dapat diedit.' };
    }

    const msgCreatedAt = new Date(msg.created_at || Date.now()).getTime();
    const ageMs = Date.now() - msgCreatedAt;
    if (ageMs > 15 * 60 * 1000) {
      return {
        success: false,
        error: 'WhatsApp hanya mengizinkan pengeditan pesan dalam 15 menit pertama setelah terkirim.',
      };
    }

    const targetWaId = msg.wa_message_id || msg.id;
    const editResult = await gateway.editMessage(customer.phone, targetWaId, newContent.trim());
    if (!editResult.success) {
      const rawError = editResult.error || '';
      const friendlyError = rawError.includes('404')
        ? 'Pesan tidak ditemukan di server WhatsApp atau sudah melewati batas waktu pengeditan (15 menit).'
        : rawError || 'Gagal mengedit pesan di WhatsApp.';
      return { success: false, error: friendlyError };
    }

    await messageService.updateMessageContent(msg.id, newContent.trim(), tenantId);

    const { auditService } = await import('../audit.service');
    await auditService.logAdminAction({
      apiKey: 'LIVE_CHAT',
      adminIdentity: adminName,
      action: 'EDIT_MESSAGE',
      targetId: msg.id,
      payload: {
        conversationId,
        messageId: msg.id,
        waMessageId: msg.wa_message_id,
        customerPhone: customer.phone,
        newContent: newContent.trim(),
      },
      tenantId,
    });

    return { success: true };
  }
}

export const liveChatActionsService = new LiveChatActionsService();
