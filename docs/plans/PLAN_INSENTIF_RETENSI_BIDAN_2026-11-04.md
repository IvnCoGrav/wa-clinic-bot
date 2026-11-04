# PLAN — Insentif Retensi Bidan (Staged Micro-Implementation)

Tanggal: 04 November 2026
Status: **APPROVED (Disetujui untuk dieksekusi). Keputusan teknis & checklist dikunci pada 04 Nov 2026.**
Pemilik produk: Owner klinik (Bidan Yusi)
Sasaran go-live: **Gaji #4 = Februari 2027** (gaji #1–#3 flat 50%)

## Dasar audit (bukti, bukan asumsi)

Seluruh angka di bawah diambil langsung dari PostgreSQL produksi `wa_clinic_db`
(43.173.11.79:1403) pada 04 Nov 2026, query `SELECT` saja.

| Fakta | Angka | Sumber |
|---|---|---|
| Reservasi completed | 560 | `reservations` |
| Reservasi tanpa `assigned_staff_id` | 262 / 574 (45,6%) | `reservations` |
| Penugasan bidan paling awal | 20 Agu 2026 | `MIN(booking_date)` |
| Akun Bidan Thabita dibuat | 26 Sep 2026 | `staff.created_at` |
| Akun Bidan Hanifah dibuat | 22 Sep 2026 | `staff.created_at` |
| Customer dengan ≥1 kunjungan completed | 300 | `reservations` |
| Retensi klinik 30 hari | 22,0% (53/241) | cohort matang |
| Retensi klinik 60 hari | 34,6% (64/185) | cohort matang |
| Retensi klinik 90 hari | 45,4% (59/130) | cohort matang |
| Retensi klinik 120 hari | 52,6% (40/76) | cohort matang |
| Median jarak kunjungan 1→2 | 32 hari | P75=62, P80=69, P90=90 |
| Bidan Thabita cohort matang 60h per 31 Jan 2027 | ± 72 pasien (proyeksi) | Sep 4 + Okt 36 + Nov ~30 |
| Bidan Hanifah volume | 2–4 pasien baru/bulan | tidak layak retensi |
| Pasien dengan 2+ reservasi di tanggal sama | 4 kasus | wajib dedupe per tanggal |
| Reservasi completed tanpa `reservation_items` | 429/560 (76,6%) | bukan blocker |
| `purchase_value` kosong | 0/560 | data nominal bersih |

**Klaim yang diverifikasi dan hasilnya:**

| Klaim | Status | Bukti |
|---|---|---|
| "Tanpa bidan = Yusi" | ✅ TERBUKTI | Sebelum 26 Sep 2026 tidak ada akun bidan lain; 23 dari 24 reservasi tanpa bidan pasca-20 Agu terjadi sebelum 25 Sep |
| `is_repeat_order` bisa dipakai | ❌ DITOLAK | Dihitung dari prior count klinik (`sheets-sync.service.ts:470`), bukan per bidan |
| Role Yusi `ADMIN_CS` adalah bug | ❌ DITOLAK | Yusi = owner; role memang sengaja. Diganti dengan flag `incentive_eligible` |
| Data bidan cukup untuk evaluasi sekarang | ❌ DITOLAK | Thabita 91% cohort belum matang; tidak ada cohort 90h yang matang |

## Keputusan yang dikunci (tidak dibuka lagi tanpa revisi plan)

| # | Parameter | Nilai |
|---|---|---|
| D1 | Jendela retensi | **60 hari** |
| D2 | Pool | **6 bulan bergulir** |
| D3 | Benchmark | **34,6%**, dibekukan dari cohort Apr–Okt 2026 |
| D4 | Tingkat 1 | retensi **< 31,1%** → **50:50** |
| D5 | Tingkat 2 | **31,1% – 38,1%** → **55:45** |
| D6 | Tingkat 3 | **≥ 38,1%** → **60:40** |
| D7 | Sampel minimum | **40 pasien matang** |
| D8 | Masa kerja minimum | **4 bulan** |
| D9 | Turun tingkat | **2 periode berturut-turut** |
| D10 | Soft landing gaji #4 | bayaran **minimum 55:45** |
| D11 | Owner | **tidak ikut skema** (`incentive_eligible=false`) |
| D12 | Split pembagian | off-system (sistem hanya mengeluarkan verdict) |
| D13 | Atribusi | first-touch (kunjungan pertama seumur hidup) |
| D14 | Satuan kunjungan | **1 tanggal unik per pasien** (WIB) |

## Definisi kanonis (dikunci di Fase 0)

```
kunjungan_valid(r) =
     r.status = 'completed'
  AND r.booking_date IS NOT NULL
  AND customer.is_sandbox_test = false
  AND customer.is_internal_staff = false
  AND customer.deleted_at IS NULL
  AND (r.series_id IS NULL OR r.session_number = 1)   -- sesi paket bukan repeat

visit(c) = DISTINCT (customer_id, tanggal_wib)
           staff = staf pertama yang tercatat pada tanggal itu

first_visit(c) = visit(c) dengan tanggal paling awal seumur hidup
origin_staff(c) = staff pada first_visit(c)

repeat(c, W) = EXISTS visit(c) lain dengan tanggal > first_visit(c)
               AND tanggal <= first_visit(c) + W hari

cohort(pool) = customer dengan first_visit jatuh di [pool_start, pool_end]
pool_end = asOf - W hari          -- wajib matang
pool_start = pool_end - 6 bulan   -- D2

retensi = COUNT(repeat) / COUNT(cohort)
indeks  = retensi / benchmark
```

**Konvensi WIB (KRITIS).** `booking_date` bertipe `timestamp without time zone`
dan server TZ = UTC. Tanggal WIB dihitung `(booking_date + interval '7 hours')::date`.
Pola ini konsisten dengan `financial-analytics.service.ts:262` (offset +7 jam) dan
`getWibCalendarDayBounds` (`src/services/reservation-core.service.ts:287`).

---

# Arsitektur & file map

| Layer | File baru / diubah |
|---|---|
| Schema | `prisma/schema.prisma` (3 model + 3 kolom Staff) |
| Migrasi | `prisma/migrations/20261104000000_add_staff_retention/` |
| Service (I/O) | `src/services/staff-retention.service.ts` |
| Kalkulator (pure) | `src/domain/staff-retention.ts` |
| Route | `src/routes/admin/staff-retention.subroute.ts` |
| Registrasi route | `src/routes/admin.route.ts` |
| RBAC seed | migrasi `role_api_scopes` |
| UI komponen | `packages/admin-dashboard/src/components/analytics/RetentionTab.tsx` |
| UI host (tab) | `packages/admin-dashboard/src/pages/tenant/FinancialAnalytics.tsx` |
| Test kalkulator | `tests/unit/staff-retention-calculator.test.ts` |
| Test route | `tests/unit/admin-staff-retention-tenant.test.ts` |
| Dokumen | `docs/METRIC_DEFINITIONS.md`, `docs/FEATURE_INVENTORY.md`, `docs/KNOWN_ISSUES.md`, `CHANGELOG.md`, `docs/RUNBOOK_INSENTIF_RETENSI.md` |

**Prinsip arsitektur:** perhitungan murni dipisah dari I/O. `src/domain/staff-retention.ts`
tidak boleh mengimpor `prisma` sama sekali — itu yang membuat unit test bisa menjalankan
skenario adversarial tanpa DB (sesuai `tests/setup.ts`).

---

# FASE 0 — Kontrak & Konfigurasi (read-only + 1 dokumen)

**Blast radius: NOL ke runtime.** Tujuan: mengunci definisi sebelum koding.

## Micro-task 0.1 — Tambah bagian ke `docs/METRIC_DEFINITIONS.md`

Sisipkan setelah bagian 4 (Analisis Kohort), sebagai **bagian 4A**:

```markdown
### 4A. Retensi per Bidan (Staff Retention)

- **Kunjungan**: satu tanggal unik (WIB) per pasien dengan minimal satu reservasi
  `completed`. Dua reservasi di tanggal sama = 1 kunjungan.
- **Sesi paket**: kunjungan series selain sesi pertama (`session_number > 1`)
  TIDAK dihitung sebagai kunjungan retensi.
- **First-touch attribution**: repeat dihitung ke bidan yang menangani kunjungan
  pertama seumur hidup pasien.
- **Jendela (W)**: 60 hari. **Pool**: 6 bulan bergulir, hanya cohort matang
  (`first_visit <= asOf - W`).
- **Indeks Retensi (IR)** = retensi bidan / benchmark klinik.
- **Benchmark**: 34,6% (60 hari), dibekukan dari cohort Apr–Okt 2026, direview kuartalan.
- **Tingkat**: IR < 0,90 → 50:50; 0,90–1,10 → 55:45; ≥ 1,10 → 60:40.
- **Sampel minimum** 40 pasien matang; di bawah itu status `INSUFFICIENT_SAMPLE`.
- Dikecualikan: `is_sandbox_test`, `is_internal_staff`, customer terhapus.
```

**Acceptance:** teks di atas ada di `docs/METRIC_DEFINITIONS.md` dan ditambahkan ke tabel
Riwayat Perubahan (bagian 6).

## Micro-task 0.2 — Catat gap di `docs/KNOWN_ISSUES.md`

Tambahkan entri baru (nomor mengikuti entri terakhir):

- Retensi tidak memiliki data **alasan pasien tidak kembali** → metrik hanya mengukur gejala.
- Tidak ada pencatatan **keluhan pasien** → syarat gugur insentif tidak bisa otomatis.
- Tidak ada **log pergantian bidan** → metrik kebocoran A→B tidak bisa dibedakan sebabnya.

**Regression gate Fase 0:** `git diff` hanya menyentuh 2 file dokumentasi.

---

# FASE 1 — Skema Database

**Blast radius: aditif murni.** Tidak ada kolom lama yang diubah/dihapus.

## Micro-task 1.1 — Tambah 3 kolom ke `model Staff` (`prisma/schema.prisma:989`)

```prisma
  // Insentif retensi — bukan role. Owner boleh ADMIN_CS tapi TIDAK ikut skema.
  incentive_eligible     Boolean  @default(true)
  /// 'RETENTION' | 'VOLUME' | 'NONE'
  incentive_scheme       String   @default("RETENTION")
  /// Tanggal mulai kerja (fallback: created_at bila null)
  employment_started_at  DateTime?
  retentionSnapshots     StaffRetentionSnapshot[]
```

**Alasan:**

- `incentive_eligible=false` untuk Yusi (owner), tanpa mengubah `role`.
- `incentive_scheme='VOLUME'` untuk Hanifah (2–4 pasien/bulan).
- `employment_started_at` dipakai untuk D8; `created_at` adalah tanggal akun dibuat,
  yang bisa berbeda dari tanggal mulai kerja.

## Micro-task 1.2 — Tambah `model RetentionPolicy`

```prisma
/// Kebijakan insentif retensi per tenant. Versioned via effective_from.
/// DILARANG hardcode parameter di service — semua dibaca dari sini.
model RetentionPolicy {
  id                    String    @id @default(uuid())
  tenant_id             String    @default("default-tenant")
  window_days           Int       @default(60)
  pool_months           Int       @default(6)
  benchmark_pct         Float     @default(34.6)
  tier1_max_pct         Float     @default(31.1)
  tier2_max_pct         Float     @default(38.1)
  split_tier1           Int       @default(50)
  split_tier2           Int       @default(55)
  split_tier3           Int       @default(60)
  min_sample            Int       @default(40)
  min_tenure_months     Int       @default(4)
  downgrade_periods     Int       @default(2)
  soft_landing_until    DateTime?
  effective_from        DateTime
  effective_to          DateTime?
  formula_version       String    @default("v1")
  created_at            DateTime  @default(now())
  updated_at            DateTime  @updatedAt

  @@unique([tenant_id, effective_from])
  @@index([tenant_id, effective_from])
  @@map("retention_policies")
}
```

## Micro-task 1.3 — Tambah `model StaffRetentionSnapshot`

```prisma
/// Angka beku per periode. WAJIB dipakai untuk payroll — jangan hitung ulang
/// saat gajian, supaya angka tidak berubah karena data diedit belakangan.
model StaffRetentionSnapshot {
  id                String    @id @default(uuid())
  tenant_id         String    @default("default-tenant")
  staff_id          String
  /// Snapshot nama saat dihitung — tetap terbaca meski staf dinonaktifkan.
  staff_name        String
  /// onDelete Restrict: arsip payroll TIDAK boleh ikut terhapus.
  /// Staf yang berhenti cukup di-set active=false, bukan dihapus.
  staff             Staff     @relation(fields: [staff_id], references: [id], onDelete: Restrict)
  period_year       Int
  period_month      Int
  policy_id         String?
  window_days       Int
  pool_start        DateTime
  pool_end          DateTime
  cohort_n          Int
  retained_n        Int
  retention_pct     Float?
  benchmark_pct     Float
  retention_index   Float?
  raw_tier          Int?
  final_tier        Int?
  split_pct         Int?
  status            String    @default("DRAFT") // DRAFT | PREVIEW | FINAL | SKIPPED
  skip_reason       String?
  formula_version   String    @default("v1")
  computed_at       DateTime  @default(now())
  computed_by       String?
  applied_at        DateTime?
  notes             String?

  @@unique([tenant_id, staff_id, period_year, period_month])
  @@index([tenant_id, period_year, period_month])
  @@map("staff_retention_snapshots")
}
```

**Catatan `raw_tier` vs `final_tier`:** `raw_tier` = hasil hitung periode ini,
`final_tier` = setelah hysteresis (D9) dan soft landing (D10). Keduanya disimpan
supaya bisa diaudit saat ada banding.

## Micro-task 1.4 — (Opsional, direkomendasikan) `model ReservationStaffAssignmentLog`

```prisma
/// Log append-only pergantian bidan. Diperlukan agar metrik kebocoran A→B
/// bisa membedakan "jadwal penuh" vs "pilihan CS". Tanpa ini, sengketa tidak
/// bisa dijawab dengan data.
model ReservationStaffAssignmentLog {
  id             String   @id @default(uuid())
  tenant_id      String   @default("default-tenant")
  reservation_id String
  from_staff_id  String?
  to_staff_id    String?
  /// schedule_full | staff_off | patient_request | owner_delegation | other
  reason         String?
  actor          String?
  created_at     DateTime @default(now())

  @@index([tenant_id, reservation_id])
  @@index([tenant_id, created_at])
  @@map("reservation_staff_assignment_logs")
}
```

## Micro-task 1.5 — Migrasi

```bash
npx prisma migrate dev --name add_staff_retention
npm run prisma:generate   # JANGAN pakai --no-engine (lihat AGENTS.md)
```

Seed policy awal + flag Staff (data, bukan kode):

```sql
INSERT INTO retention_policies
  (id, tenant_id, window_days, pool_months, benchmark_pct,
   tier1_max_pct, tier2_max_pct, split_tier1, split_tier2, split_tier3,
   min_sample, min_tenure_months, downgrade_periods,
   soft_landing_until, effective_from, formula_version)
VALUES
  (gen_random_uuid(), 'default-tenant', 60, 6, 34.6,
   31.1, 38.1, 50, 55, 60,
   40, 4, 2,
   '2027-02-28', '2026-11-04', 'v1');

UPDATE staff SET incentive_eligible = false
WHERE name = 'Bidan Yusi F';

UPDATE staff SET incentive_scheme = 'VOLUME'
WHERE name = 'Bidan Hanifah';
```

**Acceptance Fase 1:**

- `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`
  menghasilkan `-- This is an empty migration.`
- `npm run build` hijau.
- `npm test` tanpa failure baru (baseline harus dicatat dulu).

**Regression gate Fase 1:** build + full suite hijau. Failure yang diklaim pre-existing
wajib dibuktikan dengan revert-and-rerun.

---

# FASE 2 — Kalkulator Murni (`src/domain/staff-retention.ts`)

**Blast radius: file baru, nol pemanggil.** Bisa diuji penuh sebelum dipakai.

## Micro-task 2.1 — Tipe & fungsi murni

```ts
export interface RetentionVisitRow {
  customerId: string;
  staffId: string | null;
  visitDate: string; // 'YYYY-MM-DD' WIB
}

export interface RetentionPolicyInput {
  windowDays: number;
  benchmarkPct: number;
  tier1MaxPct: number;
  tier2MaxPct: number;
  splitTier1: number;
  splitTier2: number;
  splitTier3: number;
  minSample: number;
  downgradePeriods: number;
  softLanding: boolean;
}

export interface StaffRetentionResult {
  staffId: string | null;
  cohortN: number;
  retainedN: number;
  retentionPct: number | null;
  retentionIndex: number | null;
  rawTier: 1 | 2 | 3 | null;
  status: 'OK' | 'INSUFFICIENT_SAMPLE';
  splitPct: number;
}

/** Bangun kunjungan unik per (customer, tanggal) + urutan. */
export function buildVisits(rows: RetentionVisitRow[]): Visit[];

/** Filter cohort matang berdasarkan window & pool. */
export function selectCohort(visits: Visit[], opts): Visit[];

/** Hitung retensi per bidan. */
export function calculateRetention(
  visits: Visit[],
  policy: RetentionPolicyInput
): StaffRetentionResult[];

/** Hysteresis: tentukan final tier dari tier mentah + riwayat. */
export function resolveFinalTier(
  rawTier: 1 | 2 | 3 | null,
  previousTier: 1 | 2 | 3 | null,
  previousDowngradeStreak: number,
  policy: RetentionPolicyInput
): { finalTier: 1 | 2 | 3 | null; downgradeStreak: number };

/** Soft landing: naikkan split minimum selama periode tertentu. */
export function applySoftLanding(splitPct: number, policy): number;
```

**Aturan implementasi yang tidak boleh dilanggar:**

1. `visits` dikelompokkan per `(customerId, visitDate)`; dedupe tanggal.
2. `staffId` pada satu tanggal = staf pertama yang tercatat (deterministik: urut `created_at`).
3. Kunjungan dengan `staffId = null` **tetap dihitung** sebagai kohort `UNASSIGNED`
   (ditampilkan terpisah, tidak masuk penilaian).
4. `retentionPct = null` bila `cohortN = 0`.
5. `rawTier = null` bila `cohortN < minSample` → `status='INSUFFICIENT_SAMPLE'`, `splitPct = splitTier1`.
6. Boundary: `retentionPct === tier1MaxPct` masuk Tier 2 (bukan Tier 1) —
   pakai `<` untuk batas bawah, `>=` untuk batas atas. Dikunci di test.
7. **Tidak ada** `Date.now()` di dalam fungsi murni — `asOf` wajib parameter.

## Micro-task 2.2 — Test adversarial (TDD, tulis test DULU)

File: `tests/unit/staff-retention-calculator.test.ts`

| # | Skenario | Ekspektasi |
|---|---|---|
| T1 | cohort kosong | `retentionPct=null`, `status=INSUFFICIENT_SAMPLE`, split 50 |
| T2 | 2 kunjungan di tanggal sama | dihitung 1 kunjungan |
| T3 | kunjungan tepat di hari ke-60 | dihitung repeat (boundary inklusif) |
| T4 | kunjungan hari ke-61 | TIDAK dihitung repeat |
| T5 | n=39, retensi 50% | `INSUFFICIENT_SAMPLE`, split 50 |
| T6 | n=40, retensi 31,05% | Tier 1 |
| T7 | n=40, retensi 31,1% | Tier 2 (boundary) |
| T8 | n=40, retensi 38,1% | Tier 3 (boundary) |
| T9 | semua pasien repeat | 100%, Tier 3 |
| T10 | pasien dengan 1 kunjungan saja | 0%, Tier 1 |
| T11 | staf null (tanpa bidan) | muncul sebagai grup `UNASSIGNED`, bukan crash |
| T12 | cohort mentah (belum 60 hari) | tidak masuk denominator |
| T13 | kunjungan di luar pool (lebih tua 6 bulan) | tidak masuk denominator |
| T14 | hysteresis: Tier 2→3 langsung naik | final Tier 3 |
| T15 | hysteresis: Tier 3→1 sekali | tetap Tier 3, streak=1 |
| T16 | hysteresis: Tier 3→1 dua kali | turun ke Tier 1 |
| T17 | soft landing aktif, Tier 1 | split jadi 55 |
| T18 | benchmark 0 | `retentionIndex=null`, tidak divide-by-zero |
| T19 | urutan input acak (shuffle) | hasil identik (deterministik) |
| T20 | 1000 baris | selesai < 50ms (guard N²) |

**Acceptance Fase 2:** 20 test hijau; `src/domain/staff-retention.ts` tidak mengimpor
`prisma`/`db/client` (dicek dengan grep di test).

**Regression gate Fase 2:** `npx vitest run tests/unit/staff-retention-calculator.test.ts`
hijau, `npm run build` hijau.

---

# FASE 3 — Service I/O (`src/services/staff-retention.service.ts`)

**Blast radius: file baru.** Belum ada route yang memakai.

## Micro-task 3.1 — `getPolicy(tenantId, asOf)`

```ts
// Ambil policy aktif: effective_from <= asOf AND (effective_to IS NULL OR effective_to >= asOf)
// DB offline / tidak ada baris → fallback DEFAULT_POLICY (nilai D1–D10 di atas)
// Fallback WAJIB dicatat di log: console.warn('[RETENTION] policy fallback')
```

## Micro-task 3.2 — `fetchVisits(tenantId, from, to)`

Gunakan satu `$queryRaw` (hindari N+1):

```sql
WITH visit AS (
  SELECT
    r.customer_id,
    ((r.booking_date + interval '7 hours')::date) AS visit_date,
    (ARRAY_AGG(r.assigned_staff_id ORDER BY r.created_at)
       FILTER (WHERE r.assigned_staff_id IS NOT NULL))[1] AS staff_id
  FROM reservations r
  JOIN customers c ON c.id = r.customer_id
  WHERE r.tenant_id = $1
    AND r.status = 'completed'
    AND r.booking_date IS NOT NULL
    AND c.is_sandbox_test = false
    AND c.is_internal_staff = false
    AND c.deleted_at IS NULL
    AND (r.series_id IS NULL OR r.session_number = 1)
  GROUP BY 1, 2
)
SELECT customer_id, visit_date::text, staff_id
FROM visit
WHERE visit_date BETWEEN $2 AND $3
ORDER BY customer_id, visit_date;
```

> Catatan: `from` harus **6 bulan + 60 hari** ke belakang dari `asOf`, supaya
> kunjungan pertama pasien yang masuk pool tetap terdeteksi.

## Micro-task 3.3 — `computeForPeriod(tenantId, year, month)`

```ts
// asOf = akhir bulan WIB
// pool_end   = asOf - windowDays
// pool_start = pool_end - poolMonths bulan
// 1. fetchVisits(tenantId, pool_start - 400 hari, asOf)   // buffer deteksi first-ever
// 2. buildVisits + selectCohort + calculateRetention
// 3. map staff aktif → nama, incentive_eligible, incentive_scheme, employment_started_at
// 4. resolveFinalTier(prev snapshot) untuk hysteresis
// 5. applySoftLanding bila policy.soft_landing_until >= asOf
// 6. return report
```

Aturan tambahan:

- Staff `incentive_eligible=false` → `status='SKIPPED'`, `skip_reason='OWNER_OR_NOT_ELIGIBLE'`.
- Staff `incentive_scheme='VOLUME'` → `status='SKIPPED'`, `skip_reason='VOLUME_SCHEME'`.
- Staff dengan masa kerja < `min_tenure_months` → `skip_reason='TENURE'`.

## Micro-task 3.4 — `persistSnapshot` & `getDrilldown`

- `persistSnapshot`: upsert per `(tenant_id, staff_id, period)`; status `PREVIEW`/`FINAL`.
- `getDrilldown(tenantId, staffId, period)`: daftar pasien cohort dengan
  `firstVisitDate`, `totalVisits`, `lastVisitDate`, `retained`, `sameStaffVisits`,
  `otherStaffVisits`. **Wajib ada** untuk hak banding.

**Acceptance Fase 3:**

- Query dijalankan pada DB uji/live (read-only) dan hasilnya **identik** dengan
  query validasi di laporan 04 Nov (Yusi 60h = 34,6%; n=185).
- `npm run build` hijau.

**Regression gate Fase 3:** verifikasi angka silang (cross-check) manual vs SQL.

---

# FASE 4 — API (`src/routes/admin/staff-retention.subroute.ts`)

**Blast radius: endpoint baru, tidak menyentuh endpoint lama.**

| Method | Path | Guard | Fungsi |
|---|---|---|---|
| GET | `/api/admin/staff-retention` | admin | Laporan periode (`?year=&month=`) |
| GET | `/api/admin/staff-retention/drilldown` | admin | Daftar pasien cohort |
| POST | `/api/admin/staff-retention/snapshot` | TENANT_ADMIN/SUPER_ADMIN | Hitung & simpan (`?persist=true&status=PREVIEW`) |
| GET | `/api/admin/staff-retention/policy` | admin | Baca policy aktif |
| PUT | `/api/admin/staff-retention/policy` | SUPER_ADMIN | Buat versi policy baru |

Register di `src/routes/admin.route.ts` (setelah `analyticsAdminRoutes`) dan seed RBAC
`role_api_scopes` untuk role yang berhak.

**Acceptance Fase 4:**

- `tests/unit/admin-staff-retention-tenant.test.ts` (pola `admin-analytics-tenant.test.ts`):
  - tenant dari header diteruskan ke service
  - tanpa kredensial → 401
  - `tenantOf` tanpa tenant → 401 `TENANT_REQUIRED`
  - PUT policy oleh role non-superadmin → 403

**Regression gate Fase 4:** build + test route hijau; endpoint lama tidak berubah
(cek `git diff src/routes/admin.route.ts` hanya 2 baris tambah).

---

# FASE 5 — UI (`RetentionTab.tsx`)

**Anti-bloat:** TIDAK membuat page/rute baru. Tab ditambahkan di dalam
`FinancialAnalytics.tsx` yang sudah ada.

## Micro-task 5.1 — Tab switch

Di `packages/admin-dashboard/src/pages/tenant/FinancialAnalytics.tsx`:

```tsx
const [activeTab, setActiveTab] = useState<'keuangan' | 'retensi'>('keuangan');
```

Tab bar di atas konten; default `keuangan` agar perilaku lama tidak berubah.

## Micro-task 5.2 — Komponen `RetentionTab`

Isi minimum:

1. **Banner status periode**: "PREVIEW" / "FINAL" + rentang pool + tanggal hitung.
2. **Tabel peringkat**: Bidan · n · Repeat · Retensi · Indeks · Tingkat · Split · Status.
3. **Badge status**: `OK` / `Sampel kurang` / `Bukan peserta`.
4. **Drawer drill-down**: daftar pasien (nama disamarkan sesuai kebiasaan dashboard),
   jumlah kunjungan, siapa yang menangani kunjungan lanjutan.
5. **Catatan metode** (collapsible): definisi jendela, benchmark, dan rumus — supaya
   bidan bisa membaca aturannya sendiri.
6. **Tombol ekspor CSV** memakai `escapeCsvCell` yang sudah ada.

**Aturan UI:** tidak ada `window.confirm`/`alert` — pakai `useUiFeedback`
(mandat `no-native-confirm-alert`). Ikon dari `lucide-react` yang sudah terpasang.

**Acceptance Fase 5:** `npm run build` di `packages/admin-dashboard` hijau; tab
`keuangan` tampil identik seperti sebelumnya.

---

# FASE 6 — Data Hygiene (blocking untuk gaji #4)

| # | Tugas | File | Acceptance |
|---|---|---|---|
| 6.1 | Wajibkan bidan saat reservasi `completed` | route update reservasi + `reservation-core.service.ts` | Tidak bisa `completed` tanpa `assigned_staff_id` (kecuali flag override admin, tercatat di audit) |
| 6.2 | Bersihkan staf dummy | data | "Staff Bidan" nonaktif, "Bidan Testing Yusi" nonaktif |
| 6.3 | Log pergantian bidan | `reservation-dispatch.route.ts` | Setiap perubahan `assigned_staff_id` menulis 1 baris log |
| 6.4 | Isi `employment_started_at` | data | Terisi untuk Yusi/Thabita/Hanifah |
| 6.5 | Audit reservasi tanpa bidan | query | Target 0 untuk periode Des 2026 ke depan |

**6.5 adalah gate keras:** laporan periode pertama TIDAK boleh diterbitkan
jika ada reservasi `completed` tanpa bidan di dalam pool.

---

# FASE 7 — Dokumen & Operasional

| Dokumen | Perubahan |
|---|---|
| `docs/METRIC_DEFINITIONS.md` | Bagian 4A + riwayat perubahan |
| `docs/FEATURE_INVENTORY.md` | Service, endpoint, tabel, tab UI |
| `docs/KNOWN_ISSUES.md` | 3 gap data (churn reason, keluhan, assignment log) |
| `CHANGELOG.md` | Entri versi terbaru |
| `docs/RUNBOOK_INSENTIF_RETENSI.md` | Prosedur bulanan gajian (baru) |
| `docs/changelog/INDEX.md` | Regenerate |

**Isi RUNBOOK (wajib):** langkah harian/bulanan, siapa yang menekan tombol,
cara freeze snapshot, cara menjawab banding, dan cara rollback.

---

# Timeline vs Gaji #4

| Periode | Milestone | Gate |
|---|---|---|
| 04–15 Nov 2026 | Fase 0–1 (kontrak + skema) | build + suite hijau |
| 15 Nov–15 Des 2026 | Fase 2–3 (kalkulator + service) | 20 test kalkulator hijau, angka cross-check |
| 15 Des 2026–10 Jan 2027 | Fase 4–5 (API + UI) | test route + dashboard build |
| 10–20 Jan 2027 | Fase 6 (data hygiene) + Fase 7 (dokumen) | 0 reservasi tanpa bidan periode Des |
| **20–31 Jan 2027** | **Hitung & tampilkan PREVIEW ke bidan** | Bidan punya 1 periode koreksi data |
| **Feb 2027** | **Snapshot FINAL → dipakai di gaji #4** | Soft landing minimal 55:45 |

**Gaji #1–#3 (Nov 2026–Jan 2027): flat 50%.** Tidak ada perubahan pembayaran.

---

# Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Pool Thabita di gaji #4 didominasi Oktober (50%) | Tier ditentukan 1 bulan | Soft landing min 55:45 (D10); diumumkan di preview Januari |
| n Thabita ±72 → margin error ±11 poin | Keputusan bisa salah | Nyatakan eksplisit di UI sebagai "indikatif" sampai n≥100 |
| Reservasi tanpa bidan di periode pool | Angka tidak sah | Gate keras 6.5 — laporan tidak terbit |
| Bidan tidak setuju atribusi first-touch | Sengketa | Drill-down nama pasien + 1 periode banding |
| Hanya 1–2 bidan aktif → benchmark tidak stabil | Benchmark bias | Benchmark dibekukan dari histori (D3), review kuartalan |
| `tests/setup.ts` belum memuat model baru | Test gagal/masking | Tambahkan mock `retentionPolicy`, `staffRetentionSnapshot`; gunakan DI untuk `$queryRaw` |
| Migrasi drift | Deploy gagal | Cek `migrate diff` = empty migration sebelum merge |
| Prisma engine locked saat generate | Build gagal | Matikan dev server dulu; JANGAN `--no-engine` |

---

# Rollback

Karena **split tetap off-system** dan sistem hanya mengeluarkan verdict:

1. Feature flag `RETENTION_INCENTIVE_ENABLED` (default `false`) → endpoint mengembalikan
   `{ enabled: false }`, UI menampilkan "belum aktif".
2. Policy bisa diubah tanpa deploy (buat versi baru dengan `effective_from`).
3. Snapshot berstatus `PREVIEW` bisa dihapus; `FINAL` tidak boleh dihapus (audit).
4. Tabel aditif → `DROP TABLE` aman tanpa menyentuh data operasional.
5. Tidak ada perubahan pada alur pembayaran, WAHA, atau webhook.

**Blast radius maksimum: dashboard + 1 tab. Nol dampak ke lalu lintas WhatsApp.**

---

# Out of scope (sengaja tidak dikerjakan sekarang)

| Item | Alasan |
|---|---|
| Perhitungan rupiah bagi hasil | D12 — off-system, manual |
| Backfill bidan dari Google Sheets | Butuh verifikasi kolom + persetujuan terpisah |
| Penilaian kepuasan / keluhan | Belum ada data sumber |
| Case-mix adjustment | Data menunjukkan mix seragam (79% BABY) — belum perlu |
| Skema volume untuk Hanifah | Dihitung terpisah; perlu desain sendiri |
| Notifikasi otomatis hasil tier | Bisa menyusul setelah 2 periode stabil |

---

# Checklist persetujuan sebelum eksekusi

- [x] D1 jendela **60 hari** disetujui
- [x] D3 benchmark **34,6%** disetujui
- [x] D4–D6 ambang **31,1% / 38,1%** disetujui
- [x] D7 sampel minimum **40** disetujui
- [x] D10 soft landing gaji #4 **min 55:45** disetujui
- [x] D11 owner **tidak ikut skema** disetujui
- [x] Fase 1.4 log penugasan **ikut dikerjakan** (YA — dikerjakan demi transparansi histori & anti sengketa)
- [x] Timeline Fase 0–7 disetujui (Gaji #1 Nov 2026, Gaji #4 Feb 2027)

Setelah checklist ini disetujui, eksekusi dimulai dari **Fase 0** dan berhenti di setiap
regression gate untuk verifikasi.
