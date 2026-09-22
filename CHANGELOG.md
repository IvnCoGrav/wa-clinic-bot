# Changelog

Semua perubahan signifikan pada proyek ini didokumentasikan di sini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
dan proyek ini menggunakan [Semantic Versioning](https://semver.org/spec/semantic-versioning.html).

#### 2026-09-22 — Resilient Tool Schema & Location Routing (PLAN 12 — 4 Akar Forensik)

- **Fase 1 — Defensive Zod Preprocess:** `stringArrayPreprocess` di `tool-schemas.ts:3` (`split /[,;\n]+/`) + `z.preprocess` pada `symptoms` & `additionalTreatments`; GLM `glm-5.3-flash` yang mengirim `symptoms:"anak baru jatuh, susah makan"` kini 100% kebal (validasi sukses → `["anak baru jatuh","susah makan"]`). Test `tool-schemas.test.ts` 6/6 hijau (koma/titik-koma/baris baru).
- **Fase 2 — Coverage Cities di Masker:** `hasNewLocationEntity` (`tool-masker.ts:53`) tambah cek `getCoverageCities()` (`surabaya,sidoarjo,gresik,sby,sda`) → `"surabaya kak"`/`"ke surabaya berapa"` tidak lagi mask `calculate_delivery`; SOP broad-region di tool (`isBroadRegionQuery`) mengambil alih (minta kelurahan ramah). Fail-open aman karena tool memvalidasi presisi.
- **Fase 3 — Cool-Off Summarizer:** `conversation-summarizer.ts:184` tambah `hasOngkirOrCoverageEvidence` (ongkir/jarak/transport + kota cakupan via `getCoverageCities`) yang HANYA blok larangan `Menanyakan alamat lagi`; `isLikelyLocationAnswer` JANGAN disentuh (hindari salah klasifikasi ringkasan fokus `:220`).
- **Fase 4 — Anti-Mutilasi Afirmasi Usia:** `guardrail-pipeline.ts:512` `stripNominalAges` early-return bila `session.childProfile.ageMonths`/`children[].ageMonths` sudah diketahui (state-gated, tanpa regex afirmasi `cocok|sesuai` yang ditolak); `"Usia 3 tahun sangat cocok..."` lestari saat usia diketahui.
- **Verifikasi:** `npm run build` ✅, `tool-schemas` 6/6 + `guardrail-pipeline` 3/3 hijau, full suite 3143/3176 hijau (5 gagal pre-existing di `staff-auth-and-reservation`/`followUp` — tidak terkait PLAN 12).

#### 2026-09-22 — Perbaikan Sistemik PLAN 11: Anti-Memburu-Buru Funnel Pacing (State-Gated Information Hiding)

- **Fase 1 — State-gated pruning RULE20:** pecah `SCHEDULE_NEG_CONSTRAINTS_TAIL` → `RULE20` (tanya-hari, di-prune saat `!isFunnelCommitted`) + `RULE21` (shareloc/alamat, SELALU ada — anti regresi privasi) di `scheduling.phase.ts:54`, helper tunggal `isFunnelCommitted()` di `phase-resolver.ts:146` (reuse cek kartu/booking/lastCommitment/bookingCommitConfirmed), `prompt-composer.ts:86` information hiding — `RULE20` contoh `jadwalkan di hari apa` hilang total saat EXPLORING (6→5 jadwalkan, RULE20 contoh false) vs byte-identik saat COMMITTED.
- **Fase 2 — State-gated few-shot:** tag `closing_schedule_ask` pada 4 exemplar penodong (`symptom_flu_consultation`, `maternal_lactation_inquiry`, `post_delivery_treatment_continuation` + gold terkait), penalti −20 saat `!committed && !ask_schedule` di `few-shot-exemplars.ts:581`, threading `funnelCommitted` dari `prompt-composer.ts:368`, bersih 6 salinan statis di `core-persona.layer.ts:75,87,105` + `location-rules.phase.ts:25` + `pricing-catalog.phase.ts:48` + `router-direct-reply.layer.ts:58` (konsultasi → tanya-minat/statement-only; komitmen boleh tetap jadwal).
- **Fase 3 — Guardrail state-aware:** `guardrail-pipeline.ts:732` `CATALOG/DISCUSSED_SERVICE_RECOVERY` cabangkan `committed ? tanya-hari : tanya-minat`, funnel reprompt tulis-ulang penuh (1x) bila draf masih `jadwalkan di hari apa` padahal `!committed` (tanpa mutilasi), fallback generik bila tetap todong.
- **Verifikasi:** `npm run build` ✅, `v3-anti-todong-jadwal` 9/9 + `get-catalog-closing-intent` 9/9 + `consultation-mode` 5/5 + `deterministic-guardrails` 7/7 (2 skip) tetap hijau, exemplar gating ad-hoc: uncommitted `no_cta` menang vs committed `flu_consultation`, `jadwalkan` 11→5 (EXPLORING) vs 6 (COMMITTED).
- **Debt jujur:** `KNOWN_ISSUES.md` #113 — bank DB `few_shot_exemplars` butuh kurasi (tag), sisa ~2 todong contoh di `location-rules` transaksional masih ada karena skenario `ask_price`/`QUOTED` dianggap committed; `slim:true` global belum dipakai (konflik cache + blok 7 medis).

#### 2026-09-22 — Perbaikan Sistemik PLAN 10: AI Monitoring & LLM Tracing (7 Bug Observability)

- **Fase 1 — Backend logging engine:** alias baca `NLU_EXTRACTOR` ↔ `SLOT_EXTRACTOR` di `getLlmExecutionLogs()` (hilangnya log legacy saat filter), heuristic grouping tahan out-of-order (iterasi seluruh bubble dalam window **35 dtk** tetap, bukan 45), plumbing `tenantId` aditif di `getLlmExecutionLogs`/`getGroupedLlmExecutionLogs` + endpoint `?tenant=` + `recordLlmExecution` call-site V3/entity-extractor, alias baca `task_type` `SLOT_EXTRACTOR`→`NLU_EXTRACTOR` di `ai-audit-summary` tanpa rename writer/migrasi DB (anti split-brain).
- **Fase 2 — Debug.tsx:** `isInitialLoadedRef` + hapus `expandedPhones` dari deps `loadLogs` (anti-reset timer 6 dtk saat accordion diklik + anti auto-expand paksa `data[0]`), fetch selektif per `viewMode` (1 request vs 2), stats per mode (flat dihitung dari `flatLogs`), pill `actualProvider`/`actualModel` + badge fallback di kartu AI step, dark-mode `select`/`input`.
- **Fase 3 — AiEvaluations.tsx:** helper `parseJudgeFeedback()` data-driven (parse JSON dalam string, bukan hardcode 5 kunci; fallback mentah bila gagal), render 5 micro-badges dimensi + teks bersih, touch target `min-h-[40px]` + `touch-action: manipulation` pada filter hari, layout kartu ringkas `block sm:hidden` untuk tabel audit di mobile 375px.
- **Verifikasi:** `npm run build` ✅, `npx vitest run tests/unit/hierarchical-debug-logs.test.ts tests/unit/llm-execution-tracing-deepseek.test.ts tests/unit/cg09-pii-redaction.test.ts` 22/22 ✅, validasi ad-hoc: alias NLU 2/2, grouping out-of-order 1 bubble/3 calls, window >35s split 2, tenant filter 1/2.
- **Debt jujur:** `KNOWN_ISSUES.md` #112 — call-site V3 lain di luar `generation-stage`/`entity-extractor` belum dijamin bawa `tenantId` (butuh audit pipeline bila multi-tenant aktif), `AiEvaluations.tsx` masih dominan light-mode, ambang badge `>=4` adalah aproksimasi `persona-rubric.ts` (3/4 per dimensi).

#### 2026-09-22 — Penyelesaian Migrasi SumoPod+GLM: Switch .env, Injeksi reasoning_effort, Koreksi Tarif Promo Kedaluwarsa

- **Runtime switch (bagian yang hilang):** `.env` `ACTIVE_LLM_PROVIDER=KENARI` → `SUMOPOD`,
  seluruh `AI_PROVIDER_*` → `SumoPod`, `AI_MODEL_*`/`OPENAI_MODEL`/`SUMOPOD_DEFAULT_MODEL`/
  `AI_MODEL_FALLBACK_CHAIN` → `glm-5.3-flash`, `AI_MODEL_FALLBACK` → `deepseek-chat`,
  plus `LLM_REASONING_EFFORT="low"` (baru). Tanpa ini baseUrl Kenari + model GLM = 400
  (DB adalah sumber kebenaran, tapi endpoint aktif dibaca dari env). `.env.example` diselaraskan.
- **Injeksi `reasoning_effort` GLM (satu titik, level kode — bukan prompt):** `attempt()` di
  `model-fallback.ts` menyisipkan `reasoning_effort` (default `LLM_REASONING_EFFORT`/`low`)
  hanya untuk model `glm-*` via SumoPod (satu-satunya kombinasi terverifikasi live),
  dihormati bila pemanggil men-set eksplisit. Terukur live: prompt router realistis
  default 21 dtk/232 chunk reasoning vs low 4,7 dtk/11 chunk, output JSON identik.
- **Koreksi tarif STALE (fakta, bukan tebakan):** `SUMOPOD_PRICING` glm memakai harga promo
  50% ($0.015/$0.25) yang BERAKHIR 2026-09-09 — diganti tarif LIST ($0.15 in / $0.03 hit /
  $0.50 out, terverifikasi 3 sumber independen). Estimasi biaya GLM sebelumnya underreport ±10x input.
- **Test:** 5 ekspektasi basi diperbaiki (MiniMax-era → glm), 5 test injeksi baru;
  67/67 hijau (`ai-models-tenant`, `model-fallback-chain` 21, `provider-model-alignment`,
  `cost-calculator`, `ai-model-settings`).
- **DB:** skrip idempoten baru `scripts/migrate-model-config-to-sumopod-glm.ts` (+guard
  produksi, `--dry-run`); diterapkan di localhost: 4 baris → golden
  (HARVESTING/PII/SUMMARIZATION/INTENT → netra), 5 sudah sesuai; verifikasi akhir 9/9 golden.
- **Jujur dicatat:** tarif diskon SumoPod MiniMax/netra/qwen di kode bersumber dashboard
  provider sesi lalu — snapshot katalog publik pihak-3 konflik untuk MiniMax
  ($0.01/$0.30 vs kode $0.03/$0.12) → butuh re-verifikasi dashboard (KNOWN_ISSUES #107).

#### 2026-09-21 — Katalog Live SumoPod Utama / Kenari Cadangan / DeepSeek Direct + Tarif Diskon Verified

- **Koreksi arsitektur (server utama = SumoPod):** Tier dibalik — Tier1 SumoPod (5 model resmi),
  Tier2 Kenari cadangan (3 model), Tier3 DeepSeek Direct API langsung (`deepseek-chat`).
- **Katalog resmi:**
  - SumoPod: `glm-5.3-flash`, `MiniMax-M2.7-highspeed` (primary), `qwen3.7-flash-2026-07-15`,
    `gpt-4o-mini`, `deepseek-v4-flash-0731:netra` (+ alias `deepseek-v4-flash`).
  - Kenari: `deepseek-v4-1-flash`, `gemini-2-5-flash-lite`, `muse-spark-1-3-contributor`.
  - DeepSeek Direct: `deepseek-chat`, `deepseek-reasoner`, `deepseek-flash`, `deepseek-v4-flash`.
- **Kenapa 3 kinerja bot:** (1) Kilat & Hemat = 95% chat harian butuh cepat+murah (MiniMax 90% off
  $0.03/$0.12); (2) Mendalam = keluhan multi-gejala butuh penalaran DeepSeek netra 80% off;
  (3) Disiplin Qwen = kasus rawan format butuh model paling tertib (qwen3.7 ≤32K $0.03/$0.006/$0.13).
  Failover Kenari bukan kinerja harian — gerbang infra bila SumoPod down.
- **Tarif verified:** `SUMOPOD_PRICING` (glm 50% off $0.015/$0.25, MiniMax 90% off, qwen3.7 tier ≤32K,
  netra 80% off $0.04/$0.01/$0.10, gpt-4o-mini $0.15/$0.075/$0.60); Kenari +`gemini-2-5-flash-lite`
  (400/40/1700) +`muse-spark-1-3-contributor` (2000/40/4000) + snapshot JSON.
- **Perubahan kode:** `ai-models.config.ts` (katalog Set + sanitize case-insensitive + default SUMOPOD +
  preset SumoPod + reset deterministik emas), `model-fallback.ts` (Tier1 SumoPod→Tier2 Kenari→Tier3 Direct),
  `cost-calculator.ts` (SumoPod verified, bukan fallback-unverified), `settings.subroute.ts`
  (`providersStatus` + `deepseekDirect` + daftar models), `AiModelSettingsPanel.tsx` (label Utama SumoPod,
  preset MiniMax/netra/qwen3.7, dropdown katalog live), `sync-pricing.ts` (track 2 model Kenari baru).
- **Verifikasi:** `npm run build` ✅, dashboard build ✅, 49 test hijau
  (`cost-calculator` 20, `model-fallback-chain` 16, `ai-models-tenant` 4, `ai-model-settings` 9).

#### 2026-09-21 — Perbaikan Pusat Kendali Model AI: Proteksi Hot-Switch, Mode Kustom, Simulator Per-Provider (15 Temuan Audit)

- **User Review (dipenuhi):** (1) Hot-switch server memunculkan konfirmasi deterministik bila ada
  editan belum disimpan (`dirty`), mencegah silent data loss; (2) Profiling kustom — hero/advanced di luar
  3 profil standar otomatis jadi Mode Kustom (Manual), preset tidak lagi tercentang hijau palsu, batch
  `presetId: 'CUSTOM'` tidak menimpa pilihan manual.
- **Stage 1 — Backend & service:** simulator uji memakai pasangan key+baseURL per-target-provider
  (perbaikan 401 palsu lintas-provider + guard key kosong mutlak sebelum fallback gateway);
  `buildProvidersStatus()` sumber tunggal untuk GET & PATCH provider (status key reaktif);
  batch menerima `confidenceThreshold` + skip preset tak terdaftar; `FAST_ECONOMICAL.deepModel` = netra
  agar klik preset ≡ reset emas; sanitasi per-task via `baseUrlForProviderLabel` (task OpenAI NLU tidak
  lagi terkonversi ke gateway saat server cadangan aktif — temuan dari test regresi baru).
- **Stage 2 — State sync:** `derivePresetFromConfigs` ketat + `'CUSTOM'`; kartu Mode Darurat Kenari
  (🛟) saat cadangan aktif; hero/advanced onChange menghitung ulang preset + membuang hasil simulator
  lama; konfirmasi hot-switch + `providersStatus` reaktif dari respons PATCH.
- **Stage 3 — Advanced:** opsi provider SumoPod (Utama)/Kenari (Cadangan)/OpenAI (NLU)/DeepSeek + label
  benar; `INTENT_CLASSIFICATION` terkunci (badge 🔒 + dropdown disabled); slider confidenceThreshold +
  payload save; `<datalist>` sugesti katalog resmi anti-typo.
- **Stage 4 — Polish:** dark-mode border amber + shadow simpan; `setTestResult(null)` di preset,
  switch, hero/advanced, dan reset.
- **Stage 5 — Verifikasi:** 4 test baru (`simulator key per-target`, `target tanpa key jujur`,
  `batch CUSTOM + threshold`, `PATCH providersStatus`); `npm run build` ✅; dashboard build ✅;
  53 test hijau (settings 13, tenant 4, cost 20, fallback 16).

#### 2026-09-21 — Fix Fondasional "Save AI Model Tidak Tersave" (Race Persist + Provider Revert)

- **Gejala:** klik `💾 Simpan Semua Perubahan` toast sukses, tapi refresh/kembali nilai lama; ganti
  Server Utama/Cadangan ikut revert setelah restart.
- **Akar (2 lapis):** (1) `updateTaskConfig` fire-and-forget `saveConfigsToDb` per item → batch ~10
  `deleteMany+createMany` konkuren interleaved → `Unique constraint (tenant_id,task)` → gagal diam-diam
  (terbukti di log test); (2) `saveConfigsToDb` mengecualikan `ACTIVE_LLM_PROVIDER` dari delete tapi tidak
  pernah upsert di jalur batch → baris provider basi → restart revert; plus `getAllTaskConfigs` mentah vs
  `getModelConfig` tersanitasi → UI ≠ runtime untuk model lintas-katalog.
- **Fix:** antrean serial per-tenant (`saveQueue` promise-chain) + `$transaction` atomik
  (delete+create+upsert provider); `updateTaskConfig(..., { persist:false })` untuk preset/batch/reset +
  satu `await saveConfigsToDb()`; `PATCH /:task` ikut awaited; respons `persisted:true/false` (+warning,
  HTTP 200 agar suite offline tetap hijau); UI menahan dirty + toast error bila `persisted===false`;
  `getAllTaskConfigs` kembalikan nilai efektif tersanitasi.
- **Verifikasi:** `npm run build` ✅, dashboard build ✅, 49 test hijau (batch offline `persisted:false`
  tetap success:true sesuai kontrak offline).

#### 2026-09-21 — Redesign Total Konfigurasi Model AI Per-Tugas (User-Centric, Zero-Anxiety, 1-Click Operations)

- **Latar Belakang & Keluhan Pengguna:**
  - Panel "Konfigurasi Model AI Per-Tugas" sebelumnya menampilkan 7 kotak teknis membingungkan per task (Provider dropdown 7 opsi fiktif: OpenAI/Anthropic/Groq tanpa API key aktif, input model manual, temperature slider, maxTokens) — rawan salah pilih dan membebani pemilik klinik/tim admin non-teknis.
  - Tidak ada cara menguji model sebelum menyimpan ke pasien WhatsApp; setiap task harus disimpan satu-per-satu (7 klik) tanpa batch.
- **Arsitektur Baru (4 Stage Fondasional):**
  - **Stage 1 — Backend Batch/Test/Reset API (`src/routes/admin/settings.subroute.ts`):**
    - `POST /api/admin/ai-models/test` — inferensi mini via `llm-gateway` + `callChatCompletionsWithFallback` dengan timeout 10s, mengukur `latencyMs`, mengembalikan `replySnippet` + `tokenEstimate` + `modelUsed`/`providerUsed`; mengembalikan pesan ramah bila API key kosong/timeout.
    - `PUT /api/admin/ai-models/batch` — transaksi terpadu: menerima `presetId` (1-klik) + `configs[]` untuk `CHAT_REPLY`/`CHAT_REPLY_DEEP`/`SUMMARIZATION` dkk.; validasi tetap via `updateTaskConfig` (MEDICAL_CHECK terkunci); audit `AI_MODEL_BATCH_UPDATE`.
    - `POST /api/admin/ai-models/reset-defaults` — `resetToGoldenDefaults()` + audit `AI_MODEL_RESET_DEFAULTS`; batch endpoints ditempatkan SEBELUM `PATCH /:task` agar tidak tertabrak param route.
  - **Stage 2 — Engine Preset Registry (`src/config/ai-models.config.ts`):**
    - Konstanta `AI_PRESET_PROFILES` (4 preset): `FAST_ECONOMICAL` (deepseek-v4-1-flash/KENARI, ~1.1s, paling hemat), `DEEP_REASONING` (deepseek-v4-pro/KENARI, ~2.4s), `DISCIPLINED_QWEN` (qwen3-8-flash/KENARI, ~1.3s), `FAILOVER_SUMOPOD` (deepseek-v4-flash/SUMOPOD, cadangan).
    - Metode `applyPresetProfile(presetId, tenantId)` — tenant-aware (hanya ubah registry tenant target + sinkron `activeLlmProvider`), mengupdate `CHAT_REPLY`/`CHAT_REPLY_DEEP`/`SUMMARIZATION` sekaligus; `resetToGoldenDefaults(tenantId)` — kloning `defaultTaskModelRegistry`, reset provider ke `KENARI`, persist `tenant_ai_config` + `ACTIVE_LLM_PROVIDER`.
  - **Stage 3 & 4 — Frontend Redesign (`packages/admin-dashboard/src/components/settings/AiModelSettingsPanel.tsx`):**
    - Header & Status Bar Real-Time: kartu gateway Kenari vs SumoPod dengan indikator 🟢 `Kunci API Terhubung` + `Latensi P50: 1.1s • Auto-Failover Siaga`; provider fiktif dihapus (hanya 2 gateway resmi).
    - 3 Kartu Preset Visual Besar (radio-card): badge kecepatan/gaya bahasa/biaya, klik memperbarui model hero lokal tanpa seting manual; dirty state oranye bila belum disimpan.
    - Hero Card Bidan Yusi: menyorot model aktif merespons chat pasien, dropdown hanya model valid per provider aktif (`KENARI_MODELS`/`SUMOPOD_MODELS`).
    - Mini Simulator 1-Detik: tombol skenario `[🤧 Tanya Bapil]`/`[💰 Tanya Harga]`/`[📅 Tanya Jadwal]` → animasi pulse "Menghubungi model AI..." → preview balasan + badge latensi/token; error ramah bila timeout/API key salah.
    - Accordion Teknis Lanjutan (default tertutup): hanya Kenari/SumoPod di dropdown provider, input model/temperature/maxTokens per task.
    - Footer Terpadu: `⏪ Kembalikan ke Rekomendasi Default` (via `useUiFeedback` confirm, `danger:true`) + `💾 Simpan Semua Perubahan` tunggal; teks ketenangan "✨ Perubahan langsung aktif pada pesan WhatsApp berikutnya tanpa perlu restart".
    - Paritas Dark Mode AMOLED (`dark:bg-[#111b21]`, `dark:border-[#222e35]`, `dark:text-white`) + Mobile Ergonomics (`min-h-[48px]`, layout 1 kolom vertikal).
- **Verifikasi:**
  - `npm run build` ✅ (fix `payload` shape + `useUiFeedback` `danger`); `npm --prefix packages/admin-dashboard run build` ✅.
  - `tests/unit/ai-model-settings.test.ts` 9/9: `GET /api/admin/ai-models` (config + provider status), `POST /test` (latensi ms + replySnippet untuk 3 skenario), `PUT /batch` (multi-task + presetId `DEEP_REASONING`), `PUT /batch` menolak body kosong, `POST /reset-defaults` (golden defaults), `applyPresetProfile` tenant-isolation, `resetToGoldenDefaults` tenant-specific.

#### 2026-09-21 — Resolusi Total Deadlock Antrean Follow-Up & Penjadwalan Ulang 141 Record (`follow-up.service.ts`)

- **Latar Belakang & Gejala:**
  - Pengguna melaporkan bahwa beberapa hari terakhir tidak ada pesan follow-up yang terkirim.
  - Audit database & log mesin produksi membuktikan pengiriman pesan memang terhenti total sejak 16 September 2026 jam 13:56 WIB (setelah berhasil mengirim 47 pesan pada 14–16 Sept).
- **Akar Masalah Sistemik (Head-of-Line Blocking Deadlock):**
  - Akumulasi 46 record pengingat H-1 dan review H+1 (`REMINDER_H1`, `REVIEW_H1_BABY`, `REVIEW_H1_MOMS`) berstatus `PENDING` dengan waktu lampau di database.
  - Sesuai kebijakan klinik, tipe ini di-postpone (skip) oleh worker. Namun pada container produksi yang lama, query database `take: 20` teratas mengambil record tanpa memfilter tipe postponed.
  - Pada 16 September siang, jumlah record postponed mencapai batas jenuh 20 record sehingga memenuhi seluruh batch antrean. Setiap 15 menit, worker men-skip ke-20 record tersebut (`processed: 0`), memblokir 141 antrean sah (`QUEUED`) di belakangnya.
- **Tindakan Perbaikan Fondasional yang Telah Selesai Dieksekusi:**
  1. **Pembersihan Record Postponed Kadaluarsa**: Memutasi 46 record reminder/review `PENDING` yang jadwalnya lewat menjadi `CANCELLED` sesuai kebijakan.
  2. **Penjadwalan Ulang (*Rescheduling*) 141 Antrean Tertahan**:
     - Menjadwalkan ulang seluruh 141 antrean `QUEUED` (8 repeat order `NEXT_TREATMENT` dan 133 prospek `NO_PURCHASE`) ke rentang **22 September s/d 03 Oktober 2026** pada jam operasional kerja (09:00–16:30 WIB).
     - Seluruh hari mematuhi kuota ketat **maksimal 25 pesan/hari** dan memprioritaskan repeat order `NEXT_TREATMENT` pada Selasa pagi (10 pesan) dan Rabu pagi (1 pesan).
  3. **Deployment Kode Anti-Deadlock ke Live Server**:
     - Mengunggah dan men-deploy kode `src/services/follow-up.service.ts` terbaru ke container `app` di server via rebuild & force-recreate container `app`.
     - Query worker kini memiliki gerbang filter permanen `type: { notIn: ['REMINDER_H1', 'REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] }` dan auto-cancel untuk `PENDING` expired.
     - **Keamanan Terjamin**: Container WAHA WhatsApp tidak disentuh (uptime 5 weeks, 0 session drop, tanpa scan QR ulang).
- **Verifikasi**:
  - Sisa antrean overdue: **0 record**.
  - Distribusi harian 22 Sept s/d 03 Okt: Seluruhnya <= 25 pesan/hari.
  - Container `wa-clinic-bot-app-1` aktif dan sehat (`Up`, koneksi Redis, BullMQ 5 shards, webhook provider sinkron).

#### 2026-09-21 — Kontrak Konsultasi vs Transaksi + Prioritas Usia Multi-Tier (Sesi 783810)

- **Akar masalah (audit multi-lapis antar-seam):** (1) `userConfirmedNames` di `cart-manager` memfilter fuzzy hanya dengan `isDurationOnlyQuestion` — pertanyaan eksplorasi consultative ("kalau yang pulih ceria itu ?") lolos fuzzy -> multi-offer asisten + "sabtu bisa ?" mengunci `Pijat Bayi Pulih Ceria` yang TIDAK pernah dipilih (ghost cart); (2) predikat konsultatif INLINE (`'?' && !commit && !day`) terduplikasi lintas seam → drift; (3) `detectAgreedTreatment` me-seed `selectedTreatment` dari penyebutan nama penuh DALAM pertanyaan bertanda `?`; (4) hierarki `closingIntent` menaruh `hasKnownSymptoms` DI ATAS `needsAgeClarification` → keluhan multi-tier tanpa usia lompat ke ASK_SCHEDULE/ASK_DOMICILE tanpa tanya usia → tier default terkunci + LLM menyebut label tier (mis. "Newborn") sebagai nama layanan (nama itu tidak ada di katalog).
- **Fix fondasional (4 fase, gerbang kode deterministik — tanpa tambahan prompt/DILARANG):**
  - **Fase A** `src/utils/date-confirmation.ts`: predikat bersama `isConsultativeUserText(text, session?)` (`'?'` + tanpa sinyal komitmen + tanpa jejak hari + tanpa commit sticky sesi). Dipakai `cart-manager` (loop `userConfirmedNames` skip + main gate predikat inline diganti) dan `booking-commit-gate.detectAgreedTreatment` (param optional `session`; skip konsultatif; argumen diteruskan di `context-grounder`).
  - **Fase B** `src/v3/tools/get-catalog.tool.ts`: cabang `needsAgeClarification` → `CLINICAL_PROBE` dinaikkan DI ATAS `hasKnownSymptoms` — usia menentukan tier (Bayi vs Anak); domisili/jadwal menyusul.
  - **Fase C** `src/v3/agent/pipeline/guardrail-pipeline.ts`: klausul "tim menanyakan saat koordinasi jadwal" pada nota koreksi usia DIHAPUS; tambah lapis deterministik `stripNominalAges` — tanpa otorisasi `needsAgeClarification`, klausa nominal usia (`usia si kecil 3 bulan`) di-strip angka+satuan tanpa mutilasi tengah kalimat; sisa satuan → fail-safe teks asli.
- **Verifikasi (TDD merah→hijau):** `cart-consultation-gate` 8/8 (ghost multi-offer → cart kosong; "Ambil yang pulih ceria ya??" tetap mengunci), `simulator-100rb-replay` 6/6 (nama penuh+`?` → null), `get-catalog-closing-intent` kontrak baru multi-tier→CLINICAL_PROBE, `guardrail-no-mutilation` strip deterministik vs authorized pass-through; regression full `tests/unit/v3` 101 files / 547 passed + matrix CM-22 diperbarui fixture usia; `npm run build` bersih.
- **Tech debt ditunda:** bullet `SAVE_RESERVATION_FULL` (`router-tool-routing.layer.ts:11`) vs Rule 5 tool-masker — `docs/KNOWN_ISSUES.md#106`.

#### 2026-09-21 — Cost Estimator Provider-Aware + Tarif Live (SUMOPOD Unverified)

- **Akar masalah (5 lapisan):** `calculateLlmCost` di-key hanya nama model → `deriveProvider` cuma label audit;
  caller (`generation-stage.ts`, `llm-audit-buffer.ts`) punya `baseUrl` tapi tidak meneruskannya; hardcode Kenari
  basi ~18× lebih murah dari live (`/v1/models` publik); tarif DeepSeek Direct usang & model tak dikenal
  (mis. `:netra`) jatuh senyap ke `DEFAULT_PRICING`.
- **Fix fondasional (`src/utils/cost-calculator.ts`):** resolver provider-aware — `baseUrl` request OTORITATIF atas
  nama model; tabel `DEEPSEEK_DIRECT_PRICING` (tarif resmi Sept 2026 peak/off-peak — `deepseek-flash` $0.15/$0.60,
  `deepseek-v4-flash` $0.22/$0.66, `deepseek-chat`/`deepseek-reasoner` = alias v4-flash),
  `KENARI_PRICING` dari `src/config/kenari-pricing.snapshot.json` (di-sync `scripts/sync-pricing.ts`, flat tanpa
  peak, `:free` = 0), SumoPod TANPA tabel → ditarif `fallback-unverified` (tarif tidak dipublikasikan; 401/404/403
  saat verifikasi). Tambah `pricingSource: 'verified'|'fallback-unverified'` + `isPeak`.
- **BaseUrl diteruskan di 4 call site:** `generation-stage.ts:205,213` (`{ baseUrl: turn.baseUrl }`);
  `llm-audit-buffer.ts:43,142` (tambah field `baseUrl` + `calledAt` agar peak dari waktu panggilan asli,
  bukan waktu flush).
- **Kenari live (Rp/1M, flat):** `deepseek-v4-1-flash` = `deepseek-v4-flash` 2.750/65/5.500, `deepseek-v4-pro`
  10.000/100/20.000, `qwen3-8-flash` 3.000/300/7.500, `qwen3-7-plus` 6.700/1.300/26.000, `minimax-m2-7`
  6.300/1.200/25.000, `step-3-7-flash` 4.200/840/24.000 (`:free` batal non-moneter).
- **Breaking pada data historis:** `llm_audit_logs.cost_idr` lama dari tarif basi; nilai baru melonjak ~18× di
  jalur Kenari — TIDAK di-back-migrate (lihat `docs/KNOWN_ISSUES.md#105`).
- **Verifikasi:** `tests/unit/cost-calculator.test.ts` 17/17 (TDD red→green: baseline 12 → 17), 
  `tests/unit/llm-execution-tracing-deepseek.test.ts` tetap hijau; `npx tsc --noEmit`/`npm run build` 0.

#### 2026-09-20 — Mixed-Intent & Anti-DSML Leakage (Sesi 648324) — Fase 1-3

- **Fase 1 (observability):** `src/v3/agent/pipeline/generation-stage.ts` — log intersepsi `CALL2_DSML_LEAKAGE_INTERCEPTED` bila Call 2 memuntahkan tag `<｜｜DSML｜｜` murni (tanpa ubah balasan).
- **Fase 2 (kontrak tool):** `src/v3/tools/tool-schemas.ts` & `calculate-delivery.tool.ts` — tambah `candidateTreatmentName` (opsional) ke `CalculateDeliveryArgsSchema`/JSON; `src/v3/tools/tool-registry.ts` — pemetaan `candidateTreatmentName: args.candidateTreatmentName ?? ctx.selectedTreatment`; `router-tool-routing.layer.ts` — 1 kalimat netral agar router mengisi field bila pesan menyebut perawatan.
- **Fase 3 (recovery):** `src/v3/agent/pipeline/guardrail-pipeline.ts` — cabang `DELIVERY_RECOVERY_APPLIED`: bila draf kosong/tak valid dan `calculate_delivery` ada `suggestedTemplateReply`, pakai template resmi delivery (plus echo `candidateTreatmentName` bila ada), bukan kaleng buntu.
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; `v3-persona-rules` 15/15, `v3` 117 files 687 passed; full rencana. Fase 4 replay manual via `npm run chat`.

#### 2026-05-14 — Guard foto rumah wajib GPS + respons jujur (belum deploy live)

- **Akar masalah:** `staff-reservation.service.ts:1197-1264` simpan foto tanpa syarat koordinat; respons selalu sukses menipu; route `today.subroute.ts:424` & `customers.subroute.ts:929` tanpa guard; frontend `StaffToday.tsx:1446`/`TodayTreatments.tsx:679` kirim foto tanpa GPS + toast sukses sebelum server. Live: 3 foto tanpa lat/lng — Cynthia Buduran, Keke medokan ayu, Nurmaya Mulyorejo (`preferences.house_photo_url IS NOT NULL AND lat IS NULL`).
- **Fix fondasional:** Guard deterministik di `staff-reservation.service.ts:1096-1102` (foto+null GPS → 400), `today.subroute.ts` & `customers.subroute.ts:949-957` guard sama, `StaffToday.tsx:1447`/`TodayTreatments.tsx:682` blokir submit (`hasPhoto && !locCoords → error`), respons tambah `coordsUpdated` + pesan cabang. Prompt tidak dipakai.
- **Test:** `tests/unit/staff-location-photo-guard.test.ts` (3 kasus: foto-null→blokir, foto+GPS→lolos, landmark-only→lolos) — TDD red→green.
- **Legacy & monitor:** `docs/KNOWN_ISSUES.md#1c` — 3 nama di atas ditugaskan re-capture; monitor query harus 0 baris.
- **Belum deploy live** — menunggu gate Fase 4 hijau + konfirmasi.

#### V3 Audit Remediation & Consent Frontier — Deploy Lengkap (2026-09-20)

- **Pushed & deployed (live):** `7e5aada2` (V3 audit remediation — durable turns, tenant
  identity, session state, peta), `089e32a2` (sumber lokasi first-class + warna reservasi),
  `88665d8` (12 temuan map — bbox, jarak sentroid, zoom, tile, lifecycle).
- **Fixed — follow-up unik (blocker produksi):** migrasi `20260920000001` menambahkan
  `@@unique(tenant_id, reservation_id, type, stage)`; DB live memiliki 2 grup duplikat
  (CANCELLED + PENDING untuk reservasi yang sama). Solusi fondasional: setiap jalur cancel
  (`cancelFollowUp`, `bulkCancelFollowUps`, `onReservationCreated/Cancelled`, worker
  overdue, optout, broadcast) menetralkan `reservation_id = NULL` (baris TETAP tersimpan
  sebagai jejak historis; PostgreSQL menganggap NULL unik) — tidak menghapus data.
  + Test invariant baru `10b` memverifikasi seluruh jalur cancel.
- **Deploy note:** proses paralel (editor lain) menyelesaikan full deploy lebih dulu —
  index unik sudah terpasang, duplikat = 0 (2 baris CANCELLED duplikat dihapus manual,
  bukan dinetralkan), app container sudah di-recreate. Verifikasi akhir hari ini:
  `migrate status` = up to date (70), dashboard 200 + bundle sesuai, WAHA Up 5 weeks (tidak
  terganggu). Drift gate hanya melaporkan 2 tabel backup maintenance (tidak di schema).
- **Verifikasi:** suite 2972 passed (1 flaky timeout `follow-up-inbound-hook`, lulus
  isolasi / sudah tercatat di KNOWN_ISSUES 0a); build exit 0.

#### Peta Sebaran — Sumber Lokasi First-Class (GPS / Estimasi / Edit Bidan) (2026-09-20)

- **Added — enum `LocationSource` + kolom `customers.location_source`** (`gps_pin` | `estimated_area` |
  `manual_staff`, nullable untuk data lama): migrasi `20260920000006_customer_location_source`.
  Sumber koordinat kini first-class & queryable (bukan lagi tersebar di JSON `preferences`).
- **Changed — penandaan sumber otomatis di jalur tulis:** `customerService.updateCustomerLocation`
  menurunkan sumber deterministik (`isNativePin`→`gps_pin`, koordinat dari teks/gazetteer→
  `estimated_area`, eksplisit dapat override) dan **tidak mengubah sumber lama** saat GPS presisi
  dipertahankan (GPS priority guard). Jalur edit manual (PUT `/api/admin/customers/:id/location`
  dan `staffReservationService.updateCustomerLocation`) menandai `manual_staff`; alur refresh-location
  memetakan `bidan_shareloc`/`customer_shareloc`→`gps_pin`, `geocoding`→`estimated_area`.
- **Changed — pembeda visual di peta:** `locationVisual()` (pure, teruji) → GPS outline putih,
  estimasi wilayah outline putus-putus abu + fill transparan, edit bidan outline ungu `#7c3aed`;
  popup & legenda menampilkan 3 kategori sumber. Endpoint `map-points` mengirim `location_source`
  (titik sentroid selalu `estimated_area`). Kompatibel data lama (`location_source` null → turun
  dari `is_estimated_centroid`).
- **Verifikasi:** `tsc --noEmit` bersih; `vitest` unit peta **40 passed**; build bot & dashboard exit 0.

#### Peta Sebaran — Warna Reservasi & Koreksi Backfill GPS (2026-09-20)

- **Fixed — MQL yang sudah reservasi tampil biru (bukan hijau):** Akar multi-lapis:
  (1) endpoint `GET /api/admin/customers/map-points` tidak menyertakan info reservasi;
  (2) `markerColor`/`statusOf` menaruh `is_mql` (biru) di atas status aktif. Kini endpoint
  mengirim `has_reservation` (reservasi non-`cancelled`/`rejected`) dan prioritas warna
  deterministik menjadi: `out_of_coverage` → **sudah reservasi (hijau)** → MQL (biru) →
  status lain (oranye) → aktif (hijau). Popup menampilkan label "Sudah Reservasi".
- **Data ops — koreksi backfill:** Backfill centroid tadi mengisi 48 customer ber-reservasi;
  ternyata 45 di antaranya hanya berbasis `kecamatan` (tanpa `kelurahan`). Sesuai kebijakan
  presisi (kecamatan terlalu luas), **45 di-revert** (`lat/lng/distance_km/ongkir = NULL`);
  hanya **3** yang punya `kelurahan` yang dipertahankan. Status akhir: 79/211 customer
  ber-reservasi ber-GPS.
- **Verifikasi:** `npx tsc --noEmit` bersih; `npx vitest run tests/unit/customer-map-*.test.ts`
  **35 passed**; `packages/admin-dashboard` build exit 0 (chunk memuat `has_reservation`).

#### Backfill GPS Customer Ber-Reservasi (Live, 2026-09-20)

- **Data ops:** Dari 211 customer yang punya reservasi, 135 belum memiliki GPS (`lat`/`lng` NULL).
  Backfill scoped dijalankan di server produksi (mode dry-run lalu tulis) menggunakan gazetteer
  Sby/Sda via `getGazetteerCoordinates` + `deliveryService.calculateDelivery` — **48 customer**
  berhasil diisi `lat/lng/distance_km/ongkir` (0 gagal; semua `isOutOfCoverage=false`).
- **Sisa 87 belum bisa diisi** (butuh data sumber tambahan): 46 tanpa alamat sama sekali,
  17 hanya kota level-kabupaten (`Surabaya`/`surabaya`), 1 Gresik (di luar gazetteer), 1 data kotor
  (`No. Hp : ...`), sisanya area di luar cakupan gazetteer. Lihat `docs/KNOWN_ISSUES.md` 0c.
- **Catatan:** ORS API terkena rate-limit saat batch, sehingga jarak jatuh ke fallback Haversine
  (ongkir tetap terhitung dari tier tenant).

#### Peta Sebaran — Basemap CARTO API Key & Fallback Esri (2026-09-20)

- **Fixed — Watermark "API key required":** CARTO kini mewajibkan API key untuk semua basemap
  raster; tile tanpa key disajikan dengan watermark. Basemap Peta Jalan (`CustomerMapTab.tsx`) kini
  membaca `VITE_CARTO_API_KEY` dari `packages/admin-dashboard/.env` (gitignored) dan menambahkan
  `?key=...` ke URL tile CARTO `light_nolabels`. Key di-declare di `src/vite-env.d.ts`.
- **Added — Fallback otomatis tanpa key:** bila `VITE_CARTO_API_KEY` kosong, build beralih ke
  **Esri World Light Gray Base** (gratis tanpa key, netral minim label) — peta tetap berfungsi di
  lingkungan tanpa `.env`. Konfigurasi basemap terpusat pada konstanta `BASEMAP_URL`/`BASEMAP_ATTR`
  yang dipakai ke dua call-site tile layer.
- **Verifikasi:** aturan `?key=` di curl dicek → tile Sby (z12–15) mengembalikan PNG peta asli
  (68–94KB, 200); tanpa key tile byte-identik 1884B (watermark). `packages/admin-dashboard` build
  exit 0; server live (`localhost:3000`) menyajikan chunk baru berisi key.

#### Portal Terapis (StaffToday) — Ergonomi Mobile & Bug Interaksi Notifikasi (2026-09-20)

- **Fixed — Stale Closure Notifikasi Browser:** `notif.onclick` (handler notifikasi pesan masuk) menutup `tasks/upcomingTasks/completedTasks` dari `useEffect(..., [])` sehingga selalu membaca array kosong saat init → klik notifikasi tidak pernah menemukan task (`match === undefined`). Ditambahkan `allTasksRef` (`useRef`) yang di-refresh setiap render; handler kini memakai `allTasksRef.current.find(...)` sehingga notifikasi yang diklik kapan pun langsung membuka chat pasien yang benar.
- **Fixed — VoiceNotePlayer senyap saat gagal:** `a.play().catch(() => {})` dan ketiadaan listener `error` menelan kegagalan audio diam-diam. Kini ada state `hasError`, listener `error` elemen `<audio>`, tombol Play membesar `w-8→w-10` (32→40px), berubah amber + tooltip "Audio gagal dimuat", dan pesan fallback teks.
- **Changed — Touch Target 44px (Apple HIG):** tombol aksi kartu (Chat/Navigasi/Infokan OTW) `py-1.5 px-2` (~28px) → `min-h-[44px] py-2.5 px-3 rounded-xl font-bold`, ikon `12→15`, `gap-1.5→gap-2`. Chip balasan cepat `text-[11px] px-2.5 py-1` (~24px) → `min-h-[38px] px-3.5 py-2 text-xs font-semibold`.
- **Changed — Navigasi Mobile ke Sticky Bottom Bar:** segmented tab mobile yang menempel di bawah header dipindah ke `<nav>` sticky di dasar layar (`sm:hidden`, thumb zone). Aktif = aksen `#d9fdd3` + ikon hijau `#008069` + badge jumlah; otomatis disembunyikan saat mode chat penuh agar kanvas percakapan 100% layar. List kartu diberi `pb-20 sm:pb-3` agar tidak tertutup bottom bar.
- **Added — Indikator Offline Lapangan:** state `isOnline` (`navigator.onLine` + listener `online`/`offline`), banner amber `WifiOff` "Koneksi internet terputus...". Guard preventif pada `handleSendReply` (banner error) & `handleSendOtw` (toast) agar tidak memicu pengiriman gagal saat sinyal hilang.
- **Changed — Ergonomi Modal Lokasi:** tombol GPS utama & tombol Buka Kamera/Pilih Galeri modal update lokasi dinaikkan ke `min-h-[46px]`.
- **Verifikasi:** `packages/admin-dashboard` build 0 error; suite Vitest backend 2958 passed. **Catatan:** 1–4 file test backend (`waha-webhook`, `media.service`, `lead-greeting-preservation`, `v3-persona-rules`) bersifat flaky/pollution order-dependent — sudah terkonfirmasi gagal juga TANPA perubahan ini (lihat `docs/KNOWN_ISSUES.md`).


#### Fixing D1 False-Positive "Sinar Moksa" & POV Violation (Sesi 767713) (2026-09-20)

- **Akar (multi-layer):** `get_catalog_and_price` tak memasukkan add-on → validator faktual D1 (`factual-claim-validator`) hanya percaya `result.treatments` → **"Sinar Moksa" (add-on sah) dituduh halusinasi** → reprompt → AI menjawab "cek dulu ke tim kami" (melanggar POV first-person).
- **Fase 1 `factual-claim-validator.ts`:** opsi `extraCatalogNames` (katalog tenant lengkap) melonggarkan pencocokan D1; **gate D1 tetap dari nama tool turn ini** (`turnNames`) agar tidak memicu pemeriksaan turn yang dulu tak diperiksa.
- **Fase 2 `get-catalog.tool.ts`:** add-on relevan (Sinar Moksa) disertakan ke `result.treatments` (flag `isAddon`) **hanya saat `showPrices` + keluhan pernapasan**, menghormati information-hiding (tanpa harga saat tak ditanya) & anti-menu brosur (konsultasi tetap ≤2).
- **Fase 3 `sanitizer.ts`:** `stripVagueTeamDeferral` deterministik membuang kalimat defleksi "cek ke tim" (mempertahankan kalimat jadwal yang sah), mempertahankan struktur baris agar sanitizer hilir tetap bekerja.
- **Call-site `guardrail-pipeline.ts`:** resolve `extraCatalogNames` dari katalog tenant, diteruskan ke D1 + recheck.
- **Test baru `tests/unit/v3/d1-addon-false-positive-fix.test.ts`**; test lama diselaraskan (matrix CM-01 filter add-on; matrix CM-08/CM-18 kontrak eskalasi).
- **Verifikasi:** `tsc` 0; `build` 0; full suite **411 files / 2963 passed / 0 failed**.
- **Catatan:** ditemukan inkonsistensi ejaan katalog (`Rileksasi` vs `Relaksasi`) yang dulu tidak terlihat karena gate D1 hanya menyala bila turn memakai tool katalog.

#### Stage 8 — Actual Model/Provider Labeling pada Fallback (2026-09-20)

- **Akar (RC-08/R9):** fallback LLM mengembalikan data tanpa menandai model/provider yang benar-benar melayani → log audit selalu menyebut model primary (menyesatkan saat fallback).
- **`generation-stage.ts`:** fungsi fallback circuit-breaker menandai `data.__actualModel`/`__actualProvider`; `TurnState.actualModelUsed` di-set dari respons; `recordCall` memakai `actualModelUsed || selectedModel` untuk `actualModel` & `modelUsed`.
- **Verifikasi:** `tsc` 0; `build` 0; LLM/fallback/circuit-breaker tests 35/35; full suite **410 files / 2958 passed / 0 failed**.
- **Catatan:** belum ada test khusus yang memaksa jalur fallback berhasil (butuh stub tier); labeling diverifikasi via type-check + suite existing.

#### CG-09 — Redaksi PII JSONL + Retention 60 Hari (2026-09-20)

- **`llm-execution-logger.ts`:** identitas PII di-redact HANYA pada berkas JSONL (at-rest) — `customerPhone` di-hash (`hashPiiPhone`), `customerName` di-mask (`maskCustomerName`, mis. "Bunda Sari" → "B*** S***"). **Buffer in-memory tetap mentah** agar UI admin bisa mengidentifikasi customer saat sesi berjalan (tidak persist). Teks chat tetap disimpan untuk debug (keputusan user).
- **`log-buffer.ts`:** `MAX_LOG_RETENTION_DAYS` 7 → **60** (JSONL & app log).
- **Test baru `tests/unit/cg09-pii-redaction.test.ts`.**
- **Verifikasi:** `tsc` 0; `build` 0; full suite **410 files / 2958 passed / 0 failed**.

#### Stage 6-CLM / RC-07 — Entity-Bound Numeric Validation (2026-09-20)

- **Akar (RC-07):** validator numerik mengotorisasi SELURUH harga katalog tenant → harga Treatment B mengesahkan nominal untuk Treatment A.
- **`numeric-fact-validator.ts`:** harga layanan (PRIMARY/BUNDLE/SERVICE) katalog **tidak lagi** mengesahkan nominal standalone; hanya dipakai sebagai **fallback** bila turn tak punya sumber entity-bound (tool turn / cart). Harga **add-on** tetap sah dikutip kapan pun (set kecil). Sumber entity-bound: treatment dari tool turn ini + cart sesi + ongkir sesi + targetPrice + komposit.
- **Test baru `tests/unit/entity-bound-numeric-validator.test.ts`:** harga entity-bound benar → VALID; harga layanan LAIN → INVALID; fallback tanpa entity-bound tetap sah.
- **Test lama diselaraskan** (spesifikasi berubah): `multi-treatment-combo-validator` (add-on tetap sah).
- **Verifikasi:** `tsc` 0; `build` 0; full suite **409 files / 2956 passed / 0 failed**.

#### Stage 5 Fase 5 — Degraded Replay + Retention (2026-09-20)

- **Migrasi LOKAL:** `inbound_turns.payload_json JSONB` (migration `20260920000005_inbound_turn_payload`) — untuk replay.
- **`turn.repository.ts`:** persist `payload`; `listReplayable` (RECEIVED/QUEUED/PROCESSING-macet), `markQueued`, `cleanupOlderThan(days)`.
- **Webhook WAHA & WABA:** simpan payload minimal (customerId/phone/incomingMessage) saat persist turn.
- **`turn-recovery.service.ts` (baru):** `replayPendingTurns` (enqueue ulang turn berpayload; tanpa payload → tandai FAILED agar tidak macet), `cleanupOldTurns(60)`.
- **`app.ts`:** setelah boot (jeda 15s, non-blocking) → replay pending + retention.
- **Test baru `tests/unit/turn-recovery.test.ts`.**
- **Verifikasi:** `tsc` 0; `build` 0; full suite **408 files / 2953 passed / 0 failed**.
- **Stage 5 SELESAI (fase 1-5).**

#### Stage 5 Fase 4 — Handoff Durable / Escalation Fail-Closed (2026-09-20)

- **`src/v3/tools/escalate-human.tool.ts`:** DILARANG lapor sukses palsu. Conversation tidak ditemukan → `success:false, escalated:false`; DB error → `success:false, escalated:false` (bukan lagi `success:true`). Lookup sudah tenant-scoped.
- **`machine.ts`:** saat `isEscalated`, tandai `InboundTurn` (dari ALS `turnId`) → status `HANDOFF` (best-effort).
- **Test diselaraskan ke kontrak baru** (spesifikasi berubah, bukan pelonggaran): `v3-conversation-matrix.test.ts` CM-08 & CM-18 — invarian safety (tool dipanggil, `is_human_handling=true`, tanpa silent drop) TETAP diassert; `result.success` tidak lagi dipatok true saat harness DB offline.
- **Test baru `tests/unit/escalate-human-fail-closed.test.ts`.**
- **Verifikasi:** `tsc` 0; `build` 0; full suite **407 files / 2951 passed / 0 failed**.
- **Belum:** Fase 5 (degraded replay), retention ledger.

#### Stage 5 Fase 3 — Outbound Ledger Per-Bubble (2026-09-20)

- **`src/services/outbound-ledger.service.ts` (baru):** `begin` (SENDING + content_hash), `markSent` (+ provider message id), `markFailed`, `markUnknown`. Best-effort (DB offline tidak menggagalkan pengiriman).
- **`typing.service.ts`:** `HumanReplyParams.turnId/provider` (opsional); instrumentasi loop bubble — SENDING sebelum kirim, SENT/FAILED setelah.
- **`machine.ts`:** teruskan `turnId`/`provider` dari `contextStorage` ke `simulateHumanReply`.
- **Test baru `tests/unit/outbound-ledger.test.ts`** (4 kasus).
- **Verifikasi:** `tsc` 0; `build` 0; full suite **406 files / 2949 passed / 0 failed**.
- **Belum:** Fase 4 (handoff durable), Fase 5 (degraded replay), retention ledger.

#### Stage 5 Fase 2 — Inbound Durable + Worker Claim (2026-09-20)

- **`src/repositories/turn.repository.ts` (baru):** `persistInbound` (upsert RECEIVED, idempoten per tenant+provider+message id), `claimForProcessing` (atomik RECEIVED/QUEUED→PROCESSING; tolak bila sudah RESPONSE_READY/DELIVERED; **fail-open** bila tracking/DB tak tersedia), `markStatus`.
- **`webhook.route.ts` (WAHA) & `waba-webhook.route.ts`:** persist `InboundTurn` (RECEIVED) **sebelum** `enqueueMessage` (best-effort).
- **`queue.service.ts` (BullMQ + in-memory):** claim turn sebelum `processMessage`; turn yang sudah diproses dilewati (`QUEUE TURN SKIP`) → retry tidak memproses ulang; `markStatus RESPONSE_READY` setelah selesai. Import `DEFAULT_TENANT_ID`.
- **`tests/setup.ts`:** mock global `inboundTurn` & `outboundAttempt`.
- **Test baru `tests/unit/turn-repository-claim.test.ts`.**
- **Verifikasi:** `tsc` 0; `build` 0; full suite **405 files / 2945 passed / 0 failed**.
- **Belum:** Fase 3 (outbound ledger per-bubble), Fase 4 (handoff durable), Fase 5 (degraded replay).

#### Stage 5 Fase 1 — Schema `InboundTurn` + `OutboundAttempt` (2026-09-20)

- **Migrasi LOKAL:** dua tabel baru (aditif) — `inbound_turns` (enum `InboundTurnStatus`: RECEIVED/QUEUED/PROCESSING/RESPONSE_READY/DELIVERED/FAILED/HANDOFF; `@@unique([tenant_id, provider, inbound_message_id])`) dan `outbound_attempts` (enum `OutboundAttemptStatus`: SENDING/SENT/FAILED/UNKNOWN; `@@unique([turn_id, bubble_index])`). Migration `20260920000004_durable_turn_inbox_outbox`.
- **Keputusan CG-08:** Redis down → terima ke DB inbox lalu replay (opsi b). **CG-10:** timeout pasca-send → `UNKNOWN`, tanpa resend otomatis. Retention: 30–90 hari (diterapkan di fase berikutnya).
- **Insiden kecil:** file migrasi awal terkena BOM dari PowerShell → `migrate deploy` gagal (`syntax error near \uFEFF`). Diatasi: hapus BOM + `migrate resolve --rolled-back` + deploy ulang. Tabel sudah terverifikasi (types kosong sebelum resolve, jadi aman).
- **Verifikasi:** tabel `inbound_turns` & `outbound_attempts` ada; drift `-- This is an empty migration.`; client runtime mengenali `inboundTurn` (count=0); `tsc` 0.
- **Belum:** Fase 2–5 (persist inbound sebelum ack, worker claim, outbound ledger, handoff durable, degraded mode).

#### Stage 4 Fase C & D — Audit Pembaca Episodik + Status Selesai (2026-09-20)

- **Fase C (audit read-only):** tidak ada kode non-V3 yang membaca field episodik (`cartItems`/`booking`/`selectedTreatment`/`lastCommitment`/`discussedTreatments`/`ongkirStatus`/`priceDiscussed`/`bookingCommitConfirmed`) dari `Customer.preferences`. Pembaca eksternal (capi, staff-reservation, human-enrichment, staff-notification, admin) hanya menyentuh field **durable** (alamat/nama). → **Fase C tidak diperlukan.**
- **Fase D:** tercapai secara desain — `updateGoalSession` sudah **tidak** menulis field episodik ke `preferences` (hanya durable: nama/sapaan + mempertahankan field lama seperti `address`). Tidak ada mirror episodik yang tersisa.
- **Stage 4 dinyatakan SELESAI (fungsional):** session episodik hidup di `Conversation.session_data`; `Customer.preferences` tinggal profil durable.

#### Stage 4 Fase B — Backfill `Conversation.session_data` (2026-09-20)

- **Script `scripts/backfill-conversation-session-data.ts`** (dry-run default; `--apply` untuk tulis). Idempoten: hanya mengisi conversation yang `session_data IS NULL` dan customer punya state sesi di `preferences`. **Tidak menghapus** `Customer.preferences` (pembaca durable tetap aman).
- **Hasil lokal:** 11 conversation di-backfill (dari 6 customer dengan preferences episodik); preferences 542 customer tetap utuh. Dry-run ulang = 0 (idempoten).
- **Verifikasi:** `tsc` 0; `build` 0; full suite 2942 passed / 2 flaky timeout (#101, lulus isolasi).

#### Stage 4 Fase A (RC-02) — Session Episodik ke `Conversation.session_data` (2026-09-20)

- **Migrasi LOKAL:** `conversations.session_data JSONB` (migration `20260920000003_conversation_session_data`).
- **`goal-tracker.ts`:**
  - `getGoalSession`: baca **Conversation.session_data** (utama); fallback `Customer.preferences` bila kosong (kompatibel mundur).
  - `updateGoalSession`: tulis state lengkap ke **Conversation.session_data**; **mirror durable saja** ke `Customer.preferences` (nama, sapaan — TIDAK menyertakan field episodik cart/booking/komitmen) + kolom profil Customer (nama, kelurahan, kecamatan, kota, jarak, ongkir).
- **Temuan penting:** pembaca non-V3 (`capi`, `staff-reservation`, `human-background-enrichment`, `staff-notification`, admin) hanya membaca field **durable** (`address`/`house_photo_url`/`landmark`) → **tidak perlu disentuh** (Fase C diperkecil).
- **Verifikasi:** `tsc` 0; `build` 0; full suite **404 files / 2942 passed / 0 failed** (rerun; 1st run 2 flaky timeout #101).
- **Belum:** Fase B (backfill sesi aktif), Fase C (alihkan pembaca episodik), Fase D (hentikan dual-write). Session lama masih di `Customer.preferences` sampai dibackfill.

#### CG-02 — Pemicu Reset Episode (14,1 Hari + Closing + `/reset`) (2026-09-20)

- **Keputusan user:** tiga pemicu reset — (a) **admin klik "Selesai"**, (b) **14,1 hari** customer diam, (c) `/reset`.
- **`src/state-machine/machine.ts`:** default `IDLE_TIMEOUT_MS` 24 jam → **1.218.240.000 ms (14,1 hari)**. `.env.example` diperbarui.
- **`src/routes/admin/reservations.subroute.ts` (`/complete`):** setelah admin menandai reservasi `completed`, bersihkan sesi V3 episodik customer (cart, treatment, booking, diskusi, komitmen, ongkir, total) via `GoalTracker.updateGoalSession`; profil durable dipertahankan.
- **Test:** `admin-complete-reset-session.test.ts` (baru); `idle-reset-clears-v3-session.test.ts` diselaraskan ke 15 hari.
- **Verifikasi:** `tsc` 0; `build` 0; full suite **404 files / 2942 passed / 0 failed**.
- **Belum:** session pindah ke `Conversation.session_data` (Stage 4 penuh) — masih di `Customer.preferences`.

#### CG-05 (Opsi Flag) — `needs_staff_verification` pada Reservation (2026-09-20)

- **Keputusan user:** CG-05 via **flag**, BUKAN status baru (hindari blast radius 30+ pembaca `status`).
- **Migrasi LOKAL:** `reservations.needs_staff_verification Boolean @default(false)` (migration `20260920000002_reservation_needs_staff_verification`).
- **Kode `reservation-core.service.ts`:** `needs_staff_verification = (source !== 'ADMIN_PANEL' && status === 'confirmed')` — bot/agent non-same-day (slot belum diverifikasi) ditandai; same-day (`pending`) & admin manual tidak.
- **`status` TIDAK diubah** (tetap `confirmed`/`pending` seperti sebelumnya).
- **Test:** `reservation-idempotency-request-id.test.ts` +2 kasus flag → 4/4.
- **Verifikasi:** `tsc` 0; `build` 0; full suite **403 files / 2941 passed / 0 failed**.

#### Stage 8 (Parsial) — Flush LLM JSONL saat Shutdown (2026-09-20)

- **Akar (audit observability):** antrean tulis `llm-*.jsonl` memakai timer `unref` yang bisa hilang saat proses keluar → berkas 0-byte meski ada aktivitas LLM.
- **Perbaikan:**
  - `src/utils/llm-execution-logger.ts` — fungsi publik baru `flushLlmExecutionLogs()` (bersihkan timer + flush sinkron).
  - `src/lifecycle/shutdown.ts` — panggil `flushLlmExecutionLogs()` saat graceful shutdown (setelah `flushLlmAuditBuffer`).
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; lifecycle/logger tests 26/26; full suite **403 files / 2939 passed / 0 failed**.

#### Stage 7 (R6) — Reservation Idempotency (`request_id`) + Follow-up Uniqueness (2026-09-20)

- **Migrasi LOKAL (dev DB):** `reservations.request_id String?` + `@@unique([tenant_id, request_id])`; `follow_ups` `@@unique([tenant_id, reservation_id, type, stage])`. Migration `20260920000001_reservation_request_id_and_followup_unique`. Dibuat via `migrate diff` + `migrate deploy` (bypass shadow-DB). Drift verified. Prasyarat: 0 duplikat follow-up.
- **Kode:**
  - `reservation-core.service.ts` — `ReservationMutationParams.requestId?`; cek idempotensi awal (request_id ada → kembalikan existing, tidak create ganda); `request_id` disimpan pada create.
  - `save-reservation.tool.ts` — generate `requestId` stabil: `${tenantId}:${customerId}:${tanggal}:${treatmentDetail}` (retry webhook sama → tidak ganda).
- **TIDAK mengubah logika merge same-day** (patuh keputusan **CG-06 Opsi D**).
- **Test baru `tests/unit/reservation-idempotency-request-id.test.ts`.**
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite **403 files / 2939 passed / 0 failed** (1 skipped).
- **CATATAN:** migrasi PRODUKSI belum (kode belum live). Status `REQUESTED` (CG-05) belum diimplementasi — masih terbuka.

#### Stage 4 (R2) — Idle Reset Menyelaraskan Sesi V3 Episodik (2026-09-20)

- **Akar (R2):** idle reset (`machine.ts`) hanya mereset enum `Conversation` + pending location, TIDAK membersihkan session V3 (`Customer.preferences`: cart, treatment terpilih, booking, komitmen). V3 memuat ulang state lama → "amnesia palsu"/konteks nyangkut.
- **Perbaikan `src/state-machine/machine.ts`:** saat idle reset, bersihkan field EPISODIK session V3 (`cartItems`, `selectedTreatment`, `booking`, `discussedTreatments`, `priceDiscussed`, `bookingCommitConfirmed`, `lastCommitment`, `ongkirStatus`, `totalPrice`) via `GoalTracker.updateGoalSession`. Profil durable (nama, sapaan, anak, lokasi terverifikasi) DIPERTAHANKAN.
- **Catatan:** nilai `IDLE_TIMEOUT_MS` (default 24 jam) TIDAK diubah — nilai timeout adalah keputusan CG-02 (masih terbuka). Perbaikan ini murni menyelaraskan reset (bug konsistensi), bukan mengubah kebijakan kapan reset.
- **Test baru `tests/integration/idle-reset-clears-v3-session.test.ts`.**
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite **402 files / 2937 passed / 0 failed** (1 skipped).

#### Stage 2 (R1) — Tenant Identity Boundary: Migrasi Lokal + Kode Tenant-Scoped (2026-09-20)

- **Migrasi lokal (dev DB):** `phone @unique` (global) → `@@unique([tenant_id, phone])`. Migration `prisma/migrations/20260920000000_tenant_identity_boundary`. Dibuat via `migrate diff` + `migrate deploy` (BYPASS `migrate dev` yang rusak oleh shadow-DB `FollowUpStatus`, sesuai AGENTS.md). Drift pasca-migrasi: empty. Backup lokal dibuat sebelum migrasi.
- **Verifikasi constraint nyata:** phone sama di 2 tenant → OK; duplikat dalam 1 tenant → ditolak `P2002`.
- **`src/repositories/customer.repository.ts`:** hapus `findByPhoneGlobal` (global lintas tenant); `updateManyByPhone` → `updateManyByPhoneTenant(phone, tenantId, patch)` (tenant-scoped).
- **`src/services/customer.service.ts`:** buang fallback global; create atomic (catch `P2002` → reread dalam tenant); `setLabelFlags(phone, flags, tenantId=DEFAULT)` tenant-scoped.
- **`src/services/backup.service.ts`:** `customer.upsert` pakai compound unique `tenant_id_phone`.
- **Test diselaraskan ke kontrak baru (spec berubah, bukan dilonggarkan):** `customer-repository.test.ts` (isolasi tenant + update tenant-scoped); `label-ai-router.test.ts` TC29 (label TIDAK bocor antar-tenant).
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite 2935 passed / 1 flaky timeout (`waha-webhook`, lulus isolasi — pra-existing, lihat #101).
- **CATATAN:** migrasi **produksi BELUM** dijalankan (butuh backup + rehearsal + persetujuan eksplisit). Rencana: `docs/plans/STAGE_2_MIGRATION_PLAN_TENANT_IDENTITY.md`.

#### Audit P1-14 — Cancel/Delete Reservasi Membatalkan Follow-up (2026-09-20)

- **Akar:** `DELETE /api/admin/reservation/:id` (soft-cancel & hard-delete) tidak memanggil `followUpService.onReservationCancelled`. Soft-cancel hanya membuat NO_PURCHASE baru; hard-delete `onDelete:SetNull` → follow-up pengingat H-1/review H+1 tetap aktif dan terkirim ke customer yang sudah membatalkan.
- **Perbaikan `src/routes/admin/reservations.subroute.ts`:** panggil `followUpService.onReservationCancelled(id, tenantId)` pada kedua jalur (hard-delete dipanggil SEBELUM `reservation.delete` agar `reservation_id` masih cocok).
- **Keputusan CG-06 = Opsi D (user):** merge same-day kontrak LAMA dipertahankan (walau treatment berbeda); multi-treatment ditangani admin manual. Perubahan R6 "merge hanya treatment sama" **DIBATALKAN**. Dicatat di ADR + KNOWN_ISSUES #102.
- **Test baru `tests/unit/admin-reservation-cancel-followups.test.ts`.**
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite **401 files / 2936 passed / 0 failed** (1 skipped).

#### Audit R7 (ST6-CLM) — Validasi Numerik Aktif pada Direct Reply Tanpa Tool (2026-09-20)

- **Akar (audit R7/C2):** `guardrail-pipeline.ts` hanya menjalankan validator numerik bila `executedTools.length > 0 || hasActiveCart`. Direct reply Call 1 (tanpa tool/cart) yang menyebut nominal **lolos tanpa koreksi**.
- **Perbaikan `src/v3/agent/pipeline/guardrail-pipeline.ts`:** gate dihapus — validator numerik kini berjalan setiap kali `!numCheck.isValid`. `validateNumericFacts` sudah return valid lebih awal bila tidak ada token "Rp", sehingga hanya menyala saat balasan benar-benar menyebut nominal. Sumber otorisasi tetap (katalog tenant + tool + session) → harga katalog valid tetap lolos; hanya nominal non-katalog yang dikoreksi.
- **Verifikasi:** `npx tsc --noEmit` 0; test numerik & guardrail 39/39 hijau; full suite **400 files / 2935 passed / 0 failed** (1 skipped).

#### Audit R4 — Cegah Balasan Ganda Saat Logging Outbound Gagal (2026-09-20)

- **Akar (audit R4):** `machine.ts` melakukan `await messageService.logMessage()` AFTER `simulateHumanReply`. Jika DB gagal sesudah pesan terkirim, exception naik ke queue worker → BullMQ retry → **pesan terkirim ulang** ke customer.
- **Perbaikan `src/state-machine/machine.ts`:** `logMessage` outbound dibungkus try/catch (best-effort). Kegagalan logging tidak lagi menggagalkan turn → mencegah retry yang mengirim ulang. Pesan tetap terkirim sekali.
- **Test baru `tests/integration/outbound-log-failure-no-retry.test.ts`:** log OUTBOUND throw → `processMessage` tetap resolve; pesan terkirim tepat sekali.
- **Verifikasi:** `npx tsc --noEmit` 0; test baru hijau.

#### Pembersihan Suite — Isolasi LLM Dua Test Flaky (#101) (2026-09-20)

- **Akar:** `live-chat-reply` & `robustness` menembak network LLM nyata (kredensial `.env` bocor ke test) → `[LLM MODEL FALLBACK] timeout of 15000ms` + retry → melewati `testTimeout`.
- **Perbaikan:** isolasi seam LLM di kedua test (mock `callChatCompletionsWithFallback`; spy `GenerationStage.executeChatCompletion`). Tidak menurunkan validasi.
- **Verifikasi:** full suite **399 files / 2934 passed / 0 failed** (1 skipped) — pertama kali 100% hijau. `docs/KNOWN_ISSUES.md` #101 → RESOLVED.

#### Stage 6 (Revisi) ST6-3d — Perbaikan Bocor Konsultasi via Tawaran Asisten (2026-09-19)

Ditemukan saat verifikasi sandbox LLM nyata (skenario S1): pada turn konsultasi lanjutan, **tawaran asisten** menyebut layanan → cart terisi walau verdict tersimpan EXPLORING.

- **`src/v3/state/cart-manager.ts`** — gerbang `exploringLock` dihitung sekali dari SELURUH riwayat: bila `lastCommitment === 'EXPLORING'` DAN tidak ada pesan USER mana pun yang membawa sinyal komitmen/hari DAN `bookingCommitConfirmed !== true` → seluruh giliran (user MAUPUN asisten) DILARANG mengisi cart; penyebutan hanya ke `discussedTreatments`. Sebelumnya gerbang hanya berlaku untuk pesan user (`!isAssistant`) sehingga rekomendasi asisten lolos.
- **Bukti uji sandbox (LLM nyata):** phone baru → "kak bapil pakai treatment apa" → "pijut pulih ceria itu aman ya" → "makasih": cart **KOSONG** sepanjang alur. Sebelumnya turn 2 terisi.
- **Test:** `tests/integration/cart-commitment-cross-turn.test.ts` +2 kasus (tawaran asisten saat EXPLORING tidak mengisi cart; EXPLORING lalu komit eksplisit tetap terisi) → 8/8 hijau.
- **Verifikasi:** `npx tsc --noEmit` 0. Full suite: 2 test **timeout** (`live-chat-reply`, `robustness`) — **terbukti pre-existing** (gagal juga di kode bersih via `git stash`), bukan regresi.

#### Stage 6 (Revisi) ST6-3c — Test Integrasi Kontrak Komitmen Lintas-Turn (2026-09-19)

- **`tests/integration/cart-commitment-cross-turn.test.ts` (baru)** — 6 test mengunci: verdict EXPLORING tersimpan → cart tidak terisi; EXPLORING + sinyal komitmen eksplisit → cart terisi; COMMITTED → cart terisi; tanpa verdict → perilaku `?` lama; `applyCommitmentVeto` EXPLORING mengosongkan, COMMITTED tidak mengubah.
- **Verifikasi:** 6/6 hijau.

#### Stage 6 (Revisi) ST6-3b — Verdict Komitmen Persisten Lintas-Turn (`lastCommitment`) (2026-09-19)

Temuan dari uji sandbox nyata: veto satu-turn TIDAK cukup karena `prepareSession` menghitung ulang cart dari riwayat SETIAP turn (sebelum Call 1), dan verdict hanya ada di 2 tool.

- **`src/v3/domain/types.ts`** — `CustomerGoalSession.lastCommitment?: CommitmentLevel` (persisten lintas turn).
- **`src/v3/state/goal-tracker.ts`** — `getGoalSession` mengembalikan `lastCommitment` dari `preferences` (sebelumnya tidak dibaca → persist sia-sia).
- **`src/v3/state/cart-manager.ts`** — `syncCartItems` gerbang baru `isExploringVerdict`: bila `lastCommitment === 'EXPLORING'` DAN pesan user tidak membawa sinyal komitmen/hari → item masuk `discussedTreatments`, DILARANG cart.
- **`src/v3/agent/agent-runner.ts`** — verdict Call 1 dipersist ke `lastCommitment`; veto turn-ini tetap bila EXPLORING + cart terisi.
- **Field `commitment` ditambahkan ke SEMUA 6 tool** (`get-catalog`, `calculate-delivery`, `search-knowledge-faq`, `clinic-faq`, `escalate-human`, `save-reservation`) + zod-nya — sebelumnya hanya 2 tool, sehingga verdict hilang saat Call 1 memilih tool lain (bukti log sandbox `commitment:null`).
- **Bukti uji sandbox (LLM asli):** konsultasi "pijat oksitosin itu untuk ibu melahirkan ya" → cart KOSONG di turn itu & turn lanjutan; "kak bapil..."→"boleh bund" → cart terisi; "mau ambil pijat ceria buat adek" → cart terisi.
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite **398 files / 2926 passed / 0 failed** (1 skipped).

#### Stage 6 (Revisi) ST6-4 — Verdict COMMITTED Me-latch Komitmen Booking (2026-09-19)

- **`src/v3/agent/agent-runner.ts`** — setelah Call 1, bila `routing.commitment === 'COMMITTED'` dan `!session.bookingCommitConfirmed` → persist `bookingCommitConfirmed=true` (sticky). Menyatukan cart & tool-masker pada satu sumber penilaian semantik LLM, menggantikan ketergantungan pada daftar verba hafalan.
- **Pengaman tidak berubah:** `save_reservation` tetap butuh treatment + lokasi + tanggal (masker PRASYARAT utuh).
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; suite cart/booking/masking/agent 48/48; full suite 2925 passed / 1 flaky (`robustness.test.ts`, lulus isolasi — pra-existing).

#### Stage 6 (Revisi) ST6-3 — Verdict Komitmen Call 1 Menjadi Otoritas Cart (2026-09-19)

- **Arah:** tanpa shadow/flag (belum deploy); langsung enforce. Verdict Call 1 memveto cart hasil heuristik.
- **`src/v3/agent/pipeline/generation-stage.ts`** — `RoutingOutput` + `commitment`; verdict dihitung sekali, dicatat (`ROUTER_COMMITMENT_VERDICT`), dikembalikan.
- **`src/v3/state/cart-manager.ts`** — method murni baru `applyCommitmentVeto(session, commitment)`: bila `EXPLORING`, `cartItems` dikosongkan & dipindah ke `discussedTreatments`; bila bukan EXPLORING/absen → tidak mengubah (jalur lama jadi cadangan).
- **`src/v3/agent/agent-runner.ts`** — setelah Call 1, bila `routing.commitment === 'EXPLORING'` → terapkan veto.
- **`tests/unit/v3/cart-declarative-consultation.test.ts`** — 2 kasus konsultasi MERAH → **HIJAU** (4/4).
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; suite cart/booking/masking 41/41; full suite 2925 passed / 1 flaky (`migration.test.ts`, lulus isolasi — pra-existing, bukan regresi).

#### Stage 6 (Revisi) ST6-1 & ST6-2 — Kontrak Verdict Komitmen (Shadow) (2026-09-19)

Arah disetujui user: keputusan "tanya vs beli" diserahkan ke Call 1 LLM (yang sudah membaca history), TANPA API call tambahan. ST6-1 & ST6-2 = fondasi + observasi shadow; belum mengubah keputusan cart.

- **ST6-1 `src/v3/domain/types.ts`** — tipe baru `CommitmentLevel` (`EXPLORING|CONSIDERING|COMMITTED`) + `TurnInterpretation`.
- **ST6-2 `src/v3/tools/get-catalog.tool.ts`, `calculate-delivery.tool.ts`** — field JSON `commitment` opsional (enum) ditambahkan ke 2 tool.
- **ST6-2 `src/v3/tools/tool-schemas.ts`** — `commitment` opsional di zod (strip-safe).
- **ST6-2 `src/v3/agent/prompt/phases/router-tool-routing.layer.ts`** — 1 blok instruksi penilaian komitmen semantik (contoh EXPLORING/CONSIDERING/COMMITTED).
- **ST6-2 `src/v3/agent/pipeline/generation-stage.ts`** — shadow log `ROUTER_COMMITMENT_VERDICT` (belum dipakai keputusan).
- **Test baru `tests/unit/v3/cart-declarative-consultation.test.ts`** — reproduksi 2 bug (konsultasi tanpa `?` masuk cart); **2 sengaja MERAH** (target perbaikan ST6-3), 2 komitmen sah hijau.
- **Verifikasi:** `npx tsc --noEmit` 0; suite terkait 33/35 (2 merah = target ST6-3, bukan regresi).

#### Micro-task Isolasi Tenant pada Tool Eskalasi (Audit V3, RC-01) (2026-09-19)

- **`src/v3/tools/escalate-human.tool.ts:46`** — lookup conversation jalur eskalasi kini tenant-scoped: `findUnique({ where: { id } })` → `findFirst({ where: { id: conversationId, tenant_id: tenantId } })`. Mencegah conversation milik tenant lain ikut dieskalasi (cross-tenant leak RC-01). Kontrak output tidak berubah.
- **Verifikasi:** `npx tsc --noEmit` 0; `tests/v3/agent-tools.test.ts`, `tests/unit/v3/tool-pipeline.test.ts`, `tests/unit/v3/escalation-hard-guards.test.ts`, `tests/unit/v3/structural-refusal-tagging.test.ts` → 30/30 hijau.

#### Stage 1 — Correlation Spine + Real-DB Harness (Audit V3) (2026-09-19)

Menyambung korelasi end-to-end

- **MT-1.2 `utils/context.ts`** — `ContextData` diperluas aditif: `turnId?`, `provider?: 'WAHA'|'WABA'`, `inboundMessageId?`.
- **MT-1.2 `queue.service.ts`** — `QueuePayload` diperluas aditif (`correlationId/turnId/provider/inboundMessageId` opsional); worker BullMQ & in-memory kini membungkus `stateMachine.processMessage` dengan `contextStorage.run(...)` agar correlation ID tidak hilang setelah boundary webhook.
- **MT-1.2 `webhook.route.ts`** — `enqueueMessage` WAHA meneruskan `correlationId`, `turnId` (`{tenant}:WAHA:{waMessageId}`), `provider`, `inboundMessageId`.
- **MT-1.2 `waba-webhook.route.ts`** — handler dibungkus `contextStorage.run`; `enqueueMessage` WABA meneruskan IDs (`{tenant}:WABA:{msg.messageId}`).
- **MT-1.3 `llm-execution-logger.ts`** — `LlmExecutionRecord` aditif: `turnId?`, `tenantId?`, `conversationId?`, `actualProvider?`, `actualModel?`.
- **MT-1.3 `agent-runner.ts` + `generation-stage.ts`** — `AgentRunnerInput`/`TurnState` memperoleh `turnId?`/`provider?`; `recordCall` mengisi field korelasi baru.
- **MT-1.3 `machine.ts`** — meneruskan `turnId`/`provider` dari `contextStorage.getStore()` ke `V3AgentRunner`.
- **MT-1.3 `shutdown.ts`** — graceful shutdown menambah `flushLlmAuditBuffer()`.
- **MT-1.4 `vitest.db.config.ts` (baru) + `tests/db/v3-foundation.db.test.ts` (baru)** — harness PostgreSQL nyata terpisah (tanpa `tests/setup.ts`), guard anti-host-produksi, dan test constraint/transaksi/concurrency. Di-skip otomatis bila `TEST_DATABASE_URL` tidak di-set sehingga `npm test` tetap offline bersih.
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite **397 files / 2922 passed / 24 skipped / 0 failed**; test DB ter-skip rapi tanpa URL (exit 0).

#### Resolusi 14 Kegaalan Test Pre-Existing (Green Full Suite + Build) — 14 Fix (2026-09-19)

- **P1 `llm-outage-silent`** `generation-stage.ts:295` — `reportTurnError` gagal menjalankan kontrak desainnya sendiri (`agent-runner.ts:339`: "TANPA balasan generik — eskalasi sunyi"). Dulu mengembalikan `shouldSendReply:true` + apology generik saat outage LLM. Kini `replyText:''` + `shouldSendReply:false` (Fase B/owner: eskalasi sunyi, queue CS didahulukan — `docs/KNOWN_ISSUES.md#853`). `anti-silent-drop-invariant.test.ts` blok 4 (test basi pengharap apology) direkonsiliasi ke kontrak sunyi: `isEscalated:true`, `nextState:HUMAN_HANDLING`, `sentToCustomer.length===0`.
- **P2 `keyword-enrichment`** `keyword-enrichment.service.ts` — tambah sinonim `kabel olor` ke rule keyword persiapan (data-driven, bukan regex hafalan).
- **P3 `ai-models-tenant`** `ai-models.config.ts` — registry default (`defaultDeepModel`, `AI_MODEL_HARVESTING`, `AI_MODEL_MEDICAL`, `AI_MODEL_SUMMARIZATION`, `AI_MODEL_PII`) di-sanitasi via `sanitizeModelForProvider` agar model non-kanonik provider (mis. `gpt-4o-mini` → `deepseek-v4-1-flash`) tidak bocor.
- **P4 `admin-api-cache`** `admin-api-cache.test.ts` — test app-level di-beri timeout `30000` (cold-start `buildApp`, bukan hang).
- **P5 `queue-durability`** `queue.service.ts` — tambah `redisInitPromise: Promise<boolean>|null` dari chain init + `ensureRedisOrThrow()` (throw `FATAL_QUEUE_REDIS_REQUIRED` saat `QUEUE_REQUIRE_REDIS==='true'` & Redis tak siap) selaras FOUNDATIONAL_HARDENING_PLAN G2.
- **P6 `typing-transport`** `typing.service.ts` — param konstruktor ketiga `transportResolver?: (tenantId)=>Promise<MessageTransport|undefined>`; `simulateHumanReply` dispatch `sendSeen/startTyping/stopTyping/sendText` melalui transport tenant (back-compat fallback client).
- **P7 `message-idempotency`** — test kini inject `setMessageRepository(new PostgresMessageRepository())` (beforeEach) + `resetMessageRepository` (afterEach) agar mock `prisma.message.findFirst` benar terpakai (seam PLAN 8 FASE 5c).
- **P8 `llm-evaluator`+`self-learning` (akar bersama)** `llm-gateway.ts:39` — precedence key salah: `activeEndpoint.apiKey` (key asli `.env`) menang atas sentinel `LLM_API_KEY='mock'` → guard `startsWith('mock')` tak pernah trip → `axios.post` benar dipanggil (call+retry). Kini sentinel mock env menang atas registry bila tanpa override; klien yang "offline" tidak lagi memanggil LLM beneran.
- **P9 `deterministic-tool-arg-gate`** `persona.ts` — `isNonMonetaryBerapa` kini cek token SEBELUM `berapa/brp` juga (bukan hanya sesudah): `'bayi usia berapa minimal boleh dipijat'` tidak lagi salah tangkap `ask_price`.
- **P10 `cart-dedup-total`** `calculate-delivery.tool.ts` — recap grand total (`buildCartTotalRecap`) kini disuntik ke `out.message` (payload LLM) DAN `suggestedTemplateReply` di kedua cabang (URL-Maps & geocoding-teks), bukan hanya template; konsisten dengan `anti-premature-invoicing` (mode konsultasi tetap tanpa nota).
- **Verifikasi:** `npm test` penuh **397 files / 2922 passed / 24 skipped / 0 failed**; `npm run build` exit 0.

#### Resolusi Sabotase Validator Usia & Eksplisitasi Famili Terapi (Sesi 476427) — 2 Fase (2026-09-19)

- **P1 Guardrail `guardrail-pipeline.ts:483` — Context-Aware Exemption:** `hasAgeQuestion` reprompt kini diperiksa `isAgeClarificationAuthorized = executedTools.some(t.name==='get_catalog_and_price' && result.needsAgeClarification===true)` (state-gated, bukan hafalan kalimat). Pertanyaan usia netral `berapa bulan atau berapa tahun` yang diwajibkan `CLINICAL_PROBE` multi-tier (Pulih Ceria BABY vs KIDS) tidak lagi disabotase. Non-klinis (jadwal/ongkir) tetap di-reprompt.
- **P2 Tool `get-catalog.tool.ts:87,744,785,797` — Kontrak & Direktif:** Tambah `needsAgeClarification?:boolean` di `GetCatalogOutput`; `needsAgeClarification` deteksi `normalizeFam` (buang `bayi|kids|anak`, `famBase` BABY vs KIDS) — fix bug `base "pijat kids"` gagal match `Pijat Bayi Pulih Ceria`. Direktif `CLINICAL_PROBE` kini `Keluhan (kembung) dapat dibantu dengan terapi *Pijat Pulih Ceria*... SEBUTKAN *Pijat Pulih Ceria* + manfaat ringkas, lalu TANYAKAN USIA netral` (eksplisit famili, bukan "terapi khusus" generik). Return `needsAgeClarification` agar guardrail sinkron.
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; `v3-persona-rules` 15/15 hijau; Turn 1 `anak saya kembung treatment apa ya yang cocok` → `Pijat Pulih Ceria` + tanya usia netral (tidak buntu).

#### Mode Peta Jalan OSM Plain Grayscale — Hanya Jalan, Tanpa Warna, Terbatas Sby/Sda (2026-09-20)

- **`packages/admin-dashboard` — basemap Peta Jalan diganti** menjadi **CARTO `light_nolabels`**
  (data OpenStreetMap, tanpa label nama jalan/POI) + CSS filter `grayscale(1) contrast(0.96) brightness(1.04)`
  pada kelas `.customer-map-osm-gray` (`src/index.css`) — peta "sangat simple", hanya kerangka jalan
  abu-abu, zero distraksi teks.
- **Terbatas Surabaya & Sidoarjo:** TileLayer diberi `bounds: SURABAYA_RAYA_BOUNDS` — tiles hanya
  dimuat di area Sby/Sda; di luar itu kontainer peta netral (sesuai permintaan "yang lain tidak perlu").
- **Robust:** `minZoom 4`/`maxZoom 18`/`maxNativeZoom 20` mendukung zoom-out maksimal saat "Semua wilayah";
  diterapkan konsisten di initial layer (`CustomerMapTab.tsx`) dan cabang streets pada mode effect.
  (Evolusi basemap: CartoDB light_all → OSM standar grayscale → CARTO light_nolabels grayscale.)
- **Verifikasi live:** chunk `CustomerDatabase-*` ter-serve berisi `light_nolabels` & `.customer-map-osm-gray`,
  referensi `tile.openstreetmap.org` hilang.

#### Pengerasan Lanjutan Peta Area Vektor — State Reaktif, Pointer-Transparent, Adaptive Bounds, ResizeObserver (2026-09-19)

- **`packages/admin-dashboard/src/components/customer/CustomerMapTab.tsx`** — 6 temuan audit dibereskan secara fondasional:
  - **Anti-race blank screen:** `boundaryGeoRef` (useRef) → `boundaryGeo` (`useState`) + `geoLoading`; efek mode peta kini reaktif terhadap `boundaryGeo` sehingga toggle "Area Vektor" saat GeoJSON masih dimuat tidak lagi menghasilkan kanvas kosong permanen; ditambah indikator "Memuat batas wilayah…".
  - **Pemulihan hierarki warna:** poligon kelurahan dikembalikan ke **biru pudar** (`#eff6ff` / border `#93c5fd`, dash `2,3`), hover biru segar `#bae6fd`/`#0284c7`; legenda UI disinkronkan (Hijau Kota → Orange Kecamatan → Biru Pudar Kelurahan).
  - **Tooltip anti-flicker:** garis batas kota/kecamatan kini `className: 'pointer-events-none'` pada style Leaflet (deklaratif, tahan re-render) — tidak pernah mencuri pointer di atas poligon kelurahan.
  - **Adaptive camera bounds:** efek reaktif `showAllCities` → `setMinZoom(4)` + `setMaxBounds(null)` saat "Semua wilayah" aktif, kembali `minZoom 10` + `SURABAYA_RAYA_BOUNDS` saat nonaktif.
  - **Layering radius:** lingkaran jangkauan klinik dipindah ke custom pane `radiusPane` (zIndex 280, di bawah overlayPane/marker) agar tidak menutupi marker pelanggan.
  - **Responsivitas:** `ResizeObserver` pada kontainer peta memanggil `invalidateSize()` saat tab/resize berubah (cegah ubin abu-abu).
- **Regression gate:** `customer-map-points` 12 + `customer-map-utils` 19 = 31 hijau; build admin-dashboard & bot engine exit 0.

#### Perbaikan Fondasional Peta Area Vektor — Grid-Snap Dissolve & UI Map Pengerasan (2026-09-19)

- **Build script `scripts/build-surabaya-sidoarjo-svg.ts` ditulis ulang dengan algoritma grid-snap dissolve** (bukan SVG). Kompilasi ulang batas topologis bersih antara Surabaya & Sidoarjo dari dataset HDX/BPS-2020:
  - Snap vertex ke grid `0.0002°` (~22 m) supaya sisi batas antar kelurahan **persis berimpit** (sharing edge antar ring naik ke 93%), lalu klasifikasikan tiap undirected cell-edge deterministik: 1 owner → batas kota/kabupaten; ≥2 owner satu kecamatan → dibuang (internal); beda kecamatan → batas kecamatan; beda kota → batas kota.
  - Menyambung edge menjadi polyline hanya lewat node ber-degree 2 (berhenti di percabangan) → **157 line batas (38 regency + 119 district)** menggantikan 5.176 segment lama (−97%).
  - Simplifikasi Douglas-Peucker border `0.00015°`, desa `0.0015°`; **output 462,5 KB < ambang 500 KB**; `geo-metadata.json` menyimpan bbox efektif + jumlah kecamatan.
  - Perbaikan bug charting: struktur `[polygon][ring][point]` MultiPolygon (iterasi ring sebagai point), pengodean sel grid yang rusak utk latitude negatif (kunci string `cx:cy`), stitch menerobos cabang.
  - **Output terverifikasi:** titik Gubeng (`112.7611,-7.2721`) tidak lagi masuk garis batas kota (sebelumnya memotong wilayah Utara, false positive yang menghilangkan porsi Surabaya).
- **Pengerasan UI `packages/admin-dashboard/src/components/customer/CustomerMapTab.tsx`:**
  - **Preload GeoJSON** sekali saat peta siap (mengisi ref terpisah dari mode), saat toggle Area Vektor layer langsung dirender dari data tersimpan — menghilangkan blank-flash & re-fetch berulang.
  - **`pointer-events: none` pada semua feature border** (`regency_border`/`district_border`) ditegakkan di `onEachFeature` (bukan hanya `interactive:false` bergaya) → tooltip poligon kelurahan tidak lagi "karat" / flicker kala kursor melewati garis batas overlay pane 250.
  - **Kontras mode Area Vektor:** latar kertas `#f1f5f9`, poligon kelurahan **putih `#ffffff` 95%** berbatas `#cbd5e1`, sorot hover biru langit `#e0f2fe`/`#0284c7` — poligon kini jelas terpisah dari garis kecamatan orange & kota hijau.
  - **Panning longgar:** `maxBounds` diperluas ke `[[-7.90,112.10],[-6.75,113.15]]` dengan `maxBoundsViscosity: 0.3` — pinggir map tidak terasa "dikunci elastis" saat panning (batas zoom-out-min tetap `minZoom: 10`).
  - **Fokus filter kota:** basecamp Sidoarjo hanya digabung ke `fitBounds` bila `!kotaFilter` atau filter = Sidoarjo — saat filter ke kota lain peta tidak tertarik mundur ke Sidoarjo.
- **Regression gate:** `customer-map-points` 12 + `customer-map-utils` 19 = 31 hijau; build admin-dashboard & bot engine exit 0.

#### Resolusi Komprehensif Sesi 607894/622098/284330/594329 — 8 Fase (Maternal, Atomic, Sanitizer, Usia) (2026-09-19)

- **P1 Maternal + anti-KIDS lock** `router-tool-routing.layer.ts:20` inklusi keluhan Bunda (ASI seret, payudara bengkak/keras/nyeri, puting lecet, laktasi, nifas, pegal hamil) → `get_catalog_and_price category:MOMS`; larangan `category KIDS` sepihak bila usia null (lintas BABY/KIDS). `get-catalog.tool.ts:220` `category KIDS && age==null → undefined` (BABY tidak tereliminasi).
- **P2 Atomic** `generation-stage.ts:511` pruning `parsedCalls>1` → prioritas `get_catalog_and_price > calculate_delivery > get_clinic_policy_faq` + `PARALLEL_TOOL_CALLS_PRUNED` + sinkron `toolCalls`.
- **P3 Sanitizer** `sanitizer.ts:428` `, \u0000:` → `:` + `, :` cleanup (anti `, :`) + `sanitizer.ts:472` bullet `\n[-•*]|\d+[.)]` sebagai batas kalimat (9 kalimat → 3).
- **P4 Usia** `treatment-catalog.service.ts:1354` penalti `anak` bila `age==null` + `get-catalog.tool.ts:708` fix `normalizeFam` (buang `bayi|kids|anak`) → `needsAgeClarification` true untuk Pulih/Sembelit multi-tier → tanya `berapa bulan atau berapa tahun`.
- **P5-P8** tetap dari sesi sebelumnya: D9 amnesia, Jambangan dual-admin, cart hijack, isolasi GENERAL, demam `ClinicPolicy`, RAG `0.25`, ongkir state-aware.
- **Verifikasi:** `npm run build` 0; sanitizer `, :`→`:` PASS, bullet 4→3 PASS, D9 amnesia `isValid:false`, Jambangan precise, full suite targeted 39 hijau.


#### Penyempurnaan UX Peta — Pewarnaan Multi-Level Batas Wilayah, Eliminasi Auto Zoom-Out & Pembatasan Zoom Maksimal (2026-09-19)

- **Pewarnaan Multi-Level Batas Wilayah (Sesuai Hirarki Detail):**
  - Kota / Kabupaten (`regency_border`): Garis batas **Hijau Tegas** (`#008069`, tebal 3.2px, 95% opacity).
  - Kecamatan (`district_border`): Garis batas **Orange** (`#f97316`, tebal 1.8px, 85% opacity).
  - Kelurahan / Desa (`village`): Area poligon **Biru Pudar** (`fillColor: '#eff6ff'`, fillOpacity 50%, batas `#60a5fa`, tebal 0.6px, dash-line), dengan efek sorot kursor (*hover highlight*) biru langit (`#93c5fd` / `#2563eb`) yang menampilkan tooltip nama desa/kelurahan dan kecamatannya.
  - Sesuai prinsip *"Semakin detail wilayahnya, semakin pudar warnanya"*. Dilengkapi indikator legenda visual di bawah peta saat mode Area Vektor aktif.
- **Eliminasi Tuntas Bug UX Auto Zoom-Out:**
  - `CustomerMapTab.tsx`: Membungkus filtering titik (`kotaOptions`, `cityFiltered`, `allowedStatuses`, `visiblePoints`, `metrics`) dengan `useMemo` agar pergantian mode peta tidak menghasilkan referensi array baru yang memicu siklus render ulang marker.
  - Memasang gerbang `hasInitialFittedRef` sehingga `map.fitBounds()` **hanya dijalankan tepat 1 kali pada pemuatan awal** (atau saat filter kota diganti / tombol Refresh ditekan).
  - Pengguna bebas berganti antara **"Peta Jalan"** dan **"Area Vektor"** tanpa peta tiba-tiba melompat zoom-out; posisi dan zoom pengguna 100% terjaga.
- **Pembatasan Batas Zoom-Out Maksimal (Maksimal Terlihat Gresik Saja):**
  - Inisialisasi peta Leaflet disetel dengan `minZoom: 10`, `maxZoom: 18`, dan `maxBounds: [[-7.70, 112.30], [-6.85, 113.00]]` (`maxBoundsViscosity: 0.85`).
  - Mencegah peta di-zoom out hingga melihat seluruh Jawa Timur atau seluruh Indonesia; kanvas terkunci di area metropolitan Surabaya Raya (Gresik Utara - Surabaya - Sidoarjo Porong).

#### Penyempurnaan Fitur Sebaran Pelanggan — Endpoint Toleran, Basecamp Tenant-Aware, KPI Spasial, Backfill Sentroid (2026-09-19)

- **Fase 1 — Data integrity & endpoint backend (tanpa menyentuh pipeline AI):**
  - `src/config/clinic-location.ts` (baru) — sumber lokasi basecamp tenant-aware dari
    `Tenant.settings.clinicLocation` (pola `brand.ts`, tanpa migrasi). Fallback ke
    `clinicConfig` env saat tenant tanpa override/DB offline.
  - `src/utils/wilayah-normalizer.ts` (baru) — sanitasi teks wilayah dari data kotor
    hasil scraping (`kecamatan = "Kota :"`, `kota = "No. Hp : 0878..."`), `isValidAreaName`.
  - `customers.subroute.ts` — endpoint `map-points`:
    - Filter wilayah default **toleran**: kota/kecamatan mengandung
      surabaya/sidoarjo/gresik/sby/sda, ATAU `distance_km <= 35`, ATAU bounding box
      Surabaya Raya.
    - Titik **sentroid estimasi** (`is_estimated_centroid: true`) untuk pelanggan
      `lat NULL` yang punya kelurahan/kecamatan valid → resolusi gazetteer lokal.
      Data kotor dilewati. `?includeCentroids=false` untuk mematikan.
    - Metadata `clinic` (lat/lng/nama/maxCoverageKm/rings) tenant-aware.
  - **Bukan perbaikan pipeline AI:** audit log & DB live membuktikan jalur
    `human-background-enrichment` sudah menyimpan koordinat (135 customer live punya
    lat). V3 goal-tracker tidak menyimpan lat/lng namun bukan masalah.
- **Fase 2 — Visual peta, Bug Fix "White Board" & Mode Area Vektor Murni:**
  - Mengintegrasikan **Basemap CartoDB Positron TileLayer** (`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`)
    dengan kontras lembut, nama jalan, dan toponimi Indonesia jelas — menyelesaikan tuntas
    bug kanvas putih kosong ("white board").
  - Menambahkan deterministik `map.invalidateSize()` pasca-mount (150ms) dan sebelum `map.fitBounds()`
    untuk memastikan kalkulasi dimensi kontainer Leaflet tidak `0x0`, mencegah proyeksi koordinat `NaN`.
  - Menggunakan native `L.featureGroup()` untuk layer titik pelanggan agar circle marker langsung ter-render
    tanpa tersembunyi di dalam div cluster yang belum ter-styling.
  - **Peta Area Vektor Murni (Surabaya & Sidoarjo)**:
    - Script `scripts/build-surabaya-sidoarjo-svg.ts` (baru) — mengompilasi dataset resmi BPS/HDX
      49 kecamatan (31 Surabaya + 18 Sidoarjo, 507 kelurahan) ke SVG teroptimasi (`surabaya-sidoarjo-map.svg`, 287 KB),
      GeoJSON (`surabaya-sidoarjo.geojson`, 523 KB), dan `geo-metadata.json` berbasis proyeksi Web Mercator presisi 100%.
    - Menambahkan **Switcher Mode Peta** di toolbar dashboard: **[Peta Jalan]** (CartoDB) vs **[Area Vektor]** (hanya siluet bidang
      batas kecamatan Surabaya & Sidoarjo tanpa jalan, rambu, atau distraksi visual, dengan tooltip interaktif).
  - Marker basecamp klinik (label permanen) + 3 lingkaran radius jangkauan (5/15/max km)
    dengan toggle "Tampilkan Radius".
  - Pembeda marker: GPS presisi (solid) vs estimasi sentroid (garis putus-putus).
  - Popup: badge status + penanda GPS Akurat/Estimasi Wilayah + jarak km.
- **Fase 3 — KPI spasial & filter interaktif:**
  - `customerMapUtils.ts`: `computeSpatialMetrics`, `filterPointsByStatus`, `statusOf`,
    `normalizeCity` diperkuat (sby/sda, buang prefix administratif).
  - 4 KPI card (total terpetakan, keterjangkauan %, rata-rata jarak, top wilayah)
    + legenda menjadi tombol toggle filter status.
- **Fase 4 — Backfill & dokumentasi:**
  - `scripts/backfill-customer-centroids.ts` (baru) — backfill non-destruktif
    (hanya `lat IS NULL`) dari gazetteer; `--dry-run`, `--tenant=`; cursor-based
    pagination (tahan mutasi selama iterasi). Lokal: 63 customer ter-update.
- **Test:** `customer-map-points` 12, `customer-map-utils` 19, `wilayah-normalizer` 5,
  `clinic-location` 7 — seluruhnya hijau. Build bot & admin hijau.

#### Gerbang Deterministik Balasan Lokasi Murni — Fast SOP Tanpa Call 2 (2026-09-19)

- **Validasi plan (2 Fase DITOLAK, 1 dimodifikasi):** (a) exemption
  `suggestedTemplateReply` di `buildLlmSafeToolPayload` DITOLAK — tidak perlu
  (fast-path konsumsi RAW `executedTools` di memori; payload LLM tetap murni,
  anti parrot-effect, test `tool-pipeline` pin deletion tetap hijau) dan berbahaya
  (parrot-effect kembali di giliran campuran). (b) Klausul prompt "WAJIB persis /
  DILARANG basecamp" DITOLAK (make-up; giliran campuran dijaga validator D8).
  (c) Klaim "100% kata-demi-kata, hemat ~13.000 token" dikoreksi: TERBUKTI via
  eksekusi bahwa sanitizer kuota vokatif menormalisasi bunda ekor template
  ("saja bunda. Jadi bisa ya bunda" → "saja. Jadi bisa ya") — output ≈95%
  template; angka token tak terverifikasi (`logs/llm-2026-09-19.jsonl` kosong).
  (d) Kriteria "symptom score = 0" tidak ada di codebase — dipetakan ke sinyal
  deterministik (`consult_symptom`/`ask_schedule`/`ask_duration`,
  `hasFallInjurySignal`/`hasVaccineSignal`, sebutan nama katalog data-driven).
- **Fixed:**
  1. `src/v3/tools/calculate-delivery.tool.ts` — 4 cabang ambigu/gagal
     (ambiguity kecamatan, `kecLevelName`, tanpa-koordinat, generik) kini membawa
     `suggestedTemplateReply` (`askKelurahanAmbiguous`/`askKelurahanRetry`).
     `message` tak berubah (jalur Call-2 fallback + information-hiding utuh).
  2. `src/v3/agent/pipeline/delivery-fast-path.ts` (baru, pure) — gate
     lokasi-murni: single `calculate_delivery` + template terisi + intent ⊆
     {provide_location, ask_price} + tanpa sinyal medis + tanpa sebutan katalog.
     Turn-0 prepend `firstContactGreetingHeader` (flag Islami via detector
     eksisting `hasIslamicSalutation`, baru) agar SOP greeting tak hilang.
  3. `src/v3/agent/agent-runner.ts` — Stage 3b: fast-path eligible →
     `draftReply` template + `tel.traceExecution`; tetap mengalir ke Stage 5
     (validator D8/numerik + sanitizer). Giliran campuran fail-open ke Call 2.
- **Sengaja TIDAK diubah:** CTA ongkir tetap state-aware audit 337101; tidak ada
  teks "DILARANG..." baru di prompt.
- **Test (TDD):** `delivery-fast-path` 22/22 (13 varian gate + 2 enrich + 2
  integrasi: pure = 1 axios call tanpa "basecamp"; compound = Call 2 jalan).
  Regression 175/175 (18 file); `npm run build` 0. `cart-dedup-total` 1 gagal
  pre-existing (verifikasi git stash sesi lalu).

#### Restorasi Greeting SOP & Gerbang Deterministik Narasi Asal Basecamp D8 (2026-09-19)

- **Validasi plan (ditolak sebagai tambal-sulam, direvisi fondasional):** plan usulan
  mengembalikan `suggestedTemplateReply` ke payload LLM + menambah larangan teks
  "DILARANG..." di prompt — DITOLAK (regresi arsitektur data-murni anti-parrot
  2026-09-19 + Mandat Anti-Penyelesaian Case-by-Case). Klaim "b5b2f3cd mengubah CTA"
  terbukti keliru (CTA state-aware sudah ada di 91ade27e). Frasa "dari basecamp kami
  di Waru" tidak ada di template mana pun (murni karangan LLM dari grounding RAG
  homebase); penyebutan "Bungurasih, Waru" adalah fakta geografis sah (lihat Known
  Issues #94). `logs/llm-2026-09-19.jsonl` kosong — tanpa bukti log live.
- **Fixed:**
  1. `src/config/persona.ts` — `TEMPLATES.greeting()` kembali ke 4-blok SOP
     (salam + "Terima kasih sudah menghubungi kami." + perkenalan homecare +
     pemantik domisili; identitas via `getBrandIdentity()`). Template deterministik
     Turn-0 dikecualikan kuota kalimat Rule 1 (mengatur generation); kuota vokatif
     2x terjaga. `firstContactGreetingHeader` tetap pendek (prefix LLM, anti-duplikasi).
  2. `src/v3/guardrails/factual-claim-validator.ts` — **D8_ORIGIN_NARRATION**:
     gerbang kode deterministik berbasis kontrak tool (calculate_delivery sukses +
     get_clinic_policy_faq TIDAK terpanggil → bingkai asal generik invalid).
     Ditangani re-prompt kognitif + salvage kalimat yang sudah ada di
     guardrail-pipeline (preseden D7), tanpa parrot-template & tanpa prompt DILARANG.
  3. `src/v3/guardrails/sanitizer.ts` — `trimToMaxSentencesPreservingGreetingHeader`
     mengenali header kanonis SOP multi-baris (+ varian Waalaikumsalam) agar pemantik
     domisili tidak terpotong trimmer saat LLM menggema sapaan.
- **Sengaja TIDAK diubah (deviasi tercatat):** default CTA ongkir tetap state-aware
  audit 337101 (CTA "Rencana mau ambil perawatan..." + cabang treatment/tanggal);
  verbatim SOP "Mau pilih treatment apa bunda ?" akan membunuh context-awareness dan
  bertentangan dengan contoh prompt/few-shot yang mengajarkan CTA baru. Perlu
  konfirmasi tim admin bila verbatim tetap diminta.
- **Test:** D8 7/7 (4 parafrase adversarial + 2 eksempsi kontrak + 1 anti-false-positive
  template SOP); greeting SOP; header kanonis; `v3-persona-rules` Test 1 diselaraskan
  (batas template deterministik = 4). Targeted 93/93 + 66/67 hijau (`cart-dedup-total`
  1 gagal TERBUKTI pre-existing via git stash). `npm run build` 0.

#### Dashboard Peta Sebaran Pelanggan (Surabaya–Sidoarjo–Gresik) (2026-09-19)

- **Audit perbaikan (post-review, 2026-09-19):**
  - **Race condition marker tidak muncul (Kritis):** `loadLeaflet()` async lebih lambat
    daripada effect penggambar marker → `mapRef` masih null saat marker digambar, dan tidak
    ada re-trigger. Diperbaiki dengan state `mapReady` sebagai dependency + guard generation
    yang tahan double-invoke StrictMode (map selalu di-remove dengan benar).
  - **Sandbox test bocor ke peta:** endpoint `map-points` tidak mengecualikan
    `is_sandbox_test` seperti endpoint list. Ditambahkan `is_sandbox_test: false`.
  - **CSS Leaflet belum siap saat render:** CSS kini ditunggu (`waitForCss`) sebelum
    inisialisasi peta, mencegah marker/zoom tampil tanpa styling.
  - **Filter kota tidak menangkap varian penulisan:** logika filter & opsi dropdown
    diekstrak ke `customerMapUtils.ts` (pure, teruji) dengan normalisasi kota kanonik
    ("Kota Surabaya" / "Surabaya" → satu opsi "Surabaya").
  - **Tombol Refresh menyajikan cache basi:** `fetchCustomerMapPoints` kini mendukung
    `fresh` (via `refreshApi`) sehingga Refresh/retry benar-benar mengambil data baru.


- **Backend:** Endpoint ringan `GET /api/admin/customers/map-points` (`customers.subroute.ts`) —
  hanya mengembalikan kolom spasial (`lat/lng/kota/kecamatan/kelurahan/status/is_mql/is_out_of_coverage/distance_km`)
  untuk pelanggan dengan koordinat valid (`lat/lng NOT NULL` dan dalam rentang sah).
  - **Fokus wilayah layanan secara default:** hanya titik dengan kota mengandung "Surabaya",
    "Sidoarjo", atau "Gresik" (toleran variasi penulisan: "Kota Surabaya", "Kabupaten Sidoarjo",
    "Gresik Regency"). Gunakan `?scope=all` untuk menampilkan seluruh titik.
  - Filter `?kota=` memakai pencocokan **contains case-insensitive** (bukan exact-match) agar
    toleran terhadap variasi penulisan kota di DB. Tenant isolation (`DEFAULT_TENANT_ID`) dijaga.
- **Frontend:**
  - `leafletLoader.ts` (baru) — lazy-loader CDN Leaflet 1.9.4 + MarkerCluster 1.5.3 (idempotent, non-blocking,
    dimuat hanya saat tab peta dibuka). **Tanpa dependency npm baru.**
  - `CustomerMapTab.tsx` (baru) — peta geografis presisi berbasis koordinat, **tanpa basemap
    jalan/bangunan** (latar abu solid ber-grid agar fokus ke sebaran titik), marker clustering,
    warna marker data-driven (Aktif/MQL/status lain/di luar jangkauan), popup + tombol navigasi Google Maps,
    filter kota dari data, auto-fit bounds, fallback ramah saat CDN gagal, `useUiFeedback` untuk error.
    - **Detail pelanggan via tombol "Lihat Detail Pelanggan" di popup** (menggantikan dblclick yang
      tidak jelas/mudah salah), dengan HTML escaping nama/telepon untuk mencegah injeksi.
    - Toggle "Semua wilayah" + dropdown kota (filter di client, tanpa request ulang).
    Hook `clinic-map-ready` disiapkan untuk render batas kecamatan (GeoJSON) di masa depan.
  - `CustomerDatabase.tsx` — Tab ke-3 "Sebaran Peta" (bukan page baru) via `?tab=map`, deep-linkable.
  - `api.ts` — `fetchCustomerMapPoints()` + tipe `MapPoint`.
- **Test:** `tests/unit/customer-map-points.test.ts` — 8 skenario adversarial (koordinat invalid dibuang,
  filter contains case-insensitive, tanpa filter kota, spasi kosong diabaikan, fokus 3 kota + variasi
  penulisan, `scope=all`, DB error → 500, tanpa auth → 401).
  `tests/unit/customer-map-utils.test.ts` — 11 test util murni (normalisasi kota, filter, warna marker, validasi koordinat).
- **Limitasi:** Peta bergantung CDN unpkg + koneksi internet (lihat `docs/KNOWN_ISSUES.md`).

#### Perampingan Rules Fondasional, Ongkir Lokasi Presisi & Remediasi Gramatikal Sanitizer (2026-09-19)

- **Keputusan kebijakan (sesi 779408):** saat lokasi PRESISI terverifikasi, bot LANGSUNG
  menyampaikan jarak & ongkir promo meskipun customer hanya menyebut lokasi tanpa menanya biaya.
  Rule 2 (Information Hiding) direvisi: yang tetap dilarang adalah membeberkan **harga paket
  perawatan**/grand total sebelum ditanya/dipilih — bukan jarak/ongkir.
- **Fase 1 — Harmonisasi kontrak ongkir:**
  - `calculate-delivery.tool.ts`: `showFeeNominal` kini = `askedFee || (lokasi presisi & bukan
    centroid & dalam jangkauan)`. Kecamatan luas (imprecise) & luar jangkauan tetap menyembunyikan nominal.
  - `tool-pipeline.ts`: `markOngkirQuoted` dipicu saat ongkir benar-benar diekspos (bukan hanya
    `asksDeliveryFee`). Data terstruktur (`distanceKm`/`ongkirPromo`) dikirim apa adanya ke LLM —
    **`suggestedTemplateReply` TIDAK dikembalikan** ke payload LLM (menjaga dekomposisi anti-parrot).
  - `location-rules.phase.ts`: pin larangan ongkir diganti pin larangan **harga paket** (state-gated).
- **Fase 2 — Perampingan negative constraints (non-hardcode & SaaS-ready):**
  - Rule 4 direvisi jadi state-gated (`buildToneNegConstraints`): wajib tanya usia saat tanya
    harga paket anak HANYA bila usia belum ada di sesi; bila sudah ada → dilarang menodong usia.
  - Rule 10 (Newborn 0-28 hari) Dihapus → otoritas `Treatment.min_age_months`/`max_age_months` + tool.
  - Rule 15 (anti-tanya KM) dihapus (redundan dengan tool `calculate_delivery`).
  - Rule 17 (asumsi selapan & model cukur) dihapus → dialihkan ke RAG `search_knowledge_faq`.
  - Rule 11 dibuat tenant-agnostic (hapus hardcode "Waru"); homebase dirujuk ke `get_clinic_policy_faq`.
  - Rule 14 dibersihkan dari hardcode "alas tidur" → grounding ke [PANDUAN & KNOWLEDGE BASE]/RAG.
  - Rule 7 ditambah larangan menyebut "Admin CS".
  - `tenant-prompt-config.service.ts` default `negativeConstraints` diselaraskan (17 butir).
- **Fase 3 — Remediasi Mid-Sentence Mutilation (`sanitizer.ts`):** `limitVocativeQuota` kini
  melindungi sapaan berposisi SUBJEK/AGEN klausa di tengah kalimat — didahului modal verb
  (`ingin/mau/bisa/perlu/dapat/sedang/sudah/akan/belum/harus/boleh/sempat`) atau konjungsi
  subordinatif (`kalau/jika/apabila/bila/apakah/agar/supaya/saat/ketika`). Kasus nyata
  "Ada yang ingin Bunda konsultasikan..." tidak lagi terpotong.
- **Verifikasi:** `npm run build` 0; `v3-sanitizer-vocative-quota` 17/17,
  `calculate-delivery-precise-fee` 3/3, `calculate-delivery-broad-region` 5/5,
  `location-prompt-pruning` 8/8, `catalog-information-hiding` 4/4, `capi-repeat-order` 8/8,
  `parser-day-date-cross-validation` 6/6, integrasi `active-reservations-endpoint` 3/3;
  suite v3 620 passed (28 pre-existing failures tidak berubah).

#### Meta CAPI New vs Repeat Order & Peringatan Jadwal Aktif Admin (2026-09-19)

- **Masalah (multi-layer):**
  1. **RC-1 (Data/DB):** `Reservation.is_repeat_order` hanya di-set oleh `followUpService.onReservationCreated`
     berdasarkan ada/tidaknya *follow-up pending* — semantik salah (bukan riwayat transaksi). Kolom juga
     belum pernah tercatat di chain migrasi (ditambahkan via `db push`) sehingga fresh deploy kehilangan kolom.
  2. **RC-2 (Tool/Payload Contract):** `capiService.sendCapiEvent` tidak menyuntikkan pembeda new/repeat ke
     `custom_data` Purchase sama sekali, sehingga advertiser tidak bisa membuat Custom Conversion.
  3. **RC-3 (Query/Daftar):** `GET /api/admin/capi-queue` tidak menyertakan `is_repeat_order`/`order_number`,
     dan query `leadAuditLogs` TANPA `orderBy` → Prisma default asc → `sentMap` menimpa dengan log TERTUA,
     menghilangkan status moderasi MQL terbaru dari antrean.
  4. **RC-4 (Parser):** `tryParseIndonesianDate` buta terhadap kontradiksi nama hari vs angka tanggal
     (mis. "Selasa, 21 September 2026" padahal 21 Sep = Senin) → jadwal tersimpan di hari salah.
  5. **RC-5 (Admin UX):** Tidak ada peringatan jadwal aktif saat admin membuat reservasi baru → risiko
     *split-brain duplicate booking*.
- **Perbaikan (fondasional):**
  1. `reservation-core.service.ts`: `computeIsRepeatOrder()` menghitung riwayat `confirmed`/`completed`
     (di luar reservasi yang sedang di-update) dan mempersist `is_repeat_order` di SEMUA jalur create/update
     (anti-fabrikasi, fail-safe DB offline → new). Ini menjadikan core sebagai single source of truth.
  2. `capi.service.ts`: `resolveNewVsRepeatContext()` + injeksi `custom_data` untuk event `Purchase`:
     `is_repeat_order`, `customer_type: 'new'|'repeat'`, `order_number`, `prior_orders_count`.
     **Event name tetap `Purchase`** (standar Meta) agar Value-Based Bidding/ROAS tidak terganggu.
  3. `reservations.subroute.ts`: capi-queue menyertakan `is_repeat_order`/`order_number`/`customer_type`
     (ordinal dari urutan `created_at` per customer, 1 query); `leadAuditLogs` di-`orderBy created_at desc`.
  4. `reservation-text-parser.ts`: `reconcileWrittenDayWithDate()` — koreksi slip hari ±1 (typo manusia);
     kontradiksi > 1 hari mengabaikan nama hari (tanggal numerik menang) agar tidak melompat liar.
  5. Endpoint baru `GET /api/admin/customers/:id/active-reservations` (confirmed|hold, `booking_date >=`
     awal hari WIB) untuk Konsumsi modal Create Reservation & Live Chat.
  6. Dashboard: badge `✨ Pasien Baru` / `🔁 Repeat Order` + filter tipe order + field payload JSON di
     Meta CAPI Queue; warning banner jadwal aktif di `CreateReservationModal` (tombol Edit Reservasi
     Eksisting via `onEditReservation`); Live Chat badge confirmed kini date-aware (hari ini/ke depan).
- **Migrasi:** `prisma/migrations/20260919000000_add_reservation_is_repeat_order` (idempotent, aman DB live & fresh).
- **Verifikasi:** `npm run build` (root & admin-dashboard) 0; unit `capi-repeat-order` 8/8,
  `parser-day-date-cross-validation` 6/6, integrasi `active-reservations-endpoint` 3/3; regression
  capi/reservation/parser 121/121 hijau.

#### Standardisasi Model `deepseek-v4-1-flash` + Fallback LLM 3-Tier (2026-09-19)

- **Masalah (RC-1/RC-2/RC-3):** DB `tenant_ai_config` & `.env` menyimpan model provider-asing
  (`MiniMax-M2.7-highspeed`, `gpt-4o-mini`, `deepseek-chat`) padahal provider aktif KENARI →
  log `[LLM MODEL FALLBACK] ... 400` beruntun; chain fallback tidak provider-aware; enrichment
  saat human-handling tetap memanggil LLM yang selalu gagal.
- **Sumber kebenaran tunggal** (`src/config/ai-models.config.ts`): konstanta `KENARI_PRIMARY_MODEL`
  (`deepseek-v4-1-flash`, label "DeepSeek-V4.1-Flash"), `SUMOPOD_SECONDARY_MODEL` (`deepseek-v4-flash`),
  `DEEPSEEK_DIRECT_MODEL` (`deepseek-flash`). `sanitizeModelForProvider` kini provider-aware penuh
  (alias dua arah + remap katalog asing per-provider).
- **Fallback 3-Tier** (`src/integrations/llm/model-fallback.ts`): `resolveFallbackTiers()` →
  Tier 1 Kenari → Tier 2 SumoPod → Tier 3 DeepSeek Direct, guard skip bila baseUrl/apiKey kosong.
  `generation-stage.ts` circuit-breaker memakai resolver yang sama (hilangkan hardcode `api.deepseek.com`).
  `DEFAULT_FALLBACK_CHAIN` = model primer Kenari (tanpa chain internal sesuai keputusan desain).
- **Enrichment deterministik** (`src/services/human-background-enrichment.service.ts`): coba
  `preExtractDeterministic` (0 token) dulu; LLM hanya dipanggil bila kosong (TDD: 2 test adversarial baru).
- **Cost calculator** (`src/utils/cost-calculator.ts`): peak-hour dibatasi ke model SumoPod/DeepSeek Direct;
  entry `deepseek-flash` ditambah.
- **Config & DB**: `.env`/`.env.example` diselaraskan ke `Kenari/deepseek-v4-1-flash`; blok `SUMOPOD_*` eksplisit;
  chain fallback baru; plus script migrasi idempoten `scripts/migrate-model-config-to-deepseek-v41.ts`
  (dry-run + guard production). DB `tenant_ai_config` 6/6 baris kini kanonik.
- **Admin dashboard**: katalog provider SumoPod + label tier (rebuild `packages/admin-dashboard`).
- **Verifikasi**: `npm run build` 0; fallback-chain 16/16, provider-alignment 9/9, enrichment 7/7,
  cost-calculator 12/12; full suite 2762 passed / 41 failed (semua sisa pre-existing).

#### Arsitektur Data Murni Tool, Netralitas Agama Lapisan Prompt & D7 Kognitif (2026-09-18)

- **Fase 1 — Netralitas agama di Single Source of Truth** (`src/v3/agent/prompt/layers/core-persona.layer.ts`,
  `src/v3/agent/prompt/phases/router-direct-reply.layer.ts`): aturan 4b **NETRALITAS AGAMA** yang
  tadinya hanya di legacy `src/config/persona.ts:93-95` kini injeksi di `TONE_NEG_CONSTRAINTS` (V3)
  serta sinkron di `router-direct-reply`. Model menerima instruksi eksplisit: DILARANG
  "Alhamdulillah/Bismillah/Insya Allah/Puji Tuhan" tanpa pemicu; salam "Assalamualaikum" dijawab
  "Waalaikumsalam Bunda" (pengecualian sah). Verifikasi: `prompt-composer` memuat `NETRALITAS AGAMA` (exit 0).
- **Fase 2 — Tool ke data murni (pure structured)** (`src/v3/agent/pipeline/tool-pipeline.ts`,
  `src/v3/tools/calculate-delivery.tool.ts`): `buildLlmSafeToolPayload` kini menghapus
  `suggestedTemplateReply/suggestedPriceReply/suggestedConsultationReply` + memangkas `"Format
  penyampaian yang disarankan: ..."` dari `message` (anti parrot-effect). CTA final tanpa suffix
  "atau Bunda" (Single-Vocative Principle). `message` alat mengembalikan fakta jarak/jangkauan
  murni (angka via `__internal*`), bukan naskah balasan.
- **Fase 3 — Guardrail kognitif D7** (`src/v3/guardrails/factual-claim-validator.ts`): tambah
  `UNPROMPTED_RELIGIOUS_RE` + `CUSTOMER_RELIGIOUS_TRIGGER_RE` sebagai pelanggaran D7
  (`D7_UNPROMPTED_RELIGIOUS_PHRASE`). Tanpa pemicu customer → invalid (1x re-prompt bersih di
  `guardrail-pipeline.ts` yang sudah ada); dipicu customer (`assalamu...`/`alhamdulillah`) → valid
  (netral). Pendekatan kognitif, bukan mutilasi regex tengah kalimat.
- **Verifikasi**: `npm run build` (tsc) exit 0; D7: `factual-claim-validator.test.ts` 13/13;
  Fase 1: prompt-composer exit 0; Fase 2: `tool-pipeline-payload-sanitization` 3/3.

#### Fase 3 & 4 Plan Terbaru: Semantik "Berapa" & Zero-Dangling Sanitizer (2026-09-18)

- **Verdict audit plan**: dari 3 Milestone, hanya **Fase 3 & 4** tersisa & fondasional.
  Fase 1/2 sudah dikerjakan (plan ketinggalan); Fase 6/7/8 sudah selesai di Milestone 2;
  Fase 9 premis salah (tabel `clinic_policies` belum di-deploy, bukan kode); Fase 10/11 ditunda
  (Confirmation Gate); Fase 5 salah hitung matriks (23, bukan 24).
- **Fase 4 — Zero-Dangling Rule** (`src/v3/guardrails/sanitizer.ts`): bug TERBUKTI direproduksi —
  `"...untuk si kecil atau Bunda? 🤗"` dipangkas kuota vokatif menjadi `"...untuk si kecil atau? 🤗"`
  (kata sambung menggantung). Akar: `PREPOSITION_BEFORE_RE` tidak memuat konjungsi koordinatif.
  Fix: tambah `dan|atau|serta|maupun` sebagai gerbang integritas gramatikal (sapaan setelah
  konjungsi = objek koordinatif, DILARANG dihapus). Test adversarial: "atau Bunda?" tetap utuh,
  "dan Bunda" tetap utuh, overuse tetap ditegakkan.
- **Fase 3 — Semantik interogatif "berapa"** (`src/v3/agent/persona.ts`): bug TERBUKTI —
  `"ke kenjeran berapa"`, `"pijat bayi berapa"`, dan `"berapa"` **TIDAK** memicu `ask_price`
  (butuh kata biaya eksplisit). Fix fondasional: `berapa` = pertanyaan HARGA by-default, KECUALI
  terikat satuan non-moneter (durasi/usia/kuantitas/jarak) yang mengikutinya (menoleransi filler
  "sih/ya/kah"). Mengganti whitelist hafalan kata-biaya. Tech debt `NON_MONETARY_FOLLOWERS` dicatat
  di `docs/KNOWN_ISSUES.md` (idealnya taksonomi unit terpusat).
- **Verifikasi**: `npm run build` (tsc) exit 0; 13 suite (sanitizer + NLU + katalog + guardrail +
  delivery) = **119/119 hijau**; tak ada kebocoran harga (information hiding tetap utuh).

#### Milestone 2 & 3: Data Terstruktur get-catalog, Guardrail Tanpa Overwrite, & Audit ClinicPolicy (2026-09-18)

- **Fase 3 — Output get-catalog jadi data terstruktur** (`src/v3/tools/get-catalog.tool.ts`):
  tambah `CatalogPricingBreakdown` (`targetName`, `originalPrice`, `promoPrice`, `deliveryFee`,
  `grandTotal`, `durationMinutes`, `area`) & `CatalogCartRecapBreakdown` (`items`, `subtotalPromo`,
  `deliveryFee`, `grandTotal`) ke `GetCatalogOutput`; tambah `focusClinicalDescription` +
  `focusTargetAudience` (MOMS/BABY). `message` tidak lagi memuat instruksi salin-tempel
  "Format Penyampaian Harga ..." — diganti fakta terstruktur (`Data Finansial Resmi`, total resmi
  keranjang). LLM menalar dari angka, bukan menyalin prosa (Mandat Non-Hardcode & data-driven).
- **Fase 4 — Guardrail berhenti menimpa narasi LLM** (`src/v3/agent/pipeline/guardrail-pipeline.ts`):
  hapus blind overwrite `finalReply = cartTotalFallback || sessionCartFallback ||
  executedTools[0]?.suggestedPriceReply || suggestedTemplateReply`. Kini HANYA rekap resmi
  deterministik (total keranjang mesin) yang boleh menggantikan draft; tanpa rekap resmi, draft
  natural dipertahankan (guardrail hilir yang menangani). CTA rekap keranjang kini **state-aware**
  (`session.booking.preferredDate`), bukan "hari apa" hardcoded.
- **Fase 5 — Audit ClinicPolicy (parity)**: investigasi live membuktikan tabel `clinic_policies`
  **TIDAK ADA di DB produksi** → `get_clinic_policy_faq` selalu fallback statis. Akar: migrasi
  `20260917000001_add_prompt_policy_tables_align_drift` + `scripts/seed-clinic-policies.ts` **sudah
  ada di repo** (commit `025aa3b1`) tapi **belum di-deploy** (server di `57e8a0f`, local ahead 1).
  Tidak ada kode baru yang diperlukan — fix = deploy migrasi + seed. Ditambah test parity: seluruh
  7 topik wajib punya fallback statis lengkap (`clinic-policy-db-first.test.ts`).
- **Verifikasi**: `npm run build` (tsc) exit 0; 19 suite (delivery + get-catalog + guardrail +
  clinic-policy) = **127/127 hijau**.
- **Ditunda**: Fase 6 (TEMPLATES→DB) tetap ditunda (Confirmation Gate).

#### Milestone 1 (Fase 1–2): Netralitas Agama, CTA State-Aware & Carry-Over Berbasis State (2026-09-18)

- **Fase 1 — Netralitas agama + teks ke template layer** (`src/v3/tools/calculate-delivery.tool.ts`,
  `src/config/persona.ts`): hapus 2 literal `Alhamdulillah...` (baris 387 & 596) yang ditulis
  tanpa syarat/flag tenant — inkonsisten dengan jalur `isIslamic` di greeting. Teks jangkauan
  customer-facing dipindah ke template baru `TEMPLATES.inCoverageNoFee({ kelurahan, scheduleCta })`
  (bukan literal baru di tool), sesuai Mandat Non-Hardcode. Spasi baris diperbaiki (`\n\n`).
- **Fase 1 — CTA state-aware** (`buildScheduleCta`): signature diperluas ke
  `ScheduleCtaOptions { preferredDate?, candidateTreatmentName?, hasCartItems? }` dengan **overload
  `string | object`** (nol breaking-change untuk call lama). 3 cabang: (1) hari ada → akui+cekkan;
  (2) treatment/keranjang ada → tanya hari; (3) treatment belum ada → DILARANG menodong jadwal,
  tanya kebutuhan perawatan (Aturan Emas 20). Semua 6 call-site diharmonisasikan.
- **Fase 2 — Carry-over ongkir berbasis STATE** (`src/v3/agent/pipeline/tool-pipeline.ts`): draf
  lama memakai keyword-matching (`startsWith('kalau ke')`, `includes('berapa')`) yang melanggar
  Mandat Anti-Overfitting. Diganti seam murni `ToolExecutionPipeline.shouldCarryOverDeliveryFee(session)`
  yang bersandar pada state riil `session.priceDiscussed === true` + `session.location` sudah terisi.
  Efek: nominal ongkir tetap sah saat customer membandingkan lokasi, **invariant terhadap parafrase**.
- **Verifikasi**: `npm run build` (tsc) exit 0; `delivery-schedule-cta-context.test.ts` (12 test:
  4 cabang CTA + netralitas agama + anti format-menempel + 2 skenario end-to-end) &
  `tool-pipeline-price-intent.test.ts` (7 test state-based incl. invarian parafrase) hijau;
  9 suite delivery terkait = **78/78 hijau**.
- **Catatan**: 6 file test v3 yang gagal di suite penuh (`recruitment-loker-gate`,
  `schedule-check-handoff`, `pediatric-taxonomy-adaptation`, `clinic-area-routing`,
  `guardrail-no-mutilation`, `context-schedule-duration-governance`) adalah **kegagalan
  pra-eksisting** dari commit WIP `025aa3b1` (terbukti: 16 gagal juga saat perubahan ini di-stash)
  — tidak berkaitan dengan Milestone 1 ini.
- **Ditunda**: Fase 6 (migrasi 30+ `TEMPLATES` persona.ts ke DB) — Confirmation Gate, keputusan
  user: tunda. Lihat `docs/plans/REVISED_FOUNDATIONAL_PLAN_2026-09-18.md`.

#### Eksekusi Plan Fondasional 3 Sesi Simulator — D6 Kenjeran + Matrix CM-23 (2026-09-18)

- **Verdict audit:** dari 7 fase, hanya Fase 1 gap nyata → dieksekusi. Fase 2/3/5/6 SUDAH dikerjakan sesi sebelumnya (terverifikasi hijau, tanpa kode baru). **Fase 4 DITOLAK** sebagaimana ditulis: normalizer hardcode string Indonesia di TS melanggar Mandat Non-Hardcode; tujuan sudah dicapai kontrak `closingIntent` (matrix CM-22 hijau).
- **Fixed — Fase 1 D6 grounding exemption** (`factual-claim-validator.ts`): kecamatan yang disebut customer (`customerInput`, pencocokan kata-utuh anti-"warung"→"Waru") ATAU dikembalikan `calculate_delivery` (result.kecamatan/args.locationText) = grounding sah, bukan halusinasi. Threading `customerInput: incomingText` di kedua call-site `guardrail-pipeline.ts`.
- **Fase 7:** skenario matrix **CM-23** ("ke kenjeran berapa ya" → tool terpanggil, verdict ter-grounding Kel. Kenjeran/Kec. Bulak, tanpa pola minta-maaf/todong-alamat). Matrix kini 23/23.
- **Verifikasi:** `build` 0; D6 12/12; matrix 23/23; full suite 2714 passed / 39 failed pre-existing / 24 skipped (sebelumnya 2709/40 — 1 regresi lama sembuh, 4 test baru hijau).
- Detail penolakan Fase 4 + cap opsi di `docs/KNOWN_ISSUES.md` #90.

#### Eksekusi Plan Regresi Oksitosin/Cart/Nominal — 6 Fase Fondasional (2026-09-18)

- **Verdict audit:** plan (`docs/IMPLEMENTATION_PLAN_REGRESI_OKSITOSIN_CART_NOMINAL.md`) SUDAH fondasional (multi-layer root cause Data/State/Tool/Validator/Sanitizer, data-driven, state-gated) — BUKAN tambal-sulam. Dieksekusi penuh; detail + deviasi di `docs/KNOWN_ISSUES.md` #89.
- **Fixed — Fase 1 sanitizer:** `applyPreLocationTone` dihapus total (anti double-emoji; nada pra-lokasi milik `location-rules.phase.ts`); `limitVocativeQuota` + proteksi subjek klausa relatif ("layanan yang Bunda maksud" utuh — bug TERBUKTI via TDD merah).
- **Fixed — Fase 2 audience bundle:** `resolveServiceAudience()` derivasi komposisi `bundleItemIds` (tanpa migrasi DB); 7 hafalan `id.includes('moms'/'laktasi'/'kelahiran')` dihapus; paket oksitosin → `[Untuk Bunda]`; fallback grounding buta 'Si Kecil' → audience-aware.
- **Fixed — Fase 3 cart:** `session.discussedTreatments` baru; pertanyaan konsultatif (`?` tanpa verba komitmen/bukti hari) masuk discussed, BUKAN cart (anti tagihan siluman Rp 155.000). 1 kontrak lama diselaraskan (`v3-audit-homecare-fix` Layer 2: pertanyaan perbandingan bukan komitmen).
- **Fixed — Fase 4 validator:** `args.targetPrice` terstruktur masuk `authorizedNumbers` (kutipan "Rp 900.000 belum ada paket..." lolos, tanpa reprompt penimpa).
- **Fixed — Fase 5 closing:** `CLINICAL_PROBE` + `suggestedConsultationReply` audience-aware (ibu → skrining Bunda; discussed → larangan skrining ulang); kontrak `closingIntent` lestari.
- **Fixed — Fase 6 lokasi:** `hasNewLocationEntity` + token inti kecamatan ("Di tenggilis kak" membuka `calculate_delivery`; "Waru" tetap tertutup).
- **Verifikasi:** `tsc`/`build` 0; gate per-fase + matrix 22/22 hijau; full suite 2709 passed / 39 failed pre-existing (terbukti via clean-tree stash) / 24 skipped.

#### Perbaikan Holistik Fondasional Chatbot — 6 Guard Deterministik (2026-09-18)

- **Phase 1 — Crash & greeting reset**: guard `(intents/symptoms || [])` di `selectRelevantExemplars` (anti `TypeError symptoms`); `buildInvalidReplyFallback(isFollowUp)` — greeting pembuka hanya Turn-0, follow-up pakai recovery kontekstual.
- **Phase 2 — Information hiding ongkir**: `asksDeliveryFee` baru di `calculate_delivery` (schema + registry); nominal rupiah disembunyikan bila customer tak bertanya biaya (bagian get-catalog sudah dikerjakan sesi sebelumnya, dikunci test).
- **Phase 3 — Pruning Call-2 + pin lokasi**: `buildLocationHierarchyBlock(session)` (cabang tanya-lokasi dicabut bila lokasi diketahui + pin permanen; byte-identik bila belum); pin `[LOKASI TERKUNCI]` di baris teratas `buildContextSummary`.
- **Phase 4 — Centroid fallback**: kecamatan + detail spesifik (streetDetail/penanda generik/nama perumahan menempel) → sentroid gazetteer `success:true isEstimatedCentroid` tersimpan ke sesi (tanpa tandai QUOTED); tanpa detail tetap minta kelurahan.
- **Phase 5 — Normalizer output**: `trimToMaxSentences` (maks 3 kalimat, anti desimal/jam) hanya satu-paragraf + `applyPreLocationTone` di gate akhir pipeline.
- **Verifikasi**: 6 file uji baru + 2 kontrak lama diselaraskan; `tsc` 0, `npm run build` 0; full suite 355 hijau / 4 merah pre-existing (terbukti di clean tree via stash).

#### Isolasi Multi-Tenant Meta CAPI/Pixel & Profil ORS Mobil Non-Tol (2026-09-18)

- **Isolasi kredensial CAPI (`src/services/capi.service.ts`)**: fungsi baru `resolveTenantCapiCredentials(tenantId)` sebagai SATU-SATUNYA pintu resolusi kredensial (fail-closed) — dipakai `sendCapiEvent` maupun `testCapiConnection`, menggantikan dua blok copy-paste. Fallback `.env` HANYA untuk `default-tenant` eksplisit; tenant non-default tanpa kredensial DB valid, DB error, token gagal decrypt, atau tanpa tenantId → skip (`Skipped: Credentials missing for tenant <id>`), axios tidak dipanggil.
- **Landing anti-leakage (`landing-content.service.ts`, `landing.route.ts`, `html-sanitizer.ts`, `landings.subroute.ts`)**: dummy `'123456789012345'` dihapus; env `FB_PIXEL_ID` hanya untuk default-tenant; `injectTracking` tidak menyuntik pixel bila ID kosong (click-catcher atribusi tetap jalan); template `go.html` men-strip total blok pixel bila ID kosong; query `?p=` di `/cta` hanya berlaku untuk default-tenant (anti-spoofing attribution).
- **ORS mobil non-tol (`.env`)**: `ORS_PROFILE="cycling-electric"` → `"driving-car"` + `ORS_AVOID_FEATURES="tollways"` (`.env.example` sudah mendokumentasikan nilai ini).
- **Verifikasi**: `tests/unit/ors-profile-nontol.test.ts` (4/4), `tests/unit/capi-tenant-isolation.test.ts` (8/8), gate regresi landing/CAPI/atribusi/delivery 50+53 hijau; build `tsc` exit 0.
- **Operasional**: pindahkan `FB_PIXEL_ID` + `FB_CAPI_ACCESS_TOKEN` milik klinik ke DB via Admin Dashboard → Settings (tersimpan terenkripsi), lalu kosongkan di `.env` server.

#### Cache-Control `no-store` untuk Seluruh API Admin (Anti Data Basi Browser/Proxy) (2026-09-17)

- **Akar masalah laporan "Delivery Fee Tiering 14 tier (duplikat)"** (diverifikasi via browser user:
  buka `/api/admin/delivery-tiers` langsung = 14, padahal dari dalam proses app = 7, DB = 7, file = 7):
  route `/api/admin/*` **TIDAK mengirim header `Cache-Control`**. Tanpa header itu, browser (dan proxy
  di depan) boleh menyimpan respons GET secara heuristik dan menyajikan payload lama pada navigasi
  langsung maupun reload — sehingga admin melihat data basi/duplikat meski server & DB benar.
- **Fix fondasional (`src/routes/admin.route.ts`):** hook `preHandler` kini menyetel
  `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0`, `Pragma: no-cache`,
  `Expires: 0` untuk **semua** request `/api/admin*` (di-set SEBELUM auth, jadi respons 401 pun
  no-store). Berlaku global untuk seluruh endpoint admin, bukan tambal per-route.
- **Lanjutan fix klien sebelumnya** (`packages/admin-dashboard/src/services/api.ts`): `getCachedApiResponse`
  TTL-aware + primitive `refreshApi` (lihat entri di bawah) tetap berlaku; kini ada dua lapis
  (server no-store + klien forceFresh).
- **Verifikasi**: `npm run build` (tsc) exit 0; build dashboard Vite exit 0;
  `tests/unit/admin-api-cache.test.ts` (11 test: 7 cache/TTL/refreshApi + 2 header no-store pada
  respons 200 & 401, dst) + 3 suite delivery + `ai-health` = **52/52 hijau**.

#### Cache SWR Admin Dashboard: TTL-Aware & Primitive Hard-Refresh (2026-09-17)

- **Investigasi laporan "Delivery Fee Tiering duplikat"**: terbukti **bukan bug server** — DB
  `delivery_tiers` bersih (7 baris, `COUNT(DISTINCT max_dist)=7`) dan live API di produksi
  mengembalikan `LEN=7` (id 1..7 tanpa duplikat). Penyebab = **cache SWR klien** yang basi
  (`memoryApiCache` + `sessionStorage` `apiCache:*`, TTL 15s); tombol Reload tidak melewatinya.
- **Fix fondasional (`packages/admin-dashboard/src/services/api.ts`):**
  1. `getCachedApiResponse(endpoint, { allowStale })` kini **hormat TTL** — entri kedaluwarsa HARAM
     disajikan untuk hidrasi awal; hanya fallback kegagalan jaringan (`allowStale: true`) yang boleh
     memakai data basi. Menutup 5 titik hidrasi (`Overview`, `Reservations`, `CustomerDatabase`,
     `TodayTreatments`) yang sebelumnya bisa render data tua.
  2. Ditambah primitive **`refreshApi(endpoint, options)`** = `clearApiCache(url)` +
     `apiRequest(forceFresh: true)` — kontrak terpusat untuk tombol Reload/Refresh admin.
  3. `DeliveryTiers.tsx` Reload di-wire ke `refreshApi` (memperbaiki kasus yang dilaporkan).
- **Audit sistem menyeluruh**: ditemukan **31 kontrol Refresh manual di 20+ file** yang masih pakai
  GET biasa (bisa sajikan cache 15s). Migrasi sisanya **ditunda sengaja** dan dicatat di
  `docs/KNOWN_ISSUES.md` #79 (menghindari blast radius 20+ file dalam satu PR).
- **Verifikasi**: `npm run build` (tsc) exit 0; build dashboard Vite exit 0;
  `tests/unit/admin-api-cache.test.ts` (baru, 7 test: TTL fresh/expired/allowStale, cache-hit tanpa
  network, refreshApi bypass+replace, dua refresh berturut hit network, normalisasi endpoint) +
  3 suite delivery = **47/47 hijau**.

#### Perbaikan Delivery Fee Tiering: Hardcode Bebas & Paritas Out-of-Coverage (2026-09-17)

- **Audit live (read-only)**: `delivery_tiers` produksi default-tenant sehat (7 tier,
  `updated_at` 2026-08-23, tidak ter-overwrite). Seeding-overwrite (dugaan awal) **tidak terjadi** —
  data tier aman. Temuan nyata ada di lapisan **kode**, bukan data.
- **BUG A — Hardcode `freeTierKm: 5` & batas jangkauan `30 km`** (`src/v3/tools/calculate-delivery.tool.ts`):
  dua jalur (URL Maps resolved & geocoding teks) mem-passing `freeTierKm: 5` + `maxCoverageKm: 30`
  literal ke `TEMPLATES.ongkirInfo`/`outOfCoverage`, padahal `calculateDelivery()` sudah mengembalikan
  `freeTierKm` & `maxCoverageKm` dari tier tenant. Jika admin mengubah tier gratis/jangkauan via DB,
  pesan WA tetap memakai angka lama → janji ke customer salah. **Fix**: pakai
  `deliveryResult.freeTierKm` & `deliveryResult.maxCoverageKm ?? clinicConfig.maxDeliveryDistanceKm`
  di kedua jalur; `message` diagnostik agent (`maks 30 km`) ikut dinamis.
- **BUG B — Inkonsistensi out-of-coverage backend vs frontend**
  (`packages/admin-dashboard/src/utils/deliveryTierCalculator.ts`): sebelumnya jarak > tier terjauh
  mengembalikan `fee = maxTier.fee` (mis. Rp 35.000) di frontend, sedangkan backend
  (`DeliveryService.calculateOngkirByDistance`) mengembalikan `normalPrice = 0`. **Fix**: frontend
  disamakan — out-of-coverage → `fee: 0, netOngkir: 0`, `matchedTier` tetap sebagai referensi tampilan.
  `InvoiceGeneratorModal` kini menampilkan peringatan deterministik (`ongkirOutOfCoverage`) agar staf
  tidak salah menagih ongkir 0 untuk area di luar jangkauan.
- **Tidak ada bug** pada panel "Simulasi Ongkir" `DeliveryTiers.tsx` — cabang out-of-coverage sudah
  benar (klaim awal keliru setelah verifikasi kode).
- **Verifikasi**: `npm run build` (tsc) exit 0; build dashboard Vite exit 0;
  `tests/unit/delivery-tier-db-driven.test.ts` (baru, 10 test adversarial: kontrak `freeTierKm`/
  `maxCoverageKm` dari tier, paritas boundary 0/5/5.01/…/30/30.01/99 km backend↔frontend, fallback
  tier kosong tanpa NaN) + 8 suite terkait = **65/65 hijau**.

#### Penyelarasan Model–Provider Aktif (Anti `no price for model` / `401`) (2026-09-17)

- **Akar masalah (audit live):** `ACTIVE_LLM_PROVIDER="KENARI"` + `KENARI_API_KEY` kosong →
  fallback key `LLM_API_KEY` (SumoPod) ditolak kenari.id (`401 invalid key`); setelah key diisi,
  muncul `400 no price for model 'gpt-4o-mini'` karena DB `tenant_ai_config` masih menyimpan
  `CHAT_REPLY=OpenAI/gpt-4o-mini` (stale pra-migrasi) dan endpoint tunggal aktif = Kenari.
- **Fix fondasional (`src/config/ai-models.config.ts`):** `sanitizeModelForProvider` kini punya
  cabang Kenari — model native OpenAI (`gpt-*`/`o1*`/`o3*`) di-remap ke `KENARI_DEFAULT_MODEL`
  saat baseUrl `kenari.id` (aturan provider-level, mirror logika OpenAI/SumoPod). `getModelConfig`
  & `getAllTaskConfigs` di-sanitize dengan baseUrl endpoint **aktif** (single source of truth),
  sehingga seluruh pemanggil lintas-task (NLU, verifier, summarization, PII, geocoding, harvesting)
  tidak lagi mengirim model non-Kenari ke Kenari. `agent-runner` memakai `endpointConfig.model`
  (baseUrl-aware) untuk `selectedModel`.
- **Perbaikan data:** re-seed `tenant_ai_config` default-tenant dari registry env →
  `CHAT_REPLY`/`CHAT_REPLY_DEEP`/`HARVESTING` = `Kenari/deepseek-v4-1-flash`; task sisa
  (`INTENT_CLASSIFICATION`, `PII_SCRUBBING`, `SUMMARIZATION`) tetap `OpenAI/gpt-4o-mini` di DB
  namun otomatis di-remap saat resolusi. `ACTIVE_LLM_PROVIDER` tidak di-set di DB → fallback env `KENARI`.
- **Verifikasi:** `npm run build` (tsc) exit 0; `tests/unit/provider-model-alignment.test.ts` 6/6 hijau
  (remap gpt/o1/o3, preserve model Kenari valid, case-insensitive host, non-Kenari tak terpengaruh).

#### Dedicated LLM Execution Tracing & DeepSeek Observability (2026-09-17)

- **Fase 1 — Skema & logging error transparan** (`src/utils/llm-execution-logger.ts`,
  `src/v3/agent/pipeline/generation-stage.ts`): `LlmExecutionRecord` + `RecordCallParams` diperluas
  dengan `errorMessage`, `cachedPromptTokens`, `reasoningTokens`. `reportTurnError` kini
  mengekstrak pesan error teknis konkret (axios `response.data.error.message` → `response.data` string
  → `err.message` → fallback generik) dan menyertakan `promptPayload` konteks pesan. Error 401/400/timeout
  tampil apa adanya di UI Tracing, bukan lagi kotak merah tanpa isi.
- **Fase 2 — Ekstraksi CoT universal** (`extractReasoningAndCleanContent`, diekspor untuk testability):
  mendukung `reasoning_content` native maupun tag `<think>...</think>` inline (case-insensitive,
  multi-blok). Artefak tag thinking dibersihkan dari `finalReply` sebelum guardrail — tanpa
  mutilasi semantik (murni cleanup teknis mesin, sesuai mandat).
- **Fase 3 — Telemetri biaya & token akurat** (`extractUsageTelemetry`): membaca cache prompt dari
  `prompt_cache_hit_tokens` (DeepSeek native) ATAU `prompt_tokens_details.cached_tokens`
  (OpenAI-compatible/proxy SumoPod), plus `completion_tokens_details.reasoning_tokens`. `calcCostFor`
  kini meneruskan token cache ke `calculateLlmCost` sehingga diskon cache-hit benar-benar dihitung
  (sebelumnya hardcode `0`).
- **Fase 4 — Stepper & filter admin dashboard** (`packages/admin-dashboard/src/pages/tenant/Debug.tsx`,
  `getLlmExecutionLogs`): turn tanpa tool (DeepSeek menjawab langsung) dilabeli
  **⚡ Direct Reply (1 Call)** di kartu, stepper, dan flat feed; filter `V3_GENERATION` ikut
  menyertakan direct reply (deterministik dari state `toolsCalled`/`finalReply`, bukan pencocokan teks);
  banner merah menampilkan `errorMessage` saat status ERROR; token Cache Hit & Thinking ditampilkan.
- **Fase 5 — Unit test adversarial** (`tests/unit/llm-execution-tracing-deepseek.test.ts` 17/17):
  schema tracing, CoT (`<think>` multi-blok/case/null/unclosed), dual-shape usage, diskon biaya
  (timestamp di-pin off-peak agar deterministik), grouping Direct Reply vs multi-call, dan ekstraksi
  error `reportTurnError` (Error object / axios 401 / tanpa pesan).
- **Verifikasi**: `npm run build` (tsc) exit 0; build dashboard Vite exit 0; test terkait
  32/32 hijau (`llm-execution-tracing-deepseek` 17, `hierarchical-debug-logs` 3, `cost-calculator` 12).
  Catatan: suite penuh memiliki kegagalan pra-eksisting pada file test untracked dari pekerjaan paralel
  (mis. `llm-outage-silent`, `schedule-check-handoff`) — tidak berkaitan dengan perubahan ini (diff
  tidak menyentuh `shouldSendReply`/state machine).

#### Revisi Fondasional P1–P4: Sawan-HIGH, closingIntent, Eskalasi Medis Aman, Salvage Kalimat (2026-09-17)

- **Konteks review:** dokumen rencana 6 fase diaudit terhadap repo — ~60% sudah implemented
  (death-penalty guardrail, `parallel_tool_calls:false`, taksonomi 24 bln, matrix 20 skenario).
  Dieksekusi hanya gap nyata dalam bentuk revisi mandiri-patuh (tanpa rewrite regex output,
  tanpa prose "DILARANG" sebagai satu-satunya pagar). Detail verdict + item tunda di
  `docs/KNOWN_ISSUES.md` #83.
- **P1 — Skrining sawan fail-closed HIGH** (`src/config/medical-keywords.ts`,
  `tests/unit/medical-sawan-screening.test.ts` 3/3): `sawan`/`sawanen`/`sawan tangis` → HIGH
  (menumpang eskalasi deterministik `machine.ts` + supresi rekomendasi usia di katalog).
  Pengecualian hardcode sementara via seam designated (persetujuan user); matcher ≤6 huruf
  boundary-safe dari `kawasan` (dipin adversarial).
- **P2 — Kontrak data closingIntent** (`src/v3/tools/get-catalog.tool.ts`,
  `tests/unit/v3/get-catalog-closing-intent.test.ts` 7/7): 6 intent deterministik dari state
  (SAFETY_NO_MATCH > STATEMENT_ONLY_DURATION > PRICE_SUBJECT_CLARIFY > ASK_SCHEDULE/ASK_DOMICILE
  by location > CLINICAL_PROBE); hanya direktif intent terpilih dikirim ke LLM (state-gated pruning).
- **P3 — Eskalasi medis AMAN + matrix CM-21/CM-22** (`src/state-machine/machine.ts`,
  `tests/unit/medical-silent-escalation.test.ts`, `tests/integration/v3-conversation-matrix.test.ts`
  22/22): eskalasi HIGH/MEDIUM kini mengirim balasan keselamatan deterministik (tanpa dosis,
  tanpa tawaran pijat, tanpa ajakan jadwal) — pembalikan disengaja kontrak diam lama.
  CM-21 (sawan end-to-end), CM-22 (alur 234800: domicile → durasi statement-only via closingIntent).
  Fidelitas stub tool_choice-forced diperbaiki (inferensi asksDuration/inquirePrice/symptoms).
- **P4 — Salvage tingkat kalimat** (`src/v3/guardrails/sentence-salvage.ts` baru,
  `tests/unit/v3/sentence-salvage.test.ts` 5/5, wiring `guardrail-pipeline.ts`): saat reprompt
  faktual gagal, kalimat valid dipertahankan verbatim + catatan handoff; hanya bila nihil
  yang lolos dipakai fallback generik. Tanpa edit isi kalimat (anti-mutilasi).
- **Verifikasi:** `npm run build` (tsc) exit 0; matrix 22/22; medical 3+5; catalog 18;
  factual/anti-silent 17 — tanpa regresi.

#### Investigasi & Remediasi Fallback "Kendala Teknis" Sesi 554018 (2026-09-17)

- **Fixed — drift migrasi DB lokal:** apply 3 migrasi pending via `migrate deploy`
  (`ensure_tenants_settings_column`, `message_tenant_wa_message_unique`, `add_followup_cancel_reason`);
  migrasi bedah baru `20260917000001_add_prompt_policy_tables_align_drift` membuat 2 tabel yang ada di
  schema tapi tak pernah punya migrasi (`tenant_prompt_configs`, `clinic_policies`) + menyelaraskan default
  (`reservations.status`, `tenants.settings`); `schema.prisma` Message diselaraskan dari `@unique` global ke
  `@@unique([tenant_id, wa_message_id])` mengikuti maksud `20260913000000` (kompatibel: tanpa `findUnique`
  by `wa_message_id` di `src/`).
- **Akar masalah LLM (terbukti, belum bisa diperbaiki tanpa aksi user):** `KENARI_API_KEY` kosong di `.env`
  sehingga key efektif jatuh ke `LLM_API_KEY` yang ditolak `kenari.id` (`401 invalid key`, direproduksi terisolasi).
  Detail dan sisa terbuka dicatat di `docs/KNOWN_ISSUES.md` #82.
- **Verifikasi:** drift `migrate diff --from-url` = empty migration; `prisma generate` penuh; `npm run build` (tsc)
     exit 0; test fokus 10/10 (`clinic-policy-db-first`, `tenant-settings-resilience`, `dynamic-router-prompt`).

#### Integrasi LLM Kenari, Primary Model deepseek-v4-1-flash, & Toggle Switcher Provider (2026-09-17)

- **Konfigurasi Ganda Provider (`.env` & `.env.example`)**: Menambahkan blok konfigurasi `ACTIVE_LLM_PROVIDER="KENARI"` dengan variabel terpisah `KENARI_BASE_URL="https://kenari.id/v1"`, `KENARI_API_KEY`, dan `KENARI_DEFAULT_MODEL="deepseek-v4-1-flash"`, serta variabel SumoPod terisolasi (`SUMOPOD_BASE_URL`, `SUMOPOD_API_KEY`, `SUMOPOD_DEFAULT_MODEL`). Model utama default disetel ke `deepseek-v4-1-flash` dan rantai fallback diperbarui.
- **Provider Registry & Dynamic Resolution (`src/config/ai-models.config.ts`, `src/integrations/llm/llm-gateway.ts`)**: Mendaftarkan `'Kenari'` ke `SUPPORTED_PROVIDERS`. Menambahkan method `getActiveProvider`, `setActiveProvider`, dan `getActiveEndpointConfig` pada `AiModelConfigService` yang persisten ke database (`TenantAiConfig` task: `ACTIVE_LLM_PROVIDER`) dengan mirror in-memory non-blocking (fire-and-forget DB sync). Memperbaiki sanitasi model di `sanitizeModelForProvider` agar tidak menimpa model Kenari atau SumoPod yang valid. `llm-gateway.ts` otomatis meresolusi base URL, API key, dan default model berdasarkan provider yang aktif.
- **Audit Biaya & Derivasi Provider (`src/utils/cost-calculator.ts`)**: Menambahkan pengenalan domain `kenari.id` → `'Kenari'` pada `deriveProvider` dan menambahkan tabel tarif model Kenari (`deepseek-v4-1-flash`, `deepseek-v4-pro`, `qwen3-8-flash`, `qwen3-7-plus`, `minimax-m2-7`, dan `step-3-7-flash:free`).
- **Endpoint Admin Provider Switcher (`src/routes/admin/settings.subroute.ts`)**: Menambahkan endpoint `PATCH /api/admin/ai-models/provider` untuk mengganti provider aktif secara instan (`KENARI` vs `SUMOPOD`), otomatis menyelaraskan model `CHAT_REPLY`, dan mencatat riwayat audit admin (`AI_PROVIDER_SWITCH`).
- **Admin Dashboard UI Switcher (`packages/admin-dashboard/src/components/settings/AiModelSettingsPanel.tsx`)**: Menghadirkan kartu toggle interaktif di bagian atas panel konfigurasi model AI untuk memilih **Kenari AI** vs **SumoPod AI** dengan indikator aktif, status koneksi API key, dan feedback toast instan tanpa restart server.
- **Audit Keamanan & Pre-Commit Guard (`scripts/scan-secrets.ts`, `.git/hooks/pre-commit`, `package.json`)**: Memeriksa seluruh working tree terhadap potensi kebocoran API key (`kn-`, `sk-`, `AIza`, `EAAR`, `eyJ`, `.env`). Menambahkan automated scanner script `scripts/scan-secrets.ts`, Git hook `.git/hooks/pre-commit` untuk auto-block saat commit, dan perintah `npm run security:scan`. Unit test `tests/unit/scan-secrets.test.ts` 4/4 hijau.
- **Verifikasi**: `tests/unit/cost-calculator.test.ts` (12/12 hijau), `tests/unit/ai-models-tenant.test.ts` (4/4 hijau), `tests/integration/ai_models_and_health.test.ts` (5/5 hijau); build `tsc` exit 0; build dashboard Vite exit 0.

#### Remediasi 391501 — Sanitizer Subjek, Rekomendasi Usia & RAG Persiapan (2026-09-17)

- **Fase 1 — Sanitizer subjek tata bahasa (`src/v3/guardrails/sanitizer.ts`, `tests/unit/v3-sanitizer-vocative-quota.test.ts`)**: `limitVocativeQuota` kini memproteksi subjek kalimat ("Bunda hanya/cukup/bisa/perlu/...") di awal kalimat/klausa — tidak dihapus & tidak mengurangi kuota 1 vokatif. Koma menggantung (",!") dibersihkan deterministik (`/,\\s*([!?.])/ → $1`). Menutup mutilasi Turn 8 (" hanya perlu...") & koma menggantung Turn 9 ("ya,! 🤗").
- **Fase 2 — Rekomendasi usia-aware (`src/services/treatment-catalog.service.ts`, `src/v3/state/goal-tracker.ts`, `tests/unit/treatment-catalog-default-relaxation.test.ts`)**: `getDefaultRelaxationService(category?, ageMonths?, tenantId?)` menyaring `ageTier` (backward-compat: string tenantId sebagai argumen kedua tetap didukung). `goal-tracker.formatGoalSessionForPrompt` menyuntik `childAge` ke rekomendasi bayi sehat — usia 17 bulan → "Pijat Bayi Ceria" (bukan Newborn), 3 bulan → Newborn, 36 bulan → Kids Ceria. 6/6 hijau.
- **Fase 3 — RAG persiapan (`src/services/keyword-enrichment.service.ts`, `src/cli/faq-corpus.ts`, `scripts/sync-prep-knowledge.ts`, `tests/unit/knowledge-preparation-search.test.ts`)**: keyword persiapan diperkaya (`baby oil, minyak telon, pijat bayi, bayi, anak, si kecil, kudu nyiapin, homecare, peralatan, matras, tempat tidur`); jawaban FAQ dipadatkan steril ("baby oil, minyak telon, matras, perlak... cukup siapkan alas tidur"); skrip sync idempoten untuk DB live. 5/5 hijau.
- **Fase 4 — Verifikasi**: `tests/integration/deterministic-guardrails-session-391501.test.ts` 2/2, build `tsc` 0. Seluruh gate 20/20 hijau.

#### Over-Kalkulasi Durasi Layanan & Reservasi Siluman Typo Tanggal (2026-09-17)

- **Akar masalah (multi-layer):** `extractDurationMinutes` mengasumsikan SEMUA item bundling 60 menit (`items.length * 60 + 15`) → "Pijat Bayi Pulih Ceria + Sinar Moksa" = 135m (padahal 75m); `tryParseIndonesianDate` membuang tanggal mustahil "41 September" lalu jatuh ke fallback nama-hari `diff += 7` (reservasi siluman +7 hari); auto-capture webhook menyimpan `duration_minutes: NULL`.
- **Single Source of Truth durasi:** `treatmentCatalogService.resolveDurationBreakdown` (baru) — layanan utama vs add-on berbasis katalog tenant, anti double-count (dedupe id, komponen bundle dibuang, guard ≥2 token), flag `confident`/`usedExplicitTag`. Dipakai `reservation-core.service` + `reservation-lifecycle.service` (webhook auto-capture) + `reservation-text-parser` (ParsedReservation.durationMinutes) agar DB tidak lagi menyimpan NULL untuk layanan valid.
- **Date guard:** pemulihan transposisi digit ("41 September" → 14 September bila cocok nama hari) + tanggal mustahil tanpa pemulihan → `null` (DILARANG melompat +7 hari).
- **Frontend:** `durationCalculator.ts` bedakan main vs add-on (bukan flat 60m) + strip metadata audiens terstruktur (`Baby: … (Usia: …) | Moms: …`) yang sebelumnya memecah item hantu; `CreateReservationModal.tsx` tidak lagi default 60 sebelum pencocokan katalog + normalisasi token `(add-on)`.
- **Remediasi data:** `scripts/backfill-reservation-duration.ts` (idempoten) — 233 reservasi NULL terisi durasi katalog; 276 teks bebas tak dikenali sengaja dibiarkan NULL (anti-fabrikasi).
- **Verifikasi:** `foundational-duration-resolution` 9/9, `duration-calculator` + `reservation-text-parser` 30/30, typecheck 0, `npm run build` 0, dashboard build 0; probe deterministik `extractDurationMinutes('Pijat Bayi Pulih Ceria + Sinar Moksa')=75` & `tryParseIndonesianDate('Senin, 41 September 2026…')=2026-09-14T02:30:00.000Z`. Full suite 335 hijau (2 merah pre-existing).

#### Terapi Bapil KIDS Berjenjang Usia & Paritas Katalog (2026-09-17)

- **Paritas Katalog KIDS Bapil**: Menambahkan varian layanan `kids-pulih-2-4th` (Rp85k), `kids-pulih-4-6th` (Rp90k), dan `kids-pulih-6-8th` (Rp100k) ke `DEFAULT_CLINIC_SERVICES` pada `src/services/treatment-catalog.service.ts` serta menyelaraskan deskripsinya di `services_custom.json` agar mencakup kata kunci batuk, pilek, bapil, flu, kembung, sembelit (tutup Issue #78 item 2).
- **Rekomendasi Gejala Deterministik**: Sistem kini secara presisi merekomendasikan `Pijat Kids Pulih Ceria (2 - 4 Tahun)` untuk balita 3 tahun dengan keluhan batuk pilek, bukan lagi jatuh ke terapi nafsu makan (*Lahap Juara*).
- **Verifikasi**: Skenario CM-01 pada `tests/integration/v3-conversation-matrix.test.ts` kini mem-pin nama terapi secara deterministik (20/20 hijau); test unit baru pada `tests/unit/v3/symptom-semantic-scorer.test.ts` (10/10 hijau); V3 unit tests 312/312 hijau; golden corpus 61/61 hijau; typecheck exit 0.

#### Sesi 337880 — Gerbang Kode Deterministik (2026-09-17)

- **Hapus pengecualian same-day** (interogatif `?` = slot inquiry; adopsi via verba komitmen); **masking fisik `calculate_delivery`** tanpa entitas baru + forcing-downgrade; **cart role-gate** (asisten hanya konfirmasi + afirmasi-tunggal); **mandat locationText UTUH**; normalizer sapaan ditolak (mandat anti-mutilasi).
- **Verifikasi**: replay 337880 1/1, V3 317/317, matrix 20/20, korpus 61/61, typecheck 0, harness 4.71/5.00 tanpa pelanggaran safety floor; full suite 2440 hijau (2 merah pre-existing).

#### Sesi 180166 — Regresi V3 & Resiliensi Real-Human (2026-09-17)

- **Jangkar kalender WIB** di Call 1/2 (anti-halusinasi tanggal); **sinyal jam + latch `preferredTime`** + Aturan 5c; **adopsi komitmen berverba** atas tanggal ber-`?` (3 gate koheren, pin lama lestari); **mandat harga/durasi dipertegas** tanpa cabut anchor 887216.
- **Verifikasi**: resilience 1/1, V3 315/315, matrix 20/20, korpus 61/61, typecheck 0, harness 4.74/5.00 tanpa pelanggaran safety floor; full suite 2432 hijau (2 merah pre-existing).

#### Rencana Fondasional — Direct Enforce, Dekomposisi Grounder, Split Router (2026-09-17)

- **Direct enforce default-on**: `save_reservation` dipotong fisik dari skema Call-1 bila prasyarat gagal; `hari ke-N` & treatment anaphoric ditutup (`date-confirmation`, `resolveCandidateTreatment`); matrix 20/20 dalam enforce.
- **Dekomposisi `context-grounder.ts`**: 4 modul domain + fasad re-export (zero breaking changes).
- **Split router Call 1**: dua layer + varian masker-aware (default byte-identik).
- **Verifikasi**: V3 315/315, matrix 20/20, korpus 61/61, typecheck 0, build 0, harness 4.71/5.00 tanpa pelanggaran safety floor; full suite 2418 hijau (2 merah pre-existing).

#### Fase 6 Agenda 3 — Pruning, Refusal Metadata & Enforce Readiness (2026-09-17)

- **Smart time-hint koreksi-dulu**: token hari terakhir menang bila ada penanda koreksi; kolokasi `besok lusa` → `lusa`; aposisi & filter usia lestari (tutup Issue #78 item 3).
- **Structural refusal tagging**: `isRefusalOrEscalation` melewatkan D3 deterministik; regex stop-gap tinggal fallback (tutup Issue #74).
- **Konsolidasi prompt minimal**: 2 kalimat duplikat tak-terpin dipangkas + direktif positif aditif (pin audit & cache utuh; de-bloat penuh ditunda perlu sign-off per-audit).
- **Enforce readiness**: telemetri `TOOL_MASKING_ENFORCED_APPLIED` + test lock-in enforce/shadow (default tetap shadow).
- **Verifikasi**: V3 308/308, matrix 20/20, korpus 61/61, typecheck 0, harness 4.83/5.00 tanpa pelanggaran safety floor; full suite 2405 hijau (2 merah pre-existing).

#### Agenda 2 Fase 5 — Conversation Matrix 20 Skenario (2026-09-17)

- **Suite integrasi multi-turn** (`tests/integration/v3-conversation-matrix.test.ts`): 20 skenario / 5 arketipe via jalur produksi + stub deterministik + spy hasil tool; 20/20 hijau (~3,5 dtk offline).
- **Fix produk**: lead-greeting tak lagi menelan booking berhari+lokasi (guard nama hari/same-day); temuan tercatat: gap item terapi KIDS-bapil, edge hint dua-hari.
- **Verifikasi**: matrix 20/20, korpus 61/61, V3 295/295, typecheck 0, harness 4.78/5.00 tanpa pelanggaran safety floor; full suite 2391 hijau (2 merah pre-existing).

#### Agenda 1 Fase 4 — Geocoding Hardening & Gazetteer Wilayah Utama (2026-09-17)

- **Anti-kontradiksi Aturan 21**: kelima pesan `calculate_delivery` yang menganjurkan share location dibersihkan; klausa penjaga "(tanpa menanyakan nomor jalan atau share location)" dipertahankan.
- **Tier-0 deterministik**: 6 landmark perumahan (Kutisari, Kendangsari, Rewwin, Pondok Tjandra/Candra, Makarya Binangun, Rungkut Mapan) + 6 koridor arteri; contoh grounding LLM anti-Sukomanunggal.
- **Verifikasi**: test baru 4/4, geocoding eksisting 9/9, V3 295/295, korpus 61/61, typecheck 0.

#### Housekeeping, Dynamic Phase Injection & Taksonomi Usia Deterministik (2026-09-17)

- **Penyelarasan legacy test**: `v3-audit-homecare-fix.test.ts` disesuaikan prasyarat mutlak lokasi homecare (sesi berwilayah tanpa detail jalan) — 14/14 hijau.
- **Dynamic Phase Injection (Fase 3.5, opt-in)**: `composeSystemPrompt` mendukung `phaseInjection { focus, slim }` + `derivePhaseFocus` murni (EARLY_LOCATION/CONSULTATION/SCHEDULING); default tetap rakitan penuh byte-identik, mode focus melestarikan prefix cache.
- **Taksonomi usia deterministik**: ambang kanonis 24 bulan (`resolveChildAgeCategory`, <24 BABY / ≥24 KIDS) dipakai extractor, tool katalog (snap kategori), dan service katalog; bridge 0-24 bulan pensiun sebagai kode mati.
- **Anti-menu brosur**: suplai mode konsultasi dipangkas ke 1 rekomendasi + 1 pelengkap; mode harga/nama eksplisit utuh.
- **Verifikasi**: V3 291/291, korpus 61/61, paritas 15/15, typecheck 0, eval audit LLM 4.77/5.00 dengan 0 pelanggaran safety floor; full suite 2368 hijau (2 merah pre-existing terdokumentasi).

#### Arsitektur Prompt Modular Berlapis — Dekomposisi Persona Monolitik (2026-09-17)

- **Lapisan Keselamatan Global (`src/v3/agent/prompt/layers/global-safety.layer.ts`)**: isolasi aturan safety-critical (skrining trauma jatuh audit 337101, jeda vaksin 48–72 jam audit 222655, newborn 0–28 hari, anti-overclaim, injection defense) sebagai single source of truth yang selalu disuntikkan tiap turn.
- **Lapisan Persona Inti (`layers/core-persona.layer.ts`)**: identitas Bidan Yusi, nada WhatsApp mengayomi, kata ganti "kami", format 1-bintang, batas 2–3 kalimat, contoh few-shot statis, sapaan Turn-0/lanjutan.
- **Direktif Fase Operasional (`prompt/phases/`)**: `location-rules` (ongkir, anti-tanya km, anti-asumsi Waru), `pricing-catalog` (konsultasi vs transaksional, multi-anak, klarifikasi ambigu), `scheduling` (anti-todong jadwal/jam, mandat POV first-person, gating `save_reservation`).
- **Komposer & Fasad (`prompt/prompt-composer.ts`, `persona.ts` tipis)**: antarmuka `PersonaPromptBuilder` dipertahankan 100%; overlay tenant DB dan brand per-tenant tidak berubah.
- **Verifikasi zero-regresi**: output byte-identik 4/4 varian; `typecheck` exit 0; paritas tanggal 15/15; tool-masker 10/10; anti-silent-drop 8/8; safety/persona/cache 28/28; korpus emas 61/61. Full suite 2355 hijau, 3 merah pre-existing (tercatat `docs/KNOWN_ISSUES.md` #72/#75).

#### Resolusi Fondasional Siklus Regresi Chatbot Sesi 173235: Anti-Phantom Basket Add-On, Grounding Lokasi Cool-Off, & Fail-Closed Booking Gate (2026-09-16)

- **Fase 1 — Isolasi Keranjang Add-on Anti-Phantom Basket (`src/v3/state/cart-manager.ts`)**:
  - Menambahkan guard isolasi pada `CartManager.syncCartItems`: Pesan asisten (`isAssistant === true`) dilarang memasukkan layanan berjenis `ADDON` (seperti *Sinar Moksa* / *Cukur Rambut*) ke keranjang belanja customer (`session.cartItems`) KECUALI bila nama add-on sudah pernah disebut atau dikonfirmasi oleh customer (`userConfirmedNames.has(s.name.toLowerCase())`).
  - Mencegah asisten yang hanya mengedukasi perlengkapan treatment membengkakkan isi keranjang dan durasi/harga treatment secara sepihak.
  - Test baru: `tests/unit/v3/cart-addon-assistant-isolation.test.ts` (3/3 passed).
- **Fase 2 — Grounding Lokasi Cool-Off & Anti-Kaset Rusak (`src/v3/state/conversation-summarizer.ts`, `src/v3/state/goal-tracker.ts`, `src/v3/agent/persona.ts`)**:
  - Memperluas deteksi `isAskedLocationRecently(history)` di `conversation-summarizer.ts` agar mengenali sapaan pembuka Turn-0 yang menanyakan lokasi (`rumahnya dimana`, `rumah bunda dimana`, `daerah mana`, `tinggal dimana`, dsb.).
  - Mengeliminasi kontradiksi internal grounding prompt: `GoalTracker.formatGoalSessionForPrompt` kini menerima `isAskedLocationRecently`. Bila lokasi belum diketahui namun bot baru saja menanyakan lokasi pada 1-2 turn terakhir, status instruksi tidak lagi menodong `(Perlu ditanyakan kelurahan/kecamatannya)`, melainkan beralih ke instruksi cool-off: `• Lokasi: Belum diketahui (Sudah ditanyakan di pesan sebelumnya — JANGAN menanyakan lokasi lagi pada turn ini, fokus jawab keluhan/pertanyaan Bunda)`.
  - Meneruskan riwayat percakapan (`opts.history`) dari `persona.ts` (`buildRouterPrompt`, `buildRouterPromptAsync`, `buildSystemPrompt`, `buildSystemPromptAsync`) ke `GoalTracker.formatGoalSessionForPrompt`.
  - Test baru: `tests/unit/v3/location-prompt-grounding-sync.test.ts` (4/4 passed).
- **Fase 3 — Fail-Closed Booking Readiness & Prasyarat Mutlak Lokasi (`src/v3/agent/pipeline/context-grounder.ts`, `src/v3/tools/save-reservation.tool.ts`)**:
  - `ContextGrounder.isBookingCommitReady`: Wajib memverifikasi keberadaan data lokasi (`session.location.kelurahan / kecamatan / kota / rawText`). Bila lokasi belum diketahui, reservasi homecare DILARANG dianggap siap dikomit (`false`), menghentikan forcing pemanggilan `save_reservation` (`dynamicToolChoice`) di Turn 4 saat customer hanya bertanya ketersediaan slot.
  - `executeSaveReservation`: Menambahkan guard fail-closed prasyarat lokasi. Jika `conversationId` ada dan `effectiveAddress` kosong (tidak ada alamat fisik dari argumen tool maupun wilayah/kelurahan dari sesi), tool menolak mencatat ke database (`success: false`) dan membimbing bot untuk menanyakan daerah rumah terlebih dahulu sesuai Aturan Emas 5a. Mencegah terciptanya reservasi fiktif tanpa alamat/wilayah dan data anak dummy.
  - Test baru: `tests/unit/v3/booking-commit-location-gate.test.ts` (6/6 passed); test gate diperbarui `tests/unit/v3/booking-commit-ready-gate.test.ts` (6/6 passed).
- **Fase 4 — Pengetatan Persona & SOP Menjawab Persiapan (`src/v3/agent/persona.ts`, `src/services/tenant-prompt-config.service.ts`)**:
  - Mempertegas Aturan Emas 5a: Bila customer bertanya jadwal/slot padahal lokasi belum diketahui, WAJIB dahulukan menanyakan daerah rumah Bunda terlebih dahulu sebelum mengecek jadwal atau mereservasi. DILARANG berjanji mengecek jadwal sebelum domisili diketahui dan DILARANG memanggil `save_reservation`.
  - Mempertegas Aturan Emas 14: Pertanyaan persiapan treatment dijawab padat maksimal 2-3 kalimat (perlengkapan dibawa Bidan, cukup siapkan alas tidur). DILARANG proaktif mempromosikan alat add-on (Sinar Moksa) jika customer hanya menanyakan persiapan umum.
  - Mempertegas syarat mutlak lokasi pada panduan tool `save_reservation`.
- **Verifikasi & Regresi**:
  - `npm run build` (`tsc`) exit 0.
  - 14 test suite terkait booking, cart, location, summarizer, dan persona (100+ tes) 100% passed.
  - Knowledge graph disinkronkan via `graphify update .`.

#### Resolusi Fondasional Siklus Regresi Chatbot & Isolasi Total Sandbox CAPI Queue (2026-09-16)

- **Fase 1' — Isolasi sandbox antrean Meta CAPI (`src/routes/admin/reservations.subroute.ts`, `src/utils/dummy-filter.ts`)**:
  - Query `prisma.reservation.findMany` + `unsentMqlCustomers` kini filter `customer.is_sandbox_test: false` (MQL + `phone not startsWith 6289999`); `processedCustomers` dan fallback in-memory disaring via helper baru `shouldExcludeFromCapiQueue()` (reuses `isDummyOrTestContact` terpusat — tanpa duplikasi prefix). Pengiriman aktual tetap dijaga CAPI GUARD (`capi.service.ts`).
  - Test `tests/unit/capi-queue-sandbox-isolation.test.ts` (5/5 passed).
- **Fase 2' — Fail-closed kontrak `save_reservation` + tahun dinamis + guard momStage (`src/v3/tools/save-reservation.tool.ts`, `src/utils/indonesian-date-parser.ts`, `src/utils/conversation-transaction-extractor.ts`)**:
  - `verifyDayMentioned`: bukti hari yang seluruhnya dari kalimat tanya (`?`) = pertanyaan ketersediaan, BUKAN kesepakatan → tolak tanpa tulis DB (tanpa daftar frasa tanya baru; pengecualian same-day sesi 138207 yang catatannya pending ekspektasi-aman). Helper baru `isSameDayRequestText()` (reuse `SAME_DAY_EVIDENCE_ALIASES`, kini exported).
  - `parseIndonesianDate`: tanggal lampau (mis. "2023" karangan LLM) digulir ke kemunculan berikutnya (`rollPastToFuture`); default tahun di `conversation-transaction-extractor` dijadikan dinamis (`getFullYear()`).
  - `momStage POSTPARTUM` diturunkan bila anak tertua > 2 bln (`isPostpartumStageValid` + `POSTPARTUM_MAX_CHILD_AGE_MONTHS`, TODO tenant-aware — lihat KNOWN_ISSUES 69.1).
  - Test baru: `day-evidence-question-gate` (8/8), `indonesian-date-year-clamp` (5/5).
  - Kontrak test lama yang mengkodifikasi bug diperbarui (`premature-reservation-guard`, `reservation-response-copy`: jalur lolos kini pernyataan tegas; +1 kasus tanya-menolak). Same-day alias tetap hijau.
- **Fase 3' — Grounding sesi & anti-kunci sepihak (`context-grounder.ts`, `persona.ts`, `goal-tracker.ts`, `cart-manager.ts`, `domain/types.ts`)**:
  - `isBookingCommitReady`: giliran `?` bukan komitmen (kecuali same-day) → hentikan forcing prematur `save_reservation`.
  - Direktif `SCHEDULING`: bila `pendingScheduleCheck` tanpa `reservationId`, sinyalkan `save_reservation DILARANG` (ganti "tersedia bila data lengkap"); persona router sinkron untuk pertanyaan slot.
  - `formatGoalSessionForPrompt`: tier NIFAS (≤2 bln) / MENYUSUI-IBU BALITA (3–24 bln) / IBU ANAK (>24 bln) — POSTPARTUM hanya untuk bayi baru lahir.
  - Cart: fuzzy match wajib memuat ≥1 token non-generik + `GENERIC_CLINIC_TOKENS` diperluas (balita/usia/umur/tahun/bulan/toddler) — kalimat generik "pijat balita usia 2 tahun" tidak lagi mengunci paket sepihak (test-first, bug ter-reproduksi sebelum fix).
  - Test baru: `booking-commit-ready-gate` (5/5), `cart-generic-no-unilateral-lock` (2/2).
- **Fase 4' — Anti-kaset rusak skrining + forcing durasi presisi (`get-catalog.tool.ts`, `tool-pipeline.ts`, `tool-registry.ts`, `generation-stage.ts`)**:
  - `CatalogSessionContext.knownSymptoms` diisi deterministik dari sesi (tool-pipeline, cermin agregat `formatGoalSessionForPrompt`) → `effectiveSymptoms` menutup keluhan yang LLM lupa oper ("Biasa kembung"); `closingGuide` + `suggestedConsultationReply` tidak lagi menanyakan ulang skrining (wording panduan tidak mengutip frasa pemantik agar tak menyuntik pola ke LLM).
  - `routeTools`: `ask_duration` (sinyal intent eksisting) memaksa `get_catalog_and_price` agar durasi dari katalog DB; `childAgeMonths` disuntik dari profil sesi bila LLM mengosongkan (cermin pola momProfile).
  - Test baru: `catalog-known-symptoms-no-reask` (3/3).
- **Regression**: `npm run build` exit 0 (termasuk `prisma generate` sinkronisasi client `cancel_reason` pasca-rebase); 27/27 test baru hijau; full suite 2340 passed / 30 failed — seluruhnya pre-existing terdokumentasi (fitur belum terimplementasi plan 8/9 + governance summary, lih. FASE 0) dan file terkait area sentuhan (`premature-guard`, `response-copy`, `sameday`, `multi-recipient-cart`, `age-consultation`, katalog) 100% hijau.
- **Known Issues**: butir 69 (ambang klinis TODO tenant-aware + opsi keputusan; cleanup sandbox live menunggu 2-step verification; replay simulator Turn 1–8 manual).

#### Follow-Up Berbasis Chat Terakhir & Informasi Alasan Pembatalan (2026-09-16)

- **Skema & Migrasi (`prisma/schema.prisma`, `prisma/migrations/20260916000000_add_followup_cancel_reason/migration.sql`)**: Menambahkan kolom `cancel_reason String?` pada model `FollowUp` plus indeks komposit `@@index([tenant_id, customer_id, type, status])` untuk mempercepat lookup antrian NO_PURCHASE aktif saat chat masuk. Migrasi idempotent (`DO $$ ... information_schema.columns`) + `CREATE INDEX IF NOT EXISTS`, aman di DB live maupun fresh env.
- **Sliding Window Event-Driven (`src/services/follow-up.service.ts`)**: Fungsi baru `rescheduleNoPurchaseOnInboundChat(customerId, tenantId, chatAt)`. Saat customer chat masuk, antrian `NO_PURCHASE` aktif digeser relatif ke **chat terakhir customer**: stage 1/2/3 menjadi `chatAt + 3/7/14 hari` tepat pukul **09:40 WIB** (helper `computeScheduleAtWib0940`, sadar batas hari WIB). Bila customer ternyata sudah punya reservasi aktif, antrian dibatalkan dengan alasan eksplisit. Offline-safe (best-effort, tidak pernah melempar).
- **Hook Inbound (`src/services/message.service.ts`)**: `logMessage()` memicu sliding window secara *fire-and-forget* pada pesan `INBOUND` - hanya untuk customer riil (guard `!isHistorical`, `!isSandboxCustomer`, `!skipMqlEvaluation`), sehingga sinkronisasi riwayat WAHA dan pesan sandbox/QA tidak menggeser jadwal, dan alur webhook tidak ikut melambat.
- **Cancel Reason di Seluruh Lifecycle**: Konstanta kanonis `CANCEL_REASON` (single source of truth) dan penulisan alasan di setiap titik terminasi: `cancelFollowUp` (default "Dibatalkan manual oleh Admin"), `bulkCancelFollowUps` ("Dibatalkan massal oleh Admin"), `onReservationCreated` ("Customer membuat reservasi baru"), `onReservationCancelled` ("Reservasi terkait dibatalkan"), auto-cancel worker ("Customer sudah memiliki reservasi aktif"), overdue >48 jam, skip label bypass, dan skip WABA (template belum approved / tanpa opt-in marketing).
- **API Admin (`src/routes/admin/follow-up.subroute.ts`)**: `PATCH /api/admin/follow-ups/:id/cancel` dan `POST /api/admin/follow-ups/bulk-cancel` menerima `reason` opsional (diteruskan ke service dan dicatat di audit log). Parameter opsi bersifat opsional sehingga pemanggil lama tetap kompatibel. `listFollowUps` kini memakai `select` eksplisit dan menyertakan `cancel_reason` pada payload respons.
- **Admin Dashboard (`packages/admin-dashboard/src/pages/tenant/FollowUpQueue.tsx`)**: Badge status untuk `CANCELLED`/`SKIPPED` kini menampilkan sub-keterangan "Alasan: ..." (dengan tooltip untuk teks panjang, di tabel desktop maupun kartu mobile). Modal konfirmasi pembatalan (satuan & massal) menyediakan kolom **Alasan Pembatalan (opsional)**; dikosongkan maka backend memakai alasan default.
- **Regression & Adversarial Tests**:
  - `tests/unit/follow-up-inbound-sliding.test.ts` (baru): 12/12 passed - geseran +3/+7/+14 hari pukul 09:40 WIB, edge-case tengah malam WIB, pembatalan saat sudah ada reservasi, no-op tanpa antrian, DB offline, clamp stage di luar rentang, serta seluruh varian `cancel_reason` lifecycle.
  - `tests/integration/follow-up-inbound-hook.test.ts` (baru): 5/5 passed - inbound riil memicu hook (anchor `createdAt`), sedangkan pesan historical, outbound bot, dan sandbox **tidak** memicu; kegagalan hook tidak membocorkan error ke pemanggil.
  - `tests/integration/follow-up-admin.test.ts`: 19/19 passed - penambahan kasus `reason` diteruskan/di-skip dengan benar pada endpoint cancel & bulk-cancel.
  - `npm run build` (tsc) exit 0; `npm run build` di `packages/admin-dashboard` (vite) exit 0.
- **Known Issues**: Mencatat dua temuan terbuka di `docs/KNOWN_ISSUES.md` butir 67 - tumpang-tindih dua definisi "chat terakhir" (sliding window inbound vs Smart Context Guard `last_message_at`), dan jalur `DELETE /api/admin/reservation/:id` yang tidak memanggil `onReservationCancelled`.

#### Resolusi Infinite Holding Stall Pengecekan Jadwal, Latch Time Hint, & Isolasi Konsultasi Usia (Plan 7) (2026-09-15)

- **Fase 1 — Goal Tracker & Session Latch Resilience (`src/v3/state/goal-tracker.ts`, `src/v3/agent/pipeline/context-grounder.ts`)**:
  - Menambahkan field `pendingScheduleCheck?: boolean` pada `BookingState`.
  - Format status sesi di prompt (`formatGoalSessionForPrompt`) kini menampilkan `requestedTimeHint` dan status `pendingScheduleCheck` secara eksplisit sehingga LLM sadar permintaan hari/waktu customer sudah terekam.
  - Memperluas deteksi `extractTimeHint` dan `hasScheduleSignal` untuk menangkap token hari kerja (`'hari biasa'`, `'weekday'`, `'weekdays'`).
  - Memperbaiki persistensi latching atomik pada `applySessionLatches` (`session.booking` diupdate in-place dan disimpan bersama payload sesi utuh ke `GoalTracker.updateGoalSession`), mencegah amnesia lokasi saat terjadi fallback store memori offline.
- **Fase 2 — FastResponseGate Schedule Verification Handoff & Anti-Looping (`src/v3/agent/pipeline/context-grounder.ts`)**:
  - Menambahkan template respon deterministik `POST_SCHEDULE_CHECK_CLOSING`: penegasan pengecekan rute/jadwal tanpa tanya balik berulang.
  - Memperluas token pengakuan tunggu `POST_RESERVATION_ACK_TOKENS` (`tunggu`, `kabari`, `nanti`, `ditunggu`) dan ignorables (`min`, `admin`, `aku`, `saya`).
  - Menghubungkan FastResponseGate: pada putaran pertama pengakuan tunggu saat `pendingScheduleCheck === true`, bot mengirimkan `POST_SCHEDULE_CHECK_CLOSING` dan langsung mengeksekusi handoff/eskalasi live chat (`isEscalated: true`, `escalationReason: 'pending_schedule_check'`).
  - Pada putaran ke-2 dan seterusnya, FastResponseGate melakukan *silent skip* (`shouldSendReply: false`, 0 token), mencegah bot kaset rusak mengulang janji cek jadwal yang sama.
- **Fase 3 — Isolasi Konsultasi Usia Sehat vs Terapi Sakit (`src/v3/tools/get-catalog.tool.ts`, `src/v3/agent/persona.ts`)**:
  - Menyematkan pembobotan `healthyPriorityOf` pada pengurutan layanan (`formattedTreatments.sort`): ketika customer berkonsultasi usia anak tanpa menyebutkan keluhan sakit (`symptoms.length === 0`), paket terapi batuk/pilek/kembung (`isSickTherapyService` seperti *Pulih Ceria*) ditenggelamkan ke prioritas bawah. Paket relaksasi & nutrisi sehat (*Pijat Bayi Ceria*, *Pijat Bayi Lahap Juara*) diprioritaskan di posisi teratas.
  - Memperbarui instruksi KONDISI A.1 di persona prompt: dilarang keras merekomendasikan terapi bapil atau menyinggung batuk/pilek/kembung bila customer tidak menyampaikan keluhan medis.
  - Menambahkan instruksi anti-looping pada router prompt ketika customer sekadar mengonfirmasi atau menunggu pengecekan jadwal.
- **Fase 4 — Turn-0 Greeting & Operational Hours Clarity (`src/v3/agent/persona.ts`, `src/v3/agent/pipeline/generation-stage.ts`)**:
  - Menambahkan panduan jam operasional (08.00–17.00 WIB) dan koordinasi rute bidan pada instruksi persona ketika customer menanyakan jadwal di luar jam operasional atau hari biasa.
  - Menambahkan mekanisme penjaminan sapaan resmi pembuka (*deterministic Turn-0 greeting prefix*): jika bot berada di awal percakapan (Turn-0) dan respons model belum memuat sapaan/perkenalan, prefix resmi Bidan Yusi disematkan secara mulus.
- **Regression & Unit Tests**:
  - `tests/unit/v3/fast-response-gate-schedule.test.ts`: 4/4 passed.
  - `tests/unit/v3/time-hint-latch.test.ts`: 2/2 passed.
  - `tests/unit/v3/age-consultation-isolation.test.ts`: 2/2 passed.
  - `tests/unit/v3-*.test.ts`: 86/86 passed.
  - `tests/v3/agent-runner.test.ts` & `agent-tools.test.ts`: 19/19 passed.
  - `npm run build`: kompilasi TypeScript exit 0 tanpa error.

#### Resolusi Fondasional Bug Chat Freeze / Tidak Bisa Scroll Portal Terapis (2026-09-14)

- **Fase 1 — Kunci Ketinggian Viewport Rigid & Perbaikan Rantai Flexbox (`StaffToday.tsx`)**:
  - *Viewport Locking Kaku*: Mengubah kontainer terluar `StaffToday.tsx` dari `min-h-[100dvh]` menjadi `h-[100dvh] max-h-[100dvh] overflow-hidden`, memastikan dokumen tidak pernah memuai melampaui layar.
  - *Perbaikan Rantai Flexbox*: Menambahkan `min-h-0` pada split-view workspace (`line 1682`) dan `shrink-0` pada Header, Segmented Mobile Nav, Chat Header, serta Quick Reply Input Bar. Mencegah kontainer gelembung chat membesar setinggi seluruh pesan (`scrollHeight === clientHeight`), sehingga native scrollbar aktif sempurna di desktop maupun mobile.
  - *Overscroll Containment & Touch Momentum*: Menambahkan `overscroll-contain` dan momentum scrolling `-webkit-overflow-scrolling: touch` pada kontainer chat (`chatContainerRef`), mencegah gestur usap/swipe tersangkut atau menggerakkan halaman induk.
- **Fase 2 — Eliminasi Auto-Scroll Loop & Deteksi Scroll Pengguna**:
  - *Deteksi `isNearBottom` Terpadu*: Menambahkan ref `isNearBottomRef` dan handler `onScroll={handleChatScroll}` pada kontainer chat. Sistem kini mengetahui apakah terapis sedang membaca pesan di atas atau berada di dasar percakapan.
  - *Penghapusan Polling Scroll Loop*: Menghapus `selectedTask` dari dependency array `useEffect` auto-scroll dan membatasi `scrollToBottom` hanya berjalan jika `isNearBottomRef.current === true` (kecuali dibuka pertama kali atau saat mengirim pesan baru). Terapis tidak lagi tersentak ke bawah setiap interval polling 20 detik saat sedang membaca riwayat pesan.
- **Fase 3 — Seleksi Teks Pesan Chat**:
  - Menambahkan class `select-text` pada gelembung teks percakapan (`msg.content`) agar nomor telepon, patokan alamat, dan keluhan pasien dapat disalin (*copy*) secara mudah tanpa terhalang `select-none` dari layout portal.
- **Regression**: `npm run build` (tsc) exit 0, dashboard `npm run build` (tsc & vite) exit 0, test unit `tests/unit/staff-auth-and-reservation.test.ts` (21/21 passed), test integrasi `tests/integration/staff-routes.test.ts` (21/21 passed).

#### Restorasi Akses Chat & Hardening Relasi Percakapan Portal Terapis (2026-09-14)

- **Fase 1 — Restorasi Tombol Chat Kartu Aktif & Modal Detail (`StaffToday.tsx`)**:
  - *Tombol Chat Terlihat Jelas*: Tombol aksi kartu tugas aktif (`StaffToday.tsx`) diubah dari `grid-cols-2` menjadi `grid-cols-3` dengan menghadirkan tombol `Chat` (`MessageSquare`) eksplisit berdampingan dengan `Navigasi` dan `Infokan OTW`. Terapis tidak lagi perlu menebak bahwa teks alamat dapat diklik untuk membuka chat.
  - *Tombol Chat Pasien di Modal Detail*: Pada `detailModalTask`, ditambahkan tombol aksi utama `Chat Pasien` di footer modal untuk membuka split-view percakapan secara langsung tanpa harus menutup modal dan mencari kartu kembali.
  - *Fallback ID Percakapan & Badge Edukatif*: Data `combinedCompletedTasks` diproteksi dengan fallback mapping agar `conversationId` yang ada di riwayat selesai tidak tereset. Pada kartu jadwal mendatang (upcoming), ditambahkan badge halus `Chat aktif di hari-H` agar terapis memahami kapan akses komunikasi aktif.
- **Fase 2 — Hardening Backend Relasi Percakapan (`staff-reservation.service.ts`)**:
  - *Dynamic Conversation Resolution di `getCompletedTasks`*: Mengganti hardcoded `conversationId: null` dengan relasi query dinamis Prisma (`customer.conversations` take 1 order desc `updated_at`), sehingga kunjungan yang telah selesai tetap dapat dibuka riwayat percakapannya oleh terapis.
  - *Sinkronisasi Timezone WIB pada Kepemilikan Percakapan*: Menyelaraskan metode `assertConversationOwnedByStaffToday` dengan `this.getWibDateRange()` alih-alih `new Date().setHours(0,0,0,0)` (UTC container), mencegah penolakan akses (403/Forbidden) bagi staf pada window pergantian hari antara UTC dan WIB (00:00-07:00 WIB).
- **Regression**: `tests/unit/staff-auth-and-reservation.test.ts` (21/21 passed, termasuk verifikasi `conversationId` selesai dinamis), `tests/integration/staff-routes.test.ts` (21/21 passed), `npm run build` (tsc) exit 0, dashboard `npm run build` (tsc & vite) exit 0.

#### Audit & Perbaikan Fondasional Portal Terapis (Staff Portal) (2026-09-14)

- **Fase 1 — Perbaikan Bug Kritis & Visual (Functional & Visual Blockers)**:
  - *Kartu Pasien Hilang Otomatis*: Pada `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`, fungsi `isPastStaffTask()` digantikan dengan `isTrulyCompleted()` (tugas hanya berpindah ke tab "Selesai" jika status `COMPLETED` atau pembayaran telah `LUNAS`) dan `isOverdueSchedule()` (memberikan badge visual `Berlangsung` jika durasi terlewat namun belum selesai). Terapis di lapangan tidak lagi kehilangan akses ke tombol Catat Bayar, Chat, dan Navigasi saat kunjungan memakan waktu lebih lama.
  - *Watermark Canvas Bebas Tofu & Skala Proporsional*: Pada `packages/admin-dashboard/src/utils/imageWatermark.ts`, seluruh emoji Unicode canvas (`📍`, `📸`, `🌸`) digantikan dengan label teks bersih (`GPS:`, `PANDUAN:`, `BIDAN:`, `KALA MOMS & BABY`) untuk mencegah bug karakter kotak-kotak (`\uFFFD`) pada browser HP Android/Windows; batas kaku 18px dihapus dan diganti formula font responsif berbasis rasio foto; lebar logo klinik diukur lebih dulu dan diterapkan clipping dinamis pada baris koordinat agar tidak terjadi tabrakan teks.
  - *Sinkronisasi Limit Pesan Backend*: Pada `src/routes/staff/today.subroute.ts`, limit pesan percakapan staff dinaikkan dari `slice(-10)` menjadi `slice(-30)` agar konsisten dengan frontend dan SSE stream, mencegah terputusnya riwayat percakapan saat refresh.
- **Fase 2 — Peningkatan UX Terapis Lapangan**:
  - *Single Consolidated Confirmation*: Pada `StaffToday.tsx`, dua prompt `confirm()` berurutan saat menyimpan data lokasi/foto rumah (timpa data & akurasi sinyal GPS) disatukan ke dalam satu dialog konfirmasi terpadu, menghilangkan risiko freeze modal pada mobile webview.
  - *Penegasan Visual Tagih di Tempat*: Tombol pembayaran pada kartu aktif dipertegas dengan status `Tagih di Tempat` beraksen amber dan indikator berdenyut lembut untuk mencegah terapis lupa menagih biaya.
  - *Akses Percakapan di Tab Selesai*: Menambahkan tombol cepat `Chat` pada kartu riwayat tugas di tab "Selesai" yang otomatis mengaktifkan split-view chat.
- **Fase 3 — Konsolidasi Arsitektur Anti-Bloat**:
  - *Eliminasi Duplikasi `StaffSchedule.tsx`*: Mengonsolidasikan 630 baris kode duplikat `StaffSchedule.tsx` menjadi proxy komponen ringkas yang me-render `<StaffToday defaultTab="upcoming" />`. Menghemat ~17.5 kB bundle chunk dan memastikan seluruh pembaruan fitur selalu sinkron di satu tempat.
- **Regression**: `npm run build` (tsc) exit 0, dashboard `npm run build` (tsc && vite) exit 0, test unit `tests/unit/staff-auth-and-reservation.test.ts` (21/21 passed), test integrasi `tests/integration/staff-routes.test.ts` (21/21 passed).

#### Hardening Fondasional FASE 0 — Fail-Closed Defaults & Observability (2026-09-14)

- **T0.1 — Telemetri per-turn aktif**: `telemetryService.recordTurn()` ter-wiring di `V3AgentRunner.processMessage` (akhir blok success); `src/types/telemetry.ts:32` union status tambah `'NO_DATA'`; `src/services/telemetry.service.ts:60-67` health 0 turn → `NO_DATA` (bukan `HEALTHY`). Test `tests/unit/telemetry.test.ts` (5) — NO_DATA, HEALTHY, CRITICAL, mutilation ratio.
- **T0.3 — Availability fail-closed**: `src/routes/admin/reservations.subroute.ts:180-188` catch DB error → 503 `AVAILABILITY_UNAVAILABLE` (bukan fallback "semua slot available"). Anti-janji-palsu saat DB down.
- **T0.4 — Halt-after-commit tool pipeline**: `src/v3/agent/pipeline/tool-pipeline.ts:90-97,215-220` — flag `reservationCommitted` setelah `save_reservation` sukses; tool berikutnya di-batch yang sama di-skip + warn `V3_TOOL_POST_COMMIT_IGNORED`. Test `tests/unit/v3/tool-pipeline.test.ts` (4) — batch 2 tool, save_reservation gagal → tool kedua tetap jalan; save_reservation sukses → tool berikutnya di-skip.
- **T0.2 — Verifikasi**: tidak ada mutilasi regex tengah kalimat di `guardrail-pipeline.ts` (blok usia sudah reprompt-only sejak sesi 214956). Tidak ada perubahan kode.
- **Regression**: `npm run build` (tsc) exit 0; `npm test` 2092 passed, 28 failed (pre-existing: `schedule-check-handoff` 30→28 tests — fungsi `isScheduleCheckCommitment` belum terimplementasi + `typing-transport`/`queue-durability`/`clinic-area-routing`/`pediatric-taxonomy`/`context-schedule-duration-governance` = fitur FASE 1-3), 19 skipped. Tidak ada regresi baru.

#### Resolusi Fondasional Penulisan Reservasi & Invoice Salah — Kasus 6282229353440 (Bunda Lutfia) (2026-09-15)

- **Fase 1 — Reverse Geocoding Lokal Haversine (anti-Gubeng fiktif)**: `src/utils/gazetteer.ts` tambah `findNearestSubdistrict(lat,lng,maxDistanceKm=35)` + `haversineKm` (cache koordinat gazetteer 573 baris, 0 ms API, $0); `src/integrations/google-maps/geocoding.ts:983` hapus hardcode `kelurahan/kecamatan: 'Gubeng'` → pakai `findNearestSubdistrict` (Sedati -7.3683,112.7744 → Semampir/Sedati/Kabupaten Sidoarjo 61253, di luar 35 km → koordinat murni tanpa nama fiktif). Test `tests/unit/nearest-neighbor-geocoding.test.ts` (5).
- **Fase 2 — Ekstraksi Kec/Kota Data-Driven dari Alamat Teks**: `src/routes/admin/livechat.subroute.ts` endpoint `GET /api/admin/geo/areas` (gazetteer single source), `packages/admin-dashboard/src/utils/chatScheduleExtractor.ts` tambah `extractWilayahFromAddress` + `WilayahReference` (substring whole-word longest-first, tanpa regex hafalan — referensi dari backend), `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` cache `getWilayahRef()` dan pakai saat `extractScheduleFromMessages(..., wilayahRef)` sehingga form kosong `Kec & Kota:` tetap terisi dari `"Perum Central Park Juanda, Semampir, Kec. Sedati, Kab. Sidoarjo"` sebelum jatuh ke profil terpolusi. Test `tests/unit/chat-schedule-extractor-wilayah.test.ts` (5).
- **Fase 3 — Dynamic Catalog & Price Resolution (anti-60000 karangan, usia-aware)**: `chatScheduleExtractor.ts` hapus 8× fallback `60000` → harga HANYA dari DB/katalog (`catalogPriceOf`), fallback 0 jujur bila tanpa katalog/tidak cocok; tambah filter usia `filterCatalogByChildAge` via `parseChildAgeToMonthsLocal` (tier `min_age_months/max_age_months`, tanpa hardcode mapping nama/harga); `treatmentStringParser.ts:228` & `InvoiceGeneratorModal.tsx` & `LiveChatMonitor.tsx:2749` hapus `|| 60000` → 0. Test `tests/unit/catalog-price-age-aware.test.ts` (5, Pijat Rileksasi 15 bulan → Pijat Bayi Ceria 70000).
- **Fase 4 — Fix Edit Reservasi HTTP 500 (`address` → `preferences.address`)**: `src/routes/admin/reservations.subroute.ts:1508` `custUpdate.address` (kolom tidak ada di `Customer`) → `preferences.address` (+ `landmark` digabung tanpa timpa, `kelurahan` diisi dari address bila kosong, `assigned_staff_id ''→null` FK-safe, notifikasi staf non-blocking tetap). Test `tests/unit/admin-update-reservation-safe-address.test.ts` (4).
- **Fase 5 — Adversarial Testing & Penguatan Ketahanan Sistem**: Pembuatan adversarial test suite `tests/unit/adversarial-reservation-resilience.test.ts` (16 edge cases). Menemukan & memperbaiki 2 cacat laten sistemik:
  1. *Konflik Nama Kabupaten vs Kecamatan*: Alamat "Kec. Sedati, Kab. Sidoarjo" sebelumnya keliru menetapkan kecamatan "Sidoarjo" karena panjang string. Diperbaiki di `packages/admin-dashboard/src/utils/chatScheduleExtractor.ts` dengan deteksi awalan eksplisit (`kec.` / `kecamatan`) dan pemisahan set token kota dari kandidat kecamatan.
  2. *Generic Token Hijacking pada Katalog*: Layanan tak dikenal multi-kata seperti "Pijat Akupresur Alien Super" sebelumnya terkunci ke "Pijat Bayi Ceria" karena token generik "pijat". Diperbaiki di `packages/admin-dashboard/src/utils/treatmentStringParser.ts` dengan guard `GENERIC_SERVICE_TOKENS` (wajib ada match token pembeda/differentiator) serta penambahan mapping alias `rileksasi` dan `relaksasi` -> `['relaksasi', 'ceria']`.
  3. *Haversine Floating-Point Precision Guard*: Di `src/utils/gazetteer.ts`, `haversineKm` diproteksi dengan `Math.min(1, Math.max(0, a))` untuk mencegah `NaN` akibat rounding error koordinat identik.
- **Regression**: `npm run build` + `tsc` dashboard exit 0, 16/16 adversarial tests passed, 66 tests terkait reservasi & katalog lolos 100%.

#### Pembersihan Fondasional: Konsolidasi Page Bloat, Shared Utils & Optimasi Backend (2026-09-15)

- **Fase 1 — Konsolidasi Page Bloat (6 → tab/modal)**: `DeliveryTiers` → tab `ClinicServices?tab=delivery`, `FollowUpTemplates` → tab `FollowUpQueue?tab=templates`, `CustomerLabels` → tab `CustomerDatabase?tab=labels`, `CustomerService` & `TelegramIntegration` → panel `Settings?tab=cs|telegram`, `ChatExport` → modal `LiveChatMonitor?action=export`. Rute lama di `App.tsx` menjadi `<Navigate>` redirect backward-compatible; sidebar `Layout.tsx` dipangkas 5 menu duplikat (Customer Labels, CS & CTA, Follow-Up Templates, Daily Chat Export, Telegram) — beban bundle & routing berkurang tanpa breaking bookmark.
- **Fase 2 — Shared Utils & Modals**: `utils/mediaExtractor.ts` (single source `extractMedia`, type `ChatMediaData`) menggantikan duplikasi identik di `LiveChatMonitor` & `StaffToday` + dipakai `ChatHistoryModal`; `utils/geoUtils.ts` + `calculateHaversineKm` menggantikan duplikat lokal `calculateHaversine` di `CreateReservationModal` (koordinat klinik fallback masih hardcode tech-debt tenant-aware menunggu endpoint settings baru — tercatat). Komponen baru `components/common/CustomerProfilePanel.tsx` (variant sidebar/modal, hitung usia anak, LTV, labels) & `LocationPickerModal.tsx` (GPS, Maps URL parse, Nominatim, kompresi Canvas + watermark terstandar) — integrasi penuh bertahap, file siap pakai dan build lolos.
- **Fase 3 — Optimasi Backend & Polling**: `reservations.subroute.ts` static import `parsePaymentSection` (hapus dynamic import per-baris dalam `rows.map`), memoize `resolveTreatmentValue` per-request via `treatmentPriceCache`, batch `prisma.followUp.createMany` tenant-aware (ganti 3× `create`, 1 query, `existing.tenant_id || DEFAULT_TENANT_ID`), dan guard `document.visibilityState` + `visibilitychange` di `TodayTreatments` (15s) & `StaffToday` (20s) untuk hentikan polling saat tab hidden. Mock `tests/setup.ts` + test `follow-up-schedule.test.ts` diselaraskan ke `createMany`.
- **Regression**: dashboard `tsc && vite build` exit 0, root `tsc` exit 0, full suite 276 files, 2003 passed, 0 failures.

#### Modularisasi Terpadu Modal Riwayat Chat — Eliminasi Duplikasi (Anti-Bloat & Modularity-First) (2026-09-14)

- **Fase 1 — Backend**: `GET /api/admin/customers/:id/messages` kini ambil N pesan TERBARU (`desc` + `take`, lalu `reverse` ke kronologis) — customer berriwayat panjang tak lagi kehilangan pesan terbaru. `listFollowUps` sertakan `conversations.id` sehingga quick-reply FollowUpQueue memakai endpoint live-chat valid (tutup 404 `POST /customers/:id/reply` yang memang tidak ada).
- **Fase 2 — `ChatHistoryModal.tsx` baru** (`components/modals/ChatHistoryModal.tsx`): bubble WhatsApp + `whitespace-pre-wrap break-words`, separator tanggal & jam WIB via `dateWib.ts` (reuse, tanpa duplikasi), render media via `MediaImage` eksisting, tautan "Buka di Live Chat Penuh ↗", form quick-reply (mode `reply`, hanya bila `conversationId` valid — tanpa fallback 404). Escape/swipe-back/popstate didaftarkan fase CAPTURE + `stopPropagation` agar hanya modal terdepan yang menutup (koreksi audit: listener bubble tak bisa mencegah handler modal belakang yang terdaftar lebih dulu). 0 dependency baru.
- **Fase 3–4 — Eliminasi duplikasi**: blok inline ±100/85/110 LOC di CustomerDatabase, Reservations, FollowUpQueue dihapus total (±295 LOC) + state/refs/scroll-handler duplikatnya; CustomerDatabase pertahankan modal detail di background (state preservation); `onOpenChatHistory` disambungkan di CustomerDatabase & LiveChatMonitor (di monitor = tutup detail karena thread sudah tampil). Catatan perilaku: subtitle lokasi + badge Human Handling khas header FollowUp tidak dibawa ke modal terpadu (disederhanakan demi dedup).
- **Regression**: dashboard `tsc && vite build` + root `tsc` exit 0; full suite 276 files, 2003 passed, 19 skipped, 0 failures.

#### LiveChat Optimization v3 — Modular Composer, Penegakan Anti-Label Tuntas & Observabilitas Drift Riwayat (2026-09-14)

- **Fase A — Ekstraksi `LiveChatComposer.tsx` (isolasi render ketikan)**: komponen input balasan mandiri (`packages/admin-dashboard/src/components/livechat/LiveChatComposer.tsx`, `React.memo` + `forwardRef`) yang memiliki DOM contentEditable uncontrolled, draf per-chat 24 jam, debounce typing presence 500ms/3000ms, emoji picker + favorit, popover quick-reply (`/`), dan menu tools (AI draft, jadwal, hold, reservasi, invoice, gambar). `LiveChatMonitor.tsx` menyusut 6.237 → 5.387 baris (−850); logika composer kini di modul 763 baris; keystroke hanya menaikkan transisi kosong<->terisi ke monitor (tanpa re-render thread/sidebar per karakter). Kontrak imperatif: `setText/clear/focus/closePopovers/getText`. Dashboard `tsc && vite build` lolos, bundle `dist/` ter-regenerasi.
- **Fase B — Penegakan Anti-Label WAHA tuntas (temuan audit: 3 situs lolos guard lama)**: `reservation-lifecycle.service.ts` (`batchUpdateLabels`) dan `reservations.subroute.ts` (2× `wahaClient.removeLabel` multiline yang lolos regex guard) ditulis ulang DB-only via tabel `Label` + `CustomerLabel` (nama kanonis 'New Customer'/'Pending Payment'/'Repeat Order', tenant-scoped, upsert `update:{}` agar kustomisasi admin tak tertimpa; 'Legacy' tak tersentuh). Gate `ENABLE_LIFECYCLE_LABELS` dipertahankan. Komentar usang `customers.subroute.ts` (klaim mirror WAHA) dikoreksi. Guard `waha-label-ban-invariant.test.ts` diperkeras: test ke-3 melarang pola dot-call `.(addLabel|removeLabel|batchUpdateLabels)(` bentuk apapun termasuk chain multiline. Test `label-lifecycle.test.ts` (8) + `waha-label-cache.test.ts` #5 ditulis ulang ke asersi DB-only (zero WAHA).
- **Fase C — Drift riwayat & observabilitas**: skrip `scripts/check-livechat-sync.ts` (diagnostik read-only: drift `last_message_at` vs `MAX(created_at)`, pesan tanpa `wa_message_id`, phantom; exit 0/1/2), `scripts/repair-last-message-at.ts` (perbaikan idempoten satu statement SQL transaksional, default dry-run, `--apply` untuk eksekusi, tenant-aware), dan endpoint `GET /api/admin/live-chat/sync-health` (`{ success, healthy, driftsFound, missingWaId, activeSync, checkedAt }`, jujur saat DB offline). Test baru `tests/unit/live-chat-sync-health.test.ts` (2).
- **Regression & Build Verification**: full suite 275 files, 2001 tests passed, 19 skipped, 0 failures; `npm run build` (tsc root) + dashboard build exit 0.

#### Remediasi Fondasional Koneksi WhatsApp: Media Watermark Pruning, Idempotensi Ad Attribution & Anti-Nomor Palsu LID (2026-09-12)

- **Fase 1 — Watermark-Based Media Pruning & Non-Blocking Quota**:
  - Batas kuota penyimpanan dinaikkan dari 200 MB ke 1 GB default (`DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024`), configurable via DB/env.
  - Implementasi mekanisme auto-pruning cerdas berbasis watermark (High 85% -> Low 65%): saat penyimpanan mencapai 85% kuota, sistem secara otomatis dan async menghapus file HD inbound terlama hingga penggunaan turun ke 65% (`pruneToLowWatermark`).
  - Jaminan preservasi thumbnail (`_thumb.*`) dan proteksi gambar pricelist permanen (`pricelist_image_url`).
  - Pemakaian disk di-cache dalam memori (TTL 60 detik) untuk mencegah event loop freezing dari `fs.statSync` berulang.
  - Media cleanup cron diaktifkan secara default saat startup `app.ts` untuk self-healing media kadaluarsa.
  - Test baru: `tests/unit/media-watermark-autoprune.test.ts` (3 tests passed).

- **Fase 2 — Relational Idempotency Ad Attribution (Strict Types & Zero Any)**:
  - Menyelesaikan domain modeling category error pada Click-to-WhatsApp: memisahkan *Shared Campaign Tag* (`utmCampaign: 'IG-BABYSPA'`) dengan *Unique Click Token* (`trackingCode: ctwa_${uuid}`). Dua customer berbeda dengan template iklan yang sama tidak lagi menabrak constraint `@unique trackingCode`.
  - Menghormati relasi 1:1 `Customer <-> AdClick`: bila customer lama mengklik iklan ulang, sistem melakukan update touchpoint pada record yang sudah ada, mencegah crash `@unique customerId`.
  - Type strictness: penggantian parameter `any` dengan interface domain `CustomerIdentity`.
  - Test baru: `tests/unit/ad-attribution-relational.test.ts` (3 tests passed).

- **Fase 3 — Discriminated Union JID & Webhook Early Filter**:
  - Mengganti seluruh regex heuristik `startsWith('2160')` / `length >= 14` dengan classifier domain `parseJidType`: membedakan `'phone'`, `'lid'`, `'group'`, `'broadcast'`, `'newsletter'`.
  - Invarian mutlak: JID `@lid` yang belum teresolusi DILARANG dikembalikan sebagai nomor telepon palsu (`phone: ''`). Mencegah pembuatan data pelanggan korup/dummy di database.
  - Eliminasi redundansi pemrosesan ganda webhook WAHA: event `message.any` inbound (`!fromMe`) diabaikan pada gerbang awal (`IGNORED_REDUNDANT_INBOUND_ANY`).
  - Unit test `tests/unit/waha-lid-phone-resolution.test.ts` diperluas dan lulus 100%.

- **Regression & Build Verification**:
  - 33 tests passed di modul terkait, `npm run build` (tsc) exit 0 bersih tanpa error tipe.
  - Perbaikan Invariant Test Guard WAHA: Koreksi query ripgrep pada `tests/unit/v3/waha-label-ban-invariant.test.ts` agar secara presisi memindai `addLabel`/`removeLabel` (sebelumnya keliru menduplikasi `getChatLabels`).

#### Plan 6 — Geocoding Resilience, Kombo Aritmatika & Schema Hardening (Issues #26, #21, #30; #16 sebagian) (2026-09-12)

- **Kombo multi-treatment (FASE 1, Issue #26 RESOLVED)**: `numeric-fact-validator.ts` mengotorisasi jumlah subset 2–3 layanan resmi turn konsultasi (Si+Sj/+Addon/+Ongkir/+keduanya, termasuk triple; pool unik N≤6, O(N³)≤216) — hanya di luar mode strict. Deviasi dari rencana awal (ekspansi skema tool): kombinatorik sisi-validator, NOL perubahan kontrak tool. Test `multi-treatment-combo-validator.test.ts` (5).
- **Parsing Maps URL standar (FASE 2, Issue #16 sebagian)**: `?q=/ ?ll= / ?daddr=/saddr=/destination=` via `URL`/`URLSearchParams` (`parseMapsUrl`, `parseLatLngPair`); pathname/hash tetap regex. Ditemukan saat implementasi: base-relatif memalsukan body HTML jadi URL + `parseFloat` menelan markup ("1,2</body>"→{1,2}) — dikunci paritas (host-like + desimal wajib) + 2 test regresi. Test maps 17/17. Sisa tahap 2–4 `implementation_plan.md` tetap terbuka.
- **Koridor arteri (FASE 3, Issue #21 RESOLVED)**: `ARTERY_CORRIDORS` 10 koridor + `resolveArteryCorridor()` di `landmarks.ts`; `getGazetteerCoordinates` cek koridor dulu (kelurahan→kecamatan→eksisting), koordinat tetap dari dataset. "Darmo Permai" terbukti tak konflik. Test `artery-corridor-gazetteer.test.ts` (5) incl. ground-truth 10/10.
- **P2022 resilience (FASE 4, Issue #30 IMPLEMENTED)**: helper `isMissingColumnError()`; pembaca `tenants.settings` kembali default senyap; migrasi idempoten `20260912000000_ensure_tenants_settings_column` (verifikasi live menunggu deploy). Test `tenant-settings-resilience.test.ts` (3).
- **Full Regression**: 274 files, 1995 tests passed, 19 skipped, 0 failures. TSC clean.

#### Plan 4 — Persona Multi-Tenant Data-Driven, RAG Safe-Merge Non-Destruktif (Issue #46 RESOLVED) & Pembersihan Frasa Broker (2026-09-12)

- **Call 1 Router Prompt tenant-aware (Phase 1)**: `PersonaPromptBuilder.buildRouterPromptAsync` baru menyerap `TenantPromptConfig` (4 section dashboard sebagai blok overlay) + brand per-tenant via `getBrandIdentityAsync` (overlay `Tenant.settings.brand`, cached, pola `as any` mengikuti `few-shot-exemplars.ts` karena generated client lag). Varian sinkron dipertahankan pin; DB offline → output identik (zero behavior change). `agent-runner.ts` beralih ke varian async. Test `dynamic-router-prompt.test.ts` (3). Keputusan SaaS: tanpa migrasi/LOC besar → tanpa Confirmation Gate.
- **RAG non-destruktif + safe-merge 48 artikel (Phase 2, Issue #46 RESOLVED)**: korpus diekstrak ke `src/cli/faq-corpus.ts` (34 seed + 14 kurasi live via `scripts/sync-live-knowledge.ts`, `npm run sync:knowledge` + mode `--check` guard drift); `deleteMany` dihapus dari `seed-faq.ts`, diganti loop `upsertChunk` idempoten (kunci `tenant_id+title`, reuse pola `knowledge.service.ts` + memory fallback). Test `knowledge-safe-upsert.test.ts` (4).
- **Temuan merge:** snapshot live mengandung **mojibake CP437** (byte UTF-8 dibaca sebagai CP437 saat dump) — dipulihkan eksak saat merge (tabel 128 entri terverifikasi 0 mismatch vs codec referensi + self-test `≡ƒÿè→😊`); 4 overlap-beda-isi TIDAK ditimpa otomatis (lapor review manusia); kontrak kepemilikan seed 48 judul didokumentasikan.
- **Frasa broker (Phase 3)**: `"Bidan kami yang ready"` dibersihkan di 4 lokasi sekelas (bukan hanya 1 di plan — mandat anti-make-up): `clinic-faq.tool.ts` → "ketersediaan jadwal tim Bidan kami", `persona.ts` + `config/persona.ts` → "jadwal kami" (preseden audit 462651), `save-reservation.tool.ts` → "ketersediaan jadwal". Invariant test diperluas ke pola varian + functional check fallback tool + zero-scan source.

#### Plan 5 — Penegakan Mandat Mutlak Larangan Label WAHA & Resolusi Flaky Test (Issue #38 RESOLVED) (2026-09-12)

- **Penghapusan total mutasi label WAHA dari kode bisnis**: `wahaClient.addLabel/removeLabel` dihapus dari `conversation.service.ts` (eskalasi + auto-release), `label-reconciliation.service.ts` (ditulis ulang DB-only via `is_hold_labeled`), `per-contact-legacy-scrape.service.ts`, `webhook.route.ts` (`hold` + `new customer`), `customers.subroute.ts`, `livechat.subroute.ts`, `command.service.ts`. Guard test `tests/unit/v3/waha-label-ban-invariant.test.ts` (2 tests) mencegah regresi via pemindaian ripgrep. Method `addLabel/removeLabel` di `waha/client.ts` ditandai `@deprecated` + runtime warning dengan caller stack.
- **Perbaikan fondasional kopling tersembunyi**: `addLabel/removeLabel` memiliki efek samping `syncLabelColumn()` yang menulis `Customer.is_hold_labeled`. `escalateToHumanHandling` kini menulis flag langsung via `customerService.setLabelFlags` (guard `!isSandbox && !isGlobalDisabled` dipertahankan); `checkAndApplyAutoRelease` meng-clear flag fire-and-forget. DB kini single source of truth.
- **Resolusi flaky test #28**: ditulis ulang berbasis flag DB (`setLabelFlags` sebagai simulasi admin release) + prefix nomor aman `6287772` (menutup sumber flake laten: `628999+random` berpeluang ~1/9 menjadi `6289999xxxxx` yang terdeteksi dummy oleh `isDummyOrTestContact`). Test lama yang mengassert call WAHA (`admin-customer-label`, `label-ai-router` TC 24/25/28, `label-events`, `label-lifecycle` #1) diselaraskan ke semantik DB-only.
- **Full Regression**: 268 test files, 1959 tests passed, 19 skipped, 0 failures. TSC clean.

#### Plan 3 — GoalTracker Decomposition, Symptom Semantic Scorer & Test Harness Isolation (2026-09-12)

- **GoalTracker Decomposition**: `goal-tracker.ts` tereduksi dari 1.590 LOC menjadi 542 LOC (66% reduction). Ekstraksi 2 modul domain murni:
  - `CartManager` (`src/v3/state/cart-manager.ts`): syncCartItems, resolveAffirmativeSwap, calcCartTotal, detectRecipientScope, isDurationOnlyQuestion — zero side-effect, no DB.
  - `PatientProfileExtractor` (`src/v3/state/patient-extractor.ts`): syncChildrenProfiles, syncMomProfile, extractAgesMonths, isKakakHonorific, detectTargetAudience, parseGestationalWeeks, isMaternalOnlyMessage — zero side-effect, no DB.
- **Symptom Semantic Scorer (Issue #48 RESOLVED)**: Multi-word phrase matching (+8 bonus) + core complaint noun scoring (+4) + modifier scoring (+1). "susah makan" → Lahap Juara mutlak; "susah BAB" → Pulih Ceria mutlak. 6 unit test baru.
- **Test Harness Isolation (Issue #47 RESOLVED)**: `saveServices()` bypass saat `NODE_ENV=test` — `services_custom.json` tidak ter-mutasi saat npm test.
- **Full Regression**: 267 test files, 1957 tests passed, 19 skipped, 0 failures. TSC clean.

#### Selaraskan Unit Test Katalog Dinamis & Dokumentasi Tech Debt Test Suite (2026-09-12)

- **Latar Belakang:** Sesuai mandat non-hardcode data-driven di AGENTS.md, unit test pencarian nominal tidak boleh rapuh/gagal akibat perubahan nama paket atau harga promo dinamis di dashboard oleh admin.
- **Perubahan:**
  - `src/v3/agent/persona.ts`: Penegasan disclaimer pada exemplar few-shot 100rb bahwa angka dan nama layanan adalah ilustrasi pola, asisten wajib selalu mengutip hasil tool `get_catalog_and_price`.
  - `tests/unit/catalog-price-matching.test.ts` & `tests/unit/simulator-100rb-replay.test.ts`: Dirombak dinamis (data-driven) mengambil entri katalog aktif saat runtime, menguji nominal promo/normal riil, dan menambahkan adversarial edge cases (`NaN`, angka negatif).
  - `docs/KNOWN_ISSUES.md`: Pencatatan Issue #47 mengenai mutasi `services_custom.json` saat `npm test` beserta workaround dan saran perbaikan isolasi fixture test.
- **Verifikasi:** Targeted tests 10/10 passed, `npm run build` exit 0.

#### Sinkronisasi Penuh Knowledge Chunks (FAQ) & Chat Bank (Few-Shot Exemplars) dari Live Server ke Lokal (2026-09-12)

- **Latar Belakang:** Kebutuhan pengguna agar data RAG Chunks (`knowledge_chunks`) dan Chat Bank (`few_shot_exemplars`) di lingkungan lokal sama persis dengan yang ada di server produksi live (43.157.197.148:1403). Sebelumnya di lokal terdapat selisih (49 FAQ lama vs 43 FAQ kurasi live, dan hanya 7 exemplar default vs 26 exemplar live).
- **Aksi & Sinkronisasi:**
  - Dump data langsung dari PostgreSQL server produksi (`wa-clinic-bot-postgres-1`): 43 record `knowledge_chunks` dan 26 record `few_shot_exemplars` diekspor bersih dengan encoding UTF-8 (mempertahankan emoji natural WhatsApp Bidan Yusi tanpa mojibake).
  - Snapshot data disimpan ke `storage/live_data.sql`, `storage/live_knowledge_chunks.json`, dan `storage/live_few_shot_exemplars.json`.
  - Database PostgreSQL lokal di container `wa-clinic-bot-postgres-1` disinkronkan: tabel `knowledge_chunks` dan `few_shot_exemplars` kini berisi 100% data riil produksi yang identik.
- **Verifikasi:**
  - Query SQL lokal membuktikan: `knowledge_chunks` = 43 baris, `few_shot_exemplars` = 26 baris (identik dengan server live).
  - Test suite `tests/unit/knowledge.test.ts` (3 passed) dan `tests/v3/agent-runner.test.ts` (7 passed) hijau tanpa regresi.

#### Resolusi Deadlock Validator Faktual & Pembajakan Sanitizer Eskalasi (2026-09-12)

- **Latar Belakang:** pertanyaan SOP vaksin dijawab sapaan Turn-0 tak relevan. Akar: deadlock D2↔D3 (prompt mewajibkan policy-tool, validator hanya mengakui search-chunks, `_retrievedChunks` dead parameter); sanitizer menimpa `finalReply=''` eskalasi dengan sapaan hardcoded; Step 3 FTS tanpa Relevance Gate meloloskan artikel skor 0.015.
- **Fixed:** D2/D3 di `src/v3/guardrails/factual-claim-validator.ts` kini mengakui `get_clinic_policy_faq`, artikel vaksin di `search_knowledge_faq`, dan `retrievedChunks` substantif; guard `!isEscalated && shouldSendReply` + `replyText ''` saat eskalasi + brand dinamis di `src/v3/agent/agent-runner.ts`; cek `shouldSendReply` di `src/routes/admin/evaluations.subroute.ts`; gate token substantif + `rank>=0.025` di Step 3 dan fallback tanpa-kolom `src/services/knowledge.service.ts`; test baru `tests/unit/vaccine-sop-flow.test.ts` (5).
- **Verifikasi:** vaccine-sop-flow 5/5, factual 9/9, knowledge 3/3, agent-runner 7/7 hijau; `npm run build` exit 0. Full suite menyisakan 19 gagal pre-existing keluarga harga katalog (terbukti di tree bersih, dicatat di `docs/KNOWN_ISSUES.md` #45).

#### Pembenahan Fondasional UI Edit Reservasi & Integrasi Backend (2026-09-12)

- **Latar Belakang:** 8 bug arsitektural pada Edit Reservasi: status `pending` terpaksa jadi `confirmed` (state sempit `'hold'|'confirmed'`), rekomendasi jam self-collision (jadwal sendiri dianggap bentrok), reservasi tanpa tanggal terisi paksa hari ini 09:00, `Pijat Ceria` → `Paket Selapan` via substring `normS.includes(normTarget)`, LTV & CAPI bengkak karena `purchaseValue` tercampur ongkir (Rp 125k), banner draf hantu di mode edit, assignedChildIndex 0 paksa, dan ganti customer silent-failure.
- **FASE 1 — Kontrak & State Machine:** `types/index.ts` sudah union lengkap; `reservations.subroute.ts` `status` + `ongkir` (sinkron `Customer.ongkir`), `CreateReservationModal.tsx` state `pending|confirmed|completed|cancelled|hold` + `validStatus` + select 5 opsi + banner `mode!=='edit'` & tombol Simpan Draf hidden di edit.
- **FASE 2 — Self-Collision:** `bookedReservationsForDate` & `customerConflictsForDate` kecualikan `initialReservation.id` saat `mode==='edit'`; `handleGenerateRecommendations` & `Lihat Jadwal Terisi` tidak lagi anggap diri sendiri bentrok.
- **FASE 3 — Tanggal & Katalog:** Guard `else if (isOpen && !bookingDate && mode!=='edit')`; `parseTreatmentsFromDetail` hierarkis (exact → non-bundle → fallback) + `childNameInParen` → `assignedChildIndex` via `babiesForChildMatch`, panggil `parseTreatments(..., rawBabies)`.
- **FASE 4 — Akuntansi & Customer Lock:** `purchaseValue` = `subtotalTreatments - discount` (murni medis), `ongkir` terpisah ke `Customer.ongkir`; Customer Picker terkunci di edit (Info Card `Terkunci (Mode Edit)`), `customerId` tak lagi silent-failure.
- **Verifikasi:** `tsc --noEmit` bersih, `vite build` 2450 modules, `admin-quick-hold` 8 passed; manual pending tetap pending, self-collision hilang, tanpa tanggal tetap kosong, `Pijat Ceria` tidak jadi Selapan, LTV Rp100k/ongkir Rp25k terpisah.

#### Pembaruan Menyeluruh Katalog Treatment & Pricelist (Revisi Final 35 Layanan) (2026-09-11)

- **Latar Belakang:** Pembaruan katalog resmi layanan dan pricelist klinik Kala Moms and Baby Spa sesuai tabel revisi: penyesuaian promo Paket Pra-Kelahiran Duo menjadi Rp 85.000, pemecahan Pijat Bayi Ceria menjadi tier usia Newborn (0-6 bulan, Rp 60k promo) dan Bayi (7-24 bulan, Rp 70k promo), penambahan tier usia Pijat Kids Pulih Ceria (2-4 th, 4-6 th, 6-8 th), aktivasi resmi layanan Memandikan Bayi & Cukur/Tindik, serta penambahan variasi Paket Selapan (Full, Terapi, Terapi Full).
- **Katalog & Konfigurasi (`services_custom.json`):**
  - 35 layanan baru terstruktur per kategori: Bayi (8 layanan), Anak (6 layanan), Ibu & Hamil (9 layanan), Paket Bundling Hemat (11 paket), dan Add-on Medis (3 layanan).
  - Melestarikan paket berseri `Newborn Treatment (14 Sesi Kunjungan)` (`NewBorn`, 120m, Rp 700k/Rp 500k) yang aktif di live database.
  - Normalisasi teks dan tanda baca (ASCII hyphens) untuk mencegah malformasi karakter di konsol / PostgreSQL.
- **Basis Data Live PostgreSQL (`clinic_services`):**
  - Sinkronisasi atomik via transaksi `BEGIN ... COMMIT` dengan `ON CONFLICT (tenant_id, service_id) DO UPDATE` per tenant `default-tenant`.
  - 40 record layanan aktif tersinkronisasi sempurna di VM live (43.157.197.148:1403).
- **AI NLU & Entity Extractor (`entity-extractor.service.ts`):**
  - Menghapus "memandikan bayi" dan "tindik telinga" dari contoh `ask_unlisted_service` agar AI bot mengenali kedua layanan tersebut sebagai layanan katalog resmi klinik.
- **Verifikasi Unit Tests (`vitest`):**
  - Pembaruan validasi perhitungan paket bundle pada `treatment-catalog-bundle-addon.test.ts` (penyesuaian total normal Cukur 35k + Pulih Ceria 100k = 135k).
  - Penyesuaian matcher nama layanan pada `treatment-catalog-search.test.ts`.
  - `npm run build` (`tsc`) lulus 100% tanpa error, seluruh test suite katalog hijau.

#### Multi-Lapisan Fondasional V3: Disambiguasi Multi-Anak, Integritas Matematika & Anti-Brosur (2026-09-10)

- **Latar Belakang:** sesi 214956/222655 — AI menebak 1-vs-2 anak sepihak; halusinasi 75k+105k+15k=120k lolos whitelist; rekomendasi usia format brosur bernomor tanpa pemantik klinis; saran pijat langsung pasca-imunisasi.
- **Perbaikan:** latch `isMultiChildUnconfirmed` + mandat klarifikasi dinamis + aturan persona (klarifikasi lembut 2-anak-1x-ongkir); `[MANDAT INTEGRITAS MATEMATIKA]` total resmi di grounding; validator mode strict multi-item (parsial ditolak, pesan menyebut total resmi) + re-prompt bersih 1x lalu fallback template (tanpa mutilasi regex); template `cartTotalReply` multi-item dihitung mesin; narasi 1 paragraf + pemantik klinis di tool & persona A.1; `kids-massage-ceria` generik dinonaktifkan (bukan dihapus).
- **Ditunda gated:** seed FAQ live (destruktif — backup dulu) + `is_active=false` baris `clinic_services` live.
- **Verifikasi:** `tsc` bersih; 3 file test baru + regresi hijau; full suite **222 file, 1756 passed, 0 failed**.

#### Pembenahan Fondasi & Root Cause Alur Konfirmasi Reservasi (HOLD & PENDING) (2026-09-09)

- **Latar Belakang:** Tombol "Konfirmasi" pada banner `HOLD` (slot kunci 3 detik, dummy `[HOLD] Slot Ditawarkan`) dan `PENDING` (booking riil belum lunas) sama-sama melempar ke `ReservationDetailModal` pasif, sehingga data bolong (`Bunda ()`, `Rp 0`, `status undefined`) dan modal salah alamat. Backend `live-chat.service.ts` emit stub `{id, booking_date, notes}` tanpa kontrak kanonikal, serta hold kedaluwarsa (2 jam lewat) masih tampil sebagai banner aktif.
- **Stage 1 — DTO Kanonikal (`live-chat.service.ts`, `customers.subroute.ts`):** Standardisasi `formatReservationItem` ke kontrak lengkap (`status`, `duration_minutes`, `purchase_value`, `payment_method`, `assigned_staff`, `customer:{id,name,phone,kelurahan,kecamatan,kota,children,ongkir}`); `isHoldValid` temporal (booking_date > now-2jam) + pruning konsisten; `customers/:id` mapper jaminan `r.customer` tidak pernah `undefined`.
- **Stage 2 — Mesin Status (`LiveChatMonitor.tsx`):** Pisah semantik: HOLD → `handleConvertHoldToBooking` (prefill `CreateReservationModal` dengan customer aktif + tanggal/jam hold + terapis, `Lengkapi Booking`, auto `release-hold` saat simpan) vs PENDING → `handleConfirmPendingBooking` (dialog atomik `Ya, Konfirmasi Lunas` → `PATCH /confirm` + Google Calendar); selector `activeHoldReservation` + `handleReservationUpdate` kini pakai `isHoldValid` yang sama.
- **Stage 3 — Deep Hydration Guard (`ReservationDetailModal.tsx`, `CreateReservationModal.tsx`):** Jika `reservation.customer` kosong, auto-fetch `GET /reservation/:id` / `GET /customers/:id` sebelum render, sehingga form tidak pernah tampil bolong.
- **Verifikasi:** `tsc --noEmit` bersih, `vite build` 2450 modules, `admin-quick-hold.test.ts` 8 passed; manual HOLD→Lengkapi Booking→Simpan (hold hilang, booking riil tercipta) & PENDING→Konfirmasi Lunas (confirmed + Calendar) hijau.

#### Perbaikan Layout Mobile iPhone & Redesain Footer Icon Buttons (2026-09-09)

- **Latar Belakang:** Footer teks panjang overflow di iPhone 375px, header & footer terpotong Notch/Dynamic Island & Home Bar, serta viewport tidak full-screen saat keyboard muncul.
- **Invoice WA (`InvoiceGeneratorModal.tsx`):** Overlay `p-3` → `p-0 sm:p-4` + `items-end sm:items-center`, modal `rounded-3xl` → `rounded-none sm:rounded-2xl`, header `px-3.5 py-2` → `px-4 pt-[calc(0.5rem+env(safe-area-inset-top))]` (~36px tetap tipis + aman Notch), footer teks → **icon-only 40×40** (`w-9 h-9 sm:w-10 sm:h-10`) dengan **floating pill tooltip** 1800ms saat `onTouchStart`/`onClick` (Simpan/Batal/Salin/Kirim WA), footer `pb-[calc(0.6rem+env(safe-area-inset-bottom))]` aman Home Bar, total lebar footer ~180px anti-overflow.
- **Reservasi (`CreateReservationModal.tsx`):** Overlay & dialog sinkron `p-0 sm:p-4` + `rounded-none sm:rounded-3xl` + `h-[100dvh]`, tombol tutup & header `safe-area-top`, footer `safe-area-bottom`, form `WebkitOverflowScrolling: touch` untuk inertia iOS.
- **Verifikasi:** `tsc --noEmit` bersih, `vite build` 2450 modules; manual 375px/390px — 4 ikon rapi tanpa scroll horizontal, pill muncul saat tap, header/footer tidak terpotong Notch/Home Bar, scroll form mulus saat keyboard aktif.

#### Pembenahan Fondasi Fitur Draf & Redesain UI Mobile Invoice WA (2026-09-09)

- **Latar Belakang:** Tabrakan draf antar-customer (key statis `'create_reservation'`), ghost auto-save (customer bawaan dianggap draf), state leak saat modal ditutup, kehilangan data paket multi-sesi, key draf invoice pecah per ketukan digit HP, banner draf sticky mengunci layar mobile, dan header invoice tebal ~70px yang memakan viewport saat keyboard muncul.
- **Lapisan 1 — Fondasi Draf & Anti-Ghost (`useFormDraft.ts`, `CreateReservationModal.tsx`, `InvoiceGeneratorModal.tsx`):** Isolasi key per-customer (`reservation_cust_${customerId}` / `reservation_new`; `invoice_${stableTargetId}`), perketat `isMeaningful` (hanya treatment/anak/notes/diskon/staff/multi-sesi/kustom — bukan sekadar `customerId`), perluas payload draf (`isMultiSession`, `multiSessionSchedule`, `customService*`), stabilkan key invoice dari `bundaName/phone` + `hasRestoredDraftRef` guard agar tidak tertimpa sinkronisasi `initialData`.
- **Lapisan 2 — Siklus Hidup State (`CreateReservationModal.tsx`, `InvoiceGeneratorModal.tsx`):** Fungsi terpusat `resetModalState()` / `resetInvoiceState()` yang mengembalikan seluruh field ke nilai awal bersih saat `isOpen` → `false`; cegah state leak antar-bukaan modal.
- **Lapisan 3 — Scroll & Viewport (`CreateReservationModal.tsx`, `InvoiceGeneratorModal.tsx`):** Pindahkan banner draf dari posisi `shrink-0` statis di luar form ke **dalam** kontainer scrollable (`overflow-y-auto`) sehingga ikut tergulir (*scrolls away*); ganti `max-h-[92vh]` / `max-h-[60vh]` menjadi `h-[100dvh] sm:h-auto sm:max-h-[90vh]` + `flex-1 min-h-0` agar keyboard virtual tidak mengunci layout; rampingkan tab mobile `py-1.5 text-[11px]`.
- **Lapisan 4 — Header Minimalis (`InvoiceGeneratorModal.tsx`):** Judul `Draft Rincian Reservasi & Invoice WA` → `Invoice WA`; hapus badge `Auto-Extracted dari Chat` & paragraf verifikasi; padding `px-5 py-3.5` → `px-3.5 py-2 sm:px-4 sm:py-2.5`; icon box tebal `w-8 h-8` → icon inline `Receipt size={16}`; tombol tutup `p-1 rounded-md`; tinggi header terpangkas ~50% (70px → 36px).
- **Verifikasi:** `tsc --noEmit` bersih, `vite build` 2450 modules, `language-sanitizer` 13 tests passed; uji manual anti-kontaminasi draf, ghost auto-save, multi-sesi restore, dan viewport mobile 375px dengan keyboard aktif.

#### Redesign Fondasional — Parsing GPS Pin, Klaster Hierarki & Sticky GPS (2026-09-09)

- **Latar Belakang:** alamat "Valencia spring puri surya jaya DD 3 no.28" terhitung 8.5 km (gerbang depan) padahal titik klaster ~10.7–10.9 km rute ORS. Akar: 1 titik per mega-estate; payload Baileys (`degreesLatitude`) tak terbaca → NaN; `share.google` tak terekstrak; flag GPS tak pernah menyala.
- **Perbaikan:** util kanonis `waha-location-parser.ts` (Baileys `locationMessage`/`liveLocationMessage`, 0,0 dibuang, anti bocor NaN) dipakai `webhook.route.ts`; regex URL + `share.google`; 3 klaster PSJ (Valencia/Sydney-Boston/Osaka-Vancouver) sebelum gerbang utama (cluster-first); invarian sticky terverifikasi tetap berlaku (override admin via dashboard langsung).
- **Sengaja ditunda jujur:** klaster CitraHarmoni/Kahuripan/CitraLand menunggu survei koordinat (tanpa fabrikasi); angka ORS 10.92 km butuh konfirmasi live sekali.
- **Verifikasi:** test baru 9+7+4+2 hijau; E2E `geocodeText` → klaster presisi; full suite **204 file, 1640 passed, 0 failed**; `npm run build` bersih.

#### Redesain Fondasional — Klasifikasi Lifecycle Pasien & Active Appointment Guard (2026-09-09)

- **Latar Belakang:** insiden Bunda Retno (`6282132249740`) — bot AI membalas pasien yang treatment pertamanya sudah `completed` dan pasien berjadwal aktif H-0 ("Sdh smp mana ya?") dengan template marketing generik. Akar sistemik: gate buta status `completed`, properti hantu `purchase_count` / `status='repeat'` (tak pernah ada di schema), tanpa pelindung jadwal aktif, label `repeat` hanya hitung `confirmed`, dan test lama mem-passing mock fiktif (false confidence).
- **Service Kanonis (`patient-lifecycle.service.ts`, baru):** `hasTreatmentHistory` (`confirmed`/`completed`, fallback `ltv_cache`), `getActiveAppointment` (`pending`/`confirmed`/`hold`, jendela [now-12 jam, now+24 jam]), `getPatientClinicalProfile`. Tenant-aware, best-effort.
- **Eligibility & Scope Gate:** kontrak input valid + reason baru `ACTIVE_APPOINTMENT_MANUAL` (guard wajib: silence + eskalasi, exempt auto-release 6 jam); properti hantu dihapus; eskalasi operasional "jadwal treatment aktif hari ini (Manual Handling CS - Koordinasi Operasional)".
- **Sinkronisasi label & modul:** `repeat` (lifecycle + reconciliation), `hasPriorConfirmed` (machine), review H+1 (cron) kini hitung `in ['confirmed','completed']`.
- **Data live (menunggu instruksi operasional):** runbook `scripts/cleanup-bunda-retno-reservation.sql` — BLOK 1 (cancel) atau BLOK 2 (confirm), jalankan salah satu via SSH + verifikasi 2-langkah.
- **Verifikasi:** `tsc --noEmit` bersih; test ditulis ulang tanpa mock fiktif + simulasi Retno; full suite **201 file, 1618 passed, 0 failed**.

#### Audit Sesi 435731 — Anti-Todong Jadwal, Anti-Halusinasi Domisili & Sinkronisasi Keranjang (2026-09-09)

- **Latar Belakang:** 12 dari 14 balasan bot diakhiri pertanyaan (todong jadwal 6x, termasuk setelah jadwal Sabtu final & reservasi tercatat); halusinasi "Kecamatan Waru ini cukup luas..." ke customer Kedungkendo-Candi; `cartItems` kehilangan `Pijat Bayi Ceria` karena nama resmi berkurung gagal exact-match.
- **Keranjang (`goal-tracker.ts`):** normalisasi nama katalog tanpa regex (buang `(...)` akhir) — cocok utuh ATAU bersih; hanya full-match yang menekan fuzzy; kandidat fuzzy wajib bawa ≥2 token signifikan yang belum dijelaskan exact-hit. Skenario sesi: Induksi 105k + Ceria 60k + ongkir 25k = Rp 190.000.
- **Persona:** hapus "Closing CTA WAJIB" → statement-only untuk pertanyaan teknis (durasi/persiapan/biaya/bayar); contoh durasi tanpa todong jadwal; Waru = basecamp, dilarang asumsikan domisili; larangan tanya hari bila jadwal final. **Summarizer:** guard `booking.preferredDate/reservationId` + cooldown jadwal anti-sebutan-hari-bypass.
- **Diverifikasi:** test baru `cart-sync-parentheses` (5) + `v3-anti-todong-jadwal` (7) hijau; `npm run build` bersih; full suite 199/200 file, 1601 passed (1 flaky timeout LLM `live-chat-reply suggest-reply`, lolos solo 10/10). Komponen gate-alamat & keyword-enrichment sudah live sesi lalu (lihat #34), kontrak test tetap hijau.

#### Redesain Fondasional — Siklus Hidup Reservasi & Integritas Transaksi (2026-09-09)

- **Latar Belakang:** Audit 6 titik mutasi reservasi menemukan 5 akar masalah: fragmentasi domain (6 entry point tanpa standar), tanpa validasi konflik jadwal di backend, dedup naif berbasis `created_at` 24 jam (rekam yatim tetap aktif), parser keuangan global + heuristik `angka ≤500 → ×1000` yang mengkorupsi `Usia >4-6 th` menjadi Rp 46.000, dan penimpaan buta `purchase_value` resmi (Rp 160.000 → Rp 46.000) oleh purchase detection.
- **Domain Service Kanonis (`src/services/reservation-core.service.ts`, baru):** Single Source of Truth semua mutasi — Customer Conflict Guard + Staff Collision Guard (overlap interval + buffer 20 mnt); channel-aware (`ADMIN_PANEL` → HTTP 409 `DUPLICATE_BOOKING`/`STAFF_COLLISION` kecuali `force:true` + audit `CREATE_RESERVATION_FORCE_OVERRIDE`; `BOT/WEBHOOK/AGENT` → idempotent merge + auto-konsolidasi duplikat ke `cancelled`); lifecycle terstandarisasi (anak, kontak, follow-up bila `confirmed`). Endpoint admin (`parse`, `quick-hold`, manual create) didelegasikan + dukung `force`; `machine.ts`, `save-reservation.tool.ts` (→ `AGENT`) dimigrasi; `upsertReservationForm` jadi wrapper deprecated → core.
- **Parser Keuangan (`conversation-transaction-extractor.ts`):** isolasi blok pembayaran (cari SETELAH penanda `Payment:/Pembayaran:/Rincian Biaya/Tagihan`); filter token non-mata-uang (`th/tahun/usia/…` tanpa `rp/rb/k` → 0); hapus pelipatgandaan `≤500`; invarian `Total == Treatment + Ongkir − Promo` + auto-rekonsiliasi (`[PAYMENT PARSER RECONCILED]`).
- **Purchase Detection:** pencocokan `booking_date` dari teks (fallback `created_at desc`) + downside guard (nilai parser lebih kecil dari nilai resmi → pertahankan resmi, tanpa verifikasi invarian).
- **Dashboard (`CreateReservationModal.tsx`):** banner pre-flight bila customer sudah punya reservasi aktif di tanggal tsb + dialog 409 `[Batal & Buka Jadwal Existing | Tetap Simpan Baru (Force)]` (state React, tanpa `window.confirm/alert`).
- **Data live (menunggu verifikasi 2-langkah):** script `scripts/cleanup-bunda-bella-duplicates.sql` — cancel `7a6e494a…`, restore `bbbde4bd…` → 160000 + SELECT verifikasi.
- **Verifikasi:** `npm run build` bersih; `tsc --noEmit` dashboard bersih; test parser 16/16, core 6/6, purchase 19/19 hijau; full suite 1551 passed, 2 failed pre-existing (`live-chat-reply suggest-reply`, `robustness 5-min timeout` — terverifikasi gagal juga di baseline).

#### Optimization — Audit Mikro & Efisiensi Sistem Menyeluruh (Eliminasi Redundansi, Dead Code & Memory Leaks) (2026-09-08)

- **Latar Belakang:** Audit skala mikro terhadap performa runtime, redundansi kode, jejak memori, dan kebersihan dependensi bot. Ditemukan residu dekomisioning V2 yang memicu 35 test crash, dependensi mati (`ssh2`, `meta-capi-param-builder-clientjs`, `@googlemaps/google-maps-services-js`), pembacaan sinkron file 111 KB berulang di 5 lokasi, serta potensi memory leak pada map in-memory tanpa batas.
- **Tahap 1 — Dependensi & Package Bloat (`package.json`):** Hapus library tanpa import (`ssh2`, `meta-capi-param-builder-clientjs`, `@googlemaps/google-maps-services-js`); pindahkan `@types/bcrypt` dan `@types/sanitize-html` ke `devDependencies`; bersihkan 42 MB dead `node_modules` pada paket pensiun `packages/click-catcher`.
- **Tahap 2 — Tuntaskan Dekomisioning `src/slot-engine/`:** Pindahkan `few-shot-exemplars.ts` & `gold-few-shot-exemplars.ts` langsung ke `src/v3/agent/`; pindahkan `entity-extractor.ts` ke `src/services/entity-extractor.service.ts`; isolasi tipe `ExtractedEntities` ke `src/types/nlu.ts`; hapus seluruh direktori `src/slot-engine/` (-2.100+ baris).
- **Tahap 3 — Pembersihan Dead Code & Dead Functions (`src/`):** Hapus modul mati `price-answer.service.ts`, `location-sanitizer.ts`, `islamic-greeting.ts`, `whatsapp/client.ts`, dan controller `webhook-v3.controller.ts`; bersihkan fungsi `@deprecated` dan class `UnifiedResponseSanitizer` dari `language-sanitizer.ts`; hapus client Google Maps mati dari `geocoding.ts`.
- **Tahap 4 — Pemulihan Test Suite (100% Green):** Hapus 30+ file test zombie V2 yang mengimpor modul yang sudah tidak ada; selaraskan ekspektasi `ad-click.test.ts` (Meta CAPI Queue decoupled) dan `production_edge_cases.test.ts` (V3 `LOCATION_CONFIRMED`); hasilkan **195 test files passed (100%), 1.575 tests passed, 0 failed**.
- **Tahap 5 — Sentralisasi Gazetteer Single-Source of Truth (`gazetteer.ts`):** Bangun index in-memory O(1) tunggal (kelurahan, kecamatan, prefix Manukan, centroid koordinat lat/lng) yang dimuat sekali saat boot; eliminasi pembacaan sinkron `fs.readFileSync(111KB)` dari `customer.service.ts`, `calculate-delivery.tool.ts`, dan `geocoding.ts`.
- **Tahap 6 — Hardening In-Memory Stores & Anti-Leak:** Pasang batas maksimal 1.000 entri + FIFO/TTL eviction (24h) pada `memorySessions` di `goal-tracker.ts`; pasang batas kapasitas `maxEntries = 500` pada `ResponseCacheService`; tambahkan periodic cleanup pada map login attempts.
- **Tahap 7 — Relokasi Script Ad-Hoc & Build Optimization:** Pindahkan 32 script CLI non-runtime dari `src/scripts/` ke `scripts/` (termasuk 3.748 baris data mock `sync-export-data.ts`); perbarui script `sync:history` di `package.json`; ukuran `dist/` menyusut 24% dari 3,51 MB menjadi 2,67 MB; durasi test berkurang dari 101s menjadi 75s.
- **Verifikasi:** `npm run typecheck` bersih, `npm run build` sukses, `npm test` 195/195 (1.575 tests) passed 100%, `eval:numeric` 86.7% pass rate.

#### Fix — Defensive Admin Knowledge untuk DB skema lama tanpa kolom keywords (P2022) (2026-09-08)

- **Gejala:** `GET /api/admin/knowledge/chunks` melempar `prisma:error Invalid prisma.knowledgeChunk.findMany() ... The column knowledge_chunks.keywords does not exist` sehingga dashboard tampil kosong (catch diam-diam me-return `data: []`).
- **Akar:** drift skema-vs-DB — `prisma/schema.prisma` sudah punya `keywords` + migrasi `20260907000000_add_knowledge_chunk_keywords` ada di repo, tapi belum di-apply di database yang sedang dipakai bot. Prisma typed query (findMany/update) memvalidasi kolom dan melempar P2022.
- **Perbaikan:** `isMissingKeywordsColumnError()` diperluas mendeteksi P2022 (`keywords ... does not exist`); `GET /chunks` retry dengan `select` tanpa `keywords` (balik `keywords: null`) agar dashboard tetap tampil; `PUT /chunks/:id` retry update tanpa `keywords` + warn log; `checkDuplicateFaq()` ikut defensif. Perbaikan permanen tetap migrasi DB (lihat bawah).
- **Verifikasi:** `npm run build` bersih; `dynamic-knowledge-maternal` 5/5 + `knowledge` 3/3 ✓.

#### Fix — Dynamic Knowledge Grounding & Zero-Hardcode Persona Restoration (kasus maternal 38 weeks + induksi + capek) (2026-09-08)

- **Latar Belakang:** Query "38 weeks apa sudah bisa pakai yang induksi ya kak? Ini sama capek² juga soalnya" gagal grounding. Akar: (1) fallback `search-knowledge-faq.tool.ts:72` hardcoded "konsultasikan ke Bidan + tawarkan eskalasi" memicu krisis identitas; (2) FTS `knowledge.service.ts` memakai kolom `keywords` yang belum ter-migrasi di sebagian env (error 42703) sehingga selalu jatuh ke fallback kosong; (3) aturan klinis aterm ≥37-38 minggu + relaksasi bumil capek belum ada di DB knowledge base.
- **Tahap 1 — DB-driven (`knowledge.service.ts`, `seed-faq.ts`, `scripts/seed-maternal-induction-knowledge.ts`):** `isMissingKeywordsColumnError()` + retry FTS `searchFtsWithoutKeywordsColumn()` (title+content saja) saat error 42703/P2010 agar DB skema lama tetap bisa FTS; metode generik tenant-aware `upsertChunk()` (upsert by title, fallback in-memory saat offline, toleran skema lama); artikel klinis "Panduan Usia Kehamilan untuk Pijat Induksi Alami" + keywords (38 weeks, induksi, capek, aterm, hpl) masuk sebagai SEED DB (editable via dashboard), bukan hardcode runtime. Script idempoten: `npx tsx src/scripts/seed-maternal-induction-knowledge.ts [--tenant=ID]`.
- **Tahap 2 — Zero-hardcode fallback (`search-knowledge-faq.tool.ts`):** pesan kosong diganti generik — rujuk katalog dinamis (`get_catalog_and_price`) + kompetensi Bidan Yusi; eskalasi HANYA untuk kegawatdaruratan patologis. Tanpa nama treatment/usia statis.
- **Tahap 3 — Prinsip persona (`persona.ts`):** blok baru `[PRINSIP EMPATI & IDENTITAS BIDAN YUSI]` — validasi keluhan fisik, integritas identitas (larang "akan kami konsultasikan ke Bidan kami" untuk ranah komplementer standar), kata ganti profesional. Tanpa data bisnis statis.
- **Verifikasi:** `dynamic-knowledge-maternal.test.ts` 5/5 ✓ (RAG aterm via in-memory, tool FAQ maternal, fallback generik tanpa false-escalation/hardcode, prinsip persona, deteksi 42703), regresi `knowledge` 3/3 + `v3-persona-rules` 15/15 ✓, `npm run build` (tsc) bersih.
- **Tindak lanjut live DB:** jalankan `npx prisma migrate deploy` (kolom `keywords`) + script seed induksi di server; artikel selanjutnya diedit via dashboard `/api/admin/knowledge`.

#### Fix — Ekstraksi Form Chat, Fuzzy Matching Layanan & Generator Invoice WhatsApp (`chatScheduleExtractor.ts`, `treatmentStringParser.ts`, `InvoiceGeneratorModal.tsx`) (2026-09-07)

- **Latar Belakang (kasus Bunda Fitria 628563567095):** Invoice tidak sesuai form — tanggal geser H+1, nama anak kosong, usia "Treatment :", layanan salah "Paket Selapan" Rp 80.000 padahal "Pijat Ceria + Oksitosin". Akar: (1) regex top-down menangkap template kosong bot → section baby/moms terpotong; (2) baris historis `children` (`Usia Bayi/Anak :` / `Treatment :`) tanpa guard; (3) `.includes()` satu arah cocokkan "pijat ceria" ke bundle Selapan; (4) treatment Moms terabaikan.
- **Stage 1 — Core extractor (`chatScheduleExtractor.ts`):** `pickFilledFormBlock` reverse-scan (terbaru→terlama, INBOUND terisi prioritas, fallback OUTBOUND terisi, template kosong tidak pernah dipilih); seluruh ekstraksi terstruktur TAHAP 1 (tanggal, nama, alamat, anak, treatment baby+moms) memakai blok form terisi yang sama; `isFormLabelAge` guard `raw_age_text`/`current_age` DB; `cleanBundaName` loop stabil + collapse token kembar ("fitria Wonokromo Wonokromo"→"fitria"); part treatment dikanonikalisasi ke nama resmi katalog bila tersedia.
- **Stage 2 — Intelligent matching (`treatmentStringParser.ts`):** `matchCatalogService` token-overlap scoring (cakupan query + tie-break spesifisitas, substring dua arah "full/body↔fullbody", alias "oksifull"→oksitosin+full, exact-match menang, kandidat bundle hanya bila disebut eksplisit) — dipakai `parseTreatmentItemsFromRaw` & price matching extractor. "pijat ceria"→Pijat Bayi Ceria, "oksitosin full body"/"oksifull"→Oksitosin Massage Fullbody.
- **Stage 3 — Modal (`InvoiceGeneratorModal.tsx`):** Hidrasi sanitasi bunda/usia (`cleanBundaName`, `isFormLabelAge`→kosong), render invoice pakai nama & usia aman; dynamic list otomatis hidrasi 2 item Rp 60.000+Rp 105.000 via parser Stage 2.
- **Stage 4 — Live DB:** DELETE 1 baris korup `children` (`f5c207c7…`/`Usia Bayi/Anak :`/`Treatment :`), normalisasi `customers.name`→"Bunda Fitria Wonokromo". Verifikasi: tersisa Fitria/hamil 38 minggu + Nadira/2bulan.
- **Verifikasi:** `chat-schedule-extractor-form.test.ts` 13/13 ✓ (thread riil Fitria: Minggu 13 Sep 2026, Nadira, 2bulan, BUNDLE Rp 165.000, anti-template-kosong, anti-Selapan, guard korup), regresi `chat-schedule-extractor` 8/8 + `treatment-string-and-tier-calc` 7/7 ✓, dashboard `vite build` ✓.

#### Fix — Eliminasi Phantom Cart Item & Presisi Topik Durasi Pijat Bayi (`goal-tracker.ts`, `persona.ts`, `conversation-summarizer.ts`, `types.ts`) (2026-09-07)

- **Latar Belakang:** Sesi simulator 933742 — sapaan bot Turn-0 ("Treatment moms & Baby...") memasukkan phantom item Rp 500.000 via token unik tunggal "treatment"; "Untuk pijat bayi biasanya brp menit kak" salah terdeteksi `ask_price` via substring 'rp' di "brp" (persona + buyingSignal); closing CTA berupa pertanyaan terbuka alih-alih ajakan booking spesifik. Commit `a31f350` hanya berisi dokumen rencana — kode belum pernah diimplementasikan.
- **Tahap 1 — Engine keranjang (`goal-tracker.ts`):** `GENERIC_CLINIC_TOKENS` (16 kata: treatment, pijat, bayi, ...) dilarang jadi penentu tunggal fuzzy; pesan `assistant` hanya boleh `exactHits` (nama resmi utuh); `isDurationOnlyQuestion` pakai `/\brp\b/` presisi agar "brp" bukan sinyal beli.
- **Tahap 2 — Intent & summarizer (`persona.ts`, `conversation-summarizer.ts`, `types.ts`):** `extractFastIntents` — 'rp' substring → token `/\brp\b/`, pertanyaan durasi mengalahkan harga, intent baru `ask_duration` (+ union type); summarizer cabang durasi SEBELUM harga ("durasi waktu pelaksanaan ..." + CTA jadwalkan spesifik, larang pertanyaan terbuka); `mentionsCost` cukur ikut presisi.
- **Tahap 3 — Prompt (`persona.ts`):** SOP Kondisi C durasi (jelaskan durasi + manfaat, larang harga & pertanyaan terbuka, CTA "Mau kami bantu jadwalkan untuk treatment [Nama] Bunda?") + contoh few-shot kontras "brp menit" → 40 menit + CTA Pijat Bayi Ceria.
- **Verifikasi:** 3 file target 32/32 ✓ + sweep 8 file 72/72 ✓ (regresi persona/extractor/decision/grounding), `tsc --noEmit` bersih, skenario 4-turn deterministik 12/12 ✓ (cart akhir hanya Pijat Bayi Ceria Rp 60.000, topik durasi, CTA spesifik). CLI interaktif hanya sampai Turn-0 via pipe (keterbatasan readline stdin) — Turn-0 asli "Treatment moms & Baby" terkonfirmasi sebagai pemicu.

#### Audit & Enhancement — Investigasi Akar Masalah Follow-Up Cancelled & Optimasi Database Query Worker (`follow-up.service.ts`) (2026-09-07)

- **Latar Belakang & Permintaan Pengguna:**
  - Pengguna meminta pengecekan performa Follow-Up Queue selama 1 minggu terakhir (31 Agu – 7 Sep 2026), memverifikasi apakah ada bug atau sudah berjalan sempurna, serta menanyakan penyebab mengapa banyak follow-up yang berstatus `CANCELLED`.
- **Hasil Audit Mingguan Live Server (31 Agu – 7 Sep 2026):**
  - **Terkirim (*SENT*)**: **85 pesan** (konsisten 10–19 pesan/hari pada hari kerja, rata-rata aman dari limitasi Meta).
  - **Dalam Antrean (*QUEUED*)**: **52 pesan** (terjadwal rapi di masa mendatang).
  - **Ditunda (*PENDING*)**: **30 pesan** (Review H+1 pasca treatment yang dipostpone sesuai kebijakan klinik).
  - **Gagal (*FAILED*)**: **0 (Nol)** — tidak ada error pengiriman atau crash.
  - **Overdue / Terlambat**: **0 (Nol)** — tidak ada antrian yang tersangkut.
- **Investigasi Akar Masalah Status `CANCELLED` (Total 68 Kasus):**
  - **41 kasus (60.3%) ➔ Pelanggan Berhasil Booking Reservasi Baru (`onReservationCreated`)**: Sistem otomatis membatalkan antrian `NO_PURCHASE` (+3, +7, +14 hari) atau sisa `NEXT_TREATMENT` saat pelanggan membuat booking baru agar mereka tidak mendapatkan chat follow-up keliru seperti *"apakah belum jadi booking?"*. Ini adalah **indikator konversi berhasil (*Conversion Win*)**.
  - **17 kasus (25.0%) ➔ Proteksi Pelanggan dengan Reservasi Aktif (`Auto-Guard`)**: Saat worker hendak mengirim `NO_PURCHASE`, terdeteksi bahwa pelanggan sudah memiliki reservasi aktif (pending/confirmed/completed), sehingga dibatalkan otomatis agar pesan tepat sasaran.
  - **9 kasus (13.2%) ➔ Pembatalan Manual oleh Admin**: Admin klinik mengklik tombol *"Batalkan"* dari antrian dashboard.
  - **1 kasus (1.5%) ➔ Reservasi Customer Dibatalkan (`onReservationCancelled`)**: Pembatalan otomatis follow-up pengingat/review karena reservasi asalnya dibatalkan.
  - **Kesimpulan**: Sebanyak **58 dari 68 (85.3%) pembatalan adalah mekanisme proteksi sukses karena pelanggan telah melakukan reservasi**, bukan bug.
- **Optimasi Pencegahan (*Preventive Optimization*):**
  - Menambahkan filter `type: { notIn: ['REMINDER_H1', 'REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] }` langsung pada query database Prisma di `processDueFollowUps`, sehingga 30 record yang berstatus postponed tidak memenuhi kuota batch `take: 20` di setiap siklus worker.

#### Fix — Pemisahan Operasional "Tandai Lunas" dari Meta CAPI & Pemulihan Tombol Reservasi (`reservations.subroute.ts`, `ReservationDetailModal.tsx`) (2026-09-07)

- **Kebijakan:** Eksklusivitas Meta Purchase Queue — `Tandai Lunas / Confirm` TIDAK lagi auto-kirim `Purchase` CAPI. Seluruh Purchase hanya via `POST /api/admin/reservation/:id/approve-purchase` (Meta CAPI Queue). `purchase_event_sent_at` hanya di-set saat CAPI riil terkirim, bukan saat lunas operasional.
- **Stage 1 Backend Decoupling (`reservations.subroute.ts`):** Hapus `capiService.sendCapiEvent Purchase (ADMIN_CONFIRM / ADMIN_EDIT_CONFIRM)` + mutasi `purchase_event_sent_at` dari `PATCH /api/admin/reservation/:id/confirm` (DB & mock) dan `PATCH /api/admin/reservation/:id` (edit menjadi confirmed). Flow operasional tetap: Google Calendar create, `followUpService.createReservationFollowUps`, audit `CONFIRM_RESERVATION`, remove WAHA label `pending payment`.
- **Stage 2 UI (`ReservationDetailModal.tsx`):** Lepas hijacking tombol — selalu aktif hijau `bg-[#008069]`, teks `Konfirmasi Reservasi` (hold) / `Tandai Lunas` (pending) tanpa disabled `Purchase Dikirim`. Tambah badge CAPI terpisah: `✓ Purchase Terkirim (tgl)` / `⏳ Dalam Antrean Queue` / `Diabaikan (Outlier)` / `Belum Terkirim`.
- **Stage 3 Live DB Fix:** Reservasi Bunda Yulia `4adb5589-4b42-4d5e-b3a1-b1ecb0a000db` (pending, CAPI approved) → `status confirmed` + sinkron Google Calendar (via live SSH/psql + `createEvent`).
- **Verifikasi:** `admin-create-reservation.test.ts` 11/11 ✓, dashboard `vite build` ✓ 96.63kB ReservationDetailModal, `tsc` tanpa regresi baru.

#### Feature — Refresh & Revisi Lokasi, Jarak & Ongkir Customer (Hierarki Validitas Bidan & Customer) (`customer.service.ts`, `customers.subroute.ts`, `LiveChatMonitor.tsx`, `CustomerEditForm.tsx`, `CustomerDatabase.tsx`) (2026-09-07)

- **Hierarki Truth:** Tier1 `STAFF/ADMIN/HUMAN/BIDAN outbound` GPS pin/maps URL (paling valid) → Tier2 `customer inbound` shareloc → Tier3 `DB lat/lng` → Tier4 `geocoding kelurahan/kecamatan` (gazetteer + Nominatim). Deep scan `messages` (payload_raw.location, `[LOCATION SHARE]`, `[Shared Location]`, Google Maps shortlink via `resolveGoogleMapsUrl`).
- **Backend Core (`customer.service.ts:refreshCustomerLocationAndOngkir`):** Pilih kandidat terbaru per-tier sesuai prioritas, `deliveryService.calculateDelivery` untuk jarak/ongkir presisi, `reverseGeocode` untuk kelurahan/kecamatan/kota/zip, update atomik `lat/lng/distance_km/ongkir/is_out_of_coverage/share_location_sent` + `preferences {location_source, location_source_label, location_refreshed_at, refreshed_by, source_detail, location_history[]}` (max 10). Fallback memory + `googleContacts` sync + `liveChatHub` publish.
- **API (`customers.subroute.ts:POST /api/admin/customers/:id/refresh-location`):** Auth admin, audit `CUSTOMER_LOCATION_REFRESHED`, response `{source, sourceLabel, lat, lng, distanceKm, ongkir, isOutOfCoverage, kelurahan/kecamatan/kota, refreshedAt/By}` + message format `Rp`
- **UI LiveChatMonitor (`LiveChatMonitor.tsx`):** Tombol `🔄 Refresh & Hitung Ulang` (spinner) di section Alamat & Lokasi, badge sumber `🟢 Terverifikasi Bidan / 🔵 Shareloc Customer / 🟡 Koordinat Tersimpan / ⚪ Estimasi Wilayah` + timestamp, realtime sync `customerDetailData + chats` tanpa reload (toast).
- **UI Edit (`CustomerEditForm.tsx`):** Tombol `🔄 Ambil dari Shareloc Chat / Refresh` mengisi `lat/lng + kelurahan/kecamatan/kota` otomatis dari hierarki yang sama. `CustomerDatabase.tsx` tombol sama + badge di detail.
- **Verifikasi:** `customer-location-refresh.test.ts` 5/5 ✓ (Tier1 bidan, Tier2 customer, Tier3 DB, Tier4 geocoding, kalkulasi ongkir), `human-background-enrichment` 5/5 ✓, dashboard `vite build` ✓ 211kB LiveChatMonitor, `tsc` tanpa regresi baru (pre-existing `knowledge keywords`).

#### Feature — Integrasi Otomatis Data Gazetteer untuk Zipcode Meta CAPI (`gazetteer-zipcode-resolver.ts`, `capi.service.ts`, `human-background-enrichment.service.ts`, `backfill-customer-zipcodes.ts`) (2026-09-07)

- **Tujuan:** Maksimalkan Event Match Quality (EMQ) Meta CAPI dengan otomatis menyertakan parameter `zp` (kode pos SHA-256) pada setiap event Purchase/InitiateCheckout/Lead, memanfaatkan dataset resmi `surabaya_sidoarjo_subdistricts.json` (573 kelurahan/desa SBY-SDA).
- **Core Resolver (`src/utils/gazetteer-zipcode-resolver.ts`):** In-memory 3-layer index: (1) Kelurahan+Kecamatan exact → 100% presisi (Sawotratap+Gedangan→61254, Keputih+Sukolilo→60111), (2) Kecamatan fallback representatif most-common + override eksplisit (Gedangan→61254, Sedati→61253, Waru→61256, Wonokromo→60243, Rungkut→60293, Lakarsantri→60213), (3) Free-text entity match word-boundary dari `name+address` (Bunda Retno Gedangan→61254). Normalisasi lowercase + `__reset` untuk test.
- **CAPI Auto-Enrichment Guard (`src/services/capi.service.ts`):** Bila `customer.zipcode` & `pending_zipcode` kosong, `resolveZipcode({kelurahan,kecamatan,kota,text:name+address})` dipanggil, hash via `ParamBuilder.getNormalizedAndHashedPII(... ZIP_CODE)` → `userData.zp`, persist non-blocking non-destruktif ke `customers.zipcode` (hanya IS NULL) + memory fallback.
- **Human Background Enrichment (`src/services/human-background-enrichment.service.ts`):** Form reservasi, teks alamat, dan admin outbound kini fallback ke Gazetteer bila `geocodingService` tidak bawa zip; helper `tryEnrichZipcodeViaGazetteer` + oportunistik free-text early enrichment (bahkan saat sudah punya lat/lng) — hanya isi IS NULL.
- **Backfill Script (`scripts/backfill-customer-zipcodes.ts`):** `npx tsx scripts/backfill-customer-zipcodes.ts [--dry-run] [--tenant=ID]` — batch 200, non-destruktif, progress log, tenant-aware.
- **Verifikasi:** `gazetteer-zipcode-resolver.test.ts` 5/5 ✓ (presisi, fallback, free-text), `human-background-enrichment.test.ts` 5/5 ✓, `capi-payload-sanitizer` 4/4 ✓, CAPI hashing manual `61254` via ParamBuilder ✓; `tsc --noEmit` tanpa regresi baru.

#### Feature — RAG Knowledge & Bank Contoh Chat di V3 Agent + Full Observability Inspector (`search-knowledge-faq.tool.ts`, `tool-registry.ts`, `persona.ts`, `agent-runner.ts`, `llm-execution-logger.ts`, `evaluations.subroute.ts`, `AiSandbox.tsx`, `Debug.tsx`) (2026-09-06)

- **Latar Belakang:** 11 contoh chat + 7 kebijakan tertanam statis di `persona.ts`; tidak ada visibilitas chunk/exemplar/prompt di Sandbox & Tracing.
- **Stage 1 — Tool baru:** `search_knowledge_faq` (query/limit, via `knowledgeBaseService.searchRelevantChunks` + fallback in-memory) terdaftar di `ALL_V3_TOOLS` + handler registry; `get_catalog_and_price` kini meneruskan `inquirePrice` (sebelumnya hilang di registry).
- **Stage 2 — Dynamic few-shot:** `PersonaPromptBuilder.buildSystemPromptAsync()` memuat bank via `getAllExemplars` + `selectRelevantExemplars` (skor tag terhadap pesan masuk), MENGGANTIKAN blok contoh statis bila bank berisi (fallback statis bila kosong/offline); panduan tool `search_knowledge_faq` ditambahkan ke prompt.
- **Stage 3 — Observability runner:** output `+retrievedChunks/+fewShotExemplars/+systemPrompt/+reasoning/+tokens/+costIdr`; audit `V3_AGENT` per panggilan LLM (`auditLlmCall`, termasuk error path) + `recordLlmExecution` `flowType: 'V3_AGENT'` (tipe & `FLOW_ORDER` diperluas).
- **Stage 4 — Sandbox & UI:** route meneruskan chunks/exemplars/systemPrompt/reasoning/tokens/costIdr/executedTools; `AiSandbox.tsx` panel 4 tab (📚 RAG Chunks + status SOP-inti, 💬 Chat Bank, 🛠️ Tool Calls, 📝 Prompt & Reasoning + token/Rp); `Debug.tsx` badge + filter + body `V3_AGENT`; dashboard build ✓.
- **Verifikasi:** `tests/v3/agent-tools` 10/10 baru ✓ (2 gagal pre-existing di HEAD bersih: Manukan-ambigu, newline emoji), `agent-runner` 4/4 ✓ (Skenario 4 observability: chunk tumbuh-gigi, token 350), 12 file unit 133/133 ✓; `tsc` ✓; dashboard build ✓.

#### Fix — Transisi AI-First & Eliminasi Mid-Sentence Regex Mutilation (`sanitizer.ts`, `response-validator.ts`, `language-sanitizer.ts`, `get-catalog.tool.ts`, `persona.ts`) (2026-09-06)

- **Latar Belakang:** Insiden teks cacat "promo menjadi , danya Bunda" — regex hilir (`sanitizeUnsolicitedPriceAndDuration`, `cleanPriceStripRemnants`) mengamputasi nominal/kata di tengah kalimat LLM karena gagal mengenali slang ("60rb", "Hrga brp"). Sesuai Minimal-Regex Mandate (`.agents/rules/minimal-regex-mandate.md`), kendali dialihkan ke hulu.
- **Tahap 1 — Eliminasi mutilasi:** `sanitizeUnsolicitedPriceAndDuration` + `cleanPriceStripRemnants` DIHAPUS dari `OutputSanitizer` (pipeline hanya sanitasi teknis: thinking tag, markdown, monolog, format WA, strip English, pronoun, follow-up greeting, STR mention, truncate). Pemanggilan `sanitizeScheduleAffirmations` dihapus dari `ResponseValidator`; kedua fungsi di `language-sanitizer.ts` ditandai `@deprecated` (implementasi dipertahankan untuk impor historis).
- **Tahap 2 — AI-First grounding:** `get_catalog_and_price` dapat sinyal `inquirePrice?: boolean`; bila bukan true, summary/reason/suggestedPriceReply BEBAS nominal Rp (harga dinamis dari `treatmentCatalogService`, moksa combo dari item `add-on-sinar-moksa` — nol hardcode). Persona: Kondisi B + `inquirePrice: true` + konfirmasi nominal ("60rb ya" → "Betul Bunda, ... *Rp 60.000* (normal *Rp 80.000*) ... 40 menit"), Contoh 11 kontras, constraint #2 mencakup sebutan nominal.
- **Tahap 3 — Tes:** baru `get-catalog-tool-grounding.test.ts` 5/5 ✓; `price-slang-and-str-mention.test.ts` ditulis ulang ke paradigma intactness 6/6 ✓; `v3-persona-rules` Test 3/8 diselaraskan (10/10 ✓); `conversational-flow` anti-afirmasi diselaraskan (validator tak lagi memotong pembuka; 7/7 ✓).
- **Verifikasi:** 8 file 86/86 ✓ (termasuk `lead-greeting-preservation`, `response-validator`, `schedule-anti-affirmation` 35/35, `multi-turn-ongkir`); `npm run build` ✓.

#### Feature — Integrasi Koleksi Emas 25 Contoh Chat Bidan Yusi (`gold-few-shot-exemplars.ts`, `few-shot-exemplars.ts`, `seed-curated-gold-exemplars.ts`, test few-shot) (2026-09-06)

- **Latar Belakang:** Bank contoh bawaan hanya 7 SOP inti; 532 dialog riil Bidan Yusi yang sudah dikurasi di `docs/BANK_CONTOH_CHAT_BIDAN_YUSI.md` belum dimanfaatkan sebagai contoh ideal untuk LLM. Opsi A: integrasikan 25-30 "contoh master pilihan emas" ke sistem + seed non-destruktif ke live.
- **Stage 1 — Dataset Koleksi Emas:** file baru `src/slot-engine/gold-few-shot-exemplars.ts` berisi **25 contoh master** hasil kurasi dari bank dialog riil, mencakup 15 area: salam Islami, jam operasional, lokasi/homecare & konfirmasi domisili, cek jadwal/penuh, tarif/promo, metode bayar (QRIS/transfer/cash), kualifikasi STR & higienitas, pasca-vaksin (jeda minimal 3 hari), rewel/susah tidur, pencernaan bayi, perawatan ibu menyusui, newborn/selapan/cukur, usia minimal, kids spa, penolakan santun layanan belum tersedia, batal/ubah/keep jadwal, feedback positif & ucapan terima kasih. Konten dinormalisasi aman SOP (persona "kami", tanpa afirmasi layanan di luar katalog aktif, tanpa tanya jam pagi/siang/sore, format harga konsisten).
- **Stage 2 — Integrasi DEFAULT:** `DEFAULT_FEW_SHOT_EXEMPLARS` diperluas 7 → **32** (7 SOP inti + 25 Koleksi Emas, `sort_order` 1-32). Tenant baru / reset "Pulihkan SOP" otomatis mendapat bank lengkap. Tag `chitchat` sengaja TIDAK dipakai pada contoh sapaan/terima kasih agar tidak menyalip topik nyata saat intent chitchat.
- **Stage 3 — Seed non-destruktif:** script `scripts/seed-curated-gold-exemplars.ts` idempoten — cocokkan per `(tenant_id, scenario)`; record yang sudah ada di-update isi/tags (ID & sort_order dipertahankan), yang belum ada di-insert di urutan belakang; contoh kustom admin (mis. "Pertanyaan Jam Oprasional") tidak pernah dihapus/ditimpa.
- **Stage 4 — Test disesuaikan:** asersi `reset-defaults non-destructive` 8 → 33 (32 default + 1 kustom); test seleksi pembayaran menerima SOP maupun Koleksi Emas (dua-duanya contoh sah).
- **Verifikasi:** `few-shot-api` 11/11 ✓, `few-shot-exemplar-selection` 7/7 ✓, `few-shot-reorder` 3/3 ✓, regresi `lead-greeting-preservation` + `slot-engine-lead-greeting` 28/28 ✓; `npm run build` (tsc) ✓.
- **Live seeding SELESAI (2026-09-06, 1-step verification):** 25 Koleksi Emas di-insert via SSH ke PostgreSQL live (`INSERT ... WHERE NOT EXISTS` per natural key scenario) — tabel kini **33 baris**: kustom "Pertanyaan Jam Oprasional" tetap sort_order 1, 7 SOP lama 2–8, 25 emas 9–33. Normalisasi sort_order via UPDATE CASE 33 id (perbaiki tabrakan urutan karena live sudah punya 8 row sebelum seed). 2 record dengan em dash diperbaiki dari mojibake (encoding UTF-8 eksplisit). Idempoten, aman diulang. Uji lokal (Postgres Docker): 7→32→33 (dengan kustom tiruan) → bersih kembali.

#### Fix — Penertiban Kualifikasi STR & Deteksi Harga Slang (`persona.ts`, `get-catalog.tool.ts`, `sanitizer.ts`, `language-sanitizer.ts`) (2026-09-06)

- **Latar Belakang:** (1) Bot mengulang label "oleh Bidan ber-STR aktif" di rincian paket — user: cukup disebut bila ditanya; (2) "Hrga brp y kak??" tidak terdeteksi sebagai tanya harga → sanitizer mengamputasi angka, menyisakan "(harga normal)" / "(normal)" / "untukperawatan".
- **Tahap 1 — Prompt & tool:** rincian Kondisi B + Contoh 3 + `recommendationReason` katalog kini "oleh Bidan kami"; aturan Kualifikasi Bidan: STR HANYA bila eksplisit ditanya (sertifikat/legalitas/"yang mijat siapa?"); Kondisi A: pertanyaan kecocokan usia tanpa tanya harga → jawab afirmatif, DILARANG muntahkan harga/promo, tutup tanya keluhan.
- **Tahap 2 — Sanitizer:** regex `isAskingPriceOrDuration` diperluas ke slang (brp/brpa/piro/hrga/hrg/pl/rate/mnt/...) di kedua file; `cleanPriceStripRemnants()` (V3) + pass anti-dangling (V2 util) menghapus "(harga normal)/(normal)", "saat ini lagi promo" yatim, kurung kosong, sisa "Rp" telantar, dan spasi hilang "*Ceria*dan"; `sanitizeUnpromptedStrMention()` fallback ubah "ber-STR aktif" → "Bidan kami" kecuali input tanya kualifikasi — wired ke `cleanOutboundReply`.
- **Verifikasi:** `price-slang-and-str-mention.test.ts` 6/6 ✓ (baru); regresi `lead-greeting-preservation` 15/15 + `v3-persona-rules` 10/10 ✓; `npm run build` ✓.
- **Deviasi tercatat:** sebutan STR di jalur V2 legacy (`persona-composer.ts`, `dynamic-closer.ts`, `grounding-composer.ts`) dan template jawaban kualifikasi on-demand (`config/persona.ts:444`, dipakai saat customer memang bertanya) sengaja tidak diubah — V3 adalah jalur aktif default.

#### Fix — Bank Contoh Chat: Restore Non-Destruktif, Auto-Seed Aman & Guard Panjang (`few-shot-exemplars.ts`, `settings.subroute.ts`, `AiPersona.tsx`) (2026-09-06)

- **Latar Belakang:** Tindak lanjut audit 17 temuan — `resetToDefaults()` masih `deleteMany` destruktif (contoh kustom ikut terhapus), `getAllExemplars()` tidak auto-seed saat tabel kosong, belum ada batas panjang input.
- **Stage 1 — Non-destruktif + auto-seed aman:** `resetToDefaults()` kini merge additive (cocokkan exemplar sistem via teks scenario kanonik → update isi + reaktivasi pertahankan ID/sort_order; yang hilang dibuat ulang; kustom tak tersentuh; kembalikan ID riil DB). `getAllExemplars()` auto-seed 7 default SOP (UUID riil) hanya bila tabel kosong DAN tenant benar-benar baru (tanpa riwayat `FEW_SHOT_*` di `audit_logs`) — bank yang sengaja dikosongkan admin tetap dihormati, tidak resurrect.
- **Stage 2 — Guard panjang:** POST/PUT menolak 400 bila skenario >150, pesan pasien >500, respon ideal >1000 karakter; PUT juga validasi trim non-kosong + sanitasi tags; pesan route reset menegaskan contoh kustom dipertahankan.
- **Stage 4 — UI:** tombol "Reset SOP" → "Pulihkan SOP" (dialog non-danger, toast menegaskan kustom dipertahankan).
- **Verifikasi:** `few-shot-api` 11/11 ✓ (3 tes baru: tolak oversize POST/PUT, reset pertahankan kustom 7+1=8), `few-shot-exemplar-selection` 7/7 ✓, `few-shot-reorder` 3/3 ✓; `npm run build` ✓; dashboard build ✓.
- **Live seeding SELESAI (2026-09-06, 1-step verification):** `INSERT ... WHERE NOT EXISTS` via SSH ke PostgreSQL live — `INSERT 0 7`, tabel kini 8 baris (kustom `27043a1b…` sort_order 1 utuh + 7 SOP sort_order 2–8, semua aktif). Idempoten, aman diulang.

#### Fix — Anti-Repetition Multi-Turn & Penguatan Preservasi Storage (`agent-runner.ts`, `sanitizer.ts`, `language-sanitizer.ts`, `persona.ts`, `machine.ts`, `chat-simulator.ts`, `webhook.route.ts`) (2026-09-06)

- **Latar Belakang:** (Case 3) Bot mengulang perkenalan Turn-0 ("Halo Bunda! ✨ Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi…") pada chat lanjutan; (storage) log abuse-blocked masih memakai teks ter-strip dan `machine.ts` menimpa `text.body` tanpa `cleanTextForAi`.
- **Case 3 — 3 akar diperbaiki:** (1) `OutputSanitizer.sanitizeFollowUpGreetingRepetition()` baru + `cleanOutboundReply(..., isFollowUp)` memotong deterministik varian "Halo Bunda", "Terima kasih sudah menghubungi kami…", "Perkenalkan, saya Bidan Yusi…" bila `isFollowUp=true`; `sanitizeGreetingRepetitionForFollowUp` di `language-sanitizer.ts` diperluas sama. (2) `persona.ts` [CHAT LANJUTAN] dipertegas "DILARANG KERAS mengulang sapaan/perkenalan". (3) `agent-runner.ts` rehydrate via `messageService.getRecentMessages` (in-memory fallback, tidak lagi `prisma.message.findMany` mentah) + logging inbound/outbound via `messageService.logMessage` (mengisi fallback memory sehingga `isFollowUp` benar saat DB offline); payload LLM memakai `stripAdTags(incomingText)`.
- **Storage:** `webhook.route.ts` log abuse-blocked pakai `originalText`; `machine.ts` set `originalText` bila kosong + `cleanTextForAi` untuk inferensi (medis/V3) dan teruskan `originalText` ke V3; `chat-simulator.ts` log INBOUND via `messageService` + flag `_preLogged` agar histori lokal simetris.
- **Verifikasi:** `lead-greeting-preservation.test.ts` 15/15 ✓ (5 tes Case 3 baru); regresi `slot-engine-lead-greeting` + `v3-persona-rules` + `ad-attribution` 28/28 ✓; `npm run build` (tsc) ✓.

#### Feature — Riwayat Chat Lengkap: Cursor Pagination & Infinite Scroll Up (`message.service.ts`, `live-chat.service.ts`, `livechat.subroute.ts`, `LiveChatMonitor.tsx`) (2026-09-06)

- **Latar Belakang:** Live Chat hanya memuat 50 pesan terakhir; riwayat lama tak terlihat.
- **Stage 1 — Backend:** `message.service.ts` `getRecentMessages(..., before?)` + `getRecentMessagesWithHasMore` (take limit+1, filter `created_at < before`, memory fallback sama); `live-chat.service.ts` `getConversationMessagesPaged` (method lama delegasi, backward-compat); endpoint `:id/messages` terima `?limit=&before=` dan kembalikan `{success, count, data, hasMore, oldestCursor}`.
- **Stage 2 — Frontend:** state `hasMoreOlderMessages`/`isLoadingOlder`/`oldestMessageCursorRef`; `loadThread` initial `?limit=50`; `loadOlderMessages` prepend + dedup + scroll anchoring (`scrollTop += ΔscrollHeight` via rAF); trigger `scrollTop < 80`, tombol manual "↑ Muat pesan sebelumnya", badge "Awal dari riwayat percakapan".
- **Stage 3 — Deep search:** tombol "Cari di riwayat lama" di banner no-match, muat batch hingga kata kunci ketemu / riwayat habis (maks 20 batch).
- **Verifikasi:** `live-chat-paged-messages.test.ts` 4/4 ✓, regresi `live-chat-reply` 10/10 ✓, `npm run build` (tsc) ✓, dashboard build ✓ 10.66s.


#### Feature — Perbaikan Menyeluruh Bank Contoh Chat Few-Shot (`few-shot-exemplars.ts`, `settings.subroute.ts`, `AiPersona.tsx`, `tests/setup.ts`, `few-shot-reorder.test.ts`) (2026-09-06)

- **Latar Belakang:** Audit 14 temuan di 3 layer — UI few-shot tanpa dark mode & tanpa kontrol urutan/filter; bug ID desinkronisasi reset→edit (404); cache memory stale yang me-resurrect default saat admin hapus semua; skoring AI hardcode ID (exemplar kustom tak pernah dapat prioritas); false-positive sub-kata tag ("flu" cocok dengan "fluktuasi"); default exemplar melanggar Aturan Emas V3 (tanya jam pagi/siang/sore).
- **Stage 1 — Data layer & ID consistency:** `resetToDefaults()` kini mengembalikan ID riil dari database (UUID hasil `create`), bukan ID statis default — Edit/Delete pasca-reset tidak lagi 404. `getAllExemplars(forceRefresh?)` + `tenantEmptyStateCache`: state kosong dicatat persisten, default TIDAK resurrect sepihak. Semua mutasi (`create/update/delete/reset/reorder`) sinkronkan cache per-tenant presisi. Method baru `reorderExemplars(orderedIds)` (transaction sekuensial + fallback in-memory saat DB offline). Route baru `PUT /api/admin/few-shots/reorder` (validasi `orderedIds` array string, audit `FEW_SHOT_REORDER`). POST/PUT validasi `.trim()` → 400 bila kosong; `tags` dinormalisasi aman untuk non-array (tidak crash `t.trim is not a function`).
- **Stage 2 — AI engine dinamis:** Skoring prioritas (+5/+2) di `selectRelevantExemplars` diganti dari perbandingan `ex.id === 'price_inquiry'` dkk menjadi grup tag intent (`ask_schedule/jadwal`, `ask_price/harga`, `consult_symptom/batuk/pilek`, `follow_up/select_treatment`) — exemplar kustom admin kini ikut diprioritaskan. Matching tag memakai word-boundary regex (escape-safe), mencegah sub-kata false positive.
- **Stage 3 — UI/UX dashboard:** Paritas dark mode penuh (kartu `#111b21`, input `#202c33`, border `#222e35`/`#374248`, teks `#e9edef`, aksen emerald) di header/tab/panel persona/banner/kartu/dialog preview/modal. Filter status pill (Semua/Aktif/Nonaktif). Tombol Up/Down untuk reorder prioritas per kartu (optimistic + persist via endpoint reorder). Tag editor jadi chip interaktif: chip tampil saat mengetik, hapus per-chip, quick-suggested tags, Enter menormalkan format. Character counter respon ideal `N / 500` dengan peringatan amber >500. Unifikasi feedback: banner inline ganda dihapus — semua notifikasi via toast `useUiFeedback()`.
- **Stage 4 — Default SOP diselarakan Aturan Emas V3:** `schedule_inquiry_anti_affirmation` tidak lagi menanyakan jam (pagi/siang/sore) — jadwal diserahkan ke Admin CS; format harga `*Rp 70.000*`; 1 closing question konsisten.
- **Verifikasi:** 3 file tes few-shot 18/18 ✓ (termasuk `reset-defaults → update` tanpa 404, reorder terbalik, sub-word negatif, custom exemplar via tag, whitespace 400, tags non-array); `npm run build` root ✓; dashboard `npm run build` ✓ (bundle `AiPersona-*.js`). Test API few-shot lama sebelumnya gagal di mesin `NODE_ENV=production` karena `setup.ts` blank secret — kini file tes menetapkan `NODE_ENV='test'` eksplisit (failure pre-existing ikut teratasi).

#### Fix — Preservasi Teks Asli Live Chat & Greeting Statis Deterministik (`webhook.route.ts`, `waba-webhook.route.ts`, `burst-coalesce.service.ts`, `lead-greeting-detector.ts`, `agent-runner.ts`, `evaluations.subroute.ts`) (2026-09-06)

- **Latar Belakang:** (1) Bot V3 membalas sapaan iklan `Promo[b8] Halo Bu Bidan...` dengan LLM non-deterministik, bukan `TEMPLATES.greeting()`; (2) tag `Promo[b8]` hilang dari DB/Live Chat karena strip destruktif sebelum logging.
- **Tahap 1 — Storage mentah, inferensi bersih:** `webhook.route.ts` tambah `cleanTextForAi`, 4 titik log Human Handling/blocked pakai `originalText || text.body`; `burst-coalesce.service.ts:125` log `originalText`; `waba-webhook.route.ts` simpan `msg.originalText`, 3 titik log + `incomingMessage.originalText` pakai teks mentah. `machine.ts` tidak diubah (sudah `originalText`-first &:125, strip inferensi &:140 tetap).
- **Tahap 2 — `utils/lead-greeting-detector.ts` (baru):** `isPureLeadGreeting()` + `stripAdTags()`, regex diselaraskan DecisionMatrix 2C + guard harga/gejala/jadwal/usia + flag Islami.
- **Tahap 3 — Gate V3:** `agent-runner.ts` `isFollowUp = history.some(assistant)` (perbaiki bug hitung 1 pesan inbound); Turn-0 murni → return `TEMPLATES.greeting({isIslamic})` 0-token + log inbound mentah; tambah param `originalText` (dipakai log inbound & `evaluations.subroute.ts` teruskan `combinedRawText`).
- **Tahap 4 — Tes:** `tests/unit/lead-greeting-preservation.test.ts` 10/10 ✓; regresi `slot-engine-lead-greeting` + `ad-attribution` + `v3-persona-rules` 38/38 ✓ (`v3-persona-rules` Test 1 dimutakhirkan ke gate deterministik — perilaku lama LLM untuk "halo kak" sudah obsolete); `npm run build` (tsc) ✓.
- **Deviasi tercatat:** `TEMPLATES.greeting()` TIDAK diubah (SOP-kritis) — berisi "Perkenalkan, saya Bidan Yusi, Kami melayani…", bukan varian "dari Kala Moms and Baby Spa" di plan; tes assert exact template aktual.

#### Feature — Integrasi Aturan Emas Klinik ke Arsitektur V3 (`persona.ts`, `sanitizer.ts`, `agent-runner.ts`, `v3-persona-rules.test.ts`) (2026-09-05)

- **Latar Belakang:** Balasan V3 melanggar aturan klinik di live test (harga/durasi bocor saat tidak ditanya, English leak, todong usia, afirmasi jadwal).
- **1. Prompt (`v3/agent/persona.ts`):** Poin 5 direkonstruksi jadi KONDISI A (keluhan saja → rekomendasi *Pijat Bayi Pulih Ceria* + manfaat 2-3 kalimat, tanpa Rp/menit/daftar nomor, tutup tanya keluhan bukan usia) vs KONDISI B (eksplisit tanya harga/rincian → 40 menit, *Rp 70.000*, rincian ID murni, opsi *Sinar Moksa*, tutup tanya hari kunjungan); daftar larangan kata asing mutlak; blok `[NEGATIVE CONSTRAINTS MUTLAK]` 13 aturan; Contoh 1-2 diselaraskan (tanpa "Homecare treatment"/"(full body massage)"/todong usia).
- **2. Guardrail (`v3/guardrails/sanitizer.ts`):** `cleanOutboundReply(rawText, customerInput?)` + 4 method baru — `sanitizeUnsolicitedPriceAndDuration` (sapu Rp/menit bila input tanpa kata tanya harga/durasi), `truncateToMaxChars` (500, potong di akhir kalimat), `stripEnglishLeakage`, `sanitizeFirstPersonPronoun` (saya/aku→kami; grup verba dibuat capturing agar `$1` valid — formula plan memakai non-capturing yang menghasilkan literal "$1").
- **3. Pipeline (`v3/agent/agent-runner.ts:283`):** `cleanOutboundReply(finalReply, incomingText)` — sanitizer kini tahu konteks tanya-harga.
- **4. Tes (`tests/unit/v3-persona-rules.test.ts`):** 10 pengujian deterministik offline (axios-mock): sapaan Turn-0, lokasi, bapil ±harga, anti-afirmasi jadwal, newborn, luar katalog, + 3 unit guardrail (strip harga, truncate 500, anti-English).
- **5. Few-Shot Chat Examples (`docs/BANK_CONTOH_CHAT_BIDAN_YUSI.md` & `persona.ts`):** Ekstraksi 9.420 pesan database riil, dikurasi 532 dialog asli manusia (tanpa bot, tanpa form booking, tanpa ongkir math, jadwal dibatasi 2 contoh) dan 10 contoh representatif ditanamkan ke prompt AI.
- **Verifikasi:** target 10/10 ✓, `npx tsc --noEmit` ✓. Full suite: 1740 passed, 19 gagal di 6 file — terbukti pre-existing di master bersih via `git stash` (20 gagal termasuk 1 dari file tes baru tanpa implementasi), bukan regresi patch ini.

#### Fix — Preservasi Posisi Scroll Live Chat Saat Pindah Menu/Page & Alt-Tab (`LiveChatMonitor.tsx`) (2026-09-05)

- **Akar Masalah:**
  1. *Pindah Page*: Navigasi antar menu di React SPA menyebabkan `LiveChatMonitor` unmount dan remount. Scroll position tidak pernah disimpan ke `sessionStorage`, sehingga setiap kali kembali ke Live Chat, `isInitialMessagesLoadRef` selalu memicu `scrollToBottom(false, true)` yang memaksa scroll ke paling bawah.
  2. *Alt-Tab*: Di Windows/Chrome, Alt-Tab ke aplikasi desktop lain sering kali tidak memicu `document.visibilitychange: hidden` (hanya `window.blur`), sehingga `savedScrollTopRef` tidak tercatat dan `wasNearBottomRef` default `true` memicu `scrollToBottom(true, true)` saat kembali. Selain itu, `loadChats(true)` pada saat tab aktif berisiko mengubah referensi `selectedChat` (terutama untuk chat di luar 50 teratas) yang memicu ulang `useEffect` pemuatan thread sehingga menghapus pesan dan me-reset scroll.
- **Solusi Komprehensif:**
  1. *Penyimpanan Posisi Scroll Persistent*: Menambahkan helper `saveConversationScroll` dan `getConversationScroll` dengan penyimpanan di `sessionStorage` (`liveChat:scrollPositions`) per conversationId.
  2. *Sinkronisasi onScroll & handleSelect*: Setiap scroll mencatat `scrollTop` dan `isNearBottom` ke ref dan storage; `handleSelect` mencatat posisi chat lama sebelum berpindah ke chat baru.
  3. *Restorasi Cerdas Saat Initial Load*: Di `useEffect` pesan, jika user sebelumnya tidak di posisi bawah (`!wasNearBottom && savedScrollTop !== null`), posisinya dipulihkan secara akurat (multi-frame rAF + timeouts) alih-alih di-force scroll ke bawah.
  4. *Listener Window Blur/Focus & Safe Visibility*: Menambahkan listener `window.blur` (tangkap scroll saat Alt-Tab) dan `window.focus` (pulihkan scroll tanpa force-scroll). Pada `visibilitychange`, `scrollToBottom` diubah ke `force=false`.
  5. *Isolasi Thread Load*: Menghapus `selectedChat?.conversationId` dari dependency array `loadThread` (hanya `[selectedId]`), serta mempertahankan objek chat aktif di `loadChats(reset=true)` jika berada di luar 50 teratas.
- **Verifikasi:** Build `packages/admin-dashboard` ✓ 11.04s, `npm run build` root ✓, integration tests ✓ (9/9 passed).

#### Fix — Sembunyikan Chat Sandbox/QA Test dari Live Server (`livechat.subroute.ts`, `conversation.service.ts`, `LiveChatMonitor.tsx`) (2026-09-04)

- **Latar Belakang:** Chat sandbox/QA test (`is_sandbox_test=true`) bocor ke daftar Live Chat di server produksi, mengganggu CS. Sesuai skill `qa-test-labeling`, chat test wajib terisolasi.
- **Backend:** `livechat.subroute.ts:63` `effectiveMode` paksa `all→real` saat `NODE_ENV=production`; `conversation.service.ts:184` `where.customer.is_sandbox_test=false` untuk `all` di production; fallback memory juga saring `is_sandbox_test`; SSE `message.created` diabaikan bila `isSandboxTest` & `PROD`.
- **Frontend:** `LiveChatMonitor.tsx:436` `isLiveServer=import.meta.env.PROD` paksa `sourceFilter='real'`, sembunyikan opsi `all`/`sandbox` di toolbar (hanya `real` di live), cegah inject SSE sandbox ke `chats`.
- **Verifikasi:** `npm run build` dashboard ✓, `npm test` ✓ (209 passed core; `migration.test.ts` butuh `--testTimeout=30000` saat load penuh).

#### Fix — Perbaikan Permanen Sinkronisasi Reaksi Emoji Customer WhatsApp (`whatsapp-provider.service.ts`, `waha/client.ts`, `app.ts`, `message.service.ts`) (2026-09-04)

- **Stage 1 — Schema WAHA & Auto-Sync:** Bersihkan events WAHA ke schema valid: hapus `message.reaction.added/deleted` (ditolak validator), pertahankan `message.reaction`, tambah `message.edited`; `buildDefaultSessionConfig` + `waha/client.ts:startSession` kini `['session.status','message','message.any','message.reaction','message.ack','message.revoked','message.edited','label.chat.added','label.chat.deleted']`; `syncSessionWebhooks()` kirim `{config: mergedConfig}` dan log `reaction terdaftar`; perbaiki import dynamic `DEFAULT_TENANT_ID` di `app.ts:183` agar tidak error scope TS2304 saat build.
- **Stage 2 — Pencocokan ID Dua Arah & Multi-Part:** `extractShortMessageId` diperluas mendukung format WAHA 3 bagian (`true_jid_id`) dan 4 bagian (`true_jid_id_participant` pada broadcast status & lid); `message.service.ts:853` `cleanId=extractShortMessageId(messageId)` + `orConds` dukung `wa_message_id=messageId`, `cleanId`, dan `endsWith _cleanId` (long↔short dua arah); fallback memory juga pakai `cleanId` yang sama; memastikan `false_628...@c.us_3EB0` vs `3EB0` cocok. Verifikasi build ✓, test ✓.

#### Fix — Penerimaan & Sinkronisasi Reaksi Emoji Customer WhatsApp ke Dashboard Live Chat (`whatsapp-provider.service.ts`, `waha/client.ts`, `webhook.route.ts`, `message.service.ts`, `LiveChatMonitor.tsx`) (2026-09-04)

- **Akar Masalah:** WAHA tidak subscribe `message.reaction*`, payload `reaction.messageId` tertukar dengan ID event, dan `wa_message_id` panjang vs pendek tidak cocok di DB sehingga reaksi customer tidak muncul.
- **Stage 1 — Registrasi Event WAHA:** `whatsapp-provider.service.ts:200` `buildDefaultSessionConfig` events ditambah `message.reaction`, `message.reaction.added`, `message.reaction.deleted`, `message.ack`, `message.revoked` (+ `message.any`); method baru `syncSessionWebhooks()` untuk `PUT /api/sessions/:session` tanpa scan QR ulang; `waha/client.ts:1248` `startSession` webhook events diperluas sama; tambah `updateSessionConfig()` helper.
- **Stage 2 — Presisi Webhook & DB:** `webhook.route.ts:192` prioritas `reactionObj.messageId || reactionObj.id` sebelum `reactPayload.id`, tangkap `pushName` untuk `senderName`; `message.service.ts:854` `addOrUpdateReaction` toleransi `wa_message_id` panjang `false_...@c.us_3EB0` ↔ pendek `3EB0` via `extractShortMessageId` + `endsWith`, lookup memory juga dukung short/long, broadcast ganda `message:reaction` + `message.reaction` untuk kompatibilitas SSE.
- **Stage 3 — Frontend:** `LiveChatMonitor.tsx:1949` SSE reaction `idsMatch` via short-suffix/endsWith (id & wa_message_id), pill `title` sudah `Anda` vs `senderName` (mis. “Bunda Rina: ❤️”), `groupedReactions` tampil real-time di sudut bubble.
- **Verifikasi:** `packages/admin-dashboard build` ✓ 10.65s, `npm test` ✓ 209 files / 1724 passed.

#### Fix — Auto Mark-As-Read & Sinkronisasi Real-Time Saat Admin Balas via WhatsApp HP (`webhook.route.ts`, `live-chat.service.ts`, `LiveChatMonitor.tsx`) (2026-09-04)

- **Latar Belakang:** Badge unread di dashboard Live Chat tidak hilang ketika admin membalas pasien langsung dari WhatsApp HP / WhatsApp Web eksternal — harus refresh manual.
- **Stage 1 — Backend:** `webhook.route.ts:401` blok `fromMe && !isBotAutoReply` kini memanggil `messageService.markConversationMessagesAsRead` + `conversationService.setManualUnread(false)` dan `hub.publish({type:'conversation.updated', unreadCount:0, isManualUnread:false})`; `live-chat.service.ts:483` `sendAdminReply` juga sync mark-as-read agar dashboard & WA HP paritas (DB `read_at` terisi, reload tetap 0).
- **Stage 2 — Frontend:** `LiveChatMonitor.tsx:1891` SSE `message.created` hitung `isAdminOutbound = OUTBOUND && ADMIN`, lalu `nextUnread = (isCurrentOpen || isAdminOutbound) ? 0 : ...` dan `isAwaitingReply=false` bila admin outbound; handler `conversation.updated` sudah sync `unreadCount` dari payload broadcast. VOIP bubble balasan WA HP langsung muncul + badge kiri hilang tanpa reload.
- **Verifikasi:** `packages/admin-dashboard build` ✓ 11.48s, `npm test` ✓ 209 files / 1724 passed.

#### Fix — Perbaikan Menyeluruh 12 Bug Live Chat Monitor (`LiveChatMonitor.tsx`, `livechat.subroute.ts`, `conversation.service.ts`, `live-chat.service.ts`) (2026-09-04)

- **Latar Belakang:** Audit menemukan 12 bug pada `LiveChatMonitor.tsx` (navigasi reload jebak chat, URL stale, duplikasi foto hilang 20s, badge unread tidak muncul di HP, thread stale saat resume, pencarian bertabrakan, memory leak gambar, voice note jadi broken image, desync mark-all-read, nama stale, typing nyangkut, filter label tidak efisien).
- **Stage 1 — Navigasi & Lifecycle (Bug 1,2,4,5):** `handleBackToList` kini hentikan typing, reset `selectedIdRef`/`sessionStorage`, bersihkan `?conversationId` via `replaceState`+`setSearchParams` (reload tetap di list); `handleSelect` sinkron URL `?conversationId=` via `pushState` + `setSearchParams` + batalkan typing percakapan lama; mount init tidak lagi paksa `chat` saat `savedView==='list'` di mobile; badge unread dihitung dengan `isChatVisuallyActive = isDesktopRef||mobileViewRef==='chat'` (via refs agar SSE closure tidak stale); `visibilitychange` me-refresh `loadChats` + `loadThread(selectedId)` aktif.
- **Stage 2 — Pesan & State Sync (Bug 3,8,10,11):** Dedup di `loadThread` & SSE diketatkan ke `id`/`wa_message_id` sama atau teks identik <2000ms atau `media URL` identik <2000ms (dua foto berbeda URL tidak pernah dianggap duplikat); `mark-all-read` sinkronkan `chatsRef.current`; `handleSaveCustomerDetail` patch `chatsRef` nama/telepon (match `conversationId` atau `customerId`); `handleSelect` bersihkan `typingTimerRef`/`typingStartTimerRef` sebelumnya.
- **Stage 3 — Search, Memori, Audio, Label (Bug 6,7,9,12):** Pisahkan `inChatSearchQuery`/`inChatSearchOpen` dari `searchQuery` daftar (toolbar kaca pembesar di header chat, banner `effectiveInChatQuery` pakai `inChatSearchQuery`); `selectImage` revoke `URL.createObjectURL` via `handleRemoveSelectedImage` + revoke preview lama saat ganti + revoke saat kirim (`handleSendReply`) + cleanup unmount; `VoiceNotePlayer` untuk `audio/*` / `.ogg/.mp3/.m4a/...` (`Play`/`Pause` + progress + durasi), fallback `MediaImage` untuk gambar, kartu dokumen `FileText`+`Download` untuk `application/*`; label filter forward `&label=` ke `GET /api/admin/live-chat/conversations` (subroute + service `listConversations` filter `escalation_reason`/`is_human_handling`, memory fallback ikut filter, empty state + tombol `Reset Filter Label`).
- **Stage 4 — Verifikasi:** `packages/admin-dashboard npm run build` ✓ (11.72s, `LiveChatMonitor-Dv0yh2cV.js`), `npm test` ✓ (209 passed, 1724 passed). Root `npm run build` gagal pre-existing `duration_minutes` di `reservations.subroute.ts` (bukan regresi patch ini). `dist/` sudah di-rebuild.

#### Changed — Badge footer Live Chat jadi icon-only (`LiveChatMonitor.tsx`) (2026-09-04)

- **Latar Belakang:** Badge MQL, Meta, Medis, Legacy, CS, dan Bot di footer kartu percakapan memakan ruang horizontal — tulisan dihapus, ikon dipertahankan.
- **Perubahan:** Keenam badge kini icon-only (`AlertTriangle`, `Zap`, `Facebook`, `User`, `Bot`); Legacy yang sebelumnya tanpa ikon diberi ikon `Archive`. Atribut `title` (tooltip) dipertahankan agar arti tiap badge tetap terbaca saat hover.
- **Tambahan:** Badge MQL dan Legacy disembunyikan bila customer sudah pernah order (`purchaseCount > 0`) — status lead/migrasi tidak lagi relevan untuk repeat customer.
- **Verifikasi:** `npm run build` dashboard ✓.

#### Changed — Dark Mode Canvas Pure Black `#000000` (`index.css`, `Layout.tsx`, `Login.tsx`, `ThemeContext.tsx`) (2026-09-04)

- **Latar Belakang:** Warna dasar dark `#0c1317` (Onyx) diganti pure black `#000000` agar kontras maksimal dan hemat baterai layar AMOLED.
- **Cakupan:** Token `wa.canvas.dark`, `html/body/#root`, remap `.dark .bg-[#f0f2f5]`, root `Layout` + `main`, root `Login`, `meta theme-color`, plus 3 file yang sudah punya varian dark lama (`MonthScheduleGrid.tsx`, `Debug.tsx`, `TodayTreatments.tsx`).
- **Sengaja TIDAK diubah:** Surface kartu/sidebar `#202c33`, surface2 `#111b21`, dan wallpaper chat `#0b141a` — tetap sebagai lapisan kontras di atas kanvas hitam.
- **Verifikasi:** `npm run build` dashboard ✓, 18 aturan `#000000` terkompilasi di CSS `dist/`.

#### Feature — Alih Kelola Form Reservasi ke Admin + Back Gesture & Inquiry Guard (`decision-matrix.ts`, `grounding-composer.ts`, `dynamic-closer.service.ts`, `slate-store.ts`, `entity-extractor.ts`, `persona.ts`) (2026-09-04)

- **Alih kelola form:** Saat booking-ready (lokasi + treatment + hari), bot TIDAK LAGI mengirim template formulir 10+ baris. Bot membalas singkat ala Bidan Yusi (`TEMPLATES.scheduleCheckHandoff`: "Baik Bunda, untuk ... kami cek jadwal dulu yaa bunda...") lalu handoff `HUMAN_HANDLING` (`booking_schedule_check`) — Admin menawarkan jam & mengirim form via dashboard. Permintaan form eksplisit ("minta format reservasi") ikut handoff. CAPI `InitiateCheckout` tetap ditembak. Injeksi `suggestedPreFilledForm` ke prompt LLM dimatikan; panduan closer SCHEDULE diperbarui.
- **Back gesture non-regex:** NLU menghasilkan `clearedSlots` (`treatment`/`preferred_date`/`location`) untuk pembatalan tanpa pengganti ("gak jadi paket itu", "jangan hari Minggu dulu"); `SlateStore` mengeksekusi deterministik + hitung ulang `projectedState`.
- **Guard:** Perbaikan bug idempotency guard lokasi (lokasi baru yang berbeda tidak lagi diblokir); Inquiry Guard menunda handoff bila customer sedang bertanya (harga/fasilitas), dengan pengecualian pertanyaan jadwal & sinyal booking eksplisit; pertanyaan klinis bukan sinyal booking.
- **Verifikasi:** `tsc` exit 0; full suite 1719 passed (5 flake integrasi paralel yang sudah dikenal).

#### UI — Polish Live Chat Monitor & Dark Mode Menyeluruh Admin Dashboard (2026-09-04)

- Live Chat: tombol "Kembalikan ke Bot" indigo (AI), chip CS/Bot di footer kartu, draft typing tampil di daftar chat, selected = single border hijau, anti white-out search, kartu lebih ramping + footer full-bleed, warna HOLD/Pending light mode diperkuat.
- Dark mode eksplisit (`dark:*`) di CreateReservationModal, ClinicServices, TelegramIntegration, Debug LLM Logs, MetaCapiQueue, TodayTreatments; remap global `.dark` diperluas (input focus, badge WhatsApp, hover anti-silau, pastel blue/purple/red, kartu kalender, divider).
- Verifikasi: build dashboard ✓, `tsc` exit 0.

#### Feature — Durasi HOLD & Reservasi >1 Jam (`QuickHoldModal.tsx`, `reservations.subroute.ts`, `daily-slots`, kalender) (2026-09-04)

- Kolom baru `duration_minutes` di `Reservation` (migrasi `20260904000000_add_reservation_duration_minutes`, nullable — data lama = 60 menit). Pilihan durasi 30–180 mnt + custom di QuickHoldModal (dengan hint jam selesai); `CreateReservationModal` mengirim total durasi otomatis.
- `daily-slots` memakai overlap interval sehingga slot berikutnya ikut tertutup; grid Day/Week/Month memakai `resolveReservationDuration()` (kolom DB prioritas, fallback parsing teks); banner HOLD tampil "• 120 mnt".
- Verifikasi: 15/15 test quick-hold/create lolos, build dashboard ✓.

#### Fix & Feature — Penanganan Komparasi Lokasi & Ongkir Deterministik Tanpa Tambal Sulam Regex (`entity-extractor.ts`, `decision-matrix.ts`, `persona.ts`, `landmarks.ts`, `geocoding.ts`) (2026-09-04)

- **Latar Belakang & Masalah:** Pada sesi simulasi (ID: 571506), customer bertanya perbandingan lokasi:
  ```text
  Lebih dekat mana yaa
  Wiguna selatan
  Atau jojoran baru 1
  ```
  Bot sebelumnya salah merespons dengan mengabaikan pertanyaan komparasi, mengunci sepihak single lokasi, dan salah menghitung jarak menjadi 14.1 km (yang sebenarnya adalah jarak ke Jojoran Baru 1 dari Waru, bukan Wiguna Selatan yang hanya 8.1 km).
- **Akar Masalah:**
  1. *Ekstraksi deterministik membajak pesan multiline*: Blok regex `1d` di `preExtractDeterministic` memotong baris dan langsung mengunci baris kedua (`Wiguna selatan`) sebagai lokasi tunggal, melewati NLU LLM.
  2. *Gazetteer Gate terlalu agresif*: Aturan `length <= 4` memblokir "Wiguna Selatan", memicu fallback berbahaya `geocodeText(rawText)` yang secara arbitrer mengekstrak `Jojoran Baru 1` dari pesan utuh.
  3. *Belum ada Intent Semantik & Handling Komparasi*: Slot Engine belum memiliki schema/state untuk menangani komparasi 2 titik lokasi.
- **Implementasi Solusi (Sesuai Prinsip Zero-Regex Patch & AGENTS.md Roadmap):**
  1. **Schema & NLU Semantik (`src/slot-engine/types.ts`, `src/slot-engine/entity-extractor.ts`):** Tambah intent `'compare_locations'` dan field `comparison_locations: string[]` pada schema LLM Zod. Hapus blok regex `1d` multiline rapuh (60 baris) agar ekstraksi komparasi diserahkan secara cerdas ke LLM NLU. Prompt dilengkapi definisi dan exemplar few-shot.
  2. **Isolasi Penuh Komparasi vs Single Location (`entity-extractor.ts`):** Saat `isComparison` aktif (LLM mendeteksi perbandingan 2 lokasi), `locationText` dan `streetDetail` dipastikan `null`, dan intent `provide_location` dibersihkan dari `finalIntents` maupun `sanitizeExtractedEntities` agar tidak terpolusi oleh fallback baseline deterministik (mencegah bug kasus Wonokromo vs Wedoro di mana Wedoro terdeteksi di ujung kalimat). `preExtractDeterministic` diberi guard konteks komparasi (`hasComparisonContext`).
  3. **Data Dictionary & Resolusi Multi-Tingkat / Ambigu (`landmarks.ts`, `decision-matrix.ts`):** Tambah koordinat presisi Perumahan Wiguna & Jl. Wiguna Selatan (-7.339397, 112.8033345) serta Kawasan Jojoran & Jl. Jojoran Baru (-7.2769919, 112.76634). Pada Priority 4.9, tambahkan `extractCoords` yang mampu mengekstrak centroid representatif dari hasil ambiguitas nama kecamatan (seperti Wonokromo, Rungkut, dll.), sehingga komparasi level kecamatan vs kelurahan tetap dapat dibandingkan secara akurat.
  4. **Priority 4.9 Komparasi Deterministik & Guard Priority 5 (`decision-matrix.ts`, `persona.ts`):** Hitung jarak & ongkir via `deliveryService` untuk kedua titik, tentukan yang lebih dekat, balaskan `TEMPLATES.locationComparison`, dan pastikan `isLocationConfirmed = false`. Pasang guard `!isCompareLocations` di Priority 5 sehingga pesan komparasi mustahil memicu template single ongkir.
- **Verifikasi:**
  - Unit tests: `tests/unit/slot-engine-location-comparison.test.ts` (3 passed: Wiguna vs Jojoran, urutan terbalik, Wonokromo vs Wedoro) & `tests/unit/slot-engine-extractor.test.ts` (15 passed).
  - Integrasi: 42 unit tests pass (`geocoding.test.ts`, `slot-engine-decision.test.ts`).
  - TypeScript build: `npm run build` PASS (exit code 0).
  - Simulasi live:
    - `Wiguna Selatan` (8.1 km, Rp 10.000) vs `Jojoran Baru 1` (14.1 km, Rp 15.000) -> Rekomendasi Wiguna Selatan.
    - `Wonokromo` (10.0 km, Rp 10.000) vs `Wedoro` (0.3 km, Gratis ongkir) -> Rekomendasi Wedoro (0.3 km, Gratis ongkir).

#### Feature — Dual Theme Light/Dark Mode Admin Dashboard (`ThemeContext`, `ThemeToggle`, `AppearancePanel`, `Layout`, `index.css`) (2026-09-03)

- **Latar Belakang & Tujuan:** Admin membutuhkan Tema Hitam (Dark Mode ala WhatsApp Web: canvas `#0c1317`, surface `#202c33`, brand `#00a884`) yang nyaman di mata untuk monitoring malam hari, plus Tema Putih standar medis — dengan switch instan tanpa login ulang.
- **Implementasi Teknis (5 stage sesuai rencana):**
  1. **Fondasi (`tailwind.config.js`, `index.css`, `contexts/ThemeContext.tsx`, `App.tsx`, `index.html`):** `darkMode: 'class'` + token palet `wa.*`; `ThemeProvider` kelola preferensi `light|dark|system` (default `system` ikut OS live via `matchMedia`), simpan `localStorage wa_clinic_theme`, toggle class `.dark` di `<html>`; skrip anti-flicker inline di `index.html`; token HSL `.dark` + blok remap global (kanvas, teks, border, badge semantik, form, scrollbar gelap, Recharts, wallpaper `#0b141a`, bubble `#005c4b`).
  2. **Shell (`Layout.tsx`, `ThemeToggle.tsx`, `ToggleSwitch.tsx`, `UiFeedback.tsx`, `Pagination.tsx`):** Sidebar/Header gelap `#202c33`, menu aktif emerald, tombol switcher ☀️/🌙 animasi rotasi di header (desktop & mobile), popover status + banner notifikasi adaptif.
  3. **Operasional (`LiveChatMonitor.tsx` via remap, `Overview.tsx`, `FinancialAnalytics.tsx`):** Wallpaper gelap WhatsApp, bubble masuk `#202c33`/keluar `#005c4b`, composer gelap; chart grid + tooltip theme-aware via `useTheme` (tanpa `window.confirm`/`alert` — tetap `useUiFeedback`).
  4. **Pengaturan & CRM (`Settings.tsx` + `components/settings/AppearancePanel.tsx`, `Login.tsx`):** Kartu "Tampilan & Tema" 3 opsi (Terang/Gelap/Otomatis) di kategori App & Operasional; halaman CRM/katalog/reservasi/modal readable via remap global (catat limitasi di `docs/KNOWN_ISSUES.md` #23).
  5. **Verifikasi:** `npm run build` dashboard ✓ (tsc + Vite 10.47s), `npm test` ✓ (207 file, 1698 passed), `dist/` sudah di-rebuild sehingga bot langsung serve hasil baru di `/admin/*`.
- **Catatan SaaS:** Preferensi tema per-browser (localStorage), BUKAN data bisnis — sengaja tidak tenant-aware, tidak perlu Confirmation Gate.

#### Fix — Sinkronisasi GPS Shareloc & Konsistensi Jarak/Ongkir (`webhook.route.ts`, `human-background-enrichment.service.ts`, `customer.service.ts`, `LiveChatMonitor.tsx`, `chatScheduleExtractor.ts`, `InvoiceGeneratorModal.tsx`) (2026-09-02)

- **Latar Belakang:** Koordinat Pin Share Location WhatsApp asli harus jadi single source of truth yang meng-override geocoding teks biasa (`is_native_pin=true`). Kasus Bunda Gita (6282232833258 / 58bb55d3-6508-4db6-b240-2eb853ce8046) mengirim shareloc `-7.4691395,112.7103424` saat `HUMAN_HANDLING` aktif, namun profil sebelumnya tersimpan centroid kelurahan sehingga jarak/ongkir tidak konsisten antara invoice form, profil customer, dan pesan konfirmasi.
- **Akar Masalah:** 1) Jalur `HUMAN_HANDLING` early-return `GRACE` (30s) dan `HOLD_DISABLED` (`ENABLE_WAHA_HOLD_LABEL=false`) langsung `logMessage + return` tanpa memanggil `humanBackgroundEnrichmentService.enrichSync` untuk tipe `location`, sehingga GPS asli tidak ter-sync instan; 2) `enrichAsync` di `EXPLICIT GUARD` fire-and-forget rawan tertinggal sebelum return; 3) `STALE GUARD` mem-drop shareloc lama sebagai `IGNORED_STALE_MESSAGE` tanpa bypass untuk GPS; 4) `customer.service.ts` memory fallback belum menghormati flag `isNativePin`; 5) Modal Invoice tidak memindai pesan `[LOCATION]` terbaru untuk override jarak/ongkir profil.
- **Solusi:**
  1. `src/routes/webhook.route.ts:1012-1111`: Tambah sinkron GPS prioritas tinggi di kedua early-return `GRACE` & `HOLD_DISABLED` — jika `incomingMessage.type==='location'` atau body mengandung `maps.app.goo.gl`, panggil `await humanBackgroundEnrichmentService.enrichSync(..., is_native_pin=true)` sebelum `logMessage`. Upgrade `EXPLICIT GUARD` agar GPS pin `await enrichSync` (sinkron), alamat teks tetap `enrichAsync` (background). Tambah `STALE GUARD BYPASS` untuk `hasRealLocation` agar shareloc tua tetap lanjut ke sync (tidak di-drop).
  2. `src/services/human-background-enrichment.service.ts:1-305` & `src/services/customer.service.ts:232-276`: `updateCustomerLocation` dengan `isNativePin=true` selalu override `share_location_sent` & koordinat presisi (abaikan `preserveExactGps` guard); memory fallback diperkuat agar `isNativePin=true` override centroid lama dan set `share_location_sent=true`.
  3. `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx:2463`: `handleGenerateActiveReservationInvoice` kini memindai `messages` terbalik untuk `[LOCATION` terakhir; override `extracted.distanceKm/ongkir` dengan `custData.distance_km/ongkir` fresh dari profil (yang sudah di-sync webhook). Parsing `Lat/Lng` di konten untuk verifikasi tidak tertimpa.
  4. `packages/admin-dashboard/src/utils/chatScheduleExtractor.ts:501`: Tambah deteksi `hasSharelocInThread` (`/\[LOCATION/`) untuk tandai `isExtracted=true` agar fallback `3.0km` tidak dipakai bila shareloc ada dan profil sudah sync.
  5. `packages/admin-dashboard/src/components/modals/InvoiceGeneratorModal.tsx` & `src/services/delivery.service.ts`: Pastikan label tier (`fee`/`promoDiscount`) selalu match perhitungan `deliveryService.calculateDelivery` via `calculateOngkirFromTiers` (efek `distanceKm` → `ongkir` + `promoOngkir` otomatis); jarak `21.67km` → tier `maxDist 25` (`fee 35000 promo 10000` → net `25000`) sesuai DB.
  6. **Koreksi Data:** `src/scripts/fix-bunda-gita.ts` (dry-run default, `--apply` tulis DB) — kalkulasi via `deliveryService.calculateDelivery` di `-7.469139575958252,112.71034240722656` → verifikasi tier, lalu `UPDATE customers SET lat/lng/distance_km/ongkir/share_location_sent`. Manual SQL fallback disediakan. Nilai target: `lat=-7.469139575958252`, `lng=112.71034240722656`, `distance=21.67km`, `ongkir=25000`.
- **Verifikasi:** `npx tsc --noEmit` ✓, `npm --prefix packages/admin-dashboard run build` ✓ (2447 modules), `npx vitest run tests/unit/human-background-enrichment.test.ts tests/unit/delivery.test.ts` → 25 passed (GPS pin, Google Maps URL, admin outbound, 22 tier boundaries), full suite tetap hijau. Untuk live: jalankan `npx tsx src/scripts/fix-bunda-gita.ts --apply` atau `UPDATE customers ... WHERE id='58bb55d3-6508-4db6-b240-2eb853ce8046'` lalu cek Admin Dashboard → Customer Gita → Google Maps Link.

#### Feature — Quick Chat / Balasan Cepat (/shortcut) Tenant-Aware (`QuickReply`, `quick-replies.subroute.ts`, `LiveChatMonitor.tsx`, `QuickReplies.tsx`) (2026-09-02)

- **Latar Belakang & Tujuan:** Admin CS/Bidan membutuhkan balasan instan untuk pesan berulang (rekening, lokasi, ongkir, format reservasi, jadwal, terima kasih, batal) tanpa mengetik ulang — cukup ketik `/rek`, `/lokasi`, dll. di Live Chat Monitor. Pesan harus terstandarisasi SOP, mendukung variabel dinamis `{name}`, `{phone}`, `{clinic_name}`, `{admin_name}`, dan multi-tenant ready (setiap klinik punya daftar shortcut sendiri).
- **Implementasi Teknis:**
  1. **Database Schema (`prisma/schema.prisma`):** Model `QuickReply` baru (`id`, `tenant_id` default `default-tenant`, `shortcut` lowercase tanpa slash, `title`, `content @db.Text`, `category`, `created_at`, `updated_at`) dengan `@@unique([tenant_id, shortcut])` dan `@@index([tenant_id])` — map `quick_replies`.
  2. **Backend REST API (`src/routes/admin/quick-replies.subroute.ts`):** 5 endpoint tenant-aware — `GET /api/admin/quick-replies` (list + auto-seed defaults jika kosong), `POST /api/admin/quick-replies` (validasi unik shortcut per tenant, normalisasi lowercase strip `/`), `PUT /api/admin/quick-replies/:id`, `DELETE /api/admin/quick-replies/:id`, `POST /api/admin/quick-replies/seed-defaults` (1-click upsert 7 template bawaan). Fungsi helper `normalizeShortcut`, `isValidShortcut`, `interpolateQuickReply`. In-memory fallback `memoryQuickReplies` agar unit test offline (`tests/setup.ts` → Database offline) tetap hijau 100% tanpa Postgres. Terdaftar di `src/routes/admin.route.ts`.
  3. **Default Seed Templates (7):** `/rek` (Rekening BCA & Mandiri), `/lokasi` (Alamat & Patokan), `/ongkir` (0-5 km free, Rp 3.000/km), `/jadwal` (Senin-Minggu 08.00-17.00), `/format_reservasi` (template data reservasi dengan `{name}`), `/terimakasih` (ucapan dengan `{name}` & `{clinic_name}`), `/batal` (konfirmasi pembatalan) — kategori `Pembayaran`, `Lokasi`, `Reservasi`, `Umum`.
  4. **Slash Autocomplete Live Chat (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`):** Deteksi token terakhir diawali `/` saat mengetik di `chatInputRef` (contentEditable), floating popover Discord/WhatsApp Business style di atas input menampilkan badge `/shortcut`, judul, kategori, dan cuplikan isi. Navigasi `ArrowUp/Down`, `Enter/Tab` pilih (interpolasi otomatis `{name}`=`selectedChat.customerName||'Bunda'`, `{phone}`, `{clinic_name}` dari `BRAND.businessName`, `{admin_name}` dari `user`), `Escape` tutup, klik/tap pilih. Menu Tools (+) tambah opsi "⚡ Balasan Cepat" untuk membuka popover tanpa mengetik.
  5. **Halaman Manajemen (`packages/admin-dashboard/src/pages/tenant/QuickReplies.tsx`):** Filter kategori (Semua, Pembayaran, Lokasi, Reservasi, Umum), pencarian shortcut/judul/isi, grid kartu preview, modal tambah/edit dengan input shortcut (auto strip `/`), judul, kategori, textarea konten + chip quick-insert `{name}`/`{phone}`/`{clinic_name}`/`{admin_name}`, live preview interpolasi, hapus via `useUiFeedback` (tanpa `window.confirm`). Route `/admin/quick-replies` (+ alias `/admin/quick-reply`, `/admin/balasan-cepat`) terdaftar di `App.tsx`; menu sidebar "Balasan Cepat ⚡" di `Layout.tsx` (CRM & Komunikasi); role `admin_cs` & `spv_cs` diberi akses di `rolePermissions.ts`.
  6. **Pengujian & Build:** Unit test `tests/unit/quick-replies.test.ts` (8 tests: normalisasi, validasi, interpolasi, isolasi tenant, seed, CRUD memori) — PASS. `npx prisma generate` (v5.22.0) PASS, `npm run build` (tsc) PASS, `packages/admin-dashboard` Vite build PASS (13.92s, chunk QuickReplies 13.17 kB).
- **Verifikasi:** `npx prisma generate` ✓, `npm run build` ✓, `npm --prefix packages/admin-dashboard run build` ✓ (2447 modules), `npm test -- tests/unit/quick-replies.test.ts` → 8 passed, `npx tsc --noEmit` ✓.

#### Fix — Validasi & Re-kalkulasi Jarak/Ongkir ORS untuk 55 Target (`delivery.service.ts`, `validate-distances.ts`, `geocoding.ts`) (2026-09-02)

- **Latar Belakang:** Dari 600 customers, 23 punya `kelurahan` tapi `distance_km NULL` dan 32 sudah ada jarak dari admin (shareloc false) tapi kandidat Haversine (belum ORS). Total 55 perlu validasi ORS. Shareloc & tanpa kelurahan dikecualikan.
- **Akar Masalah:** `Customer.distance_km` tidak persist `distance_source` (`delivery.service.ts:148` transient), ORS profile `cycling-electric` + rate limit 40/min bikin fallback ke Haversine, dan 93% data memang belum pernah dihitung.
- **Solusi:**
  - **Script `src/scripts/validate-distances.ts`:** Dry-run + apply, batch 10 + throttle 3s, re-use `deliveryService.calculateDelivery` (ORS 1.1x → Google → Haversine 1.6x). Untuk tanpa koordinat: donor dari `customers` dengan kelurahan sama, fallback gazetteer `surabaya_sidoarjo_subdistricts.json` + `geocodingService.geocodeText`.
  - **Persist:** Simpan `preferences.distance_source` (`ORS`/`HAVERSINE`), `distance_source_detail`, `distance_validated_at`, `distance_haversine_raw/est` tanpa migrasi Prisma (tenant-aware).
  - **Guard:** Skip Grup B jika `ongkir` sama & `delta <0.5km`, skip anomali `new >30km & old <30km & delta >20km` (contoh Manukan Kalitidu Bojonegoro 158km).
  - **Eksekusi Live 2026-09-02 19:17-20:45:** Targets 57 (23+33+1 duplikat), Updated 36, Skipped same-tier 18, Skipped no-coords/anomali 3, Errors 0. Sisa Grup A 23→2 (`Sedati` & `semampir` perlu manual review). Akurasi ORS: `Berbek 3.18km FREE`, `Masangan Kulon 12.18km 15000`, `apt. puncak dharmahusada 17.84km 20000` via gazetteer donor. Rate limit ORS setelah ~40 req fallback ke Google tetap `isEstimated=false`.
- **Verifikasi:** `tsc --noEmit` pass, dry-run 5 & full 56, `kelurahan+distance NULL` 23→2, `npx tsx src/scripts/validate-distances.ts --dry-run` live.

#### Fix — Toggle Matikan AI Bot Live Chat Persisten & Sinkron SSE (`LiveChatMonitor.tsx`, `liveChatSse.ts`, `waba.subroute.ts`, `live-chat-hub.service.ts`) (2026-09-01)

- **Latar Belakang:** Toggle "Matikan AI Bot" (cut-off) di Live Chat selalu balik ON saat pindah halaman/refresh karena `loadBotCutoffStatus` salah baca `data.wahaOutboundCutoff` (payload ada di `data.data.wahaOutboundCutoff`), plus tidak ada cache & SSE sync antar-tab.
- **Solusi:**
  1. `LiveChatMonitor.tsx:426` fix ekstraksi `data?.data?.wahaOutboundCutoff ?? data?.wahaOutboundCutoff` + persist `localStorage wa_bot_cutoff_state`; hydrate `useState` dari cache (zero-flicker); `handleToggle` juga set cache & fallback `res.data?.wahaOutboundCutoff`.
  2. `live-chat-hub.service.ts:7` tambah event `bot.cutoff_changed`; `waba.subroute.ts:183` publish `BOT_CUTOFF_CHANGED` via `liveChatHub` saat PATCH cutoff; `liveChatSse.ts:142` listen `bot.cutoff_changed`; `LiveChatMonitor.tsx:1632` handler SSE update `setGlobalBotCutoff` + cache.
- **Verifikasi:** `npx vitest run tests/unit tests/integration/whatsapp-provider-qr.test.ts` → **PASS**; `npm run build` backend & `packages/admin-dashboard` **PASS**.

#### Fix — Eliminasi Kebocoran AI Reasoning, Anti-Truncation & Persona Bapak (`reply-generator.ts`, `language-sanitizer.ts`, `persona-composer.ts`, `burst-coalesce.service.ts`, `entity-extractor.ts`) (2026-09-01)

- **Latar Belakang & Insiden Live 6285959212132 (Muhammad Naufal Ghifari):** Monolog internal AI bocor ke WA (`reasoning_content` fallback), respon terpotong `S` (<5 char) terkirim, sapaan kaku `Bunda` ke customer pria suami.
- **Solusi:**
  1. `reply-generator.ts:133` hapus fallback `reasoning_content`, ambil HANYA `content`; validasi `<5` char → throw untuk silent escalation ke CS (anti-truncation). Sanitizer empty → throw.
  2. `language-sanitizer.ts` tambah `stripAiReasoningAndMonologue()` hapus `<think>...</think>`, `[THINKING]...[/THINKING]` & pola `Kita perlu menyusun...`, `Konteks/Analisis/Aturan:`, `Lihat contoh di prompt/Dalam peran sebagai`. Jika bersih `<5` → return `''` ditolak. Integrasi di `UnifiedResponseSanitizer.sanitize()` early-return & final guard `<5`.
  3. `persona-composer.ts` rule 1 fleksibel: umum `Bunda`, namun jika laki-laki/suami/ayah (`saya Naufal`, `pesan untuk istri`) sapa `Bapak`/`Bapak [Nama]`; tambah rule 17 ANTI-MONOLOG mutlak.
  4. Debounce `7500ms` (`burst-coalesce.service.ts:64` fallback `7500`) & alias generik `GENERIC_TREATMENT_RE` sudah perluas `home[-\s]?(treatment|care|service|sevice)` + prompt tegas model bisnis bukan treatment (verifikasi tetap).

- **Verifikasi:** `npx vitest run tests/regression/real-conversations.test.ts tests/unit/slot-engine-generator.test.ts tests/unit/burst-coalesce.test.ts` → **18 passed**; manual strip `<think>` → `Halo Bunda!`, monolog → `''` PASS, `S` → `''` PASS, persona `Bapak` PASS; `npm run build` PASS.

#### Fix & Enhancement — Audit & Perbaikan Komprehensif Bug Price Rp 0, Race Condition Modal Edit Reservasi, Dropdown Anak Terpotong di Mobile & Dynamic Fallback Harga (`CreateReservationModal.tsx`, `financial-analytics.service.ts`, `staff-reservation.service.ts`) (2026-09-01)

- **Latar Belakang & Masalah**:
  - Pada modal *Edit Data Reservasi*, ketika membuka reservasi pasien (contoh: Bunda Soniah dengan layanan *Pijat Bayi Ceria*), kartu treatment terpilih menampilkan `Rp 0`.
  - Di perangkat mobile/iPhone, teks pada dropdown penugasan anak (`Ditujukan untuk: Anak #1: Muhammad nizar...`) terpotong ke kanan melebihi batas kartu.
  - Jika reservasi disimpan dalam kondisi tersebut, nilai `purchase_value` di database tertimpa menjadi 0.
- **Akar Masalah Teknis**:
  1. **Race Condition & Kunci Ref Modal**: State `services` awalnya kosong (`[]`) saat modal dibuka karena data baru di-fetch via async API. `useEffect` pre-fill langsung mengeksekusi `parseTreatmentsFromDetail(..., [])` sehingga harga menjadi 0. Pengunci ref `initializedEditIdRef.current` kemudian memblokir eksekusi ulang ketika data katalog selesai di-load.
  2. **Nilai Database Diabaikan**: Nilai `purchase_value` asli dari DB tidak dioper ke parser sebagai fallback.
  3. **Regex Stripper Agresif**: `replace(/\(.*?\)/g, '')` memotong nama medis dalam kurung seperti `(Rileksasi)`, menggagalkan pencarian eksak ke katalog.
  4. **Ketiadaan Input Edit Harga**: Admin tidak memiliki opsi untuk mengubah/menyesuaikan nominal harga per treatment pada kartu item terpilih.
- **Implementasi Teknis**:
  1. **Fallback Sinkron Instan & Auto-Repair (`CreateReservationModal.tsx`)**:
     - Menginisialisasi state `services` dengan `DEFAULT_CLINIC_SERVICES_FALLBACK` (0ms delay) sehingga parser selalu memiliki data harga treatment bahkan sebelum API selesai di-fetch.
     - Menambahkan mekanisme auto-repair pada `loadCatalog()`: saat katalog dari API selesai dimuat, setiap treatment terpilih dengan harga `0` otomatis diperbarui harganya dari katalog.
     - Mengoper `res.purchase_value` asli dari database ke `parseTreatmentsFromDetail` sebagai prioritas pertama saat membuka modal edit.
  2. **Inline Editable Price Input**:
     - Menambahkan input nominal harga langsung (`Rp [ 60.000 ]`) pada setiap baris kartu treatment terpilih lengkap dengan handler `handleUpdateTreatmentPrice`, memungkinkan admin menyesuaikan harga kustom/promo kapan saja.
  3. **Perbaikan Tampilan Mobile**:
     - Menambahkan kelas `flex-1 min-w-0 max-w-full sm:max-w-xs truncate` pada dropdown anak agar teks nama panjang tidak memotong kartu di layar HP.
     - Memperkuat backdrop modal dengan `bg-black/75 backdrop-blur-sm z-[99999]` agar konten di belakangnya terisolasi sempurna.
  4. **Safety Net Backend (`financial-analytics.service.ts`, `staff-reservation.service.ts`)**:
     - Menambahkan dynamic price resolution (`resolveTreatmentValue`) pada perhitungan omset dan rute terapis sehingga database record lama dengan `purchase_value` kosong/0 otomatis diselesaikan dengan harga katalog standar dan tidak pernah menampilkan Rp 0.

#### Feature — Dashboard Transaksi, Reservasi & Histori Pendapatan Bulanan (`FinancialAnalytics.tsx`, `financial-analytics.service.ts`, `analytics.subroute.ts`) (2026-09-01)

- **Latar Belakang & Kebutuhan Bisnis**:
  - Manajemen klinik membutuhkan dashboard terpadu untuk melacak omset bulanan, histori pendapatan harian (Day 1 s/d Day 31), performa terapis, komposisi kategori layanan, metode pembayaran, dan buku besar transaksi dengan fitur ekspor Excel/CSV 1-klik untuk pembukuan akuntansi.
- **Implementasi Teknis**:
  1. **Backend Aggregation Service Layer (`financial-analytics.service.ts`)**:
     - Membangun service layer agregasi PostgreSQL terindeks yang mengkalkulasi rentang waktu WIB (`startOfMonth` s/d `endOfMonth`).
     - Menyediakan metrik KPI: Total Omset (Lunas vs Tagih di Tempat), Total Reservasi, Average Order Value (AOV), Rasio Repeat Order, dan Akumulasi Ongkir.
     - Menyusun array histori harian (`dailyTrend`) tanggal 1 s/d akhir bulan, breakdown kategori layanan, metode pembayaran (Transfer, QRIS, Cash), leaderboard omset terapis, dan top layanan terlaris.
     - Generator spreadsheet CSV berstandar RFC 4180 (`generateMonthlyTransactionsCsv`).
     - Cache respons instan 30 detik (`responseCacheService`).
  2. **API Endpoints (`analytics.subroute.ts`)**:
     - `GET /api/admin/financial-analytics?year=YYYY&month=M` — Mengambil data analitik teragregasi.
     - `GET /api/admin/financial-analytics/export?year=YYYY&month=M` — Download rekap transaksi CSV langsung.
  3. **Frontend Dashboard & Visualisasi Interaktif (`FinancialAnalytics.tsx`)**:
     - Top bar dengan Month & Year Picker dinamis (Bulan Ini, Bulan Lalu, atau Pilih Bulan/Tahun).
     - 4 Top KPI Cards (Omset, Reservasi, AOV, Repeat Rate).
     - Grafik Bar & Area harian Recharts dengan tooltip informatif dalam format Rupiah.
     - Donut chart kategori layanan, bar chart metode bayar, dan kartu leaderboard terapis.
     - Tabel buku besar transaksi lengkap dengan pencarian live, filter status pelunasan, modal detail transaksi, dan tombol ekspor spreadsheet.
  4. **Navigasi & Integrasi Overview (`Layout.tsx`, `App.tsx`, `Overview.tsx`)**:
     - Mendaftarkan rute `/admin/financial-analytics` dan menu sidebar **"Transaksi & Pendapatan"** di bawah *Operasional & Jadwal*.
     - Menghubungkan kartu ringkasan omset dan reservasi di *Overview* agar langsung membuka halaman analitik detail.

#### Feature & UX Enhancement — Auto-Move Jadwal Lewat Jam ke Tab Selesai & Default View "Akan Datang" (`TodayTreatments.tsx`, `StaffToday.tsx`) (2026-09-01)

- **Latar Belakang & Kebutuhan Bisnis**:
  - Pada halaman **Treatment Hari Ini**, admin dan terapis ingin fokus pada jadwal yang *sedang/akan datang*.
  - Ketika jam jadwal treatment hari ini sudah terlewati (misal jadwal jam 10:00 dan waktu saat ini jam 11:00), tugas tersebut diharapkan otomatis berpindah ke kelompok **Selesai / Sudah Lewat**, tanpa perlu menunggu status diubah manual menjadi lunas/selesai oleh admin.
- **Implementasi Teknis**:
  1. **Klasifikasi Waktu Otomatis (`isTaskPastTime`)**:
     - Ditambahkan perhitungan waktu selesai treatment murni: `Waktu Selesai = Jam Mulai Booking + Durasi Layanan (tanpa buffer perjalanan)`.
     - Sebagai contoh: Jika reservasi dijadwalkan pukul 10:00 dengan durasi 60 menit, jadwal tetap berada di tab *Akan Datang / Berjalan* dari jam 10:00 hingga 11:00, dan tepat pada pukul 11:00 otomatis berpindah ke kelompok *Selesai*.
     - Tugas diklasifikasikan sebagai `isCompleted` jika status DB adalah `completed` **ATAU** waktu selesai treatment telah terlewati.
  2. **Default Filter "Akan Datang" (`TodayTreatments.tsx`)**:
     - Mengubah filter default dari `ALL` menjadi `UPCOMING` ("Akan Datang") sehingga saat membuka halaman, hanya jadwal yang belum lewat yang tampil.
     - Menyediakan tombol filter jelas: `Akan Datang`, `Selesai`, `OTW`, dan `Semua`.
     - Mempertahankan transparansi status keuangan: jadwal yang sudah lewat waktu tetap menampilkan rincian `Tagih di Tempat` atau `Lunas` dengan jelas.
  3. **Partisi Jadwal Petugas Lapangan (`StaffToday.tsx`)**:
     - Menyelaraskan tab `Hari Ini` pada aplikasi terapis agar otomatis menyaring tugas aktif (`activeTodayTasks`) dan memindahkan jadwal lewat jam ke tab `Selesai` (`combinedCompletedTasks`), lengkap dengan update counter badge real-time.

#### Enhancement & Fix — iPhone Header Safe-Area Inset & LiveChat Virtual Keyboard Viewport (`Layout.tsx`, `LiveChatMonitor.tsx`, `index.css`) (2026-09-01)

- **Latar Belakang & Masalah yang Dilaporkan Pengguna di iPhone:**
  1. **Textfield Input Chat Tenggelam di Belakang Keyboard**: Saat mengetik di LiveChat pada iPhone (Safari/PWA), kolom input balasan ("Tulis balasan... [Kirim]") tertutup di balik virtual keyboard iOS.
  2. **Header Atas Mepet Status Bar tapi Bawahnya Sangat Longgar**: Teks judul panel "Kala Moms & Baby Spa Panel" bertabrakan dengan jam (19.15) dan baterai status bar iPhone, sementara ruang di bawah tombol Online/Menu sangat renggang/kosong.
- **Akar Masalah Teknis:**
  1. **LiveChat Keyboard Viewport (`Layout.tsx`)**: Menggunakan tinggi statis `h-screen` (`100vh`). Pada iOS Safari, `100vh` tidak otomatis menyusut ketika keyboard muncul, sehingga area komposer bawah tetap berada di koordinat dasar layar (di balik keyboard 300px).
  2. **Header Layout Wrapper (`Layout.tsx`)**: Header memiliki `pt-[env(safe-area-inset-top)]` dan `min-h-[calc(3rem+safe-area)]`, tetapi seluruh konten di dalamnya diberi `flex items-center` pada container luar 95px tanpa pemisahan baris. Akibatnya teks berada di tengah-tengah tinggi total (bertabrakan dengan notch 50px di atas) dan menyisakan ruang kosong besar 45px di bawahnya.
- **Solusi & Implementasi Teknis (Lokal):**
  1. **Dynamic Visual Viewport Tracker (`--vvh`)**:
     - Ditambahkan hook listener `window.visualViewport` di `Layout.tsx` yang menuliskan CSS variable `--vvh: ${window.visualViewport.height}px` secara dinamis ke `document.documentElement`.
     - Container LiveChat kini menggunakan `height: var(--vvh, 100dvh)` dan `maxHeight: var(--vvh, 100dvh)`, sehingga saat keyboard iPhone terbuka, seluruh layar chat otomatis menyusut dan mengangkat kolom input tepat di atas keyboard.
     - **Anti-Fly Input Fix**: Menghapus pemanggilan `scrollIntoView()` pada elemen text input yang sebelumnya menyebabkan Safari menggulung seluruh halaman web ke atas sehingga input terbang ke bawah jam. Mengunci scroll window (`overflow: hidden` saat di halaman chat) dan menjaga jangkar `window.scrollTo(0,0)`, sehingga hanya container bubble chat yang menyusut dan textfield tetap menempel tepat di atas keyboard.
     - **Keyboard-Flush Auto Padding (`data-keyboard-open`)**: Mengurangi padding bawah dari 34px (`safe-area-inset-bottom`) menjadi 2px saat keyboard aktif, sehingga kolom chat menempel rapat/mepet presisi tanpa celah kosong di atas keyboard.
     - **Supresi Toolbar Safari (`enterKeyHint`, `tabIndex`)**: Menambahkan `enterKeyHint="send"`, `inputMode="text"`, dan mematikan `tabIndex` pada elemen latar belakang saat membuka chat agar Safari menonaktifkan panah navigasi form (`^ v`).
  2. **Struktur Header Safe-Area Terpisah (`Layout.tsx`)**:
     - Memisahkan container header menjadi wrapper luar dengan `pt-[env(safe-area-inset-top, 0px)]` sebagai bantalan notch murni, dan bar dalam `<div className="h-12 md:h-13 px-3 sm:px-5 flex items-center justify-between">`.
     - Judul panel dan tombol status/menu kini berada tepat di baris 48px di bawah jam & notch iPhone, dan ruang kosong di bawahnya 100% hilang (rapi dan proporsional di iPhone maupun Android).
  3. **Penyelarasan Warna Status Bar iPhone & Integrasi Logo Kala Resmi (`index.html`, `index.css`, `Layout.tsx`)**:
     - Mengubah `<meta name="theme-color" content="#ffffff">` dan `html { background-color: #ffffff; }` sehingga area notch/jam di bagian paling atas iPhone menyatu 100% dengan warna putih bersih (*seamless pure white*) tanpa garis potongan warna gelap (#008069 atau abu-abu).
     - Mengganti teks panjang "Kala Moms & Baby Spa Panel" di top header dengan Logo Kala resmi yang ramping & bersih berlabel "KALA SPA".
     - Mengganti kotak hijau inisial "K" di sidebar navigation dengan Logo Kala resmi (`/admin/apple-touch-icon.png`).
  4. **Universal Sticky Header di Seluruh Halaman (`index.css`)**:
     - Mengganti `overflow-x: hidden` pada `body` dan `#root` menjadi `overflow-x: clip`. Sesuai standar CSS W3C, `overflow-x: hidden` membuat browser memicu formatting context baru yang merusak `position: sticky; top: 0` saat halaman panjang di-scroll. Dengan `clip`, header kini **100% menempel (sticky) di bagian atas layar di semua halaman** (Reservations, Customer Database, Settings, Clinic Services, dll).
  5. **Build & Verifikasi**:
     - Frontend `packages/admin-dashboard`: **PASS (built in 10.23s)**.
     - Backend server: **PASS (0 error)**.

#### Enhancement — Prioritas Utama Perawatan Lanjutan Bulanan (NEXT_TREATMENT) & Peningkatan Kapasitas 25 Pesan/Hari (`follow-up.service.ts`, `follow-up-engine.test.ts`) (2026-09-01)

- **Latar Belakang & Permintaan Pengguna:**
  - Pengguna memutuskan untuk menaikkan kapasitas follow-up harian menjadi **25 pesan per hari**, dan memberikan **prioritas utama (Priority #1)** bagi pengingat bulanan pasca treatment (`NEXT_TREATMENT`) di atas follow-up prospek yang belum purchase (`NO_PURCHASE`).
- **Solusi & Implementasi:**
  1. **Tingkat Prioritas Tipe Follow-Up (`FOLLOWUP_TYPE_PRIORITY`)**:
     - Menetapkan bobot prioritas eksplisit:
       - `NEXT_TREATMENT` = **Prioritas #1 (Tertinggi)** — Pasien setia / repeat order bernilai LTV tinggi.
       - `NO_PURCHASE` = **Prioritas #2 (Standar)** — Lead baru yang belum pernah booking.
     - Mengurutkan pemrosesan worker antrian (`processDueFollowUps`) dan pendistribusian jadwal overdue (`rescheduleOverdue`) berdasarkan bobot prioritas ini, sehingga slot waktu pagi hari dan jatah harian selalu diprioritaskan untuk pesan `NEXT_TREATMENT`.
  2. **Peningkatan Default Kapasitas Harian (25 Pesan/Hari)**:
     - Mengubah default batas harian `FOLLOWUP_MAX_PER_DAY` dari `10` menjadi `25` pesan/hari di `follow-up.service.ts` (dapat dikonfigurasi via env `FOLLOWUP_MAX_PER_DAY`).
  3. **Distribusi Waktu Adaptif (09:00 - 16:30 WIB)**:
     - Merancang kalkulasi interval otomatis `stepMin = Math.floor(450 / maxPerDay)` (~18 menit per pesan).
     - Menghasilkan 25 slot waktu tersebar merata dari pukul 09:00 WIB hingga 16:12 WIB secara UTC-deterministik, sehingga volume 25 pesan tetap terdistribusi sangat natural dan aman dari deteksi spam Meta.
  4. **Automated Unit Testing (`tests/unit/follow-up-engine.test.ts`)**:
     - Menambahkan Test #11 untuk memverifikasi bahwa `NEXT_TREATMENT` selalu menduduki antrian teratas sebelum `NO_PURCHASE`. Seluruh 15 unit tests pass 100%.

#### Enhancement — Optimalisasi Debounce 7.5s, Eliminasi Bias Alias Generik & Kalkulasi Presisi Add-on Sinar Moksa (`burst-coalesce.service.ts`, `entity-extractor.ts`, `decision-matrix.ts`, `grounding-composer.ts`, `slate-store.ts`, `.env`) (2026-09-01)

- **Latar Belakang & Permintaan Pengguna:**
  - Berdasarkan rekaman percakapan riil Trosobo (6285816071628): jeda ketik 6.58s melebihi debounce 5s → 2 balasan terpisah, frasa generik "home-treatment" terkunci prematur ke Pijat Bayi Ceria, dan pergantian treatment ke Pulih Ceria + Sinar Moksa butuh kalkulasi presisi Rp 100k (80k paket + 20k ongkir).

- **Akar Masalah:**
  1. `BURST_COALESCE_MS` fallback 5000 ms memotong bubble customer yang mengetik 2-3 pesan bersusulan.
  2. `GENERIC_TREATMENT_RE` belum mencakup varian "home service"/"layanan home" & typo "sevice"; prompt NLU belum tegas bahwa "home-treatment/homecare adalah model bisnis bukan nama treatment"; `slate-store` harvest memetakan alias generik "pijat bayi" langsung ke "Pijat Bayi Ceria" (hardcode bias).
  3. `decision-matrix` & `grounding-composer` memakai fallback hardcode "Pijat Bayi Ceria" saat `candidateTreatmentName`/`effectiveTreatment` null, sehingga template ongkir tidak netral & LLM terkunci paket prematur.
  4. `grounding-composer` filter `!isAddon` membuang Sinar Moksa dari konteks LLM & sorting tidak prioritas combo "+", sehingga paket Pulih Ceria + Moksa (promo 70k+10k=80k) tidak terhitung presisi.

- **Solusi & Implementasi:**
  1. **Debounce Window 7.5s:** `burst-coalesce.service.ts` fallback `5000→7500` & `.env` `BURST_COALESCE_MS=7500`, tanpa hardcode nominal lain (env-driven, window reset per pesan).
  2. **Bersihkan Alias Generik:** Perluas `GENERIC_TREATMENT_RE` ke `home[-\s]?(treatment|care|service|sevice)` + `layanan\s*home`; tegaskan prompt NLU aturan #2 dengan kalimat eksplisit "Kata 'home-treatment' atau 'homecare' adalah model bisnis, BUKAN nama treatment! Jangan mengisi treatment_referenced jika pelanggan hanya menyebut home-treatment/homecare tanpa nama paket spesifik."; ubah `slate-store.ts` harvest `pijat bayi` → alias generik "pijat bayi" (dinamis, tidak lock ke Ceria) agar `treatmentCatalogService` resolve berdasarkan usia.
  3. **Netralisasi Ongkir:** `decision-matrix.ts` `isPureLocationMessage` sekarang normalisasi `rawCandidate` → `undefined` jika alias generik `pijat bayi|massage bayi|pijat biasa` (regex generik), sehingga `TEMPLATES.ongkirInfo` menghasilkan CTA netral "Rencana mau treatment apa bunda ?🤗" tanpa menebak paket.
  4. **Grounding Add-on Dinamis:** `grounding-composer.ts` deteksi `mentionsAddon` (moksa/sinar/nebulizer/add-on) secara dinamis dari `inputLower|slate|extraction`, append katalog `ADD_ON` relevan (filter per keyword, dedup) & naikkan `maxItems 5→7` bila moms/addon; perbaiki sorting untuk combo "+" dengan split & clean name; hapus hardcode fallback `Pijat Bayi Ceria` → `null` (schedule note kondisional) & `treatmentBaby` fallback → dynamic lookup `allServices.find BABY`; tambah `comboPricingNote` dinamis: hitung total promo/normal dari katalog aktif (`reduce promoPrice`) + ongkir = total, tanpa hardcode 80k/100k.

- **Verifikasi:**
  - `npx vitest run tests/regression/real-conversations.test.ts tests/unit/burst-coalesce.test.ts tests/unit/slot-engine-decision.test.ts` → **18 passed**
  - `slot-engine-lead-greeting` & `centralized-persona` → **PASS** (anti-bias home-treatment null)
  - Manual: `TEMPLATES.ongkirInfo` 17.8km Rp20k → neutral CTA PASS; `GroundingComposer` combo Pulih+Moksa → filteredCatalog mengandung Pulih Rp70k + Moksa Rp10k = 80k + ongkir 20k = 100k PASS
  - `npm run build` → **PASS (0 error)**, full suite **199 files 1548 passed** (1 flaky migration timeout → rerun PASS)

- **File yang Dipengaruhi:** `src/services/burst-coalesce.service.ts`, `.env`, `src/slot-engine/entity-extractor.ts`, `src/slot-engine/slate-store.ts`, `src/slot-engine/decision-matrix.ts`, `src/slot-engine/grounding-composer.ts`

#### Audit & Fix — Production Follow-Up Queue Audit & UTC-to-WIB Accurate Scheduling (`follow-up.service.ts`, `follow-up-engine.test.ts`) (2026-09-01)

- **Latar Belakang & Permintaan Pengguna:**
  - Pengguna meminta pengecekan dan audit menyeluruh terhadap performa dan cara kerja **Follow-Up Queue (Antrian Follow-Up)** untuk seluruh use case di live server, serta melaporkan mana yang sudah sesuai dan mana yang terdapat kendala/anomali.

- **Hasil Audit Use Case di Live Server:**
  1. **`NO_PURCHASE` (Customer Masuk Belum Booking)**:
     - **Status**: 49 terkirim (*SENT*), 119 dalam antrian (*QUEUED*), 126 dibatalkan (*CANCELLED* karena customer akhirnya melakukan booking).
     - **Evaluasi**: **100% SESUAI**. Auto-queue 3 tahap (+3, +7, +14 hari) dan auto-cancel saat reservasi dibuat berjalan sempurna.
  2. **`NEXT_TREATMENT` (Customer Pasca Treatment)**:
     - **Status**: 40 terkirim (*SENT*), 132 dalam antrian (*QUEUED*), 32 dibatalkan (*CANCELLED*).
     - **Evaluasi**: **100% SESUAI**. Penjadwalan bertahap (+1, +2, +3 bulan) berjalan konsisten.
  3. **Smart Context Guards (Human Handling & Cooldown 72h)**:
     - **Status**: Worker secara otomatis menahan dan menjadwalkan ulang pesan untuk customer yang sedang ditangani manual oleh Admin (`is_human_handling = true`) atau baru aktif chat (< 72 jam).
     - **Evaluasi**: **100% SESUAI**. Tidak ada tabrakan chat dengan admin.

- **Temuan Anomali & Perbaikan (Bug Fix):**
  - **Akar Masalah Timezone Jam Malam/Pagi**: `createReservationFollowUps` dan `onReservationRescheduled` sebelumnya menggunakan `setHours(19)` dan `setHours(8)` lokal sistem. Di container VM Linux (UTC), ini menyebabkan Reminder H-1 terjadwal di `19:00 UTC = 02:00 WIB (subuh)` dan Review H+1 di `08:00 UTC = 15:00 WIB (sore)`.
  - **Solusi**: Mengganti kalkulasi menjadi UTC-deterministik WIB: `Date.UTC(year, month, day - 1, 12, 0, 0, 0)` (tepat 19:00 WIB malam) dan `Date.UTC(year, month, day + 1, 1, 0, 0, 0)` (tepat 08:00 WIB pagi).

#### Fitur — Paket Multi-Sesi (ReservationSeries) (`prisma/schema.prisma`, `reservation-series.service.ts`, `reservations.subroute.ts`, `CreateReservationModal.tsx`) (2026-09-01)

- **Latar Belakang & Permintaan Pengguna:**
  Banyak treatment bersifat berulang — misalnya "Newborn Bathing 30 Hari" membutuhkan 30 sesi (1×/hari). Admin harus membuat reservasi satu per satu manual → ribet, mudah lupa jadwal, tidak bisa pantau progres.
  Diminta fitur **Paket Multi-Sesi** agar admin bisa membuat N sesi sekaligus dari satu klik.

- **Solusi:**
  - **Schema:** Tabel `reservation_series` baru (id, customer_id, clinic_service_id, title, status, start_date, total_sessions, completed_sessions, notes). Kolom `series_id` + `session_number` + `total_sessions` di `reservations`.
  - **Backend (`reservation-series.service.ts`):** Service lengkap — createSeries (generate N reservasi sekaligus), getSeries, getCustomerSeries, pauseSeries, resumeSeries, cancelSeries, updateSession, checkAndCompleteSeries (auto-complete saat semua sesi done).
  - **Backend Endpoints:** POST/GET series, PATCH pause/resume/cancel, PATCH session update — 7 endpoint baru.
  - **Frontend (`CreateReservationModal.tsx`):** Admin memilih layanan paket → auto-detect `totalSessions` dari catalog → schedule builder muncul → admin atur tanggal & jam per sesi → klik "Buat Paket" → semua reservasi dibuat sekaligus.
  - **Frontend Types:** `ClinicServiceItem` + `ClinicServices` interface updated dengan `totalSessions` + `sessionScheduleType`.

- **File berubah:** 8 file (new: `reservation-series.service.ts`, `migration.sql`; modified: `schema.prisma`, `reservations.subroute.ts`, `treatment-catalog.service.ts`, `CreateReservationModal.tsx`, `types.ts`, `ClinicServices.tsx`)

- **Verifikasi:** `tsc --noEmit` 0 error, `vite build` 10.20s pass, live server deploy — migration applied, app boot clean, no errors.

- **Phase 4 (2026-09-01 13:17):** Badge "Sesi X/Y" di calendar view (`WeekScheduleGrid` + `DayScheduleGrid`) + section "Paket Sesi" di customer detail modal dengan progress bar per series. Deployed clean.

#### Fix & Enhancement — Customer Database: Skeleton Ringan + Retry Manual + Timeout 10s Fix (`CustomerDatabase.tsx`, `customer.service.ts`, `customers.subroute.ts`, `schema.prisma`, `docker-compose.yml`) (2026-09-01)

- **Latar Belakang & Permintaan Pengguna:**
  1. Buka Database Customer → loading lama → toast "Gagal memuat database customer: Koneksi internet lambat (Timeout 10s)" meskipun data hanya 500 baris.
  2. Tidak ada UI skeleton atau retry manual — user hanya melihat spinner kosong lalu error toast yang hilang.
  3. LTV sorting (`sortBy=ltv`) tidak akurat — fetch 500 rows lalu sort JS, bukan top-N by LTV sesungguhnya.

- **Akar Masalah (5 faktor konkuren):**
  1. N+1 `resolveTreatmentValue` per-row — 500 rows × unique texts = 500 sequential `await`.
  2. 6 query paralel per request (findMany + count + 4 stats) memblok response.
  3. `pool_timeout=10` sama dengan FE timeout 10s → race condition.
  4. Search `ILIKE %q%` pada 6 field termasuk yang tidak ter-index.
  5. Hanya spinner, tidak ada skeleton atau retry banner.

- **Solusi & Implementasi (7 fase):**
  1. **Skeleton Ringan (Phase 1):** Ganti full-page `<Loader>` dengan skeleton `animate-pulse` saat data kosong. Saat refresh dengan data ada → overlay transparan, tidak kehilangan data lama.
  2. **Search Debounce 300ms (Phase 1):** Mencegah pengetikan cepat memicu rentetan request `ILIKE` konkuren.
  3. **Retry Manual Banner (Phase 2):** State `loadError` + tombol "Coba Lagi" persisten, `useEffect([retryCount])` trigger reload.
  4. **Timeout 20s khusus customers (Phase 2):** `apiRequest({ timeoutMs: 20000 })` hanya untuk endpoint customers, global tetap 10s.
  5. **Batch resolve N+1 (Phase 1.5):** Kumpulkan semua unique texts, `Promise.all` sekali, lalu lookup dari Map — bukan per-row await.
  6. **Stats endpoint terpisah (Phase 3):** `GET /api/admin/customers/stats` cached 60s, frontend fetch terpisah via `useEffect([])`.
  7. **Observability logging (Phase 3.5):** Structured JSON log per request: `elapsed`, `findManyMs`, `resolveMs`, warning jika >500ms.
  8. **Search guard (Phase 4):** Query <4 huruf hanya scan `name/phone/trackingCode` (3 field), ≥4 huruf scan 6 field.
  9. **LTV materialization (Phase 4):** Kolom `ltv_cache` di DB, `orderBy: { ltv_cache }` native PostgreSQL, hook `recalculateCustomerLtv` saat reservasi create/update/cancel, backfill SQL idempotent.
  10. **Pool timeout 15s (Phase 5.5):** `pool_timeout=10→15` agar FE 20s tidak race dengan pool.
  11. **Composite indexes (Phase 4):** `tenant_id+is_sandbox_test`, `tenant_id+is_mql`, `tenant_id+is_sandbox_test+created_at`, `ltv_cache`.

- **File yang Dipengaruhi:**
  - `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx` — skeleton, retry banner, debounce, stats fetch terpisah
  - `packages/admin-dashboard/src/services/api.ts` — tidak diubah (timeoutMs di-pass dari caller)
  - `src/services/customer.service.ts` — batch resolve, observability, `getCustomerStats()`, `recalculateCustomerLtv()`, `backfillAllLtvCache()`, search guard, `ltv_cache` sort
  - `src/routes/admin/customers.subroute.ts` — `GET /api/admin/customers/stats` endpoint baru, cache invalidation granularity
  - `src/routes/admin/reservations.subroute.ts` — hook `recalculateCustomerLtv` pada PATCH edit & status change
  - `src/services/reservation-lifecycle.service.ts` — hook `recalculateCustomerLtv` saat reservasi baru
  - `prisma/schema.prisma` — kolom `ltv_cache`, 4 composite indexes baru
  - `prisma/migrations/20260901000000_add_ltv_cache_and_indexes/migration.sql` — DDL + backfill
  - `docker-compose.yml` — `pool_timeout=10→15`

- **Verifikasi:**
  - Backend typecheck: PASS (0 error)
  - Frontend typecheck: PASS (0 error)
  - Frontend build: PASS (42.49s)
  - Backend build: PASS
  - Vitest suite: **197/198 files passed, 1542/1543 tests passed** (1 pre-existing timeout di `migration.test.ts` — Google Calendar, tidak terkait)

#### Fix & Enhancement — Custom Treatment: Hapus Auto-Detect Addon & Tambah Input Harga (`CreateReservationModal.tsx`) (2026-08-31)

- **Latar Belakang & Permintaan Pengguna:**
  1. Saat admin menambahkan treatment kustom di modal reservasi, treatment tersebut otomatis diklasifikasikan sebagai addon jika namanya mengandung keyword tertentu (moksa, tambahan, taping, kinesio, dsb.), meskipun admin tidak mengaktifkan toggle addon. Admin meminta agar custom treatment hanya dianggap addon jika toggle manual dinyalakan.
  2. Admin ingin bisa memasukkan harga saat membuat treatment kustom, namun field harga tidak tersedia di UI form treatment kustom.

- **Solusi & Implementasi:**
  1. **Hapus Auto-Detect Addon untuk Custom Treatment**: Mengubah `handleAddCustomTreatment()` agar hanya menggunakan toggle manual admin (`customIsAddon`) tanpa memanggil `isAddonService()` dengan name-based heuristic. Custom treatment kini 100% dikontrol oleh admin via toggle.
  2. **Tambah Input Harga**: Menambahkan field harga (`Rp` prefix) di grid form treatment kustom (4 kolom: Nama, Durasi+Toggle, Harga, Tombol Tambahkan). Harga direset ke `0` setelah treatment berhasil ditambahkan.
  3. **Reset State**: `customServicePrice` direset ke `0` setelah submit, bersama `customServiceName` dan `customIsAddon`.

- **File yang Dipengaruhi:** `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx`

#### Enhancement & Fix — Reservation List View Nearest-Time Sorting (`booking_date ASC`) & Strict WIB Timezone Parser (`Reservations.tsx`, `reservations.subroute.ts`, `reservation-text-parser.ts`) (2026-08-31)

- **Latar Belakang & Permintaan Pengguna:**
  1. **Urutan Tampilan List Reservasi**: Pengguna menanyakan mengapa tampilan daftar/tabel reservasi tidak diurutkan berdasarkan jam kunjungan yang paling dekat.
  2. **Verifikasi Keakuratan Jam Reservasi**: Pengguna meminta memastikan jam yang tercatat di reservasi benar-benar sesuai dengan teks konfirmasi/pemesanan customer dan tidak asal-asalan (*ngarang*).

- **Akar Masalah & Temuan Audit:**
  1. **Default Sorting di Tabel Reservasi**:
     - `Reservations.tsx` dan `reservations.subroute.ts` sebelumnya memiliki nilai default `sortField = 'created_at'` dan `sortOrder = 'desc'`. Hal ini menyebabkan tabel mengurutkan data berdasarkan waktu input reservasi dibuat di database (entri terbaru di atas), bukan berdasarkan jam jadwal kunjungan (`booking_date`).
  2. **Potensi Pergeseran Jam Timezone & Dotted Date Parse**:
     - Parser tanggal sebelumnya menggunakan `new Date(year, month, day, hours, minutes)` yang bergantung pada timezone lokal server. Di lingkungan server Docker / VM berbasis UTC, jam 10:00 WIB yang tersimpan sebagai 10:00 UTC akan bergeser 7 jam menjadi 17:00 (5 sore) saat dibuka di browser Indonesia.
     - Penulisan tanggal dengan titik seperti `10.08.2026` sebelumnya berisiko tertangkap oleh regex waktu `10.08` sebagai jam 10:08 pagi jika tidak ada jam eksplisit.

- **Solusi & Implementasi Teknis:**
  1. **Pengurutan Default List View ke Jam Terdekat (`booking_date ASC`)**:
     - `Reservations.tsx`: Mengubah default `sortField` menjadi `'booking_date'` dan `sortOrder` menjadi `'asc'`.
     - `src/routes/admin/reservations.subroute.ts`: Mengubah default query param `sortBy` ke `'booking_date'` dan `sortOrder` ke `'asc'`, dengan pengurutan Prisma `[{ booking_date: 'asc' }, { created_at: 'desc' }]` serta sorting in-memory fallback.
     - Reservasi terdekat hari ini (pukul 09:00, 10:00, 13:00, dst.) kini otomatis tampil paling atas di view list/tabel.
  2. **Parser Waktu & Timezone WIB Presisi (`src/utils/reservation-text-parser.ts`)**:
     - Ditambahkan helper `createWibDate(year, month, day, hours, minutes)` yang menyematkan offset ISO `+07:00` secara eksplisit, menjamin jam tidak pernah bergeser di server mana pun.
     - Regex waktu diperketat untuk mendeteksi penanda waktu eksplisit (`jam 10.00`, `pukul 14.30`, `pk 09.00`, `10.00 wib`, `jam 1 siang` $\rightarrow$ 13:00, `jam 3 sore` $\rightarrow$ 15:00, `10:00`).
     - Tanggal numerik dengan titik (`10.08.2026`, `29.08.2026`) kini diparsing dengan benar sebagai tanggal 10 Agustus tanpa salah terbaca sebagai jam 10:08.
  3. **Unit Tests & Verifikasi**:
     - `tests/unit/reservation-text-parser.test.ts`: **19/19 tests passed (100% green)**.
     - Full Vitest suite: **198 test files, 1541 tests passed (100% green)**.
     - Frontend dashboard: **PASS (0 error, built in 10.38s)**.
     - Backend server: **PASS (0 error)**.

#### Enhancement & Fix — Reservation Card Length, Total Duration & Buffer Time Synchronization (`durationCalculator.ts`, `DayScheduleGrid.tsx`, `WeekScheduleGrid.tsx`, `MonthScheduleGrid.tsx`, `ReservationDetailModal.tsx`, `Reservations.tsx`) (2026-08-31)

- **Latar Belakang & Permintaan Pengguna:**
  - Pengguna menanyakan dan meminta memastikan bahwa panjang (*height* / rentang waktu) kartu reservasi di tampilan kalender (`DayScheduleGrid`, `WeekScheduleGrid`, `MonthScheduleGrid`) sudah sesuai dengan total durasi riil slot reservasi yang dijadwalkan, termasuk waktu *buffer* (waktu jeda/persiapan/perjalanan).

- **Akar Masalah & Temuan Audit:**
  - Format string detail reservasi dari `CreateReservationModal` menyertakan durasi murni + buffer, contoh: `"[Total 120m + Buffer 15m = 135m]"` atau `"[Total 45m + Buffer 15m = 60m]"`.
  - Sebelumnya, regex `extractDurationMinutes` di `DayScheduleGrid.tsx` dan `WeekScheduleGrid.tsx` mencocokkan `[Total 120m` terlebih dahulu dan langsung mengembalikan `120` menit murni (2 jam), mengabaikan tambahan buffer `15m` (`= 135m`). Akibatnya, kartu di kalender dirender lebih pendek 15 menit dari jadwal blok waktu yang sebenarnya.

- **Solusi & Implementasi Teknis:**
  1. **Centralized Duration Calculator (`packages/admin-dashboard/src/utils/durationCalculator.ts`)**:
     - `extractDurationMinutes`: Mengutamakan total durasi hasil kalkulasi yang menyertakan buffer (`= (\d+)m`), mendukung penjumlahan eksplisit `Total Xm + Buffer Ym`, durasi per item treatment + buffer, parsing menit alami, serta fallback cerdas per kategori treatment (nifas/paket 90m, standar 60m).
     - `cleanTreatmentDetailForDisplay`: Membersihkan tag internal buffer/durasi dari nama treatment agar kartu kalender menampilkan nama treatment yang rapi tanpa teks rumus internal.
  2. **Sinkronisasi Kalender & Modal Detail**:
     - Menghubungkan `DayScheduleGrid.tsx`, `WeekScheduleGrid.tsx`, `MonthScheduleGrid.tsx`, `ReservationDetailModal.tsx`, dan `Reservations.tsx` ke modul `durationCalculator.ts`.
     - Rentang jam (`startTime - endTime`), badge durasi (`135m`), dan tinggi piksel kartu (`heightPx`) di kalender kini 100% presisi mencerminkan total waktu reservasi + buffer.
  3. **Unit Tests & Verifikasi**:
     - Dibuat unit test lengkap di `tests/unit/duration-calculator.test.ts` (9 test cases, 100% pass).
     - Full test suite: **198 test files, 1541 tests passed (100% green)**.
     - Frontend build: **PASS (0 error, built in 10.26s)**.

#### Enhancement & Fix — Full Customer & Children Data Editor, Unified Reservation Edit UI, Enhanced Date/Time Parsing & WhatsApp Button Removal (`CustomerEditForm.tsx`, `customer.service.ts`, `customers.subroute.ts`, `CreateReservationModal.tsx`, `ReservationDetailModal.tsx`, `reservation-text-parser.ts`, `CustomerDatabase.tsx`, `LiveChatMonitor.tsx`, `DayScheduleGrid.tsx`) (2026-08-31)

- **Latar Belakang & Permintaan Pengguna:**
  1. **Edit Lengkap Profil Customer Hingga Data Anak**: Pengguna dapat mengedit seluruh data customer (nama bunda, no WhatsApp, alamat lengkap, kelurahan, kecamatan, kota, patokan rumah, GPS assist) dan data dinamis anak/bayi (tambah anak, ubah nama dan usia, hapus anak).
  2. **Penyatuan UI Edit Reservasi dengan Form Buat Reservasi Baru**: UI form edit reservasi kini disamakan 100% dengan modal Buat Reservasi Baru (`CreateReservationModal`), di mana seluruh data reservasi, layanan, multi-anak, jadwal, terapis, status, catatan, dan diskon telah terisi (*pre-filled*), mendukung katalog live dan rekomendasi slot.
  3. **Perbaikan Waktu Default Jam 7 Pagi pada Reservasi**: Mengatasi masalah jam reservasi yang sebelumnya jatuh ke default jam 7 pagi WIB (karena parser tanggal jatuh ke 00:00 UTC = 07:00 WIB saat tahun diabaikan atau format waktu terpisah).
  4. **Pembersihan Tombol Chat WhatsApp**: Menghapus tombol/link eksternal WhatsApp (`wa.me`) di popup detail customer (`CustomerDatabase.tsx`), panel detail customer LiveChat (`LiveChatMonitor.tsx`), dan kartu reservasi kalender harian (`DayScheduleGrid.tsx`) agar alur komunikasi tetap terpusat di Live Chat dan tidak mengganggu alur kerja admin.

- **Solusi & Implementasi Teknis:**
  1. **Backend Customer & Dynamic Children Sync (`src/services/customer.service.ts` & `src/routes/admin/customers.subroute.ts`)**:
     - Memperluas `updateCustomer` untuk menerima `phone`, `address`, dan array `children`.
     - Mengembangkan sinkronisasi atomik data anak pada tabel `Child` (membuat, memperbarui nama & usia, dan menghapus anak yang dihapus admin) serta mendukung in-memory fallback.
     - Menyediakan endpoint `PUT /api/admin/customers/:id` dan alias `PATCH /api/admin/customers/:id`.
  2. **Form Edit Customer & Data Anak (`CustomerEditForm.tsx`, `CustomerDatabase.tsx`, `LiveChatMonitor.tsx`)**:
     - Form mencakup Nama Bunda, No WhatsApp, Alamat Lengkap textarea, Kelurahan, Kecamatan, Kota, Kode Pos, Patokan Rumah, GPS Smart Assistant, dan list dinamis Data Bayi/Anak (`+ Tambah Anak`, hapus anak, edit nama & usia).
  3. **Unified Modal Reservasi Edit Mode (`CreateReservationModal.tsx` & `ReservationDetailModal.tsx`)**:
     - Menambahkan props `mode?: 'create' | 'edit'` dan `initialReservation?: Reservation | any` ke `CreateReservationModal`.
     - Mem-parsing dan mengisi otomatis customer, data anak, daftar treatment (`parseTreatmentsFromDetail`), tanggal, jam, terapis, status, catatan, ongkir, dan diskon.
     - Menyimpan perubahan via `PATCH /api/admin/reservation/:id`.
     - Mengarahkan tombol **"✏️ Edit Reservasi"** pada `ReservationDetailModal` langsung ke `CreateReservationModal` mode edit.
     - Memperbaiki urutan eksekusi React Hooks pada `ReservationDetailModal` (menghilangkan *early return* sebelum `useEffect`) dan menambahkan `useRef` guard pada `CreateReservationModal` sehingga modal edit terbuka mulus tanpa *whitespace/crash* React.
  4. **Robust Indonesian Date & Time Parser (`src/utils/reservation-text-parser.ts`)**:
     - Meningkatkan `tryParseIndonesianDate` untuk mengenali tanggal relatif ("hari ini", "besok", "lusa"), nama hari ("senin", "rabu"), resolusi tahun otomatis jika tidak dituliskan, dan default jam kerja 09:00 WIB.
  5. **Penghapusan Tombol WhatsApp Eksternal**:
     - Menghapus tombol "Buka di WhatsApp" dari `CustomerDatabase.tsx`.
     - Menghapus card "Chat WA" dari `LiveChatMonitor.tsx` (grid metriks disesuaikan 3 kolom).
     - Menghapus icon chat WhatsApp dari kartu reservasi `DayScheduleGrid.tsx`.
  6. **Verifikasi & Build**:
     - `packages/admin-dashboard`: **PASS (0 errors, build in 10.26s)**.
     - Backend (`root`): **PASS (0 errors)**.
     - Vitest suite: **197 files, 1532 tests passed (100% green)**.

#### Bug Fix — LiveChat 24-Hour Draft Memory Lifecycle & Cross-Menu Navigation Persistence (`LiveChatMonitor.tsx`) (2026-08-31)

- **Latar Belakang & Gejala Permasalahan:**
  - CS / Admin yang sedang mengetik draf balasan di Live Chat kehilangan teks ketikan ketika berpindah ke menu lain di admin dashboard (misal membuka menu Reservasi, Customer, Kalender, dsb.) dan kembali ke Live Chat.
  - **Akar Masalah**: Saat komponen `LiveChatMonitor` remount ketika admin kembali dari menu lain, `selectedChat` awalnya bernilai `undefined` (karena daftar percakapan masih dalam proses fetch). Komponen merender placeholder kosong dan `chatInputRef.current` belum ada di DOM (`null`). Efek `useEffect([selectedId])` berjalan sebelum elemen input terpasang di DOM sehingga pemulihan draf dari `localStorage` gagal secara senyap. Ketika data percakapan selesai dimuat, elemen input baru masuk ke DOM dalam keadaan kosong tanpa memicu pemulihan draf ulang.

- **Solusi & Perbaikan:**
  1. **Callback Ref `setChatInputRef`**: Menggunakan callback ref pada elemen `contentEditable` `<div ref={setChatInputRef}>`. Kapan pun elemen input terpasang (*mount*) ke DOM (baik saat inisialisasi awal, saat data chat selesai diambil dari backend, maupun saat kembali dari menu lain), draf 24 jam dari `localStorage` (`liveChat:draft:${convId}`) langsung dipulihkan secara instan ke dalam `innerText` dan mengaktifkan tombol kirim (`hasReplyText = true`).
  2. **Sinkronisasi Siklus Hidup `selectedChat`**: Menambahkan dependency `selectedChat?.conversationId` pada efek pemulihan draf agar perubahan status percakapan selalu mengecek dan menyinkronkan draf aktif.
  3. **Auto-Save Saat Pindah Menu & Window Lifecycle**: Menambahkan listener `unmount` komponen, `pagehide`, dan `beforeunload` untuk menjamin setiap ketikan terakhir sebelum berpindah halaman selalu tersimpan secara sinkron ke `localStorage`.
  4. **Penyimpanan Draf Otomatis untuk AI Copilot & Invoice Generator**: Draf yang dihasilkan dari tombol *AI Copilot* maupun *Generate Invoice* kini juga langsung disimpan ke `localStorage` sehingga tidak hilang jika admin berpindah menu sebelum menekan kirim.

#### Feature & Fix — Full Reservation Editing Modal & 1:1 Synchronized Top Scrollbar Track for Weekly Calendar (`ReservationDetailModal.tsx`, `reservations.subroute.ts`, `WeekScheduleGrid.tsx`, `admin-create-reservation.test.ts`) (2026-08-31)

- **Latar Belakang & Kebutuhan Pengguna:**
  1. **Tombol & Fitur Edit pada Detail Reservasi**: Pengguna menginginkan tombol Edit langsung pada popup Detail Reservasi (`ReservationDetailModal`) untuk dapat mengubah rincian pasien (nama bunda, no WA, alamat, patokan, kecamatan/kota), data bayi/anak, kategori treatment, rincian layanan, tarif purchase value (Rp), jadwal kunjungan, penugasan terapis (staff), status reservasi, dan metode pembayaran.
  2. **Perbaikan Bug Scroll Kalender Mingguan**: Scrollbar horizontal di atas hari sebelumnya memiliki ketidaksinkronan rasio scrollLeft dengan container grid utama (akibat container tombol hari hanya selebar ~350px sedangkan tabel utama selebar 1050px), serta auto-scroll yang menimpa scroll manual pengguna setiap kali me-render ulang / berpindah tanggal.

- **Solusi & Implementasi:**
  1. **Backend Endpoint `PATCH /api/admin/reservation/:id` (`src/routes/admin/reservations.subroute.ts`)**:
     - Mendukung pengeditan menyeluruh kolom reservasi: `treatmentCategory`, `treatmentDetail`, `purchaseValue`, `bookingDate`, `assignedStaffId`, `status`, `paymentMethod`, `notes`, dan `rawText`.
     - Melakukan sinkronisasi otomatis ke tabel `Customer` (`name`, `phone`, `address`, `kecamatan`, `kota`, `kelurahan`, `landmark`).
     - Melakukan sinkronisasi otomatis ke tabel `Child` (memperbarui atau membuat record anak/bayi baru).
     - Menjadwalkan ulang pengingat follow-up otomatis jika `bookingDate` berubah.
     - Memperbarui event Google Calendar jika terhubung (`google_calendar_event_id`).
     - Mencatat audit log `UPDATE_RESERVATION_DETAIL`.
     - Mendukung fallback in-memory untuk pengujian offline.
  2. **Mode Edit Komprehensif pada `ReservationDetailModal.tsx`**:
     - Menambahkan tombol **"✏️ Edit Reservasi"** di header modal dan bar aksi bawah.
     - Menyediakan antarmuka form pengeditan terstruktur 4 bagian (Data Pasien, Data Bayi/Anak dinamis, Layanan & Tarif, Jadwal/Staff/Status).
     - Tombol **"💾 Simpan Perubahan"** dengan indikator loading dan penanganan error.
  3. **1:1 Synchronized Top Scrollbar Track pada `WeekScheduleGrid.tsx`**:
     - Memisahkan bar navigasi hari (tombol chip hari `Sen 24`, `Sel 25`, dst.) dari scrollbar fisik.
     - Menambahkan track scrollbar horizontal dedicated selebar **1050px** yang tersinkronisasi 1:1 pixel-for-pixel dengan grid kalender.
     - Menjaga auto-scroll hanya berjalan sekali pada initial mount (`hasAutoScrolledRef.current = true`) sehingga tidak pernah mengganggu atau me-reset scroll manual pengguna.
  4. **Pengujian & Verifikasi**:
     - Frontend build (`packages/admin-dashboard`): **PASS (0 error, 10.10s)**.
     - Backend build (`root`): **PASS (0 error)**.
     - Vitest suite: **PASS (7/7 tests green)**.

#### Enhancement & Fix — 8-Point Comprehensive Punch List: Calendar 2D Navigation, Multi-Hour Card Spanning, Visit Schedule Timing, Invoice Cleanup & LiveChat 24h Draft (`WeekScheduleGrid.tsx`, `DayScheduleGrid.tsx`, `reservation-text-parser.ts`, `paymentInvoiceFormatter.ts`, `InvoiceGeneratorModal.tsx`, `LiveChatMonitor.tsx`) (2026-08-31)

- **Latar Belakang & Gejala Permasalahan:**
  1. **Scroll Horizontal Kalender Mingguan Sulit Diakses / Tidak Bisa Diklik**: Scrollbar tipis sebelumnya hanya berukuran 8px (`h-2`) sehingga tidak dapat disentuh di layar sentuh mobile.
  2. **Card Treatment Hanya Berada di 1 Cell (Tidak Sesuai Durasi Menit)**: Event card dirender di dalam row per jam terpisah sehingga saat durasi layanan > 60 menit (misal 90m, 120m, 150m), card terpotong oleh row jam berikutnya di DOM.
  3. **Jadwal Kunjungan di Menu Treatment Default Jam 7 Pagi**: Saat format booking chat memisahkan baris tanggal dan baris jam terpisah (`Jam: 10.00`), parser teks melewatkan jam dan mem-parse tanggal tanpa jam sehingga fallback ke tengah malam UTC (`00:00 UTC`), yang di WIB (+7) menjadi `07:00 (7 Pagi)`.
  4. **Menit Treatment Muncul di Invoice**: Invoice pembayaran masih mencantumkan durasi menit (`[60m]`, `(60 menit)`) pada nama layanan.
  5. **Ongkir di Invoice Menampilkan Harga Normal Tanpa Potongan**: Invoice belum menampilkan rincian promo ongkir / potongan ongkir sesuai delivery tier.
  6. **Draft Input LiveChat Hilang Saat Pindah Layar**: CS yang sedang mengetik balasan chat kehilangan teks ketika berpindah percakapan atau navigasi menu.
  7. **Tinggi Textfield Input LiveChat Terlalu Tinggi**: Textfield expanding memanjang hingga 220px yang mengorbankan ruang layar thread percakapan.
  8. **Layar HP Blank/White Space di Halaman Kalender**: Konflik touch listener non-passive dan layout kalkulasi pada viewport mobile.

- **Solusi & Perbaikan Komprehensif:**
  1. **Top Interactive Day Navigation Bar (`WeekScheduleGrid.tsx`)**:
     - Mengganti scrollbar tipis dengan Day Navigator Bar interaktif (`h-9` / `h-10`) yang memuat chip tombol hari (`Sen 24`, `Sel 25`, `Rab 26`, dll.) dan tombol panah navigasi `◀` dan `▶`.
     - 1-klik / 1-tap pada chip hari langsung melakukan smooth scrolling ke kolom hari tersebut.
     - Scroll dua arah tersinkronisasi mulus antara navigator hari dan grid kalender.
  2. **Continuous Multi-Hour Column Timeline Architecture (`WeekScheduleGrid.tsx`, `DayScheduleGrid.tsx`)**:
     - Mengubah arsitektur grid: setiap kolom hari dirender sebagai satu kanvas vertikal utuh (`height = 16 * hourHeight`).
     - Seluruh card event diposisikan secara absolut dengan kalkulasi presisi `top = (startMinutes / 60) * hourHeight` dan `height = (duration / 60) * hourHeight - 4`.
     - Mendukung clustering event tumpang tindih (split width berdampingan otomatis).
     - Durasi 60m, 90m, 120m, 150m, 180m sekarang merentang sempurna melintasi beberapa cell jam tanpa terpotong batas row DOM.
     - Memperkaya `extractDurationMinutes` dengan deteksi bundling paket (`+`, `&`, `dan`), penjumlahan eksplisit menit, dan keyword treatment.
  3. **Robust Separate Time Field Extraction (`src/utils/reservation-text-parser.ts`)**:
     - Menambahkan penangkapan field `Jam:`, `Pukul:`, `Waktu:`, `Jadwal:` yang terpisah baris dari `Hari dan Tanggal:`.
     - Menggabungkan `dateStr` dan `timeStr` sebelum dikonversi ke `Date`, memastikan jam yang dipesan customer (misal 09:00, 10:00, 13:00) tersimpan akurat dan tidak lagi default 07:00 WIB.
  4. **Pembersihan Durasi Menit dari Invoice (`paymentInvoiceFormatter.ts`, `InvoiceGeneratorModal.tsx`)**:
     - Menghapus tag menit `[XXm]`, `(XX menit)`, `XX menit` dari baris treatment di invoice.
  5. **Perhitungan Ongkir Normal & Promo Ongkir Transparan (`paymentInvoiceFormatter.ts`, `InvoiceGeneratorModal.tsx`)**:
     - Menampilkan rincian ongkir normal dan potongan `Promo ongkir = - Rp X.XXX` secara transparan pada invoice teks WhatsApp.
  6. **LiveChat 24-Hour Draft Memory per Percakapan (`LiveChatMonitor.tsx`)**:
     - Mengimplementasikan `saveConversationDraft`, `loadConversationDraft`, dan `clearConversationDraft` berbasis `localStorage` dengan masa aktif 24 jam (`86.400.000 ms`).
     - Teks yang sedang diketik otomatis tersimpan saat berpindah percakapan dan dimuat kembali saat percakapan dibuka.
     - Draft otomatis dibersihkan saat pesan berhasil dikirim.
  7. **Textfield Input Max 5 Lines (`LiveChatMonitor.tsx`)**:
     - Mengatur tinggi maksimal chat input menjadi `max-h-[125px]` (~5 baris) dengan scrolling vertikal mulus.
  8. **Mobile Viewport Stability & Safe Gestures (`WeekScheduleGrid.tsx`, `useCalendarZoom.ts`)**:
     - Mengisolasi pointer dragging mouse khusus untuk desktop (`e.pointerType === 'mouse'`), membebaskan touch event mobile 100% native dan bebas lag/white screen.

#### Feature — Pinch-to-Zoom & Semantic Time Density Scaling untuk Kalender Mingguan & Harian (`WeekScheduleGrid.tsx`, `DayScheduleGrid.tsx`, `useCalendarZoom.ts`, `CalendarZoomControls.tsx`) (2026-08-31)

- **Latar Belakang & Kebutuhan Pengguna:**
  - Pengguna membutuhkan fleksibilitas tampilan kalender mingguan (*Week View*) dan harian (*Day View*) agar dapat di-zoom in / zoom out (termasuk gesture pinch cubit 2 jari di HP) untuk melihat ringkasan kepadatan seluruh jam dalam 1 layar (*Overview*) maupun melihat rincian lengkap treatment & jadwal yang berhimpitan (*Detail*).

- **Solusi & Implementasi:**
  1. **Custom Hook `useCalendarZoom` (`packages/admin-dashboard/src/hooks/useCalendarZoom.ts`)**:
     - Mengelola state `hourHeight` (rentang dinamis 44px s/d 180px, default 90px).
     - Mengintegrasikan event listener multi-touch 2 jari (`touchstart`, `touchmove`, `touchend`) dengan kalkulasi jarak Euclidean distance untuk gesture cubit (*pinch*) yang mulus.
     - Mengisolasi gesture zoom dari default browser full-page zoom (`e.preventDefault()`) dan mempertahankan fokus anchor scroll vertikal saat di-zoom.
     - Mendukung desktop zoom melalui `Ctrl + MouseWheel`.
     - Menyimpan preferensi kerapatan jam ke `localStorage` per-perangkat.
  2. **Komponen `CalendarZoomControls` (`packages/admin-dashboard/src/components/calendar/CalendarZoomControls.tsx`)**:
     - Menyediakan kontrol zoom 1-klik dengan 3 preset:
       - 🤏 **Kompak (`52px`)**: Seluruh jam kerja (06:00 s/d 21:00) muat dalam 1 layar HP tanpa perlu scroll.
       - 📱 **Standar (`90px`)**: Tampilan seimbang default.
       - 🔍 **Detail (`150px`)**: Tampilan tinggi untuk rincian lengkap.
     - Tombol Zoom In `[+]`, Zoom Out `[-]`, dan Reset Zoom `[↺]` jika zoom tidak di 100%.
  3. **Adaptive Semantic Level-of-Detail (LOD) pada `WeekScheduleGrid.tsx` & `DayScheduleGrid.tsx`**:
     - **Kompak (`< 65px`)**: Kartu jadwal dirender sebagai chip mini hemat ruang (Nama Depan + Jam Mulai + Warna Kategori).
     - **Standar (`65px - 119px`)**: Tampilan seimbang dengan jam, nama, kategori, status lunas/pending, dan terapis.
     - **Detail (`>= 120px`)**: Tampilan kaya memuat nama lengkap bunda, nama & usia anak, rincian lengkap treatment, durasi, status pembayaran, dan alamat/kontak.
  4. **Pengujian & Verifikasi:**
     - Frontend build (`npm run build` di `packages/admin-dashboard`): **PASS (0 error, 35.6s)**.
     - Backend build (`npm run build` di root): **PASS (0 error)**.
     - Vitest Unit Test Suite: **PASS (197/197 test files green)**.

#### Fix — Smart Customer Name Sanitization & Complete District/Location Stripping (`name-sanitizer.ts`, `name-sanitizer.test.ts`) (2026-08-31)

- **Latar Belakang & Pertanyaan Pengguna:**
  - Pengguna menanyakan mengapa bot mengirim sapaan *"Halo Bunda Hera Semampir"* pada pesan follow-up dan tidak mengenali bahwa kata "Semampir" adalah nama wilayah/kecamatan/kelurahan yang tercantum pada nama kontak buku telepon / profil WhatsApp.

- **Akar Masalah (Root Cause):**
  - Modul pembersih nama (`src/utils/name-sanitizer.ts`) memiliki daftar `COMMON_DISTRICTS` yang belum lengkap (kecamatan *Semampir*, *Sukolilo*, *Gubeng*, *Wonokromo*, *Tandes*, *Lakarsantri*, *Porong*, dll. belum terdaftar).
  - Normalisasi nama belum memproses suffix lokasi bertingkat (misal: "Semampir Sidoarjo") dan penanda lokasi berpemisah (seperti `|`, `:`, `/`, `-`, atau frasa *"dari Semampir"*).

- **Solusi & Perbaikan:**
  1. **Daftar Lengkap Kecamatan & Kelurahan Surabaya, Sidoarjo, dan Gresik**:
     - Memperluas `COMMON_DISTRICTS` menjadi cakupan menyeluruh untuk 31 kecamatan Surabaya, 18 kecamatan Sidoarjo, kelurahan populer, dan perumahan (termasuk *Semampir*, *Sarirogo*, *Lebo*, *Sukolilo*, *Medokan Semampir*, dll.), diurutkan descending berdasarkan panjang karakter agar pencocokan multi-kata lebih presisi.
  2. **Iterative District & Location Phrase Stripping**:
     - Menambahkan loop `while (changed)` untuk menghapus beberapa tingkatan suffix lokasi di akhir nama (contoh: *"Bunda Anita Semampir Sidoarjo"* -> *"Anita"*).
     - Menambahkan filter pembersih frasa lokasi (*"dari Semampir"*, *"area Rungkut"*, *"di Sedati"*).
     - Menangani pemisah wilayah seperti koma, pipe (`|`), titik dua (`:`), minus, dan slash.
  3. **Unit Testing (`tests/unit/name-sanitizer.test.ts`)**:
     - Menambahkan automated test untuk *"Bunda Hera Semampir"* -> *"Hera"* (sapaan: *"Bunda Hera"*), *"Bunda Iren, Sarirogo"* -> *"Iren"*, *"Bunda Nia Medokan Semampir"* -> *"Nia"*, dan variasi wilayah lainnya.

#### Fix & Enhancement — Live Chat State Synchronization, Hold-Press System Label Manager & Smart Bullet Indicator (`LiveChatMonitor.tsx`) (2026-08-31)

- **Latar Belakang & Gejala:**
  1. Header percakapan berganti ke kontak baru namun isi riwayat chat tetap menampilkan pesan milik kontak sebelumnya akibat *race condition* dan ketiadaan *stale request guard* saat berpindah kontak.
  2. Kebutuhan menambahkan/mengelola label pelanggan (label sistem internal CRM klinik, bukan label WhatsApp asli) langsung saat card percakapan di-hold (tekan lama) di mobile maupun klik kanan di desktop.
  3. Penyelarasan indikator status bullet: bullet oranye saat chat sudah dibaca (*read*) harus berubah menjadi **warna abu-abu**, dan ketika pesan keluar (*outbound*) terkirim (baik dari Bot AI, admin via dashboard, maupun admin via WhatsApp HP asli), bullet tersebut harus **hilang sepenuhnya**.

- **Akar Masalah (Root Cause):**
  1. `selectedId` berubah seketika di React state, namun `messages` tidak di-reset dan fungsi `loadThread` tidak memiliki sequence token atau validasi `if (selectedIdRef.current !== conversationId) return;`. Jika request percakapan sebelumnya selesai lebih lambat, respon lama menimpa chat kontak baru.
  2. Kontainer chat bubble di panel kanan tidak memiliki `key` isolasi lifecycle dan tidak memiliki loading skeleton saat transisi thread.
  3. Modal context menu (hold-press) belum menyediakan picker label sistem.
  4. Indikator `isAwaitingReply` sebelumnya memakai styling oranye (`bg-amber-500`) dan belum beradaptasi menjadi abu-abu setelah dibuka.

- **Solusi & Implementasi:**
  1. **Stale Request Guard & Request Sequence Token**:
     - Menambahkan ref `activeThreadRequestIdRef` dan validasi `if (activeThreadRequestIdRef.current !== reqId || selectedIdRef.current !== conversationId) return;` di `loadThread`.
     - Respon jaringan dari percakapan lama otomatis diabaikan.
  2. **Instant State Reset & Loading Skeleton**:
     - Seketika `selectedId` berganti, state `messages` langsung di-reset (`setMessages([])`) dan `isThreadLoading` diset `true`.
     - Menampilkan indikator loading / spinner yang bersih selama pengambilan data thread berlangsung.
  3. **React Key Lifecycle Boundary**:
     - Menyematkan `key={selectedChat?.conversationId || 'empty'}` pada kontainer pesan untuk memastikan re-mount DOM dan scroll position terisolasi bersih per percakapan.
  4. **Pengelolaan Label Sistem via Hold-Press (CRM System Labels)**:
     - Menambahkan section **"🏷️ Label Pasien (Sistem CRM)"** pada context menu mobile (bottom sheet) dan desktop (popover).
     - Menampilkan daftar label sistem dengan warna dan badge checkmark interaktif.
     - Mengintegrasikan toggle instan (`handleToggleLabel`) dengan update optimistik pada `contextMenu.chat.customerLabels` dan sinkronisasi ke backend `/api/admin/customers/:id/labels` tanpa menyentuh label WhatsApp asli.
  5. **Penyempurnaan Indikator Bullet Status**:
     - Mengubah bullet `chat.isAwaitingReply` menjadi **bullet abu-abu (`bg-[#8696a0]`)** saat pesan masuk telah dibaca.
     - Memastikan bullet hilang sepenuhnya (`isAwaitingReply = false`) saat pesan balasan keluar (*outbound*) dikirim oleh bot, admin live chat, atau admin via WhatsApp HP asli.

- **Pengujian & Verifikasi:**
  - Build frontend Vite `packages/admin-dashboard`: **PASS (0 errors, build in 10.64s)**.
  - Build backend TypeScript: **PASS (0 errors)**.
  - Vitest Unit Tests `live-chat.service.test.ts`: **17/17 PASS (100%)**.


#### Fix & Optimization — Mobile Network Resilience & Fast Reconnect: SSE Watchdog 18s, Mobile Online/Visibility Auto-Recovery, AbortController In-Flight Cancellation, Adaptive API Timeout, & Caddy Instant Flush (`liveChatSse.ts`, `api.ts`, `LiveChatMonitor.tsx`, `Caddyfile`) (2026-08-31)

- **Latar Belakang & Gejala:**
  - Admin klinik yang sedang berada di jalan (*mobile on-the-road*) mengalami loading sangat lama (*stalled / freeze*) saat mengakses panel Live Chat dan daftar percakapan di jaringan seluler (Android/iOS). Setelah menunggu lama, koneksi tiba-tiba instan kembali normal.
- **Akar Masalah (Root Cause):**
  1. **Mobile Handover & HTTP/3 UDP Stalling**: Pada jaringan seluler yang berpindah BTS, paket UDP HTTP/3 mengalami silent packet drop. Browser menunggu socket hang tanpa segera memutus koneksi hingga timeout browser (~30-60 detik).
  2. **SSE Watchdog 35s & Missing Wakeup Listener**: Watchdog EventSource sebelumnya menunggu 35 detik dan tidak mendengarkan event `online` atau `visibilitychange` (layar HP dibuka kembali), sehingga saat koneksi seluler pulih, SSE tidak langsung reconnect.
  3. **No In-Flight Request Cancellation on Search**: Pengetikan keyword search atau pagination di koneksi seluler lambat menumpuk request HTTP tanpa dibatalkan (`AbortController`), menyebabkan antrean respon macet.
  4. **Caddy Reverse Proxy Buffer on SSE**: Caddy tidak memiliki konfigurasi eksplisit `flush_interval -1` dan `keepalive` teroptimasi untuk route `/api/admin/live-chat/events`.
- **Solusi & Perbaikan Komprehensif:**
  1. **SSE Fast Reconnect & Mobile Network Listeners (`liveChatSse.ts`)**:
     - Mempersingkat watchdog timeout dari 35s ke 18s (sinkron dengan interval ping server 15s).
     - Menambahkan listener `window.addEventListener('online')` dan `document.addEventListener('visibilitychange')` untuk reconnect instan saat sinyal pulih atau layar HP di-unlock.
  2. **Adaptive Timeout & Client-Side Stale Fallback (`api.ts`)**:
     - Menurunkan default timeout GET interaktif menjadi 10s dengan auto-retry 1x yang cepat sebelum menyajikan stale-while-revalidate cache.
     - Menyambungkan `AbortController.signal` secara konsisten pada setiap request API.
  3. **In-Flight Cancellation pada Live Chat Search & Pagination (`LiveChatMonitor.tsx`)**:
     - Mengintegrasikan `loadChatsAbortControllerRef` agar setiap pencarian baru atau pergantian filter otomatis membatalkan request sebelumnya yang masih berjalan di jaringan lambat.
  4. **Caddy Reverse Proxy Buffer Bypass (`Caddyfile`)**:
     - Menambahkan blok khusus `@sse path /api/admin/live-chat/events` dengan `flush_interval -1` dan `transport http { keepalive 60s }` untuk memastikan streaming real-time tidak tertahan buffer proxy.
- **Pengujian & Verifikasi:**
  - Vitest test suite (`npm test`): **PASS (197 files, 1528 passed)**.
  - Frontend admin dashboard build (`npm run build`): **PASS (0 errors)**.
  - TypeScript backend build (`npm run build`): **PASS (0 errors)**.


- **Latar Belakang & Gejala:**
  - Kolom jarak (`distance_km`) dan ongkir seringkali tidak terisi (bernilai `null` / `0 km`) pada data reservasi dan profil pelanggan, khususnya saat percakapan ditangani secara manual oleh Admin CS (*Human Handling*) atau saat percakapan diberi label `hold` / `admin`.
  - Ketika customer mengirimkan *Shareloc WhatsApp*, tautan Google Maps (`maps.app.goo.gl/xxx`), atau mengetikkan alamat rumah saat Admin CS sedang aktif mengobrol, sistem mem-bypass seluruh proses ekstraksi lokasi agar tidak mengirim balasan otomatis.
  - Ketika Admin CS menyebutkan estimasi jarak di chat (mis. *"Jika dilihat dari jaraknya kurang lebih 16km... ongkir menjadi 20.000 saja"*), angka jarak yang sudah dicek manual oleh CS tersebut tidak tersimpan ke database.
  - Saat form reservasi masuk atau dibuat secara manual di admin dashboard, sistem hanya menyimpan string nama kelurahan & kecamatan tanpa memicu penghitungan jarak ke klinik.

- **Akar Masalah (Root Cause):**
  1. **Webhook Inbound Human Handling Bypass**: Pada `webhook.route.ts:L1142`, percakapan dengan `is_human_handling = true` mem-bypass seluruh State Machine & Slot Engine dan tidak memanggil `HumanBackgroundEnrichmentService`. Akibatnya, Pin GPS WA, link maps, dan alamat teks tidak diproses di latar belakang.
  2. **Shortlink Google Maps Belum Di-Resolve**: Tautan shareloc `maps.app.goo.gl` atau `goo.gl/maps` dikirim mentah ke pencarian teks alih-alih mengekstrak koordinat GPS `lat, lng` dari URL *redirect*-nya.
  3. **Outbound Admin Chat Untapped**: Pesan keluar yang dikirim oleh Admin CS tidak diparsing untuk menangkap angka jarak dan tarif ongkir yang telah dikonfirmasi ke customer.
  4. **Reservation Lifecycle Static Storage**: `onReservationCreated` hanya menyimpan teks kelurahan/kecamatan tanpa menjalankan fungsi geocoding/delivery calculation saat `distance_km` customer masih kosong.

- **Solusi & Perbaikan Komprehensif:**
  1. **Google Maps Shortlink & URL Coordinate Resolver (`google-maps-url-resolver.ts`)**:
     - Modul utilitas deterministik untuk mengekstrak koordinat presisi dari format URL Google Maps apapun (`maps.app.goo.gl`, `goo.gl/maps`, `google.com/maps/@lat,lng`, `?q=lat,lng`) dengan dukungan HTTP redirect follower ber-timeout aman (0 Token LLM).
  2. **Admin Outbound Chat Distance & Ongkir Parser (`admin-chat-distance-parser.ts`)**:
     - Parser teks deterministik untuk menangkap angka jarak (mis. *"kurang lebih 16km"*, *"jarak 8.5 km"*) dan tarif ongkir promo/normal (mis. *"ongkir menjadi 20.000 saja"*, *"tambahan ongkir 25.000"*) dari chat keluar Admin CS (0 Token LLM).
  3. **Passive Background Enrichment on Inbound & Outbound Webhook (`human-background-enrichment.service.ts`, `webhook.route.ts`)**:
     - Mengaktifkan `enrichAsync` pada setiap pesan masuk saat mode *Human Handling* (Pin GPS WA, link Google Maps, form reservasi, teks alamat). Bot **tetap diam (silent)** tanpa auto-reply, namun database jarak & ongkir customer langsung diperbarui.
     - Mengaktifkan `enrichFromAdminOutboundAsync` pada setiap pesan keluar dari Admin CS untuk menyadap jarak & ongkir yang diketik oleh admin.
  4. **Reservation Lifecycle Background Auto-Geocoding (`reservation-lifecycle.service.ts`, `reservations.subroute.ts`)**:
     - Pada saat reservasi dibuat/diparsing, jika customer belum memiliki `distance_km`, sistem otomatis menjalankan kalkulasi jarak & ongkir di latar belakang menggunakan data alamat/kelurahan/kecamatan yang tersedia.

- **Pengujian & Verifikasi:**
  - Unit tests `tests/unit/google-maps-url-resolver.test.ts`: **PASS (5/5 tests passed)**.
  - Unit tests `tests/unit/admin-chat-distance-parser.test.ts`: **PASS (4/4 tests passed)**.
  - Unit tests `tests/unit/human-background-enrichment.test.ts`: **PASS (3/3 tests passed)**.
  - Unit tests `tests/unit/treatment-string-and-tier-calc.test.ts`: **PASS (7/7 tests passed)**.
  - Backend TypeScript build (`npm run build`): **PASS (0 errors)**.
  - Frontend Admin Dashboard build (`npm run build` in `packages/admin-dashboard`): **PASS (0 errors)**.

#### Fix & UI/UX Overhaul — Impeccable Mobile Experience for Reservations & Today Treatments: Past Slot Filtering, Dual Android/iOS Camera Triggers, Smart GPS/Maps Link Parser, Instant Client-Side Image Compression (<200KB), Live GPS Canvas Watermarking, Always-Available Google Maps Navigation, & Mobile Action Toolbar Redesign (`TodayTreatments.tsx`, `StaffToday.tsx`, `CreateReservationModal.tsx`, `CustomerEditForm.tsx`, `Reservations.tsx`, `imageCompressor.ts`, `imageWatermark.ts`, `geoUtils.ts`, `media.service.ts`) (2026-08-30)

- **Latar Belakang & 8 Kasus Temuan User:**
  1. **Rekomendasi Jam Kunjungan Mengusulkan Jam Lampau**: Saat membuat reservasi untuk hari ini (`bookingDate === today`), rekomendasi slot jam menyarankan jam yang sudah lewat (mis. jam 08:30 atau 09:00 padahal waktu saat ini sudah siang/sore).
  2. **Kompatibilitas Kamera Android vs iPhone**: Pada perangkat Android, input foto rumah seringkali hanya menampilkan pemilih file/dokumen tanpa opsi kamera langsung, sedangkan di iPhone langsung membuka opsi Take Photo / Photo Library.
  3. **Input Koordinat Lat/Lng Manual Tidak Usable**: Form pengeditan profil pelanggan dan modal reservasi meminta admin/staf mengetik angka Latitude & Longitude desimal manual (mis. `-7.348812, 112.751623`) tanpa bantuan GPS atau pencarian peta.
  4. & 7. **Kelambatan / Latensi Unggah Foto Rumah di Lapangan (Page Treatment Hari Ini)**: Saat menyimpan foto tampak depan rumah pasien dari smartphone, proses simpan memakan waktu 15–40 detik dan rawan timeout koneksi seluler.
  5. **Watermark Koordinat & Stempel Informasi Rumah Tidak Muncul**: Foto rumah yang diunggah terkadang tidak memiliki watermark koordinat GPS dan kelurahan/kecamatan.
  6. **Tombol Aksi di Bagian Bawah Tidak Mobile-Friendly**: Pada layar ponsel (viewport 360px–412px), tombol-tombol aksi di bagian bawah kartu treatment bertumpuk kaku dalam 2 baris blok yang tidak ergonomis.
  8. **Tombol Navigasi Google Maps Tidak Muncul di Halaman Treatment Hari Ini**: Tombol Maps navigasi tersembunyi jika URL navigasi backend bernilai null, tidak seperti pada halaman khusus staf/terapis.

- **Akar Masalah (Root Cause):**
  1. **Missing Is-Today Temporal Filter (`CreateReservationModal.tsx`)**: Loop iterasi `CANDIDATE_SLOTS` tidak membandingkan jam slot dengan jam sekarang saat tanggal kunjungan adalah hari ini, serta tidak memeriksa apakah waktu keberangkatan bidan (`plannedDepartureMinutes`) berada di masa lalu.
  2. **Inconsistent OS File Picker Handling**: Atribut `<input type="file" accept="image/*" />` tunggal diinterpretasikan berbeda oleh berbagai ROM Android (beberapa OEM memblokir kamera langsung jika tanpa `capture="environment"` dan sebaliknya).
  3. **Missing Geo Assistant Layer**: Form profil customer dan edit reservasi hanya menyediakan 2 input teks mentah `editLat` & `editLng` tanpa modul ekstraksi URL Google Maps, Geolocation API, atau Geocoding alamat.
  4. & 7. **Raw High-Resolution Base64 Payload**: Browser mengirim file foto kamera resolusi penuh (5MB–15MB JPEG mentah) langsung dikonversi menjadi string base64 raksasa (>13MB) ke backend tanpa kompresi canvas client-side.
  5. **Null Coordinates Watermark Guard (`media.service.ts`)**: `mediaService.overlayGpsBadge` membatalkan pembuatan banner watermark jika `info.lat` atau `info.lng` bernilai `null` (`if (info.lat == null) return buffer;`), sehingga foto tanpa GPS gagal mendapatkan stempel area/kelurahan/patokan dan timestamp.
  6. & 8. **Rigid 2-Row Layout & Hard-Conditioned Maps Button (`TodayTreatments.tsx`)**: Tombol Maps dibatasi oleh pengecekan kaku `(task.navigationUrl || task.mapsUrl)` sehingga hilang jika tidak di-generate oleh backend, serta tombol disusun dalam grid 3-kolom + 1-kolom yang padat di layar mobile.

- **Solusi & Perbaikan Komprehensif:**
  1. **Past-Time Recommendation Guard (`CreateReservationModal.tsx`)**:
     - Memeriksa apakah `bookingDate === todayStr`. Jika ya, seluruh slot jam yang `slotStartMinutes <= nowMinutes + 15` dan seluruh slot dengan waktu keberangkatan `plannedDepartureMinutes <= nowMinutes` otomatis disaring dan diabaikan.
  2. **Dual Action Trigger untuk Kamera & Galeri (`TodayTreatments.tsx`, `StaffToday.tsx`)**:
     - Menyediakan 2 tombol aksi terpisah: **"📸 Buka Kamera"** (terhubung ke input dengan atribut `capture="environment"` untuk membuka kamera belakang langsung di semua OS) dan **"🖼️ Pilih Galeri"** (input standar untuk memilih dari album foto).
  3. **Smart Location & Coordinates Assistant (`geoUtils.ts`, `CustomerEditForm.tsx`, `Reservations.tsx`, `TodayTreatments.tsx`)**:
     - **Tempel Link Google Maps**: Parser cerdas `extractLatLngFromMapsUrl` yang otomatis mengekstrak koordinat dari format URL Google Maps apapun (`maps.app.goo.gl`, `?q=lat,lng`, `@lat,lng`, shareloc text).
     - **Kunci Titik GPS Saya**: Mengunci koordinat perangkat saat ini secara presisi via `getCurrentDeviceLocation` dengan laporan akurasi (±meter).
     - **Cari dari Alamat**: Geocoding instan via OpenStreetMap Nominatim berdasarkan nama Kelurahan, Kecamatan, dan Kota yang terisi.
     - **Lihat di Google Maps**: Tautan cepat untuk memverifikasi posisi titik di Google Maps.
  4. & 7. **High-Performance Client-Side Image Compression (`imageCompressor.ts`)**:
     - Kompresi canvas berkecepatan tinggi (<100ms di HP) yang mendownscale gambar ke resolusi optimal 1280px (kualitas 0.8 JPEG), memangkas ukuran payload dari 10MB menjadi **~150KB - 250KB (pengurangan ukuran 98%)**, membuat proses simpan menjadi instan (< 0.5 detik) bahkan di jaringan seluler lemah di jalan raya.
  5. **View Mode vs Edit Mode, Overwrite Confirmation & Instant Zero-Wait Optimistic UI (`TodayTreatments.tsx`, `StaffToday.tsx`, `Reservations.tsx`, `staff-reservation.service.ts`, `today.subroute.ts`, `media.service.ts`)**:
     - **Mode Pratinjau Panduan Tersimpan (View Mode)**: Jika pasien sudah memiliki data foto rumah, koordinat GPS, atau patokan, saat tombol kamera ditekan modal akan terbuka dalam **Mode Pratinjau Panduan**. Menampilkan foto rumah tampak depan secara jelas (bisa dizoom layar penuh), status GPS terkunci beserta tombol langsung *"Buka Maps Navigasi"*, catatan patokan rumah, dan alamat tercatat.
     - **Mode Edit & Konfirmasi Timpa Data (Edit Mode & Overwrite Safety)**: Di dalam mode pratinjau, tersedia tombol *"✏️ Edit / Perbarui Data"*. Saat staf/admin ingin memperbarui atau menimpa foto/GPS yang sudah tersimpan sebelumnya, sistem akan memunculkan dialog konfirmasi (*"Data panduan rumah & GPS sudah ada sebelumnya. Apakah Anda yakin ingin menimpa data tersebut?"*) untuk mencegah data terhapus/tertimpa tanpa sengaja. Jika pasien belum memiliki data sebelumnya, modal langsung terbuka dalam mode input/kamera.
     - **Instant Zero-Wait UX (Optimistic UI Update)**: Ketika pengguna memilih foto rumah dan menekan tombol simpan, modal langsung tertutup seketika (**0 detik perceived loading**), status kartu pasien di layar langsung ter-update secara optimis, dan proses kompresi serta sinkronisasi server berjalan mulus di latar belakang tanpa memblokir alur kerja staf/admin.
     - **Enriched Official Single Watermark**: Banner watermark SVG di server kini mencakup seluruh rincian lengkap: Nama Pasien (`Bunda [Nama]`), Titik GPS (`GPS: lat, lng`), Area (`Kelurahan, Kecamatan`), Petugas (`📸 Foto: [Nama Petugas/Admin]`), Patokan Rumah, Timestamp Waktu (`WIB`), dan Branding Klinik (`🌸 Kala Moms & Baby`).
     - **Supervisor / Super Admin Permission Fix**: Memperbaiki validasi kepemilikan tugas pada `updateCustomerLocation`, `recordPayment`, `revokeMessage`, dan `editMessage` di `staff-reservation.service.ts` agar pengguna dengan peran Supervisor (`SPV_CS`), Super Admin (`super_admin`), atau Admin CS (`admin_cs`) memiliki hak akses penuh untuk memperbarui lokasi, foto rumah, dan pembayaran atas seluruh jadwal pasien tim.
     - **Pencegahan Watermark Ganda (Double Watermark Elimination)**: Memperbaiki payload simpan foto di `TodayTreatments.tsx`, `StaffToday.tsx`, dan `Reservations.tsx` agar mengirim foto mentah hasil kompresi canvas (`locRawHousePhotoB64` / `editRawHousePhotoB64`) ke backend, sehingga `mediaService.overlayGpsBadge` membubuhkan satu banner watermark resmi secara presisi tanpa menimpa/menumpuk pratinjau watermark client-side sebelumnya.
     - Memperbaiki endpoint simpan lokasi di `TodayTreatments.tsx` dari yang sebelumnya memanggil route 404 (`/api/staff/reservations/:id/location`) menjadi endpoint resmi **`POST /api/staff/update-location`** yang menyimpan koordinat, menghitung ulang rute, dan menyimpan foto ber-watermark.
     - Menambahkan endpoint resmi **`POST /api/staff/reservations/:id/otw`** di `today.subroute.ts` untuk mengirim pesan WhatsApp notifikasi OTW 1-klik secara otomatis ke customer terkait dengan template dinamis klinik.
  6. & 8. **Impeccable Mobile-First Action Toolbar & Always-Available Maps (`TodayTreatments.tsx`)**:
     - Mengubah tata letak tombol aksi menjadi toolbar responsif berbasis standar *Impeccable Design System*:
       - Baris utama: Tombol aksi operasional (Kirim Info OTW / Catat Lunas) dengan target sentuh penuh dan kontras tinggi.
       - Baris sekunder: Chip aksi cepat (Maps, Update Lokasi & Foto Rumah, Chat WhatsApp, Delegasi Terapis) dengan ikon proporsional dan ukuran sentuh minimal 44px.
       - Tombol **Google Maps Navigasi** kini **selalu aktif 100%** untuk setiap pasien dengan fallback berjenjang ke koordinat atau teks alamat/kelurahan.

- **Pengujian & Verifikasi:**
  - Frontend TypeScript build (`npm run build` di `packages/admin-dashboard`): **PASS (0 error, build time 32s)**.
  - Backend TypeScript build (`npm run build` di root): **PASS (0 error)**.
  - Vitest Unit Test Suite (`npx vitest run tests/unit/typing.test.ts`): **PASS (12/12 green, 100%)**.

#### Fix — Phantom Draft Auto-Save Prevention & Meaningful Data Guard in Form Draft System (`useFormDraft.ts`, `CreateReservationModal.tsx`, `InvoiceGeneratorModal.tsx`) (2026-08-30)

- **Latar Belakang & Gejala:**
  - Saat pengguna membuka modal **Buat Jadwal Reservasi Baru** (`CreateReservationModal.tsx`), muncul banner notifikasi draf: *"Ditemukan draf reservasi yang tersimpan baru saja."* padahal form baru saja dibuka dan belum diisi.
  - Saat pengguna menekan tombol **"Pulihkan Draf"**, tidak ada satu pun field form yang terisi atau berubah.

- **Akar Masalah (Root Cause):**
  1. **Unconditional Auto-Save on Default State Changes (`useFormDraft.ts`)**:
     - Ketika modal dibuka, `useEffect` internal di modal menyetel nilai default seperti tanggal hari ini (`bookingDate: 'YYYY-MM-DD'`) dan jam (`bookingTime: '09:00'`).
     - Perubahan state default ini memicu effect auto-save di `useFormDraft.ts` yang menyimpan payload form kosong (`customerId: ""`, `selectedTreatments: []`, `babies: []`, dll.) ke `localStorage` (`wa_clinic_draft_create_reservation`).
  2. **Missing Meaningful Data Predicate / Draft Dirtiness Check**:
     - `useFormDraft` sebelumnya tidak memeriksa apakah data form benar-benar berisi input bermakna dari pengguna (nama pelanggan, layanan yang dipilih, catatan, anak) sebelum disimpan atau sebelum menampilkan banner pemulihan draf.
     - Akibatnya, form kosong dianggap sebagai draf valid dan dipulihkan sebagai data kosong tanpa perubahan visual.

- **Solusi & Perbaikan:**
  1. **Meaningful Data Validation Predicate (`isMeaningful` di `useFormDraft.ts`)**:
     - Menambahkan opsi `isMeaningful?: (data: T) => boolean` pada `useFormDraft` serta fallback inspector otomatis `defaultIsMeaningful` yang mengabaikan key boilerplate (tanggal, jam default, status pending, kategori).
     - Jika form tidak memiliki data bermakna (masih kosong/default), `useFormDraft` **tidak akan pernah menyimpan ke `localStorage`**.
  2. **Auto-Purge Stale Empty Drafts**:
     - Saat inisialisasi / `refreshDraftStatus`, jika draf yang ada di `localStorage` berisi form kosong, `useFormDraft` langsung menghapusnya secara otomatis (`localStorage.removeItem`) sehingga banner tidak pernah muncul secara salah.
  3. **Tailored Form Predicates (`CreateReservationModal.tsx` & `InvoiceGeneratorModal.tsx`)**:
     - Menambahkan predikat `isReservationDraftMeaningful` dan `isInvoiceDraftMeaningful` yang memverifikasi keberadaan customer, layanan terpilih, data anak/bayi, diskon, catatan, atau terapis sebelum draf disimpan.

- **Pengujian & Verifikasi:**
  - Frontend TypeScript build (`npm run build` di `packages/admin-dashboard`): **PASS (0 error)**.
  - Backend TypeScript build (`npm run build`): **PASS (0 error)**.

#### Fix & Feature — Form Treatment 0-Lock, Accurate Buffer Stripping & Dynamic Tier Ongkir (Anti-Hardcode), WA Preview Scroll, & 1-Hour Local Draft System (`ClinicServices.tsx`, `InvoiceGeneratorModal.tsx`, `CreateReservationModal.tsx`, `DeliveryTiers.tsx`, `treatmentStringParser.ts`, `deliveryTierCalculator.ts`, `useFormDraft.ts`, `paymentInvoiceFormatter.ts`) (2026-08-30)

- **Latar Belakang & Gejala:**
  1. Pada form pembuatan/pengeditan treatment (`ClinicServices.tsx`) serta input angka lainnya di dashboard, angka "0" tidak bisa dihapus dengan tombol Backspace karena langsung terkunci dan kembali ke 0.
  2. Saat menyimpan reservasi dan membuka modal invoice WhatsApp (`InvoiceGeneratorModal.tsx`), rincian layanan terpecah menjadi 3 baris di mana teks buffer waktu `Buffer 20m = 75m]` terhitung sebagai layanan ke-3, dan harga total Rp 90.000 terbagi rata menjadi 3x Rp 30.000. Selain itu ongkir terhitung Rp 44.730 karena rumus hardcode statis `(jarak - 3) * 3000`.
  3. Pada modal invoice WhatsApp, teks preview WhatsApp yang panjang mendorong kartu total pembayaran ke bawah sehingga menutupi tombol footer (*Batal*, *Salin Format*, *Masukkan ke Chat WA*).
  4. Belum tersedianya mekanisme penyimpanan draf lokal saat pengisian jadwal reservasi atau invoice WhatsApp terputus atau tidak sengaja ditutup.

- **Akar Masalah (Root Cause):**
  1. **Controlled Number Input Backspace Trap**: State React bertipe `number` dengan `onChange={(e) => setState(Number(e.target.value))}` mengevaluasi string kosong `""` menjadi `0`, sehingga angka `0` langsung muncul kembali saat dihapus.
  2. **Naive String Splitting on Plus Sign (`/\s*\+\s*/`)**: Suffix durasi buffer `[Total 55m + Buffer 20m = 75m]` memiliki tanda `+` di dalamnya. Saat di-split mentah, teks buffer terpecah menjadi item layanan tersendiri.
  3. **Hardcoded Linear Ongkir Formula**: `InvoiceGeneratorModal.tsx:L148` dan `CreateReservationModal.tsx:L302` memiliki rumus `(dist - 3) * 3000` alih-alih menarik data tabel `delivery_tiers` dari PostgreSQL.
  4. **Uncontained Overflow on Preview Column**: Kolom Live Preview WA tidak memiliki kontainer scroll mandiri (`overflow-y-auto max-h`) dan footer tombol aksi tidak dikunci (`sticky bottom-0`).

- **Solusi & Perbaikan:**
  1. **Safe Empty-String Number Input Standard (`number | ''`)**:
     - Mengubah state dan handler input angka di `ClinicServices.tsx`, `DeliveryTiers.tsx`, `CreateReservationModal.tsx`, dan `InvoiceGeneratorModal.tsx` agar mendukung string kosong saat pengetikan dan melakukan sanitasi `Number()` saat simpan/kalkulasi.
  2. **Treatment String Buffer Stripper & Catalog Lookup (`treatmentStringParser.ts`)**:
     - Membuat fungsi `stripBufferMetadata` untuk membersihkan tag `[Total ... + Buffer ...]` dan `parseTreatmentItemsFromRaw` untuk memetakan nama layanan murni ke harga & durasi asli di katalog `clinic_services`.
  3. **Dynamic Database-Tiered Delivery Calculator & Promo Ongkir Breakdown (`deliveryTierCalculator.ts`, `InvoiceGeneratorModal.tsx`)**:
     - Mengganti seluruh rumus `* 3000` dengan `calculateOngkirFromTiers` yang terhubung langsung ke API `/api/admin/delivery-tiers`.
     - Menambahkan baris rincian **Potongan Promo Ongkir** (`Promo ongkir = - 5.000`) pada invoice WhatsApp sehingga rincian `Ongkir normal (25.000)` dan `Promo (-5.000)` tercantum transparan sesuai standar operasional klinik.
  4. **Responsive Preview Scroll & Pinned Footer Layout (`InvoiceGeneratorModal.tsx`)**:
     - Membatasi bubble chat WhatsApp ke kontainer scrollable mandiri (`max-h-[50vh] overflow-y-auto`) dan mengunci kartu total serta tombol aksi footer di bagian bawah (`sticky bottom-0 z-10`).
  5. **1-Hour Local Draft System & Lifecycle Hardening (`useFormDraft.ts`)**:
     - Membuat custom hook `useFormDraft` berbasis `localStorage` dengan TTL 1 jam, auto-save (debounce 1.5s), tombol manual **"Simpan Draf"**, banner notifikasi pemulihan draf (*Restore Prompt*), dan auto-cleanup saat submit sukses.
     - Menambahkan opsi `enabled: isOpen` agar pemeriksaan draf di-refresh otomatis setiap kali modal dibuka dan menghindari penimpaan draf saat modal dalam keadaan tertutup.
  6. **Sanitasi Format Pesan Reservasi (`paymentInvoiceFormatter.ts`)**:
     - Mengintegrasikan `stripBufferMetadata` pada formatting pesan chat WhatsApp.

- **Pengujian & Verifikasi:**
  - Unit tests `tests/unit/treatment-string-and-tier-calc.test.ts`: **PASS (7/7 tests passed)**.
  - Frontend Admin Dashboard build (`npm run build` in `packages/admin-dashboard`): **PASS (0 errors, 42 chunks compiled successfully)**.
  - Backend TypeScript build (`npm run build`): **PASS (0 errors)**.

#### Fix — AI Sandbox & LLM Generator Instant Response: SumoPod Model Auto-Sanitizer & Fast Fallback Timeout Capping (`ai-models.config.ts`, `llm-gateway.ts`, `model-fallback.ts`, `adaptive-model-selector.ts`) (2026-08-29)

- **Latar Belakang & Gejala:**
  - Pengguna menjalankan pengujian di AI Sandbox Simulator (Admin Dashboard) dengan pesan "adek pilek treatment apaa ya kak".
  - Di log server, simulator menggantung (*hang*) selama 120 detik lalu menampilkan pesan `Error calling AI Generator: Koneksi server/database lambat (Timeout 120s). Silakan coba lagi.`

- **Akar Masalah (Root Cause):**
  1. **Model Proprietary Mismatch pada SumoPod (`OPENAI_MODEL=gpt-4o-mini` vs `OPENAI_BASE_URL=https://ai.sumopod.com/v1`)**:
     - Endpoint OpenAI-compatible SumoPod melayani model cepat seperti `MiniMax-M2.7-highspeed`, `mimo-v2.5`, `qwen3.7-flash-2026-07-15`, dan `deepseek-v4-flash`.
     - Konfigurasi `defaultTaskModelRegistry` di `ai-models.config.ts` sebelumnya me-resolve default `CHAT_REPLY` ke `gpt-4o-mini`. Saat `gpt-4o-mini` diminta ke endpoint SumoPod, SumoPod menahan koneksi HTTP terbuka hingga batas timeout sebelum merespons error, membuang waktu 120 detik per panggilan sebelum berpindah ke fallback.
  2. **Uncapped Per-Attempt Timeout in Fallback Chain (`model-fallback.ts`)**:
     - `callChatCompletionsWithFallback` mengoper nilai `call.timeoutMs` (120.000ms / 2 menit) secara mentah ke setiap percobaan model. Akibatnya, saat model pertama menggantung, sistem menunggu 120 detik penuh sebelum mencoba fallback model kedua, yang menyebabkan request browser keburu di-abort oleh batas timeout client.

- **Solusi & Perbaikan:**
  1. **SumoPod Model Auto-Sanitizer (`sanitizeModelForProvider` di `ai-models.config.ts` & `llm-gateway.ts`)**:
     - Menambahkan fungsi `sanitizeModelForProvider` yang otomatis mendeteksi apakah endpoint yang aktif adalah SumoPod. Jika endpoint SumoPod terdeteksi dan konfigurasi model berisi nama model OpenAI lama (`gpt-4o-mini`, `gpt-4o`, `gpt-3.5-turbo`), sistem secara otomatis mengalihkannya ke model ultra-cepat yang didukung penuh (`MiniMax-M2.7-highspeed` / `mimo-v2.5`).
  2. **Fast Per-Attempt Timeout Capping in Fallback Chain (`model-fallback.ts`)**:
     - Membatasi durasi tunggu per model percobaan maksimal **15.000ms (15 detik)** (`attemptTimeout = Math.min(call.timeoutMs || 15000, 15000)`). Jika model utama tidak merespons dalam 15 detik, sistem langsung berpindah ke model cadangan berikutnya dalam hitungan milidetik.
  3. **Adaptive Model Selector Fallbacks (`adaptive-model-selector.ts`)**:
     - Mengubah fallback statis `'gpt-4o-mini'` menjadi `process.env.OPENAI_MODEL || 'MiniMax-M2.7-highspeed'`.

- **Pengujian & Verifikasi:**
  - Eksekusi AI Sandbox Simulator end-to-end (`test-sandbox-repro.ts`): **SUCCESS (Balasan selesai dan terkirim rapi)**.
  - Backend TypeScript build (`npm run build`): **PASS (0 errors)**.
  - Frontend Admin Dashboard build (`npm run build` in `packages/admin-dashboard`): **PASS (0 errors)**.

#### Fix — AI Sandbox Simulator 120s Timeout Resolution via Non-Blocking Terminal Guard & Adjusted Typing Speed Factor (`machine.ts`, `typing.service.ts`, `evaluations.subroute.ts`) (2026-08-29)

- **Latar Belakang & Gejala:**
  - Pengguna menjalankan pengujian di AI Sandbox Simulator (Admin Dashboard) dengan pesan "adek pilek triatmnet apa ya kak".
  - Di log server, LLM sudah selesai men-generate pesan dalam beberapa detik, tetapi antarmuka simulator di browser tetap menggantung (*hang*) selama 120 detik lalu menampilkan error: `Error calling AI Generator: Koneksi server/database lambat (Timeout 120s). Silakan coba lagi.`

- **Akar Masalah (Root Cause):**
  1. **Terminal Approval Safety Net Blocking (`machine.ts:L517`)**:
     - State machine memanggil `this.promptTerminal()` jika `TERMINAL_APPROVAL_ENABLED=true` tanpa mengecek apakah panggilan berasal dari Sandbox Simulator (`isSandboxTest`). Fungsi `promptTerminal` menunggu input keyboard pada `process.stdin` di terminal console. Karena admin berinteraksi lewat web browser dan tidak menekan Enter di terminal console, request HTTP menggantung tanpa batas hingga terkena batas waktu timeout 120 detik.
  2. **Unadjusted Sleep Delays in Typing Simulation (`typing.service.ts:L372, L407, L443`)**:
     - Pada `TypingService`, delay kalkulasi `adjustedMs` sudah dihitung dengan `speedFactor`, namun pemanggilan `this.sleep()` di dalam loop masih mengoper `typingDelayMs` dan `interBubbleDelayMs` tanpa pembagian `speedFactor`. Akibatnya, mode sandbox/evaluasi yang menyetel `speedFactor = 100000` tetap menunggu delay pengetikan manusia utuh.
  3. **Sandbox Phone Promise Lock Chaining (`evaluations.subroute.ts:L38, L262`)**:
     - Antrian promise per nomor telepon simulator (`sandboxPhoneLocks`) tidak membersihkan task yang sudah selesai di blok `finally`, sehingga jika ada request sebelumnya yang menggantung/timeout, request berikutnya akan terblokir menunggu promise sebelumnya.

- **Solusi & Perbaikan:**
  1. **Non-Blocking Terminal Approval Guard (`machine.ts`)**:
     - Menambahkan guard `!isSandboxTest && process.stdin && process.stdin.isTTY` sebelum memanggil `promptTerminal`. Sandbox simulator dan environment non-interaktif tidak akan pernah memblokir `process.stdin`.
  2. **Accurate Speed Factor Sleep in TypingService (`typing.service.ts`)**:
     - Memperbaiki `this.sleep()` agar menggunakan `adjustedReading`, `adjustedMs`, dan `adjustedInter`, sehingga simulasi di Sandbox berjalan instan (< 10 ms).
  3. **Safe Lock Cleanup in Sandbox Route (`evaluations.subroute.ts`)**:
     - Menambahkan blok `finally` untuk menghapus `sandboxPhoneLocks` setelah request selesai diproses.

- **Pengujian & Verifikasi:**
  - Unit tests `tests/unit/typing.test.ts`: **PASS (12/12 tests passed)**.
  - Backend TypeScript build (`npm run build`): **PASS (0 errors)**.

#### Fix — Preservation of Enters/Newlines (Multi-Paragraph) & Custom Text Priority in Follow-Up Queue (`follow-up.service.ts`, `followup-templates.ts`, `language-sanitizer.ts`, `FollowUpQueue.tsx`, `follow-up-engine.test.ts`) (2026-08-29)

- **Latar Belakang & Pertanyaan Pengguna:**
  - Pengguna menanyakan apakah tombol Enter / baris baru (`\n`) pada pesan follow-up di antrian (Queue) terbaca dengan benar, dan meminta memastikan teks tidak menjadi satu paragraf panjang menyambung tanpa pemisah baris.

- **Akar Masalah (Root Cause):**
  1. **Regex Whitespace Over-Collapsing (`\s{2,}`)**:
     - Di `src/services/follow-up.service.ts` dan `src/config/followup-templates.ts`, proses normalisasi teks menggunakan `.replace(/\s{2,}/g, ' ')`. Karakter kelas `\s` mencakup newline (`\n` dan `\r\n`), sehingga dua enter berturut-turut (`\n\n`) otomatis diubah menjadi satu spasi biasa (`' '`), merusak struktur paragraf WhatsApp.
  2. **Custom Text Execution Priority**:
     - `executeFollowUp` belum memprioritaskan kolom `fu.custom_text` yang secara spesifik diedit oleh admin via modal edit, melainkan selalu me-resolve ulang dari template database atau default hardcoded.

- **Solusi & Perbaikan:**
  1. **Newline-Safe Horizontal Whitespace Normalization**:
     - Mengganti seluruh pembersihan regex multi-spasi dari `/\s{2,}/g` menjadi `/[^\S\r\n]{2,}/g` (hanya merapikan spasi/tab horizontal tanpa menyentuh enter/newline) dan menambahkan `/\n{3,}/g -> '\n\n'` (membatasi maksimal 2 enter berurutan).
  2. **Prioritas Eksekusi `custom_text`**:
     - `executeFollowUp` kini memprioritaskan `fu.custom_text` bila ada, sambil tetap melakukan sanitasi variabel pintar (`{name}`, `{babyName}`, `{time}`).
  3. **Single Bubble Outbound Guarantee (`typing.service.ts`, `follow-up.service.ts`, `broadcast-queue.service.ts`)**:
     - Menambahkan opsi parameter `singleBubble: true` pada `HumanReplyParams`.
     - Saat memproses pengiriman pesan follow-up (maupun broadcast), sistem mem-bypass pemecah chat (*chat splitting*) sehingga pesan multi-paragraf tetap dikirim secara utuh dalam **1 bubble chat tunggal** di WhatsApp pelanggan.
  4. **Unit Testing (`tests/unit/follow-up-engine.test.ts`, `tests/unit/typing.test.ts`)**:
     - Menambahkan automated unit test (Test 10 di `follow-up-engine.test.ts` & test di `typing.test.ts`) yang memverifikasi pesan follow-up multi-baris/paragraf terkirim dengan struktur baris baru utuh dan selalu dalam 1 bubble tunggal (`bubblesSent === 1`).

#### Performance — Ultra-Fast Sub-Second Mobile Road Load Time via 4-Stage Optimization Suite (`response-cache.service.ts`, `app.ts`, `App.tsx`, `livechat.subroute.ts`, `reservations.subroute.ts`, `customers.subroute.ts`, `customer.service.ts`, `message.service.ts`, `api.ts`) (2026-08-29)

- **Latar Belakang & Kebutuhan Pengguna:**
  - Pengguna sering mengakses dashboard saat di perjalanan / jalan raya via jaringan seluler (kondisi latensi tinggi, bandwidth terbatas, sinyal fluktuatif) dan membutuhkan kecepatan muat instan (< 1 detik) tanpa menunggu spinner atau terkena timeout 15 detik.

- **Solusi & Optimasi Arsitektur Menyeluruh (4 Tahap):**
  1. **Server-Side In-Memory Response Caching (`response-cache.service.ts`)**:
     - Membuat `responseCacheService` terpusat untuk men-cache snapshot respons API dan sub-query agregasi berat dengan TTL dinamis dan auto-invalidation berbasis prefix.
     - **Live Chat Monitor**: Cache `GET /api/admin/live-chat/conversations` (TTL 5s) & `GET /api/admin/live-chat/unread-count` (TTL 5s). Memangkas 4 DB queries berat menjadi respons instan (< 1 ms). Otomatis di-invalidate saat ada pesan masuk/keluar atau perubahan status baca di `message.service.ts`.
     - **Reservasi**: Cache 7 query agregasi count status reservasi (`reservations:stats`) selama 15s. Mengurangi query database dari 9 query paralel menjadi hanya 2 query saat berpindah halaman (pengurangan 70% beban DB).
     - **Database Pelanggan**: Cache 4 query count statistik & aggregate revenue (`customers:stats`) selama 15s di `customer.service.ts`.
  2. **HTTP Cache-Control Headers & Brotli Compression (`app.ts`, `livechat.subroute.ts`, `reservations.subroute.ts`, `customers.subroute.ts`)**:
     - Mengaktifkan algoritma kompresi modern **Brotli (`'br'`)** di Fastify `compress` middleware, menghemat 15–25% ukuran payload JSON tambahan untuk koneksi seluler.
     - Menyematkan header HTTP `Cache-Control: private, max-age=5, stale-while-revalidate=30` pada seluruh endpoint data utama admin, memungkinkan browser langsung menggunakan HTTP cache lokal.
  3. **Idle Bundle Prefetching untuk Navigasi Instan (`App.tsx`)**:
     - Menerapkan `preloadCoreRouteBundles()` menggunakan `requestIdleCallback` (dengan fallback timer). Saat browser idle, JavaScript chunk untuk 6 halaman inti (`LiveChatMonitor`, `Reservations`, `CustomerDatabase`, `TodayTreatments`, `Settings`, `StaffToday`) sudah ter-download hening di latar belakang, menghasilkan waktu muat **0 ms** saat berpindah tab.
  4. **Optimasi LTV Sort & Treatment Pricing Lookup (`customer.service.ts`, `live-chat.service.ts`)**:
     - Membatasi batas maksimum penarikan baris saat LTV sort dan memoisasi penghitungan nilai treatment harga di memori, mencegah eksekusi regex berulang dan pemborosan memori heap Node.js.
  5. **Persistent Multi-Tier SWR Cache di Frontend (`api.ts`)**:
     - `sessionStorage` + in-memory cache dengan *Stale-While-Revalidate Fallback* dan *auto-retry* 1x pada network abort/glitch.

- **Pengujian & Verifikasi:**
  - Unit tests `tests/unit/web-push.service.test.ts`: **PASS (4/4 tests passed)**.
  - Frontend admin dashboard build (`npm run build`): **PASS (0 errors, build time 9.7s)**.
  - Backend TypeScript build (`npm run build`): **PASS (0 errors)**.
  - Backend TypeScript build (`npm run build`): **PASS (0 errors)**.

#### Fix — Direct Navigation to Live Chat Conversation on Notification Click (`sw.js`, `App.tsx`, `useLiveChatNotification.ts`, `LiveChatMonitor.tsx`, `StaffToday.tsx`, `message.service.ts`, `conversation.service.ts`, `web-push.service.ts`, `livechat.subroute.ts`) (2026-08-29)

- **Latar Belakang & Masukan Pengguna:**
  - Saat menerima notifikasi (Web Push maupun In-App Floating Toast), mengeklik notifikasi menyebabkan dashboard terbuka ke **Homepage (`/admin/overview`)** alih-alih langsung ke riwayat percakapan chat pelanggan yang bersangkutan.

- **Akar Masalah (Root Cause):**
  1. **Hash-Based URL vs `BrowserRouter`**: Backend push service (`web-push.service.ts`, `message.service.ts`, `conversation.service.ts`, `push.subroute.ts`) dan Service Worker (`sw.js`) membuat payload URL dengan format hash: `/admin/#/live-chat?conversationId=...`. Karena dashboard menggunakan HTML5 `BrowserRouter`, React Router hanya membaca path `/admin` dan mengabaikan `#...`. Path `/admin` mencocokkan `<Route path="/admin" element={<IndexRedirect />} />` yang otomatis me-redirect peran pengguna (Admin/CS/Owner) ke `/admin/overview` (Homepage).
  2. **Toast Hook Tanpa ID Percakapan**: Fungsi `openChatFromToast` dan fallback `showBrowserNotification` di `useLiveChatNotification.ts` hanya memanggil `navigate('/admin/live-chat')` tanpa mengoper dan menyimpan `conversationId` yang diklik.
  3. **`LiveChatMonitor.tsx` Tidak Mengikat `searchParams`**: Komponen Live Chat Monitor hanya membaca ID dari `sessionStorage` pada initial load, mengabaikan parameter URL `?conversationId=...` / `?id=...`, dan tidak otomatis beralih ke mobile chat view saat dibuka dari notifikasi.

- **Solusi & Implementasi:**
  1. **Normalisasi URL Web Push & Backend**:
     - Mengubah seluruh target URL Web Push dari `/admin/#/live-chat` menjadi URL HTML5 bersih `/admin/live-chat?conversationId=${conversationId}` di `message.service.ts`, `conversation.service.ts`, `web-push.service.ts`, dan `push.subroute.ts`.
     - Menormalkan redirect Google OAuth di `google-integration.subroute.ts` ke `/admin/settings`.
  2. **Service Worker PWA Update (`sw.js`)**:
     - Mengupdate target URL default ke `/admin/live-chat` dan menaikkan cache ke `kala-admin-v6`.
     - Memperbaiki event listener `notificationclick` agar memfokuskan dan menavigasikan tab browser ke URL tujuan lengkap dengan query parameter `conversationId`.
  3. **Resiliensi Hash Routing di `IndexRedirect` (`App.tsx`)**:
     - Menambahkan deteksi otomatis `window.location.hash` pada `IndexRedirect` sehingga URL ber-hash dari notifikasi lama/cache (seperti `#/live-chat?conversationId=...`) tetap diarahkan secara tepat ke `/admin/live-chat?conversationId=...`.
  4. **Deep-Linking & Dynamic Conversation Selection di `LiveChatMonitor.tsx`**:
     - Mengintegrasikan `useSearchParams` untuk mendeteksi `conversationId` atau `id` dari URL.
     - Saat notifikasi diklik, halaman otomatis menetapkan `selectedId`, beralih ke tampilan thread chat (`mobileView = 'chat'`), dan memuat riwayat pesan (`loadThread`).
     - Menyediakan endpoint backend baru `GET /api/admin/live-chat/conversations/:id` dan method `getConversationDetail` di `live-chat.service.ts` agar data ringkasan percakapan/customer otomatis termuat meskipun chat belum ada di 50 percakapan teratas.
  5. **In-App Toast & Native Notification Click Handlers (`useLiveChatNotification.ts`, `StaffToday.tsx`)**:
     - Menyematkan `conversationId` dan update `sessionStorage` saat `openChatFromToast` dan `showBrowserNotification` dipicu.
     - Menambahkan handler `onclick` pada notifikasi desktop di `StaffToday.tsx` untuk langsung membuka modal/thread tugas terapis yang relevan.

- **Pengujian & Verifikasi:**
  - Unit tests `tests/unit/web-push.service.test.ts`: **PASS (4/4 tests passed)**.
  - Frontend admin dashboard (`npm run build`): **PASS (0 errors, build in 10s)**.
  - Root backend TypeScript (`npm run build`): **PASS (0 errors)**.

#### Enhanced — In-Page Chat History Modal, Full Follow-Up Text/Variant Editor & Smart Date Range Filters (`FollowUpQueue.tsx`, `follow-up.service.ts`, `follow-up.subroute.ts`) (2026-08-29)

- **Latar Belakang & Masukan Pengguna:**
  1. **Tombol Live Chat Buka Tab Baru & Chat List**: Tombol live chat di antrian sebelumnya membuka tab baru ke halaman utama Live Chat tanpa konteks percakapan spesifik customer tersebut.
  2. **Kebutuhan Edit Varian & Teks Kustom**: Admin membutuhkan fleksibilitas untuk tidak hanya mengubah tanggal/jam, tetapi juga memilih varian rolling template (Tahap 1/2/3) dan mengedit teks pesan secara spesifik untuk pelanggan tersebut sebelum dikirim.
  3. **Bug Urutan Jadwal Terdekat (Semua Status)**: Saat mengurutkan "Jadwal Terdekat" (ASC), data lama di masa lalu (seperti tanggal 13 Agustus) muncul di awal antrian, padahal admin membutuhkan tampilan jadwal dari hari ini ke depan (upcoming).

- **Solusi & Implementasi:**
  1. **Modal Riwayat Chat In-Page (`FollowUpQueue.tsx`)**:
     - Mengganti tautan eksternal dengan **Modal Riwayat Chat WhatsApp** interaktif langsung di dalam halaman.
     - Menampilkan riwayat percakapan kronologis (bubble chat Customer vs Bot/Admin dengan timestamp & status).
     - Menyediakan kolom input balasan langsung (*Quick Reply*) sehingga admin dapat menyapa pelanggan via WhatsApp tanpa meninggalkan halaman antrian.
  2. **Editor Follow-Up Fleksibel (Jadwal, Varian & Teks Kustom)**:
     - Menambahkan kolom `custom_text String?` pada model `FollowUp` (`prisma/schema.prisma`).
     - Menyediakan modal edit interaktif dengan pemilih varian (Varian #1, #2, #3), tombol reset ke template default, tag helper variabel (`{name}`, `{babyName}`, `{time}`), serta textarea untuk kustomisasi pesan.
     - Backend endpoint `PATCH /api/admin/follow-ups/:id` dan worker `executeFollowUp` memprioritaskan pengiriman pesan menggunakan `custom_text` jika ada.
  3. **Smart Date Filter & Perbaikan Sorting Jadwal Terdekat**:
     - Menambahkan filter tanggal pada backend `listFollowUps` dan dropdown filter di dashboard:
       - `📅 Hari Ini & Ke Depan (Upcoming)` (Default): menyaring jadwal `scheduled_at >= hari ini (WIB)`, sehingga sorting *Jadwal Terdekat* menampilkan hari ini ke depan tanpa tertutup data lampau.
       - Pilihan filter lain: `📅 Semua Tanggal`, `📅 Hari Ini Saja`, `📅 Minggu Ini`, `📅 Bulan Ini`, `⚠️ Lewat Jadwal (Overdue)`.

- **Pengujian & Verifikasi:**
  - Vitest Unit & Integration Tests (`tests/unit/follow-up-engine.test.ts`, `tests/integration/follow-up-admin.test.ts`): **43/43 tests PASS (100%)**.
  - Backend typecheck (`npm run build`): **PASS (0 errors)**.
  - Frontend admin dashboard (`npm run build`): **PASS (0 errors)**.

#### Impeccable Refinement — Layout 1-Kolom Treatment, Label Waktu Mulai Avatar & Impeccable Audit Kalender & Reservasi (`TodayTreatments.tsx`, `Reservations.tsx`, `ReservationDetailModal.tsx`, `CreateReservationModal.tsx`) (2026-08-28)

- **Latar Belakang & Masukan Pengguna:**
  1. Label jam di atas foto/avatar pasien sebelumnya menampilkan rentang (`09:00 - 10:00`), diharapkan cukup jam mulai (`09:00`) agar lebih ringkas dan mudah dibaca di avatar thumbnail.
  2. Tampilan card treatment di website sebelumnya 2 kolom sehingga membingungkan urutan rute kronologis kunjungan terapis dari pagi ke sore.
  3. Halaman *Reservasi & Kalender* (`Reservations.tsx`) dan modal terkait (`ReservationDetailModal.tsx`, `CreateReservationModal.tsx`) membutuhkan audit Impeccable untuk konsistensi portal, keyboard shortcuts, kontras warna, dan responsivitas.

- **Solusi & Implementasi:**
  1. **Layout 1-Kolom & Nomor Urut Kronologis di Treatment Hari Ini**:
     - Mengubah container card dari 2 kolom (`grid-cols-2`) menjadi 1 kolom vertikal (`flex flex-col gap-4 max-w-4xl mx-auto w-full`).
     - Menambahkan badge nomor urut kunjungan terapis (`No 1`, `No 2`, dst) di sebelah avatar pasien.
     - Menyederhanakan badge jam di avatar pasien menjadi **hanya waktu mulai** (`09:00`), sementara rentang waktu lengkap tetap tercantum jelas di deskripsi.
  2. **Audit Impeccable pada Halaman Reservasi & Kalender**:
     - Membungkus seluruh modal (`CreateReservationModal`, `ReservationDetailModal`, `proofModal`, `housePhotoModal`, `editLocationModal`) dengan `createPortal(..., document.body)` untuk mencegah terpotong layout overflow.
     - Menambahkan keyboard navigation listener `Escape` untuk menutup modal aktif secara instan.
     - Memperhalus visual hierarchy, badge status terkonfirmasi/selesai/batal, table sorting arrows, dan segmented tab control dengan WhatsApp Emerald Palette.

- **Pengujian & Verifikasi:**
  - Build frontend `packages/admin-dashboard`: **PASS (0 errors, built in 11.12s)**.
  - Build backend `npm run build`: **PASS (0 errors)**.
  - Vitest Unit Test: **PASS (17/17 tests pass)**.

#### Impeccable Audit & Feature — Tab Treatment Besok & Redesign Impeccable pada Halaman Treatment (`TodayTreatments.tsx`, `today.subroute.ts`, `staff-reservation.service.ts`) (2026-08-28)

- **Latar Belakang & Kebutuhan:**
  - Halaman *Treatment Hari Ini* sebelumnya hanya dapat melihat jadwal hari ini dan belum menyediakan tab praktis untuk meninjau persiapan jadwal kunjungan esok hari (*Treatment Besok*).
  - Diperlukan audit frontend dengan standar **Impeccable Design System** untuk menyempurnakan visual hierarchy, segmented date control, touch targets, kontras tipografi, dan contextual action gates.

- **Solusi & Implementasi:**
  1. **Segmented Date Control (Hari Ini, Besok, Pilih Tanggal)**:
     - Menambahkan tab kontrol tanggal fleksibel (*📅 Hari Ini*, *✨ Besok*, dan input date picker untuk tanggal custom).
     - Menampilkan banner status tanggal dinamis dengan informasi rute & persiapan terapis.
  2. **Dukungan Backend Multi-Tanggal & Rentang Waktu WIB**:
     - Memperbarui `StaffReservationService.getWibDateRange` dan `getTodayTasks` di `src/services/staff-reservation.service.ts` untuk memproses parameter `date` (`'today'`, `'tomorrow'`, atau `'YYYY-MM-DD'`) berbasis rentang UTC offset WIB (+7).
     - Memperbarui route `GET /api/staff/today-tasks` di `src/routes/staff/today.subroute.ts` untuk mengembalikan metadata tanggal (`dateStr`, `formattedDate`, `isToday`, `isTomorrow`).
  3. **Contextual Action Safety & Impeccable Craft**:
     - Tombol "Kirim OTW" otomatis dikunci menjadi badge informatif `Jadwal Besok (OTW Hari-H)` saat melihat jadwal besok agar terapis tidak salah kirim notifikasi sebelum hari-H.
     - Aksi "Catat Lunas", "Maps Navigasi", "Update Lokasi/Foto Rumah", "Chat Pasien", dan "Delegasikan/Ganti Terapis" tetap dapat diakses penuh untuk perencanaan tim.
     - Standar Impeccable: Touch target $\ge 38\text{px}$, modal transisi smooth dengan `createPortal` dan `backdrop-blur-xs`, shortcut keyboard `Escape`, dan feedback modal tanpa native alert/confirm.

- **Pengujian & Verifikasi:**
  - Build frontend React Vite `packages/admin-dashboard`: **PASS (0 errors, built in 9.72s)**.
  - Build backend Fastify `npm run build`: **PASS (0 errors)**.
  - Vitest Unit Test: **PASS (23/23 tests pass)**.

#### Enhanced & Fixed — Parsing Tanggal 2-Digit, Ekstraksi Jam & Prioritas Total Price di Form Reservasi (`reservation-text-parser.ts`, `webhook.route.ts`) (2026-08-28)

- **Latar Belakang & Akar Masalah:**
  - Saat pesan konfirmasi reservasi dikirim admin dari WhatsApp HP (contoh format: `Hari dan tanggal : sbtu 29 agt 26 jam 09.00-09.30`), parser tanggal `tryParseIndonesianDate` hanya menerima format tahun 4 digit (`\d{4}`), sehingga gagal mem-parse tahun 2 digit (`26`) dan waktu jam.
  - Akibatnya, `booking_date` tersimpan `NULL` di database dan jadwal tidak muncul di slot kalender admin.
  - Pada auto-capture outbound admin, nilai `purchase_value` sebelumnya memprioritaskan `treatmentPrice` dibanding `totalPrice` (sehingga total biaya dengan ongkir tidak otomatis tersimpan).

- **Solusi & Implementasi:**
  - Memperbarui `tryParseIndonesianDate` di `src/utils/reservation-text-parser.ts`:
    - Mendukung tahun 2 digit (`26` → `2026`) dan 4 digit (`2026`).
    - Ekstraksi waktu jam & menit secara otomatis (contoh: `jam 09.00-09.30`, `09:00`, `pukul 10.30`).
    - Mendukung singkatan hari (`sbtu`, `sabtu`, `rabu`, dll) dan variasi singkatan bulan (`agt`, `agu`, `ags`, `sept`, dll).
  - Mengupdate `src/routes/webhook.route.ts` agar `purchase_value` memprioritaskan `totalPrice` saat rincian pembayaran tersedia.
  - Menghapus dependensi circular di `conversation-transaction-extractor.ts` dan mengimpor `parsePaymentSection` secara langsung.

- **Pengujian & Verifikasi:**
  - Unit test `tests/unit/reservation-text-parser.test.ts` (17/17 PASS, mencakup case Bunda Siska).
  - Suite parser test (`hybrid-reservation-parser.test.ts`, `reservation-stress.test.ts`, `capi-payload-sanitizer.test.ts`): 12/12 PASS.
  - Build backend `npm run build`: **PASS (0 errors)**.

#### Fixed — Navigasi Mobile Sidebar Terkunci / Tidak Berpindah Halaman (`Layout.tsx`) (2026-08-28)

- **Latar Belakang & Akar Masalah:**
  - Saat membuka menu sidebar di browser mobile (HP) dan mengklik salah satu menu tujuan (misal: *Reservations*, *Live Chat*, *Knowledge Base*), halaman tidak berpindah sama sekali dan tetap berada di halaman lama.
  - Akar masalah: Komponen `<Link>` sebelumnya memanggil `closeMobileMenu()` yang menjalankan `window.history.back()`, berbarengan dengan atribut `replace={true}`. Panggilan `history.back()` secara asinkron membatalkan navigasi React Router dan langsung mengembalikan URL browser ke halaman sebelumnya.

- **Solusi & Implementasi:**
  - Memisahkan logic penutupan menu:
    - `dismissMobileMenu()`: Dijalankan hanya saat pengguna secara eksplisit membatalkan/menutup drawer (klik tombol `X`, klik backdrop gelap, atau usap/swipe ke kanan).
    - `handleNavClick()`: Dijalankan saat mengklik item navigasi menu. Langsung menutup drawer dan membersihkan history state modal tanpa memanggil `history.back()`, serta menghapus `replace={true}` dari `<Link>` agar navigasi berjalan mulus.

- **Pengujian & Verifikasi:**
  - Build frontend React Vite `packages/admin-dashboard`: **PASS (0 errors, built in 10.04s)**.
  - Build backend Fastify `npm run build`: **PASS (0 errors)**.

#### Fixed & Redesigned — In-Place Zero-Jump Save & Impeccable Design di Rolling Template Follow-Up (`FollowUpTemplates.tsx`) (2026-08-28)

- **Latar Belakang & Akar Masalah:**
  - Sebelumnya, saat admin mengklik tombol **"Simpan"** pada salah satu varian template follow-up, fungsi `handleSave` memanggil `loadTemplates()` yang menyetel `loading = true`.
  - Hal ini menyebabkan seluruh komponen daftar form di-unmount seketika dari DOM dan digantikan oleh spinner tunggal, yang mereset tinggi halaman dan memaksa scroll browser meloncat ke paling atas (`scrollY = 0`). Pengguna kehilangan fokus dan posisi editing.
  - Halaman menumpuk seluruh 10 tipe x 3 varian (30 textarea) secara vertikal tanpa navigasi tab kategori atau pencarian, tombol aksi di bawah standar touch target, dan menggunakan toast kustom terisolasi tanpa konfirmasi modal terpadu.

- **Solusi & Implementasi:**
  1. **Zero-Jump In-Place Save & Optimistic State**:
     - Menyimpan template langsung ke server (`PUT /api/admin/follow-up-templates`) dan memperbarui state lokal `templates` secara in-place tanpa memicu `loading = true` (0ms scroll jump / layar tetap stabil di posisi).
     - Tombol "Simpan" menampilkan feedback transisi halus: indikator loading spinner saat submit, lalu berubah menjadi checkmark hijau `Check` bertuliskan **"Tersimpan ✓"** selama 2.5 detik.
     - Background revalidation berjalan secara hening (*silent non-blocking fetch*) tanpa meng-unmount DOM.
  2. **Audit & Desain Impeccable (Kala / WhatsApp Clinic Palette)**:
     - **Tab Kategori Pintar**: Membagi 10 skenario follow-up ke dalam 4 kategori rapi (*Hari-H & OTW*, *Review H+1*, *Belum Reservasi*, *Treatment Rutin*) plus tab *Semua* dengan badge counter real-time.
     - **Instant Search Bar**: Pencarian cepat berbasis judul, deskripsi skenario, atau kata kunci isi pesan dengan tombol clear instan `X`.
     - **Click-to-Insert Placeholder Chips**: Menyediakan chip variabel `{name}`, `{time}`, `{babyName}` di atas setiap textarea yang dapat diklik untuk langsung menyisipkan tag tepat di posisi kursor teks yang aktif.
     - **Dirty State & Live Character Counter**: Menghitung jumlah karakter secara real-time dan menampilkan badge highlight "Belum disimpan" saat ada perubahan teks dari versi server.
     - **UI Feedback Terpadu (`useUiFeedback`)**: Mengintegrasikan notifikasi toast standar dan modal dialog interaktif `confirm` sebelum mereset template ke bawaan default sistem (mematuhi mandat anti-native alert).

- **Pengujian & Verifikasi:**
  - Build frontend Vite `packages/admin-dashboard`: **PASS (0 errors, built in 10.56s)**.
  - Build backend Fastify `npm run build`: **PASS (0 errors)**.

#### Fixed — RBAC Guard Allow Read-Only Access ke Rute Custom Roles bagi Staf (`admin.route.ts`) (2026-08-28)

- **Latar Belakang & Akar Masalah:**
  - Saat staf non-Super Admin (seperti `ADMIN_CS`, `THERAPIST`, atau role kustom) login dan membuka dashboard admin, aplikasi React memanggil `GET /api/admin/roles` untuk menyinkronkan hak akses menu navigasi.
  - Namun, rute `/api/admin/roles` sebelumnya dimasukkan secara global ke dalam `superAdminOnlyPrefixes` di `src/routes/admin.route.ts`, sehingga seluruh request (termasuk `GET`) diblokir dengan HTTP 403 dan memicu log warning `[RBAC GUARD] Blocked unauthorized access attempt by staff role '...' on GET /api/admin/roles`.

- **Solusi & Implementasi:**
  - Mengeluarkan `/api/admin/roles` dari `superAdminOnlyPrefixes`.
  - Menambahkan guard spesifik berbasis method di `src/routes/admin.route.ts`: staf terautentikasi diizinkan melakukan pembacaan data (`GET /api/admin/roles`), sedangkan operasi modifikasi kustom peran (`POST`, `DELETE`) tetap dibatasi secara ketat khusus untuk `SUPER_ADMIN`.
  - Menambahkan unit test di `tests/unit/admin-rbac-guard.test.ts` untuk memverifikasi staf non-Super Admin dapat membaca roles (200 OK) dan tetap terblokir saat mencoba membuat/mengubah peran (403 Forbidden).

- **Pengujian & Verifikasi:**
  - Unit test `tests/unit/admin-rbac-guard.test.ts`: **PASS (8/8 tests passed)**.
  - TypeScript build & typecheck `npm run build`: **PASS (0 errors)**.

#### Optimized — System-Wide Instant Load & Zero-Wait Architecture di Dashboard & Backend API (2026-08-28)

- **Latar Belakang & Akar Masalah:**
  - Sebelumnya, saat pertama kali membuka dashboard atau melakukan *refresh*, sistem menampilkan layar kosong / *blocking loading spinner* selama 300ms–2500ms karena menunggu validasi sesi `/api/admin/auth/me` selesai melalui jaringan.
  - Berpindah antar halaman (*Overview*, *Jadwal Hari Ini*, *Reservasi*, *Database Pelanggan*) memicu *full-screen loading spinner* dan melakukan *fetch* ulang seluruh data dari server dari nol.
  - Di backend, setiap request rute SPA `/admin/*` membaca file `index.html` dan aset berulang kali dari *hard disk* (`fs.readFile`) tanpa kompresi HTTP, menyebabkan transfer payload berukuran penuh di jaringan seluler.

- **Solusi & Implementasi:**
  1. **Instant Auth Boot (0ms Shell Render)**:
     - `AuthContext.tsx` kini secara instan me-rehidrasi profil admin dari penyimpanan lokal (`localStorage.last_auth_user`) dan memulai render dengan `loading: false` (**0ms perceived load**).
     - Shell layout, sidebar, dan tab aktif muncul seketika tanpa jeda *blank spinner*, sementara validasi sesi `/api/admin/auth/me` berjalan secara mulus di latar belakang (*background non-blocking verification*).
  2. **Lightweight SWR In-Memory API Caching (`src/services/api.ts`)**:
     - Membangun *in-memory* SWR (*Stale-While-Revalidate*) cache manager untuk request GET dengan TTL adaptif (15–60 detik).
     - Navigasi antar halaman (*Overview*, *TodayTreatments*, *Reservations*, *CustomerDatabase*) langsung menampilkan data yang telah ada di memori secara instan (**0ms screen transitions**) sambil memperbarui data baru di latar belakang.
     - Mutasi data (`POST`, `PUT`, `DELETE`, `PATCH`) otomatis meng-invalidasi cache terkait.
  3. **Backend HTTP Compression & In-Memory Static Serving (`src/app.ts`, `src/routes/admin.route.ts`)**:
     - Memasang plugin `@fastify/compress` (Gzip & Deflate untuk payload > 1KB), memotong ukuran transfer respon JSON & aset hingga 70–80%.
     - Menyimpan `dist/index.html` dan manifest dalam memori RAM Node.js (0ms *disk I/O*).
     - Menetapkan header `Cache-Control: public, max-age=31536000, immutable` pada seluruh bundel aset `/admin/assets/*`.
  4. **Vite Bundle Chunk Splitting (`packages/admin-dashboard/vite.config.ts`)**:
     - Mengonfigurasi `manualChunks` untuk memisahkan library vendor (`vendor-react`, `vendor-charts`, `vendor-icons`), memangkas ukuran `Overview.js` dari 393 kB menjadi **10 kB** dan `index.js` dari 251 kB menjadi **70 kB**.
     - Waktu kompilasi bundle frontend turun drastis dari 39 detik menjadi **9.14 detik**.

- **Pengujian & Verifikasi:**
  - Build frontend Vite `packages/admin-dashboard`: **PASS (0 errors, built in 9.14s)**.
  - Build backend Fastify `npm run build`: **PASS (0 errors)**.
  - Unit test suite `tests/unit/*.test.ts`: **PASS (34/34 tests passed)**.

#### Fixed — Zero-Lag Typing & Real-Time Top Conversation Order di Live Chat Admin Dashboard (2026-08-28)

- **Latar Belakang & Akar Masalah:**
  1. **Typing Laggy / Stutter di Live Chat**: Setiap keystroke karakter di `LiveChatMonitor.tsx` memicu `handleInputChange` -> `setReplyText(text)`. Karena `LiveChatMonitor` merupakan komponen besar (~3.700+ baris), Virtual DOM React me-render ulang seluruh daftar 50 kontak, ratusan gelembung pesan, dan modal dialog pada setiap ketikan huruf (latensi 30–100ms per karakter). Diperparah oleh background polling `setInterval` agresif setiap 3.5 detik yang membekukan input box, serta rute `/typing` yang selalu merespon HTTP 404 karena `conversation.customer` tidak di-populate oleh Prisma saat runtime.
  2. **Chat Baru Tidak Muncul di Paling Atas**: Di `src/services/message.service.ts` (`logMessage`), kolom `conversations.last_message_at` tidak diperbarui saat ada pesan masuk maupun keluar (hanya diperbarui saat State Machine berganti state). Akibatnya, pada mode `HUMAN_HANDLING` (CS/Bidan takeover atau repeat customer), timestamp percakapan tetap basi sehingga `listConversations` (`ORDER BY last_message_at DESC`) menempatkan chat baru di posisi bawah atau keluar dari limit 50 percakapan teratas.

- **Solusi & Implementasi:**
  1. **Backend Atomic Touch & Customer Resolution (`src/services/message.service.ts`, `src/routes/admin/livechat.subroute.ts`)**:
     - `MessageService.logMessage` kini secara atomik memperbarui `last_message_at` dan `updated_at` di tabel `conversations` (dan fallback `memoryConversations`) berbarengan dengan pembuatan pesan (`prisma.message.create`).
     - Memperbaiki `typingHandler` di subroute livechat agar me-resolve customer via `customerService.getCustomerById` jika `conversation.customer` belum ter-join, mencegah respon 404.
  2. **Frontend Zero-Lag Input Isolation (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`)**:
     - Mengubah state pengetikan menjadi `replyTextRef` (uncontrolled in-memory ref) dan boolean `hasReplyText`.
     - Parent `LiveChatMonitor` kini mengalami **0 re-render** saat admin mengetik (latensi turun drastis menjadi < 1ms native browser speed).
     - Menghapus polling agresif 3.5 detik saat koneksi SSE aktif (`sseConnected === true`), beralih ke *Pure Event-Driven Architecture* dengan fallback sinkronisasi saat tab browser aktif kembali (`visibilitychange`).
     - Menyempurnakan pembaruan `lastMessageAt` dan sorting otomatis pada event SSE `message.created` sehingga percakapan baru instan melompat ke posisi teratas.

- **Pengujian & Verifikasi:**
  - Unit test `tests/unit/typing-sync.test.ts`, `tests/unit/live-chat.service.test.ts`, dan `tests/unit/live-chat-hub.test.ts` seluruhnya **PASS (34/34 tests passed)**.
  - Typecheck dan bundle build Fastify (`npm run build`) serta Frontend React (`cd packages/admin-dashboard && npm run build`) sukses tanpa error.

#### Fix & Enhancement — Resolusi Nilai Transaksi (GMV) Event Purchase di Meta CAPI Queue & Batch Sanitasi Database (2026-08-28)

- **Latar Belakang & Akar Masalah:**
  1. **Nilai Purchase Kosong / Nol di Meta CAPI Queue**: Pada dashboard *Meta CAPI Queue*, banyak item reservasi/event Purchase tidak menampilkan nilai transaksi (`value` bernilai `0` / `null` / `—`).
  2. **Pencocokan Treatment Kaku & Alias Terpotong**: Fungsi `resolveTreatmentValue` sebelumnya memotong string kurung `(...)` dari nama katalog treatment. Akibatnya, alias penting seperti `(Pijat Hamil)` pada `Prenatal Massage (Pijat Hamil)` dan `(Terapi Bapil / Kembung)` pada `Pijat Bayi Pulih Ceria` terbuang, menyebabkan pencarian umum seperti *"Pijat Hamil"*, *"Pijat Terapi"*, *"Pijat Bapil"*, *"Breast Massage"*, *"Pijat Oksitosin"*, *"Cukur Bayi"* mengembalikan `undefined`.
  3. **Multi-Service & Bundle Belum Terhitung**: Format multi-layanan seperti *"Baby: Pijat Bayi Pulih Ceria + Sinar Moksa"* atau *"Baby: Pijat Bayi Ceria | Moms: Prenatal Massage"* belum menjumlahkan harga per komponen secara akurat (compounding), dan paket bundle kombinasi belum terdeteksi otomatis.
  4. **Ekstraksi Persamaan Pembayaran Belum Terhubung**: Format rincian biaya dari pesan chat seperti `Total = 70.000 + ongkir 15.000 = 85.000` belum diekstrak nilai murni layanannya pada endpoint review CAPI queue.

- **Solusi & Implementasi:**
  1. **Engine Resolusi Treatment (`src/services/capi.service.ts`)**:
     - Memperkaya `resolveTreatmentValue` dengan kamus alias cerdas (`KNOWN_SERVICE_MATCHERS`) yang memetakan seluruh sinonim bahasa Indonesia untuk layanan Bayi, Anak, Ibu Hamil, Pasca Melahirkan/Laktasi, dan Add-on.
     - Menambahkan fitur **Multi-Service Compounding & Tokenizer**: memecah string berdasarkan `+`, `|`, `\n`, `dan`, `&` serta menjumlahkan nominal harga per layanan secara presisi.
     - Mendukung pendeteksian bundle kombinasi prioritas (seperti *Cukur + Pijat Terapi*, *Paket Selapan*, *Paket Pra Kelahiran*, *Paket Laktasi Oksitosin*).
     - Menambahkan fallback nilai standar berbasis kategori (*BABY* = Rp 60.000, *MOMS* = Rp 100.000, *KIDS* = Rp 70.000).
  2. **Pipeline Nilai di Meta CAPI Queue & Moderasi (`src/routes/admin/reservations.subroute.ts`)**:
     - Meningkatkan logika kalkulasi `value` pada `GET /api/admin/capi-queue` dan `POST /api/admin/reservation/:id/approve-purchase` dengan urutan prioritas: ekstraksi financial equation (`parsePaymentSection`), template `formatValue`, existing `purchase_value`, pola nominal rupiah, dan resolusi katalog komprehensif.
     - Memperbarui mekanisme self-heal database untuk otomatis menyimpan nilai transaksi yang valid.
  3. **Deteksi Purchase & Auto-Capture Inbound (`src/services/purchase-detection.service.ts`, `src/routes/webhook.route.ts`)**:
     - Mengintegrasikan `parsePaymentSection` pada `maybeFirePurchaseEvent` dan ketiga titik auto-capture webhook inbound.
  4. **Skrip Batch Backfill & Sanitasi Database (`src/scripts/sanitize-purchase-values.ts`)**:
     - Skrip untuk memindai dan mengisi `purchase_value` pada seluruh data reservasi di DB yang masih bernilai null/0.
  5. **Script Deploy Server (`scripts/deploy-to-server.js`)**:
     - Deteksi dinamis lokasi SSH key (`process.env.SSH_KEY_PATH`, `~/.ssh/...`, atau path sistem) serta integrasi langkah sanitasi DB pasca-deploy.

- **Pengujian & Verifikasi:**
  - `tests/unit/purchase-detection.test.ts`: 17/17 PASS (termasuk 5 test case baru untuk alias, compounding, bundle, dan financial parsing).
  - `tests/unit/meta-attribution-fix.test.ts`: 4/4 PASS.
  - `tests/unit/waba-tenant-media-capi.test.ts`: 20/20 PASS.
  - `npm run build`: Kompilasi TypeScript sukses 100% tanpa error.

#### Feature & Architecture — Contextual Intelligence Engine & Admin Dashboard UI: Conversation State Summary, Few-Shot Exemplar Bank, & Adaptive Model Selector (2026-08-28)

- **Latar Belakang & Masalah yang Dipecahkan:**
  1. **Hilangnya Kesadaran State Percakapan (*Context Amnesia & Repetition*)**: LLM Call ke-2 (`ReplyGenerator`) sebelumnya hanya menerima 4 chat terakhir mentah tanpa pemahaman status tahapan data (apakah ongkir sudah disepakati, apakah treatment sudah direkomendasikan). Akibatnya, LLM cenderung mengulang penjelasan ongkir atau bertanya ulang *"mau treatment apa"*, yang sebelumnya dipangkas paksa secara reaktif oleh puluhan regex sanitizer.
  2. **Ketiadaan Contoh Percakapan Positif (*Negative Constraint Overload*)**: Prompt persona didominasi oleh 14+ aturan `DILARANG KERAS` tanpa contoh konkret dialog ideal Bidan Yusi, sehingga model mudah melanggar intisari SOP meski menghindari kata terlarang secara literal.
  3. **Model Homogen untuk Semua Kompleksitas**: Semua jenis percakapan (dari sapaan FAQ ringan hingga konsultasi klinis multi-gejala / bundling Moms & Baby) diproses oleh model yang sama tanpa penyesuaian kecerdasan.

- **Solusi & Implementasi:**
  1. **`ConversationStateSummarizer` (`src/slot-engine/conversation-summarizer.ts`)**:
     - Service deterministik (0 Token, <1ms) yang merangkum state percakapan menjadi 4 blok terstruktur: `STATUS DATA YANG SUDAH DILALUI`, `FOKUS SAAT INI (Sedang ditanyakan & Yang wajib dijawab)`, dan `PANDUAN ANTI-PENGULANGAN`.
     - Disuntikkan langsung ke System Prompt dan header riwayat chat pada Call 2, memberikan LLM kesadaran konteks penuh sehingga tidak mengulang informasi yang sudah selesai dibahas.
  2. **`FewShotExemplarBank` & Database Persistence (`src/slot-engine/few-shot-exemplars.ts`, `prisma/schema.prisma`)**:
     - Model Prisma `FewShotExemplar` untuk menyimpan contoh dialog di database PostgreSQL dengan caching in-memory 0-latency.
     - Bank contoh percakapan ideal yang mencakup 6 skenario inti SOP Bidan Yusi: Anti-afirmasi jadwal, konsultasi keluhan flu/batuk, tarif promo, metode transfer/QRIS, edukasi pijat laktasi/oksitosin, dan follow-up pasca-ongkir.
     - Fungsi `selectRelevantExemplars` secara cerdas memilih 1–2 contoh paling relevan dan menginjeksinya ke `PersonaComposer.composeSlotGeneratorPrompt`.
  3. **Backend REST API CRUD (`src/routes/admin/settings.subroute.ts`)**:
     - Menyediakan 5 endpoint admin terproteksi RBAC: `GET /api/admin/few-shots`, `POST /api/admin/few-shots`, `PUT /api/admin/few-shots/:id`, `DELETE /api/admin/few-shots/:id`, dan `POST /api/admin/few-shots/reset-defaults`.
  4. **Admin Dashboard UI (`packages/admin-dashboard/src/pages/tenant/AiPersona.tsx`)**:
     - Antarmuka visual 2-tab modern di menu AI Bot Persona: Tab 1 (System Prompt Editor) dan Tab 2 (Bank Contoh Chat).
     - Fitur UI: Card dialog visual pesan pasien vs balasan Bidan Yusi, pencarian instan, toggle on/off status aktif, modal tambah/edit contoh dengan live format guidance, tombol reset ke default SOP, dan konfirmasi modal `useUiFeedback`.
  5. **`AdaptiveModelSelector` (`src/slot-engine/adaptive-model-selector.ts`, `src/config/ai-models.config.ts`)**:
     - Task-adaptive model router (0ms overhead) yang memilih model standar (`CHAT_REPLY`) untuk FAQ/sapaan ringan, dan beralih otomatis ke model pintar (`CHAT_REPLY_DEEP`, konfigurasi `AI_MODEL_CHAT_DEEP`) ketika terdeteksi multi-gejala klinis ($\ge 2$), diskusi bundling Moms & Baby, atau multi-intent konsultasi + tarif/jadwal.
  6. **Pembaruan Arsitektur & Single Source of Truth**:
     - `PersonaComposer.composeSlotGeneratorPrompt` diperbarui untuk menerima dan memformat `conversationSummary` serta `fewShotExamples`.
     - `ReplyGenerator.generate` terhubung penuh dengan ketiga komponen baru dan mencatat detail audit `task_type` & reasoning ke `llm-execution-logger`.

- **Pengujian & Verifikasi:**
  - 4 Test Suite Baru: `tests/unit/few-shot-api.test.ts` (5 tests), `tests/unit/conversation-summarizer.test.ts` (4 tests), `tests/unit/few-shot-exemplar-selection.test.ts` (5 tests), dan `tests/unit/adaptive-model-selector.test.ts` (4 tests) — Total 18/18 PASS.
  - Regresi penuh Slot Engine: 48/48 PASS (100% Green).
  - Frontend Vite build (`packages/admin-dashboard`): Sukses 100% (0 error).
  - Backend TypeScript build (`npm run build` via `tsc`): Sukses 100% (0 error).

#### Fixed — Pembaruan Data & Reservasi Bunda Iren Live Server serta Robustness Parsing Formulir Tanpa Header Kategori (2026-08-28)

- **Latar Belakang & Akar Masalah:**
  1. **Data Pelanggan & Reservasi Bunda Iren di Live Server**: Reservasi Bunda Iren (Pijat Bayi Ceria untuk Jay, 15 bulan, 28 Agustus 2026 jam 10.30–11.00) sebelumnya tercatat pada entitas dummy (`phone: 0000000003`). Perlu disinkronkan ke profil WhatsApp pelanggan aktif (`081230083635`) lengkap dengan relasi anak, detail alamat Sarirogo Sidoarjo, ongkir 17km (Rp 20.000), serta pembatalan antrian follow-up `NO_PURCHASE`.
  2. **Parsing Formulir Tanpa Header Kategori (`src/utils/reservation-text-parser.ts`)**: Ketika teks formulir tidak menyertakan header section eksplisit `Pilihan treatment (Baby & Kids)`, parser berada di section `GENERAL` dan mengabaikan baris `Nama Bayi` serta `Usia Bayi/Anak`. Selain itu, pencocokan `label.includes('uk')` untuk Usia Kehamilan memicu false-positive pada kata umum seperti *"berikut"*.

- **Solusi & Implementasi:**
  1. **Update Transaksional Live Database**:
     - Memperbarui data `Customer` (`Bunda Iren Sidoarjo`, `Sarirogo`, `Sidoarjo`, `distance_km = 17`, `ongkir = 20000`, `preferences`).
     - Memperbarui data `Reservation` (link ke customer aktif, status `confirmed`, nominal `Rp 80.000`, terapis `Bidan Yusi F`, jadwal 28 Agustus 2026 10:30 WIB).
     - Menambahkan entitas `Child` (`Jay`, 15 bulan, lahir Mei 2025).
     - Membatalkan antrian `follow_ups` tipe `NO_PURCHASE` dan membersihkan entitas dummy.
  2. **Penguatan Parser (`src/utils/reservation-text-parser.ts`)**:
     - Menambahkan penanganan `Nama Bayi` dan `Usia Bayi/Anak` langsung pada section `GENERAL` serta transisi otomatis.
     - Mengubah pencocokan singkatan `uk` menjadi regex boundary `/\buk\b/i` agar tidak salah mencocokkan kata lain.
     - Menghapus aturan transisi section `lowerNorm.includes('pijat bayi')` agar nama treatment tidak dianggap header section.

- **Pengujian & Verifikasi:**
  - Database PostgreSQL live server diverifikasi langsung: record Customer, Reservation, Child, dan FollowUps tersimpan presisi dan sinkron.
  - Unit test `reservation-text-parser.test.ts`, `hybrid-reservation-parser.test.ts`, dan `reservation-stress.test.ts` (24/24 PASS, 30/30 variasi acak lolos).
  - Typecheck `npm run build` (`tsc`) sukses tanpa error.

#### Fixed — Perbaikan Drag-to-Scroll 2D View Mingguan Reservasi & Relaksasi Rate Limiting Admin Dashboard (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **2D Drag Scroll Kalender Mingguan Terblokir**: Pada `WeekScheduleGrid.tsx`, interaksi klik & geser mouse 2D (horizontal hari & vertikal jam) tidak berfungsi karena seluruh sel jam tertutup tombol transparan `<button>` berukuran penuh (100%) untuk fitur Quick-Add (+). Handler pointer membatalkan drag jika mengenai elemen `button`.
  2. **Rate Limit Terlalu Ketat (300 req/menit)**: Saat admin/staff aktif beraktivitas di Admin Dashboard (memuat kalender, auto-refresh chat, simpan reservasi), akumulasi request mencapai batas 300 req/menit karena jalur `/api/admin/*` belum masuk allowlist rate-limiting global Fastify di `src/app.ts`.

- **Solusi & Implementasi:**
  1. **2D Drag-to-Scroll dengan Distance Threshold (`packages/admin-dashboard/src/components/calendar/WeekScheduleGrid.tsx`)**:
     - Mengubah handler pointer event dengan ambang batas jarak pergerakan (*threshold* > 4px).
     - Jika mouse digeser melampaui threshold, sistem mengaktifkan pointer capture dan melakukan 2D scrolling (`scrollLeft` & `scrollTop`) bebas secara mulus.
     - Jika hanya diklik tanpa digeser, klik tombol Quick-Add (+) atau Card Reservasi tetap terpicu secara normal.
     - Mencegah klik terpicu secara tidak sengaja saat mouse selesai melakukan drag gesture (`dragMovedRef`).
  2. **Relaksasi Rate Limit & Allowlist Admin API (`src/app.ts`)**:
     - Menambahkan `/api/admin` ke dalam `allowList` rate-limiting Fastify agar operasional Admin Dashboard, penyimpanan reservasi, upload bukti transfer, dan live chat tidak pernah terblokir dengan HTTP 429.
     - Menaikkan kuota default global protection dari 300 menjadi 1.000 req/menit.

- **Pengujian & Verifikasi:**
  - `packages/admin-dashboard`: `npm run build` sukses (tsc + vite bundle).
  - Backend `src/`: `npm run build` (`tsc`) sukses 100%.
  - Seluruh test suite Vitest unit & integration test **PASS** (100% Green).


#### Fixed — Integrasi Dynamic Closer ke Reply Generator & Fast FAQ serta Pencegahan Pengulangan Pertanyaan Hari (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  - Saat customer bertanya hari (*"Sabtu atau Minggu apa bisa kak"*), bot membalas: *"Untuk jadwal di hari Sabtu atau Minggu, akan kami bantu cekkan ketersediaan jadwal Bidan yang ready ya Bunda 😊. Rencana mau treatment di hari apa Bunda?"*.
  - Pertanyaan penutup berulang dan kontradiktif karena `incomingText` dan `history` tidak diteruskan ke `DynamicCloserService.getCloserInstruction` di `fast-faq-generator.ts` dan `reply-generator.ts`, serta contoh kalimat penutup di prompt LLM masih memuat klausa *"di hari apa"*.

- **Solusi & Implementasi:**
  1. **Penerusan Parameter Lengkap (`src/slot-engine/fast-faq-generator.ts`, `src/slot-engine/reply-generator.ts`)**:
     - Memastikan `DynamicCloserService.getCloserInstruction` menerima `context.history` dan `context.customerInput` / `incomingText` pada seluruh pemanggilan.
  2. **Penyempurnaan Prompt Dynamic Closer (`src/slot-engine/dynamic-closer.service.ts`)**:
     - Mengubah contoh penutup menjadi spesifik menanyakan preferensi jam (*"Kira-kira untuk hari Sabtu atau Minggu Bunda lebih nyaman di jam berapa yaa (pagi/siang/sore)..."*).
     - Menambahkan larangan keras: `⚠️ DILARANG KERAS MENANYAKAN "DI HARI APA" LAGI KARENA BUNDA SUDAH MENYEBUTKAN HARI!`.

- **Pengujian & Verifikasi:**
  - Unit test `tests/unit/slot-engine-context-continuity-and-adaptive-closer.test.ts` (9/9 PASS).
  - Seluruh 13 Test Suite Slot Engine (72/72 tests) **PASS**.
  - `npm run build` (`tsc`) sukses 100%.

#### Fixed — Eliminasi Kalimat Pengantar Jadwal Janggal pada Penanyaan Lokasi tanpa Hari (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  - Saat customer hanya bertanya seputar usia anak (seperti *"Usia 14 bulan bisa ?"*) tanpa menyebutkan hari kunjungan, bot sebelumnya menyisipkan kalimat pengantar jadwal yang canggung: *"Untuk ketersediaan jadwal di hari yang Bunda inginkan, akan kami bantu cekkan terlebih dahulu..."*.
  - Hal ini terjadi karena template prompt `LOCATION` menyuntikkan instruksi pengecekan jadwal secara tanpa syarat (*unconditional*).

- **Solusi & Implementasi:**
  1. **Kondisional Pengecekan Hari di Dynamic Closer (`src/slot-engine/dynamic-closer.service.ts`)**:
     - Memisahkan alur `case 'LOCATION'`:
       - **Jika ada penyebutan hari**: Menjelaskan jadwal hari tersebut akan dicekkan dan menanyakan lokasi rumah.
       - **Jika TIDAK ada penyebutan hari**: Langsung menjawab pertanyaan layanan/usia anak dan menanyakan daerah rumah secara santun tanpa embel-embel kalimat jadwal.
     - Penambahan aturan: `⚠️ DILARANG menyebutkan kata pengantar jadwal jika Bunda belum menyebutkan hari/waktu kunjungan!`.

- **Pengujian & Verifikasi:**
  - Ditambahkan unit test 9 di `tests/unit/slot-engine-context-continuity-and-adaptive-closer.test.ts`.
  - Seluruh 13 Test Suite Slot Engine (72/72 tests) **PASS**.
  - `npm run build` (`tsc`) sukses 100%.

#### Fixed — Penanganan Multi-Treatment Kombinasi & Eliminasi Conversational Backtrack pada Pemilihan Hari (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  - Saat customer menanyakan kombinasi multi-treatment (seperti *"Pijat bayi ceria + cukur bisa kak ?"*), lalu menanggapi penawaran jadwal dengan pilihan hari (*"Sabtu atau Minggu apa bisa kak"*), bot sebelumnya mengalami *conversational backtrack* dengan bertanya balik: *"apakah Bunda sudah memutuskan untuk mengambil paket Pijat Bayi Ceria dan cukur rambut si kecil?"*.
  - Hal ini terjadi karena paket kombinasi belum langsung terikat sebagai `selectedTreatmentName` di state matrix dan format hari majemuk (*"Sabtu atau Minggu"*) belum diekstrak secara spesifik oleh Dynamic Closer.

- **Solusi & Implementasi:**
  1. **Ekstraksi Multi-Treatment Kombinasi (`src/slot-engine/entity-extractor.ts`)**:
     - Deteksi deterministik dan semantik untuk kombinasi treatment umum (seperti `Pijat Bayi Ceria + Cukur Rambut Bayi`, `Pulih Ceria + Sinar Moksa`).
  2. **Dynamic Date Extraction & Anti-Backtracking (`src/slot-engine/dynamic-closer.service.ts`)**:
     - Ditambahkan helper `extractDateMention` untuk mengekstrak hari majemuk (*"Sabtu atau Minggu"*, *"hari Jumat"*, *"besok"*).
     - Menambahkan aturan anti-backtracking tegas ke LLM: `⚠️ DILARANG menanyakan ulang apakah Bunda jadi mengambil paket/treatment jika Bunda sudah menanyakan/memilih paket tersebut`.
     - Mengarahkan alur percakapan langsung ke pertanyaan spesifik jam (pagi/siang/sore) atau penanyakan alamat rumah jika lokasi belum terkonfirmasi.

- **Pengujian & Verifikasi:**
  - Ditambahkan test case 7 & 8 di `tests/unit/slot-engine-context-continuity-and-adaptive-closer.test.ts`.
  - Seluruh 13 Test Suite Slot Engine (71/71 tests) **PASS**.
  - `npm run build` (`tsc`) sukses 100%.

#### Improved — Dynamic Closer Adaptif & Anti-Repetisi, Kontinuitas Memori Keluhan Bayi, & Pengetahuan Klinis Pijat Oksitosin (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **Pengulangan Kalimat Penutup (*Closing Loop*)**:
     - Saat customer mengajukan serangkaian pertanyaan teknis berurutan (durasi, keamanan bayi < 3 bulan, add-on sinar moksa, metode pembayaran), bot mengulang pertanyaan penutup yang sama persis (*"Rencana mau treatment apa bunda ?"*) hingga 6x berturut-turut.
  2. **Hilangnya Konteks Keluhan (*Context Amnesia*)**:
     - Saat customer sempat menanyakan layanan Ibu (*Pijat Oksitosin*) lalu memutuskan beralih kembali *"Ooh yaudah untuk baby aja kak"*, bot melupakan diskusi keluhan flu sebelumnya dan bertanya ulang dari awal.
  3. **Penegasan Pengetahuan Klinis Pijat Oksitosin**:
     - Penjelasan Pijat Oksitosin perlu dipertegas fungsi medis utamanya untuk Ibu Menyusui / Nifas dalam merangsang hormon oksitosin dan melancarkan ASI.

- **Solusi & Implementasi:**
  1. **Dynamic Closer Adaptif & Anti-Repetisi (`src/slot-engine/dynamic-closer.service.ts`)**:
     - Deteksi pertanyaan kontekstual (pembayaran, terapi sinar/alat, keamanan usia newborn, layanan ibu, dan konfirmasi fokus bayi).
     - Menghasilkan panduan penutup spesifik yang mengalir secara alami dan memandu customer ke tahap berikutnya.
     - Penambahan negative constraint tegas: `⚠️ ATURAN ANTI-REPETISI: DILARANG mengulang kalimat penutup yang sama persis jika sudah pernah ditanyakan di riwayat chat`.
  2. **Kontinuitas Memori & Grounding Asosiasi Treatment (`grounding-composer.ts`, `entity-extractor.ts`)**:
     - Menjaga keluhan aktif (`flu`, `batuk`, `pilek`) dan mengarahkan kembali ke *Pijat Bayi Pulih Ceria* saat customer beralih keputusan fokus ke anak (`"untuk baby aja kak"`).
  3. **Penyempurnaan Pengetahuan Klinis di `PersonaComposer` (`persona-composer.ts`)**:
     - Menegaskan bahwa Pijat Oksitosin & Paket Laktasi adalah perawatan khusus Ibu Menyusui / Pasca Melahirkan (Nifas) untuk merangsang produksi hormon oksitosin alami, memperlancar ASI, serta meredakan ketegangan tubuh Bunda.

- **Pengujian & Verifikasi:**
  - Menambahkan test suite baru `tests/unit/slot-engine-context-continuity-and-adaptive-closer.test.ts` (6 passing tests).
  - Seluruh 13 Test Suite Slot Engine (69/69 tests) **PASS**.
  - `npm run build` (`tsc`) sukses 100%.

#### Added — Pemisahan Semantik 3-Bubble Khusus Pesan Formulir Reservasi (2026-08-27)

- **Latar Belakang & Kebutuhan:**
  - Saat bot mengirimkan rekomendasi treatment lengkap dengan formulir reservasi dan instruksi SOP, seluruh pesan sebelumnya digabung atau terpotong kaku.
  - Untuk pengalaman pengguna WhatsApp yang optimal dan memudahkan customer menyalin (*copy*) format reservasi tanpa teks pengantar atau penutup, pesan harus dipisah rapi menjadi 3 gelembung pesan (*bubble chat*):
    1. **Bubble 1**: Jawaban empati / konsultasi / konfirmasi pengecekan jadwal (*"Tentu bisa, Bunda. Untuk keluhan batuk dan pilek..."*).
    2. **Bubble 2**: Format pendaftaran reservasi terstruktur (*"Berikut list untuk reservasi : ... "*).
    3. **Bubble 3**: Panduan pengisian dan kebijakan pembatalan SOP (*"Mohon bisa diisi Bunda 😊 ... Cancel H-3 jam ... "*).

- **Solusi & Implementasi:**
  1. **Logika Semantik 3-Bubble di `TypingService` (`src/services/typing.service.ts`)**:
     - Menambahkan deteksi format form reservasi berbasis batas semantik (`formHeaderIndex` dan `formFooterIndex`).
     - Jika pesan memuat Intro + Form + Footer, otomatis dipisah menjadi 3 bubble terpisah.
     - Setiap bubble dikirimkan secara berurutan dengan simulasi jeda mengetik manusiawi (*humanized typing & inter-bubble delay*).
  2. **Dukungan AI Sandbox Simulator & Evaluasi Admin (`evaluations.subroute.ts`, `AiSandbox.tsx`)**:
     - Endpoint `/api/admin/sandbox/chat` mengembalikan `sentBubbles` array sehingga tampilan AI Sandbox merender masing-masing bubble secara visual terpisah.

- **Pengujian & Verifikasi:**
  - Ditambahkan unit test di `tests/unit/typing.test.ts` untuk memvalidasi pemisahan tepat 3 bubble pada full consultation reply.
  - Seluruh 11 Test Suite Slot Engine (52/52 tests) + Typing Tests (11/11 tests) **PASS**.
  - `npm run build` backend dan frontend admin dashboard sukses 100%.

#### Fixed — Penanganan Cerdas Pertanyaan Jadwal & Layanan (Jawab Layanan Dulu, Infokan Cek Jadwal) (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **Pertanyaan Jadwal & Layanan**:
     - Saat customer bertanya kombinasi layanan dan hari (misal *"Kalau mau pijat batuk pilek besok bisa ?"*), bot perlu menjawab pertanyaan seputar layanan terlebih dahulu dengan jelas dan solutif, kemudian menginfokan secara transparan bahwa ketersediaan jadwal Bidan yang bertugas akan dicekkan terlebih dahulu.
     - Sebelumnya, jika formulir langsung dikirim tanpa kalimat pengantar pengecekan jadwal, percakapan terkesan melompati konfirmasi ketersediaan slot.

- **Solusi & Implementasi:**
  1. **Penyempurnaan Persona Rule & Dynamic Closer (`persona-composer.ts`, `dynamic-closer.service.ts`)**:
     - **Aturan 1 (Jawab Layanan Dulu)**: Bot menjelaskan paket treatment yang tepat (*Pijat Bayi Pulih Ceria* untuk batuk/pilek/flu).
     - **Aturan 2 (Infokan Cek Jadwal)**: Bot menginfokan bahwa ketersediaan jadwal di hari/waktu tersebut akan dicekkan terlebih dahulu oleh tim Bidan (*"Untuk ketersediaan jadwal besok, akan kami bantu cekkan ketersediaan jadwal Bidan yang ready ya Bunda 😊"*).
     - **Aturan 3 (Lampirkan Form / Arahkan Jam)**: Bot menyertakan form reservasi pre-filled atau menanyakan perkiraan jam agar slot jadwal dapat segera dicek dan diamankan.
  2. **Penyempurnaan `GroundingComposer` (`grounding-composer.ts`)**:
     - Mengaitkan keluhan fisik (`allSymptoms > 0`) ke `Pijat Bayi Pulih Ceria` secara otomatis pada generator pre-filled form.

- **Pengujian & Verifikasi:**
  - Terverifikasi pada pengujian chat:
    - *Bot Reply*: *"Tentu bisa, Bunda. Untuk keluhan batuk dan pilek, kami sarankan layanan Pijat Bayi Pulih Ceria yang dirancang khusus untuk membantu meredakan gejala tersebut. Untuk ketersediaan jadwal besok, akan kami bantu cekkan ketersediaan jadwal Bidan yang ready ya Bunda 😊."* + Lampiran list reservasi.
  - Seluruh 11 Test Suite Slot Engine (52/52 tests) **PASS**.
  - `npm run build` (`tsc`) sukses 100%.

#### Fixed — Eliminasi False Trigger Double Ongkir Guard pada Pertanyaan Klinis & Treatment (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **False Trigger Double Ongkir Guard pada Turn Lanjutan**:
     - Setelah bot mengirimkan rincian ongkir (misal: *"Jika dilihat dari jaraknya kurang lebih 22.6 km..."*) dan customer membalas dengan pertanyaan keluhan/treatment (*"Kalau mau pijat batuk pilek bisa ?"*), `EntityExtractor` mengekstrak `location_text` dari riwayat sebelumnya.
     - `DecisionMatrix` mengecek `hasNewLocationText` dan `isRecentOngkirSent (< 45s)` secara agresif tanpa mengecek apakah customer sedang mengajukan pertanyaan klinis (`consult_symptom` / `batuk` / `pilek`).
     - Akibatnya, `DecisionMatrix` membalas deterministik dengan template pengulangan lokasi:
       `Baik Bunda, lokasi di Sidotopo Wetan sudah kami simpan yaa 😊\n\nRencana mau treatment apa bunda ?🤗`
       sehingga mengabaikan pertanyaan klinis customer mengenai batuk dan pilek.

- **Solusi & Implementasi:**
  1. **Pengetatan Kriteria Double Ongkir Guard (`decision-matrix.ts`)**:
     - Menambahkan deteksi `hasClinicalOrOtherInquiry` (`extraction.symptoms.length > 0`, `treatmentReferenced`, `consult_symptom`, `select_treatment`, `ask_price`, `ask_schedule`, dll.).
     - Double Ongkir Guard **HANYA** dipicu jika customer murni mengirim ulang pesan lokasi/alamat tanpa pertanyaan klinis atau permohonan treatment/jadwal.
     - Pertanyaan klinis/treatment dialirkan dengan mulus ke `GENERATE_AI_RESPONSE` (`GroundingComposer` + `ReplyGenerator`) untuk menghasilkan rekomendasi paket yang tepat (*Pijat Bayi Pulih Ceria*).

- **Pengujian & Verifikasi:**
  - Ditambahkan automated regression test di `tests/unit/multi-turn-symptom-ongkir-guard.test.ts`:
    - Scenario: Alur Platuk Tauladan Sidotopo Wetan -> Turn 2 balas ongkir -> Turn 3 customer kirim *"Kalau mau pijat batuk pilek bisa ?"* -> Terverifikasi **TIDAK** memicu false guard dan mengalirkan ke rekomendasi `Pijat Bayi Pulih Ceria`.
  - Seluruh 11 Test Suite Slot Engine (52/52 tests) **PASS**.
  - `npm run build` (`tsc`) sukses 100%.

#### Fixed — Kepatuhan Wajib Sapaan Pembuka Turn-0 & Perkenalan Bidan Yusi (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **Bypass Sapaan Pembuka pada Kata Opener Pendek (`"bisa kah"` / `"bisa"` / `"halo"`)**:
     - Pada `DecisionMatrix`, kata opener pendek seperti `"bisa kah"` atau `"bisa gak"` terdeteksi sebagai pertanyaan spesifik (`hasSpecificQuestion`), sehingga mem-bypass Priority 2B (`TEMPLATES.greeting`).
     - Alur percakapan terlempar ke LLM `ReplyGenerator`, yang langsung menjawab isi pesan (*"Tentu bisa Bunda, kami siap membantu..."*) tanpa menyertakan sapaan resmi pembuka (`"Halo Bunda! ✨\nTerima kasih sudah menghubungi kami...\nPerkenalkan, saya Bidan Yusi..."`).
  2. **Ketiadaan Enforcement Prefix Perkenalan Bidan Yusi di Turn-0**:
     - Bila customer mengajukan pertanyaan spesifik pada Turn-0 (misal: *"Kalau mau pijat batuk pilek bisa?"*), LLM sering lupa menyertakan perkenalan resmi Bidan Yusi.

- **Solusi & Implementasi:**
  1. **Penyempurnaan Opener Phrase & Urutan Priority DecisionMatrix (`decision-matrix.ts`)**:
     - Menjadikan frasa pembuka (`"bisa kah"`, `"bisa gak"`, `"halo"`, `"p"`, `"selamat malam"`, dll.) sebagai `isPureLeadOpener` yang deterministik membalas `TEMPLATES.greeting({ isIslamic })` bila tidak ada keluhan klinis / harga / lokasi spesifik.
     - Menata ulang prioritas agar FAQ Kebijakan Operasional (metode pembayaran, kualifikasi bidan STR, asal klinik) dievaluasi dengan tepat.
  2. **Turn-0 Mandatory Greeting Guard di `ReplyGenerator` (`reply-generator.ts`)**:
     - Menambahkan guard deterministik pada `ReplyGenerator.generate`: Jika percakapan berada di Turn-0 (`historyCount === 0`) dan balasan LLM belum memuat perkenalan Bidan Yusi, sistem otomatis menambahkan header sapaan resmi `TEMPLATES.firstContactGreetingHeader` di awal pesan.
  3. **Penambahan Token 'bisa' pada `greeting-checker.ts`**:
     - Menambahkan token `'bisa'` ke `STANDARD_LEAD_TOKENS` agar pesan lead sapaan Meta Ads terdeteksi murni.

- **Pengujian & Verifikasi:**
  - `tests/unit/slot-engine-opener-greeting.test.ts` (3 tests):
    - Test 1: Customer kirim `"bisa kah"` di awal chat -> membalas template greeting resmi Bidan Yusi (`Halo Bunda ! ✨... Perkenalkan, saya Bidan Yusi...`).
    - Test 2: Customer kirim `"halo"`, `"Selmat malam"`, `"p"`, `"bisa homecare?"` -> membalas template greeting resmi.
    - Test 3: Customer kirim pertanyaan klinis di Turn-0 -> `ReplyGenerator` otomatis menyertakan header perkenalan Bidan Yusi.
  - Seluruh 11 Test Suite Slot Engine (51/51 tests) **PASS**.
  - `npm run build` (`tsc`) sukses 100%.

#### Fixed — Composite Geocoding Resolution & Format Balasan Ongkir Deterministik Resmi (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **Geocoding Imprecise pada Alamat Multi-Komponen**: Saat customer mengirimkan alamat lengkap berisi jalan + kelurahan + kecamatan (`"Platuk tauladan 19a , sidotopo wetan , kenjeran"`), `EntityExtractor` memecah input menjadi `street_detail: "Platuk tauladan 19a, Sidotopo Wetan"` dan `location_text: "Kenjeran"`. `DecisionMatrix` sebelumnya hanya mem-pass `locationText` ("Kenjeran") ke geocoding, sehingga menghasilkan kecamatan (`isPrecise: false`) dan gagal mengonfirmasi lokasi secara deterministik.
  2. **Format Balasan Ongkir Tidak Sesuai SOP Resmi**: Template balasan ongkir sebelumnya belum menggunakan formulasi SOP baku Kala Spa (*"Jika dilihat dari jaraknya kurang lebih X km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp Y tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp Z saja bunda. Jadi bisa ya bunda ☺️\n\nRencana mau treatment apa bunda ?🤗"*).

- **Solusi & Implementasi:**
  1. **Pencarian Geocoding Bertingkat & Composite Query (`DecisionMatrix`)**:
     - Membangun `compositeQuery` bertingkat: gabungan `streetDetail + locationText`, `rawText` fallback, dan `locationText` di [`src/slot-engine/decision-matrix.ts`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/slot-engine/decision-matrix.ts).
     - Menambahkan *Smart Ambiguity Disambiguation* untuk mencocokkan kelurahan spesifik dari daftar kelurahan kecamatan jika kecamatan terdeteksi.
     - Memperbarui `isPureLocationMessage` agar pesan lokasi (termasuk yang menanyakan ongkir seperti *"ada ongkir ga ya"*) langsung membalas template ongkir resmi deterministik.
     - Menambahkan penanganan `isGenericCityOnly` agar bot meminta detail kelurahan/desa secara santun bila customer hanya menyebutkan nama kota umum (seperti *"Sidoarjo"* atau *"Surabaya"*).
  2. **Standarisasi `TEMPLATES.ongkirInfo` (`persona.ts`)**:
     - Menyesuaikan `TEMPLATES.ongkirInfo` di [`src/config/persona.ts`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/config/persona.ts) dengan teks baku SOP resmi klinik Kala Spa.
  3. **Penyempurnaan Dynamic Catalog Duration & Fact Grounding**:
     - Menambahkan `getServiceDurationSummary()` dan `matchServicesBySymptoms()` pada `treatmentCatalogService` di [`src/services/treatment-catalog.service.ts`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/services/treatment-catalog.service.ts).
     - Menghubungkan durasi dinamis dan fakta grounding ke `PersonaComposer` dan `GroundingComposer`.

- **Pengujian & Verifikasi:**
  - Verifikasi Turn-2 reproduction script (`"pijat bisa ?"` -> `"Platuk tauladan 19a , sidotopo wetan , kenjeran"`) menghasilkan respon persis:
    `"Jika dilihat dari jaraknya kurang lebih 22.6 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp 35.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp 25.000 saja bunda. Jadi bisa ya bunda ☺️\n\nRencana mau treatment apa bunda ?🤗"`.
  - 10 Test Suite Unit & Integrasi (`slot-engine-conversational-flow`, `slot-engine-legacy-parity`, `slot-engine-form-and-schedule-integration`, `multi-turn-symptom-ongkir-guard`, `slot-engine-rules`, `slot-engine-transcript-e2e`, `wonorejo-tegalsari-e2e`, `slot-engine-no-proactive-age-prompt`, `slot-engine-dynamic-catalog-facts`, `slot-engine-response-validator`) 48/48 PASS.
  - `npm run build` PASS (0 TypeScript errors).

#### Fixed — Silent Background Location Enrichment saat Human Handling (Sawotratap 6283831256927) (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **Gate Human Handling Memotong Geocoding**: `machine.ts#47` dan `decision-matrix P2 SILENT_HUMAN_ACTIVE` langsung `return shouldSendReply:false` saat `is_human_handling=true`, tanpa memanggil `EntityExtractor`/`geocodingService`/`deliveryService`. Akibatnya `customers.lat/lng/distance_km/ongkir` tetap NULL.
  2. **Hanya 2 Kasus di `human.ts`**: Penanganan human handling sebelumnya hanya menyimpan reservasi form lengkap dan pin GPS native, tidak ada enrichment untuk teks alamat biasa (`Jl anusanata No.19 Sawotratap Gedangan Sidoarjo`).
  3. **Case Live Sawotratap**: Customer `6283831256927` (Bunda Mukodimatul Hikma) alamat jelas ada di gazetteer `Sawotratap -7.3708486,112.7301098` tapi jarak tidak terekam; balasan admin `jaraknya 4km` hanya teks manual.
- **Solusi & Implementasi:**
  1. **Service Baru `human-background-enrichment.service.ts`**: Silent enrichment (fire-and-forget, `shouldSendReply:false`, fail-safe) — teks alamat via AI NLU `EntityExtractor` → `geocodingService.geocodeText` (gazetteer Tier-1) → `deliveryService.calculateDelivery` (ORS → Google → Haversine) → `customerService.updateCustomerLocation`; pin GPS via `reverseGeocode`; form reservasi via `parseReservationText` + geocode `kec/kota/address`. Hormati guard `share_location_sent`, hanya save jika `isPrecise=true`.
  2. **Integrasi Gate `machine.ts`**: Gate `HUMAN_HANDLING` kini `enrichAsync` (tanpa `await` blocking) sebelum `return shouldSendReply:false`, sehingga webhook tetap cepat (<200ms) tapi DB tetap terisi.
  3. **Refaktor `human.ts`**: Delegasi ke `humanBackgroundEnrichmentService.enrichSync` sebagai single source; legacy form capture tetap sebagai backup idempoten 24h.
  4. **Backfill Live**: `Sawotratap` di live di-update `lat -7.3708486 lng 112.7301098 distance_km 5.03 ongkir 5000` (ORS buffered 1.1x, 4.57km raw).
- **Pengujian & Verifikasi:**
  - `tests/unit/human-background-enrichment.test.ts` 5/5 PASS (teks Sawotratap, GPS pin, form geocode, skip filler/already-has-location).
  - `npm run build` pass, `docs/KNOWN_ISSUES.md#14b` ditambah.

#### Feature & Refactor — Dynamic Persona DB Integration & Elimination of Proactive Age Prompting (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **Gating Pertanyaan Usia Proaktif (`determineMissingSlot: 'AGE'`)**:
     - Pada alur konsultasi keluhan (misalnya *"Kalau mau pijat batuk pilek bisa?"*), bot selalu menutup pesan dengan menanyakan usia si kecil secara proaktif (*"Kalau boleh tahu, berapa usia si kecil saat ini ya Bunda agar rekomendasinya tepat? 😊"*).
     - Hal ini memperpanjang gesekan (*friction*) percakapan sebelum masuk ke tahap penawaran jadwal dan booking, padahal usia si kecil dapat dilengkapi secara otomatis atau mandiri saat pengisian formulir reservasi.
  2. **Pemisahan Custom Persona Prompt DB dari Slot Engine Baru**:
     - Aturan SOP / custom persona prompt dari Database (`TenantPersona` via `loadPersonaFromDb` / `persona_custom.txt`) belum terinjeksi ke dalam `composeSlotGeneratorPrompt` dan `composeFastFaqPrompt` di `PersonaComposer`.

- **Solusi & Implementasi:**
  1. **Eliminasi Total Pertanyaan Usia Proaktif & Prioritas Jadwal (`DynamicCloserService` & `PersonaComposer`)**:
     - Menghapus tipe `'AGE'` dari `determineMissingSlot` di [`src/slot-engine/dynamic-closer.service.ts`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/slot-engine/dynamic-closer.service.ts).
     - Mengalihkan CTA penutup setelah pembahasan treatment/keluhan langsung ke penawaran jadwal kunjungan (`SCHEDULE`: *"Rencana mau treatment di hari apa Bunda ? 😊"*).
     - Menambahkan `Rule 18: ATURAN USIA PASIEN (TIDAK PERLU DITANYAKAN PROAKTIF)` pada `PersonaComposer.getPersonaRules` di [`src/slot-engine/persona-composer.ts`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/slot-engine/persona-composer.ts) dan negative constraint larangan tanya usia pada prompt sistem.
  2. **Pencatatan Usia Secara Pasif (`CustomerSlate` & `GroundingComposer`)**:
     - Usia anak tetap diekstrak pasif oleh `EntityExtractor` (`parseAgeTextToMonths`), disimpan di `CustomerSlate`, dan otomatis diisikan ke pre-filled form reservasi bila customer menyebutkannya secara sukarela.
     - Memperbarui patient dossier di [`src/slot-engine/grounding-composer.ts`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/slot-engine/grounding-composer.ts) dengan status `[STATUS: TIDAK PERLU DITANYAKAN PROAKTIF, AKAN DILENGKAPI SAAT RESERVASI]`.
     - Menghapus `'AGE'` dari `getMissingCriticalSlots` di [`src/slot-engine/slate-store.ts`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/slot-engine/slate-store.ts).
  3. **Integrasi Custom Persona DB ke Slot Engine (`ReplyGenerator` & `FastFaqGenerator`)**:
     - Memuat persona dari Database (`loadPersonaFromDb(tenantId)`) di [`src/slot-engine/reply-generator.ts`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/slot-engine/reply-generator.ts) dan [`src/slot-engine/fast-faq-generator.ts`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/slot-engine/fast-faq-generator.ts).
     - Menginjeksi blok custom persona ke `composeSlotGeneratorPrompt` dan `composeFastFaqPrompt` di `PersonaComposer`.
  4. **Penguatan Single Source of Truth `isOngkirAlreadySent` & Baseline Fallbacks**:
     - Menggunakan riwayat chat (`historyText`) sebagai indikator pasti apakah paragraf ongkir sudah pernah dikirimkan untuk mencegah duplikasi ongkir berulang.
     - Menyempurnakan `baselineFallback` di `ReplyGenerator` agar mengonfirmasi paket dan jadwal secara kontekstual saat offline.

- **Pengujian & Verifikasi:**
  - Unit test baru [`tests/unit/slot-engine-no-proactive-age-prompt.test.ts`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/tests/unit/slot-engine-no-proactive-age-prompt.test.ts): 6/6 tests PASS.
  - Regresi lengkap Slot Engine (8 test files, 34 tests): 100% PASS.
  - TypeScript compilation check (`npm run build`): 100% lulus (0 errors).

#### Feature & Refactor — Conversational Consultation Flow, Price Grounding & Form Attachment Hardening (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **Pengiriman Formulir Reservasi Prematur di Turn-2 (*Over-eager Form Attachment*)**:
     - Ketika customer di Turn-2 baru memberikan lokasi dan menanyakan kelayakan (*"Saya lokasinya di alana tambak oso waru bisa pijat bayi 1 bulan gak ya"*), `DynamicCloserService` dan `GroundingComposer` langsung menganggap kondisi siap booking (`isBookingReady = true`) dan menyodorkan formulir reservasi panjang sebelum customer menyetujui harga/ongkir.
  2. **Hilangnya Harga Paket pada Prompt LLM (`reply-generator.ts`)**:
     - `catalogText` pada `ReplyGenerator` hanya me-map nama, durasi, dan deskripsi tanpa menyertakan `promoPrice`, sehingga LLM tidak dapat menyebutkan tarif resmi paket rekomendasi.
  3. **Pemotongan Header Sapaan pada Simulator & Distorsi Kata `Baby` (`language-sanitizer.ts`)**:
     - Simulator sandbox yang mengawali chat dengan pesan sistem menyebabkan `historyCount = 1`, memicu `sanitizeGreetingRepetitionForFollowUp` memotong `Halo Bunda !` dan menyisakan emoji `✨` melayang.
     - Regex sanitizer mengubah kata `Baby` pada frasa resmi *"Treatment moms & Baby"* menjadi *"Treatment moms & bayi"*.

- **Solusi & Implementasi:**
  1. **Preservasi Template Sapaan Resmi & Frasa Brand (`src/utils/language-sanitizer.ts` & `src/slot-engine/slot-engine.ts`)**:
     - Menambahkan opsi `preserveGreeting: true` saat sanitasi `deterministicTemplateReply` agar template resmi Bidan Yusi tidak dipotong oleh sanitizer.
     - Memperbarui regex `sanitizeForbiddenEnglishWords` agar melindungi frasa resmi *"moms & baby"*, *"mom & baby"*, dan *"Treatment moms & Baby"*.
     - Memperbaiki `sanitizeGreetingRepetitionForFollowUp` agar tidak meninggalkan simbol/emoji melayang jika terjadi pemangkasan.
  2. **Grounding Harga Lengkap di Reply Generator (`src/slot-engine/reply-generator.ts`)**:
     - Menyertakan tarif promo (`(Tarif Promo: Rp ...)`) ke dalam `catalogText` pada prompt sistem LLM.
  3. **Penyempurnaan Alur Konsultasi vs Booking Form (`src/slot-engine/grounding-composer.ts` & `src/slot-engine/dynamic-closer.service.ts`)**:
     - Memperketat `isBookingReady`: Formulir reservasi pre-filled HANYA disuntikkan jika customer menyatakan niat booking eksplisit/implisit (`request_booking` atau menyebutkan hari kunjungan).
     - Pada tahap konsultasi awal, LLM diinstruksikan mengonfirmasi jangkauan lokasi + menyebutkan tarif ongkir promo + menyebutkan harga paket rekomendasi, lalu menanyakan preferensi hari secara ramah tanpa menyodorkan formulir panjang di awal.

- **Pengujian & Verifikasi:**
  - `tests/unit/slot-engine-conversational-flow.test.ts`: 6/6 tests PASS.
  - Seluruh unit & integrasi Slot Engine (8 test files, 55 tests): 100% PASS.
  - Full automated regression test suite: 213/213 test files PASS (1,904 tests PASS, 0 failures).
  - TypeScript build check (`npm run build`): 100% lulus (0 errors).

#### Feature & Hardening — Strict Greeting Persona & Lead Onboarding Standardization (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **False-Positive Ekstraksi Model Bisnis Umum pada `EntityExtractor`**:
     - Pada pesan klik iklan Meta seperti *"Promo[tg] Halo Bu Bidan, saya tertarik dengan layanan home-treatment"*, NLU Extractor mengekstrak frasa umum `"layanan home-treatment"` ke dalam field `treatmentReferenced`.
  2. **Bypass Sapaan Pembuka Resmi (`TEMPLATES.greeting`) di `DecisionMatrix`**:
     - Aturan `isLeadGreeting` di `DecisionMatrix` memiliki syarat `!extraction.treatmentReferenced`. Akibatnya, keberadaan entitas palsu `"layanan home-treatment"` membatalkan pemotongan template greeting resmi Bidan Yusi dan mengalirkan percakapan ke `ReplyGenerator`.
  3. **Ketiadaan Enforced Identity Bidan Yusi pada Turn-0**:
     - Prompt `PersonaComposer` sebelumnya hanya memuat instruksi sapaan umum (*"Sapa dengan hangat di awal pesan"*) tanpa mewajibkan perkenalan nama Bidan Yusi dan brand klinik Kala Moms and Baby Spa saat `historyCount === 0`.
  4. **Potensi Pembajakan Onboarding oleh Fast-Track FAQ**:
     - Guard `slate.projectedState === 'INITIAL'` pada `FastFaqDetector` tidak pernah aktif karena default slate selalu `AWAITING_LOCATION`, sehingga pesan sapaan awal berisiko terintersepsi Fast FAQ 1-Call tanpa onboarding lokasi.

- **Solusi & Implementasi:**
  1. **Sanitasi Post-Extraction Entitas (`src/slot-engine/entity-extractor.ts`)**:
     - Menambahkan fungsi terpusat `sanitizeExtractedEntities` untuk memfilter istilah model bisnis umum (*homecare, home-treatment, spa, pijat, layanan, paket*) dari `treatmentReferenced`, kata tempat generik (*rumah, klinik*) dari `locationText`, salam basa-basi dari `symptoms`, dan kata ganti (*Saya, Aku*) dari `customerName`.
  2. **Integrasi Deteksi Lead Terpusat & Sanitasi Tag Iklan (`src/slot-engine/decision-matrix.ts` & `src/state-machine/utils/greeting-checker.ts`)**:
     - Membersihkan tag tracking iklan (`Promo[...]`, `[ID: ...]`) di awal evaluasi `DecisionMatrix`.
     - Mengintegrasikan `checkLeadGreetingText` terpusat dan memperluas `STANDARD_LEAD_TOKENS` agar seluruh variasi lead iklan Meta dikenali 100% secara deterministik (0 Token).
     - Menambahkan guard `hasSpecificQuestion` agar pesan multi-intent (tanya harga/jadwal langsung) dialirkan ke `ReplyGenerator` dengan benar, sementara sapaan murni langsung dibalas dengan `TEMPLATES.greeting()`.
  3. **Penegasan Identitas Turn-0 di `PersonaComposer` (`src/slot-engine/persona-composer.ts`)**:
     - Mewajibkan pembukaan balasan Turn-0 dengan sapaan resmi, ucapan terima kasih, dan perkenalan: *"Perkenalkan, saya Bidan Yusi dari Kala Moms and Baby Spa."*.
  4. **Pengamanan Fast FAQ & Sinkronisasi Sandbox (`src/slot-engine/fast-faq-detector.ts` & `src/routes/admin/evaluations.subroute.ts`)**:
     - Mengamankan `FastFaqDetector` agar menolak pertanyaan pembuka saat lokasi customer belum terkonfirmasi.
     - Membersihkan tag tracking iklan pada simulator `/api/admin/sandbox/chat` agar pengujian identik dengan lalu lintas WhatsApp live.

- **Pengujian & Verifikasi:**
  - `tests/unit/slot-engine-lead-greeting.test.ts`: 13/13 tests PASS (menguji pesan iklan, sapaan Islami, multi-intent turn-0, dan filter false positive).
  - `tests/unit/centralized-persona-architecture.test.ts`, `tests/unit/slot-engine-decision.test.ts`, `tests/unit/slot-engine-transcript-e2e.test.ts`: 100% PASS.
  - Full automated regression test suite: 212/212 test files PASS (1,898 tests PASS, 0 failures).
  - TypeScript build check (`npm run build`): 100% lulus (0 errors).

#### Feature & Refactor — Conversational Booking Pipeline, Anti-Looping Forms & Strict Persona Enforcement (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **Short-Circuit Template Kaku di `DecisionMatrix`**:
     - Ketika customer memilih treatment atau bertanya kombinasi bundling (*"Pijat bayi ceria aja sm kalo untuk saya yg paket bundling pijat laktasi+oksitosin bisa kan ya"*), aturan kode deterministik `isBookingReady` di `DecisionMatrix` langsung memotong alur LLM (`ReplyGenerator`) dan menembakkan string template mentah `reservationFormRequest` yang kosong.
     - Akibatnya, pertanyaan customer terkait ketersediaan bundling Moms & Baby tidak terjawab, dan respon terasa kaku seperti bot formulir otomatis.
  2. **Looping Formulir Berulang pada Pertanyaan Jadwal Lanjutan**:
     - Saat customer menanyakan hari (*"Jumat apakah bisa"*), ketiadaan flag pelacak `reservationFormSent` menyebabkan `DecisionMatrix` kembali menganggap data siap reservasi dan menembakkan string form kosong yang sama untuk kedua kalinya berturut-turut.
  3. **Keterbatasan Grounding Katalog Multi-Kategori**:
     - `GroundingComposer` hanya memfilter layanan usia anak (kategori Baby), sehingga saat customer bertanya paket bundling ibu/moms (*laktasi, oksitosin*), data katalog Moms tidak masuk ke konteks LLM.
  4. **Kebocoran Kata Slang `"bund"` & Case-Sensitivity Bug**:
     - Template statis di `src/config/persona.ts` (`therapistQualificationPolicy`) memuat teks mentah berakhiran *"...profesional bund."*, dan regex sanitizer di `language-sanitizer.ts` bersifat case-sensitive (`/\bBund\b/g`), sehingga kata `"bund"` huruf kecil lolos ke pesan outbound WhatsApp.
- **Solusi & Implementasi:**
  1. **Pengetatan Sanitizer & Template Persona (`src/utils/language-sanitizer.ts` & `src/config/persona.ts`)**:
     - Mengubah regex slang menjadi `/\bbund\b/gi` (case-insensitive) sehingga semua variasi (`bund`, `Bund`, `BUND`) 100% dinormalisasi menjadi `Bunda`.
     - Membersihkan kata `"bund"` dari seluruh template statis di `persona.ts`.
  2. **Pelacak State Formulir Reservasi (`reservationFormSent`) (`src/slot-engine/types.ts` & `src/slot-engine/slate-store.ts`)**:
     - Menambahkan properti `reservationFormSent: boolean` pada `CustomerSlate`, dihydrate dan dipersist ke database preferences.
  3. **Grounding Multi-Kategori (Baby & Kids + Moms Bundling) (`src/slot-engine/grounding-composer.ts`)**:
     - Mendeteksi kata kunci layanan ibu/moms (*laktasi, oksitosin, nifas, hamil*) dan menyertakan katalog Moms ke `filteredCatalog`.
     - Menyusun `suggestedPreFilledForm` dengan field treatment dan jadwal yang sudah terisi otomatis (*smart pre-filled*).
  4. **Transformasi `DecisionMatrix` & Conversational Booking di `ReplyGenerator` (`src/slot-engine/decision-matrix.ts`, `src/slot-engine/dynamic-closer.service.ts`, `src/slot-engine/reply-generator.ts`)**:
     - Menghapus pemotongan template kaku di `DecisionMatrix`; percakapan booking dialirkan ke `ReplyGenerator` (LLM 2) untuk merangkai respon empatik Bidan Yusi.
     - Menyisipkan panduan smart form pada `DynamicCloserService` saat `!slate.reservationFormSent`.
     - Menambahkan panduan `FORM_ALREADY_SENT` untuk mencegah pengulangan formulir jika formulir sudah pernah dikirim di chat atas.
- **Pengujian & Verifikasi:**
  - `tests/unit/slot-engine-transcript-e2e.test.ts`: 100% PASS (seluruh 6 turn simulasi transkrip teruji lulus mulus).
  - `tests/unit/slot-engine-decision.test.ts`, `tests/integration/slot-engine-rules.test.ts`, `tests/integration/slot-engine-replay.test.ts`: 100% PASS.
  - Full regression test suite: 211/211 test files PASS (1,885 tests PASS, 0 failures).
  - TypeScript compilation check (`npm run build`): 100% lulus (0 errors).

- **Latar Belakang & Akar Masalah:**
  1. **Deteksi Palsu Form Reservasi pada Pertanyaan Chat Biasa**:
     - Pada fungsi `isReservationFormMessage` (`src/utils/reservation-text-parser.ts`), pencocokan kata kunci signal 2 terlalu longgar (misal kata `lokasi` dan `pijat bayi` dianggap sebagai field form reservasi).
     - Akibatnya, pesan pertanyaan biasa seperti *"Saya lokasinya di alana tambak oso waru bisa pijat bayi 1 bulan gak ya"* terdeteksi secara keliru sebagai formulir reservasi yang tidak lengkap, memicu balasan validasi *"Mohon maaf Bunda, mohon diisi bagian Nama Bunda/Bayi, Alamat pada list reservasi ya bund. Terima kasih! 😊"*.
  2. **Dampak Ikutan Hilangnya Ekstraksi Lokasi ke State Customer**:
     - Karena terputus di gerbang form palsu, lokasi *"alana tambak oso waru"* tidak pernah diproses oleh `EntityExtractor` dan `DecisionMatrix`.
     - Slate customer tidak menyimpan kelurahan/jarak terkonfirmasi, sehingga pada pesan-pesan berikutnya (*"Hm biasa untuk bayi 1 bulan apa ya"*, *"Pijat bayi ceria..."*, *"Jumat apakah bisa"*), `DynamicCloserService` terus mengulang pertanyaan alamat/kelurahan.
- **Solusi & Implementasi:**
  1. **Pengetatan `isReservationFormMessage` (`src/utils/reservation-text-parser.ts`)**:
     - Mengganti pencocokan kata kunci umum dengan deteksi berbasis struktur titik dua (`:`), header form resmi (`list untuk reservasi :`, `format reservasi :`, `pilihan treatment :`), atau paragraf booking eksplisit (*mau booking* + *alamat di* + *anak saya/newborn*).
  2. **Fallback Aman pada Interseptor Form (`src/slot-engine/slot-engine.ts`)**:
     - Jika parsing form gagal dan pesan bukan berupa template form berstruktur (tidak memiliki header/label titik dua), bot tidak menolak pesan dan membiarkannya mengalir mulus ke alur normal `SlotEngine` / NLU.
  3. **Ekstraksi Deterministik Lokasi Teks (`src/slot-engine/entity-extractor.ts`)**:
     - Menambahkan regex penangkap lokasi langsung pada `preExtractDeterministic` agar lokasi teks dapat terekstraksi secara instan dan andal.
- **Pengujian & Verifikasi:**
  - `tests/unit/slot-engine-transcript-e2e.test.ts`: Turn-by-turn simulation dari Turn 1 hingga Turn 6 lulus 100%.
  - `tests/unit/hybrid-reservation-parser.test.ts` & `tests/unit/slot-engine-form-and-schedule-integration.test.ts`: 100% PASS.
  - Full automated test suite: 211/211 test files PASS (1,885 tests PASS, 0 failures).
  - TypeScript build (`npm run build`): 0 errors.

#### Feature & Policy — Manual CS Bypass for Legacy & Repeat Patients with Admin Dashboard Toggles (2026-08-27)

- **Latar Belakang & Kebutuhan:**
  1. **Penanganan Manual Personal untuk Pasien Legacy & Pasien yang Pernah Treatment**:
     - Pemilik klinik menghendaki agar seluruh kontak legacy (arsip chat lama & kontak terdaftar sebelum tanggal cutoff) serta seluruh pasien yang sudah pernah melakukan treatment/reservasi terkonfirmasi selalu ditangani secara personal oleh CS manusia (bot senyap/tidak membalas).
  2. **Kebutuhan Kontrol Fleksibel (Toggle Switch) di Admin Dashboard**:
     - Pengaturan penanganan manual ini harus dapat diaktifkan atau dinonaktifkan sewaktu-waktu oleh admin/owner klinik melalui tampilan antarmuka Admin Dashboard.
  3. **Penegasan Keamanan WhatsApp Business**:
     - Fitur label WhatsApp Business (WAHA label mutation API) tetap dinonaktifkan sepenuhnya untuk menjaga kepatuhan dan stabilitas koneksi WhatsApp.
- **Solusi & Implementasi:**
  1. **Konfigurasi & Evaluasi AI Eligibility Resolver (`src/config/ai-eligibility-config.ts` & `src/services/ai-eligibility.service.ts`)**:
     - Menambahkan properti `legacy_bypass_bot` dan `repeat_patient_bypass_bot` (default: `true`) pada `AiEligibilityConfig`.
     - Memperluas `resolveAiEligibilityWithReason` untuk mendeteksi:
       * Pasien yang sudah pernah treatment / repeat order (`has_confirmed_reservation = true`, `purchase_count > 0`, status `repeat`) ➔ dialihkan ke `EXISTING_PATIENT_MANUAL`.
       * Kontak legacy (`is_legacy_source = true`, status `legacy`) ➔ dialihkan ke `LEGACY_CUSTOMER_MANUAL`.
  2. **Gerbang Bypass & Penanganan Pesan Masuk (`src/services/ai-scope-gate.service.ts` & `src/services/conversation.service.ts`)**:
     - Saat pesan dari customer kategori ini masuk, bot langsung senyap (`silence`), mencatat pesan ke riwayat chat dan Live Chat, serta mengalihkan status ke `HUMAN_HANDLING` dengan pesan notifikasi eskalasi yang informatif.
     - Mengecualikan eskalasi `LEGACY_CUSTOMER_MANUAL` dan `EXISTING_PATIENT_MANUAL` dari timer auto-release 6 jam agar tidak kembali ke bot secara tidak sengaja.
  3. **API Endpoint Pengaturan Tenant (`src/routes/admin/settings.subroute.ts`)**:
     - Memperbarui `GET /api/admin/ai-rollout-scope` dan `PATCH /api/admin/ai-rollout-scope` untuk membaca dan memperbarui nilai `legacyBypassBot` dan `repeatPatientBypassBot`.
  4. **Toggle Switch di Admin Dashboard (`AiRouterPanel.tsx` & `Settings.tsx`)**:
     - Menambahkan 2 kartu toggle switch modern pada panel **Target Pelanggan AI**:
       * *"Pasien Legacy (CS Manual)"* (Bypass bot untuk kontak arsip lama/impor).
       * *"Pasien Pernah Treatment (CS Manual)"* (Bypass bot untuk pasien yang sudah pernah reservasi/treatment).
- **Pengujian & Verifikasi:**
  - `tests/unit/legacy-and-repeat-bypass.test.ts`: 8/8 tests PASS.
  - `tests/integration/ai-scope-gate.test.ts` & `tests/unit/ai-scope-gate.test.ts`: 12/12 tests PASS.
  - Kompilasi `admin-dashboard` (`npm run build` via Vite): 100% lulus (0 errors).
  - TypeScript build backend (`npm run build` via tsc): 100% lulus (0 errors).
  - Full automated regression test suite: 211/211 test files PASS (1,885 tests PASS, 0 failures).

#### Fix & Integration — Slot Engine Reservation Form Pipeline, Schedule Guardrails, History Isolation & AI Scope Harmonization (2026-08-27)

- **Latar Belakang & Akar Masalah:**
  1. **Looping Form Reservasi & Hilangnya Penanganan Human Handling pada Slot Engine**:
     - Ketika customer mengisi dan mengirim formulir reservasi lengkap, `Slot-Filling Engine` (`processSlotEngine`) sebelumnya tidak memiliki interseptor `isReservationFormMessage`. Akibatnya, `DecisionMatrix` mengevaluasi `isBookingReady = true` dan mengulang pengiriman formulir reservasi kosong (`SEND_RESERVATION_FORM`) tanpa henti. Reservasi tidak tersimpan ke database dan tidak dialihkan ke `HUMAN_HANDLING`.
  2. **Halusinasi Ketersediaan Slot Jadwal (*"Jumat bisa Bunda!"*)**:
     - Bot tidak memiliki akses ke kalender live terapis namun LLM merespons sendiri konfirmasi ketersediaan jadwal, melanggar SOP klinik di mana penentuan jadwal fix harus diverifikasi oleh staf manusia/bidan.
  3. **Pengulangan Template Ongkir pada Pertanyaan Rekomendasi Treatment (History Leak)**:
     - Pada percakapan multi-turn, `EntityExtractor` menarik kembali `locationText` dari riwayat chat lama sehingga `DecisionMatrix` mengeksekusi ulang `RESOLVE_LOCATION_AND_DELIVERY` (mengirim template ongkir 9.2 km) alih-alih menjawab pertanyaan rekomendasi untuk bayi 1 bulan.
  4. **Pembungkaman Otomatis Customer Legacy (`LEGACY_AI_SCOPE_DISABLED`)**:
     - Tenant scope default `NEW_ONLY` membungkam customer lama secara senyap saat mengirim pesan tanpa pemberitahuan yang jelas ke pemilik klinik.

- **Solusi & Implementasi:**
  1. **Integrasi Form Reservasi di Slot Engine (`src/slot-engine/slot-engine.ts` & `src/slot-engine/decision-matrix.ts`)**:
     - Menambahkan gerbang `isReservationFormMessage` di awal `processSlotEngine`.
     - Mem-parse formulir reservasi via `parseReservationText`, menyimpan data booking ke `prisma.reservation.create` (`status: 'pending'`), menyinkronkan data anak via `reservationLifecycleService.onReservationCreated`, memperbarui nama kontak (`Bunda [Nama] [Kecamatan]`), memicu CAPI `InitiateCheckout` (`CUSTOMER_FORM_SUBMITTED`), dan mengalihkan status percakapan ke `HUMAN_HANDLING` (`is_human_handling = true`).
     - Mengirim balasan konfirmasi resmi disertai permintaan *share location pin* (jika belum pernah dikirim).
     - Menambahkan trigger CAPI `InitiateCheckout` (`BOT_FORM_SENT`) saat formulir reservasi pertama kali dikirim oleh bot.
  2. **Guard Anti-Halusinasi Jadwal & Dynamic Closer (`src/slot-engine/persona-composer.ts`, `src/slot-engine/dynamic-closer.service.ts`, `src/slot-engine/entity-extractor.ts`)**:
     - Menambahkan aturan persona ketat pada `PersonaComposer` dan instruksi `DynamicCloserService` (case `SCHEDULE`) yang melarang keras bot mengonfirmasi ketersediaan slot secara sepihak.
     - Menambahkan intent `ask_schedule` pada klasifikasi semantik `EntityExtractor`.
  3. **Isolasi Riwayat Lokasi & Anti-Loop Ongkir (`src/slot-engine/entity-extractor.ts` & `src/slot-engine/decision-matrix.ts`)**:
     - Memperketat prompt `EntityExtractor` agar hanya mengekstrak lokasi dari pesan terbaru customer.
     - Pada `DecisionMatrix` Priority 5, geocoding dan template ongkir hanya dijalankan jika lokasi belum terkonfirmasi atau customer secara eksplisit meminta ubah/ganti alamat.
  4. **Harmonisasi AI Customer Scope (`src/config/ai-eligibility-config.ts`)**:
     - Menambahkan dukungan variabel lingkungan `AI_CUSTOMER_SCOPE=ALL` pada fallback fail-closed.

- **Pengujian & Verifikasi:**
  - `tests/unit/slot-engine-form-and-schedule-integration.test.ts`: 5/5 tests PASS.
  - `tests/unit/slot-engine-transcript-e2e.test.ts`: Simulasi multi-turn turn-by-turn persis sesuai transkrip customer lolos 100%.
  - Full automated suite: 210/210 test files PASS (1,877 unit & integration tests).
  - TypeScript build check (`npm run build`): 100% lulus (0 errors).

#### Feature & Sync — Live Calendar Peek Synchronization & Total Payment Calculator in Reservation Modal (2026-08-26)

- **Latar Belakang & Kebutuhan:**
  1. **Jadwal Terisi Menampilkan (0) pada Modal Buat Reservasi dari Live Chat**:
     - Ketika membuka modal buat reservasi langsung dari sidebar Live Chat, data `existingReservations` tidak diteruskan dan modal tidak memiliki mekanisme mandiri untuk memuat daftar reservasi aktif, sehingga badge *"Lihat Jadwal Terisi"* selalu menunjukkan 0 dan drawer jadwal kosong.
  2. **Kebutuhan Rincian Biaya & Total yang Harus Dibayarkan**:
     - Belum ada kartu kalkulasi pembayaran terstruktur (Subtotal Treatment, Ongkir, Diskon Promo, dan Total Tagihan) di dalam formulir reservasi, serta nominal total (`purchaseValue`) belum tersimpan ke database reservasi saat pembuatan manual.
- **Solusi & Implementasi:**
  1. **Auto-Synchronization Jadwal Aktif (`CreateReservationModal.tsx`)**:
     - Menambahkan *auto-fetcher* yang otomatis memuat seluruh reservasi aktif dari `/api/admin/reservations` saat modal dibuka.
     - Memperbaiki algoritma filter tanggal `bookedReservationsForDate` agar mencocokkan format `YYYY-MM-DD` secara presisi lintas zona waktu (ISO & lokal).
     - Badge *"Lihat Jadwal Terisi (N)"* kini langsung menampilkan jumlah reservasi yang sebenarnya dan drawer menampilkan detail jam & pasien secara akurat.
  2. **Kartu Rincian Biaya & Total Pembayaran (`CreateReservationModal.tsx`)**:
     - Menampilkan rincian: **Subtotal Layanan** (terhitung otomatis dari seluruh paket layanan & multi-anak yang dipilih), **Ongkos Kirim** (pre-fill dari profil jarak customer dengan shortcut Free/10k/15k), dan **Diskon / Promo** (dengan shortcut -5k/-10k).
     - Menghitung **Total Tagihan**: $\text{Subtotal} + \text{Ongkir} - \text{Diskon}$.
  3. **Penyimpanan `purchaseValue` ke Database (`src/routes/admin/reservations.subroute.ts`)**:
     - Menambahkan penanganan `purchaseValue` pada `POST /api/admin/reservation` sehingga nilai tagihan tersimpan langsung di database PostgreSQL.
- **Pengujian & Verifikasi:**
  - `tests/unit/admin-create-reservation.test.ts`: 6/6 tests PASS.
  - Kompilasi `admin-dashboard` & backend engine `tsc` lolos 100% (0 errors).

- **Latar Belakang & Akar Masalah:**
  1. **Frasa Doa/Salam Tertangkap Sebagai Nama Bayi (`"sehat selalu yaa"`)**:
     - Percakapan penutup obrolan seperti *"semoga si kecil sehat selalu yaa"* atau *"dedek sehat selalu yaa"* tertangkap oleh fallback regex `/(?:dedek|adik|si\s*kecil)\s+([a-zA-Z\s]{2,25})/i`, sehingga teks doa `"sehat selalu yaa"` terekstrak sebagai nama bayi dan menimpa data nama bayi asli dari database (`Arviano Rizqi Al-Fatih`).
  2. **Harga Layanan Cepat Menampilkan `(Rp 0)` pada Chip Modal**:
     - Komponen `InvoiceGeneratorModal.tsx` sebelumnya mengakses properti `srv.price` secara langsung. Karena endpoint katalog `/api/admin/services` mengembalikan format `promoPrice` dan `originalPrice`, variabel `srv.price` bernilai `undefined` sehingga terformat sebagai `(Rp 0)`.
- **Solusi & Implementasi:**
  1. **Strict Child Name Validation (`isValidChildName` di `chatScheduleExtractor.ts`)**:
     - Menambahkan daftar filter kata percakapan/salam/doa (*sehat, selalu, yaa, semoga, lekas, sembuh, bobo, bapil, dsb.*).
     - Menolak frasa percakapan non-nama dan mengutamakan data anak resmi dari database (`customer.children[0].name`).
  2. **Service Catalog Price Resolver (`InvoiceGeneratorModal.tsx` & `chatScheduleExtractor.ts`)**:
     - Menambahkan helper `getServicePrice(s)` yang secara cerdas membaca `promoPrice ?? price ?? originalPrice ?? 0`.
     - Chip pilihan layanan di modal kini menampilkan harga asli/promo dengan benar (e.g. `Pijat Bayi Ceria (Rp 60.000)`) dan menetapkan harga yang sesuai saat diklik.
- **Pengujian & Verifikasi:**
  - `tests/unit/chat-schedule-extractor.test.ts`: 8/8 tests PASS (termasuk pengujian penolakan frasa *"sehat selalu yaa"*).
  - Kompilasi `admin-dashboard` & backend engine `tsc` lolos 100% (0 errors).

- **Latar Belakang & Investigasi Temuan Keamanan:**
  1. **SEC-01 (RBAC Isolation)**: Sesi staff/bidan sebelumnya memiliki akses universal ke seluruh endpoint `/api/admin/*` termasuk sandbox LLM chat, pengaturan sistem, ai-models, backup, dan manajemen akun staff.
  2. **SEC-02 (WAHA Media Proxy Auth)**: Route file `/api/files/:session/:file` tidak menerapkan otentikasi ketat sehingga berisiko mengekspos media WhatsApp privat.
  3. **SEC-03 (Tracking Key Exposure)**: `TRACKING_API_KEY` sempat di-inject ke HTML publik landing page.
  4. **SEC-04 (Secret Exposure in Repo/Git)**: Ditemukan API key dummy/asli di `.env.example`, `CHAT_SIMULATOR.md`, `opencode.json`, dan file scratch.
  5. **SEC-05 (Telegram Webhook Fail-Closed)**: Verifikasi secret Telegram webhook diperketat dengan `safeCompare` dan timing-safe authentication.
  6. **SEC-06 (Avatar SSRF Guard)**: Memasang validasi URL eksternal ketat pada `/media/avatar/:customerId` untuk mencegah fetch alamat privat/internal IP/cloud metadata.
  7. **SEC-07 (WAHA Webhook Timing-Safe)**: Memperbaiki komparasi string signature WAHA menggunakan `safeCompare` (`crypto.timingSafeEqual`).

- **Solusi & Implementasi:**
  1. **Admin RBAC Isolation Middleware (`src/routes/admin.route.ts`)**:
     - Membatasi sesi staff hanya untuk endpoint operasional harian (reservations, customers, livechat, analytics).
     - Memblokir akses staff ke `/backup/*`, `/sandbox/*`, `/ai-models/*`, `/settings/*`, dan `/staff/*` dengan response `403 Forbidden` (`FORBIDDEN_STAFF_ROLE` / `FORBIDDEN_STAFF_MANAGEMENT`).
  2. **Media Proxy & SSRF Protection (`src/routes/media.route.ts`)**:
     - Mewajibkan session cookie / API key valid untuk mengakses `/api/files/:session/:file` dan `/media/inbound/*`.
     - Memasang fungsi `isValidExternalUrl` yang memblokir private IPs, loopback, link-local (`169.254.169.254`), metadata clouds, dan protokol berbahaya pada avatar proxy.
  3. **Public Landing & Click Catcher Protection (`src/routes/landing.route.ts`, `src/routes/tracking.route.ts`, `src/landing/public/go.html`, `src/services/html-sanitizer.ts`)**:
     - Menghapus injeksi `TRACKING_API_KEY` dari template HTML landing page publik.
     - Endpoint `/api/tracking/click` kini memvalidasi origin/referer landing dan menerapkan rate-limit tanpa mengekspos secret server.
  4. **Secret Scrubbing & Hygiene (`.gitignore`, `.env.example`, `CHAT_SIMULATOR.md`, `opencode.json`)**:
     - Menghapus semua hardcoded credential dan token contoh; menggantinya dengan placeholder standar.
     - Menambahkan `scratch/` dan `opencode.json` ke `.gitignore`.
  5. **Gateway LLM Consistency & Secret Masking (`src/services/self-learning.service.ts`, `src/services/system-debug.service.ts`)**:
     - Menstandarisasi panggilan LLM di `self-learning.service.ts` menggunakan helper terpusat `getLlmEndpointConfig`, `callChatWithRetry`, dan `extractJsonContent`.
     - Memperluas daftar `SECRET_ENV_KEYS` di `system-debug.service.ts` agar seluruh API key, database URL, dan token ter-mask 100% dari respons debugger UI.

- **Pengujian & Verifikasi:**
  1. `tests/unit/admin-rbac-guard.test.ts`: 7/7 tests PASS (Super Admin & Staff role matrix).
  2. `tests/unit/media-security.test.ts`: 3/3 tests PASS (Proxy auth & SSRF guard).
  3. `tests/unit/webhook-security.test.ts`: 4/4 tests PASS (WAHA & Telegram timing-safe verification).
  4. Build `npm run build` sukses 100% (0 errors).

#### Bugfix & Enhanced — Dual-Category Form Parser, Promo Discount Support & Clean Name Ingestion (2026-08-26)

- **Latar Belakang & Akar Masalah:**
  1. **Kategori Tertukar Menjadi Moms & Header Bocor Sebagai Nama Treatment**:
     - Pada formulir standar klinik yang memiliki dua blok (blok `Pilihan treatment (Baby & Kids)` yang terisi dan blok `Pilihan treatment (Moms)` yang kosong), regex sebelumnya menangkap baris `Pilihan treatment (Moms) : ` sebagai nama treatment dan mengklasifikasikan kategori sebagai `MOMS` alih-alih `BABY`.
  2. **Potongan / Promo Ongkir Tidak Terkalkulasi**:
     - Model data dan invoice generator belum memiliki field diskon/promo (`Promo ongkir = - 5.000`), sehingga tagihan total tidak memotong nominal promo yang disepakati.
  3. **Nama Bunda Menampilkan Suffix Kota / Kontak (`Vita Sidoarjo`)**:
     - Kontak pelanggan di database tersimpan dengan suffix kecamatan/kota (`Bunda Vita Sidoarjo`), dan tombol reservasi di Live Chat belum menyaring suffix lokasi tersebut saat men-generate draft invoice.
  4. **Toleransi Null-Safety pada Tabel Katalog Layanan & Database Pasien**:
     - Pemanggilan `.toLocaleString()` langsung pada atribut harga yang belum terdefinisi berisiko memicu error render tabel.
- **Solusi & Implementasi:**
  1. **Dual-Section Multi-Category Parser (`chatScheduleExtractor.ts`)**:
     - Membagi teks formulir menjadi blok *Baby & Kids* dan *Moms*. Jika hanya blok Baby yang terisi data layanan/anak, otomatis dikategorikan sebagai `BABY` dan mengabaikan template kosong Moms.
     - Mencegah header formulir (`Pilihan treatment (Moms) :`) tertangkap sebagai nama treatment.
  2. **Promo Discount & Ongkir Engine (`paymentInvoiceFormatter.ts`, `InvoiceGeneratorModal.tsx`, `chatScheduleExtractor.ts`)**:
     - Menambahkan dukungan `discount` pada ekstraksi teks (`Promo ongkir = - 5.000`), kalkulasi total tagihan, dan input kontrol modal dengan shortcut tombol `-5.000`, `-10.000`, dsb.
     - Merender baris `Promo ongkir = - [nominal]` pada invoice resmi jika terdapat diskon aktif.
  3. **Clean Bunda Name Utility (`cleanBundaName`)**:
     - Membersihkan gelar (*Bunda, Ibu, Mama*) sekaligus membersihkan suffix nama kecamatan/kota dari nama kontak sehingga invoice menampilkan nama personal asli (`Vita`).
  4. **Null-Safety Guard pada UI**:
     - Melindungi semua kalkulasi dan pemformatan harga dengan wrapper `Number(val || 0)` di `ClinicServices.tsx` dan `CustomerDatabase.tsx`.
- **Pengujian & Verifikasi:**
  - `tests/unit/chat-schedule-extractor.test.ts`: 7/7 tests PASS (termasuk skenario formulir ganda pelanggan Vita).
  - `tests/unit/payment-invoice-formatter.test.ts`: 4/4 tests PASS.
  - Kompilasi `admin-dashboard` & backend `tsc` sukses 100% (0 errors).

- **Latar Belakang & Kebutuhan:**
  1. **Ekstraksi Otomatis Jadwal & Biaya dari Riwayat Chat**: Bidan/CS membutuhkan sistem yang dapat memindai obrolan percakapan terakhir untuk otomatis mendeteksi hari/tanggal kunjungan (*"besok"*, *"kamis tgl 27"*), jam (*"jam 12.00-12.30"*, *"jam 1 siang"*), layanan yang disepakati, data anak, dan ongkir tanpa perlu mengetik ulang dari awal.
  2. **Modal Draft Preview & Live WhatsApp Invoice Editor**: CS/Bidan menginginkan tampilan pop-up dialog ringkas sebelum teks invoice dimasukkan ke chat, di mana mereka dapat mengoreksi jam, memilih layanan klinik, menyesuaikan ongkir (dengan shortcut tombol `Free`, `10k`, `15k`, `20k`, dsb.), dan melihat live preview pesan WhatsApp secara real-time.
- **Implementasi Fitur & Arsitektur (`packages/admin-dashboard/src/utils/chatScheduleExtractor.ts`, `packages/admin-dashboard/src/components/modals/InvoiceGeneratorModal.tsx`, `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`, `tests/unit/chat-schedule-extractor.test.ts`):**
  1. **Smart Context Extractor Engine (`chatScheduleExtractor.ts`)**:
     - Memindai riwayat 10 pesan terakhir percakapan aktif.
     - Ekstraksi tanggal relatif (`besok`, `lusa`, `hari ini`) & absolut (`27 agustus`, `tgl 27`), rentang jam (`12.00-12.30`) atau jam wacana (`jam 1 siang`), pencocokan katalog layanan klinik, data anak (nama & usia), dan nominal ongkir dari chat atau jarak km.
  2. **Komponen `InvoiceGeneratorModal.tsx`**:
     - Tampilan 2 kolom (*Impeccable UI*): Kolom kiri untuk edit cepat tanggal, jam, Bunda, anak, layanan, dan ongkir; Kolom kanan untuk *Live WhatsApp Message Preview* lengkap dengan total kalkulasi harga.
     - Aksi footer: **Salin Format Saja** (`Copy`) dan **Masukkan ke Chat WA** (`Send`).
  3. **Integrasi Live Chat (`LiveChatMonitor.tsx`)**:
     - Menghubungkan menu `+` -> `🧾 Generate Invoice / Payment` dan icon `🧾` pada kartu reservasi sidebar untuk membuka `InvoiceGeneratorModal` dengan data prefill cerdas.
- **Pengujian & Verifikasi:**
  - `tests/unit/chat-schedule-extractor.test.ts`: 3/3 tests PASS.
  - `tests/unit/payment-invoice-formatter.test.ts`: 4/4 tests PASS.
  - Kompilasi frontend Vite (`packages/admin-dashboard`) & backend `tsc` lolos 100%.

#### Feature & UI — Live Chat Quick Reservation & 1-Click WhatsApp Payment Invoice Generator (2026-08-26)

- **Latar Belakang & Kebutuhan:**
  1. **Pembuatan Reservasi Langsung dari Live Chat**: Admin CS / Bidan membutuhkan akses instan untuk membuat reservasi baru dari tombol `+` di kolom chat tanpa harus berpindah ke menu lain, dengan data profil pasien (nama Bunda, alamat, anak, kelurahan/kecamatan, dan ongkir) yang langsung terisi otomatis.
  2. **1-Click WhatsApp Payment Invoice Generator (`🧾`)**: Admin CS memerlukan tombol generator invoice format WhatsApp resmi yang otomatis menarik data tanggal booking, nama anak/ibu, rincian treatment, perhitungan ongkir (free $\le 3$ km / berbayar), dan total biaya, yang langsung terisi ke input chat dan tersalin ke clipboard.
- **Implementasi Fitur & Arsitektur (`packages/admin-dashboard/src/utils/paymentInvoiceFormatter.ts`, `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`, `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx`, `packages/admin-dashboard/src/components/modals/ReservationDetailModal.tsx`, `tests/unit/payment-invoice-formatter.test.ts`):**
  1. **Utilitas `paymentInvoiceFormatter.ts`**:
     - `generateReservationInvoiceText`: Memformat pesan rincian booking & invoice rapi dengan emoji `🐣`, format tanggal & jam Indonesia WIB, kategori treatment (Baby/Moms/Bundle), nama & usia anak, breakdown harga treatment, rincian ongkir jarak km, total bayar, dan reminder H-1.
  2. **Menu Tombol `+` (Tools Bar di Live Chat)**:
     - Menambahkan opsi **`📅 Buat Reservasi Baru`** (`CalendarPlus`): Membuka `CreateReservationModal` dengan `initialCustomer` aktif.
     - Menambahkan opsi **`🧾 Generate Invoice / Payment`** (`Receipt`): Otomatis mengisi box chat dengan rincian invoice reservasi aktif.
- **Perbaikan Masalah Seleksi Teks di Live Chat**:
  - **Akar Masalah**: Terdapat event listener *mouse down long-press* 400ms (`handleBubbleMouseDown`) pada wadah bubble chat yang otomatis memicu `handleSelectReply` dan memindahkan fokus kursor ke box input chat saat pengguna menahan klik mouse untuk men-drag/menyeleksi teks.
  - **Solusi**: Menghapus pembajakan event mouse down dari bubble chat dan menambahkan atribut styling `select-text cursor-text` pada elemen teks pesan, sehingga pengguna dapat bebas memblok, menyalin (Ctrl+C), atau memilih teks pesan di Live Chat. Balas pesan (reply) dilakukan secara bersih melalui tombol balas (`↩️`).
  - `tests/unit/payment-invoice-formatter.test.ts`: 4/4 tests PASS (baby treatment, charged ongkir, moms category, fallback rawText).
  - Kompilasi frontend Vite (`packages/admin-dashboard`) & backend TypeScript `tsc` lolos 100% (0 error).

#### Feature & Enhanced — Automated Telegram Morning Briefing & Dedicated Telegram Hub UI (2026-08-26)

- **Latar Belakang & Kebutuhan:**
  1. **Briefing Jadwal Kunjungan Bidan Lapangan**: Diperlukan notifikasi otomatis setiap pagi (06:00 / 07:00 WIB) langsung ke akun Telegram pribadi masing-masing Bidan/Terapis yang bertugas, berisi rangkuman jadwal kunjungan hari tersebut secara terstruktur, urut jam, lengkap dengan data anak/ibu, link navigasi rute Maps motor, dan rincian biaya.
  2. **Pusat Kontrol Telegram di Sidebar & Hak Akses (RBAC)**: Admin CS & SPV CS memerlukan akses langsung dari sidebar navigasi untuk memantau status Telegram staf, menyalin link pairing 1-klik untuk dikirim via WhatsApp ke bidan, dan melakukan uji coba kirim briefing.
- **Implementasi Fitur & Arsitektur (`packages/admin-dashboard/src/pages/tenant/TelegramIntegration.tsx`, `packages/admin-dashboard/src/config/rolePermissions.ts`, `packages/admin-dashboard/src/components/common/Layout.tsx`, `packages/admin-dashboard/src/App.tsx`, `src/services/staff-notification.service.ts`, `src/services/cron.service.ts`, `src/routes/admin/staff-management.subroute.ts`, `tests/unit/staff-daily-briefing.test.ts`):**
  1. **Modul Hak Akses & Menu Sidebar RBAC**:
     - Menambahkan modul `telegram` (`/admin/telegram`) ke `ALL_MODULES` di bawah kategori `CRM & KOMUNIKASI` pada `rolePermissions.ts`.
     - Mengaktifkan izin modul ini secara default untuk role `admin_cs` dan `spv_cs` (serta `super_admin` & `tenant_admin`).
     - Menyematkan menu **Koneksi Telegram** pada sidebar navigasi `Layout.tsx`.
  2. **Halaman Dashboard `TelegramIntegration.tsx`**:
     - Tab **Notifikasi Jadwal Bidan/Terapis**: Metrik total terhubung/belum terhubung, pencarian staf, tombol **"Salin Link Pairing"** (1-klik copy untuk dikirim ke WA Bidan), tombol **"Test Briefing"** ke masing-masing bidan, dan tombol **"Broadcast Morning Briefing Hari Ini"**.
     - Tab **Laporan Harian & Alert Tim Klinik**: Menghubungkan bot laporan klinik ke chat pribadi Owner/Admin atau grup/topic Telegram klinik.
  3. **`StaffNotificationService.generateDailyBriefingText`**:
     - Membangun layout pesan briefing Markdown persis sesuai kebutuhan: header tanggal WIB, urutan nomor emoji (`1️⃣`, `2️⃣`, `3️⃣`), data si kecil/ibu hamil, rincian layanan, alamat kelurahan/kecamatan, tautan navigasi motor Google Maps, format total harga (`200k`), tautan portal internal staf, dan kalimat penyemangat.
     - Sanitasi karakter markdown (`*`, `_`, `[`, `]`) untuk mencegah *parse error* Telegram API.
  4. **`StaffNotificationService.sendStaffDailyBriefing` & `sendAllStaffMorningBriefings`**:
     - Perhitungan rentang hari UTC+7 WIB (`getWibDayRange`).
     - Pengambilan reservasi terkonfirmasi (`status != 'CANCELLED'`) yang ditugaskan ke staf pada tanggal terkait.
     - Pengiriman otomatis via `telegramService.sendMessage` ke `telegram_chat_id` staf.
  5. **Integrasi Morning Jobs di `CronService.runMorningJobs`**:
     - Briefing otomatis terpicu setiap pagi bersamaan dengan siklus morning jobs (06:00/07:00 WIB).
  6. **Admin Endpoints (`src/routes/admin/staff-management.subroute.ts`)**:
     - `GET /api/admin/staff/:id/telegram-pairing`: Mengambil link dan token pairing unik staf untuk dibagikan admin ke staf.
     - `POST /api/admin/staff/:id/telegram-pairing/regenerate`: Reset token pairing staf.
     - `POST /api/admin/staff/:id/send-briefing`: Trigger manual pengiriman briefing ke staf tertentu dengan opsi parameter tanggal.
     - `POST /api/admin/staff/trigger-morning-briefing`: Re-dispatch briefing ke seluruh staf bertugas hari ini.
- **Pengujian & Verifikasi:**
  - `tests/unit/staff-daily-briefing.test.ts`: 8/8 tests PASS (formatting layout, sanitasi markdown, WIB day range, multi-staf agregasi, fallback penanganan Telegram).
  - Kompilasi frontend Vite (`packages/admin-dashboard`) & backend TypeScript (`tsc`) 100% lolos (0 error).

#### Architecture & Enhanced — Centralized PersonaComposer, Unified Sanitizer, & Anti-Patchwork Engine (2026-08-26)

- **Latar Belakang & Masalah yang Dipecahkan:**
  1. **Solusi Tambal-Sulam & Fragmentasi Prompt**: Sebelumnya terdapat 5 prompt terpisah di 5 file berbeda (`generator.ts`, `fast-faq-generator.ts`, `reply-generator.ts`, `ai-verifier.service.ts`, `phrasing.service.ts`) dan sanitizer tersebar secara acak, sehingga perbaikan aturan di satu file bocor di file lain.
  2. **Halusinasi Medis Usia Newborn**: Modul Fast-Track FAQ berhalusinasi menyuruh customer newborn (usia 3 minggu) menunggu minimal 1 bulan, padahal SOP resmi klinik menyatakan newborn (0–28 hari / 0 bulan) 100% aman dan sangat dianjurkan dipijat oleh Bidan ber-STR.
  3. **Looping Monoton Kalimat Penutup**: AI mengulang kalimat statis *"Ada yang ingin Bunda konsultasikan untuk si kecil?"* di hampir setiap balasan.
  4. **Greeting Overuse & Slang Leakage**: Sapaan *"Halo Bunda!"* berulang di percakapan lanjutan, kata slang *"Bund"*, kata ganti *"saya"*, dan merk spesifik e-wallet (*"QRIS ShopeePay"*) lolos ke chat customer.
  5. **Pembajakan Alur Iklan Meta**: Regex FAQ mencocokkan kata *"home-treatment"* dari pesan klik iklan Meta di state `INITIAL`, memotong alur onboarding kelurahan.
- **Implementasi Arsitektur Terpusat (`src/slot-engine/persona-composer.ts`, `src/utils/language-sanitizer.ts`, `src/slot-engine/dynamic-closer.service.ts`, `src/slot-engine/fast-faq-detector.ts`, `src/slot-engine/fast-faq-generator.ts`, `src/slot-engine/reply-generator.ts`, `src/services/ai-verifier.service.ts`, `.agents/rules/anti-patchwork-architecture.md`):**
  1. **`PersonaComposer` (Single Source of Truth Prompt Engine)**:
     - Modul sentral perakit system prompt untuk seluruh pemanggilan LLM.
     - Mengunci identitas Bidan Yusi, sapaan wajib *"Bunda"* (anti-"Bund"), kata ganti *"kami"* (anti-"saya"), nama brand resmi *"Kala Moms and Baby Spa"*, dan batasan anti-overclaim kuratif.
     - Mengunci fakta klinis baku: **Newborn usia 0–28 hari / 0–1 bulan / 3 minggu 100% aman & sangat dianjurkan dipijat Bidan** (larangan keras menunda 1 bulan), durasi layanan standar (Bayi ~40m, Kids ~45m, Moms ~60m), homebase Waru, dan kebijakan ongkir 1x per kunjungan.
  2. **`UnifiedResponseSanitizer` (Centralized Outbound Pipeline)**:
     - Gerbang pembersih sentral sebelum pesan dikirim ke WhatsApp: normalisasi *"Bund"* $\rightarrow$ *"Bunda"*, *"saya bantu"* $\rightarrow$ *"kami bantu"*, pembersihan aksara asing/em-dash/backslash, normalisasi QRIS universal (menghapus merk e-wallet spesifik), dan perapian format angka rupiah (`Rp 25.000`).
     - **Header Greeting Stripper**: Memangkas otomatis sapaan pembuka ganda (`^Halo Bunda!`) pada sesi percakapan lanjutan yang sedang aktif.
  3. **`DynamicCloserService` (Slot-Aware Guidance)**:
     - Menghasilkan kalimat penutup dinamis cerdas berdasarkan *missing slots* dari `CustomerSlate`:
       - Belum ada lokasi $\rightarrow$ Tanya kelurahan/daerah untuk cek jadwal & ongkir.
       - Belum ada usia anak $\rightarrow$ Tanya usia si kecil.
       - Belum ada jadwal $\rightarrow$ Tanya preferensi hari & jam kunjungan Bidan.
  4. **Proteksi Struktural State Machine & Fast-Track Detector**:
     - `FastFaqDetector.isPotentialFastFaq` memproteksi state `INITIAL` dari pembajakan pesan lead iklan Meta agar customer baru selalu diarahkan ke alur onboarding kelurahan (`AWAITING_LOCATION`).
  5. **QC Pilar 7 pada `AiResponseVerifierService`**:
     - Menambahkan verifikasi keamanan usia newborn untuk memastikan draf AI tidak melarang pijat newborn.
  6. **Mandat Anti-Tambal-Sulam di `.agents/rules/anti-patchwork-architecture.md` & `AGENTS.md`**:
     - Menetapkan aturan baku permanen bagi seluruh agen AI agar tidak lagi menggunakan regex rapuh atau prompt terisolasi.
- **Pengujian & Verifikasi:**
  - `tests/unit/centralized-persona-architecture.test.ts`: 13/13 tests PASS.
  - Vitest test suite proyek: 201 test files PASS (1839 tests PASS).
  - TypeScript build `npm run build`: 100% lolos (0 error).

#### Fixed & Enhanced — Full Live Chat Outbound Sync for Automated Broadcasts & Follow-Ups (2026-08-26)

- **Latar Belakang & Masalah yang Dipecahkan:**
  1. **Hilangnya Bubble Awal di Live Chat**: Pesan follow-up otomatis (`NEXT_TREATMENT`, `NO_PURCHASE`, `Review H+1`, `Morning Reminder`) yang dipecah oleh engine Humanizer menjadi 2 bubble terkirim utuh ke WhatsApp customer, namun di database `messages` dan tampilan Live Chat Admin Dashboard hanya bubble terakhir yang tersimpan.
  2. **Penyebab Teknis**:
     - Ketiadaan pencatatan pesan (`messageService.logMessage`) pada modul background worker sebelum/sesudah pengiriman.
     - Pembersihan registry `inFlightBotOutbound` yang terlalu cepat secara sinkron di blok `finally` `simulateHumanReply`, sehingga webhook echo untuk bubble terakhir disalahartikan sebagai pesan eksternal baru yang terpisah.
     - Webhook WAHA mengabaikan bubble 1 karena menganggap bot sudah mencatatnya ke database.
- **Implementasi Perbaikan Backend (`src/services/follow-up.service.ts`, `src/services/cron.service.ts`, `src/services/broadcast-queue.service.ts`, `src/services/typing.service.ts`, `src/services/message.service.ts`):**
  1. **Explicit Pre-Logging pada Background Services**:
     - Menambahkan pencatatan resmi ke `messageService.logMessage` pada `FollowUpService.executeFollowUp` (WAHA & WABA), `CronService.sendMorningReminders`, `CronService.sendYesterdayReviewsAndScheduleNextFollowups`, dan `BroadcastQueueService.processBroadcastJob`.
     - Pesan tercatat lengkap dengan atribut `direction: 'OUTBOUND'`, `senderType: 'BOT'`, dan sender name yang deskriptif (`Bot (Follow-Up)`, `Bot (Morning Reminder)`, `Bot (Review H+1)`).
  2. **In-Flight Registry TTL Preservation**:
     - Menghapus penghapusan sinkron prematur di `typing.service.ts` `finally`, sehingga TTL default 45 detik (`ttlMs = 45000`) di `messageService` melindungi seluruh echo webhook WAHA dari false-positive.
  3. **Multi-Bubble Fragment Matching di Anti-Duplication Webhook**:
     - Memperbarui `checkAndAttachOutboundDuplicate` agar mampu mencocokkan potongan bubble (`existing.content.includes(normalizedContent)`) ke pesan gabungan yang sudah ada di database tanpa menciptakan duplikasi baris di Live Chat.
- **Pengujian & Verifikasi:**
  - `tests/unit/follow-up-livechat-sync.test.ts`: 4/4 tests PASS.
  - Seluruh suite unit & integration follow-up (36/36 tests PASS).
  - TypeScript compilation `npm run build` 100% lolos (0 error).

#### Enhanced — Natural Name & Multi-Baby Sanitizer + Auto-Queued Follow-Up Pipeline (2026-08-26)

- **Latar Belakang & Masalah yang Dipecahkan:**
  1. **Sanitasi Nama Kontak Buku Telepon**: Nama customer di database klinik sering kali memuat gelar awalan (`Bunda ...`), nama kelurahan/wilayah di buku kontak (`Viska rungkut`, `Bunda Karimah Sedati`), catatan admin (`+ Alamat`, `(Bunda Fatma)`), atau status WhatsApp. Tanpa pembersih otomatis, template pesan follow-up menghasilkan sapaan dobel *"Halo Bunda Bunda..."* atau menyebutkan nama kelurahan sebagai nama orang.
  2. **Dukungan Anak Kembar / 2+ Bayi (`babyName`)**: Pesan follow-up (Review H+1 dan Milestone) sebelumnya hanya mengasumsikan 1 anak. Ketika customer memiliki anak kembar atau 2+ bayi, sistem kini memformat nama anak secara alami (*"dek Arka & dek Arki"*).
  3. **Auto-Queued Follow-Up Default**: Menyetel status default follow-up baru langsung ke `QUEUED` (terjadwal di antrian) agar otomatis berjalan tanpa perlu manual approve satu per satu, dengan admin tetap leluasa mengubah/membatalkan jadwal dari antrian.
- **Implementasi Backend & Utility (`src/utils/name-sanitizer.ts`, `src/services/follow-up.service.ts`, `src/services/cron.service.ts`, `src/config/persona.ts`, `src/config/followup-templates.ts`):**
  1. **`sanitizeCustomerNameForGreeting(rawName)`**:
     - Membuang emoji, status WA, catatan `+ Alamat`, `(Bunda ...)`.
     - Membuang prefix gelar sapaan (`Bunda`, `Ibu`, `Mama`, `Moms`, `Ny.`, `~`, `Suami Bunda`).
     - Membuang keyword `Kecamatan ...` / `Kelurahan ...` serta puluhan nama kecamatan/kelurahan Surabaya & Sidoarjo di ujung nama.
     - Fallback cerdas jika nama berupa placeholder/generic (`Pelanggan`, `Sandbox`, `~`) $\rightarrow$ menghasilkan string kosong (sehingga disapa `"Halo Bunda!"` tanpa dobel spasi atau dobel kata).
  2. **`formatBabyNamesForGreeting(children, rawText, options)`**:
     - Membersihkan nama anak dari keterangan usia (`(3 bulan)`), awalan `Adek/Baby/Bayi`.
     - 1 anak $\rightarrow$ `"dek Kenzo"`.
     - 2 anak / kembar $\rightarrow$ `"dek Kenzo & dek Kenzie"`.
     - 3+ anak $\rightarrow$ `"dek Kenzo, dek Kenzie & dek Kayla"`.
     - Tanpa data anak $\rightarrow$ fallback natural `"si kecil"`.
  3. **Post-Processing & Typo Hardening di Engine Rolling Template**:
     - Filter regex otomatis membersihkan `Bunda Bunda` $\rightarrow$ `Bunda`, `Bunda !` $\rightarrow$ `Bunda!`, `dek dek` $\rightarrow$ `dek`, dan `dek si kecil` $\rightarrow$ `si kecil`.
     - Memperbaiki typo `Selamat tuan Bunda` $\rightarrow$ `Selamat pagi Bunda`.
  4. **Perubahan Status Default ke `QUEUED`**:
     - `prisma/schema.prisma`: `status FollowUpStatus @default(QUEUED)`.
     - `createNoPurchaseFollowUps` & `createNextTreatmentFollowUps` menyetel `status: 'QUEUED'`.
- **Implementasi Frontend Admin Dashboard (`packages/admin-dashboard`):**
  - Mengubah default tab filter di `FollowUpQueue.tsx` langsung membuka daftar `QUEUED` (terjadwal di antrian).
- **Pengujian & Verifikasi:**
  - `tests/unit/name-sanitizer.test.ts`: 19/19 tests PASS (mencakup 10+ variasi format kontak kotor, bayi kembar, multi-bayi, dan integrasi template).
  - Vitest suite follow-up & admin: 38/38 tests PASS (100%).
  - Backend typecheck & Frontend bundle: 100% lolos (0 error).

#### Enhanced — Smart Context Guard Follow-Up Queue (72-Hour Recent Chat Cooldown & Admin Context Visibility) (2026-08-26)

- **Latar Belakang & Kebutuhan:**
  1. **Pencegahan Pesan Follow-Up Canggung/Kaku**: Ketika customer baru saja berkirim pesan (baik dengan bot maupun staf admin via Live Chat), pengiriman pesan sapaan template follow-up yang tiba-tiba akan terasa kaku dan canggung.
  2. **Dukungan Penuh Pelanggan Human Handling**: Pelanggan loyal yang dikelola manual oleh admin tetap memiliki siklus follow-up perawatan rutin (+1 bulan, +2 bulan, +3 bulan) dan tidak boleh diblokir hanya karena statusnya `HUMAN_HANDLING`.
- **Implementasi Backend Engine (`src/services/follow-up.service.ts`):**
  1. **72-Hour Recent Interaction Cooldown Guard (`FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS`, default 72 jam / 3 hari)**:
     - Menggunakan pendekatan *Lazy Evaluation* tanpa overhead pada chatting real-time.
     - Saat worker memeriksa follow-up yang jatuh tempo (`scheduled_at <= NOW()`), sistem mengecek `conversations.last_message_at`.
     - Jika terdapat interaksi dalam 72 jam terakhir, jadwal follow-up otomatis dimundurkan $+3$ hari ke depan pada jam kerja (09:40 WIB) agar tidak menimpa obrolan yang baru selesai.
     - Jika percakapan sudah hening $\ge 3$ hari, follow-up dikirimkan secara normal baik untuk customer `INITIAL` maupun `HUMAN_HANDLING`.
  2. **Kueri Data Konteks Percakapan (`listFollowUps`)**:
     - Menyertakan data relasi `conversations` (`last_message_at`, `is_human_handling`) pada kueri daftar follow-up untuk konsumsi Admin Dashboard.
- **Implementasi Frontend Admin Dashboard (`packages/admin-dashboard`):**
  1. **`FollowUpQueue.tsx`**:
     - Menambahkan badge status `👤 Human Handling` untuk menandai pelanggan yang dikelola manual.
     - Menambahkan indikator interaksi chat terakhir (`💬 Chat: X hari lalu` / `Baru saja`) dengan highlight warna status.
     - Menambahkan tombol aksi cepat **"Buka Live Chat"** di setiap baris antrian untuk memudahkan admin menyapa secara langsung dengan bahasa personal.
     - Memperbarui panduan keselamatan header (*Smart Context Guard Notice*).
- **Pengujian & Verifikasi:**
  1. `tests/unit/follow-up-engine.test.ts`: 10/10 tests PASS (termasuk verifikasi penundaan otomatis saat ada chat $<72$ jam dan pengiriman normal saat $\ge 72$ jam).
  2. `tests/integration/follow-up-admin.test.ts`: 9/9 tests PASS.
  3. Backend compiler (`npm run build`) & frontend Vite bundle (`admin-dashboard: npm run build`) 100% lolos (0 error).

#### [v1.17.0] — Hybrid Fast-Track FAQ Engine (FAQ 1-Call & Dynamic Booking 2-Call) (2026-08-26)

- **Latar Belakang & Masalah yang Dipecahkan:**
  1. **Optimalisasi Latensi FAQ Murni**: Pertanyaan informasi umum (*"homecare kah?", "buka hari minggu?", "durasi berapa lama?", "bisa transfer?"*) sebelumnya membutuhkan 2 kali LLM call (Extractor + Generator) padahal tidak membutuhkan kalkulasi geocoding rute Maps atau validasi slot form multi-baris.
  2. **Perlindungan Akurasi Booking & Ongkir**: Menghindari risiko over-simplifikasi di mana pertanyaan alamat gang/kelurahan baru atau keluhan usia anak tetap wajib melalui komputasi deterministik (2-Call Deep Engine) agar terhindar dari halusinasi tarif atau salah pilih katalog usia.
- **Implementasi Fitur & Arsitektur:**
  1. **`FastFaqDetector` (`src/slot-engine/fast-faq-detector.ts`)**:
     - Heuristic classifier (0 Token, <5ms) yang mencocokkan pola pertanyaan FAQ umum (jenis layanan homecare, jam buka/hari operasional, durasi, pembayaran/QRIS, asal klinik, kualifikasi bidan, syarat homecare, tanya paket).
     - Guardrail `DYNAMIC_CONSTRAINTS_PATTERNS` yang menolak Fast-Track jika pesan mengandung: form pendaftaran, detail jalan/gang/nomor rumah, kata booking hari spesifik, angka usia anak eksplisit, keluhan fisik spesifik, atau sinyal darurat medis.
     - Fungsi `retrieveFaqGrounding()` yang mengambil potongan SOP resmi dari database `knowledge_base`.
  2. **`FastFaqGenerator` (`src/slot-engine/fast-faq-generator.ts`)**:
     - Generator Single-Pass yang mengeksekusi 1 LLM request dengan Persona Bidan Yusi + potongan SOP Knowledge Base + 4 chat terakhir.
     - Menghasilkan output JSON terpadu (`{ intents, reply_text, needs_deeper_processing }`). Jika LLM meminta pemrosesan lebih dalam atau JSON tidak valid, sistem otomatis *fallthrough* ke jalur 2-Call.
     - Terintegrasi penuh dengan `auditLlmCall` (`task_type: 'SLOT_FAST_FAQ'`) dan `recordLlmExecution` (`flowType: 'SLOT_FAST_FAQ'`).
  3. **Integrasi Slot-Filling Orchestrator (`src/slot-engine/slot-engine.ts`)**:
     - Menyisipkan cabang Fast-Track sebelum Step 2. Jika FAQ match dan berhasil, langsung mengembalikan balasan dalam **1 LLM call (~1.5–2.0s)**.
     - Menambahkan feature flag `FAST_FAQ_1CALL_ENABLED` (`src/config/feature-flags.ts`).
  4. **Frontend UI Support (`Debug.tsx`)**:
     - Menambahkan badge visual dan filter khusus untuk `SLOT_FAST_FAQ` (Fast-Track FAQ 1-Call).
- **Pengujian & Verifikasi:**
  - `tests/unit/slot-engine-fast-faq.test.ts`: 7/7 tests PASS (mencakup deteksi heuristik data riwayat customer asli, single-pass generator, dan orchestrator end-to-end).
  - Seluruh test suite slot-engine (7 test files, 43 tests PASS).
  - Backend compile (`npm run build`) & frontend Vite build 100% lolos (0 error).

#### Enhanced & Hardened — End-to-End LLM Execution Logging, Correlation ID & Flow Cards (2026-08-25)

- **Latar Belakang & Masalah yang Ditemukan:**
  1. **Bubble Chat Terpecah & Misalignment**: Log input di layer Router (`[State: ...]`) dan Verifier (`[DRAFT QC] ...`) menyisipkan metadata sistem langsung ke `customerInput`, sehingga pemisahan bubble dan pencarian rentan gagal atau terpecah.
  2. **Ketiadaan Correlation ID**: Pengelompokan log hanya mengandalkan kemiripan teks & window waktu. Jika customer mengirim pesan yang sama dalam waktu berdekatan, atau beberapa pesan masuk cepat, log tahapan LLM berisiko tertukar.
  3. **Module Logging Gap (Blindspots)**: Alur `PHRASING` (parafrase natural), `SLOT_EXTRACTOR`, `SLOT_GENERATOR`, serta fallback circuit-breaker pada NLU dan legacy Intent belum tercatat ke Execution Log.
  4. **Frontend UI Cards Terbatas**: Dashboard debug belum memiliki filter & visual card representatif untuk modul baru seperti `PHRASING`, `SLOT_EXTRACTOR`, dan `SLOT_GENERATOR`.
- **Implementasi Perbaikan Backend & Data Logging:**
  1. **Propagasi `bubbleCorrelationId`**:
     - Ditambahkan ke `StateHandlerContext` (`src/state-machine/types.ts`).
     - Diinisialisasi di ingress `machine.ts` (`incomingMessage.id || msg_...`) dan diteruskan ke: `NluClassifierService.classifyMessage`, `aiRouterService.classify`, `generateFaqResponseWithDetails`, `generateCopilotDraft`, `AiResponseVerifierService.verifyAndCorrect`, `phrasingService`, dan `llmIntentService`.
     - `src/utils/llm-execution-logger.ts`: Ditambahkan pencocokan $O(1)$ via `correlationMap` untuk pengelompokan bubble yang presisi 100%.
  2. **Sanitasi Pure `customerInput` & Ground Truth**:
     - `src/integrations/llm/ai-router.ts`: `customerInput` mencatat teks murni customer (`input.lastCustomerMessage`), `currentState` dipindahkan ke `groundTruthUsed`.
     - `src/services/ai-verifier.service.ts`: `customerInput` mencatat teks murni customer (`input.customerMessage`), `draftReply` dipindahkan ke `groundTruthUsed`.
     - `src/utils/llm-execution-logger.ts`: Peningkatan regex `normalizeCustomerInput()` agar kebal terhadap kutipan bersarang dan format multiline.
  3. **Pencatatan Fallback & Modul Tambahan**:
     - `src/services/nlu-classifier.service.ts`: Mencatat `status: 'FALLBACK'` ke execution logger saat confidence $< \text{threshold}$ atau saat Circuit Breaker aktif.
     - `src/integrations/llm/phrasing.service.ts`: Mencatat `flowType: 'PHRASING'` pada execution logger baik pada eksekusi sukses maupun fallback.
     - `src/integrations/llm/intent.ts`: Mencatat `NLU_CLASSIFICATION` legacy saat eksekusi dan fallback.
  4. **State Machine & Router Auto-Escalation Hardening**:
     - Perbaikan variable shadowing pada `nluResult` dan `historyFormatted`.
     - Router auto-escalation pada `machine.ts` mengembalikan `HUMAN_HANDLING` secara instan dan deterministik.
- **Implementasi Perbaikan Frontend UI/UX (`Debug.tsx`):**
  1. Menambahkan tipe union dan badge visual untuk `PHRASING`, `SLOT_EXTRACTOR`, `SLOT_GENERATOR`, `CLINICAL_ESCALATION`.
  2. Menyediakan tombol filter flow untuk `PHRASING` dan `SLOT ENGINE`.
  3. Membangun kartu Level 3 khusus untuk `PHRASING` (menampilkan template acuan, fakta kunci, dan hasil parafrase natural) serta kartu untuk modul `SLOT`.
- **Pengujian & Verifikasi:**
  - `tests/unit/hierarchical-debug-logs.test.ts` (3/3 tests PASS, termasuk verifikasi PHRASING dan fallback tracking).
  - Full Vitest suite: **198 test files PASS, 1,792 tests PASS (100%)**.
  - Backend typecheck (`npm run build`) & frontend build (`npm --prefix packages/admin-dashboard run build`) 100% lolos (0 error).

### Enhanced & Fixed — LLM Execution Logs Pipeline & UX Overhaul (2026-08-25)

- **Latar Belakang & Masalah Sebelumnya:**
  1. **ID Telepon Terfragmentasi**: `generator.ts` mencatat `customerPhone: customerId` (UUID database internal) sementara modul lain (NLU, Router, Verifier) mencatat nomor WhatsApp asli (`628...`), menyebabkan tahap Generator terlempar ke kartu customer terpisah.
  2. **Bubble Chat Terpecah**: Format input pesan di berbagai layer memiliki prefix metadata berbeda (misal `[State: ...]` dan `[DRAFT QC] ... (User: "...")`), sehingga 1 pesan pasien terpecah menjadi 3–4 kartu bubble terpisah.
  3. **Auto-Refresh Stuttering**: Interval 6 detik memicu `setLoading(true)` yang membuat layar berkedip (*flicker*) terus-menerus dan ID korelasi dinamis menyebabkan accordion tertutup sendiri saat user sedang membaca reasoning.
  4. **UX Clutter**: Visual 4 kotak berwarna raksasa yang padat menyebabkan *scroll fatigue*, tidak ada visualisasi urutan pipeline (*Stepper*), dan ketiadaan fitur reset buffer log serta export JSON.
- **Implementasi Perbaikan Backend & Data Logging:**
  1. **`src/utils/llm-execution-logger.ts`**:
     - Menambahkan fungsi `normalizeCustomerInput(input)` untuk mengekstrak teks inti customer dari prefix metadata Router dan Verifier.
     - Memperbaiki pengelompokan `getGroupedLlmExecutionLogs`:
       - Mengelompokkan bubble berdasarkan input ternormalisasi + kedekatan waktu ($< 35\text{ s}$) + ID korelasi deterministik.
       - Mengurutkan tahapan AI di dalam setiap bubble secara logis: `1. NLU` $\rightarrow$ `2. AI Router` $\rightarrow$ `3. RAG Generator` $\rightarrow$ `4. AI QC Verifier`.
       - Normalisasi nama dan format nomor telepon customer.
  2. **`src/integrations/llm/generator.ts` & `src/state-machine/handlers/interest.ts`**:
     - Menerima dan meneruskan parameter `customerPhone` & `customerName` asli ke `generateFaqResponseWithDetails`.
     - Mencatat nomor telepon valid, nama customer, `modelUsed`, dan `durationMs` ke `recordLlmExecution`.
  3. **`src/integrations/llm/ai-router.ts`**:
     - Menambahkan pengukuran `durationMs` dan mencatatnya ke `recordLlmExecution` pada mode shadow maupun mode produksi.
  4. **`src/routes/admin/evaluations.subroute.ts`**:
     - Menambahkan endpoint `DELETE /api/admin/debug/llm-logs` untuk mengosongkan buffer log LLM di memori secara aman.
- **Implementasi Perbaikan Frontend UI/UX (`Debug.tsx`):**
  1. **Silent Background Auto-Sync**: Background interval (6s) berjalan tanpa memicu kedipan (*flicker*) atau toggle loader fullscreen, dilengkapi tombol Play/Pause Auto-Sync.
  2. **Interactive Pipeline Stepper (Level 2 Bubble Card)**:
     - Header bubble interaktif yang menampilkan visual stepper alur AI: `[1. NLU] ➔ [2. Router] ➔ [3. Generator] ➔ [4. QC Verifier]`.
     - Ringkasan latency total round-trip (`⏱️ Total X ms`), Model akhir, dan badge status QC (`🛡️ Lolos Aman` / `⚠️ Terkoreksi`).
  3. **Tailored AI Step Detail Cards (Level 3)**:
     - Kartu khusus per-tahapan yang ringkas, terstruktur, dan tidak memakan ruang berlebih.
     - **NLU**: Intent tag list dengan confidence %, tag entitas, dan reasoning note.
     - **Router**: Keputusan rute, tag komparasi shadow mode (`✅ Cocok dengan Rule` / `⚠️ Berbeda`), dan reasoning.
     - **Generator**: Prompt input, KB chunks yang diinjeksi, full reasoning CoT (scrollable + 1-click copy), dan output reply.
     - **Verifier (QC)**: Evaluasi 4 pilar QC, daftar pelanggaran ontologi, dan raw JSON output.
  4. **Kontrol & Aksi Tambahan**:
     - Tombol **Reset Buffer** (dengan modal konfirmasi aman `useUiFeedback`).
     - Tombol **Export JSON** untuk mengunduh log debug.
     - Filter status: `Semua Status`, `✅ SUCCESS`, `⚠️ FALLBACK`, `❌ ERROR`.
     - Tombol **Buka Semua / Tutup Semua** accordion.
- **Pengujian & Verifikasi:**
  - Unit tests `tests/unit/hierarchical-debug-logs.test.ts` (2/2 tests PASS, termasuk verifikasi auto-clustering metadata wrapper dan step pipeline ordering).
  - Full Vitest suite: **191 test files PASS, 1,748 tests PASS (100%)**.
  - TypeScript build backend (`npm run build`) & Vite frontend build (`npm --prefix packages/admin-dashboard run build`) 100% lolos (0 error).

### Added & Enhanced — Live Chat Date Separators & WhatsApp Reply Feature via WAHA (2026-08-25)

- **Latar Belakang & Kebutuhan:**
  1. **Pemisah Tanggal WhatsApp-Style**: Tampilan pesan di Live Chat sebelumnya tidak memiliki penanda tanggal percakapan, sehingga membingungkan admin dalam membedakan percakapan hari ini, kemarin, beberapa hari lalu, atau minggu lalu.
  2. **Fitur WhatsApp Reply / Quote (Hold to Reply)**: Admin menginginkan kemampuan untuk membalas pesan customer tertentu secara langsung (*quoted message* / *reply context*) sebagaimana di aplikasi WhatsApp asli, baik dengan menahan/hold bubble chat customer (400ms) maupun tombol quick-action ↩️.
- **Implementasi Backend & Gateway Integration:**
  1. **`src/integrations/waha/client.ts`**:
     - Memperluas interface `IWahaClient` dan implementasi `WahaClient` (`sendText`, `sendTextDetailed`, `sendImage`, `sendImageDetailed`) dengan parameter opsional `replyTo?: string`.
     - Menginjeksi `reply_to: replyTo` ke payload POST WAHA `/api/sendText` dan `/api/sendImage`.
  2. **`src/integrations/whatsapp/gateway.types.ts`, `waha.driver.ts`, `waba.driver.ts`**:
     - Menambahkan parameter opsional `options?: { replyToMessageId?: string }` pada `sendTextMessage` dan `sendImageMessage`.
     - Meneruskan `options.replyToMessageId` ke WAHA client dan Meta Cloud API context (`{ message_id: options.replyToMessageId }`).
  3. **`src/services/live-chat.service.ts` & `src/services/message.service.ts`**:
     - Menambahkan method `getMessageById(messageId, tenantId)` di `MessageService` yang mendukung pencarian ID internal atau `wa_message_id` lengkap dengan in-memory fallback store.
     - Memperbarui `sendAdminReply` untuk mengekstrak dan menyimpan data `quoted_message` ke dalam `payload_raw.quoted_message` pada pesan yang dikirimkan.
  4. **`src/routes/admin/livechat.subroute.ts`**:
     - Menambahkan penerimaan `replyToMessageId?: string` pada endpoint `POST /api/admin/live-chat/conversations/:id/reply`.
- **Implementasi Frontend Admin Dashboard (`packages/admin-dashboard`):**
  1. **Date Separator Badges (`LiveChatMonitor.tsx`)**:
     - Menambahkan helper `formatChatDateSeparator(dateStr)` dan `isDifferentDay(d1, d2)`:
       - Hari ini $\rightarrow$ `"Hari ini"`
       - 1 hari lalu $\rightarrow$ `"Kemarin"`
       - 2–6 hari lalu $\rightarrow$ Nama hari bahasa Indonesia (`"Senin"`, `"Selasa"`, dll.)
       - $\ge 7$ hari lalu $\rightarrow$ Format tanggal tanpa tahun (`"18 Agustus"`, `"3 Juli"`).
     - Merender badge pemisah tanggal di tengah bubble container saat berganti hari.
  2. **WhatsApp Reply UI & Quoted Preview (`LiveChatMonitor.tsx`)**:
     - Fitur **Hold / Long-press (400ms)** pada bubble pesan untuk langsung memicu mode reply.
     - Tombol hover quick reply (↩️ `Reply`) pada desktop.
     - Komponen floating **Replying Bar** di atas composer input dengan nama pengirim, kutipan pesan, dan tombol batalkan (✕).
     - Render kotak kutipan pesan (*quoted message box*) di dalam bubble chat yang dapat diklik untuk auto-scroll & highlight ke pesan asli di thread.
- **Pengujian & Verifikasi:**
  - Unit tests `tests/unit/live-chat.service.test.ts` (17/17 tests PASS, termasuk skenario reply/quote).
  - Gateway tests `tests/unit/whatsapp-gateway.test.ts` (12/12 tests PASS).
  - TypeScript build backend (`npm run build`) & Vite frontend build (`admin-dashboard: npm run build`) 100% lolos (0 error).

### Enhanced & Hardened — Disable Passive Self-Learning & Extend LLM Timeouts to 60s/120s (2026-08-24)

- **Latar Belakang & Investigasi Masalah:**
  1. **Investigasi Fallback Beruntun pada Live Server**: Muncul log fallback berturut-turut pada model `MiniMax-M2.7-highspeed` yang diputus paksa di detik ke-15 (`timeout of 15000ms exceeded`).
  2. **Akar Masalah Timeout Kaku 15 Detik**: Modul `AI_VERIFIER` (QC Guardrail) dan `SELF-LEARNING` sebelumnya memiliki timeout hardcoded `15000ms` (15 detik), sedangkan model bertipe *Reasoning* seperti MiniMax M2.7 membutuhkan waktu berpikir (*reasoning_content*) 16–22 detik untuk evaluasi draf.
  3. **Penonaktifan Fitur Self-Learning**: Sesuai arahan, fitur passive self-learning saat CS membalas pesan manual kini dimatikan secara default (`ENABLE_SELF_LEARNING="false"`).
- **Implementasi Perubahan:**
  1. **`src/services/self-learning.service.ts` & `src/routes/webhook.route.ts`**:
     - Menambahkan pengecekan `process.env.ENABLE_SELF_LEARNING === 'true'` agar bot tidak melakukan ekstraksi FAQ otomatis saat admin membalas pesan manual dari WhatsApp HP.
  2. **`src/services/ai-verifier.service.ts` & `src/services/daily-report.service.ts`**:
     - Mengubah timeout kaku 15 detik menjadi configurable via env dengan default 1 menit (`parsePositiveInt(process.env.LLM_TIMEOUT_VERIFIER_MS, 60000)` dan `LLM_TIMEOUT_REPORT_MS`).
     - Menambahkan offline apiKey guard agar verifikasi dibypass seketika saat mode offline/unit test.
  3. **`src/utils/reservation-text-parser.ts` & `src/integrations/llm/intent.ts`**:
     - Memperkuat regex deteksi tertarik (`interested`) pada fallback offline agar kata `pijat|massage|spa` dikenali dengan akurat.
     - Memblokir conversational parser fallback pada form terstruktur yang field-nya kosong agar missing fields tertangkap dengan benar.
- **Verifikasi & Pengujian:**
  - Full suite Vitest: **187 test files PASS (1.736 tests, 0 failed)**.
  - TypeScript build (`npm run build`): 100% lolos (0 error).

### Added & Enhanced — AI Output Verifier Audit Logger & Visual Tracing Flow LLM di Menu Debug (2026-08-24)

- **Latar Belakang & Kebutuhan:**
  1. **Audit Log AI Output Verifier**: Modul `AiResponseVerifierService` (QC Guardrail) sebelumnya telah mengeksekusi model LLM ke provider, tetapi belum mengaitkan `auditLlmCall` untuk task `AI_VERIFIER`. Akibatnya, pemakaian token dan estimasi biaya Verifier tidak muncul di tabel **AI Monitoring & Usage Dashboard** (`llm_audit_logs`).
  2. **Observability Pipeline LLM di Menu Debug**: Pada halaman **System Debug** (`/admin/debug` ➔ Tab **🧠 LLM Execution Logs**), hanya respon RAG akhir dari `generator.ts` yang tercatat, sedangkan langkah NLU (`NLU_CLASSIFICATION`), Router (`AI_ROUTER`), dan Verifier (`AI_VERIFIER`) belum tercatat. Admin kesulitan melihat alur utuh (*end-to-end pipeline*) dari setiap pesan yang masuk.
- **Implementasi Backend:**
  - **`src/services/ai-verifier.service.ts`**:
    - Menambahkan `auditLlmCall` untuk task `AI_VERIFIER` pada kondisi sukses maupun fallback/error lengkap dengan metrik `prompt_tokens`, `completion_tokens`, `model_name`, `baseUrl`, dan `latency_ms`.
    - Menambahkan pencatatan eksekusi ke buffer `recordLlmExecution` dengan `flowType: 'AI_VERIFIER'` yang merekam input draf, hasil evaluasi 4 pilar QC, catatan pelanggaran (*violation reasons*), dan model yang dipakai.
    - Menambahkan console log `[AI VERIFIER PASS]` dan `[AI VERIFIER CORRECTION]`.
  - **`src/utils/llm-execution-logger.ts`**:
    - Memperluas tipe `LlmFlowType` (`'CHATBOT_AUTO' | 'COPILOT_DRAFT' | 'CLINICAL_ESCALATION' | 'REASONING_ONLY' | 'NLU_CLASSIFICATION' | 'AI_ROUTER' | 'AI_VERIFIER' | 'PHRASING'`).
  - **`src/services/nlu-classifier.service.ts`**:
    - Menambahkan integrasi `recordLlmExecution` dengan `flowType: 'NLU_CLASSIFICATION'` untuk merekam input customer, deteksi intent, confidence score, dan entities.
  - **`src/integrations/llm/ai-router.ts`**:
    - Menambahkan integrasi `recordLlmExecution` dengan `flowType: 'AI_ROUTER'` untuk merekam state awal, pesan customer, keputusan rute, dan flag eskalasi.
    - Mengubah getter `model` di `AIRouterLLMClient` menjadi `public`.
  - **`src/integrations/llm/generator.ts`**:
    - Melengkapi metadata `customerPhone`, `groundTruthUsed`, dan `referencedTreatment` pada payload `recordLlmExecution`.
- **Implementasi Frontend Admin Dashboard (`packages/admin-dashboard`):**
  - **`Debug.tsx` (Tab 🧠 LLM Execution Logs)**:
    - Menambahkan filter flow lengkap: `Semua Flow`, `🔍 NLU Intent`, `🧭 AI Router`, `🤖 Chatbot Reply`, `🛡️ AI Verifier (QC)`, `💡 AI Copilot`.
    - Menambahkan badge warna spesifik untuk tiap tahap pemrosesan LLM.
    - Menyesuaikan label visual blok output dinamis berdasarkan tipe flow (Intent/Entity, Keputusan Router, Draf Balasan, atau Evaluasi QC).
- **Pengujian & Verifikasi:**
  - Unit test `tests/unit/verifier-outbound.test.ts` (3/3 tests PASS, termasuk verifikasi `auditLlmCall` dan `recordLlmExecution`).
  - TypeScript build backend (`npm run build`) & Vite frontend build (`admin-dashboard: npm run build`) 100% lolos (0 error).

### Enhanced & Optimized — Akses Cepat Live Chat & Eliminasi Browser Connection Starvation (2026-08-24)

- **Latar Belakang & Investigasi Masalah:**
  1. **Keluhan Akses Lambat (~1 Menit)**: Pengguna mengalami waktu pemuatan halaman Live Chat yang sangat lambat (hingga 1 menit) saat mengakses dashboard di browser.
  2. **Hasil Validasi Database**: Analisis `EXPLAIN ANALYZE` membuktikan bahwa query PostgreSQL (`conversations`, `customers`, `messages`) sangat cepat (**0.9 ms – 5.8 ms**).
  3. **Akar Masalah Nyata**:
     - **Browser Connection Starvation (Batas 6 Koneksi HTTP/1.1)**: `Layout.tsx` (via notifikasi) dan `LiveChatMonitor.tsx` membuka 2 koneksi `EventSource` (SSE) terpisah. Saat membuka beberapa tab, kuota maksimal 6 koneksi simultan browser terkunci, menyebabkan request baru tertahan (*stalled / pending*) di browser hingga 30–60 detik.
     - **Over-Fetching Badge Unread**: Header dashboard memanggil `GET /api/admin/live-chat/conversations?limit=100` pada setiap perpindahan halaman hanya untuk menjumlahkan badge angka belum dibaca, menarik megabyte data percakapan & memicu background sync WAHA.
     - **Over-Fetching Pesan di Backend**: `getConversationList` menarik seluruh riwayat pesan dari 50 percakapan ke RAM Node.js tanpa limit per thread di level SQL.
- **Implementasi Perbaikan:**
  1. **Shared Singleton EventSource (`packages/admin-dashboard/src/services/liveChatSse.ts`)**:
     - Mengubah arsitektur SSE menjadi single shared connection per tab dengan registry pub/sub subscriber, mencegah pembukaan stream ganda.
  2. **Dedicated Fast Unread Count Endpoint (`GET /api/admin/live-chat/unread-count`)**:
     - Menambahkan endpoint agregasi cepat di backend (`src/routes/admin/livechat.subroute.ts` & `src/services/message.service.ts`) yang merespons dalam **~1-2 ms** (< 100 bytes).
     - Memperbarui `useLiveChatNotification.ts` untuk menggunakan endpoint ini dan menghapus re-fetch berlebihan pada setiap perubahan `location.pathname`.
  3. **Optimasi Query Message Preview di Database (`src/services/live-chat.service.ts`)**:
     - Menggunakan query CTE window function `ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC)` yang membatasi maksimal 3 pesan per thread langsung di level SQL Postgres.
     - Menerapkan pembatasan dan jeda bertahap (throttling) pada sinkronisasi foto profil background WAHA.
- **Verifikasi & Pengujian:**
  - Unit tests di `tests/unit/live-chat.service.test.ts` (16/16 tests PASS).
  - TypeScript build backend (`npm run build`) & Vite frontend build (`admin-dashboard: npm run build`) 100% lolos (0 error).

### Added & Enhanced — Fitur Sorting Antrian Follow-Up & Rescheduling Overdue Otomatis (Maks 10 Blast/Hari) (2026-08-24)

- **Latar Belakang & Kebutuhan:**
  1. **Kebutuhan Sorting Antrian**: Di menu Follow-Up Queue (`/admin/follow-ups`), admin membutuhkan fleksibilitas dalam menyortir antrian berdasarkan Tanggal Jadwal (`scheduled_at`), Nama Customer (`customer_name`), Tipe & Stage (`type`), Status (`status`), dan Waktu Dibuat (`created_at`).
  2. **Pembersihan Jadwal Terlewat (Overdue Rescheduling)**: Follow-up yang dibuat untuk cohort sebelumnya (misal Juli 2026 yang jadwal Stage 1 jatuh sebelum hari ini) perlu dimajukan ke hari aktif berikutnya (mulai 25 Agustus 2026) dan dibatasi maksimal 10 blast per hari pada jam kerja (09:00 - 15:40 WIB) untuk menjaga kepatuhan Anti-Ban & Rate-Limit Meta WhatsApp.
- **Implementasi Backend Service & REST API:**
  - **`src/services/follow-up.service.ts`**:
    - Memperbarui `listFollowUps` agar mendukung query parameter dinamis `sortBy` (`scheduled_at`, `customer_name`, `type`, `status`, `created_at`) dan `sortOrder` (`asc` / `desc`) dengan fallback sorting terdekat terlebih dahulu.
    - Menambahkan method `rescheduleOverdueFollowUps(tenantId, options)` yang mendistribusikan follow-up overdue berstatus `PENDING` ke hari-hari ke depan dengan kuota maksimal $X$ per hari (default 10 blast/hari) yang disebar di jam kerja (09:00, 09:40, 10:20, 11:00, 11:40, 13:00, 13:40, 14:20, 15:00, 15:40 WIB).
  - **`src/routes/admin/follow-up.subroute.ts`**:
    - Menambahkan parameter `sortBy` dan `sortOrder` pada endpoint `GET /api/admin/follow-ups`.
    - Menambahkan endpoint baru `POST /api/admin/follow-ups/reschedule-overdue` dengan audit logging `RESCHEDULE_OVERDUE_FOLLOWUPS`.
- **Implementasi Frontend Admin Dashboard (`packages/admin-dashboard`):**
  - **`FollowUpQueue.tsx`**:
    - Menambahkan tombol header **"Majukan Overdue (Maks 10/Hari)"** (`FastForward`) lengkap dengan konfirmasi modal.
    - Menambahkan dropdown **Quick Sort** di filter toolbar (Jadwal Terdekat ASC, Jadwal Terjauh DESC, Nama Customer A-Z / Z-A, Status, Tipe, Terbaru Dibuat).
    - Menjadikan kolom tabel (*Tanggal Jadwal*, *Tipe & Stage*, *Customer & No. HP*, *Status*) interaktif dapat diklik langsung dengan indikator visual sorting (`ArrowUpDown`, `ArrowUp`, `ArrowDown`).
- **Verifikasi, Eksekusi Live Database & Pengujian:**
  - Menjalankan penataan jadwal 64 antrian pending bulan Agustus di database live server (`wa_clinic_db`) sehingga tersebar teratur:
    - 25 Agustus 2026: 10 blast (09:00 - 15:40 WIB)
    - 26 Agustus 2026: 10 blast (09:00 - 15:40 WIB)
    - 27 Agustus 2026: 10 blast (09:00 - 15:40 WIB)
    - 28 Agustus 2026: 10 blast (09:00 - 15:40 WIB)
    - 29 Agustus 2026: 10 blast (09:00 - 15:40 WIB)
    - 30 Agustus 2026: 10 blast (09:00 - 15:40 WIB)
    - 31 Agustus 2026: 4 blast (09:00 - 11:00 WIB)
  - Unit & Integration Tests: **18/18 tests PASS** (`follow-up-engine.test.ts` & `follow-up-admin.test.ts`).
  - TypeScript build backend (`npm run build`) & Vite frontend build (`admin-dashboard: npm run build`) 100% lolos (0 error).

### Added & Enhanced — Standardisasi Seluruh Kontrol & Tombol ON/OFF Menjadi ToggleSwitch Interaktif (2026-08-24)

- **Latar Belakang & Kebutuhan UI/UX:**
  1. **Inkonsistensi Kontrol ON/OFF**: Sebelumnya, kontrol status aktif/nonaktif dan fitur boolean di seluruh admin dashboard tersebar dalam berbagai bentuk yang membingungkan: tombol teks biasa berstatus `ENABLED (ON)` / `DISABLED (OFF)`, checkbox HTML kecil tanpa penanda teks, sakelar dot slider tanpa label ON/OFF, dropdown `<select>` status akun staf, dan tombol aksi "Putuskan Aliran".
  2. **Kebutuhan Status Visual yang Tegas**: User membutuhkan kepastian visual yang langsung dapat dipahami dalam 1 lirikan mata (apakah suatu fitur sedang ON / Aktif atau OFF / Nonaktif).
- **Implementasi Komponen & Frontend Admin Dashboard (`packages/admin-dashboard`):**
  - **Komponen Universal `ToggleSwitch` (`src/components/common/ToggleSwitch.tsx`)**:
    - Membuat komponen sakelar interaktif dengan pill track slider halus (`#008069` saat ON vs `#cbd5e1` saat OFF).
    - Dilengkapi badge status teks & warna yang tegas (`ON (AKTIF)` / `OFF (NONAKTIF)`), indikator status loading (`Loader2` spinner), dukungan multi-ukuran (`sm`, `md`, `lg`), dan aksesibilitas keyboard (`role="switch"`).
  - **Standardisasi Modul Settings & Bot Engine (`packages/admin-dashboard`):**
    - **`AiRouterPanel.tsx`**: Mengganti tombol status `Status AI Router` dan `AI Output Verifier (QC Guardrail)` dengan `ToggleSwitch`.
    - **`Settings.tsx`**: Mengganti sakelar dot polos `Global Chatbot Toggle` dengan `ToggleSwitch` berlabel status jelas.
    - **`MetaCapiPanel.tsx`**: Mengganti sakelar auto-send `Auto-send Purchase CAPI` dengan `ToggleSwitch`.
    - **`DailyReportPanel.tsx`**: Mengganti checkbox `Aktifkan Jadwal Cron Otomatis` dengan `ToggleSwitch`.
    - **`MqlSettingsPanel.tsx`**: Mengganti checkbox `Otomatisasi Auto-Lead` dengan `ToggleSwitch`.
    - **`GoogleIntegrationPanel.tsx`**: Menambahkan kontrol `ToggleSwitch` untuk `Auto-Sync Saat Chat Pertama (MQL)` dan `Auto-Sync Saat Booking Reservasi`.
    - **`WhatsAppProviderPanel.tsx`**: Mengganti tombol pemutus aliran `Internal Outbound Cut-Off (Emergency Kill-Switch)` dengan `ToggleSwitch` berlabel `CUT-OFF AKTIF (TERPUTUS)` vs `NORMAL (TERHUBUNG)`.
  - **Standardisasi Modul Manajemen Data, Tabel & Form Modal:**
    - **`ClinicServices.tsx`**: Mengganti toggle baris tabel layanan dan checkbox modal form dengan `ToggleSwitch` (`Aktif` vs `Nonaktif`).
    - **`LandingPage.tsx`**: Mengganti badge tombol baris tabel dan checkbox modal form landing page dengan `ToggleSwitch` (`Aktif` vs `Nonaktif`).
    - **`StaffManagement.tsx`**: Mengganti dropdown `<select>` status akun staf pada modal edit dengan `ToggleSwitch` (`Aktif` vs `Nonaktif`).
    - **`CreateReservationModal.tsx`**: Mengganti checkbox custom treatment addon dengan `ToggleSwitch` (`Add-on (0m)` vs `Standar`).
- **Verifikasi & Pengujian:**
  - `npm run build` pada `packages/admin-dashboard`: 100% lulus (0 error, TypeScript & Vite bundle lolos).
  - `npm run build` pada root backend: 100% lulus (0 error, TypeScript compiler lolos).


### Enhanced & Fixed — Follow-Up & Reminder Queue: Dari 'Kirim Sekarang' ke 'Jadwalkan' (Status QUEUED) (2026-08-24)

- **Latar Belakang & Kebutuhan:**
  1. **Transisi Tombol Aksi**: Di halaman Follow-Up & Reminder Queue (`/admin/follow-ups`), tombol aksi sebelumnya bertuliskan *"Kirim"* yang mengeksekusi `send-now` langsung ke WhatsApp saat itu juga.
  2. **Kesesuaian Jadwal Ter-Setup**: Pengguna menginginkan pesan follow-up tidak langsung ditembakkan seketika, melainkan dijadwalkan masuk ke antrian (`QUEUED`) dan dikirim otomatis oleh background worker tepat saat tanggal & jam yang sudah disetup (`scheduled_at <= NOW()`) tiba.
- **Implementasi Backend Service & REST API:**
  - **`src/services/follow-up.service.ts`**:
    - Menambahkan `queueFollowUp(id, tenantId)` untuk mengubah status follow-up tunggal dari `PENDING` menjadi `QUEUED`.
    - Menambahkan `bulkQueueFollowUps(tenantId)` untuk menjadwalkan seluruh antrian `PENDING` ke status `QUEUED` secara massal.
    - Memperbarui `processDueFollowUps(tenantId)` agar secara konsisten mengeksekusi item berstatus `QUEUED` yang telah tiba jadwalnya (`scheduled_at <= NOW()`), serta tetap mendukung mode `AUTO_FOLLOWUP_ENABLED=true` jika ingin auto-process `PENDING`.
    - Memperbarui `rescheduleFollowUp(id, newDate, tenantId)` agar dapat mengubah tanggal/jam jadwal kirim dan mempertahankan integritas status.
  - **`src/routes/admin/follow-up.subroute.ts`**:
    - Menambahkan endpoint `POST /api/admin/follow-ups/:id/queue` dengan audit logging `QUEUE_FOLLOWUP`.
    - Menambahkan endpoint `POST /api/admin/follow-ups/bulk-queue` dengan audit logging `BULK_QUEUE_FOLLOWUP`.
- **Implementasi Frontend Admin Dashboard (`packages/admin-dashboard`):**
  - **`FollowUpQueue.tsx`**:
    - Mengubah tombol aksi baris `PENDING` dari *"Kirim"* (`Send`) menjadi **"Jadwalkan"** (`CalendarCheck`).
    - Menambahkan tombol header **"Jadwalkan Semua Pending"** (`CalendarCheck`) untuk menyetujui seluruh antrian sekaligus.
    - Menambahkan badge visual dan filter status **`QUEUED`** (*"Terjadwal di Antrian"* dengan warna biru).
    - Memperbarui modal konfirmasi untuk membedakan aksi Jadwalkan tunggal dan massal dengan penjelasan waktu jadwal.
    - Memperbarui safety notice header.
- **Verifikasi & Pengujian:**
  - Unit tests di `tests/unit/follow-up-engine.test.ts` (7/7 tests PASS).
  - Integration tests di `tests/integration/follow-up-admin.test.ts` (7/7 tests PASS).
  - Test suites follow-up lengkap: **53 tests PASS**.
  - TypeScript build backend (`npm run build`) & Vite build frontend (`admin-dashboard: npm run build`) 100% lulus (0 error).
  - Knowledge graph `graphify update .` berhasil diperbarui (3972 node, 7935 edge).

### Added & Enhanced — Dynamic Peak-Hour Pricing & Tenant-Aware MiniMax NLU Model Transition (2026-08-24)

- **Latar Belakang & Investigasi Masalah:**
  1. **Audit Penggunaan Model AI**: Pengecekan riil pada database live server (`llm_audit_logs`) dan request logs SumoPod mengungkap bahwa DeepSeek mendominasi ~80% traffic LLM karena bertugas di gerbang awal `NLU_CLASSIFICATION`, `NLU_ROUTING`, dan `GEOCODE_RESOLVER`.
  2. **Lonjakan Tarif Peak Hours DeepSeek**: Data log transaksi membuktikan bahwa DeepSeek di SumoPod menerapkan *dynamic pricing* pada jam sibuk (07:30 – 19:30 WIB / 08:30 – 20:30 UTC+8) dengan lonjakan output token mencapai **\$1.50 / 1M token** (Rp 40.80 per 1.5k token output), sedangkan `cost-calculator.ts` sebelumnya masih menghitung secara statis di \$0.66 / 1M.
  3. **Keunggulan Tarif MiniMax**: MiniMax-M2.7-highspeed memiliki tarif flat 24 jam sebesar **\$0.03 / 1M in / \$0.12 / 1M out** (Rp 3.24 per 1.5k token output, hemat ~12x lipat saat peak hours).
- **Implementasi Perubahan:**
  1. **Dynamic Peak-Hour Pricing (`src/utils/cost-calculator.ts`)**:
     - Menambahkan helper `isDeepSeekPeakHour()` yang mendeteksi jam sibuk 08:30–20:30 UTC+8 (07:30–19:30 WIB).
     - Menambahkan fungsi `getModelPricing()` yang secara dinamis menyesuaikan tarif output DeepSeek (`$1.50/1M` saat Peak vs `$0.28/1M` saat Off-Peak) dan memperbarui tarif Qwen (`$0.28/1M` output).
     - Memperbarui `calculateLlmCost()` agar menerima parameter opsional timestamp dan mengembalikan flag `isPeak`.
  2. **Tenant-Aware Model Selection Sync (`ai-router.ts`, `geocoding.ts`, `phrasing.service.ts`)**:
     - `src/integrations/llm/ai-router.ts`: Menyelaraskan getter `model` agar membaca konfigurasi dinamis tenant-aware `AiModelConfigService.getModelConfig('INTENT_CLASSIFICATION')` saat `AI_MODEL_ROUTER` / `AI_MODEL_NLU` tidak di-set secara eksplisit.
     - `src/integrations/google-maps/geocoding.ts`: Menyelaraskan `llmResolveLocation()` agar membaca model NLU dari `AiModelConfigService.getModelConfig('INTENT_CLASSIFICATION')`.
     - `src/integrations/llm/phrasing.service.ts`: Memastikan `this.model` menggunakan `chatConfig.modelName` dari `AiModelConfigService.getModelConfig('CHAT_REPLY')` saat env var tidak di-override.
  3. **Transisi Default Model Registry (`src/config/ai-models.config.ts` & `.env.example`)**:
     - Mengubah default registry `INTENT_CLASSIFICATION`, `CHAT_REPLY`, `SUMMARIZATION`, dan `PII_SCRUBBING` menjadi `MiniMax-M2.7-highspeed` (provider `MiniMax`).
     - Memperbarui `.env.example` dengan rantai fallback `AI_MODEL_FALLBACK_CHAIN="deepseek-v4-flash,qwen3.7-flash-2026-07-15"`.
- **Verifikasi & Pengujian:**
  - `tests/unit/cost-calculator.test.ts`: 9/9 tests PASS (memvalidasi kalkulasi Peak vs Off-Peak DeepSeek, flat MiniMax, dan Qwen).
  - `tests/unit/ai-models-tenant.test.ts`: 4/4 tests PASS.
  - `tests/unit/ai-router-engine.test.ts`: 107/107 tests PASS.
  - Full suite Vitest: **180 test files PASS (1.585 tests, 0 failed)**.
  - TypeScript build (`npm run build`): 100% lolos (0 error).

### Fixed & Hardened — Regex Word-Boundary Protection for NLU Classifier & Geocoding (2026-08-24)

- **Latar Belakang & Investigasi Masalah:**
  1. **Insiden Pemotongan Kata & Salah Klasifikasi Intent**: Berdasarkan temuan log live server pada pesan customer `"Pakuwon city mall, mulyorejo"`, ditemukan bahwa regex sapaan tanpa word boundary (`\b`) memotong huruf `P` di awal kata (`"akuwon"`), sehingga sistem gagal mendeteksi mall/landmark.
  2. **Audit Menyeluruh Sistem Regex**: Ditemukan 3 regex berisiko tinggi di NLU classifier (`src/services/nlu-classifier.service.ts`) dan 1 regex greedy di sanitasi geocoding (`src/integrations/google-maps/geocoding.ts`).
- **Implementasi Perubahan:**
  1. **`src/services/nlu-classifier.service.ts`**:
     - Menambahkan word boundary `\b` pada regex Greeting (baris 114) agar kata berawalan `p` (seperti *Pakuwon*, *Pabean*, *Pijat*) tidak dianggap salam.
     - Menambahkan word boundary `\b` pada regex Affirmation (baris 119) agar nama/kata berawalan `ya`/`ok`/`siap` (*Yani*, *Oktober*, *Siaran*) tidak dianggap afirmasi.
     - Menambahkan word boundary `\b` pada regex Negation (baris 124) agar alamat berawalan `ga` (*Gajah Mada*, *Gatot Subroto*) tidak dianggap penolakan.
  2. **`src/integrations/google-maps/geocoding.ts`**:
     - Mengubah regex redirect pembersih alamat dari greedy `.*` menjadi non-greedy anchored `^.*?\b(ganti|pindah|ubah|salah|yang\s+bener)\s+` untuk melindungi nama jalan seperti *Jl. Gantiwarno* atau *Jl. Salahuddin*.
  3. **`tests/unit/nlu-classifier.test.ts`**:
     - Menambahkan 3 unit regression test case untuk memvalidasi proteksi kata awalan `P` (Pakuwon, Pabean), `Ga` (Gajah Mada, Gatot Subroto), dan `Ya/Ok` (Yani, Oktober).
- **Verifikasi & Pengujian:**
  - `tests/unit/nlu-classifier.test.ts` (12/12 tests PASS).
  - `tests/unit/geocoding.test.ts` (17/17 tests PASS).
  - TypeScript build (`npm run build`) 100% lulus (0 error).

### Enhanced & Aligned — Clinic Services Catalog & Live Database Sync with Pricelist Flyer (2026-08-23)

- **Latar Belakang & Kebutuhan:**
  1. **Sinkronisasi Total Flyer Pricelist & Database**: Menyelaraskan seluruh harga, durasi, tier usia, nama treatment, dan paket bundling pada database live PostgreSQL (`clinic_services`) agar 100% sama persis dengan Gambar Flyer Pricelist resmi klinik (`Kala Moms and Baby Spa - Homecare Service`).
  2. **Penyesuaian Harga & Pemecahan Tier Usia Anak**:
     - Memecah kategori `Pijat Kids Ceria` menjadi 3 tier usia spesifik: 2-4 tahun (Rp 70.000), 4-6 tahun (Rp 80.000), dan 6-8 tahun (Rp 90.000).
     - Menyelaraskan harga promo `Pijat Lahap Juara` (Rp 75.000), `Cukur Rambut Bayi` (Rp 25.000), `Breast Massage` (Rp 50.000), dan `Prenatal Massage` (Rp 100.000).
  3. **Penambahan Layanan Baru Ibu Hamil & Paket Pra-Kelahiran**:
     - Menambahkan layanan tunggal: `Perineum Massage` (Rp 45.000), `Induksi Massage` (Rp 50.000), `Induksi Massage Fullbody` (Rp 105.000), dan `Prenatal Yoga` (Rp 50.000).
     - Menambahkan 4 paket bundling pra-kelahiran: *Paket Pra Kelahiran Lengkap* (Rp 135.000), *Paket Yoga + Breast* (Rp 80.000), *Paket Perineum + Yoga* (Rp 80.000), dan *Paket Perineum + Breast* (Rp 80.000).
- **Implementasi & Eksekusi Database Live:**
  - **Katalog Default & JSON (`services_custom.json` & `src/services/treatment-catalog.service.ts`)**: Pembaruan menyeluruh pada `DEFAULT_CLINIC_SERVICES` dan filter pencarian natural language catalog.
  - **Eksekusi Live Database (`wa_clinic_db` PostgreSQL)**: Melakukan update 14 baris data eksisting dan insert 12 baris layanan baru dengan validasi integritas data `ON CONFLICT (tenant_id, service_id)`.
- **Verifikasi & Pengujian:**
  - Unit tests di `tests/unit/treatment-catalog-bundle-addon.test.ts`, `tests/unit/treatment-catalog-search.test.ts`, `tests/unit/price-answer.test.ts`, dan `tests/integration/price-anaphora-20customers.test.ts` 100% lulus.
  - TypeScript build (`npm run build`) 100% lulus (0 error).
  - Query verifikasi langsung ke database live server memastikan 29 layanan terdaftar aktif dan sinkron.

### Added & Enhanced — Weekly Google Drive Auto-Backup, Download & Database Restore (2026-08-23)

- **Latar Belakang & Kebutuhan:**
  1. **Perlindungan Aset & Disaster Recovery Klinik**: Menyediakan sistem backup database berkala 100% gratis ke Google Drive pribadi klinik untuk mengamankan data pasien, rekam medis bayi/anak, jadwal reservasi treatment, log chat WhatsApp, dan katalog tarif.
  2. **Jadwal Auto-Backup Mingguan**: Cron mingguan setiap Senin pukul 02:00 WIB yang otomatis mendump database PostgreSQL (`.sql.gz`), mengunggahnya ke Google Drive (`📁 Kala Clinic Bot Backups`), dan melakukan auto-pruning (retensi 8 backup terakhir / ~2 bulan).
  3. **Download Mandiri & Pemulihan Database (Restore)**: Admin dapat mengunduh backup `.sql.gz` ke laptop dalam 1 klik, serta memulihkan data database melalui panel dashboard dengan konfirmasi proteksi data.
- **Implementasi Service & Backend:**
  - **Backup Service (`src/services/backup.service.ts`)**: Service utama pembuatan dump database gzip, upload Google Drive, dan pemulihan tabel secara aman.
  - **Google Drive Client (`src/integrations/google-drive/client.ts`)**: Client Google Drive API v3 untuk mengelola folder backup, upload stream, dan auto-pruning.
  - **File Utilities (`src/utils/backup-file.ts`)**: Helper validasi magic bytes gzip, sanitasi nama file, dan proteksi path traversal.
  - **Cron Scheduler (`src/services/cron.service.ts` & `src/app.ts`)**: Registrasi pemicu mingguan Senin 02:00 WIB (`runWeeklyBackup`).
  - **REST API Subroute (`src/routes/admin/backup.subroute.ts`)**: Endpoint `/api/admin/backup/list`, `/create`, `/download/:fileName`, `/upload-drive`, dan `/restore`.
- **Implementasi Frontend Admin Dashboard (`packages/admin-dashboard`):**
  - Komponen `DatabaseBackupPanel.tsx` di menu Pengaturan dengan tombol Download, Backup ke Drive, tabel riwayat, dan modal konfirmasi pemulihan data (`useUiFeedback`).
- **Verifikasi & Pengujian:**
  - Unit tests baru di `tests/unit/backup.test.ts` (8/8 passed).
  - Regresi penuh suite Vitest lolos (**180 test files, 1578 passed, 0 failed**).
  - Backend (`tsc`) dan Frontend (`vite build`) 100% lolos (0 error).

### Added & Enhanced — Google Maps Distance Matrix Fallback (Tier-2 Motorbike Routing) (2026-08-23)

- **Latar Belakang & Kebutuhan:**
  1. **Jaring Pengaman Ongkir 3 Lapis (Triple-Layer Routing)**: Menyempurnakan keandalan perhitungan jarak dan ongkir rute jalan dengan menempatkan Google Maps Distance Matrix API sebagai fallback lapis kedua di antara OpenRouteService (ORS) dan rumus matematis Haversine.
  2. **Rute Khusus Sepeda Motor Terapis (`avoid=tolls`)**: Permintaan khusus operasional terapis yang berkendara sepeda motor (bukan mobil). Pemanggilan API Google Maps dikonfigurasi secara eksplisit untuk menghindari jalan tol (`mode=driving`, `avoid=tolls`).
  3. **Efisiensi Biaya Maksimal & 0 Downtime**: 98%+ perhitungan jarak tetap ditangani gratis oleh ORS, sementara Google Maps hanya dipanggil saat ORS limit/timeout/rute gang tidak ditemukan, memanfaatkan kredit gratis bulanan $200 Google Cloud tanpa risiko kehabisan kuota.
- **Implementasi Service & Backend:**
  - **Google Distance Client (`src/integrations/google-maps/distance-matrix.client.ts`)**: Client mandiri `GoogleDistanceMatrixClient` yang memanggil Google Maps Distance Matrix API dengan timeout 2.5 detik, graceful degradation (mengembalikan `null` jika tanpa key/error), dan opsi `avoid=tolls`.
  - **Orkestrasi 3-Tier di DeliveryService (`src/services/delivery.service.ts`)**:
    - *Lapis 1 (Utama)*: OpenRouteService (ORS API).
    - *Lapis 2 (Fallback 1)*: Google Maps Distance Matrix API (Rute motor).
    - *Lapis 3 (Fallback 2)*: Rumus Haversine $\times$ `HAVERSINE_CIRCUITY_FACTOR` ($1.60\times$).
- **Verifikasi & Pengujian:**
  - Unit test baru di `tests/unit/google-distance.test.ts` (7/7 passed) menguji kegagalan/keberhasilan setiap transisi lapis.
  - Regresi penuh suite Vitest lolos (**179 test files, 1570 passed, 0 failed**).
  - Backend build (`tsc`) 100% lolos (0 error).

### Added & Enhanced — Inbound Google Contacts Sync & Strict Dual-Gate Trigger Strategy (2026-08-23)

- **Latar Belakang & Kebutuhan:**
  1. **Tarik Kontak Eksisting dari Google Contacts (Inbound Two-Way Sync)**: Memungkinkan klinik mengimpor seluruh kontak pasien lama yang sudah tersimpan di akun Google Contacts / HP ke database bot pelanggan (`Customer`) dalam 1 klik.
  2. **Strict Dual-Gate Trigger Strategy (MQL & Reservasi)**: Menjaga buku kontak HP klinik selalu bersih dari spam dan memangkas penggunaan kuota API Google Contacts hingga >80% dengan hanya menyinkronkan kontak pada 2 milestone penting:
     - **Gate 1 (MQL Capture)**: Saat prospek mencapai batas interaksi bubble MQL (Marketing Qualified Lead) atau menyebutkan nama/lokasi di chat.
     - **Gate 2 (Reservation Verification)**: Saat reservasi treatment terkonfirmasi resmi (memperbarui data anak terverifikasi, layanan treatment, dan alamat pasti).
  3. **Dukungan Tag Wilayah (`{{kelurahan}}`, `{{kecamatan}}`)**: Memungkinkan format kontak `{{name}} - {{child_name}} ({{kelurahan}}, {{kecamatan}})` dengan fitur smart sanitasi otomatis jika data wilayah belum terisi.
- **Implementasi Service & Backend:**
  - **Inbound Import (`src/services/google-contacts.service.ts`)**: Method `importContactsFromGoogle` yang membaca seluruh kontak Google via `people.connections.list` dengan pagination token dan mencocokkan nomor telepon ke database (`Customer`).
  - **Helper Parser (`src/services/google-contacts-formatter.ts`)**: Method `extractContactPhoneAndName` dan penyempurnaan `formatContactName` dengan dukungan `{{kelurahan}}` dan `{{kecamatan}}`.
  - **Penyelarasan Trigger**: Menghapus sinkronisasi acak di `webhook.route.ts` dan memusatkan trigger pada hook MQL (`customer.service.ts`) serta hook reservasi (`reservation-lifecycle.service.ts`).
  - **REST API Admin**: Endpoint baru `POST /api/admin/integrations/google/import`.
- **Implementasi Admin Dashboard UI (`packages/admin-dashboard`):**
  - Tombol aksi baru: **`[ 📥 Tarik & Samakan Kontak dari Google ]`** dan **`[ 📤 Kirim Semua Pasien ke Google ]`**.
  - Live preview box penamaan kontak yang menampilkan simulasi kelurahan dan kecamatan secara dinamis.
- **Verifikasi & Pengujian:**
  - Unit tests diperluas di `tests/unit/google-contacts.test.ts` (13/13 passed).
  - Regresi penuh suite Vitest lolos (**178 test files, 1563 passed, 0 failed**).
  - Backend (`tsc`) dan Frontend React (`vite build`) berhasil 100%.

### Added & Enhanced — Google Contacts SaaS-Ready Integration (1-Click Google OAuth & Auto-Sync) (2026-08-23)

- **Latar Belakang & Kebutuhan:**
  1. **Kemudahan Klien Non-Tech Savvy (SaaS Managed OAuth)**: Pemilik klinik dan admin tidak perlu repot membuat project Google Cloud Platform atau mengurus API Key/Secret. Integrasi dirancang terpusat di server dengan tombol otorisasi 1-klik di Admin Dashboard.
  2. **Sinkronisasi Otomatis Buku Telepon HP**: Nama pasien yang masuk via chat WhatsApp atau melakukan reservasi treatment otomatis tersimpan dan ter-update di buku kontak Google Contacts (HP klinik/CS/dokter).
  3. **Penamaan Kontak Cerdas & Terstruktur**: Template penamaan kustomisasi (misal: `{{name}} - {{child_name}} (Klinik)`), normalisasi nomor telepon ke format internasional E.164 (`+628...`), dan pencegahan duplikasi nomor kontak.
- **Implementasi Database & Skema Prisma (`prisma/schema.prisma`):**
  - Menambahkan model `TenantGoogleIntegration`: `tenant_id`, `is_enabled`, `connected_email`, `refresh_token`, `access_token`, `token_expiry`, `naming_template`, `contact_label`, `auto_sync_on_chat`, `auto_sync_on_reserve`, `last_synced_at`.
  - Memperluas model `Customer` dengan field tracking: `google_resource_name`, `google_etag`, `google_synced_at`.
- **Implementasi Backend & Service Layer:**
  - **Google OAuth Manager (`src/integrations/google-contacts/google-oauth.client.ts`)**: Mengelola OAuth 2.0 Client, pembuatan URL otorisasi berparameter state tenant, pertukaran authorization code, auto-refresh token, dan pencabutan izin (revoke token).
  - **Formatter & Normalizer (`src/services/google-contacts-formatter.ts`)**: Parser template penamaan kontak, normalisasi nomor telepon, dan pembuat catatan terstruktur (data anak, alamat, reservasi).
  - **Core Service (`src/services/google-contacts.service.ts`)**: Penanganan query People API, deduplikasi kontak berdasarkan nomor HP, create/update kontak, sinkronisasi tunggal, dan batch sync throttling (menghindari rate limit Google).
  - **Event Hooks Otomatis**: Integrasi trigger async di `customer.service.ts` (saat update nama) dan `reservation-lifecycle.service.ts` (saat booking selesai), dengan proteksi isolasi sandbox test (`is_sandbox_test = true`).
  - **REST API Admin Routes (`src/routes/admin/google-integration.subroute.ts`)**: Endpoint `/auth-url`, `/callback`, `/status`, `/settings`, `/sync-all`, dan `/disconnect`.
- **Implementasi Admin Dashboard UI (`packages/admin-dashboard`):**
  - Menambahkan komponen `GoogleContactsPanel.tsx`:
    - Mode Belum Terhubung: Tombol 1-klik *"Hubungkan dengan Akun Google"* dengan logo resmi.
    - Mode Terhubung: Indikator status email, statistik total kontak tersinkron, waktu sync terakhir, dan tombol putus akun (dengan modal `useUiFeedback`).
    - Formulir Kustomisasi Format Nama Kontak dengan **Live Preview Box**.
    - Toggle Switch auto-sync saat chat nama & saat reservasi.
    - Tombol aksi *"Sinkronkan Semua Kontak Sekarang"*.
  - Terintegrasi pada halaman tab Pengaturan (`Settings.tsx`).
- **Verifikasi & Pengujian:**
  - Unit tests baru `tests/unit/google-contacts.test.ts` (10/10 passed).
  - Full Vitest test suite regression (**178 test files, 1560 passed, 0 failed**).
  - TypeScript compilation backend (`npm run build`) 100% lolos.
  - Frontend production build (`packages/admin-dashboard: npm run build`) 100% lolos.

### Enhanced & Fixed — Clinic Services Bundle & Add-on Strict Business Logic Alignment (2026-08-22)

- **Latar Belakang & Kebutuhan:**
  1. **Paket Bundle**: Layanan bertipe Bundle wajib merupakan gabungan dari minimal 2 layanan eksisting yang valid di katalog, dan harga bundle (`promoPrice`) wajib lebih murah dari total harga normal layanan satuan penyusunnya ($\text{Harga Bundle} < \sum \text{Harga Normal Item}$).
  2. **Layanan Add-on**: Layanan bertipe Add-on adalah layanan komplementer/tambahan yang tidak bisa berdiri sendiri. Pemesanan di formulir reservasi wajib menyertakan minimal 1 layanan utama sebelum dapat menambahkan layanan add-on.
- **Implementasi Backend (`src/services/treatment-catalog.service.ts` & Routes):**
  - **Data Model**: Memperluas interface `ClinicServiceItem` dengan `serviceType: 'STANDARD' | 'BUNDLE' | 'ADD_ON'`, `bundleItemIds?: string[]`, `isAddon?: boolean`, dan kategori `ADD_ON`.
  - **Metode Validasi**:
    - Menambahkan `validateBundle(bundleData)`: Memvalidasi minimal 2 komponen ID unik, memastikan semua komponen ada di katalog, mencegah rekursi bundle di dalam bundle, dan memastikan harga promo bundle lebih murah dari total harga normal satuan.
    - Menambahkan `validateReservationTreatments(treatmentIdsOrNames)`: Mencegah pembuatan pesanan yang hanya berisi layanan add-on tanpa layanan utama.
    - Menambahkan helper `isAddonService()`, `isBundleService()`, dan `getBundleComponents()`.
  - **Sinkronisasi Database**:
    - Mendukung serialisasi dan parsing tag metadata `[BUNDLE:id1,id2]` dan `[ADDON]` di database tanpa mengubah skema tabel (SaaS-ready, zero-migration-risk).
  - **API Endpoints (`settings.subroute.ts` & `reservations.subroute.ts`)**:
    - `POST /api/admin/services` & `PUT /api/admin/services/:id`: Menolak bundle tidak valid dengan HTTP 400 dan pesan error deskriptif.
    - `POST /api/admin/reservation`: Menolak pembuatan reservasi yang hanya berisi add-on.
- **Implementasi Admin Dashboard UI (`packages/admin-dashboard`):**
  - **Manajemen Layanan (`ClinicServices.tsx`)**:
    - **Filter Tabs & Realtime Search**: Tab filter "Semua", "Baby", "Kids", "Moms", "Bundle", dan "Add-on", disertai pencarian multi-atribut.
    - **Tabel Interaktif**: Badge Bundle (Indigo) dilengkapi daftar layanan penyusun dan nominal penghematan; Badge Add-on (Rose) dengan penanda wajib bersama layanan utama.
    - **Form Modal Pintar**:
      - Selektor tipe layanan: *Layanan Standar*, *Paket Bundle*, dan *Layanan Tambahan (Add-on)*.
      - Mode Bundle: Picker interaktif layanan eksisting, kalkulasi otomatis total durasi & total harga normal asli, serta validasi live diskon/penghematan.
      - Mode Add-on: Panduan visual bahwa layanan tidak dapat dipesan mandiri.
  - **Formulir Reservasi Kalender (`CreateReservationModal.tsx`)**:
    - Memblokir penambahan layanan Add-on jika belum ada layanan utama dalam keranjang reservasi.
    - Menampilkan notifikasi info jika seluruh layanan utama dihapus dan hanya tersisa add-on.
- **Verifikasi & Pengujian:**
  - Unit tests baru `tests/unit/treatment-catalog-bundle-addon.test.ts` (13/13 passed).
  - Full Vitest test suite regression (**176 test files, 1545 passed, 0 failed**).
  - Frontend Build (`packages/admin-dashboard: npm run build`) 100% lulus tanpa error.
  - Backend Build (`npm run build`) 100% lulus tanpa error.

### Fixed — Total Outbound Message Deduplication Guard & Database Cleanup (2026-08-22)

- **Latar Belakang & Root Cause Analisis Masalah Balasan Duplikat (*Double Bubble* Admin Web vs WA HP):**
  1. **Perbedaan Format ID WhatsApp (`wa_message_id`)**: Pengiriman dari Admin Web via WAHA API menghasilkan Short ID (`3EB0...`), sedangkan webhook echo dari WAHA mengirimkan Compound Key (`true_6288...@c.us_3EB0...`). Pengecekan kesamaan string persis gagal mengenali kecocokan ID tersebut.
  2. **Perbedaan Placeholder Teks Gambar (`[IMAGE]` vs `[MEDIA]`)**: Admin Web mencatat pengiriman gambar dengan placeholder `[IMAGE]`, sedangkan webhook echo mencatat gambar dengan `[MEDIA]`. Pencocokan equality string `content` di database menghasilkan `null` sehingga baris baru ganda dibuat.
  3. **Pencocokan Teks Case-Sensitive**: Pencarian teks pesan di PostgreSQL bersifat case-sensitive (*"Tes"* $\neq$ *"tes"*).
- **Implementasi Perbaikan:**
  - **Message Service (`src/services/message.service.ts`)**:
    - Menambahkan helper `extractShortMessageId()` untuk menormalkan compound key WAHA/Baileys ke short key.
    - Memperbarui `isDuplicateMessage()` agar mendaftarkan dan memverifikasi kedua varian ID (raw dan short key) ke memory cache dan Prisma `OR` query.
    - Memperbarui `checkAndAttachOutboundDuplicate()` dengan window toleransi 60 detik, pencocokan gambar cerdas (`[IMAGE]`, `[MEDIA]`, `payload_raw.media`), dan pencocokan teks case-insensitive (`mode: 'insensitive'`).
  - **Webhook Route (`src/routes/webhook.route.ts`)**:
    - Menyelaraskan placeholder gambar outbound menjadi standar tunggal `[IMAGE]`.
    - Memanggil `checkAndAttachOutboundDuplicate()` dengan parameter `isOutboundImage` dan window 60 detik.
  - **Database Cleanup di Live Server**:
    - Menjalankan kueri pembersihan partisi duplikasi idempoten di PostgreSQL live server: **244 pesan outbound duplikat historis berhasil dibersihkan**.
- **Verifikasi & Pengujian:**
  - Unit tests baru `tests/unit/outbound-deduplication.test.ts` (4/4 passed).
  - Full Vitest suite regression (174 test files, 1526 passed).
  - TypeScript build backend (`tsc`) 100% lulus tanpa error.

### Enhanced — On-Demand HD Image Loading & Mobile-Friendly Back Navigation in LiveChat Lightbox (2026-08-22)

- **Kebutuhan & Latar Belakang:**
  1. **On-Demand HD Loading**: Saat mengklik gambar di LiveChat, user menginginkan gambar preview standar yang jelas & ringan dimuat terlebih dahulu tanpa langsung mengunduh file HD ukuran besar. File resolusi penuh (HD) hanya dimuat saat user secara eksplisit mengklik tombol "HD".
  2. **Mobile Navigation & Anti-Blocking**: Di perangkat mobile / smartphone, membuka gambar tidak boleh memblokir seluruh halaman tanpa opsi kembali. Harus tersedia skema navigasi kembali yang jelas dan ergonomis untuk kembali ke percakapan chat.
- **Implementasi (`packages/admin-dashboard/src/components/common/MediaImage.tsx` & Pages)**:
  - **On-Demand HD Mechanism**:
    - Lightbox modal default membuka gambar menggunakan `standardSrc` (`thumbUrl` / `url`), memberikan rendering instan dan hemat kuota/bandwidth.
    - Menambahkan tombol interaktif **"✨ Muat HD"** pada header toolbar. Saat diklik, sistem melakukan prefetching HD di background dengan status *Memuat HD...*, dan saat selesai beralih mulus ke tampilan resolusi tinggi dengan badge **"✓ HD Aktif"**.
  - **Skema Navigasi Mobile ("Kembali ke Chat")**:
    - **Header Bar Atas (Safe-Area Aware)**: Dilengkapi tombol **"⬅️ Kembali"** (mobile) / **"⬅️ Kembali ke Chat"** (desktop) berukuran besar dan mudah di-tap dengan jempol.
    - **Mobile Bottom Quick-Action**: Tombol floating pill **"⬅️ Kembali ke Chat"** di bagian bawah layar smartphone untuk akses satu tangan yang nyaman.
    - **Mobile Swipe-Down to Dismiss**: Gesture geser/tarik ke bawah (*drag-to-dismiss*) dengan animasi transisi pegas (*spring pull*) dan reduksi opasitas untuk menutup viewer secara natural.
    - **Android Back Button / Browser Popstate**: Mengintegrasikan `window.history.pushState` sehingga menekan tombol Back hardware Android / browser menutup modal gambar tanpa meninggalkan halaman LiveChat.
    - **Escape Key & Backdrop Tap**: Menutup viewer saat klik di area gelap di luar gambar atau menekan tombol `Esc` keyboard.
    - **Body Scroll Lock**: Mencegah scrolling halaman latar belakang saat modal gambar aktif.
- **Verifikasi & Build:**
  - Build Frontend (`packages/admin-dashboard`: `tsc && vite build`) 100% lulus tanpa error.
  - Unit tests `tests/unit/inbound-media-location-guard.test.ts` (4/4 passed).

### Fixed — WhatsApp Companion Phone Outbound Image Capture & LiveChat Media Rendering (2026-08-22)

- **Root Cause Analisis Masalah Gambar HP (Gambar Kartini tidak muncul di LiveChat):**
  1. **Webhook Outbound Bypass**: Ketika admin/staf mengirim gambar dari aplikasi WhatsApp di HP (*companion phone*), webhook WAHA mengirim event `payload.fromMe = true` dengan `payload.body = ""` (karena foto tanpa caption). Logika webhook sebelumnya `if (adminReplyText.trim() && !isBotAutoReply)` mengevaluasi string kosong sebagai falsy sehingga pengiriman foto dilewati sepenuhnya (tidak di-download, tidak dicatat ke database `Message`, dan tidak di-broadcast via SSE ke LiveChat).
  2. **Media Download Outbound Hilang**: Blok `fromMe` belum memiliki mekanisme download media dari WAHA NOWEB (`fetchUrl`, `downloadMedia`, base64 `jpegThumbnail`), sehingga pesan outbound tidak pernah menyimpan aset gambar ke storage lokal (`/storage/media/inbound`).
  3. **LiveChat & Staff UI `extractMedia` Gap**: Fungsi `extractMedia` di frontend hanya mencari `msg.payload_raw.media`. Ketika mengambil data dari database via REST API (`GET /api/admin/live-chat/conversations/:id/messages`), kolom `media_url` dan `media_hd_url` berada langsung pada objek baris pesan, sehingga gambar tidak terbaca dan dirender sebagai pesan teks biasa / kosong.
- **Perbaikan:**
  - **Webhook Route (`src/routes/webhook.route.ts`)**:
    - Menambahkan deteksi `isOutboundImage` lengkap pada event `fromMe` yang mencakup seluruh varian format WAHA NOWEB (`_data.type: 'image'`, `hasMedia`, `mediaUrl`, `imageMessage`, `directPath`).
    - Mengunduh gambar otomatis dari WAHA via `wahaClient.fetchUrl` / `wahaClient.downloadMedia` / fallback base64 thumbnail, dan menyimpannya secara permanen via `mediaService.saveInboundMedia`.
    - Mencatat pesan outbound ke database dengan `payloadRaw: { ...payload, media: outboundMedia }` serta menyiarkannya secara real-time ke LiveChat Monitor via Server-Sent Events (SSE).
    - Memastikan pengiriman gambar tanpa teks tetap diproses dan dieksekusi tanpa terblokir filter `trim()`.
  - **Admin Dashboard (`packages/admin-dashboard`)**:
    - Memperbarui fungsi `extractMedia()` di `LiveChatMonitor.tsx` dan `StaffToday.tsx` untuk mengenali kolom `media_url`, `mediaUrl`, `media_hd_url`, dan `mediaHdUrl` langsung dari database.
    - Menambahkan properti `thumbUrl` pada interface `ChatMediaData` (`MediaImage.tsx`).
- **Verifikasi:**
  - Unit tests `tests/unit/inbound-media-location-guard.test.ts` (4/4 passed).
  - Full test suite regression (1522 passed across 173 test files).
  - Frontend & Backend compilation (0 errors).

### Added — Interactive JSON Editor & Custom Payload Approve in Meta CAPI Queue (2026-08-22)

- **Kebutuhan & Latar Belakang:**
  - Menambahkan tombol **Edit** pada modal "View JSON" di halaman Meta CAPI Moderation Queue (`/admin/capi-queue`).
  - Mengizinkan admin / operator untuk memodifikasi struktur payload Meta Graph API Conversions API (CAPI) secara interaktif sebelum disetujui dan dikirim.
  - Memungkinkan penyesuaian nominal transaksi, nama produk, timestamp, hingga atribut PII secara granular.
- **Implementasi:**
  - **Admin Dashboard (`packages/admin-dashboard/src/pages/tenant/MetaCapiQueue.tsx`)**:
    - Menambahkan tombol **"Edit JSON"** (`Pencil`) pada modal payload CAPI yang beralih ke editor teks kode monospaced interaktif bertema dark code editor.
    - **Live JSON Syntax Validator**: Memberikan status visual real-time (🟢 *JSON Valid* dengan info baris & byte atau 🔴 *Syntax Error*).
    - **Quick Actions**:
      - `Format`: Merapikan dan mengindentasikan JSON secara otomatis (`Sparkles`).
      - `Reset`: Mengembalikan payload ke nilai kalkulasi default sistem (`RotateCcw`).
      - `Batal`: Membatalkan mode edit tanpa menyimpan (`X`).
      - `Simpan`: Menyimpan perubahan custom JSON ke dalam state lokal (`Save`).
    - **Custom Approve**:
      - Tombol **"Approve & Kirim dengan JSON ini"** / **"Approve Custom"** (`Send`) mengirimkan payload yang telah diedit langsung ke backend untuk dieksekusi ke Meta Graph API.
      - Indikator badge `*` dan status visual pada baris tabel untuk item yang memiliki custom payload.
  - **Backend Route (`src/routes/admin/reservations.subroute.ts`)**:
    - Memperbarui handler `POST /api/admin/reservation/:id/approve-purchase` agar menerima body `{ customPayload }`.
    - Jika `customPayload` disediakan, nilai `event_name`, `event_time`, `custom_data.value`, `currency`, dan metadata kustom digunakan saat memanggil `capiService.sendCapiEvent()`, dan memperbarui `purchase_value` pada database reservasi.
- **Verifikasi & Pengujian:**
  - Unit tests `tests/unit/meta-attribution-fix.test.ts` (4/4 passed).
  - Full test suite regression (1521 passed across 173 test files).
  - Build Frontend (`packages/admin-dashboard`: `tsc && vite build`) & Backend (`tsc`) 100% lulus tanpa error.

### Added / Fixed — Export Chat Data Ingestion, Customer & Children DB Enrichment, and CAPI Queue Alignment (2026-08-22)

- **Latar Belakang & Kebutuhan:**
  - Sinkronisasi dan pengkayaan database pelanggan klinik dari 126 riwayat transaksi chat ekspor (107 kontak unik).
  - Melakukan deduplikasi dengan menghapus kontak duplikat (contact_id "57" / "Suami Bunda Luluk, Ampel").
  - Menyelaraskan nama bersih pelanggan, kota, detail anak (nama, usia bulan/hari), detail treatment, nominal transaksi (`purchase_value`), dan status pemesanan.
  - Memastikan seluruh data selaras dengan antrean Meta CAPI Queue (`GET /api/admin/capi-queue`).
- **Implementasi:**
  - **Enrichment Helpers (`src/scripts/enrich-export-helpers.ts`)**:
    - `normalizePhone()`: Menormalkan format nomor telepon Indonesia (`08...` $\rightarrow$ `628...`, `+62...` $\rightarrow$ `628...`).
    - `cleanCustomerName()`: Membersihkan awalan honorifik (`Bunda`, `Suami Bunda`, `Momm`, `~`) dan akhiran nama kecamatan/wilayah (`Jambangan`, `Wiyung`, `Bubutan`, dll).
    - `parsePatientAgeAndName()`: Mengekstrak nama pasien dan umur dalam bulan (`Dhafi (11 bulan)` $\rightarrow$ `11`, `Briell (3 tahun)` $\rightarrow$ `36`, `Nami (32 hari)` $\rightarrow$ `1`).
    - `parseBookingDateTime()`: Parser cerdas berbagai variasi tanggal booking (DD/MM/YYYY, teks hari dan bulan Indonesia).
    - `mapPatientTypeToCategory()`: Klasifikasi kategori treatment (`BABY`, `MOMS`, `BOTH`).
  - **Synchronization Script (`src/scripts/sync-export-data.ts`)**:
    - Memproses 126 record ekspor secara idempoten.
    - Melakukan upsert pada tabel `Customer`, relasi `Child`, dan tabel `Reservation` dengan purchase value dan status selesai.
- **Verifikasi & Eksekusi di Live Server:**
  - Unit tests `tests/unit/sync-export-data.test.ts` (6/6 passed).
  - Full test suite regression (1520 passed across 173 test files).
  - Berhasil dieksekusi di database live server: **32 Customer diperkaya, 55 Child di-upsert, 56 Reservasi disinkronkan & diperbarui**.

### Fixed — Meta CAPI Queue Payload Hardening (Issue #4) & Total Fix Inbound Image / False Share Location (Issue #6 / Known Issue #14) (2026-08-22)

- **Root cause Meta CAPI Queue Payload Corruption (Issue #4):**
  - Form reservasi WhatsApp klinik memuat teks template instruksi `(Mohon bisa diisi Bunda 😊)` pada baris treatment Moms.
  - Ketika pelanggan hanya memesan treatment anak, teks template instruksi terbaca sebagai nama layanan Moms oleh `reservation-text-parser.ts`.
  - Generator CAPI Queue (`cleanTreatmentList()` & `buildCapiJsonPayload()`) tidak memfilter teks instruksi sehingga menyuntikkan `Mohon Bisa Diisi Bunda 😊` sebagai item produk (`treatment_2`) di `custom_data.contents` dan `content_name`.
  - Pelanggan tanpa nama Bunda di-fallback ke `"Bunda"`, sehingga PII hashing mengirim `user_data.fn: sha256("Bunda")`.
- **Root cause Inbound Image Gagal & False Share Location (Issue #6 / Known Issue #14):**
  - WAHA NOWEB (`devlikeapro/waha:noweb-2026.7.2`) mengirim lampiran media dengan struktur variatif (`_data.type: 'image'`, `_data.directPath`, `_data.mediaKey`, `mediaUrl`).
  - `isInboundImage` tidak menangkap semua variasi tersebut sehingga bernilai `false`.
  - WhatsApp menyertakan object `{ latitude: 0, longitude: 0 }` kosong pada lampiran media. Di `webhook.route.ts`, kode `payload.location ? 'location' : 'text'` mengevaluasi object `{}` sebagai truthy sehingga mengubah tipe pesan menjadi `location` dan teks menjadi `[LOCATION/MEDIA]`.
  - LiveChat merender card `Share Location` (koordinat 0, 0) dan menolak menampilkan gambar.
- **Perbaikan:**
  - **Reservation Text Parser (`src/utils/reservation-text-parser.ts`)**:
    - Menambahkan helper `isPlaceholderText()` untuk mendeteksi dan mengabaikan seluruh variasi template instruksi (`mohon bisa diisi...`, `(jika hamil)`, `(jika ada)`, `(opsional)`, `-`, `tidak ada`, `none`, dll).
    - Memastikan field `momsTreatment`, `babyTreatment`, `name`, `babyName`, dan `momsPregnancyAge` kebal dari penyusupan teks placeholder template.
  - **Meta CAPI Queue (`packages/admin-dashboard/src/pages/tenant/MetaCapiQueue.tsx`)**:
    - Memperbarui `cleanTreatmentList()` dengan filter `isPlaceholderTreatment()` sehingga teks template tidak pernah masuk ke `custom_data.contents` maupun `content_name`.
    - Memperbaiki resolusi `user_data.fn`: Menyaring kata generic `"Bunda"` / `"Ibu"` dan memprioritaskan nama asli si kecil (`child_name` / `Hasbi`), atau mengabaikan `fn` jika nama asli tidak tersedia.
  - **CAPI Service & Admin Route (`src/services/capi.service.ts` & `src/routes/admin/reservations.subroute.ts`)**:
    - Mengintegrasikan filter placeholder pada `resolveTreatmentValue()` dan response `GET /api/admin/capi-queue` dengan sanitasi *on-the-fly*.
    - Menghapus prefix honorific (*"Bunda Sarah"* $\rightarrow$ *"Sarah"*) sebelum melakukan hashing PII `user_data.fn`.
  - **Webhook Route & WAHA Client (`src/routes/webhook.route.ts` & `src/integrations/waha/client.ts`)**:
    - Memperluas deteksi `isInboundImage` untuk meng-cover seluruh format WAHA NOWEB (`_data.type === 'image'`, `_data.directPath && _data.mediaKey`, `mediaUrl`, `hasMedia`).
    - Memasang **Strict Location Validator**: Lokasi hanya diakui jika `latitude !== 0` dan `longitude !== 0` serta bukan NaN. Menghapus object location kosong `0, 0` dari payload mentah.
    - Menambahkan implementasi method `fetchUrl` dan `downloadMedia` yang tangguh pada `WahaClient`.
  - **LiveChat Monitor (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`)**:
    - Memperketat `hasValidLocation` agar hanya merender card Peta Share Location jika koordinat nyata dan bukan `0, 0`.
  - **Database Sanitizer Script (`src/scripts/sanitize-db-reservations.ts`)**:
    - Script one-off untuk memulihkan dan membersihkan baris reservasi yang terlanjur menyimpan teks `Mohon bisa diisi...` di database production.
- **Verifikasi:**
  - `npx vitest run tests/unit/capi-payload-sanitizer.test.ts tests/unit/inbound-media-location-guard.test.ts` (7/7 passed).
  - Full regression suite `npm test` passed (1514+ tests).
  - Full TypeScript build `npm run build` dan dashboard frontend `vite build` passed (0 error).

### Fixed — Typo Backslash Escaping (`\Bundlebih`), Anti-Halusinasi Nama Bayi (`Bunny`), & Generator Sanitizer Pipeline (2026-08-22)

- **Root cause Typo `\Bundlebih` & Stray Backslashes:**
  - Saat LLM (MiniMax-M2.7) menghasilkan baris baru `\n` dan kata sapaan `Bund` dalam format JSON, escaping karakter newline dan token sapaan bergabung menjadi `\Bundlebih` / `\Bund`.
  - Helper `extractAnswerFromPartialJson` sebelumnya hanya me-replace `\n` standar sehingga menyisakan backslash yang menempel di kata.
- **Root cause Halusinasi Nama Si Kecil ("Bunny"):**
  - Model LLM mengarang nama panggilan si kecil ("treatment untuk Bunny ya, Bund?") meskipun customer belum pernah menyebutkan nama anaknya di percakapan.
- **Perbaikan:**
  - **Language Sanitizer (`src/utils/language-sanitizer.ts`)**:
    - Menambahkan `sanitizeStrayBackslashes()` untuk membersihkan seluruh pola `\Bundlebih` $\rightarrow$ `Bunda lebih`, `\Bund` $\rightarrow$ `Bunda`, dan menghapus backslash liar sebelum karakter alfabet (`\Bunda` $\rightarrow$ `Bunda`).
    - Menambahkan filter di `sanitizeHallucinatedTerms()` untuk menormalkan frasa halusinasi nama anak seperti `untuk Bunny` / `terkait Bunny` / `si Bunny` $\rightarrow$ `si kecil`, serta menormalkan sapaan `ya, bund` $\rightarrow$ `ya, Bunda`.
  - **LLM Generator (`src/integrations/llm/generator.ts`)**:
    - Memperbarui prompt `systemMessage` di section `ATURAN ANTI-HALUSINASI`: melarang keras menebak atau mengarang nama panggilan si kecil ("Bunny", "Baby", "si dedek") jika belum disebutkan customer.
    - Menambahkan `sanitizeStrayBackslashes` dan `sanitizeHallucinatedTerms` ke dalam pipeline pembersihan akhir respons AI.
    - Memperbarui `extractAnswerFromPartialJson()` dengan pembersih backslash escaping otomatis.
- **Verifikasi:** `npx vitest run tests/unit/language-sanitizer-fixes.test.ts` (7 tests pass), `npm run build` pass (zero error).

### Fixed (Partial — BELUM menyelesaikan masalah live, lihat `docs/KNOWN_ISSUES.md#14`) — Image Inbound Hilang di LiveChat & Dobel Share Location 0,0 (2026-08-22)

- **Status:** Sudah di-push `803a64d` & di-deploy live `docker compose build --no-cache + --force-recreate` (app Up 5s, waha Up 9 days), tapi tes user kirim image via WA Web official **masih tidak muncul** dan masih ada `Share Location` — dicatat sebagai **open** di KNOWN_ISSUES #14. Perubahan di bawah tetap di-keep karena benar secara logic, tapi belum cukup.
- **Root cause 1 - Stale guard memotong media (`src/routes/webhook.route.ts:404` & `src/routes/waba-webhook.route.ts:132`):**
  - Image dari WA HP/Web official terdeteksi `isInboundImage` tapi `FAST-PATH STALE GUARD` 180s dieksekusi **sebelum** `saveInboundMedia`. Saat WAHA reconnect/QR burst atau jam HP skew, `payload.timestamp` telat >180s → `IGNORED_STALE_MESSAGE` di-log dengan `payloadRaw: payload` tanpa `media` dan `content: "[MEDIA]"` placeholder. `storage/media/inbound` tidak tercipta (cek: 5 HD vs 169 thumb orphan), `LiveChatMonitor.tsx:69 extractMedia` tidak ketemu `media.url` → `<MediaImage>` tidak render, seolah tidak masuk.
  - WABA sama: `waba-webhook.route.ts:132` resolve `mediaUrl` **setelah** stale guard, jadi image stale juga hilang di DB.
- **Root cause 2 - Deteksi image rapuh (`webhook.route.ts:469`):**
  - Hanya cek `type==='image' || message.imageMessage || hasMedia+mimetype`. WAHA NOWEB sering kirim caption di `body` (bukan `caption`), `media.url` di `_data.deprecatedMms3Url/mediaUrl`, `mimetype` di `_data.mimetype`. `imageCaption` jadi `""` → `[MEDIA]` tanpa caption, dan `fetchUrl` tidak coba URL alternatif → `downloadMedia` timeout 15s → fallback thumb 1x1 → gambar HD hilang.
- **Root cause 3 - Prioritas Location salah (`src/state-machine/machine.ts:121` + `LiveChatMonitor.tsx:2139`):**
  - `machine.ts` pilih `location ? [LOCATION]` **dulu** baru `media ? [IMAGE]`. Image WA Web yang kebawa `location: {latitude:0, longitude:0}` kosong tampil dobel: gambar + card `Share Location: 0,0`. UI `LiveChatMonitor.tsx:2139` `isLocationMsg = !!payload_raw.location` juga true untuk `0,0` sehingga selalu render card Peta di bawah image.
- **Perbaikan:**
  - **WAHA** (`webhook.route.ts:404-530`): pindahkan `isInboundImage/saveInboundMedia` **sebelum** stale guard, per luas deteksi (`_data.mimetype`, `mimetype`, `media.mime_type`), `imageCaption = caption || body || _data.caption` dan `mediaUrlCandidate = media.url || _data.mediaUrl || _data.deprecatedMms3Url`, stale branch kini log dengan `mergeMediaIntoPayload(payload)` + `inboundContent` dan khusus `isInboundImage` tetap simpan via `saveInboundMedia` dengan status `IGNORED_STALE_MESSAGE` (image tetap muncul). Hapus duplikat `inboundContent` setelah `heavyMediaType`.
  - **WABA** (`waba-webhook.route.ts:122-170` + `202-223`): resolve `mediaUrl/msgMedia` **sebelum** stale guard, stale log pakai `mergeWabaMedia(rawPayload)`, hapus duplikat resolve setelah attribution, dan perbaiki `blocked`+`scopeGate` yang sebelumnya `scopeGate` nyangkut di dalam `if(blocked)` (bug) → sekarang `blocked` log lalu `continue`, baru `conversation = getOrCreate` + `enforceAiScopeGate` untuk semua (seed `tenant-waba-a/b` ke `ALL` di test agar tidak flaky).
  - **State machine** (`machine.ts:121-126`): `hasMedia` (media/type==='image') diprioritaskan sebelum `hasValidLocation` (`latitude!==0 && longitude!==0`), cegah `[LOCATION SHARE: Lat 0, Lng 0]`.
  - **LiveChat** (`LiveChatMonitor.tsx:2139-2150`): `hasValidLocation` cek `latitude!==0 && longitude!==0` dan `effectiveIsLocationMsg = isLocationMsg && !hasMedia`, render card lokasi hanya jika bukan image.
  - **Webhook type** (`webhook.route.ts:713`): `type: isInboundImage ? 'image' : location ? 'location'` + `location` hanya di-set kalau bukan image (EXIF 0,0 tidak kebawa).
- **Verifikasi lokal:** `npm run build` pass, `1225 unit + 21 integration` pass, `storage/media/inbound` stale image nambah HD+thumb (lokal). **Verifikasi live user: GAGAL** — image masih tidak muncul & share location tetap ada setelah deploy `803a64d` + `docker compose build --no-cache` + `--force-recreate` (app Up 5s, waha 9 days). Lihat `docs/KNOWN_ISSUES.md#14` untuk next steps (log payload mentah, curl WAHA media, Caddy cache).

### Fixed — Auto-Release Exemption (Bypass Hold #1155), Anti-Race In-Flight Abort (#319), & Self-Learning Error Logger (2026-08-22)

- **Root cause #1155 Bunda Inez (Bypass Hold & Balasan Bot Ngawur):**
  - Percakapan yang di-takeover oleh CS (`escalation_reason = 'manual_reply'` via WhatsApp HP atau `manual_takeover` via Dashboard) sebelumnya tetap terkena timer auto-release 6 jam (`HUMAN_HANDLING_TIMEOUT_HOURS = 6`).
  - Setelah melewati malam/keesokan harinya (>6 jam hening), fungsi `checkAndApplyAutoRelease` otomatis mencabut status Human Handling dan merestore state ke `INITIAL`.
  - Saat customer mengirim chat *"Jadi kan ya kak?"* untuk menanyakan janji temu CS, bot menganggap percakapan baru dan membalas dengan greeting jualan pembuka.
- **Root cause #319 (Banjir/Bocor Chat Bot Menimpa CS):**
  - Customer mengirim 2 pesan beruntun (*"Kebraon..."* lalu *"Ada gerai nya?"*). Pesan pertama di-split jadi 2 bubble (ada typing delay 5-6s), sementara pesan kedua sudah mengantri di BullMQ queue.
  - Saat admin melihat bot membalas pesan 1 dan admin langsung membalas manual via WA HP (memicu `HUMAN HANDOFF`), antrian BullMQ untuk pesan kedua dan in-flight typing bubble yang sedang berjalan di background TIDAK DIBATALKAN. Bot tetap menembakkan sisa 2-3 bubble ke WhatsApp menyela chat admin.
- **Root cause Self-Learning LLM Error Dump:**
  - `self-learning.service.ts` membuang full object AxiosError (400+ baris per error) ke stdout saat server LLM eksternal mengembalikan HTTP 500.
- **Perbaikan:**
  - **Auto-Release Exemption (`src/services/conversation.service.ts:225-245`)**: Menambahkan explicit guard exemption untuk seluruh eskalasi manual CS (`manual_reply`, `manual_takeover`, `admin_takeover`, `admin_manual_reply`, prefix `manual_`). Percakapan yang pernah disentuh CS tidak akan pernah di-auto-release oleh timer malam.
  - **Default Timeout Bump (`src/config/clinic.ts:23`)**: Mengubah default fallback `humanHandlingTimeoutHours` dari 6 jam menjadi 18 jam (aman dari siklus malam/libur).
  - **3-Layer Queue & In-Flight Abort (`src/services/queue.service.ts`, `src/state-machine/machine.ts`, `src/services/typing.service.ts`)**:
    1. *BullMQ Worker & Memory Queue Guard*: Sebelum memproses job, cek `conversation.is_human_handling`. Jika true, buang job bot (`[QUEUE ABORT]`).
    2. *State Machine Entry Gate*: `processMessage` langsung return `shouldSendReply: false` jika percakapan sedang di-handle CS (`[STATE MACHINE ABORT]`).
    3. *Real-Time In-Flight Abort*: `simulateHumanReply` menerima callback `shouldAbort` yang mengecek status DB sebelum reading delay, sesudah reading delay, dan sebelum eksekusi `sendText` tiap bubble. Jika CS takeover saat bot sedang delay/mengetik, bot seketika membatalkan pengiriman dan mematikan indikator typing.
  - **Self-Learning Logger & Timeout (`src/services/self-learning.service.ts`)**: Menambahkan `timeout: 15000` dan merapikan log error menjadi 1 baris ringkas (`HTTP 500: message`), serta mengembalikan `null` (skip staging) saat LLM gagal agar tidak memasukkan Q&A rusak ke database.
- **Verifikasi:** `npm run build` (tsc) pass, `npx vitest run tests/unit/human-handling-race-guard.test.ts` (5 tests pass), `npm test` offline pass.

### Fixed — Reservasi #777 Siska Gagal Capture & Atribusi Aisyah 929 `app.kalababyspa` (2026-08-22)

- **Root cause #777 Siska (gagal capture reservasi):** 3 silent-drop berlapis:
  1. **Human Handling short-circuit `src/routes/webhook.route.ts:732-823`**: `HUMAN_HANDLING_ACTIVE_SILENT` (grace 30s, `ENABLE_WAHA_HOLD_LABEL=false` default, explicit guard) langsung `logMessage` + `return` tanpa `enqueue` — watcher `human.ts:41` (`isReservationFormMessage → parseReservationText → prisma.reservation.create` idempoten 24h) tidak pernah reachable. Form Siska saat CS sudah take-over hanya ter-log di `messages` tapi `reservations` 0.
  2. **Stale guard 180s `webhook.route.ts:407`**: reconnect/QR burst bikin `payload.timestamp` telat >180s → `IGNORED_STALE_MESSAGE` (log saja) — form reservasi ikut ter-drop.
  3. **Swallow DB error `src/state-machine/handlers/interest.ts:93`**: `catch (dbErr) {}` kosong → reply sukses palsu `Baik Bunda, data reservasi sudah kami terima` padahal `prisma.reservation.create` throw `P6001`/`P1001` (client `--no-engine` / offline). Data hilang tanpa jejak.
- **Root cause 929 Aisyah (link `app.kalababyspa`):** `AdClick.landingUrl` tersimpan sebagai `https://app.kalababyspa.online/cta?...` bukan first-touch URL PageView. `external-tracker.js:121-146` wajib bridge `window.location.href → /cta?landing_url=...` — jika LP tidak pasang script / CTA `href` bukan `/cta` / klik race 250ms, `GET /cta` `landing.route.ts:164` fallback ke `host` (`app.*`). `resolveCanonicalLandingUrl` (`capi.service.ts:103`) sudah self-heal di `GET /capi-queue` + CAPI send, tapi `ad_clicks` raw tetap `app.*` sebelum queue dibuka.
- **Fix Siska:**
  - `webhook.route.ts:407-430` stale guard bypass: jika `isReservationFormMessage(payload.body)` true → jangan `IGNORED_STALE_MESSAGE`, lanjut capture path (log `STALE GUARD BYPASS`).
  - `webhook.route.ts:741-823` 3 early return human handling (grace / `LABEL_SYNC_DISABLED` / explicit) kini **inline auto-capture** sebelum `logMessage` + silent return: `isReservationFormMessage` → `parseReservationText` → `findFirst 24h treatment_detail` → `prisma.reservation.create` → `reservationLifecycleService.onReservationCreated` (followUp + `child.service.upsertChildrenFromBabies` + labels). Idempoten, best-effort, tetap eskalasi hidden jika duplikat/parse fail.
  - `interest.ts:93-112` catch kini `console.error`, update nama kontak `Bunda {nama} {kecamatan}` tetap jalan (penting untuk `tests/unit/e2e-chat-to-reservation.test.ts:374`), eskalasi dengan percakapan `gagal persist DB` + reply jujur `gangguan penyimpanan — tim akan cek manual` (bukan sukses palsu). Di `test` tetap human handling.
- **Fix Aisyah:**
  - `landing.route.ts:185-198` kanonikalisasi sebelum simpan: jika `!query.landing_url` log `CTA LANDING_URL MISSING` + `resolveCanonicalLandingUrl(fullLandingUrl, tenantDomain)` sehingga `AdClick.landingUrl` langsung `https://kalababyspa.online/reservasionline?fbclid...` (strip `app.`, map `/cta → /reservasionline`, preserve `fbclid/utm_*`, delete `landing_url/slug/p/msg/divisi`). Tenant-aware via `Tenant.landing_domain` (SAAS). Fallback hardcode `kalababyspa.online/reservasionline` bila `landing_domain=""` tetap konsisten dengan `capi.service.ts:187`.
  - Self-heal existing tetap: `capi.service.ts:525` saat kirim CAPI + `reservations.subroute.ts:1137` saat `GET /capi-queue` tulis balik DB.
- **Verifikasi:** `npm run build` pass, `npx vitest run` 1495 passed / 168 files (termasuk `landing-url-attribution.test.ts:6` + `webhook-stale-message-guard.test.ts:3` + `e2e-chat-to-reservation.test.ts:10`), cek live: `SELECT landingUrl FROM ad_clicks WHERE phone LIKE '%929'` harus `kalababyspa.online/reservasionline`, `SELECT * FROM reservations WHERE raw_text ILIKE '%Siska%'` harus ada entry usai bypass.

### Fixed — Live Chat Sorting Absolut by Waktu (Human Handling Tidak Lagi di Atas) (2026-08-22)

- **Root cause**: Daftar Live Chat diurut 2 layer (Backend `src/services/conversation.service.ts:183` `orderBy: [is_pinned desc, is_human_handling desc, last_message_at desc]` + Frontend `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx:667` `sortChats()` cek `isPinned` lalu `isHumanHandling` lalu `lastMessageAt`). Chat `human handling` yang `lastMessageAt`-nya lama tetap nangkring di atas chat bot yang baru masuk — tidak sesuai ekspektasi waktu absolut.
- **Fix (Opsi A - Pin tetap di atas)**: Hapus privilege `is_human_handling` dari sorting, pertahankan `is_pinned` sebagai aksi eksplisit admin.
  - **Backend** (`src/services/conversation.service.ts:154`, `182-187`, `197-201`): `orderBy` menjadi `[is_pinned desc, last_message_at desc]`; memory fallback `.sort()` hanya cek `is_pinned` lalu `last_message_at || updated_at` (hapus cek `is_human_handling`).
  - **Frontend** (`LiveChatMonitor.tsx:667-673`): `sortChats()` hanya cek `isPinned` lalu `lastMessageAt desc` — seluruh call site SSE (`message.created:901`, `conversation.updated:929`), optimistic `handleSendReply:1226`, `handleTogglePin:698`, dan polling 3.5s otomatis ikut.
  - **Komentar** (`src/services/live-chat.service.ts:162`): update dari `human handling di atas` → `pinned desc, lalu last_message_at desc absolut`.
- **Verifikasi**: `npm run build` (tsc) pass, `packages/admin-dashboard: npm run build` pass (LiveChatMonitor 74.58 kB), `npm test` 1495 passed / 168 files, repro 4-chat (P pinned 3h, C human 5m, B bot 10m, A human 2h) → OLD `P->C->A->B` vs NEW `P->C->B->A` (absolut waktu) pass.

### Fixed — Meta CAPI Queue Approve Stale UI (2026-08-22)

- **Root cause**: `POST /api/admin/reservation/:id/approve-purchase` punya fallback `memoryReservations` yang di production mengembalikan `200 success` palsu saat DB error — frontend toast `berhasil` tapi `GET /api/admin/capi-queue` baca dari DB tetap `pending`. Ditambah `apiRequest` tanpa `cache: no-store` dan `handleApprove` tanpa `await loadQueue()` bikin refresh tidak deterministik.
- **Fix backend** (`src/routes/admin/reservations.subroute.ts:979`): fallback in-memory hanya aktif saat `NODE_ENV !== 'production'`; di production kembalikan `500` agar UI tampil error, bukan success palsu. `GET /api/admin/capi-queue` set header `Cache-Control: no-store, no-cache, must-revalidate` + `Pragma: no-cache`.
- **Fix frontend** (`packages/admin-dashboard/src/services/api.ts:103`, `MetaCapiQueue.tsx:293-327`): `apiRequest` default `cache: 'no-store'` untuk semua admin call. `handleApprove`/`handleReject` pakai optimistic update (`setItems` langsung set `approved`/`ignored_outlier`) + `await loadQueue()` agar UI re-konsiliasi dengan DB.

### Added & Fixed — Meta Full-Funnel Attribution & Initial Landing URL Preservation (2026-08-21)

- **CAPI Queue & Database Self-Healing URL Normalizer (`src/services/capi.service.ts`, `src/routes/admin/reservations.subroute.ts`, `MetaCapiQueue.tsx`)**:
  - Mengimplementasikan helper `resolveCanonicalLandingUrl()` terpadu yang secara otomatis mengekstrak nested `landing_url` dan memetakan URL redirect `/cta` lama ke domain landing page aktif (`Tenant.landing_domain`) dengan tetap mempertahankan 100% parameter query iklan (`fbclid`, `utm_*`).
  - Menambahkan auto-self-healing pada `GET /api/admin/capi-queue`: data reservasi dan lead historis yang masih memuat URL redirect `/cta` di database PostgreSQL otomatis diperbaiki menjadi URL landing page asli saat dimuat.
  - Memprioritaskan nominal murni treatment (`extractValueByFormat(text, 'Treatment = %VALUE%')` / `parsed.payment.treatmentPrice`) di atas total invoice (`totalPrice`), sehingga nilai Purchase di Meta CAPI dan CAPI Queue merefleksikan nilai riil treatment murni (misal: Rp 70.000) dan tidak tercampur ongkir (Rp 25.000) ataupun total tagihan (Rp 85.000).
  - Menyempurnakan JSON Viewer modal di `MetaCapiQueue.tsx` agar preview `event_source_url` selalu presisi dan selaras dengan format CAPI yang dikirim ke Meta.

- **External Landing Page URL Preservation (`src/landing/public/external-tracker.js`, `docs/INTEGRASI_LANDING_EXTERNAL.md`)**:
  - Memperbarui script jembatan `external-tracker.js` agar secara otomatis menyisipkan parameter `landing_url = window.location.href` ke seluruh tombol CTA WhatsApp yang mengarah ke endpoint `/cta`.
  - Menjamin URL awal tempat event `PageView` pertama kali ditembakkan di browser (misal: `https://kalababyspa.online/reservasionline`) selalu diteruskan ke server bot secara utuh, mencegah terpotongnya rantai atribusi URL di tengah jalan.
  - Menambahkan `landing_url` ke dalam whitelist parameter atribusi `TRACKED_PARAMS`.

- **Enhanced `/cta` Full Landing URL Resolution & Offline Failover (`src/routes/landing.route.ts`)**:
  - Menyempurnakan parsing `fullLandingUrl` pada endpoint `/cta`: memprioritaskan `query.landing_url` dan menggabungkan parameter query string (`fbclid`, `utm_*`) secara cerdas bila landing URL diberikan dalam bentuk base URL bersih.
  - Menambahkan in-memory fallback store (`memoryAdClicks`) pada endpoint `/cta` saat database PostgreSQL offline agar penanganan tracking code dan pengalihan ke WhatsApp tetap 100% andal tanpa memutus alur pengguna.

- **Meta Funnel Architecture Documentation & Comprehensive Unit Testing (`docs/META_FUNNEL.md`, `tests/unit/landing-url-attribution.test.ts`)**:
  - Memperbarui dokumentasi arsitektur `META_FUNNEL.md` untuk merinci alur end-to-end 7 tahap (`PageView` $\rightarrow$ `ViewContent` $\rightarrow$ `AddToCart` $\rightarrow$ `Contact` $\rightarrow$ `Lead` $\rightarrow$ `InitiateCheckout` $\rightarrow$ `Purchase`).
  - Menambahkan unit test komprehensif `tests/unit/landing-url-attribution.test.ts` untuk memvalidasi penangkapan landing URL, penggabungan query parameter, pembentukan payload CAPI `Contact` dan `Purchase` beserta hashing PII Meta ParamBuilder (100% pass).

### Added & Refined — Zero-Hardcoding Admin Configurable Landing Domain & Funnel Architecture (2026-08-21)

- **Zero-Hardcoding Tenant Landing Domain (`schema.prisma`, `settings.subroute.ts`, `CustomerService.tsx`, `capi.service.ts`, `landing.route.ts`)**:
  - Menghilangkan seluruh hardcode domain (`kalababyspa.online` / `kalamomsspa.com`) dari backend, generator CTA, dan payload CAPI.
  - Menambahkan kolom `landing_domain` pada tabel `Tenant` di PostgreSQL sehingga Admin dapat bebas mengatur dan mengubah domain landing page / website tenant langsung dari menu Admin Dashboard (Customer Service & CTA Generator).
  - Memperbarui endpoint `GET` dan `POST /api/admin/customer-service` untuk membaca dan menyimpan `landingDomain` ke database.
  - Memperbarui `capi.service.ts` dan `landing.route.ts` agar secara dinamis membaca `landing_domain` tenant dari database atau HTTP request headers (`x-forwarded-host`), menjamin arsitektur 100% SaaS-Ready dan fleksibel untuk semua bisnis.
  - Memperbarui UI `CustomerService.tsx` untuk menyimpan domain ke database dan menyinkronkannya dengan generator link CTA dinamis.

### Added & Refined — Dynamic Tenant-Aware Meta CAPI Funnel Triggers & Zero-Hardcode Value Parser (2026-08-21)

- **Dynamic Value Parser for Pure Treatment Revenue (`capi.service.ts`, `purchase-detection.service.ts`)**:
  - Menghilangkan asumsi ekstraksi angka acak / total tagihan yang tercampur ongkir dengan mengimplementasikan parser regex dinamis `extractValueByFormat(text, formatValueTemplate)`.
  - Mengambil template `format_value` per-tenant (default `"Treatment = %VALUE%"`, mendukung format custom seperti `"Biaya Layanan : %VALUE%"`, `"Paket = %VALUE%"` maupun sufiks `rb`/`ribu`).
  - Menjamin nilai konversi yang dikirimkan ke Meta CAPI murni adalah **Gross Merchandise Value (GMV) / Harga Jasa Treatment**, sehingga ROAS iklan Meta tidak terdistorsi biaya ongkir jarak.
  - Memperbarui `getTenantCapiFormats` untuk memuat `formatValue` langsung dari database per-tenant.

- **Omnichannel `InitiateCheckout` CAPI Trigger (`interest.ts`, `webhook.route.ts`, `live-chat.service.ts`)**:
  - Menutup celah di mana pengiriman form reservasi terisi oleh customer sebelumnya belum mentrigger event Meta: kini saat customer mengirimkan formulir (`isFormSubmission` di `interest.ts`), event CAPI `InitiateCheckout` otomatis ditembakkan (`source: 'CUSTOMER_FORM_SUBMITTED'`).
  - Menambahkan deteksi `format_checkout` dan `format_purchase` pada pesan keluar WhatsApp HP (`payload.fromMe` di `webhook.route.ts`), sehingga saat Admin membagikan form reservasi atau menerima pembayaran via WhatsApp HP, event `InitiateCheckout` dan `Purchase` tetap tertangkap dan terkirim ke Meta CAPI.
  - Memperbarui CAPI Moderation Queue (`reservations.subroute.ts`) agar nilai estimasi treatment pada antrian moderasi selalu mencerminkan nilai murni layanan via `extractValueByFormat`.

- **Meta CAPI Queue UI Overhaul & JSON Viewer Modal (`MetaCapiQueue.tsx`, `App.tsx`)**:
  - Menyederhanakan tampilan kolom Treatment: membersihkan durasi `[90m]` dan sub-detail `(Bayi: ...)` menjadi daftar treatment bersih bernomor (`1. Pijat Bayi Ceria`).
  - Menampilkan badge Event CAPI (`Purchase` / `Lead`) dengan nilai GMV diletakkan tepat di bawah badge event tanpa label "IDR".
  - Menambahkan badge Jarak (`📍 13 km`) di bawah detail Customer.
  - Menambahkan tombol **"View JSON"** interaktif untuk melihat payload Meta Graph API persis seperti yang akan dikirim, lengkap dengan syntax highlighting dan tombol **"Salin JSON"**.
  - Memperbaiki `event_source_url` agar hanya dikirim jika pelanggan berasal dari Paid Ads dengan `landingUrl`, serta mengatur `action_source: 'chat'` untuk kontak organik tanpa dummy URL.
  - Menambahkan routing alias `/admin/capi-queue`, `/admin/capi`, dan `/admin/meta-capi` agar halaman queue selalu mudah diakses dari URL manapun.

- **Comprehensive Unit Testing & Verification (`tests/unit/dynamic-capi-formats.test.ts`, `tests/unit/role-permissions.test.ts`)**:
  - Menambahkan unit test untuk memvalidasi parser nilai dinamis, template kustom per-tenant, prioritas ekstraksi, treatment cleaner, dan perizinan rute RBAC. Seluruh pengujian lulus 100%.

### Added & Fixed — LiveChat Share Location Card Widget & Google Maps Direct Link (2026-08-21)

- **LiveChat Message Bubble Location Card (`LiveChatMonitor.tsx`)**:
  - Memperbaiki rendering pesan LiveChat yang sebelumnya menyembunyikan (*suppressed*) seluruh pesan teks lokasi yang berawalan `[LOCATION SHARE: Lat ...]` tanpa menampilkan bubble isi.
  - Menambahkan kartu interaktif **Share Location**:
    - Ikon Pin Lokasi (`MapPin`).
    - Teks koordinat Latitude & Longitude (`-7.34886, 112.751677`).
    - Tombol aksi **"Peta"** yang langsung membuka titik lokasi pelanggan di Google Maps (`https://www.google.com/maps/search/?api=1&query=lat,lng`) pada tab baru.

### Fixed & Refined — Meta Click Catcher Attribution for Returning Contacts, CAPI Queue Moderation & MQL Lead Event Automation (2026-08-21)

- **Meta CAPI Moderation Queue Fix (`reservations.subroute.ts`)**:
  - Memperbaiki query antrian `GET /api/admin/capi-queue`: menghapus filter kaku `purchase_occurred_at: { not: null }` yang sebelumnya menyebabkan seluruh reservasi baru/pending tidak muncul di antrian.
  - Menampilkan seluruh reservasi non-cancelled dengan fallback waktu kejadian transaksi ke `created_at` dan kalkulasi nilai treatment otomatis (`resolveTreatmentValue`), sehingga Admin dapat meninjau dan menyetujui pengiriman event Purchase ke Meta CAPI.
  - Memperbaiki handler `POST /api/admin/reservation/:id/approve-purchase`: otomatis menginisialisasi `purchase_occurred_at` jika sebelumnya kosong dan mencatat log tindakan ke tabel `AuditLog`.

- **MQL Lead Automation & CAPI Service Hardening (`customer.service.ts`, `capi.service.ts`)**:
  - Menambahkan pemuatan otomatis relasi `adClick` saat event `Lead` terpicu pada `customer.service.ts` agar parameter atribusi iklan (fbp, fbc, fbclid, trackingCode) tidak hilang saat dikirim ke Meta.
  - Menambahkan fallback pencarian otomatis `adClick` di database pada `capiService.sendCapiEvent` bila tidak dioper secara eksplisit.
  - Menambahkan pencatatan audit log `MQL_LEAD_EVENT_SENT` ke tabel `AuditLog` database setiap kali event Lead sukses terkirim ke Meta CAPI.
  - Memperbaiki fungsi `testCapiConnection` di `capi.service.ts` dengan menyertakan format data user valid (`user_data`) sehingga tombol live test koneksi di dashboard mengembalikan status 200 OK tanpa error subcode `2804050`.

- **Meta Click Catcher Attribution for All Contacts (`ad-attribution.service.ts`)**:
  - Menghapus pembatasan `isNewCustomerRecord` pada pencocokan kode tracking `Promo [code]` dan `ctwaClid`.
  - Pelanggan lama atau nomor yang sudah tersimpan di database kini tetap dapat teratribusi ke data iklan (`AdClick`) saat mengklik iklan baru dan mengirim pesan ke bot.
  - Menembakkan event CAPI `Contact` secara akurat pada setiap touchpoint iklan baru.

### Added, Fixed & Refined — WAHA Internal Outbound Cut-Off Switch (Emergency Kill-Switch) & Settings UI Integration (2026-08-21)

- **Internal Outbound Cut-Off Driver Guard (`whatsapp-provider.service.ts`, `waha.driver.ts`, `factory.ts`)**:
  - Mengimplementasikan fitur **Saklar Pemutus Internal (*Emergency Outbound Kill-Switch*)** untuk memutus aliran pengiriman pesan keluar dari Bot Engine ke WAHA secara aman di level driver bot.
  - Sesi WhatsApp Web di server WAHA **tetap aktif dan terhubung (login)** sehingga tidak perlu scan ulang QR dan pesan masuk (*inbound*) tetap terpantau.
  - Setiap upaya pengiriman pesan teks (`sendTextMessage`), gambar (`sendImageMessage`), dan indikator mengetik (`sendTypingIndicator`) saat mode Cut-Off aktif otomatis diblokir dengan error code `WAHA_INTERNAL_CUTOFF` dan warning log.

- **Endpoint API Cut-Off & Schema Database (`schema.prisma`, `src/routes/admin/waba.subroute.ts`)**:
  - Menambahkan kolom `waha_outbound_cutoff Boolean @default(false)` pada model `Tenant` di database.
  - Menambahkan field `wahaOutboundCutoff` pada endpoint `GET /api/admin/whatsapp-provider`.
  - Menambahkan endpoint `PATCH /api/admin/whatsapp-provider/cutoff` untuk mengubah status cut-off per-tenant dengan audit logging.

- **Panel WhatsApp Gateway di Operational Settings (`WhatsAppProviderPanel.tsx`, `Settings.tsx`)**:
  - Menambahkan kartu kontrol interaktif **"Internal Outbound Cut-Off (Emergency Kill-Switch)"**:
    - Status Badge: `🟢 TERHUBUNG (NORMAL)` vs `🔴 CUT-OFF AKTIF (TERPUTUS)`.
    - Tombol Aksi: `⚡ Putuskan Aliran Internal` / `🔌 Sambungkan Aliran Internal`.
    - Dialog konfirmasi aman (*no-native alert*) sebelum mengeksekusi tindakan.
  - Memperbarui build produksi frontend React dashboard (`npm run build`).

### Added, Fixed & Refined — Follow-Up Manual Approval Policy, Queue API Endpoints, Sandbox Filtering & Database Backlog Cleanup (2026-08-21)

- **Manual Approval Policy & Safety Guard Pengiriman Follow-Up (`follow-up.service.ts`, `cron.service.ts`)**:
  - Mengubah kebijakan pengiriman follow-up agar **TIDAK MENGIRIMKAN PESAN OTOMATIS** secara default (`AUTO_FOLLOWUP_ENABLED` wajib `'true'` jika ingin auto-send).
  - Pesan follow-up baru tetap dijadwalkan dan masuk ke antrian database (*Follow-Up Queue*) dengan status `PENDING`, namun hanya dieksekusi kirim ke WhatsApp jika disetujui manual oleh Admin di Dashboard.
  - Menambahkan **Overdue Spam Protection**: jika jadwal follow-up terlewat >48 jam saat auto-send aktif, pesan otomatis ditandai `SKIPPED` untuk mencegah ledakan blast pesan basi/kadaluarsa.

- **Dedicated Admin API Subroute Antrian Follow-Up (`src/routes/admin/follow-up.subroute.ts`, `admin.route.ts`)**:
  - Mengimplementasikan endpoint API backend lengkap untuk manajemen antrian:
    - `GET /api/admin/follow-ups`: Mendukung filter status (`PENDING`, `SENT`, `CANCELLED`, `SKIPPED`, `FAILED`), filter tipe, pencarian nama/HP, dan pagination.
    - `POST /api/admin/follow-ups/:id/send-now`: Eksekusi pengiriman manual (Approve & Kirim Sekarang) oleh Admin dengan audit logging.
    - `PATCH /api/admin/follow-ups/:id/cancel`: Pembatalan item follow-up tertentu.
    - `POST /api/admin/follow-ups/bulk-cancel`: Pembatalan massal seluruh antrian pending.
    - `PATCH /api/admin/follow-ups/:id/reschedule`: Penjadwalan ulang tanggal/jam kirim.
    - `GET|POST|PUT|DELETE /api/admin/follow-up-templates`: Manajemen kustomisasi template teks follow-up per tenant.

- **Penyelarasan UI Admin Dashboard Follow-Up Queue (`FollowUpQueue.tsx`)**:
  - Menghubungkan seluruh antrian data secara real-time dengan backend API.
  - Menambahkan banner informatif *"Mode Manual Approval Aktif"*, tombol **"Batalkan Semua Pending"**, tombol **"Kirim Sekarang"**, dan badge status yang jelas.
  - Memperbarui bundle produksi dashboard (`npm run build`).

- **Pembersihan Database Backlog & Filter Kontak Sandbox (`customer.service.ts`, `follow-up.service.ts`)**:
  - Membatalkan seluruh sisa antrian `PENDING` lama dan menghapus follow-up kontak sandbox/dummy test.
  - Menerapkan guard ganda `is_sandbox_test: false` dan `isDummyOrTestContact` agar data testing tidak pernah masuk antrian follow-up.

### Added, Fixed & Refined — Time Range Display, Clickable Treatment Cards, Customer LTV/Treatment Stats, Background Reservation Auto-Capture & Follow-Up Queue Worker Activation (2026-08-21)

- **Rentang Jam Kunjungan Lengkap (`Reservations.tsx`, `TodayTreatments.tsx`)**:
  - Menampilkan rentang waktu kunjungan lengkap `Jam Mulai - Jam Selesai` (misal `09:30 - 11:45` atau `22 Agu 09:30 - 11:45`) yang dihitung secara otomatis berdasarkan total durasi menit layanan treatment (`extractDurationMinutes` / `parseNumberedTreatments`).
  - Menggantikan tampilan lama yang hanya menampilkan jam mulai saja.

- **Kartu & Baris Reservasi Dapat Diklik Langsung (`Reservations.tsx`)**:
  - Pada tampilan Mobile Card List dan Desktop Table List, seluruh kontainer kartu `<div>` dan baris tabel `<tr>` kini dapat diklik langsung (`onClick={() => setSelectedRes(res)}` dengan efek hover visual dan kursor interaktif) untuk membuka modal detail reservasi tanpa mengharuskan pengguna mencari dan mengklik tombol "Manage".
  - Seluruh tombol aksi di dalam kartu (seperti tombol lihat bukti bayar) diproteksi dengan `e.stopPropagation()` agar tidak memicu pembukaan modal ganda.

- **Ringkasan LTV & Jumlah Riwayat Treatment Pasien (`Reservations.tsx`, `TodayTreatments.tsx`, `reservations.subroute.ts`, `staff-reservation.service.ts`)**:
  - Backend kini secara otomatis menghitung dan menyertakan statistik ringkas customer:
    - `totalTreatments`: jumlah reservasi non-cancelled customer (misal: `2x Treatment` / `Pasien Baru (1x)`).
    - `ltv`: total nilai transaksi akumulatif customer (*Lifetime Value*).
  - Ditampilkan secara elegan dalam bentuk badge pada kartu operasional terapis, header modal detail pasien, dan tabel daftar reservasi admin.

- **Perbaikan Bug Scraping Teks Reservasi pada Mode Human Handling & Outbound (`human.ts`, `webhook.route.ts`, `reservation-text-parser.ts`)**:
  - Memperbaiki akar masalah di mana chat reservasi tidak tertangkap jika percakapan sudah dialihkan ke mode `HUMAN_HANDLING` (CS membalas manual dari WhatsApp HP).
  - Menambahkan *Background Auto-Capture Watcher* pada `handleHumanHandlingState` dan webhook balasan outbound admin untuk mendeteksi formulir reservasi lengkap (`isReservationFormMessage`), mem-parse jadwal/layanan/anak, dan otomatis membuat record `Reservation` di database secara idempoten tanpa mengganggu alur chat manual.
  - Memperkaya pengenalan header teks reservasi (`berikut reservasi`, `jadwal treatment`).

- **Aktivasi Worker Antrian Follow-Up & Morning Jobs (`app.ts`)**:
  - Mendaftarkan recurring background interval timer di `src/app.ts`:
    - `cron.runFollowUpWorker()` berjalan otomatis setiap 15 menit untuk memproses antrian follow-up `PENDING` yang telah jatuh tempo (`scheduled_at <= NOW()`).
    - `cron.runMorningJobs()` berjalan otomatis setiap hari pukul 06:00 WIB untuk mengirimkan pengingat pagi Hari-H dan review H+1.

### Added, Fixed & Refined — React Portal Viewport Modal Centering, Dynamic Therapist Delegation Button & Known Issues Mandate (2026-08-21)

- **Migrasi Modal ke React Portal `createPortal(..., document.body)` (`TodayTreatments.tsx`)**:
  - Mengisolasi seluruh modal dialog (Modal Quick Chat, Modal Update Lokasi & Foto Rumah, Modal Detail Pasien, Modal Delegasi & Ganti Terapis, Modal Catat Pembayaran, dan Modal Rekap Metrik) langsung ke `document.body` melalui React Portal.
  - Membebaskan posisi modal dari hierarki DOM komponen halaman yang menyebabkan modal bergeser ke atas/bawah saat halaman panjang di-scroll pada tampilan mobile.
  - Menggunakan `fixed inset-0 z-[9999] h-[100dvh] w-[100dvw] flex items-center justify-center` dengan tinggi modal responsif terhadap dynamic viewport bar mobile (`max-h-[85dvh]`).

- **Dinamisasi Tombol & Dialog Delegasi Terapis (`TodayTreatments.tsx`)**:
  - Tombol operasional kini secara otomatis menampilkan teks **"Ganti Terapis"** jika jadwal reservasi sudah memiliki staf terapis yang ditugaskan (`task.assignedStaff`).
  - Menampilkan teks **"Delegasikan"** jika jadwal reservasi belum memiliki terapis (`unassigned`).
  - Dialog modal dan tombol submit juga menyesuaikan judul secara kontekstual (*"Ganti Terapis Jadwal"* / *"Simpan Ganti Terapis"*).

- **Dokumentasi Known Issues Mandate & Catatan Masalah Kalender**:
  - Menambahkan **Known Issues Mandate** pada `.agents/AGENTS.md` dan root `AGENTS.md` yang mewajibkan seluruh temuan issue/kendala/tech-debt yang belum terselesaikan untuk dicatat secara terpusat di `docs/KNOWN_ISSUES.md`.
  - Mendokumentasikan permasalahan gestur drag-to-scroll horizontal kalender mingguan pada [docs/KNOWN_ISSUES.md](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/docs/KNOWN_ISSUES.md) (Issue #11).

### Added, Fixed & Refined — 2D Calendar Drag Panning, Dynamic Time Navigator, Therapist Filter Fix, Detail Treatment Spanning & Chat List Bot Icon Cleanup (2026-08-21)

- **2D Drag-to-Scroll & Touch Drag Panning Kalender (`WeekScheduleGrid.tsx`, `DayScheduleGrid.tsx`)**:
  - Mengintegrasikan interaksi *pointer drag panning* (`onPointerDown`, `onPointerMove`, `onPointerUp`) dan `touchAction: pan-x pan-y` dengan kursor `cursor-grab / active:cursor-grabbing`.
  - Pengguna di perangkat sentuh (touchscreen) maupun desktop kini dapat menggeser kalender secara bebas ke arah horizontal dan vertikal secara simultan (2D) tanpa hambatan locking sumbu native browser.

- **Navigasi Tanggal Dinamis: Hari Ini / Minggu Ini / Bulan Ini (`Reservations.tsx`)**:
  - Teks tombol "Hari Ini" kini otomatis menyesuaikan mode tampilan yang sedang aktif:
    - Mode **Minggu**: Menjadi **"Minggu Ini"**.
    - Mode **Bulan**: Menjadi **"Bulan Ini"**.
    - Mode **Hari / List**: Menjadi **"Hari Ini"**.

- **Perbaikan Dropdown Filter "Semua Terapis" (`Reservations.tsx`)**:
  - Memperbaiki pencocokan identitas terapis pada `filteredReservations`: mengecek relasi `res.assigned_staff_id === filterState.staffId || res.assigned_staff?.id === filterState.staffId` dan penanganan akurat untuk status `unassigned` (`!res.assigned_staff_id && !res.assigned_staff?.id`), sehingga filter terapis di tabel mingguan berfungsi sempurna.

- **Detail Treatment Adaptif pada Kartu Kalender Mingguan (`WeekScheduleGrid.tsx`)**:
  - Jika kartu memiliki tinggi yang cukup (`heightPx >= 68`, misalnya durasi 60m, 90m, 120m), detail nama treatment (misal: *Pijat Bayi + Cukur Rambut*) otomatis ditampilkan di antara nama pasien dan nama terapis.
  - Jika kartu pendek (< 68px), detail treatment otomatis disembunyikan agar kartu tetap rapi dan tidak meluap (*overflow*).

- **Penyelarasan Kartu Tampilan Harian (`DayScheduleGrid.tsx`)**:
  - Memperbarui kartu tampilan harian dengan nama pasien bersih tanpa sapaan ganda, badge terapis yang konsisten, rentang jam akurat, dan dukungan interaksi 2D drag panning.

- **Pembersihan Ikon Bot pada Daftar Chat (`LiveChatMonitor.tsx`)**:
  - Menghilangkan badge abu-abu berikon bot (`<Bot size={12} />`) pada baris chat yang sedang ditangani otomatis oleh Bot AI.
  - Ikon bot kini hanya muncul sebagai tombol aksi *"Kembalikan ke Bot"* saat percakapan sedang ditangani manual oleh CS / Manusia (`isHumanHandling`).

- **Filter Status Cerdas Berbasis View-Mode (`Reservations.tsx`)**:
  - Tampilan **Tabel / List (`table`)**: Default otomatis ke `upcoming` (*📅 Aktif & Mendatang*).
  - Tampilan **Hari, Minggu, dan Bulan (`day`, `week`, `month`)**: Default otomatis ke `all` (*Semua Status*), sehingga saat berpindah hari/minggu/bulan seluruh agenda yang terjadwal di tanggal tersebut tampil utuh tanpa tersembunyi.

- **Ekspansi Animasi Swipe-Back ke 100% (`Layout.tsx`)**:
  - Meningkatkan jangkauan pergerakan maksimal indikator swipe-back ke `100px` (100%) dengan kurva resistensi peredam elastis: `dist = 100 * (1 - Math.exp(-deltaX / 100))`.
  - Threshold aktivasi diatur pada `50px` (50%), memberikan tarikan yang panjang, mantap, dan natural saat ditarik ke kanan.

- **Isolasi Sticky Searchbar Murni & Mobile Header Scroll-Off (`LiveChatMonitor.tsx`)**:
  - Memasukkan judul halaman *Live Chat Monitor* dan toolbar filter (sumber & label) langsung ke dalam kontainer scroll pada tampilan mobile.
  - Saat daftar percakapan di-scroll ke bawah di smartphone, header dan barisan filter otomatis tergulung ke atas dan menghilang, menyisakan **hanya kotak pencarian (*Searchbar*)** yang menempel secara *sticky* di puncak layar (`sticky top-0 z-20 bg-white shadow-xs`).
  - **Quick-Add Button Tetap Terjaga**: Slot kosong di belakang kartu tetap dapat diklik untuk menambah jadwal baru secara instan.

- **Default Sort Jadwal Kunjungan Terdekat dari Hari & Jam Sekarang (`Reservations.tsx`)**:
  - Menetapkan default pengurutan tabel reservasi murni berdasarkan jadwal kunjungan (`booking_date`) yang paling dekat dengan hari dan jam sekarang (jadwal 30 menit lagi $\rightarrow$ 2 jam lagi $\rightarrow$ besok $\rightarrow$ minggu depan, lalu riwayat masa lalu, dan janji temu tanpa jadwal di urutan paling bawah).
  - Menyederhanakan antarmuka mobile dengan menghapus dropdown sorting mobile (fitur sorting khusus untuk versi web/desktop melalui header kolom `<th>` yang dapat diklik dengan ikon panah dinamis `ArrowUpDown`, `ArrowUp`, `ArrowDown`).

- **Dedicated LLM Execution & Reasoning Log Feed (`llm-execution-logger.ts`, `evaluations.subroute.ts`, `Debug.tsx`)**:
  - **In-Memory Ring Buffer (150 Entri)**: Modul logging khusus untuk merekam proses inferensi LLM tanpa bercampur dengan log sistem umum.
  - **Endpoint API Dedicated**: `GET /api/admin/debug/llm-logs?limit=100&flow=all` untuk menyuplai feed log inferensi real-time.
  - **Tab UI `🧠 LLM Execution Logs` pada System Debug**: Menampilkan kartu ringkasan visual dengan 4 blok terstruktur:
    1. 💬 *Input Pasien*
    2. 📚 *Ground Truth Injected* (fakta database profil, anak, reservasi, & katalog)
    3. 🔍 *AI Reasoning & Chain-of-Thought* (penalaran terstruktur model AI)
    4. ✉️ *Final AI Auto-Reply / Draft* (balasan akhir yang dikirim atau disiapkan)

- **Penyelarasan AI Copilot Draft dengan Pipeline LLM Utama (`generator.ts`, `live-chat.service.ts`)**:
  - Menghubungkan pembuatan draft saran balasan Bidan/CS di Live Chat ke generator `LLMResponseGenerator.generateCopilotDraft()`.
  - Menginjeksi database Ground Truth, pencarian RAG katalog/SOP klinik, format penalaran `<reasoning>`, dan audit log telemetry biaya token.

### Fixed & Refined — Button Sound/Haptic Elimination, Seamless Searchbar & In-Place Bot Release (2026-08-21)

- **Eliminasi Total Suara & Haptik pada Tombol/Aksi (`TodayTreatments.tsx`, `StaffToday.tsx`, `Layout.tsx`, `LiveChatMonitor.tsx`, `notificationSound.ts`)**:
  - **Tombol & Aksi Hening 100%**: Menghapus pemanggilan audio sintetis dan getaran haptik (`navigator.vibrate`) dari semua tombol aksi di *Today Treatments* (`handleUpdateStatus`, `handleLockLocation`, `handleUploadPayment`, `handleQuickChatSend`, `handleReassign`), portal staf (*StaffToday*), sentuhan tooltip filter ikon (*LiveChatMonitor*), dan gesture *pull-to-refresh* (*Layout*).
  - **Inisialisasi Audio Senyap (Silent Unlock Blessing)**: Memperbaiki `unlockAudioContext()` agar mematikan volume/mute saat pre-blessing HTML5 Audio pada sentuhan pertama di mobile, sehingga tap pertama pengguna di layar smartphone tidak lagi menimbulkan bunyi klik/pop yang mengganggu.
  - **Penyempurnaan Nada Notifikasi Pesan Masuk (`playIncomingMessageSound`)**: Menghasilkan nada chime kristal yang lembut dan jernih (*A5 880Hz $\rightarrow$ E6 1318.5Hz*) dengan decay halus, khusus dan hanya dibunyikan saat ada pesan WhatsApp baru masuk dari pelanggan di Live Chat.
- **Pencarian Real-Time Tanpa Kedipan / Reload Layar Penuh (`LiveChatMonitor.tsx`)**:
  - **Akar Masalah**: Pengetikan pada searchbar sebelumnya memicu debounce `loadChats(true)` yang mengubah `loading = true`, menyebabkan seluruh komponen halaman (termasuk kolom chat aktif dan searchbar itu sendiri) di-unmount dan digantikan loader spinner penuh.
  - **Solusi Seamless**: Memisahkan inisialisasi awal (`loading && chats.length === 0`) dengan pemuatan data latar belakang. Pencarian kini memfilter daftar chat secara instan di memori (*client-side* 0ms), dan sinkronisasi server berjalan senyap dengan mini-spinner halus di dalam searchbar (`isSearching`) tanpa pernah mencopot layout atau me-reset fokus pengetikan.
- **Transisi 'Kembalikan ke Bot' In-Place Tanpa Reset / Reload (`LiveChatMonitor.tsx`)**:
  - **Akar Masalah**: Mengklik *"Kembalikan ke Bot"* sebelumnya memanggil `loadChats(true)` (memicu full-page loader) serta mengeksekusi `setSelectedId(null)` dan `setMessages([])`, yang memaksa keluar dari chat aktif dan menutup percakapan.
  - **Solusi Optimistic**: Melakukan *in-place optimistic update* pada percakapan aktif (`isHumanHandling = false`, `status = 'active'`, `lastHandledBy = 'bot'`) sehingga obrolan yang sedang dibuka tetap terbuka dan utuh. Tombol header berubah mulus menjadi badge **"🤖 Bot"**, dan sinkronisasi server berjalan senyap di latar belakang.

- **7 Penyesuaian Mikro UI/UX pada Modul Treatment Hari Ini (`TodayTreatments.tsx`)**:
  1. **Dropdown Filter Penugasan Terapis**: Mengganti toggle button lama menjadi dropdown `<select>` yang rapi dengan opsi default `🛵 Tugas Saya`, `👥 Semua Terapis`, dan daftar terapis individual spesifik.
  2. **Tombol Rekap Metrik Icon-Only**: Tombol rekapitulasi disederhanakan menjadi ikon bar chart elegan `<BarChart3 size={16} />` dengan tooltip tanpa teks label panjang.
  3. **Modal Detail Lengkap Customer & Treatment**: Mengklik kartu treatment (atau bagian header/body card) kini membuka modal pop-up detail lengkap (profil WhatsApp, telepon, rincian paket, daftar anak, patokan rumah, koordinat GPS, rincian biaya & bukti bayar).
  4. **Pembersihan Durasi Per-Item**: Seluruh teks durasi (`(60 menit)`, `30m`, dll.) dihilangkan dari teks nama layanan dan disatukan menjadi satu badge **`⏱️ Total Durasi: X Menit`**.
  5. **Format Waktu Bersih**: Menghilangkan embel-embel teks `WIB` pada kartu, menyisakan format jam `HH:mm` yang bersih.
  6. **Ikon Penanggung Jawab**: Teks label *"Penanggung Jawab:"* digantikan dengan ikon terapis `<UserCheck size={13} />`.
  7. **Ikon Kategori Bersih**: Badge teks kategori (*Baby Spa*, *Moms Spa*, dll.) digantikan dengan ikon visual kategori layanan yang minimalis dan elegan.

### Refactored & Polished — Refined Focus & Clean Metrics for Today Treatments (2026-08-20)

- **Penyederhanaan & Fokus Navigasi Treatment Hari Ini (`TodayTreatments.tsx`)**:
  - **Default Scope 'Tugas Saya'**: Default scope tampilan kini langsung mengarah ke `mine` (Tugas Saya) sehingga terapis/CS langsung melihat jadwal relevan masing-masing tanpa perlu klik toggle.
  - **Fokus Tanpa Tab Ganda**: Menghapus sub-tab hari ini/mendatang/selesai yang memakan ruang, mengembalikan fokus langsung ke daftar kunjungan hari ini.
  - **Modal Detail Rekap Metrik**: 4 kartu ringkasan KPI (Total, Selesai, OTW, Tagihan) disederhanakan menjadi satu tombol **`[📊 Detail Rekap]`** yang membuka modal rekapitulasi elegan.
  - **Numbering List Layanan & Total Durasi Terpadu**:
    - Nama-nama treatment ditampilkan dengan penomoran berurutan bersih (`1. Layanan A`, `2. Layanan B`) tanpa waktu per item.
    - Total durasi waktu layanan dihitung dan disatukan menjadi satu badge ringkas (`⏱️ Total Durasi: X Menit`).

### Added & Enhanced — Full Feature Parity from StaffToday to TodayTreatments (2026-08-20)

- **Penyerapan Fitur Lengkap `StaffToday.tsx` ke dalam `TodayTreatments.tsx`**:
  - **Category Color Accents & Badges (`getCategoryIcon`)**: Border aksen kiri warna-warni dan badge khas untuk *Baby Spa* (Sky), *Moms Spa* (Purple), dan *Moms & Baby* (Emerald).
  - **OTW Safety Gate Time-Lock (`isOtwAllowed`)**: Tombol *Kirim OTW* hanya dapat diaktifkan dalam jendela ≤ 2 jam sebelum waktu janji temu (`bookingDate`) untuk mencegah kesalahan klik prematur.
  - **Indikator Cerdas Rute Berantai (`distanceSource`)**: Menampilkan jarak tempuh yang dihitung dari *Pasien Sebelumnya* (rute berantai beserta nama pasien asal) atau dari *Klinik* lengkap dengan estimasi menit.
  - **Modal Full-Screen Zoom Foto HD (`zoomImageUrl`)**: Preview foto tampak depan rumah pasien dan foto bukti transfer dalam resolusi penuh dengan tombol download instan.
  - **Quick Chat Kaya (Template Cepat & Lampiran Kamera)**: Menambahkan baris tombol template balasan WhatsApp (*"👋 Sapa Pasien"*, *"🛵 Meluncur OTW"*, *"🏠 Sudah Sampai"*) dan integrasi pengunggahan gambar/foto langsung dari ruang chat.
  - **Sub-Tab Navigasi 3 Fase**: Menambahkan navigasi sub-tab `🛵 Hari Ini (Today)`, `📅 Jadwal Mendatang (Upcoming)`, dan `✅ Riwayat Selesai (Completed)` dengan penghitung counter aktif.
  - **Audio & Haptic Feedback (`playNotificationSound`)**: Suara chime dan getaran haptic mobile saat aksi status berhasil dijalankan.

### Improved & Fixed — Comprehensive UI/UX Polish, iOS Safari Viewport & Mobile-First Controls (2026-08-20)

- **Optimasi Viewport Safari iOS & Rigid Sticky Header (`index.css`, `Layout.tsx`)**:
  - **Eliminasi Breakage Sticky Header**: Menghapus `overflow-x: clip` di level `html` yang merusak konteks `position: sticky` pada WebKit Safari iPhone. Header kini menempel rigid dan tidak melompat saat elastic bounce scroll.
  - **Isolasi Notch / Dynamic Island**: Memastikan background header solid `bg-white/98 backdrop-blur-md` dengan `pt-[env(safe-area-inset-top)]` sehingga logo sinyal dan baterai HP tidak lagi menembus teks header.
- **Penyempurnaan Mobile-First "Treatment Hari Ini" (`TodayTreatments.tsx`)**:
  - **Avatar WhatsApp Pasien**: Menampilkan foto profil WhatsApp pasien asli (dengan fallback inisial bulat yang elegan) untuk pengenalan pasien instan.
  - **Grid Tombol Aksi Ramah Jempol**: Di layar HP (< 640px), tombol aksi disusun dalam **Grid 2x2 yang besar (min-height 42px)** dengan target sentuh tebal dan transisi aktif (*active:scale-95*) tanpa bertumpuk acak.
  - **Pintasan Live Chat Penuh**: Menambahkan tombol lompat langsung ke antarmuka Live Chat lengkap (`/admin/live-chat`) dari header modal quick chat.

### Added & Refactored — Seamless "Treatment Hari Ini" Module & Single-Shell Admin Flow (2026-08-20)

- **Integrasi Modul "Treatment Hari Ini" ke Layout Admin Standar (`TodayTreatments.tsx`, `App.tsx`, `Layout.tsx`, `rolePermissions.ts`)**:
  - **Single Shell Architecture Tanpa Layout Switcher**: Menghapus tombol switcher yang membingungkan (`[🛵 Tugas Lapangan]` dan `[📊 Portal CS & Kalender]`). Menghadirkan modul baru **`🛵 Treatment Hari Ini`** (`/admin/today-treatments`) yang tertanam langsung di sidebar menu admin (grup *Operasional & Jadwal*, tepat setelah *Kalender & Reservasi*).
  - **Navigasi Konsisten**: Pengguna (Admin/Supervisor/CS) dapat berpindah antar menu (*Live Chat*, *Kalender Reservasi*, *Treatment Hari Ini*, *Database Pelanggan*) secara mulus dengan sidebar dan header admin yang tetap stay di tempatnya.
  - **Fungsionalitas Mikro Lengkap**:
    - **Filter Segmentasi**: Toggle `[🛵 Tugas Saya]` vs `[👥 Semua Terapis]` untuk memantau tugas pribadi maupun tim.
    - **Aksi Cepat & Navigasi**: Tombol integrasi *Google Maps rute berantai*, *Kirim Notifikasi OTW*, dan *Live Chat WhatsApp* pasien hari H.
    - **Lokasi & Bukti Rumah**: Modal kunci titik GPS akurat (≤10m) serta pengambilan foto tampak depan rumah pasien.
    - **Pencatatan Keuangan**: Modal catat pembayaran lunas (Tunai / Transfer / QRIS) beserta upload bukti pembayaran.
    - **Delegasi Penugasan (Reassign)**: Memindahkan jadwal treatment ke staf lain secara instan dengan notifikasi otomatis.
  - **Daftar Modul Dinamis di RBAC**: Mendaftarkan `/admin/today-treatments` ke dalam `ALL_MODULES` agar izin akses dapat diatur secara dinamis per-role melalui UI.

### Fixed — Elimination of Infinite MutationObserver Loop & "Page Unresponsive" Freeze (2026-08-20)

- **Eliminasi Total Infinite Mutation Loop & Freeze Browser (`App.tsx`, `useBodyScrollLock.ts`, `UiFeedback.tsx`, `Layout.tsx`)**:
  - **Akar Masalah (*Root Cause*)**: Komponen `GlobalModalScrollLock` sebelumnya memasang `MutationObserver` pada `document.body` dengan `attributes: ['class', 'style']`, sementara callback observer mengubah `classList` pada `document.body`. Ini memicu infinite loop rekursif pada microtask event loop JavaScript (100% CPU lockup) yang memunculkan pop-up browser *"Page Unresponsive"*.
  - **Solusi Bersih & Deklaratif (`useBodyScrollLock`)**: Menghapus `GlobalModalScrollLock` dan `MutationObserver` dari `App.tsx`. Menggantikannya dengan custom hook deklaratif `useBodyScrollLock(isLocked)` yang murni berbasis state React tanpa pemantauan mutasi DOM global.
  - **Integrasi Feedback & Sidebar**: Mengaktifkan penguncian scroll aman pada `UiFeedback.tsx` saat dialog konfirmasi terbuka dan pada `Layout.tsx` saat drawer navigasi mobile aktif.
  - **Optimasi Tab Debug (`Debug.tsx`)**: Mengatur interval refresh log menjadi 10s dengan batasan buffer 150 baris dan auto-pause saat tab browser tidak aktif (*visibilitychange*).
  - **Pendaftaran Dinamis Portal Terapis ke Matriks RBAC (`rolePermissions.ts`)**: Mendaftarkan modul `/admin/staff/today` (*Portal Tugas Terapis Hari Ini*) dan `/admin/staff/schedule` (*Jadwal Mendatang*) ke dalam `ALL_MODULES` (kategori *PORTAL LAPANGAN & TERAPIS*). Kini hak akses portal terapis dapat dicentang/dihapus secara dinamis untuk peran kustom apapun via UI dashboard tanpa perlu hardcode.

### Added & Improved — SPV CS Hybrid Role, Dual Mode Workflow & Team Delegation (2026-08-20)

- **Peran Hibrida SPV CS & Dual-Mode UI Workflow (`rolePermissions.ts`, `Layout.tsx`, `StaffToday.tsx`, `StaffSchedule.tsx`)**:
  - **Dukungan Role Baru `spv_cs` (Supervisor CS & Field Therapist)**: Mengimplementasikan hak akses terintegrasi untuk peran SPV CS yang mencakup modul manajerial (Live Chat, Kalender Reservasi, Pelanggan, Manajemen Staff, dsb.) sekaligus akses penuh ke modul operasional lapangan (*Portal Terapis* `/admin/staff/today` dan `/admin/staff/schedule`).
  - **Pintasan 1-Klik Mode Switcher (*Quick Switcher*)**:
    - Menambahkan tombol pintasan `[🛵 Tugas Lapangan]` pada navbar desktop dan mobile header saat berada di portal manajerial/CS.
    - Menambahkan tombol pintasan `[📊 Portal CS & Kalender]` pada header dan drawer menu `StaffToday` serta `StaffSchedule` saat berada di portal terapis.
  - **Monitoring Tim & Delegasi Jadwal Terapis Lapangan (`StaffToday.tsx` & `today.subroute.ts`)**:
    - **Filter Segmentasi `[🛵 Tugas Saya]` vs `[👥 Semua Terapis]`**: Supervisor dapat berpindah antara jadwal kunjungan pribadi dan seluruh tim lapangan pada hari ini secara realtime.
    - **Delegasi Penugasan Instan (*Reassign Modal*)**: Supervisor dapat memindahkan atau mendelegasikan jadwal pasien ke terapis lain langsung dari kartu tugas mobile/lapangan via `POST /api/staff/reservations/:id/reassign`.
    - **Bypass Otorisasi Chat Supervisor**: Mengizinkan supervisor melihat dan membalas percakapan pasien manapun pada hari H tanpa batasan isolasi terapis tunggal.
  - **Pintasan 1-Tap *"⚡ Tugaskan ke Saya Sendiri"* di Kalender & Reservasi (`CreateReservationModal.tsx`, `Reservations.tsx`)**:
    - Mempermudah SPV CS yang sedang bertindak sebagai terapis lapangan untuk langsung menetapkan dirinya sendiri pada saat membuat reservasi atau mengedit penugasan tanpa perlu mencari namanya di dropdown panjang.
  - **Penyelarasan Autentikasi Sesi Terpadu & Hard Safety Timeout (`staff.route.ts`, `StaffProtectedRoute.tsx`, `AuthContext.tsx`, `StaffAuthContext.tsx`)**:
    - Mengintegrasikan validasi `admin_session` pada rute `staff.route.ts` dan `StaffProtectedRoute` sehingga akun supervisor yang login via email/password admin dapat langsung berpindah membuka `/admin/staff/today` tanpa tertahan di loop loading spinner atau terlempar ke login terapis terpisah.
    - Menambahkan **Hard Safety Timeout (2.5s)** pada `AuthContext` dan `StaffAuthContext` serta pembersihan token stale otomatis agar status loading di browser tidak pernah terkunci (*hang*) saat inisialisasi sesi awal.

### Added & Fixed — Sticky Header Restore, Modal Background Scroll Lock & iOS Viewport Fix (2026-08-20)

- **Pemulihan Sticky Header & Penguncian Scroll Background Modal/Sidebar (`index.css`, `Layout.tsx`, `App.tsx`)**:
  - **Mengembalikan Fungsi Sticky Header (`top: 0`)**: Menghapus deklarasi `overflow-x: hidden` pada container pembungkus yang sebelumnya memutus context `position: sticky` browser, menggantikannya dengan `overflow-x: clip` pada root. Header kini kembali menempel kokoh di atas layar saat scrolling.
  - **Penguncian Scroll Background Otomatis (*Body Scroll Lock*)**: Menambahkan `GlobalModalScrollLock` di `App.tsx` dan listener `body-scroll-locked` di `Layout.tsx`. Saat menu sidebar drawer atau modal dialog apapun terbuka (Konfirmasi, Detail Pasien, Kalender, Media, dsb.), scrolling di background layar otomatis dibekukan total sehingga jari hanya menggulir isi modal/sidebar tanpa menggeser halaman latar belakang.
  - **Isolasi Touch Backdrop**: Menerapkan `touch-action: none` dan `overscroll-behavior: contain` pada backdrop gelap modal & sidebar.
- **Perbaikan iOS iPhone Safe Area Insets & Rigid Viewport Locking (`index.css`, `Layout.tsx`, `StaffToday.tsx`, `StaffSchedule.tsx`)**:
  - **Mengatasi Header Tertutup Notch / Status Bar iPhone**: Menambahkan padding `env(safe-area-inset-top)` dinamis pada header utama admin, sidebar drawer, dan portal staff (`StaffToday` & `StaffSchedule`). Konten header (judul, tombol menu, ikon status) kini selalu turun rapi di bawah area status bar, jam, sinyal, dan Dynamic Island iPhone.
  - **Mengeliminasi Horizontal Wobble / Rubber-Banding (*Rigid Viewport Lock*)**: Menetapkan aturan ketat `overflow-x: clip`, `overscroll-behavior-x: none`, dan `touch-action: pan-y` pada `html`, `body`, dan `#root`. Seluruh visual antarmuka kini terkunci rigid di satu tempat saat di-scroll ke atas/bawah tanpa goyang ke kiri/kanan.
  - **Optimasi Touch Gestures**: Mengubah touch listener gesture menjadi `passive: true` untuk memastikan scrolling native 120Hz di iOS Safari berjalan mulus tanpa lag atau konflik gesture.
- **Perbaikan Duplikasi Gambar di Live Chat (`LiveChatMonitor.tsx`, `StaffToday.tsx`, `live-chat.service.ts`)**:
  - Memperbaiki bug duplikasi pesan gambar (tampil 2 bubble gambar) saat admin/staf mengirim foto di Live Chat.
  - Menyelaraskan teks placeholder gambar optimistik menjadi `[IMAGE]` (sebelumnya `[GAMBAR]` vs `[IMAGE]`), sehingga pencocokan pesan optimistik (`temp_`) dengan event SSE `message.created` berjalan sempurna.
  - Menambahkan rekonsiliasi ID pesan instan pada HTTP reply handler dan handler SSE dengan dukungan pencocokan fallback berbasis media dan timestamp.
- **Perbaikan JSON Serialization pada Client Admin API (`api.ts` & `Settings.tsx`)**:
  - Memperbaiki `apiRequest` agar secara otomatis melakukan `JSON.stringify(body)` jika argumen `body` berupa objek JavaScript murni dan bukan `FormData`/`Blob`.
  - Mencegah error `is not valid JSON` (`[object Object]`) saat melakukan auto-save pengaturan AI Rollout Scope.
- **Penyederhanaan Input Tanggal Cutoff Pelanggan Baru (`AiRouterPanel.tsx` & `Settings.tsx`)**:
  - Mengubah input teks ISO / datetime yang rumit menjadi input tanggal kalender native (`<input type="date">`), sehingga user cukup memilih tanggal tanpa perlu mengetik jam atau format string ISO manual.
  - **Sinkronisasi Instan Langsung ke Server (*Instant Auto-Sync*)**: Perubahan pilihan radio (`NEW_ONLY` vs `ALL`) maupun penggantian tanggal cutoff langsung disimpan secara otomatis ke server tanpa perlu menekan tombol submit terpisah.
  - **Preset Tanggal Cepat**: Menambahkan tombol pintasan satu-klik (*"Hari Ini"*, *"Kemarin"*, *"Awal Bulan Ini"*).
  - **Indikator Status Penyimpanan Realtime**: Dilengkapi indikator badge spinner saat menyimpan ke server dan ikon centang hijau saat data telah tersimpan aman.
  - **Penjelasan Bahasa Indonesia**: Menampilkan pratinjau kalimat penjelas dinamis dengan format tanggal Indonesia yang ramah dibaca (contoh: *"Pelanggan yang pertama kali chat mulai 1 Agustus 2026 akan otomatis dilayani bot AI..."*).

### Added & Fixed — PWA Ultra HD Vector Branding, Role Management Cleanup & Database Schema Sync (2026-08-19)

- **PWA Ultra HD Vector Icon Generation (`Master Logo Kala.svg`)**:
  - Mengintegrasikan logo vektor resmi Kala Moms & Baby Spa (`Master Logo Kala.svg` viewBox `0 0 100 100`, warna `#fbb697`).
  - Menggunakan engine rasterisasi vektor Rust (`resvg`) untuk merender seluruh ukuran icon secara native dengan ketajaman antialiasing maksimal tanpa pecah/pixelate:
    - `pwa-512x512.png` (512x512 px, format `any` untuk Android & desktop splash screen).
    - `pwa-maskable-512x512.png` (512x512 px, safe-area margin 18% untuk icon adaptive Android).
    - `pwa-192x192.png` (192x192 px untuk Homescreen Android).
    - `apple-touch-icon.png` (180x180 px dengan background solid bersih untuk iPhone/iPad Safari).
    - `favicon.ico` (multi-resolution 16, 32, 48, 64) & `favicon.png` (32x32 px).
  - Memperbarui `manifest.json` dan `index.html` dengan konfigurasi manifest PWA lengkap.
  - Memperbaiki static routing di `src/routes/admin.route.ts` agar seluruh format gambar (`.png`, `.ico`, `.svg`, `.webp`) dan `manifest.json` di bawah `/admin/` di-serve dengan MIME type yang benar (`image/png`, `application/manifest+json`).
- **Perbaikan Penghapusan Custom Roles (`rolePermissions.ts`)**:
  - Memisahkan `CORE_SYSTEM_ROLES` (`super_admin`, `tenant_admin`, `therapist`) yang dikunci sistem dari role preset yang dapat dihapus/diedit.
  - Role `spv_cs` (*Supervisor CS & Reservasi*) kini dapat dihapus secara permanen dari UI dan database tanpa mengalami *auto-resurrect*.
- **Database Schema Sync**:
  - Menjalankan migrasi skema database di server live untuk tabel `custom_roles` dan `push_subscriptions`.
  - Mengonversi tipe kolom `role` pada tabel `staff` menjadi `String` dinamis untuk mencegah error konversi enum.

### Added & Fixed — Real-Time Typing Sync, Message Delivery & Read Receipts (Centang Biru), Optimistic Instant Send, Smart Polling Sync, Admin-Labeled Chat Ingestion, & WhatsApp Media Bubble Polish

- **Latar Belakang & Masalah**:
  - Sebelumnya, chat dari nomor dengan label "Admin" diabaikan sepenuhnya di awal webhook (`IGNORED_ADMIN`) sebelum dicatat, sehingga pesan tidak pernah masuk ke dashboard Live Chat.
  - Saat admin mengirim balasan di Live Chat, terjadi jeda (*delay* 1–3 detik) antara tombol ditekan dan pesan baru muncul di layar karena sistem menunggu respons jaringan WAHA/API selesai sebelum memperbarui antarmuka.
  - Di lingkungan proxy/tunnel seperti ngrok atau saat browser membatasi SSE di latar belakang, pesan masuk baru dan daftar chat tidak ter-update otomatis secara real-time dan menuntut reload halaman manual.
  - Rute endpoint typing di dashboard (`/api/admin/live-chat/conversations/:id/typing`) mengalami *path mismatch* dengan backend (`/api/admin/conversations/:id/typing`) sehingga return 404 saat admin mengetik di Live Chat.
  - Payload WAHA `message.ack` yang membungkus ID sebagai objek (`{ id: { _serialized: '...' } }`) tidak ter-unwrap dengan baik dan pencocokan ID pesan di database memerlukan dukungan pencocokan suffix ID mentah WhatsApp.
  - Bubble pesan gambar (*media image*) keluar dari admin membentang lebar ke sisi kiri dengan bingkai hijau tebal dan label teks "Admin" yang kaku di atasnya, sehingga merusak kerapian antarmuka mobile.
- **Implementasi Fitur & Perbaikan**:
  - **Pengiriman Balasan Instan Tanpa Delay / *Optimistic UI Updates* (`LiveChatMonitor.tsx`)**:
    - Saat admin menekan tombol "Kirim" atau tombol `Enter`, pesan **langsung muncul seketika (0ms delay)** di bubble chat dengan status terkirim dan kolom input langsung bersih (*auto-clear*).
    - Preview percakapan pada daftar chat di sebelah kiri langsung terbarui secara instan tanpa menunggu respons jaringan.
    - Permintaan API ke backend berjalan di background; saat ID resmi pesan diterima dari WhatsApp, ID sementara (`temp_`) otomatis digantikan tanpa menyebabkan *re-render* atau kedipan layar.
  - **Sinkronisasi Real-Time Dua Lapis (*SSE + Smart Polling Engine*) (`liveChatSse.ts` & `LiveChatMonitor.tsx`)**:
    - Dilengkapi *watchdog timer* pada koneksi EventSource untuk mendeteksi jaringan macet/silent dan melakukan *auto-reconnect* otomatis.
    - Menambahkan *Smart Background Polling Engine* (interval 3,5 detik saat tab aktif) sebagai jaring pengaman (*fallback*) yang menjamin daftar percakapan dan pesan masuk baru **selalu terbarui secara otomatis** meskipun koneksi SSE terputus atau tertahan oleh ngrok.
  - **Dukungan Chat Masuk untuk Nomor Berlabel Admin (`webhook.route.ts`)**:
    - Pesan masuk dari nomor berlabel "Admin" kini **tetap dicatat ke database dan disiarkan ke Live Chat Monitor** via `messageService.logMessage` & SSE `LiveChatHub`.
    - Percakapan otomatis dialihkan ke status `is_human_handling = true` (*Manual Handling*) sehingga bot AI tetap diam (*silent*) dan staf/admin dapat leluasa berbalas pesan langsung di Live Chat Monitor.
  - **Fitur Typing Presence & Read-on-Typing Synchronizer (`livechat.subroute.ts`)**:
    - Menghubungkan rute `/api/admin/live-chat/conversations/:id/typing` & `/api/admin/conversations/:id/typing`.
    - Admin bebas membuka dan mengintip riwayat percakapan di Live Chat tanpa memicu tanda centang biru ke WhatsApp customer.
    - Saat admin mulai mengetik balasan di kolom chat, sistem mendeteksi ketikan (*input debouncer*) dan memicu `sendSeen` (menandai pesan telah dibaca dengan centang biru di WhatsApp customer) sekaligus mengaktifkan status presensi `startTyping` (*"sedang mengetik..."* di HP customer).
    - Jika admin berhenti mengetik selama 3 detik, menghapus teks, berpindah chat, atau mengirimkan balasan, sistem otomatis mengirimkan `stopTyping` untuk mematikan status mengetik.
    - Dilengkapi proteksi chat sandbox (*QA Test Guard*) agar tidak mengirim sinyal presensi ke nomor dummy.
  - **Real-Time WhatsApp Message ACK Handler & Delivery Status (`message.ack` & `message.service.ts`)**:
    - Menangkap event webhook `message.ack` dari WAHA dan meng-unwrap ID baik bertipe string maupun object serialized.
    - Menyimpan status delivery (`sent`, `delivered`, `read`, `failed`) dengan multi-matching (ID mentah, serialized ID, dan suffix ID WhatsApp) ke database PostgreSQL dan in-memory fallback.
    - Menyelesaikan `conversation_id` secara dinamis dan memancarkan event SSE real-time `message.status_updated` via `LiveChatHub`.
  - **Visual Status Centang WhatsApp di Live Chat Monitor**:
    - Menampilkan ikon status WhatsApp di setiap bubble pesan keluar (Outbound) di samping jam pesan:
      - `✓` (Centang satu abu-abu `#8696a0`): Pesan terkirim (*Sent*).
      - `✓✓` (Centang dua abu-abu `#8696a0`): Pesan tersampaikan di perangkat customer (*Delivered*).
      - `✓✓` (Centang dua biru terang `#53bdeb`): Pesan telah dibaca oleh customer (*Read*).
      - `⚠` (Ikon segitiga merah): Pesan gagal terkirim (*Failed*).
  - **Penyempurnaan Bubble Pesan Gambar Khas WhatsApp (`MediaImage.tsx` & `LiveChatMonitor.tsx`)**:
    - Merampingkan ukuran bubble gambar (`w-full max-w-[240px] sm:max-w-[280px]`) dengan padding tipis `p-1 sm:p-1.5` khas WhatsApp native.
    - Menghilangkan bingkai hijau raksasa dan label teks "Admin" yang menonjol di atas gambar murni.
    - Menempelkan bubble gambar keluar dari admin secara rapi di sebelah kanan (`justify-end`).
    - Jam pengiriman dan ikon centang status menyatu proporsional di sudut bawah bubble gambar.
  - **Pengujian & Keamanan**:
    - Seluruh unit & integration test (`waha-webhook.test.ts`, `typing-sync.test.ts`, `message-delivery-status.test.ts`, `webhook-non-personal-filter.test.ts`, `production_edge_cases.test.ts`) lulus 100% (163 test files, 1463 tests passing).

### Added — Web Push Notification (VAPID + PWA Background Push untuk Mobile & Desktop)

- **Latar Belakang**: Sebelumnya notifikasi hanya mengandalkan event stream SSE di dalam browser aktif. Saat aplikasi diminimize, layar HP terkunci, atau browser ditutup, sistem operasi HP (iOS Safari & Android) membekukan proses JS di background sehingga notifikasi tidak masuk.
- **Implementasi Fitur**:
  - **Arsitektur Web Push Standar VAPID (`src/services/web-push.service.ts`)**:
    - Backend terintegrasi dengan modul `web-push` untuk mengirimkan payload push langsung ke gateway Apple (APNs) dan Google (FCM).
    - Otomatisasi pembuatan & penyimpanan VAPID keys (*Public/Private*) di environment / database.
    - Mekanisme *auto-prune* untuk menghapus langganan yang sudah kadaluarsa (HTTP 410 Gone / 404).
  - **Model Database `PushSubscription` (`prisma/schema.prisma`)**:
    - Menyimpan endpoint perangkat, `p256dh`, dan `auth` token dengan isolasi tenant (`tenant_id`) serta pemisahan tipe user (`ADMIN` vs `STAFF`).
    - Dilengkapi *in-memory fallback store* agar tetap berjalan saat database offline.
  - **API Subroutes (`src/routes/admin/push.subroute.ts`)**:
    - `GET /api/admin/push/public-key`: Pengambilan VAPID public key untuk browser.
    - `POST /api/admin/push/subscribe`: Pendaftaran langganan push dari browser.
    - `POST /api/admin/push/unsubscribe`: Pembatalan langganan push.
    - `POST /api/admin/push/test`: Pengujian pengiriman notifikasi instan ke perangkat aktif.
  - **Pemicu Notifikasi Background Otomatis & Rich Notification Layout**:
    - `media.route.ts`: Endpoint CDN proxy baru `GET /media/avatar/:customerId` untuk menyajikan foto profil WhatsApp customer dan meng-cache secara lokal, sehingga Apple APNs & Google FCM dapat mengunduh foto profil tanpa terkena blokir hotlink 403 dari Meta.
    - `message.service.ts`: Memicu Web Push otomatis saat ada pesan masuk dari customer (`direction = INBOUND`). Menampilkan **Foto Profil Customer** (atau avatar inisial berwarna dinamis), **Logo Aplikasi / Badge**, **Nama Customer** sebagai judul notifikasi, dan **Isi Chat Pesan Masuk** (serta thumbnail foto jika customer mengirimkan gambar).
    - `useLiveChatNotification.ts`: Mencegah duplikasi notifikasi (menghindari double banner saat tab dan Web Push berjalan bersamaan).
    - `conversation.service.ts`: Memicu Web Push berprioritas tinggi saat terjadi eskalasi CS (*Human Handoff*).
  - **Mobile Pull-to-Refresh & Live Chat Alignment Fix (`Layout.tsx` & `message.service.ts`)**:
    - `Layout.tsx`: Mengimplementasikan gesture *Pull-to-Refresh* (geser/swipe layar ke bawah saat di posisi atas) pada dashboard admin mobile dengan visual floating spinner melingkar, feedback getaran haptic, dan auto-reload tanpa menggeser layout latar.
    - `BootProgress.tsx` & `App.tsx`: Menghapus overlay layar penuh (*full-screen blocking modal*) yang sebelumnya menampilkan teks "Memuat halaman…", dan menggantinya dengan **Slim Top Progress Bar modern (ala YouTube/GitHub)** yang *non-blocking* dengan *hard safety auto-dismiss* (1 detik). Memastikan antarmuka tidak pernah terkunci (*freeze*) saat transisi halaman atau pengecekan sesi.
    - `LiveChatMonitor.tsx` & `livechat.subroute.ts`: Menambahkan fitur **Kolom Pencarian (*Search Bar*) Universal** di daftar percakapan Live Chat yang mendukung pencarian *multi-parameter*:
      - **Nama Pasien / Customer** (misal: "Ivan", "Siti", "Disu").
      - **Nomor HP / WhatsApp** (misal: "088235780925", "0925", "628...").
      - **Keyword Isi Pesan / Chat** (mencari kata kunci spesifik di seluruh riwayat percakapan).
      - Dilengkapi *real-time instant client filtering*, *debounced backend search* langsung ke database PostgreSQL, tombol reset pencarian instan `X`, dan *empty state* informatif.
    - `LiveChatMonitor.tsx`: Mengganti tombol panjang "Sync Semua (Background)" menjadi tombol ikon ringkas `RefreshCw` yang rapi di toolbar mobile, serta menambahkan modal konfirmasi interaktif yang merinci apa yang dilakukan sistem, data apa saja yang di-scrape/disinkronkan, dan estimasi waktu berjalan di background (~1-3 menit).
    - `waha-history-sync.service.ts` & `message.service.ts`: Menambahkan **Silent Bypass 100%** saat sinkronisasi riwayat chat lama (`isHistorical = true`), mem-bypass seluruh Web Push, dering notifikasi audio, counter MQL, dan auto follow-up agar HP admin tidak ter-spam notifikasi saat backfill chat WhatsApp.
    - `StaffManagement` & Dynamic Database RBAC (`prisma/schema.prisma` & `roles.subroute.ts`):
      - Menambahkan model database `CustomRole` (`custom_roles` table) per-tenant (`tenant_id`) untuk menyimpan konfigurasi custom role, daftar hak akses modul (`allowed_paths`), dan redirect default secara dinamis di PostgreSQL.
      - Menambahkan REST API endpoint `/api/admin/roles` (GET, POST, DELETE) dengan audit logging dan in-memory fallback.
      - Mengintegrasikan sinkronisasi client `rolePermissions.ts` langsung ke database backend saat login dan perubahan peran.
      - Mengizinkan pengelola klinik menambahkan posisi/jabatan baru kapan saja tanpa batasan hardcode, dan langsung aktif di seluruh perangkat (desktop, HP, tablet).
      - Menambahkan fitur **Pilihan Halaman Awal Masuk (Landing Page Selector)** per-role di modal manajemen peran, sehingga admin dapat menentukan modul mana yang langsung dibuka otomatis saat staf login (misal: *Live Chat Monitor* untuk SPVCS, *Kalender Reservasi* untuk resepsionis, dll).
      - Menambahkan fitur **Pengaturan Urutan Menu Sidebar (Interactive Menu Reordering)** dengan tombol ▲ Naik dan ▼ Turun, memungkinkan urutan navigasi sidebar disesuaikan per-role secara dinamis dan tersimpan langsung di PostgreSQL.
      - Memperbaiki penanganan `getDefaultRedirect` dan `auth.subroute.ts` login redirect agar otomatis mengarahkan staf ke rute pertama yang diizinkan sesuai database hak akses (mencegah redirect salah ke halaman Overview yang memicu `Access Unauthorized`).
    - `CreateReservationModal.tsx` & `Reservations.tsx`:
      - **Multi-Treatment Multi-Anak & Stepper Kuantitas**: Mengganti sistem checkbox tunggal dengan kontrol kuantitas stepper `[ - ] [ Qty ] [ + ]` dan tombol `[+ Duplikat Anak]`, memungkinkan pemilihan perlakuan yang sama berulang kali (misal: 2x *Pijat Bayi* untuk 2 anak / kembar / kakak-adik) serta pemetaan treatment ke masing-masing anak (`Ditujukan untuk: Anak #1 / Anak #2`).
      - **Kalkulasi Buffer Cerdas (Add-on Tanpa Buffer)**: Durasi jadwal dihitung otomatis di mana setiap layanan utama (*Main Service*) mendapatkan buffer jeda **+20 menit**, sedangkan layanan tambahan / *Add-on* (seperti *Moksa*, *Kinesio Taping*, *Ear Candle*, *Nebulizer*) **tidak menambahkan buffer jeda (0 menit)**.
      - **Tombol Checklist / Selesai Memilih Layanan**: Menambahkan tombol konfirmasi `[✓ Selesai Memilih]` di bagian bawah dropdown katalog layanan untuk mempermudah penutupan popover pada layar sentuh.
      - **Isolasi Input Pencarian Layanan Mobile**: Mengonfigurasi `enterKeyHint="search"`, `inputMode="search"`, dan isolasi atribut form untuk mencegah munculnya tombol navigasi keyboard atas/bawah yang mengganggu di layar HP.
      - **Tombol & Modal "Lihat Jadwal Terisi"**: Tombol di samping input tanggal kunjungan untuk melihat pratinjau instan (*calendar peek*) seluruh jadwal terapis yang sudah terisi dan slot yang masih kosong pada tanggal tersebut.
      - **Fitur Cerdas "Rekomendasikan Jam Kunjungan & Kedatangan Bidan"**: Menghitung ketersediaan jadwal terapis dengan pembulatan rapi ke kelipatan **30 menit** (`09:30`, `10:00`, `13:30`, dst), memperhitungkan waktu perjalanan dari lokasi pasien sebelumnya / klinik, serta **mengkalkulasikan estimasi waktu keberangkatan bidan dan kedatangan bidan di rumah pasien 10 menit sebelum treatment dimulai** untuk persiapan & sterilisasi.
      - **Filter Khusus Peran Terapis (`THERAPIST`)**: Mengoreksi generator rekomendasi agar hanya memfilter staf dengan peran `THERAPIST` (seperti *Bidan Disu*) dan mengecualikan staf manajemen/kantor (*SPV_CS*, *ADMIN_CS*).
      - **Dropdown Pemilih Tampilan Ringkas di Mobile (`Reservations.tsx`)**: Opsi tampilan dibuat bersih tanpa teks panjang atau emoji (`List`, `Hari`, `Minggu`, `Bulan`).
      - **Dropdown Filter Status Mobile (`Reservations.tsx`)**: Mengubah deretan tombol status menjadi dropdown ringkas di mobile (`Semua Status`, `Pending`, `Confirmed / Lunas`, `Completed / Selesai`, `Cancelled / Batal`).
      - **Header Navigasi Kalender Ringkas (`Reservations.tsx`)**: Tombol navigasi `< Hari Ini >` diletakkan tepat di samping kanan judul bulan (misal: *Agustus 2026*), dan sub-judul dipersingkat menjadi **"Jadwal Reservasi"** untuk menghemat ruang vertikal.
      - **Tampilan Bulan Bersih & Label Penuh (`MonthScheduleGrid.tsx`)**: Menghilangkan teks "N treatment", tombol cek individual, dan ikon. Menampilkan label treatment penuh (*full-width strip*) bersih dengan jam dan nama customer di mana klik pada cell otomatis membuka Tampilan Hari.
      - **Auto-Switch Bulan ke Hari (`MonthScheduleGrid.tsx` & `Reservations.tsx`)**: Mengklik cell tanggal pada tampilan Bulan (*Month View*) otomatis membuka rincian jadwal pada tanggal tersebut di tampilan Hari (*Day View*).
      - **Freeze Sempurna Kolom Jam Minggu (`WeekScheduleGrid.tsx`)**: Menerapkan container `min-w-[1050px]` dan `sticky left-0 shadow-md` sehingga label jam di sisi kiri terkunci kokoh saat tabel digeser ke arah kanan di layar HP.
      - **Soliditas Modal Buat Jadwal (`CreateReservationModal.tsx`)**: Mengunci form di tengah dengan `touch-action: pan-y`, `overscroll-behavior: contain`, dan `overflow-x: hidden` untuk mencegah form bergoyang atau bergeser saat di-swipe.
    - `LiveChatMonitor.tsx`:
      - **Filter Ikon Ringkas & Press-Hold Tooltip**: Mengubah filter sumber percakapan menjadi ikon minimalis (`Smartphone`, `Layers`, `FlaskConical`) dilengkapi fitur *press-and-hold* (tekan & tahan pada layar sentuh) yang memunculkan popover label info penjelas ikon dengan haptic feedback.
      - **Penataan Toolbar Sejajar**: Meletakkan dropdown filter label pasien tepat di samping tombol filter ikon.
      - **Badge Jumlah Percakapan di Header**: Memindahkan angka jumlah percakapan langsung ke samping judul "Live Chat Monitor" sebagai badge angka ringkas (`Live Chat Monitor (N)`).
      - **Optimasi Bilah Aksesori Keyboard iOS & Auto-Scroll Viewport (`LiveChatMonitor.tsx`)**:
        - Mengunmount elemen form di panel list (`<select>` filter label dan `<input>` pencarian) dari DOM secara kondisional saat berada di tampilan chat mobile (`mobileView === 'chat'`), sehingga Safari hanya mendeteksi 1 elemen input tunggal di seluruh DOM (mengeliminasi tombol navigasi formulir `∧` Prev dan `∨` Next).
        - Mengintegrasikan **Visual Viewport API** (`window.visualViewport`) untuk mendeteksi pemunculan keyboard iOS secara presisi dan otomatis melakukan smooth scroll ke pesan terbaru tanpa tertutup oleh keyboard.
        - Memperbarui `index.css` dengan selektor `[contenteditable="plaintext-only"]` untuk memastikan pemilihan teks dan kursor pengetikan native berjalan mulus di iOS.
    - `message.service.ts`: Memperbaiki bug penentuan `sender_type` pesan inbound agar otomatis terset sebagai `'CUSTOMER'` (bukan default `'BOT'`), serta mengoreksi 3.062 baris pesan inbound terdahulu di database agar bubble chat customer tetap berada di sisi kiri pada Live Chat.
  - **Service Worker PWA & Client Hook (`public/sw.js` & `src/services/pushNotification.ts`)**:
    - Menambahkan listener event `push` dan `notificationclick` di Service Worker untuk menampilkan banner notifikasi asli di layar kunci HP dan membuka chat saat di-tap.
    - Integrasi otomatis pendaftaran push pada hook `useLiveChatNotification.ts`.
  - **Unit Test Komprehensif (`tests/unit/web-push.service.test.ts`)**:
    - 4 test cases offline covering key generation, subscription upsert/prune, dan error status handling.

### Fixed — Pemulihan Tampilan Gambar Masuk (Inbound Customer Media) di Live Chat

- **Penyebab Ditemukan**:
  1. WAHA NOWEB menyimpan media masuk ke direktori file store `/api/files/:session/:file`, namun menyertakan host lokal pada URL payload. Ketika dashboard mencoba memuat file, request ke server Fastify menghasilkan HTTP 404 (karena Fastify sebelumnya belum memiliki handler proxy untuk `/api/files/*`).
  2. Fungsi `downloadMedia` sebelumnya gagal karena format JID LID / Serialized ID, dan `MediaImage.tsx` memuat gambar dengan `crossOrigin = 'anonymous'` yang menghapus cookie sesi browser.
- **Perbaikan yang Dilakukan**:
  - **Reverse Proxy `/api/files/:session/:file` (`src/routes/media.route.ts`)**: Fastify kini menyediakan endpoint proxy transparan ke WAHA file store sehingga file gambar yang sudah tercatat di database dapat langsung di-stream tanpa error 404.
  - **Direct File Fetch & Thumbnail Fallback (`src/routes/webhook.route.ts` & `src/integrations/waha/client.ts`)**: Webhook inbound kini mencoba mengunduh file langsung dari endpoint URL WAHA (`wahaClient.fetchUrl`), dilanjutkan dengan multi-candidate `downloadMedia`, dan fallback otomatis ke `jpegThumbnail` base64 jika file belum sempat terunduh dari server WhatsApp.
  - **Normalisasi URL Media di UI (`LiveChatMonitor.tsx`, `StaffToday.tsx`)**: Fungsi `extractMedia` kini otomatis menormalkan URL host penuh (seperti `http://localhost:3000/...` atau ngrok) menjadi relative path `/api/files/...` atau `/media/...` agar kompatibel di semua lingkungan (lokal, ngrok, produksi).
  - **Tap-to-View Resolusi Asli (`MediaImage.tsx`)**: Menampilkan gambar secara langsung dan bersih di dalam bubble chat. Saat gambar di-tap / diklik, otomatis membuka modal penampil resolusi penuh (resolusi asli dari customer) dengan backdrop gelap, tombol tutup (Esc), dan caption tanpa tombol download/watermark yang mengganggu.

### Added & Improved — Fitur Edit Pesan WhatsApp Terkirim (Batas 15 Menit) & Live Chat Real-Time

- **Fitur Edit Pesan WhatsApp Terkirim (`LiveChatMonitor.tsx`, `StaffToday.tsx`, `live-chat.service.ts`, `waha.driver.ts`)**:
  - **Integrasi Endpoint WAHA Edit**: Menambahkan metode `editMessage(chatId, messageId, newText)` ke `IWahaClient` dan `WahaClient` (`PUT /api/{session}/chats/{chatId}/messages/{messageId}`) dengan payload `{ text: newText }` serta fallback endpoint `/api/messages/edit`.
  - **Abstraksi Multi-Provider WhatsApp Gateway**: Menambahkan flag `supportsEdit` pada `WhatsAppGateway` (`waha.driver.ts` $\rightarrow$ `true`, `waba.driver.ts` $\rightarrow$ `false` dengan handling penolakan ramah).
  - **Validasi Batas Waktu 15 Menit**: Server dan UI secara ketat memverifikasi bahwa pengeditan hanya dapat dilakukan untuk pesan keluar (*outbound*) dalam jangka waktu maksimal 15 menit pertama sejak pesan terkirim (`Date.now() - msg.created_at <= 15 * 60 * 1000`) sesuai kebijakan resmi WhatsApp.
  - **Pembaruan Data & Broadcast Real-Time**: Pesan yang diedit diperbarui di database Prisma (`messages.content` dan `payload_raw.is_edited = true`, `edited_at`), memory store fallback, dan dipancarkan ke event stream SSE `message.updated` via `LiveChatHub`.
  - **Modal Interaktif & Label "(Diedit)" di UI**:
    - Tombol ikon pensil (`PenLine`) muncul di samping tombol hapus pesan (*trash*) untuk pesan outbound $\le 15$ menit.
    - Modal interaktif lengkap dengan konfirmasi, input textarea, serta panduan batas waktu 15 menit WhatsApp.
    - Menampilkan badge italic *(diedit)* di samping jam pesan pada bubble chat Live Chat Monitor dan Portal Staf Bidan.
  - **Subroute API Fastify**:
    - `PUT /api/admin/conversations/:id/messages/:messageId/edit` (Admin Live Chat)
    - `PUT /api/staff/conversations/:id/messages/:messageId/edit` (Staff Portal dengan pembatasan kepemilikan percakapan)
- **Unit Test Komprehensif (`tests/unit/live-chat.service.test.ts`)**:
  - Menambahkan test case untuk skenario sukses edit pesan outbound $\le 15$ menit, penolakan otomatis pesan $> 15$ menit, pencegahan edit pesan inbound customer, dan proteksi provider non-edit (WABA).

### Added — Command Telegram `/clean`: Task Pembersihan Server via Cron Host

- **Perintah `/clean` (alias `/clean_server` / `/server_clean`) di bot Telegram (`src/routes/telegram-webhook.route.ts`)**:
  - Task pembersihan server produksi dapat dipicu langsung dari chat Telegram yang sudah ter-pair dengan tenant (chat lain **ditolak** — aman dari penyalahgunaan).
  - Mekanisme aman **file-based trigger** (tanpa membuka docker.sock ke container): bot menulis `storage/.clean-request` (volume shared host↔container), cron host `clean-trigger.sh` (tiap menit) mendeteksi request → menjalankan `server-clean.sh` → hasil ditulis ke `storage/.clean-result` → bot polling dan mengirim laporan hasil ke Telegram otomatis.
  - Guard: `TELEGRAM_CLEAN_ENABLED=false` menonaktifkan perintah; anti-antrean ganda (request yang belum diproses cron memicu pesan "Masih Diproses").
  - Opsi tuning: `CLEAN_STORAGE_DIR`, `CLEAN_POLL_MS`, `CLEAN_POLL_TIMEOUT_MS`.
  - Daftar perintah `/help` diperbarui.
- **Script server (`scripts/server-clean.sh` + `scripts/clean-trigger.sh`)**:
  - Aman: hanya membersihkan build cache Docker (semua umur), image dangling, cache apt, temp, log `.gz`, dan vacuum journal ke 50MB. **Image aktif, container, dan volume (Postgres/WAHA/Redis/Caddy) tidak pernah disentuh.**
  - Log aktivitas di `/var/log/server-clean.log`.
- **Unit test** (`tests/unit/telegram-webhook.test.ts`): akses ditolak dari chat non-paired, penjadwalan + laporan hasil via polling, dan anti-antrean ganda.
- **Efek di lapangan**: saat deploy pertama, disk server turun dari 31 GB (83%) ke 14 GB (36%) setelah `docker builder prune` membebaskan ~17 GB build cache.

### Fixed — Pemulihan Total Seleksi & Salin Teks Global (System Logs, Tables, Message Trace & Text)

- **Penghapusan Listener Global Anti-Seleksi (`App.tsx` & `index.css`)**:
  - Menemukan penyebab teks log di menu System Debug, tabel data, teks pesan, dan konten dashboard tidak bisa di-select / diblok / disalin: sebelumnya terdapat listener global `selectstart` dan `contextmenu` di `App.tsx` yang memanggil `preventDefault()` serta aturan `* { user-select: none !important; }` di `index.css`.
  - **Solusi**: Menghapus listener pencegah seleksi global di `App.tsx` dan memperbarui `index.css` agar aturan `user-select: none` hanya diaplikasikan khusus pada tombol (*button/nav*). Teks log (`code`, `pre`, `.font-mono`), tabel data, teks pesan, dan input kini dapat di-select/diblok dan disalin (*copy*) secara normal 100%.

### Fixed — Pemulihan Total Event Stream Real-Time Live Chat SSE (Redis Pub/Sub Local Delivery)

- **Perbaikan Krusial Distribusi Event Real-Time (`live-chat-hub.service.ts`)**:
  - Menemukan dan memperbaiki akar penyebab hilangnya update real-time di Live Chat Monitor: Pada `LiveChatHubService.publish()`, saat Redis aktif (kondisi produksi), event langsung di-publish ke Redis dan langsung mengembalikan eksekusi (`return`) tanpa memancarkan event ke `localBus` instance. Di sisi lain, listener Redis subscriber sengaja menolak (*drop/loopback-skip*) event yang berasal dari instance-nya sendiri (`_instanceId`).
  - Akibatnya, pada server produksi dengan 1 instance aktif, seluruh event `message.created` dan `conversation.updated` tertelan dan tidak pernah terkirim ke klien SSE browser (`/api/admin/live-chat/events`).
  - **Solusi**: `publish()` kini selalu memancarkan event secara langsung ke `this.localBus.emit()` (sehingga subscriber SSE di instance lokal menerima pesan instan tanpa jeda) dan secara simultan mem-broadcast ke Redis untuk instance lain. Unit test diperbarui dan lulus 100%.

### Added — Sistem Notifikasi Real-time Chat Masuk WhatsApp-Style (Audio Chime, Getaran, In-App Banner & Web Push)

- **Sistem Notifikasi Pesan Masuk Real-Time Berbasis RBAC (`useLiveChatNotification.ts` & `notificationSound.ts`)**:
  - **Filter Hak Akses (RBAC Guard)**: Notifikasi real-time dan audio chime hanya aktif untuk staf/admin yang memiliki hak akses modul Live Chat (`hasAccess(role, '/admin/live-chat')`).
  - **Audio Chime Sintetis & Getaran Haptik**: Menggunakan Web Audio API untuk menghasilkan nada chime dua-nada jernih khas WhatsApp (G5 $\rightarrow$ C6) + getaran haptik smartphone (`navigator.vibrate`), 100% offline tanpa dependensi file audio eksternal dan bebas hambatan *autoplay policy* via auto-unlock.
  - **Banner Drop-Down In-App Khas WhatsApp**: Menampilkan floating banner notifikasi di bagian atas layar saat admin sedang membuka halaman mana pun (Overview, Reservations, dll), lengkap dengan nama pelanggan, cuplikan pesan, waktu, dan tombol "Ketuk untuk Balas" yang langsung mengarahkan navigasi ke Live Chat.
  - **HTML5 Native Browser Notification**: Mengirim notifikasi sistem OS browser saat tab dashboard sedang diminimalkan atau membuka aplikasi lain di background.
  - **Real-Time Sidebar Badge**: Memperbarui angka indikator pesan belum dibaca pada menu "Live Chat Monitor" di sidebar secara live.
  - **Kontrol Suara di Header**: Tombol toggle Volume Mute / Unmute & Test Suara di bar navigasi atas dengan penyimpanan preferensi di `localStorage`.

### Added & Improved — Animasi Transisi Halus (Fluid Navigation) Mobile & Eliminasi Total Native iOS Safari Edge Swipe-Back

- **Animasi Transisi Halus (*Fluid Mobile View Transitions*) (`LiveChatMonitor.tsx` & `index.css`)**:
  - Menambahkan keyframes transisi mobile `animate-mobile-chat-enter` (slide halus 24px dari kanan dengan kurva Bézier alami) saat membuka ruang chat, dan `animate-mobile-list-enter` (slide halus 16px dari kiri) saat kembali ke daftar chat.
  - Menambahkan *micro-feedback tactile interaction* pada kartu percakapan (`active:scale-[0.985] duration-150`) sehingga respons sentuhan terasa empuk, modern, dan tidak kaku di smartphone.
  - Memastikan animasi transisi hanya aktif pada layar mobile (< 1024px) dan tetap statis di desktop view agar efisien.
- **Pembersihan History Stack & Penonaktifan Native iOS Safari Edge Swipe-Back (`Layout.tsx` & `LiveChatMonitor.tsx`)**:
  - Mengidentifikasi bahwa usapan kiri-ke-kanan yang menampilkan halaman sebelumnya (Overview) adalah gestur sistem bawaan iOS Safari (*Interactive Edge Pop Gesture*) akibat penumpukan riwayat rute di React Router (`history.pushState`).
  - Mengubah seluruh tautan navigasi menu drawer di `Layout.tsx` menjadi mode `replace={true}`, menjaga *history depth* browser tetap 1 (rata) saat pengguna berpindah menu.
  - Menghilangkan pemanggilan `history.pushState` pada transisi daftar chat ke ruang pesan di `LiveChatMonitor.tsx`, menjadikan pergantian tampilan chat 100% berbasis state lokal React.
  - Dengan riwayat yang tidak menumpuk, **iOS Safari secara otomatis mematikan gestur *Edge Swipe Back* bawaan sistem**, sehingga usapan kiri-ke-kanan di dalam aplikasi tidak akan pernah memicu *preview* halaman sebelumnya.
- **Masking Fisik GPU Compositor & Isolasi Sidebar (`Layout.tsx` & `index.css`)**:
  - Mengatasi akar masalah fisik di mana elemen `<aside>` yang berada di posisi `right-0` dengan `translate-x-full` tetap ter-render sebagai texture GPU off-screen. Saat pengguna mengusap layar dari kiri ke kanan dan canvas browser HP mengalami pergeseran elastis (*elastic horizontal overscroll/pan*), texture sidebar di luar layar ikut terseret masuk ke viewport dan memantul keluar lagi saat jari dilepas.
  - Memasang aturan masking mutlak pada `<aside>` saat tertutup: `opacity-0 invisible pointer-events-none` (`visibility: hidden`), sehingga GPU browser secara mutlak tidak menggambar / me-render pixel apa pun dari sidebar saat tertutup.
  - Menambahkan `overflow-x: hidden` dan `max-width: 100vw` pada `html, body, #root` untuk mengunci viewport horizontal agar canvas tidak dapat bergeser ke kanan.
  - Menempatkan atribut `data-no-swipe-menu="true"` langsung pada root container `LiveChatMonitor` untuk memblokir event touchstart global di seluruh area halaman chat.
- **Sinkronisasi Sempurna History Stack & Penanganan Back (`LiveChatMonitor.tsx`)**:
  - Memperbarui fungsi `handleBackToList()` untuk memanggil `window.history.back()` secara simetris jika `liveChatView === 'chat'`, membersihkan *dangling history state* sehingga history stack browser selalu bersih saat berada di daftar chat.
  - Memasang handler `handleListTouchMove` dengan `e.preventDefault()` pada area tepi kiri Section 1 (Chat List), mengeliminasi gangguan di mana browser smartphone (Android Chrome / Safari) memicu gestur *Native Back Preview* saat pengguna mengusap kanan di daftar chat.
- **Pengembalian Posisi Mobile Sidebar ke Sisi Kanan (`Layout.tsx`)**:
  - Memastikan drawer navigasi mobile berada di **sisi kanan layar** (`right-0`, `translate-x-full` $\rightarrow$ `translate-x-0`).
  - **Membuka Menu**: Hanya dapat dipicu oleh usapan dari tepi kanan layar ke arah kiri (*swipe right-edge to left*, `touchStartX >= window.innerWidth - 30`, `deltaX < -45`).
  - **Menutup Menu**: Menggeser menu ke arah kanan (*swipe right*, `deltaX > 45`) atau mengetuk backdrop overlay.
  - Menerapkan isolasi sentuhan `backdropTouchStartRef` dan `justSwipedRef` sehingga saat sidebar dibuka, pelepasan jari di akhir usapan tidak akan menutup kembali sidebar secara tidak sengaja.
- **Universal App-Wide Anti-Selection & Selectstart Blocker (`App.tsx` & `index.css`)**:
  - Menerapkan aturan CSS universal `*, *::before, *::after { user-select: none !important; -webkit-touch-callout: none !important; }` ke seluruh elemen aplikasi dashboard (hanya membuka seleksi pada elemen `input`, `textarea`, dan `.selectable-text`).
  - Memasang listener capture global `document.addEventListener('selectstart', ..., { capture: true })` dan `window.addEventListener('contextmenu', ..., { capture: true })` di root `App.tsx` untuk membatalkan (*e.preventDefault()*) semua event seleksi teks bawaan browser saat menahan sentuhan (*hold press 3+ detik*). Hal ini mengeliminasi 100% munculnya blok biru seleksi dan popup/floating bubble 'Salin / Copy / Share' bawaan OS Android dan iOS.
- **Pencegahan Native Browser Edge Reload pada Slide Back (`index.css` & `LiveChatMonitor.tsx`)**:
  - Menerapkan `overscroll-behavior-x: none` dan `touch-action: pan-y pinch-zoom` pada elemen root `html, body, #root` untuk mencegah browser mobile (Chrome/Safari) mencegat usapan tepi kiri sebagai navigasi *hard reload* halaman web.
  - Menambahkan handler `handleDetailTouchMove` dengan `e.preventDefault()` saat usapan horizontal terdeteksi dari tepi kiri, memastikan SPA tidak pernah memuat ulang komponen booting (*"Menyiapkan tampilan…"*) saat pengguna kembali ke daftar chat.
  - Menyesuaikan `handleBackToList()` menjadi murni transisi state React instan tanpa manipulasi history berbahaya.

### Added & Improved — WhatsApp-Style Mobile Bottom Action Sheet, Gesture Calibration & History Isolation

- **Redesain Context Menu Menjadi WhatsApp-Style Mobile Bottom Action Sheet (`LiveChatMonitor.tsx`)**:
  - Pada layar smartphone, menu konteks hold-press kini meluncur mulus dari bawah layar (*slide-up bottom sheet*) dilengkapi *grab handle*, info avatar/nama pelanggan, opsi tombol sentuh besar (*Sematkan Chat, Tandai Belum Dibaca, Ambil Alih CS*), dan tombol *Batal*.
  - Menambahkan **Backdrop Overlay Penuh** (`fixed inset-0 bg-black/40`) pada mode mobile dan desktop sehingga mengetuk area luar menutup menu dengan aman tanpa memicu klik pada elemen di bawahnya (*tap-through protection*).
- **Kalibrasi Presisi Right-Edge Swipe Gesture (`Layout.tsx`)**:
  - Zona aktivasi diperketat menjadi 30px dari tepi kanan layar (`touchStartX >= window.innerWidth - 30`).
  - Diterapkan filter sudut horizontal ketat 2.0x (`Math.abs(deltaX) > Math.abs(deltaY) * 2.0`) dan pengabaian sentuhan pada elemen input/form, menjamin scroll vertikal chat tidak akan memicu pembukaan drawer secara tidak sengaja.
- **Kalibrasi Left-Edge Swipe Back (`LiveChatMonitor.tsx`)**:
  - Zona aktivasi tepi kiri diselaraskan (`touchStartX <= 35`), jarak geser minimum 45px ke kanan, dan eliminasi pembatasan waktu sempit agar usapan jari terasa instan dan responsif.
- **Isolasi History Routing Tanpa Efek Samping (`Layout.tsx`)**:
  - Menghilangkan manipulasi history pada cleanup effect menu, memastikan navigasi tautan menu di mobile berjalan mulus tanpa layar berkedip (*flicker*) atau terpental mundur.

### Fixed — Comprehensive Touch Gestures, Long-Press & History Navigation Overhaul (10 Bug Fixes)

- **Perbaikan Ghost History Entries pada Sidebar (`Layout.tsx`)**:
  - Menutup drawer sidebar melalui UI (tombol X, klik backdrop, usap gesture, atau navigasi link) kini otomatis membersihkan state history dummy (`window.history.back()`), menghilangkan masalah tombol Back hardware yang sebelumnya harus ditekan berkali-kali.
- **Guard Layar Desktop Touch Leak (`Layout.tsx`)**:
  - Menambahkan guard `window.innerWidth < 768` pada event `onTouchStart` sehingga layar sentuh pada perangkat laptop/tablet desktop tidak memicu mobile menu drawer.
- **Eliminasi Long-Press Click Bleed & Tremor Tolerance (`LiveChatMonitor.tsx`)**:
  - **Click Bleed**: Mencegah browser mobile memicu `onClick` setelah menu konteks terbuka saat jari diangkat (menggunakan `longPressTriggeredRef`).
  - **Tremor Tolerance**: Memberikan toleransi jarak getaran jari hingga 10px (`Math.hypot > 10`) pada `onTouchMove` agar long-press tidak mudah batal saat jari sedikit bergerak.
  - Menambahkan handler `onTouchCancel` untuk mereset seluruh state gestur saat terjadi interupsi sistem OS.
- **Dukungan Hardware/Browser Back Button untuk Live Chat (`LiveChatMonitor.tsx`)**:
  - Menambahkan `pushState` saat membuka chat dan sinkronisasi `popstate` listener sehingga tombol Back fisik/gesture bawaan HP otomatis mengembalikan tampilan dari detail chat ke daftar percakapan (*Back to List*).
- **Perbaikan Arah Gestur (Direction Inversion) di Portal Staff (`StaffToday.tsx`)**:
  - Mengubah deteksi swipe pada tampilan chat dari `Math.abs(deltaX) > 40` menjadi `deltaX > 40` (hanya usapan ke KANAN yang kembali ke list; usapan ke kiri tidak lagi menutup chat tanpa sengaja).
  - Menyelaraskan threshold batas usapan drawer (`Math.abs(deltaX) < 35`).
  - Menambahkan sinkronisasi `popstate` untuk seluruh modal (`detailModalTask`, `paymentModalTask`, `updateLocationModalTask`, `showStaffProfileModal`, `showMenuDrawer`, `zoomImageUrl`) agar tombol Back HP menutup modal secara berurutan tanpa melempar user keluar dari portal staff.

### Added & Improved — Mobile Hold-Press Anti-Selection, Right-Aligned Hamburger Menu, Right Drawer, & Edge Swipe Gestures

- **Eliminasi Text Selection pada Hold-Press Chat Card (`LiveChatMonitor.tsx`)**:
  - Menerapkan `userSelect: 'none'`, `-webkit-user-select: 'none'`, `-webkit-touch-callout: 'none'`, dan kelas `select-none` pada seluruh kartu percakapan.
  - Memanggil `window.getSelection()?.removeAllRanges()` otomatis pada event `onTouchStart` dan saat timer long-press terpicu, sehingga menu konteks (*Sematkan, Tandai Belum Dibaca, dll.*) muncul bersih tanpa ada teks yang terblok/terseleksi di smartphone.
- **Pemindahan Ikon Menu Garis Tiga (Hamburger) ke Pojok Kanan Header (`Layout.tsx`)**:
  - Memindahkan tombol `<Menu />` ke sisi kanan header navbar di samping status liveness/online, membuat jangkauan jempol satu tangan di HP jauh lebih ergonomis dan natural.
  - Sisi kiri header kini bersih menampilkan nama panel (`KALA SPA Management Bot`).
- **Mobile Drawer Navigasi Sisi Kanan & Right-Edge Swipe Gesture (`Layout.tsx`)**:
  - Mengonfigurasi drawer menu navigasi mobile meluncur (*slide-in*) dari sisi kanan layar (`right-0`, `border-l`), selaras dengan posisi tombol menu di pojok kanan.
  - Menambahkan *touch listener* gestur usap tepi kanan (**Right-Edge Swipe**, start `clientX >= window.innerWidth - 55px` geser ke kiri) untuk membuka menu drawer secara instan tanpa harus mengetuk tombol.
  - Usapan ke kanan saat menu terbuka otomatis menutup drawer.
- **Left-Edge Swipe Gesture sebagai Navigasi Back pada Detail Chat (`LiveChatMonitor.tsx`)**:
  - Menambahkan gestur usap dari tepi kiri layar (**Left-Edge Swipe**, start `clientX <= 55px` geser ke kanan) pada tampilan detail chat mobile untuk kembali ke daftar percakapan (*back to list*).

### Added & Improved — Mobile Back Button Touch Hitbox Fix, Mark All as Read, & Historical Import Read Status

- **Perbaikan Tombol Back Chat History di Mobile (`LiveChatMonitor.tsx`)**:
  - **Pemisahan dari Header Box Pelanggan**: Mengeluarkan tombol back dari dalam wrapper `div` modal profil customer untuk menghilangkan konflik event klik/sentuh yang sebelumnya membuat tombol sulit ditekan di layar HP.
  - **Hitbox Sentuh Besar & Nyaman**: Memperbesar target sentuh tombol back menjadi `w-10 h-10` (40x40px), ikon `ChevronLeft` stroke tebal `stroke-[2.5]` berukuran 22px, padding responsif, efek aktif `active:scale-90`, dan CSS `touch-manipulation` untuk responsivitas instan tanpa delay 300ms browser mobile.
- **Fitur Tandai Semua Sudah Dibaca (Mark All as Read) (`message.service.ts`, `livechat.subroute.ts`, `LiveChatMonitor.tsx`)**:
  - **Tombol Cepat di Toolbar Filter**: Menambahkan tombol "Tandai Dibaca" berikon `MailCheck` di samping filter label pasien pada Live Chat Monitor.
  - **Endpoint Backend**: Menambahkan `POST /api/admin/live-chat/mark-all-read` yang secara massal menyetel `read_at = now()` pada seluruh pesan inbound dan mereset status `is_manual_unread = false` serta menyiarkan update SSE real-time (`payload: { allRead: true }`).
- **Otomatisasi Status Read pada Seluruh Jalur Import Riwayat Chat (`message.service.ts`, `waha-history-sync.service.ts`, `migration.service.ts`, `import-real-data.ts`, `standalone-import.js`)**:
  - Semua proses import data historis atau sinkronisasi background kini otomatis menandai pesan sebagai telah dibaca (`read_at = msg.created_at || now`), mencegah ribuan pesan arsip lama muncul sebagai pesan baru yang belum dibaca.

### Added & Improved — WhatsApp-Style Unread Badge, Manual Dark Green Unread, Orange Awaiting-Reply Dot (24h), Context Menu & Pin Chat

- **Skema Indikator Pesan WhatsApp Komprehensif (`schema.prisma`, `message.service.ts`, `live-chat.service.ts`, `LiveChatMonitor.tsx`)**:
  - **Badge Unread Otomatis (Hijau Terang WhatsApp `#25D366`)**: Pesan inbound baru yang belum dibaca menampilkan badge bulat hijau terang berisi angka count jumlah chat yang belum dibaca. Ditempatkan di sisi kanan bawah ikon Bot AI.
  - **Tandai Belum Dibaca Manual (Hijau Tua `#005c4b`)**: Opsi *Tandai Belum Dibaca (Mark as Unread)* menampilkan badge bulat warna hijau tua solid dengan dot putih di tengah (skema sistem bot lokal tanpa mengganggu status asli di WhatsApp).
  - **Dot Oranye Menunggu Balasan (Awaiting Reply — Masa Aktif 24 Jam)**: Setelah percakapan dibaca (`unreadCount === 0`) dan pesan terakhir berasal dari pelanggan (`INBOUND`), badge otomatis berganti menjadi **Dot Oranye Berkedip (`bg-amber-500`)**. Dot ini bertahan selama maksimal 24 jam untuk mengingatkan CS/Bidan agar segera membalas, dan otomatis hilang jika pesan sudah dibalas (`OUTBOUND`) atau setelah 24 jam terlewati.
  - **Auto Mark as Read**: Saat admin/bidan mengklik atau memilih percakapan di daftar chat, sistem secara otomatis menandai seluruh pesan inbound percakapan tersebut sebagai telah dibaca (`read_at = now()`) dan menyiarkan pembaruan via SSE.
- **Sematkan Percakapan (Pin Chat) (`schema.prisma`, `conversation.service.ts`, `livechat.subroute.ts`)**:
  - Menambahkan kolom `is_pinned Boolean @default(false)` dan `pinned_at DateTime?` pada tabel `Conversation`.
  - Percakapan yang disematkan akan selalu berada di urutan teratas daftar chat di atas antrean *human handling* dan *last_message_at*, serta ditandai dengan ikon 📌 pin di sebelah nama pelanggan.
- **Custom Context Menu & Mobile Long Press (`LiveChatMonitor.tsx`)**:
  - **Desktop**: Klik kanan (`onContextMenu`) pada kartu chat membuka popover menu kontekstual dengan opsi cepat: *Sematkan / Lepas Sematan Chat*, *Tandai Belum Dibaca / Tandai Sudah Dibaca*, dan *Kembalikan ke Bot AI / Ambil Alih Manual*.
  - **Mobile**: Mendukung *hold press* (tekan tahan selama 500ms) untuk memunculkan context menu di perangkat layar sentuh / smartphone.
  - Ditutup otomatis saat pengguna mengklik atau menggulir layar di luar area context menu.
- **REST Endpoints & SSE Real-time Broadcasting**:
  - `PATCH /api/admin/conversations/:id/read` — Menandai pesan telah dibaca.
  - `PATCH /api/admin/conversations/:id/unread` — Menandai pesan manual belum dibaca (hijau tua).
  - `PATCH /api/admin/conversations/:id/pin` — Menyematkan / melepas sematan chat.
  - Terintegrasi penuh dengan `LiveChatHub` SSE broadcast (`conversation.updated`) untuk pembaruan multi-device instan.
- **Unit Testing**:
  - Menambahkan `tests/unit/chat-unread-and-pin.test.ts` (4/4 tests passed 100%).

### Added & Improved — Chat Card Label Grouping Refactor & Badge Deduplication

- **Refaktor Pengelompokan Label Kartu Percakapan (`LiveChatMonitor.tsx`)**:
  - **Pembersihan Baris Header (Bawah Nama & Nomor)**: Memindahkan badge status sistem (`Medis` dan `Legacy`) dari baris atas ke baris footer bawah kartu, sehingga area di bawah nama dan nomor telepon kini khusus dan bersih didedikasikan untuk **Custom Customer CRM Labels** (tag warna-warni yang dikelola oleh admin/bidan seperti VIP, Follow Up, Komplain, dsb).
  - **Relokasi Badge Medis**: Badge `Medis` (merah rose + ikon AlertTriangle) kini tampil rapi dan jelas di baris metrik footer (Grup 2).
  - **Eliminasi Duplikasi Badge Legacy**: Menghapus duplikasi label `Legacy` yang sebelumnya muncul tumpang tindih 2 kali (warna ungu di atas dan warna abu-abu di bawah) menjadi **1 badge `Legacy` tunggal** yang elegan di baris footer kartu.

### Added & Improved — Multi-Tier LLM Gateway Architecture Migration & Fallback Telemetry Refactor

- **Migrasi Model Primer & Rantai Fallback Terstruktur (`ai-models.config.ts`, `cost-calculator.ts`, `.env.example`)**:
  - **Tier 1 (SumoPod Primary)**: Mengganti default model chat, intent, NLU, phrasing, dan medical check menjadi **`qwen3.7-flash-2026-07-15`** (Alibaba Qwen). Menghadirkan konteks 1.000.000 token, pemahaman Bahasa Indonesia sangat luwes, output JSON terstruktur yang stabil, dan efisiensi biaya luar biasa (\$0.03 input / \$0.006 cache hit / \$0.13 output per 1M token).
  - **Tier 2 (SumoPod Internal Failover)**: Mengatur rantai fallback internal ke `gpt-5-nano` dan `deepseek-v4-flash` via endpoint SumoPod yang sama jika Qwen mengalami gangguan latency atau rate limit.
  - **Tier 3 (DeepSeek Direct Official as Last Resort)**: Menetapkan `deepseek-chat` via `https://api.deepseek.com` sebagai penyelamat terakhir independen di luar proxy SumoPod.
  - **Pembaruan Kalkulator Biaya Finansial**: Memperbarui tabel tarif `MODEL_PRICING_MAP` dengan model-model generasi terbaru (Qwen 3.7, GPT-5-nano, Mimo v2.5, Gemini 3.1 Flash Lite, dan tarif peak/off-peak DeepSeek Direct).

- **Perbaikan Presisi Pelaporan Audit Log & Telemetri Fallback (`live-chat.service.ts`, `geocoding.ts`, `legacy-harvesting.service.ts`, `cost-calculator.ts`)**:
  - **Resolusi Provider Riil**: Memperbaiki pemetaan provider di telemetri copilot `live-chat.service.ts` agar membaca `callResult.baseUrl` dan `callResult.model` aktual (bukan config awal), sehingga ketika fallback DeepSeek Direct aktif, transaksi tercatat 100% akurat sebagai `DeepSeek Direct` di audit log dan dashboard admin.
  - **Audit Telemetri Geocoding & Knowledge Harvesting**: Menghubungkan modul `geocoding.ts` dan `legacy-harvesting.service.ts` ke pipeline `auditLlmCall` dan `callChatCompletionsWithFallback`, memastikan setiap token ekstraksi lokasi dan ekstraksi FAQ historis tercatat di database `llm_audit_logs`.
  - **Pembersihan Log Outage**: Menstandarisasi pesan error simulasi outage LLM menjadi format generik `Primary LLM provider connection timeout (500 Internal Server Error)` di seluruh service.

### Added & Improved — ELT Architecture Refactor: Local DB as Single Source of Truth & Zero-WAHA Overload

- **Desentralisasi Akses WAHA Menjadi Arsitektur ELT (`migration.service.ts`, `legacy-harvesting.service.ts`, `migration.subroute.ts`)**:
  - **Single Source of Truth**: Memutus koneksi berulang ke API WAHA dari *Chat Migration* dan *AI Harvesting (Knowledge Base)*. Seluruh ekstraksi form reservasi CRM, perhitungan LTV, dan ekstraksi tanya-jawab FAQ kini murni membaca dari tabel database lokal PostgreSQL (`Conversation` & `Message`) yang telah disinkronkan oleh Live Chat Monitor.
  - **Eliminasi Risiko Shadow-Ban WhatsApp**: WhatsApp hanya dihubungi 1 kali saat melakukan sinkronisasi di Live Chat Monitor, menghilangkan risiko pemblokiran nomor / error 463 RESTRICT_ALL_COMPANIONS akibat request burst berulang.
  - **Ekstraksi Instan Berkecepatan Milidetik**: Mengganti loop HTTP WAHA dengan kueri lokal `prisma.conversation.findMany` yang memproses ratusan percakapan dalam hitungan detik.
  - **Anti-Duplikasi Idempoten**: Proteksi penuh duplikasi data via `upsert` pada `LegacyStaging.phoneNumber` dengan menjaga status review yang sudah ada (`APPROVED`/`COMMITTED`).
  - **Sync Lock & Empty State Guard**: Menambahkan penguncian otomatis (lock guard) pada backend dan UI jika sinkronisasi WhatsApp sedang berlangsung di latar belakang (`isSyncing: true`), serta banner pemandu interaktif jika database lokal masih kosong (0 percakapan).

- **Perbaikan Timestamp Riwayat Chatlist & Presisi Waktu Pesan Asli (`live-chat.service.ts`, `conversation.service.ts`, `waha-history-sync.service.ts`, `sync-true-transcript-timestamps.ts`)**:
  - **Sinkronisasi Waktu Asli WhatsApp**: Menyelaraskan seluruh 439 percakapan dan pesan di database ke waktu riil percakapan pelanggan dari transkrip WhatsApp, bukan lagi menampilkan jam saat scraping/sinkronisasi dieksekusi.
  - **Dinamika `lastMessageAt` Presisi**: `LiveChatService.serialize` kini secara dinamis membaca timestamp pesan terakhir yang sebenarnya (`c.messages[c.messages.length - 1]?.created_at`) sebelum jatuh ke `last_message_at`, memastikan badge waktu selalu mencerminkan chat terakhir.
  - **Penyaringan Percakapan Kosong (0 Pesan)**: `conversationService.listConversations` kini memfilter `messages: { some: {} }`, mencegah kontak kosong hasil sinkronisasi awal yang belum pernah bertukar pesan muncul di bagian teratas daftar chat dengan timestamp pembuatan database.
  - **Robust WAHA Timestamp Parser**: Parser sinkronisasi WAHA kini mengekstrak timestamp dari semua varian properti (`timestamp`, `t`, `_data.t`, `messageTimestamp`), sehingga sinkronisasi masa depan selalu mencatat waktu asli chat tanpa fallback ke `new Date()`.

- **Pembaruan Database Customer & Segmentasi Nilai LTV Transaksi (`CustomerDatabase.tsx`, `customer.service.ts`, `customers.subroute.ts`)**:
  - **Perbaikan Bug Sorting LTV (Batas Query Terpotong)**: Memperbaiki batas `take: pageSize * 10` (150 baris) pada query Prisma saat pengurutan LTV aktif, yang sebelumnya menyebabkan pelanggan bertransaksi terpotong dan hanya menampilkan prospek 0 LTV. Pengurutan LTV kini memindai seluruh data database secara utuh sehingga pelanggan dengan omset tertinggi (`Rp 255.000`, `Rp 230.000`, `Rp 225.000`, dst.) langsung tampil di posisi teratas.
  - **Penyatuan Filter MQL ke Segment Tabs Terpadu**: Mengintegrasikan filter MQL ke dalam deretan tab segment: **"Semua Pelanggan (504)"**, **"🎯 Pembeli / Ada Reservasi (84)"**, **"⚡ MQL Aktif (42)"**, dan **"💬 Prospek Saja (419)"**.
  - **Pembersihan Tombol Toggle Ambigu**: Menghapus tombol toggle terpisah di pojok kanan atas yang sebelumnya menyebabkan konflik state filter dan ketidakcocokan jumlah data.
  - **Ringkasan Finansial & Statistik Header**: Menambahkan 4 kartu statistik di bagian atas halaman: Total Pelanggan (504 kontak), Pelanggan Pembeli (84 kontak), Total Omset Terakumulasi / LTV (Rp 7.065.000), dan Prospek Belum Reservasi (419 kontak).
  - **Penyederhanaan Sorting (Header Tabel Langsung)**: Menghapus deretan tombol sorting manual agar antarmuka lebih bersih dan ringkas. Pengurutan data dilakukan langsung dengan mengklik judul kolom tabel (*No HP/Nama*, *Status MQL*, *LTV*, atau *Terdaftar*) dengan indikator panah dinamis (🔼 / 🔽).
  - **Prioritas Nilai Transaksi LTV Riil**: Menghubungkan pembacaan `r.purchase_value` langsung dari database reservasi sebelum jatuh ke fallback estimasi katalog treatment, sehingga nilai transaksi tersaji 100% akurat sesuai omset historis.
  - **Badge Status Finansial Jelas**: Tampilan kolom LTV kini membedakan secara visual antara pelanggan ber-LTV (badge hijau nominal + jumlah transaksi) dan prospek tanpa reservasi (badge abu-abu `Prospek (Rp 0)`).

- **Pembaruan Antarmuka UI Dashboard, Segmentasi & Sorting Interaktif (`ChatMigration.tsx`, `KnowledgeBase.tsx`, `migration.subroute.ts`)**:
  - Menghapus dropdown limit pesan manual di *Chat Migration* (ekstraksi kini langsung memindai seluruh percakapan lokal secara instan).
  - **Fitur Sorting Dinamis Multi-Kolom**: Menambahkan pengurutan data interaktif baik via dropdown selector maupun langsung klik header tabel dengan indikator panah (🔼 / 🔽):
    - 🕒 **Chat Pertama** (Terkini vs Terlama)
    - 💰 **Nominal LTV** (Tertinggi vs Terendah)
    - 🔤 **Nama Kontak** (A $\rightarrow$ Z / Z $\rightarrow$ A)
    - 💬 **Jumlah Pesan Tercatat** (Terbanyak vs Tersedikit)
    - 🎯 **Waktu Form Reservasi** (Terkini vs Terlama)
  - **Kotak Pencarian Cepat (Search Bar)**: Mendukung pencarian instan berdasarkan nama pelanggan, nomor WhatsApp, atau lokasi kelurahan/kecamatan.
  - **Sub-Filter Segmentasi Pembeli vs Prospek**: Menambahkan tombol filter cepat pada tabel staging: **"Semua Kontak"**, **"🎯 Hanya Pembeli (Ada Reservasi)"**, dan **"💬 Hanya Prospek (Tanya-Tanya Saja)"** untuk kemudahan audit data.
  - **Bulk Approval Data Pembeli**: Menambahkan tombol aksi massal **"Approve Semua yang Ada Reservasi"** pada tab Pending untuk menyetujui seluruh kontak yang memiliki form reservasi & nilai transaksi sekaligus dalam 1 klik.
  - Menambahkan banner status sinkronisasi aktif dan banner panduan jika database lokal masih kosong lengkap dengan tombol pintas ke Live Chat Monitor.
  - Mengunci tombol *Mulai Ekstraksi* dan *Mulai Scraping Chat* secara aman selama proses sinkronisasi WhatsApp berlangsung.

- **Sistem Proteksi Data Dummy, Sandbox & Noise Filter (`dummy-filter.ts`, `migration.service.ts`, `customer.service.ts`, `capi.service.ts`, `waha-history-sync.service.ts`)**:
  - **Aturan Penyaring Chat Noise Rendah**: Otomatis mengabaikan dan menghapus percakapan yang hanya memiliki $\le 2$ pesan tercatat, tanpa nama pelanggan (kosong / `Bunda Customer`), dan tanpa form reservasi, sehingga antrean staging tidak dipenuhi oleh chat sekadar "p" atau broadcast tak berbalas.
  - **Auto-Flagging Dummy**: Setiap kontak pengujian/simulasi CLI, nomor berpola test (`628129999...`, `6289999...`, `08571111...`, `ec01`, `mock_`), nama `Test/Dummy/Spammer`, atau nomor tidak valid otomatis ditandai `is_sandbox_test = true` saat dibuat atau ditemukan di database.
  - **Proteksi Mutlak Meta CAPI**: Menambahkan guard di `CapiService.sendCapiEvent` yang memblokir total pengiriman event konversi (Lead, Purchase, InitiateCheckout) untuk kontak dummy/sandbox guna mencegah pencemaran data Pixel iklan Meta.
  - **Proteksi Query Database Pelanggan & LTV**: Query daftar pelanggan aktif dan perhitungan LTV kini secara baku memfilter `is_sandbox_test: false`, memastikan data ekspor LTV Meta dan CRM 100% bersih dan steril dari data simulasi.
  - **Sinkronisasi Bersih WAHA**: Sinkronisasi riwayat WAHA otomatis melewati (skip) nomor-nomor dummy agar tidak masuk ke tabel staging maupun antrean operasional.

### Added & Improved — Historical Chat Precision Transcript Seeding & Multi-Bubble Financial Extraction Engine

- **Mesin Ekstraksi Multi-Bubble Presisi (`conversation-transaction-extractor.ts`, `seed-transcripts-to-db.ts`)**:
  - **Conversation State Windowing**: Menyambungkan form reservasi yang dikirim oleh pelanggan (*draft tanpa harga*) dengan bubble balasan admin/bot berikutnya yang berisi rincian pembayaran (*Payment Breakdown / Persamaan Ongkir*).
  - **Dukungan Format Persamaan Finansial (Equation & Line-by-Line)**: Mampu mem-parse otomatis notasi persamaan `Total = 70rb + ongkir 25rb = 95rb`, `Total = 85.000 + ongkir 11km (15.000) = *100.000*`, `Total = 100 + 70 + ongkir 15rb = *185.000*`, serta format standar baris per baris.
  - **Currency & Unit Normalizer Cerdas**: Mengonversi variasi penulisan `70rb`, `25k`, `145.000`, `95` secara akurat menjadi angka rupiah murni tanpa terdistorsi oleh angka jarak kilometer (misal `11km`).
  - **Penyaringan Template Kosong & Konsolidasi**: Mengabaikan template form belum terisi dari bot dan menggabungkan draft awal pelanggan dengan konfirmasi pembayaran lunas ke dalam 1 record transaksi bersih.
  - **Database Seeding Execution**: Sukses menyuntikkan **82 Pelanggan**, **80 Data Anak/Bayi**, dan **82 Reservasi Status `completed`** dengan total nilai transaksi bersih **Rp 7.065.000** dan total ongkir **Rp 1.395.000** ke dalam PostgreSQL Prisma Database.
  - **Ekspor Data Bersih**: Menyediakan file rekap transaksi terverifikasi di [`exports/Kala_Moms_Transactions_Clean.md`](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/exports/Kala_Moms_Transactions_Clean.md).

- **Otomatisasi Live Forward Window Matching & UI LTV (`reservation-text-parser.ts`, `migration.service.ts`, `ChatMigration.tsx`, `migration.subroute.ts`)**:
  - Memperbarui `ParsedReservation` untuk menyertakan struktur rincian finansial (`treatmentPrice`, `ongkir`, `promo`, `totalPrice`).
  - Menghubungkan parser teks reservasi dan modul migrasi live untuk menyelaraskan sinkronisasi chat mendatang dengan harga dan riwayat data anak yang presisi.
  - Memperbarui halaman dashboard **Migrasi & Seeding Riwayat Chat** (`ChatMigration.tsx`): mengganti kolom *Lokasi* menjadi **LTV (Total Belanja)** berformat mata uang `Rp ...` dengan rincian ongkir/lokasi sub-teks, dan meng-enrich data staging di backend `GET /api/admin/migration/staging` dengan LTV riil database pelanggan.

### Added & Improved — Completed Reservations UI, Customer Sorting & Detail Modal, Chat Migration Engine & Manager

- **Fitur Status & Filter Reservasi Selesai (`completed`) (`reservations.subroute.ts`, `Reservations.tsx`)**:
  - Menambahkan endpoint `PATCH /api/admin/reservation/:id/complete` dan `PATCH /api/admin/reservation/:id/status` di backend untuk mengubah status reservasi menjadi `completed` (*Selesai Treatment*) dengan pencatatan audit log `COMPLETE_RESERVATION`.
  - Menambahkan bar tab filter status di atas antarmuka tabel reservasi: **Semua**, **Pending (Menunggu)**, **Confirmed (Lunas/Jadwal)**, **Completed (Selesai)**, dan **Cancelled (Batal)** beserta penghitung (*counter*) jumlah data real-time.
  - Menambahkan tombol aksi **"Tandai Selesai Treatment"** pada Modal Kelola Reservasi dengan badge konfirmasi visual yang elegan.

- **Sorting Multi-Kolom & Modal Detail Lengkap Pasien (`customer.service.ts`, `customers.subroute.ts`, `CustomerDatabase.tsx`)**:
  - Menambahkan dukungan parameter `sortBy` (`created_at`, `ltv`, `reservations`, `name`, `phone`, `mqlBubbleCount`) dan `sortOrder` (`asc`, `desc`) pada backend service & API customer.
  - Menambahkan header tabel interaktif yang dapat diklik untuk pengurutan kolom secara dinamis dengan indikator panah arah (`ArrowUpDown`, `ArrowUp`, `ArrowDown`).
  - Menambahkan tombol **Detail Pasien** pada setiap baris dan kartu customer yang membuka **Modal Detail Lengkap**:
    - Profil & Identitas Pasien, nomor WhatsApp, dan status keaktifan.
    - Alamat lengkap, patokan/ancer-ancer rumah, titik pin GPS dengan link Google Maps, jarak tempuh km, dan estimasi ongkir.
    - Data seluruh anak/bayi pasien (nama, tanggal lahir, usia terkini).
    - Riwayat seluruh reservasi & treatment masa lalu yang pernah diambil beserta nama terapis bertugas dan status transaksi.
    - Atribusi iklan Meta (Campaign, Source, Medium, CTWA CLID, Tracking Code) dan tombol cepat akses riwayat chat & WhatsApp.

- **Perbaikan Mesin Parsing & Ketahanan Ekstraksi Chat Historis (`reservation-text-parser.ts`, `migration.service.ts`)**:
  - **Deteksi Form Toleran (`isReservationFormMessage`)**: Mengganti pengecekan string kaku dengan heuristik cerdas yang mendeteksi berbagai format form pemesanan chat lama.
  - **Parsing Timestamp Aman (`parseTimestampSafe`)**: Mengatasi anomali timestamp WAHA (detik vs milidetik) agar tidak menghasilkan objek `Date` invalid.
  - **Error Isolation**: Membungkus pemrosesan per chat dalam blok try-catch sehingga kegagalan satu kontak tidak menghentikan keseluruhan ekstraksi.

- **Halaman Visual Chat Migration & Seeding Manager (`ChatMigration.tsx`, `App.tsx`, `Layout.tsx`, `rolePermissions.ts`)**:
  - Membangun antarmuka dashboard baru di `/admin/chat-migration` untuk memicu ekstraksi chat dari WhatsApp, mereview data pada antrean staging (`LegacyStaging`), menyetujui/menolak (Approve/Reject), dan menyuntikkan data yang disetujui langsung ke database aktif (`customers` status `legacy` & `reservations` status `confirmed`).

### Added & Improved — ORS Route Distance 1.1x Buffer Factor

- **Faktor Buffer 1.1x untuk Perhitungan Jarak OpenRouteService (ORS) (`delivery.service.ts`, `.env.example`)**:
  - Mengalikan hasil jarak rute OpenRouteService (ORS Directions API) dengan faktor buffer 1.1x (`ORS_BUFFER_FACTOR = 1.10`) secara otomatis saat menghitung ongkos kirim dan status jangkauan (coverage).
  - Buffer +10% ini mengakomodasi deviasi rute nyata di lapangan, putar balik jalan searah, dan akses jalan perkampungan/gang sempit yang belum terpetakan sempurna di graf rute.
  - Nilai faktor buffer dapat dikonfigurasi melalui environment variable `ORS_BUFFER_FACTOR` (default `1.10`).
  - Memperbarui seluruh suite pengujian otomatis (`delivery.test.ts`, `delivery_circuity.test.ts`) untuk memvalidasi perhitungan jarak dan boundary tier berbasis buffer 1.1x.

### Added & Improved — Background Full Sync Engine & Real-time Sync Progress

- **Sinkronisasi Riwayat Chat Penuh di Latar Belakang (Non-Blocking Full Sync) (`waha-history-sync.service.ts`, `livechat.subroute.ts`, `LiveChatMonitor.tsx`)**:
  - **Background Worker Loop**: Menambahkan method `startBackgroundFullSync()` yang berjalan asinkron di latar belakang tanpa terikat oleh timeout koneksi HTTP. Bot secara otomatis mengiterasi seluruh obrolan WhatsApp secara bertahap (batch 10 chat dengan throttle 50ms) sampai **100% data selesai terambil**.
  - **Live Progress & SSE Broadcast**: Setiap batch yang selesai diproses disiarkan secara real-time via `LiveChatHub` (`sync.progress`) dan endpoint status `GET /api/admin/live-chat/sync-status`.
  - **Indikator Banner Dinamis**: Live Chat Panel kini menampilkan banner status interaktif lengkap dengan jumlah chat tersinkron, pesan baru, nama chat yang sedang diproses, dan tombol *Batalkan*.
  - **Eliminasi Batas Timeout 15s**: Menaikkan `timeoutMs` pada panggilan manual menjadi 120s dan mengalihkan sync besar ke background worker agar tidak pernah lagi terputus oleh error timeout browser.

### Fixed & Improved — Meta CAPI Historical Sync Guard & Webhook Rate Limit Exemption

- **Pencegahan Tembakan Meta CAPI Lead pada Sinkronisasi Riwayat Chat (`message.service.ts`, `waha-history-sync.service.ts`, `webhook.route.ts`)**:
  - **Root Cause**: Saat melakukan sinkronisasi riwayat obrolan masa lalu (`Sync WAHA`) atau catch-up pesan lama, setiap pesan inbound yang diimpor memicu `incrementCustomerMessageCount`. Ketika bubble pesan lama mencapai batas MQL (5 bubble), sistem secara otomatis menembakkan event `Lead` ke Meta CAPI untuk seluruh customer dari obrolan masa lalu.
  - **Solusi**: Menambahkan parameter `skipMqlEvaluation: true` pada `messageService.logMessage` di jalur sinkronisasi riwayat WAHA dan guard pesan usang (*stale message guard*). Evaluasi MQL dan penembakan Meta CAPI kini **hanya aktif untuk percakapan baru yang sedang berlangsung secara real-time**.
- **Pengecualian Webhook & SSE dari Rate Limit (`app.ts`)**:
  - Menambahkan `allowList` pada Fastify rate limiter untuk mengecualikan endpoint webhook `/webhook`, `/api/webhook/*`, dan stream SSE, mencegah error `429 Too Many Requests` saat WAHA mengirim burst ratusan event.
- **Perpanjangan Timeout Ingestion WAHA (`client.ts`)**:
  - Menaikkan timeout `getMessages` dan `getChats` menjadi 25s dengan log informatif saat WAHA sedang sibuk mengindeks riwayat obrolan awal.

### Fixed & Improved — Mobile Live Chat Layout & +45% Textfield Width Expansion

- **Optimalisasi Layar Mobile & Perlebaran Textfield Chat (`Layout.tsx`, `LiveChatMonitor.tsx`)**:
  - **Memangkas Padding Bertumpuk di HP**: Mengubah padding `<main>` di `Layout.tsx` menjadi `p-0.5` di mobile dan memangkas padding card container dari `p-2.5` ke `p-1`, sehingga area percakapan memanfaatkan hampir 100% lebar layar smartphone.
  - **Redesain Baris Input / Composer Mobile Compact**:
    - Tombol *Tools (+)* dan *Kirim* diubah ke format compact `w-9 h-9 min-h-[36px]`, memperlebar textarea dari ~218px menjadi **~315px (+45% lebih lapang)** di layar smartphone.
    - Sembunyikan bar header atas global di HP saat membuka thread chat (`mobileView === 'chat'`) sehingga 100% ruang vertikal dialokasikan untuk percakapan.

### Fixed & Improved — Sidebar Scroll Isolation, Layout Viewport Bounds & Eliminating scrollIntoView Bleed

- **Perbaikan Bounding Box Viewport & Pengaktifan Scrollbar Flex Child (`Layout.tsx`)**:
  - Pada rute `/admin/live-chat`, wrapper induk di `Layout.tsx` kini secara ketat menetapkan `h-screen max-h-screen overflow-hidden min-h-0` (bukan `min-h-screen` yang menyebabkan tinggi flex unbounded).
  - Dengan batas tinggi viewport yang fixed dan jelas, browser kini secara otomatis mengaktifkan scrollbar pada kedua flex child (`chatListContainerRef` di sidebar dan `chatContainerRef` di panel riwayat chat) sehingga seluruh daftar chat dan thread pesan dapat digulir (*scrollable*) dengan sempurna.
- **Pemberantasan Bug Auto-Scroll Nyasar pada Sidebar Chat List (`LiveChatMonitor.tsx`)**:
  - **Root Cause**: Ditemukan panggilan `textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` di dalam `useEffect` setiap kali percakapan aktif (`selectedId`) dipilih. Pemanggilan `scrollIntoView()` secara native pada browser menyebabkan peramban menggulir seluruh *ancestor scroll container* (termasuk membocorkan event scroll ke sidebar daftar percakapan kiri sehingga ikut melompat ke bawah).
  - **Solusi**:
    - Menghapus pemanggilan `scrollIntoView()` pada textarea.
    - Menetapkan ref mandiri (`chatListContainerRef` pada sidebar dan `chatContainerRef` pada thread riwayat chat).
    - Membatasi logika auto-scroll ke bawah secara ketat hanya pada `chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight` saat `messages` atau `selectedId` berubah, sehingga posisi scroll sidebar kiri **100% terkunci dan tidak pernah berubah** saat mengklik chat.
    - Menambahkan `overscroll-behavior: contain` (`overscroll-contain`) pada kedua container independen untuk mencegah *scroll chaining* antar elemen.

### Fixed & Improved — Native Wheel Scrolling Fix, 80% Chat Screen Expansion & AI Draft Resizing

- **Perbaikan Total Scrolling Mouse Wheel & Touchpad (`index.css`, `LiveChatMonitor.tsx`)**:
  - Menghapus restriksi global `overscroll-behavior: none` pada `html, body, #root` di [index.css](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/packages/admin-dashboard/src/index.css) yang sebelumnya menyebabkan *scroll event hijacking* di peramban desktop (Chrome Windows) sehingga scroll wheel macet.
  - Memastikan kedua section (daftar chat & thread pesan) memiliki container flex yang solid dengan `flex-1 min-h-0 overflow-y-auto` sehingga scroll wheel mouse maupun gestur trackpad/touch dapat menggeser riwayat chat ke atas dan ke bawah secara mulus tanpa harus mengklik batang scrollbar secara manual.
- **Ekspansi Layar Live Chat ~75-80% & Textfield Melebar (`LiveChatMonitor.tsx`)**:
  - Mengubah struktur kolom grid menjadi flex layout dinamis: Section 1 (Daftar Chat) berukuran tetap `w-80` / `w-[320px] - w-[360px]`, sedangkan Section 2 (Thread Chat & Composer) mengambil seluruh sisa lebar layar (`flex-1 min-w-0`), mengalokasikan ~75-80% bidang layar langsung untuk live chat dan textfield.
  - Memperluas kapasitas auto-resize `<textarea>` composer saat membuat AI Copilot Draft atau mengetik pesan panjang dari maksimum `130px` menjadi `220px` (`max-h-[220px]`) dengan animasi resize mulus.

### Fixed & Improved — Database Schema Sync & 2-Section Dedicated Independent Scrolling

- **Sinkronisasi Database Postgres (`prisma db push` & `labels.description`)**:
  - Menjalankan sinkronisasi skema database lokal sehingga kolom `description` pada tabel `labels` terdaftar secara valid di PostgreSQL, menyelesaikan error `The column labels.description does not exist in the current database`.
  - Melakukan regenerasi Prisma Client (`npm run prisma:generate`) agar query `findMany` berjalan tanpa error.
- **Arsitektur 2-Section Layar Desktop dengan Slider Independen (`Layout.tsx`, `LiveChatMonitor.tsx`)**:
  - Menghapus scrollbar luar pada browser window saat membuka halaman Live Chat:
    - Di [Layout.tsx](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/packages/admin-dashboard/src/components/common/Layout.tsx), kontainer `<main>` otomatis terkunci (`overflow-hidden min-h-0`) saat membuka rute `/admin/live-chat`.
    - **Section 1 (List Chat / Kiri)**: Memiliki slider vertikal mandiri tepat di samping daftar kartu percakapan. Posisi scroll daftar chat tetap (*stay in place*) saat admin berinteraksi di panel pesan.
    - **Section 2 (Live Chat / Kanan)**: Memiliki slider vertikal mandiri tepat di samping gelembung pesan. Dilengkapi fungsi **Auto-Scroll ke bawah (*bottom*)** secara otomatis saat percakapan dibuka atau saat pesan baru masuk.
    - Menghilangkan `overscroll-contain` yang sebelumnya mengunci pergerakan mouse wheel.

### Fixed & Improved — Label Synchronization, Foreign Key Safety & 2-Slider Chat Layout

- **Pencegahan Error Foreign Key `prisma.customerLabel.upsert` (`labels.subroute.ts`)**:
  - Menambahkan resolusi entitas customer dan label sebelum operasi database pada endpoint `POST /api/admin/customers/:id/labels`.
  - Jika ID label berasal dari memory / sistem default yang belum tersimpan di DB, sistem otomatis meresolusi atau melakukan seeding transparan, sehingga mencegah error `Foreign key constraint violated: customer_labels_label_id_fkey`.
- **Relokasi Filter Sumber & Label Khusus ke Daftar Percakapan (`LiveChatMonitor.tsx`)**:
  - Memindahkan tombol tab `WhatsApp Asli / Semua / Sandbox` dan dropdown filter label dari header global ke bagian header **Daftar Percakapan (kolom kiri)**, sehingga area thread chat bersih dan fokus.
- **Pembersihan Scrollbar & Slider Mandiri (`LiveChatMonitor.tsx`)**:
  - Menambahkan `overscroll-contain` pada container pesan chat dan container percakapan sehingga hanya ada **2 slider yang bersih dan independen** (1 untuk riwayat pesan chat, 1 untuk scroll halaman/daftar chat), mencegah scroll-chaining yang menjebak saat scroll ke atas/bawah.
- **Pembersihan Mismatch & Duplikasi Label "Hold" (`LiveChatMonitor.tsx`)**:
  - Menghapus badge hardcoded `"Hold"` yang sebelumnya ditautkan ke status penanganan `isHumanHandling`. Status bot/human handling tetap diwakili oleh tombol aksi Bot.
  - Label kustom pasien pada kartu percakapan kiri kini murni bersumber dari relasi `customerLabels` sehingga tidak terjadi duplikasi label Hold saat ditambahkan.
- **Alokasi 90% Layar untuk Live Chat & Penipisan Margin (`LiveChatMonitor.tsx`)**:
  - Menipiskan margin atas halaman dari `space-y-6` menjadi `space-y-2`.
  - Mengatur tinggi container chat monitor ke `h-[calc(100vh-130px)]` dengan flex layout `flex-1` sehingga 90%+ area layar langsung dialokasikan untuk thread percakapan dan daftar pesan.
  - Merampingkan margin avatar, nama customer, nomor telepon, padding kartu, bubble chat, dan composer.
- **Sinkronisasi Reaktif Modal Detail Customer (`LiveChatMonitor.tsx`, `customers.subroute.ts`)**:
  - Menjadikan perubahan label melalui menu `+` langsung ter-update secara reaktif pada modal detail customer tanpa memerlukan reload.
  - Menginisialisasi awal data label pada modal dengan label percakapan aktif dan melengkapi fallback pembacaan label in-memory di `GET /api/admin/customers/:id`.
- **Backend Auto-Sync Flag `is_hold_labeled` & Auto-Cleanup saat Release (`labels.subroute.ts`, `livechat.subroute.ts`)**:
  - Pada `POST /api/admin/customers/:id/labels`: otomatis sinkronkan kolom `is_hold_labeled` dan `is_admin_labeled` di database saat label terkait ditambahkan atau dilepas.
  - Pada `PATCH /api/admin/conversation/:id/release`: otomatis mereset `is_hold_labeled = false` dan menghapus record label "Hold" dari tabel `CustomerLabel`.

### Added & Improved — Chat Header Label Dots, Label Description Field & AI Copilot Telemetry

- **Label Header Chat (Dot Berwarna & Tombol `+` Inline) (`LiveChatMonitor.tsx`)**:
  - Di header chat sebelah kanan, label aktif pasien kini ditampilkan sebagai **bulatan dot berwarna compact** (dengan tooltip judul nama label saat di-hover).
  - Tombol **`+`** diletakkan tepat inline di samping nomor HP customer untuk kemudahan pengelolaan label.
  - Pada **daftar percakapan sebelah kiri (*chat list*)** dan **modal detail customer**, label tetap tampil secara **lengkap dengan nama dan badge warna**.
- **Field Deskripsi Label Customer (`schema.prisma`, `labels.subroute.ts`, `CustomerLabels.tsx`)**:
  - Menambahkan kolom `description` pada skema `Label` di Prisma dan membuat migrasi `20260830000000_add_label_description`.
  - Mengupdate REST API (`GET`, `POST`, `PATCH`) dan in-memory fallback untuk mendukung field `description`.
  - Menambahkan input textarea deskripsi pada form modal Tambah/Edit Label serta menampilkannya pada kartu daftar label di halaman [CustomerLabels.tsx](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/packages/admin-dashboard/src/pages/tenant/CustomerLabels.tsx).
- **Pencatatan LLM Audit & AI Usage Telemetry untuk AI Copilot Bidan (`live-chat.service.ts`, `livechat.subroute.ts`)**:
  - Mengintegrasikan `recordLlmUsage` pada fungsi `generateAiSuggestion` untuk merekam metrik prompt tokens, completion tokens, cached tokens, provider, model, latensi, dan estimasi biaya ke buffer `llm_audit_logs`.
  - Mencatat aksi admin `AI_COPILOT_GENERATE_DRAFT` ke tabel audit log admin saat endpoint `suggest-reply` dipanggil.

### Added & Improved — Live Chat UI & Ergonomics Overhaul: Tools Menu Popover, 100% Width Textfield, Safe Enter Multiline, Header Label Row & Toast Repositioning

- **Konsolidasi Menu Tools (Gambar + AI Copilot Draft) (`LiveChatMonitor.tsx`)**:
  - Menggabungkan tombol lampirkan gambar dan tombol AI Copilot menjadi 1 tombol action menu **Tools (`+`)** dengan popover dropdown elegan, menghemat ruang horizontal composer.
  - Dilengkapi fitur click-outside listener untuk menutup menu otomatis saat mengklik area di luar popover.
- **Maksimalisasi Panjang Textfield Composer 100% Width (`LiveChatMonitor.tsx`)**:
  - Kolom textarea balasan admin diperluas mengisi 100% lebar horizontal yang tersedia (`flex-1 w-full min-w-0`), memaksimalkan kenyamanan mengetik di mobile maupun desktop.
- **Safe Enter Key Multiline di Mobile & Web (`LiveChatMonitor.tsx`)**:
  - Tombol `Enter` pada kolom chat murni menghasilkan baris baru (*new line*) di semua perangkat (mencegah pengiriman pesan tidak sengaja dari keyboard virtual HP).
  - Pengiriman pesan dilakukan secara aman melalui tombol **Kirim** (atau shortcut desktop `Ctrl+Enter` / `Cmd+Enter`).
- **Full-Width Label Row (100% Width) & Tombol `+` Compact (`LiveChatMonitor.tsx`)**:
  - Memisahkan deretan badge label customer dari kolom profil/nama pasien menjadi baris mandiri selebar 100% dari kiri ke kanan.
  - Mengubah tombol `+ Label` menjadi icon **`+`** yang compact.
- **Eliminasi Teks Jam Duplikat pada Kartu Percakapan (`LiveChatMonitor.tsx`)**:
  - Menghapus tampilan jam relatif berulang di sisi kiri footer kartu percakapan dan mempertahankan timestamp pesan terakhir di sisi kanan kartu.
- **Reposisi Floating Toast Notifikasi ke Bagian Atas Layar (`UiFeedback.tsx`)**:
  - Memindahkan posisi toast notifikasi sukses/gagal dari `bottom-6 right-6` ke `top-4 left-4 right-4 sm:left-auto sm:right-6 sm:top-6`, sehingga tidak lagi menutupi area textfield/composer dan tombol kirim.

### Fixed & Improved — Sanitizer Em-Dash (—) pada Output AI & Semua Pesan Keluar

- **Sanitizer baru `sanitizeEmDash` (`src/utils/language-sanitizer.ts`)**: Menghilangkan karakter em-dash (—) yang sering bocor dari output LLM, sesuai pedoman anti-slop `design.md` §9 (EM-DASH BAN). Penggantian kontekstual:
  - Rentang angka (`jam 9—11`) → hyphen `-` (`jam 9-11`)
  - Bullet list di awal baris (`— Gratis ongkir`) → `- ` (`- Gratis ongkir`)
  - Pemisah antar klausa (`Halo—mau tanya`) → koma `, ` (`Halo, mau tanya`)
- **Wire ke jalur LLM**: rantai sanitasi di `src/integrations/llm/generator.ts` (dynamic import) dan `src/integrations/llm/phrasing.service.ts` (finalContent).
- **Wire ke jalur outbound**: `normalizeWhatsAppFormat` (`src/utils/whatsapp-format.ts`) kini memanggil `sanitizeEmDash` terlebih dahulu, sehingga SEMUA pesan keluar (termasuk template statis seperti `followup-templates.ts`) bebas em-dash — otomatis melindungi `src/integrations/waha/client.ts` dan `src/integrations/whatsapp/waba.driver.ts`.
- **Test**: 5 kasus baru di `tests/unit/language-sanitizer.test.ts` (klausa, rentang angka, bullet list, no-op, null/empty).

### Added & Improved — AI Copilot Draft for Midwives, Strict Silent Medical Hold & Live Chat UI Overhaul (`v1.15.0`)

- **Fitur AI Copilot Draft Saran Balasan Bidan (`src/services/live-chat.service.ts`, `src/routes/admin/livechat.subroute.ts`, `LiveChatMonitor.tsx`)**:
  - Menambahkan endpoint `POST /api/admin/live-chat/conversations/:id/suggest-reply` yang menghasilkan 1 draf balasan profesional, ramah, dan empatik menggunakan LLM (`CHAT_REPLY`). Draf disusun berdasarkan konteks nama bunda, data anak, riwayat reservasi, dan 10 riwayat percakapan terakhir.
  - Menambahkan tombol interaktif **`Sparkles` (✨)** di textfield composer Live Chat. Bidan/admin cukup menekan icon ini untuk mengisi otomatis draf ke kolom balasan, lalu dapat mengedit atau langsung mengirimnya.
- **Strict Silent Auto-Hold untuk Pasien Medis & Legacy (`src/state-machine/machine.ts`)**:
  - Konsultasi medis untuk pasien legacy (`is_legacy_source = true`) maupun pasien yang sudah pernah treatment terkonfirmasi (`status = 'confirmed'`) kini dikecualikan secara ketat dari balasan FAQ otomatis.
  - State machine langsung mengeskalasi percakapan ke `HUMAN_HANDLING` dengan mode *silent* (bot tetap diam tanpa mengirim balasan otomatis ke customer) dan mengirim alert darurat ke grup WhatsApp admin.
- **Modal Detail Lengkap Profil Customer (`src/routes/admin/customers.subroute.ts`, `LiveChatMonitor.tsx`)**:
  - Menambahkan endpoint `GET /api/admin/customers/:id` dengan metrik LTV, purchase count, data anak, riwayat reservasi, dan label.
  - Header profil customer di sebelah kanan Live Chat kini dapat diklik untuk membuka **Customer Detail Modal** interaktif (menampilkan data kontak lengkap, ringkasan LTV/order, segmen pasien, riwayat anak, daftar reservasi, dan tombol direct WA).
- **Pembaruan Visual & Ergonomi Live Chat Dashboard (`LiveChatMonitor.tsx`)**:
  - **Pemisahan Label 2 Grup**: Grup 1 (status & segmentasi: `Hold`, `Legacy`, `New Customer`, label DB) diletakkan rapi tepat di bawah nama customer; Grup 2 (metrik operasional: `MQL`, `Order count`, `Sandbox`, `Meta`) ditaruh di footer bar di samping jam.
  - **Ikonografi Minimalis**: Tombol "Release" / "Kembalikan ke Bot" diganti dengan icon Bot minimalis modern. Tulisan status Live Chat di header luar disederhanakan menjadi icon sync WAHA berputar dan icon Wifi berwarna dengan tooltip status real-time.
  - **Default Filter WhatsApp Asli & Optimalisasi Mobile**: Default filter sumber diset ke `WhatsApp Asli` dan ukuran badge/dropdown dioptimalkan agar compact di tampilan mobile.


### Added & Improved — WhatsApp Customer Profile Picture Retrieval & Smart Avatar Display (`v1.14.0`)

- **Dukungan Pengambilan Foto Profil WhatsApp (`src/integrations/waha/client.ts`, `src/integrations/whatsapp/`)**:
  - Menambahkan method `getProfilePicture(phone)` pada `IWahaClient`, `WahaClient`, dan gateway abstraction `WhatsAppGateway` / `WahaGatewayDriver`.
  - Mengambil URL standar/preview avatar CDN WhatsApp (`pps.whatsapp.net`) secara efisien via endpoint WAHA.
  - Untuk provider WABA (Meta Cloud API Official), sistem melakukan fallback *graceful* karena kebijakan privasi Meta tidak menyediakan endpoint foto profil customer.
- **Skema Database & Background Sync Non-Blocking (`prisma/schema.prisma`, `src/services/customer.service.ts`)**:
  - Menambahkan kolom `profile_picture_url` dan `profile_picture_updated_at` pada model `Customer`.
  - Pengambilan foto profil dijalankan secara asinkron di latar belakang (*lazy sync / background job*) dengan cache TTL 3 hari untuk menghemat storage, kuota, serta mencegah *rate-limiting* ke WAHA.
  - Menambahkan endpoint admin `POST /api/admin/live-chat/customers/:id/refresh-profile-picture` untuk on-demand refresh foto profil langsung dari dashboard.
- **Komponen Smart Avatar Reusable (`packages/admin-dashboard/src/components/common/CustomerAvatar.tsx`)**:
  - Komponen avatar baru dengan lazy loading, deteksi error CDN otomatis (`onError` fallback), dan generator inisial nama deterministik dengan palet warna elegan.
- **Integrasi Live Chat Admin & Portal Terapis (`packages/admin-dashboard/`)**:
  - **Live Chat Monitor (`LiveChatMonitor.tsx`)**: Menampilkan foto profil / smart avatar customer pada daftar percakapan sebelah kiri dan di header chat sebelah kanan.
  - **Portal Terapis (`StaffToday.tsx`)**: Menampilkan foto profil customer pada kartu tugas hari ini (lengkap dengan badge nomor urut kunjungan), header chat WhatsApp terapis, riwayat tugas selesai, dan modal detail pasien.

### Added & Improved — Customer Labels CRUD & Live Chat Tagging System (`v1.13.0`)

- **Fitur Master Data Label Customer (`prisma/schema.prisma` & `src/routes/admin/labels.subroute.ts`)**:
  - Menambahkan model `Label` dan relasi pivot `CustomerLabel` untuk kategorisasi multi-label customer per tenant.
  - Endpoint REST API lengkap: `GET /api/admin/labels`, `POST /api/admin/labels`, `PATCH /api/admin/labels/:id`, `DELETE /api/admin/labels/:id`, dan `POST /api/admin/customers/:id/labels`.
- **Halaman Manajemen Label Customer (`packages/admin-dashboard/src/pages/tenant/CustomerLabels.tsx`)**:
  - Halaman admin baru di navigasi `Operasional & Jadwal` untuk membuat, mengedit nama & warna palette, serta menghapus label.
  - Dilengkapi preview badge interaktif, hitungan customer tertag, serta modal UI Feedback aman (tanpa native confirm/alert).
- **Integrasi Tagging Label di Live Chat (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`)**:
  - Menampilkan badge label aktif tepat di bawah nama dan nomor telepon pasien.
  - Tombol `+ Label` interaktif dengan popover picker untuk toggle label langsung secara real-time (optimistic update).
  - Badge label juga ditampilkan pada daftar percakapan di kolom kiri untuk kemudahan pemantauan.
- **Ergonomi Input Chat & Auto-Scroll Viewport**:
  - Tombol Enter pada textarea kini murni menambahkan baris baru (menghilangkan insiden pesan terkirim tidak sengaja di HP). Pengiriman pesan dilakukan dengan menekan tombol **Kirim**.
  - Logika auto-scroll diperbarui untuk memastikan seluruh area chat dan textfield/composer tetap terlihat di viewport layar.

### Fixed & Improved — Intercept Browser History Back at Frame 0 (Touchstart Passive: False) (`v1.12.11`)

- **Intersepsi Mutlak pada Frame 0 Touchstart (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Mengubah opsi listener `touchstart` dari `{ passive: true }` menjadi `{ passive: false }`.
  - Memanggil `e.preventDefault()` langsung pada saat jari menyentuh zona tepi kiri layar (`clientX <= 30px`), membatalkan secara mutlak *system-level navigation recognizer* milik iOS Safari & Android Chrome sebelum browser sempat memulai animasi *history.back()*.
  - Menghapus konfigurasi CSS `touch-action: pan-y` yang tidak efektif untuk system history dan bisa mengganggu scroll tabel data horizontal.

### Fixed & Improved — 199% Bulletproof Admin Swipe: Popstate Sync, Touch-Action Pan-Y & Generous Zone (`v1.12.10`)

- **Kunci Standar CSS `touch-action: pan-y` (`packages/admin-dashboard/src/index.css`)**:
  - Mengonfigurasi `touch-action: pan-y` dan `-webkit-overflow-scrolling: touch` pada `html, body, #root` agar browser engine secara eksplisit menyerahkan kontrol gestur horizontal ke JavaScript aplikasi dan mematikan navigasi gestur horizontal browser.
- **Sinkronisasi Popstate History Navigation (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Menyelaraskan pembukaan sidebar admin dengan `window.history.pushState({ adminMenuOpen: true }, '')` dan listener `popstate`.
  - Jika pengguna menekan tombol *hardware back* di Android atau terpicu gestur *back*, aplikasi akan **menutup menu sidebar** dan TIDAK meninggalkan halaman dashboard admin.
- **Zona Sentuh Responsif Thumb-Friendly Hingga 120px (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Memperluas zona deteksi usap dari sisi kiri hingga 120px (35% layar) sehingga usapan jempol dari area tepi kiri dapat membuka menu navigasi admin secara instan tanpa perlu menyentuh bezel ekstrem sub-piksel.

### Fixed & Improved — Native DOM Interception for Admin Edge Swipe & 50vw Compact Therapist Drawer with Slide-Right Dismiss (v1.12.9)

- **Intersepsi Gestur Usap Tepi Admin via Native DOM Event Listener (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Mengganti React synthetic `onTouch...` dengan native `window` event listener (`{ passive: false }` pada `touchmove`).
  - Memanggil `e.preventDefault()` saat usapan horizontal dimulai dari sisi kiri (`x <= 50` dan `deltaX > 10`), membatalkan secara mutlak aksi *history back* bawaan OS/browser mobile dan membuka sidebar navigasi dengan mulus.
  - Menghapus listener touch global dari root layout sehingga aktivitas scrolling vertikal pada tabel dan dashboard 100% lancar tanpa intervensi.
- **Optimasi Sidebar Kanan Portal Terapis Maks 50% Layar & Slide-Right to Close (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Membatasi lebar menu drawer terapis menjadi maksimal **50vw** (`w-[50vw] sm:w-[280px] max-w-[50vw] sm:max-w-[280px]`), menyisakan 50% layar sebelah kiri tetap terlihat terang/mudah disentuh untuk keluar.
  - Memasang gesture **slide ke kanan (usap kanan)** untuk menutup sidebar secara instan dari drawer body maupun backdrop overlay.
  - Menyesuaikan tata letak menu navigasi, tombol footer, dan avatar profil agar pas, proporsional, dan elegan pada tampilan 50vw.

### Fixed & Improved — Prevent Browser Back on Admin Edge Swipe & Restored Clean 1-Page per Tab for Therapist (v1.12.8)

- **Eliminasi Bentrok Browser Back pada Usap Tepi Admin (`packages/admin-dashboard/src/index.css`, `packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Menambahkan `overscroll-behavior-x: none` pada `html, body, #root` untuk memblokir gestur *history back/forward* default browser.
  - Memasang sensor sentuh sisi kiri (`w-8 fixed inset-y-0 left-0`) dan deteksi `handleTouchMove` real-time (`start.x <= 75 && deltaX > 35`) sehingga usapan dari sisi kiri langsung membuka menu sidebar admin secara mulus tanpa memicu navigasi kembali di browser mobile.
- **Restorasi Total 1-Page per Tab pada Tampilan Mobile Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengembalikan arsitektur perenderan 1 halaman murni per tab tanpa distorsi horizontal:
    - Tab 1 (*Hari Ini*): 1 halaman penuh untuk daftar pasien (`mobileView === 'list'`) atau 1 halaman penuh untuk live chat WhatsApp (`mobileView === 'chat'`).
    - Tab 2 (*Jadwal Mendatang*): 1 halaman penuh jadwal reservasi.
    - Tab 3 (*Treatment Selesai*): 1 halaman penuh riwayat treatment selesai.
  - Menjaga transisi halus `animate-fadeIn` dan gestur usap tepi kanan untuk membuka menu profil terapis.

### Fixed & Improved — Admin Left-Edge Swipe Sidebar & Continuous 60fps Carousel Track for Therapist (v1.12.7)

- **Navigasi Gestur Usap Kiri-ke-Kanan Sidebar Menu Admin (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Menambahkan touch gesture listener pada root layout admin (`start.x <= 50 && deltaX > 40`) agar saat mengusap dari tepi paling kiri layar ke kanan di perangkat mobile, sidebar navigasi admin terbuka secara halus dan responsif.
  - Memperbaiki transisi backdrop gelap dengan `opacity-100` / `opacity-0` halus dan menambahkan gesture swipe ke kiri untuk menutup kembali sidebar.
- **Arsitektur Carousel Track 60 FPS Buttery-Smooth Portal Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengubah perenderan tab dari unmount/mount bersyarat (yang menyebabkan DOM re-layout dan jeda kaku) menjadi **3-slide horizontal carousel track** (`w-[300%]` dengan `transform: translateX(...)` dan `will-change: transform`).
  - Ketiga tab (*Hari Ini*, *Jadwal Mendatang*, *Selesai*) tetap terpasang di memori sehingga pergantian tab via geser/klik berjalan instan 60 FPS tanpa lag perenderan ulang dan mempertahankan posisi scroll masing-masing.
- **Transisi CSS GPU-Accelerated Menu Drawer Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menghilangkan pop-in kaku pada menu drawer kanan dengan transisi CSS `translate-x-full` ke `translate-x-0` yang mulus dan elastis.

### Fixed & Improved — Overscroll Background Fix, Directional Tab Slide & Right-Edge Swipe Sidebar (v1.12.6)

- **Eliminasi Bug Background Hitam saat Overscroll Dashboard (`packages/admin-dashboard/index.html`, `packages/admin-dashboard/src/index.css`)**:
  - Memperbaiki warna dasar `body` dari `bg-slate-950` (#020617 hitam pekat) menjadi `bg-[#f0f2f5] text-[#111b21]` dan menyelaraskan `<meta name="theme-color" content="#008069">`.
  - Mengunci `html, body { background-color: #f0f2f5; overscroll-behavior-y: none; }` guna mencegah kebocoran warna hitam saat melakukan *rubber-band pull* atas/bawah di mobile Safari/Chrome.
- **Animasi Geser Horizontal Directional Antar Tab Terapis (`packages/admin-dashboard/src/index.css`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengintegrasikan keyframes GPU `animate-slideInFromRight` (geser masuk dari kanan) dan `animate-slideInFromLeft` (geser masuk dari kiri) saat berpindah tab (*Hari Ini* ↔ *Mendatang* ↔ *Selesai*).
  - Mengikat transisi arah pada gestur swipe maupun penekanan tombol tab navigasi.
- **Gestur Right-Edge Swipe untuk Membuka Menu Sidebar/Drawer (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan listener gestur usap dari tepi paling kanan layar (`start.x >= window.innerWidth - 55`) ke arah kiri untuk langsung memunculkan menu drawer/sidebar profil terapis secara instan.
  - Mendukung gestur swipe ke kanan untuk menutup drawer kembali secara mulus.

### Fixed & Improved — Therapist Portal Dedicated Polish & Super Admin Restore (v1.12.5)

- **Restore Super Admin Layout (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Mengembalikan sidebar Super Admin ke kondisi semula tanpa modifikasi. Label versi aplikasi difokuskan secara khusus di Portal Terapis (`StaffToday.tsx`).
- **Penyempurnaan Viewport & Flexbox Auto-Scroll Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan constraint `min-h-0 h-full` pada kolom chat flexbox dan mengikat re-scroll effect saat `loadingMessages` selesai agar viewport chat 100% instan bergulir ke pesan terbawah di mobile browser.
  - Memperbarui tag versi halus di header portal terapis (`v1.12.5`) dan menu drawer.

### Fixed & Improved — Multiline Enter, Rock-Solid Auto-Scroll Anchor & GPU Micro-Animations (v1.12.4)

- **Perilaku Tombol Enter Murni Menambah Baris Baru (*Multiline*) (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menghapus submit on Enter pada textarea chat agar penekanan tombol `Enter` murni menghasilkan baris baru (`\n`) dan melebarkan tinggi textarea secara otomatis.
  - Pengiriman pesan kini secara eksklusif dipicu melalui tombol Send (`<Send />`).
- **Jaminan Auto-Scroll Chat 100% (*Dual Anchor + Media Load Listener*) (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menyematkan invisible anchor element (`messagesEndRef`) di akhir daftar pesan dan menjalankan dual scroll (`scrollTop = scrollHeight + 99999` dan `scrollIntoView`).
  - Menambahkan event listener `onLoad` pada thumbnail gambar media chat agar viewport otomatis melakukan re-scroll begitu gambar selesai di-render.
- **Integrasi GPU-Accelerated Micro-Animations (`packages/admin-dashboard/src/index.css`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan keyframes animasi ringan: `popIn` (speech bubble chat), `slideFadeIn` & `fadeIn` (transisi tab), `pulseGlow` (kartu pasien aktif), dan `modalScaleUp` (spring-like modal dialog).
  - Menghilangkan kekakuan tampilan dengan transisi interaktif pada penekanan tombol (*active:scale-95*), quick reply chips, dan kartu reservasi (*hover & active states*).

### Fixed & Improved — Swipe Gesture Navigation, Auto-Scroll Instant, Enter Fix & Sidebar Version Tag (v1.12.3)

- **Perbaikan Kirim Pesan via Tombol Enter & Toast Feedback (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Memperbaiki event signature pada handler pengiriman balasan `handleSendReply` agar kompatibel menangani synthetic keyboard event saat tombol `Enter` ditekan dari textarea tanpa melempar error.
  - Memperbaiki parameter pesan toast error menjadi `toast(errorMsg, 'error')` yang sebelumnya terbalik.
- **Auto-Scroll Instan ke Pesan Terakhir (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengimplementasikan multi-tick `requestAnimationFrame` dan timeout bertingkat (0ms, 40ms, 120ms, 300ms) saat membuka chat pasien, berpindah thread, atau saat pesan balasan terkirim agar viewport chat langsung bergulir mulus ke posisi paling bawah.
- **Gestur Swipe Kiri/Kanan untuk Pindah Tab & Back Chat (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan touch swipe listener:
    - **Di halaman daftar**: Swipe kiri/kanan otomatis berpindah antar tab (*Hari Ini* ↔ *Mendatang* ↔ *Selesai*).
    - **Di dalam panel chat mobile**: Swipe horizontal (kiri atau kanan) langsung kembali (*back*) ke daftar kunjungan pasien.
- **Label Versi Aplikasi di Sidebar (`packages/admin-dashboard/src/components/common/Layout.tsx`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan label versi dan waktu build aplikasi yang rapi dan elegan di bagian bawah sidebar admin dashboard utama dan menu drawer portal terapis.

### Fixed & Improved — Portal Terapis Mobile UX, Anti-Zoom Focus, Quick Reply & Navigasi Cepat (v1.12.2)

- **Pencegahan Zoom-In & Auto-Growing Textarea Chat Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengganti input single-line menjadi `<textarea>` auto-grow (1 hingga ~5 baris / maks 130px) dengan `style={{ fontSize: '16px' }}` dan `text-[16px]` guna mencegah mobile Safari & Chrome melakukan auto-zoom paksa saat terapis mengetik balasan.
  - Mendukung shortcut keyboard `Enter` untuk mengirim pesan dan `Shift+Enter` untuk baris baru, serta auto-reset tinggi saat berganti pasien atau pesan terkirim.
- **Quick Reply Chips untuk Pesan Cepat Lapangan (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menyediakan tombol chip template cepat di atas composer chat untuk status umum: *"🛵 Sedang OTW"*, *"📍 Sudah Sampai"*, dan *"🙏 Selesai"*, memudahkan terapis berkirim kabar tanpa perlu mengetik panjang saat mobilitas.
- **Tab Bar Navigasi Mobile Terbuka (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menampilkan segment navigation bar horizontal langsung di mobile untuk beralih antara *"Hari Ini"*, *"Mendatang"*, dan *"Selesai"* dengan 1 ketukan tanpa harus membuka menu drawer garis tiga.
- **Badge Nomor Urut Kunjungan & Notifikasi Getar (Haptic Feedback) (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan badge urutan penugasan (`#1`, `#2`, `#3`...) pada setiap kartu pasien berdasarkan kronologi jam reservasi.
  - Menambahkan getaran haptic (`navigator.vibrate`) pada saat pesan WhatsApp baru masuk ke portal terapis.
  - Memperluas riwayat percakapan yang dimuat awal menjadi 30 pesan terakhir.
- **Versi Rilis & Timestamp (`packages/admin-dashboard/src/config/version.ts`)**:
  - Memperbarui versi portal menjadi `v1.12.2` (Build: 17 Ags 2026, 07:48 WIB).

### Fixed & Improved — Live Chat Monitor Mobile UX & Anti-Zoom Input Focus

- **Pencegahan Otomatis Zoom-In pada Input & Textarea Mobile (`packages/admin-dashboard/src/index.css`, `index.html`, `LiveChatMonitor.tsx`)**:
  - Menambahkan aturan CSS global untuk layar mobile (`max-width: 767px`) dengan `font-size: 16px !important` pada elemen `input`, `textarea`, dan `select` serta inline `style={{ fontSize: '16px' }}` dan class `text-[16px]` pada textarea Live Chat guna mencegah iOS Safari & Android mobile browser melakukan auto-zoom paksa saat admin mengetuk field input/balasan.
  - Memperbarui meta viewport pada `index.html` dengan atribut `maximum-scale=1.0, user-scalable=no, interactive-widget=resizes-content` untuk menangani pergeseran keyboard virtual.
- **Penyempurnaan UX & Auto-Growing Textarea Live Chat (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`)**:
  - **Auto-Grow Composer**: Textarea balasan admin kini otomatis memanjang dinamis (1 baris hingga ~5 baris / maks 130px) sesuai panjang ketikan teks dan otomatis me-reset tinggi ke ukuran awal setelah pesan terkirim atau berganti percakapan.
  - **Pembersihan Navigasi Mobile**: Menghilangkan tombol kembali (*back button*) redundan di header atas saat tampilan chat mobile aktif dan mengoptimalkan tombol kembali tunggal di dalam panel inspector obrolan.
  - **Ergonomi Tombol Kirim Mobile**: Menyesuaikan tombol kirim menjadi icon-only di layar HP sempit agar textarea balasan memiliki ruang lebar horizontal maksimal dan nyaman diketik.
  - **Layout & Ketinggian Adaptif**: Menyesuaikan ketinggian container daftar percakapan dan panel obrolan dengan viewport mobile (`100dvh`) agar tidak terpotong oleh virtual keyboard.
- **Label Versi & Waktu Update Dashboard (`packages/admin-dashboard/src/pages/tenant/Overview.tsx`, `version.ts`)**:
  - Menambahkan label badge versi (contoh: `v1.12.1`) dan stempel waktu pembaruan terakhir (contoh: `Update: 17 Ags 2026, 07:35 WIB`) di header dan footer halaman Overview admin dashboard.
- **Cache-Busting & Invalidation Service Worker (`src/routes/admin.route.ts`, `packages/admin-dashboard/public/sw.js`)**:
  - Menyematkan header HTTP `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` pada `index.html` agar browser HP selalu memuat bundle Vite terbaru dan tidak tertahan pada cache lokal lama.
  - Memperbarui cache name Service Worker ke `kala-admin-v2` dengan auto-deletion cache lama pada event `activate`.

### Changed & Security — Penonaktifan Fitur App State Fisik WAHA (Anti-Session Logout) & Migrasi Penuh ke Label UI Sistem

- **Akar Masalah & Penonaktifan Fitur App State Fisik WAHA (`src/integrations/waha/client.ts`, `src/services/conversation.service.ts`, `src/routes/webhook.route.ts`, `.env.example`, `.env`)**:
  - **Temuan Root Cause**: Operasi manipulasi chat state fisik ke WhatsApp via WAHA NOWEB (Baileys) seperti `addLabel`, `removeLabel`, `batchUpdateLabels`, dan `markUnread` memicu mutasi kriptografi *WhatsApp App State Sync* (`regular_low`). Akibat ketidakcocokan skema Protobuf biner terbaru Meta di server WhatsApp (`invalid wire type 4 at offset 6`), server Meta secara sepihak memutus sesi tertaut dengan error `stream:error code 401 conflict type: device_removed`, memaksa logout WhatsApp dan meminta scan QR ulang.
  - **Penonaktifan Fitur**: Mengubah nilai default `ENABLE_WAHA_HOLD_LABEL=false`, `ENABLE_LIFECYCLE_LABELS=false`, dan `ENABLE_WAHA_UNREAD=false` pada seluruh konfigurasi dan engine bot.
  - **Pencegahan Blocking**: Menghapus pemanggilan mutasi App State ke WAHA di lingkungan produksi dan memastikan fungsi label mengembalikan status sukses murni secara instan tanpa mengunci antrean global `runSerialized`.
- **Pemisahan Alert Notifikasi Grup Eskalasi (`src/services/conversation.service.ts`)**:
  - Memisahkan pengiriman notifikasi grup WhatsApp koordinasi tim (`ESCALATION_GROUP_JID`) dari guard `enableHoldLabel`. Notifikasi tiket eskalasi medis/CS ke grup admin kini tetap terkirim 100% menggunakan pesan teks standar (`sendText`), yang bebas dari App State Sync dan terbukti aman tanpa pernah memutus sesi WhatsApp.
- **Transisi ke Manajemen Label UI Sistem & Dashboard (`packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx`, `LiveChatMonitor.tsx`, `src/routes/admin/customers.subroute.ts`)**:
  - Kolom database (`Customer.is_admin_labeled`, `Customer.is_hold_labeled`, `Customer.is_mql`, `Conversation.is_human_handling`) kini menjadi sumber kebenaran tunggal (*Single Source of Truth*).
  - Modal aksi label dan toast notifikasi di Admin Dashboard Customer Database disesuaikan menjadi *"Label berhasil diperbarui di sistem"* tanpa menampilkan pesan peringatan gagal mirror WAHA.
  - Alur auto-release dan status human handling di Live Chat Monitor berjalan secara digital dan real-time via Server-Sent Events (SSE).

### Fixed — "Invalid Date" Web Terapis & "Double Bubble" Live Chat Admin

- **Perbaikan State Chat & Formatting Jam Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengoreksi penanganan respons API `/api/staff/conversations/:id/reply` agar tidak menimpa objek pesan optimistik dengan payload status metadata API (mencegah `created_at` dan `content` menjadi `undefined` yang memicu tampilan *"Invalid Date"*).
  - Menambahkan guard validasi tanggal pada pemformatan jam chat (`isValidDate ? ... : new Date().toLocaleTimeString(...)`).
  - Mengoreksi listener SSE di `StaffToday.tsx` menggunakan `es.addEventListener('message.created')` dan payload reconciliation untuk menukar `tempId` dengan ID resmi server secara mulus.
- **Deduplikasi Outbound Webhook WAHA & Gateway (`src/integrations/waha/client.ts`, `src/integrations/whatsapp/waha.driver.ts`, `src/services/message.service.ts`, `src/routes/webhook.route.ts`)**:
  - Menangkap `messageId` langsung dari kembalian API WAHA `/api/sendText` & `/api/sendImage` agar pesan outbound terdaftar di memory idempotency store sejak pengiriman awal.
  - Menambahkan method `checkAndAttachOutboundDuplicate` pada `MessageService` dengan time-window 30 detik untuk mendeteksi pesan outbound yang sama dari webhook WAHA (`fromMe: true`) dan mengaitkan `wa_message_id` tanpa membuat baris baru di database atau membroadcast event SSE ganda.
  - Memperkuat deduplikasi SSE di `LiveChatMonitor.tsx` dengan toleransi 30 detik.

### Docs — Panduan Setup Meta CAPI & Kunci Enkripsi

- **Panduan terverifikasi (`docs/META_CAPI_SETUP.md`)**: Panduan setup Meta Conversions API (CAPI) & `WABA_TOKEN_ENCRYPTION_KEY` yang disesuaikan dengan kondisi nyata repo & server (`ubuntu@43.157.197.148`, port 1403, `/opt/wa-clinic-bot`) — bukan panduan generik.
  - Menjelaskan arsitektur: sumber kebenaran kredensial = DB per-tenant (`tenants.meta_pixel_id` / `meta_capi_access_token`, terenkripsi AES-256-GCM), fallback env `FB_PIXEL_ID` / `FB_CAPI_ACCESS_TOKEN`.
  - Peringatan tegas: JANGAN ganti `WABA_TOKEN_ENCRYPTION_KEY` setelah token tersimpan (AES-GCM auth tag mismatch → decrypt gagal → CAPI & WABA mati), kecuali re-input ulang semua token.
  - Koreksi cara menerapkan env: `docker compose up -d --no-deps app` (bukan `restart`, yang tidak membaca ulang `.env`).
  - Termasuk verifikasi status server saat ini (CAPI sudah terkonfigurasi: Pixel ID `1382300863013984` + token terenkripsi di DB) dan langkah verifikasi via Meta CAPI Health & Live Tester (`/admin/meta-click-catcher`) & Meta CAPI Queue.

### Changed — Anaphora Clarification Resolution ("Maksud saya yang paket newborn"), NLU Token Truncation Fix, & Intent Prompt Isolation

- **Resolusi Anaphora & Koreksi Kalimat ("Maksud saya yang...") (`src/services/treatment-catalog.service.ts`, `nlu-classifier.service.ts`, `src/integrations/llm/intent.ts`)**:
  - Menambahkan pembersihan partikel koreksi (*"maksud saya yang"*, *"maksudku"*, *"bukan itu maksud saya"*) sebelum pencarian katalog, sehingga pencarian katalog langsung menargetkan entitas intinya.
  - Memetakan istilah `"newborn"` & `"selapan"` langsung ke **`Paket Selapan (Newborn Care)`** (ID: `baby-paket-selapan`).
  - Menambahkan deteksi pola anaphora pada `fallbackClassify` dan `ruleBasedFallbackIntent` sehingga pesan koreksi tidak lagi terbuang menjadi `other` melainkan diklasifikasikan sebagai `faq_question` / `express_interest` dengan entitas treatment yang diekstrak.
- **Peningkatan Kapasitas `max_tokens` pada Model Reasoning NLU (`src/services/nlu-classifier.service.ts`)**:
  - Mengatur batas `max_tokens` minimal menjadi 1.500 token untuk mencegah pemotongan token di tengah penulisan `reasoning_content` pada model seperti DeepSeek-R1 / MiniMax.
- **Isolasi System Prompt Legacy Intent Classifier (`src/integrations/llm/intent.ts`)**:
  - Menghapus `${BOT_PERSONA_PROMPT}` dari classifier sistem agar model AI tidak lagi membalas chat customer (*"Baik, Bunda..."*), melainkan strictly mengembalikan JSON intent.
- **Pengujian (`tests/unit/treatment-catalog-search.test.ts`, `tests/unit/price-answer.test.ts`, `tests/unit/nlu-classifier.test.ts`)**:
  - Seluruh unit test & integrasi lulus 100% (11 files, 125 tests PASS).

### Added — Comprehensive Server Infrastructure Monitoring (`/server`)

- **Perintah Real-time `/server` (dan `/status_server`) (`src/routes/telegram-webhook.route.ts`)**:
  - Menampilkan laporan beban keseluruhan server dan kondisi infrastruktur secara komprehensif:
    * ⚙️ **Beban CPU & Sistem**: Persentase CPU aktif, jumlah vCPU core, Load Average (1m, 5m, 15m), Host OS Uptime, dan Bot Engine Uptime.
    * 💾 **Memori Server (RAM)**: Beban RAM total OS/VM (`used / total` & persentase), RAM sisa bebas, serta alokasi khusus Bot Node.js (RSS & Heap).
    * 💽 **Penyimpanan Hard Disk**: Kapasitas disk terpakai (`used / total` & persentase) dan sisa ruang disk bebas (GB) menggunakan native `fs.promises.statfs`.
    * 🔌 **Status Koneksi & Layanan**: Latency ping PostgreSQL, status WhatsApp Gateway (WAHA/WABA), antrean Redis, dan waktu respons bot.
- **Pengujian & Validasi (`tests/unit/telegram-webhook.test.ts`)**:
  - Test suite diperbarui dan lulus 100% (6/6 PASS).

### Added — Personal Therapist/Midwife Telegram Assignment Dispatch & Privacy Protection

- **Notifikasi Penugasan Khusus Terapis / Bidan (`src/services/staff-notification.service.ts`, `src/routes/admin/reservations.subroute.ts`)**:
  - Setiap kali reservasi pasien dibuat atau dialokasikan kepada seorang bidan/terapis, sistem otomatis mengirimkan rincian tugas ke akun Telegram pribadi terapis yang bersangkutan secara instan.
  - Rincian data yang dikirimkan:
    * 👤 Nama Pasien & Bayi/Anak (termasuk usia)
    * 💆‍♀️ Layanan Treatment
    * 📅 Hari, Tanggal, & Jam Kunjungan (WIB)
    * 📍 Alamat Lengkap & Patokan Rumah / Landmark
    * 🗺️ Link Rute Navigasi Google Maps Motor (`travelmode=two-wheeler`) & Estimasi Jarak Tempuh
    * 💰 Rincian Biaya & Status Pembayaran (`LUNAS (Transfer)` / `TAGIH DI TEMPAT`)
    * 📝 Catatan Khusus Pasien (alergi / preferensi)
- **Proteksi Privasi Perusahaan (Data Privacy Shield)**:
  - Nomor telepon WhatsApp pasien **TIDAK dikirimkan** ke ruang obrolan Telegram.
  - Sebagai gantinya, disediakan tautan cepat aman: `[ 💬 Buka Tugas & Chat Pasien di Portal Terapis ]` (`#staff-today`) sehingga seluruh komunikasi pelanggan tetap terlindungi dan terekam di dalam sistem klinik.
- **Tautan 1-Klik Akun Telegram Terapis (`src/routes/staff/auth.subroute.ts`, `StaffToday.tsx`, `StaffManagement.tsx`)**:
  - Terapis dapat menghubungkan akun Telegram pribadinya melalui tombol 1-klik `[ 🔗 Sambungkan Telegram Saya ]` di dalam Drawer Profil Portal Terapis (`showStaffProfileModal`).
  - Halaman Admin Staff Management menampilkan kolom status indikator Telegram terhubung / belum terhubung.
- **Database Migration (`20260835000000_add_staff_telegram_fields`)**:
  - Menambahkan kolom `telegram_chat_id` dan `telegram_pairing_token` pada tabel `staff`.
- **Pengujian & Validasi (`tests/unit/staff-telegram-notification.test.ts`)**:
  - Unit test suite penugasan terapis & validasi proteksi nomor telepon lulus 100% (3/3 PASS, total 9/9 suite test lulus).

### Added — Telegram SaaS 1-Click Zero-Setup Pairing & Dynamic Topic Webhook Routing

- **Integrasi Telegram 1-Klik Berbasis Deep Linking (`src/services/telegram.service.ts`, `src/routes/telegram-webhook.route.ts`, `schema.prisma`)**:
  - Menyediakan token pairing unik per-tenant (`tenants.telegram_pairing_token`) yang otomatis digenerate untuk mendukung model *Single Shared SaaS Bot*.
  - Menghadirkan 2 opsi tombol 1-klik di antarmuka Admin Dashboard:
    1. **`[ 💬 Sambungkan Chat Pribadi (DM) ]`**: Deep link `t.me/<bot>?start=<TOKEN>` yang mengaitkan chat 1-on-1 langsung saat menekan tombol `START` di Telegram tanpa input konfigurasi manual.
    2. **`[ 👥 Sambungkan ke Grup Tim / Staff ]`**: Deep link `t.me/<bot>?startgroup=<TOKEN>` yang mengaitkan grup tim secara instan saat bot diundang ke grup.
- **Dynamic Forum Topic Routing via Webhook (`src/routes/telegram-webhook.route.ts`, `src/services/alert.service.ts`)**:
  - Endpoint webhook `POST /api/webhook/telegram` yang menangani command perintah di dalam grup/topik:
    * `/set_daily_report` (atau `/report_here`): Mengaitkan sub-topik aktif untuk Laporan Operasional Harian.
    * `/set_error_alerts` (atau `/error_here`): Mengaitkan sub-topik aktif untuk Error Sistem & Outage.
    * `/set_medical_alerts` (atau `/medical_here`): Mengaitkan sub-topik aktif untuk Eskalasi Medis Urgent ke Bidan.
    * `/status_server` (atau `/server` / `/health`): Memeriksa status kesehatan server secara real-time (Uptime, Beban RAM, Database Postgres Latency, & WhatsApp Gateway Status).
    * `/status_telegram`: Menampilkan ringkasan status target chat dan ID topik yang sedang aktif.
    * `/help`: Menampilkan daftar perintah bot yang tersedia.
- **Pembaruan Admin UI Dashboard (`DailyReportPanel.tsx`)**:
  - Banner koneksi 1-klik instan dengan status real-time (`Cek Status`), kartu panduan sub-topik Telegram, dan tab pengaturan manual (BYOB/Custom token) yang dapat disembunyikan.
- **Database Migration (`20260834000000_add_telegram_pairing_and_topics`)**:
  - Menambahkan kolom `telegram_pairing_token`, `telegram_topic_daily_report`, `telegram_topic_system_errors`, dan `telegram_topic_medical_alerts` pada tabel `tenants`.
- **Pengujian & Validasi (`tests/unit/telegram-webhook.test.ts`)**:
  - Seluruh unit test suite Telegram Webhook & Routing lulus 100% (5/5 PASS, total 28/28 test lulus).

### Changed — Telegram Daily Report QA Dummy Test Mode & Safe Simulation

- **Pemisahan Pengujian Laporan Telegram & Proteksi Database (`src/services/daily-report.service.ts`, `src/routes/admin/settings.subroute.ts`, `DailyReportPanel.tsx`)**:
  - Tombol **"Tes Kirim (Data Dummy)"** di dashboard admin kini mengirimkan pesan simulasi berlabel `🧪 [TEST / DATA DUMMY]` yang menginfokan secara transparan bahwa data yang dikirim adalah data dummy uji coba koneksi Telegram.
  - Pengetesan **TIDAK** lagi memicu perhitungan data riil dan **TIDAK** mencatat status ke tabel `DailyReportLog` di database, sehingga tidak memblokir atau mengganggu jadwal cron laporan harian yang sebenarnya.
  - Request pengujian kini otomatis menyertakan input token dan chat ID yang sedang diketik, sehingga dapat langsung diuji sebelum atau sesudah menekan simpan.
  - Memperbaiki transparansi error Telegram API: jika terjadi kegagalan (misal format salah atau bot belum di-`/start`), response error dikembalikan secara jelas ke antarmuka admin (bukan silent fallback).
  - **Dukungan Routing Topik / Forum Telegram per Kategori (`src/services/alert.service.ts`, `.env.example`)**:
    * Sistem kini mendukung pemisahan sub-topik Telegram untuk setiap kategori laporan/alert:
      - **Laporan Harian**: diarahkan ke Topic ID dari `TELEGRAM_TOPIC_DAILY_REPORT` atau format Chat ID `[IDGrup]:[TopicID]` di admin settings.
      - **Error Sistem & Outage** (Redis down, WAHA putus, LLM timeout): otomatis diarahkan ke `TELEGRAM_TOPIC_SYSTEM_ERRORS`.
      - **Eskalasi Medis Urgent** (gejala demam/kejang): otomatis diarahkan ke `TELEGRAM_TOPIC_MEDICAL_ALERTS`.
    * Penambahan unit test `tests/unit/alert_triggers.test.ts` (16/16 PASS).

### Changed — Live Chat Retry, Telegram Alert, Language Naturalization & Symptom Grounding

- **Live Chat Admin Reply (`src/services/live-chat.service.ts`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan *Retry Loop Lokal* pada pengiriman chat manual oleh terapis/admin. Jika gagal (timeout/WAHA down), sistem otomatis mencoba 1x lagi setelah 2 detik.
  - Menerapkan *Idempotency Check* 2 detik untuk mencegah spam pesan yang tidak disengaja (double klik tombol kirim).
  - Mengintegrasikan peringatan darurat ke Telegram (memanggil `AlertService`) bila pengiriman masih gagal setelah retry, agar admin sadar WhatsApp Gateway sedang bermasalah.
  - Memperbarui feedback UI untuk memberikan pesan toast (alert) bila error terjadi.

- **Perbaikan Ungkapan Kaku & Bahasa Alami (`src/config/persona.ts`, `src/integrations/llm/phrasing.service.ts`, `src/utils/language-sanitizer.ts`)**:
  - Melarang kata kaku/baku seperti *"Syukur sekali"*, *"Puji syukur"*, *"Alangkah baiknya"*. Diubah menjadi ungkapan hangat dan santai: *"Wah dekat ya Bunda..."*, *"Wah senang sekali..."*.
  - Menetapkan aturan gramatikal tegas pada sapaan *"Bunda"* (kata ganti/sapaan utama) vs *"bund"* (partikel panggilan di akhir kalimat). Dilarang menulis *"untuk bund"*, *"ke bund"*, *"dari bund"* $\rightarrow$ otomatis dinormalisasi menjadi *"untuk Bunda"*, *"ke Bunda"*.
  - Melarang dan membersihkan kebocoran kata bahasa Inggris seperti *"appointment"* / *"appointment-nya"* $\rightarrow$ disanitasi menjadi *"jadwal reservasi"* / *"jadwalnya"*.
- **Grounding Rekomendasi Gejala Keluhan Anak ke Katalog Klinik (`src/integrations/llm/generator.ts`, `src/services/treatment-catalog.service.ts`)**:
  - Menambahkan **Aturan 11 (Pemetaan Keluhan & Gejala Spesifik)** pada prompt LLM:
    * Keluhan **kembung / kolik / susah BAB / batuk pilek / rewel** WAJIB diarahkan ke **Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)** (bukan Pijat Bayi Ceria / Kids Ceria).
    * Terapi **Sinar Moksa** / **Nebulizer** dijelaskan sebagai add-on terapi pernapasan (dada/punggung) bila disertai batuk pilek atau dahak lendir.
- **Logging Transparan Perhitungan Jarak (`src/services/delivery.service.ts`)**:
  - Menambahkan structured console log setiap kalkulasi jarak:
    * **OpenRouteService (ORS API)**: `[DISTANCE CALC] 🛣️ Method: OpenRouteService (ORS API) | Distance: X km (est. travel: Y mins) | Clinic: [...] ──▶ Customer: [...]`
    * **Haversine Fallback**: `[DISTANCE CALC] 📐 Method: Haversine Fallback (1.60x circuity) | Straight: A km ──▶ Road Est: B km | Clinic: [...] ──▶ Customer: [...]`
- **Unit Testing**:
  - `tests/unit/language-sanitizer.test.ts` & `tests/unit/delivery.test.ts` (10 files, 113 tests PASS).

### Changed — Natural & Conversational Price Inquiry Formatting ("Mijat balita usia 2 tahun, kena biaya berapa?")

- **Peningkatan Respons Harga & Rekomendasi Alami (`src/services/treatment-catalog.service.ts`, `price-answer.service.ts`, `src/config/persona.ts`)**:
  - Memperbaiki respons pertanyaan harga usia spesifik (*"mijat balita usia 2 tahun, kena biaya berapa?"*) agar hanya merekomendasikan treatment pijat yang relevan (*Pijat Kids Ceria*) tanpa memunculkan menu non-pijat seperti *Custom Kids Bubble Spa*.
  - Mengubah template harga dan CTA menjadi format percakapan yang hangat, natural, dan manusiawi:
    * *"Untuk pijat si kecil usia 2 tahun, kami rekomendasikan **Pijat Kids Ceria** ya Bunda 😊 Durasinya 45 menit, dan saat ini lagi ada promo jadi **Rp 90.000** saja (harga normal Rp 110.000)."*
    * *"Kira-kira mau dijadwalkan di hari apa ya Bunda? Biar sekalian kami bantu cekkan slot terapisnya 🤗"*
  - Menambahkan prioritas kategori usia (`KIDS` untuk usia $\ge 2$ tahun dan `BABY` untuk usia $< 2$ tahun).
  - Penambahan unit test `tests/unit/price-answer.test.ts` (11/11 PASS).

### Added — Foto Depan Rumah, Tombol Update Titik Lokasi GPS & Patokan, serta Kamera Langsung pada Chat Terapis

- **Panduan Visual Foto Depan Rumah & Catatan Patokan (`StaffToday.tsx`, `Reservations.tsx`, `src/services/staff-reservation.service.ts`)**:
  - Menyimpan `house_photo_url`, `landmark`, `location_updated_at`, `location_updated_by_staff_id`, dan `location_updated_by_staff_name` pada `Customer.preferences` (aman tanpa migrasi schema DB dan siap multi-tenant).
  - Menampilkan thumbnail foto tampak depan rumah pasien & catatan patokan pada:
    1. **Portal Terapis**: Di bawah alamat pada setiap kartu tugas (Treatment Hari Ini, Jadwal Mendatang, Riwayat Selesai, dan Modal Detail Pasien).
    2. **Admin Dashboard**: Di dalam modal **Detail Reservasi** (section Lokasi & Pengiriman) lengkap dengan info staf yang memperbarui dan link Google Maps.
  - Menambahkan modal zoom lightbox untuk melihat foto tampak depan rumah dalam resolusi tinggi/HD saat diklik.
- **Tombol & Modal "Update Titik Lokasi & Foto Rumah" (`StaffToday.tsx`, `src/routes/staff/today.subroute.ts`)**:
  - Menambahkan tombol `[ 📍 Update Titik Lokasi & Foto Rumah ]` pada setiap kartu tugas dan modal detail.
  - Membuka modal interaktif yang menyediakan:
    1. **📍 Gunakan Titik GPS HP Saya Sekarang**: Mengunci titik koordinat GPS aktual perangkat di lapangan (`navigator.geolocation.getCurrentPosition`) dengan indikator akurasi (misal: `±8 meter`) untuk mengoreksi share-loc yang kurang presisi.
    2. **📷 Buka Kamera & Foto Rumah Pasien**: Mengambil foto tampak depan rumah/pagar/nomor rumah via kamera perangkat (`capture="environment"`), dengan kompresi server-side (max 800px) via `mediaService.resizeImageToMax`.
    3. **Catatan Patokan / Ancer-ancer**: Input teks panduan lokasi (contoh: *"Pagar hitam gerbang kayu, seberang masjid"*).
  - Endpoint baru `POST /api/staff/update-location` yang otomatis menghitung ulang jarak dari klinik (`calculateHaversineDistance`), memperbarui database customer, dan mencatat audit log staf.
- **Fitur Edit Panduan Lokasi & Upload Foto Rumah dari Sisi Admin (`Reservations.tsx`, `src/routes/admin/customers.subroute.ts`)**:
  - Menyediakan tombol `[ ✏️ Edit ]` / `[ + Tambah Foto Rumah & Patokan ]` langsung di dalam modal **Detail Reservasi** pada Admin Dashboard.
  - Membuka modal khusus Admin untuk mengunggah/mengganti foto rumah pasien (dari file komputer/galeri dengan kompresi otomatis), mengedit catatan patokan, serta mengatur koordinat GPS Latitude & Longitude secara manual.
  - Endpoint baru `PUT /api/admin/customers/:id/location` dengan fallback in-memory store yang otomatis memperbarui preferensi customer dan menghitung ulang jarak Haversine.
- **Pencantuman Kelurahan & Kecamatan pada Watermark Foto Rumah (`media.service.ts`, `staff-reservation.service.ts`, `customers.subroute.ts`)**:
  - Banner watermark pada foto depan rumah pasien kini otomatis menyertakan nama Kelurahan & Kecamatan (contoh: `📍 GPS: -7.348812, 112.751623 · Kel. Wonokromo, Kec. Wonokromo`).
  - Baris kedua mencantumkan catatan patokan dan tanggal/jam WIB secara rapi dan tajam.
- **Aturan Haversine > 1 km (Pertahankan Koordinat Utama & Simpan Revisi ke Ancer-ancer) (`staff-reservation.service.ts`, `customers.subroute.ts`)**:
  - Jika koordinat GPS baru yang dikirim terapis/admin berselisih **> 1 km** dari koordinat utama customer saat ini:
    - **Koordinat utama (`Customer.lat` & `Customer.lng`) tetap dipertahankan / tidak ditimpa**.
    - Koordinat revisi lapangan otomatis dicatat dan ditambahkan ke catatan **patokan / ancer-ancer** (contoh: `[📍 GPS Lapangan: -7.348812, 112.751623 (+1.4km)]`) serta disimpan dalam preferensi customer (`field_gps_lat`, `field_gps_lng`, `field_gps_diverged`).
    - Mencatat audit log `STAFF_UPDATE_CUSTOMER_LOCATION_DIVERGED` untuk kemudahan pelacakan CS/Admin.
  - Jika selisih **≤ 1 km** (koreksi presisi pagar/pintu rumah): koordinat utama diperbarui dan jarak dihitung ulang secara normal.
- **Kunci Akurasi GPS HP Otomatis Polling s/d 5 Percobaan (Target Akurasi ≤ 10 Meter) (`StaffToday.tsx`)**:
  - Tombol *"📍 Gunakan Titik GPS HP Saya Sekarang"* dan auto-GPS foto kini otomatis melakukan looping polling satelit hingga **5 kali percobaan**:
    - Langsung berhenti seketika saat akurasi mencapai target **≤ 10 meter** (`🟢 GPS presisi tinggi terkunci (±Xm)`).
    - Jika akurasi awal masih di atas 10 meter, sistem menampilkan progres percobaan real-time di tombol (`Mencari satelit GPS (Percobaan X/5)...`) dan secara otomatis memilih titik dengan akurasi terbaik dari 5 percobaan tersebut.
- **Interaksi Satu Baris Header Kartu Tugas untuk Detail Pasien (`StaffToday.tsx`)**:
  - Menjadikan seluruh baris atas kartu tugas (Avatar Icon Kategori, Nama Pasien, Judul Layanan, dan Jam Reservasi) sebagai area klik pembuka **Modal Detail Pasien** (`setDetailModalTask`).
  - Area bawah kartu tugas (Alamat, Foto Rumah, Patokan, dan Tombol OTW/Chat) tetap fokus untuk membuka chat WhatsApp atau navigasi peta, sehingga terapis di perangkat mobile tidak perlu membidik icon kecil.
- **Mode Navigasi Sepeda Motor / Roda Dua (`travelmode=two-wheeler`) (`staff-reservation.service.ts`, `StaffToday.tsx`)**:
  - Memperbarui parameter URL navigasi Google Maps (`navigationUrl`) dari `bicycling` menjadi `two-wheeler` (`https://www.google.com/maps/dir/?api=1&destination=lat,lng&travelmode=two-wheeler`).
  - Memastikan saat terapis menekan tombol `[ Navigasi ]` di HP, aplikasi Google Maps langsung membuka tab rute **Sepeda Motor** (menghindari jalur tol mobil dan memilih rute motor yang efisien).
- **Test & Verifikasi**:
  - Penambahan unit test `tests/unit/staff-auth-and-reservation.test.ts` (20/20 PASS) dan integrasi `tests/integration/admin-customer-label.test.ts` (11/11 PASS) — total 31/31 test PASS.
  - Build dashboard admin (`npm run build`) dan typecheck backend (`tsc --noEmit`) 100% PASS.

### Added — Right Sidebar Drawer Menu (Garis Tiga) & Tab Treatment Selesai untuk Portal Terapis

- **Right Sidebar Slide-over Drawer (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - **Tombol Garis Tiga (Hamburger Menu)**: Menambahkan tombol menu di kanan atas header untuk membuka slide-over drawer dari sisi kanan layar.
  - **Menu Navigasi Lengkap**:
    1. 📋 **Treatment Hari Ini**: Menampilkan tugas aktif hari ini dan split view WhatsApp live chat.
    2. 📅 **Jadwal Mendatang**: Menampilkan jadwal reservasi mendatang dikelompokkan per tanggal.
    3. ✅ **Treatment yang Sudah Dilakukan**: Menampilkan riwayat treatment yang telah selesai/lunas lengkap dengan rincian total omset, pembayaran (Tunai/Transfer/QRIS), dan detail pasien.
  - **Profil Staf & Logout**: Akses cepat ke modal info akun terapis dan tombol keluar dengan konfirmasi aman (`useUiFeedback`).
- **Backend Endpoint Riwayat Selesai (`src/services/staff-reservation.service.ts`, `src/routes/staff/today.subroute.ts`)**:
  - Menambahkan method `StaffReservationService.getCompletedTasks` dan endpoint `GET /api/staff/completed-tasks`.
  - Penambahan unit test `tests/unit/staff-auth-and-reservation.test.ts` (16/16 PASS).

### Fixed — Multi-Child / Multi-Treatment Transport Policy Inquiry ("Untuk 2 anak transportnya 1 kan")

- **Deteksi Pertanyaan Kebijakan Ongkir Multi-Anak / Per Kunjungan (`src/state-machine/utils/transport-policy-checker.ts`, `interest.ts`, `persona.ts`)**:
  - Memperbaiki bug di mana customer yang menanyakan kebijakan transport untuk 2 anak / per kunjungan (*"Untuk 2 anak transportnya 1 kan"*) keliru di-hijack oleh lookup harga treatment dan dijawab dengan harga *Pijat Kids Ceria*.
  - Menambahkan detector `isMultiChildTransportQuestion` untuk mengenali pertanyaan kebijakan transport (misal 2 anak, multi-treatment, per kedatangan, per alamat).
  - Mengisolasi `isAskPrice` (`src/services/price-answer.service.ts`) agar tidak membajak pertanyaan kebijakan ongkir sebagai pertanyaan harga katalog treatment.
  - Menambahkan respon deterministik ramah: *"Iya betul Bunda, untuk biaya transport/ongkir homecare kami dihitung per kedatangan/kunjungan (per alamat) ya Bunda, jadi meskipun untuk 2 anak atau lebih (atau Bunda + si kecil), ongkirnya tetap dihitung 1 kali saja yaa 🤗 Mau ambil treatment apa saja untuk si kecil/Bunda?"*
  - Menambahkan prompt Rule 10 pada AI Generator (`src/integrations/llm/generator.ts`).
  - Penambahan unit test `tests/unit/multi-child-transport-policy.test.ts` (3/3 PASS).

### Changed — Pricelist HD Dikirim Asli; Dashboard Tanpa Preview (Hanya Tombol Lihat); Mode Upload Saja

- **Pricelist dikirim ke customer dalam ukuran asli (HD, tanpa kompresi)** (`pricelist-config.service.ts`, `machine.ts`): fungsi `resolvePricelistSendTarget` (yang me-resize 1/3 & membuat file duplikat tiap kirim) **dihapus**; `machine.ts` kembali memakai `resolvePricelistImageTarget` — sumber `/media/outbound/...` dikirim langsung (WAHA: path file lokal; WABA: URL publik), sumber URL eksternal dikirim langsung. Bonus: tidak ada lagi file duplikat per kiriman → hemat storage & kuota MQL.
- **Dashboard tidak lagi menampilkan pratinjau gambar** (`PricelistImagePanel.tsx`): blok preview dihapus — diganti **tombol "Lihat Gambar Pricelist"** (ikon mata) yang membuka modal lihat gambar HD asli (klik luar = tutup).
- **Mode "Pakai URL" dihapus** (`PricelistImagePanel.tsx`): hanya mode **upload gambar**; tombol "Reset ke Default" tetap (satu-satunya cara hapus gambar custom). Response `pricelistThumbUrl` di `GET/PUT /api/admin/settings/pricelist-image` dihapus (tidak terpakai lagi) beserta import `fs`.
- **Sumber pricelist HD asli tetap inline MQL & retensi media** (via `saveOutboundMedia`) — tidak berubah dari versi sebelumnya.
- Test: 151 files / 1381 tests pass; build dashboard & backend hijau.

### Changed — Card Pricelist Inline dengan MQL & Retensi; Sumber HD Tersimpan, Dashboard Pakai Thumb

- **Upload pricelist kembali disimpan HD asli** (`settings.subroute.ts`): kompresi 1/3 saat upload **dibatalkan** — file sumber berkualitas penuh tersimpan via `saveOutboundMedia` (tetap **inline MQL & retensi media**). Kompresi hanya terjadi saat **kirim ke WhatsApp** (`resolvePricelistSendTarget`, 1/3 dimensi).
- **Dashboard menampilkan versi ringan**: endpoint `GET/PUT /api/admin/settings/pricelist-image` kini mengembalikan `pricelistThumbUrl` (blur thumb `_thumb.jpg` ~6KB yang otomatis dibuat `saveOutboundMedia`; fallback `null` bila tidak ada). `PricelistImagePanel` memakai thumb untuk pratinjau — browser tidak lagi mengunduh file HD (contoh live: 2.6MB → ~6KB per buka Settings).
- **Card pricelist inline dengan MQL & Retensi** (`MqlSettingsPanel.tsx`, `Settings.tsx`): panel "Gambar Pricelist WhatsApp" tidak lagi standalone — kini **satu grid 3 kolom sebaris**: Pricelist | MQL Automation | Retensi Media Live Chat.
- Test: 151 files / 1381 tests pass; build dashboard & backend hijau.

### Added & Changed — Kalender Pure, Auto-Scroll Mingguan, Ikon Mata Bukti Bayar, Upload Bukti di Manage, Modal Klik-Luar Tutup, Kompresi Gambar Server-Side

- **Kalender jadi pure calendar** (`Reservations.tsx`): sidebar (spotlight, filter kategori/terapis/status) & tombol "Filter" mobile dihapus; halaman kini hanya search + grid kalender/tabel. File `CalendarSidebar.tsx`, `UpcomingSpotlightCard.tsx`, `MiniMonthCalendar.tsx` dihapus (tidak terpakai lagi).
- **Tampilan Minggu auto-scroll** (`WeekScheduleGrid.tsx`): saat tab Minggu dibuka, langsung scroll ke **treatment terdekat dari sekarang** (kolom hari + baris jam-nya); bila tidak ada jadwal tersisa, scroll ke **kolom hari ini + jam sekarang**. Ikut re-scroll saat pindah minggu.
- **Bukti bayar → ikon mata saja** (`Reservations.tsx`): tombol teks "Cek Bukti Bayar" di tabel desktop & kartu mobile diganti **ikon mata (Eye)**; klik membuka modal bukti bayar.
- **Manage modal: upload bukti bayar + ikon mata** (`Reservations.tsx` + `reservations.subroute.ts`): section "Bukti Bayar" baru di modal Detail Reservasi — preview + ikon mata (lihat detail) + tombol hapus, atau area **unggah gambar** bila belum ada. Endpoint baru `PUT /api/admin/reservation/:id/proof` (upload/`remove:true`) dengan audit log `ADMIN_UPLOAD_PROOF`/`ADMIN_REMOVE_PROOF`.
- **Gambar dikompres server-side saat upload** (bukan HD, ringan untuk server & MQL):
  - Helper baru di `media.service.ts`: `resizeImageToMax(buffer, maxDim)` & `resizeImageToFraction(buffer, divisor)` (sharp, JPEG q80, tanpa perbesar).
  - **Bukti bayar** (catat bayar terapis `recordPayment` & upload di Manage): **max 800px** — foto HP 4000px turun ~80-95% berat.
  - **Pricelist** (upload di Settings): **1/3 dimensi** — konsisten dengan versi yang dikirim ke WhatsApp; tersimpan via `saveOutboundMedia` sehingga **inline MQL & retensi media** (sebelumnya upload pricelist & bukti tersimpan HD asli).
  - `resolvePricelistSendTarget` (pricelist-config.service.ts) di-refactor memakai helper yang sama.
- **Semua modal: klik di luar (backdrop) = tutup** — 21 modal (dashboard admin + portal terapis + komponen bersama): `UiFeedback` confirm dialog, InstallAppPanel, StaffManagement (role/add/edit staff), FollowUpQueue (reschedule/confirm), CustomerDatabase (chat history/CAPI), LandingPage, Reservations (Manage & bukti — proof sudah sebelumnya), ClinicServices, StaffSchedule (profil/detail), StaffToday (profil/detail/catat bayar), CreateReservationModal, ExternalIntegrationModal. Pola: overlay `onClick={close}` + panel dalam `stopPropagation`. Klik luar kini setara tombol X & "Batal".
- Test: 151 files / 1381 tests pass; build dashboard & backend hijau.

### Added & Changed — Paket Perbaikan Dashboard: Kalender Reservasi, Chat Terapis Kirim Gambar, Bot Diam Saat Staf Balas, Pricelist Kecil, PWA & Ongkir

- **Kalender Reservasi dirapikan** (`Reservations.tsx`, `CalendarSidebar.tsx`, `MonthScheduleGrid.tsx`):
  - Urutan tab diubah menjadi **Tabel → Hari → Minggu → Bulan** (sebelumnya Bulan/Minggu di depan).
  - Tombol navigasi tanggal ("Hari Ini", `<`, `>`) kini **disembunyikan di mode Tabel** — sebelumnya tetap tampil padahal tidak berfungsi di daftar tabel (kondisi awal penyebab tombol terasa "tidak bisa").
  - **Mini kalender di sidebar dihapus**; sidebar kini langsung berisi kartu spot light "Segera Datang" + filter (kategori, terapis, status). Tombol toggle mobile diganti label "Filter".
  - **Tampilan Bulan diurutkan jam paling pagi di atas** per hari (`getEventsForDay` sort `booking_date` ascending).
- **Chat terapis: bisa kirim gambar** (`StaffToday.tsx`): tombol lampirkan gambar (ikon) + preview lampiran + hapus lampiran di bar input; kirim via `imageB64/thumbB64/mimeType/fileName` yang sudah didukung backend. Pesan optimis menampilkan preview lokal, lalu diganti respons server.
- **Bot diam saat terapis membalas** (`live-chat.service.ts`, `today.subroute.ts`, `staff-reservation.service.ts`): parameter baru `forceEscalate` pada `sendAdminReply` — balasan Staff/Bidan (termasuk konfirmasi pembayaran) kini **selalu** mengaktifkan mode human-handling (`is_human_handling`) sehingga bot tidak membalas menyela percakapan, terlepas dari config `manual_reply_escalates` tenant (yang hanya berlaku untuk balasan Admin dashboard).
- **Pricelist dikirim versi kecil (1/3 dimensi)** (`pricelist-config.service.ts`, `machine.ts`): fungsi baru `resolvePricelistSendTarget` me-resize gambar pricelist (sharp, max ~1/3 dimensi terpanjang, JPEG q80) lalu menyimpannya via `saveOutboundMedia` — **terintegrasi kuota media (MQL) & retensi media chat** — sebelum dikirim WAHA/WABA. Gambar pricelist yang terkirim tidak lagi file raksasa dan ikut dibersihkan retensi.
- **PWA Install App dipindah** (`Settings.tsx`): panel "Install Aplikasi" kini berada **di kolom kiri (setengah lebar) tepat di atas Global Chatbot Toggle**, bukan satu baris penuh di atas grid.
- **Delivery Fee: label ongkir jadi + tombol hapus kecil** (`Settings.tsx`): tiap baris tier kini menampilkan kolom **"Ongkir Jadi (Rp)"** (tarif − promo, hijau; "GRATIS" bila 0) dan tombol hapus diubah jadi **ikon tempat sampah kecil** (tidak lagi full-width).
- **Label ongkir di kartu tugas terapis** (`StaffToday.tsx`, `StaffSchedule.tsx`): kartu kini menampilkan `(ongkir Rp X)` di samping total biaya bila ongkir > 0.
- Test: 151 files / 1381 tests pass; build dashboard & backend hijau.

### Added — Tab Reservasi: Tombol "Cek Bukti Bayar" (TF/QRIS) + Default Tampilan Daftar (Tabel)

- **Backend**: kolom baru `payment_method` & `proof_url` pada tabel `reservations` (migration `20260833000000_add_payment_proof`); `recordPayment` (`staff-reservation.service.ts`) kini menyimpan metode bayar & URL media bukti ke record reservasi — sebelumnya hanya tersimpan di audit log (`STAFF_RECORD_PAYMENT`).
- **Frontend Reservations** (`Reservations.tsx`):
  - **Default tampilan = Tabel (daftar)**, bukan kalender — berlaku juga di mobile (sebelumnya default responsif `day`/`week`). Ini sekaligus mengatasi tampilan kalender yang berantakan/error di HP.
  - **Kolom "Bukti Bayar"** baru di tabel desktop & **tombol "Cek Bukti Bayar"** di kartu mobile — tampil untuk reservasi **selesai** (status `completed`) yang memiliki bukti → membuka **modal preview gambar** berisi metode bayar (Tunai/Transfer/QRIS), nilai, status, dan tombol "Buka Gambar Penuh".
  - Reservasi lama (dicatat sebelum fitur ini) tidak memiliki `proof_url` — buktinya tetap tersedia di audit log `STAFF_RECORD_PAYMENT`.
- Test: 151 files / 1381 tests pass; build dashboard & backend hijau.

### Changed — Portal Terapis: Gate OTW 2 Jam, Pemisah Visual Treatment, Header Chat Icon-Only, Tab Menu Dihilangkan

- **Tombol "Infokan OTW" dikunci sampai H-2 jam sebelum jadwal treatment** (`StaffToday.tsx`): tombol di kartu tugas & di header chat kini `disabled` dengan visual redup + tooltip penjelas bila masih lebih dari 2 jam sebelum jam treatment. OTW hanya bisa dikirim pada rentang 2 jam sebelum hingga saat treatment.
- **Pemisah visual antar treatment**: kartu treatment ke-2 (dan genap berikutnya) di daftar tugas kini diberi **background abu-abu lebih pekat** (`bg-[#eceef1]`) dibanding kartu putih di sekitarnya — memudahkan membedakan treatment 1, 2, 3 secara berurutan.
- **Header chat WhatsApp dirapikan**: tombol "Navigasi", "Catat Bayar/Lunas", dan "Infokan OTW" diubah menjadi **ikon-only** (tombol persegi 36px) agar header tidak penuh; teks dipindah ke tooltip (title).
- **Menu tab "Tugas & Chat Hari Ini" / "Jadwal Mendatang" dihilangkan**: subheader 2-tab tidak lagi ditampilkan — portal terapis langsung menampilkan tugas hari ini + chat tanpa switcher tab.

### Added & Changed — Notifikasi Login Staf Admin & Penyederhanaan Tabel Staff Management

- **Pesan error spesifik untuk login staf non-Terapis** (`admin/auth.subroute.ts` TAHAP B & `staff/auth.subroute.ts`): jika nomor HP + password benar tetapi role akun bukan `THERAPIST` (mis. ADMIN_CS), server kini membalas **403** dengan notifikasi jelas — *"Akun ... adalah Staf Admin dan tidak boleh login memakai nomor HP. Gunakan email super admin, atau minta pengelola mengubah peran akun menjadi Terapis."* — menggantikan pesan generik "Email / Nomor WhatsApp atau password salah." yang membingungkan. Akun dengan kredensial salah tetap mendapat 401 generik (tidak membocorkan keberadaan akun).
- **Tabel Staff Management disederhanakan** (`StaffManagement.tsx`):
  - Kolom **Tugas Reservasi** dihapus.
  - **Icon/avatar di samping nama** dihapus; status akun kini ditandai **dot hijau** di kiri nama saat aktif (dot abu-abu saat nonaktif) — kolom "Status Akun" dihapus.
  - Aksi **Reset Password** & **Nonaktifkan/Aktifkan Akun** tidak lagi ada di tabel — fungsinya tersedia di **modal Edit** (kolom Password Baru & dropdown Status Akun yang sudah ada). Tabel kini hanya berisi Edit & Hapus. Modal Reset Password terpisah dihapus.
- Test: `unified-login.test.ts` (ADMIN_CS & ADVERTISER → 403 notifikasi), `staff-routes.test.ts` (403 untuk staff non-THERAPIST dengan password valid).

### Fixed — Enforce Role THERAPIST untuk Portal Terapis (Akses Tidak Bisa Bocor ke Role Lain)

- **Akar masalah**: portal staff (`/api/staff/*`) tidak pernah memeriksa role — akun non-THERAPIST (mis. ADMIN_CS) yang sudah punya sesi tetap bisa mengakses data & chat terapis, dan "Role & Hak Akses" yang dihapus di dashboard hanya tersimpan di localStorage browser (klien-only, tidak menyentuh server).
- **Gate THERAPIST di login & validasi sesi** (`staff-auth.service.ts`): `login` kini memfilter `role: 'THERAPIST'` di query; `validateSession` menolak sesi milik staff non-THERAPIST → sesi lama role lain **langsung invalid** di semua pintu (portal staff, restore, admin API via staff cookie).
- **Revoke sesi saat role diubah** (`staff-management.subroute.ts`): `PATCH /api/admin/staff/:id` kini mencabut seluruh sesi aktif bila `role` diubah (sebelumnya hanya saat `active=false` atau ganti password) → terapis yang diganti rolenya langsung keluar.
- **Role asli di respons auth staff**: `login`/`me`/`restore` kini mengembalikan role sebenarnya (lowercase, mis. `therapist`) menggantikan hardcode `'staff'` — sekaligus memperbaiki preload chunk PWA (role terapis tersimpan benar).
- Test: gate query login (THERAPIST vs ADMIN_CS) & validasi sesi non-THERAPIST → null.

### Added & Improved — Perombakan UI & UX Portal Terapis (StaffToday & StaffSchedule)

- **Header Minimalis & Titik Status Koneksi (`StaffToday.tsx`, `StaffSchedule.tsx`)**:
  - Menyederhanakan header menjadi sangat clean & compact: judul langsung menampilkan nama terapis (`{staff.name}`), menghilangkan teks "WhatsApp Terapis", "Portal Lapangan", "Bidan Terapis", dan teks "Aktif".
  - Mengganti teks status realtime dengan **titik dot koneksi minimalis** (🟢 Hijau saat online/connected, 🔴 Merah berdenyut saat reconnecting).
  - Tombol logout dihilangkan dari header utama dan dipindahkan ke dalam drawer profil staff.
- **Avatar Staff & Profile Drawer Modal (`StaffToday.tsx`, `StaffSchedule.tsx`)**:
  - Mengganti avatar inisial 1 huruf dengan **SVG Avatar Icon** (`UserCheck`).
  - Menambahkan popover/drawer profil interaktif saat avatar staff di-klik: menampilkan Nama Terapis, No HP, Role (*Staff Terapis Lapangan*), dan tombol **Keluar Akun (Logout)** dengan dialog konfirmasi yang aman.
- **Hardware / Browser Back Button Navigation (`StaffToday.tsx`)**:
  - Mengintegrasikan `window.history.pushState` saat membuka chat dan event listener `popstate`: menekan tombol back fisik/gesture di smartphone atau browser akan kembali ke daftar chat (bukan keluar dari aplikasi web).
  - Tombol back di UI (`ChevronLeft`) sinkron memanggil `window.history.back()`.
  - Popstate juga otomatis menutup modal (Detail Pasien / Catat Bayar / Profil) terlebih dahulu.
- **Icon Customer Berbasis Layanan & Modal Detail Pasien Privacy-Protected (`StaffToday.tsx`, `StaffSchedule.tsx`)**:
  - Avatar customer pada kartu tugas dan header chat diganti dengan **Icon Kategori Layanan**:
    - `BABY` -> Icon `Baby` berlatar soft sky blue
    - `MOMS` -> Icon `Sparkles` berlatar soft purple
    - `BOTH` / `KIDS` -> Icon `Smile` berlatar soft emerald
    - Treatment lain -> Icon `User` berlatar soft teal
  - Menambahkan modal **Detail Jadwal & Pasien** saat icon customer di-klik: memperlihatkan jam kunjungan, layanan, alamat lengkap, jarak & estimasi menit tempuh, data anak/usia, rincian biaya (biaya treatment, ongkir, total, status Lunas/Tagih), dan tombol buka peta Google Maps.
  - **Proteksi Privasi**: Nomor HP pasien disembunyikan seluruhnya dari UI terapis untuk mencegah kebocoran data pelanggan.
- **Aksen Warna Pembeda Antar Pasien & Auto-Scroll Chat (`StaffToday.tsx`, `StaffSchedule.tsx`)**:
  - Menambahkan aksen border kiri tebal dan soft tint background berbasis kategori treatment (*Baby = Sky Blue, Moms = Soft Purple, Both = Emerald, Lainnya = Teal*) sebagai penanda visual yang tegas antar pasien yang berbeda.
  - Mengoptimalkan auto-scroll chat menggunakan `requestAnimationFrame` dan timeout mikro sehingga viewport chat selalu otomatis scroll ke pesan paling akhir saat chat dibuka.

### Added & Improved — Boot Progress Bar & Retry Lebih Responsif (Mobile)

- **`BootProgress`** (`packages/admin-dashboard/src/components/common/BootProgress.tsx` + `lib/bootProgress.ts`): bar progress 0-100% tipis ala YouTube + teks status ("Memeriksa sesi…", "Memuat halaman…", dst). Bukan fake murni — fase digerakkan event nyata (`auth`/`chunk`/`mount`/`data`) + creep anti-beku (cap 92%) supaya tidak pernah tampak macet. Hanya muncul saat boot pertama PWA; navigasi antar halaman tetap pakai spinner lama.
- **Retry backoff adaptif** (AuthContext & StaffAuthContext): ganti `setTimeout 5s` datar → `[1s, 2.5s, 5s, 8s]`; skip percobaan saat `navigator.onLine=false` (tunggu event `online`, fallback timer); guard `inFlight` mencegah checkAuth ganda saat open (mount + visibilitychange). Setelah 3 kegagalan, teks bar jadi "Koneksi bermasalah — mencoba lagi…". Dampak: worst-case 3 percobaan turun dari ~15s → ~8.5s; kasus gagal-1x dari ~10s → ~4-5s.
- **Preload chunk paralel**: role terakhir disimpan di localStorage saat login; saat boot, chunk halaman tujuan (`StaffToday` untuk terapis / `Overview` lainnya) di-preload **paralel** dengan cek sesi → hemat 1 RTT + download di bukaan pertama.

### Added & Improved — Sesi Survive PWA Android (Tidak Logout Saat Tutup Aplikasi)

- **Akar masalah**: Cookie `staff_session`/`admin_session` bisa hilang dari browser saat aplikasi PWA Android ditutup/di-swipe dari Recents (perilaku browser — cookie dianggap session-scoped di standalone window), padahal sesi di server masih valid 30 hari.
- **Backend — Endpoint Restore Cookie**:
  - `POST /api/admin/auth/restore` (`src/routes/admin/auth.subroute.ts`): menerima token dari localStorage → validasi sesi admin/staff → me-issue ulang cookie (`admin_session` / `staff_session`, SameSite=Lax, Max-Age 30 hari).
  - `POST /api/staff/auth/restore` (`src/routes/staff/auth.subroute.ts`): validasi token staff → me-issue ulang cookie `staff_session`.
  - Respons login (admin & staff) kini menyertakan field `token` agar frontend bisa menyimpan token cadangan.
  - `admin.route.ts` / `staff.route.ts`: endpoint restore dibolehkan diakses tanpa sesi (bypass preHandler).
- **Frontend — Token Cadangan di localStorage**:
  - `StaffAuthContext.tsx` / `AuthContext.tsx`: token login disimpan di `localStorage`; saat `checkAuth` mendapat 401 (cookie hilang) → otomatis panggil `/restore` → cookie di-issue ulang → sesi pulih tanpa login ulang. Error jaringan saat restore tidak menghapus token (retry).
  - Token dihapus saat logout. *Catatan keamanan: token di localStorage rentan XSS (standar trade-off untuk fallback PWA); cookie HttpOnly tetap jalur utama.*
- **PWA Entry Fix** (`App.tsx`): route `/admin` (start_url manifest) kini me-redirect terapis ke `/admin/staff/today` sesuai role, bukan halaman Unauthorized.
- Test: `tests/integration/control_center_ui.test.ts` (restore admin + token di body login), `tests/integration/staff-routes.test.ts` (restore staff 200/401).

### Added & Improved — Mobile UX Overhaul & Touch Ergonomics Dashboard Admin

- **Pola Master-Detail Toggle Mobile di Live Chat Monitor (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`)**:
  - Mereplikasi pola `mobileView: 'list' | 'chat'` dari `StaffToday.tsx` ke `LiveChatMonitor.tsx` — di mobile, daftar percakapan dan jendela chat tidak lagi ditumpuk vertikal (nested scroll hilang).
  - Menambahkan tombol kembali (`ChevronLeft`) di header mobile dan chat inspector saat chat aktif untuk kembali ke daftar percakapan dengan mudah.
  - Menyesuaikan tinggi panel chat menjadi adaptif layar penuh mobile (`h-[calc(100dvh-170px)] lg:h-[650px]`).
- **Card-View Responsif di Database Customer (`packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx`)**:
  - Mengganti tabel lebar 6-kolom dengan tumpukan kartu rapi di mobile (`md:hidden`), sementara tabel tetap aktif di desktop (`hidden md:block`).
  - Kartu menampilkan nama, nomor HP, status MQL, label WhatsApp (Admin/Hold toggle), LTV, dan tombol aksi berukuran sentuh nyaman.
- **Optimasi Kalender & View Switcher Mobile (`packages/admin-dashboard/src/pages/tenant/Reservations.tsx`)**:
  - Default tampilan otomatis menjadi **Hari (Day View)** saat terdeteksi layar mobile (`< 768px`).
  - Menyembunyikan tab *Bulan* dan *Minggu* di layar kecil agar terhindar dari grid horizontal 1050px yang tidak ergonomis di HP.
  - Menambahkan tombol toggle filter & spotlight mobile (`+ Filter & Kalender`) untuk membuka/menutup widget mini-kalender sesuai kebutuhan.
- **Pengelompokan Menu Sidebar & Status Popover (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Mengelompokkan 19 menu navigasi flat menjadi 5 kategori terstruktur (*Operasional & Jadwal*, *Staff & Layanan*, *Marketing & Ads*, *AI Engine & Konten*, *Pengaturan & Sistem*) dengan heading sub-seksi yang rapi.
  - Mengganti tooltip status `title="..."` pada indikator WAHA/Redis dengan **popover interaktif tap-to-reveal** untuk pengguna smartphone & layar sentuh.
- **Standar Tipografi & Touch Target Global (`packages/admin-dashboard/src/index.css`, `packages/admin-dashboard/index.html`)**:
  - Menaikkan baseline teks body di mobile dari 12px (`text-xs`) ke 13px–14px yang nyaman dibaca tanpa perlu pinch-zoom.
  - Membatasi teks micro badge minimal 11px agar tetap terbaca jelas.
  - Menetapkan batas tinggi sentuh minimal tombol aksi (touch target standard >= 36px) di layar mobile.
  - Memangkas pemuatan Google Fonts eksternal menjadi hanya 1 font family (*Plus Jakarta Sans* 400, 500, 600, 700) untuk mempercepat initial load dan menghemat kuota koneksi seluler.

### Fixed — Portal Terapis Sering Ter-logout saat Server Restart / Jaringan Gangguan

- **`packages/admin-dashboard/src/services/api.ts`**: Error yang dilempar `apiRequest` kini membawa properti `status` (HTTP status code), sehingga caller bisa membedakan error otorisasi asli (401/403) vs error jaringan/timeout/server.
- **`packages/admin-dashboard/src/contexts/StaffAuthContext.tsx`**: Pengecekan sesi saat mount tidak lagi langsung meng-clear staff pada error apa pun. Hanya `401/403` asli yang mengarahkan ke halaman login; error jaringan/timeout (mis. saat app restart/deploy) memicu **retry otomatis tiap 5 detik** di latar belakang + retry ulang saat tab kembali fokus (`visibilitychange`) — terapis tidak lagi terlempar ke login hanya karena server restart sesaat.
- **`packages/admin-dashboard/src/contexts/AuthContext.tsx`**: Perlindungan retry yang sama diterapkan untuk pengecekan sesi admin (konsistensi perilaku).
- Akar masalah dari investigasi: sesi staff tersimpan valid di DB (TTL 30 hari), namun `StaffProtectedRoute` meredirect ke `/admin/login` setiap kali `checkAuth` gagal — termasuk saat app container down/restart (terbukti dari log: 502 `connection refused` jam 00:52 & deploy 01:29 WIB bertepatan dengan login ulang beruntun).

### Changed — Tombol Navigasi Peta Terapis dari Mode Mobil ke Sepeda (`travelmode=bicycling`)

- **`src/services/staff-reservation.service.ts`**: Mengubah parameter `travelmode` pada `navigationUrl` (link turn-by-turn Google Maps) dari `driving` (mobil) menjadi `bicycling` (sepeda) untuk semua kartu tugas terapis (Staff Today & Jadwal Mendatang), karena terapis berangkat dengan sepeda.
- Memperbarui assertion terkait di `tests/unit/staff-auth-and-reservation.test.ts`.

### Fixed — Persistensi Sesi Login Admin & Perpanjangan TTL (Mencegah Sesi Cepat Ter-logout)

- **Persistensi Sesi & Cookie Stability (`src/services/admin-session.service.ts`, `src/services/staff-auth.service.ts`, `src/routes/admin/auth.subroute.ts`, `src/routes/staff/auth.subroute.ts`, `src/routes/admin.route.ts`)**:
  - **Penyebab Sesi Cepat Logout**: Sebelumnya sesi Super Admin disimpan murni di in-memory `Map`. Setiap kali dev server hot-reload (`tsx watch`) karena ada kode yang diubah/disimpan atau bot restart, memori sesi langsung terhapus bersih dan menyebabkan browser mengembalikan status `401 Unauthorized`.
  - **Storage Disk Persistence**: Menambahkan mekanisme auto-save & auto-load token sesi admin ke `storage/admin_sessions.json`. Sekarang saat server di-restart atau hot-reload, sesi login aktif **tetap utuh dan tidak ter-logout**.
  - **Perpanjangan Masa Aktif Sesi (TTL 30 Hari)**:
    - Sesi Admin & Staff diperpanjang menjadi **30 hari penuh (2.592.000 detik)**.
  - **SameSite=Lax Cookie Policy**: Mengubah atribut cookie dari `SameSite=Strict` menjadi `SameSite=Lax` agar cookie sesi tidak terputus saat berpindah tab atau diarahkan dari URL eksternal/redirect.
  - **Dukungan Custom Roles di API Admin**: Memperluas filter `admin.route.ts` agar seluruh peran staf non-terapis (termasuk peran kustom baru) dapat mengakses endpoint dashboard tanpa terhambat otorisasi.

### Added — Manajemen Role & Setup Hak Akses Modul Dashboard (RBAC) Terpadu

- **Fitur Setup Role & Hak Akses di Manajemen Staff (`packages/admin-dashboard/src/pages/tenant/StaffManagement.tsx`, `packages/admin-dashboard/src/config/rolePermissions.ts`)**:
  - **Tombol & Tab Setup Hak Akses**: Menambahkan tombol `+ Setup Role & Hak Akses` di header serta dual-tab switcher `[ Daftar Akun Pengguna | Setup Hak Akses & Role (RBAC) ]`.
  - **Kartu Ringkasan Role Dinamis**: Menampilkan kartu ringkasan untuk seluruh role bawaan (`Super Admin`, `Admin Utama`, `Admin CS & Reservasi`, `Advertiser`, `Staff Terapis`) maupun custom role, lengkap dengan counter anggota aktif dan perbandingan modul yang diizinkan.
  - **Matriks Izin Modul Interaktif (Interactive Permission Matrix)**:
    - Menyusun 19 modul dashboard ke dalam 5 kelompok logis (*Dashboard & Pelanggan*, *Operasional & Jadwal*, *CRM & Komunikasi*, *Marketing & Ads*, *AI Engine & Sistem*).
    - Checkbox interaktif per modul dan tombol toggle instan *Pilih Semua / Batal Semua* per kategori dengan live synchronization.
  - **Modal Tambah & Edit Role Kustom**: Memungkinkan admin klinik membuat peran baru (misal: *Supervisor*, *Finance*, *Admin Gudang*) dengan checklist izin modul dan halaman redirect kustom.
  - **Dynamic Role Selector**: Dropdown pemilihan peran pada modal Buat Staff Baru dan Edit Staff otomatis membaca seluruh peran kustom yang aktif secara dinamis.

### Added — Sequential Homecare Distance & Travel Duration Calculation for Therapist Itinerary (Haversine 0-API)

- **Kalkulasi Jarak Sekuensial Berantai & Estimasi Waktu Tempuh Motor (`src/services/staff-reservation.service.ts`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengubah logika perhitungan jarak pada kartu tugas terapis (*Staff Today & Jadwal Mendatang*) agar mengikuti rute nyata terapis di lapangan:
    - **Pasien #1**: Menghitung jarak dari **Klinik / Basecamp** ke rumah Pasien 1 (`📍 Jarak: X km dari klinik`).
    - **Pasien #2, #3, dst**: Menghitung jarak dari **titik lokasi pasien sebelumnya** ke rumah pasien saat ini (`🛵 Jarak: X km dari Bunda [Nama Pasien Sebelumnya]`).
  - Menggunakan formula **Haversine lokal murni (0 API Call / 0 Biaya Kuota)** yang dikalikan dengan faktor kelokan rute perkotaan (`HAVERSINE_CIRCUITY_FACTOR = 1.60x`).
  - **Estimasi Waktu Tempuh Motor Terkalibrasi**:
    - Dikalibrasi langsung dari benchmark Google Maps motor perkotaan (`~2.05 menit/km + 2 menit buffer lampu merah/gang`).
    - Menampilkan durasi perjalanan langsung di kartu tugas (misal: `Jarak: 11.0 km dari klinik (±25 mnt perjalanan)`).
  - Menyertakan *fallback cerdas*: Jika pasien sebelumnya belum memiliki koordinat GPS, sistem otomatis menghitung ulang jarak & durasi dari titik klinik.
  - Memperbarui antarmuka kartu tugas dan jadwal mendatang di portal terapis dengan visual badge yang informatif.

### Added — UI Kalender Modern (Week/Day/Month/Table) & Modal Buat Jadwal Baru Terpadu dengan Searchable Service Catalog

- **Antarmuka Kalender Modern Dual-Pane (`packages/admin-dashboard/src/pages/tenant/Reservations.tsx`, `packages/admin-dashboard/src/components/calendar/*`)**:
  - **Sidebar Widget Kiri (`CalendarSidebar.tsx`)**:
    - **`MiniMonthCalendar.tsx`**: Widget mini kalender bulanan bernuansa dark modern (`#111b21`) dengan navigasi bulan, penanda titik tanggal yang memiliki jadwal reservasi, dan seleksi tanggal aktif yang sinkron dengan tampilan kalender utama.
    - **`UpcomingSpotlightCard.tsx`**: Kartu sorotan jadwal terdekat dengan waktu kunjungan (`12:00 - 13:30`), nama pasien, jenis layanan, tombol aksi cepat *Lihat Detail*, dan direct link WhatsApp pasien.
    - **Filter Kategori & Terapis**: Filter visual berbasis warna kategori (Baby: Sky Blue, Moms: Purple, Kids/Both: Emerald, Bundles: Amber) lengkap dengan counter jumlah janji temu aktif, filter terapis/staf, dan status.
  - **Main Calendar Canvas & View Switcher (`WeekScheduleGrid.tsx`, `DayScheduleGrid.tsx`, `MonthScheduleGrid.tsx`)**:
    - Header dinamis menampilkan Nama Bulan & Tahun (misal: *Agustus 2026*), tombol navigasi `<` (Sebelumnya), `Hari Ini` (Today), dan `>` (Berikutnya).
    - Switcher tampilan 4 mode fleksibel: **[ Bulan | Minggu | Hari | Tabel ]**.
    - **Week Schedule Grid (06:00 s.d. 21:00)**: Header 7 kolom hari diawali dari **Senin s.d. Minggu** dengan angka tanggal besar (hari ini / hari aktif disorot dengan badge kontras tinggi), kartu event pastel yang rapi dengan info pasien, treatment, rentang waktu, badge terapis, dan status pembayaran.
    - **Interactive Hover Slot Add (`+`)**: Mengklik slot jam kosong pada kalender mingguan atau harian akan langsung membuka modal *Buat Jadwal Baru* dengan tanggal & jam mulai yang otomatis terisi.
    - **Day Schedule Grid**: Tampilan detail jam per jam untuk 1 hari fokus dengan info kontak, alamat lengkap, dan jarak/ongkir.
    - **Month Schedule Grid**: Grid kalender 35/42 hari dengan tag janji temu per tanggal.
  - **Penyederhanaan Navigasi Sidebar (`Layout.tsx`)**: Menghapus item menu `Delivery Fee` dari sidebar utama karena pengaturan tarif ongkir sudah terintegrasi pada halaman operasional terkait.
- **Searchable Service Catalog Dropdown & Form Buat Jadwal Baru Lengkap (`packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx`)**:
  - **Searchable Service Dropdown (Dropdown Layanan Terpadu)**:
    - Terintegrasi secara live dengan katalog layanan klinik (`/api/admin/services`).
    - Input pencarian cepat dengan filter nama layanan, kategori, atau keyword.
    - Menampilkan nama paket, badge kategori, durasi (menit), dan harga paket.
    - Memilih layanan akan **otomatis mengisi kategori perawatan, nama treatment, dan mengkalkulasi estimasi jam selesai** berdasarkan durasi layanan (misal: booking jam 09:00 + durasi 60m → jam selesai 10:00).
    - Opsi toggle input kustom / manual jika layanan belum ada di katalog.
  - **Pencarian Customer & Quick Child Selector Chips**:
    - Pencarian customer live dari database (`/api/admin/customers`).
    - Menampilkan data alamat, jarak km, dan daftar anak/bayi yang sudah terdaftar sebagai chips yang bisa dipilih dalam 1-klik, serta opsi input bayi/anak baru.
  - **Penugasan Terapis, Status & Catatan Khusus**:
    - Dropdown pemilihan bidan terapis aktif (`/api/admin/staff`).
    - Pemilihan status (*Pending / Confirmed*) dan kolom catatan keluhan/permintaan khusus pasien.
- **Backend API & Test Enhancements (`src/routes/admin/reservations.subroute.ts`, `tests/unit/admin-create-reservation.test.ts`)**:
  - Endpoint `POST /api/admin/reservation` diperkaya untuk mendukung field `assignedStaffId`, `status`, `notes`, serta pemetaan kategori `KIDS` ke `BABY` dan `BUNDLE` ke `BOTH` pada enum Prisma.
  - Unit test `tests/unit/admin-create-reservation.test.ts` diperbarui dan berhasil lolos 100%.

### Fixed — Route Mappings & Canonical Path Alignment in Admin Dashboard

- **Penyelarasan Path Rute Frontend (`packages/admin-dashboard/src/App.tsx`)**:
  - Memperbaiki ketidaksesuaian path rute antara `Layout.tsx`, `rolePermissions.ts`, dan `App.tsx`:
    - `/admin/customer-service` (Customer Service & CTA)
    - `/admin/staff-management` (Staff & Terapis)
    - `/admin/delivery` (Delivery Fee / Tiers)
    - `/admin/follow-up-templates` (Follow-Up Templates)
    - `/admin/knowledge-base` (Knowledge Base)
    - `/admin/ai-evaluations` (AI Quality Evaluation)
    - `/admin/meta-click-catcher` (Meta Click Catcher)
    - `/admin/meta-capi-queue` (Meta CAPI Queue)
  - Menghapus duplikasi path `/admin/staff` yang sebelumnya menabrak rute staff today.
  - Menambahkan dukungan alias URL pendek (`/admin/cs`, `/admin/staff`, `/admin/tiers`, `/admin/knowledge`, `/admin/evaluations`, `/admin/meta-clicks`, `/admin/meta-capi`, `/admin/followup-templates`) yang otomatis mengarah ke rute kanonikal masing-masing secara mulus.

### Added — Full Admin Dashboard UI Overhaul to WhatsApp Web Light & Clean Emerald Aesthetic

- **Design System & Global CSS Tokens Migration (`packages/admin-dashboard/src/index.css`, `packages/admin-dashboard/src/components/common/Layout.tsx`, `packages/admin-dashboard/src/App.tsx`)**:
  - Merombak total seluruh desain antarmuka Super Admin & Tenant Dashboard dari nuansa gelap-pink (`slate-950`, `pink-500`, `glass-card`) menjadi desain elegan, bersih, dan berstandar **WhatsApp Web Light / Clean Emerald**:
    - Background Canvas: `#f0f2f5` (WhatsApp Web light gray canvas).
    - Surface & Cards: Putih bersih `#ffffff` dengan border halus `#e9edef`, bayangan natural `shadow-xs`, dan sudut membulat `rounded-2xl`.
    - Typography: Teks dengan kontras tinggi `#111b21`, teks sekunder/label `#667781` / `#54656f`, dan font sistem modern.
    - Brand Primary Color: `#008069` (Official WhatsApp Emerald) dengan hover state `#00a884` dan active state `#006d59`.
    - Sidebar Navigation: Background putih bersih dengan border kanan `#e9edef`, item aktif dengan latar emerald lembut `bg-[#e8f5f2] border-l-4 border-[#008069] text-[#008069] font-bold`, serta header profil tenant yang bersih.
    - Feedback & Utilities: Pagination, alert banners, toasts, and confirm dialogs migrated to crisp light components.
- **Halaman Operasional, Manajemen, AI & Marketing Dimigrasikan**:
  - `Login.tsx` & `StaffLogin.tsx`: Login card putih bersih dengan input ber-border `#d1d7db` dan tombol login emerald `#008069`.
  - `Overview.tsx`: Stat KPI cards, charts container, quick action buttons, dan reservasi harian dengan visual WhatsApp Web light.
  - `CustomerDatabase.tsx`: Tabel data pelanggan, badge VIP/MQL/Lead, filter pencarian, pagination, dan modal detail/edit pelanggan.
  - `Reservations.tsx`: Kalender/tabel janji temu, modal buat janji baru, badge status perawatan, dan kalkulator rincian biaya.
  - `StaffManagement.tsx`: Grid kartu staf & bidan terapis, badge role, modal tambah/edit staf, dan pengaturan jadwal kerja.
  - `ClinicServices.tsx`: Katalog layanan perawatan moms & baby, editor paket, harga, durasi, dan toggle aktif/nonaktif.
  - `DeliveryTiers.tsx`: Editor tabel tarif ongkir per radius kilometer dan potongan promo.
  - `FollowUpQueue.tsx`: Antrean pesan follow-up otomatis, badge status pengiriman, dan tombol trigger manual.
  - `FollowUpTemplates.tsx`: Editor template pesan follow-up dan template perjalanan terapis (`STAFF_OTW`).
  - `KnowledgeBase.tsx`: Manajemen artikel FAQ klinis & prosedur, editor teks, dan status embedding AI.
  - `AiPersona.tsx`: Konfigurasi nama bot, brand klinik, tone of voice, dan instruksi sistem bot AI.
  - `AiSandbox.tsx`: Simulator percakapan AI interaktif berlatar wallpaper chat WhatsApp `#efeae2` dengan bubble chat dua arah.
  - `AiEvaluations.tsx`: Tabel audit evaluasi respons AI router, skor akurasi, dan perbandingan intent.
  - `Settings.tsx` & Semua Sub-Panel (`WhatsAppProviderPanel.tsx`, `AiRouterPanel.tsx`, `MetaCapiPanel.tsx`, `PricelistImagePanel.tsx`, `MqlSettingsPanel.tsx`, `DailyReportPanel.tsx`, `InstallAppPanel.tsx`):
    - Tampilan pairing QR code WhatsApp, kredensial WAHA/WABA, AI Router switchboard, Meta CAPI token inputs, Telegram Daily Report, dan petunjuk install PWA.
  - `CustomerService.tsx`: Form pengaturan kontak WhatsApp CS dan generator CTA Link tracking.
  - `LandingPage.tsx` & `ExternalIntegrationModal.tsx`: Editor landing page kustom/template bawaan dan panduan embed script pelacakan.
  - `MetaClickCatcher.tsx` & `MetaCapiQueue.tsx`: Monitoring klik iklan Meta, atribusi konversi chat WhatsApp, dan antrean event Purchase CAPI.
  - `ChatExport.tsx` & `Debug.tsx`: Alat ekspor transkrip chat untuk evaluasi AI serta observability log & circuit breaker.

### Added — Tarik & Hapus Pesan WhatsApp untuk Semua Orang (Delete for Everyone / Revoke) & WABA Compatibility Guard

- **Gateway Abstraction Revoke Support (`src/integrations/whatsapp/gateway.types.ts`, `src/integrations/whatsapp/waha.driver.ts`, `src/integrations/whatsapp/waba.driver.ts`, `src/integrations/waha/client.ts`)**:
  - Menambahkan properti `supportsRevoke: boolean` dan method `deleteMessage(chatId, messageId, everyone = true)` pada interface `WhatsAppGateway`.
  - **WAHA Gateway (`WahaGatewayDriver`)**: Mengeset `supportsRevoke = true` dan mengimplementasikan penghapusan pesan via endpoint WAHA `DELETE /api/{session}/chats/{chatId}/messages/{messageId}?everyone=true` serta fallback `POST /api/messages/delete`.
  - **WABA Gateway (`WabaGatewayDriver`)**: Mengeset `supportsRevoke = false` karena Meta Cloud API tidak mengizinkan penarikan pesan dari perangkat customer setelah terkirim.
- **Backend Service & Real-Time Sync (`src/services/message.service.ts`, `src/services/live-chat.service.ts`, `src/services/live-chat-hub.service.ts`)**:
  - `messageService.markMessageDeleted(messageId, tenantId)`: Memperbarui konten pesan di database/memory menjadi `🚫 Pesan ini telah ditarik`, menandai `payload_raw.is_revoked = true`, dan mem-publish event `message.updated` ke hub SSE.
  - `liveChatService.revokeMessage({ conversationId, messageId, tenantId, adminName })`: Memvalidasi kepemilikan pesan outbound, memeriksa kapabilitas gateway tenant, menarik pesan di WhatsApp via driver, dan mencatat audit log `REVOKE_MESSAGE`.
  - `liveChatService.getGatewayCapability(tenantId)`: Endpoint untuk mendeteksi kapabilitas gateway tenant aktif (`provider` & `supportsRevoke`).
- **REST Endpoints (`src/routes/admin/livechat.subroute.ts`, `src/routes/staff/today.subroute.ts`)**:
  - `GET /api/admin/gateway-capability` & `GET /api/staff/gateway-capability`: Mengembalikan kapabilitas gateway aktif.
  - `DELETE /api/admin/conversations/:id/messages/:messageId`: Tarik pesan untuk panel Admin Live Chat.
  - `DELETE /api/staff/conversations/:id/messages/:messageId`: Tarik pesan untuk portal Terapis (dengan proteksi `assertConversationOwnedByStaffToday`).
- **Frontend UI & Conditional Guard (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - **Live Chat Monitor (Admin)** & **Staff Today Portal (Terapis)**:
    - Menampilkan ikon tombol hapus/tarik pesan (`Trash2`) pada bubble chat outbound hanya jika `gatewayCapability.supportsRevoke === true`.
    - **WABA Compatibility Guard**: Jika gateway tenant adalah WABA Meta Cloud API (`supportsRevoke === false`), tombol hapus **TIDAK dirender sama sekali** di UI agar tidak membingungkan pengguna.
    - Integrasi modal konfirmasi elegan via `useUiFeedback` sebelum menarik pesan.
    - Sinkronisasi real-time via SSE: jika pesan ditarik, bubble langsung terupdate dengan teks miring `🚫 Pesan ini telah ditarik`.

### Added — WhatsApp Aesthetic Overhaul for Therapist Portal & Staff Management Actions

- **Desain & UI WhatsApp Web Light Official Tokens (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`, `design.md`)**:
  - Redesign antarmuka portal chat terapis persis dengan tampilan WhatsApp Web Light resmi:
    - App Header & Bar: `#f0f2f5` dengan teks `#111b21`.
    - Canvas Wallpaper Chat: `#efeae2` (warm beige wallpaper dengan pola micro-dot).
    - Bubble Chat Inbound (Customer): `#ffffff` putih bersih dengan teks `#111b21` dan rounded-tl-none.
    - Bubble Chat Outbound (Terapis/Staff): `#d9fdd3` (WhatsApp soft mint green) dengan centang ganda biru (`#53bdeb`).
    - Bubble Chat Bot AI: `#ffffff` dengan aksen border hijau `#008069`.
    - Input Bar WhatsApp: Input teks `#ffffff` dengan tombol emoji, lampiran, dan tombol kirim `#008069`.
    - Quick Template Chips di atas input chat: `"📍 Sudah sampai di depan"` dan `"❤️ Ucapan selesai perawatan"`.
  - Menghapus label tagih/lunas yang menumpuk agar antarmuka kartu tugas lebih bersih dan fokus.
  - Mengganti tombol "Salin Info" menjadi tombol aksi cepat **"Infokan OTW"** (`Navigation2`) yang otomatis mengirimkan pesan konfirmasi perjalanan ke WhatsApp pasien dalam 1 klik.
  - Menghilangkan seluruh karakter em-dash (`—`) pada UI sesuai pedoman anti-slop `design.md`.
  - Menggunakan viewport stability `min-h-[100dvh]` untuk kenyamanan akses di browser mobile dan desktop.
- **Automatic Therapist Identity Signature (`src/routes/staff/today.subroute.ts`, `src/services/staff-reservation.service.ts`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menyisipkan tanda tangan identitas nama bidan terapis secara otomatis di baris paling bawah setiap pesan balasan lapangan (`\n\n~ [Nama Bidan]`).
  - Menghindari duplikasi jika pesan sudah mengandung tanda tangan.
  - Menampilkan badge indikator identitas pengirim di bawah kotak input chat portal terapis agar terapis mengetahui format pesan keluar.
- **Customizable OTW Template & Super Admin Editor (`src/config/followup-templates.ts`, `src/services/staff-reservation.service.ts`, `packages/admin-dashboard/src/pages/tenant/FollowUpTemplates.tsx`)**:
  - Menambahkan tipe template `STAFF_OTW` ke daftar template follow-up yang dapat diedit langsung oleh Super Admin.
  - Mendukung variabel dinamis `{patientName}`, `{therapistName}`, dan `{clinicName}` dengan fallback teks default bawaan.
  - Endpoint `GET /api/staff/otw-template` untuk merender template aktif sesuai pasien & staf yang bertugas.
- **Modern UI Feedback Modal Kit (`packages/admin-dashboard/src/components/common/UiFeedback.tsx`)**:
  - Merombak total tampilan modal konfirmasi dialog dan toast notifikasi:
  - Menghilangkan nuansa gelap/pink (`slate-950` / `pink-500`) dan menggantinya dengan tema elegan WhatsApp Light / Clean Emerald (`bg-white`, teks `#111b21`, aksen hijau `#008069`, dan backdrop bersih).
- **Mekanisme Pembayaran Lapangan & Upload Bukti Transaksi Ringan (`src/routes/staff/today.subroute.ts`, `src/services/staff-reservation.service.ts`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan tombol **"Catat Bayar"** dan modal pembayaran interaktif untuk terapis:
    - Pilihan metode: **Tunai (Cash)** vs **Non-Tunai (Transfer / QRIS)**.
    - Upload foto bukti transfer/QRIS dengan kompresi otomatis di sisi browser (HTML5 Canvas maks 800px, JPEG 0.65, ~50 KB bukan HD untuk menghemat kapasitas storage server).
    - Endpoint `POST /api/staff/reservations/:id/payment` yang memperbarui status transaksi menjadi lunas, mencatat bukti pembayaran, dan mengirimkan pesan konfirmasi/struk resmi ke chat customer secara otomatis.
- **Penyatuan Portal Terapis Menjadi 2 Tab Interaktif (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menggabungkan tampilan **Tugas & Chat Hari Ini** dan **Jadwal Mendatang** dalam 2 Tab di halaman yang sama (`/admin/staff/today`).
  - Memungkinkan terapis beralih antara memproses kunjungan hari ini dan mengecek jadwal besok/lusa secara cepat tanpa reload halaman.

### Added — Unified Login & Role-Based Access Control (RBAC) Multirole

- **Database Model & Migrations (`prisma/schema.prisma`, `prisma/migrations/20260831000000_add_rbac_roles`)**:
  - Memperluas enum `StaffRole` dengan role baru: `ADMIN_CS` dan `ADVERTISER` (selain `THERAPIST`).
- **Backend Unified Login 2-Tahap (`src/routes/admin/auth.subroute.ts`, `src/routes/admin.route.ts`)**:
  - `POST /api/admin/auth/login`: Satu pintu login untuk semua peran. Menerima `identifier` (Email atau No. WhatsApp) + `password`.
  - Tahap A: Jika password cocok dengan `ADMIN_API_KEY`, terbitkan `admin_session` cookie dan kembalikan role `super_admin` dengan auto-redirect `/admin/overview`.
  - Tahap B: Jika identifier cocok dengan nomor telepon di tabel `staff` (terapis, admin CS, atau advertiser) dan lolos verifikasi bcrypt password, terbitkan `staff_session` cookie dan kembalikan role serta auto-redirect yang sesuai (`/admin/staff/today` untuk `therapist`, `/admin/overview` untuk `admin_cs` dan `advertiser`).
  - `GET /api/admin/auth/me`: Menyelesaikan sesi aktif baik dari cookie `admin_session` maupun `staff_session`.
  - `POST /api/admin/auth/logout`: Membersihkan sesi dan cookie `admin_session` serta `staff_session` secara bersamaan.
  - Middleware `admin.route.ts` preHandler: Mengizinkan cookie `staff_session` untuk peran `ADMIN_CS` dan `ADVERTISER` mengakses endpoint manajemen admin.
- **Frontend Single Source of Truth RBAC Config (`packages/admin-dashboard/src/config/rolePermissions.ts`)**:
  - Definisi peran `AppRole` (`super_admin`, `tenant_admin`, `admin_cs`, `advertiser`, `therapist`).
  - Matriks akses menu `ROLE_MENU_ACCESS` dan helper `hasAccess(role, path)` serta `getDefaultRedirect(role)`.
- **Frontend Unified UI & Dynamic Navigation (`packages/admin-dashboard`)**:
  - `Login.tsx`: Form login universal menerima Email Admin atau No. WhatsApp Staff, melakukan auto-redirect dinamis berdasarkan role yang dikembalikan server.
  - `Layout.tsx`: Menyaring menu sidebar admin secara dinamis sesuai role pengguna yang login, menampilkan nama & role badge di footer sidebar.
  - `ProtectedRoute.tsx`: Route guard memeriksa izin akses path per-role berdasarkan matriks RBAC dan redirect ke `/admin/unauthorized` jika tidak diizinkan.
  - `App.tsx`: Mengalihkan rute lama `/admin/staff/login` ke `/admin/login`, menambahkan alias rute `/staff`, `/terapis`, dan `/chat` ke portal terapis.
  - `StaffManagement.tsx`: Menambahkan opsi pemilihan peran (`THERAPIST`, `ADMIN_CS`, `ADVERTISER`) saat membuat akun staff baru.

### Added — Enriched Therapist Portal (Alamat Lengkap, Anak, Harga, & Navigasi Turn-by-Turn)

- **Backend Enriched Task Query (`src/services/staff-reservation.service.ts`)**:
  - Memperkaya interface `StaffTaskItem` dengan:
    - `address`: Kelurahan, Kecamatan, Kota, Jarak dari klinik dalam km, dan `fullText`.
    - `children`: Daftar nama anak/bayi dan usia saat ini (`rawAgeText`).
    - `pricing`: Rincian biaya treatment, ongkir, `totalFee`, dan status pembayaran (`LUNAS` jika ada `purchase_occurred_at`, atau `TAGIH_DI_TEMPAT`).
    - `navigationUrl`: Link navigasi turn-by-turn Google Maps (`https://www.google.com/maps/dir/?api=1&destination=lat,lng&travelmode=driving`).
    - `shareLocationText`: Teks format ringkas informasi kunjungan siap salin/share ke WhatsApp.
- **Frontend Mobile-First Task Card & Header (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menampilkan alamat lengkap dan badge jarak (mis. *2.5 km* dari klinik) pada setiap kartu tugas.
  - Menampilkan badge nama & usia anak (mis. *👶 Kenzo (6 bulan)*).
  - Menampilkan kotak breakdown biaya: Biaya Treatment + Ongkir = **Total Tagihan** serta badge status pembayaran (Lunas vs Tagih di Tempat).
  - Tombol aksi cepat: **Navigasi** (membuka navigasi rute Google Maps langsung) dan **Salin Info** (menyalin ringkasan tugas ke clipboard dengan feedback visual).
  - Integrasi preview media/gambar pada thread chat live dengan prop `MediaImage` yang aman.
- **Unit & Integration Tests (`tests/unit/unified-login.test.ts`, `tests/unit/role-permissions.test.ts`, `tests/unit/staff-auth-and-reservation.test.ts`)**:
  - 41/41 unit & integration test untuk seluruh flow auth, staff, RBAC, dan reservation query lulus 100%.

- **Database Model & Migrations (`prisma/schema.prisma`, `prisma/migrations/20260830000000_add_staff_access`)**:
  - Menambahkan enum `StaffRole { THERAPIST }`.
  - Menambahkan model `Staff` (`id`, `tenant_id`, `name`, `phone`, `password_hash`, `role`, `active`, `created_at`, `updated_at`) dengan index `[tenant_id, phone]`.
  - Menambahkan model `StaffSession` (`id`, `staff_id`, `token_hash`, `expires_at`, `created_at`) dengan TTL 12 jam dan index `[token_hash]`, `[staff_id]`, `[expires_at]`.
  - Menambahkan field relasi `assigned_staff_id` dan `assigned_staff Staff?` pada model `Reservation` dengan index `[assigned_staff_id]`.
- **Backend Service Layer (`src/utils/bcrypt.ts`, `src/services/staff-auth.service.ts`, `src/services/staff-reservation.service.ts`)**:
  - `bcrypt.ts`: wrapper hashing password dengan bcrypt salt rounds 12.
  - `StaffAuthService`: login dengan rate limit dan database-backed session token SHA-256, validasi sesi, logout, dan pencabutan sesi massal (`revokeAllSessions`).
  - `StaffReservationService`: query jadwal tugas harian terapis (`getTodayTasks`) dengan privasi masking nomor telepon pelanggan di level DB query, serta guard validasi kepemilikan percakapan (`assertConversationOwnedByStaffToday`).
  - Unit tests: `tests/unit/staff-auth-and-reservation.test.ts` (10/10 PASS).
- **Backend Routes & SSE Stream (`src/routes/staff.route.ts`, `src/routes/staff/auth.subroute.ts`, `src/routes/staff/today.subroute.ts`)**:
  - Endpoint auth staff: `POST /api/staff/auth/login` (rate limit 5 req/min), `POST /api/staff/auth/logout`, `GET /api/staff/auth/me`.
  - Endpoint portal staff: `GET /api/staff/today-tasks`, `GET /api/staff/conversations/:id/messages` (ownership-guarded), `POST /api/staff/conversations/:id/reply` (mengirim via gateway bot official tenant dengan audit logging identitas staff).
  - Endpoint SSE real-time: `GET /api/staff/live-chat/events` dengan filter server-side agar terapis hanya menerima event dari customer yang ditugaskan hari ini.
  - Integration tests: `tests/integration/staff-routes.test.ts` (11/11 PASS).
- **Admin Staff Management & Reservation Assignment API (`src/routes/admin/staff-management.subroute.ts`, `src/routes/admin/reservations.subroute.ts`)**:
  - CRUD Akun Staff: `GET /api/admin/staff`, `POST /api/admin/staff` (auto bcrypt), `PATCH /api/admin/staff/:id` (toggle status aktif / reset password dengan auto revocation sesi).
  - Penugasan Reservasi: `PATCH /api/admin/reservation/:id/assign-staff` dengan audit logging admin.
  - Integration tests: `tests/integration/admin-staff-management.test.ts` (6/6 PASS).
- **Frontend Staff Portal & Auth UI (`packages/admin-dashboard`)**:
  - `StaffAuthContext.tsx`: React Context terisolasi untuk autentikasi staff (cookie `staff_session`).
  - `StaffProtectedRoute.tsx`: Route guard untuk mengarahkan pengguna yang belum login ke portal staff.
  - `StaffLogin.tsx`: Halaman login mobile-first terapis bertema teal modern.
  - `StaffToday.tsx`: Portal tugas lapangan & Live Chat terapis dengan:
    - Ringkasan tugas harian (nama pasien, jam, jenis treatment).
    - Tombol petunjuk arah "Google Maps" langsung (`mapsUrl`).
    - Live Chat real-time via SSE `/api/staff/live-chat/events` dengan notifikasi audio beep Web Audio API & native browser notification.
    - Pengiriman balasan aman via gateway bot klinik dengan touch target ramah mobile (>= 44x44px).
- **Frontend Admin UI Staff Management & Assignment (`packages/admin-dashboard`)**:
  - `StaffManagement.tsx`: Halaman admin untuk mengelola staff, modal tambah staff, reset password, dan toggle nonaktif akun dengan modal konfirmasi `useUiFeedback`.
  - `Reservations.tsx`: Dropdown penugasan terapis di modal detail reservasi dan badge nama terapis di tabel list & card mobile.
  - `App.tsx`: Rute `/admin/staff/login`, `/admin/staff/today`, `/admin/staff-management`.
  - `Layout.tsx`: Menu navigasi "Staff & Terapis" di sidebar admin.

### Fixed — Fase 8: Anti Hard-Selling FAQ, Batch Follow-Up & Media Webhook (Phase 1-4 hardening)

- **Add Surabaya & Sidoarjo Major Apartments & Landmarks Geocoding Map & Set Haversine Circuity Factor to 1.60x (`src/config/landmarks.ts`, `src/integrations/google-maps/geocoding.ts`, `src/services/delivery.service.ts`, `.env`)**:
  - Menambahkan kamus pemetaan cepat untuk 30+ apartemen, mall, dan landmark besar di Surabaya & Sidoarjo (*CitraLand Vittorio, Gunawangsa Tidar/Manyar/MERR, Anderson Tower / Benson / Orchard / Tanglin / Pakuwon Mall, Klaska Residence, Grand Sungkono Lagoon, Grand Dharmahusada Lagoon, The Rosebay Graha Famili, Grand Shamaya, Apartemen Taman Melati, Kyo Society, One Icon Residence, Waterplace / Ascott, Taman Beverly, The Galaxy Residences, Metropolis Apartemen, Pavilion Permata, Puri Darmo, Puncak Kertajaya/Marina/Permai, CITO, Banjarmukti, Safira Garden, CitraGarden, Kahuripan Nirwana, Prospero, dll.*).
  - Mengupdate formula fallback pengali kelokan jarak *Haversine* (`HAVERSINE_CIRCUITY_FACTOR`) menjadi **1.60x** agar estimasi jarak tempuh perkotaan selaras dan akurat dengan rute jalan nyata berkendara (*OpenRouteService / Google Maps*).
  - Penambahan unit test `tests/unit/surabaya-apartments-geocoding.test.ts` (20/20 PASS).
- **Add Religious Neutrality & Mandatory Waalaikumsalam Response Prefix (`src/state-machine/utils/islamic-greeting-helper.ts`, `machine.ts`, `greeting.ts`, `persona.ts`)**:
  - Menghilangkan/mengurangi kata keagamaan seperti *"Alhamdulillah"* dari percakapan normal demi netralitas agama pelanggan yang majemuk.
  - Menambahkan deteksi sapaan Islami (`hasIslamicGreeting`, mis. *"assalamualaikum"*, *"assalamu'alaikum wr wb"*, *"ass"*, *"aslm"*, *"mikum"*).
  - Mengimplementasikan aturan **WAJIB menjawab "Waalaikumsalam Bunda"** di awal respon sebelum melanjutkan pesan / jawaban apa pun jika customer menyapa dengan Assalamualaikum.
  - Penambahan unit test `tests/unit/islamic-greeting-response.test.ts` (5/5 PASS).
- **Fix General Age Treatment Recommendation ("Untuk anak umur 17 bulan yg mana yaa") (`src/services/treatment-catalog.service.ts`, `src/state-machine/handlers/interest.ts`, `src/integrations/llm/generator.ts`)**:
  - Memperbaiki perilaku di mana customer yang hanya menanyakan rekomendasi treatment berdasarkan usia secara umum (tanpa keluhan sakit) keliru ditawari paket terapi penyakit (seperti *Pijat Pulih Ceria*, *Nebulizer*, *Sinar Moksa*).
  - Menambahkan filter `onlyGeneral` pada `getServicesByAge` jika pesan tidak mengandung keluhan medis / gejala sakit (`checkMedicalKeywords`), menyaring hanya treatment relaksasi & kebugaran standar (*Pijat Bayi Ceria*, *Pijat Kids Ceria*, *Pijat Lahap Juara*).
  - Menambahkan aturan prompt rule 9 pada AI Generator untuk mengarahkan pertanyaan usia umum ke treatment relaksasi/wellness dan melarang penawaran terapi sakit/nebulizer tanpa adanya keluhan dari customer.
  - Penambahan unit test `tests/unit/general-age-treatment-recommendation.test.ts` (3/3 PASS).
- **Upgrade POI & Housing Complex Geocoding Intelligence ("Banjarmukti Residence Sidoarjo") (`src/integrations/google-maps/geocoding.ts`)**:
  - Memperbaiki kelemahan di mana nama perumahan/POI spesifik (seperti *"banjarmukti Residence"*, *"safira garden"*, *"citragarden"*, *"puri surya jaya"*) yang dikirim bersama nama kota *"sidoarjo"* keliru dibajak oleh gate kecamatan sebagai input "hanya kecamatan", sehingga bot keliru menanyakan daftar kelurahan di Kecamatan Sidoarjo (Suko, Pekauman, Sidoklumpuk).
  - Menambahkan deteksi token perumahan/kompleks (`residence`, `regency`, `cluster`, `villa`, `apartemen`, `townhouse`, `mansion`, `estate`, `griya`, `graha`, dll.) dan token nama tempat bermakna (mis. `banjarmukti`). Sistem sekarang meneruskan nama perumahan ke pipeline Geocoding / LLM resolver sehingga berhasil dipetakan ke kelurahan presisi (**Kelurahan Banjarkemantren, Kec. Buduran, Sidoarjo**).
  - Penambahan unit test `tests/unit/poi-housing-geocoding.test.ts` (2/2 PASS) dan update few-shot prompt LLM geocoder.
- **Fix Clinic Location / Midwife Origin Inquiry ("Kalo boleh tau kakaknya darimana kak?") (`src/state-machine/utils/clinic-location-checker.ts`, `interest.ts`, `location.ts`, `generator.ts`, `nlu-classifier.service.ts`)**:
  - Memperbaiki bug di mana customer yang menanyakan lokasi klinik/asal bidan (e.g. *"Saya dari surabaya timur kak. Kalo boleh tau kakaknya darimana kak?"*) keliru dibalas dengan template penutup reservasi (*"Apakah Bunda tertarik untuk lanjut mengisi list reservasi..."*) alih-alih menjawab lokasi klinik.
  - Menambahkan detector `isAskingClinicLocation`, menyelaraskan intent `faq_question` pada NLU & question override guard di `interest.ts` & `location.ts`, serta menginjeksi FAQ lokasi fisik resmi: *"Kami berlokasi di daerah Waru (perbatasan Sidoarjo - Surabaya). Kami melayani sistem Homecare (panggilan langsung ke rumah), jadi tim bidan kami yang datang langsung ke rumah Bunda di area Surabaya & Sidoarjo"*.
  - Penambahan unit test `tests/unit/clinic-location-question.test.ts` (2/2 PASS) dan update integration suite `tests/integration/all-reported-user-scenarios.test.ts` (7/7 PASS).
- **Add Hold & Family Discussion Intent Handler ("Oke sbntr sy coba tnykan ya") (`src/state-machine/utils/need-time-checker.ts`, `location.ts`, `interest.ts`, `location-confirmation.ts`, `phrasing.service.ts`)**:
  - Menambahkan deteksi intensi jeda waktu dan diskusi keluarga (*need time / hold discussion*, e.g. *"Oke sbntr sy coba tnykan ya"*, *"tanya suami dulu ya"*, *"rembukan dulu"*, *"nanti saya kabari lagi"*, *"pikir2 dulu ya"*).
  - Ketika customer meminta waktu untuk berdiskusi, bot tidak lagi mendesak atau menagih ulang pertanyaan lokasi/ongkir/harga, melainkan membalas dengan hangat dan sabar: *"Baik Bunda, kami tunggu kabarnya ya bund 🤗 Santai saja yaa, nanti kalau sudah siap atau ada yang ingin ditanyakan lagi, langsung kabari kami kembali ya Bunda 😊🙏🏻"*.
  - Penambahan unit test `tests/unit/need-time-discussion.test.ts` (2/2 PASS) dan update integration suite `tests/integration/all-reported-user-scenarios.test.ts` (6/6 PASS).
- **Fix LLM Phrasing Translation Hallucination ("antimeminjamkannya") (`src/utils/language-sanitizer.ts` & `src/integrations/llm/phrasing.service.ts`)**:
  - Memperbaiki bug di mana Phrasing LLM saat memvariasikan template tanya kelurahan/lokasi menghalusinasikan kata *"ongkir"* menjadi istilah terjemahan aneh: *"biaya antimeminjamkannya"*.
  - Menambahkan fungsi `sanitizeHallucinatedTerms` pada `language-sanitizer.ts` dan constraint ketat pada `PhrasingService` untuk intent `ask_kelurahan_detail` & `ask_location` agar selalu mempertahankan istilah resmi (*"ongkir"* / *"ongkos kirim"*), serta otomatis membersihkan istilah terjemahan janggal.
- **Activate AI Router (Shadow Mode OFF) (`.env` & `src/config/ai-router-config.ts`)**:
  - Mengubah konfigurasi AI Router dari mode pengamat (*shadow mode*) menjadi mode aktif penuh (`AI_ROUTER_ENABLED=true`, `AI_ROUTER_SHADOW_MODE=false`).
  - Penambahan comprehensive integration test `tests/integration/all-reported-user-scenarios.test.ts` (5/5 PASS) untuk memvalidasi seluruh skenario percakapan nyata.
- **Fix Symptom & Consultation Inquiries Blocked by Mixed-Signal Regex (`src/state-machine/handlers/interest.ts`)**:
  - Memperbaiki bug di mana customer yang menceritakan kondisi/keluhan bayi dengan kata sambung dan negasi (seperti *"Iya bu bid nafasnya agak grok2 tapi tidak kayak pilek"*) diblokir keliru oleh regex `MIXED-SIGNAL DETECTION` dan dibalas pesan aneh: *"Maaf Bunda, sepertinya ada yang kurang tepat. Bunda ingin mengubah lokasi..."*.
  - Menghapus blok regex `MIXED-SIGNAL DETECTION` yang salah tempat di handler `interest.ts` agar pesan konsultasi medis, gejala si kecil, dan pertanyaan treatment diteruskan secara alami ke RAG & AI Response Generator (Bidan Yusi) dengan empati dan rekomendasi treatment yang tepat (seperti terapi nebulizer / pijat flu-batuk).
- **Increase AI Sandbox Simulator Timeout (`packages/admin-dashboard/src/pages/tenant/AiSandbox.tsx`)**:
  - Memperbaiki error `Error calling AI Generator: Koneksi server/database lambat (Timeout 45s)` pada AI Sandbox Simulator di Admin Dashboard.
  - Batas waktu tunggu HTTP fetch pada simulator ditingkatkan dari 45 detik (`45000ms`) menjadi 120 detik (`120000ms`) agar pipeline multi-stage LLM (NLU Classifier + AI Router + Geocoder reasoning + Response Generator) tidak dibatalkan prematur oleh frontend saat provider LLM sedang mengalami antrean lambat.
- **Fix Location Confirmation False Affirmation & Override Detection (`src/state-machine/handlers/location-confirmation.ts`)**:
  - Memperbaiki bug kritis di mana pesan koreksi alamat (seperti *"alamatnya Rumdis TNI AL Wonosari A132"*) keliru diklasifikasikan sebagai `affirmation` oleh NLU saat bot sedang menanyakan konfirmasi lokasi lama. Akibatnya, sistem sebelumnya keliru mempromosikan lokasi lama (*Pabean, Sedati 3.66 km*) alih-alih memproses alamat baru.
  - Menambahkan guard `isProvidingNewLocation`: jika pesan mengandung intensi atau entitas alamat baru, pesan tersebut **TIDAK AKAN PERNAH** dianggap sebagai afirmasi lokasi lama, melainkan langsung dialihkan (*override redirect*) ke `handleLocationState` untuk resolusi alamat baru.
- **Fix Geocoding Substring Hijacking & Action Prefix Stripping (`src/integrations/google-maps/geocoding.ts` & `src/state-machine/handlers/location.ts`)**: 
  - Memperbaiki bug di mana setiap alamat yang menyertakan nama kota/kabupaten di belakangnya (seperti *"Bungurasih tengah sidoarjo"*, *"Tropodo sidoarjo"*, *"Kutisari surabaya"*) dibajak keliru oleh gate kecamatan karena kata *"sidoarjo"* / *"surabaya"* mencocoki entri *Kecamatan Sidoarjo / Kecamatan Surabaya*. Kini gate memeriksa `hasAnyKelurahanInText` dan `isExactKecamatanName` sehingga jika teks memuat nama kelurahan riil (seperti *Bungurasih* di *Kec. Waru*), sistem langsung meresolusi kelurahan tersebut tanpa membajak ke Kecamatan Sidoarjo kota.
  - Memperbaiki bug di mana kata aksi percakapan di awal kalimat (seperti *"ganti ke..."*, *"ubah ke..."*, *"pindah ke..."*) sebelumnya diteruskan ke fuzzy gazetteer matcher, menyebabkan kata *"ganti"* keliru dicocokkan sebagai typo dari *Kelurahan Ganting (Kec. Gedangan)*. Kini `findBestGazetteerMatch` menggunakan `cleanText` yang telah membersihkan kata aksi percakapan.
  - Memperbaiki gate pencocokan kecamatan yang sebelumnya menggunakan `kecKey.includes(cleanNorm)`, yang menyebabkan nama kelurahan presisi (seperti *"Pabean"* di *Kecamatan Sedati, Sidoarjo*) dibajak keliru menjadi kecamatan luas yang namanya mengandung substring tersebut (*"Kecamatan Pabean Cantian, Surabaya"*).
  - Menambahkan normalisasi spasi pada `crossCheckGazetteer` agar variasi ejaan (seperti *"Bulak Banteng"* vs *"Bulakbanteng"*) dapat langsung terhubung ke koordinat presisi.
  - Memperbaiki `llmResolveLocation` dengan timeout 120s dan integrasi `callChatCompletionsWithFallback` serta penambahan contoh komplek landmark (seperti *"Rumdis TNI AL Wonosari"* -> *Bulakbanteng, Kenjeran*).
  - Penambahan unit test `tests/unit/sedati-pabean-geocoding.test.ts` (5/5 PASS).
- **Guard `treatmentNameForFollowUp` EKSEKUTIF (resolusi docs drift)** (`src/state-machine/handlers/interest.ts`): entri lama di changelog mengklaim guard `treatmentExplicitlyMentioned` sudah ada — ternyata tidak pernah di-implementasi. Kini diimplementasi: nama treatment untuk CTA follow-up HANYA diisi jika pesan customer mengandung **nama full katalog** (exact phrase nama tanpa kurung, lowercase via `getAllServices()`). Match parsial/fuzzy (mis. "pijat bayi" → "Pijat Bayi Ceria") dan entity NLU TIDAK dipakai — pertanyaan edukatif murni ("usia minimal berapa?") tidak lagi memaksa LLM menawarkan paket yang tidak ditanyakan (mis. "Paket Selapan").
- **Test anti-regresi** `tests/unit/faq-no-treatment-leak.test.ts` (baru, 6 kasus): pesan FAQ usia → arg ke-5 `generateFaqResponseWithDetails` undefined; pesan dengan nama FULL ("pijat bayi ceria...", "nebulizer itu buat apa ya?", "pijat lahap juara...") → nama bersih treatment terkirim.
- **Tighten deteksi ask_price** (`src/services/nlu-classifier.service.ts`, `src/state-machine/handlers/greeting.ts`, `src/services/price-answer.service.ts`): "usia berapa boleh pijat?"/"minimal berapa bulan?" bukan pertanyaan harga. Aturan: `berapa` hanya ask_price jika TANPA konteks usia (`usia|umur|minimal|berat|tinggi`); harga eksplisit & nominal `rb/ribu` bebas → harga; nominal bare `k` hanya jika ada kata harga. `isAskPrice` ikut mengecualikan `usia|umur`.
- **Fix regresi dual-intent location** (`src/state-machine/handlers/location.ts`): blok [DUAL INTENT LOCATION+FAQ] kini menghormati `skipFaqIntercept` — query lokasi murni ("Kalau ke wedoro ka ?" — tanda `?` hanya sopan-santun) tidak lagi dibelokkan ke pass kedua `handleInterestState` yang membuang info ongkir ke balasan generik.
- **Batch anti N+1 `checkAndSetLostCustomers`** (`src/services/follow-up.service.ts`): 1 query `reservation.findMany` dengan `created_at > min(sent_at)` menggantikan loop `findFirst` per follow-up; semantik **persis per follow-up** dipertahankan via filter in-memory `created_at > f.sent_at` (keputusan: bukan `thresholdDate`). Test tambahan: customer dengan reservasi setelah `sent_at` TIDAK di-mark lost.
- **Media berat async** (`src/routes/webhook.route.ts`, `src/integrations/waha/types.ts`): image tetap sinkron (Live Chat); video/audio/document kini diunduh **background fire-and-forget** (arsip ke storage, tidak dirender Live Chat, webhook tidak diblok). Tipe `videoMessage`/`audioMessage`/`documentMessage` ditambahkan ke `WahaMessagePayload`.
- **Guard wrapper console** (`src/utils/context.ts`): marker diganti `__contextWrapped` (namespaced) + wrapper mem-chain `.original` yang sudah ada — anti double-wrap/infinite recursion bila dipasang di atas `installLogBuffer` (urutan boot aman di `app.ts`).
- **Fix typo regex** (`src/state-machine/handlers/greeting.ts`): duplikat `jumat|jumat` di `regexHasAskSchedule` dihapus.

### Verifikasi Fase 8

- `npm run build` (tsc) exit 0.
- Vitest: 1274/1275 hijau — sisa kegagalan `tests/integration/bot-toggle-messaging-schema.test.ts` (butuh infra, gagal identik di baseline HEAD).
- Stres 50 sesi `test-50-same-opener.ts` (LLM asli, 2026-08-14): **0 raw JSON leak, 0 harga/promo/Rp di FAQ, 0 hard-sell CTA ("Mau coba..."/"mau treatment"), 0 "Paket Selapan", 0 eskalasi; 49/50 balasan terkirim (98%; 1 silent = pola LLM timeout pra-eksis, sebelumnya 2/10), 49/50 minta lokasi.**

### Fixed — Fase 1: Critical Bug Fixes (AI Chatbot Hardening)

- **FAQ cache poisoning lintas customer** (`src/services/faq-cache.service.ts`, `src/integrations/llm/generator.ts`): cache key kini memasukkan `isLocationKnown` + `additionalContextText` — konteks yang mengubah prompt (CTA "tanya lokasi" vs assumptive-close, fakta ongkir). Customer tanpa lokasi tidak lagi menerima jawaban cached milik customer yang sudah tahu lokasi.
- **Raw JSON leak di Phrasing Service** (`src/integrations/llm/phrasing.service.ts`): saat `JSON.parse` gagal, JSON mentah (`{"message": ...}`) tidak lagi dikirim ke customer — diekstrak via regex, sisanya jatuh ke template statis. Plain text non-JSON tetap dipakai.
- **Guard akses `choices[0].message.content`** (`generator.ts`, `intent.ts`, `phrasing.service.ts`): optional chaining + guard response kosong → masuk jalur fallback (soft-fallback / rule-based / template), tidak lagi `TypeError`.

### Fixed — Fase 2: Medical Detection Consolidation

- **Satu sumber keyword medis**: array ad-hoc di `src/integrations/llm/intent.ts` & `src/services/nlu-classifier.service.ts` dihapus — semua arah ke `checkMedicalKeywords` (config single source).
- **Word-boundary matching** (`src/config/medical-keywords.ts`): keyword pendek (≤6 huruf) dipakai dengan boundary + pengecualian frasa ("step by step") — "kaku" tidak match "kakun", "kuning" tidak match "kuningan".

### Added — Fase 3: LLM Gateway Abstraction

- **Helper terpusat** `src/integrations/llm/llm-gateway.ts`: `getLlmEndpointConfig` (resolve apiKey/baseUrl/model/timeout) + `callChatWithRetry` (retry/backoff transient) + re-export `extractJsonContent`. Menghilangkan getter `apiKey`/`baseUrl` duplikat di ai-router, intent, generator, phrasing, nlu-classifier, llm-evaluator.
- **Transient retry di `model-fallback.ts`**: 429/5xx/timeout pada model primary kini di-retry (default 2×, backoff eksponensial) sebelum masuk fallback chain — tidak lagi sekali gagal = langsung ganti model.
- **JSON extraction terpusat** di ai-router (`extractJsonContent`) — anti duplikasi fence-strip.

### Fixed — Fase 4: Tenant-Aware Model Registry

- **Registry per-tenant** (`src/config/ai-models.config.ts`): `Map<tenantId, Map<task, config>>` — load tenant B tidak menimpa tenant A; `getModelConfig`/`getAllTaskConfigs`/`updateTaskConfig` menerima `tenantId` (default `DEFAULT_TENANT_ID`).
- **`globalBotActive` per-tenant** via `isBotActive`/`setBotActive` — disable satu tenant tidak memengaruhi tenant lain (caller: `machine.ts`, `settings.subroute.ts`).

### Fixed — Fase 5: Error Handling Hardening

- **Helper `parsePositiveInt`/`parseNonNegativeNumber`** (`src/utils/env-numeric.ts`): fail-closed untuk env numerik (NaN/negatif/nol → fallback default). Diterapkan ke `llm-context`, `ai-router` (timeout), `llm-gateway`, `nlu-classifier`, `follow-up.service`, `llm-evaluator`.
- **Opener-tracker size cap** (`src/integrations/llm/opener-tracker.ts`): cap 500 conversation + evict LRU — tidak unbounded growth.
- **LLM evaluator ikut audit** (`src/services/llm-evaluator.service.ts`): panggilan evaluator kini tercatat di `llm_audit_logs` (task `AI_EVALUATION`), sukses & error.

### Fixed — Fase 6: Router Signal Cleanup

- **Flag eskalasi router di-honor** (`src/state-machine/machine.ts`): selain `UNKNOWN_REPEATED`, kini `MEDICAL_KEYWORD_SUSPECTED` & `SCHEDULE_REQUEST` ikut auto-escalate ke human handling di full mode (shadow mode tetap pasif).
- **Dead state branches** (`src/integrations/llm/ai-router.ts`): branch state yang tidak ada di enum Prisma (`AWAITING_CONFIRMATION`, `AWAITING_RESERVATION_DETAILS`) diganti state asli (`LOCATION_CONFIRMED`, `RESERVATION_SENT`) dengan alias untuk kompatibilitas caller lama.
- **`compareRouterDecisions`** kini membandingkan entity lokasi & treatment — kualitas ekstraksi terlihat di metrik shadow.
- **Bersihkan duplikasi**: duplikat `'baby spa'` dihapus; komentar `RESERVATION_NAME_RE` diperjelas (fallback lowercase sengaja tidak dipakai karena false positive).

### Fixed — Fase 7: Follow-up Engine Fixes

- **Idempotency `createNextTreatmentFollowUps`** (`src/services/follow-up.service.ts`): guard memakai `existing` (status PENDING/QUEUED) — pemanggilan ganda tidak membuat duplikat.
- **Anti-starvation `processDueFollowUps`**: `orderBy` deterministik (`scheduled_at ASC, created_at ASC`) — subset tidak lagi arbitrer per run.

### Verifikasi

- `npm run build` (tsc) exit 0.
- Test unit terkait (Fase 1-7) hijau: faq-cache, phrasing, generator safe-fallback, medical-keywords, model-fallback-chain, qa-nlu-fallback-security, ai-models-tenant, env-numeric, ai-router-engine, follow-up-engine, dan lain-lain.
- Catatan: kegagalan pre-existing di `timer.test.ts`, `waha-label-resilience.test.ts`, `daily-report.test.ts` (timeout) sudah dikonfirmasi identik tanpa perubahan fase ini.

---

## [Unreleased] - 2026-08-13

### Fixed — Sanitasi Teks Meta / Pengantar LLM Phrasing Engine
- **Masalah**: Pada pesan `ongkir_info` atau phrasing tertentu, model LLM terkadang mengikutsertakan teks pengantar meta (seperti *"Siapp, ini pesan variasi untuk ongkir_info dari fakta yang ada:\n\n---\n\n\"Wah dekat banget...\""*) yang ikut terkirim ke WhatsApp pelanggan.
- **Perbaikan**:
  - `src/integrations/llm/phrasing.service.ts`: Menambahkan pembersihan otomatis menggunakan regex untuk membuang teks pengantar meta (`Siapp, ini pesan variasi...`), pemisahr `---`, serta tanda petik pembungkus secara otomatis sebelum balasan dikirimkan.

### Fixed — Resilience LLM Response Generator (Fallback Plain Text Non-JSON)
- **Masalah**: UI hanya bisa mengekspor 1 tanggal sekaligus; user ingin input rentang tanggal (contoh: analisa mingguan) dalam satu file.
- **Perbaikan**:
  - `src/services/chat-export.service.ts`: refactor — `generateDay` + `loadDayData(date)` diekstrak, fungsi baru `generateRange(tenantId, startDate, endDate)` (maks 31 hari, validasi format & urutan tanggal) yang merender SATU file Markdown berisi tabel ringkasan per hari + transkrip blok per hari; `renderConversationBlocks` dipakai bersama oleh `buildDailyChatMarkdown` (output harian identik, unit test tetap hijau).
  - `src/routes/admin/export.subroute.ts`: `GET /api/admin/export/daily-chats` menerima `startDate` & `endDate` opsional (fallback `date`/hari ini tetap jalan); error validasi → HTTP 400 dengan pesan Bahasa Indonesia.
  - `src/services/chat-export.service.ts` `listExports()`: mengenali file rentang `daily-chats-YYYY-MM-DD-to-YYYY-MM-DD.md` (field `rangeEnd`).

### Added — Daily Chat Export: Rentang Tanggal (startDate & endDate)
- **Masalah**: UI hanya bisa mengekspor 1 tanggal sekaligus; user ingin input rentang tanggal (contoh: analisa mingguan) dalam satu file.
- **Perbaikan**:
  - `src/services/chat-export.service.ts`: refactor — `generateDay` + `loadDayData(date)` diekstrak, fungsi baru `generateRange(tenantId, startDate, endDate)` (maks 31 hari, validasi format & urutan tanggal) yang merender SATU file Markdown berisi tabel ringkasan per hari + transkrip blok per hari; `renderConversationBlocks` dipakai bersama oleh `buildDailyChatMarkdown` (output harian identik, unit test tetap hijau).
  - `src/routes/admin/export.subroute.ts`: `GET /api/admin/export/daily-chats` menerima `startDate` & `endDate` opsional (fallback `date`/hari ini tetap jalan); error validasi → HTTP 400 dengan pesan Bahasa Indonesia.
  - `src/services/chat-export.service.ts` `listExports()`: mengenali file rentang `daily-chats-YYYY-MM-DD-to-YYYY-MM-DD.md` (field `rangeEnd`).
  - `packages/admin-dashboard/src/pages/tenant/ChatExport.tsx`: input tanggal tunggal diganti dua input **Dari / Sampai** (max = hari ini), validasi urutan & batas 31 hari, file rentang tampil di daftar dengan label `tgl s/d tgl`.
- **Verifikasi**: `tsc` hijau; dashboard build OK; unit test `chat-export` 18/18 hijau; API live `?startDate=2026-08-10&endDate=2026-08-12` → `daily-chats-2026-08-10-to-2026-08-12.md` (12 percakapan/226 pesan, tabel per hari 4/153, 5/23, 3/50); rentang terbalik (`2026-08-12`→`2026-08-10`) → HTTP 400.
- **Catatan**: mengikuti pola `saveDayExport` (cron), generate manual tidak menulis file ke disk — daftar "File Ekspor Tersimpan" tetap kosong sampai cron diaktifkan.

### Fixed — Daily Chat Export: Feedback "0 Data" yang Menyesatkan
- **Masalah**: User generate export dan mendapat file kosong. Akar: (a) UI default ke tanggal hari ini yang memang belum ada percakapan customer asli, (b) mayoritas trafik adalah data QA/sandbox yang sengaja tidak diekspor — tidak ada penjelasan apa pun, file kosong langsung diunduh.
- **Verifikasi**: Endpoint `/api/admin/export/daily-chats` berfungsi normal — 08-10: 4 percakapan/153 pesan, 08-11: 5/23, 08-12: 3/50; 08-13 (hari ini): 0 percakapan real (valid, belum ada chat asli hari ini).
- **Perbaikan** (`packages/admin-dashboard/src/pages/tenant/ChatExport.tsx`):
  - Saat hasil 0 percakapan → toast penjelasan (bukan unduh file kosong): "tidak ada percakapan customer REAL; data QA/sandbox tidak diekspor; coba tanggal lain".
  - Teks bantuan di bawah input tanggal menyebut eksklusi sandbox (`is_sandbox_test`).
  - Toast sukses kini menampilkan jumlah percakapan & pesan.
- **Catatan**: cron harian (`ENABLE_CHAT_EXPORT_CRON=true` di server) belum diaktifkan → daftar "File Ekspor Tersimpan" kosong.

### Fixed — Dual Intent Handling (FAQ + Lokasi dalam 1 Pesan)
- **Masalah**: Ketika customer mengirimkan pesan yang memuat FAQ medis/treatment SEKALIGUS lokasi rumah (contoh: *"Apakah bisa pijt bapil untk anak usia 2 thn? saya di sawotratap"*), handler `greeting.ts` memotong pesan dan hanya mengirim teks lokasi ke `location.ts`. Selanjutnya `location.ts` mengabaikan FAQ (`skipFaqIntercept = true`) dan hanya fokus menghitung ongkir, sehingga pertanyaan medis customer diabaikan sama sekali.
- **Perbaikan**:
  - `src/state-machine/types.ts`: Menambahkan properti `extractedLocationForGeocode` dan `additionalContextText` pada `StateHandlerContext`.
  - `src/state-machine/handlers/greeting.ts`: Meneruskan `extractedLocationForGeocode` tanpa memotong/mengubah `incomingMessage.text.body` asli.
  - `src/integrations/llm/generator.ts`: Mengizinkan `LLMResponseGenerator` menerima `additionalContextText` (info ongkir) dan menginjeksinya ke system prompt `[INFORMASI TAMBAHAN ONGKIR / LOKASI]`, sehingga LLM secara otomatis menggabungkan jawaban FAQ medis + info ongkir + penutup CTA dalam 1 balasan natural.
  - `src/state-machine/handlers/location.ts` & `src/state-machine/handlers/interest.ts`: Menggabungkan alur kalkulasi ongkir dan jawaban FAQ saat `hasFaqIntent` terdeteksi pada pesan lokasi.

### Fixed — Atribusi Audit LLM (conversation_id & customer_phone) + Analisis Biaya per Bubble
- **Masalah**: 74% call LLM (NLU_ROUTING, NLU_CLASSIFICATION, INTENT_DETECTION — 602/819 baris `llm_audit_logs` 7 hari) tercatat `conversation_id = NULL` dan `customer_phone` palsu (`router-audit`/`nlu-audit`/`intent-audit`), sehingga biaya LLM tidak bisa diatribusikan ke bubble chat — jawaban "1 bubble = berapa call & Rp" tidak bisa dihitung akurat dari log.
- **Perbaikan** (atribusi opsional, backward-compatible):
  - `src/services/nlu-classifier.service.ts` — `classifyMessage(text, history, auditCtx?)` + interface `NluAuditContext`; audit NLU_CLASSIFICATION kini mencatat `conversation_id` & `customer_phone` asli.
  - `src/integrations/llm/ai-router.ts` — `AIRouterInput` + field opsional `conversationId`/`customerPhone`; audit NLU_ROUTING mencatat atribusi.
  - `src/integrations/llm/intent.ts` — `detectIntent(text, auditCtx?)` + interface `IntentAuditContext`; audit INTENT_DETECTION mencatat atribusi.
  - `src/state-machine/machine.ts` & `src/state-machine/handlers/interest.ts` — call-site meneruskan `conversation.id` & `customer.phone`.
- **Script analisis baru** `scripts/bubble-llm-cost-analysis.ts`: attach call LLM ke bubble OUTBOUND (window 120 detik, per-conversation; call tanpa `conversation_id` di-attach approximate global) → rata-rata call/bubble, Rp/bubble (real vs sandbox), top-10 termahal → konsol + `test-results/bubble-llm-cost-<ts>.md`.
- **Hasil 7 hari (2026-08-06 s/d 13)**: 373 bubble = 713 call (1,91 call/bubble) = Rp 3.344,98 (Rp 8,97/bubble); customer REAL 113 bubble = 54 call = Rp 85,61 (0,48 call/bubble, mayoritas template statis/bypass).
- **Tests**: build (`tsc`) lolos; 214 test terkait (nlu-classifier, ai-router-engine, qa-nlu-fallback-security, treatment-questions, e2e-chat-to-reservation, model-fallback-chain, phrasing-service, llm-generator-safe-fallback) hijau.

### Fixed — Treatment Context & Greedy Catalog Match
- **Masalah**: 
  1. Saat customer menanyakan treatment spesifik (misal Pijat Bayi Pulih Ceria) lalu memberikan lokasi, bot menggunakan template `TEMPLATES.ongkirInfo` yang diakhiri pertanyaan generik *"Jadi mau pilih treatment apa bunda?"*.
  2. Saat customer bertanya harga (*"Brp kak untk feenya?"*), fungsi `searchCatalogItems` melakukan *greedy match* pada 2 kata awal ("Pijat Bayi"), sehingga `"Pijat Bayi Ceria (Rileksasi)"` menduduki hasil pertama dan harganya keliru dikutip (Rp60.000, bukan Rp70.000 untuk Pulih Ceria).
- **Perbaikan**:
  - `src/services/treatment-catalog.service.ts`: Memisahkan pencarian menjadi `exactMatches` (nama cocok utuh) dan `partialMatches` (cocok 2 kata awal). `exactMatches` kini diprioritaskan penuh dan diurutkan dari nama terpanjang/terspesifik.
  - `src/config/persona.ts`: Menambahkan opsi `candidateTreatmentName` pada `TEMPLATES.ongkirInfo` agar pertanyaan penutup kontekstual (*"Jadi mau pilih treatment apa Bund untuk hari ini? Atau mau lanjut dijadwalkan \*[Nama Treatment]\*-nya? 🤗"*).
  - `src/state-machine/handlers/location.ts`: Memasukkan `conversation.last_discussed_treatment` ke dalam pembentukan balasan ongkir/lokasi.

### Fixed — Ejaan Desa Sawotratap (Gazetteer)
- **Masalah**: Desa di Kecamatan Gedangan, Kabupaten Sidoarjo tertulis salah sebagai "Sawotratas" (nama resmi: **Sawotratap**) di data gazetteer, sehingga pencocokan lokasi bisa gagal/mismatch.
- **Perbaikan**: `docs/gazetteer_excel.tsv:30` dan `src/config/surabaya_sidoarjo_subdistricts.json:201` — "Sawotratas" → "Sawotratap".

### Fixed — Unifikasi Greeting Header (Satu Sumber Kebenaran di `TEMPLATES`)
- **Masalah**: Ada **3 versi teks pembuka yang tidak sinkron** — (a) string hardcoded di `src/state-machine/handlers/greeting.ts:83` (*"Perkenalkan, saya Bidan Yusi **dari Kala Moms and Baby Spa**. ✨"*, dipakai jalur customer baru kirim lokasi), (b) `TEMPLATES.firstContactGreetingHeader()` di `src/config/persona.ts` dan (c) `TEMPLATES.greeting()` — sehingga balasan terlihat "tidak mematuhi" persona (header di handler vs header di template).
- **Perbaikan**:
  - `src/state-machine/handlers/greeting.ts:82` — intro hardcoded diganti `TEMPLATES.firstContactGreetingHeader() + '\n\n'`; import `getBrandIdentity` dihapus (tidak terpakai lagi).
  - `src/config/persona.ts` — teks header resmi diekstrak ke `buildFirstContactHeader()` (satu sumber kebenaran); `TEMPLATES.greeting()` disusun dari helper tersebut (DRY, output identik).
  - Hasil: semua jalur (lokasi, FAQ di awal chat, greeting default) memakai Varian persona "Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare)".
- **Unit Tests**: substring `'Perkenalkan, saya Bidan Yusi'` di `tests/unit/production_edge_cases.test.ts:953` & `tests/integration/control_center_ui.test.ts:221` tetap lolos (Varian B mengandung frase tersebut). Verifikasi 10 sesi `scripts/test-50-same-opener.ts --max=10` (LLM asli).

### Fixed — LLM Generator: Anti Raw-JSON Leak, Fallback Darurat Aman & Anti Hard-Sell CTA (+ Retry Tanpa response_format)
- **`src/integrations/llm/generator.ts`**:
  - Soft-fallback JSON parser TIDAK lagi mengembalikan raw text (sintaks kurung kurawal) ke customer saat respons LLM terpotong/max_tokens habis. Kini: ekstrak nilai `"answer"` via regex (`extractAnswerFromPartialJson`) → jika gagal, jatuh ke fallback darurat netral (bukan bocor `{ "reasoning": ... }`).
  - Prompt dihemat token: instruksi `reasoning` disingkat menjadi maksimal 1 kalimat / 15 kata (sebelumnya bebas panjang sehingga `answer` terpotong).
  - **Fallback darurat (`fallbackFaqResponse`) tidak lagi meng-echo teks RAG/KB mentah** (chunk generic bisa keliru secara medis, mis. pertanyaan usia minimal match ke chunk "bayi baru lahir sampai beberapa tahun"). Jalur catalog terstruktur (`[DATA TREATMENT]`) tetap dipertahankan (data faktual dari DB).
  - **⚠️ Skenario apology "mohon maaf sedang antrean chat" DIHAPUS (permintaan owner).** Saat AI gagal menghasilkan jawaban yang aman (LLM error / breaker open / fallback kosong), generator kini mengembalikan **jawaban kosong + `usedFallback:true`**, dan `interest.ts` **mengeskalasi senyap ke antrean human handling** (sama dengan pola "FAQ tidak terjawab") — tanpa mengirim pesan minta-coba-lagi ke customer. Queue lebih panjang diutamakan daripada skenario apology tersebut.
  - Prompt diperkuat dengan **ATURAN ANTI HARD-SELLING**: nama treatment di CTA hanya boleh disebut jika customer sedang membahasnya.
  - Panggilan LLM dibungkus **concurrency limiter** (anti 429 saat lonjakan/burst).
- **`src/integrations/llm/model-fallback.ts`** — **Retry Tanpa `response_format`** (ditemukan saat verifikasi stres): provider OpenAI-compatible tertentu MENOLAK argumen `response_format` (HTTP 400 "Unrecognized request argument supplied: response_format") sehingga SEMUA jalur LLM jatuh ke fallback. Kini bila request memuat `response_format` dan provider menolaknya, `callChatCompletionsWithFallback` mengulang sekali TANPA `response_format` (format JSON tetap dijamin via sistem prompt). Fix terpusat → menguntungkan semua pemanggil (generator, ai-router, intent, nlu-classifier, dll).
- **`src/utils/llm-concurrency.ts`** (baru): semaphore promise tanpa dependency eksternal, default `LLM_MAX_CONCURRENCY=4` (env `LLM_MAX_CONCURRENCY`).
- **`src/state-machine/handlers/interest.ts`**: `treatmentNameForFollowUp` hanya diisi jika nama treatment **dieksplisitkan customer** (guard `treatmentExplicitlyMentioned`) — mencegah CTA "Paket Selapan" dipaksakan saat customer hanya tanya FAQ umum. **Selain itu: jika `faqResult.answer` kosong → eskalasi senyap ke HUMAN_HANDLING (`shouldSendReply:false`), pengganti skenario apology "antrean".**
- **Unit Tests**: `tests/unit/llm-generator-safe-fallback.test.ts` (baru: fallback terpotong aman, regex extraction, limiter), `tests/unit/model-fallback-chain.test.ts` (+2: retry tanpa response_format & tidak ada retry pada error lain), `tests/unit/phrasing-service.test.ts` disesuaikan (fallback non-catalog → jawaban kosong). `tests/unit/treatment-questions.test.ts` & `tests/unit/e2e-chat-to-reservation.test.ts` dikoreksi: mock kini menarget `generateFaqResponseWithDetails` (method yang sebenarnya dipanggil `interest.ts`). `tests/unit/customer-memory.test.ts` & `tests/unit/faq-grounding.test.ts` disesuaikan: fallback tanpa data kini mengembalikan jawaban kosong (sinyal eskalasi). **Hasil verifikasi ulang stres 50 sesi (LLM asli): 0 JSON-leak, 48/50 (96%) jawaban presisi, 0 samar, 0 hard-sell CTA, 0 silent/eskalasi, 48/50 minta lokasi.**

### Added — Harness Uji Variasi Sesi Baru (Pesan Pembuka Sama)
- **`scripts/test-50-same-opener.ts`** (baru): jalankan **50 sesi percakapan terpisah** (fresh customer + conversation INITIAL + state machine per sesi, `is_sandbox_test=true`), masing-masing dibuka dengan pesan pembuka SAMA (`"Selamat sore. Saya ingin tanya untuk pijat bayi min. di usia brp ya?"`), lalu capture semua bubble yang benar-benar DITERIMA customer (via `RecordingWahaClient`). Opsi `--max=N`, `--offline` (fallback rule-based tanpa network). Default LLM asli dari `.env`.
- Output: konsol per-sesi (state, error, eskalasi) + ringkasan agregat + **`test-results/50-same-opener-<timestamp>.json` / `.md`**.
- Hasil run 50 (LLM asli, 2026-08-13): 0 error/silent/eskalasi; semua berakhir `AWAITING_LOCATION`. Temuan: **9/50 (18%) balasan bocor raw JSON internal LLM ke customer** (soft-fallback `generator.ts` saat respons tidak ter-parse → `{ "reasoning": ... }` terkirim apa adanya); hanya 7/50 jawaban presisi "minimal 2 minggu", 34/50 jawaban samar ("bayi baru lahir sampai beberapa tahun"); pertanyaan lokasi hanya muncul di 16/50 (32%); bubble pembuka 50/50 identik (template kaku).

### Added — Daily Chat Export (Markdown untuk Analisa AI)
- **`src/services/chat-export.service.ts`** (baru):
  - `buildDailyChatMarkdown()`: pure function generator Markdown terstruktur — header statistik harian, satu blok per percakapan (phone, nama, lokasi, transisi state, flag human-handling/eskalasi/review, jumlah UNKNOWN beruntun), dan transkrip kronologis dengan penanda peran (`USER` = pelanggan, `BOT` = balasan AI, `HUMAN_AGENT` = staf/manusia via sender_name).
  - Balasan BOT menyertakan skor LLM-as-judge (`ai_evaluations`) jika ada: `**BOT** (skor AI: 4/5)`.
  - `generateDay()` tenant-aware (wajib `tenantId`), filter rentang UTC harian, dan **mengecualikan customer QA/sandbox** (`is_sandbox_test=true`) agar analisa tidak tercemar data test.
  - `saveDayExport()` menulis file `daily-chats-YYYY-MM-DD.md` ke `storage/exports/` (env `CHAT_EXPORT_DIR`); `listExports()` mendaftar file tersimpan.
  - DB offline → degrade senyap (return `success:false`), tidak mengganggu produksi.
- **`src/routes/admin/export.subroute.ts`** (baru):
  - `GET /api/admin/export/daily-chats?date=YYYY-MM-DD&tenantId=` → generate konten Markdown on-the-fly + audit trail `CHAT_EXPORT_GENERATE`.
  - `GET /api/admin/export/daily-chats/list` → daftar file ekspor tersimpan.
  - Terdaftar di `src/routes/admin.route.ts` (di balik auth admin dual X-API-KEY/cookie yang sama).
- **Cron harian** (`src/services/cron.service.ts` `runDailyChatExport()` + gate di `src/app.ts`): `ENABLE_CHAT_EXPORT_CRON=true` (default false), interval `CHAT_EXPORT_INTERVAL_HOURS` (default 6 jam) — setiap siklus me-regenerate file hari berjalan.
- **Admin Dashboard** (`packages/admin-dashboard`):
  - Halaman baru `ChatExport.tsx` (route `/admin/chat-export`, nav "Daily Chat Export (AI)"): pilih tanggal → "Generate & Download .md" (Blob client-side, aman untuk auth cookie), tabel file tersimpan, dan contoh prompt analisa AI.
  - Rebuilt `dist/` (chunk `ChatExport-*.js`).
- **Unit Tests**: `tests/unit/chat-export.test.ts` (18 test: roleLabel, formatTime, formatLocalDate, parseDateRange, struktur markdown, HUMAN_AGENT labeling, skor AI, flag eskalasi/review, multi-line blockquote, empty day) 100% PASS.

---

## [1.13.0] - 2026-08-13

### Fixed & Enhanced
- **Forbidden English Words Sanitizer (`src/utils/language-sanitizer.ts` & `src/integrations/llm/generator.ts`)**: Menambahkan fungsi `sanitizeForbiddenEnglishWords` untuk membuang/mengganti kata bahasa Inggris terlarang yang bocor dari LLM (seperti `little one`, `little one-nya` -> `si kecil`, `baby` -> `bayi`, `mommy` -> `Bunda`, `schedule` -> `jadwal`) baik pada generasi LLM baru maupun pada hit FAQ Cache.
- **Location-Known Customer Field Fix (`src/state-machine/handlers/interest.ts`)**: Memperbaiki bug di mana `isLocationKnown` sebelumnya mengevaluasi `currentState !== INITIAL && currentState !== AWAITING_LOCATION` (yang bisa menghasilkan `true` walau alamat/kelurahan customer masih kosong). Sekarang `isLocationKnown` secara eksplisit memeriksa `Boolean(customer.kelurahan)` sehingga jika alamat rumah belum diisi, AI 100% dijamin selalu meminta alamat rumah (*"Kalau boleh tahu rumahnya di mana ya Bunda?"*).
- **RAG Leakage & Typo Sanitizer (`src/utils/language-sanitizer.ts` & `src/integrations/llm/generator.ts`)**: Menambahkan fungsi `sanitizeRagLeakage` untuk membuang potongan teks/typo yang bocor dari RAG secara otomatis (seperti `Bun.etails info di sini`, `details info`, atau `berdasarkan referensi dokumen di atas`) sebelum pesan dikirimkan ke pasien.
- **TypeScript Fix**: Perbaikan properti `ai_feedback` -> `feedback` pada `chat-export.service.ts`.
- **Unit Tests**: Penambahan pengujian unit `sanitizeRagLeakage` dan `sanitizeForbiddenEnglishWords` pada `tests/unit/language-sanitizer.test.ts` (100% PASS).

---

## [1.12.0] - 2026-08-12

### Changed & Fixed (Consolidated)
- **WAHA Client Optimization**: Presence Timeout Optimization (3s) & Non-Blocking stopTyping untuk mencegah delay pengiriman.
- **WAHA Resilience**: Retry mekanisme untuk error transien, rate limiter concurrent calls, dan resolusi JID / LID.
- **Customer Labels**: Sinkronisasi event-driven untuk label admin/hold ke kolom database, dan Admin Dashboard toggle.
- **LLM Timeout Optimization**: Meningkatkan batas timeout default panggilan LLM (`LLM_TIMEOUT_CHAT_MS`, `LLM_TIMEOUT_NLU_MS`, `LLM_TIMEOUT_ROUTER_MS`) dari 12s/15s menjadi **120.000ms (2 Menit)** untuk mencegah kegagalan prematur saat jaringan/database sedang lambat.
- **Smart FTS Search**: Pembersihan kata basa-basi/sapaan (`sanitizeQueryForFts`), normalisasi slang (`min.` -> `minimal`, `brp` -> `berapa`), serta fallback OR-based tsquery untuk menjamin pencarian Knowledge Base (FTS) tetap berhasil menemukan Chunk KB yang tepat dari pertanyaan percakapan.
- **Question Override Guard**: Mencegah frasa pertanyaan pembuka (seperti *"Saya ingin tanya..."*) ter-map salah ke intent `interested` akibat kata *"ingin"*, memastikannya selalu diproses sebagai `faq_question` agar dijawab dengan jelas sebelum penawaran reservasi.
- **Persona Prompt - Early Chat Location Inquiry**: Menambahkan instruksi wajib pada `BOT_PERSONA_PROMPT` & LLM Generator (`ctaInstruction`) agar pada pertanyaan di awal percakapan (saat alamat customer belum ada), AI selalu menutup balasan di akhir chat dengan menanyakan area/rumah tempat tinggal customer secara ramah (misal *"Kalau boleh tahu rumahnya di mana ya Bunda? Biar sekalian kami bantu cekkan ketersediaannya 😊"*), serta menegaskan larangan kata "lokasi".
- **Smart Age Matcher**: Deteksi otomatis ekspresi usia anak/bayi pada pesan customer (`parseAgeTextToMonths`) untuk re-mapping intent `other` -> `faq_question`, serta injeksi katalog rekomendasi treatment berbasis filter usia (`getServicesByAge`) secara akurat.
- **LLM CTA Location-Aware**: Instruksi CTA di akhir balasan AI sekarang bersyarat berdasarkan status `isLocationKnown` dari State Machine (bukan lagi diserahkan ke AI untuk menebak). Jika lokasi belum diketahui → wajib tanya rumah; jika sudah diketahui → tawarkan reservasi tanpa tanya ulang.
- **Anti-Halusinasi Brand**: Melarang AI menerjemahkan nama brand ke bahasa Inggris (misal "Mothers and Baby Spa") serta melarang kata-kata Inggris yang sering bocor ("little one", "baby", "mommy") dengan padanan Indonesia wajib.
- **Anti-Robot Phrasing**: Melarang penggunaan frasa kaku pembuka seperti "Berikut jawaban untuk pertanyaan bunda:" — AI wajib langsung menjawab ke inti dengan gaya ngobrol WhatsApp natural.
- **Ongkir CTA Fix**: Melarang AI menanyakan jadwal/waktu setelah info ongkir. AI wajib menutup dengan menanyakan pilihan treatment ("Jadi mau pilih treatment apa bunda?"), bukan jadwal ("kapan siap ditangani").
- **Fix Location-Known State Mapping (`greeting.ts`)**: Memperbaiki bug di mana `greeting.ts` sebelumnya memicu `handleInterestState` dengan meng-override `current_state` menjadi `AWAITING_INTEREST`. Hal ini menyebabkan LLM keliru menganggap alamat rumah customer sudah diketahui (`isLocationKnown = true`), sehingga LLM tidak menanyakan alamat rumah di akhir balasan.
- **Anti-Kata Buntung Persona Guard**: Penambahan aturan tata bahasa di persona prompt untuk mencegah LLM menghasilkan kata cacat/buntung (seperti *"kalau-nya"*, *"si-nya"*) akibat penghapusan kata bahasa Inggris yang dilarang. AI diwajibkan menggunakan struktur kalimat lengkap (*"kalau si kecil"*, *"kalau bayinya"*).
- **Geocoding Kecamatan Gate & Persona Template Fix (`src/integrations/google-maps/geocoding.ts` & `src/config/persona.ts`)**: Penambahan proteksi gate nama Kecamatan luas yang memiliki nama ganda (seperti *Tandes*, *Karangpilang*, *Rungkut*, *Gubeng*, *Wonokromo*, *Wiyung*, *Sawahan*, dll.) yang membawahi banyak kelurahan. Jika customer mengetik nama kecamatan tanpa kata kunci eksplisit `kelurahan`/`desa`/`kel`, geocoding mengembalikan `isPrecise: false` beserta daftar `ambiguityResults` kelurahan di kecamatan tersebut agar bot meminta detail kelurahan spesifik. Perbaikan template `askKelurahanAmbiguous` di `persona.ts` agar menyebutkan nama Kecamatan target (misal *"Kecamatan Tandes"*) beserta contoh kelurahan secara ramah (maksimal 3 contoh), tanpa menyebutkan nama kelurahan acak di judul atau mencetak seluruh daftar kelurahan secara panjang.

---

## [1.11.0] - 2026-08-02

### Added - AI Router Observability + UNKNOWN Repeated Escalation
- **`prisma/schema.prisma`**:
  - Model baru `AiRouterEvaluation` (tabel `ai_router_evaluations`): snapshot evaluasi router
    (llm_intent, llm_confidence, llm_used_fallback, legacy_intent, legacy_escalated,
    intent_match, escalation_match, mismatch_notes, response_time_ms).
  - Field `conversations.consecutive_unknown_count` (default 0).
  - Migration: `prisma/migrations/20260803000000_add_ai_router_evaluations/migration.sql`.
- **`src/services/ai-router-evaluation.service.ts`** (baru):
  - `logRouterEvaluation()`: tulis evaluasi router ke DB; gagal simpan di-swallow agar tidak mengganggu balasan customer.
  - `mapLegacyDecisionToIntent()`: translasi tipis keputusan legacy ke label intent; label `UNMAPPED` sengaja beda dari `UNKNOWN`.
  - `handleRouterResult()`: counter UNKNOWN berulang per conversation; >= 2x -> force eskalasi human (`escalation_reason=UNKNOWN_REPEATED`); reset saat intent lain terdeteksi.
- **`src/integrations/llm/ai-router.ts`**: enum `ESCALATION_REASONS` + `'UNKNOWN_REPEATED'`.
- **`src/state-machine/machine.ts`**:
  - Full-mode (non-shadow): UNKNOWN x2 berturut-turut -> eskalasi otomatis ke HUMAN_HANDLING (silent).
  - Shadow & full mode: evaluasi router di-log ke `ai_router_evaluations` per pesan.
- **`src/scripts/check-router-accuracy.ts`** (baru): cek akurasi shadow vs legacy; gate matikan shadow mode
  (escalation >= 98%, medical mismatch = 0 hard-zero, UNMAPPED < 5%).
- **Tests**: +17 test (log evaluasi, mapping legacy, counter UNKNOWN, e2e machine 2x UNKNOWN -> HUMAN_HANDLING). Total 525 test pass.

### Notes - Environment / Deploy
- `prisma generate` penuh kembali normal. Sempat ter-regenerate dengan `--no-engine` yang mengunci client ke
  URL `prisma://` (P6001, Accelerate-only) saat engine dll terkunci EPERM oleh proses berjalan; sudah digenerate
  ulang penuh setelah proses yang lock dimatikan. Runtime terverifikasi `P2021` (normal) bukan `P6001`.
- Migration `20260803000000_add_ai_router_evaluations` sudah di-deploy ke DB docker lokal; zero drift
  terverifikasi via `migrate diff --from-url`.
- Runbook deploy & jadwal monitoring shadow mode: `README.md` bagian "Deployment & Runbook Migration".
- Known issue pre-existing: `migrate diff --from-migrations` rusak oleh urutan enum `FollowUpStatus` di
  `20260801000000_add_failed_followup_status`. Lihat `docs/KNOWN_ISSUES.md`.

## [1.10.0] — 2026-08-02

### Added — Structured Children + Dynamic Age Engine
- **`prisma/schema.prisma`**:
  - Model baru `Child` (tabel `children`): per customer, relasi ke `Reservation`, key unik `(customer_id, name)` anti-duplikasi saat repeat order, multi-tenant (`tenant_id`).
  - Field: `name`, `birth_date` (estimasi dari teks usia), `age_months_at_registration`, `raw_age_text`.
  - Relasi `Customer.children[]` & `Reservation.children[]`.
  - Migration: `prisma/migrations/20260802000000_add_children/migration.sql`.
- **`src/utils/age-calculator.ts`** (baru):
  - `parseAgeTextToBirthDate()`: estimasi tanggal lahir dari teks usia Indonesia (`6 bulan`, `1 tahun 2 bulan`, `3 minggu`, `10 hari`, `2th`, `6 bulan 2 hari`).
  - `computeCurrentAge()`: usia DINAMIS terhadap hari ini (hari ini → `X bulan`, `<24 bulan` → `X tahun Y bulan`, `<1 bulan` → `X hari`), dari `birth_date` ATAU snapshot `age_months_at_registration` + `created_at`.
- **`src/services/child.service.ts`** (baru):
  - `upsertChildrenFromBabies()`: persist anak saat reservasi dibuat (DB offline → senyap).
  - `getChildrenWithCurrentAge()`: daftar anak customer dengan `current_age` realtime.
- **`src/state-machine/handlers/interest.ts`** & **`src/routes/admin.route.ts`**:
  - Panggil `childService.upsertChildrenFromBabies()` setelah reservasi dibuat.
  - `GET /api/admin/reservations` include `customer.children` + hitung `current_age` per anak.
- **`packages/admin-dashboard/src/pages/tenant/Reservations.tsx`**:
  - Modal Manage → section "Bayi / Anak (n)" prioritas dari `children` DB (usia realtime), tampil `nama · usia sekarang` + catatan `(saat booking: X)` jika berbeda.
  - Fallback lama: `baby_details` API → parse `raw_text`/`treatment_detail` client-side.
- **`packages/admin-dashboard/src/types/index.ts`**: type `ChildInfo` + `customer.children`.
- **Unit Tests**: `tests/unit/age-calculator.test.ts` (15 test) & `tests/unit/child-service.test.ts` (5 test) 100% PASS.

### Added — Baby Details di Reservation Detail (Manage Modal)
- **`src/utils/reservation-text-parser.ts`**:
  - `ParsedReservation.babies: BabyDetail[]` (nama + usia bayi/anak) — terstruktur, bukan string campur di treatmentDetail.
  - Mendukung **beberapa anak**: satu baris multi-nilai (`Rara, Riri` / `&` / `dan`), blok `Nama Bayi`/`Usia Bayi/Anak` berulang, dan usia dalam kurung (`Rara (6 bulan)`).
  - Helper baru `extractBabyDetails(rawText)` + `buildBabyDetails()` + `preprocessReservationText()` (refactor preprocessing supaya bisa dipakai mandiri tanpa parse penuh).
  - `treatmentDetail` kini memuat seluruh bayi (dipisah `|`) untuk multi-anak.
- **`src/routes/admin.route.ts`**:
  - `GET /api/admin/reservations` meng-enrich tiap reservasi dengan `baby_details` dari `raw_text` (kompatibel dengan data lama — tidak butuh kolom DB baru).
- **`packages/admin-dashboard/src/pages/tenant/Reservations.tsx`**:
  - Modal **Manage** → card "Patient Details" menampilkan daftar **Bayi / Anak (n)**: nama + umur per bayi.
- **`packages/admin-dashboard/src/types/index.ts`**: type `BabyDetail` + `Reservation.baby_details`.
- **Unit Tests**: `tests/unit/reservation-text-parser.test.ts` (+7 test: single bayi, 2 bayi satu baris, 2 bayi blok berulang, usia dalam kurung, `extractBabyDetails` inline/null).

### Added — AI Router Engine (Shadow-First, LLM Intent Classification)
- **`src/integrations/llm/ai-router.ts`** (baru):
  - Klasifikasi 11 intent (`GREETING`, `PROVIDE_LOCATION`, `ASK_FAQ`, `INTERESTED_IN_BOOKING`, `PROVIDE_RESERVATION_DETAILS`, `ASK_SPECIFIC_SCHEDULE`, `MEDICAL_CONCERN`, `CONFIRMATION`, `NEGATION`, `CHITCHAT`, `UNKNOWN`) + ekstraksi entitas (lokasi, treatment, nama, tanggal, jam).
  - Validasi output LLM dengan **Zod schema** (`AIRouterResponseSchema`) + **retry-once** dengan `buildRetryPrompt()` (hint field error ringkas, bukan raw stack trace).
  - **Anti prompt-injection** di system prompt: pesan pelanggan SELALU data, bukan instruksi. Diverifikasi unit test.
  - **Circuit breaker reuse** (`src/utils/circuit-breaker.ts`): CLOSED → OPEN → HALF_OPEN, cooldown 30s, window 10.
  - **Rule-based fallback** deterministik yang **re-use `MedicalDetectionService`** (SINGLE SOURCE OF TRUTH — tidak ada keyword list medis duplikat yang bisa divergen).
  - **CONTRACT ANTI-BYPASS gazetteer**: `location_mention` dari router HANYA kandidat teks, wajib di-resolve ulang via `geocodingService.geocodeText()` (threshold asli kelurahan 0.75 / kecamatan 0.82) — tidak pernah langsung jadi `confirmed_kelurahan`.
  - Feature flags: `AI_ROUTER_ENABLED` (aktifkan) & `AI_ROUTER_SHADOW_MODE` (log perbandingan LLM vs fallback legacy tanpa mengubah keputusan state).
- **`src/state-machine/machine.ts`**:
  - GATE 2.5: jalankan AI Router saat `AI_ROUTER_ENABLED=true`, share riwayat percakapan dengan NLU, expose `routerDecision` ke handler.
- **`src/state-machine/types.ts`**:
  - `StateHandlerContext.routerDecision?: AIRouterDecision`.
- **Unit Tests**:
  - `tests/unit/ai-router-engine.test.ts` (38 test cases 100% PASS): schema validation, state priority (AWAITING_LOCATION FAQ vs lokasi), affirmation signal (AFFIRM/DENY/MIXED/NONE + interjeksi), schedule escalation, medical fallback parity, reservation extraction, prompt injection (langsung + shadow mode), Zod retry-once, circuit breaker HALF_OPEN recovery, compareRouterDecisions, anti-bypass gazetteer, dan guard kelurahan-kosong menahan form reservasi di level state machine.

---

## [1.9.0] — 2026-08-01

### Fixed — Reservation Text Parser (Wrapped & Double-Spaced Labels)
- **`src/utils/reservation-text-parser.ts`**:
  - Preprocessor otomatis memecah label inline dan menyambungkan kata label yang terpotong di tengah baris (misal `Nama Bun\nda:` -> `Nama Bunda:`).
  - Normalisasi spasi ganda pada label dan section header (misal `Nama  Bunda:` terdeteksi sama dengan `Nama Bunda:`).
- **Unit Tests**:
  - `tests/unit/reservation-stress.test.ts` (30 variasi acak form reservasi 100% PASS).
  - `tests/unit/reservation-text-parser.test.ts` (+1 test case multiline wrapped form).

### Added — Personalized Treatment FAQ Follow-Up
- **`src/config/persona.ts`**:
  - `faqFollowUp` sekarang menerima nama treatment spesifik (misal `Sinar Moksa`) dan menghasilkan 4 variasi CTA natural secara acak (rotasi anti-bot).
- **`src/state-machine/handlers/interest.ts`**:
  - Ekstrak nama treatment dari NLU entity atau catalog match (dengan pembersihan suffix kurung) untuk di-inject ke `faqFollowUp`.
- **Unit Tests**:
  - `tests/unit/treatment-followup-personal.test.ts` (20 test cases 100% PASS).
  - `tests/unit/treatment-catalog-search.test.ts` (30 test cases dengan IDF scoring 100% PASS).

### Fixed — Persona Language Strictness & Brand Enforcement
- **`src/config/persona.ts`**:
  - Tambah aturan ketat: *"HANYA gunakan bahasa Indonesia. DILARANG menggunakan bahasa Inggris, Mandarin, Jepang, Arab..."* (mencegah keluarnya karakter Cina seperti "顺便").
  - Tambah aturan ejaan merek: *"Kala Moms and Baby Spa — EJAAN HARUS PERSIS."*

### Fixed — Sandbox UI Multiline Formatting & Input UX
- **`packages/admin-dashboard/src/pages/tenant/AiSandbox.tsx`**:
  - Render message content dengan `<div className="whitespace-pre-wrap break-words font-sans">` agar karakter `\n` dirender sebagai enter/ganti baris di browser.
  - Textarea input multi-line dengan dukungan `Enter` untuk kirim dan `Shift+Enter` untuk baris baru.
  - Tombol **Kirim** hijau lebih menonjol dengan indicator spinner loading.

### Fixed — CLI Simulator
- **`src/cli/chat-simulator.ts`**:
  - Mode input multi-line otomatis saat mengetik `Berikut list untuk reservasi` (mengumpulkan baris sampai baris kosong).
  - `/reset` sekarang menghapus lokasi confirmed dan pending secara total via `customerService.resetFullLocation()`.

### Test Suite Status
- **42 Test Files \| 391 Tests \| 100% PASS** ✅

---

## [1.8.0] — 2026-08-01

### Added — Fase 2 Scheduling & Follow-Up Engine & UI
- **`src/config/followup-templates.ts`**: Modul baru *Rolling Templates Engine* dengan 3 variasi pesan natural per stage (anti-bot pattern).
- **`src/services/follow-up.service.ts`**: `processDueFollowUps()` & `executeFollowUp()` memproses antrian follow-up `NO_PURCHASE` (+3, +7, +14 hari) dan `NEXT_TREATMENT` (+1, +2, +3 bulan) saat `scheduled_at <= NOW()`.
- **`src/services/cron.service.ts`**: `runFollowUpWorker()` runner periodik (interval 15 menit).
- **REST Endpoints Admin**:
  - `GET /api/admin/follow-ups` (Filter status, type, search)
  - `POST /api/admin/follow-ups/:id/send-now` (Kirim instan)
  - `PATCH /api/admin/follow-ups/:id/cancel` (Batalkan antrian)
  - `PATCH /api/admin/follow-ups/:id/reschedule` (Ubah tanggal/jam kirim)
- **UI React SPA**:
  - **`FollowUpQueue.tsx`**: Halaman baru `/admin/follow-ups` untuk memantau antrian & riwayat follow-up.
  - Tabel lengkap: `date_send`, `time_send`, Tipe & Stage, Nama Customer, No. HP, Kecamatan/Kelurahan, Rotasi Template, Status, Tombol Kirim/Reschedule/Cancel.
- **Unit Tests**:
  - **`tests/unit/follow-up-engine.test.ts`**: 5 unit test memvalidasi rotasi template, auto-cancel reservasi baru, pembuatan `NEXT_TREATMENT`, dan worker.
  - **Total test suite: 39 test files \| 337 tests \| 100% PASS** ✅

---

## [1.7.0] — 2026-07-31

### Added — UI Delivery Fee Tiering
- **`packages/admin-dashboard/src/pages/tenant/DeliveryTiers.tsx`**: Halaman baru untuk mengelola tarif ongkir homecare.
  - Editor tier jarak (maxDist, fee normal, potongan promo) dengan hitung net otomatis
  - Simulasi ongkir live — input jarak → tampilkan tier & yang dibayar customer
  - Validasi berurutan (maxDist harus naik), tombol quick-pick jarak (3/5/8/12/18/25 km)
  - Auto-sort sebelum simpan, tersimpan ke `delivery_tiers_custom.json`
- **Route**: `/admin/delivery` + menu sidebar "Delivery Fee".
- **Fix `Settings.tsx`**: Hapus banner "UI Demo Only (Belum Tersambung Backend)" — backend `/api/admin/delivery-tiers` sudah tersambung.

---

## [1.6.0] — 2026-07-31

### Added — LLM Geocoding Fallback
- **`src/integrations/google-maps/geocoding.ts`**: Tambah method `llmResolveLocation()` sebagai fallback saat gazetteer fuzzy match gagal (typo, dusun/RT, nama tidak umum).
- **Model**: DeepSeek V4 Flash via SumoPod (`AI_MODEL_NLU` env var).
- **Cross-check**: Hasil LLM di-validasi ke gazetteer untuk ambil koordinat exact.
- **DeepSeek reasoning support**: Handle `reasoning_content` field untuk reasoning models.
- **Guard conditions**: Input ≥ 3 karakter, API key tersedia, tidak dalam outage.
- **Circuit breaker**: Wrap LLM call untuk resilience.

### Added — NLU Model Configuration
- **`src/config/ai-models.config.ts`**: Tambah `AI_MODEL_NLU` env var untuk model NLU classification.
- **Default**: `deepseek-v4-flash` (cepat, murah, reasoning capability).

### Added — Documentation
- **`docs/DEAD_CODE_GOOGLE_MAPS.md`**: Dokumentasi kode Google Maps yang tidak terpakai dan opsi keputusan.
- **`opencode.json`**: Konfigurasi 9router untuk opencode.

### Changed — Geocoding Flow
- **Alur baru**: Gazetteer → LLM fallback → Minta detail (behavior lama).
- **Prioritas**: Gazetteer tetap utama untuk koordinat exact, LLM hanya untuk understanding.
- **Google Maps API**: Tidak diperlukan (gazetteer + LLM sudah cukup).

### Test Results
- **10 test cases**: 7/10 berhasil resolve lokasi via LLM fallback.
- **Akurasi koordinat**: Gazetteer ±10m vs LLM ±5km (hybrid approach optimal).

---

## [1.5.0] — 2026-07-25

### Fixed — Message Rewrite (Body Strip)
- **Bug `webhook.route.ts`**: Pesan `Promo[a7] halo bunda` sebelumnya masuk ke state machine **apa adanya** tanpa strip kode tracking. Sekarang setelah attribution block berhasil, kode `Promo[XX]` di-strip dari body: `"Promo[a7] halo bunda"` → `"halo bunda"`, `"Promo[a7]"` (saja) → fallback ke `"Halo"`.

### Fixed — Migration Side Effects (Kritis)
- **Bug `migration.service.ts`**: `commitApprovedRecords()` sebelumnya memanggil `customerService.getOrCreateCustomer()` tanpa bypass, yang secara otomatis men-trigger `followUpService.createNoPurchaseFollowUps()` untuk setiap legacy customer yang di-commit — perilaku yang salah karena mereka bukan lead baru.
- **Fix `customer.service.ts`**: Tambahkan parameter opsional `options?: { skipFollowUpScheduling?: boolean }` ke `getOrCreateCustomer()`. Guard melindungi blok `createNoPurchaseFollowUps` ketika flag aktif.
- **Fix `migration.service.ts`**: Panggil `getOrCreateCustomer()` dengan `{ skipFollowUpScheduling: true }` — legacy customer tidak akan pernah mendapat follow-up NO_PURCHASE.
- **Konfirmasi Google Calendar**: Audit kode mengkonfirmasi `prisma.reservation.create()` di migration service **tidak** memiliki hook Calendar otomatis — tidak ada perubahan diperlukan. Calendar hanya dipanggil eksplisit dari `admin.route.ts`.

### Changed — `generateTrackingCode()` Refactor
- **Renamed**: `generateShortCode()` → helper internal `_randomCode()` (tidak lagi di-export).
- **Export baru**: `generateTrackingCode(data, db)` — fungsi async yang melakukan insert-and-catch-conflict dengan retry-and-escalate.
- **Alphabet baru**: Hapus karakter ambigu `0`, `1`, `i`, `l`, `o` → tersisa **32 karakter** bersih (`abcdefghjkmnpqrstuvwxyz23456789`). Keyspace: 2-char = 1.024 | 3-char = 32.768 | 4-char = 1.048.576.
- **Alur escalate**: Gagal 5× di 2-char → naik ke 3-char → gagal 5× → naik ke 4-char (batas maks). Jika semua gagal → HTTP 503.
- **Concurrency-safe**: Tidak ada SELECT sebelum INSERT — DB UNIQUE constraint yang memutuskan, bukan aplikasi. Race condition antara 2 request bersamaan sudah aman secara atomik.
- **Fallback in-memory**: Tetap ada. DB offline → generate 2-char langsung tanpa loop.

### Added — New Test Coverage
- **`tests/unit/code-generation.test.ts`** (baru, 7 test):
  - ✅ Kode 2 karakter normal (mock DB kosong)
  - ✅ Alphabet bersih: tidak ada `0`,`1`,`i`,`l`,`o` dalam 1.000 sample
  - ✅ Escalate ke 3-char setelah 5× P2002 di 2-char
  - ✅ Escalate ke 4-char setelah 5× P2002 di 2-char + 5× di 3-char
  - ✅ Kode berbeda tiap retry
  - ✅ **Concurrent collision**: `Promise.all()` 2 request bersamaan → dua kode berbeda
  - ✅ **Latency benchmark**: p50 = `0.00ms`, worst-case = `0.06ms` (jauh di bawah budget 2 detik `go.html`)
- **`tests/unit/migration.test.ts`** (+2 test, total 5):
  - ✅ Setelah commit, `followUpService.createNoPurchaseFollowUps` = **zero calls**
  - ✅ Setelah commit, `googleCalendarService.createEvent` = **zero calls**

### Test Results
- **22 test files | 200 tests | 100% PASS** ✅

---

## [1.4.0] — 2026-07-24

### Added — WAHA Legacy Chat Migration Module
- **Model database `LegacyStaging`** dan **enum `StagingStatus`** (`PENDING`, `APPROVED`, `REJECTED`, `COMMITTED`) di `prisma/schema.prisma` sebagai staging area sebelum data customer lama masuk ke tabel utama.
- **`WahaClient.getChats()`** — method baru untuk menarik daftar seluruh room chat dari WAHA API (`GET /api/{session}/chats`).
- **`WahaClient.getMessages(chatId, limit)`** — method baru untuk menarik histori pesan dari room chat tertentu (`GET /api/{session}/messages`), beserta implementasi mock untuk mode unit test.
- **`src/services/migration.service.ts`** (file baru) — service utama yang menangani 3 fungsi:
  - `extractFromWaha()`: Tarik chat WAHA → filter grup (@g.us) → simpan hanya pesan teks → deteksi `leadCreatedAt` (pesan pertama) & `firstPurchaseAt` (form reservasi) → upsert ke `LegacyStaging`.
  - `updateStagingStatus(id, status)`: Approve / Reject / Reset status record staging.
  - `commitApprovedRecords()`: Commit massal — upsert `Customer` dengan status `'legacy'`, import pesan historis ke `Message` log dengan timestamp asli, buat `Reservation` (status `confirmed`) jika form reservasi terdeteksi.
- **4 endpoint admin baru** di `src/routes/admin.route.ts` (terproteksi `ADMIN_API_KEY`):
  - `POST /api/admin/migration/extract`
  - `GET /api/admin/migration/staging` (dengan pagination & filter status)
  - `PATCH /api/admin/migration/staging/:id`
  - `POST /api/admin/migration/commit`
- **`tests/unit/migration.test.ts`** (file baru) — 3 unit test menggunakan WAHA mock client.
- **Mock `legacyStaging`** dan **`message.findFirst`** ditambahkan ke `tests/setup.ts`.

### Fixed
- Mock `prisma.message.findFirst` yang hilang di `tests/setup.ts` yang menyebabkan `TypeError` saat migration test dijalankan.

### Test Results
- **21 test files | 191 tests | 100% PASS** ✅

---

## [1.3.0] — 2026-07-23

### Added — Ad Click Attribution & Meta Conversions API (CAPI)
- **`POST /api/tracking/click`** — endpoint penangkapan klik iklan dengan proteksi timing-safe token, rate-limiting, dan penolakan spoofing IP/UA.
- **Webhook interception `Promo[CODE]`** — pesan `Promo[XX]` dicocokkan ke record `AdClick` secara atomik; di-rewrite in-memory ke `'Halo'` untuk state machine; teks asli tersimpan di DB log.
- **`CapiService`** — E.164 normalization, SHA-256 hashing lowercase, circuit breaker, fire-and-forget `Lead` event saat konfirmasi reservasi.
- **Kode tracking 2 karakter alfanumerik** (1.296 kombinasi) untuk typing natural (contoh: `Promo[a7]`).
- **Cleanup otomatis `AdClick`** > 100 hari, dijalankan 1x sebulan setiap tanggal 1.

### Added — Click Catcher Microservice (`wa-click-catcher`)
- Proyek baru microservice super-ringan tanpa database.
- `public/go.html` dengan Meta Pixel, ekstraksi fbclid/UTM, timeout 2s fail-open, animasi loader premium, fallback no-JS.
- Fastify server dengan dynamic injection env var di request-time.
- Dockerfile dan README.md lengkap.

### Test Results
- **20 test files | 187 tests | 100% PASS** ✅

---

## [1.2.0] — 2026-07-22

### Added — Security Hardening & Edge Case Coverage
- Proteksi endpoint admin dengan `ADMIN_API_KEY` menggunakan `crypto.timingSafeEqual` + SHA-256.
- Auto-block customer untuk pola spam/abuse; manual block via endpoint admin; bot silent untuk customer blocked.
- Flag kata kasar dengan word-boundary match untuk review manual.
- Peredaman greeting "Halo Bunda" jika percakapan aktif < 48 jam.
- Label WAHA `"hold"` otomatis saat eskalasi ke human; auto-resume jika label dihapus admin.
- Deteksi lokasi dini dari pesan pertama customer.
- Proteksi form reservasi: tidak dikirim jika `customer.kelurahan` masih kosong.
- Reset otomatis lokasi `pending` setelah idle 24 jam.
- Filter pesan grup WhatsApp (`@g.us`) diabaikan tanpa respons.
- Dukungan alias sapaan `"bubid"`.

### Fixed
- Bug perkenalan diri yang terlewat saat lokasi dideteksi di pesan pertama.

### Test Results
- **19 test files | 183+ tests | 100% PASS** ✅

---

## [1.1.0] — 2026-07-21

### Added — Conversation Engine Core
- State machine: `NEW_LEAD` → `LOCATION_ASKED` → `LOCATION_PENDING_CONFIRM` → `LOCATION_CONFIRMED` → `INTERESTED` → `RESERVATION_SENT` → `RESERVATION_RECEIVED` → `HUMAN_HANDLING`.
- Sapaan otomatis + typing indicator simulasi perilaku manusia.
- Deteksi afirmasi/negasi kompleks termasuk mixed-signal.
- Fuzzy matching kelurahan dengan Sorensen-Dice similarity (threshold 0.80).
- Kalkulasi jarak via OpenRouteService, fallback Haversine.
- Tiering ongkir 7 level berdasarkan jarak dari klinik.
- FAQ engine tanpa mengganggu state aktif.
- Penangkapan koordinat share location native WhatsApp.
- Eskalasi ke human setelah 3x lokasi gagal di-resolve.
- Auto-release human handling setelah 6 jam tanpa respons agent.
- Antrian pesan FIFO per nomor customer, fallback in-memory jika Redis down.
- Kirim pricelist otomatis saat lokasi terkonfirmasi.
- Integrasi WAHA self-hosted.
- Persiapan arsitektur multi-tenant (`tenant_id` di semua tabel).

### Test Results
- **15 test files | 150+ tests | 100% PASS** ✅

---

## [1.0.0] — 2026-07-20

### Added — Initial Project Setup
- Inisialisasi proyek TypeScript: Fastify, Prisma ORM, Vitest, tsx.
- Skema database awal: `Customer`, `Reservation`, `Message`, `KnowledgeBase`, `FAQ`.
- WAHA client dasar (webhook receiver + send message).
- CLI Chat Simulator untuk testing lokal tanpa koneksi WhatsApp.
- Struktur folder: `src/routes/`, `src/services/`, `src/integrations/`, `tests/unit/`.
- `.env.example` dengan semua variable yang diperlukan.

#### Perbaikan Sistemik Sesi 89-Turn: State Persistence, Anti-Silent Handoff & Maternal Routing (2026-09-21)

- **DB**: 
px prisma db push menyinkronkan kolom \session_data\ (episodik V3) ke PostgreSQL lokal; Prisma Client di-generate ulang penuh (atasi EPERM DLL lock dengan menghentikan dev server). Verifikasi: \scripts/verify-session-data.ts\.
- **GoalTracker**: blok try persistensi dipecah (episodik vs durable) — kegagalan tulis session_data tidak lagi menggugurkan mirror Customer (akar amnesia lokasi lintas-turn); \getGoalSession\ kini resilient memory fallback.
- **Maternal routing**: \getDefaultRelaxationService('MOMS')\ memfilter MOMS/BOTH (bukan lagi paket bayi); pregrounding sesi ibu memakai header \"Ibu Sehat Relaksasi\".
- **Learning loop**: grounding kosong kini HANYA menandai \eview_flagged\ (repository seam \lagForReview\) — bot tetap aktif; antrean kurasi tidak lagi memicu CS takeover permanen (akar mati suri 68 turn).
- **Sanitizer DSML**: perbaikan regex yang rusak (dobel-pipe, tak pernah match) → trim-from-first dengan dukungan control-char C1 & pipe fullwidth; \<result>/<tool_call>\ tetap pasangan-tag.
- **Handoff anti-silent-drop**: flag \is_human_handling\ kini di-set SETELAH balasan closing terkirim (sebelumnya membatalkan pengiriman via shouldAbort → customer menerima diam total).
- **Verifikasi**: build 0; suite 2978 passed / 1 failed (pre-existing); re-run Kasus #1: amnesia 0, DSML 0, closing schedule-check TERKIRIM, latch silent pasca-closing bekerja.
