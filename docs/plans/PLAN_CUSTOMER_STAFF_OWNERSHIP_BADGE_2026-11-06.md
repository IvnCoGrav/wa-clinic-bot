# PLAN — Badge & Banner "Customer Milik Bidan" di Card Customer (Fase 1)

- **Tanggal:** 2026-11-06
- **Status:** Fase 0–6 **SELESAI DIEKSEKUSI** (2026-11-06). Fase 7 (deploy) belum — menunggu jadwal rilis.
- **Catatan eksekusi:**
  - Fase 0 baseline: `npm run build` hijau; `check:design` sudah gagal **sebelum** perubahan di `AdminCopilotPanel.tsx` (palette=2, pre-existing).
  - Fase 1–5 hijau: 20 test unit baru (`customer-staff-ownership`, `staff-ownership-service`, `staff-ownership-badge`) + integrasi `live-chat-reply` (54 test hijau).
  - Full suite: 11 test gagal di 6 file (`v3-conversation-matrix`, `agent-runner`, `adversarial-reservation-resilience`, `catalog-seed-drift`, `chat-schedule-extractor`, `hybrid-reservation-parser`). **Terbukti pre-existing** via revert-and-rerun (stash perubahan → hasil identik 11 gagal / 6 file).
  - Fase 6 dokumentasi: `FEATURE_INVENTORY.md`, `KNOWN_ISSUES.md`, `RUNBOOK_INSENTIF_RETENSI.md` (perbaikan drift kolom log assignment) sudah diperbarui.
  - Fase 7.2 `graphify update .`: belum dijalankan (menyusul sebelum rilis).
- **Ruang lingkup:** Fase 1 saja (read-only awareness).
- **Non-goals:** mengubah rumus payroll, mengunci penugasan bidan, mengubah prompt LLM, migrasi database.
- **Dasar percakapan:** admin sering menyesuaikan rute; badge ini hanya memberi tahu pemilik retensi, bukan melarang pergantian bidan.

---

## 0. Validasi Klaim Sebelum Menyusun Plan

Semua klaim di bawah sudah diverifikasi dengan membaca kode aktual (bukan asumsi).

| Klaim | Bukti kode | Status |
|---|---|---|
| Retensi memakai **first-touch**: bidan kunjungan `completed` pertama = pemilik selamanya | `src/domain/staff-retention.ts:166` (`originStaffId = firstVisit.staffId`) | Terverifikasi |
| Aturan kunjungan valid: hanya `completed`, dedupe 1 per tanggal WIB, sesi ke-1 untuk series, sandbox/internal/deleted dikecualikan | `src/services/staff-retention.service.ts:147-177` | Terverifikasi |
| Live Chat list sudah memuat `reservations` + `assigned_staff` dalam **satu batch** (tidak perlu N+1) | `src/services/live-chat.service.ts:197-208` | Terverifikasi |
| Customer list sudah memuat `reservations` (tanpa `assigned_staff`) | `src/services/customer.service.ts:2313-2320` | Terverifikasi |
| Detail customer sudah mengembalikan `reservations` + `assigned_staff` | `src/routes/admin/customers.subroute.ts:506-527` | Terverifikasi |
| Belum ada field/ringkasan pemilik di level customer | `prisma/schema.prisma:62-114` (tidak ada `preferred_staff`/`owner_staff`) | Terverifikasi |
| Log pergantian bidan sudah ada, tetapi UI tidak mengirim alasan | `prisma/schema.prisma:1370-1384`; `src/routes/admin/reservation-dispatch.route.ts:2078`; dashboard tidak pernah mengirim `assignmentReason` | Terverifikasi |
| Nama pendek bidan sudah punya seam | `packages/admin-dashboard/src/utils/resolveStaffName.ts:73-91` (`staffDisplayName`, `staffShortName`) | Terverifikasi |
| Format tanggal WIB terpusat tersedia | `src/utils/wib-time.ts:38-44` (`formatWibDateYYYYMMDD`) | Terverifikasi |

### Catatan risiko yang sudah diketahui (di luar Fase 1)

- `reservationArchiveService.archiveReservation` **menghapus** baris `reservations` (`src/services/reservation-archive.service.ts:214-217`). Kalau kunjungan `completed` pertama pernah diarsipkan, owner bisa bergeser. Ini **tidak diperbaiki di Fase 1**, tetapi wajib dicatat di `docs/KNOWN_ISSUES.md` dan diselesaikan di Fase 3.
- Badge ini **tidak boleh** dipakai sebagai dasar hitung payroll. Payroll tetap memakai SQL `staff-retention.service.ts`. Badge hanya lapisan informasi.

---

## 1. Arsitektur Solusi

Alur data:

```
Reservation (completed)
        │
        ▼
resolveCustomerOwnerships()  ← domain murni, reuse buildVisits()
        │  (ownerStaffId, ownerSince, lastStaffId, lastVisitDate, totalVisits, hasRotation)
        ▼
staffOwnershipService.getByCustomerIds()  ← 1 query batch + nama/aktif staf
        │
        ├── GET /api/admin/live-chat/conversations      → staffOwnership per item
        ├── GET /api/admin/live-chat/conversations/:id  → staffOwnership
        ├── GET /api/admin/customers                    → staffOwnership per item
        └── GET /api/admin/customers/:id                → staffOwnership
                │
                ▼
StaffOwnershipBadge (chip) + StaffOwnershipBanner (detail)
```

Prinsip:

1. **Satu aturan** — dedupe tanggal memakai `buildVisits()` yang sudah dipakai kalkulator retensi.
2. **Satu query batch** per halaman list — bukan N+1.
3. **Fail-open** — DB gagal → badge disembunyikan, halaman tetap jalan.
4. **Read-only** — tidak ada tombol edit owner.
5. **Tanpa migrasi & tanpa dependency baru.**

### Kontrak data (`staffOwnership`)

`null` bila customer belum punya kunjungan `completed`.

```json
{
  "ownerStaffId": "uuid-atau-null",
  "ownerStaffName": "Bidan Hanifah",
  "ownerSince": "2026-01-12",
  "lastStaffId": "uuid-atau-null",
  "lastStaffName": "Bidan Thabita",
  "lastVisitDate": "2026-02-03",
  "totalVisits": 5,
  "hasRotation": true,
  "ownerInactive": false
}
```

Arti:

- `ownerStaff*` = first-touch, permanen.
- `lastStaff*` = bidan pada kunjungan terakhir.
- `hasRotation` = owner dan last berbeda (bukan penilaian salah/benar).
- `ownerInactive` = staf pemilik sudah `active=false`.

---

## 2. Fase 0 — Baseline & Gerbang Awal

**Tujuan:** memastikan kondisi awal hijau agar kegagalan baru tidak diklaim "pre-existing".

### Micro-task 0.1 — Catat baseline

Jalankan:

```bash
npm run build
npx vitest run tests/unit/staff-retention-calculator.test.ts tests/unit/admin-staff-retention-tenant.test.ts
```

**Acceptance:** build sukses; 2 file test hijau. Jika ada yang gagal, catat output dan buktikan pre-existing dengan `git stash`/revert-and-rerun sebelum lanjut.

### Micro-task 0.2 — Cek design guard dashboard

```bash
cd packages/admin-dashboard
npm run check:design
```

**Acceptance:** `check:tokens` dan `check:dark-parity` hijau. Jika sudah gagal sebelum perubahan, catat sebagai baseline.

**Regression gate Fase 0:** tidak ada perubahan file. Lanjut hanya jika baseline tercatat.

---

## 3. Fase 1 — Domain Rule (fondasi)

**Blast radius:** hanya fungsi murni baru; tidak mengubah fungsi lama.

### Micro-task 1.1 — Tambah import util WIB

File: `src/domain/staff-retention.ts`
Lokasi: setelah baris 8 (akhir komentar header, sebelum `export interface RetentionVisitRow`).

```ts
import { formatWibDateYYYYMMDD } from '../utils/wib-time';
```

**Catatan:** util ini murni (tidak menyentuh DB/network), sehingga tidak melanggar guard arsitektur domain.

### Micro-task 1.2 — Tambah tipe & fungsi ownership

File: `src/domain/staff-retention.ts`
Lokasi: setelah fungsi `buildVisits` (setelah baris 131), sebelum `selectCohort`.

```ts
/** Baris reservasi mentah untuk menentukan pemilik retensi per customer. */
export interface CustomerOwnershipReservationRow {
  customerId: string;
  status?: string | null;
  bookingDate?: Date | string | null;
  assignedStaffId?: string | null;
  createdAt?: Date | string | null;
  seriesId?: string | null;
  sessionNumber?: number | null;
}

export interface CustomerStaffOwnership {
  customerId: string;
  ownerStaffId: string | null;
  /** Tanggal kunjungan pertama (YYYY-MM-DD WIB). */
  ownerSince: string;
  lastStaffId: string | null;
  /** Tanggal kunjungan terakhir (YYYY-MM-DD WIB). */
  lastVisitDate: string;
  totalVisits: number;
  hasRotation: boolean;
}

/**
 * Tentukan bidan pemilik (first-touch) + bidan terakhir per customer.
 *
 * ATURAN WAJIB SAMA DENGAN PAYROLL (`staff-retention.service.ts`):
 * - hanya status `completed`;
 * - 1 kunjungan per tanggal WIB (dedupe via `buildVisits`);
 * - paket series hanya sesi ke-1;
 * - staf pada tanggal yang sama dipilih dari `createdAt` paling awal.
 *
 * Fungsi ini MURNI. Pemfilteran sandbox/internal/deleted dilakukan pemanggil
 * (service) karena butuh kolom milik tabel Customer.
 */
export function resolveCustomerOwnerships(
  rows: CustomerOwnershipReservationRow[]
): Map<string, CustomerStaffOwnership> {
  const visitRows: RetentionVisitRow[] = [];

  for (const row of rows) {
    if (String(row.status ?? '').toLowerCase() !== 'completed') continue;
    if (!row.bookingDate) continue;
    if (row.seriesId && row.sessionNumber !== 1) continue;

    const bookingDate = row.bookingDate instanceof Date
      ? row.bookingDate
      : new Date(row.bookingDate);
    if (Number.isNaN(bookingDate.getTime())) continue;

    visitRows.push({
      customerId: row.customerId,
      staffId: row.assignedStaffId ?? null,
      visitDate: formatWibDateYYYYMMDD(bookingDate),
      createdAt: row.createdAt,
    });
  }

  const visits = buildVisits(visitRows);
  const byCustomer = new Map<string, Visit[]>();
  for (const visit of visits) {
    const list = byCustomer.get(visit.customerId);
    if (list) list.push(visit);
    else byCustomer.set(visit.customerId, [visit]);
  }

  const result = new Map<string, CustomerStaffOwnership>();
  for (const [customerId, list] of byCustomer.entries()) {
    list.sort((a, b) => a.visitDate.localeCompare(b.visitDate));
    const first = list[0];
    const last = list[list.length - 1];
    result.set(customerId, {
      customerId,
      ownerStaffId: first.staffId,
      ownerSince: first.visitDate,
      lastStaffId: last.staffId,
      lastVisitDate: last.visitDate,
      totalVisits: list.length,
      hasRotation:
        first.staffId !== null &&
        last.staffId !== null &&
        first.staffId !== last.staffId,
    });
  }

  return result;
}
```

**Acceptance:**
- `npm run build` sukses.
- `src/domain/staff-retention.ts` tetap tidak mengimpor `prisma`/`db/client` (dijaga test arsitektur yang sudah ada).
- `formatWibDateYYYYMMDD` menghasilkan tanggal yang sama dengan SQL `((booking_date + interval '7 hours')::date)`.

---

## 4. Fase 2 — Service Batch Ownership

**Blast radius:** file baru + 0 perubahan perilaku lama.

### Micro-task 2.1 — Buat service

File baru: `src/services/staff-ownership.service.ts`

```ts
import { prisma as defaultPrisma } from '../db/client';
import {
  CustomerStaffOwnership,
  resolveCustomerOwnerships,
} from '../domain/staff-retention';

export interface StaffOwnershipView extends CustomerStaffOwnership {
  ownerStaffName: string | null;
  lastStaffName: string | null;
  ownerInactive: boolean;
}

export class StaffOwnershipService {
  constructor(private readonly prisma = defaultPrisma) {}

  /**
   * Ambil ownership untuk banyak customer dalam SATU query.
   * Gagal DB → Map kosong (fail-open; badge disembunyikan, halaman tetap jalan).
   */
  async getByCustomerIds(
    tenantId: string,
    customerIds: string[]
  ): Promise<Map<string, StaffOwnershipView>> {
    const ids = [...new Set((customerIds || []).filter(Boolean))];
    if (ids.length === 0) return new Map();

    try {
      const rows = await this.prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          customer_id: { in: ids },
          status: 'completed',
          booking_date: { not: null },
          OR: [{ series_id: null }, { session_number: 1 }],
          customer: {
            is: {
              is_sandbox_test: false,
              is_internal_staff: false,
              deleted_at: null,
            },
          },
        },
        select: {
          customer_id: true,
          status: true,
          booking_date: true,
          assigned_staff_id: true,
          created_at: true,
          series_id: true,
          session_number: true,
          assigned_staff: {
            select: { id: true, name: true, active: true },
          },
        },
        orderBy: { created_at: 'asc' },
      });

      const staffMeta = new Map<string, { name: string | null; active: boolean | null }>();
      for (const row of rows) {
        if (row.assigned_staff) {
          staffMeta.set(row.assigned_staff.id, {
            name: row.assigned_staff.name ?? null,
            active: row.assigned_staff.active ?? null,
          });
        }
      }

      const ownership = resolveCustomerOwnerships(
        rows.map((row) => ({
          customerId: row.customer_id,
          status: row.status,
          bookingDate: row.booking_date,
          assignedStaffId: row.assigned_staff_id,
          createdAt: row.created_at,
          seriesId: row.series_id,
          sessionNumber: row.session_number,
        }))
      );

      const result = new Map<string, StaffOwnershipView>();
      for (const [customerId, item] of ownership.entries()) {
        const ownerMeta = item.ownerStaffId ? staffMeta.get(item.ownerStaffId) : null;
        const lastMeta = item.lastStaffId ? staffMeta.get(item.lastStaffId) : null;
        result.set(customerId, {
          ...item,
          ownerStaffName: ownerMeta?.name ?? null,
          lastStaffName: lastMeta?.name ?? null,
          ownerInactive: ownerMeta?.active === false,
        });
      }
      return result;
    } catch (err) {
      console.warn('[STAFF OWNERSHIP] query failed, badge disabled:', (err as Error).message);
      return new Map();
    }
  }
}

export const staffOwnershipService = new StaffOwnershipService();
```

**Acceptance:**
- `npm run build` sukses.
- Tidak menambah dependency.
- Jika `prisma` menolak filter relasi `customer.is`, ganti menjadi dua langkah: query reservasi tanpa filter customer, lalu filter customer id yang valid dari tabel `customers` (tetap 1–2 query batch, bukan N+1). Verifikasi dengan `npx prisma validate` sebelum lanjut.

**Regression gate Fase 2:**

```bash
npm run build
npx vitest run tests/unit/staff-retention-calculator.test.ts
```

---

## 5. Fase 3 — Enrich Endpoint (backend)

### Micro-task 3.1 — Live Chat list + detail

File: `src/services/live-chat.service.ts`

1. Import di bagian atas (setelah baris 10):

```ts
import { staffOwnershipService, StaffOwnershipView } from './staff-ownership.service';
```

2. Tambah field di interface `LiveChatConversationItem` (setelah baris 65, sebelum `}`):

```ts
  /** Pemilik retensi first-touch + bidan terakhir (read-only). */
  staffOwnership?: StaffOwnershipView | null;
```

3. Di `getConversationList`, setelah `customerIds` dibentuk (setelah baris 192) tambahkan:

```ts
    const ownershipMap = await staffOwnershipService.getByCustomerIds(tenantId, customerIds);
```

4. Ubah signature `serialize` (baris 1250) menjadi:

```ts
  private serialize(
    c: any,
    stats?: { purchaseCount: number; ltv: number },
    unreadCount = 0,
    staffOwnership: StaffOwnershipView | null = null
  ): LiveChatConversationItem {
```

5. Di dalam `return { ... }` pada `serialize` (setelah baris 1406, sebelum `};`), tambahkan:

```ts
      staffOwnership,
```

6. Update pemanggil di `getConversationList` (baris 314-324) menjadi:

```ts
    const items = conversations.map((c) =>
      this.serialize(
        {
          ...c,
          customer: customers.get(c.customer_id),
          messages: lastMessagesByConv.get(c.id) || [],
          matchedMessage: matchedMessageByConv.get(c.id) || null,
        },
        customerStats.get(c.customer_id),
        unreadMap.get(c.id) || 0,
        ownershipMap.get(c.customer_id) ?? null
      )
    );
```

7. Di `getConversationDetail` (setelah baris 357/358), tambahkan:

```ts
    const ownershipMap = await staffOwnershipService.getByCustomerIds(tenantId, [conv.customer_id]);
```

lalu update pemanggilan `serialize` (baris 367-375) menjadi:

```ts
    return this.serialize(
      {
        ...conv,
        customer: cust,
        messages: lastMessages,
      },
      { purchaseCount: resList.length, ltv },
      unreadMap.get(conversationId) || 0,
      ownershipMap.get(conv.customer_id) ?? null
    );
```

**Acceptance:** `GET /api/admin/live-chat/conversations` respons memuat `staffOwnership` (null untuk pasien baru); jumlah query tidak bertambah per item.

### Micro-task 3.2 — Customer list

File: `src/services/customer.service.ts`

1. Import (setelah baris 30):

```ts
import { staffOwnershipService, StaffOwnershipView } from './staff-ownership.service';
```

2. Tambah field di tipe return `listCustomersWithLtvAndAdClick` (di dalam array `customers`, setelah `ongkir: number | null;` baris 2237):

```ts
      staffOwnership?: StaffOwnershipView | null;
```

3. Sebelum `let customers = rawCustomers.map((c) => {` (baris 2388), tambahkan:

```ts
      const ownershipMap = await staffOwnershipService.getByCustomerIds(
        tenantId,
        rawCustomers.map((c) => c.id)
      );
```

4. Di dalam objek return map (setelah `ongkir: c.ongkir ?? null,` baris 2432), tambahkan:

```ts
            staffOwnership: ownershipMap.get(c.id) ?? null,
```

5. Fallback memory (catch, mulai baris 2457) tidak wajib diubah karena field bersifat opsional. Badge otomatis tidak tampil saat DB offline.

**Acceptance:** `GET /api/admin/customers` memuat `staffOwnership` per item; `npm run build` sukses.

### Micro-task 3.3 — Customer detail

File: `src/routes/admin/customers.subroute.ts`

1. Import (setelah baris 14):

```ts
import { staffOwnershipService } from '../../services/staff-ownership.service';
```

2. Sebelum `return reply.status(200).send({` (baris 647), tambahkan:

```ts
        const ownershipMap = await staffOwnershipService.getByCustomerIds(tenantId, [customer.id]);
```

3. Di dalam `data: { ... }` (setelah `purchaseCount: purchaseCount as any,` baris 659), tambahkan:

```ts
            staffOwnership: ownershipMap.get(customer.id) ?? null,
```

**Acceptance:** `GET /api/admin/customers/:id` memuat `staffOwnership`; tenant isolation tetap terjaga (service memfilter `tenant_id`).

**Regression gate Fase 3:**

```bash
npm run build
npx vitest run tests/unit/staff-retention-calculator.test.ts tests/unit/admin-staff-retention-tenant.test.ts
```

---

## 6. Fase 4 — Frontend: Util + Komponen Reusable

### Micro-task 4.1 — Util badge (pure, mudah diuji)

File baru: `packages/admin-dashboard/src/utils/staffOwnershipBadge.ts`

```ts
import { staffDisplayName, staffShortName } from './resolveStaffName';

export interface StaffOwnership {
  ownerStaffId: string | null;
  ownerStaffName: string | null;
  ownerSince: string | null;
  lastStaffId: string | null;
  lastStaffName: string | null;
  lastVisitDate: string | null;
  totalVisits: number;
  hasRotation: boolean;
  ownerInactive?: boolean;
}

export type OwnershipTone = 'violet' | 'amber' | 'gray' | 'neutral';

export interface OwnershipBadgeModel {
  show: boolean;
  label: string;
  tone: OwnershipTone;
  tooltip: string;
}

export function formatOwnershipDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

export function resolveOwnershipBadge(
  ownership: StaffOwnership | null | undefined,
  opts?: { compact?: boolean; showNew?: boolean }
): OwnershipBadgeModel {
  const compact = opts?.compact ?? false;
  if (!ownership) {
    return {
      show: opts?.showNew === true,
      label: 'Pasien baru',
      tone: 'neutral',
      tooltip: 'Belum ada kunjungan selesai — belum ada bidan pemilik.',
    };
  }

  const ownerFull = ownership.ownerStaffName ? staffDisplayName(ownership.ownerStaffName) : '';
  const ownerShort = ownership.ownerStaffName ? staffShortName(ownership.ownerStaffName) : '';
  const lastFull = ownership.lastStaffName ? staffDisplayName(ownership.lastStaffName) : '';
  const lastShort = ownership.lastStaffName ? staffShortName(ownership.lastStaffName) : '';
  const ownerLabel = compact ? ownerShort : ownerFull;
  const lastLabel = compact ? lastShort : lastFull;

  if (!ownership.ownerStaffId && ownership.totalVisits > 0) {
    return {
      show: true,
      label: 'Bidan belum tercatat',
      tone: 'gray',
      tooltip: 'Ada kunjungan selesai, tetapi bidan pada kunjungan pertama belum tercatat.',
    };
  }

  if (!ownership.ownerStaffId) {
    return {
      show: opts?.showNew === true,
      label: 'Pasien baru',
      tone: 'neutral',
      tooltip: 'Belum ada kunjungan selesai — belum ada bidan pemilik.',
    };
  }

  const since = formatOwnershipDate(ownership.ownerSince);
  const lastDate = formatOwnershipDate(ownership.lastVisitDate);

  if (ownership.ownerInactive) {
    return {
      show: true,
      label: `${ownerLabel} (nonaktif)`,
      tone: 'gray',
      tooltip: `Pemilik retensi: ${ownerFull} — sejak ${since}. Staf sudah nonaktif.`,
    };
  }

  if (ownership.hasRotation && lastLabel) {
    return {
      show: true,
      label: compact ? `${ownerLabel} · ${lastLabel}` : `${ownerLabel} · terakhir ${lastLabel}`,
      tone: 'amber',
      tooltip: `Pemilik retensi: ${ownerFull} — sejak ${since}. Terakhir ditangani ${lastFull || '-'} (${lastDate}).`,
    };
  }

  return {
    show: true,
    label: compact ? ownerLabel : `Milik ${ownerLabel}`,
    tone: 'violet',
    tooltip: `Pemilik retensi: ${ownerFull} — sejak ${since}. ${ownership.totalVisits} kunjungan.`,
  };
}
```

**Acceptance:** fungsi murni, tidak memakai `window`/`fetch`.

### Micro-task 4.2 — Komponen chip & banner

File baru: `packages/admin-dashboard/src/components/common/StaffOwnershipBadge.tsx`

```tsx
import React from 'react';
import { Crown } from 'lucide-react';
import {
  OwnershipTone,
  StaffOwnership,
  formatOwnershipDate,
  resolveOwnershipBadge,
} from '../../utils/staffOwnershipBadge';

const TONE_CLASS: Record<OwnershipTone, string> = {
  violet:
    'bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-ink-2 ring-violet-300 dark:ring-divider',
  amber:
    'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-warning ring-amber-300 dark:ring-amber-800/40',
  gray: 'bg-fill-1 text-ink-2 ring-divider',
  neutral: 'bg-fill-1 text-ink-3 ring-divider',
};

interface Props {
  ownership?: StaffOwnership | null;
  variant?: 'chip' | 'banner';
  showNew?: boolean;
  className?: string;
}

export const StaffOwnershipBadge: React.FC<Props> = ({
  ownership,
  variant = 'chip',
  showNew = false,
  className = '',
}) => {
  const model = resolveOwnershipBadge(ownership, {
    compact: variant === 'chip',
    showNew,
  });
  if (!model.show) return null;

  if (variant === 'banner') {
    const since = formatOwnershipDate(ownership?.ownerSince);
    const lastDate = formatOwnershipDate(ownership?.lastVisitDate);
    const ownerName = ownership?.ownerStaffName || 'Bidan pemilik';
    const lastLine = ownership?.hasRotation && ownership?.lastStaffName
      ? `Terakhir ditangani ${ownership.lastStaffName} (${lastDate})`
      : `${ownership?.totalVisits ?? 0} kunjungan`;
    return (
      <div
        className={`flex items-start gap-2 rounded-xl border border-divider bg-surface-2 px-3 py-2.5 ${className}`}
        title={model.tooltip}
      >
        <span className={`mt-0.5 inline-flex items-center justify-center rounded-full p-1 ring-1 ${TONE_CLASS[model.tone]}`}>
          <Crown size={12} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-ink truncate">
            Customer milik {ownerName}
          </p>
          <p className="text-[10px] text-ink-2">
            sejak {since} · {lastLine}
          </p>
        </div>
      </div>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ring-1 shadow-2xs shrink-0 ${TONE_CLASS[model.tone]} ${className}`}
      title={model.tooltip}
      aria-label={model.tooltip}
    >
      <Crown size={9} className="shrink-0" />
      <span className="truncate max-w-[110px]">{model.label}</span>
    </span>
  );
};
```

**Acceptance:**
- `cd packages/admin-dashboard && npm run build` sukses.
- `npm run check:design` sukses (semua tone punya varian `dark:`).
- Tidak memakai `window.confirm`/`alert`.

### Micro-task 4.3 — Integrasi Live Chat

File: `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`

1. Import (dekat import komponen lain di atas):

```tsx
import { StaffOwnershipBadge } from '../../components/common/StaffOwnershipBadge';
import type { StaffOwnership } from '../../utils/staffOwnershipBadge';
```

2. Tambah field di interface `LiveChatItem` (setelah baris 281, dekat `customerProfilePictureUrl`):

```ts
  staffOwnership?: StaffOwnership | null;
```

3. **Chip di card daftar chat** — sisipkan di baris label, setelah blok `chat.isFrustrated` (sekitar baris 4899), sebelum label kustom:

```tsx
                              <StaffOwnershipBadge ownership={chat.staffOwnership} />
```

4. **Chip di header thread** — sisipkan setelah nomor telepon (setelah baris 5250), sebelum label dots:

```tsx
                            <StaffOwnershipBadge ownership={selectedChat.staffOwnership} />
```

5. **Banner di modal detail customer** — sisipkan di dalam modal body, setelah `{customerDetailLoading ? ... : ( <>` (setelah baris 6748), sebelum Quick Metric Cards:

```tsx
                  <StaffOwnershipBadge
                    variant="banner"
                    ownership={(customerDetailData as any)?.staffOwnership ?? selectedChat?.staffOwnership}
                    showNew
                  />
```

**Acceptance:** pasien dengan kunjungan selesai menampilkan chip; pasien baru tidak menampilkan chip di daftar, tetapi banner "Pasien baru" muncul di detail.

### Micro-task 4.4 — Integrasi Customer Database

File: `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx`

1. Import:

```tsx
import { StaffOwnershipBadge } from '../../components/common/StaffOwnershipBadge';
import type { StaffOwnership } from '../../utils/staffOwnershipBadge';
```

2. Tambah field di interface `CustomerItem` (setelah baris 78, sebelum `}`):

```ts
  staffOwnership?: StaffOwnership | null;
```

3. **Card mobile** — sisipkan chip setelah blok alamat (setelah baris 859), di dalam `min-w-0 flex-1`:

```tsx
                      <div className="mt-1">
                        <StaffOwnershipBadge ownership={customer.staffOwnership} />
                      </div>
```

4. **Tabel desktop** — sisipkan chip setelah baris telepon (setelah baris 970), di dalam `div.min-w-0`:

```tsx
                            <div className="mt-1">
                              <StaffOwnershipBadge ownership={customer.staffOwnership} />
                            </div>
```

5. **Banner di modal detail** — sisipkan di dalam Modal Body setelah `{loadingDetail ? ... : ( <>` (setelah baris 1254), sebelum grid LTV:

```tsx
                  <StaffOwnershipBadge
                    variant="banner"
                    ownership={(detailData as any)?.staffOwnership ?? activeDetailCustomer.staffOwnership}
                    showNew
                  />
```

**Acceptance:** card & tabel menampilkan chip yang sama; detail menampilkan banner; tidak ada duplikasi komponen.

**Regression gate Fase 4:**

```bash
cd packages/admin-dashboard
npm run build
npm run check:design
```

---

## 7. Fase 5 — Test Adversarial

### Micro-task 5.1 — Test domain ownership

File baru: `tests/unit/customer-staff-ownership.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  CustomerOwnershipReservationRow,
  resolveCustomerOwnerships,
} from '../../src/domain/staff-retention';

const row = (
  overrides: Partial<CustomerOwnershipReservationRow>
): CustomerOwnershipReservationRow => ({
  customerId: 'c1',
  status: 'completed',
  bookingDate: '2026-01-12T03:00:00.000Z',
  assignedStaffId: 's1',
  createdAt: '2026-01-12T03:00:00.000Z',
  seriesId: null,
  sessionNumber: null,
  ...overrides,
});

describe('resolveCustomerOwnerships — adversarial', () => {
  it('T1: tanpa kunjungan completed → tidak ada entry', () => {
    const result = resolveCustomerOwnerships([
      row({ status: 'pending' }),
      row({ status: 'cancelled' }),
    ]);
    expect(result.size).toBe(0);
  });

  it('T2: first-touch menang walau kunjungan terakhir beda bidan', () => {
    const result = resolveCustomerOwnerships([
      row({ bookingDate: '2026-01-12T03:00:00.000Z', assignedStaffId: 's1' }),
      row({ bookingDate: '2026-02-03T03:00:00.000Z', assignedStaffId: 's2' }),
    ]);
    const own = result.get('c1')!;
    expect(own.ownerStaffId).toBe('s1');
    expect(own.lastStaffId).toBe('s2');
    expect(own.totalVisits).toBe(2);
    expect(own.hasRotation).toBe(true);
  });

  it('T3: dua reservasi di tanggal WIB sama → 1 kunjungan, staf createdAt paling awal', () => {
    const result = resolveCustomerOwnerships([
      row({
        bookingDate: '2026-01-12T03:00:00.000Z',
        assignedStaffId: 's1',
        createdAt: '2026-01-10T00:00:00.000Z',
      }),
      row({
        bookingDate: '2026-01-12T09:00:00.000Z',
        assignedStaffId: 's2',
        createdAt: '2026-01-11T00:00:00.000Z',
      }),
    ]);
    const own = result.get('c1')!;
    expect(own.totalVisits).toBe(1);
    expect(own.ownerStaffId).toBe('s1');
  });

  it('T4: sesi series ke-2 diabaikan, sesi ke-1 dihitung', () => {
    const result = resolveCustomerOwnerships([
      row({ seriesId: 'ser-1', sessionNumber: 1, assignedStaffId: 's1' }),
      row({ seriesId: 'ser-1', sessionNumber: 2, assignedStaffId: 's2' }),
    ]);
    const own = result.get('c1')!;
    expect(own.totalVisits).toBe(1);
    expect(own.ownerStaffId).toBe('s1');
    expect(own.hasRotation).toBe(false);
  });

  it('T5: kunjungan pertama tanpa bidan → owner null, bukan menebak bidan berikutnya', () => {
    const result = resolveCustomerOwnerships([
      row({ bookingDate: '2026-01-12T03:00:00.000Z', assignedStaffId: null }),
      row({ bookingDate: '2026-02-03T03:00:00.000Z', assignedStaffId: 's2' }),
    ]);
    const own = result.get('c1')!;
    expect(own.ownerStaffId).toBeNull();
    expect(own.lastStaffId).toBe('s2');
    expect(own.hasRotation).toBe(false);
  });

  it('T6: batas WIB — 18:00 UTC tanggal 1 = 01:00 WIB tanggal 2', () => {
    const result = resolveCustomerOwnerships([
      row({ bookingDate: '2026-06-01T18:00:00.000Z', assignedStaffId: 's1' }),
    ]);
    expect(result.get('c1')!.ownerSince).toBe('2026-06-02');
  });

  it('T7: booking_date invalid tidak boleh membuat owner palsu', () => {
    const result = resolveCustomerOwnerships([
      row({ bookingDate: 'invalid-date' }),
    ]);
    expect(result.size).toBe(0);
  });

  it('T8: semua kunjungan bidan sama → hasRotation false', () => {
    const result = resolveCustomerOwnerships([
      row({ bookingDate: '2026-01-12T03:00:00.000Z', assignedStaffId: 's1' }),
      row({ bookingDate: '2026-02-03T03:00:00.000Z', assignedStaffId: 's1' }),
    ]);
    expect(result.get('c1')!.hasRotation).toBe(false);
  });

  it('T9: urutan input acak tetap deterministik', () => {
    const rows = [
      row({ bookingDate: '2026-02-03T03:00:00.000Z', assignedStaffId: 's2' }),
      row({ bookingDate: '2026-01-12T03:00:00.000Z', assignedStaffId: 's1' }),
    ];
    const a = resolveCustomerOwnerships(rows).get('c1')!;
    const b = resolveCustomerOwnerships([...rows].reverse()).get('c1')!;
    expect(a).toEqual(b);
  });

  it('T10: customer berbeda tidak saling bocor', () => {
    const result = resolveCustomerOwnerships([
      row({ customerId: 'c1', assignedStaffId: 's1' }),
      row({ customerId: 'c2', assignedStaffId: 's2' }),
    ]);
    expect(result.get('c1')!.ownerStaffId).toBe('s1');
    expect(result.get('c2')!.ownerStaffId).toBe('s2');
  });
});
```

**Acceptance:** semua T1–T10 hijau.

### Micro-task 5.2 — Test badge state

File baru: `tests/unit/staff-ownership-badge.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { resolveOwnershipBadge } from '../../packages/admin-dashboard/src/utils/staffOwnershipBadge';

const base = {
  ownerStaffId: 's1',
  ownerStaffName: 'Bidan Hanifah',
  ownerSince: '2026-01-12',
  lastStaffId: 's1',
  lastStaffName: 'Bidan Hanifah',
  lastVisitDate: '2026-02-03',
  totalVisits: 5,
  hasRotation: false,
  ownerInactive: false,
};

describe('resolveOwnershipBadge', () => {
  it('null + showNew=false → tidak tampil', () => {
    expect(resolveOwnershipBadge(null).show).toBe(false);
  });

  it('null + showNew=true → Pasien baru', () => {
    const model = resolveOwnershipBadge(null, { showNew: true });
    expect(model.show).toBe(true);
    expect(model.label).toBe('Pasien baru');
    expect(model.tone).toBe('neutral');
  });

  it('pemilik aktif tanpa rotasi → violet', () => {
    const model = resolveOwnershipBadge(base);
    expect(model.tone).toBe('violet');
    expect(model.label).toContain('Hanifah');
  });

  it('rotasi → amber dan menyebut bidan terakhir', () => {
    const model = resolveOwnershipBadge({ ...base, hasRotation: true, lastStaffName: 'Bidan Thabita' });
    expect(model.tone).toBe('amber');
    expect(model.label).toContain('Thabita');
  });

  it('pemilik nonaktif → gray + (nonaktif)', () => {
    const model = resolveOwnershipBadge({ ...base, ownerInactive: true });
    expect(model.tone).toBe('gray');
    expect(model.label).toContain('nonaktif');
  });

  it('kunjungan ada tapi owner tidak tercatat → gray', () => {
    const model = resolveOwnershipBadge({ ...base, ownerStaffId: null, ownerStaffName: null });
    expect(model.tone).toBe('gray');
    expect(model.label).toBe('Bidan belum tercatat');
  });

  it('compact memakai nama pendek', () => {
    const model = resolveOwnershipBadge(base, { compact: true });
    expect(model.label).toBe('Hanifah');
  });
});
```

**Acceptance:** semua hijau.

### Micro-task 5.3 — Test service fail-open

File baru: `tests/unit/staff-ownership-service.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { StaffOwnershipService } from '../../src/services/staff-ownership.service';

describe('StaffOwnershipService — fail-open', () => {
  it('DB offline → Map kosong, tidak throw', async () => {
    const service = new StaffOwnershipService();
    await expect(service.getByCustomerIds('default-tenant', ['c1'])).resolves.toBeInstanceOf(Map);
    const map = await service.getByCustomerIds('default-tenant', ['c1']);
    expect(map.size).toBe(0);
  });

  it('customerIds kosong → tidak query, Map kosong', async () => {
    const service = new StaffOwnershipService();
    const map = await service.getByCustomerIds('default-tenant', []);
    expect(map.size).toBe(0);
  });
});
```

**Catatan:** `tests/setup.ts` sudah mem-mock `src/db/client` agar reject; test ini memastikan badge tidak mematikan halaman saat DB bermasalah.

**Regression gate Fase 5:**

```bash
npx vitest run tests/unit/customer-staff-ownership.test.ts tests/unit/staff-ownership-badge.test.ts tests/unit/staff-ownership-service.test.ts tests/unit/staff-retention-calculator.test.ts
npm run build
```

---

## 8. Fase 6 — Dokumentasi & Mandat Repo

### Micro-task 6.1 — FEATURE_INVENTORY

File: `docs/FEATURE_INVENTORY.md`

Tambahkan baris di tabel fitur (dekat entri Customer/Live Chat):

```md
| **Indikator Bidan Pemilik Pasien (First-Touch)** | `GET /api/admin/customers`, `GET /api/admin/customers/:id`, `GET /api/admin/live-chat/conversations`, `StaffOwnershipBadge.tsx` | Chip/banner read-only yang menampilkan bidan pemilik retensi (first-touch) dan bidan terakhir yang menangani, lengkap dengan status rotasi/nonaktif. Tidak mengubah penugasan maupun rumus payroll. |
```

### Micro-task 6.2 — KNOWN_ISSUES

File: `docs/KNOWN_ISSUES.md`

Tambahkan catatan di item terkait retensi/observabilitas (atau item baru):

```md
- **Batasan badge pemilik pasien (2026-11-06):** badge di card customer bersifat read-only dan dihitung dari reservasi `completed` yang masih ada di tabel `reservations`. Jika kunjungan pertama pernah diarsipkan (baris dihapus oleh `reservationArchiveService`), pemilik dapat bergeser. Perbaikan penjagaan arsip dijadwalkan Fase 3 (belum dieksekusi).
```

### Micro-task 6.3 — Runbook (perbaikan doc drift)

File: `docs/RUNBOOK_INSENTIF_RETENSI.md`

Ganti blok SQL baris 87-92 agar sesuai schema aktual:

```sql
SELECT *
FROM reservation_staff_assignment_logs
WHERE reservation_id = '<id-reservasi>'
ORDER BY created_at DESC;
```

Dan sesuaikan penjelasan kolom menjadi: `from_staff_id`, `to_staff_id`, `actor`, `created_at`.

**Acceptance:** dokumentasi konsisten dengan `prisma/schema.prisma:1370-1384`.

---

## 9. Fase 7 — Verifikasi Akhir & Deploy

### Micro-task 7.1 — Full regression

```bash
npm run build
npm run test
cd packages/admin-dashboard
npm run build
npm run check:design
```

**Acceptance:**
- `npm run build` sukses.
- Full suite tidak menambah failure baru. Jika ada failure, wajib dibuktikan pre-existing (revert-and-rerun) sebelum dinyatakan bukan regresi.
- Dashboard build sukses; design check sukses.

### Micro-task 7.2 — Graphify update (wajib sesuai AGENTS.md)

```bash
graphify update .
```

**Acceptance:** graph knowledge ter-update tanpa error.

### Micro-task 7.3 — Urutan deploy

1. Deploy backend lebih dulu (field `staffOwnership` aditif; frontend lama mengabaikan).
2. Rebuild dashboard (`npm run build` di `packages/admin-dashboard`), lalu restart bot agar `dist/` tersaji.
3. **Tidak ada migrasi database.**
4. **Tidak menyentuh WAHA.**

**Acceptance:** buka Live Chat & Customer Database; chip muncul untuk pasien repeat, tidak muncul untuk pasien baru; detail menampilkan banner.

---

## 10. Acceptance Criteria Keseluruhan

1. Customer dengan minimal 1 kunjungan `completed` menampilkan chip pemilik di card Live Chat dan Customer Database.
2. Pasien baru tidak menampilkan chip di daftar (menghindari clutter), tetapi detail menampilkan "Pasien baru".
3. Rotasi bidan ditampilkan amber dengan tooltip "terakhir ditangani ...".
4. Pemilik nonaktif ditampilkan abu-abu dengan label `(nonaktif)`.
5. Pasien sandbox/internal tidak menampilkan badge.
6. Badge read-only — tidak ada aksi edit owner.
7. Tidak ada N+1: ownership diambil lewat satu query batch per halaman.
8. DB down → badge hilang, halaman tetap berfungsi (fail-open).
9. Tidak ada migrasi, dependency baru, atau perubahan rumus payroll.
10. Build backend, build dashboard, design check, dan test terkait hijau.

---

## 11. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Badge berbeda dengan angka payroll | Sengketa | Domain memakai `buildVisits()` yang sama; badge hanya informasi; payroll tetap SQL |
| Query tambahan memperlambat list | Latensi | 1 query batch + index `customer_id`; list sudah cache 5 detik; fail-open |
| Arsip kunjungan pertama | Owner bergeser | Dicatat di KNOWN_ISSUES; diperbaiki Fase 3 |
| Card penuh badge | UI sesak | Hanya 1 chip, nama pendek, tooltip untuk detail |
| `active` staf null | Label salah | `ownerInactive` hanya `true` bila `active === false` |
| Prisma menolak filter relasi `customer.is` | Build gagal | Verifikasi `npx prisma validate`; fallback filter dua langkah (tetap batch) |

---

## 12. File yang Akan Disentuh

**Backend**
- `src/domain/staff-retention.ts` (tambah tipe + fungsi)
- `src/services/staff-ownership.service.ts` (baru)
- `src/services/live-chat.service.ts` (enrich list & detail)
- `src/services/customer.service.ts` (enrich list)
- `src/routes/admin/customers.subroute.ts` (enrich detail)

**Frontend**
- `packages/admin-dashboard/src/utils/staffOwnershipBadge.ts` (baru)
- `packages/admin-dashboard/src/components/common/StaffOwnershipBadge.tsx` (baru)
- `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`
- `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx`

**Test**
- `tests/unit/customer-staff-ownership.test.ts` (baru)
- `tests/unit/staff-ownership-badge.test.ts` (baru)
- `tests/unit/staff-ownership-service.test.ts` (baru)

**Dokumentasi**
- `docs/FEATURE_INVENTORY.md`
- `docs/KNOWN_ISSUES.md`
- `docs/RUNBOOK_INSENTIF_RETENSI.md`

**Tidak disentuh:** `prisma/schema.prisma`, migrasi, `package.json`, integrasi WAHA, prompt LLM.

---

## 13. Konfirmasi Eksekusi

Plan ini berstatus **DRAFT**. Sesuai *Strict Human-in-the-Loop Confirmation Gate*, tidak ada file kode/test yang akan dibuat atau diubah sampai pengguna manusia mengetik persetujuan eksplisit, misalnya:

> **"Lanjut, eksekusi Fase 1."**

Pertanyaan yang masih perlu jawaban sebelum eksekusi:

1. **Prioritas lokasi badge:** Live Chat saja, Customer Database saja, atau keduanya? (Plan ini mencakup keduanya.)
2. **Pasien baru:** setuju tidak diberi chip di daftar (hanya muncul di detail sebagai "Pasien baru")?
3. **Label chip:** gunakan ikon mahkota + nama, atau teks eksplisit "Milik Bidan X"?

Setelah ketiganya jelas, eksekusi dimulai dari Fase 0 (baseline) → Fase 1, dengan regression gate di setiap fase.
