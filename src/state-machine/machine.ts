import { ConversationState, Direction } from '@prisma/client';
import { prisma } from '../db/client';
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
import { resolveGatewayForTenant } from '../integrations/whatsapp/factory';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getBrandIdentity } from '../config/brand';
import { LLM_HISTORY_LIMIT } from '../config/llm-context';
import { AiRouterConfigService } from '../config/ai-router-config';
import { formatIslamicReply } from './utils/islamic-greeting-helper';

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

    // --- GATE 🛡️: HUMAN HANDLING ACTIVE (CS TAKEOVER GUARD) ---
    // Jika percakapan sedang di-handle admin/CS, batalkan auto-reply bot
    if (conversation.is_human_handling) {
      console.log(`[STATE MACHINE ABORT] Conversation ${conversation.id} for customer ${customer.phone} is in HUMAN_HANDLING mode. Skipping bot auto-reply.`);
      return {
        nextState: conversation.current_state,
        shouldSendReply: false,
      };
    }

    // --- GATE ✨: CUSTOMER SLASH COMMANDS (/reset, /state, /mulai) ---
    // Dieksekusi SEBELUM inbound logging, medical detection, NLU & AI router supaya pesan
    // perintah tidak salah-rute ke state handler / eskalasi medis. Command selalu
    // per-customer (hanya data nomor yang sedang berbicara ini yang direset/ditampilkan).
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
    // Prioritas: media image dulu baru location — mencegah image dari WA Web yang kebawa location {0,0} tampil dobel Share Location
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
    const { MedicalDetectionService } = await import('../services/medical-detection.service');
    const medicalResult = MedicalDetectionService.detectMedicalConcern(incomingText);

    if (medicalResult.isMedical) {
      const { knowledgeBaseService } = await import('../services/knowledge.service');
      const approvedFaqMatch = await knowledgeBaseService.findMatchingFaq(incomingText, tenantId);

      // Strict Rule: Pasien legacy ATAU pasien yang sudah pernah confirmed reservasi
      // TIDAK BOLEH dijawab oleh bot (bahkan jika ada FAQ). Wajib STRICT SILENT AUTO-HOLD!
      const isLegacy = !!(customer as any).is_legacy_source;
      let hasPriorConfirmed = false;
      try {
        const confirmedCount = await prisma.reservation.count({
          where: { customer_id: customer.id, status: 'confirmed', tenant_id: tenantId },
        });
        hasPriorConfirmed = confirmedCount > 0;
      } catch (err: any) {
        // Fallback: anggap customer lama jika status offline tidak pasti
      }

      const allowFaqExemption = !isLegacy && !hasPriorConfirmed;

      // Exemption: Hanya untuk customer baru (belum pernah treatment & non-legacy) jika ada FAQ resmi
      if (allowFaqExemption && approvedFaqMatch && (approvedFaqMatch as any).category === 'medical' && (approvedFaqMatch as any).status === 'APPROVED') {
        console.log(`[MEDICAL FAQ EXEMPTION] Approved medical FAQ found for new customer "${incomingText}". Proceeding with official FAQ response.`);
      } else {
        const isHigh = medicalResult.severity === 'HIGH';
        console.log(`[STRICT MEDICAL ESCALATION] Severity ${medicalResult.severity} detected for customer ${customer.phone} (isLegacy=${isLegacy}, hasPriorConfirmed=${hasPriorConfirmed}). Symptoms: ${medicalResult.detectedSymptoms.join(', ')}`);

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
      await conversationService.updateLastDiscussedTreatment(activeConversation.id, tenantId, null as any).catch(() => {});
      activeConversation.last_discussed_treatment = null;
      activeConversation.current_state = ConversationState.INITIAL;
    }

    let result: StateHandlerResult;

    // 3. Routing ke State Handler yang sesuai
    const { AiModelConfigService } = await import('../config/ai-models.config');
    if (!AiModelConfigService.isBotActive(tenantId) && !activeConversation.is_human_handling) {
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

    // --- BYPASS LLM / NLU UNTUK PESAN GREETING LEAD MURNI ---
    const { checkLeadGreetingText } = await import('./utils/greeting-checker');
    const rawMsgBody = (incomingMessage as any)._rawBody || rawInboundText;
    const greetingCheck = activeConversation.current_state === ConversationState.INITIAL
      ? await checkLeadGreetingText(incomingText, rawMsgBody, tenantId)
      : undefined;
    const isPureGreetingLead = activeConversation.current_state === ConversationState.INITIAL && greetingCheck?.isPureGreeting;

    if (isPureGreetingLead) {
      console.log(`[GREETING BYPASS] Pure lead greeting matched for customer ${customer.phone}. Bypassing NLU & LLM router.`);
    }

    // --- GATE 2 🧠: STRUCTURED NLU INTENT & ENTITY CLASSIFICATION ---
    let nluResult = undefined;
    let historyFormatted: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (!activeConversation.is_human_handling && incomingText && !isPureGreetingLead) {
      try {
        const { NluClassifierService } = await import('../services/nlu-classifier.service');
        const { messageService } = await import('../services/message.service');
        const recentDbMsgs = await messageService.getRecentMessages(activeConversation.id, LLM_HISTORY_LIMIT, tenantId);
        historyFormatted = recentDbMsgs.map((m) => ({
          role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
          content: m.content || '',
        }));
        nluResult = await NluClassifierService.classifyMessage(incomingText, historyFormatted, {
          conversationId: activeConversation.id,
          customerPhone: customer.phone,
        });
      } catch (err: any) {
        console.error('[NLU CLASSIFICATION ERROR IN MACHINE]:', err.message);
      }
    }

    // --- GATE 2.1 🩺: MEDICAL DETECTION VIA NLU (SEMUA state, tanpa extra LLM call) ---
    // Gate keyword (di atas) hanya mencakup frasa statis. NLU sudah dipanggil di GATE 2 untuk
    // setiap pesan text non-human-handling, di state manapun (INITIAL / AWAITING_LOCATION / dst).
    // Jika NLU menyimpulkan intent medical_query, eskalasi senyap — konsisten dgn gate medis.
    if (!activeConversation.is_human_handling && nluResult && (nluResult.intents || []).includes('medical_query')) {
      console.log(`[MEDICAL NLU ESCALATION] NLU intent medical_query detected for customer ${customer.phone}. Escalating silently.`);
      conversation.is_human_handling = true;
      conversation.human_handling_since = new Date();
      conversation.escalation_reason = 'medical_concern';
      await conversationService.escalateToHumanHandling(
        activeConversation,
        customer.phone,
        `Keluhan medis terdeteksi via NLU classifier (intent medical_query): "${incomingText}"`,
        tenantId,
        'medical_concern'
      );
      try {
        const { AlertService, AlertType, AlertSeverity } = await import('../services/alert.service');
        const alertService = new AlertService();
        await alertService.notifyAlert({
          type: AlertType.MEDICAL_CONCERN_MEDIUM,
          severity: AlertSeverity.WARNING,
          message: `[MEDICAL ALERT via NLU] Customer: ${customer.phone}. Text: "${incomingText}"`,
          metadata: { customerPhone: customer.phone, incomingText },
        });
      } catch (alertErr: any) {
        console.error('[MEDICAL NLU ALERT ERROR] Failed to trigger alert:', alertErr.message);
      }
      return {
        nextState: ConversationState.HUMAN_HANDLING,
        shouldSendReply: false,
        isHumanHandling: true,
      };
    }

    // --- GATE 2.5 🧭: AI ROUTER ENGINE (default ON per tenant, shadow-first) ---
    // Konfigurasi per tenant (tenants.ai_router_enabled / ai_router_shadow_mode)
    // dimuat dari DB saat boot. Shadow mode hanya LOG perbandingan LLM router vs
    // fallback legacy — TIDAK mengubah keputusan state. Konsumsi penuh (full mode)
    // hanya saat shadow mode dimatikan lewat dashboard (setelah gate akurasi lolos).
    let routerDecision = undefined;
    const routerStateSnapshot = activeConversation.current_state;
    if (!activeConversation.is_human_handling && incomingText && !isPureGreetingLead && AiRouterConfigService.isEnabled(tenantId)) {
      try {
        const { aiRouterService } = await import('../integrations/llm/ai-router');
        routerDecision = await aiRouterService.classify({
          currentState: activeConversation.current_state,
          conversationHistory: historyFormatted,
          lastCustomerMessage: incomingText,
          conversationId: activeConversation.id,
          customerPhone: customer.phone,
        }, tenantId);
      } catch (err: any) {
        console.error('[AI ROUTER ERROR IN MACHINE]:', err.message);
      }

      // Eskalasi human otomatis berdasarkan flag router (HANYA mode konsumsi penuh).
      // Shadow mode TIDAK boleh mengubah keputusan produksi sama sekali.
      // Di-honor: UNKNOWN_REPEATED (berulang), MEDICAL_KEYWORD_SUSPECTED (safety),
      // SCHEDULE_REQUEST (butuh pengecekan slot manusia).
      if (routerDecision?.response && !AiRouterConfigService.isShadowMode(tenantId)) {
        try {
          const { handleRouterResult } = await import('../services/ai-router-evaluation.service');
          const processed = await handleRouterResult(activeConversation, routerDecision.response, tenantId);
          const escalateReasons: Record<string, string> = {
            UNKNOWN_REPEATED: 'unknown_repeated',
            MEDICAL_KEYWORD_SUSPECTED: 'medical_concern',
            SCHEDULE_REQUEST: 'schedule_request',
          };
          if (processed.needs_human_escalation && escalateReasons[processed.escalation_reason]) {
            console.warn(`[ROUTER ESCALATION] Customer ${customer.phone} auto-escalated (${processed.escalation_reason}). ${processed.reasoning_note || ''}`);
            await conversationService.escalateToHumanHandling(
              activeConversation,
              customer.phone,
              processed.reasoning_note || `Router flag ${processed.escalation_reason}`,
              tenantId,
              escalateReasons[processed.escalation_reason]
            );
          }
        } catch (err: any) {
          console.error('[AI ROUTER ESCALATION ERROR]:', err.message);
        }
      }
    }

    const handlerCtx = { ...ctx, tenantId, conversation: activeConversation, nluResult, routerDecision, history: historyFormatted };
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
      const incomingBody = incomingMessage.text?.body || '';
      result.replyText = formatIslamicReply(result.replyText, incomingBody);

      // Selalu gunakan nomor HP asli customer (customer.phone@c.us) sebagai target chatId
      // agar pesan tidak terkirim ke JID palsu (mis. LID number@c.us) jika resolusi LID WAHA gagal.
      const chatId = `${customer.phone}@c.us`;
      const resultHuman = await this.typingSvc.simulateHumanReply({
        chatId,
        incomingMessageId: incomingMessage.id,
        incomingText: incomingBody,
        replyText: result.replyText,
        shouldAbort: async () => {
          try {
            const freshConv = await conversationService.getOrCreateConversation(customer.id, tenantId);
            return !!freshConv?.is_human_handling;
          } catch {
            return false;
          }
        },
      });

      // Audit Log Pesan Outbound (Keluar): dicatat SELALU — baik terkirim maupun
      // gagal. Sebelumnya kegagalan sendText (WAHA down/timeout) tidak tercatat sama
      // sekali (success=false → log dilewati), sehingga chat tidak terkirim tapi log
      // pengiriman tidak menunjukkan jejak kegagalan. Kini gagal → delivery_status.
      // Tambahkan error send ke payload_raw agar traceable.
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

      if (resultHuman.success) {
        // Kirim Pricelist Image jika diinstruksikan oleh state handler.
        // Default hanya 1x per customer; boleh dikirim ulang jika handler set forcePricelistResend
        // (mis. saat customer minta pricelist lagi karena hilang / tidak terkirim).
        // Sumber gambar dibaca per-tenant (tenants.pricelist_image_url → env → aset default)
        // dan dikirim via gateway tenant (WAHA path/URL, WABA URL publik).
        // Gambar dikirim HD asli (tanpa kompresi server-side).
        if (result.sendPricelistImage) {
          let sendOk = false;
          try {
            const { prisma } = await import('../db/client');
            const dbCustomer = await prisma.customer.findUnique({
              where: { id: customer.id }
            });
            const alreadySent = dbCustomer ? dbCustomer.pricelist_sent : false;

            if (!alreadySent || result.forcePricelistResend) {
              const { resolvePricelistImageTarget } = await import('../services/pricelist-config.service');
              const gateway = await resolveGatewayForTenant(tenantId);
              const pricelistTarget = await resolvePricelistImageTarget(tenantId, gateway.providerType);
              const caption = result.pricelistCaption || `Pricelist ${getBrandIdentity().businessName} 🌸`;

              if (!pricelistTarget) {
                console.error(`[PRICELIST ERROR] Tidak bisa resolve gambar pricelist untuk tenant ${tenantId} & provider ${gateway.providerType}. Spring source image perlu URL publik/media outbound.`);
              } else if (customer.is_sandbox_test) {
                console.log(`[SANDBOX OUTBOUND] sendImageMessage -> phone: ${customer.phone} | target: "${pricelistTarget}" | caption: "${caption}"`);
                sendOk = true;
              } else {
                const sendResult = await gateway.sendImageMessage(customer.phone, pricelistTarget, caption);
                sendOk = sendResult.success;
              }

              // Tandai terkirim HANYA jika pengiriman benar-benar sukses.
              if (sendOk && dbCustomer && !dbCustomer.pricelist_sent) {
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
            // Best-effort tetap kirim walaupun DB offline (tidak membalikkan transaksi).
            if (!sendOk) {
              const { resolvePricelistImageTarget } = await import('../services/pricelist-config.service');
              const gateway = await resolveGatewayForTenant(tenantId);
              const pricelistTarget = await resolvePricelistImageTarget(tenantId, gateway.providerType);
              const caption = result.pricelistCaption || `Pricelist ${getBrandIdentity().businessName} 🌸`;
              if (pricelistTarget) {
                if (customer.is_sandbox_test) {
                  console.log(`[SANDBOX OUTBOUND] sendImageMessage -> phone: ${customer.phone} | target: "${pricelistTarget}" | caption: "${caption}"`);
                } else {
                  await gateway.sendImageMessage(customer.phone, pricelistTarget, caption);
                }
              }
            }
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
