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
    const statuses = normalizeWabaStatuses(body);
    if (statuses.length > 0) {
      let processedStatuses = 0;
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

      const existingCustomer = await customerService.getCustomerByPhone(msg.fromNumber, tenantId);
      const isNewCustomerRecord = !existingCustomer;

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
        msg.text = attributionResult.strippedText;
      }

      // Best-effort: resolve URL media WABA (image) & simpan ke storage/media/inbound
      // agar bisa dirender di Live Chat (blur + download). Gagal tidak menghalangi alur.
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

      let msgMedia: any = undefined;
      if (msg.type === 'image' && mediaUrl) {
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
      const mergeMediaIntoRaw = (raw: any) => (msgMedia ? { ...raw, media: msgMedia } : raw);

      if (customer.status === 'blocked') {
const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);

      // --- AI ROLLOUT SCOPE GATE (Task: AI hanya untuk customer baru) ---
      // Konsisten dgn webhook WAHA. Legacy customer non-AI di-senyapkan (human
      // handling + escalation khusus) sebelum masuk queue / state machine.
      const scopeGate = await enforceAiScopeGate({
        customer,
        conversation,
        tenantId,
        content: msg.text || (msg.caption ? `[IMAGE: ${msg.caption}]` : '[MEDIA]'),
        waMessageId: msg.messageId,
        payloadRaw: mergeMediaIntoRaw(msg.rawPayload),
      });
      if (scopeGate.action === 'silence') {
        continue;
      }
        await messageService.logMessage({
          tenantId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          content: msg.text || (msg.caption ? `[IMAGE: ${msg.caption}]` : '[MEDIA]'),
          waMessageId: msg.messageId,
          payloadRaw: mergeMediaIntoRaw(msg.rawPayload),
        });
        continue;
      }

      const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);

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
        await queueService.enqueueMessage({
          tenantId,
          customerId: customer.id,
          phone: customer.phone,
          incomingMessage,
        });
      }
      processed++;
    }

    return reply.status(200).send({ status: 'PROCESSED', count: processed });
  });
}
