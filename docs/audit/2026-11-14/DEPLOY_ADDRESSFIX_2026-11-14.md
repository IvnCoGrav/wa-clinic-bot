# Deploy Revisi Alamat Reservasi + RBAC Read Scopes — 2026-11-14

> **Commit:** `9b1fe5c1` (kode revisi alamat) + migrasi RBAC `20261114160000_seed_staff_operational_read_scopes`.
> **Server:** `/opt/wa-clinic-bot` (`klinik-server-baru`), domain `app.kalababyspa.online`.
> **WAHA tidak disentuh** (uptime tetap 22 jam), `worker` tidak di-recreate (tidak memakai jalur pembuatan reservasi/admin route).

## Ringkasan

| Item | Hasil |
|---|---|
| Backup DB | `backups/pre_deploy_9b1fe5c1_20261114_094509.dump` (12 MB) |
| Tag rollback | `wa-clinic-bot-app:pre-addressfix` (`8de7aaa158ff`) |
| Migrasi | `20261114160000_seed_staff_operational_read_scopes` (data-only, 5 baris) |
| `migrate status` | *Database schema is up to date!* |
| Drift | hanya objek pre-existing (`DROP TABLE` backup lama, `RENAME INDEX`, `DROP DEFAULT` lama) |
| Image baru | `wa-clinic-bot-app:latest` = `a85b4f0ea286` |
| Health | `/ready` 200, `/health` 200, `/admin` 200 |
| Bundle dashboard | memuat string UI baru (“Tambah Alamat”, “Ubah Alamat Kartu”, “Pilih alamat rumah dulu”) |
| Log app (5 menit) | bersih; **tidak ada** `Blocked … /roles` maupun `/tenant-settings` |
| Scope rows | 5 baris: admin_cs/spv_cs (roles + tenant-settings), therapist (roles) |

## Urutan eksekusi

1. `pg_dump -Fc` → `backups/pre_deploy_9b1fe5c1_20261114_094509.dump`.
2. Tag `wa-clinic-bot-app:pre-addressfix`.
3. `git pull --ff-only` → `9b1fe5c1`.
4. `prisma migrate deploy` (container sementara; image runtime tanpa Prisma CLI) → status + drift.
5. `docker compose build app` (dashboard ikut) → `docker compose up -d app`.
6. Verifikasi health, bundle, log, scope rows.

## Rollback

```bash
docker tag wa-clinic-bot-app:pre-addressfix wa-clinic-bot-app:latest
docker compose up -d app
# Kode: git checkout 484ccc42 (atau commit sebelumnya)
# Migrasi RBAC bersifat aditif (5 baris izin GET) — aman dibiarkan.
```

## Catatan

- Migrasi RBAC harus lebih dulu dari kode: kode baru mengeluarkan `/api/admin/tenant-settings` dari blanket Super Admin, sehingga baris scope GET harus sudah ada agar CS tidak tertolak.
- Migrasi data-only tidak mengubah skema; drift check hanya menampilkan objek lama yang sudah ada sebelum deploy.
- `worker` tetap memakai image sebelumnya; perubahan hanya di route admin (app) dan helper dashboard.
