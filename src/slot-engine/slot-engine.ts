import { StateHandlerContext, StateHandlerResult } from '../state-machine/types';
import { ConversationState } from '@prisma/client';
import { SlateStore } from './slate-store';
import { EntityExtractor } from './entity-extractor';
import { DecisionMatrix } from './decision-matrix';
import { GroundingComposer } from './grounding-composer';
import { ReplyGenerator } from './reply-generator';
import { conversationService } from '../services/conversation.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { telemetryService } from '../services/telemetry.service';
import { CustomerSlate, ExtractedEntities } from './types';

/**
 * Core Orchestrator: Context-Grounded Slot-Filling Engine.
 * Menjalankan pipeline: Slate Hydration -> Entity Extraction -> Decision Matrix -> Grounding -> Generator -> Persistence.
 */
export async function processSlotEngine(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { customer, conversation, incomingMessage, history } = ctx;
  const tenantId = ctx.tenantId || customer.tenant_id || DEFAULT_TENANT_ID;
  const incomingText = incomingMessage?.text?.body || '';
  const telemetryStart = Date.now();

  const recordTurnTelemetry = (updatedSlate: CustomerSlate, extraction: ExtractedEntities | null, decision: any, rawReply: string | null | undefined, sanitizedReply: string | null | undefined, modelName?: string) => {
    try {
      const latencyMs = Date.now() - telemetryStart;
      const isSilentDropRaw = decision.action.includes('HUMAN') && !sanitizedReply && !decision.deterministicTemplateReply;
      const isMedical = extraction?.isMedicalEmergency || updatedSlate.humanHandlingReason === 'medical_concern';
      const isSilentDrop = isSilentDropRaw && !isMedical;
      const mutilation = telemetryService.getLastMutilation(customer.phone);
      const mutilationRatio = mutilation ? mutilation.ratio : telemetryService.calculateMutilationRatio(rawReply || null, sanitizedReply || null);
      const nluErrorCode = telemetryService.getLastNluError(customer.phone);
      const isJsonTruncated = nluErrorCode === 'JSON_TRUNCATED';
      let isUnjustifiedRsqr = false;
      try {
        const closerInstruction = decision.deterministicTemplateReply || sanitizedReply || '';
        isUnjustifiedRsqr = telemetryService.checkUnjustifiedRsqr(updatedSlate.isLocationConfirmed, closerInstruction);
        if (!isUnjustifiedRsqr && sanitizedReply) {
          isUnjustifiedRsqr = telemetryService.checkUnjustifiedRsqr(updatedSlate.isLocationConfirmed, sanitizedReply);
        }
      } catch {}
      telemetryService.recordTurn({
        conversationId: conversation.id,
        customerPhone: customer.phone,
        tenantId,
        timestamp: Date.now(),
        rawLlmReply: rawReply || null,
        sanitizedReply: sanitizedReply || null,
        mutilationRatio,
        isSilentDrop,
        isUnjustifiedRsqr,
        nluErrorCode,
        isJsonTruncated,
        latencyMs,
        modelName: modelName || telemetryService.getLastModel(customer.phone) || undefined,
      } as any);
      telemetryService.clearLastMutilation(customer.phone);
      telemetryService.setLastNluError(customer.phone, null);
      telemetryService.clearLastModel(customer.phone);
      import('../services/alert-daemon.service').then(m => m.alertDaemonService.evaluate({
        conversationId: conversation.id, customerPhone: customer.phone, tenantId, timestamp: Date.now(),
        rawLlmReply: rawReply || null, sanitizedReply: sanitizedReply || null, mutilationRatio, isSilentDrop, isUnjustifiedRsqr, nluErrorCode, isJsonTruncated, latencyMs, modelName,
      } as any).catch(()=>{})).catch(()=>{});
    } catch {}
  };

  console.log(`[SLOT ENGINE] Processing message from customer ${customer.phone} ("${incomingText}")`);

  // 1. Hydrate Customer Slate dari database snapshot
  const initialSlate = SlateStore.hydrateSlate(ctx);

  try {
    // 0. Cek Global Bot Deactivation
    const { AiModelConfigService } = await import('../config/ai-models.config');
    const isSandboxTest = Boolean(customer.is_sandbox_test);
    if (!AiModelConfigService.isBotActive(tenantId) && !conversation.is_human_handling && !isSandboxTest) {
      console.log(`[GLOBAL BOT DEACTIVATED] Bypassing bot responder and routing customer ${customer.phone} directly to human handling.`);
      await conversationService.escalateToHumanHandling(
        conversation,
        customer.phone,
        'Global bot disabled',
        tenantId,
        'global_bot_disabled'
      );
      conversation.is_human_handling = true;
      conversation.current_state = ConversationState.HUMAN_HANDLING;
      recordTurnTelemetry(initialSlate, null, { action: 'SILENT_HUMAN_ACTIVE', deterministicTemplateReply: null } as any, null, null);
      return {
        nextState: ConversationState.HUMAN_HANDLING,
        shouldSendReply: false,
        isHumanHandling: true,
      };
    }

  // 1a. GERBANG UTAMA 📋: FORMULIR RESERVASI MASUK
  // Jika customer mengirimkan formulir reservasi yang sudah diisi, parse datanya, simpan ke database,
  // update nama kontak, trigger CAPI InitiateCheckout, dan alihkan ke HUMAN_HANDLING secara deterministik.
  const { isReservationFormMessage, parseReservationText } = await import('../utils/reservation-text-parser');
  const lowerText = incomingText.toLowerCase().trim();
  const { getTenantCapiFormats } = await import('../services/capi.service');
  const tenantFormats = await getTenantCapiFormats(tenantId);
  const checkoutKeyword = tenantFormats.formatCheckout.toLowerCase();
  const tenantCheckoutHit =
    checkoutKeyword.length > 0 && lowerText.includes(checkoutKeyword.replace(/\s+/g, ' ').trim());
  const isFormSubmission =
    isReservationFormMessage(incomingText) ||
    tenantCheckoutHit ||
    lowerText.includes('berikut list untuk reservasi') ||
    (lowerText.includes('pilihan treatment') && (lowerText.includes('nama bunda') || lowerText.includes('alamat')));

  if (isFormSubmission) {
    const parseResult = parseReservationText(incomingText);
    if (parseResult.success && parseResult.reservation) {
      const parsed = parseResult.reservation;
      let createdReservationId: string | null = null;
      try {
        const { prisma } = await import('../db/client');
        const reservation = await prisma.reservation.create({
          data: {
            tenant_id: tenantId,
            customer_id: customer.id,
            treatment_category: parsed.treatmentCategory,
            treatment_detail: parsed.treatmentDetail,
            booking_date: parsed.bookingDate,
            raw_text: incomingText,
            status: 'pending',
          },
        });
        createdReservationId = reservation.id;

        const { reservationLifecycleService } = await import('../services/reservation-lifecycle.service');
        await reservationLifecycleService.onReservationCreated({
          customerId: customer.id,
          reservationId: reservation.id,
          tenantId,
          chatId: incomingMessage.chatId || `${customer.phone}@c.us`,
          babies: parsed.babies || [],
          customerName: parsed.name,
          kecamatan: parsed.kec,
          kota: parsed.kota,
          kelurahan: parsed.address,
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
        console.error(`[SLOT ENGINE] Gagal simpan reservasi customer ${customer.phone} (${parsed.name}):`, dbErr.message);
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
          console.warn('[SLOT ENGINE CONTACT SAVE] Failed to update customer name:', nameErr.message);
        }
      }

      // Eskalasi ke Human Handling
      await conversationService.escalateToHumanHandling(
        conversation,
        customer.phone,
        `Formulir reservasi telah diisi oleh customer: "${parsed.treatmentDetail}"`,
        tenantId,
        'reservation_submitted'
      );

      initialSlate.isHumanHandling = true;
      initialSlate.humanHandlingReason = 'reservation_submitted';
      initialSlate.projectedState = ConversationState.HUMAN_HANDLING;
      await SlateStore.persistSlate(initialSlate);

      const { TEMPLATES } = await import('../config/persona');
      const shareNote = customer.share_location_sent ? '' : `\n\n${TEMPLATES.askShareLocation()}`;
      const replyText = `Baik Bunda, data reservasi sudah kami terima ya bund. Kami cek dulu ya bund. 😊${shareNote}`;
      recordTurnTelemetry(initialSlate, null, { action: 'SEND_RESERVATION_FORM', deterministicTemplateReply: replyText } as any, null, replyText);

      return {
        nextState: ConversationState.HUMAN_HANDLING,
        replyText,
        shouldSendReply: true,
        isHumanHandling: true,
        aiReasoning: 'Customer submitted valid reservation form -> Saved reservation to DB & escalated to human handling.',
      };
    } else {
      // Hanya prompt kekurangan field jika pesan benar-benar percobaan mengisi template form resmi
      // (memiliki header form resmi atau minimal 2 label field ber-titik dua)
      const hasFormHeaderOrColonFields =
        lowerText.includes('list untuk reservasi') ||
        lowerText.includes('format reservasi') ||
        lowerText.includes('form reservasi') ||
        lowerText.includes('form booking') ||
        lowerText.includes('pilihan treatment (') ||
        (lowerText.includes('nama') && lowerText.includes(':') && (lowerText.includes('alamat') || lowerText.includes('treatment')));

      if (hasFormHeaderOrColonFields) {
        const missing = parseResult.missingFields || [];
        const missingStr = missing.join(', ');
        const incompleteReply = `Mohon maaf Bunda, mohon diisi bagian ${missingStr} pada list reservasi ya bund. Terima kasih! 😊`;
        recordTurnTelemetry(initialSlate, null, { action: 'SEND_RESERVATION_FORM', deterministicTemplateReply: incompleteReply } as any, null, incompleteReply);
        return {
          nextState: ConversationState.RESERVATION_SENT,
          replyText: incompleteReply,
          shouldSendReply: true,
          aiReasoning: 'Customer submitted incomplete reservation form -> Prompted to fill missing fields.',
        };
      }
      // Jika bukan template form terstruktur (misal pertanyaan chat biasa),
      // jangan tolak customer! Lanjutkan ke alur normal Slot Engine / NLU.
      console.log(`[SLOT ENGINE] Message was not a structured form template attempt. Falling through to standard slot engine.`);
    }
  }

  // 1b. [UNIFIED PIPELINE] Fast-Track dihapus — semua pesan masuk melalui Single Unified Pipeline (EntityExtractor -> Slate -> DecisionMatrix -> ReplyGenerator)
  // FastFaqGenerator tetap ada sebagai modul terpisah untuk observasi, tapi tidak lagi menjadi jalur paralel yang menyebabkan amnesia Slate.

  // 2. Ekstrak seluruh entitas & intensi dalam Single-Pass LLM
  const extraction = await EntityExtractor.extract(incomingText, {
    history,
    customerPhone: customer.phone,
    conversationId: conversation.id,
    tenantId,
    incomingMessage,
  });

  // 3. Evaluasi Decision Matrix (0 Token, Pure TypeScript)
  const rawTextForEvaluation = incomingMessage?.originalText || (incomingMessage as any)?._rawBody || incomingText;
  const lastDiscussedTreatment = conversation.last_discussed_treatment || initialSlate.selectedTreatmentName || undefined;
  const decision = await DecisionMatrix.evaluate(initialSlate, extraction, { tenantId, incomingText: rawTextForEvaluation, history, lastDiscussedTreatment });

  // 4. Handle Kasus 1: Eskalasi Darurat Medis
  if (decision.action === 'ESCALATE_HUMAN_EMERGENCY') {
    await SlateStore.persistSlate(decision.updatedSlate);
    await conversationService.escalateToHumanHandling(
      conversation,
      customer.phone,
      `Darurat medis terdeteksi via Slot-Filling Engine: "${incomingText}"`,
      tenantId,
      'medical_concern'
    );
    const isSandbox = Boolean(customer.is_sandbox_test || isDummyOrTestContact(customer.phone, customer.name, customer.is_sandbox_test));
    if (!isSandbox) {
      try {
        const { AlertService, AlertType, AlertSeverity } = await import('../services/alert.service');
        const alertService = new AlertService();
        await alertService.notifyAlert({
          type: AlertType.MEDICAL_EMERGENCY_HIGH,
          severity: AlertSeverity.CRITICAL,
          message: `[MEDICAL CRITICAL ALERT] Customer: ${customer.phone}. Text: "${incomingText}"`,
          metadata: { customerPhone: customer.phone, incomingText },
        });
      } catch {}
    }

    recordTurnTelemetry(decision.updatedSlate, extraction, decision, null, null);
    return {
      nextState: ConversationState.HUMAN_HANDLING,
      shouldSendReply: false,
      isHumanHandling: true,
      aiReasoning: decision.reason,
    };
  }

  // 4b. Handle Komplain Layanan (Silent Escalation)
  if (decision.action === 'ESCALATE_HUMAN_COMPLAINT') {
    await SlateStore.persistSlate(decision.updatedSlate);
    await conversationService.escalateToHumanHandling(
      conversation,
      customer.phone,
      `Komplain layanan terdeteksi via Slot Engine: "${incomingText}"`,
      tenantId,
      'customer_complaint'
    );
    recordTurnTelemetry(decision.updatedSlate, extraction, decision, null, null);
    return {
      nextState: ConversationState.HUMAN_HANDLING,
      shouldSendReply: false,
      isHumanHandling: true,
      aiReasoning: decision.reason,
    };
  }

  // 4b2. Handle Pertanyaan Layanan di Luar Pricelist / Katalog (Silent Escalation)
  if (decision.action === 'ESCALATE_HUMAN_UNLISTED_SERVICE') {
    await SlateStore.persistSlate(decision.updatedSlate);
    await conversationService.escalateToHumanHandling(
      conversation,
      customer.phone,
      `Pertanyaan layanan di luar pricelist/katalog: "${incomingText}"`,
      tenantId,
      'unlisted_service'
    );
    recordTurnTelemetry(decision.updatedSlate, extraction, decision, null, null);
    return {
      nextState: ConversationState.HUMAN_HANDLING,
      shouldSendReply: false,
      isHumanHandling: true,
      aiReasoning: decision.reason,
    };
  }

  // 4c. Handle Eskalasi dengan Pesan Konfirmasi Handoff (Jadwal, CS Request, Reschedule/Cancel)
  if (
    decision.action === 'ESCALATE_HUMAN_SCHEDULE' ||
    decision.action === 'ESCALATE_HUMAN_AGENT_REQUEST' ||
    decision.action === 'ESCALATE_RESCHEDULE_CANCEL'
  ) {
    await SlateStore.persistSlate(decision.updatedSlate);
    await conversationService.escalateToHumanHandling(
      conversation,
      customer.phone,
      decision.reason,
      tenantId,
      decision.updatedSlate.humanHandlingReason || 'escalated'
    );
    const { UnifiedResponseSanitizer } = await import('../utils/language-sanitizer');
    const botRepliesCount = history?.filter((h) => h.role === 'assistant').length ?? 0;
    const sanitizedReply = UnifiedResponseSanitizer.sanitize(decision.deterministicTemplateReply || '', {
      historyCount: botRepliesCount,
      preserveGreeting: true,
    });
    recordTurnTelemetry(decision.updatedSlate, extraction, decision, decision.deterministicTemplateReply, sanitizedReply);
    return {
      nextState: ConversationState.HUMAN_HANDLING,
      replyText: sanitizedReply,
      shouldSendReply: true,
      isHumanHandling: true,
      aiReasoning: decision.reason,
    };
  }

  // 4d. Handle Not Interested (Selesai Tanpa Mendesak)
  if (decision.action === 'NOT_INTERESTED_COMPLETED') {
    await SlateStore.persistSlate(decision.updatedSlate);
    const { UnifiedResponseSanitizer } = await import('../utils/language-sanitizer');
    const botRepliesCount = history?.filter((h) => h.role === 'assistant').length ?? 0;
    const sanitizedReply = UnifiedResponseSanitizer.sanitize(decision.deterministicTemplateReply || '', {
      historyCount: botRepliesCount,
      preserveGreeting: true,
    });
    recordTurnTelemetry(decision.updatedSlate, extraction, decision, decision.deterministicTemplateReply, sanitizedReply);
    return {
      nextState: ConversationState.COMPLETED,
      replyText: sanitizedReply,
      shouldSendReply: true,
      aiReasoning: decision.reason,
    };
  }

  // 5. Handle Kasus 2: Percakapan Sedang Diambil Alih CS
  if (decision.action === 'SILENT_HUMAN_ACTIVE') {
    recordTurnTelemetry(decision.updatedSlate, extraction, decision, null, null);
    return {
      nextState: ConversationState.HUMAN_HANDLING,
      shouldSendReply: false,
      isHumanHandling: true,
      aiReasoning: decision.reason,
    };
  }

  // 6. Handle Kasus 3 & 4: Template Balasan Deterministik (Form Reservasi / Out of Coverage)
  if (decision.deterministicTemplateReply) {
    await SlateStore.persistSlate(decision.updatedSlate);
    const { UnifiedResponseSanitizer } = await import('../utils/language-sanitizer');
    const botRepliesCount = history?.filter((h) => h.role === 'assistant').length ?? 0;
    const sanitizedReply = UnifiedResponseSanitizer.sanitize(decision.deterministicTemplateReply, {
      historyCount: botRepliesCount,
      preserveGreeting: true,
    });
    recordTurnTelemetry(decision.updatedSlate, extraction, decision, decision.deterministicTemplateReply, sanitizedReply);
    return {
      nextState: decision.updatedSlate.projectedState,
      replyText: sanitizedReply,
      shouldSendReply: true,
      sendPricelistImage: decision.shouldSendPricelistImage,
      pricelistCaption: decision.pricelistCaption,
      aiReasoning: decision.reason,
    };
  }

  // 7. Handle Kasus 5 & 6: Single-Pass AI Response Generation
  const grounding = await GroundingComposer.compose(decision.updatedSlate, extraction, {
    customerInput: incomingText,
    tenantId,
  });
  // Sinkronisasi last_discussed_treatment HANYA jika pelanggan eksplisit memilih treatment (tanpa auto-fill index 0)
  if (!decision.updatedSlate.selectedTreatmentName && extraction.treatmentReferenced) {
    decision.updatedSlate.selectedTreatmentName = extraction.treatmentReferenced;
  }
  const replyText = await ReplyGenerator.generate(decision.updatedSlate, extraction, grounding, {
    history,
    customerPhone: customer.phone,
    customerInput: incomingText,
    tenantId,
  });
  // Telemetri untuk AI response (raw vs sanitized sudah dicatat di ReplyGenerator)
  {
    const m = telemetryService.getLastMutilation(customer.phone);
    const rawForTelemetry = m?.raw || null;
    const modelForTelemetry = telemetryService.getLastModel(customer.phone) || undefined;
    recordTurnTelemetry(decision.updatedSlate, extraction, decision, rawForTelemetry, replyText, modelForTelemetry);
  }

  // Jika balasan LLM menyertakan format reservasi, tandai form telah terkirim
  if (
    replyText.toLowerCase().includes('list untuk reservasi') ||
    replyText.toLowerCase().includes('format reservasi') ||
    replyText.toLowerCase().includes('form reservasi')
  ) {
    decision.updatedSlate.reservationFormSent = true;
    decision.updatedSlate.projectedState = ConversationState.RESERVATION_SENT;
  }

  // Simpan update state ke DB
  await SlateStore.persistSlate(decision.updatedSlate);

  return {
    nextState: decision.updatedSlate.projectedState,
    replyText,
    shouldSendReply: true,
    sendPricelistImage: decision.shouldSendPricelistImage,
    pricelistCaption: decision.pricelistCaption,
    aiReasoning: decision.reason,
  };
  } catch (error: any) {
    console.error(`[SLOT ENGINE OUTAGE ESCALATION] LLM Outage or unhandled error for customer ${customer.phone}:`, error.message);

    initialSlate.isHumanHandling = true;
    initialSlate.humanHandlingReason = 'llm_outage_fallback';
    initialSlate.projectedState = ConversationState.HUMAN_HANDLING;
    await SlateStore.persistSlate(initialSlate);

    await conversationService.escalateToHumanHandling(
      conversation,
      customer.phone,
      `Eskalasi darurat: Seluruh model LLM offline / gagal merespons (${error.message}). Percakapan dialihkan ke CS.`,
      tenantId,
      'llm_outage_fallback'
    );

    const isSandbox = Boolean(customer.is_sandbox_test || isDummyOrTestContact(customer.phone, customer.name, customer.is_sandbox_test));
    if (!isSandbox) {
      try {
        const { AlertService, AlertType, AlertSeverity } = await import('../services/alert.service');
        const alertService = new AlertService();
        await alertService.notifyAlert({
          type: AlertType.LLM_API_FAILURE,
          severity: AlertSeverity.WARNING,
          message: `[LLM OUTAGE ALERT] Seluruh model LLM offline. Customer ${customer.phone} dialihkan ke CS.`,
          metadata: { customerPhone: customer.phone, incomingText, error: error.message },
        });
      } catch {}
    }

    // Telemetri untuk outage (NLU failure / LLM outage)
    try {
      const nluErr = telemetryService.getLastNluError(customer.phone) || 'LLM_ERROR';
      telemetryService.recordTurn({
        conversationId: conversation.id,
        customerPhone: customer.phone,
        tenantId,
        timestamp: Date.now(),
        rawLlmReply: null,
        sanitizedReply: null,
        mutilationRatio: 0,
        isSilentDrop: true,
        isUnjustifiedRsqr: false,
        nluErrorCode: nluErr,
        isJsonTruncated: nluErr === 'JSON_TRUNCATED',
        latencyMs: Date.now() - telemetryStart,
        modelName: telemetryService.getLastModel(customer.phone) || undefined,
      } as any);
    } catch {}
    // Bot DIAM (shouldSendReply: false) - Jangan pernah mengirim pesan mengarang / regex rusak ke customer!
    return {
      nextState: ConversationState.HUMAN_HANDLING,
      shouldSendReply: false,
      isHumanHandling: true,
      aiReasoning: `LLM Outage -> Silent Escalation to Human CS: ${error.message}`,
    };
  }
}
