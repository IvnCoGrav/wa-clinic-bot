import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WahaWebhookEvent } from '../integrations/waha/types';
import { customerService } from '../services/customer.service';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { queueService } from '../services/queue.service';
import { wahaClient } from '../integrations/waha/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { ConversationState } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

export async function webhookRoutes(fastify: FastifyInstance) {
  /**
   * POST /webhook
   * Webhook handler untuk event pesan masuk dari WAHA (WhatsApp HTTP API).
   * Termasuk IDEMPOTENCY CHECK (`wa_message_id`) & EXPLICIT GUARD CLAUSE for HUMAN HANDLING.
   */
  fastify.post('/webhook', async (request: FastifyRequest<{ Body: WahaWebhookEvent }>, reply: FastifyReply) => {
    // --- SECURITY VERIFICATION (X-Webhook-Secret) ---
    const webhookSecret = process.env.WAHA_WEBHOOK_SECRET;
    if (webhookSecret) {
      const clientSecret = request.headers['x-webhook-secret'] || request.headers['x-waha-signature'];
      if (!clientSecret || clientSecret !== webhookSecret) {
        console.warn(`[SECURITY WARNING] Unauthorized webhook access attempt from IP: ${request.ip}`);
        return reply.status(401).send({ error: 'Unauthorized: Invalid or missing webhook secret token.' });
      }
    }

    const event = request.body;

    // Filter hanya event "message" atau "message.any"
    if (!event || (event.event !== 'message' && event.event !== 'message.any')) {
      return reply.status(200).send({ status: 'IGNORED_EVENT_TYPE' });
    }

    const payload = event.payload;
    if (!payload || payload.fromMe) {
      // Abaikan pesan dari bot sendiri (fromMe === true)
      return reply.status(200).send({ status: 'IGNORED_OUTBOUND' });
    }

    // --- FILTER CHAT GRUP (Abaikan group messages) ---
    const isGroup = (payload.from && payload.from.endsWith('@g.us')) || 
                    (payload.chatId && payload.chatId.endsWith('@g.us'));
    if (isGroup) {
      return reply.status(200).send({ status: 'IGNORED_GROUP_MESSAGE' });
    }

    const waMessageId = payload.id;

    // --- REVISI USER #3: IDEMPOTENCY CHECK ---
    const isDuplicate = await messageService.isDuplicateMessage(waMessageId, DEFAULT_TENANT_ID);
    if (isDuplicate) {
      console.log(`[IDEMPOTENCY SKIP] WAHA Message ID ${waMessageId} has already been processed. Skipping retry.`);
      return reply.status(200).send({ status: 'IGNORED_DUPLICATE' });
    }

    // Extrak nomor HP internasional dari chatId WAHA (misal "628123456789@c.us" -> "628123456789")
    const chatId = payload.from;
    const phone = chatId.replace(/@.*$/, '');
    const contactName = payload._data?.notifyName;

    // Ambil/Buat record Customer & Conversation
    const customer = await customerService.getOrCreateCustomer(phone, contactName, DEFAULT_TENANT_ID);
    let conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // Converted standardized incoming message format
    const incomingMessage: any = {
      id: waMessageId,
      from: phone,
      chatId,
      timestamp: String(payload.timestamp || Math.floor(Date.now() / 1000)),
      type: payload.location ? 'location' : 'text',
      text: payload.body ? { body: payload.body } : undefined,
      location: payload.location
        ? {
            latitude: payload.location.latitude,
            longitude: payload.location.longitude,
          }
        : undefined,
    };

    // --- REVISI USER #4: EXPLICIT GUARD CLAUSE UNTUK HUMAN HANDLING ---
    // Memeriksa apakah timeout auto-release 6 jam sudah terlampaui terlebih dahulu
    const autoRelease = conversationService.checkAndApplyAutoRelease(conversation, DEFAULT_TENANT_ID);
    conversation = autoRelease.updatedConversation;

    // JIKA is_human_handling === true (dan belum timed out):
    if (conversation.is_human_handling) {
      // Periksa apakah admin telah melepas label 'hold' di WhatsApp
      const currentLabels = await wahaClient.getChatLabels(chatId);
      const hasHoldLabel = currentLabels.some(l => l.toLowerCase() === 'hold');

      if (!hasHoldLabel) {
        console.log(`[ADMIN RELEASE] Hold label removed by admin for chat ${chatId}. Auto-releasing from HUMAN_HANDLING.`);
        const restoredState = conversation.previous_state || ConversationState.INITIAL;
        conversation = await conversationService.updateConversationState(
          conversation.id,
          {
            currentState: restoredState,
            isHumanHandling: false,
            humanHandlingSince: null,
          },
          DEFAULT_TENANT_ID
        );
      } else {
        console.log(`[EXPLICIT GUARD CLAUSE] Conversation ${conversation.id} is in HUMAN_HANDLING mode. Logging inbound message and BYPASSING all LLM & auto-replies.`);

        // Log pesan ke DB Audit Trail
        await messageService.logMessage({
          tenantId: DEFAULT_TENANT_ID,
          conversationId: conversation.id,
          direction: 'INBOUND',
          content: incomingMessage.text?.body || '[LOCATION/MEDIA]',
          waMessageId: waMessageId,
          payloadRaw: payload,
        });

        // Kembalikan 200 OK tanpa memanggil state machine atau LLM!
        return reply.status(200).send({ status: 'HUMAN_HANDLING_ACTIVE_SILENT' });
      }
    }

    // Masukkan pesan ke antrian pemrosesan sekuensial per customer
    await queueService.enqueueMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation,
      incomingMessage,
    });

    return reply.status(200).send({ status: 'EVENT_PROCESSED' });
  });
}
