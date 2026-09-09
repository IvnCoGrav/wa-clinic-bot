import { ConversationState, Direction } from '@prisma/client';
import { prisma } from '../db/client';
import { StateHandlerContext, StateHandlerResult } from './types';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { customerService } from '../services/customer.service';
import { TypingService, typingService } from '../services/typing.service';
import { resolveGatewayForTenant } from '../integrations/whatsapp/factory';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getBrandIdentity } from '../config/brand';
import { LLM_HISTORY_LIMIT } from '../config/llm-context';
import { isDummyOrTestContact } from '../utils/dummy-filter';

export class ConversationStateMachine {
  private typingSvc: TypingService;

  constructor(typingSvc?: TypingService) {
    this.typingSvc = typingSvc || typingService;
  }

  /**
   * Core State Machine Engine:
   * Memproses pesan masuk via Context-Grounded Slot Engine,
   * dan mengirim balasan otomatis MENGGUNAKAN SIMULASI MENGETIK (typingService).
   */
  public async processMessage(ctx: StateHandlerContext): Promise<StateHandlerResult> {
    const { customer, conversation, incomingMessage } = ctx;
    const tenantId = ctx.tenantId || customer.tenant_id || DEFAULT_TENANT_ID;

    // --- GATE 🛑: EMERGENCY OUTBOUND CUT-OFF (KILL-SWITCH GUARD) ---
    const { whatsappProviderService } = await import('../services/whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      console.log(`[STATE MACHINE CUT-OFF] Outbound Cut-Off is ACTIVE for tenant ${tenantId}. Skipping bot processing for customer ${customer.phone}.`);
      return {
        nextState: conversation.current_state,
        shouldSendReply: false,
      };
    }

    // --- GATE KELAS 🔴: BLOCKED CUSTOMER ---
    if (customer.status === 'blocked') {
      console.warn(`[SECURITY WARNING] [BLOCKED CUSTOMER] Phone ${customer.phone} is blocked. Bypassing processing.`);
      return {
        nextState: conversation.current_state,
        shouldSendReply: false,
      };
    }

    // --- GATE 🛡️: HUMAN HANDLING ACTIVE (CS TAKEOVER GUARD) ---
    if (conversation.is_human_handling) {
      console.log(`[STATE MACHINE ABORT] Conversation ${conversation.id} for customer ${customer.phone} is in HUMAN_HANDLING mode. Skipping bot auto-reply.`);
      try {
        const { humanBackgroundEnrichmentService } = await import('../services/human-background-enrichment.service');
        humanBackgroundEnrichmentService.enrichAsync({ customer, conversation, incomingMessage, history: [] } as any, tenantId);
      } catch {}
      return {
        nextState: conversation.current_state,
        shouldSendReply: false,
      };
    }

    // --- GATE ✨: CUSTOMER SLASH COMMANDS (/reset, /state, /mulai) ---
    const { commandService } = await import('../services/command.service');
    const cmdResult = await commandService.tryHandle(ctx, tenantId);
    if (cmdResult) {
      const cmdChatId = `${customer.phone}@c.us`;
      const cmdSent = await this.typingSvc.simulateHumanReply({
        chatId: cmdChatId,
        incomingMessageId: incomingMessage.id,
        incomingText: incomingMessage.text?.body || '',
        replyText: cmdResult.replyText,
      });
      if (cmdSent.success) {
        await messageService.logMessage({
          tenantId,
          conversationId: cmdResult.conversationId,
          direction: Direction.OUTBOUND,
          content: cmdResult.replyText,
        });
      }
      return {
        nextState: cmdResult.nextState ?? ConversationState.INITIAL,
        shouldSendReply: false,
      };
    }

    // --- GATE 🚫: OPT-OUT MARKETING (WABA only) ---
    const rawInboundText = incomingMessage.text?.body || '';
    if ((incomingMessage as any)._provider === 'WABA') {
      const { wabaOptOutService } = await import('../services/waba-optout.service');
      const optOutDetect = wabaOptOutService.isOptOutMessage(rawInboundText);
      if (optOutDetect.matched) {
        console.log(`[WABA OPT-OUT] Customer ${customer.phone} sent "${optOutDetect.keyword}". Processing global opt-out (tenant=${tenantId}).`);
        try {
          const result = await wabaOptOutService.handleOptOut(customer.id, tenantId);
          console.log(`[WABA OPT-OUT] Customer ${customer.phone} opted out. Cancelled ${result.cancelledFollowUps} scheduled follow-ups.`);

          const gateway = await resolveGatewayForTenant(tenantId);
          const ackText = wabaOptOutService.getAckMessage();
          const sendResult = await gateway.sendTextMessage(customer.phone, ackText);

          await messageService.logMessage({
            tenantId,
            conversationId: conversation.id,
            direction: Direction.OUTBOUND,
            content: ackText,
            waMessageId: sendResult.messageId,
          });
        } catch (optOutErr: any) {
          console.error('[WABA OPT-OUT ERROR] Failed to process opt-out:', optOutErr.message);
        }
        return {
          nextState: conversation.current_state,
          shouldSendReply: false,
        };
      }
    }

    // 1. Audit Log Pesan Inbound (Masuk)
    const hasValidLocation = !!(incomingMessage.location && Number((incomingMessage.location as any).latitude) !== 0 && Number((incomingMessage.location as any).longitude) !== 0);
    const hasMedia = !!(incomingMessage.media || (incomingMessage as any).type === 'image');
    const loc = incomingMessage.location as any;
    const inboundContent = (incomingMessage as any).originalText
      || incomingMessage.text?.body
      || (hasMedia ? (incomingMessage.media?.caption ? `[IMAGE: ${incomingMessage.media.caption}]` : '[MEDIA]') : hasValidLocation ? `[LOCATION SHARE: Lat ${loc.latitude}, Lng ${loc.longitude}]` : '[MEDIA/UNKNOWN]');
    if (!(incomingMessage as any)._preLogged) {
      await messageService.logMessage({
        tenantId,
        conversationId: conversation.id,
        direction: Direction.INBOUND,
        content: inboundContent,
        waMessageId: incomingMessage.id,
        payloadRaw: incomingMessage,
      });
    }

    // In-memory rewriting for Promo[CODE] greeting trigger.
    // STORAGE vs INFERENCE: teks asli (originalText) sudah di-log utuh di atas untuk
    // DB audit trail & Live Chat; strip tag iklan hanya untuk lapisan inferensi
    // (cleanTextForAi) agar payload LLM bersih.
    if (!(incomingMessage as any).originalText && incomingMessage.text?.body) {
      (incomingMessage as any).originalText = incomingMessage.text.body;
    }
    if (incomingMessage.text?.body && /(?:Promo\s*)?\[\s*[\w\s]{2,10}?\s*\]/i.test(incomingMessage.text.body)) {
      const stripped = incomingMessage.text.body.replace(/(?:Promo\s*)?\[\s*[\w\s]{2,10}?\s*\]\s*/gi, '').trim() || 'Halo';
      (incomingMessage as any).cleanTextForAi = stripped;
      incomingMessage.text.body = stripped;
    } else if (incomingMessage.text?.body) {
      (incomingMessage as any).cleanTextForAi = (incomingMessage as any).cleanTextForAi || incomingMessage.text.body;
    }

    // --- GATE KELAS 🏥: MEDICAL CONCERN DETECTION ENGINE ---
    const incomingText = (incomingMessage as any).cleanTextForAi || incomingMessage.text?.body || '';
    const bubbleCorrelationId = incomingMessage.id || `msg_${customer.phone}_${Date.now()}`;
    const { MedicalDetectionService } = await import('../services/medical-detection.service');
    const medicalResult = MedicalDetectionService.detectMedicalConcern(incomingText);

    if (medicalResult.isMedical) {
      const { knowledgeBaseService } = await import('../services/knowledge.service');
      const approvedFaqMatch = await knowledgeBaseService.findMatchingFaq(incomingText, tenantId);

      const isLegacy = !!(customer as any).is_legacy_source;
      let hasPriorConfirmed = false;
      try {
        const confirmedCount = await prisma.reservation.count({
          where: { customer_id: customer.id, status: { in: ['confirmed', 'completed'] }, tenant_id: tenantId },
        });
        hasPriorConfirmed = confirmedCount > 0;
      } catch (err: any) {}

      const allowFaqExemption = !isLegacy && !hasPriorConfirmed;

      if (allowFaqExemption && approvedFaqMatch && (approvedFaqMatch as any).category === 'medical' && (approvedFaqMatch as any).status === 'APPROVED') {
        console.log(`[MEDICAL FAQ EXEMPTION] Approved medical FAQ found for new customer "${incomingText}". Proceeding with official FAQ response.`);
      } else {
        const isHigh = medicalResult.severity === 'HIGH';
        console.log(`[STRICT MEDICAL ESCALATION] Severity ${medicalResult.severity} detected for customer ${customer.phone}. Symptoms: ${medicalResult.detectedSymptoms.join(', ')}`);

        conversation.is_human_handling = true;
        conversation.human_handling_since = new Date();
        conversation.escalation_reason = 'medical_concern';

        await conversationService.escalateToHumanHandling(
          conversation,
          customer.phone,
          `Kondisi medis terdeteksi (Severity: ${medicalResult.severity})`,
          tenantId,
          'medical_concern'
        );

        const isSandbox = Boolean(customer.is_sandbox_test || isDummyOrTestContact(customer.phone, customer.name, customer.is_sandbox_test));
        if (!isSandbox) {
          try {
            const { AlertService, AlertType, AlertSeverity } = await import('../services/alert.service');
            const alertService = new AlertService();
            await alertService.notifyAlert({
              type: isHigh ? AlertType.MEDICAL_EMERGENCY_HIGH : AlertType.MEDICAL_CONCERN_MEDIUM,
              severity: isHigh ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
              message: `[MEDICAL ALERT ${medicalResult.severity}] Customer: ${customer.phone}. Symptoms: ${medicalResult.detectedSymptoms.join(', ')}. Text: "${incomingText}"`,
              metadata: {
                customerPhone: customer.phone,
                detectedSymptoms: medicalResult.detectedSymptoms,
                incomingText,
              },
            });
          } catch (alertErr: any) {
            console.error('[EMERGENCY LOG FALLBACK] Failed to trigger alert for medical emergency:', alertErr.message);
          }
        }

        return {
          nextState: ConversationState.HUMAN_HANDLING,
          shouldSendReply: false,
          isHumanHandling: true,
        };
      }
    }

    // 2. Cek Auto-Release Timeout terlebih dahulu jika sedang Human Handling
    const autoRelease = conversationService.checkAndApplyAutoRelease(conversation, tenantId);
    let activeConversation = autoRelease.updatedConversation;

    // --- IDLE TIMEOUT ---
    const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || '86400000', 10);
    const CONFIRMATION_TIMEOUT_MS = parseInt(process.env.LOCATION_CONFIRMATION_TIMEOUT_MS || '300000', 10);

    const lastMsgTime = activeConversation.last_message_at ? new Date(activeConversation.last_message_at).getTime() : 0;
    const isIdleTooLong = lastMsgTime > 0 && (Date.now() - lastMsgTime > IDLE_TIMEOUT_MS);
    const isConfirmationTimeout = activeConversation.current_state === ConversationState.LOCATION_CONFIRMED &&
      lastMsgTime > 0 && (Date.now() - lastMsgTime > CONFIRMATION_TIMEOUT_MS);

    if ((isIdleTooLong || isConfirmationTimeout) && activeConversation.current_state !== ConversationState.INITIAL && !activeConversation.is_human_handling) {
      console.log(`[TIMEOUT RESET] Resetting conversation ${activeConversation.id} from ${activeConversation.current_state} to INITIAL.`);
      await customerService.clearPendingLocation(customer.id, tenantId);
      customer.pending_kelurahan = null;
      customer.pending_kecamatan = null;
      customer.pending_kota = null;
      customer.pending_lat = null;
      customer.pending_lng = null;

      await conversationService.updateConversationState(
        activeConversation.id,
        {
          currentState: ConversationState.INITIAL,
          previousState: null,
          locationAttempts: 0,
        },
        tenantId
      );
      await conversationService.updateLastDiscussedTreatment(activeConversation.id, tenantId, null as any).catch(() => {});
      activeConversation.last_discussed_treatment = null;
      activeConversation.current_state = ConversationState.INITIAL;
    }

    // 3. Cek Global Bot Deactivation
    const { AiModelConfigService } = await import('../config/ai-models.config');
    const isSandboxTest = Boolean(customer.is_sandbox_test);
    if (!AiModelConfigService.isBotActive(tenantId) && !activeConversation.is_human_handling && !isSandboxTest) {
      console.log(`[GLOBAL BOT DEACTIVATED] Bypassing bot responder and routing customer ${customer.phone} directly to human handling.`);
      await conversationService.escalateToHumanHandling(
        activeConversation,
        customer.phone,
        'Global bot disabled',
        tenantId,
        'global_bot_disabled'
      );
      activeConversation.is_human_handling = true;
      activeConversation.current_state = ConversationState.HUMAN_HANDLING;
      return {
        nextState: ConversationState.HUMAN_HANDLING,
        shouldSendReply: false,
        isHumanHandling: true,
      };
    }

    // --- 📋 GERBANG UTAMA: FORMULIR RESERVASI MASUK (DETERMINISTIK) ---
    // SOP kritis: formulir reservasi yang diisi customer diparsing & disimpan ke DB secara deterministik
    // sebelum delegasi ke engine percakapan (V3 / Slot Engine).
    const { isReservationFormMessage, parseReservationText } = await import('../utils/reservation-text-parser');
    const lowerFormText = (incomingText || '').toLowerCase().trim();
    const { getTenantCapiFormats } = await import('../services/capi.service');
    const tenantFormats = await getTenantCapiFormats(tenantId);
    const checkoutKeyword = (tenantFormats.formatCheckout || '').toLowerCase();
    const tenantCheckoutHit =
      checkoutKeyword.length > 0 && lowerFormText.includes(checkoutKeyword.replace(/\s+/g, ' ').trim());
    const isFormSubmission =
      isReservationFormMessage(incomingText) ||
      tenantCheckoutHit ||
      lowerFormText.includes('berikut list untuk reservasi') ||
      (lowerFormText.includes('pilihan treatment') && (lowerFormText.includes('nama bunda') || lowerFormText.includes('alamat')));

    if (isFormSubmission) {
      const parseResult = parseReservationText(incomingText);
      if (parseResult.success && parseResult.reservation) {
        const parsed = parseResult.reservation;
        try {
          const { reservationCoreService } = await import('../services/reservation-core.service');
          await reservationCoreService.saveReservation({
            tenantId,
            customerId: customer.id,
            chatId: incomingMessage.chatId || `${customer.phone}@c.us`,
            bookingDate: parsed.bookingDate,
            treatmentCategory: parsed.treatmentCategory,
            treatmentDetail: parsed.treatmentDetail,
            rawText: incomingText,
            babies: parsed.babies || [],
            customerName: parsed.name,
            kecamatan: parsed.kec,
            kota: parsed.kota,
            kelurahan: parsed.address,
            source: 'BOT',
            status: 'pending',
          });

          try {
            const { fireCapiEvent } = await import('../services/capi.service');
            fireCapiEvent({
              eventName: 'InitiateCheckout',
              customer,
              tenantId,
              customData: {
                source: 'CUSTOMER_FORM_SUBMITTED',
                treatment: parsed.treatmentDetail,
              },
            });
          } catch (capiErr: any) {
            console.warn('[CAPI] InitiateCheckout (customer form submit) skipped:', capiErr.message);
          }
        } catch (dbErr: any) {
          console.error(`[MACHINE FORM] Gagal simpan reservasi customer ${customer.phone} (${parsed.name}):`, dbErr.message);
        }

        // Simpan nama kontak customer: "Bunda {nama} {kecamatan}"
        const customerName = parsed.name?.trim();
        if (customerName && customerName.length > 0 && customerName.toLowerCase() !== 'bunda') {
          const kecamatan = parsed.kec || customer.kecamatan || '';
          const contactName = `Bunda ${customerName}${kecamatan ? ` ${kecamatan}` : ''}`.trim();
          try {
            const { customerService } = await import('../services/customer.service');
            await customerService.updateCustomerName(customer.id, contactName, tenantId);
          } catch (nameErr: any) {
            console.warn('[MACHINE CONTACT SAVE] Failed to update customer name:', nameErr.message);
          }
        }

        // Eskalasi ke Human Handling
        await conversationService.escalateToHumanHandling(
          activeConversation,
          customer.phone,
          `Formulir reservasi telah diisi oleh customer: "${parsed.treatmentDetail}"`,
          tenantId,
          'reservation_submitted'
        );

        activeConversation.is_human_handling = true;
        activeConversation.current_state = ConversationState.HUMAN_HANDLING;

        const { TEMPLATES } = await import('../config/persona');
        const shareNote = customer.share_location_sent ? '' : `\n\n${TEMPLATES.askShareLocation()}`;
        const replyText = `Baik Bunda, data reservasi sudah kami terima ya bund. Kami cek dulu ya bund. 😊${shareNote}`;

        return {
          nextState: ConversationState.HUMAN_HANDLING,
          replyText,
          shouldSendReply: true,
          isHumanHandling: true,
          aiReasoning: 'Customer submitted valid reservation form -> Saved reservation to DB & escalated to human handling.',
        };
      } else {
        const hasFormHeaderOrColonFields =
          lowerFormText.includes('list untuk reservasi') ||
          lowerFormText.includes('format reservasi') ||
          lowerFormText.includes('form reservasi') ||
          lowerFormText.includes('form booking') ||
          lowerFormText.includes('pilihan treatment (') ||
          (lowerFormText.includes('nama') && lowerFormText.includes(':') && (lowerFormText.includes('alamat') || lowerFormText.includes('treatment')));

        if (hasFormHeaderOrColonFields) {
          const missing = parseResult.missingFields || [];
          const missingStr = missing.join(', ');
          const incompleteReply = `Mohon maaf Bunda, mohon diisi bagian ${missingStr} pada list reservasi ya bund. Terima kasih! 😊`;
          return {
            nextState: ConversationState.RESERVATION_SENT,
            replyText: incompleteReply,
            shouldSendReply: true,
            aiReasoning: 'Customer submitted incomplete reservation form -> Prompted to fill missing fields.',
          };
        }
      }
    }

    // --- 🚀 4. EKSEKUSI UTAMA: V3 AGENTIC (DEFAULT) / V2 SLOT-FILLING ENGINE ---
    const recentDbMsgs = await messageService.getRecentMessages(activeConversation.id, LLM_HISTORY_LIMIT, tenantId);
    const historyFormatted = recentDbMsgs.map((m) => ({
      role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
      content: m.content || '',
    }));
    const handlerCtx = { ...ctx, tenantId, conversation: activeConversation, history: historyFormatted, bubbleCorrelationId };
    
    let result: StateHandlerResult;
    // Eksekusi Tunggal V3 Agent Runner (V2 slot-engine telah didekomisioning)
    const { V3AgentRunner } = await import('../v3/agent/agent-runner');
    let effectiveInboundText = incomingText;
    if (hasValidLocation && loc) {
      effectiveInboundText = `[Shared Location: ${loc.latitude}, ${loc.longitude}]`;
    } else if (!effectiveInboundText && inboundContent) {
      effectiveInboundText = inboundContent;
    }

    const v3Result = await V3AgentRunner.processMessage({
      tenantId,
      customerId: customer.id,
      conversationId: activeConversation.id,
      phone: customer.phone,
      chatId: `${customer.phone}@c.us`,
      incomingText: effectiveInboundText,
      originalText: (incomingMessage as any).originalText || inboundContent,
      history: historyFormatted,
      skipDbLogging: true,
    });

    if (v3Result.isEscalated) {
      activeConversation.is_human_handling = true;
      activeConversation.current_state = ConversationState.HUMAN_HANDLING;
      await conversationService.escalateToHumanHandling(
        activeConversation,
        customer.phone,
        'Eskalasi otomatis oleh V3 Agent',
        tenantId,
        'v3_agent_escalation'
      );
    }

    result = {
      nextState: v3Result.isEscalated
        ? ConversationState.HUMAN_HANDLING
        : (v3Result.nextState || activeConversation.current_state),
      replyText: v3Result.replyText,
      shouldSendReply: v3Result.shouldSendReply && !!v3Result.replyText,
      isHumanHandling: v3Result.isEscalated,
      metadata: {
        engine: 'V3_AGENT',
        tokens: v3Result.tokens,
        costIdr: v3Result.costIdr,
        executedTools: (v3Result.executedTools || []).map((t) => ({ name: t.name, args: t.args })),
        toolCount: (v3Result.executedTools || []).length,
        reasoning: v3Result.reasoning,
        retrievedChunksCount: (v3Result.retrievedChunks || []).length,
      },
    };

    // 4. Update Conversation State jika berubah
    if (result.nextState !== activeConversation.current_state) {
      await conversationService.updateConversationState(
        activeConversation.id,
        {
          currentState: result.nextState,
          previousState: activeConversation.current_state,
        },
        tenantId
      );
    }

    // 5. Update timestamp pesan terakhir pada percakapan
    try {
      await prisma.conversation?.update?.({
        where: { id: activeConversation.id },
        data: { last_message_at: new Date() },
      });
    } catch {}

    // --- 6. PENGIRIMAN BALASAN (JIKA DIPERLUKAN) ---
    if (result.shouldSendReply && result.replyText) {
      const incomingBody = incomingMessage.text?.body || '';

      // --- STEP 1: SEND PRICELIST IMAGE FIRST (JIKA DIAKTIFKAN) ---
      if (result.sendPricelistImage) {
        let sendOk = false;
        let sentMessageId: string | undefined = undefined;
        try {
          const { resolvePricelistImageTarget } = await import('../services/pricelist-config.service');
          const gateway = await resolveGatewayForTenant(tenantId);
          const pricelistTarget = await resolvePricelistImageTarget(tenantId, gateway.providerType);
          const caption = result.pricelistCaption || `Pricelist ${getBrandIdentity().businessName} 🌸`;

          messageService.registerInFlightBotOutbound(customer.phone, caption, tenantId, 60000);
          messageService.registerInFlightBotOutbound(customer.phone, `[IMAGE: ${caption}]`, tenantId, 60000);
          messageService.registerInFlightBotOutbound(customer.phone, '[IMAGE]', tenantId, 60000);

          if (!pricelistTarget) {
            console.error(`[PRICELIST ERROR] Tidak bisa resolve gambar pricelist untuk tenant ${tenantId} & provider ${gateway.providerType}.`);
          } else if (customer.is_sandbox_test) {
            console.log(`[SANDBOX OUTBOUND] sendImageMessage -> phone: ${customer.phone} | target: "${pricelistTarget}" | caption: "${caption}"`);
            sendOk = true;
          } else {
            const sendResult = await gateway.sendImageMessage(customer.phone, pricelistTarget, caption);
            sendOk = sendResult.success;
            sentMessageId = sendResult.messageId;
          }

          if (sendOk) {
            try {
              await prisma.customer?.update?.({
                where: { id: customer.id },
                data: { pricelist_sent: true },
              });
            } catch {}
            customer.pricelist_sent = true;

            try {
              const path = await import('path');
              const rawUrl = await (await import('../services/pricelist-config.service')).getPricelistImageUrl(tenantId);
              let mediaUrl = rawUrl;
              if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://') && !rawUrl.startsWith('/media/')) {
                const filename = path.basename(rawUrl);
                mediaUrl = `/media/asset/${filename}`;
              }
              await messageService.logMessage({
                tenantId,
                conversationId: conversation.id,
                direction: Direction.OUTBOUND,
                content: caption || `[IMAGE: Pricelist ${getBrandIdentity().businessName}]`,
                waMessageId: sentMessageId,
                senderType: 'BOT',
                senderName: `Bot (${getBrandIdentity().businessName})`,
                payloadRaw: {
                  type: 'image',
                  caption: caption || `Pricelist ${getBrandIdentity().businessName}`,
                  media: {
                    url: mediaUrl,
                    hdUrl: mediaUrl,
                    caption,
                    mimetype: 'image/jpeg',
                  },
                },
              });
            } catch (logErr: any) {
              console.warn('[PRICELIST LOG ERROR] Failed to log pricelist message to DB:', logErr.message);
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 800));
        } catch (dbErr: any) {
          console.error('[PRICELIST ERROR] Failed to send pricelist image:', dbErr.message);
        }
      }

      // --- STEP 2: SEND TEXT REPLY DENGAN SIMULASI MENGETIK ---
      const chatId = `${customer.phone}@c.us`;
      const resultHuman = await this.typingSvc.simulateHumanReply({
        chatId,
        incomingMessageId: incomingMessage.id,
        incomingText: incomingBody,
        replyText: result.replyText,
        tenantId,
        shouldAbort: async () => {
          try {
            const freshConv = await conversationService.getOrCreateConversation(customer.id, tenantId);
            return !!freshConv?.is_human_handling;
          } catch {
            return false;
          }
        },
      });

      const reason = result.aiReasoning ? { aiReasoning: result.aiReasoning } : undefined;
      const v3Meta = (result as any).metadata;
      const outboundPayload: any = { ...(reason || {}) };
      if (v3Meta) outboundPayload.v3Execution = v3Meta;
      if (!resultHuman.success) outboundPayload.sendError = resultHuman.error || 'WAHA sendText failed';
      await messageService.logMessage({
        tenantId,
        conversationId: activeConversation.id,
        direction: Direction.OUTBOUND,
        content: result.replyText,
        payloadRaw: Object.keys(outboundPayload).length > 0 ? outboundPayload : undefined,
        deliveryStatus: resultHuman.success ? 'sent' : 'failed',
        metaErrorCode: resultHuman.success ? undefined : 'WAHA_SEND_TEXT',
        metaErrorDesc: resultHuman.success ? undefined : resultHuman.error || 'WAHA sendText failed',
      });
    }

    return result;
  }
}

export const stateMachine = new ConversationStateMachine();
