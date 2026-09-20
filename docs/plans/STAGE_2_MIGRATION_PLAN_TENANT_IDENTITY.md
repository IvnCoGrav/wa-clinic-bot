# Rencana Migrasi Stage 2 — Tenant Identity Boundary (R1)

- **Status:** MENUNGGU PERSETUJUAN. Belum ada migrasi/kode diubah.
- **Root cause:** RC-01 (tenant identity) — `Customer.phone @unique` global + fallback `findByPhoneGlobal` lintas-tenant.

## 1. Prasyarat (terverifikasi read-only, 2026-09-20)

| Cek | Hasil |
|---|---|
| Jumlah tenant | 1 (`default-tenant`, WAHA, session `default`) |
| `phone` multi-tenant | 0 (tidak ada) |
| Child tenant mismatch | 0 |
| Conversation duplikat per customer | 0 |
| Schema drift (`migrate diff --from-url`) | `-- This is an empty migration.` (sinkron) |

**Kesimpulan:** migrasi AMAN dijalankan; tidak ada data yang akan gagal constraint.

## 2. Perubahan Schema

```prisma
model Customer {
  // SEBELUM:
  phone String @unique
  // SESUDAH:
  @@unique([tenant_id, phone])
}
```

SQL yang dihasilkan:
```sql
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_key;
CREATE UNIQUE INDEX customers_tenant_id_phone_key ON customers (tenant_id, phone);
```

Partial unique untuk provider identifier (nullable):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS tenants_waha_session_uidx ON tenants (waha_session_id) WHERE waha_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_waba_pnid_uidx ON tenants (waba_phone_number_id) WHERE waba_phone_number_id IS NOT NULL;
```

## 3. Urutan Eksekusi (WAJIB berurutan)

1. **Backup**: `pg_dump` DB (produksi) / snapshot lokal.
2. **Migration**: `npx prisma migrate dev --name tenant_identity_boundary` (lokal) atau `migrate deploy` (staging/prod).
3. **Drift check** pasca-migrasi harus empty.
4. **Full `prisma generate`** (DILARANG `--no-engine`).
5. **Perubahan kode** (baru boleh setelah migrasi berhasil — lihat §4).
6. **Test DB nyata** (`vitest.db.config.ts`).

## 4. Perubahan Kode (setelah migrasi)

| File | Perubahan |
|---|---|
| `src/repositories/customer.repository.ts` | Hapus `findByPhoneGlobal` (interface + Postgres + InMemory). `updateManyByPhone` → `updateManyByPhoneTenant(phone, tenantId, patch)`. |
| `src/services/customer.service.ts` | `getOrCreateCustomer` buang fallback global; create atomic (catch P2002 → reread dalam tenant). `setLabelFlags` wajib tenantId. |
| `src/services/waha-tenant.service.ts`, `waba-tenant.service.ts` | Kembalikan `resolved\|unknown\|unavailable`; DILARANG default tenant untuk identifier tak dikenal (CG-01). |
| `src/integrations/whatsapp/factory.ts` | `resolveGatewayForTenant` fail-closed bila WABA tenant tidak lengkap. |
| Call site `updateManyByPhone` (backup, migration, harvesting, meta-attribution) | Sesuaikan ke tenant-scoped. |

## 5. Rollback

- **Jangan** kembalikan `phone @unique` setelah dua tenant boleh punya nomor sama.
- Rollback aplikasi: dual-read sementara (baca composite first, lalu global) selama satu rilis, index tetap ada.
- Bila migrasi gagal: index composite bersifat aditif; `DROP INDEX customers_tenant_id_phone_key` + restore `customers_phone_key` HANYA jika belum ada dua tenant bernomor sama.

## 6. Acceptance Criteria

- Insert phone sama di 2 tenant → sukses; duplikat dalam 1 tenant → ditolak DB.
- Tidak ada query production yang mencari customer by phone tanpa tenant.
- Unknown provider identifier tidak menulis data ke tenant default.
- Drift check empty; full suite hijau.

## 7. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Data duplikat tersembunyi di produksi | Sudah diverifikasi 0; jalankan ulang query sebelum migrasi produksi |
| Call site lintas-tenant (backup/harvesting) rusak | Audit tiap call site (MT-2.1 sudah daftar lengkap); uji terpisah |
| Bot berhenti saat provider tak dikenal | CG-01: quarantine/retry, bukan default — perlu monitoring |

## 8. Keputusan yang masih diperlukan

- **Konfirmasi Anda:** boleh jalankan migrasi **lokal (dev)** sekarang sebagai latihan? Atau tunggu backup produksi dulu?
- **Call site backup/harvesting:** tetap global dengan nama eksplisit, atau wajib tenant-scoped? (Rekomendasi: tenant-scoped.)
