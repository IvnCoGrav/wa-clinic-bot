# Runbook — R1 Cleanup & 173k Verifikasi Invariant (butuh server/DB)

Dijalankan **di server** (workstation audit tidak punya PostgreSQL). Semua langkah
read-only kecuali yang ditandai MUTASI. Prinsip: backup dulu, dry-run dulu, baru apply.

## Prasyarat

- Akses server dengan `.env` produksi (`DATABASE_URL` valid).
- `pg_dump` tersedia.
- Konfirmasi CS untuk tanggal definitif kasus Bunda Cayden (bila masih null-date).

## Langkah 1 — Backup (WAJIB sebelum mutasi)

```bash
pg_dump -t reservations "$DATABASE_URL" > backup_reservations_$(date +%Y%m%d_%H%M).sql
```

## Langkah 2 — Verifikasi invariant (173k, READ-ONLY)

```bash
npx tsx scripts/audit/check-reservation-invariants.ts
```

Target: INV1–INV3 dan INV5 = 0 baris. Catat seluruh ID yang muncul.
Jika hasil berbeda dari dokumen audit (1 null-date, 1 stale hold, 8 unverified,
15 confirmed lampau, 2 unassigned) → laporkan; jangan asumsi.

## Langkah 3 — Dry-run cleanup (R1, TANPA mutasi)

```bash
npx tsx scripts/cleanup/r1-cleanup.ts
```

Tinjau daftar ID. Pastikan hanya baris yang memang ingin diubah.

## Langkah 4 — Apply cleanup (R1, MUTASI)

```bash
npx tsx scripts/cleanup/r1-cleanup.ts --apply
```

- R1.1: null-date → `cancelled` (atau set tanggal definitif bila CS memberi).
- R1.2: hold kedaluwarsa → `cancelled` (KB-1).
- R1.3: `needs_staff_verification` → `false` pada completed.

## Langkah 5 — Verifikasi ulang

```bash
npx tsx scripts/audit/check-reservation-invariants.ts
```

Harusnya INV1–INV3 = 0.

## Rollback

```bash
psql "$DATABASE_URL" < backup_reservations_YYYYMMDD_HHMM.sql
```

## Langkah 6 — Deploy migrasi KB-6 (`delivery_fee`) + rebuild dashboard (B)

```bash
# di server, setelah backup Langkah 1
npx prisma migrate deploy
# drift check harus kosong:
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

Lalu rebuild dashboard (badge KB-2 "⏰ Hari Ini — Perlu Cek") di
`packages/admin-dashboard`: `npm run build`, restart container `app`.

## Catatan

- **KB-5** (15 confirmed lampau): TIDAK diotomasi — konfirmasi manual bidan per baris.
- **A1/173e** (`pending` tidak mengunci slot): KEPUTUSAN PEMILIK — dibiarkan
  (by-design). Penumpukan slot dideteksi sapuan A5, bukan diblokir.
- **A2 (booking_date WAJIB):** setelah deploy, `saveReservation` MENOLAK baris
  tanpa tanggal (HTTP 400). Pastikan Langkah 3–4 (cleanup null-date) dijalankan
  agar tidak ada baris lama yang tersangkut; baris null-date lama tetap bisa
  dibaca, hanya tidak bisa dibuat baru.
- **A3 (advisory lock):** verifikasi 1-step di server bahwa driver Prisma
  mendukung `$transaction` interaktif (bila tidak, lock otomatis fail-open ke
  perilaku lama). Bukan blocker operasional.
- **Google Calendar**: masih mock; tidak ada aksi.
