import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WahaWebhookEvent } from '../integrations/waha/types';
import { customerService } from '../services/customer.service';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { queueService } from '../services/queue.service';
import { burstCoalesceService } from '../services/burst-coalesce.service';
import { wahaClient } from '../integrations/waha/client';
import { googleContactsService } from '../services/google-contacts.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { ConversationState } from '@prisma/client';
import { abuseDetectionService } from '../services/abuse-detection.service';
import { enforceAiScopeGate } from '../services/ai-scope-gate.service';
import { contextStorage } from '../utils/context';
import { memoryAdClicks } from './tracking.route';
import { prisma } from '../db/client';
import { matchAdClickAndFireContact } from '../services/ad-attribution.service';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { normalizeWahaJid } from '../utils/jid';
dotenv.config();


export async function webhookRoutes(fastify: FastifyInstance) {
  /**
   * POST /webhook
   * Webhook handler untuk event pesan masuk dari WAHA (WhatsApp HTTP API).
   * Termasuk IDEMPOTENCY CHECK (`wa_message_id`) & EXPLICIT GUARD CLAUSE for HUMAN HANDLING.
   */
  fastify.post('/webhook', async (request: FastifyRequest<{ Body: WahaWebhookEvent }>, reply: FastifyReply) => {
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();
    return contextStorage.run({ correlationId }, async () => {
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
        // Outbound message check for self-learning & MedicalFaqStaging capture
        const customerJid = payload.chatId || (payload as any).to || payload.from;
        if (customerJid) {
          const phone = customerJid.replace(/@.*$/, '');
          const customer = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
          if (customer) {
            const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
            if (conversation && conversation.is_human_handling) {
              const adminReplyText = payload.body || '';

              // CRITICAL FILTER: Ignore bot automated emergency/waiting templates
              const isBotAutoReply = 
                adminReplyText.includes('Bunda, untuk kondisi darurat seperti ini') ||
                adminReplyText.includes('Bunda, untuk pertimbangan kondisi kesehatan') ||
                adminReplyText.startsWith('Pricelist ') ||
                adminReplyText.startsWith('[AUTOMATED]');

              if (adminReplyText.trim() && !isBotAutoReply) {
                // 0. Konsistensi auto-release: balasan admin dari HP asli me-reset timer 6 jam
                conversationService.resetHumanHandlingTimer(conversation.id, DEFAULT_TENANT_ID)
                  .catch(err => console.error('[AUTO-RELEASE RESET ERROR] Failed to reset human handling timer:', err));

                // 1. Self Learning Capture
                console.log(`[SELF-LEARNING] Captured admin manual outbound reply to customer ${phone}: "${adminReplyText}"`);
                const { selfLearningService } = await import('../services/self-learning.service');
                selfLearningService.processAdminReply(customer.id, conversation.id, adminReplyText, DEFAULT_TENANT_ID)
                  .catch(err => console.error('[SELF-LEARNING ERROR] Failed to process admin reply:', err));

                // 2. Component 4: MedicalFaqStaging Capture Hook
                if (conversation.escalation_reason === 'medical_concern') {
                  console.log(`[MEDICAL FAQ STAGING CAPTURE] Capturing manual bidan reply for customer ${phone}`);
                  const lastInbound = await messageService.getLastInboundMessage(conversation.id, DEFAULT_TENANT_ID);
                  const rawQuestion = lastInbound?.content || 'Pertanyaan medis customer';

                  try {
                    await prisma.medicalFaqStaging.create({
                      data: {
                        tenant_id: DEFAULT_TENANT_ID,
                        conversation_id: conversation.id,
                        customer_phone: phone,
                        raw_question: rawQuestion,
                        bidan_raw_reply: adminReplyText,
                        status: 'PENDING',
                      },
                    });
                  } catch (err: any) {
                    console.error('[MEDICAL FAQ STAGING ERROR] Failed to create staging record:', err.message);
                  }
                }
                
                // 3. Log outbound manual reply ke tabel Messages agar terbaca oleh Bot sebagai history
                await messageService.logMessage({
                  tenantId: DEFAULT_TENANT_ID,
                  conversationId: conversation.id,
                  direction: 'OUTBOUND',
                  content: adminReplyText,
                  waMessageId: payload.id,
                  senderType: 'human',
                  senderName: 'Admin (WhatsApp)',
                }).catch(err => console.error('[MESSAGE LOG ERROR] Failed to log admin manual outbound reply:', err));
              }
            }
          }
        }
        return reply.status(200).send({ status: 'IGNORED_OUTBOUND' });
      }


      // --- FILTER CHAT GRUP & NON-PERSONAL (Abaikan group/broadcast/status/newsletter) ---
      // status@broadcast & newsletter JID bukan chat 1-on-1: tanpa filter, normalizeWahaJid
      // menghasilkan phone palsu (mis. "status") dan mencemari DB dengan customer sampah.
      const isGroup = (payload.from && payload.from.endsWith('@g.us')) || 
                      (payload.chatId && payload.chatId.endsWith('@g.us'));
      if (isGroup) {
        return reply.status(200).send({ status: 'IGNORED_GROUP_MESSAGE' });
      }
      const fromJid = payload.from || payload.chatId || '';
      if (fromJid.includes('@broadcast') || fromJid.includes('@newsletter') || fromJid.includes('status@')) {
        return reply.status(200).send({ status: 'IGNORED_NON_PERSONAL' });
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
      const phone = (await wahaClient.getPhoneNumberFromLid(chatId)) || normalizeWahaJid(chatId);
      // Guard: JID yang tidak bisa diekstrak jadi nomor HP (junk/status) jangan sampai
      // membuat customer ber-phone kosong/aneh di database.
      if (!phone) {
        console.warn(`[NO PHONE] Skipping message from unparseable chat ${chatId || '(unknown)'}.`);
        return reply.status(200).send({ status: 'IGNORED_NO_PHONE' });
      }
      const contactName = payload._data?.notifyName;

      // --- MEDIA INBOUND (gambar customer) ---
      // Deteksi image, unduh file dari WAHA, simpan ke storage/media/inbound/<tenantId>,
      // dan lampirkan metadata media ke payload_raw agar bisa dirender di Live Chat
      // (blur + download). Konten teks bot tetap seperti sebelumnya agar state machine
      // & classifier TIDAK berubah. Best-effort: gagal unduh tidak menghentikan alur.
      const isInboundImage = payload.type === 'image' || !!(payload.message && payload.message.imageMessage);
      const imageCaption = (payload.message?.imageMessage?.caption) || payload.caption || '';
      let inboundMedia: any = null;
      if (isInboundImage) {
        try {
          const { mediaService } = await import('../services/media.service');
          const buffer = await wahaClient.downloadMedia(waMessageId, chatId);
          if (buffer && buffer.length > 0) {
            const mimeType = payload.message?.imageMessage?.mimetype || 'image/jpeg';
            const saved = await mediaService.saveInboundMedia({ tenantId: DEFAULT_TENANT_ID, buffer, mimeType });
            inboundMedia = {
              url: saved.thumbUrl || saved.hdUrl,
              hdUrl: saved.hdUrl,
              thumbUrl: saved.thumbUrl,
              mimeType,
              caption: imageCaption || null,
            };
          }
        } catch (mediaErr: any) {
          console.warn('[WAHA MEDIA] Gagal menyimpan media inbound:', mediaErr.message);
        }
      }
      const inboundContent = isInboundImage
        ? (imageCaption ? `[IMAGE: ${imageCaption}]` : '[MEDIA]')
        : (payload.body || '[LOCATION/MEDIA]');
      const mergeMediaIntoPayload = (p: any) => (inboundMedia ? { ...p, media: inboundMedia } : p);

      // --- LEGACY PER-CONTACT SCRAPE TRIGGER (Task 2 / flag: ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER) ---
      // Posisi: SETELAH admin bypass, SEBELUM getOrCreateCustomer utama. Jika chat
      // berlabel 'legacy' dan customer belum pernah di-scrape, kita picu scraping
      // historis per-kontak dan return 200 TANPA masuk ke state machine.
      if (process.env.ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER === 'true') {
        if (labels.some(l => l.toLowerCase() === 'legacy')) {
          const existingCust = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
          if (existingCust && !existingCust.legacy_scraped_at) {
            console.log(`[LEGACY SCRAPE TRIGGER] Chat ${chatId} labeled 'legacy', customer not yet scraped. Triggering.`);
            // Log inbound message ke audit trail
            const customer = await customerService.getOrCreateCustomer(phone, contactName, DEFAULT_TENANT_ID);
            const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
            await messageService.logMessage({
              tenantId: DEFAULT_TENANT_ID,
              conversationId: conversation.id,
              direction: 'INBOUND',
              content: inboundContent,
              waMessageId,
              payloadRaw: mergeMediaIntoPayload(payload),
            });
            // Best-effort: addLabel 'hold' (skip pada dry-run)
            if (process.env.LEGACY_SCRAPE_DRY_RUN !== 'true') {
              wahaClient.addLabel(chatId, 'hold').catch((err: any) => console.warn('[LEGACY SCRAPE] addLabel hold failed:', err.message));
            }
            // Fire-and-forget scrape
            import('../services/per-contact-legacy-scrape.service').then(({ perContactLegacyScrapeService }) => {
              perContactLegacyScrapeService.scrapeContactUntilFirstLead(chatId, DEFAULT_TENANT_ID)
                .catch((err: any) => console.error('[LEGACY SCRAPE ERROR]', err));
            });
            return reply.status(200).send({ status: 'LEGACY_SCRAPE_TRIGGERED' });
          }
        }
      }


      // Periksa apakah customer baru (belum ada record di database)
      const existingCustomer = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
      const isNewCustomerRecord = !existingCustomer;

      // Ambil/Buat record Customer & Conversation
      const customer = await customerService.getOrCreateCustomer(phone, contactName, DEFAULT_TENANT_ID);

      // Cek apakah customer baru saja dibuat (< 5 detik lalu) untuk memicu auto-save ke Google Contacts
      const isNewCustomer = Date.now() - new Date(customer.created_at).getTime() < 5000;
      if (isNewCustomer) {
        googleContactsService.createContact(phone, contactName).catch((err) => {
          console.error('[GOOGLE CONTACTS] Unhandled rejection:', err);
        });
      }

      // --- LABEL "new customer" (Task 3 / flag: ENABLE_LIFECYCLE_LABELS) ---
      // Hanya untuk customer baru (record baru dibuat) yang BUKAN legacy source —
      // legacy customer yang melakukan scrape ulang tidak perlu label ini.
      if (process.env.ENABLE_LIFECYCLE_LABELS === 'true' && isNewCustomer && !customer.is_legacy_source) {
        wahaClient.addLabel(chatId, 'new customer').catch((err: any) =>
          console.warn('[LIFECYCLE LABEL] addLabel "new customer" failed:', err.message)
        );
      }

      let conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
      conversationService.updateLastCustomerMessageAt(conversation.id, DEFAULT_TENANT_ID).catch(() => {});

      // --- GUARD CLAUSE: BLOCKED CUSTOMER (Tergolong di awal pemrosesan, setelah Idempotency Check) ---
      if (customer.status === 'blocked') {
        console.warn(`[BLOCKED ACCESS] Blocked customer ${phone} attempted to send a message. Logging to audit and dropping response.`);
        await messageService.logMessage({
          tenantId: DEFAULT_TENANT_ID,
          conversationId: conversation.id,
          direction: 'INBOUND',
          content: inboundContent,
          waMessageId,
          payloadRaw: mergeMediaIntoPayload(payload),
        });
        return reply.status(200).send({ status: 'BLOCKED' });
      }

      // --- AI ROLLOUT SCOPE GATE (Task: AI hanya untuk customer baru) ---
      // Evaluasi sebelum state machine / AI Router / LLM. Legacy customer yang
      // tidak eligible di-senyapkan (human handling + escalation khusus) — lihat
      // ai-scope-gate.service.ts utk detail definisi "reset boundary" & mid-flow defer.
      const scopeGate = await enforceAiScopeGate({
        customer,
        conversation,
        tenantId: DEFAULT_TENANT_ID,
        content: inboundContent,
        waMessageId,
        payloadRaw: mergeMediaIntoPayload(payload),
      });
      if (scopeGate.action === 'silence') {
        return reply.status(200).send({ status: scopeGate.status });
      }

      // Converted standardized incoming message format
      const incomingMessage: any = {
        id: waMessageId,
        from: phone,
        chatId,
        timestamp: String(payload.timestamp || Math.floor(Date.now() / 1000)),
        type: payload.location ? 'location' : isInboundImage ? 'image' : 'text',
        text: payload.body ? { body: payload.body } : undefined,
        location: payload.location
          ? {
              // WAHA kadang mengirim lat/lng sebagai string — koerce ke number
              // supaya tidak menabrak kolom Float di Prisma.
              latitude: Number(payload.location.latitude),
              longitude: Number(payload.location.longitude),
            }
          : undefined,
        media: inboundMedia,
      };

      // --- PURCHASE EVENT DETECTION (sebelum state machine / HUMAN HANDLING guard,
      //     agar tetap berjalan walau bot silent). Pesan berisi keyword format_purchase
      //     + nominal rupiah → fire event CAPI 'Purchase' & tandai reservasi. ---
      if (incomingMessage.type === 'text' && incomingMessage.text?.body) {
        try {
          const { maybeFirePurchaseEvent } = await import('../services/purchase-detection.service');
          await maybeFirePurchaseEvent({
            customer,
            conversation,
            text: incomingMessage.text.body,
            tenantId: DEFAULT_TENANT_ID,
          });
        } catch (purchaseErr) {
          console.warn('[CAPI] Purchase detection error:', (purchaseErr as Error).message);
        }
      }

      // --- ATTRIBUTION CHECK & CAPI CONTACT (SHARED SERVICE) ---
      const bodyText = incomingMessage.text?.body || '';
      const attributionResult = await matchAdClickAndFireContact({
        bodyText,
        isNewCustomerRecord,
        customer,
        tenantId: DEFAULT_TENANT_ID,
      });

      if (incomingMessage.text && attributionResult.strippedText) {
        incomingMessage.text.body = attributionResult.strippedText;
      }


      // --- REVISI USER #4: EXPLICIT GUARD CLAUSE UNTUK HUMAN HANDLING ---
      // Memeriksa apakah timeout auto-release 6 jam sudah terlampaui terlebih dahulu
      const autoRelease = conversationService.checkAndApplyAutoRelease(conversation, DEFAULT_TENANT_ID);
      conversation = autoRelease.updatedConversation;

      // JIKA is_human_handling === true (dan belum timed out):
      if (conversation.is_human_handling) {
        // Grace period check: if escalation happened less than 30 seconds ago,
        // do not auto-release even if hold label is not returned (to handle api latency / async sync delay)
        // Exempt the unit test environment from this grace period since tests run instantly
        const isTesting = process.env.NODE_ENV === 'test';
        const timeSinceEscalation = conversation.human_handling_since && !isTesting
          ? Date.now() - new Date(conversation.human_handling_since).getTime()
          : Infinity;

        if (timeSinceEscalation <= 30000) {
          console.log(`[ESCALATION GRACE PERIOD] Conversation ${conversation.id} escalated recently (${(timeSinceEscalation / 1000).toFixed(1)}s ago). Bypassing WhatsApp label release checks.`);
          // Log pesan ke DB Audit Trail
          await messageService.logMessage({
            tenantId: DEFAULT_TENANT_ID,
            conversationId: conversation.id,
            direction: 'INBOUND',
            content: incomingMessage.text?.body || '[LOCATION/MEDIA]',
            waMessageId: waMessageId,
            payloadRaw: mergeMediaIntoPayload(payload),
          });
          return reply.status(200).send({ status: 'HUMAN_HANDLING_ACTIVE_SILENT' });
        }

        // If hold label feature is disabled (ENABLE_WAHA_HOLD_LABEL=false), do not check WAHA labels for release
        const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL !== 'false';
        if (!enableHoldLabel) {
          console.log(`[LABEL SYNC DISABLED] Skipping WAHA label checks in production. Bot stays silent.`);
          await messageService.logMessage({
            tenantId: DEFAULT_TENANT_ID,
            conversationId: conversation.id,
            direction: 'INBOUND',
            content: incomingMessage.text?.body || '[LOCATION/MEDIA]',
            waMessageId: waMessageId,
            payloadRaw: mergeMediaIntoPayload(payload),
          });
          return reply.status(200).send({ status: 'HUMAN_HANDLING_ACTIVE_SILENT' });
        }

        // Periksa apakah admin telah melepas label 'hold' di WhatsApp
        const currentLabels = await wahaClient.getChatLabels(chatId);
        const hasHoldLabel = currentLabels.some(l => l.toLowerCase() === 'hold');

        if (!hasHoldLabel && process.env.ENABLE_WAHA_HOLD_LABEL !== 'false') {
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
            payloadRaw: mergeMediaIntoPayload(payload),
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
          payloadRaw: mergeMediaIntoPayload(payload),
        });
        return reply.status(200).send({ status: 'BLOCKED' });
      }

      // Masukkan pesan ke antrian pemrosesan sekuensial per customer.
      // Payload hanya membawa identifier; worker re-fetch fresh customer/conversation
      // dari DB saat job diproses (cegah stale state / race condition pesan beruntun).
      // BURST COALESCING: jika aktif (BURST_COALESCE_MS>0) dan pesan text di state
      // open-ended, pesan di-buffer lalu di-merge jadi 1 balasan (handled=true).
      const coalesceResult = await burstCoalesceService.maybeCoalesce({
        tenantId: DEFAULT_TENANT_ID,
        customerId: customer.id,
        phone: customer.phone,
        conversation,
        incomingMessage,
      });

      if (!coalesceResult.handled) {
        await queueService.enqueueMessage({
          tenantId: DEFAULT_TENANT_ID,
          customerId: customer.id,
          phone: customer.phone,
          incomingMessage,
        });
      }

      return reply.status(200).send({ status: 'EVENT_PROCESSED' });
    });
  });
}
