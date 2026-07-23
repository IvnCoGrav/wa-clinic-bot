import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { TEMPLATES } from '../../config/persona';
import { geocodingService } from '../../integrations/google-maps/geocoding';

/**
 * Handler untuk state INITIAL:
 * Ketika pesan pertama kali masuk dari nomor baru / percakapan baru / setelah reset idle 24 jam.
 * Mengimplementasikan retensi lokasi tersimpan, deteksi override pin/teks langsung, dan kata kunci afirmatif.
 */
export async function handleGreetingState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { customer, conversation, incomingMessage } = ctx;
  const userText = incomingMessage.text?.body || '';
  const lower = userText.toLowerCase().trim();

  // 1. Deteksi apakah customer langsung mengirim share-location pin
  const isPin = incomingMessage.type === 'location' && incomingMessage.location;
  
  // 2. Deteksi teks lokasi terarah (Direct Location Query / Geocoding Dini)
  const hasLocationKeyword = /^(saya\s+)?di\s+[a-z]+/i.test(userText.trim()) || 
                             /^ongkir\s+ke\s+[a-z]+/i.test(userText.trim()) || 
                             /^rumah\s+saya\s+di\s+[a-z]+/i.test(userText.trim()) || 
                             /^kalau\s+di\s+[a-z]+/i.test(userText.trim());

  // Jalankan geocodeText untuk melihat apakah teks memuat alamat/kelurahan valid secara langsung
  let hasValidGeocode = false;
  try {
    const resolved = await geocodingService.geocodeText(userText);
    if (resolved.isPrecise || resolved.isFuzzyMatch || (resolved.ambiguityResults && resolved.ambiguityResults.length > 0)) {
      hasValidGeocode = true;
    }
  } catch (err) {
    console.error('Failed to geocode greeting text:', err);
  }

  const isLocationText = hasLocationKeyword || hasValidGeocode;

  // Prioritas Override Utama: Jika ada input lokasi baru (Pin atau teks lokasi langsung)
  if (isPin || isLocationText) {
    const { handleLocationState } = await import('./location');
    const result = await handleLocationState(ctx);

    // Perbaikan Poin 3b: Jika customer baru (belum punya kelurahan confirmed)
    const hasConfirmedLocation = !!customer.kelurahan;
    if (!hasConfirmedLocation && result.replyText) {
      const intro = `Halo Bunda! Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa. ✨\n\n`;
      result.replyText = intro + result.replyText;
    }

    return result;
  }

  // Hitung skipGreeting (apakah chat terakhir berjarak < 48 jam)
  const lastInteraction = conversation.last_message_at;
  const isNew = !lastInteraction || (lastInteraction.getTime() === conversation.created_at.getTime());
  const skipGreeting = !isNew && (Date.now() - new Date(lastInteraction).getTime() < 48 * 60 * 60 * 1000);

  // 3. RETENSI LOKASI: Jika customer sudah memiliki lokasi confirmed sebelumnya
  if (customer.kelurahan && customer.lat && customer.lng) {
    const isAffirmative = /\b(iya|yup|ok|oke|bener|betul|lanjut|benar|yes|sip|gpp)\b/i.test(lower) || 
                          /^ya\b(?!\s*(ampun|elah|udah|deh|lord|allah|kali|gitu|begitu|tapi|bukan|salah|kok|sih))/i.test(lower) || 
                          lower.includes('👍');
    
    // Jika mereka membalas menyetujui alamat lama (Afirmatif)
    if (isAffirmative) {
      return {
        nextState: ConversationState.AWAITING_INTEREST,
        replyText: `Baik Bunda, lokasi homecare menggunakan data sebelumnya di **Kelurahan ${customer.kelurahan}, Kec. ${customer.kecamatan}**. 😊\n\nJadi mau pilih treatment apa bunda? 🤗`,
        shouldSendReply: true,
      };
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

  // 4. Default Greeting Baru (Belum punya lokasi)
  const greetingText = TEMPLATES.greeting({ skipGreeting });

  return {
    nextState: ConversationState.AWAITING_LOCATION,
    replyText: greetingText,
    shouldSendReply: true,
  };
}
