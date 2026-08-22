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
import { stageLog } from '../utils/stage-logger';
import { memoryAdClicks } from './tracking.route';
import { prisma } from '../db/client';
import { matchAdClickAndFireContact } from '../services/ad-attribution.service';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { normalizeWahaJid } from '../utils/jid';
import { invalidateCachedLabels } from '../integrations/waha/label-cache';
dotenv.config();

/**
 * Handler event label.chat.added / label.chat.deleted dari WAHA.
 * Meng-update kolom Customer.is_admin_labeled / is_hold_labeled (best-effort)
 * supaya jalur pesan masuk bisa membaca status label dari DB tanpa HTTP call
 * ke WAHA. Label lain di-cache-invalidate supaya fallback getChatLabels segar.
 * Event dengan payload.label null (mis. baru selesai scan QR) dilewati —
 * LabelReconciliationService tetap menjadi safety-net periodik.
 */
async function handleLabelChatEvent(event: WahaWebhookEvent): Promise<void> {
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
    });
    invalidateCachedLabels(chatId);
  } catch (err: any) {
    console.warn(`[LABEL EVENT] Failed to process label event ${event.event}:`, err.message);
  }
}


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

      // --- EVENT LABEL (Task: event-driven label sync) ---
      // WAHA mengirim label.chat.added / label.chat.deleted setiap kali label
      // berubah di WhatsApp Business (termasuk manual oleh admin di aplikasi WA
      // Business). Dipakai untuk meng-update kolom Customer.is_admin_labeled /
      // is_hold_labeled agar jalur pesan masuk tidak perlu memanggil WAHA sama sekali
      // (LabelReconciliationService tetap jalan sebagai safety-net periodik).
      if (!event) {
        return reply.status(200).send({ status: 'IGNORED_EVENT_TYPE' });
      }
      if (event.event === 'label.chat.added' || event.event === 'label.chat.deleted') {
        await handleLabelChatEvent(event);
        return reply.status(200).send({ status: 'LABEL_EVENT_PROCESSED' });
      }

      // --- EVENT MESSAGE.ACK (WAHA Message Delivery & Read Receipts) ---
      if (event.event === 'message.ack') {
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
              DEFAULT_TENANT_ID,
              deliveryStatus,
              ackPayload.timestamp ? Number(ackPayload.timestamp) : undefined
            );
          }
        }
        return reply.status(200).send({ status: 'ACK_PROCESSED' });
      }

      // Filter hanya event "message" atau "message.any"
      if (event.event !== 'message' && event.event !== 'message.any') {
        return reply.status(200).send({ status: 'IGNORED_EVENT_TYPE' });
      }

      const payload = event.payload;
      if (!payload) {
        return reply.status(200).send({ status: 'IGNORED_EVENT_TYPE' });
      }

      if (payload.fromMe) {
        // Outbound message dari HP WhatsApp asli / Live Chat / Bot
        const customerJid = payload.chatId || (payload as any).to || payload.from;
        if (customerJid) {
          // Lewati grup WhatsApp & status broadcast
          if (customerJid.includes('@g.us') || customerJid.includes('broadcast') || customerJid.includes('@newsletter')) {
            return reply.status(200).send({ status: 'IGNORED_OUTBOUND_GROUP' });
          }

          let phone: string | null = null;
          if (customerJid.includes('@lid')) {
            try {
              phone = await wahaClient.getPhoneNumberFromLid(customerJid);
            } catch (_) {}
          }
          if (!phone) {
            phone = customerJid.replace(/@.*$/, '');
          }

          if (phone && /^\d+$/.test(phone) && !phone.startsWith('6289999')) {
            const adminReplyText = payload.body || '';

            // CRITICAL FILTER: Ignore bot automated emergency/waiting templates if echoed back
            const isBotAutoReply = 
              adminReplyText.includes('Bunda, untuk kondisi darurat seperti ini') ||
              adminReplyText.includes('Bunda, untuk pertimbangan kondisi kesehatan') ||
              adminReplyText.startsWith('Pricelist ') ||
              adminReplyText.startsWith('[AUTOMATED]');

            if (adminReplyText.trim() && !isBotAutoReply) {
              const customer = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
              const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

              // 1. Jika percakapan sedang human handling, reset timer 6 jam
              if (conversation.is_human_handling) {
                conversationService.resetHumanHandlingTimer(conversation.id, DEFAULT_TENANT_ID)
                  .catch((err) => console.error('[AUTO-RELEASE RESET ERROR] Failed to reset human handling timer:', err));
              } else {
                // Jika admin membalas langsung dari HP saat bot aktif, eskalasi ke human handling (takeover)
                try {
                  const tenantConfig = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
                  if (tenantConfig?.manual_reply_escalates !== false) {
                    await conversationService.escalateToHumanHandling(
                      conversation,
                      phone,
                      'Admin membalas manual via aplikasi WhatsApp HP',
                      DEFAULT_TENANT_ID,
                      'manual_reply'
                    );
                  }
                } catch (_) {}
              }

              // 2. Self Learning Capture
              const { selfLearningService } = await import('../services/self-learning.service');
              selfLearningService.processAdminReply(customer.id, conversation.id, adminReplyText, DEFAULT_TENANT_ID)
                .catch((err) => console.error('[SELF-LEARNING ERROR] Failed to process admin reply:', err));

              // 3. MedicalFaqStaging Capture Hook
              if (conversation.escalation_reason === 'medical_concern') {
                try {
                  const lastInbound = await messageService.getLastInboundMessage(conversation.id, DEFAULT_TENANT_ID);
                  const rawQuestion = lastInbound?.content || 'Pertanyaan medis customer';
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

              // 4. Log outbound manual reply ke tabel Messages & broadcast SSE ke Live Chat Panel
              const isDuplicateOutbound = await messageService.isDuplicateMessage(payload.id, DEFAULT_TENANT_ID);
              const isRecentDuplicate = await messageService.checkAndAttachOutboundDuplicate(
                conversation.id,
                adminReplyText,
                payload.id,
                DEFAULT_TENANT_ID,
                30
              );

              if (!isDuplicateOutbound && !isRecentDuplicate) {
                let msgDate: Date | undefined = undefined;
                if (payload.timestamp) {
                  const rawTs = Number(payload.timestamp);
                  if (!isNaN(rawTs) && rawTs > 0) {
                    const ms = rawTs > 10000000000 ? rawTs : rawTs * 1000;
                    msgDate = new Date(ms);
                  }
                }

                await messageService.logMessage({
                  tenantId: DEFAULT_TENANT_ID,
                  conversationId: conversation.id,
                  direction: 'OUTBOUND',
                  content: adminReplyText,
                  waMessageId: payload.id,
                  senderType: 'ADMIN',
                  senderName: 'Admin (WhatsApp HP)',
                  createdAt: msgDate,
                }).catch((err) => console.error('[MESSAGE LOG ERROR] Failed to log admin manual outbound reply:', err));

                console.log(`[LIVE CHAT OUTBOUND] Balasan WhatsApp HP ke ${phone} tercatat & disiarkan ke Live Chat.`);
              } else {
                console.log(`[OUTBOUND DUPLICATE SKIP] Outbound message ${payload.id} already recorded.`);
              }

              // 5. Background Auto-Capture Reservasi dari Konfirmasi Admin
              try {
                const { isReservationFormMessage, parseReservationText } = await import('../utils/reservation-text-parser');
                if (isReservationFormMessage(adminReplyText)) {
                  const parseResult = parseReservationText(adminReplyText);
                  if (parseResult.success && parseResult.reservation) {
                    const parsed = parseResult.reservation;
                    const recentExisting = await prisma.reservation.findFirst({
                      where: {
                        customer_id: customer.id,
                        tenant_id: DEFAULT_TENANT_ID,
                        created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                        treatment_detail: parsed.treatmentDetail,
                      },
                    });

                    if (!recentExisting) {
                      const reservation = await prisma.reservation.create({
                        data: {
                          tenant_id: DEFAULT_TENANT_ID,
                          customer_id: customer.id,
                          treatment_category: parsed.treatmentCategory,
                          treatment_detail: parsed.treatmentDetail,
                          booking_date: parsed.bookingDate,
                          raw_text: adminReplyText,
                          status: 'pending',
                          purchase_value: parsed.payment?.treatmentPrice || parsed.payment?.totalPrice || undefined,
                        },
                      });

                      console.log(`[ADMIN OUTBOUND AUTO-CAPTURE] Created reservation ${reservation.id} for customer ${customer.phone} (${parsed.name})`);

                      const { reservationLifecycleService } = await import('../services/reservation-lifecycle.service');
                      await reservationLifecycleService.onReservationCreated({
                        customerId: customer.id,
                        reservationId: reservation.id,
                        tenantId: DEFAULT_TENANT_ID,
                        chatId: customerJid,
                        babies: parsed.babies || [],
                      });

                      const customerName = parsed.name?.trim();
                      if (customerName && customerName.length > 0 && customerName.toLowerCase() !== 'bunda') {
                        const kecamatan = customer.kecamatan || '';
                        const contactName = `Bunda ${customerName}${kecamatan ? ` ${kecamatan}` : ''}`.trim();
                        await customerService.updateCustomerName(customer.id, contactName, DEFAULT_TENANT_ID).catch(() => {});
                      }
                    }
                  }
                }
              } catch (adminCaptureErr: any) {
                console.warn('[ADMIN OUTBOUND AUTO-CAPTURE ERROR]', adminCaptureErr.message);
              }

              // 6. CAPI Event Trigger dari Pesan Outbound WhatsApp HP (InitiateCheckout & Purchase)
              try {
                const { getTenantCapiFormats, fireCapiEvent } = await import('../services/capi.service');
                const formats = await getTenantCapiFormats(DEFAULT_TENANT_ID);
                const replyLower = adminReplyText.toLowerCase();

                // A. InitiateCheckout jika pesan memuat format_checkout
                const checkoutKeyword = formats.formatCheckout.toLowerCase().replace(/\s+/g, ' ').trim();
                if (checkoutKeyword.length > 0 && replyLower.includes(checkoutKeyword)) {
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
                    tenantId: DEFAULT_TENANT_ID,
                    customData: { source: 'ADMIN_HP_FORM_SENT' },
                  });
                  console.log(`[CAPI] InitiateCheckout triggered from WhatsApp HP outbound message (${customer.phone}).`);
                }

                // B. Purchase detection jika pesan memuat format_purchase
                const purchaseKeyword = formats.formatPurchase.toLowerCase().trim();
                if (purchaseKeyword.length > 0 && replyLower.includes(purchaseKeyword)) {
                  const { maybeFirePurchaseEvent } = await import('../services/purchase-detection.service');
                  await maybeFirePurchaseEvent({
                    customer,
                    conversation,
                    text: adminReplyText,
                    tenantId: DEFAULT_TENANT_ID,
                  });
                }
              } catch (capiErr: any) {
                console.warn('[CAPI OUTBOUND ERROR]', capiErr.message);
              }
            }
          }
        }
        return reply.status(200).send({ status: 'IGNORED_OUTBOUND' });
      }

      // Inbound message (dari customer ke bot)
      const from = payload.from;
      const chatId = payload.chatId || from || '';

      // --- FILTER CHAT GRUP & NON-PERSONAL (Abaikan group/broadcast/status/newsletter) ---
      const isGroup = (payload.from && payload.from.endsWith('@g.us')) || 
                      (payload.chatId && payload.chatId.endsWith('@g.us')) ||
                      chatId.endsWith('@g.us');
      if (isGroup) {
        return reply.status(200).send({ status: 'IGNORED_GROUP_MESSAGE' });
      }

      const fromJid = payload.from || payload.chatId || '';
      if (fromJid.includes('@broadcast') || fromJid.includes('@newsletter') || fromJid.includes('status@')) {
        return reply.status(200).send({ status: 'IGNORED_NON_PERSONAL' });
      }

      const resolvedJid = await wahaClient.resolvePrimaryJid(chatId);

      const waMessageId = payload.id;
      if (!waMessageId) {
        return reply.status(200).send({ status: 'IGNORED_NO_ID' });
      }

      // --- IDEMPOTENCY CHECK ---
      const isDuplicate = await messageService.isDuplicateMessage(waMessageId, DEFAULT_TENANT_ID);
      if (isDuplicate) {
        console.log(`[IDEMPOTENCY SKIP] WAHA Message ID ${waMessageId} has already been processed. Skipping retry.`);
        return reply.status(200).send({ status: 'IGNORED_DUPLICATE' });
      }

      // --- REVISI USER: BYPASS EMPLOYEE/ADMIN CHATS ---
      // Fast path: baca Customer.is_admin_labeled dari DB (nol HTTP ke WAHA).
      // Fallback: customer belum punya record / DB offline → tanya WAHA (dengan
      // cache TTL 15s dari label-cache, jadi murah).
      const phone = resolvedJid.replace(/@.*$/, '') || normalizeWahaJid(chatId);
      // Guard: JID yang tidak bisa diekstrak jadi nomor HP (junk/status) jangan sampai
      // membuat customer ber-phone kosong/aneh di database.
      if (!phone) {
        console.warn(`[NO PHONE] Skipping message from unparseable chat ${chatId || '(unknown)'}.`);
        return reply.status(200).send({ status: 'IGNORED_NO_PHONE' });
      }

      const msgObj = payload.message as any;
      const inboundTextPreview = payload.body || msgObj?.conversation || msgObj?.extendedTextMessage?.text || (payload.type === 'image' ? '[GAMBAR]' : '[MEDIA]');
      stageLog('INCOMING', `Customer: "${inboundTextPreview.slice(0, 50).replace(/\n/g, ' ')}${inboundTextPreview.length > 50 ? '...' : ''}"`, phone);
      let contactName = payload._data?.notifyName;
      if (!contactName) {
        try {
          const cObj = await wahaClient.getContact(chatId);
          contactName = cObj?.pushname || cObj?.name || undefined;
        } catch (_) {}
      }

      // --- FAST-PATH GUARD: STALE / CATCH-UP MESSAGE (Mencegah banjir sync saat QR scan / reconnect) ---
      // Dievaluasi SEDINI MUNGKIN SEBELUM API eksternal (Google Contacts, WAHA Label, Unduh Media, State Machine).
      // Pesan lama tetap dicatat ke database (audit trail & Live Chat), tetapi dilewati dari bot auto-reply & API eksternal.
      const maxAgeSeconds = parseInt(process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS || '180', 10);
      if (maxAgeSeconds > 0 && payload.timestamp) {
        const rawTs = Number(payload.timestamp);
        if (!isNaN(rawTs) && rawTs > 0) {
          const msgTimeMs = rawTs > 10000000000 ? rawTs : rawTs * 1000;
          const ageSeconds = Math.floor((Date.now() - msgTimeMs) / 1000);
          if (ageSeconds > maxAgeSeconds) {
            // Bypass stale guard untuk form reservasi — jam WAHA bisa telat saat reconnect/QR rebroadcast (kasus Siska #777).
            // Form tetap harus diproses meski timestamp terlihat stale.
            const rawBodyForStale = payload.body || msgObj?.conversation || msgObj?.extendedTextMessage?.text || '';
            let isStaleForm = false;
            try {
              const { isReservationFormMessage: _isFormStale } = await import('../utils/reservation-text-parser');
              isStaleForm = _isFormStale(rawBodyForStale);
            } catch {}
            if (isStaleForm) {
              console.log(`[STALE GUARD BYPASS] Reservation form dari ${phone} terdeteksi meski age ${ageSeconds}s (> ${maxAgeSeconds}s) — lanjut ke jalur capture (Siska #777).`);
            } else {
              console.log(`[STALE MESSAGE GUARD] Message ${waMessageId} from ${phone} is ${ageSeconds}s old (threshold: ${maxAgeSeconds}s). Fast-tracking to DB only and dropping auto-reply/side-effects.`);
              const staleCustomer = await customerService.getOrCreateCustomer(phone, contactName, DEFAULT_TENANT_ID);
              const staleConversation = await conversationService.getOrCreateConversation(staleCustomer.id, DEFAULT_TENANT_ID);
              await messageService.logMessage({
                tenantId: DEFAULT_TENANT_ID,
                conversationId: staleConversation.id,
                direction: 'INBOUND',
                content: inboundTextPreview,
                waMessageId,
                payloadRaw: payload,
                skipMqlEvaluation: true,
              });
              return reply.status(200).send({ status: 'IGNORED_STALE_MESSAGE' });
            }
          }
        }
      }

      const existingCustomer = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
      let labels: string[] | null = null;
      let isAdminChat = false;

      if (existingCustomer && existingCustomer.labels_synced_at !== null && existingCustomer.is_admin_labeled === true) {
        isAdminChat = true;
      } else if (!existingCustomer || existingCustomer.labels_synced_at === null) {
        labels = await wahaClient.getChatLabelsOrNull(chatId);
        if (labels !== null) {
          const isAdmin = labels.some(l => l.toLowerCase() === 'admin');
          const isHold = labels.some(l => l.toLowerCase() === 'hold');
          if (existingCustomer) {
            customerService.setLabelFlags(phone, { isAdminLabeled: isAdmin, isHoldLabeled: isHold }).catch(() => {});
          }
          if (isAdmin) {
            isAdminChat = true;
          }
        }
      }

      // --- MEDIA INBOUND (gambar customer) ---
      // Deteksi image, unduh file dari WAHA, simpan ke storage/media/inbound/<tenantId>,
      // dan lampirkan metadata media ke payload_raw agar bisa dirender di Live Chat
      // (blur + download). Konten teks bot tetap seperti sebelumnya agar state machine
      // & classifier TIDAK berubah. Best-effort: gagal unduh tidak menghentikan alur.
      const pAny = payload as any;
      const isInboundImage =
        pAny.type === 'image' ||
        !!(pAny.message && pAny.message.imageMessage) ||
        !!(pAny.hasMedia && pAny.media?.mimetype?.startsWith('image/'));
      const imageCaption = (pAny.message?.imageMessage?.caption) || pAny.caption || '';
      let inboundMedia: any = null;
      if (isInboundImage) {
        try {
          const { mediaService } = await import('../services/media.service');
          let buffer: Buffer | null = null;
          const mimeType = pAny.message?.imageMessage?.mimetype || pAny.media?.mimetype || 'image/jpeg';

          // 1. Coba download langsung dari pAny.media.url jika ada
          if (pAny.media?.url) {
            buffer = await wahaClient.fetchUrl(String(pAny.media.url));
          }

          // 2. Fallback ke wahaClient.downloadMedia
          if (!buffer || buffer.length === 0) {
            buffer = await wahaClient.downloadMedia(waMessageId, chatId);
          }

          // 3. Fallback ke base64 jpegThumbnail jika download gagal
          if ((!buffer || buffer.length === 0) && (pAny.message?.imageMessage?.jpegThumbnail || pAny._data?.jpegThumbnail)) {
            const thumbB64 = pAny.message?.imageMessage?.jpegThumbnail || pAny._data?.jpegThumbnail;
            buffer = Buffer.from(thumbB64, 'base64');
          }

          if (buffer && buffer.length > 0) {
            const saved = await mediaService.saveInboundMedia({ tenantId: DEFAULT_TENANT_ID, buffer, mimeType });
            inboundMedia = {
              url: saved.thumbUrl || saved.hdUrl,
              hdUrl: saved.hdUrl,
              thumbUrl: saved.thumbUrl,
              mimeType,
              caption: imageCaption || null,
            };
          } else if (pAny.media?.url) {
            // Minimal simpan URL yang sudah dinormalisasi menjadi relative path /api/files/...
            const rawUrl = String(pAny.media.url);
            const urlPath = rawUrl.replace(/^https?:\/\/[^/]+/, '');
            inboundMedia = {
              url: urlPath,
              hdUrl: urlPath,
              mimeType,
              caption: imageCaption || null,
            };
          } else {
            console.warn(`[WAHA MEDIA WARNING] Gagal mengunduh gambar dari WAHA untuk pesan ${waMessageId} (chat: ${chatId}) — buffer kosong / null.`);
          }
        } catch (mediaErr: any) {
          console.warn('[WAHA MEDIA] Gagal menyimpan media inbound:', mediaErr.message);
        }
      }

      // --- MEDIA BERAT (video/audio/document): unduh BACKGROUND fire-and-forget ---
      // Keputusan: image tetap sinkron (dipakai Live Chat), media berat TIDAK dirender
      // di Live Chat tapi tetap diarsipkan ke storage supaya tidak hilang. Webhook tidak
      // boleh diblok menunggu unduhan besar (latency ke WAHA) — jalankan tanpa await.
      const heavyMediaType =
        (payload.message?.videoMessage && 'video') ||
        (payload.message?.audioMessage && 'audio') ||
        (payload.message?.documentMessage && 'document') ||
        (payload.type === 'video' && 'video') ||
        (payload.type === 'audio' && 'audio') ||
        (payload.type === 'document' && 'document') ||
        null;
      if (heavyMediaType && !isInboundImage) {
        const heavyMime =
          payload.message?.videoMessage?.mimetype ||
          payload.message?.audioMessage?.mimetype ||
          payload.message?.documentMessage?.mimetype ||
          `application/${heavyMediaType}`;
        void (async () => {
          try {
            const { mediaService } = await import('../services/media.service');
            const buffer = await wahaClient.downloadMedia(waMessageId, chatId);
            if (buffer && buffer.length > 0) {
              await mediaService.saveInboundMedia({ tenantId: DEFAULT_TENANT_ID, buffer, mimeType: heavyMime });
              console.log(`[WAHA MEDIA] ${heavyMediaType} inbound ${waMessageId} arsip tersimpan (background).`);
            } else {
              console.warn(`[WAHA MEDIA WARNING] Buffer kosong untuk ${heavyMediaType} ${waMessageId}.`);
            }
          } catch (mediaErr: any) {
            console.warn(`[WAHA MEDIA] Gagal mengarsipkan ${heavyMediaType} inbound ${waMessageId} (background):`, mediaErr.message);
          }
        })();
      }
      const inboundContent = isInboundImage
        ? (imageCaption ? `[IMAGE: ${imageCaption}]` : '[MEDIA]')
        : (payload.body || '[LOCATION/MEDIA]');
      const mergeMediaIntoPayload = (p: any) => (inboundMedia ? { ...p, media: inboundMedia } : p);

      if (isAdminChat) {
        console.log(`[ADMIN CHAT] Chat ${chatId} is labeled as "Admin". Logging to Live Chat and bypassing bot auto-reply.`);
        const adminCustomer = await customerService.getOrCreateCustomer(phone, contactName, DEFAULT_TENANT_ID);
        const adminConversation = await conversationService.getOrCreateConversation(adminCustomer.id, DEFAULT_TENANT_ID);

        await messageService.logMessage({
          tenantId: DEFAULT_TENANT_ID,
          conversationId: adminConversation.id,
          direction: 'INBOUND',
          content: inboundContent,
          waMessageId,
          payloadRaw: mergeMediaIntoPayload(payload),
          skipMqlEvaluation: true,
        });

        if (!adminConversation.is_human_handling) {
          await conversationService.escalateToHumanHandling(
            adminConversation,
            phone,
            'Nomor berlabel Admin / Karyawan (Manual Handling)',
            DEFAULT_TENANT_ID,
            'admin_labeled'
          ).catch(() => {});
        }

        return reply.status(200).send({ status: 'IGNORED_ADMIN' });
      }

      // --- LEGACY PER-CONTACT SCRAPE TRIGGER (Task 2 / flag: ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER) ---
      // Posisi: SETELAH admin bypass, SEBELUM getOrCreateCustomer utama. Jika chat
      // berlabel 'legacy' dan customer belum pernah di-scrape, kita picu scraping
      // historis per-kontak dan return 200 TANPA masuk ke state machine.
      if (process.env.ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER === 'true') {
        // Ambil label dari WAHA hanya jika belum di-fetch di jalur admin bypass
        if (labels === null) {
          labels = await wahaClient.getChatLabels(chatId);
        }
        if (labels.some(l => l.toLowerCase() === 'legacy')) {
          if (existingCustomer && !existingCustomer.legacy_scraped_at) {
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

      // Simpan teks asli (lengkap dengan Promo[xx]) untuk Live Chat & DB audit trail
      incomingMessage.originalText = bodyText;
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
          // Siska #777 FIX: tetap coba capture reservasi meski dalam grace period — jangan silent-drop form.
          try {
            const raw = incomingMessage.text?.body || '';
            if (raw.trim()) {
              const { isReservationFormMessage: _isFormG, parseReservationText: _parseG } = await import('../utils/reservation-text-parser');
              if (_isFormG(raw)) {
                const pr = _parseG(raw);
                if (pr.success && pr.reservation) {
                  const p = pr.reservation;
                  const recent = await prisma.reservation.findFirst({ where: { customer_id: customer.id, tenant_id: DEFAULT_TENANT_ID, created_at: { gte: new Date(Date.now() - 24*60*60*1000) }, treatment_detail: p.treatmentDetail } });
                  if (!recent) {
                    const r = await prisma.reservation.create({ data: { tenant_id: DEFAULT_TENANT_ID, customer_id: customer.id, treatment_category: p.treatmentCategory, treatment_detail: p.treatmentDetail, booking_date: p.bookingDate, raw_text: raw, status: 'pending' } });
                    console.log(`[HUMAN GRACE AUTO-CAPTURE] Created reservation ${r.id} for ${customer.phone} (${p.name}) — bypass grace silent`);
                    const { reservationLifecycleService: _rlG } = await import('../services/reservation-lifecycle.service');
                    await _rlG.onReservationCreated({ customerId: customer.id, reservationId: r.id, tenantId: DEFAULT_TENANT_ID, chatId, babies: p.babies || [] });
                    try { const { fireCapiEvent: _fcG } = await import('../services/capi.service'); _fcG({ eventName: 'InitiateCheckout', customer, tenantId: DEFAULT_TENANT_ID, customData: { source: 'WEBHOOK_HUMAN_GRACE_CAPTURE', treatment: p.treatmentDetail } }); } catch {}
                  }
                }
              }
            }
          } catch (e: any) { console.warn('[HUMAN GRACE AUTO-CAPTURE ERROR]', e.message); }
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

        // If hold label feature is disabled (default disabled di produksi), do not check WAHA labels for release
        const enableHoldLabel = process.env.ENABLE_WAHA_HOLD_LABEL === 'true' || (process.env.NODE_ENV === 'test' && process.env.ENABLE_WAHA_HOLD_LABEL !== 'false');
        if (!enableHoldLabel) {
          console.log(`[LABEL SYNC DISABLED] Skipping WAHA label checks in production (UI-managed mode). Bot stays silent in HUMAN_HANDLING.`);
          // Siska #777 FIX: tetap coba capture reservasi meski label sync disabled — fallback inline sebelum silent return.
          try {
            const raw = incomingMessage.text?.body || '';
            if (raw.trim()) {
              const { isReservationFormMessage: _isFormL, parseReservationText: _parseL } = await import('../utils/reservation-text-parser');
              if (_isFormL(raw)) {
                const pr = _parseL(raw);
                if (pr.success && pr.reservation) {
                  const p = pr.reservation;
                  const recent = await prisma.reservation.findFirst({ where: { customer_id: customer.id, tenant_id: DEFAULT_TENANT_ID, created_at: { gte: new Date(Date.now() - 24*60*60*1000) }, treatment_detail: p.treatmentDetail } });
                  if (!recent) {
                    const r = await prisma.reservation.create({ data: { tenant_id: DEFAULT_TENANT_ID, customer_id: customer.id, treatment_category: p.treatmentCategory, treatment_detail: p.treatmentDetail, booking_date: p.bookingDate, raw_text: raw, status: 'pending' } });
                    console.log(`[HUMAN HOLD-DISABLED AUTO-CAPTURE] Created reservation ${r.id} for ${customer.phone} (${p.name})`);
                    const { reservationLifecycleService: _rlL } = await import('../services/reservation-lifecycle.service');
                    await _rlL.onReservationCreated({ customerId: customer.id, reservationId: r.id, tenantId: DEFAULT_TENANT_ID, chatId, babies: p.babies || [] });
                    try { const { fireCapiEvent: _fcL } = await import('../services/capi.service'); _fcL({ eventName: 'InitiateCheckout', customer, tenantId: DEFAULT_TENANT_ID, customData: { source: 'WEBHOOK_HOLD_DISABLED_CAPTURE', treatment: p.treatmentDetail } }); } catch {}
                  } else {
                    console.log(`[HUMAN HOLD-DISABLED CAPTURE SKIP] Duplicate reservation within 24h for ${customer.phone}`);
                  }
                } else {
                  console.warn(`[HUMAN HOLD-DISABLED PARSE FAIL] ${pr.error} missing=${pr.missingFields?.join(',')}`);
                }
              }
            }
          } catch (e: any) { console.warn('[HUMAN HOLD-DISABLED AUTO-CAPTURE ERROR]', e.message); }
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

        // Periksa apakah admin telah melepas label 'hold' di WhatsApp (hanya jika ENABLE_WAHA_HOLD_LABEL=true)
        // Fast path: baca Customer.is_hold_labeled dari DB (nol HTTP ke WAHA).
        // Fallback: kolom belum tersync (DB offline / customer baru) → tanya WAHA (cached).
        let hasHoldLabel = false;
        if (customer && customer.labels_synced_at !== null && typeof customer.is_hold_labeled === 'boolean') {
          hasHoldLabel = customer.is_hold_labeled;
        } else {
          if (labels === null) {
            labels = await wahaClient.getChatLabelsOrNull(chatId);
          }
          if (labels !== null) {
            hasHoldLabel = labels.some(l => l.toLowerCase() === 'hold');
            const isAdmin = labels.some(l => l.toLowerCase() === 'admin');
            customerService.setLabelFlags(phone, { isAdminLabeled: isAdmin, isHoldLabeled: hasHoldLabel }).catch(() => {});
          }
        }

        if (!hasHoldLabel && enableHoldLabel) {
          console.log(`[ADMIN RELEASE] Hold label removed by admin for chat ${chatId}. Auto-releasing from HUMAN_HANDLING.`);
          // Sinkronkan kolom flag (event label.chat.deleted bisa terlewat; safety-net tetap reconciliation)
          customerService.setLabelFlags(phone, { isHoldLabeled: false }).catch(() => {});
          const restoredState = conversation.previous_state || ConversationState.INITIAL;
          const updatedConv = await conversationService.updateConversationState(
            conversation.id,
            {
              currentState: restoredState,
              isHumanHandling: false,
              humanHandlingSince: null,
            },
            DEFAULT_TENANT_ID
          );
          if (updatedConv) {
            conversation = updatedConv;
          } else {
            conversation.is_human_handling = false;
            conversation.human_handling_since = null;
            conversation.current_state = restoredState;
          }
        } else {
          console.log(`[EXPLICIT GUARD CLAUSE] Conversation ${conversation.id} is in HUMAN_HANDLING mode. Logging inbound message and BYPASSING all LLM & auto-replies.`);
          // Siska #777 FIX: attempt capture sebelum silent return — form jangan hilang.
          try {
            const raw = incomingMessage.text?.body || '';
            if (raw.trim()) {
              const { isReservationFormMessage: _isFormE, parseReservationText: _parseE } = await import('../utils/reservation-text-parser');
              if (_isFormE(raw)) {
                const pr = _parseE(raw);
                if (pr.success && pr.reservation) {
                  const p = pr.reservation;
                  const recent = await prisma.reservation.findFirst({ where: { customer_id: customer.id, tenant_id: DEFAULT_TENANT_ID, created_at: { gte: new Date(Date.now() - 24*60*60*1000) }, treatment_detail: p.treatmentDetail } });
                  if (!recent) {
                    const r = await prisma.reservation.create({ data: { tenant_id: DEFAULT_TENANT_ID, customer_id: customer.id, treatment_category: p.treatmentCategory, treatment_detail: p.treatmentDetail, booking_date: p.bookingDate, raw_text: raw, status: 'pending' } });
                    console.log(`[HUMAN EXPLICIT AUTO-CAPTURE] Created reservation ${r.id} for ${customer.phone} (${p.name})`);
                    const { reservationLifecycleService: _rlE } = await import('../services/reservation-lifecycle.service');
                    await _rlE.onReservationCreated({ customerId: customer.id, reservationId: r.id, tenantId: DEFAULT_TENANT_ID, chatId, babies: p.babies || [] });
                    try { const { fireCapiEvent: _fcE } = await import('../services/capi.service'); _fcE({ eventName: 'InitiateCheckout', customer, tenantId: DEFAULT_TENANT_ID, customData: { source: 'WEBHOOK_HUMAN_EXPLICIT_CAPTURE', treatment: p.treatmentDetail } }); } catch {}
                  }
                }
              }
            }
          } catch (e: any) { console.warn('[HUMAN EXPLICIT AUTO-CAPTURE ERROR]', e.message); }

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
