// Slot Overlap Sweep (A5) — deteksi slot jadwal BERTUMPUK (double-booked /
// tumpang waktu) sebagai PERINGATAN DINI ke admin, BUKAN blokir keras.
// Logika murni (findOverlappingSlots) dipisah dari I/O agar bisa diuji offline.
// Rollback: set ENABLE_SLOT_OVERLAP_SWEEP=false.
import { prisma } from '../db/client';
import { webPushService } from './web-push.service';
import { alertService, AlertType, AlertSeverity } from './alert.service';

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Status reservasi yang dianggap "aktif" untuk pemeriksaan tumpang jadwal.
const ACTIVE_STATUSES = ['confirmed', 'hold', 'pending'];

/** Satu grup slot bertumpuk dalam satu hari WIB & satu staf. */
export interface SlotOverlap {
  tenantId: string;
  dayWib: string;
  staffId: string | null;
  reservationIds: string[];
}

/** Baris reservasi minimal yang dibutuhkan untuk deteksi tumpang jadwal. */
export interface SlotOverlapReservation {
  id: string;
  booking_date: Date | string | null;
  duration_minutes: number | null;
  assigned_staff_id: string | null;
  status: string;
  customer_id: string;
  treatment_detail?: string | null;
}

/** Tanggal WIB "YYYY-MM-DD" dari sebuah Date UTC. */
function wibDayKey(date: Date): string {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Jam "HH:MM" WIB dari sebuah Date UTC (untuk ringkasan manusiawi). */
export function formatWibHm(date: Date): string {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const h = String(wib.getUTCHours()).padStart(2, '0');
  const m = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Durasi efektif: default 60 menit, di-clamp ke rentang 15..480 menit. */
function effectiveDuration(v: unknown, fallback = 60): number {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return fallback;
  return Math.min(480, Math.max(15, Math.round(n)));
}

/** Dua interval [start, start+dur) tumpang tindih? (back-to-back TIDAK tumpang). */
function intervalsOverlap(aStartMs: number, aMins: number, bStartMs: number, bMins: number): boolean {
  const aEnd = aStartMs + aMins * 60000;
  const bEnd = bStartMs + bMins * 60000;
  return aStartMs < bEnd && bStartMs < aEnd;
}

/**
 * Fungsi MURNI (tanpa DB): mengelompokkan reservasi per (hari WIB, staf) lalu
 * mendeteksi pasangan yang interval waktunya bertumpuk. Hanya mengembalikan
 * grup yang memiliki minimal satu pasangan bertumpuk, beserta id reservasi
 * yang benar-benar terlibat dalam tumpang tindih.
 */
export function findOverlappingSlots(
  reservations: SlotOverlapReservation[],
  opts?: { minGroupSize?: number }
): SlotOverlap[] {
  const minGroupSize = Math.max(2, opts?.minGroupSize ?? 2);

  type Entry = { reservation: SlotOverlapReservation; startMs: number; mins: number };
  const groups = new Map<string, { tenantId: string; dayWib: string; staffId: string | null; entries: Entry[] }>();

  for (const r of reservations) {
    if (!r.booking_date) continue; // booking_date null → dilewati
    const start = new Date(r.booking_date);
    if (isNaN(start.getTime())) continue;
    const dayWib = wibDayKey(start);
    const staffId = r.assigned_staff_id ?? null;
    const key = `${dayWib}__${staffId ?? '__unassigned__'}`;
    const startMs = start.getTime();
    const mins = effectiveDuration(r.duration_minutes, 60);
    let g = groups.get(key);
    if (!g) {
      g = { tenantId: '', dayWib, staffId, entries: [] };
      groups.set(key, g);
    }
    g.entries.push({ reservation: r, startMs, mins });
  }

  const result: SlotOverlap[] = [];
  for (const g of groups.values()) {
    const involved = new Set<string>();
    for (let i = 0; i < g.entries.length; i++) {
      for (let j = i + 1; j < g.entries.length; j++) {
        const a = g.entries[i];
        const b = g.entries[j];
        if (intervalsOverlap(a.startMs, a.mins, b.startMs, b.mins)) {
          involved.add(a.reservation.id);
          involved.add(b.reservation.id);
        }
      }
    }
    if (involved.size < minGroupSize) continue;
    result.push({
      tenantId: g.tenantId,
      dayWib: g.dayWib,
      staffId: g.staffId,
      reservationIds: Array.from(involved),
    });
  }

  // Urutan deterministik agar mudah diuji & dibaca.
  result.sort((x, y) => {
    if (x.dayWib !== y.dayWib) return x.dayWib < y.dayWib ? -1 : 1;
    return (x.staffId ?? '') < (y.staffId ?? '') ? -1 : (x.staffId ?? '') > (y.staffId ?? '') ? 1 : 0;
  });
  return result;
}

/**
 * Sapuan tumpang jadwal satu tenant: baca reservasi aktif pada jendela
 * (kemarin .. +2 hari WIB), deteksi tumpang tindih, lalu kirim SATU notifikasi
 * agregat ke admin (Web Push + alert). Best-effort: DB offline → nol senyap.
 */
export async function sweepOverlappingSlots(
  tenantId: string
): Promise<{ overlappingGroups: number; reservationCount: number; alertSent: boolean }> {
  let rows: SlotOverlapReservation[] = [];
  try {
    // Jendela WIB: awal hari ini -1 hari s/d akhir hari ini +2 hari.
    const nowWib = new Date(Date.now() + WIB_OFFSET_MS);
    const dayStartUtc = new Date(
      Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate(), 0, 0, 0, 0) - WIB_OFFSET_MS
    );
    const dayEndUtc = new Date(
      Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate(), 23, 59, 59, 999) - WIB_OFFSET_MS
    );
    const windowStart = new Date(dayStartUtc.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(dayEndUtc.getTime() + 2 * 24 * 60 * 60 * 1000);

    rows = (await prisma.reservation.findMany({
      where: {
        tenant_id: tenantId,
        status: { in: ACTIVE_STATUSES },
        booking_date: { not: null, gte: windowStart, lte: windowEnd },
      },
      select: {
        id: true,
        booking_date: true,
        duration_minutes: true,
        assigned_staff_id: true,
        status: true,
        customer_id: true,
        treatment_detail: true,
      },
      orderBy: { booking_date: 'asc' },
    })) as SlotOverlapReservation[];
  } catch (err: any) {
    // DB offline / query gagal → senyap (pola job lain), tidak pernah melempar.
    console.warn(`[SLOT OVERLAP] tenant=${tenantId} query dilewati:`, err?.message);
    return { overlappingGroups: 0, reservationCount: 0, alertSent: false };
  }

  const overlaps = findOverlappingSlots(rows);
  if (overlaps.length === 0) {
    return { overlappingGroups: 0, reservationCount: 0, alertSent: false };
  }

  const overlappingGroups = overlaps.length;
  const reservationCount = overlaps.reduce((s, g) => s + g.reservationIds.length, 0);

  // Ringkasan manusiawi: contoh beberapa jam WIB yang bertumpuk.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sampleTimes = overlaps
    .flatMap((g) => g.reservationIds)
    .map((id) => byId.get(id)?.booking_date)
    .filter((d): d is Date | string => !!d)
    .map((d) => formatWibHm(new Date(d)))
    .sort()
    .slice(0, 3)
    .join(', ');
  const body = `${overlappingGroups} grup slot bertumpuk (${reservationCount} reservasi). Contoh jam: ${sampleTimes} WIB. Mohon cek jadwal terapis.`;

  try {
    await webPushService.sendPushToRole(tenantId, 'ADMIN', {
      title: '⚠️ Slot jadwal bertumpuk',
      body,
      url: '/admin/reservations',
      tag: 'slot_overlap',
      data: { type: 'SLOT_OVERLAP', count: overlappingGroups },
    });
  } catch (e: any) {
    console.warn('[SLOT OVERLAP] Web Push gagal:', e?.message);
  }

  try {
    await alertService.notifyAlert({
      type: AlertType.DAILY_OPS_REPORT,
      severity: AlertSeverity.WARNING,
      tenantId,
      message: `[SLOT OVERLAP] ${body}`,
      metadata: { overlappingGroups, reservationCount },
    });
  } catch (e: any) {
    console.warn('[SLOT OVERLAP] alert gagal:', e?.message);
  }

  return { overlappingGroups, reservationCount, alertSent: true };
}
