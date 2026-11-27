# F4 — Data, Backup, Export (2026-11-27)

Status: **source selesai; menunggu gerbang full-suite**. G7 = opsi (a): dump global hanya untuk operator, dump tenant default untuk endpoint tenant.

## 1. Perubahan

| Task | Temuan | Perubahan | File |
|---|---|---|---|
| T4.1 | `M15-01-WEEKLY-BACKUP-CLAIM-FAILOPEN`, `M15-01-WEEKLY-BACKUP-NO-RETRY-AFTER-FAILURE` | Klaim berstatus tiga nilai (`claimed/already/unknown`); DB error → `unknown` → **tidak jalan, tidak dianggap sukses**. Scheduler menyetel tanggal hanya jika sukses, sehingga tick berikutnya di jam yang sama mencoba lagi. | `src/services/cron.service.ts`, `src/lifecycle/background-crons.ts` |
| T4.2 | `M07-BACKUP-WHOLE-DB-DUMP` | `createDatabaseDump` punya `scope: 'tenant' | 'global'` (default **tenant**). Dump tenant memakai `where: { tenant_id }` untuk 12 tabel; `pg_dump` whole-DB hanya untuk `scope='global'`. Meta dump mencatat `scope`. Restore menolak dump `scope=global` lewat endpoint tenant. Backup mingguan berjalan **per tenant**. | `src/services/backup.service.ts`, `src/services/cron.service.ts` |
| T4.3 | `M14-13-RESTORE-FALSE-SUCCESS` | Setiap kegagalan tulis dicatat; `success` hanya true bila ada tabel tertulis **dan** tidak ada kegagalan. Audit membedakan `RESTORE_DATABASE` vs `RESTORE_DATABASE_PARTIAL`. Route membalas **422** saat gagal/sebagian. | `src/services/backup.service.ts`, `src/routes/admin/backup.subroute.ts` |
| T4.4 | `M14-15-GZIP-BOMB-RESTORE` | `gunzipSync` memakai `maxOutputLength` (default 512 MB, dapat diatur `BACKUP_MAX_RESTORE_BYTES`) di restore dan pembacaan counts. | `src/services/backup.service.ts` |
| T4.5 | `M14-14-BACKUP-RETENTION-AND-COVERAGE` | Retensi lokal 14 file terbaru; upload file wajib gzip/ENC1 (plaintext ditolak 400), menolak menimpa file (409), dan ditulis atomik (tmp + rename). | `src/services/backup.service.ts`, `src/routes/admin/backup.subroute.ts` |
| T4.6 | `M18-13-SHEETS-FORMULA-INJECTION` | Semua sel teks bebas (nama, lokasi, treatment, bidan, metode bayar non-hyperlink) memakai `escapeSheetCell`; `EMPTY_CELL` tetap `-`. Formula HYPERLINK bukti bayar tetap formula. | `src/services/sheets/row-formatter.ts` |
| T4.7 | `M15-14-SHEETS-FAILED-TERMINAL-SILENT-LOSS` | Kegagalan permanen memicu alert CRITICAL; endpoint `POST /api/admin/integrations/google/sheets/outbox/requeue` mengembalikan baris `failed` → `pending` (attempts 0). | `src/services/sheets/sheets-sync.service.ts`, `src/routes/admin/google-integration.subroute.ts` |
| T4.8 | `M16-02` | Semua route Google Settings/Sheets memakai tenant sesi, bukan `body.tenantId`. | `src/routes/admin/google-integration.subroute.ts` |

## 2. Test baru

`tests/unit/f4-backup-data.test.ts` (9 test):
- restore DB offline → `success:false` (tidak ada sukses palsu)
- gzip bomb → ditolak; `getBackupFileCounts` null
- dump tenant memfilter `tenant_id`; dump global tidak
- dump global ditolak restore tenant
- formula Sheets dinetralkan (nama, kelurahan, treatment)
- klaim backup `unknown` → tidak jalan & `success:false`
- `requeueFailed` mengembalikan baris failed
- upload plaintext ditolak; upload gzip atomik + tolak overwrite

Test lama disesuaikan:
- `tests/unit/backup.test.ts` — restore sukses mem-mock semua upsert; force restore kini jujur (`success:false` saat write gagal).

## 3. Deviasi & catatan

- **Ownership file backup** belum tuntas: nama file masih global (`wa_clinic_backup_<ts>.gz`), sehingga `/download` belum bisa memverifikasi pemilik per file. Otoritas tenant sudah diperbaiki (F2), tetapi namespacing file + filter daftar per tenant perlu perubahan format nama dan migrasi file lama — dicatat sebagai residual F4.
- **`getAllTenantIds`** untuk backup mingguan diambil dari tabel `tenants`; jika DB error, hanya default tenant yang dicoba (fail-safe).
- **Restore SQL** tetap ditolak oleh endpoint (hanya JSON internal) — desain lama dipertahankan.
- **Retensi Drive** tetap 8 file per folder tenant.

## 4. Status temuan

| Fingerprint | Status |
|---|---|
| `M15-01-WEEKLY-BACKUP-CLAIM-FAILOPEN` | FIXED in source |
| `M15-01-WEEKLY-BACKUP-NO-RETRY-AFTER-FAILURE` | FIXED in source |
| `M14-13-RESTORE-FALSE-SUCCESS` | FIXED in source |
| `M14-15-GZIP-BOMB-RESTORE` | FIXED in source |
| `M18-13-SHEETS-FORMULA-INJECTION` | FIXED in source |
| `M15-14-SHEETS-FAILED-TERMINAL-SILENT-LOSS` | FIXED in source |
| `M14-14-BACKUP-RETENTION-AND-COVERAGE` | Sebagian (retensi lokal + per-tenant dump); ownership file belum |
| `M07-BACKUP-WHOLE-DB-DUMP` | Dimigasi: default per tenant; global eksplisit untuk operator |
| `M16-05-BACKUP-TENANT-OWNERSHIP` | Otoritas tenant FIXED; ownership file residual |
| `M16-02-ADMIN-BODY-TENANT-OVERRIDE` (Google/Sheets) | FIXED in source |

## 5. Gerbang (run final 2026-11-27)

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run check:reuse` | 1 pelanggaran baru dari **file di luar F4** (`copilot-tools.ts`, perubahan working-tree pengguna: 1795 → 1820 baris) |
| `check-architecture` | 58 = baseline, 0 baru |
| Test F4 + backup/sheets/cron/google/security-fase3 | PASS |
| `npm test` penuh | **8585 pass, 2 gagal, 28 skipped** (1094 file) |

Dua kegagalan berada di `tests/unit/reuse-gate.test.ts` dan keduanya berasal dari **satu pelanggaran eksternal** (`copilot-tools.ts` yang sedang diubah pengguna, bukan file F4). Tidak ada kegagalan fungsional F4. Baseline gate F4 sendiri (file yang disentuh) menambah **0** pelanggaran; architecture gate 0 baru.

Catatan: setelah perubahan pengguna pada `copilot-tools.ts` selesai dan direview, jalankan `npm run check:reuse` lalu ratchet baseline bila memang disetujui.
