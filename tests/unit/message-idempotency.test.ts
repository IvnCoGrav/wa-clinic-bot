import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { messageService } from '../../src/services/message.service';
import { prisma } from '../../src/db/client';
import {
  PostgresMessageRepository,
  resetMessageRepository,
  setMessageRepository,
} from '../../src/repositories/message.repository';

describe('Message Idempotency & Deduplication (Per-Tenant)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Jalur DB-Path asli (PLAN 8 FASE 5c): repository Postgres benar-benar
    // memanggil prisma.message.findFirst — setup default (InMemory) tidak.
    setMessageRepository(new PostgresMessageRepository());
  });

  afterEach(() => {
    resetMessageRepository();
  });

  it('detects duplicate message for same tenant from DB', async () => {
    const waMsgId = 'wamid.test.001';
    vi.mocked(prisma.message.findFirst).mockResolvedValueOnce({ id: 'msg_1', tenant_id: 'tenant-a', wa_message_id: waMsgId } as any);

    const isDup = await messageService.isDuplicateMessage(waMsgId, 'tenant-a');
    expect(isDup).toBe(true);
    expect(prisma.message.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenant_id: 'tenant-a' }),
    }));
  });

  it('allows same wa_message_id for different tenants (per-tenant namespace)', async () => {
    const waMsgId = 'wamid.shared.100';
    // di tenant-a, ada pesan
    vi.mocked(prisma.message.findFirst).mockResolvedValueOnce({ id: 'msg_1', tenant_id: 'tenant-a', wa_message_id: waMsgId } as any);
    const isDupA = await messageService.isDuplicateMessage(waMsgId, 'tenant-a');
    expect(isDupA).toBe(true);

    // di tenant-b, belum ada
    vi.mocked(prisma.message.findFirst).mockResolvedValueOnce(null);
    const isDupInB = await messageService.isDuplicateMessage(waMsgId, 'tenant-b');
    expect(isDupInB).toBe(false);
  });

  it('returns false if wa_message_id is empty', async () => {
    const isDup = await messageService.isDuplicateMessage('', 'tenant-a');
    expect(isDup).toBe(false);
  });
});
