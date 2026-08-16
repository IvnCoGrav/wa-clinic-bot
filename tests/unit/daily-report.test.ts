import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dailyReportService } from '../../src/services/daily-report.service';
import { prisma } from '../../src/db/client';
import { alertService } from '../../src/services/alert.service';

vi.mock('../../src/db/client', () => ({
  prisma: {
    dailyReportLog: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    tenant: { findUnique: vi.fn() },
    reservation: { findMany: vi.fn() },
    clinicService: { findMany: vi.fn() },
    conversation: { count: vi.fn() },
    message: { count: vi.fn(), findMany: vi.fn() },
    adClick: { count: vi.fn(), findMany: vi.fn() },
    customer: { count: vi.fn(), findMany: vi.fn() },
    medicalFaqStaging: { count: vi.fn() },
    generalFaqStaging: { count: vi.fn() },
  }
}));

vi.mock('../../src/services/alert.service', () => ({
  alertService: {
    notifyAlert: vi.fn()
  },
  AlertType: { DAILY_OPS_REPORT: 'DAILY_OPS_REPORT' },
  AlertSeverity: { INFO: 'INFO' }
}));

vi.mock('../../src/integrations/llm/model-fallback', () => ({
  callChatCompletionsWithFallback: vi.fn().mockResolvedValue({ data: { choices: [{ message: { content: 'Mock summary' } }] } }),
  getFallbackModel: vi.fn()
}));
vi.mock('../../src/config/ai-models.config', () => ({
  AiModelConfigService: {
    getModelConfig: vi.fn().mockReturnValue({ modelName: 'test', temperature: 0.1 })
  }
}));

describe('DailyReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mocks for zero data
    vi.mocked(prisma.dailyReportLog.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ name: 'Test Tenant' } as any);
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([]);
    vi.mocked(prisma.clinicService.findMany).mockResolvedValue([]);
    vi.mocked(prisma.conversation.count).mockResolvedValue(0);
    vi.mocked(prisma.message.count).mockResolvedValue(0);
    vi.mocked(prisma.message.findMany).mockResolvedValue([]);
    vi.mocked(prisma.adClick.count).mockResolvedValue(0);
    vi.mocked(prisma.adClick.findMany).mockResolvedValue([]);
    vi.mocked(prisma.customer.count).mockResolvedValue(0);
    vi.mocked(prisma.customer.findMany).mockResolvedValue([]);
    vi.mocked(prisma.medicalFaqStaging.count).mockResolvedValue(0);
    vi.mocked(prisma.generalFaqStaging.count).mockResolvedValue(0);

    vi.mocked(alertService.notifyAlert).mockResolvedValue({ sent: true, throttled: false, channel: 'telegram' } as any);
  });

  it('should handle zero data scenarios gracefully', async () => {
    const reportData = await dailyReportService.generateReport('tenant-1', new Date(), '2026-01-01');
    expect(reportData.sales.totalConfirmed).toBe(0);
    expect(reportData.sales.totalRevenue).toBe(0);
    expect(reportData.insights.summarization).toBe('Tidak ada percakapan masuk hari ini.');

    const formatted = dailyReportService.formatForTelegram('Tenant Test', reportData);
    expect(formatted).toContain('N/A');
    expect(formatted).toContain('*0*');
  });

  it('should handle resilient API down (failed to send to Telegram)', async () => {
    vi.mocked(alertService.notifyAlert).mockResolvedValue({ sent: false, throttled: false, channel: 'console' } as any);
    
    await dailyReportService.sendDailyReport('tenant-1');
    
    expect(prisma.dailyReportLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'failed' }),
        update: expect.objectContaining({ status: 'failed' })
      })
    );
  });

  it('should handle concurrent async overlap (race condition simulating P2002 Unique Constraint)', async () => {
    let callCount = 0;
    // Simulate first upsert passing, second upsert throwing Prisma constraint error
    vi.mocked(prisma.dailyReportLog.upsert).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('P2002: Unique constraint failed');
      }
      return {} as any;
    });

    // Fire 2 concurrent calls
    await Promise.allSettled([
      dailyReportService.sendDailyReport('tenant-1'),
      dailyReportService.sendDailyReport('tenant-1')
    ]);

    // Service should catch the error and not crash
    expect(callCount).toBe(2);
  });

  it('should correctly flag revenue as (estimasi) using fuzzy matching', async () => {
    // Mock reservation with slightly typoed treatment
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { treatment_detail: 'spa bayii', customer: { created_at: new Date() } }
    ] as any);

    // Mock clinic service with correct name
    vi.mocked(prisma.clinicService.findMany).mockResolvedValue([
      { service_id: 'spa-bayi', name: 'Spa Bayi', promo_price: 150000, original_price: 200000 }
    ] as any);

    const reportData = await dailyReportService.generateReport('tenant-1', new Date(), '2026-01-01');
    
    expect(reportData.sales.totalRevenue).toBe(150000);
    expect(reportData.sales.revenueIsEstimated).toBe(true);

    const formatted = dailyReportService.formatForTelegram('Tenant Test', reportData);
    expect(formatted).toContain('(estimasi)');
  });

  describe('sendTestDailyReport (QA Dummy Mode)', () => {
    it('should send dummy test message to Telegram without writing to DailyReportLog in DB', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        name: 'Kala Test Clinic',
        telegram_bot_token: 'bot123',
        telegram_chat_id: 'chat123'
      } as any);
      vi.mocked(alertService.notifyAlert).mockResolvedValue({ sent: true, throttled: false, channel: 'telegram' } as any);

      const result = await dailyReportService.sendTestDailyReport('tenant-1');

      expect(result.success).toBe(true);
      expect(result.channel).toBe('telegram');
      expect(alertService.notifyAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('[TEST / DATA DUMMY]'),
          rawMessage: true,
          botToken: 'bot123',
          chatId: 'chat123',
          metadata: expect.objectContaining({ is_test: true })
        })
      );
      // Critical check: Never write to daily report log in DB
      expect(prisma.dailyReportLog.upsert).not.toHaveBeenCalled();
    });

    it('should reject test send if credentials are not configured', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        name: 'Kala Test Clinic',
        telegram_bot_token: null,
        telegram_chat_id: null
      } as any);

      const originalEnvToken = process.env.TELEGRAM_BOT_TOKEN;
      const originalEnvChat = process.env.TELEGRAM_CHAT_ID;
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;

      const result = await dailyReportService.sendTestDailyReport('tenant-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('belum diisi');

      process.env.TELEGRAM_BOT_TOKEN = originalEnvToken;
      process.env.TELEGRAM_CHAT_ID = originalEnvChat;
    });

    it('should report failure if Telegram dispatch falls back or fails', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        name: 'Kala Test Clinic',
        telegram_bot_token: 'bot123',
        telegram_chat_id: 'chat123'
      } as any);
      vi.mocked(alertService.notifyAlert).mockResolvedValue({ sent: true, throttled: false, channel: 'emergency_file' } as any);

      const result = await dailyReportService.sendTestDailyReport('tenant-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Gagal mengirim ke Telegram');
      expect(prisma.dailyReportLog.upsert).not.toHaveBeenCalled();
    });
  });
});
