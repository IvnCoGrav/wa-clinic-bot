# Panduan Akses & Uji Coba Control Center (Dashboard Admin)

Panduan ini menjelaskan langkah demi langkah untuk menjalankan aplikasi **WAHA WhatsApp Clinic Bot** secara lokal serta bagaimana cara mengakses dan menggunakan antarmuka **Control Center (Dashboard Admin)**.

---

## 🛠️ Langkah Awal: Menjalankan Sistem Secara Lokal

### 1. Inisialisasi Environment & Database
1. Pastikan Anda telah menyalin file `.env.example` ke `.env` dan mengisi variabel yang dibutuhkan (khususnya `ADMIN_API_KEY`, `DATABASE_URL`, `WAHA_BASE_URL`).
2. Sinkronkan skema database Prisma:
   ```bash
   npx prisma db push
   ```

### 2. Jalankan WAHA (WhatsApp Gateway)
Jalankan WAHA engine menggunakan Docker Compose yang telah dipasang pin versi spesifik serta dilengkapi **volume penyimpanan sesi permanen** (`waha_sessions` dipetakan ke `/app/.sessions`) untuk menghindari regresi noise handshake serta mencegah log-out akun WhatsApp secara tidak sengaja saat kontainer Docker mati/di-restart.

```bash
# Jalankan container WAHA via Docker Compose (kini dengan volume sesi permanen)
docker compose up -d waha
```

> [!IMPORTANT]
> **Catatan Sesi Permanen & Pinning Versi (Keamanan Operasional):**
> - **Sesi Permanen:** Data login QR Anda disimpan secara permanen di volume Docker `waha_sessions`. Anda tidak perlu mengulang scan QR ataupun khawatir mengalami logout mendadak di HP saat kontainer di-restart/di-build ulang.
> - **Catatan Pinning Versi:** Project ini mem-pin image WAHA ke versi spesifik **`devlikeapro/waha:noweb-2026.7.2`** di dalam `docker-compose.yml`.
> - **JANGAN** pernah mengubah tag ke `:latest` di server produksi karena NOWEB sering kali mengalami pemblokiran handshake dari WhatsApp.
> - Versi `2026.7.2` memperkenalkan perbaikan penting dan variabel `WAHA_NOWEB_WA_VERSION_FORCE` untuk memaksa bypass enkripsi handshake yang usang.
> - **Prosedur Upgrade Masa Depan:** Sebelum melakukan upgrade versi WAHA di masa depan, pastikan untuk membaca [Changelog Resmi WAHA](https://waha.devlike.pro/docs/overview/changelog/) dan mengujinya di lingkungan staging terlebih dahulu.


#### 📲 Langkah Menautkan WhatsApp via Dashboard WAHA:
1. Buka browser dan akses: 👉 **`http://localhost:3001/dashboard/`**
2. **Login Pop-Up (Basic Auth):**
   - **Username:** `admin`
   - **Password:** `admin12345`
3. **Form Isian Session WAHA:**
   - **Name:** `default`
   - **WAHA API Key:** `my_waha_api_key_secret` (Sesuai dengan parameter `WAHA_API_KEY` saat menjalankan docker).
   - **Metadata:** Kosongkan saja (tidak perlu diisi).
    - **Webhook:**
     - **URL:** `http://host.docker.internal:3000/webhook` (Penting: gunakan `host.docker.internal` agar kontainer Docker WAHA dapat menghubungi server Fastify yang berjalan di Windows host Anda).
     - **Events:** Centang/Pilih `message` atau `message.any`.
     - **Secret:** Masukkan nilai `WAHA_WEBHOOK_SECRET` dari file `.env` Anda jika dikonfigurasi (kosongkan jika tidak ada).
   - Klik **Start** / **Save**.
4. **Scan QR Code:**
   - Klik tombol **Scan QR** di layar.
   - Buka aplikasi **WhatsApp** di HP Anda ➔ **Pengaturan / Titik Tiga** ➔ **Perangkat Tertaut (*Linked Devices*)** ➔ **Tautkan Perangkat (*Link a Device*)**.
   - Arahkan kamera HP ke QR Code hingga status berubah menjadi **`WORKING`**.



### 3. Mulai Server Bot
Jalankan server Node.js Fastify dalam mode development:
```bash
npm run dev
```
Server akan berjalan di port `3000` (atau port sesuai `.env` Anda).

---

## 🔐 Cara Masuk ke Control Center

Semua antarmuka dashboard admin kini dilayani langsung oleh server Fastify di origin lokal. 

1. Buka browser Anda dan akses halaman login:
   👉 **`http://localhost:3000/admin/login`** (atau legacy: **`http://localhost:3000/admin/login.html`**)
2. Masukkan kredensial berikut:
   - **Email / Username:** `admin@kalamomsspa.com` (Bisa diisi email/username apa saja bebas, karena di fase single-tenant ini backend hanya mencocokkan password).
   - **Password:** Masukkan nilai `ADMIN_API_KEY` dari file `.env` Anda (secara default di file `.env` lokal Anda adalah: **`admin_prod_key_123`**).
3. Klik **Sign In** (atau isi form di legacy page). Browser Anda akan otomatis mendapatkan cookie `admin_session` yang aman dan Anda akan diarahkan ke dashboard utama.

---

## 🖥️ Menu Dashboard React SPA Modern (/admin/*)

Dashboard admin modern kini menggunakan React SPA dengan tampilan premium (dark glassmorphic).
Semua rute di bawah `/admin/*`; `/admin` & `/admin/*` yang tak dikenal redirect ke `/admin/overview`.

1. **Overview & Analytics (`/admin/overview`):**
   - Menampilkan total chat masuk, jumlah reservasi, taksiran omset, rasio konversi (conversion rate), status engine WAHA, status Redis queue (fallback in-memory), dan grafik visual lalu lintas chat.
2. **Customer Database (`/admin/customers`):**
   - Registry pasien per tenant — data kontak, lokasi, riwayat percakapan & status follow-up.
3. **Reservations & Calendar (`/admin/reservations`):**
   - Menampilkan tabel reservasi interaktif (filter: Pending, Confirmed, Completed, Cancelled).
   - Dilengkapi Calendar View untuk melihat jadwal reservasi.
   - Detail modal pasien memuat alamat kelurahan/kecamatan, biaya ongkir, jarak km, dan tombol manual sync Google Calendar (terdapat indikator mock mode).
   - **Buat Reservasi Manual**: form input terstruktur (pilih customer, kategori treatment BABY/MOMS/BOTH, detail treatment, tanggal booking, nama bayi + usia). Jalankan side-effect otomatis (follow-up scheduling, upsert children, label lifecycle).
4. **Clinic Services (`/admin/services`):**
   - Kelola katalog treatment per tenant (nama, harga, durasi, deskripsi) yang dipakai chatbot saat menjawab pertanyaan harga/FAQ.
5. **Delivery Fee (`/admin/delivery`):**
   - Tabel Delivery Fee Tiering per tenant — tarif ongkir berdasarkan jarak (dipakai saat perhitungan ongkir home-treatment).
6. **Follow-Up Queue (`/admin/follow-ups`):**
   - Antrian follow-up customer per tahap (staging), throttle & batch worker, status LOST/COMPLETED.
7. **Follow-Up Templates (`/admin/follow-up-templates`):**
   - Kelola template pesan follow-up per tahap (rolling template WAHA / HSM template WABA).
8. **Knowledge Base Manager (`/admin/knowledge-base`):**
   - Form bulk import FAQ Q&A (dengan pencarian FTS Postgres).
   - Uploader dokumen SOP untuk di-chunk otomatis oleh backend.
   - Log pertanyaan tertunda (mock UI demo).
9. **AI Sandbox Simulator (`/admin/sandbox`):**
   - Simulator chat RAG secara real-time.
   - Inspector data (chunks vector database yang dipanggil, skor similarity, system prompt, dan latency).
   - Toggle simulasi outage **SumoPod (LLM API OUTAGE)** untuk memverifikasi handling fallback.
10. **Live Chat Monitor (`/admin/live-chat`):**
    - Monitor percakapan realtime via SSE (heartbeat 15 dtk).
    - Balas manual sebagai admin (disimpan `sender_type=ADMIN`); auto-release ke bot saat admin selesai.
    - Pembatasan: balasan WABA di luar 24h window ditolak (409 `WABA_OUTSIDE_WINDOW`).
11. **AI Persona (`/admin/persona`):**
    - Konfigurasi persona bot per tenant (nama, brand voice, identitas Bunda/Bidan, dst) — di-load dari DB.
12. **Landing Page (`/admin/landing`):**
    - Kelola banyak landing page per tenant (multi-landing).
    - Buat via template sistem (`STRUCTURED_JSON`) atau upload file HTML (`RAW_HTML`, maks 500 KB, wajib elemen `<a id="wa-cta">`).
    - Atur events tracking, override Pixel & No. WhatsApp, toggle aktif/nonaktif.
    - Ikon **mata** untuk langsung membuka (view) landing page yang dipublikasikan.
    - URL publik: `/{slug}` atau `/promo/{slug}`; `/go` untuk pintu kampanye.
13. **Operational Settings (`/admin/settings`):**
    - Global chatbot active toggle (ON/OFF).
    - **WhatsApp Provider** — pilih provider WAHA/WABA, status session WAHA live-check, ambil QR (`GET /api/admin/whatsapp-provider/qr` saat status `SCAN_QR_CODE`), aksi session (start/reset/disconnect), dan simpan kredensial WABA (Phone Number ID, Business Account ID, Access Token, Webhook Verify Token — token di-enkripsi AES-256-GCM di DB).
    - **Meta Pixel & CAPI** — atur Pixel ID + CAPI Access Token per tenant (berlaku untuk semua provider). Funnel konversi otomatis: `Contact` (kontak pertama), `Lead` (MQL), `InitiateCheckout` (form reservasi dikirim), `Purchase` (customer kirim pesan "Payment <nominal>" ATAU admin klik "Tandai Lunas" — dibatasi 7 hari). Lihat **`docs/META_FUNNEL.md`** untuk alur lengkap & dedup.
    - **AI Router Engine** — toggle aktif/shadow mode per tenant (default ON + shadow ON).
    - Peta & Branch Coordinate Picker, editor broadcast (UI Demo Only).
14. **System Debug (`/admin/debug`):**
    - Halaman debug sistem + console log buffer in-memory (500 entri) — untuk inspeksi runtime tanpa akses server.

---

## 🧭 Daftar Rute Legacy HTML Admin (Dukungan Kompatibilitas)

Sistem tetap melayani rute HTML lama untuk kompatibilitas pengujian. Semua file masih disajikan dari `packages/admin-dashboard/public/` (auth-eksepsi). Sebagian sudah *superseded* oleh halaman SPA baru — tetap bisa diakses, tapi tidak lagi ada di menu navigasi:

- **🔐 Legacy Login:** `http://localhost:3000/admin/login.html`
- **🏥 3-Table Staging Reviewer:** `http://localhost:3000/admin/staging.html`
- **💬 Live Chat Monitor (legacy):** `http://localhost:3000/admin/live-chats.html` *(superseded oleh SPA `/admin/live-chat`)*
- **🩺 System Health Monitor:** `http://localhost:3000/admin/health.html`
- **🤖 AI Model Registry Manager:** `http://localhost:3000/admin/ai-models.html` *(konfigurasi model per task — CHAT, NLU, MEDICAL, HARVESTING, PII, SUMMARIZATION; sebelum ada page SPA khusus)*

> Rute SPA utama di-serve dari `packages/admin-dashboard/dist/index.html`; pastikan **`npm run build`** di `packages/admin-dashboard` dijalankan agar menu SPA ter-refresh.

---

## ⚙️ Variabel Konfigurasi Baru (.env)

- **`ENABLE_WAHA_HOLD_LABEL`** (Boolean, default `false` di production): Set `true` jika ingin mengaktifkan sinkronisasi label "hold" WAHA ke HP admin WhatsApp secara otomatis saat terjadi eskalasi human handling. Secara default dinonaktifkan di production untuk menjaga kestabilan operasional sampai tervalidasi live.

### NLU Layer (Klasifikasi Intent Structured)

NLU berjalan di GATE 2 state machine pada setiap pesan inbound non-human-handling. Output `{ intents, entities, confidence }` dipakai handler untuk memetakan intent (greeting, provide_location, ask_price, ask_schedule, express_interest, faq_question, affirmation, negation, complaint, off_topic). Ada fallback deterministik (regex/keyword, `isFallback=true`, conf 0.75) saat LLM gagal/offline.

- **`AI_PROVIDER_NLU`** / **`AI_MODEL_NLU`** (default `MiniMax` / `MiniMax-M2.7-highspeed`): provider & model task INTENT_CLASSIFICATION (per-tenant via DB `tenant_ai_config`, read default env).
- **`NLU_CONFIDENCE_THRESHOLD`** (default `0.60`): intent hasil LLM dipakai hanya jika `confidence >= threshold && !isFallback`; di bawah itu turun ke fallback deterministik.

### Burst Coalescing (Pesan Text Beruntun → 1 Balasan)

- **`BURST_COALESCE_MS`** (default `0` = nonaktif; contoh `5000` = gabung pesan text dalam window 5 detik): bot di-debounce, gabung pesan text beruntun di state open-ended jadi **satu job satu balasan** yang membaca seluruh konteks. Pesan lokasi/media & state menunggu input spesifik (`AWAITING_LOCATION`, `LOCATION_CONFIRMED`, `RESERVATION_SENT`, `HUMAN_HANDLING`) TIDAK pernah di-merge.
- **`BURST_COALESCE_MAX_MESSAGES`** (default `10`): batas pesan per batch; saat penuh, batch lama di-flush & batch baru dimulai.

### Live Chat Media (Gambar Outbound & Inbound)

Admin bisa **kirim gambar** dari Live Chat Monitor dan melihat **gambar yang dikirim customer** (thumbnail, blur + tombol download). File disimpan di `storage/media/{outbound,inbound}/<tenantId>/` (gitignored). Outbound dipakai langsung oleh WAHA (path lokal) atau Meta/WABA (URL publik), inbound hanya bisa diakses dashboard (cookie `admin_session`).

- **`PUBLIC_BASE_URL`** (String, WAJIB untuk tenant WABA): Base URL publik bot. Tanpa ini, kirim gambar via provider Meta/WABA gagal dengan error `MEDIA_PUBLIC_URL_REQUIRED` (WAHA tidak butuh).
- **`MEDIA_RETENTION_DAYS`** (Number, default `30`): fallback global lama penyimpanan media. Nilai per-tenant diambil dari kolom `tenants.media_retention_days`.
- **`ENABLE_MEDIA_CLEANUP_CRON`** (Boolean, default `false`): aktifkan cron periodik yang menghapus file media kadaluarsa.
- **`MEDIA_CLEANUP_INTERVAL_HOURS`** (Number, default `24`): interval cron cleanup media (jam).

### Humanizer / Human Typing Simulation

- **`HUMANIZER_ENABLED`** (default `true`: dimatikan bila diset `false`): simulasi jeda baca + indikator mengetik agar balasan terasa seperti manusia.
- Tuning: `HUMANIZER_READING_*` (reaksi awal membaca), `HUMANIZER_TYPING_*` (kecepatan mengetik, WPM max ≤55), `HUMANIZER_BUBBLE_*` (pemotongan balasan panjang jadi multiple bubble, maks 2 bubble), `HUMANIZER_INTER_BUBBLE_DELAY_MIN_MS`/`MAX_MS`, `HUMANIZER_HTTP_TIMEOUT_MS`. Detail nilai default: lihat `.env.example`.

### AI Router Engine (.env & Admin Dashboard)

AI Router **default ON per tenant** — sumber kebenaran adalah kolom `tenants.ai_router_enabled`
& `tenants.ai_router_shadow_mode` (default `true`/`true`), diatur dari **Admin Dashboard →
Settings → AI Router Engine**. Env vars di bawah HANYA fallback saat DB tidak tersedia
(offline/testing) dan override ops darurat.

- **`AI_ROUTER_ENABLED`** (Boolean, fallback env; default DB `true`): Mengaktifkan AI Router Engine (LLM intent classifier). Aktif otomatis per tenant kecuali dimatikan dari dashboard.
- **`AI_ROUTER_SHADOW_MODE`** (Boolean, fallback env; default DB `true`): Mode observasi — hasil LLM router hanya dibandingkan dgn keputusan pipeline legacy dan di-log ke tabel `ai_router_evaluations`, TIDAK mengubah keputusan produksi. Eskalasi UNKNOWN-berulang (2x -> HUMAN_HANDLING) HANYA aktif di full mode (`shadowMode=false`). **Jangan matikan shadow mode sebelum 3 gate di `README.md` lolos** (escalation >= 98%, mismatch MEDICAL = 0, UNMAPPED < 5%).
- **`AI_MODEL_ROUTER`** (String, opsional): Model LLM khusus untuk router. Kosongkan agar fallback ke `AI_MODEL_NLU` / `OPENAI_MODEL`.
- **`ESCALATE_SCHEDULE_IN_INITIAL`** (Boolean, default `true`): Eskalasi pertanyaan jadwal spesifik (slot/buka/hari/jam) ke human handling saat conversation masih di state INITIAL.

### Legacy Scrape & Label Reconciliation

- **`ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER`** (Boolean, default `false`): Aktifkan scraping per-contact saat chat di-label `legacy` oleh admin. Scraping membaca histori pesan sampai form reservasi pertama → simpan ke LegacyStaging.
- **`LABEL_RECONCILIATION_INTERVAL_MS`** (Number, default `3600000` = 60 menit): Interval cron re-sync label WA vs status DB (Label Reconciliation Service).

### Phrasing Service (Natural Language Response)

- **`OPENAI_BASE_URL`** / **`OPENAI_MODEL`** (default `https://api.openai.com/v1` / `MiniMax-M2.7-highspeed`): Base URL & model untuk Phrasing Service (generate balasan natural via LLM). Fallback ke template statis saat LLM down/API key kosong.
- **`LLM_API_KEY`** (String, wajib untuk Phrasing Service): API key untuk LLM endpoint.
- **Cek akurasi:** `npx tsx src/scripts/check-router-accuracy.ts --days=7` — jadwal cek hari ke-1/3/7 ada di README.
