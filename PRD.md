# Product Requirements Document
## WhatsApp Clinic Automation Chatbot
**Versi:** 2.0  
**Status:** Fase 1 & 3 logic-complete (termasuk hardening keamanan, edge case, & integrasi multitenancy), menunggu testing manual WAHA  
**Terakhir diperbarui:** 23 Juli 2026

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
| 7 | Jika customer menunjukkan minat, bot kirim link/form reservasi | ✅ Selesai |
| 8 | Jika customer tanya ketersediaan jadwal spesifik, bot eskalasi ke human dan bot berhenti membalas otomatis untuk thread tersebut | ✅ Selesai |
| 9 | Auto-release: bot kembali aktif otomatis setelah 6 jam tanpa balasan agent, kembali ke state sebelum eskalasi | ✅ Selesai |
| 10 | Bot mensimulasikan perilaku mengetik manusia (typing indicator + delay proporsional) sebelum kirim pesan | ✅ Selesai |
| 11 | Bot bisa menjawab pertanyaan FAQ berdasarkan knowledge base (FAQ + dokumen) tanpa mengganggu alur state yang sedang berjalan | ✅ Selesai |
| 12 | Integrasi WhatsApp menggunakan WAHA (self-hosted) | ✅ Selesai |
| 13 | Pesan masuk diproses lewat antrian (sharded queue, FIFO per nomor customer, fallback in-memory jika Redis down) | ✅ Selesai |
| 14 | Sistem menghitung jarak lewat OpenRouteService (rute kendaraan asli), fallback ke Haversine kalau ORS gagal/timeout | ✅ Selesai |
| 15 | Fuzzy matching nama kelurahan (Sorensen-Dice similarity, threshold 0.80) untuk toleransi typo/variasi penulisan lokasi | ✅ Selesai |
| 16 | Penolakan input lokasi setingkat kecamatan/kota tanpa nama kelurahan (bot minta detail lebih spesifik) | ✅ Selesai |
| 17 | Deteksi kalimat afirmasi/negasi kompleks (termasuk mixed-signal seperti "iya bener tapi bukan itu") untuk konfirmasi lokasi | ✅ Selesai |
| 18 | Reset otomatis data lokasi pending (bukan yang sudah confirmed) setelah idle 24 jam tanpa respon | ✅ Selesai |
| 19 | Proteksi endpoint admin dengan ADMIN_API_KEY (fail-closed jika key tidak diset, constant-time comparison via SHA-256 + crypto.timingSafeEqual) | ✅ Selesai, security review lolos |
| 20 | Status blocked pada customer: auto-block untuk pola spam/abuse yang jelas (flood, link tak diminta, pesan identik berulang saat human handling), manual block via endpoint admin untuk kasus lain. Bot silent total (tidak membalas apapun) untuk customer blocked. Kata kasar di-flag (review manual) pakai word-boundary match, bukan auto-block | ✅ Selesai (8 test, termasuk verifikasi anti-false-positive) |
| 21 | Struktur data disiapkan untuk multi-tenant di masa depan (tenant_id di semua tabel, default single-tenant) — bukan fitur SaaS aktif, murni persiapan arsitektur | ✅ Selesai |

**Belum selesai / pending sebelum Fase 1 dianggap tuntas:**
- Testing manual end-to-end dengan WAHA aktif (koneksi QR, typing indicator nyata, share location asli, akurasi jawaban FAQ) — saat ini baru divalidasi lewat CLI Chat Simulator
- Import data FAQ & dokumen asli milik klinik (draft FAQ sudah disiapkan berdasarkan transkrip chat asli, menunggu review & import final)

#### 4.1.1 Fitur Tambahan "Fase 3" (Status: Development & Verification Selesai)

| # | Fitur | Status |
|---|---|---|
| 22 | Peredaman greeting "Halo Bunda" jika ada percakapan aktif <48 jam terakhir | ✅ Selesai — dikonfirmasi state machine tetap proses pesan normal, cuma teks pembuka yang di-skip |
| 23 | Kirim gambar pricelist otomatis (assets/pricelist_spa.jpg) saat lokasi terkonfirmasi | ⚠️ Risiko: pastikan gambar ini sinkron dengan tabel tiering ongkir 7-level terbaru di Section 9 — kalau tidak di-update bareng, bisa muncul info kontradiktif antara teks bot dan gambar |
| 24 | Deteksi lokasi dini: jika pesan pertama customer sudah mengandung alamat lengkap, langsung proses tanpa nanya lokasi lagi | ✅ Selesai — perkenalan diri tetap disertakan sebelum info ongkir (bug awal sudah diperbaiki) |
| 25 | Proteksi form reservasi: form tidak dikirim jika customer.kelurahan masih kosong | ✅ Tidak ada concern |
| 26 | Dukungan alias "bubid" sebagai sapaan ke bot | ✅ Tidak ada concern |
| 27 | Label WAHA "hold" otomatis saat eskalasi ke human + auto-resume jika label dihapus manual oleh admin | 🚩 Experimental/belum tervalidasi — WAHA belum pernah terhubung ke WhatsApp asli sama sekali, jadi fitur ini murni berdasarkan test yang di-mock. Fitur label WhatsApp biasanya bagian dari WhatsApp Business App resmi, dukungan di WAHA (unofficial) belum tentu stabil. Ini jadi jalur KEDUA untuk auto-release human handling, berdampingan dengan auto-release timeout 6 jam yang sudah ada — perlu dipastikan keduanya tidak saling konflik. Jangan andalkan fitur ini sampai tervalidasi di WhatsApp asli. |
| 28 | Filter pesan dari grup WhatsApp (@g.us) diabaikan | ✅ Tidak ada concern |

---

#### 4.2 Fase 2 — Scheduling & Follow-up Engine (Status: Didesain, belum dikerjakan)

*Catatan: Dokumen PRD lain yang mungkin di-generate sendiri oleh Antigravity BUKAN pengganti dokumen ini — dokumen ini (PRD.md) adalah satu-satunya source of truth yang di-maintain melalui proses review.*

| # | Requirement |
|---|---|
| 1 | Setelah admin konfirmasi jadwal, sistem simpan reservasi ke Google Calendar |
| 2 | Pagi hari sebelum jadwal treatment, sistem kirim reminder otomatis ke customer |
| 3 | Sehari setelah treatment, sistem kirim follow-up otomatis menanyakan review/hasil treatment |
| 4 | Skema follow-up belum purchase: jika customer belum melakukan pembelian/reservasi, follow-up otomatis dikirim di hari ke-3, ke-7, dan ke-14 sejak kontak terakhir. Follow-up berhenti jika reservasi masuk di tengah jeda |
| 5 | Skema follow-up treatment lanjutan: 1 bulan setelah treatment terakhir, sistem follow-up otomatis menawarkan treatment berikutnya. Jika tidak dibalas, follow-up ulang di bulan ke-2, lalu terakhir di bulan ke-3 |
| 6 | Jika sampai bulan ke-3 tidak ada respon/booking, customer ditandai status lost |
| 7 | Jika ada booking treatment lanjutan sebelum status lost, sistem tandai sebagai repeat_order |

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
- **Conversation:** status percakapan saat ini, apakah sedang ditangani manusia
- **Message log:** seluruh histori pesan masuk/keluar (untuk audit dan debugging)
- **Knowledge base:** kumpulan FAQ dan potongan dokumen referensi untuk menjawab pertanyaan customer
- **Reservasi & treatment (Fase 2):** jadwal, status konfirmasi, riwayat treatment, status repeat order

*Semua tabel di atas memiliki kolom `tenant_id` (default satu nilai tetap) sebagai persiapan arsitektur multi-tenant di masa depan — lihat Section 6.1.*

#### 6.1 Catatan Arsitektur: Single-Tenant Slot Pattern
Sistem ini murni single-tenant (satu bisnis, tanpa auth multi-pengguna, tanpa billing). Namun sebagai persiapan murah kalau ke depan ada rencana menjadikan ini produk SaaS multi-tenant, seluruh tabel database dan service layer sudah disiapkan dengan parameter `tenant_id` wajib (tanpa default tersembunyi di level fungsi, supaya kesalahan filtering gagal terlihat/error, bukan diam-diam salah tenant). Ini bukan fitur SaaS aktif — tidak ada dashboard, tidak ada resolusi tenant dinamis, tidak ada auth per-tenant. Kalau nanti ada demand nyata untuk SaaS, migrasinya jadi jauh lebih murah karena data layer sudah siap.

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
| LLM Engine | OpenAI-compatible API via SumoPod (akun milik pemilik bisnis) |
| Testing | Vitest (unit & integration) |
| Deployment | Docker (Dockerfile + docker-compose) |

---

### 8. Fitur Hardening & Edge Case
Selain alur inti di Section 4-5, sistem juga dilengkapi lapisan hardening berikut untuk menangani skenario percakapan dunia nyata yang lebih kompleks:
- **Fuzzy matching lokasi:** pencocokan nama kelurahan pakai similarity Sorensen-Dice (threshold 0.80) untuk toleransi typo/variasi penulisan.
- **Penolakan lokasi terlalu umum:** kalau customer cuma sebut kecamatan/kota (tanpa kelurahan), bot minta detail lebih spesifik — diuji terhadap puluhan nama kecamatan/kota di area Sidoarjo-Surabaya.
- **Deteksi afirmasi/negasi kompleks:** menangani variasi bahasa natural seperti "iya bener", "ok bos", "iya bener tapi bukan itu" (mixed-signal), termasuk mengabaikan interjeksi ("ya ampun", "ya elah") supaya tidak salah dianggap sebagai konfirmasi.
- **Reset idle 24 jam:** data lokasi yang statusnya masih pending (belum dikonfirmasi customer) otomatis direset kalau tidak ada aktivitas 24 jam; data yang sudah confirmed tidak terpengaruh.
- **Keamanan endpoint admin:** proteksi `ADMIN_API_KEY` dengan perilaku fail-closed (menolak akses kalau key tidak diset, bukan malah default terbuka).
- **Status blocked:** Keputusan final — auto-block untuk 3 trigger konservatif (flood >10 pesan/60 detik, link tak diminta di luar konteks reservasi, pesan identik berulang saat human handling), manual block via endpoint admin untuk kasus lain. Sinyal ambigu (bahasa kasar, dst) TIDAK auto-block, cukup di-flag untuk review manual admin. Bot silent total untuk customer blocked (lihat Section 4.1 poin 20).

*Fitur-fitur di atas dikerjakan di sesi kerja terpisah dengan Antigravity, bukan hasil perencanaan bersama di percakapan yang menghasilkan dokumen ini. Dicatat di sini supaya PRD tetap jadi satu sumber kebenaran yang mencerminkan kondisi kode yang sebenarnya.*

---

### 9. Aturan Bisnis Kunci
- **Kalkulasi ongkir (bersifat sementara/interim — lihat catatan di bawah) — diperbarui di Revisi 10:** jarak dihitung via rute OpenRouteService (fallback Haversine jika ORS gagal):
  
  | Jarak dari klinik | Ongkir Normal | Potongan Promo | Ongkir Promo (Net) |
  |---|---|---|---|
  | 0 – 5.0 km | Rp 0 | – | Gratis |
  | >5.0 – 7.0 km | Rp 15.000 | Rp 10.000 | Rp 5.000 |
  | >7.0 – 10.0 km | Rp 15.000 | Rp 5.000 | Rp 10.000 |
  | >10.0 – 15.0 km | Rp 15.000 | Rp 5.000 | Rp 10.000 |
  | >15.0 – 20.0 km | Rp 20.000 | Rp 5.000 | Rp 15.000 |
  | >20.0 – 25.0 km | Rp 25.000 | Rp 5.000 | Rp 20.000 |
  | >25.0 – 30.0 km | Rp 30.000 | Rp 5.000 | Rp 25.000 |
  | >30.0 km | Di luar jangkauan | – | – |

  *Titik koordinat klinik: Lat -7.34886, Lng 112.751677.*  
  *Catatan penting: Meski tiering di atas sudah lebih detail, logic ongkir ini tetap berstatus sementara untuk Fase 1. Ke depan akan ada UI/sistem terpisah untuk menghitung ongkir (kemungkinan terintegrasi dengan layanan pengiriman pihak ketiga atau input manual admin), yang akan menggantikan formula ini. Karena itu, `delivery.service.ts` harus tetap diperlakukan sebagai modul yang mudah diganti (isolated, tidak di-hardcode ke banyak tempat lain di codebase) — supaya saat sistem ongkir baru siap, penggantiannya cukup di satu titik integrasi.*
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
- Fuzzy matching kelurahan (Sorensen-Dice, threshold 0.80) berisiko salah cocokkan nama kelurahan yang mirip tapi berbeda (misal dua kelurahan dengan nama hampir sama di kecamatan berbeda) — kalau ini terjadi, ongkir dan penentuan area jadi salah tanpa customer maupun admin sadar. Perlu dipantau di awal produksi apakah threshold 0.80 ini menghasilkan false-positive match yang mengganggu.
- Reset idle 24 jam hanya berlaku untuk data lokasi pending (belum dikonfirmasi), bukan data yang sudah confirmed — pastikan pemahaman ini konsisten kalau ada perubahan logic ke depan, supaya tidak keliru menghapus data lokasi yang sudah valid.

---

### 11. Kriteria Selesai (Definition of Done) Fase 1
**Status saat ini:** Logic-complete, belum production-ready. Semua logic bisnis sudah tervalidasi lewat CLI Chat Simulator, tapi integrasi WhatsApp asli (WAHA) belum pernah diuji langsung.

**Sudah tervalidasi (via CLI Chat Simulator & unit test):**
- [x] State machine, retry counter, kalkulasi ongkir, parser reservasi — seluruhnya lolos unit test & CLI simulation
- [x] `persona.ts` terisi dengan gaya bahasa final (template dari transkrip asli + draft follow-up belum-purchase)
- [x] ORS integration + fallback Haversine dicek berjalan normal

**Belum tervalidasi — WAJIB dicek di WhatsApp asli sebelum go-live:**
- [ ] Koneksi WAHA stabil, QR ter-scan, session aktif
- [ ] Payload webhook WAHA beneran cocok dengan yang di-assume di kode (bukan cuma di test yang di-mock)
- [ ] Typing indicator terbukti muncul di WhatsApp asli, jeda antar-bubble kelihatan natural
- [ ] Share location asli (native WA) berhasil ditangkap dan dikonversi ke ongkir yang benar
- [ ] Kirim beberapa pesan cepat berturut-turut dari satu nomor, pastikan queue memproses berurutan tanpa balasan tumpang tindih
- [ ] Minimal satu pertanyaan FAQ asli dari data klinik terjawab dengan akurat
- [ ] FAQ & dokumen asli klinik (bukan dummy) sudah diimport
