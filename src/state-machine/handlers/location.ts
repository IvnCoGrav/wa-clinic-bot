import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { geocodingService } from '../../integrations/google-maps/geocoding';
import { deliveryService } from '../../services/delivery.service';
import { customerService } from '../../services/customer.service';
import { conversationService } from '../../services/conversation.service';
import { phrasingService } from '../../integrations/llm/phrasing.service';
import { TEMPLATES } from '../../config/persona';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { isLocationQueryMessage } from '../utils/location-query';

/**
 * Handler untuk state AWAITING_LOCATION:
 * Memproses input lokasi dari customer (baik Share Location Native WA maupun Teks Nama Lokasi).
 */
export async function handleLocationState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { incomingMessage, customer, conversation } = ctx;
  const tenantId = ctx.tenantId || customer.tenant_id || DEFAULT_TENANT_ID;

  // NLU Enhancement: if NLU classified this as provide_location and extracted a clean location_text entity,
  // use that entity text for geocoding instead of the raw message body for higher precision.
  const nluLocationText = ctx.nluResult?.entities?.location_text;
  const nluConfident = ctx.nluResult && !ctx.nluResult.isFallback && (ctx.nluResult.confidence || 0) >= 0.6;

  // --- KASUS A: CUSTOMER MENGIRIM SHARE LOCATION NATIVE WHATSAPP ---
  if (incomingMessage.type === 'location' && incomingMessage.location) {
    const { latitude, longitude } = incomingMessage.location;

    // 1. Reverse geocode titik koordinat ke kelurahan/kecamatan/kota
    const resolved = await geocodingService.reverseGeocode(latitude, longitude);

    // 2. Hitung ongkir dan jarak (OpenRouteService dengan Haversine fallback)
    const delivery = await deliveryService.calculateDelivery({ lat: latitude, lng: longitude });

    // 3. Update data customer di Database
    await customerService.updateCustomerLocation(
      customer.id,
      {
        kelurahan: resolved.kelurahan,
        kecamatan: resolved.kecamatan,
        kota: resolved.kota,
        lat: latitude,
        lng: longitude,
        distanceKm: delivery.distanceKm,
        ongkir: delivery.ongkir,
        isOutOfCoverage: delivery.isOutOfCoverage,
        zipcode: resolved.zipcode,
      },
      tenantId
    );

    // Tandai customer sudah pernah kirim share-location native (pin GPS).
    customer.share_location_sent = true;
    await customerService.markShareLocationSent(customer.id, tenantId);

    // Reset attempt counter
    await conversationService.updateConversationState(conversation.id, { locationAttempts: 0 }, tenantId);

    // 4. Jika Luar Jangkauan
    if (delivery.isOutOfCoverage) {
      return {
        nextState: ConversationState.COMPLETED,
        replyText: TEMPLATES.outOfCoverage({ distanceKm: delivery.distanceKm, maxCoverageKm: delivery.maxCoverageKm }),
        shouldSendReply: true,
      };
    }

    // 5. Jika Dalam Jangkauan
    const fallbackOngkirText = TEMPLATES.ongkirInfo({
      distanceKm: delivery.distanceKm,
      normalPrice: delivery.normalPrice,
      promoPrice: delivery.promoPrice,
      freeTierKm: delivery.freeTierKm,
    });

    const replyText = await phrasingService.generate({
      intent: 'ongkir_info',
      facts: {
        distanceKm: delivery.distanceKm,
        normalPrice: delivery.normalPrice,
        promoPrice: delivery.promoPrice,
        freeTierKm: delivery.freeTierKm ?? 5,
      },
      conversationId: conversation.id,
      tenantId,
      fallbackTemplate: fallbackOngkirText,
    });

    return {
      nextState: ConversationState.AWAITING_INTEREST,
      replyText,
      shouldSendReply: true,
      sendPricelistImage: true,
    };
  }

  // --- KASUS B: CUSTOMER MENGIRIM TEKS LOKASI ---
  // Use NLU entity if available for cleaner geocoding input
  const rawTextLocation = (nluConfident && nluLocationText) ? nluLocationText : (incomingMessage.text?.body?.trim() || '');

  if (!rawTextLocation) {
    const askDetailReply = await phrasingService.generate({
      intent: 'ask_kelurahan_detail',
      conversationId: conversation.id,
      tenantId,
      fallbackTemplate: TEMPLATES.askKelurahanDetail(),
    });
    return {
      nextState: ConversationState.AWAITING_LOCATION,
      replyText: askDetailReply,
      shouldSendReply: true,
    };
  }

  const cleanLower = rawTextLocation.toLowerCase();
  const greetingWords = ['halo', 'hola', 'hi', 'hei', 'p', 'assalamualaikum', 'salam', 'pagi', 'siang', 'sore', 'malam', 'permisi'];
  if (greetingWords.includes(cleanLower)) {
    return {
      nextState: ConversationState.AWAITING_LOCATION,
      replyText: `Bunda, mohon sebutkan nama Kelurahan dan Kecamatan Bunda ya bund (atau kirim share location) agar kami bisa bantu cek ongkirnya 😊🙏`,
      shouldSendReply: true,
    };
  }

  // --- INTERSEPSI FAQ / PRICE: kalau customer tanya hal lain (bukan lokasi) saat state lokasi,
  // jawab via interest handler (knowledge base / katalog treatment), TANPA mengganggu state lokasi.
  // Prinsip: STATE PUNYA PRIORITAS — jawab sela, lalu tetap tanya lokasi.
  const nlu = ctx.nluResult;
  const hasNluPriceOrFaq = nlu && (nlu.intents.includes('faq_question') || nlu.intents.includes('ask_price') || nlu.intents.includes('chitchat') || nlu.intents.includes('ask_schedule'));
  const hasFaqRegex = (/\b(berapa|harga(nya)?|tarif(nya)?|ongkir(nya)?|biaya(nya)?|ongkos(nya)?|jam|buka|jadwal|manfaat|untuk apa|boleh|umur|usia|efek|perawatan|treatment|cukur|gundul|potong|pijat|massage|spa|nanya|tanya|bisa|apakah|gimana|bagaimana|apa|persyaratan|syarat|paket|\d+\s*(rb|k|ribu))\b/i.test(cleanLower) && !/\b(di|ke|kelurahan|desa|alamat)\b/i.test(cleanLower));
  const hasFaqIntent = hasNluPriceOrFaq || hasFaqRegex;
  const interceptDepth = ctx._interceptDepth || 0;
  // Guard mutual recursion: pesan lokasi tetap diproses sebagai lokasi (jangan di-intercept FAQ),
  // dan jangan intercept ulang bila sudah di-arahkan kembali dari interest handler (hop > 0).
  const skipFaqIntercept = isLocationQueryMessage(incomingMessage, rawTextLocation) || interceptDepth > 0;
  if (hasFaqIntent && !skipFaqIntercept) {
    console.log(`[LOCATION FAQ INTERCEPT] Customer asked non-location question during location flow: "${rawTextLocation}". Deferring to interest handler.`);
    const { handleInterestState } = await import('./interest');
    const interestResult = await handleInterestState({
      ...ctx,
      _interceptDepth: interceptDepth + 1,
      conversation: { ...conversation, current_state: ConversationState.AWAITING_INTEREST } as any,
    });
    // STATE PUNYA PRIORITAS: setelah jawab FAQ, kembalikan state ke AWAITING_LOCATION,
    // KECUALI jika customer melakukan form submission atau eskalasi ke human handling.
    const isFormOrEscalation = interestResult.isHumanHandling ||
                               interestResult.nextState === ConversationState.HUMAN_HANDLING ||
                               interestResult.nextState === ConversationState.RESERVATION_SENT;
    return {
      ...interestResult,
      nextState: isFormOrEscalation ? interestResult.nextState : ConversationState.AWAITING_LOCATION,
    };
  }

  // Bersihkan teks dari awalan query yang tidak relevan untuk geocoding
  const textLocation = rawTextLocation.toLowerCase()
    .replace(/^(kalau\s+)?(ke|di)\s+/gi, '')
    .replace(/^(alamat\s+|rumah\s+)?saya\s+(di|ke)\s+/gi, '')
    .replace(/^(ongkir\s+|tarif\s+|biaya\s+|kirim\s+|pengiriman\s+)(ke|di)\s+/gi, '')
    .replace(/^(kelurahan\s+|desa\s+|kecamatan\s+)/gi, '')
    // Bersihkan pertanyaan harga/tarif di bagian belakang secara agresif
    .replace(/[,.]?\s*(kena|ongkir|ongkirnya|tarif|tarifnya|biaya|biayanya|harga|harganya|ongkos|ongkosnya)\s+.*$/gi, '')
    .replace(/[,.]?\s*berapa\s+.*$/gi, '')
    .replace(/[,.]?\s*berapa$/gi, '')
    // Bersihkan sapaan dan partikel tanya di bagian belakang
    .replace(/\s+(bund|bunda|ya|kak|ka|min|mbak|mas|gan|sis|dong|kah|\?)\b/gi, '')
    .replace(/\?/g, '')
    .trim();

  // 1. Geocode teks lokasi via Google Maps API
  const resolved = await geocodingService.geocodeText(textLocation);

  // --- KASUS C: FUZZY MATCH TUNGGAL (LOCATION_CONFIRMED) ---
  if (resolved.isFuzzyMatch && resolved.lat && resolved.lng) {
    await customerService.updateCustomerPendingLocation(
      customer.id,
      {
        kelurahan: resolved.kelurahan || null,
        kecamatan: resolved.kecamatan || null,
        kota: resolved.kota || null,
        lat: resolved.lat,
        lng: resolved.lng,
        zipcode: resolved.zipcode || null,
      },
      tenantId
    );

    return {
      nextState: ConversationState.LOCATION_CONFIRMED,
      replyText: TEMPLATES.confirmFuzzyLocation({
        kelurahan: resolved.kelurahan || '',
        kecamatan: resolved.kecamatan || '',
      }),
      shouldSendReply: true,
    };
  }

  // 2. Jika lokasi TIDAK Presisi (belum sampai tingkat kelurahan/desa)
  if (!resolved.isPrecise || !resolved.lat || !resolved.lng) {
    const currentAttempts = (conversation.location_attempts || 0) + 1;

    // ESKALASI JIKA GAGAL DETEKSI KELURAHAN >= LOCATION_ATTEMPTS_LIMIT (default 3x)
    const LOCATION_ATTEMPTS_LIMIT = parseInt(process.env.LOCATION_ATTEMPTS_LIMIT || '3', 10);
    if (currentAttempts >= LOCATION_ATTEMPTS_LIMIT) {
      await conversationService.escalateToHumanHandling(
        conversation,
        customer.phone,
        `Gagal deteksi presisi kelurahan setelah ${currentAttempts}x percobaan teks: "${textLocation}"`,
        tenantId
      );

      const escalationReply = await phrasingService.generate({
        intent: 'location_escalation',
        conversationId: conversation.id,
        tenantId,
        fallbackTemplate: TEMPLATES.locationEscalation(),
      });

      return {
        nextState: ConversationState.HUMAN_HANDLING,
        replyText: escalationReply,
        shouldSendReply: true,
        isHumanHandling: true,
      };
    }

    // Jika belum mencapai limit, update counter dan minta nama kelurahan secara spesifik
    await conversationService.updateConversationState(
      conversation.id,
      {
        locationAttempts: currentAttempts,
      },
      tenantId
    );

    if (resolved.ambiguityResults && resolved.ambiguityResults.length > 0) {
      const kelName = resolved.ambiguityResults[0].Kelurahan_Desa;
      return {
        nextState: ConversationState.AWAITING_LOCATION,
        replyText: TEMPLATES.askKelurahanAmbiguous({ kelurahanName: kelName, options: resolved.ambiguityResults }),
        shouldSendReply: true,
      };
    }

    const cleanLocationName = textLocation.toLowerCase()
      .replace(/^(saya\s+)?di\s+/, '')
      .replace(/^alamat\s+saya\s+di\s+/, '')
      .replace(/^rumah\s+saya\s+di\s+/, '')
      .replace(/^kelurahan\s+/, '')
      .replace(/^desa\s+/, '')
      .replace(/\s+(bund|bunda|ya|kak|min|mbak|mas|gan|sis)\b/g, '')
      .trim();

    // Jika teks lokasi tidak mengandung keyword lokasi (kecamatan/kota/kelurahan/desa/di/ke/dll) dan tidak matchedSpan, atau terlalu panjang/bukan nama tempat, jangan echo kata tersebut
    const LOCATION_KEYWORD_RE = /\b(kelurahan|desa|kecamatan|kec|kota|kabupaten|kab|jalan|jl|di|ke|dari|daerah|sekitar|wilayah|rumah|alamat)\b/i;
    const hasLocationKeyword = LOCATION_KEYWORD_RE.test(rawTextLocation);
    const isTooLongSentence = !resolved.matchedSpan && (cleanLocationName.length > 15 || cleanLocationName.split(/\s+/).length > 2);

    if (!resolved.matchedSpan && (!hasLocationKeyword || isTooLongSentence)) {
      const askDetailReply = await phrasingService.generate({
        intent: 'ask_kelurahan_detail',
        conversationId: conversation.id,
        tenantId,
        fallbackTemplate: TEMPLATES.askKelurahanDetail(),
      });
      return {
        nextState: ConversationState.AWAITING_LOCATION,
        replyText: askDetailReply,
        shouldSendReply: true,
      };
    }

    const capitalizedLocationName = resolved.matchedSpan
      ? resolved.matchedSpan.charAt(0).toUpperCase() + resolved.matchedSpan.slice(1)
      : (cleanLocationName ? cleanLocationName.charAt(0).toUpperCase() + cleanLocationName.slice(1) : textLocation);

    return {
      nextState: ConversationState.AWAITING_LOCATION,
      replyText: TEMPLATES.askKelurahanRetry({ textLocation: capitalizedLocationName, currentAttempts }),
      shouldSendReply: true,
    };
  }

  // 3. Jika lokasi PRESISI (Kelurahan terdeteksi)
  const delivery = await deliveryService.calculateDelivery({ lat: resolved.lat, lng: resolved.lng });

  // Update DB Customer
  await customerService.updateCustomerLocation(
    customer.id,
    {
      kelurahan: resolved.kelurahan,
      kecamatan: resolved.kecamatan,
      kota: resolved.kota,
      lat: resolved.lat,
      lng: resolved.lng,
      distanceKm: delivery.distanceKm,
      ongkir: delivery.ongkir,
      isOutOfCoverage: delivery.isOutOfCoverage,
      zipcode: resolved.zipcode,
    },
    tenantId
  );

  // Reset location attempt counter
  await conversationService.updateConversationState(conversation.id, { locationAttempts: 0 }, tenantId);

  // 4. Jika Luar Jangkauan
  if (delivery.isOutOfCoverage) {
    return {
      nextState: ConversationState.COMPLETED,
      replyText: TEMPLATES.outOfCoverage({ distanceKm: delivery.distanceKm, maxCoverageKm: delivery.maxCoverageKm }),
      shouldSendReply: true,
    };
  }

  // 5. Dalam Jangkauan
  const fallbackOngkirText = TEMPLATES.ongkirInfo({
    distanceKm: delivery.distanceKm,
    normalPrice: delivery.normalPrice,
    promoPrice: delivery.promoPrice,
    freeTierKm: delivery.freeTierKm,
  });

  const replyText = await phrasingService.generate({
    intent: 'ongkir_info',
    facts: {
      distanceKm: delivery.distanceKm,
      normalPrice: delivery.normalPrice,
      promoPrice: delivery.promoPrice,
      freeTierKm: delivery.freeTierKm ?? 5,
    },
    conversationId: conversation.id,
    tenantId,
    fallbackTemplate: fallbackOngkirText,
  });

  return {
    nextState: ConversationState.AWAITING_INTEREST,
    replyText,
    shouldSendReply: true,
    sendPricelistImage: true,
  };
}
