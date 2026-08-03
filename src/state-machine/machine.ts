import { ConversationState, Direction } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from './types';
import { handleGreetingState } from './handlers/greeting';
import { handleLocationState } from './handlers/location';
import { handleInterestState } from './handlers/interest';
import { handleHumanHandlingState } from './handlers/human';
import { handleLocationConfirmationState } from './handlers/location-confirmation';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { customerService } from '../services/customer.service';
import { TypingService, typingService } from '../services/typing.service';
import { wahaClient } from '../integrations/waha/client';
import { resolveGatewayForTenant } from '../integrations/whatsapp/factory';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getBrandIdentity } from '../config/brand';
import { LLM_HISTORY_LIMIT } from '../config/llm-context';
import { AiRouterConfigService } from '../config/ai-router-config';

export class ConversationStateMachine {
  private typingSvc: TypingService;

  constructor(typingSvc?: TypingService) {
    this.typingSvc = typingSvc || typingService;
  }

  /**
   * Core State Machine Engine:
   * Memproses pesan masuk, mengarahkan ke handler state yang sesuai, 
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

    // --- GATE 🚫: OPT-OUT MARKETING (Scope: WABA only, semua state / global handler) ---
    // Hanya aktif untuk tenant berprovider WABA (incomingMessage._provider = 'WABA').
    // Customer WAHA tidak punya marketing_opt_in, tidak terpengaruh.
    const rawInboundText = incomingMessage.text?.body || '';
    if ((incomingMessage as any)._provider === 'WABA') {
      const { wabaOptOutService } = await import('../services/waba-optout.service');
      const optOutDetect = wabaOptOutService.isOptOutMessage(rawInboundText);
      if (optOutDetect.matched) {
        console.log(`[WABA OPT-OUT] Customer ${customer.phone} sent "${optOutDetect.keyword}". Processing global opt-out (tenant=${tenantId}).`);
        try {
          const result = await wabaOptOutService.handleOptOut(customer.id, tenantId);
          console.log(`[WABA OPT-OUT] Customer ${customer.phone} opted out. Cancelled ${result.cancelledFollowUps} scheduled follow-ups.`);

          // Ack reply via gateway WABA (masih dalam 24h window percakapan aktif → teks bebas)
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
    // Skip jika pesan sudah di-log oleh BurstCoalesceService (_preLogged) — pesan asli
    // tercatat realtime saat diterima, job hasil merge tidak perlu mencatat ulang.
    const inboundContent = incomingMessage.text?.body || (incomingMessage.location ? `[LOCATION SHARE: Lat ${incomingMessage.location.latitude}, Lng ${incomingMessage.location.longitude}]` : '[MEDIA/UNKNOWN]');
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
    if (incomingMessage.text?.body && /Promo\[(\w+)\]/i.test(incomingMessage.text.body)) {
      incomingMessage.text.body = 'Halo';
    }

    // --- GATE KELAS 🏥: MEDICAL CONCERN DETECTION ENGINE ---
    const incomingText = incomingMessage.text?.body || '';
    const { MedicalDetectionService } = await import('../services/medical-detection.service');
    const medicalResult = MedicalDetectionService.detectMedicalConcern(incomingText);

    if (medicalResult.isMedical) {
      const { knowledgeBaseService } = await import('../services/knowledge.service');
      const approvedFaqMatch = await knowledgeBaseService.findMatchingFaq(incomingText, tenantId);

      // Exemption: If approved medical FAQ matches, allow bot to answer facts from approved FAQ
      if (approvedFaqMatch && (approvedFaqMatch as any).category === 'medical' && (approvedFaqMatch as any).status === 'APPROVED') {
        console.log(`[MEDICAL FAQ EXEMPTION] Approved medical FAQ found for "${incomingText}". Proceeding with official FAQ response.`);
      } else {
        const isHigh = medicalResult.severity === 'HIGH';
        console.log(`[MEDICAL ESCALATION] Severity ${medicalResult.severity} detected for customer ${customer.phone}. Symptoms: ${medicalResult.detectedSymptoms.join(', ')}`);

        // Set conversation to HUMAN_HANDLING with escalation_reason = 'medical_concern'
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

        // Dispatch Real-Time Alert HANYA ke Admin (Telegram / Emergency Log).
        // TIDAK ada template yang dikirim ke chat customer — customer diamkan total,
        // supaya Bidan/CS yang menggali lebih dalam & menyarankan secara manual.
        // Catatan: keyword medis bisa false-positive (customer hiperbola), jadi alert
        // hanya sebagai notifikasi admin, bukan penilaian darurat final.
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

    // --- PENGECEKAN IDLE TIMEOUT (env: IDLE_TIMEOUT_MS default 24 jam) ATAU TIMEOUT KONFIRMASI LOKASI (env: LOCATION_CONFIRMATION_TIMEOUT_MS default 5 menit) ---
    const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || '86400000', 10);
    const CONFIRMATION_TIMEOUT_MS = parseInt(process.env.LOCATION_CONFIRMATION_TIMEOUT_MS || '300000', 10); // 5 menit

    const lastMsgTime = activeConversation.last_message_at ? new Date(activeConversation.last_message_at).getTime() : 0;
    const isIdleTooLong = lastMsgTime > 0 && (Date.now() - lastMsgTime > IDLE_TIMEOUT_MS);
    const isConfirmationTimeout = activeConversation.current_state === ConversationState.LOCATION_CONFIRMED &&
      lastMsgTime > 0 && (Date.now() - lastMsgTime > CONFIRMATION_TIMEOUT_MS);

    if ((isIdleTooLong || isConfirmationTimeout) && activeConversation.current_state !== ConversationState.INITIAL && !activeConversation.is_human_handling) {
      if (isConfirmationTimeout) {
        console.log(`[CONFIRMATION TIMEOUT] Resetting conversation ${activeConversation.id} from LOCATION_CONFIRMED to INITIAL due to 5-minute inactivity.`);
      } else {
        console.log(`[IDLE TIMEOUT] Resetting conversation ${activeConversation.id} from ${activeConversation.current_state} to INITIAL.`);
      }
      
      // Clean up pending location jika di-reset
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
      activeConversation.current_state = ConversationState.INITIAL;
    }

    let result: StateHandlerResult;

    // 3. Routing ke State Handler yang sesuai
    const { AiModelConfigService } = await import('../config/ai-models.config');
    if (!AiModelConfigService.globalBotActive && !activeConversation.is_human_handling) {
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
    }

    // --- GATE 2 🧠: STRUCTURED NLU INTENT & ENTITY CLASSIFICATION ---
    let nluResult = undefined;
    let historyFormatted: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (!activeConversation.is_human_handling && incomingText) {
      try {
        const { NluClassifierService } = await import('../services/nlu-classifier.service');
        const { messageService } = await import('../services/message.service');
        const recentDbMsgs = await messageService.getRecentMessages(activeConversation.id, LLM_HISTORY_LIMIT, tenantId);
        historyFormatted = recentDbMsgs.map((m) => ({
          role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
          content: m.content || '',
        }));
        nluResult = await NluClassifierService.classifyMessage(incomingText, historyFormatted);
      } catch (err: any) {
        console.error('[NLU CLASSIFICATION ERROR IN MACHINE]:', err.message);
      }
    }

    // --- GATE 2.5 🧭: AI ROUTER ENGINE (default ON per tenant, shadow-first) ---
    // Konfigurasi per tenant (tenants.ai_router_enabled / ai_router_shadow_mode)
    // dimuat dari DB saat boot. Shadow mode hanya LOG perbandingan LLM router vs
    // fallback legacy — TIDAK mengubah keputusan state. Konsumsi penuh (full mode)
    // hanya saat shadow mode dimatikan lewat dashboard (setelah gate akurasi lolos).
    let routerDecision = undefined;
    const routerStateSnapshot = activeConversation.current_state;
    if (!activeConversation.is_human_handling && incomingText && AiRouterConfigService.isEnabled(tenantId)) {
      try {
        const { aiRouterService } = await import('../integrations/llm/ai-router');
        routerDecision = await aiRouterService.classify({
          currentState: activeConversation.current_state,
          conversationHistory: historyFormatted,
          lastCustomerMessage: incomingText,
        }, tenantId);
      } catch (err: any) {
        console.error('[AI ROUTER ERROR IN MACHINE]:', err.message);
      }

      // UNKNOWN berulang → eskalasi human otomatis (HANYA mode konsumsi penuh).
      // Shadow mode TIDAK boleh mengubah keputusan produksi sama sekali.
      if (routerDecision?.response && !AiRouterConfigService.isShadowMode(tenantId)) {
        try {
          const { handleRouterResult } = await import('../services/ai-router-evaluation.service');
          const processed = await handleRouterResult(activeConversation, routerDecision.response, tenantId);
          if (processed.needs_human_escalation && processed.escalation_reason === 'UNKNOWN_REPEATED') {
            console.warn(`[UNKNOWN REPEATED ESCALATION] Customer ${customer.phone} auto-escalated. ${processed.reasoning_note}`);
            await conversationService.escalateToHumanHandling(
              activeConversation,
              customer.phone,
              processed.reasoning_note || 'UNKNOWN berulang dalam thread ini',
              tenantId,
              'unknown_repeated'
            );
          }
        } catch (err: any) {
          console.error('[AI ROUTER UNKNOWN ESCALATION ERROR]:', err.message);
        }
      }
    }

    const handlerCtx = { ...ctx, tenantId, conversation: activeConversation, nluResult, routerDecision };
    if (activeConversation.is_human_handling) {
      result = await handleHumanHandlingState(handlerCtx);

    } else {
      switch (activeConversation.current_state) {
        case ConversationState.INITIAL:
          result = await handleGreetingState(handlerCtx);
          break;

        case ConversationState.AWAITING_LOCATION:
          result = await handleLocationState(handlerCtx);
          break;

        case ConversationState.LOCATION_CONFIRMED:
          result = await handleLocationConfirmationState(handlerCtx);
          break;

        case ConversationState.AWAITING_INTEREST:
          result = await handleInterestState(handlerCtx);
          break;

        case ConversationState.RESERVATION_SENT:
        case ConversationState.COMPLETED:
          result = await handleInterestState(handlerCtx);
          break;

        case ConversationState.HUMAN_HANDLING:
          result = await handleHumanHandlingState(handlerCtx);
          break;

        default:
          result = await handleGreetingState(handlerCtx);
          break;
      }
    }

    // --- OBSERVABILITY: log evaluasi router (shadow/full) ke ai_router_evaluations ---
    // "Match" dihitung dari keputusan akhir (intent + escalation), bukan exact-field.
    if (routerDecision?.response) {
      try {
        const { logRouterEvaluation, mapLegacyDecisionToIntent } = await import('../services/ai-router-evaluation.service');
        const wasMedicalDetected = medicalResult.isMedical;
        const wasScheduleQuestion =
          !wasMedicalDetected &&
          result.nextState === ConversationState.HUMAN_HANDLING &&
          (nluResult?.intents?.includes('ask_schedule') ||
            (/\b(jadwal|slot|tanggal|hari|jam)\b/i.test(incomingText) &&
              /\b(senin|selasa|rabu|kamis|jumat|sabtu|minggu|besok|lusa)\b/i.test(incomingText)));
        const wasFaqAnswered =
          !wasMedicalDetected &&
          !wasScheduleQuestion &&
          result.shouldSendReply === true &&
          !!result.replyText &&
          (result.nextState === routerStateSnapshot || result.nextState === ConversationState.AWAITING_INTEREST);

        await logRouterEvaluation({
          customerPhone: customer.phone,
          messageText: incomingText,
          currentState: routerStateSnapshot,
          llmResult: routerDecision.response,
          usedFallback: routerDecision.source === 'fallback',
          legacy: mapLegacyDecisionToIntent({
            stateBefore: routerStateSnapshot,
            stateAfter: result.nextState,
            wasMedicalDetected,
            wasScheduleQuestion,
            wasFaqAnswered,
          }),
        });
      } catch (err: any) {
        console.error('[AI ROUTER EVALUATION LOG ERROR]:', err.message);
      }
    }

    // 4. Update Conversation State di Database
    await conversationService.updateConversationState(
      activeConversation.id,
      {
        currentState: result.nextState,
        isHumanHandling: result.isHumanHandling,
      },
      tenantId
    );

    // --- TEMPORARY SAFETY NET: INTERCEPT & APPROVE VIA TERMINAL ---
    if (process.env.TERMINAL_APPROVAL_ENABLED === 'true' && process.env.NODE_ENV !== 'test' && result.shouldSendReply && result.replyText) {
      const finalReply = await this.promptTerminal(
        result.replyText,
        incomingMessage.text?.body || (incomingMessage.location ? '[SHARE LOCATION]' : '[MEDIA]'),
        customer.phone
      );
      if (finalReply === null) {
        result.shouldSendReply = false;
      } else {
        result.replyText = finalReply;
      }
    }

    // 5. Kirim Balasan Otomatis via Typing Simulation Service jika required
    if (result.shouldSendReply && result.replyText) {
      // Memulai alur simulasi ngetik manusia: sendSeen -> reading delay -> per bubble (startTyping -> typing delay -> stopTyping -> sendText)
      const chatId = (incomingMessage as any).chatId || `${customer.phone}@c.us`;
      const resultHuman = await this.typingSvc.simulateHumanReply({
        chatId,
        incomingMessageId: incomingMessage.id,
        incomingText: incomingMessage.text?.body || '',
        replyText: result.replyText,
      });

      if (resultHuman.success) {
        // Audit Log Pesan Outbound (Keluar)
        await messageService.logMessage({
          tenantId,
          conversationId: activeConversation.id,
          direction: Direction.OUTBOUND,
          content: result.replyText,
        });

        // Kirim Pricelist Image jika diinstruksikan oleh state handler (hanya 1x per customer)
        if (result.sendPricelistImage) {
          try {
            const { prisma } = await import('../db/client');
            const dbCustomer = await prisma.customer.findUnique({
              where: { id: customer.id }
            });
            const alreadySent = dbCustomer ? dbCustomer.pricelist_sent : false;

            if (!alreadySent) {
              const pricelistUrl = process.env.CLINIC_PRICELIST_IMAGE_URL || 'assets/pricelist_spa.jpg';
              await wahaClient.sendImage(chatId, pricelistUrl, `Pricelist ${getBrandIdentity().businessName} 🌸`);

              if (dbCustomer) {
                await prisma.customer.update({
                  where: { id: customer.id },
                  data: { pricelist_sent: true }
                });
                customer.pricelist_sent = true;
              }
            } else {
              console.log(`[PRICELIST SKIPPED] Pricelist image was already sent to customer ${customer.phone}. Skipping duplicate send.`);
            }
          } catch (dbErr: any) {
            console.error('[PRICELIST ERROR] Failed to query/update pricelist_sent:', dbErr.message);
            const pricelistUrl = process.env.CLINIC_PRICELIST_IMAGE_URL || 'assets/pricelist_spa.jpg';
            await wahaClient.sendImage(chatId, pricelistUrl, `Pricelist ${getBrandIdentity().businessName} 🌸`);
          }
        }
      }
    }

    return result;
  }

  private promptTerminal(proposedReply: string, incomingText: string, phone: string): Promise<string | null> {
    return new Promise((resolve) => {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      console.log('\n============================================================');
      console.log(`🌸 [SAFETY NET INTERCEPTED]`);
      console.log(`   Customer: ${phone}`);
      console.log(`   Pesan Masuk: "${incomingText}"`);
      console.log(`------------------------------------------------------------`);
      console.log(`   Proposed Bot Reply:`);
      console.log(proposedReply);
      console.log(`------------------------------------------------------------`);
      console.log(`Pilihan:`);
      console.log(`  - Tekan [Enter] atau ketik 'y' untuk SETUJU dan kirim`);
      console.log(`  - Ketik 'n' untuk BATALKAN pengiriman`);
      console.log(`  - Ketik kalimat kustom Anda di bawah ini untuk OVERRIDE balasan`);
      console.log('============================================================');

      rl.question('Masukkan pilihan / pesan kustom Anda: ', (answer: string) => {
        rl.pause(); // Pause stream instead of closing, preserving process.stdin for subsequent inputs and avoiding tsx watch EOF crash
        const clean = answer.trim();
        if (clean === '' || clean.toLowerCase() === 'y') {
          resolve(proposedReply);
        } else if (clean.toLowerCase() === 'n') {
          resolve(null);
        } else {
          resolve(clean);
        }
      });
    });
  }
}

export const stateMachine = new ConversationStateMachine();
