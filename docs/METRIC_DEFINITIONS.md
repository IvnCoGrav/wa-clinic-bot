# METRIC_DEFINITIONS.md — Kamus & Kontrak Definisi Metrik Bisnis & Analitik

Dokumen ini adalah satu-satunya sumber kebenaran (*single source of truth*) untuk seluruh istilah, rumus, dan batas periode kalkulasi performa pemasaran dan analitik klinis di sistem chatbot dan dashboard admin.

---

## 1. Saluran Akuisisi (Acquisition Channels)

| Kanal | Definisi Teknis | Sumber Identifikasi |
|---|---|---|
| **CTWA** (Click-to-WhatsApp Ads) | Prospek yang masuk melalui iklan Meta Click-to-WhatsApp langsung. | Memiliki referral payload Meta CAPI, parameter `ctwa_*`, atau teks sambutan template CTWA. |
| **LPWA** (Landing Page to WhatsApp) | Prospek yang mengunjungi landing page web lalu mengklik tombol WhatsApp. | Parameter tracking `lpwa_*` pada URL referer / redirect chat. |
| **PROMO_CTA** | Prospek yang masuk dari broadcast promo berkala atau materi promosi spesifik. | Tagging pesan masuk dari tombol CTA promo template. |
| **ORGANIC / DIRECT** | Prospek yang menghubungi nomor WhatsApp klinik secara langsung atau melalui kontak rujukan. | Default jika tidak terdeteksi parameter iklan atau tracking landing page. |

---

## 2. Marketing Qualified Lead (MQL)

### Definisi & Perubahan Periode (A-008)
- **Sebelum 2026-10-28 (Legacy Definition):**
  Customer ditandai sebagai MQL secara seumur hidup (*lifetime flag* `is_mql = true`) saat memenuhi salah satu kriteria kualifikasi awal (misalnya konsultasi tarif, tanya jadwal, atau share location). Akibatnya, pada filter rentang tanggal laporan, customer lama yang pernah MQL di masa lalu dihitung kembali di bulan berjalan jika terdapat interaksi apa pun.
- **Mulai 2026-10-28 (Periode-Bound MQL — Commit `8c1dd757` & `4e366631`):**
  MQL dievaluasi secara terikat periode (*time-bounded*). Prospek hanya dihitung sebagai MQL untuk bulan/periode tertentu jika kualifikasi atau interaksi kualifikasinya terjadi pada rentang waktu yang sedang difilter.
  > [!IMPORTANT]
  > Perubahan definisi pada 2026-10-28 ini berdampak pada angka historis laporan dashboard (re-kalkulasi dinamis). Disarankan mengambil snapshot CSV/PDF bulanan jika manajemen membutuhkan pembukuan statis per akhir bulan.

---

## 3. Customer Acquisition Cost (CAC) & Customer Lifetime Value (LTV)

### Formula CAC (Blended & Per-Channel)
$$\text{CAC} = \frac{\text{Total Biaya Iklan (Ad Spend)}}{\text{Jumlah Pelanggan Baru yang Membeli (First-Time Buyers)}}$$
- **Ad Spend**: Diambil dari konfigurasi `Tenant.settings.metaPerformanceSettings.monthlySpends[YYYY-MM]` untuk pengeluaran riil LPWA & CTWA.
- **First-Time Buyers**: Pelanggan yang tanggal reservasi pertamanya jatuh pada periode tersebut.

### Formula LTV (Lifetime Value)
$$\text{LTV} = \sum \text{Purchase Value Reservasi Selesai (Completed / Paid)}$$
- Dihitung dari akumulasi nilai transaksi riil layanan pasien yang berstatus `confirmed` atau `completed` (net/gross sesuai catatan transaksi klinik).

---

## 4. Analisis Kohort & Repeat Order

### Kohort Pelanggan (Customer Cohort)
- Pengelompokan pelanggan berdasarkan **bulan transaksi pertama** mereka (*First Reservation Month*).
- **Periode Awal Kohort (`cohortStartMonth`)**: Default `null` (dinamis). Dapat dikonfigurasi per tenant di `Tenant.settings.metaPerformanceSettings.cohortStartMonth` (misal `'2026-01'`) untuk membatasi data awal yang belum terstandarisasi.
- **Bulan Dikecualikan (`excludedCohortMonths`)**: Array bulan-bulan yang memiliki distorsi data ekstrim (misal masa migrasi sistem `'2025-08'`) yang dapat diatur via settings tenant, bukan hardcode.

### Repeat Order Rate
$$\text{Repeat Order Rate} = \frac{\text{Jumlah Pelanggan dengan } \ge 2 \text{ Transaksi}}{\text{Total Pelanggan Unik}}$$

---

## 4A. Retensi per Bidan (Staff Retention)

- **Kunjungan**: satu tanggal unik (WIB) per pasien dengan minimal satu reservasi `completed`. Dua reservasi di tanggal sama = 1 kunjungan.
- **Sesi paket**: kunjungan series selain sesi pertama (`session_number > 1`) TIDAK dihitung sebagai kunjungan retensi.
- **First-touch attribution**: repeat dihitung ke bidan yang menangani kunjungan pertama seumur hidup pasien.
- **Jendela (W)**: 60 hari. **Pool**: 6 bulan bergulir, hanya cohort matang (`first_visit <= asOf - W`).
- **Indeks Retensi (IR)** = retensi bidan / benchmark klinik.
- **Benchmark**: 34,6% (60 hari), dibekukan dari cohort Apr–Okt 2026, direview kuartalan.
- **Tingkat**: IR < 0,90 → 50:50; 0,90–1,10 → 55:45; ≥ 1,10 → 60:40.
- **Sampel minimum** 40 pasien matang; di bawah itu status `INSUFFICIENT_SAMPLE`.
- Dikecualikan: `is_sandbox_test`, `is_internal_staff`, customer terhapus.

---

## 5. Utilisasi Kapasitas Terapis (Capacity Utilization)

### Formula Utilisasi
$$\text{Utilisasi (\%)} = \frac{\text{Total Sesi Layanan Selesai / Terjadwal}}{\text{Hari Kerja} \times \text{Jumlah Terapis Aktif} \times \text{Kapasitas Slot Harian}}$$
- **Kapasitas Slot Harian per Terapis (`dailySlotsPerTherapist`)**:
  - Dikonfigurasi dinamis per tenant melalui `Tenant.settings.metaPerformanceSettings.dailySlotsPerTherapist`.
  - Jika belum dikonfigurasi (nilai `null`), sistem menahan penghitungan utilitas hingga admin menentukan standar operasional kliniknya, mencegah bias angka asumsi sepihak.

---

## 6. Riwayat Perubahan & Rujukan Komit

| Tanggal | Komit | Deskripsi Perubahan |
|---|---|---|
| **2026-10-27** | `ffece481` | Implementasi awal agregasi metrik performa iklan Meta & analitik kohort. |
| **2026-10-28** | `8c1dd757` | Penyesuaian batas waktu kualifikasi MQL berbasis tanggal percakapan/interaksi. |
| **2026-10-28** | `4e366631` | Rekonsiliasi data bentrok kapasitas terapis dan penambahan kalkulasi margin laba kotor kohort. |
| **2026-10-29** | `a496c813` | Eliminasi hardcode periode kohort dan slot terapis; migrasi penuh ke konfigurasi dinamis `Tenant.settings.metaPerformanceSettings` (A-001). |
| **2026-11-04** | pending | Penambahan kontrak definisi metrik 4A Retensi per Bidan (Staff Retention) jendela 60 hari pool 6 bulan. |
| **2026-11-06** | pending | Penambahan §7 Funnel Watchdog: definisi kanonis paidViews, uniquePaidClicks, paidAgedClicks, paidMatchedLeads, inboundChats, dan baseline jam-sama. |

---

## 7. Funnel Watchdog (Early Warning System & Deteksi Kebocoran Corong Iklan)

Kontrak kanonis perhitungan corong iklan (*Ad Funnel Metrics*) yang bersumber dari seam tunggal `src/services/ad-funnel-metrics.service.ts`:

| Metrik | Definisi Teknis & Filter | Sumber Data |
|---|---|---|
| **paidViews** | Jumlah kunjungan landing page pada jendela waktu tertentu dengan `source IN ('beacon', 'cta-fallback')` dan memiliki parameter `fbclid != null` ATAU `utmMedium IN ('cpc','paid','ctwa','ctwa_fuzzy')`. Dikecualikan: baris `source='meta-reconciliation'` dan `backfill-synthetic`. | `LandingPageView` (`schema.prisma:741-768`) |
| **uniquePaidClicks** | Jumlah klik tombol CTA WhatsApp dari trafik berbayar (`fbclid != null` OR `utmMedium IN paidMediums`), dideduplikasi distinct per `COALESCE(fbclid, id)`. | `AdClick` (`schema.prisma:691-715`) |
| **paidAgedClicks** | Subset dari `uniquePaidClicks` yang belum terhubung ke percakapan (`matchedAt IS NULL`) dan telah berusia lebih dari atau sama dengan `graceMinutes` (default: 20 menit). Menandakan pengunjung yang membatalkan niat chat. | `AdClick` (`schema.prisma:691-715`) |
| **paidMatchedLeads** | Jumlah prospek unik (`distinct customerId`) dari `uniquePaidClicks` yang berhasil terhubung dengan chat WhatsApp (`matchedAt != null`). | `AdClick` (`schema.prisma:691-715`) |
| **inboundChats** | Jumlah pelanggan riil (`distinct conversation.customer_id`) yang mengirim pesan masuk (`direction='INBOUND'`, `sender_type != 'INTERNAL_NOTE'`) pada jendela waktu tersebut, dengan mengecualikan akun sandbox dan staf internal (`is_sandbox_test=false`, `is_internal_staff=false`). Ground truth percakapan nyata. | `Message` & `Conversation` (`schema.prisma:185, 243`) |
| **baselineViewsAtHour** | Nilai tengah (*median*) jumlah `paidViews` pada jendela jam operasional yang sama selama 7 hari terakhir (WIB). Digunakan sebagai pembanding dinamis untuk mendeteksi penurunan trafik abnormal (*low traffic ratio*). | Perhitungan historis dinamis |
| **ctr** | Rasio klik terhadap kunjungan: $\text{CTR} = \frac{\text{uniquePaidClicks}}{\text{paidViews}}$ (bernilai 0 jika `paidViews = 0`). | Turunan |

