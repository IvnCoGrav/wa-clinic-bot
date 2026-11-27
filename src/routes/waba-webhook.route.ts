import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyMetaSignature } from '../integrations/whatsapp/signature';
import { MAX_INBOUND_DOCUMENT_BYTES } from '../utils/media-limits';
import { normalizeWabaPayload, normalizeWabaStatuses, buildWabaCanonicalContent } from '../integrations/whatsapp/normalizer';
import { customerService } from '../services/customer.service';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { queueService } from '../services/queue.service';
import { burstCoalesceService } from '../services/burst-coalesce.service';
import { wabaTenantService } from '../services/waba-tenant.service';
import { wabaOptOutService } from '../services/waba-optout.service';
import { inboundEventDedup } from '../services/inbound-event-dedup.service';
import { enforceAiScopeGate } from '../services/ai-scope-gate.service';
import { matchAdClickAndFireContact } from '../services/ad-attribution.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import {
  classifyStaleInbound,
  logInboundWithoutReply,
  resolveInboundBypass,
  resolveMaxInboundAgeSeconds,
} from '../services/ingress/inbound-guard.service';
import { contextStorage } from '../utils/context';
import { maskPhoneNumber } from '../utils/pii-masker';
import type { NormalizedQuotedMessage } from '../utils/canonical-message-normalizer';
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

    const body = request.body as any;
    const phoneNumberIds = new Set<string>();
    for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const id = change?.value?.metadata?.phone_number_id;
        if (id) phoneNumberIds.add(String(id));
      }
    }

    let appSecret = process.env.WABA_APP_SECRET || '';
    if (!appSecret) {
      // Mode app-secret per tenant: satu signature HMAC hanya bisa memverifikasi
      // SATU app secret. Payload dengan lebih dari satu phone_number_id tidak
      // boleh diproses (entry tenant lain akan lolos tanpa otorisasi).
      if (phoneNumberIds.size > 1) {
        console.warn(
          `[WABA SECURITY] Payload memuat ${phoneNumberIds.size} phone_number_id pada mode app-secret per tenant — DITOLAK. [${correlationId}]`
        );
        return reply.status(400).send({ error: 'Multi-tenant payload rejected' });
      }
      const phoneNumberId = Array.from(phoneNumberIds)[0];
      try {
        if (phoneNumberId) {
          appSecret = await wabaTenantService.resolveAppSecretByPhoneNumberId(phoneNumberId);
        }
      } catch {}
    }

    const rawBody = (request as any).rawBody ?? Buffer.from(JSON.stringify(request.body));
    const signature = request.headers['x-hub-signature-256'] as string | undefined;

    // Ar-008: strictness TIDAK bergantung pada string NODE_ENV. Webhook tanpa
    // secret hanya boleh lolos bila diizinkan eksplisit untuk dev lokal.
    const allowUnsigned = String(process.env.WABA_ALLOW_UNSIGNED_WEBHOOK || '').toLowerCase() === 'true';
    const isStrict = Boolean(appSecret) || !allowUnsigned;
    if (!appSecret && isStrict) {
      console.warn(`[WABA SECURITY] Secret tidak dikonfigurasi dan unsigned webhook tidak diizinkan — DITOLAK (fail-closed). [${correlationId}]`);
    } else if (!appSecret) {
      console.warn(`[WABA SECURITY WARNING] Unsigned webhook diizinkan eksplisit (dev). [${correlationId}]`);
    }

    if (!verifyMetaSignature(rawBody, signature, appSecret, isStrict)) {
      console.warn(`[WABA SECURITY] Invalid HMAC signature from ${request.ip} [${correlationId}]`);
      return reply.status(401).send({ error: 'Invalid signature' });
    }

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
        // M02-10: status untuk phone_number_id tak dikenal TIDAK boleh melempar
        // 500 — respons 5xx memicu Meta mengulang seluruh batch dan status lain
        // ikut hilang. Abaikan status itu (200) lalu lanjut ke status berikutnya.
        let tenantId: string;
        try {
          tenantId = await wabaTenantService.resolveTenantByPhoneNumberId(st.phoneNumberId);
        } catch (err: any) {
          if (err?.message === 'UNKNOWN_PHONE_NUMBER_ID') {
            console.warn(
              `[WABA STATUS] phone_number_id=${st.phoneNumberId || '(kosong)'} tidak terdaftar → status ${st.messageId} diabaikan (200).`
            );
            continue;
          }
          throw err;
        }
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
      let tenantId: string;
      try {
        tenantId = await wabaTenantService.resolveTenantByPhoneNumberId(msg.phoneNumberId);
      } catch (err: any) {
        if (err.message === 'UNKNOWN_PHONE_NUMBER_ID') {
          console.warn(`[WABA TENANT] phone_number_id=${msg.phoneNumberId} tidak terdaftar → webhook DITOLAK (fail-closed).`);
          return reply.status(200).send({ status: 'UNKNOWN_TENANT_REJECTED' });
        }
        throw err;
      }


      // --- EVENT REACTION DARI CUSTOMER (WABA Message Reaction) ---
      if (msg.type === 'reaction') {
        const rawReaction = (msg.rawPayload as any)?.reaction;
        const targetMessageId = rawReaction?.message_id;
        const emoji = rawReaction?.emoji || msg.text || '';
        if (targetMessageId) {
          // M02-11: Meta mengulang webhook yang sama; klaim SEBELUM mutasi.
          const reactionKey = `waba:reaction:${tenantId}:${msg.messageId}`;
          const firstDelivery = await inboundEventDedup.claimOnce(reactionKey);
          if (!firstDelivery) {
            console.log(`[WABA REACTION WEBHOOK] duplikat diabaikan (${msg.messageId}).`);
            return reply.status(200).send({ status: 'REACTION_DUPLICATE' });
          }
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

      // Best-effort: resolve URL media WABA (image, audio, doc, etc.) & simpan ke storage/media/inbound SEBELUM stale guard
      // supaya media stale tetap punya media di LiveChat (W-007)
      let mediaUrl: string | undefined;
      let msgMedia: any = undefined;
      const SUPPORTED_WABA_MEDIA_TYPES = ['image', 'audio', 'voice_note', 'video', 'document', 'sticker'];
      if (SUPPORTED_WABA_MEDIA_TYPES.includes(msg.type) && msg.mediaId) {
        let decryptedToken: string | undefined;
        try {
          const { prisma } = await import('../db/client');
          const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
          if (tenant?.waba_access_token) {
            const { decryptSecret } = await import('../utils/encryption');
            const { resolveWabaMediaUrl } = await import('../integrations/whatsapp/media');
            decryptedToken = decryptSecret(tenant.waba_access_token);
            const resolved = await resolveWabaMediaUrl(msg.mediaId, decryptedToken);
            mediaUrl = resolved?.url;
            if (resolved?.mimeType && !msg.mimeType) {
              msg.mimeType = resolved.mimeType;
            }
          }
        } catch (mediaErr) {
          console.warn(`[WABA MEDIA] Gagal resolve URL media ${msg.mediaId}:`, (mediaErr as Error).message);
        }
        if (mediaUrl) {
          try {
            const axios = (await import('axios')).default;
            const headers: Record<string, string> = {
              'User-Agent': 'WhatsApp-Bot-Media/1.0',
            };
            if (decryptedToken) {
              headers['Authorization'] = `Bearer ${decryptedToken}`;
            }
            const response = await axios.get(mediaUrl, {
              responseType: 'arraybuffer',
              timeout: 15000,
              maxContentLength: MAX_INBOUND_DOCUMENT_BYTES,
              maxBodyLength: MAX_INBOUND_DOCUMENT_BYTES,
              headers,
            });
            const { mediaService } = await import('../services/media.service');
            const effectiveMime = msg.mimeType || (msg.type === 'image' ? 'image/jpeg' : (msg.type === 'voice_note' || msg.type === 'audio' ? 'audio/ogg' : 'application/octet-stream'));
            const saved = await mediaService.saveInboundMedia({
              tenantId,
              buffer: Buffer.from(response.data),
              mimeType: effectiveMime,
            });
            msgMedia = {
              url: saved.thumbUrl || saved.hdUrl,
              hdUrl: saved.hdUrl,
              thumbUrl: saved.thumbUrl,
              mimeType: effectiveMime,
              caption: msg.caption || null,
            };
          } catch (mediaErr: any) {
            console.warn(`[WABA MEDIA] Gagal menyimpan media ${msg.mediaId}:`, mediaErr.message);
          }
        }
      }
      const quoted = await (async (): Promise<NormalizedQuotedMessage | undefined> => {
        const contextId = (msg.rawPayload as any)?.context?.id;
        if (!contextId) return undefined;
        try {
          const original = await messageService.getMessageById(contextId, tenantId);
          if (!original?.content) return undefined; // fail-open
          return {
            id: original.id,
            wa_message_id: original.wa_message_id || contextId,
            direction: original.direction,
            sender_type: original.sender_type,
            sender_name: original.sender_name,
            content: original.content,
            media: (original as any).payload_raw?.media || undefined,
          };
        } catch {
          return undefined; // DB lambat/offline: quote dilewati, pesan tetap masuk
        }
      })();

      const mergeWabaMedia = (raw: any) => {
        const res = { ...raw };
        if (msg.location) {
          res.location = msg.location;
        }
        if (msgMedia) {
          res.media = msgMedia;
        }
        if (quoted) {
          res.quoted_message = quoted;
        }
        return res;
      };

      const wabaCanonicalContent = buildWabaCanonicalContent(msg as any);

      const existingCustomer = await customerService.getCustomerByPhone(msg.fromNumber, tenantId);
      const isNewCustomerRecord = !existingCustomer;

      // --- PRIORITAS OPT-OUT MARKETING (M02-12) ---
      // Dievaluasi SEBELUM early-return apa pun (stale, bypass, blocked, abuse,
      // scope-gate silence, HUMAN_HANDLING). Tanpa choke point ini, STOP dari
      // pelanggan lama yang di-silence atau pesan catch-up tidak pernah sampai ke
      // state machine — pelanggan tetap menerima promo meski sudah minta berhenti.
      if (msg.text && wabaOptOutService.isOptOutMessage(msg.text).matched) {
        try {
          const optCustomer =
            existingCustomer ||
            (await customerService.getOrCreateCustomer(msg.fromNumber, msg.contactName, tenantId, {
              skipFollowUpScheduling: true,
            }));
          const optConversation = await conversationService.getOrCreateConversation(optCustomer.id, tenantId);
          const optRes = await wabaOptOutService.handleOptOut(optCustomer.id, tenantId);
          console.log(
            `[WABA OPT-OUT] Customer ${maskPhoneNumber(msg.fromNumber)} opt-out (tenant=${tenantId}); follow-up dibatalkan: ${optRes.cancelledFollowUps}.`
          );
          await logInboundWithoutReply({
            tenantId,
            phone: msg.fromNumber,
            contactName: msg.contactName,
            customer: optCustomer,
            conversation: optConversation,
            content: wabaCanonicalContent,
            waMessageId: msg.messageId,
            payloadRaw: mergeWabaMedia(msg.rawPayload),
            skipMqlEvaluation: true,
          });
          // Ack transaksional hanya bila bukan sesi CS manusia (jangan menyela admin).
          if (!optConversation.is_human_handling) {
            await wabaOptOutService.sendOptOutAck(optCustomer, optConversation.id, tenantId);
          }
          processed++;
        } catch (optErr: any) {
          console.warn('[WABA OPT-OUT] Gagal memproses opt-out:', optErr?.message || optErr);
        }
        continue;
      }

      // --- FAST-PATH GUARD: STALE / CATCH-UP MESSAGE FOR WABA ---
      // ING-10: keputusan basi dipusatkan di `inbound-guard.service` (seam bersama WAHA).
      const maxAgeSeconds = resolveMaxInboundAgeSeconds();
      const staleDecision = classifyStaleInbound({
        timestamp: msg.timestamp,
        maxAgeSeconds,
        isGpsShare: Boolean(msg.location),
      });
      if (staleDecision.stale) {
        if (staleDecision.action === 'proceed') {
          // Mirip [STALE GUARD BYPASS] di webhook WAHA: sinyal GPS shareloc
          // tidak boleh hilang karenakan timestamp telat — jatuh ke choke
          // point ingest GPS di bawah (KNOWN_ISSUES #138).
          console.log(`[WABA STALE GUARD BYPASS] GPS Shareloc dari ${msg.fromNumber} terdeteksi meski age ${staleDecision.ageSeconds}s (> ${maxAgeSeconds}s) — lanjut ke ingest GPS choke point.`);
        } else {
          console.log(`[WABA STALE MESSAGE GUARD] Message ${msg.messageId} from ${msg.fromNumber} is ${staleDecision.ageSeconds}s old (threshold: ${maxAgeSeconds}s). Fast-tracking to DB only and dropping auto-reply/CAPI.`);
          await logInboundWithoutReply({
            tenantId,
            phone: msg.fromNumber,
            contactName: msg.contactName,
            content: wabaCanonicalContent,
            waMessageId: msg.messageId,
            payloadRaw: mergeWabaMedia(msg.rawPayload),
            isHistorical: true,
          });
          processed++;
          continue;
        }
      }

      // M02-13: notifikasi sistem WhatsApp / pesan yang tidak didukung gateway
      // BUKAN pesan customer. Catat untuk audit trail, tapi JANGAN diantrekan ke
      // bot (mencegah AI membalas "Nomor pelanggan berubah" sebagai pertanyaan).
      if (msg.type === 'system' || msg.type === 'unsupported') {
        await logInboundWithoutReply({
          tenantId,
          phone: msg.fromNumber,
          contactName: msg.contactName,
          content: wabaCanonicalContent,
          waMessageId: msg.messageId,
          payloadRaw: mergeWabaMedia(msg.rawPayload),
          skipMqlEvaluation: true,
        });
        processed++;
        continue;
      }

      // ING-10: bypass admin/Skip memakai seam bersama WAHA.
      const isBypass = await resolveInboundBypass({
        customer: existingCustomer,
        phone: msg.fromNumber,
        tenantId,
      });

      // --- CHOKE POINT GPS PIN TUNGGAL (mirror WAHA — KNOWN_ISSUES #138) ---
      // WABA sebelumnya TIDAK punya sinkron GPS sama sekali: bypass, blocked,
      // abuse, scope-gate silence, dan jalur normal queue semuanya membuang
      // koordinat begitu saja. Ingest di sini berlaku untuk SEMUA return path
      // di bawah — kontrak tunggal location-ingest.service (idempoten + audit
      // LOCATION_INGEST_FAILED saat kegagalan tulis).
      if (msg.location) {
        try {
          const { locationIngestService, buildPinIncomingMessage } = await import('../services/location-ingest.service');
          const ingestCustomer =
            existingCustomer ||
            (await customerService.getOrCreateCustomer(msg.fromNumber, msg.contactName, tenantId, {
              skipFollowUpScheduling: isBypass,
            }));
          const gpsResult = await locationIngestService.ingestGpsPin({
            customer: ingestCustomer,
            incomingMessage: buildPinIncomingMessage({ latitude: msg.location.latitude, longitude: msg.location.longitude, address: msg.location.address, name: msg.location.name }),
            tenantId,
          });
          if (gpsResult.status !== 'skipped') {
            console.log(`[LOCATION INGEST] WABA choke point ${gpsResult.status}: ${gpsResult.reason} (${msg.fromNumber})`);
          }
        } catch (ingestErr: any) {
          console.warn('[LOCATION INGEST] WABA choke point error:', ingestErr?.message || ingestErr);
        }
      }

      if (isBypass) {
        console.log(`[WABA BYPASS] Contact ${msg.fromNumber} has bypass/admin label (Skip / Admin CS). Dropping bot auto-reply.`);
        const bypassCustomer = await customerService.getOrCreateCustomer(
          msg.fromNumber,
          msg.contactName,
          tenantId,
          { skipFollowUpScheduling: true }
        );
        const bypassConversation = await conversationService.getOrCreateConversation(bypassCustomer.id, tenantId);
        await logInboundWithoutReply({
          tenantId,
          phone: msg.fromNumber,
          contactName: msg.contactName,
          customer: bypassCustomer,
          conversation: bypassConversation,
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

      // Conversation dibuat lebih awal agar state idle (last_customer_message_at)
      // dapat dipakai guard fuzzy CTWA catcher pada atribusi di bawah.
      let conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);
      // Paritas WAHA (webhook.route.ts): catat chat MASUK customer agar gerbang AI-scope
      // mengukur idle dari chat customer (bukan aktivitas bot/outbound).
      conversationService.updateLastCustomerMessageAt(conversation.id, tenantId).catch(() => {});

      // --- ATTRIBUTION CHECK & CAPI CONTACT (SHARED SERVICE) ---
      const attributionResult = await matchAdClickAndFireContact({
        bodyText: msg.text || '',
        isNewCustomerRecord,
        customer,
        tenantId,
        referral: msg.referral,
        lastCustomerMessageAt: conversation.last_customer_message_at ?? conversation.last_message_at ?? null,
      });

      if (attributionResult.strippedText && msg.text) {
        (msg as any).originalText = msg.text;
        msg.text = attributionResult.strippedText;
      }

      if (customer.status === 'blocked') {
        await logInboundWithoutReply({
          tenantId,
          phone: msg.fromNumber,
          contactName: msg.contactName,
          customer,
          conversation,
          content: wabaCanonicalContent,
          waMessageId: msg.messageId,
          payloadRaw: mergeWabaMedia(msg.rawPayload),
        });
        continue;
      }

      // P0-5: abuse-detection simetris WABA (sebelumnya hanya WAHA)
      try {
        const { abuseDetectionService } = await import('../services/abuse-detection.service');
        const abuseRes = await abuseDetectionService.checkAndProcessAbuse(customer, conversation, msg.text || '', tenantId);
        if (abuseRes?.blocked) {
          console.warn(`[WABA ABUSE] Blocked ${msg.fromNumber} tenant ${tenantId}: ${abuseRes.reason}`);
          continue;
        }
      } catch {}

      // --- AUTO-RELEASE SEWA (paritas WAHA): bersihkan sewa CS yang kedaluwarsa
      // SEBELUM scope gate, agar gate menilai state riil (pasien lama tetap
      // dikunci permanen; jadwal aktif menunggu 48 jam). ---
      conversation = conversationService.checkAndApplyAutoRelease(conversation, tenantId).updatedConversation;

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

      // F4.4: gerbang diam eksplisit (paritas WAHA) — percakapan yang sedang
      // dipegang manusia TIDAK diantrekan ke bot. Sebelumnya WABA baru dibuang
      // di worker (boros + tak tercatat). Cukup log + enrichment, status sama
      // dengan jalur WAHA (`HUMAN_HANDLING_ACTIVE_SILENT`).
      if (conversation.is_human_handling) {
        try {
          const { humanBackgroundEnrichmentService } = await import('../services/human-background-enrichment.service');
          humanBackgroundEnrichmentService.enrichAsync(
            { customer, conversation, incomingMessage: { type: msg.type, text: msg.text ? { body: msg.text } : undefined, location: msg.location }, history: [] } as any,
            tenantId
          );
        } catch {}
        await logInboundWithoutReply({
          tenantId,
          phone: msg.fromNumber,
          contactName: msg.contactName,
          customer,
          conversation,
          content: wabaCanonicalContent,
          waMessageId: msg.messageId,
          payloadRaw: mergeWabaMedia(msg.rawPayload),
        });
        processed++;
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
        buttonPayload: (msg as any).buttonPayload,
        originalText: (msg as any).originalText || msg.text,
        location: msg.location
          ? { latitude: msg.location.latitude, longitude: msg.location.longitude }
          : undefined,
        _data: { notifyName: msg.contactName },
        _provider: 'WABA',
        _normalized: msg,
        _mediaUrl: mediaUrl,
        media: msgMedia,
        quoted,
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

        // W-005: Klaim messageId ke memory hanya setelah persist + enqueue berhasil
        messageService.claimMessageId(msg.messageId, tenantId);
      } else {
        // W-005: Pesan masuk burst buffer (handled=true), klaim messageId
        messageService.claimMessageId(msg.messageId, tenantId);
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
