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

- `docker-compose.yml` server menghapus `hermes-net` dari app/worker (kustomisasi server).
- Fix `SEPARATE_WORKER` di server disamakan dengan repo: app `true` (skip cron), worker `true` + `CHAT_CONSUMER_ENABLED=false`.
