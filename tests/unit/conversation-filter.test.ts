import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Direction } from '@prisma/client';
import { conversationService } from '../../src/services/conversation.service';
import { liveChatService } from '../../src/services/live-chat.service';
import { customerService } from '../../src/services/customer.service';
import { messageService } from '../../src/services/message.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import {
  ACTIVE_HOLD_WINDOW_MS,
  isActiveReservation,
  isHoldActive,
} from '../../src/domain/reservation-status';

/**
 * Server-side filter untuk tab Unread & Reservasi (fondasional).
 *
 * Tujuan: paginasi & hasMore dihitung dari TOTAL di PostgreSQL, bukan dari 50
 * item yang sudah ditarik ke memori browser. Uji di sini menargetkan KONTRAK
 * query (bentuk where Prisma) + paritas fallback in-memory — bukan happy path.
 */
describe('conversationService.listConversations — server-side filter', () => {
  beforeEach(() => {
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([] as any);
  });

  function lastWhere(): any {
    const calls = vi.mocked(prisma.conversation.findMany).mock.calls;
    return calls[calls.length - 1]?.[0]?.where;
  }

  it('filter=unread membangun AND(OR(manual_unread | inbound read_at null))', async () => {
    await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'unread');
    const where = lastWhere();
    expect(Array.isArray(where.AND)).toBe(true);
    const unreadClause = where.AND.find((c: any) => c.OR?.some((o: any) => o.is_manual_unread === true));
    expect(unreadClause).toBeTruthy();
    expect(unreadClause.OR).toContainEqual({ is_manual_unread: true });
    expect(unreadClause.OR).toContainEqual({ messages: { some: { direction: 'INBOUND', read_at: null } } });
  });

  it('filter=reservation pakai status aktif + hold-window 2 jam (paritas frontend)', async () => {
    const before = Date.now();
    await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'reservation');
    const where = lastWhere();
    const some = where.customer.reservations.some;
    expect(some.OR).toContainEqual({ status: 'confirmed' });
    expect(some.OR).toContainEqual({ status: 'pending' });
    const hold = some.OR.find((o: any) => o.status === 'hold');
    expect(hold).toBeTruthy();
    const cutoff = hold.booking_date.gte.getTime();
    // cutoff harus ~= now - 2 jam (toleransi 3 detik)
    expect(Math.abs(cutoff - (before - ACTIVE_HOLD_WINDOW_MS))).toBeLessThan(3000);
  });

  it('filter=all TIDAK menambah AND dan tetap memasang isolasi mode', async () => {
    await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real');
    const where = lastWhere();
    expect(where.AND).toBeUndefined();
    expect(where.customer).toEqual({ is_sandbox_test: false });
  });

  it('filter=unread + search digabung via AND (tidak saling menimpa OR)', async () => {
    await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real', 'sari', undefined, 'unread');
    const where = lastWhere();
    expect(where.OR).toBeUndefined();
    expect(where.AND.length).toBe(2); // [searchOR, unreadOR]
    const hasSearch = where.AND.some((c: any) =>
      c.OR?.some((o: any) => o.customer?.name?.contains === 'sari')
    );
    const hasUnread = where.AND.some((c: any) => c.OR?.some((o: any) => o.is_manual_unread === true));
    expect(hasSearch).toBe(true);
    expect(hasUnread).toBe(true);
  });

  it('filter=reservation tidak menimpa isolasi sandbox (satu objek customer)', async () => {
    await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'reservation');
    const where = lastWhere();
    expect(where.customer.is_sandbox_test).toBe(false);
    expect(where.customer.reservations).toBeTruthy();
  });
});

describe('liveChatService.getConversationList — pass-through filter', () => {
  it('meneruskan filter ke conversationService.listConversations', async () => {
    const spy = vi.spyOn(conversationService, 'listConversations').mockResolvedValue([] as any);
    await liveChatService.getConversationList(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'unread');
    expect(spy).toHaveBeenCalledWith(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'unread');
    spy.mockRestore();
  });
});

describe('conversationService.listConversations — fallback memory (DB offline)', () => {
  // Paksa jalur fallback: primary query DB offline (default mock) — bukan resolve [].
  beforeEach(() => {
    vi.mocked(prisma.conversation.findMany).mockRejectedValue(new Error('Database offline'));
  });

  it('filter=unread menyertakan inbound belum dibaca lalu mengecualikannya setelah dibaca', async () => {
    const phone = `6281${Date.now().toString().slice(-8)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Adversarial', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conv.id,
      direction: Direction.INBOUND,
      content: 'Halo masih ada slot?',
    });

    const unread = await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'unread');
    expect(unread.some((c: any) => c.id === conv.id)).toBe(true);

    await messageService.markConversationMessagesAsRead(conv.id, DEFAULT_TENANT_ID);

    const afterRead = await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'unread');
    expect(afterRead.some((c: any) => c.id === conv.id)).toBe(false);
  });
});

describe('domain/reservation-status — isActiveReservation & hold expiry', () => {
  it('confirmed & pending aktif kapan pun', () => {
    expect(isActiveReservation({ status: 'confirmed', booking_date: null })).toBe(true);
    expect(isActiveReservation({ status: 'pending', booking_date: null })).toBe(true);
  });

  it('hold aktif hanya bila booking_date dalam jendela 2 jam', () => {
    const now = Date.now();
    const freshHold = new Date(now - 30 * 60 * 1000).toISOString(); // 30 menit lalu
    const staleHold = new Date(now - 3 * 60 * 60 * 1000).toISOString(); // 3 jam lalu
    expect(isHoldActive(freshHold, now)).toBe(true);
    expect(isHoldActive(staleHold, now)).toBe(false);
    expect(isActiveReservation({ status: 'hold', booking_date: freshHold }, now)).toBe(true);
    expect(isActiveReservation({ status: 'hold', booking_date: staleHold }, now)).toBe(false);
  });

  it('status non-aktif (completed/cancelled) & booking_date kosong → bukan aktif', () => {
    expect(isActiveReservation({ status: 'completed' })).toBe(false);
    expect(isActiveReservation({ status: 'cancelled' })).toBe(false);
    expect(isActiveReservation({ status: 'hold', booking_date: null })).toBe(false);
    expect(isActiveReservation(null)).toBe(false);
  });
});
