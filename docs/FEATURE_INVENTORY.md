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
| **Ingest Lokasi & Pengayaan Pin GPS** | `src/services/location-ingest.service.ts`, `src/domain/customer-address.ts` | Ingest pesan shareloc native WhatsApp; menerapkan gerbang pengayaan deterministik (`selectEnrichmentTarget`) agar pin GPS pertama memperkaya kartu alamat intake lama se-wilayah dan tidak melahirkan kartu kedua duplikat. |
| **Kecukupan Lokasi Kanonik (Location Adequacy)** | `src/domain/location-adequacy.ts`, `src/services/live-chat.service.ts`, `packages/admin-dashboard/src/utils/sharelocCardStatus.ts`, `src/v3/state/goal-tracker.ts` | Sumber kebenaran tunggal apakah titik pelanggan sudah memadai: `gps_pin` > `manual_staff` (diverifikasi staf pada titik yang sama, toleransi 150 m) > bukti lapangan (foto rumah + riwayat kunjungan + alamat lengkap) > `estimated_area`. Dipakai badge Live Chat, prompt grounding AI, dan sweep pengingat agar pelanggan yang sudah terverifikasi tidak dicap "butuh shareloc". | Audit Shareloc 2026-11-06 (#315) |
| **Disambiguasi Wilayah Perbatasan & Write Seam Guard** | `src/utils/gazetteer.ts`, `src/integrations/google-maps/geocoding.ts`, `src/services/customer.service.ts` | Semantic anchoring dan border-margin tolerance (`GAZETTEER_BORDER_MARGIN_KM = 0.5`) pada reverse geocoding centroid gazetteer, serta gerbang proteksi di `updateCustomerLocation` yang menolak penimpaan kecamatan terverifikasi oleh estimasi centroid tetangga perbatasan. |
| **Rekonsiliasi Buku Alamat (JSON ↔ Tabel)** | `src/domain/address-reconciliation.ts`, `src/domain/customer-address.ts`, `src/services/customer.service.ts`, `src/scripts/reconcile-customer-addresses.ts` | Sumber kebenaran tunggal buku alamat: `getSavedAddresses` membaca **tabel `customer_addresses` ∪ cache `preferences.saved_addresses`** (kanonis menang, dedup by id/identitas rumah, tepat 1 primary); semua tulis memakai lock per-customer + **merge JSONB atomik** (`preferences || patch`) agar kartu baru tidak terhapus snapshot basi; rekonsiliasi massal tetap tersedia (dry-run, `--commit` transaksional). |
| **Pemilih & Editor Alamat Per-Kartu di Reservasi** | `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx`, `packages/admin-dashboard/src/components/modals/ReservationDetailModal.tsx`, `packages/admin-dashboard/src/components/customer/AddressBookDrawer.tsx`, `packages/admin-dashboard/src/pages/tenant/Reservations.tsx`, `src/routes/admin/reservation-dispatch.route.ts`, `src/routes/admin/customers.subroute.ts` | Pemilih kartu alamat **selalu terhidrasi** di form edit reservasi (fetch `GET /customers/:id/addresses` bila payload ramping tidak membawa `saved_addresses`); tombol pensil blok lokasi membuka Buku Alamat kartu. `PATCH /reservation/:id` memvalidasi kepemilikan kartu (tenant-scoped) dan menyelaraskan `delivery_fee` dengan `ongkir` kartu. `PUT /customers/:id/location` mendukung `customerAddressId` (mode kartu): landmark/GPS ditulis ke kartu, profil root tidak ditimpa; relink jadwal aktif via `relinkActiveReservationsForCard()`. | Fix Pemilih Alamat 2026-11-05 (#312) |
| **Proyeksi Alamat Efektif Satu Seam (Kartu → Raw Text → Preferensi → Profil)** | `packages/admin-dashboard/src/utils/reservationAddress.ts`, `src/utils/reservation-address.ts`, `src/routes/admin/reservation-crud.route.ts`, `src/routes/admin/reservation-dispatch.route.ts` | `resolveReservationAddress()` menjadi satu-satunya proyeksi Detail Reservasi: jalan, kelurahan/kecamatan/kota, jarak, ongkir, dan titik peta dibaca dari **kartu `customer_address` tertaut**, baru fallback ke `raw_text` → `preferences` → kolom profil. Payload list reservasi menyertakan `customer_address: true` di kedua cabang query (cache & non-cache) agar kartu tidak harus di-fetch ulang. `PATCH /reservation/:id` **dilarang** menulis balik `Customer.ongkir`/wilayah/`preferences.address` saat admin memilih kartu eksplisit (anti data hibrida: jalan rumah kedua + wilayah rumah pertama). | Fix Detail Alamat 2026-11-06 (#313) |
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
1. **Call 1 Router (`src/v3/agent/prompt/phases/router-tool-routing.layer.ts`)**:
   - Menetapkan `parallel_tool_calls: false` (hanya boleh memanggil maksimal 1 tool utama per putaran obrolan).
   - Menentukan intent customer: konsultasi layanan, tanya harga, hitung ongkir, booking jadwal, tanya kebijakan klinik, atau eskalasi medis.
2. **Call 2 Generator (`src/v3/agent/pipeline/generation-stage.ts`)**:
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
   - **Gerbang kelayakan klinis (Fase 2):** memakai `clinical-eligibility.service` — tahap hidup (`PREGNANT`/`POSTPARTUM`/`LACTATING`), ambang gestasional (`min/max_gestational_weeks`), kontraindikasi, dan `requires_screening` dari DB. Bundle mewarisi kelayakan layanan penyusunnya.
3. **`save_reservation`**:
   - Memvalidasi dan mengunci pemesanan jadwal ke database hanya saat kesepakatan final telah tercapai.
   - **Gerbang booking deterministik:** menolak layanan yang melanggar ambang gestasional/kontraindikasi dan memicu handoff ke Bidan (bukan sekadar pesan penolakan).
4. **`escalate_to_human`**:
   - Mengalihkan percakapan ke tim Admin/CS manusia saat terdeteksi keluhan medis darurat, permintaan manual, atau kemacetan percakapan.
5. **`get_clinic_policy_faq`**:
   - Mengambil SOP dan kebijakan klinik resmi (kualifikasi bidan, metode pembayaran, aturan pasca-vaksinasi, ketentuan transport anak kembar, homebase, jam operasional).
6. **`search_knowledge_faq`**:
   - Pencarian semantik berbasis potongan pengetahuan (*knowledge chunks*) untuk menjawab pertanyaan spesifik non-standar.

### D. Hard Deterministic Guardrails (`src/v3/guardrails/` & `src/v3/agent/pipeline/`)
- **`src/v3/guardrails/factual-claim-validator.ts`**: Menolak klaim medis atau klaim harga yang tidak terdapat dalam potongan data grounding resmi.
- **`src/v3/guardrails/numeric-fact-validator.ts`**: Memverifikasi kesesuaian angka nominal harga dan durasi menit layanan antara data database vs teks yang dirangkai LLM.
- **`src/v3/guardrails/pronoun-validator.ts`**: Memastikan chatbot secara konsisten menggunakan kata ganti representatif klinik ("kami" / "Bidan kami") dan bukan kata ganti tunggal ("saya").
- **`src/v3/guardrails/sanitizer.ts`**: Membersihkan kebocoran internal mesin (tag `<think>`, format markdown bintang tunggal, pola nomor telepon mentah).
- **`src/v3/guardrails/sentence-salvage.ts`**: Menyelamatkan kalimat yang terpotong akibat limit token agar pesan WhatsApp tetap berakhir utuh dan rapi.
- **`src/v3/agent/pipeline/booking-commit-gate.ts`**: Memastikan komitmen pemesanan berasal dari pesan aktif customer (`role: 'user'`), bukan dari kata-kata asisten sebelumnya.
- **`src/v3/agent/pipeline/pricelist-gate.ts`**: Mengirim file/gambar pricelist visual otomatis dengan kuota maksimal 1x per sesi (kecuali diminta ulang secara eksplisit).
- **`src/v3/agent/pipeline/delivery-fast-path.ts`**: Bypass instan untuk perhitungan ongkir saat customer mengirimkan shareloc GPS secara langsung tanpa perlu melewati inferensi LLM penuh.
- **`src/v3/agent/pipeline/medical-signal-detector.ts`**: Deteksi kata kunci tanda bahaya medis (demam tinggi >38.5°C, kejang, perdarahan, sesak napas) untuk eskalasi seketika.

### E. Manajemen State Percakapan (`src/v3/state/`)
- **`CartManager`**: Keranjang transaksi layanan yang menampung paket pilihan customer dengan aturan penguncian ketat.
- **`GoalTracker`**: Pelacak progres percakapan (pengumpulan alamat, usia pasien, keluhan, penetapan jadwal).
- **`PatientExtractor`**: Ekstraktor entitas profil pasien (Ibu hamil, Ibu nifas, bayi/anak) beserta penanganan multi-anak (`children`).
- **State Maternal Terstruktur (Fase 1):** `reservations.gestational_weeks`, `mom_stage`, `hpl_date` diisi oleh `maternal-state.service` melalui seam kanonis `saveReservation`; pembaca admin & bidan memakai kolom ini dengan fallback `raw_text` untuk data lama.
- **`ConversationSummarizer`**: Peringkas riwayat obrolan panjang untuk menjaga efisiensi token context window.

---

## 4. Manajemen Reservasi & Operasional Homecare

Modul ini mengelola seluruh siklus hidup pemesanan layanan homecare, penugasan bidan/terapis, hingga rekonsiliasi pembayaran.

| Fitur Mikro | Endpoint / Komponen | Deskripsi & Fungsi Teknis |
| :--- | :--- | :--- |
| **Siklus Status Reservasi** | `prisma/schema.prisma` (`Reservation.status: String`) | Alur status: `HOLD` → `CONFIRMED` → `EN_ROUTE` → `COMPLETED` / `CANCELLED`; `PENDING` untuk same-day request; `PAUSED` untuk sesi series yang dijeda. Kedatangan dicatat di kolom `arrived_at`, bukan status. |
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
| **Deteksi Tumpang Tindih Jadwal** | `CronService.runSlotOverlapSweep()`, `src/services/slot-overlap.service.ts` | Peringatan dini otomatis (setiap 15 menit) jika ada jadwal terapis yang saling bertubrukan (*overlapping*). |
| **Paket Berkelanjutan (Series)** | `src/routes/admin/reservation-series.route.ts` | Manajemen reservasi paket terapi berkala (misal paket 4x / 6x kunjungan), dengan fitur pause, resume, cancel, dan reschedule per sesi. |
| **Log Mutasi Penugasan Bidan** | `reservation_staff_assignment_logs`, `src/routes/admin/reservation-dispatch.route.ts` | Pencatatan append-only riwayat pergantian penugasan bidan (alasan, aktor, waktu) untuk audit transparansi rotasi pasien. |
| **Insentif Retensi Bidan (Staff Retention)** | `GET|POST|PUT /api/admin/staff-retention`, `/drilldown`, `/snapshot`, `/policy`, `RetentionTab.tsx` | Perhitungan otomatis retensi 60-hari pool 6-bulan bergulir, hysteresis tier (50/55/60), proteksi soft landing, drilldown audit pasien, dan pembekuan snapshot payroll. |
| **Indikator Bidan Pemilik Pasien (First-Touch)** | `GET /api/admin/customers`, `GET /api/admin/customers/:id`, `GET /api/admin/live-chat/conversations`, `StaffOwnershipBadge.tsx` | Chip/banner read-only yang menampilkan bidan pemilik retensi (first-touch) dan bidan terakhir yang menangani, lengkap dengan status rotasi/nonaktif. Tidak mengubah penugasan maupun rumus payroll. |

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
| **Balasan Cepat Staf (Read-Only)** | `GET /api/staff/quick-replies` | Daftar template balasan cepat tenant (shortcut, judul, isi, kategori) untuk aplikasi terapis; teks bisnis tetap dari DB, bukan hardcode di bundle staf. |
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
| **Pipeline Thumbnail Media (SSOT)** | `src/services/media.service.ts` (`resolveThumbRelativeUrl`), `src/services/pricelist-config.service.ts` (`getPricelistImageAssets`), `MediaImage.tsx` (`preloadChatImage`) | Thumbnail 640px dibuat **sekali saat upload**, tidak pernah di jalur kirim. Dashboard memakai URL relatif `/media/..._thumb.jpg` (bukan path absolut) dan pra-muat gambar sebelum bubble optimis diganti versi server, sehingga tidak ada flash "Memuat..." saat mengirim gambar/pricelist. |
| **Pemutar Voice Note Audio** | `packages/admin-dashboard/src/components/common/VoiceNotePlayer.tsx`, `src/routes/media.route.ts` | Streaming dan pemutaran voice note WhatsApp dari customer langsung di antarmuka web. |
| **Sematkan & Sembunyikan Pesan** | `PATCH /live-chat/conversations/:id/messages/:messageId/pin`, `/hide` | Menyematkan pesan penting di bagian atas ruang chat atau menyembunyikan pesan sensitif dari tampilan CS. |
| **Reaksi Emoji WhatsApp** | `POST /live-chat/conversations/:id/messages/:messageId/reaction` | Mengirimkan emoji reaksi langsung ke gelembung chat WhatsApp customer. |
| **AI Copilot Analitik & Streaming** | `POST /api/admin/copilot/chat`, `POST /api/admin/copilot/stream` | Asisten analitik operasional berbasis model GLM-5.3-Flash dengan streaming SSE, visual timer, 10 tool dinamis (termasuk query_chat_stats, query_revenue selaras SSOT analitik finansial resmi, query_followups terurut ASC mendesak, lookup_catalog berperingkat deterministik, kontrak waktu WIB, deteksi staf ambigu, deteksi tabrakan interval durasi murni kode, celah slot kosong freeSlots terhitung kode, status bayar per reservasi paymentStatus/unpaidCustomers, dan gerbang anti-duplikasi tool), heartbeat 15s, budget 5 menit, dan audit biaya LLM. |
| **Saran Balasan Cerdas (Smart Reply)** | `POST /api/admin/live-chat/conversations/:id/suggest-reply` | AI membaca konteks obrolan dan riwayat database untuk memberikan rekomendasi jawaban kilat kepada CS. |
| **Quick Reply & Pintasan Ongkir Cepat** | `GET/POST/PUT/DELETE /api/admin/quick-replies`, `LiveChatComposer.tsx`, `QuickReplies.tsx`, `src/domain/shareloc-solicitation.ts` | Manajemen template balasan cepat dengan pintasan keyboard (`/ongkir1` s/d `/ongkir25` konfirmasi ongkir sesuai tier jarak resmi, `/qris`, `/pricelist`, `/shareloc`), interpolasi dinamis SSOT di Live Chat, proteksi anti-timpa saat deploy, dan tombol seeding pemulihan (`POST /seed-defaults`). Lint shareloc pada penyimpanan template **DICABUT** (2026-11-06) karena Quick Reply adalah alat manusia/CS dan tidak pernah masuk prompt LLM; Aturan Emas 21 tetap ditegakkan pada balasan bot lewat guardrail output. |
| **Tautan Interaktif Bubble LiveChat** | `packages/admin-dashboard/src/components/livechat/LiveChatMessagePane.tsx`, `packages/admin-dashboard/src/utils/livechatSearch.tsx` | URL `http(s)://` dan `www.` di teks pesan serta caption video dirender sebagai tautan yang dapat diklik (`target="_blank"` + `rel="noopener noreferrer"`), tanpa mengganggu fitur pencarian/highlight. Tanda baca akhir URL dipisahkan agar tidak ikut menjadi bagian tautan. |
| **Penanda Permintaan Titik Presisi (Cooldown 6 Jam)** | `PATCH /api/admin/live-chat/conversations/:id/shareloc-requested` | Menulis `session_data.shareloc_requested_at` saat staf meminta titik presisi, sehingga badge "Butuh Shareloc" tidak menagih berulang dalam 6 jam (human-in-the-loop, tanpa auto-send). |
| **Sinkronisasi Riwayat Chat WAHA** | `POST /live-chat/sync-history`, `/sync-full`, `GET /sync-status`, `POST /sync-cancel` | Mengunduh riwayat percakapan lama dari nomor WhatsApp ke database PostgreSQL secara bertahap atau penuh. |
| **Deteksi Rasa Frustrasi Pelanggan** | `CronService.runFrustrationSweep()`, `src/services/frustration-signal.service.ts` | Deteksi otomatis jika ada chat yang belum direspons melewati batas SLA atau mengandung sinyal ketidakpuasan. |
| **Pembaruan Foto Profil Customer** | `POST /api/admin/live-chat/customers/:id/refresh-profile-picture` | Mengunduh foto profil WhatsApp terbaru dari customer untuk ditampilkan di dashboard. |
| **Reaksi Emot = Sudah Dibalas** | `POST /api/admin/live-chat/conversations/:id/messages/:messageId/reaction`, `src/services/livechat-reply-state.ts` | Reaksi emot staf pada pesan customer terakhir membuat percakapan tidak lagi berstatus "menunggu dibalas" (dipakai di kartu chat, laporan malam, dan badge SSE). Reaksi customer sendiri dan reaksi pada pesan lama tidak memadamkan status. |

---

## 7. Pemasaran, Attribution & Tracking (Meta Ads / CTWA)

Modul pelacakan efektivitas iklan berbayar (Click-to-WhatsApp) hingga ke titik transaksi nyata (*closed-loop attribution*).

| Fitur Mikro | Endpoint / Komponen | Deskripsi & Fungsi Teknis |
| :--- | :--- | :--- |
| **Dynamic Landing Pages** | `GET /go`, `/cta`, `/promo/:slug`, `/:slug` | Halaman pendaratan multi-tenant dinamis dengan injeksi Meta Pixel dan Google Analytics otomatis. |
| **Tracking Event CTA & Pageview** | `POST /api/tracking/click`, `POST /api/tracking/pageview` | Merekam jejak klik tombol WhatsApp dan kunjungan halaman menggunakan Beacon API tanpa hambatan preflight. |
| **Pricelist Cepat In-App Browser** | `GET /pricelist`, `src/landing/public/pricelist.html` | Halaman katalog harga interaktif yang dirender seketika (0 roundtrip) di dalam in-app browser WhatsApp. |
| **Katalog Layanan Publik** | `GET /layanan` → 301 `/pricelist`, `GET /layanan.html` → 301 `/pricelist` | `/layanan` dipensiunkan 2026-11-11: katalog publik tunggal adalah `/pricelist` (hidrasi DB). Rute lama dipertahankan sebagai redirect permanen agar tautan iklan/chat tidak 404. |
| **Pelacakan Referral CTWA** | `src/integrations/whatsapp/waha-ctwa-referral.ts`, `AdClick` | Menangkap metadata iklan Meta (ad ID, campaign ID, headline iklan, thumbnail) saat customer pertama kali menyapa. |
| **CTWA Campaign Catchers** | `GET|POST|PUT|DELETE /api/admin/ctwa-catchers`, `/test` | Aturan penangkap pesan awal iklan untuk memetakan teks pembuka tertentu ke kampanye iklan yang sesuai. |
| **Meta Conversions API (CAPI)** | `src/services/capi.service.ts`, `GET /api/admin/capi-queue` | Pengiriman event konversi sisi server (`Purchase`, `Schedule`, `Lead`) ke Meta Graph API dengan hashing SHA-256 data PII. Resolusi `zp` non-destruktif dari reverse geocode, gazetteer, dan `raw_text` reservasi; antrean menampilkan hasil resolusi yang sama tanpa menulis DB saat GET. |
| **Dasbor Analitik Meta Performance** | `GET /api/admin/meta-performance` (`packages/admin-dashboard/src/components/meta-performance/MetaPerformancePanel.tsx`) | Analisis terpadu: KpiGrid, SpendCalculator, FunnelBars, CohortRetentionTable, JourneyHistogram, dan utilisasi terapis. |
| **Ekspor Meta Custom Audience** | `GET /api/admin/customers/audience-export/meta` | Ekspor data nomor telepon terenkripsi SHA-256 untuk pembuatan Custom Audience & Lookalike Audience di Meta Ads Manager. |

---

## 8. Otomasi, Background Crons & Pekerja Mandiri

Sistem menjalankan **24 interval cron** untuk **25 pekerja logis** mandiri (Morning Jobs & Weekly Backup berbagi satu interval 15 menit) guna memastikan integritas data dan kelancaran operasional klinik tanpa intervensi manual.

| Background Worker / Cron | Frekuensi / Waktu | Deskripsi & Tanggung Jawab Operasional |
| :--- | :--- | :--- |
| **Google Sheets Outbox Sync** | Setiap 3 menit | Menguras antrean rekapan data reservasi dan keuangan ke spreadsheet Google Sheets klinik. |
| **Frustration SLA Sweep** | Setiap 5 menit | Memeriksa percakapan yang terbengkalai melewati SLA waktu tunggu untuk memicu alarm peringatan CS. |
| **Assignment Notification Sweep** | Setiap 2 menit | Mengirimkan notifikasi penugasan terapis yang terkumpul dalam buffer 5 menit ke perangkat bidan. |
| **Trip Auto-Close Sweep** | Setiap 15 menit | Menutup otomatis sesi pelacakan GPS bidan yang perjalanannya telah melewati jadwal kunjungan. |
| **Slot Overlap Sweep** | Setiap 15 menit | Mendeteksi potensi bentrok jadwal antar-kunjungan dan memberi tahu admin. |
| **Shareloc Reminder Sweep** | Setiap 15 menit | Mengirimkan pengingat halus kepada customer yang sudah sepakat booking namun lupa mengirim shareloc lokasi. |
| **Follow-Up Drip Worker** | Setiap 15 menit | Mengeksekusi antrean pesan follow-up otomatis (H+1 kepuasan, H+3 evaluasi, H+7 penawaran sesi lanjutan). Sejak Fase 4 memilih keluarga template berbasis state: `NEXT_TREATMENT_MOMS_*` + `NO_PURCHASE_MOMS_*` untuk perawatan ibu (hamil/nifas/menyusui), tanpa narasi bayi. |
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
| **Ad Funnel & Delivery Watchdog** | Setiap 30 menit | Memantau anomali delivery iklan Meta Ads (4 sinyal presedensi: gangguan instrumen, hening total, lalu lintas anjlok, CTR rendah) untuk mencegah kebocoran anggaran iklan. |
| **Turn Recovery & Replay Sweep** | Setiap 2 menit | Mengidentifikasi turn percakapan yang macet di buffer/queue akibat restart proses tak terduga, me-replay pesan secara atomik, dan membunyikan alarm kritis saat akumulasi kegagalan melebihi ambang batas. |
| **Sandbox Cleanup** | Setiap 24 jam | Menghapus data uji/QA (`is_sandbox_test` atau nomor berawalan `6289999`) agar tidak mengotori metrik dan laporan operasional. (`ENABLE_SANDBOX_CLEANUP_CRON`) |
| **Staff Retention Snapshot** | Tanggal 1 mulai 03:00 WIB | Membekukan snapshot retensi/insentif bulan sebelumnya untuk seluruh tenant secara idempoten, tanpa menimpa snapshot `FINAL` yang sudah dibekukan admin. (`ENABLE_STAFF_RETENTION_SNAPSHOT_CRON`) |

---

## 9. Integrasi Eksternal (Google, Telegram, Peta & AI)

Sistem terhubung ke berbagai platform pihak ketiga untuk mendukung alur kerja klinik modern.

| Domain Integrasi | Komponen Teknis | Kemampuan & Fungsi |
| :--- | :--- | :--- |
| **Google Contacts Sync** | `src/services/google-contacts.service.ts` | Sinkronisasi otomatis kontak pasien ke Google Contacts dengan format nama standar klinik (Nama - Kelurahan). |
| **Google Sheets Sync** | `src/services/sheets/sheets-sync.service.ts` | Ekspor dua arah transaksi reservasi dan keuangan ke spreadsheet operasional secara real-time. |
| **Skill Rekonsiliasi Treatment Harian** | `.agents/skills/reconcile-daily-treatment/SKILL.md` | Skill investigasi & audit 3 arah (WhatsApp Chat, PostgreSQL Database, Google Sheets) untuk mendeteksi gap jadwal, reservasi menggantung (`confirmed` vs `completed`), dan auto-sinkronisasi data treatment harian. |
| **Google Drive Backup** | `src/integrations/google-drive/client.ts` | Penyimpanan file cadangan dump database mingguan langsung ke Google Drive klinik secara terenkripsi. |
| **Google Maps & ORS** | `src/integrations/google-maps/distance-matrix.client.ts`, `src/integrations/ors/client.ts` | Menghitung jarak jalan raya akurat via OpenRouteService API & Google Distance Matrix dengan fallback rumus Haversine. |
| **Telegram Bot Alert** | `src/services/telegram.service.ts` | Mengirimkan laporan harian, alert kesalahan sistem darurat, dan ringkasan tugas ke grup admin atau chat personal bidan. |
| **Web Push (VAPID)** | `src/services/web-push.service.ts` | Pengiriman notifikasi browser native (Web Push API) ke laptop CS dan smartphone staf saat ada chat/tugas masuk. |
| **Multi-Provider LLM Gateway** | `src/integrations/llm/llm-gateway.ts` | Gateway fleksibel yang mendukung peralihan model AI secara instan (OpenAI GPT-4o, Google Gemini, DeepSeek, Groq, OpenRouter). |

---

## 10. Pengaturan Sistem, RBAC & Keamanan

Pusat administrasi sistem di Admin Dashboard (`packages/admin-dashboard`) untuk mengontrol seluruh parameter operasional.

| Sub-Modul Admin | Endpoint / Komponen | Fitur Pengaturan Mikro |
| :--- | :--- | :--- |
| **Manajemen Pelanggan & Alamat** | `src/routes/admin/customers.subroute.ts` | Pencarian pasien, buku alamat multi-lokasi, pemblokiran nomor, override status AI (Force ON / Force OFF / Auto), dan soft-reset. |
| **Katalog Layanan & Harga** | `GET|POST|PUT|DELETE /api/admin/services` | Pengaturan master layanan klinik (kategori, target usia anak/ibu, harga dasar, durasi terapi, deskripsi SOP). Dashboard **tidak menyimpan fallback harga hardcoded** — API/DB adalah satu-satunya sumber; katalog kosong ditampilkan sebagai empty state. Runtime membaca `clinic_services` per tenant; fallback in-memory hanya untuk tenant default. |
| **Tarif Ongkir (Delivery Tiers)** | `GET|POST /api/admin/delivery-tiers` | Konfigurasi tarif ongkos kirim homecare berdasarkan zona jarak kilometer dari markas/klinik. Runtime membaca `delivery_tiers` per tenant; tenant tanpa tier ditandai belum dikonfigurasi (bukan memakai coverage tenant lain). |
| **Seed Katalog Tenant (CLI)** | `npm run seed:catalog -- --tenant=<id> [--brand=Kala] [--commit]` | Seed eksplisit 42 layanan + 7 delivery tier per tenant. Default **dry-run**; `--commit` menulis atomik (upsert layanan, replace tier). Feature flag rollback: `USE_DB_CATALOG=false`. |
| **Persona & Prompt Bidan** | `GET|POST /api/admin/persona`, `/prompt-config` | Penyesuaian nama bidan, nada bicara (empati/ramah), dan konfigurasi prompt per-tenant tanpa mengubah kode sumber. |
| **Few-Shot Exemplars** | `GET|POST|PUT|DELETE /api/admin/few-shots` | Pengelolaan contoh tanya-jawab ideal untuk memandu LLM merespons berbagai gaya bahasa pasien. |
| **Pilihan Model AI Per-Tugas** | `GET|PATCH /api/admin/ai-models` | Menentukan model LLM yang berbeda untuk masing-masing tugas (Call 1 Router, Call 2 Generator, AI Copilot, Evaluator). |
| **Scope Rollout AI** | `GET|PATCH /api/admin/ai-rollout-scope` | Pengaturan cakupan bot AI (`NEW_ONLY` untuk kontak baru saja vs `ALL` untuk seluruh pelanggan) dengan tanggal cutoff. |
| **Basis Pengetahuan (Knowledge & FAQ)** | `src/routes/admin/knowledge.subroute.ts` | Manajemen dokumen SOP klinik, chunk FAQ, dan penanganan pertanyaan customer yang belum terjawab (*unanswered questions*). |
| **Konfigurasi Pembayaran & Rekening** | `GET|PUT /api/admin/settings/payment-info` | Pengaturan nomor rekening bank klinik, nama pemilik rekening, dan upload gambar QRIS dinamis. |
| **Manajemen Staf & Hak Akses (RBAC)** | `src/routes/admin/staff-management.subroute.ts`, `src/routes/admin/roles.subroute.ts` | Pembuatan akun bidan/admin, role custom, dan penegakan izin akses endpoint data-driven via tabel `role_api_scopes`. |
| **Cadangan & Pemulihan Sistem** | `src/routes/admin/backup.subroute.ts` | Pemicu manual cadangan database (`pg_dump`), pengunduhan file backup, dan proses pemulihan (*restore*). |
| **Audit Log Sistem & Forensik LLM** | `src/routes/admin/evaluations.subroute.ts` | Inspeksi detail log eksekusi LLM, prompt yang dikirim, token usage, estimasi biaya rupiah, dan sandbox uji coba chat. |
| **Gerbang Bukti Backlog (Evidence Gate)** | `scripts/verify-backlog-evidence.mjs`, `docs/audit/2026-11-10/backlog-evidence.json`, `docs/audit/2026-11-10/legacy-fixed-baseline.json`, `.github/workflows/ci.yml` | `npm run verify:backlog` menolak status `FIXED` tanpa bukti `file:line` + test yang cocok; baseline 158 FIXED historis dibekukan dan tidak boleh tumbuh; `KNOWN` wajib justifikasi + acceptance, `DUPLICATE` wajib canonical + reason. Dijalankan di CI sebelum typecheck. |

---

## 11. Ringkasan Kuantitatif Seluruh Sistem

- **Total Endpoint API**: **297 endpoint unik (348 pasangan method+path)** (tersebar di rute Admin, Staff, Webhook, Media, Tracking, Landing, dan Health).
- **Total Model Database (Prisma Entities)**: **50 model Prisma** dan **16 enum** mencakup domain Customer, Percakapan, Reservasi, Staf, Insentif Retensi, Log Audit, Integrasi Google/Meta, dan Analitik.
- **Total Background Crons & Workers**: **24 interval cron terdaftar** untuk **25 pekerja logis** (definisi kanonis: `src/lifecycle/background-crons.ts`; Morning Jobs & Weekly Backup berbagi satu interval 15 menit), dengan interval berkala mulai dari 2 menit hingga 1 minggu. Setiap kegagalan beruntun dilaporkan sebagai status `GET /api/admin/health` (`cronHealth`) dan memicu alert `CRON_JOB_FAILED` setelah ambang `CRON_FAILURE_ALERT_THRESHOLD` (default 3).
- **Penyedia Integrasi WhatsApp**: Dual-mode terintegrasi (**WAHA container** + **Meta Cloud API resmi**).
- **Dasbor Manajemen**: 1 Single Page Application (React 18 + Vite + Tailwind CSS) yang memuat modul Kalender Jadwal, Live Chat CS, Peta Sebaran Pasien, Analitik Meta Ads, Evaluasi AI, Insentif Retensi Bidan, dan Konfigurasi Multi-Tenant.

---

## 12. Riwayat Pembaruan Fitur (Living Feature Changelog)

| Tanggal | Modul / Komponen | Perubahan / Penambahan Fitur Mikro | Referensi PR/Commit |
| :--- | :--- | :--- | :--- |
| **2026-11-12** | Google Calendar per Tenant & Idempoten (I-006) | Kalender tujuan per tenant via `Tenant.settings.googleCalendar` (`enabled`, `calendarId`; fallback `GOOGLE_CALENDAR_ID`). Event memakai ID deterministik `resv`+hex dari `reservation.id` sehingga retry/duplicate tidak membuat event ganda (409 duplicate = ambil event lama). Durasi event mengikuti `Reservation.duration_minutes` (fallback 60 menit), brand dari `getBrandIdentityAsync(tenantId)`. Semua pemanggil (dispatch confirm/set-date/cancel, series, archive, /reset) meneruskan `tenantId`. | Audit F0–F6 / W6A |
| **2026-11-12** | Endpoint Setelan Tenant (Cfg-011) | `GET|PATCH /api/admin/tenant-settings` (Super Admin only) mengelola 6 setelan yang sebelumnya hanya bisa dibaca: `clinicLocation`, `operationalHours`, `staffNotification`, `deliverySettings.estimateTtlDays`, `copilot.styleTone`, `brand`. Validasi per field (`src/config/tenant-settings.config.ts`), patch parsial aman (kunci `Tenant.settings` lain utuh), dan cache reader (klinik/jam/notifikasi/brand) langsung dibersihkan setelah simpan. **UI sub-tab dashboard belum dibuat** — dicatat di KNOWN_ISSUES. | Audit F0–F6 / W5E |
| **2026-11-12** | Integration Guard per Tenant (I-011) | Modul `src/services/integration-guard.service.ts`: kuota harian WIB per tenant+layanan (KV bersama), circuit breaker per tenant, kunci API per tenant, tombol `enabled`. Konfigurasi dari `Tenant.settings.integrationGuards` (cache 5 menit, DB offline → env tanpa batas). Dipakai ORS, Google Distance Matrix, dan Google Geocoding (text/reverse/kandidat); kuota habis/circuit OPEN → fallback lokal tanpa panggilan axios. | Audit F0–F6 / W5D |
| **2026-11-12** | Humanizer Bubble Splitter (W-010) | Deteksi form reservasi diubah dari daftar frasa hardcode menjadi **struktural** (blok baris `Label : nilai`, minimal 3 field, judul pendek di atas blok); `concludingKeywords` dan label lama "Alamat & Shareloc" dihapus. Pemisah non-standar per tenant lewat `Tenant.settings.humanizerBubble.extraSeparators` melalui `src/config/humanizer-bubble.config.ts` (cache 5 menit, DB offline → konfigurasi kosong). | Audit F0–F6 / W5C |
| **2026-11-10** | Gerbang Bukti Backlog (Fase 1) | `npm run verify:backlog` + manifest `docs/audit/2026-11-10/backlog-evidence.json` + baseline beku `legacy-fixed-baseline.json` (158). 6 item re-sertifikasi (`S-002`, `S-003`, `S-013`, `I-010`, `A-001`, `A-003`); 17 item `KNOWN → OPEN`; 4 `KNOWN` ber-justifikasi. Step CI **Backlog Evidence Gate** + 6 uji adversarial `tests/unit/backlog-evidence-gate.test.ts`. | Audit F0–F6 / #325 |
| **2026-11-09** | CAPI Zipcode & LiveChat Links | Seam kanonis `CustomerService.updateCustomerZipcodeIfEmpty` (non-destruktif, tenant-safe, fallback memori); `calculate_delivery` membawa `__internalZipcode` dari reverse geocode/gazetteer di semua jalur (teks, URL Maps, pin WhatsApp, alamat tersimpan, kandidat lokasi); CAPI memakai `raw_text` reservasi saat kolom wilayah kosong; antrean CAPI menampilkan zip hasil resolusi tanpa menulis DB saat GET; URL di bubble LiveChat & caption video menjadi tautan clickable. | Plan Zipcode & LiveChat 2026-11-09 |
| **2026-11-06** | Desktop UI & Admin Ops (7 Perbaikan) | (1) Desktop collapsible sidebar `w-20` (icon-only + tooltip + persistensi localStorage); logo header disembunyikan di desktop (`flex md:hidden`) dan digantikan tombol toggle; (2) Logout instan dengan timeout 1.500 ms pada Web Push unregister & feedback visual loading; (3) Konsolidasi tab di `CustomerService.tsx` (Generator CTA WA & Greeting Catchers CTWA) + migrasi RBAC `allow_ctwa_catchers_for_advertiser`; (4) Reklasifikasi `Settings.tsx`: Broadcast dipindah ke `META_MARKETING`, Retensi Media diekstrak ke `MediaRetentionPanel` di `APP_OPS`; (5) Filter `FollowUpQueue.tsx`: fungsi murni `buildScheduledAtRange` (WIB exact: Senin untuk `this_week`, tgl 1 untuk `this_month`) + 8 unit test, auto-switch dateFilter saat filter status riwayat, debounce 400ms search, dan tombol Reset Filter; (6) `TodayTreatments.tsx`: default scope `all` untuk admin/supervisor, pemisahan status DB `completed` vs `isOverdue` (badge kuning jam terlewat tanpa menghilang dari daftar tunggu), pembersihan refetch loop `tasks.length`, dan pembaruan modal peta (`FleetMapModal` + `DispatchMapModal`) dengan banner status GPS bidan dan tombol salin koordinat. | 7 Perbaikan Desktop UI & Operasional |
| **2026-11-06** | Quick Reply (Balasan Cepat) | Lint shareloc pada `POST/PUT /api/admin/quick-replies` dicabut: template yang menyebut `shareloc`/`shareloct`/`sharelock` dapat disimpan di kategori apa pun (alat manusia/CS, tidak pernah masuk prompt LLM). Validasi isi kosong, judul, shortcut, dan `media_type` tetap berlaku; guardrail AI (blok 7f) + detector `src/domain/shareloc-solicitation.ts` tetap aktif untuk balasan bot. | Keputusan produk 2026-11-06 |
| **2026-11-06** | Live Chat — Audit Reliabilitas (Audit #316, Fase 0–5) | (Fase 0) Listener SSE `staff.trip_delay_warning`, `staff.trip_arrived`, `sync.progress`, `bot.active_changed` (+publish backend toggle AI); kontrak error API mengekstrak `{code,message}`; kirim balasan tidak 500 pasca-terkirim (warning `MESSAGE_SENT_NOT_PERSISTED`); warning `NO_ACTIVE_RESERVATION_TODAY` tampil; gagal kirim tidak meninggalkan ghost bubble; safe-area atas mobile. (Fase 1) Gerbang anti-invoice-fiktif (blokir bila jadwal/layanan/jarak/ongkir kosong — hapus fallback 3,0 km/"Pijat Ceria"/"12.00-12.30"); persona saran AI tenant-aware + kegagalan LLM eksplisit; error/retry thread; rollback reaksi; test anti-hijau-palsu. (Fase 2) Cursor paginasi komposit `created_at|id` (anti riwayat bolong); ghost read ditutup (publish unread hanya bila DB tersinkron + flag `degraded`); badge unread direkonsiliasi dari DB; filter/pencarian tidak ter-reset oleh reload SSE; navigasi back mobile satu entri + konsumsi entri modal. (Fase 4) Modal/bottom-sheet `dvh` + scroll + safe-area; tap target label/toggle/ikon diperbesar; paste gambar dari clipboard; hover tidak menempel di HP (`hoverOnlyWhenSupported`); kontras pemisah tanggal dark; `theme-color` per skema; pencarian dalam chat tidak auto-fokus; label "Ambil Alih" dipangkas di HP. (Fase 3) Isolasi tenant: seluruh mutasi conversation/message memakai `updateMany({id, tenant_id})` + fallback memory tenant-scoped; media inbound memvalidasi tenant sesi staff, `private` cache, guard traversal; sync history memakai session WAHA per tenant (`tenants.waha_session_id`) + run-token anti-paralel; idempotensi balasan ber-TTL. (Fase 5) K-03b: gateway & typing/humanizer memakai session WAHA per tenant; pemilihan reservasi Balasan Cepat berbasis jadwal terdekat; dedupe thread berbasis ID (pesan identik beruntun tidak hilang); navigasi URL `open/close/none`; `sync-full` menghormati `started:false`; toggle Chatbot AI tersedia di menu Tools thread mobile. Logika murni diekstrak ke util + 15 test. Rincian: `docs/KNOWN_ISSUES.md` #316. | Audit Live Chat 2026-11-06 (#316) |
| **2026-11-06** | Lokasi & Shareloc (Audit #315) | Kecukupan lokasi kanonik (`src/domain/location-adequacy.ts`): `gps_pin` > `manual_staff` titik sama (150 m) > bukti lapangan (foto rumah + kunjungan + alamat) > estimasi. Badge Live Chat & prompt AI memakai kontrak `effectiveLocationSource`/`locationAdequacy`/`sharelocNeeded`; status ESTIMASI tidak lagi memerintahkan shareloc. Lint template `shareloc-solicitation` (kategori selain Pasca Booking ditolak), endpoint cooldown `PATCH /live-chat/conversations/:id/shareloc-requested`, `GET /api/staff/quick-replies`, label form "Alamat Lengkap & Patokan" (backward-compatible), dan perbaikan data Quick Reply produksi. | Audit Shareloc 2026-11-06 (#315) |
| **2026-11-08** | Ingress, Outbox & Cron (Fase 5) | Penguatan durabilitas ingress kanonis, atomic outbox claim dengan lease expiry, cron leader advisory lock PostgreSQL, sweep otomatis replay turn macet, dan sinkronisasi 23 background workers. | Audit Sistemik P0/P1 (#318) |
| **2026-11-06** | Analitik & Monitoring Iklan | Ad Funnel & Delivery Watchdog (v2 fondasional): seam tunggal `ad-funnel-metrics.service.ts` (paritas 100% dengan Meta Performance), detektor murni `ad-watchdog.service.ts` dengan 4 sinyal presedensi (`INSTRUMENTATION_SUSPECT`, `TOTAL_SILENCE`, `LOW_TRAFFIC`, `LOW_CTR`), konfigurasi per-tenant `Tenant.settings.adWatchdog` tanpa migrasi DB, cooldown & idempotency via `AdminNotificationLog`, skrip CLI seed & backtest 14 hari, serta background cron di `background-crons.ts`. | Funnel & Ad Delivery Watchdog (#317). **Status: AKTIF di produksi sejak 2026-11-06 19:06 WIB** (cron worker 30 menit; backtest 14 hari: 12 OK / 2 ALERT = 14,3%). |
| **2026-11-05** | Buku Alamat & Reservasi (Multi-Address) | Buku alamat satu sumber kebenaran: baca tabel kanonis ∪ cache JSON, dedup by identitas rumah (`normalizeAddressText`/`reconcileAddressLists`), lock per-customer, merge JSONB atomik, seam `mergeCustomerPreferences`. Reservasi: identitas teks alamat diprioritaskan, wilayah/koordinat root hanya diwarisi bila `sameHouse` (anti alamat kedua hilang/salah wilayah/tertaut primary). | Fix Buku Alamat 2026-11-05 (#311) |
| **2026-11-05** | Admin Dashboard Reservasi — Pemilih Alamat | Pemilih kartu alamat selalu muncul di "Edit Reservasi" (hidrasi kanonik saat payload ramping); pensil blok lokasi membuka Buku Alamat kartu; `PATCH /reservation/:id` memvalidasi kepemilikan kartu + menyinkronkan `delivery_fee`; `PUT /customers/:id/location` mode kartu (`customerAddressId`) menulis landmark/GPS ke kartu tanpa menimpa profil root; relink jadwal aktif per kartu. | Fix Pemilih Alamat 2026-11-05 (#312) |
| **2026-11-04** | AI Copilot (Hardening V1-V12 & F13-F14) | Hardening fondasional V1–V12 & F13: pengurutan antrean follow-up ASC, perankingan deterministik katalog layanan, kontrak waktu WIB, integritas link live-chat (validConvIds), auto-continuation E2E, deteksi staf ambigu berbasis resolusi nama + candidates, bentrok interval durasi nyata, celah slot kosong (freeSlots) data-driven (getOperationalHours & settings tenant), hitung slot dari data utuh (take 200), status bayar kanonis (paymentStatus/unpaidCustomers), SSOT finansial resmi, dan anti-duplikasi tool presisi. | Copilot Hardening V1-V12 & F13-F14 |
| **2026-11-04** | Operasional & Integrasi | Skill Rekonsiliasi Treatment Harian (`reconcile-daily-treatment`): SOP audit 3-arah menyeluruh (Chat WhatsApp WAHA/Livechat, PostgreSQL `reservations`/`children`, dan Google Sheets tab bulanan aktif) serta prosedur eksekusi aman via `reservationCoreService` & `sheetsSyncService`. | Skill Reconcile Treatment |
| **2026-11-04** | Analitik & Insentif Staf (Modul 4) | Skema Insentif Retensi Bidan 60 Hari berbasis pool 6 bulan bergulir & benchmark 34,6%: kalkulator murni domain, hysteresis tier (50/55/60), soft landing gaji #4, 5 API endpoint (`/api/admin/staff-retention/*`), UI Tab Retensi di `FinancialAnalytics.tsx`, dan gate keras penugasan bidan (Gate 6.1 & 6.5) serta log pergantian staf (`ReservationStaffAssignmentLog`). | Plan Insentif Retensi 2026-11-04 |
| **2026-11-03** | Geocoding & Alamat (Wilayah Perbatasan) | Disambiguasi centroid gazetteer di perbatasan (`GAZETTEER_BORDER_MARGIN_KM = 0.5`), write seam label overwrite guard di `updateCustomerLocation`, dan pemulihan data split-card Bunda Pamela (Grand Pakuwon Tandes). | Border Centroid Disambiguation |
| **2026-11-03** | AI Copilot (Analitik & Streaming) | Upgrade model GLM-5.3-Flash (SumoPod), timeout attempt cap 90s, budget turn 300s, heartbeat SSE 15s, visual progress UI, 3 tool dinamis baru (`query_chat_stats`, `query_revenue`, `query_followups`), dan audit biaya LLM. | Copilot Latency Plan |
| **2026-11-02** | Semua Modul (Fase 12) | Pembaruan kuantitatif hasil regenerasi kode (343 rute, 47 model Prisma, 21 workers), koreksi 20 path file, dan sinkronisasi laporan audit sistemik Fase 0–12. | Audit Fitur Sistem v2 |
| **2026-11-02** | Semua Modul | Inisiasi kompilasi inventarisasi awal sebelum audit menyeluruh. | Inisiasi dokumen |
