# RUNBOOK: Migrasi Domain Penuh ke kalababyspa.com
**Tanggal Pembuatan:** 28 September 2026  
**Status:** Draf Panduan & Checklist Eksekusi  
**Tujuan:** Memindahkan seluruh ekosistem dari `kalababyspa.online` ke `kalababyspa.com` (Homepage WordPress di root domain + CRM/Bot di subdomain `app.kalababyspa.com`) tanpa *downtime* dan tanpa membuang klik iklan Meta Ads.

---

## 1. Peta Arsitektur Target

```
[ Pengunjung / Iklan Meta ]
            │
            ├──> https://kalababyspa.com (Root & WWW)
            │    └── Hosting Eksternal (WordPress: Homepage, Profil Klinik, Edukasi, Landing Page)
            │        └── Memuat: <script src="https://app.kalababyspa.com/assets/external-tracker.js">
            │        └── Tombol CTA mengarah ke: https://app.kalababyspa.com/cta?...
            │
            └──> https://app.kalababyspa.com (Subdomain CRM & Engine)
                 └── VPS Chatbot AG (Caddy Reverse Proxy + Fastify + PostgreSQL + WAHA + Redis)
                     ├── Endpoint /cta (Perekam klik, generate trackingCode, redirect wa.me)
                     ├── Endpoint /api/tracking/* (Beacon PageView CAPI)
                     ├── Admin Dashboard & Staff Portal PWA (/admin, /admin/staff-today)
                     ├── Webhook Telegram (/api/webhook/telegram)
                     └── Webhook WhatsApp WAHA (/webhook) & WABA (/api/webhook/waba)
```

---

## 2. Checklist Eksekusi Berdasarkan Fase

### FASE 1: Persiapan DNS & Hosting WordPress (Di Luar VPS Bot)
*Dapat dikerjakan kapan saja tanpa mengganggu sistem yang sedang berjalan.*

1. **DNS Registrar Domain `kalababyspa.com`:**
   - [ ] Buat **A Record** untuk `@` (root): Arahkan ke IP Server Hosting WordPress.
   - [ ] Buat **CNAME Record** untuk `www`: Arahkan ke `kalababyspa.com`.
   - [ ] Buat **A Record** untuk `app`: Arahkan ke IP Server VPS Bot (`43.157.197.148`).
   - [ ] Atur TTL rendah (misal: 300 detik / 5 menit) untuk memudahkan propagasi.
2. **Hosting WordPress:**
   - [ ] Pastikan WordPress di `https://kalababyspa.com` sudah aktif dan memiliki sertifikat SSL HTTPS yang valid.

---

### FASE 2: Konfigurasi VPS Bot & Server Engine (Strategi Zero-Downtime)
*Kunci: Jangan matikan domain lama secara mendadak. Caddy dikonfigurasi melayani KEDUA domain sekaligus.*

1. **Update `Caddyfile` di VPS:**
   - Ubah blok domain agar melayani `app.kalababyspa.com` berdampingan dengan `app.kalababyspa.online`:
     ```caddy
     app.kalababyspa.com, app.kalababyspa.online {
         encode gzip zstd
         header {
             Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
             X-Frame-Options "SAMEORIGIN"
             X-Content-Type-Options "nosniff"
             Referrer-Policy "strict-origin-when-cross-origin"
             X-XSS-Protection "1; mode=block"
             -Server
         }
         ...
     ```
   - Reload Caddy: `docker compose exec caddy caddy reload`.
   - *Hasil:* Caddy otomatis menerbitkan sertifikat SSL Let's Encrypt untuk `app.kalababyspa.com`. Domain lama tetap 100% aktif!
2. **Update `.env` di VPS (`/app/.env` atau root VPS):**
   - [ ] `ADMIN_DASHBOARD_URL="https://app.kalababyspa.com/admin"`
   - [ ] `PUBLIC_BASE_URL="https://app.kalababyspa.com"`
   - [ ] `GOOGLE_OAUTH_REDIRECT_URI="https://app.kalababyspa.com/api/admin/integrations/google/callback"` (jika Google Contacts aktif)
   - [ ] `ADMIN_DOMAIN="kalababyspa.com"`
3. **Update Server Watchdog di Host VPS:**
   - File `.watchdog.env` (di direktori watchdog cron VPS):
     - Ganti `WATCHDOG_SITE_URL` menjadi:
       ```bash
       WATCHDOG_SITE_URL="https://app.kalababyspa.com"
       ```
   - Verifikasi script watchdog tidak memicu alarm palsu: `bash scripts/server-watchdog.sh`.
4. **Update Konfigurasi Tenant di Database:**
   - Buka **Admin Dashboard → Settings → Tenant Settings**.
   - Ganti **Landing Domain** dari `https://kalababyspa.online` menjadi `https://kalababyspa.com`.
5. **Update Fallback di Kode Repositori (Oleh Developer/AI):**
   - File `src/landing/public/external-tracker.js`: fallback return ke `https://app.kalababyspa.com`.
   - File `src/services/capi.service.ts`: default fallback URL ke `https://kalababyspa.com/reservasionline`.
   - File `packages/admin-dashboard/.../MetaCapiQueue.tsx`: fallback landingUrl disesuaikan.

---

### FASE 3: Sambungkan WordPress (`kalababyspa.com`) ke Bot CRM (`app.kalababyspa.com`)

1. **Pasang Script Pelacak di WordPress:**
   - Pasang script ini di seluruh halaman WordPress (bisa via Theme Footer, plugin WPCode / Insert Headers and Footers, atau `functions.php`):
     ```html
     <script src="https://app.kalababyspa.com/assets/external-tracker.js" defer></script>
     ```
   - Script ini otomatis:
     - Mengirim beacon PageView Meta CAPI (Server-Side) ke bot.
     - Menyalin parameter iklan (`fbclid`, `utm_source`, dll.) dari browser pengunjung ke link tombol CTA.
2. **Atur Tombol CTA di WordPress (Elementor / Gutenberg / Button):**
   - Pastikan setiap tombol "Chat WhatsApp", "Daftar", atau "Booking" mengarah ke endpoint CTA bot:
     ```
     https://app.kalababyspa.com/cta?divisi=iklan-utama
     ```
     *(Gunakan slug atau divisi sesuai kampanye iklan Anda)*.

---

### FASE 4: Integrasi Pihak Ketiga (Meta, Telegram, Google)

1. **Meta Business Suite & Events Manager (Iklan & Pixel):**
   - [ ] **Domain Verification:** Daftarkan `kalababyspa.com` di *Meta Business Settings → Brand Safety → Domains*. Verifikasi via DNS TXT record atau meta-tag di WordPress.
   - [ ] **Aggregated Event Measurement (AEM):** Konfigurasi urutan prioritas event (Purchase, InitiateCheckout, Lead, Contact, PageView) untuk domain `kalababyspa.com`.
   - [ ] **Meta Ads Manager:** Perbarui URL landing page di kampanye iklan aktif yang masih mengarah ke `.online`.
2. **Webhook Telegram Bot:**
   - Jalankan perintah ini di terminal (atau via browser) untuk mengalihkan webhook Telegram ke domain baru:
     ```bash
     curl -F "url=https://app.kalababyspa.com/api/webhook/telegram" \
          -F "secret_token=TELEGRAM_WEBHOOK_SECRET_ANDA" \
          https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN_ANDA>/setWebhook
     ```
   - Verifikasi respon: `{"ok":true,"result":true,"description":"Webhook was set"}`.
3. **Google Cloud Console (Opsional - Jika Menggunakan Google Contacts):**
   - Masuk ke *Google Cloud Console → APIs & Services → Credentials*.
   - Edit OAuth 2.0 Client ID.
   - Tambahkan URL berikut di **Authorized redirect URIs**:
     `https://app.kalababyspa.com/api/admin/integrations/google/callback`

---

### FASE 5: Operasional Internal & Staf Bidan (PWA & Notifikasi)
*Penting: PWA dan izin Web Push terikat pada domain asal. Perlu re-pairing satu kali.*

1. **Sesi Login Admin & CS:**
   - Admin dan CS membuka `https://app.kalababyspa.com/admin` dan login ulang.
2. **PWA & Notifikasi Terapis / Bidan:**
   - Instruksikan seluruh staf/bidan:
     1. Buka browser HP dan akses: `https://app.kalababyspa.com/admin/staff-today`.
     2. Login dengan akun masing-masing.
     3. Klik tombol **"Izinkan Notifikasi" (Web Push)** saat diminta browser agar push notification jadwal tugas baru masuk ke HP.
     4. Hapus shortcut aplikasi lama di layar utama HP.
     5. Tambahkan shortcut baru ke layar utama (*Install PWA / Add to Home Screen*).

---

### FASE 6: Pengujian End-to-End (Uji Kelayakan)

- [ ] **Liveness Check:** `curl -I https://app.kalababyspa.com/health` (harus `200 OK`).
- [ ] **CTA Redirect Check:** Klik tombol CTA di WordPress -> apakah me-redirect ke `https://wa.me/...` dengan teks `Promo[...]` yang membawa tracking code?
- [ ] **CAPI Queue Check:** Buka `https://app.kalababyspa.com/admin/capi-queue` -> pastikan AdClick tercatat dengan `landingUrl` berdomain `kalababyspa.com`.
- [ ] **Telegram Alert Check:** Tes kirim pesan uji dari Telegram bot / liveness watchdog.
- [ ] **Live Chat Sync:** Buka live chat panel di dashboard baru -> pastikan real-time SSE terhubung.

---

### FASE 7: Pembersihan Akhir & Redirect 301 (1–2 Minggu Pasca Migrasi)
*Dilakukan setelah trafik lama di domain `.online` benar-benar sudah reda.*

1. Ubah Caddyfile untuk me-redirect seluruh trafik domain lama ke domain baru:
   ```caddy
   app.kalababyspa.online {
       redir https://app.kalababyspa.com{uri} permanent
   }
   ```
2. Domain lama bisa dipertahankan sebagai redirector selama sisa masa aktif langganan domain.
