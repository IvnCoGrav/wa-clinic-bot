# Buku Panduan Operasional Admin: Manajemen Reservasi & Sistem Klinik

> **Status Dokumen:** Panduan Operasional (SOP Admin & acuan seed Knowledge Base AI Copilot)
> **Versi:** 1.1 (Oktober 2026) — Revisi audit kesesuaian kode/DB
> **Target:** Admin CS, Supervisor Klinik, Bidan Koordinator, dan Hermes Agent (AI Copilot)
> **Sumber kebenaran runtime:** PostgreSQL/Prisma (`Reservation`, `ReservationSeries`, `ClinicPolicy`, `Tenant`, `delivery_tiers`, `clinic_services`). Angka di dokumen ini adalah **nilai default tenant `default-tenant`** saat audit; bila admin mengubah config per-tenant di dashboard/DB, nilai DB yang berlaku.

Perubahan dari v1.0: koreksi 7 selisih hasil audit kode (`src/domain/reservation-status.ts`, `src/services/cron.service.ts`, `src/services/staff-notification.service.ts`, `src/services/copilot/copilot-tools.ts`, `prisma/schema.prisma`). Detail: `CHANGELOG.md` 2026-10-03 dan `docs/KNOWN_ISSUES.md` #190/#191/#198.

---

## Daftar Isi

1. Pendahuluan: Filosofi Sistem & Pembagian Peran
2. Anatomi & Siklus Hidup Reservasi
3. Panduan Langkah-demi-Langkah Pengoperasian Reservasi
4. Navigasi Halaman Reservasi: Tabel vs Kalender
5. Integrasi AI Copilot (Hermes Agent) untuk Admin
6. Aturan Emas Klinis & Batasan Operasional
7. Modul Knowledge Ingestion untuk Hermes Agent (spesifikasi seed DB)
8. Batasan Diketahui & Tech Debt (wajib dibaca sebelum klaim "resmi")

---

## 1. Pendahuluan: Filosofi Sistem & Pembagian Peran

Prinsip: **"AI Membantu, Manusia Memutuskan".**

```
+---------------------+         +---------------------+         +---------------------+
|   Pasien WhatsApp   | <=====> |   AI Bot (Bidan)    | <=====> |   Admin Dashboard   |
|   (Bunda / Ayah)    |         | (Otomasi 24/7, RAG) |         |  (Human-in-the-Loop)|
+---------------------+         +---------------------+         +---------------------+
```

- **AI Bot WhatsApp (Bidan):** menjawab konsultasi awal ibu & bayi dengan empati dan batasan SOP medis, menghitung estimasi ongkir dari tier/DB, merekam minat jadwal, membuat reservasi otomatis **hanya saat ada kesepakatan final**, mengalihkan ke admin (`HUMAN_HANDLING`) bila sensitif.
- **Admin CS / Supervisor:** memvalidasi slot nyata, verifikasi alamat, tugaskan terapis/bidan, kelola pembayaran & konfirmasi akhir, takeover Live Chat saat sensitif/negosiasi.
- **Hermes Agent (AI Copilot):** asisten internal di dashboard untuk rekap jadwal, chat menggantung, prospek stalled, riwayat pasien, katalog & SOP, serta penjelasan status bot-vs-CS. **Catatan:** Copilot berjalan di atas 7 tool Fastify yang sama dengan grounding/budget/audit di backend; otak Hermes eksternal menambah overhead prompt (~16k token) sehingga satu turn bisa memakan waktu hingga ~120 detik dan menampilkan jawaban degradasi bila melewati anggaran. Bukan error — tunggu atau persempit pertanyaan (misal tambah tanggal).

> Nama brand/bidan di contoh dokumen ini ("Bidan Yusi", dsb.) adalah **contoh tampilan**. Sumber kebenaran brand = `tenants.name` + `TenantPersona` + `Tenant.settings.brand` di DB, bukan teks dokumen.

---

## 2. Anatomi & Siklus Hidup Reservasi (The Reservation Lifecycle)

Status adalah **state machine deterministik** (`src/domain/reservation-status.ts`: `canTransition`, `isActiveReservation`, `SLOT_BUFFER_MIN=20`), bukan label bebas.

### 2.1 Tujuh Status Reservasi & Artinya

| Status | Arti & Perilaku Sistem | Menempati Slot? |
|---|---|---|
| `pending` | Menunggu verifikasi admin. Reservasi baru dari bot (termasuk same-day) atau intake admin tanpa tanggal. Flag `needs_staff_verification=true` menandai "belum dicek staf" tanpa mengubah status. | **Aktif administratif, TAPI dikecualikan dari audit overcapacity.** Tetap dihitung untuk deteksi duplikasi pasien. Jangan anggap slot terkunci keras. |
| `hold` | Kunci sementara (minta waktu transfer/berembuk). Berlaku **maksimal 2 jam sejak `created_at`** DAN **kedaluwarsa tengah malam WIB hari pembuatan** (cron `runExpiredHoldSweep`, berbasis `created_at`). Kedaluwarsa/release → `cancelled` (tetap tercatat untuk audit, bukan hilang). | Ya, selama masih dalam jendela 2 jam (`isHoldActiveByCreated`). |
| `confirmed` | Jadwal pasti. Terapis dijadwalkan, slot terkunci penuh, reminder H-1 dijadwalkan. | Ya (Aktif) |
| `en_route` | Terapis OTW (tombol OTW/Navigasi). Semantik = `confirmed` yang sedang berjalan; tetap hitung riwayat. | Ya (Aktif) |
| `completed` | Pelayanan selesai. Memicu follow-up review H+1. **Guard prematur:** ditolak (`400 PREMATURE_COMPLETION_BLOCKED`) bila `booking_date > sekarang + 24 jam`. Same-day boleh diselesaikan di hari yang sama. Guard ini saat ini hanya di admin API; jalur staf/series belum seragam (lihat Bab 8). | Tidak (Selesai) |
| `cancelled` | Dibatalkan/berhalangan. Slot terbuka, reminder H-1 dibatalkan. Juga dipakai sebagai status akhir hold yang dilepas/kedaluwarsa. | Tidak (Bebas) |
| `rejected` | Ditolak klinik (penuh di luar kapasitas, luar jangkauan, kontraindikasi medis). | Tidak (Bebas) |

Matriks transisi legal (`canTransition`): `pending → confirmed/cancelled/hold`; `hold → confirmed/pending/cancelled`; `confirmed/en_route → completed/cancelled`; `* → hold` hanya dari `pending`. Transisi lain ditolak backend.

### 2.2 Aturan Bentrok Slot & Buffer 20 Menit (`SLOT_BUFFER_MIN`)

Sistem menambah **buffer 20 menit** setelah setiap durasi layanan (seam tunggal `SLOT_BUFFER_MIN`, bukan angka tersebar).
Contoh: pijat 60 menit mulai 09:00 memblokir terapis hingga 10:20 (tindakan + sterilisasi/persiapan jalan).

Kapasitas bersamaan = jumlah `Staff.active=true` hari itu (sumber tunggal DB, bukan angka hardcode). Sapuan tumpang (`runSlotOverlapSweep`) bersifat **peringatan dini ke admin**, bukan blokir keras.

---

## 3. Panduan Langkah-demi-Langkah Pengoperasian Reservasi

### 3.1 Menangani Reservasi Masuk dari WhatsApp Bot

1. Buka `/admin/reservations`.
2. Periksa baris teratas `pending` (badge) — perhatikan juga flag `needs_staff_verification` (bot/non-admin yang belum dicek staf).
3. Klik Detail (ikon mata/baris) → cek 4 hal wajib: nama & kontak ibu + anak; layanan & usia vs batas katalog (`clinic_services.min/max_age_months`); kelurahan/kecamatan + ongkir snapshot; jam vs jadwal terapis.
4. Klik **Konfirmasi** → `confirmed` (flag verifikasi dibersihkan).

### 3.2 Menangani Permintaan Hari-H (Same-Day Booking)

- Bot membuat `pending` + tag `[SAME_DAY_REQUEST] Perlu cek rute terapis hari ini` + badge "Hari Ini — Perlu Cek". Notifikasi darurat via Web Push + Telegram (`SAME_DAY_REQUEST`).
- Tindakan: buka Kalender Day View hari ini, cek terapis kosong di jam diminta. Ada → pilih terapis, Simpan, `confirmed`. Penuh → sapa via Live Chat, tawarkan geser jam/besok.
- Jalur form WA dan V3 tool memakai seam intake yang sama (`reservation-intake.ts`): same-day → `pending` + tag + `requestId` idempoten.

### 3.3 Membuat Reservasi Manual (Input CS)

Klik **+ Tambah Reservasi** (atau klik jam kosong di kalender → tanggal/jam terisi otomatis):

1. Pilih pasien (ketik HP/nama; alamat terisi otomatis bila pernah berkunjung) atau isi baru (Nama Bunda, WA 08..., Nama Anak, Tgl lahir/usia).
2. Pilih Kategori (Baby/Kids/Moms) + Layanan (durasi terisi dari katalog DB), Tanggal + Jam (disimpan sebagai WIB via `buildWibIso`, bukan zona browser).
3. Alamat & ongkir: pilih kelurahan/kecamatan → referensi tier/riwayat. Ongkir tersimpan sebagai **snapshot** di reservasi.
4. Pilih terapis (boleh kosong), Simpan. Intake tanpa tanggal **hanya boleh `pending`** (anti ghost booking), tidak boleh langsung `confirmed/hold`.

### 3.4 Menggunakan Fitur Hold (Kunci Slot Sementara)

Dipakai saat pasien minta keep slot untuk transfer/berembuk.

- Set `pending → hold`. Slot terkunci max **2 jam sejak dibuat** dan gugur **tengah malam WIB hari pembuatan**.
- Bukti transfer masuk → `hold → confirmed`.
- Batal lisan / lepas → **Release Hold = `hold → cancelled`** (tercatat, bukan hapus baris). Slot terbuka kembali.

### 3.5 Penugasan Terapis & Jeda Aman 5 Menit

- Pilih/ubah terapis → sistem **menunda notifikasi Telegram 5 menit** (`assignment_pending_staff_id/at`, `ASSIGNMENT_NOTIFICATION_DELAY_MINUTES=5`). Bila dalam 5 menit diganti lagi, notifikasi ke terapis pertama dibatalkan otomatis.
- Setelah 5 menit tanpa perubahan → bot Telegram klinik mengirim penugasan.
- **Pre-Visit Brief (H-30 menit):** sistem mengirim Kartu Ringkasan Pasien ke Telegram terapis (nama bunda/anak, keluhan, preferensi, link Maps). Jendela sapuan 20–35 menit + idempoten `pre_visit_brief_sent_at`.

### 3.6 Verifikasi Alamat, GPS Pin, dan Foto Rumah Pasien

- Tempel link shareloc Google Maps ke kolom alamat → sistem ekstrak URL (`extractGoogleMapsUrls`) + koordinat via API `URL` standar (bukan regex hafalan), membedakan `gps_pin` vs `estimated_area` vs `manual_staff`.
- Tulis patokan (misal "pagar hitam seberang masjid, gang samping pos ronda").
- Unggah foto rumah → sistem kompres + bubuhkan **watermark GPS & waktu + patokan** (`media.service`) agar terapis cocokkan visual. Titik non-presisi membuka peta via teks alamat + gerbang konfirmasi pra-navigasi di PWA.

### 3.7 Pembayaran, Bukti Transfer, dan Penyesuaian Ongkir

- Tab Pembayaran di detail: thumbnail/pratinjau `proof_url`, bisa unggah struk dari chat.
- Status review DB: **`pending` → `approved` / `ignored_outlier`** (bukan "verified"). Istilah "verified" di v1.0 sudah dikoreksi.
- **Lunas = murni `purchase_occurred_at` ada** (`isReservationPaid`), bukan status `confirmed/completed`. Badge "Terjadwal • Lunas" hanya bila keduanya terpenuhi.
- `delivery_fee` = **snapshot permanen** per reservasi (fallback ke `Customer.ongkir` bila null), tidak berubah walau tier naik.
- **Meta CAPI Purchase:** antrean moderasi (`purchase_review_status='pending'` → admin approve). Event dikirim hanya yang `approved`; outlier ditahan. Jangan janjikan kirim instan.

### 3.8 Reschedule dan Pembatalan

- Reschedule: ubah Tanggal/Jam → cek terapis sama tersedia. Bentrok → peringatan merah; ganti terapis/jam alternatif. **Google Calendar saat ini mode mock** (indikator di UI) — jangan klaim sinkron kalender sungguhan ke pasien.
- Batal: `→ cancelled` + isi alasan (misal "anak demam tinggi"). Slot terbuka, reminder H-1 batal.
- **Larangan premature:** admin API menolak `completed` bila jadwal >24 jam ke depan. Selesaikan hanya setelah kunjungan tiba (same-day boleh hari itu juga).

### 3.9 Paket Layanan Berseri (Reservation Series / Multi-Sesi)

Tabel `ReservationSeries`: sesi bertambah tiap kunjungan dijadwalkan (misal Sesi 2/4). Status seri: `active | paused | completed | cancelled` (v1.0 lupa `cancelled` — sudah dikoreksi).

---

## 4. Navigasi Halaman Reservasi: Tabel vs Kalender (`/admin/reservations`)

### 4.1 Table View (`viewMode='table'`)

Audit/rekap/cari/ekspor. Filter: teks (bunda/HP/anak), status (**Upcoming/Aktif, Pending, Confirmed, Hold, En Route, Completed, Cancelled, Rejected** — v1.0 lupa `rejected/en_route`), kategori (Baby/Kids/Moms), terapis. Aksi cepat: detail, bukti bayar, maps, deep-link Live Chat. Mendukung deep-link `?date=YYYY-MM-DD` dari notifikasi tumpang.

### 4.2 Calendar View

- **Day:** per-jam 08:00–18:00 WIB semua terapis (kolom bersisian) — deteksi gap & cegah overlap.
- **Week:** beban 7 hari ke depan.
- **Month:** tren makro bulanan.
- **Quick Slot:** klik jam kosong → form terisi tanggal/jam otomatis (zona WIB).

Jam operasional 08:00–18:00 WIB adalah **default tenant**; sumber runtime = config tenant, bukan konstanta global.

---

## 5. Integrasi AI Copilot (Hermes Agent) untuk Admin

Panel kanan dashboard / panel Copilot di Live Chat. Contoh:

```
Admin: "Copilot, siapa saja pasien yang jadwalnya besok dan terapisnya?"
Copilot: "Besok ada 3 reservasi aktif: 1. ... - 09:00 - Bidan ... [Buka Chat](/admin/live-chat?conversationId=...) ..."
```

Tool nyata (bukan konsep, 7 tool): `query_reservations_by_filter` (filter tanggal YYYY-MM-DD WIB/status/nama terapis), `query_unreplied_chats` (pesan terakhir INBOUND), `query_stalled_inquiries` (minat jadwal state+teks, 8 pesan, `offeredTime` = jam terakhir yang pernah ditawarkan admin, `waitingMinutes` manusiawi), `query_unscheduled_prospects`, `get_customer_history` (profil + riwayat pasien), `lookup_catalog_and_policy` (katalog & SOP), `explain_conversation_state` (status bot vs diambil-alih CS + alasan eskalasi). Nomor HP tidak diteruskan ke LLM (privasi); kontak sandbox/dummy disaring.

Bisa jawab: jadwal relatif ("hari ini/besok/Senin"), chat menggantung, prospek tanya jadwal tapi belum booking (filter `date`/`sinceDays`), riwayat pasien, katalog & SOP (via `ClinicPolicy`/tool — angka SOP tidak di-hardcode di prompt).

Batasan jujur: `offeredTime` hanya 1 jam terakhir; overhead framework Hermes besar → jawaban bisa degradasi "batas waktu" — persempit pertanyaan. Link kanonis: `/admin/live-chat?conversationId=` (bukan hash lama).

---

## 6. Aturan Emas Klinis & Batasan Operasional (SOP Guards)

Sumber kebenaran = **`ClinicPolicy` + `clinic_services` di DB** (topik `post_vaccine_rules`, ambang demam, batas usia). Angka di bawah = default saat audit; bila DB diubah, DB menang.

1. **Pasca-imunisasi:** acuan resmi `post_vaccine_rules` = **jeda minimal 48–72 jam (2–3 hari)** + syarat fit & tidak demam; pijat **sangat disarankan sebelum** imunisasi. Operasional klinik menerapkan **3 hari sebagai batas aman**. Koreksi v1.0 yang menulis "3x24 jam" sebagai satu-satunya kebenaran kode — kode punya varian 2–3 hari, jadi rujuk DB.
2. **Bayi kuning/sakit akut:** demam (default ambang **37.8°C**, bukan 38.0 — v1.0 keliru), muntah terus, sesak, tali pusat bernanah → arahkan ke Sp.A/faskes darurat, bukan spa/massage.
3. **Kapasitas:** reservasi aktif jam sama ≤ `Staff.active=true` hari itu (DB). `pending` tidak dihitung overcapacity (by-design).
4. **Privasi medis:** dilarang sebar HP/alamat/riwayat ke luar tim operasional + terapis bertugas. Copilot tidak menerima nomor HP mentah.

---

## 7. Modul Knowledge Ingestion untuk Hermes Agent (spesifikasi seed DB)

Bab ini **bukan teks tempel ke prompt**. Ini spesifikasi agar admin/engineer melakukan seeding ke tabel `KnowledgeChunk` / `ClinicPolicy` **per-tenant** (`tenant_id` wajib). Angka default boleh dicantumkan sebagai `factual_summary`, tetapi runtime Copilot wajib membaca nilai hidup dari DB/tool, bukan menghafal dokumen.

### Chunk 1: Status reservasi

- **Intent:** `RESERVATION_STATUS_HANDLING` — trigger: arti hold, konfirmasi, slot dilepas.
- **Seed ke:** `KnowledgeChunk(title, content, keywords)` + `ClinicPolicy(topic='reservation_status_rules')`.
- **Isi规范:** aktif = `confirmed/en_route/pending/hold` (dengan kualifikasi `pending` di 2.1); hold 2 jam sejak `created_at` + tengah malam WIB → `cancelled`; same-day `pending + [SAME_DAY_REQUEST]` butuh cek terapis; `completed` tolak bila >24 jam ke depan; buffer default 20 mnt (`SLOT_BUFFER_MIN`).

### Chunk 2: Audit jadwal & slot kosong

- **Intent:** `COPILOT_SCHEDULE_AUDIT` — trigger: jadwal kosong/bentrok/rekomendasi slot.
- **Seed ke:** `KnowledgeChunk` + deskripsi tool `query_reservations_by_filter` (sudah memuat `rejected/en_route`).
- **Isi规范:** panggil tool dengan tanggal YYYY-MM-DD WIB; bandingkan jam operasional default 08:00–18:00 WIB (config tenant); hitung durasi katalog + buffer 20 mnt; terapis luang = tanpa reservasi aktif di rentang tersebut.

### Chunk 3: Follow-up prospek tertunda

- **Intent:** `STALLED_INQUIRY_RECOVERY` — trigger: chat menggantung/prospek belum deal.
- **Seed ke:** `KnowledgeChunk` + tool `query_stalled_inquiries` / `query_unreplied_chats`.
- **Isi规范:** identifikasi nama, treatment diminati, `requestedTime` (dari customer) vs `offeredTime` (terakhir dari admin), link kanonis `[Buka Chat](/admin/live-chat?conversationId=...)`.

> Dilarang menambah negative-constraint "DILARANG..." di prompt sebagai pengganti gerbang kode. Guardrail = `canTransition`, `isHoldActiveByCreated`, `isPrematureCompletion`, tool masking, dan filter DB.

---

## 8. Batasan Diketahui & Tech Debt (bagian dari SOP resmi)

1. **GCal mock:** sinkron kalender masih mock; jangan janjikan ke pasien.
2. **Guard `completed` parsial:** jalur staf PWA + series belum seragam (KNOWN_ISSUES #190c).
3. **Definisi lunas ganda historis:** laporan/notif lama pernah anggap `completed/CONFIRMED` = lunas; kini kanonis `purchase_occurred_at`. Waspadai angka lama.
4. **Copilot:** latensi Hermes, `offeredTime` tunggal, tone DB `Tenant.settings.copilot.styleTone` belum di-seed (default netral).
5. **Hold dual-expiry & `pending` non-blocking** adalah keputusan produk by-design (#179-A1, #198), bukan bug.

Rujukan: `docs/KNOWN_ISSUES.md` #182/#190/#191/#198, `CHANGELOG.md` 2026-10-02/03.

---

*Dokumen ini standar operasional klinik dan acuan seed AI Copilot. Perubahan angka operasional wajib via DB/config tenant + catat di CHANGELOG, bukan edit kalimat SOP saja.*
