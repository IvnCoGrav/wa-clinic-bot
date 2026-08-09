# Implementation Plan — Pembersihan Hardcoded Business Data

**Tanggal:** 2026-08-02
**Status:** Draft
**Basis:** Audit menyeluruh seluruh sistem (audit eksekutif: `docs/HARDCODED_AUDIT.md` bila tersedia, ringkasan di bawah).
**Prinsip (mandatory):** `AGENTS.md` — data bisnis per-tenant (brand, template pesan, prompt) WAJIB dari DB, bukan hardcode. Semua perubahan tidak boleh memutus jalur offline/test (DB down → fallback in-memory tetap jalan).

> **Progress log:**
> - 2026-08-02: Fase 1 (satu sumber brand), Fase 3 (sebagian besar), Fase 4.1 (Graph API version) selesai; build tsc hijau, 607 test hijau. Detail check di bawah.
> - 2026-08-02 (lanjutan): Fase 3 selesai — `HAVERSINE_CIRCUITY_FACTOR`, `MAX_DELIVERY_DISTANCE_KM`, log seed tiers & katalog, `ADMIN_DOMAIN`/`ADMIN_EMAIL`. Fase 4.1 selesai — konstanta `GRAPH_API_VERSION` di `src/integrations/whatsapp/graph.constants.ts`.
> - 2026-08-02 (lanjutan): **Fase 4.2 selesai** — konstanta `LLM_HISTORY_LIMIT` (`src/config/llm-context.ts`, env `LLM_HISTORY_LIMIT`, default 6) dipakai di `machine.ts`, `nlu-classifier.service.ts`, `ai-router.ts`, `generator.ts`. **Fase 4.3 selesai** — `IDLE_TIMEOUT_MS`/`LOCATION_CONFIRMATION_TIMEOUT_MS` (machine.ts), `LOCATION_ATTEMPTS_LIMIT` (location.ts), `FLOOD_LIMIT`/`FLOOD_WINDOW_MS`/`SPAM_DUPLICATE_LIMIT` (abuse-detection), `FOLLOWUP_BATCH_LIMIT`/`FOLLOWUP_THROTTLE_BASE_MS`/`LOST_CUSTOMER_GRACE_DAYS` (follow-up). **Fase 4.4 selesai** — `.env.example` diperbarui (tambah var hilang, hapus/tandai var mati `ONGKIR_PROMO_DISCOUNT` & `RESERVATION_FORM_URL`, perbaiki `WAHA_BASE_URL` → `:3001`).
> - 2026-08-02 (lanjutan): **Fase 5 selesai** — `SERVICE_AREAS` (CSV env, fallback daftar historis) di `src/config/service-areas.ts`, dipakai `ai-router.ts` (LOCATION_MARKER_RE + leadMatch) & `nlu-classifier.service.ts`. Prompt brand (`intent.ts`, `nlu-classifier`, `generator.ts`, `self-learning.service.ts`, `persona.ts`) semuanya pakai `getBrandIdentity()`.
> - 2026-08-09: **Fase 6 (Landing Page) selesai** — konten landing kini DB-driven via tabel `landing_pages` (`src/services/landing-content.service.ts`): `title`, `landing_type` (RAW_HTML/STRUCTURED_JSON), `structured_content`, `events[]`, override `meta_pixel_id`/`whatsapp_number`, fallback legacy ke `tenants.raw_html_content`. `packages/click-catcher` dipensiunkan (landing di-serve bot, `src/routes/landing.route.ts`) — fallback nomor WA pindah ke `defaultLandingContent()` (env `DEFAULT_WHATSAPP_PHONE`, tanpa nomor produksi hardcoded). Stale compiled artifact `src/services/tenant-html.service.js` dihapus (menimpa `.ts` di resolusi Vite).

---

## Ringkasan Masalah (hasil audit)

1. **Brand name tidak konsisten — 4 ejaan berbeda** di seluruh codebase.
2. **`BRAND_IDENTITY` + seluruh `TEMPLATES` pesan** hardcoded, tanpa override DB (persona *prompt* sudah DB, template pesan belum).
3. **Tarif ongkir `DEFAULT_TIERS`** & **harga 16 treatment `DEFAULT_CLINIC_SERVICES`** = nilai bisnis riil di source, ter-seed ke DB saat boot pertama.
4. **Nomor WhatsApp asli `6287751148065`** sebagai fallback di 2 tempat.
5. **Jadwal follow-up +3/+7/+14 hari & +1/+2/+3 bulan** hardcoded.
6. **Teks coverage "30 km" & "gratis <5 km"** di-hardcode di string — tidak sinkron jika tier DB diubah.
7. **Nama wilayah layanan (rungkut, sidoklumpuk, dll.)** di regex classifier.
8. **Konstanta mati `maxDeliveryDistanceKm: 10.0`** — tidak dipakai, menyesatkan.
9. **3 versi Graph API berbeda** (v19/v20/v25).
10. **31 env var tidak terdokumentasi** di `.env.example` (termasuk `WAHA_WEBHOOK_SECRET` wajib); 2 var di `.env.example` tidak pernah dibaca.
11. **History konteks LLM tidak konsisten** (NLU/router 5 vs generator 6).
12. **Domain/email admin hardcoded** (`kalababyspa.online`, `admin@kalababyspa.online`).

---

## Strategi Umum

- **Sumber kebenaran tetap DB**, default di code diubah menjadi seed generik + env-drivable, BUKAN nilai bisnis riil.
- **Konsistensi dulu, pemindahan DB kemudian.** Menyebarkan brand dari DB ke 30 titik butuh effort besar; meringankan dulu dengan 1 konstanta pusat, lalu bertahap pindah ke DB.
- **Tiap fase berdiri sendiri** (bisa deploy tanpa menunggu fase lain), dengan test hijau di akhir fase.

---

## Fase 1 — Satu Sumber Brand (P0, cepat, risiko rendah)

Tujuan: menghentikan 4 ejaan berbeda; satu konstanta pusat untuk seluruh bot & dashboard.

### 1.1 Buat pusat brand
- File baru `src/config/brand.ts`:
  - `BRAND_DEFAULT = { businessName: 'Kala Moms and Baby Spa', botDisplayName: 'Bidan Yusi' }` (tetap default, tapi hanya di 1 tempat).
  - Export `getBrandIdentity(tenant?)` yang membaca `Tenant.name`/`tenant_persona` bila tersedia (fallback default).
- Update `persona.ts`:
  - Hapus `BRAND_IDENTITY` (baris 17-22) → import dari `brand.ts`.
  - Semua string di `TEMPLATES` yang berisi brand ("Kala Moms and Baby Spa", "Kala Spa", "Bidan Yusi", "Kala") diganti call `getBrandIdentity()`/template injection.

### 1.2 Seragamkan ejaan di seluruh codebase
Ganti semua ejaan menyimpang ke default resmi:
| Lokasi | Sebelum | Sesudah |
|---|---|---|
| `followup-templates.ts:33-117` | "Kala Spa" | `{businessName}` via helper |
| `tracking.route.ts:147,182` | "Kala Baby & Moms Spa" | `tenant.name` (sudah ada) → fallback `brand.ts` |
| `machine.ts:397,412` caption | "Kala Moms & Baby Spa" | `brand.ts` |
| `click-catcher/src/server.ts:41,142` | "Kala Baby & Moms Spa" | `brand.ts` (dari env `CLINIC_NAME` fallback) |
| `webhook.route.ts:67` filter caption | "Pricelist Kala Moms & Baby Spa" | jadikan regex dari brand (hindari string-literal rapuh) |
| `admin-dashboard` (Layout/Login/AiSandbox/AiPersona/Settings) | beragam | konsisten; default `brand.ts` (`VITE_CLINIC_NAME`), persona dari `/api/admin/persona` (tidak ada endpoint `/api/admin/tenant`) |

### 1.3 Verifikasi
- `npm run build` (tsc) hijau.
- `npm test` hijau.
- Regresi: `npm run chat` balasan greeting menunjukkan brand konsisten.

---

## Fase 2 — Template Pesan & Brand dari DB (P0, besar)

Tujuan: memenuhi aturan SaaS-readiness — copywriting klinik per-tenant dari DB, fallback ke default.

### 2.1 Schema (satu tabel generic)
- Tambah model `TenantMessageTemplate`:
  - `tenant_id`, `key` (mis. `greeting`, `ongkir_free`, `ongkir_promo`, `not_interested`, `location_request`, `reservation_received`, `faq_follow_up`, `reminder`, ...), `text` (string), `is_active`.
  - `@@unique([tenant_id, key])`.
- Migrasi Prisma (hati-hati shadow replay trap di `AGENTS.md` — gunakan `migrate diff --from-url ... --to-schema-datamodel`).

### 2.2 Service loader
- File baru `src/services/message-template.service.ts`:
  - `getTemplate(tenantId, key, params)`: cek DB → fallback `TEMPLATES` (persona.ts) → string dengan `{placeholder}` di-replace.
  - `loadTemplatesToMemory(tenantId)` saat boot (pola sama seperti persona/katalog/delivery tiers).
  - API admin: `GET/PUT /api/admin/templates`, `GET /api/admin/templates/:key` (list + edit per key).
- Update `persona.ts`: `TEMPLATES.greeting/ongkirInfo/notInterestedReply/...` menjadi wrapper yang memanggil template service (DB dulu, default fallback).

### 2.3 Refactor handler memakai template service
- `greeting.ts`, `location.ts`, `location-confirmation.ts`, `interest.ts`, `reservation.ts`, `machine.ts` (caption pricelist), `cron.service.ts` (reminder pagi) → semua panggil `getTemplate(tenantId, key, params)`.

### 2.4 Follow-up (rolling) — sudah DB, rapikan jadwal
- `follow-up.service.ts:101,179`: jadwal +3/+7/+14 hari & +1/+2/+3 bulan → tambah kolom `follow_up_schedule` di DB tenant (atau env config). Default tetap, tapi bisa diubah admin.
- Lanjutkan pakai `follow_up_templates` yang sudah ada.

### 2.5 Verifikasi
- `npm run build` + `npm test` hijau.
- Test unit baru: template service fallback DB-down → default.
- `npm run chat` verifikasi beberapa template.

---

## Fase 3 — Nilai Bisnis dari Seed (P0)

Tujuan: harga/ongkir/nomor tidak lagi nilai produksi di code.

### 3.1 Ongkir
- `delivery.service.ts:18-26` `DEFAULT_TIERS`: pertahankan sebagai seed (dipakai saat DB/file kosong), tapi pindahkan nilai ke:
  - File `delivery_tiers_custom.json` (sudah dipakai, di-commit?) → pastikan jadi seed eksplisit, BUKAN runtime fallback diam-diam.
  - Log `[SEED] delivery tiers default dipakai` saat DB kosong (visibilitas).
- **Teks coverage**: `delivery.service.ts:200-205` & `persona.ts:185` — ganti "5 km gratis"/"30 km" menjadi dinamis dari tier tertinggi / env `MAX_DELIVERY_DISTANCE_KM`. Hapus `clinicConfig.maxDeliveryDistanceKm: 10.0` atau jadikan env `MAX_DELIVERY_DISTANCE_KM` yang benar-benar dipakai sebagai cap atas.
- Bug kecil: `delivery.service.ts:185` Haversine multiplier `1.50` → env `HAVERSINE_CIRCUITY_FACTOR`.

### 3.2 Treatment catalog
- `treatment-catalog.service.ts:30-207` `DEFAULT_CLINIC_SERVICES`: tetap sebagai seed, tapi:
  - Pindahkan nilai ke `clinic_services` seed (sudah) — pastikan tidak ada code path lain yang memakai harga hardcode.
  - Tambah log saat seed dari default.
- `interest.ts:211` judul "Katalog Layanan Treatment Kala Moms and Baby Spa" → `brand.ts`.

### 3.3 Nomor WhatsApp & domain
- `tracking.route.ts:171,193` & `click-catcher/src/server.ts:35`: hapus fallback `6287751148065` → `process.env.DEFAULT_WHATSAPP_PHONE` (tanpa nilai default produksi; jika kosong → pakai `tenant.whatsapp_number`; jika juga kosong → placeholder, bukan nomor asli).
- `admin.route.ts:29,116,155`: `kalababyspa.online`, `admin@kalababyspa.online` → env (`ADMIN_DOMAIN`, `ADMIN_EMAIL`), default netral.

### 3.4 Verifikasi
- `npm test` hijau (ada test yang depend pada nilai ongkir default? pastikan pakai `activeDeliveryTiers` dari file/DB, bukan literal).
- Test: boot dengan DB kosong → log seed muncul; boot dengan DB terisi → tidak pakai default.

---

## Fase 4 — Inkonsistensi Teknis (P1)

Tujuan: menyinkronkan angka/konfigurasi yang saling bertentangan.

### 4.1 Graph API version
- `waba.driver.ts:8` (v25.0), `client.ts:16` (v20.0), `capi.service.ts:120` (v19.0) → satu konstanta `GRAPH_API_VERSION = 'v25.0'` di `src/integrations/whatsapp/graph.constants.ts`, dipakai semua.
- `client.ts` legacy (v20.0) tampak dead code → tandai deprecation, verifikasi factory tidak memakainya (audit lanjutan kecil).

### 4.2 History konteks LLM
- Pilih 1 nilai: `HISTORY_LIMIT = 6` (generator pakai 6). Sinkronkan `machine.ts:216`, `nlu-classifier.service.ts:175`, `ai-router.ts:691` → gunakan konstanta dari `src/config/llm-context.ts` + env `LLM_HISTORY_LIMIT`.

### 4.3 Magic number jadi config
- Idle reset `machine.ts:157-158` (24 jam / 5 menit) → env `IDLE_TIMEOUT_MS` / `LOCATION_CONFIRMATION_TIMEOUT_MS`.
- `location.ts:168` `location_attempts >= 3` → env `LOCATION_ATTEMPTS_LIMIT`.
- `abuse-detection.service.ts:38-80` (10 msg/60s, 5 identik) → env `FLOOD_LIMIT`/`FLOOD_WINDOW_MS`/`SPAM_DUPLICATE_LIMIT`.
- Follow-up batch/throttle/grace (`follow-up.service.ts:223,308,444`) → env.

### 4.4 `.env.example` sinkronisasi
- Tambah 31 var yang hilang (dari audit): `WAHA_WEBHOOK_SECRET`, `REDIS_HOST/PORT`, `QUEUE_SHARDS`, `AI_MODEL_CHAT/HARVESTING/MEDICAL/PII/SUMMARIZATION`, `AI_PROVIDER_*`, `NLU_CONFIDENCE_THRESHOLD`, `CLINIC_PRICELIST_IMAGE_URL`, `TELEGRAM_BOT_TOKEN/CHAT_ID`, `GOOGLE_CALENDAR_*`, `WABA_*`, `LOG_LEVEL`, `OPENAI_API_KEY`.
- Hapus/tandai var mati: `ONGKIR_PROMO_DISCOUNT`, `RESERVATION_FORM_URL` (verifikasi dulu sebelum hapus).
- Perbaiki contoh: `WAHA_BASE_URL` `:8080` → `:3001` (samakan dengan default code).

### 4.5 Verifikasi
- `npm run build` + `npm test` hijau.
- Cek: `grep "v19\|v20\|v25" src/` → 1 versi.

---

## Fase 5 — Wilayah Layanan & Prompt Brand (P1)

Tujuan: tenant area lain tidak salah klasifikasi; prompt tidak menyebut brand spesifik.

### 5.1 Wilayah regex
- `ai-router.ts:168` `LOCATION_MARKER_RE` & `nlu-classifier.service.ts:71`: pindahkan daftar area layanan ke DB tenant (`tenant.service_areas` array) → di-bundle ke regex saat boot, fallback env `SERVICE_AREAS` (default kosong = regex generik tanpa nama daerah).
- Pastikan test unit yang memakai nama daerah lama tetap lewat (mock DB dengan service_areas sama).

### 5.2 Prompt LLM
- `intent.ts:60`, `nlu-classifier.service.ts:143`: ganti "Kala Moms and Baby Spa" → `{businessName}` dari brand service (BOT_PERSONA_PROMPT sudah DB via `tenant_persona`; sisakan prefix brand dinamis).
- `generator.ts:41-54` instruksi generation: parameterisasi nama brand sama.

### 5.3 Verifikasi
- `npm test` hijau (test NLU yang bergantung prompt harus update snapshot bila perlu).
- `check-router-accuracy` script masih pass.

---

## Fase 6 — Dashboard Multi-Tenant (P2, opsional)

- Branding dinamis: `Layout.tsx`, `Login.tsx`, `AiSandbox.tsx`, `AiPersona.tsx`, `Settings.tsx` → fetch `/api/admin/tenant` saat mount, tampilkan `tenant.name`/brand, fallback default netral.
- Tenant switcher (super_admin) — opsional, out of scope awal.

---

## Urutan Eksekusi yang Disarankan

| Fase | Dependensi | Effort | Risiko |
|---|---|---|---|
| 1. Satu Sumber Brand | — | S | Rendah |
| 2. Template DB | Fase 1 (brand helper) | L | Menengah (banyak titik refactor) |
| 3. Seed & Nilai Bisnis | — | M | Menengah (ubah nilai default) |
| 4. Inkonsistensi Teknis | — | M | Rendah |
| 5. Wilayah & Prompt | Fase 1 | S–M | Rendah–Menengah (test NLU) |
| 6. Dashboard | Fase 1 | M | Rendah |

**Disarankan kerjakan berurutan 1 → 3 → 4 → 5 → 2 → 6** (Fase 2 paling besar, lakukan setelah fondasi brand & nilai seed beres agar template DB langsung konsisten).

---

## Definisi Done per Fase
- [x] `npm run build` (tsc) exit 0.
- [x] `npm test` (Vitest) full hijau — test baru untuk setiap service baru.
- [x] Tidak ada hardcoded brand/phone/domain baru yang ditambahkan (grep gate).
- [x] Jalur DB-down tetap fallback ke in-memory (tidak ada crash baru).
- [ ] Fase 1–5: `npm run chat` smoke test 1 percakapan.
- [x] Changelog (Bahasa Indonesia) di-update (lihat CHANGELOG).

## Status Fase
- [x] Fase 1 — Satu Sumber Brand
- [x] Fase 3 — Nilai Bisnis dari Seed
- [x] Fase 4 — Inkonsistensi Teknis (4.1–4.4)
- [x] Fase 5 — Wilayah Layanan & Prompt Brand
- [ ] Fase 2 — Template Pesan & Brand dari DB (belum dieksekusi; paling besar, sengaja ditinggal terakhir)
- [ ] Fase 6 — Dashboard Multi-Tenant (opsional)

## Anti-Regresi Checklist
- Jangan commit nilai `.env`.
- Jangan pakai `prisma generate --no-engine` (trap `AGENTS.md`).
- Jangan drop tabel `children` (trap deploy).
- Setiap ubah `delivery_tiers`/`clinic_services` seed → cek test yang assert harga literal.
