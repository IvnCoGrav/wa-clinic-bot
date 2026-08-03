# Dokumentasi Teknis & Operasional: AI Chat Scrapper & Harvesting Engine

## 1. Pendahuluan
**AI Chat Scrapper & Harvesting Engine** adalah modul intelijen otomatis pada platform WhatsApp Clinic Bot yang bertugas menyerap, menyaring, menyensor data sensitif (PII), dan menyarikan percakapan pelanggan (Customer) dengan tenaga medis (Bidan/Admin) menjadi pasangan **Pertanyaan & Jawaban (FAQ)** serta data **Prospek/Reservasi (Lead & Purchase)**.

Tujuan utama fitur ini:
1. **Otomatisasi Pengetahuan (Knowledge Ingestion)**: Mengurangi beban kerja admin dalam memasukkan FAQ manual satu per satu.
2. **Penyaringan Medis (Dual Routing)**: Mengarahkan pertanyaan gejala kesehatan/medis ke **Bidan Review Queue** (`MedicalFaqStaging`) dan pertanyaan umum/layanan ke **Admin Review Queue** (`GeneralFaqStaging`).
3. **Ekstraksi Data Transaksi (Legacy Staging)**: Mendeteksi isi form reservasi kuno/manual untuk disimpan ke `LegacyStaging`.

---

## 2. Arsitektur Komponen & Alur Data

Modul ini memiliki 2 metode pengikisan percakapan:

```
                  +-----------------------------------+
                  |   WhatsApp Raw Message Streams    |
                  +-----------------+-----------------+
                                    |
          +-------------------------+-------------------------+
          |                                                   |
          v                                                   v
[Sub-sistem 1: Batch Harvester]                   [Sub-sistem 2: Live Chat Self-Learning]
LegacyHarvestingService                           SelfLearningService
(Scan histori chat WAHA API)                      (Menyerap balasan Admin 10s debounce)
          |                                                   |
          v                                                   v
  +---------------+                                   +---------------+
  | PII Scrubbing |                                   | LLM Refinement|
  +-------+-------+                                   +-------+-------+
          |                                                   |
          +-------------------------+-------------------------+
                                    |
                                    v
                     +------------------------------+
                     | Pre-AI & Anti-Duplication    |
                     | Similarity Check (>= 70%)    |
                     +--------------+---------------+
                                    |
          +-------------------------+-------------------------+
          |                         |                         |
          v                         v                         v
+-------------------+     +-------------------+     +-------------------+
|MedicalFaqStaging  |     |GeneralFaqStaging  |     |  LegacyStaging    |
|(Bidan Queue)      |     |(Admin Queue)      |     |(Lead/Purchase)    |
+-------------------+     +-------------------+     +-------------------+
          |                         |
          v                         v
+-----------------------------------------------------------------------+
|                 Verifikasi & Publikasi oleh Bidan/Admin              |
|                     (Knowledge Base Production)                       |
+-----------------------------------------------------------------------+
```

---

## 3. Sub-sistem & Cara Kerja

### A. Sub-sistem 1: Batch Historical Harvester (`LegacyHarvestingService`)
- **Fungsi**: Memindai histori percakapan lama yang ada di server WhatsApp HTTP API (WAHA).
- **Pengaturan Scan**:
  - `maxChats`: Jumlah obrolan customer yang di-scan (default: `50`).
  - `maxMessagesPerChat`: Jumlah bubble pesan per obrolan (default: `50`).
- **Tahapan**:
  1. **Scrubbing PII**: Sensor otomatis untuk nomor telepon (`[REDACTED_PHONE]`), nomor rekening bank (`[REDACTED_ACCOUNT]`), email (`[REDACTED_EMAIL]`), dan nama spesifik customer (`Bunda [REDACTED_NAME]`).
     > *Catatan*: Istilah medis & status umum seperti "Bunda Hamil", "Ibu Menyusui", "Bidan" dikecualikan dari sensor agar kalimat tidak rusak.
  2. **Pre-AI Junk Filter**: Mengabaikan pesan singkat (<10 karakter) atau kata sapaan umum (*halo, ok, makasih, p, siap*).
  3. **Pemisahan Teks Reservasi**: Pesan berupa isi form reservasi/booking slot dipisahkan dan diarahkan ke `LegacyStaging` (bukan FAQ).
  4. **Pemeriksaan Duplikasi**: Membandingkan pertanyaan baru dengan database menggunakan kecocokan vektor (*vector similarity >= 0.70*).

---

### B. Sub-sistem 2: Real-Time Live Chat Self-Learning (`SelfLearningService`)
- **Fungsi**: Belajar secara langsung saat Bidan/Admin membalas pesan customer di panel Live Chat Monitor.
- **Mekanisme Debounce (10 Detik)**: Menunggu 10 detik setelah balasan terakhir dikirim untuk mengumpulkan balasan yang terpotong dalam beberapa gelembung chat (*multi-bubble reply*).
- **LLM Refinement**: Mengirimkan pasangan pertanyaan customer + balasan bidan ke LLM (*MiniMax / OpenAI*) untuk disarikan menjadi pasangan FAQ umum tanpa nama/lokasi spesifik.
- **Penjaminan Kualitas (Unified Staging)**: Hasil ekstraksi **dikirim ke Staging Queue** (`MedicalFaqStaging` / `GeneralFaqStaging`) untuk di-review terlebih dahulu sebelum digunakan oleh Bot produksi.

---

## 4. Struktur Tabel Database (Prisma Schemas)

1. `MedicalFaqStaging`:
   - `conversation_id`, `customer_phone`, `raw_question`, `bidan_raw_reply`, `general_question`, `general_answer`, `symptoms_tagged`, `status` (`PENDING`, `APPROVED`, `REJECTED`, `EXISTING_MATCH`).
2. `GeneralFaqStaging`:
   - `conversation_id`, `raw_question`, `raw_answer`, `general_question`, `general_answer`, `category`, `status`.
3. `LegacyStaging`:
   - `phoneNumber`, `name`, `extractedLocation`, `extractedReservationJson`, `status`.

---

## 5. Panduan Operasional Peninjauan (Review Queue)

1. Boka **Dashboard Admin** > **Knowledge Base** > **Review Staging FAQ**.
2. Filter berdasarkan tipe:
   - **Tinjauan Medis (Bidan Queue)**: Memeriksa akurasi klinis balasan bidan dan gejala (*symptoms*) yang di-tag.
   - **Tinjauan Umum (Admin Queue)**: Memeriksa pertanyaan seputar harga, lokasi, dan layanan.
3. Tindakan Admin/Bidan:
   - **Setujui (Approve)**: FAQ langsung aktif dan dipahami oleh AI Bot saat menjawab customer.
   - **Edit & Setujui**: Mengubah redaksi kata sebelum disetujui.
   - **Tolak (Reject)**: Menghapus kandidat FAQ dari antrian.
