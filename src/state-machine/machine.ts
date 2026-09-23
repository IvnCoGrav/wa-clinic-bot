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
import { contextStorage } from '../utils/context';
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

    // (Slash commands diproses SETELAH gate medis/domain — lihat di bawah —
    //  agar "/reset" tak memulihkan state darurat/eskalasi.)

    // --- GATE 🚫: OPT-OUT MARKETING (semua provider — WAHA & WABA) ---
    const rawInboundText = incomingMessage.text?.body || '';
    {
      const { wabaOptOutService } = await import('../services/waba-optout.service');
      const optOutDetect = wabaOptOutService.isOptOutMessage(rawInboundText);
      if (optOutDetect.matched) {
        console.log(`[OPT-OUT] Customer ${customer.phone} sent "${optOutDetect.keyword}". Processing global opt-out (tenant=${tenantId}).`);
        try {
          const result = await wabaOptOutService.handleOptOut(customer.id, tenantId);
          console.log(`[OPT-OUT] Customer ${customer.phone} opted out. Cancelled ${result.cancelledFollowUps} scheduled follow-ups.`);

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
          console.error('[OPT-OUT ERROR] Failed to process opt-out:', optOutErr.message);
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

      // Keputusan eskalasi vs lanjut di modul tunggal conversation-gates
      // (PLAN 8 FASE 3) — pengumpulan input tetap di sini, side-effect di bawah.
      const { evaluateMedicalGate } = await import('./conversation-gates');
      const medicalVerdict = evaluateMedicalGate({
        isMedical: true,
        severity: medicalResult.severity,
        detectedSymptoms: medicalResult.detectedSymptoms,
        allowFaqExemption,
        faqCategory: (approvedFaqMatch as any)?.category,
        faqStatus: (approvedFaqMatch as any)?.status,
      });

      if (medicalVerdict.action === 'continue') {
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

        // Eskalasi AMAN (revisi fondasional P3, 2026-09-17): eskalasi medis
        // WAJIB disertai balasan keselamatan deterministik — diam total saat
        // potensi darurat adalah bug keselamatan (melanggar anti-silent-drop).
        // Template tetap: tanpa dosis/angka obat, tanpa tawaran pijat, tanpa
        // ajakan jadwal, tanpa klaim sembuh. Nol risiko nasihat medis.
        const safetyReply = isHigh
          ? 'Mohon maaf Bunda 🙏 Keluhan seperti ini membutuhkan perhatian medis segera dan tidak bisa ditangani dengan pijat. Jika si kecil demam tinggi, kejang, sesak napas, atau lemas tak merespons, segera bawa ke dokter/faskes/IGD terdekat ya Bunda. Chat ini sudah kami teruskan ke tim Bidan kami agar segera dibantu.'
          : 'Terima kasih infonya Bunda 🙏 Untuk keluhan seperti ini, tim Bidan kami akan membantu mengecek lebih lanjut ya Bunda. Bila kondisi si kecil memburuk (demam tinggi, sesak, atau lemas), segera periksa ke dokter/faskes. Chat ini sudah kami teruskan ke tim Bidan kami.';
        return {
          nextState: ConversationState.HUMAN_HANDLING,
          shouldSendReply: true,
          replyText: safetyReply,
          isHumanHandling: true,
        };
      }
    }

    // 2. Cek Auto-Release Timeout terlebih dahulu jika sedang Human Handling
    const autoRelease = conversationService.checkAndApplyAutoRelease(conversation, tenantId);
    let activeConversation = autoRelease.updatedConversation;

    // --- IDLE TIMEOUT ---
    // CG-02 (2026-09-20): default 14,1 hari — selaras pola customer klinik yang
    // bisa berhari-hari dari chat awal sampai closing. Sebelumnya 24 jam (terlalu
    // pendek → customer yang balas setelah 2 hari kehilangan konteks).
    const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || '1218240000', 10);
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

      // Stage 4 (R2): idle reset WAJIB menyelaraskan sesi V3 episodik — sebelumnya
      // hanya enum conversation yang direset, sementara session V3 (cart, treatment
      // terpilih, booking, komitmen) tetap terbaca ulang → "amnesia palsu"/konteks
      // lama nyangkut. Bersihkan EPISODIK; pertahankan profil durable
      // (nama, sapaan, anak, lokasi terverifikasi).
      try {
        const { GoalTracker } = await import('../v3/state/goal-tracker');
        await GoalTracker.updateGoalSession(
          activeConversation.id,
          {
            cartItems: [],
            selectedTreatment: undefined,
            booking: undefined,
            discussedTreatments: [],
            priceDiscussed: undefined,
            bookingCommitConfirmed: undefined,
            lastCommitment: undefined,
            ongkirStatus: undefined,
            totalPrice: undefined,
          } as any,
          tenantId
        );
        console.log(`[TIMEOUT RESET] Sesi V3 episodik dibersihkan untuk conversation ${activeConversation.id}.`);
      } catch (resetErr: any) {
        console.warn('[TIMEOUT RESET] Gagal membersihkan sesi V3 episodik:', resetErr?.message);
      }
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
            status: 'confirmed',
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

        // Fase E: form valid → reset penghitung tak-lengkap.
        try {
          const { GoalTracker } = await import('../v3/state/goal-tracker');
          await GoalTracker.updateGoalSession(activeConversation.id, { formRetryCount: 0 }, tenantId);
        } catch {}

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
          // Fase E: anti loop minta-lengkapi selamanya — 2x diminta, ke-3x eskalasi sunyi.
          let retryCount = 0;
          try {
            const { GoalTracker } = await import('../v3/state/goal-tracker');
            const sess = await GoalTracker.getGoalSession(activeConversation.id, tenantId);
            retryCount = sess.formRetryCount || 0;
          } catch {}
          if (retryCount >= 2) {
            try {
              const { GoalTracker } = await import('../v3/state/goal-tracker');
              await GoalTracker.updateGoalSession(activeConversation.id, { formRetryCount: 0 }, tenantId);
            } catch {}
            activeConversation.is_human_handling = true;
            activeConversation.current_state = ConversationState.HUMAN_HANDLING;
            await conversationService.escalateToHumanHandling(
              activeConversation,
              customer.phone,
              `Formulir reservasi tak lengkap berulang (${retryCount + 1}x) — butuh bantuan manusia`,
              tenantId,
              'reservation_incomplete'
            );
            return {
              nextState: ConversationState.HUMAN_HANDLING,
              shouldSendReply: false,
              isHumanHandling: true,
              aiReasoning: 'Customer submitted incomplete reservation form 3x -> Silent escalation to human.',
            };
          }
          try {
            const { GoalTracker } = await import('../v3/state/goal-tracker');
            await GoalTracker.updateGoalSession(activeConversation.id, { formRetryCount: retryCount + 1 }, tenantId);
          } catch {}
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

    // --- Sapaan data-driven: simpan deklarasi identitas eksplisit customer
    // ("saya bapak", "panggil ibu") — BUKAN tebakan dari nama. Tersimpan di
    // preferences sesi dan dibaca GoalTracker; tanpa deklarasi = default produk.
    try {
      const { GoalTracker } = await import('../v3/state/goal-tracker');
      const declared = GoalTracker.detectExplicitGenderPreference(incomingText);
      if (declared) {
        await GoalTracker.updateGoalSession(activeConversation.id, { genderGreeting: declared }, tenantId);
      }
    } catch {}

    // --- 🚀 4. EKSEKUSI UTAMA: V3 AGENTIC (DEFAULT) / V2 SLOT-FILLING ENGINE ---
    const recentDbMsgs = await messageService.getRecentMessages(activeConversation.id, LLM_HISTORY_LIMIT, tenantId);
    const historyFormatted = recentDbMsgs.map((m) => ({
      role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
      content: m.content || '',
    }));
    const handlerCtx = { ...ctx, tenantId, conversation: activeConversation, history: historyFormatted, bubbleCorrelationId };

    // --- GATE DOMAIN + KELUHAN + MINTA MANUSIA: eskalasi sunyi SEBELUM V3
    //     Split-brain NLU dikolaps: TANPA panggilan LLM EntityExtractor.
    //     extractFastIntents (0 token) dulu; bila kosong, fallback
    //     deterministik preExtractDeterministic (darurat medis kritis tetap
    //     terdeteksi tanpa LLM). Komplain/permintaan manusia yang luput dari
    //     kedua gate ditangani Call 1 Router via tool escalate_to_human.
    let preExtractedIntents: string[] = [];
    try {
      const { extractFastIntents } = await import('../v3/agent/persona');
      const fast = extractFastIntents(incomingText);
      if (fast && fast.length > 0) {
        preExtractedIntents = fast;
      } else {
        const { EntityExtractor } = await import('../services/entity-extractor.service');
        const det = EntityExtractor.preExtractDeterministic(incomingText, incomingMessage);
        const detIntents = (det as any)?.intents || [];
        preExtractedIntents = detIntents.length > 0 ? detIntents : ['chitchat'];
      }
    } catch {}
    // Intent yang memaksa eskalasi sunyi — keputusan di modul tunggal
    // conversation-gates (PLAN 8 FASE 3; dipakai bersama agent-runner).
    const { evaluateDomainGate } = await import('./conversation-gates');
    const domainVerdict = evaluateDomainGate(preExtractedIntents);
    if (domainVerdict.action === 'silent_escalate') {
      console.log(`[SILENT GATE] ${domainVerdict.reason} untuk ${customer.phone} — eskalasi sunyi tanpa V3.`);
      activeConversation.is_human_handling = true;
      activeConversation.current_state = ConversationState.HUMAN_HANDLING;
      await conversationService.escalateToHumanHandling(
        activeConversation,
        customer.phone,
        domainVerdict.note || 'Eskalasi domain',
        tenantId,
        domainVerdict.reason || 'domain'
      );
      return {
        nextState: ConversationState.HUMAN_HANDLING,
        shouldSendReply: false,
        isHumanHandling: true,
      };
    }
    
    // --- GATE ✨: CUSTOMER SLASH COMMANDS (/reset, /state, /mulai) ---
    // Sengaja SETELAH gate medis/domain (Fase C3): perintah tak boleh memulihkan
    // state darurat atau eskalasi. Saat is_human_handling, guard di atas sudah
    // return sunyi lebih dulu sehingga /reset tak menyela CS.
    {
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
    }

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
      bubbleCorrelationId,
      turnId: contextStorage.getStore()?.turnId,
      provider: contextStorage.getStore()?.provider,
      incomingText: effectiveInboundText,
      originalText: (incomingMessage as any).originalText || inboundContent,
      history: historyFormatted,
      skipDbLogging: true,
      preExtractedIntents,
    });

    // Plan anti-silent-drop (sesi 89-turn, mati suri schedule-check): flag
    // is_human_handling TIDAK BOLEH di-set SEBELUM balasan penutup terkirim —
    // shouldAbort() membaca flag ini dan akan membatalkan pengiriman
    // (ABORTED_BY_HUMAN_HANDLING), membuat customer menerima diam total.
    // Flag di-set DEFENSIF di bawah (setelah STEP 2); di sini hanya persiapan.
    let pendingEscalation: {
      phone: string;
      note: string;
      reason: string;
    } | null = null;
    if (v3Result.isEscalated) {
      // Reason presisi untuk learning loop: eskalasi LLM non-medis dicatat
      // sebagai 'unresolved_faq' agar masuk antrean kurasi admin (/unanswered).
      const escTool = (v3Result.executedTools || []).find((t: any) => t?.name === 'escalate_to_human');
      const escSeverity = (escTool as any)?.args?.severity;
      // Skema 462651: agent boleh menitipkan alasan handoff presisi
      // (mis. 'pending_reservation_check'); fallback ke pemetaan lama.
      const escReason = (v3Result as any).escalationReason
        || (escSeverity === 'CRITICAL_MEDICAL' ? 'medical_concern' : 'unresolved_faq');
      pendingEscalation = {
        phone: customer.phone,
        note: (v3Result as any).escalationNote || 'Eskalasi otomatis oleh V3 Agent',
        reason: escReason,
      };
      activeConversation.current_state = ConversationState.HUMAN_HANDLING;

      // Stage 5 Fase 4 (RC-04): tandai turn durable sebagai HANDOFF (best-effort).
      try {
        const store = contextStorage.getStore();
        if (store?.turnId && store?.inboundMessageId) {
          const { turnRepository } = await import('../repositories/turn.repository');
          await turnRepository.markStatus({
            tenantId,
            provider: store.provider || 'WAHA',
            inboundMessageId: store.inboundMessageId,
            status: 'HANDOFF',
          });
        }
      } catch {}
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
    // (is_human_handling SAJA tidak di-update di sini — ditunda sampai setelah
    //  pengiriman, lihat pendingEscalation di bawah.)
    if (result.nextState !== activeConversation.current_state && result.nextState !== ConversationState.HUMAN_HANDLING) {
      await conversationService.updateConversationState(
        activeConversation.id,
        {
          currentState: result.nextState,
          previousState: activeConversation.current_state,
        },
        tenantId
      );
    }

    // 5. Kronologi last_message_at murni milik messageService.logMessage (pesan riil).
    // Mutasi prematur di sini dihapus agar chat lama tidak melompat ke atas tanpa pesan baru.

    // --- 6. PENGIRIMAN BALASAN (JIKA DIPERLUKAN) ---
    if (result.shouldSendReply && result.replyText) {
      const incomingBody = incomingMessage.text?.body || '';

      // --- SEND TEXT REPLY DENGAN SIMULASI MENGETIK ---
      const chatId = `${customer.phone}@c.us`;
      const outboundTurnId = contextStorage.getStore()?.turnId;
      const outboundProvider = contextStorage.getStore()?.provider;
      const resultHuman = await this.typingSvc.simulateHumanReply({
        chatId,
        incomingMessageId: incomingMessage.id,
        incomingText: incomingBody,
        replyText: result.replyText,
        tenantId,
        turnId: outboundTurnId,
        provider: outboundProvider,
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
      // MT-R4.1 (audit R4): kegagalan LOGGING setelah pengiriman TIDAK BOLEH
      // menggagalkan turn — jika dilempar ke queue worker, job akan retry dan
      // MENGIRIM ULANG pesan yang sudah terkirim (balasan ganda ke customer).
      // Pesan fisik sudah keluar; catat warning best-effort saja.
      try {
        await messageService.logMessage({
          tenantId,
          conversationId: activeConversation.id,
          direction: Direction.OUTBOUND,
          content: result.replyText,
          waMessageId: (resultHuman as any).messageId,
          payloadRaw: Object.keys(outboundPayload).length > 0 ? outboundPayload : undefined,
          deliveryStatus: resultHuman.success ? 'sent' : 'failed',
          metaErrorCode: resultHuman.success ? undefined : 'WAHA_SEND_TEXT',
          metaErrorDesc: resultHuman.success ? undefined : resultHuman.error || 'WAHA sendText failed',
        });
      } catch (logErr: any) {
        console.error(`[OUTBOUND LOG ERROR] Gagal mencatat pesan outbound (tidak memicu retry): ${logErr?.message || logErr}`);
      }
    }

    // --- 6b. PENETAPAN FLAG HUMAN_HANDLING (SETELAH pengiriman) ---
    // Plan anti-silent-drop: flag baru aktif SETELAH balasan (termasuk closing
    // schedule-check) terkirim, sehingga shouldAbort() tidak membatalkannya.
    if (pendingEscalation) {
      activeConversation.is_human_handling = true;
      try {
        await conversationService.escalateToHumanHandling(
          activeConversation,
          pendingEscalation.phone,
          pendingEscalation.note,
          tenantId,
          pendingEscalation.reason
        );
      } catch (escErr: any) {
        console.warn(`[ESCALATION DEFERRED ERROR] Gagal mencatat eskalasi: ${escErr?.message || escErr}`);
      }
    }

    // --- LEARNING LOOP (Fase A): turn dengan grounding kosong tetap dibalas,
    // tapi dicatat 'unresolved_faq' agar admin mengkurasi via /unanswered.
    // Dilakukan SETELAH pengiriman agar balasan tidak tertahan.
    // Plan Fase 3 (sesi 89-turn, mati suri 68 turn): DILARANG memutasi
    // is_human_handling di sini — antrean kurasi admin BUKAN eskalasi CS.
    // Penandaan murni data (review_flagged) agar dashboard kurasi menampilkan
    // turn ini, sementara bot TETAP AKTIF menjawab giliran berikutnya.
    if ((v3Result as any).unresolvedFaq && !v3Result.isEscalated) {
      try {
        const { getConversationRepository } = await import('../repositories/conversation.repository');
        await getConversationRepository().flagForReview(activeConversation.id, 'unresolved_faq', tenantId);
      } catch {}
    }

    return result;
  }
}

export const stateMachine = new ConversationStateMachine();
