import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getRollingVariant, getWibDateKey } from '../config/followup-templates';
import { parsePositiveInt } from '../utils/env-numeric';
import { buildNonBypassCustomerWhere } from '../utils/customer-bypass';
import { getFollowUpMaxPerDay } from '../config/followup-quota';
import { loadFollowUpDailyLoadDetailed, allocateFollowUpSlots, getWibMinutes } from './followup-schedule-allocator';
import { getFollowUpHolidayConfig } from './tenant-settings.store';
import { resolveFollowUpHolidayState } from '../config/followup-scheduling';

import {
  followUpTemplateService,
  FollowUpTemplateService,
  FollowUpTemplateItem,
} from './follow-up-template.service';

import {
  followUpLifecycleService,
  FollowUpLifecycleService,
  CANCEL_REASON,
  NO_PURCHASE_STAGE_DAYS,
  NEXT_TREATMENT_STAGE_DAYS,
  FOLLOWUP_TYPE_PRIORITY,
} from './follow-up-lifecycle.service';

import {
  followUpEngineService,
  FollowUpEngineService,
  isWithinFollowUpWorkingHours,
} from './follow-up-engine.service';

// Re-export untuk backward compatibility penuh bagi seluruh caller/test
export {
  CANCEL_REASON,
  NO_PURCHASE_STAGE_DAYS,
  NEXT_TREATMENT_STAGE_DAYS,
  FOLLOWUP_TYPE_PRIORITY,
  isWithinFollowUpWorkingHours,
  followUpTemplateService,
  FollowUpTemplateService,
  followUpLifecycleService,
  FollowUpLifecycleService,
  followUpEngineService,
  FollowUpEngineService,
};
export type { FollowUpTemplateItem };

export interface ScheduledAtRange {
  gte?: Date;
  lte?: Date;
  lt?: Date;
}

/**
 * Membangun objek range Prisma untuk filter tanggal scheduled_at (berbasis WIB).
 */
export function buildScheduledAtRange(
  dateFilter?: string,
  now: Date = new Date()
): ScheduledAtRange | null {
  if (!dateFilter || dateFilter === 'all') return null;

  const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const curY = nowWib.getUTCFullYear();
  const curM = nowWib.getUTCMonth();
  const curD = nowWib.getUTCDate();

  const startOfTodayUtc = new Date(Date.UTC(curY, curM, curD) - 7 * 60 * 60 * 1000);
  const endOfTodayUtc = new Date(Date.UTC(curY, curM, curD, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);

  if (dateFilter === 'upcoming') {
    // Kontrak filter: seluruh follow-up mulai awal hari ini (WIB), termasuk yang
    // jamnya sudah lewat, agar daftar "akan datang" tidak berubah sepanjang hari.
    return { gte: startOfTodayUtc };
  }
  if (dateFilter === 'today') {
    return { gte: startOfTodayUtc, lte: endOfTodayUtc };
  }
  if (dateFilter === 'this_week') {
    const dayOfWeek = nowWib.getUTCDay();
    const diffToMonday = (dayOfWeek + 6) % 7;
    const startOfWeekUtc = new Date(Date.UTC(curY, curM, curD - diffToMonday) - 7 * 60 * 60 * 1000);
    const endOfWeekUtc = new Date(
      Date.UTC(curY, curM, curD - diffToMonday + 6, 23, 59, 59, 999) - 7 * 60 * 60 * 1000
    );
    return { gte: startOfWeekUtc, lte: endOfWeekUtc };
  }
  if (dateFilter === 'this_month') {
    const startOfMonthUtc = new Date(Date.UTC(curY, curM, 1) - 7 * 60 * 60 * 1000);
    const nextMonthFirstUtc = new Date(Date.UTC(curY, curM + 1, 1) - 7 * 60 * 60 * 1000);
    const endOfMonthUtc = new Date(nextMonthFirstUtc.getTime() - 1);
    return { gte: startOfMonthUtc, lte: endOfMonthUtc };
  }
  if (dateFilter === 'overdue') {
    return { lt: startOfTodayUtc };
  }
  return null;
}

export class FollowUpService {
  /**
   * Helper audit FN-06: log penanda saat pemanggil menggunakan default tenantId
   */
  private auditTenantUsage(method: string, tenantId: string): void {
    if (tenantId === DEFAULT_TENANT_ID && process.env.NODE_ENV !== 'test') {
      console.debug(`[FollowUp Service] Method '${method}' invoked with fallback default tenantId (${DEFAULT_TENANT_ID}).`);
    }
  }

  // ==========================================
  // 1. Template Management (Delegated to Template Service)
  // ==========================================

  public async getAllTemplates(tenantId: string = DEFAULT_TENANT_ID): Promise<FollowUpTemplateItem[]> {
    this.auditTenantUsage('getAllTemplates', tenantId);
    return followUpTemplateService.getAllTemplates(tenantId);
  }

  public async saveTemplate(
    type: string,
    variant: number,
    text: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<void> {
    this.auditTenantUsage('saveTemplate', tenantId);
    return followUpTemplateService.saveTemplate(type, variant, text, tenantId);
  }

  public async resetTemplate(type: string, variant: number, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    this.auditTenantUsage('resetTemplate', tenantId);
    return followUpTemplateService.resetTemplate(type, variant, tenantId);
  }

  // ==========================================
  // 2. Lifecycle Triggers (Delegated to Lifecycle Service)
  // ==========================================

  public async createNoPurchaseFollowUps(customerId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    this.auditTenantUsage('createNoPurchaseFollowUps', tenantId);
    return followUpLifecycleService.createNoPurchaseFollowUps(customerId, tenantId);
  }

  public async rescheduleNoPurchaseOnInboundChat(
    customerId: string,
    tenantId: string = DEFAULT_TENANT_ID,
    chatAt: Date = new Date()
  ): Promise<{ rescheduled: number; cancelled: number }> {
    this.auditTenantUsage('rescheduleNoPurchaseOnInboundChat', tenantId);
    return followUpLifecycleService.rescheduleNoPurchaseOnInboundChat(customerId, tenantId, chatAt);
  }

  public async onReservationCreated(customerId: string, reservationId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    this.auditTenantUsage('onReservationCreated', tenantId);
    return followUpLifecycleService.onReservationCreated(customerId, reservationId, tenantId);
  }

  public async createReservationFollowUps(params: {
    reservationId: string;
    customerId: string;
    bookingDate: Date;
    treatmentCategory?: string | null;
    tenantId?: string;
  }): Promise<void> {
    return followUpLifecycleService.createReservationFollowUps(params);
  }

  public async onReservationCancelled(reservationId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    this.auditTenantUsage('onReservationCancelled', tenantId);
    return followUpLifecycleService.onReservationCancelled(reservationId, tenantId);
  }

  public async onReservationRescheduled(
    reservationId: string,
    newBookingDate: Date,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<void> {
    this.auditTenantUsage('onReservationRescheduled', tenantId);
    return followUpLifecycleService.onReservationRescheduled(reservationId, newBookingDate, tenantId);
  }

  public async createNextTreatmentFollowUps(
    customerId: string,
    bookingDate: Date,
    tenantId: string = DEFAULT_TENANT_ID,
    reservationId?: string,
    treatmentCategory?: string | null
  ): Promise<void> {
    this.auditTenantUsage('createNextTreatmentFollowUps', tenantId);
    return followUpLifecycleService.createNextTreatmentFollowUps(
      customerId,
      bookingDate,
      tenantId,
      reservationId,
      treatmentCategory
    );
  }

  public computeScheduleAtWib0940(anchor: Date, dayOffset: number, seed: string = ''): Date {
    return followUpLifecycleService.computeScheduleAtWib0940(anchor, dayOffset, seed);
  }

  public computeNextTreatmentAtWib0900(bookingDate: Date, stage: number): Date {
    return followUpLifecycleService.computeNextTreatmentAtWib0900(bookingDate, stage);
  }

  public async reconcileOrphanedCompletedFollowUps(
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<{ reconciledCount: number; customerIds: string[] }> {
    this.auditTenantUsage('reconcileOrphanedCompletedFollowUps', tenantId);
    return followUpLifecycleService.reconcileOrphanedCompletedFollowUps(tenantId, this.createNextTreatmentFollowUps.bind(this));
  }

  public async enqueueDormantWinbackFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    this.auditTenantUsage('enqueueDormantWinbackFollowUps', tenantId);
    return followUpLifecycleService.enqueueDormantWinbackFollowUps(tenantId);
  }

  public async checkAndSetLostCustomers(tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    this.auditTenantUsage('checkAndSetLostCustomers', tenantId);
    return followUpLifecycleService.checkAndSetLostCustomers(tenantId);
  }

  // ==========================================
  // 3. Execution Engine (Delegated to Engine Service)
  // ==========================================

  public async sendNow(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    this.auditTenantUsage('sendNow', tenantId);
    return followUpEngineService.sendNow(id, tenantId);
  }

  public async retryFollowUp(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    this.auditTenantUsage('retryFollowUp', tenantId);
    return followUpEngineService.retryFollowUp(id, tenantId);
  }

  public async queueFollowUp(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    this.auditTenantUsage('queueFollowUp', tenantId);
    return followUpEngineService.queueFollowUp(id, tenantId);
  }

  public async bulkQueueFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    this.auditTenantUsage('bulkQueueFollowUps', tenantId);
    return followUpEngineService.bulkQueueFollowUps(tenantId);
  }

  public async processDueFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    this.auditTenantUsage('processDueFollowUps', tenantId);
    const holidayConfig = await getFollowUpHolidayConfig(tenantId);
    const now = new Date();
    const holidayState = resolveFollowUpHolidayState(holidayConfig, now);

    if (holidayState.status === 'active') {
      console.log(`[FollowUp Worker] Mode Libur aktif untuk tenant ${tenantId} (${holidayState.mode}). Pengiriman ditunda.`);
      return 0;
    }

    if (holidayState.status === 'exit_pending' || holidayState.status === 'manual_expired') {
      console.log(`[FollowUp Worker] Mode Libur transisi keluar (${holidayState.status}) untuk tenant ${tenantId}. Menjalankan smooth reschedule.`);
      const { followUpHolidayService } = await import('./followup-holiday.service');
      const exitSummary = await followUpHolidayService.runExitReschedule(
        tenantId,
        holidayState,
        now,
        this.rescheduleOverdueFollowUps.bind(this)
      );
      if (!exitSummary) {
        // Fail-closed: jangan biarkan aturan 48 jam / EXPIRED_PENDING berjalan
        // di atas antrean yang belum sempat dijadwalkan ulang.
        console.log(`[FollowUp Worker] Reschedule pasca-libur belum selesai (tenant ${tenantId}). Pemrosesan ditunda.`);
        return 0;
      }
    }

    return followUpEngineService.processDueFollowUps(tenantId, this.executeFollowUp.bind(this));
  }

  public async executeFollowUp(fu: any, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    this.auditTenantUsage('executeFollowUp', tenantId);
    return followUpEngineService.executeFollowUp(fu, tenantId);
  }

  public async executeFollowUpWaba(
    fu: any,
    templateType: any,
    name: string,
    tenantId: string = DEFAULT_TENANT_ID,
    timeStr?: string,
    babyName?: string
  ): Promise<boolean> {
    this.auditTenantUsage('executeFollowUpWaba', tenantId);
    return followUpEngineService.executeFollowUpWaba(fu, templateType, name, tenantId, timeStr, babyName);
  }

  public async resolveMilestoneType(fu: any, tenantId: string): Promise<any> {
    return followUpEngineService.resolveMilestoneType(fu, tenantId);
  }

  // ==========================================
  // 4. Admin Listing, Filtering & Management
  // ==========================================

  public async listFollowUps(
    tenantId: string = DEFAULT_TENANT_ID,
    options: {
      status?: string;
      type?: string;
      search?: string;
      dateFilter?: string;
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<{
    data: any[];
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }> {
    this.auditTenantUsage('listFollowUps', tenantId);
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize || 20));
    const skip = (page - 1) * pageSize;

    const where: any = {
      tenant_id: tenantId,
    };

    if (options.status && options.status !== 'all') {
      where.status = options.status;
    }

    if (options.type && options.type !== 'all') {
      where.type = options.type;
    }

    if (options.dateFilter && options.dateFilter !== 'all') {
      const range = buildScheduledAtRange(options.dateFilter);
      if (range) {
        where.scheduled_at = range;
      }
    }

    if (options.search) {
      const q = options.search.trim();
      where.customer = {
        OR: [
          { phone: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const sortOrder = options.sortOrder === 'desc' ? 'desc' : 'asc';
    let orderBy: any[] = [];

    switch (options.sortBy) {
      case 'scheduled_at':
        orderBy = [{ scheduled_at: sortOrder }, { created_at: 'desc' }];
        break;
      case 'created_at':
        orderBy = [{ created_at: sortOrder }];
        break;
      case 'status':
        orderBy = [{ status: sortOrder }, { scheduled_at: 'asc' }];
        break;
      case 'type':
        orderBy = [{ type: sortOrder }, { stage: sortOrder }, { scheduled_at: 'asc' }];
        break;
      case 'customer_name':
      case 'name':
        orderBy = [{ customer: { name: sortOrder } }, { scheduled_at: 'asc' }];
        break;
      default:
        orderBy = options.sortBy
          ? [{ [options.sortBy]: sortOrder }]
          : [{ scheduled_at: sortOrder }, { created_at: 'desc' }];
        break;
    }

    try {
      const [total, data] = await Promise.all([
        prisma.followUp.count({ where }),
        prisma.followUp.findMany({
          where,
          select: {
            id: true,
            customer_id: true,
            type: true,
            stage: true,
            treatment_category: true,
            custom_text: true,
            scheduled_at: true,
            sent_at: true,
            status: true,
            cancel_reason: true,
            created_at: true,
            updated_at: true,
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                kelurahan: true,
                kecamatan: true,
                kota: true,
                status: true,
                is_sandbox_test: true,
                conversations: {
                  select: {
                    id: true,
                    last_message_at: true,
                    is_human_handling: true,
                  },
                  take: 1,
                  orderBy: { last_message_at: 'desc' },
                },
              },
            },
            reservation: {
              select: {
                id: true,
                booking_date: true,
                treatment_category: true,
                treatment_detail: true,
              },
            },
          },
          orderBy,
          skip,
          take: pageSize,
        }),
      ]);

      const enriched = (data as any[]).map((item: any) => ({
        ...item,
        variant: getRollingVariant(item.customer_id || item.customer?.id || '', item.scheduled_at),
      }));
      return {
        data: enriched,
        pagination: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize) || 1,
        },
      };
    } catch (err: any) {
      console.error('[FollowUp Service] Failed to list follow-ups:', err.message);
      return {
        data: [],
        pagination: {
          total: 0,
          page: 1,
          pageSize,
          totalPages: 1,
        },
      };
    }
  }

  public async cancelFollowUp(
    id: string,
    tenantId: string = DEFAULT_TENANT_ID,
    options: { reason?: string } = {}
  ): Promise<boolean> {
    this.auditTenantUsage('cancelFollowUp', tenantId);
    const reason = (options.reason || '').trim() || CANCEL_REASON.MANUAL_ADMIN;
    const res = await prisma.followUp.updateMany({
      where: { id, tenant_id: tenantId },
      data: { status: 'CANCELLED', cancel_reason: reason },
    });
    return res.count > 0;
  }

  public async skipFollowUpsForBypassCustomer(
    customerId: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<number> {
    this.auditTenantUsage('skipFollowUpsForBypassCustomer', tenantId);
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

  public async bulkCancelFollowUps(
    tenantId: string = DEFAULT_TENANT_ID,
    status: string = 'PENDING',
    options: { reason?: string } = {}
  ): Promise<number> {
    this.auditTenantUsage('bulkCancelFollowUps', tenantId);
    const reason = (options.reason || '').trim() || CANCEL_REASON.BULK_ADMIN;
    const res = await prisma.followUp.updateMany({
      where: { tenant_id: tenantId, status: status as any },
      data: { status: 'CANCELLED', cancel_reason: reason },
    });
    console.log(`[FollowUp Service] Bulk cancelled ${res.count} follow-ups with status ${status}.`);
    return res.count;
  }

  public async updateFollowUp(
    id: string,
    data: {
      scheduledAt?: Date;
      stage?: number;
      customText?: string | null;
    },
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<any> {
    this.auditTenantUsage('updateFollowUp', tenantId);
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

  public async rescheduleFollowUp(id: string, newDate: Date, tenantId: string = DEFAULT_TENANT_ID): Promise<any> {
    this.auditTenantUsage('rescheduleFollowUp', tenantId);
    return this.updateFollowUp(id, { scheduledAt: newDate }, tenantId);
  }

  public async rescheduleOverdueFollowUps(
    tenantId: string = DEFAULT_TENANT_ID,
    options: {
      maxPerDay?: number;
      startDate?: Date;
      staleCapDays?: number;
      source?: 'manual' | 'holiday_exit';
    } = {}
  ): Promise<{
    rescheduledCount: number;
    daysCount: number;
    distribution: Record<string, number>;
    staleCancelledCount?: number;
  }> {
    this.auditTenantUsage('rescheduleOverdueFollowUps', tenantId);
    const tenantMax = await getFollowUpMaxPerDay(tenantId);
    const maxPerDay = Math.max(1, options.maxPerDay || tenantMax);

    const now = new Date();
    const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    let startYear: number;
    let startMonth: number;
    let startDay: number;
    let isStartDateToday = false;

    if (options.startDate) {
      const sWib = new Date(new Date(options.startDate).getTime() + 7 * 60 * 60 * 1000);
      startYear = sWib.getUTCFullYear();
      startMonth = sWib.getUTCMonth();
      startDay = sWib.getUTCDate();
      isStartDateToday = (
        startYear === nowWib.getUTCFullYear() &&
        startMonth === nowWib.getUTCMonth() &&
        startDay === nowWib.getUTCDate()
      );
    } else {
      startYear = nowWib.getUTCFullYear();
      startMonth = nowWib.getUTCMonth();
      startDay = nowWib.getUTCDate();
      isStartDateToday = true;
      if (nowWib.getUTCHours() >= 16) {
        startDay += 1;
        isStartDateToday = false;
      }
    }

    const baseCutoff = options.startDate
      ? new Date(Date.UTC(startYear, startMonth, startDay, 2, 0, 0, 0))
      : now;

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
      return { rescheduledCount: 0, daysCount: 0, distribution: {}, staleCancelledCount: 0 };
    }

    let staleCancelledCount = 0;
    const toReschedule: typeof overdueFollowUps = [];

    if (typeof options.staleCapDays === 'number' && options.staleCapDays > 0) {
      const staleCutoffMs = now.getTime() - options.staleCapDays * 24 * 60 * 60 * 1000;
      for (const fu of overdueFollowUps) {
        if (new Date(fu.scheduled_at).getTime() < staleCutoffMs) {
          await prisma.followUp.update({
            where: { id: fu.id },
            data: {
              status: 'CANCELLED',
              cancel_reason: CANCEL_REASON.HOLIDAY_STALE,
              processing_claimed_at: null,
            },
          });
          staleCancelledCount++;
        } else {
          toReschedule.push(fu);
        }
      }
    } else {
      toReschedule.push(...overdueFollowUps);
    }

    if (toReschedule.length === 0) {
      return { rescheduledCount: 0, daysCount: 0, distribution: {}, staleCancelledCount };
    }

    const sortedOverdue = [...toReschedule].sort((a, b) => {
      const pA = FOLLOWUP_TYPE_PRIORITY[a.type] || 99;
      const pB = FOLLOWUP_TYPE_PRIORITY[b.type] || 99;
      if (pA !== pB) return pA - pB;
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    });

    const startOfTargetUtc = new Date(Date.UTC(startYear, startMonth, startDay) - 7 * 60 * 60 * 1000);
    const { counts: loadByDate, occupiedMinutes } = await loadFollowUpDailyLoadDetailed(tenantId, startOfTargetUtc);

    // Kurangi beban existing untuk item yang benar-benar akan dipindahkan
    // (bukan yang sudah dibatalkan karena stale), termasuk slot menitnya.
    for (const fu of toReschedule) {
      const key = getWibDateKey(fu.scheduled_at);
      if (key && loadByDate.has(key)) {
        const cur = loadByDate.get(key)!;
        if (cur > 0) loadByDate.set(key, cur - 1);
        const occupied = occupiedMinutes.get(key);
        if (occupied) occupied.delete(getWibMinutes(fu.scheduled_at));
      }
    }

    const nowWibMinutes = nowWib.getUTCHours() * 60 + nowWib.getUTCMinutes();
    const firstDayMinStartWib = isStartDateToday ? Math.max(540, nowWibMinutes + 5) : undefined;

    const slots = allocateFollowUpSlots({
      count: sortedOverdue.length,
      maxPerDay,
      windowStartMinWib: 540, // 09:00 WIB
      windowEndMinWib: 990,   // 16:30 WIB
      startDateWib: { year: startYear, month: startMonth, day: startDay },
      firstDayMinStartWib,
      loadByDate,
      occupiedMinutesByDate: occupiedMinutes,
    });

    const distribution: Record<string, number> = {};
    for (let i = 0; i < sortedOverdue.length; i++) {
      const fu = sortedOverdue[i];
      const targetDate = slots[i];
      if (!targetDate) continue;

      await prisma.followUp.update({
        where: { id: fu.id },
        data: {
          scheduled_at: targetDate,
          processing_claimed_at: null,
        },
      });

      const dateStr = getWibDateKey(targetDate) || targetDate.toISOString().split('T')[0];
      distribution[dateStr] = (distribution[dateStr] || 0) + 1;
    }

    const daysCount = Object.keys(distribution).length;
    console.log(`[FollowUp Service] Rescheduled ${sortedOverdue.length} overdue follow-ups across ${daysCount} days (stale cancelled: ${staleCancelledCount}).`);
    return {
      rescheduledCount: sortedOverdue.length,
      daysCount,
      distribution,
      staleCancelledCount,
    };
  }
}

export const followUpService = new FollowUpService();
