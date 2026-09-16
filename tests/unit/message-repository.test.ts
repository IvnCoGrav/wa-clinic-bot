import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PostgresMessageRepository,
  InMemoryMessageRepository,
  getMessageRepository,
  setMessageRepository,
  resetMessageRepository,
} from '../../src/repositories/message.repository';
import { prisma } from '../../src/db/client';
import { Direction } from '@prisma/client';

/**
 * PLAN 8 FASE 5c — Repository seam message.
 */

describe('FASE 5c — message repository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetMessageRepository();
  });

  it('default adapter adalah Postgres', () => {
    expect(getMessageRepository()).toBeInstanceOf(PostgresMessageRepository);
  });

  it('Postgres: DB error DILEMPAR (fail-closed), tanpa objek msg_ fiktif', async () => {
    vi.mocked(prisma.message.create).mockRejectedValue(new Error('Database offline'));
    const repo = new PostgresMessageRepository();
    await expect(
      repo.create({ tenant_id: 't', conversation_id: 'c', direction: Direction.INBOUND, content: 'hi' })
    ).rejects.toThrow('Database offline');
  });

  it('Postgres: create null → throw', async () => {
    vi.mocked(prisma.message.create).mockResolvedValue(null as any);
    const repo = new PostgresMessageRepository();
    await expect(
      repo.create({ tenant_id: 't', conversation_id: 'c', direction: Direction.INBOUND, content: 'hi' })
    ).rejects.toThrow();
  });

  it('Postgres: existsByWaId mendelegasikan ke prisma', async () => {
    vi.mocked(prisma.message.findFirst).mockResolvedValue({ id: 'm1' } as any);
    const repo = new PostgresMessageRepository();
    expect(await repo.existsByWaId('wa_1', null, 't')).toBe(true);
    vi.mocked(prisma.message.findFirst).mockResolvedValue(null);
    expect(await repo.existsByWaId('wa_2', null, 't')).toBe(false);
  });

  it('InMemory: create + existsByWaId', async () => {
    const repo = new InMemoryMessageRepository();
    const row = await repo.create({
      tenant_id: 't', conversation_id: 'c', direction: Direction.INBOUND,
      content: 'hi', wa_message_id: 'wa_1',
    });
    expect(row.id).toMatch(/^msg_/);
    expect(await repo.existsByWaId('wa_1', null, 't')).toBe(true);
    expect(await repo.existsByWaId('wa_2', null, 't')).toBe(false);
    // Isolasi tenant
    expect(await repo.existsByWaId('wa_1', null, 'other')).toBe(false);
  });

  it('set/reset wiring', () => {
    const mem = new InMemoryMessageRepository();
    setMessageRepository(mem);
    expect(getMessageRepository()).toBe(mem);
    resetMessageRepository();
    expect(getMessageRepository()).toBeInstanceOf(PostgresMessageRepository);
  });
});
