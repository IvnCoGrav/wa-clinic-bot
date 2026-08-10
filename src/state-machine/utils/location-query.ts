import { WhatsAppIncomingMessage } from '../../integrations/whatsapp/types';

/**
 * Deteksi pesan lokasi (share location native, query langsung, atau kalimat perubahan
 * lokasi dengan kata kunci aksi + di/ke). Dipakai bersama oleh handler AWAITING_LOCATION
 * (location.ts) dan AWAITING_INTEREST (interest.ts) agar logika redirect/intercept
 * KONSISTEN dan tidak saling memantulkan (mutual recursion).
 */
export function isLocationQueryMessage(incomingMessage: WhatsAppIncomingMessage, userText: string): boolean {
  const lower = userText.toLowerCase().trim();
  const hasChangeKeyword = /(ganti|pindah|salah|ubah|bukan|yang\s+bener|alamat)/i.test(userText);
  const isConversationalLocation = hasChangeKeyword && (/di\s+/i.test(lower) || /ke\s+/i.test(lower));
  
  // Clean all leading greetings and polite introductory phrases (repeated to handle multi-word prefixes)
  const cleanPrefix = lower
    .replace(/^(?:halo|hola|hi|hei|p|assalamualaikum|salam|pagi|siang|sore|malam|permisi|kak|min|mbak|mas|bunda|bund|mau\s+tanya|nanya|tolong|mohon|sekalian)[,\.\s]*/gi, '')
    .replace(/^(?:halo|hola|hi|hei|p|assalamualaikum|salam|pagi|siang|sore|malam|permisi|kak|min|mbak|mas|bunda|bund|mau\s+tanya|nanya|tolong|mohon|sekalian)[,\.\s]*/gi, '')
    .trim();

  const isDirectLocationQuery =
    /^(saya\s+)?(di|ke)\s+[a-z0-9]/i.test(cleanPrefix) ||
    /^(ongkir|tarif|biaya|kirim|pengiriman)\s+(ke|di)\s+/i.test(cleanPrefix) ||
    /^rumah\s+saya\s+(di|ke)\s+/i.test(cleanPrefix) ||
    /^kalau\s+(di|ke)\s+/i.test(cleanPrefix) ||
    /\b(tarif|ongkir|biaya|kirim|pengiriman)\s+(ke|di)\s+[a-z0-9]/i.test(cleanPrefix);
    
  return incomingMessage.type === 'location' || isConversationalLocation || isDirectLocationQuery;
}
