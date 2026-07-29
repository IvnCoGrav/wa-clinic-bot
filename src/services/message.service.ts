import { prisma } from '../db/client';
import { Direction } from '@prisma/client';

// In-Memory store fallback untuk idempotency check jika DB belum terkoneksi saat dev local
const memoryWaMessageIds = new Set<string>();

export class MessageService {
  /**
   * Pengecekan Idempotensi: Memeriksa apakah wa_message_id dari Meta sudah pernah diproses.
   * Mengembalikan true jika pesan SUDAH PERNAH diproses sebelumnya (duplicate/retry).
   */
  public async isDuplicateMessage(waMessageId: string, tenantId: string): Promise<boolean> {
    if (!waMessageId) return false;

    const memoryKey = `${tenantId}:${waMessageId}`;

    // 1. Cek memory store dulu
    if (memoryWaMessageIds.has(memoryKey)) {
      return true;
    }

    // Tambahkan ke memory store sebagai lock in-flight agar request paralel tertahan
    memoryWaMessageIds.add(memoryKey);

    try {
      // 2. Query ke Prisma DB
      const existing = await prisma.message.findFirst({
        where: { wa_message_id: waMessageId, tenant_id: tenantId },
      });

      if (existing) {
        return true;
      }
    } catch (error) {
      // Jika DB connection error dalam testing environment, gunakan fallback memory store
    }

    return false;
  }

  /**
   * Menyimpan record pesan (Audit Trail) ke tabel messages dan menambahkan wa_message_id ke idempotency store.
   */
  public async logMessage(data: {
    conversationId: string;
    direction: Direction;
    content: string;
    waMessageId?: string;
    payloadRaw?: any;
    tenantId: string;
  }) {
    if (data.waMessageId) {
      memoryWaMessageIds.add(`${data.tenantId}:${data.waMessageId}`);
    }

    try {
      return await prisma.message.create({
        data: {
          tenant_id: data.tenantId,
          conversation_id: data.conversationId,
          direction: data.direction,
          content: data.content,
          wa_message_id: data.waMessageId || null,
          payload_raw: data.payloadRaw ? JSON.parse(JSON.stringify(data.payloadRaw)) : undefined,
        },
      });
    } catch (error) {
      console.warn('DB logMessage error (using fallback):', (error as Error).message);
      return null;
    }
  }

  /**
   * Mengambil pesan inbound (masuk) terakhir dari customer untuk thread percakapan tertentu.
   */
  public async getLastInboundMessage(conversationId: string, tenantId: string): Promise<any> {
    try {
      return await prisma.message.findFirst({
        where: { conversation_id: conversationId, tenant_id: tenantId, direction: Direction.INBOUND },
        orderBy: { created_at: 'desc' },
      });
    } catch (error) {
      return null;
    }
  }
}


export const messageService = new MessageService();
