import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { isDummyOrTestContact } from '../../utils/dummy-filter';
import { hasBypassLabel, checkCustomerBypass } from '../../utils/customer-bypass';
import { normalizeTreatmentCategory, isChildCategory } from '../../utils/treatment-category';
import { canonicalMomStage } from '../maternal-state.service';
import { CANCEL_REASON, NO_PURCHASE_STAGE_DAYS } from './constants';

/**
 * Hitung waktu kirim pada rentang jam operasional ramah 09:30–10:15 WIB (= 02:30–03:15 UTC)
 * menggunakan hash deterministik dari seed (customerId) untuk tanggal anchor + dayOffset hari.
 * Menghindari lonjakan serentak (burst) tanpa bergantung pada Math.random().
 */
export function computeScheduleAtWib0940(anchor: Date, dayOffset: number, seed: string = ''): Date {
  const anchorWib = new Date(anchor.getTime() + 7 * 60 * 60 * 1000);
  let h = 0;
  const s = `${seed}|${anchorWib.toISOString().slice(0, 10)}|${dayOffset}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const offsetMin = h % 46; // 0..45 → 09:30 + offset (09:30 - 10:15 WIB)
  return new Date(Date.UTC(anchorWib.getUTCFullYear(), anchorWib.getUTCMonth(), anchorWib.getUTCDate() + dayOffset, 2, 30 + offsetMin, (h % 60), 0));
}

/**
 * Hitung waktu kirim NEXT_TREATMENT pada 09:00 WIB untuk tanggal booking + offset bulan.
 * Normalisasi WIB agar konsisten lintas lingkungan (UTC host vs WIB).
 */
export function computeNextTreatmentAtWib0900(bookingDate: Date, monthOffset: number): Date {
  const bWib = new Date(bookingDate.getTime() + 7 * 60 * 60 * 1000);
  const year = bWib.getUTCFullYear();
  const month = bWib.getUTCMonth();
  const day = bWib.getUTCDate();

  const targetMonthIndex = month + monthOffset;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const finalDay = Math.min(day, daysInTargetMonth);

  // 09:00 WIB = 02:00 UTC
  return new Date(Date.UTC(targetYear, normalizedMonth, finalDay, 2, 0, 0, 0));
}

/**
 * Dipanggil saat customer baru terdaftar di database.
 * Membuat 3 row follow-up PENDING tipe NO_PURCHASE (+3, +7, +14 hari) di antrian.
 */
export async function createNoPurchaseFollowUps(customerId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
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
      console.log(`[FollowUp Service] Customer ${customerId} already has reservation (${hasReservation.id}, status: ${hasReservation.status}). Skipping NO_PURCHASE creation.`);
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
        const scheduledAt = computeScheduleAtWib0940(new Date(), days[idx], customerId);
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
    console.log(`[FollowUp Service] Queued NO_PURCHASE follow-ups for customer: ${customerId}`);
  } catch (err) {
    console.error('[FollowUp Service] Failed to create NO_PURCHASE follow-ups:', err);
  }
}

/**
 * Event-Driven Last-Chat Sliding Window untuk follow-up NO_PURCHASE.
 */
export async function rescheduleNoPurchaseOnInboundChat(
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
        console.log(`[FollowUp Service] Inbound chat: cancelled ${cancelled} NO_PURCHASE (customer ${customerId} has active reservation).`);
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
        console.log(`[FollowUp Service] Inbound chat: cancelled ${wb.count} WINBACK_60D for customer ${customerId}.`);
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
      const scheduledAt = computeScheduleAtWib0940(anchor, NO_PURCHASE_STAGE_DAYS[stageIdx] ?? 14, customerId);
      try {
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { scheduled_at: scheduledAt },
        });
        rescheduled++;
      } catch (_) {}
    }
    if (rescheduled > 0) {
      console.log(`[FollowUp Service] Inbound chat: slid ${rescheduled} NO_PURCHASE schedule(s) for customer ${customerId} from ${anchor.toISOString()}.`);
    }
    return { rescheduled, cancelled: 0 };
  } catch (err: any) {
    console.warn('[FollowUp Service] rescheduleNoPurchaseOnInboundChat failed:', err?.message || err);
    return empty;
  }
}

/**
 * Dipanggil saat reservasi baru dibuat (status pending).
 * Membatalkan semua follow-up pending/queued untuk customer ini karena
 * customer telah maju ke tahap reservasi.
 */
export async function onReservationCreated(customerId: string, reservationId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
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
      console.log(`[FollowUp Service] Cancelled ${activeFollowUps.length} active follow-ups for customer: ${customerId} (reservation ${reservationId}).`);
    }
  } catch (err) {
    console.error('[FollowUp Service] Error handling reservation creation event:', err);
  }
}

/**
 * Dipanggil saat reservasi dikonfirmasi (CONFIRMED).
 * Membuat 1 row REMINDER_H1 (H-1 pukul 19:00 WIB) dan
 * 1 row REVIEW_H1_BABY / REVIEW_H1_MOMS (H+1 pukul 08:00 WIB) di antrian follow_ups.
 */
export async function createReservationFollowUps(params: {
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
      console.log(`[FollowUp Service] REMINDER_H1/REVIEW_H1 tidak dibuat (kebijakan postpone; reservation=${reservationId}).`);
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
          console.log(`[FollowUp Service] Created (POSTPONED) REMINDER_H1 for reservation: ${reservationId} at ${effectiveReminderDate.toISOString()}`);
        } catch (err: any) {
          console.warn('[FollowUp Service] Failed to create REMINDER_H1:', err.message);
        }
      }
    }

    if (reviewDate.getTime() <= now.getTime()) {
      console.log(`[FollowUp Service] Skipping ${reviewType} for reservation ${reservationId}: backdated (review ${reviewDate.toISOString()} <= now).`);
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
          console.log(`[FollowUp Service] Created (POSTPONED) ${reviewType} for reservation: ${reservationId} at ${reviewDate.toISOString()}`);
        } catch (err: any) {
          console.warn(`[FollowUp Service] Failed to create ${reviewType}:`, err.message);
        }
      }
    }
  } catch (err: any) {
    console.error('[FollowUp Service] Failed to create reservation follow-ups:', err.message);
  }
}

/**
 * Membatalkan semua follow-up terkait reservasi tertentu saat reservasi dibatalkan/ditolak.
 */
export async function onReservationCancelled(reservationId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
  try {
    await prisma.followUp?.updateMany?.({
      where: {
        reservation_id: reservationId,
        tenant_id: tenantId,
        status: { in: ['PENDING', 'QUEUED'] },
      },
      data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.RESERVATION_CANCELLED },
    });
    console.log(`[FollowUp Service] Cancelled follow-ups for reservation ${reservationId}`);
  } catch (err: any) {
    console.error('[FollowUp Service] Error cancelling follow-ups for reservation:', err.message);
  }
}

/**
 * Menyesuaikan jadwal reminder H-1 dan review H+1 saat reservasi di-reschedule.
 */
export async function onReservationRescheduled(
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

    console.log(`[FollowUp Service] Rescheduled follow-ups for reservation ${reservationId} to new date ${newBookingDate.toISOString()}`);
  } catch (err: any) {
    console.error('[FollowUp Service] Error rescheduling follow-ups for reservation:', err.message);
  }
}

/**
 * Dipanggil saat reservasi dikonfirmasi/rescheduled/selesai.
 * Membuat hingga 3 row follow-up QUEUED tipe NEXT_TREATMENT (+1, +2, +3 bulan) di antrian.
 */
export async function createNextTreatmentFollowUps(
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
      const scheduledAt = computeNextTreatmentAtWib0900(bDate, stage);
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
                console.warn('[FollowUp Service] Re-anchor NEXT_TREATMENT failed:', updErr?.message || updErr);
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
      console.log(`[FollowUp Service] Queued ${created} NEXT_TREATMENT follow-up(s) for customer: ${customerId} (skipped ${skippedPast} past, ${skippedExists} existing, re-anchored ${reAnchored}).`);
    } else if (reAnchored > 0) {
      console.log(`[FollowUp Service] Re-anchored ${reAnchored} NEXT_TREATMENT follow-up(s) to new booking date for customer: ${customerId}.`);
    } else if (skippedExists > 0) {
      console.log(`[FollowUp Service] NEXT_TREATMENT follow-ups already exist for customer: ${customerId}. Skipping (idempotent per-stage).`);
    }
  } catch (err) {
    console.error('[FollowUp Service] Failed to create NEXT_TREATMENT follow-ups:', err);
  }
}

/**
 * Self-Healing Reconciler (Fase 2) — jaring pengaman harian.
 */
export async function reconcileOrphanedCompletedFollowUps(
  tenantId: string = DEFAULT_TENANT_ID,
  createNextFn = createNextTreatmentFollowUps
): Promise<{ reconciledCount: number; customerIds: string[] }> {
  const empty = { reconciledCount: 0, customerIds: [] as string[] };
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
        await createNextFn(cid, maxDate, tenantId, undefined, categoryByCustomer.get(cid) ?? null);
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
      console.log(`[FollowUp Reconciler] Reconciled ${reconciledCount} orphaned completed customer(s) (tenant ${tenantId}).`);
    }
    return { reconciledCount, customerIds: reconciledIds };
  } catch (err: any) {
    console.warn('[FollowUp Reconciler] reconcileOrphanedCompletedFollowUps failed:', err?.message || err);
    return empty;
  }
}
