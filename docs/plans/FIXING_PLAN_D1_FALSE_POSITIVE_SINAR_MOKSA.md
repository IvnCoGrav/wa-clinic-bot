# FIXING PLAN — Guardrail D1 False-Positive "Sinar Moksa" & POV Violation (Sesi 767713)

- **Tanggal:** 2026-09-20
- **Status:** SELESAI (Fase 1–4 terimplementasi & teruji; full suite 411 files / 2963 passed / 0 failed).
- **Sumber bukti:** log `logs/llm-2026-09-20.jsonl` (conversationId `7e64c620-…`), kode aktual.

---

## 1. Ringkasan Insiden (Multi-Layer Root Cause)

**Skenario:** Customer: bayi 6 bulan, GTM + pilek. Bot menawarkan *Pijat Bayi Pulih Ceria* **+ Sinar Moksa** (sah: pilek = keluhan napas). Guardrail D1 menolak → reprompt → bot menjawab *"informasinya akan kami cek dulu ke tim kami"* → melanggar aturan POV first-person.

### Root cause berlapis (bukan kesalahan AI)

| Layer | Temuan | Bukti |
|---|---|---|
| Tool | `get_catalog_and_price` **tidak pernah** memasukkan add-on ke `result.treatments` (`filtered` → `formattedTreatments`; add-on tersaring) | `get-catalog.tool.ts:364-375` |
| Validator | D1 `catalogNames()` HANYA membaca `result.treatments` turn ini | `factual-claim-validator.ts:120-126, 232-257` |
| Guardrail | D1 false-positive → "Sinar Moksa" dituduh halusinasi padahal layanan add-on resmi katalog | log: `correction: ["Nama layanan \"Sinar Moksa\" tidak ada di katalog turn ini."]` |
| Reprompt | AI menghapus Sinar Moksa lalu **mengarang** frasa "cek ke tim kami" (melempar tanggung jawab) | log V3_REPROMPT 05:56:53 |
| Rules terlanggar | POV first-person (aturan 7/5), nada kompeten Bidan; D1 false-positive | transkrip |

**Insiden kedua (sesi sama):** `"sabtu bisa?"` → Call 1 menghasilkan **"saya bantu cekkan"** (pelanggaran pronoun) → REPROMPT memperbaiki ke "kami". Guardrail pronoun bekerja; akar = Call 1 output.

---

## 2. Prinsip Perbaikan (Mandat Fondasional)

1. **DILARANG** menambah larangan teks "DILARANG bilang cek ke tim" di prompt (tambal-sulam).
2. Validator harus **tahu katalog lengkap tenant** (termasuk add-on) — bukan hanya output tool turn ini.
3. Reprompt untuk "nama layanan tidak dikenal" **tidak boleh terjadi** bila nama itu valid di katalog.
4. Perbaikan di level **validator/tool contract**, bukan prompt.

---

## 3. Fase Perbaikan

### FASE 1 — Validator D1 mengenali katalog penuh tenant (akar)

- **File:** `src/v3/guardrails/factual-claim-validator.ts`
- **Fungsi:** `catalogNames()` (baris 120) + opsi validasi.
- **Perubahan:**
  1. Tambah sumber nama: selain `result.treatments`, tarik **seluruh nama layanan katalog tenant** (via `treatmentCatalogService.getAllServices(true, tenantId)` — sudah diimpor pola serupa di `numeric-fact-validator.ts:113`).
  2. Opsi `opts.tenantId` diteruskan dari `guardrail-pipeline.ts` (sudah tersedia di sana).
  3. Validasi tetap ketat: nama yang diklaim harus **cocok katalog** (token-subset), hanya kini daftar pembandingnya lengkap.
- **Acceptance:**
  - "Sinar Moksa" pada turn pilek → **TIDAK** violation.
  - Nama layanan fiktif (mis. "Pijat Quantum") → **tetap** violation.
- **Test:** `tests/unit/v3/factual-claim-validator.test.ts` + kasus baru (add-on sah; fiktif tertangkap).
- **Risiko:** validator jadi sedikit lebih longgar → mitigasi: tetap menolak nama yang TIDAK ada di katalog mana pun.

### FASE 2 — Grounding add-on agar konsisten (pencegahan)

- **File:** `src/v3/tools/get-catalog.tool.ts`
- **Perubahan:** saat keluhan pernapasan (sama seperti kondisi yang sudah menambah opsi Sinar Moksa di `message`), **sertakan add-on relevan di `result.treatments`** dengan flag `isAddon: true` + `isAddonSuggestion: true`, TANPA mengubah logika rekomendasi utama.
- **Acceptance:** validator & grounding melihat add-on; template combo (`Paket Combo … + Sinar Moksa`) tetap bekerja.
- **Risiko:** rendah; hanya menambah informasi, tidak mengubah pilihan utama.
- **Test:** turn "pilek" → `result.treatments` memuat Sinar Moksa (isAddon true).

### FASE 3 — Reprompt tidak boleh jatuh ke frasa "melempar ke tim" (defense-in-depth, deterministik)

- **File:** `src/v3/agent/pipeline/guardrail-pipeline.ts`
- **Perubahan:** setelah reprompt faktual, cek hasil reprompt dengan **detektor frasa pelemparan** (frasa "cek dulu ke tim/konfirmasi ke tim/diinfokan oleh tim" pada konteks non-jadwal). Bila terdeteksi:
  - gunakan **fallback deterministik**: buang paragraf bermasalah, pertahankan bagian valid (pola `salvageValidSentences` yang sudah ada), atau
  - jatuh ke template jawaban tanpa klaim pelemparan.
- **Acceptance:** hasil akhir TIDAK mengandung frasa pelemparan; bagian valid tetap terkirim.
- **Risiko:** rendah; deterministik, bukan prompt.
- **Test:** reprompt yang menghasilkan "cek ke tim" → final reply bersih.

### FASE 4 — Regression & Verifikasi

- `npx tsc --noEmit` = 0
- `npm run build` = 0
- Suite: factual-validator, guardrail, matrix 23/23, corpus.
- **Replay sesi 767713** via simulator: turn "6 bulan + pilek" → balasan menyebut Sinar Moksa TANPA frasa "cek ke tim".

---

## 4. Yang TIDAK diubah
- Aturan bisnis (Sinar Moksa hanya untuk keluhan napas) — sudah benar.
- Kontrak tool, cart, commitment, session (Stage 4/5/6/7) — tidak tersentuh.
- Prompt persona — tidak ditambah larangan baru.

## 5. Estimasi
| Fase | Lokasi | Risiko |
|---|---|---|
| 1 | factual-claim-validator.ts | sedang |
| 2 | get-catalog.tool.ts | rendah |
| 3 | guardrail-pipeline.ts | rendah |
| 4 | test | — |
