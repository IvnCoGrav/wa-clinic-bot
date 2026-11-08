import { FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { customerService } from '../../services/customer.service';
import { conversationService } from '../../services/conversation.service';
import { messageService } from '../../services/message.service';
import { wahaClient } from '../../integrations/waha/client';
import { extractRealPhoneFromWahaPayload, parseJidType, normalizeWahaJid } from '../../utils/jid';
import { parseCanonicalInboundMessage } from '../../utils/canonical-message-normalizer';

export async function handleOutboundEchoEvent(
  payload: any,
  resolvedTenantId: string,
  tenantName: string | undefined,
  reply: FastifyReply
) {
  // Outbound message dari HP WhatsApp asli / Live Chat / Bot
  const customerJid = payload.chatId || (payload as any).to || payload.from;
  if (customerJid) {
    // Lewati grup WhatsApp & status broadcast
    if (customerJid.includes('@g.us') || customerJid.includes('broadcast') || customerJid.includes('@newsletter')) {
      return reply.status(200).send({ status: 'IGNORED_OUTBOUND_GROUP' });
    }

    let { phone } = extractRealPhoneFromWahaPayload(payload);
    if (!phone || parseJidType(customerJid) === 'lid') {
      if (parseJidType(customerJid) === 'lid') {
        try {
          const pn = await wahaClient.getPhoneNumberFromLid(customerJid);
          if (pn && parseJidType(`${pn}@c.us`) === 'phone') {
            phone = pn;
          }
        } catch (_) {}
      }
    }
    if (!phone && parseJidType(customerJid) === 'phone') {
      phone = normalizeWahaJid(customerJid);
    }

    if (phone && /^\d+$/.test(phone) && !phone.startsWith('6289999')) {
      const pAny = payload as any;
      const outCanonical = parseCanonicalInboundMessage(payload);
      const isOutboundNonText = outCanonical.type !== 'text';
      const isOutboundImage = outCanonical.type === 'image';
      const isOutboundAudio = outCanonical.type === 'audio' || outCanonical.type === 'voice_note';
      const isOutboundDocument = outCanonical.type === 'document';
      const isOutboundVideo = outCanonical.type === 'video';

      const imageCaption =
        pAny.message?.imageMessage?.caption ||
        pAny._data?.message?.imageMessage?.caption ||
        pAny.caption ||
        pAny._data?.caption ||
        pAny.body ||
        '';
      const adminReplyText = imageCaption || payload.body || '';

      // CRITICAL FILTER: Ignore bot automated emergency/waiting templates & device welcome greetings if echoed back
      // Tenant-aware: pola salam dari DB (greetings_text, format_visit, name), bukan hardcode 'Bidan Yusi'/'Kala Spa'.
      const { getTenantEchoPatterns } = await import('../../services/capi.service');
      const echoPatterns = await getTenantEchoPatterns(resolvedTenantId);
      const isDeviceAutoGreeting = echoPatterns.some((p) => p && adminReplyText.includes(p));

      const isBotAutoReply = 
        adminReplyText.includes('Bunda, untuk kondisi darurat seperti ini') ||
        adminReplyText.includes('Bunda, untuk pertimbangan kondisi kesehatan') ||
        adminReplyText.startsWith('Pricelist') ||
        adminReplyText.startsWith('[IMAGE: Pricelist') ||
        imageCaption.startsWith('Pricelist') ||
        adminReplyText.startsWith('[AUTOMATED]') ||
        isDeviceAutoGreeting;

      if (adminReplyText.trim() || isOutboundNonText) {
        const customer = await customerService.getOrCreateCustomer(phone, undefined, resolvedTenantId);
        const conversation = await conversationService.getOrCreateConversation(customer.id, resolvedTenantId);

        let outboundMedia: any = null;
        const mediaUrlCandidate = pAny.media?.url || pAny._data?.mediaUrl || pAny._data?.deprecatedMms3Url || pAny.media?.deprecatedMms3Url || null;
        const candidateMime = pAny.message?.imageMessage?.mimetype ||
          pAny.message?.audioMessage?.mimetype ||
          pAny.message?.documentMessage?.mimetype ||
          pAny.message?.videoMessage?.mimetype ||
          pAny.media?.mimetype ||
          pAny.media?.mime_type ||
          pAny._data?.mimetype ||
          pAny.mimetype ||
          (isOutboundImage ? 'image/jpeg' : isOutboundAudio ? 'audio/ogg' : isOutboundVideo ? 'video/mp4' : isOutboundDocument ? 'application/pdf' : null);

        if (mediaUrlCandidate) {
          const rawUrl = String(mediaUrlCandidate);
          const urlPath = rawUrl.replace(/^https?:\/\/[^/]+/, '');
          outboundMedia = {
            url: urlPath,
            hdUrl: urlPath,
            mimeType: candidateMime,
            caption: imageCaption || null,
            fileName: pAny.media?.filename || pAny.media?.fileName || undefined,
          };
        }

        // 1. Cek duplikasi pesan outbound (apakah ini pesan yang baru saja dikirim oleh bot/sistem)
        const outboundContent = isOutboundNonText
          ? outCanonical.content
          : adminReplyText;

        // F5: penentu UTAMA — wa_message_id yang terdaftar sebagai pesan bot.
        const isKnownBotId = messageService.isKnownBotMessageId(payload.id, resolvedTenantId);
        const isDuplicateOutbound = await messageService.isDuplicateMessage(payload.id, resolvedTenantId);
        const isRecentDuplicate = await messageService.checkAndAttachOutboundDuplicate(
          conversation.id,
          outboundContent,
          payload.id,
          resolvedTenantId,
          60,
          isOutboundNonText
        );
        const isInFlightBot = messageService.isInFlightBotOutbound(
          customerJid || `${phone}@c.us`,
          outboundContent,
          resolvedTenantId
        ) || messageService.isInFlightBotOutbound(
          `${phone}@c.us`,
          outboundContent,
          resolvedTenantId
        ) || messageService.isInFlightBotOutbound(
          `${phone}@c.us`,
          adminReplyText,
          resolvedTenantId
        ) || messageService.isInFlightBotOutbound(
          `${phone}@c.us`,
          imageCaption,
          resolvedTenantId
        );

        if (isKnownBotId || isDuplicateOutbound || isRecentDuplicate || isInFlightBot) {
          if ((isInFlightBot || isKnownBotId) && payload.id) {
            messageService.isDuplicateMessage(payload.id, resolvedTenantId).catch(() => {});
          }
          console.log(`[OUTBOUND DUPLICATE SKIP] Outbound message ${payload.id} already recorded (Bot echo / in-flight / duplicate). Skipping manual reply escalation.`);
          return reply.status(200).send({ status: 'OUTBOUND_DUPLICATE_SKIPPED' });
        }

        // SAFETY NET: Jika ini adalah bot auto reply / pricelist echo, periksa apakah ada bot outbound dalam 30 detik terakhir
        if (isBotAutoReply) {
          try {
            const recentBotMsg = await prisma.message.findFirst({
              where: {
                conversation_id: conversation.id,
                tenant_id: resolvedTenantId,
                direction: 'OUTBOUND',
                sender_type: 'BOT',
                created_at: { gte: new Date(Date.now() - 30000) },
              },
              orderBy: { created_at: 'desc' },
            });
            if (recentBotMsg) {
              if (!recentBotMsg.wa_message_id && payload.id) {
                await prisma.message.updateMany({
                  where: { id: recentBotMsg.id, tenant_id: resolvedTenantId },
                  data: { wa_message_id: payload.id },
                }).catch(() => {});
              }
              console.log(`[OUTBOUND AUTO-REPLY DEDUP] Skipped duplicate bot echo ${payload.id} matching recent bot outbound message in conversation ${conversation.id}.`);
              return reply.status(200).send({ status: 'OUTBOUND_DUPLICATE_SKIPPED' });
            }
          } catch (_) {}
        }

        // JIKA BUKAN DUPLIKAT: Pesan ini berasal dari WhatsApp HP asli / bot echo
        // 2. Jika bukan auto-reply bot, proses human handling takeover / timer + auto mark-as-read
        if (!isBotAutoReply) {
          if (conversation.is_human_handling) {
            // F5.2: await tulis timer sebelum lanjut (hindari race baca-ulang).
            try {
              await conversationService.resetHumanHandlingTimer(conversation.id, resolvedTenantId);
            } catch (err: any) {
              console.error('[AUTO-RELEASE RESET ERROR] Failed to reset human handling timer:', err);
            }
          } else {
            // Jika admin membalas langsung dari HP saat bot aktif, eskalasi ke human handling (takeover)
            try {
              const tenantConfig = await prisma.tenant.findUnique({ where: { id: resolvedTenantId } });
              if (tenantConfig?.manual_reply_escalates !== false) {
                await conversationService.escalateToHumanHandling(
                  conversation,
                  phone,
                  'Admin membalas manual via aplikasi WhatsApp HP',
                  resolvedTenantId,
                  'manual_reply'
                );
              }
            } catch (_) {}
          }
          // Stage 1: auto mark-as-read & broadcast — balasan admin WA HP menandakan sudah dibaca
          try {
            await messageService.markConversationMessagesAsRead(conversation.id, resolvedTenantId);
            await conversationService.setManualUnread(conversation.id, resolvedTenantId, false);
            await conversationService.dismissFrustration(conversation.id, resolvedTenantId);
            const { getLiveChatHub } = await import('../../services/live-chat-hub.service');
            const hub = getLiveChatHub();
            await hub.publish({
              type: 'conversation.updated',
              tenantId: resolvedTenantId,
              payload: {
                conversationId: conversation.id,
                unreadCount: 0,
                isManualUnread: false,
                isHumanHandling: true,
                lastHandledBy: 'human',
              },
            });
          } catch (_) {}
        }

        // 3. Self Learning Capture (hanya jika diaktifkan, ada teks, & bukan auto-reply)
        if (process.env.ENABLE_SELF_LEARNING === 'true' && adminReplyText.trim() && !isBotAutoReply) {
          const { selfLearningService } = await import('../../services/self-learning.service');
          selfLearningService.processAdminReply(customer.id, conversation.id, adminReplyText, resolvedTenantId)
            .catch((err) => console.error('[SELF-LEARNING ERROR] Failed to process admin reply:', err));
        }

        // 4. MedicalFaqStaging Capture Hook
        if (conversation.escalation_reason === 'medical_concern' && adminReplyText.trim() && !isBotAutoReply) {
          try {
            const lastInbound = await messageService.getLastInboundMessage(conversation.id, resolvedTenantId);
            const rawQuestion = lastInbound?.content || 'Pertanyaan medis customer';
            await prisma.medicalFaqStaging.create({
              data: {
                tenant_id: resolvedTenantId,
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

        // 5. Admin Outbound Distance & Ongkir Capture Hook (0 LLM Cost)
        if (adminReplyText.trim() && !isBotAutoReply) {
          try {
            const { humanBackgroundEnrichmentService } = await import('../../services/human-background-enrichment.service');
            humanBackgroundEnrichmentService.enrichFromAdminOutboundAsync(adminReplyText, customer.id, resolvedTenantId);
          } catch (err: any) {
            console.warn('[ADMIN OUTBOUND ENRICH ERROR]', err?.message || err);
          }
        }

        // 5. Log outbound reply ke tabel Messages & broadcast SSE ke Live Chat Panel
        let msgDate: Date | undefined = undefined;
        if (payload.timestamp) {
          const rawTs = Number(payload.timestamp);
          if (!isNaN(rawTs) && rawTs > 0) {
            const ms = rawTs > 10000000000 ? rawTs : rawTs * 1000;
            msgDate = new Date(ms);
          }
        }

        await messageService.logMessage({
          tenantId: resolvedTenantId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          content: outboundContent,
          waMessageId: payload.id,
          senderType: isBotAutoReply ? 'BOT' : 'ADMIN',
          senderName: isBotAutoReply ? `Bot (${tenantName || 'Klinik'})` : 'Admin (WhatsApp HP)',
          createdAt: msgDate,
          payloadRaw: outboundMedia ? { ...payload, media: outboundMedia } : payload,
        }).catch((err) => console.error('[MESSAGE LOG ERROR] Failed to log outbound reply:', err));

        const outTypeLabel = (outCanonical.type || (isOutboundImage ? 'GAMBAR' : 'TEKS')).toUpperCase();
        console.log(`[LIVE CHAT OUTBOUND] Balasan WhatsApp ke ${phone} (${outTypeLabel}) (${isBotAutoReply ? 'BOT' : 'ADMIN'}) tercatat & disiarkan ke Live Chat.`);

        // Background worker: unduh media outbound non-teks dari WhatsApp HP secara asinkron tanpa memblokir webhook
        if (isOutboundNonText && !isBotAutoReply) {
          void (async () => {
            try {
              const { mediaService } = await import('../../services/media.service');
              let buffer: Buffer | null = null;
              const heavyMediaUrl =
                mediaUrlCandidate ||
                pAny.media?.url ||
                pAny._data?.mediaUrl ||
                pAny._data?.deprecatedMms3Url ||
                null;

              if (heavyMediaUrl) {
                try {
                  buffer = await wahaClient.fetchUrl(String(heavyMediaUrl));
                } catch {
                  buffer = null;
                }
              }
              if (!buffer || buffer.length === 0) {
                buffer = await wahaClient.downloadMedia(payload.id, customerJid || `${phone}@c.us`);
              }
              if (buffer && buffer.length > 0) {
                const effectiveMime = candidateMime || (isOutboundImage ? 'image/jpeg' : isOutboundAudio ? 'audio/ogg' : 'application/octet-stream');
                const saved = await mediaService.saveInboundMedia({
                  tenantId: resolvedTenantId,
                  buffer,
                  mimeType: effectiveMime,
                });
                await messageService.attachMediaToMessage(conversation.id, payload.id, resolvedTenantId, {
                  url: saved.hdUrl || saved.thumbUrl,
                  hdUrl: saved.hdUrl,
                  thumbUrl: saved.thumbUrl,
                  mimeType: effectiveMime,
                  caption: imageCaption || null,
                  fileName: pAny.media?.filename || pAny.media?.fileName || undefined,
                });
                console.log(`[WAHA OUTBOUND MEDIA WORKER] Berhasil menyimpan media outbound ${outCanonical.type} ke lokal & broadcast SSE (${payload.id}).`);
              }
            } catch (bgMediaErr: any) {
              console.warn('[WAHA OUTBOUND MEDIA WORKER ERROR] Gagal mengunduh media outbound di background:', bgMediaErr.message);
            }
          })();
        }

        // 5. Background Auto-Capture Reservasi dari Konfirmasi Admin
        try {
          const { isReservationFormMessage, parseReservationText } = await import('../../utils/reservation-text-parser');
          if (isReservationFormMessage(adminReplyText)) {
            const parseResult = parseReservationText(adminReplyText);
            if (parseResult.success && parseResult.reservation) {
              const parsed = parseResult.reservation;
              const { upsertReservationForm } = await import('../../services/reservation-lifecycle.service');
              await upsertReservationForm({
                tenantId: resolvedTenantId,
                customerId: customer.id,
                chatId: customerJid,
                treatmentCategory: parsed.treatmentCategory,
                treatmentDetail: parsed.treatmentDetail,
                bookingDate: parsed.bookingDate,
                rawText: adminReplyText,
                purchaseValue: parsed.payment?.totalPrice || parsed.payment?.treatmentPrice || undefined,
                babies: parsed.babies || [],
                customerName: parsed.name,
                kecamatan: parsed.kec,
                kota: parsed.kota,
                kelurahan: parsed.kelurahan || undefined,
                address: parsed.address || undefined,
                source: 'ADMIN_OUTBOUND_AUTO_CAPTURE',
              });
            }
          }
        } catch (adminCaptureErr: any) {
          console.warn('[ADMIN OUTBOUND AUTO-CAPTURE ERROR]', adminCaptureErr.message);
        }

        // 6. CAPI Event Trigger dari Pesan Outbound WhatsApp HP (InitiateCheckout & Purchase)
        try {
          const { getTenantCapiFormats, fireCapiEvent } = await import('../../services/capi.service');
          const formats = await getTenantCapiFormats(resolvedTenantId);
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
              tenantId: resolvedTenantId,
              customData: { source: 'ADMIN_HP_FORM_SENT' },
            });
            console.log(`[CAPI] InitiateCheckout triggered from WhatsApp HP outbound message (${customer.phone}).`);
          }

          // B. Purchase detection jika pesan memuat format_purchase
          const purchaseKeyword = formats.formatPurchase.toLowerCase().trim();
          if (purchaseKeyword.length > 0 && replyLower.includes(purchaseKeyword)) {
            const { maybeFirePurchaseEvent } = await import('../../services/purchase-detection.service');
            await maybeFirePurchaseEvent({
              customer,
              conversation,
              text: adminReplyText,
              tenantId: resolvedTenantId,
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
