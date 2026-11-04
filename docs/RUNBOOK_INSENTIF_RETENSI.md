# RUNBOOK: Prosedur Bulanan Insentif Retensi Bidan

Dokumen operasional standar (SOP) untuk Admin Klinik, Owner, dan Manajemen Keuangan dalam mengelola evaluasi retensi pasien 60 hari dan penetapan split fee bagi hasil bidan.

---

## 1. Ikhtisar & Jadwal Bulanan

Sistem insentif retensi berjalan berbasis **pool 6 bulan bergulir** dengan periode evaluasi bulanan (format `YYYY-MM`). Split bagi hasil (50:50, 55:45, atau 60:40) dihitung secara deterministik oleh sistem, namun transfer rupiah tetap dilakukan **off-system** oleh bagian payroll/keuangan manual.

```
       Tanggal 20–25               Tanggal 26–30              Tanggal 1 (Cut-Off)
   [ Review PREVIEW ]     ───►  [ Masa Sanggahan ]   ───►   [ Kunci FINAL ]
   - Buka Tab Retensi           - Bidan cek drilldown        - Super Admin klik freeze
   - Audit Unassigned = 0       - Klarifikasi mutasi         - Ekspor CSV ke payroll
```

| Rentang Tanggal | Tahapan Operasional | Penanggung Jawab | Aksi Utama |
|---|---|---|---|
| **Tanggal 20–25** | Review & Audit Awal | Admin Klinik | Buka dasbor `Keuangan > Insentif Retensi Bidan`. Periksa badge **PREVIEW**. Pastikan banner *"Reservasi Selesai Tanpa Bidan: 0"*. |
| **Tanggal 26–30** | Transparansi & Sanggahan | Admin & Bidan | Bidan dapat meninjau rincian kohort pasien di tab Retensi. Jika ada ketidaksesuaian penugasan atau pasien operan, staf menyampaikan sanggahan. |
| **Tanggal 1** (atau hari cut-off payroll) | Pembekuan Snapshot (Freeze) | Super Admin / Owner | Klik tombol **"Kunci Final Payroll"**. Status berubah menjadi **FINAL (Terkunci)**. Data dibekukan untuk kebutuhan audit. |
| **Pasca-Kunci** | Rekonsiliasi Penggajian | Admin Keuangan | Klik **"Ekspor CSV"**. Gunakan kolom `finalTier` (50, 55, atau 60) sebagai koefisien bagi hasil pada slip gaji bulan berjalan. |

---

## 2. Siapa yang Berhak Menekan Tombol?

1. **Role `SUPER_ADMIN` / `TENANT_ADMIN`** (owner / admin cabang):
   - Memiliki akses penuh untuk mengubah konfigurasi kebijakan (`PUT /api/admin/staff-retention/policy` — khusus `SUPER_ADMIN`).
   - Berwenang menekan tombol **"Kunci Final Payroll"** (`POST /api/admin/staff-retention/snapshot` dengan status `FINAL`).
2. **Role `ADMIN_CS`**:
   - Berwenang melihat dasbor, menjalankan preview, membuka drawer drilldown pasien, mencetak ekspor CSV, dan melengkapi atribusi reservasi yang terlewat (`PATCH /api/admin/reservation/:id/assign-staff`).
3. **Role `THERAPIST` / bidan**:
   - Hanya boleh membuka drilldown pasien kohort **miliknya sendiri** (`GET /api/admin/staff-retention/drilldown?staff_id=<id sendiri>`).
   - Ditolak `403 FORBIDDEN_STAFF_ROLE` saat membuka laporan agregat atau drilldown bidan lain.
   - Supervisor lapangan boleh menyelesaikan reservasi tanpa bidan (override), tetapi setiap override **wajib terekam** di audit payload `supervisorOverrideUnassigned`.

---

## 3. Langkah Demi Langkah Pembekuan Snapshot (Freeze)

### Langkah 1: Buka Dasbor
1. Masuk ke Admin Dashboard klinik (`packages/admin-dashboard`).
2. Masuk ke menu **Keuangan & Transaksi** di navigasi sidebar.
3. Klik tab **"Insentif Retensi Bidan"** di bagian atas halaman.
4. Pilih periode yang hendak dievaluasi (contoh: `2027-02` untuk penggajian Februari 2027).

### Langkah 2: Verifikasi Gate Keras (Data Hygiene)
Sebelum snapshot dapat dikunci, periksa kotak peringatan di bagian atas:
- **Jika muncul banner merah *"Perhatian: Ada X Kunjungan Selesai Tanpa Bidan"***:
  1. Gate Keras 6.5 akan **MENOLAK** pembekuan final dengan error `422 UNASSIGNED_POOL_RESERVATIONS_BLOCKED`.
  2. Buka daftar reservasi (`/admin/reservations`) atau minta laporan reservasi unassigned.
  3. Lengkapi staf yang bertugas pada setiap reservasi yang berstatus `COMPLETED` menggunakan tombol assign staff.
  4. Refresh tab Retensi hingga angka unassigned menjadi **0**.

### Langkah 3: Eksekusi Kunci Final
1. Setelah unassigned = 0 dan angka retensi telah disepakati bersama, klik tombol **"Kunci Final Payroll"**.
2. Sistem akan menampilkan dialog konfirmasi keamanan (*UI Feedback Modal*).
3. Klik **"Ya, Kunci Final"**.
4. Status pada header dasbor akan berubah dari badge kuning `PREVIEW (Dapat Berubah)` menjadi badge hijau `FINAL (Terkunci)`.
5. Angka pada periode tersebut kini berstatus *immutable* (tidak dapat dihitung ulang oleh perubahan data reservasi di masa mendatang).

### Langkah 4: Unduh Data & Teruskan ke Payroll
1. Klik tombol **"Ekspor CSV"** di pojok kanan atas tabel.
2. File CSV bernama `insentif-retensi-<periode>.csv` akan terunduh.
3. Berikan file CSV ini ke bendahara / payroll untuk input pembagian fee.

---

## 4. Prosedur Audit & Menjawab Sanggahan Bidan

Bidan memiliki hak transparansi penuh atas pasien yang masuk ke dalam kohort evaluasinya. Jika seorang bidan mengajukan sanggahan (contoh: *"Bunda Dina harusnya pasien repeat saya, tapi kok tercatat lepas ke Bidan lain?"*), ikuti langkah audit berikut:

1. **Buka Drawer Drilldown Pasien**:
   - Di tabel retensi, klik tombol **"Detail Pasien"** pada baris bidan yang bersangkutan.
   - Drawer slide-over akan terbuka menampilkan daftar seluruh pasien kohort 60 hari.
2. **Periksa Status Retensi Pasien**:
   - **Retained (Hijau)**: Pasien kembali berkunjung dalam rentang 60 hari sejak kunjungan pertamanya.
   - **Churned (Abu-abu)**: Pasien tidak melakukan kunjungan ulang dalam batas 60 hari.
   - **Leaked / Dilayani Staf Lain (Kuning)**: Pasien kembali berkunjung dalam 60 hari, tetapi kunjungannya dilayani oleh bidan lain.
3. **Verifikasi Atribusi Kunjungan Pertama (First-Touch)**:
   - Atribusi retensi mengacu pada bidan yang melayani **kunjungan pertama seumur hidup pasien**.
   - Jika pasien pernah dilayani oleh Bidan A pada Januari 2026, maka kohort retensi pasien tersebut selamanya terikat pada Bidan A, meskipun pada kunjungan Februari dilayani oleh Bidan B.
4. **Audit Log Pergantian Bidan**:
   - Jika ada indikasi bahwa jadwal pasien sengaja dialihkan oleh admin tanpa alasan jelas, periksa log mutasi di database:
     ```sql
     SELECT * FROM reservation_staff_assignment_logs
     WHERE reservation_id = '<id-reservasi>'
     ORDER BY changed_at DESC;
     ```
   - Log ini mencatat: `previous_staff_id`, `new_staff_id`, `changed_by_staff_id`, dan `reason`.

---

## 5. Kebijakan Khusus & Safeguards

### A. Proteksi Soft Landing (Gaji #4 / Februari 2027)
- Khusus periode Go-Live pertama (`2027-02`), kebijakan klinik menerapkan **Soft Landing**:
  - Bidan yang memenuhi syarat aktif tidak akan menerima split di bawah **55:45** (`soft_landing_tier = 55`), meskipun retensi aktualnya berada di Tier 1 (<31,1%).
  - Hal ini melindungi bidan (misal Bidan Thabita) yang masa transisi kohortnya masih didominasi oleh data 1 bulan.
  - Parameter ini dikendalikan oleh field `soft_landing_until: "2027-02-28"` di tabel `retention_policies`.

### B. Aturan Hysteresis (Peredam Gejolak Penurunan)
- **Kenaikan Tier**: Berlaku seketika pada periode berjalan saat retensi mencapai ambang batas (contoh: ≥38,1% langsung naik ke 60%).
- **Penurunan Tier**: Dilindungi jeda 1 periode. Split bidan **tidak akan turun** jika ia baru 1 periode berada di bawah ambang. Penurunan baru berlaku jika retensi berada di bawah ambang selama **2 periode berturut-turut** (`hysteresis_periods_drop = 2`).

### C. Staf Baru (<3 Bulan Masa Kerja)
- Bidan dengan masa kerja kurang dari 3 bulan (dihitung dari `employment_started_at`) otomatis mendapatkan split flat **50:50** (Tier 1) dan diberi badge `BARU (<3 BLN)` di dasbor.

### D. Owner & Staf Non-Eligible
- Owner klinik (contoh: Bidan Yusi) memiliki flag `incentive_eligible: false` sehingga tidak dimasukkan ke dalam daftar penerima insentif retensi bidan.

---

## 6. Prosedur Penanganan Darurat & Rollback

### Skenario 1: Terjadi Salah Penetapan Tanggal Kunjungan Sebelum Kunci Final
- Selama snapshot masih berstatus `PREVIEW`, perbaiki data reservasi di menu Reservasi.
- Buka kembali tab Retensi; sistem akan otomatis menghitung ulang angka terbaru secara realtime.

### Skenario 2: Terjadi Koreksi Pasca Kunci Final (Status `FINAL`)
- Snapshot berstatus `FINAL` tidak boleh ditimpa secara diam-diam demi menjaga jejak audit.
- Jika terjadi sengketa fatal yang mewajibkan perhitungan ulang resmi:
  1. Super Admin dapat menghapus baris snapshot terkait di database (gunakan tahun & bulan terpisah, bukan kolom `period`):
     ```sql
     DELETE FROM staff_retention_snapshots
     WHERE tenant_id = 'default-tenant'
       AND period_year = 2027
       AND period_month = 2;
     ```
     Catat alasan koreksi di `docs/KNOWN_ISSUES.md` atau audit log internal sebelum eksekusi.
  2. Buka tab Retensi di dashboard, periksa angka terbaru, lalu klik **"Kunci Final Payroll"** kembali.

### Skenario 3: Penonaktifan Skema Retensi (Rollback Total)
- Karena perhitungan rupiah dilakukan secara manual off-system, rollback teknis tidak memengaruhi alur kas.
- Jika pemilik klinik memutuskan kembali ke sistem flat 50:50:
  1. Cukup abaikan rekomendasi tier di dashboard dan bayarkan seluruh staf dengan split flat 50:50.
  2. Tidak ada gangguan atau perubahan pada modul reservasi, live chat, maupun WhatsApp customer.

---

## 6. Prasyarat Deploy (WAJIB, urutan tidak boleh dibalik)

Fitur ini menambah 2 migrasi database. Kode sudah defensif sehingga tidak crash bila migrasi belum jalan, tetapi laporan **tidak bisa** membekukan snapshot sampai kolom/tabel tersedia.

```bash
cd /opt/wa-clinic-bot

# 1. Migrasi LEBIH DULU (aditif: tambah kolom + 3 tabel baru)
docker compose exec -T app npx prisma migrate deploy

# 2. Baru rebuild & recreate container app (WAHA tidak disentuh)
docker compose build app
docker compose up -d --no-deps app

# 3. Verifikasi
docker compose ps
docker compose exec -T app npx prisma migrate status
```

**Jangan** menjalankan `docker compose down` atau me-restart `waha`.

### Seed data yang dijalankan migrasi (tenant `default-tenant`)
- Policy retensi awal: jendela 60 hari, benchmark 34,6%, tier 31,1% / 38,1%, split 50/55/60, sampel min 40, tenure 4 bulan, downgrade 2 periode, soft landing sampai 2027-02-28.
- `Bidan Yusi F` → `incentive_eligible = false` (owner).
- `Bidan Hanifah` → `incentive_scheme = 'VOLUME'`.

Periksa hasilnya:

```sql
SELECT name, incentive_eligible, incentive_scheme, employment_started_at
FROM staff ORDER BY name;

SELECT tenant_id, window_days, benchmark_pct, min_sample, soft_landing_until
FROM retention_policies;
```
