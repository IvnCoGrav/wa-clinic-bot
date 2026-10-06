import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { prisma } from '../../src/db/client';
import { deriveConversationState } from '../../src/v3/agent/pipeline/phase-resolver';
import { conversationService } from '../../src/services/conversation.service';
import { reservationLifecycleService } from '../../src/services/reservation-lifecycle.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Fase C2 (Rencana Perbaikan Opsi C) — status COMPLETED yang NYATA.
 *
 * Akar masalah R2 (drift): sebelumnya TIDAK ADA kode yang menulis COMPLETED ke DB,
 * sehingga current_state bisa nyangkut di RESERVATION_SENT walau reservasi selesai.
 * Test ini mengunci dua hal:
 *   (a) derivasi sesi booking-selesai = COMPLETED (tidak tertimpa ask_schedule);
 *   (b) lifecycle onReservationCompleted benar-benar menulis COMPLETED ke conversation.
 */
describe('Fase C2 — status COMPLETED nyata', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('(a) sesi dengan booking.reservationId diturunkan COMPLETED', () => {
    const session = { booking: { reservationId: 'res-1', isConfirmed: true } } as any;
    expect(deriveConversationState(session, ['ask_schedule'])).toBe(ConversationState.COMPLETED);
  });

  it('(a2) booking selesai TIDAK tertimpa jadi RESERVATION_SENT walau ada intent ask_schedule', () => {
    const session = { booking: { reservationId: 'res-9' } } as any;
    const state = deriveConversationState(session, ['ask_schedule']);
    expect(state).toBe(ConversationState.COMPLETED);
    expect(state).not.toBe(ConversationState.RESERVATION_SENT);
  });

  it('(b) onReservationCompleted menulis current_state=COMPLETED ke conversation', async () => {
    const convId = `conv-c2-${Date.now()}`;
    // activeConv dicari via prisma.conversation.findFirst -> beri id yang jelas.
    vi.mocked(prisma.conversation.findFirst as any).mockResolvedValueOnce({ id: convId });
    // state lama dibaca via findUnique.
    vi.mocked(prisma.conversation.findUnique as any).mockResolvedValueOnce({
      current_state: ConversationState.RESERVATION_SENT,
    });
    const spy = vi
      .spyOn(conversationService, 'updateConversationState')
      .mockResolvedValue({ id: convId, current_state: ConversationState.COMPLETED } as any);

    await reservationLifecycleService.onReservationCompleted({
      customerId: 'cust-c2',
      reservationId: 'res-c2',
      bookingDate: new Date('2026-10-05T02:00:00Z'),
      treatmentCategory: 'BABY',
      tenantId: DEFAULT_TENANT_ID,
    });

    const calledWithCompleted = spy.mock.calls.some(
      ([, updates]) => (updates as any)?.currentState === ConversationState.COMPLETED
    );
    expect(calledWithCompleted).toBe(true);
  });

  it('(b2) lifecycle tidak melempar walau findFirst gagal (DB offline)', async () => {
    vi.mocked(prisma.conversation.findFirst as any).mockRejectedValueOnce(new Error('Database offline'));
    const spy = vi.spyOn(conversationService, 'updateConversationState').mockResolvedValue({} as any);
    await expect(
      reservationLifecycleService.onReservationCompleted({
        customerId: 'cust-c2b',
        reservationId: 'res-c2b',
        bookingDate: new Date('2026-10-05T02:00:00Z'),
        tenantId: DEFAULT_TENANT_ID,
      })
    ).resolves.toBeUndefined();
    // tanpa id conversation, tidak ada tulis status — tapi TIDAK boleh crash.
    expect(spy).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ currentState: ConversationState.COMPLETED }), expect.anything());
  });
});
