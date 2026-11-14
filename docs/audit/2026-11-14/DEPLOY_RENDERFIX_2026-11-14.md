# Deploy Fix Dashboard Reservasi (#340/#341) — 2026-11-14

> **Commit:** `c806f870`. Perubahan hanya dashboard (tidak ada migrasi DB).
> **Server:** `/opt/wa-clinic-bot`; `waha`/`worker`/`postgres`/`redis`/`caddy` tidak disentuh.

## Ringkasan

| Item | Hasil |
|---|---|
| Backup DB | `backups/pre_deploy_renderfix_20261114_101548.dump` (12 MB) |
| Tag rollback | `wa-clinic-bot-app:pre-renderfix` (`a85b4f0ea286`) |
| Image baru | `wa-clinic-bot-app:latest` = `7f3546ab8f5a` |
| Server git | `c806f870` |
| Health | `/ready` 200, `/health` 200, `/admin` 200 |
| Bundle dashboard | memuat string baru “Anak tersimpan” |
| Log app (3 menit) | bersih |
| Migrasi | tidak ada (data-only sebelumnya sudah diterapkan) |

## Isi rilis

- **#340**: prefill data anak dari profil customer (`GET /customers/:id` sekali per customer) + chip “Anak tersimpan (klik untuk pakai)”; tombol “+ Tambah Alamat” duplikat dihapus.
- **#341**: anti render-churn — effect memakai kunci stabil (`initialCustomer?.id`, `tanggal|jam|staf`, `bookingDate|jumlahProp`, konten nama+usia) + ref guard, sehingga prop objek/array baru dari Live Chat tidak me-reset form (klik hilang/kedip).

## Rollback

```bash
docker tag wa-clinic-bot-app:pre-renderfix wa-clinic-bot-app:latest
docker compose up -d app
cd /opt/wa-clinic-bot && git checkout 9950f51f
```
