# PANDUAN & PROMPT EKSPOR GOOGLE STITCH — CLINIC BOT ADMIN DASHBOARD

Dokumen ini disiapkan agar Anda dapat mengimpor seluruh 20 halaman dashboard klinik ke dalam **Google Stitch** (stitch.withgoogle.com) secara instan, teratur, dan tanpa perlu screenshot.

---

## 1. URL Live Tunnel (Impor Otomatis)

Dashboard saat ini telah aktif di latar belakang komputer Anda:
- **URL Publik untuk Stitch**: `https://tiny-oranges-fly.loca.lt/admin/stitch-preview`
- **Password / Endpoint IP (jika diminta LocalTunnel)**: `110.139.83.12`
- **URL Akses Lokal Anda**: `http://localhost:5173/admin/stitch-preview`

Di Google Stitch, cukup pilih **"Import Website"** atau tempelkan URL publik di atas ke prompt bar canvas.

---

## 2. Design System (`DESIGN.md`) untuk Stitch

Salin aturan di bawah ini ke konfigurasi **Design System / Rules** di workspace Google Stitch Anda:

```markdown
# Clinic Dashboard Design Rules
- Primary Brand Color: #008069 (WhatsApp Emerald Green)
- Brand Hover: #00a884
- Canvas Background: #f0f2f5 (WhatsApp Web Canvas)
- Surface Cards: #ffffff with border #e9edef and shadow-xs
- Outgoing Chat Bubble: #d9fdd3 with border #c4f3bd
- Incoming Chat Bubble: #ffffff with border #e9edef
- Font Family: 'Plus Jakarta Sans', sans-serif
- Typography Scale: text-xs (12px) for UI controls, text-sm (14px) for headers, text-lg (18px) for metrics
- Status Badges:
  * CONFIRMED / Active: bg-emerald-50 text-emerald-800 border-emerald-200
  * SCHEDULED / Info: bg-sky-50 text-sky-800 border-sky-200
  * ON_WAY / OTW: bg-sky-100 text-sky-800
  * ASSIGNED / Warning: bg-amber-50 text-amber-800 border-amber-200
```

---

## 3. Prompt Direct Ingestion per Tier (Opsional / Cadangan)

Jika Anda ingin membuat artboard terpisah per layar di Google Stitch, Anda cukup menyalin prompt berikut ke bar Stitch:

### Tier 1: Core Harian & Real-time ⭐⭐⭐⭐⭐
1. **Live Chat WhatsApp (`/admin/live-chat`)**:
   > *"Generate a modern WhatsApp-style clinic live chat dashboard screen using #008069 brand green and #f0f2f5 canvas. Left panel: search bar, active patient chat list with 'AI Active' and 'Tanya Jadwal' badges (e.g. Ibu Anisa - Baby Ken). Right panel: conversation view with white incoming bubbles and #d9fdd3 outgoing bubbles with checkmarks, header with patient address and 'Ambil Alih Manual' button, bottom quick-reply input bar."*

2. **Kalender & Reservasi Booking (`/admin/reservations`)**:
   > *"Generate a clinic booking reservation calendar screen. Header: date selector with 'Hari/Minggu/Bulan' toggle and 'Tambah Reservasi' primary button. Grid of appointment time slots (09:00, 11:00, 13:30, 15:30) featuring patient names, baby age, assigned midwife (e.g. Bidan Rina), status badges (CONFIRMED in green, SCHEDULED in blue, ASSIGNED in amber), and treatment price."*

3. **Treatment Hari Ini (`/admin/today-treatments`)**:
   > *"Generate a daily operational task list screen for home care midwives. Cards showing scheduled home visits with time chips, patient address with Google Maps pin, treatment name (Pijat Batuk Pilek), assigned therapist, live route status chips ('ON_WAY', 'COMPLETED'), and payment confirmation pill."*

4. **Dashboard Overview (`/admin/overview`)**:
   > *"Generate a clinic admin analytics overview screen. Top row with 4 stat cards: Total Omset (Rp 2.450.000, +14%), Total Booking (16 Booking, 94% confirmed), Active Leads (42 Leads), Midwife Attendance. Bottom row with a sleek weekly revenue bar chart and real-time activity feed."*

---

### Tier 2: CRM & Pasien ⭐⭐⭐⭐
5. **Customer Database (`/admin/customers`)**:
   > *"Generate a medical patient CRM table screen. Columns: Patient & Child Name with age, WhatsApp Number, Category Badge ('Langganan VIP', 'Ibu Menyusui'), Total Treatment Count, and Action button to view chat history and home address."*

6. **Antrean Follow-Up Otomatis (`/admin/follow-ups`)**:
   > *"Generate an automated WhatsApp follow-up queue screen. List cards showing upcoming automated reminder triggers (H-1 appointment reminder, H+1 satisfaction review, post-treatment care tips) with target patient count, scheduled send time, and status pills."*

7. **Quick Replies (`/admin/quick-replies`)**:
   > *"Generate a quick response template management screen with keyboard shortcut chips (/jadwal, /tarif, /bapil, /laktasi), message preview box, and dynamic variable pills ({nama_pasien}, {jam_booking})."*

---

### Tier 3: Katalog & Manajemen Tim ⭐⭐⭐
8. **Katalog Layanan (`/admin/services`)**:
   > *"Generate a clinic treatment service catalog grid with cards for Pediatric Baby Massage (45m, Rp 135k), Lactation Massage (60m, Rp 175k), Baby Spa (50m, Rp 150k) with category pills, active toggles, and price edit modal."*

9. **Tarif Jarak & Ongkir (`/admin/delivery`)**:
   > *"Generate a home care delivery distance tier configuration screen showing radius bands (0-3 km: Free, 3.1-7 km: Rp 15k, 7.1-12 km: Rp 25k) with interactive base fare and per-km surcharge settings."*

10. **Staff & Akun Bidan (`/admin/staff-management`)**:
    > *"Generate a midwife and clinic staff management screen. Profile cards displaying midwife avatar, license number, assigned coverage zone, active status pill, and role permissions."*

11. **Knowledge Base FAQ (`/admin/knowledge-base`)**:
    > *"Generate an AI Knowledge Base FAQ screen with clinical search bar and cards for medical procedures (SOP Batuk Pilek Bayi, Syarat Pasca-Imunisasi 48 Jam, Kebijakan Pembatalan)."*

---

### Tier 4: Marketing & AI Simulator ⭐⭐
12. **AI Sandbox & Persona (`/admin/sandbox`, `/admin/persona`)**:
    > *"Generate an interactive AI bot testing sandbox screen with a chat simulator, clinical intent router inspector (get_catalog_and_price), token usage counter, and persona tone settings (Empathetic Midwife, 'Bunda' greeting, max 2-3 sentences)."*

13. **Landing Page Promo (`/admin/landing`)**:
    > *"Generate a Click-to-WhatsApp promotion landing page preview showing hero banner, clinic benefits, discount voucher pill, and sticky 'Pesan via WhatsApp' floating CTA button."*

14. **Meta CAPI & Ads Attribution (`/admin/meta-click-catcher`)**:
    > *"Generate a Meta Ads conversion tracker dashboard screen with attribution event graphs (Contact, Lead, Purchase) and 98% event match quality indicators."*

---

### Tier 5: Sistem & Utilitas ⭐
15. **Pengaturan Operasional (`/admin/settings`)**:
    > *"Generate a clinic operating hours and daily quota setting form with opening time pickers (08:00 - 17:00 WIB), max bookings per day limit, and emergency contact settings."*

16. **Integrasi Telegram & System Diagnostic (`/admin/telegram`, `/admin/debug`)**:
    > *"Generate a system health diagnostics and Telegram bot integration screen with server memory cards, Redis cache status, database ping latency, and Telegram briefing dispatch button."*
