# Revisi Plan: Notifikasi WhatsApp, AI Clinic Copilot & Operasional LiveChat

> Dokumen ini **menggantikan** plan 6-fase awal (audit 2026-09-27). Status: PLAN, belum dieksekusi.
> Bahasa: Indonesia. Semua data bisnis tetap dari DB (non-hardcode).

## 0. Keputusan Gate (TERKUNCI 2026-09-27)

- **G1 = A sekarang, B nanti WAHA-only.** Watchdog dibangun sebagai ekstensi pipa Telegram pagi
  yang sudah ada (`DailyReportService` + `DailyReportLog`). Opsi B (WA ke nomor admin) ditunda dan
  **hanya bila provider tenant = WAHA** — WABA proaktif di luar 24h window diblokir
  (`WABA_OUTSIDE_WINDOW`, `src/services/live-chat.service.ts:440-451`) dan butuh template HSM.
  Kontrak: `provider==='WABA'` → skip WA, fallback Telegram + in-app, log `SKIPPED_WABA`.
  Notif in-app (toast SSE `useLiveChatNotification.ts`, Web Push `web-push.service.ts`,
  tabel `PushSubscription`) independen dari kanal dan tetap muncul.
- **G2 = B minimal.** Brief ke Telegram pribadi bidan berisi: jam, nama pasien + usia anak,
  layanan, terapis sesi lalu, `admin_notes` (tanpa alamat lengkap). Nomor HP tetap
  disembunyikan (lanjutkan `staff-notification.service.ts:73-74`). Alamat lengkap + GPS hanya
  di portal `StaffToday.tsx` (login staf).
- **G3 = B kontekstual.** Copilot mulai sebagai panel kontekstual (di modul LiveChat), bukan
  drawer global `Layout.tsx`. Bukan sekadar UI: butuh endpoint + audit + rate-limit + budget
  token + validator grounding sebelum naik ke global.

## 1. Peta dependensi

```
Gate0 (G1/G2/G3 terkunci)
 └─ Fase 1r: skema + NotificationDeliveryService
     ├─ Fase 3+4 (gabung): /notes anti-bocor + pulse state-based
     │   ├─ Fase 2r: watchdog ekstensi Telegram (butuh 1r; disarankan sesudah 3+4)
     │   └─ Fase 6r: copilot 2-tool (butuh 1r + 3+4)
     └─ Fase 5r: pre-visit brief (butuh 1r + 3+4 untuk notes fresh)
```

Fase 3+4 digabung: sama-sama menyentuh `sendAdminReply`
(`src/services/live-chat.service.ts:322-634`) dan `LiveChatMonitor.tsx` (6089 baris).
Satu owner, sekuensial — cegah clobber paralel (cf. KNOWN_ISSUES #138).

## 2. Aturan global semua fase

1. **Migrasi:** DILARANG `npx prisma db push`. Wajib `npx prisma migrate dev --name <nama>`,
   lalu drift check harus kosong:
   `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`
   → `-- This is an empty migration.` `prisma generate` full engine (bukan `--no-engine`/P6001).
   DLL terkunci → hentikan `npm run dev` dulu. Fresh-env `relation "children" already exists` →
   `npx prisma migrate resolve --applied 20260802000000_add_children` sekali.
2. **Tanpa dep runtime baru.** Scheduler = pola `trackInterval` + cek jam WIB (`src/app.ts:319-384`).
3. **Tenant-aware:** semua query/log sertakan `tenant_id` (`src/config/tenant.ts:1`); ambil via
   `(request as any).tenantId`. Setiap PUT/POST admin → `auditService.logAdminAction`
   (`src/services/audit.service.ts:16-24`).
4. **Anti-hafalan:** guard pada state (`session_data`, `is_human_handling`, status reservasi),
   bukan `msg.includes(...)`. Regex hanya sanitasi non-semantik.
5. **Nomor:** reuse `normalizePhoneToE164` (`src/services/capi.service.ts:41-50`); kirim hanya via
   `resolveGatewayForTenant` (`src/integrations/whatsapp/factory.ts:13-42`).
6. **Test offline:** `tests/setup.ts` mock Prisma → in-memory repo. Fitur baru wajib graceful
   offline + uji adversarial multi-parafrase.
7. **UI:** tanpa `window.confirm/alert`, pakai `useUiFeedback`. Ubahan dashboard → rebuild +
   restart bot. Uji WA nyata = nomor sandbox dulu.
8. **Buku wajib:** baca `CHANGELOG.md` sebelum fase, tulis sesudah; temuan tunda →
   `docs/KNOWN_ISSUES.md`.

---

## FASE 1r: Fondasi skema + NotificationDeliveryService

**🎯 Goal:** satu pipa notifikasi tenant-aware + log idempoten. Ukur: 0 nomor/config di `.ts`.

**⚠️ Traps:** tabel log ganda; log tanpa unique = spam ganda saat restart; field baru butuh
fallback memory-store; suffix `@c.us` belum terverifikasi (lewat gateway factory saja).

**🔄 Flow:** `interval → deliveryService.send() → gateway tenant → tulis log (unique) → UI baca log`.

**🛠️ Micro-tasks:**

- **1r.1 Skema** (`prisma/schema.prisma`; Tenant `:622-676`, DailyReportLog `:731-742`):
  - G1=A: perluas `DailyReportLog`: `channel String @default("TELEGRAM")`,
    `notification_type String @default("DAILY_OPS")`. (Opsi B kelak: `AdminNotificationLog`
    terpisah dengan `@@unique([tenant_id, notification_type, report_date])`.)
  - `Tenant`: `admin_whatsapp_numbers String[] @default([])`,
    `nightly_report_enabled Boolean @default(false)`, `nightly_report_hour Int @default(21)`
    (default OFF agar tidak spam pasca-migrate).
  - `Customer`: `admin_notes String? @db.Text`, `notes_updated_at DateTime?`,
    `notes_updated_by String?`.
  - `Conversation`: `is_frustrated Boolean @default(false)`, `frustrated_at DateTime?`,
    `frustrated_reason String?` + `@@index([tenant_id, is_frustrated, last_message_at])`.
- **1r.2 Migrasi:**
  ```bash
  npx prisma migrate dev --name notif_foundation
  npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
  npm run prisma:generate
  npm run build
  ```
- **1r.3 Service baru** `src/services/notification-delivery.service.ts`:
  `send({tenantId, channel, recipient, type, title, messageContent, metadata})` → normalisasi
  E.164 → gateway factory → tulis log; tangkap P2002 sebagai "sudah terkirim" (idempoten);
  return `{success, logId, error?}`; selalu tulis FAILED + `error_message`, tidak throw ke cron.
- **1r.4 Fallback memory:** update in-memory repository customer/conversation agar field baru
  tidak crash saat test offline.

**✨ Deliverable:** tabel + service ada, belum ada cron pemakai.

**🚦 Acceptance & regresi:** `npx vitest run tests/unit/` hijau; test baru: isolasi tenant,
normalisasi (`0812…`/`+62 812…`/`62812…` → `62812…`), restart ganda tidak dobel-kirim; `tsc` 0 error.

---

## FASE 3+4 (gabung): `/notes` anti-bocor + pulse state-based

**🎯 Goal:** koordinasi shift tanpa bocor ke WA; badge butuh-respon padam hanya saat balasan
nyata terkirim. Ukur: 0 call gateway pada `/notes`; `/notes` tidak padamkan pulse.

**⚠️ Traps:** `createMessage` vs `logMessage` (SSE + side-effect MQL/follow-up hanya di
`logMessage`, `src/services/message.service.ts:321-440`); lock global = inverse-leak;
`INTERNAL_NOTE` bocor ke konteks AI/unread/export; detektor keyword DITOLAK; re-sort rusak
pagination offset.

**🔄 Flow:** `sendAdminReply → jika /notes: validasi → logMessage(INTERNAL_NOTE) → return
SEBELUM gateway → else: gateway → sukses? reset frustrasi : jangan reset`.

**🛠️ Micro-tasks:**

- **34.1 Gate `/notes`** di `sendAdminReply` (setelah destructure `:345`, sebelum hash `:351`):
  deteksi `^/notes(\s|$)` case-insensitive (toleransi spasi depan; `/NOTES`, `/Notes` ikut).
  `cleanNote` kosong → `EMPTY_NOTE`. Simpan via **`logMessage`**
  (`direction: OUTBOUND, senderType: 'INTERNAL_NOTE'`, `skipMqlEvaluation: true`, tanpa
  `waMessageId`). Return `{success:true, isInternal:true}` TANPA `resolveGatewayForTenant`,
  media, retry, CAPI, escalation. Audit `INTERNAL_NOTE_CREATED`.
- **34.2 Eksklusi konsumen:** `isAwaitingReply` (`:959-969`), unread batch, preview list,
  `generateAiSuggestion` (`:1081-1115`, filter `!= INTERNAL_NOTE`), export, CAPI
  checkout-check (`:600-624`, skip bila internal).
- **34.3 Lock per-conversation** di composer: state milik conversation aktif; pindah
  conversation → reset normal. Lock global dilarang.
- **34.4 Endpoint** `PATCH /api/admin/customers/:id/notes` (`customers.subroute.ts`,
  dekat `:863-943`): `{notes max 2000}`, tulis
  `admin_notes/notes_updated_at/notes_updated_by(adminIdentity)`, audit
  `UPDATE_CUSTOMER_NOTES`. UI: sticky banner + inline edit + toast.
- **34.5 Detektor state-based** (ganti keyword): modul baru
  `src/services/frustration-signal.service.ts` — skor dari waktu tanpa ADMIN-reply > SLA +
  durasi `is_human_handling` + `consecutive_unknown_count`. Hook di seam pesan-masuk terpusat
  (cakup WAHA + WABA). Set `is_frustrated/frustrated_at/frustrated_reason='SLA_BREACH'`.
- **34.6 Reset:** hanya bila `sendResult.success===true` DAN `logged.senderType==='ADMIN'`
  → `is_frustrated=false`. BOT/INTERNAL/gagal → jangan reset.
- **34.7 UI:** badge + border rose bila `is_frustrated`, tanpa re-sort, tanpa pulse massal.

**✨ Deliverable:** bubble kuning gembok + banner sticky + badge merah yang padam hanya
saat balasan nyata.

**🚦 Acceptance & regresi:** adversarial `/notes`, `/NOTES`, `  /notes  x`, `/notesX`
(bukan note), `/notes`+gambar, teks biasa tetap terkirim; `/notes` → 0 call gateway + tetap
SSE; pulse: SLA breach → flag; ADMIN-sukses → padam; BOT/INTERNAL/gagal → tetap;
full suite + `tsc` hijau.

---

## FASE 2r: Watchdog ekstensi Telegram (G1=A)

**🎯 Goal:** 0 dropped-lead. Ukur: laporan 21:00 terkirim 1x/hari/tenant + terpantau di UI.

**⚠️ Traps:** cron-string vs `trackInterval`; boundary WIB; link `localhost` bocor;
definisi "belum dibalas" ganda; cost LLM. (Opsi B WA-only ditunda — lihat G1.)

**🛠️ Micro-tasks:**

- **2r.1 Agregasi** di `daily-report.service.ts` (reuse boundary `:256-279`): confirmed-besok,
  stalled (state `session_data`/`last_discussed_treatment`, tanpa keyword), unreplied
  (definisi kanonis `isAwaitingReply`), ringkasan LLM 20 pesan via `llm-gateway` + audit +
  fallback.
- **2r.2 Scheduler** di `app.ts` (pola `:319-343`): cek jam WIB + `lastNightlyRunDate`;
  kirim via `NotificationDeliveryService`; idempoten via unique log.
- **2r.3 API** `settings.subroute.ts`: GET/PUT notifications (tenant-scoped + audit),
  POST test (sandbox), GET logs, POST resend FAILED.
- **2r.4 UI** `DailyReportPanel.tsx`: kartu nomor/jam/toggle + tabel log + modal + resend
  via `useUiFeedback`; rebuild dashboard.

**🚦 Acceptance & regresi:** boundary WIB teruji; restart 21:05 tidak dobel; 5+ parafrase
per kategori cocok DB; full suite hijau.

---

## FASE 5r: Pre-visit brief (G2=B minimal)

**🎯 Goal:** bidan siap 30 mnt sebelum sesi. Ukur: brief tiba 1x, `admin_notes` fresh.

**🛠️ Micro-tasks:**

- **5r.1** Perluas `staff-notification.service.ts` (bukan service baru):
  `buildPreVisitBrief(reservationId)` — reservasi + customer +
  `childService.getChildrenWithCurrentAge` + reservasi terakhir + `admin_notes`;
  usia null → "Usia belum tercatat". Isi minimal sesuai G2 (tanpa nomor/alamat lengkap).
- **5r.2** Cron 10 mnt (jendela now+20..35) + trigger langsung saat confirmed bila sisa
  <35 mnt; flag terkirim anti-dobel; kanal Telegram `staff.telegram_chat_id`.
- **5r.3** Kartu "📋 Ringkasan Pasien" di `StaffToday.tsx` (alamat penuh hanya di sini).

**🚦 Acceptance:** H-30 tiba; same-day H-15 tiba 1x; null-age tidak crash; catatan baru
terbaca; full suite hijau.

---

## FASE 6r: Copilot sempit (G3=B kontekstual)

**🎯 Goal:** jawab dari DB + deep-link chat. Ukur: jawaban ⊆ DB, link valid.

**🛠️ Micro-tasks:**

- **6r.1** `src/services/copilot/copilot-tools.ts` — 2 tool dulu:
  `query_reservations_by_filter` + `query_unreplied_chats` (`take:20`, tenant-scoped).
  Tunda offers/stalled hingga definisi state-nya lolos review (tanpa `LIKE '%harga%'`).
- **6r.2** `copilot.service.ts` — tool-call via `llm-gateway` + audit + budget; anchor tanggal
  WIB server-side; `[]` → "tidak ditemukan"; post-validator nama/HP ⊆ hasil tool.
- **6r.3** `POST /api/admin/copilot/chat` — auth + tenant + rate-limit + audit + cap history
  10 turn.
- **6r.4** Panel kontekstual LiveChat dulu (lazy-load); global hanya bila terbukti dipakai.

**🚦 Acceptance:** 5+ parafrase tanggal resolve benar; kosong → jujur; link → buka chat;
cost di `LlmAuditLog`; full suite hijau.

## Matriks

| Fase | Mitigasi kritis | Kepatuhan |
|---|---|---|
| 1r | unique idempoten, migrate, reuse E.164/gateway | Tenant-aware, zero-dep |
| 3+4 | gate sebelum gateway, lock per-conv, state bukan keyword | Anti-bocor, anti-overfitting |
| 2r | interval+guard, boundary WIB, definisi kanonis | Data-driven |
| 5r | reuse usia/notif, idempoten, privasi G2 | Integritas klinis |
| 6r | validator grounding kode, budget, rate-limit | Anti-halusinasi |
