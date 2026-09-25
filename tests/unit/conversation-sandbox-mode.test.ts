import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { conversationService } from '../../src/services/conversation.service';
import { prisma } from '../../src/db/client';

describe('conversationService.listConversations - sandbox isolation & access', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('mode=sandbox SELALU mencari is_sandbox_test: true bahkan di production', async () => {
    process.env.NODE_ENV = 'production';
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([] as any);

    await conversationService.listConversations('default-tenant', 50, 0, 'sandbox');

    expect(prisma.conversation.findMany).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(prisma.conversation.findMany).mock.calls[0][0];
    expect(callArg?.where?.customer).toEqual({ is_sandbox_test: true });
  });

  it('mode=real SELALU mencari is_sandbox_test: false', async () => {
    process.env.NODE_ENV = 'development';
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([] as any);

    await conversationService.listConversations('default-tenant', 50, 0, 'real');

    const callArg = vi.mocked(prisma.conversation.findMany).mock.calls[0][0];
    expect(callArg?.where?.customer).toEqual({ is_sandbox_test: false });
  });

  it('mode=all di production otomatis mengecualikan sandbox (is_sandbox_test: false)', async () => {
    process.env.NODE_ENV = 'production';
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([] as any);

    await conversationService.listConversations('default-tenant', 50, 0, 'all');

    const callArg = vi.mocked(prisma.conversation.findMany).mock.calls[0][0];
    expect(callArg?.where?.customer).toEqual({ is_sandbox_test: false });
  });

  it('mode=all di development tidak membatasi is_sandbox_test', async () => {
    process.env.NODE_ENV = 'development';
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([] as any);

    await conversationService.listConversations('default-tenant', 50, 0, 'all');

    const callArg = vi.mocked(prisma.conversation.findMany).mock.calls[0][0];
    expect(callArg?.where?.customer).toBeUndefined();
  });
});
