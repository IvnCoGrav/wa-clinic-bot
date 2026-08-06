# WAHA Clinic Automation Chatbot Engine (Fase 1)

Engine percakapan otomatis berbasis **State Machine** untuk bisnis Klinik Treatment / Kecantikan. Terintegrasi dengan **WAHA (WhatsApp HTTP API)**, **Typing Simulation Service**, **Knowledge Base RAG (Postgres Full-Text Search)**, dan **Persona Config**.

---

## 🛠 Tech Stack

- **Backend**: Node.js + TypeScript, Fastify Framework
- **Database**: PostgreSQL (Prisma ORM) dengan Full-Text Search (`'simple'` dictionary)
- **Channel**: WAHA (WhatsApp HTTP API Self-Hosted)
- **Geocoding**: Google Maps Geocoding API (Text & Reverse Geocoding)
- **Deployment**: Dockerfile & Docker Compose

---

## 📁 Struktur Folder Project

```text
wa-clinic-bot/
├── prisma/
│   └── schema.prisma              # Skema database (Customers, Conversations, Messages, KnowledgeChunks)
├── docs/
│   └── KNOWN_ISSUES.md            # Tech debt & known issues (drift migrasi, enum ordering, dsb)
├── src/
│   ├── config/
│   │   ├── env.ts                 # Environment variables parser
│   │   ├── clinic.ts              # Titik awal lokasi klinik & threshold ongkir
│   │   └── persona.ts             # Persona & tone of voice system prompt untuk LLM
│   ├── db/
│   │   └── client.ts              # Prisma singleton client
│   ├── integrations/
│   │   ├── waha/
│   │   │   ├── client.ts          # WAHA API client (sendText, sendSeen, startTyping, stopTyping)
│   │   │   └── types.ts           # Type definitions event webhook WAHA
│   │   ├── google-maps/
│   │   │   └── geocoding.ts       # Geocoding & Reverse Geocoding
│   │   └── llm/
│   │       ├── ai-router.ts       # AI Router Engine (LLM intent classifier + circuit breaker + shadow mode)
│   │       ├── intent.ts          # NLU Intent Classifier (11 intent + medical_query)
│   │       ├── generator.ts       # Persona-based RAG FAQ Response Generator
│   │       ├── phrasing.service.ts # Natural language response generation via LLM (intent + facts)
│   │       └── opener-tracker.ts  # Anti-repetition opener tracking (TTL 2 jam)
│   ├── state-machine/
│   │   ├── machine.ts             # Core State Machine Orchestrator (Wrapper typingService)
│   │   └── handlers/
│   │       ├── greeting.ts        # INITIAL -> AWAITING_LOCATION
│   │       ├── location.ts        # AWAITING_LOCATION (Hitung ongkir & 3x Retry Counter)
│   │       ├── interest.ts        # AWAITING_INTEREST (Handling faq_question tanpa reset state)
│   │       └── human.ts           # HUMAN_HANDLING (Silent bot & Auto-release restore)
│   ├── services/
│   │   ├── typing.service.ts      # Simulasi ngetik (sendSeen -> startTyping -> delay -> stopTyping -> sendText)
│   │   ├── knowledge.service.ts   # Knowledge Base FTS ('simple' dictionary & text chunker)
│   │   ├── delivery.service.ts    # Logic ongkir (Haversine & boundary tiering)
│   │   ├── customer.service.ts    # Ops database Customer
│   │   ├── conversation.service.ts# Ops state conversation & timeout auto-release
│   │   ├── ai-router-evaluation.service.ts # Log evaluasi router + eskalasi UNKNOWN berulang
│   │   ├── message.service.ts     # Audit log & Idempotency Check (wa_message_id)
│   │   ├── price-answer.service.ts # Jawaban harga deterministik dari catalog (anti-halusinasi)
│   │   ├── reservation-lifecycle.service.ts # Side-effect pasca-create reservasi (follow-up, children, labels)
│   │   ├── label-reconciliation.service.ts # Cron re-sync label WA vs status DB
│   │   └── per-contact-legacy-scrape.service.ts # Scraping legacy per-contact saat label 'legacy'
│   ├── routes/
│   │   ├── webhook.route.ts       # POST webhook WAHA (event: "message") + Guard Clause
│   │   ├── waba-webhook.route.ts  # Webhook WABA Meta Cloud (HMAC verify, normalizer, idempotency)
│   │   └── admin.route.ts         # REST Endpoints: Human Handling, Import FAQ, Create Reservation, Provider Toggle
│   ├── scripts/
│   │   └── check-router-accuracy.ts # Cek akurasi shadow mode (gate matikan shadow)
│   └── app.ts                     # Fastify server entry point
├── tests/
│   ├── unit/
│   │   ├── delivery.test.ts       # Test ongkir & boundary exact values (5.0, 5.01, 6.0, 6.01, 10.0, 10.01)
│   │   ├── typing.test.ts         # Test formula delay (800ms base + 40ms/char, cap 4s)
│   │   ├── knowledge.test.ts      # Test text chunker & FTS search
│   │   ├── state-machine.test.ts  # Test transisi state & auto-release
│   │   └── ai-router-engine.test.ts # Test AI Router (50 skenario test plan + observability + UNKNOWN eskalasi)
│   └── integration/
│       └── waha-webhook.test.ts   # Test WAHA event, idempotency & guard clause
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## ⚡ Panduan Setup & Running Lokal

### 1. Environment Variables (`.env`)
Salin `.env.example` menjadi `.env` lalu isi nilainya:

```env
PORT=3000
HOST=0.0.0.0
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/wa_clinic_db?schema=public"

# WAHA Config
WAHA_BASE_URL="http://localhost:3001"
WAHA_API_KEY="my_waha_api_key_secret"
WAHA_SESSION="default"

# Google Maps API Key
GOOGLE_MAPS_API_KEY="AIzaSy..."

# Konfigurasi Titik Klinik
CLINIC_LAT=-7.2574719
CLINIC_LNG=112.7520883
CLINIC_NAME="Klinik Kecantikan Utama Surabaya"

# Timeout Auto-Release Human Handling (Jam)
HUMAN_HANDLING_TIMEOUT_HOURS=6

# URL Form Reservasi
RESERVATION_FORM_URL="https://klinik-treatment.com/booking"
```

### 2. Jalankan WAHA Docker (NOWEB Engine)

Chatbot ini merekomendasikan penggunaan **WAHA versi NOWEB (Baileys Engine)** karena sangat hemat memori RAM (~100 MB) dan stabil untuk produksi. Jalankan perintah terminal berikut untuk menyalakannya:

```bash
docker run -d \
  --name waha \
  -p 3001:3000 \
  -e WHATSAPP_API_KEY=my_waha_api_key_secret \
  devlikeapro/waha:noweb
```

### 3. Jalankan Aplikasi dengan Docker Compose

Untuk menyalakan database PostgreSQL dan server bot:

```bash
docker-compose up -d --build
docker-compose exec app npx prisma migrate dev --name init
```

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
- Header keamanan: CSP `script-src 'nonce-…' https://connect.facebook.net; frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.

**Preview URL di admin:** dikontrol `LANDING_BASE_URL` (fallback `TRACKING_API_BASE_URL`); jika kosong, preview memakai path relatif same-origin (`/{slug}`).

### 3. Endpoints Admin Knowledge Base

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

