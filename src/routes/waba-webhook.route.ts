import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyMetaSignature } from '../integrations/whatsapp/signature';
import { normalizeWabaPayload } from '../integrations/whatsapp/normalizer';
import { customerService } from '../services/customer.service';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { queueService } from '../services/queue.service';
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
    const rawBody = JSON.stringify(request.body);
    const signature = request.headers['x-hub-signature-256'] as string | undefined;

    if (!verifyMetaSignature(rawBody, signature, appSecret)) {
      console.warn(`[WABA SECURITY] Invalid HMAC signature from ${request.ip} [${correlationId}]`);
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const body = request.body as any;
    if (!body || body.object !== 'whatsapp_business_account') {
      return reply.status(200).send({ status: 'IGNORED' });
    }

    const normalizedMessages = normalizeWabaPayload(body, DEFAULT_TENANT_ID);
    if (normalizedMessages.length === 0) {
      return reply.status(200).send({ status: 'NO_MESSAGES' });
    }

    let processed = 0;
    for (const msg of normalizedMessages) {
      const isDuplicate = await messageService.isDuplicateMessage(msg.messageId, DEFAULT_TENANT_ID);
      if (isDuplicate) {
        console.log(`[WABA IDEMPOTENCY SKIP] ${msg.messageId} already processed [${correlationId}]`);
        continue;
      }

      const customer = await customerService.getOrCreateCustomer(
        msg.fromNumber,
        msg.contactName,
        DEFAULT_TENANT_ID
      );

      if (customer.status === 'blocked') {
        const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
        await messageService.logMessage({
          tenantId: DEFAULT_TENANT_ID,
          conversationId: conversation.id,
          direction: 'INBOUND',
          content: msg.text || '[MEDIA]',
          waMessageId: msg.messageId,
          payloadRaw: msg.rawPayload,
        });
        continue;
      }

      const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

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
      };

      await queueService.enqueueMessage({
        tenantId: DEFAULT_TENANT_ID,
        customer,
        conversation,
        incomingMessage,
      });
      processed++;
    }

    return reply.status(200).send({ status: 'PROCESSED', count: processed });
  });
}
