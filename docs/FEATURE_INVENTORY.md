# 📋 Inventarisasi Fitur Sistem (Level Mikro)

> **MANDAT PEMBARUAN (LIVING DOCUMENT)**:
> File ini adalah peta resmi seluruh kapabilitas sistem WA Clinic Bot Engine dari level makro hingga mikro.
> **Setiap kali ada penambahan, perubahan, atau penghapusan fitur** (seperti Endpoint API baru, Tool LLM baru, Background Worker/Cron baru, Tabel Database baru, Web App Staf, atau Komponen Dashboard), pengembang / AI Agent **WAJIB memperbarui dokumen ini** dan mencatatnya di tabel riwayat pembaruan di bagian akhir dokumen.

---

## 1. Arsitektur Inti & Multi-Tenant SaaS

Sistem dibangun menggunakan **Node 20 + TypeScript + Fastify** dengan database **PostgreSQL (Prisma ORM)**, mendukung arsitektur multi-tenant secara data-driven (`DEFAULT_TENANT_ID = 'default-tenant'`).

| Fitur Mikro | Komponen / Lokasi File | Deskripsi & Fungsi Teknis |
| :--- | :--- | :--- |
| **Isolasi Multi-Tenant** | `src/config/tenant.ts`, `prisma/schema.prisma` (`Tenant`) | Seluruh entitas bisnis (katalog layanan, persona, tarif ongkir, konfigurasi prompt, integrasi) terisolasi per `tenant_id`. |
| **Inisialisasi Data Boot** | `src/app.ts` (baris 217–248) | Saat aplikasi boot, otomatis memuat katalog layanan, tarif ongkir, persona Bidan, konfigurasi model AI, dan scope rollout dari DB untuk semua tenant aktif. |
| **Pemisahan Proses Worker** | `src/worker.ts`, `src/lifecycle/background-crons.ts` | Flag env `SEPARATE_WORKER=true` memisahkan eksekusi cron/worker berat dari Fastify Webhook event loop untuk stabilitas beban tinggi. |
| **Graceful Shutdown** | `src/lifecycle/shutdown.ts` | Menangkap sinyal `SIGTERM`/`SIGINT`, menghentikan background cron terlebih dahulu, menguras antrean pesan (drain queue), dan menutup koneksi database secara aman. |
| **Kompresi HTTP Response** | `src/app.ts` (`@fastify/compress`) | Kompresi otomatis Brotli, Gzip, dan Deflate untuk respons API berukuran > 1KB. |
| **Global Rate Limiting** | `src/app.ts` (`@fastify/rate-limit`) | Batasan request (1000 req/menit prod, 100 req/menit test), dengan bypass cerdas untuk SSE long-lived streams (`/events`) dan kuota khusus IP webhook. |
| **Forensik Auth Access Log** | `src/utils/auth-access-log.ts` | Pencatatan otomatis satu baris JSON terstruktur untuk respons status `401` dan `503` (merekam IP, prefix token 8-karakter tanpa membocorkan kredensial). |
| **Log Buffer & Rehidrasi** | `src/utils/log-buffer.ts`, `src/utils/llm-execution-logger.ts` | Buffer memori melingkar (ring buffer) untuk log sistem dan eksekusi LLM yang otomatis direhidrasi saat aplikasi reboot. |

---

## 2. WhatsApp Gateway & Ingestion Layer

Lapisan gateway bertugas mengabstraksi komunikasi dua arah ke WhatsApp melalui driver ganda (**WAHA** dan **WABA Meta Cloud API**).

| Fitur Mikro | Endpoint / Komponen | Deskripsi & Fungsi Teknis |
| :--- | :--- | :--- |
| **Driver WAHA (WhatsApp HTTP API)** | `src/integrations/whatsapp/waha.driver.ts` | Menangani integrasi ke container WAHA (`devlikeapro/waha:noweb-2026.7.2`), polling status session, dan pengambilan QR code. |
| **Driver WABA (Meta Cloud API)** | `src/integrations/whatsapp/waba.driver.ts` | Menangani komunikasi resmi Meta Cloud API Graph v21.0, pengiriman template pre-approved, dan tombol interaktif. |
| **Webhook Ingestion WAHA** | `POST /webhook` (`src/routes/webhook.route.ts`) | Menerima pesan teks, lokasi (GPS pin), gambar, audio/voice note, dokumen, dan status pengiriman (ack/read). |
| **Webhook Ingestion WABA** | `GET|POST /api/webhook/waba` (`src/routes/waba-webhook.route.ts`) | Verifikasi token webhook (GET challenge) dan penerimaan payload pesan dengan verifikasi kriptografi HMAC `X-Hub-Signature-256`. |
| **Anti-Burst Coalescing** | `src/services/burst-coalesce.service.ts` | Menggabungkan beberapa gelembung chat yang dikirim customer secara bertubi-tubi dalam jeda 2-3 detik menjadi satu konteks utuh sebelum diproses AI. |
| **Idempotensi & Deduplikasi Turn** | `src/services/turn-recovery.service.ts`, tabel `InboundTurn`, `OutboundAttempt` | Mencegah pemrosesan ganda atas pengiriman ulang webhook WhatsApp melalui pencatatan turn ID dan hash payload. |
| **Emergency Outbound Kill-Switch** | `src/services/whatsapp-provider.service.ts` | Sakelar darurat per-tenant untuk memutus seluruh respon otomatis bot secara instan jika terjadi anomali produksi. |
| **Manajemen Opt-Out Pemasaran** | `src/services/waba-optout.service.ts` | Deteksi kata kunci opt-out (*STOP*, *BERHENTI*, *UNSUBSCRIBE*), membatalkan seluruh jadwal follow-up otomatis, dan mengirim konfirmasi keluar. |
| **Simulasi Mengetik Manusiawi** | `src/services/typing.service.ts` | Menghitung waktu tunda (*natural delay*) proporsional berdasarkan panjang karakter respons dan mengirim sinyal *typing indicator* ke WhatsApp. |

---

## 3. Conversational AI Engine (Arsitektur V3)

Mesin AI menggunakan arsitektur dua tahap (**Call 1 Router** dan **Call 2 Generator**) dengan Persona Bidan yang empatik, profesional, dan dipandu oleh batasan deterministik ketat (*hard guards*).

### A. Alur Eksekusi & Routing LLM
1. **Call 1 Router (`router-tool-routing.layer.ts`)**:
   - Menetapkan `parallel_tool_calls: false` (hanya boleh memanggil maksimal 1 tool utama per putaran obrolan).
   - Menentukan intent customer: konsultasi layanan, tanya harga, hitung ongkir, booking jadwal, tanya kebijakan klinik, atau eskalasi medis.
2. **Call 2 Generator (`generation-stage.ts`)**:
   - Merangkai teks balasan akhir berdasarkan hasil data tool, persona Bidan, data grounding riil, dan contoh percakapan (*few-shot exemplars*).

### B. Dynamic Physical Tool Masking (`src/v3/tools/tool-masker.ts`)
Tool yang belum memenuhi syarat status sesi dicabut secara fisik dari JSON schema yang dikirim ke LLM:
- `save_reservation`: Dicabut jika customer belum secara eksplisit menyepakati tanggal, jam, dan paket layanan secara final.
- `calculate_delivery`: Dicabut jika customer tidak menyebutkan entitas lokasi baru atau memilih alamat tersimpan.

### C. 6 Canonical Tools AI (`src/v3/tools/`)
1. **`calculate_delivery`**:
   - Menghitung jarak rute berkendara dan tarif ongkir homecare berdasarkan teks kelurahan/kecamatan/link peta atau ID alamat tersimpan.
2. **`get_catalog_and_price`**:
   - Mengambil data layanan resmi dari basis data berdasarkan kategori (`BABY`, `KIDS`, `MOMS`), usia anak, usia kehamilan, atau keluhan klinis (*symptoms*). Menjaga *clinical dominance* (keluhan wajib diprioritaskan).
3. **`save_reservation`**:
   - Memvalidasi dan mengunci pemesanan jadwal ke database hanya saat kesepakatan final telah tercapai.
4. **`escalate_to_human`**:
   - Mengalihkan percakapan ke tim Admin/CS manusia saat terdeteksi keluhan medis darurat, permintaan manual, atau kemacetan percakapan.
5. **`get_clinic_policy_faq`**:
   - Mengambil SOP dan kebijakan klinik resmi (kualifikasi bidan, metode pembayaran, aturan pasca-vaksinasi, ketentuan transport anak kembar, homebase, jam operasional).
6. **`search_knowledge_faq`**:
   - Pencarian semantik berbasis potongan pengetahuan (*knowledge chunks*) untuk menjawab pertanyaan spesifik non-standar.

### D. Hard Deterministic Guardrails (`src/v3/guardrails/`)
- **`factual-claim-validator.ts`**: Menolak klaim medis atau klaim harga yang tidak terdapat dalam potongan data grounding resmi.
- **`numeric-fact-validator.ts`**: Memverifikasi kesesuaian angka nominal harga dan durasi menit layanan antara data database vs teks yang dirangkai LLM.
- **`pronoun-validator.ts`**: Memastikan chatbot secara konsisten menggunakan kata ganti representatif klinik ("kami" / "Bidan kami") dan bukan kata ganti tunggal ("saya").
- **`sanitizer.ts`**: Membersihkan kebocoran internal mesin (tag `<think>`, format markdown bintang tunggal, pola nomor telepon mentah).
- **`sentence-salvage.ts`**: Menyelamatkan kalimat yang terpotong akibat limit token agar pesan WhatsApp tetap berakhir utuh dan rapi.
- **`booking-commit-gate.ts`**: Memastikan komitmen pemesanan berasal dari pesan aktif customer (`role: 'user'`), bukan dari kata-kata asisten sebelumnya.
- **`pricelist-gate.ts`**: Mengirim file/gambar pricelist visual otomatis dengan kuota maksimal 1x per sesi (kecuali diminta ulang secara eksplisit).
- **`delivery-fast-path.ts`**: Bypass instan untuk perhitungan ongkir saat customer mengirimkan shareloc GPS secara langsung tanpa perlu melewati inferensi LLM penuh.
- **`medical-signal-detector.ts`**: Deteksi kata kunci tanda bahaya medis (demam tinggi >38.5°C, kejang, perdarahan, sesak napas) untuk eskalasi seketika.

### E. Manajemen State Percakapan (`src/v3/state/`)
- **`CartManager`**: Keranjang transaksi layanan yang menampung paket pilihan customer dengan aturan penguncian ketat.
- **`GoalTracker`**: Pelacak progres percakapan (pengumpulan alamat, usia pasien, keluhan, penetapan jadwal).
- **`PatientExtractor`**: Ekstraktor entitas profil pasien (Ibu hamil, Ibu nifas, bayi/anak) beserta penanganan multi-anak (`children`).
- **`ConversationSummarizer`**: Peringkas riwayat obrolan panjang untuk menjaga efisiensi token context window.

---

## 4. Manajemen Reservasi & Operasional Homecare

Modul ini mengelola seluruh siklus hidup pemesanan layanan homecare, penugasan bidan/terapis, hingga rekonsiliasi pembayaran.

| Fitur Mikro | Endpoint / Komponen | Deskripsi & Fungsi Teknis |
| :--- | :--- | :--- |
| **Siklus Status Reservasi** | `prisma/schema.prisma` (`ReservationStatus`) | Alur status: `HOLD` (sementara) -> `CONFIRMED` -> `DISPATCHED` -> `ARRIVED` -> `COMPLETED` / `CANCELLED`. |
| **Daftar & Filter Reservasi** | `GET /api/admin/reservations` | Pengambilan data reservasi dengan filter tanggal, status, terapis, pencarian nama, dan pagination. |
| **Statistik Slot Harian** | `GET /api/admin/reservations/daily-slots` | Rekapitulasi kapasitas slot jadwal terisi vs slot tersedia per hari operasional. |
| **NLP Reservation Parser** | `POST /api/admin/reservation/parse` | Ekstraksi otomatis format pesan booking teks bebas menjadi field data reservasi terstruktur. |
| **Quick Hold Slot** | `POST /api/admin/reservation/quick-hold` | Pembuatan hold jadwal kilat untuk mengamankan slot waktu saat customer sedang berdiskusi. |
| **Pembersihan Hold Kedaluwarsa** | `CronService.runExpiredHoldSweep()` | Cron otomatis (setiap 6 jam) yang membatalkan slot berstatus `HOLD` yang telah melewati tanggal kunjungan. |
| **Penyimpanan Kanonis Reservasi** | `POST /api/admin/reservation`, `reservationCoreService` | Single source of truth untuk pembuatan dan validasi reservasi (mencegah bentrok jadwal & anomali data). |
| **Penugasan Staf / Terapis** | `PATCH /api/admin/reservation/:id/assign-staff` | Menugaskan bidan ke reservasi tertentu dengan notifikasi otomatis ke perangkat bidan. |
| **Reschedule Tanggal & Jam** | `PATCH /api/admin/reservation/:id/set-date` | Perubahan jadwal kunjungan dengan audit trail riwayat perubahan. |
| **Konfirmasi & Penyelesaian Kunjungan** | `PATCH /api/admin/reservation/:id/confirm`, `/complete` | Mengubah status menjadi selesai, mencatat pendapatan, dan memasukkan event ke antrean Meta CAPI. |
| **Penyelesaian Massal** | `POST /api/admin/reservations/bulk-complete` | Memproses penyelesaian multi-reservasi sekaligus untuk tutup buku harian. |
| **Unggah Bukti Bayar & Moderasi** | `PUT /api/admin/reservation/:id/proof`, `/approve-purchase`, `/reject-purchase` | Upload slip transfer bank, verifikasi nominal oleh admin, dan approval/rejection pembelian. |
| **Arsip & Pemulihan Reservasi** | `GET /api/admin/reservation/archive`, `/restore` | Soft-delete reservasi ke tabel arsip (`ReservationArchive`) dan kemampuan restore tanpa kehilangan data. |
| **Purge Arsip 60 Hari** | `CronService.runReservationArchivePurge()` | Cron harian pembersihan permanen data arsip reservasi yang berusia lebih dari 60 hari. |
| **Deteksi Tumpang Tindih Jadwal** | `CronService.runSlotOverlapSweep()`, `slot-overlap.service.ts` | Peringatan dini otomatis (setiap 15 menit) jika ada jadwal terapis yang saling bertubrukan (*overlapping*). |
| **Paket Berkelanjutan (Series)** | `src/routes/admin/reservation-series.route.ts` | Manajemen reservasi paket terapi berkala (misal paket 4x / 6x kunjungan), dengan fitur pause, resume, cancel, dan reschedule per sesi. |

---

## 5. Web App Khusus Staf / Bidan Mobile

Antarmuka web responsif berbasis mobile untuk bidan saat bertugas di lapangan.

| Fitur Mikro | Endpoint / Komponen | Deskripsi & Fungsi Teknis |
| :--- | :--- | :--- |
| **Autentikasi Terpisah Staf** | `POST /api/staff/auth/login`, `/restore`, `/logout`, `GET /me` | Sesi mandiri berbasis HttpOnly cookie `staff_session` dengan isolasi peran (Therapist/Bidan vs Admin). |
| **Dashboard Tugas Hari Ini** | `GET /api/staff/today-tasks`, `/upcoming-schedule`, `/completed-tasks` | Daftar tugas kunjungan hari ini, jadwal mendatang, dan rekap kunjungan yang telah selesai. |
| **Operasional Tim & Pengalihan Tugas** | `GET /api/staff/team-members`, `POST /reservations/:id/reassign` | Melihat rekan tim yang bertugas dan mengalihkan pasien jika terjadi kendala darurat. |
| **Live Chat Lapangan Bidan** | `GET /api/staff/conversations/:id/messages`, `POST /reply`, `PATCH /read` | Chat langsung antara bidan dan customer via WhatsApp tanpa perlu membuka nomor WhatsApp pribadi. |
| **Edit & Tarik Pesan Chat** | `PUT /conversations/:id/messages/:messageId/edit`, `DELETE /:messageId` | Bidan dapat mengedit atau menarik (*unsend*) pesan chat yang salah kirim. |
| **Event Real-Time Staf (SSE)** | `GET /api/staff/live-chat/events` | Aliran Server-Sent Events khusus staf untuk pembaruan pesan masuk dan status penugasan secara instan. |
| **Template OTW & Kedatangan** | `GET /api/staff/otw-template`, `GET /api/staff/arrival-template` | Template pesan dinamis WhatsApp untuk mengabari customer bahwa bidan sedang meluncur atau telah tiba. |
| **Alur Keberangkatan (OTW Dispatch)** | `POST /api/staff/reservations/:id/otw` | Menandai keberangkatan bidan, mencatat estimasi waktu tempuh (ETA), dan otomatis mengirim WA ke customer. |
| **Pelacakan Telemetri GPS Perjalanan** | `POST /api/staff/telemetry`, `POST /api/staff/trip/stop` | Merekam koordinat GPS perjalanan bidan secara real-time dan menghitung kecepatan/posisi terkini di peta. |
| **Auto-Close Perjalanan Kedaluwarsa** | `CronService.runTripAutoCloseSweep()` | Cron otomatis (setiap 15 menit) yang menutup sesi pelacakan GPS jika jadwal kunjungan telah terlewati. |
| **Pemberitahuan Kedatangan & Selesai** | `POST /api/staff/reservations/:id/arrive`, `POST /complete` | Konfirmasi kehadiran di lokasi pasien dan pelaporan tindakan klinis setelah terapi selesai. |
| **Penagihan & Penerimaan Pembayaran** | `POST /reservations/:id/send-payment-info`, `POST /payment` | Mengirim info rekening/QRIS klinik ke WhatsApp pasien dan mencatat pembayaran cash/transfer di lokasi. |
| **Pairing Telegram Pribadi Bidan** | `GET /api/staff/me/telegram-pairing`, `POST /regenerate` | Menghubungkan akun Telegram bidan untuk menerima notifikasi penugasan dan ringkasan briefing H-30 menit. |

---

## 6. Live Chat CS & Hybrid Takeover (Admin / Supervisor)

Pusat kendali percakapan di Admin Dashboard untuk Customer Service manusia mengawasi dan mengambil alih obrolan bot.

| Fitur Mikro | Endpoint / Komponen | Deskripsi & Fungsi Teknis |
| :--- | :--- | :--- |
| **Dual-Pane Real-Time Inbox** | `GET /api/admin/live-chat/conversations` | Daftar kontak obrolan dengan filter status, indikator pesan belum dibaca, badge MQL, dan pin obrolan. |
| **Aliran Real-Time SSE Admin** | `GET /api/admin/live-chat/events` | Koneksi Server-Sent Events untuk pembaruan chat masuk, status pengetikan, dan status pengiriman pesan secara instan. |
| **Pengambilalihan Manual (Takeover / Release)** | `POST /api/admin/live-chat/conversations/:id/takeover`, `PATCH /release` | Mematikan bot AI pada sesi tersebut (`is_human_handling = true`) agar CS dapat menangani percakapan secara penuh. |
| **Enrichment Latar Belakang Senyap** | `src/services/human-background-enrichment.service.ts` | Saat mode takeover aktif, sistem di latar belakang tetap menganalisis data profil customer (nama, alamat, keluhan). |
| **Pengiriman Pesan Multi-Media** | `POST /api/admin/live-chat/conversations/:id/reply` | Mengirim balasan teks, gambar brosur, dokumen PDF SOP, dan pesan suara (voice note). |
| **Pemutar Voice Note Audio** | `VoiceNotePlayer.tsx`, `src/routes/media.route.ts` | Streaming dan pemutaran voice note WhatsApp dari customer langsung di antarmuka web. |
| **Sematkan & Sembunyikan Pesan** | `PATCH /live-chat/conversations/:id/messages/:messageId/pin`, `/hide` | Menyematkan pesan penting di bagian atas ruang chat atau menyembunyikan pesan sensitif dari tampilan CS. |
| **Reaksi Emoji WhatsApp** | `POST /live-chat/conversations/:id/messages/:messageId/reaction` | Mengirimkan emoji reaksi langsung ke gelembung chat WhatsApp customer. |
| **AI Copilot & Saran Balasan Cerdas** | `POST /api/admin/live-chat/conversations/:id/suggest-reply`, `POST /api/admin/copilot/chat` | AI membaca konteks obrolan dan riwayat database untuk memberikan rekomendasi jawaban kilat kepada CS. |
| **Quick Reply & Pintasan Ongkir Cepat** | `GET/POST /api/admin/quick-replies`, `LiveChatComposer.tsx`, `seed-ongkir-quick-replies.ts` | Manajemen template balasan cepat dengan pintasan keyboard (`/o1` s/d `/o25` untuk konfirmasi ongkir sesuai tier jarak resmi, `/qris`, `/pricelist`) dan auto-seeding ke PostgreSQL. |
| **Sinkronisasi Riwayat Chat WAHA** | `POST /live-chat/sync-history`, `/sync-full`, `GET /sync-status`, `POST /sync-cancel` | Mengunduh riwayat percakapan lama dari nomor WhatsApp ke database PostgreSQL secara bertahap atau penuh. |
| **Deteksi Rasa Frustrasi Pelanggan** | `CronService.runFrustrationSweep()`, `frustration-signal.service.ts` | Deteksi otomatis jika ada chat yang belum direspons melewati batas SLA atau mengandung sinyal ketidakpuasan. |
| **Pembaruan Foto Profil Customer** | `POST /api/admin/live-chat/customers/:id/refresh-profile-picture` | Mengunduh foto profil WhatsApp terbaru dari customer untuk ditampilkan di dashboard. |

---

## 7. Pemasaran, Attribution & Tracking (Meta Ads / CTWA)

Modul pelacakan efektivitas iklan berbayar (Click-to-WhatsApp) hingga ke titik transaksi nyata (*closed-loop attribution*).

| Fitur Mikro | Endpoint / Komponen | Deskripsi & Fungsi Teknis |
| :--- | :--- | :--- |
| **Dynamic Landing Pages** | `GET /go`, `/cta`, `/promo/:slug`, `/:slug` | Halaman pendaratan multi-tenant dinamis dengan injeksi Meta Pixel dan Google Analytics otomatis. |
| **Tracking Event CTA & Pageview** | `POST /api/tracking/click`, `POST /api/tracking/pageview` | Merekam jejak klik tombol WhatsApp dan kunjungan halaman menggunakan Beacon API tanpa hambatan preflight. |
| **Pricelist Cepat In-App Browser** | `GET /pricelist`, `/pricelist.html` | Halaman katalog harga interaktif yang dirender seketika (0 roundtrip) di dalam in-app browser WhatsApp. |
| **Pelacakan Referral CTWA** | `src/integrations/whatsapp/waha-ctwa-referral.ts`, `AdClick` | Menangkap metadata iklan Meta (ad ID, campaign ID, headline iklan, thumbnail) saat customer pertama kali menyapa. |
| **CTWA Campaign Catchers** | `GET|POST|PUT|DELETE /api/admin/ctwa-catchers`, `/test` | Aturan penangkap pesan awal iklan untuk memetakan teks pembuka tertentu ke kampanye iklan yang sesuai. |
| **Meta Conversions API (CAPI)** | `src/services/capi.service.ts`, `GET /api/admin/capi-queue` | Pengiriman event konversi sisi server (`Purchase`, `Schedule`, `Lead`) ke Meta Graph API dengan hashing SHA-256 data PII. |
| **Dasbor Analitik Meta Performance** | `GET /api/admin/meta-performance` (`MetaPerformancePanel.tsx`) | Analisis terpadu: KpiGrid, SpendCalculator, FunnelBars, CohortRetentionTable, JourneyHistogram, dan utilisasi terapis. |
| **Ekspor Meta Custom Audience** | `GET /api/admin/customers/audience-export/meta` | Ekspor data nomor telepon terenkripsi SHA-256 untuk pembuatan Custom Audience & Lookalike Audience di Meta Ads Manager. |

---

## 8. Otomasi, Background Crons & Pekerja Mandiri

Sistem menjalankan 21 background worker mandiri untuk memastikan integritas data dan kelancaran operasional klinik tanpa intervensi manual.

| Background Worker / Cron | Frekuensi / Waktu | Deskripsi & Tanggung Jawab Operasional |
| :--- | :--- | :--- |
| **Google Sheets Outbox Sync** | Setiap 3 menit | Menguras antrean rekapan data reservasi dan keuangan ke spreadsheet Google Sheets klinik. |
| **Frustration SLA Sweep** | Setiap 5 menit | Memeriksa percakapan yang terbengkalai melewati SLA waktu tunggu untuk memicu alarm peringatan CS. |
| **Assignment Notification Sweep** | Setiap 2 menit | Mengirimkan notifikasi penugasan terapis yang terkumpul dalam buffer 5 menit ke perangkat bidan. |
| **Trip Auto-Close Sweep** | Setiap 15 menit | Menutup otomatis sesi pelacakan GPS bidan yang perjalanannya telah melewati jadwal kunjungan. |
| **Slot Overlap Sweep** | Setiap 15 menit | Mendeteksi potensi bentrok jadwal antar-kunjungan dan memberi tahu admin. |
| **Shareloc Reminder Sweep** | Setiap 15 menit | Mengirimkan pengingat halus kepada customer yang sudah sepakat booking namun lupa mengirim shareloc lokasi. |
| **Follow-Up Drip Worker** | Setiap 15 menit | Mengeksekusi antrean pesan follow-up otomatis (H+1 kepuasan, H+3 evaluasi, H+7 penawaran sesi lanjutan). |
| **Nightly Watchdog** | Setiap 21:00 WIB | Laporan pengawasan malam ke Telegram/WhatsApp pemilik klinik: rekap tugas selesai, hold tersisa, dan pesan belum tertangani. |
| **Morning Jobs & Briefing** | Setiap 06:00 WIB | Persiapan sistem harian dan pengiriman jadwal kunjungan pagi ke masing-masing bidan yang bertugas. |
| **Daily Ops Report** | Setiap 07:00 WIB | Pengiriman laporan performa bisnis harian (omzet, jumlah booking, konversi chat) ke manajemen via Telegram/WA. |
| **Pre-Visit Brief Bidan** | Setiap 10 menit (H-30) | Pengiriman ringkasan data pasien, riwayat alergi/keluhan, dan koordinat maps ke bidan 30 menit sebelum jadwal tiba. |
| **Expired Hold Sweep** | Setiap 6 jam | Membatalkan slot jadwal sementara (HOLD) yang sudah melewati batas waktu konfirmasi. |
| **AI LLM Quality Evaluation** | Setiap 6 jam | Pengujian otomatis kualitas jawaban bot menggunakan metode *LLM-as-Judge* terhadap standar SOP klinik. |
| **Daily Chat Export** | Setiap 6 jam | Ekspor riwayat obrolan harian ke format Markdown untuk arsip analisa AI dan pelatihan model. |
| **Media Retention Cleanup** | Setiap 24 jam | Menghapus file gambar/audio sementara di Live Chat yang telah melewati masa retensi untuk menghemat disk. |
| **Message Retention Cleanup** | Setiap 24 jam | Pembersihan riwayat teks chat lama sesuai dengan kebijakan retensi data klinik. |
| **Staff Session Housekeeping** | Setiap 24 jam | Menghapus cookie sesi staf dan token otentikasi yang sudah kedaluwarsa. |
| **Reservation Archive Purge** | Setiap 24 jam | Pembersihan permanen data arsip reservasi yang sudah berada di arsip lebih dari 60 hari. |
| **Daily Invariant Monitor** | Setiap 24 jam | Pemeriksaan integritas data read-only lintas tabel database (mendeteksi relasi menggantung atau anomali status). |
| **Label Reconciliation** | Setiap 4 jam | Menyelaraskan status operasional database internal dengan pelabelan percakapan. |
| **Weekly Database Backup** | Setiap Senin 02:00 WIB | Pembuatan dump cadangan basis data PostgreSQL otomatis dan pengunggahan terenkripsi ke Google Drive. |

---

## 9. Integrasi Eksternal (Google, Telegram, Peta & AI)

Sistem terhubung ke berbagai platform pihak ketiga untuk mendukung alur kerja klinik modern.

| Domain Integrasi | Komponen Teknis | Kemampuan & Fungsi |
| :--- | :--- | :--- |
| **Google Contacts Sync** | `src/services/google-contacts.service.ts` | Sinkronisasi otomatis kontak pasien ke Google Contacts dengan format nama standar klinik (Nama - Kelurahan). |
| **Google Sheets Sync** | `src/services/sheets-sync.service.ts` | Ekspor dua arah transaksi reservasi dan keuangan ke spreadsheet operasional secara real-time. |
| **Google Drive Backup** | `src/integrations/google-drive/client.ts` | Penyimpanan file cadangan dump database mingguan langsung ke Google Drive klinik secara terenkripsi. |
| **Google Maps & ORS** | `distance-matrix.client.ts`, `ors/client.ts` | Menghitung jarak jalan raya akurat via OpenRouteService API & Google Distance Matrix dengan fallback rumus Haversine. |
| **Telegram Bot Alert** | `src/services/telegram.service.ts` | Mengirimkan laporan harian, alert kesalahan sistem darurat, dan ringkasan tugas ke grup admin atau chat personal bidan. |
| **Web Push (VAPID)** | `src/services/web-push.service.ts` | Pengiriman notifikasi browser native (Web Push API) ke laptop CS dan smartphone staf saat ada chat/tugas masuk. |
| **Multi-Provider LLM Gateway** | `src/integrations/llm/llm-gateway.ts` | Gateway fleksibel yang mendukung peralihan model AI secara instan (OpenAI GPT-4o, Google Gemini, DeepSeek, Groq, OpenRouter). |

---

## 10. Pengaturan Sistem, RBAC & Keamanan

Pusat administrasi sistem di Admin Dashboard (`packages/admin-dashboard`) untuk mengontrol seluruh parameter operasional.

| Sub-Modul Admin | Endpoint / Komponen | Fitur Pengaturan Mikro |
| :--- | :--- | :--- |
| **Manajemen Pelanggan & Alamat** | `src/routes/admin/customers.subroute.ts` | Pencarian pasien, buku alamat multi-lokasi, pemblokiran nomor, override status AI (Force ON / Force OFF / Auto), dan soft-reset. |
| **Katalog Layanan & Harga** | `GET|POST|PUT|DELETE /api/admin/services` | Pengaturan master layanan klinik (kategori, target usia anak/ibu, harga dasar, durasi terapi, deskripsi SOP). |
| **Tarif Ongkir (Delivery Tiers)** | `GET|POST /api/admin/delivery-tiers` | Konfigurasi tarif ongkos kirim homecare berdasarkan zona jarak kilometer dari markas/klinik. |
| **Persona & Prompt Bidan** | `GET|POST /api/admin/persona`, `/prompt-config` | Penyesuaian nama bidan, nada bicara (empati/ramah), dan konfigurasi prompt per-tenant tanpa mengubah kode sumber. |
| **Few-Shot Exemplars** | `GET|POST|PUT|DELETE /api/admin/few-shots` | Pengelolaan contoh tanya-jawab ideal untuk memandu LLM merespons berbagai gaya bahasa pasien. |
| **Pilihan Model AI Per-Tugas** | `GET|PATCH /api/admin/ai-models` | Menentukan model LLM yang berbeda untuk masing-masing tugas (Call 1 Router, Call 2 Generator, AI Copilot, Evaluator). |
| **Scope Rollout AI** | `GET|PATCH /api/admin/ai-rollout-scope` | Pengaturan cakupan bot AI (`NEW_ONLY` untuk kontak baru saja vs `ALL` untuk seluruh pelanggan) dengan tanggal cutoff. |
| **Basis Pengetahuan (Knowledge & FAQ)** | `src/routes/admin/knowledge.subroute.ts` | Manajemen dokumen SOP klinik, chunk FAQ, dan penanganan pertanyaan customer yang belum terjawab (*unanswered questions*). |
| **Konfigurasi Pembayaran & Rekening** | `GET|PUT /api/admin/settings/payment-info` | Pengaturan nomor rekening bank klinik, nama pemilik rekening, dan upload gambar QRIS dinamis. |
| **Manajemen Staf & Hak Akses (RBAC)** | `src/routes/admin/staff-management.subroute.ts`, `roles.subroute.ts` | Pembuatan akun bidan/admin, role custom, dan penegakan izin akses endpoint data-driven via tabel `role_api_scopes`. |
| **Cadangan & Pemulihan Sistem** | `src/routes/admin/backup.subroute.ts` | Pemicu manual cadangan database (`pg_dump`), pengunduhan file backup, dan proses pemulihan (*restore*). |
| **Audit Log Sistem & Forensik LLM** | `src/routes/admin/evaluations.subroute.ts` | Inspeksi detail log eksekusi LLM, prompt yang dikirim, token usage, estimasi biaya rupiah, dan sandbox uji coba chat. |

---

## 11. Ringkasan Kuantitatif Seluruh Sistem

- **Total Endpoint API**: **117 endpoint** (tersebar di rute Admin, Staff, Webhook, Media, Tracking, Landing, dan Health).
- **Total Model Database (Prisma Entities)**: **43 tabel/model** mencakup domain Customer, Percakapan, Reservasi, Staf, Konfigurasi AI, Log Audit, Integrasi Google/Meta, dan Analitik.
- **Total Background Crons & Workers**: **21 pekerja mandiri** dengan interval berkala mulai dari 2 menit hingga 1 minggu.
- **Penyedia Integrasi WhatsApp**: Dual-mode terintegrasi (**WAHA container** + **Meta Cloud API resmi**).
- **Dasbor Manajemen**: 1 Single Page Application (React 18 + Vite + Tailwind CSS) yang memuat modul Kalender Jadwal, Live Chat CS, Peta Sebaran Pasien, Analitik Meta Ads, Evaluasi AI, dan Konfigurasi Multi-Tenant.

---

## 12. Riwayat Pembaruan Fitur (Living Feature Changelog)

| Tanggal | Modul / Komponen | Perubahan / Penambahan Fitur Mikro | Referensi PR/Commit |
| :--- | :--- | :--- | :--- |
| **2026-11-02** | Semua Modul | Kompilasi inventarisasi menyeluruh level mikro (117 endpoint, 43 model DB, 21 workers). | Inisiasi dokumen |
