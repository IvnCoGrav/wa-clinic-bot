import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { parsePositiveInt } from '../utils/env-numeric';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import {
  hasBypassLabel,
  checkCustomerBypass,
  buildNonBypassCustomerWhere,
} from '../utils/customer-bypass';
import {
  normalizeTreatmentCategory,
  isChildCategory,
} from '../utils/treatment-category';
import { canonicalMomStage } from './maternal-state.service';
import { getWibDateKey } from '../config/followup-templates';

// Offset hari jadwal NO_PURCHASE per stage (stage 1, 2, 3 -> +3, +7, +14 hari).
export const NO_PURCHASE_STAGE_DAYS: readonly number[] = [3, 7, 14];

// Alasan pembatalan kanonis (cancel_reason) — single source of truth.
export const CANCEL_REASON = {
  MANUAL_ADMIN: 'Dibatalkan manual oleh Admin',
  BULK_ADMIN: 'Dibatalkan massal oleh Admin',
  RESERVATION_CREATED: 'Customer membuat reservasi baru',
  RESERVATION_CANCELLED: 'Reservasi terkait dibatalkan',
  HAS_ACTIVE_RESERVATION: 'Customer sudah memiliki reservasi aktif',
  INBOUND_HAS_RESERVATION: 'Customer sudah memiliki reservasi',
  INBOUND_CHAT: 'Customer membalas chat (pelanggan aktif kembali)',
  OVERDUE_48H: 'Jadwal kadaluarsa (>48 jam)',
  BYPASS_LABEL: 'Nomor berlabel Skip/Admin CS',
  WABA_TEMPLATE_NOT_APPROVED: 'Template WABA belum disetujui',
  WABA_NO_MARKETING_CONSENT: 'Customer belum opt-in marketing',
  EXPIRED_PENDING: 'Antrean PENDING kadaluarsa (tidak disetujui sebelum akhir hari jadwal)',
  NON_SERIOUS_STAGE3: 'Pengingat hari ke-14 hanya untuk kontak serius (MQL/legacy)',
  UNRESOLVED_PLACEHOLDER: 'Placeholder pesan belum tersubstitusi (dibatalkan gerbang pengiriman)',
} as const;

export const FOLLOWUP_TYPE_PRIORITY: Record<string, number> = {
  NEXT_TREATMENT: 1,
  NO_PURCHASE: 2,
  WINBACK_60D: 3,
  REMINDER_H1: 4,
  REVIEW_H1_BABY: 5,
  REVIEW_H1_MOMS: 6,
};

const LOST_CUSTOMER_NEXT_TREATMENT_GRACE_DAYS = parsePositiveInt(process.env.LOST_CUSTOMER_NEXT_TREATMENT_GRACE_DAYS, 60);
const NO_PURCHASE_LOST_GRACE_DAYS = parsePositiveInt(process.env.NO_PURCHASE_LOST_GRACE_DAYS, 7);
const WINBACK_DORMANT_DAYS = parsePositiveInt(process.env.WINBACK_DORMANT_DAYS, 60);
const WINBACK_ENQUEUE_LIMIT = parsePositiveInt(process.env.WINBACK_ENQUEUE_LIMIT, 10);
const WINBACK_LOST_GRACE_DAYS = parsePositiveInt(process.env.WINBACK_LOST_GRACE_DAYS, 7);

export class FollowUpLifecycleService {
  /**
   * Hitung waktu kirim pada rentang jam operasional ramah 09:30–10:15 WIB (= 02:30–03:15 UTC)
   * menggunakan hash deterministik dari seed (customerId) untuk tanggal anchor + dayOffset hari.
   */
  public computeScheduleAtWib0940(anchor: Date, dayOffset: number, seed: string = ''): Date {
    const anchorWib = new Date(anchor.getTime() + 7 * 60 * 60 * 1000);
    let h = 0;
    const s = `${seed}|${anchorWib.toISOString().slice(0, 10)}|${dayOffset}`;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const offsetMin = h % 46;
    return new Date(Date.UTC(anchorWib.getUTCFullYear(), anchorWib.getUTCMonth(), anchorWib.getUTCDate() + dayOffset, 2, 30 + offsetMin, (h % 60), 0));
  }

  /**
   * Hitung waktu kirim NEXT_TREATMENT pada 09:00 WIB untuk tanggal booking + offset bulan.
   */
  public computeNextTreatmentAtWib0900(bookingDate: Date, monthOffset: number): Date {
    const bWib = new Date(bookingDate.getTime() + 7 * 60 * 60 * 1000);
    const year = bWib.getUTCFullYear();
    const month = bWib.getUTCMonth();
    const day = bWib.getUTCDate();

    const targetMonthIndex = month + monthOffset;
    const targetYear = year + Math.floor(targetMonthIndex / 12);
    const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
    const daysInTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
    const finalDay = Math.min(day, daysInTargetMonth);

    return new Date(Date.UTC(targetYear, normalizedMonth, finalDay, 2, 0, 0, 0));
  }

  /**
   * Buat antrean NO_PURCHASE (stage 1, 2, 3) untuk calon pelanggan yang belum memesan.
   */
  public async createNoPurchaseFollowUps(customerId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      let customer: any = null;
      try {
        customer = await prisma.customer?.findUnique?.({
          where: { id: customerId },
          include: { labels: { include: { label: true } } },
        });
      } catch {}
      if (
        customer &&
        (customer.is_sandbox_test ||
          customer.is_admin_labeled ||
          hasBypassLabel(customer) ||
          isDummyOrTestContact(customer.phone, customer.name))
      ) {
        return;
      }
      if (await checkCustomerBypass({ customerId, tenantId })) {
        return;
      }

      let hasReservation: any = null;
      try {
        hasReservation = await prisma.reservation?.findFirst?.({
          where: {
            customer_id: customerId,
            status: { in: ['pending', 'confirmed', 'en_route', 'completed'] },
          },
        });
      } catch {}
      if (hasReservation) {
        console.log(`[FollowUp Lifecycle] Customer ${customerId} already has reservation (${hasReservation.id}). Skipping NO_PURCHASE.`);
        return;
      }

      let existing = null;
      try {
        existing = await prisma.followUp?.findFirst?.({
          where: {
            customer_id: customerId,
            type: 'NO_PURCHASE',
            tenant_id: tenantId,
            status: { in: ['PENDING', 'QUEUED'] },
          },
        });
      } catch {}
      if (existing) {
        return;
      }

      const stages = [1, 2, 3];
      const days = [3, 7, 14];

      let audience: 'MOMS' | null = null;
      let momStage: string | null = null;
      try {
        const conv = await prisma.conversation?.findFirst?.({
          where: { customer_id: customerId, tenant_id: tenantId },
          orderBy: { last_message_at: 'desc' },
          select: { session_data: true },
        });
        const sd: any = (conv as any)?.session_data || {};
        if (sd.targetAudience === 'MOMS' || sd.momProfile?.stage) audience = 'MOMS';
        momStage = canonicalMomStage(sd.momProfile?.stage);
      } catch {}

      await Promise.all(
        stages.map(async (stage, idx) => {
          const scheduledAt = this.computeScheduleAtWib0940(new Date(), days[idx], customerId);
          try {
            await prisma.followUp?.create?.({
              data: {
                tenant_id: tenantId,
                customer_id: customerId,
                type: 'NO_PURCHASE',
                stage,
                ...(audience === 'MOMS' ? { treatment_category: 'MOMS' as any } : {}),
                ...(momStage ? { mom_stage: momStage } : {}),
                scheduled_at: scheduledAt,
                status: 'QUEUED',
              },
            });
          } catch (_) {}
        })
      );
      console.log(`[FollowUp Lifecycle] Queued NO_PURCHASE follow-ups for customer: ${customerId}`);
    } catch (err) {
      console.error('[FollowUp Lifecycle] Failed to create NO_PURCHASE follow-ups:', err);
    }
  }

  /**
   * Menggeser jadwal NO_PURCHASE relatif terhadap chat terakhir customer saat ada inbound message.
   */
  public async rescheduleNoPurchaseOnInboundChat(
    customerId: string,
    tenantId: string = DEFAULT_TENANT_ID,
    chatAt: Date = new Date()
  ): Promise<{ rescheduled: number; cancelled: number }> {
    const empty = { rescheduled: 0, cancelled: 0 };
    try {
      const anchor = new Date(chatAt);
      if (isNaN(anchor.getTime())) return empty;

      let hasReservation: any = null;
      try {
        hasReservation = await prisma.reservation?.findFirst?.({
          where: {
            customer_id: customerId,
            status: { in: ['pending', 'confirmed', 'en_route', 'completed'] },
          },
        });
      } catch (_) {}
      if (hasReservation) {
        let cancelled = 0;
        try {
          const res = await prisma.followUp.updateMany({
            where: {
              customer_id: customerId,
              tenant_id: tenantId,
              type: { in: ['NO_PURCHASE', 'WINBACK_60D'] },
              status: { in: ['PENDING', 'QUEUED'] },
            },
            data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.INBOUND_HAS_RESERVATION },
          });
          cancelled = res?.count || 0;
        } catch (_) {}
        if (cancelled > 0) {
          console.log(`[FollowUp Lifecycle] Inbound chat: cancelled ${cancelled} NO_PURCHASE (customer ${customerId} has active reservation).`);
        }
        return { rescheduled: 0, cancelled };
      }

      try {
        const wb = await prisma.followUp.updateMany({
          where: {
            customer_id: customerId,
            tenant_id: tenantId,
            type: 'WINBACK_60D',
            status: { in: ['PENDING', 'QUEUED'] },
          },
          data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.INBOUND_CHAT },
        });
        if ((wb?.count || 0) > 0) {
          console.log(`[FollowUp Lifecycle] Inbound chat: cancelled ${wb.count} WINBACK_60D for customer ${customerId}.`);
        }
      } catch (_) {}

      let active: any[] = [];
      try {
        active = (await prisma.followUp.findMany({
          where: {
            customer_id: customerId,
            tenant_id: tenantId,
            type: 'NO_PURCHASE',
            status: { in: ['PENDING', 'QUEUED'] },
          },
          select: { id: true, stage: true, scheduled_at: true },
        })) || [];
      } catch (_) {
        return empty;
      }
      if (active.length === 0) return empty;

      let rescheduled = 0;
      for (const fu of active) {
        const stageIdx = Math.min(3, Math.max(1, fu.stage)) - 1;
        const scheduledAt = this.computeScheduleAtWib0940(anchor, NO_PURCHASE_STAGE_DAYS[stageIdx] ?? 14, customerId);
        try {
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { scheduled_at: scheduledAt },
          });
          rescheduled++;
        } catch (_) {}
      }
      if (rescheduled > 0) {
        console.log(`[FollowUp Lifecycle] Inbound chat: slid ${rescheduled} NO_PURCHASE schedule(s) for customer ${customerId} from ${anchor.toISOString()}.`);
      }
      return { rescheduled, cancelled: 0 };
    } catch (err: any) {
      console.warn('[FollowUp Lifecycle] rescheduleNoPurchaseOnInboundChat failed:', err?.message || err);
      return empty;
    }
  }

  /**
   * Dipanggil saat reservasi baru dibuat. Membatalkan semua follow-up aktif untuk customer ini.
   */
  public async onReservationCreated(customerId: string, reservationId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      let activeFollowUps: any[] = [];
      try {
        activeFollowUps = (await prisma.followUp?.findMany?.({
          where: {
            customer_id: customerId,
            status: { in: ['PENDING', 'QUEUED'] },
            tenant_id: tenantId,
          },
        })) || [];
      } catch (_) {}

      if (activeFollowUps && activeFollowUps.length > 0) {
        try {
          await prisma.followUp?.updateMany?.({
            where: {
              id: { in: activeFollowUps.map(f => f.id) },
            },
            data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.RESERVATION_CREATED },
          });
        } catch (_) {}
        console.log(`[FollowUp Lifecycle] Cancelled ${activeFollowUps.length} active follow-ups for customer: ${customerId} (reservation ${reservationId}).`);
      }
    } catch (err) {
      console.error('[FollowUp Lifecycle] Error handling reservation creation event:', err);
    }
  }

  /**
   * Dipanggil saat reservasi dikonfirmasi (CONFIRMED).
   * Membuat 1 row REMINDER_H1 dan 1 row REVIEW_H1 di antrian.
   */
  public async createReservationFollowUps(params: {
    reservationId: string;
    customerId: string;
    bookingDate: Date;
    treatmentCategory?: string | null;
    tenantId?: string;
  }): Promise<void> {
    const {
      reservationId,
      customerId,
      bookingDate,
      treatmentCategory,
      tenantId = DEFAULT_TENANT_ID,
    } = params;

    try {
      let customer: any = null;
      try {
        customer = await prisma.customer?.findUnique?.({
          where: { id: customerId },
          include: { labels: { include: { label: true } } },
        });
      } catch {}
      if (
        customer &&
        (customer.is_sandbox_test ||
          customer.is_admin_labeled ||
          hasBypassLabel(customer) ||
          isDummyOrTestContact(customer.phone, customer.name))
      ) {
        return;
      }
      if (await checkCustomerBypass({ customerId, tenantId })) {
        return;
      }

      const bDate = new Date(bookingDate);
      if (isNaN(bDate.getTime())) return;

      if (process.env.FOLLOWUP_CREATE_REMINDER_REVIEW !== 'true') {
        console.log(`[FollowUp Lifecycle] REMINDER_H1/REVIEW_H1 tidak dibuat (kebijakan postpone; reservation=${reservationId}).`);
        return;
      }

      const now = new Date();
      const bDateWib = new Date(bDate.getTime() + 7 * 60 * 60 * 1000);
      const year = bDateWib.getUTCFullYear();
      const month = bDateWib.getUTCMonth();
      const day = bDateWib.getUTCDate();

      const reminderDate = new Date(Date.UTC(year, month, day - 1, 12, 0, 0, 0));

      let effectiveReminderDate: Date | null = reminderDate;
      if (reminderDate <= now) {
        if (bDate.getTime() > now.getTime() + 15 * 60 * 1000) {
          effectiveReminderDate = new Date(now.getTime() + 2 * 60 * 1000);
        } else {
          effectiveReminderDate = null;
        }
      }

      const reviewDate = new Date(Date.UTC(year, month, day + 1, 1, 0, 0, 0));
      const isBaby = treatmentCategory == null || treatmentCategory === ''
        ? true
        : isChildCategory(treatmentCategory);
      const reviewType = isBaby ? 'REVIEW_H1_BABY' : 'REVIEW_H1_MOMS';

      if (effectiveReminderDate) {
        let existingReminder = null;
        try {
          existingReminder = await prisma.followUp?.findFirst?.({
            where: {
              reservation_id: reservationId,
              type: 'REMINDER_H1',
              tenant_id: tenantId,
              status: { in: ['PENDING', 'QUEUED'] },
            },
          });
        } catch (_) {}

        if (!existingReminder) {
          try {
            await prisma.followUp?.create?.({
              data: {
                tenant_id: tenantId,
                customer_id: customerId,
                reservation_id: reservationId,
                type: 'REMINDER_H1',
                stage: 1,
                scheduled_at: effectiveReminderDate,
                status: 'PENDING',
              },
            });
            console.log(`[FollowUp Lifecycle] Created (POSTPONED) REMINDER_H1 for reservation: ${reservationId} at ${effectiveReminderDate.toISOString()}`);
          } catch (err: any) {
            console.warn('[FollowUp Lifecycle] Failed to create REMINDER_H1:', err.message);
          }
        }
      }

      if (reviewDate.getTime() <= now.getTime()) {
        console.log(`[FollowUp Lifecycle] Skipping ${reviewType} for reservation ${reservationId}: backdated (review ${reviewDate.toISOString()} <= now).`);
      } else {
        let existingReview = null;
        try {
          existingReview = await prisma.followUp?.findFirst?.({
            where: {
              reservation_id: reservationId,
              type: reviewType as any,
              tenant_id: tenantId,
              status: { in: ['PENDING', 'QUEUED'] },
            },
          });
        } catch (_) {}

        if (!existingReview) {
          try {
            await prisma.followUp?.create?.({
              data: {
                tenant_id: tenantId,
                customer_id: customerId,
                reservation_id: reservationId,
                type: reviewType as any,
                stage: 1,
                ...(normalizeTreatmentCategory(treatmentCategory)
                  ? { treatment_category: normalizeTreatmentCategory(treatmentCategory) }
                  : {}),
                scheduled_at: reviewDate,
                status: 'PENDING',
              },
            });
            console.log(`[FollowUp Lifecycle] Created (POSTPONED) ${reviewType} for reservation: ${reservationId} at ${reviewDate.toISOString()}`);
          } catch (err: any) {
            console.warn(`[FollowUp Lifecycle] Failed to create ${reviewType}:`, err.message);
          }
        }
      }
    } catch (err: any) {
      console.error('[FollowUp Lifecycle] Failed to create reservation follow-ups:', err.message);
    }
  }

  /**
   * Membatalkan semua follow-up terkait reservasi tertentu saat reservasi dibatalkan.
   */
  public async onReservationCancelled(reservationId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      await prisma.followUp?.updateMany?.({
        where: {
          reservation_id: reservationId,
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
        },
        data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.RESERVATION_CANCELLED },
      });
      console.log(`[FollowUp Lifecycle] Cancelled follow-ups for reservation ${reservationId}`);
    } catch (err: any) {
      console.error('[FollowUp Lifecycle] Error cancelling follow-ups for reservation:', err.message);
    }
  }

  /**
   * Menyesuaikan jadwal reminder H-1 dan review H+1 saat reservasi di-reschedule.
   */
  public async onReservationRescheduled(
    reservationId: string,
    newBookingDate: Date,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<void> {
    try {
      const bDate = new Date(newBookingDate);
      if (isNaN(bDate.getTime())) return;

      const bDateWib = new Date(bDate.getTime() + 7 * 60 * 60 * 1000);
      const year = bDateWib.getUTCFullYear();
      const month = bDateWib.getUTCMonth();
      const day = bDateWib.getUTCDate();

      const reminderDate = new Date(Date.UTC(year, month, day - 1, 12, 0, 0, 0));
      const reviewDate = new Date(Date.UTC(year, month, day + 1, 1, 0, 0, 0));

      await prisma.followUp?.updateMany?.({
        where: {
          reservation_id: reservationId,
          type: 'REMINDER_H1',
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
        },
        data: { scheduled_at: reminderDate },
      });

      await prisma.followUp?.updateMany?.({
        where: {
          reservation_id: reservationId,
          type: { in: ['REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] },
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
        },
        data: { scheduled_at: reviewDate },
      });

      console.log(`[FollowUp Lifecycle] Rescheduled follow-ups for reservation ${reservationId} to new date ${newBookingDate.toISOString()}`);
    } catch (err: any) {
      console.error('[FollowUp Lifecycle] Error rescheduling follow-ups for reservation:', err.message);
    }
  }

  /**
   * Membuat antrean NEXT_TREATMENT (+1, +2, +3 bulan) di antrian.
   */
  public async createNextTreatmentFollowUps(
    customerId: string,
    bookingDate: Date,
    tenantId: string = DEFAULT_TENANT_ID,
    reservationId?: string,
    treatmentCategory?: string | null
  ): Promise<void> {
    try {
      let customer: any = null;
      try {
        customer = await prisma.customer?.findUnique?.({
          where: { id: customerId },
          include: { labels: { include: { label: true } } },
        });
      } catch {}
      if (
        customer &&
        (customer.is_sandbox_test ||
          customer.is_admin_labeled ||
          hasBypassLabel(customer) ||
          isDummyOrTestContact(customer.phone, customer.name))
      ) {
        return;
      }
      if (await checkCustomerBypass({ customerId, tenantId })) {
        return;
      }

      const bDate = new Date(bookingDate);
      if (isNaN(bDate.getTime())) return;
      const now = new Date();
      const normalizedCategory = normalizeTreatmentCategory(treatmentCategory);

      let reservationMomStage: string | null = null;
      if (reservationId) {
        try {
          const row = await prisma.reservation?.findUnique?.({
            where: { id: reservationId },
            select: { mom_stage: true },
          });
          reservationMomStage = (row as any)?.mom_stage ?? null;
        } catch {}
      }

      let created = 0;
      let skippedPast = 0;
      let skippedExists = 0;
      let reAnchored = 0;

      for (const stage of [1, 2, 3] as const) {
        const scheduledAt = this.computeNextTreatmentAtWib0900(bDate, stage);
        if (scheduledAt.getTime() <= now.getTime()) {
          skippedPast++;
          continue;
        }

        let exists: any = null;
        try {
          exists = await prisma.followUp?.findFirst?.({
            where: {
              customer_id: customerId,
              type: 'NEXT_TREATMENT',
              stage,
              tenant_id: tenantId,
              status: { in: ['PENDING', 'QUEUED', 'SENT'] as any },
            },
            orderBy: { created_at: 'desc' },
          });
        } catch (_) {}

        if (exists) {
          const existsStatus = String(exists.status || '').toUpperCase();

          if (existsStatus === 'PENDING' || existsStatus === 'QUEUED') {
            const oldAt = exists.scheduled_at ? new Date(exists.scheduled_at) : null;
            const needsReAnchor =
              !oldAt ||
              isNaN(oldAt.getTime()) ||
              oldAt.getTime() !== scheduledAt.getTime() ||
              (!!reservationId && exists.reservation_id !== reservationId);
            if (needsReAnchor) {
              const baseData: any = { scheduled_at: scheduledAt };
              if (reservationId) baseData.reservation_id = reservationId;
              if (normalizedCategory) baseData.treatment_category = normalizedCategory;
              try {
                await prisma.followUp?.update?.({
                  where: { id: exists.id },
                  data: baseData,
                });
                reAnchored++;
              } catch (updErr: any) {
                if (reservationId) {
                  try {
                    await prisma.followUp?.update?.({
                      where: { id: exists.id },
                      data: { scheduled_at: scheduledAt },
                    });
                    reAnchored++;
                  } catch (_) {}
                } else {
                  console.warn('[FollowUp Lifecycle] Re-anchor NEXT_TREATMENT failed:', updErr?.message || updErr);
                }
              }
            } else {
              skippedExists++;
            }
            continue;
          }

          if (existsStatus === 'SENT') {
            const sAt = exists.sent_at ? new Date(exists.sent_at) : null;
            const scAt = exists.scheduled_at ? new Date(exists.scheduled_at) : null;
            const hasDate = (sAt && !isNaN(sAt.getTime())) || (scAt && !isNaN(scAt.getTime()));
            const sameRes = !!reservationId && !!exists.reservation_id && exists.reservation_id === reservationId;
            const inCycleDate =
              (sAt && !isNaN(sAt.getTime()) && sAt.getTime() >= bDate.getTime()) ||
              (scAt && !isNaN(scAt.getTime()) && scAt.getTime() >= bDate.getTime());

            if (sameRes || inCycleDate) {
              skippedExists++;
              continue;
            }

            if (!hasDate && !sameRes) {
              skippedExists++;
              continue;
            }
          } else {
            skippedExists++;
            continue;
          }
        }

        try {
          await prisma.followUp?.create?.({
            data: {
              tenant_id: tenantId,
              customer_id: customerId,
              ...(reservationId ? { reservation_id: reservationId } : {}),
              ...(normalizedCategory ? { treatment_category: normalizedCategory } : {}),
              ...(reservationMomStage ? { mom_stage: reservationMomStage } : {}),
              type: 'NEXT_TREATMENT',
              stage,
              scheduled_at: scheduledAt,
              status: 'QUEUED',
            },
          });
          created++;
        } catch (_) {}
      }

      if (created > 0) {
        console.log(`[FollowUp Lifecycle] Queued ${created} NEXT_TREATMENT follow-up(s) for customer: ${customerId}.`);
      } else if (reAnchored > 0) {
        console.log(`[FollowUp Lifecycle] Re-anchored ${reAnchored} NEXT_TREATMENT follow-up(s) for customer: ${customerId}.`);
      } else if (skippedExists > 0) {
        console.log(`[FollowUp Lifecycle] NEXT_TREATMENT follow-ups already exist for customer: ${customerId}. Skipping.`);
      }
    } catch (err) {
      console.error('[FollowUp Lifecycle] Failed to create NEXT_TREATMENT follow-ups:', err);
    }
  }

  /**
   * Self-Healing Reconciler — jaring pengaman harian mencari completed tanpa antrean NEXT aktif.
   */
  public async reconcileOrphanedCompletedFollowUps(
    tenantId: string = DEFAULT_TENANT_ID,
    creatorFn?: (
      customerId: string,
      bookingDate: Date,
      tenantId: string,
      reservationId?: string,
      treatmentCategory?: string | null
    ) => Promise<void>
  ): Promise<{ reconciledCount: number; customerIds: string[] }> {
    const empty = { reconciledCount: 0, customerIds: [] as string[] };
    const createNext = creatorFn || this.createNextTreatmentFollowUps.bind(this);
    try {
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      let completed: Array<{ customer_id: string; booking_date: Date | null; treatment_category?: string | null }> = [];
      try {
        completed = (await prisma.reservation.findMany({
          where: {
            tenant_id: tenantId,
            status: 'completed',
            booking_date: { gte: ninetyDaysAgo, lte: now },
          },
          select: { customer_id: true, booking_date: true, treatment_category: true },
          orderBy: { booking_date: 'desc' },
        })) as any;
      } catch {
        return empty;
      }
      if (!completed || completed.length === 0) return empty;

      const maxByCustomer = new Map<string, Date>();
      const categoryByCustomer = new Map<string, string>();
      for (const r of completed) {
        if (!r.customer_id || !r.booking_date) continue;
        const d = new Date(r.booking_date);
        if (isNaN(d.getTime())) continue;
        const cur = maxByCustomer.get(r.customer_id);
        if (!cur || d.getTime() > cur.getTime()) {
          maxByCustomer.set(r.customer_id, d);
          if (r.treatment_category) categoryByCustomer.set(r.customer_id, String(r.treatment_category));
        }
      }
      if (maxByCustomer.size === 0) return empty;

      const customerIds = Array.from(maxByCustomer.keys());

      let uncompleted: Array<{ customer_id: string; booking_date: Date | null }> = [];
      try {
        uncompleted = (await prisma.reservation.findMany({
          where: {
            tenant_id: tenantId,
            customer_id: { in: customerIds },
            status: { in: ['pending', 'confirmed', 'en_route', 'hold'] },
          },
          select: { customer_id: true, booking_date: true },
        })) as any;
      } catch {}
      const hasNewerUncompleted = new Set<string>();
      for (const r of uncompleted || []) {
        if (!r.customer_id || !r.booking_date) continue;
        const d = new Date(r.booking_date);
        if (isNaN(d.getTime())) continue;
        const maxCompleted = maxByCustomer.get(r.customer_id);
        if (!maxCompleted || d.getTime() > maxCompleted.getTime()) {
          hasNewerUncompleted.add(r.customer_id);
        }
      }
      const candidates = customerIds.filter((id) => !hasNewerUncompleted.has(id));
      if (candidates.length === 0) return empty;

      let hasNext: Array<{ customer_id: string; stage: number }> = [];
      try {
        hasNext = (await prisma.followUp.findMany({
          where: {
            tenant_id: tenantId,
            customer_id: { in: candidates },
            type: 'NEXT_TREATMENT',
            status: { in: ['PENDING', 'QUEUED'] as any },
          },
          select: { customer_id: true, stage: true },
        })) as any;
      } catch {}
      const stagesByCust = new Map<string, Set<number>>();
      for (const r of hasNext || []) {
        if (!r.customer_id) continue;
        let s = stagesByCust.get(r.customer_id);
        if (!s) {
          s = new Set<number>();
          stagesByCust.set(r.customer_id, s);
        }
        if (typeof r.stage === 'number') {
          s.add(r.stage);
        }
      }
      const orphaned = candidates.filter((id) => (stagesByCust.get(id)?.size ?? 0) < 3);
      if (orphaned.length === 0) return empty;

      let filtered = orphaned;
      try {
        const customers = (await prisma.customer.findMany({
          where: { id: { in: orphaned } },
          select: { id: true, phone: true, name: true, status: true, is_sandbox_test: true, is_admin_labeled: true },
        })) as any[];
        let labelMap = new Map<string, any>();
        try {
          const withLabels = (await prisma.customer.findMany({
            where: { id: { in: orphaned } },
            include: { labels: { include: { label: true } } },
          })) as any[];
          for (const c of withLabels || []) labelMap.set(c.id, c);
        } catch {}
        filtered = [];
        for (const c of customers || []) {
          if (!c) continue;
          if (c.status === 'blocked' || c.is_sandbox_test || c.is_admin_labeled) continue;
          const withLabels = labelMap.get(c.id);
          if (withLabels && hasBypassLabel(withLabels)) continue;
          if (isDummyOrTestContact(c.phone, c.name)) continue;
          try {
            if (await checkCustomerBypass({ customerId: c.id, tenantId })) continue;
          } catch {}
          filtered.push(c.id);
        }
        if ((customers || []).length === 0 && orphaned.length > 0) filtered = orphaned;
      } catch {}

      let reconciledCount = 0;
      const reconciledIds: string[] = [];
      for (const cid of filtered) {
        const maxDate = maxByCustomer.get(cid);
        if (!maxDate) continue;
        try {
          const before = await prisma.followUp.count({
            where: { tenant_id: tenantId, customer_id: cid, type: 'NEXT_TREATMENT', status: { in: ['PENDING', 'QUEUED'] as any } },
          }).catch(() => 0);
          await createNext(cid, maxDate, tenantId, undefined, categoryByCustomer.get(cid) ?? null);
          const after = await prisma.followUp.count({
            where: { tenant_id: tenantId, customer_id: cid, type: 'NEXT_TREATMENT', status: { in: ['PENDING', 'QUEUED'] as any } },
          }).catch(() => 0);
          if (after > before) {
            reconciledCount++;
            reconciledIds.push(cid);
          }
        } catch {}
      }

      if (reconciledCount > 0) {
        console.log(`[FollowUp Lifecycle] Reconciled ${reconciledCount} orphaned completed customer(s) (tenant ${tenantId}).`);
      }
      return { reconciledCount, customerIds: reconciledIds };
    } catch (err: any) {
      console.warn('[FollowUp Lifecycle] reconcileOrphanedCompletedFollowUps failed:', err?.message || err);
      return empty;
    }
  }

  /**
   * Hitung slot jadwal WINBACK_60D pada jam kerja 09:30–16:00 WIB.
   */
  public async buildWinbackScheduleSlots(tenantId: string, count: number, now: Date): Promise<Date[]> {
    const maxPerDay = parsePositiveInt(process.env.FOLLOWUP_MAX_PER_DAY, 40);
    const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const startY = nowWib.getUTCFullYear();
    const startM = nowWib.getUTCMonth();
    let startD = nowWib.getUTCDate();
    if (nowWib.getUTCHours() >= 16) startD += 1;

    const startOfTodayUtc = new Date(
      Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate()) - 7 * 60 * 60 * 1000
    );

    let existing: Array<{ scheduled_at: Date }> = [];
    const loadByDate = new Map<string, number>();
    try {
      const grouped = await (prisma.followUp as any)?.groupBy?.({
        by: ['scheduled_at'],
        where: {
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
          scheduled_at: { gte: startOfTodayUtc },
        },
        _count: { _all: true },
      });
      if (Array.isArray(grouped) && grouped.length > 0) {
        for (const g of grouped) {
          if (!g?.scheduled_at) continue;
          const key = getWibDateKey(g.scheduled_at);
          if (key) loadByDate.set(key, (loadByDate.get(key) || 0) + (g._count?._all || 1));
        }
      } else {
        existing = (await prisma.followUp.findMany({
          where: {
            tenant_id: tenantId,
            status: { in: ['PENDING', 'QUEUED'] },
            scheduled_at: { gte: startOfTodayUtc },
          },
          select: { scheduled_at: true },
        })) as any;
        for (const e of existing || []) {
          if (!e?.scheduled_at) continue;
          const key = getWibDateKey(e.scheduled_at);
          if (key) loadByDate.set(key, (loadByDate.get(key) || 0) + 1);
        }
      }
    } catch {}

    const slots: Date[] = [];
    let dayIndex = 0;
    const step = Math.max(5, Math.floor(390 / maxPerDay));

    for (let i = 0; i < count; i++) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const key = new Date(Date.UTC(startY, startM, startD + dayIndex)).toISOString().slice(0, 10);
        if ((loadByDate.get(key) || 0) < maxPerDay) break;
        dayIndex++;
      }
      const key = new Date(Date.UTC(startY, startM, startD + dayIndex)).toISOString().slice(0, 10);
      const slotIndex = loadByDate.get(key) || 0;
      const offset = Math.min(389, slotIndex * step);
      slots.push(new Date(Date.UTC(startY, startM, startD + dayIndex, 2, 30 + offset, 0, 0)));
      loadByDate.set(key, slotIndex + 1);
    }

    return slots;
  }

  /**
   * Generator antrean WINBACK_60D (re-engagement pelanggan dormant).
   */
  public async enqueueDormantWinbackFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    try {
      const now = new Date();
      const dormantCutoff = new Date(now.getTime() - WINBACK_DORMANT_DAYS * 24 * 60 * 60 * 1000);

      const base = buildNonBypassCustomerWhere() as any;
      const candidates = (await prisma.customer.findMany({
        where: {
          tenant_id: tenantId,
          ...base,
          status: 'active',
          deleted_at: null,
          is_internal_staff: false,
          is_hold_labeled: false,
          conversations: { every: { last_message_at: { lte: dormantCutoff } } },
          follow_ups: {
            none: {
              OR: [
                { status: { in: ['PENDING', 'QUEUED'] } },
                {
                  type: 'WINBACK_60D',
                  status: { notIn: ['CANCELLED', 'SKIPPED'] },
                  created_at: { gte: dormantCutoff },
                },
              ],
            },
          },
          reservations: {
            none: { booking_date: { gte: now }, status: { not: 'cancelled' } },
          },
          OR: [
            {
              reservations: { some: { status: 'completed' } },
              follow_ups: { some: { type: 'NEXT_TREATMENT', stage: 3, status: 'SENT' } },
            },
            {
              is_mql: true,
              follow_ups: { some: { type: 'NO_PURCHASE', stage: 3, status: 'SENT' } },
            },
          ],
        },
        select: { id: true, phone: true, name: true },
        take: WINBACK_ENQUEUE_LIMIT,
      })) as any[];

      const filtered = (candidates || []).filter((c: any) => !isDummyOrTestContact(c.phone, c.name));
      if (filtered.length === 0) return 0;

      const schedule = await this.buildWinbackScheduleSlots(tenantId, filtered.length, now);

      let created = 0;
      for (let i = 0; i < filtered.length; i++) {
        try {
          await prisma.followUp.create({
            data: {
              tenant_id: tenantId,
              customer_id: filtered[i].id,
              type: 'WINBACK_60D',
              stage: 1,
              scheduled_at: schedule[i] || now,
              status: 'QUEUED',
            },
          });
          created++;
        } catch (_) {}
      }

      if (created > 0) {
        console.log(`[FollowUp Lifecycle] Queued ${created} WINBACK_60D follow-up(s) for tenant ${tenantId}.`);
      }
      return created;
    } catch (err: any) {
      console.warn('[FollowUp Lifecycle] enqueueDormantWinbackFollowUps failed:', err?.message || err);
      return 0;
    }
  }

  /**
   * Mengecek customer yang statusnya 'active' dan telah dikirimi follow-up Stage 3 tanpa respons,
   * lalu menandainya sebagai 'lost'.
   */
  public async checkAndSetLostCustomers(tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - LOST_CUSTOMER_NEXT_TREATMENT_GRACE_DAYS);

      const sentStage3FollowUps = await prisma.followUp.findMany({
        where: {
          type: 'NEXT_TREATMENT',
          stage: 3,
          status: 'SENT',
          sent_at: { lte: thresholdDate },
          tenant_id: tenantId,
          customer: {
            status: 'active',
            is_sandbox_test: false,
          },
        },
        include: {
          customer: true,
        },
      });

      const minSentAt = sentStage3FollowUps
        .map((f) => f.sent_at)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0];

      let recentReservations: Array<{ customer_id: string; created_at: Date }> = [];
      if (minSentAt) {
        recentReservations = await prisma.reservation.findMany({
          where: {
            customer_id: { in: sentStage3FollowUps.map((f) => f.customer_id) },
            created_at: { gt: minSentAt },
            tenant_id: tenantId,
          },
          select: { customer_id: true, created_at: true },
        });
      }

      const hasReservationAfterSentAt = new Map<string, boolean>();
      for (const f of sentStage3FollowUps) {
        const hasReservationAfterSent = recentReservations.some(
          (r) => r.customer_id === f.customer_id && r.created_at.getTime() > f.sent_at!.getTime()
        );
        hasReservationAfterSentAt.set(f.id, hasReservationAfterSent);
      }

      for (const f of sentStage3FollowUps) {
        const hasNewReservation = hasReservationAfterSentAt.get(f.id) === true;

        if (!hasNewReservation) {
          await prisma.customer.update({
            where: { id: f.customer_id },
            data: { status: 'lost' },
          });
          console.log(`[FollowUp Lifecycle] Customer ${f.customer_id} marked as 'lost' (NEXT_TREATMENT Stage 3).`);
        }
      }

      try {
        const npThreshold = new Date();
        npThreshold.setDate(npThreshold.getDate() - NO_PURCHASE_LOST_GRACE_DAYS);
        const sentNpStage3 = (await prisma.followUp.findMany({
          where: {
            type: 'NO_PURCHASE',
            stage: 3,
            status: 'SENT',
            sent_at: { lte: npThreshold },
            tenant_id: tenantId,
            customer: { status: 'active', is_sandbox_test: false },
          },
          select: { id: true, customer_id: true, sent_at: true },
        })) as any[];
        const npMinSentAt = sentNpStage3
          .map((f) => f.sent_at)
          .filter(Boolean)
          .sort((a: any, b: any) => new Date(a).getTime() - new Date(b).getTime())[0];
        let npRes: Array<{ customer_id: string; created_at: Date }> = [];
        if (npMinSentAt) {
          npRes = (await prisma.reservation
            .findMany({
              where: {
                customer_id: { in: sentNpStage3.map((f) => f.customer_id) },
                created_at: { gt: new Date(npMinSentAt) },
                tenant_id: tenantId,
              },
              select: { customer_id: true, created_at: true },
            })
            .catch(() => [])) as any;
        }
        for (const f of sentNpStage3) {
          const responded = npRes.some(
            (r) => r.customer_id === f.customer_id && new Date(r.created_at).getTime() > new Date(f.sent_at).getTime()
          );
          if (!responded) {
            await prisma.customer.update({ where: { id: f.customer_id }, data: { status: 'lost' } });
            console.log(`[FollowUp Lifecycle] Customer ${f.customer_id} marked 'lost' (NO_PURCHASE Stage 3).`);
          }
        }
      } catch (e: any) {
        console.warn('[FollowUp Lifecycle] NO_PURCHASE lost sweep failed:', e?.message);
      }

      try {
        const winbackThreshold = new Date();
        winbackThreshold.setDate(winbackThreshold.getDate() - WINBACK_LOST_GRACE_DAYS);

        const sentWinbacksRaw = (await prisma.followUp.findMany({
          where: {
            type: 'WINBACK_60D',
            status: 'SENT',
            sent_at: { lte: winbackThreshold },
            tenant_id: tenantId,
            customer: { status: 'active', is_sandbox_test: false },
          },
          select: { id: true, customer_id: true, sent_at: true, type: true },
        })) as any[];

        const sentWinbacks = (sentWinbacksRaw || []).filter(
          (f) => !f?.type || f.type === 'WINBACK_60D'
        );

        const winbackCustomers = Array.from(
          new Set((sentWinbacks || []).map((f) => f?.customer_id).filter(Boolean))
        );

        if (winbackCustomers.length > 0) {
          const recentRes = (await prisma.reservation
            .findMany({
              where: {
                tenant_id: tenantId,
                customer_id: { in: winbackCustomers },
                created_at: { gte: winbackThreshold },
              },
              select: { customer_id: true, created_at: true },
            })
            .catch(() => [])) as any[];

          const convs = (await prisma.conversation
            .findMany({
              where: { tenant_id: tenantId, customer_id: { in: winbackCustomers } },
              select: { customer_id: true, last_customer_message_at: true },
            })
            .catch(() => [])) as any[];

          for (const f of sentWinbacks || []) {
            if (!f?.sent_at) continue;
            const sentMs = new Date(f.sent_at).getTime();
            const respondedViaReservation = (recentRes || []).some(
              (r) => r.customer_id === f.customer_id && new Date(r.created_at).getTime() > sentMs
            );
            const respondedViaChat = (convs || []).some(
              (c) =>
                c.customer_id === f.customer_id &&
                c.last_customer_message_at &&
                new Date(c.last_customer_message_at).getTime() > sentMs
            );
            if (respondedViaReservation || respondedViaChat) continue;

            try {
              await prisma.customer.update({
                where: { id: f.customer_id },
                data: { status: 'lost' },
              });
              console.log(`[FollowUp Lifecycle] Customer ${f.customer_id} marked as 'lost' (WINBACK_60D).`);
            } catch (_) {}
          }
        }
      } catch (wbErr: any) {
        console.warn('[FollowUp Lifecycle] WINBACK lost-check failed:', wbErr?.message || wbErr);
      }
    } catch (err) {
      console.error('[FollowUp Lifecycle] Error checking and setting lost customers:', err);
    }
  }
}

export const followUpLifecycleService = new FollowUpLifecycleService();
