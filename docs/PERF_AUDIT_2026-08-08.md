# Performance & Latency Audit — Production (2026-08-08)

**Server:** `43.157.197.148` (2 vCPU / 4GB) · Compose project `wa-clinic-bot` (4 kontainer: app, caddy, postgres, waha)
**Scope:** koneksi database (Postgres + Redis), endpoint Admin Panel, landing page, infrastruktur.
**Excluded (sesuai scope):** latency chatbot WhatsApp (Humanizer Typing WPM=48 BY DESIGN) dan latency LLM call (1–3s wajar).

**Metode pengukuran:**
- `src/scripts/db-health-check.ts` — dijalankan via `node` di dalam kontainer `app` (DB loopback).
- `src/scripts/admin-latency-benchmark.ts` (inject) + probe fetch loopback `localhost:3000` ke **app server nyata**.
- Probe TTFB dari lokasi audit + server-side render (loopback, tanpa network noise).

> Baseline penting: **trafik masih sangat rendah** (2 customer, 20 message, 0 reservation, 0 FAQ staging, 45 knowledge_chunks).
> Angka di bawah = latency pada **dataset kecil**. Kesimpulan akhir bukan "tidak ada masalah" — beberapa endpoint punya pola yang
> akan menjadi mahal seiring pertumbuhan data (lihat Prioritas).

---

## 1) Kesehatan Koneksi Database — PostgreSQL

| Pengukuran | p50 | p95 | p99 | avg | n |
|---|---|---|---|---|---|
| **Raw connect** (fresh `$connect` per PrismaClient) | 58.1ms | 77.8ms | 77.8ms | 60.0ms | 8 |
| SELECT 1 (warm, pooled) | 0.4ms | 56.1ms | 56.1ms | 7.4ms | 8 |
| **FTS `websearch_to_tsquery`** (knowledge_chunks) | 2.1ms | 11.6ms | 11.6ms | 3.3ms | 8 |
| Join Customer+Reservations+Children (take 20) | 1.8ms | 8.0ms | 8.0ms | 2.5ms | 8 |
| `medical_faq_staging.findMany` (PENDING, take 50) | 0.8ms | 2.1ms | 2.1ms | 0.9ms | 8 |
| `general_faq_staging.findMany` | 0.8ms | 1.1ms | 1.1ms | 0.8ms | 8 |
| `knowledgeChunk.findUnique` per-row (probe N+1) | 0.6ms | 2.8ms | 2.8ms | 0.9ms | 8 |

**Connection Pool (`pg_stat_activity` saat audit):** `{"idle": 5, "active": 1}` — **tidak ada `idle-in-transaction`** (0) → tidak ada koneksi bocor. Query pooled sangat cepat setelah koneksi pertama (0.4–2ms). Outlier `SELECT 1 p95=56ms` muncul dari cold pool / spawn query-engine pada request pertama.

**EXPLAIN ANALYZE (deteksi index):**
- FTS `knowledge_chunks`: **Bitmap Index Scan** (bukan Seq Scan) lewat `knowledge_chunks_tenant_id_idx`, lalu filter `to_tsvector` di ~45 baris tenant. Index `tenant_id` menyelematkan saat ini; **tetap TIDAK ada generated tsvector + GIN index** — akan berubah menjadi Seq Scan saat knowledge_chunks besar (query menghitung `to_tsvector` per-baris).
- `medical_faq_staging status='PENDING'`: **Index Scan** via index `status` → OK.
- Kandidat index yang belum ada: `KnowledgeChunk.content` (FTS), staging `raw_question` (ILIKE `contains` fallback), `Conversation.escalation_reason` (`unresolved_faq`), `Conversation.review_flagged`, `Reservation.customer_id`/`status`, `Customer.name` (search), JSONB `Message.payload_raw`.
- **TEMUAN:** extension `pg_stat_statements` **tidak terpasang** → slow-query monitoring tidak tersedia.

**Redis — status: ❌ ABSENT (degraded total)**
- Probe koneksi `localhost:6379` → `ECONNREFUSED`. **Tidak ada service Redis di docker-compose**, `REDIS_HOST/PORT` tidak di-env-kan.
- Keempat konsumen (BullMQ message shards, broadcast queue, live-chat pub/sub, FAQ cache) **beroperasi di in-memory fallback sejak boot**:
  - durable queueing hilang (job hilang saat restart)
  - multi-instance LiveChat sync tidak tersedia
  - health endpoint `GET /api/admin/health` **hardcode** `"redisQueue": "IN_MEMORY_FALLBACK_ACTIVE"` (settings.subroute.ts:929) → admin tidak dapat mendeteksi degradasi nyata.
- **Dikonfirmasi dari log:** setiap boot muncul `[CRITICAL ALERT] Redis connection failed during startup … Entering In-Memory Message Queue / LiveChat Hub Fallback Mode.`

**Pool Prisma:** DATABASE_URL live saat ini **tidak mengandung `connection_limit`** → memakai default. Tuning `connection_limit=20 pool_timeout=10` ada di `docker-compose.yml` (commit `4ab5817`) tapi server berjalan di commit `710e759` (belum deploy) → **belum teraplikasi**.

---

## 2) Latency API Admin — per endpoint (loopback, app nyata)

### Mode idle (concurrency=1, 10 iters)

| Endpoint | p50 | p95 | p99 | payload max |
|---|---|---|---|---|
| `GET /api/admin/reservations?page=1&pageSize=20` | 3ms | 56ms | 56ms | 74 B |
| `GET /api/admin/reservations/count` | 2ms | 3ms | 3ms | 26 B |
| `GET /api/admin/customers?search=&page=1&pageSize=20` | 5ms | 12ms | 12ms | 761 B |
| `GET /api/admin/human-handling-conversations` | 3ms | 7ms | 7ms | 4174 B |
| `GET /api/admin/live-chat/conversations?limit=50&offset=0` | 5ms | 7ms | 7ms | 4367 B |
| `GET /api/admin/knowledge/chunks?page=1&pageSize=20` | 3ms | 26ms | 26ms | 9674 B |
| `GET /api/admin/migration/staging?status=PENDING&page=1&limit=20` | 2ms | 9ms | 9ms | 71 B |
| `GET /api/admin/medical-faq-staging` | 2ms | 4ms | 4ms | 26 B |
| `GET /api/admin/general-faq-staging` | 2ms | 3ms | 3ms | 26 B |
| `GET /api/admin/harvest/status` | 1ms | 3ms | 3ms | 184 B |
| `GET /api/admin/ai-models` | 1ms | 2ms | 2ms | 1082 B |
| `GET /api/admin/ai-evaluations?days=7&limit=20` | 3ms | 6ms | 6ms | 86 B |
| `GET /api/admin/settings` | 1ms | 1ms | 1ms | 39 B |
| `GET /api/admin/health` (panggil WAHA) | 3ms | 12ms | 12ms | 450 B |
| `GET /api/admin/ai-rollout-scope` | 3ms | 21ms | 21ms | 192 B |
| `GET /api/admin/whatsapp-provider` (panggil WAHA) | 10ms | 22ms | 22ms | 2172 B |

### Mode beban (concurrency=8, loopback)

| Endpoint | p50 | p95 |
|---|---|---|
| `reservations-list` | **81ms** | **97ms** |
| `reservations/count` | 11ms | 15ms |
| `customers-list` | 36ms | 41ms |
| `chat-conversations` | 26ms | 35ms |
| `livechat-list` | 44ms | 49ms |
| `knowledge-chunks` | 16ms | 20ms |
| `migration-staging` | 18ms | 20ms |
| `medical-faq-staging` | 11ms | 17ms |
| `general-faq-staging` | 9ms | 14ms |
| `harvest-status` | 8ms | 11ms |
| `ai-models` | 5ms | 5ms |
| `ai-evaluations` | 27ms | 30ms |
| `settings` | 8ms | 8ms |
| `health`/`ai-rollout-scope`/`whatsapp-provider` | `429` (rate-limit 300/min/IP terpakai benchmark) |

**Kesimpulan:**
- Endpoint utama semua **p50 < 11ms**, **p95 < 60ms** saat idle — sehat.
- Yang menonjol naik saat concurrency 8: `reservations-list` 3ms → 81ms (**27×**) dan `customers-list` 5ms → 36ms — beban reload child + `computeCurrentAge`/`extractBabyDetails` + count di tengah 2-vCPU contention.
- `429` murni karena **rate-limit global 300/min per-key+IP** — bukan bug, indikasi healthy di bawah throttle.

**Group write DB (n=1, dummy ID):** `migration-staging PATCH` 10.8ms (not-found path), `PUT knowledge-chunk` 2.5ms (500 not-found), `settings PATCH` 0.6ms, `conversation release` 3.2ms, `ai-models PATCH` 0.8ms — semua write DB ringan. Endpoint ber-eksternal (GCal/WAHA/LLM) **tidak di-load-test** sesuai scope.

---

## 3) Landing Page & `/go` (wa-click-catcher retired, diserve bot)

**Domain publik:** `app.kalababyspa.online` (A record → `43.157.197.148`, **tanpa CDN/Cloudflare**).

| Item | Angka |
|---|---|
| TTFB `GET /health` (luar server) | 24–27ms warm / 976ms cold |
| TTFB `/go?slug=default` (luar server) | **102ms** (HTML 11 KB) |
| TTFB `/cta` (luar server) | 32–220ms (200 + redirect `wa.me`) |
| TTFB `/ready` | 93–107ms |
| TTFB `/assets/clientParamBuilder.bundle.js` | 32–105ms (56 KB) |
| Server-side render `/go` (loopback) | p50 7.5ms / p95 13.7ms |
| Server-side render `/promo`, `/` (loopback) | p50 ~3.5ms |
| Bundle admin dashboard (JS) | hingga ~392 KB |

**CSP/nonce overhead:** header `Content-Security-Policy: script-src 'nonce-…'` + `X-Frame-Options` + `X-Content-Type-Options` terpasang; server-side `/go` dengan nonce + sanitasi + tracking inject hanya +~6ms → overhead tidak signifikan.

**Kesimpulan:** TTFB sangat baik untuk tanpa-CDN. Yang tampil: bundle JS landing 56 KB ikut ditarik tanpa CDN, dan perlu verifikasi `Content-Encoding: gzip` di sisi server.

---

## 4) Audit Infrastruktur & Kontensi

| Item | Temuan |
|---|---|
| **CPU (host)** | idle `98–99%`, load avg `0.01–0.08` — **tidak ada contention** di 2 vCPU saat baseline |
| **RAM** | 1.9 GiB total: 1.1 GiB terpakai, 845MiB available, swap 374MiB |
| **Per-container CPU (idle)** | app 0.3%, WAHA 0.03%, postgres 0.01%, caddy 0.01% |
| **Memori per container** | app ~358MB, WAHA ~173MB, postgres 56MB, caddy 37MB |
| **Proses aneh** | `node dist/main` **ternyata milik kontainer WAHA** (Baileys engine) — bukan orphan. Tidak ada PHP/apache/mysql/nginx asing. |
| **WordPress** | **TIDAK ADA** (tidak ada php/mysql, systemd hanya sshd+docker) — sesuai asumsi. |
| **Bandwidth** | eth0 1–4 KiB/s saat sampling vs limit 30 Mbps — jauh dari cap. |
| **Log error** | App: hanya `CRITICAL ALERT Redis` (sesuai temuan Redis). Tidak ada timeout/ECONN DB. PG: error migrasi historis (`column "preferences" already exists`, `relation "ai_evaluations" already exists`) + `pg_stat_statements does not exist`. |
| **Port** | ssh 1403, caddy 80/443. |

---

## 5) Prioritas Masalah (dampak tertinggi → terendah)

### P1 — Redis benar-benar ABSENT → seluruh queue/pub-sub on-memory fallback, health-pala tidak melaporkan
- **Dampak:** durable queueing hilang (restart = antrian hilang), multi-instance LiveChat tidak sinkron; admin tak tahu karena `GET /api/admin/health` **hardcode** `IN_MEMORY_FALLBACK_ACTIVE`.
- **Rekomendasi:** tambah service `redis:7` di `docker-compose.yml` + set `REDIS_HOST=redis`/`REDIS_PORT=6379` di env app; tambah Redis check di `/ready` dan health (tidak hardcoded). *(Fokus SaaS: simpan konfigurasi per tenant — lewati Confirmation Gate bila butuh keputusan.)*

### P2 — FTS knowledge_chunks tanpa GIN index (masked saat ini oleh index tenant_id + 45 baris)
- **Dampak:** tiap balasan FAQ menghitung `to_tsvector` di seluruh baris tenant → jadi lambat saat data besar.
- **Rekomendasi:** tambah kolom `tsvector` generated + GIN index di migrasi; ubah query di `knowledge.service.ts:138-167` untuk memakai kolom tersebut.

### P3 — Endpoint FAQ staging list unpaged + N+1 chunk lookup
- **Dampak:** `GET /medical-faq-staging` & `/general-faq-staging` (migration.subroute) loop `Promise.all` per-row ke `knowledgeChunk.findUnique` → O(N) round-trip saat staging banyak.
- **Rekomendasi:** paginate + satu query IN-batch atau join `matched_chunk_id`.

### P4 — `commitApprovedRecords` N+1 besar saat batch (migration.service)
- **Dampak:** 5+ query serial per record (getOrCreate customer/conversation, message findFirst+create, reservation, staging). Linear × volume.
- **Rekomendasi:** bungkus dalam `prisma.$transaction` + `createMany`/bulk + batas chun cidak.

### P5 — Ingestor FAQ/Document menulis per-item sequential (knowledge.service)
- **Rekomendasi:** pakai `createMany`/bulk upsert (sudah ada pola di treatment-catalog).

### P6 — Kolom filter kurang index (jadi kompensasi saat data tumbuh)
- Kandidat: `Conversation.escalation_reason` (knowledge/unanswered), `Conversation.review_flagged` (customers/flagged), `Reservation.customer_id`/`status`, `Customer.name` (search), `Message.payload_raw` JSONB path, staging `raw_question`.
- **Rekomendasi:** tambah index di migrasi berikutnya + aktifkan `pg_stat_statements` untuk monitor.

### P7 — CDN & kompresi belum terpasang
- **Rekomendasi:** pasang Cloudflare di depan `app.kalababyspa.online`; pastikan gzip/brotli; lazy-load/kompres asset. Bundle admin 392KB relevan untuk dashboard internal (bukan landing).

### P8 — Catatan non-fatal
- `pg_stat_statements` tidak terpasang → aktifkan untuk slow-query monitoring.
- `GET /api/admin/legacy-staging` filter hardcode `'default'` (inkonsisten dengan `'default-tenant'`) → perbaiki ke `DEFAULT_TENANT_ID`.
- Beberapa route yang dipanggil dashboard tidak ada backend (mis. `/api/admin/debug/conversations`, `/api/admin/harvest/staging/export-md`) → dead link, bukan isu performa.
- App container jalan di commit lama (`710e759`); repo berlaku di `4ab5817` — `connection_limit=20/pool_timeout=10` belum teraplikasi di live.

---

## 6) Verifikasi ulang / monitoring

Script sudah berada di repo (`src/scripts/*.ts`) dan siap dipakai berkala:
```bash
docker exec -it wa-clinic-bot-app-1 npx tsx src/scripts/db-health-check.ts
docker exec -it wa-clinic-bot-app-1 npx tsx src/scripts/admin-latency-benchmark.ts --concurrent=1
```
Disarankan audit ulang 1×/bulan sebagai baseline (data live sudah mulai terisi).

---

*Laporan hasil audit satu-pass 2026-08-08 terhadap server production. Data diukur saat trafik masih sangat rendah; angka akan berubah saat live. Prioritas disusun dari dampak terbesar, bukan sekadar daftar diagnosis.*