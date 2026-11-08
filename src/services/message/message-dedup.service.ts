import { prisma } from '../../db/client';
import {
  inFlightBotOutbounds,
  knownBotMessageIds,
  memoryMessages,
  memoryWaMessageIds,
  addMemoryWaMessageId,
  extractShortMessageId,
  updateScopedMessage,
} from './shared';

export class MessageDedupService {
  /**
   * Daftarkan konten outbound bot sebelum atau saat sedang proses pengiriman bubble (in-flight).
   * Mencegah webhook echo dari WAHA salah mendeteksi bubble bot sebagai balasan manual admin.
   */
  public registerInFlightBotOutbound(chatId: string, content: string, tenantId: string, ttlMs = 45000): void {
    if (!chatId || !content) return;
    const cleanPhone = chatId.replace(/@.*$/, '').replace(/[^\d]/g, '');
    const cleanContent = content.trim();
    if (!cleanContent) return;

    const expiresAt = Date.now() + ttlMs;
    inFlightBotOutbounds.push({
      chatId,
      phone: cleanPhone,
      content: cleanContent,
      tenantId,
      expiresAt,
    });
  }

  /**
   * Hapus registrasi in-flight bot outbound setelah pengiriman selesai/dibatalkan.
   */
  public clearInFlightBotOutbound(chatId: string, tenantId?: string): void {
    const cleanPhone = chatId ? chatId.replace(/@.*$/, '').replace(/[^\d]/g, '') : '';
    const now = Date.now();
    for (let i = inFlightBotOutbounds.length - 1; i >= 0; i--) {
      const entry = inFlightBotOutbounds[i];
      if (entry.expiresAt <= now || (cleanPhone && entry.phone === cleanPhone && (!tenantId || entry.tenantId === tenantId))) {
        inFlightBotOutbounds.splice(i, 1);
      }
    }
  }

  /**
   * Pengecekan apakah pesan outbound yang diterima di webhook merupakan bubble bot yang sedang in-flight.
   */
  public isInFlightBotOutbound(
    chatIdOrPhone: string,
    content: string,
    tenantId: string,
    customWindowMs = 60000
  ): boolean {
    if (!chatIdOrPhone || !content) return false;
    const cleanPhone = chatIdOrPhone.replace(/@.*$/, '').replace(/[^\d]/g, '');
    const normalizedContent = content.trim().toLowerCase().replace(/\s+/g, ' ');
    const now = Date.now();

    // Cleanup expired
    for (let i = inFlightBotOutbounds.length - 1; i >= 0; i--) {
      if (inFlightBotOutbounds[i].expiresAt <= now) {
        inFlightBotOutbounds.splice(i, 1);
      }
    }

    const matched = inFlightBotOutbounds.find((entry) => {
      if (tenantId && entry.tenantId !== tenantId) return false;
      const phoneMatch = !cleanPhone || !entry.phone || entry.phone === cleanPhone || entry.chatId.includes(cleanPhone);
      if (!phoneMatch) return false;

      // Custom window check jika ditentukan
      if (customWindowMs && now - (entry.expiresAt - 60000) > customWindowMs) {
        return false;
      }

      const entryNorm = entry.content.toLowerCase().trim().replace(/\s+/g, ' ');
      if (entryNorm === normalizedContent) return true;

      // Substring / prefix match (antisipasi WAHA memotong/trimming teks)
      const checkLen = Math.min(entryNorm.length, normalizedContent.length, 60);
      if (checkLen >= 15 && entryNorm.slice(0, checkLen) === normalizedContent.slice(0, checkLen)) {
        return true;
      }
      return false;
    });

    if (matched) {
      console.log(`[IN-FLIGHT BOT MATCH] Outbound echo matched in-flight bot bubble for ${chatIdOrPhone}: "${content.slice(0, 40)}..."`);
      return true;
    }

    return false;
  }

  /**
   * F5: daftarkan wa_message_id yang PASTI dikirim bot (dari hasil send).
   * Dipakai sebagai penentu utama bot-vs-admin (anti salah-kategorikan gema).
   */
  public registerKnownBotMessageId(waMessageId: string, tenantId: string, ttlMs = 6 * 60 * 60 * 1000): void {
    if (!waMessageId) return;
    const now = Date.now();
    for (let i = knownBotMessageIds.length - 1; i >= 0; i--) {
      if (knownBotMessageIds[i].expiresAt <= now) knownBotMessageIds.splice(i, 1);
    }
    knownBotMessageIds.push({ waMessageId, tenantId, expiresAt: now + ttlMs });
  }

  /** F5: cek apakah wa_message_id ini diketahui pesan bot (penentu utama). */
  public isKnownBotMessageId(waMessageId: string, tenantId?: string): boolean {
    if (!waMessageId) return false;
    const now = Date.now();
    for (let i = knownBotMessageIds.length - 1; i >= 0; i--) {
      if (knownBotMessageIds[i].expiresAt <= now) knownBotMessageIds.splice(i, 1);
    }
    return knownBotMessageIds.some(
      (e) => e.waMessageId === waMessageId && (!tenantId || e.tenantId === tenantId)
    );
  }

  /**
   * Pengecekan Idempotensi: Memeriksa apakah wa_message_id dari Meta sudah pernah diproses.
   * Mengembalikan true jika pesan SUDAH PERNAH diproses sebelumnya (duplicate/retry).
   */
  public async isDuplicateMessage(waMessageId: string, tenantId: string): Promise<boolean> {
    if (!waMessageId) return false;

    const shortId = extractShortMessageId(waMessageId);
    const keysToCheck = [
      `${tenantId}:${waMessageId}`,
      shortId !== waMessageId ? `${tenantId}:${shortId}` : null,
    ].filter(Boolean) as string[];

    try {
      // 1. Cek DB dulu — otoritas lintas-instance (bukan Set memori).
      const { getMessageRepository } = await import('../../repositories/message.repository');
      const exists = await getMessageRepository().existsByWaId(waMessageId, shortId, tenantId);
      if (exists) {
        // sinkronkan ke memori untuk dedup in-flight berikutnya
        for (const key of keysToCheck) addMemoryWaMessageId(key);
        return true;
      }
    } catch (error) {
      // DB offline → fallback ke memori
      for (const key of keysToCheck) {
        if (memoryWaMessageIds.has(key)) return true;
      }
      return false;
    }

    // 2. Belum ada di DB → kunci in-flight di memori untuk request paralel di proses yang sama
    for (const key of keysToCheck) addMemoryWaMessageId(key);
    return false;
  }

  /**
   * Pengecekan deduplikasi outbound: memeriksa apakah pesan outbound dengan konten serupa
   * baru saja dicatat (misal via Live Chat / Staff Dashboard) dalam window detik tertentu.
   * Jika ada, tautkan wa_message_id pesan tersebut agar tidak membuat baris baru ganda di database.
   */
  public async checkAndAttachOutboundDuplicate(
    conversationId: string,
    content: string,
    waMessageId: string,
    tenantId: string,
    windowSeconds = 60,
    isMediaOrImage = false
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - windowSeconds * 1000);
    const normalizedContent = (content || '').trim();
    const isMediaPlaceholder =
      isMediaOrImage ||
      !normalizedContent ||
      /^\[(IMAGE|MEDIA|GAMBAR|VOICE_NOTE|AUDIO|DOCUMENT|VIDEO|DOKUMEN)/i.test(normalizedContent);
    const strippedCaption = normalizedContent.replace(
      /^\[(IMAGE|MEDIA|GAMBAR|VOICE_NOTE|AUDIO|DOCUMENT|VIDEO|DOKUMEN)(?::\s*([^\]]+))?\]/i,
      '$2'
    ).trim();
    const shortId = extractShortMessageId(waMessageId);

    // 1. Cek memoryMessages fallback
    const memMsg = memoryMessages.find(
      (m) =>
        m.conversation_id === conversationId &&
        m.tenant_id === tenantId &&
        m.direction === 'OUTBOUND' &&
        new Date(m.created_at) >= cutoff &&
        (
          (isMediaPlaceholder && (
            !m.content ||
            /^\[(IMAGE|MEDIA|GAMBAR|VOICE_NOTE|AUDIO|DOCUMENT|VIDEO|DOKUMEN)/i.test((m.content || '').trim()) ||
            !!(m.payload_raw as any)?.media ||
            (m.content || '').toLowerCase().startsWith('pricelist') ||
            (strippedCaption && (m.content || '').trim().toLowerCase() === strippedCaption.toLowerCase())
          )) ||
          (!isMediaPlaceholder && (
            (m.content || '').trim().toLowerCase() === normalizedContent.toLowerCase() ||
            (normalizedContent.length >= 20 && (m.content || '').toLowerCase().includes(normalizedContent.toLowerCase()))
          ))
        )
    );
    if (memMsg) {
      if (!memMsg.wa_message_id && waMessageId) {
        memMsg.wa_message_id = waMessageId;
        addMemoryWaMessageId(`${tenantId}:${waMessageId}`);
        if (shortId && shortId !== waMessageId) {
          addMemoryWaMessageId(`${tenantId}:${shortId}`);
        }
      }
      return true;
    }

    // 2. Cek DB Prisma
    try {
      let whereClause: any = {
        conversation_id: conversationId,
        tenant_id: tenantId,
        direction: 'OUTBOUND',
        created_at: { gte: cutoff },
      };

      if (isMediaPlaceholder) {
        whereClause.OR = [
          { content: { startsWith: '[IMAGE' } },
          { content: { startsWith: '[MEDIA' } },
          { content: { startsWith: '[GAMBAR' } },
          { content: { startsWith: '[VOICE_NOTE' } },
          { content: { startsWith: '[AUDIO' } },
          { content: { startsWith: '[DOCUMENT' } },
          { content: { startsWith: '[VIDEO' } },
          { content: { startsWith: '[DOKUMEN' } },
          { content: '[IMAGE]' },
          { content: '[MEDIA]' },
          { content: '[VOICE_NOTE]' },
          { content: '[AUDIO]' },
          { content: '[DOCUMENT]' },
          { content: '[VIDEO]' },
          { content: { startsWith: 'Pricelist', mode: 'insensitive' } },
          ...(strippedCaption ? [
            { content: { equals: strippedCaption, mode: 'insensitive' } },
            { content: { contains: strippedCaption, mode: 'insensitive' } },
          ] : []),
          ...(normalizedContent ? [
            { content: { equals: normalizedContent, mode: 'insensitive' } },
            { content: { contains: normalizedContent, mode: 'insensitive' } },
          ] : []),
        ];
      } else if (normalizedContent.length >= 20) {
        whereClause.OR = [
          { content: { equals: normalizedContent, mode: 'insensitive' } },
          { content: { contains: normalizedContent, mode: 'insensitive' } },
        ];
      } else {
        whereClause.content = {
          equals: normalizedContent,
          mode: 'insensitive',
        };
      }

      const existing = await prisma.message.findFirst({
        where: whereClause,
        orderBy: { created_at: 'desc' },
      });

      if (existing) {
        if (!existing.wa_message_id && waMessageId) {
          await updateScopedMessage(existing.id, tenantId, { wa_message_id: waMessageId });
        }
        addMemoryWaMessageId(`${tenantId}:${waMessageId}`);
        if (shortId && shortId !== waMessageId) {
          addMemoryWaMessageId(`${tenantId}:${shortId}`);
        }
        return true;
      }
    } catch (_) {}

    return false;
  }
}

export const messageDedupService = new MessageDedupService();
