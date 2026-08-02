# Product Requirements Document
## WhatsApp Clinic Automation Chatbot
**Versi:** 2.3  
**Status:** Fase 1, Fase 2 & AI Router Engine Production-Ready (536 unit & integration tests PASS 100%)  
**Terakhir diperbarui:** 2 Agustus 2026

---

### 1. Latar Belakang & Masalah
Bisnis klinik treatment saat ini menangani percakapan calon customer secara manual di WhatsApp — mulai dari sapaan awal, penentuan lokasi customer, kalkulasi ongkir, sampai follow-up pasca treatment. Proses manual ini punya beberapa masalah:
- Waktu respon lambat di luar jam kerja
- Follow-up pasca treatment (review, ajakan booking ulang) sering terlewat karena mengandalkan ingatan admin
- Tidak ada sistem terstruktur untuk tracking customer yang "hilang" (belum purchase, belum booking treatment lanjutan)
- Kalkulasi ongkir manual rawan human error

---

### 2. Tujuan Produk
- Mengotomasi percakapan awal customer (sapaan → lokasi → ongkir → reservasi) tanpa kehilangan sentuhan personal
- Memastikan tidak ada follow-up yang terlewat lewat sistem terjadwal otomatis
- Menjaga keputusan yang butuh judgment manusia (konfirmasi jadwal, approval reservasi) tetap di tangan admin/agent
- Menyediakan jawaban FAQ otomatis yang konsisten tanpa membebani admin untuk pertanyaan repetitif

---

### 3. Target Pengguna
- **Primary user:** Calon customer / customer existing klinik yang chat via WhatsApp
- **Internal user:** Admin/pemilik klinik yang mengelola konfirmasi reservasi dan menangani pertanyaan jadwal spesifik

---

### 4. Ruang Lingkup

#### 4.1 Fase 1 — Conversation Engine (Status: Development selesai, menunggu testing manual)

| # | Requirement | Status |
|---|---|---|
| 1 | Bot membalas sapaan otomatis saat ada pesan pertama dari nomor baru | ✅ Selesai |
| 2 | Bot menanyakan lokasi customer | ✅ Selesai |
| 3 | Jika lokasi tidak lengkap (misal hanya "Surabaya"), bot minta detail desa/kelurahan | ✅ Selesai |
| 4 | Jika lokasi tidak bisa di-resolve setelah 3x percobaan, eskalasi ke human | ✅ Selesai |
| 5 | Bot menangkap koordinat dari share location native WhatsApp | ✅ Selesai |
| 6 | Sistem menghitung ongkir berdasarkan jarak (Haversine) dari titik klinik | ✅ Selesai |
| 7 | Jika customer menunjukkan minat, bot minta customer isi detail reservasi via teks langsung di chat (bukan link/form eksternal — diubah untuk menjaga kenyamanan interaksi alami di WhatsApp) | ✅ Selesai |
| 8 | Jika customer tanya ketersediaan jadwal spesifik, bot eskalasi ke human dan bot berhenti membalas otomatis untuk thread tersebut | ✅ Selesai |
| 9 | Auto-release: bot kembali aktif otomatis setelah 6 jam tanpa balasan agent, kembali ke state sebelum eskalasi | ✅ Selesai |
| 10 | Bot mensimulasikan perilaku mengetik manusia (typing indicator + delay proporsional) sebelum kirim pesan | ✅ Selesai |
| 11 | Bot bisa menjawab pertanyaan FAQ berdasarkan knowledge base (FAQ + dokumen) tanpa mengganggu alur state yang sedang berjalan | ✅ Selesai |
| 12 | Integrasi WhatsApp menggunakan WAHA (self-hosted) | ✅ Selesai |
| 13 | Pesan masuk diproses lewat antrian (sharded queue, FIFO per nomor customer, fallback in-memory jika Redis down) | ✅ Selesai |
| 14 | Sistem menghitung jarak lewat OpenRouteService (rute kendaraan asli), fallback ke Haversine kalau ORS gagal/timeout | ✅ Selesai |
| 15 | Fuzzy matching nama lokasi berbasis n-gram Candidate Spans & Gazetteer (Sorensen-Dice similarity dengan dual threshold: 0.75 untuk kelurahan, 0.82 untuk kecamatan) untuk toleransi typo/variasi kalimat alami | ✅ Selesai |
| 16 | Penolakan input lokasi setingkat kecamatan/kota tanpa nama kelurahan (bot minta detail lebih spesifik) | ✅ Selesai |
| 17 | Deteksi kalimat afirmasi/negasi kompleks (termasuk mixed-signal seperti "iya bener tapi bukan itu") untuk konfirmasi lokasi | ✅ Selesai |
| 18 | Reset otomatis data lokasi pending (bukan yang sudah confirmed) setelah idle 24 jam tanpa respon | ✅ Selesai |
| 19 | Proteksi endpoint admin dengan ADMIN_API_KEY (fail-closed jika key tidak diset, constant-time comparison via SHA-256 + crypto.timingSafeEqual) | ✅ Selesai, security review lolos |
| 20 | Status blocked pada customer: auto-block untuk pola spam/abuse yang jelas (flood, link tak diminta, pesan identik berulang saat human handling), manual block via endpoint admin untuk kasus lain. Bot silent total (tidak membalas apapun) untuk customer blocked. Kata kasar di-flag (review manual) pakai word-boundary match, bukan auto-block | ✅ Selesai (8 test, termasuk verifikasi anti-false-positive) |
| 21 | Struktur data disiapkan untuk multi-tenant di masa depan (tenant_id di semua tabel, default single-tenant) — bukan fitur SaaS aktif, murni persiapan arsitektur | ✅ Selesai |
| 22 | LLM Fallback untuk geocoding: resolved lokasi via DeepSeek V4 Flash saat gazetteer gagal (typo, dusun/RT, nama tidak umum), cross-check ke gazetteer untuk koordinat exact | ✅ Selesai |
| 23 | FAQ dijawab saat customer masih di state AWAITING_LOCATION: pertanyaan non-lokasi (FAQ/harga) dijawab via knowledge base + katalog treatment, state lokasi tidak terganggu | ✅ Selesai |
| 24 | Form reservasi pre-filled: field kecamatan, kota, dan nomor HP customer terisi otomatis (data sudah diketahui bot) supaya customer tinggal isi sisanya | ✅ Selesai |
| 25 | Simpan nama kontak customer setelah submit form reservasi sebagai "Bunda {nama} {kecamatan}" (contoh: "Bunda Sari Waru") | ✅ Selesai |

**Belum selesai / pending sebelum Fase 1 dianggap tuntas:**
- Testing manual end-to-end dengan WAHA aktif (koneksi QR, typing indicator nyata, share location asli, akurasi jawaban FAQ) — saat ini baru divalidasi lewat CLI Chat Simulator
- Import data FAQ & dokumen asli milik klinik (draft FAQ sudah disiapkan berdasarkan transkrip chat asli, menunggu review & import final)
- Kelurahan tertentu tidak ada di gazetteer (misal "Mulyosari" di Kec. Sedati) — LLM fallback bisa resolve namanya tapi cross-check koordinat gagal; perlu koordinat dari pemilik bisnis untuk ditambahkan ke `surabaya_sidoarjo_subdistricts.json`

#### 4.1.1 Fitur Tambahan "Fase 3" (dikerjakan di sesi terpisah — status: perlu klarifikasi sebelum dianggap selesai)

| # | Fitur | Status |
|---|---|---|
| 22 | Peredaman greeting "Halo Bunda" kalau ada percakapan aktif <48 jam terakhir | ✅ Selesai — dikonfirmasi state machine tetap proses pesan normal, cuma teks pembuka yang di-skip |
| 23 | Kirim gambar pricelist otomatis (assets/pricelist_spa.jpg) saat lokasi terkonfirmasi | ✅ Selesai — sudah diuji manual oleh pemilik bisnis. ⚠️ Risiko: pastikan gambar ini sinkron dengan tabel tiering ongkir 7-level terbaru di Section 9 |
| 24 | Deteksi lokasi dini: kalau pesan pertama customer sudah mengandung alamat lengkap, langsung proses tanpa nanya lokasi lagi | ✅ Selesai — perkenalan diri tetap disertakan sebelum info ongkir (bug awal sudah diperbaiki) |
| 25 | Proteksi form reservasi: form tidak dikirim kalau customer.kelurahan masih kosong | ✅ Selesai |
| 26 | Dukungan alias "bubid" sebagai sapaan ke bot | ✅ Selesai |
| 27 | Label WAHA "hold" otomatis saat eskalasi ke human + auto-resume kalau label dihapus manual oleh admin | 🚩 Experimental/belum tervalidasi — WAHA belum pernah terhubung ke WhatsApp asli sama sekali, jadi fitur ini murni berdasarkan test yang di-mock. Fitur label WhatsApp biasanya bagian dari WhatsApp Business App resmi, dukungan di WAHA (unofficial) belum tentu stabil. Ini jadi jalur KEDUA untuk auto-release human handling, berdampingan dengan auto-release timeout 6 jam yang sudah ada — perlu dipastikan keduanya tidak saling konflik. Jangan andalkan fitur ini sampai tervalidasi di WhatsApp asli. |
| 28 | Filter pesan dari grup WhatsApp (@g.us) diabaikan | ✅ Selesai |
| 29 | Auto-save chat masuk baru ke Google Contacts via Google People API | ⚠️ Dinonaktifkan sementara secara default di .env. Dikonfirmasi ini permintaan eksplisit dari pemilik bisnis. Perlu dipastikan sebelum diaktifkan: OAuth credential Google disimpan aman, dan pemilik bisnis sadar ini menulis data customer (nomor HP, kemungkinan nama) ke akun Google pribadi/bisnis miliknya — lihat catatan privasi di Section 10 |
| 30 | Medical concern: alert dikirim HANYA ke admin (Telegram/emergency log), chat customer DIAM TOTAL. Bidan/CS yang menggali lebih dalam dan menyarankan secara manual. Approved medical FAQ tetap bisa dijawab bot | ✅ Selesai — alert admin-only, tanpa template darurat yang dikirim ke customer (customer tidak di-shock) |

#### 4.1.2 Fase 4 — AI Router Engine & System Observability (Status: Selesai & Tervalidasi)

| # | Fitur / Requirement | Status |
|---|---|---|
| 31 | AI Router Engine (LLM Intent Classifier): 11 intent taxonomy, Zod schema validation dengan 1x retry hint, circuit breaker (5 failure threshold / 60s cooldown), rule-based fallback deterministik | ✅ Selesai (50 skenario test plan PASS 100%) |
| 32 | Shadow Mode (`AI_ROUTER_SHADOW_MODE=true`): membaca pesan customer, menebak intent, membandingkan dengan keputusan legacy pipeline, dan mencatat ke tabel `ai_router_evaluations` TANPA mengubah keputusan bot produksi | ✅ Selesai |
| 33 | Eskalasi UNKNOWN Berulang: jika pesan customer 2x berturut-turut diklasifikasikan `UNKNOWN` dalam 1 thread (saat full-mode `SHADOW_MODE=false`), otomatis eskalasi ke human handling (`escalation_reason=UNKNOWN_REPEATED`), bot silent total | ✅ Selesai |
| 34 | Script Evaluasi Akurasi Shadow Mode (`src/scripts/check-router-accuracy.ts --days=7`): kalkulasi intent match rate, escalation match rate, UNMAPPED rate, dan list mismatch `MEDICAL_CONCERN`. Mengharuskan 3 gate lolos sebelum mematikan shadow mode | ✅ Selesai |
| 35 | Dashboard UI System Debug (`/admin/debug` & REST API `/api/admin/debug/*`): 5 tab observability (System Overview, AI Router, Log Buffer in-memory, Message Trace, Conversation Trace) untuk maintenance & tracing read-only | ✅ Selesai |
| 36 | Penyelarasan Keyword Medis (`ruam`, `eksim`, `alergi susu`): penambahan ke `MEDIUM_SEVERITY_MEDICAL_KEYWORDS` sebagai single source of truth antara detector medis dan router | ✅ Selesai |

---

#### 4.2 Fase 2 — Scheduling & Follow-up Engine (Status: Selesai & Tervalidasi)

| # | Requirement | Status |
|---|---|---|
| 1 | Setelah admin konfirmasi jadwal, sistem simpan reservasi ke Google Calendar | ✅ Selesai |
| 2 | Pagi hari sebelum jadwal treatment, sistem kirim reminder otomatis ke customer | ✅ Selesai (Cron 06:00 WIB) |
| 3 | Sehari setelah treatment, sistem kirim follow-up otomatis menanyakan review/hasil treatment | ✅ Selesai (Cron H+1 07:00 WIB) |
| 4 | Skema follow-up belum purchase: jika customer belum melakukan pembelian/reservasi, follow-up otomatis dikirim di hari ke-3, ke-7, dan ke-14 sejak kontak terakhir. Follow-up berhenti jika reservasi masuk di tengah jeda | ✅ Selesai (Auto-cancel & repeat_order flag) |
| 5 | Skema follow-up treatment lanjutan: 1 bulan setelah treatment terakhir, sistem follow-up otomatis menawarkan treatment berikutnya. Jika tidak dibalas, follow-up ulang di bulan ke-2, lalu terakhir di bulan ke-3 | ✅ Selesai (Next Treatment +1, +2, +3 bulan) |
| 6 | Jika sampai bulan ke-3 tidak ada respon/booking, customer ditandai status lost | ✅ Selesai (Grace period 3 hari) |
| 7 | Jika ada booking treatment lanjutan sebelum status lost, sistem tandai sebagai repeat_order | ✅ Selesai |
| 8 | Engine rolling template 3 variasi per stage untuk mencegah deteksi bot/spam WA | ✅ Selesai |
| 9 | Dashboard UI Follow-Up Queue (`/admin/follow-ups`) dengan filter, pencarian, dan kontrol admin (Kirim Sekarang, Reschedule, Cancel) | ✅ Selesai |

#### 4.3 Di Luar Scope (untuk saat ini)
- Dashboard admin dengan UI visual (saat ini cukup REST endpoint)
- Pembayaran online / payment gateway
- Multi-cabang klinik (asumsi saat ini: satu titik lokasi klinik)
- Vector/embedding search untuk knowledge base (dimulai dari full-text search sederhana; upgrade jika volume FAQ bertambah signifikan atau akurasi retrieval terbukti kurang)

---

### 5. Alur Percakapan Utama (Ringkasan)
Customer chat pertama kali  
  → Bot sapa + tanya lokasi  
  → Lokasi lengkap?   
      Tidak → minta detail kelurahan/desa (maks 3x percobaan, lalu eskalasi)  
      Ya (teks lengkap / share location) → lanjut  
  → Hitung jarak & ongkir, informasikan ke customer  
  → Customer tertarik?  
      Ya → kirim form reservasi  
      Tanya jadwal spesifik → eskalasi ke human, bot senyap untuk thread ini  
      Tanya hal lain (FAQ) → jawab pakai knowledge base, lanjutkan state semula  
  → Form terisi → admin konfirmasi manual → simpan ke Google Calendar (Fase 2)

---

### 6. Data yang Disimpan
- **Customer:** nomor telepon, nama, lokasi (kelurahan/kecamatan/kota, koordinat), jarak & ongkir terhitung, status keanggotaan (termasuk placeholder status blocked)
- **Conversation:** status percakapan saat ini, apakah sedang ditangani manusia, counter `consecutive_unknown_count` (untuk eskalasi UNKNOWN berulang)
- **Message log:** seluruh histori pesan masuk/keluar (untuk audit dan debugging)
- **Knowledge base:** kumpulan FAQ dan potongan dokumen referensi untuk menjawab pertanyaan customer
- **Reservasi & treatment (Fase 2):** jadwal, status konfirmasi, riwayat treatment, status repeat order
- **AiRouterEvaluation (Fase 4):** log evaluasi shadow/full mode per pesan (`customer_phone`, `message_text`, `current_state`, `llm_intent`, `llm_confidence`, `llm_used_fallback`, `legacy_intent`, `legacy_escalated`, `intent_match`, `escalation_match`, `mismatch_notes`, `response_time_ms`)

*Semua tabel di atas memiliki kolom `tenant_id` (default satu nilai tetap) sebagai persiapan arsitektur multi-tenant di masa depan — lihat Section 6.1*

#### 6.1 Catatan Arsitektur: Single-Tenant Slot Pattern
Sistem ini murni single-tenant (satu bisnis, tanpa auth multi-pengguna, tanpa billing). Namun sebagai persiapan murah kalau ke depan ada rencana menjadikan ini produk SaaS multi-tenant, seluruh tabel database dan service layer sudah disiapkan dengan parameter tenant_id wajib (tanpa default tersembunyi di level fungsi, supaya kesalahan filtering gagal terlihat/error, bukan diam-diam salah tenant). Ini bukan fitur SaaS aktif — tidak ada dashboard, tidak ada resolusi tenant dinamis, tidak ada auth per-tenant. Kalau nanti ada demand nyata untuk SaaS, migrasinya jadi jauh lebih murah karena data layer sudah siap.

---

### 7. Tech Stack
| Layer | Teknologi |
|---|---|
| Runtime & Bahasa | Node.js (v20+) + TypeScript |
| Web Framework | Fastify |
| Database & ORM | PostgreSQL + Prisma ORM |
| Full-Text Search | Postgres native (`to_tsvector('simple', ...)`) untuk knowledge base |
| Message Queue | BullMQ + Redis (sharded FIFO per nomor customer), fallback in-memory kalau Redis down |
| Integrasi WhatsApp | WAHA (WhatsApp HTTP API, self-hosted) |
| Geocoding | Google Maps Geocoding API |
| Perhitungan Jarak/Rute | OpenRouteService Directions API, fallback formula Haversine |
| LLM Engine | OpenAI-compatible API via SumoPod (MiniMax-M2.7-highspeed / DeepSeek V4 Flash) |
| AI Router Engine | Klasifikasi 11-intent terstruktur + Circuit Breaker (5 error / 60s cooldown) + Zod retry-once |
| System Observability | Dashboard UI Debug (`/admin/debug`), Log Buffer in-memory (500 entri), Script akurasi (`check-router-accuracy.ts`) |
| Admin Dashboard UI | React 18 + Tailwind CSS + Lucide Icons + Vite (Single-Page Application di `/admin/*`) |
| Testing | Vitest (unit & integration) |
| Deployment | Docker (Dockerfile + docker-compose) |

---

### 8. Fitur Hardening & Edge Case
Selain alur inti di Section 4-5, sistem juga dilengkapi lapisan hardening berikut untuk menangani skenario percakapan dunia nyata yang lebih kompleks:
- **Fuzzy matching lokasi:** pencocokan nama lokasi berbasis n-gram Candidate Spans & Gazetteer (Sorensen-Dice similarity dengan dual threshold: 0.75 untuk kelurahan, 0.82 untuk kecamatan) untuk toleransi typo/variasi kalimat alami, disaring menggunakan stop-words percakapan Indonesia untuk mencegah adjacency palsu.
- **Penolakan lokasi terlalu umum:** kalau customer cuma sebut kecamatan/kota (tanpa kelurahan), bot minta detail lebih spesifik — diuji terhadap puluhan nama kecamatan/kota di area Sidoarjo-Surabaya.
- **Deteksi afirmasi/negasi kompleks:** menangani variasi bahasa natural seperti "iya bener", "ok bos", "iya bener tapi bukan itu" (mixed-signal), termasuk mengabaikan interjeksi ("ya ampun", "ya elah") supaya tidak salah dianggap sebagai konfirmasi.
- **Reset idle 24 jam:** data lokasi yang statusnya masih pending (belum dikonfirmasi customer) otomatis direset kalau tidak ada aktivitas 24 jam; data yang sudah confirmed tidak terpengaruh.
- **Keamanan endpoint admin:** proteksi ADMIN_API_KEY dengan perilaku fail-closed (menolak akses kalau key tidak diset, bukan malah default terbuka).
- **Status blocked:** Keputusan final — auto-block untuk 3 trigger konservatif (flood >10 pesan/60 detik, link tak diminta di luar konteks reservasi, pesan identik berulang saat human handling), manual block via endpoint admin untuk kasus lain. Sinyal ambigu (bahasa kasar, dst) TIDAK auto-block, cukup di-flag untuk review manual admin. Bot silent total untuk customer blocked (lihat Section 4.1 poin 20).
- **Medical escalation admin-only:** Deteksi keyword medis (HIGH/MEDIUM) hanya mengirim alert ke admin (Telegram/emergency log) dan mengeskalasi ke human handling. Chat customer DIAM TOTAL — tidak ada template "bawa ke IGD" yang dikirim, supaya customer tidak shock dan tidak ada penilaian darurat prematur (keyword bisa false-positive karena customer cenderung hiperbola). Bidan/CS yang menggali lebih dalam dan menyarankan secara manual. Approved medical FAQ tetap dijawab bot.
- **FAQ saat state lokasi:** pertanyaan non-lokasi (FAQ/harga) yang masuk saat customer masih di alur menentukan lokasi dijawab via knowledge base + katalog treatment, dan state lokasi tidak terganggu (STATE PUNYA PRIORITAS — jawab sela, lalu tetap minta lokasi).
- **Prefill form reservasi:** saat bot mengirim form reservasi, field kecamatan, kota, dan nomor HP terisi otomatis dari data customer yang sudah diketahui — memudahkan customer mengisi sisa form.

*Fitur-fitur di atas dikerjakan di sesi kerja terpisah dengan Antigravity, bukan hasil perencanaan bersama di percakapan yang menghasilkan dokumen ini. Dicatat di sini supaya PRD tetap jadi satu sumber kebenaran yang mencerminkan kondisi kode yang sebenarnya.*

---

### 9. Aturan Bisnis Kunci
- **Kalkulasi ongkir (bersifat sementara/interim — lihat catatan di bawah) — diperbarui di Revisi 10:** jarak dihitung via rute OpenRouteService (fallback Haversine jika ORS gagal):
  
  | Jarak dari klinik | Ongkir Normal | Potongan Promo | Ongkir Promo (Net) |
  |---|---|---|---|
  | 0 – 5.0 km | Rp 0 | – | Gratis |
  | >5.0 – 7.0 km | Rp 15.000 | Rp 10.000 | Rp 5.000 |
  | >7.0 – 10.0 km | Rp 15.000 | Rp 5.000 | Rp 10.000 |
  | >10.0 – 15.0 km | Rp 25.000 | Rp 10.000 | Rp 15.000 |
  | >15.0 – 20.0 km | Rp 25.000 | Rp 5.000 | Rp 20.000 |
  | >20.0 – 25.0 km | Rp 35.000 | Rp 10.000 | Rp 25.000 |
  | >25.0 – 30.0 km | Rp 35.000 | Rp 5.000 | Rp 30.000 |
  | >30.0 km | Di luar jangkauan | – | – |

  *Titik koordinat klinik: Lat -7.34886, Lng 112.751677.*  
  *Catatan: Tiering ini dikelola dinamis dari Admin UI (Delivery Fee → delivery_tiers_custom.json) dan menjadi source of truth runtime. Tabel di atas adalah snapshot terakhir yang diset pemilik bisnis.*
- **Follow-up belum purchase:** hari ke-3, ke-7, ke-14 sejak kontak terakhir tanpa transaksi.
- **Follow-up treatment lanjutan:** bulan ke-1, ke-2, ke-3 sejak treatment terakhir; jika tidak ada respon sampai bulan ke-3 → status lost.

---

### 10. Batasan & Risiko yang Diketahui
- WAHA bersifat unofficial (bukan API resmi Meta) — berisiko session terputus sewaktu-waktu dan perlu monitoring/reconnect manual.
- Full-text search knowledge base mengandalkan kecocokan kata, bukan makna — pertanyaan yang disusun terlalu berbeda dari kata kunci FAQ berisiko tidak ketemu jawaban yang relevan.
- Auto-release human handling murni berbasis waktu (6 jam) — sistem tidak tahu jika admin sudah membalas manual langsung dari HP di luar sistem.
- Semua follow-up otomatis di Fase 2 perlu mekanisme berhenti otomatis begitu ada transaksi baru, supaya tidak mengirim pesan yang sudah tidak relevan.
- In-Memory Queue fallback aktif otomatis di production kalau Redis down — bot tetap jalan, tapi pesan yang sedang diantri di memory tidak persisten; kalau server restart di tengah kondisi ini, pesan bisa hilang. Ada critical alert log kalau ini terjadi, tapi belum ada mekanisme replay/recovery otomatis.
- ADMIN_API_KEY belum melalui security review independen — implementasi (fail-closed behavior, constant-time comparison, coverage proteksi di semua endpoint admin) dibangun di sesi terpisah dan belum diverifikasi ulang. Wajib direview sebelum endpoint admin diakses dari luar jaringan lokal/trusted.
- Status customer blocked masih placeholder — kolom dan bypass logic-nya sudah ada di kode, tapi mekanisme bisnis (siapa yang berwenang block, lewat endpoint mana, kriteria apa) belum ditentukan. Jangan mengandalkan fitur ini sampai keputusan bisnisnya jelas dan endpoint untuk mengelolanya dibangun.
- Fuzzy matching lokasi (Candidate Spans & Gazetteer, dual threshold: 0.75 kelurahan, 0.82 kecamatan) berisiko salah cocokkan nama kelurahan yang mirip tapi berbeda (misal dua kelurahan dengan nama hampir sama di kecamatan berbeda) — kalau ini terjadi, ongkir dan penentuan area jadi salah tanpa customer maupun admin sadar. Perlu dipantau di awal produksi apakah threshold ini menghasilkan false-positive match yang mengganggu.
- Reset idle 24 jam hanya berlaku untuk data lokasi pending (belum dikonfirmasi), bukan data yang sudah confirmed — pastikan pemahaman ini konsisten kalau ada perubahan logic ke depan, supaya tidak keliru menghapus data lokasi yang sudah valid.
- Auto-save Google Contacts (fitur 29) masih nonaktif secara default — sebelum diaktifkan, pastikan OAuth credential Google disimpan sebagai secret (bukan plaintext di repo), dan pertimbangkan implikasi privasi: data kontak customer (nomor HP, nama) akan tersimpan permanen di akun Google pribadi/bisnis pemilik, di luar kendali sistem database utama. Kalau nanti bisnis ini di-handover atau akun Google berganti, data ini perlu ditangani terpisah dari migrasi database.

---

### 11. Kriteria Selesai (Definition of Done) Fase 1
**Status saat ini:** Production-ready — testing manual WAHA dikonfirmasi sudah dilakukan dengan nomor asli.

**Sudah tervalidasi:**
- [x] State machine, retry counter, kalkulasi ongkir, parser reservasi — seluruhnya lolos unit test & CLI simulation
- [x] `persona.ts` terisi dengan gaya bahasa final (template dari transkrip asli + draft follow-up belum-purchase)
- [x] ORS integration + fallback Haversine dicek berjalan normal
- [x] Koneksi WAHA stabil, QR ter-scan, session aktif (dikonfirmasi dengan nomor asli)
- [x] Payload webhook WAHA tervalidasi, termasuk penanganan JID `@lid` vs `@c.us`
- [x] Typing indicator terbukti muncul di WhatsApp asli
- [x] Share location asli (native WA) berhasil ditangkap dan dikonversi ke ongkir
- [x] Sistem antrian (sharded queue) & idempotensi terbukti mencegah balasan tumpang tindih/retry duplikat
- [x] FAQ & dokumen asli klinik sudah diimport (30 FAQ ter-seeding)
- [x] LLM fallback geocoding (DeepSeek V4 Flash) — resolve lokasi typo/dusun saat gazetteer gagal, cross-check koordinat
- [x] FAQ dijawab di state AWAITING_LOCATION tanpa mengganggu alur lokasi
- [x] Form reservasi pre-filled (kecamatan, kota, nomor HP) + simpan nama kontak "Bunda {nama} {kecamatan}"
- [x] Medical escalation admin-only (chat customer diam total, alert ke admin)
- [x] AI Router 11-intent classifier & circuit breaker tervalidasi via unit test (50 skenario test plan PASS 100%)
- [x] Tabel `ai_router_evaluations` & migration `20260803000000_add_ai_router_evaluations` ter-deploy ke DB (zero-drift terverifikasi)
- [x] Script `check-router-accuracy.ts` tervalidasi lawan Postgres asli
- [x] UNKNOWN-repeated escalation (2x → HUMAN_HANDLING) terintegrasi di state machine
- [x] Dashboard UI System Debug (`/admin/debug`) & 5 endpoint read-only `/api/admin/debug/*` aktif & ter-build ke production bundle
- [x] 536 unit & integration test PASS 100% (47 test files) — termasuk 107 test AI Router Engine, 7 E2E chat-to-reservation scenarios, 28 treatment question tests, 52 kecamatan rejection tests, 3 medical silent escalation tests, 11 system debug tests

**Catatan status yang masih perlu dipantau berkelanjutan (bukan blocker, tapi bukan berarti "selesai selamanya"):**
- Fitur label WAHA "hold" (poin 27) — tetap experimental sampai ada periode pemakaian nyata yang cukup panjang untuk memastikan tidak konflik dengan auto-release 6 jam
- Fuzzy matching kelurahan & threshold Sorensen-Dice — pantau di minggu-minggu awal produksi apakah ada false-positive match
- Auto-save Google Contacts (poin 29) — tetap nonaktif sampai OAuth credential disiapkan dengan aman
- Kelurahan yang belum ada di gazetteer (misal Mulyosari, Sedati) — LLM resolve nama tapi cross-check koordinat gagal; butuh koordinat dari pemilik bisnis
- Gambar pricelist (poin 23) — pastikan angka di gambar sinkron dengan tiering ongkir Section 9 saat ada perubahan tarif
