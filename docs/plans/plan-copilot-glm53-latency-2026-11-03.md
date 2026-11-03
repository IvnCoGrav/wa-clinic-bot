# Plan: AI Copilot — GLM‑5.3 Flash, Budget 5 Menit, Progress Visual, Tool Dinamis

**Tanggal:** 2026‑11‑03
**Repo target:** `wa-clinic-bot` (dev agent: `/opt/data/workspace/wa-clinic-bot`, host produksi: `/opt/wa-clinic-bot`)
**Prioritas:** P1 (produksi, single‑tenant `default-tenant`)
**Sifat:** tanpa migrasi DB, tanpa menyentuh alur customer bot

---

## 0. Konteks untuk sesi eksekusi

Dokumen ini adalah instruksi kerja lengkap. Baca dulu **§1 Keputusan**, lalu **§2 Temuan teknis** (ada satu jebakan yang membuat budget 5 menit tidak berfungsi kalau tidak diperbaiki), baru kerjakan **§3 Work Breakdown**.

Tujuan bisnis: admin bisa bertanya **apa saja secara dinamis** (jadwal, siapa belum dibalas, omzet, follow‑up, dll.) dalam satu percakapan, dengan model **glm‑5.3‑flash (SumoPod)**, batas waktu **5 menit**, dan **indikator visual yang jelas** bahwa AI sedang bekerja.

---

## 1. Keputusan yang sudah dikunci

| # | Keputusan | Nilai |
|---|---|---|
| D1 | Engine | tetap `COPILOT_ENGINE=internal` (bukan Hermes) |
| D2 | Model Copilot | `glm-5.3-flash` via SumoPod, **khusus Copilot** |
| D3 | Budget satu turn | `300000` ms (5 menit) |
| D4 | Timeout satu panggilan LLM | `90000` ms |
| D5 | Iterasi tool | maks `5` |
| D6 | Baris data | maks `60` |
| D7 | Progress | event nyata + heartbeat tiap `15s` + tombol Batal |
| D8 | Tool baru | `query_chat_stats`, `query_revenue`, `query_followups` |
| D9 | Model customer bot | **TIDAK DIUBAH** (tetap `deepseek-v4-flash-0731:netra`) |
| D10 | `GLOBAL_BOT_ENABLED` | **TIDAK DISENTUH** (tetap `false` saat ini) |

**Non‑goals:** mengubah perilaku auto‑reply WhatsApp, menambah text‑to‑SQL bebas, mengubah skema DB, mengaktifkan Hermes sebagai otak.

---

## 2. Temuan teknis yang mengikat implementasi

### 2.1 JEBAKAN UTAMA — timeout per attempt dipaksa 25 detik

`src/integrations/llm/model-fallback.ts:139`

```ts
const attemptTimeout = Math.min(call.timeoutMs || 25000, 25000);
```

Selama baris ini ada, **budget 300 detik tidak akan pernah terpakai**: setiap panggilan LLM mati di 25 detik. Ini akar masalah kenapa turn berat sering jatuh ke jawaban degradasi. **Wajib diperbaiki lebih dulu (F1), sebelum mengubah budget.**

### 2.2 Model Copilot saat ini bukan glm

`copilot.service.ts:513` memakai `getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY' })`.
DB `tenant_ai_config` untuk `CHAT_REPLY` = `deepseek-v4-flash-0731:netra` dan **menimpa** default kode (`glm-5.3-flash`). Karena itu D9: jangan ubah baris DB, tapi tambahkan override khusus Copilot.

### 2.3 GLM butuh penanganan thinking

`model-fallback.ts:152‑158` sudah menyuntik `reasoning_effort` (default `low`) hanya untuk model `glm*` + baseUrl SumoPod. **Pertahankan.** Ini yang menjaga GLM tetap cepat.

### 2.4 Tangga status UI sudah jenuh di 50 detik

`packages/admin-dashboard/src/utils/copilotStatus.ts:32‑38`

```
6s → 15s → 30s → 50s → "Hampir selesai…" (selamanya)
```

Dengan budget 5 menit, admin akan melihat "Hampir selesai" selama 4,5 menit. **Harus diganti** dengan tahap berbasis event server, bukan hanya waktu.

### 2.5 Caddy belum punya rule khusus stream Copilot

`/opt/wa-clinic-bot/Caddyfile` hanya punya matcher SSE untuk `/api/admin/live-chat/events`. Stream Copilot lewat `handle` umum. Perlu matcher terpisah agar flush instan dan tidak ada retry POST yang menduplikasi biaya.

### 2.6 `llm_audit_logs.task_type` bertipe `text`

Sudah ada nilai `AI_COPILOT_SUGGESTION` / `AI_COPILOT_DRAFT`. Jadi pencatatan biaya Copilot **tidak butuh migrasi**; cukup pakai nilai baru `AI_COPILOT_CHAT`.

### 2.7 Rate limit 30/menit berbahaya untuk turn 5 menit

30 request × 5 menit = 150 panggilan LLM paralel. Wajib ada pembatas konkurensi per tenant (F2).

---

## 3. Work Breakdown

> Urutan wajib: **F1 → F2 → F3 → F4**. F3 bisa paralel dengan F4 oleh orang berbeda.

---

### F1 — Plumbing model & timeout (backend, fondasi)

**File:** `src/integrations/llm/model-fallback.ts`, `src/services/copilot/copilot.service.ts`, `src/utils/env-numeric.ts` (reuse)

**Langkah:**

1. Tambah field opsional di `ChatCompletionsWithFallbackCall`:
   ```ts
   /** Batas keras timeout HTTP per attempt. Default 25000 (perilaku lama). */
   attemptTimeoutCapMs?: number;
   ```
2. Ganti baris 139 menjadi:
   ```ts
   const defaultCap = parsePositiveInt(process.env.LLM_ATTEMPT_TIMEOUT_MS, 25000);
   const cap = call.attemptTimeoutCapMs ?? defaultCap;
   const attemptTimeout = Math.min(call.timeoutMs || cap, cap);
   ```
   **Default tetap 25 detik** → semua pemanggil lain tidak berubah perilakunya.
   Catatan: `model-fallback.ts` belum mengimpor `parsePositiveInt`; tambahkan
   `import { parsePositiveInt } from '../../utils/env-numeric';` di bagian atas file.
3. Di `copilot.service.ts`, tambah resolver konfigurasi Copilot (murni, mudah diuji):
   ```ts
   export function resolveCopilotConfig() {
     return {
       model: (process.env.COPILOT_MODEL || 'glm-5.3-flash').trim(),
       totalBudgetMs: parsePositiveInt(process.env.COPILOT_TOTAL_BUDGET_MS, 300_000),
       callTimeoutMs: parsePositiveInt(process.env.COPILOT_CALL_TIMEOUT_MS, 90_000),
       maxIterations: parsePositiveInt(process.env.COPILOT_MAX_ITERATIONS, 5),
       maxTotalRows: parsePositiveInt(process.env.COPILOT_MAX_TOTAL_ROWS, 60),
       heartbeatMs: parsePositiveInt(process.env.COPILOT_HEARTBEAT_MS, 15_000),
     };
   }
   ```
4. Ganti `getLlmEndpointConfig` (baris 513) agar memakai override model:
   ```ts
   const cop = resolveCopilotConfig();
   const cfg = getLlmEndpointConfig({
     modelConfigKey: 'CHAT_REPLY',
     tenantId,
     model: cop.model,
     timeoutMs: cop.callTimeoutMs,
   });
   ```
5. Semua panggilan `callChatCompletionsWithFallback` di copilot wajib meneruskan
   `attemptTimeoutCapMs: cop.callTimeoutMs`.
6. Ganti konstanta `MAX_ITERATIONS` / `MAX_TOTAL_ROWS` / `DEFAULT_TOTAL_BUDGET_MS` agar membaca `resolveCopilotConfig()` (tetap diekspor untuk kompatibilitas test).
7. Naikkan `max_tokens` router `200 → 300` (multi‑tool args) dan summarize `400 → 700`.
8. Naikkan batas `message.length` di route `1000 → 2000` (pertanyaan multi‑topik).

**Acceptance F1:**
- [ ] `npm run typecheck` lolos.
- [ ] Test lama `tests/unit/copilot-fixing.test.ts` tetap hijau (tidak ada perubahan perilaku default).
- [ ] Unit test baru: `attemptTimeoutCapMs` dihormati; default 25 dtk tetap untuk pemanggil tanpa cap.
- [ ] Unit test baru: `resolveCopilotConfig()` membaca env dengan benar (default 300000/90000/5/60).
- [ ] Log `COPILOT_PROMPT_SIZE` menampilkan `model` yang dipakai.

---

### F2 — Budget 5 menit, heartbeat, konkurensi

**File:** `src/routes/admin/copilot.subroute.ts`, `src/services/copilot/copilot.service.ts`

**Langkah:**

1. **Heartbeat SSE** di route `/stream`:
   ```ts
   const hb = setInterval(() => {
     if (closed) return;
     try { reply.raw.write(': keepalive\n\n'); } catch { /* closed */ }
   }, cop.heartbeatMs);
   // clearInterval(hb) di blok finally
   ```
   Komentar SSE (`:`) cukup untuk menjaga koneksi hidup tanpa mengotori parser klien.
2. **Event stage** (bukan hanya tool):
   ```ts
   export type CopilotProgressEvent =
     | { type: 'stage'; stage: 'router' | 'summarize' | 'done'; label: string; step: number; maxSteps: number }
     | { type: 'tool_start'; tool: string }
     | { type: 'tool_result'; tool: string; count: number };
   ```
   Kirim `stage: router` sebelum router, `stage: summarize` sebelum summarize, `stage: done` sebelum `chunk`.
   **Jangan** kirim token mentah model — grounding tetap dijaga.
3. **Rate limit** turunkan `30 → 6` per menit untuk endpoint Copilot.
4. **Semaphore per tenant** (maks 1 turn berjalan). Jika sudah ada, balas `429` dengan pesan "Copilot sedang memproses pertanyaan sebelumnya". Implementasi: `Map<tenantId, boolean>` + `try/finally` di route.
5. Pastikan `done` **selalu** terkirim di `finally`, termasuk saat klien memutus koneksi.
6. Saat klien disconnect (`request.raw.on('close')`): set `closed = true`, hentikan heartbeat. Catat di audit `aborted: true`.

**Acceptance F2:**
- [ ] Dengan budget 300 dtk, tidak ada keepalive putus selama 5 menit.
- [ ] Setelah 5 menit: jawaban degradasi (`buildDegradedAnswer`) terkirim, bukan error.
- [ ] Request kedua saat turn pertama berjalan → `429`.
- [ ] Tidak ada `setInterval` yang bocor setelah request selesai (uji dengan log/GC).

---

### F3 — Progress visual "AI sedang bekerja"

**File:** `packages/admin-dashboard/src/utils/copilotStatus.ts`, `.../components/copilot/AdminCopilotPanel.tsx`

**Langkah:**

1. Ganti tangga status agar proporsional ke 300 dtk **dan** tetap menerima event server:
   ```ts
   { untilMs: 10_000, stage: 'searching',  label: 'Mencari data di database…' }
   { untilMs: 45_000, stage: 'reasoning',  label: 'Menganalisis data…' }
   { untilMs: 120_000, stage: 'drafting',  label: 'Menyusun jawaban…' }
   { untilMs: 240_000, stage: 'polishing', label: 'Merapikan ringkasan…' }
   { untilMs: Infinity, stage: 'finalizing', label: 'Menunggu model (GLM‑5.3)…' }
   ```
2. Panel menampilkan **empat elemen**:
   - spinner + label tahap (dari event server bila ada, fallback ke tangga waktu),
   - **elapsed timer** (`formatElapsedSeconds`, sudah ada),
   - **penanda langkah** `Langkah {n}/{maxSteps}` + **jumlah baris** ditemukan,
   - **tombol Batal** (`AbortController`), membatalkan fetch SSE.
3. Tambah state `rowsFound` yang diisi dari `tool_result`.
4. Tampilkan ringkasan akhir: `Selesai dalam 42s · 2 tool · 35 baris`.
5. Naikkan `timeoutMs` fallback `/chat` dari `125000 → 305000` (`AdminCopilotPanel.tsx:241`).
6. Pastikan `aria-live="polite"` dan `aria-busy` tetap ada (aksesibilitas).

**Acceptance F3:**
- [ ] Saat turn 90 detik, indikator tetap bergerak (label berganti + elapsed naik + baris bertambah).
- [ ] Tombol Batal menghentikan UI dan mengirim sinyal `close` ke server.
- [ ] Tidak ada teks "Hampir selesai" yang macet > 1 menit.
- [ ] Uji visual di mobile (panel `w-[min(92vw,380px)]`).

---

### F4 — Tiga tool baru (ini yang membuat "tanya apa saja" bekerja)

**File:** `src/services/copilot/copilot-tools.ts` (+ daftarkan di `COPILOT_TOOLS`)

Aturan umum untuk **semua** tool baru:
- tenant‑scoped (`tenant_id`), read‑only, `take` maks 60.
- konversi WIB: `((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`.
- jangan kirim phone/UUID ke LLM (mekanisme `stripInternalIds` sudah ada).
- kembalikan `{ tool, args, count, rows }`.

#### F4.1 `query_chat_stats`

> Menjawab: "berapa chat hari ini", "chat per jam", "berapa percakapan baru minggu ini".

```ts
parameters: {
  dateFrom?: string; // YYYY-MM-DD WIB, default hari ini
  dateTo?: string;   // YYYY-MM-DD WIB, default dateFrom
  groupBy?: 'day' | 'hour' | 'status' | 'sender'; // default 'day'
}
```
Rows: `{ bucket, inboundMessages, outboundMessages, newConversations, activeConversations, humanHandling, frustrated }`.

Sumber: `messages` (inbound/outbound), `conversations` (created_at, is_human_handling, is_frustrated). Batasi 31 bucket (day) / 24 bucket (hour).

#### F4.2 `query_revenue`

> Menjawab: "omzet minggu ini", "omzet per treatment", "berapa yang sudah dibayar".

```ts
parameters: {
  dateFrom?: string;
  dateTo?: string;
  groupBy?: 'day' | 'treatment' | 'staff'; // default 'day'
  status?: 'completed' | 'confirmed' | 'all'; // default 'completed'
}
```
Rows: `{ bucket, reservations, purchaseValue, deliveryFee, discount, receiptAmount }`.

**Penting:** jangan menjumlahkan `purchaseValue` + `deliveryFee` di tool. Kembalikan komponen terpisah dan biarkan summarizer menjelaskan — menghindari salah tafsir "omzet" (jasa vs ongkir vs receipt).

#### F4.3 `query_followups`

> Menjawab: "follow‑up yang gagal", "follow‑up jatuh tempo hari ini", "siapa yang belum di‑follow up".

```ts
parameters: {
  status?: 'QUEUED' | 'SENT' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  type?: 'NO_PURCHASE' | 'NEXT_TREATMENT' | 'REMINDER_H1' | 'REVIEW_H1_BABY' | 'REVIEW_H1_MOMS' | 'WINBACK_60D';
  dueBefore?: string; // YYYY-MM-DD WIB
  limit?: number;
}
```
Rows: `{ customerName, conversationId, type, status, scheduledAt, sentAt, treatmentCategory }`.

#### F4.4 (opsional, hanya jika waktu cukup) `query_escalations`

> "eskalasi medis pending", "FAQ yang belum dijawab". Sumber: `conversations.escalation_reason`, `medical_faq_staging`, `general_faq_staging`.

**Acceptance F4:**
- [ ] "Berapa chat hari ini?" → `query_chat_stats`, 1 baris, `grounded: true`, < 20 dtk.
- [ ] "Omzet minggu ini?" → `query_revenue`, angka cocok dengan query psql manual.
- [ ] "Follow‑up yang gagal?" → `query_followups`, daftar benar.
- [ ] "Jadwal besok siapa, dan siapa yang belum dibalas?" → **2 tool dalam satu turn**.
- [ ] Semua tool punya unit test dengan fixture (tanpa DB nyata).

---

### F5 — Observability biaya

**File:** `src/services/copilot/copilot.service.ts` (+ helper yang sudah ada)

**Langkah:**
1. Catat setiap panggilan LLM Copilot ke `llm_audit_logs` dengan `task_type = 'AI_COPILOT_CHAT'`, isi `model_name`, `provider`, `latency_ms`, `prompt_tokens`, `completion_tokens`, `cost_idr`, `error_code`.
2. Perluas payload `audit_logs` (`AI_COPILOT_CHAT`) dengan `engine`, `model`, `llmCalls`, `elapsedMs`, `aborted`, `budgetMs`.
3. Tambah log terstruktur `COPILOT_TURN` (JSON satu baris) berisi: `tenantId`, `toolsUsed`, `rowCounts`, `llmCalls`, `elapsedMs`, `degraded: boolean`.

**Acceptance F5:**
- [ ] Setelah satu turn, ada baris `llm_audit_logs` dengan `task_type='AI_COPILOT_CHAT'` dan `cost_idr > 0`.
- [ ] `SELECT sum(cost_idr) ... WHERE task_type='AI_COPILOT_CHAT'` bisa dijadikan laporan harian.

---

### F6 — Infrastruktur & deploy

**File:** `/opt/wa-clinic-bot/Caddyfile`, `.env` server

1. Tambah matcher Caddy **sebelum** `handle` umum:
   ```
   @copilot path /api/admin/copilot/stream
   handle @copilot {
     reverse_proxy app:3000 {
       lb_try_duration 0s
       flush_interval -1
       transport http {
         keepalive 300s
         keepalive_idle_conns 100
         response_header_timeout 360s
       }
     }
   }
   ```
   `lb_try_duration 0s` penting: mencegah retry POST yang bisa menggandakan biaya LLM.
2. Tambah ke `.env` server:
   ```dotenv
   COPILOT_ENGINE=internal
   COPILOT_MODEL=glm-5.3-flash
   COPILOT_TOTAL_BUDGET_MS=300000
   COPILOT_CALL_TIMEOUT_MS=90000
   COPILOT_MAX_ITERATIONS=5
   COPILOT_MAX_TOTAL_ROWS=60
   COPILOT_HEARTBEAT_MS=15000
   LLM_REASONING_EFFORT=low
   ```
   `env_file` dibaca saat container dibuat → wajib `up -d --force-recreate`.
3. Deploy:
   ```bash
   # di dev workspace
   npm run typecheck && npm test -- copilot
   npm run build
   npm run build --prefix packages/admin-dashboard
   # sinkron ke host /opt/wa-clinic-bot (prosedur repo)
   cd /opt/wa-clinic-bot
   docker compose build app worker
   docker compose up -d --force-recreate app worker
   docker exec wa-clinic-bot-caddy-1 caddy reload --config /etc/caddy/Caddyfile
   ```
4. **Rollback:** `git revert` commit terkait → build ulang; atau `docker compose up -d` dengan image sebelumnya. Kembalikan `.env` ke nilai lama dan `--force-recreate`.

---

## 4. Test plan

### 4.1 Unit (vitest)
- `copilot-config.test.ts` — resolver env, default, clamp.
- `model-fallback-timeout.test.ts` — cap default 25 dtk; cap kustom dihormati.
- `copilot-tools-stats.test.ts` — `query_chat_stats` agregasi & batas bucket.
- `copilot-tools-revenue.test.ts` — komponen revenue tidak dijumlahkan paksa.
- `copilot-tools-followups.test.ts` — filter status/type/dueBefore.
- `copilot-heartbeat.test.ts` — interval dibuat & dibersihkan.
- `copilot-status.test.ts` — tangga 300 dtk (update test lama).

### 4.2 Integrasi / manual (read‑only)
```bash
curl -N -X POST https://app.kalababyspa.online/api/admin/copilot/stream \
  -H "X-API-KEY: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"message":"berapa chat hari ini dan siapa yang belum dibalas?"}'
```
Yang harus terlihat: `stage` → `tool_start` → `tool_result` → `stage` → `chunk` → `done`, dengan heartbeat `:` tiap 15 dtk.

### 4.3 Regression wajib
- `npm test` penuh hijau (minimal folder `tests/unit`).
- `npm run typecheck` hijau.
- Auto‑reply WhatsApp **tidak berubah**: `GLOBAL_BOT_ENABLED` tetap `false`, model `CHAT_REPLY` DB tetap `deepseek-v4-flash-0731:netra`.

---

## 5. Metrik keberhasilan

| Metrik | Target |
|---|---|
| Akurasi pilih tool (50 pertanyaan uji) | ≥ 85% |
| `grounded: true` | ≥ 95% |
| p50 latensi | < 15 dtk |
| p95 latensi | < 60 dtk |
| Turn > 120 dtk | < 10% |
| Biaya per turn | < Rp100 |
| Kebocoran UUID/PII | 0 |
| UI terlihat "bekerja" sepanjang turn | 100% |

---

## 6. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Budget 5 menit membuat admin menunggu terlalu lama | UX buruk | Progress visual + tombol Batal + degradasi jujur di 5 menit |
| 2 turn paralel × 5 menit | biaya & beban DB | semaphore 1 turn/tenant + rate limit 6/menit |
| GLM lambat karena thinking | latensi | `reasoning_effort=low` (sudah otomatis); ukur, naikkan hanya bila perlu |
| Caddy/klien memutus koneksi | jawaban hilang | heartbeat 15 dtk + `response_header_timeout 360s` |
| Retry POST oleh proxy | biaya ganda | `lb_try_duration 0s` pada route Copilot |
| Tool baru salah hitung | keputusan bisnis salah | angka dikembalikan sebagai komponen, bukan total; uji silang dengan psql |
| Model fallback diam‑diam | jawaban bukan dari glm | catat `model` aktual di `llm_audit_logs` + payload audit |

---

## 7. Checklist eksekusi (untuk sesi chatbot)

- [ ] **F1.1** `attemptTimeoutCapMs` ditambahkan, default 25 dtk tidak berubah
- [ ] **F1.2** `COPILOT_MODEL=glm-5.3-flash` benar‑benar dipakai (bukan `CHAT_REPLY` DB)
- [ ] **F1.3** budget 300 dtk, call 90 dtk, iterasi 5, rows 60
- [ ] **F1.4** `typecheck` + test lama hijau
- [ ] **F2.1** heartbeat 15 dtk bersih (tidak bocor)
- [ ] **F2.2** event `stage` terkirim
- [ ] **F2.3** semaphore + rate limit 6/menit
- [ ] **F3.1** tangga status 300 dtk + label dari event
- [ ] **F3.2** elapsed, langkah, jumlah baris, tombol Batal
- [ ] **F3.3** fallback `/chat` timeout 305 dtk
- [ ] **F4.1** `query_chat_stats`
- [ ] **F4.2** `query_revenue`
- [ ] **F4.3** `query_followups`
- [ ] **F5.1** `llm_audit_logs` `AI_COPILOT_CHAT`
- [ ] **F6.1** Caddy matcher + reload
- [ ] **F6.2** `.env` + force‑recreate
- [ ] **F6.3** uji produksi 5 pertanyaan nyata
- [ ] **F6.4** rollback terdokumentasi & diuji sekali

---

## 8. Perintah verifikasi cepat (setelah deploy)

```bash
# 1) model benar-benar glm?
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c \
 "SELECT task_type, model_name, latency_ms, cost_idr, created_at
  FROM llm_audit_logs WHERE task_type='AI_COPILOT_CHAT'
  ORDER BY created_at DESC LIMIT 5;"

# 2) tool baru terpakai?
docker exec wa-clinic-bot-postgres-1 psql -U postgres -d wa_clinic_db -c \
 "SELECT created_at, payload->>'toolsUsed' AS tools, payload->>'grounded' AS grounded
  FROM audit_logs WHERE action='AI_COPILOT_CHAT'
  ORDER BY created_at DESC LIMIT 5;"
```

**Definisi selesai:** kelima pertanyaan berikut dijawab benar dalam < 60 detik, `grounded: true`, tanpa UUID:
1. "Berapa chat hari ini?"
2. "Jadwal besok siapa saja?"
3. "Siapa yang belum dibalas?"
4. "Omzet minggu ini?"
5. "Follow‑up yang gagal apa saja?"
