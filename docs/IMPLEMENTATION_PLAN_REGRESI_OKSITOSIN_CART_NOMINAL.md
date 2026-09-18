# Implementation Plan: Fondasional Remediasi Kegagalan Berantai Percakapan (Sesi Oksitosin, Keranjang, Nominal, & Sanitizer)

Berdasarkan hasil investigasi mendalam terhadap pengetesan live chat, log `llm-2026-09-18.jsonl`, dan arsitektur `src/v3/`, sistem mengalami **cascading failure** akibat interaksi beberapa komponen:
1. **Mutilasi Semantik String** di `OutputSanitizer.limitVocativeQuota` dan `applyPreLocationTone` yang memenggal kata "Bunda" di tengah klausa (`layanan yang maksud`, `catat dulu kebutuhan, saat ini`, `layanan yang tanyakan`, serta double emoji `😊 😊`).
2. **Pembajakan Keranjang (*Inquiry Cart Hijacking*)** di `CartManager.syncCartItems`: pertanyaan medis informatif (*"Breast massage ini bisa untuk memperbanyak asi?"*) diserap sebagai komitmen beli paket seharga Rp 155.000.
3. **Salah Label Subjek Klinis Maternal**: Bundle laktasi ibu (`Breast + Oksitoksin Fullbody Massage`) berkategori `BUNDLE` dialokasikan ke `RecipientScope: GENERAL` dan secara buta diubah di `goal-tracker.ts` menjadi `[Untuk Si Kecil]`, meracuni prompt LLM sehingga merekomendasikan *Newborn Treatment* 14 sesi bayi.
4. **Halusinasi Paksa Reprompt Numerik**: `validateNumericFacts` menganggap angka budget tawar-menawar customer (Rp 900.000 / Rp 975.000) sebagai halusinasi, lalu reprompt engine memaksa LLM menimpanya dengan isi keranjang (Rp 155.000) menghasilkan kalimat kontradiktif: *"Hmm, untuk nominal \*Rp 155.000\* sendiri belum ada paket..."*.
5. **Amnesia Lokasi**: Router Turn 2 gagal memanggil `calculate_delivery` pada pesan *"Di tenggilis kak"*, sehingga `session.location` kosong dan prompt hierarki jadwal terus menagih alamat.
6. **Kaset Rusak / Looping**: Ketiadaan state pembatas keluhan membuat bot mengulang pertanyaan penutup *"ada keluhan tertentu atau untuk relaksasi saja?"* hingga 7 kali.

---

## User Review Required

> [!IMPORTANT]
> - **Zero Mid-Sentence Regex Mutilation**: Sapaan "Bunda" di tengah struktur kalimat klausa TIDAK BOLEH lagi dihapus via regex. Kontrol vokatif HANYA diperbolehkan di level prompt few-shot dan sanitasi sapaan pembuka di awal baris/paragraf.
> - **Komitmen Keranjang Ketat (Active User Commitment Mutlak)**: Kalimat tanya (`?`), tanya durasi, atau pertanyaan manfaat/medis TIDAK BOLEH mengunci paket ke dalam keranjang. Keranjang hanya bertambah jika ada kata komitmen eksplisit.
> - **Integritas Validator Numerik**: Angka nominal yang diajukan oleh customer (`customerTargetPrice`) otomatis di-whitelist saat bot merespons/menolak penawaran tersebut, sehingga tidak memicu false-positive halusinasi reprompt.

---

## Proposed Changes (Staged Phases & Micro-Tasks)

### Phase 1: Eliminasi Mutilasi Semantik pada Sanitizer (Anti-Mid-Sentence Mutilation)

Tujuan: Menghentikan pemenggalan kata "Bunda" di tengah kalimat dan menghilangkan glitch double emoji `😊 😊`.

#### [MODIFY] `src/v3/guardrails/sanitizer.ts`
- **Tugas Mikro 1.1**: Revisi `limitVocativeQuota`. Ubah agar HANYA menargetkan panggilan vokatif di awal baris/paragraf atau sapaan pembuka ganda (`Bunda ... Bunda`). Hentikan penggantian string kosong `""` pada kata "Bunda" yang berstatus sebagai bagian kalimat utuh (klausa kata ganti orang / kepemilikan / subjek / objek).
- **Tugas Mikro 1.2**: Hapus `applyPreLocationTone` yang mereplace string awalan `"Bisa banget Bunda"` menjadi `"Kami bantu cekkan dulu ya Bunda 😊 "`, karena menyebabkan tabrakan emoji ganda `😊 😊`. Kontrol nada pre-lokasi dipindahkan sepenuhnya ke prompt layer `location-rules.phase.ts`.

---

### Phase 2: Pemisahan Inquiry Medis dari Mutasi Keranjang di CartManager

Tujuan: Menjamin pertanyaan edukasi/khasiat medis tidak membajak keranjang belanja.

#### [MODIFY] `src/v3/state/cart-manager.ts`
- **Tugas Mikro 2.1**: Tambahkan detektor kalimat interogatif/konsultasi di `CartManager.syncCartItems`.
  - Jika pesan user mengandung tanda tanya `?`, atau kata tanya mekanisme (`bisa untuk`, `apakah bisa`, `manfaat`, `khasiat`, `fungsi`, `buat apa`, `cara kerja`), pesan tersebut DIKATEGORIKAN SEBAGAI INQUIRY dan DILARANG menambahkan item ke keranjang.
  - Komitmen aktif HANYA sah bila kalimat user memuat verba pemilihan/kesepakatan: `mau`, `ambil`, `pilih`, `booking`, `pesan`, `jadwalkan`, `deal`, `fix`, `iya saya ambil`, `oke yang itu`.

---

### Phase 3: Koreksi Domain Model & Recipient Scope untuk Bundle Maternal

Tujuan: Mencegah paket laktasi/oksitosin ibu dilabeli sebagai `[Untuk Si Kecil]`.

#### [MODIFY] `src/v3/state/cart-manager.ts`
- **Tugas Mikro 3.1**: Di `CartManager.detectRecipientScope`:
  - Jika layanan berkategori `BUNDLE`, periksa komponen `bundleItemIds` atau nama layanannya.
  - Bila nama/komponen memuat kata `'laktasi'`, `'oksitosin'`, `'breast'`, `'prenatal'`, `'postpartum'`, `'perineum'`, scope WAJIB dikembalikan sebagai `'MOMS'`, BUKAN `'GENERAL'`.

#### [MODIFY] `src/v3/state/goal-tracker.ts`
- **Tugas Mikro 3.2**: Di baris 380:
  - Perbaiki fallback label penerima: jika `scope === 'GENERAL'` dan `session.targetAudience === 'MOMS'` atau `session.momProfile != null`, label penerima default adalah `'Bunda'`, BUKAN `'Si Kecil'`.

---

### Phase 4: Context-Aware Numeric Fact Validator (Anti-Reprompt Hallucination)

Tujuan: Menghentikan penolakan angka tawar-menawar customer (Rp 900k / 975k) dan mencegah LLM reprompt menimpanya secara paksa dengan Rp 155.000.

#### [MODIFY] `src/v3/guardrails/numeric-fact-validator.ts`
- **Tugas Mikro 4.1**: Tambahkan opsi `customerMentionedPrices?: number[]` ke `NumericValidationOptions`.
- **Tugas Mikro 4.2**: Ekstrak nominal angka yang disebut customer di turn saat ini (misal dari `targetPrice` tool argument atau parsing regex `900k` -> `900000`, `975k` -> `975000`).
- **Tugas Mikro 4.3**: Daftarkan nominal customer tersebut ke `authorizedNumbers`.
  - Jika LLM mengutip angka yang sama untuk menolak atau mengklarifikasi (*"Untuk nominal Rp 900.000 belum ada paket..."*), validator menganggap angka tersebut SAH dan TIDAK MEMICU VIOLATION.
  - Reprompt engine TIDAK AKAN AKTIF dan tidak akan menimpa nominal customer dengan Rp 155.000.

#### [MODIFY] `src/v3/agent/pipeline/guardrail-pipeline.ts`
- **Tugas Mikro 4.4**: Teruskan nominal dari input pesan customer ke `validateNumericFacts`.

---

### Phase 5: Deterministic Location Ingestion pada Router

Tujuan: Memastikan daerah domisili yang disebut customer (seperti *"Di tenggilis kak"*) langsung dicatat ke `session.location` sejak turn pertama.

#### [MODIFY] `src/v3/agent/prompt/phases/router-tool-routing.layer.ts`
- **Tugas Mikro 5.1**: Pertegas aturan routing Call 1: jika customer menyebut nama daerah/kelurahan (termasuk respons pendek seperti *"Di tenggilis kak"*), `calculate_delivery` adalah prioritas nomor 1 di atas `get_clinic_policy_faq`.
- **Tugas Mikro 5.2**: Di `context-grounder.ts`, jika deteksi regex/gazetteer menemukan entitas lokasi valid dari pesan customer, pastikan status lokasi di-grounding sehingga pruner memotong penagihan alamat di turn berikutnya.

---

### Phase 6: State-Driven Anti-Kaset Rusak (Anti-Looping Pertanyaan Keluhan)

Tujuan: Mencegah bot mengulang-ulang *"Apakah saat ini sedang ada keluhan tertentu, atau untuk relaksasi saja?"* sampai 7 kali.

#### [MODIFY] `src/v3/domain/types.ts`
- **Tugas Mikro 6.1**: Tambahkan state flag `complaintOrTreatmentClarified?: boolean;` di `CustomerGoalSession`.

#### [MODIFY] `src/v3/agent/pipeline/context-grounder.ts`
- **Tugas Mikro 6.2**: Jika dalam riwayat percakapan asisten sudah pernah menanyakan keluhan/relaksasi DAN customer sudah merespons (atau customer sudah memilih treatment spesifik seperti Oksitosin), set `session.complaintOrTreatmentClarified = true`.

#### [MODIFY] `src/v3/agent/prompt/layers/core-persona.layer.ts` & `src/v3/agent/prompt/phases/pricing-catalog.phase.ts`
- **Tugas Mikro 6.3**: Bila `complaintOrTreatmentClarified === true`, instruksikan prompt secara tegas untuk TIDAK LAGI menanyakan keluhan fisik vs relaksasi. Cukup gunakan statement penutup hangat atau tanyakan kesiapan waktu/hari.

---

## Verification Plan

### Automated Tests
1. **Unit Test Sanitizer Vocative**:
   - Menjamin kalimat *"layanan yang Bunda maksud"* dan *"kebutuhan Bunda"* tidak dimutilasi.
   - Command: `npx vitest run tests/unit/v3-sanitizer-vocative-quota.test.ts`
2. **Unit Test Cart Inquiry Isolation**:
   - Menjamin pertanyaan *"Breast massage ini bisa untuk memperbanyak asi?"* TIDAK menambahkan item ke keranjang.
   - Command: `npx vitest run tests/unit/v3/cart-single-primary-domain.test.ts`
3. **Unit Test Numeric Whitelist Target Price**:
   - Menjamin penolakan nominal Rp 900.000 / Rp 975.000 tidak memicu reprompt 155.000.
   - Command: `npx vitest run tests/unit/v3-numeric-fact-validator.test.ts`
4. **Full Test Suite & Build Verification**:
   - `npm run build`
   - `npm test`
