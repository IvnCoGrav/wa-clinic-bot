# Referensi Testing — Tindak Lanjut Performance Audit (08 Agustus 2026)

**Tanggal:** 2026-08-08 | **Referensi audit:** [`docs/PERF_AUDIT_2026-08-08.md`](./PERF_AUDIT_2026-08-08.md) → hasil pengukuran audit produksi
**Lokasi audit & test:** localhost (offline DB + mock Redis) → hasil lintas production dictatat di `docs/PERF_AUDIT_2026-08-08.md`
**Status:** ✅ semua verifikasi hijau (tsc build + Vitest 1010/1010)

Dokumen ini berisi cara menguji ulang perubahan performance **P1–P8** (tindak lanjut audit)
agar bisa dipakai sebagai referensi untuk regression-check / re-run di masa depan.

---

## 1. Perubahan yang Diuji (Ringkas)

| ID | Perubahan | File |
|---|---|---|
| P1 | Service `redis:7-alpine` + env `REDIS_HOST/PORT` di docker-compose | `docker-compose.yml` |
| P1 | Health endpoint lapor status Redis nyata (bukan hardcode) | `src/routes/admin/settings.subroute.ts` |
| P1 | Accessor `isRedisEnabled()` di broadcast-queue & faq-cache | `src/services/broadcast-queue.service.ts`, `src/services/faq-cache.service.ts` |
| P2 | GIN expression index FTS `knowledge_chunks` | `prisma/migrations/20260808120000_add_knowledge_chunks_fts_gin_index` |
| P3 | Paginasi + batch `IN` lookup chunk di FAQ staging | `src/routes/admin/migration.subroute.ts` |
| P4 | Batch dedupe + `createMany` impor pesan historis | `src/services/migration.service.ts` |
| P6 | Index kolom filter `conversations` & `reservations` | `prisma/schema.prisma` + `prisma/migrations/20260808130000_add_admin_filter_indexes` |
| P8 | Fix tenant filter `legacy-staging` (`'default'` → `DEFAULT_TENANT_ID`) | `src/routes/admin/migration.subroute.ts` |

---

## 2. Perintah Verifikasi (Gate Standar)

```bash
# 1. Typecheck / build
npm run build

# 2. Full test suite offline (DB & Redis mocked → fallback in-memory)
npm test

# 3. Prisma schema valid
npx prisma validate

# 4. Per-file (cepat, saat debug)
npx vitest run tests/unit/migration.test.ts
```

**Hasil pasar (2026-08-08):**
- `npm run build` → berhasil (tsc, tanpa error)
- `npm test` → **106 file / 1010 test PASSED**
- `npx prisma validate` → schema valid `🚀`

---

## 3. Test yang Perlu Diperhatikan (karena polanya berubah)

### 3.1. Migration legacy (P4) — `tests/unit/migration.test.ts`
- Mock prisma dipindah dari `prisma.message.findFirst` + `findMany`+`create` ke **`findMany([])` + `createMany({count})`**.
- Assertion `createMany` diperiksa dengan `arrayContaining` (bukan `toHaveBeenNthCalledWith` per baris).
- **Trap:** `createMany` WAJIB ada di stub `tests/setup.ts` (block `message`), kalau tidak → `Cannot read properties of undefined (reading 'mockResolvedValue')`.
- Jalan cepat: `npx vitest run tests/unit/migration.test.ts`.

### 3.2. FAQ Staging (P3) — response shape berubah
- `GET /api/admin/medical-faq-staging` & `/general-faq-staging` kini mengembalikan
  `{ success, data, total, page, limit, totalPages }` (sebelumnya hanya `{ success, data[] }`).
- `matchedChunk` di-resolve **1 query batch** (bukan Promise.all per row).
- Konsumen lama (test `legacy_harvesting`, `medical_detection`, `unanswered_and_staging`,
  `control_center_ui`) hanya membaca `data[]` → aman & sudah terbukti hijau.

### 3.3. Keterkat results tidak terduga pada test lain
- `command-service.test.ts` & `landing-crud.test.ts` sempat timeout 1× saat full suite paralel
  — **flaky**, pass saat di-running sendiri. Bukan regresi perubahan ini.

---

## 3. Checklist Verifikasi di Production (manual, setelah deploy)

| Langkah | Perintah / Titik Cek | Expected |
|---|---|---|
| 1. Dua container redis running | `docker compose ps` | `redis` Up + healthy |
| 2. App konek Redis (log boot) | `docker logs <app>` | Muncul `⚡ [QUEUE] Successfully connected to Redis` + `[Broadcast Queue] Redis connected` + `[FAQ CACHE] Redis connected` |
| 3. Health meter status | `curl https://app.kalababyspa.online/api/admin/health -H "x-admin-key: …"` | `redisQueue: "ACTIVE"` + `redisDetail.*ACTIVE` |
| 4. Index terpasang | psql: `\di knowledge_chunks*` | `knowledge_chunks_content_fts_idx` (GIN) |
| 5. Drift kosong | `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` | `-- This is an empty migration.` |
| 6. Legacy staging terbaca | `GET /api/admin/legacy-staging` | data PENDING (tenan `default-tenant`, bukan `default` kosong) |

---

## 4. Catatan Deploy (gate)

- Semua ini masih **belum di-deploy ke server** (harus lewat alur `docs/LIVE_SERVER_DEPLOY.md`
  dengan double-confirm — lihat `.agents/rules/server-update-gate.md`).
- Migration Prisma baru (`20260808…`) hanya jalan saat deploy/`prisma migrate deploy` di server.
- Ukuran data kecil → semua `CREATE INDEX` berjalan instan tanpa downtime (belum kecewa
  tabel besar nanti pakai `CREATE INDEX CONCURRENTLY` manual).

---

*Terakhir diperbarui: 2026-08-08.*