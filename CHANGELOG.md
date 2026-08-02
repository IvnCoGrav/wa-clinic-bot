# Changelog

Semua perubahan signifikan pada proyek ini didokumentasikan di sini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
dan proyek ini menggunakan [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] - 2026-08-02

### Changed — Pembersihan Hardcoded Business Data (Fase 1, 3, 4.1 dari docs/HARDCODED_FIX_PLAN.md)

**Fase 1 — Satu Sumber Brand**
- **`src/config/brand.ts`** (baru): `DEFAULT_BRAND_IDENTITY`, `getBrandIdentity(tenant?)`, `setBrandIdentity()`, `resetBrandIdentity()` — satu sumber brand (`Kala Moms and Baby Spa` / `Bidan Yusi`), siap baca `Tenant.name` di masa depan.
- **`src/config/persona.ts`**: hapus `BRAND_IDENTITY` lokal → import dari `./brand`; `DEFAULT_PERSONA_PROMPT`, greeting, `notInterestedReply`, reminder, followup diparameterisasi brand.
- **`src/services/followup-templates.service.ts`**: 49 literal "Kala Spa" → `getBrandIdentity().businessName`.
- **`src/state-machine/handlers/greeting.ts`** (intro + multi-intent), **`interest.ts`** (judul katalog), **`machine.ts`** (caption pricelist): brand dari `getBrandIdentity()`.
- **`src/routes/webhook.route.ts`**: filter bot auto-reply → `adminReplyText.startsWith('Pricelist ')`.
- **`src/routes/tracking.route.ts`**: fallback `clinic_name` → brand; hapus nomor produksi `6287751148065` → `process.env.DEFAULT_WHATSAPP_PHONE`.
- **`packages/click-catcher/src/server.ts`**: fallback brand generik; hapus nomor produksi & FB pixel dummy.
- **`packages/admin-dashboard/src/config/brand.ts`** (baru) + Layout/Login/AiSandbox/AiPersona/Settings/KnowledgeBase: brand dashboard via `VITE_CLINIC_NAME`.

**Fase 3 — Nilai Bisnis dari Seed**
- **`src/config/clinic.ts`**: `maxDeliveryDistanceKm` mati (10.0) → env `MAX_DELIVERY_DISTANCE_KM` (default 30), benar-benar dipakai sebagai cap atas fallback.
- **`src/services/delivery.service.ts`**: Haversine multiplier `1.50` → env `HAVERSINE_CIRCUITY_FACTOR`; teks coverage "gratis <5 km" / "maksimal 30 km" dinamis dari tier; log `[SEED]` saat DB tier kosong; result membawa `freeTierKm`/`maxCoverageKm`.
- **`src/state-machine/handlers/location.ts`** & **`location-confirmation.ts`**: `TEMPLATES.ongkirInfo`/`outOfCoverage` menerima `freeTierKm`/`maxCoverageKm`.
- **`src/services/treatment-catalog.service.ts`**: log `[SEED]` saat katalog kosong → `DEFAULT_CLINIC_SERVICES`.
- **`src/routes/admin.route.ts`**: domain & email produksi (`kalababyspa.online`, `admin@kalababyspa.online`) → env `ADMIN_DOMAIN`/`ADMIN_EMAIL` (lazy read), guard origin isolation aktif hanya bila env terisi.
- **`tests/integration/control_center_ui.test.ts`**: guard test pakai `ADMIN_DOMAIN=example.com`.

**Fase 4.1 — Graph API Version Tunggal**
- **`src/integrations/whatsapp/graph.constants.ts`** (baru): `GRAPH_API_VERSION = 'v25.0'` + `GRAPH_API_BASE_URL`.
- **`waba.driver.ts`**, **`client.ts`** (v20.0 → v25.0), **`capi.service.ts`** (v19.0 → v25.0): semuanya pakai konstanta terpusat.

**Fase 4.2 — History Konteks LLM Konsisten**
- **`src/config/llm-context.ts`** (baru): `LLM_HISTORY_LIMIT` (env `LLM_HISTORY_LIMIT`, default 6).
- **`machine.ts`**, **`nlu-classifier.service.ts`**, **`ai-router.ts`**, **`generator.ts`**: jumlah riwayat percakapan ke LLM diseragamkan ke konstanta (sebelumnya 5 vs 6).

**Fase 4.3 — Magic Number jadi Config (env)**
- **`machine.ts`**: idle reset → `IDLE_TIMEOUT_MS` (default 24 jam), `LOCATION_CONFIRMATION_TIMEOUT_MS` (default 5 menit).
- **`location.ts`**: `location_attempts >= 3` → `LOCATION_ATTEMPTS_LIMIT`.
- **`abuse-detection.service.ts`**: flood 10/60s & spam 5 identik → `FLOOD_LIMIT`/`FLOOD_WINDOW_MS`/`SPAM_DUPLICATE_LIMIT`.
- **`follow-up.service.ts`**: batch `take:20`, throttle 5–15 detik, grace lost-customer 3 hari → `FOLLOWUP_BATCH_LIMIT`/`FOLLOWUP_THROTTLE_BASE_MS`/`LOST_CUSTOMER_GRACE_DAYS`.

**Fase 4.4 — `.env.example` Sinkronisasi**
- Tambah var hilang: `WAHA_WEBHOOK_SECRET`, `REDIS_HOST/PORT`, `QUEUE_SHARDS`, `AI_MODEL_*`/`AI_PROVIDER_*`, `NLU_CONFIDENCE_THRESHOLD`, `CLINIC_PRICELIST_IMAGE_URL`, `TELEGRAM_BOT_TOKEN/CHAT_ID`, `GOOGLE_CALENDAR_*`, `WABA_APP_SECRET`, `WABA_WEBHOOK_VERIFY_TOKEN`, `ALERT_WEBHOOK_URL`, `ENABLE_WAHA_HOLD_LABEL`, `OPENAI_API_KEY`, `LLM_HISTORY_LIMIT`, dll.
- Hapus/tandai var mati: `ONGKIR_PROMO_DISCOUNT` (dihapus), `RESERVATION_FORM_URL` (dikomentari, dead).
- Perbaiki `WAHA_BASE_URL` contoh `:8080` → `:3001`.

**Fase 5 — Wilayah Layanan & Prompt Brand**
- **`src/config/service-areas.ts`** (baru): `SERVICE_AREAS` (CSV env, fallback daftar historis) + `SERVICE_AREAS_ALTERNATION`.
- **`ai-router.ts`**: `LOCATION_MARKER_RE` & `leadMatch` memakai `SERVICE_AREAS_ALTERNATION` (daftar nama wilayah tidak lagi literal di regex).
- **`nlu-classifier.service.ts`**: regex `provide_location` memakai `SERVICE_AREAS_ALTERNATION`.
- **`self-learning.service.ts`**, **`persona.ts`**: sebutan "Bidan Yusi" di prompt → `getBrandIdentity().botDisplayName`.

**Verifikasi**: TypeScript clean (`npx tsc --noEmit`), 607/607 test pass (54 file).

---

### Added - WABA Integration Implementation (Fase 1-3)

**Fase 1 — Abstraction Layer**
- **`src/integrations/whatsapp/gateway.types.ts`** (baru): interface `WhatsAppGateway` (`sendTextMessage`, `sendTemplateMessage`, `sendImageMessage`, `sendTypingIndicator`, `markAsRead`) + `SendResult`, `TemplateParam`, `TemplateComponent`, `NormalizedInboundMessage`.
- **`src/integrations/whatsapp/waha.driver.ts`** (baru): `WahaGatewayDriver` — implementasi gateway untuk WAHA, membungkus `IWahaClient` existing, konversi `to` (E.164) → chatId `@c.us`/`@lid`.
- **`src/integrations/whatsapp/factory.ts`** (baru): `getGateway()` / `getWabaGateway()` dengan cache per-tenant.
- **`tests/unit/whatsapp-gateway.test.ts`** (baru): 12 test — sendText, sendImage, sendTemplate interpolation, typing indicator, markAsRead.

**Fase 2 — WABA Core + Webhook Normalizer**
- **`src/integrations/whatsapp/waba.driver.ts`** (baru): `WabaGatewayDriver` — Meta Cloud API `v25.0`, send text/template/image, typing indicator resmi (mark-as-read + `typing_indicator`, cap 25 detik), dedup mark-as-read, `verifyHubChallenge`.
- **`src/integrations/whatsapp/normalizer.ts`** (baru): `normalizeWabaPayload()` — payload webhook Meta → `NormalizedInboundMessage[]` (text/location/image).
- **`src/routes/waba-webhook.route.ts`** (baru): `GET /api/webhook/waba` (hub.challenge) + `POST /api/webhook/waba` (verifikasi HMAC `X-Hub-Signature-256`, normalisasi, idempotency, queue).
- **`tests/unit/waba-driver-and-webhook.test.ts`** (baru): 16 test — driver WABA + normalizer.

**Fase 3 — Multi-tenant Config + Encryption**
- **`prisma/schema.prisma`** (update): enum `WhatsappProvider`; `Tenant` + `whatsapp_provider`, `waha_session_id`, `waba_phone_number_id`, `waba_business_account_id`, `waba_access_token`, `waba_webhook_verify_token`; `Customer` + `marketing_opt_in`, `marketing_opt_in_at`, `marketing_opt_in_source`.
- **`prisma/migrations/20260804000000_add_waba_provider/migration.sql`** (baru): migrasi enum + kolom Tenant/Customer.
- **`src/utils/encryption.ts`** (baru): `encryptSecret`/`decryptSecret` AES-256-GCM (IV + authTag base64), `generateEncryptionKey`. Token WABA disimpan encrypted.
- **`src/integrations/whatsapp/factory.ts`** (update): `resolveGatewayForTenant()` — resolve dari DB per `tenant_id`, decrypt token, fallback aman WAHA saat DB down/decrypt gagal.
- **`tests/unit/encryption.test.ts`** (baru): 7 test roundtrip, unique IV, key validation.
- **`tests/unit/whatsapp-factory-multitenant.test.ts`** (baru): 8 test — resolve WAHA/WABA per tenant, fallback, cache.

**Verifikasi**: 579/579 test pass (51 file), TypeScript clean.

**Fase 4 — Template Engine + Consent Gatekeeper + Opt-out**
- **`prisma/schema.prisma`** (update): enum `FollowUpStatus` + `SKIPPED`; model baru `WabaTemplate` (tabel `waba_templates`) — mapping per-tenant stage → HSM template name, kategori (`UTILITY`/`MARKETING`), bahasa, status approval Meta (`APPROVED`/`PENDING`/`REJECTED`/`PAUSED`), `is_active`.
- **`prisma/migrations/20260805000000_add_waba_templates/migration.sql`** (baru): migrasi enum + tabel `waba_templates`.
- **`src/services/waba-template.service.ts`** (baru): `getTemplateMapping()` resolve mapping HSM dari DB per tenant (fallback aman ke default konvensi saat DB kosong/down), `saveTemplateMapping()` upsert per tenant, `isUsable()` (hanya `APPROVED` + aktif), `buildBodyComponents()` (param `{{1}}` name, `{{2}}` time, `{{3}}` treatment, `{{4}}` baby — falsy dilewati).
- **`src/services/waba-consent.service.ts`** (baru): klasifikasi kategori `UTILITY`/`MARKETING` (REMINDER/REVIEW = UTILITY; NO_PURCHASE/NEXT_TREATMENT = MARKETING), `canSendMarketing()` gatekeeper (MARKETING wajib `marketing_opt_in=true`), `recordOptIn()`/`recordOptOut()` audit trail (at + source).
- **`src/services/waba-optout.service.ts`** (baru): deteksi keyword opt-out `STOP`/`UNSUBSCRIBE`/`BERHENTI`/`BATAL PROMO` (BERHENTI hanya match jika dikombinasi kata marketing PROMO/PENAWARAN/IKLAN/SEMUA — hindari false positive percakapan normal), `handleOptOut()` set opt-in false + batalkan semua follow-up PENDING/QUEUED, ack message.
- **`src/services/follow-up.service.ts`** (update): `executeFollowUp()` jadi provider-aware — resolve gateway per tenant; cabang WABA via `executeFollowUpWaba()` (HSM template + consent gatekeeper + skip template belum APPROVED dengan alert admin + SKIPPED/FAILED), cabang WAHA tetap rolling template existing (zero regresi).
- **`src/services/alert.service.ts`** (update): enum `AlertType` + `FOLLOWUP_FAILED`.
- **`src/state-machine/machine.ts`** (update): global opt-out gate — hanya tenant WABA (`_provider === 'WABA'`), semua state; deteksi keyword → `handleOptOut()` + ack via gateway WABA + log outbound; WAHA tidak terpengaruh.
- **Tests**: +23 test (`waba-template-consent-optout.test.ts` 14 test + `follow-up-waba-branch.test.ts` 9 test). Total 602 test pass (53 file), TypeScript clean (0 error baru).

**Fase 5 — Admin Dashboard Provider Toggle + Template Status**
- **`src/routes/admin.route.ts`** (update): `GET /api/admin/whatsapp-provider` — status provider per tenant, live check session WAHA (best-effort), status kredensial WABA (masked, `configured`/`hasAccessToken`), daftar status mapping template HSM per tenant via `getAllTemplateMappings()`. `PATCH /api/admin/whatsapp-provider` — toggle WAHA/WABA + simpan kredensial WABA (token di-encrypt AES-256-GCM, tidak pernah plaintext) + `resetGateway()` agar resolve memakai config terbaru + audit action `UPDATE_WHATSAPP_PROVIDER`. `GET/POST /api/admin/waba-templates` — list & upsert mapping template per tenant.
- **`src/services/waba-template.service.ts`** (update): `getAllTemplateMappings()` — gabungkan mapping DB per tenant dengan default konvensi (row DB ditandai `isDefault:false`).
- **`packages/admin-dashboard/src/pages/tenant/Settings.tsx`** (update): panel "WhatsApp Provider" — status indicator, toggle WAHA/WABA, form kredensial WABA (token ditulis ulang tanpa dibaca kembali), grid status template HSM per stage.
- **`tests/setup.ts`** (update): mock prisma + model `wabaTemplate` (findUnique/findFirst/findMany/create/update/upsert/deleteMany) untuk test baru.
- **Tests**: +5 test (`waba-admin-endpoints.test.ts` — GET status+templates, masked token, PATCH encrypt & toggle, validasi provider, POST upsert). Total 607 test pass (54 file). Dashboard build clean.

### Added - SaaS Readiness + WABA Integration Planning
- **`docs/SAAS_READINESS_AUDIT.md`** (baru): audit lengkap kesiapan SaaS multi-tenant — 23 blocker (P0-P3) dengan lokasi file:line + effort estimate + checklist migrasi 5 fase + pola kode benar vs salah. Verdict: DB schema siap (17 model ber-tenant_id), layer atas masih single-tenant.
- **`docs/WABA_INTEGRATION_PLAN.md`** (baru): rencana arsitektur dual-gateway WhatsApp (WAHA + Meta Cloud API) — coexist per-tenant, interface `WhatsAppGateway` + factory, webhook normalizer, 24h window map per stage follow-up, mekanisme opt-in marketing (kolom `marketing_opt_in` + consent flow + gatekeeper + opt-out scope WABA-only), skema DB, matriks risiko, 5 fase implementasi dengan feature-flag.
- **`.agents/skills/saas-readiness/SKILL.md`** (update): status table diperbaiki dari "✅ Sudah benar" → ❌/⚠️ sesuai temuan audit; tambah mandat larang hardcode brand; tambah link ke `docs/SAAS_READINESS_AUDIT.md`.
- **`CLAUDE.md`** (update): tambah note di section RTK — `rtk` adalah fitur built-in 9router (model layer), BUKAN CLI executable. Jangan panggil `rtk` langsung di terminal.

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
