# Implementation Plan (Revisi) — Resolusi Mixed-Intent & Anti-DSML Leakage (Sesi 648324)

- **Status:** RENCANA — menunggu persetujuan eksekusi. Belum ada kode diubah.
- **Tanggal revisi:** 2026-09-20.
- **Dasar:** audit plan asli + verifikasi kode aktual (semua nomor baris di bawah sudah dicek).
- **Prinsip:** Hard Code-Level Guards lintas lapisan. DILARANG: teks prompt "DILARANG...",
  regex gatekeeper intent, hafalan if-else pola kalimat, mutilasi tengah kalimat.

---

## 1. Temuan audit plan asli (ringkas)

| Klaim | Verifikasi |
|---|---|
| DSML Call 2 dilucuti sanitizer → string kosong | ✅ Benar (`sanitizer.ts:91-96` + `isValidReply`, `sanitizer.ts:576-588`) |
| Recovery gate hanya cek katalog | ✅ Benar (`guardrail-pipeline.ts:603-616`) |
| `candidateTreatmentName` hilang di tengah jalan | ✅ Benar dan lebih dalam: JSON LLM (`calculate-delivery.tool.ts:205-234`) tak mendeklarasikannya, Zod (`tool-schemas.ts:3-9`) akan strip, DAN `tool-registry.ts:50` menimpanya dengan `ctx.selectedTreatment` |
| Nomor baris plan asli (generation-stage 685-690, router:19, schemas:3-9) | ⚠️ Sebagian basi — dipakai lokasi terverifikasi di bawah |
| Phase 1 plan asli (blok "DILARANG KERAS" di prompt) | ❌ DITOLAK — melanggar mandat anti solusi prompt-only |
| Phase 2 plan asli | ⚠️ Hanya berguna bila Phase 3 memakai fieldnya (dead data bila berdiri sendiri) |

---

## 2. Arsitektur perbaikan (revisi)

```
Call 1 → calculate_delivery(+candidateTreatmentName) → suggestedTemplateReply
   │                                                          │
   ▼                                                          ▼
Call 2 (tanpa perubahan perilaku; hanya observability DSML)
   │
   ▼ (draft kosong / tak valid)
Guardrail Recovery: katalog → DELIVERY (template resmi + echo intent user) → fallback generik
```

**Yang TIDAK dilakukan:** blok teks larangan di prompt, regex intent, perubahan atomic routing,
perubahan kontrak save_reservation, perubahan threshold guardrail lain.

---

## FASE 0 — Prasyarat & Reproduksi (read-only + test, tanpa ubah perilaku)

**Tujuan:** pastikan evidence dan baseline sebelum menyentuh kode.

- **MT-0.1 — Konfirmasi evidence log.** Buka `logs/llm-*.jsonl` turn mixed-intent: Call 1 memanggil
  `calculate_delivery`, Call 2 mengandung tag DSML, guardrail menjatuhkan ke fallback kaleng.
  Jika tidak dapat direproduksi dari log, STOP dan laporkan (jangan eksekusi buta).
- **MT-0.2 — Baseline test.** Jalankan dan catat hasil: `npx tsc --noEmit`,
  `npx vitest run tests/unit/v3-persona-rules.test.ts`,
  test guardrail/sanitizer terkait. Semua harus hijau SEBELUM mulai (kecuali yang sudah
  tercatat merah di KNOWN_ISSUES).
- **Regression gate Fase 0:** baseline tercatat. Lanjut hanya bila baseline jelas.

---

## FASE 1 — Observability Kebocoran DSML Call 2 (tanpa ubah perilaku)

**Tujuan:** deteksi terukur([](bukan prompt larangan). Sanitizer DSML sudah ada
(`sanitizer.ts:91-96`); yang kurang hanya telemetri di titik generasi.

- **MT-1.1 — Log intersepsi DSML di generation-stage.**
  - **File:** `src/v3/agent/pipeline/generation-stage.ts`
  - **Lokasi:** tepat setelah `secondData` diterima di `generateReply` (setelah blok
    `executeChatCompletion` Call 2, sekitar baris 707-719 — verifikasi ulang nomor baris
    saat eksekusi karena file aktif berubah).
  - **Aksi prosedural:**
    1. Ambil `rawContent` dari pesan asisten Call 2 (sebelum sanitasi).
    2. Jika mengandung pola tag tool-call (`<｜｜DSML｜｜`, `<invoke`, `<tool_call>`) DAN hasil
       bersihnya kosong/tak valid → tulis SATU baris log JSON:
       `event: 'CALL2_DSML_LEAKAGE_INTERCEPTED'` + `tenantId`, `conversationId`,
       100 char pertama konten mentah, timestamp.
    3. DILARANG mengubah isi balasan di sini; DILARANG menambah teks instruksi ke prompt.
  - **Acceptance:** replay Turn 3 sesi 648324 menghasilkan baris log event tersebut;
    tidak ada perubahan balasan akhir akibat MT ini.
- **Regression gate Fase 1:** `npx tsc --noEmit` + `tests/unit/v3-persona-rules.test.ts` hijau.

---

## FASE 2 — candidateTreatmentName End-to-End (kontrak tool, prasyarat Fase 3)

**Tujuan:** menutup 3 titik putus rantai agar nama treatment dari pesan customer mengalir
sampai ke `suggestedTemplateReply` delivery. Tanpa ini, Fase 3 tak punya data treatment.

- **MT-2.1 — Skema validasi Zod.**
  - **File:** `src/v3/tools/tool-schemas.ts` (blok `CalculateDeliveryArgsSchema`, baris 3-9 terverifikasi)
  - **Aksi:** tambah `candidateTreatmentName: z.string().optional()` setelah `streetDetail`.
    Komentar: kontrak data Stage 6 / sesi 648324, bukan perilaku.
  - **Acceptance:** `validateToolArgs('calculate_delivery', {locationText:'X', candidateTreatmentName:'Pijat Bayi'})`
    sukses dan field lolos (tidak di-strip).
- **MT-2.2 — Skema JSON untuk LLM.**
  - **File:** `src/v3/tools/calculate-delivery.tool.ts` (blok `parameters.properties`, baris 212-230 terverifikasi)
  - **Aksi:** tambah properti `candidateTreatmentName` (`type: string`, deskripsi netral SATU kalimat:
    "Nama perawatan yang disebut customer pada pesan saat ini, bila ada; kosongkan bila tidak disebut.").
    DILARANG menambah kalimat larangan/perintah perilaku.
  - **Acceptance:** skema terkirim ke LLM memuat properti baru; `required` tetap `['locationText']`.
- **MT-2.3 — Pemetaan registry (akar putusnya rantai).**
  - **File:** `src/v3/tools/tool-registry.ts` (blok `case 'calculate_delivery'`, baris 44-56 terverifikasi)
  - **Aksi:** ubah baris 50 menjadi `candidateTreatmentName: args.candidateTreatmentName ?? ctx.selectedTreatment,`
    dengan komentar: args LLM menang (konteks turn ini), session sebagai fallback.
  - **Acceptance:** unit test: args berisi nama → tool menerima nama itu; args kosong → fallback session (perilaku lama lestari).
- **MT-2.4 — Instruksi routing SATU kalimat netral (lapis sekunder, bukan guardrail).**
  - **File:** `src/v3/agent/prompt/phases/router-tool-routing.layer.ts` (blok `calculate_delivery`, baris ~20 terverifikasi —
    cari anchor teks "Wajib dipanggil HANYA jika pesan customer SAAT INI menyebutkan entitas lokasi baru")
  - **Aksi:** tambah SATU kalimat netral setelah kalimat locationText: "Bila pesan yang sama menyebut nama
    perawatan, isi juga candidateTreatmentName dengan nama tersebut apa adanya."
    DILARANG menambah kata "DILARANG/WAJIB berperilaku/ancam".
  - **Acceptance:** prompt router memuat kalimat itu; tidak ada perubahan perilaku selain field terisi.
- **Regression gate Fase 2:** `npx tsc --noEmit` hijau + test skema baru hijau.
  Verifikasi rantai: pesan campuran → `validation.data.candidateTreatmentName` terisi →
  `executeCalculateDelivery` menerima → `suggestedTemplateReply`/CTA memuat nama treatment.

---

## FASE 3 — Grounded Delivery Recovery (inti perbaikan)

**Tujuan:** saat draf akhir kosong/tak valid DAN `calculate_delivery` tereksekusi, gunakan
data resmi delivery — bukan kaleng buntu. Recovery WAJIB mengakui seluruh intent user
(lokasi + treatment + jadwal) tanpa mengarang ketersediaan/harga.

- **MT-3.1 — Cabang recovery delivery.**
  - **File:** `src/v3/agent/pipeline/guardrail-pipeline.ts` (blok `if (!isEscalated && ...)`, baris 603-616 terverifikasi)
  - **Aksi prosedural:**
    1. Setelah cabang `catalogTool` (baris 605-610, JANGAN ubah), tambah cabang `else if`:
       cari `executedTools` bernama `calculate_delivery` yang `result?.suggestedTemplateReply` non-kosong.
    2. Jika ketemu → `finalReply = suggestedTemplateReply` + log
       `event: 'DELIVERY_RECOVERY_APPLIED'` (tenantId, conversationId, timestamp).
    3. Jika tidak → jatuh ke `buildInvalidReplyFallback` seperti semula (baris 611-615, JANGAN ubah).
  - **Acceptance:** draf kosong + delivery tereksekusi → balasan = template resmi delivery
    (bukan kaleng); tanpa delivery → perilaku lama persis.
- **MT-3.2 — Echo intent campuran TANPA mengarang (anti halusinasi).**
  - **Lokasi sama** (dalam cabang MT-3.1).
  - **Aksi:** bila `candidateTreatmentName` (dari args tool Call 1) atau sinyal hari dari pesan
    user tersedia di artefak turn, sertakan SATU kalimat pengakuan netral sebelum template,
    mis. pola: "Untuk [treatment] pada [hari] di [wilayah] — " + template delivery.
    ATURAN KERAS: hanya gema apa yang user nyatakan (nama treatment & hari dari artefak);
    DILARANG menegaskan ketersediaan slot, harga, atau kepastian jadwal (itu ranah
    `save_reservation`/tim).
  - **Acceptance:** replay Turn 3 → balasan menyebut homecare/Gedangan (kecamatan luas →
    minta kelurahan, dari template), menyebut Pijat Bayi + Sinar Moksa + Sabtu SEBAGAI
    gema permintaan (bukan janji), TANPA kalimat kaleng lama.
- **Regression gate Fase 3:** test sanitizer + guardrail hijau; test baru MT-3.3 hijau.
- **MT-3.3 — Test baru (wajib).**
  - `delivery recovery dipakai saat draf kosong + delivery ada` (template dipakai).
  - `recovery TIDAK dipakai saat draf valid` (jalur normal tak tersentuh).
  - `echo intent tidak mengarang ketersediaan` (tidak ada kata janji slot/harga).
  - `fallback generik tetap dipakai bila tak ada tool grounding`.

---

## FASE 4 — Verifikasi & Batasan Jujur

- **MT-4.1 — Gate otomatis:** `npx tsc --noEmit`, `npm run build`, seluruh suite terkait
  (`v3-persona-rules`, guardrail, sanitizer, tool-schemas/registry bila ada).
- **MT-4.2 — Replay Turn 3 sesi 648324** via simulator (`npm run chat`): pesan campuran
  lokasi + treatment + jadwal → ekspektasi: (a) tidak ada pesan kaleng lama, (b) template
  delivery resmi muncul, (c) treatment & hari diakui sebagai gema, (d) baris log
  `DELIVERY_RECOVERY_APPLIED` tercatat bila jalur recovery terpicu.
- **MT-4.3 — Catat batasan (WAJIB, bukan opsional):** atomic routing 1-tool/turn berarti
  treatment & jadwal pada pesan campuran TIDAK mendapat grounding tool sendiri.
  Plan ini menjamin bot tidak diam + menjawab dari data yang ada, BUKAN menjamin
  semua intent ter-grounding penuh. Grounding paralel pra-generasi dicatat sebagai
  tech debt terpisah dengan keputusan desain tersendiri.

---

## 3. Non-goals (dilarang dalam eksekusi plan ini)

1. Menambah teks "DILARANG..." ke prompt mana pun.
2. Regex gatekeeper intent / if-else hafalan pola kalimat.
3. Mengubah atomic routing, kontrak `save_reservation`, threshold guardrail lain.
4. Mengubah perilaku jalur normal (recovery hanya aktif saat draf tak valid).
5. Mengklaim mixed-intent "selesai penuh" — lihat MT-4.3.

## 4. Estimasi & risiko

| Fase | Sifat | Risiko |
|---|---|---|
| 0 | Verifikasi | Nol (read-only + test) |
| 1 | Observability | Rendah (log saja) |
| 2 | Kontrak tool | Sedang (3 file schema/registry/prompt; diikat test) |
| 3 | Guardrail recovery | Sedang (satu cabang + echo terikat artefak; diikat test) |
| 4 | Verifikasi | — |

Rollback per fase: revert commit fase terkait (fase independen, tidak saling menimpa
kecuali Fase 2→3 yang berurutan).
