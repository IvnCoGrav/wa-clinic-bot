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
    // RF-06: red-flag komposit (batuk kronis + ruam/demam) terbagi lintas turn —
    // gate medis deterministik WAJIB sadar-riwayat. Dimuat SEBELUM gate (dipakai
    // ulang oleh V3 di bawah) agar satu sumber kebenaran riwayat.
    const recentDbMsgs = await messageService.getRecentMessages(conversation.id, LLM_HISTORY_LIMIT, tenantId);
    const historyFormatted = recentDbMsgs.map((m) => ({
      role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
      content: m.content || '',
    }));
    const { MedicalDetectionService } = await import('../services/medical-detection.service');
    const medicalResult = MedicalDetectionService.detectMedicalConcern(
      incomingText,
      historyFormatted.filter((h) => h.role === 'user').map((h) => h.content)
    );

    if (medicalResult.isMedical) {
      const { knowledgeBaseService } = await import('../services/knowledge.service');
      const approvedFaqMatch = await knowledgeBaseService.findMatchingFaq(incomingText, tenantId);

      const isLegacy = !!(customer as any).is_legacy_source;
      let hasPriorConfirmed = false;
      try {
        const confirmedCount = await prisma.reservation.count({
          where: { customer_id: customer.id, status: { in: ['confirmed', 'en_route', 'completed'] }, tenant_id: tenantId },
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
        // V-A: balasan keselamatan WAJIB benar-benar terkirim (bukan hanya
        // di-return lalu dibuang pemanggil). Anti-silent-drop.
        await this.deliverTerminalReply({
          tenantId,
          customer,
          conversation,
          incomingMessage,
          replyText: safetyReply,
          aiReasoning: `Medical ${medicalResult.severity} safety reply delivered before human handoff.`,
        });
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
        // K1 (silent false-ack) FIX: DILARANG mengakui "data sudah kami terima"
        // bila simpan ke DB gagal. Tangkap status simpan secara eksplisit.
        let savedOk = false;
        try {
          const { reservationCoreService } = await import('../services/reservation-core.service');
          // #157a: jalur form WA WAJIB memakai kontrak intake kanonis yang sama
          // dengan V3 tool — same-day → `pending` + penanda [SAME_DAY_REQUEST]
          // (awareness admin / KB-2), plus requestId kanonis (idempotency:
          // redelivery webhook / double-submit tidak menggandakan baris).
          const { buildCustomerReservationIntake } = await import('../services/reservation-intake');
          const { isSameDayRequestText } = await import('../utils/date-confirmation');
          const intake = buildCustomerReservationIntake({
            tenantId,
            customerId: customer.id,
            treatmentDetail: parsed.treatmentDetail || '',
            bookingDate: parsed.bookingDate,
            sameDayText: isSameDayRequestText(incomingText),
          });
          const rawTextWithTag = intake.sameDayTag ? `${intake.sameDayTag}\n${incomingText}` : incomingText;
          await reservationCoreService.saveReservation({
            tenantId,
            customerId: customer.id,
            chatId: incomingMessage.chatId || `${customer.phone}@c.us`,
            bookingDate: parsed.bookingDate,
            treatmentCategory: parsed.treatmentCategory,
            treatmentDetail: parsed.treatmentDetail,
            rawText: rawTextWithTag,
            babies: parsed.babies || [],
            customerName: parsed.name,
            kecamatan: parsed.kec,
            kota: parsed.kota,
            // Integritas spasial: parsed.address = alamat jalan/perumahan lengkap
            // (bukan entitas desa resmi). Kelurahan hanya diisi hasil geocoding/
            // gazetteer; alamat jalan hidup di preferences.address.
            kelurahan: undefined,
            address: parsed.address || undefined,
            source: 'BOT',
            status: intake.status,
            requestId: intake.requestId,
          });
          savedOk = true;

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

        // Simpan nama kontak customer: "Bunda {nama}".
        // Integritas penamaan (fondasional): kecamatan HIDUP di kolom `kecamatan`
        // (dipakai formatter Google Contacts dari DB) — DILARANG ditempel ke
        // Customer.name. Sebelumnya `Bunda ${name} ${kecamatan}` memproduksi
        // duplikasi wilayah ("Bunda Ella Kecamatan Waru Kecamatan Waru").
        const customerName = parsed.name?.trim();
        if (customerName && customerName.length > 0 && customerName.toLowerCase() !== 'bunda') {
          const contactName = `Bunda ${customerName}`.trim();
          try {
            const { customerService } = await import('../services/customer.service');
            await customerService.updateCustomerName(customer.id, contactName, tenantId);
          } catch (nameErr: any) {
            console.warn('[MACHINE CONTACT SAVE] Failed to update customer name:', nameErr.message);
          }
        }

        // Eskalasi ke Human Handling. 152c: bila hari tertulis bertentangan
        // dengan tanggal (mis. "jumat 28 Juli" padahal Selasa), sertakan CATATAN
        // PERINGATAN ke staf agar dikonfirmasi — tanpa memblokir penyimpanan.
        const dateMismatchNote = parsed.dateMismatch
          ? ` ⚠️ PERLU KONFIRMASI TANGGAL: customer menulis hari "${parsed.writtenDay}", tetapi tanggal ${parsed.bookingDate ? parsed.bookingDate.toISOString().slice(0, 10) : ''} jatuh pada hari "${parsed.actualDay}". Mohon konfirmasi hari/tanggal yang benar ke customer.`
          : '';
        await conversationService.escalateToHumanHandling(
          activeConversation,
          customer.phone,
          `Formulir reservasi telah diisi oleh customer: "${parsed.treatmentDetail}"${dateMismatchNote}`,
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
        // K1 FIX: reply sukses HANYA bila tersimpan. Bila gagal, eskalasi ke
        // human handling dengan pesan jujur (tanpa klaim "sudah kami terima")
        // dan kirim alert agar admin menindaklanjuti manual.
        let replyText: string;
        if (savedOk) {
          replyText = `Baik Bunda, data reservasi sudah kami terima yaa. Segera kami bantu cekkan ketersediaan jadwalnya 😊${shareNote}`;
        } else {
          try {
            const { alertService, AlertType, AlertSeverity } = await import('../services/alert.service');
            await alertService.notifyAlert({
              type: AlertType.UNINTENDED_SILENT_DROP,
              severity: AlertSeverity.CRITICAL,
              tenantId,
              message: `Formulir reservasi customer ${customer.phone} GAGAL tersimpan ke DB (${parsed.treatmentDetail}). Perlu input manual.`,
            });
          } catch {}
          replyText = `Baik Bunda, data reservasi sudah kami catat ya. Tim Bidan kami akan segera menghubungi Bunda untuk konfirmasi jadwalnya 😊${shareNote}`;
        }

        await this.deliverTerminalReply({
          tenantId,
          customer,
          conversation,
          incomingMessage,
          replyText,
          aiReasoning: savedOk
            ? 'Customer submitted valid reservation form -> Saved reservation to DB & escalated to human handling.'
            : 'Customer submitted reservation form but DB save FAILED -> escalated to human handling with alert.',
        });
        return {
          nextState: ConversationState.HUMAN_HANDLING,
          replyText,
          shouldSendReply: true,
          isHumanHandling: true,
          aiReasoning: savedOk
            ? 'Customer submitted valid reservation form -> Saved reservation to DB & escalated to human handling.'
            : 'Customer submitted reservation form but DB save FAILED -> escalated to human handling with alert.',
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
            // V-B: eskalasi dulu, baru mutasi in-memory (anti racun previous_state).
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
          // V-A: permintaan melengkapi form WAJIB terkirim (bukan sekadar di-return).
          await this.deliverTerminalReply({
            tenantId,
            customer,
            conversation: activeConversation,
            incomingMessage,
            replyText: incompleteReply,
            aiReasoning: 'Customer submitted incomplete reservation form -> Prompted to fill missing fields.',
          });
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
    // recentDbMsgs/historyFormatted dimuat di gate medis (RF-06) & dipakai ulang di sini.
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
      // V-B: eskalasi DULU (service menyimpan previous_state = state riil),
      // baru mutasi in-memory. DILARANG set current_state=HUMAN_HANDLING sebelum
      // eskalasi — meracuni previous_state → release macet di HUMAN_HANDLING.
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
      // V-B: DILARANG memutasi current_state / is_human_handling di sini.
      // Eskalasi riil di STEP 6b (setelah closing terkirim) — service menyimpan
      // previous_state = state riil. Pra-mutasi meracuni previous_state ATAU
      // membatalkan pengiriman closing via shouldAbort (anti-silent-drop).

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
            if (freshConv?.is_human_handling) return true;
          } catch {
            // fail-open: jangan blokir karena error baca state
          }
          // Phase 4 (audit 6285743192813): batalkan draf USANG bila pesan yang
          // lebih baru sudah masuk antrean untuk phone ini (in-flight coalescing).
          try {
            const turnId = contextStorage.getStore()?.turnId;
            if (turnId) {
              const { queueService } = await import('../services/queue.service');
              if (queueService.isTurnSuperseded(customer.phone, turnId)) return true;
            }
          } catch {
            // fail-open
          }
          return false;
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

    // --- 6a. PENGIRIMAN GAMBAR PRICELIST (DETERMINISTIK, SETELAH TEKS) ---
    // Gerbang keputusan ada di V3 (`evaluatePricelistTrigger`). Di sini murni
    // eksekusi fisik meniru live-chat.service: cek cut-off, resolusi per-provider,
    // sandbox guard, retry 2x, alert saat gagal. Ditempatkan SETELAH balasan teks
    // agar teks utama tidak tertahan; HANYA saat tidak eskalasi/human-handling.
    if ((v3Result as any).sendPricelistImage && !v3Result.isEscalated && !activeConversation.is_human_handling) {
      try {
        const { whatsappProviderService } = await import('../services/whatsapp-provider.service');
        const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
        if (isCutOff) {
          console.log(`[PRICELIST SKIP] Outbound cut-off aktif untuk tenant ${tenantId}; gambar pricelist tidak dikirim.`);
        } else {
          const gateway = await resolveGatewayForTenant(tenantId);
          const { resolvePricelistImageTarget, getPricelistImageUrl } = await import('../services/pricelist-config.service');
          const target = await resolvePricelistImageTarget(tenantId, gateway.providerType);
          const { getBrandIdentityAsync } = await import('../config/brand');
          const brand = await getBrandIdentityAsync(tenantId);
          const caption = `Pricelist ${brand.businessName} 🌸`;
          // Rate-limit force-resend (anti-spam): cegah kirim ulang berturut-turut
          // < 10 menit. Hanya berlaku untuk forceResend (minta eksplisit berulang);
          // post-delivery pertama sudah dijaga kuota pricelist_sent.
          let cooldownBlocked = false;
          if ((v3Result as any).forcePricelistResend) {
            try {
              const recent = await messageService.getRecentMessages(activeConversation.id, 12, tenantId);
              const tenMinAgo = Date.now() - 10 * 60 * 1000;
              cooldownBlocked = recent.some((m: any) =>
                (m?.payload_raw?.type === 'image') &&
                /pricelist/i.test(m?.content || '') &&
                new Date(m?.created_at || m?.createdAt || 0).getTime() > tenMinAgo
              );
            } catch {}
          }
          if (cooldownBlocked) {
            console.log(`[PRICELIST SKIP] Force-resend dari ${customer.phone} dalam < 10 menit; dilewati (rate-limit).`);
          } else if (!target) {
            console.warn(`[PRICELIST WARN] Gambar pricelist tidak bisa di-resolve untuk tenant ${tenantId} & provider ${gateway.providerType}.`);
          } else {
            const chatId = `${customer.phone}@c.us`;
            messageService.registerInFlightBotOutbound(chatId, caption, tenantId, 60000);
            messageService.registerInFlightBotOutbound(chatId, `[IMAGE: ${caption}]`, tenantId, 60000);

            let sendOk = false;
            let sentMessageId: string | undefined;
            if (customer.is_sandbox_test) {
              console.log(`[SANDBOX OUTBOUND] sendImageMessage -> ${customer.phone} | target: "${target}" | caption: "${caption}"`);
              sendOk = true;
            } else {
              let attempts = 0;
              const maxAttempts = 2;
              while (attempts < maxAttempts) {
                attempts++;
                const sendResult = await gateway.sendImageMessage(customer.phone, target, caption);
                if (sendResult.success) {
                  sendOk = true;
                  sentMessageId = sendResult.messageId;
                  if (sentMessageId) messageService.registerKnownBotMessageId(sentMessageId, tenantId);
                  break;
                }
                if (attempts < maxAttempts) await new Promise((r) => setTimeout(r, 2000));
              }
            }

            if (sendOk) {
              try {
                await prisma.customer.update({ where: { id: customer.id }, data: { pricelist_sent: true } });
              } catch {}
              customer.pricelist_sent = true;
              try {
                const pathMod = await import('path');
                const rawUrl = await getPricelistImageUrl(tenantId);
                let mediaUrl = rawUrl;
                if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://') && !rawUrl.startsWith('/media/')) {
                  mediaUrl = `/media/asset/${pathMod.basename(rawUrl)}`;
                }
                const ext = pathMod.extname(target || mediaUrl).toLowerCase();
                const mimetype = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
                await messageService.logMessage({
                  tenantId,
                  conversationId: activeConversation.id,
                  direction: Direction.OUTBOUND,
                  content: caption,
                  waMessageId: sentMessageId,
                  senderType: 'BOT',
                  senderName: `Bot (${brand.businessName})`,
                  deliveryStatus: 'sent',
                  payloadRaw: { type: 'image', caption, media: { url: mediaUrl, hdUrl: mediaUrl, caption, mimetype } },
                });
              } catch (logErr: any) {
                console.warn('[PRICELIST LOG ERROR] Gagal mencatat gambar pricelist ke DB:', logErr?.message || logErr);
              }
            } else {
              console.warn(`[PRICELIST ERROR] Gagal mengirim gambar pricelist ke ${customer.phone} setelah retry.`);
              try {
                const { alertService, AlertType, AlertSeverity } = await import('../services/alert.service');
                await alertService.notifyAlert({
                  type: AlertType.THIRD_PARTY_OUTAGE,
                  severity: AlertSeverity.CRITICAL,
                  provider: gateway.providerType,
                  message: `Gagal mengirim gambar pricelist ke ${customer.phone} via ${gateway.providerType}. Periksa gateway/media.`,
                });
              } catch {}
            }
          }
        }
      } catch (pricelistErr: any) {
        console.error('[PRICELIST ERROR] Gagal memproses pengiriman gambar pricelist:', pricelistErr?.message || pricelistErr);
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

  /**
   * Kontrak kirim TUNGGAL untuk balasan terminal deterministik (medis, ack
   * formulir) yang diputuskan SEBELUM blok pengiriman utama. Sebelumnya
   * jalur-jalur ini `return shouldSendReply:true` tanpa benar-benar mengirim
   * (dibuang pemanggil) → customer menerima diam total. Helper ini memakai
   * jalur kirim yang sama dengan blok utama (typingService + logMessage) agar
   * satu kontrak: setiap balasan terminal pasti terkirim tepat sekali.
   * Tanpa shouldAbort: pesan terminal (keselamatan/ack) WAJIB sampai.
   */
  private async deliverTerminalReply(params: {
    tenantId: string;
    customer: any;
    conversation: any;
    incomingMessage: any;
    replyText: string;
    aiReasoning?: string;
  }): Promise<void> {
    const { tenantId, customer, conversation, incomingMessage, replyText, aiReasoning } = params;
    if (!replyText) return;
    const chatId = `${customer.phone}@c.us`;
    try {
      const resultHuman = await this.typingSvc.simulateHumanReply({
        chatId,
        incomingMessageId: incomingMessage.id,
        incomingText: incomingMessage.text?.body || '',
        replyText,
        tenantId,
        turnId: contextStorage.getStore()?.turnId,
        provider: contextStorage.getStore()?.provider,
      });
      try {
        await messageService.logMessage({
          tenantId,
          conversationId: conversation.id,
          direction: Direction.OUTBOUND,
          content: replyText,
          waMessageId: (resultHuman as any).messageId,
          payloadRaw: aiReasoning ? { aiReasoning } : undefined,
          deliveryStatus: resultHuman.success ? 'sent' : 'failed',
          metaErrorCode: resultHuman.success ? undefined : 'WAHA_SEND_TEXT',
          metaErrorDesc: resultHuman.success ? undefined : resultHuman.error || 'WAHA sendText failed',
        });
      } catch (logErr: any) {
        console.error(`[TERMINAL REPLY LOG ERROR] ${logErr?.message || logErr}`);
      }
    } catch (sendErr: any) {
      console.error(`[TERMINAL REPLY SEND ERROR] ${sendErr?.message || sendErr}`);
    }
  }
}

export const stateMachine = new ConversationStateMachine();
