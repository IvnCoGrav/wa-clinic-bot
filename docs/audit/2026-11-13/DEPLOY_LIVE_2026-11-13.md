# Catatan Deploy Live — 2026-11-13

> **Server:** `klinik-server-baru` (`43.173.11.79`, `/opt/wa-clinic-bot`)
> **Branch live:** `deploy/2026-11-13-merged`
> **Commit live:** `3925f30e` (merge W10–W19 + perbaikan alamat + pemisahan flag konsumen chat)
> **Waktu:** 14:20–15:10 WIB

---

## 1. Ringkasan

| Langkah | Hasil |
|---|---|
| Backup DB pra-migrasi | `backups/pre_deploy_a5793f51_20261113_142031.dump` (11 MB) |
| Migrasi diterapkan | **7** (6 via `migrate deploy` + 1 via DDL manual + `resolve`) |
| `migrate status` | *Database schema is up to date!* |
| Drift check | 41 baris — hanya `DROP TABLE` tabel backup lama + `RENAME INDEX` (pre-existing, tidak ada objek skema hilang) |
| Image app/worker | dibangun ulang, memuat W18 (`customer-address/`) & W19 (`inbound-guard`) |
| Container direstart | **hanya** `app` + `worker`; WAHA/Postgres/Caddy/Redis tidak disentuh (WAHA `StartedAt` identik) |
| `/health` | `{"status":"OK"}` |
| `/ready` | DB `CONNECTED`, WAHA `WORKING`, cron `NO_JOBS` |
| Konsumen chat | aktif (`BullMQ shards initialized successfully`), antrean 0 |

## 2. Migrasi

Berurutan sesuai folder:

1. `20261108000000_seed_system_role_scopes`
2. `20261108010000_add_ad_click_expires_at` — **DDL manual** (file memakai `"created_at"`, kolom asli `"createdAt"`), lalu `prisma migrate resolve --applied`
3. `20261109120000_add_conversation_closed_at`
4. `20261112130000_ar004_tenant_scoped_unique_staff_adclick`
5. `20261113100000_ar004_landing_slug_per_tenant`
6. `20261113120000_add_reservation_heatmap_index`
7. `20261113120000_api04_admin_session_tenant`

Verifikasi objek: `admin_sessions.tenant_id`, unique `staff/ad_clicks/landing_pages` komposit, index heatmap, `cron_leases`, `conversations.closed_at` + partial unique, `ad_clicks.expires_at` (458 baris terisi).

## 3. Insiden saat deploy (RESOLVED)

### 3a. Web Push VAPID wajib di env
Kode baru menolak `storage/vapid_keys.json` di produksi (fail-closed) → app crash-loop.

- Perbaikan: kunci dipindah dari `storage/vapid_keys.json` ke `.env` (`VAPID_PUBLIC_KEY` 87 char, `VAPID_PRIVATE_KEY` 43 char), backup `.env.bak-20261113-vapid` (chmod 600).
- Downtime app ±7 menit (14:45–14:52 WIB).

### 3b. `SEPARATE_WORKER=true` di app + worker → tidak ada konsumen chat
- Dampak: 421 job menumpuk (32 >30 hari, 317 7–30 hari, 60 1–7 hari, 12 2 jam–1 hari); pesan terakhir diproses 13:32 WIB.
- Perbaikan fondasional: flag dipisah — `SEPARATE_WORKER` hanya cron; `CHAT_CONSUMER_ENABLED=false` hanya di worker. Gerbang test: `tests/unit/deploy-queue-consumer-config.test.ts`.
- Pemulihan: 421 job diarsipkan ke `messages` (INBOUND, `isHistorical`, tanpa balasan otomatis) lalu dihapus; 426 `inbound_turns` pending → `FAILED` (`STALE_BACKLOG_ARCHIVED_20261113`) agar recovery tidak me-replay.
- Backup tambahan: `backups/pre_backlog_archive_20261113_145627.dump`.

### 3c. `APP_DOMAIN` wajib untuk compose baru
Compose W10+ meneruskan `APP_DOMAIN` ke Caddy dan gagal cepat bila kosong; `.env` server hanya punya `ADMIN_DOMAIN`.

- Perbaikan: `APP_DOMAIN=app.kalababyspa.online` ditambahkan ke `.env` (backup `.env.bak-20261113-appdomain`). Container `caddy` **tidak** di-recreate.

### 3d. Verifikasi akhir konsumen chat
```
[APP] BullMQ shards initialized successfully.
[APP] SEPARATE_WORKER=true terdeteksi: melewati background crons & sweeps
[WORKER] Shard queues initialized (PRODUSEN SAJA - konsumen chat di container app)
/ready: database CONNECTED, waha WORKING, queue CONNECTED, cron NO_JOBS
antrean: shard_0..4 wait=0
```

## 4. Rollback

- **Kode:** `git checkout <commit-lama>` di `/opt/wa-clinic-bot`, `docker compose build app worker && docker compose up -d --no-deps app worker`.
- **DB:** restore `backups/pre_deploy_a5793f51_20261113_142031.dump` (format custom, `pg_restore`).
- **Catatan:** image lama sudah tertimpa (tag `rollback-20261113` gagal dibuat karena image lama dipangkas saat build) → rollback kode harus lewat rebuild dari commit lama.

## 5. Perbedaan konfigurasi server (lokal server, tidak di repo)

- `docker-compose.yml` lokal sempat menghapus `hermes-net` dari app/worker **dan caddy**; **direvert 2026-11-14** karena Caddy membutuhkan `hermes-net` untuk Hermes (lihat Known Issue #333).
- Fix `SEPARATE_WORKER` di server disamakan dengan repo: app `true` (skip cron), worker `true` + `CHAT_CONSUMER_ENABLED=false`.
- `.env` server ditambah `APP_DOMAIN=app.kalababyspa.online` (diambil dari `ADMIN_DOMAIN`).

## 6. Monitoring pasca-deploy

- Saat verifikasi, **belum ada pesan inbound baru** setelah perbaikan (WAHA tetap `WORKING`; event `message.any` terakhir yang terlihat adalah echo/outbound). Antrean 0 dan konsumen aktif, sehingga pesan customer berikutnya akan diproses normal.
- Pantau 24 jam: `/ready`, `llen bull:message_queue_shard_*:wait`, log `[QUEUE]`, `[TURN RECOVERY]`, dan tabel `messages`/`inbound_turns`.

## 7. Rekonsiliasi branch & deploy Phase 5/6 — 2026-11-14

- **Masalah:** source server (`556f9743`) memuat W10–W19 tetapi belum Phase 5/6; image yang berjalan dibangun dari source modular tanpa guard Phase 5/6.
- **Solusi:** branch `deploy/reconcile-20261113` dari `556f9743`, port Phase 5/6 ke modul `src/domain/customer-address/{list,matching}.ts`, `customer.service.ts`, `staff-reservation.service.ts`, dan cermin FE `addressMatch.ts`. Commit **`dac51c48`** di-merge fast-forward ke `deploy/2026-11-13-merged`.
- **Phase 5:** anti-downgrade koordinat kartu `gps_pin`; city gate titik ≤150 m; region guard merge teks lintas kecamatan; root region freeze saat pin presisi dipertahankan.
- **Phase 6:** `buildEffectiveTaskAddress` memakai `isRegionCompatible` sebelum profil boleh menimpa kartu.
- **Gerbang regresi:** 52 tes target hijau; `npm run build` + dashboard build hijau; full suite **7470 passed / 18 failed** — 18 kegagalan identik pada 10 file yang sudah gagal di HEAD murni (AI model env, CAPI/pixel env, artefak audit path, Google OAuth env, parser LLM, queue flaky), dibuktikan dengan revert-and-rerun.
- **Deploy:** `bash scripts/deploy-prod.sh` — image app+worker dibangun ulang; hanya `app`+`worker` direcreate; tanpa migrasi/skema baru; konfigurasi WAHA tidak disentuh.
- **Verifikasi live:** `/health` OK; `/ready` DB `CONNECTED`, WAHA `WORKING`, queue `CONNECTED`; restart app/worker 0; tidak ada error kritis 10 menit; marker `preservePreciseCoords`, `regionOk`, `freezePreservedRegion`, `regionsCompatible` ada di `dist`.
- **Data pasca-deploy:** 5 customer multi-kartu (Babyspanisa tanpa reservasi + 4 rumah berbeda), 214 baris alamat, 0 FK orphan, 0 anomali primary.
- **Catatan:** trade-off merge teks lintas kecamatan didokumentasikan sebagai Known Issue **#332** (BY-DESIGN).

## 8. Perapian server & repo — 2026-11-14

- **Revert `docker-compose.yml` server:** kustomisasi lokal yang mencabut `hermes-net` dari app/worker/caddy dibatalkan karena Caddy membutuhkan network itu untuk Hermes (Known Issue #333). File kini identik dengan repo.
- **Commit repo:** `4a987ba7` — `.gitignore` menambahkan `backups/`, `.watchdog.env`, `Caddyfile.bak*`, `docker-compose.yml.bak*`, `backup_pre_v3_*.sql`. Server `git pull --ff-only` → `4a987ba7`, `git status` **0 baris**.
- **Arsip di server:** 5 `Caddyfile.bak*`, 2 `docker-compose.yml.bak*`, dan dump `backup_pre_v3_20260920_183008.sql` dipindah ke `backups/legacy-config/` + `backups/` (chmod 600); `storage/vapid_keys.json` plaintext dipindah ke `backups/secrets/` (chmod 600) karena kunci sudah ada di `.env`.
- **Dibersihkan:** file sampah `" metaPurchasePolicy "` (sisa output psql 12 byte).
- **Branch diarsipkan (tag, bukan dihapus permanen):** `archive/fix-address-relink-fill-only-20261113` (48ce9dcc), `archive/fix-fase0-stabilisasi` (5a77eed0); branch remote-nya dihapus. Worktree `chatbot-address-relink` dilepas.
- **Stash diarsipkan:** `archive/stash-audit-suko-wip` (6a707c44) dan `archive/stash-wip-unrelated-2026-10-05` (e871e743) — isinya sudah tercakup di master; 2 entri stash di-drop.
- **Verifikasi:** `docker compose config --quiet` OK; 6 container `wa-clinic-bot-*` tetap Up (app/worker 22 menit, sisanya 20 jam); Caddy `hermes-net wa-clinic-bot_default`; `/ready` DB `CONNECTED`, WAHA `WORKING`, queue `CONNECTED`; tidak ada restart container saat perapian.
