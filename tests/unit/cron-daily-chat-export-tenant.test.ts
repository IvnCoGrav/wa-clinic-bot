import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { CronService } from '../../src/services/cron.service';
import { chatExportService } from '../../src/services/chat-export.service';

/**
 * Ar-003 — ekspor chat harian harus mencakup SEMUA tenant, bukan default saja.
 */
describe('runDailyChatExport lintas tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([
      { id: 'tenant-a' },
      { id: 'tenant-b' },
    ] as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('memanggil saveDayExport untuk setiap tenant', async () => {
    const spy = vi.spyOn(chatExportService, 'saveDayExport').mockResolvedValue({
      success: true,
      fileName: 'daily-chats.md',
      stats: { totalConversations: 2, totalMessages: 5 },
    } as any);

    await new CronService().runDailyChatExport();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map((c) => c[0]).sort()).toEqual(['tenant-a', 'tenant-b']);
    // Tanggal yang sama untuk semua tenant.
    expect(spy.mock.calls[0][1]).toBe(spy.mock.calls[1][1]);
  });

  it('kegagalan satu tenant tidak menghentikan tenant lain', async () => {
    const spy = vi
      .spyOn(chatExportService, 'saveDayExport')
      .mockImplementation((async (tenantId: string) => {
        if (tenantId === 'tenant-a') return { success: false, error: 'disk penuh' };
        return {
          success: true,
          fileName: 'daily-chats.md',
          stats: { totalConversations: 1, totalMessages: 3 },
        };
      }) as any);

    await new CronService().runDailyChatExport();

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
