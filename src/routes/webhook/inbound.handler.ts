import { FastifyReply } from 'fastify';
import { ConversationState } from '@prisma/client';
import { customerService } from '../../services/customer.service';
import { conversationService } from '../../services/conversation.service';
import { messageService } from '../../services/message.service';
import { queueService } from '../../services/queue.service';
import { burstCoalesceService } from '../../services/burst-coalesce.service';
import { abuseDetectionService } from '../../services/abuse-detection.service';
import { enforceAiScopeGate } from '../../services/ai-scope-gate.service';
import { matchAdClickAndFireContact } from '../../services/ad-attribution.service';
import { wahaClient } from '../../integrations/waha/client';
import { stageLog } from '../../utils/stage-logger';
import { normalizeWahaJid, extractRealPhoneFromWahaPayload, parseJidType } from '../../utils/jid';
import { extractWahaLocation } from '../../utils/waha-location-parser';
import { parseCanonicalInboundMessage } from '../../utils/canonical-message-normalizer';
import { extractWahaAdReferral } from '../../integrations/whatsapp/waha-ctwa-referral';
import { hasBypassLabel, isBypassLabelName, checkCustomerBypass } from '../../utils/customer-bypass';

/**
 * Handler utama pemrosesan pesan inbound (customer -> bot) dari webhook WAHA.
 */
export async function handleInboundMessageEvent(
  payload: any,
  resolvedTenantId: string,
  reply: FastifyReply,
  correlationId: string
) {
  // Inbound message (dari customer ke bot)
  const from = payload.from;
  const chatId = payload.chatId || from || '';

  // --- FILTER CHAT GRUP & NON-PERSONAL (Abaikan group/broadcast/status/newsletter) ---
  const isGroup =
    (payload.from && payload.from.endsWith('@g.us')) ||
    (payload.chatId && payload.chatId.endsWith('@g.us')) ||
    chatId.endsWith('@g.us');
  if (isGroup) {
    return reply.status(200).send({ status: 'IGNORED_GROUP_MESSAGE' });
  }

  const fromJid = payload.from || payload.chatId || '';
  if (fromJid.includes('@broadcast') || fromJid.includes('@newsletter') || fromJid.includes('status@')) {
    return reply.status(200).send({ status: 'IGNORED_NON_PERSONAL' });
  }

  // Resolusi Real Phone Number & Primary JID dari Payload
  const { phone: extractedPhone, resolvedJid: payloadResolvedJid } = extractRealPhoneFromWahaPayload(payload);
  let resolvedJid = payloadResolvedJid;
  let phone = extractedPhone;

  if (!phone || parseJidType(chatId) === 'lid') {
    const jidFromWaha = await wahaClient.resolvePrimaryJid(chatId);
    if (parseJidType(jidFromWaha) === 'phone') {
      phone = normalizeWahaJid(jidFromWaha);
      resolvedJid = `${phone}@c.us`;
    }
  }

  const waMessageId = payload.id;
  if (!waMessageId) {
    return reply.status(200).send({ status: 'IGNORED_NO_ID' });
  }

  // --- IDEMPOTENCY CHECK ---
  const isDuplicate = await messageService.isDuplicateMessage(waMessageId, resolvedTenantId);
  if (isDuplicate) {
    console.log(`[IDEMPOTENCY SKIP] WAHA Message ID ${waMessageId} has already been processed. Skipping retry.`);
    return reply.status(200).send({ status: 'IGNORED_DUPLICATE' });
  }

  // Guard: JID yang tidak bisa diekstrak jadi nomor HP (junk/status) jangan sampai
  // membuat customer ber-phone kosong/aneh di database.
  if (!phone) {
    console.warn(`[NO PHONE] Skipping message from unparseable chat ${chatId || '(unknown)'}.`);
    return reply.status(200).send({ status: 'IGNORED_NO_PHONE' });
  }

  const msgObj = payload.message as any;
  const inboundTextPreview =
    payload.body ||
    msgObj?.conversation ||
    msgObj?.extendedTextMessage?.text ||
    (payload.type === 'image' ? '[GAMBAR]' : '[MEDIA]');
  stageLog(
    'INCOMING',
    `Customer: "${inboundTextPreview.slice(0, 50).replace(/\n/g, ' ')}${inboundTextPreview.length > 50 ? '...' : ''}"`,
    phone
  );
  let contactName = payload._data?.notifyName;
  if (!contactName) {
    try {
      const cObj = await wahaClient.getContact(chatId);
      contactName = cObj?.pushname || cObj?.name || undefined;
    } catch (_) {}
  }

  // --- MEDIA INBOUND (gambar customer) — DIEKSEKUSI SEBELUM STALE GUARD ---
  // Supaya image dari WA Web/Official tetap tersimpan ke storage/media/inbound
  // meski timestamp telat (reconnect/QR burst) dan tetap muncul di LiveChat.
  const pAny = payload as any;

  // Normalisasi kanonis pesan (Tipe, Content, Lokasi, Media, Kontak)
  const canonical = parseCanonicalInboundMessage(payload);

  // Strict Real Location check (koordinat 0,0 dari EXIF/WA Web image DIBUANG).
  const { rawLat, rawLng, hasRealLocation } = extractWahaLocation(payload);

  const isInboundImage = canonical.type === 'image';

  // Caption WAHA NOWEB sering ada di body, bukan caption — fallback ke body
  const imageCaption =
    pAny.message?.imageMessage?.caption ||
    pAny.caption ||
    (isInboundImage ? pAny.body : '') ||
    pAny._data?.caption ||
    pAny._data?.body ||
    '';
  let inboundMedia: any = null;
  if (isInboundImage) {
    try {
      const { mediaService } = await import('../../services/media.service');
      let buffer: Buffer | null = null;
      const mimeType =
        pAny.message?.imageMessage?.mimetype ||
        pAny.media?.mimetype ||
        pAny.media?.mime_type ||
        pAny._data?.mimetype ||
        pAny.mimetype ||
        'image/jpeg';
      const mediaUrlCandidate =
        pAny.media?.url ||
        pAny._data?.mediaUrl ||
        pAny._data?.deprecatedMms3Url ||
        pAny.media?.deprecatedMms3Url ||
        null;
      // 1. Coba download langsung dari URL WAHA jika ada
      if (mediaUrlCandidate) {
        buffer = await wahaClient.fetchUrl(String(mediaUrlCandidate));
      } else if (pAny.media?.url) {
        buffer = await wahaClient.fetchUrl(String(pAny.media.url));
      }
      // 2. Fallback ke wahaClient.downloadMedia (multi-endpoint)
      if (!buffer || buffer.length === 0) {
        buffer = await wahaClient.downloadMedia(waMessageId, chatId);
      }
      // 3. Fallback ke base64 jpegThumbnail jika download gagal
      if ((!buffer || buffer.length === 0) && (pAny.message?.imageMessage?.jpegThumbnail || pAny._data?.jpegThumbnail)) {
        const thumbB64 = pAny.message?.imageMessage?.jpegThumbnail || pAny._data?.jpegThumbnail;
        buffer = Buffer.from(thumbB64, 'base64');
      }
      if (buffer && buffer.length > 0) {
        const saved = await mediaService.saveInboundMedia({ tenantId: resolvedTenantId, buffer, mimeType });
        inboundMedia = {
          url: saved.hdUrl || saved.thumbUrl,
          hdUrl: saved.hdUrl,
          thumbUrl: saved.thumbUrl,
          mimeType,
          caption: imageCaption || null,
        };

        // Deteksi bukti bayar di background (fire-and-forget, tidak menahan webhook response)
        import('../../services/customer-payment-proof.service')
          .then(({ attachFromInbound }) => {
            void attachFromInbound({
              tenantId: resolvedTenantId,
              phone,
              contactName,
              mediaUrl: saved.hdUrl || saved.thumbUrl || '',
              buffer: buffer!,
              mimeType,
              waMessageId,
            });
          })
          .catch((proofErr) => {
            console.warn('[PAYMENT PROOF HOOK] Background dispatch error:', proofErr?.message || proofErr);
          });
      } else if (mediaUrlCandidate) {
        const rawUrl = String(mediaUrlCandidate);
        const urlPath = rawUrl.replace(/^https?:\/\/[^/]+/, '');
        inboundMedia = {
          url: urlPath,
          hdUrl: urlPath,
          mimeType,
          caption: imageCaption || null,
        };
      } else if (pAny.media?.url) {
        const rawUrl = String(pAny.media.url);
        const urlPath = rawUrl.replace(/^https?:\/\/[^/]+/, '');
        inboundMedia = {
          url: urlPath,
          hdUrl: urlPath,
          mimeType,
          caption: imageCaption || null,
        };
      } else {
        console.warn(
          `[WAHA MEDIA WARNING] Gagal mengunduh gambar dari WAHA untuk pesan ${waMessageId} (chat: ${chatId}) — buffer kosong / null.`
        );
      }
    } catch (mediaErr: any) {
      console.warn('[WAHA MEDIA] Gagal menyimpan media inbound:', mediaErr.message);
    }
  }

  // Canonical Inbound Content — Single Source of Truth
  const inboundContent = canonical.content;

  const mergeMediaIntoPayload = (p: any) => {
    const cleanedPayload = { ...p };
    if (canonical.location) {
      cleanedPayload.location = canonical.location;
    } else if (!hasRealLocation) {
      delete cleanedPayload.location;
      if (cleanedPayload._data) delete cleanedPayload._data.location;
    }
    if (inboundMedia) {
      cleanedPayload.media = inboundMedia;
    } else if (canonical.media) {
      cleanedPayload.media = canonical.media;
    }
    if (canonical.contact) {
      cleanedPayload.contact = canonical.contact;
    }
    cleanedPayload.canonicalType = canonical.type;
    return cleanedPayload;
  };

  // --- FAST-PATH GUARD: STALE / CATCH-UP MESSAGE (Mencegah banjir sync saat QR scan / reconnect) ---
  // Pesan lama tetap dicatat ke database (audit trail & Live Chat) dengan media jika ada,
  // tetapi dilewati dari bot auto-reply & API eksternal.
  const maxAgeSeconds = parseInt(process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS || '300', 10);
  if (maxAgeSeconds > 0 && payload.timestamp) {
    const rawTs = Number(payload.timestamp);
    if (!isNaN(rawTs) && rawTs > 0) {
      const msgTimeMs = rawTs > 10000000000 ? rawTs : rawTs * 1000;
      const ageSeconds = Math.floor((Date.now() - msgTimeMs) / 1000);
      if (ageSeconds > maxAgeSeconds) {
        const rawBodyForStale =
          payload.body || msgObj?.conversation || msgObj?.extendedTextMessage?.text || imageCaption || '';
        let isStaleForm = false;
        try {
          const { isReservationFormMessage: _isFormStale } = await import('../../utils/reservation-text-parser');
          isStaleForm = _isFormStale(rawBodyForStale);
        } catch {}
        if (hasRealLocation) {
          console.log(
            `[STALE GUARD BYPASS] GPS Shareloc dari ${phone} terdeteksi meski age ${ageSeconds}s (> ${maxAgeSeconds}s) — lanjut ke jalur GPS sync prioritas.`
          );
        } else if (isStaleForm) {
          console.log(
            `[STALE GUARD BYPASS] Reservation form dari ${phone} terdeteksi meski age ${ageSeconds}s (> ${maxAgeSeconds}s) — lanjut ke jalur capture (Siska #777).`
          );
        } else if (isInboundImage) {
          // Image stale tetap simpan dengan media, jangan hilangkan gambar
          console.log(`[STALE IMAGE] Message ${waMessageId} from ${phone} is ${ageSeconds}s old — tetap simpan image ke LiveChat.`);
          const staleCustomer = await customerService.getOrCreateCustomer(phone, contactName, resolvedTenantId);
          const staleConversation = await conversationService.getOrCreateConversation(staleCustomer.id, resolvedTenantId);
          await messageService.logMessage({
            tenantId: resolvedTenantId,
            conversationId: staleConversation.id,
            direction: 'INBOUND',
            content: inboundContent,
            waMessageId,
            payloadRaw: mergeMediaIntoPayload(payload),
            skipMqlEvaluation: true,
            isHistorical: true,
          });
          return reply.status(200).send({ status: 'IGNORED_STALE_MESSAGE' });
        } else {
          console.log(
            `[STALE MESSAGE GUARD] Message ${waMessageId} from ${phone} is ${ageSeconds}s old (threshold: ${maxAgeSeconds}s). Fast-tracking to DB only and dropping auto-reply/side-effects.`
          );
          const staleCustomer = await customerService.getOrCreateCustomer(phone, contactName, resolvedTenantId);
          const staleConversation = await conversationService.getOrCreateConversation(staleCustomer.id, resolvedTenantId);
          await messageService.logMessage({
            tenantId: resolvedTenantId,
            conversationId: staleConversation.id,
            direction: 'INBOUND',
            content: inboundContent,
            waMessageId,
            payloadRaw: mergeMediaIntoPayload(payload),
            skipMqlEvaluation: true,
            isHistorical: true,
          });
          return reply.status(200).send({ status: 'IGNORED_STALE_MESSAGE' });
        }
      }
    }
  }

  const existingCustomer = await customerService.getCustomerByPhone(phone, resolvedTenantId);
  let labels: string[] | null = null;
  let isBypassChat = false;

  // 1. Cek dari flag customer atau relasi label di database
  if (existingCustomer) {
    if (existingCustomer.is_admin_labeled === true || hasBypassLabel(existingCustomer)) {
      isBypassChat = true;
    } else {
      const dbBypass = await checkCustomerBypass({ customerId: existingCustomer.id, phone, tenantId: resolvedTenantId });
      if (dbBypass) {
        isBypassChat = true;
      }
    }
  }

  // 2. Fallback jika customer baru atau belum tersinkronisasi labels_synced_at
  if (!isBypassChat && (!existingCustomer || existingCustomer.labels_synced_at === null)) {
    labels = await wahaClient.getChatLabelsOrNull(chatId);
    if (labels !== null) {
      const hasBypass = labels.some((l) => isBypassLabelName(l));
      const isAdmin = labels.some((l) => l.toLowerCase() === 'admin');
      const isHold = labels.some((l) => l.toLowerCase() === 'hold');
      if (existingCustomer) {
        customerService
          .setLabelFlags(phone, { isAdminLabeled: isAdmin || hasBypass, isHoldLabeled: isHold }, resolvedTenantId)
          .catch(() => {});
      }
      if (isAdmin || hasBypass) {
        isBypassChat = true;
      }
    }
  }

  // --- CHOKE POINT GPS PIN TUNGGAL (insiden #138 — Bunda Agatha, 25 Sep 2026) ---
  if (hasRealLocation) {
    try {
      const { locationIngestService } = await import('../../services/location-ingest.service');
      const ingestCustomer =
        existingCustomer ||
        (await customerService.getOrCreateCustomer(phone, contactName, resolvedTenantId, {
          skipFollowUpScheduling: isBypassChat,
        }));
      const gpsResult = await locationIngestService.ingestGpsPin({
        customer: ingestCustomer,
        incomingMessage: { type: 'location', location: { latitude: rawLat, longitude: rawLng } },
        tenantId: resolvedTenantId,
      });
      if (gpsResult.status !== 'skipped') {
        console.log(`[LOCATION INGEST] choke point ${gpsResult.status}: ${gpsResult.reason} (${phone})`);
      }
    } catch (ingestErr: any) {
      console.warn('[LOCATION INGEST] choke point error:', ingestErr?.message || ingestErr);
    }
  }

  // --- MEDIA BERAT (video/audio/document): unduh BACKGROUND fire-and-forget ---
  const isAudioOrVoice = canonical.type === 'audio' || canonical.type === 'voice_note';
  const isVideoMsg = canonical.type === 'video';
  const isDocumentMsg = canonical.type === 'document';
  const heavyMediaType: 'audio' | 'video' | 'document' | null =
    isAudioOrVoice ? 'audio' : isVideoMsg ? 'video' : isDocumentMsg ? 'document' : null;
  if (heavyMediaType && !isInboundImage) {
    const heavyMime =
      canonical.media?.mimeType ||
      payload.message?.videoMessage?.mimetype ||
      payload.message?.audioMessage?.mimetype ||
      (heavyMediaType === 'audio'
        ? 'audio/ogg'
        : heavyMediaType === 'video'
        ? 'video/mp4'
        : 'application/octet-stream');
    const heavyFileName =
      canonical.media?.fileName ||
      payload.message?.documentMessage?.fileName ||
      payload.message?.documentMessage?.title ||
      pAny._data?.message?.documentMessage?.fileName ||
      pAny.fileName ||
      undefined;
    const heavyCaption =
      canonical.media?.caption ||
      payload.message?.videoMessage?.caption ||
      pAny.caption ||
      undefined;
    void (async () => {
      try {
        const { mediaService } = await import('../../services/media.service');
        const heavyMediaUrl =
          canonical.media?.url ||
          pAny.media?.url ||
          pAny._data?.mediaUrl ||
          pAny._data?.deprecatedMms3Url ||
          null;
        let buffer: Buffer | null = null;
        if (heavyMediaUrl) {
          try {
            buffer = await wahaClient.fetchUrl(String(heavyMediaUrl));
          } catch {
            buffer = null;
          }
        }
        if (!buffer || buffer.length === 0) {
          buffer = await wahaClient.downloadMedia(waMessageId, chatId);
        }
        if (buffer && buffer.length > 0) {
          const saved = await mediaService.saveInboundMedia({ tenantId: resolvedTenantId, buffer, mimeType: heavyMime });
          try {
            const bgCustomer = await customerService.getCustomerByPhone(phone, resolvedTenantId);
            if (bgCustomer) {
              const bgConv = await conversationService.getOrCreateConversation(bgCustomer.id, resolvedTenantId);
              await messageService.attachMediaToMessage(bgConv.id, waMessageId, resolvedTenantId, {
                url: saved.hdUrl || saved.thumbUrl,
                hdUrl: saved.hdUrl,
                thumbUrl: saved.thumbUrl,
                mimeType: heavyMime,
                fileName: heavyFileName,
                caption: heavyCaption ?? null,
              });
            }
          } catch (attachErr: any) {
            console.warn(`[WAHA MEDIA] Gagal melampirkan media ${heavyMediaType} ${waMessageId} ke record:`, attachErr.message);
          }
          console.log(`[WAHA MEDIA] ${heavyMediaType} inbound ${waMessageId} arsip tersimpan + ter-link ke DB (background).`);
        } else {
          console.warn(`[WAHA MEDIA WARNING] Buffer kosong untuk ${heavyMediaType} ${waMessageId}.`);
        }
      } catch (mediaErr: any) {
        console.warn(`[WAHA MEDIA] Gagal mengarsipkan ${heavyMediaType} inbound ${waMessageId} (background):`, mediaErr.message);
      }
    })();
  }

  if (isBypassChat) {
    console.log(`[BYPASS CHAT] Chat ${chatId} has bypass/admin label (Skip / Admin CS). Logging to Live Chat and bypassing bot auto-reply.`);
    const adminCustomer = await customerService.getOrCreateCustomer(phone, contactName, resolvedTenantId, { skipFollowUpScheduling: true });
    const adminConversation = await conversationService.getOrCreateConversation(adminCustomer.id, resolvedTenantId);

    try {
      const wahaReferral = extractWahaAdReferral(payload);
      if (wahaReferral?.ctwaClid) {
        await matchAdClickAndFireContact({
          bodyText: inboundContent,
          isNewCustomerRecord: false,
          customer: adminCustomer,
          tenantId: resolvedTenantId,
          referral: wahaReferral,
        });
      }
    } catch (ctwaErr: any) {
      console.warn('[BYPASS CTWA INGEST ERROR]', ctwaErr.message);
    }

    await messageService.logMessage({
      tenantId: resolvedTenantId,
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
        'Nomor berlabel Skip / Admin CS (Manual Handling)',
        resolvedTenantId,
        'admin_labeled'
      ).catch(() => {});
    }

    return reply.status(200).send({ status: 'IGNORED_ADMIN' });
  }

  // --- LEGACY PER-CONTACT SCRAPE TRIGGER (Task 2 / flag: ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER) ---
  if (process.env.ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER === 'true') {
    if (labels === null) {
      labels = await wahaClient.getChatLabels(chatId);
    }
    if (labels.some((l) => l.toLowerCase() === 'legacy')) {
      if (existingCustomer && !existingCustomer.legacy_scraped_at) {
        console.log(`[LEGACY SCRAPE TRIGGER] Chat ${chatId} labeled 'legacy', customer not yet scraped. Triggering.`);
        const customer = await customerService.getOrCreateCustomer(phone, contactName, resolvedTenantId);
        const conversation = await conversationService.getOrCreateConversation(customer.id, resolvedTenantId);
        await messageService.logMessage({
          tenantId: resolvedTenantId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          content: inboundContent,
          waMessageId,
          payloadRaw: mergeMediaIntoPayload(payload),
        });
        import('../../services/per-contact-legacy-scrape.service').then(({ perContactLegacyScrapeService }) => {
          perContactLegacyScrapeService
            .scrapeContactUntilFirstLead(chatId, resolvedTenantId)
            .catch((err: any) => console.error('[LEGACY SCRAPE ERROR]', err));
        });
        return reply.status(200).send({ status: 'LEGACY_SCRAPE_TRIGGERED' });
      }
    }
  }

  // Periksa apakah customer baru (belum ada record di database)
  const isNewCustomerRecord = !existingCustomer;

  // Ambil/Buat record Customer & Conversation
  const customer = await customerService.getOrCreateCustomer(phone, contactName, resolvedTenantId);

  let conversation = await conversationService.getOrCreateConversation(customer.id, resolvedTenantId);
  conversationService.updateLastCustomerMessageAt(conversation.id, resolvedTenantId).catch(() => {});

  // --- GUARD CLAUSE: BLOCKED CUSTOMER (Tergolong di awal pemrosesan, setelah Idempotency Check) ---
  if (customer.status === 'blocked') {
    console.warn(`[BLOCKED ACCESS] Blocked customer ${phone} attempted to send a message. Logging to audit and dropping response.`);
    await messageService.logMessage({
      tenantId: resolvedTenantId,
      conversationId: conversation.id,
      direction: 'INBOUND',
      content: inboundContent,
      waMessageId,
      payloadRaw: mergeMediaIntoPayload(payload),
    });
    return reply.status(200).send({ status: 'BLOCKED' });
  }

  // --- AUTO-RELEASE SEWA (dipindah ke SEBELUM scope gate) ---
  {
    const autoRelease = conversationService.checkAndApplyAutoRelease(conversation, resolvedTenantId);
    conversation = autoRelease.updatedConversation;
  }

  // --- AI ROLLOUT SCOPE GATE (Task: AI hanya untuk customer baru) ---
  const scopeGate = await enforceAiScopeGate({
    customer,
    conversation,
    tenantId: resolvedTenantId,
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
    type:
      canonical.type === 'location' || canonical.type === 'live_location'
        ? 'location'
        : canonical.type === 'image'
        ? 'image'
        : canonical.type === 'voice_note' || canonical.type === 'audio'
        ? 'audio'
        : canonical.type === 'document'
        ? 'document'
        : canonical.type === 'video'
        ? 'video'
        : canonical.type === 'sticker'
        ? 'sticker'
        : canonical.type === 'contact'
        ? 'contact'
        : 'text',
    text: canonical.type === 'text' && payload.body ? { body: payload.body } : undefined,
    location: canonical.location
      ? {
          latitude: canonical.location.latitude,
          longitude: canonical.location.longitude,
        }
      : undefined,
    media: inboundMedia || canonical.media,
    contact: canonical.contact,
    canonicalType: canonical.type,
  };

  // --- PURCHASE EVENT DETECTION ---
  if (incomingMessage.type === 'text' && incomingMessage.text?.body) {
    try {
      const { maybeFirePurchaseEvent } = await import('../../services/purchase-detection.service');
      await maybeFirePurchaseEvent({
        customer,
        conversation,
        text: incomingMessage.text.body,
        tenantId: resolvedTenantId,
      });
    } catch (purchaseErr) {
      console.warn('[CAPI] Purchase detection error:', (purchaseErr as Error).message);
    }
  }

  // --- ATTRIBUTION CHECK & CAPI CONTACT (SHARED SERVICE) ---
  const bodyText = incomingMessage.text?.body || '';
  const wahaReferral = extractWahaAdReferral(payload);
  const attributionResult = await matchAdClickAndFireContact({
    bodyText,
    isNewCustomerRecord,
    customer,
    tenantId: resolvedTenantId,
    referral: wahaReferral,
    lastCustomerMessageAt: conversation.last_customer_message_at ?? conversation.last_message_at ?? null,
  });

  incomingMessage.originalText = bodyText;
  if (incomingMessage.text && attributionResult.strippedText) {
    incomingMessage.text.body = attributionResult.strippedText;
    (incomingMessage as any).cleanTextForAi = attributionResult.strippedText;
  } else if (incomingMessage.text) {
    (incomingMessage as any).cleanTextForAi = incomingMessage.text.body;
  }

  // JIKA is_human_handling === true (dan belum timed out):
  if (conversation.is_human_handling) {
    const isTesting = process.env.NODE_ENV === 'test';
    const timeSinceEscalation =
      conversation.human_handling_since && !isTesting
        ? Date.now() - new Date(conversation.human_handling_since).getTime()
        : Infinity;

    if (timeSinceEscalation <= 30000) {
      console.log(
        `[ESCALATION GRACE PERIOD] Conversation ${conversation.id} escalated recently (${(timeSinceEscalation / 1000).toFixed(1)}s ago). Bypassing WhatsApp label release checks.`
      );
      try {
        const raw = incomingMessage.text?.body || '';
        const { tryCaptureReservationFormFromRaw } = await import('../../services/reservation-lifecycle.service');
        await tryCaptureReservationFormFromRaw({
          tenantId: resolvedTenantId,
          customerId: customer.id,
          chatId,
          raw,
          history: conversation?.history || [],
          source: 'WEBHOOK_HUMAN_GRACE_CAPTURE',
          customer,
        });
      } catch (e: any) {
        console.warn('[HUMAN GRACE AUTO-CAPTURE ERROR]', e.message);
      }

      try {
        if (incomingMessage.type === 'location' || (incomingMessage.location && incomingMessage.location.latitude != null)) {
          const { humanBackgroundEnrichmentService } = await import('../../services/human-background-enrichment.service');
          await humanBackgroundEnrichmentService.enrichSync(
            { customer, conversation, incomingMessage, history: [] } as any,
            resolvedTenantId
          );
        } else {
          const rawLocText = incomingMessage.text?.body || '';
          const hasMapsLink = rawLocText && /maps\.app\.goo\.gl|goo\.gl\/maps|google\.com\/maps/i.test(rawLocText);
          if (hasMapsLink) {
            const { humanBackgroundEnrichmentService } = await import('../../services/human-background-enrichment.service');
            await humanBackgroundEnrichmentService.enrichSync(
              { customer, conversation, incomingMessage, history: [] } as any,
              resolvedTenantId
            );
          }
        }
      } catch (e: any) {
        console.warn('[HUMAN GRACE GPS SYNC ERROR]', e.message);
      }

      await messageService.logMessage({
        tenantId: resolvedTenantId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        content: (incomingMessage as any).originalText || inboundContent || incomingMessage.text?.body || '[PESAN]',
        waMessageId: waMessageId,
        payloadRaw: mergeMediaIntoPayload(payload),
      });

      return reply.status(200).send({ status: 'HUMAN_HANDLING_ACTIVE_SILENT' });
    }

    const enableHoldLabel =
      process.env.ENABLE_WAHA_HOLD_LABEL === 'true' ||
      (process.env.NODE_ENV === 'test' && process.env.ENABLE_WAHA_HOLD_LABEL !== 'false');
    if (!enableHoldLabel) {
      console.log(`[LABEL SYNC DISABLED] Skipping WAHA label checks in production (UI-managed mode). Bot stays silent in HUMAN_HANDLING.`);
      try {
        const raw = incomingMessage.text?.body || '';
        const { tryCaptureReservationFormFromRaw } = await import('../../services/reservation-lifecycle.service');
        const result = await tryCaptureReservationFormFromRaw({
          tenantId: resolvedTenantId,
          customerId: customer.id,
          chatId,
          raw,
          history: conversation?.history || [],
          source: 'WEBHOOK_HOLD_DISABLED_CAPTURE',
          customer,
        });
        if (!result.captured && result.parseError) {
          console.warn(`[HUMAN HOLD-DISABLED PARSE FAIL] ${result.parseError} missing=${result.missingFields?.join(',')}`);
        }
      } catch (e: any) {
        console.warn('[HUMAN HOLD-DISABLED AUTO-CAPTURE ERROR]', e.message);
      }

      try {
        if (incomingMessage.type === 'location' || (incomingMessage.location && incomingMessage.location.latitude != null)) {
          const { humanBackgroundEnrichmentService } = await import('../../services/human-background-enrichment.service');
          await humanBackgroundEnrichmentService.enrichSync(
            { customer, conversation, incomingMessage, history: [] } as any,
            resolvedTenantId
          );
        } else {
          const rawLocText2 = incomingMessage.text?.body || '';
          const hasMapsLink2 = rawLocText2 && /maps\.app\.goo\.gl|goo\.gl\/maps|google\.com\/maps/i.test(rawLocText2);
          if (hasMapsLink2) {
            const { humanBackgroundEnrichmentService } = await import('../../services/human-background-enrichment.service');
            await humanBackgroundEnrichmentService.enrichSync(
              { customer, conversation, incomingMessage, history: [] } as any,
              resolvedTenantId
            );
          }
        }
      } catch (e: any) {
        console.warn('[HUMAN HOLD-DISABLED GPS SYNC ERROR]', e.message);
      }

      await messageService.logMessage({
        tenantId: resolvedTenantId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        content: (incomingMessage as any).originalText || inboundContent || incomingMessage.text?.body || '[PESAN]',
        waMessageId: waMessageId,
        payloadRaw: mergeMediaIntoPayload(payload),
      });

      return reply.status(200).send({ status: 'HUMAN_HANDLING_ACTIVE_SILENT' });
    }

    let hasHoldLabel = false;
    if (customer && customer.labels_synced_at !== null && typeof customer.is_hold_labeled === 'boolean') {
      hasHoldLabel = customer.is_hold_labeled;
    } else {
      if (labels === null) {
        labels = await wahaClient.getChatLabelsOrNull(chatId);
      }
      if (labels !== null) {
        hasHoldLabel = labels.some((l) => l.toLowerCase() === 'hold');
        const isAdmin = labels.some((l) => l.toLowerCase() === 'admin');
        customerService.setLabelFlags(phone, { isAdminLabeled: isAdmin, isHoldLabeled: hasHoldLabel }, resolvedTenantId).catch(() => {});
      }
    }

    if (!hasHoldLabel && enableHoldLabel) {
      console.log(`[ADMIN RELEASE] Hold label removed by admin for chat ${chatId}. Auto-releasing from HUMAN_HANDLING.`);
      customerService.setLabelFlags(phone, { isHoldLabeled: false }, resolvedTenantId).catch(() => {});
      const restoredState = conversation.previous_state || ConversationState.INITIAL;
      const updatedConv = await conversationService.updateConversationState(
        conversation.id,
        {
          currentState: restoredState,
          isHumanHandling: false,
          humanHandlingSince: null,
        },
        resolvedTenantId
      );
      if (updatedConv) {
        conversation = updatedConv;
      } else {
        conversation.is_human_handling = false;
        conversation.human_handling_since = null;
        conversation.current_state = restoredState;
      }
    } else {
      console.log(
        `[EXPLICIT GUARD CLAUSE] Conversation ${conversation.id} is in HUMAN_HANDLING mode. Logging inbound message and BYPASSING all LLM & auto-replies.`
      );
      try {
        const raw = incomingMessage.text?.body || '';
        const { tryCaptureReservationFormFromRaw } = await import('../../services/reservation-lifecycle.service');
        await tryCaptureReservationFormFromRaw({
          tenantId: resolvedTenantId,
          customerId: customer.id,
          chatId,
          raw,
          history: conversation?.history || [],
          source: 'WEBHOOK_HUMAN_EXPLICIT_CAPTURE',
          customer,
        });
      } catch (e: any) {
        console.warn('[HUMAN EXPLICIT AUTO-CAPTURE ERROR]', e.message);
      }

      try {
        const { humanBackgroundEnrichmentService } = await import('../../services/human-background-enrichment.service');
        const isGpsPin =
          incomingMessage.type === 'location' || (incomingMessage.location && incomingMessage.location.latitude != null);
        if (isGpsPin) {
          await humanBackgroundEnrichmentService.enrichSync(
            { customer, conversation, incomingMessage, history: [] } as any,
            resolvedTenantId
          );
        } else {
          humanBackgroundEnrichmentService.enrichAsync(
            { customer, conversation, incomingMessage, history: [] } as any,
            resolvedTenantId
          );
        }
      } catch (enrichErr: any) {
        console.warn('[HUMAN ENRICH HOOK ERROR]', enrichErr?.message || enrichErr);
      }

      await messageService.logMessage({
        tenantId: resolvedTenantId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        content: (incomingMessage as any).originalText || inboundContent || incomingMessage.text?.body || '[PESAN]',
        waMessageId: waMessageId,
        payloadRaw: mergeMediaIntoPayload(payload),
      });

      return reply.status(200).send({ status: 'HUMAN_HANDLING_ACTIVE_SILENT' });
    }
  }

  // --- ABUSE DETECTION CHECK (Sebelum antrean / queue) ---
  const abuseResult = await abuseDetectionService.checkAndProcessAbuse(
    customer,
    conversation,
    incomingMessage.text?.body || '',
    resolvedTenantId
  );

  if (abuseResult.blocked) {
    await messageService.logMessage({
      tenantId: resolvedTenantId,
      conversationId: conversation.id,
      direction: 'INBOUND',
      content: (incomingMessage as any).originalText || inboundContent || incomingMessage.text?.body || '[PESAN]',
      waMessageId,
      payloadRaw: mergeMediaIntoPayload(payload),
    });
    return reply.status(200).send({ status: 'BLOCKED' });
  }

  // Masukkan pesan ke antrian pemrosesan sekuensial per customer.
  const coalesceResult = await burstCoalesceService.maybeCoalesce({
    tenantId: resolvedTenantId,
    customerId: customer.id,
    phone: customer.phone,
    conversation,
    incomingMessage,
  });

  if (!coalesceResult.handled) {
    // 1. Persist inbound turn (RECEIVED) sebelum enqueue
    try {
      const { turnRepository } = await import('../../repositories/turn.repository');
      await turnRepository.persistInbound({
        tenantId: resolvedTenantId,
        provider: 'WAHA',
        inboundMessageId: waMessageId,
        customerId: customer.id,
        conversationId: conversation.id,
        payload: { tenantId: resolvedTenantId, customerId: customer.id, phone: customer.phone, incomingMessage },
      });
    } catch (turnErr: any) {
      console.warn('[WEBHOOK TURN PERSIST WARN]', turnErr?.message || turnErr);
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`[WEBHOOK INGRESS DURABILITY] Gagal persist inbound turn: ${turnErr?.message || turnErr}`);
      }
    }

    // 2. Enqueue ke durable queue
    await queueService.enqueueMessage({
      tenantId: resolvedTenantId,
      customerId: customer.id,
      phone: customer.phone,
      incomingMessage,
      correlationId,
      turnId: `${resolvedTenantId}:WAHA:${waMessageId}`,
      provider: 'WAHA',
      inboundMessageId: waMessageId,
    });

    // 3. Pre-logging inbound ke LiveChat HANYA SETELAH enqueue durable sukses
    if (!(incomingMessage as any)._preLogged) {
      try {
        await messageService.logMessage({
          tenantId: resolvedTenantId,
          conversationId: conversation.id,
          direction: 'INBOUND' as any,
          content: (incomingMessage as any).originalText || inboundContent || incomingMessage.text?.body || '[PESAN]',
          waMessageId,
          payloadRaw: mergeMediaIntoPayload(payload),
        });
        (incomingMessage as any)._preLogged = true;
      } catch (preLogErr: any) {
        console.warn('[PRE-LOG INBOUND WARN]', preLogErr?.message || preLogErr);
      }
    }
  }

  return reply.status(200).send({ status: 'EVENT_PROCESSED' });
}
