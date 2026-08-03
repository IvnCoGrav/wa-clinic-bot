import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyMetaSignature } from '../integrations/whatsapp/signature';
import { normalizeWabaPayload, normalizeWabaStatuses } from '../integrations/whatsapp/normalizer';
import { customerService } from '../services/customer.service';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { queueService } from '../services/queue.service';
import { wabaTenantService } from '../services/waba-tenant.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

export async function wabaWebhookRoutes(fastify: FastifyInstance) {

  fastify.get('/api/webhook/waba', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const verifyToken = process.env.WABA_WEBHOOK_VERIFY_TOKEN;
    if (!verifyToken) {
      return reply.status(500).send({ error: 'WABA_WEBHOOK_VERIFY_TOKEN not configured' });
    }
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
      return reply.status(200).send(query['hub.challenge'] || '');
    }
    return reply.status(403).send({ error: 'Forbidden: verification token mismatch' });
  });

  fastify.post('/api/webhook/waba', async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = crypto.randomUUID();

    const appSecret = process.env.WABA_APP_SECRET || '';
    const rawBody = (request as any).rawBody ?? Buffer.from(JSON.stringify(request.body));
    const signature = request.headers['x-hub-signature-256'] as string | undefined;

    if (!verifyMetaSignature(rawBody, signature, appSecret)) {
      console.warn(`[WABA SECURITY] Invalid HMAC signature from ${request.ip} [${correlationId}]`);
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const body = request.body as any;
    if (!body || body.object !== 'whatsapp_business_account') {
      return reply.status(200).send({ status: 'IGNORED' });
    }

    // --- STATUS WEBHOOKS (sent/delivered/read/failed) ---
    // Diproses lebih dulu; update status pesan by wa_message_id.
    const statuses = normalizeWabaStatuses(body);
    if (statuses.length > 0) {
      let processedStatuses = 0;
      for (const st of statuses) {
        const tenantId = await wabaTenantService.resolveTenantByPhoneNumberId(st.phoneNumberId);
        await messageService.updateDeliveryStatus(st.messageId, tenantId, st.status, st.timestamp);
        if (st.status === 'failed') {
          const detail = st.errors?.map((e) => e?.error_data?.details || e?.title || e?.message).filter(Boolean).join(' | ');
          console.warn(`[WABA STATUS] Pesan ${st.messageId} gagal dikirim (tenant=${tenantId}): ${detail || 'unknown'}`);
          try {
            const { alertService, AlertType, AlertSeverity } = await import('../services/alert.service');
            await alertService.notifyAlert({
              type: AlertType.WABA_MESSAGE_FAILED,
              severity: AlertSeverity.CRITICAL,
              message: `[WABA TEMPLATE FAILED] Pesan ${st.messageId} gagal dikirim (tenant=${tenantId}).`,
              metadata: { tenantId, messageId: st.messageId, errors: st.errors },
            });
          } catch (alertErr) {
            console.error('[WABA STATUS] Gagal kirim alert failed:', (alertErr as Error).message);
          }
        }
        processedStatuses++;
      }
      return reply.status(200).send({ status: 'STATUS_PROCESSED', count: processedStatuses });
    }

    const normalizedMessages = normalizeWabaPayload(body, DEFAULT_TENANT_ID);
    if (normalizedMessages.length === 0) {
      return reply.status(200).send({ status: 'NO_MESSAGES' });
    }

    let processed = 0;
    for (const msg of normalizedMessages) {
      // Tenant resolution per phone_number_id dari payload (multi-tenant WABA)
      const tenantId = await wabaTenantService.resolveTenantByPhoneNumberId(msg.phoneNumberId);

      const isDuplicate = await messageService.isDuplicateMessage(msg.messageId, tenantId);
      if (isDuplicate) {
        console.log(`[WABA IDEMPOTENCY SKIP] ${msg.messageId} already processed [${correlationId}]`);
        continue;
      }

      const customer = await customerService.getOrCreateCustomer(
        msg.fromNumber,
        msg.contactName,
        tenantId
      );

      if (customer.status === 'blocked') {
        const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);
        await messageService.logMessage({
          tenantId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          content: msg.text || (msg.caption ? `[IMAGE: ${msg.caption}]` : '[MEDIA]'),
          waMessageId: msg.messageId,
          payloadRaw: msg.rawPayload,
        });
        continue;
      }

      const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);

      // Best-effort: resolve URL media WABA (image) — gagal tidak menghalangi alur.
      let mediaUrl: string | undefined;
      if (msg.type === 'image' && msg.mediaId) {
        try {
          const { prisma } = await import('../db/client');
          const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
          if (tenant?.waba_access_token) {
            const { decryptSecret } = await import('../utils/encryption');
            const { resolveWabaMediaUrl } = await import('../integrations/whatsapp/media');
            const resolved = await resolveWabaMediaUrl(msg.mediaId, decryptSecret(tenant.waba_access_token));
            mediaUrl = resolved?.url;
          }
        } catch (mediaErr) {
          console.warn(`[WABA MEDIA] Gagal resolve URL media ${msg.mediaId}:`, (mediaErr as Error).message);
        }
      }

      const incomingMessage: any = {
        id: msg.messageId,
        from: msg.fromNumber,
        chatId: msg.fromNumber,
        timestamp: String(msg.timestamp),
        type: msg.type,
        text: msg.text ? { body: msg.text } : undefined,
        location: msg.location
          ? { latitude: msg.location.latitude, longitude: msg.location.longitude }
          : undefined,
        _data: { notifyName: msg.contactName },
        _provider: 'WABA',
        _normalized: msg,
        _mediaUrl: mediaUrl,
      };

      await queueService.enqueueMessage({
        tenantId,
        customerId: customer.id,
        phone: customer.phone,
        incomingMessage,
      });
      processed++;
    }

    return reply.status(200).send({ status: 'PROCESSED', count: processed });
  });
}
