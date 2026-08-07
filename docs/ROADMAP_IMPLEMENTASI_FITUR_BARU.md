# 🗺️ Implementation Plan: WA Clinic Bot Roadmap (Detailed How-To)

**Versi:** 1.1
**Tanggal Diperbarui:** 7 Agustus 2026
**Status:** Tahap 1 ✅ SELESAI · Tahap 2 ⏸️ Terjadwal (2.1→Fase 8, 2.2 selesai) · Tahap 3.1 ✅ SELESAI
**Konteks:** Dokumen ini merupakan *Staged Based Implementation Plan* dengan level detail teknis ("How-To") untuk dieksekusi oleh tim developer/agen. Lihat juga ringkasan status proyek level-tinggi di `docs/ROADMAP.md`.

## Ringkasan Status Eksekusi
| Tahap | Status | Detail |
|---|---|---|
| 1.1 Milestone follow-ups | ✅ Selesai | `docs/IMPLEMENTASI_TAHAP1.md` |
| 1.2 Customer memory (D2) | ✅ Selesai | `docs/IMPLEMENTASI_TAHAP1.md` |
| 2.1 pgvector | ⏸️ Fase 8 (2027) | RAG ke 8.3; lihat `docs/IMPLEMENTASI_TAHAP3.md` |
| 2.2 Multi-intent | ✅ Selesai | `NluClassifierService` return `intents: string[]` |
| 3.1 LLM-as-Judge | ✅ Selesai | `docs/IMPLEMENTASI_TAHAP3.md` |

## User Review Required
> [!IMPORTANT]
> Plan ini siap dieksekusi tahap demi tahap. Apabila Anda menyetujui detail implementasi ini, kita dapat langsung memproses eksekusi kode untuk **Tahap 1**.

---

## Tahap 1: High Impact & Retention (Quick Wins)

### 1.1 Developmental Milestone Follow-Ups
Menggunakan sistem follow up yang sudah ada (1 bulan, 2 bulan, 3 bulan pasca treatment) namun di-hijack untuk mengirim *template* berdasarkan usia anak.

#### [MODIFY] `src/services/follow-up.service.ts`
**Langkah-langkah Eksekusi:**
1. Cari method *cron* utama yang memproses pengiriman *Follow Up* (biasanya yang mengambil row dengan status `PENDING` atau yang sudah `QUEUED`).
2. Tambahkan `include: { customer: { include: { children: true } } }` pada query Prisma.
3. Buat logika kalkulasi usia bayi (*Milestone Logic*):
   ```typescript
   let templateOverride = null;
   const child = followUp.customer.children[0];
   if (child && child.birth_date) {
     const ageInMonths = Math.floor((Date.now() - child.birth_date.getTime()) / (1000 * 60 * 60 * 24 * 30));
     // Deteksi umur 3, 6, 9, 12 bulan
     if (ageInMonths === 3) templateOverride = 'milestone_3m';
     else if (ageInMonths === 6) templateOverride = 'milestone_6m';
     // ... dst
   }
   ```
4. Jika `templateOverride` terisi, kirimkan nilai tersebut ke `wabaTemplateService` alih-alih menggunakan tipe standar (`NEXT_TREATMENT`).

#### [MODIFY] `src/services/waba-template.service.ts`
**Langkah-langkah Eksekusi:**
1. Tambahkan pendaftaran mapping nama *template* Meta yang sudah di-*approve* untuk edukasi, misalnya:
   ```typescript
   const MILESTONE_TEMPLATES = {
     'milestone_3m': 'edukasi_bayi_3_bulan_v1',
     'milestone_6m': 'edukasi_bayi_6_bulan_v1'
   };
   ```

### 1.2 Zero-Cost Long-Term Customer Memory (Inline Extraction)
Menyimpan memori jangka panjang (nama anak, kulit sensitif) tanpa menghabiskan token LLM ekstra.

#### [MODIFY] `prisma/schema.prisma`
**Langkah-langkah Eksekusi:**
1. Buka file schema, cari model `Customer`.
2. Tambahkan baris berikut di bawah field lainnya:
   ```prisma
   preferences Json?
   ```
3. **[NEW]** Jalankan command shell: `npx prisma migrate dev --name add_customer_preferences`

#### [MODIFY] `src/integrations/llm/generator.ts`
**Langkah-langkah Eksekusi:**
1. Update interface return LLM:
   ```typescript
   export interface FAQResponseResult {
     answer: string;
     reasoning: string | null;
     extracted_preferences?: Record<string, any>; // <-- TAMBAHAN BARU
   }
   ```
2. Tambahkan instruksi spesifik ke dalam `systemPrompt` atau `FORM`:
   ```text
   Jika pelanggan menyebutkan fakta permanen baru tentang profil mereka (misal: nama anak, usia anak, memiliki kulit sensitif, keluhan spesifik), outputkan fakta tersebut dalam field JSON "extracted_preferences" dalam format key-value singkat. Jika tidak ada fakta baru, kosongkan field ini.
   ```

#### [MODIFY] `src/state-machine/handlers/interest.ts`
**Langkah-langkah Eksekusi:**
1. Di dalam fungsi `handleInterestState`, tepat setelah `const faqResult = await llmResponseGenerator.generateFaqResponseWithDetails(...)` berhasil dipanggil.
2. Sisipkan logika UPSERT database:
   ```typescript
   if (faqResult.extracted_preferences && Object.keys(faqResult.extracted_preferences).length > 0) {
     const currentCust = await prisma.customer.findUnique({ where: { id: customer.id }});
     const currentPrefs = (currentCust?.preferences as Record<string, any>) || {};
     const mergedPrefs = { ...currentPrefs, ...faqResult.extracted_preferences };
     
     await prisma.customer.update({
       where: { id: customer.id },
       data: { preferences: mergedPrefs }
     });
   }
   ```

---

## Tahap 2: Core Accuracy & Routing Upgrades

### 2.1 Semantic Search via `pgvector`
Mengganti string matching yang kaku dengan pencarian makna dokumen.

#### [MODIFY] `prisma/schema.prisma`
**Langkah-langkah Eksekusi:**
1. Di bagian paling atas file, tambahkan dukungan ekstensi:
   ```prisma
   generator client {
     provider = "prisma-client-js"
     previewFeatures = ["postgresqlExtensions"]
   }
   ```
2. Di dalam model `KnowledgeChunk`, tambahkan field embedding:
   ```prisma
   embedding Unsupported("vector(1536)")?
   ```
3. **[NEW]** Buat script migrasi kosong: `npx prisma migrate dev --name add_pgvector --create-only`
4. Buka file SQL migrasi yang baru dibuat, isi dengan:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding" vector(1536);
   ```
5. Terapkan migrasi: `npx prisma migrate deploy`

#### [MODIFY] `src/services/knowledge.service.ts`
**Langkah-langkah Eksekusi:**
1. Tambahkan fungsi internal untuk menembak API OpenAI `text-embedding-3-small`.
2. Ubah fungsi `.search(...)` yang awalnya menggunakan `.findMany({ where: { content: { search: ... } } })` menjadi raw query:
   ```typescript
   const vector = await getEmbedding(query);
   const results = await prisma.$queryRaw`
     SELECT id, title, content 
     FROM "knowledge_chunks" 
     ORDER BY "embedding" <-> ${vector}::vector 
     LIMIT 3
   `;
   ```

### 2.2 Multi-Intent LLM Classifier
Mendeteksi pelanggan yang menanyakan >1 hal sekaligus.

#### [MODIFY] `src/integrations/llm/intent.ts`
**Langkah-langkah Eksekusi:**
1. Ubah `response_format` JSON prompt untuk memaksa LLM mengembalikan tipe array.
   ```text
   Kamu harus mengembalikan JSON array of strings, contoh: {"intents": ["ASK_PRICE", "ASK_LOCATION"]}
   ```

#### [MODIFY] `src/services/nlu-classifier.service.ts`
**Langkah-langkah Eksekusi:**
1. Ubah return type method `detectIntent` menjadi `Promise<{ intents: string[] }>`.

#### [MODIFY] `src/state-machine/machine.ts`
**Langkah-langkah Eksekusi:**
1. Tangkap array intent dari `nluClassifier.detectIntent`.
2. Lakukan *routing* pada `intent[0]` terlebih dahulu.
3. Simpan `intent[1]` (jika ada) ke dalam tabel `Conversation.previous_state` atau memory sementara agar langsung direspons setelah respons pertama selesai.

---

## Tahap 3: Continuous Improvement

### 3.1 Automated Quality Evaluation (LLM-as-Judge)

> ✅ **SELESAI (7 Agustus 2026)** — lihat `docs/IMPLEMENTASI_TAHAP3.md`.
> Keputusan eksekusi (dikonfirmasi user): tabel **`AiEvaluation` terpisah** (bukan `AiRouterEvaluation`) agar metrik akurasi router di `src/scripts/check-router-accuracy.ts` tak tercemar; trigger **cron `setInterval` 6 jam** gated `ENABLE_AI_EVAL_CRON` (ganti BullMQ 02:00 — lebih hemat); model `CHAT_REPLY` (MiniMax) + env `LLM_API_KEY`; sampel acak ≤10%, cap `AI_MAX_SAMPLES` (50).

#### [DONE] `src/services/llm-evaluator.service.ts`
**Langkah-langkah Eksekusi:**
1. Buat kelas service baru dengan fungsi `sampleMessages()` → `evaluateOne()` → `sampleAndEvaluate()`.
2. Fungsi melakukan *query*: ambil 10% row secara random dari tabel `Message` di mana `direction = OUTBOUND`, `created_at` hari ini, dan `payload_raw.aiReasoning` ada (filter `Prisma.JsonNull`).
3. Rangkai prompt evaluasi: masukkan *User Message* (dari history), *AI Reasoning* (dari payload_raw DB), dan *AI Answer*.
4. Kirim ke LLM untuk me-return JSON dengan skema: `{ score: number (1-5), feedback: string }`.
5. Simpan hasilnya dengan membuat *record* baru di tabel `AiEvaluation` (unique per `message_id`, idempotent upsert).

#### [REVISED] `src/services/cron.service.ts` + `src/app.ts` (bukan queue.service)
**Langkah-langkah Eksekusi:**
1. Tambahkan `runQualityEvaluation()` di `CronService`: loop semua tenant via `getAllTenantIds`, best-effort silent.
2. Wiring `setInterval` 6 jam (`AI_EVAL_INTERVAL_HOURS`) di `src/app.ts`, gated `ENABLE_AI_EVAL_CRON === 'true'`. **BullMQ `ai_eval_queue` batal** — diganti cron ringan (hemat resource, fail-close).

---

*Dokumen ini adalah blueprint eksekusi implementasi fitur baru. Eksekusi dilakukan bertahap (mulai Tahap 1) setelah mendapat persetujuan user, mengikuti aturan wajib di `AGENTS.md` (SaaS-Readiness Mandate, Offline-First Test, Server Update Gate).*
