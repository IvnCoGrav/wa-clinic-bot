import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyMetaSignature } from '../integrations/whatsapp/signature';
import { normalizeWabaPayload, normalizeWabaStatuses } from '../integrations/whatsapp/normalizer';
import { customerService } from '../services/customer.service';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { queueService } from '../services/queue.service';
import { burstCoalesceService } from '../services/burst-coalesce.service';
import { wabaTenantService } from '../services/waba-tenant.service';
import { enforceAiScopeGate } from '../services/ai-scope-gate.service';
import { matchAdClickAndFireContact } from '../services/ad-attribution.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { hasBypassLabel, checkCustomerBypass } from '../utils/customer-bypass';
import { contextStorage } from '../utils/context';
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

  fastify.post('/api/webhook/waba', {
    // SEC-AUDIT-13: kuota tinggi (bukan tanpa batas) untuk burst event Meta.
    config: { rateLimit: { max: 5000, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = crypto.randomUUID();
    return contextStorage.run({ correlationId }, async () => {

    let appSecret = process.env.WABA_APP_SECRET || '';
    if (!appSecret) {
      try {
        const body = request.body as any;
        const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
        if (phoneNumberId) {
          const tenantId = await wabaTenantService.resolveTenantByPhoneNumberId(phoneNumberId);
          if (tenantId) {
            const { prisma } = await import('../db/client');
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
            if (tenant?.waba_app_secret) {
              const { decryptSecret } = await import('../utils/encryption');
              try {
                appSecret = decryptSecret(tenant.waba_app_secret) || tenant.waba_app_secret;
              } catch {
                appSecret = tenant.waba_app_secret;
              }
            }
          }
        }
      } catch {}
    }

    const rawBody = (request as any).rawBody ?? Buffer.from(JSON.stringify(request.body));
    const signature = request.headers['x-hub-signature-256'] as string | undefined;

    const isStrict = process.env.NODE_ENV === 'production';
    if (!appSecret && isStrict) {
      console.warn(`[WABA SECURITY WARNING] Neither tenant waba_app_secret nor global WABA_APP_SECRET configured. Rejecting request in production mode (fail-closed). [${correlationId}]`);
    } else if (!appSecret) {
      console.warn(`[WABA SECURITY WARNING] Neither tenant waba_app_secret nor global WABA_APP_SECRET configured. Skipping HMAC signature validation (UNSECURE dev mode). [${correlationId}]`);
    }

    if (!verifyMetaSignature(rawBody, signature, appSecret, isStrict)) {
      console.warn(`[WABA SECURITY] Invalid HMAC signature from ${request.ip} [${correlationId}]`);
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const body = request.body as any;
    if (!body || body.object !== 'whatsapp_business_account') {
      return reply.status(200).send({ status: 'IGNORED' });
    }

    // --- STATUS WEBHOOKS (sent/delivered/read/failed) ---
    // Diproses lebih dulu; update status pesan by wa_message_id.
    // JANGAN return dini — satu body Meta bisa berisi statuses + messages bersamaan.
    const statuses = normalizeWabaStatuses(body);
    let processedStatuses = 0;
    if (statuses.length > 0) {
      for (const st of statuses) {
        const tenantId = await wabaTenantService.resolveTenantByPhoneNumberId(st.phoneNumberId);
        const errCode = st.errors?.[0]?.code ? String(st.errors[0].code) : null;
        const errDesc = st.errors?.map((e: any) => e?.error_data?.details || e?.title || e?.message).filter(Boolean).join(' | ') || null;
        const pricingCategory = (st as any).pricing?.category || (st as any).pricing_category || null;

        await messageService.updateDeliveryStatus(
          st.messageId,
          tenantId,
          st.status,
          st.timestamp,
          errCode,
          errDesc,
          pricingCategory
        );
        if (st.status === 'failed') {
          console.warn(`[WABA STATUS] Pesan ${st.messageId} gagal dikirim (tenant=${tenantId}, code=${errCode}): ${errDesc || 'unknown'}`);
          try {
            const { alertService, AlertType, AlertSeverity } = await import('../services/alert.service');
            await alertService.notifyAlert({
              type: AlertType.WABA_MESSAGE_FAILED,
              severity: AlertSeverity.CRITICAL,
              message: `[WABA TEMPLATE FAILED] Pesan ${st.messageId} gagal dikirim (tenant=${tenantId}, code=${errCode}).`,
              metadata: { tenantId, messageId: st.messageId, errors: st.errors, errorCode: errCode },
            });
          } catch (alertErr) {
            console.error('[WABA STATUS] Gagal kirim alert failed:', (alertErr as Error).message);
          }
        }
        processedStatuses++;
      }
    }

    const normalizedMessages = normalizeWabaPayload(body, DEFAULT_TENANT_ID);
    if (normalizedMessages.length === 0) {
      if (processedStatuses > 0) {
        return reply.status(200).send({ status: 'STATUS_PROCESSED', count: processedStatuses });
      }
      return reply.status(200).send({ status: 'NO_MESSAGES' });
    }

    let processed = 0;
    for (const msg of normalizedMessages) {
      // Tenant resolution per phone_number_id dari payload (multi-tenant WABA)
      const tenantId = await wabaTenantService.resolveTenantByPhoneNumberId(msg.phoneNumberId);

      // --- EVENT REACTION DARI CUSTOMER (WABA Message Reaction) ---
      if (msg.type === 'reaction') {
        const rawReaction = (msg.rawPayload as any)?.reaction;
        const targetMessageId = rawReaction?.message_id;
        const emoji = rawReaction?.emoji || msg.text || '';
        if (targetMessageId) {
          console.log(`[WABA REACTION WEBHOOK] targetMsgId=${targetMessageId}, emoji="${emoji}", from=${msg.fromNumber}`);
          await messageService.addOrUpdateReaction(targetMessageId, tenantId, {
            emoji,
            fromMe: false,
            senderName: msg.contactName,
            actorId: msg.fromNumber,
          });
        }
        processed++;
        continue;
      }

      const isDuplicate = await messageService.isDuplicateMessage(msg.messageId, tenantId);
      if (isDuplicate) {
        console.log(`[WABA IDEMPOTENCY SKIP] ${msg.messageId} already processed [${correlationId}]`);
        continue;
      }

      // Best-effort: resolve URL media WABA (image) & simpan ke storage/media/inbound SEBELUM stale guard
      // supaya image stale tetap punya media di LiveChat
      let mediaUrl: string | undefined;
      let msgMedia: any = undefined;
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
        if (mediaUrl) {
          try {
            const axios = (await import('axios')).default;
            const response = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 15000 });
            const { mediaService } = await import('../services/media.service');
            const saved = await mediaService.saveInboundMedia({
              tenantId,
              buffer: Buffer.from(response.data),
              mimeType: msg.mimeType || 'image/jpeg',
            });
            msgMedia = {
              url: saved.thumbUrl || saved.hdUrl,
              hdUrl: saved.hdUrl,
              thumbUrl: saved.thumbUrl,
              mimeType: msg.mimeType || 'image/jpeg',
              caption: msg.caption || null,
            };
          } catch (mediaErr: any) {
            console.warn(`[WABA MEDIA] Gagal menyimpan media ${msg.mediaId}:`, mediaErr.message);
          }
        }
      }
      const mergeWabaMedia = (raw: any) => {
        const res = { ...raw };
        if (msg.location) {
          res.location = msg.location;
        }
        if (msgMedia) {
          res.media = msgMedia;
        }
        return res;
      };

      const wabaCanonicalContent =
        (msg as any).originalText ||
        msg.text ||
        (msg.location ? `[LOCATION: Lat ${msg.location.latitude}, Lng ${msg.location.longitude}${msg.location.address ? ` | ${msg.location.address}` : ''}]` : undefined) ||
        (msg.type === 'voice_note' ? '[VOICE_NOTE]' : undefined) ||
        (msg.type === 'audio' ? '[AUDIO]' : undefined) ||
        (msg.type === 'document' ? `[DOCUMENT: ${msg.caption || 'Dokumen'}]` : undefined) ||
        (msg.type === 'video' ? (msg.caption ? `[VIDEO: ${msg.caption}]` : '[VIDEO]') : undefined) ||
        (msg.type === 'sticker' ? '[STICKER]' : undefined) ||
        (msg.type === 'contact' ? `[CONTACT: ${msg.text || 'Kontak'}]` : undefined) ||
        (msg.caption ? `[IMAGE: ${msg.caption}]` : '[IMAGE]');

      // --- FAST-PATH GUARD: STALE / CATCH-UP MESSAGE FOR WABA ---
      const maxAgeSeconds = parseInt(process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS || '300', 10);
      if (maxAgeSeconds > 0 && msg.timestamp) {
        const rawTs = Number(msg.timestamp);
        if (!isNaN(rawTs) && rawTs > 0) {
          const msgTimeMs = rawTs > 10000000000 ? rawTs : rawTs * 1000;
          const ageSeconds = Math.floor((Date.now() - msgTimeMs) / 1000);
          if (ageSeconds > maxAgeSeconds) {
            console.log(`[WABA STALE MESSAGE GUARD] Message ${msg.messageId} from ${msg.fromNumber} is ${ageSeconds}s old (threshold: ${maxAgeSeconds}s). Fast-tracking to DB only and dropping auto-reply/CAPI.`);
            const staleCustomer = await customerService.getOrCreateCustomer(
              msg.fromNumber,
              msg.contactName,
              tenantId
            );
            const staleConversation = await conversationService.getOrCreateConversation(staleCustomer.id, tenantId);
            await messageService.logMessage({
              tenantId,
              conversationId: staleConversation.id,
              direction: 'INBOUND',
              content: wabaCanonicalContent,
              waMessageId: msg.messageId,
              payloadRaw: mergeWabaMedia(msg.rawPayload),
              isHistorical: true,
            });
            processed++;
            continue;
          }
        }
      }

      const existingCustomer = await customerService.getCustomerByPhone(msg.fromNumber, tenantId);
      const isNewCustomerRecord = !existingCustomer;

      const isBypass =
        existingCustomer?.is_admin_labeled === true ||
        hasBypassLabel(existingCustomer) ||
        (await checkCustomerBypass({ customerId: existingCustomer?.id, phone: msg.fromNumber, tenantId }));

      if (isBypass) {
        console.log(`[WABA BYPASS] Contact ${msg.fromNumber} has bypass/admin label (Skip / Admin CS). Dropping bot auto-reply.`);
        const bypassCustomer = await customerService.getOrCreateCustomer(
          msg.fromNumber,
          msg.contactName,
          tenantId,
          { skipFollowUpScheduling: true }
        );
        const bypassConversation = await conversationService.getOrCreateConversation(bypassCustomer.id, tenantId);
        await messageService.logMessage({
          tenantId,
          conversationId: bypassConversation.id,
          direction: 'INBOUND',
          content: wabaCanonicalContent,
          waMessageId: msg.messageId,
          payloadRaw: mergeWabaMedia(msg.rawPayload),
          skipMqlEvaluation: true,
        });
        if (!bypassConversation.is_human_handling) {
          await conversationService.escalateToHumanHandling(
            bypassConversation,
            msg.fromNumber,
            'Nomor berlabel Skip / Admin CS (Manual Handling)',
            tenantId,
            'admin_labeled'
          ).catch(() => {});
        }
        continue;
      }

      const customer = await customerService.getOrCreateCustomer(
        msg.fromNumber,
        msg.contactName,
        tenantId
      );

      // --- ATTRIBUTION CHECK & CAPI CONTACT (SHARED SERVICE) ---
      const attributionResult = await matchAdClickAndFireContact({
        bodyText: msg.text || '',
        isNewCustomerRecord,
        customer,
        tenantId,
        referral: msg.referral,
      });

      if (attributionResult.strippedText && msg.text) {
        (msg as any).originalText = msg.text;
        msg.text = attributionResult.strippedText;
      }

      if (customer.status === 'blocked') {
        const blockedConversation = await conversationService.getOrCreateConversation(customer.id, tenantId);
        await messageService.logMessage({
          tenantId,
          conversationId: blockedConversation.id,
          direction: 'INBOUND',
          content: wabaCanonicalContent,
          waMessageId: msg.messageId,
          payloadRaw: mergeWabaMedia(msg.rawPayload),
        });
        continue;
      }

      const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);

      // P0-5: abuse-detection simetris WABA (sebelumnya hanya WAHA)
      try {
        const { abuseDetectionService } = await import('../services/abuse-detection.service');
        const abuseRes = await abuseDetectionService.checkAndProcessAbuse(customer, conversation, msg.text || '', tenantId);
        if (abuseRes?.blocked) {
          console.warn(`[WABA ABUSE] Blocked ${msg.fromNumber} tenant ${tenantId}: ${abuseRes.reason}`);
          continue;
        }
      } catch {}

      // --- AI ROLLOUT SCOPE GATE (Task: AI hanya untuk customer baru) ---
      const scopeGate = await enforceAiScopeGate({
        customer,
        conversation,
        tenantId,
        content: wabaCanonicalContent,
        waMessageId: msg.messageId,
        payloadRaw: mergeWabaMedia(msg.rawPayload),
      });
      if (scopeGate.action === 'silence') {
        continue;
      }

      // --- PURCHASE EVENT DETECTION FOR WABA (sebelum state machine / human handling) ---
      if (msg.type === 'text' && msg.text) {
        try {
          const { maybeFirePurchaseEvent } = await import('../services/purchase-detection.service');
          await maybeFirePurchaseEvent({
            customer,
            conversation,
            text: msg.text,
            tenantId,
          });
        } catch (purchaseErr) {
          console.warn('[CAPI] WABA Purchase detection error:', (purchaseErr as Error).message);
        }
      }

      const incomingMessage: any = {
        id: msg.messageId,
        from: msg.fromNumber,
        chatId: msg.fromNumber,
        timestamp: String(msg.timestamp),
        type: msg.type,
        text: msg.text ? { body: msg.text } : undefined,
        originalText: (msg as any).originalText || msg.text,
        location: msg.location
          ? { latitude: msg.location.latitude, longitude: msg.location.longitude }
          : undefined,
        _data: { notifyName: msg.contactName },
        _provider: 'WABA',
        _normalized: msg,
        _mediaUrl: mediaUrl,
        media: msgMedia,
      };

      // BURST COALESCING: jika aktif (BURST_COALESCE_MS>0) dan pesan text di state
      // open-ended, pesan di-buffer lalu di-merge jadi 1 balasan (handled=true).
      const coalesceResult = await burstCoalesceService.maybeCoalesce({
        tenantId,
        customerId: customer.id,
        phone: customer.phone,
        conversation,
        incomingMessage,
      });

      if (!coalesceResult.handled) {
        // Stage 5 Fase 2: persist turn inbound (RECEIVED) sebelum enqueue.
        try {
          const { turnRepository } = await import('../repositories/turn.repository');
          await turnRepository.persistInbound({
            tenantId,
            provider: 'WABA',
            inboundMessageId: msg.messageId,
            customerId: customer.id,
            conversationId: conversation.id,
            payload: { tenantId, customerId: customer.id, phone: customer.phone, incomingMessage },
          });
        } catch {}

        await queueService.enqueueMessage({
          tenantId,
          customerId: customer.id,
          phone: customer.phone,
          incomingMessage,
          correlationId,
          turnId: `${tenantId}:WABA:${msg.messageId}`,
          provider: 'WABA',
          inboundMessageId: msg.messageId,
        });
      }
      processed++;
    }

    if (processedStatuses > 0 && processed === 0) {
      return reply.status(200).send({ status: 'STATUS_PROCESSED', count: processedStatuses });
    }
    if (processedStatuses > 0) {
      return reply.status(200).send({ status: 'PROCESSED', count: processed, statuses: processedStatuses });
    }
    return reply.status(200).send({ status: 'PROCESSED', count: processed });
    });
  });
}
