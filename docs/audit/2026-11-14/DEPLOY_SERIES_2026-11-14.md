# Deploy Live — Series Billing & Unit Komersial (2026-11-14)

> **Server:** `43.173.11.79` (`klinik-server-baru`), `/opt/wa-clinic-bot`, domain `app.kalababyspa.online`.
> **Commit:** `9cced7ee` (kode series `1eae114c` + cherry-pick RBAC `db8e57d5` + dokumen).
> **WAHA tidak disentuh** (container `waha` uptime tetap 21 jam saat verifikasi).

## Ringkasan

| Item | Hasil |
|---|---|
| Backup DB pra-deploy | `backups/pre_deploy_d6ee7742_20261114_083832.dump` (12 MB, tervalidasi `pg_restore -l`) |
| Tag rollback image | `wa-clinic-bot-app:pre-series` (`62b2880e8da6`), `wa-clinic-bot-worker:pre-series` (`14cb00656e8e`) |
| Migrasi diterapkan | `20261114120000_add_reservation_series_billing`, `20261114130000_backfill_series_session_capi_status` |
| `migrate status` | *Database schema is up to date!* (116 migrasi tercatat) |
| Drift check | 39 baris — hanya `DROP TABLE` tabel backup lama + `RENAME INDEX` (pre-existing, sama seperti deploy 2026-11-13) |
| Image baru | app `8de7aaa158ff`, worker `6b184dfb066b` |
| `/ready`, `/health`, `/admin` | **200 / 200 / 200** |
| Route series tanpa auth | **401** (route terdaftar, guard RBAC aktif) |
| Error di log app (10 menit pasca restart) | tidak ada |
| Kolom `reservation_series` | 6 kolom komersial ada di DB produksi |

## Temuan penting sebelum deploy (divergensi riwayat migrasi)

Saat `prisma migrate status` pertama, DB produksi memiliki migrasi
`20261114000000_add_admin_cs_spv_cs_operational_scopes` yang **tidak ada di `master`**
(hanya ada di `origin/chore/cleanup-deadcode-spaghetti`, commit `db8e57d5`).
Migrasi itu sudah diterapkan 2026-11-13 22:29 UTC dan membuka izin `ADMIN_CS`/`SPV_CS`
termasuk `/api/admin/reservation-series`.

**Tindakan:** commit `db8e57d5` di-*cherry-pick* ke `master` (`9cced7ee`) agar riwayat migrasi
konsisten dan deploy fresh tidak kehilangan izin CS. Konflik dokumen diselesaikan dengan
menggabungkan kedua sisi (CHANGELOG entry + baris RBAC KB-RBAC-01 di FEATURE_INVENTORY),
lalu `docs/changelog/INDEX.md` diregenerasi (`make-changelog-index.mjs --write`).

## Urutan eksekusi

1. `pg_dump -Fc` → salin ke `backups/`.
2. Tag image lama sebagai `pre-series` (rollback point).
3. `git pull --ff-only` → `d6ee7742`, lalu `9cced7ee` setelah cherry-pick RBAC.
4. `prisma migrate deploy` via container sementara (image runtime tidak memuat Prisma CLI).
5. `docker compose build app worker` → `docker compose up -d app worker`.
6. Verifikasi health, route, bundle dashboard, kolom DB, log.

## Rollback (bila diperlukan)

```bash
docker tag wa-clinic-bot-app:pre-series wa-clinic-bot-app:latest
docker tag wa-clinic-bot-worker:pre-series wa-clinic-bot-worker:latest
cd /opt/wa-clinic-bot && git checkout a90ee2fc
docker compose up -d app worker
# DB: kolom baru bersifat nullable/additive; restore dump hanya bila data korup.
```
