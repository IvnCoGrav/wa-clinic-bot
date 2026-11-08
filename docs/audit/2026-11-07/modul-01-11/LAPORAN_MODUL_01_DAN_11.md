# Laporan Audit Deep-Dive — Modul 1 (Arsitektur Inti, Multi-Tenant & Lifecycle) & Modul 11 (Keamanan & Ketahanan)

> **Tanggal audit:** 2026-11-07
> **Mode:** BACA-SAJA (tidak ada kode/test/config/.env yang diubah; server tidak dijalankan; DB/WAHA/Meta tidak dipanggil; tidak ada deploy)
> **Repo:** `C:\Users\Ivan\.gemini\antigravity\scratch\wa-clinic-bot` (Node 20 + TypeScript + Fastify 4.28.1 + Prisma 5.19.1 + WAHA)
> **Commit yang diperiksa:** working tree `master` per 2026-11-07 (HEAD `2302e4d8` untuk file rencana rotasi; HEAD kerja tidak di-commit oleh agen)
> **Di luar cakupan:** Modul 4 (Reservasi) dan Modul 6 (Live Chat) — tidak diaudit ulang; rujukan ke keduanya hanya sebagai konteks otorisasi.
> **Auditor:** subagent audit (DeepSeek V4.1 Flash)

---

## 1. Ringkasan Eksekutif

Postur keamanan inti sudah jauh lebih baik dibanding audit September 2026 (sesi admin sudah di-hash, HMAC Meta sudah fail-closed, RBAC data-driven sudah ada, restore SQL mentah sudah ditolak), tetapi **fondasi otorisasi masih berhenti di "deny-list 12 prefix"** sehingga kontrol sesi WhatsApp, prompt AI, dan landing page lintas tenant masih dapat diakses peran staf biasa. Ditemukan **25 temuan**: 1 Critical, 8 High, 12 Medium, 4 Low. Temuan paling berat adalah **S-003 (RBAC fail-open untuk semua role tanpa baris `role_api_scopes`, termasuk setiap custom role baru)**, **S-001 (kredensial admin produksi historis masih tertulis di dua file yang ter-track di repo publik)**, dan **S-005/S-004 (rate-limit dapat di-bypass via `X-Forwarded-For` dan `x-api-key` palsu)**. Tiga prioritas eksekusi: (1) purge + rotasi kredensial & perbaiki secret scanner; (2) ubah otorisasi menjadi allow-list per peran dan kunci endpoint sesi WhatsApp/prompt/tenant-HTML; (3) perbaiki kepercayaan proxy + rate limit. Lapisan lifecycle juga belum memenuhi klaim "7 tahap": **4 `setInterval` masih liar di luar registry shutdown** (Ar-001).

---

## 2. Framework & Cakupan

### 2.1 Framework dan alasan

| Framework | Alasan dipakai | Bagian yang dipetakan |
|---|---|---|
| **AWS Well-Architected** (Security, Reliability, Operational Excellence) | Modul 1 menilai lifecycle, degradasi DB, isolasi tenant, dan kesiapan operasi — bukan hanya "apakah bisa jalan". | Ar-001…Ar-009 |
| **OWASP ASVS 4.0 + OWASP Top 10 (2021) / API Top 10 (2023)** | Modul 11 adalah aplikasi web/API dengan sesi, RBAC, webhook, upload media, dan admin panel. ASVS memberi kontrol yang dapat diuji (V2 auth, V4 access control, V5 validasi, V7 logging, V8 data protection). | S-001…S-016 |
| **STRIDE** | Memetakan ancaman per boundary (internet → Caddy → app → WAHA/DB; tenant A → tenant B; staf → super admin). | Semua temuan, khususnya S-002/S-003/S-006/S-010 |
| **NIST CSF 2.0** (Identify, Protect, Detect, Respond, Recover) | Menilai kemampuan deteksi (scanner, audit log), respons (revokasi sesi), dan pemulihan (backup/restore). | S-013, Ar-005, Ar-009 |
| **FMEA (S×O×D=RPN)** | Kuantifikasi prioritas; S=9–10 untuk kebocoran kredensial/PII, bypass auth, dan migrasi merusak produksi. | Semua temuan |

### 2.2 Ruang lingkup yang diperiksa (Tahap 2)

**Modul 1 — Arsitektur inti & lifecycle**
- `src/app.ts` (boot requirement, parser raw body, compression, rate limit, hook onResponse, registrasi route, boot tenant data, mode worker).
- `src/config/tenant.ts`, `src/db/client.ts`, `src/lifecycle/{shutdown,interval-registry,background-crons}.ts`, `src/worker.ts`.
- Hook otorisasi global di `src/routes/admin.route.ts`, `src/routes/staff.route.ts`; `src/utils/auth.ts`; `src/utils/auth-access-log.ts`.
- Degradasi DB & fallback memori: `admin-session.service.ts`, `staff-auth.service.ts`, `role-scope.service.ts`, route admin yang menelan error.
- Isolasi tenant di query/service: `tenantOf()` (`route-helpers.ts`), `resolveTenantId()` (`settings.subroute.ts`), `x-tenant-id`, `waha-tenant.service.ts`, `waba-tenant.service.ts`, `whatsapp-provider.service.ts`.

**Modul 11 — Keamanan & ketahanan**
- Autentikasi/otorisasi admin & staf (login, restore, logout, `/me`, cookie, API key, RBAC prefix + `role_api_scopes`).
- Webhook HMAC: `webhook.route.ts`, `waba-webhook.route.ts`, `telegram-webhook.route.ts`, `integrations/whatsapp/signature.ts`.
- Media & path traversal: `media.route.ts`, `media.service.ts`, `backup-file.ts`.
- Backup/restore: `backup.subroute.ts`, `backup.service.ts`.
- Validasi input & endpoint publik: `tracking.route.ts`, `landing.route.ts`.
- PII/secret handling: `encryption.ts`, `system-debug.service.ts`, `audit.service.ts`, `logger-sanitizer.ts`, `scripts/scan-secrets.ts`.
- Deployment/konfigurasi: `docker-compose.yml`, `Caddyfile`, `.gitignore`, `package.json`/`package-lock.json` (versi), `docs/CYBERSECURITY_AUDIT_REPORT.md`, `docs/SAAS_READINESS_AUDIT.md`, `docs/audit/2026-11-02/fase-01` & `fase-11`, `docs/KNOWN_ISSUES.md`.

### 2.3 Metode Tahap 0–6

- **Tahap 0** — framework dipilih (tabel di atas).
- **Tahap 1** — `docs/KNOWN_ISSUES.md` dibaca; 26 entri relevan (10 entri KNOWN_ISSUES + 16 temuan laporan keamanan) diklasifikasi; klaim "SELESAI" diverifikasi ulang terhadap kode (`#129`, `#137`, `#141`, `#143`, `#168`, `#179`, `#282`, `#298`, `#316`).
- **Tahap 2** — inventaris + prioritas area (auth, webhook, media, backup, tenant, lifecycle, deploy).
- **Tahap 3** — audit horizontal: pola `catch → 200 + data kosong`, pola `DEFAULT_TENANT_ID`, pola `err.message` ke klien, pola `request.ip`, pola prefix RBAC, pola `tenantId` dari body.
- **Tahap 4** — audit vertikal pada 4 alur berisiko: (a) login → sesi → RBAC → endpoint sensitif; (b) webhook WAHA/WABA → resolve tenant → tulis DB; (c) upload/unduh media → filesystem; (d) boot → cron/worker → shutdown. Masing-masing dianalisis 5 Whys.
- **Tahap 5** — FMEA, blast radius, pre-mortem, urutan perbaikan.
- **Tahap 6** — cara verifikasi per temuan (bagian 6).

### 2.4 Celah cakupan (dinyatakan eksplisit)

1. **Tidak ada akses ke server produksi / DB produksi** — status migrasi `#298`, nilai `.env` live, umur sesi aktif, dan apakah kredensial bocor masih aktif **tidak dapat diverifikasi**. Semua klaim tentang produksi ditandai `[ASUMSI]` atau KEMUNGKINAN BESAR.
2. **Log produksi (`logs/*.jsonl`, `logs/app-*.log`) tidak diperiksa** — tidak ada bukti empiris 401/503, brute force, atau anomali tenant.
3. **Tidak menjalankan `npm audit`, `npm test`, `npm run build`, atau pemindaian dinamis** (mode baca-saja). Status kerentanan dependency ditandai `[ASUMSI]`.
4. **Tidak semua 30+ subroute admin dibaca baris-per-baris**; sampling difokuskan pada yang menyentuh auth, tenant, secret, media, backup, prompt AI, dan sesi WhatsApp. Subroute lain dinilai lewat pola (`DEFAULT_TENANT_ID`, `catch → 200`).
5. **Modul 4 & 6 sengaja dilewati** sesuai instruksi; temuan yang menyentuh reservasi/live chat hanya sebatas guard otorisasi, bukan logika bisnis.
6. **Tidak ada pengujian eksploitasi nyata** (Burp/curl ke server). Semua temuan berbasis kode; yang membutuhkan perilaku runtime ditandai KEMUNGKINAN BESAR/DUGAAN.
7. **`.env` tidak dibaca** (agar tidak memperluas paparan rahasia); hanya `.env.example` dan referensi dokumen yang diperiksa.

---

## 3. Status Temuan Lama (Tahap 1)

### 3.1 Entri `docs/KNOWN_ISSUES.md`

| ID | Judul singkat | Status lama | Verifikasi ulang 2026-11-07 | Bukti |
|---|---|---|---|---|
| #129 (item 1) | Tenant-aware belum tuntas; daftar file masih `DEFAULT_TENANT_ID` | OPEN | **MASIH TERBUKA / MEMBURUK**. Sekarang **325** referensi `DEFAULT_TENANT_ID` di `src/routes/**`; `tenantOf()` hanya dipakai di 6 domain (customers, analytics, reservations, meta-attribution, staff-retention). `settings.subroute.ts` naik dari 62 → **66**. | `Select-String -Path src/routes/**/*.ts -Pattern DEFAULT_TENANT_ID`; `tenantOf(` hanya di 6 file |
| #129 (item 2) | RBAC scope belum di-seed untuk `admin_cs`/`spv_cs`; role lain "legacy" | OPEN | **MASIH TERBUKA + celah baru**: custom role yang dibuat lewat dashboard **tidak pernah** menulis `role_api_scopes`, sehingga `isApiScopeAllowed` mengembalikan `allowed:true, managed:false`. | `roles.subroute.ts:82-104`; `role-scope.service.ts:62-64`; migrasi `20260926000002` hanya seed `therapist` |
| #129 (item 5) | `TELEGRAM_WEBHOOK_SECRET`/OAuth state secret belum di `.env.example` | OPEN | **SEBAGIAN SELESAI**: `TELEGRAM_WEBHOOK_SECRET` sudah ada (`.env.example:210`); `GOOGLE_OAUTH_STATE_SECRET` masih belum ada (fallback ke `ADMIN_API_KEY`). | `.env.example`; `google-oauth.client.ts` |
| #137 | Gate boot `TELEGRAM_WEBHOOK_SECRET` | RESOLVED | **TERVERIFIKASI SELESAI** — `app.ts:61-68` throw di produksi; `telegram-webhook.route.ts:30-35` fail-closed. | kutipan kode |
| #141 | Kontrak 503 `StaffAuthService` | RESOLVED | **TERVERIFIKASI SELESAI** — `staff-auth.service.ts:80-97` melempar `SessionStoreUnavailable`; route memetakan 503. | kode + `staff.route.ts:33-46` |
| #143 | Access-log 401/503 auth | RESOLVED | **TERVERIFIKASI SELESAI** — hook `onResponse` `app.ts:80-98`; hash prefix 8, tanpa token/IP mentah. | `auth-access-log.ts:55-88` |
| #168 | Push/RBAC ghost subscription | OPEN (sebagian by-design) | **MASIH TERBUKA sebagian** — `push.subroute.ts:158-174` sudah cek self, tetapi `tenantId` masih dari body dan role `ADMIN_CS` (unmanaged) tetap bisa memicu push. | kode |
| #179 | Purge histori git publik (PII & kunci lama) | RESOLVED | **SELESAI untuk histori**, tetapi **BERULANG di working tree**: nilai kredensial historis masih ada di 2 file yang di-track (lihat S-001). Cache commit lama di GitHub juga masih berisiko (diakui entri ini). | `git ls-files` + pencarian string |
| #282 | Kebocoran lintas tenant di `customers.subroute.ts` | RESOLVED | **SELESAI untuk customers** (`tenantOf` dipakai 26×). Namun `media.route.ts:374` masih hardcode `'default-tenant'` untuk lookup customer. | kode |
| #298 | `reservation_archives` belum ada di DB produksi | RESOLVED (2026-11-02) | **TIDAK DAPAT DIVERIFIKASI** — migrasi `20261101000000_add_reservation_archive` ada di repo; status live butuh `prisma migrate status` di server (di luar cakupan). | daftar migrasi lokal |
| #300 / #314 / #316 | Reservasi/FSM & Live Chat | RESOLVED (klaim) | **TIDAK DIAUDIT** (Modul 4/6 di luar cakupan); dirujuk sebagai konteks. | — |
| #299 | Laporan audit 2026-11-02 klaim PASS padahal gate gagal | RESOLVED | **BERULANG SEBAGIAN** — lihat Ar-009: klaim PASS Fase 1 (isolasi tenant) & Fase 11 (secret scanner, RBAC matrix) tidak didukung bukti kode hari ini. | bagian Ar-009 |

### 3.2 16 temuan `docs/CYBERSECURITY_AUDIT_REPORT.md` (25-09-2026)

| # | Temuan lama | Status terverifikasi | Bukti singkat |
|---|---|---|---|
| 01 | Bypass webhook Telegram | **SELESAI** | `telegram-webhook.route.ts:30-35`; `app.ts:61-68` |
| 02 | Sesi admin plaintext di file | **SELESAI** | `admin-session.service.ts:18-20,63-71`; hanya hash (38-40) |
| 03 | BOLA token pairing staf | **SELESAI** (GET); regenerate POST diblokir guard method | `staff-management.subroute.ts:361-373`; `admin.route.ts:261-270` |
| 04 | RBAC custom role kosmetik | **PARSIAL** — `role_api_scopes` ada, tapi **fail-open** untuk role tanpa baris | `role-scope.service.ts:62-64` |
| 05 | Path traversal avatar | **SELESAI** (basename + resolve) | `media.route.ts:366-385` |
| 06 | Restore SQL sewenang-wenang | **SELESAI** — hanya dump JSON internal | `backup.service.ts:308-317`; `backup-file.ts:37-43` |
| 07 | Kebocoran tenant karena hardcode | **PARSIAL** | `#129` item 1; 325 referensi |
| 08 | SSRF via redirect 302 | **SELESAI** — `maxRedirects: 0` | `media.route.ts:402-403` |
| 09 | CSRF admin API | **SELESAI untuk state-changing admin**; **celah baru** login-CSRF di `/restore` | `admin.route.ts:181-197` vs S-008 |
| 10 | OAuth state tanpa integritas | **SELESAI** — HMAC + nonce + TTL | `google-oauth.client.ts:83-125` |
| 11 | Kredensial plaintext di DB | **PARSIAL** — AES-GCM + dual-read; fallback key turunan `ADMIN_API_KEY` | `encryption.ts:4-21,57-80` |
| 12 | CSV formula injection | **SELESAI** | `financial-analytics.service.ts:13,493` |
| 13 | Rate limit over-exemption | **SELESAI untuk allowList SSE**, tetapi **bypass baru** via key/URL | `app.ts:143-163`; S-004 |
| 14 | `/state` & `/reset` berbahaya | **SELESAI** | `#129` Fase 4; soft-delete `Customer.deleted_at` |
| 15 | Origin tracking bypass & IP cookie | **PARSIAL** — origin masih spoofable; `tenant_id` dari body | `tracking.route.ts:294-319`; S-007 |
| 16 | Kebocoran error di `/ready` | **SELESAI** | `health.route.ts:32-37` |

**Kesimpulan Tahap 1:** dari 16 temuan lama, **10 SELESAI**, **5 PARSIAL**, **1 SELESAI tetapi berulang** (07/15/04/11/09 → parsial; S-001 adalah kebocoran kredensial baru). Tidak ada temuan lama yang saya duplikasi sebagai temuan baru kecuali bila ada **bukti baru yang memperluas dampak** (ditandai "regresi/varian baru").

---

## 4. Daftar Temuan

> Format: **ID — Judul**; Tipe; Lokasi; Bukti; Keyakinan; Framework; Akar masalah (5 Whys); Risiko; FMEA; Collateral damage; Rekomendasi fondasional; Verifikasi.
> `S-xxx` = keamanan; `Ar-xxx` = arsitektur. Urutan: severity lalu RPN.

### S-001 — Kredensial admin produksi historis masih tertulis di file yang di-track pada repo PUBLIK

- **Tipe:** Horizontal (secret handling) / Vertikal (dokumen → repo → kredensial live)
- **Lokasi:** `GUIDE_OPERASIONAL.md:71`; `docs/plans/SECRET_ROTATION_PLAN.md` (tabel Vektor D, baris 52-60)
- **Bukti:**
  - `GUIDE_OPERASIONAL.md:71` — *"Masukkan nilai `ADMIN_API_KEY` dari file `.env` Anda (secara default di file `.env` lokal Anda adalah: **`admin_prod_key_***`**)"* (nilai penuh sengaja tidak ditulis ulang di laporan ini).
  - `docs/plans/SECRET_ROTATION_PLAN.md` masih memuat nilai penuh `ADMIN_API_KEY` (20 karakter, lemah) dan **`WAHA_API_KEY` 32-hex** (prefix `3659a248…`).
  - Kedua file **ter-track**: `git ls-files docs/plans/SECRET_ROTATION_PLAN.md` → path keluar; `git ls-files` iterasi menemukan string di 2 file.
  - Remote: `https://github.com/IvnCoGrav/wa-clinic-bot.git`; `KNOWN_ISSUES #179` menyatakan repo **publik**.
  - `scripts/scan-secrets.ts` **tidak punya aturan** untuk API key generik/hex 32/`ADMIN_API_KEY`; hanya `kn-`, `sk-`, `AIza`, `EAAR`, ORS JWT, PEM (baris 21-70).
- **Keyakinan:** **TERBUKTI** (string ada di file tracked & repo publik). Apakah nilai masih aktif di server = **KEMUNGKINAN BESAR** (tidak diverifikasi).
- **Framework:** OWASP A02/A07, ASVS V2.10/V8.3, NIST CSF PR.AC/PR.DS, STRIDE Information Disclosure.
- **Akar masalah (5 Whys):**
  1. Mengapa kredensial ada di repo? → Dokumen operasional menyalin nilai `.env` sebagai contoh "default".
  2. Mengapa tidak terdeteksi? → Secret scanner hanya memindai file yang **berubah** (`git status --porcelain`), bukan seluruh tracked tree; aturan tidak mencakup key generik.
  3. Mengapa scanner begitu? → Dioptimalkan untuk pre-commit cepat, bukan audit berkala.
  4. Mengapa audit Fase 11 lulus? → Klaim "0 kebocoran" diambil dari scanner yang sama saat working tree bersih → **vacuous pass**.
  5. Mengapa kontrol tidak berlapis? → Tidak ada secret manager/CI gate; rotasi kredensial tidak diverifikasi ulang.
- **Risiko:** Siapa pun yang melihat repo publik dapat mencoba `admin_prod_key_***` ke `/api/admin/auth/login` atau `X-API-KEY`; bila masih aktif → **seluruh data pasien, reservasi, live chat, backup, dan sesi WhatsApp dapat diambil alih**. Jika WAHA key masih aktif → kontrol penuh atas gateway WhatsApp.
- **FMEA:** **S=10, O=6, D=8 → RPN 480**
- **Collateral damage:** Rotasi `ADMIN_API_KEY` memutus semua klien API key (dashboard memakai cookie, CLI/script memakai key) dan membuat sesi lama tetap valid (hash sesi tidak terikat key). Rotasi `WAHA_API_KEY` menyentuh WAHA → **wajib 2-step verification + WARNING** sesuai AGENTS.md. Menghapus baris dokumen tidak merusak runtime.
- **Rekomendasi fondasional:**
  1. Ganti nilai di `GUIDE_OPERASIONAL.md` & `SECRET_ROTATION_PLAN.md` dengan `<REDACTED_BY_SECURITY>`; jangan pernah menyalin secret ke dokumen.
  2. Rotasi `ADMIN_API_KEY` + `WAHA_API_KEY` (dan `WAHA_SWAGGER_PASSWORD`/`WAHA_DASHBOARD_PASSWORD` bila sama) di server; invalidasi seluruh `admin_sessions` (tabel) agar sesi lama mati.
  3. Ubah `scripts/scan-secrets.ts` menjadi **dua mode**: `--staged` (cepat) dan `--all` (seluruh tracked tree, default di CI/pre-push). Tambah aturan: `ADMIN_API_KEY\s*=\s*["'][^"']{8,}`, hex 32/64 generik, `postgres(ql)?://[^:]+:[^@]+@`, token Telegram `\d{8,10}:[A-Za-z0-9_-]{35}`, dan entri `.env` **via `git check-ignore`** bukan hanya nama file.
  4. Tambah gerbang CI: `npm run security:scan -- --all` wajib 0 finding sebelum merge.
- **Verifikasi:** `git grep -n "admin_prod_key_"` → 0 hasil; `git grep -n "3659a248"` → 0; `npm run security:scan -- --all` → 0; login dengan key lama → 401; sesi lama (`admin_sessions`) → 401 setelah `DELETE FROM admin_sessions`; `curl /health` & `/ready` tetap 200 setelah rotasi.

---

### S-002 — Endpoint kontrol sesi WhatsApp (`/api/admin/whatsapp-provider/*`) dapat dipakai staf non-super-admin → pengambilalihan akun WhatsApp

- **Tipe:** Horizontal (pola otorisasi seluruh subroute) / Vertikal (staf → API → WAHA)
- **Lokasi:** `src/routes/admin.route.ts:205-222`; `src/routes/admin/waba.subroute.ts:53-148,154-201,206-240`
- **Bukti:**
  - Daftar `superAdminOnlyPrefixes` **tidak memuat** `/api/admin/whatsapp-provider` (hanya `/api/admin/waba`).
  - `waba.subroute.ts:53-65` — `GET /api/admin/whatsapp-provider/qr` memanggil `whatsappProviderService.getQrForTenant(tenantId)` tanpa cek peran internal.
  - `waba.subroute.ts:124-148` — `POST .../session/disconnect` memanggil `disconnectSessionForTenant` tanpa cek peran.
  - `waba.subroute.ts:206-240` — `PATCH /api/admin/whatsapp-provider` menulis `waba_access_token`, `waba_webhook_verify_token`, dan `provider`.
  - Role `ADMIN_CS`/`SPV_CS` tidak punya baris `role_api_scopes` → `role-scope.service.ts:62-64` mengembalikan `allowed:true, managed:false` → lolos.
- **Keyakinan:** **TERBUKTI** (alur kode). Eksploitasi butuh sesi staf valid — **TERBUKTI** secara logika.
- **Framework:** OWASP API5:2023 (Broken Function Level Authorization), ASVS V4.1/V4.2, STRIDE Elevation of Privilege.
- **Akar masalah (5 Whys):**
  1. Mengapa staf bisa akses QR? → Prefix tidak masuk daftar super-admin.
  2. Mengapa daftar itu yang jadi gerbang? → Arsitektur otorisasi memakai **deny-list**, bukan allow-list per peran.
  3. Mengapa deny-list dipilih? → Migrasi bertahap dari single-key (#129 Fase 2), menunda pemetaan frontend→API.
  4. Mengapa tidak ada guard di route? → Tidak ada kontrak `requireSuperAdmin` yang diwajibkan untuk route sensitif.
  5. Mengapa tidak terdeteksi test? → `admin-staff-authz-matrix.test.ts` hanya menguji **tanpa kredensial** (401/403), bukan matriks peran.
- **Risiko:** Staf mana pun (mis. CS magang) dapat: (a) memindai QR dan menautkan perangkat sendiri ke nomor WhatsApp klinik → membaca seluruh chat pasien & mengirim pesan sebagai klinik; (b) `disconnect/reset` → seluruh layanan WhatsApp mati (DoS operasional); (c) mengubah `waba_access_token` → mengalihkan pengiriman ke akun Meta lain.
- **FMEA:** **S=9, O=7, D=6 → RPN 378**
- **Collateral damage:** Menutup endpoint untuk `ADMIN_CS` dapat mematahkan halaman Settings yang diakses supervisor untuk memantau status; solusi harus memisahkan **read status** (boleh) dari **QR/reset/disconnect/token** (super-admin). Uji UI Settings & LiveChatMonitor setelah perubahan.
- **Rekomendasi fondasional:** Tambahkan guard deklaratif per route, mis. `preHandler: requireSuperAdmin` yang membaca `request.staffRole`/`request.adminKeyUsed` (bukan string prefix), lalu terapkan pada: `whatsapp-provider/qr|session/*|cutoff|PATCH`, `tenant/:id/html`, `few-shots*`, `ai-rollout-scope`, `services` (tulis harga), `landings` (tulis). Read-only `GET /api/admin/whatsapp-provider` tetap boleh untuk peran operasional.
- **Verifikasi:** Test matriks baru: untuk setiap (role × endpoint) assert 200/403; khusus `ADMIN_CS` + `GET /qr` → **403**; `SUPER_ADMIN` → 200. `npm run build` + `npx vitest run tests/integration/admin-staff-authz-matrix.test.ts`.

---

### S-003 — RBAC fail-open: setiap role tanpa baris `role_api_scopes` (termasuk semua custom role baru) mendapat akses hampir penuh

- **Tipe:** Horizontal (pola otorisasi) / Vertikal (login → sesi → scope → service)
- **Lokasi:** `src/services/role-scope.service.ts:35-78`; `src/routes/admin/roles.subroute.ts:82-104`; `src/routes/admin.route.ts:278-290`
- **Bukti:**
  - `role-scope.service.ts:62-64`:
    ```ts
    if (rows.length === 0) {
      return { allowed: true, managed: false };
    }
    ```
  - `roles.subroute.ts:82-104` — `prisma.customRole.upsert({...})` **hanya** menulis `label`, `description`, `allowed_paths`, `default_redirect`; **tidak ada** `prisma.roleApiScope.createMany`.
  - `admin.route.ts:281-290` — keputusan `isApiScopeAllowed(...)`; bila `allowed:false` baru 403.
  - Migrasi seed `20260926000002` hanya berisi 2 baris `therapist`; komentar migrasi sendiri menyatakan `admin_cs/spv_cs` belum di-seed.
  - `allowed_paths` hanya dipakai untuk `redirectTo` di login (`auth.subroute.ts:173-180`), **bukan** otorisasi API.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** OWASP API5:2023, ASVS V4.1.1/V4.2.2, STRIDE Elevation of Privilege, NIST CSF PR.AC-4.
- **Akar masalah (5 Whys):**
  1. Mengapa custom role baru punya akses penuh? → Tidak ada baris scope → dianggap "legacy".
  2. Mengapa "legacy" = allow? → Kompatibilitas mundur saat migrasi RBAC; default-deny hanya untuk role yang sudah "managed".
  3. Mengapa pembuatan role tidak menulis scope? → `allowed_paths` adalah konsep **frontend path**, sedangkan `role_api_scopes` adalah **API prefix**; tidak ada pemetaan otomatis.
  4. Mengapa tidak ada pemetaan? → Belum ada kontrak "role creation = scope creation" dan belum ada UI scope.
  5. Mengapa lolos audit? → Klaim "RBAC data-driven" benar secara mekanisme, tetapi **tidak menguji role yang belum di-seed**; test hanya 401 anonim.
- **Risiko:** Setiap custom role (mis. "marketing", "finance") yang dibuat admin untuk membatasi akses justru mendapat **akses penuh** ke customers (PII), live chat, reservasi, knowledge, few-shots, whatsapp-provider — persis kebalikan dari maksud UI. Eskalasi hak akses tanpa jejak.
- **FMEA:** **S=8, O=9, D=7 → RPN 504** (tertinggi)
- **Collateral damage:** Mengubah default menjadi deny akan memblokir `admin_cs`/`spv_cs` yang sekarang bergantung pada perilaku legacy → **wajib seed scope mereka lebih dulu** dalam migrasi yang sama, lalu uji dashboard per peran. Bila urutan salah, operasional CS berhenti (404/403 pada halaman utama).
- **Rekomendasi fondasional:**
  1. Ubah `isApiScopeAllowed`: `rows.length === 0` → **deny** (`{allowed:false, managed:true}`) untuk semua role staf, kecuali daftar eksplisit `LEGACY_UNMANAGED_ROLES` yang kosong. Ini menyentuh state machine otorisasi, bukan tambal.
  2. Transaksi pembuatan/update custom role **wajib** menulis `role_api_scopes` (derive dari `allowed_paths` → API prefix melalui peta data-driven `frontend_path → api_prefix` yang disimpan di DB/seed).
  3. Seed `admin_cs`, `spv_cs`, `advertiser`, `therapist` lengkap di satu migrasi; jalankan **sebelum** mengaktifkan default-deny.
  4. Tambah kolom/UI "API scope" di halaman Roles (tanpa page baru — Drawer/Tab sesuai mandat anti-bloat).
- **Verifikasi:** Migrasi baru + test: role tanpa baris → 403 pada `/api/admin/customers`; `admin_cs` → 200 pada reservasi/livechat, 403 pada whatsapp-provider/backup; `therapist` → 403 pada semua `/api/admin/*` kecuali `/staff/me`. Regression gate: login & dashboard tiap peran.

---

### S-004 — Rate limit dapat di-bypass total lewat `x-api-key` palsu dan `allowList` berbasis substring URL

- **Tipe:** Horizontal (seluruh route) / Vertikal (request → rate-limit plugin → handler)
- **Lokasi:** `src/app.ts:136-173` (khusus 143-149, 151-163)
- **Bukti:**
  - `app.ts:159-162`:
    ```ts
    const apiKey = request.headers['x-api-key'] as string;
    if (apiKey) {
      return `${apiKey}-${clientIp}`;
    }
    ```
    Tidak ada validasi bahwa `apiKey` benar → setiap nilai acak menciptakan bucket baru.
  - `app.ts:143-149`:
    ```ts
    if (url.includes('/events') || url.includes('/stream')) return true;
    ```
    `includes` atas **URL lengkap** → `POST /api/admin/auth/login?x=/events` atau `/api/admin/customers?q=/stream` dikecualikan dari limit global.
  - `app.ts:137` — `max: 1000`/menit; tanpa store Redis, jadi per-proses.
- **Keyakinan:** **TERBUKTI** (kode deterministik).
- **Framework:** OWASP API4:2023 (Unrestricted Resource Consumption), ASVS V13.1, STRIDE Denial of Service.
- **Akar masalah (5 Whys):**
  1. Mengapa limit bisa dilewati? → Bucket ditentukan oleh header yang dikendalikan klien.
  2. Mengapa memakai header? → Agar tiap API key punya kuota terpisah.
  3. Mengapa tidak divalidasi? → Plugin rate-limit berjalan **sebelum** auth; tidak ada akses ke identitas tervalidasi.
  4. Mengapa allowList substring? → Ingin mengecualikan SSE tanpa memelihara daftar route.
  5. Mengapa tidak ketahuan? → Tidak ada test beban/abuse; audit hanya melihat "allowList tidak lagi return true untuk semua".
- **Risiko:** Penyerang tanpa kredensial dapat membanjiri `/api/admin/auth/login` (brute force password staf), endpoint mahal (LLM/copilot, export, map), dan webhook; biaya LLM/CPU membengkak. `POST /webhook` juga punya limit 5000/menit yang bisa dihindari dengan URL ber-query `/events`.
- **FMEA:** **S=6, O=10, D=7 → RPN 420**
- **Collateral damage:** Memperketat dapat memotong SSE/Long-poll yang sah dan integrasi ber-key. Solusi harus memakai **path exact** untuk SSE dan **hash key tervalidasi**, bukan menghapus pengecualian.
- **Rekomendasi fondasional:**
  1. `keyGenerator`: gunakan `sha256(apiKey)` **hanya bila** `safeCompare(apiKey, ADMIN_API_KEY)`; jika tidak valid → `ip` (dan auth akan menolak 401 lebih dulu).
  2. `allowList`: cocokkan `request.routeOptions.url`/path terdaftar (`/api/admin/live-chat/events`, `/api/admin/copilot/stream`) — bukan `includes`.
  3. Pindahkan rate limit login ke **per-akun** (phone/identifier + IP) dengan lockout eksponensial di DB/Redis, bukan Map per-proses.
  4. Bila multi-instance: gunakan store Redis yang sudah ada (`ioredis`) — **tanpa dependency baru**.
- **Verifikasi:** Test integrasi: 1001 request dengan `x-api-key` acak berbeda → harus 429; `GET /api/admin/customers?q=/stream` berulang → 429; SSE asli tetap terbuka; login 6× untuk akun sama → 429 meski IP berubah (per-akun).

---

### S-005 — `trustProxy: true` + rantai `X-Forwarded-For` membuat IP klien dapat dipalsukan → throttle login & audit IP tidak bermakna

- **Tipe:** Horizontal (semua IP-based control) / Vertikal (Caddy → app → `request.ip`)
- **Lokasi:** `src/app.ts:71`; `src/routes/admin/auth.subroute.ts:47,58-72`; `src/routes/staff/auth.subroute.ts:24-39`; `src/routes/tracking.route.ts:321-323`
- **Bukti:**
  - `app.ts:71` — `trustProxy: true` (mempercayai **semua** hop).
  - `auth.subroute.ts:47` — `const ip = request.ip || '127.0.0.1';` lalu Map `loginAttemptsMap` 5/menit per IP.
  - `Caddyfile` — `reverse_proxy app:3000` tanpa `trusted_proxies`/pengaturan XFF eksplisit. Caddy menambahkan IP klien ke `X-Forwarded-For`; nilai paling kiri tetap berasal dari klien.
  - `tracking.route.ts:321-322` mengonfirmasi asumsi: *"Fastify telah dikonfigurasi dengan trustProxy: true sehingga request.ip mengambil IP klien terluar dari header X-Forwarded-For Caddy."*
  - `app.ts:151-163` juga memakai `request.ip` untuk bucket.
- **Keyakinan:** **KEMUNGKINAN BESAR** (perilaku append XFF Caddy adalah default; tanpa akses server tidak bisa dipastikan apakah ada `trusted_proxies`).
- **Framework:** OWASP A04/A07, ASVS V13.1/V14.2, STRIDE Spoofing.
- **Akar masalah (5 Whys):**
  1. Mengapa IP bisa dipalsukan? → `trustProxy: true` mempercayai nilai XFF yang dikirim klien.
  2. Mengapa true? → Agar `request.ip` benar di belakang Caddy tanpa konfigurasi.
  3. Mengapa tidak dibatasi? → Tidak ada daftar proxy tepercaya (loopback/CIDR container).
  4. Mengapa dampaknya besar? → IP adalah satu-satunya kunci throttle login dan hash audit.
  5. Mengapa tidak terdeteksi? → Tidak ada test yang mengirim XFF palsu; audit menganggap "di belakang Caddy" cukup.
- **Risiko:** Brute force password staf tanpa batas efektif (5/menit/IP dapat di-reset tiap request dengan XFF baru); audit `ipHashPrefix8` menyesatkan investigasi; rate limit global per-IP tidak berguna.
- **FMEA:** **S=7, O=8, D=8 → RPN 448**
- **Collateral damage:** Bila `trustProxy` dimatikan total, semua klien terlihat sebagai IP Caddy → rate limit mengunci seluruh pengguna. Solusi harus **trusted proxy eksplisit** (`trustProxy: 'loopback'` atau IP container Caddy), bukan `false`.
- **Rekomendasi fondasional:** Set `trustProxy` ke daftar CIDR/`loopback` (env `TRUSTED_PROXY_CIDRS`, default aman) dan tambahkan validasi: bila `request.ip` bukan dari trusted proxy, abaikan XFF. Untuk login, gunakan kunci **per akun** (lihat S-004) sehingga spoof IP tidak menolong.
- **Verifikasi:** Kirim `X-Forwarded-For: 1.2.3.4` langsung (tanpa lewat Caddy) → `request.ip` harus IP socket; lewat Caddy → IP asli. Test login 6× dengan XFF berubah → tetap 429 karena per-akun.

---

### S-006 — Operasi sesi WhatsApp lintas tenant lewat `tenantId` dari body/query

- **Tipe:** Horizontal (pola `tenantId` dari klien) / Vertikal (request → service → WAHA tenant B)
- **Lokasi:** `src/routes/admin/waba.subroute.ts:57,74,101,128,162`; `src/routes/admin/waba.subroute.ts:12,236` (read/write hardcode default)
- **Bukti:**
  - `waba.subroute.ts:57` — `const tenantId = request.query?.tenantId || DEFAULT_TENANT_ID;` lalu `getQrForTenant(tenantId)`.
  - `:74`, `:101`, `:128` — sama untuk `session/start|reset|disconnect`.
  - `:162` — `const { cutOff, tenantId = DEFAULT_TENANT_ID } = request.body || {};`
  - `:12` dan `:236` — sebaliknya, GET provider & PATCH provider membaca/menulis `DEFAULT_TENANT_ID` (tidak konsisten).
- **Keyakinan:** **TERBUKTI**.
- **Framework:** OWASP API1:2023 (BOLA), ASVS V4.2, STRIDE Tampering/Information Disclosure.
- **Akar masalah (5 Whys):**
  1. Mengapa tenant bisa dipilih klien? → Route menyalin parameter request langsung ke service.
  2. Mengapa tidak dari sesi? → `AdminSession` tidak menyimpan `tenant_id` (by-design #316), sehingga `tenantId` diambil dari header/body.
  3. Mengapa tidak divalidasi? → Tidak ada `tenantOf()`/`assertTenantAccess()` di subroute ini.
  4. Mengapa route lain sudah? → Migrasi tenant-aware bertahap (#129) menyentuh customers/reservasi/livechat lebih dulu.
  5. Mengapa tidak terdeteksi? → Tidak ada test lintas tenant untuk endpoint provider.
- **Risiko:** Dengan sesi staf/admin tenant A, penyerang dapat meminta QR tenant B dan menautkan perangkat → mengambil alih WhatsApp tenant B; atau memutus sesi tenant B.
- **FMEA:** **S=8, O=5, D=7 → RPN 280**
- **Collateral damage:** Mengganti ke tenant sesi akan memblokir skenario super-admin yang sah mengelola banyak tenant → sediakan jalur eksplisit: `SUPER_ADMIN` boleh `?tenantId=`, staf hanya tenant sesi.
- **Rekomendasi fondasional:** Tambahkan `resolveTenantForRequest(request, { allowSuperAdminOverride: true })` yang: (1) mengambil tenant dari `staffSession.staff.tenant_id`; (2) hanya `SUPER_ADMIN`/API key yang boleh override; (3) memvalidasi tenant ada & aktif. Terapkan ke **semua** subroute yang menerima `tenantId` (waba, backup, export, google, landings, push).
- **Verifikasi:** Test: staf tenant A + `?tenantId=B` → 403/404; super-admin + `?tenantId=B` → 200; `tenantId` tidak ada → tenant sesi.

---

### S-007 — Endpoint tracking publik menerima `tenant_id` dari body dan origin yang dapat dipalsukan

- **Tipe:** Horizontal (endpoint publik) / Vertikal (request → validasi → insert `AdClick`/`PageView`)
- **Lokasi:** `src/routes/tracking.route.ts:278-367` (khusus 294-319, 332-344)
- **Bukti:**
  - `:302` — tanpa API key, otorisasi hanya `isTrustedTrackingOrigin(request)`; `Origin`/`Referer` dapat dikirim bebas oleh klien non-browser.
  - `:319` — `const tenant_id = body.tenantId || body.tenant_id || DEFAULT_TENANT_ID;` → tenant ditentukan oleh penyerang.
  - `:321-323` — IP diambil dari `request.ip` (XFF, lihat S-005).
  - `:282-286` — rate limit 60/menit per IP (spoofable).
- **Keyakinan:** **TERBUKTI** untuk `tenant_id` dari body; **KEMUNGKINAN BESAR** untuk penyalahgunaan karena Origin spoof.
- **Framework:** OWASP API1/API6, ASVS V5.1/V11.1, STRIDE Spoofing/Tampering.
- **Akar masalah (5 Whys):**
  1. Mengapa tenant dari body? → Endpoint dipakai script lintas domain yang mengirim `tenantId` eksplisit.
  2. Mengapa tidak diturunkan dari Origin? → Origin dianggap cukup sebagai autentikasi, padahal tidak kriptografis.
  3. Mengapa tidak ada signature? → Tracking pixel publik sengaja tanpa secret agar mudah dipasang.
  4. Mengapa dampaknya tidak dibatasi? → Tidak ada validasi bahwa `landingUrl`/`Origin` milik tenant yang diklaim.
  5. Mengapa tidak terdeteksi? → Tidak ada monitoring anomali insert per tenant.
- **Risiko:** Atribusi iklan dapat diracuni (tenant A mengirim klik ke tenant B / metrik palsu), tabel `ad_clicks` membengkak (biaya storage), dan laporan konversi menyesatkan keputusan marketing.
- **FMEA:** **S=6, O=9, D=4 → RPN 216**
- **Collateral damage:** Menghapus `tenant_id` dari body dapat mematahkan script landing lama yang belum di-deploy ulang; sediakan fallback: resolve dari `landing_domain`/`landingUrl`, lalu tolak bila tidak cocok (fail-closed) dengan masa transisi env.
- **Rekomendasi fondasional:** Turunkan tenant dari `Origin` **yang terdaftar** (`Tenant.landing_domain`) atau dari `landingUrl` yang host-nya cocok; jika `body.tenantId` ada, jadikan **klaim yang harus diverifikasi** (bukan otoritas). Tambahkan constraint: `AdClick.trackingCode` tetap unik, dan `tenant_id` harus lolos lookup tenant aktif.
- **Verifikasi:** POST dengan `Origin: https://evil.test` + `tenantId` korban → 401; Origin tenant A + `tenantId` B → 403; Origin tenant A tanpa body tenant → tercatat tenant A.

---

### S-008 — Login CSRF / session fixation pada `/api/admin/auth/restore` dan `/api/staff/auth/restore`

- **Tipe:** Horizontal (auth endpoints) / Vertikal (browser korban → restore → cookie sesi penyerang)
- **Lokasi:** `src/app.ts:107-126`; `src/routes/admin.route.ts:87-96`; `src/routes/admin/auth.subroute.ts:217-288`; `src/routes/staff.route.ts:19-26`; `src/routes/staff/auth.subroute.ts:115-162`
- **Bukti:**
  - `app.ts:107` — parser menerima `text/plain` dan mem-`JSON.parse` isinya → body JSON dapat dikirim lewat **simple request** tanpa preflight CORS.
  - `admin.route.ts:88-96` — `/api/admin/auth/restore` (dan login/logout/me) **return lebih awal**, melewati CSRF guard `X-Requested-With` di `:181-197`.
  - `auth.subroute.ts:217-288` — `restore` hanya membaca `body.token`, memvalidasi, lalu `Set-Cookie: admin_session=token`. Tidak ada cek `Origin`/`Referer`/`Sec-Fetch-Site`.
  - `staff.route.ts:20-26` + `staff/auth.subroute.ts:115-162` — pola identik untuk `staff_session`.
- **Keyakinan:** **TERBUKTI** secara mekanisme (cookie di-set dari cross-site form POST). Dampak praktis = **KEMUNGKINAN BESAR** (butuh korban membuka halaman penyerang).
- **Framework:** OWASP A01/A05, ASVS V3.5/V4.3, STRIDE Spoofing/Tampering.
- **Akar masalah (5 Whys):**
  1. Mengapa restore bisa di-CSRF? → Endpoint auth dikecualikan dari guard CSRF.
  2. Mengapa dikecualikan? → Guard CSRF ditempatkan di preHandler yang sama dengan auth; endpoint login/restore harus bisa diakses tanpa sesi.
  3. Mengapa `text/plain` diterima? → Untuk `navigator.sendBeacon` di landing page.
  4. Mengapa tidak ada cek Origin? → Guard mengandalkan header kustom, bukan `Origin`/`Sec-Fetch-Site`.
  5. Mengapa tidak terdeteksi? → Test CSRF hanya menguji endpoint state-changing ber-cookie, bukan `/restore`.
- **Risiko:** Penyerang memaksa browser korban memakai sesi admin/staf milik penyerang ("login CSRF"); korban tanpa sadar mengunggah data/reservasi ke akun penyerang, atau penyerang memancing korban melakukan aksi dengan sesi yang bisa ia pantau (jika token dicuri lewat jalur lain). Juga dapat dipakai untuk mengunci korban dari sesi aslinya.
- **FMEA:** **S=6, O=6, D=9 → RPN 324**
- **Collateral damage:** Menambahkan cek Origin pada `/restore` dapat memblokir PWA yang memanggil dari origin yang sama (aman) atau WebView tanpa Origin (perlu pengecualian eksplisit untuk `Origin: null`?). Solusi: wajibkan `Sec-Fetch-Site: same-origin` **atau** `Origin` sama dengan host, dan **hapus** token dari body response.
- **Rekomendasi fondasional:**
  1. Pisahkan CSRF guard ke hook yang berjalan untuk **semua** POST cookie-auth, termasuk `/restore`; pengecualian hanya `POST /login` dengan verifikasi Origin.
  2. Hentikan pengembalian `token` di body JSON login/restore; cukup `Set-Cookie` HttpOnly. Ini menghapus kebutuhan localStorage (lihat S-011).
  3. Batasi parser `text/plain` ke route tracking/beacon saja (content-type parser scoped), bukan global.
- **Verifikasi:** Test: POST `/api/admin/auth/restore` dengan `Origin: https://evil.test` → 403; tanpa Origin + `Sec-Fetch-Site: cross-site` → 403; same-origin → 200. Pastikan response login tidak lagi memuat field `token`.

---

### S-009 — Endpoint yang mengubah perilaku AI (few-shots, FAQ staging, rollout scope) terbuka untuk staf non-super-admin

- **Tipe:** Horizontal (otorisasi subroute AI) / Vertikal (staf → prompt DB → LLM semua pasien)
- **Lokasi:** `src/routes/admin/settings.subroute.ts:800-1031`; `src/routes/admin/knowledge.subroute.ts` (`general-faq-staging`, `medical-faq-staging`); `src/routes/admin/ai-rollout-scope` (di subroute terkait); `src/routes/admin.route.ts:205-222`
- **Bukti:**
  - `settings.subroute.ts:815-874` — `POST /api/admin/few-shots` menerima `scenario`, `customerMessage`, `idealResponse` dan menyimpannya via `FewShotExemplarBank.createExemplar`.
  - Prefix `superAdminOnlyPrefixes` tidak memuat `/api/admin/few-shots`, `/api/admin/medical-faq-staging`, `/api/admin/general-faq-staging`, `/api/admin/ai-rollout-scope`.
  - `role-scope.service.ts:62-64` → `ADMIN_CS` (unmanaged) dan custom role tanpa scope lolos.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** OWASP LLM01 (Prompt Injection) / LLM06 (Excessive Agency), ASVS V4, STRIDE Tampering.
- **Akar masalah (5 Whys):**
  1. Mengapa staf bisa mengubah few-shot? → Endpoint tidak dilindungi karena bukan "settings" prefix.
  2. Mengapa tidak dianggap sensitif? → Diklasifikasikan sebagai konten, bukan konfigurasi model.
  3. Mengapa klasifikasi salah? → Few-shot masuk ke prompt produksi dan mengubah gaya/kebijakan jawaban LLM.
  4. Mengapa tidak ada review? → Tidak ada approval workflow untuk perubahan prompt.
  5. Mengapa tidak terdeteksi? → Tidak ada audit diff prompt vs exemplar.
- **Risiko:** Staf (atau akun staf yang diretas) dapat menyuntikkan contoh yang mengubah jawaban klinis (mis. menyarankan treatment tidak aman, membocorkan SOP), mempengaruhi **semua pasien**, dan menyalahi mandat klinis. Risiko reputasi & medis.
- **FMEA:** **S=7, O=6, D=7 → RPN 294**
- **Collateral damage:** Membatasi ke super-admin dapat memperlambat iterasi prompt; sediakan alur "draft → review super-admin" agar tetap produktif.
- **Rekomendasi fondasional:** Jadikan few-shot/FAQ staging sebagai **artefak ber-versi** dengan status `DRAFT|APPROVED` dan wajib approval `SUPER_ADMIN` sebelum masuk prompt; guard endpoint tulis dengan `requireSuperAdmin` (S-002), dan tambahkan audit log diff (sebelum/sesudah) — bukan hanya action name.
- **Verifikasi:** Test: `ADMIN_CS` POST few-shot → 403; `SUPER_ADMIN` → 201 + audit diff; prompt builder hanya memuat exemplar `APPROVED`.

---

### S-010 — Landing HTML tenant mana pun dapat ditimpa staf; kegagalan DB dikembalikan sebagai 200 "sukses"

- **Tipe:** Horizontal (otorisasi + error handling) / Vertikal (request → sanitasi → upsert tenant)
- **Lokasi:** `src/routes/admin/landings.subroute.ts:127-207`
- **Bukti:**
  - `:139` — `const { id } = request.params;` (tenant id dari URL, tanpa cek kepemilikan/peran).
  - `:155-168` — `prisma.tenant.upsert({ where: { id }, update: { landing_type, raw_html_content } })` untuk **tenant mana pun**, termasuk membuat tenant baru (`create: { id, slug: id, name: ... }`).
  - `:190-207` — catch: jika error bukan string yang masuk daftar (`Forbidden|http-equiv|wa-cta|Sanitization|HTML`), route membalas **200** `"Raw HTML landing page uploaded (In-Memory Fallback Mode)"` padahal tidak menulis apa pun.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** OWASP A01/A09, ASVS V4.2/V7.1, STRIDE Tampering/Repudiation.
- **Akar masalah (5 Whys):**
  1. Mengapa staf bisa menimpa tenant lain? → Tidak ada `resolveTenant...`/role check di route.
  2. Mengapa `id` dari URL dipercaya? → Route dibuat untuk super-admin SaaS.
  3. Mengapa fallback 200? → Pola "jangan ganggu UI" yang menelan kegagalan DB.
  4. Mengapa pola itu ada? → Test offline butuh app tetap merespons.
  5. Mengapa tidak terdeteksi? → Tidak ada test cross-tenant & tidak ada assertion bahwa DB benar-benar berubah.
- **Risiko:** Defacement landing page tenant lain (termasuk milik klien SaaS), injeksi konten phishing (sanitizer memblokir script, tetapi konten HTML/CSS tetap bisa menyesatkan), dan operator mengira perubahan tersimpan padahal tidak (ghost success) → kehilangan konten saat deploy berikutnya.
- **FMEA:** **S=7, O=5, D=6 → RPN 210**
- **Collateral damage:** Mengubah fallback 200 → 503 dapat memunculkan error di UI saat DB down; itu yang diinginkan (jujur), tetapi frontend perlu menampilkan pesan. Uji `Landings.tsx`.
- **Rekomendasi fondasional:**
  1. Gunakan `assertCanManageTenant(request, id)`: super-admin boleh semua; staf hanya tenant sesi; tenant harus ada (untuk update, bukan upsert buta).
  2. Hapus `create` pada upsert; pembuatan tenant adalah operasi terpisah.
  3. Ganti `200 In-Memory Fallback` menjadi `503 { code: 'DB_UNAVAILABLE', retryable: true }`.
  4. Simpan versi HTML sebelumnya (kolom `previous_raw_html`/audit snapshot) agar rollback mungkin.
- **Verifikasi:** Test: staf tenant A PUT `/api/admin/tenant/B/html` → 403; DB down (mock) → 503 (bukan 200); super-admin PUT tenant B → 200 + row berubah (assert DB).

---

### S-011 — Token sesi disimpan di `localStorage`, TTL 30 hari, dan dashboard `/admin/*` tidak memiliki CSP

- **Tipe:** Horizontal (desain sesi) / Vertikal (login → localStorage → XSS → token)
- **Lokasi:** `packages/admin-dashboard/src/contexts/AuthContext.tsx:57,180`; `src/services/admin-session.service.ts:16`; `src/routes/admin.route.ts:476-486`; `Caddyfile:10-16`
- **Bukti:**
  - `AuthContext.tsx:57` — `localStorage.getItem(TOKEN_STORAGE_KEY)`; `:180` — `localStorage.removeItem(TOKEN_STORAGE_KEY)` (token cadangan disimpan di localStorage).
  - `admin-session.service.ts:16` — `const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Days`.
  - `admin.route.ts:476-486` — index SPA dikirim hanya dengan `Cache-Control`; tidak ada CSP.
  - `Caddyfile:10-16` — HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy; **tidak ada `Content-Security-Policy`**.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** OWASP A03/A07, ASVS V3.2/V8.2/V14.4, STRIDE Information Disclosure.
- **Akar masalah (5 Whys):**
  1. Mengapa token ada di localStorage? → Fallback PWA saat cookie hilang (komentar di `auth.subroute.ts:212-216`).
  2. Mengapa cookie saja tidak cukup? → WebView/PWA Android kadang membuang cookie.
  3. Mengapa 30 hari? → Mengurangi logout yang dikeluhkan.
  4. Mengapa tanpa CSP? → Header keamanan hanya dipasang di Caddy untuk halaman publik; SPA admin tidak.
  5. Mengapa tidak terdeteksi? → Tidak ada audit header untuk `/admin/*`; scanner tidak memeriksa runtime header.
- **Risiko:** Satu XSS (dari dependensi, konten inject, atau ekstensi browser) → token 30 hari dicuri → akses penuh admin tanpa perlu password/API key. Tanpa CSP, mitigasi XSS hilang.
- **FMEA:** **S=8, O=4, D=8 → RPN 256**
- **Collateral damage:** CSP ketat dapat memblokir inline script Vite/service worker; perlu nonce/hash dan uji PWA. Menghapus fallback localStorage dapat mengembalikan keluhan logout di PWA Android → sediakan refresh token HttpOnly berumur pendek.
- **Rekomendasi fondasional:**
  1. Tambahkan CSP untuk `/admin/*` (minimal `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'`), plus `Permissions-Policy`.
  2. Ganti model sesi: access token HttpOnly 30–60 menit + refresh token HttpOnly 30 hari dengan rotasi & deteksi reuse; **hapus** token dari body JSON dan localStorage.
  3. Turunkan TTL sesi admin; tambahkan idle timeout dan daftar sesi aktif + revoke.
- **Verifikasi:** `curl -I https://.../admin/` → CSP ada; login → response tidak memuat `token`; DevTools Application → tidak ada token di localStorage; XSS simulasi (`alert`) diblokir CSP.

---

### S-012 — Tidak ada kebijakan password staf, tidak ada lockout per akun, dan `role` bebas diisi

- **Tipe:** Horizontal (manajemen kredensial) / Vertikal (create staff → login → brute force)
- **Lokasi:** `src/routes/admin/staff-management.subroute.ts:66-106`; `src/utils/bcrypt.ts:3`; `src/routes/admin/auth.subroute.ts:58-72,127-143`
- **Bukti:**
  - `staff-management.subroute.ts:69-74` — hanya cek `!password` (non-empty). Tidak ada panjang/kompleksitas.
  - `:77` — `const finalRole = role ? String(role).trim().toUpperCase() : 'THERAPIST';` — tidak divalidasi terhadap daftar role/custom role.
  - `:96` — `hashPassword(password)` (bcrypt cost 12, baik).
  - Login: rate limit 5/menit **per IP saja** (`auth.subroute.ts:58-72`), tidak ada counter per akun; IP spoofable (S-005).
- **Keyakinan:** **TERBUKTI**.
- **Framework:** OWASP A07, ASVS V2.1/V2.2/V2.3, NIST CSF PR.AC.
- **Akar masalah (5 Whys):**
  1. Mengapa password lemah diterima? → Tidak ada validator.
  2. Mengapa tidak ada validator? → Registrasi staf dibuat untuk operasional cepat (bidan di lapangan).
  3. Mengapa tidak ada lockout? → Throttle dianggap cukup.
  4. Mengapa throttle tidak cukup? → Kunci per IP + XFF spoof.
  5. Mengapa role bebas? → Role adalah string bebas, bukan FK ke `CustomRole`/enum.
- **Risiko:** Akun staf dengan password "123" dapat ditebak; setelah masuk, akses ke PII pasien & live chat. Role typo (`MARKETING`) jatuh ke unmanaged → akses penuh (S-003).
- **FMEA:** **S=7, O=6, D=6 → RPN 252**
- **Collateral damage:** Kebijakan password dapat menyulitkan staf lapangan; terapkan minimal 10 karakter + larangan password umum, bukan aturan simbol rumit. Validasi role harus menyediakan migrasi untuk role lama yang tidak dikenal.
- **Rekomendasi fondasional:**
  1. Validator password di satu modul (`validatePasswordPolicy`) dipakai create & reset.
  2. Tambah kolom `failed_login_count`, `locked_until` di `staff` + kunci per akun (bukan per IP).
  3. Validasi `role` terhadap `CustomRole`/enum; tolak role tak dikenal.
  4. Wajibkan ganti password saat login pertama (flag `must_change_password`).
- **Verifikasi:** POST staff password `"123"` → 400; 6 login gagal untuk akun sama dari IP berbeda → 423/429; role `"XYZ"` → 400.

---

### S-013 — `security:scan` memberi "PASS" semu: hanya memindai file berubah, tidak memindai seluruh tracked tree, dan tidak mendeteksi key generik

- **Tipe:** Horizontal (kontrol deteksi) / Vertikal (CI → commit → repo publik)
- **Lokasi:** `scripts/scan-secrets.ts:21-70,127-175`
- **Bukti:**
  - `:132-147` — default mode: `git status --porcelain`; bila tidak ada file berubah → `"Tidak ada file yang perlu diperiksa"` → **exit 0** (PASS).
  - `:149` — `--staged` hanya `git diff --cached --name-only`.
  - `.env` yang di-ignore **tidak pernah muncul** di `git status` → aturan "tolak .env" (`:80-88`) tidak pernah terpicu pada run normal.
  - Aturan hanya `kn-`, `sk-`, `AIza`, `EAAR`, ORS JWT, PEM → **tidak** mencakup `ADMIN_API_KEY`, hex 32/64, `postgres://user:pass@`, token Telegram.
  - Fase 11 (`docs/audit/2026-11-02/fase-11/LAPORAN_FASE_11.md` 11.2) mengklaim *"Memindai seluruh staged & working tree — 0 file bocor"* → klaim ini **tidak sesuai implementasi**.
- **Keyakinan:** **TERBUKTI** (kode + hasil pencarian S-001 yang lolos scanner).
- **Framework:** NIST CSF DE.CM, OWASP A08/A09, ASVS V1.14/V10.
- **Akar masalah (5 Whys):**
  1. Mengapa scanner lulus? → Tidak ada file berubah / file berubah tidak memuat pola.
  2. Mengapa hanya file berubah? → Optimasi kecepatan pre-commit.
  3. Mengapa tidak ada mode penuh? → Tidak diminta saat pembuatan.
  4. Mengapa aturan sempit? → Fokus pada vendor LLM/Meta, bukan kredensial internal.
  5. Mengapa audit percaya? → Laporan mengambil exit code, bukan cakupan.
- **Risiko:** Kredensial/password masuk repo publik tanpa terdeteksi (S-001 adalah bukti hidup); audit berikutnya kembali "PASS" palsu → rasa aman yang salah.
- **FMEA:** **S=6, O=9, D=8 → RPN 432** (kegagalan kontrol deteksi)
- **Collateral damage:** Mode `--all` pada repo besar bisa lambat (ribuan file) → batasi ekstensi & jalankan di CI, bukan tiap save. Menambah aturan dapat menghasilkan false positive pada test fixture → sediakan allowlist eksplisit (`tests/**`, `.env.example`).
- **Rekomendasi fondasional:** Jadikan scanner sebagai **kontrol CI wajib** dengan tiga mode: `--staged`, `--all` (default CI), `--diff <base>`. Tambah aturan & unit test untuk pola baru. Catat hash hasil scan di CI artifact agar bisa diaudit.
- **Verifikasi:** `npm run security:scan -- --all` pada HEAD saat ini harus **FAIL** (menemukan S-001) sebelum purge, lalu **PASS** setelah purge. Tambah test `tests/unit/secret-scanner.test.ts` yang menyuntikkan key dummy dan memastikan terdeteksi.

---

### S-014 — Sisa risiko media: avatar publik + tenant hardcode + filter SSRF tidak lengkap + `/proof` tanpa guard MEDIA_ROOT

- **Tipe:** Horizontal (media) / Vertikal (request → resolver → filesystem/HTTP)
- **Lokasi:** `src/routes/media.route.ts:99-123,360-435,442-485`; `src/services/media.service.ts:478-482`
- **Bukti:**
  - `:360-374` — `/media/avatar/:customerId` **publik**, lookup `customerService.getCustomerById(rawId, 'default-tenant')` (hardcode).
  - `:99-118` — `isValidExternalUrl` hanya memblokir string literal `localhost`, `127.0.0.1`, `10.`, `172.16-31.`, `192.168.`, `169.254.`; **tidak** memblokir `http://2130706433/`, `http://0x7f000001/`, `http://[::ffff:127.0.0.1]/`, atau DNS rebinding.
  - `:442-484` — `/proof/:reservationId` publik; memakai `filePathFromRelativeUrl` **tanpa** pemeriksaan `startsWith(MEDIA_ROOT)` yang ada di route `/media` (`:212-217`).
  - `media.service.ts:479` — regex `[^/]+` mengizinkan segmen `..`.
- **Keyakinan:** **TERBUKTI** untuk hardcode & tidak adanya guard; **KEMUNGKINAN BESAR** untuk SSRF bypass (tergantung resolver axios/OS).
- **Framework:** OWASP A01/A10, ASVS V5.3/V12.6, STRIDE Information Disclosure/SSRF.
- **Akar masalah (5 Whys):**
  1. Mengapa avatar publik? → Dipakai `<img>` di dashboard tanpa header auth.
  2. Mengapa tenant hardcode? → Route lama sebelum multi-tenant.
  3. Mengapa filter SSRF tidak lengkap? → Pencocokan string, bukan resolusi IP.
  4. Mengapa `/proof` tanpa guard? → Dibuat setelah hardening `/media` dan tidak memakai helper yang sama.
  5. Mengapa tidak terdeteksi? → Test media hanya menguji `/media` dan traversal `..`, bukan IP alternatif.
- **Risiko:** SSRF ke metadata cloud/internal service (jika DNS/IP alternatif lolos); enumerasi foto pasien via ID (ID UUID → sulit, tetapi endpoint publik tetap PII); pembacaan file di luar `storage/media` bila `proof_url` DB dapat dikendalikan (mis. via backup restore).
- **FMEA:** **S=5, O=4, D=8 → RPN 160**
- **Collateral damage:** Membuat avatar wajib auth akan mematahkan `<img>` yang tidak mengirim cookie (audio/img tag) — perlu signed URL berumur pendek, bukan cookie. Menutup `/proof` mematahkan tautan di Google Sheets → sediakan signed URL/expiry.
- **Rekomendasi fondasional:** (1) Resolusi IP sebenarnya (`dns.lookup`) + tolak private/link-local/loopback sebelum fetch (tanpa dependency baru, pakai `net.isIP` + `dns.promises`); (2) signed URL (HMAC + exp) untuk avatar/proof, bukan endpoint publik permanen; (3) pusatkan validasi path di `mediaService.resolveSafeMediaPath()` yang dipakai **semua** route; (4) hapus hardcode `'default-tenant'` → ambil dari customer row/tenant context.
- **Verifikasi:** Test SSRF: URL `http://2130706433/`, `http://[::ffff:127.0.0.1]/` → ditolak; `/proof/<id>` dengan `proof_url=/media/outbound/../../etc/passwd` → 404; avatar customer tenant B diakses staff tenant A → 404.

---

### S-015 — Satu `WAHA_WEBHOOK_SECRET` global dipakai untuk semua tenant dan disimpan sebagai custom header di konfigurasi WAHA tiap tenant

- **Tipe:** Horizontal (webhook multi-tenant) / Vertikal (tenant → WAHA config → event palsu)
- **Lokasi:** `src/services/whatsapp-provider.service.ts:208-246`; `src/routes/webhook.route.ts:72-88`; `src/app.ts:41-48`
- **Bukti:**
  - `whatsapp-provider.service.ts:211` — `const secret = process.env.WAHA_WEBHOOK_SECRET || '';`
  - `:234-236` — `webhook.customHeaders = [{ name: 'X-Webhook-Secret', value: secret }]`; config ini dikirim ke WAHA dan dapat dibaca siapa pun yang mengelola WAHA/dashboard tenant.
  - `webhook.route.ts:81-87` — verifikasi hanya membandingkan header dengan secret global; tidak ada secret per tenant/session.
  - `app.ts:41-48` — secret wajib di produksi, tetapi tetap **satu nilai**.
- **Keyakinan:** **TERBUKTI** (desain). Dampak lintas tenant = **KEMUNGKINAN BESAR** pada model BYO-WAHA/multi-instance.
- **Framework:** OWASP API8:2023 (Security Misconfiguration), ASVS V2.10/V6.4, STRIDE Spoofing.
- **Akar masalah (5 Whys):**
  1. Mengapa satu secret? → Dirancang saat single-tenant.
  2. Mengapa disimpan di WAHA? → WAHA hanya mendukung custom header statis.
  3. Mengapa tidak per tenant? → `resolveTenantBySession` baru menambahkan isolasi **setelah** verifikasi.
  4. Mengapa belum diubah? → Belum ada kebutuhan operasional multi-WAHA.
  5. Mengapa tidak terdeteksi? → Tidak ada test forge event antar-session.
- **Risiko:** Tenant yang memiliki akses ke WAHA-nya (atau staf yang bisa membaca config WAHA) dapat mengirim `POST /webhook` dengan `session` milik tenant lain dan header secret yang benar → menyuntikkan pesan/palsu percakapan, memicu balasan AI ke pasien tenant lain.
- **FMEA:** **S=7, O=3, D=8 → RPN 168**
- **Collateral damage:** Mengganti ke HMAC per-session menuntut perubahan konfigurasi WAHA tiap tenant dan window transisi (dual-verify). Menyentuh WAHA = **2-step verification + WARNING**.
- **Rekomendasi fondasional:** Turunkan secret dari tabel `Tenant` (mis. `waha_webhook_secret_encrypted`) + verifikasi **HMAC atas raw body** (`X-Webhook-Signature`) dengan secret tenant yang di-resolve dari `session`; header statis hanya fallback selama transisi. Simpan secret terenkripsi (`encryptSecret`).
- **Verifikasi:** Test: event `session=A` ditandatangani secret B → 401; secret A → 200; rotasi secret tenant A tidak mempengaruhi tenant B.

---

### S-016 — Hardening deployment: container app berjalan sebagai root, tanpa `cap_drop`, dan terhubung ke `hermes-net` bersama agen pihak ketiga

- **Tipe:** Horizontal (infrastruktur) / Vertikal (container compromise → lateral movement → app:3000)
- **Lokasi:** `docker-compose.yml:6-73,101-110,154-166,168-211`; `Dockerfile` (runner stage, tidak ada `USER node`)
- **Bukti:**
  - `Dockerfile` runner: `FROM node:20-slim AS runner`, tidak ada `USER`; semua proses berjalan sebagai root.
  - `docker-compose.yml` app/worker: tidak ada `read_only`, `cap_drop`, `security_opt: no-new-privileges`, `tmpfs`.
  - `docker-compose.yml:73,110,166` — app, worker, dan caddy tergabung di `hermes-net` (external), bersama `hermes-agent`/`hermes-9router` (`Caddyfile:65-84`).
  - `Caddyfile` — hanya Caddy yang mem-publish `80/443`; app `expose: 3000` (baik), tetapi anggota `hermes-net` dapat menghubungi `app:3000` langsung, melewati header/CSP Caddy.
- **Keyakinan:** **TERBUKTI** untuk konfigurasi; dampak lateral = **KEMUNGKINAN BESAR**.
- **Framework:** NIST CSF PR.IP/PR.AC, CIS Docker Benchmark, STRIDE Elevation of Privilege.
- **Akar masalah (5 Whys):**
  1. Mengapa app di hermes-net? → Kebutuhan komunikasi dengan Hermes (agent/9router).
  2. Mengapa tidak dibatasi? → Tidak ada network policy/firewall internal.
  3. Mengapa root? → Dockerfile default, belum dioptimalkan.
  4. Mengapa tidak ada cap_drop? → Fokus fitur, bukan hardening.
  5. Mengapa tidak terdeteksi? → Tidak ada review CIS/komposisi jaringan.
- **Risiko:** Jika `hermes-agent` (yang punya endpoint publik) dieksploitasi, penyerang dapat menjangkau `app:3000` tanpa TLS/Caddy, memalsukan XFF (S-005), dan memanggil endpoint yang mengandalkan header Caddy. Eskalasi dari container app (root) memperbesar dampak.
- **FMEA:** **S=6, O=3, D=8 → RPN 144**
- **Collateral damage:** `read_only` dapat mematahkan penulisan `storage/`, `logs/`, dan cache Prisma → butuh `tmpfs`/volume eksplisit. Memisahkan network dapat memutus integrasi Hermes yang sedang dipakai.
- **Rekomendasi fondasional:** Pisahkan network: `app` hanya `default` + network internal khusus Hermes (tanpa akses dari container lain), gunakan `USER node`, `cap_drop: [ALL]`, `security_opt: no-new-privileges:true`, `read_only` + volume untuk storage/logs/tmp. Tambahkan healthcheck worker.
- **Verifikasi:** `docker inspect` → `User` bukan root, `CapDrop=ALL`; dari container `hermes-agent`, `curl app:3000/health` → gagal; dari Caddy → 200.

---

### Ar-001 — Graceful shutdown belum menyeluruh: 4 `setInterval` liar + timer stagger tidak dibatalkan

- **Tipe:** Horizontal (pola lifecycle) / Vertikal (SIGTERM → clear intervals → Prisma disconnect → interval liar menembak DB)
- **Lokasi:** `src/lifecycle/interval-registry.ts:16-32`; `src/lifecycle/background-crons.ts:5-12`; `src/services/waha-monitor.service.ts:35-45`; `src/services/admin-session.service.ts:280-282`; `src/services/response-cache.service.ts:16-22`; `src/app.ts:300-302`
- **Bukti:**
  - `interval-registry.ts:16-20` — hanya `setInterval` yang didaftarkan yang bisa dibersihkan.
  - `background-crons.ts:5-11` — `trackIntervalStaggered` membuat `setTimeout(jitter)` yang **tidak disimpan**; `clearAllIntervals()` tidak membatalkannya. Bila SIGTERM datang sebelum jitter, `fn()` tetap jalan setelah shutdown dan mendaftarkan interval baru.
  - `waha-monitor.service.ts:38` — `this.intervalId = setInterval(...)`; `app.ts:301` memanggil `.start()` tanpa `trackInterval`.
  - `admin-session.service.ts:280` — `setInterval(cleanupExpiredSessions, 1h)` tanpa registry.
  - `response-cache.service.ts:18` — `setInterval(cleanup, 30s)` tanpa registry (di-`unref`, tetapi tetap jalan).
  - `shutdown.ts:42-90` — urutan 7 tahap benar, tetapi tidak mencakup interval liar.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** Well-Architected Reliability (REL-8/REL-9), NIST CSF PR.IP, ASVS V1.14.
- **Akar masalah (5 Whys):**
  1. Mengapa interval liar? → Registry hanya diadopsi untuk cron di `background-crons.ts`.
  2. Mengapa service memakai `setInterval` langsung? → Dibuat sebelum registry ada / untuk `unref`.
  3. Mengapa stagger timer tidak dilacak? → Registry hanya menyimpan handle interval, bukan timeout awal.
  4. Mengapa tidak terdeteksi? → Test lifecycle hanya memeriksa cron yang terdaftar.
  5. Mengapa penting? → Setelah `prisma.$disconnect()`, interval liar memicu error beruntun dan dapat menulis sebagian (WAHA monitor/session cleanup) saat deploy.
- **Risiko:** Log error palsu saat deploy; potensi query ke DB yang sudah ditutup; session cleanup bisa berjalan di tengah shutdown; `process.exit(0)` memotong pekerjaan yang belum selesai. Klaim "cron dihentikan pertama" tidak berlaku untuk 4 interval ini.
- **FMEA:** **S=5, O=8, D=6 → RPN 240**
- **Collateral damage:** Memindahkan semua interval ke registry dapat membuat service yang mengandalkan `unref` (response-cache) menggantung proses bila lupa `unref`; registry perlu opsi `unref`. WAHA monitor perlu dihentikan eksplisit agar status tidak "stale" di dashboard.
- **Rekomendasi fondasional:** (1) `trackInterval` menerima opsi `{ unref, name }`; (2) `trackIntervalStaggered` mendaftarkan **timeout** ke registry yang sama; (3) ganti 3 `setInterval` service dengan `trackInterval`; (4) `WahaMonitorService.stop()` dipanggil di shutdown; (5) test: `activeIntervalCount()` = 0 setelah `clearAllIntervals()` + tidak ada timer tersisa (`process._getActiveHandles`).
- **Verifikasi:** Test baru `lifecycle-completeness.test.ts`: boot → `startBackgroundCrons()` + `WahaMonitor.start()` + `ResponseCache` + `AdminSession` → `clearAllIntervals()` → assert semua handle 0 dan tidak ada `fn` terpanggil setelah 2× interval (fake timers).

---

### Ar-002 — Boot tenant data tidak terisolasi per tenant dan server menerima trafik sebelum konfigurasi siap

- **Tipe:** Horizontal (boot) / Vertikal (listen → load tenant → cron)
- **Lokasi:** `src/app.ts:229-271`; `src/worker.ts:90-114`
- **Bukti:**
  - `app.ts:229` — `server.listen(...)` dipanggil lebih dulu; callback baru memuat katalog/persona/AI config.
  - `:256-267` — `for (const tid of tenantIds) { await loadServicesFromDb(tid); ... }` **tanpa try/catch per tenant**; satu tenant gagal → `catch` di `:269` menghentikan seluruh loop → tenant berikutnya tidak dimuat.
  - `:263-266` — hanya `AiEligibilityConfigService` yang memberi peringatan fail-closed; service lain diam.
  - `worker.ts:104-110` — pola yang sama.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** Well-Architected Reliability (REL-5/REL-11), NIST CSF PR.IP.
- **Akar masalah (5 Whys):**
  1. Mengapa tenant lain tidak dimuat? → `await` berurutan dalam satu `try`.
  2. Mengapa tidak per-tenant? → Diasumsikan semua tenant sehat.
  3. Mengapa server sudah listen? → Ingin healthcheck cepat.
  4. Mengapa berbahaya? → Request masuk memakai fallback/hardcode sementara konfigurasi asli belum ada.
  5. Mengapa tidak terdeteksi? → Tidak ada readiness gate yang menunggu inisialisasi selesai.
- **Risiko:** Selama window boot (detik–puluhan detik), chatbot dapat membalas dengan katalog/persona default atau harga kosong; satu tenant dengan data korup mematikan konfigurasi tenant lain; `/ready` bisa 200 sebelum config siap.
- **FMEA:** **S=6, O=5, D=6 → RPN 180**
- **Collateral damage:** Menahan `listen` sampai config siap dapat memperlambat startup & memicu healthcheck restart loop bila DB lambat → gunakan status `STARTING` + `/ready` 503 sampai selesai, bukan menunda `listen`.
- **Rekomendasi fondasional:** (1) `Promise.allSettled` per tenant + log terstruktur per tenant; (2) flag `appReady` di health/ready; (3) fallback per tenant yang eksplisit (bukan diam); (4) boot idempotent & retry dengan backoff untuk tenant yang gagal.
- **Verifikasi:** Test: mock `loadServicesFromDb` gagal untuk tenant A saja → tenant B tetap dimuat; `/ready` = 503 selama inisialisasi, 200 setelah selesai; request chatbot sebelum ready → 503 (bukan jawaban fallback).

---

### Ar-003 — Isolasi multi-tenant tidak konsisten: 325 referensi `DEFAULT_TENANT_ID` di route, tenant admin dari header, dan login staf hardcode default

- **Tipe:** Horizontal (tenant context) / Vertikal (request → hook → service → query)
- **Lokasi:** `src/config/tenant.ts:1`; `src/routes/admin/route-helpers.ts:5-15`; `src/routes/admin.route.ts:115,149,158`; `src/routes/admin/auth.subroute.ts:133-143`; `src/routes/staff/auth.subroute.ts:41-51`; `src/routes/admin/settings.subroute.ts:39-41`
- **Bukti:**
  - `tenant.ts` hanya berisi `export const DEFAULT_TENANT_ID = 'default-tenant';` — tidak ada resolver context.
  - `admin.route.ts:115` & `:158` — `request.tenantId = (request.headers['x-tenant-id'] as string) || DEFAULT_TENANT_ID;` → tenant dipilih klien (API key/sesi admin).
  - `tenantOf()` (`route-helpers.ts:6`) juga menerima `x-tenant-id`/`?tenant_id` sebagai fallback.
  - `auth.subroute.ts:133-143` — login staf memfilter `tenant_id: DEFAULT_TENANT_ID`; `staff/auth.subroute.ts:41-51` — login staf **menerima `tenantId` dari body**. Dua kontrak berbeda.
  - Hitungan: **325** referensi `DEFAULT_TENANT_ID` di `src/routes/**/*.ts`; `tenantOf(` hanya di 6 file (customers, analytics, reservation-crud/series/dispatch, meta-attribution, staff-retention).
  - `settings.subroute.ts:39-41` — `resolveTenantId` fallback default (tanpa fail-closed).
- **Keyakinan:** **TERBUKTI**.
- **Framework:** Well-Architected Security/SaaS, OWASP API1, ASVS V4.2, STRIDE Information Disclosure.
- **Akar masalah (5 Whys):**
  1. Mengapa masih hardcode? → Migrasi tenant-aware bertahap (#129) baru menyentuh sebagian modul.
  2. Mengapa bertahap? → `AdminSession` tidak punya `tenant_id`, sehingga butuh keputusan model (super-admin lintas tenant vs binding).
  3. Mengapa login staf tidak konsisten? → `/api/admin/auth/login` dibuat lebih dulu (default), `/api/staff/auth/login` menerima tenant dari body agar terapis tenant lain bisa masuk.
  4. Mengapa `x-tenant-id` dipercaya? → Dianggap hanya super-admin yang punya sesi admin.
  5. Mengapa tidak ada yang mencegah? → Tidak ada satu seam `TenantContext` yang wajib dipakai semua query.
- **Risiko:** (a) Data tenant B terbaca/tertulis lewat `x-tenant-id`/body oleh aktor yang punya sesi; (b) tenant baru tidak bisa login karena hardcode; (c) kebocoran PII lintas tenant pada SaaS. Ini **memperbesar** dampak S-002/S-006/S-010.
- **FMEA:** **S=8, O=7, D=7 → RPN 392**
- **Collateral damage:** Memaksa tenant context di semua route dapat memblokir endpoint yang memang global (health, webhook, landing publik) → whitelist eksplisit. Migrasi `Staff.phone` unique (Ar-004) harus bersamaan agar tenant baru bisa onboarding.
- **Rekomendasi fondasional:** Buat seam tunggal `resolveTenantContext(request)` yang mengembalikan `{ tenantId, source, isSuperAdmin }` dengan aturan: staf → dari sesi (wajib); admin API key/sesi → `x-tenant-id` hanya bila `SUPER_ADMIN` dan tenant valid; selain itu fail-closed 401. Ubah `DEFAULT_TENANT_ID` menjadi **seed-only**, bukan fallback runtime (grep gate di CI: count harus turun ke 0 di route).
- **Verifikasi:** Test: staf tenant A ke customers → hanya A; super-admin `x-tenant-id=B` → B; staf tenant A `x-tenant-id=B` → 403; `DEFAULT_TENANT_ID` hanya muncul di seed/migrasi (grep gate).

---

### Ar-004 — Constraint skema masih global: `Staff.phone`, `AdClick.trackingCode`, `LandingPage.slug` unik lintas tenant

- **Tipe:** Horizontal (skema) / Vertikal (onboarding tenant → insert → unique violation)
- **Lokasi:** `prisma/schema.prisma:1012` (`Staff.phone @unique`), `:693` (`trackingCode String? @unique`), `:805,823` (`slug String @unique`)
- **Bukti:**
  - `schema.prisma:1012` — `phone String @unique` di model `Staff` (Customer sudah `@@unique([tenant_id, phone])` di `:155`).
  - `:693` — `trackingCode String? @unique` (global).
  - `:805`/`:823` — `slug String @unique` pada model landing.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** SaaS readiness, Well-Architected Data, ASVS V1.14.
- **Akar masalah (5 Whys):**
  1. Mengapa unik global? → Skema awal single-tenant.
  2. Mengapa Customer sudah diperbaiki? → Audit SaaS sebelumnya menyoroti Customer.phone.
  3. Mengapa Staff tidak? → Terlewat karena daftar blocker hanya menyebut Customer/AdClick.
  4. Mengapa AdClick belum? → Tracking code dibuat global unik (2–4 karakter) agar lookup cepat.
  5. Mengapa tidak terdeteksi? → Tidak ada test onboarding dua tenant.
- **Risiko:** Tenant kedua tidak bisa memakai nomor HP staf yang sama (umum di klinik jaringan); slug landing bentrok; tracking code collision antar tenant memetakan klik ke tenant salah.
- **FMEA:** **S=6, O=4, D=5 → RPN 120**
- **Collateral damage:** Migrasi unique composite pada tabel besar (`staff`, `ad_clicks`) butuh lock/indeks baru; `trackingCode` 2–4 karakter mungkin **tidak cukup** unik global — mengubahnya menjadi per-tenant mengubah kontrak URL. **Confirmation Gate** wajib.
- **Rekomendasi fondasional:** Rancang migrasi bertahap: (1) `Staff @@unique([tenant_id, phone])`; (2) `AdClick @@unique([tenant_id, tracking_code])` + generator code per tenant; (3) `LandingPage @@unique([tenant_id, slug])`; (4) backfill & validasi duplikat sebelum drop index lama. Jangan jalankan tanpa backup & dry-run.
- **Verifikasi:** `prisma migrate diff` → empty setelah migrasi; test insert dua tenant dengan phone/slug sama → sukses; tracking lookup tenant-scoped.

---

### Ar-005 — Degradasi DB silent & "false success": banyak route mengembalikan 200 + data kosong saat DB gagal

- **Tipe:** Horizontal (error handling) / Vertikal (DB down → catch → 200 → UI)
- **Lokasi:** `src/routes/admin/settings.subroute.ts:2572-2582` (notifications logs); `src/routes/admin/landings.subroute.ts:190-207`; `src/routes/admin/roles.subroute.ts:47-54`; `src/routes/admin/backup.subroute.ts:29,75,112,149,207,245`
- **Bukti:**
  - `settings.subroute.ts` (GET `/api/admin/settings/notifications/logs`) — `catch → reply.status(200).send({ success:true, data: [], note: 'DB offline: ' + err.message })`.
  - `landings.subroute.ts:202-206` — `catch → 200 "In-Memory Fallback Mode"` (tidak menulis).
  - `roles.subroute.ts:47-54` — DB error → 200 + fallback in-memory.
  - `backup.subroute.ts:28-30` — `500 { error: err.message }` (kebalikan: membocorkan detail).
- **Keyakinan:** **TERBUKTI**.
- **Framework:** Well-Architected Reliability/Observability, NIST CSF DE.AE, ASVS V7.4.
- **Akar masalah (5 Whys):**
  1. Mengapa 200? → Agar dashboard "tidak error" saat DB down.
  2. Mengapa itu dipilih? → Pengalaman blank page (#125) membuat tim menghindari error.
  3. Mengapa tidak ada status terstruktur? → Tidak ada kontrak `degraded: true` + HTTP 503.
  4. Mengapa tidak terdeteksi? → Test offline justru mengharapkan 200 (mock DB reject).
  5. Mengapa berbahaya? → Operator mengambil keputusan (jadwal kosong, backup sukses) dari data yang tidak nyata.
- **Risiko:** Bidan melihat "tidak ada jadwal hari ini" padahal DB mati → pasien terlewat; admin mengira backup dibuat; perubahan role/landing hilang tanpa peringatan. Ini risiko operasional/klinis (S=6) dan sulit dideteksi (D=8).
- **FMEA:** **S=6, O=8, D=8 → RPN 384**
- **Collateral damage:** Mengubah ke 503 dapat memicu retry storm dari frontend/PWA; sediakan `Retry-After` + backoff di `api.ts` (sudah ada untuk auth) dan bedakan "DB down" vs "data kosong".
- **Rekomendasi fondasional:** Terapkan kontrak tunggal: **read** yang gagal karena dependency → `503 { code:'DEPENDENCY_UNAVAILABLE', retryable:true }`; **write** yang gagal → `5xx` + tidak ada klaim sukses. Fallback in-memory hanya untuk `NODE_ENV==='test'` (pola yang sudah dipakai `customer.service`). Tambah health metric `dbDegradedCount`.
- **Verifikasi:** Test dengan Prisma mock reject: GET logs → 503; PUT landing → 503 (bukan 200); UI menampilkan banner "Data tidak tersedia". Grep gate: `status(200)` di dalam `catch` pada route admin = 0 (kecuali test-mode).

---

### Ar-006 — Tidak ada global error handler & korelasi request; pesan error mentah bocor ke klien

- **Tipe:** Horizontal (error handling/observability) / Vertikal (throw → Fastify default/route catch → response/log)
- **Lokasi:** `src/app.ts` (tidak ada `setErrorHandler`); `src/routes/admin/backup.subroute.ts:29,75,112,149,207,245`; `src/routes/staff/auth.subroute.ts:219,238`; `src/routes/admin/settings.subroute.ts:2582`
- **Bukti:**
  - `grep setErrorHandler|errorHandler src/**/*.ts` → **0 hasil**.
  - `backup.subroute.ts:29` — `500 { success:false, error: err?.message }`; pesan Prisma dapat memuat host/user/query.
  - `staff/auth.subroute.ts:219` & `:238` — `500 { error: err.message }`.
  - `settings.subroute.ts:1884` — `note: 'DB offline: ' + err.message` di body 200.
  - `app.ts:80-98` hanya mencatat 401/503, bukan 5xx/error tak tertangani; `request.id` tidak diteruskan ke logger route.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** OWASP A09/A05, ASVS V7.1/V7.4, NIST CSF DE.AE.
- **Akar masalah (5 Whys):**
  1. Mengapa pesan mentah? → Catch per route menyalin `err.message` agar mudah debug.
  2. Mengapa tidak ada mapper? → Tidak ada error taxonomy (`AppError`).
  3. Mengapa tidak ada handler global? → Fastify default dianggap cukup.
  4. Mengapa observability lemah? → `correlationId` hanya dipakai webhook, tidak di admin.
  5. Mengapa tidak terdeteksi? → Tidak ada test yang memastikan pesan generik pada 5xx.
- **Risiko:** Information disclosure (nama host DB, path file, stack) membantu penyerang; sulit korelasi log saat insiden; error 500 tidak terpusat sehingga alert tidak akurat.
- **FMEA:** **S=4, O=9, D=5 → RPN 180**
- **Collateral damage:** Menyeragamkan error dapat menyembunyikan detail yang selama ini dipakai debugging → sertakan `errorId` yang berkorelasi dengan log internal.
- **Rekomendasi fondasional:** Buat `AppError { code, httpStatus, publicMessage, internalDetail }`; `app.setErrorHandler` memetakan Prisma (`P2002`→409, `P2025`→404, koneksi→503) dan selalu mengembalikan `{ error, code, requestId }` tanpa detail internal; log internal memuat `requestId`, `tenantId`, `staffId`, `route`. Tambah `onError` hook.
- **Verifikasi:** Test: route yang melempar Prisma error → 500/503 dengan pesan generik + `requestId`; log memuat detail; grep `error: err.message` di route admin = 0.

---

### Ar-007 — Cron dapat tumpang tindih (tidak ada mutex in-flight) dan interval tidak punya nama/metrik

- **Tipe:** Horizontal (scheduler) / Vertikal (tick → jalankan sweep → tick berikutnya)
- **Lokasi:** `src/lifecycle/interval-registry.ts:16-20`; `src/lifecycle/background-crons.ts:20-120`
- **Bukti:**
  - `interval-registry.ts:16-20` — `setInterval(fn, ms)` tanpa guard; `fn` async tidak di-await/dilacak.
  - `background-crons.ts:26,49,59,65,77,87,97,106,116` — banyak `trackInterval(() => cron.runX(), …)` tanpa flag `running`.
  - Tidak ada metrik durasi/keberhasilan per cron.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** Well-Architected Reliability (REL-6), NIST CSF PR.IP.
- **Akar masalah (5 Whys):**
  1. Mengapa overlap? → `setInterval` tidak menunggu promise selesai.
  2. Mengapa tidak ada guard? → Diasumsikan sweep selalu < interval.
  3. Mengapa asumsi itu? → Interval 6–24 jam; tetapi media cleanup/Sheets sync bisa lambat saat DB/Drive lambat.
  4. Mengapa tidak terlihat? → Tidak ada log durasi.
  5. Mengapa penting? → Dua sweep paralel dapat mengirim follow-up ganda atau menghapus file yang sedang dipakai.
- **Risiko:** Duplikasi pengiriman (follow-up/Sheets), kontensi DB, biaya; sulit didiagnosis tanpa nama cron.
- **FMEA:** **S=4, O=6, D=6 → RPN 144**
- **Collateral damage:** Menambahkan mutex dapat menunda sweep berikutnya (lebih baik daripada duplikat); perlu alert bila sweep > interval.
- **Rekomendasi fondasional:** `trackInterval(name, fn, ms)` menyimpan status `running`, melewati tick bila masih berjalan, mencatat durasi + hasil; expose `/ready`/metrics ringan. Gunakan `setTimeout` berantai (bukan `setInterval`) agar tidak menumpuk.
- **Verifikasi:** Test fake timer: `fn` menggantung → tick kedua tidak memanggil `fn`; log `cron_skipped_overlap`; metrik durasi muncul.

---

### Ar-008 — Postur keamanan bergantung pada string `NODE_ENV === 'production'` (fail-open di staging)

- **Tipe:** Horizontal (konfigurasi) / Vertikal (deploy → NODE_ENV → verifikasi webhook)
- **Lokasi:** `src/app.ts:41-57`; `src/integrations/whatsapp/signature.ts:16-23`; `src/routes/waba-webhook.route.ts:66-71`
- **Bukti:**
  - `app.ts:42-47` — bila `WAHA_WEBHOOK_SECRET` kosong dan `NODE_ENV !== 'production'` → hanya `console.warn`, webhook menerima request tanpa secret.
  - `signature.ts:16-22` — tanpa signature/secret dan `strictMode=false` → `return true`.
  - `waba-webhook.route.ts:66` — `const isStrict = process.env.NODE_ENV === 'production';`
  - Tidak ada flag eksplisit `ALLOW_INSECURE_WEBHOOKS`; staging/preview otomatis fail-open.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** OWASP A05, ASVS V14.1/V2.10, NIST CSF PR.IP.
- **Akar masalah (5 Whys):**
  1. Mengapa staging fail-open? → Kenyamanan dev tanpa secret.
  2. Mengapa memakai NODE_ENV? → Satu-satunya sinyal environment saat itu.
  3. Mengapa tidak ada opt-in eksplisit? → Belum dipisahkan "dev" vs "staging".
  4. Mengapa berbahaya? → Staging sering memakai data produksi & dapat dijangkau internet.
  5. Mengapa tidak terdeteksi? → Tidak ada test boot dengan NODE_ENV=staging.
- **Risiko:** Siapa pun dapat mengirim event palsu ke staging (jika terekspos) dan memicu pesan ke pasien nyata atau menulis data.
- **FMEA:** **S=7, O=4, D=7 → RPN 196**
- **Collateral damage:** Mengubah default menjadi fail-closed dapat mematikan dev lokal tanpa `.env` → sediakan `ALLOW_INSECURE_WEBHOOKS=true` eksplisit di `.env.example` bagian dev.
- **Rekomendasi fondasional:** Ganti kondisi menjadi: wajib secret **kecuali** `ALLOW_INSECURE_WEBHOOKS === 'true'` (default false, hanya boleh di `NODE_ENV=development`); log CRITICAL saat aktif; tambahkan ke `/ready` sebagai warning.
- **Verifikasi:** Boot `NODE_ENV=staging` tanpa secret → throw; dengan `ALLOW_INSECURE_WEBHOOKS=true` → warning + webhook 200; produksi selalu throw tanpa secret.

---

### Ar-009 — Integritas audit: klaim PASS Fase 1/Fase 11 (2026-11-02) tidak didukung bukti yang dikutip

- **Tipe:** Horizontal (proses audit) / Vertikal (laporan → bukti → kondisi kode hari ini)
- **Lokasi:** `docs/audit/2026-11-02/fase-01/LAPORAN_FASE_01.md` (1.1, 1.5); `docs/audit/2026-11-02/fase-11/LAPORAN_FASE_11.md` (11.1, 11.2); `tests/integration/admin-staff-authz-matrix.test.ts:79-85`
- **Bukti:**
  - Fase 1 klaim 1.1: *"0 query lintas-tenant tanpa filter; fail-closed saat tenantId kosong"* dengan bukti `route-helpers.ts:15-30`. Hari ini `tenantOf` hanya dipakai 6 domain dan masih ada **325** referensi `DEFAULT_TENANT_ID`; `route-helpers.ts` hanya 23 baris (klaim baris 15-30 tidak ada).
  - Fase 11 klaim 11.2: *"Memindai seluruh staged & working tree — 0 file bocor"* — implementasi hanya `git status --porcelain` (S-013), dan S-001 membuktikan ada kredensial di tracked tree.
  - Fase 11 klaim 11.1: *"Middleware RBAC menolak role non-admin mengakses rute privat"* — hanya untuk role "managed"; `admin_cs`/custom role unmanaged lolos (S-003).
  - `admin-staff-authz-matrix.test.ts:85` — tes bernama "matrix" hanya menguji **tanpa kredensial** (401/403), bukan peran.
- **Keyakinan:** **TERBUKTI** (perbandingan teks laporan vs kode).
- **Framework:** ISO 19011 (audit evidence), NIST CSF ID.GV, kode etik audit.
- **Akar masalah (5 Whys):**
  1. Mengapa klaim berlebihan? → Laporan dibuat dari checklist + exit code, bukan verifikasi ulang bukti.
  2. Mengapa bukti tidak diverifikasi? → Tidak ada langkah "baca ulang file:line" pada gate.
  3. Mengapa test dinamai matrix? → Test anonim dianggap cukup mewakili otorisasi.
  4. Mengapa tidak ada koreksi? → #299 menutup isu gate regresi, bukan isu cakupan klaim.
  5. Mengapa berulang? → Tidak ada template audit yang mewajibkan kutipan kode aktual + hitungan grep.
- **Risiko:** Pengambil keputusan (owner) percaya sistem "aman & SaaS-ready" padahal ada 1 Critical + 8 High; audit berikutnya mengulang kesalahan; biaya remediasi meningkat.
- **FMEA:** **S=5, O=9, D=8 → RPN 360**
- **Collateral damage:** Menurunkan status klaim lama dapat menimbulkan ketidakpercayaan pada laporan sebelumnya; mitigasi: tandai "revisi" dengan bukti, bukan menyalahkan.
- **Rekomendasi fondasional:** Template audit wajib: (a) setiap PASS menyertakan `file:line` **dan** perintah verifikasi yang dapat dijalankan; (b) hitungan grep untuk klaim kuantitatif; (c) test matrix per peran (bukan hanya anonim); (d) scanner `--all` di CI; (e) reviewer kedua untuk klaim keamanan.
- **Verifikasi:** Audit ulang Fase 1/11 dengan checklist baru → setiap baris PASS harus gagal bila `file:line` tidak ada; jalankan `npm run security:scan -- --all`; jalankan test matrix per peran.

---

## 5. Matriks Otorisasi (Authz)

Legenda: ✅ = diizinkan; ⛔ = ditolak; ⚠️ = diizinkan tetapi **tidak seharusnya** (temuan); n/a = bukan jalur.

| Endpoint / Grup | SUPER_ADMIN / API key | ADMIN_CS / SPV_CS (unmanaged) | THERAPIST (managed, 2 scope) | Custom role baru (0 scope) | Anonim |
|---|---|---|---|---|---|
| `POST /api/admin/auth/login` | ✅ | ✅ (login) | ✅ (login) | ✅ (login) | ✅ |
| `GET /api/admin/customers*` (PII) | ✅ | ✅ (sesuai peran) | ⛔ (scope) | ⚠️ **S-003** | ⛔ |
| `GET /api/admin/financial-analytics` | ✅ | ⚠️ **S-003** (UI sembunyikan, API izinkan) | ⛔ | ⚠️ **S-003** | ⛔ |
| `GET/POST /api/admin/whatsapp-provider/*` | ✅ | ⚠️ **S-002** (QR/disconnect) | ⛔ | ⚠️ **S-002/S-003** | ⛔ |
| `PATCH /api/admin/whatsapp-provider` (token WABA) | ✅ | ⚠️ **S-002** | ⛔ | ⚠️ **S-002** | ⛔ |
| `POST /api/admin/backup/*` | ✅ | ⛔ (prefix) | ⛔ | ⛔ (prefix) | ⛔ |
| `POST /api/admin/backup/restore` | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| `PUT /api/admin/tenant/:id/html` | ✅ | ⚠️ **S-010** (lintas tenant) | ⛔ | ⚠️ **S-010** | ⛔ |
| `POST /api/admin/few-shots*` | ✅ | ⚠️ **S-009** | ⛔ | ⚠️ **S-009** | ⛔ |
| `POST /api/admin/settings/*` (tulis) | ✅ | ⛔ (prefix) | ⛔ | ⛔ | ⛔ |
| `GET /api/admin/settings` (4 read allowlist) | ✅ | ✅ | ⛔ | ✅ | ⛔ |
| `POST /api/admin/staff*` (buat/ubah) | ✅ | ⛔ (method guard) | ⛔ | ⛔ | ⛔ |
| `GET /api/admin/staff/:id/telegram-pairing` | ✅ | ⛔ (object check) | ⛔ | ⛔ | ⛔ |
| `POST /api/admin/roles*` | ✅ | ⛔ (method guard) | ⛔ | ⛔ | ⛔ |
| `GET /api/admin/live-chat/*` | ✅ | ✅ | ⛔ (scope) | ⚠️ **S-003** | ⛔ |
| `POST /api/admin/push/test-staff` | ✅ | ⚠️ (self only) | ⛔ (scope) | ⚠️ | ⛔ |
| `GET /api/admin/debug/*` | ✅ | ⛔ (prefix) | ⛔ | ⛔ | ⛔ |
| `POST /webhook` (WAHA) | n/a | n/a | n/a | n/a | ⚠️ fail-open bila bukan produksi (Ar-008) |
| `POST /api/webhook/waba` | n/a | n/a | n/a | n/a | ✅ HMAC (fail-closed produksi) |
| `POST /api/tracking/click` | n/a | n/a | n/a | n/a | ⚠️ **S-007** (tenant dari body) |
| `GET /media/inbound/:tenant/:file` | ✅ | ✅ tenant sendiri | ✅ tenant sendiri | ✅ tenant sendiri | ⛔ |
| `GET /proof/:reservationId` | n/a | n/a | n/a | n/a | ⚠️ publik permanen (S-014) |

**Cacat struktural matriks:** kolom "ADMIN_CS/SPV_CS" dan "Custom role baru" pada dasarnya **identik** karena keduanya tidak punya baris `role_api_scopes`. Satu-satunya pembeda adalah 12 prefix super-admin + 4 read settings. Artinya, model otorisasi saat ini adalah **"semua staf boleh semuanya, kecuali 12 prefix"**, bukan "setiap peran hanya boleh yang ditugaskan".

---

## 6. Rencana Perbaikan Berurutan

> Prinsip: fondasional (state machine otorisasi, data-driven scope, kontrak error), tenant-aware, tanpa dependency runtime baru. Setiap fase ditutup **regression gate**: `npm run build` + suite relevan + full suite tanpa failure baru (failure yang diklaim pre-existing wajib revert-and-rerun sesuai AGENTS.md). Jangan deploy fase migrasi tanpa backup & dry-run.

### Fase 1 — P0: Hentikan paparan kredensial (S-001, S-013) — estimasi 0,5 hari + rotasi

1. `GUIDE_OPERASIONAL.md:71` & `docs/plans/SECRET_ROTATION_PLAN.md`: ganti nilai dengan `<REDACTED_BY_SECURITY>`; hapus tabel nilai secret (ganti dengan "lihat secret manager").
2. `scripts/scan-secrets.ts`: tambah mode `--all` (iterasi `git ls-files`, bukan `git status`), aturan baru (ADMIN_API_KEY, hex 32/64, `postgres://…:…@`, token Telegram, `WAHA_API_KEY`), dan unit test.
3. Rotasi di server: `ADMIN_API_KEY`, `WAHA_API_KEY`, `WAHA_SWAGGER_PASSWORD`, `WAHA_DASHBOARD_PASSWORD`; `DELETE FROM admin_sessions;` (invalidasi sesi lama). **Rotasi WAHA = 2-step verification + WARNING** (AGENTS.md).
4. Verifikasi: `git grep` 0; `npm run security:scan -- --all` 0; login key lama 401; WAHA `WORKING`; `/ready` 200.
- **Rollback:** dokumen dapat direvert; rotasi tidak dapat di-revert → simpan nilai lama di password manager sementara, rollback hanya dengan restart + `.env` lama.
- **Risiko:** script/CLI yang memakai key lama berhenti; koordinasikan dengan pemilik dashboard/CLI.

### Fase 2 — P0: Fondasi otorisasi (S-003, S-002, S-006, S-009, S-010) — estimasi 3–5 hari

1. **Migrasi seed**: `role_api_scopes` untuk `admin_cs`, `spv_cs`, `advertiser`, `therapist` (pemetaan frontend→API). Sertakan rollback SQL.
2. **Ubah kontrak** `role-scope.service.ts`: `rows.length === 0` → deny; tambahkan `LEGACY_UNMANAGED_ROLES` kosong; cache invalidasi saat role berubah (bukan hanya TTL 60 detik).
3. **Wajibkan scope saat membuat custom role**: `roles.subroute.ts` menulis `role_api_scopes` dalam transaksi yang sama; tolak role tanpa `apiScopes`.
4. **Guard deklaratif** `requireSuperAdmin` diterapkan pada: `whatsapp-provider/{qr,session/*,cutoff,PATCH}`, `tenant/:id/html` (tulis), `few-shots*`, `ai-rollout-scope`, `backup/*`, `services` (tulis harga), `landings` (tulis).
5. **Tenant resolution**: `resolveTenantForRequest()`; staf selalu tenant sesi; super-admin boleh override dengan validasi tenant aktif. Terapkan ke waba/backup/export/google/landings/push.
6. Test matrix per peran + endpoint (bukan hanya anonim).
- **Rollback:** feature flag env `RBAC_ENFORCE_MANAGED_ONLY=true` untuk sementara (default baru), tetapi **jangan** kembalikan fail-open; rollback hanya ke seed scope.
- **Risiko:** CS/SPV kehilangan akses jika seed kurang → uji dashboard per peran sebelum deploy; sediakan endpoint `GET /api/admin/auth/me` yang mengembalikan scope efektif untuk debugging.

### Fase 3 — P1: Rate limit & kepercayaan proxy (S-004, S-005) — estimasi 1–2 hari

1. `keyGenerator`: hash + validasi API key; fallback IP.
2. `allowList`: exact path SSE/copilot; hapus `includes`.
3. `trustProxy`: `loopback`/CIDR env; tolak XFF dari non-proxy.
4. Login: counter per akun (`staff.failed_login_count` + `locked_until`) untuk admin & staf.
5. Test beban ringan (1001 request) + test login lintas IP.
- **Rollback:** env `RATE_LIMIT_STRICT=false` (sementara) — tetapi audit log harus menandai.
- **Risiko:** SSE bisa terputus jika path berubah; uji LiveChatMonitor & Copilot.

### Fase 4 — P1: Sesi & browser (S-008, S-011, S-012) — estimasi 2–3 hari

1. CSRF/Origin guard untuk `/restore` + hapus `token` dari body login/restore; batasi parser `text/plain` ke route beacon.
2. CSP `/admin/*` + `Permissions-Policy`; uji PWA/service worker.
3. Refresh token HttpOnly + access token pendek; hapus localStorage; daftar sesi + revoke.
4. Validator password + role enum + `must_change_password`.
- **Rollback:** CSP report-only dulu (`Content-Security-Policy-Report-Only`) selama 3 hari.
- **Risiko:** PWA logout loop (pernah terjadi) → uji Android/iOS sebelum deploy; sediakan fallback token sekali pakai.

### Fase 5 — P1: Lifecycle & degradasi (Ar-001, Ar-002, Ar-005, Ar-006) — estimasi 2–3 hari

1. Registry interval: dukung `unref`/nama; daftarkan `setTimeout` stagger; migrasikan 3 service; `WahaMonitor.stop()`.
2. Boot: `Promise.allSettled` per tenant, `appReady` gate, `/ready` 503 sampai siap.
3. Kontrak error: `AppError` + `setErrorHandler` + `requestId`; ganti `catch → 200` dengan 503; fallback memori hanya test.
4. Test lifecycle & DB-down.
- **Rollback:** `APP_READY_GATE=false` sementara; error handler baru dapat dimatikan via env.
- **Risiko:** healthcheck restart loop bila gate terlalu lama → start_period 60s sudah ada; pantau.

### Fase 6 — P2: SaaS data & infrastruktur (Ar-003, Ar-004, Ar-007, Ar-008, S-007, S-014, S-015, S-016) — bertahap, Confirmation Gate

1. **Ar-003**: seam `TenantContext`, grep gate `DEFAULT_TENANT_ID` di route → 0; migrasi bertahap per subroute (settings → labels → knowledge → meta → google → landings → waba).
2. **Ar-004**: migrasi unique composite (butuh backup + dry-run + **Confirmation Gate**); tracking code per tenant.
3. **S-007**: tenant dari Origin/landing domain; tolak klaim body yang tidak cocok.
4. **S-014/S-015**: signed URL media; HMAC webhook per tenant (WAHA changes = 2-step).
5. **S-016**: `USER node`, `cap_drop`, network terpisah.
6. **Ar-007/Ar-008**: mutex cron + opt-in insecure webhook.
- **Rollback:** migrasi DB harus punya down-script/backup; network terpisah diuji di staging.
- **Risiko:** tertinggi di Ar-004 & S-015 (menyentuh data/WAHA); jangan gabung dengan deploy fitur.

**Urutan ketergantungan:** Fase 1 tidak bergantung apa pun. Fase 2 bergantung pada seed scope (tanpa seed, deny akan mematikan operasional). Fase 3/4 independen. Fase 5 independen. Fase 6 bergantung pada Fase 2 (tenant resolution) dan pada backup yang valid (S-001/Fase 1 memastikan tidak ada key di repo).

---

## 7. Batasan & Asumsi

### 7.1 Asumsi eksplisit (`[ASUMSI]`)

1. **`[ASUMSI]` Caddy menambahkan X-Forwarded-For tanpa menghapus nilai klien** (default reverse_proxy). Jika Caddy dikonfigurasi mengganti header, S-005 turun menjadi Low; tetap perlu `trustProxy` eksplisit.
2. **`[ASUMSI]` Kredensial `admin_prod_key_***` dan WAHA key di S-001 masih aktif di server** sampai dibuktikan sebaliknya. Tidak ada akses server.
3. **`[ASUMSI]` Repo GitHub publik** (dinyatakan #179; remote `IvnCoGrav/wa-clinic-bot`). Jika sudah privat, S-001 turun dari Critical ke High.
4. **`[ASUMSI]` Semua tenant saat ini = `default-tenant`.** Dampak lintas tenant (S-006/S-010/Ar-003) bersifat **potensial** sampai tenant kedua aktif; namun arsitektur SaaS harus disiapkan sebelum itu.
5. **`[ASUMSI]` Tidak ada WAF/rate-limit tambahan di depan Caddy** selain yang terlihat di `Caddyfile` (tidak ada).
6. **`[ASUMSI]` Versi dependency (axios 1.7.x, fastify 4.28.1, prisma 5.19.1) memiliki CVE yang belum diverifikasi** — tidak menjalankan `npm audit` (tanpa jaringan). Perlu scan terpisah.
7. **`[ASUMSI]` `storage/` di server tidak dapat diakses publik** (hanya via route). Tidak diverifikasi.
8. **`[ASUMSI]` Log produksi tidak memuat bukti eksploitasi** — tidak diperiksa; temuan adalah potensi arsitektural, bukan insiden terbukti.

### 7.2 Yang tidak diperiksa / tidak dapat diverifikasi

- Status migrasi live (`#298`), drift schema, dan apakah `reservation_archives` benar-benar ada di PostgreSQL produksi.
- Nilai `.env` produksi (sengaja tidak dibaca) dan apakah rotasi pernah dijalankan.
- Log produksi (`logs/app-*.log`, `logs/llm-*.jsonl`) — tidak ada analisis 401/503/brute force.
- Seluruh isi 30+ subroute admin (hanya yang berisiko tinggi dibaca penuh).
- Modul 4 (Reservasi) & Modul 6 (Live Chat) — di luar instruksi; temuan yang menyentuh keduanya hanya guard otorisasi.
- Pengujian dinamis (Burp/curl/exploit), beban, dan pemindaian dependency.
- Backup/restore drill nyata (hanya membaca kode completeness guard).
- Kepatuhan UU PDP secara formal (retensi, consent, DSR) — hanya disinggung sebagai risiko PII.

### 7.3 Catatan kepatuhan mandat

- **Tidak ada file kode/test/config/.env yang diubah**; satu-satunya file yang ditulis adalah laporan ini.
- **Tidak ada server dijalankan, DB ditulis, WAHA/Meta dipanggil, atau deploy.**
- **Tidak ada dependency baru** yang diusulkan; semua rekomendasi memakai modul yang sudah ada (`crypto`, `path`, `fs`, `zod`, `ioredis`, `@prisma/client`).
- **Temuan lama tidak diduplikasi**: `#129`, `#168`, `#179`, `#282`, `#298`, `#299` dirujuk dengan status verifikasi; temuan baru diberi ID S-/Ar-.
- **Tenant-aware**: setiap rekomendasi menyebut sumber tenant (sesi/DB), bukan hardcode; `DEFAULT_TENANT_ID` diusulkan menjadi seed-only.
- **Rekomendasi fondasional**: menyentuh state machine otorisasi (`role-scope`), kontrak error, registry lifecycle, dan constraint skema — bukan penambahan teks larangan/regex.

---

## 8. Lampiran — Perintah Reproduksi Bukti (read-only)

```powershell
# S-001 / S-013 — kredensial di tracked tree (nilai tidak dicetak penuh)
git grep -n "admin_prod_key_" -- .
git grep -n "3659a248" -- .
git ls-files docs/plans/SECRET_ROTATION_PLAN.md

# S-002 / S-003 — daftar prefix & fail-open
Select-String -Path src\routes\admin.route.ts -Pattern "superAdminOnlyPrefixes" -Context 0,25
Select-String -Path src\services\role-scope.service.ts -Pattern "rows.length === 0" -Context 0,4
Select-String -Path src\routes\admin\roles.subroute.ts -Pattern "roleApiScope"   # 0 hasil

# S-004 / S-005 — rate limit & proxy
Select-String -Path src\app.ts -Pattern "trustProxy|allowList|keyGenerator" -Context 0,6

# Ar-001 — interval liar
Select-String -Path src\**\*.ts -Pattern "setInterval\(" | Where-Object { $_.Path -notmatch 'lifecycle' }

# Ar-003 — hitungan tenant
(Select-String -Path src\routes\**\*.ts -Pattern "DEFAULT_TENANT_ID" | Measure-Object).Count
Select-String -Path src\routes\admin\*.ts -Pattern "tenantOf\(" -List | Select-Object Filename

# Ar-009 — klaim vs kode
Get-Content docs\audit\2026-11-02\fase-01\LAPORAN_FASE_01.md
Get-Content docs\audit\2026-11-02\fase-11\LAPORAN_FASE_11.md
Select-String -Path tests\integration\admin-staff-authz-matrix.test.ts -Pattern "it\("
```

**Akhir laporan.**
