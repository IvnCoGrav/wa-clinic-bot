import { StateHandlerContext, StateHandlerResult } from '../state-machine/types';
import { ConversationState } from '@prisma/client';
import { SlateStore } from './slate-store';
import { EntityExtractor } from './entity-extractor';
import { DecisionMatrix } from './decision-matrix';
import { GroundingComposer } from './grounding-composer';
import { ReplyGenerator } from './reply-generator';
import { conversationService } from '../services/conversation.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Core Orchestrator: Context-Grounded Slot-Filling Engine.
 * Menjalankan pipeline: Slate Hydration -> Entity Extraction -> Decision Matrix -> Grounding -> Generator -> Persistence.
 */
export async function processSlotEngine(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { customer, conversation, incomingMessage, history } = ctx;
  const tenantId = ctx.tenantId || customer.tenant_id || DEFAULT_TENANT_ID;
  const incomingText = incomingMessage?.text?.body || '';

  console.log(`[SLOT ENGINE] Processing message from customer ${customer.phone} ("${incomingText}")`);

  // 1. Hydrate Customer Slate dari database snapshot
  const initialSlate = SlateStore.hydrateSlate(ctx);

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
        return {
          nextState: ConversationState.RESERVATION_SENT,
          replyText: `Mohon maaf Bunda, mohon diisi bagian ${missingStr} pada list reservasi ya bund. Terima kasih! 😊`,
          shouldSendReply: true,
          aiReasoning: 'Customer submitted incomplete reservation form -> Prompted to fill missing fields.',
        };
      }
      // Jika bukan template form terstruktur (misal pertanyaan chat biasa),
      // jangan tolak customer! Lanjutkan ke alur normal Slot Engine / NLU.
      console.log(`[SLOT ENGINE] Message was not a structured form template attempt. Falling through to standard slot engine.`);
    }
  }

  // 1b. Fast-Track ⚡: Single-Pass 1-Call FAQ & General Knowledge Inquiry
  const { isFastFaq1CallEnabled } = await import('../config/feature-flags');
  const { FastFaqDetector } = await import('./fast-faq-detector');
  if (isFastFaq1CallEnabled(tenantId) && FastFaqDetector.isPotentialFastFaq(incomingText, initialSlate)) {
    const { FastFaqGenerator } = await import('./fast-faq-generator');
    const fastResult = await FastFaqGenerator.process(ctx, initialSlate);
    if (fastResult) {
      await SlateStore.persistSlate(fastResult.updatedSlate);
      return fastResult.handlerResult;
    }
    console.log(`[SLOT ENGINE] Fast-Track FAQ fell through to 2-Call Deep Engine for customer ${customer.phone}`);
  }

  // 2. Ekstrak seluruh entitas & intensi dalam Single-Pass LLM
  const extraction = await EntityExtractor.extract(incomingText, {
    history,
    customerPhone: customer.phone,
    conversationId: conversation.id,
    tenantId,
    incomingMessage,
  });

  // 3. Evaluasi Decision Matrix (0 Token, Pure TypeScript)
  const decision = await DecisionMatrix.evaluate(initialSlate, extraction, { tenantId, incomingText });

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

    return {
      nextState: ConversationState.HUMAN_HANDLING,
      shouldSendReply: false,
      isHumanHandling: true,
      aiReasoning: decision.reason,
    };
  }

  // 5. Handle Kasus 2: Percakapan Sedang Diambil Alih CS
  if (decision.action === 'SILENT_HUMAN_ACTIVE') {
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
    const sanitizedReply = UnifiedResponseSanitizer.sanitize(decision.deterministicTemplateReply, {
      historyCount: history?.length || 0,
    });
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
  const replyText = await ReplyGenerator.generate(decision.updatedSlate, extraction, grounding, {
    history,
    customerPhone: customer.phone,
    customerInput: incomingText,
    tenantId,
  });

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
}
