# Laporan Verifikasi Ulang Integritas Audit Sistem

**Tanggal Verifikasi:** 2026-11-02 (Update: 2026-11-03)  
**Rujukan Plan:** `docs/plans/FIXING_PLAN_AUDIT_INTEGRITY_2026-11-02.md`  
**Status Eksekusi:** SELESAI (FASE 0–6) — 11 gate fase PASS; 11 kegagalan pre-existing di luar cakupan gate masih terbuka (#301, lihat §4.1 & §8)

---

## 1. Ringkasan Eksekutif

Audit verifikasi ulang ini dijalankan untuk menyelesaikan anomali integritas audit sistem yang tercatat pada isu **#298** (`Tabel reservation_archives Belum Ada di PostgreSQL Produksi`), **#299** (`Drift Inventaris, Flakiness Baseline & Cakupan Gate Audit`), dan **#300** (`Kontrak DELETE /api/admin/reservation/:id Menelan DB Error Menjadi 404`).

Seluruh 11 fase pengujian kanonis telah dijalankan ulang dengan skrip deterministik `scripts/audit-phase-gates.mjs`. Seluruh test yang diuji lulus 100% tanpa ada satu pun kegagalan baru. Test suite penuh (6.254 test dalam **754 file**) membuktikan bahwa kegagalan berkurang dari 27 → 22 → **11** (16 kegagalan lama berhasil diperbaiki), dengan **0 regresi baru** (`gagal(after7) ⊆ gagal(baseline-stable)`).

> **Catatan cakupan (KOREKSI 2026-11-03):** 11 kegagalan yang tersisa adalah **kegagalan asersi nyata** (bukan timeout) yang berada **di luar** 87 file gate fase — rinciannya di §4.1 dan `docs/KNOWN_ISSUES.md` #301. Artinya "11 fase PASS" hanya berlaku untuk 822 test yang masuk daftar gate, bukan untuk seluruh suite.

Fase 5 (Migrasi Live #298) telah dieksekusi dengan aman ke server produksi `klinik-server-baru` (`43.173.11.79:1403`) dengan backup database lengkap, migrasi sukses diterapkan, dan 0 error pada container worker. Bagian ini **diverifikasi ulang secara independen (baca-saja) pada 2026-11-03** — hasilnya di §6.

---

## 2. Hasil Gate Kanonis Per Fase (11 Fase)

Setiap fase dieksekusi menggunakan file test riil kanonis yang tercantum pada Master Audit Plan §E dan diverifikasi via file artefak `docs/audit/2026-11-02/fase-XX-recheck.json`. Nama domain di bawah ini **disamakan dengan Master Plan §E** (versi sebelumnya salah label sejak Fase 04 — lihat KOREKSI 2026-11-03).

| Fase | Nama Domain Audit (Master Plan §E) | File Test | Test Lulus | Test Gagal | Status Gate |
|---|---|---:|---:|---:|:---:|
| **Fase 01** | Arsitektur Inti, Multi-Tenant, Lifecycle | 7 | 47 | 0 | **PASS** |
| **Fase 02** | WhatsApp Gateway & Ingestion | 11 | 88 | 0 | **PASS** |
| **Fase 03** | Conversational AI Engine (V3) | 10 | 91 | 0 | **PASS** |
| **Fase 04** | Reservasi & Operasional Homecare | 7 | 59 | 0 | **PASS** |
| **Fase 05** | Web App Staf / Bidan Mobile | 8 | 120 | 0 | **PASS** |
| **Fase 06** | Live Chat CS & Hybrid Takeover | 7 | 48 | 0 | **PASS** |
| **Fase 07** | Pemasaran, Attribution & Tracking (Meta/CTWA) | 9 | 70 | 0 | **PASS** |
| **Fase 08** | Background Crons & Worker | 6 | 53 | 0 | **PASS** |
| **Fase 09** | Integrasi Eksternal | 9 | 143 | 0 | **PASS** |
| **Fase 10** | Pengaturan Sistem, RBAC & Data-Driven | 7 | 64 | 0 | **PASS** |
| **Fase 11** | Keamanan & Ketahanan | 6 | 39 | 0 | **PASS** |
| **Total** | **Seluruh Gate Kanonis** | **87** | **822** | **0** | **100% PASS** |

**Sifat gate:** `scripts/audit-phase-gates.mjs` membaca `numFailedTests` dari artefak JSON dan **exit 1** bila ada test gagal (diperbaiki 2026-11-03; sebelumnya hanya `console.warn` sehingga selalu exit 0). Daftar file gate tetap dipelihara manual di `PHASE_FILES`, sehingga fase hanya mencakup 87 file — bukan seluruh 754 file suite.

---

## 3. Matriks Otorisasi Admin & Staf (RBAC Deterministik)

Pengujian integrasi `tests/integration/admin-staff-authz-matrix.test.ts` memindai pohon rute **langsung dari instance Fastify yang diuji** (`app.printRoutes({ commonPrefix: false })`, bukan snapshot dokumen) lalu melakukan `app.inject` ke seluruh rute tanpa token/kredensial autentikasi.

- **Total Endpoint Dipindai:** **313 pasangan method+path** (266 path unik) di bawah `/api/admin/*` dan `/api/staff/*`. Ambang asersi test: **> 250 pasangan**.
- **Rute Public / Allowlist Terdokumentasi (7 entri):**
  1. `POST /api/admin/auth/login` (login admin)
  2. `POST /api/admin/auth/logout` (logout admin, idempoten)
  3. `POST /api/admin/auth/restore` (restore sesi)
  4. `GET /api/admin/auth/me` (cek identitas profil admin)
  5. `POST /api/staff/auth/login` (login staf bidan)
  6. `POST /api/staff/auth/logout` (logout staf, idempoten)
  7. `POST /api/staff/auth/restore` (restore token sesi staf, pre-auth)
- **Hasil:** **100% rute non-allowlist menolak panggilan tanpa kredensial dengan kode HTTP `401 Unauthorized` atau `403 Forbidden`**. Tidak ada satu pun endpoint admin/staf yang bisa diakses tanpa kredensial.
- **Batasan (jujur):** yang diuji adalah **penolakan tanpa kredensial**, bukan matriks peran vs izin granular (`role_api_scopes`). Untuk otorisasi granular, status masih **PARSIAL** — lihat §8.
- **Portabilitas:** test lulus **dengan maupun tanpa** file artefak `docs/audit/2026-11-02/fase-00/routes-tree.txt` (dibuktikan 2026-11-03 dengan menghapus sementara file tersebut). Versi sebelumnya hanya lulus bila file artefak lokal tersedia.

---

## 4. Hasil Baseline & Analisis Regresi

- **Stabilisasi Baseline (3× Run Identik):**
  - Run 1: 6.241 tests, 6.186 pass, 27 fail.
  - Run 2: 6.241 tests, 6.186 pass, 27 fail.
  - Run 3: 6.241 tests, 6.186 pass, 27 fail.
  - Hasil konsolidasi `docs/audit/2026-11-02/baseline-stable.json`: tepat 27 kegagalan pre-existing stabil (irisan 3 run = gabungan 3 run = 27, **0 flaky test**).
  - **Klarifikasi (KOREKSI 2026-11-03):** dari 27 kegagalan baseline, **hanya 6** yang berasal dari timeout 5.000 ms. Sisanya adalah **kegagalan asersi nyata** — bukan semuanya "timeout" seperti yang tersirat pada versi sebelumnya.
  - Akar masalah flakiness 6 test pada audit awal terbukti adalah batas `testTimeout` bawaan vitest (5.000 ms) yang terlampaui saat eksekusi paralel ribuan test.
- **Hasil Test Suite Penuh Pasca-Perbaikan:**
  - **Total Tests:** 6.254 di **754 file** (+13 tests baru dari authz matrix, reservation delete contract, age calculator regressions).
  - **Tests Gagal:** 27 → 22 (`after3`/`after4`/`after5`/`after6`) → **11** (`after7`, setelah Fase A #301) — total **16 kegagalan lama diperbaiki**.
  - **New Failures:** **0** pada setiap run (`gagal(after) ⊆ gagal(baseline-stable)`).
  - **Regression Diff:** **EXIT 0 (PASS)** — diverifikasi lima kali dengan artefak berbeda (`after3`, `after4`, `after5`, `after6`, `after7`); `after7` adalah run terakhir (6.215 lulus / 11 gagal) dan menjadi angka final laporan ini.

### 4.1 Sebaran Kegagalan Residual Saat Ini (11, di luar cakupan gate fase)

| File test | Jumlah gagal | Akar masalah | Butuh keputusan? |
|---|---:|---|---|
| `tests/unit/catalog-seed-drift.test.ts` | 3 | drift katalog backend vs fallback dashboard (**harga** & jumlah item) | **Ya** — harga kanonik harus ditetapkan pemilik klinik |
| `tests/unit/chat-schedule-extractor.test.ts` | 2 | aturan produk: baris form `Treatment : ...` ditolak bila >5 kata (nama multi-treatment sah jadi kosong) | **Ya** — ubah kode produk |
| `tests/unit/hybrid-reservation-parser.test.ts` | 2 | aturan produk: nama anak sengaja TIDAK disalin ke `name` pemesan, sedangkan test mengharapkan sebaliknya | **Ya** — ubah kode produk / ekspektasi |
| `tests/integration/v3-conversation-matrix.test.ts` | 2 | CM-07 (vaksin DPT) & CM-08 (trauma) menghasilkan array kosong | **Ya** — audit perilaku + keselamatan klinis |
| `tests/v3/agent-runner.test.ts` | 1 | skenario darurat medis tidak memanggil `escalate_to_human` | **Ya** — audit perilaku + keselamatan klinis |
| `tests/unit/adversarial-reservation-resilience.test.ts` | 1 | harga akumulatif 70.000 vs 85.000 (keluarga drift katalog) | **Ya** — ikut keputusan harga |

**Sudah diperbaiki pada Fase A (2026-11-03, 11 test, test-only):** `conversation-filter` (5 — mock `prisma.conversation.count` hilang), `reservation-security-and-integrity` (4 — tanggal absolut Oktober 2026 + ekspektasi tenant usang), `staff-otw-chat-poison` (1 — label relatif "Hari ini" memakai tanggal literal), `reservation-idempotency-request-id` (1 — field sesi `pendingScheduleCheck` dianggap kolom DB).

Tidak satu pun file di atas masuk daftar `PHASE_FILES` pada `scripts/audit-phase-gates.mjs`, sehingga gate 11 fase tetap hijau. Sisa 11 kegagalan dicatat sebagai utang teknis di `docs/KNOWN_ISSUES.md` **#301**.

---

## 5. Ringkasan Perbaikan Kode & Kontrak

### 5.1 Perbaikan Kontrak DELETE Reservasi (#300)
- **Lokasi:** `src/routes/admin/reservation-dispatch.route.ts:1953-2127`
- **Kontrak Baru:**
  - `DELETE /api/admin/reservation/:id` (default): **ARSIP** reservasi (membuat snapshot 60 hari di `reservation_archives` dan menghapus baris aktif).
  - `DELETE /api/admin/reservation/:id?soft=true`: **SOFT-CANCEL** (status = `cancelled`, baris tetap ada, memicu `followUpService.onReservationCancelled`).
  - `DELETE /api/admin/reservation/:id?hard=true`: Alias untuk kompatibilitas.
  - **Error Handling:** Jika DB error, endpoint mengembalikan `503 Service Unavailable` (`DB_UNAVAILABLE`), BUKAN menipu klien dengan `404 Reservation not found`.
  - Resiliensi fallback in-memory store tetap aktif saat database offline.
- **Penyelarasan:** 4 test integrasi/unit lama dan antarmuka UI `CustomerDatabase.tsx` telah diselaraskan.

### 5.2 Presisi Usia Kalender (#299-C)
- **Lokasi:** `src/utils/age-calculator.ts:180-185`, `src/services/child.service.ts`
- **Perbaikan:** Menghitung estimasi tanggal lahir untuk satuan bulan/tahun menggunakan aritmetika kalender (`addMonths(refDate, -months)`), menghilangkan bug roundtrip konversi 30,44 hari ("8 bulan" menjadi "7 bulan"). Presisi desimal bulan tetap dipertahankan (`Math.round(...) / 10`). Penyelarasan ekspektasi test pada `child-service.test.ts:52` berhasil mengembalikan ekspektasi kanonis usia 6 bulan.

### 5.3 Koreksi Inventaris & Dokumentasi (#299-D, #299-E)
- Statistik inventaris kuantitatif di `docs/FEATURE_INVENTORY.md` diperbarui menjadi 292 endpoint unik (343 pasangan method+path), 47 model Prisma, 16 enum.
- Path `tool-masker.ts` dikoreksi menjadi `src/v3/tools/tool-masker.ts`.
- Status laporan audit Fase 12 ditandai `PASS DENGAN CATATAN (lihat KOREKSI 2026-11-02)` dengan penjelasan flakiness timeout 5.000 ms.

---

## 6. Eksekusi Tuntas Fase 5: Migrasi Live #298 (`reservation_archives`)

Eksekusi Fase 5 dijalankan pada 2026-11-03 mengikuti protokol keselamatan server:
1. **Pratinjau Status:** `npx prisma migrate status` mendeteksi 1 migrasi yang belum terpasang: `20261101000000_add_reservation_archive`.
2. **Backup Snapshot Database:** Database produksi dibackup penuh via `pg_dump -U postgres -d wa_clinic_db -Fc` menghasilkan file `/tmp/pre_archive_migration_.dump` (ukuran 9,3 MB).
3. **Penerapan Migrasi:** `docker compose exec -T app npx prisma migrate deploy` menerapkan migrasi skema tabel arsip secara sukses tanpa error.
4. **Verifikasi Skema & Indeks:**
   - Tabel `public.reservation_archives` terverifikasi aktif dengan primary key `id`, relasi indeks `customer_id`, `reservation_id`, `tenant_id_archived_at`, `tenant_id_restore_until`.
   - `prisma migrate status` memastikan status: `Database schema is up to date!` (100 migrations found and applied).
5. **Verifikasi Worker:** Pemindaian log `wa-clinic-bot-worker-1` memastikan tidak ada lagi error `table public.reservation_archives does not exist` (0 error hit). Worker `ReservationArchivePurge` dan `DailyInvariantMonitor` kini berjalan normal.

### 6.1 Verifikasi Independen (2026-11-03, baca-saja)

Dijalankan lewat SSH ke `klinik-server-baru` (`43.173.11.79:1403`, user `ubuntu`, path `/opt/wa-clinic-bot`) **tanpa perintah tulis apa pun**:

| Yang diperiksa | Perintah | Hasil |
|---|---|---|
| Container | `docker compose ps` | `app` Up 41 jam (healthy), `worker` Up 41 jam, `postgres` Up 3 minggu (healthy), `redis`/`waha`/`caddy` Up |
| Tabel arsip | `psql -c '\d reservation_archives'` | Tabel ada; **5 indeks**: `_pkey` (id), `customer_id`, `reservation_id`, `(tenant_id, archived_at)`, `(tenant_id, restore_until)` |
| Riwayat migrasi | `select ... from _prisma_migrations` | `20261101000000_add_reservation_archive` **finished_at = 2026-11-03 01:05:29 UTC** (08:05 WIB) |
| Total migrasi | `count(*) ... finished_at not null` | **100** migrasi terpasang |
| Status skema | `npx prisma migrate status` (exec app) | `Database schema is up to date!` |
| Backup | `ls -lh /tmp/*.dump` **di dalam container postgres** | `pre_archive_migration_.dump` **9,3 MB**, 3 Nov 08:05 |
| Error worker | `docker compose logs worker \| grep -c "reservation_archives does not exist"` | **0** pada 30 menit terakhir dan **0** pada 24 jam terakhir |
| Isi tabel | `select count(*) from reservation_archives` | 0 baris (belum ada reservasi yang diarsipkan — wajar) |

**Catatan operasional:** file dump berada di `/tmp` **container** `postgres`, bukan host, sehingga akan hilang bila container di-recreate. Bila backup ini ingin dipertahankan, salin ke host/volume persisten (`docker compose cp postgres:/tmp/pre_archive_migration_.dump ./backups/`).

---

## 7. Status Akhir Seluruh Temuan Audit

| ID Isu | Deskripsi | Status Awal | Status Akhir | Bukti Penyelesaian |
|---|---|:---:|:---:|---|
| **#298** | Tabel `reservation_archives` Belum Ada di PostgreSQL Produksi | OPEN | **RESOLVED** | Migrasi `20261101000000_add_reservation_archive` applied (finished 2026-11-03 01:05:29 UTC, 100 migrasi total); `\d reservation_archives` aktif dengan 5 indeks; dump 9,3 MB; worker error 0 (30 menit & 24 jam) — **diverifikasi independen via SSH (§6.1)**. |
| **#299** | Drift Inventaris, Flakiness Baseline & Cakupan Gate Audit | OPEN | **RESOLVED** | Baseline stabil 27 (0 flaky); 11 fase 822 test PASS (0 fail) via gate yang kini **exit 1 bila gagal**; Authz matrix 100% (313 pasangan, portabel tanpa artefak); full suite 754 file/6.254 test, 0 regresi. |
| **#300** | Error DB pada `DELETE` Reservasi Menyamar Jadi 404 | OPEN | **RESOLVED** | Kontrak default = ARSIP, `?soft=true` = CANCEL, DB error = 503; 5 test adversarial PASS. |
| **#301** | Kegagalan Test Pre-existing di Luar Cakupan Gate Fase | — | **OPEN (11 tersisa)** | Awal 22 → **11** setelah Fase A (test-only, 0 regresi): 5 mock `count` hilang, 4 calendar-rot, 1 label relatif, 1 field sesi dianggap kolom DB. Sisa 11 menunggu keputusan bisnis/medis (lihat §4.1 & `KNOWN_ISSUES.md` #301). |

---

## 8. Hal yang Masih Tidak Dapat Diverifikasi / Dibatasi

Sesuai mandat plan §4.3, bagian ini mencatat batas verifikasi secara jujur:

1. **Otorisasi granular (peran vs izin).** Matriks RBAC hanya membuktikan **penolakan tanpa kredensial** (401/403) untuk 313 pasangan method+path. Pemetaan `role_api_scopes` (siapa boleh apa) **belum** diuji per peran → status otorisasi tetap **PARSIAL**.
2. **Cakupan gate fase terbatas 87 file.** 11 kegagalan di 6 file (§4.1) berada di luar daftar gate; "11 fase PASS" **tidak** berarti seluruh suite hijau. Daftar `PHASE_FILES` dipelihara manual sehingga bisa drift.
3. **Konfigurasi runtime produksi.** `SEPARATE_WORKER`, varian model AI, dan flag WAHA/Meta CAPI yang aktif di server tidak diperiksa dalam audit ini.
4. **Perilaku WhatsApp/Meta live.** Tidak ada pengujian end-to-end ke nomor WhatsApp sungguhan atau Pixel Meta asli (sengaja dihindari sesuai aturan keselamatan).
5. **Kontrak ARSIP vs notifikasi staf.** Perilaku "kirim notifikasi staf saat reservasi diarsipkan" tidak punya test khusus (test lama `?hard=true` kini memakai `?soft=true`, sehingga hanya jalur cancel yang tercakup).
6. **Backup produksi** hanya berada di `/tmp` container postgres (lihat §6.1), belum dipindahkan ke penyimpanan persisten.
