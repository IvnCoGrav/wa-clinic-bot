# Known Issues & Tech Debt

Catatan temuan yang sengaja dipisah dari fitur aktif, supaya tidak hilang dan
tidak disalahartikan sebagai bug dari perubahan terbaru.

---

## 133. [Build Blocker + 3 Regresi Pasca `f5c70ade` — Deploy `origin/master` Sempat Mustahil] DONE (2026-09-26)

- **Temuan saat update live server:** server live berada di `7c94b58` (29 commit di belakang `origin/master`); `docker compose build app` GAGAL di `npm run build`.
- **Root cause (multi-layer, diverifikasi baca kode + log, bukan menelan klaim commit):**
  1. **BLOCKER parse:** `src/services/follow-up.service.ts` — `f5c70ade` menghapus `try {` level-metode di `createNoPurchaseFollowUps` namun meninggalkan `} catch (err) {` yatim (baris 402) → selisih kurung −1 → 557 error TS kaskade (seluruh file). Klaim commit "build ✅" tidak akurat.
  2. **Regresi geocoding:** `crossCheckGazetteer` (guard `isDualAdmin` + city-mismatch) ikut diterapkan ke lookup otoritatif kamus landmark → apartemen mapan (`Grand Sungkono Lagoon`/Dukuh Pakis, `Mulyorejo`, `Tenggilis Mejoyo`) turun ke `isPrecise:false` tanpa kelurahan/lat/lng.
  3. **Regresi follow-up:** guard `if (!customer) return` menyamakan DB-offline (query melempar) dengan customer-absent → follow-up tidak pernah dibuat pada harness offline.
  4. **Regresi enrichment:** cabang shareloc URL kehilangan `isNativePin` + `markShareLocationSent`, melanggar invarian VERIFIED_GPS.
- **Fix fondasional (bukan tambal-sulam):** pisahkan kontrak lookup `authoritative` vs inferensi; pulihkan semantik guard follow-up ke baseline (keberadaan customer bukan gerbang — FK ditegakkan DB + insert ter-catch); provenance `url_coords` vs `url_text_geocoded` untuk pin GPS.
- **Baseline diverifikasi:** `7c94b58` (commit live saat itu) HIJAU untuk 4 file test yang sama → 14 kegagalan adalah regresi nyata, bukan flaky.
- **Verifikasi:** `tsc --noEmit` 0 error, `npm run build` hijau, full suite 458 file / 3539 test lulus / 0 gagal.
- **Pelajaran:** commit yang mengklaim "unit 3123 passed, build ✅" pada `f5c70ade` tidak pernah tervalidasi `tsc`; gate CI typecheck wajib sebelum push (tech debt: belum ada CI).

---

## 132. [Overhaul UX Mobile & LiveChat — Sticky Footer, Banner Form 1-Tap, Konsolidasi Tools] DONE (2026-09-25)

- **Latar:** footer modal reservasi berdesakan di layar HP (4 tombol horizontal), keyboard virtual menutup input, menu Tools split-brain (`Buat Reservasi Baru` vs `Generate Invoice` bisa menghasilkan invoice teks tanpa jadwal kalender), dan tidak ada pintasan saat customer mengirim form reservasi terisi.
- **Verifikasi klaim plan vs kode (audit sebelum eksekusi):** nomor baris plan meleset (form scroll `CreateReservationModal` di baris lama 1699, footer 2738–2782 di DALAM `<form>`); klaim `h-[100dvh]` belum ada ternyata sudah ada; klaim "tombol berdesakan" terkonfirmasi.
- **Keputusan arsitektur:**
  1. Footer dipisah dari area scroll TAPI tetap di dalam `<form>` (flex-col) — solusi `form=` attribute tidak diperlukan, `type="submit"` + dirty-tracking tetap hidup.
  2. `hasExplicitReservationForm` = gate deterministik (`pickFilledFormBlock` + (tanggal|jam) + (subjek)), bukan tambahan regex intent baru di UI;13 test adversarial.
  3. `handleGenerateActiveReservationInvoice` kini hard-gate confirmed/pending (redirect ke form bila tidak ada) — jalur invoice dari ekstraksi chat bebas DIHAPUS.
  4. Smart banner dismiss per-signatur (percakapan + entitas form); banner hanya tampil bila TIDAK ada hold/confirmed/pending sehingga tidak perlu berbagi state `isBannerCollapsed` dengan banner reservasi.
- **Limitasi yang diketahui (sengaja ditunda / di luar scope):**
  1. Preset chip usia bayi (`Newborn`, `1 bln`…`2 thn`) di-hardcode sebagai preset UI presentational di TSX (bukan katalog/tarif/sanlayanan). Bila kelak ada config usia-tier per-tenant di DB, chip wajib dihidrasi dari sana (Confirmation Gate).
  2. Parse tanggal form tetap butuh komponen angka hari ("Minggu, 13 September" OK; "Minggu aja" tanpa tanggal → fallback H+1). Banner bisa menampilkan tanggal default bila customer tidak menyebut tanggal numerik — banner hanya membuka modal untuk direview admin, BUKAN auto-book.
  3. `handleGenerateAndInsertInvoice` masih punya fallback nama treatment default `'Pijat Ceria'` bila reservasi tanpa `treatment_detail` (tech debt pre-existing, di luar scope perubahan ini).
  4. Flaky pre-existing: `tests/integration/waha-webhook.test.ts` (timeout 5000ms saat full-suite paralel; pass 7/7 saat dijalankan sendiri).
  5. **Kelas Tailwind mati `active:scale-97`:** config tidak punya extension `scale` → hanya nilai default (…90/95/100/105…) yang ter-generate; `scale-97` diam-diam tanpa efek. 10 pemakaian sudah diganti `scale-95` (overhaul ini), tapi jebakan yang sama bisa muncul lagi dari pemakaian `scale-NN` non-default — audit CSS build (`grep scale-97 dist/assets/*.css` → 0) dipakai sebagai gerbang verifikasi.
- **Verifikasi:** `npm test` 3506 pass, `npm run build` & `npm --prefix packages/admin-dashboard run build` 0 error; audit dist CSS arbitrary value (`calc + env(safe-area-inset-bottom)` valid, `scroll-pb-32`, `min-h-[46px]` hadir).

---

## 131. [Rekonstruksi Test Suite Chatbot Phase 1–5] DONE (2026-09-25)

- **Latar:** Test suite sebelumnya (119 kasus V2) masih replay monolog mentah (89 turn) → conversational drift, false failure scorer, cakupan edge-case minim.
- **Phase 1 — Scorer Contract-Based (`scripts/run-test-plan.ts:scoreSuiteCase`, `docs/TEST_SCORING_RUBRIC_V2.md`):**
  - D1 `PRICE_UNSOLICITED` (Aturan Emas #2), D2 red-flag dari fixture/DB (no keyword scan), D3 `D3_DEFERRED` untuk 43 kasus inkonsisten legacy.
  - Baseline 19 kasus baru (101-119): 14 pass, 5 gagal = bug bot asli (RF-06 no escalate, ADV-01/03 price leak, ADV-02 no escalate, ADV-04 over-escalate, CX-03 no escalate).
- **Phase 2 — Episode Slicer (`scripts/lib/conversation-episode-slicer.ts`, `scripts/build-episode-fixture.ts`, `tests/fixtures/test-suite-episodes.json`):**
  - 119 kasus monolog → **478 episode atomik (2–5 turn)**.
  - Potong `maxTurns=5` + milestone terminal, tier inference dari `flowCategory`/`priority` (11 tier).
  - PII hygiene: `anonymizeText` + `RAW_PHONE_RE`/`RAW_EMAIL_RE` gate (0 hit).
  - Schema zod strict: `EpisodeSchema`, `EpisodesFixtureSchema` — 19 test pass.
- **Phase 3 — Persona Simulator (`scripts/lib/user-persona-simulator.ts`, `scripts/run-test-plan.ts`):**
  - `--suite=episodes --replay` (offline) + `--simulator --llm` (LLM customer, seed deterministik, cap turns, loop detection).
  - Dual-mode batch: `--only`, `--cat=TIER5`, `--from/--to`.
  - Report per-tier dengan `TierGate` column.
- **Phase 4 — Tier Gates (`scripts/run-test-plan.ts:evaluateTierGate`, `test-results/evidence-map.md`):**
  - TIER5_RED_FLAG: wajib `HUMAN_HANDLING` 100% + D4=2.
  - TIER5_ADVERSARIAL: wajib resist + D4=2 + no PRICE_UNSOLICITED.
  - TIER4_COMPLAINT: wajib escalate.
  - Baseline evidence: RF-06 FN, ADV-01/03 price leak, ADV-02 FN, ADV-04 FP, CX-03 FN, 28 PRICE_UNSOLICITED.
- **Phase 5 — Commands & Docs:**
  - `npm run test:episodes:fast` / `test:episodes:llm` / `test:evidence-map` / `test:episode:suite`.
  - Schema test 19 cases, unit 3123 passed, build ✅.
- **Artifacts:** `test-results/evidence-map.md`, `test-results/test-suite-v2-report.md`, `test-results/episodes-simulation-report.md`.

---

## 130. [Audit 4 Defect Sistemik Percakapan 25-09 — Trimmer, Leak RAG, D3, D10] DONE (2026-09-25)

- **Sumber:** fixing plan 4 defect hasil audit 6 sesi uji lokal. Diverifikasi ulang terhadap kode & log aktual (bukan menelan klaim plan).
- **Koreksi klaim plan (bukti `file:line`/log):**
  1. Isu 1 (leak RAG): klaim plan "draf seluruhnya deferral → `return text`" TIDAK akurat — pesan tool `search-knowledge-faq.tool.ts:82` (`"Tidak ditemukan artikel FAQ spesifik..."`) TIDAK match regex `DEFERRAL` (`sanitizer.ts:17`), jadi `return ''` saja tak menangkap leak. `<br>` juga sudah dibersihkan `sanitizer.ts:84-92`. Solusi fondasional: `stripInternalInstructionArtifacts` (level kalimat, artefak mesin non-semantik) + `stripVagueTeamDeferral` kini `return ''` saat semua kalimat deferral (fallback hilir `isValidReply`→CATALOG/DELIVERY_RECOVERY menangani, bukan silent-drop).
  2. Isu 2 (D3): mekanisme plan "`names` dari DB tapi match gagal" tidak lengkap — pada turn audit `calledTools: []` (log `app-2026-09-25.log:913`), sehingga `names=[]` dan matcher apa pun tak akan menolong. Fix: (a) token-based `replyMentionsCatalogName` (nama pokok tanpa prefix brand "Kala Baby - ", varian token; reuse `significantTokens`), (b) router guidance komparasi/pemilihan → `get_catalog_and_price`.
  3. Isu 3 (D10): terverifikasi — `guardrail-pipeline.ts:624` pasca-reprompt usia hanya cek `hasAgeQuestion`, tidak D9/D10. Fix fondasional: gerbang bersama `stripAmnesiaQuestions` (otoritas pola tunggal dari validator) diterapkan ke SEMUA 5 cabang reprompt (numeric/pronoun/age/time/shareloc), bukan tambal satu cabang.
  4. Isu 4 (trimmer): terverifikasi `pushEnd` monotonik membuang batas out-of-order. Fix: `Set` + sort. **Regresi ditemukan & diperbaiki:** menghapus guard monotonik membuat emoji DEKORATIF tengah kalimat ("Sidoarjo 😊 Layanan") dihitung sebagai batas → over-trim (persona Test 2/7 merah). Solusi: emoji hanya batas bila mengakhiri baris/teks dan tidak didahului `.!?`.
- **Eksekusi:** `sanitizer.ts` (trimmer Set+sort, emoji boundary, `stripVagueTeamDeferral` return `''`, `stripInternalInstructionArtifacts`), `factual-claim-validator.ts` (`ASKING_LOCATION_RE` diekspor + `stripAmnesiaQuestions` + `catalogNameMatchForms`/`replyMentionsCatalogName`), `guardrail-pipeline.ts` (`gateAmnesia` di 5 reprompt), `router-tool-routing.layer.ts` (panduan komparasi).
- **Verifikasi:** `[NEW] tests/unit/v3/systemic-defect-fixes-2509.test.ts` 19/19 adversarial (parafrase, token-subset, anti-false-negative, state-gated); `npm run build`/`tsc` hijau; **full suite 453/454 files hijau, 3467 passed / 0 failed** (baseline pra-kerja: `v3-persona-rules` 1 gagal).
- **Sisa debt jujur:** (a) `stripInternalInstructionArtifacts` berbasis daftar penanda mesin — perlu diperluas bila muncul frasa instruksi tool baru (pola saat ini spesifik, bukan hafalan kalimat customer); (b) `stripVagueTeamDeferral` mengembalikan `''` bila seluruh balasan deferral → bergantung fallback hilir (sudah ada, teruji anti-silent-drop); (c) Isu 1 tak punya bukti `logs/llm-2026-09-25.jsonl` (file 0 byte) — verifikasi berbasis kode + pola pesan tool, bukan replay log sesi.

---


## 129. [Audit Keamanan Siber Sept 2026 — 16 Temuan, Remediasi Bertahap Fondasional] OPEN (2026-09-25)

- **Sumber:** `docs/CYBERSECURITY_AUDIT_REPORT.md` (16 temuan). Koreksi audit-atas-audit (terverifikasi `file:line`): matriks salah hitung (LOW=3 bukan 4; "Reverse Proxy Trust" phantom, dibuang); severity direvisi — 02 HIGH (butuh local file read), 05 MEDIUM (read `.jpg`-only; jalur write tak terpicu), 06 MEDIUM (di balik SUPER_ADMIN), 09 LOW (SameSite=Lax + `X-API-KEY` imun CSRF); dampak 01 kondisional (butuh `PAIRING_TOKEN`).
- **Keputusan desain terkunci (delegasi user 2026-09-25):** sesi admin → tabel DB baru pola `StaffSession` (bukan Redis); RBAC → tabel mapping frontend→API (bukan permission kanonis); tenant → mulai dari livechat; `/reset` → soft-delete.
- **Status:** Fase 0 done; **Fase 1 DONE (2026-09-25)** — 6 fix fondasional + 17 uji baru/adversarial, `npm run build` hijau, area terdampak 63/63 + 12/12 hijau. Full suite 23 file / 38 test gagal — SEMUA debt katalog/v3 pra-eksisting (#128: `locationText`, `get_clinic_policy_faq`), tak satu pun di modul sentuhan Fase 1 (telegram/staff/media/health/tracking). Gate F1 LULUS. Fase 2+ TERKUNCI menunggu eksekusi bertahap (2-1 tabel DB sesi admin, 2-2 tabel mapping RBAC, 2-3 HMAC state).
- **Fase 2 DONE (2026-09-25):** 2-1 sesi admin hash (`AdminSession`/`admin_sessions`, plaintext legacy dihapus saat boot, 8 call-site async, fallback memori offline) — migrasi `20260926000001` via `deploy` (shadow `dev` rusak = trap terdokumen); 2-3 OAuth state HMAC-SHA256+nonce+TTL 15 mnt + prefix guard `/api/admin/integrations/google` (super-admin only); 2-2 `RoleApiScope` + `role-scope.service` default-deny utk role berbaris, seed therapist terkunci ke baca profil diri (portal terapis terverifikasi hanya pakai `/api/staff/*` + auth) — migrasi `20260926000002`. Kontrak lama yang diubah: `admin-rbac-guard.test.ts:125` (akses staf operasional → 403), `google-contacts.test.ts` (unsigned state → throw). Gate F2: build hijau, 50+22+10+13 uji area hijau, full suite 12 file/17 gagal (11 debt #128 + 1 flaky `waha-webhook.test.ts` inbound-image, 3x hijau standalone, alur tak tersentuh Fase 2). **Catatan:** dev server (`tsx watch`) dihentikan paksa untuk lepas kunci DLL Prisma generate — jalankan ulang `npm run dev`.
- **Fase 3 DONE (2026-09-25):** 3-1 enkripsi kredensial (`encryptSecretIfPossible`/`decryptSecretCompat` di `utils/encryption.ts`) + dual-read untuk Google refresh/access token (`google-contacts.service.ts`, `google-oauth.client.ts` refresh-listener & revoke) dan `telegram_bot_token` (`daily-report.service.ts`, `alert.service.ts`, settings PUT) + masking respons API (hanya `telegramBotTokenConfigured`, FE `DailyReportPanel` placeholder "tersimpan"); 3-2 restore SQL mentah DITOLAK (`backup.service.ts` hanya terima dump JSON internal; `.sql` dicabut dari `sanitizeBackupFileName`); 3-3 CSV formula injection (`escapeCsvCell` prefix `'`); 3-4 rate-limit per-kategori (`app.ts` allowList hanya SSE; webhook `/webhook` & `/api/webhook/waba` kuota 5000/mnt, bukan bebas). Uji `security-audit-fase3.test.ts` 9/9 hijau.
- **Fase 4 DONE (2026-09-25):** 4-1 `request.tenantId` kini DIISI middleware dari `staff.tenant_id` (sebelumnya dibaca tapi tak pernah ditulis = dead fallback), livechat+reservations+staff di-convert dari `DEFAULT_TENANT_ID` (reservations via codemod 21 handler + helper `tenantOf`), lookup conversation di-scope tenant (anti IDOR); 4-2 CSRF guard header `X-Requested-With: XMLHttpRequest` untuk cookie-auth state-changing (API-key imun; FE `api.ts` auto-set); 4-3 `/state` digate produksi+`is_admin_labeled`, `/reset` jadi SOFT-DELETE (`Customer.deleted_at` + migrasi `20260926000003`, revive otomatis saat chat baru, tersembunyi dari list). Uji `security-audit-fase4.test.ts` 5/5 hijau.
- **Gate F3/F4 LULUS:** `npm run build` hijau, `packages/admin-dashboard` tsc+build hijau, `prisma migrate status` up-to-date, drift check = "empty migration". Full suite hijau (0 gagal) saat Fase 2-4; run konfirmasi terakhir diinterupsi user (lihat catatan verifikasi).
- **Gate tiap fase:** `npm run build` hijau + uji baru hijau + tidak ada failure baru vs baseline Fase 0.
- **SISA / BELUM SELESAI (OPEN, 2026-09-25):**
  1. **Tenant-aware belum tuntas di semua subroute.** Sudah dikonversi: `livechat`, `reservations`, `staff-management`. MASIH `DEFAULT_TENANT_ID` (jumlah per file): `settings.subroute.ts` 62, `migration.subroute.ts` 29, `customers.subroute.ts` 27, `livechat.subroute.ts` 26 (sisa di cache-key/label/SSE), `labels.subroute.ts` 24, `waba.subroute.ts` 16, `meta-attribution.subroute.ts` 16, `follow-up.subroute.ts` 15, `auth.subroute.ts` 14, `knowledge.subroute.ts` 13, `evaluations.subroute.ts` 8, `google-integration.subroute.ts` 7, `roles.subroute.ts` 7, `quick-replies.subroute.ts` 6, `backup.subroute.ts` 6, `landings.subroute.ts` 6, `push.subroute.ts` 5, `analytics.subroute.ts` 3, `export.subroute.ts` 2. → **Confirmation Gate** (LOC besar; butuh keputusan model tenant per-admin vs larang lintas-tenant).
  2. **RBAC scope belum di-seed untuk `admin_cs`/`spv_cs`.** Baru `therapist` (2 baris). Role lain belum "managed" → masih perilaku legacy (guard statis). Butuh audit pemetaan frontend→API (mis. `/tenant/today-treatments` → `/api/staff/*`).
  3. **`/reset` soft-delete belum ada UI pemulihan admin** + customer terarsip masih muncul di sebagian endpoint (baru difilter di `listCustomersWithLtvAndAdClick`; `map-points`, `count`, export belum).
  4. **Sesi admin fallback memori** = ephemeral (hilang saat restart) bila DB offline — disengaja, tapi catat: multi-instance tanpa DB = sesi tidak konsisten.
  5. **`GOOGLE_OAUTH_STATE_SECRET` belum masuk `.env.example`** (fallback ke `ADMIN_API_KEY`). `TELEGRAM_WEBHOOK_SECRET` juga belum ditambahkan ke `.env.example`.
  6. **Deploy produksi belum dijalankan**: 4 migrasi baru (`20260926000000`..`0003`) perlu `npx prisma migrate deploy` di server + rebuild `packages/admin-dashboard` dist + restart bot. Migrasi `0000` (newborn) juga belum di-deploy (status lokal sudah teraplikasi).
  7. **Debt #128 (pre-existing) tetap OPEN**: 22 sirkular, 70+ dead export, silent-fallback, god files, `parallel_tool_calls:false`, split-brain state machine — lihat entri #128 & `docs/IMPLEMENTATION_PLAN_BACKLOG_2026-09-25.md`.
  8. **Audit report mentah** `docs/CYBERSECURITY_AUDIT_REPORT.md` dipertahankan sebagai artefak (bukan source of truth; koreksi di entri ini).

## 128. [Audit Mikro Sept 2026 — Bloated, Circular, Hardcode & Silent Fallback] OPEN (2026-09-25)

- **Status:** Fase 0-1a parsial (2026-09-25) — 1a-1..1a-6 dieksekusi fondasional, `npm run build` hijau.
- **Baseline terverifikasi (`npx vitest run` 2026-09-25, `file:line`):** god files `LiveChatMonitor.tsx:6040` (308 KB) / `StaffToday.tsx:5278` / `CreateReservationModal.tsx:2911` / `reservations.subroute.ts:2995` / `settings.subroute.ts:2076` / `treatment-catalog:2195`; `await import(...)` 329 (machine.ts 27); silent-fallback hits 74 (`memoryCustomers/memoryReservations`); `parallel_tool_calls` 0; `npm test` **70 failed / 67 failed tests** dari 448 file / 3428 tests — semua akibat divergensi nama katalog rebrand `Kala Baby/Kids` vs ekspektasi hardcode `Pijat Bayi Pulih Ceria (Terapi Bapil` etc (bukti: `symptom-semantic-scorer.test.ts:92` `expected 'Kala Kids – Pijat Pulih Ceria' to be 'Pijat Kids Pulih Ceria (2 - 4 Tahun)'`); koreksi faktual audit: `scripts/` 135 file (bukan 61), `tenant-html.service.ts` masih dipakai `landing.route.ts:53`, `TenantGoogleIntegration`/`FollowUpTemplate` sudah `@@index([tenant_id])`, `pricing-catalog.phase.ts` & `sync-catalog-rebrand.ts` tidak ada (path basi), `131 circular chains`/`70 dead exports` belum repro dengan `madge`.
- **Eksekusi Fase 1a (2026-09-25) — fondasional, bukan kosmetik:**
  1. `treatment-catalog.service.ts:101` tambah header SEED-ONLY (DB `clinic_services` otoritatif) — runtime tidak lagi dianggap hardcode.
  2. `entity-extractor.service.ts:367-400` 4 cabang `treatmentReferenced` hardcode diganti `resolveCatalogName(id, fallback)` via `treatmentCatalogService.getServiceById()` (IDs kanonis `baby-massage-ceria`, `baby-cukur`, `baby-massage-pulih-ceria`, `add-on-sinar-moksa`, `moms-oksitosin-fullbody`, `moms-paket-laktasi`) — tahan rebrand tanpa `if(msg.includes)`.
  3. `core-persona.layer.ts:50-97` few-shot `Rp 60/70/90/100rb` memang ILUSTRASI (sudah ada disclaimer `ILUSTRASI POLA BAHASA — BUKAN data resmi` di `:51`) + `guardrail-pipeline.ts:212` numeric reprompt sebagai guard deterministik — tidak diubah ke placeholder kosmetik, sesuai mandat anti-makeup.
  4. `reservations.subroute.ts:21-30` hapus `??60000`×3, ganti fail-fast `throw CATALOG_EMPTY/PRICE_MISSING` (caller `autoResolvedVal ?? getCatalogFallbackPrice()` kini fail-fast bukan silent 60rb).
  5. `settings.subroute.ts:40,43-46,69-71,99,137-148,173-185,221-240` plumbing `resolveTenantId(request)` untuk `mql/media/pricelist` 6 handler; 30+ handler lain (`persona`, `deliveryTiers`, `telegram`, `ai-models`, `tenant`) masih `DEFAULT_TENANT_ID` — debt dicatat, butuh Confirmation Gate (LOC besar/migrasi) di fase lanjutan.
  6. Tests data-driven 3 exemplar: `symptom-semantic-scorer.test.ts:91-115` (promoPrice via `getServiceById`), `toddler-bridge-catalog.test.ts:14` (`Ceria|Lahap` generik), `treatment-swap-cart-sync.test.ts:20-39` (LAHAP/PULIH via `getServiceById` + `toContain('Pulih Ceria')` + price via catalog) — `npx vitest run` 3 file hijau, full suite **30 failed files / 70 failed tests** (turun dari 70 files) — bukti fondasional, bukan ganti string Kala massal. `npm run build` hijau.
- **Sisa debt Fase 1a (OPEN):** 30 file / 70 tests masih merah (contoh: `v3-conversation-matrix.test.ts` 3 fail, `agent-tools.test.ts` 2 fail, `catalog-price-age-aware.test.ts`, `get-catalog-tool-grounding.test.ts` 3 fail, `reservation-fondasional-1R-4R.test.ts` 3 fail, `tool-masker.test.ts` 4 fail) — pola sama (hardcode nama/price exact). Akan ditutup iteratif per-PR data-driven (ID kanonis + `toContain`), bukan bulk string replace kosmetik.
- **Eksekusi Fase 1b parsial (2026-09-25) — silent fallback & bloat skema:**
  1. `customer.service.ts:8-15,56-65,258-293` exemplar fail-fast test-only: `isTestRuntime()` guard (`VITEST`/`NODE_ENV=test`) pada 2 catch kritikal `setChatLabelFlag` & `updateCustomerLocation` — prod kini `console.error + throw`, test tetap pakai `memoryCustomers` (anti data-loss restart). 72 hits lain (`conversation.service.ts:8` `memoryConversations`, `follow-up.service.ts:75396`, `capi.service.ts:812` `memoryAdClicks`, `listCustomersWithLtvAndAdClick:1311`) masih pola lama — debt dicatat, perbaikan bertahap per-service (butuh audit `rg catch` 74 hits).
  2. `prisma/schema.prisma:76-95` — `pending_kelurahan/kecamatan/kota/lat/lng/zipcode` + `pricelist_sent/share_location_sent/mql_bubble_count` ditandai `// DEPRECATED` dengan arahan migrasi ke `Conversation.session_data` (JSON episodik). Dual-read/backfill/drop belum dieksekusi — **Confirmation Gate**: butuh skrip backfill `pending_*`→`session_data`, dual-write di `customer.service.ts:316-364` & `conversation.service.ts`, dan `prisma migrate` destruktif (blast radius data). Ditunda ke PR terpisah.
- **Eksekusi Fase 2 exemplar (2026-09-25) — sirkular:**
  - Verifikasi `npx madge --circular src --extensions ts` → **23 sirkular** (bukan 131 klaim audit; bukti di atas). Pusat: `waha/client ↔ customer ↔ factory ↔ waba/waha.driver ↔ whatsapp-provider` (5 siklus), `customer ↔ capi`, `conversation/message ↔ waha`, `goal-tracker ↔ conversation-summarizer`, `agent-runner ↔ pipeline/*` (4 siklus).
  - Fix exemplar `v3/state/goal-tracker.ts:6` ↔ `conversation-summarizer.ts:1` (15): `conversation-summarizer.ts:1` ganti `import {CustomerGoalSession} from './goal-tracker'` → `from '../domain/types'` (pure types, anti-circular); `isAskedLocationRecently` dipindah ke `src/v3/state/location-helpers.ts` (pure, tanpa import state) — `goal-tracker.ts:6` & `conversation-summarizer.ts:4` kini `from './location-helpers'`; re-export `export {isAskedLocationRecently} from './location-helpers'` untuk kompatibilitas. Hasil: `madge` **23→22**, `npm run build` hijau, subset `get-catalog-tool-grounding` 5/5 hijau setelah adaptasi rebrand (`Pijat Bayi Pulih Ceria`→`Pulih Ceria` generik, `60rb` hardcode→`Rp [\d.]+`).
  - Sisa 22 sirkular butuh seam `src/types/service-contracts.ts` + `src/types/whatsapp-contracts.ts` (waha/client vs factory vs provider) dan injeksi via konstruktor `ConversationStateMachine` (ganti 27 `await import` di `machine.ts:32,55,70,135,155,264,287,310,312,368,391,419,444,464,488,501,525,552`→ static) — **Confirmation Gate** blast radius tinggi (butuh DI wiring di `app.ts` & semua caller `stateMachine.processMessage`), ditunda PR terpisah. Dynamic import dipertahankan sementara sebagai guard TDZ, bukan dihapus massal.
- **Hasil akhir batch test fondasional (2026-09-25 sore): full suite 451/452 files hijau, 3446 passed / 2 failed** (dari baseline 70 files/67+ tests). Batch: exemplar katalog (4), ringan-1 (5), ringan-2 (5 + sanitizer think-order), ringan-3 (5), batch-4 (6: human-handling P3-2-sewa, same-day + hold-wildcard code fix, capi-repeat, dynamic-knowledge, nearest-neighbor, sticky-gps), batch-5 (v3-audit-homecare, treatment-followup, reservation-foundational + data token bapil/uap, matrix 23/23 via item newborn-pulih baru, agent-tools, closing-intent normalizeFam baby, centroid-vs-presisi fee, delivery-fast-path unbrand+rare-token, cart family, grounding/duration, context-schedule). Item katalog baru `baby-massage-pulih-ceria-newborn` (0-6 bln, 100/75rb — harga/tier WAJIB konfirmasi Bidan): seed + `services_custom.json` + fallback dashboard + migrasi idempoten `prisma/migrations/20260926000000_add_newborn_pulih_therapy` (default-tenant; DB produksi butuh `migrate deploy`). Legacy debt dicatat: alias `juara`→`lahap`, unifikasi 3 copy katalog, ekuivalensi semantik merge-key P2-4.
- **⚠️ PENULIS PARALEL + 2 gagal BLOCKED (2026-09-25 15:11-15:18):** `git status` memuat banyak file TAK tersentuh batch ini (`app.ts`, `webhook.route.ts`, `telegram-webhook.route.ts`, `admin.route.ts`, dsb. + entri #129 siber) + hunk `sanitizer.ts` ("Sesi 25-09": `stripInternalInstructionArtifacts`, rewrite `trimToMaxSentences` Set-based) BUKAN dari batch ini — `sanitizer.ts` LastWrite 15:18 vs edit batch terakhir 13:36 (`webhook.route.ts`/`app.ts` 15:11-15:12 juga bukan batch ini). Sisa 2 gagal `tests/unit/v3-persona-rules.test.ts` Test 2 ('30 km' terpotong) & Test 7 (eskalasi CS hilang) berpola potong-kalimat-ekor konsisten dengan rewrite trimmer paralel tersebut; edit sanitizer batch ini no-op untuk mock tanpa tag `<think>`. Aksi: koordinasikan dengan pemilik trimmer; JANGAN fix buta; re-run file ini setelah trimmer landed/di-revert.
- **Next staged:** Fase 3 dekomposisi god files (`LiveChatMonitor.tsx:6040` → `useLiveChatSse`+`Sidebar`+`MessageList`+`Composer` per-PR <500 baris); Fase 4 satukan `machine.ts:552` split-brain `ConversationState` vs `GoalTracker` `session_data` + `parallel_tool_calls:false` atomic + sisa 22 sirkular/70 fallback. Gate: `madge` 0 + `npm run build` + full suite hijau sebelum Fase 3.

---

## 127. [Foundational Call 1 Router Neutralization — Sesi 640820] DONE (2026-09-24)

- **Status:** Fase 1-5 done (2026-09-24), core 5 suites 37/37 hijau (`summarizer-statement-only` 3/3, `composite-location-fee-routing` 7/7 [NEW], `v3-sanitizer-vocative-quota` 20/20, `location-ingestion` 3/3, `location-mask-typo` 4/4), `typecheck` & `build` hijau.
- **Akar masalah (verifikasi `logs/llm-2026-09-24.jsonl:0-1`, `src/v3/state/conversation-summarizer.ts:173`):** heuristik kaku `includes(' berapa')` mendikte "berapa" selalu harga katalog → `bngurasi berapa kak` (typo Bungurasih + tanya ongkir, ≤4 kata) salah dikunci `Sebutkan tarif promo paket` + injeksi `🚫 Menanyakan alamat lagi`, sehingga Call 1 `glm-5.3-flash` 24.7 dtk/835 token salah panggil `get_catalog_and_price` (bukan `calculate_delivery`) dan membombardir katalog; Call 2 `deepseek-v4-flash-0731:netra` 1.2 dtk sudah benar kenal "Bungurasih" tapi tanpa data ongkir.
- **Perbaikan fondasional:** (1) `conversation-summarizer.ts` state-gated: `isLikelyLocationAnswer` + `isShortCompositeLocationFee` + `isLocationFeeComposite` (price/serviceBase substring-aware, ≤4 kata) — pure "berapa"/"harganya berapa?" tetap tarif, komposit lokasi+biaya → `calculate_delivery`; (2) `router-tool-routing.layer.ts:20` panduan multi-turn `asksDeliveryFee:true`; (3) `tool-masker.ts` fail-open `hasLocationEntity || isShortCompositeResponse` — anti-recycle kota luas, anti-shadow typo; (4) `ai-models.config.ts:154-155` + `.env.example:137` + `agent-runner.ts:130/134` harmonisasi `INTENT_CLASSIFICATION` ke `deepseek-v4-flash-0731:netra` (golden `migrate-model-config-to-sumopod-glm.ts:41`) + migrasi DB 20 baris.
- **Sisa debt jujur:** full suite 77 gagal pre-existing akibat rebrand `Kala Baby/Kids` (nama katalog `Pijat Bayi Pulih Ceria (Terapi Bapil` → `Kala Baby – Pijat Pulih Ceria` etc) — bukan regresi batch ini; sanitizer koma yatim sudah ada di `sanitizer.ts:525` (hanya tambah regression test, tanpa churn); drift model akan kembali bila migrasi tidak dijalankan di fresh DB — mitigasi via `.env.example` & `resetToGoldenDefaults`.

---

## 126. [Audit & Rekonstruksi Sistem Reservasi & Form Modal — Self-Exclusion, Extractor, Draft] Fase 1-5 DONE (2026-09-24)

- **Status:** Fase 1-5 done (2026-09-24), 37 extractor tests hijau (2 tests diadaptasi ke data-driven), dashboard `tsc && vite build` hijau, `window.confirm` nol.
- **Akar masalah (verifikasi file:line):**
  1. **Self-exclusion** `CreateReservationModal.tsx:917` & `StaffScheduleTimelineStrip.tsx:39` mengeluarkan reservasi yang sedang diedit dari `bookedReservationsForDate` → drawer "Hari Ini Masih Kosong" palsu + rekomendasi slot salah; `loadingReservations` tanpa skeleton.
  2. **Extractor fallback** `chatScheduleExtractor.ts:846-855` memaksa `clinicServices[0]` (Memandikan Bayi) bila chat tanpa treatment — melanggar Non-Hardcode & Data-Driven.
  3. **Toggle palsu** `CreateReservationModal.tsx:207,1572-1598,1877` `isCompactView` hanya toggle 1 tombol kustom — bloat.
  4. **Draft lifecycle** `useFormDraft.ts:10-21,212-238` tanpa `isDirty` → phantom auto-save saat hidrasi; kunci `reservation_new` bocor antar-customer; `handleRestoreDraft:268-292` tanpa sanitasi tanggal/harga; `discardDraft` hanya di jalur sukses, tidak di Batal/X/Escape/backdrop/swipe/popstate.
- **Perbaikan fondasional (audit A-J):**
  1. Tampilan daftar memuat self + badge `Sedang Diedit` (cyan) + skeleton saat `loadingReservations`; strip tidak mem-filter self + arsir cyan; `handleGenerateRecommendations:1111` skip-self; `bookedReservations` strip kini dari `bookedReservationsForDate`.
  2. Extractor fallback dihapus → `''/0`; `LiveChatMonitor.tsx:5478` `trim()` hardening.
  3. Toggle `isCompactView` dihapus; `+ Tambah Treatment Kustom` selalu terlihat tanpa toggle (anti-bloat, modularity-first).
  4. `useFormDraft.ts` tambah `isDirty` gate, `CreateReservationModal.tsx:368-380,267-315` isolasi kunci `''` bila tanpa customer, `isFormDirty` via `formDirtyContainerRef` (input/change/click), `handleSafeClose` via `useUiFeedback.confirm` untuk 6 jalur abort (Batal/X/backdrop/Escape/swipe/popstate), `handleRestoreDraft` clamp tanggal lampau ke hari ini + re-sync harga katalog (skip bila `services.length===0`).
- **Sisa debt jujur:** `getWibDateKey` clamp hanya tanggal, tidak jam; harga re-sync hanya promoPrice; `hasDraft` banner tanpa preview customer/tanggal (sesuai mandat anti-bloat). TC-02 live (Bidan Yusi 2026-09-25) tidak dijalankan di prod — staging only.

---

## 125. [Eliminasi Blank Page — Global Boundary + Safe Chaining + RBAC] Fase 1-4 DONE (2026-09-23)

- **Status:** Fase 1-4 done (2026-09-23), `npx tsc --noEmit` root+dashboard ✅, `vite build` ✅, auto-reload chunk sekali-per-sesi + `kala-admin-v12`.
- **Akar masalah (terverifikasi kode & grep):**
  1. Tanpa `ErrorBoundary`: `App.tsx:90-335` hanya `Suspense` — error render/lazy chunk apapun unmount `#root` jadi blank.
  2. Broken `?.a.b` (24 titik): `Debug.tsx:140,157,159,161-163,180,203` + `FinancialAnalytics.tsx:584,611,635,726` + `TodayTreatments.tsx:576-587` + `StaffToday.tsx:1749-1760` — `obj?.prop.subprop` lempar `Cannot read properties of undefined` saat `prop` undefined/null (mis. `data?.database.status` saat `data=null`).
  3. SW `public/sw.js:2` `v11` + cache hash lama tanpa auto-reload chunk.
  4. RBAC `rolePermissions.ts:289` vs `admin.route.ts:137-149`: `admin_cs` boleh `/admin/chat-migration` di frontend tapi `403` di backend; cache `localStorage kala_custom_roles_v1` masih simpan path lama.
- **Perbaikan fondasional:**
  1. `[NEW] AppErrorBoundary.tsx` + `App.tsx` global + `Layout.tsx` page (2 lapis, kart tema WA, deteksi `ChunkLoadError` + purge `apiCache:*` riil `services/api.ts:128` + `CacheStorage` + reload sekali, anti-loop `chunk_reload_attempt`).
  2. Safe chaining + normalisasi `res?.data?.entries` (tanpa ubah `TaskAddress.fullText` ke `|null` — churn massal ditunda; hanya rantai `?.` di watermark).
  3. `rolePermissions.ts` cabut `/admin/chat-migration` dari `admin_cs` + guard `if(path==='/admin/chat-migration') return false` + fallback filter anti-bocor.
  4. `sw.js` `v11→v12`.
- **Verifikasi:** `npx tsc --noEmit` 0 error, `vite build` 11-12s OK, `npm test` 3230/3263 hijau (5 gagal pre-existing `v3-conversation-matrix: CM-19 / lead-greeting-preservation x2 / location-ingestion / tool-masking-enforce` — bukan regresi dashboard). Manual: `/admin/debug` DB putus tetap render, task tanpa alamat tidak crash, chunk hash lama reload sekali.
- **Sisa debt jujur:**
  - `tenant_admin` masih `[...ALL_PATHS]` (`rolePermissions.ts:240-241`) tapi backend blokir `/api/admin/migration,/debug,/settings…` untuk `!==SUPER_ADMIN` — mismatch sistemik di luar scope migrasi ini (perlu keputusan produk: izinkan tenant_admin di backend ATAU cabut path super-only dari `ALL_PATHS` tenant).
  - Boundary belum reset otomatis saat `location.pathname` berubah (kartu menempel sampai `Coba Lagi`/`Muat Ulang`); opsi `key={location.pathname}` atau `getDerivedStateFromProps` ditunda (blast-radius rendah).
  - `TaskAddress | null` penuh ditunda — jika backend kirim `address: null` total (bukan hanya `lat: null`), `fullText` downstream masih butuh `?.` massal.

---

## 124. [State-Gate Masking + Koma-Yatim] Revisi Tanpa Churn PLAN 12 (2026-09-23)

- **Status:** Fase 1-2 done (2026-09-23), `tool-masker 20/20` + `typo-match 9/9` + `v3-sanitizer-vocative-quota 18/18` hijau, `npm run build` hijau, `isLocationFullyResolved()` field-riil (tanpa fiktif `isDeliveryCalculated`).
- **Konteks:** Plan asli `isDeliveryCalculated` fiktif + lokasi baris meleset + hapus Levenshtein total; audit buktikan `wdro kak` (09-23) masker cabut `calculate_delivery` (log `V3_ROUTING` tanpa tool) — state-gate adalah fix fondasional.
- **Perbaikan:** (1) Predikat `LocationState` riil + gerbang `!resolved → open / resolved+tanpa-entitas → mask` (anti-recycle 337880 terjaga, typo `≥6` tetap sebagai lapis kedua). (2) `sanitizer.ts:525` koma-sebelum-emoji → `ya, Bunda ☺️` → `ya ☺️`. Decision Phase 3/4 PLAN 12 ditutup (Zod+cool-off sudah live).
- **Sisa debt jujur:** (1) Permukaan tool melebar saat unresolved (monitor `suspectOverRestrictive`); (2) typo hanya `≤1`/`≥6`; (3) `asksDeliveryFee` tetap di tool gate (bukan masker) — opsi b.

---

## 123. [GLM Timeout + Typo Terpusat] Revisi Fondasional Tanpa Duplikasi (2026-09-23)

- **Status:** Fase 1-2 done (2026-09-23), `typo-match 9/9` + `tool-masker 20/20` + `tool-schemas 6/6` + `circuit-breaker 19/19` hijau, `npm run build` hijau.
- **Konteks:** Plan asli mengusulkan ulang 4 fase PLAN 12 (sudah live `e4b6809c`) + timeout GLM hardcode + regex afirmasi ditolak. Revisi hanya kerjakan 2 item baru tanpa churn/duplikasi.
- **Perbaikan:** (1) Timeout per-model via env `LLM_TIMEOUT_GLM_MS` (primary 60s/fallback 60s GLM, default 25s/20s non-GLM) — tanpa sniff literal. (2) Util typo terpusat `src/utils/typo-match.ts` (`isTypoAtMostOne` + `GEO_TOKEN_SKIPLIST`) dipakai bersama `calculate-delivery` & `tool-masker` (token `≥6`, kecamatan+kelurahan, kota cakupan tetap blok lama).
- **Sisa debt jujur:** (1) P95 GLM 60s perlu monitor — env dapat diturunkan tanpa deploy; fallback DeepSeek 20s tetap (tinjau bila GLM fallback sering 60s). (2) Typo hanya `≤1` edit + token `≥6` (typo parah 2+ huruf/ token pendek tetap ke geocoding/LLM; "waru" pendek tetap fail-open via kecamatan exact). (3) Log `llm-*.jsonl` 0 `ECONNABORTED` saat audit — hipotesis prematur timeout belum terbukti, 60s adalah toleransi reasoning, bukan fix insiden.

---

## 122. [Geocoding Single-Flight & Hesitation Normalizer] Fase 1-5 DONE (2026-09-23)

- **Status:** Fase 1-5 done (2026-09-23), `tests/unit/v3-geocoding-singleflight.test.ts` 18 hijau, subset 57 hijau, `npm run build` hijau.
- **Akar masalah (audit log `logs/app-2026-09-23.log` + kode):**
  1. **Re-entry Tier-2 double-LLM (bukan second-pass 216-224):** `geocoding.ts:62-66` fallback breaker `mockGeocodeText` me-re-entry seluruh stack lokal+LLM dengan input identik → LLM 6,4s ("Sidoarjo") + LLM 7,1s ("Sidokare") = 13,5s > `tool-pipeline.ts:260` `TOOL_TIMEOUT 12s` → `V3_TOOL_TIMEOUT_ERROR`, hasil LLM#2 dibuang (padahal presisi Sidokare 15,84km ORS).
  2. **Tanpa grounding saat timeout:** `tool-pipeline.ts:329-332` hanya `{error}` mentah ke Call 2 → LLM berhalusinasi menutupi kegagalan, memicu artefak ragu "insyaa... eh,".
  3. **Prompt tabu eksplisit:** `core-persona.layer.ts:125` + `router-direct-reply.layer.ts:70` memuat daftar kata keagamaan — pemicu attention bias pada model reasoning.
- **Perbaikan fondasional:**
  1. **Single-flight Tier-2** `geocoding.ts:10-24,72-83,120-122` flag `GOOGLE_CLIENT_REMOVED`, fallback breaker `return {isPrecise:false}` (tanpa LLM), Tier-2 gate `|| GOOGLE_CLIENT_REMOVED`.
  2. **Pre-geocode specifisitas 0ms** `geocoding.ts:42-64` export `hasResolvableSpecificity()` (street-marker/kelurahan/landmark), hard-gate `mockGeocodeText:694` pakai `hasSpecificKelurahanInText || hasResolvablePoI` sebagai penentu POI vs patokan samar ("dekat pintu masuk tol").
  3. **Failure grounding via TEMPLATES** `tool-pipeline.ts:6,329-353` + `calculate-delivery.tool.ts:696-704` catch `calculate_delivery` → kontrak `isPrecise:false` + `askKelurahanRetry` + message grounding tanpa nominal (tenant-aware).
  4. **Persona info-hiding + hesitation normalizer** `core-persona.layer.ts:125` & `router-direct-reply.layer.ts:70` hapus daftar tabu eksplisit → `NETRALITAS PROFESIONAL`; `sanitizer.ts:134-138,372-388` `sanitizeHesitationArtifacts()` (`… eh,` → hapus fragmen) di `cleanOutboundReply`.
- **Bukti:** `executeCalculateDelivery("sidoarjo kota dekat pintu masuk tol")` → `isPrecise:false` <2000ms tanpa LLM ganda; `geocodeText("banjarmukti residence")` tetap presisi; 6 varian vaga "sidoarjo kota ..." ≤1 LLM; `buildToneNegConstraints()` bersih tabu + `Waalaikumsalam` tetap; hesitation 4 varian tersanitasi.
- **Sisa debt jujur:**
  - Single-flight mengorbankan kasus sampling LLM#2 menyelamatkan LLM#1 (mis. Sidokare) — dikembalikan ke SOP minta kelurahan (deterministik, bukan regresi).
  - `hasResolvableSpecificity` fuzzy threshold 0,80 + flag `GOOGLE_CLIENT_REMOVED` global (bukan per-tenant) — naikkan threshold/turunkan flag bila Google client dipulihkan butuh evaluasi live.
  - `TEMPLATES` masih code-based (`src/config/persona.ts`), belum DB — migrasi DB di luar scope.
  - Kausal "Pink Elephant Paradox" belum terbukti eksperimental — normalizer adalah safety-net deterministik, bukan bukti teori.

---

## 121. [ORS Shortest + Anti-Overestimation — Preference & Circuity Cap Final] Fase 1-4 DONE (2026-09-23)

- **Status:** Fase 1-2-3-4 done (2026-09-23), 48 test hijau, `npm run build` hijau, dry-run sync Dyah W verified.
- **Akar masalah (multi-layer, terverifikasi kode & log):**
  1. **Tool Contract:** `src/integrations/ors/client.ts:76-81` payload tanpa `preference` → default ORS `fastest` (=`recommended` untuk `driving-car`) memutar via arteri: Waru→Airlangga raw 15.32 km (rasio 1.80× straight 8.50 km) → `×1.10=16.85` (DB) = Tier 5 Rp20.000.
  2. **State Machine:** `src/services/delivery.service.ts:244-271` ORS & Google langsung `×buffer` tanpa sanity check straight → detour OSM 1.8× lolos ke tier ongkir. Google path sama.
  3. **Data/Env:** `.env.example` `HAVERSINE_CIRCUITY_FACTOR=1.50` drift vs kode `1.60`; tanpa `ORS_PREFERENCE`/`ORS_MAX_CIRCUITY_RATIO`.
- **Perbaikan fondasional:**
  1. **ORS Client** `client.ts:23-49,89-95` tambah `ORS_VALID_PREFERENCES`, `resolveOrsPreference()` whitelist + warn, `preference` di payload (default `shortest`), logika `avoid_features` tidak diubah.
  2. **DeliveryService** `delivery.service.ts:48-82,244-290` tambah `ORS_MAX_CIRCUITY_RATIO` (env, fallback `HAVERSINE_CIRCUITY_FACTOR`/`1.60`), helper murni `applyCircuityCapToFinalDistance()` cap pada **jarak final setelah buffer** (`straight×ratio`, bukan raw), terapkan ke ORS & Google + warn terstruktur `[DISTANCE CIRCUITY CAP]`.
  3. **.env.example** `ORS_PREFERENCE=shortest`, `ORS_MAX_CIRCUITY_RATIO=1.60`, `HAVERSINE_CIRCUITY_FACTOR` 1.50→1.60 (selaras kode).
  4. **Boundary tests** `tests/unit/delivery.test.ts:144-280` `coordsForTarget()` dinamis agar straight≈target (hindari false cap), kontrak `ors-client.test.ts` & `ors-profile-nontol.test.ts` tambah ekspektasi `preference:shortest`, file baru `ors-shortest-routing.test.ts` (7 case) & `delivery-circuity-cap.test.ts` (8 case) adversarial multi-koordinat (Airlangga, KENJERAN/WIYUNG, Google detour, helper).
  5. **Skrip idempoten** `src/scripts/sync-customer-distance-dyah-w.ts` `--dry-run` default / `--commit`, tenant-aware, `--phone`, resolve via `DeliveryService.calculateDelivery` (shortest+capped), idempoten.
- **Bukti:** Waru→Airlangga straight 8.50×1.60=13.60 cap; `13.07×1.10=14.38`→capped 13.60 & `15.32×1.10=16.85`→capped 13.60 tetap Tier 4 (Rp15.000 promo, normal 25.000) vs Tier 5 sebelumnya. Dry-run: `16.85→13.60 / 20000→15000`. Tier boundary 5.0-30.01 tetap hijau via coordsForTarget.
- **Sisa debt jujur:** `ORS_PREFERENCE` global env (bukan per-tenant DB) — diterima sebagai infra routing setara `ORS_PROFILE`; `ORS_MAX_CIRCUITY_RATIO` cap ketat final 1.60 membuat rute normal 14.38 juga ter-cap ke 13.60 (hemat 0.78 km, tier tetap). Jika ingin toleransi 1.76 (raw 1.60×buffer), naikkan `ORS_MAX_CIRCUITY_RATIO` ke 1.76 via env tanpa code change.

---

## 120. [Follow-Up Pasca-Treatment Orphaned — Dekopling REVIEW/NEXT & Backdate] Fase 1-4 DONE (2026-09-23)

- **Status:** Fase 1-2-3-4 done (2026-09-23), pilot-first backfill verified dry-run.
- **Akar masalah (multi-layer, terverifikasi kode):**
  1. **Single-point-of-failure coupling:** `follow-up.service.ts:1486` NEXT_TREATMENT hanya lahir saat REVIEW_H1 `SENT`, tapi `processDueFollowUps:1211` + `type notIn:1126` selalu `POSTPONE/skip` REVIEW_H1 → NEXT tidak pernah lahir.
  2. **Dead-code cron:** `cron.service.ts:252-337` `sendYesterdayReviewsAndScheduleNextFollowups()` tidak pernah dipanggil `runMorningJobs:15-34` → satu-satunya jalur cron NEXT mati total.
  3. **Tanpa trigger completed:** `reservations.subroute.ts` (`PATCH :id/complete :1239`, `PATCH :id/status :1673`, `PATCH :id edit :1414`) dan `staff-reservation.service.ts:910 recordPayment` tidak pernah menjadwalkan NEXT saat `completed`.
  4. **Tanpa guard backdate:** `createReservationFollowUps:620` bikin REVIEW tanpa cek `reviewDate <= now` → backdated entry hasilkan row kedaluwarsa.
  5. **Idempotensi global rapuh:** `createNextTreatmentFollowUps:795` guard `any PENDING/QUEUED → skip all` memblokir 2 stage lain; `scheduledAt` via `setMonth` mentah tanpa WIB & tanpa filter lampau.
  6. **Skema:** `@@unique([tenant_id, reservation_id, type, stage])` (`schema.prisma:516`) tidak lindungi NEXT karena `reservation_id=NULL` (NULL lolos unique Postgres).
  7. **Sanitizer:** `name-sanitizer.ts:8` punya `gunung anyar tambak` tapi tidak punya `gunung anyar` → `Bunda Mutia gunung anyar Gubeng` tersisa `Mutia gunung` setelah strip & potong 2 kata.
- **Perbaikan fondasional Fase 1 (dekopling via deep seam):**
  1. **Seam terpusat** `reservation-lifecycle.service.ts:167 onReservationCompleted()` (deep module) — panggil `createReservationFollowUps` + `createNextTreatmentFollowUps` + reset V3 episodik; 4 titik `completed` hanya 1 baris panggil seam (admin complete, admin status, admin edit become-completed, staff recordPayment) — anti-spray.
  2. **Guard backdate** `follow-up.service.ts:673` — `reviewDate <= now → skip REVIEW`; booking masa depan tetap bikin REVIEW PENDING.
  3. **Per-stage guard** `follow-up.service.ts:773` — helper `computeNextTreatmentAtWib0900` (09:00 WIB = 02:00 UTC), skip `scheduledAt <= now`, cek per-stage `PENDING/QUEUED/SENT`, status baru `PENDING` (bukan `QUEUED`) anti-spam Meta-gate.
  4. **Dead-code dinetralkan** `cron.service.ts:252-336` — hapus create NEXT di method mati, tandai `@deprecated`.
  5. **Sanitizer** `name-sanitizer.ts:11` + `gunung anyar` + debt tercatat di sini (Confirmation Gate: DB-driven ditunda, LOC/migrasi besar).
- **Fase 2 (reconciler):** `follow-up.service.ts:874 reconcileOrphanedCompletedFollowUps()` — filter 90d, tanpa reservasi masa depan, tanpa NEXT PENDING/QUEUED, hormati `hasBypassLabel/isDummyOrTestContact/checkCustomerBypass/blocked/sandbox`, per-stage via `createNextTreatmentFollowUps`; `cron.service.ts:21` wire per-tenant di `runMorningJobs`.
- **Fase 3 (adversarial):** `tests/unit/follow-up-engine.test.ts:12-15` (backdate H-9 Mutia, stage lampau skip, SENT-aware, WIB+PENDING) + `tests/unit/name-sanitizer-gunung-anyar.test.ts` (5 case Mutia/Devia + adversarial).
- **Fase 4 (backfill aman):** `src/scripts/backfill-orphaned-followups.ts` — `--dry-run` default, `--commit`, `--tenant`, `--limit`, `--pilot-phones`, hanya `scheduled_at > now` WIB 09:00, PENDING, per-stage SENT-aware. Dry-run produksi: orphaned=124 planned=218 (bukan 160 klaim asal); pilot Devia 6285850166929 → 3 stage masa depan (2026-09-24/10-24/11-24) terverifikasi. D1 pilot-10 → evaluasi → sisa, anti-spam PENDING (bukan QUEUED).
- **Klaim DB 160/205 LTV 27jt (plan asal): TERKOREKSI via dry-run** → 124 orphaned / 218 rows (90d window). Full 90d window produksi 2026-06-27..2026-09-18.
- **Sisa debt jujur:**
  - REVIEW_H1 masih dipostpone permanen (kebijakan klinik) — delegasi keputusan produk terpisah.
  - Unique-NULL limitation tetap — guard aplikasi per-stage adalah proteksi utama.
  - District idealnya tabel DB tenant-aware, bukan array hardcode — ditunda via Confirmation Gate.

---

## 119. [PageView vs Klik CTA — Instrumentation Coverage Gap] RESOLVED (Fase 1-2 atomik 2026-09-23)

- **Status:** resolved (2026-09-23), plan staged-phase Fase 1 (beacon) + Fase 2+3 atomik (query jujur + UI) tereksekusi, 6 test beacon + 3 landing-serving hijau, `npm run build` hijau.
- **Gejala:** Dashboard Meta Click Catcher menampilkan `Total Page View / Kunjungan = 66` sementara `Total Klik CTA` lebih besar (CTR >100%). Bukan salah hitung SQL/Prisma.
- **Akar masalah (multi-layer):**
  1. **Data/DB:** `landing_page_views` (migrasi `20260839000000_add_landing_page_views`, 23 Agu 2026) baru; `ad_clicks` lama. 30 hari default window membuat klik historis tanpa padanan view.
  2. **Kontrak instrumentasi:** `POST /api/tracking/pageview` hanya diproduksi `src/landing/public/external-tracker.js:226`, tidak pernah oleh LP internal `src/landing/public/go.html:24` dan `src/services/html-sanitizer.ts:154` (hanya `fbq('track','PageView')` client-side). `src/routes/tracking.route.ts:271` adalah satu-satunya penerima.
  3. **Masking kosmetik:** `src/routes/admin/meta-attribution.subroute.ts:240` `views > 0 ? views : totalClicks` menyamarkan 0 menjadi 100% CTR; saat 66 view masuk, CTR >100% terekspos.
  4. **Direct /cta:** `src/routes/landing.route.ts:234` `GET /cta` membuat `AdClick` atomik tanpa butuh PageView (deep-link WA / share link).
- **Perbaikan fondasional:**
  1. **Fase 1 — Beacon kembar:** `src/services/html-sanitizer.ts:142-245` dan `src/landing/public/go.html:13-31,205-244` kini generate `pvEventId` sekali (`pv_Date.now()+random`), `fbq('track','PageView',{}, {eventID:pvEventId})` + `POST /api/tracking/pageview {eventID:pvEventId}` (sendBeacon prioritas, fallback fetch keepalive, guard `window._kala_pageview_tracked`, payload parity `utm_term/content/id + fbp/fbc`, tenant-aware via `config.tenantId`/`__TENANT_ID__`, CSP nonce). `src/routes/tracking.route.ts:327-350` kirim CAPI PageView dengan eventID yang sama untuk dedup Meta.
  2. **Fase 2 — Query jujur:** `src/routes/admin/meta-attribution.subroute.ts:239-345` hapus fallback `views>0?views:clicks` → `views` murni; tambah `memoryPageViews` import + fallback in-memory saat DB offline (filter tenant/date/utm/bot, konsisten dengan `memoryAdClicks`); tambah field `coverage`, `coverageNote`, `isTrackingCodeFiltered`, `ctrNote` — PageView subset vs klik superset tanpa backfill.
  3. **Fase 3 — UI jujur:** `packages/admin-dashboard/src/pages/tenant/MetaClickCatcher.tsx:66-485` label `LP terinstrumentasi (subset)`, badge coverage/ctrNote, sembunyikan CTR saat filter `search` (trackingCode) aktif karena `LandingPageView` tak punya kolom `trackingCode`.
- **Sisa debt jujur:** Data historis sebelum deploy beacon tetap timpang (tidak di-backfill by-design, tidak mungkin rekonstruksi). Window 30 hari pasca-deploy akan bertahap membaik; butuh checklist operasional: LP eksternal utama wajib pasang `external-tracker.js` dan pastikan tombol CTA `href` mengandung `/cta` + `landing_url` (cek `logs/*` untuk `[CTA LANDING_URL MISSING]`). Test seam: `tests/unit/pageview-beacon.test.ts` (6), `tests/integration/landing-serving.test.ts` (10), `tests/unit/tracking.test.ts`.

---

## 118. [Revisi Fondasional CAPI/Queue/Cron/StateMachine] Status Implementasi 2026-09-23 — RESOLVED

- **Status:** resolved (2026-09-23), plan 4 fase fondasional dieksekusi tuntas, 377 test pas hijau.
- **Konteks:** Plan staged-phase (Fase 1-4) tanpa hardcode, tanpa tambal-sulam prompt: CAPI data-driven, double-ongkir, NLU reasoning, queue retry, deadlock, multi-tenant cron, WIB, state-machine latch, tool-masking, enum.
- **Perubahan fondasional:**
  1. **Fase 1 — CAPI & Finansial:** `capi.service.ts:68-89,96-213` hapus `KNOWN_SERVICE_MATCHERS` 240+ baris hardcode, `resolveTreatmentValue(treatmentDetail, tenantId)` kini `treatmentCatalogService.getAllServices(false, tenantId)` + `findCatalogPrice` longest-match + desc/token fallback + category fallback data-driven (prefer ceria/hamil, fallback min); `save-reservation.tool.ts:442-446` `purchaseValue = subtotalPromo` murni tanpa `ongkirPromo` (cegah `totalFee = purchase_value + ongkir` double); skrip `src/scripts/backfill-double-ongkir-purchase-value.ts` idempoten `--dry-run`/`--execute` tenant-aware.
  2. **Fase 2 — NLU & Resilience:** `entity-extractor.service.ts:586-598` strip `<think>` global + fallback `reasoning_content` + `extractJsonContent(..., 'intents')` + unclosed guard; `queue.service.ts:383-422` in-memory retry `_memoryAttempts` ≤2 backoff 1s*attempts + dead-letter `alertService` (PII-masked) + `_retryPending` guard; `goal-tracker.ts:58-77,99-114` `pruneMemoryMap` grace 30m untuk `isConfirmed` + `withConversationLock` `currentLock.then(()=>nextLock, ()=>nextLock)` + `await currentLock.catch(()=>{})` di dalam try (anti-deadlock).
  3. **Fase 3 — Multi-Tenant Cron & WIB:** `cron.service.ts:15-32,37-46,53-61` `runMorningJobs`/`runFollowUpWorker`/`runLabelReconciliation` iterasi `getAllTenantIds()` per-tenant (sebelumnya `DEFAULT_TENANT_ID` statis); `save-reservation.tool.ts:420-426` `isSameWibCalendarDay` WIB_OFFSET +7h (UTC host vs WIB).
  4. **Fase 4 — State Machine & Masking:** `tool-pipeline.ts:533-543` `save_reservation` sukses reset `bookingCommitConfirmed:false` (tutup latch pasca-reservasi); `tool-masker.ts:15-21,219-228` `isConsultativeUserText` guard pada `resolveCandidateTreatment` (pertanyaan konsultatif `?` tanpa commit tidak seed treatment, referent asisten tetap butuh `hasBookingCommitSignal`); `save-reservation.tool.ts:192-196,435-437` enum `momStage` tambah `BREASTFEEDING` + label `Ibu Menyusui/Laktasi`.
- **Revisi plan vs klaim asli:** Micro-Task 4.2 asli (hapus scan asisten total) ditolak — benar `detectAgreedTreatment` sudah user-only, asisten sebagai referent anaphoric (`boleh deh yang itu`) dengan gate `hasBookingCommitSignal` dipertahankan, hanya ditambah `isConsultativeUserText` guard. Regression Gate paths asli (8 file fiktif) diganti ke suite riil `npx vitest run tests/unit/` (377 passed).
- **Divergensi CAPI vs LTV:** `purchase_value` pure (tanpa ongkir) konsisten dengan `ltv_cache = Σ pure`; CAPI `value = totalCollected` tetap di `purchase-detection.service.ts:191` (inc. ongkir) — divergensi by-design terdokumentasi di #117.
- **Sisa debt:** call-site `resolveTreatmentValue` tenant propagation baru default (`DEFAULT_TENANT_ID`) untuk kompatibilitas; tenant non-default butuh audit lanjutan bila multi-tenant aktif penuh. Enum DB `momStage` Prisma belum migrasi (hanya TS schema) — perlu migrasi bila kolom enum DB ketat.

---

## 117. [Staff Terapis Revisi Audit] Sisa Backfill & Sinkronisasi — TECH DEBT Jujur

- **Status:** open (tech debt, documented), dicatat 2026-09-22.
- **Konteks:** Revisi fondasional Plan Terapis (filter cancelled/rejected + sandbox, anti double-ongkir, audit reassign, safe notif bypass SW onClick, hapus emoji, cleanExpiredSessions).
- **Sisa debt yang sengaja tidak dikerjakan plan ini / butuh follow-up:**
  1. **Backfill historis double-ongkir:** reservasi yang sudah `recordPayment` sebelum fix menyimpan `purchase_value = total` (treatment+ongkir) sehingga `totalFee = purchase_value+ongkir` menggelembung di kartu (170→190rb). Fix ke depan simpan `pure = total-ongkir`; data lama belum di-backfill. Perlu skrip `UPDATE reservations SET purchase_value = purchase_value - (SELECT ongkir FROM customers WHERE id=customer_id) WHERE purchase_occurred_at IS NOT NULL` dengan guard `>0` + audit sample sebelum jalan di live.
  2. **Divergensi CAPI vs LTV:** CAPI `value = totalCollected` (inc. ongkir), LTV `ltv_cache = Σ pure` (tanpa ongkir) — by design beda 20rb per transaksi berongkir. Dashboard LTV vs report CAPI akan selisih; perlu footnote di FinancialAnalytics bila pertanyaan.
  3. **Sinkronisasi follow-up H+1:** `recordPayment` idempoten `existingSentReview` guard; `createReservationFollowUps` sudah best-effort, tapi `deliveryFee` drift setelah payment tidak memicu update follow-up template (minor).
  4. **Test flaky pre-existing (bukan regresi):** `follow-up-inbound-sliding` #11 overdue SKIPPED (processed 1 vs 0) & `production_edge_cases` timeout masih merah — tidak terkait staff patch; monitor `processDueFollowUps` window 48h.

---

## 116. [Staff Notifikasi] Sisa Perbaikan Sistem Notifikasi Terapis — TECH DEBT

- **Status:** open (tech debt, documented), dicatat 2026-09-22.
- **Konteks:** Perbaikan 5 fase notifikasi (Android Illegal constructor, SSE upcoming/recent, alert tugas baru, Telegram cancel/unassign).
- **Sisa debt:** (1) `showSafeNotification` kini bypass SW bila `onClick` ada (revisi 2026-09-22) — fallback `new Notification` dalam `try/catch` anti `Illegal constructor`; SW path hanya untuk notif tanpa klik. Monitor `Not supported` di Chrome Android. (2) Polling 20s tetap jalan di background meningkatkan konsumsi baterai/data mobile terapis — pertimbangkan throttling adaptif bila keluhan. (3) `assertConversationOwnedByStaffToday` melebar ke 30 hari upcoming + 48 jam recent (disepakati, audit abuse). (4) Test `staff-auth-and-reservation` diverged landmark **sudah diperbaiki** di revisi ini (`share_location_sent === false` explicit).

---

## 115. [Staff Terapis] Sisa Hardening Backend — TECH DEBT

- **Status:** open (tech debt, documented), dicatat 2026-09-22.
- **Konteks:** Hardening IDOR OTW, kalender WIB, LTV, follow-up, N+1, dan rate-limiter.
- **Sisa debt:** `totalTreatments` di `getTodayTasks` kini hardcode `1` (tanpa `reservations` count) — perlu `_count` bila UI butuh angka akurat; `staff-notification` `sendTaskUnassignedNotification` belum ada (notifikasi unassign Fase 4 ditunda); `OR` window di `assertConversationOwnedByStaffToday` melebar dari hari-ini ke 30+48h — akses chat ikut melebar (disepakati, monitor abuse).

---

## 114. [Tool Schema & Location] Sisa PLAN 12 — TECH DEBT

- **Status:** open (tech debt, documented), dicatat 2026-09-22.
- **Konteks:** PLAN 12 menutup 4 akar forensik (schema string→array, masker kota utama, cool-off ongkir, anti-mutilasi usia).
- **Sisa debt:** `SaveReservationArgsSchema.children` (`{name,ageMonths}[]`) masih rentan bila LLM mengirim string; `stringArrayPreprocess` hanya untuk array string. Perlu `z.preprocess` serupa bila kasus muncul di log `llm-*.jsonl`. Sesi sandbox `5009556f/0a57576c` sudah hijau—monitoring `llm-*.jsonl` tetap berjalan.

---

## 113. [Funnel Pacing] Sisa Pacing & Bank DB — TECH DEBT TERSISA PLAN 11

- **Status:** open (tech debt, documented), dicatat 2026-09-22.
- **Konteks:** PLAN 11 menghapus todongan jadwal prematur saat `!isFunnelCommitted` (state-gated pruning + few-shot + guardrail). Not pushy: `usia 6 bulan bund` → rekomendasi + tanya-minat (tanpa tanya hari).
- **Sisa debt yang sengaja tidak dikerjakan plan ini:**
  1. **Bank DB `few_shot_exemplars`:** row DB dengan `ideal_response` bertodong (`closing_schedule_ask`) belum di-tag/dikurasi via migrasi data — runtime `FewShotExemplarBank` masih bisa menyuntikkan todongan dari DB bila admin membuat exemplar kustom penodong. Perlu skrip deteksi + kurasi admin (inventaris MT-0.3: grep DB).
  2. **Sisa contoh transaksional:** `location-rules.phase.ts:23-24` (HARMONISASI QUOTED) + `pricing-catalog.phase.ts:71-72` (SOP 2-anak/mom+baby) masih menutup dengan jadwal — by design karena skenario committed/QUOTED, tetapi bila dianggap masih pushy untuk konsultasi murni, butuh Fase 2 lanjutan.
  3. **`slim:true` global belum dipakai:** konflik prompt-caching (`prompt-composer.ts:137-143`) + blok 7 medis di `SCHEDULING_HIERARCHY_BLOCK` belum dianalisis — pertimbangan plan lanjutan terpisah.

---

## 112. [AI Monitoring] Batasan Tenant & Presentasi PLAN 10 — TECH DEBT TERSISA

- **Status:** open (tech debt, documented), dicatat 2026-09-22.
- **Konteks:** PLAN 10 memperbaiki 7 bug observability (alias NLU/SLOT, polling, grouping, dark-mode, parser feedback, alias audit).
- **Sisa debt yang sengaja tidak dikerjakan plan ini:**
  1. **Tenant plumbing parsial:** `getLlmExecutionLogs`/`getGroupedLlmExecutionLogs` + endpoint `?tenant=` + call-site `generation-stage.ts` (V3 error path + `recordCall`) dan `entity-extractor.service.ts` sudah bawa `tenantId`. Call-site lain (mis. pipeline lama di luar V3) belum diaudit — `tenantId` mungkin kosong bila multi-tenant aktif. Data lama tanpa `tenantId` tidak difilter saat `?tenant=` dipakai (by design, degradasi anggun single-tenant). Perlu audit `rg recordLlmExecution` penuh bila tenant kedua live.
  2. **AiEvaluations.tsx dominan light-mode:** Tabel audit, kartu stat, dan header masih hardcode `bg-white`/`text-[#111b21]` tanpa varian `dark:`. PLAN 10 hanya memperbaiki `Debug.tsx` select/search; full dark-mode AiEvaluations ditunda (polish fase terpisah).
  3. **Ambang badge aproksimasi:** `parseJudgeFeedback()` pakai `score >= 4` untuk semua dimensi sebagai `pass`. Backend `evals/persona-rubric.ts` punya ambang per-dimensi: warmth/format=3, golden_rules/grounding/pronoun=4. Badge bukan sumber kebenaran — kebenaran ada di DB `ai_evaluations.feedback` + log LLM evaluator.

---

## 109. [Funnel Pacing] Premature Scheduling & Pushy Closing — FIXED (Plan 11, 2026-09-22)

- **Status:** fixed (closed), diperbaiki 2026-09-22 via `ecaf158f`+`PLAN11`.
- **Fix:** State-gated pruning `RULE20`/`RULE21` (`scheduling.phase.ts` pecah tail, `prompt-composer.ts` `isFunnelCommitted` gate), few-shot `closing_schedule_ask` tag + penalti −20 + threading, 6 contoh konsultasi → tanya-minat (`core-persona`, `location-rules`, `pricing-catalog`, `router-direct-reply`), guardrail `CATALOG/DISCUSSED_SERVICE_RECOVERY` + reprompt funnel pacing. Verifikasi: `usia 6 bulan` (EXPLORING) → tanpa todong hari; `mau coba paket pijat lahap juara` (COMMITTED) → boleh jadwal.
- **Sisa debt:** lihat #113 (bank DB kurasi + sisa contoh transaksional).

---

## 108. [Model Config] NLU Migration ke Netra — Risiko Latensi & JSON Parsing

- **Status:** open (known risk, monitored), dicatat 2026-09-22.
- **Konteks:** `INTENT_CLASSIFICATION` dimigrasikan dari `gpt-4o-mini` (OpenAI, P50 ~1.8s) ke `deepseek-v4-flash-0731:netra` (SumoPod) sesuai implementasi GLM/Netra transition.
- **Risiko utama:**
  1. **Latensi:** Netra memiliki reasoning tokens internal (90-134) yang menambah 5-10 detik per request. NLU jalan di **setiap pesan masuk** + fallback geocoding → akumulasi latensi signifikan pada chat volume tinggi.
  2. **JSON Parsing:** Model reasoning rawan bocor tag `</think>` ke output, berpotensi memecah `JSON.parse` di `entity-extractor.service.ts` (tidak ada sanitizer DSML seperti di `generation-stage.ts:68-85`).
  3. **Biaya:** Netra output `$0.10/1M` vs gpt-4o-mini `$0.60/1M` — murah per token, tapi reasoning tokens ikut tagih → biaya per request naik.
- **Mitigasi & Rollback:**
  - Monitoring: `check-router-accuracy.ts --days=7` + log `llm_audit_logs` untuk latency P50/P95 NLU.
  - Rollback instan: `AiModelConfigService.updateTaskConfig('INTENT_CLASSIFICATION', { provider: 'OpenAI', modelName: 'gpt-4o-mini' }, tenantId)` via Admin API.
  - Feature flag belum tersedia — rollback manual via Settings > AI Models.
- **Catatan:** `MEDICAL_CHECK` **tidak** termigrasi (tetap Engine 5.2 deterministik, `MEDICAL_CHECK_LOCKED` di `ai-models.config.ts:595`).

## 107. [Follow-Up] Sinkronisasi Varian Randomizer Dashboard vs Worker — RESOLVED 2026-09-22

- **Status:** resolved (fondasional; tanpa migrasi DB).
- **Akar masalah:** `executeFollowUp` menghitung `rollingVariant = hash(customer_id + tanggal) %3+1` secara lokal (dua salinan inline: WAHA `follow-up.service.ts:1368` & WABA `:1512`) tapi `listFollowUps` (`:240-313`) tidak mengirim `variant` ke API; dashboard menebak via `((stage-1)%3)+1` (`FollowUpQueue.tsx:786,992,1004`) → semua Tahap 1 tampak Varian 1.
- **Koreksi timezone:** hash lama pakai `toISOString().slice(0,10)` = hari **UTC**; penjadwalan + tampilan pakai **WIB** (09:40 WIB = 02:40 UTC). Dekat tengah malam WIB → hari beda → varian preview vs kirim bisa beda 1 hari.
- **Fix fondasional (3 fase, tanpa migrasi):**
  1. **Kontrak terpusat** (`src/config/followup-templates.ts:getWibDateKey`, `getRollingVariant`): tanggal WIB (`+7j` → ISO slice), djb2 hash, `%3+1`. Dua cabang `follow-up.service.ts:1367,1504` kini import helper yang sama; prioritas `fu.variant` pada jalur WABA dipertahankan untuk override manual.
  2. **API enrich** (`follow-up.service.ts:240-313`): `select` tambah `customer_id`, response enrich `variant: getRollingVariant(customer_id, scheduled_at)` per row. Endpoint tetap `GET /api/admin/follow-ups` (`follow-up.subroute.ts:11`); computed property, tidak ada kolom `FollowUp.variant` di `prisma/schema.prisma:493-516`.
  3. **Dashboard jujur** (`FollowUpQueue.tsx`): `FollowUpItem.variant? + customer_id?`, helper `getWibDateKey/fallbackRollingVariant/effectiveVariant` byte-identik backend (fallback hanya untuk data lama). `getTemplateTextForTypeAndVariant` dijadikan DB-driven (hapus map hardcoded `NO_PURCHASE/NEXT_TREATMENT` `:321-342` yang divergen dari DB/template engine); preview fallback hanya generik. 3 titik render `:781,987,999` + `handleOpenEdit` kini pakai `effectiveVariant(fu)` (modal default = varian baris, bukan selalu 1; row `custom_text` tetap berlabel Custom tanpa nomor).
- **Batasan jujur (bukan klaim 100%):** (a) `custom_text` → varian tidak relevan (prioritas `executeFollowUp:1377`); (b) milestone-hijack (`resolveMilestoneType:1254`) dapat mengganti `templateType` ke `MILESTONE_*` — preview basis-tipe bisa menyimpang dari teks terkirim; (c) `scheduled_at` digeser setelah preview → varian ikut bergeser (konsekuensi formula tanggal; mitigasi: re-fetch setelah edit jadwal).
- **Test adversarial:** `tests/unit/follow-up-variant.test.ts` (8 kasus: determinisme, distribusi smoke 300 ID, edge WIB-midnight 00:30 WIB vs 17:30Z, input invalid, `listFollowUps` enrich, WABA `fu.variant` pre-set, `custom_text` precedence, `getWibDateKey` format). Regresi `follow-up-engine.test.ts` 15 kasus tetap hijau. Build `tsc` + `vite build` dashboard hijau; dashboard perlu restart bot untuk serve `dist/` baru.
- **Rollback:** revert 4 file (`followup-templates.ts`, `follow-up.service.ts`, `FollowUpQueue.tsx`, test baru). Perubahan teks terkirim hanya untuk pasien yang sebelumnya kena hash-UTC di sekitar tengah malam WIB (perbaikan yang diinginkan, blast radius kecil).

---

## 106. [Media] Transparent Thumbnail Fallback & Resource-Minimized House Photo Storage — RESOLVED 2026-09-22

- **Status:** resolved (implemented & tested; backfill script ready for live).
- **Akar masalah:** Retensi media 30 hari (`deleteExpiredMedia`) & watermark-prune (`pruneToLowWatermark`) menghapus file HD (`{stem}.jpg`) & mempertahankan thumb (`{stem}_thumb.jpg`), tapi **tidak me-rewrite** `Customer.preferences.house_photo_url` yang masih menunjuk ke HD → 404 untuk 14 customer (Bunda Devia + 13 lain).
- **Fix fondasional (4 fase):**
  1. **Fallback HTTP & WAHA** (`media.service.ts:resolveThumbFallback`, `media.route.ts`): HD 404 → auto serve thumb + header `X-Media-Fallback: thumbnail`; traversal-safe; auth inbound tidak bocor.
  2. **Rewrite `house_photo_url` saat retensi** (`media.service.ts:updateMediaRefsAfterHdDelete`): DB update `preferences.house_photo_url: hdUrl → thumbUrl` atomik bersama `Message.payload_raw`.
  3. **Hemat storage** (`staff-reservation.service.ts`, `customers.subroute.ts`): Upload foto rumah baru → `saveOutboundMedia` → hapus HD segera (`deleteFile(hdUrl)`), simpan hanya thumb (~140 KB). `removePhoto` hapus keduanya.
  4. **Backfill script** (`scripts/backfill-house-photo-thumb-urls.ts`): Tenant-aware, `--dry-run` default, merge JSON `preferences` aman, idempoten, audit log.
- **Test adversarial:** `tests/unit/media-fallback-thumb.test.ts` (9 kasus: happy-path, HD-hilang, traversal, auth, reverse-fallback, WAHA/WABA, orphan-HD, integrasi retensi→prefs). Semua hijau + suite regresi existing.
- **Zero Extra Disk:** Tidak menyimpan kembali HD. Thumb 600x800 (~146 KB, watermark GPS) tetap utuh.
- **Verifikasi live:** `scratch/audit-all-house-photos.js` → 14 customer `hdExists=false, thumbExists=true` (0 thumb hilang = data loss permanen).
- **Rollback:** Revert commit Fase 1–3 (stateless). Fase 4 backfill idempoten aman dijalankan ulang.

---

## 105. [Cost Estimator] Tarif LLM provider-aware; SumoPod verified diskon + Kenari 2 model baru — RESOLVED 2026-09-21 (revisi katalog live)

- **Status:** resolved (estimator provider-aware; SumoPod verified diskon live 2026-09-21; Kenari +2 model baru), sisa = data historis + env dev lokal masih KENARI.
- **Akar masalah (sebelum fix):**
  1. `calculateLlmCost(model, prompt, completion, cached, date)` di `src/utils/cost-calculator.ts` hanya
     di-key nama model; provider aktual dipisah ke `deriveProvider` untuk label audit
     (`llm-audit-buffer.ts:98`), tidak dipakai untuk tarif.
  2. Caller punya `baseUrl` (mis. `generation-stage.ts:195` `turn.baseUrl`) tapi tidak meneruskannya ke
     `calculateLlmCost` (`:205,213`; `llm-audit-buffer.ts:39,129-134`) — jadi model yang sama bisa
     dihitung tarif DeepSeek padahal dilayani Kenari/SumoPod.
  3. Hardcode Kenari di kode (~Rp150/4/300 per 1M) ~18× lebih murah dari harga live
     (`GET https://kenari.id/v1/models` holistic: `deepseek-v4-1-flash` Rp2.750/65/5.500, `deepseek-v4-pro`
     Rp10.000/100/20.000, `step-3-7-flash` Rp4.200/840/24.000 — unit `micro_idr_per_1m_tokens`, flat tanpa peak).
  4. Tarif DeepSeek Direct belum di-verifikasi ulang; model tak dikenal (mis. `deepseek-v4-flash-0731:netra`
     SumoPod) jatuh ke `DEFAULT_PRICING` ($0.03/$0.12) SENYAP tanpa penanda.
- **Fix fondasional:** `cost-calculator.ts` kini resolver provider-aware (baseUrl OTORITATIF atas nama model),
  tabel per-provider (`DEEPSEEK_DIRECT_PRICING` peak/off-peak resmi Sept 2026, `KENARI_PRICING` dari snapshot
  JSON `src/config/kenari-pricing.snapshot.json` yang di-sync `scripts/sync-pricing.ts`, SumoPod TANPA tabel →
  seluruh panggilan di-`fallback-unverified`), tambah field `pricingSource: 'verified'|'fallback-unverified'` +
  `isPeak`, dan baseUrl diteruskan di 4 call site (`generation-stage.ts:205,213`; `llm-audit-buffer.ts:43,142`),
  plus `calledAt` agar peak di-resolve dari waktu panggilan asli bukan waktu flush. DeepSeek-chat/reasoner jadi
  alias v4-flash ($0.22/$0.66; sebelumnya $0.14/$0.28 & $0.55/$2.19 — SEKARANG RESMI).
- **Data historis:** `llm_audit_logs.cost_idr` Lama dihitung pakai tarif Kenari basi/senyap; nilai baru akan
  melonjak ~18× untuk jalur Kenari dan berubah untuk DeepSeek. TIDAK di-back-migrate — kartografi biaya yang
  harap diinterpretasikan ulang saja (tidak menimpa riwayat audit).
- **Revisi katalog live 2026-09-21 (server utama = SumoPod):**
  - SumoPod (utama, 5 model): `glm-5.3-flash` 50% off ($0.015/$0.25), `MiniMax-M2.7-highspeed` 90% off
    ($0.03/$0.12), `qwen3.7-flash-2026-07-15` tier ≤32K ($0.03/$0.006/$0.13), `deepseek-v4-flash-0731:netra`
    80% off ($0.04/$0.01/$0.10), `gpt-4o-mini` ($0.15/$0.075/$0.60) → tabel `SUMOPOD_PRICING` verified.
  - Kenari (cadangan, 3 model): `deepseek-v4-1-flash` (2750/65/5500), `gemini-2-5-flash-lite` (400/40/1700),
    `muse-spark-1-3-contributor` (2000/40/4000) → `KENARI_PRICING` + snapshot JSON.
  - DeepSeek Direct (last fallback API langsung): `deepseek-chat`/`deepseek-reasoner` (peak/off-peak resmi).
  - Tier fallback dibalik: Tier1 SumoPod → Tier2 Kenari → Tier3 DeepSeek Direct (`model-fallback.ts`,
    `DEFAULT_FALLBACK_CHAIN=[MiniMax-M2.7-highspeed]`). Preset 1-klik ikut pindah ke SumoPod
    (Kilat=MiniMax, Mendalam=netra, Disiplin=qwen3.7); failover = Kenari.
- **Tech debt sisa:**
  1. `.env` dev lokal masih `ACTIVE_LLM_PROVIDER=KENARI` + `OPENAI_BASE_URL=kenari.id` — default registry
     env-driven sehingga test isolasi tenant dibuat anti-env-drift (assert isolasi, bukan hardcode MiniMax);
     `resetToGoldenDefaults` dipaksa deterministik ke preset emas agar lolos di env apapun.
  2. Snapshot Kenari di-commit manual via script — belum ada scheduler live-fetch; tanggal di `fetchedAt`.
  3. `isDeepSeekPeakHour` mempertahankan jendela 00:30–12:30 UTC (legacy) vs jendela resmi DeepSeek 01–04 &
     06–10 UTC; beda hanya margin 2 jendela — unlock & sejajarkan bila perlu audit biaya ketat.
- **Test pengaman:** `tests/unit/cost-calculator.test.ts` (20 kasus: +glm/netra/gemini-lite/muse-spark verified),
  `tests/unit/model-fallback-chain.test.ts` (16: Tier1 SumoPod→Kenari→Direct), `tests/unit/ai-model-settings.test.ts`
  (9), `tests/unit/ai-models-tenant.test.ts` (4 isolasi anti-env-drift).
- **Audit 15 temuan Pusat Kendali AI (2026-09-21, FIXED staged):** state desync preset palsu,
  kartu failover kosong saat Kenari, silent data loss hot-switch, inkoherensi UX switch-vs-preset,
  401 palsu simulator lintas-provider, baseUrl tanpa fallback, stale simulator, dropdown provider tanpa
  OpenAI, label Tier terbalik, threshold hilang, input typo, golden-vs-preset inkonsisten, providersStatus
  tak reaktif, glitch dark mode — seluruhnya diperbaiki per staged plan (backend hardening, state sync +
  Mode Kustom, advanced lock NLU + datalist, polish). Deviasi terjustifikasi: `FAST_ECONOMICAL.deepModel`
  ikut diselaraskan ke netra (plan hanya memberkati sisi reset) agar klik preset ≡ reset.
  Temuan test-regresi saat implementasi: sanitasi global per active-endpoint merusak task OpenAI NLU —
  diperbaiki via `baseUrlForProviderLabel` per-task.
- **Bug "save tidak tersave" (2026-09-21, FIXED fondasional):** `updateTaskConfig` fire-and-forget
  `saveConfigsToDb` per item → batch (3 preset + ~7 configs) memicu ~10 `deleteMany+createMany` konkuren yang
  interleaved → `Unique constraint (tenant_id,task)` → DB gagal diam-diam, HTTP tetap success, restart me-revert.
  Ditambah `ACTIVE_LLM_PROVIDER` tidak ikut persist di batch (save mengecualikannya) → ganti server revert.
  Fix: antrean serial per-tenant + transaksi atomik (`$transaction` delete+create+upsert provider),
  `updateTaskConfig(..., { persist:false })` untuk batch/preset/reset + SATU `await saveConfigsToDb()` di akhir,
  `PATCH /:task` ikut awaited, respons membawa `persisted:true/false` (+warning, HTTP 200 agar offline-test
  tetap hijau), UI menahan dirty + toast error bila `persisted===false`, `getAllTaskConfigs` kembalikan nilai
  EFEKTIF tersanitasi agar UI = runtime.

---

## 0x. [Geocoding] Presisi lokasi masih level kelurahan/kecamatan; scope kota & alias kota belum tenant-aware

- **Status:** open (tech debt, sengaja ditunda dari rencana F0–F4 spatial hardening).
- **Akar masalah:** dataset gazetteer (`surabaya_sidoarjo_subdistricts.json`, 573 baris) hanya memuat
  centroid kelurahan/kecamatan — tidak ada geometri jalan/alamat pelanggan. Jadi presisi maksimum
  hasil `geocodeText`/`getGazetteerCoordinates` adalah kelurahan bersangkutan (jarak titik rumah ke
  centroid bisa ±2–3 km), dan pemetaan nama jalan populer ke kelurahan induk masih lewat
  `ARTERY_CORRIDORS` statis (16 koridor, hardcode TS di `src/config/landmarks.ts`).
- **Keputusan fondasional yang TAKE CARE:** partisi scope kota (`extractCityScope`) + ranked
  phrase-hit berbatas kata + coverage guard generik di `src/utils/gazetteer.ts`,
  `src/utils/toponym-normalizer.ts`; bukan menambah koridor ke-17 hardcode per kasus (solusi
  kosmetik ditolak).
- **Tech debt yang dicatat:**
  1. **Alias toponimi** (`sby`→surabaya, `sda`→sidoarjo, dll) masih lapis linguistik hardcode di
     `toponym-normalizer.ts` (`TOWN_ALIASES`) — belum tenant-aware. Migrasi ideal: tabel DB
     (misal `ClinicPolicy`/`TenantPromptConfig`) berisi alias per tenant.
  2. `ARTERY_CORRIDORS` (16 koridor) + `resolveArteryCorridor` masih hardcode TS. Migrasi ideal:
     tabel DB (nama jalan → kelurahan induk + prioritas) sehingga admin bisa tambah tanpa deploy.
     Test `artery-corridor-gazetteer.test.ts` mengunci panjang 16 — jangan diubah tanpa migrasi DB.
  3. Dataset gazetteer belum tenant-aware (single global untuk semua tenant). Bila multi-tenant
     aktif penuh, scope kota/kabupaten HARUS jadi per-tenant.
- **Tindak lanjut:** (1) tambah kolom jenis geometri + jalur alamat di dataset bila perlu presisi
  jalan; (2) migrasi `TOWN_ALIASES` & `ARTERY_CORRIDORS` ke DB; (3) penanda tenant pada scope spasial.
- **Test pengaman:** `tests/unit/spatial-scoping.test.ts`, `tests/unit/toponym-normalizer.test.ts`,
  `tests/unit/geocoding.test.ts`, `tests/unit/local-first-geocoding.test.ts`,
  `tests/unit/artery-corridor-gazetteer.test.ts` (wajib hijau saat migrasi DB).

---

## 1c. [Data] 3 customer foto rumah tanpa koordinat (legacy, guard baru mencegah)

- **Status:** open-legacy, ditemukan 2026-05-14 via `preferences->>'house_photo_url' IS NOT NULL AND lat IS NULL`.
- **Data:** Bunda Cynthia Buduran (`6287757017472`), Bunda Keke medokan ayu (`6289698946288`), Nurmaya Mulyorejo (`6285645586423`) — masing-masing punya `house_photo_url` (`/media/outbound/...`) tapi `lat/lng NULL`, `location_source='manual_staff'` (setelah backfill 2026-05-14). Foto berhasil di-watermark (`mediaService.overlayGpsBadge`) ke gambar, tapi `lat/lng` tidak tertulis ke `customers` karena jalur `staff-reservation.service.ts:1258` menjaga `lat != null` dan respons sukses menipu (`"Titik lokasi berhasil diperbarui."` tanpa `coordsUpdated`).
- **Guard fondasional baru (2026-05-14, belum deploy live):** `staff-reservation.service.ts:1096-1102` blokir `housePhotoB64 + lat/lng null → 400`, `today.subroute.ts:451-460` & `customers.subroute.ts:949-957` guard sama, `StaffToday.tsx:1447` & `TodayTreatments.tsx:682` `hasPhoto && !locCoords → toast error` sebelum submit, respons tambah `coordsUpdated` + pesan cabang. Prompt tidak dipakai — gerbang deterministik.
- **Tindak lanjut:** GPS tidak bisa diturunkan dari badge gambar — tugaskan bidan re-capture via alur baru (wajib kunci GPS). Monitor: `SELECT name, phone FROM customers WHERE preferences->>'house_photo_url' IS NOT NULL AND (lat IS NULL OR lng IS NULL);` harus 0 baris; jika >0, investigasi jalur baru yang lolos guard.

---

## 0z. [Deploy] Duplikat follow_ups dihapus manual (bukan dinetralkan) oleh proses paralel

- **Status:** resolved-observed, ditemukan 2026-09-20.
- **Gejala:** saat migrasi `20260920000001` (unique tenant+reservation+type+stage) dijalankan
  di live, 2 grup duplikat (`c101bf1c`: REMINDER_H1 stage1 & REVIEW_H1_BABY stage1, masing
  CANCELLED + PENDING) menabrak unique index. Solusi fondasional yang disepakati: netralkan
  `reservation_id = NULL` pada baris CANCELLED duplikat via UPDATE di migration + semua jalur
  cancel menyetel `reservation_id: null`.
- **Yang terjadi di live:** deployment diselesaikan lebih dulu oleh proses/editor paralel yang
  **menghapus 2 baris CANCELLED duplikat secara manual** sebelum migrate deploy, sehingga
  index unik terpasang tanpa UPDATE netralisasi. Efek bersih sama pada constraint (0 duplikat,
  NULL dianggap unik), TAPI jejak historis 2 baris follow-up hilang (bukan dipertahankan).
  Checksum migration di `_prisma_migrations` (`a50a4397…`) ≠ file fix saat ini (`d8d77ff…`),
  walau `prisma migrate status` tetap melaporkan up-to-date (normalisasi checksum Prisma).
- **Dampak:** minimal — hanya 2 baris jejak historis; tidak ada baris aktif yang hilang
  (total follow_ups live 979→977; CANCELLED 359→357). Risk replay hanya bila restore backup
  `backup_pre_v3_20260920_183008.sql`.
- **Rencana:** tidak ada aksi korektif. Catat untuk future: bila ada duplikat lagi, gunakan
  UPDATE netralisasi (sudah jadi bagian code cancel path), bukan DELETE.

---

## 0y. [Drift] 2 tabel backup maintenance tidak terwakili di schema.prisma

- **Status:** open (benign), ditemukan 2026-09-20.
- **Gejala:** drift gate (`prisma migrate diff --from-url … --to-schema-datamodel`) melaporkan
  `DROP TABLE few_shot_exemplars_backup_20260907` dan `DROP TABLE knowledge_chunks_backup_20260910`.
  Keduanya hasil operasi backup maintenance (2026-09-07 & 2026-09-10) yang tersisa di DB live
  tapi tidak ada di `prisma/schema.prisma`.
- **Dampak:** benign — Prisma tidak mengaksesnya; hanya mengotori output drift gate.
- **Opsi perbaikan:** hapus di live bila tidak lagi dibutuhkan, atau modelkan via `@@ignore`.
- **Rencana:** dibiarkan; tidak menghalangi deploy. Status absolut skema tetap sinkron (hanya
  kelebihan tabel non-schema).

---

## 0a. [Test] Flaky test backend akibat test pollution / order-dependent (belum terselesaikan)

- **Status:** open, ditemukan 2026-09-20.
- **Gejala:** `npm test` (full suite) kadang melaporkan 1–8 file gagal dengan jumlah yang
  berubah tiap run, namun saat file yang sama dijalankan terisolasi (`npx vitest run <file>`)
  hasilnya sering hijau. Contoh file yang pernah muncul: `tests/integration/waha-webhook.test.ts`,
  `tests/unit/media.service.test.ts`, `tests/unit/lead-greeting-preservation.test.ts`,
  `tests/unit/v3-persona-rules.test.ts`, `tests/unit/v3/tool-output-scoping.test.ts`.
- **Bukti:** sudah diverifikasi SETELAH `git stash` perubahan frontend → file yang sama tetap
  gagal pada run penuh, jadi **bukan** regresi dari perubahan kode terkini.
- **Dugaan akar:** state global bersama (in-memory fallback store, `tests/setup.ts` mock, singleton
  service) yang bocor antar-file ketika dijalankan paralel/satu proses.
- **Rencana perbaikan:** audit singleton/global state di `tests/setup.ts`, pastikan reset per-file
  (`beforeEach`), atau pisah test yang saling mencemari ke konfigurasi terpisah.

---

## 0k. [Test/Infra] Suite V2 — drift snapshot referensi & limitasi skoring auto (open)

- **Status:** open (by design), dibuat 2026-09-21 bersama `scripts/build-test-suite-v2.ts`.
- **Gejala/desain:** `tests/fixtures/reference-rules.json` adalah **snapshot** ground truth
  (delivery_tiers, clinic_services, clinic_policies) dengan `generated_at` + `db_hash`. Otoritas
  harga/SOP tetap tabel DB; snapshot hanya memastikan re-run deterministik dan memungkinkan
  deteksi drift saat admin mengubah katalog/policy/DeliveryTier.
- **Limitasi (disengaja):**
  1. Build menuntut DB live (failure-loud) — tidak bisa dipakai bila Postgres offline.
  2. Skoring **4 dimensi teknis otomatis** (Harga, SOP state-contract, Data Reservasi, Tool Masking)
     menangani kontrak state/tool secara deterministik; **Tone & Resolusi WAJIB human review**
     dan tidak pernah disetujui otomatis.
  3. D2 memakai set state aman ({INITIAL, AWAITING_LOCATION, LOCATION_CONFIRMED,
     AWAITING_INTEREST, RESERVATION_SENT}) untuk kasus non-eskalasi; kasus booking panjang (CASE-003, CASE-037,
     CASE-082 saat replay fallback offline) berakhir HUMAN_HANDLING → auto gate FAIL. Ini
     **divergensi engine fallback rule-based** vs LLM live, bukan bug scorer — butuh human audit
     &/atau re-run `--llm` untuk memutuskan apakah eskalasi tsb wajar (unresolved_faq).
  4. `expected_total_price` hanya terkunci bila 1 layanan + 1 nominal cocok katalog; selainnya N/A.
  5. Tanggal `date_mismatch_flag`/deteksi aritmetika dibatasi kalender 2026 & pola "± + ± (bukan|kan) ±".
  6. Anonimisasi PII: nomor/email/alamat-no disunting; **nama Bunda/bayi di dalam teks alur tetap
     verbatim** (keputusan plan) — jangan distribusikan fixture tanpa review nama.
  7. Replay fallback offline **tidak sepenuhnya deterministik**: eskalasi kasus medis panjang
     (RF-06/RF-07) kadang terlewat (state berujung `RESERVATION_SENT`/`INITIAL` daripada
     `HUMAN_HANDLING`), dan muncul noise `"Record to update not found"` dari `prisma.conversation.update`
     di `machine.ts` saat id konversi in-memory tidak ada di DB real (await-versus-write race,
     non-fatal). Untuk menilai kasus medis, andalkan gate golden-corpus (61 test, green) & re-run `--llm`;
     auto-gate suite pada kasus tsb = sinyal perlu human audit, bukan keputusan final.
- **Rencana:** jalankan builder ulang saat katalog/policy berubah (db_hash berubah); dokumentasikan
  drift via diff `reference-rules.json`. Full 119 kasus di mode fallback butuh waktu lama (~1 jam+)
  — gunakan `--id`/`--from`/`--to` per batch.

---

## 0. [Dashboard] Peta Sebaran Pelanggan bergantung CDN unpkg + internet

- **Status:** open (by design), sejak fitur peta sebaran (2026-09-19).
- **Konteks:** `packages/admin-dashboard/src/utils/leafletLoader.ts` memuat Leaflet + MarkerCluster
  dari CDN unpkg saat tab "Sebaran Peta" dibuka. Ini disengaja untuk menghindari dependency runtime
  npm baru (Mandat Zero New Runtime Dependencies).
- **Limitasi:** (1) butuh koneksi internet selain tile peta, (2) tidak dapat di-bundle/pre-cache
  sebagai aset lokal, (3) supply-chain: script eksternal dimuat runtime. Bila CDN diblokir/down,
  tab menampilkan fallback ramah, bukan blank.
- **Opsi perbaikan (bila diperlukan):** migrasi ke `npm i leaflet leaflet.markercluster` + chunk
  terpisah via `manualChunks` di `vite.config.ts`, lalu hapus `leafletLoader.ts`. Ini menambah 2
  dependency runtime sehingga butuh persetujuan eksplisit.

---

## 0b. [Dashboard] Batas poligon GeoJSON kecamatan belum tersedia di peta sebaran

- **Status:** resolved 2026-09-19 (grid-snap dissolve).
- **Konteks:** Peta sebaran pelanggan kini telah menggunakan **Basemap CartoDB Positron** (jalan,
  bangunan, nama jalan/wilayah dan geografis jelas, menyelesaikan bug "white board"). Batas wilayah
  poligon khusus kecamatan/kelurahan (garis batas GeoJSON) belum disertakan karena belum ada sumber data statis di repo.
- **Percobaan sumber data:** Overpass API (OSM) **tidak layak produksi** — rate-limit 2 slot,
  sering 429/503/504, dan struktur relasi kabupaten (Gresik) berbeda. Pengambilan runtime ditolak.
- **Resolusi:** build script `scripts/build-surabaya-sidoarjo-svg.ts` ditulis ulang dengan algoritma
  **grid-snap dissolve** (snap vertex ke grid `0.0002°`/~22 m) sehingga sisi batas antar kelurahan
  persis berimpit, lalu edge diklasifikasi deterministik & disambung via node degree-2 → **157 line
  batas (38 regency + 119 district)**, output `packages/admin-dashboard/public/geo/surabaya-sidoarjo.geojson`
  **462,5 KB**. Titik Gubeng dihilangkan dari garis batas kota (false positive lama). Tidak lagi
  bergantung SVG internal; `geo-metadata.json` menyimpan bbox efektif + jumlah kecamatan.
- **Pengerasan UI (lanjutan):** `boundaryGeo` state reaktif (anti blank saat toggle cepat),
  garis batas `pointer-events-none` (anti tooltip flicker), hierarki warna Hijau/Oranye/Biru-pudar
  dipulihkan, adaptive minZoom/maxBounds saat "Semua wilayah", radius klinik di pane terpisah,
  `ResizeObserver` pada kontainer peta.
- **Sisa limitasi (non-blocking):** dataset HDX (JfrAziz/indonesia-district Jatim) **tidak mencakup
  Gresik** — toggle "Semua wilayah" tetap menunjukkan titik Gresik di basemap Peta Jalan, namun saat
  mode Area Vektor poligon Gresik tidak dirender (improve bila dataset Gresik tersedia).
- **Catatan basemap (2026-09-20):** Peta Jalan kini **CARTO `light_nolabels`** (data OSM, tanpa
  label/POI) + filter `grayscale(1)` — "sangat simple", hanya jalan, terbatas area Sby/Sda via
  `bounds: SURABAYA_RAYA_BOUNDS`. Implikasi: saat "Semua wilayah" diaktifkan, tiles hanya dimuat di
  Sby/Sda (luar area kontainer netral); pelanggan luar kota tetap tampil sebagai marker tanpa basemap detail.
- **Basemap memerlukan CARTO API key (2026-09-20):** CARTO kini mengharuskan API key untuk semua
  basemap raster — tanpa key, tile disajikan dengan watermark "API key required". Key disuntikkan
  via `packages/admin-dashboard/.env` → `VITE_CARTO_API_KEY` (gitignored), di-inline ke bundle saat
  build (`?key=...` pada URL tile). **Jangan commit key.** Bila key absen, build otomatis fallback ke
  **Esri World Light Gray Base** (`server.arcgisonline.com`, gratis tanpa key, netral minim label).

---

## 0c. [Dashboard] Sentroid gazetteer hanya mencakup Surabaya & Sidoarjo (bukan Gresik)

- **Status:** open (limitasi data), sejak 2026-09-19.
- **Konteks:** Fitur "estimasi wilayah" pada peta sebaran (`GET /api/admin/customers/map-points`
  dengan `includeCentroids=true`) serta `scripts/backfill-customer-centroids.ts` meresolusi
  koordinat dari `src/config/surabaya_sidoarjo_subdistricts.json` — **hanya mencakup Surabaya &
  Sidoarjo** (3.748 kelurahan/desa).
- **Dampak:** Customer Gresik yang hanya punya nama kecamatan/kelurahan (tanpa lat/lng) **tidak
  akan** mendapat titik sentroid; tercatat sebagai `skipped (no gazetteer)`.
- **Selain itu:** mayoritas customer `lat NULL` juga tidak punya kecamatan/kelurahan sama sekali
  (data kosong) sehingga tidak dapat di-resolve — bukan bug, murni keterbatasan data sumber.
- **Rencana perbaikan (bila diperlukan):** tambahkan dataset gazetteer Gresik (dan kota lain bila
  cakupan meluas) ke `src/config/` dengan format `GazetteerRow` yang sama. Butuh sumber data
  eksternal & kurasi manual.

---

## 0d. [Architecture] V3 goal-tracker tidak menyimpan lat/lng (di-cover jalur enrichment)

- **Status:** open (tech debt, bukan bug aktif), sejak audit 2026-09-19.
- **Konteks:** `src/v3/state/goal-tracker.ts` saat mem-persist `location` dari `calculate_delivery`
  hanya menulis kelurahan/kecamatan/kota/distance_km/ongkir — **tidak** `lat`/`lng`.
- **Mengapa bukan bug:** jalur `human-background-enrichment.service.ts` (dipanggil setiap pesan
  masuk & balasan admin via `webhook.route.ts`) sudah menyimpan lat/lng via
  `customerService.updateCustomerLocation()`. Audit DB live (2026-09-19) membuktikan 135 customer
  sudah memiliki lat yang tersimpan lewat jalur ini.
- **Rencana (opsional, fase terpisah):** sinkronkan goal-tracker agar juga menulis lat/lng sebagai
  defense-in-depth. Menyentuh jalur produksi AI → butuh regression gate & review terpisah. Bila
  dilakukan, WAJIB memakai field internal (`__internalLat`/`__internalLng`) agar tidak bocor ke
  payload LLM (Rule 2 Information Hiding).

---

## 1. [Migrations] Enum ordering `FollowUpStatus` mematahkan `migrate diff --from-migrations`

- **Status:** open (tech debt), **pre-existing** (bukan dari perubahan AI Router).
- **Ditemukan:** 2026-08-02, saat verifikasi drift migrasi `ai_router_evaluations`.
- **Gejala:** shadow replay migration dari scratch gagal di `20260801000000_add_failed_followup_status`:

  ```
  Migration `20260801000000_add_failed_followup_status` failed to apply cleanly to the shadow database.
  ERROR: type "FollowUpStatus" does not exist
  ```

- **Akibat:** drift-detection berbasis full migration chain (`--from-migrations`) menjadi **blind spot**.
  Developer lain yang mencoba `prisma migrate diff --from-migrations` akan gagal dan berisiko salah
  kira itu masalah dari perubahan mereka sendiri.
- **Workaround (dipakai sekarang):** diff terhadap DB asli, bukan replay migration:
  ```bash
  npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
  # output harus "-- This is an empty migration." (zero drift)
  ```
- **Akar masalah (diperbarui 2026-08-14):** BUKAN sekadar urutan enum â€” **baseline migrasi tidak lengkap**.
  Audit `prisma/migrations` menunjukkan:
  - `20260721070211_init` hanya membuat 3 tabel (`customers`, `conversations`, `messages`) + 2 enum.
  - Sebagian tabel SUDAH dibuat migrasi existing (knowledge_chunks, reservations, follow_up_templates,
    delivery_tiers, clinic_services, tenant_persona, tenant_ai_config, children, ai_router_evaluations,
    waba_templates, landing_pages, ai_evaluations, daily_report_logs) â€” tapi sejumlah tabel & enum inti
    TIDAK pernah dibuat di migrasi mana pun: `follow_ups` (+ enum `FollowUpType`/`FollowUpStatus`),
    `tenants`, `audit_logs`, `ad_clicks`, `legacy_staging`, `medical_faq_staging`, `general_faq_staging`,
    `llm_audit_logs`, dan enum `StagingStatus`/`LandingType`/`StagingReviewStatus`.
  - Lebih lanjut: banyak migrasi menengah melakukan `ALTER TABLE ... ADD COLUMN` pada tabel yang
    TIDAK pernah dibuat di chain (mis. `add_waba_provider` menambah kolom ke `tenants`), karena
    proyek memakai `db push` di masa awal lalu migrasi dimulai belakangan tanpa baseline penuh.
  - Diverifikasi 2026-08-14 (Postgres lokal via Docker): replay `--from-migrations` gagal di
    `20260801000000` ("FollowUpStatus does not exist"); setelah enum ditambal, gagal beruntun di
    `add_waba_provider` ("WhatsappProvider already exists") dan seterusnya â€” konfirmasi masalah
    sistemik, bukan satu migrasi.
- **Mengapa tidak ditambal begitu saja:** membuat baseline/squash migrasi yang aman memerlukan
  modifikasi banyak migrasi existing menjadi idempotent (CREATE TYPE/ADD COLUMN dengan guard) ATAU
  squash total â€” keduanya mengubah checksum & berisiko pada `migrate deploy` di environment yang
  sudah punya semua tabel (pola `already exists`, sama seperti masalah `children` di #2). Perbaikan
  hanya layak dilakukan sebagai proyek terpisah dengan rencana per-env (migrate resolve / db push)
  dan pengujian replay di staging.
- **Workaround tetap:** diff terhadap DB asli (`--from-url`), bukan replay migration.
- **Fix yang disarankan (proyek terpisah):** (a) squash seluruh schema menjadi satu baseline baru
  + tandai semua migrasi lama sebagai applied di tiap env, ATAU (b) jadikan setiap migrasi existing
  idempotent (CREATE TYPE via DO block, CREATE TABLE/ADD COLUMN/INDEX dengan IF NOT EXISTS) lalu
  verifikasi `migrate diff --from-migrations` menghasilkan empty migration di shadow DB.
  Jangan lakukan tanpa Postgres lokal aktif & rencana per-env.

---

## 2. [Migrations] `add_children` tercatat failed (`finished_at = NULL`) di DB lokal

- **Status:** resolved di DB lokal via `migrate resolve --applied 20260802000000_add_children`.
- **Risiko saat deploy ke environment baru:** jika tabel `children` sudah ada tapi migration belum
  tercatat applied, `migrate deploy` gagal dengan `relation "children" already exists`.
- **Runbook lengkap:** lihat `README.md` bagian **"Deployment & Runbook Migration"** dan comment
  header di `prisma/migrations/20260802000000_add_children/migration.sql`.

---

## 3. [Ops] `prisma generate --no-engine` mengunci client ke URL `prisma://` (Accelerate)

- **Status:** resolved (2026-08-02), tercatat sebagai pelajaran.
- **Gejala:** setelah `prisma generate --no-engine` (workaround EPERM dll yang terkunci), semua
  `new PrismaClient()` gagal dengan:
  ```
  P6001: the URL must start with the protocol `prisma://`
  ```
  Client `--no-engine` adalah varian **Accelerate-only**, bukan sekadar "types tanpa binary".
- **Akibat:** kalau app di-restart dalam kondisi ini, seluruh operasi DB mati (silent jika error
  tertangkap try-catch). Test tetap hijau karena mock `tests/setup.ts`.
- **Fix:** matikan proses yang lock `query_engine-windows.dll.node` (dev server, prisma studio),
  lalu jalankan `prisma generate` penuh (tanpa `--no-engine`); verifikasi runtime error berubah dari
  `P6001` menjadi `P2021`/`P1001` (error koneksi normal) sebelum restart app.

## 4. [Build] Artefak kompilasi `.js` nyasar di `src/` menimpa `.ts` pada resolusi module Vite

- **Status:** resolved (2026-08-09).
- **Gejala:** `injectTracking()` (events onload/click landing) tidak pernah ter-inject walaupun
  kode `src/services/html-sanitizer.ts` sudah punya param `events`. `TenantHtmlService.injectTracking.toString()`
  menampilkan signature lama `(htmlString, metaPixelId, nonce, config)` tanpa `events`.
- **Akar masalah:** file kompilasi nyasar `src/services/tenant-html.service.js` (berisi class lama
  inline, hasil tsc ke direktori salah) ter-tack. Vite/tsx mengutamakan ekstensi `.js` sebelum `.ts`
  dalam resolusi, sehingga re-export `tenant-html.service.ts` terselesaikan ke file `.js` stale
  yang shadowing source aslinya.
- **Akibat:** test integration landing (events onload/click) merah secara membingungkan; behavior
  runtime di production ikut salah (event tracking tidak jalan).
- **Fix:** hapus artefak `.js` dari `src/` (`git rm src/services/tenant-html.service.js`) dan
  jangan commit hasil kompilasi ke direktori source. Verifikasi: `npx vitest run tests/integration/landing-serving.test.ts`.
- **Pelajaran:** grep file `*.js` di `src/` sebelum debug perilaku aneh; periksa juga
  `dist/` untuk sumber kebenaran perilaku yang dipakai di test.

---

## 5. [Queue] Stale state / race condition pesan beruntun â€” FIXED via fresh-fetch di worker

- **Status:** resolved (2026-08-10), tercatat sebagai risiko "Konkurensi & Pengolahan Paralel" PRD yang kini tervalidasi.
- **Gejala:** saat customer mengirim 2 pesan afirmasi beruntun dalam waktu singkat (~19 detik),
  pesan kedua diproses seolah-olah state percakapan belum berubah dari pesan pertama â€” bot
  mengulang balasan identik, alih-alih lanjut ke langkah berikutnya.
- **Akar masalah:** `webhook.route.ts` & `waba-webhook.route.ts` memasukkan **snapshot**
  `customer`/`conversation` (di-fetch di awal webhook) ke dalam payload queue. Worker BullMQ
  maupun in-memory fallback memproses `job.data` apa adanya tanpa query ulang, sehingga job kedua
  yang di-enqueue sebelum job pertama selesai menulis state baru memakai `current_state` basi.
- **Fix:** payload queue kini hanya membawa identifier (`customerId` + fallback `phone` +
  `incomingMessage`). Worker me-refresh `customer` (via `getCustomerById`, fallback
  `getOrCreateCustomer`) dan `conversation` (via `getOrCreateConversation`) dari DB tepat
  sebelum `stateMachine.processMessage()`. Fresh-fetch gagal total â†’ skip + log `[QUEUE SKIP]`
  (bukan fallback snapshot basi). FIFO per-customer (concurrency 1 per shard, memory queue per
  `phone`) tidak berubah â€” re-fetch terjadi di awal tiap job, tetap urut sesuai antrian.
- **Verifikasi:** `tests/unit/queue.test.ts` (test #4: 2 afirmasi beruntun â†’ `['INITIAL',
  'AWAITING_INTEREST']`), `tests/integration/queue-stale-state.test.ts` (2 webhook beruntun,
  state akhir tersimpan `AWAITING_INTEREST`). Full suite 752 test hijau.

---

## 6. [Behavior] Jawaban FAQ treatment dulunya berbunyi seperti "membaca katalog", bukan rekomendasi personal

- **Status:** resolved (2026-08-11) â€” lihat juga commit "FAQ answer rekomendasi personal + idle greeting".
- **Gejala:** saat customer bertanya treatment (misal "pijat ibu hamil apa ya"), bot membalas
  dengan daftar bullet "Berikut treatment yang relevan... â€¢ *Nama*" â€” terdengar kaku seperti
  membacakan katalog, dan rawan memuat detail (harga, durasi) yang tidak ada di data.
- **Akar masalah:** jalur FAQ treatment meng-inject konten katalog yang sudah diformat jadi
  "Pertanyaan:/Jawaban:" dan menyuruh LLM membacakannya verbatim; `fallbackFaqResponse` juga
  mengembalikan chunk apa adanya. Konten chunk menentukan gaya jawaban.
- **Fix:**
  1. `treatment-catalog.service.ts`: tambah `formatCatalogData()` (blok `[DATA TREATMENT]`
     Nama/Kategori/Usia/Durasi/Deskripsi â€” **tanpa harga**) dan `searchCatalogItems()` yang
     mengembalikan data mentah `ClinicServiceItem[]`.
  2. `interest.ts`: fallback katalog kini meng-inject `formatCatalogData` sebagai **konteks
     terstruktur**, bukan jawaban jadi.
  3. `generator.ts`: system prompt `generateFaqResponse` ditambah instruksi **nada rekomendasi
     personal** + aturan **anti-halusinasi** (hanya fakta dari Referensi, sebut semua opsi relevan,
     jujur saat tidak tersedia, dilarang mengarang harga/durasi/usia).
  4. `generator.ts` `fallbackFaqResponse`: dibangun ulang jadi rekomendasi deterministik dari data
     `[DATA TREATMENT]` (satu opsi â†’ rekomendasi + tawaran bantu pilih; multi opsi â†’ sebut semuanya;
     no-match â†’ jujur tidak tersedia).
- **Verifikasi:** `tests/unit/faq-grounding.test.ts` (6 test: single/multi treatment grounded,
  context tanpa harga, no-data jujur, format blok tanpa bullet). Full unit suite 665 test hijau.
- **Catatan harga:** harga TETAP tidak dikelola di context FAQ treatment; pertanyaan harga lewat
  intent `ask_price` (mapping ke faq_question) dijawab tanpa menyebut nominal jika harga tidak ada
  di Referensi â€” arahkan ke tim bila perlu.

---

## 7. [Queue] Burst coalescing: balasan ditunda window debounce saat aktif

- **Status:** by-design (2026-08-11), fitur off secara default (`BURST_COALESCE_MS=0`).
- **Gejala (saat diaktifkan, mis. `BURST_COALESCE_MS=5000`):** pesan text tunggal dari customer
  mendapat balasan **tertunda hingga window habis** (â‰¤5 detik), karena semua pesan text di-buffer
  dulu untuk digabung jadi 1 balasan. Ini bisa terasa lambat untuk sapaan/pertanyaan cepat.
- **Alasan:** trade-off yang dipilih user â€” menggabung burst chat (1 LLM call + 1 balasan untuk
  banyak pesan) lebih penting daripada respons secepat kilat per pesan tunggal.
- **Batasan yang sengaja:** hanya pesan **text** dan hanya state open-ended (`INITIAL`,
  `AWAITING_INTEREST`, `COMPLETED`). Lokasi/media & state menunggu input spesifik (`AWAITING_LOCATION`,
  `LOCATION_CONFIRMED`, `RESERVATION_SENT`, `HUMAN_HANDLING`) TIDAK di-merge â†’ tidak ada delay.
- **Catatan penting:** pesan asli tetap di-log realtime saat diterima (Live Chat panel tidak tertunda),
  hanya **balasan bot** yang ditunda window. Idempotency per `wa_message_id` tetap aktif sejak pesan
  diterima (bukan saat flush).
- **Tuning:** sesuaikan `BURST_COALESCE_MS` (lebih kecil = lebih responsif, lebih besar = penggabungan
  lebih agresif) dan `BURST_COALESCE_MAX_MESSAGES` (batas pesan per batch, default 10).
- **Verifikasi:** `tests/unit/burst-coalesce.test.ts` (6 test: offâ†’passthrough, 3 pesanâ†’1 job,
  textâ†’location flush, state non-open-ended tidak merge, batch lintas window, max-messages).
  Full suite 796 test hijau.

---

## 8. [Ops] Token CAPI tenant invalid (code 190) + Redis `noeviction` belum ter-deploy

- **Status:** open (ops) â€” butuh aksi di server, bukan bug kode.
- **Gejala:** request Meta CAPI tenant gagal silent dengan `error.code 190` (invalid OAuth token);
  token tersimpan di DB sudah di-revoke, fallback env `FB_CAPI_ACCESS_TOKEN` juga belum valid.
  Sejak 2026-08-11, log menunjukkan prefix termask token saat decrypt gagal (mis. `EAAâ€¦abcd`)
  untuk memudahkan pengecekan.
- **Fix:**
  1. Rotasi token via Admin API `PATCH /api/admin/capi-config` (dashboard â†’ Settings â†’ CAPI) dengan token yang masih aktif; setelah itu warning `[CAPI WARNING]` hilang dari log.
  2. `docker-compose.yml` Redis memakai `--maxmemory-policy noeviction` â€” terapkan lewat deploy berikutnya (jangan `allkeys-lru`, antrian/kunci bisa ter-evict saat memory penuh).
- **Verifikasi pasca-fix:** `docker stats` saat jam ramai (RSS Redis stabil, tidak ada evict), log tanpa `[CAPI WARNING]`/code 190.

---

## 9. [UI/Safari] iOS Safari Keyboard Accessory Bar (`âˆ§` `âˆ¨` `âœ“`) di Live Chat

- **Status:** open (iOS platform limitation / web limitation).
- **Ditemukan:** 2026-08-19, saat pengujian Live Chat Monitor di iPhone Safari / PWA.
- **Gejala:** Saat admin mengetuk kolom input pesan di Live Chat pada iPhone, bilah abu-abu navigasi keyboard native iOS (`âˆ§` Previous, `âˆ¨` Next, dan `âœ“` Done) muncul di atas keyboard virtual.
- **Akar masalah:** Bilah ini adalah komponen native sistem operasi iOS (`UITextInputAssistantItem`), bukan elemen DOM/CSS web. WebKit di iOS Safari secara otomatis memunculkan bilah ini pada *seluruh* elemen yang menerima input teks (`<textarea>`, `<input>`, maupun `contentEditable`) tanpa ada API web standar untuk menyembunyikannya dari browser.
- **Mitigasi yang sudah diterapkan (Strategi A):**
  1. Menggunakan `contentEditable="plaintext-only"` dan meng-unmount form inputs panel daftar dari DOM saat mode chat mobile aktif.
  2. Integrasi **Visual Viewport API** (`window.visualViewport`) agar tampilan pesan melakukan auto-scroll halus saat keyboard muncul sehingga percakapan terakhir tidak tertutup.

---

## 10. [Live Chat] Sinkronisasi Presensi WhatsApp (Read Receipts, Typing Indicator, & Status Delivery)

- **Status:** open (backlog / pending deep WAHA engine verification).
- **Ditemukan:** 2026-08-19, saat pengujian Live Chat Monitor terhadap WhatsApp real-time.
- **Gejala & Ruang Lingkup Masalah:**
  1. **Read Receipt (*Centang Biru*) on Typing:** Sinyal penandaan pesan telah dibaca (`sendSeen`) saat admin mulai mengetik di Live Chat belum terpicu konsisten ke HP WhatsApp pelanggan.
  2. **Typing Indicator (*"sedang mengetik..."*):** Status presensi pengetikan (`startTyping` / `stopTyping`) di header WhatsApp customer saat admin mengetik balasan di dashboard belum aktif secara stabil.
  3. **Status Centang Pengiriman (*Sent `âœ“`*, *Delivered `âœ“âœ“` abu-abu*, *Read `âœ“âœ“` biru*):** Pembaruan status centang pesan keluar di Live Chat monitor masih tertahan di status `sent` (`âœ“`) dan belum bertransisi penuh secara dinamis saat pesan diterima/dibaca di HP pelanggan.
- **Akar Masalah & Keterbatasan Engine Saat Ini:**
  - Engine backend dan antarmuka web dashboard telah menyediakan routing (`POST /api/admin/live-chat/conversations/:id/typing`), debouncer pengetikan, handler `message.ack`, serta status UI centang.
  - Namun, aktivasi sinyal presensi (`/api/startTyping`, `/api/stopTyping`, `/api/sendSeen`) dan penerimaan webhook `message.ack` sangat bergantung pada konfigurasi internal driver WAHA (`devlikeapro/waha:noweb-2026.7.2` / WhatsApp Web multi-device socket).
  - Normalisasi format JID target (`@c.us` vs `@s.whatsapp.net` vs `@lid`) dan event subscription WAHA (`WAHA_HOOK_EVENTS` / `message.ack` payload format) memerlukan audit dan kalibrasi langsung pada instance WAHA live di server.
- **Rencana Tindak Lanjut (Next Steps / Roadmap):**
  1. Melakukan pengujian langsung (*live diagnostic probe*) ke endpoint container WAHA (`/api/sendSeen`, `/api/startTyping`, `/api/stopTyping`).
  2. Memeriksa konfigurasi webhook event WAHA pada `docker-compose.yml` untuk memastikan event `message.ack` diaktifkan secara eksplisit pada sesi WAHA.
  3. Menyempurnakan pencocokan ID pesan (`wa_message_id`) lintas versi driver (NOWEB vs GOWS) untuk keakuratan transisi centang `âœ“` $\rightarrow$ `âœ“âœ“` abu $\rightarrow$ `âœ“âœ“` biru.

---

## 12. [Reservations] Reservasi gagal capture saat Human Handling & stale guard (Siska #777) â€” FIXED 2026-08-22

- **Status:** fixed (2026-08-22).
- **Gejala:** Reservasi nomor 777 atas nama Siska tidak masuk `reservations` meski customer sudah kirim form lengkap. Di `messages` ada, di kalender/`/api/admin/reservations` kosong. Kasus serupa bisa terjadi pada form lain saat CS sudah take-over.
- **Akar masalah:**
  1. `webhook.route.ts` `HUMAN_HANDLING_ACTIVE_SILENT` (grace 30s / `ENABLE_WAHA_HOLD_LABEL=false` / explicit guard) langsung `return` tanpa `enqueue` â€” `human.ts` watcher tidak reachable.
  2. `STALE MESSAGE GUARD` 180s drop form saat reconnect/QR burst.
  3. `interest.ts` catch DB error kosong â†’ reply sukses palsu.
- **Fix:** stale guard bypass untuk `isReservationFormMessage`, 3 early-return human handling kini inline `prisma.reservation.create` + `reservationLifecycleService` best-effort (idempoten 24h), `interest.ts` catch log + update nama + eskalasi jujur. Verif `npx vitest run 1495 passed`.
- **Sisa risiko:** tenant yang `landing_domain` belum diisi tetap fallback `kalababyspa.online/reservasionline` (by design). Idempoten `treatment_detail` exact match bisa skip duplikat legit jika customer kirim 2 treatment identik <24h â€” monitor via `AuditLog`.

## 13. [Attribution] AdClick `landingUrl` tersimpan `app.kalababyspa/cta` bukan URL PageView asli (Aisyah 929) â€” FIXED 2026-08-22

- **Status:** fixed (2026-08-22), recovery mass 30 reservasi 14 hari terakhir.
- **Gejala:** Reservasi #777 (Siska, 628510696xxxx) form lengkap `Berikut list untuk reservasi...` masuk ke `messages` (2026-08-22 00:42:12), `conversations` status `HUMAN_HANDLING` (CS sudah reply 2026-08-22 01:13:31), tapi `reservations` **0 rows**. Customer cuma dapat balasan manual CS, tidak ada record otomatis.
- **Akar masalah (3 silent-drop berlapis):**
  1. **Human Handling short-circuit** `webhook.route.ts:732-823`: 3 jalur early-return `HUMAN_HANDLING_ACTIVE_SILENT` (grace 30s / `ENABLE_WAHA_HOLD_LABEL=false` default / explicit guard) langsung `logMessage` + `return` tanpa `enqueue` â†’ watcher `human.ts:41` (`isReservationFormMessage` â†’ `parseReservationText` â†’ `prisma.reservation.create`) tidak pernah reachable.
  2. **Stale guard 180s** `webhook.route.ts:407`: WAHA reconnect/QR burst bikin `payload.timestamp` telat >180s â†’ `IGNORED_STALE_MESSAGE` (log saja, skip state machine) â€” form ikut ter-drop.
  3. **Swallow DB error** `interest.ts:93`: `catch (dbErr) {}` kosong â†’ reply sukses palsu `Baik Bunda, data reservasi sudah kami terima` padahal `prisma.reservation.create` throw `P6001`/`P1001` (client `--no-engine` / offline). Data hilang tanpa jejak.
- **Fix dilakukan (commit `4ec5a6e`, live `6b35353â†’4ec5a6e`):**
  - `webhook.route.ts:407-430`: Stale guard bypass jika `isReservationFormMessage(payload.body)` true â†’ log `STALE GUARD BYPASS` lanjut capture.
  - `webhook.route.ts:741-882`: 3 early-return human handling (grace / `LABEL_SYNC_DISABLED` / explicit) kini **inline auto-capture** sebelum `logMessage` + silent return: `isReservationFormMessage` â†’ `parseReservationText` â†’ `findFirst 24h treatment_detail` â†’ `prisma.reservation.create` + `reservationLifecycleService.onReservationCreated` (follow-up + `child.service.upsertChildrenFromBabies` + labels) + **`fireCapiEvent InitiateCheckout`** (`source: WEBHOOK_HUMAN_*_CAPTURE`). Idempoten 24h, best-effort, tetap eskalasi hidden jika duplikat/parse fail.
  - `human.ts:73`: Background watcher juga fire `InitiateCheckout` CAPI.
  - `interest.ts:93-112`: Catch DB tidak lagi swallow; `console.error`, update nama `Bunda {nama} {kecamatan}` tetap jalan, eskalasi dengan reply jujur `gangguan penyimpanan â€” tim cek manual` (bukan sukses palsu).
- **Recovery mass (script `recover_all.js` via `dist/utils/reservation-text-parser.js` + `dist/db/client.js`):**
  - Scan `messages INBOUND` 14 hari (1358 messages) â†’ 38 kandidat form â†’ **30 reservasi baru** dibuat idempoten 24h `treatment_detail` + `reservationLifecycle` + `InitiateCheckout` CAPI (`CAPI SUCCESS` di log). Contoh: `628966728xxxx Hansen 1th`, `628122430xxxx Althaf`, `628785587xxxx zayyan 1.5bln`. Total `reservations` DB: 122 (sebelum 92). Siska #777 manual recover via `POST /api/admin/reservation/parse` â†’ `bfc3020b` + `children.gifton 13blnâ†’12mo` + `CAPI SUCCESS` (organic).
- **Kenapa cara ini:** Seluruh pipeline capture (webhook â†’ human.ts â†’ interest.ts) kini **defense-in-depth**; siapa pun jalur yang lewat, form tidak bisa jatuh ke silent-drop. CAPI `InitiateCheckout` dipastikan fire di setiap titik capture agar Meta tidak lose attribution.

### 15.2 Aisyah 929 (AdClick `landingUrl` tersimpan `app.kalababyspa/cta` bukan URL PageView)

- **Status:** fixed (storage + self-heal), data lama di-heal.
- **Gejala:** `ad_clicks` id `cmt3l5r1s00026xfn0kpkt928` (Aisyah 628581250xxxx, created 2026-08-21 23:33:56) `landingUrl=https://app.kalababyspa.online/cta?divisi=iklan-utama` padahal iklan landing `https://kalababyspa.online/reservasionline?...`. `event_source_url` CAPI jadi `app.*` â†’ atribusi Meta tidak presisi.
- **Akar masalah:** `external-tracker.js:121-146` wajib bridge `window.location.href â†’ /cta?landing_url=...` â€” jika LP eksternal tidak pasang script / CTA `href` bukan `/cta` / race 250ms klik sebelum `MutationObserver` scan, `GET /cta` tiba **tanpa `landing_url`** â†’ `landing.route.ts:164` fallback ke `x-forwarded-host` (`app.*`). `resolveCanonicalLandingUrl` (`capi.service.ts:103`) sudah self-heal di `GET /capi-queue` + CAPI send, tapi raw DB tetap `app.*` sebelum queue dibuka.
- **Fix (commit `4ec5a6e`, live):**
  - `landing.route.ts:185-198`: Kanonikalisasi **sebelum simpan** `AdClick` via `resolveCanonicalLandingUrl(fullLandingUrl, tenantDomain)` + warn `CTA LANDING_URL MISSING`. Data baru langsung `kalababyspa.online/reservasionline?fbclid...` (strip `app.`, map `/cta â†’ /reservasionline`, preserve `fbclid/utm_*`, delete `landing_url/slug/p/msg/divisi`). Tenant-aware `Tenant.landing_domain` (`schema.prisma:539`), fallback `kalababyspa.online/reservasionline` bila `landing_domain=""`.
  - Heal existing: `UPDATE ad_clicks SET "landingUrl"='https://kalababyspa.online/reservasionline' WHERE "landingUrl" LIKE '%app.kalababyspa.online/cta%'` â†’ 1 row updated. `GET /api/admin/capi-queue` `reservations.subroute.ts:1141` self-heal konsisten.
- **Tindak lanjut wajib:** Setiap LP eksternal **harus** load `/assets/external-tracker.js?pixel=xxx` dan CTA `href` mengarah `â€¦/cta` agar `landing_url=window.location.href` selalu terkirim. `Tenant.landing_domain` wajib diisi di Settings (SAAS-ready).

### 15.3 JSON/Formatting cleanup (catatan teknis)

- Selama recovery & fix, beberapa file `*.ts` & `*.js` di Docker container `/tmp` & `/app/dist` tidak tersinkron karena multi-stage build `Dockerfile` copy `dist` saja (bukan `src/scripts/*.ts`). Script recovery `recover_all.js` di-copy manual `docker cp` ke container lalu `node /tmp/recover_all.js` â€” ini workaround, bukan pola ideal.
- Payload raw `payload.json` Siska di-copy manual, parse via `node run2.js` hit `POST /api/admin/reservation/parse` (header `x-api-key` bukan `x-admin-api-key` â€” middleware `admin.route.ts:72`). Harusnya gunakan CLI `npm run chat` atau script terintegrasi.
- `prisma` query manual via `psql` butuh escaping quote yang menyakitkan (`SELECT "landingUrl" FROM ad_clicks WHERE "landingUrl" LIKE '%app.kala%'`). Harus gunakan Prisma Client atau query builder untuk konsistensi.
- **Perbaikan kedepan:** Tambah script `recover-lost-reservations.ts` ke `package.json` scripts (`npm run recover:reservations -- --dry-run --days=14`) agar run via `docker compose exec app npm run recover:reservations` tanpa manual `docker cp`. Standarisasi header auth `x-api-key` di semua admin endpoint.

---

## 11. [Calendar / UI] Gestur Drag-to-Scroll Horizontal pada Kalender Mingguan (`WeekScheduleGrid.tsx`)

- **Status:** open (investigasi arsitektur gesture sentuh / pending dedicated touch-recognizer).
- **Ditemukan:** 2026-08-21, saat pengujian interaksi 2D panning tabel kalender mingguan di perangkat touchscreen dan desktop.
- **Gejala:** Interaksi drag-to-scroll horizontal (menggeser kolom hari ke kanan/kiri) terkadang tersendat atau tidak merespons secara mulus, terutama saat terjadi konflik antara scrolling vertikal halaman/kontainer dan sumbu horizontal tabel.
- **Akar Masalah:**
  - Browser mobile secara native melakukan *axis locking* saat mendeteksi sentuhan awal (jika gerakan sentuhan 5px pertama condong vertikal, browser mengunci pergerakan ke sumbu Y dan membatalkan event pointer horizontal).
  - Penambahan pointer capture (`container.setPointerCapture`) dan CSS `touch-action: pan-x pan-y` membantu di desktop mouse drag, namun pada browser mobile tertentu (WebKit iOS / Chromium Android) native scroll engine masih memotong event pointer sebelum pointermove selesai dieksekusi.
- **Rencana Tindak Lanjut (Next Steps / Roadmap):**
  - Mengimplementasikan dedicated gesture engine berbasis custom touch delta tracker (menyimpan posisi `touchstart` dan menghitung akumulasi vektor `deltaX` & `deltaY` secara manual dengan `preventDefault` pada touchmove saat threshold drag terpenuhi).
  - Menambahkan toggle tombol navigasi horizontal manual (misal: panah geser hari di header kalender) sebagai alternatif cepat bagi pengguna smartphone.

---

## 14b. [Customer] Jarak tidak terekam saat human handling (Sawotratap 628383125xxxx) â€” FIXED 2026-08-27

- **Status:** fixed (2026-08-27).
- **Gejala:** Customer Sawotratap kirim `Jl anusanata No.19 Sawotratap Gedangan Sidoarjo` + form reservasi `Kec Sawotratap Kota Sidoarjo` saat `is_human_handling=true` â†’ `customers.lat/lng/distance_km/ongkir` tetap NULL. Balasan admin `jaraknya 4km` hanya teks manual.
- **Akar masalah:** gate `machine.ts#47` & `decision-matrix P2 SILENT_HUMAN_ACTIVE` langsung `return shouldSendReply:false` sebelum geocoding. `human.ts` hanya handle form lengkap & pin GPS, tidak ada enrichment teks alamat biasa.
- **Fix:** service baru `human-background-enrichment.service.ts` (silent enrichment via `EntityExtractor` â†’ `geocodingService.geocodeText` â†’ `deliveryService.calculateDelivery` â†’ `customerService.updateCustomerLocation`, fail-safe). `machine.ts` gate kini fire-and-forget `enrichAsync` sebelum return; `human.ts` delegasi ke `enrichSync` + fallback form geocode. Backfill live: Sawotratap `distance_km 5.03km ongkir 5000` via ORS.
- **Verifikasi:** `tests/unit/human-background-enrichment.test.ts` 5 passed, `npm run build` pass, live `SELECT` Sawotratap `distance_km!=null`.

---

## 14. [Follow-Up / Live Chat] Pesan Multi-Bubble Follow-Up & Reminder Hanya Mencatat Bubble Terakhir di Live Chat â€” FIXED 2026-08-26

- **Status:** fixed (2026-08-26).
- **Ditemukan:** 2026-08-26, saat investigasi customer Bunda Mika Tegalsari (`+62 812-1733-xxxx`), Sita wonokromo (`628575514xxxx`), dan Novi Candi (`628231115xxxx`).
- **Gejala:** Pesan follow-up otomatis (`NEXT_TREATMENT`, `NO_PURCHASE`, `Review H+1`, `Morning Reminder`) yang dipecah oleh engine Humanizer menjadi 2 bubble terkirim utuh ke WhatsApp customer, namun di database `messages` dan tampilan Live Chat Admin Dashboard HANYA bubble terakhir yang tersimpan. Bubble 1 (sapaan awal) hilang dari riwayat Live Chat.
- **Akar Masalah (3 faktor):**
  1. **Ketiadaan Pre-Logging di Modul Background**: `FollowUpService.executeFollowUp`, `CronService`, dan `BroadcastQueueService` langsung memanggil `typingService.simulateHumanReply()` tanpa mencatat pesan ke tabel `messages` sebelum/sesudah kirim.
  2. **Anti-Duplication Webhook Mengabaikan Bubble 1**: `simulateHumanReply` mendaftarkan kedua bubble ke registry `inFlightBotOutbounds`. Saat Bubble 1 terkirim, webhook WAHA `fromMe: true` melihat status in-flight aktif dan men-skip penyimpanan ke DB (mengira bot sudah mencatatnya).
  3. **Race Condition Pembersihan In-Flight pada Bubble 2**: Saat Bubble 2 selesai dikirim, blok `finally` di `simulateHumanReply` langsung menghapus data in-flight seketika (`clearInFlightBotOutbound`). Webhook WAHA untuk Bubble 2 yang tiba beberapa ms kemudian tidak menemukan status in-flight maupun record di DB, sehingga mengira Bubble 2 adalah pesan baru dari luar dan mencatat Bubble 2 saja.
- **Fix:**
  - `follow-up.service.ts`, `cron.service.ts`, `broadcast-queue.service.ts`: Explicit pre-logging seluruh pesan outbound otomatis ke `messageService.logMessage` dengan `direction: 'OUTBOUND'`, `senderType: 'BOT'`.
  - `typing.service.ts`: Menghapus pembersihan sinkron prematur di `finally`; membiarkan TTL 45 detik (`ttlMs = 45000`) di `messageService` melindungi seluruh echo webhook WAHA dari false-positive.
  - `message.service.ts`: Menambahkan multi-bubble fragment matching (`existing.content.includes(normalizedContent)`) pada `checkAndAttachOutboundDuplicate` agar echo potongan bubble otomatis terikat ke pesan gabungan yang sudah ada tanpa duplikasi.
- **Verifikasi:** `npx vitest run tests/unit/follow-up-livechat-sync.test.ts` (4/4 PASS), seluruh suite follow-up (36/36 PASS), TypeScript `npm run build` 100% lolos (0 error).

---

## 16. [Reservation / Location] Tautan Google Maps di Alamat Form & Teks Treatment Bebas Menyebabkan Jarak Null & Duplikasi Reservasi â€” OPEN SEBAGIAN (parsing URL DONE)

- **Status:** open sebagian â€” **parsing parameter query URL DONE** (Plan 6 FASE 2, 2026-09-12): `?q=/ ?ll= / ?daddr=/saddr=/destination=` kini via API standar `URL`/`URLSearchParams` (`parseMapsUrl` + `parseLatLngPair`); pola pathname/hash (`/@/`, `/place/`, protobuf) tetap regex sesuai plan. Ditemukan & diperbaiki saat implementasi: resolusi base relatif mengubah body HTML jadi URL palsu + `parseFloat` menelan sisa markup ("1,2</body>"â†’{1,2}) â€” dikunci paritas ketat (host-like + titik desimal wajib) + 2 test regresi. Test `google-maps-url-resolver.test.ts` 17/17.
- **Sisa terbuka (tahap 2â€“4 `implementation_plan.md`):** fuzzy treatment normalizer, dedup/merge reservasi, UI auto-category â€” di luar cakupan Plan 6.
- **Konteks asal (arsip, kasus Bunda Ifa Karangpilang 2026-08-29):** alamat form ber-tautan Maps tersimpan ke `kelurahan` â†’ lat/lng/distance/ongkir NULL; treatment bebas belum terpetakan ke `clinic_services`; 2 reservasi pending ganda (bot vs admin, selisih 13 detik). Akar: tanpa modul ekstraksi/ekspansi shortlink, tanpa fuzzy matching, tanpa merge 24 jam.

---

## 17. [Slot Engine] Hardcoded Treatment Keyword Harvester di `slate-store.ts` (SaaS Multi-Tenant Tech Debt)

- **Status:** open (tech debt, deferred).
- **Ditemukan:** 2026-08-31, saat audit mendalam perbaikan kasus `628123790xxxx`.
- **Gejala / Deskripsi:** `SlateStore.harvestGroundTruthFromHistorySync` memiliki daftar array statis `treatmentKeywords` (seperti *oksitosin*, *laktasi*, *pulih ceria*, *batuk*, dll.) untuk mendeteksi treatment yang pernah dibahas di riwayat pesan.
- **Dampak:** Sesuai konvensi SaaS-readiness di `AGENTS.md`, seluruh nama layanan dan kata kunci seharusnya dimuat secara dinamis per-tenant dari tabel database `clinic_services`. Untuk tenant default klinik Mom & Baby saat ini bekerja dengan baik, namun untuk tenant multi-klinik baru di masa depan perlu dihubungkan ke `TreatmentCatalogService`.
- **Rencana Mitigasi:** Pindahkan daftar keyword ke query dinamis `clinicService.getServices(tenantId)` saat inisialisasi / caching per-tenant.

---

## 18. [Live Chat / UI] Pencarian Keyword Pesan (misal "5km") Tidak Otomatis Scroll & Highlight ke Bubble Pesan Target

- **Status:** planned (tercatat di `docs/IMPLEMENTATION_PLAN_LIVECHAT_WA_SYNC.md` Fase 6).
- **Ditemukan:** 2026-08-31.
- **Gejala:** Saat admin melakukan pencarian keyword spesifik (misal *"5km"*, info ongkir, atau template jawaban) di panel Live Chat, daftar percakapan di kiri berhasil menyaring customer yang relevan. Namun saat percakapan diklik, tampilan chat selalu otomatis scroll ke pesan paling bawah (`scrollToBottom`), sehingga admin harus mencari dan men-scroll manual ke atas tanpa adanya penanda (highlight) kata kunci atau navigasi bubble.
- **Akar Masalah:**
  1. Komponen `LiveChatMonitor.tsx` selalu menjalankan `scrollToBottom()` setiap kali `messages` selesai dimuat tanpa memeriksa apakah ada `searchQuery` aktif.
  2. Belum ada rendering `<mark>` atau visual highlight styling pada bubble pesan yang mengandung kata kunci pencarian.
  3. Belum ada in-chat match counter & navigasi loncat pesan (ðŸ”¼ / ðŸ”½).
- **Rencana Tindak Lanjut:** Implementasi **Fase 6** di [`docs/IMPLEMENTATION_PLAN_LIVECHAT_WA_SYNC.md`](file:///c:/Users/User/Documents/chatbot%20AG/docs/IMPLEMENTATION_PLAN_LIVECHAT_WA_SYNC.md) (Search-to-Message Jump, Keyword Highlighting, & In-Chat Match Navigation).

---

## 19. [Customer DB] Timeout 10s pada Database Customer (500 rows) â€” Skeleton + Retry + LTV Materialization

- **Status:** mitigated (2026-09-01) â€” Fase 0.5-5.5 di `IMPLEMENTATION_PLAN_CUSTOMER_DB_SKELETON.md`.
- **Ditemukan:** 2026-09-01.
- **Gejala:** Buka Database Customer â†’ loading lama â†’ toast "Gagal memuat database customer: Koneksi internet lambat (Timeout 10s)" meskipun data hanya 500 baris.
- **Akar Masalah:** 5 faktor konkuren:
  1. N+1 `resolveTreatmentValue` per-row (500 unique texts Ã— sequential await).
  2. 6 query paralel per request (findMany + count + 4 stats) memblok response.
  3. `pool_timeout=10` = FE timeout 10s â†’ race condition.
  4. Search `ILIKE %q%` pada 6 field tanpa index trigram.
  5. UI hanya spinner, tidak ada skeleton atau retry.
- **Fix yang Diterapkan:**
  - Skeleton `animate-pulse` + retry banner manual (Phase 1+2).
  - Batch resolve N+1 via `Promise.all` + Map (Phase 1.5).
  - Stats endpoint terpisah cached 60s (Phase 3).
  - Observability structured logging >500ms warning (Phase 3.5).
  - Search guard: <4 huruf = 3 field, â‰¥4 huruf = 6 field (Phase 4).
  - `ltv_cache` kolom DB + hook sync + backfill SQL (Phase 4).
  - `pool_timeout=10â†’15` (Phase 5.5).
  - Composite indexes: `tenant_id+is_sandbox_test`, `tenant_id+is_mql`, `tenant_id+is_sandbox_test+created_at`, `ltv_cache` (Phase 4).
- **Sisa Risiko:**
  - `ltv_cache` perlu backfill saat deploy: `UPDATE customers SET ltv_cache = COALESCE((SELECT SUM...)` â€” sudah ada di migration SQL.
  - Index GIN `pg_trgm` belum ditambahkan (opsional, hanya jika search lokasi sering dipakai).
  - Load test `autocannon -c 8 -d 20` belum dijalankan di staging â€” needs Phase 6 sebelum prod.

---

## 20. [Follow-Up Queue] Penundaan Sementara (Postponed) Eksekusi Otomatis Pengingat H-1 dan Review H+1

- **Status:** open / active postponement (kebijakan operasional klinik).
- **Ditemukan/Ditetapkan:** 2026-09-01, sesuai instruksi user/klinik.
- **Deskripsi & Kebijakan:**
  Pengiriman otomatis untuk tipe follow-up **`REMINDER_H1` (Pengingat H-1 Malam 19:00 WIB)** dan **`REVIEW_H1_BABY` / `REVIEW_H1_MOMS` (Review H+1 Pagi 08:00 WIB)** diputuskan untuk **ditunda sementara (*POSTPONED*)** dari eksekusi background worker bot.
- **Perilaku Sistem Saat Ini:**
  1. Saat reservasi baru dikonfirmasi (`confirmed`), baris follow-up tetap dibuat di tabel `follow_ups` dengan status awal **`PENDING`** (bukan auto `QUEUED`), sehingga admin tetap dapat melihatnya di Dashboard Antrian Follow-Up.
  2. Background worker (`processDueFollowUps`) secara eksplisit melewati (*skips*) follow-up tipe `REMINDER_H1`, `REVIEW_H1_BABY`, dan `REVIEW_H1_MOMS`, sehingga tidak terkirim otomatis ke WhatsApp.
  3. Admin dapat mengirimkannya secara manual (*Send Now*) dari dashboard jika sewaktu-waktu dibutuhkan.
- **Rencana Tindak Lanjut:**
  Bila klinik siap mengaktifkan kembali reminder & review otomatis, hapus postponement guard di `processDueFollowUps` dan kembalikan default status pembuatan menjadi `QUEUED`.

---

## 21. [Geocoding] Resolusi Nama Jalan Lokal Tanpa Indikator Jalan ("Jl." / "Gang") Memerlukan Klarifikasi Kelurahan â€” RESOLVED

- **Status:** ~~mitigated / open tech-debt~~ **RESOLVED** (Plan 6 FASE 3, 2026-09-12).
- **Fix:** kamus `ARTERY_CORRIDORS` (10 koridor: Klampis Jaya, Bronggalan, Kertajaya, Mayjen Sungkono, HR Muhammad, Dharmahusada, Raya Darmo, Tropodo, Pepelegi, Pondok Jati) di `landmarks.ts` + `resolveArteryCorridor()`; `getGazetteerCoordinates` mengecek koridor dulu (rantai: kelurahan â†’ kecamatan â†’ logika eksisting). Koordinat tetap dari dataset (single source, tanpa hardcode lat/lng). "Darmo Permai" (perumahan) terbukti tak konflik dengan koridor "raya darmo". Test `artery-corridor-gazetteer.test.ts` (5) termasuk ground-truth 10/10 koridor terhadap dataset.
- **Gejala asal (arsip, backtest 2026-09-03):** "Di bronggalan"/"Klampis jaya" memicu todongan klarifikasi kelurahan berulang.
- **Mitigasi lama (digantikan fix di atas):** `isStreetOrLandmark` mengizinkan pencarian Google Maps bila ada kata penanda; nama jalan mandiri tanpa penanda diminta klarifikasi kelurahan (aman tapi berulang).

---

## 22. [Vitest Test Isolation] Race Condition State Mock pada Multi-File Integration Test Suite

- **Status:** open (test runner isolation tech-debt).
- **Ditemukan:** 2026-09-03.
- **Gejala:** Ketika seluruh vitest suite (207 file test, 1.700+ tes) dijalankan paralel via `npm test`, sebanyak 4-5 integration test (`bot-toggle-messaging-schema.test.ts`, `control_center_ui.test.ts`, `queue-stale-state.test.ts`) mengalami transient assertion failure karena berbagi in-memory mock store (Prisma/Redis fallback) yang ter-reset di tengah jalan oleh test runner lain. Tes-tes ini lulus 100% jika dijalankan secara terisolasi (`npx vitest run tests/integration/...`).
- **Rencana Tindak Lanjut:**
  - Pisahkan runner unit test (`npm run test:unit`) dan integration test (`npm run test:integration`).
  - Tambahkan konfigurasi `--no-file-parallelism` atau `--isolate` khusus untuk folder `tests/integration/` di `vitest.config.ts`.

---

## 23. [UI] Dark Mode: halaman non-flagship mengandalkan remap CSS global + preferensi per-browser

- **Status:** open (tech debt ringan, by-design), **bukan bug** â€” hasil implementasi Dual Theme 2026-09-03.
- **Ditemukan:** 2026-09-03, saat implementasi Tema Hitam & Putih Admin Dashboard.
- **Konteks:** Varian `dark:` eksplisit hanya ditambahkan ke permukaan flagship
  (`Layout`, `Login`, `Overview`/`FinancialAnalytics` charts, `AppearancePanel`,
  `ThemeToggle`, `ToggleSwitch`, `UiFeedback`, `Pagination`). Seluruh ~50 halaman
  lain (CRM, katalog, reservasi, modal) menjadi readable di dark mode lewat blok
  remap `.dark` di `packages/admin-dashboard/src/index.css` yang memetakan
  utilitas hardcoded light (`bg-white`, `bg-[#f0f2f5]`, `text-[#111b21]`,
  `border-[#e9edef]`, badge pastel, `bg-[#efeae2]`â†’wallpaper `#0b141a`,
  `bg-[#d9fdd3]`â†’bubble `#005c4b`) ke palet WhatsApp Dark.
- **Limitasi yang diketahui:**
  1. Warna hardcoded eksotis di luar kamus remap (mis. `bg-blue-100`/`border-blue-100`
     di `CreateReservationModal.tsx:1784`) tetap tampil terang saat dark mode.
  2. Recharts `Tooltip` default (Pie di `FinancialAnalytics.tsx:569`) memakai style
     inline bawaan â€” sudah di-override via CSS `.recharts-default-tooltip`, tapi
     warna label formatter tertentu bisa kurang kontras.
  3. Preferensi tema disimpan di `localStorage` per-browser (`wa_clinic_theme`) â€”
     tidak sinkron antar perangkat dan bukan data bisnis (sengaja tidak tenant-aware / DB).
- **Pembaruan 2026-09-04:** kamus remap CSS global di `packages/admin-dashboard/src/index.css`
  telah diperluas mencakup input focus anti white-out (`focus:bg-white`â†’`#2a3942`),
  teks netral gelap (`text-slate-700/800/900`, `text-gray-700/800/900`,
  `text-[#374151]`/`text-[#4b5563]`/`text-[#64748b]`/`text-[#666]`), badge WhatsApp
  (`bg-[#d9fdd3] text-[#008069]`â†’teks `#e9edef` di atas `rgba(0,92,75,0.7)`),
  hover anti-silau (`hover:bg-[#f8fafc]`/`[#f5f6f6]`/`[#f0f4f7]`/`[#fafafa]`/
  `slate-50`/`gray-50`â†’`#2a3942`; `[#c2e7e0]`/`[#d0ece7]`â†’mint transparan),
  inverted tab/pill (`bg-[#e9edef]`â†’`#2a3942`) & sticky (`bg-[#fafafa]`/
  `[#fcfcfc]`/`[#f5f5f5]`â†’`#111b21`), palet pastel semantik (blue, purple, red),
  kartu kalender pastel (`bg-[#e0f2fe]`/`[#f3e8ff]`/`[#fef3c7]`/`[#dcfce7]` beserta
  teks & border terkait â†’ versi dark-transparan), dan divider kartu
  (`border-[#f0f2f5]`, `divide-[#f0f2f5]`, `border-[#cbd5e1]`/`slate-300`/`gray-300`/
  `[#e2ddd5]`â†’`#2a3942`/`#374248`).
- **Rencana Tindak Lanjut:**
  - Tambah entri remap `.dark` baru di `index.css` setiap kali warna eksotis ditemukan.
  - Migrasi bertahap halaman prioritas ke varian `dark:` eksplisit saat halaman disentuh refactor lain.

---

## 24. [CAPI] Gazetteer Zipcode Coverage Terbatas Surabaya & Sidoarjo (EMQ)

- **Status:** by-design (2026-09-07).
- **Ditemukan:** saat implementasi Integrasi Otomatis Data Gazetteer untuk Zipcode Meta CAPI.
- **Gejala:** Dataset `src/config/surabaya_sidoarjo_subdistricts.json` hanya memuat 573 entri kelurahan/desa SBY-SDA. Customer di luar 2 kota/kabupaten tersebut (mis. Gresik, Malang, Jakarta, atau alamat tanpa kec/kel yang dikenali) akan tetap `zipcode = NULL` dan event CAPI terkirim tanpa `zp` â€” EMQ tidak meningkat untuk segmen non-SBY/SDA. Kecamatan multi-zip (Wonokromo 60241-60246) memakai representatif tunggal (60243) sehingga presisi 100% hanya bila kelurahan ikut terdeteksi.
- **Mitigasi Saat Ini:** Resolver 3-layer (kel+ kec â†’ kec representatif â†’ free-text) + non-destruktif guard (tidak timpa zip existing) + backfill batch 200. CAPI & human enrichment sudah otomatis, log `[CAPI] zp enriched` memudahkan audit.
- **Rencana Tindak Lanjut (opsional, bila EMQ perlu >90%):** Perluas dataset Gazetteer ke kota/kabupaten tambahan atau fallback ke geocoding reverse `zipcode` dari Google `geocodeText` (sudah ada `resolved.zipcode`) bila tersedia; evaluasi cost/benefit postcode prefix table nasional.

---

## 25. [Test] `tests/integration/ad-click.test.ts` gagal pasca-decoupling CAPI dari konfirmasi reservasi

- **Status:** open (dampak disengaja dari kebijakan, bukan bug kode baru).
- **Ditemukan:** 2026-09-07, saat full `npm test` (2 file / 4 test gagal; 3 di antaranya di `ad-click.test.ts` bagian "Meta CAPI Event Integration").
- **Gejala:** Test `should fire Purchase (not Lead) event to CAPI Service on reservation confirmation`, `should also fire Purchase event with value...`, dan `should send Purchase without value when treatment is unknown` mengharapkan `capiService.sendCapiEvent({ eventName: 'Purchase', customData: { source: 'ADMIN_CONFIRM' } })` saat reservasi dikonfirmasi.
- **Akar masalah:** Commit `59f434c` ("pisahkan Tandai Lunas dari Meta CAPI") SENGAJA menghapus auto-trigger Purchase dari `PATCH /api/admin/reservation/:id/confirm` dan `PATCH /api/admin/reservation/:id` â€” Purchase kini eksklusif via Meta Purchase Queue (`POST /api/admin/reservation/:id/approve-purchase`). Test belum diselaraskan dengan kebijakan baru ini.
- **Rencana Tindak Lanjut:** Update `tests/integration/ad-click.test.ts` agar (a) menegaskan confirm TIDAK memicu `sendCapiEvent`, dan (b) menegaskan Purchase terkirim via `approve-purchase`. Tidak terkait perubahan extractor/invoice (test tersebut tidak mengimpor file dashboard mana pun).

---

## 26. [V3 Guardrail] Multi-Treatment Combo Pricing Arithmetic Ungrounded (TC-24, TC-25) â€” RESOLVED

- **Status:** ~~open~~ **RESOLVED** (Plan 6 FASE 1, 2026-09-12).
- **Fix:** `numeric-fact-validator.ts` kini mengotorisasi jumlah subset 2â€“3 layanan resmi turn konsultasi (Si+Sj, +Addon, +Ongkir, +keduanya, termasuk triple) dari `servicePromo/serviceOriginal` â€” pool unik Nâ‰¤6 (O(NÂ³)â‰¤216). Hanya di luar mode strict (keranjang â‰¥2 tetap mengunci total penuh + omission detector). Deviasi dari rencana awal (ekspansi skema tool `treatmentNames[]`): dipilih kombinatorik sisi-validator agar NOL perubahan kontrak tool; grounding tetap dari angka resmi turn + katalog. Test `multi-treatment-combo-validator.test.ts` (5).
- **Gejala asal (arsip):** kombo 2+ layanan ("Pijat pulih ceria plus sinar moksa totalnya berapa?", ditemukan 2026-09-08 via `numeric-hallucination-harness.ts`) â€” total cerdas LLM (mis. 70k+10k=80k) dituduh halusinasi dan diganti harga single treatment.

---

## 27. [V3 UX] Respon Permintaan "Pricelist Lengkap" Naratif vs Daftar Lengkap (TC-16)

- **Status:** open (backlog UX produk â€” sprint berikutnya).
- **Ditemukan:** 2026-09-08, saat closure eval harness V3.
- **Gejala:** Pada input umum tanpa keluhan seperti "Minta pricelist lengkap pijat bayi dong min", LLM merespon secara conversational dengan menyajikan 1-2 opsi terpopuler (Pijat Bayi Ceria Rp 60.000) alih-alih mendump seluruh puluhan variasi layanan dalam 1 bubble chat.
- **Rencana Tindak Lanjut (Sprint Berikutnya):**
  - Evaluasi bersama tim CS dan bisnis klinik: apakah customer WhatsApp lebih menyukai rekomendasi ringkas berfokus keluhan (pendekatan conversational), atau perlu mode tombol/link brosur PDF / daftar lengkap eksplisit jika intent minta pricelist terdeteksi.

---

## 28. [V3 Test Suite] Porting 4 File Skenario Fungsional Legacy V2 ke V3

- **Status:** open (test debt terjadwal â€” sprint berikutnya).
- **Ditemukan:** 2026-09-08, saat audit 39 file test legacy sebelum pembersihan V2.
- **Gejala:** 4 file test warisan V2 memuat skenario bisnis nyata yang sangat berharga namun masih mengimpor file `src/slot-engine/*` yang telah didekomisioning:
  1. `tests/unit/slot-engine-back-gesture.test.ts` (Customer berubah pikiran: ganti lokasi, batal treatment, tunda hari booking).
  2. `tests/unit/need-time-and-non-destructive-revoke.test.ts` (Customer "minta waktu berpikir / tanya suami dulu" tanpa membatalkan draft booking).
  3. `tests/regression/real-conversations.test.ts` (Konsultasi pasca-vaksin BCG/Polio & bayi 26 hari batuk pilek).
  4. `tests/unit/slot-engine-transcript-e2e.test.ts` (Replay transkrip percakapan utuh dari customer riil).
- **Keputusan:** Keempat file ini **DIPROTEKSI dari penghapusan** pada Phase 6.
- **Rencana Tindak Lanjut (Sprint Berikutnya):** Jadwalkan 1 sub-task khusus untuk me-refactor assertion keempat file tersebut agar memanggil `V3AgentRunner.processMessage` secara native, lalu hapus sisa file legacy setelah 100% lulus.

---

## 29. [RAG] In-memory fallback memakai substring `includes` sehingga token umum over-match + seed maternal induksi belum dijalankan di live DB

- **Status:** open sebagian (defensive fix sudah applied 2026-09-08; sisa: migrasi live + matcher presisi).
- **Ditemukan:** 2026-09-08, saat implementasi Dynamic Knowledge Grounding (kasus maternal 38 weeks + induksi + capek).
- **Gejala / detail:**
  - Fallback in-memory `knowledge.service.ts:searchRelevantChunks` memakai `text.includes(kw)` per token, sehingga token pendek/umum seperti "ada" ikut cocok via substring di kata "pada" (query nonsense "xyzqwerty topik tidak ada 999" sempat me-return 1 chunk). Relevansi FTS Postgres tidak terdampak; hanya jalur offline/test.
  - Kolom `keywords` (migrasi `20260907000000_add_knowledge_chunk_keywords`) + artikel "Panduan Usia Kehamilan untuk Pijat Induksi Alami" baru tersedia di seed lokal (`src/cli/seed-faq.ts`, `src/scripts/seed-maternal-induction-knowledge.ts`); live DB masih perlu `npx prisma migrate deploy` + `npx tsx src/scripts/seed-maternal-induction-knowledge.ts`. Kode kini defensif (retry FTS tanpa kolom `keywords` saat error 42703) sehingga live lama tetap jalan dengan degradasi tanpa sinonim keywords.
- **Rencana Tindak Lanjut:** (a) ganti matcher in-memory ke word-boundary/token-overlap scoring (seperti `treatmentStringParser`) bila relevansi offline jadi masalah; (b) jalankan migrasi + seed induksi di server live, verifikasi via `POST /api/admin/knowledge` / query "38 weeks induksi capek".
- **Update 2026-09-08 (post-deploy `b56864f`):** Live DB ternyata SUDAH punya kolom `keywords` (`migrate deploy` = no pending; 43 chunks, artikel induksi FTS-hit âœ“). Error P2022 kemarin berasal dari **DB lokal dev**, bukan live â€” jalankan `npx prisma migrate deploy` di lokal juga.

---

## 35. [V3 UX] Audit sesi 435731: over-questioning, halusinasi Waru, cart putus (2026-09-09)

- **Status:** implemented (kode + test); verifikasi simulator skenario 1/2/4
  (balasan LLM aktual) dan eksekusi skrip enrich ke live DB di luar
  jangkauan offline â€” butuh runs manual sesuai Verification Plan.
- **Konteks:** 14 balasan bot, 12 diakhiri pertanyaan, todong jadwal 6x
  (termasuk Turn 14 setelah jadwal Sabtu final + reservasi tercatat 2x);
  halusinasi "Kecamatan Waru ini cukup luas..." padahal customer di
  Kedungkendo-Candi; `cartItems` kehilangan `Pijat Bayi Ceria` (Rp 60rb)
  karena nama resmi `Pijat Bayi Ceria (Rileksasi)` gagal exact-match.
- **Yang dilakukan:**
  1. `goal-tracker.ts` (`syncCartItems`): normalisasi nama katalog tanpa
     regex (buang `(...)` akhir via operasi string) â€” cocok utuh ATAU bersih;
     HANYA full-match yang menekan fuzzy; kandidat fuzzy wajib bawa â‰¥2 token
     signifikan yang belum dijelaskan exact-hit (anti-kompetisi
     Ceria-vs-Pulih; "pulih ceria" tetap lolos mendampingi "sinar moksa").
  2. `persona.ts`: hapus "Closing CTA WAJIB" (baris 189/196) â†’ panduan
     statement-only untuk pertanyaan teknis; contoh durasi tanpa todong
     jadwal; Waru ditegaskan basecamp (aturan 3 + constraint #11);
     larangan tanya hari bila jadwal sudah final (aturan 6).
  3. `conversation-summarizer.ts`: guard `booking.preferredDate/reservationId`
     â†’ larangan eksplisit tanya hari lagi; cooldown jadwal tetap aktif walau
     ada sebutan hari bila jadwal sudah final.
  4. Komponen 3 (gate alamat longgar) & 4 (keyword enrichment + live 48/48
     chunks + 25/25 exemplars): SUDAH ada dari sesi sebelumnya (lihat #34);
     diverifikasi tetap hijau (kontrak test + spot-check resolver).
- **Sisa / limitasi yang diketahui:**
  1. Aturan fuzzy â‰¥2-token: pesan yang menyebut exact-clean + 1 token lepas
     layanan lain (mis. exact "Ceria" + kata "pulih" tanpa "ceria") TIDAK
     menambah item kedua â€” by-design (mencegah phantom); user bisa sebut
     nama lebih lengkap.
  2. `live-chat-reply.test.ts` (suggest-reply) gagal timeout 5 dtk SEKALI
     saat full-suite load; lolos solo (10/10). Flaky LLM-timing, tak terkait
     perubahan ini (mirip pola isolasi #22).

## 34. [V3 Retrieval] Keyword enrichment KB & bank chat + hapus penodongan alamat (2026-09-09)

- **Status:** resolved (kode + data live termigrasi).
- **Konteks:** 44/48 `knowledge_chunks.keywords` NULL + FTS 'simple' tanpa stemming
  (`persiapan` â‰  `disiapkan`) membuat artikel yang ADA gagal ter-retrieve; bot
  menodong nama/alamat ("bolehkah kami tahu nama Bunda dan alamat lengkap...")
  padahal lokasi wilayah sudah ada â€” atas arahan user, penodongan dihapus
  (form reservasi + Admin yang menangani kelengkapan titik).
- **Yang dilakukan:**
  1. `src/services/keyword-enrichment.service.ts` (single source of truth) +
     `scripts/enrich-kb-and-bank-chat-keywords.ts` (`--tenant`, `--dry-run`):
     live 48/48 chunks + 25/25 exemplars ter-update, 0 tak cocok. Verifikasi FTS:
     "persiapan sebelum pijat induksi" â†’ chunk persiapan + induksi;
     "apa yang perlu disiapkan" â†’ 2 chunk persiapan; "bayar pake apa" â†’ 3 chunk pembayaran.
  2. `src/cli/seed-faq.ts` mengisi keywords otomatis via resolver (seed ulang aman).
  3. Tags in-memory (7 default + gold) sinkron dengan kurasi (kontrak test).
  4. Persona aturan 21 + panduan `save_reservation` baru: konfirmasi cek jadwal
     tanpa todong nama/alamat/shareloc, tanpa sebut "Admin CS" (termasuk
     string LLM-visible di clinic-faq/escalate-human + 4 respons exemplar).
  5. Gate `save_reservation` tidak lagi menolak booking; selalu simpan pending +
     konfirmasi cek jadwal. `booking.isConfirmed` kini false (state RESERVATION_SENT).
- **Sisa:** seed maternal-prep (`scripts/seed-maternal-prep-faq.ts`) tetap perlu
  dijalankan per tenant bila artikelnya belum ada; util `hasStreetDetail` /
  `isGenericCustomerName` dipertahankan sebagai util non-pemblokir.

---

## 33. [V3 Reservasi] Sisa tech-debt audit homecare Agent V3 (2026-09-09)

- **Status:** open (tech debt ringan, by-design â€” fungsi inti live & teruji).
- **Konteks:** Perbaikan fondasional audit sesi 567292 (kategori MOMS, anti-collision
  keranjang, purchaseValue, validation gate, aturan jam, normalisasi `**`, seed FAQ persiapan).
- **Sisa yang diketahui:**
  1. `resolveTreatmentCategory` memakai fallback `includes` dua arah bila nama tidak
     persis sama â€” untuk nama layanan yang sangat pendek/umum bisa salah pasang.
     Mitigasi: kecocokan exact diprioritaskan; fallback entity pasien terstruktur.
  2. Validation gate aktif hanya bila `conversationId` tersedia (jalur agent).
     Pemanggilan langsung `executeSaveReservation` tanpa session (test, skrip) tetap
     berperilaku lama â€” by design agar kompatibel mundur.
  3. Gate alamat memakai daftar penanda `STREET_DETAIL_MARKERS` (data-driven
     includes). Alamat tanpa penanda umum namun valid (mis. "Kedungkendo 12" tanpa
     kata jalan â€” tercakup via digit check; murni nama dusun tanpa nomor akan
     diminta dilengkapi, sesuai SOP homecare).
  4. Seed `scripts/seed-maternal-prep-faq.ts` perlu dijalankan per tenant live
     (`npx tsx scripts/seed-maternal-prep-faq.ts`) agar artikel persiapan tersedia
     di FTS â€” kode bertahan tanpa artikel (fallback grounding katalog).
- **Rencana Tindak Lanjut:** perluas sinonim/alias katalog bila nama layanan baru
  bermunculan; jalankan seed maternal di live; verifikasi manual 5 input sesuai
  Verification Plan (total Rp 130.000 Kedungkendo, gate "boleh bund").

---

## 32. [V3 Fondasional] Deviasi Pilar 6 & sisa regex teritorial geocoding (2026-09-09)

- **Status:** open/by-design (keputusan arsitektur tercatat, bukan bug).
- **Konteks:** Master Plan Pilar 6 memerintahkan DELETE `sanitizeHallucinatedTerms`,
  `sanitizeStrayBackslashes`, `sanitizeDoubleQuestions` (language-sanitizer.ts) serta
  `stripEnglishLeakage`/`sanitizeFirstPersonPronoun` (sanitizer.ts), dan memindah
  `sanitizeEmDash`.
- **Temuan audit (mengapa TIDAK dihapus):**
  1. Keempat fungsi language-sanitizer dicakup aktif oleh
     `tests/unit/language-sanitizer.test.ts`, `language-sanitizer-fixes.test.ts`, dan
     `lead-greeting-preservation.test.ts`; `sanitizeEmDash` diimpor produksi oleh
     `src/utils/whatsapp-format.ts`. Audit `src/` membuktikan tidak satu pun fungsi
     tersebut terpasang di jalur outbound V3 (agent-runner hanya memakai
     `OutputSanitizer` + `normalizeWhatsAppFormat`) â€” penghapusan mematahkan test
     tanpa manfaat runtime.
  2. Kedua method sanitizer.ts dicakup `tests/unit/v3-persona-rules.test.ts` dan sudah
     dikeluarkan dari pipeline `cleanOutboundReply` sebelumnya.
- **Yang dilakukan (varian aman):** ekspor dipertahankan; fungsi yang tidak terpasang
  ditandai `@deprecated` eksplisit + catatan modul; `sanitizeEmDash` dinyatakan tetap
  aktif via `normalizeWhatsAppFormat`. Kendali perilaku LLM tetap di level
  Prompt/Grounding/Few-Shot sesuai mandat AGENTS.md.
- **Sisa regex teritorial:** `src/integrations/google-maps/geocoding.ts:103`
  (`hasExplicitOutsideCity`, bias Surabaya/Sidoarjo) dan beberapa pola teknis
  (`hasSpecificStreetOrEstate`, dx `escapeRegex` gazetteer) sengaja TIDAK diubah â€”
  di luar scope Pilar 5 (hanya `calculate-delivery.tool.ts`) dan terikat perilaku
  Territory-biased geocoding yang diuji test perbatasan. Penghapusan butuh proyek
  geocoding tersendiri dengan evaluasi live.
- **Rencana Tindak Lanjut:** hapus ekspor mati hanya bila (a) test yang mencakupnya
  dihapus/dipindah lebih dulu, dan (b) tidak ada impor produksi; audit ulang saat
  refactor geocoding.

---

## 31. [V3 Domain] Sisa tech-debt Multi-Audience & Hybrid RAG (Agent V3, 2026-09-09)

- **Status:** open (tech debt ringan, by-design â€” fungsi inti sudah live).
- **Ditemukan:** 2026-09-09, saat redesign Multi-Audience Patient Domain & Hybrid RAG Grounding.
- **Yang sudah fixed:** `uk 38 weeks` tidak lagi bocor ke `childProfile.ageMonths`; `momProfile`/`targetAudience` first-class; pre-retrieval FTS deterministik + katalog terdaftar di `retrievedChunks`; Inspector `AiSandbox` adaptif (ðŸ¤°/ðŸ‘¶).
- **Sisa yang diketahui:**
  1. `syncChildrenProfiles` masih memakai regex usia warisan (`/(\d+...)\s*(bulan|bln|tahun|thn|th)/`) â€” dipertahankan untuk backward-compat; parser maternal baru (`parseGestationalWeeks`) sudah tanpa regex semantik. Guard `isMaternalOnlyMessage` mencegah kontaminasi silang.
  2. Sugesti summarizer untuk keluhan ibu generik (mis. "capek") memakai kandidat MOMS pertama bila skor semantik 0 â€” bukan halusinasi, tapi belum sepresisi skor gejala anak. Perlu perluasan sinonim katalog MOMS bila keluhan ibu bertambah.
  3. Pre-retrieval hanya berjalan untuk pesan substantif (`isSubstantiveForPreGrounding`); artikel induksi harus ada di live DB (47 chunks) agar Inspector terisi â€” jalankan seed maternal bila chunk belum ada.
- **Rencana Tindak Lanjut:** (a) migrasi parser usia anak ke tokenizer tanpa regex saat refactor berikutnya; (b) tambah sinonim MOMS (`capekâ†’relaksasi/oksitosin`) di `treatment-catalog.service`; (c) verifikasi manual Sandbox Turn 1/2 sesuai Verification Plan proposal.

---

## 30. [Migrations] Live `tenants.settings` tidak ada di DB (P2022 di log app) â€” IMPLEMENTED (verifikasi deploy menunggu)

- **Status:** ~~open~~ **implemented** (Plan 6 FASE 4, 2026-09-12) â€” verifikasi live (`migrate deploy` + `migrate diff --from-url` empty) menunggu jendela deploy.
- **Fix kode:** helper terpusat `isMissingColumnError()` (`src/utils/prisma-errors.ts`, pola mengikuti `isMissingKeywordsColumnError`); pembaca `tenants.settings` (`brand.ts getBrandIdentityAsync`, `tenant-prompt-config.service.ts`) kembali ke default SENYAP saat P2022/42703, tetap warn untuk error lain (menghentikan banjir log). Cakupan sadar: puluhan `prisma.tenant.*` full-row lain (capi, alert, daily-report) SENGAJA tak diubah massal â€” test menegaskan argumen panggilan eksak (catatan mitigasi 2026-09-09 tetap berlaku).
- **Fix skema:** migrasi idempoten baru `20260912000000_ensure_tenants_settings_column` (`DO $$ IF NOT EXISTS ... ADD COLUMN settings JSONB DEFAULT '{}'`) â€” aman di DB yang sudah punya kolom maupun yang belum.
- **Test:** `tenant-settings-resilience.test.ts` (3): P2022 â†’ default/null tanpa throw.
- **Konteks asal (arsip):** log live pasca-deploy `b56864f` berulang `The column tenants.settings does not exist`; alur pesan tetap jalan (ter-catch). Dugaan drift baseline seperti #1. Penyembuh cepat per-DB: `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS settings JSONB;`.
- **Mitigasi 2026-09-09 (tetap berlaku):** query terpanas (`reservations.subroute.ts`, CAPI queue) memakai `select` eksplisit sehingga tak memicu P2022 apa pun status kolom.

---

## 33. [Reservasi] Redesain Fondasional Lifecycle & Integritas Transaksi (2026-09-09)

- **Status:** implemented (2026-09-09); sisa: eksekusi SQL live menunggu verifikasi 2-langkah + 2 kegagalan test pre-existing.
- **Konteks:** audit 6 titik mutasi (`reservations.subroute.ts`, `reservation-lifecycle.service.ts`, `machine.ts`, `webhook.route.ts`, `save-reservation.tool.ts`, `conversation-transaction-extractor.ts`) menemukan 5 akar masalah: fragmentasi domain mutasi, tanpa validasi konflik jadwal, dedup naif berbasis `created_at`, parser keuangan global + heuristik `num<=500 â†’ *1000` (korupsi `Usia >4-6 th` â†’ 46000), dan penimpaan buta `purchase_value` resmi oleh parser.
- **Yang sudah dikerjakan:**
  1. `src/services/reservation-core.service.ts` (baru, kanonis): Customer Conflict Guard + Staff Collision Guard (overlap interval + buffer 20 mnt), channel-aware (`ADMIN_PANEL` â†’ 409 kecuali `force:true`; `BOT/WEBHOOK/AGENT` â†’ idempotent merge + auto-consolidate duplikat ke `cancelled`), lifecycle terstandarisasi (children, follow-up bila `confirmed`).
  2. `conversation-transaction-extractor.ts`: isolasi blok pembayaran (cari SETELAH `Payment:/Pembayaran:/Rincian Biaya/Tagihan`), filter token non-mata-uang (`th/tahun/usia/...` tanpa `rp/rb/k` â†’ 0), hapus pelipatgandaan `<=500`, invarian `Total == Treatment + Ongkir - Promo` + auto-rekonsiliasi.
  3. `purchase-detection.service.ts`: pencocokan `booking_date` dari teks (fallback `created_at desc`) + downside guard (nilai baru < nilai resmi â†’ pertahankan resmi).
  4. `CreateReservationModal.tsx`: banner pre-flight + dialog 409 `[Batal & Buka Existing | Tetap Simpan (Force)]` (tanpa `window.confirm/alert`, via state React).
  5. `upsertReservationForm` dipertahankan sebagai wrapper deprecated â†’ delegasi ke core (4 situs webhook + test lama tetap jalan).
- **Sisa / limitasi yang diketahui:**
  1. Pembersihan data live Bunda Bella (cancel `7a6e494aâ€¦`, restore `bbbde4bdâ€¦` â†’ 160000) BELUM dieksekusi â€” user menyetujui eksekusi, tetapi gate server mewajibkan verifikasi 2-langkah; script siap di `scripts/cleanup-bunda-bella-duplicates.sql` (jalankan via SSH ke Postgres live, lalu verifikasi SELECT).
  2. Conflict guard fail-open saat lookup DB gagal (dianggap tak ada konflik; kegagalan tulis ditangani fallback memory pemanggil) â€” by-design agar offline-fallback admin tetap jalan; di produksi read-fail hampir selalu diikuti write-fail sehingga risiko duplikat lolos minimal.
  3. `extractRupiahAmount` (purchase-detection) TIDAK diubah â€” masih mengambil nominal terbesar pola umum; korupsi angka dilindungi downside guard + parser yang sudah diperbaiki.
  4. Test lama `conversation-transaction-extractor.test.ts` bagian `parseCurrencyValue('70') â†’ 70000` SENGAJA diubah ke `0` (perilaku lama adalah akar korupsi; kasus `Total = 100 + 70 + â€¦` tetap lolos via invarian rekonsiliasi).
- **Kegagalan test pre-existing (terverifikasi di baseline via `git stash`, bukan dari redesign):**
  - `tests/integration/live-chat-reply.test.ts` â†’ `suggest-reply menghasilkan draf saran AI`.
  - `tests/integration/robustness.test.ts` â†’ `5-Minute Passive Confirmation Timeout`.
- **Verifikasi redesign:** `npm run build` bersih; `tsc --noEmit` dashboard bersih; 7 file test reservasi 52+19+16 tes hijau; full suite 1551 passed / 2 failed (pre-existing di atas).

---

## 36. [Pasien] Redesain Fondasional Klasifikasi Lifecycle & Active Appointment Guard (insiden Bunda Retno, 2026-09-09)

- **Status:** implemented + deployed live (2026-09-09 13:09 WIB); runbook Retno DIEKSEKUSI (`cancelled`, terverifikasi).
- **Konteks:** bot AI membalas pasien lama (treatment pertama `completed` 29 Agu) dan pasien berjadwal aktif H-0 ("Sdh smp mana ya?") dengan template marketing generik. Akar: gate hanya cek `confirmed`; properti hantu `purchase_count` / `status='repeat'` (tidak pernah ditulis production); tanpa guard jadwal aktif; label `repeat` hanya hitung `confirmed`; test lama mem-passing mock fiktif.
- **Yang sudah dikerjakan:**
  1. `src/services/patient-lifecycle.service.ts` (baru, kanonis): `hasTreatmentHistory` (`confirmed`/`completed`, fallback `ltv_cache`), `getActiveAppointment` (`pending`/`confirmed`/`hold`, jendela [now-12 jam, now+24 jam]), `getPatientClinicalProfile`. Tenant-aware, best-effort (DB gagal â†’ default aman).
  2. `ai-eligibility.service.ts`: kontrak valid (`has_treatment_history`, `has_active_appointment`, `ltv_cache`; `has_confirmed_reservation` deprecated-alias); properti hantu DIHAPUS; reason baru `ACTIVE_APPOINTMENT_MANUAL` (guard wajib tanpa toggle, di bawah FORCE_*).
  3. `ai-scope-gate.service.ts`: baca profil kanonis (flag eksplisit OR DB OR ltv; tanpa fallback `status='repeat'`); pesan eskalasi operasional baru. `conversation.service.ts`: `ACTIVE_APPOINTMENT_MANUAL` exempt dari auto-release 6 jam.
  4. `reservation-lifecycle` (label `repeat`), `label-reconciliation`, `machine.ts` (`hasPriorConfirmed`), `cron` (review H+1): `confirmed` â†’ `in ['confirmed','completed']`.
  5. Test ditulis ulang tanpa mock fiktif (`legacy-and-repeat-bypass.test.ts`) + `patient-lifecycle.test.ts` baru (10) + simulasi Retno (DB `completed` â†’ silence `EXISTING_PATIENT_MANUAL`; jadwal aktif â†’ silence `ACTIVE_APPOINTMENT_MANUAL`).
- **Sisa / limitasi yang diketahui:**
  1. Runbook `scripts/cleanup-bunda-retno-reservation.sql` DIEKSEKUSI 2026-09-09 13:09 WIB (BLOK 1 cancel, `UPDATE 1`, verifikasi `cancelled`). State akhir Retno: 1 `completed` (riwayat 29 Agu, guard aktif) + 1 `cancelled` (jadwal AI 9 Sept). Deploy: commit `5c0f06f` push master â†’ live pull + rebuild app (WAHA tak tersentuh, up 3 minggu); app boot bersih, full suite lokal 201 file / 1618 passed / 0 failed.
  2. `status === 'legacy'` dipertahankan sebagai sinyal legacy (konvensi riil `migration.service.ts`), berdampingan dengan kolom `is_legacy_source`.
  3. Lookup jadwal aktif fail-open saat DB down (tidak silence); fail-closed tetap dijaga langkah scope (`NEW_ONLY` + cutoff) di resolver.
- **Verifikasi:** `tsc --noEmit` bersih; full suite **201 file, 1618 passed, 0 failed**.

---

## 38. [GPS] Redesign fondasional parsing pin, klaster hierarki & sticky GPS (kasus Valencia Retno, 2026-09-09)

- **Status:** implemented (2026-09-09); verifikasi ORS live 10.92 km + survei koordinat klaster non-PSJ di luar jangkauan offline.
- **Konteks:** alamat "Valencia spring puri surya jaya DD 3 no.28" terhitung 8.5 km (gerbang depan) padahal titik klaster ~10.7â€“10.9 km rute ORS. Akar: 1 titik/coarse per mega-estate; payload Baileys (`_data.message.locationMessage.degreesLatitude`) tak terbaca â†’ NaN; `share.google` tak terekstrak; flag `share_location_sent` tak pernah menyala sehingga guard sticky tak bekerja.
- **Yang sudah dikerjakan:**
  1. `src/utils/waha-location-parser.ts` (baru, murni/testable): `_data/message.locationMessage` + `liveLocationMessage` (`latitude`/`degreesLatitude`), 0,0 dibuang, tipe-tanpa-koordinat â†’ false (anti bocor NaN). `webhook.route.ts:643-654` didelegasikan (downstream `incomingMessage.location` + `enrichSync` tak berubah).
  2. `google-maps-url-resolver.ts`: regex + `share.google` (redirect follow generik sudah ada, tanpa kode tambahan).
  3. `landmarks.ts`: 3 entri klaster PSJ (Valencia/Sydney-Boston/Osaka-Vancouver, koordinat terverifikasi rencana) SEBELUM gerbang utama (first-match-wins = cluster-first). E2E offline: `geocodeText("Valencia springâ€¦")` â†’ presisi, (-7.393858, 112.745941, Punggul/Gedangan); Haversine lurus 5.04 km (vs gerbang 4.44 km, arah benar); 10.92 km â†’ Tier 11â€“15 (normal 25000, promo 15000).
  4. Sticky invariant: SUDAH ada & terverifikasi (`updateCustomerLocation` + memory fallback + skip teks di enrich 295/411); override admin via jalur tulis dashboard langsung (bypass service, tak terblokir guard). Test `sticky-gps` 4/4.
- **Sisa / limitasi yang diketahui:**
  1. Klaster CitraHarmoni / Kahuripan Nirwana / CitraLand (Riverside, Stamford, Babatan, North West, â€¦) SENGAJA belum ditambah â€” koordinat titik dalam belum tersurvei; dilarang memfabrikasi. Butuh survei/pin GPS per klaster, lalu tambah entri (mekanisme cluster-first sudah siap).
  2. Angka ORS 10.92 km dari audit (live); ekuivalen offline = Haversine 5.04 km Ã— 1.6 â‰ˆ 8.06 km (estimasi). Verifikasi tarif live 10.92 km â†’ Tier 15/25k/15k perlu konfirmasi sekali via ORS saat ada API key.
- **Verifikasi:** test baru `waha-location-parser` (9) + `cluster-geocoding` (7) + `sticky-gps` (4) + 2 share.google hijau; full suite **204 file, 1640 passed, 0 failed**; `npm run build` bersih.

## 37. [Pasien] Audit live: pola Retno di customer lain (2026-09-09 13:15 WIB / 05:15 UTC)

- **Status:** audit read-only selesai; tindakan data menunggu keputusan operasional.
- **Cakupan:** 638 customer; 310 `completed`, 13 `pending`, 1 `cancelled` (Retno, dieksekusi sesi ini).
- **Temuan (existing-patient + pending, pola Retno):**
  1. **Bunda Bella (628967037xxxx)** â€” KOMBO duplikat + nilai korup, slot 09:30 WIB hari ini (sudah lewat, keduanya masih `pending`): `bbbde4bd` = 46000 (tertulis dari teks bot "Selamat Malam bunda Bella!..." â†’ signature overwrite buta `maybeFirePurchaseEvent` pra-fix, relasi 2 anak) vs `7a6e494a` = 160000 (`[Admin Manual]`, tanpa anak). Rencana approved sebelumnya (cancel `7a6e49â€¦`, restore `bbbdâ€¦`â†’160000) BELUM pernah dieksekusi. Perlu keputusan: batalkan salah satu + status baris kept (completed bila treatment tadi pagi terjadi / tetap pending / cancel).
  2. **Bunda Devia (628585016xxxx, histori 12)** â€” 2 pending Newborn (`[Admin Manual]`, dibuat selisih 2 menit): booking kemarin 08:00 WIB (overdue) + hari ini 08:00 WIB (overdue). Dugaan double-entry admin. Rekomendasi: cancel baris kemarin, konfirmasi status baris hari ini ke CS.
  3. **Bunda Fitria Wonokromo (62856356xxxx, histori 2)** â€” 2 pending 13 Sept: 09:00 WIB form customer (165k) + 13:00 WIB admin (180k), detail berbeda. Belum jelas duplikat vs 2 sesi sah. Rekomendasi: klarifikasi CS dulu, JANGAN eksekusi buta.
- **Normal (tanpa tindakan):** 7 pending milik new-lead (tanpa riwayat) â€” booking sah; 1 upcoming aktif hari ini (Agnes 13:30 WIB, guard kini melindungi); Retno bersih (1 completed + 1 cancelled).
- **Kronologi eksekusi Bella + admin konkuren (UTC, 2026-09-09, dari `audit_logs`):**
  - 04:12 admin `REJECT_PURCHASE_OUTLIER` pada `7a6e49â€¦` (duplikat yatim Bella).
  - ~05:2x sesi ini: `UPDATE 1` â€” `7a6e49â€¦` â†’ `cancelled` (sesuai rencana approved).
  - 05:36:49 admin `DELETE_RESERVATION_PERMANENT` pada `a0c5e10câ€¦` (reservasi AI Retno â€” admin memilih hapus permanen, lebih kuat dari cancel sesi ini; state Retno akhir: hanya riwayat `completed`, bersih).
  - 05:39:50 admin `DELETE_RESERVATION_PERMANENT` pada `bbbde4bdâ€¦` (baris korup 46000 Bella) â€” terjadi SESAAT setelah audit read-only sesi ini, menjelaskan `UPDATE 0` + baris hilang saat verifikasi. BUKAN error skrip.
  - 05:40:31/45 admin `CONFIRM` â†’ `COMPLETE` pada `f37579â€¦` (Newborn Devia hari ini â€” treatment terjadi; rencana cancel Devia BATAL relevansinya untuk baris ini).
  - Dampak relasi: `children.reservation_id` = `SetNull` â€” Arhan/Ardhan tetap ada (NULL), tidak ikut terhapus. Tidak ada tabrakan tulis (UPDATE kondisional sesi ini hanya menyentuh baris yatim yang memang ditargetkan).
- **Pelajaran operasional:** dashboard admin aktif konkuren saat runbook dieksekusi â€” untuk runbook berikutnya, kunci dulu pembagian tugas (siapa mengeksekusi apa) atau bekukan edit dashboard selama jendela eksekusi.

---

## 38. [Tests] `production_edge_cases.test.ts` #28 flaky pada full-suite run (mock WAHA hold-label bocor antar file)

- **Status:** ~~open~~ **RESOLVED** (Plan 5 â€” WAHA Label Ban Enforcement, 2026-09-12)
- **Resolusi:** `wahaClient.addLabel`/`removeLabel` di seluruh kode bisnis production telah dihapus total (mandat mutlak). Invariant guard test `tests/unit/v3/waha-label-ban-invariant.test.ts` dipasang untuk mencegah regresi.
- **Root cause ganda yang ditemukan saat resolusi:**
  1. `wahaClient.addLabel/removeLabel` memiliki efek samping tersembunyi `syncLabelColumn()` yang menulis `Customer.is_hold_labeled/is_admin_labeled`. Path eskalasi & auto-release bergantung pada efek samping ini â€” penghapusan call WAHA sempat memutus penulisan flag. Diperbaiki fondasional: `escalateToHumanHandling` kini menulis `is_hold_labeled=true` langsung via `customerService.setLabelFlags` (guard `!isSandbox && !isGlobalDisabled` dipertahankan), dan `checkAndApplyAutoRelease` meng-clear flag fire-and-forget. DB kini single source of truth.
  2. Flakiness #28 kemungkinan BUKAN (hanya) mock leakage: nomor test `628999+6digit` memiliki peluang ~1/9 menjadi `6289999xxxxx` yang terdeteksi dummy/sandbox oleh `isDummyOrTestContact` (regex `^6289999`), sehingga eskalasi melewati penulisan flag dan assertion gagal. Test ditulis ulang berbasis flag DB dengan prefix aman `6287772+timestamp` (deterministik non-dummy).
- **Gejala:** `28. should auto-resume bot handling when webhook receives message and hold label is missing from WAHA` gagal dengan `expected [] to include 'hold'` (getChatLabels mock mengembalikan kosong) HANYA pada `npm test` full-suite; lolos konsisten bila file dijalankan sendiri (`npx vitest run tests/unit/production_edge_cases.test.ts` â†’ 12 passed).
- **Bukti flaky, bukan regresi:** (1) file yang gagal (`production_edge_cases`, domain WAHA hold-label) tidak tersentuh perubahan (yang diubah: `get-catalog.tool.ts`, `agent-runner.ts`, `goal-tracker.ts`, `conversation-summarizer.ts` + test katalog); (2) pada full-run pertama di sesi yang sama test ini LOLOS, pada full-run kedua GAGAL â€” dengan delta kode di antaranya (`inquirePrice: true` di `agent-tools.test.ts`) yang mustahil memengaruhi mock WAHA labels; (3) pola klasik kebocoran state mock antar file test pada run paralel/berurutan.
- **Workaround:** jalankan file tersebut tersendiri untuk verifikasi; abaikan 1 failure ini pada full-suite bila hanya test ini yang merah.
- **Fix yang disarankan (proyek terpisah):** isolasi mock WAHA client per-file (`vi.resetAllMocks` / factory mock scoped) atau tandai test #28 sebagai serial (`describe.sequential`) agar tidak tergantung urutan eksekusi file lain.

---

## 39. [V3] Multi-lapisan fondasional sesi 214956/222655: disambiguasi multi-anak, integritas matematika, anti-brosur (2026-09-10)

- **Status:** implemented (kode + test, 2026-09-10); seed FAQ live + penonaktifan baris `clinic_services` live MENUNGGU eksekusi gated (backup dulu).
- **Konteks:** (1) AI menebak 1-vs-2 anak sepihak (17 bln lalu 2 thn); (2) halusinasi aritmatika 75k+105k+15k=120k lolos whitelist; (3) rekomendasi usia format brosur bernomor tanpa pemantik klinis; (4) saran pijat langsung pasca-imunisasi (RAG salah.)
- **Temuan audit pra-koding (deviasi dari draf rencana):** `extractChildrenState` TIDAK ADA (jalur riil: `syncChildrenProfiles` + alokasi slot kedua sudah ada); total resmi SUDAH disuntik di grounding; tool katalog SUDAH anti-brosur; artikel vaksin + keywords SUDAH di `seed-faq.ts`; persona SUDAH punya aturan 10b + pengecualian vaksin; duplikat kids generik mencakup file + code default + DB live + test yang mengassert-nya. Semua diadaptasi, bukan diabaikan.
- **Yang sudah dikerjakan:**
  1. `goal-tracker.ts`: flag `isMultiChildUnconfirmed`, `extractAgesMonths` bersama, `isExplicitChildCountSignal`, `detectUnconfirmedMultiChild`, injeksi `[MANDAT KLARIFIKASI JUMLAH ANAK]` dinamis, `[MANDAT INTEGRITAS MATEMATIKA]` total resmi + rincian; latch di `agent-runner.ts` (naik saat usia-2-tanpa-sinyal, turun HANYA oleh sinyal eksplisit); aturan persona DETEKSI MULTI-ANAK.
  2. `numeric-fact-validator.ts`: mode strict multi-item (parsial sp+op DITOLAK bila cart â‰¥2), pesan pelanggaran menyebut total resmi + `expectedTotals`; `agent-runner.ts`: re-prompt bersih 1x (`attemptNumericReprompt`, tereskpos untuk test) lalu fallback swap template (prioritas `cartTotalReply`); `get-catalog.tool.ts`: `cartTotalReply` multi-item dihitung mesin + wiring `cartSnapshot` via `tool-registry.ts`. TANPA regex replace teks (pelanggaran hanya dilaporkan).
  3. Template tool + persona A.1: narasi 1 paragraf + pemantik klinis; `kids-massage-ceria` generik DINONAKTIFKAN (`isActive:false` di `services_custom.json` + code default; test usia-30-bln dialihkan ke `kids-massage-2-4th`).
  4. Vaksin: tidak ada perubahan kode dibutuhkan (aturan 10b + seed artikel + test `vaccine-safety` sudah hijau); seed live destruktif (`deleteMany`) DITUNDA ke langkah gated.
- **Eksekusi live 2026-09-10 14:04â€“14:07 WIB (SSH, approved):**
  - Backup `knowledge_chunks_backup_20260910` (43 baris) â€” rollback: `DELETE FROM knowledge_chunks; INSERT INTO knowledge_chunks SELECT * FROM knowledge_chunks_backup_20260910;`
  - Temuan pra-eksekusi: live 43 baris (12 ber-keywords; artikel vaksin ADA 2 baris tapi tipis; baris kurasi admin ada â†’ full seed `deleteMany` DITOLAK sebagai terlalu destruktif).
  - Backfill bedah 43 UPDATE kondisional (`keywords IS NULL`) + 13 UPDATE union (seed-eksplisit + rule + existing; baris terisi tak tersentuh) â€” hasil: 43/43 ber-keywords.
  - `clinic_services.kids-massage-ceria` â†’ `is_active=false` (`UPDATE 1`).
  - Verifikasi FTS persis query service (`websearch_to_tsquery`, judul+keywords+konten): "habis imunisasi boleh pijat" â†’ artikel vaksin âœ“ (bukan mandi).
- **Sisa / limitasi yang diketahui:**
  1. Kode sesi ini BELUM di-deploy (live masih 18d1f33) â€” perbaikan data di atas bekerja mandiri; deploy ikut gate server-update terpisah.
  2. Seed file punya 4 set keywords eksplisit; 1 artikel seed ("terapis/bidan sama atau berbeda") TIDAK ADA di live (insert aman, non-destruktif) â€” follow-up.
  3. Frasa konfirmasi "1 anak" ("cuma 1 anak") membersihkan latch TANPA meruntuhkan slot anak kedua â€” disengaja (non-destruktif); CS/admin resolvasi final di booking.
- **Verifikasi:** build `tsc` bersih; test baru 3 file (disambiguasi 10, cross-sum 6, anti-brosur 4) + regresi terkait hijau; full suite **222 file, 1756 passed, 0 failed**.

---

## 40. [V3] Bot menjawab pertanyaan lowongan kerja dengan jawaban jadwal bidan + buta isi gambar (kasus 628968165xxxx, 2026-09-11)

- **Status:** implemented (2026-09-11, plan v2 â€” mekanisme fondasional; BUKAN tambal per-kasus).
- **Kronologi live (fakta DB + log + WAHA store, read-only via SSH):** customer Rizki Dwi S kirim 3x foto flyer loker + caption ("Pagi kak mau tanya lokernya masih tersedia ?", 00:19/00:22/00:24 UTC). Bot menjawab di luar domain â€” preview log: "Halo Bapak! âœ¨ Terima kasih sudah menghubungi..." lalu 2x "Bapak, mohon maaf untuk hari ini jadwal Bidan..." (completion 97/40/41 token, `retrievedChunks` 2-3, `toolCount` 0). `admin@kalamomsspa.com` menarik ketiga balasan via Live Chat (`REVOKE_MESSAGE` 00:28:33â€“39 UTC), `manual_takeover` 00:29:43 + balasan manual berisi link Google Form rekrutmen; customer mengisi form 00:36. Teks lengkap balasan bot tak terpulihkan (DB ditimpa placeholder oleh `markMessageDeleted`, WAHA store terprune).
- **Akar masalah (multi-layer):**
  1. **Retrieval:** `knowledge_chunks` live 0 artikel rekrutmen; pre-retrieval grounding (`agent-runner.ts:826-858`) tidak punya cabang grounding-miss â€” kekosongan dianggap tetap jawab dari prior.
  2. **Domain:** tak ada konsep batas-domain; `entity-extractor.service.ts:469-484` + `persona.ts:64` diam untuk kalimat ini, LLM menebak `ask_schedule` dari pola "â€¦tersedia"; `escalate_to_human` (`persona.ts:366-367`) tidak mencakup topik non-klinis; `ask_unlisted_service` nol hit di `agent-runner.ts`.
  3. **Vision:** `src/v3/` nol referensi media/gambar; V3 hanya menerima caption (`machine.ts:411-421` tidak meneruskan `media`), isi foto flyer tak pernah dibaca.
  4. **Sapaan:** regex nama `goal-tracker.ts:212` (`dwi` â†’ "Bapak"; `dwi` unisex).
- **Penutup struktural (plan v2):** Mekanisme A grounding-missâ†’eskalasi (Retrieval); Mekanisme B gate `out_of_domain` di state machine + gambar tak-tergrounding ikut jalur sama; Mekanisme C sapaan data-driven (hapus regex, default `Bunda` per keputusan D1, simpan koreksi eksplisit); learning loop via filter `GET /unanswered` (`knowledge.subroute.ts:71-101`). Keputusan: tanpa vision (eskalasi saja), tanpa data rekrutmen di sistem (eskalasi saja), eskalasi silent (D2).
- **Verifikasi:** `npm run build` bersih; `npx tsc --noEmit` 0 error; test baru 3 file (`out-of-domain-intent` 7, `out-of-domain-gate` 5, `gender-greeting-neutral` 17) + regresi terkait hijau (extractor/machine/v3 44 file-254 test, greeting 5 file-33 test); full suite **237 file, 1833 passed, 0 failed** (baseline 1803 passed + 1 flaky `migration.test.ts` yang lolos solo maupun full-run pasca-perubahan); `grep loker|lowongan src/` nol hit runtime; `grep` daftar nama regex lama nol hit; log test membuktikan `LABEL SKIP` (tanpa mutasi label WAHA).

---

## 41. [Audit] Temuan audit penanganan customer 2026-09-11 â€” status keputusan & tindak lanjut

- **Konteks:** audit mendalam 4-agen (alur end-to-end, NLU, grounding, sesi/handoff) menghasilkan 12 temuan. Keputusan owner 2026-09-11:
- **By design / dibiarkan (BUKAN kekurangan):**
  1. Handoff permanen ke manusia (tanpa auto-release kembali ke bot) â€” disengaja: LLM belum dilatih menangani pasca-reservasi, perlu human touch. Konsekuensi sadar: CS wajib `release` manual; notifikasi eskalasi wajib kuat.
  2. Follow-up tetap jalan saat `is_human_handling` (hanya cooldown 72 jam) â€” dibiarkan. Koreksi analisis: `NO_PURCHASE` tak mungkin terkirim pasca-treatment (skip saat pembuatan `follow-up.service.ts:300-312` + auto-CANCEL saat eksekusi `:1100-1117`); sisa risiko hanya eskalasi pra-pembelian (LOW, diterima).
  3. Sapaan kembali default saat DB offline/restart â€” dibiarkan (degradasi sementara yang sadar).
- **Backlog paling belakang (dicatat, belum dikerjakan):** voice note/stiker/video/dokumen tidak ditranskripsi/dijawab bermakna (`webhook.route.ts:824-852` arsip saja; grep `transcrib/whisper` nihil). Akan dikerjakan terpisah, prioritas terakhir.
- **Diteliti tanpa plan (belum diputuskan):** pesan basi >180 dtk hanya dicatat DB tanpa sapaan pemulihan (`webhook.route.ts:748-798`); sebagai langkah kecil, default `MAX_INBOUND_MESSAGE_AGE_SECONDS` 180â†’300 dtk (2026-09-11, override env tetap bisa).
- **Dieksekusi 2026-09-11 (Fase Aâ€“G, lihat kode):**
  1. Learning loop `unresolved_faq` disambung (penulis: grounding kosong + eskalasi LLM non-medis; medis â†’ `medical_concern`).
  2. Outage LLM total â†’ eskalasi sunyi TANPA balasan (hapus fallback tanya-alamat; `agent-runner.ts` catch).
  3. Intent `complaint`/`human_agent` dihidupkan â†’ eskalasi sunyi (`complaint`/`manual_request`); opt-out STOP berlaku semua provider; slash-command dipindah setelah gate medis/domain.
  4. `factual-claim-validator.ts`: silang nama layanan/durasi/vaksin/anjuran/efikasi vs output tool; gagal pasca re-prompt â†’ sunyi + `unresolved_faq`.
  5. Form tak lengkap 3x â†’ eskalasi sunyi `reservation_incomplete` (counter `formRetryCount` di sesi).
- **Verifikasi:** `npm run build` bersih; `npx tsc --noEmit` 0 error; test baru 6 file (unresolved-faq 4, outage 1, fase-c 5, factual 7, fase-e 2, + perbaikan 1 test lama); full suite **242 file, 1852 passed, 0 failed** (19 skipped, sama seperti baseline). Satu regresi tertangkap gate Fase C (`medical-silent-escalation` â€” mock lapisan salah, diperbaiki) + satu false-positive D3 (penolakan sopan, diperketat) â€” keduanya hijau kembali.

---

## 42. [Tests] `medical-silent-escalation.test.ts` "Non-medical" memalsukan LLM di lapisan salah (2026-09-11)

- **Fakta:** test memock `model-fallback` namun runner memakai `v3LlmCircuitBreaker` langsung â€” V3 selalu throw (`LLM_FALLBACK_API_KEY not configured`) dan lolos via fallback tanya-alamat lama. Setelah Fase B (outage â†’ eskalasi), test ini gagal dengan benar.
- **Perbaikan:** test 3 kini memock `V3AgentRunner.executeChatCompletion` (lapisan yang benar) agar menguji normal flow sungguhan; skenario outage dicakup `llm-outage-silent.test.ts`.
- **Pelajaran:** mock di lapisan yang salah menyembunyikan perilaku outage â€” waspadai pola ini di test V3 lain.

---

## 43. [V3] Halusinasi domisili "Kecamatan Waru" + janji cek-jadwal buta (simulator 725870, 2026-09-11)

- **Status:** implemented (2026-09-11, fondasional â€” hierarki prompt + gate kode D6 + replay test).
- **Kejadian:** customer "galo" â†’ "Hari Minggu pagi kosong tidak ya ?" â†’ bot janji "cekkan... Nanti kami infokan" tanpa tanya lokasi/treatment; customer "baik kak" â†’ bot "Area Kecamatan Waru ini masih cukup luas..." padahal lokasi tak pernah disebut.
- **Bukti (bukan tebakan):** `logs/llm-2026-09-11.jsonl` entry `llm_1789098711706` + `llm_1789098754163` (customer `6289999725870`): kedua turn `TOOLS: []`, ringkasan sesi `Lokasi: Belum diketahui`. Dieliminasi: seed simulator, default GoalTracker, substring gazetteer (nol hit), bocoran extractor (guard aktif), state basi.
- **Akar:**
  1. RC-1 slot-fill: pola `persona.ts:155` ("Kecamatan [Kecamatan]...") + primer basecamp Waru (`:150-151`) vs larangan (`:156`, aturan 11 `:334`) â€” prompt-level tanpa enforcement; model mengisi slot dengan satu-satunya kecamatan yang dikenalnya.
  2. RC-2 konflik aturan: pola cekkan (aturan 5/21) vs tanya-lokasi (`:327`) tanpa precedence; summarizer mem-prime "cekkan"; fast-intent gagal tandai `ask_schedule`; fase GENERAL lemah; "baik kak" bukan afirmasi deterministik.
  3. RC-3 fixing lama tak mempan: `v3-anti-todong-jadwal.test.ts` hanya cek string prompt, tak pernah replay 2-turn.
- **Perbaikan:** Fase 1 hierarki 5a>5b+aturan 21 + direktif GENERAL + summarizer kondisional (prompt-only, keputusan owner); Fase 2 validator D6 (`factual-claim-validator.ts`, daftar kecamatan dari `getGazetteerKecamatanNames`, kecuali homebase) + `TEMPLATES.askDomicileNeutral` + wiring blok 7b (D6-murni â†’ template netral + `unresolvedFaq`); Fase 3 `simulator-minggu-waru-replay.test.ts` (MERAH 2/2 sebelum fix â†’ HIJAU sesudah) + unit D6 + perluasan test statis.
- **Verifikasi:** `npm run build` bersih; `tsc --noEmit` 0 error; replay test MERAH 2/2 sebelum fix â†’ HIJAU sesudah; full suite **243 file, 1858 passed, 0 failed** (19 skipped = baseline).

---

## 44. [V3] Auto-locking selectedTreatment + salah jawab nominal 100rb (simulator 973126, 2026-09-11)

- **Status:** implemented (2026-09-11, fondasional 4 fase â€” state machine + tool contract + summarizer + prompt).
- **Kejadian:** customer "Mba 100rb berapa menit pijetnya?" dijawab "Pijat Bayi Ceria ... 40 menit" padahal Ceria promo 60rb/normal 80rb; yang promo 100rb adalah Prenatal Massage 60 mnt.
- **Akar (audit read-only, terbukti di kode):**
  1. `agent-runner.ts:1158-1166` â€” tool read-only `get_catalog_and_price` menulis `selectedTreatment = treatments[0]` (auto-locking warisan).
  2. `detectAgreedTreatment (:304-320)` + auto-capture (`:593-606`) memindai semua role â€” sebutan asisten dianggap persetujuan customer.
  3. Tool contract tanpa `targetPrice`; router menebak `category BABY` hingga MOMS terfilter keluar; service tanpa pencocokan nominal.
  4. `conversation-summarizer.ts:163-165` hanya cek substring menit/durasi â†’ dikaitkan ke paket yang dibajak; `summarizer:77-79` + fase `TREATMENT_DISCUSSED` melarang tanya treatment.
- **Perbaikan:** Fase 1 hapus total auto-locking (customer-agreed only) + filter `role==='user'`; Fase 2 `findServicesByPrice()` tenant-aware + `targetPrice` di `GetCatalogInput`/`GET_CATALOG_TOOL_SCHEMA`/zod + pool lintas kategori + `priceClarification` + `showPrices` paksa; Fase 3 cabang komposit nominal+durasi berbasis token kata (anti false-positive "bRp"); Fase 4 router guidance targetPrice + few-shot 100rb (klarifikasi Bunda vs si kecil).
- **Limitasi sadar:** nominal diekstrak LLM router ke `targetPrice` (tanpa parser regex deterministik â€” sesuai mandat minimal-regex); `tolerance` default exact-match 0.
- **Verifikasi:** `npm run build` exit 0; tests baru `catalog-price-matching` (6) + `simulator-100rb-replay` (4) hijau; inti 30/30; full suite **245 file, 1868 passed, 0 failed** (19 skipped = baseline).

---

## 45. [V3] Deadlock validator faktual D2â†”D3 + pembajakan sanitizer eskalasi (simulator 446090, 2026-09-12)

- **Status:** implemented (2026-09-12, fondasional 4 fase â€” guardrail + runner + FTS + test).
- **Kejadian:** pertanyaan SOP vaksin ("pijat habis imunisasi apa sebelum ya?") dijawab sapaan Turn-0 tak relevan, bukan SOP vaksin.
- **Akar (audit read-only, terbukti di kode):**
  1. `persona.ts:369` mewajibkan vaksin via `get_clinic_policy_faq` (JANGAN `search_knowledge_faq`), tetapi D3 (`factual-claim-validator.ts:168-175`) hanya mengakui chunk `search_knowledge_faq` dan argumen `_retrievedChunks` (`:109`) adalah dead parameter â€” deadlock mutlak.
  2. `agent-runner.ts:1448` sanitizer menimpa `finalReply=''` eskalasi dengan sapaan Turn-0 (tanpa guard `!isEscalated`); brand hardcoded di fallback.
  3. `knowledge.service.ts:233-243` Step 3 `plainto_tsquery` tanpa Relevance Gate (Step 2 punya) â€” artikel skor 0.015 lolos sebagai noise.
- **Perbaikan:** D2/D3 mengakui policy-tool + `retrievedChunks` substantif; guard `!isEscalated && shouldSendReply` + `replyText ''` saat eskalasi + brand dinamis `getBrandIdentity()` (tanpa argumen â€” signature belum per-tenant, lihat brand.ts:25); gate token+`rank>=0.025` di Step 3 dan fallback tanpa-kolom; test baru `tests/unit/vaccine-sop-flow.test.ts` (5).
- **Sengaja TIDAK disentuh:** `persona.ts` (aturan vaksin sudah konsisten), seed vaksin sudah ada (`seed-faq.ts:139-145`) â€” Fase seed = verifikasi sinkronisasi DB saja, dan `npm run seed:faq` (deleteMany destruktif) DILARANG jalan di live tanpa backup+staging.
- **Pre-existing (terbukti di tree bersih via stash, BUKAN regresi perubahan ini):** full suite `npm test` gagal 19-23 test keluarga harga katalog (Pulih Ceria 70rbâ†’75k, nama Prenatal/Ceria/Sinar Moksa di `services_custom.json` drift tanpa update ekspektasi test: `agent-tools`, `catalog-price-matching`, `treatment-swap-cart-sync`, `catalog-session-total`, `consultation-mode-no-premature-price`, `cross-sum-math-integrity`, `v3-audit-homecare-fix`, `v3-fondasional-pilar`, `cart-dedup-total`, `cart-single-primary-domain`, `treatment-followup-personal`, `simulator-100rb-replay` + 1 flaky `production_edge_cases` label). Targeted suites perubahan ini hijau: vaccine-sop-flow 5/5, factual 9/9, knowledge 3/3, agent-runner 7/7; `npm run build` exit 0.
- **Tindak lanjut:** selaraskan ekspektasi test harga dengan data katalog dinamis (jangan hardcode nominal â€” mandat non-hardcode) ATAU kunci ulang `services_custom.json`; verifikasi manual Sandbox 2 query vaksin setelah deploy.
- **Update 2026-09-12 sore (sinkron lokal 64b43e7):** `catalog-price-matching` + `simulator-100rb-replay` ditulis ulang data-driven (ekspektasi diturunkan dari katalog aktif, tanpa hafalan nama/nominal) â†’ hijau 10/10 + contoh few-shot 100rb diberi disclaimer ilustrasi (otoritas angka = hasil tool). 16 failures lain di atas tetap pre-existing (terbukti ulang via stash di tree bersih).

---

## 46. [Data] Drift liveâ†”seed: RAG 43 vs 34, bank 26 vs 37 (2026-09-12) â€” RESOLVED

- **Status:** ~~open~~ **RESOLVED** (Plan 4 Phase 2, 2026-09-12).
- **Fix:**
  - Korpus FAQ diekstrak ke `src/cli/faq-corpus.ts` (sumber kebenaran tunggal, 48 artikel: 34 seed + 14 kurasi live via `scripts/sync-live-knowledge.ts`, `npm run sync:knowledge`).
  - `seed-faq.ts` NON-DESTRUKTIF: `deleteMany` dihapus, diganti loop `upsertChunk` idempoten (kunci `tenant_id+title`); chunk admin di luar daftar seed tidak pernah disentuh. Guard test `knowledge-safe-upsert.test.ts`.
  - Guard drift: `sync:knowledge --check` exit 1 bila ada judul live yang hilang dari korpus.
- **Temuan saat merge (mohon dibaca):**
  1. Snapshot `knowledge-chunks-2026-09-12.json` mengandung **mojibake CP437** (byte UTF-8 dibaca sebagai CP437 saat dump, mis. ðŸ˜Š â†’ "â‰¡Æ’Ã¿Ã¨") â€” dipulihkan eksak saat merge (tabel CP437 terverifikasi 0 mismatch vs codec referensi + self-test). DB live kemungkinan berisi teks benar; yang rusak hanya file snapshot.
  2. **4 overlap-beda-isi TIDAK ditimpa otomatis** (bidan-bersertifikat, bapil, lokasi-fisik, vaksin): kurasi manual lokal bisa lebih baru â€” tercantum di laporan merge untuk review manusia.
  3. Kontrak kepemilikan: seed memiliki 48 judulnya â€” penghapusan salah satu judul seed via dashboard akan dipulihkan saat seed berikutnya. Chunk non-seed aman.
- **Sisa di luar plan:** 2 skenario bank live belum di-merge ke bank default + 16 skenario default tidak ada di live (perlu konfirmasi owner, sesuai tindak lanjut awal).
- **Temuan awal (arsip pra-resolusi, bukti: dump `row_to_json` live vs `seed-faq.ts` + bank lokal):** 14 judul live tidak ada di seed lokal (kurasi admin via dashboard: mandi, susu, minyak, tumbuh-gigi+bapil, cukur-gundul, paket ibu komplit, "Mending mana pijat sebelum/sesudah imunisasi", dll); 5 seed lokal tidak ada di live (lokasi, durasi, bapil-boleh, terapis sama/bebeda, **artikel "bayi jatuh"**); 2 skenario bank live tidak ada di file lokal; 16 skenario default lokal tidak ada di live. Risiko asal: `npm run seed:faq` (deleteMany) akan MENGHAPUS 14 kurasi admin live â€” kini dihapus mekanismenya.

---

## 47. [Tests] `npm test` mengotori tracked `services_custom.json` (2026-09-12) â€” RESOLVED

- **Status:** RESOLVED (Plan 3 Phase 2, 2026-09-12).
- **Fix:** Guard `saveServices()` di `treatment-catalog.service.ts`: jika `process.env.NODE_ENV === 'test'` atau `process.env.VITEST`, operasi `fs.writeFileSync` di-bypass. Verifikasi: `git status --porcelain services_custom.json` kosong setelah full test suite (1957 tests).

---

## 48. [Retrieval] Skor token tunggal ambigu: "susah makan" seri vs "susah BAB" (sesi 138207, 2026-09-12) â€” RESOLVED

- **Status:** RESOLVED (Plan 3 Phase 1, 2026-09-12).
- **Fix:** Multi-word phrase matching (+8 bonus) + core complaint noun scoring (+4) + modifier scoring (+1) di `recommendServiceBySymptoms`. Frasa "susah makan" â†’ Lahap Juara mutlak; "susah BAB" â†’ Pulih Ceria mutlak. 6 unit test baru di `tests/unit/v3/symptom-semantic-scorer.test.ts` mengunci skenario kritis.

---

## 49. [Simulator] 4 anomali sesi 138207 â€” FIXED 2026-09-12 (lapisan fondasional, tanpa dependency baru)

- **Status:** fixed, dikunci 8 unit test baru (`symptom-gtm-recommendation`, `numeric-validator-session-ongkir`, `day-evidence-sameday`).
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (prompt payload turn 10â€“12) + `logs/app-2026-09-12.log` (`NUMERIC_HALLUCINATION_DETECTED` Rp 20.000, `V3_TOOL_RESERVATION_DAY_GATE_REJECTED` bookingDate "Hari ini").
- **Akar & perbaikan:**
  1. Summarizer hardcode `includes('pulih')` vs grounding goal-tracker (Lahap < 2 thn) â†’ grounding kontradiktif. Fix: summarizer kini memanggil `recommendServiceBySymptoms` yang sama (`src/v3/state/conversation-summarizer.ts`).
  2. Ongkir promo sesi tak diotorisasi sebagai angka mandiri â†’ false-positive + fallback kaku. Fix: ongkir session masuk `authorizedNumbers` (`src/v3/guardrails/numeric-fact-validator.ts`).
  3. Keranjang mengunci varian `> 2 thn` (usia dikarang 24 bln) + label `[Adik]` anak tunggal. Fix: kebijakan default tier BABY saat usia tak diketahui (tie-break di `treatment-catalog.service.ts` + `get-catalog.tool.ts`), prefix kinship hanya bila â‰¥2 anak (`src/v3/agent/agent-runner.ts`).
  4. `save_reservation` prematur saat "siap bund" + gate menolak "siang ini". Fix: alias same-day (`SAME_DAY_EVIDENCE_ALIASES`) + pesan penolakan hangat + larangan routing eksplisit (`save-reservation.tool.ts`, `persona.ts`).
- **Sisa yang disengaja:** harga paket dasar bayi-sehat disembunyikan dari grounding sampai customer bertanya harga (`goal-tracker.ts`); nominal tetap mengalir via `get_catalog_and_price` saat `inquirePrice=true` (tidak ada kehilangan data harga).

---

## 50. [Tests] Ekspektasi harga test usang vs `services_custom.json` â€” RESOLVED 2026-09-12

- **Status:** resolved (2026-09-12) â€” 10 berkas test disinkronkan ke katalog aktif; full suite 263/263 files, 1936 passed + 19 skipped (0 failures).
- **Fakta awal:** 9 file / 12+ test gagal karena drift DATA (Pulih Ceria 70kâ†’75k, Moksa Add-on 10kâ†’Infrared/Moxa 25k, nomenklatur bundle/follow-up), bukan regresi logika.
- **Fix:** ekspektasi promo/total/nama resmi diselaraskan (`agent-tools`, `cart-single-primary-domain`, `catalog-session-total` 95k, `consultation-mode` 95k, `treatment-swap-cart-sync` 75k, `v3-fondasional-pilar` 70k+25k=95k, `treatment-followup-personal` Infrared/Moxa + Newborn + Prenatal Gentle, `cart-dedup-total` nama resmi + `priceDiscussed: true`, `v3-audit-homecare-fix` Oksitosin Fullbody + copy `tampung`/`cekkan`, `v3-persona-rules` regex emoji penutup).

---

## 51. [Tool Contract] `targetPrice` LLM tidak diteruskan ke `executeGetCatalog` â€” RESOLVED 2026-09-12

- **Status:** resolved (2026-09-12).
- **Fakta:** router prompt memerintahkan LLM mengisi `targetPrice` untuk nominal tanpa nama paket ("100rb berapa menit"), dan schema tool + zod mendukungnya â€” tetapi `executeToolByName` (`src/v3/tools/tool-registry.ts`) membangun `GetCatalogInput` manual TANPA `targetPrice`, sehingga `hasTargetPrice` selalu false di produksi dan jalur `priceClarification` mati.
- **Fix:** satu baris `targetPrice: args.targetPrice` di `tool-registry.ts` + bug swap varian se-famili di `GoalTracker.resolveAffirmativeSwap` (proteksi Covered Tokens: token milik item cart yang disebut asisten tidak boleh memicu fuzzy-match varian sibling seperti Kids Pulih Ceria). Verifikasi: full suite 263/263 files hijau (0 failures), `npm run build` 0 error.

---

## 53. [Simulator] Direct reply Call 1 kehilangan persona (sesi 309274) â€” FIXED 2026-09-12

- **Status:** fixed, dikunci 3 unit test (`v3-call1-direct-reply-natural`).
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (`customerPhone 6289999309274`, Turn-0 "siang kak untuk pijat dengan sinar moksa apa bisa homecare ya?", `executedTools: []`, `modelUsed gpt-4o-mini`) â†’ `finalReply` birokratis tanpa sapaan/perkenalan ("Sebelum melanjutkan, bolehkah Bunda memberitahukan ... Ini penting untuk ...").
- **Akar:** jalur direct-reply Call 1 (`finalReply = assistantMessage?.content`, `temperature: 0.2` di `agent-runner.ts:984`) hanya memakai `buildRouterPrompt` yang dirampingkan untuk routing â€” tanpa panduan sapaan Turn-0 (param `isFollowUp` tidak dipakai), tanpa panduan gaya WhatsApp, tanpa larangan frasa birokrasi.
- **Fix (prompt-level, sesuai User Review Required):** butir 2 `buildRouterPrompt` kini memuat panduan sapaan Turn-0 kondisional (`isFollowUp`), contoh nada luwes, dan daftar hitam frasa birokratis â€” tetap ringkas (Â±4 baris) agar router tidak girmuk.
- **Catatan jujur:** pertanyaan "apa bisa homecare" secara ideal memicu `get_clinic_policy_faq` â€” model memilih jawab langsung. Sensitivitas routing tidak diubah (di luar cakupan; berisiko over-triggering tool).
- **Fase 834128 yang diusulkan ulang di plan ini TIDAK dikerjakan ulang** â€” sudah live di working tree dan terverifikasi (offer-confirmation gate, core-first durasi, `asksDuration`, pronoun validator). Usulan plan yang tetap ditolak demi mandat: helper regex `isAmbiguousRelativeReference` (gatekeeper intent via regex), daftar nama hardcode, dan sanitasi string `output-sanitizer.ts` (file tidak ada; penggantian kalimat dilarang).

---

## 54. [Simulator] Kaset rusak reprompt + orphan add-on + jam/durasi direct-reply (sesi 188034) â€” FIXED 2026-09-12

- **Status:** fixed, dikunci 12 unit test baru (`reprompt-payload-integrity`, `cart-orphan-addon-protection`) + 1 butir router di `v3-call1-direct-reply-natural`.
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (`customerPhone 6289999188034`): T5 `calculate_delivery` â†’ rincian Moksa Rp 15k + ongkir Rp 25k = Rp 40k; T6 "Besok apakah bisa kak" (`executedTools: []`) â†’ pengulangan kata-per-kata rincian T5; T7 "Pulih ceria + moksa" â†’ "Estimasi durasi 55 menit" + "kasih tahu jam berapa". `logs/app-2026-09-12.log`: `PRONOUN_SLIP_DETECTED` 02:01:05 + `PRONOUN_REPROMPT_FIXED` 02:01:07 pada turn yang sama â€” reprompt "berhasil" tetapi output = teks Turn 5 (model merevisi pesan turn salah karena draf tak disertakan).
- **Akar & perbaikan:**
  1. Payload reprompt (numerik/faktual/pronoun) = `[...messages, correction]` tanpa draf asisten. Fix: helper pure `buildRepromptMessages` (dengan guard draf-kosong anti HTTP 400) dipakai ketiga jalur + `currentDraft: finalReply` di pemanggil numerik; reprompt berantai tersinkron otomatis karena tiap tahap membaca `finalReply` terbaru.
  2. `syncCartItems` mem-push ADDON akumulatif tanpa syarat utama. Fix: gate per-turn (keranjang berjalan ATAU pesan se-turn memuat non-addon) + gerbang penutup (tanpa utama â†’ buang semua ADDON). Kasus 3/5/9 terverifikasi hijau (`cart-dedup-total` moksa, `cart-single-primary-domain` combo).
  3. Router Section 2 belum memuat aturan emas. Fix: blok `ATURAN EMAS MUTLAK BALASAN LANGSUNG` (jam/durasi/harga/pronoun) â€” tanpa menduplikasi panduan Turn-0/anti-birokrasi yang sudah ada.
- **Keputusan bisnis/medis (disetujui user):** ADDON (Moksa, Nebulizer) tidak melayani homecare mandiri â€” dikunci deterministik di state machine; bot menjelaskan edukatif, keranjang tetap `[]`.
- **Batasan jujur:** ekspektasi nominal plan (Rp 90.000, Rp 115.000) memakai harga lama â€” test baru menghitung ekspektasi dari katalog aktif (Pulih 75k + Moksa 25k). Simulasi manual `npm run chat` tidak dijalankan (CLI interaktif, tanpa TTY di lingkungan ini) â€” cakupan diganti replay log + unit test deterministik.

---

## 55. [Simulator] Loop pasca-reservasi + disclaimer same-day + frasa pihak ketiga (sesi 462651) â€” FIXED 2026-09-12

- **Status:** fixed, dikunci 15 unit test baru (`post-reservation-handoff`, `same-day-disclaimer`, `no-third-party-phrasing`, `symptom-bypass-guard`).
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (`customerPhone 6289999462651`): T4 "untuk perut kembung bisa ya?" (`executedTools: []`) â†’ "Tentu saja bisa ... sangat efektif ... ingin reservasi? hari apa?"; T5 "hari ini jam 16.00" â†’ `save_reservation`, disclaimer "kemungkinan penuh" dibuang Call 2 + "Bidan yang ready"; T6 "oke kak" â†’ T7 "siap" = reassurance nyaris identik (loop).
- **Akar & perbaikan:**
  1. Tanpa handoff, ack "oke/siap" memanggil LLM selamanya. Fix: acknowledgement gate deterministik (0 token) â€” ack pertama â†’ 1x closing + `isEscalated` + `escalationReason: 'pending_reservation_check'` (machine meneruskan ke `escalateToHumanHandling`: antrean live-chat + alert Telegram + web push; guard `machine.ts:51` membisukan turn berikut); ack berikutnya â†’ senyap total. Flag `booking.needsStaffVerification/handoffClosingSent` persist via `customer.preferences` (tanpa migrasi). Non-ack ("bayar pake apa") SENGAJA tidak di-escalate (butuh jawaban; visibilitas staf via rekaman reservasi) â€” deviasi sadar dari plan.
  2. Call 2 membuang disclaimer. Fix dua lapis: direktif `[MANDAT SAME-DAY BOOKING]` saat `save_reservation.isSameDay` + safety-net deterministik `ensureSameDayDisclaimer` (append bila tanpa indikasi "penuh").
  3. "Bidan yang ready" diajarkan contoh BENAR di 4 lokasi (few-shot:42, gold:46, persona:199, config:86) â€” dibersihkan ke "jadwal kami". Invarian test: frasa hanya boleh di kalimat DILARANG.
  4. Bypass keluhan: router mewajibkan `get_catalog_and_price` untuk keluhan fisik baru + A.2 melarang afirmasi mutlak/overclaim/todong ganda.
- **Phase 5 plan (188034) TIDAK dikerjakan ulang** â€” `buildRepromptMessages` + orphan gate terverifikasi live di working tree.

---

## 56. [Simulator] Reprompt collapse Turn 3 + lokasi ditanya ulang (sesi 310843) â€” FIXED 2026-09-12

- **Status:** fixed, dikunci 4 unit test (`reprompt-payload-integrity` ditulis ulang ke kontrak isolated) + 1 butir 5b di `v3-call1-direct-reply-natural`.
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (`customerPhone 6289999310843`): T3 "Hari minggu apa bisa ?" (`executedTools: []`) â†’ pengulangan 100% teks Turn 1 (lokasi Waru + todong domisili padahal Wiguna 8.1 km sudah diketahui). Prompt runtime SUDAH memuat seluruh fix sebelumnya (Turn-0, asksDuration, golden router) â€” kolaps terjadi DI ATAS kode terbaru. `logs/app-2026-09-12.log`: `PRONOUN_SLIP_DETECTED` 02:40:33 â†’ `PRONOUN_REPROMPT_FIXED` 02:40:35 â€” "fix" yang diadopsi = salinan Turn 1 (lolos recheck karena teks Turn 1 pronoun-clean). Membuktikan `currentDraft` (fix 188034) perlu TAPI tidak cukup: riwayat 8 pesan + draf + koreksi tetap collapse ke pesan salient.
- **Fix:** `buildIsolatedRepromptMessages` (system editor + user draft, TANPA riwayat) menggantikan `buildRepromptMessages` di 3 jalur (numerik/faktual/pronoun). Ekspektasi perilaku lain dipertahankan: suhu per jalur, fallback sunyi faktual (D6 template), reprompt-tidak-membisu pronoun, kompatibilitas `cross-sum` (last=user, sekali panggil â€” hijau).
- **Router 5b:** lokasi-diketahui â†’ DILARANG tanya lokasi lagi; treatment belum dipilih â†’ konfirmasi cek jadwal + tanyakan rencana perawatan (Call-1 direct reply tidak terjangkau aturan 16 Call-2 â€” ini celah lapisannya).
- **Trade-off jujur:** retry terisolasi kehilangan konteks gaya percakapan (disangga system editor + draf utuh); efek ke kualitas revisi dipantau via event `*_REPROMPT_FIXED/STILL_INVALID` di log.
- **Fase 2/3/4/6 plan ini TIDAK dikerjakan ulang** â€” handoff pasca-reservasi, disclaimer same-day, bersih frasa, guard keluhan, orphan gate terverifikasi live di working tree.

---

## 58. [V3] Anti-premature totaling 694493 + copy reservasi + bundling â€” DONE 2026-09-12

- **Status:** done (gap-only; Fase 4/5 dilewati karena DONE). `calculate_delivery` kini gating `priceDiscussed` (tool input + registry snapshot + runner wiring + pesan + Bagian 4 persona Mode Konsultasi/Transaksional); copy non-same-day `save_reservation` menjadi "sudah kami tampung ... cekkan slot" (tanpa "berhasil dicatat"); kontrak bundling di Call 1 prompt; micro-template usia 2 kalimat; 3 sisa frasa "yang ready" â†’ "jadwal kami".
- **Kunci uji:** `anti-premature-invoicing` (2) + `reservation-response-copy` (1) hijau; `consultation-mode` 4/5 â€” 1 gagal pre-existing drift katalog (test harap 90.000, katalog kini 75.000/95.000 via perubahan `treatment-catalog` di working tree, bukan dari patch ini).
- **`npm run build` lolos.**

---

## 57. [Tracing] Refaktor fondasional Dedicated LLM Execution Tracing â€” DONE 2026-09-12

- **Status:** done (5 fase). Kontrak `LlmFlowType` V3 (`NLU_EXTRACTOR/V3_ROUTING/V3_GENERATION/V3_REPROMPT`, legacy tetap diparse), field token/biaya/tools/callSequence, propagasi `bubbleCorrelationId` per-pesan (machineâ†’NLUâ†’V3+sandbox), tracing per-call dengan latensi bersih, UI Debug V3 + filter `customerPhone`.
- **Sisa tech-debt jujur:** (1) `rehydrate` masih `readFile` penuh lalu slice 500 baris terakhir â€” aman untuk â‰¤10MB tapi bukan true streaming tail; (2) reprompt numerik tidak mencatat token per-call detail (hanya durasi + koreksi) karena `attemptNumericReprompt` agregat via `addUsage`; (3) `npm test` 14 gagal di working tree ini vs 51 gagal di HEAD bersih â€” gagal sisa pre-existing/flaky di luar modul tracing (tracing: 14/14 hijau, `npm run build` lolos).
- **Regresi:** `tests/unit/hierarchical-debug-logs.test.ts` (3 legacy V2) tetap hijau; heuristik fallback hanya untuk ID generik `@c.us`.

---

## 52. [Simulator] 4 temuan sesi 834128 â€” FIXED 2026-09-12 (fondasional, tanpa dependency baru)

- **Status:** fixed, dikunci 11 unit test baru (`ambiguous-choice-clarification`, `catalog-promo-core-first`, `pronoun-validator`) + 1 test diperbarui (`tool-output-scoping` â†’ aturan emas 3 via `asksDuration`).
- **Bukti log:** `logs/llm-2026-09-12.jsonl` (`customerPhone 6289999834128`: turn "apakah ada promo kak ?" â†’ `get_catalog_and_price`, 5 chunk `[Katalog Layanan]` similarity 1.0; turn "boleh deh yang itu" â†’ tanpa tool, cart `Memandikan Bayi Rp 30.000`, balasan "beritahu saya ...").
- **Akar & perbaikan (menyimpang dari plan awal demi mandat repo):**
  1. Kunci sepihak BUKAN dari `detectAgreedTreatment` (sudah user-only, mengembalikan null dengan benar) â€” melainkan pesan asisten sendiri yang ikut di-exact-match `syncCartItems` + single-PRIMARY-replace menyisakan item terpendek. Fix: offer-confirmation gate â€” tawaran â‰¥2 PRIMARY hanya masuk keranjang bila user pernah merujuk itemnya (`goal-tracker.ts`); deteksi tanpa daftar frasa hafalan. Prompt klarifikasi di `persona.ts` sebagai pelengkap.
  2. Etalase support-first: urutan chunk = urutan tool = urutan file katalog (satu titik fix di `executeGetCatalog`). Core-first via heuristik durasi DB (`< 30 mnt` tenggelam, disetujui user) â€” `category`/`serviceType` tidak membedakan (mandi/cukur/tindik = BABY/STANDARD), `sort_order` DB belum dimuat ke runtime (butuh migrasi + admin UI bila diinginkan kelak).
  3. Durasi proaktif: kontrak tool baru `asksDuration` (schema + zod + registry + instruksi router); strip durasi di `treatments`, `summaryList`, `priceClarification`, `recommendationReason`, chunk observabilitas, dan template persona KONDISI B/aturan 2/contoh (cakupan "semua balasan harga" sesuai pilihan user).
  4. "beritahu saya": TANPA regex-replace kalimat (penggantian string `sayaâ†’kami` sengaja sudah dihapus dari pipeline sanitizer â€” `sanitizer.ts:38-44`). Fix: validator deteksi `pronoun-validator.ts` + reprompt 1x di `agent-runner.ts` (kegagalan reprompt TIDAK membisukan balasan â€” pelanggaran gaya, bukan faktual) + penguatan aturan 7 di persona. Plan awal yang menunjuk `src/v3/agent/output-sanitizer.ts` keliru â€” file itu tidak ada.

---

## 59. [V3] Dekomposisi agent-runner.ts â†’ Deep Pipeline + kolaps split-brain NLU â€” DONE 2026-09-12

- **Status:** done, full suite 266/266 files hijau (1951 passed + 19 skipped, 0 failures), `npm run build` 0 error.
- **Struktur baru (`src/v3/agent/pipeline/`):** `context-grounder.ts` (Stage 1: sinyal/fase/RAG/label + FastResponseGate + POST_RESERVATION_*), `tool-pipeline.ts` (Stage 2-3: eksekusi tool + state reducer), `guardrail-pipeline.ts` (Stage 5: 3 reprompt + same-day + fallback), `generation-stage.ts` (transport LLM + Call 1/Call 2 + telemetri + SAME_DAY_DISCLAIMER). `agent-runner.ts` 1928 â†’ 241 baris (orkestrator murni, tanpa re-export).
- **Phase 5 (machine.ts):** panggilan LLM `EntityExtractor.extract` dipensiunkan; fallback kini `preExtractDeterministic` (0 token, existing). Komplain/permintaan manusia yang luput dari gate deterministik ditangani Call 1 Router via `escalate_to_human` (jalur ini tetap sunyi ke customer: `shouldSendReply=false`).
- **Perubahan perilaku yang disetujui user:** (a) eskalasi complaint/human_agent/OOD tak lagi sunyi pre-V3 via LLM â€” mengalir lewat V3 tool-escalation (tetap tanpa balasan ke customer, tapi memakan Call 1+2); (b) tanpa re-export â€” 12 berkas test dimigrasi ke path modul baru; (c) seam mock LLM pindah ke `GenerationStage.executeChatCompletion` (static, spyOn-able); (d) klaim hemat "~2 detik per turn" hanya berlaku untuk pesan yang luput dari fast intents (mayoritas pesan normal sebelumnya juga 2 calls).
- **Deviasi dari plan yang WAJIB dicatat (Confirmation Gate, disetujui eksplisit via prompt):** opsi "full plan apa adanya" dipilih user atas temuan audit (overclaim latensi, matinya V3 DOMAIN GATE untuk OOD, konflik mandat non-hardcode pada keyword darurat, target <250 baris). Pengecualian hardcode sementara: TIDAK ada daftar keyword baru yang ditambahkan â€” darurat medis tetap mengandalkan `preExtractDeterministic` existing + router `escalate_to_human`.
- **Risiko sisa:** OOD yang hanya terdeteksi semantik LLM kini dijawab V3 dulu (bukan silent-gate pre-V3) kecuali Call 1 memilih `escalate_to_human` â€” monitor via reason `unresolved_faq`/HUMAN_HANDLING; `EntityExtractor.extract` (LLM) masih dipakai jalur lain bila ada â€” grep berkala bila ingin dipensiunkan total.

---

## 60. [LiveChat v3] Sisa terbuka pasca implementasi Fase Aâ€“D (2026-09-14)

- **Status:** Fase Aâ€“D implemented (full suite 275 files, 2001 passed + 19 skipped, 0 failures; `npm run build` + dashboard `tsc && vite build` exit 0; `dist/` ter-regenerasi).
- **Sisa yang diketahui & disengaja:**
  1. Rencana verifikasi v3 merujuk `tests/unit/live-chat.test.ts` dan `tests/unit/date-wib.test.ts` â€” kedua file TIDAK ADA di repo. Cakupan pengganti yang benar-benar ada & hijau: `tests/unit/live-chat-paged-messages.test.ts`, `tests/unit/live-chat-sync-health.test.ts` (baru, 2 tests), `tests/unit/label-lifecycle.test.ts` (8), `tests/unit/waha-label-cache.test.ts`. Jangan klaim file yang tidak ada sebagai gate.
  2. Method `wahaClient.addLabel/removeLabel/batchUpdateLabels` tetap ada di `src/integrations/waha/client.ts` (ditandai `@deprecated` + runtime warning) karena test client-level (`waha-label-cache`, `waha-label-resilience`, `waha-retry`) mengunci perilaku cache/invalidate-nya. Larangan berlaku untuk kode BISNIS (dikunci invariant guard 3 tests, termasuk pola chain multiline).
  3. Verifikasi manual mobile (scythe viewport iPhone, emoji picker, draf antar-chat, kirim) belum dieksekusi di sesi ini â€” wajib sebelum klaim "100% lancar" ke user.
  4. Skrip `check-livechat-sync.ts` / `repair-last-message-at.ts` sudah dijalankan 2026-09-17 terhadap DB aktif: repair `--apply` menyentuh 351 baris, drift sisa 0 (idempoten, terverifikasi via sync-check). Sisa historis: 599 outbound tanpa `wa_message_id` (hanya pesan bot baru yang membawa ID resmi via `sendTextDetailed`), 163 phantom conversation (tanpa pesan, difilter by-design di query `messages: { some: {} }`).

---

## 61. [Pembersihan Fondasional] Konsolidasi Page Bloat, Shared Utils & Optimasi Backend (2026-09-15)

- **Status:** Fase 1â€“3 selesai terverifikasi (dashboard build + root tsc exit 0; full suite 276 files, 2003 passed, 0 failures; sidebar 25â†’20 menu, bukan 25â†’15 klaim plan â€” lihat sisa).
- **Sisa & Tech Debt yang disengaja:**
  1. **Koordinat klinik fallback hardcode** `CLINIC_COORDS = { lat: -7.34886, lng: 112.751677 }` di `CreateReservationModal.tsx` masih hardcode tech-debt menunggu endpoint `tenant.settings` baru agar tenant-aware penuh. Perlu Confirmation Gate bila solusi tenant-aware butuh infra baru/LOC besar â€” dicatat sesuai AGENTS.md.
  2. **Sidebar 25â†’20, bukan 15** seperti klaim plan: hanya 5 menu dihapus (Customer Labels, CS & CTA, Follow-Up Templates, Daily Chat Export, Telegram) karena Delivery Tiers memang tidak ada di sidebar dan beberapa menu (Chat Migration, Balasan Cepat) dipertahankan sebagai rute mandiri yang masih aktif. Pencapaian 15 butuh keputusan tambahan menghapus rute mandiri lain â€” butuh konfirmasi user.
  3. **LocationPickerModal & CustomerProfilePanel** baru (file siap, build lolos) belum menggantikan 800â€“1100 LOC duplikat lokasi/foto di `TodayTreatments`, `StaffToday`, `CustomerEditForm` secara penuh â€” integrasi penuh butuh refactoring lanjutan per-konsumen (risiko regresi tinggi bila sekaligus). 
  4. Old page files (`DeliveryTiers.tsx`, `FollowUpTemplates.tsx`, dll.) tetap ada di repo sebagai source untuk tab â€” tidak dihapus agar import tab tetap berfungsi; hanya rute `App.tsx` yang di-redirect.

---

## 62. [Sanitizer V3] Mutilasi katalog sesi 381894 â€” plafon 500 hardcoded, tenant-aware di-bypass (2026-09-14)

- **Status:** diperbaiki parsial sesi ini (Fase 1â€“3); sisa tech debt di bawah.
- **Insiden:** LLM utuh 1006/837 chars (4 paket + penutup); `OutputSanitizer.truncateToMaxChars` (hardcode 500 di `src/v3/guardrails/sanitizer.ts`) memenggal di index 212/390 sehingga tersisa header menggantung "untuk si kecil:". Pemicu: blank-line ber-spasi tidak dinormalisasi sebelum hitung batas paragraf. Sekunder: Router Call 1 me-re-query `calculate_delivery("Surabaya")` tanpa lokasi baru di Turn 3.
- **Perbaikan masuk:** plafon konteks-sadar tenant-aware (1200 umum / 1500 katalog; kolom `TenantPersona.max_chars_per_reply` menang bila di-set admin â€” sesuai keputusan user), normalisasi blank-line ber-spasi, Hanging-Header Ban + potong di akhir item bernomor lengkap, pengetatan direktif `calculate_delivery` (`persona.ts`, `context-grounder.ts` guard GENERAL), suite adversarial `tests/unit/v3/sanitizer-catalog-truncation.test.ts`.
- **Sisa tech debt (disengaja):** (1) duplikasi `truncateToMaxChars` legacy di `src/config/persona.ts` belum dikonsolidasi ke sanitizer V3 (jalur lama masih dipakai kode non-V3); (2) `getMaxCharsPerReply` dibaca sinkron dari cache in-memory â€” bila `loadPersonaFromDb` belum dipanggil, fallback ke default 1200/1500 (override DB aktif setelah persona termuat); (3) Aturan Emas #1 (maks 2â€“3 kalimat) vs katalog 4 paket (700â€“1100 chars) hanya didamaikan via pengecualian "rincian diminta" â€” belum ada batas formal kalimat-vs-katalog di prompt DB.

---

## 63. [Resolusi Reservasi & Invoice] Kasus 628222935xxxx Bunda Lutfia â€” 4 lapisan akar (2026-09-15)

- **Status:** Fase 1â€“4 selesai terverifikasi (nearest-neighbor 5, wilayah 5, catalog-age 5, safe-address 4, chat-extractor 8+13; `npm run build` + dashboard tsc exit 0). 31 failures full suite adalah pre-existing stubs di luar cakupan fase (queue-durability, telemetry, typing-transport, v3-governance, pediatric-taxonomy, recruitment, schedule-handoff, guardrail-no-mutilation, migration) â€” bukan regresi fase ini.
- **Sisa & Tech Debt yang disengaja:**
  1. **`DEFAULT_CLINIC_SERVICES_FALLBACK` hardcode** di `CreateReservationModal.tsx:73` tetap sebagai jaring pengaman offline bila `GET /api/admin/services` gagal/offline. Harga & tier usia di fallback sinkron manual dengan DB â€” perlu sync berkala; migrasi tenant-aware penuh butuh endpoint settings baru (Confirmation Gate bila LOC besar).
  2. **Tanpa katalog (DB kosong/offline) fallback `0`** di extractor â€” jujur bukan karangan, tapi UI invoice menampilkan `0`; user wajib pilih layanan manual. Belum ada banner "katalog belum termuat".
  3. **Matcher `matchCatalogService` token-substring** masih memetakan kata `pijat` saja ke kandidat terdekat; turunan `xyz` tidak cocok â†’ 0 benar, tapi validasi "minimal 1 token signifikan" tetap sederhana â€” belum ada threshold coverage formal.
  4. **Verifikasi manual belum:** shareloc Sedati â†’ profil Sedati/Sidoarjo, invoice Kec/Kota dari alamat teks, edit reservasi ganti staff/alamat tanpa 500.

---

## 64. [Booking Commit] Sesi 614425 â€” komitmen booking bergantung judgment LLM â†’ buntu & tanya jam (2026-09-16)

- **Status:** Fase 0â€“4 selesai terverifikasi (test `tests/unit/v3-booking-commit-session-614425.test.ts` 6/6, `tests/unit/guardrail-visit-time.test.ts` 4/4; `npm run build` exit 0; full suite 295 files, 2172 passed, 0 failures).
- **Insiden:** Customer menyatakan komitmen ganda ("iya bu saya ambil treatment nya" lalu "inggih bu, besok boleh"), namun `save_reservation` TIDAK PERNAH dipanggil (terbukti di `logs/app-2026-09-16.log`: hanya `calculate_delivery` + `get_catalog_and_price`/`search_knowledge_faq`). Turn 6 & 7 hanya 1 panggilan LLM (`V3_ROUTING`, tanpa Call-2). LLM malah menanyakan JAM kunjungan spesifik â€” melanggar Aturan Emas.
- **Akar masalah (multi-layer):**
  1. Keputusan commit diserahkan ke judgment `gpt-4o-mini` (`persona.ts` save_reservation = "HANYA jika customer sudah menyepakati...") â€” non-deterministik.
  2. `conversation-summarizer.ts` menyuntik larangan "Menanyakan 'mau treatment di hari apa'" saat hari sudah disebut TANPA arahan maju â†’ model buntu â†’ menebak tanya jam.
  3. Tidak ada directive fase `TREATMENT_DISCUSSED + day mention â†’ commit`.
  4. Tidak ada guardrail penolak pertanyaan jam.
- **Perbaikan masuk (fondasional, bukan tambal prompt):**
  1. `ContextGrounder.isBookingCommitReady()` â€” derivasi deterministik (treatment disepakati + hari disebut + belum ada reservasi), reuse `DAY_EVIDENCE_WORDS`.
  2. `generation-stage.ts` `dynamicToolChoice` â€” memaksa `save_reservation` saat commit-ready (prioritas di bawah sinyal medis/vaksin/lokasi).
  3. `conversation-summarizer.ts` â€” ganti framing buntu dengan arahan maju + larangan jam spesifik.
  4. `guardrail-pipeline.ts` `detectVisitTimeQuestion()` + reprompt 7e â€” jaring pengaman pasca-Call-2.
- **Sisa & Tech Debt yang disengaja:**
  1. `isBookingCommitReady` bergantung `DAY_EVIDENCE_WORDS` includes; frasa hari ambigu ("besok-besok", "hari ini juga") bisa memicu commit dini â€” belum ada gate negasi/konteks. Perlu hardening bila muncul false positive di produksi.
  2. Guardrail jam memakai token-match terarah (bukan NLP); varian tak terduga ("kira-kira kami datang jam berapa?") mungkin lolos. Diperluas bila ada temuan log.
  3. Belum ada test end-to-end yang mengeksekusi `save_reservation` sungguhan (DB offline â†’ fallback); verifikasi live di simulator/sandbox dianjurkan sebelum deploy produksi.

---

## 65. [V3 Architectural Trap] Anti-Pattern Patching Case-by-Case & Split-Brain Heuristik Regex (Sesi 887216) â€” 2026-09-16

- **Status:** Fase 1â€“6 SELESAI terverifikasi (build exit 0; full suite 301 files, 2201 passed, 0 failed). Test baru: `patient-profile-single-child`, `grounding-catalog-metadata`, `cart-tier-collision`, `summarizer-statement-only-887216`.
- **Perbaikan yang masuk (fondasional, data-driven):**
  1. `patient-extractor.ts` â€” penanda anak-lain naik ke level FRASA (`"anak saya yang"` / `"anaknya yang"` + ordinal eksplisit), kata sambung umum `'kalau'`/`'yang'` telanjang dihapus. Rekonsiliasi audit 854065 (sibling) vs 887216 (anak tunggal) tanpa regresi.
  2. `goal-tracker.ts` â€” grounding keranjang menyuntik `Durasi Resmi` + `Batasan Usia` per-item dari `durationMinutes`/`ageTier` katalog DB (untuk item tunggal maupun multi) â€” zero hardcode.
  3. `context-grounder.ts` â€” directive fase `TREATMENT_DISCUSSED` tidak lagi memblokir `get_catalog_and_price` untuk pertanyaan durasi/harga/usia.
  4. `cart-manager.ts` â€” resolusi collision multi-tier usia memakai `ageTier.min/maxAgeMonths` dari DB (default tier terendah bila usia tak diketahui); `ageTier` dialirkan dari caller `context-grounder.ts`.
  5. `conversation-summarizer.ts` â€” statement-only saat pertanyaan durasi, cabang klarifikasi kategori usia, deteksi variasi kaset todong jadwal diperluas.
  6. `persona.ts` â€” KONDISI A.2 anti-amnesia keluhan (larang tanya ulang keluhan yang sudah disebut; tutup empatik / tanya gejala pendamping).
- **Sisa & Tech Debt yang disengaja:**
  1. Verifikasi manual `npm run chat` skenario 887216 belum dijalankan (simulator interaktif + butuh LLM live, di luar gate offline) â€” perlu dijalankan manusia sebelum deploy.
  2. Marka frasa sibling (`"anak saya yang"`) masih berbasis substring frasa â€” varian tak lazim ("anak kedua saya yangâ€¦") belum diuji; diperluas bila ada temuan.
  3. Bank keyword hafalan (`SYMPTOM_WORDS`, dsb.) di `patient-extractor.ts` belum dikonsolidasi ke katalog DB â€” sesi ini fokus pada anti-halusinasi entitas, bukan eliminasi seluruh keyword.

---

## 65-legacy. [V3 Architectural Trap] Anti-Pattern Patching Case-by-Case & Split-Brain Heuristik Regex (Sesi 887216) â€” 2026-09-16 (ARSIP)
- **Insiden:** Pada sesi simulator 887216, terjadi rentetan anomali kritis simultan:
  1. Halusinasi Multi-Anak (anak tunggal terbelah menjadi Adik pilek & Kakak 16 bulan).
  2. Pemblokiran pemanggilan tool `get_catalog_and_price` pada giliran pertanyaan durasi & usia.
  3. Halusinasi durasi (mengarang 30 menit lalu berubah 40 menit, aslinya 40 menit).
  4. Misinformasi klinis (anak 16 bulan disarankan paket *Kids Pulih Ceria*, melanggar batas resmi katalog DB di mana 0â€“24 bulan adalah *Bayi*).
  5. Keranjang layanan tertukar ke varian usia tertinggi (*Pijat Kids Pulih Ceria 6â€“8 Tahun* Rp 100.000).
  6. Kaset rusak menodong hari jadwal 4 putaran beruntun pada pertanyaan teknis (Turn 4, 5, 6, 7).
  7. Amnesia keluhan (menanyakan apakah si kecil ada keluhan tepat setelah customer menyatakan anak pilek).
- **Akar Masalah Sistemik (Multi-Layer Root Cause):**
  1. **Anti-Pattern "Make-Up / Case-by-Case Patching"**:
     Alih-alih menyelesaikan pemahaman percakapan secara data-driven melalui Database + Tool Contract + State Machine, commit-commit terdahulu (`c7ade53`, `e8d8fbf`, `882c74e`) menggunakan penambalan reaktif per-kasus audit.
  2. **Pelanggaran Mandat Minimalisasi Regex & Semantic Gatekeeping**:
     - Di `patient-extractor.ts:484`, kata penghubung umum `"kalau"` dimasukkan ke array `hasReferentialMarker` untuk menambal audit 854065 ("kalau anak saya yang umur 2 tahun"). Akibatnya, setiap pertanyaan biasa yang diawali kata *"Kalau..."* langsung mengaktifkan slot anak kedua.
     - Array keyword hafalan (`MOM_COMPLAINT_WORDS`, `SYMPTOM_WORDS`, `hasAnyWord` persona) menduplikasi peran NLU LLM dan memotong konteks bahasa alami.
  3. **Over-Constrained Phase Directive (`context-grounder.ts:344`)**:
     Directive fase `TREATMENT_DISCUSSED` melarang pemanggilan `get_catalog_and_price` kecuali untuk treatment baru, sehingga saat customer bertanya durasi/usia paket yang sedang dibahas, LLM dilarang memanggil tool dan terpaksa berhalusinasi.
  4. **Multi-Tier Collision di Cart Manager (`cart-manager.ts`)**:
     Fungsi `cleanNameOf` memotong kualifikasi usia dalam kurung, menyebabkan 3 varian usia Kids (2-4th, 4-6th, 6-8th) bertabrakan dan di-overwrite oleh varian terakhir di katalog (6-8 tahun).
  5. **Bypass Data Usia Klinis DB**:
     Batas usia klinis (0.5â€“24 bulan untuk Bayi, 24â€“48 bulan untuk Kids 2â€“4th) sudah tersimpan di field `ageTier` tabel `Treatment`, namun tidak diekspos ke grounding sesi ataupun divalidasi via tool saat usia ditanyakan.
- **Mandat Pencegahan (Anti-Recurrence Mandates):**
  1. **DILARANG KERAS** menambal intent dengan menambah kata tunggal ke array token/regex heuristik (seperti menambahkan `'kalau'`).
  2. Pemahaman kesesuaian usia dan layanan WAJIB diserahkan ke tool `get_catalog_and_price` berbasis database, bukan dicegat di lapisan string TypeScript.
  3. Grounding paket perawatan terpilih WAJIB menyertakan metadata durasi resmi dan label rentang usia langsung dari database.
  4. Fase percakapan dilarang memblokir pertanyaan hal teknis seputar layanan aktif.

---

## 66. [Audit Pasca PLAN 8 Fase 0-2a] Audit Kecerdasan & Efisiensi Percakapan â€” Temuan Terbuka (2026-09-16)

- **Status:** open (temuan audit; sebagian belum diperbaiki).
- **Konteks:** Audit menyeluruh diminta user dengan tujuan eksplisit: chatbot harus **efisien, efektif, dan cerdas membalas seperti pemilik klinik sendiri**. PLAN 8 Fase 0-2a sudah dikerjakan (regression gate, graceful shutdown, tenant seam) â€” ketiganya benar secara arsitektur operasional, TAPI **tidak ada satu pun yang meningkatkan kecerdasan atau efisiensi percakapan**. Temuan di bawah adalah akar yang sesungguhnya.

### 66.1 â€” Prompt generasi Call 2 = ~42.000 karakter per putaran, tanpa prompt caching
- **Bukti:** `logs/llm-2026-09-16.jsonl` â€” `V3_GENERATION` `systemPrompt.Length` = **42.436** dan **43.673** karakter (~10.000â€“11.000 token) **per balasan**. Rincian blok:
  - Head statis (identitas + gaya + hierarki + negative constraints + panduan tools) = **5.149 char**. Terbukti **identik antar-turn** (diverifikasi byte-untuk-byte).
  - Tail dinamis (status data + ringkasan konteks + phase directive + few-shot terpilih) = **~37.000 char**.
- **Akar:** `persona.ts` menyuntik blok negative constraints (21 aturan, ~9.600 char) dan blok few-shot ke **setiap** panggilan generation. Tidak ada `cache_control`/prompt caching (grep `cache_control|cached_prompt_tokens` hanya menemukan kolom audit, bukan implementasi).
- **Dampak:** biaya token & latensi per balasan tinggi; ~5.000 char head identik dibayar ulang setiap putaran tanpa manfaat. Inilah penyebab utama "tidak efisien".
- **Arah solusi (fondasional, bukan tambal):** (a) aktifkan prompt caching provider untuk prefix statis; (b) pindahkan sebagian besar aturan statis keluar dari prompt per-turn (mis. ke tes/guardrail deterministik) â€” pertanyaan terbuka: berapa banyak negative constraint yang benar-benar perlu di prompt vs. ditegakkan lewat validator.

### 66.2 â€” Bank few-shot statis mendominasi; tidak ada loop belajar nyata dari koreksi admin
- **Bukti:** `tests`/`logs` menunjukkan 8 panggilan ROUTING untuk **1 customer** dalam satu sesi; bank exemplar `few-shot-exemplars.ts` (648 baris) di-seed dari `GOLD_FEW_SHOT_EXEMPLARS` (hardcoded 312 baris) dan kurasi manual.
- **Akar:** `ENABLE_SELF_LEARNING` default `false` (`.env.example:110`); `self-learning.service.ts:25` early-return bila tidak `true`. Jadi koreksi manual CS ke customer **tidak** otomatis menjadi bahan belajar.
- **Dampak:** sistem tidak benar-benar "belajar seperti pemilik menjawab" â€” perbaikan gaya selalu manual (commit + deploy), bukan dari data produksi.
- **Catatan:** ada `self-learning.service.ts` yang bisa mengekstrak jawaban admin, tetapi **dimatikan** dan tidak jelas apakah kualitas ekstraksinya layak. Ini kandidat ROI tertinggi untuk tujuan "membalas seperti saya".

### 66.3 â€” Skrip seed exemplar menunjuk direktori yang sudah dihapus
- **Bukti:** `scripts/seed-curated-gold-exemplars.ts:18` mengimpor `../src/slot-engine/gold-few-shot-exemplars`, tetapi `src/slot-engine/` **sudah tidak ada** (didekomisioning). Verifikasi: `Test-Path src\slot-engine\gold-few-shot-exemplars.ts` = False.
- **Dampak:** skrip ini pasti gagal bila dijalankan; jalur seed exemplar emas putus. Sama kelas dengan temuan F0-1 (golden runner orphan).
- **Fix:** arahkan ke `src/v3/agent/gold-few-shot-exemplars.ts`.

### 66.4 â€” Regression gate belum mengukur kualitas percakapan
- **Bukti:** `tests/golden-corpus/golden-corpus.test.ts` (baru, Fase 0) menegakkan invarian deterministik (no-silent-drop, format, panjang, retensi slate). Assertion bahasa (`mustContain`) **tidak** ditegakkan karena LLM di-stub.
- **Akar:** tidak ada evaluator kualitas bahasa otomatis pada gate offline. `llm-evaluator.service.ts` ada, tetapi tidak menjadi bagian gate.
- **Dampak:** regresi gaya/kehangatan/ketepatan bahasa **tidak terdeteksi** oleh gate; hanya regresi struktural yang tertangkap. Gate menjawab "sistem tidak rusak", bukan "sistem menjawab seperti saya".
- **Arah solusi:** tambah dimensi evaluasi bahasa (LLM-as-judge dengan rubrik persona) sebagai gate terpisah, dijalankan dengan LLM nyata (bukan offline).

### 66.5 â€” Kualitas env test LLM masih bocor (TD-7 diperkuat)
- **Bukti:** `llm-gateway.ts:35` fallback `https://api.openai.com/v1`; `model-fallback.ts` menempuh `DEFAULT_FALLBACK_CHAIN` saat env kosong. Saat Fase 0 pertama dijalankan, ini menyebabkan **48/50 skenario ter-skip** (401 â†’ eskalasi sunyi).
- **Dampak:** environment test/degradasi tidak benar-benar offline secara default; behavior runtime saat provider bermasalah adalah **eskalasi sunyi tanpa balasan** â€” perlu dikonfirmasi apakah itu memang diinginkan produk untuk outage total.

### 66.6 â€” Fase 0-2a belum menyentuh dimensi tujuan user
- **Ringkas:** Fase 0 = observability gate; Fase 1 = reliability; Fase 2a = tenant foundation. Ketiganya **fondasi operasional** yang benar dan selaras mandat AGENTS.md, tetapi untuk tujuan "efisien, efektif, cerdas seperti saya", prioritas seharusnya mencakup 66.1 (efisiensi token/latensi) dan 66.2 (loop belajar). Peta prioritas ada di `docs/plans/PLAN_8_ARCHITECTURE_FIX.md`.

---

## 67. [Follow-Up] Tumpang-tindih Two Clocks: Sliding Window (inbound) vs Smart Context Guard (`last_message_at`) â€” 2026-09-16

- **Status:** open (tech debt, disengaja ditunda), **pre-existing pada guard**, terekspos oleh fitur baru.
- **Konteks:** Fitur *Event-Driven Last-Chat Sliding Window* (`rescheduleNoPurchaseOnInboundChat`) menambatkan jadwal NO_PURCHASE ke **chat masuk terakhir customer** (`direction: 'INBOUND'`), stage 1/2/3 â†’ +3/+7/+14 hari pukul 09:40 WIB. Hook dipasang di `message.service.ts` `logMessage()` (guard `!isHistorical && !isSandboxCustomer && INBOUND`).
- **Akar masalah (multi-layer):** `processDueFollowUps` masih punya gerbang lama *Smart Context Guard* yang memakai `Conversation.last_message_at` â€” yaitu **aktivitas terakhir apa pun, termasuk balasan bot sendiri**. Jadi ada **dua definisi waktu acuan yang berbeda**:
  - Anchor baru = inbound customer saja.
  - Guard lama = inbound **atau** outbound bot.
- **Gejala nyata (skenario pembuktian):** customer chat pada `T`; bot membalas pada `T+10 menit` (outbound, meng-update `last_message_at`). Stage 1 dijadwalkan `T+3d 09:40`. Saat worker menyapu pada `T+3d 09:40`, guard lama melihat `now - lastMsgAt = 72 jam âˆ’ 10 menit < 72 jam` â†’ mem-postpone lagi. Karena hasil snap `lastMsgAt + 72h` jatuh tidak jauh dari `now`, jalur fallback `now + 24 jam` aktif â†’ **jadwal NO_PURCHASE meleset +1 hari tanpa sebab bisnis**. Balasan bot sendiri menunda follow-up klinik.
- **Dampak:** jadwal "H+3" bisa menjadi H+4/H+5 secara non-deterministik; label UI tetap menampilkan "Hari ke-3" sehingga admin melihat diskrepansi. Tidak ada data yang hilang, hanya presisi penjadwalan.
- **Mengapa ditunda:** memperbaiki berarti menyatukan definisi "chat terakhir" lintas modul (mengubah query worker + semantik `last_message_at`) â€” blast radius menyentuh NEXT_TREATMENT, REMINDER_H1, REVIEW_H1, dan test `follow-up-engine.test.ts:5d`. Butuh keputusan produk: apakah balasan bot boleh menunda follow-up (perilaku sekarang) atau hanya chat customer (konsisten dengan anchor baru).
- **Arah solusi fondasional (bukan tambal):** (a) satukan sumber kebenaran ke `Conversation.last_customer_message_at` untuk **semua** follow-up, atau (b) hapus gerbang cooldown lama sepenuhnya karena sliding window sudah menggantikannya, dan pertahankan satu mesin waktu saja. Opsi (b) lebih bersih bila tidak ada kebutuhan "cooldown pasca-interaksi bot".
- **Bukti kode:** `src/services/follow-up.service.ts` â€” `rescheduleNoPurchaseOnInboundChat` (anchor inbound) vs blok *Smart Context Guard* `if (lastMsgAt && (now - lastMsgAt) < cooldownMs)`.
- **Catatan:** `FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS` (default 72) kini berperan ganda: sebagai sisa guard lama **dan** sebagai kompensasi tidak adanya sliding window. Setelah sliding window stabil di produksi, env ini kandidat untuk dideprecate.

### 67.1 â€” `DELETE /api/admin/reservation/:id` tidak memanggil `onReservationCancelled`

- **Status:** open (pre-existing gap), terekspos oleh fitur `cancel_reason`.
- **Bukti:** grep `onReservationCancelled` di `src/routes/admin/reservations.subroute.ts` hanya menemukan baris **1487** dan **1663** (jalur edit & PATCH status). Jalur `DELETE` (soft-cancel, baris ~1970+) hanya meng-`update` status reservasi menjadi `cancelled` lalu **membuat ulang** NO_PURCHASE â€” tidak pernah membatalkan follow-up yang terikat `reservation_id` tersebut.
- **Dampak:** row `REMINDER_H1` / `REVIEW_H1_*` milik reservasi yang dibatalkan lewat tombol Hapus tetap berstatus `PENDING`/`QUEUED` dan tanpa `cancel_reason`, sehingga berpotensi dikirim untuk treatment yang sudah batal. Ini menurunkan keandalan fitur "Informasi Alasan Pembatalan": admin melihat antrian aktif untuk reservasi yang sudah dibatalkan.
- **Arah solusi fondasional:** panggil `followUpService.onReservationCancelled(id, tenantId)` di jalur soft-delete **sebelum** blok re-create NO_PURCHASE, agar kedua jalur pembatalan reservasi (edit/PATCH vs DELETE) memakai satu lifecycle yang sama.

---

## 69. [Resolusi Siklus Regresi Chatbot & Isolasi Sandbox CAPI] Tech Debt & Tindak Lanjut Manual (2026-09-16)

### 69.1 â€” Ambang klinis usia masih konstanta TS (TODO tenant-aware, Confirmation Gate terbuka)

- **Status:** open (tech debt disengaja, opsi (b) saas-readiness: hardcode sementara + TODO + catat audit).
- **Bukti:** `POSTPARTUM_MAX_CHILD_AGE_MONTHS = 2` (`src/v3/tools/save-reservation.tool.ts`), `NIFAS_MAX_AGE_MONTHS = 2` / `TODDLER_MAX_AGE_MONTHS = 24` (`src/v3/state/goal-tracker.ts`).
- **Mengapa ditunda:** solusi tenant-aware penuh butuh tabel/kebijakan baru (`ClinicPolicy`) + migrasi + refactor grounding â€” infrastruktur baru (trigger Confirmation Gate). Guard fail-closed aktif sekarang; nilai medis 2 bln (nifas) / 24 bln (balita) bersifat universal, bukan brand.
- **Opsi keputusan user:** (a) bangun `ClinicPolicy` per-tenant sekarang; (b) pertahankan konstanta (status quo); (c) pindahkan ke `TenantPromptConfig` eksisting (lebih murah dari tabel baru).

### 69.2 â€” Pembersihan sandbox di live DB WAJIB 2-step verification (BELUM dieksekusi)

- **Status:** open, menunggu verifikasi 2-langkah user (risiko Meta event trigger).
- **Target:** reservasi dummy `5eb70cfb-2daf-4d88-b410-2b2992d7bb87`, customer `09fb4b5d-4198-462c-a952-fb40442eb510`, nomor `628999985269` di database live (produksi), via protokol skill `server-access` (SSH 43.157.197.148:1403).
- **Catatan:** antrean CAPI kini terisolasi di lapis query + presentasi (butir Fase 1' di CHANGELOG) dan pengiriman aktual tetap dijaga CAPI GUARD (`src/services/capi.service.ts:746-753`) â€” cleanup hanya sanitasi data, bukan penutup celah.

### 69.3 â€” Replay simulator Turn 1â€“8 belum dieksekusi (jalur interaktif)

- **Status:** open (verifikasi manual). `npm run chat` interaktif tidak dapat dijalankan agen; skenario Turn 6/7/8 tercakup sebagai unit test (`cart-generic-no-unilateral-lock`, `day-evidence-question-gate`, `catalog-known-symptoms-no-reask`, `booking-commit-ready-gate`) â€” 27/27 hijau.
- **Langkah manual:** jalankan simulator untuk Turn 6 ("pijat balita usia 2 tahun" â†’ tanya pilihan, bukan klaim sepakat), Turn 7 ("Bisa selasa? Tgl 18?" â†’ tanpa record confirmed), Turn 8 ("Biasa kembung..." â†’ tanpa tanya ulang skrining, tahun 2026, tanpa label Nifas).

### 69.4 â€” Kontrak test lama yang mengkodifikasi bug diperbarui (catat keputusan)

- **Status:** fixed (2026-09-16) â€” perubahan kontrak disengaja, bukan regresi.
- **Bukti:** `tests/unit/v3/premature-reservation-guard.test.ts` + `reservation-response-copy.test.ts` sebelumnya mengharapkan kalimat tanya ("bisa kak?", "apakah bisa?") MELOLOSKAN penulisan reservasi â€” persis bug Turn 7 (komit Rp 105.000 atas pertanyaan). Diperbarui ke pernyataan tegas untuk jalur lolos; jalur tanya kini diassert MENOLAK (+1 kasus baru). Same-day (`"kalau siang ini bisa?"`, sesi 138207) SENGAJA dikecualikan â€” catatannya pending ekspektasi-aman agar staf tetap terima antrean cek rute.

---

## 70. [Arsitektur V3] Mandat Penghentian Permanen Solusi Tambal-Sulam & Resolusi Sistemik Bot Diam (Sesi 477412) â€” OPEN / REFACTOR PLANNED

- **Status:** open (rencana refaktor fondasional telah disusun di `docs/plans/CHATBOT_FOUNDATIONAL_ARCHITECTURE_TRANSFORMATION_PLAN.md`).
- **Ditemukan:** 2026-09-16 pada simulasi sesi 477412 (Turn 5 bot diam saat ditanya persiapan & minyak pijat).
- **Gejala:** 
  1. Turn 5: Bot diam membisu (`ðŸŒ¸ [Bot sedang diam - Percakapan dialihkan ke Human Handling / Bidan]`) atas pertanyaan *"Ni kudu nyiapin apa? Pakai baby oil atau minyak telon?"*.
  2. Turn 2 & Turn 4: Asisten memuntahkan 6â€“9 kalimat brosur menu bernomor dan mengulang pertanyaan penutup persis kaset rusak.
  3. Turn 3: Geocoder salah mengeja "Kutisari" menjadi "Kutusari" (Kec. Sukomanunggal) dan meminta shareloc (melanggar Aturan 21).
- **Akar Masalah Sistemik (5 Pola Kegagalan Berulang):**
  1. *The Death Penalty Guardrail*: Di `GuardrailPipeline.verifyAndReprompt`, mismatch nama layanan sekunder pada pertanyaan FAQ langsung mengeksekusi `isEscalated = true; shouldSendReply = false; finalReply = ''`. Bot dibunuh padahal jawaban inti FAQ sudah benar.
  2. *Negative Engineering Overload*: Penumpukan 21 Aturan Emas dengan puluhan larangan "DILARANG" membuat `gpt-4o-mini` mengalami *attention dilution* dan gagal mematuhi batasan 2â€“3 kalimat.
  3. *Tool Over-Triggering*: Router memanggil `get_catalog_and_price` pada pertanyaan FAQ persiapan karena membawa state usia 24 bulan, memicu rantai halusinasi silang.
  4. *Ambiguitas Taksonomi Usia 24 Bulan*: Usia 24 bulan berada di batas skema `BABY (0â€“24 bln)` vs `KIDS (2â€“4 thn)`, menyebabkan pergantian kategori antar-turn yang memicu alarm validator faktual.
  5. *Debugging Berbasis Anekdot*: Pola fixing kalimat per kalimat melahirkan lubang baru di tempat lain.
- **Rencana Tindak Lanjut (Mandat Fondasional):**
  1. Hapus silent drop di `GuardrailPipeline`: terapkan *graceful degradation* (buang paragraf ekstra bermasalah, balasan FAQ tetap dikirim). Bot DILARANG MATI MEMBISU.
  2. Gating tool di Router: pertanyaan FAQ/persiapan DILARANG memicu `get_catalog_and_price`.
  3. Kunci taksonomi usia: deterministik `< 24 bln` = BABY, `>= 24 bln` = KIDS. Pangkas output katalog ke 1 rekomendasi utama + 1 alternatif (anti-brosur).
  4. Perluas gazetteer lokal Surabaya untuk Kutisari & perumahan utama.
  5. Bangun Automated Conversation Matrix Test Suite (20 skenario end-to-end terotomatisasi).



---

## 72. [Pasca-pull origin 2026-09-16] Dua test merah dari commit upstream (bukan regresi PLAN 8/9)

- **Status:** open (milik sesi upstream; didokumentasikan, tidak disentuh).
- **Konteks:** `git pull` membawa 4 commit upstream (03d0e69, 5b5ee43, revert Kenari x2).
  Full suite: 319 files, 2313 passed, 2 failed â€” kedua failure di bawah terbukti
  berasal dari perubahan upstream tersebut, bukan dari PLAN 8/9.

### 69.1 â€” `simulator-minggu-waru-replay.test.ts` Turn 1
- **Bukti:** test (lama, dari 6694f13) mengassert prompt router Call 1 cocok
  `/ABAIKAN.*cekkan\/infokan/i`. Upstream 03d0e69 menulis ulang 5a router
  (verifikasi: `git show 03d0e69 -- src/v3/agent/persona.ts`): frasa tersebut
  DIHAPUS dari prompt router, diganti "WAJIB dahulukan menanyakan daerah rumah...".
  Frasa tetap ada di prompt Call 2 (generasi) â€” perilaku dipertahankan di sana.
- **Bukan dari PLAN 9:** integrasi caching hanya menyentuh Call 2; Call 1 (routing)
  dikirim tanpa perubahan. Untuk provider non-Anthropic, `messages[0].content`
  digabung kembali byte-identik.
- **Arah solusi (pemilik upstream):** perbarui regex test ke wording router baru
  dengan intent sama (lokasi-unknown â†’ tanya domisili), atau pindahkan asersi ke
  prompt Call 2. JANGAN kembalikan frasa lama ke router.

### 69.2 â€” `v3-audit-homecare-fix.test.ts` "tanpa lokasi sama sekali â†’ tetap tersimpan"
- **Bukti:** test lama mengharapkan `executeSaveReservation` sukses tanpa lokasi.
  Upstream menandai gate penolakan booking `@deprecated` (aturan 21) di
  `save-reservation.tool.ts:214`, tetapi sesuatu di jalur masih menolak
  (`res.success === false`). Kemungkinan pekerjaan transisi upstream yang belum selesai.
- **Bukan dari PLAN 8/9:** tidak ada perubahan PLAN 8/9 yang menyentuh
  `save-reservation.tool.ts` maupun reservation gates.
- **Arah solusi (pemilik upstream):** selesaikan penghapusan gate atau perbarui test
  sesuai keputusan aturan 21 yang final.

---

## 73. [PLAN 8/9] Test merah `grounding-catalog-metadata` â€” RESOLVED oleh upstream (2026-09-16)

- **Status:** resolved (oleh commit upstream `c5d1ae3`, bukan oleh PLAN 8/9).
- **Riwayat:** test TDD-red sesi 887216 Fase 2 (file untracked saat ditemukan) mengharapkan
  emitter `Durasi Resmi`/`Batasan Usia` di grounding yang belum ada di `src/`.
  Commit `c5d1ae3` ("inject catalog duration and age tier metadata into cart grounding")
  mengimplementasikan emitter tersebut â€” kedua test kini hijau (terverifikasi).
- **Catatan proses:** entri dokumentasi awal untuk temuan ini sempat hilang akibat
  penulisan konkuren file ini oleh multi-sesi; dinomor-ulang dan dicatat di sini
  sebagai resolved agar tidak dikerjakan ganda.

---

## 74. [Fase 1 Refusal Stop-Gap] Regex REFUSAL_FRAME_RE pada factual-claim-validator.ts (2026-09-17)

- **Status:** resolved oleh Fase 6 K2 (2026-09-17) â€” stop-gap dipensiunkan sebagai jalur primer.
- **Resolusi:** `FactualValidationOptions.isRefusalOrEscalation` (tag struktural dari artefak pipeline: `escalate_to_human` tereksekusi ATAU sinyal deterministik jatuh/vaksin) melewatkan D3 tanpa regex. `REFUSAL_FRAME_RE` dipertahankan sebagai fallback warisan. Test `structural-refusal-tagging` (4/4) + `factual-claim-validator` (9/9) hijau.
- **Konteks:** Skenario `AUDIT-JAILBREAK` (permintaan resep obat keras / dosis obat paracetamol untuk bayi 1 bulan) memicu salah diagnosis pada aturan D3 validator klaim faktual (`factual-claim-validator.ts`). Ketika asisten menolak dengan sopan dan mengarahkan rujukan (*"Sebaiknya Bunda berkonsultasi langsung dengan dokter spesialis anak"*), kata "sebaiknya" memicu `ADVISORY_RE`, sementara penolakan wewenang medis belum dicakup oleh `REFUSAL_FRAME_RE`.
- **Stop-Gap yang Diterapkan:** Memperluas `REFUSAL_FRAME_RE` dengan pola penolakan wewenang medis (`tidak memiliki wewenang`, `tidak dapat memberikan resep`, `konsultasi ke dokter/faskes/RS`, `periksakan ke dokter`). Ditandai eksplisit dengan komentar `// TEMPORARY STOP-GAP (lihat tiket structural-refusal-tagging)`.
- **Rencana Fondasional ke Depan (Fase 3):** Menghindari ketergantungan regex untuk mendeteksi penolakan. Menggantikannya dengan *structured classification metadata* (`isRefusalOrEscalation: true`) yang di-emit langsung dari model / generation stage, sehingga validator klaim faktual secara deterministik dilewati pada pesan yang sifatnya murni penolakan/rujukan medis tanpa klaim SOP klinik.

---

## 75. [Fase 3] Dekomposisi Persona Monolitik â†’ Modular Layered Prompt (2026-09-17)

- **Status:** implemented & verified (zero-regression, byte-identik).
- **Konteks:** `src/v3/agent/persona.ts` (~580 baris) menumpuk 63 instruksi "DILARANG KERAS" dari 8+ audit historis dalam satu ruang konteks monolitik (risiko "fix A rusak C" via kompetisi attention LLM).
- **Perubahan (tanpa perubahan perilaku / tanpa teks prompt baru):**
  - `src/v3/agent/prompt/layers/global-safety.layer.ts` â€” skrining trauma jatuh (audit 337101), aturan vaksin 48â€“72 jam (audit 222655), newborn 0â€“28 hari, anti-overclaim, injection defense. Single source of truth (diimpor fase pricing, bukan diduplikasi).
  - `src/v3/agent/prompt/layers/core-persona.layer.ts` â€” identitas Bidan Yusi, tone WA, kata ganti "kami", format 1-bintang, few-shot statis, sapaan Turn-0/lanjutan.
  - `src/v3/agent/prompt/phases/` â€” `location-rules`, `pricing-catalog`, `scheduling` (termasuk kontrak tool `save_reservation` + mandat POV first-person).
  - `src/v3/agent/prompt/prompt-composer.ts` â€” perakitan berurutan identik; `persona.ts` kini fasad tipis (`PersonaPromptBuilder`, `extractFastIntents`, `PERSONA_STABLE_PREFIX_MARKER` dipertahankan 100%).
  - Tenant-aware tidak berubah: overlay DB `TenantPromptConfigService` + `getBrandIdentityAsync` tetap di composer (tanpa infra baru â†’ tanpa Confirmation Gate).
- **Verifikasi (offline):** diff byte-identik 4/4 varian (router Â±7,8k char, system Â±46k char); `typecheck` exit 0; parity 15/15; tool-masker 10/10 + anti-silent-drop 8/8; safety/persona/cache/router 28/28; corpus 61/61.
- **Full suite:** 2355 passed, 3 failed â€” verified pre-existing, BUKAN regresi Fase 3 (gagal identik dengan `persona.ts` asli via `git stash`): 2 sudah tercatat di #72 (`simulator-minggu-waru-replay`, `v3-audit-homecare-fix`), 1 dari tree kotor Fase 1/2 (`llm-outage-silent.test.ts` "Call-1 LLM throw â†’ sunyi total", pemilik: sesi Fase 1/2).
- **Ditunda sengaja (tech debt):** panduan penolakan resep obat eksplisit di prompt belum ditambahkan (menambah teks = melanggar garansi byte-identik); mengandalkan stop-gap #74 + defleksi SOP vaksin. Tindak lanjut bila ada audit jailbreak-obat khusus.

---

## 76. [Housekeeping + Fase 3.5 + Taksonomi Usia] (2026-09-17)

- **Status:** implemented & verified.
- **Tahap 1 â€” Penyelarasan legacy:** `v3-audit-homecare-fix.test.ts` "tanpa lokasi sama sekali â†’ tetap tersimpan" diselaraskan ke aturan 03d0e69 (fail-closed lokasi): sesi kini `{ kelurahan: 'Kureksari' }` tanpa detail jalan â€” 14/14 hijau. Maksud asli (jalan tak wajib di chat) lestari.
- **Tahap 2 â€” Dynamic Phase Injection (opt-in):** `composeSystemPrompt` menerima `opts.phaseInjection { focus, slim }` + `derivePhaseFocus(session)` murni. Default (tanpa opt) = rakitan penuh byte-identik; `slim:false` = penuh + blok `[PHASE_FOCUS]` volatil (prefix stabil identik â†’ cache hit lestari, teruji); `slim:true` = hierarki pra-marker dirampingkan per fokus. Fasad `PersonaPromptBuilder` meneruskan otomatis (tipe `SystemPromptOpts` dari composer); pipeline produksi tidak diubah (risiko korpus nol).
- **Tahap 3 â€” Taksonomi usia:** `CHILD_CATEGORY_AGE_THRESHOLD_MONTHS=24` + `PatientProfileExtractor.resolveChildAgeCategory` kanonis (<24 BABY, â‰¥24 KIDS); 3 perbandingan tersebar di `treatment-catalog.service.ts` disentralisasi (behavior-identik); `get-catalog.tool` men-snap kategori BABY/KIDS yang kontradiktif dengan usia. Bridge 0-24 bulan (audit 222655) DIHAPUS sebagai kode mati â€” digantikan snap deterministik (terverifikasi via `toddler-bridge-catalog.test.ts` yang tetap hijau lewat jalur baru).
- **Anti-menu brosur:** pool konsultasi (`!showPrices`, tanpa nama spesifik) dipangkas ke 2 teratas pasca-sort (rekomendasi + 1 pelengkap); mode harga & nama eksplisit & klarifikasi nominal tidak tersentuh.
- **Verifikasi:** V3 291/291, korpus 61/61, paritas 15/15, typecheck 0, eval audit LLM 4.77 (ambang 4.50) dengan 0 safety-floor violation. Full suite 2368 hijau / 2 merah pre-existing (`llm-outage-silent` milik Fase 1/2; `simulator-minggu-waru` #72).
- **Catatan layering:** `treatment-catalog.service.ts` mengimpor modul murni `patient-extractor` (tanpa dependensi service â†’ tanpa cycle). Bila lint arsitektur kelak melarang impor servicesâ†’v3, pindahkan resolver ke modul util rendah + re-export (pekerjaan mekanis).

---

## 77. [Agenda 1 Fase 4] Geocoding Hardening Kutisari & Larangan Anjuran Shareloc (2026-09-17)

- **Status:** implemented & verified (Sesi 477412 Turn 3 & Issue #70).
- **Akar masalah ganda (hasil audit):** (1) "Kutisari Indah" tanpa entri Tier-0 jatuh ke fallback Google/LLM yang menebak "Kutusari" Sukomanunggal (Surabaya Barat) â€” Tier-1 gazetteer saja tidak cukup karena fallback produksi tetap dikonsultasikan tanpa landmark hit; (2) 5 pesan `calculate_delivery` menganjurkan "(atau share location...)" yang disalin LLM â†’ melanggar Aturan Emas 21.
- **Perubahan:**
  - `calculate-delivery.tool.ts`: kelima pesan ambigu/generik dibersihkan (cakupan plan 3 baris + 2 temuan investigasi baris 413/422 berpola sama); klausa penjaga "(tanpa menanyakan nomor jalan atau share location)" dipertahankan sebagai pagar instruksi. Jalur shareloc kiriman customer (baris 297â€“298) tidak diubah.
  - `landmarks.ts`: 6 entri Tier-0 (Kutisari Indah/Asri/Regency, Kendangsari YKP, Rewwinâ†’Wedoro/Waru, Pondok Tjandra/Candraâ†’Tambaksumur/Waru, Makarya Binangunâ†’Janti/Waru, Rungkut Mapanâ†’Rungkut Tengah) + 6 kunci `ARTERY_CORRIDORS` (catatan: koridor tinggal di `landmarks.ts`, bukan `gazetteer.ts` â€” resolve via `resolveArteryCorridor` di `gazetteer.ts:232`).
  - `geocoding.ts` (`llmResolveLocation`): 3 contoh grounding (kutisariâ†’Tenggilis Mejoyo, rewwinâ†’Wedoro/Waru, pondok candraâ†’Tambaksumur/Waru).
  - Test `geocoding-kutisari-hardening.test.ts` (4/4): Tier-0 pin via `formattedAddress`, Rewwin & Candra presisi, kontrak anti-solicitation pola `(atauâ€¦share location)`/`tawarkanâ€¦share location` (bukan frasa telanjang â€” koreksi desain test karena teks pengganti plan sendiri memuat klausa penjaga).
- **Verifikasi:** baru 4/4, geocoding eksisting 9/9, V3 295/295, korpus 61/61, typecheck 0. Probe 8/8 kunci baru presisi ke wilayah benar.
- **Catatan mandat:** entri regex mengikuti konvensi berkas (`patterns: RegExp[]`, first-match-wins â€” diverifikasi tak ada pola generik yang membayangi); data geografis merujuk fakta administratif + koordinat plan (bukan katalog/tarif/SOP yang wajib DB).

---

## 78. [Agenda 2 Fase 5] Conversation Matrix 20 Skenario + Temuan Produk (2026-09-17)

- **Status:** implemented & verified â€” `tests/integration/v3-conversation-matrix.test.ts` 20/20 (eksekusi ~3,5 dtk, offline).
- **Arsitektur:** seam resmi `GenerationStage.executeChatCompletion` (stub router kata-kunci + hormat forced/tool-list pipeline) + spy `executeToolByName` untuk fakta tool + verdict `evaluateToolMasking` langsung. Batas kejujuran: stub hanya memerankan pilihan-tool LLM; yang diassert = state sesi, call/exec log, fakta tool, invarian format, verdict masker. Prosa/empati tetap ranah `persona-quality-harness` (4.78, 0 floor).
- **Temuan produk saat pembangunan (diputuskan jujur, bukan disembunyikan):**
  1. **[FIXED] Lead-greeting menelan booking berhari+lokasi:** `mau booking ... Sabtu ... Pepelegi` diklasifikasi sapaan murni (pola `mau booking` tanpa guard hari) â†’ balasan sapaan generik menanyakan lokasi yang sudah diberi. Perbaikan: guard `SPECIFIC_QUESTION_RE` + nama hari/same-day (`senin..minggu`, `hari ini`, `sekarang`) â€” sekelas `besok/lusa` yang sudah ada. `lead-greeting-preservation` 15/15 lestari.
  2. **[RESOLVED â€” cakupan data katalog] KIDS-bapil item terapi ditambahkan:** Menambahkan varian `kids-pulih-2-4th` (Rp85k), `kids-pulih-4-6th` (Rp90k), dan `kids-pulih-6-8th` (Rp100k) ke `DEFAULT_CLINIC_SERVICES` pada `treatment-catalog.service.ts` serta menyelaraskan deskripsi dengan `services_custom.json` agar mencakup kata kunci batuk/pilek/flu/bapil. Skenario CM-01 kini secara deterministik mengembalikan dan mem-pin `Pijat Kids Pulih Ceria (2 - 4 Tahun)` untuk balita 3 tahun. Test unit `symptom-semantic-scorer` & matrix 20/20 hijau.
  3. **[OPEN â€” edge] Hint dua-hari:** `extractTimeHint` memakai token hari PERTAMA ("Sabtu ... ganti Minggu" tetap `sabtu`). Matrix memakai kalimat satu-hari; multi-hari tercatat di sini.
  4. **[NOTED â€” jinak] Sapaan Turn-0 "Bisa homecare ke X?":** pola `bisa homecare` = lead greeting â†’ balasan sapaan (tetap meminta domisili; percakapan lanjut normal).
  5. **[NOTED â€” arsitektur] Call-2 tanpa pesan role:tool:** fakta tool mengalir via grounding system prompt, bukan pertukaran tool-call. Stub echo-gaya-korpus itu vestigial; penulis test wajib assert via `executeToolByName`/sesi, bukan gema balasan.
- **Deviasi naskah-vs-rencana (disengaja, beralasan):** CM-01 tanpa pin nama terapi (butir 2); CM-03 pricelist = mode harga breadth-penuh (trim hanya konsultasi â€” terbukti CM-02T1); CM-06T3 interogatif same-day = PENDING terverifikasi-staf (bukan diblokir; masker konsisten mengizinkan); CM-07T2 fail-closed tanpa lokasi + T4 commit pasca-lokasi; CM-11 teks kelurahan + fix butir 1; CM-12T1 Kureksari (kecamatan-only tak mengunci lokasi â€” by design); CM-15/CM-10 teks presisi; guard slot dipersempit (bare "bisa" menelan coverage-Q); CM-17 teks anti-greeting; CM-18 kontras dua-seam (dosisâ†’silent domain-escalation, resepâ†’tool escalation + handoff sunyi); CM-19 assert di seam data (`cartTotalReply`/`suggestedPriceReply` absent).
- **Verifikasi:** matrix 20/20; korpus 61/61; V3 295/295; typecheck 0; harness 4.78/0-floor. Full suite 2391 hijau / 2 merah pre-existing (`llm-outage-silent`, `simulator-minggu-waru`); regresi koridor (+6 entri Agenda 1) diselaraskan di test pemiliknya.

---

## 79. [Fase 6 Agenda 3] Pruning, Refusal Metadata & Enforce Readiness (2026-09-17)

- **Status:** implemented & verified.
- **K1 â€” Smart time-hint (Issue #78 item 3 CLOSED):** `extractTimeHint` koreksi-dulu: penanda koreksi (`ganti/tapi/melainkan/...`) â†’ token hari TERAKHIR; kolokasi `besok lusa` â†’ `lusa`; aposisi tanpa penanda (`Jumat besok`) tetap first-wins (test CTA lama lestari); filter usia `3 minggu` + frasa khusus lestari (termasuk perbaikan bug `indexOf` â†’ indeks loop untuk `minggu` ganda). Test baru 7/7.
- **K2 â€” Structural refusal (Issue #74 RESOLVED, lihat #74).**
- **K3 â€” De-bloat prompt, EKSEKUSI SEBAGAI KONSOLIDASI MINIMAL (deviasi sadar):** inventarisasi menemukan 6+ file test mem-pin teks yang diusulkan untuk dihapus (`KONDISI A.1`, `MANDAT POV`, `DILARANG MENODONG NAMA/ALAMAT`, `MANDAT TOTAL BIAYA`, invarian cache >20k) â€” tiap pin adalah jejak audit klinis. Yang dipangkas HANYA 2 kalimat duplikat tak-terpin di panduan tool + 1 direktif positif aditif (net âˆ’96 char, 46117â†’46021). De-bloat penuh DITUNDA sebagai tech debt: butuh sign-off per-audit, bukan hapus massal.
- **K4 â€” Enforce readiness:** wiring enforce sudah ada sejak Fase 2; ditambah telemetri `TOOL_MASKING_ENFORCED_APPLIED` (fail-safe try/catch) + test lock-in mode-enforce (filter terbukti) / mode-shadow (penuh). Default tetap shadow (matrix/corpus tak tersentuh).
- **Verifikasi:** V3 308/308, matrix 20/20, korpus 61/61, typecheck 0, harness LLM **4.83** (â‰¥4.50, 0 floor). Full suite 2405 hijau / 2 merah pre-existing (`llm-outage-silent`, `simulator-minggu-waru`).

---

## 80. [Rencana Fondasional] Direct Enforce + Dekomposisi Grounder + Split Router (2026-09-17)

- **Status:** implemented & verified.
- **Fase 1 â€” Enforce default-on + 2 gap resolusi:** `isToolMaskingEnforced()` default true / shadow default false (`.env.example` didokumentasikan); `DAY_EVIDENCE_WORDS` + pencocokan ekspresi-sama `hari ke-N` di `date-confirmation.ts` (paritas 17/17); `resolveCandidateTreatment` di masker (komitmen user + paket bold terakhir asisten; selaras audit 973126 â€” asisten tak bisa menyetujui). Matrix 20/20 lulus DALAM enforce: anaphoric (CM-02T4) & `hari ke-4` (CM-07T4) tertutup.
- **Fase 2 â€” Dekomposisi context-grounder (950 LOC):** `medical-signal-detector.ts` (murni + label DB fail-safe), `booking-commit-gate.ts` (impor date-confirmation kanonis), `phase-resolver.ts`, `fast-response-gate.ts`; grounder = koordinator (prepare/latch/summary/ground) + fasad re-export/delegasi (zero breaking, typecheck 0). Satu-satunya berkas uji yang butuh sentuhan: `internal-label-tanya-jadwal` (cek path sumber dialihkan ke rumah baru; maksud zero-WAHA lestari).
- **Fase 3 â€” Split router Call 1:** `router-tool-routing.layer.ts` + `router-direct-reply.layer.ts`; default byte-identik (seam boundaries teruji); `isSaveReservationMasked` mengganti bullet-20-larangan dengan 1 baris status (teks bullet tak dipin test mana pun); `agent-runner` pre-eval masker (murni, diduplikasi deterministik di generation-stage).
- **Temuan samping:** `queue.test.ts` FIFO gagal sekali di bawah beban full-suite (timer 20â€“600ms) namun hijau isolasi â€” flake beban, tanpa sentuhan V3.
- **Verifikasi:** V3 315/315, matrix 20/20 (enforce), korpus 61/61, typecheck 0, `npm run build` 0, harness 4.71/0-floor. Full suite 2418 hijau / 2 merah pre-existing yang sama.

---

## 80. [LiveChat] Comprehensive Fix & Search-to-Message Direct Integration (2026-09-17)

- **Status:** implemented & verified â€” 5 layer backend+frontend, repair `--apply` 351 baris, drift 0.
- **Akar masalah (audit read-only):** (1) `updateConversationState` selalu menimpa `last_message_at` tiap mutasi status â†’ chat lama melompat tanpa pesan baru; (2) `machine.ts` mutasi prematur `last_message_at` + `logMessage` bot tanpa `waMessageId` (kirim via `sendText` boolean) â†’ ACK/reaksi tak tercocokkan; (3) webhook normal langsung `enqueue` tanpa pre-log â†’ inbound tertahan antrean/LLM; (4) thread API tanpa `focusMessageId` + frontend hanya 50 pesan terakhir â†’ klik hasil "5km" gagal scroll; (5) `isAwaitingReply: true` buta + `isManualUnread` selalu false + ticks sidebar tak ikut SSE.
- **Perubahan:** `livechat.subroute.ts` + `live-chat.service.ts` + `message.service.ts` (param `focusMessageId`, focus-window Â±25 pesan, tenant-aware); `conversation.service.ts` (hapus mutasi palsu, `lastMessageAt` hanya eksplisit) + `machine.ts` (hapus mutasi prematur, teruskan `waMessageId` dari `sendTextDetailed`); `typing.service.ts` (`HumanReplyResult.messageId`, prefer `sendTextDetailed` + fallback); `webhook.route.ts` (pre-log inbound + flag `_preLogged`, guard machine cegah ganda); `LiveChatMonitor.tsx` (loadThread focus, direct-jump, auto-deep-search sekali-per-query, X terpadu, koreksi awaiting/unread, ticks sidebar via `message.status_updated`); `typing.test.ts` (mock seam baru `sendTextDetailed`).
- **Verifikasi:** `npm run build` exit 0; dashboard `vite build` exit 0; `repair-last-message-at --apply` 351â†’0 drift; `check-livechat-sync` drift 0, phantom 163 (by-design), tanpa-ID 880 (INBOUND 281 historis/WA lama, OUTBOUND 599 historis â€” pesan baru kini ber-ID); full suite 327 files 2409 passed / 2 failed pre-existing terbukti di clean tree (`llm-outage-silent`, `simulator-minggu-waru-replay`, ranah prompt LLM, tak tersentuh perubahan ini).
- **Sisa disengaja:** 599 outbound historis tetap tanpa ID (backfill butuh ID WAHA asli, tak tersedia); verifikasi manual "5km"/tombol X/centang realtime di browser belum dieksekusi sesi ini.

---

## 81. [Sesi 391501] Sanitizer Mid-Sentence Mutilation, Rekomendasi 17-Bulan Tanpa Usia, & RAG Keyword Gap (2026-09-17)

- **Status:** Open (Ditunda untuk dikerjakan pada sesi berikutnya). Full staged-phase plan tersimpan di `docs/plans/SESSION_391501_REMEDIATION_PLAN.md`.
- **Ditemukan:** 2026-09-17 saat pengujian chat simulator sesi `391501` (Sidoarjo Banjarmukti Residence, anak 17 bulan + balita 2 tahun).
- **Akar Masalah (3 Temuan):**
  1. **Sanitizer Mid-Sentence Mutilation (`sanitizer.ts`)**: `limitVocativeQuota` menghapus kata "Bunda" kedua tanpa mengecek fungsi sintaksisnya. Kata "Bunda" yang berfungsi sebagai subjek kalimat (`"Bunda hanya perlu menyiapkan..."`) terpotong menjadi `" hanya perlu menyiapkan..."`. Selain itu, penghapusan sapaan yang didahului koma meninggalkan koma menggantung sebelum tanda seru (`"ya,! ðŸ¤—"`).
  2. **Rekomendasi Paket Default Mengabaikan Usia (`treatment-catalog.service.ts` & `goal-tracker.ts`)**: `getDefaultRelaxationService()` tidak menerima parameter `ageMonths`, sehingga anak usia 17 bulan selalu disodori layanan BABY pertama di database yaitu `*Pijat Bayi Ceria Newborn*` (0-6 bulan), bukan `*Pijat Bayi Ceria*` (7-24 bulan).
  3. **RAG Knowledge Chunk Retrieval Gap untuk Persiapan & Minyak (`keyword-enrichment.service.ts` & `faq-corpus.ts`)**: Chunk FAQ `Apa saja yang perlu disiapkan sebelum treatment?` tidak memiliki keywords `bayi`, `baby oil`, `minyak telon`, `matras`, `kudu nyiapin`. Akibatnya, query FTS `"persiapan sebelum pijat bayi"` (dibersihkan menjadi `persiapan bayi`) gagal mencocokkan chunk ini karena ketiadaan token `bayi`, dan malah mencatut chunk tindik telinga atau batuk pilek.
- **Rencana Tindakan:**
  Eksekusi 4 fase sesuai `docs/plans/SESSION_391501_REMEDIATION_PLAN.md`:
  - Fase 1: Proteksi subjek tata bahasa & pembersihan koma di `OutputSanitizer.limitVocativeQuota`.
  - Fase 2: Filter usia data-driven pada `getDefaultRelaxationService(category?, ageMonths?)` & pemanggilan di `goal-tracker.ts`.
  - Fase 3: Pengayaan `KB_KEYWORD_RULES` & sinkronisasi FAQ chunk persiapan ke DB Postgres.
   - Fase 4: Pengujian regresi otomatis deterministik & end-to-end typecheck.

---

## 82. [LLM + DB] Fallback "kendala teknis" sesi simulator 554018 â€” key Kenari kosong & drift migrasi (2026-09-17)

- **Status:** DB fixed & verified; LLM **terbuka â€” butuh aksi user** (isi `KENARI_API_KEY` valid).
- **Insiden:** simulator "mau pijat ceria" â†’ fallback `generation-stage.ts:259` ("sistem kami sedang mengalami kendala teknis").
  Bukti `logs/app-2026-09-17.log`: `V3_AGENT_RUNNER_ERROR "invalid key"` + `[Circuit Breaker: V3 LLM Primary Gateway] 401 ... Response Body: invalid key`
  (2x, 12:56:50 & 12:57:10Z, model `deepseek-v4-1-flash` = default Kenari).
- **Akar 1 (fatal, konfigurasi):** `KENARI_API_KEY` di `.env` KOSONG â†’ `getActiveEndpointConfig` (`ai-models.config.ts:229`)
  jatuh ke `LLM_API_KEY` â†’ `kenari.id/v1` menolak 401. Reproduksi terisolasi (tanpa membocorkan secret):
  `POST https://kenari.id/v1/chat/completions` dengan key efektif yang sama â†’ `401`. Catatan jebakan:
  `GET /models` Kenari bersifat PUBLIK (200 tanpa auth) â€” jangan dijadikan bukti key valid.
- **Akar 2 (pendamping, degraded):** DB lokal ketinggalan 3 migrasi (`tenants.settings` P2022 di `capi.service.ts:600`
  â†’ fallback default) + 2 tabel ada di `schema.prisma` tapi TIDAK PERNAH punya migrasi
  (`tenant_prompt_configs` â†’ prompt persona fallback; `clinic_policies` â†’ FAQ kebijakan kosong).
- **Perbaikan masuk (sesi ini, terverifikasi):**
  1. `migrate deploy`: 3 pending (`ensure_tenants_settings_column`, `message_tenant_wa_message_unique`, `add_followup_cancel_reason`).
  2. Migrasi bedah `20260917000001_add_prompt_policy_tables_align_drift`: CREATE 2 tabel + index,
     `reservations.status SET DEFAULT 'confirmed'` (selaras `@default`), `tenants.settings DROP DEFAULT`
     (selaras schema; kode null-safe di `brand.ts`, `few-shot-exemplars.ts`).
  3. `schema.prisma` Message: `@unique` global â†’ `@@unique([tenant_id, wa_message_id])`, menyelaraskan
     maksud migrasi `20260913000000` (dedup tenant-scoped, aman sandbox). Kompatibel: tidak ada
     `findUnique` by `wa_message_id` di `src/` (semua `findFirst`/`updateMany` + `tenant_id`).
  4. Gate drift `migrate diff --from-url ... --to-schema-datamodel` â†’ `-- This is an empty migration.`
  5. `prisma generate` penuh (dev server `tsx watch` sempat dihentikan karena mengunci DLL engine â€”
     user WAJIB `npm run dev` ulang), `npm run build` (tsc) exit 0, test fokus 10/10
     (`clinic-policy-db-first`, `tenant-settings-resilience`, `dynamic-router-prompt`).
- **Sisa TERBUKA:**
  1. Isi `KENARI_API_KEY` valid di `.env` lalu restart `npm run dev` â€” tanpa ini chat tetap fallback 401.
  2. Key SumoPod lolos autentikasi (`/models` 200) tetapi `POST /chat/completions` â†’ `400` body kosong
     berulang (3 varian payload) â€” **JANGAN switch `ACTIVE_LLM_PROVIDER` ke SUMOPOD** sebelum jelas.
  3. Verifikasi end-to-end simulator menunggu key valid (butuh LLM live, di luar gate offline).

---

## 83. [Revisi Fondasional] Review rencana 6 fase: 60% basi, eksekusi P1â€“P4 versi patuh-mandat (2026-09-17)

- **Status:** implemented & verified (P1â€“P4). Rencana 6 fase diaudit read-only sebelum eksekusi.
- **Verdict review (bukti file:baris):**
  1. Fase 2 death-penalty SUDAH tiada (`guardrail-pipeline.ts:354-371` â€” `shouldSendReply=true` + `SILENT_DROP_PREVENTED`).
  2. Fase 4 `parallel_tool_calls:false` SUDAH (`generation-stage.ts:398`).
  3. Fase 5 taksonomi 24 bln SUDAH (`patient-extractor.ts:30-41`, KNOWN_ISSUES #76).
  4. Fase 6 matrix SUDAH ADA 20 skenario (KNOWN_ISSUES #78) â€” yang baru hanya CM-21/CM-22.
  5. Gap nyata: `closingGuide` buta lokasi/durasi/no-match (`get-catalog.tool.ts:572-576`);
     `sawan` tak dikenal; eskalasi medis diam total (bug keselamatan).
- **Konflik mandat & resolusi (Confirmation Gate â€” disetujui user 2026-09-17, opsi Revisi Fondasional):**
  1. Keyword hardcode vs Non-Hardcode/Anti-Overfitting â†’ DISETUJUI pengecualian sementara via
     seam `medical-keywords.ts` (3 string, matcher boundary-safe). Tech debt: sinonim klinis DB.
  2. Prose closingGuide "DILARANG..." vs Anti-Case-by-Case â†’ diganti kontrak data `closingIntent`
     (6 intent, state-gated pruning, tanpa rewrite output).
  3. Normalizer regex rewrite vs Minimalisasi Regex â†’ GUGUR; diganti enforcement saat compose
     (P2) + filter tingkat kalimat tanpa edit isi (P4 `sentence-salvage.ts`).
- **Pembalikan kontrak disengaja (dicatat agar tak dianggap regresi):**
  1. `medical-silent-escalation.test.ts` + CM-18 T1: diam â†’ balasan keselamatan deterministik.
  2. CM-18 T2: `r2 === ''` â†’ assert panjang sentTexts (harness akumulatif; slice(-1) basi).
  3. Stub matrix cabang tool_choice-forced kini menginferensi asksDuration/inquirePrice/symptoms
     (fidelitas = LLM kompeten; sebelumnya args miskin terbukti di CM-22 T3).
- **Ditunda sengaja (tech debt):**
  1. Separasi router minyak-vs-katalog (Fase 4 plan): tidak ada seam jujur untuk menguji
     eksklusivitas tanpa LLM â€” butuh enforcement di tool_choice/masker dulu.
  2. Skenario penitipan anak: belum ada seam deterministik (kebijakan/biaya penitipan).
  3. `escalate_to_human` tool-level tetap silent-handoff (di luar cakupan P4).
  4. Sinonim klinis DB (pengganti `medical-keywords.ts`) + prompt-caching (66.1) + loop belajar (66.2).
- **Verifikasi:** tsc 0; matrix 22/22; medical 3+5; catalog 18 (intent+grounding+price);
  factual 9 + anti-silent 8 + salvage 5 â€” tanpa regresi.

---

## 79. [Admin Dashboard] 30 tombol Refresh lain belum memakai hard-refresh terpusat

- **Status:** open (tech debt), **pre-existing**.
- **Ditemukan:** 2026-09-17, saat audit laporan "Delivery Fee Tiering duplikat".
- **Konteks:** Laporan duplikasi tier ternyata **bukan bug server** â€” DB `delivery_tiers` bersih
  (7 baris) dan live API `GET /api/admin/delivery-tiers` mengembalikan `LEN=7`. Penyebabnya adalah
  cache SWR klien (`apiRequest` menyimpan GET ke `memoryApiCache` + `sessionStorage` `apiCache:*`,
  TTL 15s). Tombol "Reload" tidak melewati cache tersebut.
- **Perbaikan yang SUDAH dilakukan (fondasional, `packages/admin-dashboard/src/services/api.ts`):**
  1. `getCachedApiResponse(endpoint, { allowStale })` kini **hormat TTL**: entri kedaluwarsa TIDAK
     lagi disajikan untuk hidrasi awal; hanya fallback kegagalan jaringan (`allowStale: true`) yang
     boleh memakai data basi.
  2. Ditambah primitive `refreshApi(endpoint, options)` = `clearApiCache(url)` + `apiRequest(forceFresh: true)`
     untuk semua tombol Reload/Refresh di masa depan.
  3. Tombol Reload `DeliveryTiers.tsx` sudah di-wire ke `refreshApi`.
- **Sisa tech debt (BELUM di-wire ke `refreshApi`):** audit menemukan **31 kontrol Refresh manual di
  20+ file** yang semuanya masih memanggil GET biasa (bisa menyajikan cache 15s bila diklik <15s
  setelah fetch sebelumnya). Daftar lengkap ada di riwayat audit; di antaranya:
  `Overview.tsx`, `Reservations.tsx`, `FinancialAnalytics.tsx`, `MetaCapiQueue.tsx`,
  `FollowUpQueue.tsx`, `FollowUpTemplates.tsx`, `AiEvaluations.tsx`, `ChatMigration.tsx`,
  `ChatExport.tsx`, `CustomerLabels.tsx`, `CustomerDatabase.tsx`, `QuickReplies.tsx`,
  `LandingPage.tsx`, `KnowledgeBase.tsx` (2 queue), `Debug.tsx` (2), `MetaClickCatcher.tsx` (3),
  panel settings (`AiModelSettingsPanel`, `GoogleIntegrationPanel` x2, `DailyReportPanel`,
  `WhatsAppProviderPanel` x2), `TodayTreatments.tsx`, `StaffToday.tsx`.
- **Rencana:** migrasikan bertahap ke `refreshApi` (atau `forceFresh: true`) saat menyentuh file
  terkait. Tidak dijadikan satu PR besar untuk menghindari blast radius 20+ file sekaligus.
- **Verifikasi perbaikan yang sudah ada:** `tests/unit/admin-api-cache.test.ts` (7 test adversarial:
  TTL fresh/expired/allowStale, cache-hit tanpa network, `refreshApi` bypass + replace entry,
  dua refresh berturut selalu hit network, normalisasi endpoint bare).

---

## 80. [Admin API] Respons API admin historis tanpa `Cache-Control` (FIXED 2026-09-17)

- **Status:** fixed 2026-09-17.
- **Gejala:** halaman "Delivery Fee Tiering" menampilkan **14 tier** (7 tier terduplikasi penuh) dan
  validasi "Tier X harus lebih besar dari tier sebelumnya (X)". Buka `/api/admin/delivery-tiers`
  **langsung dari browser** mengembalikan 14, sementara query dari dalam proses app (dan DB, dan file
  `delivery_tiers_custom.json`) mengembalikan **7**. Reload halaman tidak mengubah apa pun.
- **Akar masalah (multi-layer):**
  1. **Server:** route `/api/admin/*` tidak mengirim header `Cache-Control` sama sekali. Tanpa
     directive eksplisit, browser boleh menyimpan respons GET secara heuristik lalu menyajikan payload
     lama pada navigasi langsung/reload â€” inilah yang menampilkan 14 (payload basi) sementara server
     sudah 7.
  2. **Klien:** cache SWR `apiRequest` (`memoryApiCache` + `sessionStorage`) TTL 15s, dan tombol
     Reload tidak mem-bypass cache; `getCachedApiResponse` pun mengabaikan TTL saat hidrasi.
- **Perbaikan:**
  1. `src/routes/admin.route.ts` â€” hook `preHandler` menyetel `no-store` untuk semua `/api/admin*`
     (di-set sebelum auth; 401 pun no-store).
  2. `packages/admin-dashboard/src/services/api.ts` â€” `getCachedApiResponse` TTL-aware +
     `refreshApi()`; `DeliveryTiers.tsx` Reload memakai `refreshApi`.
- **Catatan:** sisa 30 tombol Refresh lain yang belum di-wire ke `refreshApi` tetap dicatat sebagai
  tech debt di #79.
- **Verifikasi:** 52/52 hijau (termasuk assert header `no-store` pada respons 200 & 401).

---

## 81. [DB/Deploy] Tabel `clinic_policies` & `tenant_prompt_configs` tidak ada di DB produksi

- **Status:** open (deployment gap) â€” **memerlukan deploy**, bukan perubahan kode.
- **Ditemukan:** 2026-09-18, saat audit Fase 5 (ClinicPolicy parity).
- **Gejala:** `get_clinic_policy_faq` **selalu** mengembalikan fallback statis (7 topik), tidak pernah
  membaca DB. Query live: `ERROR: relation "clinic_policies" does not exist`.
- **Akar masalah (multi-layer):**
  1. Migrasi `prisma/migrations/20260917000001_add_prompt_policy_tables_align_drift/migration.sql`
     (membuat `clinic_policies` + `tenant_prompt_configs`) dan `scripts/seed-clinic-policies.ts`
     **SUDAH ADA & ter-commit** di `025aa3b1`.
  2. Commit `025aa3b1` **belum di-push ke origin** (local `master` ahead 1) â†’ server (`57e8a0f`)
     belum memilikinya.
  3. `npx prisma migrate status` di server melaporkan "up to date" karena folder migrasi server
     memang belum memuat file itu â†’ blind spot.
- **Dampak:** seluruh SOP klinis (kualifikasi bidan, pembayaran, ongkir multi-anak, pasca-vaksin,
  homebase, jam operasional) dibaca dari kode statis â€” admin **tidak bisa** update via DB.
- **Fix:** deploy commit `025aa3b1` (atau cherry-pick migrasi + seed) â†’ `prisma migrate deploy` â†’
  `npx tsx scripts/seed-clinic-policies.ts`. **Belum dilakukan** (menunggu keputusan user; commit
  `025aa3b1` juga memuat WIP paralel lain).
- **Catatan:** `tenant_prompt_configs` juga belum ada â†’ `TenantPromptConfigService` selalu fallback
  ke `getDefaultConfig()`.

---

## 82. [NLU] Daftar `NON_MONETARY_FOLLOWERS` untuk semantik "berapa" â€” pengecualian berbatas

- **Status:** open (tech debt), sengaja ditunda.
- **Ditemukan:** 2026-09-18 saat Fase 3 (semantik interogatif "berapa").
- **Konteks:** `extractFastIntents` (`src/v3/agent/persona.ts`) kini memperlakukan "berapa" sebagai
  pertanyaan HARGA by-default, kecuali diikuti satuan non-moneter (durasi/usia/kuantitas/jarak).
  Daftar satuan (`menit, jam, bulan, minggu, tahun, usia, umur, anak, orang, km, meter, ...`)
  adalah **whitelist hafalan** â€” sedikit lebih baik dari whitelist kata-biaya lama, tapi tetap rapuh
  terhadap satuan tak terdaftar (mis. "berapa gram", "berapa liter", "berapa sendok").
- **Arah fondasional yang disetujui:** logika "harga by-default" BENAR; daftar satuan adalah
  pengecualian berbatas yang diakui. Idealnya satuan dideteksi via **taksonomi unit terpusat**
  (data-driven, mis. di gazetteer/konfigurasi), bukan array hardcoded di kode.
- **Dampak saat ini:** rendah â€” satuan medis/klinik yang relevan (durasi, usia, jarak, kuantitas)
  sudah terdaftar. Satuan langka yang tak terdaftar akan salah terdeteksi sebagai harga (aman:
  hanya memicu `ask_price`, tidak membocorkan angka).
- **Rencana:** pindahkan daftar ke taksonomi unit terpusat saat menyentuh modul NLU berikutnya.

---

## 85. [Audit Simulator DeepSeek] Clinical Dominance Katalog, DSML Tag Leakage & Escalation Hard-Guards

- **Status:** Fase 1â€“3 implemented & verified. `npm run build` exit 0; full suite **349 hijau / 5 merah pre-existing** (`keyword-enrichment`, `llm-evaluator`, `llm-outage-silent`, `self-learning` Ã—2 â€” semuanya gagal identik tanpa perubahan ini, dibuktikan via stash).
- **Keputusan user (Confirmation Gate):** (1) keluhan medis murni â†’ terapi tunggal WAJIB menang atas paket kombo; (2) infeksi non-akut + komplain fisik pasca-tindakan â†’ eskalasi deterministik HUMAN_HANDLING.
- **Perubahan (fondasional):**
  1. **Sanitizer DSML/XML** (`sanitizer.ts` langkah 1b): hapus `<ï½œï½œDSMLï½œï½œâ€¦>`, `<result>`, `<tool_call>`, `<calls|invoke|parameter>` â€” teknis mesin non-semantik; kata "result" bahasa alami lolos. Test `sanitizer-dsml` 5/5.
  2. **Clinical dominance katalog** (`treatment-catalog.service.ts`): normalisasi tanda baca untuk phrase-match ("batuk, pilek" â†’ "batuk pilek"); penalti âˆ’10 BUNDLE bila input tanpa sinyal cukur/rambut/tindik/paket/selapan; bonus +5 terapi tunggal BABY/KIDS berpenanda terapi yang overlap keluhan. Terverifikasi: "batuk pilek" â†’ Pulih Ceria (21 vs 6), bukan Selapan. Test `treatment-symptom-scoring` 4/4; 53 test katalog eksisting hijau.
  3. **Escalation hard-guards:** `MEDIUM_SEVERITY_MEDICAL_KEYWORDS` + varian non-formal (tali pusar bau, jahitan ngilu, payudara mengeras nyeri) â†’ jalur deterministik `machine.ts` gate medis â†’ HUMAN_HANDLING; bullet `escalate_to_human` dipertajam (komplain purna-layanan, slot spesifik, medis non-spa). Test `escalation-hard-guards` 5/5; `medical_detection` + `medical-silent-escalation` hijau.
- **Sisa & Tech Debt yang disengaja:**
  1. Fase 4 plan (`scripts/run-test-plan.ts --llm`, 50 skenario) butuh LLM live + API key â€” TIDAK dijalankan; daftar manual: `--only 6`, `--only 18`, `--from 31 --to 41`, lalu full `--llm` (target 0 Auto-FAIL, 0 DSML/XML leaks).
  2. Komplain non-medis ("tindik miring", "nyasar terus") hanya via bullet router (LLM memanggil `escalate_to_human`) â€” belum ada gate deterministik pre-LLM untuk komplain; kandidat hardening berikutnya bila LLM masih over-helpful.
  3. Bonus terapi tunggal memakai penanda nama (`terapi|pulih`) â€” sempit tapi eksplisit sesuai plan; bila katalog menambah merek terapi baru tanpa kata itu, perlu penanda metadata `serviceType` sebagai gantinya.

---

### Batch 1 Audit Percakapan Nyata Pelanggan (September 2026)

- **Tanggal & Sesi:** 18 September 2026 â€” Evaluasi 10 Kasus Percakapan Utuh Real Database (Batch 1: Kasus #01 s/d #10, 494 Turns).
- **Temuan & Pelanggaran Terdeteksi:**
  1. **Aturan Emas #2 (Bocor Harga Tanpa Ditanya):** Terdeteksi 2 insiden kritis (Kasus #1 Turn 5 & Kasus #4 Turn 4) di mana bot menyertakan nominal harga padahal customer baru menanyakan paket atau konsultasi keluhan kembung. Akar masalah: payload output tool `get_catalog_and_price` tetap menyertakan field harga (`price_formatted`) ke context LLM walau parameter `inquirePrice !== true`.
  2. **Aturan Emas #3 (Bocor Durasi Menit):** Terdeteksi 1 insiden di Kasus #8 Turn 5 di mana durasi 45 menit disebut tanpa ditanya customer.
  3. **Aturan Emas #5 (Afirmasi Jadwal Sebelum Lokasi):** Terdeteksi 1 insiden di Kasus #1 Turn 6 di mana bot menggunakan frasa "Bisa banget Bunda" sebelum lokasi diketahui.
  4. **Aturan Emas #1 (Melebihi 2-3 Kalimat):** Terdeteksi 35x balasan sepanjang 4-6 kalimat saat menjelaskan manfaat klinis gabungan.
  5. **Aturan Emas #6 (Overuse Sapaan Bunda):** Terdeteksi 5x penggunaan sapaan "Bunda" >1x dalam chat lanjutan.
- **Rencana Mitigasi Fondasional yang Ditunda (Menunggu Selesai Pengujian Seluruh Batch):**
  - Penerapan *Information Hiding* pada `get-catalog.tool.ts` (strip field nominal harga jika `inquirePrice !== true`).
  - Strict masking durasi `(XX menit)` jika `asksDuration !== true`.
  - Sentence splitter deterministik di `guardrail-pipeline.ts` untuk memangkas balasan > 3 kalimat.
  - Sanitizer token limiter untuk sapaan "Bunda".

---

### Batch 2 Audit Percakapan Nyata Pelanggan (September 2026)

- **Tanggal & Sesi:** 18 September 2026 â€” Evaluasi 10 Kasus Percakapan Utuh Real Database (Batch 2: Kasus #11 s/d #20, 319 Turns).
- **Temuan & Pelanggaran Terdeteksi:**
  1. **Aturan Emas #16 (Amnesia Lokasi pada Chat Panjang):** Terdeteksi pada Kasus #11 Turn 34 & 36 di mana setelah 30+ putaran chat mengenai jadwal dan keluhan, bot kembali menanyakan "boleh info daerah rumahnya di mana yaa?" padahal customer sudah menyebutkan "Surabaya Barat, Gadel Timur" di Turn 5â€“6. Akar masalah: ringkasan sesi dan context window LLM pada turn-turn akhir tergeser oleh riwayat panjang jadwal sehingga prompt kehilangan penekanan lokasi tersimpan.
  2. **Aturan Emas #2 (Bocor Harga Tanpa Ditanya):** Terdeteksi 1 insiden di Kasus #19 Turn 4 ("ongkir promo Rp 15.000") saat customer menanyakan kemungkinan memijat 2 anak sekaligus tanpa menanyakan nominal biaya.
  3. **Aturan Emas #3 (Sebut Durasi Tanpa Ditanya):** Terdeteksi 1 insiden di Kasus #17 Turn 3 ("1â€“2 menit secara berkala") pada penjelasan edukasi posisi tummy time *chest-to-chest*.
  4. **Aturan Emas #5 (Afirmasi Jadwal Sebelum Lokasi):** Terdeteksi 2 insiden di Kasus #14 Turn 2 dan Kasus #18 Turn 2 di mana bot membuka dengan kalimat "Bisa banget Bunda" sebelum lokasi customer teridentifikasi.
  5. **Aturan Emas #1 (Melebihi 2-3 Kalimat):** Terdeteksi 28x balasan melebihi 3 kalimat (4â€“7 kalimat), terutama saat menguraikan jam operasional 08.00â€“17.00 WIB, rute harian, dan penjelasan keluhan klinis.
  6. **Aturan Emas #6 (Overuse Sapaan Bunda):** Terdeteksi 11x kemunculan sapaan "Bunda" >1x dalam satu balasan lanjutan atau >2x di pesan greeting.
  7. **Anomali & Bug Teknis Sistem:**
     - **Crash Unhandled Exception `few-shot-exemplars.ts:608`:** Di Kasus #11 Turn 4, bot membalas `[ERROR SYSTEM]: Cannot read properties of undefined (reading 'symptoms')`. Akar masalah: fungsi `selectRelevantExemplars` memanggil `extraction.symptoms.some(...)` dan `.length` tanpa safe navigation / fallback array `(extraction.symptoms || [])`, sehingga crash ketika objek ekstraksi tidak memiliki field `symptoms`.
     - **Reset Greeting di Tengah Obrolan (9 Turns):** Pada Kasus #11 T6/T8, Kasus #13 T3/T15/T20, Kasus #14 T7, Kasus #15 T8/T10, dan Kasus #20 T5, bot tiba-tiba mengirimkan pesan perkenalan awal: *"Halo Bunda... Terima kasih sudah menghubungi kami di Kala Moms and Baby Spa. Ada yang bisa Bidan kami bantu..."*. Akar masalah: pada pesan customer yang sangat singkat (misal hanya menyebut nama kelurahan atau nama paket), Call 2 LLM menghasilkan balasan kosong/undefined yang ditolak oleh `OutputSanitizer.isValidReply`, lalu guardrail pipeline secara keliru menggantinya dengan template sapaan awal (`genderGreeting` + `brand.businessName`).
- **Poin Positif & Kepatuhan Tinggi di Batch 2:**
  - **Tool Masking Integritas Transaksi:** 100% patuh, nol pemanggilan `save_reservation` prematur atau spekulatif.
  - **Deteksi Komplain & Medical Safety Escalation:** 
    - Kasus #20 Turn 16: Komplain customer mengenai posisi tindik telinga kanan yang miring (*"Ini setelah tindik kok posisinya agak miring ya bu telinga kanannya"*) berhasil dideteksi secara tepat dan langsung mengeksekusi `escalate_to_human`, diikuti transisi senyap (*silent handoff*) ke CS manusia.
    - Kasus #18 Turn 17: Balita 2 tahun dengan batuk pilek 1 minggu dan sudah minum obat tanpa perbaikan berhasil dieskalasi ke manusia untuk evaluasi medis lebih lanjut.
  - **Akurasi Spatial RAG & Geocoding:** Perhitungan jarak dan promo ongkir via OpenRouteService terbukti akurat: Semolowaru (11.6 km, promo Rp 15.000), Sawotratap (6.0 km, promo Rp 5.000), Siwalankerto (8.5 km, promo Rp 10.000).

---

### Batch 3 Audit Percakapan Nyata Pelanggan (September 2026)

- **Tanggal & Sesi:** 18 September 2026 â€” Evaluasi 10 Kasus Percakapan Utuh Real Database (Batch 3: Kasus #21 s/d #30, 278 Turns).
- **Temuan & Pelanggaran Terdeteksi:**
  1. **Aturan Emas #2 (Bocor Harga Tanpa Ditanya):** Terdeteksi 3 insiden kritis di mana bot menyebut nominal ongkir atau tarif paket:
     - Kasus #24 Turn 5: Customer hanya menyebut `"Sawahan mba"`, bot langsung menyebut nominal *"Ongkirnya tetap sama ya, cukup Rp 20.000 (promo dari normal Rp 25.000)"*.
     - Kasus #25 Turn 8: Customer mengatakan `"Mau pijat hamil mbak."`, bot langsung membocorkan rincian tarif *"promo jadi Rp 90.000... ditambah ongkir promo ke Bungurasih Rp 5.000, total keseluruhannya menjadi Rp 95.000"* padahal customer belum menanyakan harga/ongkir.
     - Kasus #29 Turn 5: Customer menyebut kelurahan `"Kel : Buduran"`, bot menyebut *"ongkirnya tetap sama ya Rp 20.000 (promo)"*.
  2. **Aturan Emas #16 (Amnesia Lokasi pada Percakapan Lanjut):** Terdeteksi berulang pada Kasus #25 (Bungurasih), Kasus #26 (Jambangan), dan Kasus #29 (Damarsih) di mana bot kembali menanyakan alamat/kelurahan saat customer menanyakan ketersediaan slot hari/tanggal lanjutan.
  3. **Aturan Emas #5 (Afirmasi Jadwal Sebelum Lokasi):** Terdeteksi 1 insiden di Kasus #28 Turn 2 (*"Bisa banget Bunda ðŸ˜Š"* sebelum lokasi diverifikasi).
  4. **Aturan Emas #1 (Melebihi 2-3 Kalimat):** Terdeteksi 36x balasan sepanjang 4â€“6 kalimat saat menguraikan rute dan keunggulan paket.
  5. **Aturan Emas #6 (Overuse Sapaan Bunda):** Terdeteksi 6x kemunculan sapaan Bunda >1x dalam chat lanjutan atau >2x di greeting.
- **Poin Positif & Respon Empati Kunci:**
  - **Tool Masking Mutlak (0x `save_reservation`):** 100% patuh di seluruh 278 turns.
  - **Penanganan Kedukaan & Pembatalan (Kasus #30 Turn 23â€“26):** Ketika customer mengabarkan mertua meninggal dunia (*"Mertua saya meninggal pagi ini... besok masih mau masuk peti"*), bot menunjukkan empati alami yang sangat menyentuh (*"Innalillahi wa inna ilaihi raji'un... Turut berduka cita yang sedalam-dalamnya... Bunda tidak perlu memikirkan jadwal treatment dulu, urus dan dampingi keluarga..."*), membatalkan jadwal tanpa mendesak reservasi ulang.
- **Investigasi Mendalam Akar Masalah Kasus #26 (Loop Tanya Alamat 6x di Jambangan):**
  - Customer menyebut `"Jambangan"`, lalu merinci `"Jambangan persada no 36"`, lalu patokan `"Gang Depannya pemadam kebakaran jambangan"`.
  - Akar masalah: `geocodingService` hanya memetakan Jambangan ke level Kecamatan (`isPrecise: false`) karena *Jambangan Persada* belum ada di gazetteer kelurahan/landmark lokal. Akibatnya, `calculate_delivery` mengembalikan `success: false` terus-menerus dan melarang penguncian lokasi di sesi. Ketika customer menanyakan slot hari di Turn 7, 8, 9, dan 11, aturan hardcode *"Wajib tanya lokasi sebelum pastikan jadwal"* terpicu berulang-ulang tanpa henti. Solusi fondasional: bila customer sudah memberikan nama perumahan/gang di dalam kecamatan yang terdeteksi, sistem harus mengunci titik sentroid kecamatan sebagai fallback operasional daripada mengulang pertanyaan kelurahan secara kaku.

---

### Batch 4 & 5 Audit Percakapan Nyata Pelanggan (Kasus #31 s/d #50 â€” MQL & Edge Cases)

- **Tanggal & Sesi:** 18 September 2026 â€” Evaluasi 20 Kasus Terakhir (Kasus #31 s/d #50, 199 Turns). Melengkapi total 50 Kasus (1.290 Turns) Pengujian Database Nyata.
- **Temuan & Pelanggaran Terdeteksi:**
  1. **Aturan Emas #2 (Bocor Harga Tanpa Ditanya):** Terdeteksi 3 insiden kritis:
     - Kasus #39 Turn 3: Customer hanya menyatakan `"Mau treatment paket laktasi"`, bot merinci *"Promonya Rp 85.000 (normal Rp 110.000)... Ditambah ongkir promo ke Ponokawan (Rp 25.000), total keseluruhannya menjadi Rp 115.000"*.
     - Kasus #47 Turn 5: Customer hanya mengirim pancingan `"Halo kak?"`, bot menyahut *"Jadi tadi sudah kami sampaikan kalau ongkir ke Jajar Tunggal sedang promo jadi Rp 15.000 saja"*.
     - Kasus #49 Turn 3: Customer mengoreksi domisili `"Bukat rungkut bu bid, siwalankerto, kelurahan nya siwalankerto, kec. Wonocolo"`, bot menyebut *"ongkirnya tetap Rp 10.000 (promo) ya"*.
  2. **Aturan Emas #5 (Afirmasi Jadwal Sebelum Lokasi):** Terdeteksi 4 insiden di mana bot menyambut dengan frasa *"Bisa banget Bunda ðŸ˜Š"* saat customer bertanya jadwal/katalog sebelum wilayah rumah terverifikasi (Kasus #31 T3, #33 T2, #43 T9, #48 T6).
  3. **Aturan Emas #1 (Melebihi 2-3 Kalimat):** Terdeteksi 52x balasan sepanjang 4â€“6 kalimat, didorong oleh penjelasan rute dan rekomendasi komprehensif.
  4. **Aturan Emas #6 (Overuse Sapaan Bunda):** Terdeteksi 8x penggunaan Bunda berlebih.
- **Poin Positif & Kepatuhan Arsitektural Seluruh 50 Kasus:**
  - **Tool Masking Keamanan Transaksi:** 100% patuh di seluruh 50 kasus (1.290 turns). Tool `save_reservation` **0x terpanggil prematur**.
  - **Spatial RAG Jarak & Ongkir:** Geocoding gazetteer lokal dan ORS API bekerja sangat presisi di perumahan-perumahan utama (Pondok Tjandra 5.2 km, Bratang Gede 12.6 km, Damarsi Buduran 15.6 km, Jajar Tunggal Wiyung, Ponokawan Krian).
   - **Integritas Medis & SOP Jam Operasional:** Bot teguh menolak permintaan malam hari di atas pukul 17.00 WIB (Kasus #13 & #50), konsisten menawarkan slot operasional 08.00â€“17.00 WIB.

---

## 86. [Holistik Fondasional] 6 Guard Deterministik Audit 50 Kasus (2026-09-18)

- **Status:** implemented & verified â€” eksekusi celah (gap) yang belum dikerjakan sesi paralel; yang sudah ada di-reuse + dikunci test.
- **Audit read-only:** crash `symptoms` + greeting-reset TERKONFIRMASI; get-catalog hiding SUDAH ada (sisa asksDeliveryFee); file plan `location-rules.ts` tidak ada (aktual `location-rules.phase.ts`, statis â€” pruning Call-1 sudah ada, sisa Call-2); centroid terkonfirmasi + `getGazetteerCoordinates` tersedia untuk reuse; `limitVocativeQuota` SUDAH ada (sisa trimmer + tone guard).
- **Perubahan:** (1) guard `(intents/symptoms||[])` di `selectRelevantExemplars` + `buildInvalidReplyFallback(isFollowUp)`; (2) `asksDeliveryFee` di `calculate_delivery` (schema+registry, nominal disembunyikan bila false); (3) `buildLocationHierarchyBlock(session)` + pin `[LOKASI TERKUNCI]` di `buildContextSummary`; (4) centroid kecamatan via gazetteer (`success:true isEstimatedCentroid`, tanpa tandai QUOTED, tanpa todong kelurahan bila ada detail); (5) `trimToMaxSentences` (3 kalimat, satu-paragraf) + `applyPreLocationTone` di gate akhir pipeline; helper `hasStreetAddressDetail` diekstrak ke `geocoding.ts` (reuse).
- **Regresi yang diperbaiki saat implementasi:** token typo kecamatan ("memganti") + artefak tag `<customer_message>` + kata jauh ("Alhamdulillah") sempat memicu centroid palsu â†’ adjacency Â±1 + stopword pronomina; 2 kontrak lama diselaraskan (`agent-runner` Trosobo pakai `asksDeliveryFee:true`, `anti-silent-drop` ekspektasi recovery baru).
- **Verifikasi:** 6 file uji baru + TDD merahâ†’hijau tiap fase; `tsc` 0, `npm run build` 0; full suite 355 hijau / 4 merah pre-existing terbukti di clean tree (`keyword-enrichment`, `llm-evaluator`, `llm-outage-silent`, `self-learning`).
- **Sisa disengaja:** live matrix `--llm` (kasus 11/19/24/25/26/39) butuh LLM live â€” belum dieksekusi; trimmer hanya satu-paragraf (balasan katalog multi-paragraf tidak dipotong).

---

## 87. [Rule 2/5/6] Batch 1 Kasus #01â€“#10 â€” Information Hiding Berlapis & Commitment Gate (2026-09-18)

- **Status:** implemented & verified (batch 1 live `--llm`). Sisa pelanggaran = audit false-positive, bukan kebocoran.
- **Konfirmasi multi-layer root cause (audit read-only):**
  1. **Rule 2 jalur 1 (payload tool):** `tool-pipeline.ts` mem-push `JSON.stringify(toolResult)` ke `messages` LLM; `calculate_delivery` mengembalikan `ongkirNormal/ongkirPromo` walau `asksDeliveryFee=false`. `numeric-fact-validator` justru MENGOTORISASI angka tsb â†’ tidak menahan.
  2. **Rule 2 jalur 2 (grounding prompt):** `GoalTracker.formatGoalSessionForPrompt` menyuntik `â€¢ Ongkir: Rp ...` tanpa gating; `V3ConversationSummarizer` menyebut nominal di ringkasan; exemplar statis (`core-persona` Contoh 5) & dinamis DB (`location_ongkir_confirmation`) memuat nominal untuk pesan LOKASI-SAJA â†’ LLM menyalin.
  3. **Rule 5:** `tool-masker.evaluateToolMasking` hanya cek treatment+location+tanggal; `isDateConfirmed` meloloskan kalimat hari non-tanya.
- **Perubahan fondasional:** (1) `applyFeeInformationHiding` â€” properti nominal di-OMIT dari payload LLM, nilai asli dipindah ke `__internalOngkir*` (state sesi tetap utuh) + `ToolExecutionPipeline.buildLlmSafeToolPayload`; (2) state-gated pruning `priceDiscussed` pada `formatGoalSessionForPrompt`, `V3ConversationSummarizer`, `FEE_INFORMATION_HIDING_PIN` di `buildLocationHierarchyBlock`, `FEW_SHOT` Contoh 5â†’6 + scrub rupiah exemplar via `formatExemplarsForPrompt(hidePrices)`; (3) sticky `session.bookingCommitConfirmed` (latch di `applySessionLatches` dari `hasBookingCommitSignal`) diwajibkan di `tool-masker` + `isBookingCommitReady`; (4) `limitVocativeQuota` mencakup varian `bund`/`bun`; (5) `trimToMaxSentencesPreservingGreetingHeader` + `hasStructuredContent` (prosa multi-paragraf dipangkas, senarai/formulir dilindungi).
- **Verifikasi live (534 turns):** Rule 1 24â†’10, Rule 2 8â†’0 kebocoran lokasi-murni (7 sisa = false-positive saat customer memang tanya harga), Rule 3 4â†’0, **Rule 5 3â†’0**, Rule 6 5â†’1. Turn 2 Kasus #1 ("Di tenggilis kak") kini hanya konfirmasi jangkauan tanpa nominal.
- **Sisa disengaja / risiko:** (a) audit script `scratch/audit-batch1-post-fix.ts` memakai regex kasar (menghitung "brapa mbak" sebagai bukan-tanya) â†’ false-positive; (b) **temuan baru belum diperbaiki:** Kasus #8 Turn 14 â€” customer menyebut "Selasa tgl 18 agt" tetapi reservasi tercatat "Selasa, 22 September 2026" (date grounding mismatch, bukan Rule 5); (c) full suite 4 file merah pre-existing (`keyword-enrichment`, `llm-evaluator`, `llm-outage-silent`, `self-learning`) â€” bukan dari sesi ini.
- **Catatan insiden:** saat refactor `location-rules.phase.ts`, `git checkout` tak sengaja membuang perubahan uncommitted `buildLocationHierarchyBlock` (perubahan sesi paralel); fungsi dipulihkan kembali dari jejak baca + build hijau.

---

## 88. [Fase 1/2/5/6] Deterministic Tool-Arg Gate, KM Hiding, Grammar-Aware Quota & Greeting Compact (2026-09-18)

- **Status:** implemented & verified. Fase 3 (commitment) & Fase 4 (router affinity) DILEWATI â€” sudah selesai di entri #87 (audit Rule 5 = 0, Turn 2 lokasi â†’ `calculate_delivery` benar).
- **Bukti root cause Fase 1 (log `logs/llm-2026-09-18.jsonl`):** idx 475 `V3_ROUTING` mengisi `asksDeliveryFee: true` pada pesan MURNI LOKASI "Wisma indah 2 K5 gunung anyar tambak" â†’ idx 476 payload tool memuat `ongkirNormal:25000,ongkirPromo:15000`. Information Hiding berbasis flag LLM = rapuh. **Temuan tambahan:** `get_catalog_and_price` bocor via `targetPrice` halusinasi (LLM isi `targetPrice:60000` pada pesan "1 jam" â†’ `showPrices=true`).
- **Perubahan fondasional:**
  1. **Deterministic Tool-Arg Gate** di `tool-pipeline.ts`: `asksDeliveryFee`/`inquirePrice` dipaksa dari `extractFastIntents` (kamus terpusat); `targetPrice` dihapus bila tak ada nominal eksplisit di teks customer. Helper `detectPriceIntent`.
  2. **`extractFastIntents` diperkuat:** token nominal wajib diawali angka (anti "K5" alamat dianggap "5k"); `total`/`totalnya` masuk cost-word.
  3. **KM hiding:** `applyFeeInformationHiding` juga menyembunyikan `distanceKm` (â†’ `__internalDistanceKm`); template jangkauan `calculate_delivery` (non-transaksional) tidak lagi menyebut "berjarak sekitar X km" (Aturan Emas 20).
  4. **Grammar-aware quota:** `limitVocativeQuota` melindungi objek preposisi ("untuk Bunda", "ke Bunda") dari mutilasi, tetapi objek tetap menghabiskan kuota (kontrol overuse). Proteksi subjek kini juga menghabiskan kuota.
  5. **Greeting compact:** `TEMPLATES.greeting`/`firstContactGreetingHeader` dipadatkan jadi 2 kalimat; few-shot Contoh 1 diselaraskan.
  6. **Trimmer fix:** `trimToMaxSentences`/`truncateToMaxChars` kini mengenali batas kalimat setelah `)`/`*`/quote (anti under-count pada "... (fokus bahu).") dan mengabaikan titik penomoran daftar ("1. ").
- **Verifikasi:** build 0 error; full suite 357 hijau / 5 file merah PRE-EXISTING (`keyword-enrichment`, `llm-evaluator`, `llm-outage-silent`, `self-learning`, `live-chat-reply` berbagi akar `resolveChunkKeywords` 'kabel olor'). Live Kasus #1 (89 turns): **Rule 1 = 0, Rule 5 = 0, Rule 6 = 0**; Turn 1 tepat 2 kalimat.
- **Sisa disengaja / risiko:** (a) Rule 2/Rule 3 yang tersisa pada audit = **false-positive** (customer memang menyebut nominal "975k"/"900k" atau membahas durasi "1 jam"); audit regex belum mengenali nominal telanjang. (b) Rule 8 (kasus rusak) 1 turn â€” di luar scope. (c) `live-chat-reply`/`keyword-enrichment` merah karena gap keyword 'kabel olor' (pre-existing). (d) Date-grounding mismatch Kasus #8 (dari #87) masih terbuka.

---

## 89. [Plan Regresi] Eksekusi 6 Fase Oksitosin/Cart/Nominal/Sanitizer/Lokasi (2026-09-18)

- **Status:** implemented & verified. Verdict audit: plan SUDAH fondasional (multi-layer root cause, data-driven, state-gated, hapus-bukan-tambah) â€” BUKAN tambal-sulam. Dieksekusi penuh dengan 3 deviasi terdokumentasi di bawah.
- **Verifikasi klaim plan (read-only):** `applyPreLocationTone` âœ… masih ada; `limitVocativeQuota` âœ… ada TAPI sudah punya proteksi subjek/preposisi (klaim "replacement string kosong" basi); hardcoded `CLINICAL_PROBE` âœ… ada (baris bergeser 564/576â†’615); fallback buta `'Si Kecil'` âœ… (`goal-tracker.ts:380`); validator buta `targetPrice` âœ… (signature `{name,result}` tanpa args); fuzzy-scan cart âœ…; hafalan `s.id.includes('moms'/'laktasi'/'kelahiran')` âœ… 6 titik + `name.includes('laktasi')`; masker `calculate_delivery` âœ… deterministik; ingestion `session.location` âœ… ada (`applyToolEffectsToSession`). `logs/llm-2026-09-18.jsonl` yang diklaim plan TIDAK ADA di repo (klaim sumber tak terverifikasi â€” root cause tetap terbukti via kode).
- **Perubahan per fase:**
  1. **Sanitizer:** `applyPreLocationTone` dihapus total (fungsi + pemakaian `guardrail-pipeline.ts` + 2 test); nada pra-lokasi didelegasikan ke `location-rules.phase.ts` (sudah mencakup). `limitVocativeQuota` TIDAK di-rewrite (hindari regresi 391501) â€” ditambah proteksi gramatikal subjek klausa relatif (`RELATIVIZER_BEFORE_RE`: "yang Bunda maksud/tanyakan" utuh, tetap hitung kuota). Bug mutilasi TERBUKTI via TDD merah (`"layanan yang maksud"`) lalu hijau.
  2. **Audience bundle:** `resolveServiceAudience()` â€” derivasi KOMPOSISI `bundleItemIds` (tanpa migrasi DB, tanpa hafalan ID). **Deviasi plan:** plan minta field `targetAudience` eksplisit per layanan (= migrasi Prisma + backfill); derivasi mencapai acceptance criteria sama (paket oksitosin â†’ `[Untuk Bunda]`) dengan biaya nol. 7 hafalan ID dihapus (`filterServicesByAudience` 6 titik + `matchServicesBySymptoms` 1 titik). `detectRecipientScope` param `audience?` opsional (backward-compat); `goal-tracker.ts:380` fallback audience-aware (MOMS/momProfile â†’ 'Bunda').
  3. **Konsultasi vs transaksi:** `CustomerGoalSession.discussedTreatments` baru; gerbang tanda-tanya di `syncCartItems` (`?` tanpa verba komitmen/`DAY_EVIDENCE_WORDS`/sticky flag â†’ discussed, bukan cart; reuse `hasBookingCommitSignal` â€” tanpa daftar kata baru). Tawaran asisten yang ditolak gerbang ikut tercatat konsultasi.
  4. **Validator:** `ExecutedToolCall.args` di-threading (pipeline SUDAH bawa args; hanya signature validator yang buta) â†’ `args.targetPrice` masuk `authorizedNumbers`. Violation+reprompt otomatis padam untuk kutipan tawar.
  5. **Closing:** `CatalogSessionContext` += `discussedTreatments`/`targetAudience` (diisi `tool-pipeline` dari sesi); `CLINICAL_PROBE` + `suggestedConsultationReply` audience-aware (ibu â†’ skrining Bunda hamil/nifas/menyusui; discussed â†’ larangan skrining ulang + arah jadwal/domisili). Kontrak `closingIntent` (nama intent) dipertahankan â€” 7 test lama hijau.
  6. **Lokasi:** masker `calculate_delivery` TERBUKTI menutup "Di tenggilis kak" (root cause amnesia di KODE, bukan prompt) â†’ `hasNewLocationEntity` + token inti kecamatan (â‰¥6 huruf, kata utuh, cache lazy gazetteer; "Waru" 4 huruf tetap tertutup anti-asumsi basecamp). **Deviasi plan:** prioritas Call-1 TIDAK dituang prose prompt (itu make-up); dikunci test deterministik (masker buka + ingestion tersimpan).
- **Regresi ditemukan & diperbaiki:** `v3-audit-homecare-fix` Layer 2 ("bedanya X dengan Y apa?" â†’ cart kosong) â€” test lama mengabadikan penguncian sepihak atas pertanyaan perbandingan; diselaraskan ke kontrak mandat (cart kosong + discussed terisi + kontrol komitmen deklaratif tetap isi 1 item anti-collision).
- **Verifikasi:** `tsc`/`npm run build` 0; gate per-fase hijau (F1 20, F2 12+48, F3 9+62, F4 5+38, F5 12+42, F6 3+43); matrix 22/22 tiap gate. Full suite: **2709 passed / 40 failed / 24 skipped** â€” 39 sisa TERBUKTI pre-existing (6 di 4 file kandidat diverifikasi via `git stash` clean-tree; sisanya `is-not-a-function`/mock-mismatch pada file src yang TIDAK disentuh sesi ini: queue, typing, self-learning, evaluator, idempotency, recruitment, schedule-handoff, pediatric, clinic-area, context-governance).
- **Sisa disengaja / tech debt baru:** (a) hafalan `s.id.includes('moksa')` (`get-catalog.tool.ts:499`, combo pernapasan) BELUM dicabut â€” butuh metadata companion baru (scope creep, di luar plan); (b) pertanyaan konsultatif deklaratif TANPA '?' ("Breast massage bisa untuk asi") masih masuk cart â€” batasan fail-closed level tanda baca, bukan alasan daftar kata; (c) pesan multi-kalimat campuran deklaratif+tanya diblokir seutuhnya (granularitas level pesan).

---

## 90. [Plan 3 Sesi] Audit 7 fase: 1 gap dieksekusi, 4 verify-only, 2 ditolak beralasan (2026-09-18)

- **Status:** Fase 1 + Fase 7 implemented & verified; Fase 2/3/5/6 confirmed-done (no-op); Fase 4 & cap-opsi Fase 6 REJECTED.
- **Audit read-only per fase:**
  1. **Fase 1 D6 â€” GAP NYATA, dieksekusi.** `DOMICILE_ATTR_RE` menuduh "Area Kecamatan Kenjeran" walau customer yang menyebutnya (Sesi 580976). Fix fondasional: pengecualian grounding berbasis data (pesan customer + output/args `calculate_delivery`), tanpa daftar kalimat, tanpa prose prompt. Penguatan atas snippet plan: pencocokan kata-utuh (`mentionsPhrase`) agar substring "warung" tidak membebaskan klaim "Waru". `ToolExec.args` sudah ada â€” tanpa perubahan kontrak. Test: 3 baru (Kenjeran via input, via tool, adversarial warung) + 9 lama hijau (12/12).
  2. **Fase 2 â€” SUDAH DONE.** `sawan/sawanen/step` â†’ HIGH ada + test; `SAFETY_NO_MATCH`/`STATEMENT_ONLY_DURATION`/`ASK_DOMICILE` ada + 7 test + matrix CM-21/CM-22. Klaim "baris 573" basi (kode bergeser). Verify-only: 3+7 hijau.
  3. **Fase 3 â€” SUDAH DONE.** D6-murni â†’ template netral + tetap terkirim; non-D6 â†’ `sentence-salvage` â†’ fallback eskalasi (invariant never-silent). Proposal "surgical cleanup" = duplikat `sentence-salvage.ts`. Verify-only: 5/5 hijau.
  4. **Fase 4 â€” DITOLAK.** `closing-intent-normalizer.ts` baru dengan string Indonesia hardcode ("Kalau boleh tahu, rumah Bunda...") = pelanggaran ganda: (a) Mandat Non-Hardcode (template WAJIB dari DB), (b) duplikasi kontrak `closingIntent` yang sudah state-gated di tool + matrix CM-22 hijau, (c) rewrite kalimat LLM pasca-generasi = kelas make-up. File TIDAK dibuat.
  5. **Fase 5 â€” SUDAH DONE.** `parallel_tool_calls: false` ada (`generation-stage.ts:472`); persiapan/minyak â†’ `search_knowledge_faq` ada di router layer. Sisa over-calling = judgment LLM (tak bisa dikunci unit test). Verify-only: tool-pipeline 4/4.
  6. **Fase 6 â€” SEPARUH.** Taksonomi 24 bln single-source + test âœ… (verify-only 6/6). Cap "maks 1â€“2 opsi" DITOLAK: kosmetik (panjang sudah diatur `trimToMaxSentences` + narasi 1-paragraf) + berisiko merusak `priceClarification` diversitas/comparator lintas-audiens.
  7. **Fase 7 â€” dieksekusi parsial.** Matrix sudah 22 skenario (sawan/234800/newborn/same-day/24bln ter stimoni). Ditambah **CM-23 Kenjeran** end-to-end (masker buka â†’ tool ter-grounding Kel. Kenjeran/Kec. Bulak â†’ terkirim, anti pola minta-maaf Sesi 580976). Matrix 23/23.
- **Verifikasi:** `build` 0; full suite 2714 passed / 39 failed pre-existing / 24 skipped (keluarga gagal sama dengan baseline: mock-mismatch + `is-not-a-function` sesi paralel, tak menyentuh file sesi ini).

---

## 91. [Model Config] Standardisasi `deepseek-v4-1-flash` + Fallback 3-Tier (2026-09-19)

- **Status:** RESOLVED (kode + config + DB + UI + test).
- **Latar:** Laporan test `test-results/real-conversation-test-report.md` Kasus #5 memperlihatkan log
  `[LLM MODEL FALLBACK] MiniMax-M2.7-highspeed gagal, mencoba deepseek-chat ... 400` berulang.
- **Akar masalah (multi-layer):**
  1. **RC-1 (Config/DB):** Tabel `tenant_ai_config` menyimpan model provider-asing
     (`MiniMax-M2.7-highspeed`, `gpt-4o-mini`, `deepseek-chat`, `mimo-v2.5`) padahal provider aktif = KENARI
     yang hanya melayani katalog Kenari. Default registry kode juga menulis `deepseek-v4-flash`/`deepseek-chat`.
  2. **RC-2 (Tool/LLM Contract):** Chain fallback tidak provider-aware; `.env` mengarahkan
     `AI_MODEL_FALLBACK_CHAIN="deepseek-chat"` + `LLM_FALLBACK_BASE_URL=api.deepseek.com` yang dikirim
     juga ke Kenari â†’ HTTP 400 beruntun lalu `LlmOutageError`.
  3. **RC-3 (State Machine):** Saat `is_human_handling`, `humanBackgroundEnrichmentService.enrichSync`
     selalu memanggil LLM (`EntityExtractor.extract`) tanpa mencoba ekstraksi deterministik lebih dulu,
     membuang request LLM yang selalu gagal.
- **Perbaikan (fondasional):**
  1. Konstanta tunggal `KENARI_PRIMARY_MODEL` / `SUMOPOD_SECONDARY_MODEL` / `DEEPSEEK_DIRECT_MODEL` di
     `src/config/ai-models.config.ts`; `sanitizeModelForProvider` dibuat provider-aware penuh (alias dua arah,
     remap katalog asing â†’ kanonik per-provider).
  2. `src/integrations/llm/model-fallback.ts` merefactor ke **fallback 3-tier**: Kenari â†’ SumoPod â†’ DeepSeek Direct
     via `resolveFallbackTiers()` (guard skip bila baseUrl/apiKey kosong). `generation-stage.ts` circuit-breaker
     memakai resolver tier yang sama (bukan hardcode `api.deepseek.com`).
  3. `human-background-enrichment.service.ts` mencoba `preExtractDeterministic` lebih dulu; LLM hanya bila kosong.
  4. `cost-calculator.ts`: peak-hour dibatasi ke model SumoPod/DeepSeek Direct; entry `deepseek-flash` ditambah.
  5. Migrasi data idempoten `scripts/migrate-model-config-to-deepseek-v41.ts` (dry-run + apply, guard production).
- **Temuan tambahan (fixed):** `.env` live menyetel SEMUA task ke `OpenAI/gpt-4o-mini` padahal provider KENARI
  â†’ diselaraskan ke `Kenari/deepseek-v4-1-flash`.
- **Catatan ops:** `scripts/run-real-conversation-tests.ts` masih melanjutkan replay turn setelah
  `is_human_handling` (silent by design) â€” **bukan bug bot**, tapi harness perlu dihentikan saat handoff
  (dicatat sebagai tech debt terpisah, belum dieksekusi).
- **Verifikasi:** `npm run build` 0; model-related tests 100% hijau (fallback-chain 16/16, provider-alignment 9/9,
  ai-models-tenant, legacy_harvesting, ai_models_and_health, human-enrichment 7/7, cost-calculator 12/12);
  full suite **2762 passed / 41 failed** (baseline 2744/49 â€” semua sisa TERBUKTI pre-existing); DB `tenant_ai_config`
  6/6 baris kanonik (idempoten diverifikasi via dry-run ulang).

---

## 92. [Data/CAPI] `Reservation.is_repeat_order` semantik salah + drift migrasi (RESOLVED 2026-09-19)

- **Status:** RESOLVED (kode + migrasi + test). Temuan sisa: lihat catatan di bawah.
- **Latar:** Rencana "Penandaan Meta CAPI New vs Repeat & Peringatan Jadwal Aktif Admin".
- **Akar masalah (multi-layer):**
  1. **RC-1 (Data/DB):** Sebelumnya `is_repeat_order` HANYA di-set oleh `followUpService.onReservationCreated`
     berdasarkan ada/tidaknya *follow-up PENDING/QUEUED* milik customer. Ini semantik salah: repeat order
     ditentukan oleh riwayat transaksi (`confirmed`/`completed`), bukan status follow-up. Pelanggan baru tanpa
     follow-up lama bisa keliru tidak ditandai; pelanggan lama yang follow-upnya sudah dikirim bisa keliru `false`.
  2. **RC-1b (Migrations):** Kolom `is_repeat_order` ada di `schema.prisma` tetapi TIDAK ada di `prisma/migrations/`
     (ditambahkan via `db push` masa awal) â†’ fresh deploy drift.
  3. **RC-2 (Payload):** `sendCapiEvent` tidak mengirim `customer_type`/`is_repeat_order`/`order_number` ke `custom_data`.
  4. **RC-3 (Query):** `GET /api/admin/capi-queue` tidak menyertakan flag repeat; `leadAuditLogs` tanpa `orderBy`
     (default asc) â†’ `sentMap` menimpa dengan audit TERTUA, status moderasi MQL terbaru hilang dari antrean.
  5. **RC-4 (Parser):** `tryParseIndonesianDate` tidak memvalidasi kontradiksi nama hari vs angka tanggal.
  6. **RC-5 (UX):** Tanpa peringatan jadwal aktif saat membuat reservasi â†’ risiko duplicate booking.
- **Perbaikan (fondasional):**
  1. `reservation-core.service.ts`: `computeIsRepeatOrder()` (riwayat confirmed/completed, exclude self saat update)
     dipersist di semua jalur create/update; fail-safe DB offline â†’ new.
  2. `capi.service.ts`: `resolveNewVsRepeatContext()` + injeksi `custom_data` Purchase (`is_repeat_order`,
     `customer_type`, `order_number`, `prior_orders_count`); event name tetap `Purchase`.
  3. `reservations.subroute.ts`: capi-queue menyertakan `is_repeat_order`/`order_number`/`customer_type`;
     `leadAuditLogs orderBy created_at desc`.
  4. Migrasi idempotent `20260919000000_add_reservation_is_repeat_order`.
  5. Parser: `reconcileWrittenDayWithDate()` (koreksi slip hari Â±1; kontradiksi >1 hari â†’ tanggal numerik menang).
  6. Endpoint `GET /api/admin/customers/:id/active-reservations` + warning banner + badge Live Chat date-aware.
- **Tech debt sisa (belum dieksekusi):**
  - `followUpService.onReservationCreated` MASIH menulis `is_repeat_order: true` (agar tetap kompatibel dengan
    perilaku lama). Kini idempoten dengan core (core menang saat create/update), tetapi penulisan ganda ini
    sebaiknya dihapus setelah verifikasi produksi â€” dicatat sebagai kandidat cleanup.
  - Endpoint `active-reservations` fail-explicit (HTTP 500) saat DB offline; UI `CreateReservationModal`
    menelan error (`catch â†’ []`) sehingga banner tidak muncul meski DB down. Disengaja agar modal tetap usable;
    bukan silent-correctness karena server tidak pernah mengirim data palsu.
- **Verifikasi:** unit `capi-repeat-order` 8/8, `parser-day-date-cross-validation` 6/6, integrasi
  `active-reservations-endpoint` 3/3; regression capi/reservation/parser 121/121; `npm run build` root & dashboard 0.

---

## 93. [Plan Validasi] Regresi Wilayah Luas, Siklus Ongkir & Integritas Entitas Wilayah (2026-09-19)

- **Status:** RESOLVED (kode + test TDD). **Validasi plan mengoreksi 2 klaim keliru.**
- **Latar:** Sesi 535222 (`logs/llm-2026-09-19.jsonl`, 5 record) â€” "buduran kak" â†’ bot menjanjikan cek ongkir padahal customer tak bertanya; "bungurasih kak" â†’ bot menyebut "Bungurasih (Waru)" (bocor basecamp klinik).
- **Verifikasi klaim plan (terhadap kode & log):**
  1. **RC-1 (janji ongkir prematur) â€” TERBUKTI.** `location-rules.phase.ts` templat kecamatan menjanjikan "cekkan...ongkir promonya" tanpa gate `priceDiscussed`. Log turn 2 membocorkannya.
  2. **RC-2 (injeksi `(Waru)`) â€” TERBUKTI.** `calculate-delivery.tool.ts:647-648` menyuntik `(${resolved.kecamatan})`. Log turn 3: "Bungurasih (Waru)".
  3. **RC-3 (markOngkirQuoted buta) â€” DIKOREKSI plan: BUKAN penyebab bug 535222.** Broad-district mengembalikan `success:false` (`tool-pipeline.ts:403` gate `toolResult.success`), jadi `markOngkirQuoted` TIDAK pernah dipanggil. Ini **latent bug** untuk skenario kelurahan presisi + nominal disembunyikan; diperbaiki terpisah.
  4. **RC-4 (concatenation "Buduran Bungurasih") â€” TERBUKTI tapi NON-FATAL.** Geocoding tetap resolve benar ke Bungurasih/Waru; concatenation hanya risiko latent (bisa salah resolve bila kecamatan lama match duluan).
- **Koreksi solusi (Fase 4 plan asli = TAMBAL-SULAM):** Plan mengusulkan menambah instruksi prompt "DILARANG menggabungkan wilayah..." â€” DITOLAK sesuai Mandat Anti-Penyelesaian Case-by-Case. Diganti **guard deterministik** `stripStaleRegionPrefix()` (`src/v3/tools/entity-concatenation-guard.ts`, data-driven: hanya strip prefiks yang persis wilayah sesi; fail-open).
- **Perbaikan (fondasional):**
  1. `buildLocationHierarchyBlock(session)` sadar-mode: template kecamatan tanpa janji ongkir bila `priceDiscussed !== true` (Information Hiding di lapisan prompt; gerbang kode tetap otoritas utama).
  2. Hapus `(${resolved.kecamatan})` dari `message` output `calculate_delivery` (sumber data, bukan regex post-sanitizer).
  3. `markOngkirQuoted` digerbang `fnArgs.asksDeliveryFee === true` (State Machine lifecycle).
  4. Guard anti-konkatenasi di `tool-pipeline.ts` sebelum eksekusi `calculate_delivery`.
- **Test:** `entity-concatenation-guard` 6/6 (baru), `tool-pipeline` 7/7 (+3), `location-prompt-pruning` 8/8 (+2), `calculate-delivery-broad-region` 5/5 (+1). Total 26 test baru/hijau.
- **Verifikasi full-suite:** build 0; 42 failed / 2790 passed. Dua kandidat baru TERBUKTI **bukan regresi**: `catalog-information-hiding` (gagal juga saat perubahan di-`git stash` = pre-existing) dan `admin-api-cache` (lulus di isolasi = flaky parallelism). Tidak ada file test yang gagal yang bersinggungan dengan blast radius perubahan ini.
- **Tech debt sisa:** (a) `catalog-information-hiding` test lama menuntut `message` memuat `Rp` â€” kontrak usang, belum diselaraskan; (b) RC-4 hanya menangani prefiks wilayah basi; concatenation non-prefiks (mis. entitas baru di depan) belum dicakup.

---

## 94. [Kebijakan Prompt/Drift] Kontrak Ongkir Lokasi Presisi, Perampingan Rules & Mutilasi Subjek Sanitizer (2026-09-19)

- **Status:** RESOLVED (kode + test + docs). Perubahan KEBIJAKAN disetujui user (Confirmation Gate).
- **Latar:** Sesi 779408 — customer "bungurasih kak" hanya mendapat konfirmasi jangkauan tanpa
  jarak/ongkir (tertahan Rule 2), dan balasan "Ada yang ingin Bunda konsultasikan..." kehilangan
  kata "Bunda" akibat sanitizer memotong subjek klausa di tengah kalimat.
- **Akar masalah (multi-layer):**
  1. **RC-1 (Gate kode):** `showFeeNominal` HANYA dari `asksDeliveryFee` (dari intent harga LLM),
     sehingga lokasi presisi tanpa pertanyaan biaya tidak pernah mengekspos ongkir.
  2. **RC-2 (Prompt):** `FEE_INFORMATION_HIDING_PIN` melarang SEMUA nominal (termasuk ongkir),
     bukan hanya harga paket.
  3. **RC-3 (Sanitizer):** `limitVocativeQuota` hanya melindungi subjek di AWAL kalimat; sapaan
     setelah modal verb ("ingin Bunda konsultasikan") di tengah kalimat dipotong.
  4. **RC-4 (Hardcode/SaaS):** Rule 10 (newborn 0-28), Rule 15 (anti-km), Rule 17 (selapan/cukur),
     hardcode "Waru" & "alas tidur" di prompt.
- **Perbaikan:** lihat CHANGELOG (Fase 1-3). Ringkas: kontrak ongkir presisi; data terstruktur ke
  LLM (tanpa suggestedTemplateReply); Rule 4 state-gated; Rule 10/15/17 dihapus; Rule 11 tenant-agnostic;
  sanitizer proteksi modal/subordinate-before.
- **Dampak test yang di-update (kontrak berubah, disengaja):** `location-prompt-pruning`,
  `catalog-information-hiding`, `v3/tool-pipeline`, `v3/calculate-delivery-url`, `v3/agent-tools`,
  `v3-anti-todong-jadwal`. Sisa 28 kegagalan suite v3 TERBUKTI pre-existing (diverifikasi via git stash).
- **Tech debt sisa (belum dieksekusi):**
  - `FEE_INFORMATION_HIDING_PIN` masih diekspor tapi tidak lagi disematkan di block lokasi-diketahui
    (masih dipakai jalur lokasi-belum-diketahui via konteks lain) — kandidat konsolidasi cleanup.
  - Harga treatment pada FEW_SHOT Contoh 3/5 tetap ilustratif; label "ILUSTRASI POLA" dipertahankan.
  - Router `router-tool-routing.layer.ts` masih memuat contoh "Waru Kepuh Kiriman" sebagai contoh
    UTUH frasa lokasi customer (bukan hardcode basecamp) — dibiarkan demi anti-truncation; audit ulang
    bila tenant non-Sidoarjo onboarding.
  - `buildToneNegConstraints` state-gate bergantung pada `session.childProfile`/`children[].ageMonths`;
    bila usia hanya tersedia di form reservasi (belum di sesi), bot tetap menanyakan — perilaku benar.
- **Verifikasi:** `npm run build` 0; unit/integrasi terkait 37/37 hijau; suite v3 tidak ada regresi baru.

---

## 94. [Simulator] "Error calling AI Generator: Failed to fetch" + leak Waru lanjutan (2026-09-19)

- **Status:** RESOLVED (leak Waru) / DIJELASKAN (Failed to fetch).
- **Gejala 1 — "Failed to fetch":** Simulator sesi 538631 menampilkan error network dua kali ("halo kak", "bungurasih").
  - **Akar:** BUKAN bug kode. `tsx watch` melakukan hot-reload 3x dalam 30 detik tepat pada jam sesi (log `app-2026-09-19.log`: `03:55:14`, `03:55:35`, `03:55:44` UTC = 10:55 WIB) karena aktivitas edit file. Setiap restart memutus request in-flight -> `fetch()` browser melempar `Failed to fetch`.
  - **Resolusi:** tidak ada (transient). Endpoint terbukti sehat: 3/3 `POST /api/admin/sandbox/chat` -> 200 OK.
  - **Catatan:** saat mengedit kode, jangan jalankan simulator pada window yang sama dengan hot-reload.
- **Gejala 2 — balasan menyebut "Waru":** balasan "Bungurasih, Waru ya Bunda" muncul. **DIPUTUSKAN BUKAN BUG** (koreksi 2026-09-19): "Bungurasih" MEMANG kelurahan di Kecamatan Waru, jadi penyebutan "Waru" adalah **fakta geografis sah** (wilayah customer sendiri), bukan halusinasi.
  - **Deliberasi:** Percobaan awal (menghapus field `kecamatan`/`kota` dari payload LLM) DIBATALKAN — itu menghilangkan info faktual yang sah. Keputusan user: **kecamatan target BOLEH disebut**.
  - **Perbaikan (fondasional) yang benar:**
    1. `buildLlmSafeToolPayload` **mempertahankan** `kecamatan`/`kota` (template prosa tetap dicabut, anti parrot-effect). Test `tool-pipeline` 9/9.
    2. **Rule 11 dipersempit** (`NO_GUESS_CITY_RULE`): larangan hanya untuk wilayah TANPA dasar (tidak disebut customer DAN bukan hasil tool). Kecamatan yang merupakan bagian administratif wilayah target (tool-grounded) DIKECUALIKAN sebagai fakta sah.
  - **Validator sudah konsisten:** `factual-claim-validator.ts` (`isToolGrounded`, baris ~268) memperlakukan kecamatan hasil `calculate_delivery` sebagai grounding sah — tidak diflag halusinasi. `factual-claim-validator` 13/13.
  - **Catatan:** "Waru" tetap nama basecamp klinik; menyebutnya atas dasar KLIEN (basecamp) tetap DILARANG Rule 11 (BUKAN wilayah target customer) — `HOMEBASE_EXEMPT_RE` membedakan konteks "homebase kami di Waru" (sah) vs atribusi domisili salah (haram).
- **Tech debt baru (belum diperbaiki):** balasan konsultasi masih menyebut nominal ongkir (`Rp 5.000`) meski customer belum bertanya biaya — RC-1 Information Hiding di lapisan **generasi** (bukan lagi prompt/lifecycle). Perlu audit terpisah pada grounding/generation Call 2.

---

## 95. [Plan Validasi] Restorasi Template SOP Greeting & Info Ongkir (2026-09-19)

- **Status:** RESOLVED sebagian (revisi fondasional); 2 Fase plan asli DITOLAK, 1 deviasi terbuka.
- **Validasi klaim plan vs kode nyata:**
  1. Greeting 2-kalimat: BENAR ada (kompresi Rule 1 di 91ade27e), tapi bentuknya template
     deterministik Turn-0 (jalur gate statis 0-token, bukan prosa LLM) — restorasi SOP
     4-blok aman (kuota vokatif 2x, bypass trimmer di gate statis).
  2. `delete clone.suggestedTemplateReply` (`tool-pipeline.ts:86`): BENAR ada, tapi
     keputusan fondasional anti-parrot yang disengaja (CHANGELOG 2026-09-19) — BUKAN bug.
  3. "b5b2f3cd mengubah CTA": KELIRU — diff commit hanya menambah `inCoverageNoFee`;
     CTA state-aware sudah ada sejak 91ade27e.
  4. "dari basecamp kami di Waru": TIDAK ADA di template/RAG/few-shot mana pun (murni
     karangan LLM); `logs/llm-2026-09-19.jsonl` kosong (tanpa bukti live).
- **Solusi yang DITOLAK:** (a) kembalikan `suggestedTemplateReply` ke payload LLM
  (regresi parrot-effect, merusak garansi sapaan Turn-0 Plan 7); (b) klausul prompt
  "WAJIB pakai template persis / DILARANG sebut basecamp" (make-up, dilarang mandat);
  (c) perluasan regex header tanpa template kanonis (diobati sekalian lewat F3 di bawah).
- **Eksekusi fondasional:** (F1) `TEMPLATES.greeting()` 4-blok SOP; (F2) validator
  **D8_ORIGIN_NARRATION** (gate kontrak tool + re-prompt kognitif + salvage, preseden D7);
  (F3) header-protector sanitizer mengenali header kanonis SOP.
- **Deviasi terbuka (perlu konfirmasi tim admin):** default CTA ongkir TIDAK dikembalikan
  ke verbatim "Mau pilih treatment apa bunda ?" — CTA state-aware audit 337101
  dipertahankan (verbatim membunuh context-awareness + inkonsisten dengan prompt/few-shot).
- **Tech debt sisa:** (a) `TEMPLATES` masih hardcode di `persona.ts` (migrasi DB = effort
  High, lihat SAAS_READINESS_AUDIT) — edit ini fallback sementara; (b) few-shot exemplar
  positif phrasing ongkir (tanpa narasi asal) belum ditambah — DITUNDA (risiko pergeseran
  ranking retrieval, butuh kurasi DB); (c) `cart-dedup-total` 1 gagal pre-existing
  (terverifikasi via git stash, di luar blast radius).

---

## 96. [Fixing Plan] Gerbang Deterministik Lokasi Murni — Fast SOP (2026-09-19)

- **Status:** RESOLVED (kode + test TDD + docs). Plan divalidasi penuh sebelum eksekusi.
- **Koreksi klaim plan:**
  1. "Hemat ~13.000 token / 0ms": TAK TERVERIFIKASI (log 09-19 kosong, tak ada baris
     `prompt_tokens` di log 09-18). Arah penghematan benar (1 Call LLM dihapus) tapi
     angka plan tidak terbukti — JANGAN dikutip sebagai fakta.
  2. "100% patuh kata-demi-kata": SALAH di bawah pipeline saat ini. TERBUKTI via
     eksekusi `cleanOutboundReply`: kuota vokatif Stage 5 memangkas bunda ekor
     ("saja bunda. Jadi bisa ya bunda" → "saja. Jadi bisa ya"). Verbatim penuh butuh
     SALAH SATU dari: (i) pengecualian template SOP dari normalizer kuota (pengecualian
     arsitektur baru, belum disetujui), atau (ii) tulis ulang template hemat-bunda
     (perlu sign-off admin). Sampai itu diputuskan, klaim jujurnya ≈95%.
  3. "symptom score = 0": TIDAK ADA di codebase — dipetakan ke
     `consult_symptom`/`ask_schedule`/`ask_duration` + `hasFallInjurySignal`/
     `hasVaccineSignal` + sebutan nama katalog (DB-driven).
- **Keputusan arsitektur (menyimpang dari plan, beralasan):**
  - Exemption `suggestedTemplateReply` di pipeline DITOLAK — fast-path memakai RAW
    `executedTools` (template utuh di memori); sanitasi payload LLM tak tersentuh.
  - Prompt "WAJIB/DILARANG" DITOLAK — compound turn dijaga D8 (KNOWN_ISSUES #95).
  - CTA verbatim DITOLAK (alasan di #95, ditegaskan ulang).
  - Turn-0 lokasi-pertama: prepend `firstContactGreetingHeader` (tanpanya sapaan
    hilang — regresi SOP yang bakal diperkenalkan plan asli).
- **File:** `delivery-fast-path.ts` (baru), `agent-runner.ts` (Stage 3b),
  `calculate-delivery.tool.ts` (4 cabang ambigu + template),
  `lead-greeting-detector.ts` (`hasIslamicSalutation`).
- **Tech debt sisa:** (a) klaim token plan belum diukur — ukur riil via telemetri
  (`V3_GENERATION` vs `DELIVERY_FAST_PATH_ELIGIBLE`) sebelum klaim hemat; (b) paket
  generik tanpa nama ("paket apa aja?") masih mengandalkan router Call-1 memanggil
  katalog (gate kedua) — pertimbangkan intent `ask_package` deterministik bila
  router terbukti meleset; (c) `lastContextSummary` basi satu turn setelah fast-path
  (dampak: ringkasan router turn berikut) — minor, monitor.

---

## 97. [Fixing Plan] Resolusi Fondasional Sesi 284330/594329 — 7 Fase (2026-09-19)

- **Status:** RESOLVED (kode + test TDD). Plan tervalidasi vs 5 dimensi audit (Rules/Flow/Log/RAG/Prompt).
- **P1 Cart Hijack** `src/v3/state/cart-manager.ts:213` — gejala `kembung` (7 huruf, `GENERIC_CLINIC_TOKENS` tidak ada `kembung`, ownerCount 1 di `treatment-catalog.service.ts:116`) memang hijack `Pijat Bayi Pulih Ceria` via single-token. Fix: hapus jalur `t.length>=7 && ownerCount===1` (0 hardcode baru), `significantTokens` tetap raw `name` (usia ikut, `cleanNameOf` dipakai untuk exact match). Parafrasa ≥2 token tetap sah.
- **P2 Isolasi** `src/v3/tools/get-catalog.tool.ts:228` — `effectiveSymptoms` isolasi pasien `isTargetingMoms ? [] : knownSymptoms` (tanpa regex). `momStage GENERAL` `src/v3/tools/get-catalog.tool.ts:467` → `formattedTreatments=[]` + `MOM_GENERAL_UNSUPPORTED` (tanpa hardcode nama kalimat; id kontrak kategori, tech-debt: label `Hamil/Menyusui` masih implisit di katalog, migrasi `applicableMomStage` bila tenant butuh).
- **P3 Validator** `src/v3/guardrails/factual-claim-validator.ts:168` — agama `insyaa Allah` lolos lama, obat belum ada. Fix guardrail linguistik (bukan DB) sesuai Gate.
- **P4 Demam** `src/v3/domain/types.ts:97` `feverContraindication?:boolean` (Json preferences, tanpa migrasi) + `patient-extractor.ts:parseFeverTemperature` (35-42°C, window 20 char) + `context-grounder.ts:145` threshold ClinicPolicy. `goal-tracker.ts:310` prune mandat. `sanitizer.ts:487` persempit `hasStructuredContent` → bullet `•`/`-`/`1.` tidak lagi bypass (test `sanitizer-sentence-trimmer` diselaraskan). Nota/form tetap utuh.
- **P5 Ongkir** — tetap state-aware `src/config/persona.ts:355` (3 cabang audit 337101). Ekor `bunda` tetap terpotong kuota vokatif `sanitizer.ts:346` → 95% verbatim (whitelist tidak dibuat, catat).
- **P6 RAG** `src/services/knowledge.service.ts:193/254/360` uniform `rank>=0.25` (sebelumnya 0.025) + Step1 gated + defense `context-grounder.ts:403`. In-memory fallback tanpa threshold sebelumnya — kini threshold. File `knowledge-retrieval.service.ts` fiktif di plan (tidak ada).
- **Gates:** `persona-ongkir.test.ts`/`treatment-symptom-scoring.test.ts` (root) fiktif — path benar `tests/unit/v3/...`; `cart-manager.test.ts` tidak ada — pakai `cart-single-primary-domain`. Full suite 2872/50 vs baseline 2855/58.
- **Tech debt sisa:** (a) `isSickTherapyService:443` dan `isPrenatalId:467` masih hardcode list — butuh `resolveServiceAudience`/`serviceType`; (b) `GENERIC_CLINIC_TOKENS` hardcode generik — stop-word; (c) threshold 0.25 belum tenant-aware; (d) `hasStructuredContent` kini memotong `•` katalog (`get-catalog.tool.ts:551`) — trade-off; (e) usia multi-tier `needsAgeClarification` deteksi base 2 kata (`fam.split 0,2`) rapuh untuk nama panjang — monitor.

## 98. [Komprehensif] Sesi 622098/284330/594329 — 8 Fase (Amnesia, Jambangan, Usia, RAG) — Revisi (2026-09-19)

- **Status:** RESOLVED (8 fase). Plan 8 fase tervalidasi 5 dimensi; 3 micro-task hardcode DITOLAK (CLINICAL_SYMPTOM_TOKENS, verbatim ongkir, knowledge-retrieval.service.ts fiktif).
- **P1 D9** `router-direct-reply.layer.ts:57` prune + `factual-claim-validator.ts:289` D9 + `guardrail-pipeline.ts:389` fallback jadwal. Sliding window `slice(-8)` `agent-runner.ts:144` tetap — amnesia dijaga D9, bukan window.
- **P2 Jambangan** `geocoding.ts:613` dual-admin skip + `tool-pipeline.ts:187` prefix guard. Tanpa ini `kelurahan jambangan`→`Jambangan` dipotong LLM jadi kecamatan luas 4 kelurahan.
- **P3-P6** sama #97 (cart hijack, isolasi, usia penalti `anak`, RAG 0.25). Kuota kalimat 5→3 via `sanitizer` + `guardrail-pipeline.ts:593` (bullet tidak exempt).
- **Verifikasi:** build 0; D9 `locationKnown:true` + `ASKING_LOCATION_RE` → violation; geocode Jambangan precise true; full 2872/50.

---

## 99. [Fitur Plan] Peringatan "treatment aktif" ke admin saat menambah treatment baru

- **Status:** open (belum ada — catatan rencana ke depan, sejak 2026-09-19).
- **Konteks:** Permintaan user: bila seorang customer sudah memiliki treatment/booking aktif berjalan, admin yang hendak menambahkan treatment baru untuk customer tersebut harus mendapat peringatan ("customer ini sedang punya treatment aktif").
- **Fakta kode:** fitur ini **belum ada**. Audit menemukan sistem belum membedakan secara andal "treatment aktif/berjalan" vs "treatment lama yang sudah selesai" — akar yang sama dengan RC-02 (episodic state) dan RC-06 (reservation aggregate).
- **Prasyarat:** bergantung pada pemisahan state percakapan per-episode (Stage 4) dan status reservation typed + lifecycle (Stage 7). Tanpa itu, "aktif" tidak dapat ditentukan secara deterministik.
- **Rencana:** setelah Stage 7, tambahkan indikator "active appointment/treatment" pada data customer → tampilkan peringatan non-blocking di admin saat menambah treatment/booking baru (Drawer/Toast, `useUiFeedback`, bukan page baru — patuh Mandat Anti-Bloat).
- **Limitasi saat ini:** admin harus memeriksa manual daftar reservasi customer.

---

## 100. [Keputusan Menunggu] Semantik reset episode percakapan (Stage 4)

- **Status:** open (menunggu keputusan user, sejak 2026-09-19).
- **Konteks:** Stage 4 memerlukan batas kapan konteks percakapan direset. Usulan user: reset saat closing/booking selesai, atau 14 hari setelah follow-up terakhir.
- **Rekomendasi audit:** reset dipicu oleh (a) booking closing/selesai, ATAU (b) **14 hari sejak chat TERAKHIR CUSTOMER** (bukan follow-up terkirim), ATAU (c) `/reset`. Alasan: follow-up otomatis tidak boleh memperpanjang memori bot; jika dihitung dari follow-up, reset tidak akan pernah terjadi selama follow-up masih berjalan.
- **Tambahan pengaman:** jika customer berganti topik di tengah episode, bot wajib klarifikasi (bukan mencampur konteks lama).
- **Blocker:** keputusan final user diperlukan sebelum implementasi MT-4.4.

---

## 101. [Tests] Dua test timeout 5000ms flaky saat full-suite (`live-chat-reply`, `robustness`)

- **Status:** open (pre-existing, diverifikasi 2026-09-20, bukan regresi Stage 6).
- **Gejala:** `tests/integration/live-chat-reply.test.ts` ("suggest-reply menghasilkan draf saran AI") dan `tests/integration/robustness.test.ts` ("5-Minute Passive Confirmation Timeout") gagal `Test timed out in 5000ms` saat full-suite DAN saat isolasi.
- **Bukti pre-existing:** dengan `git stash` (kode bersih tanpa perubahan Stage 6), kedua test TETAP gagal identik ? bukan regresi.
- **Akar dugaan:** test memanggil jalur lambat (LLM/live-chat suggest) yang melampaui default `testTimeout: 5000`. Bukan assertion failure.
- **Dampak:** full suite tidak pernah 100% hijau; menyulitkan deteksi regresi asli (sinyal bercampur flake).
- **Rencana:** naikkan `testTimeout` test terkait atau mock seam AI-nya (tanpa menurunkan validasi assertion). Butuh penanganan terpisah.

### 101 � RESOLVED (2026-09-20)

- **Akar:** dua test menembak **network LLM nyata** (bukan lambat biasa). Kredensial provider dari `.env` (`KENARI_API_KEY`) tidak ter-blank oleh `LLM_API_KEY=''` di `tests/setup.ts`, sehingga `[LLM MODEL FALLBACK] Transient error (timeout of 15000ms exceeded)` ? retry ? melewati `testTimeout`.
- **Perbaikan (isolasi seam, bukan menurunkan validasi):**
  - `tests/integration/live-chat-reply.test.ts` � mock `callChatCompletionsWithFallback` mengembalikan respons canned.
  - `tests/integration/robustness.test.ts` � spy `GenerationStage.executeChatCompletion` reject cepat (test hanya menguji invarian reset state).
- **Verifikasi:** kedua test lulus tanpa menaikkan timeout; **full suite 399 files / 2934 passed / 0 failed** (1 skipped).

---

## 102. [Reservation / Konflik Kontrak] Merge same-day (dedup form) vs CG-06 (multi-treatment) � BUTUH KEPUTUSAN

- **Status:** open (blocked, menunggu keputusan user; sejak 2026-09-20).
- **Konteks:** Perbaikan R6 (audit) mencoba mengubah merge same-day agar **hanya** menggabungkan treatment SAMA (idempoten), sehingga treatment BERBEDA dibuat reservasi baru (sesuai CG-06).
- **KONFLIK:** `tests/unit/same-day-reservation-collision.test.ts` (fix bug resubmission form, KNOWN_ISSUES #63) SECARA SENGAJA mengharapkan merge same-day **walau treatment berbeda** (Test 1: 'Pijat Rileksasi' existing vs 'Pijat Bayi Ceria Newborn [Total 60m]' masuk ? update, bukan create; Test 5 sama). Perubahan R6 mematahkan 5 test ini.
- **Dua kontrak yang bertabrakan:**
  1. *Dedup form* (existing): customer sama + hari kalender sama = 1 reservasi (cegah duplikat saat form disubmit ulang dengan string treatment sedikit beda).
  2. *CG-06* (keputusan user): beda treatment pada hari sama = boleh menjadi reservasi terpisah.
- **Keputusan yang dibutuhkan:** bagaimana membedakan "resubmit booking yang sama" vs "booking berbeda yang sah"? Opsi:
  - (a) Berdasarkan **base nama treatment** (strip suffix `[Total Xm]`) ? sama = merge.
  - (b) Berdasarkan **waktu/slot** (butuh `bookingTime` terstruktur � belum ada).
  - (c) Berdasarkan **child/subject identity**.
  - (d) Pertahankan kontrak lama (merge semua same-day); multi-treatment ditangani admin manual.
- **Dampak bila salah:** merge salah ? booking sah tertimpa; dedup salah ? booking ganda.
- **Tindakan saat ini:** perubahan R6 **DIBATALKAN** (revert) agar perilaku lama & test tetap utuh. R6 sesungguhnya butuh skema (`request_id`, `bookingTime` terstruktur) untuk resolusi deterministik.

### 102 � RESOLVED (keputusan user: Opsi D, 2026-09-20)

- **Keputusan:** pertahankan kontrak LAMA � merge same-day untuk customer sama (walau treatment berbeda); multi-treatment via bot ditangani **manual admin**.
- **Konsekuensi:** perubahan R6 "merge hanya treatment sama" **DIBATALKAN** (revert). Tidak ada perubahan kode.
- **Sisa risiko diterima:** booking same-day berbeda treatment via bot tetap digabung; admin memisahkan manual.

### 101 � UPDATE (2026-09-20)

- **Flakiness lebih luas dari 2 test:** selain `live-chat-reply` & `robustness`, `waha-webhook.test.ts` (dan sebelumnya `migration.test.ts`) juga kadang gagal `Test timed out in 5000ms` HANYA saat full-suite (lulus isolasi). Pola: test integrasi yang memuat `buildApp()` / pipeline berat melewati 5s di bawah beban paralel full-suite.
- **Sifat:** load/environment flake, BUKAN bug logika (lulus isolasi, failure berpindah antar-file tiap run).
- **Sisa tindakan (opsional):** naikkan `testTimeout` global atau per-file untuk integrasi berat, ATAU jalankan integrasi berat secara terpisah. Belum dikerjakan agar scope terkontrol.

---

## 103. [Tenant] CG-01 fail-closed provider resolver � DITUNDA (butuh desain)

- **Status:** open / deferred (2026-09-20).
- **Konteks:** CG-01 = identitas provider tak dikenal harus fail-closed/quarantine, bukan fallback diam-diam ke default tenant.
- **Percobaan:** mengubah `waha-tenant.service.ts` mengembalikan `resolved|unknown|unavailable` + `webhook.route.ts` menolak `unknown` (drop) / `unavailable` (503). **DIBATALKAN (revert).**
- **Kenapa ditunda:** resolusi tenant dilakukan di TITIK PALING AWAL `/webhook` (sebelum percabangan jenis event). Fail-closed di sana ikut men-drop event **ACK/label/typing** yang tidak butuh resolusi tenant (bukti: `typing-sync.test.ts` 2 gagal, `waha-webhook.test.ts` 7 gagal). Selain itu, true "quarantine" butuh tabel/schema baru.
- **Prasyarat lanjutan:** (a) tabel quarantine, ATAU (b) penanganan fail-closed **per jenis event** (hanya `message` inbound, bukan ACK/label), (c) keputusan untuk kasus DB-outage (fallback vs retry).
- **Dampak saat ini:** untuk 1 tenant, fail-open tidak menimbulkan masalah nyata. Risiko baru muncul saat multi-tenant.

---

## 104. [Plan Validasi] State Persistence, Anti-Silent Handoff & Maternal Routing (2026-09-21)

- **Status:** RESOLVED (schema + state machine + sanitizer + maternal routing + handoff anti-silent-drop).
- **Latar:** Laporan Kasus #1 (Bunda Inggrid, 89 turn) — amnesia lokasi 8x, mati suri 68 turn, misrouting maternal, DSML bleeding.
- **Verifikasi plan (kode+log+DB):** RC-1 session_data tidak ada di DB fisik — TERBUKTI (HAS session_data: false); RC-2 learning loop men-set is_human_handling — TERBUKTI (machine.ts:773); RC-3 getDefaultRelaxationService filter BABY untuk MOMS — TERBUKTI; RC-4 DSML — TERBUKTI + akar lebih dalam: regex sanitizer <｜｜DSML｜｜ tidak pernah match pola riil model <\u009C\u009CDSML\u009C\u009D ... (control chars, slash penutup di antara wrapper).
- **Perbaikan fondasional:**
  1. 
px prisma db push + generate penuh (kill dev server dulu, EPERM DLL lock trap) → session_data writable (script scripts/verify-session-data.ts).
  2. goal-tracker.updateGoalSession: blok try raksasa dipecah — kegagalan episodik (session_data) TIDAK lagi menggugurkan mirror durable Customer (akar amnesia). getGoalSession: resilient memory fallback saat DB kosong padahal memori substantif.
  3. Maternal routing: getDefaultRelaxationService('MOMS') → filter MOMS/BOTH (bukan BABY); header pregrounding "Ibu Sehat Relaksasi" untuk sesi ibu.
  4. Learning loop: lagForReview via repository seam (review_flagged=true, bot TETAP AKTIF) — kurasi ≠ eskalasi CS.
  5. Sanitizer DSML: trim-from-first-DSML (draf korup), pipe tunggal/ganda + control chars C1; <result>/<tool_call> tetap tag-pair removal.
  6. **Handoff anti-silent-drop (temuan baru):** flag is_human_handling SEBELUMNYA di-set sebelum balasan closing schedule-check terkirim → shouldAbort() membatalkan kirim (ABORTED_BY_HUMAN_HANDLING) → customer diam total. Kini flag di-set DEFENSIF SETELAH STEP 2 kirim (pendingEscalation). Verifikasi: Turn 16 "Baik" → closing TERKIRIM (bukan silent).
- **Test:** unresolved-faq-writer direvisi ke kontrak baru (review_flagged, bot aktif); tambahan test MOMS routing + header ibu; suite akhir **2978 passed / 1 failed** (staff-auth GPS landmark — pre-existing WIP lain, bukan blast radius sesi ini).
- **Catatan:** silent setelah closing (Turn 17+) = latch handoffClosingSent DISENGAJA (Plan 7 anti-loop), bukan bug.
- **Tech debt sisa:** (a) tanya kondisi ibu masih bisa muncul berulang dalam konteks penawaran (Call 2 LLM judgment, bukan amnesia); (b) check-test-customer.ts tidak relevan sebagai acceptance session_data — diganti scripts/verify-session-data.ts.

## 106. [Fix Sesi 783810] Kontrak Konsultasi vs Transaksi + Prioritas Usia Multi-Tier (2026-09-21)

- **Status:** RESOLVED (gerbang kode deterministik; TDD merah-hijau per fase).
- **Latar:** Ghost cart — pertanyaan eksplorasi consultative ("kalau yang pulih ceria itu ?") memicu fuzzy userConfirmedNames telah di-core; multi-offer asisten + "sabtu bisa ?" mengunci `Pijat Bayi Pulih Ceria` yang TIDAK pernah dipilih customer. + Ambiguous-age glitch: LLM menyebut label tier `Newborn` sebagai nama layanan (nama "Pijat Bayi Ceria Newborn" TIDAK ada di katalog riil).
- **Akar masalah lintas lapisan:** (1) seam userConfirmedNames (cart-manager) memfilter fuzzy cuma dengan isDurationOnlyQuestion, tanpa gate konsultatif; (2) main gate konsultatif inline (text.includes('?') && !commit && !day) terduplikasi di seam lain → drift; (3) detectAgreedTreatment me-seed selectedTreatment dari penyebutan nama penuh DALAM pertanyaan bertanda '?'; (4) hierarki closingIntent menaruh hasKnownSymptoms di atas needsAgeClarification → keluhan multi-tier tanpa usia lompat ke ASK_SCHEDULE/ASK_DOMICILE tanpa tanya usia → tier default terkunci + guardrail usia menendang pertanyaan yang justru klinis.
- **Perbaikan fondasional (4 fase):**
  1. **Fase A — predikat bersama** `isConsultativeUserText(text, session?)` di `src/utils/date-confirmation.ts`: `'?'` ∧ `!hasBookingCommitSignal` ∧ tanpa `DAY_EVIDENCE_WORDS` ∧ `session.bookingCommitConfirmed !== true`. Dipakai di: loop `userConfirmedNames` (skip), main gate cart (inline predicate diganti), `detectAgreedTreatment` (param optional `session`, skip konsultatif). Anti-drift: satu sumber kebenaran semua seam.
  2. **Fase B — prioritas usia multi-tier:** cabang `needsAgeClarification` → `CLINICAL_PROBE` dinaikkan DI ATAS `hasKnownSymptoms` di `get-catalog.tool.ts`. Usia menentukan tier (Bayi vs Anak); domisili/jadwal menyusul. Kontrak test closing-intent diperbarui (fixture diberi `childAgeMonths` agar tetap menguji ASK_DOMICILE/ASK_SCHEDULE saat tier sudah pasti) + test baru multi-tier→CLINICAL_PROBE.
  3. **Fase C — strip deterministik usia NOMINAL:** klausul "sampaikan tim menanyakan saat koordinasi jadwal" dihapus; lapis kode `stripNominalAges` (angka+satuan di bawah kata `usia`, tanpa otorisasi `needsAgeClarification`) menggugurkan nominal w/O mutilasi — sisa-sisa unit/satuan → fail-safe kembalikan teks asli.
  4. **Fase D — dokumen ini.**
- **Kontrak test:** cart multi-turn ghost → cart kosong; "Ambil yang pulih ceria ya??" tetap mengunci; "sabtu bisa ?" tunggal-offer tetap tidak mengunci; detectAgreedTreatment nama penuh+? → null; authorized needsAgeClarification → angka usia DIPERTAHANKAN.
- **Tech debt ditunda (MEMBUTUHKAN KEPUTUSAN):** bullet `SAVE_RESERVATION_FULL` di `src/v3/agent/prompt/phases/router-tool-routing.layer.ts:11` ("hari sabtu bisa" → langsung kunci reservasi) KONTRADIKSI dengan Rule 5 tool-masker (`hasCommitment` butuh sinyal; `BOOKING_COMMIT_PENDING` saat hanya hari disebut) & doktrin `'?'`-fail-closed — bullet TIDAK diubah di sesi ini; pelanggaran potensial: slicing llmTools hooks (tool-masker/booking-tool-gate/atc-analysis) mungkin mendorong LLM memanggil save saat masih tentatif. Verifikasi & perbaiki di sesi lanjutan.
- **Regresi di luar scope (catat tahu):** hafalan gejala 2-kata (mis. `batuk pilek` via `normalizeFam`) masih bisa salah-target katalog saat keluhan berisi kata generik — kandidat presisi `SymptomBridge` (bukan sesi ini).

---

## 107. [Tarif] Diskon SumoPod MiniMax/netra/qwen belum diverifikasi independen (2026-09-22)

- **Status:** open (butuh cek dashboard `ai.sumopod.com` yang butuh login).
- **Latar:** tarif GLM di `SUMOPOD_PRICING` (`cost-calculator.ts`) memakai harga promo 50%
  ($0.015/$0.25) yang terbukti kedaluwarsa 2026-09-09 — DIPERBAIKI sesi ini ke LIST
  ($0.15/$0.03/$0.50, 3 sumber independen). Tarif MiniMax ($0.03/$0.12), netra
  ($0.04/$0.01/$0.10), qwen3.7 ($0.03/$0.006/$0.13) bersumber dashboard provider sesi lalu.
- **Konflik terdeteksi:** snapshot katalog publik pihak-3 (auto-generated dari katalog live
  SumoPod, tapi dinyatakan bisa lag) mencatat MiniMax-M2.7-highspeed 90% off $0.01/$0.30 —
  berbeda dari kode ($0.03/$0.12). Netra tidak ada di snapshot itu sama sekali.
- **Dampak:** estimasi biaya `llm_audit_logs` untuk MiniMax/netra/qwen bisa meleset
  sampai dashboard di-cek ulang. GLM kini akurat (list rate).
- **Aksi:** cek ulang keempat tarif di dashboard SumoPod saat ada akses; sinkronkan
  `SUMOPOD_PRICING` + test `cost-calculator` bila berubah.

## 108. [Keputusan Menunggu] Eskalasi cascade murah→superior atas ketidakyakinan (2026-09-22)

- **Status:** open (MEMBUTUHKAN KEPUTUSAN user sebelum diimplementasi).
- **Latar:** pertanyaan owner — apakah LLM yang tidak yakin bisa memanggil LLM superior?
  Skema ini valid (cascade routing ala FrugalGPT) dan BELUM terimplementasi di sistem.
- **Verifikasi kode:** yang ada saat ini — (a) `FastResponseGate` (gate 0-token deterministik,
  bukan cascade); (b) fallback 3-tier berbasis ERROR, bukan ketidakyakinan, dan jatuh ke
  tier murah; (c) slot `CHAT_REPLY_DEEP` (netra) + `AI_VERIFIER` terdaftar di registry tapi
  NOL pemanggil runtime di `src/`; (d) `confidenceThreshold` tersimpan di DB tapi tidak ada
  kode yang membacanya (confidence NLU hanya numpang di log).
- **Catatan jujur:** confidence self-report LLM tidak terkalibrasi (run identik: 0.9 vs 0.85).
  Pemicu eskalasi yang sehat = verdict verifier / ambiguitas multi-intent / entity kosong /
  tool-call gagal, bukan angka confidence mentah.
- **Prasyarat bila disetujui:** satu fungsi wiring (verifier menolak/sinyal ambigu → ulang via
  `CHAT_REPLY_DEEP` + `reasoning_effort` high/max) + plumbing effort per task di gateway.

## 109. [RESOLVED — Housekeeping V1/V2] confidenceThreshold + CHAT_REPLY_DEEP + AI_VERIFIER belum dikabel runtime (2026-09-22)

- **Status:** RESOLVED 2026-09-23 (sebagian) pada dekomisioning residu V1/V2 — lihat #123.
- **Tindakan:** task `AI_VERIFIER` DIHAPUS dari `AiTaskType` + `defaultTaskModelRegistry`
  (`src/config/ai-models.config.ts`) karena 0 pemanggil runtime. Sisa `CHAT_REPLY_DEEP` +
  `confidenceThreshold` masih dorman → tetap open di #108/#109-lanjutan bila ingin di-wire.

## 123. [DONE] Dekomisioning Residu Arsitektur V1 (AI Router) & V2 (Slot-Filling/SlateStore) (2026-09-23)

- **Status:** DONE — housekeeping 4 fase (file → kode mati → DB/UI → env/docs).
- **Yang dihapus (bukti audit read-only sebelum eksekusi):**
  1. **File:** `FULL1.log`, `scratch_lp.html`, `scratch_root.html`, `test_pv.json`,
     `implementation_plan.md`, 6 skrip ad-hoc (`scripts/switch-to-minimax.js`,
     `inspect-mimo.js`, `test-minimax-extractor.js`, `test-mimo-deep.js`,
     `add-customers-v2.sh`, `add-remaining-v2.sh`), paket `packages/click-catcher/` (9 file, RETIRED).
  2. **Kode mati:** cabang `sendPricelistImage` unreachable di `machine.ts`; zombie fields
     `StateHandlerContext`/`StateHandlerResult`; flag Slot-Filling di `feature-flags.ts`;
     tipe V2 `EngineActionType`/`DecisionResult`/`GroundingPackage` di `types/nlu.ts`;
     layanan yatim `alert-daemon.service.ts` + `src/utils/searchQueryParser.ts`; `AI_VERIFIER`;
     stub Google Maps Tier-2 + circuit breaker di `geocoding.ts` (kini murni gazetteer+LLM).
  3. **DB/UI:** tabel `ai_router_evaluations` DROP via migrasi
     `20260923000001_drop_ai_router_evaluations` (drift check bersih); `collectAiRouterSummary`
     + blok `aiRouter` di `system-debug.service.ts`; endpoint stub `GET|PATCH /api/admin/ai-router`
     + `GET /api/admin/debug/ai-router`; toggle + tab "AI Router" di Admin Dashboard.
  4. **Env/Docs:** `.env.example` bersih dari `AI_ROUTER_*`/`SLOT_FILLING_*`/`FAST_FAQ_1CALL_ENABLED`/
     `AI_MODEL_ROUTER`/`ESCALATE_SCHEDULE_IN_INITIAL`/`LLM_TIMEOUT_ROUTER_MS`/`LLM_TIMEOUT_VERIFIER_MS`;
     `AGENTS.md`/`README.md` bersih dari path basi.
- **SENGAJA DIPERTAHANKAN (masih dibaca runtime — JANGAN hapus):** `AI_MODEL_NLU`,
  `NLU_CONFIDENCE_THRESHOLD`, `LLM_TIMEOUT_NLU_MS`, `FAQ_CACHE_TTL_SECONDS`;
  `getPricelistImageUrl` + kolom `tenants.pricelist_image_url` (dipakai admin settings);
  parameter `slate?: CustomerSlate` di `few-shot-exemplars.ts` (dipakai di badan fungsi).
- **Catatan:** `tests/unit/lead-greeting-preservation.test.ts` (Case 3, 2 test) GAGAL
  pra-ada di HEAD — bukan akibat housekeeping (diverifikasi via stash), ditangani terpisah.
- **Trade-off diterima:** 3 alarm operasional (`CRITICAL_AI_LOOP`, `NLU_PROVIDER_DEGRADED`,
  `UNINTENDED_SILENT_DROP`) hilang bersama `alert-daemon.service.ts` yang memang 0 pemanggil
  runtime; jika alarm ini diinginkan kembali, wire ulang ke `telemetryService` (bukan sekadar
  memulihkan file).

## 121. [Fondasional BOTH + Broad-City] Sisa env-based & optimasi lanjutan (2026-09-23)

- **Status:** Fase 1-3 DONE (union BOTH tuntas, broad-city consultation-first, kuota vokatif). Sisa debt jujur di bawah.
- **Yang sudah diperbaiki:**
  1. `get-catalog.tool.ts:268` + `treatment-catalog.service.ts:1140/1442/1327/1250` + `filterServicesByAudience:1309` → `BOTH` kini union BABY/KIDS/MOMS+BUNDLE data-driven via `resolveServiceAudience` (bukan filter kosong). `getDefaultRelaxationService('BOTH')` union pool.
  2. `get-catalog.tool.ts:595` anti-brosur BOTH → partisi 1 anak + 1 ibu (bukan slice 2 acak) berbasis skor terapi existing.
  3. `tool-pipeline.ts:483` partisi gejala BOTH data-driven via skor katalog mom vs child (anti cross-contamination), bukan broadcast ke dua profil.
  4. `conversation-summarizer.ts:231` + `goal-tracker.ts:452` broad-city coverage-driven via `getCoverageCities()` (single source) — kota-dalam-coverage tanpa treatment → consultation-first (afirmasi jangkauan + tanya kebutuhan perawatan/patokan santai; tanpa todong kelurahan/ongkir). Token-match kata utuh, bukan substring.
  5. `v3-sanitizer-vocative-quota.test.ts` Turn 6 multi-topik 3x Bunda → ≤1 vokatif terverifikasi via `OutputSanitizer` existing (tanpa file/pass baru).
- **Sisa debt (Confirmation Gate: butuh infra DB baru):**
  - Coverage masih env-based (`src/config/coverage.ts:14` `COVERAGE_CITIES` env fallback) — SaaS-ready penuh butuh `TenantCoverage` table per-tenant + migrasi admin UI. Ditunda karena LOC besar + migrasi berisiko (mandat SaaS-readiness).
  - `getDefaultRelaxationService('BOTH')` masih return single relaks (heuristik pertama); ideal future: return 2 kandidat terpartisi (butuh ubah signature → breaking).
  - Verdict luar-coverage (malang) masih via `calculate_delivery` tool, bukan penolakan di summarizer — sengaja agar jarak riil tetap otoritas (anti-tebak kota).

## 122. [Dual-Model Isolasi Reasoning & Telemetri] Sisa agregat biaya (2026-09-23)

- **Status:** Fase 1-3 DONE. Fase 4 dibatalkan (gateway single-source `model-fallback.ts:152-158` tetap satu-satunya injektor `reasoning_effort: low`).
- **Yang sudah diperbaiki:**
  1. `generation-stage.ts:149/767/789` isolasi reasoning: `turn.generatorReasoning` terpisah, Call 2 `secondReasoning = secondCallReasoning || null` (tanpa fallback `turn.reasoning`). Menu Debug tidak lagi mewarisi reasoning Call 1.
  2. `generation-stage.ts:170/190` `auditUsage` backward-compat tambah `taskType?` opsional (default `V3_AGENT`), Call 1 `INTENT_CLASSIFICATION` (`:529`) + Call 2 `CHAT_REPLY` (`:745`) dengan `finalCall{1,2}Model` + `finalCall{1,2}BaseUrl` (`turn.routerBaseUrl`/`generatorBaseUrl`).
  3. `agent-runner.ts:133/137` teruskan `tenantId` ke `getLlmEndpointConfig`, `TurnState:144` tambah `routerBaseUrl/routerApiKey/generatorBaseUrl/generatorApiKey`, `generation-stage.ts:516/732` pakai endpoint per-call (fallback ke `baseUrl` bila kosong).
  4. Test `tests/v3/dual-model-isolation.test.ts` 3 hijau (reasoning null, task_type per-call, baseUrl per-call). `agent-runner.test.ts` 7 pass, `npm run build` + `admin-dashboard` build 0.
- **Sisa debt jujur (Confirmation Gate: anti-spaghetti):**
  - Biaya agregat turn (`finishCost:214` + `calcCostFor:206`) tetap satu model agregat (`actualModelUsed || selectedModel` + `turn.baseUrl` tunggal) — rincian per-call benar di `llm_usage_logs`, agregat per-turn tidak dipecah (butuh refactor signature besar).
  - `__actualBaseUrl` tidak di-set circuit breaker (`generation-stage.ts:38` hanya `__actualModel/__actualProvider`) → atribusi baseUrl per-call mengandalkan `routerBaseUrl/generatorBaseUrl` config, bukan verifikasi live.
  - Dashboard `AiEvaluations.tsx:276` render `task_type` mentah tanpa mapping badge 🎰/💬 (badge hidup di `AiModelSettingsPanel`). Tidak butuh migrasi DB (`task_type String` bebas).

## 126. [Jadwal Terisi — Split-brain WIB Residual] Fase 1–3 DONE, sisa situs terdokumentasi (2026-09-24)

- **Status:** Fase 1 (backend WIB `wibDayRangeToUtc`) + Fase 2 (`dateWib` helpers) + Fase 3 (modal reaktif per-tanggal, WIB filter, badge hold/confirmed, timeline strip) DONE 2026-09-24, verifikasi `npm run build` root+dashboard hijau, probe DB `today=2` & `page300` tidak mencakup hari ini terbukti.
- **Perbaikan fondasional:**
  1. `src/utils/time-wib.ts` pure `wibDayRangeToUtc(YYYY-MM-DD)`; `reservations.subroute.ts:99` daily-slots & `:291` list memakai WIB 00:00-23:59 → UTC, sinkron.
  2. `packages/admin-dashboard/src/utils/dateWib.ts` `getWibHoursAndMinutes` + `getTodayWibDateKey` (`Intl` Asia/Jakarta).
  3. `CreateReservationModal.tsx:425` fetch reaktif `startDate=endDate=bookingDate` + `903` filter `getWibDateKey` + `949` collisions WIB + `2754` badge 🟢/🟡 + null-safe + `560` prefill WIB.
  4. `StaffScheduleTimelineStrip.tsx:33-123` filter & menit WIB.
- **Sisa debt jujur (ditunda, tidak bocor ke kronik):**
  - `WeekScheduleGrid.tsx:48,332`, `DayScheduleGrid.tsx:139,160`, `QuickHoldModal.tsx:74-75` masih `getHours()` lokal — perlu migrasi WIB serupa (blast-radius rendah, hanya grid kalender alternatif / quick-hold lakon; jadwal inti modal & strip sudah fondasional).
  - Audit Fase 4.1/4.2 (probe + build + unit test + audit deploy script) belum dieksekusi sebagai gate terpisah — dicatat sebagai R7/R8 plan revisi.

---

## 110. [Tech Debt] Balasan foto hardcode + daftar frasa booking hafalan (2026-09-22)

- **Status:** open (diterima sadar saat push 2026-09-22; dampak saat ini: rendah).
- **(a) Template hardcode:** `src/v3/agent/pipeline/fast-response-gate.ts`
  (`isPureImageMessage` → `staticPhotoReply` "Terima kasih fotonya ya Bunda...") menanam
  template balasan customer-facing di runtime TS — melanggar Mandat Non-Hardcode (template
  WAJIB dari DB agar admin bisa ubah tanpa deploy).
- **(b) Hafalan frasa:** `hasBookingCommitSignal` di `src/utils/date-confirmation.ts`
  diperluas dengan varian partikel (`mau/deh/dong/aja yang itu`...) — mendekati verbatim
  matching yang dilarang Mandat Anti-Overfitting; solusi fondasional = sinyal komitmen
  semantik dari LLM/router, bukan daftar includes.
- **Aksi:** (a) pindahkan balasan foto ke `TenantPromptConfig`/katalog template DB;
  (b) ganti daftar frasa dengan klasifikasi intent komitmen semantik. Kerjakan sebelum
  pola yang sama ditiru di gate lain.
