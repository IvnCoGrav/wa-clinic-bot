# IMPLEMENTATION PLAN: Fase F3.2 — Modul 12 Follow-Up & Staff Notification (FN-01..FN-12)

**Tanggal:** 2026-11-09 (koreksi metrik: 2026-11-10)  
**Branch:** `master`  
**Prasyarat:** F3.1 Selesai (Commit `11e7ce37`), Working Tree Clean.  
**Koreksi 2026-11-10:** metrik baris diselaraskan dengan kode aktual pasca-F3.1: `follow-up.service.ts` **2.898** baris (bukan 2.682), `staff-notification.service.ts` **1.101** (bukan 993), `(prisma as any)` shareloc **10** (bukan 15). Line-range final ekstraksi WAJIB diverifikasi di micro-task pertama sebelum memindahkan kode.  
**Tujuan:** Menuntaskan seluruh 10 temuan tersisa pada Modul 12 Follow-Up & Staff Notification (`FN-01`, `FN-03`, `FN-04`, `FN-06`, `FN-07`, `FN-08`, `FN-09`, `FN-10`, `FN-11`, `FN-12`), memecah God Object menjadi modul terfokus <1.500 baris dengan facade backward-compatible, menjamin isolasi tenant pada throttling alert, membatasi memori in-memory, dan menstandarkan transaksi atomik.

---

## 1. Analisis Akar Masalah (Root Cause Audit)

| Kode | Severity | Lokasi File & Baris | Akar Masalah Sistemik | Solusi Fondasional |
|---|---|---|---|---|
| **FN-01** | Tinggi | `src/services/follow-up.service.ts:1-2898` | God Object 2.898 baris menggabungkan template CRUD, admin listing, reservation triggers, execution engine, cron process, dan dormant winback. | Pecah menjadi 3 sub-service domain: `follow-up-template.service.ts`, `follow-up-lifecycle.service.ts`, dan `follow-up-engine.service.ts`. File utama `follow-up.service.ts` dipertahankan sebagai facade backward-compatible (<700 baris). |
| **FN-03** | Tinggi | `src/services/staff-notification.service.ts:1-1101` | Menggabungkan format pesan Telegram, Web Push dispatch, pre-visit brief, dan agregasi briefing pagi. | Ekstrak formatting pesan ke `src/services/staff-notification-formatter.service.ts` sehingga logic dispatch murni terpisah dari presentasi teks. |
| **FN-04** | Sedang | `src/services/notification-delivery.service.ts:40` | `memoryNotificationLogs` berupa array in-memory `any[]` tanpa batas kapasitas (*unbounded*). | Terapkan batas kapasitas FIFO (`MAX_MEMORY_LOGS = 500`) dan definisikan interface `NotificationMemoryEntry`. |
| **FN-06** | Sedang | `src/services/follow-up.service.ts:151-2898` | 15 method publik memakai default `tenantId: string = DEFAULT_TENANT_ID` tanpa log penanda saat fallback digunakan. | Jadikan `tenantId` parameter wajib di sub-service baru; pada facade, pasang audit log jika pemanggil membiarkan tenantId kosong/default. |
| **FN-07** | Sedang | `src/services/alert.service.ts:79-84` | Key cooldown alert `${payload.type}:${payload.provider}` tidak menyertakan `tenantId`, sehingga alert tenant A dapat memicu throttling alert tenant B. | Sertakan `tenantId` pada key throttling: `${tenantPrefix}:${payload.type}${provider}`. |
| **FN-08** | Sedang | `src/services/web-push.service.ts:35` | Subjek email VAPID ter-hardcode ke `'mailto:admin@kala-clinic.com'` bila ENV kosong. | Ganti fallback default menjadi `mailto:admin@localhost` atau baca dari konfigurasi generik sistem. |
| **FN-09** | Rendah | `src/services/shareloc-reminder.service.ts:46-332` | Penggunaan berulang type-cast `(prisma as any)` pada model Prisma yang valid (`quickReply`, `clinicPolicy`, `reservation`, `conversation`, dll). | Hapus seluruh cast `(prisma as any)` dan gunakan model Prisma ter-ketik secara kuat. |
| **FN-10** | Rendah | `src/services/shareloc-reminder.service.ts:281-306` | Dual-write `session_data.shareloc_requested_at` dan `preferences.share_location_requested_at` dilakukan tanpa DB transaction. | Bungkus kedua mutasi update ke dalam `prisma.$transaction([ ... ])` agar atomik. |
| **FN-11** | Rendah | `src/config/staff-chat-config.ts:10-14, 82-84` | Fallback jam operasional staf 07:00 - 21:00 WIB tidak memberikan log penanda saat DB config kosong; blok catch kosong. | Tambahkan `console.warn` pada blok catch dan `console.info` saat menggunakan default fallback. |
| **FN-12** | Rendah | `src/services/web-push.service.ts:33` | Map `memorySubscriptions` tidak memiliki mekanisme pembatasan kapasitas atau pembersihan berkala. | Terapkan batas kapasitas maksimal FIFO (`MAX_MEMORY_SUBSCRIPTIONS = 1000`) dan pruning entry yang tidak aktif. |

---

## 2. Tahapan Eksekusi Berurutan (Staged Phases & Micro-Tasks)

```
┌────────────────────────────────────────────────────────┐
│ Sub-Fase F3.2a: Pemecahan God Object (FN-01, FN-03)    │
│ -> FollowUp Sub-Services & Formatter Extraction        │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ Sub-Fase F3.2b: Multi-Tenant Cooldown & VAPID (FN-06..08)│
│ -> Alert Isolation, Dynamic VAPID, Tenant Audit Log    │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ Sub-Fase F3.2c: Durability, Atomicity & Type (FN-04,09..12)│
│ -> Bounded Memory, $transaction, 0 "as any", Log Warn  │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ Regression Gate: Build, Security Scan, Full Test Suite │
└────────────────────────────────────────────────────────┘
```

### Sub-Fase F3.2a: Pemecahan God Object Follow-Up & Staff Notification (`FN-01`, `FN-03`)
1. **Micro-Task F3.2a.1 (TDD Red Test):**
   - Buat `tests/unit/follow-up-services-split.test.ts`:
     - Verifikasi ekspor dan fungsi `followUpTemplateService` (getAllTemplates, saveTemplate, resetTemplate).
     - Verifikasi ekspor dan fungsi `followUpLifecycleService` (onReservationCreated, onReservationCancelled, createNoPurchase, winback).
     - Verifikasi ekspor dan fungsi `followUpEngineService` (executeFollowUp, sendNow, processDueFollowUps).
     - Verifikasi `followUpService` mendelegasikan pemanggilan dengan mulus tanpa mengubah kontrak publik lama.
   - Buat `tests/unit/staff-notification-split.test.ts`:
     - Verifikasi ekspor helper pemformat pesan di `staff-notification-formatter.service.ts`.
2. **Micro-Task F3.2a.2 (Implementasi Ekstraksi Follow-Up):**
   - **Line-range aktual (verifikasi ulang sebelum memindahkan kode):**
     | Domain | Range `follow-up.service.ts` |
     |---|---|
     | Template CRUD (`getAllTemplates`, `saveTemplate`, `resetTemplate`) | `152-243` |
     | Admin listing (`listFollowUps`) | `244-409` |
     | Lifecycle (no-purchase, reservation created/cancelled/rescheduled, next-treatment) | `410-1317` |
     | Engine (sendNow, retry, queue, processDue, execute, WABA) | `1318-2542` |
     | Winback & reconciler (dormant, lost customers, orphaned) | `2543-2898` |
   - Buat `src/services/follow-up-template.service.ts` (~250 baris):
     - Pindahkan `FOLLOWUP_ROLLING_TEMPLATES`, `getAllTemplates`, `saveTemplate`, `resetTemplate`.
   - Buat `src/services/follow-up-lifecycle.service.ts` (~700 baris):
     - Pindahkan logika trigger reservasi (`onReservationCreated`, `createReservationFollowUps`, `onReservationCancelled`, `onReservationRescheduled`), no-purchase (`createNoPurchaseFollowUps`, `rescheduleNoPurchaseOnInboundChat`), next-treatment, dan dormant winback.
   - Buat `src/services/follow-up-engine.service.ts` (~800 baris):
     - Pindahkan eksekusi pengiriman (`executeFollowUp`, `executeFollowUpWaba`, `processDueFollowUps`, `sendNow`, `retryFollowUp`, `queueFollowUp`, `bulkQueueFollowUps`, resolusi milestone & honorific).
   - Refactor `src/services/follow-up.service.ts` (<700 baris):
     - Mengimpor ketiga sub-service dan mendelegasikan seluruh method publik lama agar backward-compatible 100%.
3. **Micro-Task F3.2a.3 (Implementasi Ekstraksi Staff Notification):**
   - Buat `src/services/staff-notification-formatter.service.ts` (~350 baris):
     - Format pesan Telegram untuk tugas penugasan, pre-visit brief, pembatalan, dan morning briefing.
   - Refactor `src/services/staff-notification.service.ts` (<550 baris):
     - Memakai formatter terpisah dan fokus pada dispatching, Web Push, dan pairing token.
4. **Verifikasi Gate F3.2a:**
   - Jalankan `npx vitest run tests/unit/follow-up-services-split.test.ts tests/unit/staff-notification-split.test.ts`.
   - Jalankan seluruh test eksisting follow-up & staff-notification: `npx vitest run tests/unit/followup-atomic-claim.test.ts tests/unit/staff-telegram-notification.test.ts`.
   - Pastikan kedua file utama berukuran <1.500 baris.

---

### Sub-Fase F3.2b: Multi-Tenant Alert Cooldown & Dynamic VAPID (`FN-06`, `FN-07`, `FN-08`)
1. **Micro-Task F3.2b.1 (TDD Red Test):**
   - Buat `tests/unit/fn-multitenant-cooldown-vapid.test.ts`:
     - Test throttling alert: pastikan alert dari tenant `'tenant-a'` TIDAK mengaktifkan throttling pada alert dari `'tenant-b'`.
     - Test subjek VAPID: pastikan subjek tidak memuat hardcode `'admin@kala-clinic.com'` bila ENV kosong.
     - Test follow-up tenant audit log: panggil method followUpService tanpa parameter tenantId dan verifikasi peringatan tercatat.
2. **Micro-Task F3.2b.2 (Implementasi Alert & VAPID Multi-Tenant):**
   - Edit `src/services/alert.service.ts:79-84`:
     - Ubah `getCooldownKey(payload: AlertPayload)`:
       ```ts
       const tenantPrefix = payload.tenantId || 'global';
       if (payload.type === AlertType.THIRD_PARTY_OUTAGE && payload.provider) {
         return `${tenantPrefix}:${payload.type}:${payload.provider}`;
       }
       return `${tenantPrefix}:${payload.type}`;
       ```
   - Edit `src/services/web-push.service.ts:35`:
     - Ganti default `vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@localhost'`.
   - Edit `src/services/follow-up.service.ts`:
     - Tambahkan log penanda jika pemanggil tidak mengirimkan `tenantId` eksplisit.
3. **Verifikasi Gate F3.2b:**
   - Jalankan `npx vitest run tests/unit/fn-multitenant-cooldown-vapid.test.ts`.

---

### Sub-Fase F3.2c: Durability, Atomicity & Type Safety (`FN-04`, `FN-09`, `FN-10`, `FN-11`, `FN-12`)
1. **Micro-Task F3.2c.1 (TDD Red Test):**
   - Buat `tests/unit/fn-memory-bounds-transaction.test.ts`:
     - Test `notification-delivery.service.ts`: masukkan 600 entri ke `memoryNotificationLogs`, verifikasi array dibatasi hingga maksimal 500 entri (FIFO).
     - Test `web-push.service.ts`: masukkan lebih dari 1000 subscription, verifikasi ukuran map dibatasi (FIFO).
     - Test `shareloc-reminder.service.ts`: verifikasi pemanggilan `prisma.$transaction` saat memperbarui percakapan dan profil customer.
2. **Micro-Task F3.2c.2 (Implementasi Bounded Memory & Transaksi):**
   - Edit `src/services/notification-delivery.service.ts`:
     - Definisikan interface `NotificationMemoryLog` dan batas `MAX_MEMORY_LOGS = 500`.
     - Lakukan `shift()` bila panjang melebihi kapasitas.
   - Edit `src/services/web-push.service.ts`:
     - Pasang `MAX_MEMORY_SUBSCRIPTIONS = 1000` dan hapus entri tertua jika kapasitas terlampaui.
   - Edit `src/services/shareloc-reminder.service.ts`:
     - Ganti 10 baris `(prisma as any)` dengan `prisma.quickReply`, `prisma.clinicPolicy`, `prisma.reservation`, `prisma.conversation`, `prisma.customer`, `prisma.adminNotificationLog`.
     - Bungkus pembaruan session_data dan preferences dalam `prisma.$transaction([ ... ])`.
   - Edit `src/config/staff-chat-config.ts`:
     - Tambahkan log warning penanda pada blok `catch` dan info saat memakai fallback default operasional.
3. **Verifikasi Gate F3.2c:**
   - Jalankan `npx vitest run tests/unit/fn-memory-bounds-transaction.test.ts`.

---

## 3. Regression Gate & Acceptance Criteria

1. **Typecheck & Compile:** `npm run build` sukses dengan Exit Code 0 tanpa error TypeScript baru.
2. **Security Scan:** `npm run security:scan` lulus tanpa kebocoran rahasia.
3. **Targeted Test Suite:** Semua test baru dan eksisting Modul 12 lulus 100%:
   - `tests/unit/follow-up*.test.ts`
   - `tests/unit/staff*.test.ts`
   - `tests/unit/notification*.test.ts`
4. **Ukuran File (Mandat Arsitektur):**
   - `src/services/follow-up.service.ts` < 1.000 baris (turun dari 2.898 baris).
   - `src/services/staff-notification.service.ts` < 600 baris (turun dari 1.101 baris).
5. **Git Commit & Push:**
   - Commit: `fix(fn): complete Fase F3.2 - modularize follow-up & staff notification, tenant alert cooldown, bounded memory, atomic shareloc transaction (FN-01..FN-12)`.
   - Push ke `origin/master`.
