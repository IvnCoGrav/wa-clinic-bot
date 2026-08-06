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
  const isDirectLocationQuery =
    /^(saya\s+)?(di|ke)\s+[a-z0-9]/i.test(userText.trim()) ||
    /^(ongkir|tarif|biaya|kirim|pengiriman)\s+(ke|di)\s+/i.test(userText.trim()) ||
    /^rumah\s+saya\s+(di|ke)\s+/i.test(userText.trim()) ||
    /^kalau\s+(di|ke)\s+/i.test(userText.trim());
  return incomingMessage.type === 'location' || isConversationalLocation || isDirectLocationQuery;
}
