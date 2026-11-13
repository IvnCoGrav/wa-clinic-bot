# Rencana Migrasi Ar-004 — Unique Constraint per Tenant

> **Status:** **SEBAGIAN DIIMPLEMENTASI (W7)** — schema `Staff.phone` & `AdClick.trackingCode` sudah komposit; **migrasi BELUM diterapkan ke DB mana pun**. `LandingPage.slug` sengaja ditunda.
> **Tanggal:** 2026-11-12
> **Temuan register:** `Ar-004` (Modul 01/11, Sedang) — constraint skema masih global
> **Ketergantungan:** `Ar-003` sisa (service/worker tenant seam) memakai constraint komposit ini agar isolasi tenant benar-benar ditegakkan DB.

---

## 0. Status Implementasi W7 (2026-11-12)

| Bagian | Status | Bukti |
|---|---|---|
| `Staff.phone` → `@@unique([tenant_id, phone])` | **Selesai di schema + migration.sql**; belum di-deploy | `prisma/schema.prisma`, `prisma/migrations/20261112130000_ar004_tenant_scoped_unique_staff_adclick/migration.sql` |
| `AdClick.trackingCode` → `@@unique([tenant_id, trackingCode])` | **Selesai di schema + migration.sql**; belum di-deploy | idem |
| Kode lookup staf | Sudah tenant-scoped (`StaffAuthService.login(phone, password, tenantId)`); `backup.service.ts` upsert diubah ke `tenant_id_phone` | `tests/unit/staff-auth-and-reservation.test.ts`, `tests/unit/backup*.test.ts` |
| `LandingPage.slug` | **DITUNDA** — resolusi landing masih slug-global (tanpa host/tenant); melonggarkan slug menimbulkan ambiguitas dan menyentuh area landing pengguna | `tests/unit/ar004-tenant-unique-schema.test.ts` (guard deferral) |
| SQL delta | Dihasilkan otoritatif via `prisma migrate diff --from-schema-datamodel <HEAD> --to-schema-datamodel <baru>` (tanpa DB) | migration.sql |
| Terapkan ke DB | **TERVERIFIKASI** di Postgres 16 ephemeral (Docker, 2026-11-13): `migrate deploy` sukses, drift check *empty*, uji duplikat lintas/sama tenant sesuai harapan, dan Prisma `upsert` compound berjalan. **Belum** diterapkan ke staging/produksi milik Anda | — |

**Urutan deploy wajib:** `prisma migrate deploy` (staging → produksi) **SEBELUM** deploy kode yang memuat `backup.service.ts` versi baru, karena Prisma `upsert` memakai `ON CONFLICT (tenant_id, phone)` yang membutuhkan index komposit.

### Hasil verifikasi ephemeral (Postgres 16, Docker, 2026-11-13)

| Uji | Perintah | Hasil |
|---|---|---|
| Migrasi baru | `npx prisma migrate deploy` | `All migrations have been successfully applied.` |
| Drift | `npx prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --script` | `-- This is an empty migration.` |
| Staf, nomor sama dua tenant | INSERT tenant-a & tenant-b | **diterima** (2 baris) |
| Staf, nomor sama tenant yang sama | INSERT tenant-a kedua | **ditolak** `staff_tenant_id_phone_key` |
| AdClick, trackingCode sama dua tenant | INSERT tenant-a & tenant-b | **diterima** (2 baris) |
| AdClick, trackingCode sama tenant yang sama | INSERT tenant-a kedua | **ditolak** `ad_clicks_tenant_id_trackingCode_key` |
| Prisma upsert compound | `staff.upsert({ where: { tenant_id_phone } })` 2× | **sukses**, 1 baris, nama ter-update |

> **Temuan baru (dicatat di KNOWN_ISSUES):** pada DB **kosong**, replay seluruh migrasi gagal di `20260801000000_add_failed_followup_status` (`type "FollowUpStatus" does not exist`) karena tidak ada migrasi yang membuat enum tersebut — riwayat migrasi mengasumsikan DB baseline yang sudah ada (pola yang sama dengan trap tabel `children`). Verifikasi di atas menggunakan bootstrap: `db push` schema lama → tandai 109 migrasi lama `--applied` → `migrate deploy` migrasi baru.

---

## 1. Ringkasan Masalah

Tiga kolom unik saat ini **global lintas tenant**:

| Model | Baris schema | Constraint sekarang | Dampak |
|---|---|---|---|
| `Staff` | `prisma/schema.prisma:1017` | `phone String @unique` | Nomor HP yang sama tidak bisa dipakai dua tenant (mis. bidan multi-klinik) |
| `AdClick` | `prisma/schema.prisma:696` | `trackingCode String? @unique` | Kode tracking tenant A memblokir tenant B |
| `LandingPage` | `prisma/schema.prisma:810` | `slug String @unique` | Slug landing (`/promo`) hanya boleh dipakai satu tenant |

Karena constraint global, **tidak ada patch kode yang bisa mengatasinya** — harus migrasi skema. Sebaliknya, begitu constraint menjadi komposit, beberapa lookup `slug`/`phone` wajib ikut tenant agar tidak salah ambil baris tenant lain.

---

## 2. Target Skema

> **Catatan W7:** yang sudah diimplementasikan baru `Staff` dan `AdClick`. `LandingPage` di bawah adalah target JANGKA PANJANG, belum diubah di schema.

```prisma
model Staff {
  // ...
  phone String
  @@unique([tenant_id, phone])
}

model AdClick {
  // ...
  trackingCode String?
  @@unique([tenant_id, trackingCode])
}

model LandingPage {
  // ...
  slug String
  @@unique([tenant_id, slug]) // BELUM diterapkan (butuh routing per-host)
}
```

Catatan:
- `AdClick.customerId` TETAP `@unique` global (relasi 1-1 dengan Customer, id unik global).
- Index non-unik `@@index([trackingCode])` di `AdClick` boleh dihapus karena sudah tercakup index komposit; `LandingPage`/`Staff` belum punya index tambahan.
- Nama constraint Prisma: `Staff_tenant_id_phone_key`, `AdClick_tenant_id_trackingCode_key`, `LandingPage_tenant_id_slug_key`.

---

## 3. SQL Migrasi (PostgreSQL)

```sql
-- 1) Lepas unique lama
ALTER TABLE "Staff" DROP CONSTRAINT IF EXISTS "Staff_phone_key";
ALTER TABLE "AdClick" DROP CONSTRAINT IF EXISTS "AdClick_trackingCode_key";
ALTER TABLE "LandingPage" DROP CONSTRAINT IF EXISTS "LandingPage_slug_key";

-- 2) Pasang unique komposit (NULL trackingCode diizinkan berulang di Postgres)
ALTER TABLE "Staff"
  ADD CONSTRAINT "Staff_tenant_id_phone_key" UNIQUE ("tenant_id", "phone");
ALTER TABLE "AdClick"
  ADD CONSTRAINT "AdClick_tenant_id_trackingCode_key" UNIQUE ("tenant_id", "trackingCode");
ALTER TABLE "LandingPage"
  ADD CONSTRAINT "LandingPage_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");

-- 3) Index bantu lookup yang sekarang tenant-scoped
CREATE INDEX IF NOT EXISTS "AdClick_trackingCode_idx" ON "AdClick" ("trackingCode");
```

> Catatan: constraint lama bersifat global (lebih ketat), jadi data existing **pasti lolos** constraint komposit — tidak ada backfill/dedup. Ini alasan migrasi ini berisiko rendah dari sisi data.

---

## 4. Perubahan Kode Wajib (dalam PR yang sama)

| File | Perubahan | Alasan |
|---|---|---|
| `src/services/landing-content.service.ts:74` | `findFirst({ where: { slug, tenant_id } })` (tenant dari parameter/konteks) | Setelah komposit, `slug` saja bisa mengembalikan landing tenant lain |
| `src/routes/admin/landings.subroute.ts:348,431` | tambahkan `tenant_id` pada cek duplikat slug | Cek duplikat harus per tenant, bukan global |
| `src/services/staff-auth.service.ts:36`, `src/routes/staff/auth.subroute.ts:83`, `src/routes/admin/auth.subroute.ts:151` | pastikan lookup login memakai `findFirst({ where: { phone, tenant_id } })` atau phone unik per tenant yang dikirim | Login tidak boleh menyeberang tenant |
| `src/services/ad-attribution.service.ts:168` | sudah `findFirst({ trackingCode, customerId })` — tambahkan `tenant_id` | Konsistensi isolasi |
| `docs/FEATURE_INVENTORY.md` | catat constraint komposit | Mandat inventaris |

Semua lookup `findUnique({ where: { id } })` TIDAK terpengaruh.

---

## 5. Urutan Eksekusi (staged, micro-task)

### Fase M0 — Persiapan (tanpa menyentuh DB produksi)
1. Backup logis: `pg_dump "$DATABASE_URL" > backup_pre_ar004.sql` (wajib, simpan di luar repo).
2. Cek duplikat lintas tenant (harus 0): 
   ```sql
   SELECT tenant_id, phone, COUNT(*) FROM "Staff" GROUP BY 1,2 HAVING COUNT(*) > 1;
   SELECT tenant_id, "trackingCode", COUNT(*) FROM "AdClick" WHERE "trackingCode" IS NOT NULL GROUP BY 1,2 HAVING COUNT(*) > 1;
   SELECT tenant_id, slug, COUNT(*) FROM "LandingPage" GROUP BY 1,2 HAVING COUNT(*) > 1;
   ```
   Hasil wajib kosong karena constraint lama sudah global-unik.
3. Siapkan branch + PR berisi `schema.prisma`, migration SQL, dan perubahan kode §4.

### Fase M1 — Staging
4. `npx prisma generate` (JANGAN `--no-engine`).
5. `npx prisma migrate deploy` di staging.
6. Verifikasi drift: `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` → **harus** `-- This is an empty migration.`
7. Jalankan `npm run build` + targeted: `npx vitest run tests/unit/staff-auth-and-reservation.test.ts tests/integration/landing-serving.test.ts tests/integration/landing-crud.test.ts tests/unit/ad-attribution.test.ts tests/unit/ad-attribution-relational.test.ts` + full suite → 0 regresi.
8. Uji manual: buat staf dengan nomor sama di dua tenant; buat landing slug sama di dua tenant; pastikan resolve landing per tenant benar.

### Fase M2 — Produksi (butuh 2 langkah verifikasi)
9. Konfirmasi tertulis pengguna + jendela maintenance singkat (DDL `ALTER TABLE` mengambil lock ACCESS EXCLUSIVE; tabel kecil, perkiraan < 5 detik).
10. Backup pra-migrasi + catat `SELECT COUNT(*)` ketiga tabel.
11. `npx prisma migrate deploy`.
12. Jalankan ulang drift check + `npm run verify:backlog` + smoke test login staf/admin & resolve landing.

### Rollback (jika ada masalah)
```sql
ALTER TABLE "Staff" DROP CONSTRAINT IF EXISTS "Staff_tenant_id_phone_key";
ALTER TABLE "AdClick" DROP CONSTRAINT IF EXISTS "AdClick_tenant_id_trackingCode_key";
ALTER TABLE "LandingPage" DROP CONSTRAINT IF EXISTS "LandingPage_tenant_id_slug_key";
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_phone_key" UNIQUE ("phone");
ALTER TABLE "AdClick" ADD CONSTRAINT "AdClick_trackingCode_key" UNIQUE ("trackingCode");
ALTER TABLE "LandingPage" ADD CONSTRAINT "LandingPage_slug_key" UNIQUE ("slug");
```
Rollback hanya berhasil bila belum ada data duplikat lintas tenant yang baru dibuat.

---

## 6. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Lock DDL menahan tulis | Tabel kecil; jalankan di jendela maintenance; `lock_timeout` opsional (`SET lock_timeout = '5s'`) |
| Kode masih lookup slug tanpa tenant → salah tenant | Perubahan §4 wajib satu PR; test `landing-serving`/`landing-crud` diperluas |
| `prisma migrate diff --from-migrations` rusak (enum `FollowUpStatus`) | Pakai drift check `--from-url` sesuai AGENTS.md, JANGAN shadow replay |
| Client Prisma lag setelah schema berubah | `npx prisma generate` penuh (bukan `--no-engine`) |
| Rollback setelah ada duplikat baru | Rollback akan gagal (unique global) → bersihkan duplikat dulu, atau restore backup |

---

## 7. Confirmation Gate

Implementasi kode/schema sudah masuk (W7) dan SQL-nya sudah **diverifikasi di Postgres 16 ephemeral** (W8, Docker, 2026-11-13). Yang belum: penerapan ke **staging/produksi milik Anda** (environment ini tidak punya akses ke staging Anda; `.env` berisi kredensial live yang tidak boleh dipakai untuk uji).

Untuk mengeksekusi di lingkungan Anda, pengguna manusia WAJIB mengetik eksplisit, misalnya:

> **"Setuju eksekusi migrasi Ar-004 di staging"**

atau

> **"Setuju eksekusi Ar-004 staging + produksi, jendela <maintenance>."**

Tanpa kalimat itu, migrasi tetap **BELUM DITERAPKAN** di lingkungan Anda dan produksi tetap diblokir.
