import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WahaWebhookEvent } from '../../integrations/waha/types';
import { customerService } from '../../services/customer.service';
import { conversationService } from '../../services/conversation.service';
import { messageService } from '../../services/message.service';
import { queueService } from '../../services/queue.service';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { safeCompare } from '../../utils/auth';
import { normalizeWahaJid, extractRealPhoneFromWahaPayload } from '../../utils/jid';

/**
 * V3 Lean Fast Ingest Webhook Handler (< 100 lines).
 * Menjamin 100% pesan masuk tercatat di Database & LiveChat sebelum eksekusi apapun.
 */
export async function webhookV3Routes(fastify: FastifyInstance) {
  fastify.post('/webhook/v3', async (request: FastifyRequest<{ Body: WahaWebhookEvent }>, reply: FastifyReply) => {
    // 1. Verifikasi Keamanan Secret Token (Fail-Closed)
    const webhookSecret = process.env.WAHA_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error(JSON.stringify({ event: 'SECURITY_FATAL', error: 'WAHA_WEBHOOK_SECRET is not configured on server.', timestamp: new Date().toISOString() }));
      return reply.status(500).send({ error: 'Server configuration error: Webhook secret is not defined.' });
    }

    const clientSecret = (request.headers['x-webhook-secret'] || request.headers['x-waha-signature'] || '') as string;
    if (!clientSecret || !safeCompare(clientSecret, webhookSecret)) {
      return reply.status(401).send({ error: 'Unauthorized: Invalid or missing secret token.' });
    }

    const event = request.body;
    if (!event || (event.event !== 'message' && event.event !== 'message.any')) {
      return reply.status(200).send({ status: 'IGNORED_EVENT_TYPE' });
    }

    const payload = event.payload;
    if (!payload || payload.fromMe) {
      return reply.status(200).send({ status: 'IGNORED_OUTBOUND_OR_EMPTY' });
    }

    const from = payload.from;
    const chatId = payload.chatId || from || '';
    if (chatId.endsWith('@g.us') || chatId.includes('@broadcast') || chatId.includes('@newsletter')) {
      return reply.status(200).send({ status: 'IGNORED_GROUP_OR_BROADCAST' });
    }

    // 2. Ekstrak Identitas Pelanggan & Nomor HP
    const { phone } = extractRealPhoneFromWahaPayload(payload);
    const waMessageId = payload.id;
    if (!phone || !waMessageId) {
      return reply.status(200).send({ status: 'IGNORED_NO_PHONE_OR_ID' });
    }

    // 3. Cek Idempotency (Anti-Duplikasi Webhook)
    const isDuplicate = await messageService.isDuplicateMessage(waMessageId, DEFAULT_TENANT_ID);
    if (isDuplicate) {
      return reply.status(200).send({ status: 'IGNORED_DUPLICATE' });
    }

    const inboundText = payload.body || (payload.message as any)?.conversation || (payload.message as any)?.extendedTextMessage?.text || (payload.type === 'image' ? '[GAMBAR]' : '[MEDIA]');
    let contactName = payload._data?.notifyName || undefined;

    // 4. Catat Pesan Masuk ke Database & LiveChat (100% Guaranteed Audit Trail)
    const customer = await customerService.getOrCreateCustomer(phone, contactName, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.id,
      direction: 'INBOUND',
      content: inboundText,
      waMessageId,
      payloadRaw: payload,
    });

    conversationService.updateLastCustomerMessageAt(conversation.id, DEFAULT_TENANT_ID).catch(() => {});

    // 5. Jika Conversation sedang dalam mode Human Handling, hentikan balasan bot
    if (conversation.is_human_handling) {
      return reply.status(200).send({ status: 'HUMAN_HANDLING_ACTIVE' });
    }

    // 6. Enqueue ke queueService (throttled, sama dengan webhook utama) — DILARANG direct V3AgentRunner
    await queueService.enqueueMessage({
      tenantId: DEFAULT_TENANT_ID,
      customerId: customer.id,
      phone,
      incomingMessage: {
        id: waMessageId,
        chatId,
        from: phone,
        text: { body: inboundText },
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        // Preserve original payload untuk audit & PII masking
        _rawPayload: payload,
      } as any,
    });

    return reply.status(200).send({ status: 'EVENT_PROCESSED' });
  });
}
