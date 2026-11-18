/**
 * Helper murni untuk normalisasi ID pesan WAHA, pembangunan kandidat
 * (chatId, messageId), dan eksekusi fan-out berbatas waktu (KNOWN #358 A-005/A-007/A-011).
 */

export interface WahaMessageCandidateOptions {
  outboundOnly?: boolean;
}

/**
 * Normalizer ID pesan event WAHA bersama (dipakai message.ack & message.revoked, A-007).
 * Menangani string maupun objek `{ _serialized, id }` tanpa pernah menghasilkan `"[object Object]"`.
 */
export function extractWahaEventMessageId(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof val === 'object') {
    const candidate = val._serialized ?? val.id;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

/**
 * Ekstraksi target ID pesan & pengirim untuk event WAHA NOWEB `message.revoked` (V-02/CD-04).
 */
export function parseWahaRevokePayload(revPayload: any): {
  ignoredNonDirect: boolean;
  targetMsgId: string | null;
  revokedBy: 'ADMIN' | 'CUSTOMER';
} {
  const revChat = String(
    revPayload?.from ||
      revPayload?.chatId ||
      revPayload?.before?.from ||
      revPayload?.after?.from ||
      ''
  );
  if (revChat.endsWith('@g.us') || revChat === 'status@broadcast') {
    return { ignoredNonDirect: true, targetMsgId: null, revokedBy: 'CUSTOMER' };
  }

  const targetMsgId =
    extractWahaEventMessageId(revPayload?.revokedMessageId) ||
    extractWahaEventMessageId(revPayload?.before?.id) ||
    extractWahaEventMessageId(revPayload?.after?.id) ||
    extractWahaEventMessageId(revPayload?.messageId) ||
    extractWahaEventMessageId(revPayload?.id) ||
    extractWahaEventMessageId(revPayload?.key?.id) ||
    extractWahaEventMessageId(revPayload?.protocolMessage?.key?.id) ||
    extractWahaEventMessageId(revPayload?.message?.protocolMessage?.key?.id);

  const isFromMe = Boolean(
    revPayload?.fromMe ?? revPayload?.before?.fromMe ?? revPayload?.after?.fromMe
  );
  return {
    ignoredNonDirect: false,
    targetMsgId,
    revokedBy: isFromMe ? 'ADMIN' : 'CUSTOMER',
  };
}

/**
 * Membangun daftar kandidat (chatIds, msgIds) untuk edit/delete/reaction WAHA NOWEB.
 * Bila `outboundOnly: true`, mengecualikan prefix inbound `false_*` (A-005).
 */
export function buildWahaMessageCandidates(
  chatId: string,
  messageId: string,
  options?: WahaMessageCandidateOptions
): { chatIds: string[]; msgIds: string[] } {
  const outboundOnly = Boolean(options?.outboundOnly);
  const chatCandidates = new Set<string>();
  const msgCandidates = new Set<string>();

  const cleanNum = chatId.replace(/@(c\.us|s\.whatsapp\.net|lid|g\.us)$/, '');

  if (chatId.includes('@g.us')) {
    chatCandidates.add(chatId);
  } else if (chatId.includes('@lid')) {
    chatCandidates.add(chatId);
    chatCandidates.add(`${cleanNum}@c.us`);
    chatCandidates.add(`${cleanNum}@s.whatsapp.net`);
  } else {
    chatCandidates.add(`${cleanNum}@c.us`);
    chatCandidates.add(`${cleanNum}@s.whatsapp.net`);
    if (!outboundOnly) {
      chatCandidates.add(cleanNum);
    }
  }

  const match = messageId.match(/^(?:true|false)_(.+?)_([A-Za-z0-9]+)$/);
  if (match) {
    const embeddedChat = match[1];
    const keyId = match[2];
    const embeddedClean = embeddedChat.replace(/@(c\.us|s\.whatsapp\.net|lid|g\.us)$/, '');

    chatCandidates.add(embeddedChat);
    chatCandidates.add(`${embeddedClean}@c.us`);
    chatCandidates.add(`${embeddedClean}@s.whatsapp.net`);

    if (!outboundOnly || !messageId.startsWith('false_')) {
      msgCandidates.add(messageId);
    }
    msgCandidates.add(`true_${embeddedClean}@c.us_${keyId}`);
    msgCandidates.add(`true_${embeddedClean}@s.whatsapp.net_${keyId}`);
    msgCandidates.add(`true_${cleanNum}@c.us_${keyId}`);
    msgCandidates.add(`true_${cleanNum}@s.whatsapp.net_${keyId}`);
    if (!outboundOnly) {
      msgCandidates.add(`false_${embeddedClean}@c.us_${keyId}`);
      msgCandidates.add(`false_${embeddedClean}@s.whatsapp.net_${keyId}`);
    }
    msgCandidates.add(keyId);
  } else {
    msgCandidates.add(`true_${cleanNum}@c.us_${messageId}`);
    msgCandidates.add(`true_${cleanNum}@s.whatsapp.net_${messageId}`);
    if (!outboundOnly) {
      msgCandidates.add(`false_${cleanNum}@c.us_${messageId}`);
      msgCandidates.add(`false_${cleanNum}@s.whatsapp.net_${messageId}`);
    }
    msgCandidates.add(messageId);
  }

  return {
    chatIds: Array.from(chatCandidates),
    msgIds: Array.from(msgCandidates),
  };
}

/**
 * Menjalankan kombinasi kandidat (chatIds x msgIds) terhadap 1 endpoint WAHA
 * dalam total deadline budget. HTTP 400/422 hanya memutus loop endpoint ini saja
 * agar endpoint fallback tetap berkesempatan dicoba (A-005 & A-011).
 */
export async function tryWahaMessageEndpoint(params: {
  chatIds: string[];
  msgIds: string[];
  deadline: number;
  baseTimeoutMs: number;
  attempt: (cId: string, mId: string, timeoutMs: number) => Promise<{ status: number }>;
}): Promise<{ ok: boolean; lastErr: any }> {
  const { chatIds, msgIds, deadline, baseTimeoutMs, attempt } = params;
  let lastErr: any = null;
  let abortEndpoint = false;

  for (const cId of chatIds) {
    if (abortEndpoint || Date.now() >= deadline) break;
    for (const mId of msgIds) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        const timeoutMs = Math.min(baseTimeoutMs, Math.max(1000, remaining));
        const res = await attempt(cId, mId, timeoutMs);
        if (res.status >= 200 && res.status < 300) {
          return { ok: true, lastErr: null };
        }
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status;
        if (status === 400 || status === 422) {
          abortEndpoint = true;
          break;
        }
      }
    }
  }

  return { ok: false, lastErr };
}
