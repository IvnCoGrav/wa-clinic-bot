import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { parsePositiveInt } from '../../utils/env-numeric';
import { isDummyOrTestContact } from '../../utils/dummy-filter';
import { buildNonBypassCustomerWhere } from '../../utils/customer-bypass';
import { getWibDateKey } from '../../config/followup-templates';
import {
  WINBACK_DORMANT_DAYS,
  WINBACK_ENQUEUE_LIMIT,
  WINBACK_LOST_GRACE_DAYS,
  LOST_CUSTOMER_NEXT_TREATMENT_GRACE_DAYS,
  NO_PURCHASE_LOST_GRACE_DAYS,
} from './constants';

/**
 * Hitung slot jadwal WINBACK_60D pada jam kerja 09:30–16:00 WIB, disisipkan ke
 * kuota harian GLOBAL (FOLLOWUP_MAX_PER_DAY, default 40) — tanpa kuota khusus
 * terpisah. Beban hari dihitung dari baris PENDING/QUEUED yang sudah ada.
 */
export async function buildWinbackScheduleSlots(
  tenantId: string,
  count: number,
  now: Date
): Promise<Date[]> {
  const maxPerDay = parsePositiveInt(process.env.FOLLOWUP_MAX_PER_DAY, 40);
  const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const startY = nowWib.getUTCFullYear();
  const startM = nowWib.getUTCMonth();
  let startD = nowWib.getUTCDate();
  // Jika jam kerja hari ini sudah lewat (>= 16:00 WIB), mulai dari besok.
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
  } catch {
    // Offline fallback: loadByDate tetap kosong
  }

  const slots: Date[] = [];
  let dayIndex = 0;
  const step = Math.max(5, Math.floor(390 / maxPerDay)); // 09:30–16:00 = 390 menit

  for (let i = 0; i < count; i++) {
    // Cari hari pertama (mulai hari ini/besok) yang bebannya masih < kuota global.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const key = new Date(Date.UTC(startY, startM, startD + dayIndex)).toISOString().slice(0, 10);
      if ((loadByDate.get(key) || 0) < maxPerDay) break;
      dayIndex++;
    }
    const key = new Date(Date.UTC(startY, startM, startD + dayIndex)).toISOString().slice(0, 10);
    const slotIndex = loadByDate.get(key) || 0;
    const offset = Math.min(389, slotIndex * step);
    // 09:30 WIB = 02:30 UTC
    slots.push(new Date(Date.UTC(startY, startM, startD + dayIndex, 2, 30 + offset, 0, 0)));
    loadByDate.set(key, slotIndex + 1);
  }

  return slots;
}

/**
 * Generator antrean WINBACK_60D (re-engagement pelanggan dormant MQL/purna-treatment).
 */
export async function enqueueDormantWinbackFollowUps(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<number> {
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
          // Cabang A: Pasien riil yang sudah pernah treatment selesai + tuntas NEXT_TREATMENT Stage 3
          {
            reservations: { some: { status: 'completed' } },
            follow_ups: { some: { type: 'NEXT_TREATMENT', stage: 3, status: 'SENT' } },
          },
          // Cabang B: Lead MQL yang belum beli tapi tuntas NO_PURCHASE Stage 3
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

    const schedule = await buildWinbackScheduleSlots(tenantId, filtered.length, now);

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
      console.log(`[FollowUp Service] Queued ${created} WINBACK_60D follow-up(s) for tenant ${tenantId} (dormant >= ${WINBACK_DORMANT_DAYS} hari).`);
    }
    return created;
  } catch (err: any) {
    console.warn('[FollowUp Service] enqueueDormantWinbackFollowUps failed:', err?.message || err);
    return 0;
  }
}

/**
 * Mengecek customer yang statusnya 'active' dan telah dikirimi follow-up NEXT_TREATMENT Stage 3
 * lebih dari LOST_CUSTOMER_GRACE_DAYS hari yang lalu, serta tidak melakukan booking baru sejak saat itu.
 */
export async function checkAndSetLostCustomers(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<void> {
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
        console.log(`[FollowUp Service] Customer ${f.customer_id} marked as 'lost' (no new reservation ${LOST_CUSTOMER_NEXT_TREATMENT_GRACE_DAYS} days after Stage 3 follow-up).`);
      }
    }

    // NO_PURCHASE Stage 3 sweep
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
          console.log(`[FollowUp Service] Customer ${f.customer_id} marked 'lost' (NO_PURCHASE Stage 3 no response after ${NO_PURCHASE_LOST_GRACE_DAYS} days).`);
        }
      }
    } catch (e: any) {
      console.warn('[FollowUp Service] NO_PURCHASE lost sweep failed:', e?.message);
    }

    // WINBACK_60D sweep
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
            console.log(`[FollowUp Service] Customer ${f.customer_id} marked as 'lost' (no response/reservation ${WINBACK_LOST_GRACE_DAYS} days after WINBACK_60D).`);
          } catch (_) {}
        }
      }
    } catch (wbErr: any) {
      console.warn('[FollowUp Service] WINBACK lost-check failed:', wbErr?.message || wbErr);
    }
  } catch (err) {
    console.error('[FollowUp Service] Error checking and setting lost customers:', err);
  }
}
