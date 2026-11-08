import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { parsePositiveInt } from '../../utils/env-numeric';
import {
  hasBypassLabel,
  buildNonBypassCustomerWhere,
  BYPASS_LABEL_PRISMA_IN,
} from '../../utils/customer-bypass';
import {
  CANCEL_REASON,
  FOLLOWUP_TYPE_PRIORITY,
  FOLLOWUP_BATCH_LIMIT,
  isWithinFollowUpWorkingHours,
} from './constants';
import { executeFollowUp } from './follow-up-executor.service';

/**
 * Manual Send (Approve & Send Now) — dipanggil dari Admin Dashboard.
 */
export async function sendNow(
  id: string,
  tenantId: string = DEFAULT_TENANT_ID,
  executorFn: (fu: any, tenantId: string) => Promise<boolean> = executeFollowUp
): Promise<boolean> {
  const fu = await prisma.followUp.findFirst({
    where: { id, tenant_id: tenantId },
    include: {
      reservation: {
        select: {
          id: true,
          booking_date: true,
          treatment_category: true,
          treatment_detail: true,
        },
      },
      customer: {
        include: {
          children: true,
          labels: {
            include: { label: true },
          },
          conversations: {
            select: {
              last_message_at: true,
              is_human_handling: true,
            },
            take: 1,
            orderBy: { last_message_at: 'desc' },
          },
        },
      },
    },
  });

  if (!fu) {
    throw new Error(`Follow-up #${id} tidak ditemukan.`);
  }

  if (fu.status === 'SENT') {
    throw new Error('Follow-up ini sudah pernah dikirim sebelumnya.');
  }

  const leaseMs = parsePositiveInt(process.env.FOLLOWUP_CLAIM_LEASE_MS, 5 * 60 * 1000);
  const claimed = await prisma.followUp.updateMany({
    where: {
      id,
      tenant_id: tenantId,
      status: { in: ['PENDING', 'QUEUED'] },
      OR: [
        { processing_claimed_at: null },
        { processing_claimed_at: { lt: new Date(Date.now() - leaseMs) } },
      ],
    },
    data: { processing_claimed_at: new Date() },
  });
  if (claimed.count === 0) {
    throw new Error('Follow-up sedang diproses atau sudah selesai diproses.');
  }

  const { whatsappProviderService } = await import('../whatsapp-provider.service');
  const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
  if (isCutOff) {
    throw new Error('Koneksi outbound WhatsApp sedang diputus oleh Administrator (Cut-Off Darurat aktif).');
  }

  console.log(`[FollowUp Service] Manual Send Triggered by Admin for Follow-Up #${id} (${fu.customer?.phone})`);
  const success = await executorFn(fu, tenantId);
  return success;
}

/**
 * H5: Coba ulang follow-up berstatus FAILED → kembalikan ke QUEUED agar worker
 * memprosesnya lagi (menghormati jam kerja & kuota harian). Hanya untuk FAILED.
 */
export async function retryFollowUp(
  id: string,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<boolean> {
  const res = await prisma.followUp.updateMany({
    where: { id, tenant_id: tenantId, status: 'FAILED' },
    data: { status: 'QUEUED', processing_claimed_at: null, cancel_reason: null },
  });
  if (res.count > 0) {
    console.log(`[FollowUp Service] Retried follow-up #${id} (FAILED → QUEUED).`);
  }
  return res.count > 0;
}

/**
 * Menjadwalkan follow-up tunggal ke antrian (status QUEUED).
 * Pesan akan dikirim otomatis oleh background worker saat waktu scheduled_at tiba.
 */
export async function queueFollowUp(
  id: string,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<boolean> {
  const res = await prisma.followUp.updateMany({
    where: { id, tenant_id: tenantId, status: 'PENDING' },
    data: { status: 'QUEUED' },
  });
  console.log(`[FollowUp Service] Queued follow-up #${id} (status: QUEUED).`);
  return res.count > 0;
}

/**
 * Menjadwalkan seluruh follow-up PENDING ke antrian (status QUEUED).
 */
export async function bulkQueueFollowUps(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<number> {
  const res = await prisma.followUp.updateMany({
    where: { tenant_id: tenantId, status: 'PENDING' },
    data: { status: 'QUEUED' },
  });
  console.log(`[FollowUp Service] Bulk queued ${res.count} follow-ups to status QUEUED.`);
  return res.count;
}

/**
 * Cancel single follow-up.
 * `options.reason` opsional — tersimpan di cancel_reason agar admin tahu
 * mengapa antrian ini batal. Default: pembatalan manual oleh Admin.
 */
export async function cancelFollowUp(
  id: string,
  tenantId: string = DEFAULT_TENANT_ID,
  options: { reason?: string } = {}
): Promise<boolean> {
  const reason = (options.reason || '').trim() || CANCEL_REASON.MANUAL_ADMIN;
  const res = await prisma.followUp.updateMany({
    where: { id, tenant_id: tenantId },
    data: { status: 'CANCELLED', cancel_reason: reason },
  });
  return res.count > 0;
}

/**
 * Skip seluruh antrian follow-up aktif untuk customer bypass/admin.
 * Central seam Fase 1 — status kanonis SKIPPED + CANCEL_REASON.BYPASS_LABEL,
 * terisolasi tenant_id. Dipanggil dari label route & customer.service hook.
 */
export async function skipFollowUpsForBypassCustomer(
  customerId: string,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<number> {
  try {
    const res = await prisma.followUp.updateMany({
      where: {
        customer_id: customerId,
        tenant_id: tenantId,
        status: { in: ['PENDING', 'QUEUED'] },
      },
      data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.BYPASS_LABEL },
    });
    if (res.count > 0) {
      console.log(
        `[FollowUp Service] Auto-skipped ${res.count} active follow-ups for bypass customer ${customerId} (tenant ${tenantId})`,
      );
    }
    return res.count;
  } catch (err: any) {
    console.warn(
      `[FollowUp Service] Failed to skip follow-ups for bypass customer ${customerId}:`,
      err.message,
    );
    return 0;
  }
}

/**
 * Bulk cancel follow-ups (misal semua PENDING atau QUEUED).
 * `options.reason` opsional — default: pembatalan massal oleh Admin.
 */
export async function bulkCancelFollowUps(
  tenantId: string = DEFAULT_TENANT_ID,
  status: string = 'PENDING',
  options: { reason?: string } = {}
): Promise<number> {
  const reason = (options.reason || '').trim() || CANCEL_REASON.BULK_ADMIN;
  const res = await prisma.followUp.updateMany({
    where: { tenant_id: tenantId, status: status as any },
    data: { status: 'CANCELLED', cancel_reason: reason },
  });
  console.log(`[FollowUp Service] Bulk cancelled ${res.count} follow-ups with status ${status}.`);
  return res.count;
}

/**
 * Update follow-up (ubah tanggal, varian/stage, atau custom_text).
 */
export async function updateFollowUp(
  id: string,
  data: {
    scheduledAt?: Date;
    stage?: number;
    customText?: string | null;
  },
  tenantId: string = DEFAULT_TENANT_ID
): Promise<any> {
  const existing = await prisma.followUp.findFirst({
    where: { id, tenant_id: tenantId },
  });

  if (!existing) {
    throw new Error(`Follow-up #${id} tidak ditemukan.`);
  }

  const updateData: any = {};
  if (data.scheduledAt) updateData.scheduled_at = data.scheduledAt;
  if (typeof data.stage === 'number' && data.stage >= 1 && data.stage <= 3) {
    updateData.stage = data.stage;
  }
  if (data.customText !== undefined) {
    updateData.custom_text = data.customText ? data.customText.trim() : null;
  }

  return prisma.followUp.update({
    where: { id },
    data: updateData,
    include: {
      customer: true,
    },
  });
}

/**
 * Reschedule follow-up (ubah tanggal/jam jadwal kirim).
 */
export async function rescheduleFollowUp(
  id: string,
  newDate: Date,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<any> {
  return updateFollowUp(id, { scheduledAt: newDate }, tenantId);
}

/**
 * Majukan seluruh follow-up PENDING yang tanggalnya sebelum tanggal target (overdue)
 * dan jadwalkan merata dengan kuota maksimal per hari (default FOLLOWUP_MAX_PER_DAY, 40) pada jam kerja (09:00 - 16:30 WIB).
 */
export async function rescheduleOverdueFollowUps(
  tenantId: string = DEFAULT_TENANT_ID,
  options: {
    maxPerDay?: number;
    startDate?: Date;
  } = {}
): Promise<{
  rescheduledCount: number;
  daysCount: number;
  distribution: Record<string, number>;
}> {
  const defaultMax = parsePositiveInt(process.env.FOLLOWUP_MAX_PER_DAY, 40);
  const maxPerDay = Math.max(1, options.maxPerDay || defaultMax);

  const now = new Date();
  const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);

  let startYear: number;
  let startMonth: number;
  let startDay: number;

  if (options.startDate) {
    const sWib = new Date(new Date(options.startDate).getTime() + 7 * 60 * 60 * 1000);
    startYear = sWib.getUTCFullYear();
    startMonth = sWib.getUTCMonth();
    startDay = sWib.getUTCDate();
  } else {
    startYear = nowWib.getUTCFullYear();
    startMonth = nowWib.getUTCMonth();
    startDay = nowWib.getUTCDate();
    if (nowWib.getUTCHours() >= 16) {
      startDay += 1;
    }
  }

  // Jam 09:00 WIB = 02:00 UTC
  const baseCutoff = new Date(Date.UTC(startYear, startMonth, startDay, 2, 0, 0, 0));

  const overdueFollowUps = await prisma.followUp.findMany({
    where: {
      tenant_id: tenantId,
      type: { notIn: ['REMINDER_H1', 'REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] },
      status: { in: ['PENDING', 'QUEUED'] },
      scheduled_at: { lt: baseCutoff },
      customer: buildNonBypassCustomerWhere() as any,
    },
    orderBy: [{ scheduled_at: 'asc' }, { created_at: 'asc' }],
  });

  if (overdueFollowUps.length === 0) {
    return { rescheduledCount: 0, daysCount: 0, distribution: {} };
  }

  // Urutkan overdue: NEXT_TREATMENT lebih diprioritaskan daripada NO_PURCHASE
  const sortedOverdue = [...overdueFollowUps].sort((a, b) => {
    const pA = FOLLOWUP_TYPE_PRIORITY[a.type] || 99;
    const pB = FOLLOWUP_TYPE_PRIORITY[b.type] || 99;
    if (pA !== pB) return pA - pB;
    return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
  });

  const distribution: Record<string, number> = {};
  let currentDayIndex = 0;
  let countInCurrentDay = 0;

  // Distribusi merata sepanjang jam 09:00 - 16:30 WIB (450 menit)
  const stepMin = maxPerDay > 1 ? Math.floor(450 / maxPerDay) : 30;

  for (const fu of sortedOverdue) {
    if (countInCurrentDay >= maxPerDay) {
      currentDayIndex++;
      countInCurrentDay = 0;
    }

    const offsetMin = countInCurrentDay * stepMin;
    // 09:00 WIB + offsetMin = 02:00 UTC + offsetMin
    const targetDate = new Date(Date.UTC(startYear, startMonth, startDay + currentDayIndex, 2, offsetMin, 0, 0));

    await prisma.followUp.update({
      where: { id: fu.id },
      data: { scheduled_at: targetDate },
    });

    const dateStr = targetDate.toISOString().split('T')[0];
    distribution[dateStr] = (distribution[dateStr] || 0) + 1;
    countInCurrentDay++;
  }

  console.log(`[FollowUp Service] Rescheduled ${sortedOverdue.length} overdue follow-ups across ${currentDayIndex + 1} days (max ${maxPerDay}/day, interval ~${stepMin}m, NEXT_TREATMENT prioritized).`);
  return {
    rescheduledCount: sortedOverdue.length,
    daysCount: currentDayIndex + 1,
    distribution,
  };
}

/**
 * M1: Hitung jumlah follow-up berstatus SENT pada hari kalender WIB berjalan.
 */
export async function countDailySent(tenantId: string, now: Date): Promise<number> {
  try {
    const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const startOfDayWibUtc = new Date(
      Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate()) - 7 * 60 * 60 * 1000,
    );
    const endOfDayWibUtc = new Date(startOfDayWibUtc.getTime() + 24 * 60 * 60 * 1000);
    return await prisma.followUp.count({
      where: {
        tenant_id: tenantId,
        status: 'SENT',
        sent_at: { gte: startOfDayWibUtc, lt: endOfDayWibUtc },
      },
    });
  } catch {
    return 0;
  }
}

/**
 * Dipanggil oleh CronWorker untuk mencari & mengeksekusi
 * follow-up yang waktunya sudah tiba (scheduled_at <= NOW()).
 */
export async function processDueFollowUps(
  tenantId: string = DEFAULT_TENANT_ID,
  executorFn: (fu: any, tenantId: string) => Promise<boolean> = executeFollowUp
): Promise<number> {
  const { whatsappProviderService } = await import('../whatsapp-provider.service');
  const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
  if (isCutOff) {
    console.log(`[FollowUp Worker] Outbound Cut-Off is ACTIVE for tenant ${tenantId}. Skipping follow-up execution until cut-off is deactivated.`);
    return 0;
  }

  if (process.env.NODE_ENV !== 'test' && !isWithinFollowUpWorkingHours(new Date())) {
    console.log('[FollowUp Worker] Di luar jam kerja (09:00 - 17:00 WIB). Pengiriman ditunda.');
    return 0;
  }

  const targetStatuses = process.env.AUTO_FOLLOWUP_ENABLED === 'true'
    ? ['QUEUED', 'PENDING']
    : ['QUEUED'];

  try {
    const now = new Date();

    // Auto-cancel expired PENDING follow-ups
    try {
      const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      const startOfTodayWibUtc = new Date(
        Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate()) - 7 * 60 * 60 * 1000
      );
      const expiredPending = await prisma.followUp.updateMany({
        where: {
          tenant_id: tenantId,
          status: 'PENDING',
          scheduled_at: { lt: startOfTodayWibUtc },
        },
        data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.EXPIRED_PENDING },
      });
      if (expiredPending?.count && expiredPending.count > 0) {
        console.log(`[FollowUp Worker] Auto-cancelled ${expiredPending.count} expired PENDING follow-ups (schedule passed without admin approval).`);
      }
    } catch (pendingCancelErr: any) {
      console.warn('[FollowUp Worker] Failed to auto-cancel expired PENDING follow-ups:', pendingCancelErr.message);
    }

    // Prune zombie follow-ups for bypass/admin contacts
    try {
      const pruned = await prisma.followUp.updateMany({
        where: {
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
          OR: [
            { customer: { is_admin_labeled: true } },
            { customer: { is_sandbox_test: true } },
            { customer: { status: 'blocked' } },
            { customer: { labels: { some: { label: { name: { in: [...BYPASS_LABEL_PRISMA_IN] as unknown as string[] } } } } } },
          ],
        },
        data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.BYPASS_LABEL },
      });
      if (pruned.count > 0) {
        console.log(`[FollowUp Worker] Self-healing pruned ${pruned.count} zombie follow-ups for bypass/admin contacts (tenant ${tenantId}).`);
      }
    } catch (pruneErr: any) {
      console.warn('[FollowUp Worker] Prune zombie follow-ups error:', pruneErr.message);
    }

    // Rem kuota harian runtime
    const maxPerDay = parsePositiveInt(process.env.FOLLOWUP_MAX_PER_DAY, 40);
    const sentToday = await countDailySent(tenantId, now);
    const remainingQuota = maxPerDay - sentToday;
    if (remainingQuota <= 0) {
      console.log(`[FollowUp Worker] Kuota harian tercapai (${sentToday}/${maxPerDay}). Menghentikan pengiriman hari ini.`);
      return 0;
    }
    const batchLimit = Math.max(1, Math.min(FOLLOWUP_BATCH_LIMIT, remainingQuota));

    const rawDueFollowUps = await prisma.followUp.findMany({
      where: {
        tenant_id: tenantId,
        type: { notIn: ['REMINDER_H1', 'REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] },
        status: { in: targetStatuses as any },
        scheduled_at: { lte: now },
        customer: buildNonBypassCustomerWhere() as any,
      },
      include: {
        reservation: {
          select: {
            id: true,
            booking_date: true,
            treatment_category: true,
            treatment_detail: true,
          },
        },
        customer: {
          include: {
            children: true,
            labels: {
              include: { label: true },
            },
            conversations: {
              select: {
                last_message_at: true,
                is_human_handling: true,
              },
              take: 1,
              orderBy: { last_message_at: 'desc' },
            },
          },
        },
      },
      orderBy: [{ scheduled_at: 'asc' }, { created_at: 'asc' }],
      take: batchLimit,
    });

    const dueFollowUps = (rawDueFollowUps || []).sort((a, b) => {
      const pA = FOLLOWUP_TYPE_PRIORITY[a.type] || 99;
      const pB = FOLLOWUP_TYPE_PRIORITY[b.type] || 99;
      if (pA !== pB) return pA - pB;
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    });

    if (!dueFollowUps || dueFollowUps.length === 0) {
      return 0;
    }

    console.log(`[FollowUp Worker] Found ${dueFollowUps.length} due follow-ups to process (${targetStatuses.join('/')} mode, scheduled_at <= now).`);
    let processed = 0;
    const cooldownHours = parsePositiveInt(process.env.FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS, 72);
    const cooldownMs = cooldownHours * 60 * 60 * 1000;

    for (const fu of dueFollowUps) {
      if (fu.scheduled_at && (now.getTime() - new Date(fu.scheduled_at).getTime() > 48 * 60 * 60 * 1000)) {
        console.log(`[FollowUp Worker] FollowUp #${fu.id} for ${fu.customer?.phone} is SKIPPED (Overdue > 48h).`);
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.OVERDUE_48H },
        });
        continue;
      }

      if (fu.customer && (fu.customer.is_admin_labeled || hasBypassLabel(fu.customer))) {
        console.log(`[FollowUp Worker] FollowUp #${fu.id} for ${fu.customer?.phone} is SKIPPED (Bypass contact label).`);
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.BYPASS_LABEL },
        });
        continue;
      }

      if (fu.type === 'REMINDER_H1' || fu.type === 'REVIEW_H1_BABY' || fu.type === 'REVIEW_H1_MOMS') {
        console.log(`[FollowUp Worker] FollowUp #${fu.id} (${fu.type}) for ${fu.customer?.phone} is POSTPONED by clinic policy. Skipping automatic send.`);
        continue;
      }

      if (
        fu.type === 'NO_PURCHASE' &&
        fu.stage >= 3 &&
        !fu.customer?.is_mql
      ) {
        console.log(`[FollowUp Worker] FollowUp #${fu.id} (NO_PURCHASE stage 3) for ${fu.customer?.phone} is SKIPPED (bukan MQL).`);
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.NON_SERIOUS_STAGE3 },
        });
        continue;
      }

      const lastConv = fu.customer?.conversations?.[0];
      const lastMsgAt = lastConv?.last_message_at ? new Date(lastConv.last_message_at) : null;
      if (lastMsgAt && (now.getTime() - lastMsgAt.getTime()) < cooldownMs) {
        const newScheduledAt = new Date(lastMsgAt.getTime() + cooldownMs);
        const targetWib = new Date(newScheduledAt.getTime() + 7 * 60 * 60 * 1000);
        const year = targetWib.getUTCFullYear();
        const month = targetWib.getUTCMonth();
        const date = targetWib.getUTCDate();
        const adjustedDate = new Date(Date.UTC(year, month, date, 2, 40, 0, 0));

        const finalDate = adjustedDate.getTime() > now.getTime()
          ? adjustedDate
          : new Date(now.getTime() + 24 * 60 * 60 * 1000);

        try {
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { scheduled_at: finalDate },
          });
        } catch (_) {}
        console.log(`[FollowUp Worker] FollowUp #${fu.id} (${fu.customer?.phone}) postponed to ${finalDate.toISOString()} due to recent chat at ${lastMsgAt.toISOString()} (cooldown: ${cooldownHours}h).`);
        continue;
      }

      const success = await executorFn(fu, tenantId);
      if (success) processed++;
    }

    return processed;
  } catch (err) {
    console.error('[FollowUp Worker] Error processing due follow-ups:', err);
    return 0;
  }
}
