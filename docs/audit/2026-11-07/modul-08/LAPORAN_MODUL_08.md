# Laporan Audit Modul 8 — Background Crons & Pekerja Mandiri

> **Tanggal audit:** 2026-11-07
> **Commit baseline:** `8c6ee2ea` (working tree bersih saat audit)
> **Mode:** AUDIT BACA-SAJA. Tidak ada kode/test/config/.env yang diubah; tidak ada server, DB, WAHA, Meta, atau deploy yang disentuh.
> **Lingkup:** `src/worker.ts`, `src/lifecycle/background-crons.ts`, `src/services/cron.service.ts`, dan seluruh service yang dipanggil cron/worker.
> **Di luar lingkup:** Modul 4 (Reservasi) dan Modul 6 (Live Chat) tidak diaudit ulang; temuan detailnya dirujuk ke `#314` dan `#316`.

---

## 1. Ringkasan Eksekutif

**Status:** **MERAH untuk operational excellence & reliability cron.** Modul ini belum bisa dinyatakan sehat hanya karena kode terdaftar dan build hijau.

Temuan utama:

1. **Backup mingguan bukan dump database penuh.** Image produksi tidak memasang `postgresql-client`, sehingga `pg_dump` tidak tersedia dan kode selalu jatuh ke dump programatik yang hanya memuat **12 tabel**, dengan setiap query dibungkus `.catch(() => [])`. File tetap dicatat "berhasil" dan diunggah, lalu backup lama dipangkas. Ini adalah jalur kehilangan data paling serius di modul ini (**K-003**, RPN 648).
2. **Penjadwalan tidak persisten.** Hampir semua cron memakai `setInterval` murni; status jadwal hanya hidup di RAM. Cron 6/24 jam tidak punya *catch-up* saat boot, sehingga pada sistem yang sering di-recreate (mis. deploy worker) pekerjaan retensi, purge arsip, invariant monitor, dan backup bisa **tidak pernah berjalan** (**K-002**, RPN 336).
3. **Kegagalan cron tidak pernah menjadi alert.** Hampir semua pekerja menelan error menjadi `console.error`/`console.warn`; tidak ada status `FAILED`, tidak ada penghitung kegagalan beruntun, tidak ada heartbeat. Operator baru tahu saat data sudah hilang (**K-005**, RPN 270).
4. **Sheets outbox tidak punya atomic claim.** `listPending()` mengambil baris `pending`/`processing`, tetapi tidak ada kode yang menulis `processing`; boot-run dan run terjadwal bisa tumpang tindih, dan kegagalan DB setelah `appendRow` tetapi sebelum `saveRowRef` akan meng-append baris keuangan yang sama dua kali (**K-004**, RPN 252).
5. **Tidak ada lock tunggal/healthcheck worker.** `SEPARATE_WORKER` hanya gerbang konfigurasi; tidak ada advisory lock, lease per job, atau heartbeat. Dua proses worker (atau app tanpa flag) dapat menjalankan seluruh cron secara ganda tanpa terdeteksi (**K-001**, RPN 243).

Jumlah temuan: **13** — **4 KRITIS**, **5 TINGGI**, **3 SEDANG**, **1 RENDAH**. Tidak ada temuan yang merupakan duplikasi temuan SELESAI di `docs/KNOWN_ISSUES.md`; rujukan silang dicantumkan di §3.

**Cakupan bukti run:** dari 22 pekerja yang terdaftar di kode, hanya **1 pekerja punya bukti eksekusi di produksi** (Follow-Up Worker, audit 2026-11-02; log "di luar jam kerja", bukan bukti pesan terkirim), **2 punya bukti gagal historis di produksi** (Archive Purge & Invariant Monitor sebelum `#298`), **1 punya bukti aktivasi** (Ad Watchdog, `#317`), dan **18 sisanya tidak punya bukti run yang dapat diverifikasi** pada audit ini. Bukti lokal terbatas pada log 2026-09/10. Karena itu, **tidak ada satu pun cron yang boleh diklaim PASS hanya dari pembacaan kode**; kolom "bukti run" di §4 adalah bagian wajib dari penilaian.

---

## 2. Framework & Cakupan

### 2.1 Framework

- **AWS Well-Architected — Operational Excellence:** definisi kerja, observability, failure isolation, runbook, mekanisme rollback.
- **AWS Well-Architected — Reliability:** idempotensi, retry/backoff, lock/lease, graceful degradation, pemulihan setelah restart.
- **FMEA (Failure Mode and Effects Analysis):** setiap mode kegagalan diberi `S × O × D = RPN`.
  - `S=9` untuk kehilangan data permanen atau duplikasi massal (uang, pesan keluar, baris rekapan).
  - `S=7–8` untuk kegagalan pemulihan/backup atau PII yang tertahan melewati kebijakan.
  - `S=4–6` untuk keterlambatan/non-kritis (analitik, notifikasi, laporan).
  - `D=9` bila kegagalan tidak terlihat sama sekali (tidak ada alert/status).
- **Hypothesis-driven:** setiap hipotesis diuji ke kode dan bukti, bukan diasumsikan.

### 2.2 Tahap 0–6

| Tahap | Yang dilakukan | Hasil |
|---|---|---|
| **0. Framework & aturan** | Menetapkan mode baca-saja, pilar WA, aturan bukti `file:line`, dan larangan menyentuh server/WAHA/Meta. | Selesai. Tidak ada perubahan file selain laporan ini. |
| **1. Temuan lama** | Membaca `docs/KNOWN_ISSUES.md`, `docs/audit/2026-11-02/fase-08/LAPORAN_FASE_08.md`, `CHANGELOG.md`, dan `docs/RUNBOOK_DEPLOY_PERF.md`. | Temuan lama dipetakan di §3; tidak ada re-audit modul lain. |
| **2. Scoping & inventaris** | Menghitung ulang registrasi cron dari `background-crons.ts` dan `worker.ts`; memeriksa flag env, default, dan pemanggil service. | Ditemukan **22 pekerja** (bukan 21); rincian §4. |
| **3. Audit horizontal** | Memeriksa pola umum: `setInterval`, jitter, boot-run, loop tenant, timezone WIB, shutdown, healthcheck, logging. | Menemukan pola sistemik K-001, K-002, K-005, K-010, K-011. |
| **4. Audit vertikal + akar masalah** | Menelusuri setiap pekerja sampai service yang menulis DB/API: claim, status, retry, delete, append, enkripsi. | Menemukan K-003, K-004, K-006, K-007, K-008, K-009, K-012. |
| **5. FMEA & ranking** | Memberi S/O/D dan RPN; memisahkan severity berdasarkan RPN dan dampak. | Tabel §6. |
| **6. Verifikasi & rekomendasi** | Menyusun rencana perbaikan bertahap, acceptance criteria, regression gate, dan batasan cakupan. | §7–§8. |

### 2.3 Cakupan file yang diperiksa

- `src/worker.ts`, `src/lifecycle/background-crons.ts`, `src/lifecycle/interval-registry.ts`, `src/lifecycle/shutdown.ts`, `src/app.ts:315-319`
- `src/services/cron.service.ts`
- `src/services/sheets/sheets-sync.service.ts`, `src/services/notification-delivery.service.ts`, `src/services/backup.service.ts`
- `src/services/media.service.ts`, `src/services/chat-export.service.ts`, `src/services/llm-evaluator.service.ts`
- `src/services/daily-invariant-monitor.service.ts`, `src/services/daily-report.service.ts`, `src/services/staff-notification.service.ts`
- `src/services/follow-up.service.ts`, `src/services/shareloc-reminder.service.ts`, `src/services/frustration-signal.service.ts`
- `src/services/slot-overlap.service.ts`, `src/services/staff-trip-tracking.service.ts`, `src/services/label-reconciliation.service.ts`
- `src/integrations/google-drive/client.ts`, `Dockerfile`, `docker-compose.yml`
- `prisma/schema.prisma` (model `SheetsSyncOutbox`, `AdminNotificationLog`, `AiEvaluation`)
- `docs/FEATURE_INVENTORY.md` §8, `docs/KNOWN_ISSUES.md`, `docs/audit/2026-11-02/fase-08/LAPORAN_FASE_08.md`

### 2.4 Aturan bukti & tingkat keyakinan

- **TERBUKTI:** perilaku dapat dibaca langsung di kode/schema dan tidak bergantung pada kondisi runtime yang tidak diperiksa.
- **KEMUNGKINAN BESAR:** mekanisme ada di kode, tetapi terjadinya di produksi bergantung pada timing/konfigurasi yang tidak bisa diuji dari repo.
- **DUGAAN:** hanya inferensi; selalu ditandai `[ASUMSI]`.
- Setiap temuan wajib punya minimal satu kutipan kode dengan `file:line`. Klaim tanpa bukti tidak dimasukkan sebagai temuan.

---

## 3. Status Temuan Lama (tidak diaudit ulang)

| ID | Status | Keterkaitan dengan audit ini | Tindakan |
|---|---|---|---|
| **#298** | **RESOLVED** | Tabel `reservation_archives` sudah ada; archive purge & invariant monitor sebelumnya gagal. | Dirujuk sebagai bukti historis; tidak dibuka ulang. |
| **#310** | **RESOLVED** | Deploy sekarang me-rebuild `worker`; relevan untuk K-002 karena setiap deploy = restart proses = jadwal RAM hilang. | Dirujuk; bukan temuan baru. |
| **#314** | **RESOLVED** | Hold sweep memakai `ACTIVE_HOLD_WINDOW_MS` dan hook LTV/follow-up; detail reservasi tidak diaudit ulang. | Hanya masuk matriks baris 7. |
| **#317** | **MITIGATED / BY DESIGN** | Ad Watchdog aktif di produksi sejak 2026-11-06 19:06 WIB; interval 30 menit di container `worker`. | Menjadi bukti aktivasi baris 22; detail tidak diduplikasi. |
| **#318** | **OPEN — DESIGN GAP** | Klasifikasi `LOW_CTR` vs `INSTRUMENTATION_SUSPECT` pada Ad Watchdog. | Dirujuk; bukan temuan baru Modul 8. |
| **#250** | **FIXED** | Insiden worker ganda / kebocoran balasan AI; mitigasi lewat `SEPARATE_WORKER`. | K-001 hanya membahas **residu**: gerbang masih konfigurasi, bukan lock runtime. |
| **#144** | **OPEN — sebagian by design** | Notifikasi WA multi-nomor memakai `idempotency_key` NULL sehingga tidak idempoten per nomor. | Dirujuk di K-007; bukan duplikasi. |
| **#293** | **RESOLVED** | Completeness Guard pada **restore** backup. | K-003 adalah sisi **pembuatan** backup yang belum dijaga; berbeda. |
| **#312** | **OPEN** | Inventaris fitur & flag env tidak akurat (5 worker mati di `.env` lokal). | Dirujuk di K-013. |
| **#267** | **OPEN** | `qrisImageUrl` belum dikecualikan dari pruning/retensi media. | K-012 menyoroti jalur `deleteExpiredMessages` yang lebih luas; tidak menduplikasi #267. |
| **Fase 08 (2026-11-02)** | Laporan lama | Menyatakan `outbox.claimed_at` + atomic claim. **Klaim ini tidak didukung kode/schema saat ini**: tidak ada kolom `claimed_at`, dan status `processing` tidak pernah ditulis. | Dikoreksi di K-004; laporan lama tidak dianggap bukti PASS. |

**Catatan:** audit ini tidak mengklaim temuan lama sebagai temuan baru. Bila sebuah rekomendasi menyentuh area yang sudah punya ID, ID tersebut disebut eksplisit.

---

## 4. Matriks Pekerja (22 entri)

> **Koreksi jumlah:** Brief menyebut 21 pekerja (15 aktif default + 6 opt-in). Kode saat ini mendaftarkan **22 entri**: 14 default-on, 1 kondisional (`Daily Ops Report`), dan 7 opt-in. Selisihnya adalah **Ad Watchdog** yang ditambahkan 2026-11-06 (`#317`) dan belum masuk tabel `FEATURE_INVENTORY.md` §8. Rincian: §4.1.

Kolom **bukti run** hanya berisi bukti yang benar-benar ada di repo/log yang bisa dibaca. "Tidak ada" berarti **celah cakupan**, bukan klaim bahwa worker pasti mati.

| # | Nama | File (registrasi → eksekusi) | Flag | Default | Bukti run | Idempotensi | Risiko |
|---|---|---|---|---|---|---|---|
| 1 | **Label Reconciliation** | `background-crons.ts:22-29` → `cron.service.ts:159-174` | `ENABLE_LABEL_RECONCILIATION_CRON=true` | **OFF** | Tidak ada | Update flag per customer; aman diulang, tetapi tidak atomik per batch. | K-001, K-002; **patuh larangan WAHA** (hanya DB internal). |
| 2 | **Google Sheets Outbox Sync** | `background-crons.ts:33-41` → `cron.service.ts:131-152`; `sheets-sync.service.ts:171-221` | `ENABLE_SHEETS_SYNC_CRON !== 'false'` | **ON** (3 mnt + boot) | Registrasi lokal `logs/app-2026-10-05.log:18`; run sukses tidak ada. | **TIDAK ADA atomic claim.** `status=processing` tidak pernah ditulis. | **K-004** (duplikasi baris keuangan), K-001. |
| 3 | **Media Cleanup** | `background-crons.ts:44-52` → `cron.service.ts:181-196` | `ENABLE_MEDIA_CLEANUP_CRON !== 'false'` | **ON** (24 jam + boot) | Lokal `logs/app-2026-09-13.log:24` ("20 file kadaluarsa dihapus"). | Berbasis file; rerun aman secara umum. | **K-012** (file bersama/proteksi config), K-002. |
| 4 | **Message Retention** | `background-crons.ts:55-62` → `cron.service.ts:204-222` | `ENABLE_MESSAGE_RETENTION_CRON === 'true'` | **OFF** | Tidak ada | `deleteMany` berdasarkan cutoff; tidak ada claim/lease. | **K-012**, K-002. |
| 5 | **Staff Session Housekeeping** | `background-crons.ts:65-70` → `staff-auth.service.ts:140-151` | Tanpa flag | **ON** (24 jam) | Tidak ada | `deleteMany` sesi kedaluwarsa; idempoten. | Rendah; K-002. |
| 6 | **Pre-Visit Brief Bidan** | `background-crons.ts:73-80` → `cron.service.ts:481-496`; `staff-notification.service.ts:522-543` | `ENABLE_PRE_VISIT_BRIEF !== 'false'` | **ON** (10 mnt) | Tidak ada | Flag `pre_visit_brief_sent_at` (baik). | K-005 (gagal kirim hanya log). |
| 7 | **Expired Hold Sweep** | `background-crons.ts:83-90` → `cron.service.ts:503-537` | `ENABLE_EXPIRED_HOLD_SWEEP !== 'false'` | **ON** (6 jam) | Tidak ada (pasca-`#298`) | `updateMany` dengan `status='hold'` (baik); hook LTV/follow-up best-effort. | `#314` (batch `take: 500`, hook bisa hilang), K-002. |
| 8 | **Reservation Archive Purge** | `background-crons.ts:93-100` → `cron.service.ts:548-560` | `ENABLE_RESERVATION_ARCHIVE_PURGE !== 'false'` | **ON** (24 jam) | Audit 2026-11-02: **error** tabel tidak ada (`LAPORAN_FASE_08.md:37-38`). Pasca-`#298` tidak ada bukti sukses. | Delete by `restore_until` (baik); tidak ada claim. | K-002, K-005. |
| 9 | **Daily Invariant Monitor** | `background-crons.ts:103-109` → `daily-invariant-monitor.service.ts:203-229` | `ENABLE_INVARIANT_MONITOR !== 'false'` | **ON** (24 jam) | Audit 2026-11-02: **error** tabel arsip; pasca-fix tidak ada bukti. | Cek read-only, **tetapi** auto-repair LTV menulis DB. | **K-008**. |
| 10 | **Slot Overlap Sweep** | `background-crons.ts:112-119` → `cron.service.ts:562-588` | `ENABLE_SLOT_OVERLAP_SWEEP !== 'false'` | **ON** (15 mnt) | Tidak ada | Alarm dedupe dengan cooldown (`slot-overlap.service.ts:473-498`). | K-005 (gagal query hanya log). |
| 11 | **Trip Auto-Close Sweep** | `background-crons.ts:122-129` → `cron.service.ts:595-628` | `ENABLE_TRIP_AUTOCLOSE_SWEEP !== 'false'` | **ON** (15 mnt) | Tidak ada | `clearTrip` idempoten, **tetapi state trip di `Map` RAM** (`staff-trip-tracking.service.ts:408`). | **K-007** (state hilang saat restart), K-002. |
| 12 | **Assignment Notification Sweep** | `background-crons.ts:132-139` → `cron.service.ts:634-649` | `ENABLE_ASSIGNMENT_NOTIF_SWEEP !== 'false'` | **ON** (2 mnt) | Tidak ada | Atomic `updateMany` claim (`staff-notification.service.ts:606-610`) — **contoh baik**. | Rendah; K-005. |
| 13 | **Frustration SLA Sweep** | `background-crons.ts:142-149` → `cron.service.ts:437-452` | `ENABLE_FRUSTRATION_SWEEP !== 'false'` | **ON** (5 mnt) | **Ada:** audit live 2026-11-02 (`LAPORAN_FASE_08.md:21`); lokal `logs/app-2026-09-27.log:69` (29 percakapan). | Hanya menulis saat status berubah (`frustration-signal.service.ts:82-100`). | Sedang: `take: 200` tanpa paging; K-005. |
| 14 | **Shareloc Reminder Sweep** | `background-crons.ts:152-159` → `cron.service.ts:459-475` | `ENABLE_SHARELOC_REMINDER_SWEEP === 'true'` | **OFF** | Tidak ada | Kunci harian `AdminNotificationLog` (`shareloc-reminder.service.ts:222-253`). | K-001, K-002. |
| 15 | **Nightly Watchdog** | `background-crons.ts:162-230` | Selalu terdaftar; per tenant `nightly_report_enabled` | **ON** (cek 15 mnt, target 21:00 WIB) | Tidak ada bukti spesifik | Telegram pakai `idempotencyKey`; **WA tidak**; penjaga tanggal di RAM. | **K-007** (dobel WA saat restart, laporan hilang bila proses mati). |
| 16 | **AI LLM Quality Evaluation** | `background-crons.ts:233-240` → `cron.service.ts:283-299` | `ENABLE_AI_EVAL_CRON === 'true'` | **OFF** | Tidak ada | Upsert unik per `message_id` (`llm-evaluator.service.ts:226-239`) — **contoh baik**. | K-002, K-005; sampling `NaN` bila env invalid. |
| 17 | **Daily Chat Export** | `background-crons.ts:243-250` → `cron.service.ts:230-245` | `ENABLE_CHAT_EXPORT_CRON === 'true'` | **OFF** | Changelog 2026-08 menyebut aktif di server, tetapi tidak ada bukti run. | Overwrite per tanggal; **batas hari UTC vs nama file WIB**. | **K-006** (data 00:00–06:59 WIB tidak pernah masuk). |
| 18 | **Daily Ops Report** | `background-crons.ts:253-282` → `daily-report.service.ts:47-126` | `ENABLE_DAILY_REPORT_CRON` atau `tenant.daily_report_enabled` | **ON bila flag tenant/env** (cek 30 mnt) | Tidak ada | `DailyReportLog` unik per tenant+tanggal; tetapi kirim→log tidak atomik. | K-005, K-007 (kirim sukses lalu log gagal → potensi dobel). |
| 19 | **Follow-Up Drip Worker** | `background-crons.ts:288-294` → `cron.service.ts:112-124`; `follow-up.service.ts:1674+` | `ENABLE_FOLLOWUP_WORKER === 'true'` | **OFF** | **Ada:** audit live 2026-11-02 (`LAPORAN_FASE_08.md:26`, "di luar jam kerja"). | Lease `processing_claimed_at` + reclaim (`follow-up.service.ts:2051-2068`). | K-001, K-002; tetap bisa dobel bila dua runner. |
| 20 | **Morning Jobs & Briefing** | `background-crons.ts:296-319` → `cron.service.ts:10-58` | Selalu terdaftar | **ON** (cek 15 mnt, target 06:00 WIB) | Tidak ada | Klaim DB `MORNING_JOBS:{tenant}:{date}` (`:69-97`) — at-most-once, bukan at-least-once. | **K-007** (crash setelah klaim = job hilang sehari). |
| 21 | **Weekly Database Backup** | `background-crons.ts:311-314` → `cron.service.ts:654-668`; `backup.service.ts:52-148` | Selalu terdaftar | **ON** (Senin 02:00 WIB) | Tidak ada | Penjaga tanggal di RAM; tidak ada claim DB; file dump tidak diverifikasi. | **K-003** (paling kritis). |
| 22 | **Ad Funnel Watchdog** | `background-crons.ts:323-345` → `ad-watchdog.service.ts:273+` | `ENABLE_AD_WATCHDOG_CRON === 'true'` | **OFF** (produksi **ON**, `#317`) | **Ada bukti aktivasi:** `#317` (aktif 2026-11-06 19:06, backtest 14 hari). Log run cron tidak diperiksa. | Cooldown + `AdminNotificationLog` per jam (`ad-watchdog.service.ts:318-393`) — **contoh baik**. | `#318` (desain sinyal), K-001. |

### 4.1 Rekonsiliasi jumlah 21 vs 22

- `docs/FEATURE_INVENTORY.md:197` menulis **"21 background worker"**; tabel `:201-221` memuat 21 baris dan **tidak memuat Ad Watchdog**.
- `background-crons.ts:323-345` sudah mendaftarkan **Ad Watchdog**; `#317` menyatakan aktif di produksi.
- Maka kode = **22 entri**; dokumentasi = **21**. Ini dicatat sebagai **K-013** (drift dokumentasi), bukan temuan fungsional baru.

### 4.2 Ringkasan bukti run

| Kategori bukti | Jumlah | Pekerja |
|---|---:|---|
| Bukti **eksekusi** di produksi (bukan bukti hasil) | 1 | Follow-Up Worker (audit 2026-11-02; hanya log "di luar jam kerja", bukan bukti pesan terkirim) |
| Bukti **gagal** di produksi (historis) | 2 | Archive Purge, Invariant Monitor (sebelum `#298`) |
| Bukti **aktivasi/konfigurasi** produksi | 1 | Ad Watchdog (`#317`) |
| Bukti run **lokal** (bukan produksi) | 2 | Media Cleanup (2026-09-13), Frustration Sweep (2026-09-27) |
| **Tanpa bukti run** | 16 | Sisanya |

**Konsekuensi metodologis:** 16 pekerja tidak boleh diberi status PASS. Kolom "terdaftar" hanya membuktikan niat registrasi, bukan eksekusi.

### 4.3 Timezone WIB

| Pola | Pekerja | Verdict |
|---|---|---|
| Offset manual `+7 * 60 * 60 * 1000` lalu `getUTC*` | Nightly Watchdog (`background-crons.ts:169-180`), Daily Ops (`:258-260`), Morning/Weekly (`:300-312`), Shareloc (`shareloc-reminder.service.ts:80+`), Ad Watchdog (`ad-watchdog.service.ts:366`) | **PASS** — tidak bergantung TZ host. |
| Tanggal lokal host (`new Date().getFullYear()`) | `chat-export.service.ts:80-85` untuk nama file; `cleanupOldAdClicks` `cron.service.ts:328-329` | **PARTIAL** — bergantung `TZ=Asia/Jakarta` di compose; tanpa TZ menjadi UTC. |
| Batas hari UTC untuk data, nama file WIB | `chat-export.service.ts:88-93` vs `:80-85` | **FAIL** — lihat K-006. |
| Jendela absolut `Date.now()` | Hold sweep, slot overlap, trip, pre-visit, frustration | **PASS** — tidak perlu kalender. |

### 4.4 Overlap, failure isolation, dan shutdown

- **Overlap:** `trackInterval()` hanya `setInterval`; tidak ada mutex/in-flight guard (`interval-registry.ts:16-20`). Pekerjaan yang lebih lama dari interval dapat berjalan bersamaan. Bukti paling konkret: Sheets dipanggil sekali saat boot **dan** dijadwalkan 0–30 detik kemudian (`background-crons.ts:37-38`).
- **Failure isolation per tenant:** beberapa pekerja punya `try` per tenant (hold sweep `cron.service.ts:509-531`, slot `:570-579`, Sheets `:137-147`), tetapi banyak yang tidak (label `:165-169`, media `:186-189`, retensi `:210-215`, AI eval `:290-292`, pre-visit `:487-489`, assignment `:640-642`, Ad Watchdog `:330-335`). Service di dalamnya kadang menelan error, sehingga dampaknya bervariasi; ini dicatat sebagai K-011 (fokus pada init worker yang paling terbukti).
- **Shutdown:** `worker.ts:39-51` hanya `clearAllIntervals()` lalu `queueService.close()` dan `prisma.$disconnect()`; tidak ada penantian job yang sedang berjalan, dan `process.exit` dipaksa setelah 10 detik (`:25`, `:33-37`). `trackIntervalStaggered` membuat `setTimeout` starter yang **tidak terdaftar** di registry (`background-crons.ts:5-11` vs `interval-registry.ts:23-32`), sehingga shutdown dalam 30 detik pertama tetap bisa menembakkan job setelah Prisma diputus.

---

## 5. Daftar Temuan

> Format setiap temuan: lokasi, bukti, keyakinan, akar masalah, FMEA, collateral damage, rekomendasi fondasional, verifikasi.

### K-001 — Tidak ada lock tunggal/lease/heartbeat; cron ganda dan worker mati tidak terdeteksi

- **Severity:** TINGGI · **RPN 243** · **Keyakinan: TERBUKTI**
- **Lokasi:** `src/lifecycle/background-crons.ts:20-345`, `src/lifecycle/interval-registry.ts:16-32`, `src/worker.ts:76-119`, `src/app.ts:313-319`, `docker-compose.yml:75-110`.
- **Bukti:**
  - Seluruh registrasi memakai `trackInterval`/`trackIntervalStaggered`, yang hanya membungkus `setInterval`:
    ```ts
    // interval-registry.ts:16-20
    export function trackInterval(fn: () => void | Promise<void>, ms: number): IntervalHandle {
      const handle = setInterval(fn, ms);
      handles.push(handle);
      return handle;
    }
    ```
  - Tidak ada `pg_advisory_lock`, `SELECT ... FOR UPDATE`, `SKIP LOCKED`, atau tabel lease di jalur cron. Pencarian `advisory|SKIP LOCKED|pg_try_advisory` di `src/lifecycle`, `cron.service.ts`, `sheets-sync.service.ts`, `backup.service.ts` = **0 hasil**.
  - Pemisahan proses hanya lewat env:
    ```ts
    // app.ts:315-319
    if (process.env.SEPARATE_WORKER === 'true') {
      console.log('👷 [APP] SEPARATE_WORKER=true terdeteksi: melewati background crons...');
    } else {
      startBackgroundCrons();
    }
    ```
  - Service `worker` tidak punya `healthcheck` (`docker-compose.yml:75-110`); `app` punya (`:15-20`). `GET /health` hanya mengembalikan `{status:'OK'}` (`src/routes/health.route.ts:10-15`), tidak memeriksa heartbeat cron.
- **Akar masalah:** "single runner" diwujudkan sebagai konfigurasi compose, bukan invariant runtime. Tidak ada identitas proses, lease, atau heartbeat. Tidak ada cara membedakan "worker sehat" dari "worker hidup tetapi semua timer berhenti".
- **FMEA:** S=9 (dobel pesan/baris uang), O=3 (misconfig/scale/split-brain; pernah terjadi di `#250`), D=9 (tidak ada alert) → **RPN 243**.
- **Collateral damage:** bila lock ditambahkan tanpa lease expiry, job bisa macet selamanya setelah worker mati; bila alert terlalu agresif, spam. Perlu stale-lease reclaim dan alert berjenjang.
- **Rekomendasi fondasional (tenant-aware, tanpa dependency baru):**
  1. Tambah tabel `CronJobLease`/`CronRunLog` (Prisma/Postgres) dengan `job_key`, `tenant_id` (nullable untuk job global), `scheduled_for`, `started_at`, `finished_at`, `heartbeat_at`, `locked_until`, `status`, `last_error`, `metrics JSON`. Unique `(job_key, tenant_id, scheduled_for)` untuk idempotensi.
  2. Worker memegang **Postgres advisory lock** seumur proses (`pg_try_advisory_lock(hashtext('wa-clinic-worker'))`); bila gagal di production → **jangan start cron** dan kirim alert (fail-closed).
  3. Setiap job mengakuisisi lease atomik (`INSERT ... ON CONFLICT DO NOTHING` atau `UPDATE ... WHERE locked_until < now()`), memperbarui `heartbeat_at` tiap 30 detik.
  4. Ekspos `GET /ready` atau endpoint admin yang membaca `last_success_at`/`heartbeat_at`; alert bila `now - heartbeat > 2 × interval`.
- **Verifikasi:** jalankan dua proses worker dengan DB yang sama → hanya satu yang mengeksekusi; matikan satu di tengah job → lease di-reclaim setelah `locked_until`; test unit `cron-lease.test.ts`; test integrasi `cron-double-runner.test.ts`.

---

### K-002 — Jadwal berbasis `setInterval` tidak persisten; cron 6/24 jam bisa tidak pernah berjalan

- **Severity:** KRITIS · **RPN 336** · **Keyakinan: TERBUKTI**
- **Lokasi:** `src/lifecycle/background-crons.ts:26, 49, 59, 87, 97, 106, 237, 247`; `src/lifecycle/interval-registry.ts:16-20`; `src/worker.ts:116-118`.
- **Bukti:**
  - Hampir semua pekerja langsung memakai `trackInterval(fn, interval)` tanpa eksekusi awal dan tanpa menyimpan `last_run`:
    ```ts
    // background-crons.ts:83-87
    if (process.env.ENABLE_EXPIRED_HOLD_SWEEP !== 'false') {
      const intervalHours = parseInt(process.env.EXPIRED_HOLD_SWEEP_INTERVAL_HOURS || '6', 10);
      ...
      trackInterval(() => cron.runExpiredHoldSweep(), intervalHours * 60 * 60 * 1000);
    }
    ```
    Pola sama untuk archive purge (`:93-97`, 24 jam), invariant (`:103-106`, 24 jam), message retention (`:55-59`, 24 jam), AI eval (`:233-237`, 6 jam), chat export (`:243-247`, 6 jam), label reconciliation (`:22-26`, 4 jam). Hanya Sheets (`:37`) dan Media Cleanup (`:48`) yang menjalankan sekali saat boot.
  - `worker.ts` tidak membaca `last_success_at` dari DB; setelah `startBackgroundCrons()` (`:117`), proses hanya menunggu tick pertama.
  - `#310` mencatat deploy me-recreate `app` dan `worker`; setiap recreate memulai ulang timer dari nol.
- **Akar masalah:** state jadwal hidup di RAM proses. Interval adalah "waktu sejak boot", bukan "waktu sejak keberhasilan terakhir". Tidak ada konsep `next_run_at` atau catch-up.
- **FMEA:** S=7 (PII tertahan melewati retensi, arsip/DB membengkak, hold kedaluwarsa menahan slot, invariant buta), O=6 (deploy/restart lebih sering daripada interval 24 jam), D=8 (tidak ada alert) → **RPN 336**.
- **Collateral damage:** menjalankan semua job saat boot tanpa jitter dapat menyebabkan thundering herd ke DB/Google/LLM; retensi yang tertunda lalu dijalankan sekaligus bisa memicu penghapusan besar dalam satu waktu. Perlu jitter + batas batch + observability.
- **Rekomendasi fondasional:**
  1. Ganti `setInterval` dengan **scheduler tick 60 detik** yang membaca `next_run_at`/`last_success_at` dari `CronRunLog` (K-001).
  2. Saat boot, hitung `due = next_run_at <= now`; jalankan **satu kali** dengan jitter 0–30 detik, lalu update `next_run_at`.
  3. Untuk job idempoten (media, retention, invariant, archive purge, label, AI eval, chat export) izinkan catch-up; untuk job yang punya efek eksternal (follow-up, shareloc, nightly) gunakan lease + idempotency key agar catch-up tidak menggandakan pesan.
  4. Simpan konfigurasi jadwal per tenant di `Tenant.settings.cron` (JSON) dengan default kode, bukan env global; env tetap sebagai fallback.
- **Verifikasi:** fake clock: set `last_success_at=25 jam lalu`, boot → job berjalan tepat sekali; dua boot berturut-turut → tetap sekali; test `cron-catchup.test.ts`; test downtime 7 hari untuk weekly backup.

---

### K-003 — Backup mingguan bukan dump DB penuh, bisa "sukses palsu", dan tidak terenkripsi

- **Severity:** KRITIS · **RPN 648** · **Keyakinan: TERBUKTI (desain) / KEMUNGKINAN BESAR (runtime `pg_dump` tidak ada)**
- **Lokasi:** `Dockerfile:36-40`, `src/services/backup.service.ts:52-82`, `:87-148`, `:283-317`; `src/services/cron.service.ts:654-668`; `src/lifecycle/background-crons.ts:311-314`; `src/integrations/google-drive/client.ts:55-70`, `:116-137`, `:178-179`; `docs/FEATURE_INVENTORY.md:221`.
- **Bukti:**
  1. Image runner hanya memasang `openssl`, `ca-certificates`, font — **tidak ada `postgresql-client`**:
     ```dockerfile
     # Dockerfile:37-40
     RUN apt-get update -y \
       && apt-get install -y --no-install-recommends openssl ca-certificates fonts-dejavu-core fontconfig \
       && fc-cache -f \
       && rm -rf /var/lib/apt/lists/*
     ```
     `isPgDumpAvailable()` menjalankan `pg_dump --version` (`backup.service.ts:40-46`); di image ini hasilnya gagal, sehingga `createDatabaseDump()` selalu masuk cabang `createProgrammaticDump()` (`:69-71`).
  2. Dump programatik hanya memuat **12 tabel** dan setiap query menelan error:
     ```ts
     // backup.service.ts:112-125
     prisma.customer.findMany().catch(() => []),
     prisma.child.findMany().catch(() => []),
     prisma.reservation.findMany().catch(() => []),
     prisma.reservationArchive.findMany().catch(() => []),
     prisma.clinicService.findMany().catch(() => []),
     prisma.deliveryTier.findMany().catch(() => []),
     prisma.staff.findMany().catch(() => []),
     prisma.tenantPersona.findMany().catch(() => []),
     prisma.tenantAiConfig.findMany().catch(() => []),
     prisma.knowledgeChunk.findMany().catch(() => []),
     prisma.conversation.findMany().catch(() => []),
     prisma.message.findMany().catch(() => []),
     ```
     Tidak ada `Tenant`, `FollowUp`, `CustomerAddress`, `ReservationItem`, `StaffSession`, `RetentionPolicy`, `SheetsSyncConfig`, `RoleApiScope`, `AdClick`, `AdminNotificationLog`, dan tabel operasional lain.
  3. Tetap dicatat sukses hanya karena file ada:
     ```ts
     // backup.service.ts:74-81
     const stat = fs.statSync(filePath);
     console.log(`[BackupService] Backup created successfully: ${fileName} (${stat.size} bytes)`);
     return { filePath, fileName, sizeBytes: stat.size };
     ```
  4. Restore hanya mendukung JSON internal (`backup.service.ts:311-317`) dan hanya memulihkan tabel yang sama; Completeness Guard hanya membandingkan `reservations` dan `customers` (`:330-337`), sehingga backup yang kehilangan follow-up/alamat/item tetap lolos.
  5. Tidak ada enkripsi: tidak ada import `crypto`/`createCipher` di `backup.service.ts`, `google-drive/client.ts`, atau `backup-file.ts`; upload memakai `fs.createReadStream(filePath)` mentah (`client.ts:55-70`). `FEATURE_INVENTORY.md:221` justru mengklaim "pengunggahan terenkripsi".
  6. Setelah upload, backup lama dipangkas menjadi 8 file (`client.ts:116-137`, dipanggil `backup.service.ts:178-179`). Bila file baru parsial, file baik lama tetap bisa terhapus.
  7. Dump memuat seluruh `messages`/`conversations` ke memori tanpa paginasi (`backup.service.ts:113-124`) lalu `JSON.stringify` seluruh objek (`:145-147`); dengan batas worker 512 MB (`docker-compose.yml:89`), backup database besar berisiko OOM dan mati di tengah proses.
- **Akar masalah:** fallback programatik diperlakukan setara dengan dump penuh; kontrak "backup berhasil" hanya berarti "file ada", bukan "semua tabel/row tervalidasi". Tidak ada manifest tabel, checksum, atau verifikasi restore. Tidak ada enkripsi di jalur upload.
- **FMEA:** S=9 (restore kehilangan follow-up/alamat/item/tenant → kehilangan data massal), O=8 (selalu fallback di image produksi), D=9 (log sukses, tidak ada alert) → **RPN 648**.
- **Collateral damage:** menambah `postgresql-client` tanpa mengubah kode akan mengaktifkan jalur `pg_dump | gzip` yang **menutupi exit code `pg_dump`** (pipeline mengambil status `gzip`); `restoreDatabaseFromDump` juga menolak SQL mentah. Jadi perbaikan harus menyeluruh, bukan hanya menambah paket.
- **Rekomendasi fondasional:**
  1. Pilih satu kontrak: **full database backup** (`pg_dump -Fc` ke file, tanpa pipe; verifikasi `pg_restore --list`) atau **programmatic backup** yang benar-benar lengkap dengan manifest `table -> count` untuk semua model yang dibutuhkan restore.
  2. Jangan pakai `.catch(() => [])`; kegagalan satu tabel = job `FAILED`, jangan upload.
  3. Hitung checksum + row count per tabel; simpan manifest di sidecar/DB; verifikasi file sebelum upload.
  4. Enkripsi AES-256-GCM dengan `BACKUP_ENCRYPTION_KEY` (modul `crypto` bawaan), simpan nonce+tag; dokumentasikan escrow key.
  5. Pangkas backup lama hanya setelah backup baru lolos verifikasi; simpan minimal 2 generasi.
  6. Pertahankan per-tenant: tabel backup menyimpan `tenant_id`; upload per tenant atau folder terpisah; jangan mencampur data tenant di satu file tanpa kontrol akses.
- **Verifikasi:** simulasikan satu `findMany` gagal → job harus `FAILED` dan tidak upload; uji restore ke DB kosong dan bandingkan count semua tabel; uji dekripsi; uji dua worker → satu upload; uji `pg_dump` gagal → tidak ada file "sukses".

---

### K-004 — Sheets outbox tidak punya atomic claim; retry/overlap menggandakan baris keuangan

- **Severity:** KRITIS · **RPN 252** · **Keyakinan: TERBUKTI**
- **Lokasi:** `src/services/sheets/sheets-sync.service.ts:171-221`, `:511-543`, `:317-322`; `src/lifecycle/background-crons.ts:37-38`; `prisma/schema.prisma:1282-1297`.
- **Bukti:**
  - `listPending()` mengambil `pending` **dan** `processing`, tetapi tidak ada penulisan `processing` di seluruh `src/` (hanya komentar schema `:1287`):
    ```ts
    // sheets-sync.service.ts:531-543
    const rows = await prisma.sheetsSyncOutbox.findMany({
      where: {
        tenant_id: tenantId,
        OR: [{ status: 'pending' }, { status: 'processing' }],
        AND: [{ OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }] }],
      },
      orderBy: { created_at: 'asc' },
      take: limit,
      select: { id: true, tenant_id: true, reservation_id: true, attempts: true },
    });
    ```
  - Alur `processOutbox` = baca → `syncReservation` → `markDone` (`:181-186`); tidak ada `updateMany` untuk mengklaim.
  - `syncReservation` menulis ke Google lalu menyimpan referensi baris:
    ```ts
    // sheets-sync.service.ts:317-322
    const appended = await this.gateway.appendRow({ tenantId, spreadsheetId, tabName: tab.tabName, row });
    await this.store.saveRowRef(reservationId, tenantId, {
      spreadsheetId, tabName: tab.tabName, rowIndex: appended.rowIndex,
    });
    ```
    Bila `appendRow` sukses dan `saveRowRef` gagal (DB timeout), retry berikutnya melihat `sheets_row_index` masih null → **append lagi**.
  - Boot-run dan run terjadwal dapat tumpang tindih:
    ```ts
    // background-crons.ts:37-38
    cron.runSheetsSyncWorker().catch(...);            // boot, tidak di-await
    trackIntervalStaggered(() => cron.runSheetsSyncWorker(), ...); // 0-30 dtk kemudian
    ```
- **Akar masalah:** outbox state machine tidak lengkap. `status=processing` ada di schema tetapi tidak pernah menjadi transisi; tidak ada lease, tidak ada idempotency key per baris sheet. Unique `(tenant_id, reservation_id)` hanya mencegah dua baris outbox, bukan dua baris spreadsheet.
- **FMEA:** S=9 (baris omzet/rekap ganda → laporan keuangan salah), O=4 (kegagalan DB setelah append, atau dua runner/overlap 3 menit), D=7 (baris ganda terlihat sah) → **RPN 252**.
- **Collateral damage:** claim yang salah bisa membuat baris `processing` macet; perlu `lease_until` + reclaim. Idempotensi append tanpa kolom identitas di sheet bisa memerlukan kolom tersembunyi/penanda; jangan mengandalkan pencocokan nama customer.
- **Rekomendasi fondasional:**
  1. Tambah `claimed_at`/`lease_until` (atau gunakan `updated_at` + status) ke `SheetsSyncOutbox`.
  2. Klaim atomik:
     ```ts
     const claimed = await prisma.sheetsSyncOutbox.updateMany({
       where: { id, status: { in: ['pending'] }, OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }] },
       data: { status: 'processing', claimed_at: now, lease_until: addMinutes(now, 5) },
     });
     if (claimed.count === 0) continue;
     ```
     Reclaim baris `processing` yang `lease_until < now`.
  3. Idempotensi append: cek `sheets_row_index` + kunci unik reservasi di sheet (kolom tersembunyi) atau `updateCells` bila baris sudah ada; jangan append buta.
  4. Hapus boot-run ganda; biarkan scheduler (K-001/K-002) yang menentukan due.
- **Verifikasi:** dua `processOutbox` paralel → satu baris diproses; simulasi crash setelah `appendRow` → retry meng-update baris yang sama; test `sheets-outbox-claim.test.ts`; cek jumlah baris sheet sebelum/sesudah retry.

---

### K-005 — Kegagalan cron tidak pernah menjadi alert/status; "hijau" hanya berarti proses hidup

- **Severity:** KRITIS · **RPN 270** · **Keyakinan: TERBUKTI**
- **Lokasi:** `src/services/cron.service.ts:149-151`, `:556-559`, `:665-667`; `src/lifecycle/background-crons.ts:28, 40, 51, 61, 79, 89, 99, 108, 148, 158, 223, 239, 249, 276, 282, 316`; `src/services/daily-invariant-monitor.service.ts:84-86`, `:203-217`.
- **Bukti:**
  - Archive purge menelan error dan mengembalikan 0:
    ```ts
    // cron.service.ts:556-559
    } catch (err: any) {
      console.error('[Cron Service] Error running reservation archive purge:', err?.message);
      return 0;
    }
    ```
  - Sheets worker hanya `console.warn` saat tenant gagal (`:141-146`), bukan alert.
  - Backup hanya `console.error` (`:665-667`); nightly/daily report juga hanya log (`background-crons.ts:222-224`, `:275-277`).
  - Import service yang gagal saat registrasi hanya `console.error` (`background-crons.ts:28, 40, 51, ...`); cron tidak pernah terdaftar, tetapi proses tetap sehat.
  - Satu-satunya jalur alert adalah invariant monitor saat ada **violation**, bukan saat query gagal (`daily-invariant-monitor.service.ts:84-86` vs `:211-216`).
- **Akar masalah:** tidak ada kontrak status run (`RUNNING/SUCCESS/FAILED/SKIPPED`), tidak ada penghitung kegagalan beruntun, dan tidak ada heartbeat. Log konsol bukan sinyal operasional yang bisa memicu tindakan.
- **FMEA:** S=6 (data/rekap/backup tertunda tanpa diketahui), O=5 (Google auth expired, DB timeout, migration drift seperti `#298`), D=9 (tidak ada alert) → **RPN 270**.
- **Collateral damage:** alert per kegagalan bisa spam saat DB down; perlu agregasi per job + ambang 2–3 kegagalan + dedupe via `AdminNotificationLog`.
- **Rekomendasi fondasional:**
  1. Setiap job menulis `CronRunLog` (K-001) dengan `status`, `duration_ms`, `rows_affected`, `error_code`.
  2. Alert bila: (a) 2 kegagalan beruntun, (b) tidak ada `SUCCESS` lebih dari 2× interval, (c) job selesai 0 padahal biasanya >0 (anomali volume).
  3. Tampilkan status cron di endpoint admin yang sudah ada (`GET /api/admin/health` atau `/ready`), bukan halaman baru.
  4. Bedakan `SKIPPED` (flag off/tenant off), `DEFERRED` (dependency belum siap), `FAILED` (error) agar operator tidak salah membaca.
- **Verifikasi:** fault injection per job (DB mati, Google 401, file hilang) → alert muncul sekali; test `cron-alerting.test.ts`; dashboard/health menampilkan `last_success_at`.

---

### K-006 — Chat export memakai batas hari UTC tetapi nama file WIB; data 00:00–06:59 WIB tidak pernah masuk

- **Severity:** TINGGI · **RPN 240** · **Keyakinan: TERBUKTI**
- **Lokasi:** `src/services/chat-export.service.ts:80-94`, `:203-219`, `:440-445`; `src/services/cron.service.ts:230-245`; `src/lifecycle/background-crons.ts:243-250`.
- **Bukti:**
  ```ts
  // chat-export.service.ts:80-85 — nama file memakai tanggal lokal (WIB di container)
  export function formatLocalDate(value: Date = new Date()): string {
    const y = value.getFullYear(); ...
  }
  // chat-export.service.ts:88-93 — rentang data memakai UTC
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  ```
  `2026-11-07T00:00:00Z` = **07:00 WIB 7 Nov**, jadi file `daily-chats-2026-11-07.md` memuat 07:00 WIB 7 Nov–06:59 WIB 8 Nov, bukan 00:00–23:59 WIB 7 Nov.
  Cron hanya mengekspor "hari ini" (`cron.service.ts:233-234`), setiap 6 jam (`background-crons.ts:244-247`), dan hanya `DEFAULT_TENANT_ID` (`cron.service.ts:234`). Bila run terakhir 18:00, pesan 18:00–23:59 juga tidak pernah masuk file hari itu karena run berikutnya sudah mengganti tanggal.
- **Akar masalah:** dua definisi "hari" yang berbeda (lokal untuk nama file, UTC untuk query) dan ekspor inkremental yang tidak punya watermark/finalisasi. Tidak ada job "tutup buku" setelah tengah malam.
- **FMEA:** S=4 (dataset analitik/forensik tidak lengkap; data asli tetap di DB), O=10 (terjadi setiap hari), D=6 (file ada, terlihat wajar) → **RPN 240**.
- **Collateral damage:** memperbaiki batas WIB tanpa backfill akan membuat file lama dan baru tidak konsisten; perlu penanda versi/backfill. Mengekspor semua tenant setiap 6 jam bisa membebani DB; perlu batching.
- **Rekomendasi fondasional:**
  1. Satu helper `wibDayRange(date)` yang menghasilkan `[00:00 WIB, 23:59:59.999 WIB]` memakai offset tetap +7 (tanpa dependency baru).
  2. Jadwal: 00:15 WIB ekspor **final kemarin** (sekali, idempotent by date), lalu 6 jam sekali ekspor **hari ini** untuk pembaruan.
  3. Simpan `last_exported_message_at`/watermark per tenant; regenerate file bila ada pesan terlambat.
  4. Loop semua tenant (`getAllTenantIds()`), bukan `DEFAULT_TENANT_ID`.
- **Verifikasi:** fake clock 00:05 WIB → file kemarin lengkap 00:00–23:59 WIB; pesan 23:59:59 masuk; dua run tidak menduplikasi; tenant B punya file; test `chat-export-wib.test.ts`.

---

### K-007 — Nightly/morning/trip memakai state RAM; WA nightly tanpa idempotency per nomor

- **Severity:** SEDANG · **RPN 168** · **Keyakinan: TERBUKTI (state RAM) / KEMUNGKINAN BESAR (dobel/hilang saat restart)**
- **Lokasi:** `src/lifecycle/background-crons.ts:166`, `:182-183`, `:207-219`, `:296-314`; `src/services/cron.service.ts:20-49`, `:69-97`; `src/services/staff-trip-tracking.service.ts:408`, `:487-499`; `docker-compose.yml` (restart policy).
- **Bukti:**
  - Nightly menyimpan tanggal terakhir di `Map` RAM dan menandainya **sebelum** generate:
    ```ts
    // background-crons.ts:182-185
    if (lastNightlyRunDate.get(tId) === todayStr) continue;
    lastNightlyRunDate.set(tId, todayStr);
    const data = await nightlyWatchdogService.generate(tId);
    ```
    Restart setelah 21:00 → `Map` kosong → kirim ulang. Telegram punya `idempotencyKey` (`:202`), tetapi jalur WhatsApp tidak (`:207-219`).
  - Morning jobs membuat klaim DB sebelum pekerjaan (`cron.service.ts:20-24`), lalu hanya melepas klaim pada `catch` tertentu (`:45-49`). Crash setelah klaim = job **tidak dijalankan ulang hari itu** (at-most-once). Langkah awal (`enqueueDormantWinbackFollowUps`, `reconcileOrphanedCompletedFollowUps`) juga hanya `console.warn` bila gagal (`:28-39`) tanpa melepas klaim.
  - `staffTripTrackingService` menyimpan trip di `Map` (`staff-trip-tracking.service.ts:408`); `runTripAutoCloseSweep` membaca `listActiveTrips()` (`cron.service.ts:600`). Restart worker = daftar trip kosong; auto-close tidak menutup trip yang tertinggal.
- **Akar masalah:** penjadwalan dan status operasional disimpan di memori proses, bukan di DB/Redis. Untuk notifikasi, idempotency hanya tersedia di jalur Telegram; `#144` sudah mencatat keterbatasan WA multi-nomor.
- **FMEA:** S=6 (laporan malam dobel/spam; briefing pagi & winback hilang), O=4 (restart/deploy), D=7 (log "disabled"/"sudah jalan" tidak membedakan crash) → **RPN 168**.
- **Collateral damage:** memindahkan semua state ke DB menambah query; perlu cache singkat. Perbaikan morning menjadi at-least-once harus memastikan setiap sub-langkah idempoten agar tidak mengirim briefing dua kali.
- **Rekomendasi fondasional:**
  1. Ganti `lastNightlyRunDate`/`lastMorningRunDate` dengan `CronRunLog` + lease per tenant/tanggal.
  2. Nightly WA: `idempotencyKey = ${tenant}:NIGHTLY_WATCHDOG:${date}:${recipient}` (komposit; sesuai saran `#144`).
  3. Morning jobs dipecah menjadi sub-job dengan kunci masing-masing (`WINBACK`, `RECONCILE`, `LOST`, `BRIEFING`, `CAPI_ALERT`); klaim per sub-job, bukan satu klaim besar.
  4. Trip: pindahkan `activeTrips` ke Redis/DB (atau rekonstruksi dari `reservation` + `staff_trip` terakhir) agar sweep tetap bekerja setelah restart.
- **Verifikasi:** restart tepat setelah 21:00 → satu pesan per nomor; kill -9 di tengah morning job → sub-job yang belum selesai dijalankan ulang, yang sudah selesai tidak; restart worker → trip auto-close tetap menutup trip lama.

---

### K-008 — Invariant monitor bukan read-only dan gagal secara senyap

- **Severity:** TINGGI · **RPN 192** · **Keyakinan: TERBUKTI**
- **Lokasi:** `src/services/daily-invariant-monitor.service.ts:1-4`, `:84-86`, `:112-201`, `:203-229`.
- **Bukti:**
  - Header menyatakan "READ-ONLY ... NOL mutasi baris" (`:1-4`), tetapi `autoRepairLtvDrift()` menulis `customerService.recalculateCustomerLtv` dan `auditLog` (`:112-194`), lalu dipanggil dari runner (`:218-226`).
  - Error query hanya `console.warn` dan laporan dikembalikan kosong, sehingga "DB offline" terlihat sama dengan "tidak ada pelanggaran":
    ```ts
    // daily-invariant-monitor.service.ts:84-86
    } catch (err: any) {
      console.warn('[INVARIANT MONITOR] DB offline / query gagal:', err?.message);
    }
    ```
  - Alert hanya dikirim bila `violations.length > 0` (`:208-216`); tidak ada alert untuk kegagalan pemeriksaan.
- **Akar masalah:** pencampuran dua tanggung jawab (deteksi vs perbaikan) dalam satu job "monitor"; tidak ada status `FAILED`/heartbeat. Auto-repair defisit LTV dapat menurunkan cache berdasarkan set reservasi yang tidak lengkap (mis. arsip/penghapusan).
- **FMEA:** S=6 (LTV ter-repair salah, monitor buta), O=4 (DB timeout/migrasi), D=8 (tidak ada alert) → **RPN 192**.
- **Collateral damage:** mematikan auto-repair bisa membuat drift lama bertahan; memisahkannya butuh dashboard/approval agar tidak menjadi pekerjaan manual baru.
- **Rekomendasi fondasional:**
  1. Pisahkan `checkDailyInvariants` (read-only) dan `repairLtvDrift` (mutasi) menjadi dua job/flag; repair default **OFF** atau hanya `PREVIEW`.
  2. Repair hanya boleh jalan bila backup terverifikasi (K-003) dan ada persetujuan admin/tenant; catat before/after di audit.
  3. Alert `MONITOR_FAILED` saat query error; heartbeat di `CronRunLog`.
  4. Perjelas label di kode/dokumentasi: monitor bukan read-only.
- **Verifikasi:** DB offline → alert `MONITOR_FAILED`; repair off → tidak ada perubahan `ltv_cache`; test `invariant-monitor-failure.test.ts`.

---

### K-009 — Pekerja "cleanup sandbox" dan "snapshot retensi/insentif" tidak ada sebagai cron

- **Severity:** TINGGI · **RPN 210** · **Keyakinan: TERBUKTI (absence) / dampak [ASUMSI]**
- **Lokasi:** `src/routes/admin/evaluations.subroute.ts:309-322` (`POST /api/admin/sandbox/cleanup` manual); `src/routes/admin/staff-retention.subroute.ts:126-179` (`POST /api/admin/staff-retention/snapshot` manual); `src/lifecycle/background-crons.ts` (tidak ada registrasi).
- **Bukti:**
  - Sandbox cleanup hanya endpoint manual:
    ```ts
    // evaluations.subroute.ts:311-322
    fastify.post('/api/admin/sandbox/cleanup', async (request, reply) => {
      ...
      .send({ success: true, message: `Successfully cleaned up ${deleted.count} sandbox test records.` });
    });
    ```
    Tidak ada `trackInterval`/`setInterval` di `evaluations.subroute.ts` (pencarian = 0).
  - Snapshot retensi hanya endpoint `POST` manual; tidak ada cron di `staff-retention.subroute.ts` (pencarian `trackInterval|setInterval` = 0).
  - Mandat `qa-test-labeling` mengandalkan `/api/admin/sandbox/cleanup`; tanpa cron, data QA hanya bersih bila admin ingat.
- **Akar masalah:** dua kebutuhan operasional rutin tidak dimasukkan ke registry cron. Untuk insentif, mungkin ada keputusan produk bahwa FINAL harus manual; tetapi **PREVIEW** periodik tetap bisa diotomatiskan tanpa mencabut kontrol manusia.
- **FMEA:** S=5 (data QA mengotori CRM/analitik; snapshot payroll terlewat), O=7 (rutin bulanan/harian bergantung manusia), D=6 (tidak ada reminder) → **RPN 210**.
- **Collateral damage:** cleanup otomatis bisa menghapus data QA yang masih dipakai pengujian; perlu ambang umur (mis. >7 hari) + audit + dry-run count. Snapshot otomatis FINAL bisa mengunci angka sebelum koreksi; jalankan PREVIEW dulu.
- **Rekomendasi fondasional:**
  1. Tambah job `sandbox_cleanup` harian (default ON, tenant-aware): hapus hanya `is_sandbox_test=true` **dan** `created_at < now-7d`, tulis jumlah + audit log.
  2. Tambah job `staff_retention_snapshot_preview` bulanan (tanggal 1, 00:30 WIB, tenant-aware, idempotent per periode). Status `FINAL` tetap manual.
  3. Daftarkan di `background-crons.ts` dan `FEATURE_INVENTORY.md`; jangan buat halaman baru—cukup job + notifikasi/status di panel yang ada.
- **Verifikasi:** buat customer sandbox 8 hari → terhapus; 1 hari → tidak; snapshot bulan berjalan hanya sekali walau restart; test `sandbox-cleanup-cron.test.ts`, `retention-snapshot-cron.test.ts`.

---

### K-010 — Tidak ada drain job in-flight; shutdown 10 detik memotong backup/Sheets/export

- **Severity:** TINGGI · **RPN 196** · **Keyakinan: TERBUKTI (mekanisme) / KEMUNGKINAN BESAR (dampak)**
- **Lokasi:** `src/worker.ts:25-71`, `src/lifecycle/interval-registry.ts:16-32`, `src/lifecycle/background-crons.ts:5-11`, `src/services/cron.service.ts:131-152`, `:230-245`, `:654-668`.
- **Bukti:**
  - `clearAllIntervals()` hanya membersihkan `setInterval`; tidak ada daftar promise yang sedang berjalan (`interval-registry.ts:23-32`).
  - Worker langsung menutup queue dan Prisma setelah clear, lalu `process.exit(0)` (`worker.ts:39-71`); timer paksa 10 detik (`:25`, `:33-37`).
  - Starter `trackIntervalStaggered` memakai `setTimeout` yang tidak didaftarkan:
    ```ts
    // background-crons.ts:5-11
    const jitter = Math.floor(Math.random() * 30_000);
    const starter = setTimeout(() => {
      fn().catch(() => {});
      trackInterval(fn, intervalMs);
    }, jitter);
    ```
    Shutdown dalam 30 detik pertama tetap menembakkan `fn()` setelah `prisma.$disconnect()`.
  - Sheets bisa berjalan >3 menit (10 item × Google API + retry); chat export bisa menulis file besar; backup bisa >10 detik. Tidak ada checkpoint/status `interrupted`.
- **Akar masalah:** shutdown hanya menghentikan **sumber** pekerjaan, bukan **pekerjaan yang sudah berjalan**. Tidak ada job registry dengan state `RUNNING` dan drain timeout per job.
- **FMEA:** S=7 (file backup/export terpotong, outbox setengah jalan, media terhapus sebagian), O=4 (deploy/restart), D=7 (log shutdown terlihat normal) → **RPN 196**.
- **Collateral damage:** menaikkan timeout shutdown memperlambat deploy; perlu batas per job dan checkpoint agar job panjang bisa dilanjutkan, bukan hanya ditunggu.
- **Rekomendasi fondasional:**
  1. Job runner menyimpan promise aktif per `job_key`; `shutdown()` memanggil `drainJobs({timeoutMs})` dan menandai job `INTERRUPTED` bila timeout.
  2. Daftarkan starter `trackIntervalStaggered` ke registry (atau gunakan `timer.unref()` + flag `shuttingDown`).
  3. Untuk backup/Sheets/export, gunakan checkpoint/lease (K-001/K-004) agar job yang terputus dilanjutkan, bukan diulang dari awal atau ditinggalkan.
  4. Jangan `process.exit` sebelum `flushLlmExecutionLogs`/buffer log worker (worker saat ini tidak memanggil flush tersebut; `shutdown.ts:69-83` hanya untuk app).
- **Verifikasi:** job lambat 30 detik + SIGTERM → proses menunggu/menandai interrupted; tidak ada query setelah `$disconnect`; test `worker-shutdown.test.ts`; restart worker → backup/Sheets melanjutkan dari checkpoint.

---

### K-011 — Inisialisasi tenant di worker berhenti pada tenant pertama yang gagal

- **Severity:** SEDANG · **RPN 144** · **Keyakinan: TERBUKTI**
- **Lokasi:** `src/worker.ts:87-114`.
- **Bukti:**
  ```ts
  // worker.ts:104-110
  for (const tid of tenantIds) {
    await loadServicesFromDb(tid);
    await getDeliveryTiersFromDb(tid);
    await loadPersonaFromDb(tid);
    await AiModelConfigService.loadConfigsFromDb(tid);
    await AiEligibilityConfigService.loadConfigsFromDb(tid);
  }
  ```
  Tidak ada `try/catch` per tenant; satu error menghentikan loop. Catch luar hanya `console.warn` (`:112-114`), lalu `startBackgroundCrons()` tetap dipanggil (`:117`). Tenant setelah tenant gagal berjalan dengan cache kosong/fallback.
- **Akar masalah:** inisialisasi dianggap all-or-nothing, padahal datanya per tenant. Tidak ada status readiness per tenant.
- **FMEA:** S=6 (follow-up/AI memakai katalog/persona fallback → info harga/nama salah), O=3 (data tenant korup/DB timeout), D=8 (hanya warning) → **RPN 144**.
- **Collateral damage:** melanjutkan dengan cache kosong bisa lebih berbahaya daripada berhenti; perlu fallback yang jujur (tandai tenant `DEGRADED`, blokir job yang butuh katalog) + alert.
- **Rekomendasi fondasional:** `try/catch` per tenant, kumpulkan `failedTenants`, tulis status ke `CronRunLog`/health, alert; job yang membutuhkan katalog/persona harus men-skip tenant `DEGRADED` (bukan memakai fallback diam-diam). Muat ulang tenant yang gagal pada tick berikutnya.
- **Verifikasi:** dua tenant, tenant A sengaja error → tenant B tetap termuat; status A `DEGRADED`; test `worker-tenant-init.test.ts`.

---

### K-012 — Retensi pesan menghapus file media tanpa cek referensi/proteksi konfigurasi

- **Severity:** SEDANG · **RPN 175** · **Keyakinan: TERBUKTI (jalur kode) / KEMUNGKINAN BESAR (file dipakai ulang)**
- **Lokasi:** `src/services/media.service.ts:1064-1101`; pembanding proteksi di `:878-955`; `#267`.
- **Bukti:**
  ```ts
  // media.service.ts:1074-1092
  for (const m of batch) {
    const media = (m.payload_raw as any)?.media;
    for (const u of [media?.hdUrl, media?.url, media?.thumbUrl]) {
      if (typeof u === 'string' && u.startsWith('/media/')) {
        if (this.deleteFile(u)) mediaFiles++;
      }
    }
  }
  ...
  const res = await prisma.message.deleteMany({ where: { tenant_id: tenantId, created_at: { lt: cutoff } } });
  ```
  Tidak ada pengecekan apakah URL yang sama masih dirujuk pesan yang lebih baru, dan tidak ada pengecualian `pricelist_image_url`/`qrisImageUrl`/aset brand. `deleteExpiredMedia` punya pengecualian pricelist (`:918-919`), tetapi jalur retensi pesan tidak.
- **Akar masalah:** file dianggap milik satu pesan, padahal URL bisa dipakai ulang (kirim ulang media, template, QRIS/pricelist) dan bisa menjadi konfigurasi tenant. Penghapusan file dilakukan **sebelum** delete DB; bila delete DB gagal, pesan lama tetap ada tetapi medianya sudah hilang.
- **FMEA:** S=5 (gambar di chat baru/konfigurasi 404; riwayat rusak), O=5 (media lama pasti ada; URL bersama mungkin), D=7 (baru terlihat saat dibuka) → **RPN 175**.
- **Collateral damage:** reference counting bisa menahan file lebih lama (disk); perlu kompromi: cek referensi di DB + whitelist aset, bukan menahan semua.
- **Rekomendasi fondasional:**
  1. Sebelum `deleteFile`, cek `message.count({ where: { tenant_id, created_at >= cutoff, payload_raw: { path: ... } } })` atau tabel referensi media; hapus hanya bila 0.
  2. Whitelist aset tenant: `pricelist_image_url`, `settings.paymentInfo.qrisImageUrl`, `brand.logoUrl` (terkait `#267`).
  3. Urutkan: tandai pesan → hapus DB → baru hapus file yatim; atau gunakan tabel `MediaAsset` dengan `ref_count`.
  4. Jalankan dalam batch + dry-run count sebelum delete; audit jumlah.
- **Verifikasi:** URL yang sama di pesan lama & baru → tidak terhapus; QRIS/pricelist → tidak terhapus; delete DB gagal → file tidak dihapus; test `media-retention-reference.test.ts`.

---

### K-013 — Dokumentasi/inventaris cron drift: 21 vs 22, dan klaim atomic claim yang tidak ada

- **Severity:** RENDAH · **RPN 80** · **Keyakinan: TERBUKTI**
- **Lokasi:** `docs/FEATURE_INVENTORY.md:197`, `:201-221`, `:267`; `docs/audit/2026-11-02/fase-08/LAPORAN_FASE_08.md:20`; `prisma/schema.prisma:1282-1297`.
- **Bukti:**
  - `FEATURE_INVENTORY.md:197` menulis "21 background worker"; tabel `:201-221` tidak memuat Ad Watchdog, padahal kode `:323-345` mendaftarkannya dan `#317` menyatakan aktif.
  - Laporan Fase 08 menyatakan Sheets punya "`outbox.claimed_at` + atomic claim" (`LAPORAN_FASE_08.md:20`), tetapi schema tidak punya `claimed_at` dan kode tidak pernah menulis `processing` (lihat K-004).
- **Akar masalah:** inventaris ditulis manual, tidak digenerate dari registry; audit lama mengklaim mekanisme yang tidak diverifikasi ke schema.
- **FMEA:** S=2 (keputusan operasional salah), O=8 (dokumen sering dibaca sebagai sumber kebenaran), D=5 (tidak ada CI yang membandingkan) → **RPN 80**.
- **Rekomendasi:** perbarui `FEATURE_INVENTORY.md` menjadi 22 + Ad Watchdog; tambahkan tabel "flag/default/bukti run" yang digenerate dari registry; jadikan pemeriksaan dokumentasi bagian dari regression gate.
- **Verifikasi:** `rg` jumlah `trackInterval` = jumlah baris tabel; review doc di PR.

---

## 6. FMEA Ringkas (urut RPN)

| ID | Failure mode | S | O | D | RPN | Severity |
|---|---|---:|---:|---:|---:|---|
| **K-003** | Backup parsial/tanpa enkripsi dianggap sukses → restore kehilangan data massal | 9 | 8 | 9 | **648** | KRITIS |
| **K-002** | Cron 6/24 jam tidak pernah jalan karena restart < interval | 7 | 6 | 8 | **336** | KRITIS |
| **K-005** | Kegagalan cron hanya log → outage senyap | 6 | 5 | 9 | **270** | KRITIS |
| **K-004** | Sheets outbox tanpa claim → baris keuangan ganda | 9 | 4 | 7 | **252** | KRITIS |
| **K-001** | Dua runner / split-brain tanpa lock & heartbeat | 9 | 3 | 9 | **243** | TINGGI |
| **K-006** | Export chat salah batas hari + hanya hari ini → dataset bolong | 4 | 10 | 6 | **240** | TINGGI |
| **K-009** | Cleanup sandbox & snapshot retensi tidak terjadwal | 5 | 7 | 6 | **210** | TINGGI |
| **K-010** | Shutdown memotong job in-flight | 7 | 4 | 7 | **196** | TINGGI |
| **K-008** | Invariant monitor bukan read-only & fail-open | 6 | 4 | 8 | **192** | TINGGI |
| **K-012** | Retensi menghapus media yang masih dipakai/proteksi config | 5 | 5 | 7 | **175** | SEDANG |
| **K-007** | Nightly/morning/trip state RAM → dobel/hilang | 6 | 4 | 7 | **168** | SEDANG |
| **K-011** | Init tenant worker berhenti di tenant pertama gagal | 6 | 3 | 8 | **144** | SEDANG |
| **K-013** | Dokumentasi/inventaris cron drift | 2 | 8 | 5 | **80** | RENDAH |

**Distribusi:** 4 KRITIS, 5 TINGGI, 3 SEDANG, 1 RENDAH.

---

## 7. Rencana Perbaikan Berurutan

> Prinsip: perbaiki **kontrak eksekusi** lebih dulu (ledger/lease), baru isi per pekerja. Jangan menambah larangan teks atau tambalan per kasus. Semua solusi memakai Postgres/Prisma/`crypto` yang sudah ada; tanpa dependency baru. Setiap fase ditutup gerbang regresi.

### Fase 0 — Instrumentasi & guard (tanpa perubahan perilaku)
- Tambah model/migrasi `CronRunLog` + `CronJobLease`:
  - `job_key`, `tenant_id` (nullable), `scheduled_for`, `started_at`, `finished_at`, `status` (`RUNNING/SUCCESS/FAILED/SKIPPED/INTERRUPTED`), `heartbeat_at`, `locked_until`, `last_error`, `metrics JSON`.
  - Unique `(job_key, tenant_id, scheduled_for)`; index `(job_key, status, heartbeat_at)`.
- Bungkus semua registrasi dengan `runTracked(jobKey, fn)`; tulis start/success/failure + durasi + jumlah baris.
- Tambah status cron ke `GET /api/admin/health` (panel yang sudah ada, bukan halaman baru) dan alert Telegram setelah 2 kegagalan beruntun / heartbeat stale.
- **Acceptance:** 22 job menghasilkan baris run; `npm run build`; unit test wrapper; tidak ada perubahan output bisnis.

### Fase 1 — Single-runner & scheduler persisten
- Worker memegang advisory lock proses; gagal → jangan start cron di production, kirim alert.
- Ganti `setInterval` dengan tick 60 detik yang membaca `next_run_at`/`last_success_at`; catch-up sekali saat overdue; jitter 0–30 detik.
- Pindahkan konfigurasi jadwal per tenant ke `Tenant.settings.cron` (default dari kode; env fallback).
- **Acceptance:** dua worker → satu runner; downtime 25 jam → job due jalan sekali; test fake clock.

### Fase 2 — Sheets outbox state machine
- Migrasi `claimed_at`/`lease_until`; klaim atomik `updateMany`; reclaim lease kedaluwarsa.
- Idempotensi append: cek `sheets_row_index` + identitas reservasi di sheet; update bila ada.
- Hapus boot-run ganda; scheduler yang menentukan due.
- **Acceptance:** dua runner tidak menggandakan baris; crash setelah append → retry update; test konkurensi.

### Fase 3 — Backup integrity & encryption
- Pilih kontrak: pasang `postgresql-client` + `pg_dump -Fc` tanpa pipe (atau dump programatik **lengkap** semua tabel restore).
- Hapus `.catch(() => [])`; gagal satu tabel = `FAILED`, jangan upload.
- Verifikasi manifest count/checksum + `pg_restore --list`; enkripsi AES-256-GCM; simpan key di env dengan dokumentasi escrow.
- Pangkas backup lama hanya setelah verifikasi; minimal 2 generasi.
- **Acceptance:** simulasi tabel gagal → tidak ada upload; restore ke DB kosong lengkap; dekripsi; dua worker satu upload.

### Fase 4 — Notifikasi & state harian
- Nightly: key per recipient (`#144`), lease DB per tenant/tanggal.
- Morning: pecah sub-job + klaim per sub-job; release pada crash via lease expiry.
- Trip: pindahkan state ke Redis/DB atau rekonstruksi dari reservasi.
- Daily report: tulis `PENDING` sebelum kirim, update `SENT/FAILED` setelah; unique key.
- **Acceptance:** restart 21:05 → tidak dobel; kill di tengah morning → sub-job belum selesai dilanjutkan; trip auto-close tetap bekerja.

### Fase 5 — Kelengkapan data & pekerja yang hilang
- Chat export: helper `wibDayRange`, final kemarin 00:15 + inkremental hari ini, semua tenant, watermark.
- Retensi: reference check + whitelist `pricelist_image_url`/`qrisImageUrl`/brand; batch + dry-run + audit.
- Tambah `sandbox_cleanup` harian (>7 hari, `is_sandbox_test`) dan `staff_retention_snapshot_preview` bulanan (FINAL tetap manual).
- **Acceptance:** test batas WIB; media bersama/proteksi tidak terhapus; cron baru muncul di matriks/inventaris.

### Fase 6 — Dokumentasi & regression gate
- Perbarui `FEATURE_INVENTORY.md` (22 + Ad Watchdog), `KNOWN_ISSUES.md` (temuan yang dipilih), `CHANGELOG.md`.
- Gate: `npm run build`; test target per fase; `npm test` + `node scripts/audit-baseline-diff.mjs`; kegagalan yang diklaim pre-existing wajib dibuktikan dengan revert-and-rerun (sesuai mandat).
- **Acceptance:** 0 regresi baru; dokumen = kode.

---

## 8. Batasan & Asumsi

### 8.1 Batasan cakupan (celah yang harus disebut)

1. **Tidak ada akses server live.** Log/jadwal run produksi tidak diperiksa; seluruh klaim "bukti run" di §4 hanya berasal dari repo, log lokal, dan dokumen audit lama.
2. **Log lokal terbatas.** `logs/` hanya berisi file 2026-09/10 dan `app-2026-11-03.log`; tidak ada log worker produksi. Karena itu 16 pekerja tanpa bukti run tidak boleh dianggap mati, tetapi juga tidak boleh dianggap PASS.
3. **Tidak ada DB.** Tidak bisa memeriksa `sheets_sync_outbox`, `admin_notification_logs`, `cron` state, jumlah archive, atau drift.
4. **Tidak ada runtime.** `pg_dump` tidak dijalankan; klaim "tidak tersedia di image" disimpulkan dari `Dockerfile` (tidak ada `postgresql-client`), bukan dari eksekusi container.
5. **Production env tidak dibaca.** `.env` tidak dibuka (rahasia). Default flag diambil dari kode; `#317` dipakai untuk status Ad Watchdog; `#312` menunjukkan beberapa flag lokal mati.
6. **Modul 4 & 6 tidak diaudit ulang.** Hold sweep, follow-up reservation, dan live chat hanya dirujuk; temuan detail ada di `#314`/`#316`.

### 8.2 Asumsi

- `[ASUMSI]` `node:20-slim` tidak menyertakan `pg_dump`; ini konsisten dengan daftar paket Dockerfile, tetapi tidak diuji runtime.
- `[ASUMSI]` Produksi menjalankan satu container `worker` (compose saat ini), sehingga risiko dobel adalah misconfig/scale, bukan kondisi normal.
- `[ASUMSI]` Retensi pesan (120 hari default) dan media (30 hari default) adalah kebijakan yang disengaja; audit tidak mempertanyakan angkanya, hanya mekanisme penerapannya.
- `[ASUMSI]` `staff_retention_snapshot` FINAL memang sengaja manual; rekomendasi hanya mengotomatiskan PREVIEW.
- Semua nomor baris mengacu pada commit `8c6ee2ea` dengan working tree bersih.

### 8.3 Yang tidak dilakukan (patuh mode baca-saja)

- Tidak mengubah kode/test/config/`.env`.
- Tidak menjalankan server, `npm run dev`, migrasi, atau `prisma db push`.
- Tidak memanggil WAHA/Meta/Telegram/Google.
- Tidak menulis DB.
- Tidak melakukan deploy.

---

## 9. Kesimpulan Gate

**Gate Modul 8: PASS DENGAN CATATAN KRITIS — belum layak dinyatakan "sehat".**

Alasan:
- 4 temuan KRITIS menyentuh **integritas backup, duplikasi data keuangan, dan observability**; ini bukan polish.
- Sebagian besar pekerja tidak punya bukti run yang dapat diverifikasi; "terdaftar" tidak sama dengan "berjalan".
- Perbaikan harus dimulai dari **kontrak eksekusi** (ledger/lease/scheduler), bukan dari menambah `try/catch` atau alert per kasus.

**Tiga prioritas eksekusi (berurutan):**
1. **K-003** — hentikan backup parsial/tanpa enkripsi; verifikasi + fail-closed + encryption.
2. **K-001 + K-002** — satu runner ber-lock, scheduler persisten dengan catch-up, heartbeat/alert.
3. **K-004 + K-005** — atomic claim Sheets outbox dan alert kegagalan/zero-run.

Setelah tiga prioritas ini, lanjutkan K-006 (export WIB), K-009 (cron hilang), K-010 (shutdown), K-008 (invariant), K-007/K-011/K-012, lalu K-013 (dokumentasi).

---

*Laporan ini disusun read-only. Tidak ada file selain laporan ini yang dibuat/diubah.*
