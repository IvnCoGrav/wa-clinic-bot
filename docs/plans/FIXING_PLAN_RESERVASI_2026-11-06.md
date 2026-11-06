# Rencana Perbaikan Reservasi — Staged Micro-Task Plan

- Tanggal: 2026-11-06
- Dasar: `docs/audit/2026-11-06/LAPORAN_AUDIT_RESERVASI.md` (11 temuan)
- Sifat: **rencana saja — belum ada eksekusi kode**
- Prinsip: fondasional (state machine, kontrak data, seam tunggal), tanpa solusi kosmetik, tanpa dependency runtime baru, tanpa hardcode data bisnis.

---

## 0. Ringkasan Fase & Dependensi

| Fase | Fokus | Temuan | Blast radius | Prasyarat |
|---|---|---|---|---|
| 0 | Test merah (reproduksi) + baseline | semua | rendah (test only) | — |
| 1 | Seam transisi status kanonis | A-001, A-002, A-011 | **tinggi** (route + service) | Fase 0 |
| 2 | Satukan definisi hold & status aktif | A-003, A-007, A-015 | sedang (cron + core) | Fase 1 |
| 3 | Series memakai lock + cek bentrok + alamat + items | A-004 | tinggi (service) | Fase 1, 2 |
| 4 | Snapshot & restore arsip lengkap | A-005 | sedang (arsip) | Fase 1 |
| 5 | Advisory lock fail-closed | A-006 | sedang (core) | Fase 2 |
| 6 | Invoice memakai seam alamat | A-008 | rendah (dashboard util) | — |
| 7 | Tool masking anaphora dibatasi | A-009 | sedang (V3 tool) | — |
| 8 | Idempotency admin + koreksi dokumen/kontrak | A-010, A-012, A-013, A-014 | rendah | Fase 1 |
| 9 | Verifikasi penuh + catat KNOWN_ISSUES | — | — | semua |

**Aturan gate:** setiap fase ditutup `npm run build` + test terkait hijau + tidak ada failure baru di suite penuh. Klaim "pre-existing" wajib dibuktikan revert-and-rerun.

---

## 0.1 Keputusan yang Harus Diambil Sebelum Eksekusi

| ID | Pertanyaan | Rekomendasi | Dampak bila salah |
|---|---|---|---|
| D1 | Apakah `completed` boleh dibatalkan? | **Tidak.** Koreksi lewat endpoint terpisah `POST /:id/reopen` dengan audit + alasan, bukan soft-cancel | Soft-cancel saat ini bisa merusak laporan pendapatan |
| D2 | Apakah `pending` menempati slot bidan? | **Ya**, selaras `ACTIVE_RESERVATION_STATUSES` | Slot ganda bila `pending` diabaikan |
| D3 | Apakah `paused` menjadi status resmi reservasi? | **Ya**, status non-aktif first-class | Status zombie di luar FSM & filter dashboard |
| D4 | Apakah treatment boleh diambil dari pesan asisten? | **Hanya** dari pesan asisten terakhir dan tepat **satu** layanan, tetap wajib sinyal komitmen user | Salah paket bila asisten menyebut beberapa layanan |

Tanpa keputusan tertulis untuk D1–D4, Fase 1 dan 3 tidak boleh dieksekusi.

---

## Fase 0 — Test Merah & Baseline

**Tujuan:** membuktikan setiap bug dengan test yang gagal sebelum kode diubah (TDD), dan merekam baseline suite.

### Mikro-task

| ID | File | Tindakan | Acceptance |
|---|---|---|---|
| 0.1 | `tests/unit/reservation-status-transition.test.ts` (baru) | Test: `completed → cancelled` via `DELETE ?soft=true` harus **409** | Test gagal di kode saat ini |
| 0.2 | `tests/unit/reservation-status-transition.test.ts` | Test: `staff completeTask` pada `hold` dan pada booking H+7 harus **ditolak** | Gagal di kode saat ini |
| 0.3 | `tests/unit/expired-hold-sweep-window.test.ts` (baru) | Test: cutoff = `now − 2 jam`, bukan tengah malam | Gagal di kode saat ini |
| 0.4 | `tests/unit/reservation-series-core-gates.test.ts` (baru) | Test: series dengan customer yang sudah punya booking di slot sama → `DUPLICATE_BOOKING` | Gagal di kode saat ini |
| 0.5 | `tests/integration/reservation-archive-restore-v2.test.ts` (baru) | Test: restore mempertahankan `duration_minutes`, `purchase_occurred_at`, dan follow-up | Gagal di kode saat ini |
| 0.6 | `tests/unit/advisory-lock-fail-closed.test.ts` (baru) | Test: `NODE_ENV=production` + lock error → throw `ConflictCheckUnavailableError` | Gagal di kode saat ini |
| 0.7 | `tests/unit/payment-invoice-address-card.test.ts` (baru) | Test: kartu reservasi A vs profil B → invoice memakai A | Gagal di kode saat ini |
| 0.8 | `scripts`/terminal | Rekam baseline: `npx vitest run --reporter=json --outputFile=docs/audit/2026-11-06/baseline-before.json` | File baseline ada |

### Perintah

```powershell
npx vitest run tests/unit/reservation-status-transition.test.ts tests/unit/expired-hold-sweep-window.test.ts tests/unit/reservation-series-core-gates.test.ts tests/integration/reservation-archive-restore-v2.test.ts tests/unit/advisory-lock-fail-closed.test.ts tests/unit/payment-invoice-address-card.test.ts --reporter=verbose
```

**Gate 0:** semua test baru **merah** karena alasan yang benar (bukan error sintaks).

---

## Fase 1 — Seam Transisi Status Kanonis (A-001, A-002, A-011)

**Tujuan:** satu otoritas validasi + satu jalur tulis status. Tidak ada `prisma.reservation.update({ data: { status } })` liar.

### 1.1 Buat service baru

**File baru:** `src/services/reservation-status.service.ts`

```ts
import { prisma } from '../db/client';
import { canTransition, isPrematureCompletion } from '../domain/reservation-status';

export class InvalidTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION';
  readonly statusCode = 409;
  constructor(public readonly from: string, public readonly to: string) {
    super(`Transisi ${from} → ${to} ditolak.`);
    this.name = 'InvalidTransitionError';
  }
}

export class PrematureCompletionError extends Error {
  readonly code = 'PREMATURE_COMPLETION';
  readonly statusCode = 409;
  constructor() {
    super('Reservasi masa depan tidak dapat ditandai completed sebelum tanggal kunjungan tiba.');
    this.name = 'PrematureCompletionError';
  }
}

export class ReservationStatusService {
  async getForTransition(id: string, tenantId: string) {
    return prisma.reservation.findFirst({ where: { id, tenant_id: tenantId } });
  }

  async applyTransition(
    existing: { id: string; status: string; booking_date?: Date | string | null; assigned_staff_id?: string | null },
    opts: {
      to: string;
      force?: boolean;
      allowUnassignedStaff?: boolean;
      allowIllegal?: boolean;
      extraData?: Record<string, unknown>;
      include?: Record<string, unknown>;
    }
  ): Promise<
    | { ok: true; reservation: any }
    | { ok: false; reason: 'STAFF_REQUIRED' }
  > {
    if (!opts.allowIllegal && !canTransition(existing.status, opts.to)) {
      throw new InvalidTransitionError(existing.status, opts.to);
    }
    if (opts.to === 'completed') {
      if (isPrematureCompletion(existing.booking_date) && !opts.force) {
        throw new PrematureCompletionError();
      }
      if (!existing.assigned_staff_id && !opts.allowUnassignedStaff) {
        return { ok: false, reason: 'STAFF_REQUIRED' };
      }
    }
    const reservation = await prisma.reservation.update({
      where: { id: existing.id },
      data: { status: opts.to, ...(opts.extraData || {}) } as any,
      ...(opts.include ? { include: opts.include as any } : {}),
    });
    return { ok: true, reservation };
  }
}

export const reservationStatusService = new ReservationStatusService();
```

### 1.2 Ganti `completeReservationById`

**File:** `src/routes/admin/reservation-dispatch.route.ts:73-129`

Ganti blok validasi + update dengan:

```ts
const existing = await reservationStatusService.getForTransition(opts.id, opts.tenantId);
if (!existing) return { ok: false, reason: 'NOT_FOUND' };

if (!existing.assigned_staff_id && !opts.allowUnassignedStaff) {
  return { ok: false, reason: 'STAFF_REQUIRED' };
}

const applied = await reservationStatusService.applyTransition(existing, {
  to: 'completed',
  force: opts.forceComplete,
  allowUnassignedStaff: opts.allowUnassignedStaff,
  include: {
    customer: { include: { children: true } },
    assigned_staff: { select: { id: true, name: true, phone: true } },
    children: true,
  },
});
if (!applied.ok) return applied;

const reservation = applied.reservation;
return { ok: true, reservation, existing };
```

Hapus parameter `strict` dari signature dan dari dua pemanggil:
- `reservation-dispatch.route.ts:745` (`strict: false`) → hapus baris.
- `reservation-dispatch.route.ts:881` (`strict: true`) → hapus baris.

**Catatan:** audit `RESERVATION_UNASSIGNED_COMPLETION_BYPASS` tetap dijalankan sebelum `applyTransition` (pindahkan blok audit ke atas pemanggilan).

### 1.3 Perbaiki soft-cancel

**File:** `src/routes/admin/reservation-dispatch.route.ts:2197-2200`

Ganti dengan:

```ts
const applied = await reservationStatusService.applyTransition(existing, {
  to: 'cancelled',
  // D1: completed TIDAK boleh dibatalkan lewat soft-cancel.
  allowIllegal: false,
});
if (!applied.ok) {
  return reply.status(409).send({
    success: false,
    code: 'ILLEGAL_TRANSITION',
    error: `Transisi ${existing.status} → cancelled ditolak.`,
  });
}
const reservation = applied.reservation;
```

Tangkap `InvalidTransitionError` di `catch` handler route dan balas **409**, bukan 500.

### 1.4 Perbaiki `completeTask` staf

**File:** `src/services/staff-reservation.service.ts:2641-2644`

Ganti dengan:

```ts
const applied = await reservationStatusService.applyTransition(reservation, {
  to: 'completed',
  allowUnassignedStaff: isSupervisor,
});
if (!applied.ok) {
  return { success: false, error: 'Reservasi belum memiliki bidan yang ditugaskan.' };
}
const updated = applied.reservation;
```

Import di atas file:

```ts
import { reservationStatusService } from './reservation-status.service';
```

### 1.5 Perbaiki `pending → en_route`

**File:** `src/domain/reservation-status.ts:139`

Ganti:

```ts
if (f === 'pending') return t === 'confirmed' || t === 'cancelled' || t === 'hold';
```

menjadi:

```ts
if (f === 'pending') return t === 'confirmed' || t === 'cancelled' || t === 'hold' || t === 'en_route';
```

**File:** `src/routes/staff/today.subroute.ts:560-568`

```ts
const { canTransition } = await import('../../domain/reservation-status');
const nextStatus =
  markEnRoute && canTransition(statusLower, EN_ROUTE_STATUS) ? EN_ROUTE_STATUS : undefined;
```

### 1.6 Update test lama

| File | Perubahan |
|---|---|
| `tests/unit/reservation-delete-contract.test.ts:52` | Tambah kasus `completed → ?soft=true` harus 409 |
| `tests/unit/reservation-status-canonical.test.ts` | Tambah `pending → en_route` legal |
| `tests/unit/admin-reservation-cancel-followups.test.ts` | Pastikan fixture berstatus `confirmed`, bukan `completed` |

### Gate 1

```powershell
npm run build
npx vitest run tests/unit/reservation-status-transition.test.ts tests/unit/reservation-delete-contract.test.ts tests/unit/reservation-status-canonical.test.ts tests/unit/admin-reservation-cancel-followups.test.ts tests/unit/reservation-complete-single.test.ts tests/unit/reservation-bulk-complete.test.ts
```

**Acceptance:** tidak ada penulisan `status` di luar `reservationStatusService` (grep bersih), semua test hijau, build 0 error.

---

## Fase 2 — Satukan Definisi Hold & Status Aktif (A-003, A-007, A-015)

### 2.1 Perbaiki sweep hold

**File:** `src/services/cron.service.ts:504-523`

Ganti blok `startOfTodayWibUtc` + `updateMany` dengan:

```ts
const cutoff = new Date(Date.now() - ACTIVE_HOLD_WINDOW_MS);
const expired = await prisma.reservation.findMany({
  where: { tenant_id: tenantId, status: 'hold', created_at: { lt: cutoff } },
  select: { id: true, customer_id: true },
  take: 500,
});
if (expired.length > 0) {
  await prisma.reservation.updateMany({
    where: { id: { in: expired.map((r) => r.id) }, tenant_id: tenantId, status: 'hold' },
    data: { status: 'cancelled' },
  });
  for (const row of expired) {
    const { followUpService } = await import('./follow-up.service');
    await followUpService.onReservationCancelled(row.id, tenantId).catch(() => {});
    const { customerService } = await import('./customer.service');
    await customerService.recalculateCustomerLtv(row.customer_id, tenantId).catch(() => {});
  }
  expired += expired.length;
}
```

Tambahkan import di atas file:

```ts
import { ACTIVE_HOLD_WINDOW_MS } from '../domain/reservation-status';
```

### 2.2 Satukan status aktif

**File:** `src/services/reservation-core.service.ts:90`

Ganti:

```ts
const ACTIVE_STATUSES = ['confirmed', 'en_route', 'hold'];
```

menjadi:

```ts
import { ACTIVE_RESERVATION_STATUSES } from '../domain/reservation-status';
const ACTIVE_STATUSES = ACTIVE_RESERVATION_STATUSES;
```

**File:** `src/services/reservation-core.service.ts:334`

Hapus `'in_progress'` dari daftar:

```ts
status: { in: ['confirmed', 'en_route', 'hold', 'pending'] },
```

### 2.3 Update test

| File | Perubahan |
|---|---|
| `tests/unit/expired-hold-sweep.test.ts:16-30` | Assert `Date.now() - arg.where.created_at.lt` berada di 1.9–2.1 jam |
| `tests/unit/expired-hold-sweep.test.ts` | Tambah kasus "hold 1 jam lalu tidak masuk cutoff" |
| `tests/unit/reservation-stress.test.ts` | Pastikan `pending` kini memblokir slot staf |

### Gate 2

```powershell
npm run build
npx vitest run tests/unit/expired-hold-sweep.test.ts tests/unit/same-day-reservation-collision.test.ts tests/unit/reservation-stress.test.ts tests/unit/reservation-security-and-integrity.test.ts
```

**Acceptance:** cutoff 2 jam terbukti; `pending` memblokir staf; tidak ada `in_progress` di query reservasi.

---

## Fase 3 — Series Memakai Lock, Cek Bentrok, Alamat, Items (A-004, D3)

### 3.1 Ekspor helper yang dibutuhkan

**File:** `src/services/reservation-core.service.ts:317`

Ubah `async function findOverlappingCustomerReservations` menjadi:

```ts
export async function findOverlappingCustomerReservations(...)
```

### 3.2 Tambah tipe sesi

**File:** `src/services/reservation-series.service.ts` (interface `CreateSeriesParams`)

Tambahkan ke setiap item `sessions`:

```ts
durationMinutes?: number;
customerAddressId?: string | null;
```

### 3.3 Ganti blok pre-check + transaksi

**File:** `src/services/reservation-series.service.ts:100-160`

Ganti blok `for (const s of sessions) { ... }` + `prisma.$transaction` dengan pola berikut:

```ts
const {
  computeAdvisoryLockKey,
  findOverlappingStaffReservations,
  findOverlappingCustomerReservations,
  resolveCustomerAddressId,
} = await import('./reservation-core.service');

const resolvedAddressId = await resolveCustomerAddressId({
  tenantId,
  customerId,
  explicitAddressId: sessions.find((s) => s.customerAddressId)?.customerAddressId ?? null,
  candidate: undefined,
});

const result = await prisma.$transaction(async (tx) => {
  const lockKeys = [
    ...new Set(
      sessions.map((s) =>
        computeAdvisoryLockKey(
          tenantId,
          (s.assignedStaffId?.trim() || sanitizedStaffId) || null,
          typeof s.bookingDate === 'string' ? new Date(s.bookingDate) : s.bookingDate
        )
      )
    ),
  ].sort((a, b) => a - b);

  for (const key of lockKeys) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1)', key);
  }

  for (const s of sessions) {
    const sessionStaffId = s.assignedStaffId?.trim() ? s.assignedStaffId.trim() : sanitizedStaffId;
    const bookingDate = typeof s.bookingDate === 'string' ? new Date(s.bookingDate) : s.bookingDate;
    const duration = s.durationMinutes ?? 60;

    if (sessionStaffId) {
      const staffConflicts = await findOverlappingStaffReservations({
        tenantId, staffId: sessionStaffId, bookingDate, durationMinutes: duration, db: tx,
      });
      if (staffConflicts.length > 0) {
        const err: any = new Error('STAFF_COLLISION');
        err.code = 'STAFF_COLLISION';
        err.conflict = staffConflicts[0];
        err.sessionNumber = s.sessionNumber;
        throw err;
      }
    }

    const { exactConflicts } = await findOverlappingCustomerReservations({
      tenantId, customerId, bookingDate, durationMinutes: duration, db: tx,
    });
    if (exactConflicts.length > 0) {
      const err: any = new Error('DUPLICATE_BOOKING');
      err.code = 'DUPLICATE_BOOKING';
      err.conflict = exactConflicts[0];
      err.sessionNumber = s.sessionNumber;
      throw err;
    }
  }

  const series = await tx.reservationSeries.create({
    data: {
      tenant_id: tenantId,
      customer_id: customerId,
      treatment_name: treatmentName,
      total_sessions: totalSessions,
      purchase_value: purchaseValue ?? null,
      assigned_staff_id: sanitizedStaffId,
      notes: notes ?? null,
      status: 'active',
    },
  });

  const reservations = await Promise.all(
    sessions.map(async (s) => {
      const bookingDate = typeof s.bookingDate === 'string' ? new Date(s.bookingDate) : s.bookingDate;
      const sessionStaffId = s.assignedStaffId?.trim() ? s.assignedStaffId.trim() : sanitizedStaffId;
      const duration = s.durationMinutes ?? 60;
      const perSessionPrice = purchaseValue ? Math.round(purchaseValue / totalSessions) : null;
      const created = await tx.reservation.create({
        data: {
          tenant_id: tenantId,
          customer_id: customerId,
          treatment_category: resolvedCategory,
          treatment_detail: `${treatmentName} [Sesi ${s.sessionNumber}/${totalSessions}]`,
          booking_date: bookingDate,
          duration_minutes: duration,
          status: 'confirmed',
          assigned_staff_id: sessionStaffId,
          purchase_value: perSessionPrice,
          series_id: series.id,
          session_number: s.sessionNumber,
          total_sessions: totalSessions,
          customer_address_id: resolvedAddressId,
          raw_text: `[Admin Series] ${treatmentName} - Sesi ${s.sessionNumber}/${totalSessions}`,
        },
      });
      await tx.reservationItem.create({
        data: {
          tenant_id: tenantId,
          reservation_id: created.id,
          custom_name: treatmentName,
          price: perSessionPrice ?? 0,
          duration_minutes: duration,
        },
      });
      return created;
    })
  );

  return { series, reservations };
});
```

Blok efek samping setelah transaksi (lifecycle, follow-up, notifikasi) **tetap dipertahankan**.

### 3.4 Tambahkan status `paused` ke domain (D3)

**File:** `src/domain/reservation-status.ts`

```ts
export const PAUSED_STATUS = 'paused';

// di canTransition:
if (f === 'confirmed') return t === 'completed' || t === 'cancelled' || t === 'paused';
if (f === 'pending') return t === 'confirmed' || t === 'cancelled' || t === 'hold' || t === 'en_route' || t === 'paused';
if (f === 'paused') return t === 'confirmed' || t === 'cancelled';
```

`ACTIVE_RESERVATION_STATUSES` **tidak** memuat `paused`.
`pauseSeries`/`resumeSeries` memakai `reservationStatusService.applyTransition` per baris, bukan `update` langsung.

**File:** `packages/admin-dashboard/src/types/index.ts:56`

```ts
status: 'pending' | 'confirmed' | 'en_route' | 'paused' | 'completed' | 'cancelled' | 'hold';
```

### 3.5 Update test

| File | Perubahan |
|---|---|
| `tests/unit/reservation-series.test.ts` | Tambah kasus duplikat customer, address tertaut, items terbentuk |
| `tests/unit/reservation-series.test.ts` | Tambah kasus `pauseSeries` memakai transisi sah |

### Gate 3

```powershell
npm run build
npx vitest run tests/unit/reservation-series.test.ts tests/unit/reservation-series-core-gates.test.ts tests/unit/same-day-reservation-collision.test.ts
```

**Acceptance:** series memakai satu transaksi + lock; duplikat customer ditolak; `customer_address_id` dan items terisi; status `paused` dikenali FSM.

---

## Fase 4 — Snapshot & Restore Arsip Lengkap (A-005)

### 4.1 Lengkapi snapshot (schemaVersion 2)

**File:** `src/services/reservation-archive.service.ts:62-115`

Ganti objek `reservation` di snapshot dengan daftar lengkap:

```ts
reservation: {
  id: reservation.id,
  tenant_id: reservation.tenant_id,
  customer_id: reservation.customer_id,
  treatment_category: reservation.treatment_category,
  treatment_detail: reservation.treatment_detail,
  booking_date: reservation.booking_date,
  duration_minutes: reservation.duration_minutes,
  status: reservation.status,
  raw_text: reservation.raw_text,
  request_id: reservation.request_id,
  assigned_staff_id: reservation.assigned_staff_id,
  purchase_value: reservation.purchase_value,
  delivery_fee: reservation.delivery_fee,
  discount_amount: reservation.discount_amount,
  payment_method: reservation.payment_method,
  proof_url: reservation.proof_url,
  receipt_reference: reservation.receipt_reference,
  receipt_amount: reservation.receipt_amount,
  is_repeat_order: reservation.is_repeat_order,
  purchase_review_status: reservation.purchase_review_status,
  purchase_occurred_at: reservation.purchase_occurred_at,
  purchase_event_sent_at: reservation.purchase_event_sent_at,
  needs_staff_verification: reservation.needs_staff_verification,
  gestational_weeks: reservation.gestational_weeks,
  mom_stage: reservation.mom_stage,
  hpl_date: reservation.hpl_date,
  series_id: reservation.series_id,
  session_number: reservation.session_number,
  total_sessions: reservation.total_sessions,
  customer_address_id: reservation.customer_address_id,
  otw_sent_at: reservation.otw_sent_at,
  arrived_at: reservation.arrived_at,
  created_at: reservation.created_at,
  updated_at: reservation.updated_at,
},
```

Ubah `schemaVersion: 1` menjadi `schemaVersion: 2`.

Lengkapi `followUps`:

```ts
followUps: (reservation.follow_ups || []).map((f) => ({
  id: f.id,
  type: f.type,
  stage: f.stage,
  treatment_category: f.treatment_category,
  mom_stage: f.mom_stage,
  custom_text: f.custom_text,
  scheduled_at: f.scheduled_at,
  sent_at: f.sent_at,
  status: f.status,
  cancel_reason: f.cancel_reason,
})),
```

Sebelum `tx.reservationArchive.create`, normalkan Date:

```ts
const payload = JSON.parse(JSON.stringify(snapshot));
```

lalu `payload: payload as any`.

### 4.2 Lengkapi restore

**File:** `src/services/reservation-archive.service.ts:280-344`

Tambahkan field yang hilang ke `tx.reservation.create`:

```ts
duration_minutes: resData.duration_minutes ?? null,
purchase_review_status: resData.purchase_review_status ?? 'pending',
purchase_occurred_at: resData.purchase_occurred_at ? new Date(resData.purchase_occurred_at) : null,
purchase_event_sent_at: resData.purchase_event_sent_at ? new Date(resData.purchase_event_sent_at) : null,
needs_staff_verification: Boolean(resData.needs_staff_verification),
gestational_weeks: resData.gestational_weeks ?? null,
mom_stage: resData.mom_stage ?? null,
hpl_date: resData.hpl_date ? new Date(resData.hpl_date) : null,
series_id: resData.series_id ?? null,
session_number: resData.session_number ?? null,
total_sessions: resData.total_sessions ?? null,
```

Ganti `catch (_) {}` pada item menjadi kegagalan transaksi:

```ts
await tx.reservationItem.create({ data: { ... } }); // tanpa try/catch
```

Tambahkan pemulihan follow-up setelah relink children:

```ts
for (const f of payload.followUps || []) {
  const existingFu = await tx.followUp.findFirst({ where: { id: f.id, tenant_id: tenantId } });
  if (existingFu) {
    await tx.followUp.update({ where: { id: f.id }, data: { reservation_id: resData.id } });
  } else {
    await tx.followUp.create({
      data: {
        id: f.id,
        tenant_id: tenantId,
        customer_id: resData.customer_id,
        reservation_id: resData.id,
        type: f.type,
        stage: f.stage,
        treatment_category: f.treatment_category ?? null,
        mom_stage: f.mom_stage ?? null,
        custom_text: f.custom_text ?? null,
        scheduled_at: new Date(f.scheduled_at),
        sent_at: f.sent_at ? new Date(f.sent_at) : null,
        // Restore tidak boleh memicu kiriman ulang: baris baru masuk CANCELLED.
        status: existingFu ? undefined : 'CANCELLED',
        cancel_reason: existingFu ? undefined : 'RESTORED_REVIEW_REQUIRED',
      } as any,
    });
  }
}
```

**Catatan:** follow-up yang masih ada setelah arsip (FK `SetNull`) akan di-relink; yang sudah hilang dibuat `CANCELLED` agar tidak spam.

### 4.3 Update test

| File | Perubahan |
|---|---|
| `tests/integration/reservation-archive-restore-v2.test.ts` | Assert field lengkap + follow-up ter-relink |
| `tests/integration/reservation-archive.test.ts` | Tetap hijau (backward-compatible v1) |

### Gate 4

```powershell
npm run build
npx vitest run tests/integration/reservation-archive.test.ts tests/integration/reservation-archive-restore-v2.test.ts
```

**Acceptance:** restore mempertahankan seluruh field finansial/maternal/durasi dan follow-up; tidak ada error yang ditelan.

---

## Fase 5 — Advisory Lock Fail-Closed (A-006)

**File:** `src/services/reservation-core.service.ts:287-291`

Ganti:

```ts
} catch (e: any) {
  if (entered) throw e;
  if (isBusinessError(e)) throw e;
  return work(prisma);
}
```

menjadi:

```ts
} catch (e: any) {
  if (entered) throw e;
  if (isBusinessError(e)) throw e;
  console.error(JSON.stringify({
    event: 'ADVISORY_LOCK_FALLBACK',
    reason: e?.message || String(e),
    nodeEnv: process.env.NODE_ENV || 'unknown',
  }));
  const allowFallback = process.env.ALLOW_ADVISORY_LOCK_FALLBACK === 'true';
  if (process.env.NODE_ENV === 'production' && !allowFallback) {
    throw new ConflictCheckUnavailableError('advisory_lock', e?.message);
  }
  return work(prisma);
}
```

### Gate 5

```powershell
npm run build
npx vitest run tests/unit/advisory-lock-fail-closed.test.ts tests/unit/reservation-core.test.ts tests/unit/reservation-idempotency-request-id.test.ts
```

**Acceptance:** production fail-closed; test/dev tetap fallback; log `ADVISORY_LOCK_FALLBACK` muncul.

---

## Fase 6 — Invoice Memakai Seam Alamat (A-008)

### 6.1 Lengkapi tipe dashboard

**File:** `packages/admin-dashboard/src/types/index.ts:32`

Tambahkan ke `interface Reservation`:

```ts
customer_address_id?: string | null;
customer_address?: {
  id?: string;
  label?: string;
  address?: string;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  lat?: number | null;
  lng?: number | null;
  ongkir?: number | null;
  is_primary?: boolean | null;
} | null;
```

### 6.2 Ganti resolver invoice

**File:** `packages/admin-dashboard/src/utils/paymentInvoiceFormatter.ts:206-227`

```ts
import { resolveReservationAddress } from './reservationAddress';

function resolveAddress(
  customer: InvoiceCustomerData | null | undefined,
  reservation: GenerateInvoiceParams['reservation']
): string {
  const view = resolveReservationAddress(reservation as any);
  if (view.street) return view.street;
  return (
    customer?.address ||
    customer?.preferences?.address ||
    customer?.kelurahan ||
    ''
  );
}
```

### Gate 6

```powershell
npm run build
cd packages/admin-dashboard; npm run build; cd ../..
npx vitest run tests/unit/payment-invoice-formatter.test.ts tests/unit/payment-invoice-address-card.test.ts
```

**Acceptance:** invoice memakai alamat kartu reservasi; fallback profil hanya bila kartu kosong.

---

## Fase 7 — Batasi Anaphora Treatment dari Asisten (A-009, D4)

**File:** `src/v3/tools/tool-masker.ts:397-451`

Ganti loop `for (let i = conversationHistory.length - 1; i >= 0; i--)` agar hanya memindai **pesan asisten terakhir** dan menolak bila lebih dari satu layanan berbeda:

```ts
const lastAssistantIdx = (() => {
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    if (conversationHistory[i].role === 'assistant') return i;
  }
  return -1;
})();
if (lastAssistantIdx === -1) return undefined;

const content = conversationHistory[lastAssistantIdx].content || '';
const matches = new Set<string>();

const boldMatches = content.matchAll(/\*([^*]+)\*/g);
for (const m of boldMatches) {
  const candidate = m[1].trim();
  if (!candidate) continue;
  const matched = allServices.find((s) => s.name.toLowerCase() === candidate.toLowerCase());
  if (matched) { matches.add(matched.name); continue; }
  const normCand = candidate.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const normMatched = allServices.find((s) => {
    const norm = s.name.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    return norm && norm === normCand;
  });
  if (normMatched) matches.add(normMatched.name);
}

// Fallback substring hanya bila tidak ada bold.
if (matches.size === 0) {
  const contentLower = content.toLowerCase();
  const sorted = [...allServices].sort((a, b) => b.name.length - a.name.length);
  for (const s of sorted) {
    if (s.name.length >= 5 && contentLower.includes(s.name.toLowerCase())) matches.add(s.name);
  }
}

// D4: lebih dari satu layanan = ambigu → jangan menebak.
if (matches.size !== 1) return undefined;
return [...matches][0];
```

### Gate 7

```powershell
npm run build
npx vitest run tests/unit/tool-masker.test.ts tests/unit/booking-commit-anaphora.test.ts tests/unit/v3-booking-commit-session-614425.test.ts
```

**Acceptance:** anaphora tetap bekerja untuk satu layanan; dua layanan atau lebih → `save_reservation` tetap ter-mask.

---

## Fase 8 — Idempotency Admin, Dokumen, dan Pembersihan Kontrak

### 8.1 Idempotency admin (A-010)

**File:** `src/routes/admin/reservation-crud.route.ts:644-660` dan `:802-820`

Tambahkan ke objek `saveReservation({...})`:

```ts
requestId: typeof (request.body as any)?.requestId === 'string'
  ? (request.body as any).requestId.trim() || undefined
  : undefined,
```

**File:** `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx`

- Tambahkan `const submitRequestIdRef = useRef<string>('');`
- Sebelum submit pertama: `if (!submitRequestIdRef.current) submitRequestIdRef.current = crypto.randomUUID();`
- Kirim `requestId: submitRequestIdRef.current` pada body `POST /api/admin/reservation` (sekitar baris 1598 dan 1741).
- Setelah sukses: `submitRequestIdRef.current = '';`

**Quick-hold** (`reservation-crud.route.ts:802`): terima `requestId` opsional dengan pola yang sama.

### 8.2 Koreksi dokumen (A-012)

**File:** `docs/FEATURE_INVENTORY.md:107`

Ganti baris siklus status menjadi:

```md
| **Siklus Status Reservasi** | `prisma/schema.prisma` (`Reservation.status: String`) | Alur status: `HOLD` → `CONFIRMED` → `EN_ROUTE` → `COMPLETED` / `CANCELLED`; `PENDING` untuk same-day request; `PAUSED` untuk sesi series yang dijeda. Kedatangan dicatat di kolom `arrived_at`, bukan status. |
```

### 8.3 Pembersihan kontrak (A-013, A-014, A-015)

| File | Tindakan |
|---|---|
| `reservation-dispatch.route.ts:2124` | Tandai `hard`/`archive` `@deprecated` di komentar; tambahkan `const isArchive = !isSoftCancel;` dengan komentar eksplisit |
| `reservation-dispatch.route.ts:2171-2177` | Hapus blok `deleteEvent` di level route; pindahkan ke cabang `isSoftCancel` sebelum `applyTransition` |
| `reservation-archive.service.ts:137-143` | Biarkan sebagai satu-satunya penghapus event untuk jalur arsip |
| `reservation-core.service.ts:334` | Sudah dihapus di Fase 2 (`in_progress`) |

### Gate 8

```powershell
npm run build
cd packages/admin-dashboard; npm run build; cd ../..
npx vitest run tests/unit/admin-create-reservation.test.ts tests/unit/admin-update-reservation-safe-address.test.ts tests/unit/reservation-idempotency-request-id.test.ts
```

**Acceptance:** double-submit dengan `requestId` sama tidak membuat baris ganda; dokumen inventaris akurat; tidak ada panggilan calendar ganda.

---

## Fase 9 — Verifikasi Penuh & Pencatatan

### 9.1 Regression gate

```powershell
npm run build
npx vitest run --reporter=json --outputFile=docs/audit/2026-11-06/baseline-after.json
node scripts/audit-baseline-diff.mjs docs/audit/2026-11-06/baseline-before.json docs/audit/2026-11-06/baseline-after.json
```

**Acceptance:** `exit 0` (tidak ada failure baru). Bila ada failure yang diklaim pre-existing, wajib revert-and-rerun file terkait.

### 9.2 Catat temuan ke `docs/KNOWN_ISSUES.md`

Tambahkan 11 entri baru (A-001 s.d. A-015 yang relevan) dengan format yang sama: gejala, akar masalah, solusi, bukti, status. Tautkan ke laporan audit:

```md
- **Bukti:** `docs/audit/2026-11-06/LAPORAN_AUDIT_RESERVASI.md` §4 (A-001 … A-015)
```

### 9.3 Update inventaris bila `paused` disetujui

`docs/FEATURE_INVENTORY.md` bagian status reservasi + dashboard filter.

---

## Ringkasan Perintah per Fase

```powershell
# Fase 1
npm run build
npx vitest run tests/unit/reservation-status-transition.test.ts tests/unit/reservation-delete-contract.test.ts tests/unit/reservation-status-canonical.test.ts tests/unit/admin-reservation-cancel-followups.test.ts tests/unit/reservation-complete-single.test.ts tests/unit/reservation-bulk-complete.test.ts

# Fase 2
npm run build
npx vitest run tests/unit/expired-hold-sweep.test.ts tests/unit/same-day-reservation-collision.test.ts tests/unit/reservation-stress.test.ts

# Fase 3
npm run build
npx vitest run tests/unit/reservation-series.test.ts tests/unit/reservation-series-core-gates.test.ts

# Fase 4
npm run build
npx vitest run tests/integration/reservation-archive.test.ts tests/integration/reservation-archive-restore-v2.test.ts

# Fase 5
npm run build
npx vitest run tests/unit/advisory-lock-fail-closed.test.ts tests/unit/reservation-core.test.ts

# Fase 6
npm run build
cd packages/admin-dashboard; npm run build; cd ../..
npx vitest run tests/unit/payment-invoice-formatter.test.ts tests/unit/payment-invoice-address-card.test.ts

# Fase 7
npm run build
npx vitest run tests/unit/tool-masker.test.ts tests/unit/booking-commit-anaphora.test.ts

# Fase 8
npm run build
cd packages/admin-dashboard; npm run build; cd ../..
npx vitest run tests/unit/admin-create-reservation.test.ts tests/unit/reservation-idempotency-request-id.test.ts
```

---

## Risiko & Rollback

| Fase | Risiko utama | Rollback |
|---|---|---|
| 1 | Endpoint lama yang mengandalkan `strict:false` bisa menolak completion `hold` | Revert commit fase; tidak ada migrasi |
| 2 | `pending` kini memblokir slot → beberapa booking same-day bisa 409 | Env flag `ACTIVE_STATUSES_INCLUDE_PENDING=false` sementara |
| 3 | Series gagal total bila satu sesi bentrok (memang diinginkan) | Feature flag `ENABLE_SERIES_STRICT_GATES=false` |
| 4 | Arsip lama (v1) harus tetap terbaca | Restore membaca `schemaVersion`; v1 memakai default |
| 5 | Production bisa menolak reservasi saat lock bermasalah | `ALLOW_ADVISORY_LOCK_FALLBACK=true` darurat |
| 6 | Invoice berubah sumber alamat | Revert file util |
| 7 | Anaphora lebih ketat → bot minta konfirmasi layanan | Revert file tool-masker |
| 8 | `paused` butuh penyesuaian dashboard | Revert type + FSM |

---

## Checklist Kepatuhan AGENTS.md

- [x] Fondasional: state machine, kontrak data, seam tunggal — bukan larangan prompt
- [x] Tenant-aware: semua query tetap `tenant_id`
- [x] Tanpa dependency runtime baru
- [x] Tanpa hardcode data bisnis
- [x] Test-first + adversarial/edge case
- [x] Regression gate per fase + baseline diff
- [x] Human-in-the-Loop: plan ini belum dieksekusi
- [x] Temuan akan dicatat di `docs/KNOWN_ISSUES.md`
- [x] Update `docs/FEATURE_INVENTORY.md` bila status berubah
- [x] God Object tidak ditambah; perubahan terkonsentrasi di seam yang ada
