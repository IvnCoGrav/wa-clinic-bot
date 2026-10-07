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
  activeReservationWhere,
  isActiveReservation,
  isHoldActive,
  isTreatmentWithinActiveWindow,
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

  it('filter=reservation: confirmed/en_route/pending butuh jendela 2 jam + null; hold butuh jendela', async () => {
    const before = Date.now();
    await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'reservation');
    const where = lastWhere();
    const some = where.customer.reservations.some;
    // Status terjadwal: null ATAU >= now-2jam, memakai status `in`.
    const scheduledNull = some.OR.find((o: any) => o.booking_date === null && o.status?.in);
    const scheduledGte = some.OR.find((o: any) => o.booking_date?.gte && o.status?.in);
    expect(scheduledNull.status.in).toEqual(expect.arrayContaining(['confirmed', 'en_route', 'pending']));
    expect(scheduledGte.status.in).toEqual(expect.arrayContaining(['confirmed', 'en_route', 'pending']));
    const cutoff = scheduledGte.booking_date.gte.getTime();
    // cutoff harus ~= now - 2 jam (toleransi 3 detik)
    expect(Math.abs(cutoff - (before - ACTIVE_HOLD_WINDOW_MS))).toBeLessThan(3000);
    // hold: hanya jendela waktu (tanpa cabang null).
    const hold = some.OR.find((o: any) => o.status === 'hold');
    expect(hold).toBeTruthy();
    expect(hold.booking_date?.gte).toBeTruthy();
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
  it('meneruskan filter + staffId ke conversationService.listConversations', async () => {
    const spy = vi.spyOn(conversationService, 'listConversations').mockResolvedValue({ items: [], hasMore: false } as any);
    try {
      await liveChatService.getConversationList(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'reservation', 'unassigned');
      expect(spy).toHaveBeenCalledWith(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'reservation', 'unassigned');
    } finally {
      spy.mockRestore();
    }
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

    const unreadRes = await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'unread');
    const unread = Array.isArray(unreadRes) ? unreadRes : unreadRes.items;
    expect(unread.some((c: any) => c.id === conv.id)).toBe(true);

    await messageService.markConversationMessagesAsRead(conv.id, DEFAULT_TENANT_ID);

    const afterReadRes = await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real', undefined, undefined, 'unread');
    const afterRead = Array.isArray(afterReadRes) ? afterReadRes : afterReadRes.items;
    expect(afterRead.some((c: any) => c.id === conv.id)).toBe(false);
  });

  it('search filter: word-boundary pesan tidak mencocokkan 7km pada chat yang hanya berisi 17km', async () => {
    const phone = `6281${Date.now().toString().slice(-8)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Jarak', DEFAULT_TENANT_ID);
    const conv = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    await messageService.logMessage({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conv.id,
      direction: Direction.INBOUND,
      content: 'Jarak rumah saya sekitar 17km dari klinik',
    });

    // Cari "7km" -> chat dengan "17km" tidak boleh muncul
    const search7km = await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real', '7km');
    const items7km = Array.isArray(search7km) ? search7km : search7km.items;
    expect(items7km.some((c: any) => c.id === conv.id)).toBe(false);

    // Cari "17km" -> chat harus muncul
    const search17km = await conversationService.listConversations(DEFAULT_TENANT_ID, 50, 0, 'real', '17km');
    const items17km = Array.isArray(search17km) ? search17km : search17km.items;
    expect(items17km.some((c: any) => c.id === conv.id)).toBe(true);
  });
});

describe('domain/reservation-status — isActiveReservation & hold expiry', () => {
  it('confirmed & pending aktif bila booking_date null', () => {
    const now = Date.now();
    expect(isActiveReservation({ status: 'confirmed', booking_date: null }, now)).toBe(true);
    expect(isActiveReservation({ status: 'pending', booking_date: null }, now)).toBe(true);
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

describe('domain/reservation-status — jendela treatment (hari-H ke depan, gugur setelah 2 jam)', () => {
  const now = new Date('2026-10-05T09:00:00.000Z').getTime();
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 5, h, m)).getTime();

  it('isTreatmentWithinActiveWindow: null & tanggal korup fail-open, lampau gugur', () => {
    expect(isTreatmentWithinActiveWindow(null, now)).toBe(true);
    expect(isTreatmentWithinActiveWindow(undefined, now)).toBe(true);
    expect(isTreatmentWithinActiveWindow('bukan-tanggal', now)).toBe(true);
    // Kemarin jam 10:00 → jauh lewat jendela → gugur.
    expect(isTreatmentWithinActiveWindow(new Date('2026-10-04T10:00:00.000Z'), now)).toBe(false);
    // Hari ini 07:00, sekarang 09:00 → tepat di batas (>= now-2jam) → masih aktif.
    expect(isTreatmentWithinActiveWindow(new Date(at(7)), now)).toBe(true);
    // Hari ini 06:59 → lewat 2 jam 1 menit → gugur.
    expect(isTreatmentWithinActiveWindow(new Date(at(6, 59)), now)).toBe(false);
    // Nanti sore → aktif.
    expect(isTreatmentWithinActiveWindow(new Date(at(14)), now)).toBe(true);
    // Besok / masa depan → aktif.
    expect(isTreatmentWithinActiveWindow(new Date('2026-10-10T08:00:00.000Z'), now)).toBe(true);
  });

  it('isActiveReservation: confirmed lampau gugur, confirmed berjalan/depan aktif', () => {
    expect(isActiveReservation({ status: 'confirmed', booking_date: new Date('2026-10-04T10:00:00.000Z') }, now)).toBe(false);
    expect(isActiveReservation({ status: 'confirmed', booking_date: new Date(at(8, 30)) }, now)).toBe(true);
    expect(isActiveReservation({ status: 'confirmed', booking_date: new Date(at(14)) }, now)).toBe(true);
    expect(isActiveReservation({ status: 'pending', booking_date: new Date('2026-10-04T10:00:00.000Z') }, now)).toBe(false);
  });

  it('activeReservationWhere: bentuk query Prisma paritas (null | gte untuk status terjadwal, gte untuk hold)', () => {
    const where = activeReservationWhere(now);
    expect(where.OR).toHaveLength(3);
    const scheduledNull = where.OR.find((o) => o.booking_date === null);
    expect(scheduledNull.status.in).toEqual(expect.arrayContaining(['confirmed', 'en_route', 'pending']));
    const scheduledGte = where.OR.find((o) => o.booking_date?.gte && o.status?.in);
    expect(scheduledGte.booking_date.gte.getTime()).toBe(now - ACTIVE_HOLD_WINDOW_MS);
    const hold = where.OR.find((o) => o.status === 'hold');
    expect(hold.booking_date.gte.getTime()).toBe(now - ACTIVE_HOLD_WINDOW_MS);
    // Paritas: setiap kasus yang lolos isActiveReservation harus lolos where juga.
    expect(isActiveReservation({ status: 'confirmed', booking_date: null }, now)).toBe(true);
    expect(isActiveReservation({ status: 'hold', booking_date: new Date(now) }, now)).toBe(true);
  });
});
