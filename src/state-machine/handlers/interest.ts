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
import { buildPriceAnswer, isAskPrice, isPricelistLostRequest, buildPolicyAnswer } from '../../services/price-answer.service';
import { isLocationQueryMessage } from '../utils/location-query';
import { isNeedTimeOrDiscussionMessage } from '../utils/need-time-checker';
import { isAskingClinicLocation } from '../utils/clinic-location-checker';
import { isMultiChildTransportQuestion } from '../utils/transport-policy-checker';
import { checkPolicyInquiry } from '../utils/policy-checker';
import { stageLog } from '../../utils/stage-logger';
import { parseAgeTextToBirthDate, parseAgeTextToMonths, monthsBetween } from '../../utils/age-calculator';
import { checkMedicalKeywords } from '../../config/medical-keywords';

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
          customerName: parsed.name,
          kecamatan: parsed.kec,
          kota: parsed.kota,
          kelurahan: parsed.address,
        });

        // CAPI InitiateCheckout: Customer mengirimkan formulir reservasi yang sudah diisi
        try {
          const { fireCapiEvent } = await import('../../services/capi.service');
          fireCapiEvent({
            eventName: 'InitiateCheckout',
            customer,
            tenantId,
            customData: {
              source: 'CUSTOMER_FORM_SUBMITTED',
              treatment: parsed.treatmentDetail,
            },
          });
        } catch (capiErr) {
          console.warn('[CAPI] InitiateCheckout (customer form submit) skipped:', (capiErr as Error).message);
        }
      } catch (dbErr: any) {
        console.error(`[RESERVATION CREATE ERROR] Gagal simpan reservasi customer ${customer.phone} (${parsed.name}):`, dbErr.message);
        // Siska #777: jangan swallow silent. Simpan nama kontak dulu agar tidak hilang, lalu eskalasi dengan balasan yang jujur.
        // Di test/dev (DB offline) tetap update nama via fallback store agar test e2e tetap valid.
        const customerNameOnError = parsed.name?.trim();
        if (customerNameOnError && customerNameOnError.length > 0 && customerNameOnError.toLowerCase() !== 'bunda') {
          const kecOnError = customer.kecamatan || '';
          const contactOnError = `Bunda ${customerNameOnError}${kecOnError ? ` ${kecOnError}` : ''}`.trim();
          try {
            const { customerService: csErr } = await import('../../services/customer.service');
            await csErr.updateCustomerName(customer.id, contactOnError, tenantId);
          } catch {}
        }
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[RESERVATION CREATE] Fallback in-memory mode (DB offline) — reservasi tidak persist di production.');
        }
        await conversationService.escalateToHumanHandling(
          conversation,
          customer.phone,
          `Formulir reservasi gagal persist DB (butuh cek manual): "${parsed.treatmentDetail}" — error: ${dbErr.message}`,
          tenantId
        ).catch(() => {});
        return {
          nextState: ConversationState.HUMAN_HANDLING,
          replyText: `Baik Bunda, data reservasi sudah kami terima ya bund. Namun sistem kami sedang gangguan penyimpanan — tim kami akan segera cek manual dan konfirmasi jadwalnya ya bund. Mohon tunggu sebentar 😊`,
          shouldSendReply: true,
          isHumanHandling: true,
        };
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
        replyText: `Baik Bunda, data reservasi sudah kami terima ya bund. Kami cek dulu ya bund. 😊${shareNote}`,
        shouldSendReply: true,
        isHumanHandling: true,
      };
    } else {
      // Jika format kurang lengkap (nama & alamat kosong sama sekali), minta lengkapi
      const missing = parseResult.missingFields || [];
      const missingStr = missing.join(', ');
      return {
        nextState: ConversationState.RESERVATION_SENT,
        replyText: `Mohon maaf Bunda, mohon diisi bagian ${missingStr} pada list reservasi ya bund. Terima kasih! 😊`,
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


  // --- JEDA WAKTU / DISKUSI KELUARGA (Hold / Need Time): kalau customer minta waktu untuk tanya suami/keluarga
  if (isNeedTimeOrDiscussionMessage(lower)) {
    const needTimeReply = await phrasingService.generate({
      intent: 'need_time_acknowledgment',
      conversationId: conversation.id,
      tenantId,
      facts: { customer_message: userText },
      fallbackTemplate: `Baik Bunda, kami tunggu kabarnya ya bund 🤗 Santai saja yaa, nanti kalau sudah siap atau ada yang ingin ditanyakan lagi, langsung kabari kami ya Bunda 😊🙏🏻`,
    });
    return {
      nextState: ConversationState.AWAITING_INTEREST,
      replyText: needTimeReply,
      shouldSendReply: true,
    };
  }

  // --- MIXED-SIGNAL DETECTION ---
  // Deteksi pola "afirmasi + tapi/tetapi/tp + negasi" TANPA keluhan kesehatan/gejala → minta klarifikasi
  const hasAffirmWord = /\b(iya|yup|ok|oke|bener|betul|lanjut|benar|yes|sip|gpp|ho.?oh)\b/i.test(lower);
  const hasNegateWord = /\b(bukan|ga|gak|tidak|no|salah|enggak|beda|berubah)\b/i.test(lower);
  const hasConjunction = /\b(tapi|tetapi|tp|cuma|akan\s+tapi|tapi\s+kok|tapi\s+kan)\b/i.test(lower);
  const isHealthSymptomQuery = /\b(grok|nafas|napas|sesak|demam|panas|pilek|batuk|flu|lendir|sakit|muntah|diare|sembelit|kolik|resep|bidan|terapi|nebulizer)\b/i.test(lower);

  if (hasAffirmWord && hasNegateWord && hasConjunction && !isHealthSymptomQuery) {
    return {
      nextState: ConversationState.AWAITING_INTEREST,
      replyText: `Maaf Bunda, sepertinya ada yang kurang tepat. Bunda ingin mengubah pilihan treatment atau ada hal lain yang ingin ditanyakan? Bisa diperjelas lagi ya bund. 😊`,
      shouldSendReply: true,
    };
  }

  // Kalibrasi Redirect: Pemicu butuh kata kunci aksi (ganti, pindah, dsb) + di/ke, atau direct query
  // Guard mutual recursion: jangan redirect kembali ke location bila kita sudah pernah di-hop
  // dari location handler (intercept FAQ) — mencegah pantulan tak terbatas.
  const interceptDepth = ctx._interceptDepth || 0;
  if (interceptDepth === 0 && isLocationQueryMessage(incomingMessage, userText)) {
    const hasExplicitLocationChange = /(ganti|pindah|salah|ubah|bukan\s+di|yang\s+bener)/i.test(userText);
    if (customer.kelurahan && !hasExplicitLocationChange) {
      console.log(`[ADDRESS DETAIL SUPPLEMENT] Customer provided detailed street address "${userText}" while kelurahan is already confirmed (${customer.kelurahan}). Acknowledging without recalculation.`);
      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText: `Terima kasih Bunda, detail alamatnya (*${userText.trim()}*) sudah kami catat yaa 😊 Mau pilih treatment apa untuk Bunda atau si kecil? 😊`,
        shouldSendReply: true,
      };
    }
    console.log(`[LOCATION REDIRECT] Redirecting location query/change "${userText}" to handleLocationState.`);
    const { handleLocationState } = await import('./location');
    return handleLocationState({ ...ctx, _interceptDepth: interceptDepth + 1 });
  }

  // 1b. GATE AFIRMASI SETELAH CTA HARGA: deterministik, TANPA bergantung klasifikasi
  // intent (NLU/LLM produksi sering salah-misrout "boleh bund" → off_topic → balasan
  // generik interestUnrelatedFollowUp, padahal itu persetujuan booking).
  // CTA "Kira-kira mau treatment *{nama}* di hari apa..." (TEMPLATES.priceCta) HANYA muncul setelah lokasi
  // customer terkunci (buildPriceAnswer: hasLocation → priceCta). Jadi afirmasi singkat
  // setelah CTA = lanjut form reservasi, tanpa tanya lokasi ulang.
  const lastAssistantMsg = ctx.history && ctx.history.length > 0
    ? [...ctx.history].reverse().find((m) => m.role === 'assistant' && !!m.content)
    : undefined;
  const isPriceCtaMessage = (content: string) =>
    /^Mau coba .+\?$/mi.test(content.trim()) ||
    /mau treatment .* di hari apa/i.test(content.trim()) ||
    /mau coba /i.test(content.trim());
  const isShortAffirmAfterCta =
    lastAssistantMsg !== undefined &&
    isPriceCtaMessage(lastAssistantMsg.content) &&
    userText.trim().split(/\s+/).filter(Boolean).length <= 4 &&
    /\b(boleh|boleh\s+banget|iya|iyaa+|iyas|mau|mau\s+dong|siap|oke|ok|okey|sip|gas|lanjut|bisa|bisa\s+bunda|insya\s+allah)\b/i.test(userText) &&
    !/\b(jam|tanggal|hari|besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu|jadwal|slot)\b/i.test(userText) &&
    !/\b(ga|gak|nggak|tidak|enggak|batal|ndak|ngg|jangan|ngga)\b/i.test(userText) &&
    !/\b(tapi|tetapi|tp|cuma|asal(kan)?|kalau|kalo|syaratnya|masih|nanti|dulu|dl|dlu)\b/i.test(userText) &&
    !/\b(transfer|qris|cash|bayar|ongkir|bidan|str)\b/i.test(userText) &&
    !checkPolicyInquiry(userText) &&
    !isNeedTimeOrDiscussionMessage(userText) &&
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
    stageLog('INTENT', `Intent: [${mappedIntent}] (Confidence: ${nlu!.confidence.toFixed(2)})`, customer.phone);
  } else {
    // Fallback to legacy LLM intent service (5-intent classifier)
    intentResult = await llmIntentService.detectIntent(userText, {
      conversationId: conversation.id,
      customerPhone: customer.phone,
      bubbleCorrelationId: ctx.bubbleCorrelationId,
    });
    console.log(`[INTENT DETECTED] (Legacy LLM) Customer Message: "${userText}" → Intent: ${intentResult.intent}`);
    stageLog('INTENT', `Intent (Legacy): [${intentResult.intent}]`, customer.phone);
  }

  // --- SMART AGE MATCHER ---
  // Jika pesan menyebutkan umur (misal "anak 8 bulan", "bayi 6 bln") dan intent-nya 'other',
  // re-map secara pintar ke 'faq_question' agar diproses oleh pencarian katalog umur + RAG FAQ LLM.
  const detectedAgeMonths = parseAgeTextToMonths(userText);
  if (intentResult.intent === 'other' && detectedAgeMonths !== null) {
    console.log(`[SMART AGE MATCH] Detected age ${detectedAgeMonths} months in "${userText}". Re-mapping intent 'other' -> 'faq_question'.`);
    stageLog('INTENT', `Smart Age Match: Usia ${detectedAgeMonths} bulan → Re-mapped to faq_question`, customer.phone);
    intentResult.intent = 'faq_question';
  }

  // --- QUESTION OVERRIDE GUARD ---
  // Jika customer mengajukan pertanyaan (mengandung '?', 'tanya', 'berapa', 'brp', 'apakah', 'usia', 'darimana', dst.)
  // ATAU menanyakan lokasi klinik (isAskingClinicLocation),
  // JANGAN izinkan intent ter-map ke 'interested', 'other', atau 'off_topic'.
  // Pertanyaan WAJIB dijawab terlebih dahulu sebagai 'faq_question'!
  const isQuestionMessage = /\?/.test(userText) || 
                            /\b(tanya|bertanya|berapa|brp|apakah|bagaimana|kapan|dimana|darimana|di\s+mana|dari\s+mana|mana|usia|umur)\b/i.test(userText) ||
                            isAskingClinicLocation(userText);
  if ((intentResult.intent === 'interested' || intentResult.intent === 'other') && isQuestionMessage) {
    console.log(`[QUESTION OVERRIDE] Message "${userText}" is a question/inquiry but was mapped to '${intentResult.intent}'. Overriding to 'faq_question'.`);
    stageLog('INTENT', `Question Override: Intent '${intentResult.intent}' -> Re-mapped to 'faq_question'`, customer.phone);
    intentResult.intent = 'faq_question';
  }

  // --- REFERENTIAL SELECTION GUARD ---
  // Jika customer menjawab dengan frasa referensial pilihan treatment (misal "yang tadi saja",
  // "itu aja bund", "yang barusan", "yang itu", "yg tadi aja") dan intent-nya 'other',
  // re-map ke 'interested' karena customer sedang MEMILIH treatment yang sudah dibahas sebelumnya.
  const isReferentialSelection = /\b(yang\s+(tadi|itu|barusan|pertama|kedua)|itu\s+(aja|saja)|tadi\s+(aja|saja)|yg\s+(tadi|itu|barusan))\b/i.test(userText);
  if (intentResult.intent === 'other' && isReferentialSelection) {
    console.log(`[REFERENTIAL SELECTION] Message "${userText}" is a treatment selection (referential). Re-mapping intent 'other' -> 'interested'.`);
    stageLog('INTENT', `Referential Selection: Intent 'other' -> Re-mapped to 'interested'`, customer.phone);
    intentResult.intent = 'interested';
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
      // --- PERTANYAAN KEBIJAKAN (ONGKIR INCLUSION, PAYMENT, THERAPIST, TRANSPORT, COVERAGE) ---
      const policyType = checkPolicyInquiry(userText);
      if (policyType) {
        console.log(`[POLICY INQUIRY] Detected policy inquiry type "${policyType}" in "${userText}".`);
        stageLog('GENERATE', `Policy Inquiry: [${policyType}] answered`, customer.phone);
        const policyReply = buildPolicyAnswer(policyType, {
          kelurahan: customer.kelurahan || undefined,
          ongkir: (customer as any).ongkir ?? undefined,
        });
        return {
          nextState: ConversationState.AWAITING_INTEREST,
          replyText: policyReply,
          shouldSendReply: true,
        };
      }

      // --- JAWABAN HARGA: jika customer bertanya harga → beri tahu harga (deterministik,
      //     anti-halusinasi harga). CTA yes-yes jika lokasi sudah ada; minta lokasi jika belum.
      if (isAskPrice(userText, nlu?.intents)) {
        const hasLocation = !!(customer.kelurahan && customer.lat && customer.lng);

        // Resolusi anaphora: pesan generik ("berapa itu bund?") tanpa nama treatment
        let candidateTreatmentName: string | undefined;
        const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
        const userMatches = treatmentCatalogService.searchCatalogItems(userText);

        if (userMatches.length > 0) {
          const cleanName = userMatches[0].name.trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
          await conversationService.updateLastDiscussedTreatment(conversation.id, tenantId, cleanName).catch(() => {});
        } else if (ctx.history && ctx.history.length > 0) {
          // Hanya cari di 4 pesan terakhir dalam riwayat chat AKTIF
          const recentHistory = ctx.history.slice(-4);
          for (let i = recentHistory.length - 1; i >= 0; i--) {
            const msg = recentHistory[i];
            if (msg.role !== 'assistant' || !msg.content) continue;
            const botMatch = treatmentCatalogService.searchCatalogItems(msg.content);
            if (botMatch.length > 0) {
              candidateTreatmentName = botMatch[0].name.trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
              console.log(`[PRICE ANAPHORA] No treatment in "${userText}", resolved from active history → "${candidateTreatmentName}".`);
              await conversationService.updateLastDiscussedTreatment(conversation.id, tenantId, candidateTreatmentName).catch(() => {});
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
      let relevantChunks = await knowledgeBaseService.searchRelevantChunks(userText, 3, tenantId);

      // Jika customer menanyakan lokasi klinik/homebase, pastikan chunk lokasi klinik selalu ada di context
      if (isAskingClinicLocation(userText)) {
        const clinicName = getBrandIdentity().businessName || 'Kala Moms and Baby Spa';
        const clinicChunk = {
          id: 'clinic-location-faq',
          tenantId,
          sourceType: 'FAQ' as any,
          title: `Lokasi Klinik dan Layanan Homecare ${clinicName}`,
          content: `Pertanyaan: Di mana lokasi/alamat kantor ${clinicName}?\nJawaban: Kami berlokasi di daerah Waru (perbatasan Sidoarjo - Surabaya), Bunda. Kami melayani sistem Homecare (panggilan langsung ke rumah), jadi tim bidan bersertifikat kami yang datang langsung ke rumah Bunda di area Surabaya & Sidoarjo sehingga Bunda tidak perlu repot keluar rumah.`,
          documentName: 'faq-lokasi-klinik',
        };
        relevantChunks = [clinicChunk, ...relevantChunks.filter(c => c.id !== 'clinic-location-faq')];
      }

      // 2b. Jika FAQ tidak match, FALLBACK ke katalog treatment sebagai konteks LLM.
      // Data treatment (durasi, usia, deskripsi, manfaat) dijadikan knowledge — TANPA harga.
      // Context di-inject sebagai blok DATA TERSTRUKTUR (bukan jawaban jadi) agar LLM menyusun
      // kalimat rekomendasi sendiri dari fakta, tidak meniru format katalog yang kaku.
      let chunksToUse = relevantChunks;
      if (chunksToUse.length === 0) {
        const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
        
        let catalogItems: any[] = [];
        let isAgeMatch = false;

        if (detectedAgeMonths !== null) {
          const hasSymptomOrMedical = checkMedicalKeywords(userText).isMedical ||
                                      /\b(batuk|pilek|bapil|flu|demam|panas|grok|kembung|kolik|sembelit|susah\s*bab|rewel|terapi|sakit|uap|nebu)\b/i.test(userText);
          catalogItems = treatmentCatalogService.getServicesByAge(detectedAgeMonths, !hasSymptomOrMedical);
          if (catalogItems.length > 0) {
            isAgeMatch = true;
            console.log(`[AGE SMART MATCH] Injecting ${catalogItems.length} catalog items for age ${detectedAgeMonths} months (onlyGeneral: ${!hasSymptomOrMedical}).`);
          }
        }

        if (catalogItems.length === 0) {
          const matchedItems = treatmentCatalogService.searchCatalogItems(userText);
          catalogItems = matchedItems.length > 0 ? matchedItems : treatmentCatalogService.getAllServices();
        }

        if (catalogItems.length > 0) {
          const isSpecific = catalogItems.length < treatmentCatalogService.getAllServices().length;
          const catalogData = treatmentCatalogService.formatCatalogData(catalogItems);
          chunksToUse = [{
            id: isAgeMatch ? 'treatment-catalog-age' : (isSpecific ? 'treatment-catalog-specific' : 'treatment-catalog'),
            tenantId,
            sourceType: 'catalog' as any,
            title: isAgeMatch
              ? `Layanan Treatment yang Cocok untuk Usia Terdeteksi`
              : (isSpecific
                ? 'Layanan Treatment Relevan dengan Pertanyaan'
                : `Katalog Layanan Treatment ${getBrandIdentity().businessName}`),
            content: catalogData,
            documentName: 'treatment-catalog',
          }];
          console.log(`[FAQ CATALOG FALLBACK] Injecting ${isAgeMatch ? 'age-filtered' : (isSpecific ? 'specific' : 'full')} treatment catalog as context.`);
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
      //
      // GUARD ANTI HARD-SELLING (FAQ murni): treatmentNameForFollowUp HANYA diisi jika
      // customer MENYEBUT NAMA FULL treatment di pesan (exact phrase nama katalog tanpa
      // kurung, lowercase). Match parsial/fuzzy (mis. "pijat bayi" → 2 kata awal dari
      // "Pijat Bayi Ceria") TIDAK cukup — memaksanya ke instruksi CTA membuat LLM
      // hard-selling paket yang tidak ditanyakan (mis. "Paket Selapan") pada pertanyaan
      // edukatif (usia minimal, jam buka, dll). Entity NLU tidak dipakai di jalur ini.
      const lowerUserText = userText.toLowerCase();
      let treatmentNameForFollowUp: string | undefined;
      try {
        const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
        const explicitlyMentioned = treatmentCatalogService.getAllServices().find((s) => {
          const cleanName = s.name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim();
          return !!cleanName && lowerUserText.includes(cleanName);
        });
        if (explicitlyMentioned) {
          treatmentNameForFollowUp = explicitlyMentioned.name.trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
        }
      } catch (_) { /* abaikan — CTA tetap netral */ }

      if (treatmentNameForFollowUp) {
        await conversationService.updateLastDiscussedTreatment(conversation.id, tenantId, treatmentNameForFollowUp).catch(() => {});
      }

      // 4. Generate balasan FAQ natural berbasis RAG + Persona (CTA menyatu dalam 1 generation call)
      const additionalContextText = (ctx as any).additionalContextText;
      const isLocationKnown = Boolean(customer.kelurahan) || Boolean(additionalContextText);
      const faqResult = await llmResponseGenerator.generateFaqResponseWithDetails(
        userText,
        chunksToUse,
        conversation.id,
        tenantId,
        treatmentNameForFollowUp,
        customer.id,
        isLocationKnown,
        additionalContextText,
        customer.phone,
        customer.name,
        ctx.bubbleCorrelationId
      );

      // 4b. Simpan memori pelanggan jika LLM mengekstrak fakta permanen baru
      if (faqResult.extracted_preferences && Object.keys(faqResult.extracted_preferences).length > 0) {
        try {
          const { prisma } = await import('../../db/client'); // lazy-import (pola existing)
          const currentCust = await prisma.customer.findUnique({ where: { id: customer.id } });
          const merged = {
            ...((currentCust?.preferences as Record<string, any>) || {}),
            ...faqResult.extracted_preferences,
          };
          await prisma.customer.update({
            where: { id: customer.id },
            data: { preferences: merged },
          });
          console.log('[CUSTOMER MEMORY] Saved new preferences:', faqResult.extracted_preferences);
        } catch (_) {
          // DB down → abaikan, jangan ganggu loop respon
        }
      }

      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText: faqResult.answer,
        shouldSendReply: true,
        aiReasoning: faqResult.reasoning,
      };
    }

    case 'interested': {
      // 1. Cek apakah ada pertanyaan kebijakan yang menyertai afirmasi (mis. "Boleh bund, tapi bayarnya bisa transfer?")
      const policyTypeInInterested = checkPolicyInquiry(userText);
      if (policyTypeInInterested) {
        console.log(`[POLICY INQUIRY IN INTERESTED] User message "${userText}" has policy inquiry "${policyTypeInInterested}".`);
        const policyReply = buildPolicyAnswer(policyTypeInInterested, {
          kelurahan: customer.kelurahan || undefined,
          ongkir: (customer as any).ongkir ?? undefined,
        });
        return {
          nextState: ConversationState.AWAITING_INTEREST,
          replyText: policyReply,
          shouldSendReply: true,
        };
      }

      // 2. Cek apakah customer meminta jeda waktu / diskusi (mis. "Boleh, nanti tanya suami dulu ya")
      if (isNeedTimeOrDiscussionMessage(userText)) {
        console.log(`[NEED TIME IN INTERESTED] User message "${userText}" is a need-time message.`);
        const needTimeReply = await phrasingService.generate({
          intent: 'need_time_acknowledgment',
          conversationId: conversation.id,
          tenantId,
          facts: { customer_message: userText },
          fallbackTemplate: `Baik Bunda, kami tunggu kabarnya ya bund 🤗 Santai saja yaa, nanti kalau sudah siap, langsung kabari kami kembali ya Bunda 😊🙏🏻`,
        });
        return {
          nextState: ConversationState.AWAITING_INTEREST,
          replyText: needTimeReply,
          shouldSendReply: true,
        };
      }

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
          name: customer.name || undefined,
          address: customer.kelurahan || undefined,
          kecamatan: customer.kecamatan || undefined,
          kota: customer.kota || undefined,
          phone: customer.phone || undefined,
        }),
        shouldSendReply: true,
      };
    }

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
        facts: { customer_message: userText },
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
