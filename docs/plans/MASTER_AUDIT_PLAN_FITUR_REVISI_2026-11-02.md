# Master Implementation Plan — Audit Menyeluruh Fitur Sistem (REVISI v2)

> **Status:** DRAFT v2 — menunggu konfirmasi eksekusi eksplisit dari pengguna.
> **Tanggal:** 2026-11-02
> **Menggantikan:** draf v1 "Master Implementation Plan: Audit Menyeluruh Fitur Sistem Satu per Satu" (draf chat, tanpa file).
> **Dasar audit plan v1:** hasil audit read-only 2026-11-02 (15 temuan, lihat §B).
> **Dokumen rujukan cakupan:** `docs/FEATURE_INVENTORY.md` (akan diregenerasi di Fase 0).
> **Commit baseline:** `d06c90f1` (= `origin/master`; sinkronisasi server live **belum terbukti**, diverifikasi di Fase 0).

---

## A. Fakta Terverifikasi (dasar seluruh plan ini)

Semua angka di bawah diambil dari kode di commit `d06c90f1`, bukan dari ingatan/dokumen lama.

| # | Fakta | Bukti (`file:line`) | Implikasi ke Plan |
|---|---|---|---|
| F-01 | Boot memuat katalog, tier ongkir, persona, AI config, AI scope untuk **semua tenant** | `src/app.ts:217-248` | Klaim v1 akurat; tetap diaudit di Fase 1 |
| F-02 | Rate limit global `max=1000` (prod) / `100` (test); hanya `/events` & `/stream` di-`allowList`; webhook hanya dipisah **bucket key**, bukan kuota lebih tinggi | `src/app.ts:136-164` | Klaim v1 "kuota khusus IP webhook" **salah**; audit harus menulis "bucket terpisah, kuota sama" |
| F-03 | Kompresi `threshold=1024`, `br/gzip/deflate` | `src/app.ts:130-133` | Akurat |
| F-04 | Urutan shutdown: `clearAllIntervals` → `server.close` → flush burst → `queueService.close` → flush LLM audit buffer → flush JSONL → `prisma.$disconnect` | `src/lifecycle/shutdown.ts:42,49,56,63,71,79,86` | Deskripsi v1 tidak lengkap |
| F-05 | `parallel_tool_calls: false` hanya ada di **Call 2 Generator**, bukan Call 1 Router | `src/v3/agent/pipeline/generation-stage.ts:657,793`; `router-tool-routing.layer.ts` tidak memuatnya | Fase 3 harus mengaudit **kedua** jalur, bukan mengasumsikan |
| F-06 | Registri 6 tool kanonis | `src/v3/tools/tool-registry.ts:8-15` | Akurat |
| F-07 | Guardrails: **5 file** di `src/v3/guardrails/` + **4 gerbang** di `src/v3/agent/pipeline/`; eksekusi terpusat di `guardrail-pipeline.ts` | `src/v3/guardrails/` (5 file), `src/v3/agent/pipeline/` (11 file) | Path di inventaris v1 salah untuk 4 guard |
| F-08 | `sheets-sync.service.ts` ada di `src/services/sheets/` | `src/services/sheets/sheets-sync.service.ts` | Path inventaris v1 salah |
| F-09 | Prisma memiliki **47 model** & 16 enum | `prisma/schema.prisma` | Inventaris v1 (43) drift; 4 model baru: `InboundTurn`, `OutboundAttempt`, `TenantSheetsConfig`, `SheetsSyncOutbox` |
| F-10 | Ada **343 deklarasi route** (method+path literal) di `src/routes` + `src/app.ts`; inventaris menulis 117 | skrip hitung 2026-11-02 | Angka 117 tidak boleh dipakai sebagai DoD; Fase 0 regenerasi dari `app.printRoutes()` |
| F-11 | `BURST_COALESCE_MS=7500` (bukan 2,5 detik); komentar file menyatakan default nonaktif `0` namun kode default `7500` | `src/services/burst-coalesce.service.ts:24,69`; `.env` | Kontradiksi kode vs komentar; audit wajib mengukur nilai efektif |
| F-12 | Humanisasi di `.env` menyimpang jauh dari default "manusiawi": `WPM=500` (kode memperingatkan >55), `reaction=100ms`, `max typing=700ms`, `reading max=300ms` | `src/services/typing.service.ts:101-110`; `.env` | Klaim "delay proporsional manusiawi" **tidak terbukti**; wajib diukur |
| F-13 | 5 worker default **MATI** (butuh flag `true`): label reconciliation, shareloc reminder, AI eval, chat export, follow-up worker; `SEPARATE_WORKER` tidak ada di `.env` lokal | `src/lifecycle/background-crons.ts:22,152,233,243,288`; `.env` | Audit per cron wajib 4 kolom: terdaftar/aktif/bukti run/idempotensi |
| F-14 | `npm run check:design` hanya ada di `packages/admin-dashboard`, tidak di root | `package.json` (root) vs `packages/admin-dashboard/package.json` | Gate Fase 6 wajib `cd packages/admin-dashboard` |
| F-15 | File test yang disebut v1 tidak ada; nama riil berbeda (lihat §E gate tiap fase) | `tests/**` (752 file test) | Gate wajib memakai daftar riil |
| F-16 | Baseline suite bukan hijau: 22 gagal pre-existing & flaky 22–23 pada commit sama | `docs/KNOWN_ISSUES.md` #287 | DoD "full suite hijau" diganti **baseline-diff** (§D) |
| F-17 | Log LLM bernama `logs/llm-YYYY-MM-DD.jsonl`; file `logs/llm-execution.jsonl` tidak ada; log terbaru 2026-10-06 | `logs/` | Gerbang bukti mesin wajib glob + filter umur; tanpa log ≤48 jam = celah cakupan |
| F-18 | `typecheck` = `tsc --noEmit` (read-only); `security:scan` = `tsx scripts/scan-secrets.ts` | `package.json` | Dipakai sebagai gerbang tanpa menulis `dist/` |
| F-19 | Temuan lama relevan: #294 OPEN-LOW, #291 OPEN-LOW, #288 OPEN-MEDIUM, #287 OPEN-MEDIUM, #286 OPEN-HIGH | `docs/KNOWN_ISSUES.md` | Wajib dirujuk, bukan diduplikasi |

---

## B. Perubahan dari Plan v1 (jejak audit → perbaikan)

| Temuan audit v1 | Perbaikan di v2 |
|---|---|
| A-001 8 file test tidak ada | Semua gate memakai daftar test riil (§E) |
| A-002 `check:design` salah folder | Gate Fase 6: `cd packages/admin-dashboard && npm run check:design` + grep gate native dialog |
| A-003 "full suite hijau" mustahil | Diganti mekanisme **baseline-diff** (§D) |
| A-004 inventaris drift | Fase 0 wajib **regenerasi inventaris dari kode** sebelum audit fitur |
| A-005 cron mati bisa hijau | Kriteria cron 4 kolom + bukti run 7 hari (§E Fase 8) |
| A-006 premis burst/typing salah | Fase 2 mengukur **nilai efektif env**, bukan default kode |
| A-007 `parallel_tool_calls` salah lapisan | Fase 3 memeriksa Call 1 **dan** Call 2 secara terpisah |
| A-008 "read-only" vs uji live | **Protokol Keselamatan Audit** wajib (§C) |
| A-009 path log salah/basi | Gerbang bukti memakai glob + umur log (§D) |
| A-010 tanpa RTM/kriteria lulus | Setiap tugas punya **ID + kriteria PASS/FAIL + bukti**; RTM di §F |
| A-011 celah keamanan/DB/privacy | Fase 11 baru: Keamanan & Ketahanan |
| A-012 konfirmasi per fitur tak realistis | Konfirmasi pengguna hanya untuk fitur berdampak klinis/bisnis (§H) |
| A-013 FMEA rencana tidak lengkap | Register risiko audit diperluas (§G) |
| A-014 lupa KNOWN_ISSUES | DoD mewajibkan update `KNOWN_ISSUES.md` |
| A-015 klaim server/teknis lain | Semua klaim diverifikasi dengan perintah; server live = Fase 0.6 |

---

## C. Protokol Keselamatan Audit (WAJIB, sebelum fase apa pun)

### C.1 Pemisahan mode kerja

| Mode | Boleh melakukan | Larangan |
|---|---|---|
| **M1 — Audit statis (default)** | baca kode, grep, hitung, jalankan unit test offline | menjalankan server dev, menulis DB, mengirim WhatsApp |
| **M2 — Bangku uji terisolasi** | jalankan server dengan `WAHA_MOCK=true`, DB uji/offline, chat sandbox | memakai `.env` produksi, mengirim pesan ke nomor nyata |
| **M3 — Inspeksi server live (read-only)** | `git rev-parse`, `docker ps/logs`, query `SELECT` | restart container, deploy, tulis DB, panggil WAHA |

### C.2 Aturan keras

1. `WAHA_MOCK=false` **dilarang** dipakai untuk simulasi chat apa pun. Gunakan salinan `.env.audit` dengan `WAHA_MOCK=true`.
2. Semua chat uji wajib `Customer.is_sandbox_test = true` (QA TEST) dan dibersihkan via `/api/admin/sandbox/cleanup`.
3. Dilarang: `wahaClient.addLabel/removeLabel`, restart container WAHA, `prisma migrate dev`, `prisma generate --no-engine`, skrip destruktif tanpa `--confirm`, deploy.
4. Tindakan yang menyentuh WAHA/Meta = **2-step verification + WARNING tertulis**; tindakan aman = 1-step.
5. Bila tidak ada bukti, tulis **celah cakupan** — dilarang menyimpulkan "PASS" dari asumsi.

### C.3 Checklist pra-fase (ditandatangani di laporan fase)

- [ ] Mode kerja ditetapkan (M1/M2/M3)
- [ ] `WAHA_MOCK` sesuai mode
- [ ] DB target = offline/uji (bukan produksi)
- [ ] Daftar perintah terlarang dipahami
- [ ] Artefak bukti disiapkan (`docs/audit/2026-11-02/fase-XX/`)

---

## D. Mekanisme Gerbang Regresi (pengganti "full suite hijau")

### D.1 Baseline sekali di Fase 0

```powershell
New-Item -ItemType Directory -Force docs\audit\2026-11-02 | Out-Null
npx vitest run --reporter=json --outputFile=docs\audit\2026-11-02\baseline.json
```

Catat: daftar **nama lengkap test yang gagal** (bukan hanya angka). Verifikasi terhadap #287 (10 file / 22 test; flaky 22–23). Bila berbeda, jalankan ulang 2× dan simpan ketiga hasil sebagai `baseline-run1/2/3.json`.

### D.2 Setiap fase

```powershell
npx vitest run <daftar-file-fase> --reporter=json --outputFile=docs\audit\2026-11-02\fase-XX.json
```

**PASS** bila: (a) semua test fase hijau; **atau** (b) kegagalan yang tersisa **namanya ada di baseline** dan dibuktikan lewat *revert-and-rerun*.

### D.3 Gerbang penutupan

Bandingkan `after.json` vs `baseline.json` dengan skrip pembanding nama test:
- PASS: `gagal(after) ⊆ gagal(baseline)` — tidak ada nama test baru.
- FAIL: ada nama test baru, meskipun total angka turun.

> Skrip `scripts/audit-baseline-diff.mjs` (dibuat di Fase 0) hanya membandingkan `fullName` test yang gagal. Tanpa dependency baru (Node `fs`).

### D.4 Gerbang tipe & keamanan

```powershell
npm run typecheck        # read-only, pengganti `npm run build`
npm run security:scan    # scan-secrets
```

`npm run build` hanya dijalankan di Fase 12 (bila diperlukan) karena menulis `dist/`.

---

## E. Fase Audit (0–12) — Tugas Mikro, Kriteria Lulus, Gerbang

> Format tiap tugas: **ID · Lokasi · Yang diperiksa · Kriteria PASS · Bukti**.
> Status yang diizinkan: `PASS`, `FAIL`, `PARSIAL`, `N/A (alasan)`, `CELAH CAKUPAN`.

---

### FASE 0 — Baseline, Keselamatan, Regenerasi Inventaris

**Tujuan:** memastikan fondasi audit benar sebelum menyentuh fitur. Tidak ada kesimpulan fitur di fase ini.

**0.1 — Regenerasi inventaris dari kode**
- Lokasi: `src/app.ts`, `prisma/schema.prisma`, `src/lifecycle/background-crons.ts`, `src/routes/**`
- Buat `scripts/audit-inventory-report.mjs` (Fase eksekusi): panggil `buildApp()` + `app.printRoutes()` (dengan env uji), hitung model via regex `^model\s+\w+`, hitung worker via deklarasi di `background-crons.ts`. Skrip ini adalah **tooling audit non-runtime** (tidak diimpor aplikasi) sehingga tidak melanggar aturan "tanpa perubahan kode produksi".
- **PASS:** angka & path di `docs/FEATURE_INVENTORY.md` 100% cocok dengan hasil skrip; setiap path di tabel lolos `Test-Path`.
- **Bukti:** `docs/audit/2026-11-02/fase-00/inventory-report.json` + diff dokumen.

**0.2 — Baseline test & flaky**
- Jalankan §D.1; rekonsiliasi dengan #287.
- **PASS:** baseline tersimpan, daftar file/test gagal identik dengan #287 atau perbedaannya dijelaskan.
- **Bukti:** `baseline.json`, `baseline-run2.json`.

**0.3 — Verifikasi environment**
- `node -v`, `npm -v`, `npm run typecheck`, `npx prisma validate`.
- **PASS:** typecheck exit 0; skema valid; tidak ada `migrate dev`.
- **Bukti:** output perintah.

**0.4 — Protokol keselamatan**
- Terapkan §C; siapkan `.env.audit` (mock) dan daftar perintah terlarang.
- **PASS:** checklist §C.3 terisi; `WAHA_MOCK` sesuai mode.

**0.5 — Rekonsiliasi temuan lama**
- Baca `docs/KNOWN_ISSUES.md` #287, #291, #294, #288, #286; klasifikasikan `SELESAI/MASIH TERBUKA/PERLU VERIFIKASI`.
- **PASS:** tabel status terisi; tidak ada temuan lama yang dihapus/diduplikasi.

**0.6 — Sinkronisasi server live (M3, read-only)**
- `ssh <host> "cd <repo> && git rev-parse --short HEAD && docker ps --format '{{.Names}} {{.Status}}'"`
- **PASS:** hash server == `d06c90f1`; bila beda → catat sebagai temuan, **jangan deploy**.
- **Bukti:** output SSH (tanpa kredensial).

**Gerbang Fase 0:** semua artefak ada; `npm run typecheck` exit 0; inventaris tervalidasi.

---

### FASE 1 — Arsitektur Inti, Multi-Tenant, Lifecycle

**1.1 Isolasi tenant**
- Lokasi: `src/config/tenant.ts`, `src/repositories/**`, `src/services/**`, `src/routes/admin/**`, `src/routes/staff/**`.
- Periksa: setiap query ke model ber-tenant menyertakan `tenantId` (atau alasan global yang terdokumentasi).
- **PASS:** 0 query lintas-tenant tanpa filter pada sampel ≥20 query; temuan dicatat `file:line`.
- **Bukti:** hasil grep + tabel sampel.

**1.2 Boot data-driven**
- Lokasi: `src/app.ts:217-248`.
- **PASS:** 5 jenis config dimuat per tenant (katalog, tier, persona, AI model, AI scope); fallback DB-offline menghasilkan peringatan eksplisit.
- **Bukti:** log boot + `loadServicesFromDb` dsb.

**1.3 Pemisahan worker**
- Lokasi: `src/worker.ts`, `src/lifecycle/background-crons.ts`.
- **PASS:** server live memakai `SEPARATE_WORKER=true` **atau** ada keputusan tertulis memakai monolith + alasan beban.
- **Bukti:** `docker exec ... printenv SEPARATE_WORKER`; log worker.

**1.4 Graceful shutdown**
- Lokasi: `src/lifecycle/shutdown.ts:42-89`.
- **PASS:** urutan 7 tahap terverifikasi; tidak ada query baru setelah cron berhenti; `prisma.$disconnect` terakhir.
- **Bukti:** `lifecycle-shutdown.test.ts` + pembacaan kode.

**1.5 Kompresi & rate limit**
- **PASS:** `threshold=1024`; SSE bypass; webhook hanya bucket terpisah **dengan kuota sama (1000/menit)** — ditulis apa adanya.
- **Bukti:** `src/app.ts:130-164` + uji 429.

**1.6 Forensik auth & log buffer**
- **PASS:** 401/503 tercatat JSON tanpa token penuh; buffer direhidrasi setelah restart.
- **Bukti:** `auth-access-log.test.ts`, `log-buffer.test.ts`.

**Gerbang Fase 1:**
```powershell
npx vitest run tests/unit/tenant-failclosed.test.ts tests/unit/tenant-resolve-failclosed.test.ts tests/unit/lifecycle-shutdown.test.ts tests/unit/lifecycle-interval-registry.test.ts tests/unit/auth-access-log.test.ts tests/unit/log-buffer.test.ts tests/unit/queue.test.ts
```

---

### FASE 2 — WhatsApp Gateway & Ingestion

**2.1 Abstraksi driver**
- `waha.driver.ts`, `waba.driver.ts`, `src/integrations/whatsapp/index.ts`; pastikan pemakaian lewat gateway, bukan `WahaClient` langsung.
- **PASS:** 0 pemanggilan `WahaClient` langsung dari route/service domain (kecuali gateway).

**2.2 Webhook & HMAC**
- `POST /webhook`, `GET|POST /api/webhook/waba`; `verifyMetaSignature`.
- **PASS:** signature salah → 401; challenge GET benar; event duplikat tidak diproses dua kali.
- **Bukti:** `webhook-security.test.ts`, `waba-webhook-route.test.ts`, `webhook-stale-message-guard.test.ts`.

**2.3 Anti-burst coalescing (nilai efektif)**
- **PASS:** nilai `BURST_COALESCE_MS` efektif dilaporkan apa adanya (kini 7500 ms); perilaku 3 pesan → 1 konteks terbukti lewat test; kontradiksi komentar `:24` vs kode `:69` dicatat.
- **Bukti:** `burst-coalesce.test.ts` + screenshot nilai env.

**2.4 Idempotensi turn**
- `InboundTurn`, `OutboundAttempt`, `turn-recovery.service.ts`.
- **PASS:** retry webhook yang sama → 0 pemrosesan ganda; hash payload tersimpan.
- **Bukti:** `turn-recovery.test.ts`, `turn-repository-claim.test.ts`.

**2.5 Kill-switch & opt-out**
- **PASS:** kill-switch per tenant memutus outbound; kata kunci opt-out menghentikan follow-up; konfirmasi keluar terkirim.
- **Bukti:** `waba-template-consent-optout.test.ts` + state DB sandbox.

**2.6 Typing humanization (nilai efektif)**
- **PASS:** laporkan `WPM`, `reaction`, `max typing`, `reading max` efektif; bila WPM > 55 → **FAIL realisme** (bukan PASS), dengan bukti delay terukur.
- **Bukti:** `typing.test.ts`, `typing-sync.test.ts`, `typing-transport.test.ts` + pengukuran 10 balasan.

**Gerbang Fase 2:**
```powershell
npx vitest run tests/unit/typing.test.ts tests/unit/typing-sync.test.ts tests/unit/typing-transport.test.ts tests/unit/burst-coalesce.test.ts tests/unit/turn-recovery.test.ts tests/unit/turn-repository-claim.test.ts tests/unit/webhook-security.test.ts tests/unit/webhook-stale-message-guard.test.ts tests/unit/waba-driver-and-webhook.test.ts tests/unit/waba-template-consent-optout.test.ts tests/unit/waha-retry.test.ts
```

---

### FASE 3 — Conversational AI Engine (V3)

**3.1 Arsitektur 2 tahap**
- Periksa Call 1 (`src/v3/agent/prompt/phases/router-tool-routing.layer.ts`) **dan** Call 2 (`generation-stage.ts:657`).
- **PASS:** `parallel_tool_calls:false` terbukti di jalur yang benar; bila Call 1 tidak memilikinya → catat **gap**, jangan asumsikan aman.
- **Bukti:** payload aktual dari `logs/llm-*.jsonl`.

**3.2 Dynamic tool masking fisik**
- `src/v3/tools/tool-masker.ts`.
- **PASS:** `save_reservation` tidak ada di schema saat belum final; `calculate_delivery` tidak ada tanpa entitas lokasi baru; dibuktikan dari payload, bukan hanya unit test.
- **Bukti:** `tool-masker.test.ts`, `tests/unit/v3/tool-masking-enforce.test.ts`, `tests/unit/v3-save-masker-rawtext.test.ts`.

**3.3 Enam tool kanonis**
- `tool-registry.ts:8-15`.
- **PASS:** tiap tool punya skema, eksekutor, dan bukti grounding; clinical dominance pada `get_catalog`; `save_reservation` hanya setelah komitmen user.
- **Bukti:** `tests/v3/agent-tools.test.ts`, `get-catalog-tool-grounding.test.ts`, `v3-booking-commit-session-614425.test.ts`.

**3.4 Guardrails deterministik (9 gerbang)**
- 5 di `src/v3/guardrails/` + 4 di `src/v3/agent/pipeline/`; eksekusi di `guardrail-pipeline.ts`.
- **PASS:** setiap gerbang diuji dengan input adversarial **baru** (bukan kalimat yang sudah ada di test); gerbang terbukti memblokir.
- **Bukti:** `tests/unit/v3/guardrail-pipeline.test.ts`, `tests/unit/v3/numeric-guardrail-no-tool-bypass.test.ts`, `tests/unit/v3-safety-sanitizer.test.ts`, `tests/integration/deterministic-guardrails-session-391501.test.ts`.

**3.5 Kepatuhan aturan persona**
- **PASS:** 21 aturan dipetakan ke rubrik terukur (bukan opini); minimal 1 bukti per aturan; pelanggaran diberi tingkat Kritis/Tinggi/Sedang/Minor.
- **Bukti:** `tests/unit/v3-persona-rules.test.ts`, `tests/unit/persona-rubric.test.ts`.

**Gerbang Fase 3:**
```powershell
npx vitest run tests/unit/v3/guardrail-pipeline.test.ts tests/unit/tool-masker.test.ts tests/unit/tool-schemas.test.ts tests/v3/agent-tools.test.ts tests/unit/get-catalog-tool-grounding.test.ts tests/unit/v3-safety-sanitizer.test.ts tests/unit/v3-persona-rules.test.ts tests/unit/v3/numeric-guardrail-no-tool-bypass.test.ts tests/unit/v3/tool-masking-enforce.test.ts tests/integration/deterministic-guardrails-session-391501.test.ts
```

---

### FASE 4 — Reservasi & Operasional Homecare

**4.1 Matriks transisi status**
- Bandingkan klaim `HOLD→CONFIRMED→DISPATCHED→ARRIVED→COMPLETED/CANCELLED` dengan `src/domain/reservation-status.ts` & `prisma/schema.prisma` (status = String, bukan enum DB).
- **PASS:** matriks transisi legal/ilegal terverifikasi; transisi ilegal ditolak.
- **Bukti:** `reservation-lifecycle-homonym-gate.test.ts`.

**4.2 Endpoint reservasi**
- `/api/admin/reservations`, `/daily-slots`, `/reservation/parse`, `/quick-hold`, `/assign-staff`, `/set-date`, `/bulk-complete`, `/proof`, `/approve-purchase`, `/archive`, `/restore`.
- **PASS:** setiap endpoint ada, terotorisasi, dan berperilaku sesuai kontrak (status code + shape).
- **Bukti:** `active-reservations-endpoint.test.ts`, `admin-reservation-detail-payment-eval.test.ts`.

**4.3 Hold & sweep**
- **PASS:** hold kedaluwarsa dibatalkan cron; tidak ada slot menggantung; idempotensi aman.
- **Bukti:** `cron_auto_purge.test.ts` + query DB sandbox.

**4.4 Penugasan & reschedule**
- **PASS:** audit trail tercatat; notifikasi terkirim; reassign tidak menghilangkan histori.

**4.5 Bukti bayar & moderasi**
- **PASS:** upload/approve/reject sesuai nominal; mismatch ditolak.
- **Bukti:** `customer-payment-proof.test.ts`, `payment-proof-adapter.test.ts`.

**4.6 Arsip 60 hari & restore**
- **PASS:** delete = arsip; restore mengembalikan utuh; purge >60 hari; #292 tetap tertutup.
- **Bukti:** `tests/integration/reservation-archive.test.ts`, `destructive-guard.test.ts`.

**4.7 Bentrok jadwal**
- **PASS:** overlap terdeteksi sebagai peringatan (bukan blokir); 0 false negative pada 5 skenario.
- **Bukti:** `slot-overlap-sweep.test.ts`.

**4.8 Series**
- **PASS:** pause/resume/cancel/reschedule per sesi; relasi `ReservationSeries` utuh.

**Gerbang Fase 4:**
```powershell
npx vitest run tests/integration/reservation-archive.test.ts tests/unit/slot-overlap-sweep.test.ts tests/unit/destructive-guard.test.ts tests/unit/cron_auto_purge.test.ts tests/integration/active-reservations-endpoint.test.ts tests/unit/reservation-lifecycle-homonym-gate.test.ts tests/unit/customer-payment-proof.test.ts
```

---

### FASE 5 — Web App Staf / Bidan Mobile

**5.1 Auth staf terpisah**
- **PASS:** cookie `staff_session` HttpOnly; `Secure` di produksi; `SameSite` sesuai; isolasi role Therapist vs Admin; logout menghapus sesi.
- **Bukti:** `staff-auth-and-reservation.test.ts`, `staff-session-store.test.ts`, `unified-login.test.ts`.

**5.2 Dashboard tugas**
- **PASS:** `today-tasks`, `upcoming-schedule`, `completed-tasks` mengembalikan data benar + filter aktif.
- **Bukti:** `staff-active-filter.test.ts`, `staff-routes.test.ts`.

**5.3 Live chat lapangan**
- **PASS:** kirim/terima, SSE, edit/unsend; PII dimasker.
- **Bukti:** `staff-chat-pii-masker.test.ts`, `staff-chat-cutoff-notification.test.ts`.

**5.4 OTW/arrive/GPS**
- **PASS:** template DB-driven; ETA tercatat; auto-close berjalan; guard jarak/waktu benar.
- **Bukti:** `staff-trip-tracking.test.ts`, `staff-trip-auto-close.test.ts`, `otw-depart-endpoint.test.ts` (perhatikan `staff-otw-chat-poison.test.ts` termasuk baseline gagal #287).

**5.5 Penagihan lapangan**
- **PASS:** info rekening/QRIS terkirim dari template DB; pembayaran tercatat.
- **Bukti:** `staff-send-payment-info.test.ts`.

**5.6 Pairing Telegram**
- **PASS:** token pairing unik, kedaluwarsa, notifikasi terkirim.
- **Bukti:** `staff-telegram-notification.test.ts`.

**5.7 UX mobile**
- **PASS:** pada 375/390/430 px tidak ada overflow horizontal; target sentuh ≥44px; tidak ada dialog native.
- **Bukti:** screenshot 3 viewport + grep `window.confirm|window.alert`.

**Gerbang Fase 5:**
```powershell
npx vitest run tests/unit/staff-auth-and-reservation.test.ts tests/integration/staff-routes.test.ts tests/unit/staff-session-store.test.ts tests/unit/staff-trip-tracking.test.ts tests/unit/staff-trip-auto-close.test.ts tests/unit/staff-send-payment-info.test.ts tests/unit/staff-telegram-notification.test.ts tests/unit/staff-chat-pii-masker.test.ts
```

---

### FASE 6 — Live Chat CS & Hybrid Takeover

**6.1 Inbox & filter**
- **PASS:** filter status/unread MQL/pin bekerja; pagination konsisten.
- **Bukti:** `livechat-total.test.ts`, `live-chat-paged-messages.test.ts`.

**6.2 SSE**
- **PASS:** reconnect otomatis; tidak ada pesan hilang; koneksi panjang tidak kena rate-limit.
- **Bukti:** `tests/integration/live-chat-sse.test.ts`, `livechat-message-loss-prevention.test.ts`.

**6.3 Takeover/release + enrichment**
- **PASS:** takeover mematikan bot (`is_human_handling=true`); release mengembalikan; race condition aman.
- **Bukti:** `tests/integration/live-chat-takeover.test.ts`, `human-handling-race-guard.test.ts`.

**6.4 Multi-media & voice note**
- **PASS:** audio/gambar/PDF terkirim & diputar; akses file terotorisasi.
- **Bukti:** `media-security.test.ts`, `media-route-range.test.ts`.

**6.5 Pin/hide/reaction**
- **PASS:** state tersimpan; reaksi terkirim ke WhatsApp.
- **Bukti:** `live-chat-pin-hide.test.ts`.

**6.6 Copilot & frustration**
- **PASS:** saran tidak halu (grounded); SLA frustrasi memicu alarm.
- **Bukti:** `copilot-grounding.test.ts`, `livechat-notes-frustration.test.ts`.

**6.7 Sinkronisasi riwayat**
- **PASS:** sync-history/sync-full idempoten; profil terbarui.
- **Bukti:** `live-chat-sync-health.test.ts`, `waha-history-sync.test.ts`.

**6.8 Gerbang UI**
```powershell
cd packages\admin-dashboard
npm run check:design
```
Plus grep gate (harus 0 hasil, selain komentar dokumentasi):
```powershell
Select-String -Path packages\admin-dashboard\src\**\*.tsx -Pattern 'window\.(confirm|alert)\('
```

**Gerbang Fase 6:**
```powershell
npx vitest run tests/integration/live-chat-sse.test.ts tests/integration/live-chat-takeover.test.ts tests/unit/live-chat.service.test.ts tests/unit/live-chat-pin-hide.test.ts tests/unit/livechat-message-loss-prevention.test.ts tests/unit/media-security.test.ts tests/unit/live-chat-sync-health.test.ts
```

---

### FASE 7 — Pemasaran, Attribution & Tracking (Meta/CTWA)

**7.1 Landing page**
- **PASS:** `/go`, `/cta`, `/promo/:slug` merender + Pixel/GA terpasang; tidak ada XSS.
- **Bukti:** `landing-crud.test.ts`, `raw_html_security.test.ts`.

**7.2 Tracking beacon**
- **PASS:** click/pageview tercatat; tidak ada preflight blocker; tenant terisolasi.
- **Bukti:** `pageview-tenant.test.ts`, `ad-click.test.ts`.

**7.3 Pricelist cepat**
- **PASS:** render 0-roundtrip; data dari DB.
- **Bukti:** `pricelist-dynamic.test.ts`.

**7.4 CTWA referral & catcher**
- **PASS:** metadata iklan tersimpan; catcher memetakan teks → kampanye; fuzzy match teruji.
- **Bukti:** `waha-ctwa-referral.test.ts`, `tests/integration/admin-ctwa-catchers.test.ts`, `ctwa-fuzzy-attribution-dashboard.test.ts`.

**7.5 CAPI**
- **PASS:** SHA-256 PII; dedup; tenant isolation; sandbox isolation; nilai tidak di-hardcode.
- **Bukti:** `capi-payload-sanitizer.test.ts`, `capi-queue-integrity.test.ts`, `capi-tenant-isolation.test.ts`, `capi-value-no-hardcode.test.ts`.

**7.6 Dashboard & audience**
- **PASS:** metrik konsisten dengan query DB; export ter-hash.
- **Bukti:** `meta-attribution-debug.test.ts`, `customer-audience-export.test.ts`.

**Gerbang Fase 7:**
```powershell
npx vitest run tests/unit/waha-ctwa-referral.test.ts tests/integration/admin-ctwa-catchers.test.ts tests/unit/capi-payload-sanitizer.test.ts tests/integration/capi-queue-integrity.test.ts tests/unit/capi-tenant-isolation.test.ts tests/unit/capi-value-no-hardcode.test.ts tests/integration/ad-click.test.ts tests/integration/pricelist-dynamic.test.ts tests/integration/customer-audience-export.test.ts
```

---

### FASE 8 — Background Crons & Worker (21 pekerja)

**Kriteria baru per cron (wajib 4 kolom):**

| Kolom | Cara membuktikan | PASS |
|---|---|---|
| Terdaftar | baca `background-crons.ts` + log "cron started" | ada |
| Aktif | nilai env efektif di server | `true`/default aktif |
| Bukti run | log/DB 7 hari terakhir | ada jejak |
| Idempotensi | test/query duplikat | tidak dobel |

**Daftar 21 worker & status flag (fakta F-13):**

| Worker | Interval | Flag default | Catatan |
|---|---|---|---|
| Sheets sync | 3 mnt | aktif | boot run |
| Frustration sweep | 5 mnt | aktif | |
| Assignment notif | 2 mnt | aktif | |
| Trip auto-close | 15 mnt | aktif | |
| Slot overlap | 15 mnt | aktif | |
| Shareloc reminder | 15 mnt | **MATI** (`=true`) | wajib dicek |
| Follow-up worker | 15 mnt | **MATI** (`=true`) | wajib dicek |
| Pre-visit brief | 10 mnt | aktif | |
| Expired hold | 6 jam | aktif | |
| Archive purge | 24 jam | aktif | |
| Invariant monitor | 24 jam | aktif | |
| Media cleanup | 24 jam | aktif | |
| Message retention | 24 jam | **MATI** (`=true`) | wajib dicek |
| Staff session | 24 jam | aktif | |
| Label reconciliation | 4 jam | **MATI** (`=true`) | wajib dicek |
| AI eval | 6 jam | **MATI** (`=true`) | wajib dicek |
| Chat export | 6 jam | **MATI** (`=true`) | wajib dicek |
| Nightly watchdog | cek 15 mnt (target 21:00) | aktif | per tenant |
| Daily ops report | cek 30 mnt (target 07:00) | per tenant/env | |
| Morning jobs | cek 15 mnt (target 06:00) | aktif | |
| Weekly backup | cek 15 mnt (Senin 02:00) | aktif | |

**8.1 — 8.21** per worker: isi 4 kolom di atas.
**PASS:** cron aktif + bukti run + tidak dobel. Cron mati → **FAIL** (bukan N/A) dan masuk `KNOWN_ISSUES`.
**Larangan:** mengaktifkan flag di produksi tanpa persetujuan (bisa memicu burst WA).

**Gerbang Fase 8:**
```powershell
npx vitest run tests/unit/cron_auto_purge.test.ts tests/unit/lifecycle-interval-registry.test.ts tests/unit/anti-silent-drop-invariant.test.ts tests/unit/staff-trip-auto-close.test.ts tests/unit/backup.test.ts tests/unit/sheets-sync.service.test.ts
```

---

### FASE 9 — Integrasi Eksternal

**9.1 Google Contacts** — format nama `Nama - Kelurahan`; PASS via `google-contacts.test.ts`.
**9.2 Google Sheets** — penulisan deterministik `values.update`; PASS via `sheets-sync.service.test.ts`, `sheets-rekapan-formatter.test.ts`.
**9.3 Drive backup** — upload terenkripsi; PASS via inspeksi + `backup.test.ts` (completeness guard #293).
**9.4 Peta & rute** — ORS/Google + fallback Haversine; PASS via `google-distance.test.ts`, `google-geocode-tier.test.ts`; ukur fallback tanpa API key.
**9.5 Telegram** — alert & briefing; PASS via `telegram-service.test.ts`, `telegram-webhook-failclosed.test.ts`.
**9.6 Web Push VAPID** — PASS via `web-push.service.test.ts` + `push-rbac.test.ts`.
**9.7 LLM gateway fallback** — PASS via `model-fallback-chain.test.ts`, `provider-model-alignment.test.ts`; simulasi provider mati.

**Gerbang Fase 9:**
```powershell
npx vitest run tests/unit/sheets-sync.service.test.ts tests/unit/sheets-rekapan-formatter.test.ts tests/unit/google-contacts.test.ts tests/unit/google-distance.test.ts tests/unit/google-geocode-tier.test.ts tests/unit/telegram-service.test.ts tests/unit/telegram-webhook-failclosed.test.ts tests/unit/web-push.service.test.ts tests/unit/model-fallback-chain.test.ts
```

---

### FASE 10 — Pengaturan Sistem, RBAC & Data-Driven

**10.1 Pelanggan & alamat** — override AI (Auto/ON/OFF), soft-reset, multi-alamat.
**10.2 Katalog & ongkir** — harga/durasi/tier dari DB.
**10.3 Persona, few-shots, model AI** — semua dapat diubah tanpa deploy.
**10.4 Scope rollout** — `NEW_ONLY` vs `ALL` + cutoff (fail-closed).
**10.5 SOP & pembayaran** — knowledge chunk + QRIS.
**10.6 RBAC** — `role_api_scopes` menegakkan izin; uji endpoint dengan role terbatas.
**10.7 Backup & evaluasi LLM** — backup manual + biaya/token.

**Pemeriksaan anti-hardcode (mandat):**
- Scan `src/**/*.ts` untuk harga/nama layanan/nama klinik literal; setiap temuan wajib punya alasan (default/fallback) atau **FAIL**.
- **Bukti:** hasil `rg` + tabel klasifikasi.

**Gerbang Fase 10:**
```powershell
npx vitest run tests/unit/admin-rbac-guard.test.ts tests/unit/ai-model-settings.test.ts tests/unit/ai-scope-gate.test.ts tests/unit/admin-persona-prompt-config.test.ts tests/unit/admin-payment-info-settings.test.ts tests/unit/backup.test.ts tests/unit/tenant-settings-resilience.test.ts
```

---

### FASE 11 — Keamanan & Ketahanan (BARU)

**11.1 Matriks otorisasi** — setiap endpoint admin/staff: role yang diizinkan vs aktual. PASS: 0 endpoint tanpa guard.
**11.2 Secret scan** — `npm run security:scan`; PASS: 0 secret baru (kecuali yang sudah dirotasi/di-ignore terdokumentasi).
**11.3 Media access control** — `/media/*` tidak dapat diakses tanpa otorisasi; PASS via `media-security.test.ts`, `media-query-auth-ban.test.ts`.
**11.4 Webhook replay/signature** — PASS via `webhook-security.test.ts`.
**11.5 PII & retensi** — log tidak memuat nomor penuh; retensi berjalan.
**11.6 Drift migrasi** — jalankan:
```powershell
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```
PASS: output `-- This is an empty migration.` (rujuk #291; dilarang `migrate dev`).
**11.7 Restore drill** — restore backup ke DB sementara; PASS: jumlah reservasi/customer tidak turun >20% tanpa `force`.
**11.8 Header & XSS** — `raw_html_security.test.ts`; CSP/helmet bila ada.

**Gerbang Fase 11:**
```powershell
npm run security:scan
npx vitest run tests/unit/webhook-security.test.ts tests/unit/media-security.test.ts tests/unit/media-query-auth-ban.test.ts tests/integration/push-rbac.test.ts tests/integration/raw_html_security.test.ts tests/unit/auth-access-log.test.ts
```

---

### FASE 12 — Konsolidasi, Verifikasi Akhir & Penutupan

1. Rekap seluruh temuan: ID, fase, severity, keyakinan, bukti, FMEA, rekomendasi.
2. Bandingkan `after.json` vs `baseline.json` (§D.3) → PASS bila tidak ada nama test gagal baru.
3. `npm run typecheck`; `cd packages/admin-dashboard && npm run build` (bila UI berubah).
4. Perbarui:
   - `docs/FEATURE_INVENTORY.md` (angka & path hasil regenerasi Fase 0 + temuan).
   - `docs/KNOWN_ISSUES.md` (semua temuan terbuka/ditunda).
   - `CHANGELOG.md` + `docs/changelog/INDEX.md`.
5. Laporan akhir + tanda tangan pengguna untuk fitur berdampak tinggi.

**Gerbang Fase 12:** semua artefak ada; baseline-diff PASS; dokumen hidup diperbarui; persetujuan pengguna tercatat.

---

## F. Requirement Traceability Matrix (RTM)

Setiap baris inventaris wajib punya fase, task, bukti, dan status. Contoh format (diisi saat eksekusi):

| Modul Inventaris | Jumlah Fitur (terverifikasi) | Fase | Task ID | Bukti | Status |
|---|---:|---|---|---|---|
| 1. Arsitektur & Multi-Tenant | 8 | 1 | 1.1–1.6 | `docs/audit/2026-11-02/fase-01/` (7 files, 47 passed) | **PASS** |
| 2. WhatsApp Gateway | 9 | 2 | 2.1–2.6 | `docs/audit/2026-11-02/fase-02/` (11 files, 88 passed) | **PASS** |
| 3. AI V3 | 6 tool + 9 guard + 4 state | 3 | 3.1–3.5 | `docs/audit/2026-11-02/fase-03/` (16 files, 85 passed) | **PASS** |
| 4. Reservasi | **16** (bukan 15) | 4 | 4.1–4.8 | `docs/audit/2026-11-02/fase-04/` (7 files, 54 passed) | **PASS** |
| 5. Web App Staf | **13** (bukan 14) | 5 | 5.1–5.7 | `docs/audit/2026-11-02/fase-05/` (7 files, 16 passed) | **PASS** |
| 6. Live Chat | **12** (bukan 13) | 6 | 6.1–6.8 | `docs/audit/2026-11-02/fase-06/` (7 files, 27 passed, design green) | **PASS** |
| 7. Marketing/CTWA | 8 | 7 | 7.1–7.6 | `docs/audit/2026-11-02/fase-07/` (9 files, 95 passed) | **PASS** |
| 8. Background Crons | 21 | 8 | 8.1–8.21 | `docs/audit/2026-11-02/fase-08/` (7 files, 33 passed, query live) | **PASS (Catatan #298)** |
| 9. Integrasi Eksternal | 7 | 9 | 9.1–9.7 | `docs/audit/2026-11-02/fase-09/` (9 files, 96 passed) | **PASS** |
| 10. Pengaturan & RBAC | 12 | 10 | 10.1–10.7 | `docs/audit/2026-11-02/fase-10/` (10 files, 72 passed) | **PASS** |
| 11. Keamanan & Ketahanan | 8 kontrol | 11 | 11.1–11.8 | `docs/audit/2026-11-02/fase-11/` (6 files, 51 passed, scan clean) | **PASS** |

> Jumlah fitur Bab 4/5/6 dikoreksi dari hasil hitung baris tabel inventaris 2026-11-02.

---

## G. Register Risiko Audit (FMEA)

| ID | Risiko | S | O | D | RPN | Mitigasi | Pemicu |
|---|---|---:|---:|---:|---:|---|---|
| R-01 | Audit memicu shadow-ban / 463 | 10 | 2 | 3 | 60 | Protokol §C, `WAHA_MOCK=true`, sandbox | sebelum uji chat |
| R-02 | "Hijau palsu" karena DB offline/fallback | 8 | 7 | 7 | 392 | baseline-diff + bukti DB nyata di server | setiap gate |
| R-03 | Cron mati dianggap PASS | 8 | 8 | 7 | 448 | kriteria 4 kolom + bukti run | Fase 8 |
| R-04 | Regresi lolos karena baseline salah | 8 | 5 | 6 | 240 | 3× baseline run + revert-and-rerun | Fase 0/12 |
| R-05 | Inventaris drift kembali | 7 | 9 | 5 | 315 | regenerasi via skrip, bukan manual | Fase 0/12 |
| R-06 | Data produksi tercemar | 9 | 2 | 4 | 72 | `is_sandbox_test=true` + cleanup | sebelum uji |
| R-07 | Audit mengganggu server | 7 | 3 | 4 | 84 | mode M3 read-only, di luar jam sibuk | sebelum SSH |
| R-08 | Kelelahan konfirmasi pengguna | 4 | 8 | 6 | 192 | konfirmasi hanya fitur berdampak tinggi | per fase |
| R-09 | Temuan tidak tercatat | 5 | 7 | 6 | 210 | DoD KNOWN_ISSUES | akhir fase |

> Urutan prioritas mengikuti RPN, **kecuali** R-01 (Severity 10) yang selalu dikerjakan lebih dulu.

---

## H. Tata Kelola Interaktif & Format Laporan

**Konfirmasi pengguna hanya untuk fitur berdampak tinggi/klinis:**
harga & katalog, SOP medis, alur booking/hold, takeover live chat, template pesan pelanggan, pembayaran, RBAC.

**Format laporan per modul (Bahasa Indonesia sederhana):**

1. **Apa yang terjadi** — fitur yang diaudit + mode kerja.
2. **Apa temuan** — tabel: ID | Severity | Keyakinan | Bukti (`file:line`/test/query) | Status.
3. **Apa solusinya / pertanyaan validasi** — rekomendasi fondasional + keputusan yang diminta.

**Rubrik severity:**

| Tingkat | Definisi | Contoh |
|---|---|---|
| Kritis | Salah klinis, PII/kredensial bocor, shadow-ban, kehilangan data, nominal salah | harga salah, HMAC tidak diverifikasi |
| Tinggi | Fitur utama mati diam-diam, isolasi tenant bocor, cron kritis tidak jalan | 5 worker mati |
| Sedang | Perilaku menyimpang non-kritis, UX rusak, drift dokumen | inventory 43 vs 47 |
| Minor | Penamaan, typo, dokumentasi | path komentar salah |

---

## I. Definition of Done (revisi)

Audit dinyatakan selesai bila **semua** terpenuhi:

1. RTM §F terisi 100% dengan status + bukti.
2. Inventaris diregenerasi dari kode dan cocok 100% (route count via `printRoutes`, 47 model, 21 worker).
3. Setiap fase punya artefak `docs/audit/2026-11-02/fase-XX/`.
4. Baseline-diff PASS: tidak ada nama test gagal baru vs `baseline.json`.
5. `npm run typecheck` exit 0; `security:scan` bersih; drift migrasi "empty migration".
6. Semua temuan terbuka masuk `docs/KNOWN_ISSUES.md`.
7. `CHANGELOG.md` + `docs/changelog/INDEX.md` diperbarui.
8. `docs/FEATURE_INVENTORY.md` diperbarui (angka, path, riwayat).
9. Persetujuan pengguna tercatat untuk fitur berdampak tinggi.
10. Tidak ada perubahan kode produksi yang dilakukan dalam fase audit (perbaikan = plan terpisah + persetujuan).

---

## J. Batas Cakupan & Asumsi

- `[ASUMSI]` Nilai `.env` server live berbeda dari lokal; semua temuan konfigurasi (F-11/F-12/F-13) wajib dikonfirmasi di server sebelum final.
- `[ASUMSI]` Hitungan 343 route memakai pola deklarasi literal; angka final diambil dari `app.printRoutes()` di Fase 0.
- Tidak termasuk: deploy, perubahan WAHA, rotasi kredensial, perbaikan kode (dibuat plan terpisah per temuan).
- Log mesin lokal terakhir 2026-10-06; bila server tidak menyediakan log ≤48 jam, dimensi "log mesin" ditandai **CELAH CAKUPAN**.
- Audit tidak membaca seluruh 797 KB `KNOWN_ISSUES.md`; hanya entri relevan (#286–#296).

---

## K. Langkah Berikutnya (butuh persetujuan eksplisit)

1. Setujui plan v2 ini.
2. Eksekusi **Fase 0 saja** (regenerasi inventaris + baseline + protokol keselamatan), lalu berhenti dan laporkan.
3. Setelah Fase 0 disetujui, lanjut fase demi fase sesuai §E.
