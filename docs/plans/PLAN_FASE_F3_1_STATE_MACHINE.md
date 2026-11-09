# Implementation Plan — Fase F3.1: State Machine & Message Engine Modularization (SM-01 s/d SM-14)

**Tanggal:** 2026-11-09  
**Status:** DRAFT (Menunggu Konfirmasi Pengguna)  
**Tujuan:** Dekomposisi God Module `src/services/message.service.ts` (<1.500 baris) dan perbaikan struktural state machine serta message engine (SM-01 s/d SM-14) secara deterministik dan berorientasi arsitektur fondasional.

---

## 1. Inventaris Temuan & Target Modul

| ID | Modul / File Aktual | Severity | Masalah Fondasional | Target Perbaikan Fondasional |
|---|---|---|---|---|
| **SM-01** | `src/services/message.service.ts` (2.208 baris) | **Tinggi** | God Module dengan >20 tanggung jawab (dedup, pin/hide, bookmark, reactions, pagination, read counts). | Pecah menjadi sub-modul domain terfokus: `src/services/message-pin.service.ts`, `src/services/message-reaction.service.ts`, `src/services/message-read-status.service.ts`. `message.service.ts` menjadi facade orkestrasi inti (<1.400 baris) dengan interface backward-compatible. |
| **SM-02** | `src/state-machine/machine.ts:341-345, 475-481` | **Tinggi** | String hafalan form literal (`berikut list untuk reservasi`, `pilihan treatment (`, dll.) tersebar langsung di flow routing. | Pindahkan deteksi format formulir ke helper kanonis semantik di `src/utils/reservation-text-parser.ts` (`isReservationFormMessage` / `isPotentialReservationForm`) yang data-driven. |
| **SM-03** | `src/services/conversation.service.ts:14`, `src/services/message.service.ts:48, 59` | **Tinggi** | `memoryConversations` Map & array `inFlightBotOutbounds`/`knownBotMessageIds` tanpa limit kapasitas (unbounded memory leak). | Pasang bounded capacity (LRU / max entries + time-based prune) agar aman dari lonjakan pesan ratusan ribu per hari. |
| **SM-04** | `src/state-machine/machine.ts:260-307` | **Sedang** | Mutasi multi-tahap saat idle timeout terpisah-pisah (pending location, state, last discussed treatment, goal session) tanpa seam atomik. | Kapsulasi ke method atomik kanonis `conversationService.resetConversationToInitial(conversationId, customerId, tenantId)` dengan rollback / konsistensi memori terpadu. |
| **SM-05** | `src/services/conversation.service.ts:844` | **Sedang** | Dead import `wahaClient` di `releaseDisabledBotConversations`. | Hapus dead import untuk mematuhi mandat gateway abstraction dan kebersihan modul. |
| **SM-06** | `src/state-machine/machine.ts:517`, `src/services/command.service.ts:34-45` | **Sedang** | Sapaan "Bunda" di-hardcode pada pesan validasi form dan konfirmasi command `/reset`. | Gunakan helper persona tenant-aware (`getSalutation(customer, tenantId)`) secara dinamis. |
| **SM-07** | `src/services/typing.service.ts:497-506` | **Sedang** | Jalur `resolvedTransport.sendText` hanya return `boolean` tanpa mengekstrak `messageId` dari response transport, sehingga ID bot tidak teregistrasi ke ledger deduplikasi. | Standardisasi return transport untuk mengekstrak `messageId` bila tersedia dan daftarkan ke `registerKnownBotMessageId`. |
| **SM-08** | `src/services/command.service.ts:55`, `src/services/burst-coalesce.service.ts:83-85` | **Sedang** | Regex slash command `isCommandText` diduplikasi di dua service. | Gunakan fungsi kanonis tunggal `commandService.isCommandText(text)` di seluruh sistem. |
| **SM-09** | `src/state-machine/machine.ts:776-791` | **Sedang** | Error logging `messageService.logMessage` pada pesan outbound hanya memakai `console.error` tanpa peringatan alert/metrik terstruktur. | Integrasikan ke `alertService.notifyError` dengan level warning (best-effort non-blocking) agar kegagalan sinkronisasi DB terdeteksi di observabilitas. |
| **SM-10** | `src/services/burst-coalesce.service.ts:166, 170` | **Rendah** | `setTimeout` dibuat langsung tanpa registrasi ke lifecycle shutdown. | Tambahkan helper `trackTimeout` / `clearTimeoutTracked` di `src/lifecycle/interval-registry.ts` dan daftarkan timer burst coalesce. |
| **SM-11** | `src/services/outbound-ledger.service.ts:25` | **Rendah** | Type-cast `(prisma as any).outboundAttempt` membypass Prisma client types. | Gunakan typed accessor `prisma.outboundAttempt`. |
| **SM-12** | `src/services/response-cache.service.ts:67-73` | **Rendah** | `invalidatePrefix(prefix)` tidak mendukung filter tenant sehingga merusak cache tenant lain. | Tambahkan parameter opsional `tenantId?: string` di `invalidatePrefix` untuk isolasi multi-tenant. |
| **SM-13** | `src/services/turn-recovery.service.ts:51-64` | **Rendah** | Replay turns loop tanpa backpressure atau delay kecil antar pesan. | Tambahkan throttling micro-delay (50ms) antar turn enqueue untuk mencegah queue spike. |
| **SM-14** | `src/services/conversation.service.ts:377-400` | **Rendah** | Fallback in-memory `listConversations` memanggil `getCustomerById` secara serial n+1. | Gunakan memory customer cache/map lookup di dalam siklus list. |

---

## 2. Tahapan Eksekusi (Staged Phases)

### Sub-Fase F3.1a: Dekomposisi Modular `message.service.ts` (SM-01)
1. **Red Test:**
   - Buat `tests/unit/message-services-split.test.ts` untuk memverifikasi fungsionalitas seam:
     - `messagePinService`: `toggleMessagePin`, `toggleMessageHide`, `getPinnedMessage`.
     - `messageReactionService`: `addOrUpdateReaction`.
     - `messageReadStatusService`: `markConversationMessagesAsRead`, `markConversationAsUnread`, `getUnreadCountsBatch`, `getTotalUnreadCount`, `markAllMessagesAsRead`.
     - `messageService` facade: memanggil semua methods di atas tanpa regresi kontrak API.
2. **Implementasi:**
   - Ekstrak `src/services/message-pin.service.ts` (~500 baris).
   - Ekstrak `src/services/message-reaction.service.ts` (~120 baris).
   - Ekstrak `src/services/message-read-status.service.ts` (~250 baris).
   - Rampingkan `src/services/message.service.ts` dari 2.208 baris menjadi <1.400 baris dengan delegasi facade ke ketiga service tersebut.
3. **Green Gate:**
   - Verifikasi baris `message.service.ts` < 1.500 baris.
   - `npx vitest run tests/unit/message-services-split.test.ts tests/unit/live-chat.test.ts`.

---

### Sub-Fase F3.1b: Flow & State Machine Hardening (SM-02, SM-04, SM-06, SM-07, SM-08)
1. **Red Test:**
   - Buat `tests/unit/state-machine-sm-hardening.test.ts` mencakup:
     - `isPotentialReservationForm` / `isReservationFormMessage` kanonis tanpa kata hafalan di `machine.ts`.
     - `conversationService.resetConversationToInitial` atomik.
     - Dynamic salutation pada incomplete form reply dan command reset.
     - Single `isCommandText` di `burst-coalesce.service.ts`.
     - Penangkapan `messageId` di `typing.service.ts` pada transport gateway.
2. **Implementasi:**
   - Perbarui `src/utils/reservation-text-parser.ts` dengan deteksi semantik data-driven.
   - Bersihkan `src/state-machine/machine.ts` dari string hafalan form (baris 341-345 & 475-481).
   - Tambahkan method `resetConversationToInitial` di `src/services/conversation.service.ts` dan panggil di `machine.ts:260-307`.
   - Gunakan `getSalutation(customer, tenantId)` di `machine.ts:517` dan pesan command di `src/services/command.service.ts`.
   - Gunakan `commandService.isCommandText` di `src/services/burst-coalesce.service.ts`.
   - Perbarui `src/services/typing.service.ts` untuk mengekstrak messageId dari return transport.
3. **Green Gate:**
   - Jalankan `npx vitest run tests/unit/state-machine-sm-hardening.test.ts`.

---

### Sub-Fase F3.1c: Durabilitas Memori & Observabilitas (SM-03, SM-05, SM-09 s/d SM-14)
1. **Red Test:**
   - Buat `tests/unit/sm-durability-observability.test.ts`:
     - Bounded memory check pada `memoryConversations` dan in-flight bot tracking (`SM-03`).
     - Alert logging pada failure `logMessage` outbound (`SM-09`).
     - Registrasi timeout di `interval-registry.ts` (`SM-10`).
     - Type safety `outboundAttempt` (`SM-11`).
     - Tenant-scoped cache invalidation (`SM-12`).
     - Backpressure turn replay (`SM-13`).
     - Batch lookup customer di in-memory `listConversations` (`SM-14`).
2. **Implementasi:**
   - Pasang bounded prune pada Map & array in-memory di `conversation.service.ts` dan `message.service.ts`.
   - Hapus dead import `wahaClient` di `conversation.service.ts:844`.
   - Tambahkan alert structured warning di `machine.ts:788`.
   - Tambahkan `trackTimeout` di `src/lifecycle/interval-registry.ts` dan terapkan di `burst-coalesce.service.ts`.
   - Hapus `(prisma as any)` di `outbound-ledger.service.ts`.
   - Tambahkan parameter `tenantId?: string` di `response-cache.service.ts:invalidatePrefix`.
   - Tambahkan pacing delay 50ms di `turn-recovery.service.ts`.
   - Optimalkan loop memory di `conversation.service.ts:listConversations`.
3. **Green Gate:**
   - Jalankan `npx vitest run tests/unit/sm-durability-observability.test.ts`.

---

## 3. Regression Gate F3.1
- `npm run build` (backend) + build dashboard
- `npm run security:scan`
- `npx vitest run tests/unit/message*.test.ts tests/unit/state-machine*.test.ts`
- Ukuran file `message.service.ts` dipastikan < 1.500 baris.
