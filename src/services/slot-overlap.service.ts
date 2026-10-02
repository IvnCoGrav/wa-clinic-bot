// Slot Overlap Sweep (A5) — deteksi slot jadwal BERTUMPUK (double-booked /
// tumpang waktu) sebagai PERINGATAN DINI ke admin, BUKAN blokir keras.
// Logika murni (findOverlappingSlots) dipisah dari I/O agar bisa diuji offline.
//
// Revisi v2 (triase fondasional):
// - Empat kategori berbasis STATE (bukan hafalan kalimat):
//     STAFF_DOUBLE_BOOKED, CUSTOMER_DOUBLE_BOOKED, UNASSIGNED_OVERCAPACITY,
//     UNASSIGNED_PENDING_ACTION.
// - Kapasitas global dihitung sweep-line (peak concurrent) melawan
//   `Staff.active=true` tenant (sumber tunggal, bukan angka hardcode).
// - Dedup alarm PERSISTEN via tabel AdminNotificationLog (cooldown per-severity),
//   bukan Map in-memory → survive restart/redeploy. Memory hanya fallback offline.
// - Link aksi dari ADMIN_DASHBOARD_URL (bukan URL tenant hardcode).
// Rollback: set ENABLE_SLOT_OVERLAP_SWEEP=false.
import { prisma } from '../db/client';
import { webPushService } from './web-push.service';
import { alertService, AlertType, AlertSeverity } from './alert.service';

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Status reservasi yang dianggap "aktif" untuk pemeriksaan tumpang jadwal.
// `pending` sengaja DIPISAH: keputusan pemilik #173e — pending tidak mengunci
// slot, jadi TIDAK dihitung untuk kapasitas/bentrok bidan. Namun tetap dihitung
// untuk duplikasi pasien (sinyal same-day yang valid).
const STATUSES_CAPACITY = ['confirmed', 'en_route', 'hold'];
const STATUSES_DUPLICATE = ['confirmed', 'en_route', 'hold', 'pending'];

/** Empat status triase tumpang jadwal. */
export type SlotOverlapType =
  | 'STAFF_DOUBLE_BOOKED'
  | 'CUSTOMER_DOUBLE_BOOKED'
  | 'UNASSIGNED_OVERCAPACITY'
  | 'UNASSIGNED_PENDING_ACTION';

export type SlotOverlapSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

/** Satu grup tumpang jadwal yang sudah ditriase. */
export interface SlotOverlap {
  type: SlotOverlapType;
  tenantId: string;
  dayWib: string;
  staffId: string | null;
  staffName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerNames?: string[];
  reservationIds: string[];
  sampleTimeHm: string;
  severity: SlotOverlapSeverity;
}

const MAX_LISTED_PATIENTS = 5;

/** Ambil nama pasien unik dari sekumpulan entry (null dibuang). */
function uniqueCustomerNames(entries: Entry[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const name = e.reservation.customer_name?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
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
  customer_name?: string | null;
  staff_name?: string | null;
}

/** Cooldown alarm per-severity (ms): kritis lebih sering, info lebih jarang. */
export const SLOT_OVERLAP_COOLDOWN_MS: Record<SlotOverlapSeverity, number> = {
  CRITICAL: 60 * 60 * 1000,
  WARNING: 4 * 60 * 60 * 1000,
  INFO: 12 * 60 * 60 * 1000,
};

const SEVERITY_RANK: Record<SlotOverlapSeverity, number> = { CRITICAL: 3, WARNING: 2, INFO: 1 };

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

type Entry = { reservation: SlotOverlapReservation; startMs: number; mins: number; dayWib: string };

/**
 * Komponen terhubung dari graf tumpang-tindih: reservasi yang saling terhubung
 * (langsung atau via perantara) dikembalikan sebagai satu grup. Menutup celah
 * "A overlap B, B overlap C, tapi A tidak overlap C".
 */
function connectedOverlapGroups(entries: Entry[], minGroupSize: number): Entry[][] {
  const n = entries.length;
  if (n < minGroupSize) return [];
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = entries[i];
      const b = entries[j];
      if (intervalsOverlap(a.startMs, a.mins, b.startMs, b.mins)) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  const seen = new Array<boolean>(n).fill(false);
  const groups: Entry[][] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const stack = [i];
    const component: Entry[] = [];
    seen[i] = true;
    while (stack.length) {
      const cur = stack.pop()!;
      component.push(entries[cur]);
      for (const nb of adj[cur]) {
        if (!seen[nb]) {
          seen[nb] = true;
          stack.push(nb);
        }
      }
    }
    if (component.length >= minGroupSize) groups.push(component);
  }
  return groups;
}

/** Hambatan puncak (peak concurrent) dari daftar entry dalam satu hari. */
function peakConcurrent(entries: Entry[]): number {
  const events: Array<{ t: number; delta: number }> = [];
  for (const e of entries) {
    events.push({ t: e.startMs, delta: 1 });
    events.push({ t: e.startMs + e.mins * 60000, delta: -1 });
  }
  // End (delta -1) diproses SEBELUM start (delta +1) pada timestamp sama →
  // back-to-back tidak dihitung sebagai tumpang tindih.
  events.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.delta - b.delta));
  let running = 0;
  let peak = 0;
  for (const ev of events) {
    running += ev.delta;
    if (running > peak) peak = running;
  }
  return peak;
}

function sampleTime(entries: Entry[]): string {
  const earliest = entries.reduce((min, e) => Math.min(min, e.startMs), Number.POSITIVE_INFINITY);
  return isFinite(earliest) ? formatWibHm(new Date(earliest)) : '';
}

function highestSeverity(overlaps: SlotOverlap[]): SlotOverlapSeverity {
  let best: SlotOverlapSeverity = 'INFO';
  for (const o of overlaps) {
    if (SEVERITY_RANK[o.severity] > SEVERITY_RANK[best]) best = o.severity;
  }
  return best;
}

/** Fingerprint deterministik untuk dedup alarm (lintas-tenant aman + versi skema). */
export function computeOverlapFingerprint(overlaps: SlotOverlap[], tenantId: string): string {
  const parts = overlaps
    .map((o) => `${o.type}:${o.dayWib}:${[...o.reservationIds].sort().join(',')}`)
    .sort();
  return `v1|${tenantId}|${parts.join('|')}`;
}

export interface FindOverlappingSlotsOptions {
  tenantId: string;
  /**
   * Jumlah Bidan aktif tenant. `null`/`undefined` = tidak diketahui (DB error) →
   * audit kapasitas DILEWATI (fail-safe: jangan menebak kuota).
   */
  activeStaffCount?: number | null;
  minGroupSize?: number;
}

/**
 * Fungsi MURNI (tanpa DB): men-triase reservasi aktif menjadi empat kategori
 * tumpang jadwal. Kapasitas global dihitung terhadap `activeStaffCount`.
 */
export function findOverlappingSlots(
  reservations: SlotOverlapReservation[],
  opts: FindOverlappingSlotsOptions
): SlotOverlap[] {
  const tenantId = (opts.tenantId || '').trim();
  if (!tenantId) {
    throw new Error('findOverlappingSlots: tenantId wajib diisi (bukan string kosong).');
  }
  const minGroupSize = Math.max(2, opts?.minGroupSize ?? 2);
  const activeStaffCount = opts?.activeStaffCount;

  // Parse sekali → entry valid, indeks per hari.
  const byDay = new Map<string, Entry[]>();
  for (const r of reservations) {
    if (!r.booking_date) continue;
    const start = new Date(r.booking_date);
    if (isNaN(start.getTime())) continue;
    const dayWib = wibDayKey(start);
    const entry: Entry = {
      reservation: r,
      startMs: start.getTime(),
      mins: effectiveDuration(r.duration_minutes, 60),
      dayWib,
    };
    const list = byDay.get(dayWib);
    if (list) list.push(entry);
    else byDay.set(dayWib, [entry]);
  }

  const result: SlotOverlap[] = [];
  const capacityEntries = (list: Entry[]) => list.filter((e) => STATUSES_CAPACITY.includes(e.reservation.status));
  const duplicateEntries = (list: Entry[]) => list.filter((e) => STATUSES_DUPLICATE.includes(e.reservation.status));

  for (const [dayWib, allEntries] of byDay) {
    const capEntries = capacityEntries(allEntries);

    // --- 1. STAFF_DOUBLE_BOOKED (per Bidan, status kapasitas) ---
    const byStaff = new Map<string, Entry[]>();
    for (const e of capEntries) {
      const sid = e.reservation.assigned_staff_id;
      if (!sid) continue;
      const list = byStaff.get(sid);
      if (list) list.push(e);
      else byStaff.set(sid, [e]);
    }
    for (const [staffId, entries] of byStaff) {
      for (const component of connectedOverlapGroups(entries, minGroupSize)) {
        result.push({
          type: 'STAFF_DOUBLE_BOOKED',
          tenantId,
          dayWib,
          staffId,
          staffName: component[0]?.reservation.staff_name ?? null,
          customerId: null,
          customerName: null,
          customerNames: uniqueCustomerNames(component),
          reservationIds: component.map((e) => e.reservation.id),
          sampleTimeHm: sampleTime(component),
          severity: 'CRITICAL',
        });
      }
    }

    // --- 2. CUSTOMER_DOUBLE_BOOKED (per Pasien, lintas Bidan, termasuk pending) ---
    const byCustomer = new Map<string, Entry[]>();
    for (const e of duplicateEntries(allEntries)) {
      const cid = e.reservation.customer_id;
      if (!cid) continue;
      const list = byCustomer.get(cid);
      if (list) list.push(e);
      else byCustomer.set(cid, [e]);
    }
    for (const [customerId, entries] of byCustomer) {
      for (const component of connectedOverlapGroups(entries, minGroupSize)) {
        result.push({
          type: 'CUSTOMER_DOUBLE_BOOKED',
          tenantId,
          dayWib,
          staffId: null,
          staffName: null,
          customerId,
          customerName: component[0]?.reservation.customer_name ?? null,
          customerNames: uniqueCustomerNames(component),
          reservationIds: component.map((e) => e.reservation.id),
          sampleTimeHm: sampleTime(component),
          severity: 'WARNING',
        });
      }
    }

    // --- 3/4. Kapasitas global (hanya bila kuota Bidan diketahui) ---
    if (activeStaffCount == null || capEntries.length === 0) continue;
    const peak = peakConcurrent(capEntries);
    if (peak > activeStaffCount) {
      result.push({
        type: 'UNASSIGNED_OVERCAPACITY',
        tenantId,
        dayWib,
        staffId: null,
        staffName: null,
        customerId: null,
        customerName: null,
        customerNames: uniqueCustomerNames(capEntries),
        reservationIds: capEntries.map((e) => e.reservation.id),
        sampleTimeHm: sampleTime(capEntries),
        severity: 'CRITICAL',
      });
    } else {
      // Kapasitas cukup, tapi ada antrean tanpa Bidan yang saling beririsan.
      const unassigned = capEntries.filter((e) => !e.reservation.assigned_staff_id);
      const groups = connectedOverlapGroups(unassigned, minGroupSize);
      for (const component of groups) {
        result.push({
          type: 'UNASSIGNED_PENDING_ACTION',
          tenantId,
          dayWib,
          staffId: null,
          staffName: null,
          customerId: null,
          customerName: null,
          customerNames: uniqueCustomerNames(component),
          reservationIds: component.map((e) => e.reservation.id),
          sampleTimeHm: sampleTime(component),
          severity: 'INFO',
        });
      }
    }
  }

  // Urutan deterministik agar mudah diuji & dibaca.
  const typeOrder: SlotOverlapType[] = [
    'STAFF_DOUBLE_BOOKED',
    'CUSTOMER_DOUBLE_BOOKED',
    'UNASSIGNED_OVERCAPACITY',
    'UNASSIGNED_PENDING_ACTION',
  ];
  result.sort((x, y) => {
    if (x.dayWib !== y.dayWib) return x.dayWib < y.dayWib ? -1 : 1;
    const tx = typeOrder.indexOf(x.type);
    const ty = typeOrder.indexOf(y.type);
    if (tx !== ty) return tx - ty;
    const sx = x.staffId ?? '';
    const sy = y.staffId ?? '';
    if (sx !== sy) return sx < sy ? -1 : 1;
    const cx = x.customerId ?? '';
    const cy = y.customerId ?? '';
    if (cx !== cy) return cx < cy ? -1 : 1;
    return 0;
  });
  return result;
}

const TYPE_LABEL: Record<SlotOverlapType, string> = {
  STAFF_DOUBLE_BOOKED: 'Bentrok Bidan',
  CUSTOMER_DOUBLE_BOOKED: 'Pasien Dobel',
  UNASSIGNED_OVERCAPACITY: 'Kapasitas Terlampaui',
  UNASSIGNED_PENDING_ACTION: 'Perlu Pembagian Bidan',
};

const SEVERITY_EMOJI: Record<SlotOverlapSeverity, string> = {
  CRITICAL: '🔴',
  WARNING: '🟡',
  INFO: '🔵',
};

/** Label tanggal WIB panjang (mis. "Minggu, 4 Oktober 2026") — locale id-ID. */
function formatWibDayLabel(dayWib: string): string {
  const [y, m, d] = dayWib.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return dayWib;
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  try {
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    }).format(date);
  } catch {
    return dayWib;
  }
}

/**
 * Formatter pesan actionable (MURNI, mudah diuji). Data pasien/bidan diambil
 * dari field reservasi yang sudah di-join DB, BUKAN hardcode.
 */
export function formatOverlapAlert(
  overlaps: SlotOverlap[],
  opts: { baseUrl: string; activeStaffCount?: number | null }
): { title: string; body: string } {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const byDay = new Map<string, SlotOverlap[]>();
  for (const o of overlaps) {
    const list = byDay.get(o.dayWib);
    if (list) list.push(o);
    else byDay.set(o.dayWib, [o]);
  }

  const blocks: string[] = [];
  for (const [dayWib, dayOverlaps] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const lines: string[] = [];
    lines.push(`⚠️ [OPERASIONAL JADWAL] Tindakan Diperlukan`);
    lines.push(`📅 Hari & Tanggal: ${formatWibDayLabel(dayWib)}`);
    for (const o of dayOverlaps) {
      const label = TYPE_LABEL[o.type];
      const subject =
        o.type === 'STAFF_DOUBLE_BOOKED'
          ? ` — Bidan: ${o.staffName || o.staffId || '-'}`
          : o.type === 'CUSTOMER_DOUBLE_BOOKED'
            ? ` — Pasien: ${o.customerName || o.customerId || '-'}`
            : '';
      lines.push(
        `${SEVERITY_EMOJI[o.severity]} ${o.sampleTimeHm} WIB — ${label}${subject} (${o.reservationIds.length} reservasi)`
      );
      const names = o.customerNames ?? [];
      if (names.length > 0) {
        const shown = names.slice(0, MAX_LISTED_PATIENTS).join(', ');
        const extra = names.length > MAX_LISTED_PATIENTS ? ` +${names.length - MAX_LISTED_PATIENTS} lainnya` : '';
        lines.push(`   Pasien: ${shown}${extra}`);
      }
    }
    if (opts.activeStaffCount != null) {
      lines.push(`💡 Info Kuota: Tersedia ${opts.activeStaffCount} Bidan aktif.`);
    }
    lines.push(`👉 Buka Jadwal: ${baseUrl}/reservations?date=${dayWib}`);
    blocks.push(lines.join('\n'));
  }

  return {
    title: '⚠️ [OPERASIONAL JADWAL] Tumpang jadwal perlu tindakan',
    body: blocks.join('\n\n'),
  };
}

// --- Dedup alarm PERSISTEN (AdminNotificationLog). ---------------------------
// Jalur utama = DB (survive restart/redeploy). Map hanya fallback saat DB offline
// (best-effort, pola repo) — BUKAN mekanisme dedup utama.
const offlineDedupFallback = new Map<string, number>();
const OFFLINE_DEDUP_MAX = 200;

/** Untuk test: bersihkan fallback memori. */
export function __clearSlotOverlapDedupFallback(): void {
  offlineDedupFallback.clear();
}

/**
 * Kirim bila belum ada alarm berprefix sama dalam jendela cooldown. Prefix
 * memuat fingerprint + severity sehingga perubahan data memicu kirim ulang
 * seketika. Mengembalikan true bila boleh kirim.
 */
async function shouldSendAlert(prefix: string, cooldownMs: number): Promise<boolean> {
  const now = Date.now();
  try {
    const row = await prisma.adminNotificationLog.findFirst({
      where: { idempotency_key: { startsWith: prefix } },
      orderBy: { sent_at: 'desc' },
      select: { sent_at: true, status: true },
    });
    if (row && row.status === 'SENT' && row.sent_at) {
      return now - new Date(row.sent_at).getTime() >= cooldownMs;
    }
    return true;
  } catch {
    const last = offlineDedupFallback.get(prefix);
    return last == null || now - last >= cooldownMs;
  }
}

async function recordSentAlert(prefix: string, key: string, tenantId: string, dayWib: string): Promise<void> {
  try {
    await prisma.adminNotificationLog.create({
      data: {
        tenant_id: tenantId,
        channel: 'SYSTEM',
        recipient: 'admin',
        notification_type: 'SLOT_OVERLAP',
        report_date: dayWib,
        idempotency_key: key,
        title: 'Slot overlap alert',
        message_content: prefix,
        status: 'SENT',
      },
    });
  } catch (err: any) {
    // P2002 = balapan cron untuk key sama → sudah tercatat, aman.
    if (err?.code === 'P2002') return;
    offlineDedupFallback.set(prefix, Date.now());
    if (offlineDedupFallback.size > OFFLINE_DEDUP_MAX) {
      const oldest = offlineDedupFallback.keys().next().value;
      if (oldest) offlineDedupFallback.delete(oldest);
    }
  }
}

export interface SlotOverlapSweepResult {
  overlappingGroups: number;
  reservationCount: number;
  alertSent: boolean;
  deduped: boolean;
}

/**
 * Sapuan tumpang jadwal satu tenant: baca reservasi aktif pada jendela
 * (kemarin .. +2 hari WIB), triase, lalu kirim SATU notifikasi agregat ke admin
 * (Web Push + alert) bila belum ada alarm serupa dalam cooldown per-severity.
 * Best-effort: DB offline → nol senyap.
 */
export async function sweepOverlappingSlots(tenantId: string): Promise<SlotOverlapSweepResult> {
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

    const raw = await prisma.reservation.findMany({
      where: {
        tenant_id: tenantId,
        status: { in: STATUSES_DUPLICATE },
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
        customer: { select: { name: true } },
        assigned_staff: { select: { name: true } },
      },
      orderBy: { booking_date: 'asc' },
    });
    rows = (raw as any[]).map((r) => ({
      id: r.id,
      booking_date: r.booking_date,
      duration_minutes: r.duration_minutes,
      assigned_staff_id: r.assigned_staff_id,
      status: r.status,
      customer_id: r.customer_id,
      treatment_detail: r.treatment_detail,
      customer_name: r.customer?.name ?? null,
      staff_name: r.assigned_staff?.name ?? null,
    }));
  } catch (err: any) {
    // DB offline / query gagal → senyap (pola job lain), tidak pernah melempar.
    console.warn(`[SLOT OVERLAP] tenant=${tenantId} query dilewati:`, err?.message);
    return { overlappingGroups: 0, reservationCount: 0, alertSent: false, deduped: false };
  }

  // Kuota Bidan aktif dari DB (sumber tunggal). Gagal → null → audit kapasitas dilewati.
  let activeStaffCount: number | null = null;
  try {
    activeStaffCount = await prisma.staff.count({ where: { tenant_id: tenantId, active: true } });
  } catch (err: any) {
    console.warn(`[SLOT OVERLAP] tenant=${tenantId} hitung staf aktif dilewati:`, err?.message);
  }

  let overlaps: SlotOverlap[];
  try {
    overlaps = findOverlappingSlots(rows, { tenantId, activeStaffCount });
  } catch (err: any) {
    console.warn(`[SLOT OVERLAP] tenant=${tenantId} triase gagal:`, err?.message);
    return { overlappingGroups: 0, reservationCount: 0, alertSent: false, deduped: false };
  }

  if (overlaps.length === 0) {
    return { overlappingGroups: 0, reservationCount: 0, alertSent: false, deduped: false };
  }

  const overlappingGroups = overlaps.length;
  const reservationCount = overlaps.reduce((s, g) => s + g.reservationIds.length, 0);
  const severity = highestSeverity(overlaps);
  const cooldownMs = SLOT_OVERLAP_COOLDOWN_MS[severity];
  const fingerprint = computeOverlapFingerprint(overlaps, tenantId);
  const dedupPrefix = `slot_overlap:v1:${fingerprint}:${severity}:`;

  if (!(await shouldSendAlert(dedupPrefix, cooldownMs))) {
    return { overlappingGroups, reservationCount, alertSent: false, deduped: true };
  }

  const baseUrl = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000/admin';
  const { title, body } = formatOverlapAlert(overlaps, { baseUrl, activeStaffCount });
  // Deep-link ke hari tumpang jadwal paling awal agar kalender langsung ke tanggal itu.
  const focusDay = overlaps
    .map((o) => o.dayWib)
    .sort()[0];

  try {
    await webPushService.sendPushToRole(tenantId, 'ADMIN', {
      title,
      body,
      url: `/admin/reservations?date=${focusDay}`,
      tag: 'slot_overlap',
      data: { type: 'SLOT_OVERLAP', count: overlappingGroups, severity, dayWib: focusDay },
    });
  } catch (e: any) {
    console.warn('[SLOT OVERLAP] Web Push gagal:', e?.message);
  }

  try {
    await alertService.notifyAlert({
      type: AlertType.DAILY_OPS_REPORT,
      severity:
        severity === 'CRITICAL'
          ? AlertSeverity.CRITICAL
          : severity === 'WARNING'
            ? AlertSeverity.WARNING
            : AlertSeverity.INFO,
      tenantId,
      message: `[SLOT OVERLAP] ${body}`,
      metadata: {
        fingerprint,
        severity,
        types: [...new Set(overlaps.map((o) => o.type))],
        overlappingGroups,
        reservationCount,
        activeStaffCount,
        cooldownMs,
      },
    });
  } catch (e: any) {
    console.warn('[SLOT OVERLAP] alert gagal:', e?.message);
  }

  await recordSentAlert(dedupPrefix, `${dedupPrefix}${Date.now()}`, tenantId, overlaps[0].dayWib);

  return { overlappingGroups, reservationCount, alertSent: true, deduped: false };
}
