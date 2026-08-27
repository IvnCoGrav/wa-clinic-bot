# Plan Perbaikan Halusinasi E1 — Wonorejo & Alamat SBY

Tanggal: 2026-08-27
Konteks: Laporan `PROMO [E1]` — 2 turn halusinasi:
- Turn `Alamatnya sby mana ya bubid?` ekstraktor benar `ask_clinic_origin` tapi balasan LLM jadi generik `Terima kasih Bunda, bisa tolong diinformasikan nama kelurahan...` tanpa `Waru, Sidoarjo`.
- Turn `Kalo homecare ke wonorejo II np 25 tegalsari surabaya ada biaya ongkir ga ya?` balasan jadi vague `akan dihitung berdasarkan jarak...` tanpa angka deterministik, tidak pakai `TEMPLATES.ongkirInfo`.

Tujuan: Nol halusinasi lokasi/ongkir; jawaban alamat klinik wajib verbatim; Wonorejo-Tegalsari wajib resolve presisi + ongkir promo deterministik.

## Diagnosis Akar Masalah

1. **`slot-engine.ts` + `reply-generator.ts` — LLM overriding mandatoryDirective**
   - `DecisionMatrix` sudah benar set `deterministicTemplateReply = TEMPLATES.clinicOriginPolicy()` untuk `ask_clinic_origin`.
   - Tapi `slot-engine.ts:230` tetap lanjut ke `ReplyGenerator` (LLM Call 2) dengan `grounding.mandatoryDirective` disuntik di `PersonaComposer` *setelah* `deliveryFactsText` dan *sebelum* `PANDUAN PENUTUP (FOKUS LOKASI)`.
   - LLM memilih prioritas `dynamicCloserService` (wajib tanya kelurahan, DILARANG sebut ongkir/jarak) ketimbang `mandatoryDirective`. Hasil: `rawReasoning` di log `llm_1787813595543` tidak mengandung `Waru` sama sekali.
   - Tidak ada guard post-generation yang cek keberadaan `mandatoryDirective` di balasan.

2. **`persona-composer.ts` — Hierarki prompt terbalik**
   - `INFORMASI / JAWABAN RESMI WAJIB` ditaruh di tengah grounding (`mandatorySection`) tanpa penanda `WAJIB TAMPIL VERBATIM DI PARAGRAF 1`.
   - `PRINSIP STRUKTUR BALASAN` tidak paksa LLM untuk render `mandatoryDirective` dulu sebelum closer.

3. **`response-validator.ts` — Celah validasi vague-ongkir**
   - Hanya block `berkisar antara Rp x hingga Rp y`, `jaraknya kurang lebih X km` tanpa `isLocationConfirmed`.
   - Tidak block kalimat vague `akan dihitung berdasarkan jarak dari Waru` ketika `deliveryFacts == null`. Kalimat ini yang muncul di turn Wonorejo.

4. **`geocoding.ts` — Normalisasi Wonorejo II belum komplit**
   - Sudah ada `np -> no` tapi `II` (Romawi) dan `wonorejo II` belum di-strip → `findBestGazetteerMatch` bisa miss composite `Wonorejo + Tegalsari` jika span mengandung `II`.

5. **`decision-matrix.ts` — Composite geocode query belum hardened**
   - Untuk `wonorejo II np 25 tegalsari surabaya`, extractor `locationText: tegalsari surabaya` + `streetDetail: wonorejo II np 25` sudah benar, tapi `geocodeQuery` komposit belum tentu prioritas kelurahan Tegalsari-Wonorejo kalau normalisasi kurang.

## Prinsip Perbaikan (SaaS-ready, Anti-Hardcode)

- Tenant-aware: `homebase`, `coverage`, `ongkir promo` tetap dari DB/service, tidak hardcode baru.
- Regex hanya untuk sanitasi teknis (`np`→`no`, strip `II`, validasi `mandatoryDirective`), bukan gatekeeper intent.
- Semua guard deterministik, tidak tambah LLM call.

## Rencana Bertahap (4 Fase)

### Fase 1 — Deterministic Bypass untuk `ask_clinic_origin` (Paling Kritis)
- **File:** `src/slot-engine/slot-engine.ts`
- **Aksi:**
  - Jika `decision.deterministicTemplateReply` mengandung `Homebase kami ada di` (clinicOriginPolicy) ATAU `extraction.intents` hanya `ask_clinic_origin` → **kirim langsung** tanpa `ReplyGenerator`. Gabungkan `deterministicTemplateReply` + `askKelurahanDetail` style closer yang sudah ada di `TEMPLATES`? Tetap 1 pertanyaan: `Homebase...` lalu `Kalau boleh tahu, nama kelurahan...`.
  - Fallback: jika bypass tidak dipakai, wajibkan post-check (Fase 2).
- **Kriteria selesai:** Turn `Alamatnya sby mana ya?` selalu balasan mengandung `Waru, Sidoarjo` + `Homecare` + tanya kelurahan; tidak pernah generik.

### Fase 2 — Hard Guard `mandatoryDirective` + Vague-Ongkir di `ResponseValidator` & `ReplyGenerator`
- **File:** `src/slot-engine/response-validator.ts`, `src/slot-engine/reply-generator.ts`, `src/slot-engine/persona-composer.ts`
- **Aksi:**
  - `ResponseValidator.validate(reply, slate, { mandatoryDirective, isOngkirAlreadySent, deliveryFacts })`:
    - Jika `mandatoryDirective` ada dan `reply` tidak mengandung substring kunci (`Waru` atau `Homecare` atau `Sidoarjo`) → `violations: MISSING_MANDATORY_DIRECTIVE`, `fallbackReply = mandatoryDirective + closer kelurahan`.
    - Tambah `HALLUCINATED_VAGUE_ONGKIR`: regex `akan dihitung berdasarkan jarak|biaya ongkir akan dihitung|ongkir akan dihitung` ketika `deliveryFacts==null` atau `!isLocationConfirmed` → fallback tanya kelurahan.
  - `ReplyGenerator.generate`: sebelum LLM, jika `!isLocationConfirmed` set `deliveryText` jadi warning keras `DILARANG KERAS MENGARANG ANGKA...` (sudah ada) + setelah LLM, panggil `ResponseValidator` dengan `mandatoryDirective` param dan paksa `fallbackReply` bila violation.
  - `PersonaComposer.composeSlotGeneratorPrompt`: naikkan `mandatorySection` ke ATAS dengan header `⚠️ INFORMASI WAJIB — WAJIB TAMPIL VERBATIM DI PARAGRAF 1 SEBELUM CLOSER` dan tambah instruksi `JIKA mandatoryDirective ADA, paragraf pertama WAJIB memuatnya verbatim, baru lanjut ke closer tanya kelurahan`.
- **Kriteria selesai:** Validator test `MISSING_MANDATORY_DIRECTIVE` & `HALLUCINATED_VAGUE_ONGKIR` pass; live log `ask_clinic_origin` selalu mengandung `Waru`.

### Fase 3 — Normalisasi Geocoding Wonorejo-Tegalsari
- **File:** `src/integrations/google-maps/geocoding.ts`
- **Aksi:**
  - Di `mockGeocodeText` cleanText: tambah `.replace(/\b(np|no\.?)\s*(\d+)/gi,'no $2')` sudah ada, tambah `.replace(/\b(ii|iii|iv|v)\b/gi,'')` dan `.replace(/\s{2,}/g,' ')` agar `wonorejo II np 25` → `wonorejo no 25`.
  - Pastikan `generateCandidateSpans` dan `findBestGazetteerMatch` composite check (`wonorejo` + `tegalsari`) tetap score 2.0 meski ada `no 25`.
  - Tambah log `[GEOCODING LOCAL HIT]` tetap.
- **Kriteria selesai:** `geocodingService.geocodeText('wonorejo II np 25 tegalsari surabaya')` → `isPrecise:true, kelurahan:Tegalsari` (atau Wonorejo sesuai gazetteer), `geocodeText('wonorejo ii no 25 tegalsari')` konsisten. Unit test `wonorejo-tegalsari-e2e` pass.

### Fase 4 — DecisionMatrix Hardening & Paritas Test
- **File:** `src/slot-engine/decision-matrix.ts`, `tests/unit/wonorejo-tegalsari-e2e.test.ts`, `tests/unit/slot-engine-response-validator.test.ts`
- **Aksi:**
  - Pastikan `isClinicOriginIntent && !hasPhysicalSymptoms` tidak ter-trigger saat ada `provide_location` (sudah benar).
  - Untuk `wonorejo... ada biaya ongkir ga ya?` → `shouldResolveLocation = true` → `geocodeText(compositeAddress)` → `TEMPLATES.ongkirInfo` deterministik `Jika dilihat dari jaraknya kurang lebih...` bukan `akan dihitung...`.
  - Tambah test: Turn 1 tanpa LLM (deterministic bypass), Turn 2 ongkirInfo mengandung `tambahan ongkir` + `promo`, tidak mengandung `akan dihitung berdasarkan jarak`.
- **Kriteria selesai:** `npm test` green; tidak ada regresi `centralized-persona-architecture`, `slot-engine-conversational-flow`.

## Urutan Eksekusi

1. Fase 1 → 2 (bisa paralel, tapi 1 dulu biar dampak langsung keliatan).
2. Fase 3 → 4.
3. Verifikasi: `npx vitest run tests/unit/wonorejo-tegalsari-e2e.test.ts tests/unit/slot-engine-response-validator.test.ts` + `npm run build` typecheck.

## Risiko & Mitigasi

- Bypass LLM untuk `ask_clinic_origin` bisa bikin balasan terasa template — mitigasi: tetap pakai `mandatoryDirective + closer` yang hangat (sudah ada di TEMPLATES).
- Validator terlalu strict → false positive `HALLUCINATED_VAGUE_ONGKIR` untuk jawaban edukasi — batasi hanya ketika `reply` mengandung `akan dihitung` + `deliveryFacts==null`.

## Deliverable

- 4 file utama berubah: `slot-engine.ts`, `response-validator.ts`, `reply-generator.ts`/`persona-composer.ts`, `geocoding.ts`.
- 2 test file diperkuat: `wonorejo-tegalsari-e2e`, `slot-engine-response-validator`.
- Dokumen ini sebagai gate sebelum commit.
