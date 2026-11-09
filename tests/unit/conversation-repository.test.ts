import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PostgresConversationRepository,
  InMemoryConversationRepository,
  getConversationRepository,
  setConversationRepository,
  resetConversationRepository,
} from '../../src/repositories/conversation.repository';
import { prisma } from '../../src/db/client';
import { ConversationState } from '@prisma/client';

/**
 * PLAN 8 FASE 5b — Repository seam conversation.
 */

describe('FASE 5b — conversation repository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetConversationRepository();
  });

  it('default adapter adalah Postgres', () => {
    expect(getConversationRepository()).toBeInstanceOf(PostgresConversationRepository);
  });

  it('Postgres: DB error DILEMPAR (fail-closed)', async () => {
    vi.mocked(prisma.conversation.findFirst).mockRejectedValue(new Error('Database offline'));
    const repo = new PostgresConversationRepository();
    await expect(repo.getOrCreate('cust-1', 't')).rejects.toThrow('Database offline');
  });

  it('Postgres: tenant mismatch pada findById → null', async () => {
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ id: 'c1', tenant_id: 'other' } as any);
    const repo = new PostgresConversationRepository();
    expect(await repo.findById('c1', 't')).toBeNull();
  });

  it('Postgres: updateState tenant mismatch → throw (bukan tulis lintas tenant)', async () => {
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ id: 'c1', tenant_id: 'other' } as any);
    const repo = new PostgresConversationRepository();
    await expect(
      repo.updateState('c1', { currentState: ConversationState.HUMAN_HANDLING }, 't')
    ).rejects.toThrow();
  });

  it('Postgres: updateState menulis dengan tenant_id di WHERE (FASE 3 K-03)', async () => {
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ id: 'c1', tenant_id: 't' } as any);
    vi.mocked(prisma.conversation.updateMany).mockResolvedValue({ count: 1 } as any);
    const repo = new PostgresConversationRepository();
    await repo.updateState('c1', { currentState: ConversationState.HUMAN_HANDLING }, 't');
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', tenant_id: 't' } })
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('Postgres: getOrCreate memfilter closed_at: null saat mencari percakapan aktif', async () => {
    const activeRow = { id: 'c-active', tenant_id: 't', customer_id: 'cust-1', closed_at: null };
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(activeRow as any);
    const repo = new PostgresConversationRepository();
    const result = await repo.getOrCreate('cust-1', 't');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { customer_id: 'cust-1', tenant_id: 't', closed_at: null },
      orderBy: { updated_at: 'desc' },
    });
    expect(result.id).toBe('c-active');
  });

  it('Postgres: getOrCreate menangani race condition P2002 dan me-read row yang dibuat proses lawan', async () => {
    vi.mocked(prisma.conversation.findFirst)
      .mockResolvedValueOnce(null) // Pertama tidak ada
      .mockResolvedValueOnce({ id: 'c-raced', customer_id: 'cust-1', tenant_id: 't', closed_at: null } as any); // Kedua berhasil temukan row lawan

    const p2002Err: any = new Error('Unique constraint failed');
    p2002Err.code = 'P2002';
    vi.mocked(prisma.conversation.create).mockRejectedValueOnce(p2002Err);

    const repo = new PostgresConversationRepository();
    const result = await repo.getOrCreate('cust-1', 't');
    expect(result.id).toBe('c-raced');
    expect(prisma.conversation.findFirst).toHaveBeenCalledTimes(2);
  });

  it('Postgres: closeConversation menutup percakapan aktif dengan tenant guard', async () => {
    vi.mocked(prisma.conversation.updateMany).mockResolvedValue({ count: 1 } as any);
    const repo = new PostgresConversationRepository();
    const closeDate = new Date('2026-11-09T10:00:00.000Z');
    await (repo as any).closeConversation('c-1', 't', closeDate);
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c-1', tenant_id: 't', closed_at: null },
      data: { closed_at: closeDate },
    });
  });

  it('Postgres: closeActiveConversation menutup semua percakapan aktif customer pada tenant', async () => {
    vi.mocked(prisma.conversation.updateMany).mockResolvedValue({ count: 1 } as any);
    const repo = new PostgresConversationRepository();
    const closeDate = new Date('2026-11-09T10:00:00.000Z');
    await (repo as any).closeActiveConversation('cust-1', 't', closeDate);
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { customer_id: 'cust-1', tenant_id: 't', closed_at: null },
      data: { closed_at: closeDate },
    });
  });

  it('InMemory: percakapan yang di-close tidak lagi dikembalikan oleh getOrCreate', async () => {
    const repo = new InMemoryConversationRepository();
    const a = await repo.getOrCreate('cust-1', 't');
    expect(a.closed_at).toBeNull();

    await (repo as any).closeConversation(a.id, 't');
    const b = await repo.getOrCreate('cust-1', 't');
    expect(b.id).not.toBe(a.id);
    expect(b.closed_at).toBeNull();
  });

  it('InMemory: closeActiveConversation menutup percakapan aktif customer', async () => {
    const repo = new InMemoryConversationRepository();
    const a = await repo.getOrCreate('cust-1', 't');
    await (repo as any).closeActiveConversation('cust-1', 't');
    const b = await repo.getOrCreate('cust-1', 't');
    expect(b.id).not.toBe(a.id);
  });

  it('InMemory: getOrCreate idempoten per (customer, tenant)', async () => {
    const repo = new InMemoryConversationRepository();
    const a = await repo.getOrCreate('cust-1', 't');
    const b = await repo.getOrCreate('cust-1', 't');
    expect(a.id).toBe(b.id);
    const c = await repo.getOrCreate('cust-1', 't2');
    expect(c.id).not.toBe(a.id);
  });

  it('InMemory: updateState + tenant guard', async () => {
    const repo = new InMemoryConversationRepository();
    const conv = await repo.getOrCreate('cust-1', 't');
    const updated = await repo.updateState(conv.id, { currentState: ConversationState.HUMAN_HANDLING, isHumanHandling: true }, 't');
    expect(updated.current_state).toBe(ConversationState.HUMAN_HANDLING);
    await expect(repo.updateState(conv.id, {}, 'other')).rejects.toThrow();
    await expect(repo.updateState('nope', {}, 't')).rejects.toThrow();
  });

  it('set/reset wiring', () => {
    const mem = new InMemoryConversationRepository();
    setConversationRepository(mem);
    expect(getConversationRepository()).toBe(mem);
    resetConversationRepository();
    expect(getConversationRepository()).toBeInstanceOf(PostgresConversationRepository);
  });
});
