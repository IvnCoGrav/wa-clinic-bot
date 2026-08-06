import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { llmIntentService, IntentType } from '../../integrations/llm/intent';
import { knowledgeBaseService } from '../../services/knowledge.service';
import { llmResponseGenerator } from '../../integrations/llm/generator';
import { phrasingService } from '../../integrations/llm/phrasing.service';
import { conversationService } from '../../services/conversation.service';
import { TEMPLATES } from '../../config/persona';
import { getBrandIdentity } from '../../config/brand';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { fireCapiEvent } from '../../services/capi.service';
import { isPureIdleGreeting } from '../utils/idle-greeting';
import { buildPriceAnswer, isAskPrice, isPricelistLostRequest } from '../../services/price-answer.service';
import { isLocationQueryMessage } from '../utils/location-query';

/**
 * Handler untuk state AWAITING_INTEREST:
 * Mengklasifikasikan respons pengguna (Interested, FAQ Question, Asking Schedule, Not Interested, Other).
 */
export async function handleInterestState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { incomingMessage, customer, conversation } = ctx;
  const tenantId = ctx.tenantId || customer?.tenant_id || DEFAULT_TENANT_ID;
  const userText = incomingMessage.text?.body || '';

  const lower = userText.toLowerCase().trim();

  // 0. PENGECEKAN UTAMA: Cek jika customer mengirimkan form reservasi (RESERVATION_SENT atau AWAITING_INTEREST)
  //    Kata kunci utama = format_checkout tenant (default "list untuk reservasi :").
  //    Backward-compat: "berikut list untuk reservasi" tetap dikenali meski config berubah.
  const { getTenantCapiFormats } = await import('../../services/capi.service');
  const tenantFormats = await getTenantCapiFormats(tenantId);
  const checkoutKeyword = tenantFormats.formatCheckout.toLowerCase();
  const tenantCheckoutHit =
    checkoutKeyword.length > 0 && lower.includes(checkoutKeyword.replace(/\s+/g, ' ').trim());
  const isFormSubmission =
    lower.includes('berikut list untuk reservasi') ||
    tenantCheckoutHit ||
    (lower.includes('pilihan treatment') && (lower.includes('nama bunda') || lower.includes('alamat')));
                           
  if (isFormSubmission) {
    const { parseReservationText } = await import('../../utils/reservation-text-parser');
    const parseResult = parseReservationText(userText);

    if (parseResult.success && parseResult.reservation) {
      const parsed = parseResult.reservation;
      // Simpan reservasi ke database
      let createdReservationId: string | null = null;
      try {
        const { prisma } = await import('../../db/client');
        const reservation = await prisma.reservation.create({
          data: {
            tenant_id: tenantId,
            customer_id: customer.id,
            treatment_category: parsed.treatmentCategory,
            treatment_detail: parsed.treatmentDetail,
            booking_date: parsed.bookingDate,
            raw_text: userText,
            status: 'pending',
          },
        });
        createdReservationId = reservation.id;

        const { reservationLifecycleService } = await import('../../services/reservation-lifecycle.service');
        await reservationLifecycleService.onReservationCreated({
          customerId: customer.id,
          reservationId: reservation.id,
          tenantId,
          chatId: ctx.incomingMessage.chatId || `${customer.phone}@c.us`,
          babies: parsed.babies || [],
        });
      } catch (dbErr) {
        // Abaikan error DB untuk in-memory fallback
      }

      // Simpan nama kontak customer: "Bunda {nama} {kecamatan}"
      // Hanya update jika customer mengisi nama di form reservasi
      const customerName = parsed.name?.trim();
      if (customerName && customerName.length > 0 && customerName.toLowerCase() !== 'bunda') {
        const kecamatan = customer.kecamatan || '';
        const contactName = `Bunda ${customerName}${kecamatan ? ` ${kecamatan}` : ''}`.trim();
        console.log(`[CONTACT SAVE] Saving customer name as contact: "${contactName}"`);
        try {
          const { customerService } = await import('../../services/customer.service');
          await customerService.updateCustomerName(customer.id, contactName, tenantId);
        } catch (nameErr: any) {
          console.warn('[CONTACT SAVE] Failed to update customer name:', nameErr.message);
        }
      }

      // Eskalasi ke human handling untuk konfirmasi jadwal manual oleh admin
      await conversationService.escalateToHumanHandling(
        conversation,
        customer.phone,
        `Formulir reservasi telah diisi oleh customer: "${parsed.treatmentDetail}"`,
        tenantId
      );

      // Minta share-location (pin) jika customer belum pernah mengirimkannya — biar admin
      // punya titik presisi. Hanya dijalankan SETELAH customer mengirim form yang sudah diisi.
      const shareNote = customer.share_location_sent ? '' : `\n\n${TEMPLATES.askShareLocation()}`;

      return {
        nextState: ConversationState.HUMAN_HANDLING,
        replyText: `Terima kasih Bunda, Data reservasi sudah kami terima ya Bund. 😊${shareNote}`,
        shouldSendReply: true,
        isHumanHandling: true,
      };
    } else {
      // Jika format kurang lengkap, minta lengkapi field yang kurang
      const missing = parseResult.missingFields || [];
      const missingStr = missing.join(', ');
      return {
        nextState: ConversationState.RESERVATION_SENT,
        replyText: `Maaf Bunda, data reservasi yang dikirimkan kurang lengkap. Mohon isi bagian berikut ya bund: ${missingStr}. Terima kasih! 😊`,
        shouldSendReply: true,
      };
    }
  }

  // 0b. GATE PRICELIST HILANG / TIDAK TERKIRIM: deterministik (regex keyword), TANPA
  // bergantung pada klasifikasi intent (NLU/LLM bisa salah-misrout "pricelist tidak terkirim"
  // ke not_interested karena kata "tidak"). Dicek SEBELUM intent detection supaya selalu
  // force kirim ulang pricelist image.
  if (isPricelistLostRequest(userText)) {
    const ans = buildPriceAnswer(userText, {
      hasLocation: true,
      pricelistAlreadySent: false,
    });
    return {
      nextState: ConversationState.AWAITING_INTEREST,
      replyText: ans.replyText,
      shouldSendReply: true,
      sendPricelistImage: !!ans.pricelist,
      pricelistCaption: ans.pricelist?.caption,
      forcePricelistResend: ans.pricelist?.force,
    };
  }

  // --- MIXED-SIGNAL DETECTION ---
  // Deteksi pola "afirmasi + tapi/tetapi/tp + negasi" → minta klarifikasi
  const hasAffirmWord = /\b(iya|yup|ok|oke|bener|betul|lanjut|benar|yes|sip|gpp|ho.?oh)\b/i.test(lower);
  const hasNegateWord = /\b(bukan|ga|gak|tidak|no|salah|enggak|beda|berubah)\b/i.test(lower);
  const hasConjunction = /\b(tapi|tetapi|tp|cuma|akan\s+tapi|tapi\s+kok|tapi\s+kan)\b/i.test(lower);
  
  if (hasAffirmWord && hasNegateWord && hasConjunction) {
    return {
      nextState: ConversationState.AWAITING_INTEREST,
      replyText: `Maaf Bunda, sepertinya ada yang kurang tepat. Bunda ingin mengubah lokasi atau informasi lainnya? Bisa diperjelas lagi ya bund. 😊`,
      shouldSendReply: true,
    };
  }

  // Kalibrasi Redirect: Pemicu butuh kata kunci aksi (ganti, pindah, dsb) + di/ke, atau direct query
  // Guard mutual recursion: jangan redirect kembali ke location bila kita sudah pernah di-hop
  // dari location handler (intercept FAQ) — mencegah pantulan tak terbatas.
  const interceptDepth = ctx._interceptDepth || 0;
  if (interceptDepth === 0 && isLocationQueryMessage(incomingMessage, userText)) {
    console.log(`[LOCATION REDIRECT] Redirecting location query/change "${userText}" to handleLocationState.`);
    const { handleLocationState } = await import('./location');
    return handleLocationState({ ...ctx, _interceptDepth: interceptDepth + 1 });
  }

  // 1b. GATE AFIRMASI SETELAH CTA HARGA: deterministik, TANPA bergantung klasifikasi
  // intent (NLU/LLM produksi sering salah-misrout "boleh bund" → off_topic → balasan
  // generik interestUnrelatedFollowUp, padahal itu persetujuan booking).
  // CTA "Mau coba {nama} bunda ?" (TEMPLATES.priceCta) HANYA muncul setelah lokasi
  // customer terkunci (buildPriceAnswer: hasLocation → priceCta). Jadi afirmasi singkat
  // setelah CTA = lanjut form reservasi, tanpa tanya lokasi ulang.
  const lastAssistantMsg = ctx.history && ctx.history.length > 0
    ? [...ctx.history].reverse().find((m) => m.role === 'assistant' && !!m.content)
    : undefined;
  const isPriceCtaMessage = (content: string) => /^Mau coba .+\?$/mi.test(content.trim());
  const isShortAffirmAfterCta =
    lastAssistantMsg !== undefined &&
    isPriceCtaMessage(lastAssistantMsg.content) &&
    userText.trim().split(/\s+/).filter(Boolean).length <= 4 &&
    /\b(boleh|boleh\s+banget|iya|iyaa+|iyas|mau|mau\s+dong|siap|oke|ok|okey|sip|gas|lanjut|bisa|bisa\s+bunda|insya\s+allah)\b/i.test(userText) &&
    !/\b(jam|tanggal|hari|besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu|jadwal|slot)\b/i.test(userText) &&
    !/\b(ga|gak|nggak|tidak|enggak|batal|ndak|ngg|jangan|ngga)\b/i.test(userText) &&
    !/\?/.test(userText.trim());

  if (isShortAffirmAfterCta) {
    console.log(`[CTA CONSENT] "Mau coba..." CTA + afirmasi "${userText}" → lanjut ke form reservasi.`);
    if (!customer.kelurahan || !customer.lat || !customer.lng) {
      return {
        nextState: ConversationState.AWAITING_LOCATION,
        replyText: `Baik Bunda, sebelum melakukan reservasi, mohon informasikan detail kelurahan/desa atau kirimkan share location Bunda terlebih dahulu ya bund, agar kami bisa cek jarak dan ongkirnya terlebih dahulu. 😊`,
        shouldSendReply: true,
      };
    }
    // CAPI InitiateCheckout: form reservasi dikirim → user memulai checkout.
    fireCapiEvent({
      eventName: 'InitiateCheckout',
      customer,
      tenantId,
      customData: { source: 'BOT_FORM_SENT' },
    });
    return {
      nextState: ConversationState.RESERVATION_SENT,
      replyText: TEMPLATES.reservationFormRequest({
        kecamatan: customer.kecamatan || undefined,
        kota: customer.kota || undefined,
        phone: customer.phone || undefined,
      }),
      shouldSendReply: true,
    };
  }

  // 1. Deteksi Intent — NLU Layer-first, dengan fallback ke legacy llmIntentService
  //
  // ATURAN PRIORITAS: State machine tetap memegang kendali. NLU hanya mempercepat dan
  // memperkaya input klasifikasi. Jika NLU confident (>= 0.6, non-fallback), kita mapping
  // NLU intents ke legacy IntentType taxonomy dan skip extra LLM call.
  // Jika NLU tidak tersedia atau confidence rendah, jatuh ke llmIntentService seperti semula.

  const nlu = ctx.nluResult;
  const nluConfident = nlu && !nlu.isFallback && (nlu.confidence || 0) >= 0.6;

  let intentResult: { intent: IntentType; confidence: number };

  if (nluConfident) {
    // Map NLU taxonomy → legacy IntentType (preserve all existing switch branches)
    let mappedIntent: IntentType = 'other';

    if (nlu!.intents.includes('medical_query')) {
      mappedIntent = 'medical_query';
    } else if (nlu!.intents.includes('complaint')) {
      mappedIntent = 'complaint';
    } else if (nlu!.intents.includes('ask_schedule')) {
      mappedIntent = 'asking_schedule';
    } else if (nlu!.intents.includes('faq_question') || nlu!.intents.includes('ask_price')) {
      mappedIntent = 'faq_question';
    } else if (nlu!.intents.includes('express_interest') || nlu!.intents.includes('affirmation')) {
      mappedIntent = 'interested';
    } else if (nlu!.intents.includes('negation')) {
      mappedIntent = 'not_interested';
    } else if (nlu!.intents.includes('off_topic') || nlu!.intents.includes('greeting')) {
      mappedIntent = 'other';
    }

    intentResult = { intent: mappedIntent, confidence: nlu!.confidence };
    console.log(`[INTENT DETECTED] (NLU Layer) Customer: "${userText}" → NLU intents: [${nlu!.intents.join(',')}] → Mapped: ${mappedIntent} (conf: ${nlu!.confidence.toFixed(2)})`);
  } else {
    // Fallback to legacy LLM intent service (5-intent classifier)
    intentResult = await llmIntentService.detectIntent(userText);
    console.log(`[INTENT DETECTED] (Legacy LLM) Customer Message: "${userText}" → Intent: ${intentResult.intent}`);
  }

  switch (intentResult.intent) {
    case 'medical_query':
    case 'complaint':
      // Eskalasi langsung ke Human secara senyap (tanpa balas chat bot)
      await conversationService.escalateToHumanHandling(
        conversation,
        customer.phone,
        `Customer menyampaikan keluhan medis/komplain: "${userText}"`,
        tenantId
      );
      return {
        nextState: ConversationState.HUMAN_HANDLING,
        shouldSendReply: false,
        isHumanHandling: true,
      };

    case 'faq_question': {
      // --- JAWABAN HARGA: jika customer bertanya harga → beri tahu harga (deterministik,
      //     anti-halusinasi harga). CTA yes-yes jika lokasi sudah ada; minta lokasi jika belum.
      if (isAskPrice(userText, nlu?.intents)) {
        const hasLocation = !!(customer.kelurahan && customer.lat && customer.lng);

        // Resolusi anaphora: pesan generik ("berapa itu bund?") tanpa nama treatment → cari
        // treatment yang baru saja direkomendasikan bot di riwayat percakapan (pesan assistant terakhir).
        let candidateTreatmentName: string | undefined;
        const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
        if (treatmentCatalogService.searchCatalogItems(userText).length === 0 && ctx.history && ctx.history.length > 0) {
          for (let i = ctx.history.length - 1; i >= 0; i--) {
            const msg = ctx.history[i];
            if (msg.role !== 'assistant' || !msg.content) continue;
            const botMatch = treatmentCatalogService.searchCatalogItems(msg.content);
            if (botMatch.length > 0) {
              candidateTreatmentName = botMatch[0].name.trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
              console.log(`[PRICE ANAPHORA] No treatment in "${userText}", resolved from bot history → "${candidateTreatmentName}".`);
              break;
            }
          }
        }

        const ans = buildPriceAnswer(userText, {
          hasLocation,
          pricelistAlreadySent: !!customer.pricelist_sent,
          candidateTreatmentName,
        });
        return {
          nextState: ConversationState.AWAITING_INTEREST,
          replyText: ans.replyText,
          shouldSendReply: true,
          sendPricelistImage: !!ans.pricelist,
          pricelistCaption: ans.pricelist?.caption,
          forcePricelistResend: ans.pricelist?.force,
        };
      }

      // 2. Query Knowledge Base menggunakan Postgres Full-Text Search ('simple')
      const relevantChunks = await knowledgeBaseService.searchRelevantChunks(userText, 3, tenantId);

      // 2b. Jika FAQ tidak match, FALLBACK ke katalog treatment sebagai konteks LLM.
      // Data treatment (durasi, usia, deskripsi, manfaat) dijadikan knowledge — TANPA harga.
      // Context di-inject sebagai blok DATA TERSTRUKTUR (bukan jawaban jadi) agar LLM menyusun
      // kalimat rekomendasi sendiri dari fakta, tidak meniru format katalog yang kaku.
      let chunksToUse = relevantChunks;
      if (chunksToUse.length === 0) {
        const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
        // Coba match treatment spesifik dari pertanyaan
        const matchedItems = treatmentCatalogService.searchCatalogItems(userText);
        const catalogItems = matchedItems.length > 0
          ? matchedItems
          : treatmentCatalogService.getAllServices();
        if (catalogItems.length > 0) {
          const isSpecific = matchedItems.length > 0;
          const catalogData = treatmentCatalogService.formatCatalogData(catalogItems);
          chunksToUse = [{
            id: isSpecific ? 'treatment-catalog-specific' : 'treatment-catalog',
            tenantId,
            sourceType: 'catalog' as any,
            title: isSpecific
              ? 'Layanan Treatment Relevan dengan Pertanyaan'
              : `Katalog Layanan Treatment ${getBrandIdentity().businessName}`,
            content: catalogData,
            documentName: 'treatment-catalog',
          }];
          console.log(`[FAQ CATALOG FALLBACK] No KB match for "${userText}", injecting ${isSpecific ? 'specific' : 'full'} treatment catalog as context.`);
        }
      }

      // Jika tidak ada FAQ yang cocok dan tidak ada katalog, lempar ke manusia tanpa balas chat
      if (chunksToUse.length === 0) {
        console.log(`[FAQ ESCALATION] No relevant chunks found for: "${userText}". Escalating silently.`);
        await conversationService.escalateToHumanHandling(
          conversation,
          customer.phone,
          `Pertanyaan FAQ tidak terjawab di database: "${userText}"`,
          tenantId
        );
        return {
          nextState: ConversationState.HUMAN_HANDLING,
          shouldSendReply: false,
          isHumanHandling: true,
        };
      }

      // 3. Extract nama treatment spesifik untuk follow-up personal (jika ada)
      let treatmentNameForFollowUp: string | undefined;
      // Ambil dari NLU entity jika tersedia
      const nluTreatment = ctx.nluResult?.entities?.treatment_name;
      if (nluTreatment && typeof nluTreatment === 'string') {
        treatmentNameForFollowUp = nluTreatment;
      }
      // Coba ambil nama RESMI dari catalog match (lebih akurat daripada entity mentah)
      try {
        const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
        const catalogMatch = treatmentCatalogService.searchCatalogItems(userText);
        if (catalogMatch.length > 0) {
          const first = catalogMatch[0];
          // Bersihkan nama: buang suffix kurung (misal "(Add-on)", "(Rileksasi)")
          const cleanName = first.name.trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
          if (cleanName) {
            treatmentNameForFollowUp = cleanName;
          }
        }
      } catch (_) { /* abaikan, pakai entity NLU */ }

      // 4. Generate balasan FAQ natural berbasis RAG + Persona (CTA menyatu dalam 1 generation call)
      const faqAnswer = await llmResponseGenerator.generateFaqResponse(userText, chunksToUse, conversation.id, tenantId, treatmentNameForFollowUp);

      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText: faqAnswer,
        shouldSendReply: true,
      };
    }

    case 'interested':
      if (!customer.kelurahan || !customer.lat || !customer.lng) {
        return {
          nextState: ConversationState.AWAITING_LOCATION,
          replyText: `Baik Bunda, sebelum melakukan reservasi, mohon informasikan detail kelurahan/desa atau kirimkan share location Bunda terlebih dahulu ya bund, agar kami bisa cek jarak dan ongkirnya terlebih dahulu. 😊`,
          shouldSendReply: true,
        };
      }
      // CAPI InitiateCheckout: form reservasi dikirim → user memulai checkout.
      fireCapiEvent({
        eventName: 'InitiateCheckout',
        customer,
        tenantId,
        customData: { source: 'BOT_FORM_SENT' },
      });
      return {
        nextState: ConversationState.RESERVATION_SENT,
        replyText: TEMPLATES.reservationFormRequest({
          kecamatan: customer.kecamatan || undefined,
          kota: customer.kota || undefined,
          phone: customer.phone || undefined,
        }),
        shouldSendReply: true,
      };

    case 'asking_schedule':
      // Eskalasi ke Human Handling + simpan previous_state = AWAITING_INTEREST
      await conversationService.escalateToHumanHandling(
        conversation,
        customer.phone,
        `Customer bertanya jadwal spesifik: "${userText}"`,
        tenantId
      );

      const scheduleHandoffReply = await phrasingService.generate({
        intent: 'schedule_check_handoff',
        conversationId: conversation.id,
        tenantId,
        fallbackTemplate: TEMPLATES.scheduleCheckHandoff(),
      });

      return {
        nextState: ConversationState.HUMAN_HANDLING,
        replyText: scheduleHandoffReply,
        shouldSendReply: true,
        isHumanHandling: true,
      };

    case 'not_interested':
      return {
        nextState: ConversationState.COMPLETED,
        replyText: TEMPLATES.notInterestedReply(),
        shouldSendReply: true,
      };

    case 'other':
    default: {
      // GATE WARM REOPENING GREETING: sapaan basa-basi di sesi idle panjang → warm greeting.
      // Intent `greeting` di-map ke 'other' di atas (interest.ts mapping), TAPI intents ORIGINAL
      // tetap tersedia via ctx.nluResult?.intents — helper memakai itu untuk memastikan pesan
      // benar-benar sapaan murni (tanpa intent spesifik yang tersembunyi di balik mapping).
      const idleGreeting = isPureIdleGreeting({
        messageText: userText,
        lastMessageAt: conversation.last_message_at,
        nluIntents: ctx.nluResult?.intents,
        tenantId,
      });
      if (idleGreeting) {
        return {
          nextState: ConversationState.AWAITING_INTEREST,
          replyText: TEMPLATES.warmReopenGreeting(),
          shouldSendReply: true,
        };
      }
      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText: TEMPLATES.interestUnrelatedFollowUp(),
        shouldSendReply: true,
      };
    }
  }
}
