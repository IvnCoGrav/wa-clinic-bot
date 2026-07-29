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
Jalankan WAHA engine via Docker:
```bash
docker run -d \
  --name waha \
  -p 3001:3000 \
  -e WHATSAPP_API_KEY=my_waha_api_key_secret \
  devlikeapro/waha:noweb
```
*Gunakan browser untuk membuka `http://localhost:3001` untuk memindai kode QR WhatsApp.*

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
   👉 **`http://localhost:3000/admin/login.html`**
2. Masukkan password admin yang Anda daftarkan pada `ADMIN_API_KEY` di file `.env`.
3. Isi kolom **Identitas Pemeriksa** (contoh: *Bidan Kenanga* atau *Admin Utama*).
4. Klik **Masuk ke Sistem**. Browser Anda akan otomatis mendapatkan cookie `admin_session` yang aman dan Anda akan diarahkan ke halaman staging utama.

---

## 🧭 Daftar Rute Dashboard Admin yang Dapat Diakses

Setelah berhasil login, Anda dapat mengakses dashboard-dashboard berikut langsung melalui menu navigasi di bagian atas halaman:

### 1. 🏥 3-Table Staging Reviewer
- **URL:** `http://localhost:3000/admin/staging.html`
- **Fungsi:** 
  - **Tab FAQ Medis:** Meninjau keluhan medis yang di-hold oleh bidan. Bidan wajib menulis ulang pertanyaan umum dan jawaban resmi sebelum klik **Approve** untuk melatih bot.
  - **Tab FAQ Umum:** Meninjau dan menyunting draf FAQ non-medis hasil panen AI dari riwayat chat.
  - **Tab Migrasi Customer:** Menyetujui data customer lama hasil ekstraksi teks pemesanan agar disimpan ke database resmi.

### 2. 💬 Live Chat Monitor & Human Override
- **URL:** `http://localhost:3000/admin/live-chats.html`
- **Fungsi:** 
  - Memantau semua percakapan yang saat ini berstatus **`is_human_handling: true`** (diambil alih manusia).
  - Menampilkan badge merah berkedip `🚨 MEDICAL EMERGENCY` untuk kasus darurat medis.
  - Tombol **Release**: Mengembalikan penanganan chat ke bot (menggunakan *Option A* yang memulihkan state percakapan ke kondisi sebelum eskalasi). Khusus untuk eskalasi medis, bidan wajib menyetujui dialog konfirmasi keselamatan sebelum chat di-release.

### 3. 🤖 AI Model Registry Manager
- **URL:** `http://localhost:3000/admin/ai-models.html`
- **Fungsi:** 
  - Melihat dan mengubah model AI yang aktif per task (`HARVESTING`, `CHAT_REPLY`, dll).
  - Dilengkapi *Validation Guard* (hanya menerima provider terdaftar) dan *Lock Guard* (mengunci task `MEDICAL_CHECK` agar selalu berjalan di atas mesin deteksi deterministik demi keselamatan pasien).

### 🩺 4. System Health Monitor
- **URL:** `http://localhost:3000/admin/health.html`
- **Fungsi:** Memantau status koneksi WAHA, status Redis Queue (Fallback In-Memory), status Haversine location engine, dan riwayat alert Telegram.
