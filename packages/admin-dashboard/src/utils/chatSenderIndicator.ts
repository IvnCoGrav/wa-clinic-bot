/**
 * chatSenderIndicator.ts — Logika penentuan tipe & ikon pengirim pesan terakhir di Live Chat.
 *
 * Menerapkan prinsip modularity-first & anti-god-object:
 * - Nol dependensi eksternal / murni logika deterministik
 * - Membedakan pengirim: 'CUSTOMER' (Pasien), 'ADMIN' (Saya/Admin CS), dan 'BOT' (Bot AI)
 */

export type ChatSenderKind = 'CUSTOMER' | 'ADMIN' | 'BOT' | 'UNKNOWN';

export interface ChatSenderIndicator {
  kind: ChatSenderKind;
  isCustomer: boolean;
  isAdmin: boolean;
  isBot: boolean;
  senderName: string | null;
  tooltip: string;
}

export function resolveChatSenderIndicator(lastMsg: any): ChatSenderIndicator {
  if (!lastMsg) {
    return {
      kind: 'UNKNOWN',
      isCustomer: false,
      isAdmin: false,
      isBot: false,
      senderName: null,
      tooltip: '',
    };
  }

  const direction = String(lastMsg.direction || '').toUpperCase();
  const rawSenderType = String(
    lastMsg.sender_type || lastMsg.senderType || ''
  ).toUpperCase();
  const senderName = lastMsg.sender_name || lastMsg.senderName || null;

  // 1. Pesan keluar (OUTBOUND)
  if (direction === 'OUTBOUND') {
    if (rawSenderType === 'BOT' || rawSenderType === 'SYSTEM') {
      return {
        kind: 'BOT',
        isCustomer: false,
        isAdmin: false,
        isBot: true,
        senderName: 'Bot AI',
        tooltip: 'Pesan dari Bot AI',
      };
    }
    // Jika OUTBOUND dan bukan BOT -> Admin / Staf / Saya
    const nameLabel = senderName ? ` (${senderName})` : '';
    return {
      kind: 'ADMIN',
      isCustomer: false,
      isAdmin: true,
      isBot: false,
      senderName,
      tooltip: `Pesan dari Saya / Admin${nameLabel}`,
    };
  }

  // 2. Pesan masuk (INBOUND) atau sender_type CUSTOMER
  if (direction === 'INBOUND' || rawSenderType === 'CUSTOMER') {
    return {
      kind: 'CUSTOMER',
      isCustomer: true,
      isAdmin: false,
      isBot: false,
      senderName: senderName || 'Pasien',
      tooltip: 'Pesan dari Pasien',
    };
  }

  // 3. Fallback jika arah tidak tercatat tapi ada sender_type
  if (rawSenderType === 'ADMIN' || rawSenderType === 'STAFF' || rawSenderType === 'HUMAN') {
    const nameLabel = senderName ? ` (${senderName})` : '';
    return {
      kind: 'ADMIN',
      isCustomer: false,
      isAdmin: true,
      isBot: false,
      senderName,
      tooltip: `Pesan dari Saya / Admin${nameLabel}`,
    };
  }

  return {
    kind: 'UNKNOWN',
    isCustomer: false,
    isAdmin: false,
    isBot: false,
    senderName,
    tooltip: '',
  };
}
