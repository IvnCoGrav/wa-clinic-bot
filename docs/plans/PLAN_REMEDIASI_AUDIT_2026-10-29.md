# PLAN REMEDIASI AUDIT — 2026-10-29

> **Status: DRAFT — BELUM DIEKSEKUSI.**
> Plan ini adalah tindak lanjut dari `docs/audit/AUDIT_UPDATE_2026-10-24_28.md` (temuan A-001…A-015) dan melengkapi `docs/plans/PLAN_OTORITAS_IDENTITAS_PELANGGAN_2026-10-29.md`.
>
> **Confirmation Gate**: tidak ada satu baris kode, test, migrasi, atau perintah tulis yang boleh dijalankan sebelum pengguna manusia mengetik persetujuan eksplisit ("Setuju / Lanjut / Eksekusi") di chat. Persetujuan otomatis dari hook sistem **diabaikan**.

---

## 0. Aturan Eksekusi Plan Ini

1. **Satu fase = satu PR/commit.** Jangan gabungkan fase. Setiap fase ditutup gerbang regresi.
2. **Urutan wajib** (dependency): Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Phase 8 (dokumen) boleh dicicil setelah fase terkait selesai.
3. **Dilarang** menambah dependency runtime (`package.json`) tanpa persetujuan terpisah.
4. **Dilarang** memakai `window.confirm` / `alert` di dashboard.
5. **Dilarang** memakai regex untuk menebak intent pengguna. Regex di plan ini hanya untuk validasi format teknis (`YYYY-MM`, angka, nama kolom).
6. Semua data bisnis baru (periode kohort, slot terapis, TTL ongkir, toleransi bayar) **wajib** disimpan di `Tenant.settings`, bukan di kode.
7. Jika sebuah fase gagal di gerbang regresi: **stop**, jangan lanjut ke fase berikutnya, laporkan test yang gagal + bukti pre-existing (revert-and-rerun).

### 0.1 Perintah gerbang standar

```powershell
git status --porcelain
npm run typecheck
npm test
```

`npm run typecheck` = `tsc --noEmit`. `npm test` = seluruh suite Vitest (offline, tanpa DB).

---

## 1. Peta Temuan → Fase

| Temuan | Ringkasan | Fase | Risiko | Butuh migrasi? |
|---|---|---|---|---|
| A-013 (baru) | `customers.subroute.ts` masih memakai `DEFAULT_TENANT_ID` di 26 titik → kebocoran lintas tenant | **1** | Tinggi (keamanan) | Tidak |
| A-002 | `totalExpected` mengabaikan diskon & memakai kesetaraan persis | **2** | Tinggi (uang) | Tidak |
| A-003 | Logika mismatch diduplikasi FE↔BE; FE mem-parse `raw_text` | **2** | Sedang-tinggi | Tidak |
| A-014 (baru) | `discount_amount` tidak pernah ditulis kode mana pun → kolom mati | **2** | Sedang | Tidak |
| A-001 | Kohort `2025-08` / `2026-01` / slot `4` di-hardcode | **3** | Tinggi | Tidak (settings JSON) |
| A-004 | Estimasi ongkir chat mengalahkan ongkir resmi, tanpa TTL/ikatan alamat | **4** | Sedang-tinggi | Tidak |
| A-005 | Merge alamat terlalu longgar (panjang ≥ 15 karakter) | **5** | Sedang | Tidak |
| A-012 | 2 jalur tulis `Customer.name` melewati shield | **6** | Sedang | Ya (plan identitas) |
| A-006 | Dedup anak tidak atomik + `reservation_id` ditimpa | **7** | Sedang | Ya |
| A-007…A-011, A-015 | Proses, dokumentasi, metrik, nomor Known Issues, fallback `raw_text` | **8** | Rendah | Tidak |

**Yang TIDAK dikerjakan plan ini:** A-008 (dokumentasi definisi metrik) hanya dicatat + tooltip; tidak mengubah rumus. Perubahan rumus butuh plan terpisah.

---

## 2. Keputusan yang Harus Disetujui Sebelum Eksekusi

| Kode | Pertanyaan | Rekomendasi | Dampak jika ditolak |
|---|---|---|---|
| **Q1** | Apakah Phase 1 (isolasi tenant) dikerjakan lebih dulu daripada perbaikan uang? | **Ya.** Kebocoran data lintas tenant lebih berbahaya daripada badge salah. | Phase 2–7 tetap bisa jalan, tetapi utang keamanan berlanjut. |
| **Q2** | `discount_amount` mau dihidupkan (API + field modal) atau dibiarkan mati? | **Hidupkan minimal di API** (`PATCH /api/admin/reservation/:id`), field UI menyusul. | Jika dibiarkan: diskon selalu 0, tagihan & sheet tetap tanpa diskon; dicatat OPEN di Known Issues. |
| **Q3** | Toleransi pembayaran default | **0 rupiah** (perilaku sekarang), dapat diubah per tenant lewat `paymentSettings.tolerance`. | Jika langsung diberi toleransi, mismatch kecil bisa lolos diam-diam. |
| **Q4** | Default konfigurasi analitik tenant lama | **Seed eksplisit** (`cohortStartMonth=2026-01`, `excludedCohortMonths=['2025-08']`, `dailySlotsPerTherapist=4`) agar angka dashboard tidak berubah mendadak. | Tanpa seed, kohort 2025-08 muncul lagi dan kapasitas menjadi `UNKNOWN`. |
| **Q5** | TTL estimasi ongkir | **14 hari**, disimpan di `Tenant.settings.deliverySettings.estimateTtlDays`. | Jika 0/tanpa TTL, risiko ongkir basi tetap ada. |
| **Q6** | Aturan merge alamat lintas kecamatan | **Wajib ada nomor/blok/RT-RW eksplisit.** Nama perumahan tanpa nomor tidak boleh merge. | Kasus split-brain alamat bisa muncul lagi untuk perumahan tanpa nomor. |
| **Q7** | Migrasi `children.name_norm` | **Ya** (aditif + unique index). | Dedup anak tetap rawan balapan; dicatat OPEN. |
| **Q8** | Phase 6 (konvergensi nama) memakai migrasi `name_source`? | **Ya**, sesuai plan identitas Phase 2. Jika ditolak → Mode B (JSON) dengan konsekuensi di plan identitas §9. | Nama pelanggan lama tetap bisa ditimpa jalur admin. |

**Verifikasi data produksi yang WAJIB sebelum Phase 2** (3 baris reservasi berdiskon):

```sql
SELECT id, purchase_value, discount_amount, delivery_fee, receipt_amount, status
FROM reservations
WHERE discount_amount IS NOT NULL AND discount_amount > 0
ORDER BY created_at DESC
LIMIT 3;
```

- Jika `purchase_value` = harga katalog **sebelum** diskon → rumus `gross - discount + ongkir` benar.
- Jika `purchase_value` sudah **net** → rumus harus `purchase_value + ongkir` dan `discount_amount` hanya informasi. **Jangan lanjut Phase 2 sebelum ini dipastikan.**

Bukti sementara dari kode: `src/services/sheets/row-formatter.ts:192-195` menulis komentar *"Di spreadsheet klinik: Total = Layanan + Ongkir (sebelum diskon)"* dan menaruh diskon di kolom terpisah. Artinya `purchase_value` dimaksudkan **gross**. Tetap wajib dicek ke data nyata.

---

## 3. Phase 0 — Baseline (tanpa perubahan kode)

### Tujuan
Memastikan titik awal hijau dan tidak ada pekerjaan pengguna yang tertimpa.

### Micro-task
1. `git status --porcelain` → **harus kosong**. Jika ada perubahan, berhenti dan tanya pengguna.
2. `git rev-parse --abbrev-ref HEAD` → catat branch.
3. `npm run typecheck` → exit 0.
4. Jalankan baseline test terkait:

```powershell
npx vitest run tests/unit/customer-payment-proof-mismatch.test.ts tests/unit/customer-delivery-fee-resolver.test.ts tests/unit/meta-performance-analytics.test.ts tests/unit/customer-saved-addresses.test.ts tests/unit/address-match-toponimi.test.ts tests/unit/child-service.test.ts tests/integration/active-reservations-endpoint.test.ts
```

### Acceptance
- 7 file hijau, `typecheck` exit 0.
- Output disimpan di `docs/audit/BASELINE_2026-10-29.txt` (opsional, boleh ditempel di chat).

### Jika merah
Revert-and-rerun: `git stash` → jalankan test yang sama → jika tetap merah, catat sebagai **pre-existing** dan jangan diklaim regresi.

---

## 4. Phase 1 — Isolasi Tenant di `customers.subroute.ts` (A-013)

### Tujuan
Menutup kebocoran lintas tenant pada endpoint admin customer (pesan, jadwal aktif, event Meta, blokir, label, AI override, update profil, foto rumah, audience export). Total **26 pemakaian** `DEFAULT_TENANT_ID` (di luar baris import) per 2026-10-29.

### Akar masalah
Handler memakai konstanta `DEFAULT_TENANT_ID` walau hook admin sudah menetapkan `request.tenantId` (dari `x-tenant-id` atau sesi staf). Tenant kedua akan membaca/menulis data tenant pertama.

### Micro-task 1.1 — Inventaris
```powershell
Select-String -Path src/routes/admin/customers.subroute.ts -Pattern "DEFAULT_TENANT_ID"
```
Target akhir: **0 hasil** (termasuk import dihapus).

### Micro-task 1.2 — Ganti per handler

| Baris (2026-10-29) | Handler | Aksi |
|---|---|---|
| 229, 260 | `GET /api/admin/customers/audience-export/coords` | `const tenantId = tenantOf(request)` di awal; ganti `DEFAULT_TENANT_ID` → `tenantId` |
| 312, 339 | lanjutan handler yang sama | idem |
| 436 | `GET /api/admin/customers` | idem; teruskan `tenantId` ke `listCustomersWithLtvAndAdClick` |
| 606 | `GET /api/admin/customers/:id` | idem (handler sudah punya `tenantId`) |
| 961, 973 | `GET /api/admin/customers/:id/messages` | tambah `tenantId`; filter `conversation` **dan** `message` |
| 1012 | `GET /api/admin/customers/:id/active-reservations` | tambah `tenantId` |
| 1071, 1092 | `POST /api/admin/customers/:id/send-event` | tambah `tenantId`; teruskan ke `capiService.sendCapiEvent` |
| 1136, 1162 | `POST /api/admin/customer/:id/block` / `unblock` | tambah `tenantId` |
| 1204 | `PATCH /api/admin/customers/:id/label` | tambah `tenantId` |
| 1246 | `GET /api/admin/customers/flagged` | tambah `tenantId` |
| 1278, 1284, 1299 | `PATCH /api/admin/customers/:id/ai-override` | tambah `tenantId` |
| 1449, 1458 | `PUT /api/admin/customers/:id` (update profil) | tambah `tenantId`; teruskan ke `updateCustomer` |
| 1497 | refresh lokasi/ongkir customer | tambah `tenantId` |
| 1545, 1579 | upload foto rumah (validasi & hitung ongkir) | tambah `tenantId` |
| 1645, 1660 | watermark & simpan media foto rumah | pakai `customer.tenant_id` (bukan default) |
| 1715 | seam update lokasi dari foto rumah | tambah `tenantId` |

Pola penggantian (contoh baris 961):

```ts
// SEBELUM
const { id } = request.params;
const limit = Math.min(1000, Math.max(1, parseInt(request.query?.limit || '200', 10) || 200));
// ...
where: { customer_id: id, tenant_id: DEFAULT_TENANT_ID },

// SESUDAH
const { id } = request.params;
const tenantId = tenantOf(request);            // fail-closed 401 bila tenant tidak ada
const limit = Math.min(1000, Math.max(1, parseInt(request.query?.limit || '200', 10) || 200));
// ...
where: { customer_id: id, tenant_id: tenantId },
```

Hapus baris `import { DEFAULT_TENANT_ID } from '../../config/tenant';` **hanya jika** sudah tidak terpakai di file.

### Micro-task 1.3 — Test adversarial baru
Buat `tests/integration/customers-tenant-isolation.test.ts`:

1. `GET /api/admin/customers/cust-1/messages` dengan header `x-api-key` + `x-tenant-id: tenant-b` → `prisma.conversation.findMany` menerima `where.tenant_id === 'tenant-b'`.
2. `GET /api/admin/customers/cust-1/active-reservations` tenant-b → `where.tenant_id === 'tenant-b'`.
3. `POST /api/admin/customers/cust-1/send-event` tenant-b → `capiService.sendCapiEvent` menerima `tenantId: 'tenant-b'`.
4. `GET /api/admin/customers/flagged` tenant-b → `where.tenant_id === 'tenant-b'`.
5. Tanpa header dan tanpa sesi → **401** (fail-closed), bukan diam-diam `default-tenant`.

### Acceptance
```powershell
(Select-String -Path src/routes/admin/customers.subroute.ts -Pattern "DEFAULT_TENANT_ID").Count   # 0
npm run typecheck
npx vitest run tests/integration/customers-tenant-isolation.test.ts tests/integration/active-reservations-endpoint.test.ts tests/integration/admin-customer-label.test.ts
```
Semua hijau; test lama `active-reservations-endpoint` tetap lolos karena auth admin menetapkan `default-tenant`.

### FMEA
| Risiko | S | O | D | RPN | Mitigasi |
|---|---|---|---|---|---|
| Endpoint 401 karena `tenantOf` tidak tersedia | 6 | 3 | 2 | 36 | test integrasi boot app + header |
| Ada jalur yang memang butuh default (cron/CLI) | 5 | 3 | 4 | 60 | hanya route admin yang diubah; cron tidak disentuh |
| Query jadi lebih lambat | 2 | 2 | 2 | 8 | index `tenant_id` sudah ada |

### Rollback
`git revert <commit-phase-1>`. Tidak ada migrasi/data berubah.

---

## 5. Phase 2 — Seam Tagihan Kanonis + Payload Evaluasi (A-002, A-003, A-014)

### Tujuan
Satu sumber kebenaran "berapa yang harus dibayar", dipakai backend & frontend; FE berhenti menghitung uang dan berhenti membaca `raw_text`.

### 5.1 Modul domain baru: `src/domain/payment-expected.ts`

```ts
export type PaymentStatus = 'UNVERIFIED' | 'EXACT' | 'UNDERPAID' | 'OVERPAID';

export interface ExpectedPayment {
  gross: number;
  discount: number;
  net: number;
  deliveryFee: number;
  expected: number;
  receiptAmount: number | null;
  difference: number;
  tolerance: number;
  status: PaymentStatus;
  isMismatch: boolean;
  isUnderpaid: boolean;
  isOverpaid: boolean;
}

export interface ExpectedPaymentInput {
  purchaseValue?: number | null;
  discountAmount?: number | null;
  deliveryFee?: number | null;
  receiptAmount?: number | null;
}

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Otoritas tunggal tagihan reservasi.
 * expected = max(0, purchase_value - discount_amount) + delivery_fee
 * Toleransi eksplisit untuk kode unik/pembulatan; default 0 = perilaku lama.
 */
export function resolveExpectedPayment(
  input: ExpectedPaymentInput,
  options: { tolerance?: number } = {}
): ExpectedPayment {
  const gross = money(input.purchaseValue);
  const discount = Math.min(gross, money(input.discountAmount));
  const net = Math.max(0, gross - discount);
  const deliveryFee = money(input.deliveryFee);
  const expected = net + deliveryFee;
  const receiptAmount = money(input.receiptAmount) || null;
  const tolerance = Math.max(0, Math.round(Number(options.tolerance) || 0));
  const difference = receiptAmount === null ? 0 : receiptAmount - expected;

  let status: PaymentStatus = 'UNVERIFIED';
  // Harga layanan 0 = belum diketahui → jangan menuduh kurang/lebih bayar.
  // (Perilaku lama juga tidak menandai mismatch saat purchase_value = 0.)
  if (receiptAmount !== null && gross > 0 && expected > 0) {
    if (Math.abs(difference) <= tolerance) status = 'EXACT';
    else status = difference < 0 ? 'UNDERPAID' : 'OVERPAID';
  }

  return {
    gross,
    discount,
    net,
    deliveryFee,
    expected,
    receiptAmount,
    difference,
    tolerance,
    status,
    isMismatch: status === 'UNDERPAID' || status === 'OVERPAID',
    isUnderpaid: status === 'UNDERPAID',
    isOverpaid: status === 'OVERPAID',
  };
}
```

### 5.2 Helper reservasi: `src/services/reservation-core.service.ts`

Tambahkan `import { resolveExpectedPayment } from '../domain/payment-expected';` di blok import paling atas file, lalu tambahkan fungsi tepat setelah `resolveDeliveryFeeSnapshot` (baris 428-434):

```ts
/** Evaluasi tagihan kanonis untuk payload API (dipakai list, detail, livechat). */
export function resolveReservationPaymentEvaluation(
  reservation: any,
  tolerance = 0
) {
  return resolveExpectedPayment(
    {
      purchaseValue: reservation?.purchase_value,
      discountAmount: reservation?.discount_amount,
      deliveryFee: resolveDeliveryFeeSnapshot(reservation),
      receiptAmount: reservation?.receipt_amount,
    },
    { tolerance }
  );
}
```

### 5.3 Backend pembayaran: `src/services/customer-payment-proof.service.ts:179-205`

Ganti blok perhitungan dengan:

```ts
const deliveryFee = resolveDeliveryFeeSnapshot(reservation as any);
const existingPurchaseValue = Number((reservation as any).purchase_value) || 0;
const payment = resolveExpectedPayment({
  purchaseValue: existingPurchaseValue,
  discountAmount: (reservation as any).discount_amount,
  deliveryFee,
  receiptAmount: signal.amount,
});
const totalExpected = payment.expected;
const isMismatch = payment.isMismatch;
const isUnderpaid = payment.isUnderpaid;
```

Sisanya:
- `finalPurchaseValue` tetap: bila `existingPurchaseValue === 0` → `Math.max(0, (signal.amount ?? 0) - deliveryFee)`.
- Tag mismatch (baris ~230) memakai `EXPECTED=${payment.expected};DIFF=${payment.difference}`.
- `auditService.logAdminAction` payload menambah `gross`, `discount`, `net`, `paymentStatus`.
- SSE payload menambah `paymentStatus`, `discount`.

### 5.4 Payload API

**(a) `src/routes/admin/reservation-crud.route.ts`**

Tambahkan import:

```ts
import { reservationCoreService, ReservationConflictError, resolveReservationPaymentEvaluation } from '../../services/reservation-core.service';
```

Tambahkan helper di atas `export async function reservationCrudRoutes`:

```ts
function withPaymentEvaluation(r: any) {
  return { ...r, paymentEvaluation: resolveReservationPaymentEvaluation(r) };
}
```

Terapkan di **tiga** mapper:
1. DB branch: `const data = rows.map((r) => ({ ...r, ... }))` (baris 419) → bungkus `withPaymentEvaluation({...})`.
2. DB fallback tanpa relasi children (baris 466) → idem.
3. Memory branch (baris 492-505) → hasil `data = filterMemoryByTenant(...).map(...)` dibungkus.

Contoh (DB branch):

```ts
const data = rows.map((r) =>
  withPaymentEvaluation({
    ...r,
    notes: (r as any).notes || extractNotesFromRawText(r.raw_text),
    baby_details: extractBabyDetails(r.raw_text),
    mom_gestational_info: resolveMomGestationalInfo({
      text: `${r.raw_text || ''} ${r.treatment_detail || ''}`,
      treatmentCategory: (r as any).treatment_category,
      registeredAt: (r as any).created_at,
    }),
    customer: r.customer ? { ...r.customer, /* ... */ } : undefined,
  })
);
```

**(b) `src/services/live-chat.service.ts`**

- Hapus fallback `parseReceiptAmountFromRawText` pada `receipt_amount` (baris 1304); ganti:

```ts
receipt_amount:
  (res as any).receipt_amount !== undefined && (res as any).receipt_amount !== null
    ? Number((res as any).receipt_amount)
    : null,
paymentEvaluation: resolveReservationPaymentEvaluation(res),
```

- Import `resolveReservationPaymentEvaluation` dari `./reservation-core.service`.
- Pastikan query reservasi livechat meng-include `customer` (atau `delivery_fee` selalu terisi) agar fallback `Customer.ongkir` di `resolveDeliveryFeeSnapshot` bekerja; jika tidak, tambahkan `include: { customer: { select: { ongkir: true } } }` pada query terkait.
- Setelah tidak ada pemanggil lain, hapus fungsi `parseReceiptAmountFromRawText` (baris 13-...) **dan** test yang mengujinya (pindahkan kasusnya ke test evaluasi baru).

**(c) `src/routes/admin/customers.subroute.ts` — `active-reservations`**

- Tambah `discount_amount: true` pada `select` (baris ~1020).
- Map hasil:

```ts
const data = reservations.map((r) => ({
  ...r,
  paymentEvaluation: resolveReservationPaymentEvaluation(r),
}));
```

### 5.5 Frontend: hapus logika uang

**(a) `packages/admin-dashboard/src/types/index.ts`**

Tambahkan ke interface reservasi:

```ts
paymentEvaluation?: {
  gross: number;
  discount: number;
  net: number;
  deliveryFee: number;
  expected: number;
  receiptAmount: number | null;
  difference: number;
  tolerance: number;
  status: 'UNVERIFIED' | 'EXACT' | 'UNDERPAID' | 'OVERPAID';
  isMismatch: boolean;
  isUnderpaid: boolean;
  isOverpaid: boolean;
} | null;
```

**(b) `packages/admin-dashboard/src/utils/paymentProof.ts`**

Ganti **seluruh isi** dengan adapter presentasi (tanpa regex, tanpa aritmetika tagihan):

```ts
export interface PaymentProofEvaluation {
  hasProof: boolean;
  totalExpected: number;
  receiptAmount: number | null;
  isMismatch: boolean;
  isUnderpaid: boolean;
  isOverpaid: boolean;
  difference: number;
  badgeVariant: 'mismatch_red' | 'match_green' | 'unverified_gray';
  badgeLabel: string;
  description: string;
}

type ReservationLike = {
  proof_url?: string | null;
  paymentEvaluation?: {
    expected: number;
    receiptAmount: number | null;
    status: 'UNVERIFIED' | 'EXACT' | 'UNDERPAID' | 'OVERPAID';
    isMismatch: boolean;
    isUnderpaid: boolean;
    isOverpaid: boolean;
    difference: number;
  } | null;
};

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export function evaluatePaymentProof(reservation?: ReservationLike | null): PaymentProofEvaluation {
  if (!reservation?.proof_url) {
    return {
      hasProof: false, totalExpected: 0, receiptAmount: null,
      isMismatch: false, isUnderpaid: false, isOverpaid: false, difference: 0,
      badgeVariant: 'unverified_gray', badgeLabel: 'Tidak Ada Bukti',
      description: 'Belum ada bukti transfer terlampir.',
    };
  }

  const p = reservation.paymentEvaluation;
  if (!p) {
    return {
      hasProof: true, totalExpected: 0, receiptAmount: null,
      isMismatch: false, isUnderpaid: false, isOverpaid: false, difference: 0,
      badgeVariant: 'unverified_gray', badgeLabel: 'Evaluasi Belum Tersedia',
      description: 'Muat ulang data reservasi untuk menampilkan evaluasi tagihan.',
    };
  }

  if (p.receiptAmount === null || p.status === 'UNVERIFIED') {
    return {
      hasProof: true, totalExpected: p.expected, receiptAmount: p.receiptAmount,
      isMismatch: false, isUnderpaid: false, isOverpaid: false, difference: 0,
      badgeVariant: 'unverified_gray', badgeLabel: 'Nominal Struk Perlu Dicek',
      description: `Tagihan: ${rp(p.expected)} — nominal struk perlu dicek manual.`,
    };
  }

  if (p.isMismatch) {
    const diffText = p.isUnderpaid
      ? `Kurang ${rp(Math.abs(p.difference))}`
      : `Lebih ${rp(Math.abs(p.difference))}`;
    return {
      hasProof: true, totalExpected: p.expected, receiptAmount: p.receiptAmount,
      isMismatch: true, isUnderpaid: p.isUnderpaid, isOverpaid: p.isOverpaid, difference: p.difference,
      badgeVariant: 'mismatch_red', badgeLabel: diffText,
      description: `Ditransfer: ${rp(p.receiptAmount)} — Tagihan: ${rp(p.expected)} (${diffText}).`,
    };
  }

  return {
    hasProof: true, totalExpected: p.expected, receiptAmount: p.receiptAmount,
    isMismatch: false, isUnderpaid: false, isOverpaid: false, difference: 0,
    badgeVariant: 'match_green', badgeLabel: 'Nominal Sesuai',
    description: `Ditransfer: ${rp(p.receiptAmount)} (sesuai tagihan).`,
  };
}
```

Call-site (7 titik) **tidak perlu diubah** karena signature adapter dipertahankan.

### 5.6 A-014 — Hidupkan `discount_amount` (Q2)

**(a) API** — `src/routes/admin/reservation-dispatch.route.ts:816`:

```ts
Body: {
  // ...
  purchaseValue?: number;
  discountAmount?: number | null;   // tambahan
}
```

Dual-case map (baris ~843) tambahkan `discount_amount: 'discountAmount'`. Destructure `discountAmount`. Validasi:

```ts
if (discountAmount !== undefined) {
  const d = discountAmount === null ? null : Math.round(Number(discountAmount));
  if (d !== null && (!Number.isFinite(d) || d < 0)) {
    return reply.status(400).send({ success: false, error: 'discountAmount tidak valid.' });
  }
  const gross = purchaseValue !== undefined ? Number(purchaseValue) : Number(existing.purchase_value || 0);
  updateData.discount_amount = d === null ? null : Math.min(d, Math.max(0, gross));
}
```

**(b) UI** — di modal edit reservasi yang sudah ada (`ReservationDetailModal` / form edit), tambah input Diskon di sebelah nominal layanan; kirim `discountAmount`. **Dilarang** membuat halaman baru.

**(c) Sheets** — tidak berubah: `row-formatter.ts` sudah membaca `discount_amount`.

### 5.7 Test adversarial

Buat `tests/unit/payment-expected.test.ts`:

1. Tanpa diskon: 230.000 + 20.000 = 250.000, struk 250.000 → `EXACT`, `isMismatch=false`.
2. Diskon 50.000: gross 300.000, ongkir 20.000 → expected 270.000; struk 270.000 → `EXACT`.
3. Diskon > gross → `discount = gross`, `expected = ongkir` (tidak negatif).
4. Diskon negatif / `null` → `discount = 0`.
5. `purchase_value` negatif / string → 0.
6. Ongkir `null` → 0.
7. Struk `null` → `UNVERIFIED`, `isMismatch=false`.
8. Struk 0 → `UNVERIFIED`.
9. Kurang bayar 150.000 dari 250.000 → `UNDERPAID`, `difference=-100.000`.
10. Lebih bayar 300.000 dari 250.000 → `OVERPAID`.
11. Toleransi 3: expected 250.000, struk 250.003 → `EXACT` (tolerance 3).
12. Expected 0 (layanan 0 & ongkir 0) + struk 100.000 → `UNVERIFIED` (bukan overpaid).
13. Harga layanan 0 + ongkir 20.000 + struk 10.000 → `UNVERIFIED` (harga layanan belum diketahui; tidak menuduh kurang bayar).
14. Pembulatan desimal `250000.6` → 250001.

Buat `tests/unit/payment-proof-adapter.test.ts`:

1. Payload `EXACT` → `match_green`.
2. Payload `UNDERPAID` → `mismatch_red` + label "Kurang Rp …".
3. Payload `OVERPAID` → `mismatch_red`.
4. Payload `UNVERIFIED` → `unverified_gray`.
5. `paymentEvaluation` tidak ada → `unverified_gray`, **tidak** menghitung dari `purchase_value`.
6. Reservation tanpa `proof_url` → "Tidak Ada Bukti".
7. `raw_text` berisi `[RECEIPT_AMOUNT:999999]` **tidak** memengaruhi hasil (regresi anti-parsing).

Ubah `tests/unit/customer-payment-proof-mismatch.test.ts`:
- `baseActiveReservation` tambahkan `discount_amount: 0`.
- Tambah kasus: reservasi dengan `discount_amount: 50000`, `purchase_value: 300000`, `delivery_fee: 20000`, struk 270000 → `isMismatch=false`, `needs_staff_verification=false`.
- Tambah kasus: `purchase_value=0` → `finalPurchaseValue = max(0, amount - deliveryFee)` tetap.

### Acceptance Phase 2
```powershell
npm run typecheck
npx vitest run tests/unit/payment-expected.test.ts tests/unit/payment-proof-adapter.test.ts tests/unit/customer-payment-proof-mismatch.test.ts tests/unit/customer-payment-proof.test.ts tests/unit/reservation-payment-display.test.ts tests/unit/customer-delivery-fee-resolver.test.ts
(Select-String -Path packages/admin-dashboard/src/utils/paymentProof.ts -Pattern "RECEIPT_AMOUNT|purchase_value|delivery_fee").Count   # 0
(Select-String -Path src/services/live-chat.service.ts -Pattern "parseReceiptAmountFromRawText").Count                              # 0
```

### FMEA
| Risiko | S | O | D | RPN | Mitigasi |
|---|---|---|---|---|---|
| `purchase_value` ternyata net → diskon dipotong 2x | 8 | 3 | 3 | 72 | verifikasi SQL 3 baris sebelum eksekusi (Q-verifikasi) |
| Payload lama tanpa `paymentEvaluation` → badge kosong | 4 | 5 | 2 | 40 | adapter menampilkan "Evaluasi Belum Tersedia", bukan merah |
| FE & BE beda versi saat deploy | 4 | 4 | 3 | 48 | adapter kompatibel; cache list hanya 5 detik |
| `discount_amount` diisi > harga | 6 | 3 | 2 | 36 | clamp di API + test |

### Rollback
`git revert` fase ini. Tidak ada migrasi. `discount_amount` tetap kolom opsional.

---

## 6. Phase 3 — Konfigurasi Analitik per Tenant (A-001)

### Tujuan
Menghapus `'2025-08'`, `'2026-01'`, dan fallback `4` slot dari kode; memindahkannya ke `Tenant.settings.metaPerformanceSettings`.

### 6.1 Kontrak setting

`Tenant.settings.metaPerformanceSettings` bertambah:

```ts
{
  monthlySpends: Record<string, { lpwa?: number; ctwa?: number }>;
  grossMarginPct: number;
  minSampleThreshold: number;
  cohortStartMonth: string | null;        // 'YYYY-MM' atau null = tanpa batas
  excludedCohortMonths: string[];         // ['2025-08']
  dailySlotsPerTherapist: number | null;  // null = belum dikonfigurasi
}
```

### 6.2 API settings — `src/routes/admin/meta-attribution.subroute.ts:505-590`

**(a) GET** default:

```ts
const perfSettings = ((tenant?.settings as any)?.metaPerformanceSettings) || {
  monthlySpends: {},
  grossMarginPct: 40,
  minSampleThreshold: 20,
  cohortStartMonth: null,
  excludedCohortMonths: [],
  dailySlotsPerTherapist: null,
};
```

**(b) PUT** — perbaiki juga bug `updatedPerf` yang membuang key lain:

```ts
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const updatedPerf = {
  ...currentPerf,                                  // WAJIB: jangan buang key masa depan
  monthlySpends: {
    ...(currentPerf.monthlySpends || {}),
    ...(body.monthlySpends || {}),
  },
  grossMarginPct: typeof body.grossMarginPct === 'number' && body.grossMarginPct >= 0 && body.grossMarginPct <= 100
    ? body.grossMarginPct
    : (currentPerf.grossMarginPct ?? 40),
  minSampleThreshold: typeof body.minSampleThreshold === 'number' && body.minSampleThreshold > 0
    ? body.minSampleThreshold
    : (currentPerf.minSampleThreshold ?? 20),
  cohortStartMonth:
    body.cohortStartMonth === null ? null
    : typeof body.cohortStartMonth === 'string' && MONTH_RE.test(body.cohortStartMonth) ? body.cohortStartMonth
    : (currentPerf.cohortStartMonth ?? null),
  excludedCohortMonths: Array.isArray(body.excludedCohortMonths)
    ? Array.from(new Set(body.excludedCohortMonths.filter((m: unknown) => typeof m === 'string' && MONTH_RE.test(m))))
    : (currentPerf.excludedCohortMonths ?? []),
  dailySlotsPerTherapist:
    body.dailySlotsPerTherapist === null ? null
    : typeof body.dailySlotsPerTherapist === 'number' && body.dailySlotsPerTherapist > 0 && body.dailySlotsPerTherapist <= 50
    ? Math.round(body.dailySlotsPerTherapist)
    : (currentPerf.dailySlotsPerTherapist ?? null),
};
```

Tambahkan field-field itu ke tipe `Body` PUT.

### 6.3 Service — `src/services/meta-performance-analytics.service.ts`

**(a) Tipe parameter** (`BuildMonthlyCohortsParams`, baris 454-465):

```ts
cohortStartMonth?: string | null;
excludedCohortMonths?: string[];
```

**(b) Destructure** (baris 472-482):

```ts
cohortStartMonth = null,
excludedCohortMonths = [],
```

**(c) Filter kohort** (baris 565-569) ganti menjadi:

```ts
const excludedMonths = new Set(excludedCohortMonths);
let allMonths = Array.from(new Set(patientInfos.map((p) => p.cohortMonth)))
  .filter((m) => !excludedMonths.has(m))
  .filter((m) => !cohortStartMonth || m >= cohortStartMonth)
  .sort((a, b) => (a < b ? 1 : -1));
if (!allMonths.includes(currentWibMonth) && (!cohortStartMonth || currentWibMonth >= cohortStartMonth)) {
  allMonths.unshift(currentWibMonth);
}
```

**(d) Panggilan** (baris 1346-1352) tambahkan:

```ts
cohortStartMonth: typeof tenantSettings?.cohortStartMonth === 'string' ? tenantSettings.cohortStartMonth : null,
excludedCohortMonths: Array.isArray(tenantSettings?.excludedCohortMonths)
  ? tenantSettings.excludedCohortMonths.filter((m: unknown) => typeof m === 'string')
  : [],
```

**(e) Kapasitas terapis** (baris 1380-1384) ganti:

```ts
const configuredSlots =
  typeof tenantSettings?.dailySlotsPerTherapist === 'number' && tenantSettings.dailySlotsPerTherapist > 0
    ? Math.round(tenantSettings.dailySlotsPerTherapist)
    : null;

if (activeTherapists !== null) {
  const totalSlotsCapacity =
    configuredSlots === null ? null : activeTherapists * configuredSlots * rangeDayKeys.size;
  const utilizationPct =
    totalSlotsCapacity && totalSlotsCapacity > 0 ? round2((bookingCount / totalSlotsCapacity) * 100) : null;
  therapistCapacity = {
    activeTherapists,
    dailySlotsPerTherapist: configuredSlots,
    totalSlotsCapacity,
    bookingCount,
    utilizationPct,
    band: capacityBandFor(utilizationPct),
  };
}
```

**(f) Tipe report** (baris 240-246):

```ts
dailySlotsPerTherapist: number | null;
totalSlotsCapacity: number | null;
```

### 6.4 Frontend — `packages/admin-dashboard/src/components/meta-performance/TherapistUtilizationCard.tsx`

- Baris 36 dan 54: ganti `{cap.dailySlotsPerTherapist || 4}` → `{cap.dailySlotsPerTherapist ?? '—'}`.
- Jika `configuredSlots === null`, tampilkan teks: `Kapasitas belum dikonfigurasi admin` (bukan angka 4).
- Baris 34: ganti menjadi `{cap.totalSlotsCapacity === null ? '—' : fmtNum(cap.totalSlotsCapacity)}` agar tidak memanggil `fmtNum(null)`.

### 6.5 UI setting — `MetaPerformancePanel.tsx`

Di panel yang sudah ada, tambahkan blok "Konfigurasi Analitik" (collapsible) berisi:
- input bulan mulai kohort (`type="month"`),
- input daftar bulan dikecualikan (comma-separated, divalidasi `YYYY-MM` di backend),
- input slot/terapis/hari (number, kosong = belum dikonfigurasi).

Simpan lewat `updateMetaPerformanceSettings` yang sudah ada. **Dilarang** membuat halaman/menu baru.

### 6.6 Skrip seed konfigurasi tenant (Q4)

Buat `src/scripts/seed-analytics-settings.ts`:

```powershell
npx tsx src/scripts/seed-analytics-settings.ts --tenant=default-tenant --cohort-start=2026-01 --excluded=2025-08 --slots=4          # dry-run
npx tsx src/scripts/seed-analytics-settings.ts --tenant=default-tenant --cohort-start=2026-01 --excluded=2025-08 --slots=4 --commit
```

Aturan:
- Tanpa `--commit` hanya mencetak nilai yang akan ditulis.
- Hanya menulis key yang **belum ada** (idempoten); tidak menimpa setting admin.
- Tidak ada nilai bisnis hardcoded di dalam skrip; semua dari argumen CLI.

### 6.7 Test

Ubah `tests/unit/meta-performance-analytics.test.ts`:

1. Hapus/hapus-ulang test `'mengecualikan outlier masa lalu 2025-08'` menjadi **dua** test:
   - `buildMonthlyCohorts({ ..., excludedCohortMonths: ['2025-08'], cohortStartMonth: '2026-01' })` → baris 2025-08 tidak ada.
   - Tanpa config → baris 2025-08 **ADA** (membuktikan tidak ada hardcode).
2. Test dua tenant: tenant A `excludedCohortMonths=[]`, tenant B `excludedCohortMonths=['2025-08']` → baris berbeda.
3. Kapasitas: `dailySlotsPerTherapist=6`, 3 terapis, 10 hari → 180 slot.
4. Tanpa `dailySlotsPerTherapist` → `dailySlotsPerTherapist=null`, `totalSlotsCapacity=null`, `utilizationPct=null`, `band='UNKNOWN'`.
5. Ganti assertion lama `toBe(4)` (baris 369) menjadi konfigurasi eksplisit di fixture.

### Acceptance Phase 3
```powershell
npm run typecheck
npx vitest run tests/unit/meta-performance-analytics.test.ts tests/unit/admin-analytics-tenant.test.ts
(Select-String -Path src/services/meta-performance-analytics.service.ts -Pattern "2025-08|2026-01|\?\? 4").Count   # 0
npx tsx src/scripts/seed-analytics-settings.ts --tenant=default-tenant --cohort-start=2026-01 --excluded=2025-08 --slots=4   # dry-run
```

### FMEA
| Risiko | S | O | D | RPN | Mitigasi |
|---|---|---|---|---|---|
| Angka dashboard berubah mendadak | 6 | 4 | 2 | 48 | seed eksplisit sebelum deploy + dry-run |
| PUT settings membuang key lain | 5 | 5 | 3 | 75 | `...currentPerf` + test round-trip |
| `null` slot membuat UI crash | 4 | 3 | 2 | 24 | `fmtNum(null)`/`?? '—'` + test render |
| Tenant lupa mengisi config | 5 | 4 | 1 | 20 | badge `UNKNOWN` + teks "belum dikonfigurasi" |

### Rollback
Kembalikan kode + setting lama lewat PUT. Tidak ada migrasi.

---

## 7. Phase 4 — Estimasi Ongkir Ber-TTL & Terikat Alamat (A-004)

### Tujuan
Estimasi ongkir dari chat admin hanya dipakai bila (a) belum kedaluwarsa dan (b) alamatnya sama dengan alamat aktif. Jika tidak, jatuh ke ongkir resmi.

### 7.1 Domain: `src/domain/customer-address.ts`

Tambahkan helper murni (setelah `resolveActiveAddress`, baris 272):

```ts
/** Kunci identitas alamat: koordinat presisi bila ada, selain itu teks ternormalisasi. */
export function buildAddressKey(input: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
}): string | null {
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `geo:${lat.toFixed(5)},${lng.toFixed(5)}`;
  }
  const parts = [input.address, input.kelurahan, input.kecamatan, input.kota]
    .map((v) => (v ? norm(String(v)) : ''))
    .filter(Boolean);
  return parts.length > 0 ? `txt:${parts.join('|')}` : null;
}
```

### 7.2 Tenant setting TTL

`Tenant.settings.deliverySettings.estimateTtlDays` (number, default **14**).
Reader di `getLastDeliveryFee` (bukan di penulis) memakai default 14 bila belum diset. Nilai default ini adalah fallback teknis, bukan data bisnis klinik; tetap dapat diubah per tenant via settings.

Tambahkan ke GET/PUT settings admin yang sudah menangani `metaPerformanceSettings`? **Tidak** — gunakan key terpisah `deliverySettings` dan endpoint yang sama (`/api/admin/meta-performance/settings`) hanya jika tidak mengganggu. Jika tidak, cukup baca langsung di service dan sediakan skrip seed:

```powershell
npx tsx src/scripts/seed-delivery-settings.ts --tenant=default-tenant --ttl-days=14 --commit
```

### 7.3 Penulis estimasi — `src/services/human-background-enrichment.service.ts:214-233`

Import `buildAddressKey` dari `../domain/customer-address`.

Tambahkan helper di atas fungsi (setelah `tryEnrichZipcodeViaGazetteer`):

```ts
const DELIVERY_ESTIMATE_TTL_FALLBACK_DAYS = 14;

async function resolveEstimateTtlDays(tenantId: string): Promise<number> {
  try {
    const { prisma } = await import('../db/client');
    const t = await (prisma.tenant as any).findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const n = Number((t?.settings as any)?.deliverySettings?.estimateTtlDays);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : DELIVERY_ESTIMATE_TTL_FALLBACK_DAYS;
  } catch {
    return DELIVERY_ESTIMATE_TTL_FALLBACK_DAYS;
  }
}
```

Lalu di blok `else` (tanpa GPS presisi):

```ts
const ttlDays = await resolveEstimateTtlDays(tenantId);
const estimate = {
  km: parsed.distanceKm,
  ongkir: effectiveOngkir,
  by: 'admin_chat',
  at: new Date().toISOString(),
  address_key: buildAddressKey({
    lat: customer.lat,
    lng: customer.lng,
    address: addrPref,
    kelurahan: customer.kelurahan,
    kecamatan: customer.kecamatan,
    kota: customer.kota,
  }),
  expires_at: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
};
```

### 7.4 Pembaca — `src/services/customer.service.ts:2761-2800`

Import `parseSavedAddresses`, `resolveActiveAddress`, `buildAddressKey` dari `../domain/customer-address`.

Ganti blok preferensi (baris 2781-2793) dengan:

```ts
const prefs = (cust.preferences as any) || {};

// 2. Estimasi chat: HANYA bila belum kedaluwarsa DAN alamatnya sama dengan alamat aktif.
const estimate = prefs.distance_estimate;
if (estimate && typeof estimate === 'object') {
  const expiresAtMs = estimate.expires_at ? Date.parse(String(estimate.expires_at)) : NaN;
  const notExpired = Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
  const active = resolveActiveAddress(parseSavedAddresses(prefs));
  const activeKey = active
    ? buildAddressKey(active)
    : buildAddressKey({
        lat: (cust as any).lat,
        lng: (cust as any).lng,
        address: prefs.address ?? prefs.full_address,
        kelurahan: (cust as any).kelurahan,
        kecamatan: (cust as any).kecamatan,
        kota: (cust as any).kota,
      });
  const sameAddress = Boolean(estimate.address_key) && estimate.address_key === activeKey;
  const estOngkir = estimate.ongkir;
  if (notExpired && sameAddress && typeof estOngkir === 'number' && !isNaN(estOngkir) && estOngkir >= 0) {
    return estOngkir;
  }
}

// 3. Kartu buku alamat aktif (primary menang; fallback lastUsedAt terbaru).
const active = resolveActiveAddress(parseSavedAddresses(prefs));
if (typeof active?.ongkir === 'number' && !isNaN(active.ongkir) && active.ongkir >= 0) {
  return active.ongkir;
}

// 4. Fallback legacy: Customer.ongkir resmi
const legacy = (cust as any)?.ongkir;
if (typeof legacy === 'number' && legacy >= 0) return legacy;
```

Perbaiki doc-comment baris 2755-2759 agar sesuai urutan nyata: *snapshot reservasi → estimasi chat (valid) → kartu alamat aktif → `Customer.ongkir`*.

Catatan: `select` baris 2773 perlu ditambah `lat: true, lng: true, kelurahan: true, kecamatan: true, kota: true` agar kunci alamat dapat dihitung.

### 7.5 Test adversarial — `tests/unit/customer-delivery-fee-resolver.test.ts`

Ubah 4 test prioritas yang sudah ada (tambahkan `expires_at`, `address_key`, `saved_addresses` yang cocok). Tambah:

1. Estimasi kedaluwarsa (`expires_at` kemarin) → **diabaikan**, jatuh ke kartu alamat.
2. Estimasi tanpa `expires_at` (data lama) → **diabaikan** (fail-closed).
3. Estimasi `address_key` beda dengan alamat aktif → **diabaikan**.
4. Estimasi cocok + belum kedaluwarsa → dipakai.
5. `saved_addresses` punya primary lama & non-primary terbaru → memakai primary (`resolveActiveAddress`).
6. Tanpa primary → memakai `lastUsedAt` terbaru, bukan `addrs[0]`.
7. DB offline → `null`.

### Acceptance Phase 4
```powershell
npm run typecheck
npx vitest run tests/unit/customer-delivery-fee-resolver.test.ts tests/unit/customer-saved-addresses.test.ts tests/unit/multi-address-fase3.test.ts tests/unit/reservation-address-seam.test.ts
(Select-String -Path src/services/customer.service.ts -Pattern "addrs\[0\]").Count   # 0
```

### FMEA
| Risiko | S | O | D | RPN | Mitigasi |
|---|---|---|---|---|---|
| Ongkir promo berhenti terpakai (data lama tanpa `expires_at`) | 6 | 5 | 2 | 60 | fail-closed disengaja; admin dapat memasukkan ongkir manual |
| Kunci alamat terlalu ketat (format teks beda) | 5 | 4 | 3 | 60 | utamakan koordinat; teks dinormalisasi `norm()` |
| Dua rumah beda tapi key sama | 5 | 2 | 4 | 40 | koordinat 5 desimal ≈ 1 m; teks menyertakan kelurahan/kecamatan/kota |
| Customer pindah rumah tetap memakai estimasi lama | 7 | 2 | 2 | 28 | kunci alamat + TTL |

### Rollback
Revert commit. Data `distance_estimate` lama tetap ada tetapi diabaikan (aman). Tidak ada migrasi.

---

## 8. Phase 5 — Perketat Merge Alamat (A-005)

### Tujuan
Mencegah dua rumah berbeda di perumahan yang sama ter-merge hanya karena teks jalan ≥ 15 karakter.

### Micro-task 5.1 — `src/domain/customer-address.ts:192-196`

Ganti:

```ts
const isSpecificStreet =
  norm(a.address).length >= 15 ||
  /\b(?:no|nomor|blok|gang|gg|cluster|perum|perumahan|rt|rw)\b/i.test(a.address || '');
if (isSpecificStreet) return true;
```

Menjadi:

```ts
// Hanya alamat yang MEMUAT nomor/blok/RT-RW eksplisit yang boleh merge lintas
// kecamatan. Nama perumahan tanpa nomor TIDAK cukup (anti-over-merge rumah-2).
const streetText = `${a.address || ''} ${b.address || ''}`;
const hasHouseNumber = /\b(?:no|nomor|blok|gang|gg|cluster|perum|perumahan|rt|rw)\s*\.?\s*\d+/i.test(streetText);
if (hasHouseNumber && norm(a.address).length >= 8) return true;
```

### Micro-task 5.2 — Test

Tambah ke `tests/unit/address-match-toponimi.test.ts`:

1. `'Perumahan Mutiara Indah'` (tanpa nomor) di kecamatan berbeda, jarak < 3 km → **TIDAK match**.
2. `'Jl. Mutiara Indah No. 12'` di kecamatan berbeda, jarak < 3 km → **match**.
3. `'Jl. Mutiara Indah Blok C7'` → **match**.
4. Dua rumah beda nomor (`No. 12` vs `No. 14`) di jalan sama, kecamatan beda → **TIDAK match** (nomor berbeda).
5. Kasus 1 & 2 lama (`GG 2 no 6`, `No. 12`) → tetap **match** (regresi positif).

### Acceptance
```powershell
npm run typecheck
npx vitest run tests/unit/address-match-toponimi.test.ts tests/unit/customer-saved-addresses.test.ts tests/unit/customer-address-book.test.ts tests/unit/customer-address-rumah-kedua.test.ts tests/unit/dashboard-address-match-parity.test.ts
```

### FMEA
| Risiko | S | O | D | RPN | Mitigasi |
|---|---|---|---|---|---|
| Alamat sah tanpa nomor jadi duplikat | 4 | 6 | 2 | 48 | admin tetap bisa merge manual lewat buku alamat |
| Nomor rumah berbeda malah merge | 7 | 2 | 3 | 42 | aturan nomor belum membandingkan angka; tahap lanjut: ekstrak nomor |

### Rollback
Revert fungsi murni; tidak ada data berubah.

---

## 9. Phase 6 — Konvergensi Penulis `Customer.name` (A-012)

### Tujuan
Semua jalur tulis nama melewati satu seam ber-provenance, sehingga perbaikan `ddf5f8f1` tidak bisa dibobol dari edit reservasi admin.

### Dependency
Plan ini **memakai** `docs/plans/PLAN_OTORITAS_IDENTITAS_PELANGGAN_2026-10-29.md` Phase 2-4 (kolom `name_source` + seam `updateCustomerName`). Jika migrasi ditolak → Mode B plan identitas §9.

### Micro-task (ringkas, detail penuh di plan identitas)

| File | Baris (2026-10-29) | Aksi |
|---|---|---|
| `src/services/customer.service.ts` | 962-1009 | Implementasi seam ber-provenance (plan identitas Phase 3) |
| `src/services/customer.service.ts` | 1076 (`updateCustomer`) | Hapus tulis `updateData.name` langsung; panggil `updateCustomerName(..., { source: 'admin' })` setelah update field lain |
| `src/services/reservation-lifecycle.service.ts` | 58 | Tambah `{ source: 'reservation' }` |
| `src/state-machine/machine.ts` | 416-427 | **Hapus blok** tulis nama (duplikat lifecycle; tidak punya `reservationId`) |
| `src/routes/admin/reservation-crud.route.ts` | 759 | `{ source: 'admin', force }` |
| `src/routes/admin/reservation-dispatch.route.ts` | 1245 | Hapus `custUpdate.name = customerName`; panggil `updateCustomerName(existing.customer_id, customerName, tenantId, { source: 'admin' })` |
| `src/routes/admin/reservation-dispatch.route.ts` | 2206 | `{ source: 'reservation' }` |
| `src/services/waha-history-sync.service.ts` | 248, 482 | `{ source: 'sync' }` + simpan pushName mentah ke `whatsapp_push_name` |
| `scripts/recover-lost-reservations.ts` | 127 | `{ source: 'reservation' }`; buang tempelan toponimi |

### Acceptance
```powershell
npm run typecheck
(Select-String -Path src,scripts -Include *.ts -Recurse -Pattern "data:\s*\{\s*name\s*:").Count   # hanya seam customer.service
npx vitest run tests/unit/customer-name-protection.test.ts tests/unit/customer-name-healing.test.ts tests/unit/name-sanitizer.test.ts tests/unit/customer-name-provenance.test.ts
```

### FMEA
| Risiko | S | O | D | RPN | Mitigasi |
|---|---|---|---|---|---|
| Nama pelanggan lama tidak bisa dikoreksi otomatis | 6 | 4 | 3 | 72 | admin force + skrip healing dry-run |
| Jalur tulis tertinggal | 5 | 4 | 6 | 120 | grep gate + test integrasi |
| Migrasi produksi | 9 | 2 | 2 | 36 | aditif `IF NOT EXISTS` + backup |

### Rollback
Revert commit + kolom aditif dibiarkan (tidak perlu drop). Data nama tidak dihapus.

---

## 10. Phase 7 — Identitas Anak Atomik (A-006)

### Tujuan
Dedup nama anak case-insensitive aman dari balapan webhook, dan tautan reservasi pertama tidak hilang.

### 10.1 Migrasi (Confirmation Gate)

`prisma/schema.prisma` (`model Child`, baris 155-171):

```prisma
  name                       String
  /// Nama ternormalisasi (lower + trim) untuk dedup case-insensitive lintas DB.
  name_norm                  String
  /// Reservasi pertama yang mendaftarkan anak (riwayat abadi).
  first_reservation_id       String?
  /// Reservasi terakhir yang menyebut anak (audit).
  last_reservation_id        String?

  @@unique([customer_id, name_norm])
  @@index([tenant_id])
```

Migrasi:

```sql
ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "name_norm" TEXT;
ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "first_reservation_id" TEXT;
ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "last_reservation_id" TEXT;

UPDATE "children" SET "name_norm" = lower(btrim("name")) WHERE "name_norm" IS NULL;
UPDATE "children" SET "first_reservation_id" = "reservation_id" WHERE "first_reservation_id" IS NULL;

ALTER TABLE "children" ALTER COLUMN "name_norm" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "children_customer_id_name_norm_key" ON "children"("customer_id", "name_norm");
```

Prasyarat: cek duplikat dulu.

```sql
SELECT customer_id, lower(btrim(name)) AS n, COUNT(*)
FROM children GROUP BY 1,2 HAVING COUNT(*) > 1;
```

Jika ada baris: gabungkan manual (pilih `id` tertua, pindahkan `reservation_id`), baru jalankan migrasi.

### 10.2 Service — `src/services/child.service.ts:44-76`

Ganti `findFirst` + `update`/`upsert` dengan satu `upsert` atomik:

```ts
const nameNorm = baby.name.trim().toLowerCase();

const existing = await prisma.child.findUnique({
  where: { customer_id_name_norm: { customer_id: customerId, name_norm: nameNorm } },
  select: { id: true, first_reservation_id: true },
});

await prisma.child.upsert({
  where: { customer_id_name_norm: { customer_id: customerId, name_norm: nameNorm } },
  create: {
    tenant_id: tenantId,
    customer_id: customerId,
    reservation_id: reservationId ?? null,
    first_reservation_id: reservationId ?? null,
    last_reservation_id: reservationId ?? null,
    name: baby.name,
    name_norm: nameNorm,
    birth_date: birthDate,
    age_months_at_registration: ageMonthsAtReg,
    raw_age_text: baby.age || null,
  },
  update: {
    last_reservation_id: reservationId ?? undefined,
    birth_date: birthDate ?? undefined,
    age_months_at_registration: ageMonthsAtReg ?? undefined,
    raw_age_text: baby.age || undefined,
    // name_norm & first_reservation_id TIDAK diubah → riwayat pertama aman
  },
});
```

Hapus guard `typeof prisma.child.findFirst === 'function'` (hanya untuk mock lama).
Hapus `existing` jika tidak dipakai (kecuali untuk log).

Catatan kompatibilitas: `reservation_id` lama tetap dipertahankan sebagai tautan pertama (tidak di-update). `first_reservation_id`/`last_reservation_id` adalah kanal baru; `reservation_id` dapat di-backfill = `first_reservation_id`.

### 10.3 Test

Ubah `tests/unit/child-service.test.ts`:

1. Dua panggilan konkuren `Promise.all` untuk `'Zayn'` dan `'zayn'` → `prisma.child.upsert` dipanggil dengan `where.customer_id_name_norm` sama; hasil akhir 1 baris.
2. `reservation_id` pertama tidak berubah saat reservasi kedua.
3. `last_reservation_id` berubah ke reservasi terbaru.
4. Nama dengan spasi ganda `'  Zayn  '` → `name_norm='zayn'`.
5. Nama placeholder tetap ditolak sebelum menyentuh DB.
6. DB error → senyap.

### Acceptance
```powershell
npm run typecheck
npx vitest run tests/unit/child-service.test.ts tests/unit/child-entity-validation.test.ts tests/unit/multi-child-honorific.test.ts
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script   # "-- This is an empty migration."
```

### FMEA
| Risiko | S | O | D | RPN | Mitigasi |
|---|---|---|---|---|---|
| Migrasi gagal karena duplikat lama | 7 | 4 | 2 | 56 | query prasyarat + merge manual |
| `name_norm` kosong (nama hanya spasi) | 5 | 2 | 2 | 20 | filter `b.name` sudah ada; tambah trim check |
| `first_reservation_id` tidak terisi | 3 | 3 | 3 | 27 | backfill dari `reservation_id` |

### Rollback
Kode di-revert; kolom aditif dibiarkan. Unique index dapat di-drop manual bila darurat:
`DROP INDEX IF EXISTS "children_customer_id_name_norm_key";`

---

## 11. Phase 8 — Dokumentasi, Proses, dan Known Issues (A-007…A-011, A-015)

### 8.1 `docs/METRIC_DEFINITIONS.md` (baru) — A-008

Isi minimal:
- Definisi MQL periode (sebelum/sesudah 2026-10-28).
- Definisi CAC, LTV, repeat order, kohort, kanal (CTWA/LPWA/PROMO_CTA).
- Tanggal berlaku + commit rujukan.
- Catatan: perubahan definisi **mengubah angka historis**; snapshot bulanan disarankan.

### 8.2 CHANGELOG retroaktif — A-009

Tambahkan entri di `docs/changelog/INDEX.md` + `CHANGELOG.md` untuk:
`d3b9c816` (delivery), `e2ae2b86` (payment), `aacd9cd3` (address/child), `ffece481` & `8c1dd757` & `4e366631` (analytics), `c9cbf1e1` (refactor). Gunakan tanggal commit asli.

### 8.3 Catatan commit `c9cbf1e1` — A-007

Tambahkan satu baris di CHANGELOG: *"Commit refactor ini juga memuat perubahan backend (tenant-aware analytics, `total` livechat, kontrak `/reservations/count`)."*
Kebijakan baru: commit berlabel `refactor` **tidak boleh** mengubah `src/` selain komentar. Verifikasi:

```powershell
git show <commit> -- src/ | Select-String -Pattern "^[+-]" | Select-String -NotMatch -Pattern "^[+-]\s*(//|\*|/\*)"
```
Harus kosong.

### 8.4 `docs/KNOWN_ISSUES.md` — A-010 + A-015

- Renumber entri `## 272` yang ganda (CAPI → `278`), perbarui rujukan.
- Tambah entri baru:
  - **279** [Payment] `discount_amount` tidak pernah ditulis sebelum Phase 2.6 (OPEN sampai Q2 dieksekusi).
  - **280** [Payment] `parseReceiptAmountFromRawText` masih ada sampai Phase 2 selesai (OPEN).
  - **281** [Analytics] definisi metrik berubah 2026-10-28 tanpa snapshot historis (OPEN).
  - **282** [Tenant] `customers.subroute.ts` masih ada `DEFAULT_TENANT_ID` sampai Phase 1 selesai (OPEN).
  - **283** [Delivery] estimasi ongkir lama tanpa `expires_at`/`address_key` akan diabaikan (by design, catat sebagai perilaku).
- Perbarui status #274 (skrip `scripts/` tidak ikut image) → tetap OPEN, tetapi catat bahwa `0103714a` hanya memindahkan **satu** skrip.

### 8.5 A-011 — blacklist nama anak

Tidak diubah di plan ini. Wajib ditambah test adversarial: nama anak sah yang mengandung kata `hamil`/`nifas` (mis. "Hamilatus"?) tidak boleh ditolak. Jika test menemukan false-positive → buat tiket terpisah.

### Acceptance Phase 8
```powershell
npm run typecheck
npx vitest run tests/unit/child-entity-validation.test.ts
```
Dokumen diperiksa manual: tidak ada ID ganda, semua entri punya status OPEN/RESOLVED dan tanggal.

---

## 12. Matriks Gerbang Regresi

| Setelah Phase | Perintah wajib | Lulus jika |
|---|---|---|
| 0 | `npm run typecheck` + 7 test baseline | 0 error, semua hijau |
| 1 | `npm run typecheck` + 3 test integrasi | 0 error, hijau, grep `DEFAULT_TENANT_ID` = 0 |
| 2 | `npm run typecheck` + 6 test payment | 0 error, hijau, grep FE = 0 |
| 3 | `npm run typecheck` + 2 test analytics | 0 error, hijau, grep hardcode = 0 |
| 4 | `npm run typecheck` + 4 test alamat/ongkir | 0 error, hijau, grep `addrs[0]` = 0 |
| 5 | `npm run typecheck` + 5 test alamat | 0 error, hijau |
| 6 | `npm run typecheck` + 4 test nama | 0 error, hijau, grep penulis = 1 seam |
| 7 | `npm run typecheck` + 3 test anak + `prisma migrate diff` | 0 error, hijau, diff kosong |
| 8 | `npm test` (full suite) | tidak ada failure baru |

**Aturan failure:** jika ada test merah setelah fase, jalankan revert-and-rerun pada file yang diubah. Jika tetap merah di HEAD → pre-existing, catat, lanjut. Jika merah hanya setelah perubahan → **blocker**, perbaiki sebelum lanjut.

---

## 13. FMEA Program (Ringkas)

| Fase | Risiko utama | S | O | D | RPN | Mitigasi | Rollback |
|---|---|---|---|---|---|---|---|
| 1 | 401 massal karena tenant wajib | 6 | 3 | 2 | 36 | test boot app + header | revert |
| 2 | Salah rumus tagihan (gross vs net) | 8 | 3 | 3 | 72 | verifikasi SQL 3 baris | revert + flag adapter |
| 2 | FE/BE beda versi | 4 | 4 | 3 | 48 | adapter kompatibel | revert FE saja |
| 3 | Angka KPI berubah | 6 | 4 | 2 | 48 | seed eksplisit + dry-run | revert + PUT setting lama |
| 3 | PUT settings membuang key | 5 | 5 | 3 | 75 | spread `...currentPerf` + test | revert |
| 4 | Ongkir promo berhenti dipakai | 6 | 5 | 2 | 60 | fail-closed + input manual | revert |
| 5 | Alamat sah jadi duplikat | 4 | 6 | 2 | 48 | merge manual admin | revert |
| 6 | Nama lama tidak bisa dikoreksi | 6 | 4 | 3 | 72 | admin force + healing | revert |
| 7 | Migrasi gagal (duplikat) | 7 | 4 | 2 | 56 | query prasyarat | drop index |
| 8 | Dokumen tidak sinkron | 3 | 5 | 2 | 30 | review manual | revert |

---

## 14. Urutan Eksekusi & Estimasi

| Hari | Fase | Output |
|---|---|---|
| 1 | 0 + 1 | baseline + isolasi tenant |
| 2 | 2 (domain + backend) | seam tagihan + payload |
| 3 | 2 (FE + diskon) | adapter FE + A-014 |
| 4 | 3 | config analytics + seed |
| 5 | 4 | ongkir TTL |
| 6 | 5 + 8 (dokumen awal) | merge alamat + CHANGELOG |
| 7 | 6 | konvergensi nama (butuh migrasi) |
| 8 | 7 | identitas anak (butuh migrasi) |
| 9 | 8 + full suite | dokumentasi + gate akhir |

Estimasi ini kasar dan bergantung pada hasil verifikasi data produksi.

---

## 15. Yang Harus Dilakukan Sebelum Mulai (Checklist Pengguna)

- [ ] Setujui Q1–Q8 (atau ubah).
- [ ] Jalankan SQL verifikasi `discount_amount` dan tempel 3 baris hasilnya.
- [ ] Konfirmasi apakah migrasi `name_source` (Phase 6) dan `children.name_norm` (Phase 7) diizinkan.
- [ ] Konfirmasi nilai seed analitik tenant saat ini (`cohortStartMonth`, `excludedCohortMonths`, `dailySlotsPerTherapist`).
- [ ] Konfirmasi TTL ongkir (default 14 hari).
- [ ] Tulis "Setuju / Lanjut / Eksekusi" di chat.

---

## 16. Batasan Plan

- Plan ini **tidak** mengubah rumus metrik (A-008 hanya dokumentasi).
- Plan ini **tidak** menyelesaikan #274 (skrip `scripts/` tidak ikut image) — hanya dicatat.
- Plan ini **tidak** menjalankan `npm test` penuh sampai Phase 8; suite penuh memakan waktu dan tidak diperlukan di fase awal.
- Semua nomor baris adalah posisi per **2026-10-29** dan dapat bergeser setelah edit pertama. Selalu verifikasi dengan `Select-String` sebelum menambal.
- Jika `purchase_value` terbukti **net**, Phase 2 wajib direvisi sebelum eksekusi (lihat §2).
