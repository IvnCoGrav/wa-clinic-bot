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

Dashboard admin modern kini menggunakan React SPA dengan tampilan premium (dark glassmorphic):

1. **Overview & Analytics (`/admin/overview`):**
   - Menampilkan total chat masuk, jumlah reservasi, taksiran omset, rasio konversi (conversion rate), status engine WAHA, status Redis queue (fallback in-memory), dan grafik visual lalu lintas chat.
2. **Reservations & Calendar (`/admin/reservations`):**
   - Menampilkan tabel reservasi interaktif (filter: Pending, Confirmed, Completed, Cancelled).
   - Dilengkapi Calendar View untuk melihat jadwal reservasi.
   - Detail modal pasien memuat alamat kelurahan/kecamatan, biaya ongkir, jarak km, dan tombol manual sync Google Calendar (terdapat indikator mock mode).
3. **Knowledge Base Manager (`/admin/knowledge-base`):**
   - Form bulk import FAQ Q&A.
   - Uploader dokumen SOP untuk di-chunk otomatis oleh backend.
   - Log pertanyaan tertunda (mock UI demo).
4. **AI Sandbox Simulator (`/admin/sandbox`):**
   - Simulator chat RAG secara real-time.
   - Inspector data (chunks vector database yang dipanggil, skor similarity, system prompt, dan latency).
   - Toggle simulasi outage **SumoPod (LLM API OUTAGE)** untuk memverifikasi handling fallback.
5. **Operational Settings (`/admin/settings`):**
   - Global chatbot active toggle (ON/OFF).
   - **WhatsApp Provider** — pilih provider WAHA/WABA, status session WAHA live-check, dan simpan kredensial WABA (Phone Number ID, Business Account ID, Access Token, Webhook Verify Token — token di-enkripsi AES-256-GCM di DB).
   - **Meta Pixel & CAPI** — atur Pixel ID + CAPI Access Token per tenant (berlaku untuk semua provider).
   - **AI Router Engine** — toggle aktif/shadow mode per tenant (default ON + shadow ON).
   - Peta & Branch Coordinate Picker, tabel Delivery Fee Tiering, editor broadcast (UI Demo Only).
6. **Landing Page (`/admin/landing`):**
   - Kelola banyak landing page per tenant (multi-landing).
   - Buat via template sistem (`STRUCTURED_JSON`) atau upload file HTML (`RAW_HTML`, maks 500 KB, wajib elemen `<a id="wa-cta">`).
   - Atur events tracking, override Pixel & No. WhatsApp, toggle aktif/nonaktif.
   - Ikon **mata** untuk langsung membuka (view) landing page yang dipublikasikan.
   - URL publik: `/{slug}` atau `/promo/{slug}`; `/go` untuk pintu kampanye.

---

## 🧭 Daftar Rute Legacy HTML Admin (Dukungan Kompatibilitas)

Sistem tetap melayani rute HTML lama untuk kompatibilitas pengujian:
- **🏥 3-Table Staging Reviewer:** `http://localhost:3000/admin/staging.html`
- **💬 Live Chat Monitor:** `http://localhost:3000/admin/live-chats.html`
- **🤖 AI Model Registry Manager:** `http://localhost:3000/admin/ai-models.html`
- **🩺 System Health Monitor:** `http://localhost:3000/admin/health.html`

---

## ⚙️ Variabel Konfigurasi Baru (.env)

- **`ENABLE_WAHA_HOLD_LABEL`** (Boolean, default `false` di production): Set `true` jika ingin mengaktifkan sinkronisasi label "hold" WAHA ke HP admin WhatsApp secara otomatis saat terjadi eskalasi human handling. Secara default dinonaktifkan di production untuk menjaga kestabilan operasional sampai tervalidasi live.

### AI Router Engine (.env & Admin Dashboard)

AI Router **default ON per tenant** — sumber kebenaran adalah kolom `tenants.ai_router_enabled`
& `tenants.ai_router_shadow_mode` (default `true`/`true`), diatur dari **Admin Dashboard →
Settings → AI Router Engine**. Env vars di bawah HANYA fallback saat DB tidak tersedia
(offline/testing) dan override ops darurat.

- **`AI_ROUTER_ENABLED`** (Boolean, fallback env; default DB `true`): Mengaktifkan AI Router Engine (LLM intent classifier). Aktif otomatis per tenant kecuali dimatikan dari dashboard.
- **`AI_ROUTER_SHADOW_MODE`** (Boolean, fallback env; default DB `true`): Mode observasi — hasil LLM router hanya dibandingkan dgn keputusan pipeline legacy dan di-log ke tabel `ai_router_evaluations`, TIDAK mengubah keputusan produksi. Eskalasi UNKNOWN-berulang (2x -> HUMAN_HANDLING) HANYA aktif di full mode (`shadowMode=false`). **Jangan matikan shadow mode sebelum 3 gate di `README.md` lolos** (escalation >= 98%, mismatch MEDICAL = 0, UNMAPPED < 5%).
- **`AI_MODEL_ROUTER`** (String, opsional): Model LLM khusus untuk router. Kosongkan agar fallback ke `AI_MODEL_NLU` / `OPENAI_MODEL`.
- **`ESCALATE_SCHEDULE_IN_INITIAL`** (Boolean, default `true`): Eskalasi pertanyaan jadwal spesifik (slot/buka/hari/jam) ke human handling saat conversation masih di state INITIAL.
- **Cek akurasi:** `npx tsx src/scripts/check-router-accuracy.ts --days=7` — jadwal cek hari ke-1/3/7 ada di README.
