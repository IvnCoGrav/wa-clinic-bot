import { prisma } from '../db/client';
import { TreatmentCategory } from '@prisma/client';
import type { BabyDetail } from '../utils/reservation-text-parser';

/**
 * Canonical Reservation Domain Service — Single Source of Truth untuk SEMUA
 * mutasi reservasi (Admin Manual, Quick Hold, Bot State Machine, Webhook,
 * Agent Tool). Menggantikan 6 titik masuk yang sebelumnya langsung
 * `prisma.reservation.create` / deduplikasi sendiri-sendiri.
 *
 * Aturan kanal (channel-aware):
 * - ADMIN_PANEL: strict check → lempar ReservationConflictError (HTTP 409)
 *   kecuali `force: true` (override disengaja, wajib dicatat di audit_logs).
 * - BOT / WEBHOOK / AGENT: idempotent upsert & auto-konsolidasi duplikat.
 */

export type ReservationSource = 'ADMIN_PANEL' | 'BOT' | 'WEBHOOK' | 'AGENT';

export interface ReservationMutationParams {
  tenantId: string;
  customerId: string;
  chatId?: string;
  bookingDate?: Date | null;
  treatmentCategory?: TreatmentCategory | string | null;
  treatmentDetail?: string | null;
  durationMinutes?: number | null;
  assignedStaffId?: string | null;
  purchaseValue?: number | null;
  /** KB-6: snapshot ongkir saat booking (riwayat abadi). Null = tidak diubah. */
  deliveryFee?: number | null;
  rawText?: string;
  babies?: BabyDetail[];
  customerName?: string;
  kecamatan?: string;
  kota?: string;
  kelurahan?: string;
  address?: string;
  source: ReservationSource;
  /** Override disengaja dari admin (dashboard mengirim { force: true }). */
  force?: boolean;
  /** Status awal untuk jalur admin (default 'confirmed' / terjadwal). */
  status?: 'pending' | 'confirmed' | 'hold';
  /**
   * Stage 7 (R6): idempotency key per-tenant. Bila diisi dan sudah ada baris
   * dengan request_id sama → kembalikan baris itu (isNew:false) tanpa membuat
   * ganda. Dipakai jalur bot/webhook untuk retry-safe.
   */
  requestId?: string;
}

export interface ReservationResult {
  reservation: any;
  isNew: boolean;
  isUpdate: boolean;
  consolidatedCount?: number;
}

export class ReservationConflictError extends Error {
  statusCode = 409;
  code: 'DUPLICATE_BOOKING' | 'STAFF_COLLISION';
  existingReservation: any;
  constructor(code: 'DUPLICATE_BOOKING' | 'STAFF_COLLISION', existingReservation: any) {
    super(code === 'DUPLICATE_BOOKING' ? 'DUPLICATE_BOOKING' : 'STAFF_COLLISION');
    this.code = code;
    this.existingReservation = existingReservation;
  }
}

const ACTIVE_STATUSES = ['confirmed', 'en_route', 'hold'];
const WIB_OFFSET_MS = 7 * 3600000;

/** Error saat cek bentrok tidak dapat dijalankan (DB error) di production. */
export class ConflictCheckUnavailableError extends Error {
  public readonly code = 'CONFLICT_CHECK_UNAVAILABLE';
  public readonly statusCode = 503;
  constructor(scope: string, reason?: string) {
    super(`Cek bentrok ${scope} tidak tersedia: ${reason || 'DB error'}`);
  }
}

/** KB-3: kuota kapasitas harian (staf belum ditunjuk) terlampaui. */
export class CapacityExceededError extends Error {
  public readonly code = 'CAPACITY_EXCEEDED';
  public readonly statusCode = 409;
  public readonly capacity: number;
  public readonly booked: number;
  constructor(capacity: number, booked: number) {
    super(`CAPACITY_EXCEEDED (${booked}/${capacity})`);
    this.capacity = capacity;
    this.booked = booked;
  }
}

/**
 * A2 (KB-4): booking_date WAJIB. Reservasi tanpa tanggal = data sampah —
 * tidak bisa dicek bentrok/kuota, tidak bisa dijadwalkan, dan memicu
 * invariant CONFIRMED_NULL_DATE. Gerbang deterministik di lapisan data.
 */
export class MissingBookingDateError extends Error {
  public readonly code = 'MISSING_BOOKING_DATE';
  public readonly statusCode = 400;
  constructor() {
    super('MISSING_BOOKING_DATE');
  }
}

/**
 * A3: kunci serialisasi per (tenant + staf + hari WIB). Nilai deterministik
 * (FNV-1a → int32) sehingga dua permintaan pada slot yang sama memakai kunci
 * identik untuk `pg_advisory_xact_lock`. Staf null = grup `__unassigned__`
 * (melindungi race kuota KB-3). Murni & dapat diuji offline.
 */
export function computeAdvisoryLockKey(tenantId: string, staffId: string | null, bookingDate: Date): number {
  const wib = new Date(bookingDate.getTime() + WIB_OFFSET_MS);
  const dayKey = `${wib.getUTCFullYear()}-${wib.getUTCMonth() + 1}-${wib.getUTCDate()}`;
  const raw = `${tenantId}|${staffId || '__unassigned__'}|${dayKey}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

/** Error domain yang HARUS dilempar ke pemanggil (bukan alasan fallback lock). */
function isBusinessError(e: any): boolean {
  return (
    e instanceof ReservationConflictError ||
    e instanceof CapacityExceededError ||
    e instanceof ConflictCheckUnavailableError ||
    e instanceof MissingBookingDateError
  );
}

/**
 * KB-3: hitung jumlah terapis aktif tenant (data-driven dari tabel Staff).
 * DB offline → null (pemanggil memperlakukan sebagai "tidak diketahui").
 */
async function countActiveTherapists(tenantId: string): Promise<number | null> {
  try {
    const n = await prisma.staff.count({ where: { tenant_id: tenantId, active: true } });
    return typeof n === 'number' ? n : null;
  } catch {
    return null;
  }
}

/**
 * KB-2: beri tahu admin saat ada permintaan same-day (status pending +
 * penanda [SAME_DAY_REQUEST]) agar rutenya segera dicek. Best-effort,
 * tidak pernah melempar. Badge dashboard bersumber dari status pending.
 */
async function notifySameDayRequest(params: {
  tenantId: string;
  reservationId: string;
  customerName?: string;
  treatmentDetail?: string;
  bookingDate?: Date;
}): Promise<void> {
  const { tenantId, reservationId, customerName, treatmentDetail, bookingDate } = params;
  const title = '⏰ Permintaan Jadwal HARI INI';
  const body = `${customerName || 'Bunda'} — ${treatmentDetail || 'Treatment'}${bookingDate ? ` @ ${bookingDate.toISOString().slice(11, 16)}Z` : ''}. Mohon cek ketersediaan rute terapis.`;
  try {
    const { webPushService } = await import('./web-push.service');
    await webPushService.sendPushToRole(tenantId, 'ADMIN', {
      title,
      body,
      url: '/admin/reservations',
      tag: `same_day_${reservationId}`,
      data: { reservationId, type: 'SAME_DAY_REQUEST' },
    });
  } catch (e: any) {
    console.warn('[RESERVATION CORE] KB-2 Web Push same-day gagal:', e?.message);
  }
  try {
    const { alertService, AlertType, AlertSeverity } = await import('./alert.service');
    await alertService.notifyAlert({
      type: AlertType.MEDICAL_CONCERN_MEDIUM,
      severity: AlertSeverity.WARNING,
      tenantId,
      message: `Permintaan jadwal HARI INI: ${body}`,
      metadata: { reservationId, type: 'SAME_DAY_REQUEST' },
    });
  } catch (e: any) {
    console.warn('[RESERVATION CORE] KB-2 alert same-day gagal:', e?.message);
  }
}

/**
 * KB-3: gerbang kuota kapasitas harian untuk booking yang BELUM punya staf.
 * Batas = jumlah terapis aktif pada tenant tsb. Menghitung reservasi aktif
 * (confirmed/pending/hold) hari WIB yang sama dengan assigned_staff_id NULL.
 * Return true bila MASIH ada kapasitas; false bila penuh.
 * DB error → true (fail-open + alert) agar operasional tidak berhenti.
 */
async function hasCapacityForUnassignedBooking(tenantId: string, bookingDate: Date, db: any = prisma): Promise<boolean> {
  const capacity = await countActiveTherapists(tenantId);
  if (capacity === null) {
    reportConflictCheckDegraded('customer', tenantId, 'staff.count gagal (kuota KB-3 dilewati)');
    return true;
  }
  if (capacity <= 0) return false;
  const { dayStart, dayEnd } = getWibCalendarDayBounds(bookingDate);
  try {
    const booked = await db.reservation.count({
      where: {
        tenant_id: tenantId,
        assigned_staff_id: null,
        status: { in: ['confirmed', 'en_route', 'pending', 'hold'] },
        booking_date: { gte: dayStart, lte: dayEnd },
      },
    });
    return (booked || 0) < capacity;
  } catch {
    return true;
  }
}

/**
 * 173d: cek bentrok yang gagal (DB error) DILARANG senyap.
 * - production → fail-CLOSED: throw agar reservasi ditolak (lebih aman daripada
 *   meloloskan double-booking tanpa validasi).
 * - non-production (dev/test) → fail-open + alert, agar suite offline tetap jalan.
 */
function reportConflictCheckDegraded(scope: 'customer' | 'staff', tenantId: string, reason?: string): void {
  const msg = `[RESERVATION CORE] Cek bentrok ${scope} DEGRADASI tenant=${tenantId}: ${reason || 'unknown'}`;
  console.warn(msg);
  import('./alert.service')
    .then(({ alertService, AlertType, AlertSeverity }) =>
      alertService.notifyAlert({
        type: AlertType.DATABASE_OFFLINE,
        severity: AlertSeverity.WARNING,
        tenantId,
        message: `Cek bentrok ${scope} gagal (DB error). ${process.env.NODE_ENV === 'production' ? 'Reservasi DITOLAK (fail-closed).' : 'Reservasi diloloskan tanpa validasi (non-production).'}`,
        metadata: { scope, reason },
      })
    )
    .catch(() => {});
  if (process.env.NODE_ENV === 'production') {
    throw new ConflictCheckUnavailableError(scope, reason);
  }
}

/**
 * A3: jalankan mutasi di dalam `pg_advisory_xact_lock` per (tenant+staf+hari)
 * untuk menutup race condition check-then-insert double-booking.
 *
 * Fail-open deterministik: bila `$transaction`/`$executeRawUnsafe` tidak
 * tersedia (mock test offline / driver Accelerate) → jalankan `work()` langsung
 * tanpa lock (perilaku lama, aman untuk suite offline). Bila lock GAGAL
 * diakuisisi, `work()` dijalankan sekali di luar transaksi; bila `work()` sendiri
 * yang gagal, error diteruskan TANPA diulang (cegah efek samping ganda).
 */
async function runWithAdvisoryLock<T>(key: number, work: (tx: any) => Promise<T>): Promise<T> {
  const prismaAny = prisma as any;
  if (typeof prismaAny.$transaction !== 'function' || typeof prismaAny.$executeRawUnsafe !== 'function') {
    return work(prisma);
  }
  let entered = false;
  try {
    return await prismaAny.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1)', key);
      entered = true;
      return work(tx);
    });
  } catch (e: any) {
    if (entered) throw e; // error berasal dari work() → teruskan, jangan ulang.
    if (isBusinessError(e)) throw e;
    return work(prisma); // lock tak tersedia → fallback tanpa lock.
  }
}

function getWibCalendarDayBounds(date: Date): { dayStart: Date; dayEnd: Date } {
  const utcTime = date.getTime();
  const wibTime = new Date(utcTime + WIB_OFFSET_MS);
  const year = wibTime.getUTCFullYear();
  const month = wibTime.getUTCMonth();
  const day = wibTime.getUTCDate();
  const dayStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - WIB_OFFSET_MS);
  const dayEnd = new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - WIB_OFFSET_MS);
  return { dayStart, dayEnd };
}

function effectiveDuration(v: unknown, fallback = 60): number {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return fallback;
  return Math.min(480, Math.max(15, Math.round(n)));
}

function intervalsOverlap(aStart: Date, aMins: number, bStart: Date, bMins: number): boolean {
  const aEnd = aStart.getTime() + aMins * 60000;
  const bEnd = bStart.getTime() + bMins * 60000;
  return aStart.getTime() < bEnd && aStart.getTime() + aMins * 60000 > bStart.getTime() && aEnd > bStart.getTime() && bStart.getTime() < aEnd;
}

async function findOverlappingCustomerReservations(params: {
  tenantId: string;
  customerId: string;
  bookingDate: Date;
  durationMinutes: number;
  excludeId?: string;
  db?: any;
}): Promise<{ exactConflicts: any[]; sameDayReservations: any[] }> {
  const { tenantId, customerId, bookingDate, durationMinutes } = params;
  const db = params.db || prisma;
  const { dayStart, dayEnd } = getWibCalendarDayBounds(bookingDate);
  let candidates: any[] = [];
  try {
    candidates = await db.reservation.findMany({
      where: {
        tenant_id: tenantId,
        customer_id: customerId,
        status: { in: ACTIVE_STATUSES },
        booking_date: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { booking_date: 'asc' },
    });
  } catch (err: any) {
    // 173d: JANGAN senyap. Cek bentrok degradasi (fail-open) → log + alert agar
    // operator tahu ada risiko double-booking yang tidak tervalidasi.
    reportConflictCheckDegraded('customer', tenantId, err?.message);
    return { exactConflicts: [], sameDayReservations: [] };
  }
  const activeCandidates = (candidates || []).filter((r: any) => {
    if (!r.booking_date) return false;
    if (params.excludeId && r.id === params.excludeId) return false;
    return true;
  });
  const exactConflicts = activeCandidates.filter((r: any) => {
    const existingStart = new Date(r.booking_date);
    const existingDur = effectiveDuration((r as any).duration_minutes, 60);
    return intervalsOverlap(bookingDate, durationMinutes, existingStart, existingDur);
  });
  return { exactConflicts, sameDayReservations: activeCandidates };
}

/**
 * Hitung transaksi riwayat customer (kanonis patient-lifecycle: `confirmed` ATAU
 * `completed`) untuk menentukan status new vs repeat order. `excludeId` dipakai
 * pada jalur update agar reservasi yang sedang diedit tidak menghitung dirinya.
 * Fail-safe: DB offline → dianggap new (false) agar operasi inti tak pernah gagal.
 */
async function computeIsRepeatOrder(params: {
  tenantId: string;
  customerId: string;
  excludeId?: string;
  db?: any;
}): Promise<boolean> {
  const { tenantId, customerId, excludeId } = params;
  const db = params.db || prisma;
  try {
    const priorConfirmedCount = await db.reservation.count({
      where: {
        customer_id: customerId,
        tenant_id: tenantId,
        status: { in: ['confirmed', 'en_route', 'completed'] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    return priorConfirmedCount > 0;
  } catch {
    return false;
  }
}

export async function findOverlappingStaffReservations(params: {
  tenantId: string;
  staffId: string;
  bookingDate: Date;
  durationMinutes: number;
  excludeId?: string;
  /** A3: bila diberikan (dalam transaksi lock), query memakai handle `tx`. */
  db?: any;
}): Promise<any[]> {
  const { tenantId, staffId, bookingDate, durationMinutes } = params;
  const db = params.db || prisma;
  // Kontrak durasi TUNGGAL (audit Fase 3.1): `duration_minutes` = TOTAL menit
  // terjadwal SUDAH termasuk 1x buffer transisi 20 menit. Backend DILARANG
  // menambah buffer lagi (sebelumnya 60 → 80 frontend → 100 backend = 409 palsu).
  //
  // FIX R2.1 (H5 silent staff collision): window sempit [bookingDate ± durasi]
  // TIDAK menangkap booking panjang yang MULAI sebelum windowStart namun
  // bertabrakan (mis. existing 08:00-10:00 vs new 09:30-10:00 → 0 konflik).
  // Ambil seluruh hari kalender WIB (mirror findOverlappingCustomerReservations),
  // lalu saring irisan presisi di memori via intervalsOverlap.
  const { dayStart, dayEnd } = getWibCalendarDayBounds(bookingDate);
  let candidates: any[] = [];
  try {
    candidates = await db.reservation.findMany({
      where: {
        tenant_id: tenantId,
        assigned_staff_id: staffId,
        status: { in: ACTIVE_STATUSES },
        booking_date: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { booking_date: 'asc' },
    });
  } catch (err: any) {
    // 173d: JANGAN senyap. Degradasi cek bentrok staf (fail-open) → log + alert.
    reportConflictCheckDegraded('staff', tenantId, err?.message);
    return [];
  }
  return (candidates || []).filter((r: any) => {
    if (!r.booking_date) return false;
    if (params.excludeId && r.id === params.excludeId) return false;
    const existingStart = new Date(r.booking_date);
    // Kontrak tunggal: durasi tersimpan SUDAH termasuk buffer — bandingkan apa adanya.
    const existingDur = effectiveDuration((r as any).duration_minutes, 60);
    return intervalsOverlap(bookingDate, durationMinutes, existingStart, existingDur);
  });
}

/**
 * KB-6: resolver ongkir per-reservasi — utamakan snapshot `delivery_fee`,
 * fallback ke `Customer.ongkir` untuk baris lama (pra-migrasi).
 */
export function resolveDeliveryFeeSnapshot(reservation: any): number {
  const snap = (reservation as any)?.delivery_fee;
  if (typeof snap === 'number' && snap >= 0) return snap;
  const legacy = (reservation as any)?.customer?.ongkir ?? (reservation as any)?.ongkir;
  if (typeof legacy === 'number' && legacy >= 0) return legacy;
  return 0;
}

export class ReservationCoreService {
  async saveReservation(params: ReservationMutationParams): Promise<ReservationResult> {
    const {
      tenantId,
      customerId,
      chatId = '',
      bookingDate = null,
      treatmentCategory,
      treatmentDetail,
      durationMinutes,
      assignedStaffId,
      purchaseValue,
      rawText,
      babies = [],
      customerName,
      kecamatan,
      kota,
      kelurahan,
      address,
      source,
      force = false,
      status = 'confirmed',
      requestId,
      deliveryFee,
    } = params;

    // A2 (KB-4): booking_date WAJIB untuk JALUR CUSTOMER (BOT/AGENT) — gerbang
    // deterministik fondasional. DILARANG menyimpan booking customer tanpa
    // tanggal (tidak bisa cek bentrok/kuota, tidak bisa dijadwalkan, memicu
    // invariant CONFIRMED_NULL_DATE). Ditaruh SEBELUM idempotency agar permintaan
    // tak bertanggal tidak "menyamar" jadi hit request_id.
    //
    // CHANNEL-AWARE: jalur ADMIN_PANEL / WEBHOOK (auto-capture admin-outbound)
    // SAH melakukan intake tanpa tanggal — admin melengkapi tanggal menyusul
    // (mis. tombol set-date). Baris intake dipaksa status 'pending' agar tidak
    // pernah menjadi `confirmed` tanpa tanggal (anti INV1), lalu di-dedup 24 jam.
    const hasValidDate = Boolean(bookingDate && !isNaN((bookingDate as Date).getTime()));
    const isCustomerChannel = source === 'BOT' || source === 'AGENT';
    if (!hasValidDate && isCustomerChannel) {
      throw new MissingBookingDateError();
    }
    // Status efektif: intake tanpa tanggal TIDAK BOLEH 'confirmed'/'hold'.
    const bookingStatus: 'pending' | 'confirmed' | 'hold' = hasValidDate ? status : 'pending';

    // Single Source of Truth: durasi NULL diresolve via katalog kanonis agar DB
    // tidak menyimpan NULL saat nama layanan valid. Anti-fabrikasi: angka hasil
    // resolve HANYA dipersist bila seluruh item dikenali katalog / tag eksplisit —
    // teks tak dikenali dibiarkan null (UI memakai estimasi tampilan).
    let duration = durationMinutes != null ? effectiveDuration(durationMinutes, 60) : null;
    if (duration == null && treatmentDetail && treatmentDetail.trim()) {
      try {
        const { treatmentCatalogService } = await import('./treatment-catalog.service');
        const breakdown = treatmentCatalogService.resolveDurationBreakdown(treatmentDetail, tenantId);
        if (breakdown.confident || breakdown.usedExplicitTag) {
          duration = effectiveDuration(breakdown.totalMinutes, 60);
        }
      } catch {
        duration = null;
      }
    }
    const validCategory = ((treatmentCategory as TreatmentCategory) || TreatmentCategory.BABY) as TreatmentCategory;
    // Fase 4.1: tandai booking di luar jam operasional (jam FLEKSIBEL — tidak
    // ditolak, hanya diberi ekspektasi + badge dashboard agar bidan menyanggupi).
    let outsideHoursTag = '';
    if (bookingDate && !isNaN(bookingDate.getTime())) {
      try {
        const { getOperationalHours, isOutsideOperationalHours } = await import('../config/operational-hours');
        const hours = await getOperationalHours(tenantId);
        if (isOutsideOperationalHours(bookingDate, hours)) outsideHoursTag = '[OUTSIDE_HOURS] Perlu konfirmasi bidan (di luar jam operasional)\n';
      } catch {}
    }
    const effectiveRawText =
      `${outsideHoursTag}${rawText ||
      `[RESERVATION:${source}] ${treatmentDetail || '-'} | ${bookingDate ? bookingDate.toISOString().slice(0, 10) : '-'} | ${customerName || '-'}`}`;

    // A3: baca-cek + tulis kritis (idempotency, cek bentrok, merge/create) dijalankan
    // di dalam advisory lock per (tenant+staf+hari WIB) — menutup race check-then-insert
    // double-booking. Efek samping (lifecycle/follow-up/notifikasi) dijalankan SETELAH
    // commit agar transaksi interaktif tidak tertahan (cegah timeout → rollback).
    const lockKey = computeAdvisoryLockKey(tenantId, assignedStaffId || null, hasValidDate ? (bookingDate as Date) : new Date());
    type SaveOutcome = { mode: 'idempotent' | 'reactivated' | 'merged' | 'created'; result: ReservationResult };

    const outcome = await runWithAdvisoryLock<SaveOutcome>(lockKey, async (db) => {
    // Stage 7 (R6): idempotency — bila request_id sudah pernah tersimpan untuk
    // tenant ini, kembalikan baris yang ada (retry webhook / concurrency aman).
    if (requestId && requestId.trim().length > 0) {
      try {
        const existingByRequest = await db.reservation.findFirst({
          where: { tenant_id: tenantId, request_id: requestId },
        });
        if (existingByRequest) {
          // FIX R2.3 (H9): baris `cancelled` menyimpan request_id sehingga
          // re-booking dengan kunci identik sebelumnya mengembalikan baris mati
          // (false success tanpa reservasi aktif). Reaktivasi ke status diminta.
          if (existingByRequest.status === 'cancelled') {
            const reactivated = await db.reservation.update({
              where: { id: existingByRequest.id },
              data: {
                status: bookingStatus,
                // Intake tanpa tanggal: pertahankan tanggal lama (jangan null-kan).
                booking_date: hasValidDate ? bookingDate : (existingByRequest as any).booking_date,
                assigned_staff_id:
                  assignedStaffId !== undefined ? assignedStaffId || null : existingByRequest.assigned_staff_id,
                duration_minutes: duration ?? (existingByRequest as any).duration_minutes ?? null,
                // Intake tanpa tanggal TIDAK boleh masuk jalur schedule-check.
                ...(hasValidDate ? {} : { pendingScheduleCheck: false }),
                // KB-6: snapshot ongkir ikut direaktivasi bila diberikan eksplisit.
                ...(deliveryFee !== undefined && deliveryFee !== null ? { delivery_fee: deliveryFee } : {}),
              },
            });
            console.log(`[RESERVATION CORE] Reactivated cancelled reservation ${existingByRequest.id} via request_id=${requestId}.`);
            return { mode: 'reactivated', result: { reservation: reactivated, isNew: false, isUpdate: true } };
          }
          console.log(`[RESERVATION CORE] Idempotent hit request_id=${requestId} → reservation ${existingByRequest.id}.`);
          return { mode: 'idempotent', result: { reservation: existingByRequest, isNew: false, isUpdate: false } };
        }
      } catch {
        // DB offline → lanjut ke jalur normal (fallback).
      }
    }

    // --- Validasi 1 & 2: hanya bermakna bila ada bookingDate ---
    if (bookingDate && !isNaN(bookingDate.getTime())) {
      const durForCheck = duration ?? 60;

      // KB-3: gerbang kuota kapasitas harian. Berlaku untuk booking TANPA staf
      // dari jalur otomatis (BOT/AGENT) — mencegah bot menumpuk reservasi
      // confirmed tanpa terapis. Admin panel dikecualikan (admin menugaskan manual).
      if ((source === 'BOT' || source === 'AGENT') && !assignedStaffId && !force) {
        const ok = await hasCapacityForUnassignedBooking(tenantId, bookingDate, db);
        if (!ok) {
          const capacity = (await countActiveTherapists(tenantId)) ?? 0;
          throw new CapacityExceededError(capacity, capacity);
        }
      }

       const { exactConflicts, sameDayReservations } = await findOverlappingCustomerReservations({
         tenantId,
         customerId,
         bookingDate,
         durationMinutes: durForCheck,
         db,
       });

       const confirmedSameDay = sameDayReservations.filter((r: any) => r.status !== 'hold');
       const holdSameDay = sameDayReservations.filter((r: any) => r.status === 'hold');
       const customerSameDayActive = sameDayReservations.length > 0;

       // Kasus 1: Konflik Nyata ADMIN_PANEL — customer SUDAH memiliki reservasi 'confirmed' hari ini
       if (source === 'ADMIN_PANEL' && !force && confirmedSameDay.length > 0) {
         throw new ReservationConflictError('DUPLICATE_BOOKING', exactConflicts.find((r: any) => r.status === 'confirmed') || confirmedSameDay[0]);
       }

       // Validasi bentrok terapis (jika ada assignedStaffId)
       if (assignedStaffId) {
         const staffConflicts = await findOverlappingStaffReservations({
           tenantId,
           staffId: assignedStaffId,
           bookingDate,
           durationMinutes: durForCheck,
           excludeId: sameDayReservations[0]?.id,
           db,
         });
        if (staffConflicts.length > 0 && !force) {
            throw new ReservationConflictError('STAFF_COLLISION', staffConflicts[0]);
          }
       }

        // P2-4: kunci sempit (slot+treatment) — hanya merge bila interval tumpang tindih
        // (exactConflicts), bukan semua same-day. Mencegah booking pagi+sore beda treatment saling timpa.
        // Pengecualian fondasional: primary HOLD placeholder ('[HOLD] ...' / status hold) adalah wildcard —
        // upgrade hold→confirmed SELALU mengganti teks placeholder dengan treatment riil, jadi equality
        // string tidak pernah terpenuhi. Tanpa ini P2-4 me-regresi jalur auto-upgrade kasus (a) di bawah.
        const primaryDetail = sameDayReservations[0]?.treatment_detail || '';
        const primaryIsHoldPlaceholder =
          sameDayReservations[0]?.status === 'hold' || /\[HOLD\]/i.test(primaryDetail);
        const sameTreatment = Boolean(
          treatmentDetail && (primaryDetail === treatmentDetail || primaryIsHoldPlaceholder)
        );
        // KEPUTUSAN PRODUCT OWNER (dikunci): kanal otomatis (BOT / AGENT /
        // WEBHOOK) memperlakukan form berulang pada HARI KALENDER yang sama
        // sebagai pemBARUAN reservasi yang sama — update baris lama, walau
        // redaksi treatment sedikit berbeda. Mencegah duplikat slot (kasus
        // Bunda Detya/Ismail). ADMIN_PANEL tetap butuh `force` (series manual).
        const isAutomatedChannel = source === 'BOT' || source === 'AGENT' || source === 'WEBHOOK';
        const shouldMerge = exactConflicts.length > 0 && (sameTreatment || !treatmentDetail || isAutomatedChannel);
        const automatedSameDayMerge = isAutomatedChannel && customerSameDayActive;
        if (shouldMerge || automatedSameDayMerge || (customerSameDayActive && sameTreatment)) {
          if (source === 'ADMIN_PANEL' && force) {
            console.log(
              `[RESERVATION CORE] Force override: admin membuat reservasi baru meski ${exactConflicts.length} konflik menit & ${sameDayReservations.length} same-day active.`,
              `customer=${customerId} date=${bookingDate.toISOString()}`
            );
          } else {
            // Berlaku untuk:
            // a) ADMIN_PANEL saat customer HANYA punya hold (confirmedSameDay.length === 0 & holdSameDay.length > 0)
            //    -> Auto-upgrade slot hold milik customer tersebut menjadi confirmed!
            // b) BOT / WEBHOOK / AGENT -> Idempotent merge hanya bila slot & treatment sama
            const primary = sameDayReservations[0];
           const duplicates = sameDayReservations.slice(1);
           const targetStatus = status || 'confirmed';

           const isRepeatOrder = await computeIsRepeatOrder({
             tenantId,
             customerId,
             excludeId: primary.id,
             db,
           });

            const updated = await db.reservation.update({
              where: { id: primary.id },
              data: {
                status: targetStatus,
                treatment_category: (treatmentCategory as TreatmentCategory) || primary.treatment_category,
                treatment_detail: treatmentDetail !== undefined ? treatmentDetail : primary.treatment_detail,
                booking_date: bookingDate,
                duration_minutes: duration ?? (primary as any).duration_minutes ?? null,
                assigned_staff_id: assignedStaffId !== undefined ? assignedStaffId || null : primary.assigned_staff_id,
                raw_text: effectiveRawText,
                purchase_value: purchaseValue !== undefined && purchaseValue !== null ? purchaseValue : primary.purchase_value,
                is_repeat_order: isRepeatOrder,
                // KB-6: snapshot ongkir bila diberikan eksplisit.
                ...(deliveryFee !== undefined && deliveryFee !== null ? { delivery_fee: deliveryFee } : {}),
              },
            });

           let consolidatedCount = 0;
           for (const dup of duplicates) {
             try {
               await db.reservation.update({ where: { id: dup.id }, data: { status: 'cancelled' } });
               consolidatedCount++;
             } catch {}
           }
           if (consolidatedCount > 0) {
             console.log(`[RESERVATION CORE] Auto-consolidated ${consolidatedCount} duplicate(s) for customer ${customerId} (kept ${primary.id}).`);
           }

           // Efek samping dijalankan SETELAH commit (di luar closure) — lihat postActions.
           return {
             mode: 'merged',
             result: { reservation: updated, isNew: false, isUpdate: true, consolidatedCount },
           };
         }
       }
    }

    // --- Tidak ada konflik: buat baru. ---
    // A2: jalur customer (BOT/AGENT) SELALU punya tanggal (dijamin gerbang atas).
    // Jalur admin/webhook tanpa tanggal = intake: dipaksa 'pending' (bookingStatus)
    // dan di-dedup 24 jam agar tidak menumpuk baris pending untuk 1 customer.
    if (!hasValidDate) {
      let recentPending: any = null;
      try {
        recentPending = await db.reservation.findFirst({
          where: {
            customer_id: customerId,
            tenant_id: tenantId,
            booking_date: null,
            created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            status: { notIn: ['cancelled', 'rejected', 'completed'] },
          },
          orderBy: { created_at: 'desc' },
        });
      } catch {
        recentPending = null;
      }
      if (recentPending) {
        const updated = await db.reservation.update({
          where: { id: recentPending.id },
          data: {
            treatment_category: validCategory,
            treatment_detail: treatmentDetail !== undefined ? treatmentDetail : recentPending.treatment_detail,
            raw_text: effectiveRawText,
            purchase_value: purchaseValue !== undefined ? purchaseValue : recentPending.purchase_value,
            duration_minutes: duration ?? recentPending.duration_minutes ?? null,
            assigned_staff_id: assignedStaffId !== undefined ? assignedStaffId || null : recentPending.assigned_staff_id,
            ...(deliveryFee !== undefined && deliveryFee !== null ? { delivery_fee: deliveryFee } : {}),
          },
        });
        return { mode: 'merged', result: { reservation: updated, isNew: false, isUpdate: true } };
      }
    }

    const isRepeatOrder = await computeIsRepeatOrder({ tenantId, customerId, db });
    const createData: any = {
      tenant_id: tenantId,
      customer_id: customerId,
      treatment_category: validCategory,
      treatment_detail: treatmentDetail,
      booking_date: hasValidDate ? bookingDate : null,
      duration_minutes: duration,
      assigned_staff_id: assignedStaffId || null,
      raw_text: effectiveRawText,
      status: bookingStatus,
      purchase_value: purchaseValue ?? null,
      // KB-6: snapshot ongkir saat booking (riwayat abadi).
      delivery_fee: deliveryFee ?? null,
      is_repeat_order: isRepeatOrder,
      request_id: requestId && requestId.trim().length > 0 ? requestId : null,
      // CG-05 (opsi flag): bot/agent non-same-day berstatus confirmed = slot
      // belum diverifikasi staf → tandai agar admin memverifikasi.
      needs_staff_verification: source !== 'ADMIN_PANEL' && bookingStatus === 'confirmed',
      // Intake tanpa tanggal TIDAK boleh masuk jalur schedule-check.
      ...(hasValidDate ? {} : { pendingScheduleCheck: false }),
    };
    // Create di dalam transaksi/lock (A3). Bila gagal → pemanggil memutuskan
    // fallback in-memory (admin routes punya fallback).
    const created = await db.reservation.create({ data: createData });
    if (!created) throw new Error('Gagal membuat reservasi (hasil kosong).');
    return { mode: 'created', result: { reservation: created, isNew: true, isUpdate: false } };
    }); // akhir runWithAdvisoryLock (A3)

    // === Efek samping pasca-commit (di luar lock; best-effort) ===
    const reservation = outcome.result.reservation;

    if (outcome.mode === 'merged' || outcome.mode === 'created') {
      const { reservationLifecycleService } = await import('./reservation-lifecycle.service');
      await reservationLifecycleService.onReservationCreated({
        customerId, reservationId: reservation.id, tenantId, chatId, babies,
        customerName, kecamatan, kota, kelurahan: kelurahan || undefined, address,
      });
    }

    // KB-2: same-day request (status pending + penanda [SAME_DAY_REQUEST]) →
    // beri tahu admin segera (Web Push + Telegram) agar dicek rutenya. Badge di
    // dashboard bersumber dari status 'pending'; hilang otomatis begitu admin
    // mengubah status (confirm/cancel).
    if (
      ((reservation as any).status === 'pending' || status === 'pending') &&
      /\[SAME_DAY_REQUEST\]/i.test((reservation as any).raw_text || effectiveRawText)
    ) {
      notifySameDayRequest({
        tenantId,
        reservationId: reservation.id,
        customerName: customerName || undefined,
        treatmentDetail: treatmentDetail || undefined,
        bookingDate: bookingDate || undefined,
      }).catch(() => {});
    }

    // Follow-up otomatis untuk reservasi confirmed (efek samping terstandarisasi).
    if ((reservation as any).status === 'confirmed' && bookingDate) {
      try {
        const { followUpService } = await import('./follow-up.service');
        await followUpService.createReservationFollowUps({
          reservationId: reservation.id,
          customerId,
          bookingDate,
          treatmentCategory: validCategory,
          tenantId,
        });
      } catch (fuErr: any) {
        console.warn('[RESERVATION CORE] Failed to create follow-ups:', fuErr.message);
      }
    }

    return outcome.result;
  }
}

export const reservationCoreService = new ReservationCoreService();
