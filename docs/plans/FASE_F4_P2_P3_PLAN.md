# RENCANA IMPLEMENTASI FASE 4 — REMEDIASI P2/P3 & SISA TRACK A/B
**Sistem Chatbot WhatsApp Klinik — Node 20 / Fastify / Prisma / Vitest**

- **Dokumen Induk:** `docs/plans/PLAN_FINISH_ALL_2026-11-09.md`
- **Register Terpadu:** `docs/plans/REMAINING_BACKLOG_2026-11-09.md`
- **Baseline Git:** Commit `9f659cdb` (origin/master)
- **Baseline Full Suite:** `docs/audit/2026-11-10/after-f3-6.json` (6.875 test, 6.845 pass, 2 fail pre-existing #287, 0 regresi)
- **Status:** **IN REMEDIATION & HARDENING** — Batch F4.1–F4.4 di-commit (`302dc26f`, `3688a3cf`, `f6bbd83f`, `20532445`); Remediasi audit mendalam Cfg-008, SM-02, S-014, dan Batch F4.5 sedang berjalan.

---

## 1. Strategi Eksekusi & Swarm Subagents

Untuk mempercepat penyelesaian tanpa menurunkan kualitas, pengerjaan Fase 4 dibagi ke dalam **5 Batch Bertahap** dengan pembagian ranah file independen (*zero-conflict domains*).

### Arsitektur Swarm Bot (Subagents):
1. **Worker 1 (DataAccess Worker):**
   - **Fokus:** `src/repositories/` (`conversation.repository.ts`, `turn.repository.ts`, `message.repository.ts`, `customer.repository.ts`).
   - **Tugas:** Menghilangkan redundant round-trips (`D-04`), mencegah fail-open claim processing (`D-06`), index scan reduction (`D-07`), standardisasi E.164 phone query (`D-08`), typed repository interfaces (`D-12`), dan unit test repository terisolasi (`D-18`).
2. **Worker 2 (Config & Hygiene Worker):**
   - **Fokus:** `src/config/` (`persona.ts`, `landmarks.ts`, `operational-hours.ts`, `brand.ts`, `ai-models.config.ts`, `feature-flags.ts`).
   - **Tugas:** Isolasi `BOT_PERSONA_PROMPT` per tenant (menghilangkan mutable global export `CFG-03`), pembersihan dead templates (`CFG-08`), pemisahan kamus landmark ke JSON/data loader (`CFG-09`), konsolidasi helper WIB (`CFG-10`), TTL cache in-memory brand/location/promo (`CFG-14`), dan penghapusan duplikasi `dotenv.config()` (`CFG-20`).
3. **Lead Agent / Supervisor (Orchestration & Verification Gate):**
   - Menjalankan regression gate: `npm run build:all`, `npm run security:scan`, targeted vitest, dan diff baseline JSON (`scripts/audit-baseline-diff.mjs`).
   - Memastikan tidak ada file God Object baru (>1.500 baris) dan tidak ada *mid-sentence regex mutation* atau *slop*.

---

## 2. Rincian Batch F4.1: Track A Data Access & Config (29 Item)

### Sub-Batch F4.1A: Data Access Repositories (`D-04` s/d `D-18`)

| ID | File:Baris Aktual | Masalah | Rencana Solusi Fondasional | File Test Target |
|---|---|---|---|---|
| **D-04** | `src/repositories/conversation.repository.ts:105-139` | 3 round-trip query (`findUnique` → `updateMany` → `findUnique`) pada `updateState` dan `flagForReview`. | Pangkas query pertama: langsung `updateMany` dengan `where: { id, tenant_id }`, periksa `count > 0`, lalu ambil hasil akhir (hemat 33% latency). | `tests/unit/conversation-repository-efficiency.test.ts` |
| **D-05** | `src/repositories/turn.repository.ts:25-45` | `TurnRepository` memakai `(prisma as any)` dan belum memiliki interface resmi. | Tambahkan interface `ITurnRepository` dan hilangkan cast `(prisma as any)`. | `tests/unit/turn-repository.test.ts` |
| **D-06** | `src/repositories/turn.repository.ts:128-137` | `claimForProcessing` mengembalikan `true` saat `existing.status === 'PROCESSING'` (membuka celah pemrosesan ganda oleh worker paralel). | Bila `existing.status === 'PROCESSING'`, kembalikan `false` agar worker lain tidak merebut turn yang sedang diproses. | `tests/unit/turn-repository.test.ts` |
| **D-07** | `src/repositories/message.repository.ts:70-80` | `existsByWaId` memakai `endsWith: '_${shortId}'` yang memicu sequential scan. | Gunakan exact match pada indexed `wa_message_id` atau query id terstruktur tanpa leading wildcard. | `tests/unit/message-repository.test.ts` |
| **D-08** | `src/repositories/customer.repository.ts:48, 80` | `findByPhone` mencocokkan string phone mentah tanpa standardisasi E.164. | Gunakan helper `normalizePhoneNumber` sebelum query Prisma agar format `0812...` dan `62812...` konsisten. | `tests/unit/customer-phone-normalization.test.ts` |
| **D-09** | `src/repositories/customer.repository.ts:59-72` | Field `is_internal_staff` ada di interface tetapi tidak ditulis ke query `prisma.customer.create`. | Sertakan `is_internal_staff: data.is_internal_staff ?? false` pada Prisma payload. | `tests/unit/customer-repository.test.ts` |
| **D-10** | `src/repositories/customer.repository.ts:52-57` | `findById` memanggil `findUnique` tanpa tenant_id di WHERE, baru filter di memori. | Masukkan `tenant_id` langsung ke query `findFirst({ where: { id, tenant_id } })`. | `tests/unit/customer-repository-tenant.test.ts` |
| **D-11** | `src/repositories/turn.repository.ts:100-105` | `cleanupOlderThan` memiliki blok `catch {}` kosong tanpa log peringatan. | Tambahkan `console.warn('[TURN] cleanup error:', err?.message)` pada blok catch. | `tests/unit/turn-repository.test.ts` |
| **D-12** | `src/repositories/customer.repository.ts:34-42` | Method interface mengembalikan `Promise<any>`. | Berikan return type tegas: `Promise<Customer | null>` dan `CustomerUpdateInput`. | `src/repositories/customer.repository.ts` |
| **D-13** | `src/services/conversation.service.ts:631-641` | Variabel `dataToUpdate` diinisialisasi 8 properti tapi tidak dipakai (dead code). | Hapus dead code `dataToUpdate` yang tidak terpakai. | `tests/unit/conversation-service.test.ts` |
| **D-14** | `src/repositories/turn.repository.ts:17, 28, 78, 113` | Parameter `tenantId` masih diberi default `DEFAULT_TENANT_ID`. | Hapus default parameter; wajibkan `tenantId` eksplisit dari caller. | `src/repositories/turn.repository.ts` |
| **D-15** | `src/repositories/message.repository.ts:109-115` | `InMemoryMessageRepository.existsByWaId` tidak mencocokkan suffix seperti versi DB. | Selaraskan perilaku in-memory store dengan interface riil. | `tests/unit/message-repository.test.ts` |
| **D-16** | `src/repositories/turn.repository.ts:42, 133` | `persistInbound` memakai `update: {}` sehingga turn `FAILED` tidak bisa di-retry. | Perbolehkan retry turn dengan memperbarui status bila sebelumnya `FAILED`. | `tests/unit/turn-repository.test.ts` |
| **D-17** | `src/repositories/conversation.repository.ts:12-13` | Header menyebut `escalate` dan `updateLastCustomerMessageAt` tetapi interface belum menyediakannya. | Selaraskan dokumentasi antarmuka repository. | `src/repositories/conversation.repository.ts` |
| **D-18** | `tests/unit/*-repository.test.ts` | Unit test repository belum menguji paralel race condition dan isolasi tenant. | Tambahkan unit test konkurensi pada repository in-memory dan mock Prisma. | `tests/unit/repository-concurrency.test.ts` |

---

### Sub-Batch F4.1B: Config & Persona Hygiene (`CFG-03`, `CFG-08` s/d `CFG-20`)

| ID | File:Baris Aktual | Masalah | Rencana Solusi Fondasional | File Test Target |
|---|---|---|---|---|
| **CFG-03** | `src/config/persona.ts:109, 166-190` | `BOT_PERSONA_PROMPT` diekspor sebagai variabel global mutable (`export let`), ditimpa antar-tenant. | Buat registry Map per-tenant `personaByTenant: Map<string, string>` dan fungsi accessor `getPersonaForTenant(tenantId)`. | `tests/unit/persona-multi-tenant.test.ts` |
| **CFG-08** | `src/config/persona.ts:238-693` | 33 template usang di `TEMPLATES` tidak memiliki pemanggil runtime. | Bersihkan template usang yang sudah diambil alih oleh `followup-templates.ts`. | `tests/unit/persona-templates.test.ts` |
| **CFG-09** | `src/config/landmarks.ts:17-722` | 800 baris data landmark hardcoded di file TypeScript. | Ekstrak data ke file JSON konfigurasi `landmarks.data.json` dengan loader dinamis. | `tests/unit/landmarks-loader.test.ts` |
| **CFG-10** | `src/utils/time-wib.ts` vs `src/utils/wib-time.ts` | Terdapat dua modul helper WIB terpisah. | Konsolidasikan helper waktu WIB ke dalam `src/utils/wib-time.ts` dan buat re-export di `time-wib.ts` agar kompatibel ke belakang. | `tests/unit/wib-time.test.ts` |
| **CFG-11** | `src/config/operational-hours.ts:62` | Parsing jam operasional dari summary teks memakai regex kaku. | Tambahkan parsing terstruktur dengan toleransi format (WIB, titik dua, tanda hubung). | `tests/unit/operational-hours.test.ts` |
| **CFG-12** | `src/config/ai-models.config.ts:400-422` | UI mencantumkan 9 provider AI, runtime hanya memproses KENARI dan SUMOPOD. | Tandai status provider non-aktif di metadata konfigurasi agar jelas bagi admin. | `tests/unit/ai-models-config.test.ts` |
| **CFG-13** | `src/config/ai-models.config.ts:39-48` | Komentar menyebut `SUMOPOD_CATALOG` 5 model, aktual Set 7 entri. | Selaraskan dokumentasi komentar dengan Set model aktual. | `src/config/ai-models.config.ts` |
| **CFG-14** | `src/config/brand.ts:44-48`, `pricelist-promo.ts:96` | Cache in-memory brand, lokasi klinik, dan promo tidak memiliki batas waktu (TTL). | Tambahkan TTL 5 menit pada Map cache in-memory untuk brand dan klinik. | `tests/unit/brand-cache-ttl.test.ts` |
| **CFG-15** | `src/config/ai-eligibility-config.ts:26-35` | Fallback fail-closed berubah menjadi fail-open saat `AI_CUSTOMER_SCOPE=ALL`. | Pastikan fail-closed tetap berlaku untuk evaluasi keamanan. | `tests/unit/ai-eligibility-config.test.ts` |
| **CFG-16** | `src/config/followup-templates.ts:73-340` | Render pesan follow-up memakai `getBrandIdentity()` sinkron. | Gunakan asynchronous tenant accessor yang telah distandardisasi pada F2. | `tests/unit/followup-templates-tenant.test.ts` |
| **CFG-17** | `src/config/ai-models.config.ts:507-521` | `saveQueue` hanya menserialkan penyimpanan konfigurasi per proses Node tunggal. | Tambahkan proteksi optimistic locking atau advisory lock sederhana. | `src/config/ai-models.config.ts` |
| **CFG-18** | `Dockerfile:50-51`, `src/services/cost-calculator.ts` | `kenari-pricing.snapshot.json` tidak disalin ke image Docker. | Tambahkan baris copy asset ke Dockerfile. | `Dockerfile` |
| **CFG-19** | `src/routes/admin/settings/settings-ai.subroute.ts` | Pembacaan model config tanpa menyertakan `tenantId`. | Berikan `tenantId` terverifikasi pada call site `getModelConfig`. | `tests/integration/admin-settings.test.ts` |
| **CFG-20** | `src/config/feature-flags.ts`, `src/config/clinic.ts` | Pemanggilan `dotenv.config()` berulang di level modul leaf. | Hapus pemanggilan `dotenv.config()` redundan di modul leaf (cukup di `app.ts` & `worker.ts`). | `src/config/feature-flags.ts` |

---

## 3. Peta Batch F4 Berikutnya

- **Batch F4.2:** Track A Utilities, Domain Logic, Ingress (`UTL-07`..`UTL-25`, `DOM-01`..`DOM-15`, `ING-09`..`ING-18` — 42 item).
- **Batch F4.3:** S4 Residuals & State Machine (`SM-02`, `SM-04` — 2 item: form parser data-driven & atomic session reset).
- **Batch F4.4:** Track B Residuals P2/P3 (Cron, Settings, Marketing, WhatsApp — 36 item).
- **Batch F4.5:** Adversarial & Multi-Phrasing Hardening Tests (Pengujian ketahanan parafrase bahasa manusia).

---

## 4. Gerbang Regresi (Regression Gate Wajib Tiap Batch)

Setiap batch ditutup dengan rangkaian validasi:
1. `npx tsc --noEmit` (TypeScript typecheck — 0 error).
2. `npm run build:all` (Backend + Vite Admin Dashboard build — lulus).
3. `npm run security:scan` (Scanner rahasia & API key — 0 leak).
4. `npx vitest run <targeted-tests>` (Test baru dan file yang diubah harus 100% PASS).
5. `npx vitest run --reporter=json --outputFile=docs/audit/2026-11-10/after-f4-x.json` + `node scripts/audit-baseline-diff.mjs` (0 regresi baru vs `after-f3-6.json`).

---

## 5. Pertanyaan & Konfirmasi Eksekusi

Sesuai aturan kerja (*Strict Human-in-the-Loop Confirmation Gate*), AI Agent belum mengubah file kode sumber. Mohon konfirmasi untuk memulai eksekusi:

Ketik salah satu instruksi berikut:
- **`Setuju F4.1`** $\rightarrow$ Mulai eksekusi Batch F4.1 (Data Access & Config) dengan pembagian tugas swarm subagents.
- **`Setuju F4`** $\rightarrow$ Eksekusi seluruh Fase 4 batch demi batch secara berurutan.
