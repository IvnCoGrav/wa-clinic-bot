# F7 — Secrets & Supply Chain (2026-11-27)

Status: **source selesai; gerbang regresi PASS**. Keputusan pengguna: **G10 = (a) pin digest**, **G11 = (a) pisah env worker**.

## 1. Perubahan

| Task | Temuan | Perubahan | File |
|---|---|---|---|
| T7.1 | `M17-02-DOCKER-CONTEXT-SENSITIVE` | `.dockerignore` menutup `logs/`, `backups/`, `audit/`, `data/`, `docs/live-snapshots/`, `.agents/`, `.opencode/`, `opencode.json`, `skills-lock.json`, `scripts/*.json`, `*.pem`, `*.key` (plus pasangan `/**`). Build context tidak lagi memuat dump PII, log forensik, snapshot live-chat, kunci privat, dan config agen. | `.dockerignore` |
| T7.2 | `M17-11-VITE-KEY-IN-BUNDLE` | Endpoint publik baru `GET /api/config/public` mengirim **basemap siap pakai** (URL + atribusi + maxNativeZoom + subdomains) dari env server; dashboard tidak lagi memuat nama provider/kunci peta. Build-arg `VITE_CARTO_API_KEY` dihapus dari Dockerfile & compose; `VITE_ADMIN_API_KEY`/`VITE_CARTO_API_KEY` dihapus dari `vite-env.d.ts`. Rotasi kunci / ganti provider tanpa rebuild. | `src/routes/public-config.route.ts`, `src/app.ts`, `packages/admin-dashboard/src/components/customer/CustomerMapTab.tsx`, `Dockerfile`, `docker-compose.yml`, `vite-env.d.ts`, `.env.example` |
| T7.3 | `M17-12-ENV-SHARED-WORKER` | Kontrak env per service (G11a): `scripts/env-contract.json` + `generate-worker-env.mjs` + `check-env-contract.mjs`. Worker memakai `.env.worker` (turunan `.env` **tanpa** secret inbound webhook: WAHA/Meta/Telegram, password dashboard/swagger). Generator menolak jalan bila key wajib worker tidak ada; compose fail-closed bila `.env.worker` tidak ada. `deploy-prod.sh` & `vps-migrate-import.sh` menjalankan generator + checker sebelum compose. Validasi `.env` deploy menambah `TRACKING_API_KEY`; CAPI/Telegram hanya **warn** (fitur degrade jujur, multi-tenant bisa ambil secret dari DB). | `scripts/env-contract.json`, `scripts/generate-worker-env.mjs`, `scripts/check-env-contract.mjs`, `docker-compose.yml`, `scripts/deploy-prod.sh`, `scripts/vps-migrate-import.sh`, `.env.worker`, `env.worker.example`, `package.json` |
| T7.4 | `M17-13-MIGRATION-BUNDLE-PLAINTEXT` | Bundel migrasi (`.env` + dump PII + sesi WAHA) **dienkripsi ENC1/AES-256-GCM** sebelum transfer; checksum SHA-256 wajib diverifikasi (sebelumnya opsional) dan ditulis relatif; `umask 077` + `chmod 700/600`; host key SSH diverifikasi dengan `StrictHostKeyChecking=accept-new` (TOFU — `yes` mutlak akan memblokir migrasi pertama tanpa host key). Import mendekripsi lewat `scripts/decrypt-backup.ts`, menghapus bundel terdekripsi setelah ekstrak, dan memulihkan `.env` mode 600. | `scripts/vps-migrate-export.sh`, `scripts/vps-migrate-import.sh`, `scripts/decrypt-backup.ts` |
| T7.5 | `M17-13-WATCHDOG-TOKEN-ARGV` | Token Telegram tidak lagi dirangkai ke URL di baris perintah (`ps` bisa melihatnya): URL ber-token ditulis ke config `curl` mode 600 dan dibaca `curl -K`; teks dikirim lewat file (`text@file`). Config/state watchdog dibaca dengan parser KEY=VALUE aman (bukan `set -a; source`) + `umask 077`. `backup.sh` tidak lagi memakai `export $(... xargs)`; hanya `DATABASE_URL`/`POSTGRES_DB` dibaca via `sed`. | `scripts/server-watchdog.sh`, `scripts/install-server-watchdog.sh`, `scripts/backup.sh` |
| T7.6 | `M19-09-READY-DISCLOSURE` | `/ready` publik kini hanya `{ status }` (200/503). Detail dependency/cron pindah ke log server + `/api/admin/health` (ber-auth). `waba_access_token` tidak lagi ditarik ke memori untuk probe; keberadaan token dicek via `SELECT COUNT(*)`. | `src/routes/health.route.ts`, `tests/integration/robustness.test.ts`, `tests/unit/f5-cron-outbox.test.ts` |
| T7.7 | `M17-08-IMAGE-DIGEST` | Seluruh image dipin `@sha256:` (tag tetap): `node:20-slim` (builder+runner), `redis:7-alpine`, `postgres:16-alpine`, `caddy:2`, `devlikeapro/waha:noweb-2026.7.2`; `alpine:3@sha256:` di script migrasi. Prosedur update digest didokumentasikan (wajib staging + 2-step verification untuk WAHA). | `Dockerfile`, `docker-compose.yml`, `scripts/vps-migrate-*.sh`, `deploy_config.txt` |

## 2. Test baru

- `tests/unit/dockerignore-sensitive-paths.test.ts` (13): path sensitif tertutup (10 entri), kunci privat/env, aset build dashboard tidak ikut tertutup, pola direktori punya pasangan `/**`.
- `tests/unit/f7-public-config.test.ts` (5): basemap runtime + cache; kompatibilitas env lama; fallback Esri tanpa kunci; tidak membocorkan secret; canary build-arg/`import.meta.env`/nama provider hilang dari sumber dashboard.
- `tests/unit/f7-env-contract.test.ts` (6): generator membuang seluruh secret inbound; tidak mencetak nilai secret; checker PASS/FAIL; fail-closed bila key wajib hilang; wiring compose; urutan deploy generator→checker→compose.
- `tests/unit/migration-script-contract.test.ts` (8): umask/mode; enkripsi ENC1 fail-closed; checksum wajib & relatif; host key; dekripsi; tidak ada transfer `.env` plaintext.
- `tests/unit/watchdog-argv.test.ts` (6): token tidak di URL argv; `curl -K` dari file 600; tanpa `set -a; source`; umask; `backup.sh` tanpa `xargs`/`export $()`.
- `tests/integration/ready-minimal.test.ts` (3): body sukses/gagal hanya `{status}`; sumber tidak menarik `waba_access_token`.
- `tests/unit/f7-image-digest-pinning.test.ts` (6): semua image/FROM ber-digest; WAHA tetap tag terkunci; tanpa `:latest`; alpine ber-digest; prosedur terdokumentasi.

## 3. Deviasi & catatan

- **G11(a) memakai deny-list, bukan allow-list penuh.** Worker membutuhkan banyak integrasi (Google/Sheets/LLM/WABA/backup); allow-list penuh berisiko mematikan cron diam-diam saat env baru ditambahkan. Deny-list fokus pada **secret inbound webhook** — kemampuan yang tidak mungkin dipakai worker (worker tidak membuka HTTP). Daftar ada di `scripts/env-contract.json`.
- **`StrictHostKeyChecking=accept-new`** (bukan `yes`): pada migrasi pertama host key server tujuan belum ada di known_hosts; `yes` mutlak akan menggagalkan transfer non-interaktif. `accept-new` = TOFU: koneksi pertama diterima, perubahan key berikutnya ditolak.
- **Seluruh bundel migrasi dienkripsi**, bukan hanya `.env` — dump DB juga memuat PII; kunci wajib diberikan out-of-band saat import (tidak bisa diambil dari bundel karena `.env` ikut terenkripsi). Hal ini didokumentasikan di pesan error skrip.
- **`/ready` tetap mengevaluasi DB/WAHA/WABA/queue/cron** untuk menentukan 200/503; yang dihapus hanya **detail** di respons. Status cron tetap memengaruhi readiness (perilaku F5).
- **`TRACKING_API_KEY` kini wajib** saat deploy karena endpoint tracking publik fail-closed tanpa key; `FB_CAPI_ACCESS_TOKEN`/`TELEGRAM_BOT_TOKEN` hanya diperingatkan (integrasi opsional; secret bisa berasal dari DB per tenant).
- **Digest diambil 2026-11-27** via `docker buildx imagetools inspect`; perubahan digest WAHA tetap butuh jendela staging + 2-step verification (G12). Deploy F7 belum dilakukan.

## 4. Status temuan

| Fingerprint | Status |
|---|---|
| `M17-02-DOCKER-CONTEXT-SENSITIVE` | FIXED in source |
| `M17-08-IMAGE-DIGEST` | FIXED in source |
| `M17-11-VITE-KEY-IN-BUNDLE` | FIXED in source |
| `M17-12-ENV-SHARED-WORKER` | FIXED in source |
| `M17-13-MIGRATION-BUNDLE-PLAINTEXT` | FIXED in source |
| `M17-13-WATCHDOG-TOKEN-ARGV` | FIXED in source |
| `M19-09-READY-DISCLOSURE` | FIXED in source |

Residual/operasional:
- `.env.worker` harus dibuat ulang setiap kali `.env` berubah (deploy-prod sudah otomatis). Bila operator menjalankan `docker compose up` manual tanpa generator, compose gagal (fail-closed) — bukan diam-diam memakai `.env` penuh.
- `curl -K` menulis URL ber-token ke file sementara mode 600 di `STATE_DIR`; file dihapus segera setelah request. Risiko sisa: dumproc sesaat / akses root host.
- Digest image menua; prosedur update manual ada di `deploy_config.txt`.

## 5. Gerbang (run final 2026-11-27)

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| Dashboard `tsc --noEmit` + `npm run build` | PASS |
| Canary `cartocdn` di `packages/admin-dashboard/dist/assets/*.js` | **0** (kunci/provider tidak di bundle) |
| `docker compose config -q` (YAML + wiring) | PASS (dengan env dummy) |
| `npm run check:reuse` | 189 = baseline, 0 baru |
| `check:architecture` | 58 = baseline, 0 baru |
| Test F7 + readiness + robustness + F5 | 61 pass (1 skipped pre-existing) |
| `npm test` penuh | **8666 pass, 1 gagal, 28 skipped** (1106 file). Satu-satunya kegagalan `reuse-gate`: 70,5 dtk > 60 dtk di bawah beban full-suite — lulus 14/14 saat dijalankan terpisah (pola identik baseline F1–F6), bukan regresi fungsional. |
