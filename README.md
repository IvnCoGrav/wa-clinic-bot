# WAHA Clinic Automation Chatbot Engine

Engine percakapan otomatis berbasis **State Machine** untuk bisnis Klinik Treatment / Kecantikan. Terintegrasi dengan **WAHA (WhatsApp HTTP API)** dan **Meta Cloud API (WABA)**, **Humanizer Typing Simulation Service**, **Knowledge Base RAG (Postgres Full-Text Search)**, **AI Router**, dan **Persona Config** (tenant-aware, dari DB).

---

## 🛠 Tech Stack

- **Backend**: Node.js + TypeScript, Fastify Framework
- **Database**: PostgreSQL (Prisma ORM) dengan Full-Text Search (`'simple'` dictionary)
- **Channel**: WAHA (WhatsApp HTTP API Self-Hosted) + Meta Cloud API (WABA), dual-gateway per tenant
- **Geocoding**: Gazetteer kelurahan/kecamatan (fuzzy match) → LLM fallback; jarak via OpenRouteService (ORS) + fallback Haversine
- **LLM**: Multi-model (MiniMax / DeepSeek / Qwen) via SumoPod endpoint, per-task config tenant-aware dari DB
- **Deployment**: Dockerfile & Docker Compose (app + postgres + redis + caddy + waha)

---

## 📁 Struktur Folder Project

```text
wa-clinic-bot/
├── prisma/
│   ├── schema.prisma              # Skema database (23 model: Customer, Conversation, Message, Reservation, dsb)
│   └── migrations/                # Migrasi Prisma (20260721070211_init … 20260823000000_*)
├── docs/                          # Dokumentasi teknis & audit (KNOWN_ISSUES, META_FUNNEL, PERF_AUDIT, dsb)
├── src/
│   ├── app.ts                     # Fastify server entry point (buildApp())
│   ├── config/                    # Config tenant-aware (sumber kebenaran DB, fallback env)
│   │   ├── tenant.ts              # DEFAULT_TENANT_ID
│   │   ├── clinic.ts              # Titik lokasi klinik & threshold ongkir
│   │   ├── persona.ts             # Persona & tone of voice system prompt untuk LLM
│   │   ├── brand.ts               # Brand identity (tenant-aware)
│   │   ├── ai-models.config.ts    # Registry model per task LLM (CHAT/NLU/HARVESTING/…)
│   │   ├── ai-router-config.ts    # Konfigurasi AI Router per tenant (DB → env → default)
│   │   ├── ai-eligibility-config.ts # AI rollout scope per tenant
│   │   ├── idle-greeting.config.ts # Sapaan hangat setelah idle
│   │   ├── llm-context.ts         # Batas riwayat percakapan ke LLM
│   │   ├── service-areas.ts       # Wilayah layanan (CSV env / daftar default)
│   │   ├── medical-keywords.ts    # Single source keyword medis
│   │   └── followup-templates.ts  # Rolling template follow-up
│   ├── db/
│   │   └── client.ts              # Prisma singleton client
│   ├── integrations/
│   │   ├── waha/                  # WAHA HTTP API client (sendText, sendImage, label, dsb)
│   │   ├── whatsapp/              # Gateway abstraction (WAHA + WABA drivers, normalizer, factory)
│   │   ├── google-maps/           # Geocoding gazetteer + LLM fallback
│   │   ├── ors/                   # OpenRouteService Directions API
│   │   └── llm/
│   │       ├── ai-router.ts       # AI Router Engine (LLM intent classifier + circuit breaker + shadow mode)
│   │       ├── intent.ts          # NLU Intent (interested, faq_question, medical_query, …)
│   │       ├── generator.ts       # Persona-based RAG FAQ Response Generator
│   │       ├── phrasing.service.ts # Natural language response generation via LLM (intent + facts)
│   │       ├── model-fallback.ts  # Fallback model (primary → qwen → deterministik)
│   │       └── opener-tracker.ts  # Anti-repetition opener tracking (TTL 2 jam)
│   ├── state-machine/
│   │   ├── machine.ts             # Core State Machine Orchestrator
│   │   └── handlers/              # greeting, location, location-confirmation, interest, human
│   ├── services/                  # Queue, customer, conversation, message, follow-up, capi,
│   │   │                          # media, cron, alert, live-chat, broadcast-queue, command,
│   │   │                          # purchase-detection, daily-report, child, treatment-catalog,
│   │   │                          # nlu-classifier, price-answer, waba-*, llm-evaluator, dsb.
│   ├── routes/
│   │   ├── webhook.route.ts       # POST /webhook (WAHA)
│   │   ├── waba-webhook.route.ts  # GET|POST /api/webhook/waba (Meta Cloud)
│   │   ├── admin.route.ts         # REST Admin API (+ admin/ subroutes: auth, customers,
│   │   │                          #   livechat, reservations, knowledge, landings, settings, dsb)
│   │   ├── landing.route.ts       # Landing page (/{slug}, /promo/:slug, /go, /cta, /assets)
│   │   ├── tracking.route.ts      # /api/tracking/* & /api/tenant/:slug
│   │   ├── media.route.ts         # /media/:scope/:tenant/:file
│   │   └── health.route.ts        # /health
│   ├── cli/                       # chat-simulator.ts, seed-faq.ts, scrape-all.ts, dsb
│   ├── scripts/                   # check-router-accuracy.ts, push-persona.ts, benchmark-*, dsb
│   ├── utils/                     # encryption, circuit-breaker, jid, similarity, whatsapp-format, dsb
│   └── landing/public/            # go.html, external-tracker.js, clientParamBuilder.bundle.js
├── tests/                         # Vitest (unit + integration), setup.ts mock DB & Redis
├── packages/
│   ├── admin-dashboard/           # React SPA dashboard admin (di-serve bot di /admin/*)
│   └── click-catcher/             # RETIRED — referensi saja, tidak dipakai lagi
├── scripts/                       # copy-landing-assets.js, backup.sh, deploy-*.sh
├── assets/                        # Aset gambar (pricelist_spa.jpg, dsb)
├── Dockerfile
├── docker-compose.yml
├── Caddyfile
├── .env.example
└── README.md
```

---

## ⚡ Panduan Setup & Running Lokal

### 1. Environment Variables (`.env`)
Salin `.env.example` menjadi `.env` lalu isi nilainya. **Wajib diisi sebelum boot**:
`ADMIN_API_KEY` (boot akan throw bila kosong), `DATABASE_URL`, `WAHA_BASE_URL`/`WAHA_API_KEY`,
dan `WAHA_WEBHOOK_SECRET` (wajib di produksi).

```env
PORT=3000
HOST=0.0.0.0
ADMIN_API_KEY="my_secure_random_admin_api_key"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/wa_clinic_db?schema=public"

# WAHA Config
WAHA_BASE_URL="http://localhost:3001"
WAHA_API_KEY="my_waha_api_key_secret"
WAHA_SESSION="default"
WAHA_WEBHOOK_SECRET=""

# Klinik
CLINIC_LAT=-7.34886
CLINIC_LNG=112.751677
CLINIC_NAME="Kala Moms and Baby Spa"

# Timeout Auto-Release Human Handling (Jam)
HUMAN_HANDLING_TIMEOUT_HOURS=6
```

> Daftar lengkap var (Redis, ORS, LLM, Media, WABA, Telegram, dsb.) ada di `.env.example`.

### 2. Jalankan WAHA Docker (NOWEB Engine)

Chatbot ini merekomendasikan penggunaan **WAHA versi NOWEB (Baileys Engine)** karena sangat hemat memori RAM (~100 MB) dan stabil untuk produksi. **Versi di-pin** di `docker-compose.yml` (`devlikeapro/waha:noweb-2026.7.2`) — **JANGAN pakai tag `:latest`**. Jalankan via Compose agar sesi tersimpan permanen:

```bash
docker compose up -d waha
```

Scan QR dari WAHA dashboard: `http://localhost:3001/dashboard/` (user/pass default: `admin` / `admin12345`).

### 3. Jalankan Aplikasi dengan Docker Compose

```bash
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
```

Compose menyediakan 5 service: `app`, `postgres` (16-alpine), `redis` (7-alpine), `caddy`, dan `waha`.

---

## 🚀 Deployment & Runbook Migration

### Prisma Migrations — Jalankan ke Environment Baru

Pastikan `DATABASE_URL` sudah diisi, lalu:

```bash
npx prisma generate
npx prisma migrate deploy
```

> ⚠️ **Known pitfall: `relation "children" already exists`**
>
> Migration `20260802000000_add_children` pernah tercatat **failed** di `_prisma_migrations`
> (`finished_at = NULL`) meski tabel `children` sudah terlanjur dibuat — ini menyisakan drift
> antara folder `prisma/migrations` dan tabel `_prisma_migrations`. Di environment yang terdampak,
> `migrate deploy` gagal di tengah jalan dengan error `relation "children" already exists`.
>
> **Fix** (sekali saja, JANGAN drop tabel `children`):
> ```bash
> npx prisma migrate resolve --applied 20260802000000_add_children
> npx prisma migrate deploy
> ```
>
> Verifikasi tidak ada drift antara DB asli dan skema (output harus `-- This is an empty migration.`):
> ```bash
> npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
> ```

> ⚠️ **Known issue: `migrate diff --from-migrations` (shadow replay) rusak**
>
> Replay migration dari scratch ke shadow DB gagal di `20260801000000_add_failed_followup_status`
> (`ERROR: type "FollowUpStatus" does not exist`) — bug urutan enum, **pre-existing** (bukan dari
> perubahan terbaru). Gunakan `--from-url` (perintah di atas) sebagai pengganti. Detail:
> `docs/KNOWN_ISSUES.md`.

### Shadow Mode AI Router — Timeline Monitoring

AI Router **default ON per tenant** (diatur dari Admin Dashboard → Settings → AI Router Engine).
Sumber kebenaran: kolom `tenants.ai_router_enabled` / `tenants.ai_router_shadow_mode`
(default ON + shadow ON — aman). Env `AI_ROUTER_ENABLED` / `AI_ROUTER_SHADOW_MODE`
hanya fallback saat DB tidak tersedia. Router menulis evaluasi per pesan ke tabel
`ai_router_evaluations`. Cek akurasi dengan:

```bash
npx tsx src/scripts/check-router-accuracy.ts --days=7
```

**Jadwal cek yang disarankan:**
- **Hari ke-1:** langsung jalankan script — kriteria **mismatch `MEDICAL_CONCERN` = 0 (hard-zero)**
  wajib dipantau dari hari pertama, jangan menunggu 7 hari.
- **Hari ke-3:** cek tren pertama (escalation match rate, UNMAPPED rate).
- **Hari ke-7:** jalankan gate lengkap sebelum memutuskan mematikan shadow mode.

**Kriteria aman mematikan `AI_ROUTER_SHADOW_MODE` (semua wajib):**
1. `escalation match rate >= 98%` selama minimal 7 hari berturut-turut, DAN
2. mismatch terkait `MEDICAL_CONCERN` = **0** (hard-zero), DAN
3. `UNMAPPED` rate di `legacy_intent` < 5%.

### Live Chat Panel — Catatan Deployment (SSE)

Endpoint `GET /api/admin/live-chat/events` memakai **Server-Sent Events** (satu kanal per tenant:
`livechat:{tenantId}`, via Redis pub/sub). Saat bot di belakang reverse proxy:

- **Matikan buffering proxy** untuk endpoint SSE — nginx: `proxy_buffering off;`. Backend sudah mengirim
  header `X-Accel-Buffering: no` + `Cache-Control: no-cache` + heartbeat `: ping` 15 detik (anti-idle-timeout balancer).
- **Redis wajib healthy.** Kalau Redis down, hub fallback ke in-memory EventEmitter — event hanya sinkron
  dalam satu instance (multi-instance tidak sinkron) dan alert CRITICAL `queue.service` terpublish.
- **Konek WAHA via QR** dari Admin UI (Settings → WAHA → Koneksi WhatsApp): scan QR lewat
  `GET /api/admin/whatsapp-provider/qr`, start session lewat `POST /api/admin/whatsapp-provider/session/start`.
  Session id per-tenant (`tenant.waha_session_id`), fallback env `WAHA_SESSION` saat DB down.
  Detail lengkap: `deploy_config.txt`.

### Landing Page — Di-Serve Langsung oleh Bot

Landing page iklan kini disajikan **langsung oleh bot** di port utama (domain yang sama dengan admin dashboard). Microservice `packages/click-catcher` **tidak lagi dipakai** di docker-compose (dibiarkan sebagai referensi).

**URL yang dilayani:**
- `GET /go` — pintu masuk kampanye (fail-open, selalu 200 generik). Opsional `?slug=` untuk memuat landing spesifik.
- `GET /promo/:slug` dan `GET /:slug` — landing per-slug. **Strict 404** bila slug tidak ada / nonaktif.
- `GET /:slug` dilindungi daftar `RESERVED_SLUGS` (`go`, `promo`, `health`, `api`, `admin`, `public`, `assets`, `favicon.ico`) → 404.

**Kelola di admin:** Dashboard → menu **Landing Page** (CRUD, preview/ikon mata, toggle aktif, upload HTML kustom, pilih events, override Pixel & No. WA).

**Mode konten:**
- `STRUCTURED_JSON` — render template `src/landing/public/go.html` (headline, subheadline, benefits, FAQ).
- `RAW_HTML` — upload file HTML (maks 500 KB, wajib elemen `<a id="wa-cta">`), disanitasi 17-layer; tag `<script>`/`<iframe>`/dll di-strip.

**Tracking & keamanan:**
- **Event klien (pixel):** `PageView` selalu di-fire; events onload (`ViewContent`, `Search`) setelah PageView; events click (`Lead`, `Purchase`, dst) saat CTA diklik sebelum redirect.
- **Event server (CAPI):** funnel konversi end-to-end — `Contact` (first contact), `Lead` (MQL), `InitiateCheckout` (form reservasi dikirim), `Purchase` (deteksi pesan "Payment <nominal>" ATAU admin tandai lunas, dedup 7 hari via `purchase_event_sent_at`). Semua event memakai `event_id = adClick.trackingCode` supaya Meta men-dedup. Konfigurasi kata kunci per tenant (`format_checkout`, `format_purchase`, `format_value`).
- Tracking atribusi **same-origin**: `POST /api/tracking/click` (guard `X-Tracking-Api-Key`) menangkap `fbclid`, UTM, `_fbp`/`_fbc`.
- 📖 Referensi arsitektur lengkap: **[`docs/META_FUNNEL.md`](docs/META_FUNNEL.md)**.
- 🌐 Integrasi **Landing Page Eksternal** (Skema URL Redirect): `GET /cta` siap dipakai
  sebagai click-catcher + `GET /assets/external-tracker.js` sebagai jembatan atribusi
  untuk LP luar (WordPress/Elementor/HTML). Di Admin Dashboard (**Landing Page**) sudah
  ada card *copy-paste snippet* + modal panduan integrasi. Panduan:
  **[`docs/INTEGRASI_LANDING_EXTERNAL.md`](docs/INTEGRASI_LANDING_EXTERNAL.md)**
- Header keamanan: CSP `script-src 'nonce-…' https://connect.facebook.net; frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.

**Preview URL di admin:** dikontrol `LANDING_BASE_URL` (fallback `TRACKING_API_BASE_URL`); jika kosong, preview memakai path relatif same-origin (`/{slug}`).

### 4. Endpoints Admin Knowledge Base

- **Import FAQ (Bulk JSON)**:
  `POST /api/admin/knowledge/faq`
  ```json
  {
    "faqs": [
      {
        "question": "Berapa lama durasi treatment Facial Glowing?",
        "answer": "Durasi perawatan Facial Glowing berkisar antara 60 hingga 90 menit."
      }
    ]
  }
  ```
- **Import Dokumen (Auto-Chunking ~500-800 char)**:
  `POST /api/admin/knowledge/document`
  ```json
  {
    "documentName": "Brosur Treatment 2026.txt",
    "textContent": "Isi dokumen lengkap di sini..."
  }
  ```
- **Daftar Human Handling Active**:
  `GET /api/admin/human-handling-conversations`

### Customer Chat Commands (Perintah Slash di WhatsApp)

Customer bisa mengetik perintah slash langsung di chat bot. Semua perintah **per-customer** — hanya data nomor yang sedang chat ini yang terpengaruh, tidak pernah customer lain.

| Command | Fungsi |
|---|---|
| `/reset` | **Hard wipe** seluruh data chat & reservasi nomor ini (percakapan, pesan, reservasi, data anak, follow-up, staging terkait, event Google Calendar). Konfirmasi 1 langkah: ketik `/reset`, lalu balas **YA** dalam 5 menit untuk eksekusi (pesan lain = batal). Setelah reset, nomor dianggap customer baru. |
| `/state` | Debug: tampilkan state internal percakapan (current/previous state, attempts, human handling, coverage). |
| `/mulai` atau `/start` | Restart percakapan ke awal (state INITIAL + kosongkan lokasi) tanpa menghapus data; bot menampilkan greeting persona. |

Detail implementasi: `src/services/command.service.ts` (interceptor tunggal di `machine.processMessage()`), berlaku untuk webhook WAHA, WABA, maupun CLI simulator (`npm run chat`).

> **Catatan tenant-aware**: copy balasan command saat ini hardcoded Indonesia. Untuk multi-brand, copy ini dapat dipindahkan ke tabel per-tenant tanpa mengubah logika command.

