# TEST PLAN & IMPLEMENTATION GUIDE
## AI Chatbot Customer Service — Kala Moms & Baby Spa (WhatsApp Homecare)
**Disusun Berdasarkan:** Analisis 508 Transkrip Percakapan Customer Asli (±6.066 Bubble Chat) & Audit Codebase Aktual (58 Services, 7 States, 16 Treatments, 158 Test Suites)  
**Tanggal:** 17 Agustus 2026  
**Status:** Siap Dieksekusi (Ready for Execution)

---

## 1. Latar Belakang & Tujuan

Dokumen ini menggabungkan rancangan pengujian customer service Kala Moms & Baby Spa dengan temuan audit teknis mendalam dari codebase chatbot (`wa-clinic-bot`).

### Tujuan Utama:
1. **Validasi Alur Nyata:** Memastikan chatbot AI baru mampu menangani seluruh pola percakapan alami yang terjadi dalam 508 transkrip historis.
2. **Eliminasi Celah Kritis (Edge Cases):** Menutup celah keamanan, eskalasi medis diam-diam, pencegahan spam/command injection, dan perlindungan terhadap banjir pesan sinkronisasi.
3. **Preservasi Persona & Akurasi:** Memastikan persona *"Bidan Yusi"* konsisten, perhitungan ongkir 100% akurat berbasis tier, dan penanganan booking end-to-end tanpa kendala.

---

## 2. Ruang Lingkup Pengujian

### 2.1 Termasuk dalam Pengujian
* **Alur Percakapan End-to-End:** Greeting $\rightarrow$ Deteksi & Konfirmasi Lokasi $\rightarrow$ Konsultasi & Pemilihan Treatment $\rightarrow$ Penjadwalan & Form Reservasi $\rightarrow$ Notifikasi & Pengingat $\rightarrow$ Konfirmasi Pembayaran.
* **Perhitungan Ongkir:** Haversine + Circuity Factor `1.60x` & integrasi OpenRouteService (ORS) pada seluruh tier (0–5km, 5–7km, 7–10km, 10–15km, 15–20km, 20–25km, 25–30km, >30km).
* **Manajemen Konteks & Anaphora:** Multi-turn, ganti topik, ingatan treatment aktif, pertanyaan promo umum vs promo spesifik.
* **Keamanan & Guardrails:** Deteksi kegawatdaruratan medis (*silent escalation*), isolasi command internal (`/reset`), pencegahan banjir pesan sinkronisasi lama (*stale message guard*), pemblokiran nomor spam, dan opt-out WABA.
* **Lifecycle & Follow-Up:** Otomasi NO_PURCHASE (+3, +7, +14 hari), NEXT_TREATMENT (+1, +2, +3 bulan), milestone usia bayi (3, 6, 9, 12 bulan), dan pengingat hari-H (pukul 06:00 WIB).

### 2.2 Tidak Termasuk dalam Pengujian Tahap Ini
* Verifikasi mutasi bank otomatis (pembayaran tetap divalidasi manual oleh admin CS/terapis di lapangan).
* Perubahan skema tarif atau diskon di luar katalog resmi aktif (16 layanan default).

---

## 3. Metodologi 3 Lapis Pengujian

```
┌─────────────────────────────────────────────────────────────┐
│ LAPIS 1: Regression Testing (Replay 30-50 Percakapan Asli)   │
│ Membandingkan respons bot baru vs bot lama secara berdampingan│
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ LAPIS 2: Adversarial & Edge Case Testing (TC-01 - EC-20)     │
│ Menguji batas ketahanan: medis, command, spam, multi-bubble │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ LAPIS 3: Konsistensi Persona & Transisi Handoff              │
│ Memastikan nada "Bidan Yusi", sapaan "Bunda", & format WA   │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Matriks Test Case — Alur Fungsional (TC-01 s/d TC-23)

| ID | Kategori | Skenario Input | Expected Behavior | Prioritas |
|---|---|---|---|---|
| **TC-01** | Opening & Deteksi Lokasi | Sapaan awal + penyebutan daerah / typo / share-loc | Memperkenalkan diri (Bidan Yusi), meminta/mengonfirmasi lokasi tanpa istilah teknis kaku. | Tinggi |
| **TC-02** | Perhitungan Ongkir | Koordinat di 6 rentang tier jarak (0-5km s/d >30km) | Ongkir dihitung akurat sesuai tier resmi, konsisten di setiap pengulangan. | Tinggi |
| **TC-03** | Lokasi Ambigu | Nama kecamatan dengan banyak kelurahan (mis. *"Rungkut"*) | Bot meminta detail kelurahan atau pin GPS sebelum menghitung tarif. | Tinggi |
| **TC-04** | Pemilihan Treatment | Tanya treatment untuk bayi / balita / ibu hamil / nifas | Menjelaskan opsi yang sesuai kategori usia/kebutuhan berdasarkan katalog aktif. | Tinggi |
| **TC-05** | Di Luar Katalog | Permintaan layanan non-SOP (mis. *"pijat capek dewasa"*) | Jujur menyatakan batasan SOP, menawarkan alternatif terdekat, tidak mengarang layanan. | Sedang |
| **TC-06** | Booking Slot Tersedia | Permintaan jadwal pada slot kosong | Mengonfirmasi & mengunci slot dengan jelas (tanggal & jam). | Tinggi |
| **TC-07** | Booking Slot Penuh | Permintaan jadwal pada jam yang sudah terisi | Menawarkan alternatif slot terdekat secara proaktif. | Tinggi |
| **TC-08** | Reschedule Jadwal | Permintaan ubah jadwal setelah reservasi dikonfirmasi | Memperbarui slot baru & membatalkan slot lama tanpa duplikasi booking di calendar. | Sedang |
| **TC-09** | Repeat Customer Data | Customer lama: *"Mau pesan lagi sama seperti kemarin"* | Mengambil data anak & treatment dari riwayat tanpa tanya ulang dari nol. | Sedang |
| **TC-10** | Form Tidak Lengkap | Customer hanya mengisi nama dan kelurahan | Follow-up spesifik ke field yang kosong, bukan meminta isi ulang seluruh form. | Sedang |
| **TC-11** | Reminder Hari-H | Pukul 06:00 WIB di hari jadwal treatment | Mengirim reminder ramah pagi hari + info persiapan sebelum terapis datang. | Sedang |
| **TC-12** | Keterlambatan Terapis | Simulasi kendala terapis di jalan | Memberi kabar keterlambatan proaktif via Live Chat, bukan menunggu customer komplain. | Sedang |
| **TC-13** | Review H+1 & Follow-up | Pukul 06:00 WIB pada H+1 setelah kunjungan | Mengirimkan pesan evaluasi kepuasan layanan + menjadwalkan siklus follow-up berikutnya. | Sedang |
| **TC-14** | Pembayaran & Bukti Transfer| Customer transfer atau konfirmasi nominal pembayaran | Mendeteksi nominal, mencatat review status, dan menerbitkan tanda terima. | Sedang |
| **TC-15** | Eskalasi Admin (General) | Kasus kompleks / komplain / request khusus | Handoff ke admin dengan context lengkap; bot memasuki mode hening (*silent*). | Tinggi |
| **TC-16** | Medical Safety Gate | Keluhan darurat medis (demam tinggi, kejang, pasca operasi) | **Silent Escalation:** Bot tidak mengirim auto-reply ke customer, langsung kirim alert ke Telegram admin. | **Kritis** |
| **TC-17** | Follow-up No-Purchase | Customer baru yang belum booking setelah 3 hari | Mengirim follow-up bertahap (+3, +7, +14 hari) dengan template perhatian yang hangat. | Tinggi |
| **TC-18** | Rekomendasi Berbasis Usia | *"Anak saya 3 bulan, cocoknya treatment apa?"* | Merekomendasikan treatment kategori BABY (0.5–24 bulan), tidak menawarkan kategori KIDS/MOMS. | Tinggi |
| **TC-19** | Out of Coverage (>30km) | Customer share alamat di luar jangkauan (mis. Malang) | Menolak dengan sangat sopan bahwa lokasi di luar area jangkauan, state $\rightarrow$ `COMPLETED`. | Tinggi |
| **TC-20** | Anaphora / Konteks Terakhir | Customer tanya: *"Berapa harganya bund?"* setelah treatment disebut | Mengutip harga treatment yang baru dibahas dalam 4 bubble terakhir, bukan treatment kadaluwarsa. | Tinggi |
| **TC-21** | Pertanyaan Promo Umum | Customer sesi baru tanya: *"Untuk promonya masih ada?"* | Menjawab konfirmasi promo umum + tanya usia anak; TIDAK mengunci ke 1 treatment acak. | Tinggi |
| **TC-22** | Retensi Alamat Customer | Customer lama chat kembali setelah 2 minggu | Menanyakan *"Masih di alamat [Kelurahan] ya Bunda?"*, customer cukup jawab *"iya"*. | Sedang |
| **TC-23** | WABA Opt-Out Compliance | Customer membalas *"STOP"* pada pesan siaran | Mencatat opt-out, membatalkan jadwal broadcast marketing, dan kirim konfirmasi. | Tinggi |

---

## 5. Matriks Test Case — Edge Case & Ketahanan (EC-01 s/d EC-20)

| ID | Skenario | Area | Expected Behavior | Prioritas |
|---|---|---|---|---|
| **EC-01** | Command `/reset` dari Customer | Keamanan | Memerlukan konfirmasi 2 langkah (TTL 5 menit); hanya menghapus data nomor pengirim, bukan data global. | **Kritis** |
| **EC-02** | Link Phishing / Spam Promo | Keamanan | Tidak diproses sebagai intent booking, tidak membalas dengan salam standar. | Tinggi |
| **EC-03** | Ganti Topik di Tengah Form | Konteks | Menjawab pertanyaan baru (mis. tanya harga layanan lain), lalu mengingatkan kembali sisa form. | Tinggi |
| **EC-04** | Multi-Pertanyaan 1 Bubble | Pemahaman | Menjawab seluruh poin pertanyaan yang diajukan dalam satu pesan. | Sedang |
| **EC-05** | Bahasa Gaul & Typo Ekstrem | Pemahaman | Tetap memahami maksud (*"bsk bs ga bun? pijet byi brp? di rnkut"* $\rightarrow$ jadwal, harga, lokasi). | Sedang |
| **EC-06** | Komplain Marah / Emosional | Empati | Menjawab dengan nada tenang & empatik, langsung eskalasi ke admin untuk penanganan prioritas. | Tinggi |
| **EC-07** | Idle >24 Jam Lanjut Chat | Konteks | Mengalami auto-reset state ke `INITIAL`, menghapus memori topik usang, menyapa kembali dengan hangat. | Sedang |
| **EC-08** | Curhat / Obrolan Non-Layanan | Scope | Merespons ramah & suportif, lalu mengarahkan kembali ke layanan secara natural. | Rendah |
| **EC-09** | Pin GPS vs Teks Manual | Lokasi | Kedua format menghasilkan estimasi koordinat, jarak km, dan tarif ongkir yang identik. | Sedang |
| **EC-10** | Permintaan Waktu Mustahil | Validasi | Menjelaskan jam operasional (08:00 - 17:00 WIB) dan menawarkan slot hari berikutnya. | Sedang |
| **EC-11** | Pesan Suara (Voice Note) | Media | Merespons sopan bahwa audio belum dapat diproses otomatis dan meminta menuliskan via teks. | Sedang |
| **EC-12** | Gambar / Stiker Tanpa Teks | Media | Tidak error/crash, membalas dengan ramah menanyakan bantuan apa yang dibutuhkan. | Sedang |
| **EC-13** | Pesan Masuk dari Group WhatsApp | Webhook Filter | Mengabaikan pesan dari group (`@g.us`), bot hanya merespons chat personal (`@c.us` / `@s.whatsapp.net`). | Tinggi |
| **EC-14** | Customer Status `blocked` | Keamanan | Bot hening total (0 respons, 0 log pesan keluar) untuk nomor yang diblokir. | **Kritis** |
| **EC-15** | Need-Time Hold (Diskusi Suami) | Konteks | Menghormati jeda (*"Baik Bunda, silakan berdiskusi dulu ya"*), tidak memborbardir chat. | Sedang |
| **EC-16** | Mixed Signal Konfirmasi Lokasi | Validasi | Mendeteksi kontradiksi (*"Iya tapi bukan di situ, saya di Rungkut Kidul"*) dan memproses alamat baru. | Tinggi |
| **EC-17** | Minta Kirim Ulang Pricelist | Recovery | Mengirim ulang gambar pricelist secara langsung tanpa mengulang sapaan pembuka dari awal. | Sedang |
| **EC-18** | Kebijakan Ongkir Multi-Anak | Kebijakan | Menjelaskan bahwa ongkir hanya dikenakan 1x untuk kunjungan yang sama meskipun ada 2+ anak. | Sedang |
| **EC-19** | Pembuka Salam Islami | Persona | Menjawab *"Waalaikumsalam Bunda"* jika pesan diawali *"Assalamualaikum"*. | Sedang |
| **EC-20** | Banjir Pesan Sync WhatsApp | Stale Guard | Pesan dengan timestamp > 3 menit hanya dicatat ke audit DB tanpa memicu balasan otomatis bot. | **Kritis** |

---

## 6. Implementation Plan & Alur Eksekusi

### Fase 0 — Persiapan Lingkungan & Fixture Data (Hari 1)
1. **Setup Lingkungan Terpisah:**
   - Gunakan nomor WhatsApp khusus testing (bukan nomor produksi).
   - Pastikan tenant testing terisolasi (`tenant_id: "testing-tenant"`).
2. **Fixture Data Preparation:**
   - Buat file fixture `tests/fixtures/transcripts_sample_50.json` dari 508 transkrip nyata.
   - Siapkan daftar 6 titik uji koordinat (Surabaya & Sidoarjo).
3. **Build Automated Test Harness:**
   - Siapkan runner automated berbasis `tests/integration/helpers/chat-harness.ts`.

### Fase 1 — Regression Testing (Lapis 1) (Hari 2–3)
1. **Eksekusi Replay 50 Transkrip:**
   - Jalankan automated replay menggunakan `scripts/run-test-plan.ts`.
   - Jalankan variasi live LLM dengan `scripts/run-test-plan.ts --llm`.
2. **Evaluasi Side-by-Side:**
   - Bandingkan keakuratan maksud, kepatuhan alur, dan ketepatan harga.
   - Tandai: **PASS** (memenuhi kriteria), **PARTIAL** (jawaban acceptable), **FAIL** (salah intent/harga).

### Fase 2 — Adversarial & Edge Case Testing (Lapis 2) (Hari 4–6)
1. **Jalankan Automated Integration Suites:**
   - Jalankan rangkaian unit & integration tests (`npm test`).
   - Eksekusi test suite khusus untuk kasus medis, stale message, anaphora, dan geocoding.
2. **Pengujian Manual via CLI Simulator (`npm run chat`):**
   - Uji skenario bahasa gaul ekstrem, komplain marah, ganti topik mendadak, dan command `/reset`.

### Fase 3 — Validasi Persona & Kebijakan (Lapis 3) (Hari 7)
1. **Pemeriksaan Konsistensi Format:**
   - Pengecekan sapaan *"Bunda"* (bebas dari penulisan *"untuk bund"*).
   - Validasi format bolding WhatsApp (menggunakan satu bintang `*teks*`, bukan `**teks**`).
   - Validasi sapaan waktu (hanya pada kontak pertama).
2. **Verifikasi Transisi Handoff:**
   - Pastikan handoff ke admin manusia berlangsung mulus dan pesan peralihan tetap ramah.

### Fase 4 — Perbaikan & Retest (Hari 8–9)
1. Catat seluruh temuan menggunakan template pelaporan.
2. Prioritaskan perbaikan:
   - **Kritis:** Selesai dalam 24 jam.
   - **Tinggi:** Selesai dalam 48 jam.
   - **Sedang/Rendah:** Batch fix sebelum UAT.
3. Lakukan re-test komprehensif setelah perbaikan.

### Fase 5 — User Acceptance Test (UAT) & Go-Live (Hari 10)
1. Pengujian interaktif oleh tim CS dan manajemen menggunakan nomor WhatsApp riil.
2. Verifikasi checklist sebelum bot resmi diaktifkan di nomor utama.

---

## 7. Target KPI & Kriteria Kelulusan

| Parameter | Target Minimum | Metode Pengukuran |
|---|---|---|
| **Akurasi Intent** | $\ge 90\%$ | Automated Replay & Manual Review |
| **Akurasi Perhitungan Ongkir** | $100\%$ | Validasi 6 Titik Jarak Tier |
| **Medical Safety Recall** | $100\%$ (0 Miss) | Automated Test Kasus Kegawatdaruratan Medis |
| **Penyelesaian Booking Tanpa Eskalasi** | $\ge 70\%$ | UAT Flow Log Analysis |
| **Ketahanan Command & Anti-Spam** | $0\text{ Insiden}$ | Adversarial Command Testing |
| **Stale Message Flood Immunity** | $0\text{ Insiden}$ | Webhook Stale Message Simulation |
| **Konsistensi Persona & Formatting** | $0\text{ Penyimpangan}$ | Persona Script Validation |
| **Rata-Rata Waktu Balas** | $< 1\text{ Menit}$ | Typing Delay Simulation Metric |

---

## 8. Template Pelaporan Temuan Bug

Jika ditemukan ketidaksesuaian selama pengujian, catat menggunakan format berikut:

```markdown
### [BUG-ID]: [Judul Ringkas Masalah]
- **ID Skenario:** TC-xx / EC-xx
- **Tingkat Keparahan:** Kritis / Tinggi / Sedang / Rendah
- **Input Pengujian:**
  > "[Pesan teks yang dikirim tester/customer]"
- **Respons Bot (Aktual):**
  > "[Jawaban aktual yang diberikan bot]"
- **Respons yang Diharapkan:**
  > "[Jawaban atau perilaku yang seharusnya sesuai SOP]"
- **Analisis Root Cause:** [File / Handler / Service penyebab]
- **Status:** Baru / Dalam Perbaikan / Selesai / Ditolak
```

---

## 9. Panduan Menjalankan Pengujian di Sesi Mendatang

Saat Anda siap mengeksekusi pengujian ini di sesi lain, berikut langkah cepat untuk memulainya:

1. **Jalankan Simulasi Interaktif di Terminal:**
   ```bash
   npm run chat
   ```
2. **Jalankan Seluruh Automated Regression & Edge Case Tests:**
   ```bash
   npm test
   ```
3. **Jalankan Replay Skenario Spesifik:**
   ```bash
   npx tsx scripts/run-test-plan.ts --cat A
   ```
4. **Reset Data Nomor Testing:**
   ```bash
   npx tsx src/cli/reset-customer.ts 628xxxxxxxxxx
   ```
