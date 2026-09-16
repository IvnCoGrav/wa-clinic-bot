import { prisma } from '../db/client';

/**
 * message.repository.ts — Seam persistensi message (PLAN 8 FASE 5c).
 *
 * Pola sama seperti customer/conversation (5a/5b):
 *  - `PostgresMessageRepository`: fail-closed — create melempar saat DB error,
 *    TIDAK PERNAH mengembalikan objek `msg_<ts>` fiktif sebagai "tersimpan".
 *  - `InMemoryMessageRepository`: test double eksplisit.
 *
 * Cakupan 5c: create (logMessage), existsByWaId (isDuplicateMessage).
 * Baca agregat (recent, unread, dsb.) tetap di service.
 */

export interface MessageCreateData {
  tenant_id: string;
  conversation_id: string;
  direction: any;
  content: string;
  wa_message_id?: string | null;
  payload_raw?: any;
  sender_type?: string;
  sender_name?: string | null;
  delivery_status?: string | null;
  meta_error_code?: string | null;
  meta_error_desc?: string | null;
  created_at?: Date;
  read_at?: Date | null;
}

export interface MessageRepository {
  create(data: MessageCreateData): Promise<any>;
  existsByWaId(waMessageId: string, shortId: string | null, tenantId: string): Promise<boolean>;
}

export class PostgresMessageRepository implements MessageRepository {
  async create(data: MessageCreateData): Promise<any> {
    const saved = await prisma.message.create({
      data: {
        tenant_id: data.tenant_id,
        conversation_id: data.conversation_id,
        direction: data.direction,
        content: data.content,
        wa_message_id: data.wa_message_id || null,
        payload_raw: data.payload_raw ?? undefined,
        sender_type: data.sender_type ?? undefined,
        sender_name: data.sender_name ?? undefined,
        delivery_status: data.delivery_status ?? undefined,
        meta_error_code: data.meta_error_code ?? undefined,
        meta_error_desc: data.meta_error_desc ?? undefined,
        created_at: data.created_at || undefined,
        read_at: data.read_at ?? undefined,
      },
    });
    if (!saved) throw new Error('Prisma create returned null/undefined (DB offline)');
    return saved;
  }

  async existsByWaId(waMessageId: string, shortId: string | null, tenantId: string): Promise<boolean> {
    const orConditions: any[] = [{ wa_message_id: waMessageId }];
    if (shortId && shortId !== waMessageId) {
      orConditions.push({ wa_message_id: shortId });
      orConditions.push({ wa_message_id: { endsWith: `_${shortId}` } });
    }
    const existing = await prisma.message.findFirst({
      where: { tenant_id: tenantId, OR: orConditions },
    });
    return !!existing;
  }
}

export class InMemoryMessageRepository implements MessageRepository {
  private messages: any[] = [];
  private waIds = new Set<string>();

  async create(data: MessageCreateData): Promise<any> {
    const row = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      tenant_id: data.tenant_id,
      conversation_id: data.conversation_id,
      direction: data.direction,
      content: data.content,
      wa_message_id: data.wa_message_id || null,
      payload_raw: data.payload_raw,
      sender_type: data.sender_type ?? 'BOT',
      sender_name: data.sender_name ?? null,
      delivery_status: data.delivery_status ?? null,
      meta_error_code: data.meta_error_code ?? null,
      meta_error_desc: data.meta_error_desc ?? null,
      created_at: data.created_at || new Date(),
      read_at: data.read_at ?? null,
    };
    this.messages.push(row);
    if (row.wa_message_id) this.waIds.add(`${data.tenant_id}:${row.wa_message_id}`);
    return row;
  }

  async existsByWaId(waMessageId: string, shortId: string | null, tenantId: string): Promise<boolean> {
    if (this.waIds.has(`${tenantId}:${waMessageId}`)) return true;
    if (shortId && shortId !== waMessageId && this.waIds.has(`${tenantId}:${shortId}`)) return true;
    return this.messages.some(
      (m) => m.tenant_id === tenantId && (m.wa_message_id === waMessageId || (shortId && m.wa_message_id === shortId))
    );
  }

  clear(): void {
    this.messages = [];
    this.waIds.clear();
  }
}

let activeRepo: MessageRepository = new PostgresMessageRepository();

export function getMessageRepository(): MessageRepository {
  return activeRepo;
}

/** HANYA untuk test. */
export function setMessageRepository(next: MessageRepository): void {
  activeRepo = next;
}

/** HANYA untuk test. */
export function resetMessageRepository(): void {
  activeRepo = new PostgresMessageRepository();
}
