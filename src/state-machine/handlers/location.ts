import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { geocodingService } from '../../integrations/google-maps/geocoding';
import { deliveryService } from '../../services/delivery.service';
import { customerService } from '../../services/customer.service';
import { conversationService } from '../../services/conversation.service';
import { TEMPLATES } from '../../config/persona';

/**
 * Handler untuk state AWAITING_LOCATION:
 * Memproses input lokasi dari customer (baik Share Location Native WA maupun Teks Nama Lokasi).
 */
export async function handleLocationState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { incomingMessage, customer, conversation } = ctx;

  // --- KASUS A: CUSTOMER MENGIRIM SHARE LOCATION NATIVE WHATSAPP ---
  if (incomingMessage.type === 'location' && incomingMessage.location) {
    const { latitude, longitude } = incomingMessage.location;

    // 1. Reverse geocode titik koordinat ke kelurahan/kecamatan/kota
    const resolved = await geocodingService.reverseGeocode(latitude, longitude);

    // 2. Hitung ongkir dan jarak (OpenRouteService dengan Haversine fallback)
    const delivery = await deliveryService.calculateDelivery({ lat: latitude, lng: longitude });

    // 3. Update data customer di Database
    await customerService.updateCustomerLocation(customer.id, {
      kelurahan: resolved.kelurahan,
      kecamatan: resolved.kecamatan,
      kota: resolved.kota,
      lat: latitude,
      lng: longitude,
      distanceKm: delivery.distanceKm,
      ongkir: delivery.ongkir,
      isOutOfCoverage: delivery.isOutOfCoverage,
    });

    // Reset attempt counter
    await conversationService.updateConversationState(conversation.id, { locationAttempts: 0 });

    // 4. Jika Luar Jangkauan (>10 km)
    if (delivery.isOutOfCoverage) {
      return {
        nextState: ConversationState.COMPLETED,
        replyText: TEMPLATES.outOfCoverage({ distanceKm: delivery.distanceKm }),
        shouldSendReply: true,
      };
    }

    // 5. Jika Dalam Jangkauan (<= 10 km)
    const replyText = TEMPLATES.ongkirInfo({
      distanceKm: delivery.distanceKm,
      normalPrice: delivery.normalPrice,
      promoPrice: delivery.promoPrice,
    });

    return {
      nextState: ConversationState.AWAITING_INTEREST,
      replyText,
      shouldSendReply: true,
    };
  }

  // --- KASUS B: CUSTOMER MENGIRIM TEKS LOKASI ---
  const textLocation = incomingMessage.text?.body?.trim() || '';

  if (!textLocation) {
    return {
      nextState: ConversationState.AWAITING_LOCATION,
      replyText: TEMPLATES.askKelurahanDetail(),
      shouldSendReply: true,
    };
  }

  // 1. Geocode teks lokasi via Google Maps API
  const resolved = await geocodingService.geocodeText(textLocation);

  // --- KASUS C: FUZZY MATCH TUNGGAL (LOCATION_CONFIRMED) ---
  if (resolved.isFuzzyMatch && resolved.lat && resolved.lng) {
    await customerService.updateCustomerPendingLocation(customer.id, {
      kelurahan: resolved.kelurahan || null,
      kecamatan: resolved.kecamatan || null,
      kota: resolved.kota || null,
      lat: resolved.lat,
      lng: resolved.lng,
    });

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

    // ESKALASI JIKA 3X GAGAL DETEKSI KELURAHAN
    if (currentAttempts >= 3) {
      await conversationService.escalateToHumanHandling(
        conversation,
        `Gagal deteksi presisi kelurahan setelah ${currentAttempts}x percobaan teks: "${textLocation}"`
      );

      return {
        nextState: ConversationState.HUMAN_HANDLING,
        replyText: TEMPLATES.locationEscalation(),
        shouldSendReply: true,
        isHumanHandling: true,
      };
    }

    // Jika belum 3x, update counter dan minta nama kelurahan secara spesifik
    await conversationService.updateConversationState(conversation.id, {
      locationAttempts: currentAttempts,
    });

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

    const capitalizedLocationName = cleanLocationName
      ? cleanLocationName.charAt(0).toUpperCase() + cleanLocationName.slice(1)
      : textLocation;

    return {
      nextState: ConversationState.AWAITING_LOCATION,
      replyText: TEMPLATES.askKelurahanRetry({ textLocation: capitalizedLocationName, currentAttempts }),
      shouldSendReply: true,
    };
  }

  // 3. Jika lokasi PRESISI (Kelurahan terdeteksi)
  const delivery = await deliveryService.calculateDelivery({ lat: resolved.lat, lng: resolved.lng });

  // Update DB Customer
  await customerService.updateCustomerLocation(customer.id, {
    kelurahan: resolved.kelurahan,
    kecamatan: resolved.kecamatan,
    kota: resolved.kota,
    lat: resolved.lat,
    lng: resolved.lng,
    distanceKm: delivery.distanceKm,
    ongkir: delivery.ongkir,
    isOutOfCoverage: delivery.isOutOfCoverage,
  });

  // Reset location attempt counter
  await conversationService.updateConversationState(conversation.id, { locationAttempts: 0 });

  // 4. Jika Luar Jangkauan (>10 km)
  if (delivery.isOutOfCoverage) {
    return {
      nextState: ConversationState.COMPLETED,
      replyText: TEMPLATES.outOfCoverage({ distanceKm: delivery.distanceKm }),
      shouldSendReply: true,
    };
  }

  // 5. Dalam Jangkauan (<= 10 km)
  const replyText = TEMPLATES.ongkirInfo({
    distanceKm: delivery.distanceKm,
    normalPrice: delivery.normalPrice,
    promoPrice: delivery.promoPrice,
  });

  return {
    nextState: ConversationState.AWAITING_INTEREST,
    replyText,
    shouldSendReply: true,
  };
}
