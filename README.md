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
│   │       ├── intent.ts          # 5-Intent Classifier (termasuk intent 'faq_question')
│   │       └── generator.ts       # Persona-based RAG FAQ Response Generator
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
│   │   └── message.service.ts     # Audit log & Idempotency Check (wa_message_id)
│   ├── routes/
│   │   ├── webhook.route.ts       # POST webhook WAHA (event: "message") + Guard Clause
│   │   └── admin.route.ts         # REST Endpoints: Human Handling, Import FAQ, Import Document
│   └── app.ts                     # Fastify server entry point
├── tests/
│   ├── unit/
│   │   ├── delivery.test.ts       # Test ongkir & boundary exact values (5.0, 5.01, 6.0, 6.01, 10.0, 10.01)
│   │   ├── typing.test.ts         # Test formula delay (800ms base + 40ms/char, cap 4s)
│   │   ├── knowledge.test.ts      # Test text chunker & FTS search
│   │   └── state-machine.test.ts  # Test transisi state & auto-release
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
