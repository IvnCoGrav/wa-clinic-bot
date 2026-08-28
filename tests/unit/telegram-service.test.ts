import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelegramService } from '../../src/services/telegram.service';
import { prisma } from '../../src/db/client';

describe('TelegramService Unit Tests', () => {
  let telegramService: TelegramService;

  beforeEach(() => {
    vi.restoreAllMocks();
    telegramService = new TelegramService();
  });

  it('should generate pairing info and upsert tenant when tenant does not have a token or record', async () => {
    // 1st findUnique returns null (tenant not in DB)
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce(null);

    // upsert succeeds
    vi.mocked(prisma.tenant.upsert).mockResolvedValueOnce({
      id: 'tenant-test',
      slug: 'tenant-test',
      name: 'Tenant tenant-test',
      telegram_pairing_token: 'PAIR_ABC123',
      telegram_chat_id: null,
      telegram_topic_daily_report: null,
      telegram_topic_system_errors: null,
      telegram_topic_medical_alerts: null,
    } as any);

    const info = await telegramService.getTenantPairingInfo('tenant-test');

    expect(prisma.tenant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-test' },
        create: expect.objectContaining({
          id: 'tenant-test',
          slug: 'tenant-test',
        }),
      })
    );
    expect(info.pairingToken).toMatch(/^PAIR_/);
    expect(info.directLink).toContain(info.pairingToken);
    expect(info.groupLink).toContain(info.pairingToken);
    expect(info.isConfigured).toBe(false);
  });

  it('should reuse existing pairing token if already present in DB', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'tenant-test',
      slug: 'tenant-test',
      name: 'Tenant tenant-test',
      telegram_pairing_token: 'PAIR_EXISTING',
      telegram_chat_id: '12345678',
      telegram_topic_daily_report: '10',
      telegram_topic_system_errors: '20',
      telegram_topic_medical_alerts: '30',
    } as any);

    const info = await telegramService.getTenantPairingInfo('tenant-test');

    expect(prisma.tenant.upsert).not.toHaveBeenCalled();
    expect(info.pairingToken).toBe('PAIR_EXISTING');
    expect(info.isConfigured).toBe(true);
    expect(info.chatId).toBe('12345678');
    expect(info.topicDailyReport).toBe('10');
  });

  it('should regenerate pairing token via upsert', async () => {
    vi.mocked(prisma.tenant.upsert).mockResolvedValueOnce({
      id: 'tenant-test',
      slug: 'tenant-test',
      name: 'Tenant tenant-test',
      telegram_pairing_token: 'PAIR_NEW123',
    } as any);

    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'tenant-test',
      slug: 'tenant-test',
      name: 'Tenant tenant-test',
      telegram_pairing_token: 'PAIR_NEW123',
      telegram_chat_id: null,
    } as any);

    const info = await telegramService.regeneratePairingToken('tenant-test');

    expect(prisma.tenant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-test' },
      })
    );
    expect(info.pairingToken).toMatch(/^PAIR_/);
  });
});
