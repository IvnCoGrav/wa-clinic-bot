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
import { processSlotEngine } from '../slot-engine/slot-engine';

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

    // In-memory rewriting for Promo[CODE] greeting trigger
    if (incomingMessage.text?.body && /(?:Promo\s*)?\[\s*[\w\s]{2,10}?\s*\]/i.test(incomingMessage.text.body)) {
      incomingMessage.text.body = incomingMessage.text.body.replace(/(?:Promo\s*)?\[\s*[\w\s]{2,10}?\s*\]\s*/gi, '').trim() || 'Halo';
    }

    // --- GATE KELAS 🏥: MEDICAL CONCERN DETECTION ENGINE ---
    const incomingText = incomingMessage.text?.body || '';
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
          where: { customer_id: customer.id, status: 'confirmed', tenant_id: tenantId },
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

    // --- 🚀 4. EKSEKUSI UTAMA: CONTEXT-GROUNDED SLOT-FILLING ENGINE ---
    const recentDbMsgs = await messageService.getRecentMessages(activeConversation.id, LLM_HISTORY_LIMIT, tenantId);
    const historyFormatted = recentDbMsgs.map((m) => ({
      role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
      content: m.content || '',
    }));
    const handlerCtx = { ...ctx, tenantId, conversation: activeConversation, history: historyFormatted, bubbleCorrelationId };
    
    const result: StateHandlerResult = await processSlotEngine(handlerCtx);

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
      await messageService.logMessage({
        tenantId,
        conversationId: activeConversation.id,
        direction: Direction.OUTBOUND,
        content: result.replyText,
        payloadRaw: !resultHuman.success
          ? { ...(reason || {}), sendError: resultHuman.error || 'WAHA sendText failed' }
          : reason,
        deliveryStatus: resultHuman.success ? 'sent' : 'failed',
        metaErrorCode: resultHuman.success ? undefined : 'WAHA_SEND_TEXT',
        metaErrorDesc: resultHuman.success ? undefined : resultHuman.error || 'WAHA sendText failed',
      });
    }

    return result;
  }
}

export const stateMachine = new ConversationStateMachine();
