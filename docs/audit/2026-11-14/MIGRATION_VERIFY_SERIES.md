# Verifikasi Migrasi Series Billing — DB Ephemeral (2026-11-14)

> **Lingkungan:** container Postgres produksi (`wa-clinic-bot-postgres-1`), tetapi memakai **database terpisah** `migverify_series_20261114` yang dibuat lalu dihapus dalam run yang sama.
> **DB produksi `wa_clinic_db` dan container app/worker tidak disentuh.**
> **Baseline:** skema commit `700f6bdc` (sebelum port), di-`db push` ke DB ephemeral; 113 migrasi lama ditandai *applied*; lalu `prisma migrate deploy` untuk 2 migrasi baru.
> **Skrip:** `/tmp/migverify/run.sh` (bundle: `schema.prisma` = `df39dadb`, `schema-pre.prisma` = `700f6bdc`, seluruh `prisma/migrations`).
> **Prisma CLI:** dijalankan dari container sementara berbasis image `wa-clinic-bot-app` (`npx prisma@5.22.0`), bukan dari image runtime.

**Hasil: PASS** — 2 migrasi diterapkan, `migrate status` up to date, drift *empty*, 4 assertion struktur OK, 4 uji constraint + 3 uji backfill OK.

## Keluaran penting

```text
== 1. Buat database ephemeral ==
OK: database migverify_series_20261114 dibuat

== 2. db push skema PRA-migrasi (700f6bdc) ==
🚀  Your database is now in sync with your Prisma schema. Done in 619ms

== 3. tandai migrasi baseline applied ==
baseline tercatat=113 (harus 113)

== 4. migrate deploy (2 migrasi baru) ==
Applying migration `20261114120000_add_reservation_series_billing`
Applying migration `20261114130000_backfill_series_session_capi_status`
All migrations have been successfully applied.

== 5. migrate status ==
Database schema is up to date!

== 6. drift check ==
-- This is an empty migration.

== 7. Assertion struktur skema ==
OK: 6 kolom komersial ada
OK: unique index (tenant_id, request_id) ada
OK: index customer_address_id ada
OK: FK customer_address_id ON DELETE SET NULL

== 8. Uji perilaku constraint ==
OK: insert series pertama diterima
OK: duplikat request_id tenant sama DITOLAK
OK: request_id sama beda tenant DITERIMA
OK: request_id NULL ganda DITERIMA (partial unique)

== 9. Uji perilaku backfill single-anchor CAPI ==
OK: seed reservasi sesi 1-3
OK: SQL backfill dijalankan ulang
OK: sesi 1 tetap pending (anchor)
OK: sesi 2 -> not_applicable
OK: sesi 3 approved tidak diturunkan

== 10. Bersihkan database ephemeral ==
OK: database migverify_series_20261114 dihapus

RESULT: PASS - migrasi series-billing terverifikasi di DB ephemeral.
```

## Catatan teknis

- `IF NOT EXISTS` pada DDL membuat migrasi idempoten; aman bila kolom sudah ada karena `db push` parsial sebelumnya.
- `UNIQUE (tenant_id, request_id)` bersifat parsial terhadap NULL: banyak series tanpa `request_id` tetap boleh, sedangkan `request_id` sama dalam satu tenant ditolak (idempotensi klik-ganda).
- Backfill hanya mengubah `purchase_review_status='pending'` pada sesi `session_number > 1`; sesi 1 (anchor) dan status `approved`/`ignored_outlier` tidak disentuh.
- `_prisma_migrations` di DB ephemeral mencatat 115 migrasi (113 baseline + 2 baru), konsisten dengan jumlah folder migrasi di repo.
