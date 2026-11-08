# Laporan Audit Deep-Dive — Modul 2 (WhatsApp Gateway & Ingestion) & Modul 9 (Integrasi Eksternal)

> **Tanggal audit:** 2026-11-07
> **Mode:** AUDIT BACA-SAJA (tidak ada kode/test/config/.env yang diubah; tidak ada server dijalankan; tidak ada DB/WAHA/Meta yang disentuh)
> **Auditor:** Subagent audit (OpenCode)
> **Commit/working tree:** kondisi working tree 2026-11-07 (tanpa commit pin — lihat Batasan)
> **Cakupan:** `src/integrations/whatsapp/**`, `src/routes/webhook.route.ts`, `src/routes/waba-webhook.route.ts`, `src/services/{burst-coalesce,turn-recovery,queue,whatsapp-provider,waha-tenant,waba-tenant,web-push,telegram,google-contacts,google-calendar,backup,notification-delivery,sheet*}.ts`, `src/services/sheets/**`, `src/integrations/{waha,google-contacts,google-drive,google-maps,ors}/**`, `src/lifecycle/{background-crons,interval-registry}.ts`, `src/app.ts`
> **Di luar cakupan:** Modul 4 (Reservasi), Modul 6 (Live Chat), `packages/admin-dashboard`, LLM gateway/routing (Modul 7/8), isi `.env` (nilai rahasia tidak dibaca)

---

## 1. Ringkasan Eksekutif

Lapisan ingress WhatsApp secara fungsional sudah matang (HMAC WABA aktif di produksi, fail-closed tenant, dedupe DB, outbox Sheets, circuit breaker geocoding), tetapi **belum tahan crash/restart dan belum benar-benar multi-tenant di jalur ingress**. Ditemukan **22 temuan**: 1 KRITIS, 9 TINGGI, 10 SEDANG, 2 RENDAH.

Tiga risiko terbesar:
1. **I-001 (RPN 560)** — backup mingguan berisi **seluruh database tanpa enkripsi** diunggah ke Google Drive satu tenant; klaim "terenkripsi" pada laporan audit 2026-11-02 **tidak benar**.
2. **W-001 (RPN 405)** — turn yang macet setelah proses hidup **tidak pernah di-replay** (recovery hanya saat boot + filter umur 2 menit), sehingga pesan pelanggan bisa berhenti tanpa balasan tanpa alarm.
3. **W-002 (RPN 360)** — `setLabelFlags` dipanggil tanpa `tenantId` di jalur webhook → flag admin/hold selalu ditulis ke `default-tenant`; di multi-tenant ini mematikan gate bypass dan mencemari cache per nomor.

Pola sistemik: **"best-effort" dipakai untuk hal yang seharusnya durable** (replay turn, outbox Sheets, retry integrasi, ledger outbound) dan **state kritis disimpan di memori proses** (cache cut-off, buffer burst, VAPID, dedupe) tanpa invalidasi lintas proses.

---

## 2. Framework & Cakupan

### 2.1 Framework

| Kerangka | Alasan | Dipakai untuk |
|---|---|---|
| **AWS Well-Architected** (Reliability, Security, Operational Excellence) | Modul 2/9 adalah jalur produksi bernilai tinggi: kehilangan pesan, duplikasi massal, kebocoran PII, dan kegagalan integrasi berdampak langsung ke layanan klinik | Klasifikasi temuan, desain rekomendasi (outbox, retry, observability) |
| **STRIDE** | `POST /webhook` dan `GET / POST /api/webhook/waba` adalah permukaan publik tanpa sesi pengguna | Spoofing, Tampering, Repudiation, Information disclosure, DoS, Elevation |
| **Hypothesis-driven + 5 Whys** | Klaim laporan lama (fase-02/fase-09) harus diuji ulang terhadap kode, bukan dipercaya | Verifikasi klaim, akar masalah |

### 2.2 Metode & urutan tahap

- **Tahap 0** — framework dipilih (di atas).
- **Tahap 1** — `docs/KNOWN_ISSUES.md` dibaca; status #298/#299/#300/#312–#319 diverifikasi ulang; temuan lama tidak diduplikasi (lihat §3).
- **Tahap 2** — inventaris objek + skor prioritas (Tabel 2.3).
- **Tahap 3** — audit horizontal: pola driver/route/integrasi dibandingkan satu sama lain (mis. WAHA punya retry, Telegram tidak; WAHA punya ledger, Sheets tidak punya claim).
- **Tahap 4** — audit vertikal: **webhook masuk → tenant resolve → dedupe → media → scope/bypass → burst coalesce → turn persist → queue → state machine → outbound → status/ACK**, lalu **integrasi: trigger → outbox/retry → API eksternal → verifikasi status**.
- **Tahap 5** — FMEA per temuan + collateral damage + urutan perbaikan.
- **Tahap 6** — verifikasi per rekomendasi (test/query/metrik) — dirancang, **belum dieksekusi** karena mode baca-saja.

### 2.3 Inventaris & prioritas awal

| # | Area | Titik masuk/keluar data | Prioritas |
|---|---|---|---|
| 2.1 | WAHA ingress (`POST /webhook`) | WAHA → Fastify → customer/conversation/message → queue | **Kritis** |
| 2.2 | WABA ingress (`GET / POST /api/webhook/waba`) | Meta → HMAC → normalizer → queue | **Kritis** |
| 2.3 | Gateway abstraction & driver | service → `resolveGatewayForTenant` → WAHA/WABA | Tinggi |
| 2.4 | Dedupe / idempotensi / turn ledger | `InboundTurn`, `OutboundAttempt`, `wa_message_id` | **Kritis** |
| 2.5 | Burst coalescing & humanizer | buffer memori → 1 job → bubble splitter | Tinggi |
| 2.6 | Queue & retry | BullMQ 5 shard + fallback memori | **Kritis** |
| 2.7 | Media inbound/outbound | WAHA file store / Meta lookaside → `storage/media/<tenant>` | Tinggi |
| 9.1 | Google Contacts (People API) | customer → People API; People → customer | Sedang |
| 9.2 | Google Sheets (rekapan) + outbox | reservation completed → outbox → Sheets | Tinggi |
| 9.3 | Google Drive backup | `pg_dump`/JSON → Drive | **Kritis** |
| 9.4 | Telegram (alert/report/webhook) | alert/report → Bot API | Tinggi |
| 9.5 | Web Push VAPID | admin/staff browser → push service | Sedang |
| 9.6 | ORS / Google Maps / geocoding | delivery service → API → Haversine | Sedang |
| 9.7 | Google Calendar | reservasi → Calendar API | Sedang |

### 2.4 Celah cakupan (dinyatakan eksplisit)

1. **Tidak ada akses live** ke WAHA, Meta, Google, Telegram, maupun Web Push. Semua kesimpulan berasal dari kode + dokumen.
2. **Log produksi tidak diperiksa** (`logs/*.jsonl`, log container, `docker logs`). Tidak ada bukti empiris frekuensi kejadian di produksi.
3. **DB produksi tidak dibaca** (tidak ada query), sehingga dampak data nyata (mis. jumlah pesan tanpa balasan) tidak diukur.
4. **Test suite tidak dijalankan** pada audit ini (menghindari beban & efek samping); status hijau/merah mengacu pada artefak laporan lama, bukan eksekusi baru.
5. **`docker-compose.override.yml` tidak dianalisis penuh**; `NODE_ENV=production` terverifikasi di `docker-compose.yml:36,88`.
6. **Tidak mengaudit** Modul 4/6, LLM gateway, dashboard admin, dan skema migrasi Prisma.

---

## 3. Status Temuan Lama

### 3.1 `docs/KNOWN_ISSUES.md`

| ID | Temuan | Status di KNOWN_ISSUES | Hasil verifikasi audit ini |
|---|---|---|---|
| **#316 (K-03/K-03b)** | Isolasi tenant live chat, media, gateway, typing | SELESAI (kode) | **SEBAGIAN BENAR**: `factory.ts` per-tenant & `typingService.setTransportResolver` ada (`factory.ts:96-118`, `app.ts:194-211`), **tetapi jalur webhook masih memakai `wahaClient` global** → lihat **W-003**. Klaim "selesai" tidak mencakup ingress. |
| **#297** | Humanizer WPM 500, komentar `BURST_COALESCE` vs kode | OPEN | **MASIH TERBUKA**. Kode `burst-coalesce.service.ts:24` masih menyatakan default nonaktif, sedangkan `:69` default `7500`. Tidak diduplikasi; hanya dirujuk. |
| **#271** | Gambar inbound WABA tidak memanggil `attachFromInbound` | OPEN (ditunda) | **MASIH TERBUKA** — diverifikasi: `waba-webhook.route.ts:186-206` hanya `saveInboundMedia`, tidak ada hook payment-proof. Tidak diduplikasi. |
| **#103 (CG-01)** | Karantina event provider tak dikenal | DITUNDA | **MASIH TERBUKA** — `webhook.route.ts:112-115` mengembalikan 200 tanpa menyimpan payload; komentar `waha-tenant.service.ts:16-18` menyebut infrastruktur karantina belum ada. Tidak diduplikasi. |
| **#144** | `idempotency_key` notifikasi nullable / tidak per-nomor | OPEN | **MASIH TERBUKA** dan menjadi salah satu akar **I-009**. |
| **#299** | Integritas audit: klaim PASS tanpa gate | RESOLVED | **INSTANCE BARU**: laporan `fase-09` mengklaim "Cadangan … **terenkripsi**" (`LAPORAN_FASE_09.md:22`) dan mencantumkan 4 path test yang **tidak ada** (`google-drive-backup`, `distance-matrix`, `web-push`, `llm-gateway`). Gate kanonis (`scripts/audit-phase-gates.mjs:87-97`) memang memakai file riil, tetapi **tidak memuat backup/Drive sama sekali** → klaim enkripsi tidak pernah diuji. Lihat **I-001**. |
| **#298/#300/#312–#319** | Migrasi, DELETE reservasi, alamat, live chat, ad watchdog | SELESAI/OPEN sesuai catatan | Tidak relevan langsung; tidak diubah dan tidak dijadikan temuan. |
| **#230c** | Arsip media bergantung unduhan WAHA (file 180 dtk) | Limitasi diterima | **MASIH RELEVAN** sebagai batasan (bukan temuan baru). |

### 3.2 Klaim `docs/audit/2026-11-02/fase-02` (WhatsApp Gateway)

| Item | Klaim lama | Verifikasi | Status |
|---|---|---|---|
| 2.1 | "0 pemanggilan `WahaClient` langsung dari rute domain" | **SALAH untuk jalur ingress**: `webhook.route.ts:8` mengimpor `wahaClient` dan memakainya di ≥9 titik (`:336, :605, :611, :738, :770, :804-810, :966, :1062, :1148, :1419`) | **TIDAK AKURAT** |
| 2.2 | Webhook HMAC valid, stale guard | **BENAR**: `rawBody` disimpan (`app.ts:107-126`), `verifyMetaSignature` fail-closed di produksi (`signature.ts:16-23`, `waba-webhook.route.ts:63-76`), stale guard ada (`webhook.route.ts:895-946`; `waba-webhook.route.ts:232-266`) | PASS, dengan temuan W-008 |
| 2.3 | Burst coalescing efektif 7 500 ms | **BENAR**, kontradiksi komentar masih ada (#297) | PASS (dengan catatan lama) |
| 2.4 | Idempotensi turn (`InboundTurn`/`OutboundAttempt`) | **PARSIAL**: dedupe DB bekerja, tetapi ledger outbound **tidak dipakai sebagai guard** sebelum kirim dan replay tidak periodik | **PARSIAL** → W-001, W-005 |
| 2.5 | Kill-switch memutus respon | **PARSIAL**: benar dalam satu proses; cache tanpa TTL dan tidak lintas container | **PARSIAL** → W-004 |
| 2.6 | Humanizer | **MEKANISME PASS**, realisme masih #297; ditambah hardcode business phrasing | **PARSIAL** → W-010 |

### 3.3 Klaim `docs/audit/2026-11-02/fase-09` (Integrasi Eksternal)

| Item | Klaim lama | Verifikasi | Status |
|---|---|---|---|
| 9.1 Google Contacts | format nama + isolasi per-tenant | Format ada; **lookup customer by `id` tanpa `tenant_id`** (`google-contacts.service.ts:373-382`) dan tanpa retry durable | **PARSIAL** → I-007 |
| 9.2 Sheets | deterministik `values.update`, kebal duplikasi | Algoritma benar, tetapi **tidak ada claim/lease outbox** → race dua worker | **PARSIAL** → I-003, I-004, I-005 |
| 9.3 Drive backup | "cadangan … diunggah **terenkripsi**" | **TIDAK ADA ENKRIPSI**: `pg_dump` → `gzip` / JSON `gzipSync` lalu `files.create` (`backup.service.ts:60-72, 87-147, 153-197`; `google-drive/client.ts:68-77`). Tidak ada test enkripsi. | **KLAIM SALAH** → I-001 |
| 9.4 Peta/jarak | ORS + Google + Haversine | **BENAR**: fallback berlapis (`delivery.service.ts:244-309`), circuit breaker geocoding (`geocoding.ts:107-113`) | PASS, kredensial env-only → I-011 |
| 9.5 Telegram | laporan/alert | Fungsional, tetapi **tanpa timeout/retry/429** di `telegram.service.ts:99-141` | PARSIAL → I-008 |
| 9.6 Web Push VAPID | notifikasi native | Fungsional, tetapi **VAPID auto-generate ke file lokal** bila env kosong (`web-push.service.ts:29, 60-93`) | PARSIAL → I-010 |
| 9.7 LLM gateway | failover | **Tidak diaudit** (di luar cakupan) | — |

---

## 4. Daftar Temuan

Format tiap temuan: ID · Judul · Tipe · Lokasi · Bukti · Keyakinan · Framework · Akar masalah · FMEA · Collateral damage · Rekomendasi · Verifikasi.

### Ringkasan FMEA

| ID | Severity | S | O | D | **RPN** |
|---|---|---:|---:|---:|---:|
| I-001 | KRITIS | 10 | 7 | 8 | **560** |
| W-001 | TINGGI | 9 | 5 | 9 | **405** |
| W-002 | TINGGI | 8 | 5 | 9 | **360** |
| W-005 | TINGGI | 9 | 4 | 9 | **324** |
| W-004 | TINGGI | 8 | 5 | 8 | **320** |
| I-006 | TINGGI | 7 | 6 | 7 | **294** |
| W-003 | TINGGI | 8 | 4 | 9 | **288** |
| I-003 | TINGGI | 7 | 5 | 8 | **280** |
| I-002 | TINGGI | 9 | 3 | 8 | **216** |
| I-004 | TINGGI | 8 | 3 | 9 | **216** |
| I-005 | SEDANG | 5 | 6 | 7 | **210** |
| I-008 | SEDANG | 6 | 6 | 6 | **216** |
| W-007 | SEDANG | 6 | 4 | 8 | **192** |
| I-007 | SEDANG | 8 | 3 | 8 | **192** |
| W-006 | SEDANG | 7 | 3 | 9 | **189** |
| I-011 | SEDANG | 5 | 5 | 7 | **175** |
| I-010 | SEDANG | 7 | 3 | 8 | **168** |
| W-009 | SEDANG | 9 | 2 | 9 | **162** |
| W-008 | SEDANG | 6 | 4 | 6 | **144** |
| I-009 | SEDANG | 5 | 3 | 7 | **105** |
| W-010 | RENDAH | 4 | 6 | 5 | **120** |
| W-011 | RENDAH | 6 | 2 | 9 | **108** |

> Kalibrasi S: 9–10 = pesan hilang/dobel massal, kebocoran PII/kredensial, bypass HMAC; 6–8 = data tidak lengkap, notifikasi hilang; 4–5 = gangguan UX/operasional. D dinaikkan bila tidak ada alarm/test yang menutupinya.

---

### W-001 — Turn macet setelah boot tidak pernah di-replay; filter umur 2 menit melewatkan crash-restart cepat

- **Tipe:** Vertikal (webhook → turn ledger → queue → recovery)
- **Lokasi:** `src/app.ts:306-311`; `src/services/turn-recovery.service.ts:7-18`; `src/repositories/turn.repository.ts:54-58`; `src/services/queue.service.ts:433-455`
- **Bukti:**
  - `app.ts:306-311` — recovery hanya dipanggil sekali:
    ```ts
    setTimeout(() => {
      import('./services/turn-recovery.service').then(({ turnRecoveryService }) => {
        void turnRecoveryService.replayPendingTurns().catch(() => {});
    ```
  - `turn.repository.ts:55-64` — hanya turn yang `updated_at < now - 2 menit`:
    ```ts
    const olderThanMs = opts.olderThanMs ?? 2 * 60 * 1000;
    ... { status: { in: ['RECEIVED','QUEUED'] }, updated_at: { lt: cutoff } }
    ```
  - `queue.service.ts:433-434` — Redis mati → `enqueueInMemory()`; antrean ini murni RAM, tidak ada dead-letter persisten.
- **Keyakinan:** **TERBUKTI** (alur kode). Dampak produksi belum diukur.
- **Framework:** Well-Architected Reliability (durability, recovery); OPS (tidak ada alarm stuck turn).
- **Akar masalah (5 Whys):**
  1. Mengapa pelanggan tidak dibalas? Turn tetap `RECEIVED`/`QUEUED`.
  2. Mengapa tidak diproses? Proses mati / Redis putus sebelum worker mengambil job.
  3. Mengapa tidak pulih? `replayPendingTurns()` hanya berjalan saat boot.
  4. Mengapa hanya boot? Fitur "Stage 5 RC-04" dirancang sebagai recovery startup, bukan sweep periodik.
  5. Mengapa tidak ada sweep? Tidak ada owner/scheduler untuk durabilitas turn; antrean diasumsikan selalu hidup (`QUEUE_REQUIRE_REDIS` default `false`, `queue.service.ts:88-96`).
- **FMEA:** S=9 (balasan hilang, pelanggan marah / kehilangan lead), O=5 (restart deploy, OOM 512 MB, Redis hiccup lazim), D=9 (tidak ada alarm; hanya log saat boot) → **RPN 405**.
- **Collateral damage:** Menambah sweep periodik bisa memproses ulang turn yang sebenarnya sudah dibalas bila `markStatus(RESPONSE_READY)` gagal (best-effort `try{}catch{}`). Harus idempoten di level kirim (lihat W-005).
- **Rekomendasi (fondasional):**
  1. Jadikan turn ledger **outbox kanonis**: `turn_recovery` berjalan sebagai cron 1–2 menit (`startBackgroundCrons`) dengan klaim atomik (`updateMany status → PROCESSING` + `claimed_at`), bukan `markQueued` best-effort.
  2. Hapus filter `olderThanMs` default 2 menit untuk boot; gunakan `claimed_at`/`attempts` sebagai penentu.
  3. Tambah metrik/alarm `inbound_turns_stuck_total{status=RECEIVED|QUEUED|PROCESSING>10m}` dan alert CRITICAL.
  4. `QUEUE_REQUIRE_REDIS=true` di produksi (fail-fast) setelah cron replay tersedia.
- **Verifikasi:** unit test baru — turn `RECEIVED` berumur 30 dtk (simulasi restart cepat) **harus** di-replay; turn `RESPONSE_READY` tidak boleh; dua worker paralel hanya satu yang mengklaim. Query produksi: `SELECT status, count(*) FROM inbound_turns WHERE updated_at < now()-interval '10 min' GROUP BY status;` harus 0.

---

### W-002 — `setLabelFlags` tanpa `tenantId` di jalur webhook → flag admin/hold selalu ke `default-tenant`

- **Tipe:** Horizontal (pola pemanggilan lintas route) + Vertikal (bypass gate)
- **Lokasi:** `src/routes/webhook.route.ts:55-58, 966-977, 1414-1431`; `src/services/customer.service.ts:164-183`
- **Bukti:**
  - `webhook.route.ts:55-58` (event label WAHA):
    ```ts
    await customerService.setLabelFlags(phone, {
      isAdminLabeled: lower === 'admin' ? isAdded : undefined,
      isHoldLabeled: lower === 'hold' ? isAdded : undefined,
    });
    ```
  - `webhook.route.ts:972` dan `:1424, :1431` — pola sama tanpa `tenantId`.
  - `customer.service.ts:167` — default parameter:
    ```ts
    tenantId: string = DEFAULT_TENANT_ID
    ```
  - `customer.service.ts:178` — cache global per nomor:
    ```ts
    const cust = memoryCustomers.get(phone);
    ```
- **Keyakinan:** **TERBUKTI**.
- **Framework:** STRIDE (Information disclosure / Elevation), Well-Architected Security (tenant isolation).
- **Akar masalah (5 Whys):**
  1. Mengapa bypass admin salah? `is_admin_labeled` tidak pernah terset untuk tenant non-default.
  2. Mengapa? `setLabelFlags` dipanggil tanpa `tenantId`.
  3. Mengapa bisa? Signature punya default `DEFAULT_TENANT_ID` sehingga pemanggil lama "tetap compile".
  4. Mengapa default dibiarkan? Migrasi tenant-aware menyentuh repository, bukan call-site.
  5. Mengapa tidak tertangkap? Tidak ada test webhook multi-tenant; `tests/unit/webhook-echo-tenant.test.ts` hanya menguji echo.
- **FMEA:** S=8 (bot membalas nomor admin/CS; gate hold mati; data tenant lain berubah), O=5 (aktif begitu tenant kedua ada), D=9 (salah flag tidak terlihat) → **RPN 360**.
- **Collateral damage:** Menghapus default parameter memaksa perubahan di semua call-site (≈10). Perbaikan harus per-call-site dengan test, bukan sekadar mengubah default (bisa memecah alur single-tenant).
- **Rekomendasi (fondasional):**
  1. Jadikan `tenantId` **parameter wajib** (TypeScript `tenantId: string`) untuk seluruh mutasi customer; hapus default `DEFAULT_TENANT_ID`.
  2. Pada `handleLabelChatEvent`, teruskan `resolvedTenantId` (sudah tersedia di `:107-129`).
  3. Cache memori `memoryCustomers` harus key `${tenantId}:${phone}` (samakan dengan `memoryWaMessageIds`).
  4. Tambah test adversarial: label event tenant B tidak boleh mengubah customer tenant A dengan nomor sama.
- **Verifikasi:** test integrasi dua tenant; query `SELECT tenant_id, count(*) FROM customers WHERE is_admin_labeled GROUP BY tenant_id` masuk akal; unit test bahwa `setLabelFlags` tanpa tenant gagal compile.

---

### W-003 — Webhook WAHA masih memakai `wahaClient` global (session env) untuk LID/contact/media/label

- **Tipe:** Horizontal (driver vs route) + Vertikal (media & identitas)
- **Lokasi:** `src/routes/webhook.route.ts:8, 336, 605, 611, 738, 770, 804-810, 966, 1062, 1148, 1419`; pembanding `src/integrations/whatsapp/factory.ts:91-118`
- **Bukti:**
  - `webhook.route.ts:8` — `import { wahaClient } from '../integrations/waha/client';`
  - `:738` — `const jidFromWaha = await wahaClient.resolvePrimaryJid(chatId);` (dipakai untuk memetakan `@lid` → nomor HP)
  - `:804-810` — `wahaClient.fetchUrl(...)` / `wahaClient.downloadMedia(waMessageId, chatId)`
  - `:966` / `:1148` / `:1419` — `wahaClient.getChatLabelsOrNull(chatId)`
  - `factory.ts:96-118` sudah menyediakan `getWahaClientForTenant(tenantId)` — **tidak diimpor** oleh webhook.
- **Keyakinan:** **TERBUKTI** (kode). Dampak hanya muncul saat `tenants.waha_session_id ≠ WAHA_SESSION`.
- **Framework:** Well-Architected Reliability + Security (isolasi tenant); STRIDE Information disclosure.
- **Akar masalah (5 Whys):**
  1. Mengapa media/LID gagal untuk tenant non-default? Request menembak `/api/{envSession}/...`.
  2. Mengapa? Webhook memakai singleton `wahaClient`.
  3. Mengapa? Migrasi K-03b hanya menyentuh gateway & typing, bukan ingress.
  4. Mengapa lolos? Test `waha-sync-tenant` menguji sync history, bukan webhook.
  5. Mengapa? Tidak ada invariant "webhook tidak boleh mengimpor `wahaClient`" seperti `waha-label-ban-invariant.test.ts`.
- **FMEA:** S=8 (media hilang, nomor `@lid` tidak ter-resolve → pesan dibuang `IGNORED_NO_PHONE`, label salah), O=4 (butuh >1 session), D=9 (gagal senyap) → **RPN 288**.
- **Collateral damage:** Mengganti ke client per-tenant menambah 1 query/tenant (bisa di-cache seperti `wahaClientCache`). Risiko: session tenant belum dibuat → semua media gagal; perlu fallback eksplisit + alert.
- **Rekomendasi (fondasional):**
  1. Resolve `wahaClientForTenant` **sekali** setelah tenant diketahui, lalu teruskan sebagai parameter (bukan import global) ke seluruh helper media/label/LID.
  2. Tambah invariant test (rg-based) yang melarang `wahaClient.` di `src/routes/webhook.route.ts` kecuali via factory.
  3. Untuk LID resolution, bila tenant client gagal, catat audit `LID_RESOLUTION_FAILED` (jangan diam-diam `IGNORED_NO_PHONE`).
- **Verifikasi:** test dua session mock; assert URL yang dipanggil mengandung session tenant yang benar untuk `resolvePrimaryJid`, `downloadMedia`, `getChatLabels`.

---

### W-004 — Kill-switch outbound di-cache tanpa TTL dan tidak lintas proses

- **Tipe:** Horizontal (semua driver) + Vertikal (kontrol darurat)
- **Lokasi:** `src/services/whatsapp-provider.service.ts:26, 31-45, 51-53, 58-59`; `docker-compose.yml:62, 90`
- **Bukti:**
  ```ts
  private cutoffCache: Map<string, boolean> = new Map();
  public async isOutboundCutOff(tenantId) {
    if (this.cutoffCache.has(tenantId)) return this.cutoffCache.get(tenantId)!; // tanpa TTL
  ```
  `setOutboundCutOff` hanya menulis cache proses pemanggil (`:59`) + DB (`:62-65`). Cron follow-up berjalan di container **worker** (`SEPARATE_WORKER=true`), yang cache-nya tidak pernah di-invalidate.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** Well-Architected Reliability/Operations (emergency control), STRIDE Repudiation.
- **Akar masalah (5 Whys):**
  1. Mengapa cut-off tidak efektif? Worker masih membaca `false` dari cache lokal.
  2. Mengapa cache basi? Tidak ada TTL/subscribe.
  3. Mengapa? Optimasi menghindari query DB per pesan.
  4. Mengapa tidak ada invalidasi? Tidak ada bus/Redis pub-sub untuk config tenant.
  5. Mengapa tidak terdeteksi? Tidak ada test dua proses; test `waha-cutoff` hanya satu instance.
- **FMEA:** S=8 (pesan tetap terkirim setelah admin menekan tombol darurat — risiko shadow-ban & salah kirim), O=5 (setiap kali cut-off dipakai di produksi dengan worker terpisah), D=8 (dianggap aktif) → **RPN 320**.
- **Collateral damage:** Menambah query DB per kirim menambah latensi (~1–3 ms dengan index PK). Solusi TTL 5–10 dtk kompromi.
- **Rekomendasi (fondasional):**
  1. TTL cache 5–10 dtk **atau** Redis key `tenant:{id}:cutoff` yang dibaca tiap kirim (Redis sudah ada).
  2. `isOutboundCutOffSync` hanya untuk jalur non-kritis; driver wajib memakai async.
  3. Test: set cut-off di "proses A" (DB), proses B harus melihat ≤ TTL.
- **Verifikasi:** unit test dengan dua instance service + fake DB; ukur waktu propagasi.

---

### W-005 — Pre-log DB sebelum enqueue durable + buffer burst di memori: pesan bisa "sudah tercatat" tetapi tidak pernah dibalas

- **Tipe:** Vertikal (ingest → persist → enqueue → coalesce)
- **Lokasi:** `src/routes/webhook.route.ts:1531-1572`; `src/services/burst-coalesce.service.ts:128-138, 154-164, 172-230`; `src/services/message.service.ts:238-267`
- **Bukti:**
  - `webhook.route.ts:1531-1545` — log inbound lebih dulu:
    ```ts
    if (!coalesceResult.handled && !(incomingMessage as any)._preLogged) {
      await messageService.logMessage({ ... waMessageId, ... });
      (incomingMessage as any)._preLogged = true;
    ```
  - `:1550-1560` — `persistInbound` dibungkus `try {} catch {}` (kegagalan tidak terlihat):
    ```ts
    try { await turnRepository.persistInbound({...}); } catch {}
    ```
  - `:1562-1571` — baru `enqueueMessage`.
  - `burst-coalesce.service.ts:131-138` — pesan di-log, lalu hanya disimpan di `Map` + `setTimeout` (`:154-164`); tidak ada baris `InboundTurn` sampai flush.
  - `message.service.ts:238-267` — duplikasi ditentukan oleh keberadaan baris pesan di DB (`existsByWaId`), sehingga redelivery WAHA setelah pre-log akan di-skip (`webhook.route.ts:751-755`).
- **Keyakinan:** **TERBUKTI** untuk urutan; **KEMUNGKINAN BESAR** untuk kejadian (butuh crash tepat di jendela tersebut).
- **Framework:** Well-Architected Reliability (at-least-once vs at-most-once), STRIDE Tampering (state tidak konsisten).
- **Akar masalah (5 Whys):**
  1. Mengapa pelanggan tidak dibalas padahal pesan ada di Live Chat? Pesan di-log, tetapi job tidak pernah masuk antrean.
  2. Mengapa? Proses berhenti antara pre-log dan enqueue / buffer burst hilang.
  3. Mengapa tidak dikirim ulang? Dedupe DB menganggap `wa_message_id` sudah diproses.
  4. Mengapa dedupe dipakai sebagai penanda "sudah dibalas"? Tidak ada status pemrosesan terpisah yang dicek sebelum skip.
  5. Mengapa? `InboundTurn` ada, tetapi `isDuplicateMessage` tidak membacanya; urutan tulis tidak atomik.
- **FMEA:** S=9 (pesan tidak pernah dibalas), O=4 (jendela puluhan ms s/d 7,5 dtk per pelanggan saat crash/deploy), D=9 (tidak ada alarm) → **RPN 324**.
- **Collateral damage:** Membalik urutan (persist turn → enqueue → log) membuat Live Chat sedikit lebih lambat muncul. Risiko duplikasi log bila gagal di tengah; perlu idempotensi `wa_message_id` di `messages`.
- **Rekomendasi (fondasional):**
  1. **Urutan kanonis:** `persistInbound(RECEIVED)` → `enqueue` → `logMessage` (atau satu transaksi DB untuk turn+message).
  2. Dedupe harus memeriksa **status turn**, bukan hanya keberadaan pesan: skip hanya bila `RESPONSE_READY|DELIVERED|HANDOFF`. Bila `RECEIVED/QUEUED`, re-enqueue (idempoten via jobId).
  3. Buffer coalescing harus punya representasi durable (baris `InboundTurn` untuk tiap pesan sejak awal, dengan `merged_into`), bukan hanya `Map`.
  4. `persistInbound` tidak boleh `catch {}`; kegagalan harus meninggalkan jejak + alert.
- **Verifikasi:** test adversarial — inject crash setelah pre-log (mock `enqueueMessage` throw), kirim ulang webhook yang sama, assert turn diproses tepat sekali; test flush setelah restart dengan buffer hilang.

---

### W-006 — Burst coalescing mengasumsikan satu proses (tanpa lock lintas instance)

- **Tipe:** Horizontal (scaling)
- **Lokasi:** `src/services/burst-coalesce.service.ts:62, 91-95, 141-164`
- **Bukti:** `private buffers: Map<string, PendingBuffer>` (per proses). Dua replika `app` akan: (a) mem-buffer pesan yang sama di dua memori, (b) masing-masing flush → **dua balasan**; atau (c) satu pesan di buffer A, pesan berikutnya di buffer B → jawaban tidak melihat konteks lengkap.
- **Keyakinan:** **TERBUKTI** secara desain; saat ini produksi single `app` (`docker-compose.yml`), jadi dampak = saat scale.
- **Framework:** Well-Architected Reliability (scalability), OPS.
- **Akar masalah:** Debounce disimpan di memori proses, bukan di Redis/DB; tidak ada distributed lock per `tenant:phone`.
- **FMEA:** S=7 (balasan dobel/konteks pecah), O=3 (hanya saat >1 replika), D=9 (tidak terlihat) → **RPN 189**.
- **Collateral damage:** Memindahkan buffer ke Redis menambah round-trip (~1 ms) dan kompleksitas TTL; risiko kehilangan buffer bila Redis flush (perlu fallback).
- **Rekomendasi:** Gunakan Redis list/key `burst:{tenant}:{phone}` + `SET NX PX` sebagai debounce lock; flush oleh pemilik lock. Alternatif minimal: dokumentasikan **single-instance only** dan tambahkan guard startup yang menolak `REPLICA_COUNT>1` bila `BURST_COALESCE_MS>0`.
- **Verifikasi:** test dua instance service dengan Redis mock; assert hanya satu job per window.

---

### W-007 — WABA: media non-gambar tidak diarsipkan; unduhan gambar tanpa header Authorization

- **Tipe:** Vertikal (media) + Horizontal (paritas WAHA vs WABA)
- **Lokasi:** `src/routes/waba-webhook.route.ts:173-207`; `src/integrations/whatsapp/media.ts:24-41`
- **Bukti:**
  - `waba-webhook.route.ts:173` — hanya gambar:
    ```ts
    if (msg.type === 'image' && msg.mediaId) {
    ```
    Tidak ada cabang untuk `audio|voice_note|document|video|sticker` padahal normalizer sudah menetapkan `mediaId` (`normalizer.ts:60-77`).
  - `:188-189` — unduh tanpa token:
    ```ts
    const axios = (await import('axios')).default;
    const response = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 15000 });
    ```
    Padahal `resolveWabaMediaUrl` memanggil Graph API dengan `Authorization: Bearer` (`media.ts:9-12`). URL media Meta umumnya tetap memerlukan bearer token.
- **Keyakinan:** media non-gambar **TERBUKTI**; header Authorization **KEMUNGKINAN BESAR** (butuh uji live).
- **Framework:** Well-Architected Reliability (data completeness); STRIDE Information disclosure (media PII).
- **Akar masalah:** Implementasi WABA dibuat minimal (hanya gambar) dan tidak memakai satu helper unduh bersama; tidak ada test media non-gambar WABA.
- **FMEA:** S=6 (bukti pembayaran/voice note hilang, tidak bisa diaudit), O=4 (WABA bukan provider utama saat ini), D=8 (gagal senyap, hanya `console.warn`) → **RPN 192**.
- **Collateral damage:** Menambah unduhan semua media menaikkan beban webhook; wajib background + batas ukuran seperti WAHA (`webhook.route.ts:1043-1091`).
- **Rekomendasi:** satu `downloadWabaMedia(mediaId, token)` yang mengembalikan Buffer (resolve URL + GET dengan Bearer + timeout), dipakai semua tipe; arsipkan via `saveInboundMedia` di background; tambahkan test 401/403/404.
- **Verifikasi:** test integrasi dengan axios mock yang menolak request tanpa header; media audio/document tersimpan di `storage/media/inbound/<tenant>`.

---

### W-008 — Status webhook WABA: `phone_number_id` tak dikenal melempar 500 (retry storm)

- **Tipe:** Vertikal (status path) + Horizontal (perbedaan penanganan dengan messages)
- **Lokasi:** `src/routes/waba-webhook.route.ts:88-103` vs `:134-142`; `src/services/waba-tenant.service.ts:15-44`
- **Bukti:** pada loop statuses, `resolveTenantByPhoneNumberId` dipanggil tanpa `try/catch` (`:90`). Service melempar `UNKNOWN_PHONE_NUMBER_ID` (`:17, :30`). Pada loop messages, error itu ditangkap dan dijawab 200 (`:134-142`). Fastify akan membalas 500 → Meta mengulang webhook yang sama.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** Well-Architected Reliability (retry storm / poison message), STRIDE DoS.
- **Akar masalah:** Penanganan error tidak konsisten antar dua loop dalam satu handler; status dianggap "selalu bisa di-resolve".
- **FMEA:** S=6 (status hilang, antrean Meta penuh, 500 berulang), O=4 (decommission/ganti nomor), D=6 (log 500 terlihat) → **RPN 144**.
- **Collateral damage:** Menelan error status bisa menyembunyikan salah konfigurasi; harus tetap alert + simpan status di tabel karantina.
- **Rekomendasi:** bungkus per-status dengan `try/catch`; `UNKNOWN_PHONE_NUMBER_ID` → `200 {status:'UNKNOWN_TENANT_REJECTED', messageId}` + alert + baris `webhook_dead_letter` (tabel baru, lihat #103). Jangan 500 untuk data yang tidak akan pernah valid.
- **Verifikasi:** test: status dengan `phone_number_id` asing → 200, satu alert, tidak ada exception; test messages tetap 200.

---

### W-009 — Cache `phone_number_id → tenant` WABA tanpa TTL (reassignment permanen ke tenant lama)

- **Tipe:** Horizontal (konsistensi resolver)
- **Lokasi:** `src/services/waba-tenant.service.ts:8, 20-21, 32`; pembanding `src/services/waha-tenant.service.ts:20, 35-38, 51`
- **Bukti:** `const tenantCache = new Map<string, string>();` lalu `if (cached) return cached;` — tanpa `expiresAt`. WAHA punya TTL 5 menit; WABA tidak. Bila nomor dipindahkan ke tenant lain, semua pesan/status terus masuk tenant lama sampai restart.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** STRIDE Information disclosure (pesan tenant B masuk tenant A), Well-Architected Security.
- **Akar masalah:** Cache ditambahkan untuk performa tanpa kebijakan invalidasi; tidak ada admin action yang memanggil `resetCache()`.
- **FMEA:** S=9 (pesan & PII lintas tenant), O=2 (butuh reassignment), D=9 (tidak terlihat) → **RPN 162** → **SEDANG** (dampak tinggi, frekuensi rendah).
- **Collateral damage:** TTL menambah 1 query per 5 menit per nomor — dapat diabaikan.
- **Rekomendasi:** samakan dengan WAHA (TTL + `expiresAt`), panggil `resetCache()` pada update tenant (`settings.subroute.ts`), dan tambahkan test reassignment.
- **Verifikasi:** unit test: ubah `waba_phone_number_id` lalu panggil resolve setelah TTL → tenant baru; sebelum TTL → tenant lama (didokumentasikan).

---

### W-010 — Humanizer: daftar frasa bisnis hardcode + label lama "Alamat & Shareloc"

- **Tipe:** Horizontal (pelanggaran mandat non-hardcode)
- **Lokasi:** `src/services/typing.service.ts:155-168, 173-174, 210-213`
- **Bukti:**
  ```ts
  const concludingKeywords = ['mohon bisa diisi','mohon diisi','silakan diisi', ...];
  const isReservationForm =
    /(berikut\s+(list|format)\s+(untuk\s+)?reservasi|...)/i.test(trimmed) ||
    (trimmed.toLowerCase().includes('hari dan tanggal') && trimmed.toLowerCase().includes('alamat & shareloc'));
  ```
  `#315` sudah mengganti label form menjadi "Alamat Lengkap & Patokan" — string lama tetap menjadi pemicu split.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** AGENTS.md Mandat Non-Hardcode & Data-Driven; OPS (perubahan template DB tidak diikuti kode).
- **Akar masalah:** Logika pemecahan bubble menebak struktur pesan dari teks, bukan dari penanda terstruktur (mis. `[FORM]`/`metadata.kind`) yang dihasilkan generator.
- **FMEA:** S=4 (format pesan pecah/typo), O=6 (setiap form reservasi), D=5 (terlihat di chat) → **RPN 120**.
- **Collateral damage:** Memindahkan penanda ke metadata menyentuh generator prompt/form (blast radius sedang). Fallback harus tetap ada untuk pesan lama.
- **Rekomendasi:** kirim `messageKind`/`replyStructure` dari generator (state machine) → `splitIntoBubbles(text, kind)`; pindahkan daftar kata kunci ke `Tenant.settings` bila masih perlu heuristik; ganti "alamat & shareloc" menjadi label kanonis dari DB.
- **Verifikasi:** test: form dengan label baru tetap 3 bubble; teks biasa yang memuat "mohon diisi" tidak dipaksa pecah; test tenant dengan template kustom.

---

### W-011 — `WahaGatewayDriver.sendTemplateMessage` mengirim teks literal `Template[...]` (kontrak bohong, laten)

- **Tipe:** Horizontal (kontrak gateway)
- **Lokasi:** `src/integrations/whatsapp/waha.driver.ts:112-120, 199-206`; satu-satunya pemanggil `src/services/follow-up.service.ts:2436`
- **Bukti:**
  ```ts
  private interpolateTemplate(components) {
    const body = components.find(c => c.type === 'body');
    if (!body) return '';
    return body.parameters.reduce((text, param, i) => text.replace(`{{${i+1}}}`, param.value),
      `Template[${body.parameters.map(p => p.value).join(', ')}]`);
  }
  ```
  Base template tidak pernah diberikan; hasilnya string literal "Template[...]". Pemanggil saat ini dijaga `gateway.providerType === 'WABA'` (`follow-up.service.ts:2165-2166`), jadi belum reachable di WAHA — tetapi interface `WhatsAppGateway` mewajibkan method ini untuk semua provider.
- **Keyakinan:** **TERBUKTI** (kode); dampak saat ini **nihil** (tidak ada jalur).
- **Framework:** Well-Architected Reliability (contract integrity).
- **Akar masalah:** Method dipenuhi agar interface compile, bukan untuk fungsi nyata.
- **FMEA:** S=6 (pesan sampah ke pelanggan bila dipanggil), O=2 (butuh pemanggil baru), D=9 (lolos type-check) → **RPN 108** → **RENDAH**.
- **Collateral damage:** Menghapus method memaksa perubahan interface & driver WABA; lakukan dengan `sendTemplateMessage` WAHA yang mengembalikan `success:false` eksplisit + `code:'TEMPLATE_UNSUPPORTED_ON_WAHA'`.
- **Rekomendasi:** ganti implementasi WAHA menjadi penolakan eksplisit (fail-closed), atau render dari `TenantWhatsappTemplate` (DB) bila memang dibutuhkan; tambah test kontrak.
- **Verifikasi:** unit test: `sendText` **tidak** dipanggil saat `sendTemplateMessage` dipanggil pada WAHA; hasil `success:false`.

---

### I-001 — Backup mingguan tidak terenkripsi & berisi seluruh database, diunggah ke Drive satu tenant

- **Tipe:** Vertikal (backup → Drive) + Horizontal (klaim vs kode)
- **Lokasi:** `src/services/backup.service.ts:57-82, 87-148, 153-197`; `src/integrations/google-drive/client.ts:13-87`; klaim `docs/audit/2026-11-02/fase-09/LAPORAN_FASE_09.md:22`
- **Bukti:**
  - `backup.service.ts:63` — `const cmd = \`pg_dump "${dbUrl}" | gzip > "${filePath}"\`;` (tanpa enkripsi)
  - `:145-147` — fallback JSON: `const compressed = zlib.gzipSync(Buffer.from(jsonString, 'utf-8')); fs.writeFileSync(filePath, compressed);`
  - `:113-124` — fallback dump membaca **semua tenant** tanpa `where` (`prisma.customer.findMany()` dst.)
  - `google-drive/client.ts:68-77` — `media = { mimeType: 'application/gzip', body: fs.createReadStream(filePath) }` lalu `drive.files.create` (tanpa enkripsi/`clientEncryption`).
  - `backup.service.ts:168-176` — auth memakai integrasi Google **tenant pemanggil**; folder `ensureBackupFolder` global per akun (`client.ts:16-50`).
  - `tests/unit/backup.test.ts:71-97` hanya menguji gzip & pruning; **tidak ada assertion enkripsi**.
- **Keyakinan:** **TERBUKTI** (kode). Klaim "terenkripsi" pada fase-09 **terbantah**.
- **Framework:** Well-Architected Security (data protection at rest), STRIDE Information disclosure, ISO 27001 A.8/A.10 (kriptografi & transfer).
- **Akar masalah (5 Whys):**
  1. Mengapa data pasien berisiko? File dump berada di Drive tanpa enkripsi.
  2. Mengapa? Backup dirancang sebagai operasi `pg_dump | gzip`.
  3. Mengapa tidak dienkripsi? Fokus audit sebelumnya pada kredensial (SEC-AUDIT-11), bukan payload backup.
  4. Mengapa klaim "terenkripsi" lolos? Tidak ada test/verifikasi; laporan fase-09 mencantumkan path test yang tidak ada.
  5. Mengapa? Gate fase-09 (`scripts/audit-phase-gates.mjs:87-97`) tidak memuat backup/Drive — coverage gap sistemik.
- **FMEA:** S=10 (seluruh PII, hash password staf, token tenant, riwayat chat), O=7 (mingguan otomatis bila Google terhubung), D=8 (tidak ada yang memeriksa isi Drive) → **RPN 560**.
- **Collateral damage:** Enkripsi mengubah format file → `restoreDatabaseFromDump` & `getBackupFileCounts` harus mendukung dekripsi; operator kehilangan kemampuan `pg_restore` langsung (butuh CLI decrypt). Harus ada kunci yang disimpan di luar Drive (env/KMS) + prosedur kehilangan kunci.
- **Rekomendasi (fondasional):**
  1. Enkripsi **sebelum** upload: AES-256-GCM streaming (`crypto.createCipheriv`) dengan kunci `BACKUP_ENCRYPTION_KEY` (wajib di produksi; fail-fast bila kosong). Simpan `iv|tag` di header file; ekstensi `.sql.gz.enc`.
  2. Tambahkan manifest terenkripsi (tenant, tabel, row counts, hash) agar verifikasi restore tidak memerlukan dekripsi penuh.
  3. **Tenant boundary:** untuk multi-tenant, backup harus per-tenant (`WHERE tenant_id = $1`) atau seluruh DB dienkripsi dengan kunci platform dan **tidak** diunggah ke Drive tenant; minimal dokumentasikan sebagai platform-level backup.
  4. Folder Drive per tenant (`backups/<tenant>/`) dan nama folder dari `Tenant.settings`, bukan `'Kala Clinic Bot Backups'` (`client.ts:16`).
  5. Tambah test: file hasil backup **tidak** mengandung byte PII yang dapat dicari; restore menolak file tanpa header enkripsi saat mode produksi.
- **Verifikasi:** `head -c 32 backup.enc` tidak sama dengan `1f 8b`; `strings backup.enc | grep -c "628"` = 0; restore end-to-end di staging; ukur waktu enkripsi/dekripsi pada dump 9,3 MB.

---

### I-002 — Restore menerima dump lintas tenant tanpa validasi kepemilikan

- **Tipe:** Vertikal (restore → DB)
- **Lokasi:** `src/services/backup.service.ts:415-472, 537-561, 564-588, 741-758`
- **Bukti:** Upsert memakai `tenant_id` dari **isi file**, bukan tenant pemanggil:
  ```ts
  await prisma.customer.upsert({
    where: { tenant_id_phone: { tenant_id: c.tenant_id || tenantId, phone: c.phone } },
    update: { ... tenant_id: c.tenant_id || tenantId },
    create: { ...c, tenant_id: c.tenant_id || tenantId },
  ```
  `deliveryTier.deleteMany({ where: { tenant_id: tenantId } })` lalu `create({ data: { ...dt, tenant_id: dt.tenant_id || tenantId } })` — dapat menghapus tier tenant A lalu menulis tier tenant B. `reservation.update({ where: { id } })` tanpa tenant (`saveRowRef` juga, `sheets-sync.service.ts:499-508`). `staff.upsert({ where: { phone } })` global.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** STRIDE Tampering/Elevation; Well-Architected Security.
- **Akar masalah:** Restore diperlakukan sebagai "operator super-admin", bukan operasi tenant-scoped; tidak ada envelope metadata tenant di file dump programmatic (`meta.tenantId` hanya informatif, `:90-92`).
- **FMEA:** S=9 (data tenant lain masuk/tertimpa), O=3 (butuh restore manual), D=8 (tidak ada validasi) → **RPN 216**.
- **Collateral damage:** Menolak `tenant_id` asing bisa menggagalkan restore bencana lintas tenant; sediakan mode `--platform-restore` eksplisit dengan audit.
- **Rekomendasi:** (a) simpan `meta.tenantId` + HMAC manifest; (b) tolak bila `meta.tenantId !== tenantId` kecuali flag platform; (c) rewrite semua `tenant_id` ke tenant target secara eksplisit (bukan `||`); (d) audit log sebelum/sesudah dengan jumlah baris per tabel.
- **Verifikasi:** test: dump tenant A direstore oleh tenant B → 400/409, tidak ada perubahan; dump tanpa `meta.tenantId` → ditolak di produksi.

---

### I-003 — Outbox Sheets tanpa claim/lease → baris rekapan ganda saat cron tumpang tindih

- **Tipe:** Vertikal (outbox → Sheets) + Horizontal (pola outbox)
- **Lokasi:** `src/services/sheets/sheets-sync.service.ts:171-222, 511-543`; `src/services/sheets/sheets-client.ts:181-215`
- **Bukti:**
  - `listPending` mengembalikan `status: 'processing'` juga (`:531-543`), tetapi **tidak ada kode yang menulis `processing`** — grep seluruh `src/` hanya menemukan pembacaan (`:535`) dan test fake store (`tests/unit/sheets-sync.service.test.ts:77`). Komentar `upsertOutbox` "Jangan reset bila sedang diproses worker" (`:512-518`) adalah dead code.
  - `appendRow` melakukan **scan-then-write** (`values.get A:A` cari baris kosong, lalu `values.update`) — dua proses bisa memilih baris yang sama (`sheets-client.ts:188-212`).
  - Cron berjalan tiap 3 menit tanpa guard re-entry (`background-crons.ts:33-40`; `interval-registry.ts:16-19` hanya `setInterval`).
- **Keyakinan:** **TERBUKTI**.
- **Framework:** Well-Architected Reliability (idempotency), OPS.
- **Akar masalah (5 Whys):**
  1. Mengapa rekapan bisa dobel? Dua proses menulis baris yang sama.
  2. Mengapa? Tidak ada klaim atomik pada outbox.
  3. Mengapa? Status `processing` didefinisikan tetapi tidak pernah diset.
  4. Mengapa? Implementasi awal mengandalkan "cron jarang", bukan lease.
  5. Mengapa tidak terdeteksi? Test hanya menguji satu worker berurutan.
- **FMEA:** S=7 (rekapan ganda/tertimpa, laporan keuangan salah), O=5 (Google lambat >3 menit atau dua container), D=8 (tidak ada unique row di sheet) → **RPN 280**.
- **Collateral damage:** Lease yang kedaluwarsa bisa membuat baris "macet processing"; perlu `claimed_at` + reclaim setelah N menit. Menambah kolom butuh migrasi.
- **Rekomendasi (fondasional):**
  1. `claimBatch(tenantId, limit)` atomik: `UPDATE ... SET status='processing', claimed_at=now(), attempts=attempts+1 WHERE id IN (...) AND (status='pending' OR (status='processing' AND claimed_at < now()-interval '10 min')) RETURNING *` (raw SQL via Prisma).
  2. `appendRow` idempoten: simpan `rowIndex` **dan** `row_hash`; sebelum update, verifikasi baris masih milik reservasi (`reconcileRowIndex` sudah ada — perluas ke append).
  3. Tambah unique index di spreadsheet? Tidak mungkin; gunakan kolom kunci (reservation id) di sheet tersembunyi atau `sheets_row_index` sebagai otoritas.
  4. Guard re-entry per tenant (`Map<tenant, Promise>`).
- **Verifikasi:** test dua `processOutbox` paralel dengan fake Google yang menunda → hanya satu append; test reclaim setelah `claimed_at` basi; query `SELECT reservation_id, count(*) FROM ...` di sheet = 1.

---

### I-004 — `ensureMonthlyTab` menghapus `A2:P1000` setelah membuat tab (race dengan append)

- **Tipe:** Vertikal (pembuatan tab → tulis baris)
- **Lokasi:** `src/services/sheets/sheets-client.ts:145-178`
- **Bukti:**
  ```ts
  } catch (err) { /* nama duplikat */ ... if (after) return { tabName: after.properties.title, created: false, ... }; }
  ...
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${tabName}!A2:P1000` });
  ```
  Pada balapan dua worker: worker A berhasil `duplicateSheet`, worker B mendapat error "sudah ada" lalu **return lebih awal**; worker A kemudian `clear A2:P1000`. Jika B (atau proses lain) sudah sempat menulis baris sebelum A melakukan clear, baris itu **hilang**.
- **Keyakinan:** **TERBUKTI** (urutan kode); kejadian butuh tab baru + dua worker.
- **Framework:** Well-Architected Reliability (data loss).
- **Akar masalah:** Operasi "buat tab" dan "bersihkan data template" tidak atomik; pembersihan dilakukan setelah balapan diselesaikan.
- **FMEA:** S=8 (baris rekapan hilang tanpa jejak), O=3 (hanya awal bulan/tahun), D=9 (tidak ada rekonsiliasi) → **RPN 216**.
- **Collateral damage:** Memindahkan `clear` sebelum `duplicateSheet` tidak mungkin (tab belum ada). Alternatif: clear hanya bila `created === true` **dan** lakukan sebelum ada append — perlu lock pembuatan tab.
- **Rekomendasi:** gunakan lock distribusi per `spreadsheetId+tabName` (Redis `SET NX`), dan jangan `clear` bila tab sudah ada; untuk tab baru, `clear` dilakukan di dalam critical section yang sama dengan penanda "tab siap" (`TenantSheetsConfig.ready_tabs`).
- **Verifikasi:** test dua worker paralel membuat tab baru lalu append; assert 1 tab, 1 baris, tidak ada clear setelah append.

---

### I-005 — Tahun Sheets belum dipetakan → outbox `failed` tanpa alert; metrik `failed` mencampur deferred

- **Tipe:** Horizontal (observability)
- **Lokasi:** `src/services/sheets/sheets-sync.service.ts:195-218, 337-342`
- **Bukti:**
  - `resolveSpreadsheetId` melempar `SHEETS_YEAR_NOT_CONFIGURED` (`:341`); ditangani sebagai `isDataNotReadyError` → tunda 15 menit, setelah 10 percobaan `markFailed` (`:200-208`) — **tanpa alert**.
  - `result.failed++` juga dieksekusi pada cabang `incrementAttempt` (`:213-214`), padahal item masih `pending` → angka "gagal" di log/UI menyesatkan (`processOutbox` return).
- **Keyakinan:** **TERBUKA** (kode).
- **Framework:** OPS (alerting, metrik).
- **Akar masalah:** Kegagalan konfigurasi diperlakukan seperti kegagalan transien; tidak ada dead-letter dashboard.
- **FMEA:** S=5 (rekapan tahun baru tidak masuk), O=6 (setiap pergantian tahun), D=7 (hanya log) → **RPN 210**.
- **Collateral damage:** Menambah alert bisa spam saat tenant memang belum mengaktifkan Sheets; bedakan `SHEETS_CONFIG_DISABLED` (senyap) vs `YEAR_NOT_CONFIGURED` (alert).
- **Rekomendasi:** alert Telegram/in-app saat `YEAR_NOT_CONFIGURED` pertama kali + tombol "coba lagi" di Settings; pisahkan `deferred` dari `failed`; tambah `next_retry_at` terlihat di UI.
- **Verifikasi:** test dengan config tahun kosong → 1 alert, status tetap `pending` sampai retry habis, metrik `failed` = 0 untuk deferred.

---

### I-006 — Google Calendar: tidak tenant-aware, tanpa idempotensi, durasi tetap 60 menit

- **Tipe:** Vertikal (reservasi → Calendar) + Horizontal (SaaS)
- **Lokasi:** `src/services/google-calendar.service.ts:13-42, 56-58, 64-75, 84-88, 95-142`; pemanggil `src/routes/admin/reservation-dispatch.route.ts:642, 1409, 1608, 1953`
- **Bukti:** Kredensial dari env tunggal (`GOOGLE_CALENDAR_CLIENT_EMAIL/PRIVATE_KEY`) dan `calendarId='primary'` (`:9-20`); brand memakai `getBrandIdentity()` sinkron (bukan `Async(tenantId)`) (`:65-66`); durasi selalu `+60 menit` (`:58`); `createEvent` dipanggil tanpa kunci idempotensi dan tidak ada pengecekan event lama (`:84-88`) — retry hook akan membuat event ganda.
- **Keyakinan:** **TERBUKA**.
- **Framework:** Well-Architected Security (tenant isolation) + Reliability (duplicate events).
- **Akar masalah:** Integrasi dibuat pra-multi-tenant (service account tunggal) dan belum dimigrasikan seperti Contacts/Sheets.
- **FMEA:** S=7 (jadwal ganda/salah brand, kebocoran jadwal pasien ke kalender bersama), O=6 (setiap create/retry), D=7 (tidak ada dedupe) → **RPN 294**.
- **Collateral damage:** Migrasi ke OAuth per tenant butuh re-consent + kolom baru; fallback harus tetap mock agar build tidak gagal.
- **Rekomendasi:** (a) pakai `TenantGoogleIntegration` + scope calendar (tambahkan scope, perlu re-consent); (b) `google_calendar_event_id` + `events.list` by `privateExtendedProperty=reservationId` untuk idempotensi; (c) durasi dari `Treatment.duration_minutes` (DB); (d) `getBrandIdentityAsync(tenantId)`.
- **Verifikasi:** test: dua `createEvent` untuk reservasi sama → satu event; kalender tenant A tidak menerima event tenant B.

---

### I-007 — Google Contacts: tanpa outbox/retry dan lookup customer tanpa `tenant_id`

- **Tipe:** Vertikal (sync) + Horizontal (tenant)
- **Lokasi:** `src/services/google-contacts.service.ts:349-402, 432-485, 495-526, 531-644`
- **Bukti:**
  - `syncCustomer` memakai `prisma.customer.findUnique({ where: { id: customerId } })` (`:373-382`) — **tanpa `tenant_id`** — lalu menulis ke Google tenant pemanggil (`:405-410, 468-475`). Bila id bocor/keliru, PII tenant lain masuk ke akun Google tenant ini.
  - Kegagalan hanya `console.error` (`:274-278, 339-344, 486-489`); `batchSyncAllCustomers` memberi jeda tetap 80 ms dan tidak mencatat kegagalan per customer (`:509-519`).
- **Keyakinan:** **TERBUKA** (kode). Pemicu id lintas tenant belum terbukti ada.
- **Framework:** STRIDE Information disclosure; Well-Architected Security/Reliability.
- **Akar masalah:** Sync dianggap efek samping best-effort, bukan transaksi dengan status per customer; scoping tenant diterapkan pada config, bukan pada query entity.
- **FMEA:** S=8 (nama+nomor pasien tenant lain ke Google), O=3, D=8 → **RPN 192**.
- **Collateral damage:** Menambah outbox = tabel/migrasi; alternatif minimal: `findFirst({ id, tenant_id })` + kolom `google_sync_error` pada Customer.
- **Rekomendasi:** (a) `findFirst({ where: { id: customerId, tenant_id: tenantId } })`; (b) kolom `google_sync_status/error/attempts` + sweep 15 menit (pola `SheetsSyncOutbox`); (c) backoff eksponensial + alert setelah N gagal.
- **Verifikasi:** test dua tenant dengan id tertukar → 404/skip; test kegagalan People API → status `pending` dan retry.

---

### I-008 — Telegram: tanpa timeout, retry, dan penanganan 429; kegagalan sering diabaikan pemanggil

- **Tipe:** Horizontal (semua pemanggil notifikasi)
- **Lokasi:** `src/services/telegram.service.ts:99-141`; contoh pemanggil `src/services/staff-notification.service.ts:703, 795`; pembanding `src/services/alert.service.ts:208-227`
- **Bukti:** `fetch(...)` tanpa `AbortController`/timeout (`:125-129`), tanpa retry/backoff, tanpa membaca `retry_after` pada 429; `parse_mode` default `'Markdown'` (`:115`) sehingga teks berisi `_`/`*` menghasilkan 400. `alert.service.ts:219-227` punya fallback tanpa `parse_mode`, tetapi `telegramService` tidak.
- **Keyakinan:** **TERBUKA**.
- **Framework:** Well-Architected Reliability (timeout/retry).
- **Akar masalah:** Dua jalur Telegram (service vs alert) dengan kualitas berbeda; service tidak pernah di-hardening.
- **FMEA:** S=6 (notifikasi tugas/briefing bidan hilang), O=6 (token/parse/429), D=6 (sebagian pemanggil mengabaikan `ok:false`) → **RPN 216**.
- **Collateral damage:** Retry bisa menggandakan pesan bila response hilang setelah terkirim; gunakan `idempotency` tidak tersedia di Bot API → retry hanya untuk error koneksi/429, bukan timeout baca.
- **Rekomendasi:** satu `telegramFetch` dengan timeout 10 dtk, 3 retry (hanya 429/5xx), `AbortController`, fallback `parse_mode` kedua, dan `return {ok:false}` yang **wajib** dicek (TypeScript `Result`); satukan `alert.service` memakai service ini.
- **Verifikasi:** test 429 dengan `retry_after=1` → satu retry; test teks `_` → terkirim tanpa 400; test timeout → `ok:false` dalam ≤10 dtk.

---

### I-009 — Log idempotensi notifikasi tidak diperbarui saat resend sukses → status `FAILED` permanen & kirim ulang setelah restart

- **Tipe:** Vertikal (cron → log → kirim)
- **Lokasi:** `src/services/notification-delivery.service.ts:77-88, 113-133, 240-256`; pemanggil `src/lifecycle/background-crons.ts:167-225`
- **Bukti:** `findExistingByIdempotencyKey` hanya menganggap `SENT` sebagai sudah terkirim (`:80-87`). Bila percobaan pertama `FAILED`, log dibuat dengan key tersebut; percobaan berikutnya mengirim ulang (benar), tetapi `writeLog` membuat baris baru dengan key sama → `P2002` → mengembalikan **baris FAILED lama** (`:245-249`), status tidak pernah di-update menjadi `SENT`. Nightly watchdog memiliki penjaga in-memory `lastNightlyRunDate` (`background-crons.ts:182-183`) sehingga duplikat dalam satu proses tertahan; namun setelah **restart/deploy di hari yang sama**, laporan yang statusnya masih `FAILED` akan dikirim ulang. Setiap pemanggil baru tanpa penjaga in-memory akan mengirim ulang setiap tick.
- **Keyakinan:** **TERBUKA** (trace kode).
- **Framework:** Well-Architected Reliability/OPS; terkait #144.
- **Akar masalah:** Log dianggap append-only, padahal `idempotency_key` unik menjadikannya state machine; tidak ada `attempts`/`last_attempt_at` yang bisa di-update.
- **FMEA:** S=5 (spam laporan/alert, dashboard status bohong), O=3 (butuh restart di hari yang sama), D=7 (UI menampilkan FAILED) → **RPN 105**.
- **Collateral damage:** Update baris bisa menghapus riwayat percobaan; simpan `attempts` + `last_error` di baris yang sama.
- **Rekomendasi:** `upsert` berdasarkan `idempotency_key` + transisi status (`FAILED → SENT`), simpan `attempts`/`last_attempt_at`; atau tabel `notification_attempts` terpisah.
- **Verifikasi:** test: gagal sekali lalu sukses → satu baris, status `SENT`, cron berikutnya `ALREADY_SENT`.

---

### I-010 — VAPID auto-generate ke file lokal → langganan mati saat container/FS baru atau beda container

- **Tipe:** Vertikal (inisialisasi → push)
- **Lokasi:** `src/services/web-push.service.ts:29, 51-103, 271-285`
- **Bukti:** Bila `VAPID_PUBLIC_KEY`/`PRIVATE_KEY` kosong, service membuat pasangan baru dan menulis `storage/vapid_keys.json` (`:80-93`). App & worker berbagi volume `./storage` di compose (`docker-compose.yml:21-22, 81-82`) sehingga **kebetulan** sama; tetapi deploy baru/FS kosong/`npm run dev` di mesin lain menghasilkan kunci baru → semua subscription lama ditolak (401/403) dan hanya sebagian di-prune (hanya 410/404, `:279-283`).
- **Keyakinan:** **TERBUKA**.
- **Framework:** Well-Architected Reliability/Operations.
- **Akar masalah:** Kunci kriptografis diperlakukan sebagai file cache, bukan konfigurasi wajib.
- **FMEA:** S=7 (semua notifikasi berhenti senyap), O=3 (bila env tidak diset), D=8 (hanya log error push) → **RPN 168**.
- **Collateral damage:** Mewajibkan env akan menggagalkan boot di dev; gunakan mode `NODE_ENV=production` fail-fast, dev auto-generate dengan peringatan.
- **Rekomendasi:** wajibkan `VAPID_PUBLIC_KEY/PRIVATE_KEY` di produksi (boot check seperti `ADMIN_API_KEY`); hapus fallback file di produksi; tambah metrik `push_401_total` + alert.
- **Verifikasi:** boot produksi tanpa VAPID → exit non-zero; rotasi kunci → endpoint `GET /api/admin/push/public-key` mengembalikan kunci baru dan FE re-subscribe.

---

### I-011 — Kunci ORS/Google Maps/geocoding hanya env global; tidak ada kuota/circuit per tenant

- **Tipe:** Horizontal (SaaS readiness)
- **Lokasi:** `src/integrations/ors/client.ts:41-58, 103-126`; `src/integrations/google-maps/distance-matrix.client.ts:27-29, 44-63`; `src/integrations/google-maps/geocoding.ts:105-115`
- **Bukti:** Semua membaca `process.env.ORS_API_KEY` / `GOOGLE_MAPS_API_KEY` (bukan kolom tenant). Circuit breaker geocoding global (`geocoding.ts:107-113`), ORS/Maps tanpa breaker (hanya `return null`).
- **Keyakinan:** **TERBUKA**.
- **Framework:** Well-Architected Security/Reliability (shared quota, noisy neighbor).
- **Akar masalah:** Integrasi peta dianggap infrastruktur platform, bukan layanan per tenant; belum ada Confirmation Gate untuk desain ini.
- **FMEA:** S=5 (kuota habis → semua tenant jatuh ke Haversine, estimasi ongkir meleset), O=5, D=7 → **RPN 175**.
- **Collateral damage:** Kunci per tenant butuh kolom terenkripsi + UI + rotasi; LOC besar → **wajib Confirmation Gate** (AGENTS.md) sebelum eksekusi.
- **Rekomendasi:** jangka pendek: metrik pemakaian per tenant + alert kuota 80%; jangka menengah: `TenantIntegrationConfig` untuk kunci peta (opsional, fallback platform), circuit breaker per tenant.
- **Verifikasi:** simulasi 429 dari ORS → tenant lain tetap mendapat ORS (bukan global open circuit); metrik `maps_requests_total{tenant}`.

---

## 5. Tabel Ringkas Temuan (untuk tiket)

| ID | Judul singkat | Severity | RPN | Bukti utama |
|---|---|---|---:|---|
| I-001 | Backup tidak terenkripsi + seluruh DB ke Drive tenant | KRITIS | 560 | `backup.service.ts:63,145-147`; `google-drive/client.ts:68-77` |
| W-001 | Turn macet tidak di-replay (boot-only + filter 2 menit) | TINGGI | 405 | `app.ts:306-311`; `turn.repository.ts:55` |
| W-002 | `setLabelFlags` tanpa tenant → default-tenant | TINGGI | 360 | `webhook.route.ts:55-58,972,1424`; `customer.service.ts:167` |
| W-005 | Pre-log → enqueue non-atomik + buffer burst RAM | TINGGI | 324 | `webhook.route.ts:1531-1571`; `burst-coalesce.service.ts:131-164` |
| W-004 | Cache cut-off tanpa TTL/lintas proses | TINGGI | 320 | `whatsapp-provider.service.ts:26-45` |
| I-006 | Calendar tidak tenant-aware & tanpa idempotensi | TINGGI | 294 | `google-calendar.service.ts:13-20,84-88` |
| W-003 | Webhook pakai `wahaClient` global | TINGGI | 288 | `webhook.route.ts:8,738,804-810` |
| I-003 | Outbox Sheets tanpa claim/lease | TINGGI | 280 | `sheets-sync.service.ts:531-543`; `sheets-client.ts:188-212` |
| I-002 | Restore lintas tenant tanpa validasi | TINGGI | 216 | `backup.service.ts:442-472` |
| I-004 | `ensureMonthlyTab` clear setelah race | TINGGI | 216 | `sheets-client.ts:145-178` |
| I-005 | Tahun Sheets gagal tanpa alert; metrik salah | SEDANG | 210 | `sheets-sync.service.ts:200-214` |
| W-007 | Media WABA non-gambar & auth header | SEDANG | 192 | `waba-webhook.route.ts:173-207` |
| I-007 | Contacts tanpa outbox + lookup tanpa tenant | SEDANG | 192 | `google-contacts.service.ts:373-382` |
| W-006 | Burst coalescing single-process | SEDANG | 189 | `burst-coalesce.service.ts:62` |
| I-008 | Telegram tanpa timeout/retry/429 | SEDANG | 216 | `telegram.service.ts:125-129` |
| I-009 | Log notifikasi tidak update saat resend | SEDANG | 105 | `notification-delivery.service.ts:240-256` |
| I-011 | Kunci peta env-only, tanpa kuota per tenant | SEDANG | 175 | `ors/client.ts:48`; `distance-matrix.client.ts:44` |
| I-010 | VAPID ephemeral | SEDANG | 168 | `web-push.service.ts:80-93` |
| W-009 | Cache tenant WABA tanpa TTL | SEDANG | 162 | `waba-tenant.service.ts:8,20-21` |
| W-008 | Status WABA unknown tenant → 500 | SEDANG | 144 | `waba-webhook.route.ts:90` |
| W-010 | Humanizer hardcode frasa bisnis | RENDAH | 120 | `typing.service.ts:155-168` |
| W-011 | WAHA `sendTemplateMessage` literal | RENDAH | 108 | `waha.driver.ts:199-206` |

---

## 6. Rencana Perbaikan Berurutan

Urutan berdasarkan **risiko × ketergantungan**. Setiap fase wajib ditutup gerbang regresi: `npm run build` + suite relevan + full suite tanpa failure baru (failure yang diklaim pre-existing wajib dibuktikan revert-and-rerun).

### Fase 0 — Pengamanan segera (0–2 hari, tanpa migrasi)

1. **I-001 (mitigasi sementara):** hentikan upload Drive otomatis (`ENABLE_WEEKLY_BACKUP=false` atau guard `BACKUP_UPLOAD_ENABLED=false`) sampai enkripsi tersedia; hapus/unduh file `.sql.gz` lama dari Drive setelah backup terenkripsi pertama.
2. **W-004:** turunkan TTL cache cut-off menjadi 5 dtk (satu baris) atau paksa `setOutboundCutOff` menulis Redis key yang dibaca semua proses.
3. **W-002:** teruskan `resolvedTenantId` pada tiga call-site `setLabelFlags` (perubahan minimal, test baru).
- **Rollback:** flag env / revert commit kecil; tidak ada perubahan data.
- **Gate:** test `webhook-echo-tenant`, `waha-cutoff`, build.

### Fase 1 — Durabilitas ingress (3–5 hari, migrasi kecil)

1. **W-005:** balik urutan menjadi `persistInbound → enqueue → logMessage`; dedupe membaca `InboundTurn.status`; hapus `catch {}`.
2. **W-001:** cron `turnRecovery` 1–2 menit + klaim atomik (`claimed_at`; tambah kolom bila perlu) + alarm stuck.
3. **W-003:** resolve `WahaClient` per tenant di webhook (media/LID/label) + invariant test rg.
- **Rollback:** migrasi aditif (`claimed_at` nullable) → aman; jobId unik mencegah dobel.
- **Gate:** test baru crash-restart, dua-tenant, media; full suite.
- **Pre-mortem:** replay ganda → pastikan `claimForProcessing` + `markStatus` idempoten sebelum mengaktifkan cron.

### Fase 2 — Integrasi eksternal fondasional (1–2 minggu)

1. **I-001 penuh:** enkripsi AES-256-GCM + manifest + kunci wajib di produksi + folder per tenant.
2. **I-002:** validasi `meta.tenantId` + rewrite tenant eksplisit + audit.
3. **I-003/I-004/I-005:** claim/lease outbox, lock pembuatan tab, alert tahun belum dipetakan, pisahkan metrik.
4. **I-006:** migrasi Calendar ke OAuth per tenant (Confirmation Gate bila perlu re-consent) + idempotensi `privateExtendedProperty`.
5. **I-007/I-008/I-009:** outbox Contacts, `telegramFetch` tunggal, upsert log notifikasi.

### Fase 3 — Hardening & observability (1 minggu)

1. **W-006:** Redis debounce atau guard single-replica.
2. **W-007/W-008/W-009:** helper unduh WABA bersama, status 200 + dead-letter, TTL cache tenant.
3. **I-010/I-011:** VAPID wajib env + metrik push; metrik kuota peta per tenant (desain per-tenant via Confirmation Gate).
4. **W-010:** `messageKind` terstruktur; **W-011:** fail-closed template WAHA.

### Urutan rollback & risiko

| Fase | Risiko utama | Rollback |
|---|---|---|
| 0 | Backup otomatis berhenti (kehilangan RPO) | Nyalakan kembali setelah enkripsi siap; jalankan backup manual |
| 1 | Balasan ganda bila replay salah | Matikan cron, revert urutan, jobId dedupe |
| 2 | Restore lama tidak kompatibel dengan file terenkripsi | Simpan jalur decrypt; dokumentasi operator |
| 3 | Perubahan template/format | Feature flag per bagian |

---

## 7. Batasan & Asumsi

### 7.1 Asumsi `[ASUMSI]`

1. `[ASUMSI]` Produksi saat ini **single tenant** (`default-tenant`) dan satu container `app`, sehingga temuan multi-tenant (W-002, W-003, W-009, I-002, I-006) belum berdampak nyata — tetapi menjadi blocker SaaS.
2. `[ASUMSI]` `WAHA_SESSION` tenant default sama dengan session yang dipakai `wahaClient` global; bila tidak, W-003 berdampak bahkan pada tenant default.
3. `[ASUMSI]` Drive backup benar-benar aktif di produksi (butuh integrasi Google tenant + cron Senin 02:00). Bila tidak, O pada I-001 turun drastis.
4. `[ASUMSI]` Meta mewajibkan `Authorization: Bearer` pada unduhan URL media (W-007). Ini perlu verifikasi live sebelum diperbaiki sebagai bug.
5. `[ASUMSI]` `TELEGRAM_BOT_TOKEN` global tersedia; bila tidak, banyak alert hanya `console` (tidak diverifikasi).
6. `[ASUMSI]` Tidak ada replika `app` ganda saat ini (W-006).

### 7.2 Tidak diperiksa / tidak dapat dibuktikan

- Bukti empiris produksi: tidak ada log webhook, log LLM, `docker logs`, atau query DB.
- Perilaku WAHA `:noweb-2026.7.2` terhadap 429/retry webhook (tidak diuji).
- Konfigurasi WAHA `webhooks.retries` dan event subscription aktual (hanya kode `syncSessionWebhooks`).
- Isi `storage/vapid_keys.json`, keberadaan `VAPID_*`, `BACKUP_*`, `ORS_API_KEY` (nilai tidak dibaca).
- Kualitas data nyata: berapa banyak pesan tanpa balasan, berapa baris Sheets ganda, apakah ada file backup di Drive.
- `packages/admin-dashboard` dan endpoint admin yang memicu integrasi (hanya sisi service).
- LLM gateway/failover (9.7) dan seluruh Modul 4/6.

### 7.3 Catatan kepatuhan audit

- Audit ini **tidak mengubah** kode/test/config/`.env`, tidak menjalankan server, tidak menulis DB, tidak memanggil WAHA/Meta/Telegram/Google.
- Temuan lama tidak diduplikasi; rujukan ID diberikan (§3).
- Setiap temuan memiliki `file:line`; yang belum terbukti diberi label keyakinan dan `[ASUMSI]`.
- Sesuai AGENTS.md, rekomendasi menyentuh lapisan fondasional (urutan persist/enqueue, state machine turn, claim outbox, kunci enkripsi, tenant-scoped query), bukan penambahan teks larangan atau regex per kasus.

---

## 8. Lampiran — Peta Alur yang Diaudit

```
WAHA ──POST /webhook──► [secret check] ─► [tenant resolve] ─► [event branch: label/ack/revoke/reaction/edit]
                                                        └─► [fromMe outbound echo] ─► dedupe ─► log/attach
                                                        └─► [inbound] ─► dedupe(DB) ─► media ─► stale guard
                                                                     ─► bypass/blocked/scope gate
                                                                     ─► GPS ingest choke point
                                                                     ─► burst coalesce (RAM) ─► pre-log ─► turn persist ─► queue(BullMQ|RAM)
                                                                                                                        └─► worker ─► stateMachine ─► typingService ─► WAHA/WABA
Meta ──POST /api/webhook/waba──► [HMAC rawBody] ─► [statuses loop] ─► [messages normalize] ─► [tenant per phone_number_id]
                                                                  ─► [reaction] ─► [dedupe] ─► [media image] ─► [stale] ─► [bypass/GPS/scope]
                                                                  ─► [burst coalesce] ─► [turn persist] ─► [queue]

Reservasi completed ─► SheetsSyncService.enqueue ─► sheets_sync_outbox ─► cron 3 mnt ─► processOutbox ─► Google Sheets
Cron Senin 02:00 ─► backupService.createDatabaseDump ─► gzip ─► uploadToGoogleDrive (TANPA enkripsi)
Reservasi ─► googleCalendarService.createEvent ─► Calendar API (service account global)
Customer ─► googleContactsService.syncCustomer ─► People API (OAuth per tenant)
Alert/Report ─► telegramService.sendMessage / alertService.notifyAlert ─► Bot API
Admin/Staff ─► webPushService.sendPushToRole ─► Push service (VAPID)
Delivery ─► orsClient ─► googleDistanceClient ─► Haversine (fallback berlapis)
```

**Akhir laporan.**
