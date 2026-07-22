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
  const { customer, incomingMessage } = ctx;
  const userText = incomingMessage.text?.body || '';
  const lower = userText.toLowerCase().trim();

  // 1. Deteksi apakah customer langsung mengirim share-location pin
  const isPin = incomingMessage.type === 'location' && incomingMessage.location;
  
  // 2. Deteksi teks lokasi terarah (Direct Location Query)
  const isLocationText = /^(saya\s+)?di\s+[a-z]+/i.test(userText.trim()) || 
                         /^ongkir\s+ke\s+[a-z]+/i.test(userText.trim()) || 
                         /^rumah\s+saya\s+di\s+[a-z]+/i.test(userText.trim()) || 
                         /^kalau\s+di\s+[a-z]+/i.test(userText.trim());

  // Prioritas Override Utama: Jika ada input lokasi baru (Pin atau teks lokasi langsung)
  if (isPin || isLocationText) {
    const { handleLocationState } = await import('./location');
    return handleLocationState(ctx);
  }

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
      }),
      shouldSendReply: true,
    };
  }

  // 4. Default Greeting Baru (Belum punya lokasi)
  const greetingText = TEMPLATES.greeting();

  return {
    nextState: ConversationState.AWAITING_LOCATION,
    replyText: greetingText,
    shouldSendReply: true,
  };
}
