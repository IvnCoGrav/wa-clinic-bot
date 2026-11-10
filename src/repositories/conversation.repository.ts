import { prisma } from '../db/client';
import { ConversationState } from '@prisma/client';

/**
 * conversation.repository.ts — Seam persistensi conversation (PLAN 8 FASE 5b).
 *
 * Pola sama seperti customer.repository (5a):
 *  - `ConversationRepository`: kontrak persistensi murni.
 *  - `PostgresConversationRepository`: fail-closed, tanpa objek fiktif.
 *  - `InMemoryConversationRepository`: test double eksplisit.
 *
 * Cakupan: getOrCreate, findById, updateState, flagForReview,
 * closeConversation, closeActiveConversation.
 */

export interface ConversationStatePatch {
  currentState?: ConversationState;
  previousState?: ConversationState | null;
  locationAttempts?: number;
  consecutiveUnknownCount?: number;
  isHumanHandling?: boolean;
  humanHandlingSince?: Date | null;
  escalationReason?: string | null;
  lastMessageAt?: Date;
}

export interface ConversationRepository {
  getOrCreate(customerId: string, tenantId: string): Promise<any>;
  findById(id: string, tenantId: string): Promise<any | null>;
  updateState(id: string, patch: ConversationStatePatch, tenantId: string): Promise<any>;
  /**
   * Plan Fase 3 (sesi 89-turn): penandaan antrean kurasi admin (review_flagged)
   * TANPA mengubah flag operasional is_human_handling. Berbeda dengan escalate —
   * kurasi FAQ bukan pengalihan CS; bot tetap aktif menjawab.
   */
  flagForReview(id: string, reason: string, tenantId: string): Promise<any>;
  /**
   * D-01: Menutup percakapan aktif berdasarkan ID dan tenant.
   */
  closeConversation(id: string, tenantId: string, closedAt?: Date): Promise<any>;
  /**
   * D-01: Menutup seluruh percakapan aktif milik customer di tenant ini (mis. saat /reset).
   */
  closeActiveConversation(customerId: string, tenantId: string, closedAt?: Date): Promise<any>;
}

export class PostgresConversationRepository implements ConversationRepository {
  async getOrCreate(customerId: string, tenantId: string): Promise<any> {
    let conversation = await prisma.conversation.findFirst({
      where: { customer_id: customerId, tenant_id: tenantId, closed_at: null },
      orderBy: { updated_at: 'desc' },
    });
    if (!conversation) {
      try {
        conversation = await prisma.conversation.create({
          data: {
            tenant_id: tenantId,
            customer_id: customerId,
            current_state: ConversationState.INITIAL,
            is_human_handling: false,
            is_pinned: false,
            is_manual_unread: false,
            closed_at: null,
          },
        });
      } catch (err: any) {
        // Race condition handler (D-01): bila ada request paralel yang baru saja membuat
        // percakapan aktif (terjaring P2002 unique constraint), ambil baris yang baru terbuat.
        if (err?.code === 'P2002') {
          conversation = await prisma.conversation.findFirst({
            where: { customer_id: customerId, tenant_id: tenantId, closed_at: null },
            orderBy: { updated_at: 'desc' },
          });
        }
        if (!conversation) throw err;
      }
    }
    if (!conversation) throw new Error('Database create returned null/undefined');
    return conversation;
  }

  async closeConversation(id: string, tenantId: string, closedAt: Date = new Date()): Promise<any> {
    const res = await prisma.conversation.updateMany({
      where: { id, tenant_id: tenantId, closed_at: null },
      data: { closed_at: closedAt },
    });
    return res;
  }

  async closeActiveConversation(customerId: string, tenantId: string, closedAt: Date = new Date()): Promise<any> {
    const res = await prisma.conversation.updateMany({
      where: { customer_id: customerId, tenant_id: tenantId, closed_at: null },
      data: { closed_at: closedAt },
    });
    return res;
  }

  async findById(id: string, tenantId: string): Promise<any | null> {
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return null;
    if (tenantId && (conversation as any).tenant_id && (conversation as any).tenant_id !== tenantId) return null;
    return conversation;
  }

  async updateState(id: string, patch: ConversationStatePatch, tenantId: string): Promise<any> {
    const data: any = {};
    if (patch.currentState !== undefined) data.current_state = patch.currentState;
    if (patch.previousState !== undefined) data.previous_state = patch.previousState;
    if (patch.locationAttempts !== undefined) data.location_attempts = patch.locationAttempts;
    if (patch.consecutiveUnknownCount !== undefined) data.consecutive_unknown_count = patch.consecutiveUnknownCount;
    if (patch.isHumanHandling !== undefined) data.is_human_handling = patch.isHumanHandling;
    if (patch.humanHandlingSince !== undefined) data.human_handling_since = patch.humanHandlingSince;
    if (patch.escalationReason !== undefined) data.escalation_reason = patch.escalationReason;
    if (patch.lastMessageAt !== undefined) data.last_message_at = patch.lastMessageAt;
    // D-04: Jalur cepat hemat round-trip (2 query alih-alih 3).
    // Langsung updateMany dengan tenant guard di WHERE.
    const res = await prisma.conversation.updateMany({ where: { id, tenant_id: tenantId }, data });
    if (res.count > 0) {
      return await prisma.conversation.findUnique({ where: { id } });
    }
    // count === 0: periksa apakah conversation tidak ada atau milik tenant lain.
    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) throw new Error(`Conversation ${id} not found`);
    if (tenantId && (existing as any).tenant_id && (existing as any).tenant_id !== tenantId) {
      throw new Error(`Conversation ${id} bukan milik tenant ${tenantId}`);
    }
    throw new Error(`Conversation ${id} not found for tenant ${tenantId}`);
  }

  async flagForReview(id: string, reason: string, tenantId: string): Promise<any> {
    // D-04: Jalur cepat hemat round-trip (2 query alih-alih 3).
    const res = await prisma.conversation.updateMany({
      where: { id, tenant_id: tenantId },
      data: { review_flagged: true, escalation_reason: reason },
    });
    if (res.count > 0) {
      return await prisma.conversation.findUnique({ where: { id } });
    }
    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) throw new Error(`Conversation ${id} not found`);
    if (tenantId && (existing as any).tenant_id && (existing as any).tenant_id !== tenantId) {
      throw new Error(`Conversation ${id} bukan milik tenant ${tenantId}`);
    }
    throw new Error(`Conversation ${id} not found for tenant ${tenantId}`);
  }
}

export class InMemoryConversationRepository implements ConversationRepository {
  private store = new Map<string, any>();

  async getOrCreate(customerId: string, tenantId: string): Promise<any> {
    for (const c of this.store.values()) {
      if (c?.customer_id === customerId && c?.tenant_id === tenantId && !c?.closed_at) return c;
    }
    const conv = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      tenant_id: tenantId,
      customer_id: customerId,
      current_state: ConversationState.INITIAL,
      previous_state: null,
      location_attempts: 0,
      is_human_handling: false,
      human_handling_since: null,
      consecutive_unknown_count: 0,
      review_flagged: false,
      last_message_at: new Date(),
      is_pinned: false,
      pinned_at: null,
      is_manual_unread: false,
      closed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    this.store.set(conv.id, conv);
    return conv;
  }

  async closeConversation(id: string, tenantId: string, closedAt: Date = new Date()): Promise<any> {
    const c = this.store.get(id);
    if (c && (!tenantId || c.tenant_id === tenantId)) {
      c.closed_at = closedAt;
      c.updated_at = new Date();
      return { count: 1 };
    }
    return { count: 0 };
  }

  async closeActiveConversation(customerId: string, tenantId: string, closedAt: Date = new Date()): Promise<any> {
    let count = 0;
    for (const c of this.store.values()) {
      if (c?.customer_id === customerId && (!tenantId || c?.tenant_id === tenantId) && !c?.closed_at) {
        c.closed_at = closedAt;
        c.updated_at = new Date();
        count++;
      }
    }
    return { count };
  }

  async findById(id: string, tenantId: string): Promise<any | null> {
    const c = this.store.get(id);
    if (!c) return null;
    if (tenantId && c.tenant_id && c.tenant_id !== tenantId) return null;
    return c;
  }

  async updateState(id: string, patch: ConversationStatePatch, tenantId: string): Promise<any> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Conversation ${id} not found`);
    if (tenantId && existing.tenant_id && existing.tenant_id !== tenantId) {
      throw new Error(`Conversation ${id} bukan milik tenant ${tenantId}`);
    }
    const data: any = { ...existing };
    if (patch.currentState !== undefined) data.current_state = patch.currentState;
    if (patch.previousState !== undefined) data.previous_state = patch.previousState;
    if (patch.locationAttempts !== undefined) data.location_attempts = patch.locationAttempts;
    if (patch.consecutiveUnknownCount !== undefined) data.consecutive_unknown_count = patch.consecutiveUnknownCount;
    if (patch.isHumanHandling !== undefined) data.is_human_handling = patch.isHumanHandling;
    if (patch.humanHandlingSince !== undefined) data.human_handling_since = patch.humanHandlingSince;
    if (patch.escalationReason !== undefined) data.escalation_reason = patch.escalationReason;
    if (patch.lastMessageAt !== undefined) data.last_message_at = patch.lastMessageAt;
    data.updated_at = new Date();
    this.store.set(id, data);
    return data;
  }

  clear(): void {
    this.store.clear();
  }

  async flagForReview(id: string, reason: string, _tenantId: string): Promise<any> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Conversation ${id} not found`);
    if (_tenantId && existing.tenant_id && existing.tenant_id !== _tenantId) {
      throw new Error(`Conversation ${id} bukan milik tenant ${_tenantId}`);
    }
    const data = { ...existing, review_flagged: true, escalation_reason: reason, updated_at: new Date() };
    this.store.set(id, data);
    return data;
  }

  /**
   * HANYA untuk test: tanam baris state awal (mis. fixture ber-ID tetap).
   * Produksi tidak pernah memakai ini — state selalu dibuat via getOrCreate.
   */
  seedForTest(rows: any[]): void {
    for (const r of rows) {
      if (r?.id) this.store.set(r.id, { ...r });
    }
  }
}

let activeRepo: ConversationRepository = new PostgresConversationRepository();

export function getConversationRepository(): ConversationRepository {
  return activeRepo;
}

/** HANYA untuk test. */
export function setConversationRepository(next: ConversationRepository): void {
  activeRepo = next;
}

/** HANYA untuk test. */
export function resetConversationRepository(): void {
  activeRepo = new PostgresConversationRepository();
}
