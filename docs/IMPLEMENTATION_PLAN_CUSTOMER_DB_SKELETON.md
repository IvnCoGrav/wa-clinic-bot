# Implementation Plan — Customer Database: Skeleton Ringan + Retry Manual + Timeout 10s Fix (Revisi)

**Tanggal:** 2026-09-01 (revisi 2026-09-01 — feedback 6 poin)  
**Status:** Plan → Build (disetujui user 2026-09-01, data 500)  
**Penulis:** Muse Spark — audit CustomerDatabase 1200+ baris + customer.service + api.ts  
**Prasyarat:** `AGENTS.md` SaaS-readiness, `docs/PERF_AUDIT_2026-08-08.md` P2/P6, `docs/KNOWN_ISSUES.md` mandate

---

## 1. Ringkasan Masalah (Faktual)

**Gejala:** Buka `Database Customer` → loading lama → toast `Gagal memuat database customer: Koneksi internet lambat (Timeout 10s). Silakan coba lagi.` (2026-09-01).

**Alur error (verified read-only):**
- `CustomerDatabase.tsx:162` `apiRequest GET /api/admin/customers?page=1&pageSize=15&sortBy=created_at&sortOrder=desc` tanpa `timeoutMs` eksplisit.
- `api.ts:157` default `isGet ? 10000 : 15000` → 10s, `api.ts:178` `AbortController` abort 10s, `api.ts:232` retry 1x 12s, `api.ts:249` throw `Koneksi internet lambat (Timeout 10s)...` → `CustomerDatabase.tsx:172` toast prefix `Gagal memuat database customer: `.
- Data hanya **500** — p95 `customers-list` 36ms di audit (`PERF_AUDIT:93`) seharusnya <300ms. Seq scan 500 rows harusnya <5ms bahkan tanpa index → timeout 10s indikasi bukan planner, tapi **N+1 `resolveTreatmentValue` per-row + pool exhaustion** (bukan volume).

**Akar (5 faktor konkuren, + 2 blind spot baru dari feedback):**
1. `customer.service.ts:1143-1184` 6 query paralel per request: `findMany include {adClick,reservations} + count + 4 stats (count×3+aggregate)` + `1120-1127` OR 6× `contains insensitive` (name/phone/kecamatan/kota/kelurahan/adClick.trackingCode) → `ILIKE %q%` sequential scan. `schema.prisma:107-108` hanya 2 index (`tenant_id`, `tenant_id+created_at`), tanpa `is_mql/is_sandbox_test/name` dan tanpa `pg_trgm` GIN untuk `ILIKE`.
2. `customer.service.ts:1159` stats cache 15s tapi `invalidatePrefix customers:` di `customers.subroute.ts:16` tiap `POST/PATCH` → cache miss → spike.
3. `customer.service.ts:1154` `sortBy=ltv` fetch 500 rows + sort JS `1250`, `resolveTreatmentValue` per-row (memo `1197` tapi tetap per-unique text, potensi 500 round-trip jika tidak di-batch) — **N+1 belum terprofiling**, bisa >100ms untuk 500 rows.
4. `docker-compose.yml:20` `pool_timeout=10` (= FE 10s) + `connection_limit=20` (Prisma `?connection_limit=20`) vs `postgres max_connections=100` (`docker-compose.yml:68` `-c max_connections=100`) — pool SIZE belum di-audit (`pg_stat_activity` vs `connection_limit`). 500 data seq scan <5ms tapi antre pool bisa 10s.
5. UI `CustomerDatabase.tsx:562-565` hanya `<Loader>` full-page, tidak ada `loadError` state inline — hanya toast hilang, tidak ada retry manual.
6. **Blind spot:** 6 query paralel (`findMany`+`count` terpisah) bisa 1 round-trip via `COUNT(*) OVER()` window function — belum dikonsolidasi.
7. **Blind spot observability:** Tidak ada log durasi query & pool wait per request → regresi tidak terdeteksi sampai user komplain.

---

## 2. Tujuan

- **UX:** Tidak lagi blank spinner — skeleton ringan + banner retry manual yang persisten.
- **Timeout tidak lagi false positive:** `GET /customers` diberi headroom (20s khusus), pool diberi headroom (SIZE + timeout), stats tidak blok list.
- **500 data:** Harus **<1s p95 di concurrency 8** (goal eksplisit) — diverifikasi via `autocannon -c 8 -d 20`.
- **Korektnes LTV:** `sortBy=ltv` harus benar top-N by LTV, bukan 15 rows sembarang yang di-sort.
- **Observability:** Durasi query & pool wait ter-log per request, warning >500ms.
- Non-tujuan: Ubah skema Customer besar, ganti WAHA.

---

## 3. Prinsip

- Tenant-aware (`DEFAULT_TENANT_ID`, `tenant_id` filter).
- Idempotent, tidak drop tabel.
- Offline test green (`tests/setup.ts` mock → fallback in-memory).
- Lightweight: Tailwind `animate-pulse` saja, tidak ada lib skeleton baru.
- Korektnes di atas performa — jangan cap LTV tanpa full computation.

---

## 4. Fase Implementasi (Revisi — 7 fase utama + 5 sub-fase)

### Fase 0 — Cek Live Read-Only (0.5 jam)
*Tanpa ubah sistem, hanya inspect:*
```bash
ssh -p 1403 ubuntu@43.157.197.148 "cd /opt/wa-clinic-bot && docker compose exec -T postgres psql -U postgres -d wa_clinic_db -c 'SELECT COUNT(*) FROM customers;'"
ssh -p 1403 ubuntu@43.157.197.148 "docker stats --no-stream --format '{{.Name}} CPU {{.CPUPerc}} MEM {{.MemUsage}}'"
ssh -p 1403 ubuntu@43.157.197.148 "cd /opt/wa-clinic-bot && docker compose exec -T postgres psql -U postgres -d wa_clinic_db -c 'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM customers WHERE tenant_id='\''default-tenant'\'' AND is_sandbox_test=false LIMIT 15;'"
ssh -p 1403 ubuntu@43.157.197.148 "docker logs --tail 50 wa-clinic-bot-app-1 | grep -i 'customer\\|P1001\\|pool_timeout'"
```
*Kriteria: Seq Scan / pool queue → lanjut Fase 0.5, bukan langsung Fase 1.*

### Fase 0.5 — Investigasi N+1 & Pool Sizing (0.5 jam, sebelum Fase 1) — BARU
*Prasyarat: Fase 0 selesai. Tentukan apakah skeleton UI atau N+1/pool yang prioritas.*
```bash
# Cek connection_limit aktif & max_connections postgres & pg_stat_activity
ssh -p 1403 ubuntu@43.157.197.148 "docker compose exec -T app printenv | grep DATABASE_URL"
ssh -p 1403 ubuntu@43.157.197.148 "docker compose exec -T postgres psql -U postgres -d wa_clinic_db -c 'SHOW max_connections;'"
ssh -p 1403 ubuntu@43.157.197.148 "docker compose exec -T postgres psql -U postgres -d wa_clinic_db -c \"SELECT count(*) FROM pg_stat_activity WHERE datname='wa_clinic_db';\""
ssh -p 1403 ubuntu@43.157.197.148 "docker compose exec -T postgres psql -U postgres -d wa_clinic_db -c \"SELECT pid, usename, application_name, state, query_start, now()-query_start AS age, left(query,80) FROM pg_stat_activity WHERE datname='wa_clinic_db' ORDER BY age DESC LIMIT 10;\""
```
*Tambah temporary `console.time`/APM span di `customer.service.ts:1143-1184` sekitar tiap 6 query paralel dan di `~1196-1220` `resolveTreatmentValue` loop, deploy ke staging/local dengan seed 500 row, ukur breakdown per bagian:*
- `findMany` vs `count` vs 4 stats vs `Promise.all(rawCustomers.map(resolveTreatmentValue))`
- Prisma `log: ['query']` (`src/db/client.ts:9`) hitung jumlah SQL statement per request.

*Kriteria evaluasi:*
- Jika `resolveTreatmentValue` total >100ms untuk 500 rows (atau 15 rows >30ms) → **prioritas #1**, pindahkan ke **Fase 1.5** (di atas skeleton UI). Fase 1 tetap jalan tapi 1.5 duluan.
- Jika `pg_stat_activity count` mendekati `connection_limit` (mis. 18/20) saat traffic normal → **root cause pool exhaustion**, prioritaskan **Fase 5.5** lebih awal.
- Jika sudah `Promise.all` paralel tapi tetap 6 query → lanjut **Fase 3.5**.

### Fase 1 — Skeleton Ringan + Search Debounce P0 (0.5 hari)
**Ubah `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx:562-565,390-426,650-812,540-557`:**
1. Ganti `562:565` `if(loading) <Loader>` → `if(loading && customers.length===0)` skeleton:
   - Stats grid `390-426`: 4 kartu `animate-pulse bg-[#f0f2f5] h-[72px] rounded-xl` (label `h-3 w-20`, value `h-6 w-16`).
   - Table `650-812`: `Array(15).fill(0).map` row `h-4 w-3/4` (name), `h-3 w-1/2` (phone), `h-6 w-16` (LTV) + `h-5 w-16` (aksi), `divide-y divide-[#e9edef]`.
   - Search `540-557` + segment `430-488`: `h-9` skeleton saat `loading`.
   - Pagination `816-824`: `h-8` skeleton.
2. Jika `customers.length>0` saat refresh → skeleton tidak full-page, hanya overlay `opacity-50` + `animate-pulse` di table body (pertahankan data lama, anti-layout shift).
3. **Search Input Debounce (300ms)** (Adjustment Best Practice):
   - Tambahkan debounce 300ms pada `search` input di `CustomerDatabase.tsx` (menggunakan `useDebounce` atau `setTimeout` ref).
   - Mencegah pengetikan cepat memicu rentetan 5-10 request `ILIKE` konkuren ke backend yang menguras connection pool.
4. `src/index.css` tidak perlu ubah — pakai Tailwind existing.

### Fase 1.5 — Fix N+1 resolveTreatmentValue (kondisional, 0.5 hari) — BARU
*Hanya jalan jika Fase 0.5 konfirmasi N+1 (>100ms untuk 500 rows).*
**Ubah `src/services/customer.service.ts:1196-1220`, `src/services/capi.service.ts:361` (resolveTreatmentValue), `src/db/client.ts:9` (log query):**
1. Kumpulkan semua `customer_id` di halaman (`rawCustomers.map(c=>c.id)`), satu query batch `WHERE customer_id IN (...)` atau `treatment_detail IN (...)` — map di memory, bukan per-row `await resolveTreatmentValue(text)`.
   - Jika `resolveTreatmentValue` hit `treatmentCatalogService.getAllServices()` (in-memory) → tetap, tapi pastikan `treatmentMemoMap` (`1197`) benar-benar memo per-unique `text` (sudah ada, verifikasi hit rate >90%).
   - Jika `resolveTreatmentValue` ternyata query DB (`prisma.treatmentCatalog.findMany` per call) → ubah jadi `prisma.treatmentCatalog.findMany({where:{alias:{in: uniqueTexts}}})` sekali.
2. Pastikan `include: {adClick:true, reservations:{...}}` tidak memicu N+1 tersembunyi — cek `log ['query']` jumlah statement per request harus ≤2 (findMany + count), bukan 1+N.
3. Verifikasi: `console.time` breakdown setelah fix — total `resolveTreatmentValue` untuk 500 rows <30ms.
4. Alternatif: jika LTV memang butuh DB lookup per-row dan tidak bisa di-batch, pertimbangkan **Fase 4 opsi materialize** (computed column) sebagai long-term.

### Fase 2 — Retry Manual P0 (0.5 hari)
**Ubah `CustomerDatabase.tsx:76-176,378,562`:**
1. Tambah state `const [loadError, setLoadError] = useState<string|null>(null); const [retryCount,setRetryCount]=useState(0);`
2. `loadCustomers:150` → `setLoadError(null)` di awal try, `setLoadError(err.message)` di catch sebelum toast, `setLoading(false)` tetap.
3. Render banner jika `loadError && !loading`:
   ```tsx
   <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-center justify-between">
     <span className="text-xs text-rose-700 flex items-center gap-1.5"><AlertCircle size={14}/>{loadError}</span>
     <button onClick={()=>{setRetryCount(c=>c+1); loadCustomers();}} className="px-3 py-1.5 bg-[#008069] text-white rounded-xl text-xs font-bold">Coba Lagi</button>
   </div>
   ```
4. `useEffect([page,segment,sortBy,sortOrder,retryCount])` — retry memicu reload tanpa ganti page.
5. `api.ts:162` → `apiRequest(`/api/admin/customers?...`,{timeoutMs:20000})` **hanya untuk customers** (20s khusus, global tetap 10s). Hilangkan auto-retry untuk endpoint ini atau biarkan 1x tapi dengan `timeoutMs:20000` agar pool 10s tidak race.

### Fase 3 — Pisah Stats P1 (0.5 hari, tanpa migrasi)
**Ubah `customer.service.ts:1159` + `customers.subroute.ts:24,52`:**
1. Buat `GET /api/admin/customers/stats` baru yang hanya hit `customer.service.getCustomerStats()` (ekstrak `1159-1194` jadi method terpisah, cache 60s bukan 15s).
2. `GET /api/admin/customers` tidak lagi kembalikan `stats` — frontend `CustomerDatabase.tsx:167` fetch stats terpisah `useEffect([])` + `stale-while-revalidate`.
3. `invalidatePrefix customers:` di `customers.subroute.ts:16` hanya invalidate `customers:list:*`, bukan `customers:stats:*`.
4. Verifikasi: list tidak tunggu 4 agregasi → p95 turun 50%.

### Fase 3.5 — Query Consolidation & Type-Safety Evaluation P1 (0.5 hari, gabung Fase 3) — REVISI
**Ubah `customer.service.ts:1143-1157`:**
1. **Rekomendasi Utama (Best Practice)**: Pertahankan `Promise.all([prisma.customer.findMany, prisma.customer.count])`.
   - Menjamin 100% type-safety TypeScript, keamanan multi-tenant (`tenant_id`), komposisi filter dinamis (`segment`, `search`, `mqlOnly`), dan kompatibilitas offline unit test mock (`tests/setup.ts`).
   - Pada dataset 500-10.000 row, eksekusi paralel Prisma Client hanya memakan waktu 2-4ms (overhead roundtrip tidak signifikan dibanding risiko maintenance).
2. **Evaluasi Raw SQL `COUNT(*) OVER()`**:
   - Disediakan hanya sebagai opsi cadangan jika skala data melonjak >50.000 customer dan profiling menunjukkan latency round-trip menjadi bottleneck:
     ```sql
     SELECT *, COUNT(*) OVER() AS total_count FROM customers WHERE tenant_id=$1 AND is_sandbox_test=false ... LIMIT 15 OFFSET 0
     ```
   - *Catatan mitigasi:* Jika menggunakan `$queryRaw`, wajib membungkus parameter tenant dan filter secara ketat untuk mencegah SQL injection dan drift skema.

### Fase 4 — Search Guard + LTV Materialization & Lifecycle Sync P2 (0.5 hari) — REVISI (fix bug) — ⚠️ GATE WAJIB

> **⚠️ WARNING — SILENT CORRECTNESS BUG (Owner emphasis 2026-09-01): JANGAN DEPLOY FASE 4 DENGAN `take: Math.min(15, pageSize)` SEPERTI PLAN ASLI.**
> `LTV` dihitung di JS via `resolveTreatmentValue` (`customer.service.ts:1196`), **bukan kolom DB**. Jika `sortBy=ltv` hanya `take 15` rows dari DB lalu `sort` di JS, hasilnya **bukan top-15 by LTV** — hanya 15 rows sembarang (urutan `created_at` default) yang kebetulan di-sort ulang. User akan melihat data LTV **salah tanpa error apapun** (silent corruption), jauh lebih berbahaya daripada timeout yang setidaknya kelihatan. **Gate: Fase 4 tidak boleh merge/deploy sebelum pilih Opsi A atau B di bawah dan lolos verifikasi Fase 6 `sortBy=ltv` + observability Fase 7.**

**Ubah `customer.service.ts:1120,1154,1250`, `schema.prisma`, `reservationLifecycleService`, `reservations.subroute.ts`:**
1. **Search guard:** `if(q.length<4)` hanya `name/phone/trackingCode` (3 field indeks), `else` 6 field — kurangi `ILIKE` scan tak perlu saat user baru mengetik 1-2 huruf.
2. **LTV Korektnes & Lifecycle Sync**:
   - **Opsi A (Rekomendasi Utama & Standar Emas Database): Materialize `ltv_cache` sebagai kolom Customer**:
     - Tambahkan kolom `ltv_cache Int @default(0)` pada model `Customer` di `schema.prisma`.
     - Query `sortBy=ltv` langsung native di PostgreSQL: `orderBy: { ltv_cache: sortOrder }` dengan `take: pageSize` dan `skip: (page - 1) * pageSize`. 100% presisi dan berkecepatan instan O(1) indeks!
     - **Lifecycle Sinkronisasi `ltv_cache`**:
       - *Hook 1 (Reservasi Baru)*: Di `reservationLifecycleService.onReservationCreated`, update `ltv_cache = ltv_cache + purchase_value`.
       - *Hook 2 (Status / Nominal Berubah)*: Di `reservations.subroute.ts` (PATCH/PUT reservasi, saat status menjadi `cancelled`/`completed` atau `purchase_value` diedit), panggil `customerService.recalculateCustomerLtv(customerId)`.
       - *Hook 3 (Idempotent Backfill)*: Jalankan one-time SQL backfill saat migrasi:
         ```sql
         UPDATE customers c SET ltv_cache = COALESCE(
           (SELECT SUM(r.purchase_value) FROM reservations r WHERE r.customer_id = c.id AND r.status NOT IN ('cancelled', 'rejected')),
           0
         );
         ```
   - **Opsi B (Tanpa migrasi skema, tetap in-memory tapi ter-batch)**: Tetap `take: Math.min(500, pageSize*5)` khusus `sortBy=ltv`, dengan batching N+1 di Fase 1.5 agar 500 baris diproses <50ms.
   - **DITOLAK**: `take: Math.min(15,pageSize)` sembarang tanpa materialisasi (karena merusak integritas data top spender).
3. Kriteria: `sortBy=ltv` harus return top-N by LTV yang benar, diverifikasi via `autocannon` khusus ltv (Fase 6).

### Fase 5 — Postgres Tuning P2 (ops, butuh deploy)
*Jika Fase 0 tunjuk CPU >70% atau OOM:*
- `docker-compose.yml:66-85` `postgres 512M→1024M` atau `shared_buffers 256→128`, `work_mem 16→8` (hindari OOM).

### Fase 5.5 — Connection Pool Sizing P1 (gabung Fase 5) — BARU
*Prasyarat: Fase 0.5 selesai — berdasarkan `pg_stat_activity` vs `connection_limit`.*
**Ubah `docker-compose.yml:20` + `src/db/client.ts:8` + `.env` live:**
1. Set `DATABASE_URL` eksplisit `?connection_limit=20&pool_timeout=15` (bukan cuma `pool_timeout` seperti plan lama) — hitung: `connection_limit` harus `> pg_stat_activity max` + buffer 30%. Misal normal 12 → set 20. Pastikan `max_connections` Postgres (`SHOW max_connections` → 100) cukup untuk `connection_limit` semua service (`app 20 + WAHA ~5 + admin ~5 + buffer 10 = 40 <100`).
2. `pool_timeout` naik `10→15` agar FE 20s tidak race dengan pool 10s (FE harus > pool agar pool fail-fast dulu, bukan FE abort dulu).
3. Verifikasi: `pg_stat_activity` tidak pernah `waiting` dekat limit saat `autocannon -c 8`.

### Fase 6 — Load Test Verifikasi Goal (0.5 hari, sebelum deploy prod) — BARU
*Prasyarat: Semua fase 0-5 selesai. Buktikan goal Section 2: **<1s p95 @ concurrency 8**.*
```bash
# Baseline sebelum fix (sudah ada di audit) vs sesudah fix
npx autocannon -c 8 -d 20 -m GET \
  -H "Authorization: Bearer <ADMIN_API_KEY>" \
  "http://localhost:3000/api/admin/customers?page=1&pageSize=15&sortBy=created_at&sortOrder=desc"
# Ulangi khusus ltv (verifikasi korektnes + performa)
npx autocannon -c 8 -d 20 -m GET \
  -H "Authorization: Bearer <ADMIN_API_KEY>" \
  "http://localhost:3000/api/admin/customers?page=1&pageSize=15&sortBy=ltv&sortOrder=desc"
```
*Kriteria pass:* p95 <1000ms, p99 <1500ms untuk kedua sort, bandingkan sebelum/sesudah (delta >30% improvement). Simpan hasil di `docs/PERF_AUDIT_2026-08-08.md` follow-up section. Jika gagal → kembali ke Fase 1.5/3.5.

### Fase 7 — Observability Minimal P1 (0.5 hari) — BARU
**Ubah `src/routes/admin/customers.subroute.ts:24` + `src/services/customer.service.ts:1143` + `src/utils/logger.ts`:**
1. Tambah structured log per request:
   ```ts
   const t0 = Date.now();
   // ... 6 query paralel ...
   const elapsed = Date.now()-t0;
   fastify.log.info({ route:'GET /customers', elapsed, findManyMs, countMs, statsMs, resolveMs, poolWaitMs, page, sortBy });
   if (elapsed>500) fastify.log.warn({ route:'GET /customers', elapsed, slow:true });
   ```
2. `poolWaitMs` — ukur `Date.now()` sebelum `prisma.customer.findMany` vs sesudah (proxy pool wait jika Prisma expose, atau `pg_stat_activity` waiting).
3. Simpan sebagai log yang di-grep (`docker logs --tail 100 app | grep "GET /customers"`), tidak perlu APM baru — cukup warning >500ms agar regresi kelihatan sebelum user komplain.
4. Opsional: tambah `responseCacheService` hit/miss log untuk `customers:stats`.

### Fase 0.5 Index — Index Composite & Trigram (eksplisit, jika Fase 0 tunjuk Seq Scan) — BARU
*Jika `EXPLAIN` tunjuk Seq Scan dan `q` sering pakai `ILIKE %q%`:*
**Ubah `prisma/schema.prisma:107` + `prisma/migrations/.../migration.sql`:**
```prisma
@@index([tenant_id, is_sandbox_test])          // untuk where tenant_id+is_sandbox_test=false (paling sering)
@@index([tenant_id, is_mql])                   // untuk segment mql
@@index([tenant_id, is_sandbox_test, created_at]) // composite untuk orderBy default
// Untuk ILIKE %q% — enable pg_trgm + GIN (butuh CREATE EXTENSION pg_trgm)
@@index([name(ops: GinTrgmOps)], type: Gin)    // Prisma preview: perlu raw SQL migration: CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX ... USING gin (name gin_trgm_ops);
```
*Raw migration:*
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX customers_tenant_sandbox_idx ON customers(tenant_id, is_sandbox_test);
CREATE INDEX customers_tenant_mql_idx ON customers(tenant_id, is_mql);
CREATE INDEX customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops);
-- opsional untuk kecamatan/kota jika sering search lokasi: CREATE INDEX customers_kecamatan_trgm_idx ON customers USING gin (kecamatan gin_trgm_ops);
```
*Verifikasi: `EXPLAIN` harus `Bitmap Heap Scan` + `Bitmap Index Scan` atau `Index Scan`, bukan `Seq Scan`. Ukur lagi di Fase 6.*

---

## 5. Urutan Eksekusi & Estimasi (Revisi)

| Fase | Estimasi | Ketergantungan | Risiko | Status |
|------|----------|----------------|--------|--------|
| 0 cek live | 0.5h | none | read-only | next |
| 0.5 investigasi N+1 & pool sizing | 0.5h | 0 | read-only | next |
| 0.5 index (jika Seq Scan) | 0.5d | 0 | medium (migrasi) | kondisional |
| 1 skeleton P0 | 0.5d | 0.5 | low (UI only) | next |
| 1.5 fix N+1 (kondisional) | 0.5d | 0.5 | low | kondisional (>100ms) |
| 2 retry P0 | 0.5d | 1 | low | next |
| 3 pisah stats P1 | 0.5d | 0.5 | low (cache) | pending |
| 3.5 query consolidation P1 | 0.5d | 3 | low | pending |
| 4 search guard + LTV korektnes P2 | 0.5d | 1.5,3.5 | medium (korektnes) | pending |
| 5 postgres tuning P2 | 0.5d | 0 | deploy | kondisional |
| 5.5 pool sizing P1 | 0.5d | 0.5 | deploy | kondisional |
| 6 load test P1 | 0.5d | 1-5 | read-only | sebelum prod |
| 7 observability P1 | 0.5d | 3 | low | pending |
| **Total (full)** | **~4.5 hari** | | | |
| **Total (minimal P0: 0+0.5+1+2)** | **~1.5 hari** | | | UX langsung membaik |

Rekomendasi: **Fase 0 → 0.5 → 0.5 index (jika Seq Scan) → 1+1.5 (kondisional) +2** (1.5 hari), lalu 3+3.5+4, lalu 5.5+6+7 sebelum prod.

---

## 6. Verifikasi & Deploy (Revisi)

- **Lokal:** `npm run build` (`tsc` + `vite build`), `node_modules/.bin/tsc --noEmit` 0 error, `CustomerDatabase` chunk +<5kB. Throttle Chrome DevTools Slow 3G → skeleton muncul, timeout 20s → banner retry muncul, klik `Coba Lagi` → reload.
- **Staging/Local load test (Fase 6):** `autocannon -c 8 -d 20` untuk `sortBy=created_at` dan `sortBy=ltv` — p95 <1s, p99 <1.5s, bandingkan sebelum/sesudah.
- **Live (2-step gate):** `docker compose exec -T postgres psql ... EXPLAIN` → `Bitmap Index Scan` (jika index dibuat), `docker stats` CPU <70%, `docker logs --tail 30 wa-clinic-bot-app-1 | grep "GET /customers.*elapsed"` p95 <500ms, tanpa `P1001`.
- **Prod:** `docker compose build app && docker compose up -d --no-deps app` (WAHA tetap Up), `Caddy` tidak restart. Migrasi index `prisma migrate deploy` dulu jika Fase 0.5 index.

---

## 7. Risiko & Mitigasi (Revisi)

- **🔴 SILENT BUG — LTV cap tanpa full computation (Fase 4):** → **JANGAN** `take: Math.min(15,pageSize)` untuk `sortBy=ltv`. Timeout terlihat (user komplain), tapi LTV salah **tidak terlihat** — user ambil keputusan bisnis (promo top spender) berdasar data salah tanpa warning. Mitigasi: **Confirmation Gate** wajib — Fase 4 butuh approval owner sebelum deploy, dan Fase 6 `autocannon sortBy=ltv` harus pass korektnes (bandingkan top-15 hasil vs full-scan 500). Jika Opsi A (materialize) butuh `UPDATE` backfill, jalankan `--dry-run` dulu.
- **Skeleton kedip saat data 500 cepat (<200ms):** → `if(loading && customers.length===0)` saja, refresh tidak full skeleton.
- **Retry spam:** → `retryCount` debounced 1s, tombol `disabled` saat `loading`.
- **Stats stale 60s:** → `Cache-Control private, max-age=5, stale-while-revalidate=30` tetap, tapi stats terpisah `max-age=60`.
- **Index GIN `pg_trgm` berat (500 rows tetap ringan tapi migrasi):** → `--from-url` diff empty, bukan `--from-migrations` (`KNOWN_ISSUES#1`), `CREATE EXTENSION IF NOT EXISTS pg_trgm` idempotent.
- **LTV materialize butuh backfill:** → `UPDATE customers SET ltv_cache = (SELECT SUM...)` sekali saat migrasi, trigger/app update saat `reservations.purchase_value` berubah.
- **Pool sizing salah (connection_limit > max_connections):** → cek `SHOW max_connections` dulu (100) vs `connection_limit` total semua service <80.
- **Load test flaky di laptop:** → jalankan di staging server atau `autocannon` dengan `connection_limit` sama dengan prod.

---

## 8. Notes Eksekutor

- **File diubah Fase 0.5-1.5:** `src/services/customer.service.ts`, `src/services/capi.service.ts`, `src/db/client.ts` (log query).
- **File Fase 1-2:** `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx`, `packages/admin-dashboard/src/services/api.ts` (timeoutMs).
- **File Fase 3-4:** `src/services/customer.service.ts`, `src/routes/admin/customers.subroute.ts`, `prisma/schema.prisma` + `prisma/migrations/.../migration.sql` (index), raw SQL `$queryRaw` jika konsolidasi.
- **File Fase 5.5:** `docker-compose.yml`, `.env` (DATABASE_URL `connection_limit`).
- **File Fase 7:** `src/routes/admin/customers.subroute.ts`, `src/utils/logger.ts`.
- **Cara lanjut:**
  ```bash
  git checkout -b plan/customer-db-skeleton
  # Fase 0+0.5 cek live dulu
  ssh -p 1403 ubuntu@43.157.197.148 "docker compose exec -T app printenv | grep DATABASE_URL; docker compose exec -T postgres psql -U postgres -d wa_clinic_db -c 'SHOW max_connections; SELECT count(*) FROM pg_stat_activity;' "
  # Fase 1+1.5+2
  npm run build && npx tsc --noEmit
  git commit -m "feat(customer-db): skeleton + retry + N+1 fix + index composite (Fase 0.5-2)"
  # Fase 3-4 (pisah stats + LTV korektnes)
  # Fase 6 autocannon load test sebelum prod
  git push origin plan/customer-db-skeleton
  ```
- **Catat ke `docs/KNOWN_ISSUES.md` setelah selesai:** tambah `#19 Customer DB Timeout 10s` dengan `Status: mitigated (2026-09-01) Fase 0.5-2, root: N+1 resolveTreatmentValue + pool exhaustion (500 rows, bukan seq scan), fix: skeleton+retry+pool sizing`.
