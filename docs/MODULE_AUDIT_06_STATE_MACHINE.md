# AUDIT MODUL 6 DARI 16 — STATE MACHINE & CONVERSATION CORE

**Modul:** State Machine & Conversation Core (`src/state-machine/*`, `src/services/conversation.service.ts`, `src/services/message.service.ts`, `src/services/command.service.ts`, `src/services/burst-coalesce.service.ts`, `src/services/typing.service.ts`, `src/services/response-cache.service.ts`, `src/services/outbound-ledger.service.ts`, `src/services/turn-recovery.service.ts`, `src/services/greeting-template.service.ts`)  
**Commit:** `d2940dfe` (`master`), working tree bersih  
**Tanggal audit:** 2026-11-09  
**Sifat:** Read-only (Fase S4.1). Tidak ada file source code aplikasi (`src/`) yang diubah.  
**Metode:** Static code analysis, audit kepatuhan mandat repo (tenant isolation, data-driven, anti-hardcode, anti-spaghetti), penelusuran dependensi lintas-lapisan, analisis memori & concurrency, serta validasi eksekusi unit test.

---

## CAKUPAN YANG SUDAH DIBACA

| File | Baris | Status | Deskripsi Tanggung Jawab |
|---|---:|---|---|
| `src/state-machine/machine.ts` | 999 | Dibaca penuh | Core workflow pipeline: emergency cut-off, gate blocked, human takeover guard, WABA opt-out, audit logging inbound, medical concern gate, idle/confirmation timeout, CAPI trigger, deterministik form parser, delegasi V3 Agent Runner, typing simulation, pricelist trigger, terminal replies. |
| `src/state-machine/conversation-gates.ts` | 89 | Dibaca penuh | Otoritas tunggal keputusan gerbang inbound murni (pure functions): evaluasi domain gate (`out_of_domain`, `complaint`, `human_agent`) dan evaluasi medical gate dengan pengecualian FAQ medis approved. |
| `src/state-machine/types.ts` | 32 | Dibaca penuh | Kontrak antarmuka `StateHandlerContext` dan `StateHandlerResult` (metadata token, executedTools, reasoning). |
| `src/services/conversation.service.ts` | 955 | Dibaca penuh | State transition lifecycle, scoped database persistence, auto-release lease management (medical 24h, permanent CS lock, active appointment 48h, manual takeover 12h), live-chat SSE publishing, pin/unpin chat, manual unread, proactive messaging gate. |
| `src/services/message.service.ts` | 2.208 | Dibaca penuh | God Service: deduplikasi pesan (inbound/outbound), in-flight bot outbound registry, known bot message IDs, cursor pagination, logging pesan, attachment media, status delivery, message pin/unpin/hide (dengan transaksi DB + SSE), unread batch counts, emoji reaction store. |
| `src/services/command.service.ts` | 234 | Dibaca penuh | Slash command interceptor (`/reset`, `/state`, `/mulai`), soft wipe archiving customer (anonymization & cancellation Google Calendar), sandboxed state inspection. |
| `src/services/burst-coalesce.service.ts` | 261 | Dibaca penuh | Debounce coalescing untuk pesan teks beruntun customer ke dalam satu job antrean, timer window management, pre-logging inbound, dan turn ledger persistence. |
| `src/services/typing.service.ts` | 595 | Dibaca penuh | Humanizer engine: reading delay, WPM-based typing delay, semantic bubble splitting (intro + form + footer), inter-bubble delay, transport resolver (WAHA/WABA), outbound ledger begin/markSent, abort on CS takeover. |
| `src/services/response-cache.service.ts` | 110 | Dibaca penuh | In-memory LRU cache dengan bounded size (500 entries), periodic cleanup timer, prefix invalidation untuk query dashboard & agregasi data. |
| `src/services/outbound-ledger.service.ts` | 81 | Dibaca penuh | Stage 5 durability ledger: pencatatan attempt bubble outbound (`SENDING` -> `SENT`/`FAILED`/`UNKNOWN`) dengan provider message ID dan content hash sha256. |
| `src/services/turn-recovery.service.ts` | 82 | Dibaca penuh | Replay engine untuk turn inbound yang macet (>2 menit) dan data retention cleaner (>60 hari). |
| `src/services/greeting-template.service.ts` | 75 | Dibaca penuh | Data-driven greeting template resolver bersumber dari `ClinicPolicy` topik `greeting` dengan substitusi variabel aman (`{{greeting}}`, `{{nama}}`). |
| **Total** | **5.721** | **100%** | Seluruh 12 file modul diinspeksi secara baris demi baris. |

**Dependensi yang dibaca sebagian (konteks integrasi):**
- `src/v3/agent/agent-runner.ts` (kontrak eksekusi LLM & hasil eskalasi)
- `src/v3/state/goal-tracker.ts` (GoalTracker session episodik & preferensi gender)
- `src/services/medical-detection.service.ts` (deteksi gejala & severity)
- `src/services/queue.service.ts` (antrean BullMQ & in-flight turn superseding)
- `src/repositories/turn.repository.ts` & `src/repositories/conversation.repository.ts` (lapisan persistensi durable)
- `src/integrations/whatsapp/transport.ts` (abstraksi driver WAHA/WABA)

**Unit & Integration Test Suite yang relevan:**
- `tests/unit/typing.test.ts` (12 tests - PASS)
- `tests/unit/typing-sync.test.ts` (6 tests - PASS)
- `tests/unit/typing-transport.test.ts` (3 tests - PASS)
- `tests/unit/burst-coalesce.test.ts` (8 tests - PASS)
- `tests/unit/command-service.test.ts` (12 tests - PASS)
- `tests/unit/command-machine-gate.test.ts` (2 tests - PASS)
- `tests/unit/conversation-gates.test.ts` (10 tests - PASS)
- `tests/unit/known-bot-message-id.test.ts` (3 tests - PASS)
- `tests/unit/message-idempotency.test.ts` (3 tests - PASS)
*(Total 59 test spesifik modul ini berjalan hijau 100%).*

---

## A. RINGKASAN MODUL + SKOR KESEHATAN

Modul 06 merupakan **jantung operasional percakapan** yang menghubungkan webhook ingress, state machine, mesin AI (V3 Agent), layanan live chat admin/staf, dan gateway pengiriman WhatsApp (WAHA & WABA).

### Kelebihan Arsitektural (+)
1. **Otoritas Gerbang Tunggal (`conversation-gates.ts`)**: Pemisahan evaluasi murni (*pure logic*) dari eksekusi I/O pada gate domain dan medis berhasil mengeliminasi duplikasi split-brain antara `machine.ts` dan `agent-runner.ts`.
2. **Perlindungan Anti-Silent Drop**: Penanganan eskalasi ditunda hingga balasan terminal atau teks closing selesai dikirim ke pelanggan, mencegah pelanggan ditinggalkan tanpa jawaban saat handoff ke manusia.
3. **Mekanisme Sewa Berjenjang Auto-Release**: Penggantian timeout statis dengan kebijakan sewa operasional (24 jam medis, 48 jam appointment aktif, 12 jam manual takeover, serta kunci permanen untuk repeat patient) menjaga keselamatan medis sekaligus mencegah percakapan terkunci selamanya.
4. **Idempotensi & Durability Outbound Ledger**: Integrasi `outbound-ledger.service.ts` dan `turn-recovery.service.ts` memastikan setiap bubble outbound dicatat per-attempt dan turn yang macet dapat di-replay secara otomatis tanpa duplikasi pesan.
5. **Humanizer Canggih**: `typing.service.ts` memiliki kalkulasi delay berbasis WPM realistis (48 WPM HP), jitter acak, bubble splitting semantik (intro, form, footer), dan pencegahan pemanggilan ganda `stopTyping`.

### Kelemahan Arsitektural (−)
1. **God Service `message.service.ts` (2.208 baris)**: File ini menampung terlalu banyak tanggung jawab domain yang berbeda (deduplikasi, in-flight bot tracking, attachment media, cursor pagination, message pin/hide, transaksi DB, unread counters, dan reaction emoji). Hal ini melanggar *Single Responsibility Principle* dan meningkatkan *blast radius* setiap perubahan.
2. **Hardcoded Form Recognition Strings**: `machine.ts:344-345` dan `480-481` mendeteksi formulir reservasi dengan mencocokkan string literal bahasa alami (`'berikut list untuk reservasi'`, `'pilihan treatment'`, `'nama bunda'`). Hal ini bertentangan dengan mandat non-hardcode dan arsitektur data-driven multi-tenant.
3. **Unbounded Memory Leak Risk**: `memoryConversations` di `conversation.service.ts:14` berupa `Map<string, any>` tanpa batasan kapasitas (*unbounded*), berbeda dengan `memoryWaMessageIds` (dibatasi 5000) dan `memoryMessages` (dibatasi 500). Pada long-running server dengan ratusan ribu percakapan, map ini dapat memicu kebocoran memori (RAM bloat).
4. **Asimetri Provider pada Message ID Outbound**: Driver WAHA mengembalikan `messageId` resmi melalui `sendTextDetailed` yang dicatat ke `knownBotMessageIds`, sedangkan abstraksi `MessageTransport` (jalur WABA) hanya mengembalikan `boolean`. Akibatnya, pada deployment WABA penandaan bot vs admin kehilangan penentu utama.

**Skor Kesehatan: 3.0 / 5 (Fungsional, tangguh dalam pengiriman dan guard keselamatan, namun dibebani god module 2.208 baris, string matching formulir hardcoded, dan risiko memori unbounded).**

---

## B. TABEL TEMUAN LENGKAP

| ID | Severity | File:Baris | Masalah | Dampak | Prinsip yang Dilanggar | Rekomendasi + Cost/Benefit | Effort | Keyakinan | Status |
|---|---|---|---|---|---|---|---|---|---|
| **SM-01** | **Tinggi** | `src/services/message.service.ts:1-2208` | God Module 2.208 baris dengan >20 tanggung jawab berbeda (deduplikasi, media download, pin/hide transaksi DB, cursor pagination, batch unread, reaction store). | Blast radius sangat tinggi; setiap perbaikan kecil berisiko menimbulkan regresi pada alur chat live atau deduplikasi. | Single Responsibility Principle, Modularity-First Mandate, Anti-Spaghetti | Pecah menjadi sub-service modular: `messageLogService`, `messagePinService`, `messageReactionService`, `messageReadStatusService`. **Cost:** M. **Benefit:** Isolasi tinggi, pemeliharaan aman. | M | H | TERVERIFIKASI |
| **SM-02** | **Tinggi** | `src/state-machine/machine.ts:344-345, 475-481` | Pengecekan form reservasi menggunakan string literal bahasa alami (`berikut list untuk reservasi`, `pilihan treatment (`, dan kombinasi `nama` + `:` + `alamat`/`treatment`). | Tenant non-Kala dengan format kustom atau sapaan non-Bunda (misal klinik umum/ayah) gagal mendeteksi form intake deterministik. | Non-Hardcode & Data-Driven Architecture, Anti-Overfitting Mandate | Pindahkan kata kunci deteksi form ke basis data (`Tenant` / `ClinicPolicy`), atau integrasikan ke intake parser tanpa string hardcoded. **Cost:** S-M. **Benefit:** Fleksibilitas format per-tenant. | S-M | H | TERVERIFIKASI (dikoreksi) |
| **SM-03** | **Tinggi** | `src/services/conversation.service.ts:14`, `src/services/message.service.ts:48, 59` | `memoryConversations` berupa `Map` tanpa batas kapasitas (unbounded), dan array `inFlightBotOutbounds`/`knownBotMessageIds` hanya dibersihkan secara reaktif saat ada pemanggilan fungsi. | Risiko kebocoran memori (RAM bloat) pada proses server long-running dengan volume chat tinggi multi-tenant. | Scalability, Resource Management Mandate | Pasang batas kapasitas FIFO/LRU (misal `MAX_MEMORY_CONVERSATIONS = 1000`) dan background sweep interval untuk array in-memory. **Cost:** S. **Benefit:** Stabilitas memori server jangka panjang. | S | H | TERVERIFIKASI |
| **SM-04** | **Sedang** | `src/state-machine/machine.ts:260-307` | Mutasi multi-tahap saat idle timeout (`clearPendingLocation`, `updateConversationState`, `updateLastDiscussedTreatment`, `GoalTracker.updateGoalSession`) tidak berada dalam satu transaksi atomik. | Jika proses mati/crash di tengah langkah, terjadi desinkronisasi antara status DB (INITIAL) dan session V3 GoalTracker (cart/booking lama nyangkut). | Transactional Integrity, Seam of Truth Mandate | Bungkus seluruh reset episode percakapan ke dalam method kanonis tunggal `conversationService.resetSessionEpisode()`. **Cost:** S. **Benefit:** Status sesi selalu konsisten. | S | H | TERVERIFIKASI |
| **SM-05** | **Sedang** | `src/services/conversation.service.ts:844` | Dynamic import `const { wahaClient } = await import('../integrations/waha/client')` di `releaseDisabledBotConversations` tidak pernah digunakan (dead code). | Polusi import dan kebingungan arsitektur; sisa peninggalan kode sebelum mandat larangan label WAHA. | Anti-Dangling, Clean Architecture Mandate | Hapus baris import yang tidak terpakai. **Cost:** S. **Benefit:** Kebersihan basis kode. | S | H | TERVERIFIKASI |
| **SM-06** | **Sedang** | `src/state-machine/machine.ts:517`, `src/services/command.service.ts:34-45` | Salutation hardcoded `"Bunda"` pada pesan balasan form tak lengkap dan konfirmasi command `/reset`. | Balasan sistem melanggar persona tenant yang tidak menggunakan sapaan Bunda (misal: "Ibu", "Kakak", atau nama pasien). | Multi-Tenant & SaaS-Readiness Mandate | Gunakan `resolveGreetingText` atau konfigurasi persona tenant dari DB (`ClinicPolicy` / `TenantPromptConfig`). **Cost:** S. **Benefit:** Balasan sistem selaras persona tenant. | S | H | TERVERIFIKASI |
| **SM-07** | **Sedang** | `src/services/typing.service.ts:497-506` | Jalur `resolvedTransport.sendText` (WABA) hanya mengembalikan `boolean`, sedangkan `wahaClient.sendTextDetailed` mengembalikan `{ success, messageId }`. | Pada WABA, `sentMessageId` selalu `undefined`; `knownBotMessageIds` tidak terisi, melemahkan penanda bot vs admin di WABA. | Gateway Parity, Observability Mandate | Samakan kontrak `MessageTransport.sendText` agar mengembalikan `{ success: boolean; messageId?: string }`. **Cost:** S. **Benefit:** Paritas penuh fitur tracking WAHA & WABA. | S | H | TERVERIFIKASI |
| **SM-08** | **Sedang** | `src/services/command.service.ts:55`, `src/services/burst-coalesce.service.ts:83-85` | Logika regex slash command `isCommandText` diduplikasi di dua file berbeda (`/^\/[a-z]/`). | Potensi drift regex jika di masa depan ditambahkan format sub-command (misal `/reset_all` atau `/help-me`). | DRY (Don't Repeat Yourself), Single Source of Truth | Ekspor `commandService.isCommandText()` dan panggil langsung di `burst-coalesce.service.ts`. **Cost:** S. **Benefit:** Satu aturan baku untuk semua command. | S | H | TERVERIFIKASI |
| **SM-09** | **Sedang** | `src/state-machine/machine.ts:776-791` | Kegagalan `messageService.logMessage` pada pesan outbound hanya dicatat dengan `console.error` tanpa peringatan alert/metrik terstruktur. | Operator tidak mengetahui jika ada kegagalan pencatatan outbound DB (degradasi silent audit trail). | Observability & Audit Trail Integrity Mandate | Kirim alert `AlertType.SYSTEM_DEGRADATION` (severity WARNING) ke `alertService`. **Cost:** S. **Benefit:** Visibilitas error logging tanpa memicu double delivery. | S | H | TERVERIFIKASI |
| **SM-10** | **Rendah** | `src/services/burst-coalesce.service.ts:166, 170` | Timer `setTimeout` dibuat langsung tanpa registrasi ke `interval-registry.ts`. | Jika proses shutdown dipaksa tanpa memanggil `flushAll()`, timer pending bisa menggantung. | Shutdown Ordering & Lifecycle Cleanliness | Daftarkan timer ke registry atau pastikan `flushAll()` menjadi bagian wajib shutdown lifecycle. **Cost:** S. **Benefit:** Graceful shutdown bersih. | S | H | TERVERIFIKASI |
| **SM-11** | **Rendah** | `src/services/outbound-ledger.service.ts:25` | Type-cast `(prisma as any).outboundAttempt` membypass type safety Prisma client. | Potensi error runtime jika skema tabel berubah tanpa terdeteksi oleh compiler TypeScript. | Type Safety, TypeScript Strictness | Hapus cast `as any` dan pastikan delegate model `OutboundAttempt` ter-generate di Prisma client. **Cost:** S. **Benefit:** Type safety penuh saat kompilasi. | S | H | TERVERIFIKASI |
| **SM-12** | **Rendah** | `src/services/response-cache.service.ts:67-73` | Metode `invalidatePrefix(prefix)` tidak mewajibkan tenant scope. | Pembersihan cache dengan prefix umum (misal `livechat:`) dapat membersihkan cache tenant lain secara tidak sengaja. | Multi-Tenant Data Isolation Mandate | Modifikasi invalidasi prefix agar selalu menyertakan `tenantId` (misal `${tenantId}:${prefix}`). **Cost:** S. **Benefit:** Cache invalidation terisolasi per tenant. | S | H | TERVERIFIKASI |
| **SM-13** | **Rendah** | `src/services/turn-recovery.service.ts:51-64` | `replayPendingTurns` melakukan enqueue loop sekuensial tanpa interval/backpressure limiter. | Jika 50 turn macet di-replay sekaligus setelah Redis pulih, dapat terjadi lonjakan antrean mendadak (*burst thundering herd*). | Rate-Limiting & Concurrency Control | Berikan jeda kecil (50ms) atau batasi batch size per run cron recovery. **Cost:** S. **Benefit:** Beban antrean mulus saat recovery. | S | H | TERVERIFIKASI |
| **SM-14** | **Rendah** | `src/services/conversation.service.ts:377-400` | Fallback in-memory `listConversations` melakukan query iteratif serial `getCustomerById` satu per satu. | Beban komputasi tinggi pada pengujian offline / dev mode jika data percakapan in-memory banyak. | Performance & Batching Mandate | Implementasikan helper `getCustomersByIdsBatch` untuk memory fallback. **Cost:** S. **Benefit:** Query memory instan dan efisien. | S | H | TERVERIFIKASI |

---

## C. BEFORE / AFTER KODE

### C-1. Form Recognition Data-Driven (Menggantikan String Literal Hardcoded)

**Before** (`src/state-machine/machine.ts:341-345`):
```typescript
const isFormSubmission =
  isReservationFormMessage(incomingText) ||
  tenantCheckoutHit ||
  lowerFormText.includes('berikut list untuk reservasi') ||
  (lowerFormText.includes('pilihan treatment') && (lowerFormText.includes('nama bunda') || lowerFormText.includes('alamat')));
```

**After**:
```typescript
// Ambil pola form intake terkonfigurasi dari DB (ClinicPolicy / TenantPromptConfig)
const { getTenantReservationFormPatterns } = await import('../services/reservation-config.service');
const formPatterns = await getTenantReservationFormPatterns(tenantId);

const matchesConfiguredPatterns = formPatterns.some((pattern) =>
  lowerFormText.includes(pattern.toLowerCase().trim())
);

const isFormSubmission =
  isReservationFormMessage(incomingText) ||
  tenantCheckoutHit ||
  matchesConfiguredPatterns;
```

---

### C-2. Bounded Capacity & FIFO Eviction pada `memoryConversations` (Anti-Memory Leak)

**Before** (`src/services/conversation.service.ts:14-15`):
```typescript
const memoryConversations = new Map<string, any>();
```

**After**:
```typescript
// Bounded in-memory store dengan kapasitas maksimum FIFO (anti memory-leak)
const memoryConversations = new Map<string, any>();
const MAX_MEMORY_CONVERSATIONS = 1000;

function setMemoryConversation(id: string, conv: any): void {
  if (memoryConversations.has(id)) {
    memoryConversations.delete(id); // LRU touch
  } else if (memoryConversations.size >= MAX_MEMORY_CONVERSATIONS) {
    const oldestKey = memoryConversations.keys().next().value;
    if (oldestKey !== undefined) memoryConversations.delete(oldestKey);
  }
  memoryConversations.set(id, conv);
}
```

---

### C-3. Paritas Return Message ID pada Abstraksi Driver WhatsApp (WAHA & WABA)

**Before** (`src/services/typing.service.ts:497-506`):
```typescript
let sentSuccess = false;
let sentMessageId: string | undefined = undefined;
if (resolvedTransport) {
  sentSuccess = await resolvedTransport.sendText(chatId, bubbleContent);
} else if (typeof (this.client as any).sendTextDetailed === 'function') {
  const detailed = await (this.client as any).sendTextDetailed(chatId, bubbleContent);
  sentSuccess = !!detailed?.success;
  sentMessageId = detailed?.messageId;
} else {
  sentSuccess = await this.client.sendText(chatId, bubbleContent);
}
```

**After**:
```typescript
let sentSuccess = false;
let sentMessageId: string | undefined = undefined;
if (resolvedTransport) {
  // Kontrak MessageTransport diperluas mengembalikan { success, messageId }
  const res = await resolvedTransport.sendText(chatId, bubbleContent);
  sentSuccess = typeof res === 'boolean' ? res : !!res?.success;
  sentMessageId = typeof res === 'object' ? res?.messageId : undefined;
} else if (typeof (this.client as any).sendTextDetailed === 'function') {
  const detailed = await (this.client as any).sendTextDetailed(chatId, bubbleContent);
  sentSuccess = !!detailed?.success;
  sentMessageId = detailed?.messageId;
} else {
  sentSuccess = await this.client.sendText(chatId, bubbleContent);
}
```

---

### C-4. Eliminasi Duplikasi Logika `isCommandText` (Single Source of Truth)

**Before** (`src/services/burst-coalesce.service.ts:83-85`):
```typescript
// Duplikasi fungsi privat
private isCommandText(text: string): boolean {
  return /^\/[a-z]/.test(text.trim().toLowerCase());
}
```

**After**:
```typescript
// Memanfaatkan langsung service otoritas tunggal (Reusability-first)
import { commandService } from './command.service';

// Di dalam maybeCoalesce:
if (commandService.isCommandText(incomingMessage.text?.body || '')) {
  if (existing) {
    await this.flush(key);
  }
  return { handled: false };
}
```

---

## D. KATALOG REUSE & KOMPONEN BERSAMA

1. **`conversation-gates.ts` (`evaluateDomainGate`, `evaluateMedicalGate`)**:
   - Fungsi murni tanpa efek samping (*pure functions*) yang siap dipakai oleh router apa pun, CLI simulator, unit test, atau worker baru tanpa memerlukan mock database.
2. **`greeting-template.service.ts` (`resolveGreetingText`, `renderGreeting`)**:
   - Mesin template sapaan berbasis database yang dapat dimanfaatkan oleh modul notifikasi, follow-up cron, dan broadcast tanpa menulis ulang interpolasi variabel.
3. **`outbound-ledger.service.ts` (`outboundLedger.begin`, `markSent`, `markFailed`)**:
   - Komponen audit attempt per-bubble yang siap dihubungkan ke modul pengiriman apa pun untuk menjamin idempotensi outbound level bubble.
4. **`response-cache.service.ts` (`responseCacheService`)**:
   - In-memory LRU cache yang dapat digunakan oleh seluruh modul admin API untuk caching query agregat berat dengan pembersihan instan via prefix.
5. **`burst-coalesce.service.ts` (`burstCoalesceService`)**:
   - Pola window debouncer cerdas yang dapat diperluas untuk saluran pesan lain (Telegram / Instagram DM) di masa mendatang.

---

## E. FILE YANG BELUM DIBACA & BLIND SPOTS

1. **`src/v3/agent/agent-runner.ts` (Modul 08)**:
   - Alur internal pemanggilan LLM Call 1 Router & Call 2 Generator, parsing tool calls, dan dynamic tool masking belum diinspeksi pada modul ini (masuk cakupan Modul 08 V3 Agent Core).
2. **`src/services/medical-detection.service.ts` (Modul 04)**:
   - Daftar kata kunci gejala dan algoritma severity level medis tidak diverifikasi ulang di sini karena sudah diaudit pada Modul 04 Domain Logic.
3. **`src/services/live-chat-hub.service.ts` (Modul 13)**:
   - Mekanisme broadcast Redis pub/sub dan koneksi SSE ke browser Live Chat Monitor diaudit terpisah di modul Live Chat & SSE.

---

## F. RISIKO FMEA & MATRIKS REGRESI

| Potensi Kegagalan | Dampak Kegagalan | Keparahan (S) | Probabilitas (O) | Deteksi (D) | RPN | Rencana Mitigasi Fondasional |
|---|---|---|---|---|---|---|
| **Memory Leak pada `memoryConversations`** | Server OOM (Out Of Memory) crash pada proses long-running saat melayani ribuan customer. | 8 | 4 | 4 | **128** | Terapkan Bounded FIFO map dengan ukuran maksimum 1.000 entri (SM-03). |
| **Kegagalan Deteksi Form Tenant Non-Kala** | Customer mengisi form reservasi tetapi sistem mengabaikannya / LLM salah merespons karena string matching tidak cocok. | 7 | 5 | 3 | **105** | Pindahkan regex/kata kunci header form ke database `Tenant` / `ClinicPolicy` (SM-02). |
| **Status Sesi Desinkronisasi saat Idle Reset** | Customer yang chat setelah 14 hari mendapati state INITIAL tetapi cart lama masih tersisa di LLM context. | 6 | 4 | 4 | **96** | Satukan reset DB dan V3 episodik dalam satu method atomik kanonis (SM-04). |
| **Outbound Ghost Logging Failure** | Pesan terkirim ke WhatsApp pelanggan tetapi tidak muncul di dashboard admin dan tidak tercatat di DB. | 7 | 3 | 4 | **84** | Tambahkan alert peringatan sistem saat outbound logging gagal tanpa memicu retry queue (SM-09). |
| **Asimetri Message ID pada Driver WABA** | Gema bot WABA salah diartikan sebagai pesan admin manusia, memicu CS takeover palsu. | 8 | 3 | 3 | **72** | Samakan return contract `sendText` pada `MessageTransport` agar selalu mengembalikan `messageId` (SM-07). |

---

## G. REKOMENDASI TINDAKAN & PRIORITAS IMPLEMENTASI

### Prioritas 1 (P1) — Perbaikan Arsitektur & Stabilitas Memori
1. **Dekomposisi `message.service.ts` (SM-01)**: Pecah god module 2.208 baris ke modul-modul independen (`messageLogService`, `messagePinService`, `messageReactionService`, `messageReadStatusService`) dengan tetap mempertahankan facade kompatibilitas backward.
2. **Pola Form Reservasi Data-Driven (SM-02)**: Hilangkan pengecekan string literal `'nama bunda'` dan `'pilihan treatment'` dari `machine.ts`. Gunakan tabel `ClinicPolicy` atau konfigurasi tenant.
3. **Bounded FIFO untuk Store In-Memory (SM-03)**: Terapkan batas maksimal pada `memoryConversations` dan timer sweep periodik untuk `inFlightBotOutbounds` serta `knownBotMessageIds`.

### Prioritas 2 (P2) — Integritas State & Paritas Multi-Provider
1. **Method Reset Sesi Atomik (SM-04)**: Buat `conversationService.resetSessionEpisode()` yang membersihkan `customer`, `conversation`, dan `GoalTracker` secara terkoordinasi.
2. **Paritas Kontrak `MessageTransport` (SM-07)**: Perbarui interface transport agar WABA mengembalikan `messageId` resmi ke `typingService`.
3. **Konsolidasi Otoritas Slash Command (SM-08)**: Hapus duplikasi `isCommandText` di `burst-coalesce.service.ts` dan rujuk `commandService.isCommandText`.
4. **Persona-Aware System Replies (SM-06)**: Gunakan sapaan dinamis dari `ClinicPolicy` untuk balasan sistem internal (bukan string statis "Bunda").

### Prioritas 3 (P3) — Kebersihan Kode & Optimasi
1. **Pembersihan Dead Code (SM-05)**: Hapus import `wahaClient` yang tidak terpakai di `conversation.service.ts:844`.
2. **Pengetatan Type-Safety Prisma (SM-11)**: Hapus cast `(prisma as any)` di `outbound-ledger.service.ts`.
3. **Pemberian Jeda pada Turn Recovery (SM-13)**: Tambahkan delay mikro saat replay turn macet untuk mencegah burst spike.

---

## Catatan Koreksi Pasca-Review (2026-11-09)

- **SM-02** dikoreksi: baris 475-481 memakai `'pilihan treatment ('` dan kombinasi `'nama' + ':' + 'alamat'/'treatment'`; string `'nama bunda'` yang persis berada di baris 344-345. Temuan tetap valid.
- **Verifikasi ulang**: seluruh line count (5.721 baris / 12 file), `memoryConversations` (`conversation.service.ts:14`), dead import `wahaClient` (`:844`), `MessageTransport.sendText(): Promise<boolean>` (`transport.ts:8`), dan duplikasi `isCommandText` (`command.service.ts:54`, `burst-coalesce.service.ts:83`) tetap cocok.
