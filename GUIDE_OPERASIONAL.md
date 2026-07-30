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
   - Peta & Branch Coordinate Picker (UI Demo Only).
   - Tabel Delivery Fee Tiering (UI Demo Only).
   - Editor broadcast campaign & jam operasional (UI Demo Only).

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
