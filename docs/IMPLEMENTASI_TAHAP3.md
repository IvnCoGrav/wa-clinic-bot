# Implementation Plan — Tahap 3.1 (LLM-as-Judge: AI Quality Evaluation)

**Versi:** 1.0
**Tanggal:** 7 Agustus 2026
**Status:** SELESAI (build hijau, 1001 test lulus)
**Induk:** `docs/ROADMAP_IMPLEMENTASI_FITUR_BARU.md` (Blueprint Keseluruhan Fase 1-3)
**Batas Lingkup:** HANYA **Sub-item 3.1** (LLM-as-Judge quality evaluation). Tahap 3.2+ ada di dokumen induk.

> [!IMPORTANT]
> Semua keputusan desain di bawah sudah **terkunci** berdasarkan konfirmasi user: cron berjalan tiap **6 jam** (bukan 02:00) untuk hemat resource; evaluasi disimpan ke tabel **terpisah** `AiEvaluation` (bukan `AiRouterEvaluation`) supaya metrik akurasi router tidak tercemar; menggunakan model `CHAT_REPLY` (MiniMax) + env `LLM_API_KEY`. Eksekusi hanya di **localhost** (Server Update Gate: deploy ke server live hanya atas perintah eksplisit & konfirmasi 2x).

---

## Konteks & Tujuan

Mengevaluasi **kualitas balasan AI** (bukan sekadar akurasi routing) secara berkala & otomatis, memakai LLM lain sebagai "jurinya" (LLM-as-a-Judge). Skor & feedback disimpan untuk pemantauan / tuning persona di masa depan — dengan biaya minimal (sampling acak ≤10%) dan tanpa mengganggu produksi (fail-safe silent saat DB/LLM down).

Desain memakai Tabel `AiEvaluation` **terpisah** dari `AiRouterEvaluation`. Alasan: `src/scripts/check-router-accuracy.ts` menghitung SEMUA record `ai_router_evaluations` (termasuk `allTotal`); mencampur evaluasi kualitas ke dalam tabel itu akan mencemari metrik akurasi routing. Tabel terpisah menjaga kedua metrik tetap bersih.

---

## Sub-Item 3.1 — LLM-as-Judge AI Quality Evaluation

### Keputusan Terkunci
| Aspek | Keputusan |
|---|---|
| Sumber sampel | Pesan `OUTBOUND` hari ini dengan `payload_raw.aiReasoning` (balasan LLM) |
| Sampling | Acak ≤10% (min 1 bila ada data), cap `AI_MAX_SAMPLES` (default 50) |
| Judge model | Config `CHAT_REPLY` (`MiniMax-M2.7-highspeed`, tenant-aware) |
| Penilaian | Skor 1-5 + feedback singkat (Indonesia), format JSON via `response_format` |
| Penyimpanan | Tabel **`AiEvaluation`** (baru), idempotent via `message_id @unique` (upsert) |
| Trigger | Cron `setInterval` 6 jam, gated `ENABLE_AI_EVAL_CRON === 'true'` |
| Fail-safe | DB/LLM down → silent, tidak pernah throw / ganggu produksi |

### 3.1.A Schema & Migrasi

Model `AiEvaluation` (`prisma/schema.prisma`):

```prisma
model AiEvaluation {
  id             String    @id @default(cuid())
  tenant_id      String
  message_id     String    @unique
  customer_phone String?
  conversation_id String?
  message_text   String
  ai_reasoning   String?
  score          Int
  feedback       String?
  created_at     DateTime  @default(now())

  @@index([tenant_id, created_at])
  @@map("ai_evaluations")
}
```

```bash
# Migrasi manual (shadow DB rusak oleh enum FollowUpStatus — lihat AGENTS.md)
npx prisma migrate dev --name add_ai_evaluations   # lalu prisma migrate deploy / db push
npx prisma generate
```

> Idempotensi via `message_id @unique`: cron yang berjalan berulang tidak membuat duplikat (upsert update `score`/`feedback`).

### 3.1.B Service — `src/services/llm-evaluator.service.ts` (file baru)

Service `LlmEvaluatorService` + singleton `llmEvaluatorService`. Tiga method konsisten:

`sampleMessages(tenantId, samplingPercent = 10)`
- Ambil `prisma.message.findMany` OUTBOUND hari ini dengan `payload_raw: { path: ['aiReasoning'], not: Prisma.JsonNull }`, `orderBy desc`, `take 2000`.
- `include: { conversation: { include: { customer: { select: { phone: true } } } } }` untuk phone, `prisma` filter pakai `Prisma.JsonNull`.
- Acak (shuffle) → ambil ≥10% (min 1), cap `AI_MAX_SAMPLES` (50).
- Kembalikan `EvaluatedSample[]` tentatif (`messageId, tenantId, customerPhone, conversationId, messageText, aiReasoning`).
- DB error → `console.warn` + return `[]` (silent).

`evaluateOne(sample)` (private)
- Skip bila `LLM_API_KEY` kosong / diawali `mock`.
- `AiModelConfigService.getModelConfig('CHAT_REPLY')` → `modelName`/`maxTokens`.
- Prompt judge (persona + arahan penilaian 1-5) + `response_format: { type: 'json_object' }`, `temperature 0.2`, `timeout 8000`.
- Parse JSON, validasi skor 1-5; gagal → `null`.
- LLM error → `console.warn` + `null`.

`sampleAndEvaluate(tenantId, samplingPercent = 10)`
- Loop sampel → `evaluateOne` → `prisma.aiEvaluation.upsert` (unique `message_id`).
- Per-detail best-effort try/catch; return jumlah berhasil dievaluasi.

### 3.1.C Cron — `src/services/cron.service.ts`

```ts
public async runQualityEvaluation(): Promise<void> {
  try {
    const { llmEvaluatorService } = await import('./llm-evaluator.service');
    const { getAllTenantIds } = await import('./media.service');
    const tenants = await getAllTenantIds();
    const samplingPercent = parseInt(process.env.AI_EVAL_SAMPLING_PERCENT || '10', 10);
    let evaluated = 0;
    for (const tenantId of tenants) {
      evaluated += await llmEvaluatorService.sampleAndEvaluate(tenantId, samplingPercent);
    }
    if (evaluated > 0) console.log(`[Cron Service] AI quality evaluation selesai (${evaluated} pesan dievaluasi).`);
  } catch (err) {
    console.error('[Cron Service] Error running AI quality evaluation:', (err as Error).message);
  }
}
```

### 3.1.D Wiring — `src/app.ts`

```ts
// Start LLM-as-Judge AI quality evaluation cron (interval 6 jam default)
if (process.env.ENABLE_AI_EVAL_CRON === 'true') {
  const intervalHours = parseInt(process.env.AI_EVAL_INTERVAL_HOURS || '6', 10);
  import('./services/cron.service').then(({ CronService }) => {
    const cron = new CronService();
    setInterval(() => cron.runQualityEvaluation(), intervalHours * 60 * 60 * 1000);
    console.log(`🧪 AI quality evaluation cron started (every ${intervalHours}h)`);
  }).catch(e => console.error('[AI EVAL START ERROR]', e));
}
```

> Cron default **matu** (`ENABLE_AI_EVAL_CRON` tidak diset) — fail-close, tidak menimbulkan biaya API tak terduga di produksi.

### 3.1.E Env baru
| Env | Default | Fungsi |
|---|---|---|
| `ENABLE_AI_EVAL_CRON` | (tidak) | Aktifkan cron evaluasi |
| `AI_EVAL_INTERVAL_HOURS` | `6` | Interval cron |
| `AI_EVAL_SAMPLING_PERCENT` | `10` | Persentase sampel per tenant |
| `AI_MAX_SAMPLES` | `50` | Cap sampel per siklus |
| `AI_EVAL_TIMEOUT_MS` | `30000` | Timeout tiap panggilan judge LLM (jangan terlalu rendah — MiniMax bisa >8s) |

### 3.1.F Test — `tests/unit/llm-evaluator.test.ts` (5 test, offline, mock prisma)

- `sampleMessages` kosong saat tidak ada pesan OUTBOUND hari ini.
- `sampleAndEvaluate` mengambil ≤10% sampel, memanggil LLM, upsert `score=4` — 1 sampel, 1 LLM call, 1 upsert.
- `LLM_API_KEY='mock'` → 0 eval, **tanpa** panggilan axios.
- DB offline (`findMany` reject) → tidak throw, count 0.
- LLM down (`axios.post` reject) → tidak throw, `upsert` tidak dipanggil.

---

## Verifikasi

- `npm run build` → **hijau** (tsc 0 error, import `Prisma` benar dari `@prisma/client`).
- `npx vitest run tests/unit/llm-evaluator.test.ts` → 5/5 lulus.
- `npm test` → 103 files / **1001 test** lulus (bertambah 5 dari evaluator).

## Catatan Tahap 2 (Backlog)
- **pgvector (2.1)** → dijadwalkan ke **Fase 8** (ROADMAP 8.3, 2027): FTS existing masih reliable untuk volume FAQ klinik; ganti image `postgres/pg16` + provider embedding terlalu besar & bentrok Server Gate.
- **Multi-intent (2.2)** → **dianggap selesai**: `NluClassifierService` sudah return `intents: string[]`.