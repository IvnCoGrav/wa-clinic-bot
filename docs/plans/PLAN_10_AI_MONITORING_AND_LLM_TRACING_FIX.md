# PLAN 10 (Revisi) — Perbaikan Sistemik AI Monitoring Dashboard & Dedicated LLM Execution Tracing

- **Status**: REVISI — menunggu persetujuan eksekusi. Belum ada kode diubah.
- **Tanggal revisi**: 2026-09-22.
- **Dasar**: audit plan asli vs kode aktual (semua nomor baris di bawah sudah dicek terhadap tree `eb0d6826`).
- **Prinsip**: Hard Code-Level Guards & data-driven. DILARANG: teks prompt "DILARANG...", regex gatekeeper intent, hafalan if-else pola kalimat, mutilasi tengah kalimat, hardcode daftar dimensi di dashboard, rename writer tanpa migrasi data.

---

## 1. Temuan audit plan asli (ringkas)

| Klaim plan asli | Verifikasi |
|---|---|
| Filter `NLU_EXTRACTOR` menghilangkan log `SLOT_EXTRACTOR` | ✅ Benar (`llm-execution-logger.ts:301-318`; tombol filter `Debug.tsx:1047` hanya kirim `NLU_EXTRACTOR`) |
| Bug `useEffect` polling reset saat accordion diklik + auto-expand paksa `data[0]` | ✅ Benar (`Debug.tsx:759-787`, deps `:787`; interval `:794-800`; auto-expand `:771-776`) |
| Polling ganda boros tanpa pandang viewMode | ✅ Benar (`Debug.tsx:762-765`, `Promise.allSettled` 300 + 150) |
| Header kartu sembunyikan `actualProvider`/`actualModel` | ✅ Benar, tapi backend SUDAH expose (`llm-execution-logger.ts:28-30`, mapping `:179-180`) — gap murni frontend |
| Fragmentasi bubble, heuristic hanya cek `bubbles[0]` | ✅ Benar (`:387`), TAPI window aktual **35 dtk** (`:389`), bukan 45 — angka plan keliru |
| Feedback JSON mentah di tab Kualitas | ✅ Benar (produsen `llm-evaluator.service.ts:200-203`; konsumen `AiEvaluations.tsx:358-365`; sumber dimensi `evals/persona-rubric.ts:14`) |
| Inkonsistensi `task_type` audit buffer | ✅ Observasi benar (`entity-extractor.service.ts:666,724` vs `:690`), ❌ solusi rename writer DITOLAK (split-brain, lihat Fase 1) |
| MT-1.3 "expose actualProvider/actualModel" | ❌ NO-OP — sudah ada. Dihapus dari plan |
| Lokasi MT-3.1 "Baris 60-70" | ⚠️ Basi — `:60-70` adalah `formatRupiah`/awal komponen; helper parser adalah fungsi BARU. `:358-365` benar (sel feedback) |
| Tenant-isolation buffer debug | ❌ TIDAK DIBAHAS plan asli — temuan audit baru, lihat Fase 0 MT-0.3 |

---

## 2. Arsitektur perbaikan (revisi)

```
Fase 0: baseline + keputusan tenant (read-only, tanpa ubah perilaku)
Fase 1: backend — alias baca NLU/SLOT di filter + grouping multi-bubble (window tetap 35 dtk)
        + plumbing tenantId + alias baca task_type audit (TANPA rename writer)
Fase 2: Debug.tsx — ref anti-reset polling + fetch selektif per viewMode + stats per mode
        + tampil actualProvider/actualModel + dark-mode select/search
Fase 3: AiEvaluations.tsx — parser feedback data-driven (parse JSON dalam string, tanpa hardcode
        dimensi) + touch target + layout mobile
Fase 4: verifikasi scoped + CHANGELOG + KNOWN_ISSUES
```

**Yang TIDAK dilakukan:** rename `task_type` di writer, perubahan window 35→45 dtk, blok teks larangan di prompt, regex intent, perubahan kontrak tool V3, perubahan threshold guardrail, dependency baru.

---

## FASE 0 — Baseline & Keputusan Tenant (read-only + test, tanpa ubah perilaku)

**Tujuan:** evidence tercatat dan keputusan tenant diambil SEBELUM menyentuh kode.

- **MT-0.1 — Baseline test.** Jalankan dan catat hasil (harus hijau sebelum lanjut, kecuali yang sudah merah di KNOWN_ISSUES):
  ```powershell
  npm run build
  npx vitest run tests/unit/hierarchical-debug-logs.test.ts tests/unit/llm-execution-tracing-deepseek.test.ts tests/unit/cg09-pii-redaction.test.ts
  ```
- **MT-0.2 — Konfirmasi evidence.** Buka `logs/llm-*.jsonl` (atau buffer `/api/admin/debug/llm-logs?flow=NLU_EXTRACTOR`): pastikan ada record `SLOT_EXTRACTOR` yang hilang saat filter `NLU_EXTRACTOR`. Buka `/admin/debug`: klik accordion → pastikan interval 6 dtk ter-reset (indikator auto-sync / DevTools Network). Jika tidak tereproduksi, STOP dan laporkan.
- **MT-0.3 — Keputusan tenant (Confirmation Gate SaaS-readiness).** Fakta: buffer debug in-memory global tanpa filter tenant (`llm-execution-logger.ts:301`, `335`; endpoint `evaluations.subroute.ts:521-566` tanpa param tenant), sedangkan `ai-audit-summary` hardcode `DEFAULT_TENANT_ID` (`evaluations.subroute.ts:377`). Field `tenantId` SUDAH ada di `LlmExecutionRecord` (`:25`) — jadi plumbing filter adalah infra kecil, bukan infra baru. Keputusan default plan ini: **laksanakan MT-1.4 (plumbing filter)**. Bila saat eksekusi ternyata call-site V3 belum membawa tenantId dan butuh refactor pipeline, STOP, catat sebagai debt di `KNOWN_ISSUES.md`, lanjutkan fase lain.
- **Regression gate Fase 0:** baseline + evidence + keputusan tercatat. Lanjut hanya bila jelas.

---

## FASE 1 — Backend Logging Engine & Korelasi Pipeline

**Tujuan:** akar data tuntas — alias filter, grouping tahan out-of-order, tenant plumbing, alias baca audit. Semua diikat test baru (TDD: tulis test dulu, merah, lalu fix, hijau).

### [MODIFY] `src/utils/llm-execution-logger.ts`

- **MT-1.1 — Alias baca `SLOT_EXTRACTOR` pada filter `NLU_EXTRACTOR`.**
  - **File:** `src/utils/llm-execution-logger.ts`, blok `getLlmExecutionLogs`, baris 301-318 terverifikasi.
  - **Aksi prosedural:** ganti cabang `else` (`:313-315`) menjadi:
    ```ts
    } else if (flowFilter === 'NLU_EXTRACTOR') {
      logs = logs.filter((l) => l.flowType === 'NLU_EXTRACTOR' || l.flowType === 'SLOT_EXTRACTOR');
    } else {
      logs = logs.filter((l) => l.flowType === flowFilter);
    }
    ```
    Cabang `V3_GENERATION` (`:304-312`) JANGAN diubah. Tidak ada rename tipe, tidak ada migrasi data.
  - **Acceptance:** record 1× `NLU_EXTRACTOR` + 1× `SLOT_EXTRACTOR`, `getLlmExecutionLogs(100, 'NLU_EXTRACTOR')` kembalikan 2; filter lain (`V3_ROUTING`, dsb.) tak tersentuh.
- **MT-1.2 — Grouping multi-bubble tahan out-of-order (window TETAP 35 dtk).**
  - **File:** sama, blok heuristic baris 381-401 terverifikasi.
  - **Aksi prosedural:**
    1. Ganti pencarian `bubbles[0]`-saja (`:387-400`) menjadi iterasi mundur seluruh `bubbles` (bubble terbaru dulu): untuk tiap kandidat hitung `isTimeClose` dengan ambang **tetap `< 35000`** (`:389` JANGAN diubah angkanya) + `isInputMatching` dengan logika yang sama (`:390-395`).
    2. Ambil kandidat pertama yang cocok; bila tak ada → jalur `else` pembuatan bubble baru seperti semula (`:414-432` JANGAN diubah).
    3. Komentar: jendela 35 dtk dipertahankan (perilaku grouping lama lestari); yang berubah hanya ketahanan urutan tiba.
  - **Acceptance:** 3 record satu bubble dimasukkan dengan urutan acak (generation dulu, extractor terakhir, tanpa `bubbleCorrelationId`, input sama, selisih < 35 dtk) → tepat 1 bubble berisi 3 calls terurut `FLOW_ORDER`. Record berselisih > 35 dtk → tetap 2 bubble (perilaku lama).
- **MT-1.3 — Plumbing filter `tenantId` (dengan pintu keluar debt).**
  - **File:** sama + `src/routes/admin/evaluations.subroute.ts` (endpoint `:521-566`).
  - **Aksi prosedural:**
    1. Tambahkan param opsional `tenantId?: string` pada `getLlmExecutionLogs(limit, flowFilter?, tenantId?)` dan `getGroupedLlmExecutionLogs(limit, flowFilter?, tenantId?)`; bila diisi, filter `l.tenantId === tenantId` (record tanpa tenantId tetap lolos bila filter kosong — perilaku lama lestari untuk single-tenant).
    2. Teruskan query `?tenant=` di kedua endpoint debug ke fungsi tersebut.
    3. Isi `tenantId` di call-site `recordLlmExecution` yang sudah punya konteks tenant (cek `entity-extractor.service.ts:689-706` — `context?.tenantId` tersedia di `extract()` (`:437-438`); teruskan ke record). Call-site V3: cek saat eksekusi — bila tenantId tidak tersedia tanpa refactor pipeline, JANGAN refactor; catat debt (lihat MT-4.2).
  - **Acceptance:** record 2 tenant berbeda → query tanpa filter kembalikan semua (kompatibel lama); query `tenant=A` hanya kembalikan A. Endpoint debug menerima `?tenant=` tanpa error.
- **MT-1.4 — Alias BACA `task_type` audit (pengganti rename writer yang DITOLAK).**
  - **Fakta:** writer audit `task_type: 'SLOT_EXTRACTOR'` (`entity-extractor.service.ts:666,724`) vs execution-logger `'NLU_EXTRACTOR'` (`:690`). Rename writer = split-brain (baris lama vs baru, badge `AiEvaluations.tsx:239` pecah dua label).
  - **Aksi prosedural:** JANGAN ubah `:666`/`:724`. Tambahkan normalisasi di lapisan BACA audit summary (`evaluations.subroute.ts`, query `ai-audit-summary` sekitar `:367-380`): petakan `SLOT_EXTRACTOR` → label tampil `NLU_EXTRACTOR` saat agregasi respons (atau helper `normalizeAuditTaskType()` di `llm-audit-buffer.ts` bila dipakai >1 endpoint). Data DB tidak disentuh.
  - **Acceptance:** respons `ai-audit-summary` menampilkan satu label konsisten untuk kedua varian; tidak ada migrasi DB; tidak ada perubahan writer.

### [TEST] Test baru Fase 1 (wajib, TDD)

- **MT-1.5 — Test di `tests/unit/hierarchical-debug-logs.test.ts`** (file eksisting 126 baris, pola `recordLlmExecution` + `clearLlmExecutionLogs` di `beforeEach` sudah ada):
  1. `filter NLU_EXTRACTOR menyertakan SLOT_EXTRACTOR` (MT-1.1).
  2. `grouping tahan out-of-order tanpa correlationId` (MT-1.2) + `window >35 dtk tetap pecah bubble`.
  3. `filter tenantId` (MT-1.3).
- **MT-1.6 — Test alias audit** di file test audit yang relevan (atau perluasan `llm-execution-tracing-deepseek.test.ts` bila memuat agregasi task_type): `SLOT_EXTRACTOR` dan `NLU_EXTRACTOR` ternormalisasi satu label di lapisan baca.
- **Regression gate Fase 1:**
  ```powershell
  npm run build
  npx vitest run tests/unit/hierarchical-debug-logs.test.ts tests/unit/llm-execution-tracing-deepseek.test.ts tests/unit/cg09-pii-redaction.test.ts
  ```
  Rollback fase: revert commit Fase 1 (independen dari fase lain).

---

## FASE 2 — Observability & Performa Dedicated LLM Tracing (`Debug.tsx`)

**Tujuan:** polling stabil, bandwidth hemat, provider aktual transparan. Tanpa ubah kontrak API (param `?tenant=` aditif).

### [MODIFY] `packages/admin-dashboard/src/pages/tenant/Debug.tsx` (total 1633 baris)

- **MT-2.1 — Pisahkan `expandedPhones` dari deps `loadLogs` (state-machine fix).**
  - **Lokasi:** `loadLogs` baris 759-787 terverifikasi; interval `:794-800`.
  - **Aksi prosedural:**
    1. Tambah `const isInitialLoadedRef = useRef(false)` (butuh import `useRef` — cek import React di kepala file).
    2. Pindahkan blok auto-expand (`:770-777`) ke pola ref: hanya ekspansi `data[0]` bila `!isInitialLoadedRef.current`, lalu set `true`. Operator menutup semua accordion → TETAP tertutup saat data baru masuk.
    3. Hapus `expandedPhones` dari deps `:787` → `[flowFilter]`. `flowFilter` dipertahankan sebagai dep (atau ref bila linter menuntut — pilih satu, jangan dua mekanisme).
    4. Klik `togglePhone` (`:802-804`) tidak lagi me-reset interval 6 dtk.
  - **Acceptance:** buka/tutup accordion → request berikutnya tetap 6 dtk dari jadwal semula (cek DevTools Network, tidak ada burst refetch); tutup semua → tidak terbuka paksa.
- **MT-2.2 — Fetch selektif per `viewMode` + stats per mode.**
  - **Lokasi:** `:762-781` terverifikasi; stats `:927-929` (dihitung dari `groupedData` saja).
  - **Aksi prosedural:**
    1. Ganti `Promise.allSettled` ganda menjadi cabang: `viewMode === 'grouped'` → hanya `llm-grouped-logs?limit=300&flow=...`; else → hanya `llm-logs?limit=150&flow=...`. Sertakan `&tenant=` bila filter tenant aktif (lihat MT-1.3). Tambahkan `viewMode` ke deps yang relevan tanpa mengembalikan bug MT-2.1 (cabang di dalam `loadLogs`, bukan fetch ganda).
    2. Perbaiki stats: saat `viewMode === 'flat'`, hitung dari `flatLogs` (jumlah calls; bubbles/customers tampil `-`/dihitung dari наивный group sementara — pilih dan dokumentasikan di komentar, jangan tampilkan angka basi dari `groupedData`).
  - **Acceptance:** tiap 6 dtk hanya 1 request sesuai mode; header stats konsisten di kedua mode.
- **MT-2.3 — Interface + tampil `actualProvider`/`actualModel`.**
  - **Lokasi:** interface `LlmLogEntry` `:659-686` (BELUM punya kedua field — tambah `actualProvider?: string; actualModel?: string;`); kartu AI step `:1272-1276` (hanya `modelUsed`).
  - **Aksi prosedural:** tambah pill provider aktual di sebelah `modelUsed` (mis. `call.actualProvider || derive dari baseUrl` bila ada; model aktual `call.actualModel || call.modelUsed`). Bila `call.status === 'FALLBACK'`, tampilkan label jalur (configured → aktual). Styling ikut pola badge eksisting (`getFlowBadge`, `:705-729`).
  - **Acceptance:** call fallback menampilkan dua info (model terkonfigurasi vs aktual); call normal tidak berubah visual selain pill tambahan.
- **MT-2.4 — Dark-mode select + search (polish, boleh dipisah commit).**
  - **Lokasi:** `:1069-1078` dan `:1081-1087` terverifikasi tanpa varian `dark:`.
  - **Aksi:** tambah `dark:bg-[#202c33] dark:border-[#374248] dark:text-[#e9edef] dark:placeholder-[#8696a0]` pada keduanya. Tidak ada perubahan perilaku.
- **Regression gate Fase 2:**
  ```powershell
  cd "packages/admin-dashboard"; npm run build; cd "../.."
  ```
  Rollback fase: revert commit Fase 2.

---

## FASE 3 — Presentasi Evaluasi AI (`AiEvaluations.tsx`, total 380 baris)

**Tujuan:** feedback LLM-as-Judge terbaca manusia, mobile ergonomis — tanpa hardcode dimensi di dashboard.

### [MODIFY] `packages/admin-dashboard/src/pages/tenant/AiEvaluations.tsx`

- **MT-3.1 — Parser feedback data-driven (TANPA hardcode 5 kunci dimensi).**
  - **Fakta:** format produsen `llm-evaluator.service.ts:200-203`: `` `[dimensi {<JSON>}[ gagal: a,b| semua dimensi lulus]] <feedback_text>` ``. Dashboard tidak bisa impor `evals/persona-rubric.ts` (package terpisah) — maka parser WAJIB mem-parse JSON di dalam string secara dinamis, bukan menghafal `['warmth',...]`.
  - **Lokasi:** helper BARU setelah `formatRupiah` (`:59-62`); konsumsi di sel feedback `:358-365`.
  - **Aksi prosedural:**
    1. Tulis `parseJudgeFeedback(feedback: string | null): { dims: Array<{key: string; score: number; pass: boolean}>; text: string }` — ekstrak blok `[dimensi {...}]` via pencarian bracket (bukan regex hafalan kalimat), `JSON.parse` objeknya, ambang lulus default `score >= 4` (atau `>= 3` bila kunci tidak dikenal — dokumentasikan asumsi di komentar; ambang eksak per dimensi milik backend `persona-rubric.ts:23-60`).
    2. Render tiap key yang DITEMUKAN di JSON sebagai micro-badge (hijau/merah) + `<feedback_text>` bersih. Fallback: bila parse gagal → tampilkan string mentah seperti semula (degradasi anggun, bukan blank).
  - **Acceptance:** feedback contoh produsen → 5 badge + teks bersih; string tak terduga (format lama/baru) → tetap tampil (tidak blank, tidak crash).
- **MT-3.2 — Touch target + layout mobile (polish).**
  - **Lokasi:** tombol hari `:106-118` (`px-3 py-1` — kecil); tabel audit `:218-279` (`overflow-x-auto`).
  - **Aksi:** tombol filter `min-h-[40px] py-2 px-3.5` + `touch-action: manipulation`; tambah kartu ringkas `block sm:hidden` untuk tabel audit agar tanpa scroll horizontal ekstrem di 375px. Tidak ada perubahan data/kolom.
- **MT-3.3 — Test parser (TDD).** File test baru (mis. `packages/admin-dashboard/src/pages/tenant/__tests__/judge-feedback.test.ts` atau test util setara sesuai konvensi dashboard — cek konvensi saat eksekusi): kasus: format penuh + gagal sebagian, semua lulus, string non-format (fallback mentah), JSON rusak (fallback mentah).
- **Regression gate Fase 3:**
  ```powershell
  npm run build
  cd "packages/admin-dashboard"; npm run build; cd "../.."
  ```
  Rollback fase: revert commit Fase 3.

---

## FASE 4 — Verifikasi, CHANGELOG & Debt

- **MT-4.1 — Gate otomatis scoped (bukan full-suite buta):**
  ```powershell
  npm run build
  npx vitest run tests/unit/hierarchical-debug-logs.test.ts tests/unit/llm-execution-tracing-deepseek.test.ts tests/unit/cg09-pii-redaction.test.ts
  cd "packages/admin-dashboard"; npm run build; cd "../.."
  ```
- **MT-4.2 — Debt jujur di `docs/KNOWN_ISSUES.md` (WAJIB bila terjadi):** (a) call-site V3 belum mem-plumbing `tenantId` → buffer debug single-tenant by-design sementara; (b) `AiEvaluations.tsx` zero dark-mode (warna light hardcode) — belum dikerjakan plan ini; (c) ambang lulus badge dashboard (`>= 4`) adalah aproksimasi ambang backend (`persona-rubric.ts` 3/4 per dimensi).
- **MT-4.3 — Verifikasi manual:** `/admin/debug` (timer 6 dtk stabil, accordion tak reset, filter 🎰 tampilkan NLU+legacy, pill provider aktual saat fallback, dark-mode select/search); `/admin/ai-evaluations` (badge dimensi, teks bersih, mobile 375px tanpa clip).
- **MT-4.4 — `CHANGELOG.md`:** entry baru format Keep-a-Changelog (`#### 2026-09-22 — ...`) merangkum Fase 1-3 + debt MT-4.2.

---

## 3. Non-goals (dilarang dalam eksekusi plan ini)

1. Rename `task_type` di writer / migrasi DB audit.
2. Mengubah window grouping 35 dtk, atomic routing, kontrak `save_reservation`, threshold guardrail lain.
3. Menambah teks "DILARANG..." ke prompt mana pun; regex gatekeeper intent; if-else hafalan pola kalimat.
4. Hardcode daftar dimensi di dashboard (parser harus data-driven dari JSON dalam string).
5. Dependency runtime baru; perubahan perilaku jalur normal (alias/filter hanya memengaruhi TAMPILAN yang difilter).
6. Mengklaim tenant-isolation "selesai penuh" bila MT-1.3 jatuh ke debt (lihat MT-0.3/MT-4.2).

## 4. Estimasi & risiko

| Fase | Sifat | Risiko |
|---|---|---|
| 0 | Verifikasi | Nol (read-only + test) |
| 1 | Backend baca-only + plumbing aditif | Rendah-Sedang (4 file; diikat test MT-1.5/1.6) |
| 2 | Frontend state/polling | Sedang (satu file 1633 baris; risiko stale-closure — diikat acceptance timing) |
| 3 | Frontend presentasi | Rendah (fallback mentah mencegah blank) |
| 4 | Verifikasi | — |

Rollback per fase: revert commit fase terkait (fase independen; Fase 2→3 hanya berurutan secara tampilan, tidak secara kode).
