import { prisma } from '../db/client';
import { getWibDateKey } from '../config/followup-templates';

export interface AllocateFollowUpSlotsParams {
  count: number;
  maxPerDay: number;
  windowStartMinWib?: number;     // menit dari 00:00 WIB (default 540 = 09:00)
  windowEndMinWib?: number;       // menit dari 00:00 WIB (default 990 = 16:30)
  startDateWib: { year: number; month: number; day: number };
  firstDayMinStartWib?: number;   // batas bawah jam untuk hari pertama (cegah masa lalu)
  loadByDate?: Map<string, number>;
  occupiedMinutesByDate?: Map<string, Set<number>>;
  skipDateKeys?: Set<string>;
}

export function getWibMinutes(d: Date): number {
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

/**
 * Membaca beban antrean harian aktif (PENDING / QUEUED) per tanggal WIB.
 * Menggunakan groupBy (jika didukung) atau fallback findMany.
 */
export async function loadFollowUpDailyLoad(
  tenantId: string,
  fromUtc: Date,
  prismaClient: any = prisma
): Promise<Map<string, number>> {
  const loadByDate = new Map<string, number>();

  try {
    const grouped = await prismaClient.followUp?.groupBy?.({
      by: ['scheduled_at'],
      where: {
        tenant_id: tenantId,
        status: { in: ['PENDING', 'QUEUED'] },
        scheduled_at: { gte: fromUtc },
      },
      _count: { _all: true },
    });

    if (Array.isArray(grouped) && grouped.length > 0) {
      for (const g of grouped) {
        if (!g?.scheduled_at) continue;
        const key = getWibDateKey(g.scheduled_at);
        if (key) {
          loadByDate.set(key, (loadByDate.get(key) || 0) + (g._count?._all || 1));
        }
      }
      return loadByDate;
    }

    const existing = await prismaClient.followUp.findMany({
      where: {
        tenant_id: tenantId,
        status: { in: ['PENDING', 'QUEUED'] },
        scheduled_at: { gte: fromUtc },
      },
      select: { scheduled_at: true },
    });

    for (const e of existing || []) {
      if (!e?.scheduled_at) continue;
      const key = getWibDateKey(e.scheduled_at);
      if (key) {
        loadByDate.set(key, (loadByDate.get(key) || 0) + 1);
      }
    }
  } catch (err: any) {
    // Fail-safe jika DB offline / unit test mock
  }

  return loadByDate;
}

export interface FollowUpDailyLoadDetail {
  counts: Map<string, number>;
  occupiedMinutes: Map<string, Set<number>>;
}

/**
 * Versi detail: selain jumlah beban per hari, menyimpan menit slot yang sudah
 * terpakai. Dipakai rescheduler agar dapat mengisi celah kosong tanpa
 * menumpuk slot baru di jam yang sama atau mendorong semuanya ke hari berikutnya.
 */
export async function loadFollowUpDailyLoadDetailed(
  tenantId: string,
  fromUtc: Date,
  prismaClient: any = prisma
): Promise<FollowUpDailyLoadDetail> {
  const counts = new Map<string, number>();
  const occupiedMinutes = new Map<string, Set<number>>();

  try {
    const rows = await prismaClient.followUp.findMany({
      where: {
        tenant_id: tenantId,
        status: { in: ['PENDING', 'QUEUED'] },
        scheduled_at: { gte: fromUtc },
      },
      select: { scheduled_at: true },
    });

    for (const row of rows || []) {
      if (!row?.scheduled_at) continue;
      const key = getWibDateKey(row.scheduled_at);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
      const set = occupiedMinutes.get(key) || new Set<number>();
      set.add(getWibMinutes(row.scheduled_at));
      occupiedMinutes.set(key, set);
    }
  } catch {
    // Fail-safe: DB offline / mock test → anggap beban kosong.
  }

  return { counts, occupiedMinutes };
}

/**
 * Mengalokasikan slot tanggal dan jam (WIB) secara deterministik dan merata,
 * memperhitungkan beban antrean yang sudah ada agar tidak melebihi maxPerDay.
 */
export function allocateFollowUpSlots(params: AllocateFollowUpSlotsParams): Date[] {
  const {
    count,
    maxPerDay,
    windowStartMinWib = 540, // 09:00 WIB
    windowEndMinWib = 990,   // 16:30 WIB
    startDateWib,
    firstDayMinStartWib,
    loadByDate = new Map<string, number>(),
    occupiedMinutesByDate,
    skipDateKeys = new Set<string>(),
  } = params;

  if (count <= 0) return [];
  const safeMaxPerDay = Math.max(1, maxPerDay);
  const span = Math.max(30, windowEndMinWib - windowStartMinWib);
  const stepMin = Math.max(5, Math.floor(span / safeMaxPerDay));
  // Jangan pernah membuat slot melebihi kapasitas jendela: ini mencegah
  // duplikasi slot 16:29 ketika maxPerDay > kapasitas jendela (mis. kuota 100).
  const maxSlotsPerDay = Math.min(safeMaxPerDay, Math.max(1, Math.floor(span / stepMin)));

  const slots: Date[] = [];
  let dayIndex = 0;
  const maxSearchDays = 365;

  while (slots.length < count && dayIndex < maxSearchDays) {
    const targetDateUtc = new Date(Date.UTC(startDateWib.year, startDateWib.month, startDateWib.day + dayIndex));
    const dateKey = targetDateUtc.toISOString().slice(0, 10);

    if (skipDateKeys.has(dateKey)) {
      dayIndex++;
      continue;
    }

    let currentLoad = loadByDate.get(dateKey) || 0;
    if (currentLoad >= maxSlotsPerDay) {
      dayIndex++;
      continue;
    }

    // Tentukan waktu mulai untuk hari ini
    const isFirstDay = dayIndex === 0;
    const effectiveStartMin = isFirstDay && typeof firstDayMinStartWib === 'number'
      ? Math.max(windowStartMinWib, firstDayMinStartWib)
      : windowStartMinWib;

    if (effectiveStartMin >= windowEndMinWib) {
      // Hari pertama sudah lewat jam operasional, lewati ke hari berikutnya
      dayIndex++;
      continue;
    }

    const makeSlot = (slotMinuteWib: number): Date => {
      const utcHours = Math.floor(slotMinuteWib / 60) - 7; // WIB ke UTC
      const utcMinutes = slotMinuteWib % 60;
      return new Date(
        Date.UTC(startDateWib.year, startDateWib.month, startDateWib.day + dayIndex, utcHours, utcMinutes, 0, 0)
      );
    };

    const occupied = occupiedMinutesByDate?.get(dateKey);

    if (occupied) {
      // Isi celah kosong pada hari yang sudah punya antrean.
      let assignedToday = 0;
      for (
        let minute = effectiveStartMin;
        minute < windowEndMinWib && currentLoad < maxSlotsPerDay && slots.length < count;
        minute += stepMin
      ) {
        if (occupied.has(minute)) continue;
        slots.push(makeSlot(minute));
        occupied.add(minute);
        currentLoad++;
        assignedToday++;
      }
      if (assignedToday === 0) {
        dayIndex++;
        continue;
      }
    } else {
      // Hari tanpa antrean existing: mulai dari effectiveStartMin.
      while (currentLoad < maxSlotsPerDay && slots.length < count) {
        const slotMinuteWib = effectiveStartMin + currentLoad * stepMin;
        if (slotMinuteWib >= windowEndMinWib) break;
        slots.push(makeSlot(slotMinuteWib));
        currentLoad++;
      }
    }

    loadByDate.set(dateKey, currentLoad);
    dayIndex++;
  }

  return slots;
}
