# METRIC_DEFINITIONS: Standar Definisi & Penyelarasan Metrik Analytics

Dokumen ini adalah **sumber kebenaran tunggal (single source of truth)** untuk seluruh metrik finansial, operasional, dan retensi pada dashboard analitik WhatsApp Clinic Bot.

---

## 1. Target State — Tabel Definisi Metrik Kanonis

| Metrik | Definisi / Formula | Basis Tanggal | Status Filter | Ongkir | Diskon | Label Wajib |
|---|---|---|---|---|---|---|
| `bookingValue` | `resolveReservationBilling().totalFee` (`netFee + deliveryFee`) | `booking_date` (jadwal treatment) | non-cancelled | Termasuk | Diterapkan | **Nilai Booking** |
| `paidRevenue` | Subset `isReservationPaid() === true` | `booking_date` | non-cancelled | Termasuk | Diterapkan | **Lunas** |
| `pendingRevenue` | Subset `isReservationPaid() === false` | `booking_date` | non-cancelled | Termasuk | Diterapkan | **Tagih** |
| `completedRevenue` | Hanya reservasi dengan status `completed` | `booking_date` | completed only | Termasuk | Diterapkan | **Omzet Kunjungan Selesai** |
| `cohortRevenue` | Nilai first-ever + repeat cohort dari pelanggan yang diakuisisi | `created_at` (saat booking dibuat) | Bukan cancelled/rejected | Termasuk | Tidak | **Nilai Booking Cohort (Created At)** |
| `dailyEstimate` | Nilai layanan aktual atau fallback harga katalog | `created_at` | confirmed / en_route / completed | Tidak | Tidak | **Estimasi Nilai Booking Harian (Katalog)** |
| `customerTotalSpend` | `_sum(purchase_value)` pada tabel reservasi per pasien | all-time | Semua reservasi pasien | Tidak | Tidak | **Total Belanja Pasien (All-Time)** |
| `repeatBookingShare` | `is_repeat_order / activeBookings` | `booking_date` | non-cancelled | N/A | N/A | **Reservasi Repeat** |
| `cohortRetention` | Pasien yang kembali booking pada 30 / 60 / 90 hari | Cohort `created_at` | Qualifying non-cancelled | N/A | N/A | **Retensi Cohort** |
| `bidanRetention` | Pasien repeat dalam 60 hari ke bidan yang sama vs bidan lain | First visit `completed` | completed only | N/A | N/A | **Retensi Pasien per Bidan (60 hari)** |
| `aov` | `bookingValue / activeBookings` | `booking_date` | non-cancelled | Termasuk | Diterapkan | **AOV Bulanan** |
| `cancellationRate` | `cancelledBookings / totalBookings` (operasional bulan berjalan) | `booking_date` | Semua status (termasuk cancelled) | N/A | N/A | **Cancellation Rate** |
| `historicalCancellationRate` | `cancelled / total` dari 3 bulan tertutup; dipakai forecast | `booking_date` | Semua status historis | N/A | N/A | **Cancellation Rate Historis (3 Bln)** |
| `target` | Disimpan di `Tenant.settings.financialTargets`; gap & required pace memakai realisasi s/d hari ini | Bulan kalender | N/A | N/A | N/A | **Target Bulanan** |

---

## 2. Aturan Emas Pelabelan & Larangan "Omset" Tanpa Basis

> [!CAUTION]
> **DILARANG KERAS menggunakan kata "Omset" secara telanjang / tanpa kualifikasi basis.**
> LLM, developer, dan UI dilarang menampilkan kata "Omset" atau "Revenue" tanpa menyertakan basis kalkulasi dan filter statusnya.

Setiap tampilan angka pendapatan wajib menggunakan salah satu label eksplisit berikut:
1. **Nilai Booking**: Untuk pendapatan berbasis tanggal booking treatment (`booking_date`), mencakup seluruh jadwal aktif non-cancelled (sudah lunas maupun pending bayar).
2. **Lunas**: Untuk porsi Nilai Booking yang sudah diverifikasi pembayarannya (`purchase_occurred_at`).
3. **Tagih**: Untuk porsi Nilai Booking yang belum diverifikasi bayar (menunggu kunjungan / penagihan di tempat).
4. **Omzet Kunjungan Selesai**: Khusus untuk kunjungan yang status operasionalnya sudah `completed`.
5. **Nilai Booking Cohort (Created At)**: Untuk analitik pemasaran/Meta performance berbasis tanggal interaksi / pembuatan booking pertama kali (`created_at`).
6. **Estimasi Nilai Booking Harian (Katalog)**: Untuk laporan harian cepat / bot daily report yang mengandalkan snapshot awal atau estimasi katalog.

---

## 3. Matriks 11 Surface Dashboard → Metrik → Basis

Berikut adalah rincian 11 surface dashboard dan bagaimana masing-masing memetakan metriknya:

| No | Surface / Fitur | Lokasi Komponen / File | Metrik Utama | Basis Tanggal | Status Filter | Label yang Wajib Tampil |
|---|---|---|---|---|---|---|
| 1 | **Overview Dashboard** | `packages/admin-dashboard/src/pages/tenant/Overview.tsx` | Nilai Booking Bulan Ini, AOV | `booking_date` | `all_non_cancelled` | **Nilai Booking Bulan Ini** |
| 2 | **Financial Analytics: Monthly Trends** | `packages/admin-dashboard/src/pages/tenant/FinancialAnalytics.tsx` | Total Nilai Booking, Lunas, Tagih, AOV, Repeat Share | `booking_date` | `all_non_cancelled` | **Total Nilai Booking**, **Reservasi Repeat** |
| 3 | **Financial Analytics: Treatment Heatmap** | `packages/admin-dashboard/src/components/analytics/TreatmentHeatmapTab.tsx` | Omzet Periode Heatmap | `booking_date` | `completed_only` | **Omzet Kunjungan Selesai** |
| 4 | **Financial Analytics: Bidan Retention** | `packages/admin-dashboard/src/components/analytics/RetentionTab.tsx` | Retensi 60 hari Bidan | First visit date | `completed_only` | **Retensi Pasien per Bidan (60 hari)** |
| 5 | **Marketing Performance (Meta Click Catcher)** | `packages/admin-dashboard/src/pages/tenant/MetaClickCatcher.tsx` | Nilai Booking Cohort, CAC, ROAS, LTV Cohort | `created_at` (KPI) / `booking_date` (tabel kohort) | non-cancelled (KPI) / `completed_only` (tabel kohort) | **Nilai Booking Cohort (Created At)**, **LTV Cohort** |
| 6 | **Customer Database** | `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx` | Total Belanja Pasien | All-time | Semua riwayat | **Total Belanja Pasien (All-Time)** |
| 7 | **Follow-up Analytics** | `packages/admin-dashboard/src/pages/tenant/FollowUpAnalytics.tsx` | Konversi Follow-up & Booking Value | `booking_date` / `followup_date` | non-cancelled | **Nilai Booking Terkonversi** |
| 8 | **Today Treatments** | `packages/admin-dashboard/src/pages/staff/TodayTreatments.tsx` | Status Penyelesaian & Tagihan Hari Ini | `booking_date` (hari ini) | Operasional | **Tagihan Treatment Hari Ini** |
| 9 | **Staff Scorecard** | `packages/admin-dashboard/src/pages/staff/StaffScorecard.tsx` | Tindakan Selesai, Retensi Bidan | Visit date | `completed_only` | **Kunjungan Selesai**, **Retensi 60 Hari (Bidan)** |
| 10 | **Daily Report Service** | `src/services/daily-report.service.ts` | Estimasi Booking Masuk Hari Ini | `created_at` (hari ini) | `confirmed_and_completed` | **Nilai Booking Dibuat Hari Ini** |
| 11 | **Copilot AI (`query_revenue`)** | `src/services/copilot/copilot-tools.ts` | Pendapatan Teragregasi | `booking_date` (default) | `all_non_cancelled` | **Nilai Booking** (dengan rincian gross, diskon, ongkir) |

---

## 4. Denominator & Aturan Perhitungan Pembagi

1. **AOV (Average Order Value)**:
   - Formula: `bookingValue / activeBookings`
   - Denominator **WAJIB** `activeBookings` (yaitu reservasi non-cancelled). Reservasi yang dibatalkan (`cancelled` / `rejected`) dilarang dimasukkan ke denominator AOV karena tidak mencerminkan order riil yang berjalan.
2. **Repeat Booking Share**:
   - Formula: `repeatBookingsCount / activeBookings`
   - Menghitung persentase porsi order berulang dari seluruh reservasi aktif di periode tersebut.
3. **Cancellation Rate**:
   - Formula operasional: `cancelledBookings / totalBookings` (bulan berjalan).
   - Formula forecast: `cancelled / total` dari **3 bulan tertutup** (`historicalCancellationRate`), di-clamp 0–50%.
   - Denominator adalah `totalBookings` (semua reservasi yang pernah tercatat di sistem pada periode tersebut termasuk yang batal).
4. **Target & Risk-Adjusted Forecast**:
   - Progress target dan `requiredDailyRevenue` / `requiredDailyBookings` **WAJIB** memakai realisasi s/d hari ini (`revenueToDate`, `bookingsToDate`), bukan total booking sebulan yang masih memuat jadwal mendatang.
   - Base forecast menerapkan `historicalCancellationRate` ke **seluruh booking terjadwal** sisa bulan.
   - Skenario: konservatif = cancel rate ×1,5 dan expected pace ×0,9; optimis = cancel rate ×0,5 dan expected pace ×1,1. Invariant: `konservatif <= base <= optimis`.
   - Garis forecast pada grafik akumulasi adalah **base risk-adjusted**; kartu ringkasan menampilkan tiga skenario.
5. **Meta Performance — Dua Basis**:
   - KPI grid memakai `created_at` / non-cancelled / treatment+ongkir.
   - Tabel kohort memakai `booking_date` / completed-only / treatment-only (ongkir dipisah).
   - Kedua basis wajib memiliki badge/label masing-masing; jangan memakai satu badge untuk seluruh panel.
