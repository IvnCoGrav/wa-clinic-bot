import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { TEMPLATES } from '../../config/persona';
import { getBrandIdentity } from '../../config/brand';
import { geocodingService } from '../../integrations/google-maps/geocoding';
import { isPureIdleGreeting } from '../utils/idle-greeting';
import { phrasingService } from '../../integrations/llm/phrasing.service';

import { sanitizeLocationTextForGeocoding } from '../../utils/location-sanitizer';

/**
 * Handler untuk state INITIAL:
 * Ketika pesan pertama kali masuk dari nomor baru / percakapan baru / setelah reset idle 24 jam.
 * Mengimplementasikan retensi lokasi tersimpan, deteksi override pin/teks langsung, dan kata kunci afirmatif.
 *
 * ATURAN PRIORITAS NLU (Conflict Resolution Rule):
 * State Machine memegang kendali alur bisnis. Jika customer di state AWAITING_LOCATION/INITIAL
 * dan NLU mendeteksi intent sela (ask_price, faq_question, dsb), handler BOLEH memberikan
 * jawaban singkat untuk pertanyaan sela, NAMUN wajib diakhiri dengan re-prompt yang meminta
 * input yang diperlukan oleh state aktif (lokasi). Prinsip: STATE PUNYA PRIORITAS.
 */
export async function handleGreetingState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { customer, conversation, incomingMessage } = ctx;
  const tenantId = ctx.tenantId || customer.tenant_id || 'default';
  const userText = incomingMessage.text?.body || '';
  const lower = userText.toLowerCase().trim();

  // 1. Deteksi apakah customer langsung mengirim share-location pin
  const isPin = incomingMessage.type === 'location' && incomingMessage.location;
  
  // 2. Deteksi teks lokasi terarah (Direct Location Query / Geocoding Dini)
  // NLU Enhancement: Prefer location_text entity from NLU over raw text for geocoding
  const nluLocationText = ctx.nluResult?.entities?.location_text;

  // Ekstraksi frasa kandidat lokasi dari kalimat percakapan (misal "Rumah sy di kalijudan taruna V")
  const extractedLocationPhrase = (() => {
    const match = userText.match(/\b(?:di|ke|rumah\s*(?:saya|sy)?\s*di|alamat\s*(?:saya|sy)?\s*di|daerah|kelurahan|desa|kecamatan)\s+([^,.!?\n]+)/i);
    return match ? match[1].trim() : null;
  })();

  const rawLocationText = nluLocationText || extractedLocationPhrase || userText;
  const textForGeocode = sanitizeLocationTextForGeocoding(rawLocationText);

  const hasOngkirLocationSignal = /\bongkir\b/i.test(userText) && textForGeocode.length >= 3;
  const hasLocationKeyword = !!extractedLocationPhrase ||
                             hasOngkirLocationSignal ||
                             /\bongkir\s+(?:ke|di)?\s+[a-z]+/i.test(userText.trim()) ||
                             /\b(di|ke|rumah\s*(?:saya|sy)?\s*di|alamat\s*(?:saya|sy)?\s*di)\s+[a-z]+/i.test(userText.trim()) ||
                             /^(saya\s+)?di\s+[a-z]+/i.test(userText.trim()) || 
                             /^kalau\s+di\s+[a-z]+/i.test(userText.trim());

  // NLU: If NLU confident-detected provide_location intent, treat as location text
  const nluIndicatesLocation = ctx.nluResult && 
    !ctx.nluResult.isFallback && 
    ctx.nluResult.confidence >= 0.6 &&
    ctx.nluResult.intents.includes('provide_location');

  // Jalankan geocodeText untuk melihat apakah teks memuat alamat/kelurahan valid secara langsung
  let hasValidGeocode = false;
  try {
    const resolved = await geocodingService.geocodeText(textForGeocode);
    if (resolved.isPrecise || resolved.isFuzzyMatch || (resolved.ambiguityResults && resolved.ambiguityResults.length > 0)) {
      hasValidGeocode = true;
    }
  } catch (err) {
    console.error('Failed to geocode greeting text:', err);
  }

  const isLocationText = hasLocationKeyword || hasValidGeocode || nluIndicatesLocation;

  // Prioritas Override Utama: Jika ada input lokasi baru (Pin atau teks lokasi langsung)
  if (isPin || isLocationText) {
    const { handleLocationState } = await import('./location');
    const locationTextToPass = textForGeocode.length >= 3 ? textForGeocode : rawLocationText;
    const result = await handleLocationState({
      ...ctx,
      extractedLocationForGeocode: locationTextToPass,
    } as any);

    // Perbaikan Poin 3b: Jika customer baru (belum punya kelurahan confirmed)
    const hasConfirmedLocation = !!customer.kelurahan;
    if (!hasConfirmedLocation && result.replyText) {
      const intro = `Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya ${getBrandIdentity().botDisplayName} dari ${getBrandIdentity().businessName}. ✨\n\n`;
      result.replyText = intro + result.replyText;
    }

    return result;
  }

  // Hitung skipGreeting (apakah chat terakhir berjarak < 48 jam)
  const lastInteraction = conversation.last_message_at;
  const isNew = !lastInteraction || (lastInteraction.getTime() === conversation.created_at.getTime());
  const skipGreeting = !isNew && (Date.now() - new Date(lastInteraction).getTime() < 48 * 60 * 60 * 1000);

  // GATE WARM REOPENING GREETING: sapaan basa-basi di sesi idle panjang (>= min_hours,
  // default 36 jam) → balas sapaan hangat open-ended (bukan pitch reservasi).
  // Berjalan SEBELUM logika lokasi/FAQ/skipGreeting — prioritas tertinggi untuk pure greeting.
  if (isPureIdleGreeting({
    messageText: userText,
    lastMessageAt: conversation.last_message_at,
    nluIntents: ctx.nluResult?.intents,
    tenantId,
  })) {
    return {
      nextState: ConversationState.AWAITING_INTEREST,
      replyText: TEMPLATES.warmReopenGreeting(),
      shouldSendReply: true,
    };
  }

  // 3. RETENSI LOKASI: Jika customer sudah memiliki lokasi confirmed sebelumnya
  if (customer.kelurahan && customer.lat && customer.lng) {
    // NLU Enhancement: use affirmation intent if detected with high confidence
    const nluAffirmation = ctx.nluResult?.intents?.includes('affirmation') && (ctx.nluResult?.confidence || 0) >= 0.6;
    const isAffirmative = nluAffirmation ||
      /\b(iya|yup|ok|oke|bener|betul|lanjut|benar|yes|sip|gpp)\b/i.test(lower) || 
      /^ya\b(?!\s*(ampun|elah|udah|deh|lord|allah|kali|gitu|begitu|tapi|bukan|salah|kok|sih))/i.test(lower) || 
      lower.includes('👍');
    
    // Jika mereka membalas menyetujui alamat lama (Afirmatif)
    if (isAffirmative) {
      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText: `Baik Bunda, alamat homecare menggunakan data sebelumnya di *Kelurahan ${customer.kelurahan}, Kec. ${customer.kecamatan}*. 😊\n\nJadi mau pilih treatment apa bunda? 🤗`,
        shouldSendReply: true,
      };
    }

    // NLU CONFLICT RESOLUTION: State = INITIAL (with saved location), sela intent = ask_price/faq
    // Rule: Answer sela question, then re-prompt with location offer
    const nlu = ctx.nluResult;
    if (nlu && !nlu.isFallback && nlu.confidence >= 0.6) {
      const hasAskPrice = nlu.intents.includes('ask_price');
      const hasFaqQuestion = nlu.intents.includes('faq_question');
      if (hasAskPrice || hasFaqQuestion) {
        // Defer to AWAITING_INTEREST handler which has FAQ+price answering logic
        const { handleInterestState } = await import('./interest');
        return handleInterestState({ ...ctx, conversation: { ...conversation, current_state: ConversationState.AWAITING_INTEREST } as any });
      }
    }

    // Jika mengirim pesan lain yang bukan lokasi, tawarkan opsi retensi lokasi dan tetap berada di state INITIAL
    return {
      nextState: ConversationState.INITIAL,
      replyText: TEMPLATES.greetingWithLocation({
        kelurahan: customer.kelurahan,
        kecamatan: customer.kecamatan || '',
        skipGreeting,
      }),
      shouldSendReply: true,
    };
  }

  // --- NLU CONFLICT RESOLUTION: State = INITIAL (fresh customer), NLU detected sela price/faq ---
  const nlu = ctx.nluResult;

  // BUG #3 FIX: Eskalasi jadwal spesifik harus trigger di SEMUA state, termasuk INITIAL.
  // Cek intent dari NLU (termasuk fallback regex) DAN regex langsung untuk robust.
  // Flag: ESCALATE_SCHEDULE_IN_INITIAL (default: true sesuai PRD Section 4.1 poin 8)
  const shouldEscalateSchedule = process.env.ESCALATE_SCHEDULE_IN_INITIAL !== 'false';
  const nluHasAskSchedule = nlu?.intents?.includes('ask_schedule') || false;
  const regexHasAskSchedule = /(\bjadwal\b|\bslot\b|\bbuka\b|\bhari\b|\btanggal\b|\bjam\b)/i.test(lower) &&
                              /\b(senin|selasa|rabu|kamis|jumat|sabtu|minggu|besok|lusa|jam\s*\d|pukul\s*\d)\b/i.test(lower);
  if ((nluHasAskSchedule || regexHasAskSchedule) && shouldEscalateSchedule) {
    const { conversationService } = await import('../../services/conversation.service');
    await conversationService.escalateToHumanHandling(
      conversation,
      customer.phone,
      `Customer bertanya jadwal spesifik: "${userText}" (state: INITIAL)`,
      tenantId
    );
    const scheduleReply = await phrasingService.generate({
      intent: 'schedule_check_handoff',
      conversationId: conversation.id,
      tenantId,
      fallbackTemplate: TEMPLATES.scheduleCheckHandoff(),
    });
    return {
      nextState: ConversationState.HUMAN_HANDLING,
      replyText: scheduleReply,
      shouldSendReply: true,
      isHumanHandling: true,
    };
  }

  // HARDENING anti-salah-rute harga: pola sama dgn nlu-classifier — "usia berapa boleh
  // pijat?"/"minimal berapa bulan?" bukan pertanyaan harga; "pijat bayi berapa ya?" tetap harga.
  // Bare 'k' (nominal) hanya dianggap harga jika ada kata harga di kalimat.
  const hasPriceWord = /\b(harga(nya)?|tarif(nya)?|ongkir(nya)?|biaya(nya)?|ongkos(nya)?|pricelists?|promos?|rp\d)\b/i.test(lower);
  const hasAgeContext = /\b(usia|umur|umurnya|minimal|minimum|minimalnya|min\b|berat|tinggi)\b/i.test(lower);
  const hasAskPrice = nlu?.intents.includes('ask_price') ||
    (/\b(berapa|brp)\b/i.test(lower) && !hasAgeContext) ||
    hasPriceWord ||
    /\b\d+\s*(rb|ribu)\b/i.test(lower) ||
    (/\b\d+\s*k\b/i.test(lower) && hasPriceWord);
  const hasFaqQuestion = nlu?.intents.includes('faq_question') || /\b(manfaat|aman|usia|boleh|bayar)\b/i.test(lower);
  const hasProvideLocation = nlu?.intents.includes('provide_location') || hasLocationKeyword || hasValidGeocode;

  // Cek apakah pesan merupakan sapaan pembuka murni vs mengandung pertanyaan/catatan ekstra
  const { checkLeadGreetingText } = await import('../utils/greeting-checker');
  const { hasIslamicGreeting } = await import('../utils/islamic-greeting-helper');
  const isIslamic = hasIslamicGreeting(userText);
  const greetingCheck = await checkLeadGreetingText(userText, incomingMessage.text?.body, tenantId);

  // BYPASS TOTAL: Jika murni sapaan pembuka lead (sesuai Greetings Text / template), LANGSUNG kembalikan TEMPLATES.greeting() instan tanpa LLM
  if (greetingCheck.isPureGreeting) {
    console.log(`[GREETING BYPASS] Pure lead greeting verified for tenant ${tenantId}. Returning instant template.`);
    return {
      nextState: ConversationState.AWAITING_LOCATION,
      replyText: TEMPLATES.greeting({ skipGreeting, isIslamic }),
      shouldSendReply: true,
    };
  }

  // Jika ada pertanyaan / teks ekstra dari customer di luar greeting text standar, catat ke memori (last_discussed_treatment)
  if (greetingCheck.hasExtraQuestions && greetingCheck.extraText) {
    try {
      const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
      const catalogMatch = treatmentCatalogService.searchCatalogItems(greetingCheck.extraText);
      if (catalogMatch.length > 0) {
        const cleanName = catalogMatch[0].name.trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
        const { conversationService } = await import('../../services/conversation.service');
        await conversationService.updateLastDiscussedTreatment(conversation.id, tenantId, cleanName).catch(() => {});
        console.log(`[GREETING EXTRA MEMORY] Captured treatment from extra lead text "${greetingCheck.extraText}" -> "${cleanName}"`);
      }
    } catch (_) {}
  }

  // Multi-intent: greeting + ask_price/faq + belum ada lokasi → JAWAB pertanyaan customer
  // via interest handler, lalu prepend greeting header wajib di depannya.
  if ((hasAskPrice || hasFaqQuestion) && !hasProvideLocation) {
    const { handleInterestState } = await import('./interest');
    const interestResult = await handleInterestState(ctx);
    
    // Prepend greeting header wajib di depan jawaban AI
    if (interestResult.replyText) {
      interestResult.replyText = TEMPLATES.firstContactGreetingHeader({ isIslamic }) + '\n\n' + interestResult.replyText;
    }
    
    // Tetap set nextState ke AWAITING_LOCATION karena lokasi belum diketahui
    interestResult.nextState = ConversationState.AWAITING_LOCATION;
    return interestResult;
  }

  // 4. Default Greeting Baru (Belum punya lokasi)
  // BYPASS LLM: Jika murni sapaan lead (sesuai Greetings Text / template), langsung kirim TEMPLATES.greeting() instan
  const fallbackGreeting = TEMPLATES.greeting({ skipGreeting, isIslamic });
  const greetingText = greetingCheck.isPureGreeting
    ? fallbackGreeting
    : await phrasingService.generate({
        intent: 'greeting',
        facts: { skipGreeting: skipGreeting ? '1' : '0' },
        conversationId: conversation.id,
        tenantId,
        fallbackTemplate: fallbackGreeting,
      });

  return {
    nextState: ConversationState.AWAITING_LOCATION,
    replyText: greetingText,
    shouldSendReply: true,
  };
}
