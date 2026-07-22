import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { geocodingService } from '../../integrations/google-maps/geocoding';
import { deliveryService } from '../../services/delivery.service';
import { customerService } from '../../services/customer.service';
import { conversationService } from '../../services/conversation.service';

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
        replyText: `${delivery.messageTemplate}\n\nTerima kasih sudah menghubungi kami! Kami akan memberikan kabar jika area Anda sudah terjangkau kelak.`,
        shouldSendReply: true,
      };
    }

    // 5. Jika Dalam Jangkauan (<= 10 km)
    const replyText = `${delivery.messageTemplate}\n\nApakah Anda tertarik untuk melakukan reservasi atau jadwal treatment sekarang? (Bisa dijawab: Mau / Tertarik / Mau lihat jadwal)`;
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
      replyText: 'Mohon sebutkan nama kelurahan/desa Anda atau kirimkan Share Location via WhatsApp ya.',
      shouldSendReply: true,
    };
  }

  // 1. Geocode teks lokasi via Google Maps API
  const resolved = await geocodingService.geocodeText(textLocation);

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
        replyText: 'Terima kasih atas informasinya. Mohon maaf, sistem kami kesulitan mendeteksi detail kelurahan tersebut. Pesan Anda telah diteruskan ke tim Admin Customer Service kami untuk dibantu secara manual. Mohon tunggu sejenak ya! 🙏',
        shouldSendReply: true,
        isHumanHandling: true,
      };
    }

    // Jika belum 3x, update counter dan minta nama kelurahan secara spesifik
    await conversationService.updateConversationState(conversation.id, {
      locationAttempts: currentAttempts,
    });

    return {
      nextState: ConversationState.AWAITING_LOCATION,
      replyText: `Lokasi "${textLocation}" yang Anda sebutkan masih terlalu umum. Mohon sebutkan **nama kelurahan/desa** Anda secara lebih spesifik, atau gunakan fitur Share Location WhatsApp ya! (Percobaan ${currentAttempts}/3)`,
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
      replyText: `${delivery.messageTemplate}\n\nTerima kasih sudah menghubungi kami! Kami akan menginfokan jika area Anda sudah masuk jangkauan kami kelak.`,
      shouldSendReply: true,
    };
  }

  // 5. Dalam Jangkauan (<= 10 km)
  const replyText = `${delivery.messageTemplate}\n\nApakah Anda tertarik untuk reservasi jadwal perawatan sekarang? (Bisa dijawab: Mau / Tertarik / Mau lihat jadwal)`;
  return {
    nextState: ConversationState.AWAITING_INTEREST,
    replyText,
    shouldSendReply: true,
  };
}
