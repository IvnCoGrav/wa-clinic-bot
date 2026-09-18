# Implementation Plan: Arsitektur Fondasional Penyelesaian Regresi Percakapan Sesi Oksitosin, Keranjang, Nominal, & Sanitizer

Dokumen ini menggantikan pendekatan kosmetik/tambal-sulam terdahulu dengan **solusi arsitektural fondasional lintas lapisan** (Data/DB Schema, State Machine, Tool Contract, dan Sanitizer). Rencana ini disusun untuk mematuhi secara mutlak seluruh mandat di `AGENTS.md`:
- **Mandat Solusi Fondasional & Larangan Solusi Kosmetik / "Make-up"**
- **Mandat Non-Hardcode & Data-Driven Architecture**
- **Mandat Anti-Overfitting & Larangan Hafalan Pola Kalimat / Hardcoded If-Else**
- **Mandat Minimalisasi Regex & Mid-Sentence Mutilation Ban**
- **Mandat Active User Commitment Mutlak**

---

## 1. Multi-Layer Root Cause Audit

Berdasarkan audit log mesin (`logs/llm-2026-09-18.jsonl`) dan codebase `src/v3/`:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 1. DATA/DB SCHEMA LAYER (treatment-catalog.service.ts)                           │
│ Layanan bundle "moms-laktasi-oksitosin-full" hanya bertipe BUNDLE tanpa          │
│ metadata kanonis targetAudience: 'MOMS'. Akibatnya detectRecipientScope jatuh ke │
│ GENERAL, lalu di-fallback secara buta menjadi label "[Untuk Si Kecil]".          │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 2. STATE MACHINE & CART LAYER (cart-manager.ts & context-grounder.ts)            │
│ CartManager berjalan pasif di background sebelum router, memindai seluruh kata   │
│ di riwayat chat via fuzzy string matching! Saat customer bertanya medis/khasiat  │
│ ("Breast massage ini bisa untuk memperbanyak asi?"), kata cocok -> MASUK CART    │
│ Rp 155.000 sepihak, tanpa ada komitmen aktif transaksi.                          │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 3. TOOL CONTRACT LAYER (get-catalog.tool.ts)                                     │
│ Baris 564 & 576 secara HARDCODED mendikte template balasan:                      │
│ "Wajib tutup... tanyakan apakah si kecil sedang batuk/pilek/kembung", bahkan     │
│ saat layanan adalah Oksitosin Ibu -> Memaksa LLM kaset rusak 7x & ganti subjek!  │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 4. GUARDRAIL & VALIDATOR LAYER (numeric-fact-validator.ts)                      │
│ Router Call 1 sudah mengekstrak argumen terstruktur targetPrice: 900000, tetapi  │
│ validator hanya memeriksa treatments & cart resmi, buta terhadap parameter tool. │
│ Angka 900k dicap halusinasi -> Reprompt engine memaksa LLM menimpa jadi 155k!   │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 5. POST-PROCESSING MUTILATION (sanitizer.ts)                                     │
│ Regex limitVocativeQuota memenggal kata "Bunda" kedua di tengah klausa kalimat   │
│ -> Cacat tata bahasa: "layanan yang [Bunda] maksud", "layanan yang tanyakan".    │
│ applyPreLocationTone menimpa awalan balasan -> Double emoji glitch "😊 😊".      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Staged Implementation Phases & Micro-Tasks

### Fase 1: Pembersihan Sanitizer & Penghapusan Total Mutilasi Regex (Zero Mid-Sentence Mutation)

**Tujuan**: Mematuhi *Mid-Sentence Mutilation Ban*. Hentikan pemotongan kata bahasa alami di tengah kalimat dan hapus penggantian string pembuka yang memicu double emoji.

- **File Target**: `src/v3/guardrails/sanitizer.ts`
- **Tugas Mikro 1.1**: Hapus fungsi `applyPreLocationTone`. Logika manipulasi teks di awal balasan (`text.replace(/^\s*Bisa banget Bunda.../i, ...)`) dicabut seluruhnya. Kontrol nada bicara pra-lokasi didelegasikan seutuhnya ke layer prompt (`location-rules.phase.ts`).
- **Tugas Mikro 1.2**: Rekonstruksi `limitVocativeQuota`.
  - Hapus logika regex replacement string kosong `""` pada kata "Bunda"/"Bapak" di tengah kalimat.
  - Pembatasan kuota vokatif HANYA berlaku untuk sapaan pembuka di awal pesan atau awal paragraf baru (`^Halo Bunda... Bunda,...`).
  - DILARANG MENYENTUH kata sapaan yang berada di dalam struktur klausa kalimat (seperti `yang Bunda maksud`, `kebutuhan Bunda`, `Bunda tanyakan`).
- **Acceptance Criteria**:
  - `npx vitest run tests/unit/v3-sanitizer-vocative-quota.test.ts` lulus tanpa ada kata "Bunda" yang terpotong di tengah kalimat.
  - Kalimat `"layanan yang Bunda maksud"` tetap utuh `"layanan yang Bunda maksud"`.

---

### Fase 2: Data Schema & Domain Model Layanan Bundle (Data-Driven Audience)

**Tujuan**: Menyelesaikan akar masalah salah label `[Untuk Si Kecil]` pada paket ibu di level Data Katalog, bukan if-else hafalan nama layanan di kode runtime.

- **File Target**:
  - `src/services/treatment-catalog.service.ts`
  - `src/v3/state/cart-manager.ts`
  - `src/v3/state/goal-tracker.ts`
- **Tugas Mikro 2.1**: Tambahkan field metadata kanonis `targetAudience: 'MOMS' | 'BABY' | 'KIDS' | 'BOTH'` pada definisi setiap layanan di katalog. Untuk `moms-laktasi-oksitosin-full`, tetapkan secara eksplisit `targetAudience: 'MOMS'`.
- **Tugas Mikro 2.2**: Di `CartManager.detectRecipientScope`:
  - Baca langsung `service.targetAudience` dari data katalog.
  - Jika `service.targetAudience === 'MOMS'`, kembalikan scope `'MOMS'`. DILARANG menggunakan pencocokan string regex terhadap kata `'laktasi'` atau `'oksitosin'`.
- **Tugas Mikro 2.3**: Di `goal-tracker.ts` baris 380:
  - Hilangkan fallback buta yang mengubah scope apa pun yang tidak bertuan menjadi `'Si Kecil'`.
  - Jika `session.targetAudience === 'MOMS'` atau `session.momProfile != null`, fallback penerima adalah `'Bunda'`.
- **Acceptance Criteria**:
  - Paket `Breast + Oksitoksin Fullbody Massage` di grounding keranjang berlabel `[Untuk Bunda]`, bukan `[Untuk Si Kecil]`.

---

### Fase 3: Pemisahan State Konsultasi vs State Transaksi (Decouple Cart from Chat Text)

**Tujuan**: Mencegah pertanyaan konsultasi medis/khasiat membajak keranjang belanja (`session.cartItems`).

- **File Target**:
  - `src/v3/state/cart-manager.ts`
  - `src/v3/agent/pipeline/context-grounder.ts`
  - `src/v3/domain/types.ts`
- **Tugas Mikro 3.1**: Tambahkan field `discussedTreatments?: string[]` pada `CustomerGoalSession` untuk menampung riwayat layanan yang sedang dikonsultasikan, terpisah dari `cartItems` (transaksi).
- **Tugas Mikro 3.2**: Matikan penyerapan pasif berbasis fuzzy-scanning di `CartManager.syncCartItems`.
  - Suatu pesan HANYA boleh memutasi `session.cartItems` jika terdapat komitmen transaksional aktif (state transisi pemesanan / kesepakatan paket definitif).
  - Pertanyaan mengenai khasiat, cara kerja, durasi, atau kecocokan usia DICATAT ke `session.discussedTreatments`, **DILARANG dimasukkan ke `cartItems`**.
- **Acceptance Criteria**:
  - Pertanyaan *"Breast massage ini bisa untuk memperbanyak asi?"* TIDAK menambahkan item apa pun ke `session.cartItems`.
  - `session.cartItems` tetap kosong selama fase konsultasi, mencegah munculnya total tagihan siluman Rp 155.000.

---

### Fase 4: Data-Driven Whitelist pada Numeric Fact Validator (Anti-Reprompt Hallucination)

**Tujuan**: Menghentikan penolakan angka tawar-menawar customer (Rp 900k / 975k) dan mencegah LLM reprompt menimpanya secara paksa dengan Rp 155.000, tanpa menambah satu baris pun regex parser baru.

- **File Target**:
  - `src/v3/guardrails/numeric-fact-validator.ts`
  - `src/v3/agent/pipeline/guardrail-pipeline.ts`
- **Tugas Mikro 4.1**: Perbarui `validateNumericFacts` untuk membaca parameter terstruktur dari tool yang dieksekusi di turn saat ini (`executedTools`).
  - Jika terdapat tool call `get_catalog_and_price` dengan argumen `args.targetPrice`, masukkan nilai `args.targetPrice` tersebut ke dalam set `authorizedNumbers`.
- **Tugas Mikro 4.2**: Di `attemptNumericReprompt`:
  - Jika angka yang dipermasalahkan berasal dari `args.targetPrice` atau konteks penolakan penawaran customer, DILARANG mengeluarkan violation dan DILARANG memicu reprompt penggantian angka ke total keranjang.
- **Acceptance Criteria**:
  - Saat customer menanyakan *"Kalau 900k apakah boleh kak?"*, AI router mengekstrak `targetPrice: 900000`. Balasan LLM *"Untuk nominal Rp 900.000 belum ada paket..."* lolos validasi tanpa dipaksa berubah menjadi Rp 155.000.

---

### Fase 5: Pembersihan Hardcoded Template Kaset Rusak di Tool Catalog Contract

**Tujuan**: Menghilangkan akar masalah pengulangan pertanyaan penutup *"apakah si kecil ada keluhan batuk/pilek..."* yang diulang 7 kali.

- **File Target**: `src/v3/tools/get-catalog.tool.ts`
- **Tugas Mikro 5.1**: Hapus teks hardcoded pada baris 564 dan baris 576:
  - Cabut kalimat: `'Wajib tutup dengan pertanyaan pemantik klinis: tanyakan apakah saat ini si kecil sedang ada keluhan sakit (batuk/pilek/kembung) atau ingin pijat sehat relaksasi saja.'`
- **Tugas Mikro 5.2**: Jadikan panduan penutup dinamis (*data-driven*):
  - Jika layanan ber-target `MOMS`, panduan penutup berfokus pada kenyamanan dan keluhan Bunda (nifas, ASI, pegal), DILARANG membawa topik batuk/pilek bayi.
  - Jika dalam sesi keluhan atau kebutuhan sudah dibahas (`knownSymptoms` ada atau `session.discussedTreatments` sudah terisi), tool DILARANG menyuruh AI menanyakan keluhan lagi; arahkan langsung ke konfirmasi ketersediaan atau preferensi hari.
- **Acceptance Criteria**:
  - Bot tidak lagi mengulang *"Apakah saat ini sedang ada keluhan tertentu atau relaksasi saja?"* lebih dari 1 kali dalam satu sesi percakapan.

---

### Fase 6: Deterministic Location Ingestion di Router Call 1

**Tujuan**: Memastikan nama lokasi yang disebut customer pada Turn 1/2 (seperti *"Di tenggilis kak"*) langsung diproses oleh `calculate_delivery` dan tersimpan di `session.location`, mencegah amnesia lokasi di turn berikutnya.

- **File Target**: `src/v3/agent/prompt/phases/router-tool-routing.layer.ts`
- **Tugas Mikro 6.1**: Perjelas prioritas Call 1 Router: jika customer merespons pertanyaan domisili dengan menyebut nama entitas wilayah (kelurahan/kecamatan/perumahan), pemanggilan `calculate_delivery` adalah **prioritas utama (Call Sequence 1)** sebelum FAQ kebijakan operasional.
- **Acceptance Criteria**:
  - Pesan *"Di tenggilis kak"* langsung memicu eksekusi `calculate_delivery(locationText: "Tenggilis")`.
  - `session.location` terisi, sehingga prompt hierarki lokasi memotong penagihan alamat pada turn 6 dan 8.

---

## 3. Verification & Regression Gate

Sebelum dinyatakan selesai:
1. **Typecheck**: `npm run build` (`tsc`) wajib lulus dengan 0 kesalahan.
2. **Unit Tests**:
   - `npx vitest run tests/unit/v3-sanitizer-vocative-quota.test.ts` (uji anti-mutilasi semantik).
   - `npx vitest run tests/unit/v3/cart-single-primary-domain.test.ts` (uji pemisahan konsultasi vs transaksi).
   - `npx vitest run tests/unit/v3-numeric-fact-validator.test.ts` (uji whitelist data-driven targetPrice).
3. **Full Regression**: `npm test` wajib berjalan hijau pada seluruh test suite tanpa regresi.
