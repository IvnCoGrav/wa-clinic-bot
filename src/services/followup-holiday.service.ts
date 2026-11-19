import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getWibDateKey } from '../config/followup-templates';
import {
  FollowUpHolidayConfig,
  FollowUpHolidayState,
  FollowUpHolidayRescheduleSummary,
  parseFollowUpHolidayConfig,
  resolveFollowUpHolidayState,
} from '../config/followup-scheduling';
import { getFollowUpMaxPerDay } from '../config/followup-quota';
import { updateTenantSettingsSafely, getFollowUpHolidayConfig } from './tenant-settings.store';

export class FollowUpHolidayService {
  /**
   * Mengambil konfigurasi mode libur tenant saat ini.
   */
  public async getConfig(tenantId: string = DEFAULT_TENANT_ID): Promise<FollowUpHolidayConfig> {
    return getFollowUpHolidayConfig(tenantId);
  }

  /**
   * Mengambil status mode libur, state saat ini (active/inactive/exit_pending/manual_expired),
   * dan jumlah antrean backlog yang tertahan (scheduled_at < now).
   */
  public async getStatus(
    tenantId: string = DEFAULT_TENANT_ID,
    now: Date = new Date()
  ): Promise<{
    config: FollowUpHolidayConfig;
    state: FollowUpHolidayState;
    isActive: boolean;
    backlogCount: number;
    maxPerDay: number;
  }> {
    const config = await this.getConfig(tenantId);
    const state = resolveFollowUpHolidayState(config, now);
    const maxPerDay = await getFollowUpMaxPerDay(tenantId);

    let backlogCount = 0;
    try {
      const c = await prisma.followUp.count({
        where: {
          tenant_id: tenantId,
          type: { notIn: ['REMINDER_H1', 'REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] },
          status: { in: ['PENDING', 'QUEUED'] },
          scheduled_at: { lt: now },
        },
      });
      backlogCount = typeof c === 'number' ? c : 0;
    } catch {
      backlogCount = 0;
    }

    return {
      config,
      state,
      isActive: state.status === 'active',
      backlogCount,
      maxPerDay,
    };
  }

  /**
   * Memperbarui konfigurasi mode libur tenant secara atomik & aman.
   */
  public async updateConfig(
    tenantId: string = DEFAULT_TENANT_ID,
    patch: Partial<FollowUpHolidayConfig>
  ): Promise<FollowUpHolidayConfig> {
    const current = await this.getConfig(tenantId);

    const safePatch = { ...patch };

    // Jika mengaktifkan manual tanpa tanggal, catat manualActivatedAt.
    // Saat beralih dari rentang tanggal ke manual, timestamp lama WAJIB di-reset
    // agar mode manual tidak langsung dianggap kedaluwarsa (30 hari).
    const hasExplicitRange = safePatch.startDate !== undefined
      ? Boolean(safePatch.startDate)
      : Boolean(current.startDate);

    if (safePatch.enabled === true) {
      if (hasExplicitRange) {
        safePatch.manualActivatedAt = null;
      } else if (!current.manualActivatedAt || current.startDate) {
        safePatch.manualActivatedAt = new Date().toISOString();
      }
    } else if (safePatch.enabled === false) {
      safePatch.manualActivatedAt = null;
    }

    await updateTenantSettingsSafely(prisma, tenantId, (current) => ({
      ...current,
      followUpHoliday: {
        ...(current.followUpHoliday || {}),
        ...safePatch,
      },
    }));

    return this.getConfig(tenantId);
  }

  /**
   * Menyimpan kuota harian follow-up tenant (settings.followUpQuota.maxPerDay).
   * Dipakai modal Mode Libur agar admin tidak perlu menyunting JSON DB manual.
   */
  public async updateQuota(
    tenantId: string = DEFAULT_TENANT_ID,
    maxPerDay: number = 40
  ): Promise<number> {
    const safe = Math.min(200, Math.max(1, Math.trunc(Number(maxPerDay) || 40)));
    await updateTenantSettingsSafely(prisma, tenantId, (current) => ({
      ...current,
      followUpQuota: {
        ...(current.followUpQuota || {}),
        maxPerDay: safe,
      },
    }));
    return safe;
  }

  /**
   * Menjalankan rescheduling pasca-libur dengan proteksi idempotensi berbasis database.
   */
  public async runExitReschedule(
    tenantId: string = DEFAULT_TENANT_ID,
    state: FollowUpHolidayState,
    now: Date = new Date(),
    reschedulerFn?: (tenantId: string, options: any) => Promise<any>
  ): Promise<FollowUpHolidayRescheduleSummary | null> {
    const config = await this.getConfig(tenantId);

    const exitKey =
      state.status === 'exit_pending'
        ? state.exitEndDate
        : getWibDateKey(now) || new Date().toISOString().slice(0, 10);

    // Jika sudah pernah dieksekusi untuk tanggal keluar ini, kembalikan summary lama (idempoten)
    if (config.lastRescheduledAt === exitKey && config.lastRescheduleSummary) {
      return config.lastRescheduleSummary;
    }

    const claimKey = `HOLIDAY_EXIT:${tenantId}:${exitKey}`;
    const todayWib = getWibDateKey(now) || exitKey;

    let claimAcquired = false;
    const claimPayload = {
      tenant_id: tenantId,
      channel: 'SYSTEM',
      recipient: 'system',
      notification_type: 'HOLIDAY_EXIT_RESCHEDULE',
      report_date: todayWib,
      idempotency_key: claimKey,
      title: 'Holiday Exit Reschedule',
      message_content: `Klaim eksekusi rescheduling pasca-libur untuk tanggal ${exitKey}.`,
      status: 'SENT',
    };
    try {
      await prisma.adminNotificationLog.create({ data: claimPayload });
      claimAcquired = true;
    } catch {
      try {
        const existing = await prisma.adminNotificationLog.findUnique({
          where: { idempotency_key: claimKey },
        });
        if (!existing) {
          // Gagal membuat klaim bukan karena unique (mis. DB error) → fail-closed.
          claimAcquired = false;
        } else {
          const ageMs = now.getTime() - new Date(existing.sent_at).getTime();
          if (ageMs < 15 * 60 * 1000) {
            // Proses lain sedang berjalan.
            return null;
          }
          // Klaim basi (> 15 menit): hapus lalu BUAT KLAIM BARU agar
          // proses lain tidak ikut lolos secara bersamaan.
          await prisma.adminNotificationLog.update({
            where: { id: existing.id },
            data: { idempotency_key: null },
          });
          try {
            await prisma.adminNotificationLog.create({ data: claimPayload });
            claimAcquired = true;
          } catch {
            claimAcquired = false;
          }
        }
      } catch {
        claimAcquired = false;
      }
    }

    if (!claimAcquired) {
      return null;
    }

    if (!reschedulerFn) {
      console.warn('[Holiday Service] reschedulerFn tidak diberikan untuk runExitReschedule.');
      return null;
    }

    try {
      const maxPerDay = await getFollowUpMaxPerDay(tenantId);

      const res = await reschedulerFn(tenantId, {
        maxPerDay,
        staleCapDays: config.staleCapDays,
        source: 'holiday_exit',
      });

      const summary: FollowUpHolidayRescheduleSummary = {
        rescheduledCount: res.rescheduledCount,
        staleCancelledCount: res.staleCancelledCount || 0,
        daysCount: res.daysCount,
        distribution: res.distribution,
        executedAt: now.toISOString(),
      };

      const patch: Partial<FollowUpHolidayConfig> = {
        lastRescheduledAt: exitKey,
        lastRescheduleSummary: summary,
      };

      if (state.status === 'manual_expired') {
        patch.enabled = false;
        patch.manualActivatedAt = null;
      }

      await this.updateConfig(tenantId, patch);

      console.log(
        `[Holiday Service] Auto-reschedule exit executed for tenant ${tenantId}: ${summary.rescheduledCount} rescheduled, ${summary.staleCancelledCount} stale cancelled.`
      );

      return summary;
    } catch (err: any) {
      console.error(`[Holiday Service] Error executing exit reschedule for tenant ${tenantId}:`, err);
      // Lepas klaim agar bisa dicoba ulang
      try {
        await prisma.adminNotificationLog.deleteMany({
          where: { idempotency_key: claimKey },
        });
      } catch {}
      return null;
    }
  }
}

export const followUpHolidayService = new FollowUpHolidayService();
