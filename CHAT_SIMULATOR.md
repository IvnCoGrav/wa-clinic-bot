# 🏥 Walkthrough & History Project: WAHA Clinic Automation Chatbot Engine (Fase 1)

Dokumen ini berisi rangkuman lengkap mengenai arsitektur sistem, skema database, alur State Machine, simulasi pengetikan manusia (Humanizer), integrasi WAHA, Google Maps, OpenRouteService, & LLM, fitur CLI Chat Simulator, serta **rekap histori seluruh revisi** yang telah dikerjakan dari awal hingga selesai.

---

## 📌 1. Ikhtisar Project & Tech Stack

Project ini adalah **Engine Automation Chatbot WhatsApp (Fase 1)** untuk bisnis klinik kecantikan di Surabaya. Engine ini didesain berbasis **Deterministic State Machine** (bukan pure LLM freeform) untuk menjamin keakuratan alur reservasi, penentuan ongkir, serta penanganan eskalasi ke agen manusia.

### 🛠 Tech Stack Utama
- **Runtime & Language**: Node.js (v20+) + TypeScript
- **Framework Web Server**: Fastify
- **Database & ORM**: PostgreSQL + Prisma ORM (dengan Full-Text Search `'simple'` dictionary)
- **WhatsApp Integration**: WAHA (WhatsApp HTTP API Self-Hosted)
- **Geocoding**: Google Maps Geocoding API (Text & Reverse Geocoding)
- **Distance/Routing**: OpenRouteService Directions API (`driving-car` profile dengan avoid tollways, Google Maps Matrix, Haversine fallback)
- **LLM Engine**: OpenAI / MiniMax API (Custom Base URL: `https://ai.sumopod.com/v1`, Model: `MiniMax-M2.7-highspeed`)
- **Testing Suite**: Vitest (Unit & Integration Tests)
- **Deployment Target**: Docker Containerized (`Dockerfile` + `.env`)

---

## 🔄 2. Histori Perjalanan Revisi (Chronological Revisions History)

Berikut adalah rekap kronologis seluruh revisi dan iterasi pengembangan dari awal hingga final:

### 📍 Inisialisasi Project (Scope Awal Fase 1)
- Pembuatan struktur folder modular (`src/routes`, `src/state-machine`, `src/services`, `src/integrations`, `src/config`).
- Skema basis Prisma (`Customer`, `Conversation`, `Message`, `KnowledgeChunk`).
- State machine dengan alur: `INITIAL` $\rightarrow$ `AWAITING_LOCATION` $\rightarrow$ `AWAITING_INTEREST` $\rightarrow$ `RESERVATION_SENT` / `COMPLETED` / `HUMAN_HANDLING`.

### 📍 Revisi 1: Penyempurnaan Skema & Penanganan Lokasi
1. **Penambahan Field `previous_state`**: Disimpan otomatis saat transisi ke `HUMAN_HANDLING` dan dipulihkan kembali saat auto-release timeout (6 jam).
2. **Field `is_out_of_coverage`**: Ditambahkan pada model `Customer` (default `false`).
3. **Idempotency Webhook**: Field `wa_message_id` dijadikan `unique` pada tabel `messages` untuk mencegah eksekusi ganda pesan retry dari WAHA/Meta.
4. **Counter Attempt Lokasi (3x Cap)**: Pada state `AWAITING_LOCATION`, jika pengguna 3x berturut-turut memberikan teks lokasi impresisi (gagal deteksi kelurahan), sistem otomatis eskalasi ke `HUMAN_HANDLING`.
5. **Boundary Unit Tests Ongkir**: Ditambahkan test case batas $5.0$, $5.01$, $6.0$, $6.01$, $10.0$, dan $10.01\text{ km}$ di `tests/unit/delivery.test.ts`.

### 📍 Revisi 2: Migrasi ke WAHA & Humanizer Typing Engine
1. **Migrasi Integrasi WhatsApp**: Mengubah integrasi dari Meta Cloud API ke WAHA HTTP API (`POST /api/sendText`, `POST /api/sendSeen`, `POST /api/startTyping`, `POST /api/stopTyping`).
2. **Penyempurnaan Parser Webhook**: Menyesuaikan payload WAHA event (`event: "message"`) di `webhook.route.ts`.
3. **Penyusunan Humanizer Typing Service (`src/services/typing.service.ts`)**:
   - Simulation pipeline: `sendSeen` $\rightarrow$ Reading Delay $\rightarrow$ Loop Bubble [`startTyping` $\rightarrow$ Typing Delay $\rightarrow$ `stopTyping` $\rightarrow$ `sendText` $\rightarrow$ Inter-Bubble Delay].

### 📍 Revisi 3: Perbaikan FTS Postgres & Explicit Guard Clause
1. **Perbaikan FTS Dictionary**: Mengganti `to_tsvector('indonesian', ...)` menjadi `to_tsvector('simple', content)` untuk mencegah error SQL dictionary PostgreSQL.
2. **Generated Column & GIN Index**: Menambahkan `content_tsv` dan index GIN pada model `KnowledgeChunk` untuk performa pencarian RAG FAQ.
3. **Explicit Guard Clause `is_human_handling`**: Menegaskan secara eksplisit di kode bahwa saat `conversation.is_human_handling === true`, bot **TIDAK PERNAH** merespons atau memanggil LLM. Pesan inbound hanya dicatat di audit log dan mengembalikan HTTP 200 (`HUMAN_HANDLING_ACTIVE_SILENT`).

### 📍 Revisi 4: Safety Net & Durasi Mengetik Manusiawi
1. **Safety Net `try/finally`**: Memastikan `stopTyping` **SELALU** dipanggil di blok `finally` agar indikator "mengetik..." tidak nyangkut di layar pengguna WhatsApp.
2. **HTTP Timeout Guard**: Menambahkan timeout 10 detik (`HUMANIZER_HTTP_TIMEOUT_MS=10000`) di axios client WAHA.
3. **Alur Multi-Bubble Error**: Jika error terjadi pada bubble ke-2, pengiriman bubble ke-3 dibatalkan tanpa mengirim ulang bubble ke-1.

### 📍 Revisi 5: Kalibrasi WPM & Eliminasi Redundant Call
1. **WPM Realistis (WPM = 48)**: Menyesuaikan `HUMANIZER_TYPING_AVERAGE_WPM` dari 180 ke 48 (realistis HP manusia: 25–55 WPM).
2. **Bubble Size (`maxChars = 130`, `maxCount = 4`)**: Mengurangi target karakter bubble dari 200 ke 130 karakter dan menaikkan batas bubble ke 4 agar balasan dipecah secara natural tanpa kehilangan informasi.
3. **Cap Max Typing Delay (`6500ms`)**: Menyesuaikan cap delay maksimal ke 6.5 detik.
4. **Eliminasi Redundant `stopTyping`**: Menambahkan flag `typingStopped` sehingga `finally` hanya memanggil `stopTyping` jika status mengetik belum di-stop secara normal.

### 📍 Revisi 6: Integrasi Production Credentials
- Mengonfigurasi kredensial produksi di `.env` dan `.env.example`:
  - `WAHA_BASE_URL="http://localhost:3001"`
  - `WAHA_API_KEY="your_waha_api_key_secret"`
  - `OPENAI_BASE_URL="https://ai.sumopod.com/v1"`
  - `OPENAI_MODEL="MiniMax-M2.7-highspeed"`
  - `LLM_API_KEY="your_llm_api_key_here"`

### 📍 Revisi 7: CLI Chat Simulator Mode Standalone
- Pembuatan **CLI Chat Simulator** (`npm run chat` / `src/cli/chat-simulator.ts`) untuk testing interaktif di terminal dengan animasi indikator mengetik real-time (`[bot sedang mengetik...]`) dan format warna ANSI.
- Mengimplementasikan **Dependency Injection (DI)** pada `TypingService` dan `ConversationStateMachine` tanpa mengubah `src/routes/webhook.route.ts` atau breaking production logic.
- Mendukung command interaktif: `/location <lat>,<lng>`, `/reset`, `/state`, `/speed <faktor>`, dan `exit`/`quit`.

### 📍 Revisi 8: Migrasi Distance Calculation ke OpenRouteService (ORS)
1. **Pembuatan Modul ORS Client (`src/integrations/ors/client.ts`)**:
   - Memanggil OpenRouteService Directions API via `POST https://api.heigit.org/openrouteservice/v2/directions/cycling-electric`.
   - Mengirim payload koordinat dalam format spesifikasi ORS: `[[lng_klinik, lat_klinik], [lng_customer, lat_customer]]`.
   - Menerima hasil jarak dalam meter (`features[0].properties.summary.distance`) dan durasi dalam detik.
   - Dilengkapi interface `IOrsClient` & `ORS_HTTP_TIMEOUT_MS=10000` (default 10 detik).
2. **Pembaruan Delivery Service (`src/services/delivery.service.ts`)**:
   - Sumber perhitungan jarak beralih ke ORS API sebagai sumber utama.
   - **Fallback ke Haversine**: Jika ORS API gagal/timeout/unreachable (misal rute tidak terhubung), sistem otomatis fallback ke perhitungan rumus Haversine manual dan mencatat warning log.
   - Evaluasi threshold ongkir ($0.0-5.0\text{ km}$, $>5.0-6.0\text{ km}$, $>6.0-10.0\text{ km}$, $>10.0\text{ km}$) tetap konsisten 100%.
3. **Pembaruan Unit Test Suite (`tests/unit/delivery.test.ts`)**:
   - Menambahkan test case pengujian ORS sukses (jarak 4.5 km, 5.5 km, 8.0 km, 12.0 km).
   - Menambahkan test case pengujian ORS gagal/timeout $\rightarrow$ fallback Haversine.
   - Mempertahankan seluruh boundary threshold test ($5.0, 5.01, 6.0, 6.01, 10.0, 10.01\text{ km}$) via path ORS-mocked.

---

## 🗺 3. Alur State Machine (Conversation Orchestrator)

```mermaid
stateDiagram-v2
    [*] --> INITIAL
    INITIAL --> AWAITING_LOCATION: Inbound First Message (Bot Greets & Asks Location)
    
    state AWAITING_LOCATION {
        [*] --> CheckLocation
        CheckLocation --> ValidLocation: Location Shared (Native / Text Kelurahan)
        CheckLocation --> InvalidLocationText: Text Impresisi (Attempt < 3)
        CheckLocation --> Escalated: Text Impresisi (Attempt >= 3)
    }

    InvalidLocationText --> AWAITING_LOCATION: Tanya Ulang Kelurahan (Attempts + 1)
    Escalated --> HUMAN_HANDLING: Auto Escalation to Admin

    ValidLocation --> CheckCoverage
    CheckCoverage --> AWAITING_INTEREST: Distance <= 10km (In Coverage)
    CheckCoverage --> COMPLETED: Distance > 10km (Out of Coverage)

    state AWAITING_INTEREST {
        [*] --> CheckIntent
        CheckIntent --> RESERVATION_SENT: Intent = Interested (Kirims Link Booking)
        CheckIntent --> COMPLETED: Intent = Not Interested
        CheckIntent --> HUMAN_HANDLING: Intent = Asking Schedule / Human Required
        CheckIntent --> AWAITING_INTEREST: Intent = FAQ Question (Bot Answers RAG without State Change)
    }

    HUMAN_HANDLING --> AWAITING_INTEREST: Auto-Release Timeout (6 Hours Elapsed)
    RESERVATION_SENT --> [*]
    COMPLETED --> [*]
```

---

## 📐 4. Skema Ongkir & Coverage Klinik (Surabaya)

Titik koordinat klinik: **Lat: `-7.2574719`**, **Lng: `112.7520883`** (*Klinik Kecantikan Utama Surabaya*).

| Jarak (km) | Tarif Ongkir | Status Coverage | Action Bot |
| :--- | :--- | :--- | :--- |
| **$0.0 - 5.0\text{ km}$** | **Rp 0 (FREE)** | `is_out_of_coverage = false` | Tampilkan ongkir gratis & tanyakan minat reservasi |
| **$>5.0 - 6.0\text{ km}$** | **Rp 5.000** | `is_out_of_coverage = false` | Tampilkan ongkir Rp 5.000 & tanyakan minat reservasi |
| **$>6.0 - 10.0\text{ km}$** | **Rp 10.000** | `is_out_of_coverage = false` | Tampilkan ongkir Rp 10.000 & tanyakan minat reservasi |
| **$>10.0\text{ km}$** | **Luar Jangkauan** | `is_out_of_coverage = true` | Tampilkan pesan maaf area luar coverage & set state `COMPLETED` |

---

## 💻 5. CLI Chat Simulator Mode (`npm run chat`)

Mode CLI ini memungkinkan developer melakukan testing alur percakapan & merasakan timing delay secara interaktif langsung di terminal.

### Cara Menjalankan
```bash
npm run chat
```

### Daftar Command Interaktif
- **Teks Biasa**: Diketik langsung (misal: `Halo admin`, `Surabaya`, `Berapa harga facial glowing?`).
- **`/location <lat>,<lng>`**: Simulasikan share koordinat lokasi WhatsApp (contoh: `/location -7.2625,112.7383`).
- **`/state`**: Cek state internal (`current_state`, `previous_state`, `attempts`, `coverage`, dll).
- **`/speed <faktor>`**: Ubah kecepatan simulasi delay (contoh: `/speed 2` untuk $2\times$ lebih cepat).
- **`/reset`**: Reset percakapan simulator kembali ke state `INITIAL`.
- **`exit` / `quit`**: Keluar dari CLI simulator.

---

## 🧪 6. Verification & Test Suite Summary

Seluruh 31 unit test & integration test pada project ini berada pada status **PASS 100%**:

```text
 ✓ tests/unit/delivery.test.ts (13 tests)
 ✓ tests/unit/knowledge.test.ts (2 tests)
 ✓ tests/unit/typing.test.ts (9 tests)
 ✓ tests/unit/state-machine.test.ts (5 tests)
 ✓ tests/integration/waha-webhook.test.ts (2 tests)

 Test Files  5 passed (5)
      Tests  31 passed (31)
```

---

## 📂 7. Struktur Folder Utama Project

```text
wa-clinic-bot/
├── CHAT_SIMULATOR.md               # Dokumentasi panduan CLI Simulator
├── Dockerfile                      # Docker container deployment spec
├── .env / .env.example             # Environment Variables & Production Credentials
├── package.json                    # Project dependencies & scripts ("chat", "dev", "test")
├── prisma/
│   └── schema.prisma               # Database Schema (Customer, Conversation, Message, KnowledgeChunk)
├── src/
│   ├── app.ts                      # Fastify Server Setup
│   ├── config/                     # Clinic, Persona, & System Config
│   ├── cli/
│   │   ├── chat-simulator.ts       # Standalone CLI Simulator Entry Point
│   │   └── mock-waha-client.ts     # Mock WAHA Client dengan ANSI color & line clearing
│   ├── integrations/
│   │   ├── google-maps/            # Geocoding Service (Text & Reverse Geocoding)
│   │   ├── ors/                    # OpenRouteService Directions API (IOrsClient Interface)
│   │   ├── llm/                    # Intent Classifier & RAG Response Generator (MiniMax/OpenAI)
│   │   └── waha/                   # WAHA API Client (IWahaClient Interface)
│   ├── routes/
│   │   └── webhook.route.ts        # WAHA Webhook Production Handler (With Guard Clause)
│   ├── services/
│   │   ├── conversation.service.ts # State & Auto-Release Timeout Management
│   │   ├── customer.service.ts     # Customer & Location Data Management
│   │   ├── delivery.service.ts     # Distance & Ongkir Calculator (ORS + Haversine Fallback)
│   │   ├── knowledge.service.ts    # Postgres FTS Knowledge Base
│   │   ├── message.service.ts      # Audit Log & Idempotency Service
│   │   └── typing.service.ts       # Humanizer Typing Simulation Service
│   └── state-machine/
│       ├── machine.ts              # Conversation Orchestrator Engine
│       ├── types.ts                # State Machine Interfaces
│       └── handlers/               # State Handlers (greeting, location, interest, human)
└── tests/
    ├── integration/                # Integration Test Suite (WAHA Webhook & Guard Clause)
    └── unit/                       # Unit Test Suite (Delivery ORS/Haversine, Knowledge, Typing, State Machine)
```
