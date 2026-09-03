# FASE 2: TELEMETRI & OBSERVABILITAS PASCA-DEPLOY (ANTI-KEBUTAAN)

## 1. Tujuan & Filosofi
Membangun sistem observabilitas aktif yang merekam, mengukur, dan memperingatkan anomali kualitas AI secara real-time ke Admin Dashboard dan Telegram Alert. Tim tidak lagi "buta" atau menunggu komplain pelanggan untuk mendeteksi kegagalan sistem.

---

## 2. Metrik Kunci & Ambang Batas SLA (Terkalibrasi dari Live Server)

| Metrik | Formula / Definisi Operasional | Target SLA | Tindakan Jika Melewati SLA |
|---|---|:---:|---|
| **Silent Drop Rate (SDR)** | $\frac{\text{HUMAN\_HANDLING tanpa balasan}}{\text{Total Percakapan Masuk}} \times 100\%$ *(di luar kejang/pendarahan)* | **< 0.5%** | Alert Telegram Warning: deteksi false positive gate medis. |
| **Unjustified RSQR** | Persentase sesi di mana bot menanyakan kelurahan ulang padahal lokasi pelanggan tidak berubah dan tidak ambigu | **0.0% (Zero)** | Alert Telegram Critical: loop interogasi terdeteksi. |
| **Sanitizer Mutilation Rate (SMR)** | Persentase balasan di mana `UnifiedResponseSanitizer` memotong >30% teks LLM atau output <15 karakter | **< 1.0%** | Warning Log: regex terlalu agresif memutilasi balasan. |
| **NLU Error & Truncation Rate** | Rasio pemanggilan `SLOT_EXTRACTOR` yang melempar error HTTP 400/401 atau JSON truncated jatuh ke `chitchat` | **< 1.5%** *(Baseline: 7.6%)* | Alert Telegram: periksa payload/token limit NLU provider. |
| **End-to-End P95 Latency** | Waktu total dari webhook diterima hingga pesan keluar ke WAHA | **< 8.000 ms** | Peringatan latensi jika provider mengalami degradasi. |

---

## 3. Breakdown Mikro-Task Fase 2

### 🔹 Mikro-Task 2.1: Skema Data & Tipe Telemetri AI Quality
- **Tujuan:** Menentukan struktur data metrik kualitas AI yang dicatat per putaran percakapan.
- **File Target:** `src/types/telemetry.ts`
- **Isi Kontrak:**
  - `TurnQualityMetrics`: `rawLlmReply`, `sanitizedReply`, `mutilationRatio`, `isSilentDrop`, `isUnjustifiedRsqr`, `nluErrorCode`, `isJsonTruncated`, `latencyMs`.
  - `AiHealthSummary`: ringkasan metrik 24 jam terakhir (SDR, RSQR, SMR, NLU failure, P50/P95 latency).

### 🔹 Mikro-Task 2.2: Implementasi `TelemetryService` Terpusat
- **Tujuan:** Service ringan (<2ms) yang menghitung metrik anomali secara real-time pada setiap putaran percakapan.
- **File Target:** `src/services/telemetry.service.ts`
- **Fungsi Utama:**
  - `calculateMutilationRatio(raw, sanitized)`: mengukur persentase karakter yang dipotong regex.
  - `checkUnjustifiedRsqr(slate, dynamicCloserInstruction)`: deteksi apakah bot memaksakan pertanyaan kelurahan padahal kelurahan sudah terkonfirmasi di `slate`.
  - `recordTurn(conversationId, customerPhone, metrics)`: menyimpan metrik ke buffer audit (`llm_audit_logs`).

### 🔹 Mikro-Task 2.3: Instrumentasi Titik Tangkap di Core Engine
- **Tujuan:** Menyisipkan pelacak telemetri pada modul-modul kritis tanpa mengganggu performa.
- **File Modifikasi:**
  - `src/slot-engine/slot-engine.ts`: mencatat waktu mulai, deteksi silent drop saat state berubah ke `HUMAN_HANDLING`.
  - `src/slot-engine/reply-generator.ts`: merekam teks sebelum dan sesudah `UnifiedResponseSanitizer`.
  - `src/slot-engine/entity-extractor.ts`: mencatat kegagalan HTTP 400 atau error parsing JSON truncated.

### 🔹 Mikro-Task 2.4: Endpoint Admin Monitoring `/api/admin/system/ai-health`
- **Tujuan:** Menyediakan endpoint REST API untuk dasbor kesehatan AI yang dapat diakses oleh Admin Panel atau monitoring eksternal.
- **File Target:** `src/routes/admin/ai-health.subroute.ts` & integrasi di `src/routes/admin.route.ts`
- **Fitur:**
  - Parameter query `windowHours` (default 24 jam).
  - Mengembalikan status sistem: `HEALTHY`, `DEGRADED`, atau `CRITICAL` berdasarkan SLA.
  - Ringkasan statistik P50, P90, P95 latensi per model yang aktif.

### 🔹 Mikro-Task 2.5: Integrasi Alerting Otomatis ke Telegram
- **Tujuan:** Mengirimkan peringatan instan ke grup Telegram pengawas jika threshold SLA dilanggar dalam sliding window 1 jam.
- **File Target:** `src/services/alert-daemon.service.ts`
- **Aturan Pemicu Alert:**
  - $\ge 2$ kali *Unjustified RSQR* dalam 1 jam $\to$ Telegram Alert `[CRITICAL_AI_LOOP]`.
  - $\ge 3$ kali *NLU HTTP 400* berturut-turut $\to$ Telegram Alert `[NLU_PROVIDER_DEGRADED]`.
  - 1 kali *Silent Drop* pada keluhan klinis anak $\to$ Telegram Alert `[UNINTENDED_SILENT_DROP]`.

---

## 4. Kriteria Sukses (Definition of Done) Fase 2
- Overhead telemetri < 2ms per pesan masuk.
- Endpoint `/api/admin/system/ai-health` aktif dan menyajikan metrik SLA riil.
- Simulasi skenario loop RSQR atau error HTTP 400 berhasil memicu notifikasi Telegram.
- Seluruh unit test di `tests/unit/telemetry-service.test.ts` berstatus `PASS`.
