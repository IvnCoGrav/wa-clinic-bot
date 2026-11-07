# AUDIT MODUL 5 DARI 16 — BOOTSTRAP & WEBHOOK INGRESS

**Modul:** `src/app.ts`, `src/worker.ts`, `src/routes/webhook.route.ts`, `src/routes/waba-webhook.route.ts`, `src/routes/health.route.ts`
**Commit:** `c8ce5b21` (`master`), working tree bersih
**Tanggal audit:** 2026-11-07
**Sifat:** read-only. Tidak ada file source yang diubah.
**Metode:** baca seluruh 5 file, lacak pemanggil/dependensi via `rg`, periksa test ingress, dan bandingkan jalur WAHA vs WABA untuk mendeteksi drift paritas.

---

## CAKUPAN YANG SUDAH DIBACA

| File | Baris | Status |
|---|---:|---|
| `src/app.ts` | 322 | Dibaca penuh |
| `src/worker.ts` | 121 | Dibaca penuh |
| `src/routes/webhook.route.ts` | 1.577 | Dibaca penuh |
| `src/routes/waba-webhook.route.ts` | 508 | Dibaca penuh |
| `src/routes/health.route.ts` | 60 | Dibaca penuh |
| **Total** | **2.588** | **100%** |

**Dependensi yang dibaca sebagian (untuk memahami perilaku, bukan modul ini):**
`src/integrations/whatsapp/signature.ts` (verifikasi HMAC Meta), `src/services/waha-tenant.service.ts` (resolusi tenant + fallback DB offline), `src/services/waba-tenant.service.ts` (resolusi phone_number_id), `src/services/message.service.ts` (idempotensi & memory claim), `src/services/queue.service.ts` (enqueue), `src/services/burst-coalesce.service.ts` (flushAll → enqueue), `src/lifecycle/shutdown.ts` (urutan shutdown app), `src/services/customer.service.ts` (`setLabelFlags`), `src/integrations/whatsapp/factory.ts` (client per tenant).

**Test ingress yang relevan:** `tests/integration/waha-webhook.test.ts`, `tests/integration/waba-webhook-route.test.ts`, `tests/integration/webhook-non-personal-filter.test.ts`, `tests/unit/webhook-echo-tenant.test.ts`, `tests/integration/label-events.test.ts`, `tests/integration/auth-access-log.test.ts`, `tests/integration/robustness.test.ts`, `tests/integration/queue-stale-state.test.ts`, dan test `buildApp` lainnya.

---

## A. RINGKASAN MODUL + SKOR KESEHATAN

Ini adalah pintu masuk seluruh traffic WhatsApp ke sistem. Secara fungsional jalurnya sudah kaya guard: signature WAHA/WABA, resolusi tenant fail-closed untuk session tak dikenal, idempotensi `wa_message_id`, stale-message guard, bypass label admin, AI scope gate, human-handling silence, burst coalescing, turn ledger, dan queue. Namun ada dua masalah yang bersifat lintas-tenant dan reliability: (1) handler `label.chat.added/deleted` tidak menerima `resolvedTenantId` sehingga label tenant B dapat menulis ke tenant default; (2) idempotensi mengklaim `wa_message_id` di memori **sebelum** pesan berhasil di-log/di-enqueue, sehingga kegagalan sementara (queue error, phone belum ter-resolve) membuat retry dianggap duplikat dan pesan hilang. Selain itu, deteksi echo bot masih memakai string hardcoded tenant A di samping pola tenant-aware dari DB. Secara arsitektur, dua handler WAHA/WABA menduplikasi pipeline ingress yang sama (stale guard, bypass, scope gate, media, turn, queue), sehingga setiap perubahan harus dilakukan dua kali dan rawan drift.

**Skor kesehatan: 2.5 / 5 (fungsional dan banyak guard, tetapi tenant isolation & message-loss risk belum tertutup).**

Alasan skor:
- **+** Signature verification, tenant fail-closed untuk session tak dikenal, idempotensi, stale guard, bypass, scope gate, dan turn ledger sudah ada.
- **+** WABA memakai raw body untuk HMAC; strict mode fail-closed.
- **+** Test ingress cukup banyak (WAHA/WABA/label/echo/robustness).
- **−** Label event tidak tenant-scoped (cross-tenant write).
- **−** Idempotensi diklaim sebelum enqueue/log sukses → potensi pesan hilang.
- **−** Echo detection masih hardcoded di samping pola DB.
- **−** Tidak ada `setErrorHandler`; `trustProxy: true`; `/ready` hanya WAHA.
- **−** Pipeline WAHA/WABA duplikat; boot init duplikat di app/worker.

---

## B. TABEL TEMUAN

**Severity:** Kritis / Tinggi / Sedang / Rendah.
**Status:** TERVERIFIKASI = dibaca/dilacak langsung; HIPOTESIS = perlu uji runtime/multi-tenant.

| ID | Severity | file:baris | Masalah | Dampak | Prinsip/standar yang dilanggar | Rekomendasi spesifik + cost-benefit | Effort | Keyakinan | Status |
|---|---|---|---|---|---|---|---|---|---|
| **ING-01** | **Tinggi** | `webhook.route.ts:38-63`, `131-134`; `customer.service.ts` `setLabelFlags(phone, flags, tenantId = DEFAULT_TENANT_ID)` | `handleLabelChatEvent(event)` tidak menerima `resolvedTenantId`; `customerService.setLabelFlags(phone, flags)` dipanggil dengan dua argumen sehingga memakai `DEFAULT_TENANT_ID`. | Event label dari tenant B dapat mengubah `is_admin_labeled`/`is_hold_labeled` customer tenant A. Bot bisa bypass atau berhenti membalas nomor yang salah. | Tenant isolation, correctness, data integrity | Teruskan `resolvedTenantId` ke handler dan `setLabelFlags(phone, flags, tenantId)`; buat cache label tenant-scoped. **Cost:** S. **Benefit:** label event tidak lintas tenant. | S | H | TERVERIFIKASI (jalur kode) |
| **ING-02** | **Tinggi** | `webhook.route.ts:750-762`, `1562-1571`; `waba-webhook.route.ts:163-167`, `485-494`; `message.service.ts:264-266` | `isDuplicateMessage()` mengklaim `wa_message_id` di memori (dan menambah key) saat pertama diperiksa. Jika proses setelahnya gagal (phone belum ter-resolve, `queueService.enqueueMessage` throw, DB log gagal), retry berikutnya melihat key itu dan dianggap duplikat. | Pesan customer hilang permanen saat gangguan sementara; tidak ada retry yang berhasil. | Reliability, idempotensi transaksional, at-least-once delivery | Klaim idempotensi setelah pesan berhasil di-log/di-enqueue, atau simpan state `RECEIVED` dan lepaskan key saat gagal. Gunakan outbox/queue durable. **Cost:** M. **Benefit:** tidak ada silent message loss. | M | H | TERVERIFIKASI (alur kode) |
| **ING-03** | **Tinggi** | `webhook.route.ts:368-379` | Di samping `getTenantEchoPatterns(resolvedTenantId)` yang tenant-aware, `isBotAutoReply` masih memakai string hardcoded: `'Bunda, untuk kondisi darurat seperti ini'`, `'Pricelist'`, `'[AUTOMATED]'`, dll. | Balasan bot tenant B yang tidak cocok dengan string tenant A dapat dianggap balasan manual admin → memicu `escalateToHumanHandling`, self-learning, dan capture yang salah. | Tenant awareness, data-driven, correctness | Hapus literal; gunakan hanya `getTenantEchoPatterns` + pola teknis yang benar-benar universal. **Cost:** S. **Benefit:** echo detection konsisten per tenant. | S | H | TERVERIFIKASI |
| **ING-04** | **Sedang** | `app.ts:70-71` | `Fastify({ trustProxy: true })` mempercayai semua proxy. `request.ip` dipakai untuk rate limit dan auth log. | Jika app dapat dijangkau langsung (bukan hanya Caddy), `X-Forwarded-For` dapat dipalsukan untuk bypass rate limit / mengaburkan IP log. | Security, rate-limit integrity | Set `trustProxy` ke IP/CIDR Caddy yang spesifik, atau env `TRUST_PROXY` dengan default aman. **Cost:** S. **Benefit:** rate limit & log tidak dapat dipalsukan. | S | H | TERVERIFIKASI |
| **ING-05** | **Sedang** | `app.ts` (tidak ada `setErrorHandler`/`setNotFoundHandler`) | Tidak ada error handler terpusat. Fastify memakai default; pesan error internal/validasi dapat diteruskan ke response, dan format error tidak konsisten. | Kebocoran detail internal; client menerima pesan yang tidak seragam. | Security, API consistency | Tambah `app.setErrorHandler` yang memetakan error domain/validasi ke 4xx/5xx, log detail di server, response generik. **Cost:** S. **Benefit:** error aman & konsisten. | S | H | TERVERIFIKASI (tidak ada handler) |
| **ING-06** | **Sedang** | `app.ts:229-271` | `server.listen()` dipanggil lebih dulu; inisialisasi katalog/delivery/persona/AI config dilakukan **di dalam callback listen**. Server sudah menerima request saat init masih berjalan. | Request awal (termasuk webhook) dapat memakai cache kosong/default; `/ready` bisa melaporkan siap sebelum data tenant dimuat. | Boot correctness, readiness | Pindahkan inisialisasi tenant ke sebelum `listen`, atau tambahkan readiness gate yang menunggu init selesai. **Cost:** S–M. **Benefit:** tidak ada request yang diproses dengan config default. | S–M | H | TERVERIFIKASI |
| **ING-07** | **Sedang** | `webhook.route.ts:336`, `738`, `770`, `966`, `1148`, `1419`, `605`, `611`, `804`, `810`, `1062` | Jalur WAHA memakai `wahaClient` global untuk `getPhoneNumberFromLid`, `resolvePrimaryJid`, `getContact`, `getChatLabelsOrNull`, `getChatLabels`, `fetchUrl`, dan `downloadMedia`, padahal tenant sudah di-resolve. | Pada deployment multi-session/multi-tenant WAHA, operasi dapat memakai session/env global, bukan session tenant; data/label/media bisa salah tenant. | Tenant isolation, gateway abstraction | Gunakan `getWahaClientForTenant(resolvedTenantId)` (atau gateway factory) untuk semua operasi per-tenant; pertahankan `wahaClient` hanya untuk single-tenant fallback. **Cost:** M. **Benefit:** semua operasi WAHA tenant-aware. | M | H | TERVERIFIKASI (pemakaian global) |
| **ING-08** | **Sedang** | `health.route.ts:21-58` | `/ready` hanya memeriksa `prisma` dan `wahaClient.getSessionStatus()` global. WABA-only, Redis, dan queue tidak diperiksa; tidak ada timeout. | Deployment WABA-only selalu `503`; saat WAHA reconnect/QR, readiness gagal dan orchestrator bisa me-restart app; dependency lambat dapat menggantung probe. | Readiness correctness, availability | Periksa provider yang aktif (WAHA/WABA), Redis/queue bila dipakai, dan beri timeout per check. Pisahkan liveness (`/health`) dari readiness dependency. **Cost:** M. **Benefit:** readiness mencerminkan kesiapan nyata. | M | H | TERVERIFIKASI |
| **ING-09** | **Sedang** | `webhook.route.ts:575-585` | `messageService.logMessage(...).catch(...)` untuk outbound di-swallow; webhook tetap 200. | Jika DB/log gagal, pesan outbound tidak tercatat di DB/LiveChat dan tidak ada retry. | Reliability, observability | Await dan lempar/retry, atau masukkan ke outbox; jangan return 200 sebelum log durable. **Cost:** S–M. **Benefit:** tidak ada outbound ghost. | S–M | H | TERVERIFIKASI |
| **ING-10** | **Sedang** | `webhook.route.ts` vs `waba-webhook.route.ts` | Pipeline ingress WAHA/WABA menduplikasi alur yang sama: stale guard, bypass, scope gate, human-handling, media, turn persist, queue. Setiap perubahan harus diedit dua kali; komentar "paritas WAHA" menandakan drift yang disadari. | Risiko parity bug: satu jalur punya guard baru, jalur lain tertinggal. | DRY, single pipeline, maintainability | Ekstrak `ingressPipeline`/`messageIngressService` dengan adapter normalizer+signature per provider. **Cost:** L. **Benefit:** satu perilaku ingress untuk WAHA/WABA. | L | H | TERVERIFIKASI |
| **ING-11** | **Rendah** | `app.ts:241-267`; `worker.ts:90-110` | Loop inisialisasi tenant (katalog, delivery tiers, persona, AI config, AI scope) diduplikasi di app dan worker. | Jika satu proses menambah langkah init, proses lain bisa drift; worker sempat kehilangan persona (insiden 12/10/2026). | DRY, boot consistency | Ekstrak `initializeTenantRuntime()` di service/lifecycle dan panggil dari kedua entry. **Cost:** S. **Benefit:** init konsisten. | S | H | TERVERIFIKASI |
| **ING-12** | **Rendah** | `worker.ts:46-59` vs `lifecycle/shutdown.ts:56-63` | Worker menutup queue **sebelum** `burstCoalesceService.flushAll()`, sedangkan app menutup queue **setelah** flush. `flushAll()` memanggil `queueService.enqueueMessage`. | Jika worker suatu saat memegang buffer burst, flush saat shutdown akan gagal enqueue. Saat ini worker tidak menerima webhook, jadi dampak aktual rendah. | Shutdown ordering, reliability | Samakan urutan: clear cron → flush burst → close queue → disconnect Prisma. **Cost:** S. **Benefit:** shutdown konsisten. | S | H | TERVERIFIKASI (urutan), HIPOTESIS (dampak saat ini) |
| **ING-13** | **Rendah** | `webhook.route.ts:60-62`, `131-133` | `handleLabelChatEvent` menangkap semua error dan hanya `console.warn`; webhook tetap 200. | Event label yang gagal tidak di-retry; label DB bisa stale sampai reconciliation periodik. | Reliability, observability | Kembalikan status/retry atau masukkan ke outbox; minimal metrik kegagalan. **Cost:** S. **Benefit:** label sync lebih andal. | S | H | TERVERIFIKASI |
| **ING-14** | **Rendah** | `waha-tenant.service.ts:53-57` | DB offline → `resolveTenantBySession` mengembalikan `DEFAULT_TENANT_ID` (dokumentasi menyebut trade-off availability; multi-tenant belum aktif). | Saat DB blip di masa multi-tenant, pesan tenant lain dapat diproses sebagai default tenant. | Tenant isolation, fail-closed | Sediakan mode strict multi-tenant (tolak saat DB offline) via env; aktifkan sebelum tenant kedua. **Cost:** M. **Benefit:** tidak ada cross-tenant saat DB down. | M | H (kode), M (dampak) | TERVERIFIKASI (dokumentasi known issue) |
| **ING-15** | **Rendah** | `waba-webhook.route.ts:40-61` | Sebelum signature diverifikasi, route melakukan `prisma.tenant.findUnique` berdasarkan `phone_number_id` dari body untuk mengambil per-tenant secret. | Request tak terautentikasi dapat memicu query DB per request; potensi enumerasi/DoS ringan. Dibatasi rate limit 5000/menit. | Security, DoS resistance | Cache secret per phone_number_id dengan TTL; validasi format; rate limit lebih ketat untuk lookup. **Cost:** S. **Benefit:** mengurangi beban DB pra-auth. | S | H | TERVERIFIKASI |
| **ING-16** | **Rendah** | `webhook.route.ts:16` | `webhook.route.ts` mengimpor `memoryAdClicks` dari `tracking.route.ts` (route-to-route coupling). | Store milik route lain dipakai langsung; sulit dites dan berpotensi circular import. | Layering, modularity | Pindahkan `memoryAdClicks` ke `services`/store bersama. **Cost:** S. **Benefit:** route tidak saling bergantung. | S | H | TERVERIFIKASI |
| **ING-17** | **Rendah** | `webhook.route.ts:194` | Ekstraksi `shortId` revoke memakai `replace` berantai (`^true_`, `^[^_]+_`, `@.*$`), bukan util `extractShortMessageId` yang dipakai idempotensi. | ID dengan underscore dapat dipotong salah; revoke bisa mengenai pesan yang salah/tidak ditemukan. | Reuse, correctness | Gunakan `extractShortMessageId` yang sama dengan `message.service`. **Cost:** S. **Benefit:** konsistensi ID. | S | H | TERVERIFIKASI |
| **ING-18** | **Rendah** | `tests/` | Belum ada test untuk: label event tenant B (cross-tenant), idempotency claim saat enqueue gagal, dan `/ready` WABA-only. | Regresi tenant isolation/message loss tidak tertangkap. | Testability, adversarial testing | Tambah test integrasi dua tenant + mock enqueue throw + readiness provider. **Cost:** M. **Benefit:** mengunci perilaku kritis. | M | H | TERVERIFIKASI |

---

## C. BEFORE / AFTER KODE

### C-1. Label event harus tenant-scoped

**Before** (`webhook.route.ts:38-58`, `131-133`):
```ts
async function handleLabelChatEvent(event: WahaWebhookEvent): Promise<void> {
  // ...
  await customerService.setLabelFlags(phone, {
    isAdminLabeled: lower === 'admin' ? isAdded : undefined,
    isHoldLabeled: lower === 'hold' ? isAdded : undefined,
  });
}

if (event.event === 'label.chat.added' || event.event === 'label.chat.deleted') {
  await handleLabelChatEvent(event);
  return reply.status(200).send({ status: 'LABEL_EVENT_PROCESSED' });
}
```

**After**:
```ts
async function handleLabelChatEvent(
  event: WahaWebhookEvent,
  tenantId: string
): Promise<void> {
  // ...
  await customerService.setLabelFlags(
    phone,
    {
      isAdminLabeled: lower === 'admin' ? isAdded : undefined,
      isHoldLabeled: lower === 'hold' ? isAdded : undefined,
    },
    tenantId
  );
}

if (event.event === 'label.chat.added' || event.event === 'label.chat.deleted') {
  await handleLabelChatEvent(event, resolvedTenantId);
  return reply.status(200).send({ status: 'LABEL_EVENT_PROCESSED' });
}
```

---

### C-2. Idempotensi: klaim setelah enqueue berhasil

**Before** (`webhook.route.ts:750-762`, `1562-1571`):
```ts
const isDuplicate = await messageService.isDuplicateMessage(waMessageId, resolvedTenantId);
if (isDuplicate) return reply.status(200).send({ status: 'IGNORED_DUPLICATE' });

// ... banyak langkah ...

await queueService.enqueueMessage({ ... });
```

**After**:
```ts
// Jangan klaim key di sini. Cek DB saja tanpa menulis memory claim.
const existsInDb = await messageService.existsInDb(waMessageId, resolvedTenantId);
if (existsInDb) return reply.status(200).send({ status: 'IGNORED_DUPLICATE' });

try {
  await messageService.logMessage({ ...waMessageId... });
  await queueService.enqueueMessage({ ... });
  messageService.claimMemoryWaMessageId(waMessageId, resolvedTenantId); // klaim setelah sukses
} catch (err) {
  // Jangan klaim; biarkan retry berikutnya memproses ulang.
  throw err;
}
```
**Catatan:** perlu memisahkan `isDuplicateMessage` (read-only check) dari `claim` (write). Saat ini `message.service.ts:264-266` mencampur keduanya.

---

### C-3. Gunakan client WAHA per tenant

**Before** (`webhook.route.ts:966`, `1419`, `738`):
```ts
labels = await wahaClient.getChatLabelsOrNull(chatId);
const jidFromWaha = await wahaClient.resolvePrimaryJid(chatId);
```

**After**:
```ts
import { getWahaClientForTenant } from '../integrations/whatsapp/factory';

const tenantWaha = await getWahaClientForTenant(resolvedTenantId);
labels = await tenantWaha.getChatLabelsOrNull(chatId);
const jidFromWaha = await tenantWaha.resolvePrimaryJid(chatId);
```
**Catatan:** pastikan `getWahaClientForTenant` mengembalikan client dengan session/tenant yang benar; jika belum ada, tambahkan adapter di factory, bukan fallback ke global.

---

### C-4. Hapus echo hardcoded, pakai pola DB

**Before** (`webhook.route.ts:372-379`):
```ts
const isBotAutoReply =
  adminReplyText.includes('Bunda, untuk kondisi darurat seperti ini') ||
  adminReplyText.includes('Bunda, untuk pertimbangan kondisi kesehatan') ||
  adminReplyText.startsWith('Pricelist') ||
  adminReplyText.startsWith('[IMAGE: Pricelist') ||
  imageCaption.startsWith('Pricelist') ||
  adminReplyText.startsWith('[AUTOMATED]') ||
  isDeviceAutoGreeting;
```

**After**:
```ts
// Pola echo berasal dari DB per tenant (greetings_text, format_visit, name, template).
// Literal tenant A dihapus; pola teknis universal boleh tetap di constants.
const isBotAutoReply = isDeviceAutoGreeting;
```
Jika perlu pola teknis universal, simpan di `config`/DB dengan `tenant_id` dan seed untuk tenant baru.

---

### C-5. Error handler terpusat

**Before** (`app.ts`, tidak ada handler):
```ts
const app = Fastify({ trustProxy: true, logger: { ... } });
// route register...
```

**After**:
```ts
app.setErrorHandler((error, request, reply) => {
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  request.log.error({ err: error, reqId: request.id }, 'request_failed');
  reply.status(status).send({
    statusCode: status,
    error: status >= 500 ? 'Internal Server Error' : error.name || 'Bad Request',
    message: status >= 500 ? 'Terjadi kesalahan internal.' : error.message,
  });
});
```
Sesuaikan dengan error domain yang sudah ada (mis. `CONVERSATION_NOT_FOUND_FOR_TENANT`).

---

## D. KATALOG REUSE

| Nama | Lokasi | Fungsi | Pemakai |
|---|---|---|---|
| `buildApp()` | `app.ts:36-214` | Membangun Fastify, content parser raw body, rate limit, route registration, auth log hook | `src/app.ts` main, test integrasi |
| `webhookRoutes(fastify)` | `routes/webhook.route.ts:66-1577` | Ingress WAHA: signature, tenant, ACK/revoke/reaction/edit, inbound/outbound, label, media, queue | `app.ts:182` |
| `wabaWebhookRoutes(fastify)` | `routes/waba-webhook.route.ts:19-508` | Ingress WABA: verify token, HMAC raw body, status, tenant per phone_number_id, media, queue | `app.ts:183` |
| `healthRoutes(fastify)` | `routes/health.route.ts:5-60` | `/health` liveness, `/ready` DB+WAHA readiness | `app.ts:186`, orchestrator |
| `verifyMetaSignature` | `integrations/whatsapp/signature.ts` | HMAC SHA-256 Meta, strict fail-closed | WABA route |
| `normalizeWabaPayload` / `normalizeWabaStatuses` | `integrations/whatsapp/normalizer.ts` | Normalisasi payload Meta | WABA route |
| `wahaTenantService.resolveTenantBySession` | `services/waha-tenant.service.ts` | Resolusi tenant dari session WAHA (fail-closed; fallback DB offline) | WAHA route |
| `wabaTenantService.resolveTenantByPhoneNumberId` | `services/waba-tenant.service.ts` | Resolusi tenant dari phone_number_id | WABA route |
| `queueService.enqueueMessage` | `services/queue.service.ts` | Enqueue pesan ke BullMQ/in-memory | Kedua route |
| `burstCoalesceService.maybeCoalesce` / `flushAll` | `services/burst-coalesce.service.ts` | Gabung burst pesan text | Kedua route, shutdown |
| `contextStorage.run` | `utils/context.ts` | Correlation ID per request | Kedua route |
| `getTenantEchoPatterns` | `services/capi.service.ts` | Pola echo bot per tenant dari DB | Outbound WAHA |
| `startBackgroundCrons` | `lifecycle/background-crons.ts` | Registrasi cron/sweep | `app.ts` (monolith), `worker.ts` |
| `registerShutdownHooks` | `lifecycle/shutdown.ts` | Graceful shutdown app | `app.ts` main |

---

## E. LOGIKA YANG DITULIS SENDIRI (BERPOTENSI DUPLIKAT)

| Logika generik | Lokasi di modul ini | Duplikat/kandidat | Catatan |
|---|---|---|---|
| Pipeline ingress pesan | `webhook.route.ts` (1.577 baris) | `waba-webhook.route.ts` (508 baris) | Stale guard, bypass, scope gate, human handling, media, turn, queue ditulis dua kali. |
| Stale message guard | `webhook.route.ts:892-946` | `waba-webhook.route.ts:231-266` | Ambang & perilaku mirip; satu berubah, yang lain bisa tertinggal. |
| Bypass label admin | `webhook.route.ts:1094-1139` | `waba-webhook.route.ts:306-334` | Duplikasi penuh. |
| AI scope gate + human handling | `webhook.route.ts:1217-1493` | `waba-webhook.route.ts:391-426` | Duplikasi alur. |
| Media inbound/outbound | `webhook.route.ts:775-867`, `1008-1092` | `waba-webhook.route.ts:169-207` | Penanganan media berbeda; WABA hanya image. |
| Turn persist + enqueue | `webhook.route.ts:1547-1572` | `waba-webhook.route.ts:471-495` | Duplikasi. |
| Idempotensi pesan | `webhook.route.ts:750-755` | `waba-webhook.route.ts:163-167` | Sama-sama memakai `isDuplicateMessage` yang menulis memory claim. |
| Inisialisasi tenant saat boot | `app.ts:241-267` | `worker.ts:90-110` | Duplikasi 5 langkah init. |
| Resolusi tenant | `waha-tenant.service.ts` | `waba-tenant.service.ts` | Dua resolver berbeda provider; wajar, tetapi pola cache/fallback bisa disatukan. |
| Echo detection | `webhook.route.ts:368-379` | `capi.service.getTenantEchoPatterns` | Literal hardcoded + pola DB bercampur. |
| Signature verification | `whatsapp/signature.ts` (HMAC) | `webhook.route.ts:80-88` (shared secret) | Dua mekanisme auth provider; wajar, tetapi policy error/log bisa disatukan. |

---

## F. FILE DI MODUL INI YANG BELUM DIBACA

**Tidak ada.** Seluruh 5 file modul ini sudah dibaca penuh (2.588 baris).

**Dependensi luar modul yang dibaca sebagian (bukan klaim audit penuh):**
`signature.ts` (penuh), `waha-tenant.service.ts` (bagian resolver), `waba-tenant.service.ts` (bagian resolver), `message.service.ts` (bagian idempotensi), `queue.service.ts` (bagian enqueue), `burst-coalesce.service.ts` (bagian flush), `lifecycle/shutdown.ts` (urutan), `customer.service.ts` (`setLabelFlags`), test ingress terkait.

---

## G. PENYIMPANAN HASIL

Laporan ini disimpan di:

`docs/MODULE_AUDIT_05_INGRESS.md`

Tidak ada file source yang diubah selama audit.

---

## LAMPIRAN 1 — TEST COVERAGE

| Area | Test |
|---|---|
| WAHA webhook | `tests/integration/waha-webhook.test.ts`, `webhook-non-personal-filter.test.ts`, `robustness.test.ts` |
| WABA webhook | `tests/integration/waba-webhook-route.test.ts` (signature, tenant routing, status, media, blocked, GPS) |
| Label event | `tests/integration/label-events.test.ts` (default tenant) |
| Echo tenant | `tests/unit/webhook-echo-tenant.test.ts` (pola DB, bukan literal) |
| Auth access log | `tests/integration/auth-access-log.test.ts` |
| Queue stale state | `tests/integration/queue-stale-state.test.ts` |
| Build app / health | Berbagai test integrasi `buildApp` |

**Gap test:** belum ada test label event tenant B, idempotency saat enqueue gagal, dan `/ready` untuk WABA-only.

---

## LAMPIRAN 2 — REKOMENDASI URUTAN PERBAIKAN (TANPA EKSEKUSI)

| Urutan | Temuan | Alasan | Gate regresi |
|---:|---|---|---|
| 1 | ING-01 | Cross-tenant label write | Test dua tenant label event |
| 2 | ING-02 | Potensi pesan hilang | Test enqueue throw + retry |
| 3 | ING-03 | Echo hardcoded memicu eskalasi salah | Test tenant B echo |
| 4 | ING-04, ING-05, ING-06 | Security & boot readiness | Test trustProxy/error handler/init gate |
| 5 | ING-07, ING-08, ING-09 | Tenant WAHA client, readiness, outbound log | Integration multi-tenant + readiness |
| 6 | ING-10, ING-11, ING-12 | Duplikasi pipeline/init/shutdown | Refactor bertahap + full suite |
| 7 | ING-13–ING-18 | Kebersihan & test gap | Full suite |

**Catatan:** rekomendasi di atas belum dieksekusi. Sesuai instruksi, audit berhenti di sini dan menunggu perintah modul berikutnya.
