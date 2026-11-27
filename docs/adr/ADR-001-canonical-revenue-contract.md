# ADR 0005: Kontrak Kanonis Revenue dan Penyelarasan Multi-Basis Dashboard Analytics

## Status
Accepted (2026-11-27)

## Konteks & Masalah
Sistem klinik memiliki berbagai macam antarmuka analitik yang menyajikan angka finansial:
1. **Financial Analytics & Overview**: Menampilkan tren performa bulanan klinik berdasarkan jadwal kunjungan treatment (`booking_date`).
2. **Meta Performance / Marketing Attribution**: Menampilkan efektivitas kampanye iklan Meta (CAC, ROAS, cohort LTV) yang berbasis tanggal saat pasien pertama kali mendaftar/kontak (`created_at`).
3. **Customer Database**: Menampilkan total belanja agregat seumur hidup (*all-time purchase value*).
4. **Daily Report**: Menyajikan rekapitulasi booking yang berhasil dibuat oleh bot hari ini.
5. **Copilot Tool (`query_revenue`)**: Menjawab pertanyaan staf/manajemen seputar pendapatan klinik.

Sebelumnya, tidak ada kontrak kanonis terpusat untuk kalkulasi ini. Sebagian modul menghitung omzet dari `purchase_value` kotor, sebagian memperhitungkan `delivery_fee`, sebagian mengabaikan diskon, dan sebagian mengikutsertakan reservasi batal (`cancelled`) ke dalam pembagi AOV. Hal ini memicu kebingungan manajerial ("Mengapa angka di Meta Performance berbeda dengan Financial Analytics?").

Perbedaan tersebut sebenarnya valid karena perbedaan **tujuan bisnis (intent)**: tim marketing membutuhkan atribusi biaya iklan terhadap waktu pembuatan booking (`created_at`), sedangkan operasional klinik membutuhkan jadwal kunjungan aktual (`booking_date`). Namun ketiadaan deklarasi basis yang eksplisit membuat angka-angka tersebut tampak saling bertentangan.

## Keputusan Arsitektur

1. **Satu Definisi Per Metrik dengan Kontrak Domain Kanonis**:
   - Mendefinisikan tipe dan predikat standar di `src/domain/analytics-contract.ts`:
     - `RevenueBasis`: `'booking_date' | 'created_at'`
     - `RevenueStatusFilter`: `'all_non_cancelled' | 'completed_only' | 'confirmed_and_completed' | 'confirmed_only'`
     - `RevenueQuery`: parameter permintaan kalkulasi revenue
     - `RevenueAmounts`: struktur hasil breakdown revenue (`treatmentGross`, `discount`, `treatmentNet`, `deliveryFee`, `bookingValue`, `paidAmount`, `pendingAmount`, `isPaid`)
     - `RevenueBasisMeta`: metadata basis yang wajib disertakan pada respons API
   - Default sistem: `DEFAULT_REVENUE_QUERY` (basis `booking_date`, filter `all_non_cancelled`, `includeDeliveryFee: true`, `includePending: true`, `includeUpcoming: true`).

2. **Seam Agregasi Kanonis (`resolveRevenueAmounts`)**:
   - Dibuat di `src/services/revenue-analytics.service.ts` yang menyatukan `resolveReservationBilling` (katalog, items, snapshot ongkir, diskon) dan `isReservationPaid` (status bukti bayar).
   - Seluruh modul analitik wajib memanggil fungsi ini atau mengonsumsi tipe ini, bukan mengulang logika manual.

3. **Multi-Basis Tetap Diizinkan dengan Syarat Eksplisit**:
   - Dashboard marketing tetap boleh menggunakan basis `created_at` untuk kohort dan CAC/ROAS.
   - Dashboard keuangan operasional tetap menggunakan basis `booking_date`.
   - **SYARAT MUTLAK**: Setiap respons API dan visualisasi antarmuka WAJIB menyertakan badge atau label eksplisit yang mendeskripsikan basisnya (`MetricBasisBadge`), dan dilarang menggunakan kata "Omset" tanpa kualifikasi basis.

4. **Koreksi Denominator Non-Cancelled**:
   - AOV dan Repeat Rate dihitung terhadap `activeBookings` (reservasi non-cancelled), sedangkan `cancellationRate` dihitung terhadap `totalBookings`.

## Konsekuensi & Mitigasi
- **Positif**: Seluruh angka dapat direkonsiliasi secara matematis. Rekonsiliasi antara Meta Performance dan Financial Analytics menjadi jelas karena perbedaan tanggal basis diungkapkan secara visual.
- **Positif**: Memenuhi *Mandat Kontrak Kanonis Tunggal* dan *Mandat Non-Hardcode*.
- **Mitigasi Angka Berubah**: Label diperbarui dari sekadar "Total Omset" menjadi "Total Nilai Booking", dan rincian Lunas vs Tagih ditampilkan transparan sehingga user memahami mengapa angka AOV berubah menjadi lebih akurat.
