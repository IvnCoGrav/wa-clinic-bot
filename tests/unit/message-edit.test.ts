import { describe, it, expect, vi, beforeEach } from 'vitest';
import { messageService } from '../../src/services/message.service';
import { prisma } from '../../src/db/client';

/**
 * Regresi bug: pesan yang diedit di WhatsApp (admin/kustomer) TIDAK ter-update
 * di livechat. Akar masalah:
 * 1. Handler webhook tidak membaca field `editedMessageId` (payload resmi WAHA
 *    message.edited hanya menyediakan id aksi + editedMessageId raw key + body).
 * 2. updateMessageContent mencocokkan persis (id / wa_message_id), padahal yang
 *    tersimpan adalah serialized `true_{chatId}_{key}` sementara editedMessageId
 *    hanya raw key `{key}`.
 *
 * Test ini meniru PERILAKU DB NYATA: satu baris hanya dianggap ketemu bila
 * `where` yang diberikan benar-benar cocok (baik exact maupun OR + endsWith).
 */

const STORED_WA_ID = 'true_628123456789@c.us_3EB0ABCDEF123456';
const RAW_KEY = '3EB0ABCDEF123456';

const storedRow = {
  id: 'local-uuid-1',
  conversation_id: 'conv-1',
  tenant_id: 'tenant-a',
  wa_message_id: STORED_WA_ID,
  payload_raw: {},
};

/**
 * Evaluator where sederhana yang mendukung bentuk yang dipakai service:
 * { id }, { wa_message_id }, { tenant_id }, dan { OR: [ {wa_message_id: {endsWith}} ... ] }
 */
function matchesWhere(row: any, where: any): boolean {
  if (!where) return false;
  if (where.OR) return where.OR.some((w: any) => matchesWhere(row, w));
  for (const [key, val] of Object.entries(where)) {
    if (val && typeof val === 'object' && 'endsWith' in (val as any)) {
      if (!String(row[key] ?? '').endsWith((val as any).endsWith)) return false;
    } else if (row[key] !== val) {
      return false;
    }
  }
  return true;
}

describe('messageService.updateMessageContent (WAHA message.edited)', () => {
  const TENANT = 'tenant-a';

  beforeEach(() => {
    vi.restoreAllMocks();
    // Tiru DB: cari baris hanya jika where cocok dengan baris tersimpan.
    vi.mocked(prisma.message.findFirst).mockImplementation((async (args: any) =>
      matchesWhere(storedRow, args?.where) ? storedRow : null) as any);
    vi.mocked(prisma.message.update).mockResolvedValue({} as any);
  });

  it('E1: match raw key (editedMessageId) terhadap wa_message_id serialized', async () => {
    await messageService.updateMessageContent(RAW_KEY, 'Teks baru dari edit', TENANT);

    const updateArg = vi.mocked(prisma.message.update).mock.calls[0]?.[0];
    expect(updateArg).toBeTruthy();
    expect(updateArg.where).toEqual({ id: 'local-uuid-1' });
    expect(updateArg.data.content).toBe('Teks baru dari edit');
    expect(updateArg.data.payload_raw.is_edited).toBe(true);
  });

  it('E2: match exact wa_message_id serialized (admin edit dari livechat)', async () => {
    await messageService.updateMessageContent(STORED_WA_ID, 'Teks baru', TENANT);

    const updateArg = vi.mocked(prisma.message.update).mock.calls[0]?.[0];
    expect(updateArg.where).toEqual({ id: 'local-uuid-1' });
  });

  it('E3: match via id internal (edit dari dashboard livechat)', async () => {
    await messageService.updateMessageContent('local-uuid-1', 'Teks baru', TENANT);

    const updateArg = vi.mocked(prisma.message.update).mock.calls[0]?.[0];
    expect(updateArg.where).toEqual({ id: 'local-uuid-1' });
  });

  it('E4: tidak match → tidak ada update (tidak crash)', async () => {
    await messageService.updateMessageContent('key-tidak-dikenal', 'text', TENANT);

    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('E5: DB error → fallback memory tidak crash', async () => {
    vi.mocked(prisma.message.findFirst).mockRejectedValue(new Error('Database offline'));

    await expect(
      messageService.updateMessageContent(RAW_KEY, 'text', TENANT)
    ).resolves.toBe(true);
  });
});
