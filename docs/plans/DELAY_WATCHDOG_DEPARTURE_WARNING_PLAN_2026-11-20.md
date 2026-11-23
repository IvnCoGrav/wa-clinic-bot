# Implementation Plan — Peringatan Dini Keterlambatan Bidan (Departure Watchdog)

> **STATUS: DRAFT — BELUM DIEKSEKUSI.** Menunggu persetujuan tertulis manusia
> ("Setuju, eksekusi"). Tidak ada kode/migrasi/test yang diubah saat dokumen ini dibuat.
>
> **Dasar:** audit plan 2026-11-20 + 4 keputusan owner. Dokumen ini menggantikan
> plan awal (yang memuat duplikasi fitur, `wa.me` ke nomor pasien, dan `db push`).

---

## 0. Keputusan Terkunci (dari owner)

| # | Topik | Keputusan |
|---|---|---|
| 1 | Ambang "telat" | **Default 30 menit**, dapat diubah per tenant lewat setelan (bukan konstanta global baru) |
| 2 | Titik awal bidan | Diisi 4 koordinat rumah/base bidan dari data owner, **dapat diedit di Admin Dashboard** |
| 3 | Penerima pesan keterlambatan | **Nomor admin** yang diinput di Admin Dashboard (bukan nomor pasien) |
| 4 | Banner admin | **Cukup perluas** widget/badge yang sudah ada, tidak membuat banner/komponen baru |

**Konsekuensi keputusan #3 (penting):** SOP nomor HP pasien tetap utuh. Bidan
tidak pernah menerima nomor pasien; pesan eskalasi keterlambatan dikirim ke
nomor admin/CS melalui **nomor bot resmi**, lalu Admin/CS yang menghubungi Bunda
lewat Live Chat (seam yang sudah ada). Ini menutup temuan audit A-02.

---

## 1. Fakta Terverifikasi (bukan klaim)

| Fakta | Bukti (`file:line`) |
|---|---|
| Prediksi telat + level sudah ada | `src/services/staff-trip-tracking.service.ts:176-217` (`calculateDelayStatus`) |
| ETA sisa perjalanan sudah ada (1.25x, 25 km/jam, clamp 1–120) | `src/services/staff-trip-tracking.service.ts:352-369` |
| Itinerary berantai Klinik → Pasien 1 → Pasien 2 sudah ada | `src/services/staff-reservation.service.ts:641-720` |
| ETA kanonis untuk kartu staf (simbol dilarang diduplikasi) | `src/utils/travel-duration.ts:5-8` + `docs/MODULE_INDEX.md:25,148-154` |
| Template pesan telat sudah DB-driven + variasi | `src/services/staff-reservation.service.ts:1608-1645`; `src/config/followup-templates.ts:336-341` |
| Banner/badge admin sudah ada 3 lapis | `LiveChatDispatchWidget.tsx:165-188`; `LiveChatMonitor.tsx:817-834`; `useLiveChatSse.ts:543-571` |
| Titik awal rumah bidan belum ada | `prisma/schema.prisma:1035-1062` (`model Staff`) |
| Lokasi klinik sudah tenant-aware | `src/config/clinic-location.ts:50-78` (`Tenant.settings.clinicLocation`) |
| Setelan tenant punya jalur tulis + OCC | `src/config/tenant-settings.config.ts`; `src/routes/admin/settings-tenant.subroute.ts:52` |
| Ambang telat tenant-aware sudah ada (skor bidan) | `prisma/schema.prisma:1401-1419` (`StaffScorecardPolicy.tolerance_minutes=30`); resolver `staff-scorecard.service.ts:272-289` |
| Data staf **tidak** memuat nomor HP customer | `staff-reservation.service.ts:617` + masking `today.subroute.ts:195,316,1353` |
| `/api/admin/live-chat/*` **lolos** RBAC CS | `docs/KNOWN_ISSUES.md:69-70` |
| `/api/admin/dispatch` **tidak** di-scope untuk CS (67x 403) | `docs/KNOWN_ISSUES.md:77,132`; migrasi scope hanya `('/api/admin/dispatch/trip','GET')` |
| Cron trip sweep 15 menit + mutex sudah ada | `src/lifecycle/background-crons.ts:258-270` |
| Gateway WA kanonis + capability check | `src/integrations/whatsapp/gateway.types.ts:48-54`; `today.subroute.ts:1174` |
| Util normalisasi nomor kanonis | `src/utils/phone-normalizer.ts:4` (`normalizePhoneID`) |
| Dashboard tidak punya harness test UI | `packages/admin-dashboard/package.json` (tanpa vitest/jsdom/testing-library) |

**Baseline gerbang saat plan divalidasi:** `npm run typecheck` = 0 error;
`npm run check:reuse` = 189 pelanggaran (baseline 189, baru 0).

---

## 2. Non-Goals (dibuang dari plan awal)

1. **Tidak** membuat `DelayAlertPulseBanner.tsx` baru (cukup perluas yang ada).
2. **Tidak** memakai `wa.me` ke nomor pasien (SOP no-HP; tanpa audit).
3. **Tidak** menanam koordinat rumah bidan ke file migrasi yang di-commit.
4. **Tidak** memakai `npx prisma db push`; wajib migrasi ber-nama + `migrate deploy`.
5. **Tidak** memakai ambang 10/20 menit; memakai toleransi tenant (default 30).
6. **Tidak** memakai endpoint `GET /api/staff/today` (nama salah) — yang benar
   `GET /api/staff/today-tasks`.
7. **Tidak** memakai `LiveChatView.tsx` (tidak ada) — file nyata `LiveChatMonitor.tsx`.
8. **Tidak** menghitung ulang lateness di browser; keputusan dihitung server-side.
9. **Tidak** membuat halaman baru; semua UI masuk Tab/Modal/Section yang ada.

---

## 3. Kontrak Data & Konfigurasi

### 3.1 Skema (aditif, nullable)

```prisma
model Staff {
  // ... existing
  base_lat     Float?
  base_lng     Float?
  base_address String?
}

model Reservation {
  // ... existing
  /// Kapan bidan menginformasikan keterlambatan ke admin (idempoten, anti-spam).
  delay_notified_at DateTime?
}
```

### 3.2 Setelan tenant (`Tenant.settings.delayWatchdog`)

```ts
interface DelayWatchdogSettings {
  toleranceMinutes: number;      // default 30  (level "warning")
  criticalExtraMinutes: number;  // default 15  (level "critical" = tolerance + extra)
  maxPrevOriginGapHours: number; // default 3   (batas pakai alamat pasien sebelumnya)
  adminRecipients: string[];     // nomor admin/CS (E.164/08xx), maks 5
}
```

Disimpan di `Tenant.settings`, **bukan tabel baru** (pola `clinicLocation`).
Jalur tulis: `PATCH /api/admin/tenant-settings` (`settings-tenant.subroute.ts:52`)
melalui `updateTenantSettingsSafely` (OCC/versioning tidak diduplikasi).

### 3.3 Presedensi ambang (satu sumber)

```
Tenant.settings.delayWatchdog.toleranceMinutes
  ?? StaffScorecardPolicy.tolerance_minutes (via StaffScorecardService.getPolicy)
  ?? 30
```

`criticalMin = toleranceMinutes + criticalExtraMinutes` (default 45).
Tidak ada konstanta baru di `staff-trip-tracking.service.ts` untuk watchdog;
fungsi tersebut hanya menerima `opts.warnMin/criticalMin`.

### 3.4 Presedensi titik awal per leg

```
1) staff.base_lat/base_lng            -> originSource='staff_base'
2) Tenant.settings.clinicLocation     -> originSource='clinic'
3) koordinat pasien sebelumnya (jika leg ke-2+ dan masih dalam maxPrevOriginGapHours)
                                      -> originSource='prev_patient'
4) tidak ada dasar                    -> originSource='unknown' (jangan menuduh telat)
```

`originSource` ditambah anggota `'staff_base'` (union type di
`staff-trip-tracking.service.ts:263` + tipe UI `LiveChatDispatchWidget.tsx:29`).

### 3.5 Semantik level

| Kondisi | `level` | Tampilan |
|---|---|---|
| `delayMinutes <= 0` dan belum lewat deadline | `none` | normal |
| `0 < delayMinutes < tolerance` | `none` + `delayMinutes` | kartu amber **"potensi telat"** (bidan) |
| `delayMinutes >= tolerance` | `warning` | amber (admin) |
| `delayMinutes >= tolerance + criticalExtra` | `critical` | merah (admin) |

`delayMinutes` tetap dihitung `calculateDelayStatus` (tidak ada rumus baru).

---

## 4. Fase Implementasi (staged, micro-task)

### Fase 0 — Gate baseline (wajib hijau sebelum sentuh kode)

- [ ] `0.1` `npm run typecheck` → 0 error.
- [ ] `0.2` `npm run check:reuse` → baru 0 (baseline 189).
- [ ] `0.3` `npx vitest run tests/unit/staff-trip-arrival-and-delay.test.ts tests/unit/staff-trip-status-template.test.ts tests/unit/staff-task-data-minimization.test.ts` → hijau.
- **Stop** bila ada yang merah; laporkan, jangan lanjut.

---

### Fase 1 — Data, migrasi, konfigurasi

**1.1 Migrasi (additive only)**
- File: `prisma/migrations/20261120120000_add_delay_watchdog_base_and_notify/migration.sql`
- Isi:
```sql
ALTER TABLE "staff" ADD COLUMN "base_lat" DOUBLE PRECISION;
ALTER TABLE "staff" ADD COLUMN "base_lng" DOUBLE PRECISION;
ALTER TABLE "staff" ADD COLUMN "base_address" TEXT;
ALTER TABLE "reservations" ADD COLUMN "delay_notified_at" TIMESTAMP(3);
```
- **Dilarang** memasukkan baris koordinat di file migrasi (PII tidak masuk git).
- Acceptance: `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` → `-- This is an empty migration.`

**1.2 Schema + generate**
- `prisma/schema.prisma`: tambah field sesuai §3.1 (Staff + Reservation).
- `npm run prisma:generate` (JANGAN `--no-engine`).

**1.3 Setelan tenant**
- `src/config/tenant-settings.config.ts`:
  - tambah `DelayWatchdogSettings` + `delayWatchdog` di `TenantSettingsView`.
  - tambah `delayWatchdog?: Partial<DelayWatchdogSettings>` di `TenantSettingsPatch`.
  - validasi: `toleranceMinutes` 1–180, `criticalExtraMinutes` 0–120,
    `maxPrevOriginGapHours` 1–12, `adminRecipients` ≤5 & dinormalisasi
    `normalizePhoneID` (`src/utils/phone-normalizer.ts:4`). Nomor invalid → tolak patch.
- `src/config/delay-watchdog-config.ts` (baru): `getDelayWatchdogSettings(tenantId)`
  dengan presedensi §3.3 (baca DB, cache 5 menit, fail-safe ke default).
- Acceptance: test unit `tests/unit/delay-watchdog-config.test.ts` (default, override, nomor invalid, DB offline).

**1.4 Seeding koordinat (sekali jalan, bukan migrasi)**
- File skrip: `scripts/seed-staff-base-coordinates.ts` (di-commit, **tanpa** data).
- Sumber data lokal: `data/staff-base.local.json` (sudah gitignored via `data/`).
- Perilaku: validasi `staff.tenant_id`, tulis `base_lat/base_lng/base_address`,
  tulis `auditService.logAdminAction({ action: 'UPDATE_STAFF_BASE' })` dengan payload
  **tanpa** nomor HP; idempoten (skip bila nilai sama); `--dry-run` default.
- Acceptance: dry-run mencetak 4 baris "would update"; `--apply` → 4 baris berubah,
  audit log bertambah 4.

**1.5 Seed skor-policy & setelan tenant (default)**
- Tidak menulis paksa: bila `Tenant.settings.delayWatchdog` kosong, resolver memakai
  `StaffScorecardPolicy.tolerance_minutes` (sudah 30) → **tanpa** migrasi data.
- Acceptance: query resolver mengembalikan 30/15/3/[] untuk tenant default.

**Gerbang Fase 1:** `npm run typecheck` 0 error; `npx vitest run tests/unit/delay-watchdog-config.test.ts` hijau; drift check empty.

---

### Fase 2 — Domain murni (tanpa I/O)

File: `src/domain/delay-watchdog.ts` (baru)

- [ ] `2.1` `resolveLegOrigin(input): { lat, lng, originSource, originName } | null`
  - Input: `staffBase`, `clinicLocation`, `previousTask` (coords + `status` + `arrived_at` + `duration_minutes` + `booking_date`), `now`, `maxPrevOriginGapHours`.
  - Aturan: leg pertama → base → clinic; leg lanjutan → pasien sebelumnya **hanya jika**
    (`status === 'completed'` **atau** estimasi selesai `booking_date + duration + buffer <= now`)
    dan `now - estimasiSelesai <= maxPrevOriginGapHours`. Selain itu → base → clinic.
  - **Bukan** aturan "jeda <= 3 jam" naif; memakai state + durasi treatment.
- [ ] `2.2` `computeDepartureDeadline(bookingDate, etaMinutes, bufferMinutes)` → `Date | null`.
- [ ] `2.3` `predictTaskDelay({ bookingDate, etaMinutes, now, toleranceMinutes, criticalExtraMinutes })`
  - memanggil `calculateDelayStatus(bookingDate, etaMinutes, now, { warnMin, criticalMin })`.
  - mengembalikan `{ delayMinutes, level, estimatedArrivalIso, formattedArrivalWib, missedDeparture }`.
- [ ] `2.4` `etaMinutesTo(origin, destination)` → memakai `calculateTripProgress`
  (satu-satunya rumus ETA, tidak menulis formula baru).
- [ ] `2.5` Test `tests/unit/delay-watchdog-domain.test.ts` — wajib mencakup:
  - leg pertama tanpa `base` → clinic; tanpa clinic → `null` (fail-open).
  - pasien ke-2, treatment 1 belum selesai → **tidak** pakai alamat pasien 1.
  - pasien ke-2, treatment 1 selesai 20 menit lalu → pakai alamat pasien 1.
  - pasien ke-2, selesai 5 jam lalu → kembali ke base.
  - `delayMinutes` negatif (lebih awal) → level `none`.
  - `delayMinutes` 29/30/44/45 → `none+potensi` / `warning` / `warning` / `critical`.
  - jadwal `null` → `none` (fail-open, jangan menuduh telat).

**Gerbang Fase 2:** `npx vitest run tests/unit/delay-watchdog-domain.test.ts` hijau + `check:reuse` baru 0.

---

### Fase 3 — Service, endpoint, cron

**3.1 Service** — `src/services/staff-departure-watchdog.service.ts` (baru)
- `listTodayDelayAlerts(tenantId, now?)`:
  - **satu** `prisma.reservation.findMany` untuk hari ini (WIB) + `assigned_staff.base_*` +
    `customer_address`/`customer` coords + `duration_minutes` + `status` + `arrived_at` + `otw_sent_at`;
  - **satu** query `staff.findMany` untuk semua bidan yang bertugas (anti N+1);
  - urutkan per bidan per `booking_date`, hitung leg secara sekuensial (pola
    `staff-reservation.service.ts:656-719`);
  - kembalikan item: `{ reservationId, staffId, staffName, patientName, bookingDate,
    etaMinutes, delayMinutes, level, estimatedArrivalWib, missedDeparture,
    originSource, originName, delayText }`;
  - `delayText` dari `StaffReservationService.getTripDelayMessageText` (DB-driven).
- `notifyDelayToAdmin({ reservationId, staffId, tenantId, isSupervisor })`:
  - guard kepemilikan (pola `loadAuthorizedReservation`, `today.subroute.ts:683-709`);
  - ambil `adminRecipients`; kosong → `{ success:false, code:'ADMIN_RECIPIENTS_EMPTY' }`;
  - idempotensi: tolak bila `delay_notified_at` < 10 menit lalu
    (kecuali supervisor `force=true`);
  - kirim via `getGateway(tenantId).sendTextMessage(normalizePhoneID(nomorAdmin), text)`
    (`src/integrations/whatsapp/gateway.types.ts:54`); **tidak** memakai `wa.me`;
  - bila gateway WABA menolak di luar 24 jam → kembalikan
    `{ success:false, code:'WA_TEMPLATE_REQUIRED' }` (jangan klaim sukses);
  - sukses → update `delay_notified_at`, `auditService.logAdminAction`
    `action:'STAFF_DELAY_NOTIFY'` payload `{ reservationId, recipientCount }` (tanpa nomor).
- Acceptance: `tests/unit/staff-departure-watchdog.test.ts` + `tests/integration/staff-delay-notify.test.ts`.

**3.2 Payload staf** — `src/services/staff-reservation.service.ts`
- Tambah `delay?: { delayMinutes, level, estimatedArrivalWib, missedDeparture,
  originSource, originName }` ke `StaffTaskItem` (`:76-108`) — **tanpa** field phone.
- Isi dari service Fase 3.1 (dihitung **sekali** di `getTodayTasks`, bukan di route terpisah).
- Acceptance: test kontrak `tests/unit/staff-task-delay-payload.test.ts` + assert
  tidak ada `phone` di payload.

**3.3 Route staf** — `src/routes/staff/today.subroute.ts`
- `GET /api/staff/delay-template?reservationId=...` →
  `getTripDelayMessageText` (nama pasien dari server).
- `POST /api/staff/reservations/:id/notify-delay` → `notifyDelayToAdmin`
  (guard ownership + rate limit 5/menit + `bodyLimit 2KB`).
- Keduanya **tidak** mengembalikan nomor HP siapa pun (hanya `recipientCount`).
- Tambah `staff.delay_alert` ke `ALLOWED_STAFF_EVENTS`
  (`today.subroute.ts:1291-1302`) + filter kepemilikan seperti cabang telemetry.

**3.4 Endpoint admin** — `src/routes/admin/livechat.subroute.ts`
- `GET /api/admin/live-chat/delay-alerts` → `listTodayDelayAlerts(tenantOf(request))`.
- Alasan prefix: `/api/admin/live-chat/*` sudah di-scope untuk `admin_cs`/`spv_cs`
  (`KNOWN_ISSUES.md:69-70`). **Tidak** memakai `/api/admin/dispatch/*` agar
  tidak mengulang 403 (`KNOWN_ISSUES.md:77`).

**3.5 Cron** — `src/lifecycle/background-crons.ts`
- Flag `ENABLE_DELAY_WATCHDOG` (default **`false`** saat deploy pertama; dinyalakan
  setelah verifikasi staging).
- Interval `DELAY_WATCHDOG_INTERVAL_MINUTES` default `5`.
- Bungkus `createExclusiveCronTask('delay-watchdog', ...)` (mutex sudah ada di file).
- Iterasi tenant aktif (pola `staff:trip:tenants`/`tenant.findMany`), publish SSE
  `staff.delay_alert` **hanya untuk tenant tersebut** (hub sudah Redis pub/sub,
  `live-chat-hub.service.ts:39-43`).
- Dedupe lintas proses: `distributedKv` key `delay:alert:{tenant}:{reservationId}:{level}`,
  TTL 30 menit (mencegah spam setiap 5 menit).
- Batalkan/abaikan task yang `status` `completed/cancelled/rejected` atau `arrived_at` terisi.

**Gerbang Fase 3:** `npx vitest run tests/unit/staff-departure-watchdog.test.ts tests/integration/staff-delay-notify.test.ts tests/unit/staff-trip-*` hijau; `check:reuse` baru 0.

---

### Fase 4 — UI (perluas, bukan baru)

**4.1 Portal bidan** — `packages/admin-dashboard/src/pages/staff/StaffTodayTaskCard.tsx`
- Kartu amber tampil bila `task.delay.delayMinutes > 0 || task.delay.missedDeparture`.
- Teks: "⚠️ Potensi keterlambatan ±{n} menit" + alasan (ETA/origin).
- Tombol **"Infokan Keterlambatan ke Admin"** → Modal (bukan `window.confirm`):
  - ambil draf dari `GET /api/staff/delay-template` (DB-driven);
  - tampilkan penerima sebagai **jumlah** ("2 admin"), **tanpa nomor**;
  - konfirmasi → `POST .../notify-delay`; hasil sukses/gagal memakai `useUiFeedback`;
  - bila `ADMIN_RECIPIENTS_EMPTY` / `WA_TEMPLATE_REQUIRED` → tampilkan pesan jelas
    + tombol "Salin pesan" (tidak boleh silent-success).
- Animasi hanya `transition` ringan; hormati `prefers-reduced-motion`.

**4.2 Admin Live Chat** — perluas yang ada
- `LiveChatDispatchWidget.tsx`: tambah baris `originName`/`originSource` dan
  `missedDeparture`; tombol "Salin Pesan Keterlambatan" **sudah ada** (`:180-186`) —
  jangan duplikasi.
- `useLiveChatSse.ts`: ubah `delayAlert` (single) menjadi `delayAlerts: Map<reservationId, alert>`
  agar beberapa bidan telat bersamaan tidak saling menimpa.
- `LiveChatMonitor.tsx:817-834`: badge menampilkan jumlah + siklus klik ke chat terkait.
- Muat data awal dari `GET /api/admin/live-chat/delay-alerts` saat mount
  (SSE saja tidak cukup untuk CS yang baru buka tab — `KNOWN_ISSUES.md:166c`).

**4.3 Admin Dashboard — input nomor admin** — section baru di
`packages/admin-dashboard/src/pages/tenant/Settings.tsx` (Tab yang sudah ada,
bukan page baru):
- Field `toleranceMinutes` (default 30), `criticalExtraMinutes`, `maxPrevOriginGapHours`,
  `adminRecipients` (multi nomor, validasi `normalizePhoneID`);
- tombol **"Kirim Tes"** → endpoint tes yang mengirim ke nomor admin terdaftar;
- daftar nomor **dimasking** di UI/log (contoh `0812****7890`).

**4.4 Edit titik awal bidan** — `StaffManagement.tsx` (modal edit yang sudah ada,
`:82-88`): tambah `base_lat`, `base_lng`, `base_address` + tombol "Ambil dari Maps".
- `src/routes/admin/staff-management.subroute.ts:174-268`: terima & validasi 3 field
  (`lat` −90..90, `lng` −180..180, alamat ≤200 char), sertakan di `select` GET staff.
- Tampilkan penanda `originSource` bila base kosong ("belum diisi → pakai Klinik").

**Gerbang Fase 4:** `npm --prefix packages/admin-dashboard run build` hijau;
`npm run typecheck` hijau; uji manual (tidak ada harness UI): modal, kirim tes,
kartu amber, badge admin, `prefers-reduced-motion`.

---

### Fase 5 — Dokumen wajib

- [ ] `docs/FEATURE_INVENTORY.md`: baris fitur "Departure Watchdog", "Notifikasi
  Keterlambatan ke Admin", "Setelan Delay Watchdog", "Base Bidan".
- [ ] `docs/MODULE_INDEX.md`: daftarkan `delay_watchdog.domain` (fungsi murni) +
  `delay_watchdog.config` (resolver), beserta test-nya.
- [ ] `docs/KNOWN_ISSUES.md`:
  - update **#166**: ambang delay watchdog kini tenant-aware; geofence/arrival
    masih global (tetap OPEN).
  - update **#217**: titik awal `staff_base` kini tersedia; catat batasan PWA.
  - catat batasan WABA 24 jam untuk notifikasi admin.
- [ ] `docs/SAAS_READINESS_AUDIT.md` bila menyebut koordinat klinik hardcode.
- [ ] `graphify update .` setelah kode berubah.

---

### Fase 6 — Uji adversarial & gerbang regresi

| Skenario | Harapan |
|---|---|
| Pasien 1, base terisi, ETA 20 mnt, jadwal 10:00, sekarang 09:35 | `delayMinutes ≈ -5` → tidak ada alert |
| Pasien 1 belum OTW, sekarang 09:55 (deadline 09:40) | `missedDeparture=true`, alert admin muncul |
| Pasien 2, treatment 1 belum selesai | origin = base/clinic, **bukan** alamat pasien 1 |
| Pasien 2, treatment 1 selesai 10 mnt lalu, jarak 8 km | origin = pasien 1, `delayMinutes > 0` → kartu amber bidan |
| Pasien 2, treatment 1 selesai 5 jam lalu | origin = base |
| Bidan tanpa `base_lat` | fallback clinic; tidak ada `null pointer` |
| Reservasi `completed`/`cancelled` | tidak pernah masuk alert |
| Dua bidan telat bersamaan | dua kartu/badge, tidak saling menimpa |
| Cron jalan 3x berturut | hanya 1 alert per reservasi/level (TTL dedupe) |
| CS buka tab baru saat sudah ada delay | alert tetap tampil dari fetch awal |
| `adminRecipients` kosong | tombol memberi pesan jelas, tidak silent-success |
| Nomor admin invalid saat simpan setelan | patch ditolak 400 + pesan |
| **Payload `today-tasks` & `delay-template`** | **tidak memuat nomor HP pasien/ admin** |
| **Response `notify-delay`** | hanya `recipientCount`, tanpa nomor |
| **Audit log `STAFF_DELAY_NOTIFY`** | nomor tersamar (sanitizer audit) |
| **RBAC `admin_cs`** memanggil `delay-alerts` | 200 (bukan 403) |
| Lintas tenant (`tenant A` minta data `tenant B`) | 404/empty |
| Jadwal 23:50 WIB, sekarang 00:05 WIB | masuk hari yang benar (WIB), tidak salah hari |

**Gerbang akhir:**
1. `npm run typecheck` → 0 error.
2. `npm run check:reuse` → baru 0.
3. `npx vitest run tests/unit/staff-* tests/integration/staff-*` → hijau.
4. `npm test` → tidak ada failure baru (baseline 8 pre-existing, buktikan dengan
   revert-and-rerun bila perlu).
5. `npm run build` + `npm --prefix packages/admin-dashboard run build` → hijau.
6. `graphify update .` → sukses.

---

## 5. SOP No-HP — Gerbang Keras (wajib, bukan imbauan)

1. **Tidak ada field nomor HP customer** di DTO staf (`StaffTaskItem`), termasuk
   `delay` — type-level, bukan filter runtime.
2. **Test kontrak mengunci**: perluas `tests/unit/staff-task-data-minimization.test.ts`
   (sekarang hanya mengunci `admin_notes`/`ltv_cache`, `:57-58`) dengan
   `expect(select.customer.select.phone).toBeUndefined()` + assert response
   `today-tasks` tidak memuat pola nomor.
3. **Kanal kirim**: hanya `getGateway().sendTextMessage()` ke **nomor admin** +
   `auditService` (nomor tersamar). `wa.me`/`tel:` ke nomor pasien dilarang.
4. **Tampilan**: UI hanya menampilkan `recipientCount`; nomor admin dimasking
   di Settings/log; nomor pasien tidak pernah dirender.
5. **Kegagalan jujur**: WABA di luar 24 jam / nomor kosong → error eksplisit,
   bukan klaim terkirim.

---

## 6. Risiko, FMEA, & Rollback

| Risiko | S | O | D | RPN | Mitigasi |
|---|---|---|---|---|---|
| Duplikasi rumus ETA/telat | 6 | 6 | 6 | 216 | Satu domain + `MODULE_INDEX` banned symbols |
| 403 RBAC endpoint admin | 7 | 6 | 5 | 210 | Pakai prefix `live-chat` yang sudah di-scope |
| Kebocoran nomor HP | 9 | 3 | 4 | 108 | Gerbang §5 + test kontrak |
| Alert spam (alarm fatigue) | 5 | 7 | 6 | 210 | Ambang tenant 30 + dedupe TTL + hanya transisi |
| Cron ganda antar proses | 5 | 5 | 6 | 150 | `createExclusiveCronTask` + advisory lock + KV dedupe |
| WABA 24 jam gagal kirim | 5 | 7 | 5 | 175 | Capability check + error eksplisit + fallback salin |
| Migrasi produksi | 8 | 2 | 3 | 48 | Aditif nullable + drift check; tidak menyentuh tabel `children` |

**Rollback:** semua fitur di belakang flag `ENABLE_DELAY_WATCHDOG`; kolom baru
nullable (aman dibiarkan); UI hanya membaca field opsional. Tidak ada perubahan
pada alur OTW/telemetry/ongkir.

---

## 7. Appendix — Data Seeding Titik Awal (OPERASIONAL)

> Sumber: data owner (pesan 2026-11-20). Disimpan **hanya** di
> `data/staff-base.local.json` (gitignored) untuk dieksekusi skrip §1.4.
> Jangan menyalin ke file migrasi. Nomor HP **tidak** termasuk data ini.

| Nama | ID Staf | Area | Lat | Lng |
|---|---|---|---|---|
| Bidan Thabita | `2eef2d61-747d-4756-a93f-512ee1d16f81` | Demak Jaya, Surabaya | -7.2496988 | 112.7201362 |
| Bidan Hanifah | `38319d02-cac6-4e0d-8b81-8829a60ed9bd` | Candi, Sidoarjo | -7.4774775 | 112.7061906 |
| Bidan Cindy | `72d0093e-dfd7-4fd0-a6eb-97caae31474b` | Surabaya | -7.2504450 | 112.7688450 |
| Bidan Yusi F | `f88cedf5-3756-4f24-bb77-45050c029979` | Waru, Sidoarjo (Klinik) | -7.3488600 | 112.7516770 |

Catatan: bila repo dibagikan ke pihak luar, hapus tabel ini setelah seeding
(koordinat rumah = data pribadi staf).

---

## 8. Checklist Dokumen Wajib (AGENTS.md)

- [ ] `docs/FEATURE_INVENTORY.md` diperbarui (Fase 5).
- [ ] `docs/KNOWN_ISSUES.md` diperbarui (#166, #217, WABA 24 jam).
- [ ] `docs/MODULE_INDEX.md` mendaftarkan domain/config baru.
- [ ] `packages/admin-dashboard/src/ui-registry.json` — **tidak berubah**
  (tidak ada komponen `common` baru).
- [ ] `graphify update .` setelah edit kode.
- [ ] Laporan eksekusi memakai format: (1) apa yang terjadi, (2) temuan, (3) solusi.
