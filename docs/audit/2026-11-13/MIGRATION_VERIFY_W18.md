# Bukti Verifikasi Migrasi Pending (W18)

> **Tanggal:** 2026-11-13
> **Lingkungan:** Postgres 16 ephemeral (container `clinic-postgres`), database terpisah `migverify_w18` yang dibuat lalu dihapus dalam run yang sama. DB dev (`wa_clinic_db`) dan produksi **tidak disentuh**.
> **Baseline:** commit `f306d6af^` (109 migrasi ditandai *applied*; skema lama via `prisma db push`).
> **Skenario:** `prisma migrate deploy` dengan urutan deploy produksi, lalu drift check dan uji constraint adversarial.

**Hasil: PASS** — 4 migrasi diterapkan, drift *empty*, 11 assertion skema OK, uji unique lintas/sama tenant sesuai harapan.

## Keluaran lengkap

```text
﻿# Verifikasi migrasi pending di Postgres 16 ephemeral (W18)

Tanggal  : 2026-11-13 12:39:35
Target   : database ephemeral 'migverify_w18' di container clinic-postgres (BUKAN DB dev/produksi)
Baseline : commit f306d6af^ (109 migrasi ditandai applied; schema lama via db push)

== 1. Siapkan database ephemeral ==
OK: database 'migverify_w18' dibuat

== 2. Bootstrap schema lama (db push dari f306d6af^) ==
Datasource "db": PostgreSQL database "migverify_w18", schema "public" at "localhost:5432"

Your database is now in sync with your Prisma schema. Done in 1.57s


== 3. Buat tabel _prisma_migrations + tandai 109 migrasi lama applied ==
OK: migrasi baseline tercatat = 109 (harus 109)

== 4. prisma migrate deploy (urutan deploy produksi) ==
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "migverify_w18", schema "public" at "localhost:5432"

113 migrations found in prisma/migrations

Applying migration `20261112130000_ar004_tenant_scoped_unique_staff_adclick`
Applying migration `20261113100000_ar004_landing_slug_per_tenant`
Applying migration `20261113120000_add_reservation_heatmap_index`
Applying migration `20261113120000_api04_admin_session_tenant`

The following migration(s) have been applied:

migrations/
  ΓööΓöÇ 20261112130000_ar004_tenant_scoped_unique_staff_adclick/
    ΓööΓöÇ migration.sql
  ΓööΓöÇ 20261113100000_ar004_landing_slug_per_tenant/
    ΓööΓöÇ migration.sql
  ΓööΓöÇ 20261113120000_add_reservation_heatmap_index/
    ΓööΓöÇ migration.sql
  ΓööΓöÇ 20261113120000_api04_admin_session_tenant/
    ΓööΓöÇ migration.sql
      
All migrations have been successfully applied.

== 5. Drift check (harus empty migration) ==
-- This is an empty migration.
OK: drift empty

== 6. Verifikasi objek skema ==
OK: kolom admin_sessions.tenant_id NOT NULL = NO
OK: default admin_sessions.tenant_id = 'default-tenant'::text
OK: index admin_sessions.tenant_id = 1
OK: unique staff (tenant_id, phone) = CREATE UNIQUE INDEX staff_tenant_id_phone_key ON public.staff USING btree (tenant_id, phone)
OK: unique ad_clicks (tenant_id, trackingCode) = CREATE UNIQUE INDEX "ad_clicks_tenant_id_trackingCode_key" ON public.ad_clicks USING btree (tenant_id, "trackingCode")
OK: unique landing_pages (tenant_id, slug) = CREATE UNIQUE INDEX landing_pages_tenant_id_slug_key ON public.landing_pages USING btree (tenant_id, slug)
OK: index heatmap reservations = CREATE INDEX reservations_tenant_id_status_booking_date_idx ON public.reservations USING btree (tenant_id, status, booking_date)
OK: unique lama staff_phone_key hilang = 0
OK: unique lama ad_clicks_trackingCode_key hilang = 0
OK: unique lama landing_pages_slug_key hilang = 0
OK: total migrasi tercatat = 113

== 7. Uji perilaku constraint (adversarial) ==
OK: nomor sama di dua tenant diterima (2 baris)
OK: nomor sama di tenant yang sama ditolak (staff_tenant_id_phone_key)
OK: slug sama di dua tenant diterima (2 baris)
OK: slug sama di tenant yang sama ditolak (landing_pages_tenant_id_slug_key)
OK: admin_sessions insert tanpa tenant_id memakai default (INSERT 0 1    tenant_id     ----------------  default-tenant (1 row))

== 8. Bersihkan database ephemeral ==
OK: database ephemeral dihapus

RESULT: PASS - semua migrasi pending terverifikasi (deploy sukses, drift empty, constraint benar).
```
