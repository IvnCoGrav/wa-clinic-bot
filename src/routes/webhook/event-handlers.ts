import { FastifyReply } from 'fastify';
import { WahaWebhookEvent } from '../../integrations/waha/types';
import { customerService } from '../../services/customer.service';
import { messageService } from '../../services/message.service';
import { normalizeWahaJid } from '../../utils/jid';
import { invalidateCachedLabels } from '../../integrations/waha/label-cache';
import { prisma } from '../../db/client';

/**
 * Handler event label.chat.added / label.chat.deleted dari WAHA.
 */
export async function handleLabelChatEvent(event: WahaWebhookEvent, tenantId: string): Promise<void> {
  try {
    const payload: any = event.payload;
    const chatId: string | undefined = payload?.chatId;
    const labelName: string | undefined = payload?.label?.name || payload?.labelName;
    if (!chatId || !labelName) return;

    const phone = normalizeWahaJid(chatId);
    if (!phone) return;

    const lower = labelName.toLowerCase();
    if (lower !== 'admin' && lower !== 'hold') {
      invalidateCachedLabels(chatId);
      return;
    }

    const isAdded = event.event === 'label.chat.added';
    await customerService.setLabelFlags(phone, {
      isAdminLabeled: lower === 'admin' ? isAdded : undefined,
      isHoldLabeled: lower === 'hold' ? isAdded : undefined,
    }, tenantId);
    invalidateCachedLabels(chatId);
  } catch (err: any) {
    console.warn(`[LABEL EVENT] Failed to process label event ${event.event}:`, err.message);
  }
}

/**
 * Handler event message.ack dari WAHA.
 */
export async function handleAckEvent(event: WahaWebhookEvent, resolvedTenantId: string, reply: FastifyReply) {
  const ackPayload: any = event.payload;
  if (ackPayload) {
    const rawId = typeof ackPayload.id === 'object'
      ? ackPayload.id?._serialized || ackPayload.id?.id
      : ackPayload.id || ackPayload.messageId || ackPayload.key?.id;

    if (rawId && ackPayload.ack !== undefined) {
      const ackNum = Number(ackPayload.ack);
      let deliveryStatus: 'sent' | 'delivered' | 'read' | 'failed' = 'sent';
      if (ackNum === 2) {
        deliveryStatus = 'delivered';
      } else if (ackNum === 3 || ackNum === 4) {
        deliveryStatus = 'read';
      } else if (ackNum < 0) {
        deliveryStatus = 'failed';
      }
      console.log(`[MESSAGE ACK WEBHOOK] msgId=${rawId}, ack=${ackNum} (${deliveryStatus}), ts=${ackPayload.timestamp}`);
      await messageService.updateDeliveryStatus(
        String(rawId),
        resolvedTenantId,
        deliveryStatus,
        ackPayload.timestamp ? Number(ackPayload.timestamp) : undefined
      );
    }
  }
  return reply.status(200).send({ status: 'ACK_PROCESSED' });
}

export function isRevokeEvent(event: WahaWebhookEvent): boolean {
  return (
    event.event === 'message.revoke' ||
    event.event === 'message.revoked' ||
    (event.event === 'message' &&
      ((event.payload as any)?.type === 'revoked' ||
        (event.payload as any)?.subType === 'revoke' ||
        (event.payload as any)?.message?.protocolMessage?.type === 0 ||
        (event.payload as any)?.message?.protocolMessage?.type === 'REVOKE' ||
        (event.payload as any)?.protocolMessage?.type === 0 ||
        (event.payload as any)?.protocolMessage?.type === 'REVOKE'))
  );
}

export function isReactionEvent(event: WahaWebhookEvent): boolean {
  return (
    event.event === 'message.reaction' ||
    event.event === 'message.reaction.added' ||
    event.event === 'message.reaction.deleted' ||
    (event.event === 'message' &&
      ((event.payload as any)?.type === 'reaction' ||
        (event.payload as any)?.subType === 'reaction' ||
        (event.payload as any)?.reaction !== undefined))
  );
}

export function isEditedEvent(event: WahaWebhookEvent): boolean {
  return (
    event.event === 'message.edited' ||
    (event.event === 'message' &&
      ((event.payload as any)?.type === 'edited' ||
        (event.payload as any)?.subType === 'edited' ||
        (event.payload as any)?.message?.protocolMessage?.type === 14 ||
        (event.payload as any)?.protocolMessage?.type === 14))
  );
}

/**
 * Handler event message revoke / deleted dari WAHA.
 */
export async function handleRevokeEvent(event: WahaWebhookEvent, resolvedTenantId: string, reply: FastifyReply) {
  const revPayload: any = event.payload || {};
  const targetMsgId =
    revPayload.messageId ||
    revPayload.id?._serialized ||
    revPayload.id ||
    revPayload.key?.id ||
    revPayload.protocolMessage?.key?.id ||
    revPayload.message?.protocolMessage?.key?.id;

  if (targetMsgId) {
    console.log(`[MESSAGE REVOKE WEBHOOK] Revoking message wa_message_id=${targetMsgId}`);
    try {
      const cleanId = String(targetMsgId);
      const shortId = cleanId.replace(/^true_|^false_/, '').replace(/^[^_]+_/, '').replace(/@.*$/, '');

      const updated = await prisma.message.updateMany({
        where: {
          tenant_id: resolvedTenantId,
          OR: [
            { wa_message_id: cleanId },
            { wa_message_id: { contains: targetMsgId } },
            { wa_message_id: shortId },
          ],
        },
        data: {
          content: '🚫 Pesan ini telah ditarik',
          is_revoked: true,
          revoked_at: new Date(),
          revoked_by: revPayload.fromMe ? 'ADMIN' : 'CUSTOMER',
        },
      });
      console.log(`[MESSAGE REVOKED] Updated ${updated.count} message records for ${targetMsgId}`);
    } catch (revErr: any) {
      console.error('[MESSAGE REVOKE ERROR]', revErr.message);
    }
  }
  return reply.status(200).send({ status: 'REVOKE_PROCESSED' });
}

/**
 * Handler event message reaction dari WAHA.
 */
export async function handleReactionEvent(event: WahaWebhookEvent, resolvedTenantId: string, reply: FastifyReply) {
  const reactPayload: any = event.payload || {};
  const reactionObj = typeof reactPayload.reaction === 'object' ? reactPayload.reaction : null;
  const emoji = typeof reactPayload.reaction === 'string'
    ? reactPayload.reaction
    : reactionObj?.text || reactionObj?.emoji || reactPayload.text || '';
  const targetMsgId =
    reactionObj?.messageId ||
    reactionObj?.id ||
    reactPayload.messageId ||
    reactPayload.targetMessageId ||
    reactPayload.id?._serialized ||
    reactPayload.id ||
    reactPayload.key?.id;

  const fromMe = !!reactPayload.fromMe || !!reactionObj?.fromMe;
  const senderName = reactPayload._data?.notifyName || reactPayload.notifyName || reactPayload.pushName || reactPayload._data?.pushName || (fromMe ? 'Admin' : undefined);

  if (targetMsgId) {
    console.log(`[MESSAGE REACTION WEBHOOK] targetMsgId=${targetMsgId}, emoji="${emoji}", fromMe=${fromMe}`);
    await messageService.addOrUpdateReaction(String(targetMsgId), resolvedTenantId, {
      emoji: emoji || '',
      fromMe,
      senderName,
      actorId: reactPayload.from ? normalizeWahaJid(reactPayload.from) : undefined,
    });
  }
  return reply.status(200).send({ status: 'REACTION_PROCESSED' });
}

/**
 * Handler event message edited dari WAHA.
 */
export async function handleEditedEvent(event: WahaWebhookEvent, resolvedTenantId: string, reply: FastifyReply) {
  const editPayload: any = event.payload || {};
  const targetMsgId =
    editPayload.editedMessageId ||
    editPayload.message?.protocolMessage?.key?.id ||
    editPayload.protocolMessage?.key?.id ||
    editPayload.messageId ||
    editPayload.id?._serialized ||
    editPayload.id ||
    editPayload.key?.id;
  const newBody =
    editPayload.body ||
    editPayload.text?.body ||
    editPayload.text ||
    editPayload.message?.editedMessage?.conversation ||
    editPayload.message?.protocolMessage?.editedMessage?.conversation ||
    editPayload.message?.extendedTextMessage?.text ||
    '';

  if (targetMsgId && newBody) {
    console.log(`[MESSAGE EDITED WEBHOOK] Updating message ${targetMsgId} with new content: "${newBody.slice(0, 30)}..."`);
    try {
      await messageService.updateMessageContent(String(targetMsgId), newBody, resolvedTenantId);
    } catch (editErr: any) {
      console.error('[MESSAGE EDITED ERROR]', editErr.message);
    }
  }
  return reply.status(200).send({ status: 'EDIT_PROCESSED' });
}
