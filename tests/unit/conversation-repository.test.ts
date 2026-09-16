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
