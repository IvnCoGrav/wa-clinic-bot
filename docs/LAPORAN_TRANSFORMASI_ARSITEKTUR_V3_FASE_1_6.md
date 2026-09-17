# Laporan Komprehensif Transformasi Arsitektur Fondasional V3 (Fase 1 s/d Fase 6)
**Platform**: WhatsApp Clinic Chatbot Engine (Kala Baby Spa & Mom Care)  
**Versi Sistem**: V3 Multi-Tenant Conversational Engine  
**Tanggal**: 17 September 2026  
**Status**: SELESAI, TERUJI 100% HIJAU & TERTANAM DI GIT MASTER (`a5ad1d2`)

---

## DAFTAR ISI
1. [Latar Belakang & Analisis Akar Masalah Sistemik](#1-latar-belakang--analisis-akar-masalah-sistemik)
2. [Peta Arsitektur: Sebelum vs Sesudah Transformasi](#2-peta-arsitektur-sebelum-vs-sesudah-transformasi)
3. [Rincian Eksekusi Per Fase](#3-rincian-eksekusi-per-fase)
   - [Fase 1: Golden Regression Corpus, SSoT Konfirmasi Tanggal & Anti-Silent Drop](#fase-1-golden-regression-corpus-ssot-konfirmasi-tanggal--anti-silent-drop)
   - [Fase 2: Dynamic Tool-Masking `save_reservation` & Telemetri Shadow Mode](#fase-2-dynamic-tool-masking-save_reservation--telemetri-shadow-mode)
   - [Fase 3: Arsitektur Prompt Modular Berlapis (Layered Prompt Architecture)](#fase-3-arsitektur-prompt-modular-berlapis-layered-prompt-architecture)
   - [Tahap 1, 2, 3: Penyelarasan Homecare, Dynamic Phase Injection & Taksonomi Usia Deterministik](#tahap-1-2-3-penyelarasan-homecare-dynamic-phase-injection--taksonomi-usia-deterministik)
   - [Agenda 1 (Fase 4): Geocoding Hardening Tier-0 & Anti-Kontradiksi Shareloc](#agenda-1-fase-4-geocoding-hardening-tier-0--anti-kontradiksi-shareloc)
   - [Agenda 2 (Fase 5): Automated Conversation Matrix (20 Skenario Multi-Turn) & Lead-Greeting Fix](#agenda-2-fase-5-automated-conversation-matrix-20-skenario-multi-turn--lead-greeting-fix)
   - [Fase 6 (Agenda 3): Smart Time-Hint Koreksi-Dulu, Structural Refusal Tagging & Enforce Readiness](#fase-6-agenda-3-smart-time-hint-koreksi-dulu-structural-refusal-tagging--enforce-readiness)
   - [Katalog & Taksonomi: Terapi Bapil KIDS Berjenjang Usia (`kids-pulih-*`)](#katalog--taksonomi-terapi-bapil-kids-berjenjang-usia-kids-pulih-)
4. [Tabel Rekapitulasi Berkas (Modified & New Files)](#4-tabel-rekapitulasi-berkas-modified--new-files)
5. [Hasil Uji & Verifikasi Menyeluruh (Quality & Safety Floor)](#5-hasil-uji--verifikasi-menyeluruh-quality--safety-floor)
6. [Catatan Operasional & Panduan Analisis Lanjutan](#6-catatan-operasional--panduan-analisis-lanjutan)

---

## 1. Latar Belakang & Analisis Akar Masalah Sistemik

Sebelum inisiatif Fase 1–6 digulirkan, bot engine V3 mengalami siklus regresi berulang (*whack-a-mole regression cycle*). Setiap kali perbaikan audit klinis dilakukan pada satu skenario (misal: penanganan trauma jatuh atau bayi baru lahir), skenario lain di percakapan langsung kerap mengalami degradasi (*"memperbaiki A merusak C"*).

### 4 Akar Masalah Sistemik yang Teridentifikasi:
1. **Persona Monolitik Menumpuk (*Attention Dilution*)**:
   Berkas `src/v3/agent/persona.ts` membengkak hingga ~580 baris kode yang memuat 63+ instruksi negatif `"DILARANG KERAS"` dari 8 generasi audit yang berbeda. Seluruh instruksi ini dipaksa masuk ke dalam satu ruang konteks LLM di setiap putaran (*turn*), menyebabkan model mengalami *attention fatigue*, gagal memprioritaskan aturan keselamatan krusial, dan sering mengulang pertanyaan yang sama (*amnesia lokasi / amnesia keluhan*).
2. **Tidak Ada Isolasi Kontrak Tool Reservasi (*Premature / Phantom Booking*)**:
   Alat `save_reservation` ditawarkan kepada LLM tanpa pagar pembatas status percakapan. Akibatnya, pada pesan ambigu seperti *"boleh deh yang itu"* atau sekadar pertanyaan jadwal *"bisa hari sabtu?"*, LLM dapat langsung mengeksekusi `save_reservation` padahal domisili belum diketahui, persetujuan belum final, atau tanggal belum disepakati.
3. **Penyebaran Logika Parsial (*Duplication & Broken Single Source of Truth*)**:
   Logika verifikasi tanggal booking tersebar di 3 lokasi berbeda (tool `save-reservation.tool.ts`, router, dan pipeline), dengan format penanganan yang tidak seragam.
4. **Kegagalan Tersembunyi (*Silent Failures*)**:
   Bila terjadi kegagalan jaringan atau parsing LLM/tool, sistem berpotensi tidak merespons sama sekali (*silent drop*), meninggalkan pelanggan tanpa jawaban.

---

## 2. Peta Arsitektur: Sebelum vs Sesudah Transformasi

```
+---------------------------------------------------------------------------------------------------+
| SEBELUM TRANSFORMASI                                                                              |
+---------------------------------------------------------------------------------------------------+
|  [Pesan Masuk] ---> [580 Baris Monolitik persona.ts (63 "DILARANG...")]                          |
|                            |                                                                      |
|                            v                                                                      |
|             [LLM Router Call-1: Semua Tool Ditawarkan Tanpa Masking]                              |
|                            |                                                                      |
|                            +---> Premature save_reservation terpanggil tanpa lokasi / tanggal     |
|                            +---> Tool output memuntahkan daftar harga panjang (Menu Brosur)       |
|                            |                                                                      |
|             [LLM Outbound Call-2] ---> Potensi Silent Drop bila terjadi error                      |
+---------------------------------------------------------------------------------------------------+

                                              ⬇️

+---------------------------------------------------------------------------------------------------+
| SESUDAH TRANSFORMASI (Fase 1 s/d 6)                                                               |
+---------------------------------------------------------------------------------------------------+
|  [Pesan Masuk]                                                                                    |
|       |                                                                                           |
|       v                                                                                           |
|  [1. Evaluasi State & Dynamic Tool-Masking] (tool-masker.ts)                                      |
|       |--> Evaluasi: Alamat ada? Treatment valid? Hari dikomit? Bukan tanya slot/penolakan?       |
|       |--> Jika belum komit: save_reservation DI-MASK (disembunyikan dari tools LLM)              |
|       |                                                                                           |
|       v                                                                                           |
|  [2. Modular Layered Prompt Composer] (src/v3/agent/prompt/)                                      |
|       |--> Layer 1: global-safety.layer.ts (Trauma jatuh, jeda vaksin 48-72h, newborn, SSoT)      |
|       |--> Layer 2: core-persona.layer.ts (Bidan Yusi, 2-3 kalimat, format *, kata ganti kami)    |
|       |--> Layer 3: Dynamic Phase Injection (EARLY_LOCATION / CONSULTATION / SCHEDULING)          |
|       |    * Cache Invariant: Prefix sebelum STABLE_PREFIX_MARKER tetap byte-identik 100%          |
|       |                                                                                           |
|       v                                                                                           |
|  [3. Generation & Tool Execution]                                                                 |
|       |--> Data-Level Output Trimming: Maksimal 2 layanan pada mode konsultasi (Anti-Brosur)      |
|       |--> Geocoding Tier-0: Landmark perumahan & koridor arteri (Kutisari, Rewwin, Candra)       |
|       |--> Single Source of Truth: Date confirmation resolver kanonis                             |
|       |                                                                                           |
|       v                                                                                           |
|  [4. Guardrail & Anti-Silent Drop Invariant]                                                      |
|       |--> Structural Refusal Tagging: context.isRefusalOrEscalation melewati D3 tanpa regex      |
|       |--> Fail-Safe Technical Apology: reportTurnError menjamin nol pesan drop / bisu             |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Rincian Eksekusi Per Fase

### Fase 1: Golden Regression Corpus, SSoT Konfirmasi Tanggal & Anti-Silent Drop
- **Tujuan**: Membangun fondasi keselamatan tanpa dependensi eksternal, menghentikan regresi berulang, dan menyatukan logika validasi tanggal.
- **Implementasi**:
  1. **Golden Regression Corpus (`tests/golden-corpus/`)**:
     - Membangun 61 skenario klinis nyata dan kasus batas adversial (*adversarial edge cases*).
     - Menjamin pengujian 100% *offline-safe* (tanpa DB Postgres, tanpa Redis, tanpa API OpenAI/Meta) menggunakan fixture memori dan stub terkalibrasi.
     - Ditetapkan sebagai gerbang otomatis (`npm run test:corpus`).
  2. **Single Source of Truth Konfirmasi Tanggal (`src/utils/date-confirmation.ts`)**:
     - Mengekstraksi seluruh logika penentuan tanggal booking menjadi modul murni tersentralisasi.
     - Menyelesaikan disparitas antara `extractBookingDate`, `parseIndonesianDate`, dan tool argument parser.
     - Diverifikasi dengan 15 pengujian paritas (`tests/unit/date-confirmation-parity.test.ts`).
  3. **Anti-Silent Drop Invariant (`reportTurnError`)**:
     - Mengubah penanganan error pada `agent-runner.ts` dan pipeline agar tidak pernah menelan pengecualian teknis secara hening (*no swallowed exceptions*).
     - Menjamin bot selalu membalas dengan pesan permohonan maaf teknis yang ramah jika terjadi kegagalan tak terduga (8/8 pengujian invariant lulus).

### Fase 2: Dynamic Tool-Masking `save_reservation` & Telemetri Shadow Mode
- **Tujuan**: Mencegah pemanggilan prematur alat reservasi tanpa merusak kemampuan eksplorasi LLM.
- **Implementasi**:
  1. **Arsitektur Masker (`src/v3/tools/tool-masker.ts`)**:
     - Menganalisis *GoalSession* dan teks percakapan terakhir sebelum LLM Call-1.
     - Menyembunyikan tool `save_reservation` dari array tools yang dikirim ke LLM jika salah satu kriteria mutlak belum terpenuhi:
       - Wilayah/alamat belum diketahui (`LOCATION_MISSING`).
       - Layanan belum ditentukan (`TREATMENT_EMPTY`).
       - Tanggal/waktu belum disepakati (`DATE_NOT_CONFIRMED`).
       - Pesan customer masih berupa pertanyaan ketersediaan slot interogatif atau penolakan (`SLOT_QUESTION_OR_REFUSAL`).
  2. **Telemetri Shadow Mode**:
     - Sistem berjalan dalam mode bayangan (*shadow mode*): hasil evaluasi dicatat ke event log (`TOOL_MASKING_SHADOW_EVAL`) untuk membandingkan apakah masker terlalu ketat (*over-restrictive*) atau selaras (*aligned*).
     - Menambahkan script verifikasi akurasi: `scripts/check-tool-masking-accuracy.ts`.

### Fase 3: Arsitektur Prompt Modular Berlapis (Layered Prompt Architecture)
- **Tujuan**: Mendekonstruksi `src/v3/agent/persona.ts` yang monolitik menjadi modul-modul independen yang bersih, mudah diuji, dan mempertahankan *prompt cache hit*.
- **Implementasi**:
  1. **Pemisahan Lapisan Prompt di `src/v3/agent/prompt/`**:
     - `layers/global-safety.layer.ts`: Aturan penapisan keselamatan medis mutlak (trauma jatuh/terbentur, jeda vaksin 48–72 jam, kontraindikasi demam >38°C, bayi baru lahir 0–28 hari, anti-overclaim, pertahanan prompt injection).
     - `layers/core-persona.layer.ts`: Identitas Bidan Yusi, nada bicara hangat profesional khas bidan, batasan panjang pesan (2–3 kalimat), kata ganti "kami", pembersihan format 1-bintang markdown, contoh *few-shot* statis, serta diferensiasi sapaan Turn-0 vs putaran lanjutan.
     - `phases/location-rules.phase.ts`: Aturan penetapan wilayah, radius jangkauan, penghitungan ongkos kirim, larangan menanyakan jarak km, dan larangan berasumsi Waru/Sidoarjo.
     - `phases/pricing-catalog.phase.ts`: Penanganan mode konsultasi (tanpa harga) vs mode transaksional (rincian biaya transparan), aturan multi-anak, dan penanganan pertanyaan tarif ambigu.
     - `phases/scheduling.phase.ts`: Hierarki penawaran jadwal, SOP hari-H (*same-day*) yang mewajibkan konfirmasi tim operasional, mandat sudut pandang orang pertama (*first-person POV*), dan tata kelola pemesanan.
     - `prompt-composer.ts`: Modul perakitan cerdas yang menyatukan lapisan-lapisan di atas secara berurutan.
  2. **Garansi Byte-Identik & Preservasi Cache**:
     - Output teks yang dihasilkan komposer modular diverifikasi 100% *byte-identical* dengan persona lama sebelum refaktor pada varian default.
     - Marker cache `PERSONA_STABLE_PREFIX_MARKER` dipertahankan persis di posisinya, menjamin efisiensi biaya token OpenAI/Anthropic prompt caching tidak terganggu.

### Tahap 1, 2, 3: Penyelarasan Homecare, Dynamic Phase Injection & Taksonomi Usia Deterministik
- **Tujuan**: Menghilangkan kode mati (*dead code*), menyelaraskan tes warisan, dan menata taksonomi umur serta batasan data.
- **Implementasi**:
  1. **Tahap 1 (Penyelarasan Legacy Test)**:
     - Memperbarui `tests/unit/v3-audit-homecare-fix.test.ts` agar selaras dengan SOP homecare *fail-closed* (sesi memiliki kelurahan valid tanpa detail nomor rumah, 14/14 lulus).
  2. **Tahap 2 (Dynamic Phase Injection - Fase 3.5)**:
     - Menyediakan opsi perampingan prompt berbasis fokus percakapan aktif (`EARLY_LOCATION`, `CONSULTATION`, `SCHEDULING`) via `derivePhaseFocus`.
     - Bagian volatil ditempatkan di bawah marker cache sehingga prefix stabil tetap menghasilkan *cache hit*.
  3. **Tahap 3 (Taksonomi Usia Deterministik & Anti-Menu Brosur Data-Level)**:
     - Menetapkan konstanta kanonis: `CHILD_CATEGORY_AGE_THRESHOLD_MONTHS = 24`.
     - Fungsi sentral: `PatientProfileExtractor.resolveChildAgeCategory(ageMonths)`:
       - `< 24 bulan` $\rightarrow$ `BABY` murni.
       - `≥ 24 bulan` $\rightarrow$ `KIDS` murni.
     - Menghapus logika bridge redundan 0-24 bulan yang sebelumnya berceceran di `treatment-catalog.service.ts`.
     - **Anti-Menu Brosur di Level Data**: Memodifikasi `executeGetCatalog` di `src/v3/tools/get-catalog.tool.ts` sehingga pada mode konsultasi biasa (`!showPrices`), katalog hanya menyuplai maksimal 2 layanan (1 rekomendasi terbaik + 1 alternatif), mencegah LLM memuntahkan menu brosur panjang bertingkat.

### Agenda 1 (Fase 4): Geocoding Hardening Tier-0 & Anti-Kontradiksi Shareloc
- **Tujuan**: Menyelesaikan kasus anomali geocoding (Sesi 477412 Turn 3 / Issue #70) dan menghapus bisikan prompt yang bertentangan dengan Aturan Emas 21.
- **Implementasi**:
  1. **Anti-Kontradiksi Aturan Emas 21**:
     - Menghapus 5 pola pesan pengembalian di `src/v3/tools/calculate-delivery.tool.ts` yang menganjurkan *"Bunda bisa share location..."*.
     - Menggantinya dengan panduan bersih yang meminta ancer-ancer kelurahan/desa secara santun tanpa menodong live location.
  2. **Tier-0 Deterministic Landmarks (`src/config/landmarks.ts`)**:
     - Menambahkan 6 entri perumahan strategis di Surabaya Selatan dan perbatasan Waru: *Kutisari Indah/Asri/Regency, Kendangsari YKP, Rewwin, Pondok Tjandra/Candra Indah, Makarya Binangun, Rungkut Mapan*.
     - Menambahkan 6 entri koridor arteri pada `ARTERY_CORRIDORS`.
     - Menambahkan contoh grounding pada `llmResolveLocation` agar nama seperti "Kutisari" tidak ditebak sebagai "Kutusari Sukomanunggal" di Surabaya Barat.

### Agenda 2 (Fase 5): Automated Conversation Matrix (20 Skenario Multi-Turn) & Lead-Greeting Fix
- **Tujuan**: Menguji ketahanan interaksi multi-turn secara menyeluruh pada 5 arketipe percakapan klinis nyata.
- **Implementasi**:
  1. **Matriks Percakapan 20 Skenario (`tests/integration/v3-conversation-matrix.test.ts`)**:
     - Menguji interaksi Turn 1 hingga Turn 3–4 melintasi 5 arketipe:
       - **Arketipe A (Pediatrik/Balita)**: Bapil balita 3 tahun, rewel balita 2.5 tahun, pricelist kids.
       - **Arketipe B (Bayi/Newborn)**: Susah BAB bayi 2 bln, newborn 15 hari di Sedati, pijat relaksasi 8 bln.
       - **Arketipe C (Jadwal & Same-Day)**: Same-day slot, jadwal hari kerja, slot akhir pekan.
       - **Arketipe D (Multi-Pasien)**: Anak kembar balita, ibu nifas + bayi 1 bln, kakak-adik beda usia.
       - **Arketipe E (Safety, Geocoding, & Format)**: Trauma jatuh, vaksin 24 jam, batas wilayah luar kota (Tuban), koreksi lokasi mendadak, rujukan medis resep obat keras, anti-premature invoicing, serta kepatuhan format & kata ganti.
     - **Kecepatan Tinggi & 100% Offline**: 20 skenario tuntas dalam ~3.5 detik tanpa pemanggilan API eksternal.
  2. **Penyempurnaan Lead-Greeting Detector (`src/utils/lead-greeting-detector.ts`)**:
     - Memperbaiki `SPECIFIC_QUESTION_RE` agar pesan booking yang menyertakan nama hari (`senin` s/d `minggu`, `hari ini`, `sekarang`) tidak lagi tertelan sebagai sapaan pembuka umum kosong (*empty greeting*).

### Fase 6 (Agenda 3): Smart Time-Hint Koreksi-Dulu, Structural Refusal Tagging & Enforce Readiness
- **Tujuan**: Menyelesaikan edge-cases penanganan waktu, menghapus regex penolakan yang rapuh, merampingkan duplikasi prompt, dan menyiapkan mode penegakan masker.
- **Implementasi**:
  1. **Smart Multi-Day Time-Hint (`src/v3/agent/pipeline/context-grounder.ts`)**:
     - Menyempurnakan `ContextGrounder.extractTimeHint`:
       - Saat terdapat kata penanda koreksi (*"ganti"*, *"tapi"*, *"melainkan"*, *"maksudnya"*), sistem memilih hari terakhir yang disebut (*latest-wins*). Contoh: *"Sabtu... eh ganti Minggu"* $\rightarrow$ memilih `Minggu`.
       - Kolokasi majemuk *"besok lusa"* secara cerdas dipetakan menjadi `lusa`.
       - Aposisi penjelas (*"Jumat besok"*) tetap mempertahankan token pertama (*first-wins*).
     - Menutup Issue #78 Item 3 dengan 7/7 test unit baru yang lulus.
  2. **Structural Refusal & Escalation Tagging (`src/v3/guardrails/factual-claim-validator.ts`)**:
     - Menggantikan ketergantungan regex penolakan `REFUSAL_FRAME_RE` dengan flag struktural: `context.isRefusalOrEscalation`.
     - Ketika customer meminta resep obat keras (seperti paracetamol sirup atau antibiotik), sistem memicu eskalasi dan secara deterministik melewati validator klaim faktual D3 tanpa false positive.
     - Menutup Issue #74 dengan 4/4 test unit baru yang lulus.
  3. **Konsolidasi Prompt Minimal**:
     - Memangkas kalimat duplikat pada panduan tool dan merampingkan direktif tanpa membatalkan *pin test* audit klinis sebelumnya.
  4. **Enforce Readiness & Telemetri**:
     - Menambahkan telemetri `TOOL_MASKING_ENFORCED_APPLIED` dan wiring penegakan masker dengan fail-safe try/catch.

### Katalog & Taksonomi: Terapi Bapil KIDS Berjenjang Usia (`kids-pulih-*`)
- **Tujuan**: Menutup gap cakupan data katalog klinis (Issue #78 Item 2) di mana balita 3 tahun dengan keluhan batuk pilek sebelumnya salah diarahkan ke terapi penambah nafsu makan (*Lahap Juara*).
- **Implementasi**:
  1. **Paritas Katalog di `DEFAULT_CLINIC_SERVICES` & `services_custom.json`**:
     - Menambahkan 3 varian terapi batuk pilek anak ke `src/services/treatment-catalog.service.ts`:
       - `kids-pulih-2-4th`: *Pijat Kids Pulih Ceria (2 - 4 Tahun)*, 24–48 bln, Rp85.000.
       - `kids-pulih-4-6th`: *Pijat Kids Pulih Ceria (4 - 6 Tahun)*, 48–72 bln, Rp90.000.
       - `kids-pulih-6-8th`: *Pijat Kids Pulih Ceria (6 - 8 Tahun)*, 72–96 bln, Rp100.000.
     - Memperbarui teks deskripsi pada `services_custom.json` agar mencakup sinonim: *batuk, pilek, bapil, flu, kembung, sembelit* untuk terapi akupresur & aromaterapi.
  2. **Rekomendasi Gejala Deterministik**:
     - Algoritma pencocokan `recommendServiceBySymptoms` kini secara akurat memberikan skor tertinggi pada *Pijat Kids Pulih Ceria* untuk anak usia di atas 24 bulan dengan keluhan batuk pilek.
     - Mem-pin nama terapi pada skenario `CM-01` di `tests/integration/v3-conversation-matrix.test.ts`.

---

## 4. Tabel Rekapitulasi Berkas (Modified & New Files)

Total perombakan mencakup **48 file**, dengan **4.147 penambahan baris** dan **749 pengurangan baris**:

| Kategori | Path Berkas | Tipe Aksi | Fungsi Utama |
| :--- | :--- | :---: | :--- |
| **Prompt Architecture** | `src/v3/agent/prompt/layers/global-safety.layer.ts` | **BARU** | Lapisan penapisan keselamatan medis mutlak (Trauma jatuh, jeda vaksin, newborn). |
| | `src/v3/agent/prompt/layers/core-persona.layer.ts` | **BARU** | Persona Bidan Yusi, batas 2–3 kalimat, format *, kata ganti kami. |
| | `src/v3/agent/prompt/phases/location-rules.phase.ts` | **BARU** | Direktif aturan wilayah, ongkir, dan jangkauan homecare. |
| | `src/v3/agent/prompt/phases/pricing-catalog.phase.ts` | **BARU** | Direktif konsultasi vs transaksional dan anti-menu brosur. |
| | `src/v3/agent/prompt/phases/scheduling.phase.ts` | **BARU** | Direktif jadwal, SOP same-day, dan first-person POV. |
| | `src/v3/agent/prompt/prompt-composer.ts` | **BARU** | Komposer cerdas perakitan prompt modular berlapis. |
| | `src/v3/agent/prompt/index.ts` | **BARU** | Re-export barrel untuk modul prompt. |
| | `src/v3/agent/persona.ts` | **MODIFIED** | Fasad tipis mempertahankan kompatibilitas backwards 100%. |
| **Tool Guarding** | `src/v3/tools/tool-masker.ts` | **BARU** | State-driven dynamic tool masker untuk `save_reservation`. |
| | `scripts/check-tool-masking-accuracy.ts` | **BARU** | Telemetri dan evaluasi akurasi shadow mode masker. |
| | `src/v3/tools/calculate-delivery.tool.ts` | **MODIFIED** | Pembersihan 5 anjuran shareloc per Aturan Emas 21. |
| | `src/v3/tools/get-catalog.tool.ts` | **MODIFIED** | Pemangkasan suplai katalog di mode konsultasi (maksimal 2 layanan). |
| | `src/v3/tools/save-reservation.tool.ts` | **MODIFIED** | Sinkronisasi validasi tanggal via single source of truth. |
| **State & Pipeline** | `src/utils/date-confirmation.ts` | **BARU** | Single source of truth logika penentuan tanggal booking. |
| | `src/v3/state/patient-extractor.ts` | **MODIFIED** | Penegakan taksonomi usia deterministik (ambang 24 bulan). |
| | `src/v3/agent/pipeline/context-grounder.ts` | **MODIFIED** | Smart multi-day time-hint (`latest-wins` pada koreksi). |
| | `src/v3/agent/pipeline/generation-stage.ts` | **MODIFIED** | Injeksi metadata penolakan struktural (`isRefusalOrEscalation`). |
| | `src/v3/guardrails/factual-claim-validator.ts` | **MODIFIED** | Bypass aturan D3 untuk respon penolakan wewenang medis. |
| | `src/utils/lead-greeting-detector.ts` | **MODIFIED** | Guard nama hari agar booking spesifik tidak tertelan jadi sapaan. |
| | `src/v3/agent/agent-runner.ts` | **MODIFIED** | Anti-silent drop error handler dan telemetri enforce. |
| **Data & Katalog** | `src/services/treatment-catalog.service.ts` | **MODIFIED** | Penambahan 3 varian `kids-pulih-*` dan sentralisasi taksonomi umur. |
| | `services_custom.json` | **MODIFIED** | Penyelarasan deskripsi keluhan batuk pilek anak. |
| | `src/config/landmarks.ts` | **MODIFIED** | Penambahan Tier-0 landmark Kutisari/Rewwin/Candra & koridor arteri. |
| | `src/integrations/google-maps/geocoding.ts` | **MODIFIED** | Grounding fallback LLM untuk area perumahan selatan. |
| **Testing Suites** | `tests/integration/v3-conversation-matrix.test.ts` | **BARU** | 20 skenario multi-turn otomatis jalur produksi (~3.5 detik). |
| | `tests/golden-corpus/scenarios/adversarial-edge-cases.ts` | **BARU** | Skenario uji ketahanan batas klinis dan injeksi. |
| | `tests/golden-corpus/golden-corpus.test.ts` | **MODIFIED** | 61 skenario regresi emas gerbang utama. |
| | `tests/unit/tool-masker.test.ts` | **BARU** | Pengujian unit evaluasi masker tool reservasi. |
| | `tests/unit/date-confirmation-parity.test.ts` | **BARU** | Pengujian paritas single source of truth konfirmasi tanggal. |
| | `tests/unit/anti-silent-drop-invariant.test.ts` | **BARU** | Pengujian invarian anti-silent failure. |
| | `tests/unit/v3/deterministic-age-taxonomy.test.ts` | **BARU** | Pengujian taksonomi usia kanonis 24 bulan. |
| | `tests/unit/v3/dynamic-phase-composer.test.ts` | **BARU** | Pengujian preservasi cache pada dynamic phase injection. |
| | `tests/unit/v3/geocoding-kutisari-hardening.test.ts` | **BARU** | Pengujian landmark Tier-0 Kutisari dan anti-shareloc. |
| | `tests/unit/v3/smart-time-hint-correction.test.ts` | **BARU** | Pengujian penanganan koreksi hari bertingkat. |
| | `tests/unit/v3/structural-refusal-tagging.test.ts` | **BARU** | Pengujian bypass klaim faktual pada penolakan resep obat. |
| | `tests/unit/v3/tool-masking-enforce.test.ts` | **BARU** | Pengujian kesiapan mode enforce tool-masking. |
| | `tests/unit/v3/symptom-semantic-scorer.test.ts` | **MODIFIED** | Pengujian rekomendasi berjenjang usia terapi bapil KIDS vs BABY. |
| | `tests/unit/v3-audit-homecare-fix.test.ts` | **MODIFIED** | Penyelarasan prasyarat lokasi homecare. |
| **Dokumentasi & Git** | `CHANGELOG.md` | **MODIFIED** | Catatan rilis komprehensif seluruh fase. |
| | `docs/KNOWN_ISSUES.md` | **MODIFIED** | Penutupan Issue #74, #77, #78, dan #79. |
| | `package.json` | **MODIFIED** | Penambahan script helper test tanpa runtime dependency baru. |

---

## 5. Hasil Uji & Verifikasi Menyeluruh (Quality & Safety Floor)

Semua pengujian dijalankan dalam mode *offline-first* sesuai mandat repositori:

```bash
========================================================================================
                             RINGKASAN HASIL VERIFIKASI
========================================================================================
1. TypeScript Compilation (npm run typecheck):
   LULUS - tsc --noEmit selesai dengan exit code 0 (Nol tipe error).

2. Automated Conversation Matrix (tests/integration/v3-conversation-matrix.test.ts):
   LULUS - 20 dari 20 skenario multi-turn lulus dalam waktu 3.49 detik.

3. V3 Comprehensive Unit Tests (tests/unit/v3/):
   LULUS - 70 test files, 312 unit tests lulus 100%.

4. Golden Regression Corpus (npm run test:corpus):
   LULUS - 61 skenario klinis & adversial lulus 100%.

5. Specialized Verification Suites:
   ✓ symptom-semantic-scorer.test.ts       : 10/10 passed (Terapi Bapil Kids)
   ✓ smart-time-hint-correction.test.ts   : 7/7 passed (Koreksi Hari Multi-Day)
   ✓ structural-refusal-tagging.test.ts    : 4/4 passed (Bypass Klaim Medis)
   ✓ tool-masking-enforce.test.ts          : 2/2 passed (Enforce Readiness)
   ✓ geocoding-kutisari-hardening.test.ts  : 4/4 passed (Tier-0 Landmarks)
   ✓ lead-greeting-preservation.test.ts   : 15/15 passed (Sapaan & Guard Hari)
   ✓ date-confirmation-parity.test.ts     : 15/15 passed (SSoT Tanggal)
   ✓ tool-masker.test.ts                  : 10/10 passed (Masker State-Driven)
   ✓ anti-silent-drop-invariant.test.ts   : 8/8 passed (Fail-Safe Error Apology)
   ✓ dynamic-phase-composer.test.ts       : 6/6 passed (Cache Invariant)
   ✓ deterministic-age-taxonomy.test.ts    : 6/6 passed (Ambang 24 Bulan)

6. Persona Quality Live LLM Harness (tests/evals/persona-quality-harness.ts):
   ✓ Skor Rata-rata: 4.83 / 5.00 (Ambang kelulusan: 4.50)
   ✓ Turn Passing Rate: 13/13 turns lulus (100%)
   ✓ Safety Floor Violations: 0 (Nol pelanggaran keselamatan)
========================================================================================
```

---

## 6. Catatan Operasional & Panduan Analisis Lanjutan

1. **Integritas Prompt Caching di Produksi**:
   - Pemisahan lapisan prompt dirancang sedemikian rupa sehingga teks sebelum `[PERSONA_STABLE_PREFIX_MARKER]` tetap statis dan deterministik. Hal ini memastikan token prompt tetap ter-cache di API penyedia model (OpenAI / Claude), menekan biaya operasional (*cost-per-message*) hingga 50–80%.
2. **Kesiapan Mode Enforce Masker Tool**:
   - Saat ini `TOOL_MASKING_ENFORCE` berada dalam status *shadow mode* (default). Kode dan telemetri (`TOOL_MASKING_ENFORCED_APPLIED`) sudah 100% siap. Bila tim manajemen ingin mengaktifkan pemblokiran mutlak di tingkat gateway, cukup mengeset variabel lingkungan `ENABLE_TOOL_MASKING_ENFORCED=true`.
3. **Penyelarasan Basis Data Live (Produksi)**:
   - Karena penambahan terapi bapil anak (`kids-pulih-2-4th`, `kids-pulih-4-6th`, `kids-pulih-6-8th`) dimasukkan pada `DEFAULT_CLINIC_SERVICES` (digunakan sebagai fallback dan seed), pada lingkungan server produksi pastikan tabel `clinic_services` di database PostgreSQL tersinkronisasi atau biarkan mekanisme auto-seed berjalan jika tabel belum terisi.
4. **Git Repository State**:
   - Seluruh berkas telah di-commit ke Git dengan hash commit: [`a5ad1d2`](https://github.com/IvnCoGrav/wa-clinic-bot/commit/a5ad1d2).
   - Branch lokal `master` telah berhasil di-push ke remote `origin/master` (`03d0e69..a5ad1d2`).
   - *Working tree* bersih (*clean*), siap untuk pengujian staging atau deploy.
