# Laporan Audit Deep-Dive — Modul 10: Pengaturan Sistem, RBAC & Arsitektur Data-Driven

> **Tanggal audit:** 2026-11-07
> **Mode:** BACA-SAJA (tidak ada kode/test/config/.env yang diubah; server tidak dijalankan; DB/WAHA/Meta tidak dipanggil; tidak ada deploy)
> **Repo:** `C:\Users\Ivan\.gemini\antigravity\scratch\wa-clinic-bot` (Node 20 + TypeScript + Fastify + Prisma/PostgreSQL + WAHA; dashboard React di `packages/admin-dashboard`)
> **Di luar cakupan:** Modul 4 (Reservasi) dan Modul 6 (Live Chat) — tidak diaudit ulang; keduanya hanya dirujuk sebagai konsumen konfigurasi.
> **Auditor:** subagent audit (DeepSeek V4.1 Flash)

---

## 1. Ringkasan Eksekutif

Modul pengaturan sudah punya tulang punggung yang benar (tabel `Tenant.settings`, `clinic_services`, `delivery_tiers`, `clinic_policies`, `knowledge_chunks`, `tenant_prompt_configs`, `role_api_scopes`), tetapi **lapisan kontrol konfigurasinya masih berlubang**: otorisasi berbasis daftar-tolak URL, banyak nilai bisnis masih jatuh ke konstanta Kala, dan beberapa endpoint pengaturan mengembalikan "sukses" tanpa menulis apa pun. Ditemukan **17 temuan**: 4 KRITIS, 5 TINGGI, 7 SEDANG, 1 RENDAH. Temuan paling berbahaya adalah **Cfg-013 (endpoint konfigurasi seperti `/services`, `/delivery-tiers`, `/knowledge`, `/few-shots`, `/capi-config` dapat ditulis ADMIN_CS/custom role karena default-allow)**, **Cfg-001 (`PATCH /conversation-behavior` adalah stub tanpa persistensi)**, **Cfg-012 (30+ handler settings menulis `default-tenant`, bukan tenant peminta)**, dan **Cfg-003 (fallback rekening bank fiktif `BCA 1234567890` yang justru meloloskan gerbang "pembayaran belum diatur")**. Tiga prioritas: (1) ubah otorisasi konfigurasi menjadi allow-list per peran + test negatif per endpoint; (2) hentikan ghost/fake configuration (conversation-behavior, rekening fiktif, ghost-success katalog) dan tenant-scope seluruh mutasi; (3) pindahkan SOP/jam/area/katalog/tier yang masih hardcode ke DB dengan gerbang onboarding eksplisit. Sesuai instruksi, temuan lama yang sudah dicatat di `docs/KNOWN_ISSUES.md` dan laporan Modul 1/11 tidak diduplikasi sebagai temuan baru — dirujuk sebagai parent ID.

---

## 2. Framework & Cakupan

### 2.1 Framework dan alasan

| Framework | Alasan dipakai | Bagian yang dipetakan |
|---|---|---|
| **AWS Well-Architected** (Security, Reliability, Operational Excellence) | Modul 10 adalah bidang kontrol konfigurasi: perubahan harus durable, teraudit, dapat dipulihkan, dan tidak menghasilkan perilaku palsu. | Cfg-001, Cfg-006, Cfg-008, Cfg-009, Cfg-010, Cfg-011, Cfg-016 |
| **COBIT 2019-lite — kontrol konfigurasi (BAI06/BAI10, DSS06)** | Menilai apakah perubahan konfigurasi punya otorisasi, jejak perubahan, validasi, pemisahan tugas, dan sumber data tunggal. | Cfg-007, Cfg-008, Cfg-009, Cfg-011, Cfg-014, Cfg-017 |
| **OWASP ASVS 4.0 V4 (Access Control) + OWASP API Security Top 10 2023 (API1 BOLA, API3 BOPLA, API5 BFLA)** | Modul 10 penuh endpoint mutasi konfigurasi; perlu uji object-level dan function-level authorization, bukan hanya 401 anonim. | Cfg-002, Cfg-003, Cfg-004, Cfg-012, Cfg-013, Cfg-014 |
| **SaaS Readiness (tenant-aware / data-driven)** | Mandat repo: data bisnis wajib dari DB, hardcode hanya via Confirmation Gate. | Cfg-005, Cfg-006, Cfg-007, Cfg-012, Cfg-015 |
| **FMEA (S × O × D = RPN)** | Prioritas kuantitatif; S=9 untuk kebocoran/data bisnis yang tidak bisa dikelola admin/eskalasi privilege; S=4–6 untuk inkonsistensi konfigurasi. | Semua temuan |

### 2.2 Ruang lingkup yang diperiksa (Tahap 2)

**Backend — pengaturan & katalog**
- `src/routes/admin/settings.subroute.ts` (2.716 baris, 57 route) — seluruh handler dibaca untuk pola tenant, persistensi, audit, dan validasi.
- `src/routes/admin/knowledge.subroute.ts` (364 baris) — seluruh handler.
- `src/routes/admin/roles.subroute.ts` (195 baris) — seluruh handler.
- `src/routes/admin/staff-management.subroute.ts` (413 baris) — pembuatan/ubah/hapus staf dan pairing Telegram.
- `src/routes/admin/route-helpers.ts`, `src/routes/admin/stores.ts`, `src/routes/admin.route.ts` (hook auth + RBAC).
- `src/services/role-scope.service.ts`, `src/services/audit.service.ts`, `src/services/staff-auth.service.ts`, `src/services/admin-session.service.ts`.
- `src/services/treatment-catalog.service.ts`, `src/services/delivery.service.ts`, `src/services/staff-reservation.service.ts` (payment info & invoice), `src/services/knowledge.service.ts`.
- Sumber data: `prisma/schema.prisma` (Tenant, TenantPromptConfig, ClinicPolicy, KnowledgeChunk, DeliveryTier, ClinicService, RoleApiScope, CustomRole, Staff, AdminSession), migrasi `role_api_scopes` (`20260926…`, `20260930…`, `20261002…`, `20261106…`).

**Sumber data bisnis / hardcode runtime**
- `src/config/brand.ts`, `src/config/clinic.ts`, `src/config/clinic-location.ts`, `src/config/operational-hours.ts`, `src/config/persona.ts`, `src/config/followup-templates.ts`.
- `src/v3/tools/clinic-faq.tool.ts`, `src/v3/agent/prompt/**`, `src/v3/agent/few-shot-exemplars.ts`, `src/v3/agent/gold-few-shot-exemplars.ts`.
- `src/routes/admin/quick-replies.subroute.ts` (`DEFAULT_QUICK_REPLIES`).
- Dashboard: `packages/admin-dashboard/src/pages/tenant/Settings.tsx`, `ClinicServices.tsx`, `KnowledgeBase.tsx`, `StaffManagement.tsx`, komponen `components/settings/*`, `config/rolePermissions.ts`, `services/api.ts`.

### 2.3 Metode Tahap 0–6

- **Tahap 0** — framework dipilih (tabel 2.1).
- **Tahap 1** — `docs/KNOWN_ISSUES.md` dibaca (entri relevan diverifikasi ulang), ditambah `docs/audit/2026-11-02/fase-10/LAPORAN_FASE_10.md`, `docs/SAAS_READINESS_AUDIT.md`, `docs/FEATURE_INVENTORY.md`, dan laporan sibling Modul 1/11 (`S-003`, `S-009`, `Ar-003`, `Ar-004`, `Ar-005`, `S-012`) agar tidak menduplikasi.
- **Tahap 2** — inventaris + prioritas: (a) otorisasi konfigurasi; (b) isolasi tenant konfigurasi; (c) integritas persistensi konfigurasi; (d) sumber data bisnis/hardcode; (e) UI/UX pengaturan.
- **Tahap 3** — audit horizontal: pola `DEFAULT_TENANT_ID` (66 di settings), daftar-tolak prefix RBAC, `read-modify-write` JSONB, `catch → 200`, `fire-and-forget` persist, `allowedPaths` frontend-only, fallback statis Kala.
- **Tahap 4** — audit vertikal pada 5 alur: (1) UI Settings → API → `Tenant.settings`/tabel → efek AI; (2) login staf → role → `role_api_scopes` → endpoint konfigurasi; (3) Katalog/Tier/SOP → DB → RAG/tool → jawaban pelanggan; (4) Payment Info → invoice → pesan WhatsApp; (5) perubahan konfigurasi → audit log → forensik.
- **Tahap 5** — FMEA, blast radius, pre-mortem, urutan perbaikan (bagian 7).
- **Tahap 6** — rencana verifikasi per temuan (kolom Verifikasi).

### 2.4 Celah cakupan (eksplisit)

1. **Tidak ada akses DB/Log produksi.** Tidak dapat diverifikasi apakah `Tenant.settings.paymentInfo` tenant produksi terisi, apakah `clinic_policies` ter-seed, atau apakah `idle_greeting_*` pernah diubah. Semua klaim produksi ditandai `[ASUMSI]`/KEMUNGKINAN BESAR.
2. **Tidak menjalankan `npm run build`, `npm test`, atau suite apa pun** (mode baca-saja). Klaim “hijau” pada audit sebelumnya tidak diverifikasi ulang.
3. **Tidak semua 30+ subroute admin dibaca baris-per-baris**; sampling difokuskan pada settings, katalog, knowledge, RBAC, staf, payment, dan prompt. `labels`, `follow-up`, `meta-attribution`, `waba`, `backup` hanya diperiksa pola tenant/otorisasi.
4. **UI dashboard tidak diuji di browser**; temuan UI berbasis pembacaan kode (bukan hasil klik/observasi visual).
5. **Modul 4 & 6 dilewati** sesuai instruksi; efek konfigurasi ke reservasi/live chat hanya disinggung sebagai konsumen.
6. **Tidak ada uji eksploitasi runtime** (curl/Burp). Temuan otorisasi dibuktikan lewat alur kode dan dokumentasi test yang ada.
7. **`.env` tidak dibaca** (agar tidak memperluas paparan rahasia); hanya kode dan `.env.example` yang dirujuk.

---

## 3. Status Temuan Lama (Tahap 1)

### 3.1 `docs/KNOWN_ISSUES.md`

| ID | Judul singkat | Status lama | Verifikasi 2026-11-07 | Bukti |
|---|---|---|---|---|
| #129 (item 1) | Tenant-aware belum tuntas di semua subroute | OPEN | **MASIH TERBUKA**. `settings.subroute.ts` kini **66** referensi `DEFAULT_TENANT_ID`; `knowledge` 12; `roles` 7. | hitung `rg -c`; `settings.subroute.ts:635,1091,1532,1607,2031,2592` |
| #129 (item 2) | `role_api_scopes` belum di-seed untuk `admin_cs`/`spv_cs` | OPEN | **MASIH TERBUKA**. Seed hanya `therapist` (2+3 baris) dan `advertiser` (3 baris); `admin_cs`/`spv_cs` = 0 baris → `managed:false` → allow. | migrasi `20260926000002`, `20260930000000`, `20261002…`, `20261106…`; `role-scope.service.ts:62-64` |
| #128 (item 5) | 30+ handler settings masih `DEFAULT_TENANT_ID` | OPEN | **MASIH TERBUKA / SAMA**. Handler `persona`, `ai-models/provider`, `delivery-tiers`, `clinic-policies`, `capi-config`, `ai-rollout-scope`, `daily-report` tetap default. | `settings.subroute.ts:635,1173,1607,1701,2031,2239,2592` |
| #128 (item 7) | God file >1.500 baris | OPEN | **MASIH TERBUKA**. `settings.subroute.ts` **2.716 baris** (57 route). | `(Get-Content …).Count` |
| #268 | Belum ada route/UI tulis `settings.brand` | OPEN | **MASIH TERBUKA**. Hanya `logoUrl` yang bisa ditulis (menumpang `PUT /settings/pricelist-promo`); `businessName`/`botDisplayName` tanpa form. | `settings.subroute.ts:343-348`; `PricelistPromoPanel.tsx:209` |
| #267 | `qrisImageUrl` belum dikecualikan dari pruning media | OPEN | **MASIH TERBUKA** (tidak diubah pada audit ini; hanya dicatat sebagai risiko operasional). | `docs/KNOWN_ISSUES.md:970-980` |
| #305 | Zombie/overwrite seeding Quick Reply | SELESAI | **SELESAI untuk mekanisme seeding**, tetapi **konten default masih hardcode** (alamat Rungkut, jam 08–17) → lihat Cfg-007. | `quick-replies.subroute.ts:95-200,344-355` |
| #282 | Kebocoran lintas tenant `customers.subroute.ts` | SELESAI | **TERVERIFIKASI SELESAI** — `tenantOf(request)` dipakai; mutasi AI override tenant-scoped. | `customers.subroute.ts:1334,1341`; `route-helpers.ts:5-14` |
| #61 (item 1) | Koordinat klinik fallback hardcode di dashboard | OPEN | **MASIH TERBUKA**. `CLINIC_COORDS` + `DEFAULT_CANDIDATE_SLOTS` masih ada; backend juga masih memakai `clinicConfig` global. | `CreateReservationModal.tsx:55-60`; `slotRecommendations.ts:54-60`; `delivery.service.ts:237` |
| #182d | `copilot.styleTone` DB belum di-seed & tanpa UI | OPEN | **MASIH TERBUKA** — tidak ada route/panel yang menulis `settings.copilot.styleTone`. | `rg "copilot.styleTone" packages/admin-dashboard` → nihil |
| #129 (item 5) | Secret OAuth/Telegram belum di `.env.example` | OPEN (sebagian) | Tidak diaudit ulang (di luar Modul 10); rujuk laporan Modul 1/11. | — |
| #299 | Audit 2026-11-02 klaim PASS padahal gate gagal | RESOLVED | **TERVERIFIKASI** catatan resolusi; namun **cakupan Fase 10 tetap tidak menguji BFLA/tenant** → lihat Cfg-017. | `fase-10.json` 72 test; tidak ada test role-level untuk settings |

### 3.2 Temuan sibling Modul 1/11 (jangan diduplikasi)

| ID | Judul | Status | Kaitan dengan Modul 10 |
|---|---|---|---|
| **S-003** | RBAC fail-open: setiap role tanpa baris `role_api_scopes` (termasuk semua custom role) dapat akses hampir penuh | OPEN (High) | **Parent** Cfg-013. Modul 10 menambahkan **matriks endpoint konfigurasi** yang konkret. |
| **S-009** | Endpoint pengubah perilaku AI (few-shots, FAQ staging, rollout scope) terbuka untuk staf non-super-admin | OPEN (High) | **Parent** Cfg-013 (kolom AI). |
| **S-012** | `role` staf bebas diisi, tanpa kebijakan password/lockout | OPEN (High) | **Parent** Cfg-014 (role API & validasi). |
| **Ar-003** | Isolasi tenant tidak konsisten: 325 ref `DEFAULT_TENANT_ID`, tenant dari header, login staf hardcode | OPEN (High) | **Parent** Cfg-012 (dampak ke konfigurasi). |
| **Ar-004** | `Staff.phone` unik global | OPEN (Medium) | **Parent** Cfg-014/onboarding tenant. |
| **Ar-005** | Degradasi DB silent / “false success” 200 | OPEN (Medium) | **Parent** Cfg-009/Cfg-016. |

### 3.3 Klaim audit Fase 10 (2026-11-02)

Laporan `docs/audit/2026-11-02/fase-10/LAPORAN_FASE_10.md` menyatakan **PASS 100%** untuk 10 file / 72 test. Verifikasi ulang: benar 72 test lulus, **tetapi** test tersebut mengunci perilaku yang justru bermasalah:
- `tests/unit/admin-payment-info-settings.test.ts:64-78` secara eksplisit mengharapkan **rekening default fiktif** `BCA 1234567890` saat konfigurasi kosong (Cfg-003).
- `tests/unit/admin-rbac-guard.test.ts:236-239` mengomentari bahwa `ADMIN_CS` “unmanaged → allowed” adalah kondisi produksi yang diharapkan; test hanya memastikan endpoints Settings tertentu diblokir, **bukan** seluruh endpoint konfigurasi (Cfg-013).
- `tests/integration/admin-staff-authz-matrix.test.ts` memindai 313 pasangan method+path, tetapi hanya menguji **tanpa kredensial** (401/403), bukan otorisasi per peran (Cfg-017).

---

## 4. Peta Sumber Data (DB vs hardcode)

| Domain bisnis | Sumber kanonik (DB) | Jalur baca | Fallback / hardcode runtime | Status |
|---|---|---|---|---|
| Identitas brand | `Tenant.settings.brand` | `getBrandIdentityAsync()` (`src/config/brand.ts:46-83`) | `DEFAULT_BRAND_IDENTITY` = “Bidan Yusi” / “Kala Moms and Baby Spa” (`brand.ts:27-32`) | Sebagian tenant-aware; **tanpa UI tulis penuh** (#268) |
| Lokasi klinik & coverage | `Tenant.settings.clinicLocation` | `getClinicLocationAsync()` (`clinic-location.ts:45-85`) | `clinicConfig` env/default `-7.34886/112.751677`, “Kala Moms and Baby Spa”, 30 km (`clinic.ts:12-25`) | **Split-brain**: banyak pemanggil memakai `clinicConfig` langsung |
| Jam operasional | `Tenant.settings.operationalHours` + `ClinicPolicy` topik `operational_hours_and_booking` | `getOperationalHours()` (`operational-hours.ts:35-77`) | Default 08:00–17:00; **prompt & guardrail hardcode 08.00–17.00** | Tidak konsisten (Cfg-005) |
| Katalog layanan | `clinic_services` | `loadServicesFromDb()` → in-memory per tenant | `DEFAULT_CLINIC_SERVICES` **42 item** berharga & berlabel Kala (`treatment-catalog.service.ts:199-926`) — auto-seed bila DB kosong (`:1039-1057`) | Seed-only, tetapi auto-seed tanpa persetujuan (Cfg-006) |
| Tier ongkir | `delivery_tiers` | `getDeliveryTiersFromDb()` (`delivery.service.ts:124-161`) | `DEFAULT_TIERS` 7 tier berharga Kala (`:22-30`) — auto-seed (`:141-149`) | Sama (Cfg-006) |
| Info pembayaran/QRIS | `Tenant.settings.paymentInfo` → `ClinicPolicy` JSON | `StaffReservationService.getPaymentInfo()` (`staff-reservation.service.ts:2422-2486`) | **Rekening fiktif** `BCA 1234567890` a.n. nama tenant (`:2469-2477`) | **Berbahaya** (Cfg-003) |
| SOP / FAQ klinis | `clinic_policies` | `executeGetClinicFaq()` (`clinic-faq.tool.ts:172-204`) | `getStaticFallbackPolicy()` hardcode Waru/Sidoarjo, 30 km, 08–17, BCA/Mandiri/BRI, STR (`:86-169`) | Cfg-005 |
| Knowledge/FAQ RAG | `knowledge_chunks` (+ `faqs`) | `knowledgeBaseService` | Tidak ada konten default di runtime; **hanya route yang salah tenant** | Cfg-002 |
| Few-shot exemplar | `few_shot_exemplars` | `FewShotExemplarBank.getAllExemplars()` | `DEFAULT_FEW_SHOT_EXEMPLARS` auto-seed 7 exemplar Kala (`few-shot-exemplars.ts:230-260`), termasuk BCA/Mandiri/BRI & Sidoarjo (`:58-72`) | Cfg-005 |
| Persona prompt | `tenant_prompt_configs` → legacy `TenantPersona` | `TenantPromptConfigService` | `DEFAULT_PERSONA_PROMPT` besar di `persona.ts`; `TEMPLATES` (±32 pemakaian) | Sebagian; prompt inti masih hardcode |
| Model AI | `tenant_ai_config` | `AiModelConfigService` | Registry & daftar model/provider hardcode (`settings.subroute.ts:11-36`) | Cfg-010 |
| Role & scope API | `custom_roles` (path UI) + `role_api_scopes` (API) | `isApiScopeAllowed()` | Tidak ada baris = **allow all** (`role-scope.service.ts:62-64`) | Cfg-013 |
| Staf & sesi admin | `staff`, `staff_sessions`, `admin_sessions` | `StaffAuthService`, `AdminSessionService` | Login admin hardcode `DEFAULT_TENANT_ID`; `AdminSession` tanpa `tenant_id` | Cfg-012/Cfg-014 (parent Ar-003/Ar-004) |
| Notifikasi staf | `Tenant.settings.staffNotification`, kolom tenant | `getStaffNotificationConfig()` | Default OFF; **tanpa UI** | Cfg-011 |
| Quick Reply | `quick_replies` | `quick-replies.subroute.ts` | `DEFAULT_QUICK_REPLIES` 16 item, termasuk alamat “Jl. Raya Rungkut No. 45” & jam 08–17 (`:95-200`) — auto-seed (`:344-355`) | Cfg-007 |
| Jam tidur/idle greeting | Kolom `idle_greeting_enabled`, `idle_greeting_min_hours` | **Tidak ada pembaca runtime** | Endpoint `conversation-behavior` hanya echo (`settings.subroute.ts:1804-1836`) | **Ghost config** (Cfg-001) |
| Brand dashboard | `VITE_CLINIC_NAME` (build-time) | `packages/admin-dashboard/src/config/brand.ts` | Fallback “Kala Moms and Baby Spa” (`:9-10`) | Cfg-015 |
| Tenant request | Header `x-tenant-id` / body `tenantId` | `admin.route.ts:115,158`; `tenantOf()` | Dashboard **selalu** mengirim `default-tenant` (`api.ts:337-340`) | Cfg-012/Cfg-015 |

---

## 5. Daftar Temuan

> Format tiap temuan: ID, Judul, Tipe, Lokasi, Bukti, Keyakinan, Framework, Akar masalah (5 Whys), Risiko, FMEA, Collateral damage, Rekomendasi fondasional, Verifikasi.
> **Severity** adalah kelas risiko; **RPN** adalah prioritas kuantitatif. Keduanya bisa berbeda arah.

### Cfg-001 — `PATCH /api/admin/conversation-behavior` adalah stub: mengembalikan 200 “berhasil” tanpa menyimpan apa pun

- **Tipe:** Vertikal (UI/API → persistensi → perilaku bot) / Horizontal (pola ghost-success)
- **Lokasi:** `src/routes/admin/settings.subroute.ts:1804-1838`; kolom `idle_greeting_enabled`/`idle_greeting_min_hours` di `prisma/schema.prisma:845-846`.
- **Bukti:**
  ```ts
  // settings.subroute.ts:1826-1836
  const body = request.body || {};
  return reply.status(200).send({
    success: true,
    message: 'Konfigurasi perilaku percakapan diperbarui.',
    data: { idleGreeting: { enabled: body.idleGreeting?.enabled ?? true,
                            minHours: body.idleGreeting?.minHours ?? 24 } },
  });
  ```
  - Tidak ada `prisma.tenant.update`, tidak ada audit, tidak ada pembaca runtime untuk `idle_greeting_*` (`rg "idleGreeting|idle_greeting" src` → hanya route ini + log boot `app.ts:268`).
  - `GET` selalu mengembalikan `enabled:true, minHours:24` (`:1804-1811`), berbeda dari default skema 36 jam (`schema.prisma:846`).
- **Keyakinan:** **TERBUKTI**.
- **Framework:** COBIT BAI06/BAI10 (perubahan tidak tercatat), Well-Architected Operational Excellence (config drift), OWASP API10 (tidak ada validasi efek).
- **Akar masalah (5 Whys):**
  1. Mengapa admin melihat “berhasil”? → Route mengembalikan 200 + echo body.
  2. Mengapa tidak menyimpan? → Handler tidak pernah diimplementasikan; hanya stub.
  3. Mengapa stub lolos? → Tidak ada test kontrak “write → read → efek”; test hanya 401/200.
  4. Mengapa tidak ketahuan operasional? → Tidak ada audit log / UI yang memverifikasi nilai tersimpan.
  5. Mengapa kolom DB ada? → Skema menyiapkan fitur, implementasi berhenti di UI/route echo.
- **Risiko:** Admin mengira idle greeting aktif/nonaktif sesuai keinginan; perilaku bot tidak berubah → ekspektasi operasional palsu, sulit didiagnosis.
- **FMEA:** **S=7, O=8, D=9 → RPN 504**.
- **Collateral damage:** Jika nanti diimplementasikan, harus diputuskan apakah idle greeting per tenant memakai kolom tenant (sudah ada) atau `Tenant.settings`; perubahan perilaku bisa memicu pesan tak terduga ke pelanggan lama. Rollback: feature flag default OFF.
- **Rekomendasi fondasional:** Implementasi nyata di `conversation.service`/worker: baca `idle_greeting_enabled` + `idle_greeting_min_hours` per tenant, tulis via `prisma.tenant.update({ where: { id: tenantId } })`, audit perubahan (`before/after`), dan hapus default 24 hardcode. Jika fitur belum siap, **hapus route** atau kembalikan `501 NOT_IMPLEMENTED` — jangan pernah 200 palsu.
- **Verifikasi:** Test integrasi: PATCH `{enabled:false,minHours:48}` → GET mengembalikan nilai sama; query DB `SELECT idle_greeting_enabled, idle_greeting_min_hours` berubah; `audit_logs.action='UPDATE_CONVERSATION_BEHAVIOR'` ada. Test negatif: tenant B tidak boleh mengubah tenant A.

---

### Cfg-002 — Edit/hapus Knowledge Chunk tidak memiliki predikat tenant (BOLA/IDOR lintas tenant)

- **Tipe:** Vertikal (UI KnowledgeBase → API → DB) / Horizontal (pola mutasi `where:{id}`)
- **Lokasi:** `src/routes/admin/knowledge.subroute.ts:186-292`; list `:21`; `:132-159`.
- **Bukti:**
  ```ts
  // :204-211
  updated = await prisma.knowledgeChunk.update({ where: { id }, data: { title, content, keywords } });
  // :274
  await prisma.knowledgeChunk.delete({ where: { id } });
  ```
  - Listing memakai `where: { tenant_id: DEFAULT_TENANT_ID }` (`:21`), sehingga admin tenant B melihat chunk tenant default — lalu dapat mengedit/menghapusnya hanya dengan ID.
  - `POST /unanswered/:id/resolve` mengambil conversation `findUnique({where:{id}})` tanpa tenant (`:132-135`), lalu menulis FAQ ke `DEFAULT_TENANT_ID` (`:143-149`) dan `conversation.update({where:{id}})` (`:157-159`).
- **Keyakinan:** **TERBUKTI** (jalur kode; dampak lintas tenant aktif saat >1 tenant).
- **Framework:** OWASP API1:2023 BOLA, ASVS V4.2.1, STRIDE Tampering/Information Disclosure.
- **Akar masalah (5 Whys):**
  1. Mengapa chunk tenant lain bisa dihapus? → Mutasi hanya `where:{id}`.
  2. Mengapa tidak memakai tenant? → Route ditulis sebelum konversi tenant-aware; hanya list yang di-scope.
  3. Mengapa list tidak menolong? → List memakai default tenant, bukan tenant peminta.
  4. Mengapa tidak ada yang mencegah? → Tidak ada `updateMany({id, tenant_id})` atau test isolasi.
  5. Mengapa audit tidak menangkap? → Audit mencatat `targetId` chunk, bukan tenant asal.
- **Risiko:** (a) SOP/FAQ tenant A dapat diubah/dihapus dari sesi tenant B (sabotase jawaban AI); (b) pertanyaan pelanggan tenant B dapat dijawab ke pelanggan tenant A lewat `resolve`; (c) kehilangan data tanpa jejak tenant.
- **FMEA:** **S=9, O=6, D=7 → RPN 378**.
- **Collateral damage:** Perbaikan `updateMany` mengubah bentuk respons (count 0 → 404). UI `KnowledgeBase.tsx` harus menampilkan 404 jujur. Backfill/repair data yang sudah terlanjur terhapus tidak mungkin; butuh backup.
- **Rekomendasi fondasional:** (1) Semua baca/tulis `knowledge_chunks` memakai `tenant_id` dari `tenantOf(request)` (wajib, fail-closed); (2) gunakan `updateMany/deleteMany({ id, tenant_id })` dan 404 bila count 0; (3) `resolve` memuat conversation dengan `findFirst({ id, tenant_id })` + tulis FAQ ke tenant yang sama; (4) tambah unique/indeks `(tenant_id, id)` bila perlu; (5) test adversarial dua tenant.
- **Verifikasi:** Test: tenant B `PUT/DELETE` chunk milik A → 404 dan baris A tetap; list B tidak memuat A; `resolve` conversation A dari sesi B → 404. Query hitung chunk per tenant sebelum/sesudah.

---

### Cfg-003 — Fallback rekening bank fiktif `BCA 1234567890` meloloskan gerbang “pembayaran belum diatur” dan bisa terkirim ke pelanggan

- **Tipe:** Vertikal (Settings Payment → service → invoice → WhatsApp)
- **Lokasi:** `src/services/staff-reservation.service.ts:2469-2477` (fallback), `:2820-2829` (gate), `:2884-2890` (render); test pengunci `tests/unit/admin-payment-info-settings.test.ts:64-78`; preview UI `PaymentInfoPanel.tsx:164,175`.
- **Bukti:**
  ```ts
  // staff-reservation.service.ts:2469-2477
  return { qrisImageUrl: null, bankAccounts: [{ bank: 'BCA',
    accountNumber: '1234567890', accountName: tenant?.name || 'Kala Moms and Baby Spa' }] };
  ```
  ```ts
  // :2824-2829 — gate yang seharusnya memblokir
  if (!hasQris && !hasBank) return { success:false, error:'Informasi pembayaran ... belum diatur' };
  ```
  Karena fallback selalu mengembalikan 1 rekening, `hasBank` **selalu true**, sehingga gate tidak pernah aktif. Invoice lalu mencetak rekening fiktif (`:2884-2890`). Test `admin-payment-info-settings.test.ts:76-78` justru mengunci perilaku ini.
- **Keyakinan:** **TERBUKTI** pada jalur kode; dampak aktual bergantung apakah tenant produksi sudah mengisi `paymentInfo` **[ASUMSI: tenant existing sudah terisi]**.
- **Framework:** Well-Architected Reliability/Finance, COBIT DSS06 (integritas informasi), OWASP ASVS V5 (validasi output bisnis), prinsip non-hardcode.
- **Akar masalah (5 Whys):**
  1. Mengapa pelanggan bisa menerima rekening palsu? → Service mengembalikan “safe default” fiktif.
  2. Mengapa dianggap aman? → Bertujuan mencegah error 500 saat config kosong.
  3. Mengapa bukan fail-closed? → Gate memeriksa `hasBank` dari nilai yang sudah difabrikasi.
  4. Mengapa tidak terdeteksi? → Test mengharapkan fallback fiktif, bukan penolakan.
  5. Mengapa hardcode nomor? → Tidak ada model “payment profile wajib onboarding”.
- **Risiko:** Kerugian finansial/reputasi: pelanggan transfer ke rekening tidak dikenal; admin tidak sadar config kosong karena UI menampilkan rekening.
- **FMEA:** **S=9, O=5, D=7 → RPN 315**.
- **Collateral damage:** Menghapus fallback dapat memblokir alur invoice pada tenant yang belum onboarding — justru perilaku yang benar. UI harus menampilkan empty state + CTA “Atur Pembayaran”. Perlu migrasi data jika ada tenant yang selama ini hanya bergantung pada fallback (tidak mungkin valid).
- **Rekomendasi fondasional:** (1) `getPaymentInfo()` mengembalikan `{configured:false, bankAccounts:[]}` tanpa nomor fiktif; (2) invoice/route memeriksa `configured` dan menolak dengan pesan “Pembayaran belum diatur oleh admin”; (3) hapus nomor default dari kode & test; (4) tambahkan validasi onboarding: tenant aktif tanpa `paymentInfo` → alert di dashboard.
- **Verifikasi:** Test: settings kosong + policy kosong → `getPaymentInfo().configured === false`; `POST send payment info` → 409/422, bukan pesan berisi `1234567890`; grep `1234567890` di `src/` → 0 (kecuali fixture test yang eksplisit negatif).

---

### Cfg-004 — Token pairing Telegram tenant bocor ke `ADMIN_CS`/`SPV_CS` lewat allowlist GET Settings

- **Tipe:** Vertikal (RBAC → Settings read → integrasi Telegram)
- **Lokasi:** `src/routes/admin/settings.subroute.ts:2230-2249`; allowlist `src/routes/admin.route.ts:233-240`; konsumen pairing `src/routes/telegram-webhook.route.ts:101-120`.
- **Bukti:**
  ```ts
  // settings.subroute.ts:2239
  telegramPairingToken: pairingInfo.pairingToken,
  telegramDirectLink: pairingInfo.directLink,
  telegramGroupLink: pairingInfo.groupLink,
  ```
  `GET /api/admin/settings/daily-report` masuk `settingsReadAllowlist` (`admin.route.ts:237`), sehingga semua staf non-super-admin yang tidak “managed” (ADMIN_CS/SPV_CS) boleh membacanya. Token ini adalah kredensial pairing: webhook mencocokkan `telegram_pairing_token` lalu menyimpan `chat_id` pengirim (`telegram-webhook.route.ts:101-129`). Guard object-level serupa sudah ada untuk `/api/admin/staff/:id/telegram-pairing` (`staff-management.subroute.ts:361-373`) — tetapi tidak untuk tenant pairing.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** OWASP API3:2023 (BOPLA), ASVS V4.2.2/V8.3.1 (secret), STRIDE Information Disclosure/Spoofing.
- **Akar masalah (5 Whys):**
  1. Mengapa CS bisa melihat token? → Endpoint dimasukkan allowlist “read-only monitoring”.
  2. Mengapa dianggap aman? → Fokus allowlist pada “tidak bisa menulis”, bukan klasifikasi data.
  3. Mengapa token tidak dimasker? → Respons berisi objek pairing lengkap.
  4. Mengapa tidak ada guard? → Guard hanya dipasang pada endpoint staff pairing, bukan tenant pairing.
  5. Mengapa tidak terdeteksi? → Tidak ada test role-level untuk endpoint read Settings.
- **Risiko:** CS dapat mem-pair akun Telegram pribadi ke tenant, menerima notifikasi operasional (nama pasien, jadwal, alert medis), atau mengambil alih kanal notifikasi; potensi kebocoran PII.
- **FMEA:** **S=8, O=6, D=7 → RPN 336**.
- **Collateral damage:** Menyembunyikan token dari CS tidak mengganggu fungsi dashboard CS (mereka tidak memerlukan pairing). Super admin tetap butuh; UI `DailyReportPanel` memakai field ini.
- **Rekomendasi fondasional:** Pisahkan endpoint: `GET /api/admin/settings/daily-report` (status saja, token selalu `null`) dan `GET /api/admin/settings/telegram/pairing` (super-admin only, audit). Masker token (`PAIR_••••`) bila perlu ditampilkan. Tambah klasifikasi sensitivitas pada allowlist, bukan sekadar metode HTTP.
- **Verifikasi:** Test role: ADMIN_CS GET daily-report → body tanpa `telegramPairingToken`; ADMIN_CS GET pairing → 403; SUPER_ADMIN GET pairing → 200 + audit. Grep respons API untuk `PAIR_` di test snapshot.

---

### Cfg-005 — SOP, jam operasional, area layanan, dan metode pembayaran masih hardcode di prompt/tool/fallback serta di-seed ke tenant baru

- **Tipe:** Horizontal (data bisnis hardcode) / Vertikal (DB → prompt → jawaban pelanggan)
- **Lokasi/Bukti:**
  1. `src/v3/tools/clinic-faq.tool.ts:86-169` — fallback statis:
     - `:101` “Transfer Bank (BCA, Mandiri, BRI)... a.n. Kala Moms and Baby Spa”
     - `:125` “Homebase klinik kami berlokasi di Waru, Sidoarjo ... maksimal 30 km”
     - `:133` “buka setiap hari (Senin - Minggu) pukul 08.00 - 17.00 WIB”
     - `:93` kualifikasi STR; `:117` aturan pasca-vaksin 48–72 jam.
     - `:87` memakai `getBrandIdentity()` **sinkron** (default tenant), bukan `Async(tenantId)`.
  2. `src/v3/agent/prompt/phases/router-direct-reply.layer.ts:84` — “Jam operasional klinik adalah pukul 08.00–17.00 WIB” (string statis, tidak membaca `getOperationalHours`).
  3. `src/v3/agent/pipeline/guardrail-pipeline.ts:877` — catatan koreksi jadwal “jam operasional 08.00-17.00 WIB”.
  4. `src/v3/agent/prompt/layers/core-persona.layer.ts:11,39` — “area Surabaya dan Sidoarjo” + “radius 30 km” statis.
  5. `src/v3/agent/prompt/phases/scheduling.phase.ts:97` — “<= 30 km (promo ongkir)”.
  6. `src/v3/agent/gold-few-shot-exemplars.ts:46,56` — jam 08.00–17.00 & “Basecamp … Waru, perbatasan Surabaya–Sidoarjo”.
  7. `src/v3/agent/few-shot-exemplars.ts:58-72` — pembayaran BCA/Mandiri/BRI & “Balongdowo Candi Sidoarjo”; auto-seed 7 exemplar untuk setiap tenant baru (`:230-260`).
- **Keyakinan:** **TERBUKTI**.
- **Framework:** SaaS readiness (data bisnis dari DB), Well-Architected Reliability (jawaban salah), COBIT BAI06 (single source of truth).
- **Akar masalah (5 Whys):**
  1. Mengapa AI bisa menyebut jam/area yang salah? → Prompt & fallback berisi fakta statis Kala.
  2. Mengapa tidak memakai DB? → Tool fallback dipakai saat `clinic_policies` kosong; prompt hardcode untuk “keamanan”.
  3. Mengapa DB kosong? → Tidak ada seeding wajib saat onboarding tenant.
  4. Mengapa tidak ketahuan? → Test memakai default tenant; tidak ada test dua tenant dengan jam/area berbeda.
  5. Mengapa hardcode diterima? → Dianggap “fallback offline”, padahal jalur normal untuk tenant baru.
- **Risiko:** Tenant baru langsung menjawab dengan SOP/area/jam/rekening Kala → salah informasi klinis & komersial, potensi keluhan/kerugian; melanggar mandat non-hardcode.
- **FMEA:** **S=8, O=8, D=6 → RPN 384**.
- **Collateral damage:** Menghapus fallback dapat membuat bot tidak menjawab saat `clinic_policies` kosong. Solusi aman: gerbang onboarding — tenant tanpa policy diarahkan ke eskalasi manusia, bukan jawaban statis. Perubahan prompt harus diuji dengan golden dataset.
- **Rekomendasi fondasional:** (1) `clinic-faq.tool` hanya membaca DB; bila tidak ada policy → `{ success:false, reason:'POLICY_NOT_CONFIGURED' }` dan pipeline mengeskalasi; (2) semua prompt memakai `getOperationalHours(tenantId)` dan `getClinicLocationAsync(tenantId)` yang diinterpolasi ke string; (3) hapus `DEFAULT_FEW_SHOT_EXEMPLARS` yang mengandung fakta bisnis; seed exemplar generik tanpa bank/alamat; (4) wajibkan `ClinicPolicy` + `few_shot` minimal saat onboarding tenant; (5) test dua tenant dengan jam & area berbeda.
- **Verifikasi:** Test: tenant A policy 09–20/Waru vs tenant B 08–17/Bekasi → prompt & `get_clinic_policy_faq` mengembalikan nilai masing-masing; tenant tanpa policy → eskalasi, bukan “08.00–17.00”. Grep `08.00|Waru|BCA, Mandiri` di prompt/tool → hanya di fixture test.

---

### Cfg-006 — Katalog 42 layanan & tier ongkir berharga Kala di-hardcode dan di-seed otomatis ke tenant baru

- **Tipe:** Horizontal (data bisnis hardcode + auto-seed) / Vertikal (DB kosong → seed → harga pelanggan)
- **Lokasi:** `src/services/treatment-catalog.service.ts:199-926` (42 item), `:1039-1057` (seed); `src/services/delivery.service.ts:22-30` (7 tier), `:141-149` (seed).
- **Bukti:** `DEFAULT_CLINIC_SERVICES` berisi nama “Kala Baby – Cukur Rambut”, `originalPrice: 35000`, `promoPrice: 25000`, dst. (`:201-212`). Saat DB kosong: `console.warn('[SEED] Catalog treatment kosong ... DEFAULT_CLINIC_SERVICES (code default ...)')` lalu `saveServicesToDb(tenantId)` (`:1050-1057`). Tier: `{maxDist:5,fee:0}`, `{7,15000,10000}`, … (`delivery.service.ts:22-30`).
- **Keyakinan:** **TERBUKTI**.
- **Framework:** SaaS readiness, COBIT BAI06, Well-Architected Reliability (harga salah).
- **Akar masalah (5 Whys):**
  1. Mengapa tenant baru punya harga Kala? → Seed dari konstanta kode.
  2. Mengapa seed otomatis? → Mencegah katalog kosong saat fresh deploy.
  3. Mengapa bukan katalog generik? → Konstanta diambil dari data produksi.
  4. Mengapa tidak dikonfirmasi? → Onboarding tenant belum punya wizard; seed berjalan diam-diam (hanya `console.warn`).
  5. Mengapa audit sebelumnya menerima? → Header “SEED-ONLY” dianggap cukup (#128 item 1a).
- **Risiko:** Tenant baru menawarkan layanan/harga klinik lain; pesanan & invoice memakai nominal salah; sulit dibedakan dari data resmi.
- **FMEA:** **S=8, O=7, D=6 → RPN 336**.
- **Collateral damage:** Menghapus default dapat membuat katalog kosong → bot tidak bisa menjawab harga (harus eskalasi). Tier kosong membuat perhitungan ongkir gagal → perlu fallback fail-closed (bukan angka Kala).
- **Rekomendasi fondasional:** (1) Pindahkan katalog/tier awal ke **template onboarding** di DB (`tenant_onboarding_templates`) yang dipilih admin, bukan konstanta; (2) jika tidak ada template → katalog kosong + banner “belum dikonfigurasi”, tool `get_catalog_and_price` mengembalikan `CATALOG_EMPTY`; (3) seed hanya via aksi admin eksplisit dengan konfirmasi; (4) hapus nama/harga Kala dari `DEFAULT_CLINIC_SERVICES` (jadikan fixture test).
- **Verifikasi:** Test: tenant baru tanpa template → `getAllServices()` kosong & tool menolak dengan pesan konfigurasi; onboarding dengan template X → harga X (bukan Kala). DB check: tidak ada `clinic_services` yang tercipta tanpa aksi admin.

---

### Cfg-007 — Quick Reply default berisi alamat & jam klinik Kala dan di-seed otomatis ke tenant baru

- **Tipe:** Horizontal (template pesan hardcode) / Vertikal (seed → CS kirim → pelanggan)
- **Lokasi:** `src/routes/admin/quick-replies.subroute.ts:95-200` (16 template), `:344-355` (auto-seed), `:734-775` (seed manual).
- **Bukti:** Template `lokasi` berisi `'Alamat lengkap klinik kami:\n📍 Jl. Raya Rungkut No. 45, Surabaya.\nPatokan: Sebelah Apotek K-24.\nJam operasional: 08.00 - 17.00 WIB.'` (`:133`); auto-seed saat list kosong dan belum ada flag `quickRepliesSeeded` (`:344-355`).
- **Keyakinan:** **TERBUKTI**.
- **Framework:** SaaS readiness, COBIT DSS06 (informasi pelanggan), Well-Architected Operational Excellence.
- **Akar masalah (5 Whys):**
  1. Mengapa tenant baru punya alamat Rungkut? → Template default hardcode.
  2. Mengapa di-seed? → Fitur “langsung siap pakai” untuk CS.
  3. Mengapa bukan dari `clinicLocation`? → Template ditulis sebelum ada seam lokasi tenant.
  4. Mengapa tidak ada peringatan? → Seed hanya flag `quickRepliesSeeded`, tidak memvalidasi isi.
  5. Mengapa tidak terdeteksi? → Tidak ada test dua tenant / audit isi template.
- **Risiko:** CS mengirim alamat/jam klinik lain ke pelanggan; kebingungan operasional & reputasi.
- **FMEA:** **S=7, O=6, D=6 → RPN 252**.
- **Collateral damage:** Menghapus template default membuat CS tidak punya balasan cepat; solusi: template generik (“Alamat klinik belum diatur, hubungi admin”) + CTA isi profil.
- **Rekomendasi fondasional:** Seed template generik tanpa alamat/nomor; template `lokasi`/`qris`/`pricelist` menginterpolasi `clinicLocation` & `paymentInfo` dari DB saat render; validasi seed: tolak template yang memuat alamat/nomor yang tidak cocok dengan tenant.
- **Verifikasi:** Test: tenant baru → quick reply `lokasi` tidak memuat “Rungkut”; setelah `clinicLocation` diisi, preview memuat alamat tenant. Grep `Rungkut` di `src/` → hanya test.

---

### Cfg-008 — `Tenant.settings` (JSONB) ditulis dengan read-modify-write penuh: lost update, tanpa skema/versi

- **Tipe:** Horizontal (pola persistensi) / Vertikal (dua admin → simpan → data hilang)
- **Lokasi:** `src/routes/admin/settings.subroute.ts:334-365` (promo/logo), `:466-487` (meta policy), `:573-608` (payment info); `prisma/schema.prisma:877` (`settings Json?`).
- **Bukti:**
  ```ts
  const updatedSettings = { ...currentSettings, paymentInfo: updatedPaymentInfo };
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: updatedSettings } });
  ```
  Tidak ada `$transaction`, `updated_at` check, atau patch JSONB (`settings || patch`). Dua tab admin yang menyimpan panel berbeda bersamaan akan saling menimpa. `settings` tidak punya schema/Zod/versi; kunci apa pun diterima.
- **Keyakinan:** **TERBUKTI** (pola kode; reproduksi butuh dua request paralel).
- **Framework:** COBIT BAI06/DSS06, Well-Architected Reliability (data integrity), OWASP ASVS V5.1.
- **Akar masalah (5 Whys):**
  1. Mengapa config bisa hilang? → Seluruh JSON ditulis ulang dari snapshot lama.
  2. Mengapa snapshot? → Prisma JSON tidak punya operasi merge.
  3. Mengapa tidak transaksi? → Tidak ada versi/optimistic lock pada `Tenant`.
  4. Mengapa tidak terdeteksi? → Tidak ada test konkurensi; UI menyimpan per panel.
  5. Mengapa tanpa skema? → `settings` bebas JSON sejak awal; tidak ada kontrak tervalidasi.
- **Risiko:** Kehilangan setelan promo/logo/payment/meta policy secara senyap; sulit direproduksi; audit tidak mencatat nilai sebelum/sesudah.
- **FMEA:** **S=6, O=6, D=8 → RPN 288**.
- **Collateral damage:** Migrasi ke skema tervalidasi dapat menolak data lama yang tidak sesuai; perlu validator longgar + backfill. Perubahan API harus kompatibel dengan UI panel.
- **Rekomendasi fondasional:** (1) Buat `TenantSettingsService.patch(tenantId, patch)` yang memakai `prisma.$executeRaw` JSONB `settings = settings || $patch` (atau transaksi + `updated_at` compare) dan audit diff; (2) definisikan skema Zod per domain (`brand`, `promo`, `paymentInfo`, `operationalHours`, `copilot`, dll.) dan validasi di service; (3) tambahkan `settings_version`/`updated_at` check; (4) test dua penulis paralel.
- **Verifikasi:** Test konkurensi: dua `PATCH` berbeda (payment + promo) → keduanya ada; `updated_at` berubah; test skema menolak `bankAccounts` non-array. DB check diff JSON.

---

### Cfg-009 — Jejak audit perubahan konfigurasi tidak lengkap: write tanpa audit, tenant audit salah, kegagalan audit ditelan

- **Tipe:** Horizontal (logging/forensik konfigurasi)
- **Lokasi:** `src/services/audit.service.ts:45-47`; `src/routes/admin/settings.subroute.ts:1079-1127` (customer-service tanpa audit); contoh audit tanpa `tenantId`: `:80-86`, `:152-158`, `:489-499`, `:2592-2659`; `:610-617` (payment info payload berisi nomor rekening).
- **Bukti:**
  - `audit.service.ts`: `catch (err) { console.error('[Audit Service] Failed to log admin action:', err.message); }` → perubahan tetap sukses meski audit gagal.
  - `POST /api/admin/customer-service` mengubah `whatsapp_number`, `greetings_text`, `format_*` tanpa `auditService.logAdminAction` sama sekali.
  - Banyak panggilan `logAdminAction` tidak mengirim `tenantId` → default `DEFAULT_TENANT_ID` (`audit.service.ts:26`), sehingga perubahan tenant B tercatat sebagai tenant default.
  - Tidak ada audit “before/after” untuk `settings` JSON (hanya sebagian nilai).
- **Keyakinan:** **TERBUKTI** (grep 31 audit vs 57 route; customer-service tidak termasuk).
- **Framework:** COBIT DSS06/MEA02, OWASP ASVS V7.1/V7.2, NIST CSF Detect.
- **Akar masalah (5 Whys):**
  1. Mengapa perubahan config tak bisa dilacak? → Beberapa route tidak memanggil audit.
  2. Mengapa tenant salah? → `tenantId` opsional dengan default.
  3. Mengapa audit bisa hilang? → Kegagalan audit ditelan (best-effort).
  4. Mengapa tidak ada diff? → Payload hanya nilai baru/ringkasan.
  5. Mengapa lolos? → Tidak ada test/gate “setiap write config wajib audit”.
- **Risiko:** Tidak dapat menjawab “siapa mengubah nomor WA/harga/jam pada jam X”; investigasi insiden & kepatuhan gagal; perubahan lintas tenant tidak terlihat.
- **FMEA:** **S=7, O=6, D=8 → RPN 336**.
- **Collateral damage:** Mewajibkan audit dapat menggagalkan operasi saat DB audit down. Pilihan aman: outbox audit (tabel/queue) + retry, bukan menelan; atau minimal `logger` terstruktur dengan `tenant_id` + `trace_id`.
- **Rekomendasi fondasional:** (1) `auditService.logAdminAction` wajib `tenantId` (parameter non-opsional) dan mengembalikan status; (2) helper `withConfigAudit()` membungkus semua route write config; (3) simpan `before/after` (redaksi secret) + `actor`, `ip`, `trace_id`; (4) tambah test kontrak yang memindai route write config dan memastikan audit terpanggil; (5) `customer-service` POST diberi audit.
- **Verifikasi:** Test: setiap endpoint config write → baris `audit_logs` dengan `tenant_id` benar & `before/after`; simulasi DB audit down → route mengembalikan warning/503 sesuai kebijakan, bukan sukses senyap. Query: `SELECT count(*) FROM audit_logs WHERE action='UPDATE_CUSTOMER_SERVICE'`.

---

### Cfg-010 — “Ghost success” pada tulis katalog/tier: respons 200 sebelum DB durable, plus validasi harga longgar

- **Tipe:** Vertikal (UI → API → in-memory → DB async)
- **Lokasi:** `src/services/treatment-catalog.service.ts:1676-1695`; route `settings.subroute.ts:1889-1920, 1969-1998, 2009-2021`; validasi `:1897-1899`.
- **Bukti:** `upsertService`/`deleteService` menulis ke Map lalu `saveServicesToDb(tenantId).catch(e => console.warn(...))` — fire-and-forget; route langsung `reply.status(200)`. Jika DB gagal, admin melihat “berhasil” tetapi restart mengembalikan katalog lama. Harga: `Number(serviceData.originalPrice) || 0` dan `promoPrice || 0` menerima 0/negatif; `durationMinutes || 45` menelan input invalid.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** COBIT BAI06 (perubahan tidak durable), Well-Architected Reliability, OWASP ASVS V5.1.
- **Akar masalah (5 Whys):**
  1. Mengapa admin bisa melihat sukses palsu? → Route tidak menunggu persist.
  2. Mengapa async? → Menjaga respons cepat.
  3. Mengapa error ditelan? → `.catch(console.warn)`.
  4. Mengapa validasi longgar? → `|| 0`/`|| 45` dianggap “sanitasi”.
  5. Mengapa tidak ada test? → Test hanya memeriksa bentuk respons.
- **Risiko:** Perubahan harga/hapus layanan hilang setelah deploy/restart; harga 0/negatif masuk DB dan dipakai invoice; durasi default 45 menit salah.
- **FMEA:** **S=7, O=5, D=7 → RPN 245**.
- **Collateral damage:** Menunggu persist menambah latency (kecil, satu transaksi). Validasi ketat dapat menolak data lama yang tidak lengkap; perlu mode migrasi.
- **Rekomendasi fondasional:** (1) `await saveServicesToDb` sebelum 200, atau tulis DB dulu lalu perbarui cache (write-through); (2) route mengembalikan 500/503 jika persist gagal; (3) validasi Zod: harga integer ≥ 0, promo ≤ original, durasi 15–480, nama non-empty; (4) test DB-down → non-2xx.
- **Verifikasi:** Test: mock `saveServicesToDb` reject → route 5xx & cache rollback; POST harga -1/0 → 400; DB check setelah request.

---

### Cfg-011 — Beberapa setelan tenant tidak punya jalur tulis/UI (clinicLocation, operationalHours, staffNotification, estimateTtlDays, copilot.styleTone, brand lengkap)

- **Tipe:** Horizontal (manageability/config control)
- **Lokasi:** `src/config/clinic-location.ts:45` (baca), `src/config/operational-hours.ts:35` (baca), `src/config/staff-notification-config.ts:27` (baca), `src/services/human-background-enrichment.service.ts:78` (baca), `src/services/copilot/copilot.service.ts:619`; grep route/dashboard: tidak ada penulis.
- **Bukti:** `rg "clinicLocation|operationalHours|staffNotification|estimateTtlDays|styleTone" src/routes/admin packages/admin-dashboard/src` → hanya pembaca/tipe, tanpa route/panel penulis. Satu-satunya cara mengubah adalah SQL manual/script (`src/scripts/seed-delivery-settings.ts`, `seed-copilot-sop-owner.ts`). #268 (brand) dan #182d (styleTone) mencatat sebagian.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** COBIT BAI06/BAI10 (perubahan tidak terkendali), SaaS readiness (admin tidak bisa konfigurasi tanpa deploy/SQL).
- **Akar masalah (5 Whys):**
  1. Mengapa admin tidak bisa ubah? → Tidak ada endpoint/UI.
  2. Mengapa hanya dibaca? → Fitur ditambahkan untuk kebutuhan internal/seed.
  3. Mengapa tidak dilengkapi? → Dianggap “cukup via SQL” saat single-tenant.
  4. Mengapa berbahaya? → Perubahan produksi tidak teraudit & rawan typo.
  5. Mengapa tidak terdeteksi? → Tidak ada inventaris “setting yang harus punya UI”.
- **Risiko:** Operasional bergantung pada DBA/CLI; salah ketik JSON tidak tervalidasi; tenant baru tidak bisa onboarding mandiri.
- **FMEA:** **S=6, O=6, D=7 → RPN 252**.
- **Collateral damage:** Menambah panel di Settings memperbesar file/UI; gunakan tab/drawer (reusability-first), bukan page baru.
- **Rekomendasi fondasional:** (1) Buat `TenantConfigService` dengan whitelist kunci + skema Zod; (2) ekspos `GET|PUT /api/admin/settings/tenant-config/:domain` (super-admin/tenant-admin) untuk `clinicLocation`, `operationalHours`, `staffNotification`, `deliverySettings`, `copilot`; (3) integrasikan sebagai tab/drawer di `Settings.tsx` (bukan page baru); (4) audit semua perubahan; (5) test round-trip dan validasi.
- **Verifikasi:** Test API round-trip setiap domain; GET setelah PUT; UI tab muncul; `audit_logs` tercatat. Tidak ada lagi script SQL sebagai satu-satunya jalur.

---

### Cfg-012 — 30+ handler konfigurasi menulis `default-tenant`, bukan tenant peminta (termasuk bot toggle, AI, tier, SOP, CAPI, Telegram)

- **Tipe:** Vertikal (sesi/tenant → handler → DB) / Horizontal (pola `DEFAULT_TENANT_ID`)
- **Lokasi/Bukti utama:**
  - Bot toggle: `settings.subroute.ts:1532,1554-1560`.
  - Persona: `:635,665,679` (default) vs prompt-config `:698,736` (tenant) → split-brain.
  - AI provider: `:1173,1176-1178,1200`; AI models GET `:1134`; PATCH task memakai tenant tapi `oldConfig` default (`:1469,1472`).
  - CAPI config: `:1601-1607,1643-1666` (seluruhnya default; `_request` diabaikan).
  - AI rollout: `:1698-1701,1706-1712,1779`.
  - Delivery tiers: `:2031,2057`.
  - Clinic policies: `:2589-2599,2622-2649`.
  - Daily report/Telegram: `:2203-2206,2222,2331-2339`.
  - Customer service: `:1056-1059` (`findFirst({id: default})` → fallback `findFirst()` = **tenant acak**), POST `:1091-1093` fallback `findFirst()` → menulis tenant acak.
  - Kontras: `media`, `mql`, `pricelist`, `payment-info`, `notifications` sudah tenant-aware (`:103-105,50,177-190,516,2379`).
- **Keyakinan:** **TERBUKTI**. Parent: **Ar-003 / #129 item 1 / #128 item 5** (OPEN) — temuan ini menambahkan **daftar handler & dampak konfigurasi**, bukan mengklaim kelas baru.
- **Framework:** SaaS readiness, OWASP API1, ASVS V4.2, Well-Architected Security.
- **Akar masalah (5 Whys):**
  1. Mengapa tenant B mengubah config A? → Handler memakai konstanta default.
  2. Mengapa? → Konversi tenant-aware bertahap, berhenti di 6 handler.
  3. Mengapa berhenti? → `AdminSession` tanpa `tenant_id`; butuh keputusan model (Confirmation Gate).
  4. Mengapa tidak fail-closed? → `resolveTenantId` fallback default (tanpa 401).
  5. Mengapa tidak terdeteksi? → Test hanya default tenant.
- **Risiko:** (a) Tenant B mematikan/menyalakan bot tenant A; (b) mengganti model AI/prompt/ongkir/SOP tenant A; (c) mengganti Pixel/CAPI tenant A (atribusi iklan rusak); (d) `customer-service` menulis tenant acak bila default tidak ada; (e) audit mencatat pelaku di tenant salah (Cfg-009).
- **FMEA:** **S=9, O=8, D=6 → RPN 432**.
- **Collateral damage:** Memaksa tenant context dapat memblokir endpoint global (health, webhook). Perlu whitelist. Migrasi `AdminSession` butuh kolom + backfill + aturan super-admin. Rollout per domain dengan feature flag.
- **Rekomendasi fondasional:** (1) Satu seam `resolveTenantContext(request)` (parent Ar-003) — untuk staf dari sesi, untuk admin dari tenant binding (bukan header bebas); (2) ganti **seluruh** `DEFAULT_TENANT_ID` di handler konfigurasi dengan `tenantOf(request)`; (3) `GET /settings` mengembalikan brand & bot toggle dari tenant yang sama; (4) `customer-service` hapus fallback `findFirst()` → 404/400; (5) test dua tenant untuk setiap handler (matriks di bagian 6).
- **Verifikasi:** Test: staf/admin tenant B PATCH settings → hanya baris tenant B berubah; tenant A tidak berubah; `GET` B tidak melihat A. Grep gate: `DEFAULT_TENANT_ID` di `settings.subroute.ts` hanya untuk seed/test (target 0 di handler).

---

### Cfg-013 — Matriks otorisasi konfigurasi: endpoint tulis katalog/tier/SOP/few-shot/CAPI terbuka untuk ADMIN_CS/SPV_CS/custom role

- **Tipe:** Horizontal (otorisasi) / Vertikal (login → role → scope → endpoint config)
- **Lokasi:** `src/services/role-scope.service.ts:62-64`; `src/routes/admin.route.ts:201-290`; daftar tolak `:205-222`; allowlist baca `:233-240`.
- **Bukti:**
  - `rows.length === 0 → { allowed: true, managed: false }` (`role-scope.service.ts:62-64`).
  - `admin.route.ts:201` hanya memeriksa `staffRole !== 'SUPER_ADMIN'`; daftar tolak berisi 13 prefix: `backup`, `settings`, `ai-models`, `evaluations`, `ai-evaluations`, `sandbox`, `debug`, `migration`, `persona`, `export`, `integrations/google`, `waba`, `customers/audience-export`.
  - **Tidak** ada di daftar tolak: `/api/admin/services`, `/api/admin/delivery-tiers`, `/api/admin/knowledge`, `/api/admin/few-shots`, `/api/admin/ai-rollout-scope`, `/api/admin/capi-config`, `/api/admin/customer-service`, `/api/admin/quick-replies`, `/api/admin/ctwa-catchers`, `/api/admin/labels`, `/api/admin/conversation-behavior`, `/api/admin/purchase-moderation`.
  - Migrasi seed: hanya `therapist` + `advertiser`; komentar `20260926000002` menyatakan `admin_cs/spv_cs: belum di-seed`; `role_api_scopes` **tidak punya** route/UI tulis (grep `roleApiScope.create|upsert` → nihil).
- **Keyakinan:** **TERBUKTI**. Parent: **S-003 / S-009** (OPEN) — bagian ini adalah audit pemetaan yang diminta #129 item 2.
- **Framework:** OWASP API5:2023 BFLA, ASVS V4.1/V4.2, COBIT DSS05.04 (pemisahan tugas).
- **Akar masalah (5 Whys):**
  1. Mengapa ADMIN_CS bisa mengubah harga? → Endpoint di luar daftar tolak.
  2. Mengapa daftar tolak? → RBAC di-retrofit sebagai denylist agar tidak memblokir operasional.
  3. Mengapa bukan allowlist? → `role_api_scopes` opt-in per role; `admin_cs/spv_cs` belum dipetakan.
  4. Mengapa custom role lebih parah? → UI hanya menyimpan `custom_roles.allowed_paths` (path frontend), bukan API prefix.
  5. Mengapa tidak terdeteksi? → Test hanya 401 anonim; test role-level terkunci pada allowlist Settings tertentu.
- **Risiko:** Staf CS (atau custom role “marketing/finance”) dapat mengubah harga, ongkir, SOP klinis, exemplar AI, Pixel/CAPI, serta memicu/mengubah perilaku bot — **tanpa jejak yang memadai** (Cfg-009) dan **lintas tenant** (Cfg-012). Ini eskalasi privilege fungsional.
- **FMEA:** **S=9, O=8, D=8 → RPN 576**.
- **Collateral damage:** Allowlist ketat dapat memblokir alur CS yang sah (mis. butuh baca katalog). Solusi: seed `admin_cs` dengan GET katalog/labels/livechat/reservasi + write terbatas (quick reply, label), **bukan** write harga/SOP/CAPI. Rollout bertahap dengan audit mode (log-only) sebelum enforce.
- **Rekomendasi fondasional:** (1) Ubah ke **allowlist** per `role_key` (default-deny bila role tidak punya baris, kecuali super admin) — jangan `managed:false → allow`; (2) pindahkan daftar tolak menjadi metadata scope di DB, bukan array kode; (3) buat route/UI `GET|PUT /api/admin/roles/:key/scopes` (super-admin) + auto-seed saat custom role dibuat; (4) test matriks: setiap (role × endpoint config × method) punya ekspektasi 200/403; (5) tambahkan `requireSuperAdmin` eksplisit pada route config kritikal (services, delivery-tiers, few-shots, capi-config, ai-rollout-scope, knowledge write).
- **Verifikasi:** Test baru `config-authz-matrix.test.ts`: ADMIN_CS `POST /api/admin/services` → 403; `POST /api/admin/delivery-tiers` → 403; `PUT /api/admin/knowledge/chunks/:id` → 403; `POST /api/admin/few-shots` → 403; `PATCH /api/admin/capi-config` → 403; `PATCH /api/admin/ai-rollout-scope` → 403. Custom role “finance” → hanya endpoint yang di-seed. SUPER_ADMIN → 200. Test harus gagal pada kode saat ini (red) sebelum fix.

**Matriks ringkas (actual saat ini):**

| Peran | Settings (`/settings*`) | Katalog & Tier | Knowledge/SOP | Few-shot & AI rollout | Persona/AI model | CAPI config | Roles/Staff | Customers PII |
|---|---|---|---|---|---|---|---|---|
| `SUPER_ADMIN` / API key | ✅ semua (lintas tenant via header) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ADMIN_CS` (unmanaged) | ⚠️ GET 4 endpoint; write ❌ | ✅ **write** | ✅ **write** | ✅ **write** | ❌ (`/persona`,`/ai-models`) | ✅ **write** | GET ✅ / write ❌ | ✅ |
| `SPV_CS` (unmanaged) | ⚠️ sama | ✅ **write** | ✅ **write** | ✅ **write** | ❌ | ✅ **write** | GET ✅ / write ❌ | ✅ |
| `ADVERTISER` (managed) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `THERAPIST` (managed) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `/staff/me` + push | ❌ |
| Custom role baru | ⚠️ GET 4; write ❌ | ✅ **write** | ✅ **write** | ✅ **write** | ❌ | ✅ **write** | GET ✅ / write ❌ | ✅ |
| Sesi `admin_session` | ✅ semua (tanpa `tenant_id`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

> Catatan: `admin_session` dan `X-API-KEY` melewati blok RBAC karena `staffRole` tidak di-set (`admin.route.ts:200`). Ini by-design super admin, tetapi berarti **semua** pemegang sesi admin adalah super-admin lintas tenant (parent #316 K-03).

---

### Cfg-014 — `roles.subroute.ts` mengabaikan tenant dan dapat menimpa `allowedPaths` role sistem; `allowedPaths` tidak divalidasi

- **Tipe:** Vertikal (UI StaffManagement → roles API → DB) / Horizontal (pola tenant)
- **Lokasi:** `src/routes/admin/roles.subroute.ts:27-55, 61-144, 150-194`; `packages/admin-dashboard/src/pages/tenant/StaffManagement.tsx:343-356`.
- **Bukti:** Semua query memakai `tenant_id: DEFAULT_TENANT_ID` (`:30,85,96,164`). `upsert` pada `key` yang sudah ada (termasuk role sistem `admin_cs`) mengubah `label`, `allowed_paths`, `default_redirect` tanpa memeriksa `is_system` (`:82-104`). `allowedPaths` diterima apa adanya (tidak dicocokkan ke `ALL_MODULES`; bisa `*`). `key` dinormalisasi `replace(/[^a-z0-9_]/g,'_')` tanpa menolak input invalid (`:79`).
- **Keyakinan:** **TERBUKTI**.
- **Framework:** COBIT DSS06 (integritas master data), OWASP API3, SaaS readiness.
- **Akar masalah (5 Whys):**
  1. Mengapa role tenant B mengubah role tenant A? → `DEFAULT_TENANT_ID`.
  2. Mengapa role sistem bisa ditimpa? → `upsert` tidak memfilter `is_system`.
  3. Mengapa path bebas? → Tidak ada validasi terhadap daftar modul.
  4. Mengapa tidak ketahuan? → Test role-permissions hanya membaca `DEFAULT_ROLE_CONFIGS`, bukan API.
  5. Mengapa UI aman? → UI hanya menyembunyikan; backend tetap menerima.
- **Risiko:** Menu/path role sistem berubah (mis. `admin_cs` diberi `/admin/settings` di frontend), membingungkan otorisasi; role custom lintas tenant.
- **FMEA:** **S=7, O=4, D=6 → RPN 168**.
- **Collateral damage:** Menolak perubahan role sistem dapat memblokir kebutuhan kustomisasi; solusi: hanya `is_system=false` yang boleh diubah, role sistem diubah via migrasi.
- **Rekomendasi fondasional:** (1) `tenantOf(request)` di semua query; (2) `PUT /roles/:key` menolak `is_system=true` (409); (3) validasi `allowedPaths ⊂ ALL_MODULES` (server-side allowlist); (4) buat endpoint/seed `role_api_scopes` yang sinkron dengan `custom_roles`; (5) audit before/after.
- **Verifikasi:** Test: tenant B POST role → hanya B; ubah `admin_cs` → 409; `allowedPaths:['/admin/evil']` → 400; GET B tidak melihat role A.

---

### Cfg-015 — Dashboard hardcode tenant & data bisnis: `x-tenant-id: default-tenant`, brand Kala, rekening placeholder, logo Kala, koordinat/slot klinik

- **Tipe:** Horizontal (frontend hardcode) / Vertikal (UI → API)
- **Lokasi/Bukti:**
  - `packages/admin-dashboard/src/services/api.ts:337-340` — setiap request tanpa header diisi `'default-tenant'`; login juga default (`AuthContext.tsx:135,233`).
  - `src/config/brand.ts` dashboard `:9-10` — fallback “Kala Moms and Baby Spa”; `Layout.tsx:584,795` alt “Kala Logo”.
  - `PaymentInfoPanel.tsx:164,175` — preview rekening `BCA 8877665544 a.n. PT Kala Sejahtera`.
  - `QuickReplies.tsx:78` — fallback `{bank_accounts}` = `BCA 1234567890 a.n Kala Moms & Baby Spa`.
  - `TodayTreatments.tsx:2367` — template balasan “saya dari Kala Moms & Baby Spa”.
  - `CreateReservationModal.tsx:55-60`, `slotRecommendations.ts:54-60` — `CLINIC_COORDS` Kala + `DEFAULT_CANDIDATE_SLOTS` 08:30–16:30.
  - `PricelistPromoPanel.tsx:204-210` — tombol “Gunakan Logo Kala” → `/assets/kala-logo.svg`.
  - `DeliveryTiers.tsx:88` — tier baru default `fee:30000,promoDiscount:5000`.
- **Keyakinan:** **TERBUKTI**.
- **Framework:** SaaS readiness, Well-Architected Reliability, COBIT BAI06.
- **Akar masalah (5 Whys):**
  1. Mengapa dashboard selalu tenant default? → Header di-hardcode saat single-tenant.
  2. Mengapa brand/logo/bank Kala? → Fallback build-time/placeholder.
  3. Mengapa koordinat/slot hardcode? → Belum ada endpoint settings; #61 tercatat.
  4. Mengapa tidak ketahuan? → Uji UI hanya tenant default.
  5. Mengapa tidak diganti? → Butuh keputusan tenant switcher + endpoint config (Cfg-011).
- **Risiko:** Tenant baru melihat/mengirim brand, rekening, alamat, dan slot Kala; salah kirim nomor rekening; jadwal bertentangan dengan `operationalHours`.
- **FMEA:** **S=7, O=7, D=5 → RPN 245**.
- **Collateral damage:** Menghapus fallback membuat UI kosong saat API gagal; solusi empty state, bukan data Kala.
- **Rekomendasi fondasional:** (1) `api.ts` mengambil tenant aktif dari sesi (`AuthContext.user.tenantId`) dan **tidak** mengirim header default; (2) `BRAND` dari endpoint `GET /api/admin/settings` (brand tenant) + cache; (3) hapus placeholder rekening/logo/quick reply; (4) endpoint `GET /api/admin/settings/clinic-location` + `operational-hours` untuk mengisi koordinat/slot; (5) test build dua tenant.
- **Verifikasi:** Test e2e/unit: login tenant B → request header tidak `default-tenant`; UI brand B; `PaymentInfoPanel` kosong tanpa rekening; slot mengikuti `operationalHours`. Grep `Kala|8877665544|1234567890|Rungkut` di `packages/admin-dashboard/src` → hanya fixture test.

---

### Cfg-016 — Monitoring `GET /api/admin/health` melaporkan status palsu dan memakai klien WAHA global

- **Tipe:** Horizontal (observability)
- **Lokasi:** `src/routes/admin/settings.subroute.ts:2072-2124`.
- **Bukti:**
  ```ts
  const { wahaClient } = await import('../../integrations/waha/client'); // global, bukan per tenant
  ...
  haversineLocationEngine: 'ACTIVE_MULTIPLIER_1.25X',
  telegramEmergencyAlerts: 'CONFIGURED',
  ```
  Nilai `telegramEmergencyAlerts` dan `haversineLocationEngine` adalah string statis; tidak memeriksa konfigurasi tenant/ env. `wahaStatus` memakai singleton global (melanggar abstraksi gateway per tenant).
- **Keyakinan:** **TERBUKTI**.
- **Framework:** Well-Architected Operational Excellence, COBIT MEA02 (monitoring), NIST CSF Detect.
- **Akar masalah (5 Whys):**
  1. Mengapa admin melihat “CONFIGURED”? → String statis.
  2. Mengapa statis? → Placeholder awal.
  3. Mengapa tidak diganti? → Tidak ada test health yang memeriksa nilai nyata.
  4. Mengapa WAHA global? → Sisa sebelum multi-tenant gateway.
  5. Mengapa berbahaya? → Alert palsu menutupi miskonfigurasi Telegram/WAHA.
- **Risiko:** Kegagalan notifikasi/WAHA tidak terdeteksi; diagnosis salah arah.
- **FMEA:** **S=4, O=5, D=6 → RPN 120**.
- **Collateral damage:** Query status nyata dapat memperlambat health check; gunakan cache + timeout.
- **Rekomendasi fondasional:** Kembalikan status terukur: `telegramEmergencyAlerts: Boolean(token && chatId)` per tenant, `wahaStatus` via `resolveGatewayForTenant(tenantId)`/health service, dan tandai `unknown` bila tidak bisa diverifikasi. Jangan hardcode label.
- **Verifikasi:** Test: env/token kosong → `NOT_CONFIGURED`; gateway tenant B down → status B, bukan A.

---

### Cfg-017 — Dokumen & audit claim drift: `FEATURE_INVENTORY` dan Fase 10 menyatakan “data-driven/PASS” padahal kontrol belum ada

- **Tipe:** Horizontal (tata kelola & dokumentasi)
- **Lokasi:** `docs/FEATURE_INVENTORY.md:249,257`; `docs/audit/2026-11-02/fase-10/LAPORAN_FASE_10.md:25`; `tests/integration/admin-staff-authz-matrix.test.ts`; `tests/unit/admin-rbac-guard.test.ts:234-239`.
- **Bukti:**
  - `FEATURE_INVENTORY.md:257` menyatakan “penegakan izin akses endpoint data-driven via tabel `role_api_scopes`” — faktanya default-allow untuk role tanpa baris dan tidak ada UI/route pengelola scope.
  - `:249` menyatakan dashboard “tidak menyimpan fallback harga hardcoded” — benar untuk dashboard, tetapi backend masih menyimpan `DEFAULT_CLINIC_SERVICES` 42 item dan `DEFAULT_TIERS`.
  - Fase 10 PASS berbasis 72 test fungsional; tidak ada test BFLA/tenant. Matriks authz hanya menguji 401 anonim.
- **Keyakinan:** **TERBUKTI** (dokumen vs kode/test).
- **Framework:** COBIT MEA02/MEA03, ISO 19011 (bukti audit), Well-Architected Operational Excellence.
- **Akar masalah (5 Whys):**
  1. Mengapa dokumen menyatakan selesai? → Definisi “data-driven” = mekanisme tabel ada, bukan hasil otorisasi teruji.
  2. Mengapa test tidak menangkap? → Matriks hanya anonim; test role terkunci pada allowlist Settings.
  3. Mengapa audit sebelumnya PASS? → Gate regresi hanya membandingkan failure, bukan cakupan kontrol.
  4. Mengapa tidak dikoreksi? → #299 mencatat masalah gate, tetapi cakupan per modul belum diperbaiki.
  5. Mengapa berulang? → Tidak ada checklist “kontrol keamanan wajib punya test negatif”.
- **Risiko:** Pengambil keputusan mengira SaaS/RBAC siap; temuan kritis tidak masuk backlog; audit berikutnya mengulang.
- **FMEA:** **S=5, O=6, D=7 → RPN 210**.
- **Collateral damage:** Memperbarui dokumen tidak mengubah kode, tetapi dapat memicu prioritas ulang; jangan hapus klaim tanpa bukti pengganti.
- **Rekomendasi fondasional:** (1) Perbarui `FEATURE_INVENTORY` §10 dengan status faktual + rujukan Cfg; (2) tambah “Definition of Done kontrol”: setiap kontrol otorisasi/config wajib punya test positif+negatif+tenant; (3) audit berikutnya wajib menjalankan matriks role-level (bukan hanya 401); (4) catat sisa di `KNOWN_ISSUES` (bukan hanya laporan).
- **Verifikasi:** Review dokumen vs test: setiap klaim “data-driven/tenant-aware” punya test yang gagal bila kontrol dihapus (mutation test sederhana). Checklist audit di `docs/audit/README`.

---

## 6. Matriks RBAC Ringkas (ringkasan bukti)

| Endpoint konfigurasi | SUPER_ADMIN / API key / admin_session | ADMIN_CS / SPV_CS (unmanaged) | ADVERTISER (managed) | THERAPIST (managed) | Custom role (unmanaged) |
|---|---|---|---|---|---|
| `GET|PUT /api/admin/settings/payment-info` | ✅ | GET 4 allowlist; write ❌ | ❌ | ❌ | GET 4; write ❌ |
| `POST /api/admin/services` | ✅ | **✅ (bug)** | ❌ | ❌ | **✅ (bug)** |
| `POST /api/admin/delivery-tiers` | ✅ | **✅ (bug)** | ❌ | ❌ | **✅ (bug)** |
| `PUT|DELETE /api/admin/knowledge/chunks/:id` | ✅ | **✅ (bug)** | ❌ | ❌ | **✅ (bug)** |
| `POST|PUT /api/admin/few-shots` | ✅ | **✅ (bug)** | ❌ | ❌ | **✅ (bug)** |
| `PATCH /api/admin/ai-rollout-scope` | ✅ | **✅ (bug)** | ❌ | ❌ | **✅ (bug)** |
| `PATCH /api/admin/capi-config` | ✅ | **✅ (bug)** | ❌ | ❌ | **✅ (bug)** |
| `PUT /api/admin/settings/clinic-policies/:topic` | ✅ | ❌ (prefix settings) | ❌ | ❌ | ❌ |
| `PATCH /api/admin/ai-models/*` | ✅ | ❌ (denylist) | ❌ | ❌ | ❌ |
| `POST /api/admin/roles` | ✅ | ❌ (guard) | ❌ | ❌ | ❌ |
| `POST /api/admin/staff` | ✅ | ❌ (guard) | ❌ | ❌ | ❌ |
| `GET /api/admin/customers` (PII) | ✅ | ✅ | ❌ | ❌ | ✅ |

Kesimpulan matriks: **satu-satunya peran yang benar-benar terkunci adalah `advertiser` dan `therapist`** (karena punya baris `role_api_scopes`); `admin_cs`/`spv_cs`/custom role = “legacy allow” kecuali 13 prefix. Itu kebalikan dari tujuan UI `StaffManagement` yang menampilkan centang modul.

---

## 7. Rencana Perbaikan Berurutan

Urutan berdasarkan **RPN + ketergantungan + blast radius**. Setiap fase wajib ditutup gerbang regresi `npm run build` + suite relevan + tidak ada failure baru (klaim pre-existing wajib revert-and-rerun).

### Fase 0 — Pagar darurat (0–1 hari, tanpa migrasi)
1. **Cfg-003:** Hapus rekening fiktif dari `getPaymentInfo`; kembalikan `configured:false` dan blokir invoice dengan 409. Ubah test `admin-payment-info-settings` menjadi negatif.
2. **Cfg-004:** Set `telegramPairingToken/DirectLink/GroupLink = null` pada `GET /settings/daily-report`; pindahkan pairing ke endpoint super-admin.
3. **Cfg-001:** Kembalikan `501 NOT_IMPLEMENTED` untuk `PATCH /conversation-behavior` (atau implementasi persistensi) + hapus klaim 200.
4. **Cfg-013:** Tambahkan prefix konfigurasi kritikal ke `superAdminOnlyPrefixes` sebagai mitigasi sementara: `/api/admin/services`, `/api/admin/delivery-tiers`, `/api/admin/knowledge`, `/api/admin/few-shots`, `/api/admin/ai-rollout-scope`, `/api/admin/capi-config`, `/api/admin/customer-service`, `/api/admin/quick-replies`.
   - **Rollback:** hapus prefix dari array (satu baris); tidak ada migrasi.
   - **Risiko:** CS yang sah kehilangan akses baca katalog; sediakan allowlist GET terpisah.

### Fase 1 — Isolasi tenant konfigurasi (2–4 hari, perlu Confirmation Gate)
5. **Cfg-012:** Terapkan `tenantOf(request)` pada seluruh handler settings (daftar di temuan). Hapus fallback `findFirst()` di `customer-service`.
6. **Cfg-002:** `updateMany/deleteMany({id, tenant_id})` + `findFirst({id, tenant_id})` untuk knowledge; 404 jujur.
7. **Cfg-014:** `tenantOf` + tolak `is_system` + validasi `allowedPaths`.
   - **Rollback:** feature flag per domain (`TENANT_CONTEXT_ENFORCE=false` default sementara), log-only mode 1 minggu.
   - **Risiko:** Memaksa tenant context bisa memblokir admin yang selama ini mengandalkan default; siapkan tenant default eksplisit di sesi admin.

### Fase 2 — Integritas persistensi & audit (3–5 hari)
8. **Cfg-008:** `TenantSettingsService.patch()` atomik + skema Zod per domain.
9. **Cfg-010:** `await saveServicesToDb`/tier sebelum 200; validasi harga/durasi.
10. **Cfg-009:** Wajibkan `tenantId` + before/after audit; tambah audit `customer-service`; outbox/retry untuk kegagalan audit.
    - **Rollback:** migrasi tidak destruktif; skema validasi longgar dulu.
    - **Risiko:** Latency tulis meningkat; test beban.

### Fase 3 — Data-driven hardcode purge (1–2 minggu, bertahap)
11. **Cfg-005:** Hapus fallback statis SOP/few-shot; pipeline eskalasi bila policy kosong; prompt membaca `getOperationalHours`/`getClinicLocationAsync`.
12. **Cfg-006:** Katalog/tier awal dari template onboarding DB; hapus nama/harga Kala.
13. **Cfg-007:** Template Quick Reply generik + interpolasi DB.
14. **Cfg-011/Cfg-015:** Endpoint `tenant-config` + tab Settings; dashboard berhenti mengirim `default-tenant`; hapus placeholder Kala.
    - **Rollback:** seed template DB dapat dinonaktifkan; data lama tetap.
    - **Risiko:** Bot tidak menjawab saat onboarding belum lengkap → wajib eskalasi manusia + checklist onboarding.

### Fase 4 — Tata kelola berkelanjutan
15. **Cfg-016:** Health check jujur per tenant.
16. **Cfg-017:** Update `FEATURE_INVENTORY` + checklist DoD kontrol + matriks authz role-level di CI.

**Gate antar-fase:** (a) test baru merah sebelum fix, hijau sesudah; (b) `npm run build`; (c) suite settings/RBAC/knowledge/payment hijau; (d) full suite tanpa failure baru; (e) review diff oleh manusia (Human-in-the-Loop).

---

## 8. Batasan & Asumsi

1. **[ASUMSI] Produksi saat ini single-tenant efektif.** Banyak temuan tenant (Cfg-002/012/014) belum berdampak nyata jika hanya ada `default-tenant`; dampaknya menjadi kritikal saat tenant kedua aktif. Ini alasan severity tinggi tetapi belum tentu insiden hari ini.
2. **[ASUMSI] `Tenant.settings.paymentInfo` tenant produksi sudah terisi**, sehingga Cfg-003 belum tentu terkirim ke pelanggan. Jalur kode terbukti; data produksi tidak diverifikasi.
3. **[ASUMSI] `clinic_policies` tenant produksi terisi**, sehingga fallback statis Cfg-005 tidak selalu aktif. Untuk tenant baru, fallback pasti aktif.
4. **Tidak ada akses DB/log produksi**, jadi tidak dapat membuktikan ada/tidaknya perubahan config yang sudah hilang (Cfg-008) atau audit yang hilang (Cfg-009).
5. **Tidak menjalankan test/build**, jadi tidak ada klaim “hijau”; status test hanya dari dokumentasi/isi file.
6. **Cakupan UI terbatas pada pembacaan kode**; tidak ada uji klik, responsive, atau accessibility di browser.
7. **Temuan parent yang tidak diduplikasi:** S-003, S-009, S-012, Ar-003, Ar-004, Ar-005 (laporan Modul 1/11) dan #129/#128/#268/#267/#61/#182d. Rujukan ini wajib dibaca bersama laporan ini agar tidak dihitung ganda.
8. **`settings.subroute.ts` 2.716 baris**; audit membaca seluruh handler untuk pola, tetapi tidak setiap cabang validasi per field.
9. **Tidak ada uji eksploitasi runtime**; temuan otorisasi didasarkan pada alur kode dan test yang mengunci perilaku.
10. **Rekomendasi Zero Dependency** dipatuhi: semua solusi memakai `zod`/Prisma/Fastify yang sudah ada; tidak ada dependency baru.

---

## 9. Lampiran — Perintah Bukti yang Dapat Direproduksi

```powershell
# 1. Hitung hardcode tenant & handler settings
rg -c "DEFAULT_TENANT_ID" src/routes/admin src/services
rg -n "DEFAULT_TENANT_ID" src/routes/admin/settings.subroute.ts

# 2. Bukti RBAC default-allow
rg -n "rows.length === 0" -A 3 src/services/role-scope.service.ts
rg -n "superAdminOnlyPrefixes" -A 20 src/routes/admin.route.ts
rg -n "role_api_scopes" prisma/migrations

# 3. Bukti knowledge tanpa tenant
rg -n "knowledgeChunk\.(update|delete)" -B 2 -A 4 src/routes/admin/knowledge.subroute.ts

# 4. Bukti rekening fiktif
rg -n "1234567890|getPaymentInfo" -A 8 src/services/staff-reservation.service.ts

# 5. Bukti ghost conversation-behavior
rg -n "conversation-behavior" -A 30 src/routes/admin/settings.subroute.ts

# 6. Bukti hardcode SOP/jam
rg -n "Waru|08.00|17.00|BCA, Mandiri|30 km" src/v3/tools/clinic-faq.tool.ts src/v3/agent/prompt src/v3/agent/*exemplars.ts

# 7. Bukti katalog/tier default
rg -n "DEFAULT_CLINIC_SERVICES|DEFAULT_TIERS" src/services/treatment-catalog.service.ts src/services/delivery.service.ts

# 8. Bukti dashboard tenant default
rg -n "x-tenant-id|default-tenant" packages/admin-dashboard/src/services/api.ts
```

**Selesai. Tidak ada file selain laporan ini yang dibuat/diubah.**
