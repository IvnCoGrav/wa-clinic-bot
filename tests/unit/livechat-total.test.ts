import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { conversationService } from '../../src/services/conversation.service';
import { liveChatService } from '../../src/services/live-chat.service';

const ADMIN_KEY = 'test-admin-key';
const TENANT_ID = 'test-tenant';

describe('GET /api/admin/live-chat/conversations — Total Conversation Count', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  it('returns both total (overall count) and count (page size) in payload', async () => {
    vi.spyOn(liveChatService, 'getConversationList').mockResolvedValueOnce({
      items: [{ id: 'conv-1', customer: { name: 'Customer 1' }, messages: [] }] as any,
      hasMore: true,
      total: 42,
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/live-chat/conversations?limit=1',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': TENANT_ID,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.total).toBe(42);
    expect(body.hasMore).toBe(true);
  });

  it('conversationService.listConversations returns total from database count', async () => {
    vi.spyOn(prisma.conversation, 'count').mockResolvedValueOnce(99);
    vi.spyOn(prisma.conversation, 'findMany').mockResolvedValueOnce([
      { id: 'c1', tenant_id: TENANT_ID, customer_id: 'cust-1' },
    ] as any);

    const result = await conversationService.listConversations(TENANT_ID, 1, 0);
    expect(result.total).toBe(99);
    expect(result.items.length).toBe(1);
  });
});
