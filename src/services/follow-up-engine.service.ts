import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getBrandIdentityAsync } from '../config/brand';
import {
  getRollingFollowUpMessage,
  FollowUpTemplateType,
  getRollingVariant,
} from '../config/followup-templates';
import { typingService } from './typing.service';
import { resolveGatewayForTenant } from '../integrations/whatsapp/factory';
import { wabaTemplateService } from './waba-template.service';
import { wabaConsentService } from './waba-consent.service';
import { parsePositiveInt } from '../utils/env-numeric';
import {
  hasBypassLabel,
  buildNonBypassCustomerWhere,
  BYPASS_LABEL_PRISMA_IN,
} from '../utils/customer-bypass';
import {
  sanitizeCustomerNameForGreeting,
  formatGreeting,
  applyHonorificGreeting,
  formatBabyNamesForGreeting,
} from '../utils/name-sanitizer';
import { isMomsCategory } from '../utils/treatment-category';
import { findUnresolvedPlaceholders } from '../utils/followup-placeholder';
import {
  followUpLifecycleService,
  CANCEL_REASON,
  FOLLOWUP_TYPE_PRIORITY,
} from './follow-up-lifecycle.service';

const FOLLOWUP_BATCH_LIMIT = parsePositiveInt(process.env.FOLLOWUP_BATCH_LIMIT, 20);
const FOLLOWUP_THROTTLE_BASE_MS = parsePositiveInt(process.env.FOLLOWUP_THROTTLE_BASE_MS, 1500);
const FOLLOWUP_RECENT_VISIT_SUPPRESS_DAYS = parsePositiveInt(process.env.FOLLOWUP_RECENT_VISIT_SUPPRESS_DAYS, 14);

export function isWithinFollowUpWorkingHours(now: Date): boolean {
  const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const hour = nowWib.getUTCHours();
  return hour >= 9 && hour < 17;
}

export class FollowUpEngineService {
  /**
   * Manual Send (Approve & Send Now) — dipanggil dari Admin Dashboard.
   */
  public async sendNow(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
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

    const { whatsappProviderService } = await import('./whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      throw new Error('Koneksi outbound WhatsApp sedang diputus oleh Administrator (Cut-Off Darurat aktif).');
    }

    console.log(`[FollowUp Engine] Manual Send Triggered by Admin for Follow-Up #${id} (${fu.customer?.phone})`);
    const success = await this.executeFollowUp(fu, tenantId);
    return success;
  }

  /**
   * Coba ulang follow-up berstatus FAILED → kembalikan ke QUEUED.
   */
  public async retryFollowUp(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    const res = await prisma.followUp.updateMany({
      where: { id, tenant_id: tenantId, status: 'FAILED' },
      data: { status: 'QUEUED', processing_claimed_at: null, cancel_reason: null },
    });
    if (res.count > 0) {
      console.log(`[FollowUp Engine] Retried follow-up #${id} (FAILED → QUEUED).`);
    }
    return res.count > 0;
  }

  /**
   * Menjadwalkan follow-up tunggal ke antrian (status QUEUED).
   */
  public async queueFollowUp(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    const res = await prisma.followUp.updateMany({
      where: { id, tenant_id: tenantId, status: 'PENDING' },
      data: { status: 'QUEUED' },
    });
    console.log(`[FollowUp Engine] Queued follow-up #${id} (status: QUEUED).`);
    return res.count > 0;
  }

  /**
   * Menjadwalkan seluruh follow-up PENDING ke antrian (status QUEUED).
   */
  public async bulkQueueFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    const res = await prisma.followUp.updateMany({
      where: { tenant_id: tenantId, status: 'PENDING' },
      data: { status: 'QUEUED' },
    });
    console.log(`[FollowUp Engine] Bulk queued ${res.count} follow-ups to QUEUED status.`);
    return res.count;
  }

  /**
   * Hitung jumlah follow-up berstatus SENT pada hari kalender WIB berjalan.
   */
  public async countDailySent(tenantId: string, now: Date): Promise<number> {
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
   * Memproses seluruh follow-up yang jatuh tempo (scheduled_at <= NOW()).
   */
  public async processDueFollowUps(
    tenantId: string = DEFAULT_TENANT_ID,
    executorFn?: (fu: any, tenantId: string) => Promise<boolean>
  ): Promise<number> {
    const execute = executorFn || this.executeFollowUp.bind(this);
    const { whatsappProviderService } = await import('./whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      console.log(`[FollowUp Worker] Outbound Cut-Off is ACTIVE for tenant ${tenantId}. Skipping follow-up execution.`);
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
          console.log(`[FollowUp Worker] Auto-cancelled ${expiredPending.count} expired PENDING follow-ups.`);
        }
      } catch (pendingCancelErr: any) {
        console.warn('[FollowUp Worker] Failed to auto-cancel expired PENDING follow-ups:', pendingCancelErr.message);
      }

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

      const maxPerDay = parsePositiveInt(process.env.FOLLOWUP_MAX_PER_DAY, 40);
      const sentToday = await this.countDailySent(tenantId, now);
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

      console.log(`[FollowUp Worker] Found ${dueFollowUps.length} due follow-ups to process (${targetStatuses.join('/')} mode).`);
      let processed = 0;
      const cooldownHours = parsePositiveInt(process.env.FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS, 72);
      const cooldownMs = cooldownHours * 60 * 60 * 1000;

      for (const fu of dueFollowUps) {
        if (fu.scheduled_at && (now.getTime() - new Date(fu.scheduled_at).getTime() > 48 * 60 * 60 * 1000)) {
          console.log(`[FollowUp Worker] FollowUp #${fu.id} is SKIPPED (Overdue > 48h).`);
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.OVERDUE_48H },
          });
          continue;
        }

        if (fu.customer && (fu.customer.is_admin_labeled || hasBypassLabel(fu.customer))) {
          console.log(`[FollowUp Worker] FollowUp #${fu.id} is SKIPPED (Bypass contact label).`);
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.BYPASS_LABEL },
          });
          continue;
        }

        if (fu.type === 'REMINDER_H1' || fu.type === 'REVIEW_H1_BABY' || fu.type === 'REVIEW_H1_MOMS') {
          continue;
        }

        if (
          fu.type === 'NO_PURCHASE' &&
          fu.stage >= 3 &&
          !fu.customer?.is_mql
        ) {
          console.log(`[FollowUp Worker] FollowUp #${fu.id} (NO_PURCHASE stage 3) is SKIPPED (bukan MQL).`);
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
          console.log(`[FollowUp Worker] FollowUp #${fu.id} postponed to ${finalDate.toISOString()} due to recent chat.`);
          continue;
        }

        const success = await execute(fu, tenantId);
        if (success) processed++;
      }

      return processed;
    } catch (err) {
      console.error('[FollowUp Worker] Error processing due follow-ups:', err);
      return 0;
    }
  }

  public ageInFullMonths(birthDate: Date, now: Date = new Date()): number {
    let m = (now.getFullYear() - birthDate.getFullYear()) * 12;
    m += now.getMonth() - birthDate.getMonth();
    if (now.getDate() < birthDate.getDate()) m -= 1;
    return Math.max(0, m);
  }

  public resolveCustomerHonorific(fu: any): 'Bunda' | 'Bapak' {
    const raw = fu?.customer?.preferences?.genderGreeting;
    return String(raw || '').trim().toLowerCase() === 'bapak' ? 'Bapak' : 'Bunda';
  }

  public resolveNextTreatmentTemplateType(fu: any): FollowUpTemplateType {
    const stage = Math.min(3, Math.max(1, Number(fu?.stage) || 1));
    const category = fu?.treatment_category ?? fu?.reservation?.treatment_category ?? null;
    return (isMomsCategory(category)
      ? `NEXT_TREATMENT_MOMS_${stage}`
      : `NEXT_TREATMENT_${stage}`) as FollowUpTemplateType;
  }

  public async resolveMilestoneType(
    fu: any,
    tenantId: string
  ): Promise<FollowUpTemplateType | null> {
    if (fu.type !== 'NEXT_TREATMENT') return null;
    const children: any[] = Array.isArray(fu.customer?.children) ? fu.customer.children : [];
    if (!children.some((c) => c?.birth_date)) return null;

    try {
      const lastRes = await prisma.reservation.findFirst({
        where: { customer_id: fu.customer_id, tenant_id: tenantId },
        orderBy: { created_at: 'desc' },
        select: { treatment_category: true },
      });
      if (!lastRes || (lastRes.treatment_category !== 'BABY' && lastRes.treatment_category !== 'BOTH')) return null;
    } catch {
      return null;
    }

    const windowMonths = parseInt(process.env.MILESTONE_WINDOW_DAYS || '15', 10) / 30;

    const milestones: Record<number, FollowUpTemplateType> = {
      3: 'MILESTONE_3M',
      6: 'MILESTONE_6M',
      9: 'MILESTONE_9M',
      12: 'MILESTONE_12M',
    };

    for (const child of children) {
      if (!child?.birth_date) continue;
      const age = this.ageInFullMonths(new Date(child.birth_date));
      for (const t of Object.keys(milestones).map(Number)) {
        if (Math.abs(age - t) <= windowMonths) return milestones[t];
      }
    }
    return null;
  }

  public async suppressPrematureNextTreatment(fu: any, tenantId: string): Promise<boolean> {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - FOLLOWUP_RECENT_VISIT_SUPPRESS_DAYS * 24 * 60 * 60 * 1000);

      const anchor = await prisma.reservation.findFirst({
        where: {
          customer_id: fu.customer_id,
          tenant_id: tenantId,
          status: { notIn: ['cancelled'] },
          booking_date: { gte: windowStart },
        },
        orderBy: { booking_date: 'desc' },
        select: { booking_date: true },
      });

      const anchorRaw = (anchor as any)?.booking_date;
      if (!anchorRaw) return false;
      const anchorDate = new Date(anchorRaw);
      if (isNaN(anchorDate.getTime())) return false;

      const stage = Math.min(3, Math.max(1, Number(fu.stage) || 1));
      const target = followUpLifecycleService.computeNextTreatmentAtWib0900(anchorDate, stage);
      const finalDate = target.getTime() > now.getTime() ? target : new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await prisma.followUp.update({
        where: { id: fu.id },
        data: { scheduled_at: finalDate },
      });

      console.log(
        `[FollowUp Worker] FollowUp #${fu.id} (${fu.customer?.phone}) NEXT_TREATMENT postponed to ${finalDate.toISOString()} (recent/upcoming visit guard: anchor ${anchorDate.toISOString()}).`
      );
      return true;
    } catch (err: any) {
      console.warn('[FollowUp Worker] suppressPrematureNextTreatment skipped:', err?.message || err);
      return false;
    }
  }

  /**
   * Eksekusi satu unit pengiriman follow-up (dengan rolling template & status update)
   */
  public async executeFollowUp(fu: any, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    try {
      const { whatsappProviderService } = await import('./whatsapp-provider.service');
      const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
      if (isCutOff) {
        console.warn(`[FollowUp Engine] Cannot execute follow-up #${fu.id} because Outbound Cut-Off is ACTIVE.`);
        return false;
      }

      {
        const leaseMs = parsePositiveInt(process.env.FOLLOWUP_CLAIM_LEASE_MS, 5 * 60 * 1000);
        const claimNow = new Date();
        const staleBefore = new Date(claimNow.getTime() - leaseMs);
        let claim: any = null;
        try {
          claim = await prisma.followUp.updateMany({
            where: {
              id: fu.id,
              tenant_id: tenantId,
              status: { in: ['PENDING', 'QUEUED'] },
              OR: [{ processing_claimed_at: null }, { processing_claimed_at: { lt: staleBefore } }],
            },
            data: { processing_claimed_at: claimNow },
          });
        } catch {
          claim = null;
        }
        if (claim && claim.count === 0) {
          console.log(`[FollowUp Engine] FollowUp #${fu.id} sudah diklaim/diproses proses lain. Dilewati (anti dobel-kirim).`);
          return false;
        }
      }

      if (!fu.customer || !fu.customer.phone) {
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'FAILED', processing_claimed_at: null },
        });
        return false;
      }

      {
        const { conversationService } = await import('./conversation.service');
        const proactiveConv = fu.customer.conversations?.[0] || null;
        if (!conversationService.bolehKirimProaktif(proactiveConv, fu.customer)) {
          console.log(`[FollowUp Worker] FollowUp #${fu.id} (${fu.customer?.phone}) SKIPPED — chat sedang ditangani manusia / kontak bypass.`);
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.BYPASS_LABEL, processing_claimed_at: null },
          }).catch(() => {});
          return false;
        }
      }

      const milestoneType = await this.resolveMilestoneType(fu, tenantId);
      let templateType: FollowUpTemplateType = 'NO_PURCHASE_1';
      if (milestoneType) {
        templateType = milestoneType;
        fu._milestone = true;
      } else if (fu.type === 'NEXT_TREATMENT') {
        const postponed = await this.suppressPrematureNextTreatment(fu, tenantId);
        if (postponed) return false;
        templateType = this.resolveNextTreatmentTemplateType(fu);
      } else if (fu.type === 'NO_PURCHASE') {
        try {
          const res = await prisma.reservation.findFirst({
            where: {
              customer_id: fu.customer_id,
              tenant_id: tenantId,
              status: { in: ['pending', 'confirmed', 'en_route', 'completed'] },
            },
          });
          if (res) {
            console.log(`[FollowUp Worker] FollowUp #${fu.id} is NO_PURCHASE but customer already has reservation (${res.id}). Auto-cancelling.`);
            await prisma.followUp.update({
              where: { id: fu.id },
              data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.HAS_ACTIVE_RESERVATION, processing_claimed_at: null },
            });
            return false;
          }
        } catch (_) {}

        const isMomsNoPurchase = isMomsCategory(
          (fu as any).treatment_category ?? (fu as any).reservation?.treatment_category
        );
        templateType = (isMomsNoPurchase
          ? `NO_PURCHASE_MOMS_${Math.min(3, Math.max(1, fu.stage))}`
          : `NO_PURCHASE_${Math.min(3, Math.max(1, fu.stage))}`) as any;
      } else if (fu.type === 'REMINDER_H1') {
        templateType = 'REMINDER_H1';
      } else if (fu.type === 'REVIEW_H1_BABY') {
        templateType = 'REVIEW_H1_BABY';
      } else if (fu.type === 'REVIEW_H1_MOMS') {
        templateType = 'REVIEW_H1_MOMS';
      } else if (fu.type === 'WINBACK_60D') {
        templateType = 'WINBACK_60D';
      }

      const cleanName = sanitizeCustomerNameForGreeting(fu.customer?.name);
      const honorific = this.resolveCustomerHonorific(fu);
      const greetingName = formatGreeting(cleanName, honorific);
      const babyName = formatBabyNamesForGreeting(fu.customer?.children, null, { prefixDek: true });

      let timeStr = 'sesuai kesepakatan';
      if (fu.reservation?.booking_date) {
        const d = new Date(fu.reservation.booking_date);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        timeStr = `${hours}:${minutes} WIB`;
      }

      const gateway = await resolveGatewayForTenant(tenantId);
      if (gateway.providerType === 'WABA') {
        return this.executeFollowUpWaba(fu, templateType, cleanName || 'Bunda', tenantId, timeStr, babyName);
      }

      const normalizeFollowUpGreeting = (text: string): string =>
        text
          .replace(/Bunda\s+Bunda/gi, 'Bunda')
          .replace(/dek\s+dek\s+/gi, 'dek ')
          .replace(/dek\s+si kecil/gi, 'si kecil')
          .replace(/[^\S\r\n]{2,}/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

      let messageText: string;

      const rollingVariant = getRollingVariant(fu.customer_id || fu.customer?.id || '', fu.scheduled_at);
      const tenantBrand = await getBrandIdentityAsync(tenantId).catch(() => null);
      const businessName = tenantBrand?.businessName;

      if (fu.custom_text && fu.custom_text.trim()) {
        messageText = fu.custom_text
          .replace(/Bunda\s*\{name\}/gi, greetingName)
          .replace(/\{name\}/g, cleanName || 'Bunda')
          .replace(/\{time\}/g, timeStr)
          .replace(/\{babyName\}/g, babyName)
          .replace(/Bunda\s+Bunda/gi, 'Bunda')
          .replace(/dek\s+dek\s+/gi, 'dek ')
          .replace(/dek\s+si kecil/gi, 'si kecil')
          .replace(/[^\S\r\n]{2,}/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      } else {
        try {
          const custom = await prisma.followUpTemplate.findFirst({
            where: { tenant_id: tenantId, type: templateType, variant: rollingVariant, is_active: true },
          });
          if (custom) {
            messageText = custom.text
              .replace(/Bunda\s*\{name\}/gi, greetingName)
              .replace(/\{name\}/g, cleanName || 'Bunda')
              .replace(/\{time\}/g, timeStr)
              .replace(/\{babyName\}/g, babyName)
              .replace(/Bunda\s+Bunda/gi, 'Bunda')
              .replace(/dek\s+dek\s+/gi, 'dek ')
              .replace(/dek\s+si kecil/gi, 'si kecil')
              .replace(/[^\S\r\n]{2,}/g, ' ')
              .replace(/\n{3,}/g, '\n\n')
              .trim();
          } else {
            const { text } = getRollingFollowUpMessage(templateType, {
              name: cleanName,
              babyName,
              momStage: (fu as any).mom_stage ?? null,
              time: timeStr,
              businessName,
              index: rollingVariant - 1,
            });
            messageText = normalizeFollowUpGreeting(text);
          }
        } catch (err) {
          const { text } = getRollingFollowUpMessage(templateType, {
            name: cleanName,
            babyName,
            momStage: (fu as any).mom_stage ?? null,
            time: timeStr,
            businessName,
            index: rollingVariant - 1,
          });
          messageText = normalizeFollowUpGreeting(text);
        }
      }

      messageText = applyHonorificGreeting(messageText, honorific);

      const unresolved = findUnresolvedPlaceholders(messageText);
      if (unresolved.length > 0) {
        console.error(
          `[FollowUp Worker] ABORT #${fu.id}: placeholder mentah tersisa (${unresolved.join(', ')}) pada template ${templateType}.`
        );
        try {
          await prisma.followUp.update({
            where: { id: fu.id },
            data: {
              status: 'FAILED',
              cancel_reason: CANCEL_REASON.UNRESOLVED_PLACEHOLDER,
              processing_claimed_at: null,
            },
          });
        } catch (_) {}
        return false;
      }

      console.log(`[FollowUp Worker] Sending ${fu.type} Stage ${fu.stage} to ${fu.customer.phone} (${greetingName}, Baby: ${babyName})`);
      
      const isTest = process.env.NODE_ENV === 'test';
      if (!isTest) {
        const delay = Math.floor(Math.random() * FOLLOWUP_THROTTLE_BASE_MS * 10) + FOLLOWUP_THROTTLE_BASE_MS;
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const fresh = await prisma.followUp.findUnique({
          where: { id: fu.id },
          select: { status: true, scheduled_at: true },
        });
        if (fresh === null || (fresh && !['PENDING', 'QUEUED'].includes(fresh.status as string))) {
          console.log(`[FollowUp Worker] FollowUp #${fu.id} berubah status (${fresh?.status}) saat menunggu. Abort.`);
          return false;
        }
      } catch (_) {}

      const sendResult = await typingService.simulateHumanReply({
        chatId: fu.customer.phone,
        replyText: messageText,
        tenantId,
        singleBubble: true,
      });

      if (!sendResult || (sendResult as any).success !== true) {
        const reason = (sendResult as any)?.error || 'simulateHumanReply returned success=false';
        console.error(`[FollowUp Worker] WAHA send failed for ${fu.id}: ${reason}`);
        try {
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'FAILED', processing_claimed_at: null },
          });
        } catch (dbErr: any) {
          console.warn(`[FollowUp Worker] FollowUp FAILED status update warning:`, dbErr.message);
        }
        try {
          const { AlertService, AlertType, AlertSeverity } = await import('./alert.service');
          await new AlertService().notifyAlert({
            type: AlertType.FOLLOWUP_FAILED,
            severity: AlertSeverity.WARNING,
            message: `Follow-up WAHA gagal terkirim ke ${fu.customer?.phone} (type=${fu.type}).`,
            metadata: { tenantId, followUpId: fu.id, type: fu.type, reason },
          });
        } catch {}
        return false;
      }

      try {
        const { conversationService } = await import('./conversation.service');
        const { messageService } = await import('./message.service');
        const conv = await conversationService.getOrCreateConversation(fu.customer_id, tenantId);
        if (conv) {
          await messageService.logMessage({
            tenantId,
            conversationId: conv.id,
            direction: 'OUTBOUND',
            content: messageText,
            senderType: 'BOT',
            senderName: 'Bot (Follow-Up)',
          });
        }
      } catch (logErr: any) {
        console.warn('[FollowUp Worker] Failed to log outbound message after send:', logErr.message);
      }

      try {
        await prisma.followUp.update({
          where: { id: fu.id },
          data: {
            status: 'SENT',
            sent_at: new Date(),
            processing_claimed_at: null,
          },
        });
      } catch (dbErr: any) {
        console.warn(`[FollowUp Worker] FollowUp status update warning:`, dbErr.message);
      }

      if (fu.type === 'REVIEW_H1_BABY' || fu.type === 'REVIEW_H1_MOMS') {
        try {
          const bookingDate = fu.reservation?.booking_date || new Date();
          const category = fu.treatment_category ?? fu.reservation?.treatment_category ?? null;
          await followUpLifecycleService.createNextTreatmentFollowUps(fu.customer_id, bookingDate, tenantId, fu.reservation?.id, category);
        } catch (_) {}
      }

      return true;
    } catch (err: any) {
      console.error(`[FollowUp Worker] Failed to send follow-up ${fu.id}:`, err.message);
      try {
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'FAILED', processing_claimed_at: null },
        });
      } catch (_) {}
      return false;
    }
  }

  /**
   * Cabang WABA: kirim follow-up via HSM template (patuh regulasi Meta).
   */
  public async executeFollowUpWaba(
    fu: any,
    templateType: FollowUpTemplateType,
    name: string,
    tenantId: string,
    timeStr?: string,
    babyName?: string
  ): Promise<boolean> {
    try {
      const gateway = await resolveGatewayForTenant(tenantId);
      const variant = fu.variant ? Math.min(3, Math.max(1, fu.variant)) : getRollingVariant(fu.customer_id || fu.customer?.id || '', fu.scheduled_at);
      const tenantBrand = await getBrandIdentityAsync(tenantId).catch(() => null);
      const mapping = await wabaTemplateService.getTemplateMapping(tenantId, templateType, variant);

      if (!wabaTemplateService.isUsable(mapping)) {
        console.warn(`[FollowUp WABA] Template ${templateType} status=${mapping.status} (tenant=${tenantId}). Skipped: NOT_APPROVED.`);
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.WABA_TEMPLATE_NOT_APPROVED, processing_claimed_at: null },
        });
        this.notifyTemplateNotApproved(tenantId, templateType, mapping.status);
        return false;
      }

      if (mapping.category === 'MARKETING') {
        const consent = await wabaConsentService.canSendMarketing(fu.customer);
        if (!consent.allowed) {
          console.log(`[FollowUp WABA] Skipped ${templateType} to ${fu.customer.phone}: NO_OPT_IN (tenant=${tenantId}).`);
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.WABA_NO_MARKETING_CONSENT, processing_claimed_at: null },
          });
          return false;
        }
      }

      const isTest = process.env.NODE_ENV === 'test';
      if (!isTest) {
        const base = parsePositiveInt(process.env.WABA_SEND_THROTTLE_BASE_MS, 1500);
        const delay = base + Math.floor(Math.random() * base);
        await new Promise((r) => setTimeout(r, delay));
      }

      console.log(`[FollowUp WABA] Sending ${templateType} (${mapping.templateName}) to ${fu.customer.phone}`);
      const components = wabaTemplateService.buildBodyComponents({ name, time: timeStr, babyName });
      const result = await gateway.sendTemplateMessage(
        fu.customer.phone,
        mapping.templateName,
        mapping.languageCode,
        components
      );

      if (result.success) {
        let renderedContent = `[TEMPLATE: ${mapping.templateName}]`;
        try {
          const custom = await prisma.followUpTemplate.findFirst({
            where: { tenant_id: tenantId, type: templateType, variant, is_active: true },
          });
          if (custom?.text) {
            renderedContent = custom.text
              .replace(/Bunda\s*\{name\}/gi, name)
              .replace(/\{name\}/g, name)
              .replace(/\{time\}/g, timeStr || '')
              .replace(/\{babyName\}/g, babyName || '')
              .trim();
          } else {
            const { text } = getRollingFollowUpMessage(templateType as any, {
              name,
              babyName: babyName || '',
              momStage: (fu as any).mom_stage ?? null,
              time: timeStr || '',
              businessName: tenantBrand?.businessName,
              index: Math.max(0, variant - 1),
            });
            renderedContent = text;
          }
        } catch {}

        try {
          const { conversationService } = await import('./conversation.service');
          const { messageService } = await import('./message.service');
          const conv = await conversationService.getOrCreateConversation(fu.customer_id, tenantId);
          if (conv) {
            await messageService.logMessage({
              tenantId,
              conversationId: conv.id,
              direction: 'OUTBOUND',
              content: renderedContent,
              waMessageId: result.messageId,
              senderType: 'BOT',
              senderName: 'Bot (Follow-Up WABA)',
            });
          }
        } catch (_) {}

        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'SENT', sent_at: new Date(), processing_claimed_at: null },
        });
        return true;
      }

      console.error(`[FollowUp WABA] Send failed ${fu.id}:`, result.error?.message);
      await prisma.followUp.update({
        where: { id: fu.id },
        data: { status: 'FAILED', processing_claimed_at: null },
      });
      return false;
    } catch (err: any) {
      console.error(`[FollowUp WABA] Failed to send follow-up ${fu.id}:`, err.message);
      try {
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'FAILED', processing_claimed_at: null },
        });
      } catch (_) {}
      return false;
    }
  }

  public async notifyTemplateNotApproved(tenantId: string, templateType: string, status: string): Promise<void> {
    try {
      const { AlertService, AlertType, AlertSeverity } = await import('./alert.service');
      const alertService = new AlertService();
      await alertService.notifyAlert({
        type: AlertType.FOLLOWUP_FAILED,
        severity: AlertSeverity.WARNING,
        message: `[WABA TEMPLATE ${status}] Template ${templateType} belum APPROVED (tenant=${tenantId}). Follow-up WABA di-skip. Segera submit/verify template di Meta.`,
        metadata: { tenantId, templateType, status },
      });
    } catch (err: any) {
      console.error('[FollowUp WABA] Failed to notify template-not-approved alert:', err.message);
    }
  }

  public async reconcileOrphanedCompletedFollowUps(
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<{ reconciledCount: number; customerIds: string[] }> {
    return followUpLifecycleService.reconcileOrphanedCompletedFollowUps(tenantId);
  }
}

export const followUpEngineService = new FollowUpEngineService();
