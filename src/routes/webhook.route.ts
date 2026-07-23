import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WahaWebhookEvent } from '../integrations/waha/types';
import { customerService } from '../services/customer.service';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { queueService } from '../services/queue.service';
import { wahaClient } from '../integrations/waha/client';
import { googleContactsService } from '../services/google-contacts.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { ConversationState } from '@prisma/client';
import { abuseDetectionService } from '../services/abuse-detection.service';
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
    if (!payload) {
      return reply.status(200).send({ status: 'IGNORED_EVENT_TYPE' });
    }

    if (payload.fromMe) {
      // Outbound message check for self-learning
      const customerJid = payload.chatId || (payload as any).to || payload.from;
      if (customerJid) {
        const phone = customerJid.replace(/@.*$/, '');
        const customer = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
        if (customer) {
          const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
          if (conversation && conversation.is_human_handling) {
            // This is an admin/human reply! Let's record and learn from it
            const adminReplyText = payload.body || '';
            if (adminReplyText.trim()) {
              console.log(`[SELF-LEARNING] Captured admin outbound reply to customer ${phone}: "${adminReplyText}"`);
              const { selfLearningService } = await import('../services/self-learning.service');
              selfLearningService.processAdminReply(customer.id, conversation.id, adminReplyText, DEFAULT_TENANT_ID)
                .catch(err => console.error('[SELF-LEARNING ERROR] Failed to process admin reply:', err));
            }
          }
        }
      }
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

    // Extrak nomor HP internasional dari JID WAHA (misal "79903991054369@lid" -> "6285794210526")
    const chatId = payload.from;

    // --- REVISI USER: BYPASS EMPLOYEE/ADMIN CHATS ---
    const labels = await wahaClient.getChatLabels(chatId);
    if (labels.some(l => l.toLowerCase() === 'admin')) {
      console.log(`[ADMIN BYPASS] Chat ${chatId} is labeled as "Admin". Ignoring message to allow employee manually chatting.`);
      return reply.status(200).send({ status: 'IGNORED_ADMIN' });
    }

    const phone = await wahaClient.getPhoneNumberFromLid(chatId);
    const contactName = payload._data?.notifyName;

    // Ambil/Buat record Customer & Conversation
    const customer = await customerService.getOrCreateCustomer(phone, contactName, DEFAULT_TENANT_ID);

    // Cek apakah customer baru saja dibuat (< 5 detik lalu) untuk memicu auto-save ke Google Contacts
    const isNewCustomer = Date.now() - new Date(customer.created_at).getTime() < 5000;
    if (isNewCustomer) {
      googleContactsService.createContact(phone, contactName).catch((err) => {
        console.error('[GOOGLE CONTACTS] Unhandled rejection:', err);
      });
    }

    let conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    // --- GUARD CLAUSE: BLOCKED CUSTOMER (Tergolong di awal pemrosesan, setelah Idempotency Check) ---
    if (customer.status === 'blocked') {
      console.warn(`[BLOCKED ACCESS] Blocked customer ${phone} attempted to send a message. Logging to audit and dropping response.`);
      await messageService.logMessage({
        tenantId: DEFAULT_TENANT_ID,
        conversationId: conversation.id,
        direction: 'INBOUND',
        content: payload.body || '[LOCATION/MEDIA]',
        waMessageId,
        payloadRaw: payload,
      });
      return reply.status(200).send({ status: 'BLOCKED' });
    }

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

    // --- ABUSE DETECTION CHECK (Sebelum antrean / queue) ---
    const abuseResult = await abuseDetectionService.checkAndProcessAbuse(
      customer,
      conversation,
      incomingMessage.text?.body || '',
      DEFAULT_TENANT_ID
    );

    if (abuseResult.blocked) {
      // Log pesan pemicu blokir ke audit trail
      await messageService.logMessage({
        tenantId: DEFAULT_TENANT_ID,
        conversationId: conversation.id,
        direction: 'INBOUND',
        content: incomingMessage.text?.body || '[LOCATION/MEDIA]',
        waMessageId,
        payloadRaw: payload,
      });
      return reply.status(200).send({ status: 'BLOCKED' });
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
