import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { followUpHolidayService } from '../../src/services/followup-holiday.service';
import { followUpEngineService } from '../../src/services/follow-up-engine.service';
import { followUpLifecycleService } from '../../src/services/follow-up-lifecycle.service';
import { CANCEL_REASON } from '../../src/services/follow-up-lifecycle.service';

describe('FollowUp Holiday Mode Unit Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('followUpHolidayService.getStatus & updateConfig', () => {
    it('mengembalikan status inactive saat enabled: false', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: DEFAULT_TENANT_ID,
        settings: { followUpHoliday: { enabled: false } },
      } as any);
      vi.spyOn(prisma.followUp, 'count').mockResolvedValue(0 as any);

      const status = await followUpHolidayService.getStatus(DEFAULT_TENANT_ID);
      expect(status.config.enabled).toBe(false);
      expect(status.state.status).toBe('inactive');
      expect(status.backlogCount).toBe(0);
    });

    it('mengembalikan active(range) saat tanggal hari ini masuk dalam startDate s/d endDate', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: DEFAULT_TENANT_ID,
        settings: {
          followUpHoliday: {
            enabled: true,
            startDate: '2026-12-24',
            endDate: '2026-12-26',
            reason: 'Libur Cuti Bersama',
          },
        },
      } as any);

      // 25 Des 2026 pukul 10:00 WIB = 03:00 UTC
      const now = new Date('2026-12-25T03:00:00.000Z');
      const status = await followUpHolidayService.getStatus(DEFAULT_TENANT_ID, now);

      expect(status.config.enabled).toBe(true);
      expect(status.state.status).toBe('active');
      if (status.state.status === 'active') {
        expect(status.state.mode).toBe('range');
      }
    });

    it('updateConfig mencatat manualActivatedAt saat mengaktifkan mode manual tanpa tanggal', async () => {
      let currentSettings: any = {};
      vi.spyOn(prisma.tenant, 'findUnique').mockImplementation(async () => ({
        id: DEFAULT_TENANT_ID,
        settings: currentSettings,
      } as any));

      const updateSpy = vi.spyOn(prisma.tenant, 'update').mockImplementation(async (args: any) => {
        currentSettings = args.data.settings;
        return { id: DEFAULT_TENANT_ID, settings: currentSettings } as any;
      });

      const updated = await followUpHolidayService.updateConfig(DEFAULT_TENANT_ID, {
        enabled: true,
      });

      expect(updateSpy).toHaveBeenCalled();
      expect(currentSettings.followUpHoliday.enabled).toBe(true);
      expect(typeof currentSettings.followUpHoliday.manualActivatedAt).toBe('string');
      expect(updated.enabled).toBe(true);
    });
  });

  describe('followUpHolidayService.runExitReschedule', () => {
    it('idempoten: jika lastRescheduledAt sama dengan exitKey, kembalikan summary tersimpan tanpa reschedule ulang', async () => {
      const summarySaved = {
        rescheduledCount: 25,
        daysCount: 1,
        distribution: { '2026-12-27': 25 },
        executedAt: '2026-12-27T02:00:00.000Z',
      };

      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: DEFAULT_TENANT_ID,
        settings: {
          followUpHoliday: {
            enabled: true,
            startDate: '2026-12-24',
            endDate: '2026-12-26',
            lastRescheduledAt: '2026-12-26',
            lastRescheduleSummary: summarySaved,
          },
        },
      } as any);

      const createLogSpy = vi.spyOn(prisma.adminNotificationLog, 'create');

      const dummyRescheduler = vi.fn();
      const res = await followUpHolidayService.runExitReschedule(
        DEFAULT_TENANT_ID,
        { status: 'exit_pending', exitEndDate: '2026-12-26' },
        new Date('2026-12-27T02:00:00.000Z'),
        dummyRescheduler
      );

      expect(res).toEqual(summarySaved);
      expect(dummyRescheduler).not.toHaveBeenCalled();
      expect(createLogSpy).not.toHaveBeenCalled();
    });

    it('mengklaim idempotency_key dan memanggil rescheduleOverdueFollowUps', async () => {
      let currentSettings: any = {
        followUpHoliday: {
          enabled: true,
          startDate: '2026-12-24',
          endDate: '2026-12-26',
          staleCapDays: 14,
          lastRescheduledAt: null,
        },
      };

      vi.spyOn(prisma.tenant, 'findUnique').mockImplementation(async () => ({
        id: DEFAULT_TENANT_ID,
        settings: currentSettings,
      } as any));

      vi.spyOn(prisma.tenant, 'update').mockImplementation(async (args: any) => {
        currentSettings = args.data.settings;
        return { id: DEFAULT_TENANT_ID, settings: currentSettings } as any;
      });

      vi.spyOn(prisma.adminNotificationLog, 'create').mockResolvedValue({} as any);

      const { followUpService } = await import('../../src/services/follow-up.service');
      const rescheduleSpy = vi.spyOn(followUpService, 'rescheduleOverdueFollowUps').mockResolvedValueOnce({
        rescheduledCount: 10,
        staleCancelledCount: 2,
        daysCount: 1,
        distribution: { '2026-12-27': 10 },
      });

      const res = await followUpHolidayService.runExitReschedule(
        DEFAULT_TENANT_ID,
        { status: 'exit_pending', exitEndDate: '2026-12-26' },
        new Date('2026-12-27T02:00:00.000Z'),
        rescheduleSpy
      );

      expect(res).toBeDefined();
      expect(res?.rescheduledCount).toBe(10);
      expect(res?.staleCancelledCount).toBe(2);
      expect(rescheduleSpy).toHaveBeenCalledWith(
        DEFAULT_TENANT_ID,
        expect.objectContaining({
          staleCapDays: 14,
          source: 'holiday_exit',
        })
      );
    });

    it('klaim segar milik proses lain → null dan tidak menjalankan reschedule', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: DEFAULT_TENANT_ID,
        settings: {
          followUpHoliday: {
            enabled: true,
            startDate: '2026-12-24',
            endDate: '2026-12-26',
            lastRescheduledAt: null,
          },
        },
      } as any);
      vi.spyOn(prisma.adminNotificationLog, 'create').mockRejectedValueOnce(new Error('unique'));
      vi.spyOn(prisma.adminNotificationLog, 'findUnique').mockResolvedValueOnce({
        id: 'claim-fresh',
        idempotency_key: 'HOLIDAY_EXIT:default-tenant:2026-12-26',
        sent_at: new Date(),
      } as any);

      const rescheduler = vi.fn();
      const res = await followUpHolidayService.runExitReschedule(
        DEFAULT_TENANT_ID,
        { status: 'exit_pending', exitEndDate: '2026-12-26' },
        new Date(),
        rescheduler
      );

      expect(res).toBeNull();
      expect(rescheduler).not.toHaveBeenCalled();
    });

    it('klaim basi dihapus lalu DIBUAT ULANG sebelum reschedule (anti dua proses)', async () => {
      let currentSettings: any = {
        followUpHoliday: {
          enabled: true,
          startDate: '2026-12-24',
          endDate: '2026-12-26',
          staleCapDays: 14,
          lastRescheduledAt: null,
        },
      };
      vi.spyOn(prisma.tenant, 'findUnique').mockImplementation(async () => ({
        id: DEFAULT_TENANT_ID,
        settings: currentSettings,
      } as any));
      vi.spyOn(prisma.tenant, 'update').mockImplementation(async (args: any) => {
        currentSettings = args.data.settings;
        return { id: DEFAULT_TENANT_ID, settings: currentSettings } as any;
      });

      const createSpy = vi.spyOn(prisma.adminNotificationLog, 'create')
        .mockRejectedValueOnce(new Error('unique'))
        .mockResolvedValueOnce({} as any);
      vi.spyOn(prisma.adminNotificationLog, 'findUnique').mockResolvedValueOnce({
        id: 'claim-old',
        idempotency_key: 'HOLIDAY_EXIT:default-tenant:2026-12-26',
        sent_at: new Date(Date.now() - 20 * 60 * 1000),
      } as any);
      const deleteSpy = vi.spyOn(prisma.adminNotificationLog, 'update').mockResolvedValue({} as any);

      const rescheduler = vi.fn().mockResolvedValue({
        rescheduledCount: 1,
        staleCancelledCount: 0,
        daysCount: 1,
        distribution: {},
      });

      const res = await followUpHolidayService.runExitReschedule(
        DEFAULT_TENANT_ID,
        { status: 'exit_pending', exitEndDate: '2026-12-26' },
        new Date(),
        rescheduler
      );

      expect(deleteSpy).toHaveBeenCalled();
      expect(createSpy).toHaveBeenCalledTimes(2);
      expect(rescheduler).toHaveBeenCalled();
      expect(res?.rescheduledCount).toBe(1);
    });
  });

  describe('processDueFollowUps Worker Gate saat Libur', () => {
    it('mengembalikan 0 dan tidak mengirim/menghapus follow-up saat mode libur active', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-12-25T03:00:00.000Z')); // 25 Des 2026 10:00 WIB

      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: DEFAULT_TENANT_ID,
        settings: {
          followUpHoliday: {
            enabled: true,
            startDate: '2026-12-24',
            endDate: '2026-12-26',
          },
        },
      } as any);

      const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
      vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);

      const findManySpy = vi.spyOn(prisma.followUp, 'findMany');
      const updateManySpy = vi.spyOn(prisma.followUp, 'updateMany');

      const processed = await followUpEngineService.processDueFollowUps(DEFAULT_TENANT_ID);

      expect(processed).toBe(0);
      expect(findManySpy).not.toHaveBeenCalled();
      expect(updateManySpy).not.toHaveBeenCalled();
    });

    it('menjalankan runExitReschedule sebelum proses antrean saat transisi exit_pending', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-12-27T03:00:00.000Z')); // 27 Des 2026 10:00 WIB

      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: DEFAULT_TENANT_ID,
        settings: {
          followUpHoliday: {
            enabled: true,
            startDate: '2026-12-24',
            endDate: '2026-12-26',
            autoRescheduleOnExit: true,
            lastRescheduledAt: null,
          },
        },
      } as any);

      const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
      vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);

      const exitSpy = vi.spyOn(followUpHolidayService, 'runExitReschedule').mockResolvedValueOnce({
        rescheduledCount: 5,
        daysCount: 1,
        distribution: {},
        executedAt: new Date().toISOString(),
      });

      vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce([]); // empty queue

      const { followUpService } = await import('../../src/services/follow-up.service');
      await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);

      expect(exitSpy).toHaveBeenCalled();
    });

    it('fail-closed: jika reschedule pasca-libur belum selesai, worker TIDAK memproses antrean', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-12-27T03:00:00.000Z')); // 27 Des 2026 10:00 WIB

      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: DEFAULT_TENANT_ID,
        settings: {
          followUpHoliday: {
            enabled: true,
            startDate: '2026-12-24',
            endDate: '2026-12-26',
            autoRescheduleOnExit: true,
            lastRescheduledAt: null,
          },
        },
      } as any);

      const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
      vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);

      // Simulasikan proses lain masih memegang klaim / reschedule gagal.
      vi.spyOn(followUpHolidayService, 'runExitReschedule').mockResolvedValueOnce(null);

      const { followUpService } = await import('../../src/services/follow-up.service');
      const engineSpy = vi.spyOn(followUpEngineService, 'processDueFollowUps');

      const processed = await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);

      expect(processed).toBe(0);
      expect(engineSpy).not.toHaveBeenCalled();
    });

    it('tenant isolation: tenant A libur, tenant B tetap diproses', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-12-25T03:00:00.000Z')); // 25 Des 2026 10:00 WIB

      vi.spyOn(prisma.tenant, 'findUnique').mockImplementation(async (args: any) => {
        const id = args?.where?.id;
        return {
          id,
          settings: {
            followUpHoliday: id === 'tenant-a'
              ? { enabled: true, startDate: '2026-12-24', endDate: '2026-12-26' }
              : { enabled: false },
          },
        } as any;
      });

      const { whatsappProviderService } = await import('../../src/services/whatsapp-provider.service');
      vi.spyOn(whatsappProviderService, 'isOutboundCutOff').mockResolvedValue(false as any);

      const findManySpy = vi.spyOn(prisma.followUp, 'findMany').mockResolvedValue([] as any);

      const a = await followUpEngineService.processDueFollowUps('tenant-a');
      expect(a).toBe(0);
      expect(findManySpy).not.toHaveBeenCalled();

      const b = await followUpEngineService.processDueFollowUps('tenant-b');
      expect(b).toBe(0);
      expect(findManySpy).toHaveBeenCalled();
    });
  });

  describe('Generators Clamping saat Libur Aktif', () => {
    it('createNoPurchaseFollowUps menjadwalkan ke hari pertama pasca libur jika jatuh pada tanggal libur', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: DEFAULT_TENANT_ID,
        settings: {
          followUpHoliday: {
            enabled: true,
            startDate: '2026-12-24',
            endDate: '2026-12-26',
          },
        },
      } as any);

      vi.spyOn(prisma.customer, 'findUnique').mockResolvedValueOnce({
        id: 'c-holiday-1',
        phone: '628111222333',
        name: 'Bunda Libur',
      } as any);

      vi.spyOn(prisma.reservation, 'findFirst').mockResolvedValueOnce(null);
      vi.spyOn(prisma.followUp, 'findFirst').mockResolvedValueOnce(null);
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValueOnce(null);

      const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

      // Simulasikan pemicu pada 22 Des: Stage 1 (+3 hari = 25 Des, hari libur)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-12-22T02:40:00.000Z')); // 22 Des 09:40 WIB

      try {
        await followUpLifecycleService.createNoPurchaseFollowUps('c-holiday-1', DEFAULT_TENANT_ID);

        expect(createSpy).toHaveBeenCalled();
        const calls = createSpy.mock.calls;
        const stage1Call = calls.find((c: any) => c[0]?.data?.stage === 1);
        expect(stage1Call).toBeDefined();

        const scheduledAt = stage1Call[0].data.scheduled_at as Date;
        // 25 Des adalah hari libur, di-clamp ke hari pertama pasca libur: 27 Des 2026 pada 09:00 WIB (02:00 UTC)
        expect(scheduledAt.toISOString().slice(0, 10)).toBe('2026-12-27');
        expect(scheduledAt.getUTCHours()).toBe(2);
        expect(scheduledAt.getUTCMinutes()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
