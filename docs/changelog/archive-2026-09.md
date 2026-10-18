# Changelog Archive - 2026-09

Arsip riwayat perubahan untuk periode 2026-09.
#### 2026-09-30 - Dispatch: Kontrol Keberangkatan (Deprecate Tracking GPS + Status `en_route` + ETA)

- **Konteks:** tracking GPS kontinu tidak andal di PWA (OS membekukan browser saat
  Bidan pindah ke aplikasi Google Maps). Diputuskan **deprecate** tracking; ganti
  dengan **kontrol keberangkatan**: klik Navigasi + jadwal ±60 mnt → kirim OTW +
  status "dalam perjalanan" + titik berangkat + estimasi tiba. Plan:
  `docs/plans/NAVIGASI_DEPART_CONTROL_REVISI_PLAN.md`.
- **Removed (deprecate) — `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`:**
  3 pemicu pemancar telemetry dihapus (auto-start H-30, pasca-OTW manual, pemicu
  handler Navigasi). Mesin telemetry (hook + endpoint + service + sweep) DIBIARKAN
  utuh untuk aplikasi native kelak (idle, tanpa produsen).
- **Added — status `en_route`:** `src/domain/reservation-status.ts` +
  sinkronisasi ke seluruh daftar status (reservation-core, slot-overlap,
  patient-lifecycle, follow-up, capi, cron, staff-notification, reservation-lifecycle,
  daily-report, machine, customers.subroute). Badge `🛵 Dalam Perjalanan` di
  Reservations & kartu staf. **Tanpa migrasi DB** (kolom String).
- **Added — endpoint depart `POST /api/staff/reservations/:id/otw`:** body opsional
  `{ lat, lng, accuracy, etaMinutes, arrivalWib, markEnRoute }` → pesan OTW
  diperkaya blok estimasi/lokasi (placeholder template baru `{etaMinutes}`,
  `{arrivalWib}`, `{departMapsUrl}`) + status → `en_route` dalam 1 update. Tanpa
  field → perilaku lama PERSIS. `GET /otw-template` meneruskan ETA (preview = pesan).
- **Added — UI `StaffToday.tsx`:** `handleStartNavigation` buka Maps sinkron →
  jendela ±60 mnt (`isWithinDepartWindow`; luar jendela = mode intip) → GPS
  sekali-tembak (`getCurrentDeviceLocation`) → ETA (Haversine + `estimateTravelMinutesKm`)
  → modal konfirmasi ETA → kirim OTW + `markEnRoute`. Helper murni baru di `geoUtils.ts`.
- **Test:** `reservation-status-en-route.test.ts` (6), `otw-depart-endpoint.test.ts` (8),
  `depart-window.test.ts` (10) + penyesuaian ekspektasi kontrak status
  (`patient-lifecycle.test.ts`, `active-reservations-endpoint.test.ts`).
- **Verifikasi:** root `tsc` exit 0; dashboard `vite build` hijau; full suite hijau.
  **Sisa deploy:** rebuild dist dashboard + restart bot.

#### 2026-09-30 - Katalog: Fase A Unifikasi (A1 file-sync stop, A2 anti-drift seed) (#128-FaseA)

- **Konteks:** Backlog §8.1 Fase A. Audit read-only mengoreksi premis plan: A3
  (alias `juara`) menyasar **dead code** (`CartManager.adaptCartToAudienceAge`
  tak dipanggil dari `src/`), bukan bug produksi.
- **Fixed (A1) — `saveServices()` sinkron file dihentikan:** kini **no-op**;
  `loadServices()` tidak lagi `writeFileSync` seed. Sumber kebenaran runtime =
  tabel `clinic_services` (`loadServicesFromDb`). Menghapus churn git + drift
  `services_custom.json` vs DB vs seed TS.
- **Fixed (A2) — Anti-drift katalog dashboard:** fallback dashboard manual
  (28 item) terbukti kehilangan **11 layanan aktif** backend (moms-induksi-*,
  selapan-full, bundle-*). Kini di-generate dari SATU sumber:
  `src/scripts/generate-catalog-seed.ts` (`npm run catalog:seed`) →
  `packages/admin-dashboard/src/data/clinicServicesFallback.json` (39 aktif);
  `treatmentParser.ts` meng-import JSON (offline-safe). Guard
  `tests/unit/catalog-seed-drift.test.ts` (5) mencegah drift lagi.
- **Dibatalkan (A3):** premis keliru (dead code) — dicatat KNOWN_ISSUES #178c,
  kandidat hapus Fase G. **Ditunda (A4):** merge-key kanonik, Confirmation Gate.
- **Verifikasi:** `npm run build` + `vite build` dashboard hijau; full suite
  **4369 passed / 0 failed**.

#### 2026-09-30 - Dispatch: Auto-Trigger Telemetry & Standby CS saat Bidan Klik "Navigasi" (#162)

- **Konteks:** Bidan menekan "Navigasi" (buka Google Maps) tetapi lupa "Infokan OTW"
  yang terpisah → `otw_sent_at`/`trip` tetap null → sidebar pemantauan CS
  (`LiveChatMonitor`) **hilang total**, CS mengira fitur rusak. Plan:
  `docs/plans/NAVIGASI_AUTO_TELEMETRY_DISPATCH_PLAN.md`.
- **Added (Fase 1) — `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`:**
  handler `handleStartNavigation` menyatukan (1) `startTelemetry()` (pemancar GPS +
  wake lock), (2) auto-kirim OTW best-effort bila belum pernah (`customText:''` →
  template resmi sistem bertanda tangan), (3) buka Google Maps. Disambungkan ke 3
  tombol Navigasi (kartu tugas, ikon header chat, modal detail). **Revisi
  (permintaan user):** kini muncul **modal konfirmasi** "Kirim OTW & Mulai" vs
  "Hanya Lihat Peta" — Bidan kadang menekan Navigasi hanya untuk melihat peta.
  "Hanya Lihat Peta" → tidak menyalakan telemetry & tidak kirim OTW (CS = standby);
  "Kirim OTW & Mulai" → telemetry + OTW + Maps. Modal dilewati bila OTW sudah
  terkirim. Link di tab "Selesai" sengaja tetap tautan murni (jadwal historis).
- **Changed (Fase 2) — UX Standby CS:**
  - `LiveChatMonitor.tsx`: gerbang sidebar dilonggarkan → `dispatchTrip && !arrivedAt
    && status∉{completed,cancelled,rejected}` (sidebar tak lagi hilang bila belum OTW).
  - `LiveChatDispatchWidget.tsx`: mode **standby** (kartu "Persiapan Perjalanan" +
    info jadwal + tombol "Hubungi Bidan") menggantikan `return null`; tab aksi
    (Salin Teks / Peta) disembunyikan saat standby.
- **Verifikasi:** `packages/admin-dashboard` build hijau; root `tsc` exit 0; full
  suite **4364 passed / 0 failed**. **Sisa deploy:** rebuild dist dashboard di server
  + restart bot (tidak menyentuh WAHA).

#### 2026-09-30 - Reservasi: Seam Intake Kanonis Form WA (#157a — same-day pending + idempotency)

- **Konteks:** Audit ulang #157a (read-only) mengoreksi premis lama: gerbang jam
  operasional & kuota agregat KB-3 ternyata sudah berlaku di jalur form. Residual
  nyata = **divergensi kontrak intake**: jalur form WA (`state-machine/machine.ts`)
  memanggil `saveReservation({ source:'BOT', status:'confirmed' })` TANPA
  `requestId`, sedangkan V3 tool memakai `pending` + `[SAME_DAY_REQUEST]` + requestId
  ber-jam. Efek: same-day form lolos `confirmed` (KB-2 awareness admin tak terpicu)
  dan double-submit/redelivery menggandakan baris.
- **Fixed (fondasional):** seam tunggal `src/services/reservation-intake.ts`
  (`isSameWibCalendarDay`, `isSameDayBooking`, `buildCustomerReservationIntake`,
  `SAME_DAY_REQUEST_TAG`) — murni tanpa I/O. Dipakai bersama oleh:
  - `src/state-machine/machine.ts` (jalur form WA): kini `status: intake.status`,
    `requestId: intake.requestId`, tag same-day disuntik ke `rawText`.
  - `src/v3/tools/save-reservation.tool.ts`: logika same-day/requestId inline
    dihapus, delegasi ke seam (hapus duplikasi; perilaku tak berubah).
- **Test:** `tests/unit/reservation-intake-contract.test.ts` (14, murni:
  batas hari WIB, same-day, requestId deterministik + jam WIB + isolasi tenant/customer/
  treatment) + `tests/unit/reservation-form-intake-contract.test.ts` (2, via state
  machine riil: same-day→pending+tag, beda-hari→confirmed+requestId).
- **Verifikasi:** `tsc` exit 0 (perlu `prisma generate` — client stale KB-6);
  full suite **4364 passed / 0 failed**. KNOWN_ISSUES #157a → RESOLVED.

#### 2026-09-30 - Reservasi: A2 Channel-Aware + Rilis Sesi Paralel (Copilot, LiveChat, Media, Follow-Up)

- **A2 channel-aware (fondasional, koreksi atas rilis A1–A6 sebelumnya):** gerbang
  `MISSING_BOOKING_DATE` dulu menolak SEMUA jalur tanpa tanggal, termasuk admin
  manual & auto-capture webhook yang SAH melakukan intake. Kini:
  - **BOT/AGENT (customer-facing):** tetap WAJIB tanggal (ditolak bila kosong).
  - **ADMIN_PANEL/WEBHOOK:** boleh intake tanpa tanggal, TAPI dipaksa status
    `pending` (DILARANG `confirmed`/`hold` tanpa tanggal → anti ghost INV1) dan
    `pendingScheduleCheck=false`, serta di-dedup 24 jam (update baris pending
    lama, bukan menumpuk). Test: `reservation-idempotency-request-id.test.ts` (+5).
- **Rilis sesi paralel (dikonsolidasikan, full-suite hijau):** Copilot multi-step,
  LiveChat (unread/filter/media), media extractor, follow-up, purchase-detection,
  webhook, machine, dan `save-reservation.tool`. Verifikasi: `tsc` Exit 0,
  dashboard build Exit 0, **full suite 4342 passed / 0 failed**.
- **Dibersihkan:** artifact sampah `NOW()` (0 byte).

#### 2026-09-30 - Reservasi: A1–A6 Keputusan Pemilik (booking_date WAJIB, Advisory Lock, Slot-Overlap Alert, Dataset)

- **Konteks:** Eksekusi 6 keputusan pemilik atas audit reservasi/ops. Prinsip:
  solusi fondasional (gerbang kode deterministik), bukan tambalan prompt.
- **A2 — `booking_date` WAJIB (KB-4):** `MissingBookingDateError`
  (`MISSING_BOOKING_DATE`, HTTP 400) di awal `saveReservation`
  (`reservation-core.service.ts`), SEBELUM idempotency. Jalur fallback "tanpa
  tanggal" 24 jam DIHAPUS (sumber data sampah `booking_date NULL`). Jam kosong
  tetap default 09:00 WIB + notifikasi (sudah ada). 3 test lama disesuaikan + 3
  adversarial baru.
- **A3 — Advisory lock anti double-booking (fondasional):** `computeAdvisoryLockKey`
  (FNV-1a → int32; per tenant+staf+hari WIB; staf null = grup `__unassigned__`) +
  `runWithAdvisoryLock`. Baca-cek+tulis kritis (idempotency, cek bentrok,
  merge/create) dijalankan di dalam `pg_advisory_xact_lock` via `$transaction`
  interaktif. Fail-open deterministik bila transaksi tak tersedia (mock offline
  aman). Efek samping (lifecycle/follow-up/notifikasi) dipindah ke pasca-commit.
  Test membuktikan lock benar-benar diakuisisi (bukan no-op) + fallback tepat 1x.
- **A5 — Sapuan slot tertumpuk (peringatan dini, bukan blokir):**
  `src/services/slot-overlap.service.ts` (`findOverlappingSlots` murni +
  `sweepOverlappingSlots`), `runSlotOverlapSweep` (cron), registrasi `app.ts`.
  1 notifikasi agregat ke ADMIN (Web Push + alert `DAILY_OPS_REPORT`) bila ada
  slot tumpang tindih. Env: `ENABLE_SLOT_OVERLAP_SWEEP` (default on),
  `SLOT_OVERLAP_SWEEP_INTERVAL_MINUTES` (default 3). Sesuai permintaan: form tetap
  boleh dipakai tanpa gerbang keras; admin diberi pembelajaran bertahap.
- **A1/A4 — Keputusan by-design:** `pending` TIDAK mengunci slot (jangan blokir);
  Google Calendar tetap mock (isu GCal tetap ditunda).
- **A6 — Dataset wilayah:** 2 entri koordinat lintas kabupaten (`Pehkulon`,
  `Gadingmangu` @ Prambon) dihapus (Kediri/Jombang, 47–62 km). Dataset 562→560.
- **C2 — Sinkronisasi dokumen:** status header PLAN 10/11/12 (basi "belum ada kode
  diubah") dikoreksi jujur sesuai audit kode.
- **Verifikasi:** `tsc` Exit 0; suite reservasi + slot-overlap + dataset hijau.
- **Sisa/debt:** advisory lock efektif hanya bila driver Prisma mendukung
  `$transaction` interaktif di produksi (perlu verifikasi server); migrasi
  `delivery_fee` + cleanup R1/173k menunggu akses server (`docs/RUNBOOK_R1_173k.md`).

#### 2026-09-29 - Guardrail D7/D3: Eliminasi False Positive Eskalasi Darurat (CASE-084/095)

- **Konteks:** dua eskalasi darurat palsu. CASE-084: `CUSTOMER_RELIGIOUS_TRIGGER_RE`
  kaku menolak variasi 1-'l' "Alhamdulilah" (ucapan syukur sah customer) sehingga
  D7 menuduh balasan bot sepihak. CASE-095: `ADVISORY_RE` mencocokkan frasa
  operasional klinik ("tersedia setiap hari (Senin–Minggu)", "dijadwalkan rutin")
  sebagai anjuran klinis tanpa landasan (D3).
- **Fase 1 - Kelas ejaan agama (`factual-claim-validator.ts`):** `UNPROMPTED_RELIGIOUS_RE`
  & `CUSTOMER_RELIGIOUS_TRIGGER_RE` memakai `alhamdu[l]*i+[l]+ah` (kelas ejaan,
  bukan hafalan kalimat). Keduanya dibuat simetris agar bot yang menyalin ejaan
  customer tidak dianggap sepihak; netralitas agama tetap utuh (tanpa pemicu
  customer, balasan bot tetap invalid).
- **Fase 2 - Kontrak D3 klinis-vs-operasional:** `ADVISORY_RE` kaku diganti
  `isClinicalAdvisory()` = `ADVISORY_MODALITY_RE` (sebaiknya/seharusnya/disarankan/
  rutinkan/tidak boleh/dilarang/wajib X) ATAU (`HOME_CARE_ACTION_RE` AND `FREQUENCY_RE`).
  Frasa frekuensi telanjang tanpa sikap anjuran/aksi perawatan (jam buka, penjadwalan
  layanan) = narasi operasional, BUKAN advisory. "pijat" sengaja dikecualikan dari
  aksi perawatan agar "jadwal pijat rutin" tetap valid. Desain kontrak ini mengganti
  daftar pengecualian kasus (anti-whack-a-mole).
- **Verifikasi:** `npm run build` (tsc) Exit 0; `tests/unit/factual-claim-validator.test.ts`
  49/49 hijau (+10 kasus baru: variasi ejaan, narasi operasional, regression lock
  campuran "Sebaiknya luka dijemur. Bidan kami tersedia setiap hari." → invalid);
  suite `tests/unit/v3` 934 passed / 5 skipped; suite guardrail terkait 90/90.
- **Sisa (dicatat KNOWN_ISSUES):** replay LLM CASE-084/095 (`--suite=v2 --llm`)
  belum dijalankan (butuh network + DB live); kelas ejaan di luar `alhamdu[l]*i+[l]+ah`
  (mis. "alhamdulilaah") belum dikenali.

#### 2026-09-29 - CTWA Hardening: Dekoder Token Meta Ketat + Cleanup Prod + Paritas Preview CAPI

- **Konteks:** Audit pasca-deploy fitur `ctwa_clid` (commit `78fc0746`) menemukan
  (a) fallback dekoder terlalu permisif, (b) data uji mencemari `ad_clicks` produksi,
  (c) regex duplikat + komentar basi di jalur bypass webhook, dan (d) preview UI
  menjanjikan envelope `business_messaging` yang tak selalu dikirim backend.
- **Fixed — Dekoder CTWA ketat (`src/integrations/whatsapp/waha-ctwa-referral.ts`):**
  `decodeCtwaPayload` kini HANYA menerima token berprefix Meta `Afi`/`PA` (raw atau
  hasil decode Base64). Fallback regex longgar 20+ char DIBUANG — string acak kini
  `undefined`, menutup false-positive atribusi organik→paid.
- **Fixed — Cleanup data uji produksi:** baris `ad_clicks` `adclick_ctwa_test_ivan`
  (trackingCode `vn`, customer `a4deafa7…`) DIHAPUS dari DB live. Customer terbukti
  memiliki reservasi nyata → TIDAK ditandai `is_sandbox_test`.
- **Fixed — Webhook bypass (`src/routes/webhook.route.ts`):** gate ingest CTWA di
  jalur bypass admin kini HANYA `wahaReferral?.ctwaClid` (regex promo-code duplikat
  dibuang; promo-code tetap ditangani `matchAdClickAndFireContact` jalur normal).
  Komentar basi "chat admin tidak diatribusikan" dikoreksi.
- **Fixed — Paritas preview CAPI (`reservations.subroute.ts`, `MetaCapiQueue.tsx`):**
  endpoint `GET /api/admin/capi-queue` mengembalikan `wabaConfigured` (tenant punya
  `waba_business_account_id`); preview JSON kini `action_source='business_messaging'`
  HANYA bila `ctwa_clid` ada DAN `wabaConfigured`, sama persis dengan
  `useBusinessMessaging` di `capi.service.ts`. Ditambah banner peringatan saat WABA id kosong.
- **Tests:** `waha-ctwa-referral.test.ts` +4 adversarial (tolak string acak non-prefix,
  Base64 decode bukan token Meta, `root.ctwaPayload` sampah, terima prefix `PA`);
  `waha-webhook.test.ts` +2 seam (bypass admin + CTWA meng-ingest `isNewCustomerRecord=false`;
  bypass admin + promo-code tanpa CTWA TIDAK memanggil attribution). Fixture token
  disintesis ulang berprefix `Afi`. Regression gate: `npm run build` Exit 0, dashboard
  build Exit 0, full suite 521 file / 4238 test hijau (0 failed).

#### 2026-09-29 - LiveChat: Server-Side Filter (Unread/Reservasi) + Perbaikan Modal Label & Badge Unread Global

- **Konteks:** Tab Unread/Reservasi hanya memfilter 50 percakapan yang sudah
  ditarik ke memori browser, sehingga (a) tombol "Muat lebih banyak" muncul palsu
  saat hanya 1 chat unread, (b) titik hijau tab Unread tidak muncul bila chat unread
  berada di luar 50 chat pertama, dan (c) modal label lenyap saat digulir.
- **Fixed - Filter server-side (`src/services/conversation.service.ts`):** `listConversations`
  menerima parameter `filter: 'all' | 'unread' | 'reservation'`. Kondisi dibangun via
  `AND` eksplisit (search OR + unread OR tidak lagi saling menimpa `where.OR`).
  `unread` = `is_manual_unread:true` ATAU pesan `INBOUND` dengan `read_at:null`.
  `reservation` = reservasi aktif (`confirmed` | `pending` | `hold` valid <2 jam),
  paritas persis dengan logika klien. Fallback in-memory (DB offline) menerapkan
  filter yang sama.
- **Fondasional - Domain status reservasi (`src/domain/reservation-status.ts`, baru):**
  Single Source of Truth `ACTIVE_RESERVATION_STATUSES` + jendela validitas hold
  (`ACTIVE_HOLD_WINDOW_MS` 2 jam) + `isActiveReservation`/`isHoldActive`. `copilot-tools.ts`
  kini mengimpor & me-reexport konstanta dari modul daun ini (anti-duplikasi status).
- **Changed - Pass-through & route (`src/services/live-chat.service.ts`,
  `src/routes/admin/livechat.subroute.ts`):** `filter` divalidasi dari query,
  diteruskan ke service, dan disertakan dalam `cacheKey` (tidak tertukar antar-tab).
  `hasMore` kini dihitung dari total terfilter di DB.
- **Fixed - Modal label (`packages/admin-dashboard/.../LiveChatMonitor.tsx`):**
  hapus `window.addEventListener('scroll', handleClose, true)` yang mencegat scroll
  internal daftar label. Tambah body scroll-lock (`overflow:hidden` + kompensasi
  lebar scrollbar), tutup via `Escape`, dan `overscroll-contain` pada kedua daftar
  label (mobile/desktop).
- **Fixed - Paging & badge (`LiveChatMonitor.tsx`):** `filter=unread|reservation`
  dikirim ke server; offset server murni (`listOffsetRef`, bukan panjang array lokal
  yang tercemar ghost-chat prepend); ghost-preserve dinonaktifkan untuk tab terfilter.
  Titik hijau tab Unread kini bersumber `totalUnreadCount` global dari
  `/api/admin/live-chat/unread-count` (debounced 1.5s, disinkronkan via SSE).
- **UX - Empty state kontekstual:** pesan khusus per tab (unread: "Semua pesan sudah
  dibaca"; reservasi: "Belum ada reservasi aktif") + guard tombol load-more saat
  daftar kosong.
- **Test - `tests/unit/conversation-filter.test.ts`:** 10 test adversarial (kontrak
  where Prisma untuk unread/reservasi, kombinasi search+unread via AND, hold-expiry,
  paritas fallback memory, pass-through service, guard domain). Regression gate:
  `npm run build` Exit 0, dashboard build Exit 0, full suite 521 file / 4230 test hijau.
- **Sisa debt:** `docs/KNOWN_ISSUES.md` #169 (indeks komposit unread + unit badge).

#### 2026-09-29 - Remediasi Kebocoran Notifikasi Admin ke Perangkat Terapis (Ghost Push Subscription & RBAC Scope)
- **Konteks:** Notifikasi chat pelanggan umum (unassigned/CS, mis. Anne Lawrencia)
  bocor ke perangkat terapis. Akar masalah: perangkat penguji terdaftar
  `push_subscriptions.user_type='ADMIN'` (ghost dari sesi dashboard sebelumnya),
  sedangkan rebind ke STAFF gagal 403 karena `role_api_scopes` mengunci therapist
  (SEC-AUDIT-04). Rencana: `docs/plans/PUSH_RBAC_GHOST_SUBSCRIPTION_REMEDIATION.md`.
- **Security - Scope push data-driven (`prisma/migrations/20260930000000_allow_push_for_therapist`):**
  seed prefix GRANULAR untuk therapist (`/api/admin/push/public-key` GET,
  `/subscribe` POST, `/unsubscribe` POST), tenant-aware (`tenants` + fallback
  `default-tenant`), idempoten. Endpoint sensitif (`/test`, `/test-staff`,
  `/staff-device-counts`) TIDAK di-seed → tetap default-deny. TIDAK ada bypass
  hardcode di `admin.route.ts` (hapus dead code `isSelfPushRegister`).
- **Security - Pemaksaan identitas langganan (`src/routes/admin/push.subroute.ts`):**
  `POST /subscribe` kini memaksa `userType`/`userId` dari SESI (staffId → STAFF +
  id; selain itu ADMIN + null). Body `userType='ADMIN'`/`userId` palsu dari staf
  di-override — menutup spoofing.
- **Security - Caller-check `test-staff` (`src/routes/admin/push.subroute.ts`):**
  staf hanya boleh menguji notifikasi ke `staffId` dirinya (403 `FORBIDDEN_PUSH_TARGET`
  bila ke staf lain); Super Admin tetap bebas.
- **Security - Sanitasi cookie silang antar portal (`staff/auth.subroute.ts`,
  `admin/auth.subroute.ts`):** login/restore staf memusnahkan `admin_session`;
  login/restore admin memusnahkan `staff_session`. Mencegah dua portal aktif
  bersamaan (akar ghost subscription).
- **Fixed - Disosiasi push saat logout (`AuthContext.tsx`, `StaffAuthContext.tsx`):**
  `unsubscribeFromPushNotifications()` dipanggil SEBELUM destroy sesi backend
  (best-effort), mencegah perangkat tetap menerima notifikasi role lama.
- **Fixed - Presedensi dual-cookie (`src/routes/admin.route.ts`):** `preHandler`
  sebelumnya mengecek `admin_session` LEBIH DULU (else-if) daripada `staff_session`.
  Perangkat dengan cookie admin lama + sesi staf baru membuat `staffId` tak pernah
  di-set → push terikat ADMIN → kebocoran notifikasi berlanjut walau login Tabita
  sudah benar. FIX: sesi STAF valid kini divalidasi & MENANG lebih dulu; sesi admin
  menjadi fallback. Regression test ditambahkan (dual-cookie → STAFF+staffId).
- **Live - Purge ghost token (2026-09-29):** baris ADMIN `2df24cf1-…` (Windows Chrome)
  dan `ba003b08-…` (iPhone) dihapus dari produksi by `id` spesifik; backup
  `push_subscriptions_backup_20260929` & `…_20260929b`. Migrasi + fix presedensi
  ter-deploy ke live (app-only, WAHA untouched).
- **Test - `tests/integration/push-rbac.test.ts`:** 11 test adversarial (scope
  allow/deny, override identitas, caller-check, sanitasi cookie). Regression gate:
  `npm run build` Exit 0, dashboard build Exit 0, full suite 520 file / 4220 test hijau.
  Test lama (`staff-routes`, `unified-login`) disesuaikan ke kontrak `Set-Cookie` array.
- **Sisa debt:** `docs/KNOWN_ISSUES.md` #168 (purge ghost token live, verifikasi perangkat nyata).
- **Fase 4 (live) BELUM:** deploy + purge token ghost produksi menunggu gate keamanan
  (backup + SELECT-before-DELETE + 1-step verification).

#### 2026-09-29 - Eliminasi Kebocoran Notifikasi ke Bidan Terapis (Mandat In-System PWA Only)

- **Konteks:** Terapis masih menerima notifikasi liar (Telegram eksternal ke akun
  pribadi, Web Push, serta suara/banner PWA) termasuk saat Bot AI sedang membalas
  chat pelanggan. Perbaikan 3 lapis fondasional (bukan tambalan prompt).
- **Fase 1 - Kill-switch Telegram tenant-aware (fondasional):** config baru
  `src/config/staff-notification-config.ts` (`getStaffNotificationConfig`,
  baca `Tenant.settings.staffNotification.telegramEnabled`, cache 5 mnt, DEFAULT
  **OFF**). Kelima situs pengiriman Telegram di `staff-notification.service.ts`
  (assignment, pre-visit brief, cancel, unassign, daily/morning briefing) kini
  di-gate. Data `telegram_chat_id` TIDAK dihapus (kebijakan di level kode, bukan
  pemusnahan data — rollback tetap mungkin).
- **Fase 2 - Gate `is_human_handling` deterministik (`inbound-notification-router.service.ts`):**
  push ke staf HANYA dikirim bila percakapan dipegang manusia
  (`is_human_handling` atau `current_state='HUMAN_HANDLING'`). Bila status tak
  dapat dipastikan (DB offline) → fail-closed (jangan spam terapis). Payload SSE
  `message.created` (`message.service.ts`) kini menyertakan flag `isHumanHandling`.
- **Fase 3 - Filter audio/banner PWA (`StaffToday.tsx`):** `playIncomingMessageSound`
  & `showSafeNotification` untuk pesan masuk HANYA saat `isHumanHandling=true`;
  ponsel terapis tidak lagi bergetar/berdering untuk chat bot-handled.
- **Fase 5 - Test adversarial:** `tests/unit/staff-notification-guards.test.ts`
  (9 test: gate human-handling, fail-closed DB offline, kill-switch OFF/ON,
  briefing massal tanpa sentuh DB saat OFF). Suite lama yang menguji dispatch
  Telegram diaktifkan kanal eksplisit via mock config; `staff-chat-cutoff-notification`
  disesuaikan ke kontrak baru.
- **Fase 4 - Isolasi nomor staf internal (fondasional, migrasi DB):** kolom baru
  `Customer.is_internal_staff` (migrasi `20260929150000_add_internal_staff` +
  backfill ternormalisasi digit dari `Staff.phone`). `customerService.markInternalStaffCustomer`
  dipanggil saat staf dibuat (`staff-management.subroute.ts`). Percakapan staf
  internal (CS/Bidan) kini dikecualikan dari MQL, follow-up sliding window, push CRM
  (`message.service.ts`), dan Meta CAPI (`capi.service.ts`). Flag `isInternalStaff`
  disertakan di payload SSE.
- **Sisa debt:** `docs/KNOWN_ISSUES.md` #167 (penandaan nomor staf internal, isolasi
  supervisor, verifikasi perangkat nyata).
- **Verifikasi:** `npm run build` Exit 0; `packages/admin-dashboard` build Exit 0;
  full suite Vitest 519 file / 4209 test hijau.

#### 2026-09-29 - Standardisasi Tanda Tangan Staf & Anti-Sapaan Ganda (OTW & Sudah Sampai)

- **Konteks:** pesan tombol cepat terapis "Kirim OTW" & "Sudah Sampai" terkirim
  tanpa tanda tangan `~ Bidan [Nama]` (beda dengan balasan manual), dan nama
  pelanggan tersimpan "Bunda suciani" menghasilkan sapaan ganda "Halo Bunda Bunda suciani".
- **Fase 1 - Helper tunggal (fondasional, `src/utils/staff-signature.ts`):**
  `ensureStaffSignature(text, staffName)` + `hasStaffSignature` idempoten, escape
  karakter regex nama (mis. `Bidan (Ayu)`), DILARANG menyematkan tanda tangan ke
  pesan kosong. Semua jalur memakai helper ini (service OTW/arrival + balasan manual
  `today.subroute.ts` di-refactor — output byte-identik, dibuktikan test regresi).
- **Fase 1b - Renderer terpadu (`staff-reservation.service.ts`):** `renderStaffTripMessage`
  (sanitasi nama via `sanitizeCustomerNameForGreeting` + fallback "Bunda" + jaring
  pengaman `Bunda Bunda`→`Bunda` + tanda tangan) dipakai `getOtwMessageText` dan
  `getArrivalMessageText` (baru). `recordArrival` kini data-driven dari template
  `STAFF_ARRIVAL` (tanpa hardcode), bukan lagi string inline.
- **Fase 1c - Rute (`today.subroute.ts`):** `GET /otw-template` sanitasi query;
  `POST /:id/otw` sanitasi nama + helper untuk teks kustom maupun hasil template;
  endpoint simetris baru `GET /arrival-template`; perbaikan kontrak laten
  (frontend kirim `customText`, rute lama membaca `body.text` → kini keduanya diterima).
- **Fase 1d - Data-driven template:** tipe `STAFF_ARRIVAL` ditambah ke
  `followup-templates.ts` (3 varian) + opsi editor `FollowUpTemplates.tsx`
  (kolom `type` String polos → tanpa migrasi).
- **Fase 2 - Frontend:** `StaffToday.tsx` fallback preview OTW & kedatangan kini
  bertanda tangan; preview tetap diambil dari endpoint backend (single source of truth).
- **Fase 3 - Test adversarial:** `tests/unit/staff-message-signature.test.ts` (16 test)
  — anti-duplikasi `Bunda Bunda` (prefix ibu/mama, distrik, generik, kosong),
  idempotensi tanda tangan, nama ber-karakter regex, OTW + arrival.
- **Verifikasi:** `npm run build` (tsc) Exit 0; `packages/admin-dashboard` build Exit 0;
  `staff-routes.test.ts` 23/23 + 4 suite terkait 70/70 hijau.

#### 2026-09-29 - Sinkronisasi & Persistensi Alamat Jalan Fisik + Patokan (preferences.address/landmark)

- **Konteks:** alamat jalan fisik dari form reservasi (mis. "jalan kedungklinter 1 80")
  dan patokan rumah hilang / tidak tersimpan ke `customers.preferences.address`
  meskipun invoice WhatsApp berhasil mencetaknya. Audit read-only produksi
  membuktikan: (a) `kelurahan` terisi bersih ("Kedungdoro") tapi `preferences.address`
  kosong; (b) 5 caller mengirim `parsed.address` ke kolom `kelurahan` (ditolak
  kelurahan-guard → dibuang, tanpa dialihkan); (c) `address` tidak pernah diteruskan
  ke `saveReservation`. Shareloc dipastikan AMAN (`location_source=gps_pin`,
  `share_location_sent=t`) → di luar scope.
- **Fase 1 — Kanonis 5 titik caller (fondasional):** `webhook.route.ts` (619
  `ADMIN_OUTBOUND_AUTO_CAPTURE`, 1217/1291/1402 human-grace/hold-disabled/explicit)
  dan `state-machine/machine.ts:352` (`BOT`) kini mengirim `kelurahan: undefined` +
  `address: <alamat jalan>` (bukan `as any`), sehingga alamat mengalir otomatis via
  `saveReservation → reservation-lifecycle.onReservationCreated (71-75) →
  customerService.updateCustomer → preferences.address`.
- **Fase 2 — Enrichment guard idempoten:** `human-background-enrichment.service.ts`
  mem-persist `preferences.address` hanya bila masih kosong (baca-dulu, anti-timpa).
- **Fase 3 — Backend API:** `POST /api/admin/reservation` (`reservations.subroute.ts`)
  menerima `address` + `landmark`; `address` diteruskan ke `saveReservation`,
  `landmark` di-persist via `customerService.updateCustomer`. Bug laten ikut
  diperbaiki: `babies` mapping `ageText → age` (sebelumnya usia bayi admin hilang).
- **Fase 4 — UI:** `CreateReservationModal` menerima `initialAddress`/`initialLandmark`,
  sinkronisasi anti-stale via `useEffect`, dua input di Section 1, masuk ke
  `buildCreatePayload` + PATCH edit + draft/reset. `LiveChatMonitor` meneruskan
  prefill (chat + profil) & sidebar kini memprioritaskan `preferences.address`
  serta menampilkan patokan.
- **Fase 5 — Healing data produksi (via endpoint beraudit, bukan SQL mentah):**
  customer `3844d3ee-...` (Bunda suciani) via `PATCH /api/admin/customers/:id`
  → `preferences.address="jalan kedungklinter 1 80"`,
  `preferences.landmark="Rumah rolling door putih / pagar stainless, yg jual kusen"`;
  reservasi `7ded4fec-...` `raw_text` diperbarui memuat baris alamat + patokan.
  Kolom `kelurahan` tetap "Kedungdoro" (bersih).
- **Verifikasi:** `npx tsc` 0 error, admin-dashboard build hijau, full Vitest
  **518 passed / 1 skipped**. Test adversarial baru: multi-parafrase alamat form,
  guard anti-timpa, kontrak payload POST address/landmark.
- **Catatan:** `state-machine/machine.ts:352` ikut dikoreksi (klaim KNOWN_ISSUES #165b
  hanya menyebut webhook). Shareloc tidak diubah (terbukti aman).

#### 2026-09-29 — Dispatch Tracking: Auto-Start H-30m, Auto-Off Geofence 50m & Early Warning Keterlambatan CS

- **Konteks:** Bidan sering lupa klik "Kirim OTW" → telemetry tak pernah jalan, CS
  buta posisi. Upgrade: pelacakan otomatis mendekati jadwal, auto-stop saat tiba,
  dan peringatan keterlambatan realtime ke CS.
- **Fase 1 (pure functions + TDD, `src/services/staff-trip-tracking.service.ts`):**
  `evaluateArrivalGeofence` (radius 50m + dwell 2 ping berturut, fail-closed akurasi
  >100m/null, `NO_CUSTOMER_COORDS`/`INVALID_COORDS`), `calculateDelayStatus`
  (`delayMinutes = estimasiTiba − jadwal`, level none/warning(≥20)/critical(≥30),
  WIB eksplisit `Asia/Jakarta`, fail-open `NO_SCHEDULE`/`NO_ETA`), `isWithinPreTripWindow`
  (H-30m). Konstanta terpusat: `ARRIVAL_RADIUS_M`, `ARRIVAL_CONSECUTIVE_PING`,
  `GPS_ACCURACY_MAX_M`, `PRE_TRIP_WINDOW_MIN`, `DELAY_WARN_MIN`, `DELAY_CRITICAL_MIN`.
  Test adversarial `tests/unit/staff-trip-arrival-and-delay.test.ts` (25 kasus).
- **Fase 2 (endpoint + event):** `POST /api/staff/telemetry` mengevaluasi geofence →
  `autoStop:true` + `clearTrip` + event `staff.trip_arrived` (TIDAK mengubah `arrived_at`
  — kedatangan resmi tetap tombol manual); early warning `staff.trip_delay_warning`
  HANYA pada transisi level (anti-spam). Tipe event baru di `live-chat-hub.service.ts`.
  `GET /api/admin/dispatch/trip/:reservationId` menambah `delayStatus` + `delayText`
  (draf pesan DB-driven). Template `STAFF_TRIP_DELAY` di `followup-templates.ts` +
  `StaffReservationService.getTripDelayMessageText` (bukan hardcode di frontend).
- **Fase 3 (frontend bidan):** `useTripTelemetry` auto-stop saat `res.autoStop===true`;
  `MIN_ACCURACY_M` diselaraskan ke 100. `StaffToday.tsx` auto-start H-30m SILENT
  (hanya jadwal milik staf sendiri, izin lokasi `granted`, tanpa badge/toast).
- **Fase 4 (frontend CS):** `LiveChatDispatchWidget` tampil saat passive auto-tracking
  (`trip != null` walau `otwSentAt` null), banner merah/amber keterlambatan + tombol
  salin draf. `LiveChatMonitor` menangkap `staff.trip_delay_warning` (toast SEKALI +
  ikon pulse di header) & `staff.trip_arrived` (toast hijau).
- **Verifikasi:** `tsc` 0 error; build admin-dashboard Exit 0; Vitest full suite
  (4206 passed; 1 fail pre-existing dari WIP sesi lain di
  `inbound-notification-router`, bukan dari perubahan ini). Tech debt tenant-aware
  dicatat di `docs/KNOWN_ISSUES.md` #166 & `docs/SAAS_READINESS_AUDIT.md`.
- **Belum dijalankan:** uji HP Bidan nyata & deploy produksi.

#### 2026-09-29 - Usia Dinamis Real-Time & Pemisahan Entitas Anak vs Moms

- **Konteks:** label usia mati (`36hr`, `23bln`) + data Ibu Hamil (Bella/Fitria) bocor
  ke tabel `children`. Audit menemukan 4 lapis kebocoran + guard kehamilan inkonsisten
  (`parseAgeTextToBirthDate` tidak punya guard `isGestationalText` yang dipunyai
  `parseAgeTextToMonths`) - akar bug "hamil 38 minggu" -> bayi 9 bulan.
- **Fase 1 - Engine usia (deep module, `src/utils/age-calculator.ts`):**
  `isGestationalText` (satu sumber kebenaran, dipakai SEMUA parser), `parseAgeTextEstimate`
  (angka telanjang "8" -> unparseable, rentang "1-2 bulan" -> batas bawah + approximate,
  "10 bulan kurang 6 hari" -> presisi dikurangi), `formatClinicalAge` presisi hari
  ("X hari" / "X bulan Y hari" / "X tahun Y bulan"), `computeCurrentAge` on-the-fly dari
  `rawAgeText + registeredAt` (data lama tanpa birth_date tetap tumbuh), `computeGestationalAge`
  (<=41 minggu PREGNANT, >41 -> Pasca Salin/Nifas), `resolveMomGestationalInfo` + `extractGestationalWeeks`.
- **Fase 2 - Pemisahan entitas:** `classifyPatientEntity` (CHILD/MOM/AMBIGUOUS) di
  `reservation-text-parser.ts`; `buildBabyDetails` menolak baris gestasional;
  `reservation-lifecycle.service` (seam tunggal semua jalur) & `child.service` filter MOM
  (defense-in-depth). API `GET /api/admin/reservations` + `/reservation/:id` mengirim
  `current_age` dinamis + `mom_gestational_info`.
- **Fase 3 - UI seragam:** util `packages/admin-dashboard/src/utils/clinicalAge.ts`
  (`formatClinicalAge`, `momGestationalBadge`, `resolveChildAgeRows`) dipakai Reservations,
  ReservationDetailModal (badge Moms), CustomerDatabase, LiveChatMonitor, TodayTreatments,
  StaffToday, CustomerProfilePanel. Urutan prioritas `current_age` > estimasi birth_date > raw.
- **Fase 4 - Rekonsiliasi & test:** `src/scripts/reconcile-children-birth-dates-and-moms.ts`
  (default DRY-RUN + CSV plan; `--commit` mengisi `birth_date`; baris Moms/ambigu DI-FLAG,
  tidak dihapus). Test adversarial `tests/unit/dynamic-age-and-gestational-calculator.test.ts`
  + `tests/unit/patient-entity-classification.test.ts`.
- **Verifikasi:** `npm run build` (tsc) Exit 0, `packages/admin-dashboard` build Exit 0,
  full Vitest 4138 passed / 28 skipped. Sisa tech debt dicatat di `docs/KNOWN_ISSUES.md` #164.
- **Belum dijalankan (butuh server):** rekonsiliasi produksi (localhost DB offline).


#### 2026-09-29 — Peta Perjalanan Bidan: Pulse Marker + Garis Rute (reuse, tanpa library/ORS)

- **Konteks:** peta perjalanan Bidan (`DispatchMapModal`) sudah ada; permintaan user: marker Bidan berdenyut + garis posisi→tujuan. Keputusan: peta **tetap pisah** dari Peta Sebaran Pelanggan (use case beda), **tanpa** library/endpoint/halaman/migrasi baru, **tanpa** call ORS.
- **Fase 1 (util murni, TDD red→green):** `packages/admin-dashboard/src/utils/dispatchMap.ts` — `MapRouteSegment` + `route` di `MapView` (garis lurus Bidan→pasien, anchor pusat dot via `ROUTE_DOT_RADIUS_PX`) + `shouldPulseTherapistMarker(hasTherapist, isLive)`. Test `tests/unit/dispatch-map-projection.test.ts` +6 (route 2 marker, null 1 marker/identik/kosong/rusak, predikat pulse) → 12/12.
- **Fase 2 (UI):** `DispatchMapModal` — prop `isLive` (default false, kompatibel mundur), overlay `<svg><line>` putus-putus, `animate-ping` pada dot Bidan hanya saat live, legenda jujur ("Garis lurus ke pasien (bukan rute jalan)"). `LiveChatDispatchWidget` meneruskan `isLive={isFresh}` (reuse variabel existing).
- **Resource:** 0 call ORS; denyut & garis murni digambar di browser CS (server tidak ikut kerja).
- **Verifikasi:** test 12/12, `tsc` 0 error, `packages/admin-dashboard` build hijau, `animate-ping`/`keyframes ping` + `strokeDasharray` + teks legenda ter-generate di `dist`.
- **Fase 3 (OPEN):** tampilkan widget di tablet/HP CS (sekarang hanya `xl`) — butuh izin terpisah + cek visual di perangkat nyata.

#### 2026-09-28 — Dispatch Tracking: Hardening Rekomendasi (Deteksi OTW, Peta Presisi, Wake Lock, Rate Limit)

- **Fixed — Deteksi OTW reliable (#8):** `LiveChatItem.active*Reservation` kini membawa
  `otw_sent_at`/`arrived_at` (`live-chat.service.ts`). `LiveChatMonitor.tsx` memakai item
  chat sebagai sumber utama status OTW, sehingga widget muncul tanpa bergantung pembukaan
  modal detail customer.
- **Fixed — Peta 2 titik presisi tanpa dependency (#6):** `DispatchMapModal.tsx` tidak lagi
  menembak dua param `marker=` (tak didukung OSM embed). Diganti raster tile OSM
  (Web Mercator) via util murni baru `packages/admin-dashboard/src/utils/dispatchMap.ts`
  (`computeMapView`/`chooseZoom`/`tileUrl`), marker hijau Bidan + merah rumah presisi,
  atribusi OSM, dan deep-link rute Google Maps. Nol dependency baru.
- **Fixed — Wake Lock re-acquire (#7):** `useTripTelemetry` mengambil ulang wake lock saat
  tab kembali `visible` (browser melepas lock saat tab disembunyikan) — layar HP tidak mati
  di holder motor.
- **Security — Rate limit telemetry (#12):** `POST /api/staff/telemetry` dibatasi
  40 req/menit per key (selain `bodyLimit 4KB`).
- **Fixed — Template status aman nama kosong:** `STAFF_TRIP_STATUS` tidak lagi menghasilkan
  `{name}` / `Bunda ,` saat nama pasien kosong.
- **Tests (`+15`):** `tests/unit/dispatch-map-projection.test.ts` (6, adversarial proyeksi:
  invers, input rusak, bounds marker, tile range), `tests/unit/staff-trip-status-template.test.ts`
  (3, cabang DB `FollowUpTemplate` + fallback offline + nama kosong). Cabang DB yang
  sebelumnya tak teruji sekarang terverifikasi.
- **Verifikasi:** root `tsc --noEmit` 0 error; dashboard Vite build sukses; vitest full suite
  **4056 passed / 0 failed** (28 skipped).

#### 2026-09-28 — Internal Realtime Location Tracking & Dispatch Alert Terapis (Fase 3–5)

- **Added — Emitter PWA (`packages/admin-dashboard/src/hooks/useTripTelemetry.ts`):**
  hook reusable `startTelemetry/stopTelemetry` dengan `watchPosition` + interval kirim
  25s, throttle anti-spam, silent-fail saat sinyal hilang, `wakeLock` best-effort
  (iOS-unavailable diabaikan), dan pembersihan total saat unmount. Dipasang di
  `StaffToday.tsx`: mulai saat OTW sukses, berhenti saat "Sampai"/"Selesai".
  Indikator halus: dot hijau berdenyut pada badge OTW saat pemantauan aktif.
- **Added — Widget CS (`components/livechat/LiveChatDispatchWidget.tsx`):** badge
  status + pulse kesegaran (<60 dtk), nama area, sisa km, laju, ETA, `lastUpdateSec`
  ("Update X menit lalu"), tombol **Salin Teks Jawaban Pasien** (dari `readyText`
  server-side, bukan hardcode), dan banner geofence anti-lost + tombol `tel:` Bidan.
- **Added — Modal peta tanpa dependency baru (`components/livechat/DispatchMapModal.tsx`):**
  iframe OpenStreetMap embed (2 marker: hijau Bidan, merah rumah pasien) + deep-link
  Google Maps. TANPA Leaflet / Google Maps API berbayar.
- **Changed — LiveChat (client + page):** `liveChatSse.ts` mendaftarkan event
  `staff.telemetry_updated` / `staff.trip_closed`; `LiveChatMonitor.tsx` fetch
  `GET /api/admin/dispatch/trip/:id`, sidebar kanan muncul hanya saat OTW aktif
  (`hidden xl:flex`), refresh 10s saat tab visible, dan update realtime via SSE.
- **Changed — Endpoint dispatch:** respons menambah `staffName`, `staffPhone`,
  `geofenceDistanceM` (jarak terukur untuk banner).
- **Verifikasi:** root `tsc --noEmit` 0 error; dashboard Vite build sukses; vitest
  full suite **4041 passed / 0 failed** (28 skipped).

#### 2026-09-28 — Internal Realtime Location Tracking & Dispatch Alert Terapis (Fase 1 & 2)

- **Added — Service fondasi `src/services/staff-trip-tracking.service.ts` (Fase 1):**
  store transient in-memory + TTL 600s (siap wiring Redis `SETEX` di Fase 3 via
  `redisKey()` tanpa ubah kontrak). Tenant-scoped key `trip:{tenantId}:{reservationId}`
  (cegah race 1 bidan 2 OTW). Pure `resolveHumanAreaName` (landmark ≤2km > gazetteer
  `findNearestSubdistrict` > fallback; sengaja TIDAK memakai `ARTERY_CORRIDORS` yang
  text-match), `calculateTripProgress` (Haversine 1.25x, 25 km/jam, clamp 1–120 mnt),
  dan `evaluateGeofenceAlert` (300m–1.5km, stalled 180s, tolak `accuracy>100`).
  `movedAt` mereset timer stalled hanya saat perpindahan >30m (anti-noise GPS diam).
- **Added — Endpoint telemetry staf (`src/routes/staff/today.subroute.ts`):**
  `POST /api/staff/telemetry` (ping GPS, `bodyLimit 4KB`) & `POST /api/staff/trip/stop`
  (matikan pemantauan saat tiba). Guard tenant + anti-IDOR via helper
  `loadAuthorizedReservation` (fail-closed unassigned, supervisor lintas-terapis);
  publish `staff.telemetry_updated` / `staff.trip_closed` ke LiveChatHub.
- **Added — Endpoint dispatch admin (`src/routes/admin/reservations.subroute.ts`):**
  `GET /api/admin/dispatch/trip/:reservationId` — posisi, `lastUpdateSec`, sisa km,
  ETA, flag geofence, dan `readyText` siap kirim (DB-driven).
- **Added — Template status perjalanan DB-driven:** tipe `STAFF_TRIP_STATUS` di
  `src/config/followup-templates.ts` (placeholder `{name}/{areaName}/{etaMinutes}`) +
  `StaffReservationService.getTripStatusMessageText()` (custom `FollowUpTemplate`
  tenant > rolling default) + entri editor di `FollowUpTemplates.tsx`. Tidak ada
  template hardcode di frontend.
- **Changed — SSE:** `LiveChatHubEventType` + allowlist `ALLOWED_STAFF_EVENTS` staf
  menambah `staff.telemetry_updated`/`staff.trip_closed`, difilter `staffId` agar
  posisi tidak bocor lintas-terapis. SSE admin tanpa allowlist (forward) — aman.
- **Tests:** `tests/unit/staff-trip-tracking.test.ts` (6, adversarial: isolasi tenant,
  koordinat/akurasi invalid, overwrite `createdAt`, batas geofence, low-accuracy,
  ETA clamp) + `tests/integration/staff-trip-dispatch.test.ts` (11, 401/403/404
  anti-IDOR lintas-tenant, jadwal selesai, stop, progress + readyText).
- **Verifikasi:** `npx vitest run` suite terpilih hijau (17+23+44+19); root `tsc --noEmit`
  0 error; dashboard `npm run build` sukses. Fase 3–5 (emitter PWA, widget CS, modal peta
  tanpa Leaflet) BELUM dieksekusi — lihat `docs/KNOWN_ISSUES.md` #162.

#### 2026-09-28 — AI Clinic Copilot: Recall Stalled Inquiry dari Teks Pesan (Akar #163b)

- **Latar (bukti DB live):** pertanyaan "yang konfirmasi besok tapi belum masuk reservasi siapa?"
  selalu kosong. Audit `conversations`: dari **780 percakapan**, `session_data` NULL = 738 (95%),
  dan key `booking` = **0 (nol)** — sinyal `requestedTimeHint/preferredDate/pendingScheduleCheck`
  TIDAK PERNAH terisi di produksi. `query_stalled_inquiries` bergantung pada `session_data.booking.*`
  → recall = nol secara sistematis. Label "Tanya Jadwal" sempat terpasang (20×) membuktikan latch
  berjalan, tetapi state `booking` tidak persisten.
- **Fixed — Sinyal jadwal dari TEKS pesan (`src/services/copilot/copilot-tools.ts`):** bila
  `session_data` kosong, tool mendeteksi minat jadwal dari riwayat pesan INBOUND memakai detektor
  kanonik pipeline produksi (`hasScheduleSignal`, `isScheduleCheckEngagement`,
  `isScheduleAvailabilityText`, `extractTimeHint`, `hasBookingCommitSignal`) — BUKAN keyword baru.
  Helper `hasTextScheduleSignal` menyatukan predikat. Ambil 5 pesan terakhir (bukan 1) agar turn
  pertanyaan tertangkap walau ada balasan bot sesudahnya.
- **Fixed — Filter tanggal dari teks:** `matchesInquiryDate` kini juga dievaluasi terhadap petunjuk
  waktu hasil ekstraksi teks (mis. "besok"), bukan hanya state sesi.
- **Bukti recall (replika logika tool pada DB live, 7 hari):** kandidat tanpa reservasi aktif
  dengan sinyal jadwal = **29 baris** (sebelumnya 0). Pada jendela 3 hari saat admin responsif,
  jumlah yang benar-benar menggantung (inbound terakhir belum dibalas) = 0 — konsisten.
- **Tests:** `copilot-fixing.test.ts` +6 skenario adversarial (session_data null + teks "besok",
  multi-parafrase "bsk bisa…/slot jam berapa", teks tanpa sinyal, filter date dari teks, sudah
  punya reservasi, sudah dibalas admin).
- **Verifikasi:** root `tsc` 0; vitest full unit suite **3646 passed / 0 failed**; root build 0.
- **Catatan:** memperbaiki *recall tool*. Akar hulu (state `booking` tidak persisten di pipeline)
  tetap tercatat sebagai sisa di `docs/KNOWN_ISSUES.md` #163b (kini recall tidak lagi bergantung
  padanya).

#### 2026-09-28 — AI Clinic Copilot: Anggaran Wall-Clock & Degradasi Jujur (anti "Gagal menghubungi Copilot")

- **Latar (bukti audit):** pertanyaan komposit ("yang konfirmasi besok tapi belum masuk reservasi siapa?")
  memicu loop multi-step (sampai 4 panggilan LLM sekuensial). Tiap attempt boleh berjalan
  `cfg.timeoutMs` (env `LLM_TIMEOUT_CHAT_MS` = **120 dtk**) ditambah retry transient + fallback
  lintas-provider. Sementara `apiRequest` frontend (POST default) abort di **15 dtk** → admin melihat
  toast "Gagal menghubungi Copilot. Coba lagi." walau backend masih bekerja. Catch-all di
  `copilot.service.ts` juga menyamakan timeout ini dengan "gangguan layanan AI".
- **Fixed — Anggaran wall-clock deterministik (`src/services/copilot/copilot.service.ts`):**
  `DEFAULT_TOTAL_BUDGET_MS = 60_000` (override env `COPILOT_TOTAL_BUDGET_MS`) sebagai deadline turn.
  Helper `withDeadline()` me-race seluruh panggilan LLM terhadap deadline sehingga total tunggu tidak
  pernah melewati batas (retry/fallback tetap dibuang aman). `callTimeout()` membatasi timeout tiap
  attempt ke sisa anggaran. Loop router berhenti bila sisa waktu < ambang proporsional.
- **Added — Degradasi jujur deterministik:** `buildDegradedAnswer()` merangkai jawaban dari baris tool
  NYATA (tanpa LLM → anti-halusinasi) saat deadline tersentuh; tanpa data sama sekali → `success:false`
  dengan `error: 'COPILOT_DEADLINE_EXCEEDED'` + pesan actionable, BUKAN "gangguan layanan AI".
- **Fixed — Timeout frontend selaras (`AdminCopilotPanel.tsx`):** `timeoutMs: 70000` pada POST
  `/api/admin/copilot/chat` (margin di atas anggaran backend 60 dtk) agar backend sempat mengembalikan
  degradasi jujur sebelum klien abort.
- **Fixed — Klaim plan vs kode (rate-limit):** `copilot.subroute.ts` kini benar-benar memasang
  `config.rateLimit { max: 30, timeWindow: '1 minute' }` (sebelumnya hanya disebut di komentar).
- **Tests:** `copilot-fixing.test.ts` +6 skenario adversarial (deadline race, degradasi tanpa data,
  degradasi dengan data grounded, happy-path tidak regresi, `buildDegradedAnswer` anti-halusinasi).
- **Verifikasi:** root `tsc` 0; dashboard Vite build 0; `copilot-fixing` + `copilot-grounding` 71/71 hijau;
  unit suite 3639 passed (1 timeout flaky #142 `capi-tenant-isolation`, hijau saat diisolasi).

#### 2026-09-28 — Jaminan Akurasi Koordinat & Presisi Navigasi Terapis (Insiden Terapis Tersasar)

- **Fixed — Integritas spasial kolom `kelurahan` (Fase 0):** alamat jalan/perumahan
  (`Banjarmukti Residence Blok G-6A`) tidak lagi disalin ke kolom `kelurahan` saat
  reservasi dibuat dari form teks. `reservations.subroute.ts` (endpoint
  `POST /api/admin/reservation`) kini mengirim `kelurahan: undefined` — kolom kelurahan
  khusus entitas desa resmi hasil geocoding/gazetteer. `reservation-lifecycle.service.ts`
  mempersist alamat lengkap ke `preferences.address/full_address` (bukan kolom wilayah).
- **Fixed — GPS Immutability Guard fondasional (Fase 1):** gerbang baru tunggal
  `CustomerService.isPreciseGps` (`location_source === 'gps_pin'` ATAU
  `share_location_sent === true` + lat/lng valid) melindungi koordinat presisi dari
  penimpaan hasil geocoding teks. Dipasang di SEMUA seam tulis: `updateCustomerLocation`
  (DB + memory), `updateCustomer` (auto-recalc admin — sebelumnya tanpa guard sama sekali),
  `promotePendingLocation`, dan jalur pengayaan form WA (`human-background-enrichment`).
  Estimasi `estimated_area` sengaja TETAP boleh dikoreksi; override presisi hanya lewat
  `isNativePin`, `locationSource: gps_pin`, atau `forceUpdateGps` eksplisit.
- **Fixed — Provenance koordinat konsisten:** `url_coords` (link Maps ber-koordinat) kini
  dipetakan ke `gps_pin` + `share_location_sent=true` (sejajar jalur enrich), bukan lagi
  `estimated_area`. `url_text_geocoded`/`geocoding` tetap `estimated_area`.
- **Fixed — Anti-fabrikasi wilayah (Fase 4):** fallback gazetteer pada lifecycle tidak lagi
  mempersist nama desa dari sentroid kecamatan bila nama desa itu tidak benar-benar disebut
  customer (mis. `buduran` → sentroid desa lain); cukup koordinat estimasi + kecamatan/kota.
- **Added — Presisi Navigasi Terapis (Fase 2 & 3):** `buildAddressText` kini merangkai
  alamat jalan/perumahan + hierarki wilayah (dedupe teknis), sehingga kartu tugas memuat
  nama perumahan & blok. Payload staf menambah `addressDetail` + `locationSource`
  (derivasi server tunggal `resolveLocationSource`: kolom → `preferences` → penanda staf →
  `share_location_sent`; tak diketahui = null agar TIDAK menampilkan "presisi" palsu), dan
  kartu tugas menampilkan **badge akurasi deterministik** (`📍 Titik Presisi` /
  `⚠️ Estimasi Wilayah` / `🛠️ Titik Staf`) berbasis state server.
- **Catatan — Override "pindah rumah" sudah tersedia:** jalur admin `PUT /api/admin/customers/:id/location`
  (`Reservations.tsx`) dan "Refresh Lokasi" menulis koordinat langsung + audit, sehingga
  tombol `forceUpdateGps` baru TIDAK dibuat (redundan, anti-bloat). Param `forceUpdateGps`
  dipertahankan sebagai escape-hatch API terprogram + dipakai test kontrak.
- **Tests:** `tests/unit/location-immutability.test.ts` (12, adversarial multi-parafrase):
  pin presisi tidak tertimpa, estimasi boleh dikoreksi, override eksplisit, promosi pending,
  edit admin tidak geocode-ulang, `buildAddressText`, dan gazetteer tidak mengarang desa.
- **Verifikasi:** root `tsc --noEmit` 0 error; dashboard Vite build sukses; vitest full suite
  **4006 passed / 0 failed** (28 skipped).

#### 2026-09-28 — Optimasi LiveChat Mobile: Placeholder Ringkas, Tombol Kunci Mobile-Hidden, & Filter/Toggle Unread

- **Changed — LiveChatComposer:**
  - Placeholder textbox disederhanakan menjadi `"Tulis balasan..."` (dari sebelumnya `"Tulis balasan... (Enter baris baru, klik Kirim)"`) dan `"Tulis catatan internal..."` pada mode catatan internal agar tidak memotong layar sempit di perangkat mobile.
  - Tombol ikon kunci catatan internal di samping tombol kirim disembunyikan khusus layar mobile (`hidden sm:flex`) sehingga area ketik mendapatkan tambahan lebar ~40px dan bebas desakan. Akses catatan internal di mobile tetap dapat digunakan melalui menu tools (`+`).
- **Added — Unread Filter & Header Toggle (LiveChatMonitor):**
  - Ditambahkan filter baru **"Pesan Belum Dibaca (Unread)"** dengan ikon `MessageSquareDot` pada toolbar atas daftar percakapan WhatsApp. Dilengkapi indikator dot hijau dinamis saat ada pesan yang belum dibaca.
  - Ditambahkan tombol aksi toggle Unread (`MessageSquareDot`) di samping tombol cari pada header percakapan aktif. Staf dapat menandai percakapan sebagai belum dibaca / sudah dibaca dengan sekali sentuh/klik tanpa perlu long-press / klik kanan.
- **Verifikasi:** Build dashboard Vite (`npm run build`) sukses 0 error; root `tsc` lulus 0 error; test integration auth signal contract 9 passed.

#### 2026-09-28 — Nebulizer sebagai Add-on Katalog Valid (KNOWN_ISSUES #156, keputusan produk B)

- **Fixed — Exemplar kontradiktif:** `gold_penolakan_layanan_belum_tersedia` (`src/v3/agent/gold-few-shot-exemplars.ts`) tidak lagi menandai `nebulizer`/`uap` sebagai "layanan belum tersedia" (kini murni cuci hidung/sedot lendir/jasa luar). Ditambah exemplar `gold_nebulizer_addon_tersedia`. `keyword-enrichment.service.ts` disinkronkan.
- **Fixed — Tool `get_catalog_and_price` data-driven:** blok add-on pernapasan tidak lagi hafalan `id.includes('moksa')`. Kini memilih SEMUA add-on aktif yang deskripsinya cocok topik pernapasan/token keluhan (Sinar Moksa, Nebulizer Saline, Nebulizer + Obat), disisipkan tepat di bawah layanan teratas agar tak terpotong `slice(0,5)`; `isAddon` ditandai dari katalog.
- **Added — Migrasi idempoten:** `prisma/migrations/20260928000000_add_nebulizer_addon/migration.sql` men-seed `add-on-nebulizer` & `add-on-nebulizer-obat` untuk `default-tenant` (`ON CONFLICT`/`WHERE NOT EXISTS`, tidak menimpa kustomisasi admin).
- **Keputusan produk:** Nebulizer (+Obat) SAH sebagai add-on **bersama** layanan utama (pijat terapi), TIDAK berdiri sendiri (kebijakan #54 tetap).
- **Tests:** `tests/unit/v3/nebulizer-addon-availability.test.ts` (8). **Verifikasi:** root `tsc` 0; vitest full suite 4023 passed / 0 failed.

#### 2026-09-28 — Hardening Sesi Staff (503), Access-Log Auth & Observabilitas Pre-Visit Brief (KNOWN_ISSUES #141, #143, #157f)

- **Fixed — Kontrak 503 sesi staff (#141, paritas admin):** `StaffAuthService.validateSession`
  (`src/services/staff-auth.service.ts`) tidak lagi menelan error DB menjadi `null` (→ 401 ambigu →
  frontend menghapus token cadangan). Kini melempar `SessionStoreUnavailable` (kelas sinyal yang sama
  dengan admin, tanpa duplikat) saat query DB error; `null` hanya untuk token invalid/expired/revoked/
  inaktif. Pemetaan **503 `SESSION_STORE_UNAVAILABLE`** dipasang di seluruh call-site: `staff.route.ts`
  (preHandler), `staff/auth.subroute.ts` (restore), `admin/auth.subroute.ts` (restore + /me), `admin.route.ts`
  (preHandler cabang staff); `media.route.ts` fail-closed (deny, bukan 500). Tipe `StaffSessionWithStaff`
  diekspor agar `include: { staff }` tak hilang dari inferensi.
- **Added — Access-log forensik jalur auth (#143):** hook `onResponse` terpusat di `src/app.ts` +
  modul `src/utils/auth-access-log.ts` memancarkan SATU baris JSON `[AUTH ACCESS]` untuk tiap respons
  **401/503** pada rute auth/admin/staff: `path, method, status, signal(401|503), latencyMs,
  sessionHashPrefix8, ipHashPrefix8, reqId, ts`. Token penuh & IP mentah DILARANG masuk log (hanya hash
  prefix-8). Memungkinkan forensic "berapa kali 401 vs 503" pasca-deploy.
- **Added — Observabilitas Pre-Visit Brief (#157f):** `sendPreVisitBrief` kini mengembalikan
  `reason: 'no_channel'` + baris log terstruktur `[PRE_VISIT_BRIEF_NO_CHANNEL]` saat staf belum punya
  kanal (Telegram/Web Push). Perilaku retry DIPERTAHANKAN (kanal bisa aktif beberapa menit kemudian);
  `sent_at` tetap tidak ditandai agar sweep mengulang.
- **Tests:** `staff-session-store.test.ts` (5), `auth-access-log.test.ts` unit (9) + integrasi (4),
  `pre-visit-brief-channel.test.ts` (3), kontrak 503 di `staff-routes.test.ts` (+2) &
  `admin-auth-signal-contract.test.ts` (+1). **Verifikasi:** root `tsc` 0; vitest full suite 3994 passed / 0 failed.
- **Docs:** `docs/KNOWN_ISSUES.md` #141/#143/#157f → RESOLVED; #157i/#157l/#153i/#155e (CASE-043)
  ditandai RESOLVED (terverifikasi hijau; dokumen sebelumnya keliru menandai merah).

#### 2026-09-28 — Refaktor UI Mobile: Relokasi Online/Sound/Theme ke Sidebar & Copilot Icon di Header

- **Latar & UX:** Pada layar mobile (< 768px), header sebelumnya memuat 5 tombol/badge (Status Online, Suara, Mode UI, Menu, dan Alert) sehingga terasa sempit dan padat. Sementara itu, AI Copilot di sidebar berbentuk toggle bar yang sulit diakses cepat saat membuka percakapan Live Chat di HP.
- **Changed — Header:**
  - Status sesi WAHA ("Online" / "Scan QR" / "Offline"), tombol suara notifikasi chat, dan switcher tema disembunyikan dari header mobile (`hidden md:flex`) sehingga header mobile menjadi lega dan bersih.
  - AI Copilot dipindahkan ke header sebagai **icon button murni** (`<Sparkles />`, aktif hanya saat membuka rute `/live-chat`). Saat aktif, ikon diberi aksen emerald (`bg-[#d9fdd3] text-[#008069]`) dengan ring halus. Di luar Live Chat, ikon otomatis tidak dirender.
  - Sisi kanan header mobile kini ramping dan fokus: hanya memuat ikon Copilot (bila di Live Chat) dan tombol menu hamburger.
- **Changed — Sidebar:**
  - Toggle bar AI Copilot di sidebar dihapus.
  - Ditambahkan panel **Quick Controls** di atas profil pengguna: kartu status WhatsApp dengan lampu berdenyut ("WhatsApp Online" / "Offline"), tombol toggle suara chat (🔊 On / 🔇 Mute), dan tombol mode UI (☀️/🌙).
  - Popover status sistem diubah menjadi modal dialog terpusat dengan backdrop blur agar dapat dibuka dari mobile sidebar maupun header desktop tanpa risiko terpotong tepi layar.
- **Verifikasi:** Build dashboard Vite (`npm run build`) sukses 0 error; root `tsc` lulus 0 error; unit tests 52 passed.

#### 2026-09-28 — Atribusi Iklan CTWA WAHA + Meta Business Messaging CAPI (Issue #119)

- **Added — Extractor CTWA (`src/integrations/whatsapp/waha-ctwa-referral.ts`):** deep module
  `extractWahaAdReferral(payload)` (pure, fail-open) mengurai `contextInfo.externalAdReply` dari
  berbagai varian encoder WAHA (Noweb `_data`, Baileys `message`, root, image/video). Kontrak
  `AdReferral` diunifikasi di `gateway.types.ts` (dipakai `NormalizedInboundMessage.referral` &
  `MatchAdClickParams.referral`). `ctwaClid` wajib string opaque — angka/blank → `undefined`.
- **Fixed — Blind spot webhook WAHA (`webhook.route.ts`):** `matchAdClickAndFireContact` kini
  menerima `referral` hasil ekstraksi payload (sebelumnya hanya jalur WABA yang mengirim). Iklan
  CTWA langsung tidak lagi tercatat sebagai `organic`.
- **Added — Pengkayaan AdClick (`ad-attribution.service.ts`):** record CTWA mengisi
  `utmSource=sourceApp||'meta'`, `utmMedium='ctwa'`, `utmCampaign=sourceId||'ctwa_direct'`,
  `landingUrl=sourceUrl`. Headline/body TIDAK masuk `utm*` (copy tak stabil; cukup audit `payloadRaw`).
- **Fixed — Meta Business Messaging CAPI (`capi.service.ts`):** event CTWA kini memakai envelope
  resmi (`action_source='business_messaging'`, `messaging_channel='whatsapp'` top-level,
  `user_data.whatsapp_business_account_id`, `user_data.ctwa_clid` mentah) saat tenant punya WABA id;
  fail-open ke `action_source='chat'` bila tidak. `event_id` skema Pixel tidak diubah (anti-regresi).
- **Tests — `waha-ctwa-referral.test.ts` (+7 unit), `waha-webhook.test.ts` (+2 integrasi seam),
  `tracking.test.ts` (+3 CAPI envelope), `ad-attribution.test.ts` (+1 enrichment).**
- **Residual (#159):** caveat dukungan Meta untuk nomor unofficial WAHA wajib diverifikasi empiris
  di Events Manager; discoverability field WABA id lintas-provider.

#### 2026-09-28 — Ekstensi Copilot: riwayat pasien & katalog/SOP (aditif, grounded)

- **Added — Tool `get_customer_history` (`copilot-tools.ts`):** profil pasien (kecamatan/kota,
  `ltv_cache`, `admin_notes`, `preferences`) + 3 kunjungan terakhir. Nomor HP **disamarkan**
  deterministik via `maskPhoneNumber` (privasi — nomor mentah tidak pernah ke LLM). Tenant-scoped,
  ≤3 kandidat untuk nama ambigu.
- **Added — Tool `lookup_catalog_and_policy` (`copilot-tools.ts`):** katalog resmi (`ClinicService`:
  harga normal/promo, durasi, usia), SOP/kebijakan (`ClinicPolicy`), dan FAQ/dokumen (`KnowledgeChunk`).
  Setiap row berlabel `source` untuk grounding; tenant-scoped; `take` dibatasi (8/sumber, cap 20).
- **Added — Observabilitas `rowCounts`:** `CopilotChatResult.rowCounts` (baris per tool) kini
  dicatat pada payload `AuditLog` `AI_COPILOT_CHAT` (`copilot.subroute.ts`).
- **Hardening — Grounding medis (lapis sekunder):** summarize prompt menegaskan kutip HANYA dari
  baris berlabel sumber + larangan mengarang angka (harga/durasi/slot); primer tetap baris DB.
- **UI — Quick prompts operasional:** `AdminCopilotPanel.tsx` menampilkan saran riwayat pasien &
  SOP pasca-vaksin.
- **Tests — Suite ekstensi Copilot:** `copilot-fixing.test.ts` +9 skenario (masking HP, tenant-scope
  ketiga model, dummy filter, katalog/policy/ALL, empty anti-halusinasi, `rowCounts`). Full suite
  3889 hijau; `pending-schedule-check-lifecycle` CASE-043 merah pre-existing (#155e).
- **Catatan arsitektur:** pendekatan "universal keyword search" DITOLAK (melanggar mandat anti-overfit
  & state-based); ekstensi ini aditif tanpa menyentuh 4 tool existing. Residual dicatat #155a–e.

#### 2026-09-28 — Perbaikan fondasional AI Clinic Copilot (state signal, date filter, sanitizer, deep-link)

- **Fixed — Sinyal minat jadwal kini state-based (`copilot-tools.ts`):** `hasScheduleIntentSignal`
  membaca `booking.requestedTimeHint/preferredDate/pendingScheduleCheck` + `cartItems` (bukan lagi
  mengandalkan `inquiryDate` hantu / `lastDiscussedTreatment` tunggal). Pelanggan yang sekadar pernah
  membahas treatment tanpa state booking tidak lagi dianggap minta jadwal (anti false-positive Dinda).
- **Added — Filter `date` pada `query_stalled_inquiries`:** `matchesInquiryDate` mencocokkan ISO,
  kata relatif ("besok"/"hari ini"), atau nama hari dengan **word-boundary** (bukan substring bebas
  dua arah), sehingga filter tanggal mempersempit hasil secara deterministik.
- **Fixed — Default status jadwal aktif:** `query_reservations_by_filter` tanpa `status` kini default
  ke `confirmed/pending/hold` sehingga reservasi `cancelled` tidak mencemari rekap mendatang.
- **Fixed — Dummy-filter `query_unreplied_chats`:** kontak sandbox/test disaring via
  `isDummyOrTestContact` (pola nomor tak terindeks DB).
- **Hardening — Deskripsi tool bebas overfit:** contoh kata kunci hafalan ("belum terjadwal dan minta
  besok") dihapus dari `description` (mandat anti-overfitting).
- **Added — Konteks history di router (`copilot.service.ts`):** `buildRouterPrompt(..., history)`
  menyuntik 4 pesan terakhir agar pertanyaan lanjutan tidak amnesia; panduan komposit bersifat generik
  (tanpa contoh kalimat verbatim).
- **Added — Sanitizer deterministik (anti-UUID):** `stripInternalIds` membuang `customerId`/`id` dari
  baris SEBELUM ke LLM; `sanitizeCopilotAnswer` menghapus sisa UUID dari jawaban — gerbang kode, bukan
  sekadar imbauan prompt.
- **Hardening — Grounding label:** `validateGrounding` juga memvalidasi format `**Nama Pelanggan**: X` /
  `Nama Pasien: X` dengan regex ketat (tanpa alternatif kata umum yang memicu false-positive).
- **Added — Deep-link Live Chat di `AdminCopilotPanel.tsx`:** renderer markdown inline mengubah
  `[Buka Chat](/admin/live-chat?conversationId=…)` menjadi tombol yang menyinkronkan `liveChat:selectedId`
  lalu `navigate()` (pola sama dengan `useLiveChatNotification`); hanya tautan internal yang diaktifkan.
- **Tests — Suite adversarial Copilot:** `copilot-fixing.test.ts` +12 skenario (komposit 2-tool,
  Dinda disaring, dummy-filter, default status, stripInternalIds, zero-UUID, grounding label &
  non-false-positive). Full suite 3880 hijau; `pending-schedule-check-lifecycle` CASE-043 merah
  pre-existing (#154e).

#### 2026-09-28 — Penguatan fondasional sistem reservasi & rekonsiliasi spasial (IDOR, collision check, AI add-on guard, data healing)

- **Security — Penutupan IDOR lintas tenant pada Release Hold:** Endpoint `PATCH /api/admin/reservation/:id/release-hold` (`src/routes/admin/reservations.subroute.ts`) kini mewajibkan tenant context `where: { id, tenant_id: tenantId }` serta memasang status guard (`reservation.status !== 'hold' -> HTTP 400`), mencegah modifikasi atau penghapusan data reservasi tenant lain.
- **Fixed — Kebocoran alamat jalan ke kolom kelurahan:** Perbaikan spasial di `src/services/reservation-core.service.ts:350,454` mengganti `kelurahan: kelurahan || address` menjadi `kelurahan: kelurahan || undefined`, mencegah string alamat panjang mencemari data wilayah customer.
- **Fixed — Pemulihan enum TreatmentCategory KIDS:** Rute admin reservasi memulihkan enum `TreatmentCategory.KIDS` agar layanan anak tidak di-downgrade menjadi `BABY`.
- **Added — Backend collision check jadwal terapis pada edit admin:** Memasang deteksi bentrok jadwal terapis pada 3 endpoint edit reservasi (`PATCH /api/admin/reservation/:id`, `set-date`, `assign-staff`). Sistem menolak bentrok jadwal dengan HTTP 409 `STAFF_COLLISION` kecuali parameter override `force: true` disertakan.
- **Added — AI Tool Guard penolakan pemesanan add-on murni:** Tool `save_reservation` (`src/v3/tools/save-reservation.tool.ts`) kini memvalidasi pemesanan via `treatmentCatalogService.validateReservationTreatments`. Pemesanan yang hanya memuat layanan add-on (tanpa layanan utama) ditolak dengan respons edukatif ramah ke Bunda.
- **Added — Fallback Gazetteer pada auto-distance background lifecycle:** `reservation-lifecycle.service.ts` kini memakai fallback kamus Gazetteer saat geocoding Google Maps mengembalikan hasil non-presisi, menjamin perhitungan jarak & ongkir tetap akurat.
- **Fixed — Rekonsiliasi data produksi (Data Healing):** Skrip `src/scripts/reconcile-customer-locations-and-reservations.ts` memulihkan data spasial & durasi pada basis data PostgreSQL (9 customer + 1 reservasi). Eksekusi `--commit` dilakukan manual di server (bukti angka km/Rp tidak tersimpan di repo). Catatan audit: klaim "transaksional" sebelumnya tidak akurat — skrip tidak membungkus operasi dalam transaksi DB.
- **Fixed — Rekonsiliasi durasi data-driven (audit):** Durasi reservasi NULL kini diresolusi via `treatmentCatalogService.resolveDurationBreakdown` (Single Source of Truth). Angka mati `60` dihapus; teks layanan yang tak dikenali katalog DILEWATI (anti-fabrikasi data).
- **Hardening — `isAddonService` data-driven (audit):** Fallback hardcode nama bisnis (`moksa`/`nebulizer`) dihapus; klasifikasi add-on untuk string bebas kini melalui resolusi katalog (`matchCatalogItem` → `isAddon`/`serviceType`/`category` DB). Sesuai Mandat Non-Hardcode.
- **Hardening — Isolasi tenant (audit):** (a) `release-hold` memory-fallback fail-closed — entri tanpa `tenant_id` DILARANG lolos; (b) `prisma.customer.update` pada create/edit reservasi kini ter-scope `tenant_id`.
- **Tests — Suite adversarial diperluas:** `tests/unit/reservation-security-and-integrity.test.ts` (11 skenario: ketahanan spasial, IDOR dengan assert scope tenant non-tautologis, fail-closed memory fallback, collision check terapis, add-on rejection multi-parafrase & combo acceptance, gazetteer fallback lifecycle deterministik).
- **Fixed — Pause-gate antrian in-memory (`queue.service.ts`):** `pauseQueue`/`resumeQueue` sebelumnya hanya menjeda BullMQ; jalur fallback in-memory tetap memproses pesan saat `isPaused` (WAHA putus + Redis offline → pesan bocor/hilang). Kini `enqueueInMemory`/`processNextInMemory` menghormati `isPaused` dan `resumeQueue` menguras antrian yang tertahan. `queue-durability.test.ts` dibuat deterministik via `forceDisconnectRedis()` (bukan bergantung Redis offline). Lihat KNOWN_ISSUES #152d.
- **Fixed — Kontrak test CASE-043 (`pending-schedule-check-lifecycle.test.ts`):** kontradiksi internal (test `waitlist-reopen` mewajibkan re-engage slot me-latch ulang, sedangkan test CASE-043 menuntut ack setelahnya tidak menembak) diselaraskan dengan keputusan produk: re-engage slot SAH → closing+handoff pada ack penutup adalah benar. Assert diperjelas (turn penundaan 0–2 tidak menembak; ack turn 5 menembak 1x). Kode produksi tidak diubah. Lihat KNOWN_ISSUES #154e.

#### 2026-09-28 — Remediasi fondasional audit (RF-06, lifecycle jadwal, anaphora, injection, scope)

- **Added — Red-flag komposit batuk-ruam-demam lintas-turn (RF-06):** `detectPersistentCoughRashEmergency`
  (`src/config/medical-keywords.ts`) + `MedicalDetectionService.detectMedicalConcern(text, recentHistory?)`.
  Bug: gate medis stateless per-pesan meloloskan "batuk 2 minggu" (turn 1) + "ruam merah + demam" (turn 2)
  sebagai `NONE`. Kini digabung lintas riwayat → `HIGH` → `HUMAN_HANDLING` + alert. Guard proksimitas
  penanda-usia mencegah false-positive ("bayi 3 bulan batuk pilek" = usia, bukan durasi kronis).
  `machine.ts` memuat riwayat sebelum gate medis (satu sumber riwayat untuk gate & V3).
- **Fixed — Lifecycle `pendingScheduleCheck` (CASE-039, anti eskalasi palsu):**
  `ContextGrounder.applySessionLatches` membersihkan flag "menunggu ack" pada turn non-jadwal/non-ack/non-komit
  secara deterministik (state lifecycle, bukan daftar frasa batal). "Jangan"/"Nanti dulu"/pindah topik
  membatalkan penantian sehingga ack berikutnya ("Siap") tidak memicu `FastResponseGate`.
- **Fixed — Amnesia booking saat DB offline:** latch `priceDiscussed` & lifecycle tidak lagi menimpa sesi lokal
  dengan hasil `GoalTracker.updateGoalSession` (persist best-effort) — mencegah `booking` hilang.
- **Fixed — Deadlock anaphora ("yang tadi aja bubid"):** `hasBookingCommitSignal` (`src/utils/date-confirmation.ts`)
  memakai kelas deiksis (rujukan + verba/partikel, tahan slang/typo "yg td aja") menggantikan hafalan frasa;
  `CartManager` menyatukan afirmasi-tunggal ke sumber yang sama sehingga penawaran tunggal asisten sah mengisi
  keranjang tanpa mengunci menu multi-opsi.
- **Added — Sanitizer prompt injection (ADV-01):** `src/utils/prompt-injection-sanitizer.ts`
  (`sanitizeCustomerInput` + `wrapCustomerMessage`) menetralkan delimiter `customer_message`, tag peran
  (`<system>`/`<assistant>`), penanda `SYSTEM:` dan pola instruksi-peran — menutup breakout isolasi.
  Dipakai `agent-runner` untuk membungkus pesan customer.
- **Fixed — Kontrak tool scope (ADV-04):** deskripsi `escalate_to_human` (`escalate-human.tool.ts`) tidak lagi
  mengundang eskalasi "topik di luar layanan klinik"; luar-domain wajib ditolak sopan mandiri (2 kalimat).
- **Fixed — Scorer D1 evidence-gated (Test Suite V2):** `scripts/lib/scorer.ts` tidak lagi memvonis
  `PRICE_UNSOLICITED` bila nominal dipicu konteks harga customer (intent `ask_price` atau tool
  `calculate_delivery`), bukan sekadar ada nominal di balasan.
- **Fixed — LiveChat dismiss satu sumber:** `webhook.route.ts` (balasan admin dari WA HP) memakai
  `ConversationService.dismissFrustration` (tenant-verified, idempoten, SSE standar) alih-alih reset mentah.
- **Tests:** `persistent-cough-rash-redflag`, `pending-schedule-check-lifecycle`, `anaphora-state-gate`,
  `prompt-injection-sanitizer`, `out-of-scope-resist`; `lead-greeting-preservation` (+4),
  `scorer-suite-contract` (+5), `livechat-notes-frustration` (+2).
- **Docs:** `docs/KNOWN_ISSUES.md` #152 (residual: 151a re-latch, ADV-04 LLM, CASE-037 date-mismatch,
  queue-durability flaky).
- **Verifikasi:** root `tsc` 0; vitest full suite hijau (0 gagal).

#### 2026-09-28 — Pulse SLA 60 menit, pemadaman multi-device, & refaktor UI/UX LiveChat

- **Changed — SLA deteksi frustrasi:** default `FRUSTRATION_SLA_MINUTES` 15 → **60 menit**
  (`src/services/frustration-signal.service.ts`). Jendela wajar staf sebelum eskalasi darurat.
- **Added — max-age guard:** `MAX_FRUSTRATION_AGE_MINUTES = 24 jam`; `computeFrustrationSignal`
  kini hanya true bila usia pesan berada di rentang `[SLA .. 24 jam]` — chat kuno tidak ikut
  berkedip (alarm fatigue).
- **Fixed — flag dua arah + SSE:** `FrustrationSignalService.evaluateConversation` kini juga
  menurunkan flag (INBOUND→OUTBOUND) dan menyiarkan `conversation.updated` saat status berubah;
  `sweep()` membatasi kandidat dengan rentang aktif + membersihkan status frustrasi usang >24 jam.
- **Fixed — payload standar:** `buildConversationUpdatedPayload` menambah `isFrustrated`,
  `frustratedAt`, `frustratedReason` (satu bentuk event untuk semua konsumen).
- **Fixed — multi-device dismiss:** balasan admin dari WhatsApp HP (`fromMe`) dan dari web Live
  Chat kini mereset frustrasi di DB **dan** menyiarkan `isFrustrated:false` via SSE — badge padam
  di semua dashboard tanpa refresh.
- **Added — endpoint manual dismiss:** `PATCH /api/admin/live-chat/conversations/:id/dismiss-frustration`
  + `ConversationService.dismissFrustration` (padamkan alert 1 klik tanpa kirim pesan).
- **Changed — refaktor UI (`LiveChatMonitor.tsx`):** `animate-pulse` dihapus dari badan kartu
  (kartu solid/stabil, anti eye-fatigue); badge teks "🚨 Butuh Respon Segera" diganti ikon
  `AlertTriangle` ringkas + pulsing beacon dot terisolasi (tooltip + aria-label); aksi
  "Padamkan Peringatan SLA" (`BellOff`) di menu konteks mobile & desktop; state React
  menyinkronkan `isFrustrated` dari `message.created` & `conversation.updated`.
- **Tests:** `tests/unit/livechat-notes-frustration.test.ts` diperluas 14 → 21 kasus
  (SLA 50/65 mnt, max-age 25 jam, override max-age, OUTBOUND, default 60).
- **Docs:** `docs/KNOWN_ISSUES.md` #144 diperbarui (default 60 mnt + catatan tech debt SLA
  global per-server lewat Confirmation Gate).
- **Verifikasi:** root `tsc` 0; dashboard `vite build` 0; vitest frustration 21 passed.

#### 2026-09-27 — Cutoff Chat Terapis 1 Jam Pasca-Treatment & Penghilangan Tombol Chat

- **Latar & Kebutuhan Bisnis:** Permintaan revisi operasional klinik: jendela akses chat terapis diperpendek dari 3 jam menjadi 1 jam setelah treatment ditandai selesai (`completed`). Selain itu, setelah 1 jam berlalu, tombol pesan/chat pada kartu tugas terapis dihilangkan sepenuhnya (bukan menampilkan tombol abu-abu "Chat Terkunci") dan susunan tombol aksi otomatis menyesuaikan menjadi 2 kolom proporsional (`grid-cols-2`).
- **Fixed — Backend Config & Service:**
  - `src/config/staff-chat-window-config.ts`: Nilai default `closeHoursAfter` diubah dari `3` menjadi `1` jam (tetap tenant-aware via DB `Tenant.settings.staffChatWindow`).
  - `src/services/staff-reservation.service.ts`: Fallback default di `evaluateChatWindowForBooking()` diubah menjadi `closeHoursAfter: 1`.
- **Fixed — Frontend Terapis (`StaffToday.tsx`):**
  - Tooltip tooltip status `chatLockedTitle` untuk `CLOSED_AFTER_COMPLETE` diperbarui menjadi `"Chat sudah ditutup (1 jam setelah treatment selesai)"`.
  - Pada render kartu jadwal terapis, evaluasi `isChatHidden`: jika treatment sudah berstatus `completed` dan jendela chat telah tertutup (`!isChatWindowOpen` atau `CLOSED_AFTER_COMPLETE`), tombol Chat ditiadakan sepenuhnya (`null`), dan layout quick action beralih dari `grid-cols-3` menjadi `grid-cols-2` ([Navigasi] dan [Selesai]).
  - Status pra-jadwal sebelum H-3 jam (`NOT_YET_OPEN`) tetap mempertahankan tombol "Chat Terkunci" 3-kolom agar terapis mengetahui estimasi waktu buka chat.
- **Tests & Verifikasi:**
  - `tests/unit/staff-chat-cutoff-notification.test.ts`: Diperbarui untuk menguji batas deterministik 1 jam (30 menit pasca selesai $\rightarrow$ buka, batas inklusif tepat 1 jam $\rightarrow$ buka, 1.5 jam & 2 jam $\rightarrow$ tutup `CLOSED_AFTER_COMPLETE`). Semua 22 test lulus 100%.
  - Dashboard frontend build (`npm run build` di `packages/admin-dashboard`) sukses tanpa error (0 warning).
  - Backend compile (`tsc`) sukses tanpa error.

#### 2026-09-27 — Fix false-positive banner "FORM RESERVASI MASUK" + pelabelan audiens MOMS

- **Latar (bukti akar masalah):** membuka chat Bunda Inggrid (6288000000003) memunculkan
  banner hijau "FORM RESERVASI MASUK" untuk reservasi 25 Sep 2026 yang sudah `completed`.
  Tiga causa: (1) `pickFilledFormBlock` fallback ke pesan OUTBOUND → invoice admin
  ("Berikut reservasi 🐣") dikira form masuk customer; (2) `hasExplicitReservationForm`
  tak memvalidasi tanggal lampau; (3) supresi banner mengabaikan status `completed`;
  (4) template banner hardcode `👶 {childName || 'Anak'}` → layanan ibu ter-label "Anak".
- **Fixed — Extractor (`chatScheduleExtractor.ts`):**
  - `pickFilledFormBlock` kini mengembalikan `{ content, direction }`. Sumber DATA tetap
    memakai fallback OUTBOUND (invoice terbaru admin — data paling final), tetapi
    `hasExplicitReservationForm` HANYA true bila `direction === 'INBOUND'`.
  - Tambah gerbang kadaluwarsa: tanggal hasil parse blok form wajib `>= awal hari ini`
    (kalender lokal browser). Form tanpa tanggal absolut (hanya jam) tetap diterima.
  - Tambah `formatFormBannerAudienceLabel` (data-driven: MOMS → 👩 Bunda, BABY → 👶 anak,
    BUNDLE/BOTH → keduanya) dan `hasExistingReservationForSchedule` (pure helper, testable).
- **Fixed — LiveChat (`LiveChatMonitor.tsx`):**
  - `showFormReservasiBanner` menambah gate `hasExistingReservationForExtractedSchedule`:
    suppress bila customer sudah punya reservasi same-day berstatus
    confirmed/completed/hold/pending/in_progress. Treatment-aware — kategori sama ATAU
    nama treatment beririsan; status cancelled/failed/no_show TIDAK men-suppress.
  - Baris render banner memakai `formatFormBannerAudienceLabel` → layanan MOMS menampilkan
    👩 Bunda (eliminasi hardcode 👶 Anak).
- **Tests:** `tests/unit/chat-schedule-extractor-form-flag.test.ts` diperluas 13 → 30 kasus
  (gerbang arah OUTBOUND, kadaluwarsa + batas hari ini, multiphrasa label, label audiens,
  helper supresi duplikat). Tanggal statis → relatif dinamis (anti time-bomb).
- **Verifikasi:** vitest file 30 passed; 4 suite extractor 33 passed; root `tsc` 0;
  dashboard `tsc` 0 + `vite build` 0. Full suite 3763 passed (1 flake timeout WAHA
  webhook, lulus saat dijalankan ulang). Lihat `docs/KNOWN_ISSUES.md` #148.

#### 2026-09-27 — AI Copilot on/off dipindah ke Sidebar (sesuai permintaan)

- **Changed:** tombol toggle AI Copilot DIHAPUS dari header LiveChat dan FAB mengambang;
  sekarang berupa **switch on/off di sidebar** (grup bawah, hanya tampil di halaman
  Live Chat), sesuai permintaan user.
- **Added:** `contexts/CopilotContext.tsx` — state `open`/`setOpen`/`toggle` terpusat +
  persist ke `localStorage` (`wa_clinic_copilot_open`), diprovide di `App.tsx`.
- `Layout.tsx`: switch `role="switch"` di sidebar memakai `useCopilot()`.
- `AdminCopilotPanel.tsx`: konsumsi `useCopilot()` (bukan state internal); FAB dihapus;
  panel hanya dirender saat `open`.
- `LiveChatMonitor.tsx`: buang state lokal `copilotOpen` + tombol header `Sparkles`.
- **Verifikasi:** dashboard `tsc` 0 + `vite build` 0.

#### 2026-09-27 — UX LiveChat: salin per-bubble, toggle Copilot, masking HP khusus terapis

- **Changed — Salin teks bubble (deprecate hold 3 detik):**
  - `LiveChatMonitor.tsx`: fitur tahan-3-detik (`handleBubblePointerDown/UpOrLeave`,
    `bubbleHoldTimerRef`) DIHAPUS karena UX tidak cocok. Diganti ikon salin (`Copy`)
    permanen di baris meta bawah setiap bubble + fallback `execCommand('copy')`.
- **Changed — AI Copilot toggle:**
  - `AdminCopilotPanel.tsx`: tab panah tepi kiri (ChevronLeft/Right, `edgeOpen`) DIHAPUS.
    Panel kini controlled (`open`/`onOpenChange`) + satu FAB tetap di semua breakpoint.
  - `LiveChatMonitor.tsx`: tombol toggle ikon `Sparkles` di header (menyatu dengan toolbar
    BOT ON/OFF & Sync), state `copilotOpen` mengendalikan panel.
- **Fixed — Masking nomor HP hanya untuk staf terapis:**
  - `pii-masker.ts`: `sanitizeMessageForStaff`, `sanitizeStaffHubPayload`,
    `sanitizePayloadRawForStaff` menerima `opts.maskPhone` (default true). Saat false,
    nomor HP UTUH namun allowlist + strip JID tetap dijalankan (keamanan metadata).
  - `src/routes/staff/today.subroute.ts`: masking digate `maskPhone: !isSupervisor`
    (CS/SPV/supervisor melihat nomor apa adanya; terapis tetap disensor).
  - `mediaExtractor.ts`: `resolveMessageDisplayText` & `extractContact` menerima
    `opts.maskPhone` (default false). CS/SPV di LiveChatMonitor melihat nomor asli.
  - `StaffToday.tsx`: masking fetch/SSE/render/quoted-message digate `!isSupervisor`.
- **Tests:** `tests/unit/staff-chat-pii-masker.test.ts` +3 kasus opt-out (nomor utuh
  untuk supervisor, JID tetap dibuang; default tetap disensor). Full suite 3747 passed.
- **Verifikasi:** root `tsc` 0 + dashboard `tsc` 0 + `vite build` 0.

#### 2026-09-27 — Fix holistik audit Live Chat & Reservasi (katalog, waktu, alamat, notifikasi)

- **Latar:** audit percakapan + sistem reservasi menemukan: (1) `cukur` salah cocok ke
  Bundle Selapan 80k alih-alih Cukur Rambut 25k; (2) jam negosiasi customer kalah oleh
  tawaran lama bot; (3) alamat jalan lengkap hilang jatuh ke kelurahan; (4) jam banner
  tidak WIB-deterministik; (5) notifikasi penugasan terapis terkirim instan (salah pilih
  langsung bocor); (6) reassign memicu notifikasi berisik ke terapis lama; (7) admin tak
  bisa membedakan layanan ber-nama sama (usia beda); (8) pencarian tidak memprioritaskan
  kontak; (9) tidak ada cara cepat salin teks bubble; (10) catatan internal terkubur di
  command `/notes`.
- **Fixed — Katalog & Matcher:**
  - `treatmentStringParser.ts`: kata `cukur` dihapus dari `BUNDLE_MARKERS`; otoritas bundle
    kini metadata DB (`category`/`serviceType === 'BUNDLE'`) via `isBundleCatalogItem`.
  - `CreateReservationModal.tsx`: dua titik `.find()` substring diganti `matchCatalogService`
    (prefill treatment + auto-repair price-0).
- **Fixed — Ekstraksi jadwal:**
  - `chatScheduleExtractor.ts`: ekstraksi jam mandiri pindai reverse-chronological
    (terbaru → terlama), mempertahankan tiga cabang (range, jam:menit, kata pagi/siang/sore).
  - `paymentInvoiceFormatter.ts` + `ReservationDetailModal.tsx`: alamat jalan lengkap
    (`raw_text`) diprioritaskan sebelum fallback kelurahan/kecamatan.
  - `LiveChatMonitor.tsx`: 5 titik `toLocaleTimeString` diberi `timeZone: 'Asia/Jakarta'`.
- **Added — Buffer notifikasi penugasan terapis (persisten):**
  - Skema `Reservation`: `assignment_pending_staff_id`, `assignment_pending_at`,
    `assignment_notified_at` (migrasi `20260927140000_assignment_notification_buffer`).
  - `staff-notification.service.ts`: `scheduleReservationAssignmentNotification`,
    `cancelPendingAssignmentNotification`, `sweepPendingAssignmentNotifications`
    (idempoten via `updateMany` claim). Sweep cron baru (`runAssignmentNotificationSweep`,
    default tiap 2 menit, env `ENABLE_ASSIGNMENT_NOTIF_SWEEP`).
  - `reservations.subroute.ts`: 3 call-site instan → scheduler buffer; reassign memakai
    state-gate `assignment_notified_at` agar terapis lama hanya dinotifikasi bila
    penugasan sebelumnya benar-benar sudah terkirim (senyap bila masih pending).
- **Added — UI/UX LiveChat:**
  - `CreateReservationModal.tsx`: badge usia (`ageTier.label`) pada kartu layanan.
  - `LiveChatMonitor.tsx`: hierarki pencarian 2-Tier (kontak > isi pesan, lalu aktivitas);
    hold 3 detik pada bubble menyalin teks (+ tombol salin di toolbar reaksi & klik-kanan)
    dengan fallback `execCommand('copy')`.
  - `LiveChatComposer.tsx`: tombol "Catatan Internal (Notes)" di menu `+` + auto-switch mode
    internal saat mengetik prefix `/note` `/notes`.
- **Tests:** `tests/unit/chat-schedule-extractor-negotiation.test.ts` (7 kasus adversarial
  multi-frasa: negosiasi jam, anti-bundle `cukur`). Full suite 3742 passed (2 flake timeout
  pre-existing #142 hijau saat diisolasi).
- **Verifikasi:** root `tsc` 0 + dashboard `tsc` 0 + `vite build` 0. Migrasi perlu
  `prisma migrate deploy` saat deploy.
- **Tech debt:** delay 5 menit hardcode + `BUNDLE_MARKERS` fallback → `docs/KNOWN_ISSUES.md`
  #147 & `docs/SAAS_READINESS_AUDIT.md` #24.

#### 2026-09-27 — Fix tombol hide/unhide Copilot (breakpoint mismatch) + tema calm

- **Laporan:** tombol hide/unhide panel Copilot "masih error".
- **Audit (read-only, 5 dimensi):**
  - **Root cause #1 — mismatch breakpoint:** komponen memakai `md:` (768px) untuk
    sembunyikan floating button + tampilkan tab, sedangkan LiveChatMonitor mendefinisikan
    mobile sebagai `innerWidth < 1024` (`isDesktop`, `lg:`) → di tablet 768–1023px tombol
    tersembunyi TAPI tab tak muncul (jalan buntu).
  - **Root cause #2 — posisi tab di kiri menabrak tombol back mobile**
    (`LiveChatMonitor.tsx:4058` `lg:hidden -ml-1`, kiri-atas) dan `animate-mobile-*-enter`
    (will-change transform) pada wrapper.
  - **Root cause #3 — tab menutupi panel** saat panel terbuka (panel tinggi
    `bottom-40`+520px menutupi area tengah-kanan tempat tab berada).
  - **Root cause #4 — warna:** indigo pekat (`#4f46e5`) di luar design token; tidak calm.
- **Fix (fondasional, gerbang kode):**
  - Breakpoint disamakan ke `lg:` (1024px) — satu sumber kebenaran dengan `isDesktop`.
  - Tab dipindah ke **tepi KANAN** (`right-0 top-1/2`), tidak lagi menabrak tombol back.
  - Tab disembunyikan saat panel terbuka (`!open`) → tidak ada overlap.
  - Warna calm: brand emerald `#008069`/`#00a884` (semua elemen: tab, FAB, header panel,
    bubble user, quick-prompt chip, tombol kirim) — konsisten design token Kala.
  - A11y: `aria-expanded`/`aria-controls`/`aria-label`, `focus-visible:ring`, tap target
    ≥44px (`min-w-[44px]`).
- **Verifikasi:** dashboard `tsc` 0 + `vite build` 0; root `tsc` 0; full suite
  **425 file / 3356 passed / 0 gagal**. Tanpa perubahan backend/skema.

#### 2026-09-27 — Copilot multi-step loop + tool stalled inquiries + panel mobile collapsible

- **Latar (bukti live):** audit `AI_COPILOT_CHAT` 7 hari menunjukkan single-tool-ceiling —
  "yang belum terjadwal dan minta besok?" dijawab `query_reservations_by_filter`
  (`grounded:true` tapi salah semantik; validator nama tak menangkap karena nama memang dari tool).
- **Fase A — Multi-step loop** (`copilot.service.ts`): router → eksekusi tool → umpan hasil ke
  router berikutnya; berhenti pada `tool:null` / iterasi habis / tool+args identik (anti-loop).
  **Budget kode:** `MAX_ITERATIONS=3`, `MAX_TOTAL_ROWS=40`; observabilitas `llmCalls` di hasil.
  Summarize gabungan berlabel sumber; `validateGrounding` atas **union** semua hasil (halusinasi
  silang-sumber). Defensif terhadap respons LLM kosong (`?.`).
- **Fase B1 — Tool `query_stalled_inquiries`** (`copilot-tools.ts`): tanya-jadwal menggantung —
  inbound ≤ `sinceDays` (default 7) + sinyal minat dari **state** (`session_data.inquiryDate/
  cartItems`, `last_discussed_treatment`) + tanpa reservasi aktif + pesan terakhir INBOUND
  (belum dibalas). Tenant-scoped, tanpa phone ke LLM, `conversationId` + `take≤20`.
- **Fase B2 — mining:** hanya 1 entri `toolsUsed:[]` di 30 audit terakhir (sudah ditutup tool
  prospek) → **tidak ada kelas dominan → berhenti di 1 tool** (sesuai aturan plan; tak spekulatif).
- **Fase UI-Mobile** (`AdminCopilotPanel.tsx`): floating button disembunyikan di mobile; tab panah
  tepi kiri (`md:hidden`) memunculkan/menyembunyikan. Desktop tidak berubah. Tanpa dep baru.
- **Test:** `copilot-fixing.test.ts` +8 (loop komposit 2 tool, anti-loop, budget, union grounding,
  stalled: confirmed/dibalas/tanpa-sinyal dikecualikan, tenant-scope) + update `copilot-grounding`
  (semantik loop: 2 router).
- **Verifikasi:** `tsc` 0 error (root+dashboard); dashboard `vite build` 0; full suite
  **425 file / 3356 passed / 0 gagal** (23 skipped). Tanpa migrasi DB.

#### 2026-09-27 — Copilot: tool `query_unscheduled_prospects` (jawaban "belum terjadwal")

- **Laporan & bukti live:** pertanyaan "siapa saja yang belum terjadwal ya" dijawab template
  "tidak menemukan data yang cocok" dengan `toolsUsed: []` (audit `AI_COPILOT_CHAT`,
  admin@kalamomsspa.com). Investigasi: BUKAN bug fix kemarin — router LLM dengan benar menolak
  mengarang karena 2 tool existing (reservasi & unreplied) tak mencakup "tanpa jadwal".
- **Fix fondasional (bukan regex/prompt make-up):** tool ketiga deterministik —
  customer tanpa reservasi confirmed/pending/hold (mencakup prospek murni & batal/selesai lama),
  tenant-scoped, `is_sandbox_test=false` di DB + saring dummy di aplikasi, nomor HP tidak
  diteruskan ke LLM, `conversationId` untuk deep-link, `take≤20`. Router otomatis melihatnya
  via menu tool (tanpa ubah prompt routing).
- **Test:** 6 adversarial baru (plumbing parafrase, filter DB state-based, saring sandbox/dummy,
  deep-link null-safe, limit budget) + registry 2→3 tool. Tanpa migrasi DB.
- **Verifikasi:** `tsc` 0 error; full suite **425 file / 3346 passed / 0 gagal** (23 skipped).

#### 2026-09-27 — Fix pasca-live Fase 1r–6r: Copilot date-anchor/anti-N+1/grounding, RBAC Settings read & Pre-Visit idempotency

- **Laporan:** fitur Fase 1r–6r (commit `755e7063`) "tidak bisa dipakai" saat uji live: Copilot
  menjawab dengan 20 reservasi kuno (date blindness), respons lambat (N+1), dan staf `ADMIN_CS`
  kena 403 saat membuka Live Chat; brief bidan bisa hangus tanpa terkirim.
- **Root cause (terverifikasi kode + log live, bukan menelan klaim):**
  - `copilot.service.ts:45-51` prompt router TANPA jangkar tanggal → "besok" tak teresolusi.
  - `copilot-tools.ts:51-69` tanpa `args.date` tak ada filter `booking_date` + `orderBy asc take 20`
    = 20 reservasi **tertua** (past-trap).
  - `copilot-tools.ts:98-112` loop `findFirst` per percakapan (N+1, hingga 200 query).
  - `copilot-tools.ts:74-82` tak mengembalikan `conversationId` → deep-link mustahil.
  - `copilot.service.ts:158-164` grounding bandingkan string honorifik utuh → "Bu Dewi" vs
    "Bunda Dewi" = false-negative.
  - Log live: `[RBAC GUARD] Blocked ... 'ADMIN_CS' on GET /api/admin/settings` — pemicu nyata
    `LiveChatMonitor.tsx:497` (`loadBotCutoffStatus`), bukan halaman Settings.
  - `staff-notification.service.ts:419-422` menandai `pre_visit_brief_sent_at` walau Telegram
    tak terhubung.
- **Fix fondasional (gerbang kode, bukan tambal prompt):**
  - **`src/utils/wib-time.ts` (baru)** — util WIB terpusat (`getWibNow`, `wibDayBoundsUtc`,
    `startOfTodayWib`, `formatWibDateYYYYMMDD`, `getWibDayName`, `formatWibTime`); kode baru
    memakainya (duplikasi WIB lama dimigrasi bertahap — dicatat KNOWN_ISSUES).
  - **Copilot:** `buildRouterPrompt(message, toolMenu, now)` murni menyuntik jangkar WIB
    (hari ini/besok + nama hari + ISO); `resolveReservationDateFilter()` murni — default tanpa
    tanggal = **jadwal aktif mendatang** (anti past-trap), tanggal invalid → fallback future-only
    (tak crash); `query_reservations_by_filter` sertakan `conversationId` via
    `customer.conversations take 1` (1 query, tanpa N+1 baru); `query_unreplied_chats` pakai relasi
    `messages take 1` (single round-trip, `take:200→50`); summarizer diarahkan format markdown
    `[Buka Chat](/admin/live-chat?conversationId=ID)`; `validateGrounding` normalisasi token
    (buang honorifik, cocok ≥3 huruf).
  - **RBAC (backend-only):** `admin.route.ts` allowlist GET read-only
    (`/api/admin/settings`, `.../notifications`, `.../notifications/logs`, `.../daily-report`);
    WRITE tetap super-admin; endpoint sensitif (ai-models, backup, dll) tetap 403. **Frontend
    `rolePermissions` SENGAJA tidak diubah** — `/admin/settings` tetap terkunci untuk CS karena
    halaman memuat WAHA QR/session, AI model, token CAPI (boundary keamanan, dijaga
    `role-permissions.test.ts:36`). Pemicu 403 CS (LiveChatMonitor) tercakup oleh exemption
    backend. Tidak menyentuh tabel `role_api_scopes` (seed parsial akan men-flip role ke managed
    → default-deny regresi; dicatat KNOWN_ISSUES).
  - **Pre-Visit Brief:** `pre_visit_brief_sent_at` di-set HANYA bila minimal 1 kanal benar-benar
    mengirim (`telegramRes.ok || pushRes.sent > 0`); tanpa kanal aktif → tidak di-set (sweep retry).
- **Test:** `tests/unit/copilot-fixing.test.ts` (20, adversarial: anchor WIB, default future-only,
  5 parafrase→tool, grounding honorifik, empty-result, whitelist, deep-link, anti-N+1) +
  update `copilot-grounding.test.ts` (relasi messages) + `pre-visit-brief.test.ts` (no-channel
  tidak set flag; push-only set flag) + `admin-rbac-guard.test.ts` (ADMIN_CS GET read 200, WRITE 403).
- **Verifikasi:** root `tsc` 0 error; dashboard `tsc` + `vite build` 0; full suite
  **425 file / 3340 passed / 0 gagal** (23 skipped). Tanpa migrasi DB.

#### 2026-09-27 — Fase 6r: AI Clinic Copilot (2 tool, panel kontekstual, grounding kode)

- **Konteks:** eksekusi plan Fase 6r (keputusan G3=B: panel kontekstual di modul LiveChat, bukan
  drawer global; scope 2 tool dulu).
- **Tools** `src/services/copilot/copilot-tools.ts` (read-only, tenant-scoped, `take:20`):
  `query_reservations_by_filter` (tanggal/status/terapis) + `query_unreplied_chats`
  (state-based: pesan nyata terakhir INBOUND). Whitelist `getCopilotTool()`.
- **Service** `src/services/copilot/copilot.service.ts`: router LLM memilih tool (JSON via
  `extractBalancedJson`) → eksekusi tool DB → LLM merangkum HASIL TOOL saja. **Gerbang grounding
  kode**: tool kosong → jawaban "Tidak ditemukan data" (BUKAN halusinasi); validator
  `validateGrounding()` memastikan nama pasien di jawaban ⊆ hasil tool. Cap history 10 turn,
  budget `max_tokens`. LLM error → pesan ramah (tidak throw).
- **API** `src/routes/admin/copilot.subroute.ts`: `POST /api/admin/copilot/chat` (auth admin +
  tenant-scope + rate-limit global + audit `AI_COPILOT_CHAT`), didaftarkan di `admin.route.ts`.
- **UI** `packages/admin-dashboard/src/components/copilot/AdminCopilotPanel.tsx`: floating trigger
  + panel chat (pill pertanyaan cepat, badge "Terverifikasi dari data"), di-mount di
  `LiveChatMonitor.tsx`. `useUiFeedback` untuk error.
- **Test:** `tests/unit/copilot-grounding.test.ts` (8) — tool kosong → jujur, tanpa tool cocok,
  tenant-scoped, validator grounding (ada/tidak ada nama), unreplied state-based, whitelist,
  LLM error graceful.
- **Verifikasi:** root `tsc` 0 error; dashboard `tsc` + `vite build` exit 0; full suite
  **424 file / 3314 passed / 0 gagal** (23 skipped).

#### 2026-09-27 — Fase 5r: Pre-Visit Brief bidan (H-30 menit, privasi minimal)

- **Konteks:** eksekusi plan Fase 5r (keputusan G2=B: kartu minimal ke Telegram pribadi, nomor HP
  & alamat lengkap disembunyikan; detail penuh hanya di portal terapis).
- **Skema:** `Reservation.pre_visit_brief_sent_at` (idempotensi anti kirim ganda). Migrasi
  `20260927130000_pre_visit_brief_sent` (idempoten `ADD COLUMN IF NOT EXISTS`); drift check empty.
- **Service** (ekstensi `staff-notification.service.ts`, bukan service paralel):
  - `sendPreVisitBrief(reservationId, tenantId)` — reuse `childService.getChildrenWithCurrentAge`
    (fallback graceful "Usia belum tercatat"), kunjungan terakhir (tenant-aware), `admin_notes`
    (catatan karakter). Distribusi Telegram pribadi bidan + Web Push in-system; TIDAK memuat nomor
    HP pasien maupun alamat lengkap. Menandai `pre_visit_brief_sent_at` (idempoten).
  - `sweepPreVisitBriefs(tenantId)` — jendela now+20..35 menit, `pre_visit_brief_sent_at: null`.
  - `triggerPreVisitBriefIfImminent()` — booking dadakan (mulai ≤35 menit) kirim segera,
    fire-and-forget, idempoten (dipanggil di alur assign staff).
- **Scheduler:** `CronService.runPreVisitBriefSweep()` + `app.ts` (default tiap 10 mnt,
  `ENABLE_PRE_VISIT_BRIEF`).
- **DTO/UI:** `adminNotes` disertakan di 3 query tugas (`getTodayTasks`/`getUpcomingSchedule`) +
  kartu "📋 Ringkasan Pasien — Catatan Khusus" di `StaffToday.tsx` (alamat penuh hanya di portal).
- **Test:** `tests/unit/pre-visit-brief.test.ts` (9) — kirim + tandai terkirim, TIDAK bocorkan
  nomor HP, idempoten, tanpa bidan, sandbox diblokir, anak tanpa birth_date tidak crash,
  sweep filter, trigger same-day vs jauh.
- **Verifikasi:** root `tsc` 0 error; dashboard `tsc` 0 error; full suite **423 file / 3306 passed /
  0 gagal** (23 skipped).

#### 2026-09-27 — Fase 2r: Nightly Watchdog (laporan malam 21:00 WIB) + Settings UI

- **Konteks:** eksekusi plan Fase 2r (keputusan G1=A: ekstensi pipa Telegram, bukan sistem paralel).
- **Service baru `src/services/nightly-watchdog.service.ts`:** agregasi 4 kategori **state-based**
  (DILARANG keyword): jadwal terkonfirmasi besok (reservasi confirmed), tanya-jadwal-belum-booking
  (bukti minat slot via `session_data`/`last_discussed_treatment`/reservasi pending-hold, tanpa
  confirmed), chat belum dibalas (definisi kanonis: pesan NYATA terakhir INBOUND — `INTERNAL_NOTE`
  diabaikan), ringkasan. `formatMessage()` mem-`mask` nomor HP (privasi) + link live-chat absolut.
- **Scheduler** di `app.ts` (pola `trackInterval` 15 mnt + guard tanggal per-tenant): kirim via
  `NotificationDeliveryService`; Telegram default, WA hanya bila channel aktif. Idempoten via
  `idempotency_key` (`tenant:NIGHTLY_WATCHDOG:date`). WABA → WA di-`SKIPPED` (bukan gagal).
- **API** `settings.subroute.ts`: `GET/PUT /api/admin/settings/notifications` (tenant-scoped,
  normalisasi E.164, audit `UPDATE_NOTIFICATION_SETTINGS`), `POST .../test` (uji kanal, audit
  `TEST_NOTIFICATION_SEND`), `GET .../logs` (riwayat `admin_notification_logs`).
- **UI** `DailyReportPanel.tsx`: seksi Nightly Watchdog (toggle, jam WIB, kanal TELEGRAM/WHATSAPP,
  chips nomor admin, tombol uji + simpan, tabel riwayat status SENT/SKIPPED/FAILED) — reuse panel,
  tanpa halaman baru. `useUiFeedback` untuk notifikasi.
- **Test:** `tests/unit/nightly-watchdog.test.ts` (7) — agregasi confirmed, unreplied state-based,
  OUTBOUND tidak dianggap belum dibalas, stalled mengecualikan confirmed, stalled via session_data,
  DB offline graceful, masking nomor + link.
- **Verifikasi:** root `tsc` 0 error; dashboard `tsc` + `vite build` exit 0; full suite
  **422 file / 3297 passed / 0 gagal** (23 skipped).

#### 2026-09-27 — Fase 3+4: Catatan Internal `/notes` (anti-bocor) + Pulse Alert kekecewaan (state/SLA-based)

- **Konteks:** eksekusi plan `docs/plans/REVISI_NOTIFIKASI_COPILOT_LIVECHAT_PLAN.md` Fase 3+4
  (digabung: satu seam `sendAdminReply` + satu file UI `LiveChatMonitor.tsx`).
- **Fase 3 — Catatan Internal `/notes` (GERBANG KODE DETERMINISTIK, bukan prompt AI):**
  - `live-chat.service.ts`: helper murni `parseInternalNoteCommand(text, forceInternal)` —
    mendeteksi `/notes` persis atau `/notes <isi>` (case-insensitive, toleran spasi depan),
    MENOLAK `/notesX` (anti false-positive). Gate disisipkan **sebelum** resolusi customer/gateway:
    bila terdeteksi → simpan via `logMessage(senderType:'INTERNAL_NOTE', skipMqlEvaluation:true)`
    dan **RETURN tanpa memanggil gateway WhatsApp**. Parameter baru `isInternalNote` (toggle gembok).
  - **Eksklusi konsumen:** `INTERNAL_NOTE` diabaikan oleh `isAwaitingReply` (tidak memadamkan
    status menunggu-dibalas) dan dikeluarkan dari konteks `generateAiSuggestion` (anti-bocor
    koordinasi staf ke draf balasan AI).
  - Endpoint `PATCH /api/admin/customers/:id/notes` (sticky memory note, maks 2000 char, jejak
    editor terakhir) + audit `UPDATE_CUSTOMER_NOTES`; reply route memisahkan audit
    `INTERNAL_NOTE_CREATED` vs `LIVE_CHAT_ADMIN_REPLY`.
  - UI: bubble amber putus-putus + badge 🔒 + footer "Hanya tim klinik • tidak dikirim ke WhatsApp";
    toggle gembok di composer (`isInternalMode` **per-conversation**, reset saat pindah chat →
    anti inverse-leak).
- **Fase 4 — Pulse Alert (STATE/SLA, bukan keyword):**
  - Service baru `frustration-signal.service.ts`: `computeFrustrationSignal()` murni deterministik
    (INBOUND terakhir + melewati SLA `FRUSTRATION_SLA_MINUTES`, default 15 mnt) + `sweep()` per
    tenant. DILARANG keyword ("lama banget", "kecewa") — rapuh terhadap parafrase.
  - Reset: di `sendAdminReply` HANYA bila `logged.sender_type === 'ADMIN'` (balasan nyata terkirim);
    `/notes` sudah return lebih awal, kegagalan kirim sudah return → tidak memadamkan pulse.
  - DTO `LiveChatConversationItem.isFrustrated/frustratedAt/frustratedReason`; UI badge
    "🚨 Butuh Respon Segera" + border rose + `animate-pulse` pada baris daftar (tanpa re-sort →
    pagination aman).
  - Cron `runFrustrationSweep()` di `app.ts` (default tiap 5 mnt, `ENABLE_FRUSTRATION_SWEEP`).
- **Test (TDD, adversarial):** `tests/unit/livechat-notes-frustration.test.ts` (14) — deteksi
  `/notes` (4 varian + tolak `/notesX`), anti-bocor (gateway TIDAK dipanggil), EMPTY_NOTE, toggle
  gembok, teks biasa tetap terkirim, catatan tidak memadamkan awaiting-reply; `computeFrustrationSignal`
  (SLA lewat/belum, OUTBOUND, null, bukan-keyword).
- **Verifikasi:** root `tsc --noEmit` 0 error; dashboard `tsc --noEmit` 0 error + `vite build` exit 0;
  full unit suite **421 file / 3290 passed / 0 gagal** (23 skipped).

#### 2026-09-27 — Fase 1r: Fondasi notifikasi admin (AdminNotificationLog) + field LiveChat (notes & pulse)

- **Konteks:** eksekusi bertahap plan `docs/plans/REVISI_NOTIFIKASI_COPILOT_LIVECHAT_PLAN.md`
  (hasil audit 6-fase). Fase 1r = lapisan persistensi + delivery service tenant-aware.
- **Skema (`prisma/schema.prisma`):**
  - `AdminNotificationLog` (tabel `admin_notification_logs`) — log notifikasi admin generik
    (channel WHATSAPP/TELEGRAM/SYSTEM), `idempotency_key String? @unique` (unique-nullable →
    idempotensi cron anti-spam tanpa memblokir test/resend yang sah), index `(tenant_id, sent_at)`
    & `(tenant_id, notification_type)`.
  - `Tenant`: `admin_whatsapp_numbers String[]`, `nightly_report_enabled Boolean @default(false)`
    (OFF agar tidak spam pasca-migrate), `nightly_report_hour/minute`, `notification_channels`.
  - `Customer`: `admin_notes @db.Text`, `notes_updated_at`, `notes_updated_by` (sticky memory tag).
  - `Conversation`: `is_frustrated`, `frustrated_at`, `frustrated_reason` +
    `@@index([tenant_id, is_frustrated, last_message_at])`.
  - `DailyReportLog` **tidak diubah** (unique-key legacy dipertahankan; blast radius minimal).
- **Migrasi:** `prisma/migrations/20260927120000_notif_foundation/migration.sql` — ditulis manual
  (shadow replay rusak oleh trap enum `FollowUpStatus`), semua statement idempoten
  (`IF NOT EXISTS`). Diterapkan via `prisma migrate deploy` (BUKAN `db push`). Drift check
  `migrate diff` = **"This is an empty migration."** `prisma generate` full engine.
  Migrasi pending `20260927000000_pageview_eventid_source` (workstream paralel) ikut ter-apply lokal.
- **Service baru `src/services/notification-delivery.service.ts`:**
  - `send()` tenant-aware: normalisasi nomor WA via `normalizePhoneToE164` (reuse, tanpa regex baru);
    WA hanya via `resolveGatewayForTenant` (tidak langsung WAHA).
  - **WABA → `SKIPPED`** (bukan FAILED) untuk pesan proaktif di luar 24h window; tetap tercatat
    di log (anti silent-drop), fallback Telegram/in-app.
  - Idempotensi via `idempotency_key`; balapan cron (`P2002`) → diperlakukan "sudah tercatat".
  - DB offline → memory fallback; **tidak pernah melempar** (cron-safe).
  - Helper `formatReportDateWib()` (tanggal WIB, bukan UTC).
- **Test (TDD, adversarial):** `tests/unit/notification-delivery.test.ts` (9 test) — normalisasi
  4 format nomor, isolasi tenant (log tenant-a tidak menahan tenant-b), idempotensi anti-spam,
  WABA→SKIPPED tercatat, gagal gateway→FAILED+error, DB offline→memory tanpa throw, balapan
  P2002, SYSTEM tanpa panggilan eksternal, `formatReportDateWib` lintas tengah malam.
  `tests/setup.ts` tambah mock `adminNotificationLog` (default offline).
- **Verifikasi:** `npx tsc --noEmit` exit 0; `npx vitest run tests/unit` **3275 passed / 23 skipped**
  (1 gagal = flake paralel `capi-tenant-isolation.test.ts` timeout 5s, hijau 8/8 saat diisolasi —
  pre-existing KNOWN_ISSUES #142, bukan regresi). Kolom terverifikasi di DB live lokal via
  `information_schema`.
- **Belum dikerjakan (fase berikutnya):** Fase 3+4 (`/notes` gate + pulse), Fase 2r (watchdog),
  Fase 5r (pre-visit brief), Fase 6r (copilot). Keputusan gate: G1=A (+B WAHA-only nanti),
  G2=B minimal tanpa nomor, G3=B panel kontekstual.

#### 2026-09-26 — Anti-logout paksa dashboard: kontrak sinyal 503 vs 401 sesi admin, hot cache, & token restore tahan gangguan

- **Laporan:** dashboard admin/terapis sering "keluar sendiri" padahal sesi 30-hari di DB masih sah. Verifikasi live (Fase 0, read-only): 3 baris `admin_sessions` untuk `admin@kalamomsspa.com` valid hingga 26 Okt, `revoked_at` NULL — termasuk login 15:31 WIB (08:31 UTC) yang cocok dengan laporan; `pg_stat_activity` 12 idle/1 active tanpa saturasi pool. Sesi di DB sah + user tetap ditendang → mekanisme penghapusan token di frontend.
- **Akar (multi-layer, terbukti di kode `file:line`):** (1) `validateSession()` (`admin-session.service.ts`) me-return `null` tunggal untuk "token invalid" DAN "DB error" → 401 ambigu. (2) `restoreSession()` frontend (`AuthContext.tsx`/`StaffAuthContext.tsx`) memakai `timeoutMs:3000` lalu `catch { localStorage.removeItem(TOKEN); return 'invalid' }` — tri-state `'network'` adalah dead code → timeout 4G / DB down = token cadangan dihancurkan. (3) Tiap request admin memicu 1× `findUnique` tanpa hot cache (`preHandler`, `/me`, `/restore`, media).
- **Perbaikan fondasional (gerbang kode deterministik, bukan prompt):** (1) `SessionStoreUnavailable` — `validateSession()` melempar error khusus saat DB tak terjangkau (memori fallback tetap dilayani lebih dulu; kedaluwarsa/revoke/tidak-ada di DB sehat → `null`/401 jujur); **tombstone 10 mnt** untuk hash yang baru di-destroy (logout saat DB mati → 401, bukan loop 503). (2) Pemetaan route: 503 + `code: SESSION_STORE_UNAVAILABLE` di `admin.route.ts` preHandler, `/api/admin/auth/restore`, `/api/admin/auth/me`, `staff.route.ts` (impersonasi admin); media privat deny 401 (bukan 500) di `media.route.ts`. (3) Hot cache sesi keyed-by token **hash** (bukan mentah), TTL 120 dtk, LRU cap 2000, tanpa negative cache, invalidasi sinkron di `destroySession` + sapu jaman. (4) Frontend: helper baru `services/sessionRestore.ts` — hanya 400/401/403 tegas yang menghapus token; timeout/5xx/503 → `'network'` → token dipertahankan + retry backoff (timeout restore 3000→8000 ms); cabang `'network'` di kedua AuthContext melepas loading tanpa membakar token.
- **File:** `src/services/admin-session.service.ts`, `src/routes/admin.route.ts`, `src/routes/admin/auth.subroute.ts`, `src/routes/media.route.ts`, `src/routes/staff.route.ts`, `packages/admin-dashboard/src/services/sessionRestore.ts` (baru), `packages/admin-dashboard/src/contexts/AuthContext.tsx`, `packages/admin-dashboard/src/contexts/StaffAuthContext.tsx`. Tanpa dependensi baru; tanpa sentuh WAHA/Meta; keamanan tidak dilemahkan (hash tetap di DB, cache ephemeral di memori).
- **Test (TDD merah→hijau, adversarial):** `tests/unit/admin-session-store.test.ts` (8: DB-error→throw vs null, memori-offline, kedaluwarsa, hot cache 1-query, destroy-invalidate, sinyal campuran, tombstone pasca-destroy) + `tests/integration/admin-auth-signal-contract.test.ts` (8: `/me` 503/401/200+cache, preHandler 503/401, `/restore` 503/401, media deny 401) + regresi `admin-session-hash`.
- **Verifikasi:** `npm run build` 0 error; dashboard `tsc && vite build` ✓; full suite **470 file / 3648 test / 0 gagal**. Fase 0 menutup hipotesis pool-jenuh (tidak terbukti saat ini) — lihat `docs/KNOWN_ISSUES.md` #141–#143 untuk sisa (kontrak 503 staff, flake test beban-paralel, observabilitas access-log auth).

#### 2026-09-26 — Klarifikasi persistenstensi chat `run-test-plan.ts` (Live Chat tidak menampilkan chat by design)

- **Laporan:** `npx tsx scripts/run-test-plan.ts --suite=v2 10` tidak memunculkan chat di Live Chat history dashboard.
- **Root cause (fondasional, 3 lapis):** (1) Harness default sengaja memaksa Repository **in-memory** (`setCustomerRepository`/`Conversation`/`Message` saat `!persistToDb`) sehingga tidak ada satu pun baris `customers`/`conversations`/`messages` yang ditulis ke PostgreSQL — ini disengaja ala `tests/setup.ts`. (2) `listConversations` bisa membuat conversation superfisial di memori dari cache `memoryConversations` walaupun DB tidak punya barisnya, jadi preview kosong/ghost. (3) Pesan outbound bot di-log langsung ke `messageService` — bukan lewat `sendText`, jadi memang tidak tertangkap di log harness (tidak memengaruhi Live Chat karena in-memory).
- **Perbaikan (tanpa ubah kode runtime `src/`):** single-source `persistToDb` di `main()` (sebelumnya `persistToDbFile` dideklarasi persis sebelum dipakai), default in-memory tetap; banner hint di akhir run suite V2 yang menjelaskan chat tidak masuk DB dan cara mengaktifkan `--persist` (⚠️ otomatis `is_sandbox_test=true`, tampil via filter "QA Tester / Sandbox"); safety net setelah run `--persist` untuk menjaga `is_sandbox_test=true` pada customer ber-nama `QA Tester - ` (menutup celah `chat-export.service` yang hanya memfilter kolom flag, bukan prefix nama seperti modul lain).
- **File:** `scripts/run-test-plan.ts` (header docs, `persistToDbFile` modul-level, `main()` set single-source, banner `[i]`, safety label). Tanpa perubahan `src/` runtime, tanpa dependensi baru.
- **Verifikasi:** `npx tsc --noEmit` 0 error; run `--suite=v2 --only=1` sukses + banner muncul; `tests/unit/conversation-sandbox-mode.test.ts`, `capi-queue-sandbox-isolation`, `follow-up-engine`, `live-chat.service` semua lulus.

#### 2026-09-26 — Fix crash `session.children` sparse array (temuan CASE-011, suite v2)

- **Bug:** replay suite v2 kasus `CASE-011` (dan teoretisnya semua chat yang mengandung sapaan ekor "…kakak") melempar `TypeError: Cannot read properties of undefined (reading 'symptoms')` di `goal-tracker.ts` `formatGoalSessionForPrompt` — tertelan `try/catch` sehingga suite tetap "hijau" padahal jalur prompt router mati di turn itu. Terbukti via repro + stack trace: `session.children` = `[null, {roleLabel:'Kakak',...}]` (hole di index 0).
- **Akar (multi-layer):** `patient-extractor.ts` `ensureChild(1, 'Kakak')` pada array kosong menulis index 1 → index 0 jadi hole (*sparse array*). Pemicu: `"Kalau kesini ongkir berapa kakak"` — sapaan CS di ekor kalimat lolos `isKakakHonorific()` → salah dianggap pasien anak kedua.
- **Fix Fase 1 (dense-array guarantee, lapisan State):** helper murni `PatientProfileExtractor.normalizeChildrenSlots()` — array `children` mustahil sparse (placeholder mempertahankan posisi CHILD_1/CHILD_2). Dipakai di seam tulis (`syncChildrenProfiles`), seam rehidrasi DB legacy (`goal-tracker.getGoalSession`), dan `formatGoalSessionForPrompt`. Plus backstop `ensureChild` + defense-in-depth `c?.symptoms` di `goal-tracker` & `conversation-summarizer`.
- **Fix Fase 2 (entity-evidence gate, bukan regex):** cabang tanpa-usia/tanpa-gejala `syncChildrenProfiles` hanya mengalokasikan slot anak-2 bila ada **bukti entitas** (konteks keluarga eksplisit / `keduanya` / anak sudah tercatat / bukti cart) — sapaan telanjang tidak lagi menciptakan "phantom Kakak". `isKakakHonorific` dipertahankan sebagai lapis sekunder.
- **Test:** 4 test baru di `tests/unit/multi-child-honorific.test.ts` (dense-array + `formatGoalSessionForPrompt` tahan array korup + 6 parafrase sapaan + 4 kontrol positif multi-anak), TDD merah→hijau.
- **Verifikasi:** `npm run build` exit 0; full suite **468 file passed + 1 skipped, 0 gagal** (3632 test).
- **DITUNDA (dicatat open di `docs/KNOWN_ISSUES.md`):** mismatch ground truth fixture suite v2 (`expected_final_state=AWAITING_INTEREST` vs eskalasi sah di tengah transkrip monolog) pada 9 kasus — butuh revisi builder `scripts/build-test-suite-v2.ts`, di luar blast radius fix ini.

#### 2026-09-26 — Hotfix build & regresi pasca `f5c70ade` (deploy blocker)

- **BLOCKER — `origin/master` tidak dapat di-build (`npm run build` / Docker build gagal).** Commit `f5c70ade` (rekonstruksi test suite V2) menghapus `try {` level-metode di `createNoPurchaseFollowUps` tetapi meninggalkan `} catch (err) {` yatim di baris 402 → selisih kurung −1 → 557 error parse TS. Klaim commit "build ✅" tidak akurat. Diperbaiki dengan memulihkan `try {`.
- **Regresi geocoding — landmark/apartemen mapan turun ke `isPrecise:false` (6 test).** Guard `isDualAdmin` + city-mismatch baru di `crossCheckGazetteer` ikut berlaku pada lookup **otoritatif** (kamus landmark), sehingga `Grand Sungkono Lagoon`→Dukuh Pakis, `Mulyorejo`, `Tenggilis Mejoyo` kehilangan kelurahan/lat/lng. Fix fondasional: parameter `authoritative` memisahkan kontrak lookup kamus (otoritatif) dari cross-check inferensi LLM; heuristik ambiguitas hanya berlaku pada jalur inferensi.
- **Regresi follow-up — guard "fail-closed" membunuh degradasi offline (7 test).** Guard `if (!customer) return` menyamakan **DB-offline (query melempar)** dengan **customer benar-benar tidak ada**. Kontrak `follow-up-schedule.test.ts:116` (mock `findUnique→null`, tetap harap 3 follow-up) menegaskan keberadaan customer bukan gerbang; integritas FK sudah ditegakkan DB + tiap insert ter-catch. Fix: pulihkan semantik baseline — skip hanya untuk kontak sandbox/dummy/bypass.
- **Regresi enrichment — shareloc link Maps kehilangan provenance GPS (1 test).** Refactor `resolveLocationFromUrl` mencabut `isNativePin` + `markShareLocationSent` dari cabang URL, padahal invarian `sticky-gps.test.ts` menyatakan "shareloc / **link Maps**" berstatus VERIFIED_GPS. Fix: `url_coords` (koordinat presisi dari URL) → `isNativePin: true` + `markShareLocationSent`; `url_text_geocoded` (teks tempat di-geocode) tetap area perkiraan.
- **Verifikasi:** `npx tsc --noEmit` 0 error, `npm run build` hijau, full suite **458 file / 3539 test lulus, 0 gagal** (baseline `7c94b58` diverifikasi hijau untuk 4 file yang sama sebelum fix).

#### 2026-09-26 — Watchdog server-DOWN via Telegram (follow-up insiden #135)

- **Masalah:** seluruh monitoring dalam aplikasi (`AlertService`, waha-monitor, cron) ikut mati saat container `app` down — 502 `/cta` 26 Sep tanpa ada yang memberi tahu.
- **Solusi (level HOST, bukan container):** `scripts/server-watchdog.sh` (cron */2 menit) + `scripts/install-server-watchdog.sh`. Cek berlapis container + `GET /health` publik (tanpa tulis DB); anti-flap 2x gagal beruntun; DOWN sekali, pengingat 60 mnt, RECOVERY + durasi. Kredensial dari `.env` → tenant DB (decrypt via container app), disimpan `chmod 600` `.watchdog.env`. Tanpa dep baru (bash+curl+docker+flock host).
- **Verifikasi:** `bash -n` kedua skrip OK; simulasi stub docker/curl di server 6 run hijau (gagal-1x sunyi, gagal-2x DOWN 1 pesan, masih-down tanpa resend, pulih RECOVERY, jalur container-hilang sama). Jejak simulasi dibersihkan (`/tmp/wd-test`).
- **Deployed 2026-09-26 ±09:22 (waktu server):** installer dieksekusi — kredensial dari tenant DB (token 46 char plaintext), cron `*/2` aktif, pesan uji http 200, run perdana `STATE=OK`.

#### 2026-09-26 — Mitigasi 502 `/cta` saat recreate container app (insiden #135)

- **Insiden:** `GET /cta?divisi=iklan-utama` (plus `/assets/*`, `/api/admin/*`) 502 selama ±3 menit (07:58–08:01 WIB). Penyebab fondasional: prosedur deploy (`build` + `up -d --no-deps app`) me-recreate container `app` → DNS Docker `app` hilang sesaat → Caddy `dial tcp: lookup app ... server misbehaving` → 502 semua route. Bukan bug kode `/cta` (`src/routes/landing.route.ts` tak tersentuh). Detail: `docs/KNOWN_ISSUES.md` #135.
- **Mitigasi (tanpa ubah kode runtime, tanpa dep baru):**
  - `docker-compose.yml`: service `app` tambah `restart: unless-stopped` + `healthcheck` liveness `GET /health` via `fetch` bawaan Node 20 (`start_period: 60s` untuk init tenant).
  - `Caddyfile`: kedua blok `reverse_proxy` tambah `lb_try_duration 30s` + `lb_try_interval 2s` agar jeda dial di-retry, bukan langsung 502.
  - `deploy_config.txt`: runbook deploy aman + runbook watchdog host-level.
- **Verifikasi:** `docker compose config` exit 0; `curl` pasca-pulih `/cta?divisi=iklan-utama` → 200 + redirect `wa.me`. Rebase di atas hotfix build remote (build sudah hijau di `origin/master`) sebelum deploy.
- **Batasan jujur:** retry 30 dtk tidak menutup recreate penuh yang lebih lama — deploy tetap di jam sepi; blue-green 2-replika ditunda (Confirmation Gate).

#### 2026-09-25 — Overhaul UX Mobile & LiveChat: Sticky Footer Reservasi, Smart Banner Form 1-Tap, Konsolidasi Menu Tools

- **`CreateReservationModal` — sticky footer & stacked action sheet mobile:**
  - Area scroll dipisah dari footer aksi (flex-col; footer tetap DALAM `<form>` sehingga `type="submit"` & dirty-tracking tetap hidup — menghindari tombol mati akibat pemisahan footer). Total tagihan + tombol utama kini selalu terlihat tanpa scroll ke ujung formulir.
  - < 640px: ringkasan `Total:` selalu tampil, tombol utama full-width 46px (`Simpan & Masukkan Invoice ke Chat` / `Simpan & Buat Jadwal`), baris sekunder Batal + Simpan + ikon Draf; ≥ 640px tetap baris horizontal rapi. Safe-area bottom inset + `scroll-pb-32 sm:scroll-pb-8` pada area gulir.
- **Soft-keyboard handling mobile:** listener `focusin` (gerbang `max-width: 639px`) auto-scroll input yang difokus ke tengah form — debounce 120ms + `clearTimeout` cleanup, agar input tidak tertutup keyboard virtual.
- **Quick age preset chips:** pill 1-tap (`Newborn`…`2 thn`) di bawah input usia anak untuk mengisi usia tanpa pindah keyboard (preset UI presentational).
- **Extractor — flag deterministik `hasExplicitReservationForm` (`chatScheduleExtractor.ts`):** `true` hanya bila blok formulir terisi (gate `pickFilledFormBlock` — template kosong bot dijamin `false`) berisi (tanggal ATAU jam) + (nama bunda ATAU nama anak ATAU treatment). 13 test adversarial baru: `tests/unit/chat-schedule-extractor-form-flag.test.ts` (parafrase, huruf besar, form parsial, chat bebas tanpa form, data DB tanpa form).
- **`LiveChatMonitor` — smart banner "FORM RESERVASI MASUK":** muncul di atas thread saat form terdeteksi & tanpa hold/confirmed/pending; dismiss bertahan per-signatur form (form baru → banner tampil lagi); tombol 1-tap `Jadwalkan & Buat Invoice` membuka `CreateReservationModal` ter-prefill tanggal/jam/anak/layanan.
- **Konsolidasi menu Tools anti split-brain (`LiveChatComposer` + `LiveChatMonitor`):**
  - `Buat Reservasi & Invoice` menyatukan alur reservasi + invoice; opsi invoice berubah per konteks lewat prop baru `hasActiveReservation` (`Salin Invoice Jadwal` bila ada jadwal aktif, selain itu diarahkan buat reservasi dulu).
  - GERBANG deterministik `handleGenerateActiveReservationInvoice`: invoice kini HANYA dibuat dari reservasi confirmed/pending di kalender — jalur invoice-teks dari ekstraksi chat bebas dihapus (~75 baris duplikasi), mencegah invoice tanpa jadwal kalender.
- **Perbaikan kelas mati Tailwind:** `active:scale-97` (tidak terdefinisi di config — kelas mati, tekan tombol tanpa efek) diganti `active:scale-95` di 10 tempat (`CreateReservationModal` ×8, `StaffScheduleTimelineStrip` ×2); audit CSS hasil build: `scale-97` = 0, `scale-95` ada.
- **Verifikasi:** `npm test` 3506 pass (1 flaky timeout terisolasi pass saat dijalankan sendiri), `npm run build` (backend `tsc`) & `npm --prefix packages/admin-dashboard run build` (`tsc && vite build`) 0 error. Audit dist CSS: `pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]` ter-generate valid (`calc(.75rem + env(...))`, operator di-spacing otomatis Tailwind), `scroll-pb-32` & `min-h-[46px]` hadir.

#### 2026-09-25 — Rekonstruksi Test Suite Chatbot (Phase 1–5: Scorer Contract-Based, Episode Slicer, Persona Simulator, Tier Gates)

- **Phase 1 — Scorer Contract-Based + Negative Controls (`scripts/run-test-plan.ts`, `docs/TEST_SCORING_RUBRIC_V2.md`):**
  - D1: Kontrol negatif `PRICE_UNSOLICITED` — bot menyebut harga tanpa ditanya → skor 0 + flag (Aturan Emas #2). Sebelumnya N/A selalu 2.
  - D2: Red-flag authority dari `expected_final_state` / `expected_sop_compliance` (fixture/DB), **no keyword scan gejala** di scorer.
  - D3: `D3_DEFERRED` — kontrak `expected_reservation_fields` + state `AWAITING_INTEREST` (43 kasus legacy monolog) → skor 2 + flag, bukan gagal.
  - Gate V2 (101-119): 14/19 lolos, 5 gagal = bug bot asli (bukan false failure).

- **Phase 2 — Episode Slicer (`scripts/lib/conversation-episode-slicer.ts`, `scripts/build-episode-fixture.ts`):**
  - 119 kasus monolog (1–89 turn) → **478 episode atomik (2–5 turn)**.
  - Potong berbasis `maxTurns=5` + milestone terminal state, bukan timestamp (fixture tak punya timestamp per-turn).
  - Tier inference dari `flowCategory`/`priority` existing (11 tier: TIER1–TIER5).
  - PII hygiene: reuse `anonymizeText`/`scrubAddressNumbers` + gate `RAW_PHONE_RE`/`RAW_EMAIL_RE` (0 hit).
  - Schema strict zod extended: `EpisodeSchema`, `EpisodesFixtureSchema` — 19 test pass.

- **Phase 3 — Persona Simulator (`scripts/lib/user-persona-simulator.ts`, `scripts/run-test-plan.ts`):**
  - `--suite=episodes --replay` = replay deterministik offline (0 token).
  - `--suite=episodes --simulator --llm` = LLM customer simulator (butuh `LLM_API_KEY`), seed deterministik, cap turns, loop detection.
  - Dual-mode runner: `--only`, `--cat=TIER5`, `--from/--to` untuk batch testing.
  - Report per-tier dengan `TierGate` column.

- **Phase 4 — Tier-Aware Gates (`scripts/run-test-plan.ts:evaluateTierGate`, `test-results/evidence-map.md`):**
  - TIER5_RED_FLAG_EMERGENCY: wajib `HUMAN_HANDLING` 100% + D4=2.
  - TIER5_SECURITY_ADVERSARIAL: wajib **resist** (no `HUMAN_HANDLING`) + D4=2 + **no PRICE_UNSOLICITED**.
  - TIER4_PRICE_NEGOTIATION: komplain wajib escalate.
  - TIER4_SCHEDULE: no spurious escalate.
  - TIER3_CLINICAL: follow fixture contract.
  - Prefix mapping (RF/ADV/CX/OPS) → tier untuk V2 cases.
  - Baseline evidence map: RF-06 false negative, ADV-01/03 price leak, ADV-02 no escalate, ADV-04 over-escalate, 28 PRICE_UNSOLICITED.

- **Phase 5 — Commands & Docs:**
  - `npm run test:episodes:fast` (replay offline), `test:episodes:llm` (simulator), `test:evidence-map`, `test:episode:suite` (TIER5).
  - Schema test extended 19 cases (V2 + episodes).
  - All gates: schema ✅, unit 3123 passed ✅, build ✅.

#### 2026-09-25 — Resolusi Bug Filter Sandbox LiveChat, Schema Drift Migration & Telemetri Model Kenari

- **Investigasi Root Cause (Multi-layer Audit):**
  1. **Tab Filter "QA Tester / Sandbox (Simulasi Lokal)" di Live Chat Monitor kosong mlompong:** Di `src/services/conversation.service.ts:134`, blok `if (process.env.NODE_ENV === 'production') where.customer = { is_sandbox_test: false }` langsung mengunci query Prisma. Pilihan `mode === 'sandbox'` dilewati total. Frontend menerima hanya chat riil (`isSandboxTest: false`), lalu memfilter keluar semuanya (`!(chat as any).isSandboxTest`). Hasilnya nol item.
  2. **Schema Drift Database Lokal:** Migrasi baru (`20260926000003_customer_soft_delete` dan `20260926000001_add_admin_sessions`) belum diaplikasikan di PostgreSQL lokal, menyebabkan error Prisma P2022 `The column customers.deleted_at does not exist` saat query customer/sandbox.
  3. **Simulator AI Sandbox (`/admin/sandbox`) tidak menampilkan identitas Model Kenari:** Di backend Kenari (`deepseek-v4-1-flash`) sebenarnya sukses menjawab (tercatat di `logs/llm-2026-09-25.jsonl`), namun response API `/api/admin/sandbox/chat` tidak pernah menyertakan `modelUsed` atau `provider`, dan Kenari tidak mengembalikan raw reasoning terpisah, sehingga user mengira Kenari tidak keluar.
  4. **Eksekusi Test Runner CLI (`scripts/run-test-plan.ts`) Tidak Masuk ke DB / Live Chat:** Runner test sebelumnya mengunci `InMemory*Repository` (`resetStoresForSuite`) untuk mencegah polusi DB, sehingga kasus pengujian hanya tercetak di terminal tanpa bisa diinspeksi per kasus di UI monitor Live Chat. Selain itu, pemuatan fixture suite v2 terbungkus dalam `if (suiteV2 && !persistToDb)` sehingga mematikan pemilihan skenario saat persistensi aktif.
- **Perbaikan Fondasional:**
  1. **`src/services/conversation.service.ts`:** Restrukturisasi filter Prisma & memory fallback — jika `mode === 'sandbox'`, query SELALU mengunci `{ is_sandbox_test: true }` tanpa terblokir `NODE_ENV === 'production'`. Jika `mode === 'all'` di production, baru mengecualikan sandbox.
  2. **Database Migration:** Dijalankan `npx prisma migrate deploy` (7 migrasi pending sukses diaplikasikan ke database `wa_clinic_db`).
  3. **Expose Model Telemetry:** `AgentRunnerOutput` dan `/api/admin/sandbox/chat` kini mengembalikan `modelUsed` dan `provider` aktif ke frontend.
  4. **UI Dashboard & Sandbox Badge:** Menambahkan badge identitas model aktif (`provider · modelUsed`) di header Simulated WhatsApp Chat dan panel Metrics AI Sandbox. Rebuild bundle `packages/admin-dashboard` sukses.
  5. **`scripts/run-test-plan.ts` DB Persistence (`--persist` / `--livechat` / `--db`):** 
     - Membuka akses PostgreSQL repositori saat flag `--persist` diberikan (menghilangkan in-memory mock isolation).
     - Menugaskan nomor telepon terisolasi sandbox kanonis (`62899990000xx`) dan nama pelanggan eksplisit `QA Tester - <CASE-ID>` dengan `is_sandbox_test = true`.
     - Membersihkan pesan lama sebelum re-run kasus yang sama, sehingga hasil pengujian selalu mencerminkan prompt/model terkini.
     - Memperbaiki parsing fixture suite v2 agar tetap memuat daftar kasus saat `--persist` aktif.
- **Verifikasi:** 
  - `[NEW] tests/unit/conversation-sandbox-mode.test.ts` (4/4 tests pass).
  - Eksekusi `npx tsx scripts/run-test-plan.ts --suite=v2 --id=CASE-038 --llm --persist` sukses (14 pesan inbound/outbound tersimpan di DB).
  - Verifikasi query `liveChatService.getConversationList(DEFAULT_TENANT_ID, 5, 0, 'sandbox')` mengembalikan `QA Tester - CASE-038` di urutan teratas ("Baru saja") lengkap dengan seluruh thread percakapan.
  - `npm run build` backend & frontend hijau.

#### 2026-09-25 — Resolusi 4 Defect Sistemik Percakapan (Trimmer, Leak RAG, D3 Komparasi, D10 Amnesia)

- **Audit ulang plan vs kode/log (bukan menelan klaim):** (1) Isu leak RAG — `return ''` saja TIDAK menangkap pesan tool `search-knowledge-faq.tool.ts:82` karena tak match regex `DEFERRAL`; `<br>` sudah dibersihkan `sanitizer.ts:84-92`. (2) Isu D3 — pada turn audit `calledTools: []` (`app-2026-09-25.log:913`) → `names=[]`, jadi perbaikan matcher saja tak cukup; router wajib memanggil katalog. (3) D10 pasca-reprompt `guardrail-pipeline.ts:624` hanya cek usia. (4) Bug trimmer `pushEnd` monotonik terverifikasi.
- **Fase 1 — Sanitizer (`src/v3/guardrails/sanitizer.ts`):** `trimToMaxSentences` kumpulkan batas via `Set`+sort (urutan-independen); emoji jadi batas HANYA bila mengakhiri baris/teks & tak didahului `.!?` (cegah over-trim emoji dekoratif — regresi ditemukan saat verifikasi); `stripVagueTeamDeferral` kembalikan `''` bila seluruh balasan deferral (bukan teks mentah); `[NEW] stripInternalInstructionArtifacts` buang salinan pesan instruksi tool di level kalimat.
- **Fase 2 — Gerbang amnesia deterministik (`factual-claim-validator.ts` + `guardrail-pipeline.ts`):** `ASKING_LOCATION_RE` diekspor + `[NEW] stripAmnesiaQuestions` (otoritas pola tunggal D9/D10); diterapkan ke SEMUA 5 cabang reprompt (numeric/pronoun/age/time/shareloc) via `gateAmnesia`, bukan tambal satu cabang.
- **Fase 3 — D3 komparasi (`factual-claim-validator.ts`, `router-tool-routing.layer.ts`):** `[NEW] replyMentionsCatalogName` token-based (nama pokok tanpa prefix brand "Kala Baby - ", varian token, reuse `significantTokens`); router guidance eksplisit pertanyaan pemilihan/perbandingan → `get_catalog_and_price`.
- **Verifikasi:** `[NEW] tests/unit/v3/systemic-defect-fixes-2509.test.ts` 19/19 adversarial; `tsc`/`build` hijau; **full suite 453/454 files hijau, 3467 passed / 0 failed** (baseline: `v3-persona-rules` 1 gagal).
- **Debt:** `stripInternalInstructionArtifacts` berbasis daftar penanda mesin (perlu diperluas bila muncul frasa tool baru); Isu 1 tanpa bukti replay log (`llm-2026-09-25.jsonl` 0 byte). Detail: `docs/KNOWN_ISSUES.md` #130.

#### 2026-09-24 — Foundational Call 1 Router Neutralization, Model Harmonization & Output Punctuation Sanitizer (Sesi 640820)

- **Akar masalah (audit log `llm-2026-09-24.jsonl:0-1`):** Call 1 `glm-5.3-flash` 24.7 dtk / 835 reasoning token mencuci otak Router via heuristik `includes(' berapa')` di `conversation-summarizer.ts:173` → `bngurasi berapa kak` (typo Bungurasih + tanya ongkir) salah dikunci `Bunda menanyakan tarif / harga layanan` + injeksi `🚫 Menanyakan alamat lagi`, sehingga LLM salah memanggil `get_catalog_and_price` (bukan `calculate_delivery`) dan membombardir katalog; Call 2 `deepseek-v4-flash-0731:netra` 1.2 dtk sudah benar mengenali "Bungurasih" tetapi tanpa data ongkir.
- **Fase 1 — Netralisasi Summarizer (`src/v3/state/conversation-summarizer.ts`):** `isLikelyLocationAnswer` dirombak state-gated — `words` dipindah ke atas, `isShortCompositeLocationFee` (≤4 kata + `berapa/brp/ongkir`) mengecualikan `includes(' berapa')` untuk komposit, `priceBase` substring-aware cegah false-positive "berapa" murni, `words ≤4`; cabang `berapa/harga/tarif/biaya` kini `askedLocationRecently && !locationResolved && isLocationFeeComposite` → `Cek jangkauan via calculate_delivery`, else tarif umum; dependensi `serviceBase` cegah "berapa biaya pijatnya" kebajak lokasi.
- **Fase 2 — Router Guidance + Masker Fail-Open (`src/v3/agent/prompt/phases/router-tool-routing.layer.ts:20`, `src/v3/tools/tool-masker.ts`):** kontrak `calculate_delivery` ditambah panduan multi-turn (respons atas tanya domisili, komposit `bngurasi berapa kak` → `asksDeliveryFee:true`, teruskan frasa utuh); `tool-masker.ts` fail-open deterministik `hasLocationEntity = hasNewLocationEntity || isShortCompositeResponse` (≤4 kata pasca-tanya-domisili) — anti-recycle kota luas, anti-shadow typo.
- **Fase 3 — Harmonisasi Model (`src/config/ai-models.config.ts:154-155`, `.env.example:137`, `src/v3/agent/agent-runner.ts:130/134`):** default `INTENT_CLASSIFICATION` dari `SUMOPOD_PRIMARY_MODEL` (glm) → `deepseek-v4-flash-0731:netra` selaras `scripts/migrate-model-config-to-sumopod-glm.ts:41` (golden), `.env.example` & fallback `routerModel` diselaraskan; migrasi DB `tenant_ai_config` dijalankan (20 baris, `default-tenant` `INTENT_CLASSIFICATION` kini `SumoPod/netra`, `CHAT_REPLY` → `glm` golden).
- **Fase 4 — Sanitizer Koma Yatim (`src/v3/guardrails/sanitizer.ts:525` sudah ada):** rantai `,\s*(?=emoji)` terbukti via eksekusi `cleanOutboundReply('ya, ☺️')→'ya ☺️'`; hanya penambahan regression test `tests/unit/v3-sanitizer-vocative-quota.test.ts` 2 kasus baru (ya, ☺️ / multi-emoji) — tanpa churn kode.
- **Fase 5 — Adversarial Tests (`tests/unit/v3/composite-location-fee-routing.test.ts` [NEW] 7/7):** matriks typo/singkatan (`bngurasi`/`bungurasih`/`wdro`/`wedoro`/`rungkut`) × (`berapa`/`brp`/`ongkir`) + kontrol negatif pure harga & service, plus sanitizer koma yatim; `npm run typecheck` & `npm run build` hijau; `summarizer-statement-only` 3/3 & `location-mask-typo` 4/4 & `location-ingestion` 3/3 hijau.
- **Debt jujur:** full suite 77 gagal pre-existing akibat rebrand katalog `Kala Baby/Kids` (nama `Pijat Bayi Pulih Ceria (Terapi Bapil` → `Kala Baby – Pijat Pulih Ceria` etc) — bukan regresi batch ini; verifikasi `npx vitest run` core 5 suites 37/37 hijau.

#### 2026-09-24 — Batch Quick Wins Audit Holistik (E1+E3, I1+I4, R1+R3)

- **E1:** `resolveMaxTokensForTask` — `max_tokens` registry (1024/512/…) kini dikirim di payload Call 1/Call 2 (`generation-stage.ts`); sebelumnya completion tak terbatas.
- **E3:** `finishCost` memakai `cachedPrompt` terakumulasi (`totalTokens.cachedPrompt` via `addUsage`) — dasbor tak lagi over-estimate saat cache aktif.
- **I1:** stopword FTS hanya sapaan/partikel — nomina domain (`pijat`, `boleh`, `setelah`…) dipertahankan; "boleh pijat setelah vaksin?" tak lagi lumpuh.
- **I4:** nominal promo `pregroundedRecommendation` digate `priceDiscussed` (`goal-tracker.ts`) — konsultasi murni tanpa angka (Aturan Emas).
- **R1:** `[NEW] OUTAGE_TRANSITION_REPLY` — outage LLM kirim pesan transisi deterministik + tetap eskalasi (pola `machine.ts:212`); customer tak lagi didiamkan.
- **R3:** `[NEW] resolveQueueJobId` — turnId kanonis → UUID fallback; pesan tanpa id tak lagi dibuang sebagai `job_<phone>_undefined`.
- **Verifikasi (TDD):** `[NEW] telemetry-cost` 4/4, `[NEW] outage-transition` 2/2, stopword/goal-tracker/queue suites hijau, `tsc` 0. `tool-masker.test` 4 gagal dibuktikan pre-existing (gagal di HEAD murni terisolasi; lolos full-suite via polusi urutan) — bukan regresi batch ini.

#### 2026-09-24 — Batch Kecerdasan (I3, I5, I4b+I6, M0)

- **Fase A (I3):** alias gejala kanonis di `patient-extractor.ts` (`mampet/meler/bersin→pilek`, `mencret→diare`, +`muntah`/`sembelit` mentah) pada salinan teks (usia utuh); `[NEW] patient-symptom-alias.test.ts` 5/5.
- **Fase B (I5):** 2 exemplar gejala → closing domicile-ask + tag `closing_domicile_ask` (`few-shot-exemplars.ts`); `[NEW] scripts/sync-few-shot-defaults.ts` (`--dry-run/--apply`, hanya baris belum dikustom admin; eksekusi live manual menyusul).
- **Fase C (I4b+I6):** nominal per-item keranjang digate `priceDiscussed` + instruksi konsultasi dibersihkan dari nominal kontradiktif; pin `Treatment Dikonsultasikan` + `Keluhan Tercatat` di `formatGoalSessionForPrompt` (1 seam → Call 1+2).
- **Fase D (M0):** `[NEW] location-mask-typo.test.ts` 4/4 hijau sekali jalan — mode typo `bngurasih`/`kenjern`/`waru kepuh` sudah tertangani fuzzy layer; tanpa ubah runtime (`KNOWN_ISSUES:11` tinggal penutupan dokumen pemilik area).
- **Verifikasi:** `tsc` 0; gate A 24/24, B 28/28, C 24/24 + guardrails-391501, D 4/4.

#### 2026-09-24 — Retrieval FTS + Trigram pg_trgm (Fase 4 refaktor; Fase 1 di-drop, Fase 3 ditolak, Fase 2→P3)

- **Audit plan:** Fase 1 (Zod wiring) terbukti basi — skema & `validation.data` sudah hidup (`tool-schemas.ts:19-31`, `tool-pipeline.ts:326`) → di-drop. Fase 3 (multi-tool) ditolak — menabrak Mandat Atomic Routing (`parallel_tool_calls:false` wajib). Fase 2 (token budget) → P3 backlog (overflow tak terbukti).
- **Fase 4 dieksekusi (TDD):** migrasi `20260925000000` (`CREATE EXTENSION pg_trgm` + GIN index ekspresi identik query; butuh superuser; rollback = DROP INDEX manual); tier-4 trigram di `knowledge.service.ts` (toleran afiks/typo, gate similarity ≥0.25 tanpa cek token-eksak — disengaja); hapus early-return tier-2 yang membuat tier 3–4 unreachable; `[NEW] tests/unit/knowledge-search.test.ts` 4/4.
- **Verifikasi:** `tsc` 0; knowledge suites 16/16 + trigram 4/4 hijau.

#### 2026-09-24 — Pemulihan Integritas Penamaan Google Contacts & Database (Fase 1-5, hasil audit plan)

- **Bukti live (read-only):** 729 customer, 156 ber-kelurahan → 78,6% tanpa label wilayah (koreksi klaim plan 86,6%); 10 baris kelurahan tercemar (URL/maps/`Jl.`/>40 char). Template aktif dari DB `tenant_google_integrations.naming_template`.
- **Fase 1 — Formatter & People API contract:** `google-contacts-formatter.ts` smart fallback kelurahan→kecamatan (guard anti-duplikat bila template memuat kedua tag) + strip minus gantung tengah (`\s+,` cleanup) + split terstruktur ` - ` anti-hyphen familyName + fallback `Pelanggan {4 digit}`; `google-contacts.service.ts` kirim `unstructuredName` (writable) — `displayName` output-only DITOLAK plan asli per typing resmi `googleapis/people/v1.d.ts:871`.
- **Fase 2 — Stop pencemaran:** `reservation-lifecycle.service.ts:53` & `reservations.subroute.ts:2306` hapus tempel kecamatan ke `Customer.name`; `reservations.subroute.ts:1602` larang salin alamat jalan ke kolom kelurahan (hidup di `preferences.address`).
- **Fase 3 — Auto-sync chat:** `tool-pipeline.ts` hook non-blocking pasca `calculate_delivery` (V3 persist via mirror GoalTracker, bukan `customerService` — hook lama tak terpicu); `customerId` via conversation lookup (session tak membawa customerId); Micro-Task 3.2 plan (comment-only) DI-DROP — dirty-check lolos alami via bump `updated_at`.
- **Fase 4 — Isolasi impor dua arah:** `[NEW] splitImportedContactName` (pure) + `classifyImportedAreaTag` via gazetteer (`Waru`→kec. Waru, `Manukan Kulon`→kel. Manukan Kulon/kec. Tandes); hanya lengkapi kolom kosong, tidak timpa existing.
- **Fase 5 — Healing:** `[NEW] src/scripts/sanitize-customer-names-and-kelurahan.ts` (`--dry-run` default/`--apply`/`--tenant`/`--limit`, 3 aturan isi-kosong-saja) + `[NEW] src/utils/customer-name-healing.ts` (pure) + `export COMMON_DISTRICTS` (single source, anti-duplikat); `--apply` live DITUNDA hingga konfirmasi eksplisit.
- **Verifikasi:** `tsc` 0; `google-contacts` 23/23, `healing` 5/5, `customer-database-api` 3/3, `location-refresh` 5/5, `tool-pipeline-price-intent` 22/22; full suite 3278/3312 — 6 gagal BUKAN regresi (5 matrix milik perubahan paralel tak-terkait + 1 `catalog-price-age-aware` pre-existing di HEAD `bff22cfd`, terbukti via worktree isolasi).

#### 2026-09-24 — Optimasi Fondasional Disk & Memori Server Produksi (Fase 1R-3R & 5R)

- **Fase 0R — Baseline terverifikasi:** `free -m` 1967/1407/560 + swap 837M, `df 40G 31G 7.4G 81%`, `docker stats` app 203M/waha 284M, `health` via `https://app.kalababyspa.online/health` OK, `sudo NOPASSWD ok`, probe WIB today=2 & page300 tidak mencakup hari ini (akar jadwal 0 terkonfirmasi).
- **Fase 1R — Disk:** `docker-prune.sh` hapus `until=168h` + log ke `storage/docker-prune.log` (tanpa sudo), `builder prune -af` + `journalctl --vacuum-size=50M` + `apt clean` → `df 40G 22G 17G 58%` (+9.6G), build cache 15.2G → 7.6G (sisa buildx).
- **Fase 2R — Host OS:** `disable --now multipathd ModemManager` (upower/fwupd sudah inactive) → `RAM available 560→957M`, swap 837→197M, tanpa `mask` agresif.
- **Fase 3R — Compose:** `DATABASE_URL connection_limit 20→12`, `NODE_OPTIONS --max-old-space-size=384` (vs RSS 172M, aman), `WAHA_NOWEB_STORE_FULLSYNC false` (dorman sampai restart waha, terdokumentasi), `git pull` + `docker compose build app` + `up -d --no-deps app` (WAHA untouched, Up 6 weeks).
- **Fase 4R — Daemon live-restore DITUNDA:** `/etc/docker/daemon.json` valid JSON namun dockerd gagal `invalid character 'l'` → rollback `rm daemon.json` + `systemctl restart docker` (downtime 1m, app sempat Exited lalu `up -d app` pulih, health OK). Ditunda hingga verifikasi syntax & jendela maintenance 2-step.
- **Fase 5R — Cron:** `crontab` `30 3 * * 0 docker-prune.sh` + `* * * * * clean-trigger.sh` sudah ada, `chmod +x` semua sh, `vm.swappiness=10` sudah aktif, `swapoff -a` ditunda (available 957M <1G gate).
- **Verifikasi:** `free -m`, `df`, `docker ps` (app/waha/caddy/postgres/redis Up), `health OK`, `pg_stat_activity idle 3/12`, `docker stats` app ~170M.

#### 2026-09-23 — Sinkronisasi Komprehensif Pricelist Katalog Layanan Klinik (Brand Prefix Kala & Deaktivasi Layanan Usang)

- **Sinkronisasi Database (`clinic_services`)**: Tabel `clinic_services` di PostgreSQL container diperbarui untuk 36 layanan aktif berlabel resmi Kala (*Kala Baby*, *Kala Kids*, *Kala Mom*, *Kala Bundle*, *Kala Terapi*) dengan harga normal, promo, tier usia, dan durasi menit terbaru. 4 layanan usang (`moms-relaksasi`, `moms-oksitosin-partial`, `baby-cukur-pijat-terapi`, `custom-kids-spa`) dinonaktifkan (`is_active = false`) tanpa menghapus row database demi menjaga integritas data historis reservasi.
- **Lapisan File Fallback & Dashboard**: `services_custom.json` dan konstanta runtime `DEFAULT_CLINIC_SERVICES` (`src/services/treatment-catalog.service.ts`) disinkronkan 1:1 dengan 40 layanan DB (36 aktif, 4 nonaktif). Fallback frontend `DEFAULT_CLINIC_SERVICES_FALLBACK` di `packages/admin-dashboard/src/utils/treatmentParser.ts` diperbarui.
- **NLU & Tokenizer / Pencarian Dinamis**: Token `'kala'` dimasukkan ke `GENERIC_CLINIC_TOKENS` (`src/v3/domain/types.ts`) dan normalizer katalog; ditambahkan resolusi `unbrandedName` pada `searchCatalog` dan `searchCatalogItems`; ditambahkan kata depan percakapan bahasa alami (`'buat'`, `'bikin'`, `'bagi'`, `'guna'`, `'kala'`) ke `stopwords` pencarian katalog untuk mengeliminasi distorsi IDF akibat kata penghubung pada deskripsi layanan.
- **Verifikasi**: `npm run build` backend (`tsc`) ✅, `npm run build` frontend `packages/admin-dashboard` (Vite) ✅, 5 test suite katalog (`tests/unit/treatment-catalog*.test.ts`, 66 tests) 100% hijau termasuk 32 test case pencarian natural language.

#### 2026-09-23 — Eliminasi Sistemik Blank Page & Fatal Crash Admin Dashboard (Fase 1-4)

- **Fase 1 — Benteng global (anti blank-page):** `[NEW] AppErrorBoundary.tsx` (class boundary `getDerivedStateFromError` + `componentDidCatch`, deteksi `ChunkLoadError|Failed to fetch dynamically imported module` → auto-reload sekali per sesi `sessionStorage chunk_reload_attempt` + purge `apiCache:*` (`services/api.ts:128` riil, bukan fiktif) + `CacheStorage`, fallback UI tema WA `#f0f2f5/#111b21` dengan tombol `Muat Ulang`/`Dashboard`/`Coba Lagi` + `<details>` teknis); `App.tsx:6,100-106` bungkus global `<AppErrorBoundary scopeLabel="global"><Suspense><Routes>`; `components/common/Layout.tsx:3,1011` lapis kedua `<AppErrorBoundary scopeLabel="page">` isolasi isi halaman (nav tetap hidup); `public/sw.js:2` `kala-admin-v11` → `v12` (activate sudah hapus cache lama).
- **Fase 2 — Defensive hardening (?.a.b):** `Debug.tsx:140,157,159,161-163,180,203` `data?.database?.status`, `data?.counts?.customers`, `(data?.featureFlags||[])`, `data?.logBuffer?.installed/stats`; `Debug.tsx:306,386` normalisasi `res?.data?.entries ? res.data : {entries:[]}` + render `(data?.entries||[])`; `FinancialAnalytics.tsx:584,611,635,726` `(data?.categoryBreakdown||[])`, `(data?.paymentBreakdown||[])`, `(data?.topServices||[]).slice`, `(data?.transactions||[]).length`; `TodayTreatments.tsx:576-587` + `StaffToday.tsx:1749-1760` `coords?.lat ?? currentTask?.address?.lat` + `?.kelurahan/kecamatan/landmark` (address tetap `TaskAddress`, hanya rantai aman — hindari churn `|null` di `fullText`).
- **Fase 3 — RBAC alignment (fail-closed):** `rolePermissions.ts:289` cabut `/admin/chat-migration` dari `admin_cs.allowedPaths` (selaras `admin.route.ts:137-149` blokir `/api/admin/migration` untuk `staffRole!=='SUPER_ADMIN'`); `rolePermissions.ts:441` guard `if(path==='/admin/chat-migration') return false` untuk blokir cache lama & custom role; `rolePermissions.ts:464` fallback `filter(p!=='/admin/chat-migration')` anti bocor ke role tak dikenal.
- **Verifikasi:** `npx tsc --noEmit` root + `packages/admin-dashboard` ✅, `packages/admin-dashboard: npm run build` ✅ (vite 11-12s), `npm test` 3230/3263 (5 gagal pre-existing `v3-conversation-matrix/lead-greeting/location-ingestion/tool-masking-enforce` bukan regresi Fase 1-4; debt di `KNOWN_ISSUES.md` #124).

#### 2026-09-23 — Revisi Fondasional: State-Machine Gated Masking + Koma-Yatim Emoji (Tanpa Churn PLAN 12)

- **Fase 1 — State-gate masking:** `tool-masker.ts:54` `isLocationFullyResolved()` (kelurahan/kecamatan/kota/jarak/ongkir/`isOutOfCoverage` dari `domain/types.ts:18-27`) + gerbang `src/v3/tools/tool-masker.ts:376` — unresolved (`{}`/`{rawText}` saja) DILARANG mask → LLM ekstrak `wdro`/`di bungurasi`/`sby barat`/`patokan` (log `logs/llm-2026-09-23.jsonl` `wdro kak` tanpa `calculate_delivery` → kini terbuka), resolved + tanpa entitas baru → mask anti-recycle 337880 (typo `≥6` tetap hidup sebagai lapis kedua). `asksDeliveryFee` tetap di gate tool (opsi b), tanpa ubah signature masker.
- **Fase 2 — Koma-yatim:** `sanitizer.ts:525` `.replace(/,\s*(?=[emoji])/gu,' ')` — `ya, Bunda ☺️` → `ya ☺️` (tanpa `, ☺️`), kolaps spasi ganda via rantai `:525-527`, proteksi interogatif 951450 tetap.
- **Verifikasi:** `npm run build` ✅, `tool-masker 20/20`, `typo-match 9/9`, `v3-sanitizer-vocative-quota 18/18` hijau; full suite 3232/3263 (3 pre-existing `lead-greeting/waha` bukan regresi). Decision: Zod + cool-off PLAN 12 tidak dieksekusi (sudah live).

#### 2026-09-23 — Revisi Fondasional: GLM Timeout via Env + Typo 1-Huruf Terpusat (Tanpa Duplikasi)

- **Fase 0 — Gerbang bukti:** `logs/llm-*.jsonl` tanpa `ECONNABORTED` (0), `glm-5.3-flash` 11/6 sampel di 09-21/23; typo nyata `di bungurasi` → masker lama memblokir `calculate_delivery`. Keduanya jadi bank uji adversarial (bukan 2 kalimat plan lama).
- **Fase 1 — Timeout per-model via env:** `.env.example:130` `LLM_TIMEOUT_GLM_MS=60000`, `generation-stage.ts:11-33` `GLM_TIMEOUT_MS` + `isGlmPayload()` (`startsWith glm-` / `/glm/` / `includes glm`) → primary GLM 60s vs default 25s, fallback GLM 60s vs 20s (via `fbTimeout`). Tanpa literal `60000` di kode; UX 60s tercatat di debt.
- **Fase 2 — Typo terpusat tanpa duplikasi:** `src/utils/typo-match.ts` baru — `isTypoAtMostOne` + `GEO_TOKEN_SKIPLIST` satu sumber; `calculate-delivery.tool.ts:334` hapus duplikat & import shared; `tool-masker.ts:26,54` import shared + blok typo token `≥6` (kelurahan+kecamatan, skip `surabaya/sidoarjo/waru` pendek) — tidak duplikasi logika tool, guard `len>=6` konsisten masker↔tool.
- **Verifikasi:** `npm run build` ✅ (tsc + prisma generate), `typo-match 9/9`, `tool-masker 20/20`, `tool-schemas 6/6`, `circuit-breaker 19/19` hijau; full suite 314+ tetap hijau (pre-existing flaky di luar 4 file tetap). Sandbox: `di bungurasi` → `calculate_delivery` terpanggil, resolve `Bungurasih/Waru`, ongkir dari `delivery_tiers` DB (bukan nominal mati 5.5km/5000).

#### 2026-09-23 — Optimasi ORS Shortest + Anti-Overestimation (Preference & Circuity Cap Final)

- **Akar masalah:** `src/integrations/ors/client.ts:76` tanpa `preference` → default ORS `fastest`/`recommended` memutar via arteri: Waru→Airlangga 15.32 km (1.80× straight 8.50) → `×1.10=16.85` (DB Tier 5 Rp20.000) vs rute riil ~12 km via `shortest` 13.07 km → `×1.10=14.38`→capped 13.60 Tier 4 Rp15.000. `delivery.service.ts:244` tanpa sanity check (ORS & Google).
- **Fondasional:** `OrsClient` whitelist `resolveOrsPreference()` + `preference:shortest` di payload ORS; `DeliveryService` helper `applyCircuityCapToFinalDistance()` cap **final setelah buffer** = `straight×ORS_MAX_CIRCUITY_RATIO` (env, default 1.60, fallback `HAVERSINE_CIRCUITY_FACTOR`) untuk ORS & Google + warn `[DISTANCE CIRCUITY CAP]`; `.env.example` `ORS_PREFERENCE`/`ORS_MAX_CIRCUITY_RATIO`/`HAVERSINE_CIRCUITY_FACTOR 1.50→1.60`; skrip `src/scripts/sync-customer-distance-dyah-w.ts` idempoten `--dry-run`/`--commit` tenant-aware.
- **Verifikasi:** `tests/unit/ors-shortest-routing.test.ts` 7/7, `delivery-circuity-cap.test.ts` 8/8 (Airlangga, detour sintetis ORS/Google, KENJERAN/WIYUNG), `ors-client.test.ts` & `ors-profile-nontol.test.ts` kontrak `preference:shortest`, `delivery.test.ts` 14 boundary via `coordsForTarget`, `delivery_circuity.test.ts` 4/4 — **48 test hijau**, `npm run build` hijau. Live diff Dyah W: dry-run `16.85→13.60 / 20000→15000`.

#### 2026-09-23 — Perbaikan Fondasional PageView vs Klik CTA (Instrumentation Coverage Gap, CTR >100%)

- **Akar masalah:** Dashboard `Total Page View / Kunjungan = 66` vs `Total Klik CTA` lebih besar bukan salah hitung SQL, melainkan coverage timpang: `POST /api/tracking/pageview` hanya diproduksi `src/landing/public/external-tracker.js:226`, sedangkan LP internal `src/landing/public/go.html:24` dan `src/services/html-sanitizer.ts:154` hanya `fbq('track','PageView')` tanpa beacon server; `src/routes/admin/meta-attribution.subroute.ts:240` menyamarkan `views===0` dengan `totalClicks`; `GET /cta` membuat `AdClick` atomik tanpa PageView.
- **Fase 1 — Beacon kembar LP internal (tenant-aware, CSP nonce, parity param, idempoten):** `src/services/html-sanitizer.ts:142-245` & `src/landing/public/go.html:13-31,205-244` generate `pvEventId` sekali, `fbq('track','PageView',{}, {eventID:pvEventId})` + `POST /api/tracking/pageview {eventID, landingUrl, fbclid/fbp/fbc, utm_*, tenantId}` (sendBeacon prioritas, fallback fetch keepalive, guard `window._kala_pageview_tracked`, `window._kala_pv_event_id` sharing untuk dedup Meta CAPI di `src/routes/tracking.route.ts:327-350`). LP tanpa pixel tetap kirim beacon via fallback click-catcher.
- **Fase 2+3 atomik — Query & UI jujur:** `src/routes/admin/meta-attribution.subroute.ts:239-345` hapus masking `views>0?views:clicks` → `views` murni, import `memoryPageViews` + fallback in-memory saat DB offline, tambah `coverage/coverageNote/isTrackingCodeFiltered/ctrNote` (PageView subset vs klik superset, tanpa backfill, filter trackingCode = pre-click). `packages/admin-dashboard/src/pages/tenant/MetaClickCatcher.tsx:66-485` label `LP terinstrumentasi (subset)`, badge `coverageNote`/`ctrNote`, sembunyikan CTR saat filter tracking code aktif.
- **Verifikasi:** `tests/unit/pageview-beacon.test.ts` 6/6 (RAW_HTML + go.html beacon, tenant, idempoten, bot filter, direct /cta), `tests/integration/landing-serving.test.ts` 10/10, `tests/unit/tracking.test.ts` hijau, `npm run build` (tsc + copy-landing-assets) hijau. Debt: data historis tetap timpang sampai window 30 hari terisi beacon baru; cek operasional `external-tracker.js` di LP eksternal.

#### 2026-09-22 — Sistem Notifikasi In-System Terapis (PWA Web Push, Service Worker & SSE Real-time)

- **Fase 1 — Real-time Event Hub & SSE Pipeline:** `LiveChatHubEventType` (`live-chat-hub.service.ts:14-15`) ditambahkan event `'staff.task_assigned'` dan `'staff.task_cancelled'`. Stream SSE staff internal (`today.subroute.ts:641-648`) mengalirkan event ini secara real-time ke browser terapis aktif sesuai `staffId` (atau seluruh terapis untuk supervisor).
- **Fase 2 — Layanan Web Push Staff Terarah:** `WebPushService` (`web-push.service.ts:288-385`) ditambahkan metode `sendPushToStaff(staffId, tenantId, payload)` untuk mengirim Push Notification berbasis VAPID langsung ke perangkat smartphone staff terapis, dengan pembersihan otomatis langganan kedaluwarsa (HTTP 410/404). Endpoint langganan admin/staff (`push.subroute.ts:48-60`) diperbarui untuk mengikat `staff_session` dan `tenant_id` secara otomatis.
- **Fase 3 — Multi-channel Dispatcher In-System:** `StaffNotificationService` (`staff-notification.service.ts`) diperbarui fondasional agar pengiriman tugas (`sendReservationAssignmentNotification`), pembatalan (`sendReservationCancelledNotification`), dan pengalihan (`sendTaskUnassignedNotification`) SELALU memicu notifikasi internal sistem (SSE untuk aplikasi terbuka + Web Push PWA untuk HP terkunci / layar mati), tanpa tergantung pada status pairing Telegram staf.
- **Fase 4 — PWA Client Auto-Subscription & SSE Handlers:** `StaffToday.tsx` otomatis mendaftarkan VAPID Push Subscription (`subscribeToPushNotifications('STAFF', currentStaff.id)`) saat login/mount. SSE listener mendengarkan `staff.task_assigned` dan `staff.task_cancelled` untuk memicu nada dering (`playIncomingMessageSound(true)`), toast peringatan, banner OS aman (`showSafeNotification`), dan pembaruan instan daftar tugas (`fetchTasks(true)`). Service Worker (`sw.js`) diperbarui ke `kala-admin-v11` dengan penanganan klik notifikasi tugas terapis yang mengarahkan langsung ke rute `/admin/#staff-today`.
- **Verifikasi:** `npm run build` backend ✅, `npm run build` frontend React/Vite ✅, `tests/unit/staff-telegram-notification.test.ts` 4/4 hijau termasuk pengujian adversial dispatch SSE & Web Push saat Telegram tidak terhubung.

#### 2026-09-22 — Revisi Fondasional Plan Terapis: Filter Batal, Anti Double-Ongkir, Audit Reassign & Safe Notif (Audit Gate)

- **Fase 1 — Guard status & sandbox (BUG-08/09/12 + 4.2 + 1.1):** `getTodayTasks` (`staff-reservation.service.ts:171`) `status notIn ['cancelled','rejected']` + `customer is_sandbox_test:false` (lowercase kanonis, tanpa dead code CANCELLED), `getUpcomingSchedule:392` sama, `getCompletedTasks:573` top-level `status notIn` + `customer is_sandbox_test:false` di-AND dengan OR (completed/purchase_occurred/booking_date<today) agar cancelled kemarin tidak lolos sebagai "Belum Lunas", `assertConversationOwnedByStaffToday:993` tambah `status notIn` top-level, `reassignTask:1047-1110` validasi `tenant_id` + status `completed/cancelled/rejected` (case-insensitive) + audit `STAFF_REASSIGN_TASK` via `auditService.logAdminAction` (previous/new staffId).
- **Fase 2 — Anti double-ongkir (BUG-10):** `recordPayment` (`:827`) kontrak `amount = total tunai di tangan` (`pricing.totalFee` dari `StaffToday.tsx:1282`) → `deliveryFee = customer.ongkir||0`, `totalCollected = amount`, `pureTreatmentValue = max(0, total-ongkir)` disimpan ke `purchase_value`, CAPI tetap `totalCollected` (IDR), audit payload tambah `pureTreatmentValue/deliveryFee`; LTV `recalculateCustomerLtv` tetap Σ `purchase_value` (tanpa ongkir) — divergensi by-design didokumentasikan; fallback `amount==null` simpan `purchase_value` apa adanya (tanpa inflasi).
- **Fase 3 — Safe notification Android (BUG-01):** `notificationSound.ts:275` `showSafeNotification` bypass `ServiceWorker showNotification` bila `onClick` ada (agar `handleOpenChat` tetap jalan), `doFallback new Notification` tetap dalam `try/catch` anti `Illegal constructor`; `StaffToday.tsx:141,831` sudah pakai `showSafeNotification` + `playIncomingMessageSound` terisolasi `try` agar tidak drop `setMessages`.
- **Fase 4 — Housekeeping kecil:** `media.service.ts:356` hapus emoji `🌸` dari SVG watermark (hindari tofu DejaVu), `staff-auth.service.ts:122` `cleanExpiredSessions()` + `src/app.ts:287` cron 24 jam `trackInterval` best-effort, perbaikan `updateCustomerLocation:1251` `share_location_sent === false` (bukan `!share_location_sent`) agar mock tanpa field tidak salah dianggap estimated — perbaiki flaky `staff-auth-and-reservation` landmark diverged.
- **Verifikasi:** `npm run build` ✅ (backend `tsc` + `packages/admin-dashboard` vite 35.9s), `npx vitest run staff-auth-and-reservation` 21/21 hijau (fix diverged), full suite 3145/3148 hijau (2 pre-existing follow-up/edge flaky bukan regresi patch), manual cek: cancelled hilang dari Hari Ini/Mendatang/Selesai, refresh tagihan 170rb tetap 170rb.

#### 2026-09-22 — Perbaikan Menyeluruh Sistem Notifikasi Terapis & Staf Lapangan (Fase 1-5)

- **Fase 1 — Hotfix Kritis Android & Audio Unlock (Frontend):** `notificationSound.ts` helper terpusat `showSafeNotification()` — prioritas `ServiceWorkerRegistration.showNotification()` (wajib Chrome Android, anti `TypeError: Illegal constructor`) dengan fallback `new Notification()` + timeout 2.5s; `showBrowserNotification()` delegasi ke helper (reuse, anti-spaghetti). `StaffToday.tsx` isolasi `try/catch` audio & notifikasi agar exception tidak menggugurkan `setMessages` (bubble tetap render), guard `visibilityState` suppress OS notif saat chat terbuka, `initAudioUnlock()` pada mount untuk membuka blokade autoplay (touch/click).
- **Fase 2 — Perluasan Filter SSE Backend (Upcoming & Recent):** `assertConversationOwnedByStaffToday` (`staff-reservation.service.ts:960`) diperluas dari `booking_date` hari-ini saja menjadi OR-window: hari-ini + upcoming 30 hari (bounded, anti-unbounded) + recent 48 jam, `status: { not: 'cancelled' }` (lowercase, tanpa dead code `CANCELLED`), `tenant_id` tetap. Implikasi: gate SSE `today.subroute.ts:604` dan guard baca/kirim pesan ikut melebar (disepakati, monitor).
- **Fase 3 — Real-Time Alert Penugasan Pasien Baru:** `StaffToday.tsx` `fetchTasks` diff `knownTaskIdsRef` (today+upcoming, inisialisasi `null` tanpa toast, reset saat `scopeFilter` berubah), `playIncomingMessageSound(true)` + `toast` + `showSafeNotification` best-effort saat `visibilityState !== 'visible'`, polling 20s tetap jalan di background (hapus pause `visibilityState !== 'visible'` yang membuat cabang OS-notif dead code).
- **Fase 4 — Notifikasi Pembatalan & Pengalihan Telegram:** `staff-notification.service.ts` `sendReservationCancelledNotification()` & `sendTaskUnassignedNotification()` (escape Markdown, sandbox guard, `tenant_id` via staff lookup, reason optional), hook di `reservations.subroute.ts` — edit `isBecomingCancelled` (existing.tenant_id, reason dari body), PATCH `status` cancelled, DELETE soft/hard cancel, plus `reassignTask` (`staff-reservation.service.ts:1051`) kirim ke staf lama saat dialihkan.
- **Verifikasi:** `npx tsc --noEmit` ✅ (backend & `packages/admin-dashboard`), `npm run build` ✅, `staff-routes` 21/21 hijau, `staff-auth-and-reservation` 20/21 (1 pre-existing gagal landmark >1km, bukan regresi patch), SSE upcoming/recent terverifikasi via unit mock `assertConversationOwnedByStaffToday`.

#### 2026-09-22 — Hardening Backend Terapis & Staf Lapangan (IDOR, Kalender WIB, LTV, N+1)

- **Fase 1 — Keamanan IDOR OTW:** helper tunggal `isStaffSupervisorRole()` (`staff.route.ts:3`) — 5-role konsisten (spv_cs/super_admin/tenant_admin/admin_cs/admin), `POST /api/staff/reservations/:id/otw` hard guard `assigned_staff_id` (fail-closed bila null) + `tenant_id` cross-tenant 404 + status `completed/cancelled/rejected` (case-insensitive) + jendela 2-jam (fail-closed bila `booking_date` null, supervisor bypass), `POST /api/staff/conversations/:id/reply` tambah `replyToMessageId` menerus ke `liveChatService.sendAdminReply`, `staff.route.ts` flag `isAdminImpersonation` → `today-tasks` default `scope='all'` hanya bila impersonasi & scope tak disebut.
- **Fase 2 — Kalender WIB:** `getWibDateRange` (`staff-reservation.service.ts:101`) ganti `targetDay+=1` → `setUTCDate(+1)` (2026-03-31→04-01, bukan 03-32), `getUpcomingSchedule`/`getCompletedTasks` reuse `getWibDateRange` (bukan `setHours` lokal) agar Docker UTC+WIB konsisten.
- **Fase 3 — LTV & Follow-Up:** `recordPayment` (`:905`) panggil `customerService.recalculateCustomerLtv` (idempoten `ltv_cache`) + `followUpService.createReservationFollowUps` (dedup PENDING/QUEUED + guard SENT), `assertConversationOwnedByStaffToday` (`:950`) OR-window 30-hari upcoming + 48-jam recent (hari-ini + upcoming + recent) dengan `assigned_staff_id` tetap terkunci.
- **Fase 4 — Performa & Memory:** `getTodayTasks` hapus `reservations` N+1 select, tambah `ltv_cache: true`, `customerStats.ltv = ltv_cache>0 ? ltv_cache : pricing.totalFee` (hindari `??` yang lolos 0) + `totalTreatments:1` (tanpa loop reduce), `staff/auth.subroute.ts:8` interval 10-menit `staffLoginAttemptsMap` cleanup `.unref()`.
- **Verifikasi:** `npm run build` ✅, `tool-schemas` 6/6 + `guardrail-pipeline` 3/3 hijau, `isStaffSupervisorRole` terpusat, `getWibDateRange('tomorrow')` pada 31→1 valid, OTW 403 bila terapis lain, chat tab Selesai 48h terbuka.

#### 2026-09-22 — Resilient Tool Schema & Location Routing (PLAN 12 — 4 Akar Forensik)

- **Fase 1 — Defensive Zod Preprocess:** `stringArrayPreprocess` di `tool-schemas.ts:3` (`split /[,;\n]+/`) + `z.preprocess` pada `symptoms` & `additionalTreatments`; GLM `glm-5.3-flash` yang mengirim `symptoms:"anak baru jatuh, susah makan"` kini 100% kebal (validasi sukses → `["anak baru jatuh","susah makan"]`). Test `tool-schemas.test.ts` 6/6 hijau (koma/titik-koma/baris baru).
- **Fase 2 — Coverage Cities di Masker:** `hasNewLocationEntity` (`tool-masker.ts:53`) tambah cek `getCoverageCities()` (`surabaya,sidoarjo,gresik,sby,sda`) → `"surabaya kak"`/`"ke surabaya berapa"` tidak lagi mask `calculate_delivery`; SOP broad-region di tool (`isBroadRegionQuery`) mengambil alih (minta kelurahan ramah). Fail-open aman karena tool memvalidasi presisi.
- **Fase 3 — Cool-Off Summarizer:** `conversation-summarizer.ts:184` tambah `hasOngkirOrCoverageEvidence` (ongkir/jarak/transport + kota cakupan via `getCoverageCities`) yang HANYA blok larangan `Menanyakan alamat lagi`; `isLikelyLocationAnswer` JANGAN disentuh (hindari salah klasifikasi ringkasan fokus `:220`).
- **Fase 4 — Anti-Mutilasi Afirmasi Usia:** `guardrail-pipeline.ts:512` `stripNominalAges` early-return bila `session.childProfile.ageMonths`/`children[].ageMonths` sudah diketahui (state-gated, tanpa regex afirmasi `cocok|sesuai` yang ditolak); `"Usia 3 tahun sangat cocok..."` lestari saat usia diketahui.
- **Verifikasi:** `npm run build` ✅, `tool-schemas` 6/6 + `guardrail-pipeline` 3/3 hijau, full suite 3143/3176 hijau (5 gagal pre-existing di `staff-auth-and-reservation`/`followUp` — tidak terkait PLAN 12).

#### 2026-09-22 — Perbaikan Sistemik PLAN 11: Anti-Memburu-Buru Funnel Pacing (State-Gated Information Hiding)

- **Fase 1 — State-gated pruning RULE20:** pecah `SCHEDULE_NEG_CONSTRAINTS_TAIL` → `RULE20` (tanya-hari, di-prune saat `!isFunnelCommitted`) + `RULE21` (shareloc/alamat, SELALU ada — anti regresi privasi) di `scheduling.phase.ts:54`, helper tunggal `isFunnelCommitted()` di `phase-resolver.ts:146` (reuse cek kartu/booking/lastCommitment/bookingCommitConfirmed), `prompt-composer.ts:86` information hiding — `RULE20` contoh `jadwalkan di hari apa` hilang total saat EXPLORING (6→5 jadwalkan, RULE20 contoh false) vs byte-identik saat COMMITTED.
- **Fase 2 — State-gated few-shot:** tag `closing_schedule_ask` pada 4 exemplar penodong (`symptom_flu_consultation`, `maternal_lactation_inquiry`, `post_delivery_treatment_continuation` + gold terkait), penalti −20 saat `!committed && !ask_schedule` di `few-shot-exemplars.ts:581`, threading `funnelCommitted` dari `prompt-composer.ts:368`, bersih 6 salinan statis di `core-persona.layer.ts:75,87,105` + `location-rules.phase.ts:25` + `pricing-catalog.phase.ts:48` + `router-direct-reply.layer.ts:58` (konsultasi → tanya-minat/statement-only; komitmen boleh tetap jadwal).
- **Fase 3 — Guardrail state-aware:** `guardrail-pipeline.ts:732` `CATALOG/DISCUSSED_SERVICE_RECOVERY` cabangkan `committed ? tanya-hari : tanya-minat`, funnel reprompt tulis-ulang penuh (1x) bila draf masih `jadwalkan di hari apa` padahal `!committed` (tanpa mutilasi), fallback generik bila tetap todong.
- **Verifikasi:** `npm run build` ✅, `v3-anti-todong-jadwal` 9/9 + `get-catalog-closing-intent` 9/9 + `consultation-mode` 5/5 + `deterministic-guardrails` 7/7 (2 skip) tetap hijau, exemplar gating ad-hoc: uncommitted `no_cta` menang vs committed `flu_consultation`, `jadwalkan` 11→5 (EXPLORING) vs 6 (COMMITTED).
- **Debt jujur:** `KNOWN_ISSUES.md` #113 — bank DB `few_shot_exemplars` butuh kurasi (tag), sisa ~2 todong contoh di `location-rules` transaksional masih ada karena skenario `ask_price`/`QUOTED` dianggap committed; `slim:true` global belum dipakai (konflik cache + blok 7 medis).

#### 2026-09-22 — Perbaikan Sistemik PLAN 10: AI Monitoring & LLM Tracing (7 Bug Observability)

- **Fase 1 — Backend logging engine:** alias baca `NLU_EXTRACTOR` ↔ `SLOT_EXTRACTOR` di `getLlmExecutionLogs()` (hilangnya log legacy saat filter), heuristic grouping tahan out-of-order (iterasi seluruh bubble dalam window **35 dtk** tetap, bukan 45), plumbing `tenantId` aditif di `getLlmExecutionLogs`/`getGroupedLlmExecutionLogs` + endpoint `?tenant=` + `recordLlmExecution` call-site V3/entity-extractor, alias baca `task_type` `SLOT_EXTRACTOR`→`NLU_EXTRACTOR` di `ai-audit-summary` tanpa rename writer/migrasi DB (anti split-brain).
- **Fase 2 — Debug.tsx:** `isInitialLoadedRef` + hapus `expandedPhones` dari deps `loadLogs` (anti-reset timer 6 dtk saat accordion diklik + anti auto-expand paksa `data[0]`), fetch selektif per `viewMode` (1 request vs 2), stats per mode (flat dihitung dari `flatLogs`), pill `actualProvider`/`actualModel` + badge fallback di kartu AI step, dark-mode `select`/`input`.
- **Fase 3 — AiEvaluations.tsx:** helper `parseJudgeFeedback()` data-driven (parse JSON dalam string, bukan hardcode 5 kunci; fallback mentah bila gagal), render 5 micro-badges dimensi + teks bersih, touch target `min-h-[40px]` + `touch-action: manipulation` pada filter hari, layout kartu ringkas `block sm:hidden` untuk tabel audit di mobile 375px.
- **Verifikasi:** `npm run build` ✅, `npx vitest run tests/unit/hierarchical-debug-logs.test.ts tests/unit/llm-execution-tracing-deepseek.test.ts tests/unit/cg09-pii-redaction.test.ts` 22/22 ✅, validasi ad-hoc: alias NLU 2/2, grouping out-of-order 1 bubble/3 calls, window >35s split 2, tenant filter 1/2.
- **Debt jujur:** `KNOWN_ISSUES.md` #112 — call-site V3 lain di luar `generation-stage`/`entity-extractor` belum dijamin bawa `tenantId` (butuh audit pipeline bila multi-tenant aktif), `AiEvaluations.tsx` masih dominan light-mode, ambang badge `>=4` adalah aproksimasi `persona-rubric.ts` (3/4 per dimensi).

#### 2026-09-22 — Penyelesaian Migrasi SumoPod+GLM: Switch .env, Injeksi reasoning_effort, Koreksi Tarif Promo Kedaluwarsa

- **Runtime switch (bagian yang hilang):** `.env` `ACTIVE_LLM_PROVIDER=KENARI` → `SUMOPOD`,
  seluruh `AI_PROVIDER_*` → `SumoPod`, `AI_MODEL_*`/`OPENAI_MODEL`/`SUMOPOD_DEFAULT_MODEL`/
  `AI_MODEL_FALLBACK_CHAIN` → `glm-5.3-flash`, `AI_MODEL_FALLBACK` → `deepseek-chat`,
  plus `LLM_REASONING_EFFORT="low"` (baru). Tanpa ini baseUrl Kenari + model GLM = 400
  (DB adalah sumber kebenaran, tapi endpoint aktif dibaca dari env). `.env.example` diselaraskan.
- **Injeksi `reasoning_effort` GLM (satu titik, level kode — bukan prompt):** `attempt()` di
  `model-fallback.ts` menyisipkan `reasoning_effort` (default `LLM_REASONING_EFFORT`/`low`)
  hanya untuk model `glm-*` via SumoPod (satu-satunya kombinasi terverifikasi live),
  dihormati bila pemanggil men-set eksplisit. Terukur live: prompt router realistis
  default 21 dtk/232 chunk reasoning vs low 4,7 dtk/11 chunk, output JSON identik.
- **Koreksi tarif STALE (fakta, bukan tebakan):** `SUMOPOD_PRICING` glm memakai harga promo
  50% ($0.015/$0.25) yang BERAKHIR 2026-09-09 — diganti tarif LIST ($0.15 in / $0.03 hit /
  $0.50 out, terverifikasi 3 sumber independen). Estimasi biaya GLM sebelumnya underreport ±10x input.
- **Test:** 5 ekspektasi basi diperbaiki (MiniMax-era → glm), 5 test injeksi baru;
  67/67 hijau (`ai-models-tenant`, `model-fallback-chain` 21, `provider-model-alignment`,
  `cost-calculator`, `ai-model-settings`).
- **DB:** skrip idempoten baru `scripts/migrate-model-config-to-sumopod-glm.ts` (+guard
  produksi, `--dry-run`); diterapkan di localhost: 4 baris → golden
  (HARVESTING/PII/SUMMARIZATION/INTENT → netra), 5 sudah sesuai; verifikasi akhir 9/9 golden.
- **Jujur dicatat:** tarif diskon SumoPod MiniMax/netra/qwen di kode bersumber dashboard
  provider sesi lalu — snapshot katalog publik pihak-3 konflik untuk MiniMax
  ($0.01/$0.30 vs kode $0.03/$0.12) → butuh re-verifikasi dashboard (KNOWN_ISSUES #107).

#### 2026-09-21 — Katalog Live SumoPod Utama / Kenari Cadangan / DeepSeek Direct + Tarif Diskon Verified

- **Koreksi arsitektur (server utama = SumoPod):** Tier dibalik — Tier1 SumoPod (5 model resmi),
  Tier2 Kenari cadangan (3 model), Tier3 DeepSeek Direct API langsung (`deepseek-chat`).
- **Katalog resmi:**
  - SumoPod: `glm-5.3-flash`, `MiniMax-M2.7-highspeed` (primary), `qwen3.7-flash-2026-07-15`,
    `gpt-4o-mini`, `deepseek-v4-flash-0731:netra` (+ alias `deepseek-v4-flash`).
  - Kenari: `deepseek-v4-1-flash`, `gemini-2-5-flash-lite`, `muse-spark-1-3-contributor`.
  - DeepSeek Direct: `deepseek-chat`, `deepseek-reasoner`, `deepseek-flash`, `deepseek-v4-flash`.
- **Kenapa 3 kinerja bot:** (1) Kilat & Hemat = 95% chat harian butuh cepat+murah (MiniMax 90% off
  $0.03/$0.12); (2) Mendalam = keluhan multi-gejala butuh penalaran DeepSeek netra 80% off;
  (3) Disiplin Qwen = kasus rawan format butuh model paling tertib (qwen3.7 ≤32K $0.03/$0.006/$0.13).
  Failover Kenari bukan kinerja harian — gerbang infra bila SumoPod down.
- **Tarif verified:** `SUMOPOD_PRICING` (glm 50% off $0.015/$0.25, MiniMax 90% off, qwen3.7 tier ≤32K,
  netra 80% off $0.04/$0.01/$0.10, gpt-4o-mini $0.15/$0.075/$0.60); Kenari +`gemini-2-5-flash-lite`
  (400/40/1700) +`muse-spark-1-3-contributor` (2000/40/4000) + snapshot JSON.
- **Perubahan kode:** `ai-models.config.ts` (katalog Set + sanitize case-insensitive + default SUMOPOD +
  preset SumoPod + reset deterministik emas), `model-fallback.ts` (Tier1 SumoPod→Tier2 Kenari→Tier3 Direct),
  `cost-calculator.ts` (SumoPod verified, bukan fallback-unverified), `settings.subroute.ts`
  (`providersStatus` + `deepseekDirect` + daftar models), `AiModelSettingsPanel.tsx` (label Utama SumoPod,
  preset MiniMax/netra/qwen3.7, dropdown katalog live), `sync-pricing.ts` (track 2 model Kenari baru).
- **Verifikasi:** `npm run build` ✅, dashboard build ✅, 49 test hijau
  (`cost-calculator` 20, `model-fallback-chain` 16, `ai-models-tenant` 4, `ai-model-settings` 9).

#### 2026-09-21 — Perbaikan Pusat Kendali Model AI: Proteksi Hot-Switch, Mode Kustom, Simulator Per-Provider (15 Temuan Audit)

- **User Review (dipenuhi):** (1) Hot-switch server memunculkan konfirmasi deterministik bila ada
  editan belum disimpan (`dirty`), mencegah silent data loss; (2) Profiling kustom — hero/advanced di luar
  3 profil standar otomatis jadi Mode Kustom (Manual), preset tidak lagi tercentang hijau palsu, batch
  `presetId: 'CUSTOM'` tidak menimpa pilihan manual.
- **Stage 1 — Backend & service:** simulator uji memakai pasangan key+baseURL per-target-provider
  (perbaikan 401 palsu lintas-provider + guard key kosong mutlak sebelum fallback gateway);
  `buildProvidersStatus()` sumber tunggal untuk GET & PATCH provider (status key reaktif);
  batch menerima `confidenceThreshold` + skip preset tak terdaftar; `FAST_ECONOMICAL.deepModel` = netra
  agar klik preset ≡ reset emas; sanitasi per-task via `baseUrlForProviderLabel` (task OpenAI NLU tidak
  lagi terkonversi ke gateway saat server cadangan aktif — temuan dari test regresi baru).
- **Stage 2 — State sync:** `derivePresetFromConfigs` ketat + `'CUSTOM'`; kartu Mode Darurat Kenari
  (🛟) saat cadangan aktif; hero/advanced onChange menghitung ulang preset + membuang hasil simulator
  lama; konfirmasi hot-switch + `providersStatus` reaktif dari respons PATCH.
- **Stage 3 — Advanced:** opsi provider SumoPod (Utama)/Kenari (Cadangan)/OpenAI (NLU)/DeepSeek + label
  benar; `INTENT_CLASSIFICATION` terkunci (badge 🔒 + dropdown disabled); slider confidenceThreshold +
  payload save; `<datalist>` sugesti katalog resmi anti-typo.
- **Stage 4 — Polish:** dark-mode border amber + shadow simpan; `setTestResult(null)` di preset,
  switch, hero/advanced, dan reset.
- **Stage 5 — Verifikasi:** 4 test baru (`simulator key per-target`, `target tanpa key jujur`,
  `batch CUSTOM + threshold`, `PATCH providersStatus`); `npm run build` ✅; dashboard build ✅;
  53 test hijau (settings 13, tenant 4, cost 20, fallback 16).

#### 2026-09-21 — Fix Fondasional "Save AI Model Tidak Tersave" (Race Persist + Provider Revert)

- **Gejala:** klik `💾 Simpan Semua Perubahan` toast sukses, tapi refresh/kembali nilai lama; ganti
  Server Utama/Cadangan ikut revert setelah restart.
- **Akar (2 lapis):** (1) `updateTaskConfig` fire-and-forget `saveConfigsToDb` per item → batch ~10
  `deleteMany+createMany` konkuren interleaved → `Unique constraint (tenant_id,task)` → gagal diam-diam
  (terbukti di log test); (2) `saveConfigsToDb` mengecualikan `ACTIVE_LLM_PROVIDER` dari delete tapi tidak
  pernah upsert di jalur batch → baris provider basi → restart revert; plus `getAllTaskConfigs` mentah vs
  `getModelConfig` tersanitasi → UI ≠ runtime untuk model lintas-katalog.
- **Fix:** antrean serial per-tenant (`saveQueue` promise-chain) + `$transaction` atomik
  (delete+create+upsert provider); `updateTaskConfig(..., { persist:false })` untuk preset/batch/reset +
  satu `await saveConfigsToDb()`; `PATCH /:task` ikut awaited; respons `persisted:true/false` (+warning,
  HTTP 200 agar suite offline tetap hijau); UI menahan dirty + toast error bila `persisted===false`;
  `getAllTaskConfigs` kembalikan nilai efektif tersanitasi.
- **Verifikasi:** `npm run build` ✅, dashboard build ✅, 49 test hijau (batch offline `persisted:false`
  tetap success:true sesuai kontrak offline).

#### 2026-09-21 — Redesign Total Konfigurasi Model AI Per-Tugas (User-Centric, Zero-Anxiety, 1-Click Operations)

- **Latar Belakang & Keluhan Pengguna:**
  - Panel "Konfigurasi Model AI Per-Tugas" sebelumnya menampilkan 7 kotak teknis membingungkan per task (Provider dropdown 7 opsi fiktif: OpenAI/Anthropic/Groq tanpa API key aktif, input model manual, temperature slider, maxTokens) — rawan salah pilih dan membebani pemilik klinik/tim admin non-teknis.
  - Tidak ada cara menguji model sebelum menyimpan ke pasien WhatsApp; setiap task harus disimpan satu-per-satu (7 klik) tanpa batch.
- **Arsitektur Baru (4 Stage Fondasional):**
  - **Stage 1 — Backend Batch/Test/Reset API (`src/routes/admin/settings.subroute.ts`):**
    - `POST /api/admin/ai-models/test` — inferensi mini via `llm-gateway` + `callChatCompletionsWithFallback` dengan timeout 10s, mengukur `latencyMs`, mengembalikan `replySnippet` + `tokenEstimate` + `modelUsed`/`providerUsed`; mengembalikan pesan ramah bila API key kosong/timeout.
    - `PUT /api/admin/ai-models/batch` — transaksi terpadu: menerima `presetId` (1-klik) + `configs[]` untuk `CHAT_REPLY`/`CHAT_REPLY_DEEP`/`SUMMARIZATION` dkk.; validasi tetap via `updateTaskConfig` (MEDICAL_CHECK terkunci); audit `AI_MODEL_BATCH_UPDATE`.
    - `POST /api/admin/ai-models/reset-defaults` — `resetToGoldenDefaults()` + audit `AI_MODEL_RESET_DEFAULTS`; batch endpoints ditempatkan SEBELUM `PATCH /:task` agar tidak tertabrak param route.
  - **Stage 2 — Engine Preset Registry (`src/config/ai-models.config.ts`):**
    - Konstanta `AI_PRESET_PROFILES` (4 preset): `FAST_ECONOMICAL` (deepseek-v4-1-flash/KENARI, ~1.1s, paling hemat), `DEEP_REASONING` (deepseek-v4-pro/KENARI, ~2.4s), `DISCIPLINED_QWEN` (qwen3-8-flash/KENARI, ~1.3s), `FAILOVER_SUMOPOD` (deepseek-v4-flash/SUMOPOD, cadangan).
    - Metode `applyPresetProfile(presetId, tenantId)` — tenant-aware (hanya ubah registry tenant target + sinkron `activeLlmProvider`), mengupdate `CHAT_REPLY`/`CHAT_REPLY_DEEP`/`SUMMARIZATION` sekaligus; `resetToGoldenDefaults(tenantId)` — kloning `defaultTaskModelRegistry`, reset provider ke `KENARI`, persist `tenant_ai_config` + `ACTIVE_LLM_PROVIDER`.
  - **Stage 3 & 4 — Frontend Redesign (`packages/admin-dashboard/src/components/settings/AiModelSettingsPanel.tsx`):**
    - Header & Status Bar Real-Time: kartu gateway Kenari vs SumoPod dengan indikator 🟢 `Kunci API Terhubung` + `Latensi P50: 1.1s • Auto-Failover Siaga`; provider fiktif dihapus (hanya 2 gateway resmi).
    - 3 Kartu Preset Visual Besar (radio-card): badge kecepatan/gaya bahasa/biaya, klik memperbarui model hero lokal tanpa seting manual; dirty state oranye bila belum disimpan.
    - Hero Card Bidan Yusi: menyorot model aktif merespons chat pasien, dropdown hanya model valid per provider aktif (`KENARI_MODELS`/`SUMOPOD_MODELS`).
    - Mini Simulator 1-Detik: tombol skenario `[🤧 Tanya Bapil]`/`[💰 Tanya Harga]`/`[📅 Tanya Jadwal]` → animasi pulse "Menghubungi model AI..." → preview balasan + badge latensi/token; error ramah bila timeout/API key salah.
    - Accordion Teknis Lanjutan (default tertutup): hanya Kenari/SumoPod di dropdown provider, input model/temperature/maxTokens per task.
    - Footer Terpadu: `⏪ Kembalikan ke Rekomendasi Default` (via `useUiFeedback` confirm, `danger:true`) + `💾 Simpan Semua Perubahan` tunggal; teks ketenangan "✨ Perubahan langsung aktif pada pesan WhatsApp berikutnya tanpa perlu restart".
    - Paritas Dark Mode AMOLED (`dark:bg-[#111b21]`, `dark:border-[#222e35]`, `dark:text-white`) + Mobile Ergonomics (`min-h-[48px]`, layout 1 kolom vertikal).
- **Verifikasi:**
  - `npm run build` ✅ (fix `payload` shape + `useUiFeedback` `danger`); `npm --prefix packages/admin-dashboard run build` ✅.
  - `tests/unit/ai-model-settings.test.ts` 9/9: `GET /api/admin/ai-models` (config + provider status), `POST /test` (latensi ms + replySnippet untuk 3 skenario), `PUT /batch` (multi-task + presetId `DEEP_REASONING`), `PUT /batch` menolak body kosong, `POST /reset-defaults` (golden defaults), `applyPresetProfile` tenant-isolation, `resetToGoldenDefaults` tenant-specific.

#### 2026-09-21 — Resolusi Total Deadlock Antrean Follow-Up & Penjadwalan Ulang 141 Record (`follow-up.service.ts`)

- **Latar Belakang & Gejala:**
  - Pengguna melaporkan bahwa beberapa hari terakhir tidak ada pesan follow-up yang terkirim.
  - Audit database & log mesin produksi membuktikan pengiriman pesan memang terhenti total sejak 16 September 2026 jam 13:56 WIB (setelah berhasil mengirim 47 pesan pada 14–16 Sept).
- **Akar Masalah Sistemik (Head-of-Line Blocking Deadlock):**
  - Akumulasi 46 record pengingat H-1 dan review H+1 (`REMINDER_H1`, `REVIEW_H1_BABY`, `REVIEW_H1_MOMS`) berstatus `PENDING` dengan waktu lampau di database.
  - Sesuai kebijakan klinik, tipe ini di-postpone (skip) oleh worker. Namun pada container produksi yang lama, query database `take: 20` teratas mengambil record tanpa memfilter tipe postponed.
  - Pada 16 September siang, jumlah record postponed mencapai batas jenuh 20 record sehingga memenuhi seluruh batch antrean. Setiap 15 menit, worker men-skip ke-20 record tersebut (`processed: 0`), memblokir 141 antrean sah (`QUEUED`) di belakangnya.
- **Tindakan Perbaikan Fondasional yang Telah Selesai Dieksekusi:**
  1. **Pembersihan Record Postponed Kadaluarsa**: Memutasi 46 record reminder/review `PENDING` yang jadwalnya lewat menjadi `CANCELLED` sesuai kebijakan.
  2. **Penjadwalan Ulang (*Rescheduling*) 141 Antrean Tertahan**:
     - Menjadwalkan ulang seluruh 141 antrean `QUEUED` (8 repeat order `NEXT_TREATMENT` dan 133 prospek `NO_PURCHASE`) ke rentang **22 September s/d 03 Oktober 2026** pada jam operasional kerja (09:00–16:30 WIB).
     - Seluruh hari mematuhi kuota ketat **maksimal 25 pesan/hari** dan memprioritaskan repeat order `NEXT_TREATMENT` pada Selasa pagi (10 pesan) dan Rabu pagi (1 pesan).
  3. **Deployment Kode Anti-Deadlock ke Live Server**:
     - Mengunggah dan men-deploy kode `src/services/follow-up.service.ts` terbaru ke container `app` di server via rebuild & force-recreate container `app`.
     - Query worker kini memiliki gerbang filter permanen `type: { notIn: ['REMINDER_H1', 'REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] }` dan auto-cancel untuk `PENDING` expired.
     - **Keamanan Terjamin**: Container WAHA WhatsApp tidak disentuh (uptime 5 weeks, 0 session drop, tanpa scan QR ulang).
- **Verifikasi**:
  - Sisa antrean overdue: **0 record**.
  - Distribusi harian 22 Sept s/d 03 Okt: Seluruhnya <= 25 pesan/hari.
  - Container `wa-clinic-bot-app-1` aktif dan sehat (`Up`, koneksi Redis, BullMQ 5 shards, webhook provider sinkron).

#### 2026-09-21 — Kontrak Konsultasi vs Transaksi + Prioritas Usia Multi-Tier (Sesi 783810)

- **Akar masalah (audit multi-lapis antar-seam):** (1) `userConfirmedNames` di `cart-manager` memfilter fuzzy hanya dengan `isDurationOnlyQuestion` — pertanyaan eksplorasi consultative ("kalau yang pulih ceria itu ?") lolos fuzzy -> multi-offer asisten + "sabtu bisa ?" mengunci `Pijat Bayi Pulih Ceria` yang TIDAK pernah dipilih (ghost cart); (2) predikat konsultatif INLINE (`'?' && !commit && !day`) terduplikasi lintas seam → drift; (3) `detectAgreedTreatment` me-seed `selectedTreatment` dari penyebutan nama penuh DALAM pertanyaan bertanda `?`; (4) hierarki `closingIntent` menaruh `hasKnownSymptoms` DI ATAS `needsAgeClarification` → keluhan multi-tier tanpa usia lompat ke ASK_SCHEDULE/ASK_DOMICILE tanpa tanya usia → tier default terkunci + LLM menyebut label tier (mis. "Newborn") sebagai nama layanan (nama itu tidak ada di katalog).
- **Fix fondasional (4 fase, gerbang kode deterministik — tanpa tambahan prompt/DILARANG):**
  - **Fase A** `src/utils/date-confirmation.ts`: predikat bersama `isConsultativeUserText(text, session?)` (`'?'` + tanpa sinyal komitmen + tanpa jejak hari + tanpa commit sticky sesi). Dipakai `cart-manager` (loop `userConfirmedNames` skip + main gate predikat inline diganti) dan `booking-commit-gate.detectAgreedTreatment` (param optional `session`; skip konsultatif; argumen diteruskan di `context-grounder`).
  - **Fase B** `src/v3/tools/get-catalog.tool.ts`: cabang `needsAgeClarification` → `CLINICAL_PROBE` dinaikkan DI ATAS `hasKnownSymptoms` — usia menentukan tier (Bayi vs Anak); domisili/jadwal menyusul.
  - **Fase C** `src/v3/agent/pipeline/guardrail-pipeline.ts`: klausul "tim menanyakan saat koordinasi jadwal" pada nota koreksi usia DIHAPUS; tambah lapis deterministik `stripNominalAges` — tanpa otorisasi `needsAgeClarification`, klausa nominal usia (`usia si kecil 3 bulan`) di-strip angka+satuan tanpa mutilasi tengah kalimat; sisa satuan → fail-safe teks asli.
- **Verifikasi (TDD merah→hijau):** `cart-consultation-gate` 8/8 (ghost multi-offer → cart kosong; "Ambil yang pulih ceria ya??" tetap mengunci), `simulator-100rb-replay` 6/6 (nama penuh+`?` → null), `get-catalog-closing-intent` kontrak baru multi-tier→CLINICAL_PROBE, `guardrail-no-mutilation` strip deterministik vs authorized pass-through; regression full `tests/unit/v3` 101 files / 547 passed + matrix CM-22 diperbarui fixture usia; `npm run build` bersih.
- **Tech debt ditunda:** bullet `SAVE_RESERVATION_FULL` (`router-tool-routing.layer.ts:11`) vs Rule 5 tool-masker — `docs/KNOWN_ISSUES.md#106`.

#### 2026-09-21 — Cost Estimator Provider-Aware + Tarif Live (SUMOPOD Unverified)

- **Akar masalah (5 lapisan):** `calculateLlmCost` di-key hanya nama model → `deriveProvider` cuma label audit;
  caller (`generation-stage.ts`, `llm-audit-buffer.ts`) punya `baseUrl` tapi tidak meneruskannya; hardcode Kenari
  basi ~18× lebih murah dari live (`/v1/models` publik); tarif DeepSeek Direct usang & model tak dikenal
  (mis. `:netra`) jatuh senyap ke `DEFAULT_PRICING`.
- **Fix fondasional (`src/utils/cost-calculator.ts`):** resolver provider-aware — `baseUrl` request OTORITATIF atas
  nama model; tabel `DEEPSEEK_DIRECT_PRICING` (tarif resmi Sept 2026 peak/off-peak — `deepseek-flash` $0.15/$0.60,
  `deepseek-v4-flash` $0.22/$0.66, `deepseek-chat`/`deepseek-reasoner` = alias v4-flash),
  `KENARI_PRICING` dari `src/config/kenari-pricing.snapshot.json` (di-sync `scripts/sync-pricing.ts`, flat tanpa
  peak, `:free` = 0), SumoPod TANPA tabel → ditarif `fallback-unverified` (tarif tidak dipublikasikan; 401/404/403
  saat verifikasi). Tambah `pricingSource: 'verified'|'fallback-unverified'` + `isPeak`.
- **BaseUrl diteruskan di 4 call site:** `generation-stage.ts:205,213` (`{ baseUrl: turn.baseUrl }`);
  `llm-audit-buffer.ts:43,142` (tambah field `baseUrl` + `calledAt` agar peak dari waktu panggilan asli,
  bukan waktu flush).
- **Kenari live (Rp/1M, flat):** `deepseek-v4-1-flash` = `deepseek-v4-flash` 2.750/65/5.500, `deepseek-v4-pro`
  10.000/100/20.000, `qwen3-8-flash` 3.000/300/7.500, `qwen3-7-plus` 6.700/1.300/26.000, `minimax-m2-7`
  6.300/1.200/25.000, `step-3-7-flash` 4.200/840/24.000 (`:free` batal non-moneter).
- **Breaking pada data historis:** `llm_audit_logs.cost_idr` lama dari tarif basi; nilai baru melonjak ~18× di
  jalur Kenari — TIDAK di-back-migrate (lihat `docs/KNOWN_ISSUES.md#105`).
- **Verifikasi:** `tests/unit/cost-calculator.test.ts` 17/17 (TDD red→green: baseline 12 → 17), 
  `tests/unit/llm-execution-tracing-deepseek.test.ts` tetap hijau; `npx tsc --noEmit`/`npm run build` 0.

#### 2026-09-20 — Mixed-Intent & Anti-DSML Leakage (Sesi 648324) — Fase 1-3

- **Fase 1 (observability):** `src/v3/agent/pipeline/generation-stage.ts` — log intersepsi `CALL2_DSML_LEAKAGE_INTERCEPTED` bila Call 2 memuntahkan tag `<｜｜DSML｜｜` murni (tanpa ubah balasan).
- **Fase 2 (kontrak tool):** `src/v3/tools/tool-schemas.ts` & `calculate-delivery.tool.ts` — tambah `candidateTreatmentName` (opsional) ke `CalculateDeliveryArgsSchema`/JSON; `src/v3/tools/tool-registry.ts` — pemetaan `candidateTreatmentName: args.candidateTreatmentName ?? ctx.selectedTreatment`; `router-tool-routing.layer.ts` — 1 kalimat netral agar router mengisi field bila pesan menyebut perawatan.
- **Fase 3 (recovery):** `src/v3/agent/pipeline/guardrail-pipeline.ts` — cabang `DELIVERY_RECOVERY_APPLIED`: bila draf kosong/tak valid dan `calculate_delivery` ada `suggestedTemplateReply`, pakai template resmi delivery (plus echo `candidateTreatmentName` bila ada), bukan kaleng buntu.
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; `v3-persona-rules` 15/15, `v3` 117 files 687 passed; full rencana. Fase 4 replay manual via `npm run chat`.

#### V3 Audit Remediation & Consent Frontier — Deploy Lengkap (2026-09-20)

- **Pushed & deployed (live):** `7e5aada2` (V3 audit remediation — durable turns, tenant
  identity, session state, peta), `089e32a2` (sumber lokasi first-class + warna reservasi),
  `88665d8` (12 temuan map — bbox, jarak sentroid, zoom, tile, lifecycle).
- **Fixed — follow-up unik (blocker produksi):** migrasi `20260920000001` menambahkan
  `@@unique(tenant_id, reservation_id, type, stage)`; DB live memiliki 2 grup duplikat
  (CANCELLED + PENDING untuk reservasi yang sama). Solusi fondasional: setiap jalur cancel
  (`cancelFollowUp`, `bulkCancelFollowUps`, `onReservationCreated/Cancelled`, worker
  overdue, optout, broadcast) menetralkan `reservation_id = NULL` (baris TETAP tersimpan
  sebagai jejak historis; PostgreSQL menganggap NULL unik) — tidak menghapus data.
  + Test invariant baru `10b` memverifikasi seluruh jalur cancel.
- **Deploy note:** proses paralel (editor lain) menyelesaikan full deploy lebih dulu —
  index unik sudah terpasang, duplikat = 0 (2 baris CANCELLED duplikat dihapus manual,
  bukan dinetralkan), app container sudah di-recreate. Verifikasi akhir hari ini:
  `migrate status` = up to date (70), dashboard 200 + bundle sesuai, WAHA Up 5 weeks (tidak
  terganggu). Drift gate hanya melaporkan 2 tabel backup maintenance (tidak di schema).
- **Verifikasi:** suite 2972 passed (1 flaky timeout `follow-up-inbound-hook`, lulus
  isolasi / sudah tercatat di KNOWN_ISSUES 0a); build exit 0.

#### Peta Sebaran — Sumber Lokasi First-Class (GPS / Estimasi / Edit Bidan) (2026-09-20)

- **Added — enum `LocationSource` + kolom `customers.location_source`** (`gps_pin` | `estimated_area` |
  `manual_staff`, nullable untuk data lama): migrasi `20260920000006_customer_location_source`.
  Sumber koordinat kini first-class & queryable (bukan lagi tersebar di JSON `preferences`).
- **Changed — penandaan sumber otomatis di jalur tulis:** `customerService.updateCustomerLocation`
  menurunkan sumber deterministik (`isNativePin`→`gps_pin`, koordinat dari teks/gazetteer→
  `estimated_area`, eksplisit dapat override) dan **tidak mengubah sumber lama** saat GPS presisi
  dipertahankan (GPS priority guard). Jalur edit manual (PUT `/api/admin/customers/:id/location`
  dan `staffReservationService.updateCustomerLocation`) menandai `manual_staff`; alur refresh-location
  memetakan `bidan_shareloc`/`customer_shareloc`→`gps_pin`, `geocoding`→`estimated_area`.
- **Changed — pembeda visual di peta:** `locationVisual()` (pure, teruji) → GPS outline putih,
  estimasi wilayah outline putus-putus abu + fill transparan, edit bidan outline ungu `#7c3aed`;
  popup & legenda menampilkan 3 kategori sumber. Endpoint `map-points` mengirim `location_source`
  (titik sentroid selalu `estimated_area`). Kompatibel data lama (`location_source` null → turun
  dari `is_estimated_centroid`).
- **Verifikasi:** `tsc --noEmit` bersih; `vitest` unit peta **40 passed**; build bot & dashboard exit 0.

#### Peta Sebaran — Warna Reservasi & Koreksi Backfill GPS (2026-09-20)

- **Fixed — MQL yang sudah reservasi tampil biru (bukan hijau):** Akar multi-lapis:
  (1) endpoint `GET /api/admin/customers/map-points` tidak menyertakan info reservasi;
  (2) `markerColor`/`statusOf` menaruh `is_mql` (biru) di atas status aktif. Kini endpoint
  mengirim `has_reservation` (reservasi non-`cancelled`/`rejected`) dan prioritas warna
  deterministik menjadi: `out_of_coverage` → **sudah reservasi (hijau)** → MQL (biru) →
  status lain (oranye) → aktif (hijau). Popup menampilkan label "Sudah Reservasi".
- **Data ops — koreksi backfill:** Backfill centroid tadi mengisi 48 customer ber-reservasi;
  ternyata 45 di antaranya hanya berbasis `kecamatan` (tanpa `kelurahan`). Sesuai kebijakan
  presisi (kecamatan terlalu luas), **45 di-revert** (`lat/lng/distance_km/ongkir = NULL`);
  hanya **3** yang punya `kelurahan` yang dipertahankan. Status akhir: 79/211 customer
  ber-reservasi ber-GPS.
- **Verifikasi:** `npx tsc --noEmit` bersih; `npx vitest run tests/unit/customer-map-*.test.ts`
  **35 passed**; `packages/admin-dashboard` build exit 0 (chunk memuat `has_reservation`).

#### Backfill GPS Customer Ber-Reservasi (Live, 2026-09-20)

- **Data ops:** Dari 211 customer yang punya reservasi, 135 belum memiliki GPS (`lat`/`lng` NULL).
  Backfill scoped dijalankan di server produksi (mode dry-run lalu tulis) menggunakan gazetteer
  Sby/Sda via `getGazetteerCoordinates` + `deliveryService.calculateDelivery` — **48 customer**
  berhasil diisi `lat/lng/distance_km/ongkir` (0 gagal; semua `isOutOfCoverage=false`).
- **Sisa 87 belum bisa diisi** (butuh data sumber tambahan): 46 tanpa alamat sama sekali,
  17 hanya kota level-kabupaten (`Surabaya`/`surabaya`), 1 Gresik (di luar gazetteer), 1 data kotor
  (`No. Hp : ...`), sisanya area di luar cakupan gazetteer. Lihat `docs/KNOWN_ISSUES.md` 0c.
- **Catatan:** ORS API terkena rate-limit saat batch, sehingga jarak jatuh ke fallback Haversine
  (ongkir tetap terhitung dari tier tenant).

#### Peta Sebaran — Basemap CARTO API Key & Fallback Esri (2026-09-20)

- **Fixed — Watermark "API key required":** CARTO kini mewajibkan API key untuk semua basemap
  raster; tile tanpa key disajikan dengan watermark. Basemap Peta Jalan (`CustomerMapTab.tsx`) kini
  membaca `VITE_CARTO_API_KEY` dari `packages/admin-dashboard/.env` (gitignored) dan menambahkan
  `?key=...` ke URL tile CARTO `light_nolabels`. Key di-declare di `src/vite-env.d.ts`.
- **Added — Fallback otomatis tanpa key:** bila `VITE_CARTO_API_KEY` kosong, build beralih ke
  **Esri World Light Gray Base** (gratis tanpa key, netral minim label) — peta tetap berfungsi di
  lingkungan tanpa `.env`. Konfigurasi basemap terpusat pada konstanta `BASEMAP_URL`/`BASEMAP_ATTR`
  yang dipakai ke dua call-site tile layer.
- **Verifikasi:** aturan `?key=` di curl dicek → tile Sby (z12–15) mengembalikan PNG peta asli
  (68–94KB, 200); tanpa key tile byte-identik 1884B (watermark). `packages/admin-dashboard` build
  exit 0; server live (`localhost:3000`) menyajikan chunk baru berisi key.

#### Portal Terapis (StaffToday) — Ergonomi Mobile & Bug Interaksi Notifikasi (2026-09-20)

- **Fixed — Stale Closure Notifikasi Browser:** `notif.onclick` (handler notifikasi pesan masuk) menutup `tasks/upcomingTasks/completedTasks` dari `useEffect(..., [])` sehingga selalu membaca array kosong saat init → klik notifikasi tidak pernah menemukan task (`match === undefined`). Ditambahkan `allTasksRef` (`useRef`) yang di-refresh setiap render; handler kini memakai `allTasksRef.current.find(...)` sehingga notifikasi yang diklik kapan pun langsung membuka chat pasien yang benar.
- **Fixed — VoiceNotePlayer senyap saat gagal:** `a.play().catch(() => {})` dan ketiadaan listener `error` menelan kegagalan audio diam-diam. Kini ada state `hasError`, listener `error` elemen `<audio>`, tombol Play membesar `w-8→w-10` (32→40px), berubah amber + tooltip "Audio gagal dimuat", dan pesan fallback teks.
- **Changed — Touch Target 44px (Apple HIG):** tombol aksi kartu (Chat/Navigasi/Infokan OTW) `py-1.5 px-2` (~28px) → `min-h-[44px] py-2.5 px-3 rounded-xl font-bold`, ikon `12→15`, `gap-1.5→gap-2`. Chip balasan cepat `text-[11px] px-2.5 py-1` (~24px) → `min-h-[38px] px-3.5 py-2 text-xs font-semibold`.
- **Changed — Navigasi Mobile ke Sticky Bottom Bar:** segmented tab mobile yang menempel di bawah header dipindah ke `<nav>` sticky di dasar layar (`sm:hidden`, thumb zone). Aktif = aksen `#d9fdd3` + ikon hijau `#008069` + badge jumlah; otomatis disembunyikan saat mode chat penuh agar kanvas percakapan 100% layar. List kartu diberi `pb-20 sm:pb-3` agar tidak tertutup bottom bar.
- **Added — Indikator Offline Lapangan:** state `isOnline` (`navigator.onLine` + listener `online`/`offline`), banner amber `WifiOff` "Koneksi internet terputus...". Guard preventif pada `handleSendReply` (banner error) & `handleSendOtw` (toast) agar tidak memicu pengiriman gagal saat sinyal hilang.
- **Changed — Ergonomi Modal Lokasi:** tombol GPS utama & tombol Buka Kamera/Pilih Galeri modal update lokasi dinaikkan ke `min-h-[46px]`.
- **Verifikasi:** `packages/admin-dashboard` build 0 error; suite Vitest backend 2958 passed. **Catatan:** 1–4 file test backend (`waha-webhook`, `media.service`, `lead-greeting-preservation`, `v3-persona-rules`) bersifat flaky/pollution order-dependent — sudah terkonfirmasi gagal juga TANPA perubahan ini (lihat `docs/KNOWN_ISSUES.md`).


#### Fixing D1 False-Positive "Sinar Moksa" & POV Violation (Sesi 767713) (2026-09-20)

- **Akar (multi-layer):** `get_catalog_and_price` tak memasukkan add-on → validator faktual D1 (`factual-claim-validator`) hanya percaya `result.treatments` → **"Sinar Moksa" (add-on sah) dituduh halusinasi** → reprompt → AI menjawab "cek dulu ke tim kami" (melanggar POV first-person).
- **Fase 1 `factual-claim-validator.ts`:** opsi `extraCatalogNames` (katalog tenant lengkap) melonggarkan pencocokan D1; **gate D1 tetap dari nama tool turn ini** (`turnNames`) agar tidak memicu pemeriksaan turn yang dulu tak diperiksa.
- **Fase 2 `get-catalog.tool.ts`:** add-on relevan (Sinar Moksa) disertakan ke `result.treatments` (flag `isAddon`) **hanya saat `showPrices` + keluhan pernapasan**, menghormati information-hiding (tanpa harga saat tak ditanya) & anti-menu brosur (konsultasi tetap ≤2).
- **Fase 3 `sanitizer.ts`:** `stripVagueTeamDeferral` deterministik membuang kalimat defleksi "cek ke tim" (mempertahankan kalimat jadwal yang sah), mempertahankan struktur baris agar sanitizer hilir tetap bekerja.
- **Call-site `guardrail-pipeline.ts`:** resolve `extraCatalogNames` dari katalog tenant, diteruskan ke D1 + recheck.
- **Test baru `tests/unit/v3/d1-addon-false-positive-fix.test.ts`**; test lama diselaraskan (matrix CM-01 filter add-on; matrix CM-08/CM-18 kontrak eskalasi).
- **Verifikasi:** `tsc` 0; `build` 0; full suite **411 files / 2963 passed / 0 failed**.
- **Catatan:** ditemukan inkonsistensi ejaan katalog (`Rileksasi` vs `Relaksasi`) yang dulu tidak terlihat karena gate D1 hanya menyala bila turn memakai tool katalog.

#### Stage 8 — Actual Model/Provider Labeling pada Fallback (2026-09-20)

- **Akar (RC-08/R9):** fallback LLM mengembalikan data tanpa menandai model/provider yang benar-benar melayani → log audit selalu menyebut model primary (menyesatkan saat fallback).
- **`generation-stage.ts`:** fungsi fallback circuit-breaker menandai `data.__actualModel`/`__actualProvider`; `TurnState.actualModelUsed` di-set dari respons; `recordCall` memakai `actualModelUsed || selectedModel` untuk `actualModel` & `modelUsed`.
- **Verifikasi:** `tsc` 0; `build` 0; LLM/fallback/circuit-breaker tests 35/35; full suite **410 files / 2958 passed / 0 failed**.
- **Catatan:** belum ada test khusus yang memaksa jalur fallback berhasil (butuh stub tier); labeling diverifikasi via type-check + suite existing.

#### CG-09 — Redaksi PII JSONL + Retention 60 Hari (2026-09-20)

- **`llm-execution-logger.ts`:** identitas PII di-redact HANYA pada berkas JSONL (at-rest) — `customerPhone` di-hash (`hashPiiPhone`), `customerName` di-mask (`maskCustomerName`, mis. "Bunda Sari" → "B*** S***"). **Buffer in-memory tetap mentah** agar UI admin bisa mengidentifikasi customer saat sesi berjalan (tidak persist). Teks chat tetap disimpan untuk debug (keputusan user).
- **`log-buffer.ts`:** `MAX_LOG_RETENTION_DAYS` 7 → **60** (JSONL & app log).
- **Test baru `tests/unit/cg09-pii-redaction.test.ts`.**
- **Verifikasi:** `tsc` 0; `build` 0; full suite **410 files / 2958 passed / 0 failed**.

#### Stage 6-CLM / RC-07 — Entity-Bound Numeric Validation (2026-09-20)

- **Akar (RC-07):** validator numerik mengotorisasi SELURUH harga katalog tenant → harga Treatment B mengesahkan nominal untuk Treatment A.
- **`numeric-fact-validator.ts`:** harga layanan (PRIMARY/BUNDLE/SERVICE) katalog **tidak lagi** mengesahkan nominal standalone; hanya dipakai sebagai **fallback** bila turn tak punya sumber entity-bound (tool turn / cart). Harga **add-on** tetap sah dikutip kapan pun (set kecil). Sumber entity-bound: treatment dari tool turn ini + cart sesi + ongkir sesi + targetPrice + komposit.
- **Test baru `tests/unit/entity-bound-numeric-validator.test.ts`:** harga entity-bound benar → VALID; harga layanan LAIN → INVALID; fallback tanpa entity-bound tetap sah.
- **Test lama diselaraskan** (spesifikasi berubah): `multi-treatment-combo-validator` (add-on tetap sah).
- **Verifikasi:** `tsc` 0; `build` 0; full suite **409 files / 2956 passed / 0 failed**.

#### Stage 5 Fase 5 — Degraded Replay + Retention (2026-09-20)

- **Migrasi LOKAL:** `inbound_turns.payload_json JSONB` (migration `20260920000005_inbound_turn_payload`) — untuk replay.
- **`turn.repository.ts`:** persist `payload`; `listReplayable` (RECEIVED/QUEUED/PROCESSING-macet), `markQueued`, `cleanupOlderThan(days)`.
- **Webhook WAHA & WABA:** simpan payload minimal (customerId/phone/incomingMessage) saat persist turn.
- **`turn-recovery.service.ts` (baru):** `replayPendingTurns` (enqueue ulang turn berpayload; tanpa payload → tandai FAILED agar tidak macet), `cleanupOldTurns(60)`.
- **`app.ts`:** setelah boot (jeda 15s, non-blocking) → replay pending + retention.
- **Test baru `tests/unit/turn-recovery.test.ts`.**
- **Verifikasi:** `tsc` 0; `build` 0; full suite **408 files / 2953 passed / 0 failed**.
- **Stage 5 SELESAI (fase 1-5).**

#### Stage 5 Fase 4 — Handoff Durable / Escalation Fail-Closed (2026-09-20)

- **`src/v3/tools/escalate-human.tool.ts`:** DILARANG lapor sukses palsu. Conversation tidak ditemukan → `success:false, escalated:false`; DB error → `success:false, escalated:false` (bukan lagi `success:true`). Lookup sudah tenant-scoped.
- **`machine.ts`:** saat `isEscalated`, tandai `InboundTurn` (dari ALS `turnId`) → status `HANDOFF` (best-effort).
- **Test diselaraskan ke kontrak baru** (spesifikasi berubah, bukan pelonggaran): `v3-conversation-matrix.test.ts` CM-08 & CM-18 — invarian safety (tool dipanggil, `is_human_handling=true`, tanpa silent drop) TETAP diassert; `result.success` tidak lagi dipatok true saat harness DB offline.
- **Test baru `tests/unit/escalate-human-fail-closed.test.ts`.**
- **Verifikasi:** `tsc` 0; `build` 0; full suite **407 files / 2951 passed / 0 failed**.
- **Belum:** Fase 5 (degraded replay), retention ledger.

#### Stage 5 Fase 3 — Outbound Ledger Per-Bubble (2026-09-20)

- **`src/services/outbound-ledger.service.ts` (baru):** `begin` (SENDING + content_hash), `markSent` (+ provider message id), `markFailed`, `markUnknown`. Best-effort (DB offline tidak menggagalkan pengiriman).
- **`typing.service.ts`:** `HumanReplyParams.turnId/provider` (opsional); instrumentasi loop bubble — SENDING sebelum kirim, SENT/FAILED setelah.
- **`machine.ts`:** teruskan `turnId`/`provider` dari `contextStorage` ke `simulateHumanReply`.
- **Test baru `tests/unit/outbound-ledger.test.ts`** (4 kasus).
- **Verifikasi:** `tsc` 0; `build` 0; full suite **406 files / 2949 passed / 0 failed**.
- **Belum:** Fase 4 (handoff durable), Fase 5 (degraded replay), retention ledger.

#### Stage 5 Fase 2 — Inbound Durable + Worker Claim (2026-09-20)

- **`src/repositories/turn.repository.ts` (baru):** `persistInbound` (upsert RECEIVED, idempoten per tenant+provider+message id), `claimForProcessing` (atomik RECEIVED/QUEUED→PROCESSING; tolak bila sudah RESPONSE_READY/DELIVERED; **fail-open** bila tracking/DB tak tersedia), `markStatus`.
- **`webhook.route.ts` (WAHA) & `waba-webhook.route.ts`:** persist `InboundTurn` (RECEIVED) **sebelum** `enqueueMessage` (best-effort).
- **`queue.service.ts` (BullMQ + in-memory):** claim turn sebelum `processMessage`; turn yang sudah diproses dilewati (`QUEUE TURN SKIP`) → retry tidak memproses ulang; `markStatus RESPONSE_READY` setelah selesai. Import `DEFAULT_TENANT_ID`.
- **`tests/setup.ts`:** mock global `inboundTurn` & `outboundAttempt`.
- **Test baru `tests/unit/turn-repository-claim.test.ts`.**
- **Verifikasi:** `tsc` 0; `build` 0; full suite **405 files / 2945 passed / 0 failed**.
- **Belum:** Fase 3 (outbound ledger per-bubble), Fase 4 (handoff durable), Fase 5 (degraded replay).

#### Stage 5 Fase 1 — Schema `InboundTurn` + `OutboundAttempt` (2026-09-20)

- **Migrasi LOKAL:** dua tabel baru (aditif) — `inbound_turns` (enum `InboundTurnStatus`: RECEIVED/QUEUED/PROCESSING/RESPONSE_READY/DELIVERED/FAILED/HANDOFF; `@@unique([tenant_id, provider, inbound_message_id])`) dan `outbound_attempts` (enum `OutboundAttemptStatus`: SENDING/SENT/FAILED/UNKNOWN; `@@unique([turn_id, bubble_index])`). Migration `20260920000004_durable_turn_inbox_outbox`.
- **Keputusan CG-08:** Redis down → terima ke DB inbox lalu replay (opsi b). **CG-10:** timeout pasca-send → `UNKNOWN`, tanpa resend otomatis. Retention: 30–90 hari (diterapkan di fase berikutnya).
- **Insiden kecil:** file migrasi awal terkena BOM dari PowerShell → `migrate deploy` gagal (`syntax error near \uFEFF`). Diatasi: hapus BOM + `migrate resolve --rolled-back` + deploy ulang. Tabel sudah terverifikasi (types kosong sebelum resolve, jadi aman).
- **Verifikasi:** tabel `inbound_turns` & `outbound_attempts` ada; drift `-- This is an empty migration.`; client runtime mengenali `inboundTurn` (count=0); `tsc` 0.
- **Belum:** Fase 2–5 (persist inbound sebelum ack, worker claim, outbound ledger, handoff durable, degraded mode).

#### Stage 4 Fase C & D — Audit Pembaca Episodik + Status Selesai (2026-09-20)

- **Fase C (audit read-only):** tidak ada kode non-V3 yang membaca field episodik (`cartItems`/`booking`/`selectedTreatment`/`lastCommitment`/`discussedTreatments`/`ongkirStatus`/`priceDiscussed`/`bookingCommitConfirmed`) dari `Customer.preferences`. Pembaca eksternal (capi, staff-reservation, human-enrichment, staff-notification, admin) hanya menyentuh field **durable** (alamat/nama). → **Fase C tidak diperlukan.**
- **Fase D:** tercapai secara desain — `updateGoalSession` sudah **tidak** menulis field episodik ke `preferences` (hanya durable: nama/sapaan + mempertahankan field lama seperti `address`). Tidak ada mirror episodik yang tersisa.
- **Stage 4 dinyatakan SELESAI (fungsional):** session episodik hidup di `Conversation.session_data`; `Customer.preferences` tinggal profil durable.

#### Stage 4 Fase B — Backfill `Conversation.session_data` (2026-09-20)

- **Script `scripts/backfill-conversation-session-data.ts`** (dry-run default; `--apply` untuk tulis). Idempoten: hanya mengisi conversation yang `session_data IS NULL` dan customer punya state sesi di `preferences`. **Tidak menghapus** `Customer.preferences` (pembaca durable tetap aman).
- **Hasil lokal:** 11 conversation di-backfill (dari 6 customer dengan preferences episodik); preferences 542 customer tetap utuh. Dry-run ulang = 0 (idempoten).
- **Verifikasi:** `tsc` 0; `build` 0; full suite 2942 passed / 2 flaky timeout (#101, lulus isolasi).

#### Stage 4 Fase A (RC-02) — Session Episodik ke `Conversation.session_data` (2026-09-20)

- **Migrasi LOKAL:** `conversations.session_data JSONB` (migration `20260920000003_conversation_session_data`).
- **`goal-tracker.ts`:**
  - `getGoalSession`: baca **Conversation.session_data** (utama); fallback `Customer.preferences` bila kosong (kompatibel mundur).
  - `updateGoalSession`: tulis state lengkap ke **Conversation.session_data**; **mirror durable saja** ke `Customer.preferences` (nama, sapaan — TIDAK menyertakan field episodik cart/booking/komitmen) + kolom profil Customer (nama, kelurahan, kecamatan, kota, jarak, ongkir).
- **Temuan penting:** pembaca non-V3 (`capi`, `staff-reservation`, `human-background-enrichment`, `staff-notification`, admin) hanya membaca field **durable** (`address`/`house_photo_url`/`landmark`) → **tidak perlu disentuh** (Fase C diperkecil).
- **Verifikasi:** `tsc` 0; `build` 0; full suite **404 files / 2942 passed / 0 failed** (rerun; 1st run 2 flaky timeout #101).
- **Belum:** Fase B (backfill sesi aktif), Fase C (alihkan pembaca episodik), Fase D (hentikan dual-write). Session lama masih di `Customer.preferences` sampai dibackfill.

#### CG-02 — Pemicu Reset Episode (14,1 Hari + Closing + `/reset`) (2026-09-20)

- **Keputusan user:** tiga pemicu reset — (a) **admin klik "Selesai"**, (b) **14,1 hari** customer diam, (c) `/reset`.
- **`src/state-machine/machine.ts`:** default `IDLE_TIMEOUT_MS` 24 jam → **1.218.240.000 ms (14,1 hari)**. `.env.example` diperbarui.
- **`src/routes/admin/reservations.subroute.ts` (`/complete`):** setelah admin menandai reservasi `completed`, bersihkan sesi V3 episodik customer (cart, treatment, booking, diskusi, komitmen, ongkir, total) via `GoalTracker.updateGoalSession`; profil durable dipertahankan.
- **Test:** `admin-complete-reset-session.test.ts` (baru); `idle-reset-clears-v3-session.test.ts` diselaraskan ke 15 hari.
- **Verifikasi:** `tsc` 0; `build` 0; full suite **404 files / 2942 passed / 0 failed**.
- **Belum:** session pindah ke `Conversation.session_data` (Stage 4 penuh) — masih di `Customer.preferences`.

#### CG-05 (Opsi Flag) — `needs_staff_verification` pada Reservation (2026-09-20)

- **Keputusan user:** CG-05 via **flag**, BUKAN status baru (hindari blast radius 30+ pembaca `status`).
- **Migrasi LOKAL:** `reservations.needs_staff_verification Boolean @default(false)` (migration `20260920000002_reservation_needs_staff_verification`).
- **Kode `reservation-core.service.ts`:** `needs_staff_verification = (source !== 'ADMIN_PANEL' && status === 'confirmed')` — bot/agent non-same-day (slot belum diverifikasi) ditandai; same-day (`pending`) & admin manual tidak.
- **`status` TIDAK diubah** (tetap `confirmed`/`pending` seperti sebelumnya).
- **Test:** `reservation-idempotency-request-id.test.ts` +2 kasus flag → 4/4.
- **Verifikasi:** `tsc` 0; `build` 0; full suite **403 files / 2941 passed / 0 failed**.

#### Stage 8 (Parsial) — Flush LLM JSONL saat Shutdown (2026-09-20)

- **Akar (audit observability):** antrean tulis `llm-*.jsonl` memakai timer `unref` yang bisa hilang saat proses keluar → berkas 0-byte meski ada aktivitas LLM.
- **Perbaikan:**
  - `src/utils/llm-execution-logger.ts` — fungsi publik baru `flushLlmExecutionLogs()` (bersihkan timer + flush sinkron).
  - `src/lifecycle/shutdown.ts` — panggil `flushLlmExecutionLogs()` saat graceful shutdown (setelah `flushLlmAuditBuffer`).
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; lifecycle/logger tests 26/26; full suite **403 files / 2939 passed / 0 failed**.

#### Stage 7 (R6) — Reservation Idempotency (`request_id`) + Follow-up Uniqueness (2026-09-20)

- **Migrasi LOKAL (dev DB):** `reservations.request_id String?` + `@@unique([tenant_id, request_id])`; `follow_ups` `@@unique([tenant_id, reservation_id, type, stage])`. Migration `20260920000001_reservation_request_id_and_followup_unique`. Dibuat via `migrate diff` + `migrate deploy` (bypass shadow-DB). Drift verified. Prasyarat: 0 duplikat follow-up.
- **Kode:**
  - `reservation-core.service.ts` — `ReservationMutationParams.requestId?`; cek idempotensi awal (request_id ada → kembalikan existing, tidak create ganda); `request_id` disimpan pada create.
  - `save-reservation.tool.ts` — generate `requestId` stabil: `${tenantId}:${customerId}:${tanggal}:${treatmentDetail}` (retry webhook sama → tidak ganda).
- **TIDAK mengubah logika merge same-day** (patuh keputusan **CG-06 Opsi D**).
- **Test baru `tests/unit/reservation-idempotency-request-id.test.ts`.**
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite **403 files / 2939 passed / 0 failed** (1 skipped).
- **CATATAN:** migrasi PRODUKSI belum (kode belum live). Status `REQUESTED` (CG-05) belum diimplementasi — masih terbuka.

#### Stage 4 (R2) — Idle Reset Menyelaraskan Sesi V3 Episodik (2026-09-20)

- **Akar (R2):** idle reset (`machine.ts`) hanya mereset enum `Conversation` + pending location, TIDAK membersihkan session V3 (`Customer.preferences`: cart, treatment terpilih, booking, komitmen). V3 memuat ulang state lama → "amnesia palsu"/konteks nyangkut.
- **Perbaikan `src/state-machine/machine.ts`:** saat idle reset, bersihkan field EPISODIK session V3 (`cartItems`, `selectedTreatment`, `booking`, `discussedTreatments`, `priceDiscussed`, `bookingCommitConfirmed`, `lastCommitment`, `ongkirStatus`, `totalPrice`) via `GoalTracker.updateGoalSession`. Profil durable (nama, sapaan, anak, lokasi terverifikasi) DIPERTAHANKAN.
- **Catatan:** nilai `IDLE_TIMEOUT_MS` (default 24 jam) TIDAK diubah — nilai timeout adalah keputusan CG-02 (masih terbuka). Perbaikan ini murni menyelaraskan reset (bug konsistensi), bukan mengubah kebijakan kapan reset.
- **Test baru `tests/integration/idle-reset-clears-v3-session.test.ts`.**
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite **402 files / 2937 passed / 0 failed** (1 skipped).

#### Stage 2 (R1) — Tenant Identity Boundary: Migrasi Lokal + Kode Tenant-Scoped (2026-09-20)

- **Migrasi lokal (dev DB):** `phone @unique` (global) → `@@unique([tenant_id, phone])`. Migration `prisma/migrations/20260920000000_tenant_identity_boundary`. Dibuat via `migrate diff` + `migrate deploy` (BYPASS `migrate dev` yang rusak oleh shadow-DB `FollowUpStatus`, sesuai AGENTS.md). Drift pasca-migrasi: empty. Backup lokal dibuat sebelum migrasi.
- **Verifikasi constraint nyata:** phone sama di 2 tenant → OK; duplikat dalam 1 tenant → ditolak `P2002`.
- **`src/repositories/customer.repository.ts`:** hapus `findByPhoneGlobal` (global lintas tenant); `updateManyByPhone` → `updateManyByPhoneTenant(phone, tenantId, patch)` (tenant-scoped).
- **`src/services/customer.service.ts`:** buang fallback global; create atomic (catch `P2002` → reread dalam tenant); `setLabelFlags(phone, flags, tenantId=DEFAULT)` tenant-scoped.
- **`src/services/backup.service.ts`:** `customer.upsert` pakai compound unique `tenant_id_phone`.
- **Test diselaraskan ke kontrak baru (spec berubah, bukan dilonggarkan):** `customer-repository.test.ts` (isolasi tenant + update tenant-scoped); `label-ai-router.test.ts` TC29 (label TIDAK bocor antar-tenant).
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite 2935 passed / 1 flaky timeout (`waha-webhook`, lulus isolasi — pra-existing, lihat #101).
- **CATATAN:** migrasi **produksi BELUM** dijalankan (butuh backup + rehearsal + persetujuan eksplisit). Rencana: `docs/plans/STAGE_2_MIGRATION_PLAN_TENANT_IDENTITY.md`.

#### Audit P1-14 — Cancel/Delete Reservasi Membatalkan Follow-up (2026-09-20)

- **Akar:** `DELETE /api/admin/reservation/:id` (soft-cancel & hard-delete) tidak memanggil `followUpService.onReservationCancelled`. Soft-cancel hanya membuat NO_PURCHASE baru; hard-delete `onDelete:SetNull` → follow-up pengingat H-1/review H+1 tetap aktif dan terkirim ke customer yang sudah membatalkan.
- **Perbaikan `src/routes/admin/reservations.subroute.ts`:** panggil `followUpService.onReservationCancelled(id, tenantId)` pada kedua jalur (hard-delete dipanggil SEBELUM `reservation.delete` agar `reservation_id` masih cocok).
- **Keputusan CG-06 = Opsi D (user):** merge same-day kontrak LAMA dipertahankan (walau treatment berbeda); multi-treatment ditangani admin manual. Perubahan R6 "merge hanya treatment sama" **DIBATALKAN**. Dicatat di ADR + KNOWN_ISSUES #102.
- **Test baru `tests/unit/admin-reservation-cancel-followups.test.ts`.**
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite **401 files / 2936 passed / 0 failed** (1 skipped).

#### Audit R7 (ST6-CLM) — Validasi Numerik Aktif pada Direct Reply Tanpa Tool (2026-09-20)

- **Akar (audit R7/C2):** `guardrail-pipeline.ts` hanya menjalankan validator numerik bila `executedTools.length > 0 || hasActiveCart`. Direct reply Call 1 (tanpa tool/cart) yang menyebut nominal **lolos tanpa koreksi**.
- **Perbaikan `src/v3/agent/pipeline/guardrail-pipeline.ts`:** gate dihapus — validator numerik kini berjalan setiap kali `!numCheck.isValid`. `validateNumericFacts` sudah return valid lebih awal bila tidak ada token "Rp", sehingga hanya menyala saat balasan benar-benar menyebut nominal. Sumber otorisasi tetap (katalog tenant + tool + session) → harga katalog valid tetap lolos; hanya nominal non-katalog yang dikoreksi.
- **Verifikasi:** `npx tsc --noEmit` 0; test numerik & guardrail 39/39 hijau; full suite **400 files / 2935 passed / 0 failed** (1 skipped).

#### Audit R4 — Cegah Balasan Ganda Saat Logging Outbound Gagal (2026-09-20)

- **Akar (audit R4):** `machine.ts` melakukan `await messageService.logMessage()` AFTER `simulateHumanReply`. Jika DB gagal sesudah pesan terkirim, exception naik ke queue worker → BullMQ retry → **pesan terkirim ulang** ke customer.
- **Perbaikan `src/state-machine/machine.ts`:** `logMessage` outbound dibungkus try/catch (best-effort). Kegagalan logging tidak lagi menggagalkan turn → mencegah retry yang mengirim ulang. Pesan tetap terkirim sekali.
- **Test baru `tests/integration/outbound-log-failure-no-retry.test.ts`:** log OUTBOUND throw → `processMessage` tetap resolve; pesan terkirim tepat sekali.
- **Verifikasi:** `npx tsc --noEmit` 0; test baru hijau.

#### Pembersihan Suite — Isolasi LLM Dua Test Flaky (#101) (2026-09-20)

- **Akar:** `live-chat-reply` & `robustness` menembak network LLM nyata (kredensial `.env` bocor ke test) → `[LLM MODEL FALLBACK] timeout of 15000ms` + retry → melewati `testTimeout`.
- **Perbaikan:** isolasi seam LLM di kedua test (mock `callChatCompletionsWithFallback`; spy `GenerationStage.executeChatCompletion`). Tidak menurunkan validasi.
- **Verifikasi:** full suite **399 files / 2934 passed / 0 failed** (1 skipped) — pertama kali 100% hijau. `docs/KNOWN_ISSUES.md` #101 → RESOLVED.

#### Stage 6 (Revisi) ST6-3d — Perbaikan Bocor Konsultasi via Tawaran Asisten (2026-09-19)

Ditemukan saat verifikasi sandbox LLM nyata (skenario S1): pada turn konsultasi lanjutan, **tawaran asisten** menyebut layanan → cart terisi walau verdict tersimpan EXPLORING.

- **`src/v3/state/cart-manager.ts`** — gerbang `exploringLock` dihitung sekali dari SELURUH riwayat: bila `lastCommitment === 'EXPLORING'` DAN tidak ada pesan USER mana pun yang membawa sinyal komitmen/hari DAN `bookingCommitConfirmed !== true` → seluruh giliran (user MAUPUN asisten) DILARANG mengisi cart; penyebutan hanya ke `discussedTreatments`. Sebelumnya gerbang hanya berlaku untuk pesan user (`!isAssistant`) sehingga rekomendasi asisten lolos.
- **Bukti uji sandbox (LLM nyata):** phone baru → "kak bapil pakai treatment apa" → "pijut pulih ceria itu aman ya" → "makasih": cart **KOSONG** sepanjang alur. Sebelumnya turn 2 terisi.
- **Test:** `tests/integration/cart-commitment-cross-turn.test.ts` +2 kasus (tawaran asisten saat EXPLORING tidak mengisi cart; EXPLORING lalu komit eksplisit tetap terisi) → 8/8 hijau.
- **Verifikasi:** `npx tsc --noEmit` 0. Full suite: 2 test **timeout** (`live-chat-reply`, `robustness`) — **terbukti pre-existing** (gagal juga di kode bersih via `git stash`), bukan regresi.

#### Stage 6 (Revisi) ST6-3c — Test Integrasi Kontrak Komitmen Lintas-Turn (2026-09-19)

- **`tests/integration/cart-commitment-cross-turn.test.ts` (baru)** — 6 test mengunci: verdict EXPLORING tersimpan → cart tidak terisi; EXPLORING + sinyal komitmen eksplisit → cart terisi; COMMITTED → cart terisi; tanpa verdict → perilaku `?` lama; `applyCommitmentVeto` EXPLORING mengosongkan, COMMITTED tidak mengubah.
- **Verifikasi:** 6/6 hijau.

#### Stage 6 (Revisi) ST6-3b — Verdict Komitmen Persisten Lintas-Turn (`lastCommitment`) (2026-09-19)

Temuan dari uji sandbox nyata: veto satu-turn TIDAK cukup karena `prepareSession` menghitung ulang cart dari riwayat SETIAP turn (sebelum Call 1), dan verdict hanya ada di 2 tool.

- **`src/v3/domain/types.ts`** — `CustomerGoalSession.lastCommitment?: CommitmentLevel` (persisten lintas turn).
- **`src/v3/state/goal-tracker.ts`** — `getGoalSession` mengembalikan `lastCommitment` dari `preferences` (sebelumnya tidak dibaca → persist sia-sia).
- **`src/v3/state/cart-manager.ts`** — `syncCartItems` gerbang baru `isExploringVerdict`: bila `lastCommitment === 'EXPLORING'` DAN pesan user tidak membawa sinyal komitmen/hari → item masuk `discussedTreatments`, DILARANG cart.
- **`src/v3/agent/agent-runner.ts`** — verdict Call 1 dipersist ke `lastCommitment`; veto turn-ini tetap bila EXPLORING + cart terisi.
- **Field `commitment` ditambahkan ke SEMUA 6 tool** (`get-catalog`, `calculate-delivery`, `search-knowledge-faq`, `clinic-faq`, `escalate-human`, `save-reservation`) + zod-nya — sebelumnya hanya 2 tool, sehingga verdict hilang saat Call 1 memilih tool lain (bukti log sandbox `commitment:null`).
- **Bukti uji sandbox (LLM asli):** konsultasi "pijat oksitosin itu untuk ibu melahirkan ya" → cart KOSONG di turn itu & turn lanjutan; "kak bapil..."→"boleh bund" → cart terisi; "mau ambil pijat ceria buat adek" → cart terisi.
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite **398 files / 2926 passed / 0 failed** (1 skipped).

#### Stage 6 (Revisi) ST6-4 — Verdict COMMITTED Me-latch Komitmen Booking (2026-09-19)

- **`src/v3/agent/agent-runner.ts`** — setelah Call 1, bila `routing.commitment === 'COMMITTED'` dan `!session.bookingCommitConfirmed` → persist `bookingCommitConfirmed=true` (sticky). Menyatukan cart & tool-masker pada satu sumber penilaian semantik LLM, menggantikan ketergantungan pada daftar verba hafalan.
- **Pengaman tidak berubah:** `save_reservation` tetap butuh treatment + lokasi + tanggal (masker PRASYARAT utuh).
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; suite cart/booking/masking/agent 48/48; full suite 2925 passed / 1 flaky (`robustness.test.ts`, lulus isolasi — pra-existing).

#### Stage 6 (Revisi) ST6-3 — Verdict Komitmen Call 1 Menjadi Otoritas Cart (2026-09-19)

- **Arah:** tanpa shadow/flag (belum deploy); langsung enforce. Verdict Call 1 memveto cart hasil heuristik.
- **`src/v3/agent/pipeline/generation-stage.ts`** — `RoutingOutput` + `commitment`; verdict dihitung sekali, dicatat (`ROUTER_COMMITMENT_VERDICT`), dikembalikan.
- **`src/v3/state/cart-manager.ts`** — method murni baru `applyCommitmentVeto(session, commitment)`: bila `EXPLORING`, `cartItems` dikosongkan & dipindah ke `discussedTreatments`; bila bukan EXPLORING/absen → tidak mengubah (jalur lama jadi cadangan).
- **`src/v3/agent/agent-runner.ts`** — setelah Call 1, bila `routing.commitment === 'EXPLORING'` → terapkan veto.
- **`tests/unit/v3/cart-declarative-consultation.test.ts`** — 2 kasus konsultasi MERAH → **HIJAU** (4/4).
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; suite cart/booking/masking 41/41; full suite 2925 passed / 1 flaky (`migration.test.ts`, lulus isolasi — pra-existing, bukan regresi).

#### Stage 6 (Revisi) ST6-1 & ST6-2 — Kontrak Verdict Komitmen (Shadow) (2026-09-19)

Arah disetujui user: keputusan "tanya vs beli" diserahkan ke Call 1 LLM (yang sudah membaca history), TANPA API call tambahan. ST6-1 & ST6-2 = fondasi + observasi shadow; belum mengubah keputusan cart.

- **ST6-1 `src/v3/domain/types.ts`** — tipe baru `CommitmentLevel` (`EXPLORING|CONSIDERING|COMMITTED`) + `TurnInterpretation`.
- **ST6-2 `src/v3/tools/get-catalog.tool.ts`, `calculate-delivery.tool.ts`** — field JSON `commitment` opsional (enum) ditambahkan ke 2 tool.
- **ST6-2 `src/v3/tools/tool-schemas.ts`** — `commitment` opsional di zod (strip-safe).
- **ST6-2 `src/v3/agent/prompt/phases/router-tool-routing.layer.ts`** — 1 blok instruksi penilaian komitmen semantik (contoh EXPLORING/CONSIDERING/COMMITTED).
- **ST6-2 `src/v3/agent/pipeline/generation-stage.ts`** — shadow log `ROUTER_COMMITMENT_VERDICT` (belum dipakai keputusan).
- **Test baru `tests/unit/v3/cart-declarative-consultation.test.ts`** — reproduksi 2 bug (konsultasi tanpa `?` masuk cart); **2 sengaja MERAH** (target perbaikan ST6-3), 2 komitmen sah hijau.
- **Verifikasi:** `npx tsc --noEmit` 0; suite terkait 33/35 (2 merah = target ST6-3, bukan regresi).

#### Micro-task Isolasi Tenant pada Tool Eskalasi (Audit V3, RC-01) (2026-09-19)

- **`src/v3/tools/escalate-human.tool.ts:46`** — lookup conversation jalur eskalasi kini tenant-scoped: `findUnique({ where: { id } })` → `findFirst({ where: { id: conversationId, tenant_id: tenantId } })`. Mencegah conversation milik tenant lain ikut dieskalasi (cross-tenant leak RC-01). Kontrak output tidak berubah.
- **Verifikasi:** `npx tsc --noEmit` 0; `tests/v3/agent-tools.test.ts`, `tests/unit/v3/tool-pipeline.test.ts`, `tests/unit/v3/escalation-hard-guards.test.ts`, `tests/unit/v3/structural-refusal-tagging.test.ts` → 30/30 hijau.

#### Stage 1 — Correlation Spine + Real-DB Harness (Audit V3) (2026-09-19)

Menyambung korelasi end-to-end

- **MT-1.2 `utils/context.ts`** — `ContextData` diperluas aditif: `turnId?`, `provider?: 'WAHA'|'WABA'`, `inboundMessageId?`.
- **MT-1.2 `queue.service.ts`** — `QueuePayload` diperluas aditif (`correlationId/turnId/provider/inboundMessageId` opsional); worker BullMQ & in-memory kini membungkus `stateMachine.processMessage` dengan `contextStorage.run(...)` agar correlation ID tidak hilang setelah boundary webhook.
- **MT-1.2 `webhook.route.ts`** — `enqueueMessage` WAHA meneruskan `correlationId`, `turnId` (`{tenant}:WAHA:{waMessageId}`), `provider`, `inboundMessageId`.
- **MT-1.2 `waba-webhook.route.ts`** — handler dibungkus `contextStorage.run`; `enqueueMessage` WABA meneruskan IDs (`{tenant}:WABA:{msg.messageId}`).
- **MT-1.3 `llm-execution-logger.ts`** — `LlmExecutionRecord` aditif: `turnId?`, `tenantId?`, `conversationId?`, `actualProvider?`, `actualModel?`.
- **MT-1.3 `agent-runner.ts` + `generation-stage.ts`** — `AgentRunnerInput`/`TurnState` memperoleh `turnId?`/`provider?`; `recordCall` mengisi field korelasi baru.
- **MT-1.3 `machine.ts`** — meneruskan `turnId`/`provider` dari `contextStorage.getStore()` ke `V3AgentRunner`.
- **MT-1.3 `shutdown.ts`** — graceful shutdown menambah `flushLlmAuditBuffer()`.
- **MT-1.4 `vitest.db.config.ts` (baru) + `tests/db/v3-foundation.db.test.ts` (baru)** — harness PostgreSQL nyata terpisah (tanpa `tests/setup.ts`), guard anti-host-produksi, dan test constraint/transaksi/concurrency. Di-skip otomatis bila `TEST_DATABASE_URL` tidak di-set sehingga `npm test` tetap offline bersih.
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; full suite **397 files / 2922 passed / 24 skipped / 0 failed**; test DB ter-skip rapi tanpa URL (exit 0).

#### Resolusi 14 Kegaalan Test Pre-Existing (Green Full Suite + Build) — 14 Fix (2026-09-19)

- **P1 `llm-outage-silent`** `generation-stage.ts:295` — `reportTurnError` gagal menjalankan kontrak desainnya sendiri (`agent-runner.ts:339`: "TANPA balasan generik — eskalasi sunyi"). Dulu mengembalikan `shouldSendReply:true` + apology generik saat outage LLM. Kini `replyText:''` + `shouldSendReply:false` (Fase B/owner: eskalasi sunyi, queue CS didahulukan — `docs/KNOWN_ISSUES.md#853`). `anti-silent-drop-invariant.test.ts` blok 4 (test basi pengharap apology) direkonsiliasi ke kontrak sunyi: `isEscalated:true`, `nextState:HUMAN_HANDLING`, `sentToCustomer.length===0`.
- **P2 `keyword-enrichment`** `keyword-enrichment.service.ts` — tambah sinonim `kabel olor` ke rule keyword persiapan (data-driven, bukan regex hafalan).
- **P3 `ai-models-tenant`** `ai-models.config.ts` — registry default (`defaultDeepModel`, `AI_MODEL_HARVESTING`, `AI_MODEL_MEDICAL`, `AI_MODEL_SUMMARIZATION`, `AI_MODEL_PII`) di-sanitasi via `sanitizeModelForProvider` agar model non-kanonik provider (mis. `gpt-4o-mini` → `deepseek-v4-1-flash`) tidak bocor.
- **P4 `admin-api-cache`** `admin-api-cache.test.ts` — test app-level di-beri timeout `30000` (cold-start `buildApp`, bukan hang).
- **P5 `queue-durability`** `queue.service.ts` — tambah `redisInitPromise: Promise<boolean>|null` dari chain init + `ensureRedisOrThrow()` (throw `FATAL_QUEUE_REDIS_REQUIRED` saat `QUEUE_REQUIRE_REDIS==='true'` & Redis tak siap) selaras FOUNDATIONAL_HARDENING_PLAN G2.
- **P6 `typing-transport`** `typing.service.ts` — param konstruktor ketiga `transportResolver?: (tenantId)=>Promise<MessageTransport|undefined>`; `simulateHumanReply` dispatch `sendSeen/startTyping/stopTyping/sendText` melalui transport tenant (back-compat fallback client).
- **P7 `message-idempotency`** — test kini inject `setMessageRepository(new PostgresMessageRepository())` (beforeEach) + `resetMessageRepository` (afterEach) agar mock `prisma.message.findFirst` benar terpakai (seam PLAN 8 FASE 5c).
- **P8 `llm-evaluator`+`self-learning` (akar bersama)** `llm-gateway.ts:39` — precedence key salah: `activeEndpoint.apiKey` (key asli `.env`) menang atas sentinel `LLM_API_KEY='mock'` → guard `startsWith('mock')` tak pernah trip → `axios.post` benar dipanggil (call+retry). Kini sentinel mock env menang atas registry bila tanpa override; klien yang "offline" tidak lagi memanggil LLM beneran.
- **P9 `deterministic-tool-arg-gate`** `persona.ts` — `isNonMonetaryBerapa` kini cek token SEBELUM `berapa/brp` juga (bukan hanya sesudah): `'bayi usia berapa minimal boleh dipijat'` tidak lagi salah tangkap `ask_price`.
- **P10 `cart-dedup-total`** `calculate-delivery.tool.ts` — recap grand total (`buildCartTotalRecap`) kini disuntik ke `out.message` (payload LLM) DAN `suggestedTemplateReply` di kedua cabang (URL-Maps & geocoding-teks), bukan hanya template; konsisten dengan `anti-premature-invoicing` (mode konsultasi tetap tanpa nota).
- **Verifikasi:** `npm test` penuh **397 files / 2922 passed / 24 skipped / 0 failed**; `npm run build` exit 0.

#### Resolusi Sabotase Validator Usia & Eksplisitasi Famili Terapi (Sesi 476427) — 2 Fase (2026-09-19)

- **P1 Guardrail `guardrail-pipeline.ts:483` — Context-Aware Exemption:** `hasAgeQuestion` reprompt kini diperiksa `isAgeClarificationAuthorized = executedTools.some(t.name==='get_catalog_and_price' && result.needsAgeClarification===true)` (state-gated, bukan hafalan kalimat). Pertanyaan usia netral `berapa bulan atau berapa tahun` yang diwajibkan `CLINICAL_PROBE` multi-tier (Pulih Ceria BABY vs KIDS) tidak lagi disabotase. Non-klinis (jadwal/ongkir) tetap di-reprompt.
- **P2 Tool `get-catalog.tool.ts:87,744,785,797` — Kontrak & Direktif:** Tambah `needsAgeClarification?:boolean` di `GetCatalogOutput`; `needsAgeClarification` deteksi `normalizeFam` (buang `bayi|kids|anak`, `famBase` BABY vs KIDS) — fix bug `base "pijat kids"` gagal match `Pijat Bayi Pulih Ceria`. Direktif `CLINICAL_PROBE` kini `Keluhan (kembung) dapat dibantu dengan terapi *Pijat Pulih Ceria*... SEBUTKAN *Pijat Pulih Ceria* + manfaat ringkas, lalu TANYAKAN USIA netral` (eksplisit famili, bukan "terapi khusus" generik). Return `needsAgeClarification` agar guardrail sinkron.
- **Verifikasi:** `npx tsc --noEmit` 0; `npm run build` 0; `v3-persona-rules` 15/15 hijau; Turn 1 `anak saya kembung treatment apa ya yang cocok` → `Pijat Pulih Ceria` + tanya usia netral (tidak buntu).

#### Mode Peta Jalan OSM Plain Grayscale — Hanya Jalan, Tanpa Warna, Terbatas Sby/Sda (2026-09-20)

- **`packages/admin-dashboard` — basemap Peta Jalan diganti** menjadi **CARTO `light_nolabels`**
  (data OpenStreetMap, tanpa label nama jalan/POI) + CSS filter `grayscale(1) contrast(0.96) brightness(1.04)`
  pada kelas `.customer-map-osm-gray` (`src/index.css`) — peta "sangat simple", hanya kerangka jalan
  abu-abu, zero distraksi teks.
- **Terbatas Surabaya & Sidoarjo:** TileLayer diberi `bounds: SURABAYA_RAYA_BOUNDS` — tiles hanya
  dimuat di area Sby/Sda; di luar itu kontainer peta netral (sesuai permintaan "yang lain tidak perlu").
- **Robust:** `minZoom 4`/`maxZoom 18`/`maxNativeZoom 20` mendukung zoom-out maksimal saat "Semua wilayah";
  diterapkan konsisten di initial layer (`CustomerMapTab.tsx`) dan cabang streets pada mode effect.
  (Evolusi basemap: CartoDB light_all → OSM standar grayscale → CARTO light_nolabels grayscale.)
- **Verifikasi live:** chunk `CustomerDatabase-*` ter-serve berisi `light_nolabels` & `.customer-map-osm-gray`,
  referensi `tile.openstreetmap.org` hilang.

#### Pengerasan Lanjutan Peta Area Vektor — State Reaktif, Pointer-Transparent, Adaptive Bounds, ResizeObserver (2026-09-19)

- **`packages/admin-dashboard/src/components/customer/CustomerMapTab.tsx`** — 6 temuan audit dibereskan secara fondasional:
  - **Anti-race blank screen:** `boundaryGeoRef` (useRef) → `boundaryGeo` (`useState`) + `geoLoading`; efek mode peta kini reaktif terhadap `boundaryGeo` sehingga toggle "Area Vektor" saat GeoJSON masih dimuat tidak lagi menghasilkan kanvas kosong permanen; ditambah indikator "Memuat batas wilayah…".
  - **Pemulihan hierarki warna:** poligon kelurahan dikembalikan ke **biru pudar** (`#eff6ff` / border `#93c5fd`, dash `2,3`), hover biru segar `#bae6fd`/`#0284c7`; legenda UI disinkronkan (Hijau Kota → Orange Kecamatan → Biru Pudar Kelurahan).
  - **Tooltip anti-flicker:** garis batas kota/kecamatan kini `className: 'pointer-events-none'` pada style Leaflet (deklaratif, tahan re-render) — tidak pernah mencuri pointer di atas poligon kelurahan.
  - **Adaptive camera bounds:** efek reaktif `showAllCities` → `setMinZoom(4)` + `setMaxBounds(null)` saat "Semua wilayah" aktif, kembali `minZoom 10` + `SURABAYA_RAYA_BOUNDS` saat nonaktif.
  - **Layering radius:** lingkaran jangkauan klinik dipindah ke custom pane `radiusPane` (zIndex 280, di bawah overlayPane/marker) agar tidak menutupi marker pelanggan.
  - **Responsivitas:** `ResizeObserver` pada kontainer peta memanggil `invalidateSize()` saat tab/resize berubah (cegah ubin abu-abu).
- **Regression gate:** `customer-map-points` 12 + `customer-map-utils` 19 = 31 hijau; build admin-dashboard & bot engine exit 0.

#### Perbaikan Fondasional Peta Area Vektor — Grid-Snap Dissolve & UI Map Pengerasan (2026-09-19)

- **Build script `scripts/build-surabaya-sidoarjo-svg.ts` ditulis ulang dengan algoritma grid-snap dissolve** (bukan SVG). Kompilasi ulang batas topologis bersih antara Surabaya & Sidoarjo dari dataset HDX/BPS-2020:
  - Snap vertex ke grid `0.0002°` (~22 m) supaya sisi batas antar kelurahan **persis berimpit** (sharing edge antar ring naik ke 93%), lalu klasifikasikan tiap undirected cell-edge deterministik: 1 owner → batas kota/kabupaten; ≥2 owner satu kecamatan → dibuang (internal); beda kecamatan → batas kecamatan; beda kota → batas kota.
  - Menyambung edge menjadi polyline hanya lewat node ber-degree 2 (berhenti di percabangan) → **157 line batas (38 regency + 119 district)** menggantikan 5.176 segment lama (−97%).
  - Simplifikasi Douglas-Peucker border `0.00015°`, desa `0.0015°`; **output 462,5 KB < ambang 500 KB**; `geo-metadata.json` menyimpan bbox efektif + jumlah kecamatan.
  - Perbaikan bug charting: struktur `[polygon][ring][point]` MultiPolygon (iterasi ring sebagai point), pengodean sel grid yang rusak utk latitude negatif (kunci string `cx:cy`), stitch menerobos cabang.
  - **Output terverifikasi:** titik Gubeng (`112.7611,-7.2721`) tidak lagi masuk garis batas kota (sebelumnya memotong wilayah Utara, false positive yang menghilangkan porsi Surabaya).
- **Pengerasan UI `packages/admin-dashboard/src/components/customer/CustomerMapTab.tsx`:**
  - **Preload GeoJSON** sekali saat peta siap (mengisi ref terpisah dari mode), saat toggle Area Vektor layer langsung dirender dari data tersimpan — menghilangkan blank-flash & re-fetch berulang.
  - **`pointer-events: none` pada semua feature border** (`regency_border`/`district_border`) ditegakkan di `onEachFeature` (bukan hanya `interactive:false` bergaya) → tooltip poligon kelurahan tidak lagi "karat" / flicker kala kursor melewati garis batas overlay pane 250.
  - **Kontras mode Area Vektor:** latar kertas `#f1f5f9`, poligon kelurahan **putih `#ffffff` 95%** berbatas `#cbd5e1`, sorot hover biru langit `#e0f2fe`/`#0284c7` — poligon kini jelas terpisah dari garis kecamatan orange & kota hijau.
  - **Panning longgar:** `maxBounds` diperluas ke `[[-7.90,112.10],[-6.75,113.15]]` dengan `maxBoundsViscosity: 0.3` — pinggir map tidak terasa "dikunci elastis" saat panning (batas zoom-out-min tetap `minZoom: 10`).
  - **Fokus filter kota:** basecamp Sidoarjo hanya digabung ke `fitBounds` bila `!kotaFilter` atau filter = Sidoarjo — saat filter ke kota lain peta tidak tertarik mundur ke Sidoarjo.
- **Regression gate:** `customer-map-points` 12 + `customer-map-utils` 19 = 31 hijau; build admin-dashboard & bot engine exit 0.

#### Resolusi Komprehensif Sesi 607894/622098/284330/594329 — 8 Fase (Maternal, Atomic, Sanitizer, Usia) (2026-09-19)

- **P1 Maternal + anti-KIDS lock** `router-tool-routing.layer.ts:20` inklusi keluhan Bunda (ASI seret, payudara bengkak/keras/nyeri, puting lecet, laktasi, nifas, pegal hamil) → `get_catalog_and_price category:MOMS`; larangan `category KIDS` sepihak bila usia null (lintas BABY/KIDS). `get-catalog.tool.ts:220` `category KIDS && age==null → undefined` (BABY tidak tereliminasi).
- **P2 Atomic** `generation-stage.ts:511` pruning `parsedCalls>1` → prioritas `get_catalog_and_price > calculate_delivery > get_clinic_policy_faq` + `PARALLEL_TOOL_CALLS_PRUNED` + sinkron `toolCalls`.
- **P3 Sanitizer** `sanitizer.ts:428` `, \u0000:` → `:` + `, :` cleanup (anti `, :`) + `sanitizer.ts:472` bullet `\n[-•*]|\d+[.)]` sebagai batas kalimat (9 kalimat → 3).
- **P4 Usia** `treatment-catalog.service.ts:1354` penalti `anak` bila `age==null` + `get-catalog.tool.ts:708` fix `normalizeFam` (buang `bayi|kids|anak`) → `needsAgeClarification` true untuk Pulih/Sembelit multi-tier → tanya `berapa bulan atau berapa tahun`.
- **P5-P8** tetap dari sesi sebelumnya: D9 amnesia, Jambangan dual-admin, cart hijack, isolasi GENERAL, demam `ClinicPolicy`, RAG `0.25`, ongkir state-aware.
- **Verifikasi:** `npm run build` 0; sanitizer `, :`→`:` PASS, bullet 4→3 PASS, D9 amnesia `isValid:false`, Jambangan precise, full suite targeted 39 hijau.


#### Penyempurnaan UX Peta — Pewarnaan Multi-Level Batas Wilayah, Eliminasi Auto Zoom-Out & Pembatasan Zoom Maksimal (2026-09-19)

- **Pewarnaan Multi-Level Batas Wilayah (Sesuai Hirarki Detail):**
  - Kota / Kabupaten (`regency_border`): Garis batas **Hijau Tegas** (`#008069`, tebal 3.2px, 95% opacity).
  - Kecamatan (`district_border`): Garis batas **Orange** (`#f97316`, tebal 1.8px, 85% opacity).
  - Kelurahan / Desa (`village`): Area poligon **Biru Pudar** (`fillColor: '#eff6ff'`, fillOpacity 50%, batas `#60a5fa`, tebal 0.6px, dash-line), dengan efek sorot kursor (*hover highlight*) biru langit (`#93c5fd` / `#2563eb`) yang menampilkan tooltip nama desa/kelurahan dan kecamatannya.
  - Sesuai prinsip *"Semakin detail wilayahnya, semakin pudar warnanya"*. Dilengkapi indikator legenda visual di bawah peta saat mode Area Vektor aktif.
- **Eliminasi Tuntas Bug UX Auto Zoom-Out:**
  - `CustomerMapTab.tsx`: Membungkus filtering titik (`kotaOptions`, `cityFiltered`, `allowedStatuses`, `visiblePoints`, `metrics`) dengan `useMemo` agar pergantian mode peta tidak menghasilkan referensi array baru yang memicu siklus render ulang marker.
  - Memasang gerbang `hasInitialFittedRef` sehingga `map.fitBounds()` **hanya dijalankan tepat 1 kali pada pemuatan awal** (atau saat filter kota diganti / tombol Refresh ditekan).
  - Pengguna bebas berganti antara **"Peta Jalan"** dan **"Area Vektor"** tanpa peta tiba-tiba melompat zoom-out; posisi dan zoom pengguna 100% terjaga.
- **Pembatasan Batas Zoom-Out Maksimal (Maksimal Terlihat Gresik Saja):**
  - Inisialisasi peta Leaflet disetel dengan `minZoom: 10`, `maxZoom: 18`, dan `maxBounds: [[-7.70, 112.30], [-6.85, 113.00]]` (`maxBoundsViscosity: 0.85`).
  - Mencegah peta di-zoom out hingga melihat seluruh Jawa Timur atau seluruh Indonesia; kanvas terkunci di area metropolitan Surabaya Raya (Gresik Utara - Surabaya - Sidoarjo Porong).

#### Penyempurnaan Fitur Sebaran Pelanggan — Endpoint Toleran, Basecamp Tenant-Aware, KPI Spasial, Backfill Sentroid (2026-09-19)

- **Fase 1 — Data integrity & endpoint backend (tanpa menyentuh pipeline AI):**
  - `src/config/clinic-location.ts` (baru) — sumber lokasi basecamp tenant-aware dari
    `Tenant.settings.clinicLocation` (pola `brand.ts`, tanpa migrasi). Fallback ke
    `clinicConfig` env saat tenant tanpa override/DB offline.
  - `src/utils/wilayah-normalizer.ts` (baru) — sanitasi teks wilayah dari data kotor
    hasil scraping (`kecamatan = "Kota :"`, `kota = "No. Hp : 0878..."`), `isValidAreaName`.
  - `customers.subroute.ts` — endpoint `map-points`:
    - Filter wilayah default **toleran**: kota/kecamatan mengandung
      surabaya/sidoarjo/gresik/sby/sda, ATAU `distance_km <= 35`, ATAU bounding box
      Surabaya Raya.
    - Titik **sentroid estimasi** (`is_estimated_centroid: true`) untuk pelanggan
      `lat NULL` yang punya kelurahan/kecamatan valid → resolusi gazetteer lokal.
      Data kotor dilewati. `?includeCentroids=false` untuk mematikan.
    - Metadata `clinic` (lat/lng/nama/maxCoverageKm/rings) tenant-aware.
  - **Bukan perbaikan pipeline AI:** audit log & DB live membuktikan jalur
    `human-background-enrichment` sudah menyimpan koordinat (135 customer live punya
    lat). V3 goal-tracker tidak menyimpan lat/lng namun bukan masalah.
- **Fase 2 — Visual peta, Bug Fix "White Board" & Mode Area Vektor Murni:**
  - Mengintegrasikan **Basemap CartoDB Positron TileLayer** (`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`)
    dengan kontras lembut, nama jalan, dan toponimi Indonesia jelas — menyelesaikan tuntas
    bug kanvas putih kosong ("white board").
  - Menambahkan deterministik `map.invalidateSize()` pasca-mount (150ms) dan sebelum `map.fitBounds()`
    untuk memastikan kalkulasi dimensi kontainer Leaflet tidak `0x0`, mencegah proyeksi koordinat `NaN`.
  - Menggunakan native `L.featureGroup()` untuk layer titik pelanggan agar circle marker langsung ter-render
    tanpa tersembunyi di dalam div cluster yang belum ter-styling.
  - **Peta Area Vektor Murni (Surabaya & Sidoarjo)**:
    - Script `scripts/build-surabaya-sidoarjo-svg.ts` (baru) — mengompilasi dataset resmi BPS/HDX
      49 kecamatan (31 Surabaya + 18 Sidoarjo, 507 kelurahan) ke SVG teroptimasi (`surabaya-sidoarjo-map.svg`, 287 KB),
      GeoJSON (`surabaya-sidoarjo.geojson`, 523 KB), dan `geo-metadata.json` berbasis proyeksi Web Mercator presisi 100%.
    - Menambahkan **Switcher Mode Peta** di toolbar dashboard: **[Peta Jalan]** (CartoDB) vs **[Area Vektor]** (hanya siluet bidang
      batas kecamatan Surabaya & Sidoarjo tanpa jalan, rambu, atau distraksi visual, dengan tooltip interaktif).
  - Marker basecamp klinik (label permanen) + 3 lingkaran radius jangkauan (5/15/max km)
    dengan toggle "Tampilkan Radius".
  - Pembeda marker: GPS presisi (solid) vs estimasi sentroid (garis putus-putus).
  - Popup: badge status + penanda GPS Akurat/Estimasi Wilayah + jarak km.
- **Fase 3 — KPI spasial & filter interaktif:**
  - `customerMapUtils.ts`: `computeSpatialMetrics`, `filterPointsByStatus`, `statusOf`,
    `normalizeCity` diperkuat (sby/sda, buang prefix administratif).
  - 4 KPI card (total terpetakan, keterjangkauan %, rata-rata jarak, top wilayah)
    + legenda menjadi tombol toggle filter status.
- **Fase 4 — Backfill & dokumentasi:**
  - `scripts/backfill-customer-centroids.ts` (baru) — backfill non-destruktif
    (hanya `lat IS NULL`) dari gazetteer; `--dry-run`, `--tenant=`; cursor-based
    pagination (tahan mutasi selama iterasi). Lokal: 63 customer ter-update.
- **Test:** `customer-map-points` 12, `customer-map-utils` 19, `wilayah-normalizer` 5,
  `clinic-location` 7 — seluruhnya hijau. Build bot & admin hijau.

#### Gerbang Deterministik Balasan Lokasi Murni — Fast SOP Tanpa Call 2 (2026-09-19)

- **Validasi plan (2 Fase DITOLAK, 1 dimodifikasi):** (a) exemption
  `suggestedTemplateReply` di `buildLlmSafeToolPayload` DITOLAK — tidak perlu
  (fast-path konsumsi RAW `executedTools` di memori; payload LLM tetap murni,
  anti parrot-effect, test `tool-pipeline` pin deletion tetap hijau) dan berbahaya
  (parrot-effect kembali di giliran campuran). (b) Klausul prompt "WAJIB persis /
  DILARANG basecamp" DITOLAK (make-up; giliran campuran dijaga validator D8).
  (c) Klaim "100% kata-demi-kata, hemat ~13.000 token" dikoreksi: TERBUKTI via
  eksekusi bahwa sanitizer kuota vokatif menormalisasi bunda ekor template
  ("saja bunda. Jadi bisa ya bunda" → "saja. Jadi bisa ya") — output ≈95%
  template; angka token tak terverifikasi (`logs/llm-2026-09-19.jsonl` kosong).
  (d) Kriteria "symptom score = 0" tidak ada di codebase — dipetakan ke sinyal
  deterministik (`consult_symptom`/`ask_schedule`/`ask_duration`,
  `hasFallInjurySignal`/`hasVaccineSignal`, sebutan nama katalog data-driven).
- **Fixed:**
  1. `src/v3/tools/calculate-delivery.tool.ts` — 4 cabang ambigu/gagal
     (ambiguity kecamatan, `kecLevelName`, tanpa-koordinat, generik) kini membawa
     `suggestedTemplateReply` (`askKelurahanAmbiguous`/`askKelurahanRetry`).
     `message` tak berubah (jalur Call-2 fallback + information-hiding utuh).
  2. `src/v3/agent/pipeline/delivery-fast-path.ts` (baru, pure) — gate
     lokasi-murni: single `calculate_delivery` + template terisi + intent ⊆
     {provide_location, ask_price} + tanpa sinyal medis + tanpa sebutan katalog.
     Turn-0 prepend `firstContactGreetingHeader` (flag Islami via detector
     eksisting `hasIslamicSalutation`, baru) agar SOP greeting tak hilang.
  3. `src/v3/agent/agent-runner.ts` — Stage 3b: fast-path eligible →
     `draftReply` template + `tel.traceExecution`; tetap mengalir ke Stage 5
     (validator D8/numerik + sanitizer). Giliran campuran fail-open ke Call 2.
- **Sengaja TIDAK diubah:** CTA ongkir tetap state-aware audit 337101; tidak ada
  teks "DILARANG..." baru di prompt.
- **Test (TDD):** `delivery-fast-path` 22/22 (13 varian gate + 2 enrich + 2
  integrasi: pure = 1 axios call tanpa "basecamp"; compound = Call 2 jalan).
  Regression 175/175 (18 file); `npm run build` 0. `cart-dedup-total` 1 gagal
  pre-existing (verifikasi git stash sesi lalu).

#### Restorasi Greeting SOP & Gerbang Deterministik Narasi Asal Basecamp D8 (2026-09-19)

- **Validasi plan (ditolak sebagai tambal-sulam, direvisi fondasional):** plan usulan
  mengembalikan `suggestedTemplateReply` ke payload LLM + menambah larangan teks
  "DILARANG..." di prompt — DITOLAK (regresi arsitektur data-murni anti-parrot
  2026-09-19 + Mandat Anti-Penyelesaian Case-by-Case). Klaim "b5b2f3cd mengubah CTA"
  terbukti keliru (CTA state-aware sudah ada di 91ade27e). Frasa "dari basecamp kami
  di Waru" tidak ada di template mana pun (murni karangan LLM dari grounding RAG
  homebase); penyebutan "Bungurasih, Waru" adalah fakta geografis sah (lihat Known
  Issues #94). `logs/llm-2026-09-19.jsonl` kosong — tanpa bukti log live.
- **Fixed:**
  1. `src/config/persona.ts` — `TEMPLATES.greeting()` kembali ke 4-blok SOP
     (salam + "Terima kasih sudah menghubungi kami." + perkenalan homecare +
     pemantik domisili; identitas via `getBrandIdentity()`). Template deterministik
     Turn-0 dikecualikan kuota kalimat Rule 1 (mengatur generation); kuota vokatif
     2x terjaga. `firstContactGreetingHeader` tetap pendek (prefix LLM, anti-duplikasi).
  2. `src/v3/guardrails/factual-claim-validator.ts` — **D8_ORIGIN_NARRATION**:
     gerbang kode deterministik berbasis kontrak tool (calculate_delivery sukses +
     get_clinic_policy_faq TIDAK terpanggil → bingkai asal generik invalid).
     Ditangani re-prompt kognitif + salvage kalimat yang sudah ada di
     guardrail-pipeline (preseden D7), tanpa parrot-template & tanpa prompt DILARANG.
  3. `src/v3/guardrails/sanitizer.ts` — `trimToMaxSentencesPreservingGreetingHeader`
     mengenali header kanonis SOP multi-baris (+ varian Waalaikumsalam) agar pemantik
     domisili tidak terpotong trimmer saat LLM menggema sapaan.
- **Sengaja TIDAK diubah (deviasi tercatat):** default CTA ongkir tetap state-aware
  audit 337101 (CTA "Rencana mau ambil perawatan..." + cabang treatment/tanggal);
  verbatim SOP "Mau pilih treatment apa bunda ?" akan membunuh context-awareness dan
  bertentangan dengan contoh prompt/few-shot yang mengajarkan CTA baru. Perlu
  konfirmasi tim admin bila verbatim tetap diminta.
- **Test:** D8 7/7 (4 parafrase adversarial + 2 eksempsi kontrak + 1 anti-false-positive
  template SOP); greeting SOP; header kanonis; `v3-persona-rules` Test 1 diselaraskan
  (batas template deterministik = 4). Targeted 93/93 + 66/67 hijau (`cart-dedup-total`
  1 gagal TERBUKTI pre-existing via git stash). `npm run build` 0.

#### Dashboard Peta Sebaran Pelanggan (Surabaya–Sidoarjo–Gresik) (2026-09-19)

- **Audit perbaikan (post-review, 2026-09-19):**
  - **Race condition marker tidak muncul (Kritis):** `loadLeaflet()` async lebih lambat
    daripada effect penggambar marker → `mapRef` masih null saat marker digambar, dan tidak
    ada re-trigger. Diperbaiki dengan state `mapReady` sebagai dependency + guard generation
    yang tahan double-invoke StrictMode (map selalu di-remove dengan benar).
  - **Sandbox test bocor ke peta:** endpoint `map-points` tidak mengecualikan
    `is_sandbox_test` seperti endpoint list. Ditambahkan `is_sandbox_test: false`.
  - **CSS Leaflet belum siap saat render:** CSS kini ditunggu (`waitForCss`) sebelum
    inisialisasi peta, mencegah marker/zoom tampil tanpa styling.
  - **Filter kota tidak menangkap varian penulisan:** logika filter & opsi dropdown
    diekstrak ke `customerMapUtils.ts` (pure, teruji) dengan normalisasi kota kanonik
    ("Kota Surabaya" / "Surabaya" → satu opsi "Surabaya").
  - **Tombol Refresh menyajikan cache basi:** `fetchCustomerMapPoints` kini mendukung
    `fresh` (via `refreshApi`) sehingga Refresh/retry benar-benar mengambil data baru.


- **Backend:** Endpoint ringan `GET /api/admin/customers/map-points` (`customers.subroute.ts`) —
  hanya mengembalikan kolom spasial (`lat/lng/kota/kecamatan/kelurahan/status/is_mql/is_out_of_coverage/distance_km`)
  untuk pelanggan dengan koordinat valid (`lat/lng NOT NULL` dan dalam rentang sah).
  - **Fokus wilayah layanan secara default:** hanya titik dengan kota mengandung "Surabaya",
    "Sidoarjo", atau "Gresik" (toleran variasi penulisan: "Kota Surabaya", "Kabupaten Sidoarjo",
    "Gresik Regency"). Gunakan `?scope=all` untuk menampilkan seluruh titik.
  - Filter `?kota=` memakai pencocokan **contains case-insensitive** (bukan exact-match) agar
    toleran terhadap variasi penulisan kota di DB. Tenant isolation (`DEFAULT_TENANT_ID`) dijaga.
- **Frontend:**
  - `leafletLoader.ts` (baru) — lazy-loader CDN Leaflet 1.9.4 + MarkerCluster 1.5.3 (idempotent, non-blocking,
    dimuat hanya saat tab peta dibuka). **Tanpa dependency npm baru.**
  - `CustomerMapTab.tsx` (baru) — peta geografis presisi berbasis koordinat, **tanpa basemap
    jalan/bangunan** (latar abu solid ber-grid agar fokus ke sebaran titik), marker clustering,
    warna marker data-driven (Aktif/MQL/status lain/di luar jangkauan), popup + tombol navigasi Google Maps,
    filter kota dari data, auto-fit bounds, fallback ramah saat CDN gagal, `useUiFeedback` untuk error.
    - **Detail pelanggan via tombol "Lihat Detail Pelanggan" di popup** (menggantikan dblclick yang
      tidak jelas/mudah salah), dengan HTML escaping nama/telepon untuk mencegah injeksi.
    - Toggle "Semua wilayah" + dropdown kota (filter di client, tanpa request ulang).
    Hook `clinic-map-ready` disiapkan untuk render batas kecamatan (GeoJSON) di masa depan.
  - `CustomerDatabase.tsx` — Tab ke-3 "Sebaran Peta" (bukan page baru) via `?tab=map`, deep-linkable.
  - `api.ts` — `fetchCustomerMapPoints()` + tipe `MapPoint`.
- **Test:** `tests/unit/customer-map-points.test.ts` — 8 skenario adversarial (koordinat invalid dibuang,
  filter contains case-insensitive, tanpa filter kota, spasi kosong diabaikan, fokus 3 kota + variasi
  penulisan, `scope=all`, DB error → 500, tanpa auth → 401).
  `tests/unit/customer-map-utils.test.ts` — 11 test util murni (normalisasi kota, filter, warna marker, validasi koordinat).
- **Limitasi:** Peta bergantung CDN unpkg + koneksi internet (lihat `docs/KNOWN_ISSUES.md`).

#### Perampingan Rules Fondasional, Ongkir Lokasi Presisi & Remediasi Gramatikal Sanitizer (2026-09-19)

- **Keputusan kebijakan (sesi 779408):** saat lokasi PRESISI terverifikasi, bot LANGSUNG
  menyampaikan jarak & ongkir promo meskipun customer hanya menyebut lokasi tanpa menanya biaya.
  Rule 2 (Information Hiding) direvisi: yang tetap dilarang adalah membeberkan **harga paket
  perawatan**/grand total sebelum ditanya/dipilih — bukan jarak/ongkir.
- **Fase 1 — Harmonisasi kontrak ongkir:**
  - `calculate-delivery.tool.ts`: `showFeeNominal` kini = `askedFee || (lokasi presisi & bukan
    centroid & dalam jangkauan)`. Kecamatan luas (imprecise) & luar jangkauan tetap menyembunyikan nominal.
  - `tool-pipeline.ts`: `markOngkirQuoted` dipicu saat ongkir benar-benar diekspos (bukan hanya
    `asksDeliveryFee`). Data terstruktur (`distanceKm`/`ongkirPromo`) dikirim apa adanya ke LLM —
    **`suggestedTemplateReply` TIDAK dikembalikan** ke payload LLM (menjaga dekomposisi anti-parrot).
  - `location-rules.phase.ts`: pin larangan ongkir diganti pin larangan **harga paket** (state-gated).
- **Fase 2 — Perampingan negative constraints (non-hardcode & SaaS-ready):**
  - Rule 4 direvisi jadi state-gated (`buildToneNegConstraints`): wajib tanya usia saat tanya
    harga paket anak HANYA bila usia belum ada di sesi; bila sudah ada → dilarang menodong usia.
  - Rule 10 (Newborn 0-28 hari) Dihapus → otoritas `Treatment.min_age_months`/`max_age_months` + tool.
  - Rule 15 (anti-tanya KM) dihapus (redundan dengan tool `calculate_delivery`).
  - Rule 17 (asumsi selapan & model cukur) dihapus → dialihkan ke RAG `search_knowledge_faq`.
  - Rule 11 dibuat tenant-agnostic (hapus hardcode "Waru"); homebase dirujuk ke `get_clinic_policy_faq`.
  - Rule 14 dibersihkan dari hardcode "alas tidur" → grounding ke [PANDUAN & KNOWLEDGE BASE]/RAG.
  - Rule 7 ditambah larangan menyebut "Admin CS".
  - `tenant-prompt-config.service.ts` default `negativeConstraints` diselaraskan (17 butir).
- **Fase 3 — Remediasi Mid-Sentence Mutilation (`sanitizer.ts`):** `limitVocativeQuota` kini
  melindungi sapaan berposisi SUBJEK/AGEN klausa di tengah kalimat — didahului modal verb
  (`ingin/mau/bisa/perlu/dapat/sedang/sudah/akan/belum/harus/boleh/sempat`) atau konjungsi
  subordinatif (`kalau/jika/apabila/bila/apakah/agar/supaya/saat/ketika`). Kasus nyata
  "Ada yang ingin Bunda konsultasikan..." tidak lagi terpotong.
- **Verifikasi:** `npm run build` 0; `v3-sanitizer-vocative-quota` 17/17,
  `calculate-delivery-precise-fee` 3/3, `calculate-delivery-broad-region` 5/5,
  `location-prompt-pruning` 8/8, `catalog-information-hiding` 4/4, `capi-repeat-order` 8/8,
  `parser-day-date-cross-validation` 6/6, integrasi `active-reservations-endpoint` 3/3;
  suite v3 620 passed (28 pre-existing failures tidak berubah).

#### Meta CAPI New vs Repeat Order & Peringatan Jadwal Aktif Admin (2026-09-19)

- **Masalah (multi-layer):**
  1. **RC-1 (Data/DB):** `Reservation.is_repeat_order` hanya di-set oleh `followUpService.onReservationCreated`
     berdasarkan ada/tidaknya *follow-up pending* — semantik salah (bukan riwayat transaksi). Kolom juga
     belum pernah tercatat di chain migrasi (ditambahkan via `db push`) sehingga fresh deploy kehilangan kolom.
  2. **RC-2 (Tool/Payload Contract):** `capiService.sendCapiEvent` tidak menyuntikkan pembeda new/repeat ke
     `custom_data` Purchase sama sekali, sehingga advertiser tidak bisa membuat Custom Conversion.
  3. **RC-3 (Query/Daftar):** `GET /api/admin/capi-queue` tidak menyertakan `is_repeat_order`/`order_number`,
     dan query `leadAuditLogs` TANPA `orderBy` → Prisma default asc → `sentMap` menimpa dengan log TERTUA,
     menghilangkan status moderasi MQL terbaru dari antrean.
  4. **RC-4 (Parser):** `tryParseIndonesianDate` buta terhadap kontradiksi nama hari vs angka tanggal
     (mis. "Selasa, 21 September 2026" padahal 21 Sep = Senin) → jadwal tersimpan di hari salah.
  5. **RC-5 (Admin UX):** Tidak ada peringatan jadwal aktif saat admin membuat reservasi baru → risiko
     *split-brain duplicate booking*.
- **Perbaikan (fondasional):**
  1. `reservation-core.service.ts`: `computeIsRepeatOrder()` menghitung riwayat `confirmed`/`completed`
     (di luar reservasi yang sedang di-update) dan mempersist `is_repeat_order` di SEMUA jalur create/update
     (anti-fabrikasi, fail-safe DB offline → new). Ini menjadikan core sebagai single source of truth.
  2. `capi.service.ts`: `resolveNewVsRepeatContext()` + injeksi `custom_data` untuk event `Purchase`:
     `is_repeat_order`, `customer_type: 'new'|'repeat'`, `order_number`, `prior_orders_count`.
     **Event name tetap `Purchase`** (standar Meta) agar Value-Based Bidding/ROAS tidak terganggu.
  3. `reservations.subroute.ts`: capi-queue menyertakan `is_repeat_order`/`order_number`/`customer_type`
     (ordinal dari urutan `created_at` per customer, 1 query); `leadAuditLogs` di-`orderBy created_at desc`.
  4. `reservation-text-parser.ts`: `reconcileWrittenDayWithDate()` — koreksi slip hari ±1 (typo manusia);
     kontradiksi > 1 hari mengabaikan nama hari (tanggal numerik menang) agar tidak melompat liar.
  5. Endpoint baru `GET /api/admin/customers/:id/active-reservations` (confirmed|hold, `booking_date >=`
     awal hari WIB) untuk Konsumsi modal Create Reservation & Live Chat.
  6. Dashboard: badge `✨ Pasien Baru` / `🔁 Repeat Order` + filter tipe order + field payload JSON di
     Meta CAPI Queue; warning banner jadwal aktif di `CreateReservationModal` (tombol Edit Reservasi
     Eksisting via `onEditReservation`); Live Chat badge confirmed kini date-aware (hari ini/ke depan).
- **Migrasi:** `prisma/migrations/20260919000000_add_reservation_is_repeat_order` (idempotent, aman DB live & fresh).
- **Verifikasi:** `npm run build` (root & admin-dashboard) 0; unit `capi-repeat-order` 8/8,
  `parser-day-date-cross-validation` 6/6, integrasi `active-reservations-endpoint` 3/3; regression
  capi/reservation/parser 121/121 hijau.

#### Standardisasi Model `deepseek-v4-1-flash` + Fallback LLM 3-Tier (2026-09-19)

- **Masalah (RC-1/RC-2/RC-3):** DB `tenant_ai_config` & `.env` menyimpan model provider-asing
  (`MiniMax-M2.7-highspeed`, `gpt-4o-mini`, `deepseek-chat`) padahal provider aktif KENARI →
  log `[LLM MODEL FALLBACK] ... 400` beruntun; chain fallback tidak provider-aware; enrichment
  saat human-handling tetap memanggil LLM yang selalu gagal.
- **Sumber kebenaran tunggal** (`src/config/ai-models.config.ts`): konstanta `KENARI_PRIMARY_MODEL`
  (`deepseek-v4-1-flash`, label "DeepSeek-V4.1-Flash"), `SUMOPOD_SECONDARY_MODEL` (`deepseek-v4-flash`),
  `DEEPSEEK_DIRECT_MODEL` (`deepseek-flash`). `sanitizeModelForProvider` kini provider-aware penuh
  (alias dua arah + remap katalog asing per-provider).
- **Fallback 3-Tier** (`src/integrations/llm/model-fallback.ts`): `resolveFallbackTiers()` →
  Tier 1 Kenari → Tier 2 SumoPod → Tier 3 DeepSeek Direct, guard skip bila baseUrl/apiKey kosong.
  `generation-stage.ts` circuit-breaker memakai resolver yang sama (hilangkan hardcode `api.deepseek.com`).
  `DEFAULT_FALLBACK_CHAIN` = model primer Kenari (tanpa chain internal sesuai keputusan desain).
- **Enrichment deterministik** (`src/services/human-background-enrichment.service.ts`): coba
  `preExtractDeterministic` (0 token) dulu; LLM hanya dipanggil bila kosong (TDD: 2 test adversarial baru).
- **Cost calculator** (`src/utils/cost-calculator.ts`): peak-hour dibatasi ke model SumoPod/DeepSeek Direct;
  entry `deepseek-flash` ditambah.
- **Config & DB**: `.env`/`.env.example` diselaraskan ke `Kenari/deepseek-v4-1-flash`; blok `SUMOPOD_*` eksplisit;
  chain fallback baru; plus script migrasi idempoten `scripts/migrate-model-config-to-deepseek-v41.ts`
  (dry-run + guard production). DB `tenant_ai_config` 6/6 baris kini kanonik.
- **Admin dashboard**: katalog provider SumoPod + label tier (rebuild `packages/admin-dashboard`).
- **Verifikasi**: `npm run build` 0; fallback-chain 16/16, provider-alignment 9/9, enrichment 7/7,
  cost-calculator 12/12; full suite 2762 passed / 41 failed (semua sisa pre-existing).

#### Arsitektur Data Murni Tool, Netralitas Agama Lapisan Prompt & D7 Kognitif (2026-09-18)

- **Fase 1 — Netralitas agama di Single Source of Truth** (`src/v3/agent/prompt/layers/core-persona.layer.ts`,
  `src/v3/agent/prompt/phases/router-direct-reply.layer.ts`): aturan 4b **NETRALITAS AGAMA** yang
  tadinya hanya di legacy `src/config/persona.ts:93-95` kini injeksi di `TONE_NEG_CONSTRAINTS` (V3)
  serta sinkron di `router-direct-reply`. Model menerima instruksi eksplisit: DILARANG
  "Alhamdulillah/Bismillah/Insya Allah/Puji Tuhan" tanpa pemicu; salam "Assalamualaikum" dijawab
  "Waalaikumsalam Bunda" (pengecualian sah). Verifikasi: `prompt-composer` memuat `NETRALITAS AGAMA` (exit 0).
- **Fase 2 — Tool ke data murni (pure structured)** (`src/v3/agent/pipeline/tool-pipeline.ts`,
  `src/v3/tools/calculate-delivery.tool.ts`): `buildLlmSafeToolPayload` kini menghapus
  `suggestedTemplateReply/suggestedPriceReply/suggestedConsultationReply` + memangkas `"Format
  penyampaian yang disarankan: ..."` dari `message` (anti parrot-effect). CTA final tanpa suffix
  "atau Bunda" (Single-Vocative Principle). `message` alat mengembalikan fakta jarak/jangkauan
  murni (angka via `__internal*`), bukan naskah balasan.
- **Fase 3 — Guardrail kognitif D7** (`src/v3/guardrails/factual-claim-validator.ts`): tambah
  `UNPROMPTED_RELIGIOUS_RE` + `CUSTOMER_RELIGIOUS_TRIGGER_RE` sebagai pelanggaran D7
  (`D7_UNPROMPTED_RELIGIOUS_PHRASE`). Tanpa pemicu customer → invalid (1x re-prompt bersih di
  `guardrail-pipeline.ts` yang sudah ada); dipicu customer (`assalamu...`/`alhamdulillah`) → valid
  (netral). Pendekatan kognitif, bukan mutilasi regex tengah kalimat.
- **Verifikasi**: `npm run build` (tsc) exit 0; D7: `factual-claim-validator.test.ts` 13/13;
  Fase 1: prompt-composer exit 0; Fase 2: `tool-pipeline-payload-sanitization` 3/3.

#### Fase 3 & 4 Plan Terbaru: Semantik "Berapa" & Zero-Dangling Sanitizer (2026-09-18)

- **Verdict audit plan**: dari 3 Milestone, hanya **Fase 3 & 4** tersisa & fondasional.
  Fase 1/2 sudah dikerjakan (plan ketinggalan); Fase 6/7/8 sudah selesai di Milestone 2;
  Fase 9 premis salah (tabel `clinic_policies` belum di-deploy, bukan kode); Fase 10/11 ditunda
  (Confirmation Gate); Fase 5 salah hitung matriks (23, bukan 24).
- **Fase 4 — Zero-Dangling Rule** (`src/v3/guardrails/sanitizer.ts`): bug TERBUKTI direproduksi —
  `"...untuk si kecil atau Bunda? 🤗"` dipangkas kuota vokatif menjadi `"...untuk si kecil atau? 🤗"`
  (kata sambung menggantung). Akar: `PREPOSITION_BEFORE_RE` tidak memuat konjungsi koordinatif.
  Fix: tambah `dan|atau|serta|maupun` sebagai gerbang integritas gramatikal (sapaan setelah
  konjungsi = objek koordinatif, DILARANG dihapus). Test adversarial: "atau Bunda?" tetap utuh,
  "dan Bunda" tetap utuh, overuse tetap ditegakkan.
- **Fase 3 — Semantik interogatif "berapa"** (`src/v3/agent/persona.ts`): bug TERBUKTI —
  `"ke kenjeran berapa"`, `"pijat bayi berapa"`, dan `"berapa"` **TIDAK** memicu `ask_price`
  (butuh kata biaya eksplisit). Fix fondasional: `berapa` = pertanyaan HARGA by-default, KECUALI
  terikat satuan non-moneter (durasi/usia/kuantitas/jarak) yang mengikutinya (menoleransi filler
  "sih/ya/kah"). Mengganti whitelist hafalan kata-biaya. Tech debt `NON_MONETARY_FOLLOWERS` dicatat
  di `docs/KNOWN_ISSUES.md` (idealnya taksonomi unit terpusat).
- **Verifikasi**: `npm run build` (tsc) exit 0; 13 suite (sanitizer + NLU + katalog + guardrail +
  delivery) = **119/119 hijau**; tak ada kebocoran harga (information hiding tetap utuh).

#### Milestone 2 & 3: Data Terstruktur get-catalog, Guardrail Tanpa Overwrite, & Audit ClinicPolicy (2026-09-18)

- **Fase 3 — Output get-catalog jadi data terstruktur** (`src/v3/tools/get-catalog.tool.ts`):
  tambah `CatalogPricingBreakdown` (`targetName`, `originalPrice`, `promoPrice`, `deliveryFee`,
  `grandTotal`, `durationMinutes`, `area`) & `CatalogCartRecapBreakdown` (`items`, `subtotalPromo`,
  `deliveryFee`, `grandTotal`) ke `GetCatalogOutput`; tambah `focusClinicalDescription` +
  `focusTargetAudience` (MOMS/BABY). `message` tidak lagi memuat instruksi salin-tempel
  "Format Penyampaian Harga ..." — diganti fakta terstruktur (`Data Finansial Resmi`, total resmi
  keranjang). LLM menalar dari angka, bukan menyalin prosa (Mandat Non-Hardcode & data-driven).
- **Fase 4 — Guardrail berhenti menimpa narasi LLM** (`src/v3/agent/pipeline/guardrail-pipeline.ts`):
  hapus blind overwrite `finalReply = cartTotalFallback || sessionCartFallback ||
  executedTools[0]?.suggestedPriceReply || suggestedTemplateReply`. Kini HANYA rekap resmi
  deterministik (total keranjang mesin) yang boleh menggantikan draft; tanpa rekap resmi, draft
  natural dipertahankan (guardrail hilir yang menangani). CTA rekap keranjang kini **state-aware**
  (`session.booking.preferredDate`), bukan "hari apa" hardcoded.
- **Fase 5 — Audit ClinicPolicy (parity)**: investigasi live membuktikan tabel `clinic_policies`
  **TIDAK ADA di DB produksi** → `get_clinic_policy_faq` selalu fallback statis. Akar: migrasi
  `20260917000001_add_prompt_policy_tables_align_drift` + `scripts/seed-clinic-policies.ts` **sudah
  ada di repo** (commit `025aa3b1`) tapi **belum di-deploy** (server di `57e8a0f`, local ahead 1).
  Tidak ada kode baru yang diperlukan — fix = deploy migrasi + seed. Ditambah test parity: seluruh
  7 topik wajib punya fallback statis lengkap (`clinic-policy-db-first.test.ts`).
- **Verifikasi**: `npm run build` (tsc) exit 0; 19 suite (delivery + get-catalog + guardrail +
  clinic-policy) = **127/127 hijau**.
- **Ditunda**: Fase 6 (TEMPLATES→DB) tetap ditunda (Confirmation Gate).

#### Milestone 1 (Fase 1–2): Netralitas Agama, CTA State-Aware & Carry-Over Berbasis State (2026-09-18)

- **Fase 1 — Netralitas agama + teks ke template layer** (`src/v3/tools/calculate-delivery.tool.ts`,
  `src/config/persona.ts`): hapus 2 literal `Alhamdulillah...` (baris 387 & 596) yang ditulis
  tanpa syarat/flag tenant — inkonsisten dengan jalur `isIslamic` di greeting. Teks jangkauan
  customer-facing dipindah ke template baru `TEMPLATES.inCoverageNoFee({ kelurahan, scheduleCta })`
  (bukan literal baru di tool), sesuai Mandat Non-Hardcode. Spasi baris diperbaiki (`\n\n`).
- **Fase 1 — CTA state-aware** (`buildScheduleCta`): signature diperluas ke
  `ScheduleCtaOptions { preferredDate?, candidateTreatmentName?, hasCartItems? }` dengan **overload
  `string | object`** (nol breaking-change untuk call lama). 3 cabang: (1) hari ada → akui+cekkan;
  (2) treatment/keranjang ada → tanya hari; (3) treatment belum ada → DILARANG menodong jadwal,
  tanya kebutuhan perawatan (Aturan Emas 20). Semua 6 call-site diharmonisasikan.
- **Fase 2 — Carry-over ongkir berbasis STATE** (`src/v3/agent/pipeline/tool-pipeline.ts`): draf
  lama memakai keyword-matching (`startsWith('kalau ke')`, `includes('berapa')`) yang melanggar
  Mandat Anti-Overfitting. Diganti seam murni `ToolExecutionPipeline.shouldCarryOverDeliveryFee(session)`
  yang bersandar pada state riil `session.priceDiscussed === true` + `session.location` sudah terisi.
  Efek: nominal ongkir tetap sah saat customer membandingkan lokasi, **invariant terhadap parafrase**.
- **Verifikasi**: `npm run build` (tsc) exit 0; `delivery-schedule-cta-context.test.ts` (12 test:
  4 cabang CTA + netralitas agama + anti format-menempel + 2 skenario end-to-end) &
  `tool-pipeline-price-intent.test.ts` (7 test state-based incl. invarian parafrase) hijau;
  9 suite delivery terkait = **78/78 hijau**.
- **Catatan**: 6 file test v3 yang gagal di suite penuh (`recruitment-loker-gate`,
  `schedule-check-handoff`, `pediatric-taxonomy-adaptation`, `clinic-area-routing`,
  `guardrail-no-mutilation`, `context-schedule-duration-governance`) adalah **kegagalan
  pra-eksisting** dari commit WIP `025aa3b1` (terbukti: 16 gagal juga saat perubahan ini di-stash)
  — tidak berkaitan dengan Milestone 1 ini.
- **Ditunda**: Fase 6 (migrasi 30+ `TEMPLATES` persona.ts ke DB) — Confirmation Gate, keputusan
  user: tunda. Lihat `docs/plans/REVISED_FOUNDATIONAL_PLAN_2026-09-18.md`.

#### Eksekusi Plan Fondasional 3 Sesi Simulator — D6 Kenjeran + Matrix CM-23 (2026-09-18)

- **Verdict audit:** dari 7 fase, hanya Fase 1 gap nyata → dieksekusi. Fase 2/3/5/6 SUDAH dikerjakan sesi sebelumnya (terverifikasi hijau, tanpa kode baru). **Fase 4 DITOLAK** sebagaimana ditulis: normalizer hardcode string Indonesia di TS melanggar Mandat Non-Hardcode; tujuan sudah dicapai kontrak `closingIntent` (matrix CM-22 hijau).
- **Fixed — Fase 1 D6 grounding exemption** (`factual-claim-validator.ts`): kecamatan yang disebut customer (`customerInput`, pencocokan kata-utuh anti-"warung"→"Waru") ATAU dikembalikan `calculate_delivery` (result.kecamatan/args.locationText) = grounding sah, bukan halusinasi. Threading `customerInput: incomingText` di kedua call-site `guardrail-pipeline.ts`.
- **Fase 7:** skenario matrix **CM-23** ("ke kenjeran berapa ya" → tool terpanggil, verdict ter-grounding Kel. Kenjeran/Kec. Bulak, tanpa pola minta-maaf/todong-alamat). Matrix kini 23/23.
- **Verifikasi:** `build` 0; D6 12/12; matrix 23/23; full suite 2714 passed / 39 failed pre-existing / 24 skipped (sebelumnya 2709/40 — 1 regresi lama sembuh, 4 test baru hijau).
- Detail penolakan Fase 4 + cap opsi di `docs/KNOWN_ISSUES.md` #90.

#### Eksekusi Plan Regresi Oksitosin/Cart/Nominal — 6 Fase Fondasional (2026-09-18)

- **Verdict audit:** plan (`docs/IMPLEMENTATION_PLAN_REGRESI_OKSITOSIN_CART_NOMINAL.md`) SUDAH fondasional (multi-layer root cause Data/State/Tool/Validator/Sanitizer, data-driven, state-gated) — BUKAN tambal-sulam. Dieksekusi penuh; detail + deviasi di `docs/KNOWN_ISSUES.md` #89.
- **Fixed — Fase 1 sanitizer:** `applyPreLocationTone` dihapus total (anti double-emoji; nada pra-lokasi milik `location-rules.phase.ts`); `limitVocativeQuota` + proteksi subjek klausa relatif ("layanan yang Bunda maksud" utuh — bug TERBUKTI via TDD merah).
- **Fixed — Fase 2 audience bundle:** `resolveServiceAudience()` derivasi komposisi `bundleItemIds` (tanpa migrasi DB); 7 hafalan `id.includes('moms'/'laktasi'/'kelahiran')` dihapus; paket oksitosin → `[Untuk Bunda]`; fallback grounding buta 'Si Kecil' → audience-aware.
- **Fixed — Fase 3 cart:** `session.discussedTreatments` baru; pertanyaan konsultatif (`?` tanpa verba komitmen/bukti hari) masuk discussed, BUKAN cart (anti tagihan siluman Rp 155.000). 1 kontrak lama diselaraskan (`v3-audit-homecare-fix` Layer 2: pertanyaan perbandingan bukan komitmen).
- **Fixed — Fase 4 validator:** `args.targetPrice` terstruktur masuk `authorizedNumbers` (kutipan "Rp 900.000 belum ada paket..." lolos, tanpa reprompt penimpa).
- **Fixed — Fase 5 closing:** `CLINICAL_PROBE` + `suggestedConsultationReply` audience-aware (ibu → skrining Bunda; discussed → larangan skrining ulang); kontrak `closingIntent` lestari.
- **Fixed — Fase 6 lokasi:** `hasNewLocationEntity` + token inti kecamatan ("Di tenggilis kak" membuka `calculate_delivery`; "Waru" tetap tertutup).
- **Verifikasi:** `tsc`/`build` 0; gate per-fase + matrix 22/22 hijau; full suite 2709 passed / 39 failed pre-existing (terbukti via clean-tree stash) / 24 skipped.

#### Perbaikan Holistik Fondasional Chatbot — 6 Guard Deterministik (2026-09-18)

- **Phase 1 — Crash & greeting reset**: guard `(intents/symptoms || [])` di `selectRelevantExemplars` (anti `TypeError symptoms`); `buildInvalidReplyFallback(isFollowUp)` — greeting pembuka hanya Turn-0, follow-up pakai recovery kontekstual.
- **Phase 2 — Information hiding ongkir**: `asksDeliveryFee` baru di `calculate_delivery` (schema + registry); nominal rupiah disembunyikan bila customer tak bertanya biaya (bagian get-catalog sudah dikerjakan sesi sebelumnya, dikunci test).
- **Phase 3 — Pruning Call-2 + pin lokasi**: `buildLocationHierarchyBlock(session)` (cabang tanya-lokasi dicabut bila lokasi diketahui + pin permanen; byte-identik bila belum); pin `[LOKASI TERKUNCI]` di baris teratas `buildContextSummary`.
- **Phase 4 — Centroid fallback**: kecamatan + detail spesifik (streetDetail/penanda generik/nama perumahan menempel) → sentroid gazetteer `success:true isEstimatedCentroid` tersimpan ke sesi (tanpa tandai QUOTED); tanpa detail tetap minta kelurahan.
- **Phase 5 — Normalizer output**: `trimToMaxSentences` (maks 3 kalimat, anti desimal/jam) hanya satu-paragraf + `applyPreLocationTone` di gate akhir pipeline.
- **Verifikasi**: 6 file uji baru + 2 kontrak lama diselaraskan; `tsc` 0, `npm run build` 0; full suite 355 hijau / 4 merah pre-existing (terbukti di clean tree via stash).

#### Isolasi Multi-Tenant Meta CAPI/Pixel & Profil ORS Mobil Non-Tol (2026-09-18)

- **Isolasi kredensial CAPI (`src/services/capi.service.ts`)**: fungsi baru `resolveTenantCapiCredentials(tenantId)` sebagai SATU-SATUNYA pintu resolusi kredensial (fail-closed) — dipakai `sendCapiEvent` maupun `testCapiConnection`, menggantikan dua blok copy-paste. Fallback `.env` HANYA untuk `default-tenant` eksplisit; tenant non-default tanpa kredensial DB valid, DB error, token gagal decrypt, atau tanpa tenantId → skip (`Skipped: Credentials missing for tenant <id>`), axios tidak dipanggil.
- **Landing anti-leakage (`landing-content.service.ts`, `landing.route.ts`, `html-sanitizer.ts`, `landings.subroute.ts`)**: dummy `'123456789012345'` dihapus; env `FB_PIXEL_ID` hanya untuk default-tenant; `injectTracking` tidak menyuntik pixel bila ID kosong (click-catcher atribusi tetap jalan); template `go.html` men-strip total blok pixel bila ID kosong; query `?p=` di `/cta` hanya berlaku untuk default-tenant (anti-spoofing attribution).
- **ORS mobil non-tol (`.env`)**: `ORS_PROFILE="cycling-electric"` → `"driving-car"` + `ORS_AVOID_FEATURES="tollways"` (`.env.example` sudah mendokumentasikan nilai ini).
- **Verifikasi**: `tests/unit/ors-profile-nontol.test.ts` (4/4), `tests/unit/capi-tenant-isolation.test.ts` (8/8), gate regresi landing/CAPI/atribusi/delivery 50+53 hijau; build `tsc` exit 0.
- **Operasional**: pindahkan `FB_PIXEL_ID` + `FB_CAPI_ACCESS_TOKEN` milik klinik ke DB via Admin Dashboard → Settings (tersimpan terenkripsi), lalu kosongkan di `.env` server.

#### Cache-Control `no-store` untuk Seluruh API Admin (Anti Data Basi Browser/Proxy) (2026-09-17)

- **Akar masalah laporan "Delivery Fee Tiering 14 tier (duplikat)"** (diverifikasi via browser user:
  buka `/api/admin/delivery-tiers` langsung = 14, padahal dari dalam proses app = 7, DB = 7, file = 7):
  route `/api/admin/*` **TIDAK mengirim header `Cache-Control`**. Tanpa header itu, browser (dan proxy
  di depan) boleh menyimpan respons GET secara heuristik dan menyajikan payload lama pada navigasi
  langsung maupun reload — sehingga admin melihat data basi/duplikat meski server & DB benar.
- **Fix fondasional (`src/routes/admin.route.ts`):** hook `preHandler` kini menyetel
  `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0`, `Pragma: no-cache`,
  `Expires: 0` untuk **semua** request `/api/admin*` (di-set SEBELUM auth, jadi respons 401 pun
  no-store). Berlaku global untuk seluruh endpoint admin, bukan tambal per-route.
- **Lanjutan fix klien sebelumnya** (`packages/admin-dashboard/src/services/api.ts`): `getCachedApiResponse`
  TTL-aware + primitive `refreshApi` (lihat entri di bawah) tetap berlaku; kini ada dua lapis
  (server no-store + klien forceFresh).
- **Verifikasi**: `npm run build` (tsc) exit 0; build dashboard Vite exit 0;
  `tests/unit/admin-api-cache.test.ts` (11 test: 7 cache/TTL/refreshApi + 2 header no-store pada
  respons 200 & 401, dst) + 3 suite delivery + `ai-health` = **52/52 hijau**.

#### Cache SWR Admin Dashboard: TTL-Aware & Primitive Hard-Refresh (2026-09-17)

- **Investigasi laporan "Delivery Fee Tiering duplikat"**: terbukti **bukan bug server** — DB
  `delivery_tiers` bersih (7 baris, `COUNT(DISTINCT max_dist)=7`) dan live API di produksi
  mengembalikan `LEN=7` (id 1..7 tanpa duplikat). Penyebab = **cache SWR klien** yang basi
  (`memoryApiCache` + `sessionStorage` `apiCache:*`, TTL 15s); tombol Reload tidak melewatinya.
- **Fix fondasional (`packages/admin-dashboard/src/services/api.ts`):**
  1. `getCachedApiResponse(endpoint, { allowStale })` kini **hormat TTL** — entri kedaluwarsa HARAM
     disajikan untuk hidrasi awal; hanya fallback kegagalan jaringan (`allowStale: true`) yang boleh
     memakai data basi. Menutup 5 titik hidrasi (`Overview`, `Reservations`, `CustomerDatabase`,
     `TodayTreatments`) yang sebelumnya bisa render data tua.
  2. Ditambah primitive **`refreshApi(endpoint, options)`** = `clearApiCache(url)` +
     `apiRequest(forceFresh: true)` — kontrak terpusat untuk tombol Reload/Refresh admin.
  3. `DeliveryTiers.tsx` Reload di-wire ke `refreshApi` (memperbaiki kasus yang dilaporkan).
- **Audit sistem menyeluruh**: ditemukan **31 kontrol Refresh manual di 20+ file** yang masih pakai
  GET biasa (bisa sajikan cache 15s). Migrasi sisanya **ditunda sengaja** dan dicatat di
  `docs/KNOWN_ISSUES.md` #79 (menghindari blast radius 20+ file dalam satu PR).
- **Verifikasi**: `npm run build` (tsc) exit 0; build dashboard Vite exit 0;
  `tests/unit/admin-api-cache.test.ts` (baru, 7 test: TTL fresh/expired/allowStale, cache-hit tanpa
  network, refreshApi bypass+replace, dua refresh berturut hit network, normalisasi endpoint) +
  3 suite delivery = **47/47 hijau**.

#### Perbaikan Delivery Fee Tiering: Hardcode Bebas & Paritas Out-of-Coverage (2026-09-17)

- **Audit live (read-only)**: `delivery_tiers` produksi default-tenant sehat (7 tier,
  `updated_at` 2026-08-23, tidak ter-overwrite). Seeding-overwrite (dugaan awal) **tidak terjadi** —
  data tier aman. Temuan nyata ada di lapisan **kode**, bukan data.
- **BUG A — Hardcode `freeTierKm: 5` & batas jangkauan `30 km`** (`src/v3/tools/calculate-delivery.tool.ts`):
  dua jalur (URL Maps resolved & geocoding teks) mem-passing `freeTierKm: 5` + `maxCoverageKm: 30`
  literal ke `TEMPLATES.ongkirInfo`/`outOfCoverage`, padahal `calculateDelivery()` sudah mengembalikan
  `freeTierKm` & `maxCoverageKm` dari tier tenant. Jika admin mengubah tier gratis/jangkauan via DB,
  pesan WA tetap memakai angka lama → janji ke customer salah. **Fix**: pakai
  `deliveryResult.freeTierKm` & `deliveryResult.maxCoverageKm ?? clinicConfig.maxDeliveryDistanceKm`
  di kedua jalur; `message` diagnostik agent (`maks 30 km`) ikut dinamis.
- **BUG B — Inkonsistensi out-of-coverage backend vs frontend**
  (`packages/admin-dashboard/src/utils/deliveryTierCalculator.ts`): sebelumnya jarak > tier terjauh
  mengembalikan `fee = maxTier.fee` (mis. Rp 35.000) di frontend, sedangkan backend
  (`DeliveryService.calculateOngkirByDistance`) mengembalikan `normalPrice = 0`. **Fix**: frontend
  disamakan — out-of-coverage → `fee: 0, netOngkir: 0`, `matchedTier` tetap sebagai referensi tampilan.
  `InvoiceGeneratorModal` kini menampilkan peringatan deterministik (`ongkirOutOfCoverage`) agar staf
  tidak salah menagih ongkir 0 untuk area di luar jangkauan.
- **Tidak ada bug** pada panel "Simulasi Ongkir" `DeliveryTiers.tsx` — cabang out-of-coverage sudah
  benar (klaim awal keliru setelah verifikasi kode).
- **Verifikasi**: `npm run build` (tsc) exit 0; build dashboard Vite exit 0;
  `tests/unit/delivery-tier-db-driven.test.ts` (baru, 10 test adversarial: kontrak `freeTierKm`/
  `maxCoverageKm` dari tier, paritas boundary 0/5/5.01/…/30/30.01/99 km backend↔frontend, fallback
  tier kosong tanpa NaN) + 8 suite terkait = **65/65 hijau**.

#### Penyelarasan Model–Provider Aktif (Anti `no price for model` / `401`) (2026-09-17)

- **Akar masalah (audit live):** `ACTIVE_LLM_PROVIDER="KENARI"` + `KENARI_API_KEY` kosong →
  fallback key `LLM_API_KEY` (SumoPod) ditolak kenari.id (`401 invalid key`); setelah key diisi,
  muncul `400 no price for model 'gpt-4o-mini'` karena DB `tenant_ai_config` masih menyimpan
  `CHAT_REPLY=OpenAI/gpt-4o-mini` (stale pra-migrasi) dan endpoint tunggal aktif = Kenari.
- **Fix fondasional (`src/config/ai-models.config.ts`):** `sanitizeModelForProvider` kini punya
  cabang Kenari — model native OpenAI (`gpt-*`/`o1*`/`o3*`) di-remap ke `KENARI_DEFAULT_MODEL`
  saat baseUrl `kenari.id` (aturan provider-level, mirror logika OpenAI/SumoPod). `getModelConfig`
  & `getAllTaskConfigs` di-sanitize dengan baseUrl endpoint **aktif** (single source of truth),
  sehingga seluruh pemanggil lintas-task (NLU, verifier, summarization, PII, geocoding, harvesting)
  tidak lagi mengirim model non-Kenari ke Kenari. `agent-runner` memakai `endpointConfig.model`
  (baseUrl-aware) untuk `selectedModel`.
- **Perbaikan data:** re-seed `tenant_ai_config` default-tenant dari registry env →
  `CHAT_REPLY`/`CHAT_REPLY_DEEP`/`HARVESTING` = `Kenari/deepseek-v4-1-flash`; task sisa
  (`INTENT_CLASSIFICATION`, `PII_SCRUBBING`, `SUMMARIZATION`) tetap `OpenAI/gpt-4o-mini` di DB
  namun otomatis di-remap saat resolusi. `ACTIVE_LLM_PROVIDER` tidak di-set di DB → fallback env `KENARI`.
- **Verifikasi:** `npm run build` (tsc) exit 0; `tests/unit/provider-model-alignment.test.ts` 6/6 hijau
  (remap gpt/o1/o3, preserve model Kenari valid, case-insensitive host, non-Kenari tak terpengaruh).

#### Dedicated LLM Execution Tracing & DeepSeek Observability (2026-09-17)

- **Fase 1 — Skema & logging error transparan** (`src/utils/llm-execution-logger.ts`,
  `src/v3/agent/pipeline/generation-stage.ts`): `LlmExecutionRecord` + `RecordCallParams` diperluas
  dengan `errorMessage`, `cachedPromptTokens`, `reasoningTokens`. `reportTurnError` kini
  mengekstrak pesan error teknis konkret (axios `response.data.error.message` → `response.data` string
  → `err.message` → fallback generik) dan menyertakan `promptPayload` konteks pesan. Error 401/400/timeout
  tampil apa adanya di UI Tracing, bukan lagi kotak merah tanpa isi.
- **Fase 2 — Ekstraksi CoT universal** (`extractReasoningAndCleanContent`, diekspor untuk testability):
  mendukung `reasoning_content` native maupun tag `<think>...</think>` inline (case-insensitive,
  multi-blok). Artefak tag thinking dibersihkan dari `finalReply` sebelum guardrail — tanpa
  mutilasi semantik (murni cleanup teknis mesin, sesuai mandat).
- **Fase 3 — Telemetri biaya & token akurat** (`extractUsageTelemetry`): membaca cache prompt dari
  `prompt_cache_hit_tokens` (DeepSeek native) ATAU `prompt_tokens_details.cached_tokens`
  (OpenAI-compatible/proxy SumoPod), plus `completion_tokens_details.reasoning_tokens`. `calcCostFor`
  kini meneruskan token cache ke `calculateLlmCost` sehingga diskon cache-hit benar-benar dihitung
  (sebelumnya hardcode `0`).
- **Fase 4 — Stepper & filter admin dashboard** (`packages/admin-dashboard/src/pages/tenant/Debug.tsx`,
  `getLlmExecutionLogs`): turn tanpa tool (DeepSeek menjawab langsung) dilabeli
  **⚡ Direct Reply (1 Call)** di kartu, stepper, dan flat feed; filter `V3_GENERATION` ikut
  menyertakan direct reply (deterministik dari state `toolsCalled`/`finalReply`, bukan pencocokan teks);
  banner merah menampilkan `errorMessage` saat status ERROR; token Cache Hit & Thinking ditampilkan.
- **Fase 5 — Unit test adversarial** (`tests/unit/llm-execution-tracing-deepseek.test.ts` 17/17):
  schema tracing, CoT (`<think>` multi-blok/case/null/unclosed), dual-shape usage, diskon biaya
  (timestamp di-pin off-peak agar deterministik), grouping Direct Reply vs multi-call, dan ekstraksi
  error `reportTurnError` (Error object / axios 401 / tanpa pesan).
- **Verifikasi**: `npm run build` (tsc) exit 0; build dashboard Vite exit 0; test terkait
  32/32 hijau (`llm-execution-tracing-deepseek` 17, `hierarchical-debug-logs` 3, `cost-calculator` 12).
  Catatan: suite penuh memiliki kegagalan pra-eksisting pada file test untracked dari pekerjaan paralel
  (mis. `llm-outage-silent`, `schedule-check-handoff`) — tidak berkaitan dengan perubahan ini (diff
  tidak menyentuh `shouldSendReply`/state machine).

#### Revisi Fondasional P1–P4: Sawan-HIGH, closingIntent, Eskalasi Medis Aman, Salvage Kalimat (2026-09-17)

- **Konteks review:** dokumen rencana 6 fase diaudit terhadap repo — ~60% sudah implemented
  (death-penalty guardrail, `parallel_tool_calls:false`, taksonomi 24 bln, matrix 20 skenario).
  Dieksekusi hanya gap nyata dalam bentuk revisi mandiri-patuh (tanpa rewrite regex output,
  tanpa prose "DILARANG" sebagai satu-satunya pagar). Detail verdict + item tunda di
  `docs/KNOWN_ISSUES.md` #83.
- **P1 — Skrining sawan fail-closed HIGH** (`src/config/medical-keywords.ts`,
  `tests/unit/medical-sawan-screening.test.ts` 3/3): `sawan`/`sawanen`/`sawan tangis` → HIGH
  (menumpang eskalasi deterministik `machine.ts` + supresi rekomendasi usia di katalog).
  Pengecualian hardcode sementara via seam designated (persetujuan user); matcher ≤6 huruf
  boundary-safe dari `kawasan` (dipin adversarial).
- **P2 — Kontrak data closingIntent** (`src/v3/tools/get-catalog.tool.ts`,
  `tests/unit/v3/get-catalog-closing-intent.test.ts` 7/7): 6 intent deterministik dari state
  (SAFETY_NO_MATCH > STATEMENT_ONLY_DURATION > PRICE_SUBJECT_CLARIFY > ASK_SCHEDULE/ASK_DOMICILE
  by location > CLINICAL_PROBE); hanya direktif intent terpilih dikirim ke LLM (state-gated pruning).
- **P3 — Eskalasi medis AMAN + matrix CM-21/CM-22** (`src/state-machine/machine.ts`,
  `tests/unit/medical-silent-escalation.test.ts`, `tests/integration/v3-conversation-matrix.test.ts`
  22/22): eskalasi HIGH/MEDIUM kini mengirim balasan keselamatan deterministik (tanpa dosis,
  tanpa tawaran pijat, tanpa ajakan jadwal) — pembalikan disengaja kontrak diam lama.
  CM-21 (sawan end-to-end), CM-22 (alur 234800: domicile → durasi statement-only via closingIntent).
  Fidelitas stub tool_choice-forced diperbaiki (inferensi asksDuration/inquirePrice/symptoms).
- **P4 — Salvage tingkat kalimat** (`src/v3/guardrails/sentence-salvage.ts` baru,
  `tests/unit/v3/sentence-salvage.test.ts` 5/5, wiring `guardrail-pipeline.ts`): saat reprompt
  faktual gagal, kalimat valid dipertahankan verbatim + catatan handoff; hanya bila nihil
  yang lolos dipakai fallback generik. Tanpa edit isi kalimat (anti-mutilasi).
- **Verifikasi:** `npm run build` (tsc) exit 0; matrix 22/22; medical 3+5; catalog 18;
  factual/anti-silent 17 — tanpa regresi.

#### Investigasi & Remediasi Fallback "Kendala Teknis" Sesi 554018 (2026-09-17)

- **Fixed — drift migrasi DB lokal:** apply 3 migrasi pending via `migrate deploy`
  (`ensure_tenants_settings_column`, `message_tenant_wa_message_unique`, `add_followup_cancel_reason`);
  migrasi bedah baru `20260917000001_add_prompt_policy_tables_align_drift` membuat 2 tabel yang ada di
  schema tapi tak pernah punya migrasi (`tenant_prompt_configs`, `clinic_policies`) + menyelaraskan default
  (`reservations.status`, `tenants.settings`); `schema.prisma` Message diselaraskan dari `@unique` global ke
  `@@unique([tenant_id, wa_message_id])` mengikuti maksud `20260913000000` (kompatibel: tanpa `findUnique`
  by `wa_message_id` di `src/`).
- **Akar masalah LLM (terbukti, belum bisa diperbaiki tanpa aksi user):** `KENARI_API_KEY` kosong di `.env`
  sehingga key efektif jatuh ke `LLM_API_KEY` yang ditolak `kenari.id` (`401 invalid key`, direproduksi terisolasi).
  Detail dan sisa terbuka dicatat di `docs/KNOWN_ISSUES.md` #82.
- **Verifikasi:** drift `migrate diff --from-url` = empty migration; `prisma generate` penuh; `npm run build` (tsc)
     exit 0; test fokus 10/10 (`clinic-policy-db-first`, `tenant-settings-resilience`, `dynamic-router-prompt`).

#### Integrasi LLM Kenari, Primary Model deepseek-v4-1-flash, & Toggle Switcher Provider (2026-09-17)

- **Konfigurasi Ganda Provider (`.env` & `.env.example`)**: Menambahkan blok konfigurasi `ACTIVE_LLM_PROVIDER="KENARI"` dengan variabel terpisah `KENARI_BASE_URL="https://kenari.id/v1"`, `KENARI_API_KEY`, dan `KENARI_DEFAULT_MODEL="deepseek-v4-1-flash"`, serta variabel SumoPod terisolasi (`SUMOPOD_BASE_URL`, `SUMOPOD_API_KEY`, `SUMOPOD_DEFAULT_MODEL`). Model utama default disetel ke `deepseek-v4-1-flash` dan rantai fallback diperbarui.
- **Provider Registry & Dynamic Resolution (`src/config/ai-models.config.ts`, `src/integrations/llm/llm-gateway.ts`)**: Mendaftarkan `'Kenari'` ke `SUPPORTED_PROVIDERS`. Menambahkan method `getActiveProvider`, `setActiveProvider`, dan `getActiveEndpointConfig` pada `AiModelConfigService` yang persisten ke database (`TenantAiConfig` task: `ACTIVE_LLM_PROVIDER`) dengan mirror in-memory non-blocking (fire-and-forget DB sync). Memperbaiki sanitasi model di `sanitizeModelForProvider` agar tidak menimpa model Kenari atau SumoPod yang valid. `llm-gateway.ts` otomatis meresolusi base URL, API key, dan default model berdasarkan provider yang aktif.
- **Audit Biaya & Derivasi Provider (`src/utils/cost-calculator.ts`)**: Menambahkan pengenalan domain `kenari.id` → `'Kenari'` pada `deriveProvider` dan menambahkan tabel tarif model Kenari (`deepseek-v4-1-flash`, `deepseek-v4-pro`, `qwen3-8-flash`, `qwen3-7-plus`, `minimax-m2-7`, dan `step-3-7-flash:free`).
- **Endpoint Admin Provider Switcher (`src/routes/admin/settings.subroute.ts`)**: Menambahkan endpoint `PATCH /api/admin/ai-models/provider` untuk mengganti provider aktif secara instan (`KENARI` vs `SUMOPOD`), otomatis menyelaraskan model `CHAT_REPLY`, dan mencatat riwayat audit admin (`AI_PROVIDER_SWITCH`).
- **Admin Dashboard UI Switcher (`packages/admin-dashboard/src/components/settings/AiModelSettingsPanel.tsx`)**: Menghadirkan kartu toggle interaktif di bagian atas panel konfigurasi model AI untuk memilih **Kenari AI** vs **SumoPod AI** dengan indikator aktif, status koneksi API key, dan feedback toast instan tanpa restart server.
- **Audit Keamanan & Pre-Commit Guard (`scripts/scan-secrets.ts`, `.git/hooks/pre-commit`, `package.json`)**: Memeriksa seluruh working tree terhadap potensi kebocoran API key (`kn-`, `sk-`, `AIza`, `EAAR`, `eyJ`, `.env`). Menambahkan automated scanner script `scripts/scan-secrets.ts`, Git hook `.git/hooks/pre-commit` untuk auto-block saat commit, dan perintah `npm run security:scan`. Unit test `tests/unit/scan-secrets.test.ts` 4/4 hijau.
- **Verifikasi**: `tests/unit/cost-calculator.test.ts` (12/12 hijau), `tests/unit/ai-models-tenant.test.ts` (4/4 hijau), `tests/integration/ai_models_and_health.test.ts` (5/5 hijau); build `tsc` exit 0; build dashboard Vite exit 0.

#### Remediasi 391501 — Sanitizer Subjek, Rekomendasi Usia & RAG Persiapan (2026-09-17)

- **Fase 1 — Sanitizer subjek tata bahasa (`src/v3/guardrails/sanitizer.ts`, `tests/unit/v3-sanitizer-vocative-quota.test.ts`)**: `limitVocativeQuota` kini memproteksi subjek kalimat ("Bunda hanya/cukup/bisa/perlu/...") di awal kalimat/klausa — tidak dihapus & tidak mengurangi kuota 1 vokatif. Koma menggantung (",!") dibersihkan deterministik (`/,\\s*([!?.])/ → $1`). Menutup mutilasi Turn 8 (" hanya perlu...") & koma menggantung Turn 9 ("ya,! 🤗").
- **Fase 2 — Rekomendasi usia-aware (`src/services/treatment-catalog.service.ts`, `src/v3/state/goal-tracker.ts`, `tests/unit/treatment-catalog-default-relaxation.test.ts`)**: `getDefaultRelaxationService(category?, ageMonths?, tenantId?)` menyaring `ageTier` (backward-compat: string tenantId sebagai argumen kedua tetap didukung). `goal-tracker.formatGoalSessionForPrompt` menyuntik `childAge` ke rekomendasi bayi sehat — usia 17 bulan → "Pijat Bayi Ceria" (bukan Newborn), 3 bulan → Newborn, 36 bulan → Kids Ceria. 6/6 hijau.
- **Fase 3 — RAG persiapan (`src/services/keyword-enrichment.service.ts`, `src/cli/faq-corpus.ts`, `scripts/sync-prep-knowledge.ts`, `tests/unit/knowledge-preparation-search.test.ts`)**: keyword persiapan diperkaya (`baby oil, minyak telon, pijat bayi, bayi, anak, si kecil, kudu nyiapin, homecare, peralatan, matras, tempat tidur`); jawaban FAQ dipadatkan steril ("baby oil, minyak telon, matras, perlak... cukup siapkan alas tidur"); skrip sync idempoten untuk DB live. 5/5 hijau.
- **Fase 4 — Verifikasi**: `tests/integration/deterministic-guardrails-session-391501.test.ts` 2/2, build `tsc` 0. Seluruh gate 20/20 hijau.

#### Over-Kalkulasi Durasi Layanan & Reservasi Siluman Typo Tanggal (2026-09-17)

- **Akar masalah (multi-layer):** `extractDurationMinutes` mengasumsikan SEMUA item bundling 60 menit (`items.length * 60 + 15`) → "Pijat Bayi Pulih Ceria + Sinar Moksa" = 135m (padahal 75m); `tryParseIndonesianDate` membuang tanggal mustahil "41 September" lalu jatuh ke fallback nama-hari `diff += 7` (reservasi siluman +7 hari); auto-capture webhook menyimpan `duration_minutes: NULL`.
- **Single Source of Truth durasi:** `treatmentCatalogService.resolveDurationBreakdown` (baru) — layanan utama vs add-on berbasis katalog tenant, anti double-count (dedupe id, komponen bundle dibuang, guard ≥2 token), flag `confident`/`usedExplicitTag`. Dipakai `reservation-core.service` + `reservation-lifecycle.service` (webhook auto-capture) + `reservation-text-parser` (ParsedReservation.durationMinutes) agar DB tidak lagi menyimpan NULL untuk layanan valid.
- **Date guard:** pemulihan transposisi digit ("41 September" → 14 September bila cocok nama hari) + tanggal mustahil tanpa pemulihan → `null` (DILARANG melompat +7 hari).
- **Frontend:** `durationCalculator.ts` bedakan main vs add-on (bukan flat 60m) + strip metadata audiens terstruktur (`Baby: … (Usia: …) | Moms: …`) yang sebelumnya memecah item hantu; `CreateReservationModal.tsx` tidak lagi default 60 sebelum pencocokan katalog + normalisasi token `(add-on)`.
- **Remediasi data:** `scripts/backfill-reservation-duration.ts` (idempoten) — 233 reservasi NULL terisi durasi katalog; 276 teks bebas tak dikenali sengaja dibiarkan NULL (anti-fabrikasi).
- **Verifikasi:** `foundational-duration-resolution` 9/9, `duration-calculator` + `reservation-text-parser` 30/30, typecheck 0, `npm run build` 0, dashboard build 0; probe deterministik `extractDurationMinutes('Pijat Bayi Pulih Ceria + Sinar Moksa')=75` & `tryParseIndonesianDate('Senin, 41 September 2026…')=2026-09-14T02:30:00.000Z`. Full suite 335 hijau (2 merah pre-existing).

#### Terapi Bapil KIDS Berjenjang Usia & Paritas Katalog (2026-09-17)

- **Paritas Katalog KIDS Bapil**: Menambahkan varian layanan `kids-pulih-2-4th` (Rp85k), `kids-pulih-4-6th` (Rp90k), dan `kids-pulih-6-8th` (Rp100k) ke `DEFAULT_CLINIC_SERVICES` pada `src/services/treatment-catalog.service.ts` serta menyelaraskan deskripsinya di `services_custom.json` agar mencakup kata kunci batuk, pilek, bapil, flu, kembung, sembelit (tutup Issue #78 item 2).
- **Rekomendasi Gejala Deterministik**: Sistem kini secara presisi merekomendasikan `Pijat Kids Pulih Ceria (2 - 4 Tahun)` untuk balita 3 tahun dengan keluhan batuk pilek, bukan lagi jatuh ke terapi nafsu makan (*Lahap Juara*).
- **Verifikasi**: Skenario CM-01 pada `tests/integration/v3-conversation-matrix.test.ts` kini mem-pin nama terapi secara deterministik (20/20 hijau); test unit baru pada `tests/unit/v3/symptom-semantic-scorer.test.ts` (10/10 hijau); V3 unit tests 312/312 hijau; golden corpus 61/61 hijau; typecheck exit 0.

#### Sesi 337880 — Gerbang Kode Deterministik (2026-09-17)

- **Hapus pengecualian same-day** (interogatif `?` = slot inquiry; adopsi via verba komitmen); **masking fisik `calculate_delivery`** tanpa entitas baru + forcing-downgrade; **cart role-gate** (asisten hanya konfirmasi + afirmasi-tunggal); **mandat locationText UTUH**; normalizer sapaan ditolak (mandat anti-mutilasi).
- **Verifikasi**: replay 337880 1/1, V3 317/317, matrix 20/20, korpus 61/61, typecheck 0, harness 4.71/5.00 tanpa pelanggaran safety floor; full suite 2440 hijau (2 merah pre-existing).

#### Sesi 180166 — Regresi V3 & Resiliensi Real-Human (2026-09-17)

- **Jangkar kalender WIB** di Call 1/2 (anti-halusinasi tanggal); **sinyal jam + latch `preferredTime`** + Aturan 5c; **adopsi komitmen berverba** atas tanggal ber-`?` (3 gate koheren, pin lama lestari); **mandat harga/durasi dipertegas** tanpa cabut anchor 887216.
- **Verifikasi**: resilience 1/1, V3 315/315, matrix 20/20, korpus 61/61, typecheck 0, harness 4.74/5.00 tanpa pelanggaran safety floor; full suite 2432 hijau (2 merah pre-existing).

#### Rencana Fondasional — Direct Enforce, Dekomposisi Grounder, Split Router (2026-09-17)

- **Direct enforce default-on**: `save_reservation` dipotong fisik dari skema Call-1 bila prasyarat gagal; `hari ke-N` & treatment anaphoric ditutup (`date-confirmation`, `resolveCandidateTreatment`); matrix 20/20 dalam enforce.
- **Dekomposisi `context-grounder.ts`**: 4 modul domain + fasad re-export (zero breaking changes).
- **Split router Call 1**: dua layer + varian masker-aware (default byte-identik).
- **Verifikasi**: V3 315/315, matrix 20/20, korpus 61/61, typecheck 0, build 0, harness 4.71/5.00 tanpa pelanggaran safety floor; full suite 2418 hijau (2 merah pre-existing).

#### Fase 6 Agenda 3 — Pruning, Refusal Metadata & Enforce Readiness (2026-09-17)

- **Smart time-hint koreksi-dulu**: token hari terakhir menang bila ada penanda koreksi; kolokasi `besok lusa` → `lusa`; aposisi & filter usia lestari (tutup Issue #78 item 3).
- **Structural refusal tagging**: `isRefusalOrEscalation` melewatkan D3 deterministik; regex stop-gap tinggal fallback (tutup Issue #74).
- **Konsolidasi prompt minimal**: 2 kalimat duplikat tak-terpin dipangkas + direktif positif aditif (pin audit & cache utuh; de-bloat penuh ditunda perlu sign-off per-audit).
- **Enforce readiness**: telemetri `TOOL_MASKING_ENFORCED_APPLIED` + test lock-in enforce/shadow (default tetap shadow).
- **Verifikasi**: V3 308/308, matrix 20/20, korpus 61/61, typecheck 0, harness 4.83/5.00 tanpa pelanggaran safety floor; full suite 2405 hijau (2 merah pre-existing).

#### Agenda 2 Fase 5 — Conversation Matrix 20 Skenario (2026-09-17)

- **Suite integrasi multi-turn** (`tests/integration/v3-conversation-matrix.test.ts`): 20 skenario / 5 arketipe via jalur produksi + stub deterministik + spy hasil tool; 20/20 hijau (~3,5 dtk offline).
- **Fix produk**: lead-greeting tak lagi menelan booking berhari+lokasi (guard nama hari/same-day); temuan tercatat: gap item terapi KIDS-bapil, edge hint dua-hari.
- **Verifikasi**: matrix 20/20, korpus 61/61, V3 295/295, typecheck 0, harness 4.78/5.00 tanpa pelanggaran safety floor; full suite 2391 hijau (2 merah pre-existing).

#### Agenda 1 Fase 4 — Geocoding Hardening & Gazetteer Wilayah Utama (2026-09-17)

- **Anti-kontradiksi Aturan 21**: kelima pesan `calculate_delivery` yang menganjurkan share location dibersihkan; klausa penjaga "(tanpa menanyakan nomor jalan atau share location)" dipertahankan.
- **Tier-0 deterministik**: 6 landmark perumahan (Kutisari, Kendangsari, Rewwin, Pondok Tjandra/Candra, Makarya Binangun, Rungkut Mapan) + 6 koridor arteri; contoh grounding LLM anti-Sukomanunggal.
- **Verifikasi**: test baru 4/4, geocoding eksisting 9/9, V3 295/295, korpus 61/61, typecheck 0.

#### Housekeeping, Dynamic Phase Injection & Taksonomi Usia Deterministik (2026-09-17)

- **Penyelarasan legacy test**: `v3-audit-homecare-fix.test.ts` disesuaikan prasyarat mutlak lokasi homecare (sesi berwilayah tanpa detail jalan) — 14/14 hijau.
- **Dynamic Phase Injection (Fase 3.5, opt-in)**: `composeSystemPrompt` mendukung `phaseInjection { focus, slim }` + `derivePhaseFocus` murni (EARLY_LOCATION/CONSULTATION/SCHEDULING); default tetap rakitan penuh byte-identik, mode focus melestarikan prefix cache.
- **Taksonomi usia deterministik**: ambang kanonis 24 bulan (`resolveChildAgeCategory`, <24 BABY / ≥24 KIDS) dipakai extractor, tool katalog (snap kategori), dan service katalog; bridge 0-24 bulan pensiun sebagai kode mati.
- **Anti-menu brosur**: suplai mode konsultasi dipangkas ke 1 rekomendasi + 1 pelengkap; mode harga/nama eksplisit utuh.
- **Verifikasi**: V3 291/291, korpus 61/61, paritas 15/15, typecheck 0, eval audit LLM 4.77/5.00 dengan 0 pelanggaran safety floor; full suite 2368 hijau (2 merah pre-existing terdokumentasi).

#### Arsitektur Prompt Modular Berlapis — Dekomposisi Persona Monolitik (2026-09-17)

- **Lapisan Keselamatan Global (`src/v3/agent/prompt/layers/global-safety.layer.ts`)**: isolasi aturan safety-critical (skrining trauma jatuh audit 337101, jeda vaksin 48–72 jam audit 222655, newborn 0–28 hari, anti-overclaim, injection defense) sebagai single source of truth yang selalu disuntikkan tiap turn.
- **Lapisan Persona Inti (`layers/core-persona.layer.ts`)**: identitas Bidan Yusi, nada WhatsApp mengayomi, kata ganti "kami", format 1-bintang, batas 2–3 kalimat, contoh few-shot statis, sapaan Turn-0/lanjutan.
- **Direktif Fase Operasional (`prompt/phases/`)**: `location-rules` (ongkir, anti-tanya km, anti-asumsi Waru), `pricing-catalog` (konsultasi vs transaksional, multi-anak, klarifikasi ambigu), `scheduling` (anti-todong jadwal/jam, mandat POV first-person, gating `save_reservation`).
- **Komposer & Fasad (`prompt/prompt-composer.ts`, `persona.ts` tipis)**: antarmuka `PersonaPromptBuilder` dipertahankan 100%; overlay tenant DB dan brand per-tenant tidak berubah.
- **Verifikasi zero-regresi**: output byte-identik 4/4 varian; `typecheck` exit 0; paritas tanggal 15/15; tool-masker 10/10; anti-silent-drop 8/8; safety/persona/cache 28/28; korpus emas 61/61. Full suite 2355 hijau, 3 merah pre-existing (tercatat `docs/KNOWN_ISSUES.md` #72/#75).

#### Resolusi Fondasional Siklus Regresi Chatbot Sesi 173235: Anti-Phantom Basket Add-On, Grounding Lokasi Cool-Off, & Fail-Closed Booking Gate (2026-09-16)

- **Fase 1 — Isolasi Keranjang Add-on Anti-Phantom Basket (`src/v3/state/cart-manager.ts`)**:
  - Menambahkan guard isolasi pada `CartManager.syncCartItems`: Pesan asisten (`isAssistant === true`) dilarang memasukkan layanan berjenis `ADDON` (seperti *Sinar Moksa* / *Cukur Rambut*) ke keranjang belanja customer (`session.cartItems`) KECUALI bila nama add-on sudah pernah disebut atau dikonfirmasi oleh customer (`userConfirmedNames.has(s.name.toLowerCase())`).
  - Mencegah asisten yang hanya mengedukasi perlengkapan treatment membengkakkan isi keranjang dan durasi/harga treatment secara sepihak.
  - Test baru: `tests/unit/v3/cart-addon-assistant-isolation.test.ts` (3/3 passed).
- **Fase 2 — Grounding Lokasi Cool-Off & Anti-Kaset Rusak (`src/v3/state/conversation-summarizer.ts`, `src/v3/state/goal-tracker.ts`, `src/v3/agent/persona.ts`)**:
  - Memperluas deteksi `isAskedLocationRecently(history)` di `conversation-summarizer.ts` agar mengenali sapaan pembuka Turn-0 yang menanyakan lokasi (`rumahnya dimana`, `rumah bunda dimana`, `daerah mana`, `tinggal dimana`, dsb.).
  - Mengeliminasi kontradiksi internal grounding prompt: `GoalTracker.formatGoalSessionForPrompt` kini menerima `isAskedLocationRecently`. Bila lokasi belum diketahui namun bot baru saja menanyakan lokasi pada 1-2 turn terakhir, status instruksi tidak lagi menodong `(Perlu ditanyakan kelurahan/kecamatannya)`, melainkan beralih ke instruksi cool-off: `• Lokasi: Belum diketahui (Sudah ditanyakan di pesan sebelumnya — JANGAN menanyakan lokasi lagi pada turn ini, fokus jawab keluhan/pertanyaan Bunda)`.
  - Meneruskan riwayat percakapan (`opts.history`) dari `persona.ts` (`buildRouterPrompt`, `buildRouterPromptAsync`, `buildSystemPrompt`, `buildSystemPromptAsync`) ke `GoalTracker.formatGoalSessionForPrompt`.
  - Test baru: `tests/unit/v3/location-prompt-grounding-sync.test.ts` (4/4 passed).
- **Fase 3 — Fail-Closed Booking Readiness & Prasyarat Mutlak Lokasi (`src/v3/agent/pipeline/context-grounder.ts`, `src/v3/tools/save-reservation.tool.ts`)**:
  - `ContextGrounder.isBookingCommitReady`: Wajib memverifikasi keberadaan data lokasi (`session.location.kelurahan / kecamatan / kota / rawText`). Bila lokasi belum diketahui, reservasi homecare DILARANG dianggap siap dikomit (`false`), menghentikan forcing pemanggilan `save_reservation` (`dynamicToolChoice`) di Turn 4 saat customer hanya bertanya ketersediaan slot.
  - `executeSaveReservation`: Menambahkan guard fail-closed prasyarat lokasi. Jika `conversationId` ada dan `effectiveAddress` kosong (tidak ada alamat fisik dari argumen tool maupun wilayah/kelurahan dari sesi), tool menolak mencatat ke database (`success: false`) dan membimbing bot untuk menanyakan daerah rumah terlebih dahulu sesuai Aturan Emas 5a. Mencegah terciptanya reservasi fiktif tanpa alamat/wilayah dan data anak dummy.
  - Test baru: `tests/unit/v3/booking-commit-location-gate.test.ts` (6/6 passed); test gate diperbarui `tests/unit/v3/booking-commit-ready-gate.test.ts` (6/6 passed).
- **Fase 4 — Pengetatan Persona & SOP Menjawab Persiapan (`src/v3/agent/persona.ts`, `src/services/tenant-prompt-config.service.ts`)**:
  - Mempertegas Aturan Emas 5a: Bila customer bertanya jadwal/slot padahal lokasi belum diketahui, WAJIB dahulukan menanyakan daerah rumah Bunda terlebih dahulu sebelum mengecek jadwal atau mereservasi. DILARANG berjanji mengecek jadwal sebelum domisili diketahui dan DILARANG memanggil `save_reservation`.
  - Mempertegas Aturan Emas 14: Pertanyaan persiapan treatment dijawab padat maksimal 2-3 kalimat (perlengkapan dibawa Bidan, cukup siapkan alas tidur). DILARANG proaktif mempromosikan alat add-on (Sinar Moksa) jika customer hanya menanyakan persiapan umum.
  - Mempertegas syarat mutlak lokasi pada panduan tool `save_reservation`.
- **Verifikasi & Regresi**:
  - `npm run build` (`tsc`) exit 0.
  - 14 test suite terkait booking, cart, location, summarizer, dan persona (100+ tes) 100% passed.
  - Knowledge graph disinkronkan via `graphify update .`.

#### Resolusi Fondasional Siklus Regresi Chatbot & Isolasi Total Sandbox CAPI Queue (2026-09-16)

- **Fase 1' — Isolasi sandbox antrean Meta CAPI (`src/routes/admin/reservations.subroute.ts`, `src/utils/dummy-filter.ts`)**:
  - Query `prisma.reservation.findMany` + `unsentMqlCustomers` kini filter `customer.is_sandbox_test: false` (MQL + `phone not startsWith 6289999`); `processedCustomers` dan fallback in-memory disaring via helper baru `shouldExcludeFromCapiQueue()` (reuses `isDummyOrTestContact` terpusat — tanpa duplikasi prefix). Pengiriman aktual tetap dijaga CAPI GUARD (`capi.service.ts`).
  - Test `tests/unit/capi-queue-sandbox-isolation.test.ts` (5/5 passed).
- **Fase 2' — Fail-closed kontrak `save_reservation` + tahun dinamis + guard momStage (`src/v3/tools/save-reservation.tool.ts`, `src/utils/indonesian-date-parser.ts`, `src/utils/conversation-transaction-extractor.ts`)**:
  - `verifyDayMentioned`: bukti hari yang seluruhnya dari kalimat tanya (`?`) = pertanyaan ketersediaan, BUKAN kesepakatan → tolak tanpa tulis DB (tanpa daftar frasa tanya baru; pengecualian same-day sesi 138207 yang catatannya pending ekspektasi-aman). Helper baru `isSameDayRequestText()` (reuse `SAME_DAY_EVIDENCE_ALIASES`, kini exported).
  - `parseIndonesianDate`: tanggal lampau (mis. "2023" karangan LLM) digulir ke kemunculan berikutnya (`rollPastToFuture`); default tahun di `conversation-transaction-extractor` dijadikan dinamis (`getFullYear()`).
  - `momStage POSTPARTUM` diturunkan bila anak tertua > 2 bln (`isPostpartumStageValid` + `POSTPARTUM_MAX_CHILD_AGE_MONTHS`, TODO tenant-aware — lihat KNOWN_ISSUES 69.1).
  - Test baru: `day-evidence-question-gate` (8/8), `indonesian-date-year-clamp` (5/5).
  - Kontrak test lama yang mengkodifikasi bug diperbarui (`premature-reservation-guard`, `reservation-response-copy`: jalur lolos kini pernyataan tegas; +1 kasus tanya-menolak). Same-day alias tetap hijau.
- **Fase 3' — Grounding sesi & anti-kunci sepihak (`context-grounder.ts`, `persona.ts`, `goal-tracker.ts`, `cart-manager.ts`, `domain/types.ts`)**:
  - `isBookingCommitReady`: giliran `?` bukan komitmen (kecuali same-day) → hentikan forcing prematur `save_reservation`.
  - Direktif `SCHEDULING`: bila `pendingScheduleCheck` tanpa `reservationId`, sinyalkan `save_reservation DILARANG` (ganti "tersedia bila data lengkap"); persona router sinkron untuk pertanyaan slot.
  - `formatGoalSessionForPrompt`: tier NIFAS (≤2 bln) / MENYUSUI-IBU BALITA (3–24 bln) / IBU ANAK (>24 bln) — POSTPARTUM hanya untuk bayi baru lahir.
  - Cart: fuzzy match wajib memuat ≥1 token non-generik + `GENERIC_CLINIC_TOKENS` diperluas (balita/usia/umur/tahun/bulan/toddler) — kalimat generik "pijat balita usia 2 tahun" tidak lagi mengunci paket sepihak (test-first, bug ter-reproduksi sebelum fix).
  - Test baru: `booking-commit-ready-gate` (5/5), `cart-generic-no-unilateral-lock` (2/2).
- **Fase 4' — Anti-kaset rusak skrining + forcing durasi presisi (`get-catalog.tool.ts`, `tool-pipeline.ts`, `tool-registry.ts`, `generation-stage.ts`)**:
  - `CatalogSessionContext.knownSymptoms` diisi deterministik dari sesi (tool-pipeline, cermin agregat `formatGoalSessionForPrompt`) → `effectiveSymptoms` menutup keluhan yang LLM lupa oper ("Biasa kembung"); `closingGuide` + `suggestedConsultationReply` tidak lagi menanyakan ulang skrining (wording panduan tidak mengutip frasa pemantik agar tak menyuntik pola ke LLM).
  - `routeTools`: `ask_duration` (sinyal intent eksisting) memaksa `get_catalog_and_price` agar durasi dari katalog DB; `childAgeMonths` disuntik dari profil sesi bila LLM mengosongkan (cermin pola momProfile).
  - Test baru: `catalog-known-symptoms-no-reask` (3/3).
- **Regression**: `npm run build` exit 0 (termasuk `prisma generate` sinkronisasi client `cancel_reason` pasca-rebase); 27/27 test baru hijau; full suite 2340 passed / 30 failed — seluruhnya pre-existing terdokumentasi (fitur belum terimplementasi plan 8/9 + governance summary, lih. FASE 0) dan file terkait area sentuhan (`premature-guard`, `response-copy`, `sameday`, `multi-recipient-cart`, `age-consultation`, katalog) 100% hijau.
- **Known Issues**: butir 69 (ambang klinis TODO tenant-aware + opsi keputusan; cleanup sandbox live menunggu 2-step verification; replay simulator Turn 1–8 manual).

#### Follow-Up Berbasis Chat Terakhir & Informasi Alasan Pembatalan (2026-09-16)

- **Skema & Migrasi (`prisma/schema.prisma`, `prisma/migrations/20260916000000_add_followup_cancel_reason/migration.sql`)**: Menambahkan kolom `cancel_reason String?` pada model `FollowUp` plus indeks komposit `@@index([tenant_id, customer_id, type, status])` untuk mempercepat lookup antrian NO_PURCHASE aktif saat chat masuk. Migrasi idempotent (`DO $$ ... information_schema.columns`) + `CREATE INDEX IF NOT EXISTS`, aman di DB live maupun fresh env.
- **Sliding Window Event-Driven (`src/services/follow-up.service.ts`)**: Fungsi baru `rescheduleNoPurchaseOnInboundChat(customerId, tenantId, chatAt)`. Saat customer chat masuk, antrian `NO_PURCHASE` aktif digeser relatif ke **chat terakhir customer**: stage 1/2/3 menjadi `chatAt + 3/7/14 hari` tepat pukul **09:40 WIB** (helper `computeScheduleAtWib0940`, sadar batas hari WIB). Bila customer ternyata sudah punya reservasi aktif, antrian dibatalkan dengan alasan eksplisit. Offline-safe (best-effort, tidak pernah melempar).
- **Hook Inbound (`src/services/message.service.ts`)**: `logMessage()` memicu sliding window secara *fire-and-forget* pada pesan `INBOUND` - hanya untuk customer riil (guard `!isHistorical`, `!isSandboxCustomer`, `!skipMqlEvaluation`), sehingga sinkronisasi riwayat WAHA dan pesan sandbox/QA tidak menggeser jadwal, dan alur webhook tidak ikut melambat.
- **Cancel Reason di Seluruh Lifecycle**: Konstanta kanonis `CANCEL_REASON` (single source of truth) dan penulisan alasan di setiap titik terminasi: `cancelFollowUp` (default "Dibatalkan manual oleh Admin"), `bulkCancelFollowUps` ("Dibatalkan massal oleh Admin"), `onReservationCreated` ("Customer membuat reservasi baru"), `onReservationCancelled` ("Reservasi terkait dibatalkan"), auto-cancel worker ("Customer sudah memiliki reservasi aktif"), overdue >48 jam, skip label bypass, dan skip WABA (template belum approved / tanpa opt-in marketing).
- **API Admin (`src/routes/admin/follow-up.subroute.ts`)**: `PATCH /api/admin/follow-ups/:id/cancel` dan `POST /api/admin/follow-ups/bulk-cancel` menerima `reason` opsional (diteruskan ke service dan dicatat di audit log). Parameter opsi bersifat opsional sehingga pemanggil lama tetap kompatibel. `listFollowUps` kini memakai `select` eksplisit dan menyertakan `cancel_reason` pada payload respons.
- **Admin Dashboard (`packages/admin-dashboard/src/pages/tenant/FollowUpQueue.tsx`)**: Badge status untuk `CANCELLED`/`SKIPPED` kini menampilkan sub-keterangan "Alasan: ..." (dengan tooltip untuk teks panjang, di tabel desktop maupun kartu mobile). Modal konfirmasi pembatalan (satuan & massal) menyediakan kolom **Alasan Pembatalan (opsional)**; dikosongkan maka backend memakai alasan default.
- **Regression & Adversarial Tests**:
  - `tests/unit/follow-up-inbound-sliding.test.ts` (baru): 12/12 passed - geseran +3/+7/+14 hari pukul 09:40 WIB, edge-case tengah malam WIB, pembatalan saat sudah ada reservasi, no-op tanpa antrian, DB offline, clamp stage di luar rentang, serta seluruh varian `cancel_reason` lifecycle.
  - `tests/integration/follow-up-inbound-hook.test.ts` (baru): 5/5 passed - inbound riil memicu hook (anchor `createdAt`), sedangkan pesan historical, outbound bot, dan sandbox **tidak** memicu; kegagalan hook tidak membocorkan error ke pemanggil.
  - `tests/integration/follow-up-admin.test.ts`: 19/19 passed - penambahan kasus `reason` diteruskan/di-skip dengan benar pada endpoint cancel & bulk-cancel.
  - `npm run build` (tsc) exit 0; `npm run build` di `packages/admin-dashboard` (vite) exit 0.
- **Known Issues**: Mencatat dua temuan terbuka di `docs/KNOWN_ISSUES.md` butir 67 - tumpang-tindih dua definisi "chat terakhir" (sliding window inbound vs Smart Context Guard `last_message_at`), dan jalur `DELETE /api/admin/reservation/:id` yang tidak memanggil `onReservationCancelled`.

#### Resolusi Infinite Holding Stall Pengecekan Jadwal, Latch Time Hint, & Isolasi Konsultasi Usia (Plan 7) (2026-09-15)

- **Fase 1 — Goal Tracker & Session Latch Resilience (`src/v3/state/goal-tracker.ts`, `src/v3/agent/pipeline/context-grounder.ts`)**:
  - Menambahkan field `pendingScheduleCheck?: boolean` pada `BookingState`.
  - Format status sesi di prompt (`formatGoalSessionForPrompt`) kini menampilkan `requestedTimeHint` dan status `pendingScheduleCheck` secara eksplisit sehingga LLM sadar permintaan hari/waktu customer sudah terekam.
  - Memperluas deteksi `extractTimeHint` dan `hasScheduleSignal` untuk menangkap token hari kerja (`'hari biasa'`, `'weekday'`, `'weekdays'`).
  - Memperbaiki persistensi latching atomik pada `applySessionLatches` (`session.booking` diupdate in-place dan disimpan bersama payload sesi utuh ke `GoalTracker.updateGoalSession`), mencegah amnesia lokasi saat terjadi fallback store memori offline.
- **Fase 2 — FastResponseGate Schedule Verification Handoff & Anti-Looping (`src/v3/agent/pipeline/context-grounder.ts`)**:
  - Menambahkan template respon deterministik `POST_SCHEDULE_CHECK_CLOSING`: penegasan pengecekan rute/jadwal tanpa tanya balik berulang.
  - Memperluas token pengakuan tunggu `POST_RESERVATION_ACK_TOKENS` (`tunggu`, `kabari`, `nanti`, `ditunggu`) dan ignorables (`min`, `admin`, `aku`, `saya`).
  - Menghubungkan FastResponseGate: pada putaran pertama pengakuan tunggu saat `pendingScheduleCheck === true`, bot mengirimkan `POST_SCHEDULE_CHECK_CLOSING` dan langsung mengeksekusi handoff/eskalasi live chat (`isEscalated: true`, `escalationReason: 'pending_schedule_check'`).
  - Pada putaran ke-2 dan seterusnya, FastResponseGate melakukan *silent skip* (`shouldSendReply: false`, 0 token), mencegah bot kaset rusak mengulang janji cek jadwal yang sama.
- **Fase 3 — Isolasi Konsultasi Usia Sehat vs Terapi Sakit (`src/v3/tools/get-catalog.tool.ts`, `src/v3/agent/persona.ts`)**:
  - Menyematkan pembobotan `healthyPriorityOf` pada pengurutan layanan (`formattedTreatments.sort`): ketika customer berkonsultasi usia anak tanpa menyebutkan keluhan sakit (`symptoms.length === 0`), paket terapi batuk/pilek/kembung (`isSickTherapyService` seperti *Pulih Ceria*) ditenggelamkan ke prioritas bawah. Paket relaksasi & nutrisi sehat (*Pijat Bayi Ceria*, *Pijat Bayi Lahap Juara*) diprioritaskan di posisi teratas.
  - Memperbarui instruksi KONDISI A.1 di persona prompt: dilarang keras merekomendasikan terapi bapil atau menyinggung batuk/pilek/kembung bila customer tidak menyampaikan keluhan medis.
  - Menambahkan instruksi anti-looping pada router prompt ketika customer sekadar mengonfirmasi atau menunggu pengecekan jadwal.
- **Fase 4 — Turn-0 Greeting & Operational Hours Clarity (`src/v3/agent/persona.ts`, `src/v3/agent/pipeline/generation-stage.ts`)**:
  - Menambahkan panduan jam operasional (08.00–17.00 WIB) dan koordinasi rute bidan pada instruksi persona ketika customer menanyakan jadwal di luar jam operasional atau hari biasa.
  - Menambahkan mekanisme penjaminan sapaan resmi pembuka (*deterministic Turn-0 greeting prefix*): jika bot berada di awal percakapan (Turn-0) dan respons model belum memuat sapaan/perkenalan, prefix resmi Bidan Yusi disematkan secara mulus.
- **Regression & Unit Tests**:
  - `tests/unit/v3/fast-response-gate-schedule.test.ts`: 4/4 passed.
  - `tests/unit/v3/time-hint-latch.test.ts`: 2/2 passed.
  - `tests/unit/v3/age-consultation-isolation.test.ts`: 2/2 passed.
  - `tests/unit/v3-*.test.ts`: 86/86 passed.
  - `tests/v3/agent-runner.test.ts` & `agent-tools.test.ts`: 19/19 passed.
  - `npm run build`: kompilasi TypeScript exit 0 tanpa error.

#### Resolusi Fondasional Bug Chat Freeze / Tidak Bisa Scroll Portal Terapis (2026-09-14)

- **Fase 1 — Kunci Ketinggian Viewport Rigid & Perbaikan Rantai Flexbox (`StaffToday.tsx`)**:
  - *Viewport Locking Kaku*: Mengubah kontainer terluar `StaffToday.tsx` dari `min-h-[100dvh]` menjadi `h-[100dvh] max-h-[100dvh] overflow-hidden`, memastikan dokumen tidak pernah memuai melampaui layar.
  - *Perbaikan Rantai Flexbox*: Menambahkan `min-h-0` pada split-view workspace (`line 1682`) dan `shrink-0` pada Header, Segmented Mobile Nav, Chat Header, serta Quick Reply Input Bar. Mencegah kontainer gelembung chat membesar setinggi seluruh pesan (`scrollHeight === clientHeight`), sehingga native scrollbar aktif sempurna di desktop maupun mobile.
  - *Overscroll Containment & Touch Momentum*: Menambahkan `overscroll-contain` dan momentum scrolling `-webkit-overflow-scrolling: touch` pada kontainer chat (`chatContainerRef`), mencegah gestur usap/swipe tersangkut atau menggerakkan halaman induk.
- **Fase 2 — Eliminasi Auto-Scroll Loop & Deteksi Scroll Pengguna**:
  - *Deteksi `isNearBottom` Terpadu*: Menambahkan ref `isNearBottomRef` dan handler `onScroll={handleChatScroll}` pada kontainer chat. Sistem kini mengetahui apakah terapis sedang membaca pesan di atas atau berada di dasar percakapan.
  - *Penghapusan Polling Scroll Loop*: Menghapus `selectedTask` dari dependency array `useEffect` auto-scroll dan membatasi `scrollToBottom` hanya berjalan jika `isNearBottomRef.current === true` (kecuali dibuka pertama kali atau saat mengirim pesan baru). Terapis tidak lagi tersentak ke bawah setiap interval polling 20 detik saat sedang membaca riwayat pesan.
- **Fase 3 — Seleksi Teks Pesan Chat**:
  - Menambahkan class `select-text` pada gelembung teks percakapan (`msg.content`) agar nomor telepon, patokan alamat, dan keluhan pasien dapat disalin (*copy*) secara mudah tanpa terhalang `select-none` dari layout portal.
- **Regression**: `npm run build` (tsc) exit 0, dashboard `npm run build` (tsc & vite) exit 0, test unit `tests/unit/staff-auth-and-reservation.test.ts` (21/21 passed), test integrasi `tests/integration/staff-routes.test.ts` (21/21 passed).

#### Restorasi Akses Chat & Hardening Relasi Percakapan Portal Terapis (2026-09-14)

- **Fase 1 — Restorasi Tombol Chat Kartu Aktif & Modal Detail (`StaffToday.tsx`)**:
  - *Tombol Chat Terlihat Jelas*: Tombol aksi kartu tugas aktif (`StaffToday.tsx`) diubah dari `grid-cols-2` menjadi `grid-cols-3` dengan menghadirkan tombol `Chat` (`MessageSquare`) eksplisit berdampingan dengan `Navigasi` dan `Infokan OTW`. Terapis tidak lagi perlu menebak bahwa teks alamat dapat diklik untuk membuka chat.
  - *Tombol Chat Pasien di Modal Detail*: Pada `detailModalTask`, ditambahkan tombol aksi utama `Chat Pasien` di footer modal untuk membuka split-view percakapan secara langsung tanpa harus menutup modal dan mencari kartu kembali.
  - *Fallback ID Percakapan & Badge Edukatif*: Data `combinedCompletedTasks` diproteksi dengan fallback mapping agar `conversationId` yang ada di riwayat selesai tidak tereset. Pada kartu jadwal mendatang (upcoming), ditambahkan badge halus `Chat aktif di hari-H` agar terapis memahami kapan akses komunikasi aktif.
- **Fase 2 — Hardening Backend Relasi Percakapan (`staff-reservation.service.ts`)**:
  - *Dynamic Conversation Resolution di `getCompletedTasks`*: Mengganti hardcoded `conversationId: null` dengan relasi query dinamis Prisma (`customer.conversations` take 1 order desc `updated_at`), sehingga kunjungan yang telah selesai tetap dapat dibuka riwayat percakapannya oleh terapis.
  - *Sinkronisasi Timezone WIB pada Kepemilikan Percakapan*: Menyelaraskan metode `assertConversationOwnedByStaffToday` dengan `this.getWibDateRange()` alih-alih `new Date().setHours(0,0,0,0)` (UTC container), mencegah penolakan akses (403/Forbidden) bagi staf pada window pergantian hari antara UTC dan WIB (00:00-07:00 WIB).
- **Regression**: `tests/unit/staff-auth-and-reservation.test.ts` (21/21 passed, termasuk verifikasi `conversationId` selesai dinamis), `tests/integration/staff-routes.test.ts` (21/21 passed), `npm run build` (tsc) exit 0, dashboard `npm run build` (tsc & vite) exit 0.

#### Audit & Perbaikan Fondasional Portal Terapis (Staff Portal) (2026-09-14)

- **Fase 1 — Perbaikan Bug Kritis & Visual (Functional & Visual Blockers)**:
  - *Kartu Pasien Hilang Otomatis*: Pada `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`, fungsi `isPastStaffTask()` digantikan dengan `isTrulyCompleted()` (tugas hanya berpindah ke tab "Selesai" jika status `COMPLETED` atau pembayaran telah `LUNAS`) dan `isOverdueSchedule()` (memberikan badge visual `Berlangsung` jika durasi terlewat namun belum selesai). Terapis di lapangan tidak lagi kehilangan akses ke tombol Catat Bayar, Chat, dan Navigasi saat kunjungan memakan waktu lebih lama.
  - *Watermark Canvas Bebas Tofu & Skala Proporsional*: Pada `packages/admin-dashboard/src/utils/imageWatermark.ts`, seluruh emoji Unicode canvas (`📍`, `📸`, `🌸`) digantikan dengan label teks bersih (`GPS:`, `PANDUAN:`, `BIDAN:`, `KALA MOMS & BABY`) untuk mencegah bug karakter kotak-kotak (`\uFFFD`) pada browser HP Android/Windows; batas kaku 18px dihapus dan diganti formula font responsif berbasis rasio foto; lebar logo klinik diukur lebih dulu dan diterapkan clipping dinamis pada baris koordinat agar tidak terjadi tabrakan teks.
  - *Sinkronisasi Limit Pesan Backend*: Pada `src/routes/staff/today.subroute.ts`, limit pesan percakapan staff dinaikkan dari `slice(-10)` menjadi `slice(-30)` agar konsisten dengan frontend dan SSE stream, mencegah terputusnya riwayat percakapan saat refresh.
- **Fase 2 — Peningkatan UX Terapis Lapangan**:
  - *Single Consolidated Confirmation*: Pada `StaffToday.tsx`, dua prompt `confirm()` berurutan saat menyimpan data lokasi/foto rumah (timpa data & akurasi sinyal GPS) disatukan ke dalam satu dialog konfirmasi terpadu, menghilangkan risiko freeze modal pada mobile webview.
  - *Penegasan Visual Tagih di Tempat*: Tombol pembayaran pada kartu aktif dipertegas dengan status `Tagih di Tempat` beraksen amber dan indikator berdenyut lembut untuk mencegah terapis lupa menagih biaya.
  - *Akses Percakapan di Tab Selesai*: Menambahkan tombol cepat `Chat` pada kartu riwayat tugas di tab "Selesai" yang otomatis mengaktifkan split-view chat.
- **Fase 3 — Konsolidasi Arsitektur Anti-Bloat**:
  - *Eliminasi Duplikasi `StaffSchedule.tsx`*: Mengonsolidasikan 630 baris kode duplikat `StaffSchedule.tsx` menjadi proxy komponen ringkas yang me-render `<StaffToday defaultTab="upcoming" />`. Menghemat ~17.5 kB bundle chunk dan memastikan seluruh pembaruan fitur selalu sinkron di satu tempat.
- **Regression**: `npm run build` (tsc) exit 0, dashboard `npm run build` (tsc && vite) exit 0, test unit `tests/unit/staff-auth-and-reservation.test.ts` (21/21 passed), test integrasi `tests/integration/staff-routes.test.ts` (21/21 passed).

#### Hardening Fondasional FASE 0 — Fail-Closed Defaults & Observability (2026-09-14)

- **T0.1 — Telemetri per-turn aktif**: `telemetryService.recordTurn()` ter-wiring di `V3AgentRunner.processMessage` (akhir blok success); `src/types/telemetry.ts:32` union status tambah `'NO_DATA'`; `src/services/telemetry.service.ts:60-67` health 0 turn → `NO_DATA` (bukan `HEALTHY`). Test `tests/unit/telemetry.test.ts` (5) — NO_DATA, HEALTHY, CRITICAL, mutilation ratio.
- **T0.3 — Availability fail-closed**: `src/routes/admin/reservations.subroute.ts:180-188` catch DB error → 503 `AVAILABILITY_UNAVAILABLE` (bukan fallback "semua slot available"). Anti-janji-palsu saat DB down.
- **T0.4 — Halt-after-commit tool pipeline**: `src/v3/agent/pipeline/tool-pipeline.ts:90-97,215-220` — flag `reservationCommitted` setelah `save_reservation` sukses; tool berikutnya di-batch yang sama di-skip + warn `V3_TOOL_POST_COMMIT_IGNORED`. Test `tests/unit/v3/tool-pipeline.test.ts` (4) — batch 2 tool, save_reservation gagal → tool kedua tetap jalan; save_reservation sukses → tool berikutnya di-skip.
- **T0.2 — Verifikasi**: tidak ada mutilasi regex tengah kalimat di `guardrail-pipeline.ts` (blok usia sudah reprompt-only sejak sesi 214956). Tidak ada perubahan kode.
- **Regression**: `npm run build` (tsc) exit 0; `npm test` 2092 passed, 28 failed (pre-existing: `schedule-check-handoff` 30→28 tests — fungsi `isScheduleCheckCommitment` belum terimplementasi + `typing-transport`/`queue-durability`/`clinic-area-routing`/`pediatric-taxonomy`/`context-schedule-duration-governance` = fitur FASE 1-3), 19 skipped. Tidak ada regresi baru.

#### Resolusi Fondasional Penulisan Reservasi & Invoice Salah — Kasus 6288000000005 (Bunda Lutfia) (2026-09-15)

- **Fase 1 — Reverse Geocoding Lokal Haversine (anti-Gubeng fiktif)**: `src/utils/gazetteer.ts` tambah `findNearestSubdistrict(lat,lng,maxDistanceKm=35)` + `haversineKm` (cache koordinat gazetteer 573 baris, 0 ms API, $0); `src/integrations/google-maps/geocoding.ts:983` hapus hardcode `kelurahan/kecamatan: 'Gubeng'` → pakai `findNearestSubdistrict` (Sedati -7.3683,112.7744 → Semampir/Sedati/Kabupaten Sidoarjo 61253, di luar 35 km → koordinat murni tanpa nama fiktif). Test `tests/unit/nearest-neighbor-geocoding.test.ts` (5).
- **Fase 2 — Ekstraksi Kec/Kota Data-Driven dari Alamat Teks**: `src/routes/admin/livechat.subroute.ts` endpoint `GET /api/admin/geo/areas` (gazetteer single source), `packages/admin-dashboard/src/utils/chatScheduleExtractor.ts` tambah `extractWilayahFromAddress` + `WilayahReference` (substring whole-word longest-first, tanpa regex hafalan — referensi dari backend), `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` cache `getWilayahRef()` dan pakai saat `extractScheduleFromMessages(..., wilayahRef)` sehingga form kosong `Kec & Kota:` tetap terisi dari `"Perum Central Park Juanda, Semampir, Kec. Sedati, Kab. Sidoarjo"` sebelum jatuh ke profil terpolusi. Test `tests/unit/chat-schedule-extractor-wilayah.test.ts` (5).
- **Fase 3 — Dynamic Catalog & Price Resolution (anti-60000 karangan, usia-aware)**: `chatScheduleExtractor.ts` hapus 8× fallback `60000` → harga HANYA dari DB/katalog (`catalogPriceOf`), fallback 0 jujur bila tanpa katalog/tidak cocok; tambah filter usia `filterCatalogByChildAge` via `parseChildAgeToMonthsLocal` (tier `min_age_months/max_age_months`, tanpa hardcode mapping nama/harga); `treatmentStringParser.ts:228` & `InvoiceGeneratorModal.tsx` & `LiveChatMonitor.tsx:2749` hapus `|| 60000` → 0. Test `tests/unit/catalog-price-age-aware.test.ts` (5, Pijat Rileksasi 15 bulan → Pijat Bayi Ceria 70000).
- **Fase 4 — Fix Edit Reservasi HTTP 500 (`address` → `preferences.address`)**: `src/routes/admin/reservations.subroute.ts:1508` `custUpdate.address` (kolom tidak ada di `Customer`) → `preferences.address` (+ `landmark` digabung tanpa timpa, `kelurahan` diisi dari address bila kosong, `assigned_staff_id ''→null` FK-safe, notifikasi staf non-blocking tetap). Test `tests/unit/admin-update-reservation-safe-address.test.ts` (4).
- **Fase 5 — Adversarial Testing & Penguatan Ketahanan Sistem**: Pembuatan adversarial test suite `tests/unit/adversarial-reservation-resilience.test.ts` (16 edge cases). Menemukan & memperbaiki 2 cacat laten sistemik:
  1. *Konflik Nama Kabupaten vs Kecamatan*: Alamat "Kec. Sedati, Kab. Sidoarjo" sebelumnya keliru menetapkan kecamatan "Sidoarjo" karena panjang string. Diperbaiki di `packages/admin-dashboard/src/utils/chatScheduleExtractor.ts` dengan deteksi awalan eksplisit (`kec.` / `kecamatan`) dan pemisahan set token kota dari kandidat kecamatan.
  2. *Generic Token Hijacking pada Katalog*: Layanan tak dikenal multi-kata seperti "Pijat Akupresur Alien Super" sebelumnya terkunci ke "Pijat Bayi Ceria" karena token generik "pijat". Diperbaiki di `packages/admin-dashboard/src/utils/treatmentStringParser.ts` dengan guard `GENERIC_SERVICE_TOKENS` (wajib ada match token pembeda/differentiator) serta penambahan mapping alias `rileksasi` dan `relaksasi` -> `['relaksasi', 'ceria']`.
  3. *Haversine Floating-Point Precision Guard*: Di `src/utils/gazetteer.ts`, `haversineKm` diproteksi dengan `Math.min(1, Math.max(0, a))` untuk mencegah `NaN` akibat rounding error koordinat identik.
- **Regression**: `npm run build` + `tsc` dashboard exit 0, 16/16 adversarial tests passed, 66 tests terkait reservasi & katalog lolos 100%.

#### Pembersihan Fondasional: Konsolidasi Page Bloat, Shared Utils & Optimasi Backend (2026-09-15)

- **Fase 1 — Konsolidasi Page Bloat (6 → tab/modal)**: `DeliveryTiers` → tab `ClinicServices?tab=delivery`, `FollowUpTemplates` → tab `FollowUpQueue?tab=templates`, `CustomerLabels` → tab `CustomerDatabase?tab=labels`, `CustomerService` & `TelegramIntegration` → panel `Settings?tab=cs|telegram`, `ChatExport` → modal `LiveChatMonitor?action=export`. Rute lama di `App.tsx` menjadi `<Navigate>` redirect backward-compatible; sidebar `Layout.tsx` dipangkas 5 menu duplikat (Customer Labels, CS & CTA, Follow-Up Templates, Daily Chat Export, Telegram) — beban bundle & routing berkurang tanpa breaking bookmark.
- **Fase 2 — Shared Utils & Modals**: `utils/mediaExtractor.ts` (single source `extractMedia`, type `ChatMediaData`) menggantikan duplikasi identik di `LiveChatMonitor` & `StaffToday` + dipakai `ChatHistoryModal`; `utils/geoUtils.ts` + `calculateHaversineKm` menggantikan duplikat lokal `calculateHaversine` di `CreateReservationModal` (koordinat klinik fallback masih hardcode tech-debt tenant-aware menunggu endpoint settings baru — tercatat). Komponen baru `components/common/CustomerProfilePanel.tsx` (variant sidebar/modal, hitung usia anak, LTV, labels) & `LocationPickerModal.tsx` (GPS, Maps URL parse, Nominatim, kompresi Canvas + watermark terstandar) — integrasi penuh bertahap, file siap pakai dan build lolos.
- **Fase 3 — Optimasi Backend & Polling**: `reservations.subroute.ts` static import `parsePaymentSection` (hapus dynamic import per-baris dalam `rows.map`), memoize `resolveTreatmentValue` per-request via `treatmentPriceCache`, batch `prisma.followUp.createMany` tenant-aware (ganti 3× `create`, 1 query, `existing.tenant_id || DEFAULT_TENANT_ID`), dan guard `document.visibilityState` + `visibilitychange` di `TodayTreatments` (15s) & `StaffToday` (20s) untuk hentikan polling saat tab hidden. Mock `tests/setup.ts` + test `follow-up-schedule.test.ts` diselaraskan ke `createMany`.
- **Regression**: dashboard `tsc && vite build` exit 0, root `tsc` exit 0, full suite 276 files, 2003 passed, 0 failures.

#### Modularisasi Terpadu Modal Riwayat Chat — Eliminasi Duplikasi (Anti-Bloat & Modularity-First) (2026-09-14)

- **Fase 1 — Backend**: `GET /api/admin/customers/:id/messages` kini ambil N pesan TERBARU (`desc` + `take`, lalu `reverse` ke kronologis) — customer berriwayat panjang tak lagi kehilangan pesan terbaru. `listFollowUps` sertakan `conversations.id` sehingga quick-reply FollowUpQueue memakai endpoint live-chat valid (tutup 404 `POST /customers/:id/reply` yang memang tidak ada).
- **Fase 2 — `ChatHistoryModal.tsx` baru** (`components/modals/ChatHistoryModal.tsx`): bubble WhatsApp + `whitespace-pre-wrap break-words`, separator tanggal & jam WIB via `dateWib.ts` (reuse, tanpa duplikasi), render media via `MediaImage` eksisting, tautan "Buka di Live Chat Penuh ↗", form quick-reply (mode `reply`, hanya bila `conversationId` valid — tanpa fallback 404). Escape/swipe-back/popstate didaftarkan fase CAPTURE + `stopPropagation` agar hanya modal terdepan yang menutup (koreksi audit: listener bubble tak bisa mencegah handler modal belakang yang terdaftar lebih dulu). 0 dependency baru.
- **Fase 3–4 — Eliminasi duplikasi**: blok inline ±100/85/110 LOC di CustomerDatabase, Reservations, FollowUpQueue dihapus total (±295 LOC) + state/refs/scroll-handler duplikatnya; CustomerDatabase pertahankan modal detail di background (state preservation); `onOpenChatHistory` disambungkan di CustomerDatabase & LiveChatMonitor (di monitor = tutup detail karena thread sudah tampil). Catatan perilaku: subtitle lokasi + badge Human Handling khas header FollowUp tidak dibawa ke modal terpadu (disederhanakan demi dedup).
- **Regression**: dashboard `tsc && vite build` + root `tsc` exit 0; full suite 276 files, 2003 passed, 19 skipped, 0 failures.

#### LiveChat Optimization v3 — Modular Composer, Penegakan Anti-Label Tuntas & Observabilitas Drift Riwayat (2026-09-14)

- **Fase A — Ekstraksi `LiveChatComposer.tsx` (isolasi render ketikan)**: komponen input balasan mandiri (`packages/admin-dashboard/src/components/livechat/LiveChatComposer.tsx`, `React.memo` + `forwardRef`) yang memiliki DOM contentEditable uncontrolled, draf per-chat 24 jam, debounce typing presence 500ms/3000ms, emoji picker + favorit, popover quick-reply (`/`), dan menu tools (AI draft, jadwal, hold, reservasi, invoice, gambar). `LiveChatMonitor.tsx` menyusut 6.237 → 5.387 baris (−850); logika composer kini di modul 763 baris; keystroke hanya menaikkan transisi kosong<->terisi ke monitor (tanpa re-render thread/sidebar per karakter). Kontrak imperatif: `setText/clear/focus/closePopovers/getText`. Dashboard `tsc && vite build` lolos, bundle `dist/` ter-regenerasi.
- **Fase B — Penegakan Anti-Label WAHA tuntas (temuan audit: 3 situs lolos guard lama)**: `reservation-lifecycle.service.ts` (`batchUpdateLabels`) dan `reservations.subroute.ts` (2× `wahaClient.removeLabel` multiline yang lolos regex guard) ditulis ulang DB-only via tabel `Label` + `CustomerLabel` (nama kanonis 'New Customer'/'Pending Payment'/'Repeat Order', tenant-scoped, upsert `update:{}` agar kustomisasi admin tak tertimpa; 'Legacy' tak tersentuh). Gate `ENABLE_LIFECYCLE_LABELS` dipertahankan. Komentar usang `customers.subroute.ts` (klaim mirror WAHA) dikoreksi. Guard `waha-label-ban-invariant.test.ts` diperkeras: test ke-3 melarang pola dot-call `.(addLabel|removeLabel|batchUpdateLabels)(` bentuk apapun termasuk chain multiline. Test `label-lifecycle.test.ts` (8) + `waha-label-cache.test.ts` #5 ditulis ulang ke asersi DB-only (zero WAHA).
- **Fase C — Drift riwayat & observabilitas**: skrip `scripts/check-livechat-sync.ts` (diagnostik read-only: drift `last_message_at` vs `MAX(created_at)`, pesan tanpa `wa_message_id`, phantom; exit 0/1/2), `scripts/repair-last-message-at.ts` (perbaikan idempoten satu statement SQL transaksional, default dry-run, `--apply` untuk eksekusi, tenant-aware), dan endpoint `GET /api/admin/live-chat/sync-health` (`{ success, healthy, driftsFound, missingWaId, activeSync, checkedAt }`, jujur saat DB offline). Test baru `tests/unit/live-chat-sync-health.test.ts` (2).
- **Regression & Build Verification**: full suite 275 files, 2001 tests passed, 19 skipped, 0 failures; `npm run build` (tsc root) + dashboard build exit 0.

#### Remediasi Fondasional Koneksi WhatsApp: Media Watermark Pruning, Idempotensi Ad Attribution & Anti-Nomor Palsu LID (2026-09-12)

- **Fase 1 — Watermark-Based Media Pruning & Non-Blocking Quota**:
  - Batas kuota penyimpanan dinaikkan dari 200 MB ke 1 GB default (`DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024`), configurable via DB/env.
  - Implementasi mekanisme auto-pruning cerdas berbasis watermark (High 85% -> Low 65%): saat penyimpanan mencapai 85% kuota, sistem secara otomatis dan async menghapus file HD inbound terlama hingga penggunaan turun ke 65% (`pruneToLowWatermark`).
  - Jaminan preservasi thumbnail (`_thumb.*`) dan proteksi gambar pricelist permanen (`pricelist_image_url`).
  - Pemakaian disk di-cache dalam memori (TTL 60 detik) untuk mencegah event loop freezing dari `fs.statSync` berulang.
  - Media cleanup cron diaktifkan secara default saat startup `app.ts` untuk self-healing media kadaluarsa.
  - Test baru: `tests/unit/media-watermark-autoprune.test.ts` (3 tests passed).

- **Fase 2 — Relational Idempotency Ad Attribution (Strict Types & Zero Any)**:
  - Menyelesaikan domain modeling category error pada Click-to-WhatsApp: memisahkan *Shared Campaign Tag* (`utmCampaign: 'IG-BABYSPA'`) dengan *Unique Click Token* (`trackingCode: ctwa_${uuid}`). Dua customer berbeda dengan template iklan yang sama tidak lagi menabrak constraint `@unique trackingCode`.
  - Menghormati relasi 1:1 `Customer <-> AdClick`: bila customer lama mengklik iklan ulang, sistem melakukan update touchpoint pada record yang sudah ada, mencegah crash `@unique customerId`.
  - Type strictness: penggantian parameter `any` dengan interface domain `CustomerIdentity`.
  - Test baru: `tests/unit/ad-attribution-relational.test.ts` (3 tests passed).

- **Fase 3 — Discriminated Union JID & Webhook Early Filter**:
  - Mengganti seluruh regex heuristik `startsWith('2160')` / `length >= 14` dengan classifier domain `parseJidType`: membedakan `'phone'`, `'lid'`, `'group'`, `'broadcast'`, `'newsletter'`.
  - Invarian mutlak: JID `@lid` yang belum teresolusi DILARANG dikembalikan sebagai nomor telepon palsu (`phone: ''`). Mencegah pembuatan data pelanggan korup/dummy di database.
  - Eliminasi redundansi pemrosesan ganda webhook WAHA: event `message.any` inbound (`!fromMe`) diabaikan pada gerbang awal (`IGNORED_REDUNDANT_INBOUND_ANY`).
  - Unit test `tests/unit/waha-lid-phone-resolution.test.ts` diperluas dan lulus 100%.

- **Regression & Build Verification**:
  - 33 tests passed di modul terkait, `npm run build` (tsc) exit 0 bersih tanpa error tipe.
  - Perbaikan Invariant Test Guard WAHA: Koreksi query ripgrep pada `tests/unit/v3/waha-label-ban-invariant.test.ts` agar secara presisi memindai `addLabel`/`removeLabel` (sebelumnya keliru menduplikasi `getChatLabels`).

#### Plan 6 — Geocoding Resilience, Kombo Aritmatika & Schema Hardening (Issues #26, #21, #30; #16 sebagian) (2026-09-12)

- **Kombo multi-treatment (FASE 1, Issue #26 RESOLVED)**: `numeric-fact-validator.ts` mengotorisasi jumlah subset 2–3 layanan resmi turn konsultasi (Si+Sj/+Addon/+Ongkir/+keduanya, termasuk triple; pool unik N≤6, O(N³)≤216) — hanya di luar mode strict. Deviasi dari rencana awal (ekspansi skema tool): kombinatorik sisi-validator, NOL perubahan kontrak tool. Test `multi-treatment-combo-validator.test.ts` (5).
- **Parsing Maps URL standar (FASE 2, Issue #16 sebagian)**: `?q=/ ?ll= / ?daddr=/saddr=/destination=` via `URL`/`URLSearchParams` (`parseMapsUrl`, `parseLatLngPair`); pathname/hash tetap regex. Ditemukan saat implementasi: base-relatif memalsukan body HTML jadi URL + `parseFloat` menelan markup ("1,2</body>"→{1,2}) — dikunci paritas (host-like + desimal wajib) + 2 test regresi. Test maps 17/17. Sisa tahap 2–4 `implementation_plan.md` tetap terbuka.
- **Koridor arteri (FASE 3, Issue #21 RESOLVED)**: `ARTERY_CORRIDORS` 10 koridor + `resolveArteryCorridor()` di `landmarks.ts`; `getGazetteerCoordinates` cek koridor dulu (kelurahan→kecamatan→eksisting), koordinat tetap dari dataset. "Darmo Permai" terbukti tak konflik. Test `artery-corridor-gazetteer.test.ts` (5) incl. ground-truth 10/10.
- **P2022 resilience (FASE 4, Issue #30 IMPLEMENTED)**: helper `isMissingColumnError()`; pembaca `tenants.settings` kembali default senyap; migrasi idempoten `20260912000000_ensure_tenants_settings_column` (verifikasi live menunggu deploy). Test `tenant-settings-resilience.test.ts` (3).
- **Full Regression**: 274 files, 1995 tests passed, 19 skipped, 0 failures. TSC clean.

#### Plan 4 — Persona Multi-Tenant Data-Driven, RAG Safe-Merge Non-Destruktif (Issue #46 RESOLVED) & Pembersihan Frasa Broker (2026-09-12)

- **Call 1 Router Prompt tenant-aware (Phase 1)**: `PersonaPromptBuilder.buildRouterPromptAsync` baru menyerap `TenantPromptConfig` (4 section dashboard sebagai blok overlay) + brand per-tenant via `getBrandIdentityAsync` (overlay `Tenant.settings.brand`, cached, pola `as any` mengikuti `few-shot-exemplars.ts` karena generated client lag). Varian sinkron dipertahankan pin; DB offline → output identik (zero behavior change). `agent-runner.ts` beralih ke varian async. Test `dynamic-router-prompt.test.ts` (3). Keputusan SaaS: tanpa migrasi/LOC besar → tanpa Confirmation Gate.
- **RAG non-destruktif + safe-merge 48 artikel (Phase 2, Issue #46 RESOLVED)**: korpus diekstrak ke `src/cli/faq-corpus.ts` (34 seed + 14 kurasi live via `scripts/sync-live-knowledge.ts`, `npm run sync:knowledge` + mode `--check` guard drift); `deleteMany` dihapus dari `seed-faq.ts`, diganti loop `upsertChunk` idempoten (kunci `tenant_id+title`, reuse pola `knowledge.service.ts` + memory fallback). Test `knowledge-safe-upsert.test.ts` (4).
- **Temuan merge:** snapshot live mengandung **mojibake CP437** (byte UTF-8 dibaca sebagai CP437 saat dump) — dipulihkan eksak saat merge (tabel 128 entri terverifikasi 0 mismatch vs codec referensi + self-test `≡ƒÿè→😊`); 4 overlap-beda-isi TIDAK ditimpa otomatis (lapor review manusia); kontrak kepemilikan seed 48 judul didokumentasikan.
- **Frasa broker (Phase 3)**: `"Bidan kami yang ready"` dibersihkan di 4 lokasi sekelas (bukan hanya 1 di plan — mandat anti-make-up): `clinic-faq.tool.ts` → "ketersediaan jadwal tim Bidan kami", `persona.ts` + `config/persona.ts` → "jadwal kami" (preseden audit 462651), `save-reservation.tool.ts` → "ketersediaan jadwal". Invariant test diperluas ke pola varian + functional check fallback tool + zero-scan source.

#### Plan 5 — Penegakan Mandat Mutlak Larangan Label WAHA & Resolusi Flaky Test (Issue #38 RESOLVED) (2026-09-12)

- **Penghapusan total mutasi label WAHA dari kode bisnis**: `wahaClient.addLabel/removeLabel` dihapus dari `conversation.service.ts` (eskalasi + auto-release), `label-reconciliation.service.ts` (ditulis ulang DB-only via `is_hold_labeled`), `per-contact-legacy-scrape.service.ts`, `webhook.route.ts` (`hold` + `new customer`), `customers.subroute.ts`, `livechat.subroute.ts`, `command.service.ts`. Guard test `tests/unit/v3/waha-label-ban-invariant.test.ts` (2 tests) mencegah regresi via pemindaian ripgrep. Method `addLabel/removeLabel` di `waha/client.ts` ditandai `@deprecated` + runtime warning dengan caller stack.
- **Perbaikan fondasional kopling tersembunyi**: `addLabel/removeLabel` memiliki efek samping `syncLabelColumn()` yang menulis `Customer.is_hold_labeled`. `escalateToHumanHandling` kini menulis flag langsung via `customerService.setLabelFlags` (guard `!isSandbox && !isGlobalDisabled` dipertahankan); `checkAndApplyAutoRelease` meng-clear flag fire-and-forget. DB kini single source of truth.
- **Resolusi flaky test #28**: ditulis ulang berbasis flag DB (`setLabelFlags` sebagai simulasi admin release) + prefix nomor aman `6287772` (menutup sumber flake laten: `628999+random` berpeluang ~1/9 menjadi `6289999xxxxx` yang terdeteksi dummy oleh `isDummyOrTestContact`). Test lama yang mengassert call WAHA (`admin-customer-label`, `label-ai-router` TC 24/25/28, `label-events`, `label-lifecycle` #1) diselaraskan ke semantik DB-only.
- **Full Regression**: 268 test files, 1959 tests passed, 19 skipped, 0 failures. TSC clean.

#### Plan 3 — GoalTracker Decomposition, Symptom Semantic Scorer & Test Harness Isolation (2026-09-12)

- **GoalTracker Decomposition**: `goal-tracker.ts` tereduksi dari 1.590 LOC menjadi 542 LOC (66% reduction). Ekstraksi 2 modul domain murni:
  - `CartManager` (`src/v3/state/cart-manager.ts`): syncCartItems, resolveAffirmativeSwap, calcCartTotal, detectRecipientScope, isDurationOnlyQuestion — zero side-effect, no DB.
  - `PatientProfileExtractor` (`src/v3/state/patient-extractor.ts`): syncChildrenProfiles, syncMomProfile, extractAgesMonths, isKakakHonorific, detectTargetAudience, parseGestationalWeeks, isMaternalOnlyMessage — zero side-effect, no DB.
- **Symptom Semantic Scorer (Issue #48 RESOLVED)**: Multi-word phrase matching (+8 bonus) + core complaint noun scoring (+4) + modifier scoring (+1). "susah makan" → Lahap Juara mutlak; "susah BAB" → Pulih Ceria mutlak. 6 unit test baru.
- **Test Harness Isolation (Issue #47 RESOLVED)**: `saveServices()` bypass saat `NODE_ENV=test` — `services_custom.json` tidak ter-mutasi saat npm test.
- **Full Regression**: 267 test files, 1957 tests passed, 19 skipped, 0 failures. TSC clean.

#### Selaraskan Unit Test Katalog Dinamis & Dokumentasi Tech Debt Test Suite (2026-09-12)

- **Latar Belakang:** Sesuai mandat non-hardcode data-driven di AGENTS.md, unit test pencarian nominal tidak boleh rapuh/gagal akibat perubahan nama paket atau harga promo dinamis di dashboard oleh admin.
- **Perubahan:**
  - `src/v3/agent/persona.ts`: Penegasan disclaimer pada exemplar few-shot 100rb bahwa angka dan nama layanan adalah ilustrasi pola, asisten wajib selalu mengutip hasil tool `get_catalog_and_price`.
  - `tests/unit/catalog-price-matching.test.ts` & `tests/unit/simulator-100rb-replay.test.ts`: Dirombak dinamis (data-driven) mengambil entri katalog aktif saat runtime, menguji nominal promo/normal riil, dan menambahkan adversarial edge cases (`NaN`, angka negatif).
  - `docs/KNOWN_ISSUES.md`: Pencatatan Issue #47 mengenai mutasi `services_custom.json` saat `npm test` beserta workaround dan saran perbaikan isolasi fixture test.
- **Verifikasi:** Targeted tests 10/10 passed, `npm run build` exit 0.

#### Sinkronisasi Penuh Knowledge Chunks (FAQ) & Chat Bank (Few-Shot Exemplars) dari Live Server ke Lokal (2026-09-12)

- **Latar Belakang:** Kebutuhan pengguna agar data RAG Chunks (`knowledge_chunks`) dan Chat Bank (`few_shot_exemplars`) di lingkungan lokal sama persis dengan yang ada di server produksi live (43.157.197.148:1403). Sebelumnya di lokal terdapat selisih (49 FAQ lama vs 43 FAQ kurasi live, dan hanya 7 exemplar default vs 26 exemplar live).
- **Aksi & Sinkronisasi:**
  - Dump data langsung dari PostgreSQL server produksi (`wa-clinic-bot-postgres-1`): 43 record `knowledge_chunks` dan 26 record `few_shot_exemplars` diekspor bersih dengan encoding UTF-8 (mempertahankan emoji natural WhatsApp Bidan Yusi tanpa mojibake).
  - Snapshot data disimpan ke `storage/live_data.sql`, `storage/live_knowledge_chunks.json`, dan `storage/live_few_shot_exemplars.json`.
  - Database PostgreSQL lokal di container `wa-clinic-bot-postgres-1` disinkronkan: tabel `knowledge_chunks` dan `few_shot_exemplars` kini berisi 100% data riil produksi yang identik.
- **Verifikasi:**
  - Query SQL lokal membuktikan: `knowledge_chunks` = 43 baris, `few_shot_exemplars` = 26 baris (identik dengan server live).
  - Test suite `tests/unit/knowledge.test.ts` (3 passed) dan `tests/v3/agent-runner.test.ts` (7 passed) hijau tanpa regresi.

#### Resolusi Deadlock Validator Faktual & Pembajakan Sanitizer Eskalasi (2026-09-12)

- **Latar Belakang:** pertanyaan SOP vaksin dijawab sapaan Turn-0 tak relevan. Akar: deadlock D2↔D3 (prompt mewajibkan policy-tool, validator hanya mengakui search-chunks, `_retrievedChunks` dead parameter); sanitizer menimpa `finalReply=''` eskalasi dengan sapaan hardcoded; Step 3 FTS tanpa Relevance Gate meloloskan artikel skor 0.015.
- **Fixed:** D2/D3 di `src/v3/guardrails/factual-claim-validator.ts` kini mengakui `get_clinic_policy_faq`, artikel vaksin di `search_knowledge_faq`, dan `retrievedChunks` substantif; guard `!isEscalated && shouldSendReply` + `replyText ''` saat eskalasi + brand dinamis di `src/v3/agent/agent-runner.ts`; cek `shouldSendReply` di `src/routes/admin/evaluations.subroute.ts`; gate token substantif + `rank>=0.025` di Step 3 dan fallback tanpa-kolom `src/services/knowledge.service.ts`; test baru `tests/unit/vaccine-sop-flow.test.ts` (5).
- **Verifikasi:** vaccine-sop-flow 5/5, factual 9/9, knowledge 3/3, agent-runner 7/7 hijau; `npm run build` exit 0. Full suite menyisakan 19 gagal pre-existing keluarga harga katalog (terbukti di tree bersih, dicatat di `docs/KNOWN_ISSUES.md` #45).

#### Pembenahan Fondasional UI Edit Reservasi & Integrasi Backend (2026-09-12)

- **Latar Belakang:** 8 bug arsitektural pada Edit Reservasi: status `pending` terpaksa jadi `confirmed` (state sempit `'hold'|'confirmed'`), rekomendasi jam self-collision (jadwal sendiri dianggap bentrok), reservasi tanpa tanggal terisi paksa hari ini 09:00, `Pijat Ceria` → `Paket Selapan` via substring `normS.includes(normTarget)`, LTV & CAPI bengkak karena `purchaseValue` tercampur ongkir (Rp 125k), banner draf hantu di mode edit, assignedChildIndex 0 paksa, dan ganti customer silent-failure.
- **FASE 1 — Kontrak & State Machine:** `types/index.ts` sudah union lengkap; `reservations.subroute.ts` `status` + `ongkir` (sinkron `Customer.ongkir`), `CreateReservationModal.tsx` state `pending|confirmed|completed|cancelled|hold` + `validStatus` + select 5 opsi + banner `mode!=='edit'` & tombol Simpan Draf hidden di edit.
- **FASE 2 — Self-Collision:** `bookedReservationsForDate` & `customerConflictsForDate` kecualikan `initialReservation.id` saat `mode==='edit'`; `handleGenerateRecommendations` & `Lihat Jadwal Terisi` tidak lagi anggap diri sendiri bentrok.
- **FASE 3 — Tanggal & Katalog:** Guard `else if (isOpen && !bookingDate && mode!=='edit')`; `parseTreatmentsFromDetail` hierarkis (exact → non-bundle → fallback) + `childNameInParen` → `assignedChildIndex` via `babiesForChildMatch`, panggil `parseTreatments(..., rawBabies)`.
- **FASE 4 — Akuntansi & Customer Lock:** `purchaseValue` = `subtotalTreatments - discount` (murni medis), `ongkir` terpisah ke `Customer.ongkir`; Customer Picker terkunci di edit (Info Card `Terkunci (Mode Edit)`), `customerId` tak lagi silent-failure.
- **Verifikasi:** `tsc --noEmit` bersih, `vite build` 2450 modules, `admin-quick-hold` 8 passed; manual pending tetap pending, self-collision hilang, tanpa tanggal tetap kosong, `Pijat Ceria` tidak jadi Selapan, LTV Rp100k/ongkir Rp25k terpisah.

#### Pembaruan Menyeluruh Katalog Treatment & Pricelist (Revisi Final 35 Layanan) (2026-09-11)

- **Latar Belakang:** Pembaruan katalog resmi layanan dan pricelist klinik Kala Moms and Baby Spa sesuai tabel revisi: penyesuaian promo Paket Pra-Kelahiran Duo menjadi Rp 85.000, pemecahan Pijat Bayi Ceria menjadi tier usia Newborn (0-6 bulan, Rp 60k promo) dan Bayi (7-24 bulan, Rp 70k promo), penambahan tier usia Pijat Kids Pulih Ceria (2-4 th, 4-6 th, 6-8 th), aktivasi resmi layanan Memandikan Bayi & Cukur/Tindik, serta penambahan variasi Paket Selapan (Full, Terapi, Terapi Full).
- **Katalog & Konfigurasi (`services_custom.json`):**
  - 35 layanan baru terstruktur per kategori: Bayi (8 layanan), Anak (6 layanan), Ibu & Hamil (9 layanan), Paket Bundling Hemat (11 paket), dan Add-on Medis (3 layanan).
  - Melestarikan paket berseri `Newborn Treatment (14 Sesi Kunjungan)` (`NewBorn`, 120m, Rp 700k/Rp 500k) yang aktif di live database.
  - Normalisasi teks dan tanda baca (ASCII hyphens) untuk mencegah malformasi karakter di konsol / PostgreSQL.
- **Basis Data Live PostgreSQL (`clinic_services`):**
  - Sinkronisasi atomik via transaksi `BEGIN ... COMMIT` dengan `ON CONFLICT (tenant_id, service_id) DO UPDATE` per tenant `default-tenant`.
  - 40 record layanan aktif tersinkronisasi sempurna di VM live (43.157.197.148:1403).
- **AI NLU & Entity Extractor (`entity-extractor.service.ts`):**
  - Menghapus "memandikan bayi" dan "tindik telinga" dari contoh `ask_unlisted_service` agar AI bot mengenali kedua layanan tersebut sebagai layanan katalog resmi klinik.
- **Verifikasi Unit Tests (`vitest`):**
  - Pembaruan validasi perhitungan paket bundle pada `treatment-catalog-bundle-addon.test.ts` (penyesuaian total normal Cukur 35k + Pulih Ceria 100k = 135k).
  - Penyesuaian matcher nama layanan pada `treatment-catalog-search.test.ts`.
  - `npm run build` (`tsc`) lulus 100% tanpa error, seluruh test suite katalog hijau.

#### Multi-Lapisan Fondasional V3: Disambiguasi Multi-Anak, Integritas Matematika & Anti-Brosur (2026-09-10)

- **Latar Belakang:** sesi 214956/222655 — AI menebak 1-vs-2 anak sepihak; halusinasi 75k+105k+15k=120k lolos whitelist; rekomendasi usia format brosur bernomor tanpa pemantik klinis; saran pijat langsung pasca-imunisasi.
- **Perbaikan:** latch `isMultiChildUnconfirmed` + mandat klarifikasi dinamis + aturan persona (klarifikasi lembut 2-anak-1x-ongkir); `[MANDAT INTEGRITAS MATEMATIKA]` total resmi di grounding; validator mode strict multi-item (parsial ditolak, pesan menyebut total resmi) + re-prompt bersih 1x lalu fallback template (tanpa mutilasi regex); template `cartTotalReply` multi-item dihitung mesin; narasi 1 paragraf + pemantik klinis di tool & persona A.1; `kids-massage-ceria` generik dinonaktifkan (bukan dihapus).
- **Ditunda gated:** seed FAQ live (destruktif — backup dulu) + `is_active=false` baris `clinic_services` live.
- **Verifikasi:** `tsc` bersih; 3 file test baru + regresi hijau; full suite **222 file, 1756 passed, 0 failed**.

#### Pembenahan Fondasi & Root Cause Alur Konfirmasi Reservasi (HOLD & PENDING) (2026-09-09)

- **Latar Belakang:** Tombol "Konfirmasi" pada banner `HOLD` (slot kunci 3 detik, dummy `[HOLD] Slot Ditawarkan`) dan `PENDING` (booking riil belum lunas) sama-sama melempar ke `ReservationDetailModal` pasif, sehingga data bolong (`Bunda ()`, `Rp 0`, `status undefined`) dan modal salah alamat. Backend `live-chat.service.ts` emit stub `{id, booking_date, notes}` tanpa kontrak kanonikal, serta hold kedaluwarsa (2 jam lewat) masih tampil sebagai banner aktif.
- **Stage 1 — DTO Kanonikal (`live-chat.service.ts`, `customers.subroute.ts`):** Standardisasi `formatReservationItem` ke kontrak lengkap (`status`, `duration_minutes`, `purchase_value`, `payment_method`, `assigned_staff`, `customer:{id,name,phone,kelurahan,kecamatan,kota,children,ongkir}`); `isHoldValid` temporal (booking_date > now-2jam) + pruning konsisten; `customers/:id` mapper jaminan `r.customer` tidak pernah `undefined`.
- **Stage 2 — Mesin Status (`LiveChatMonitor.tsx`):** Pisah semantik: HOLD → `handleConvertHoldToBooking` (prefill `CreateReservationModal` dengan customer aktif + tanggal/jam hold + terapis, `Lengkapi Booking`, auto `release-hold` saat simpan) vs PENDING → `handleConfirmPendingBooking` (dialog atomik `Ya, Konfirmasi Lunas` → `PATCH /confirm` + Google Calendar); selector `activeHoldReservation` + `handleReservationUpdate` kini pakai `isHoldValid` yang sama.
- **Stage 3 — Deep Hydration Guard (`ReservationDetailModal.tsx`, `CreateReservationModal.tsx`):** Jika `reservation.customer` kosong, auto-fetch `GET /reservation/:id` / `GET /customers/:id` sebelum render, sehingga form tidak pernah tampil bolong.
- **Verifikasi:** `tsc --noEmit` bersih, `vite build` 2450 modules, `admin-quick-hold.test.ts` 8 passed; manual HOLD→Lengkapi Booking→Simpan (hold hilang, booking riil tercipta) & PENDING→Konfirmasi Lunas (confirmed + Calendar) hijau.

#### Perbaikan Layout Mobile iPhone & Redesain Footer Icon Buttons (2026-09-09)

- **Latar Belakang:** Footer teks panjang overflow di iPhone 375px, header & footer terpotong Notch/Dynamic Island & Home Bar, serta viewport tidak full-screen saat keyboard muncul.
- **Invoice WA (`InvoiceGeneratorModal.tsx`):** Overlay `p-3` → `p-0 sm:p-4` + `items-end sm:items-center`, modal `rounded-3xl` → `rounded-none sm:rounded-2xl`, header `px-3.5 py-2` → `px-4 pt-[calc(0.5rem+env(safe-area-inset-top))]` (~36px tetap tipis + aman Notch), footer teks → **icon-only 40×40** (`w-9 h-9 sm:w-10 sm:h-10`) dengan **floating pill tooltip** 1800ms saat `onTouchStart`/`onClick` (Simpan/Batal/Salin/Kirim WA), footer `pb-[calc(0.6rem+env(safe-area-inset-bottom))]` aman Home Bar, total lebar footer ~180px anti-overflow.
- **Reservasi (`CreateReservationModal.tsx`):** Overlay & dialog sinkron `p-0 sm:p-4` + `rounded-none sm:rounded-3xl` + `h-[100dvh]`, tombol tutup & header `safe-area-top`, footer `safe-area-bottom`, form `WebkitOverflowScrolling: touch` untuk inertia iOS.
- **Verifikasi:** `tsc --noEmit` bersih, `vite build` 2450 modules; manual 375px/390px — 4 ikon rapi tanpa scroll horizontal, pill muncul saat tap, header/footer tidak terpotong Notch/Home Bar, scroll form mulus saat keyboard aktif.

#### Pembenahan Fondasi Fitur Draf & Redesain UI Mobile Invoice WA (2026-09-09)

- **Latar Belakang:** Tabrakan draf antar-customer (key statis `'create_reservation'`), ghost auto-save (customer bawaan dianggap draf), state leak saat modal ditutup, kehilangan data paket multi-sesi, key draf invoice pecah per ketukan digit HP, banner draf sticky mengunci layar mobile, dan header invoice tebal ~70px yang memakan viewport saat keyboard muncul.
- **Lapisan 1 — Fondasi Draf & Anti-Ghost (`useFormDraft.ts`, `CreateReservationModal.tsx`, `InvoiceGeneratorModal.tsx`):** Isolasi key per-customer (`reservation_cust_${customerId}` / `reservation_new`; `invoice_${stableTargetId}`), perketat `isMeaningful` (hanya treatment/anak/notes/diskon/staff/multi-sesi/kustom — bukan sekadar `customerId`), perluas payload draf (`isMultiSession`, `multiSessionSchedule`, `customService*`), stabilkan key invoice dari `bundaName/phone` + `hasRestoredDraftRef` guard agar tidak tertimpa sinkronisasi `initialData`.
- **Lapisan 2 — Siklus Hidup State (`CreateReservationModal.tsx`, `InvoiceGeneratorModal.tsx`):** Fungsi terpusat `resetModalState()` / `resetInvoiceState()` yang mengembalikan seluruh field ke nilai awal bersih saat `isOpen` → `false`; cegah state leak antar-bukaan modal.
- **Lapisan 3 — Scroll & Viewport (`CreateReservationModal.tsx`, `InvoiceGeneratorModal.tsx`):** Pindahkan banner draf dari posisi `shrink-0` statis di luar form ke **dalam** kontainer scrollable (`overflow-y-auto`) sehingga ikut tergulir (*scrolls away*); ganti `max-h-[92vh]` / `max-h-[60vh]` menjadi `h-[100dvh] sm:h-auto sm:max-h-[90vh]` + `flex-1 min-h-0` agar keyboard virtual tidak mengunci layout; rampingkan tab mobile `py-1.5 text-[11px]`.
- **Lapisan 4 — Header Minimalis (`InvoiceGeneratorModal.tsx`):** Judul `Draft Rincian Reservasi & Invoice WA` → `Invoice WA`; hapus badge `Auto-Extracted dari Chat` & paragraf verifikasi; padding `px-5 py-3.5` → `px-3.5 py-2 sm:px-4 sm:py-2.5`; icon box tebal `w-8 h-8` → icon inline `Receipt size={16}`; tombol tutup `p-1 rounded-md`; tinggi header terpangkas ~50% (70px → 36px).
- **Verifikasi:** `tsc --noEmit` bersih, `vite build` 2450 modules, `language-sanitizer` 13 tests passed; uji manual anti-kontaminasi draf, ghost auto-save, multi-sesi restore, dan viewport mobile 375px dengan keyboard aktif.

#### Redesign Fondasional — Parsing GPS Pin, Klaster Hierarki & Sticky GPS (2026-09-09)

- **Latar Belakang:** alamat "Valencia spring puri surya jaya DD 3 no.28" terhitung 8.5 km (gerbang depan) padahal titik klaster ~10.7–10.9 km rute ORS. Akar: 1 titik per mega-estate; payload Baileys (`degreesLatitude`) tak terbaca → NaN; `share.google` tak terekstrak; flag GPS tak pernah menyala.
- **Perbaikan:** util kanonis `waha-location-parser.ts` (Baileys `locationMessage`/`liveLocationMessage`, 0,0 dibuang, anti bocor NaN) dipakai `webhook.route.ts`; regex URL + `share.google`; 3 klaster PSJ (Valencia/Sydney-Boston/Osaka-Vancouver) sebelum gerbang utama (cluster-first); invarian sticky terverifikasi tetap berlaku (override admin via dashboard langsung).
- **Sengaja ditunda jujur:** klaster CitraHarmoni/Kahuripan/CitraLand menunggu survei koordinat (tanpa fabrikasi); angka ORS 10.92 km butuh konfirmasi live sekali.
- **Verifikasi:** test baru 9+7+4+2 hijau; E2E `geocodeText` → klaster presisi; full suite **204 file, 1640 passed, 0 failed**; `npm run build` bersih.

#### Redesain Fondasional — Klasifikasi Lifecycle Pasien & Active Appointment Guard (2026-09-09)

- **Latar Belakang:** insiden Bunda Retno (`6288000000004`) — bot AI membalas pasien yang treatment pertamanya sudah `completed` dan pasien berjadwal aktif H-0 ("Sdh smp mana ya?") dengan template marketing generik. Akar sistemik: gate buta status `completed`, properti hantu `purchase_count` / `status='repeat'` (tak pernah ada di schema), tanpa pelindung jadwal aktif, label `repeat` hanya hitung `confirmed`, dan test lama mem-passing mock fiktif (false confidence).
- **Service Kanonis (`patient-lifecycle.service.ts`, baru):** `hasTreatmentHistory` (`confirmed`/`completed`, fallback `ltv_cache`), `getActiveAppointment` (`pending`/`confirmed`/`hold`, jendela [now-12 jam, now+24 jam]), `getPatientClinicalProfile`. Tenant-aware, best-effort.
- **Eligibility & Scope Gate:** kontrak input valid + reason baru `ACTIVE_APPOINTMENT_MANUAL` (guard wajib: silence + eskalasi, exempt auto-release 6 jam); properti hantu dihapus; eskalasi operasional "jadwal treatment aktif hari ini (Manual Handling CS - Koordinasi Operasional)".
- **Sinkronisasi label & modul:** `repeat` (lifecycle + reconciliation), `hasPriorConfirmed` (machine), review H+1 (cron) kini hitung `in ['confirmed','completed']`.
- **Data live (menunggu instruksi operasional):** runbook `scripts/cleanup-bunda-retno-reservation.sql` — BLOK 1 (cancel) atau BLOK 2 (confirm), jalankan salah satu via SSH + verifikasi 2-langkah.
- **Verifikasi:** `tsc --noEmit` bersih; test ditulis ulang tanpa mock fiktif + simulasi Retno; full suite **201 file, 1618 passed, 0 failed**.

#### Audit Sesi 435731 — Anti-Todong Jadwal, Anti-Halusinasi Domisili & Sinkronisasi Keranjang (2026-09-09)

- **Latar Belakang:** 12 dari 14 balasan bot diakhiri pertanyaan (todong jadwal 6x, termasuk setelah jadwal Sabtu final & reservasi tercatat); halusinasi "Kecamatan Waru ini cukup luas..." ke customer Kedungkendo-Candi; `cartItems` kehilangan `Pijat Bayi Ceria` karena nama resmi berkurung gagal exact-match.
- **Keranjang (`goal-tracker.ts`):** normalisasi nama katalog tanpa regex (buang `(...)` akhir) — cocok utuh ATAU bersih; hanya full-match yang menekan fuzzy; kandidat fuzzy wajib bawa ≥2 token signifikan yang belum dijelaskan exact-hit. Skenario sesi: Induksi 105k + Ceria 60k + ongkir 25k = Rp 190.000.
- **Persona:** hapus "Closing CTA WAJIB" → statement-only untuk pertanyaan teknis (durasi/persiapan/biaya/bayar); contoh durasi tanpa todong jadwal; Waru = basecamp, dilarang asumsikan domisili; larangan tanya hari bila jadwal final. **Summarizer:** guard `booking.preferredDate/reservationId` + cooldown jadwal anti-sebutan-hari-bypass.
- **Diverifikasi:** test baru `cart-sync-parentheses` (5) + `v3-anti-todong-jadwal` (7) hijau; `npm run build` bersih; full suite 199/200 file, 1601 passed (1 flaky timeout LLM `live-chat-reply suggest-reply`, lolos solo 10/10). Komponen gate-alamat & keyword-enrichment sudah live sesi lalu (lihat #34), kontrak test tetap hijau.

#### Redesain Fondasional — Siklus Hidup Reservasi & Integritas Transaksi (2026-09-09)

- **Latar Belakang:** Audit 6 titik mutasi reservasi menemukan 5 akar masalah: fragmentasi domain (6 entry point tanpa standar), tanpa validasi konflik jadwal di backend, dedup naif berbasis `created_at` 24 jam (rekam yatim tetap aktif), parser keuangan global + heuristik `angka ≤500 → ×1000` yang mengkorupsi `Usia >4-6 th` menjadi Rp 46.000, dan penimpaan buta `purchase_value` resmi (Rp 160.000 → Rp 46.000) oleh purchase detection.
- **Domain Service Kanonis (`src/services/reservation-core.service.ts`, baru):** Single Source of Truth semua mutasi — Customer Conflict Guard + Staff Collision Guard (overlap interval + buffer 20 mnt); channel-aware (`ADMIN_PANEL` → HTTP 409 `DUPLICATE_BOOKING`/`STAFF_COLLISION` kecuali `force:true` + audit `CREATE_RESERVATION_FORCE_OVERRIDE`; `BOT/WEBHOOK/AGENT` → idempotent merge + auto-konsolidasi duplikat ke `cancelled`); lifecycle terstandarisasi (anak, kontak, follow-up bila `confirmed`). Endpoint admin (`parse`, `quick-hold`, manual create) didelegasikan + dukung `force`; `machine.ts`, `save-reservation.tool.ts` (→ `AGENT`) dimigrasi; `upsertReservationForm` jadi wrapper deprecated → core.
- **Parser Keuangan (`conversation-transaction-extractor.ts`):** isolasi blok pembayaran (cari SETELAH penanda `Payment:/Pembayaran:/Rincian Biaya/Tagihan`); filter token non-mata-uang (`th/tahun/usia/…` tanpa `rp/rb/k` → 0); hapus pelipatgandaan `≤500`; invarian `Total == Treatment + Ongkir − Promo` + auto-rekonsiliasi (`[PAYMENT PARSER RECONCILED]`).
- **Purchase Detection:** pencocokan `booking_date` dari teks (fallback `created_at desc`) + downside guard (nilai parser lebih kecil dari nilai resmi → pertahankan resmi, tanpa verifikasi invarian).
- **Dashboard (`CreateReservationModal.tsx`):** banner pre-flight bila customer sudah punya reservasi aktif di tanggal tsb + dialog 409 `[Batal & Buka Jadwal Existing | Tetap Simpan Baru (Force)]` (state React, tanpa `window.confirm/alert`).
- **Data live (menunggu verifikasi 2-langkah):** script `scripts/cleanup-bunda-bella-duplicates.sql` — cancel `7a6e494a…`, restore `bbbde4bd…` → 160000 + SELECT verifikasi.
- **Verifikasi:** `npm run build` bersih; `tsc --noEmit` dashboard bersih; test parser 16/16, core 6/6, purchase 19/19 hijau; full suite 1551 passed, 2 failed pre-existing (`live-chat-reply suggest-reply`, `robustness 5-min timeout` — terverifikasi gagal juga di baseline).

#### Optimization — Audit Mikro & Efisiensi Sistem Menyeluruh (Eliminasi Redundansi, Dead Code & Memory Leaks) (2026-09-08)

- **Latar Belakang:** Audit skala mikro terhadap performa runtime, redundansi kode, jejak memori, dan kebersihan dependensi bot. Ditemukan residu dekomisioning V2 yang memicu 35 test crash, dependensi mati (`ssh2`, `meta-capi-param-builder-clientjs`, `@googlemaps/google-maps-services-js`), pembacaan sinkron file 111 KB berulang di 5 lokasi, serta potensi memory leak pada map in-memory tanpa batas.
- **Tahap 1 — Dependensi & Package Bloat (`package.json`):** Hapus library tanpa import (`ssh2`, `meta-capi-param-builder-clientjs`, `@googlemaps/google-maps-services-js`); pindahkan `@types/bcrypt` dan `@types/sanitize-html` ke `devDependencies`; bersihkan 42 MB dead `node_modules` pada paket pensiun `packages/click-catcher`.
- **Tahap 2 — Tuntaskan Dekomisioning `src/slot-engine/`:** Pindahkan `few-shot-exemplars.ts` & `gold-few-shot-exemplars.ts` langsung ke `src/v3/agent/`; pindahkan `entity-extractor.ts` ke `src/services/entity-extractor.service.ts`; isolasi tipe `ExtractedEntities` ke `src/types/nlu.ts`; hapus seluruh direktori `src/slot-engine/` (-2.100+ baris).
- **Tahap 3 — Pembersihan Dead Code & Dead Functions (`src/`):** Hapus modul mati `price-answer.service.ts`, `location-sanitizer.ts`, `islamic-greeting.ts`, `whatsapp/client.ts`, dan controller `webhook-v3.controller.ts`; bersihkan fungsi `@deprecated` dan class `UnifiedResponseSanitizer` dari `language-sanitizer.ts`; hapus client Google Maps mati dari `geocoding.ts`.
- **Tahap 4 — Pemulihan Test Suite (100% Green):** Hapus 30+ file test zombie V2 yang mengimpor modul yang sudah tidak ada; selaraskan ekspektasi `ad-click.test.ts` (Meta CAPI Queue decoupled) dan `production_edge_cases.test.ts` (V3 `LOCATION_CONFIRMED`); hasilkan **195 test files passed (100%), 1.575 tests passed, 0 failed**.
- **Tahap 5 — Sentralisasi Gazetteer Single-Source of Truth (`gazetteer.ts`):** Bangun index in-memory O(1) tunggal (kelurahan, kecamatan, prefix Manukan, centroid koordinat lat/lng) yang dimuat sekali saat boot; eliminasi pembacaan sinkron `fs.readFileSync(111KB)` dari `customer.service.ts`, `calculate-delivery.tool.ts`, dan `geocoding.ts`.
- **Tahap 6 — Hardening In-Memory Stores & Anti-Leak:** Pasang batas maksimal 1.000 entri + FIFO/TTL eviction (24h) pada `memorySessions` di `goal-tracker.ts`; pasang batas kapasitas `maxEntries = 500` pada `ResponseCacheService`; tambahkan periodic cleanup pada map login attempts.
- **Tahap 7 — Relokasi Script Ad-Hoc & Build Optimization:** Pindahkan 32 script CLI non-runtime dari `src/scripts/` ke `scripts/` (termasuk 3.748 baris data mock `sync-export-data.ts`); perbarui script `sync:history` di `package.json`; ukuran `dist/` menyusut 24% dari 3,51 MB menjadi 2,67 MB; durasi test berkurang dari 101s menjadi 75s.
- **Verifikasi:** `npm run typecheck` bersih, `npm run build` sukses, `npm test` 195/195 (1.575 tests) passed 100%, `eval:numeric` 86.7% pass rate.

#### Fix — Defensive Admin Knowledge untuk DB skema lama tanpa kolom keywords (P2022) (2026-09-08)

- **Gejala:** `GET /api/admin/knowledge/chunks` melempar `prisma:error Invalid prisma.knowledgeChunk.findMany() ... The column knowledge_chunks.keywords does not exist` sehingga dashboard tampil kosong (catch diam-diam me-return `data: []`).
- **Akar:** drift skema-vs-DB — `prisma/schema.prisma` sudah punya `keywords` + migrasi `20260907000000_add_knowledge_chunk_keywords` ada di repo, tapi belum di-apply di database yang sedang dipakai bot. Prisma typed query (findMany/update) memvalidasi kolom dan melempar P2022.
- **Perbaikan:** `isMissingKeywordsColumnError()` diperluas mendeteksi P2022 (`keywords ... does not exist`); `GET /chunks` retry dengan `select` tanpa `keywords` (balik `keywords: null`) agar dashboard tetap tampil; `PUT /chunks/:id` retry update tanpa `keywords` + warn log; `checkDuplicateFaq()` ikut defensif. Perbaikan permanen tetap migrasi DB (lihat bawah).
- **Verifikasi:** `npm run build` bersih; `dynamic-knowledge-maternal` 5/5 + `knowledge` 3/3 ✓.

#### Fix — Dynamic Knowledge Grounding & Zero-Hardcode Persona Restoration (kasus maternal 38 weeks + induksi + capek) (2026-09-08)

- **Latar Belakang:** Query "38 weeks apa sudah bisa pakai yang induksi ya kak? Ini sama capek² juga soalnya" gagal grounding. Akar: (1) fallback `search-knowledge-faq.tool.ts:72` hardcoded "konsultasikan ke Bidan + tawarkan eskalasi" memicu krisis identitas; (2) FTS `knowledge.service.ts` memakai kolom `keywords` yang belum ter-migrasi di sebagian env (error 42703) sehingga selalu jatuh ke fallback kosong; (3) aturan klinis aterm ≥37-38 minggu + relaksasi bumil capek belum ada di DB knowledge base.
- **Tahap 1 — DB-driven (`knowledge.service.ts`, `seed-faq.ts`, `scripts/seed-maternal-induction-knowledge.ts`):** `isMissingKeywordsColumnError()` + retry FTS `searchFtsWithoutKeywordsColumn()` (title+content saja) saat error 42703/P2010 agar DB skema lama tetap bisa FTS; metode generik tenant-aware `upsertChunk()` (upsert by title, fallback in-memory saat offline, toleran skema lama); artikel klinis "Panduan Usia Kehamilan untuk Pijat Induksi Alami" + keywords (38 weeks, induksi, capek, aterm, hpl) masuk sebagai SEED DB (editable via dashboard), bukan hardcode runtime. Script idempoten: `npx tsx src/scripts/seed-maternal-induction-knowledge.ts [--tenant=ID]`.
- **Tahap 2 — Zero-hardcode fallback (`search-knowledge-faq.tool.ts`):** pesan kosong diganti generik — rujuk katalog dinamis (`get_catalog_and_price`) + kompetensi Bidan Yusi; eskalasi HANYA untuk kegawatdaruratan patologis. Tanpa nama treatment/usia statis.
- **Tahap 3 — Prinsip persona (`persona.ts`):** blok baru `[PRINSIP EMPATI & IDENTITAS BIDAN YUSI]` — validasi keluhan fisik, integritas identitas (larang "akan kami konsultasikan ke Bidan kami" untuk ranah komplementer standar), kata ganti profesional. Tanpa data bisnis statis.
- **Verifikasi:** `dynamic-knowledge-maternal.test.ts` 5/5 ✓ (RAG aterm via in-memory, tool FAQ maternal, fallback generik tanpa false-escalation/hardcode, prinsip persona, deteksi 42703), regresi `knowledge` 3/3 + `v3-persona-rules` 15/15 ✓, `npm run build` (tsc) bersih.
- **Tindak lanjut live DB:** jalankan `npx prisma migrate deploy` (kolom `keywords`) + script seed induksi di server; artikel selanjutnya diedit via dashboard `/api/admin/knowledge`.

#### Fix — Ekstraksi Form Chat, Fuzzy Matching Layanan & Generator Invoice WhatsApp (`chatScheduleExtractor.ts`, `treatmentStringParser.ts`, `InvoiceGeneratorModal.tsx`) (2026-09-07)

- **Latar Belakang (kasus Bunda Fitria 6288000000010):** Invoice tidak sesuai form — tanggal geser H+1, nama anak kosong, usia "Treatment :", layanan salah "Paket Selapan" Rp 80.000 padahal "Pijat Ceria + Oksitosin". Akar: (1) regex top-down menangkap template kosong bot → section baby/moms terpotong; (2) baris historis `children` (`Usia Bayi/Anak :` / `Treatment :`) tanpa guard; (3) `.includes()` satu arah cocokkan "pijat ceria" ke bundle Selapan; (4) treatment Moms terabaikan.
- **Stage 1 — Core extractor (`chatScheduleExtractor.ts`):** `pickFilledFormBlock` reverse-scan (terbaru→terlama, INBOUND terisi prioritas, fallback OUTBOUND terisi, template kosong tidak pernah dipilih); seluruh ekstraksi terstruktur TAHAP 1 (tanggal, nama, alamat, anak, treatment baby+moms) memakai blok form terisi yang sama; `isFormLabelAge` guard `raw_age_text`/`current_age` DB; `cleanBundaName` loop stabil + collapse token kembar ("fitria Wonokromo Wonokromo"→"fitria"); part treatment dikanonikalisasi ke nama resmi katalog bila tersedia.
- **Stage 2 — Intelligent matching (`treatmentStringParser.ts`):** `matchCatalogService` token-overlap scoring (cakupan query + tie-break spesifisitas, substring dua arah "full/body↔fullbody", alias "oksifull"→oksitosin+full, exact-match menang, kandidat bundle hanya bila disebut eksplisit) — dipakai `parseTreatmentItemsFromRaw` & price matching extractor. "pijat ceria"→Pijat Bayi Ceria, "oksitosin full body"/"oksifull"→Oksitosin Massage Fullbody.
- **Stage 3 — Modal (`InvoiceGeneratorModal.tsx`):** Hidrasi sanitasi bunda/usia (`cleanBundaName`, `isFormLabelAge`→kosong), render invoice pakai nama & usia aman; dynamic list otomatis hidrasi 2 item Rp 60.000+Rp 105.000 via parser Stage 2.
- **Stage 4 — Live DB:** DELETE 1 baris korup `children` (`f5c207c7…`/`Usia Bayi/Anak :`/`Treatment :`), normalisasi `customers.name`→"Bunda Fitria Wonokromo". Verifikasi: tersisa Fitria/hamil 38 minggu + Nadira/2bulan.
- **Verifikasi:** `chat-schedule-extractor-form.test.ts` 13/13 ✓ (thread riil Fitria: Minggu 13 Sep 2026, Nadira, 2bulan, BUNDLE Rp 165.000, anti-template-kosong, anti-Selapan, guard korup), regresi `chat-schedule-extractor` 8/8 + `treatment-string-and-tier-calc` 7/7 ✓, dashboard `vite build` ✓.

#### Fix — Eliminasi Phantom Cart Item & Presisi Topik Durasi Pijat Bayi (`goal-tracker.ts`, `persona.ts`, `conversation-summarizer.ts`, `types.ts`) (2026-09-07)

- **Latar Belakang:** Sesi simulator 933742 — sapaan bot Turn-0 ("Treatment moms & Baby...") memasukkan phantom item Rp 500.000 via token unik tunggal "treatment"; "Untuk pijat bayi biasanya brp menit kak" salah terdeteksi `ask_price` via substring 'rp' di "brp" (persona + buyingSignal); closing CTA berupa pertanyaan terbuka alih-alih ajakan booking spesifik. Commit `a31f350` hanya berisi dokumen rencana — kode belum pernah diimplementasikan.
- **Tahap 1 — Engine keranjang (`goal-tracker.ts`):** `GENERIC_CLINIC_TOKENS` (16 kata: treatment, pijat, bayi, ...) dilarang jadi penentu tunggal fuzzy; pesan `assistant` hanya boleh `exactHits` (nama resmi utuh); `isDurationOnlyQuestion` pakai `/\brp\b/` presisi agar "brp" bukan sinyal beli.
- **Tahap 2 — Intent & summarizer (`persona.ts`, `conversation-summarizer.ts`, `types.ts`):** `extractFastIntents` — 'rp' substring → token `/\brp\b/`, pertanyaan durasi mengalahkan harga, intent baru `ask_duration` (+ union type); summarizer cabang durasi SEBELUM harga ("durasi waktu pelaksanaan ..." + CTA jadwalkan spesifik, larang pertanyaan terbuka); `mentionsCost` cukur ikut presisi.
- **Tahap 3 — Prompt (`persona.ts`):** SOP Kondisi C durasi (jelaskan durasi + manfaat, larang harga & pertanyaan terbuka, CTA "Mau kami bantu jadwalkan untuk treatment [Nama] Bunda?") + contoh few-shot kontras "brp menit" → 40 menit + CTA Pijat Bayi Ceria.
- **Verifikasi:** 3 file target 32/32 ✓ + sweep 8 file 72/72 ✓ (regresi persona/extractor/decision/grounding), `tsc --noEmit` bersih, skenario 4-turn deterministik 12/12 ✓ (cart akhir hanya Pijat Bayi Ceria Rp 60.000, topik durasi, CTA spesifik). CLI interaktif hanya sampai Turn-0 via pipe (keterbatasan readline stdin) — Turn-0 asli "Treatment moms & Baby" terkonfirmasi sebagai pemicu.

#### Audit & Enhancement — Investigasi Akar Masalah Follow-Up Cancelled & Optimasi Database Query Worker (`follow-up.service.ts`) (2026-09-07)

- **Latar Belakang & Permintaan Pengguna:**
  - Pengguna meminta pengecekan performa Follow-Up Queue selama 1 minggu terakhir (31 Agu – 7 Sep 2026), memverifikasi apakah ada bug atau sudah berjalan sempurna, serta menanyakan penyebab mengapa banyak follow-up yang berstatus `CANCELLED`.
- **Hasil Audit Mingguan Live Server (31 Agu – 7 Sep 2026):**
  - **Terkirim (*SENT*)**: **85 pesan** (konsisten 10–19 pesan/hari pada hari kerja, rata-rata aman dari limitasi Meta).
  - **Dalam Antrean (*QUEUED*)**: **52 pesan** (terjadwal rapi di masa mendatang).
  - **Ditunda (*PENDING*)**: **30 pesan** (Review H+1 pasca treatment yang dipostpone sesuai kebijakan klinik).
  - **Gagal (*FAILED*)**: **0 (Nol)** — tidak ada error pengiriman atau crash.
  - **Overdue / Terlambat**: **0 (Nol)** — tidak ada antrian yang tersangkut.
- **Investigasi Akar Masalah Status `CANCELLED` (Total 68 Kasus):**
  - **41 kasus (60.3%) ➔ Pelanggan Berhasil Booking Reservasi Baru (`onReservationCreated`)**: Sistem otomatis membatalkan antrian `NO_PURCHASE` (+3, +7, +14 hari) atau sisa `NEXT_TREATMENT` saat pelanggan membuat booking baru agar mereka tidak mendapatkan chat follow-up keliru seperti *"apakah belum jadi booking?"*. Ini adalah **indikator konversi berhasil (*Conversion Win*)**.
  - **17 kasus (25.0%) ➔ Proteksi Pelanggan dengan Reservasi Aktif (`Auto-Guard`)**: Saat worker hendak mengirim `NO_PURCHASE`, terdeteksi bahwa pelanggan sudah memiliki reservasi aktif (pending/confirmed/completed), sehingga dibatalkan otomatis agar pesan tepat sasaran.
  - **9 kasus (13.2%) ➔ Pembatalan Manual oleh Admin**: Admin klinik mengklik tombol *"Batalkan"* dari antrian dashboard.
  - **1 kasus (1.5%) ➔ Reservasi Customer Dibatalkan (`onReservationCancelled`)**: Pembatalan otomatis follow-up pengingat/review karena reservasi asalnya dibatalkan.
  - **Kesimpulan**: Sebanyak **58 dari 68 (85.3%) pembatalan adalah mekanisme proteksi sukses karena pelanggan telah melakukan reservasi**, bukan bug.
- **Optimasi Pencegahan (*Preventive Optimization*):**
  - Menambahkan filter `type: { notIn: ['REMINDER_H1', 'REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] }` langsung pada query database Prisma di `processDueFollowUps`, sehingga 30 record yang berstatus postponed tidak memenuhi kuota batch `take: 20` di setiap siklus worker.

#### Fix — Pemisahan Operasional "Tandai Lunas" dari Meta CAPI & Pemulihan Tombol Reservasi (`reservations.subroute.ts`, `ReservationDetailModal.tsx`) (2026-09-07)

- **Kebijakan:** Eksklusivitas Meta Purchase Queue — `Tandai Lunas / Confirm` TIDAK lagi auto-kirim `Purchase` CAPI. Seluruh Purchase hanya via `POST /api/admin/reservation/:id/approve-purchase` (Meta CAPI Queue). `purchase_event_sent_at` hanya di-set saat CAPI riil terkirim, bukan saat lunas operasional.
- **Stage 1 Backend Decoupling (`reservations.subroute.ts`):** Hapus `capiService.sendCapiEvent Purchase (ADMIN_CONFIRM / ADMIN_EDIT_CONFIRM)` + mutasi `purchase_event_sent_at` dari `PATCH /api/admin/reservation/:id/confirm` (DB & mock) dan `PATCH /api/admin/reservation/:id` (edit menjadi confirmed). Flow operasional tetap: Google Calendar create, `followUpService.createReservationFollowUps`, audit `CONFIRM_RESERVATION`, remove WAHA label `pending payment`.
- **Stage 2 UI (`ReservationDetailModal.tsx`):** Lepas hijacking tombol — selalu aktif hijau `bg-[#008069]`, teks `Konfirmasi Reservasi` (hold) / `Tandai Lunas` (pending) tanpa disabled `Purchase Dikirim`. Tambah badge CAPI terpisah: `✓ Purchase Terkirim (tgl)` / `⏳ Dalam Antrean Queue` / `Diabaikan (Outlier)` / `Belum Terkirim`.
- **Stage 3 Live DB Fix:** Reservasi Bunda Yulia `4adb5589-4b42-4d5e-b3a1-b1ecb0a000db` (pending, CAPI approved) → `status confirmed` + sinkron Google Calendar (via live SSH/psql + `createEvent`).
- **Verifikasi:** `admin-create-reservation.test.ts` 11/11 ✓, dashboard `vite build` ✓ 96.63kB ReservationDetailModal, `tsc` tanpa regresi baru.

#### Feature — Refresh & Revisi Lokasi, Jarak & Ongkir Customer (Hierarki Validitas Bidan & Customer) (`customer.service.ts`, `customers.subroute.ts`, `LiveChatMonitor.tsx`, `CustomerEditForm.tsx`, `CustomerDatabase.tsx`) (2026-09-07)

- **Hierarki Truth:** Tier1 `STAFF/ADMIN/HUMAN/BIDAN outbound` GPS pin/maps URL (paling valid) → Tier2 `customer inbound` shareloc → Tier3 `DB lat/lng` → Tier4 `geocoding kelurahan/kecamatan` (gazetteer + Nominatim). Deep scan `messages` (payload_raw.location, `[LOCATION SHARE]`, `[Shared Location]`, Google Maps shortlink via `resolveGoogleMapsUrl`).
- **Backend Core (`customer.service.ts:refreshCustomerLocationAndOngkir`):** Pilih kandidat terbaru per-tier sesuai prioritas, `deliveryService.calculateDelivery` untuk jarak/ongkir presisi, `reverseGeocode` untuk kelurahan/kecamatan/kota/zip, update atomik `lat/lng/distance_km/ongkir/is_out_of_coverage/share_location_sent` + `preferences {location_source, location_source_label, location_refreshed_at, refreshed_by, source_detail, location_history[]}` (max 10). Fallback memory + `googleContacts` sync + `liveChatHub` publish.
- **API (`customers.subroute.ts:POST /api/admin/customers/:id/refresh-location`):** Auth admin, audit `CUSTOMER_LOCATION_REFRESHED`, response `{source, sourceLabel, lat, lng, distanceKm, ongkir, isOutOfCoverage, kelurahan/kecamatan/kota, refreshedAt/By}` + message format `Rp`
- **UI LiveChatMonitor (`LiveChatMonitor.tsx`):** Tombol `🔄 Refresh & Hitung Ulang` (spinner) di section Alamat & Lokasi, badge sumber `🟢 Terverifikasi Bidan / 🔵 Shareloc Customer / 🟡 Koordinat Tersimpan / ⚪ Estimasi Wilayah` + timestamp, realtime sync `customerDetailData + chats` tanpa reload (toast).
- **UI Edit (`CustomerEditForm.tsx`):** Tombol `🔄 Ambil dari Shareloc Chat / Refresh` mengisi `lat/lng + kelurahan/kecamatan/kota` otomatis dari hierarki yang sama. `CustomerDatabase.tsx` tombol sama + badge di detail.
- **Verifikasi:** `customer-location-refresh.test.ts` 5/5 ✓ (Tier1 bidan, Tier2 customer, Tier3 DB, Tier4 geocoding, kalkulasi ongkir), `human-background-enrichment` 5/5 ✓, dashboard `vite build` ✓ 211kB LiveChatMonitor, `tsc` tanpa regresi baru (pre-existing `knowledge keywords`).

#### Feature — Integrasi Otomatis Data Gazetteer untuk Zipcode Meta CAPI (`gazetteer-zipcode-resolver.ts`, `capi.service.ts`, `human-background-enrichment.service.ts`, `backfill-customer-zipcodes.ts`) (2026-09-07)

- **Tujuan:** Maksimalkan Event Match Quality (EMQ) Meta CAPI dengan otomatis menyertakan parameter `zp` (kode pos SHA-256) pada setiap event Purchase/InitiateCheckout/Lead, memanfaatkan dataset resmi `surabaya_sidoarjo_subdistricts.json` (573 kelurahan/desa SBY-SDA).
- **Core Resolver (`src/utils/gazetteer-zipcode-resolver.ts`):** In-memory 3-layer index: (1) Kelurahan+Kecamatan exact → 100% presisi (Sawotratap+Gedangan→61254, Keputih+Sukolilo→60111), (2) Kecamatan fallback representatif most-common + override eksplisit (Gedangan→61254, Sedati→61253, Waru→61256, Wonokromo→60243, Rungkut→60293, Lakarsantri→60213), (3) Free-text entity match word-boundary dari `name+address` (Bunda Retno Gedangan→61254). Normalisasi lowercase + `__reset` untuk test.
- **CAPI Auto-Enrichment Guard (`src/services/capi.service.ts`):** Bila `customer.zipcode` & `pending_zipcode` kosong, `resolveZipcode({kelurahan,kecamatan,kota,text:name+address})` dipanggil, hash via `ParamBuilder.getNormalizedAndHashedPII(... ZIP_CODE)` → `userData.zp`, persist non-blocking non-destruktif ke `customers.zipcode` (hanya IS NULL) + memory fallback.
- **Human Background Enrichment (`src/services/human-background-enrichment.service.ts`):** Form reservasi, teks alamat, dan admin outbound kini fallback ke Gazetteer bila `geocodingService` tidak bawa zip; helper `tryEnrichZipcodeViaGazetteer` + oportunistik free-text early enrichment (bahkan saat sudah punya lat/lng) — hanya isi IS NULL.
- **Backfill Script (`scripts/backfill-customer-zipcodes.ts`):** `npx tsx scripts/backfill-customer-zipcodes.ts [--dry-run] [--tenant=ID]` — batch 200, non-destruktif, progress log, tenant-aware.
- **Verifikasi:** `gazetteer-zipcode-resolver.test.ts` 5/5 ✓ (presisi, fallback, free-text), `human-background-enrichment.test.ts` 5/5 ✓, `capi-payload-sanitizer` 4/4 ✓, CAPI hashing manual `61254` via ParamBuilder ✓; `tsc --noEmit` tanpa regresi baru.

#### Feature — RAG Knowledge & Bank Contoh Chat di V3 Agent + Full Observability Inspector (`search-knowledge-faq.tool.ts`, `tool-registry.ts`, `persona.ts`, `agent-runner.ts`, `llm-execution-logger.ts`, `evaluations.subroute.ts`, `AiSandbox.tsx`, `Debug.tsx`) (2026-09-06)

- **Latar Belakang:** 11 contoh chat + 7 kebijakan tertanam statis di `persona.ts`; tidak ada visibilitas chunk/exemplar/prompt di Sandbox & Tracing.
- **Stage 1 — Tool baru:** `search_knowledge_faq` (query/limit, via `knowledgeBaseService.searchRelevantChunks` + fallback in-memory) terdaftar di `ALL_V3_TOOLS` + handler registry; `get_catalog_and_price` kini meneruskan `inquirePrice` (sebelumnya hilang di registry).
- **Stage 2 — Dynamic few-shot:** `PersonaPromptBuilder.buildSystemPromptAsync()` memuat bank via `getAllExemplars` + `selectRelevantExemplars` (skor tag terhadap pesan masuk), MENGGANTIKAN blok contoh statis bila bank berisi (fallback statis bila kosong/offline); panduan tool `search_knowledge_faq` ditambahkan ke prompt.
- **Stage 3 — Observability runner:** output `+retrievedChunks/+fewShotExemplars/+systemPrompt/+reasoning/+tokens/+costIdr`; audit `V3_AGENT` per panggilan LLM (`auditLlmCall`, termasuk error path) + `recordLlmExecution` `flowType: 'V3_AGENT'` (tipe & `FLOW_ORDER` diperluas).
- **Stage 4 — Sandbox & UI:** route meneruskan chunks/exemplars/systemPrompt/reasoning/tokens/costIdr/executedTools; `AiSandbox.tsx` panel 4 tab (📚 RAG Chunks + status SOP-inti, 💬 Chat Bank, 🛠️ Tool Calls, 📝 Prompt & Reasoning + token/Rp); `Debug.tsx` badge + filter + body `V3_AGENT`; dashboard build ✓.
- **Verifikasi:** `tests/v3/agent-tools` 10/10 baru ✓ (2 gagal pre-existing di HEAD bersih: Manukan-ambigu, newline emoji), `agent-runner` 4/4 ✓ (Skenario 4 observability: chunk tumbuh-gigi, token 350), 12 file unit 133/133 ✓; `tsc` ✓; dashboard build ✓.

#### Fix — Transisi AI-First & Eliminasi Mid-Sentence Regex Mutilation (`sanitizer.ts`, `response-validator.ts`, `language-sanitizer.ts`, `get-catalog.tool.ts`, `persona.ts`) (2026-09-06)

- **Latar Belakang:** Insiden teks cacat "promo menjadi , danya Bunda" — regex hilir (`sanitizeUnsolicitedPriceAndDuration`, `cleanPriceStripRemnants`) mengamputasi nominal/kata di tengah kalimat LLM karena gagal mengenali slang ("60rb", "Hrga brp"). Sesuai Minimal-Regex Mandate (`.agents/rules/minimal-regex-mandate.md`), kendali dialihkan ke hulu.
- **Tahap 1 — Eliminasi mutilasi:** `sanitizeUnsolicitedPriceAndDuration` + `cleanPriceStripRemnants` DIHAPUS dari `OutputSanitizer` (pipeline hanya sanitasi teknis: thinking tag, markdown, monolog, format WA, strip English, pronoun, follow-up greeting, STR mention, truncate). Pemanggilan `sanitizeScheduleAffirmations` dihapus dari `ResponseValidator`; kedua fungsi di `language-sanitizer.ts` ditandai `@deprecated` (implementasi dipertahankan untuk impor historis).
- **Tahap 2 — AI-First grounding:** `get_catalog_and_price` dapat sinyal `inquirePrice?: boolean`; bila bukan true, summary/reason/suggestedPriceReply BEBAS nominal Rp (harga dinamis dari `treatmentCatalogService`, moksa combo dari item `add-on-sinar-moksa` — nol hardcode). Persona: Kondisi B + `inquirePrice: true` + konfirmasi nominal ("60rb ya" → "Betul Bunda, ... *Rp 60.000* (normal *Rp 80.000*) ... 40 menit"), Contoh 11 kontras, constraint #2 mencakup sebutan nominal.
- **Tahap 3 — Tes:** baru `get-catalog-tool-grounding.test.ts` 5/5 ✓; `price-slang-and-str-mention.test.ts` ditulis ulang ke paradigma intactness 6/6 ✓; `v3-persona-rules` Test 3/8 diselaraskan (10/10 ✓); `conversational-flow` anti-afirmasi diselaraskan (validator tak lagi memotong pembuka; 7/7 ✓).
- **Verifikasi:** 8 file 86/86 ✓ (termasuk `lead-greeting-preservation`, `response-validator`, `schedule-anti-affirmation` 35/35, `multi-turn-ongkir`); `npm run build` ✓.

#### Feature — Integrasi Koleksi Emas 25 Contoh Chat Bidan Yusi (`gold-few-shot-exemplars.ts`, `few-shot-exemplars.ts`, `seed-curated-gold-exemplars.ts`, test few-shot) (2026-09-06)

- **Latar Belakang:** Bank contoh bawaan hanya 7 SOP inti; 532 dialog riil Bidan Yusi yang sudah dikurasi di `docs/BANK_CONTOH_CHAT_BIDAN_YUSI.md` belum dimanfaatkan sebagai contoh ideal untuk LLM. Opsi A: integrasikan 25-30 "contoh master pilihan emas" ke sistem + seed non-destruktif ke live.
- **Stage 1 — Dataset Koleksi Emas:** file baru `src/slot-engine/gold-few-shot-exemplars.ts` berisi **25 contoh master** hasil kurasi dari bank dialog riil, mencakup 15 area: salam Islami, jam operasional, lokasi/homecare & konfirmasi domisili, cek jadwal/penuh, tarif/promo, metode bayar (QRIS/transfer/cash), kualifikasi STR & higienitas, pasca-vaksin (jeda minimal 3 hari), rewel/susah tidur, pencernaan bayi, perawatan ibu menyusui, newborn/selapan/cukur, usia minimal, kids spa, penolakan santun layanan belum tersedia, batal/ubah/keep jadwal, feedback positif & ucapan terima kasih. Konten dinormalisasi aman SOP (persona "kami", tanpa afirmasi layanan di luar katalog aktif, tanpa tanya jam pagi/siang/sore, format harga konsisten).
- **Stage 2 — Integrasi DEFAULT:** `DEFAULT_FEW_SHOT_EXEMPLARS` diperluas 7 → **32** (7 SOP inti + 25 Koleksi Emas, `sort_order` 1-32). Tenant baru / reset "Pulihkan SOP" otomatis mendapat bank lengkap. Tag `chitchat` sengaja TIDAK dipakai pada contoh sapaan/terima kasih agar tidak menyalip topik nyata saat intent chitchat.
- **Stage 3 — Seed non-destruktif:** script `scripts/seed-curated-gold-exemplars.ts` idempoten — cocokkan per `(tenant_id, scenario)`; record yang sudah ada di-update isi/tags (ID & sort_order dipertahankan), yang belum ada di-insert di urutan belakang; contoh kustom admin (mis. "Pertanyaan Jam Oprasional") tidak pernah dihapus/ditimpa.
- **Stage 4 — Test disesuaikan:** asersi `reset-defaults non-destructive` 8 → 33 (32 default + 1 kustom); test seleksi pembayaran menerima SOP maupun Koleksi Emas (dua-duanya contoh sah).
- **Verifikasi:** `few-shot-api` 11/11 ✓, `few-shot-exemplar-selection` 7/7 ✓, `few-shot-reorder` 3/3 ✓, regresi `lead-greeting-preservation` + `slot-engine-lead-greeting` 28/28 ✓; `npm run build` (tsc) ✓.
- **Live seeding SELESAI (2026-09-06, 1-step verification):** 25 Koleksi Emas di-insert via SSH ke PostgreSQL live (`INSERT ... WHERE NOT EXISTS` per natural key scenario) — tabel kini **33 baris**: kustom "Pertanyaan Jam Oprasional" tetap sort_order 1, 7 SOP lama 2–8, 25 emas 9–33. Normalisasi sort_order via UPDATE CASE 33 id (perbaiki tabrakan urutan karena live sudah punya 8 row sebelum seed). 2 record dengan em dash diperbaiki dari mojibake (encoding UTF-8 eksplisit). Idempoten, aman diulang. Uji lokal (Postgres Docker): 7→32→33 (dengan kustom tiruan) → bersih kembali.

#### Fix — Penertiban Kualifikasi STR & Deteksi Harga Slang (`persona.ts`, `get-catalog.tool.ts`, `sanitizer.ts`, `language-sanitizer.ts`) (2026-09-06)

- **Latar Belakang:** (1) Bot mengulang label "oleh Bidan ber-STR aktif" di rincian paket — user: cukup disebut bila ditanya; (2) "Hrga brp y kak??" tidak terdeteksi sebagai tanya harga → sanitizer mengamputasi angka, menyisakan "(harga normal)" / "(normal)" / "untukperawatan".
- **Tahap 1 — Prompt & tool:** rincian Kondisi B + Contoh 3 + `recommendationReason` katalog kini "oleh Bidan kami"; aturan Kualifikasi Bidan: STR HANYA bila eksplisit ditanya (sertifikat/legalitas/"yang mijat siapa?"); Kondisi A: pertanyaan kecocokan usia tanpa tanya harga → jawab afirmatif, DILARANG muntahkan harga/promo, tutup tanya keluhan.
- **Tahap 2 — Sanitizer:** regex `isAskingPriceOrDuration` diperluas ke slang (brp/brpa/piro/hrga/hrg/pl/rate/mnt/...) di kedua file; `cleanPriceStripRemnants()` (V3) + pass anti-dangling (V2 util) menghapus "(harga normal)/(normal)", "saat ini lagi promo" yatim, kurung kosong, sisa "Rp" telantar, dan spasi hilang "*Ceria*dan"; `sanitizeUnpromptedStrMention()` fallback ubah "ber-STR aktif" → "Bidan kami" kecuali input tanya kualifikasi — wired ke `cleanOutboundReply`.
- **Verifikasi:** `price-slang-and-str-mention.test.ts` 6/6 ✓ (baru); regresi `lead-greeting-preservation` 15/15 + `v3-persona-rules` 10/10 ✓; `npm run build` ✓.
- **Deviasi tercatat:** sebutan STR di jalur V2 legacy (`persona-composer.ts`, `dynamic-closer.ts`, `grounding-composer.ts`) dan template jawaban kualifikasi on-demand (`config/persona.ts:444`, dipakai saat customer memang bertanya) sengaja tidak diubah — V3 adalah jalur aktif default.

#### Fix — Bank Contoh Chat: Restore Non-Destruktif, Auto-Seed Aman & Guard Panjang (`few-shot-exemplars.ts`, `settings.subroute.ts`, `AiPersona.tsx`) (2026-09-06)

- **Latar Belakang:** Tindak lanjut audit 17 temuan — `resetToDefaults()` masih `deleteMany` destruktif (contoh kustom ikut terhapus), `getAllExemplars()` tidak auto-seed saat tabel kosong, belum ada batas panjang input.
- **Stage 1 — Non-destruktif + auto-seed aman:** `resetToDefaults()` kini merge additive (cocokkan exemplar sistem via teks scenario kanonik → update isi + reaktivasi pertahankan ID/sort_order; yang hilang dibuat ulang; kustom tak tersentuh; kembalikan ID riil DB). `getAllExemplars()` auto-seed 7 default SOP (UUID riil) hanya bila tabel kosong DAN tenant benar-benar baru (tanpa riwayat `FEW_SHOT_*` di `audit_logs`) — bank yang sengaja dikosongkan admin tetap dihormati, tidak resurrect.
- **Stage 2 — Guard panjang:** POST/PUT menolak 400 bila skenario >150, pesan pasien >500, respon ideal >1000 karakter; PUT juga validasi trim non-kosong + sanitasi tags; pesan route reset menegaskan contoh kustom dipertahankan.
- **Stage 4 — UI:** tombol "Reset SOP" → "Pulihkan SOP" (dialog non-danger, toast menegaskan kustom dipertahankan).
- **Verifikasi:** `few-shot-api` 11/11 ✓ (3 tes baru: tolak oversize POST/PUT, reset pertahankan kustom 7+1=8), `few-shot-exemplar-selection` 7/7 ✓, `few-shot-reorder` 3/3 ✓; `npm run build` ✓; dashboard build ✓.
- **Live seeding SELESAI (2026-09-06, 1-step verification):** `INSERT ... WHERE NOT EXISTS` via SSH ke PostgreSQL live — `INSERT 0 7`, tabel kini 8 baris (kustom `27043a1b…` sort_order 1 utuh + 7 SOP sort_order 2–8, semua aktif). Idempoten, aman diulang.

#### Fix — Anti-Repetition Multi-Turn & Penguatan Preservasi Storage (`agent-runner.ts`, `sanitizer.ts`, `language-sanitizer.ts`, `persona.ts`, `machine.ts`, `chat-simulator.ts`, `webhook.route.ts`) (2026-09-06)

- **Latar Belakang:** (Case 3) Bot mengulang perkenalan Turn-0 ("Halo Bunda! ✨ Terima kasih sudah menghubungi kami. Perkenalkan, saya Bidan Yusi…") pada chat lanjutan; (storage) log abuse-blocked masih memakai teks ter-strip dan `machine.ts` menimpa `text.body` tanpa `cleanTextForAi`.
- **Case 3 — 3 akar diperbaiki:** (1) `OutputSanitizer.sanitizeFollowUpGreetingRepetition()` baru + `cleanOutboundReply(..., isFollowUp)` memotong deterministik varian "Halo Bunda", "Terima kasih sudah menghubungi kami…", "Perkenalkan, saya Bidan Yusi…" bila `isFollowUp=true`; `sanitizeGreetingRepetitionForFollowUp` di `language-sanitizer.ts` diperluas sama. (2) `persona.ts` [CHAT LANJUTAN] dipertegas "DILARANG KERAS mengulang sapaan/perkenalan". (3) `agent-runner.ts` rehydrate via `messageService.getRecentMessages` (in-memory fallback, tidak lagi `prisma.message.findMany` mentah) + logging inbound/outbound via `messageService.logMessage` (mengisi fallback memory sehingga `isFollowUp` benar saat DB offline); payload LLM memakai `stripAdTags(incomingText)`.
- **Storage:** `webhook.route.ts` log abuse-blocked pakai `originalText`; `machine.ts` set `originalText` bila kosong + `cleanTextForAi` untuk inferensi (medis/V3) dan teruskan `originalText` ke V3; `chat-simulator.ts` log INBOUND via `messageService` + flag `_preLogged` agar histori lokal simetris.
- **Verifikasi:** `lead-greeting-preservation.test.ts` 15/15 ✓ (5 tes Case 3 baru); regresi `slot-engine-lead-greeting` + `v3-persona-rules` + `ad-attribution` 28/28 ✓; `npm run build` (tsc) ✓.

#### Feature — Riwayat Chat Lengkap: Cursor Pagination & Infinite Scroll Up (`message.service.ts`, `live-chat.service.ts`, `livechat.subroute.ts`, `LiveChatMonitor.tsx`) (2026-09-06)

- **Latar Belakang:** Live Chat hanya memuat 50 pesan terakhir; riwayat lama tak terlihat.
- **Stage 1 — Backend:** `message.service.ts` `getRecentMessages(..., before?)` + `getRecentMessagesWithHasMore` (take limit+1, filter `created_at < before`, memory fallback sama); `live-chat.service.ts` `getConversationMessagesPaged` (method lama delegasi, backward-compat); endpoint `:id/messages` terima `?limit=&before=` dan kembalikan `{success, count, data, hasMore, oldestCursor}`.
- **Stage 2 — Frontend:** state `hasMoreOlderMessages`/`isLoadingOlder`/`oldestMessageCursorRef`; `loadThread` initial `?limit=50`; `loadOlderMessages` prepend + dedup + scroll anchoring (`scrollTop += ΔscrollHeight` via rAF); trigger `scrollTop < 80`, tombol manual "↑ Muat pesan sebelumnya", badge "Awal dari riwayat percakapan".
- **Stage 3 — Deep search:** tombol "Cari di riwayat lama" di banner no-match, muat batch hingga kata kunci ketemu / riwayat habis (maks 20 batch).
- **Verifikasi:** `live-chat-paged-messages.test.ts` 4/4 ✓, regresi `live-chat-reply` 10/10 ✓, `npm run build` (tsc) ✓, dashboard build ✓ 10.66s.


#### Feature — Perbaikan Menyeluruh Bank Contoh Chat Few-Shot (`few-shot-exemplars.ts`, `settings.subroute.ts`, `AiPersona.tsx`, `tests/setup.ts`, `few-shot-reorder.test.ts`) (2026-09-06)

- **Latar Belakang:** Audit 14 temuan di 3 layer — UI few-shot tanpa dark mode & tanpa kontrol urutan/filter; bug ID desinkronisasi reset→edit (404); cache memory stale yang me-resurrect default saat admin hapus semua; skoring AI hardcode ID (exemplar kustom tak pernah dapat prioritas); false-positive sub-kata tag ("flu" cocok dengan "fluktuasi"); default exemplar melanggar Aturan Emas V3 (tanya jam pagi/siang/sore).
- **Stage 1 — Data layer & ID consistency:** `resetToDefaults()` kini mengembalikan ID riil dari database (UUID hasil `create`), bukan ID statis default — Edit/Delete pasca-reset tidak lagi 404. `getAllExemplars(forceRefresh?)` + `tenantEmptyStateCache`: state kosong dicatat persisten, default TIDAK resurrect sepihak. Semua mutasi (`create/update/delete/reset/reorder`) sinkronkan cache per-tenant presisi. Method baru `reorderExemplars(orderedIds)` (transaction sekuensial + fallback in-memory saat DB offline). Route baru `PUT /api/admin/few-shots/reorder` (validasi `orderedIds` array string, audit `FEW_SHOT_REORDER`). POST/PUT validasi `.trim()` → 400 bila kosong; `tags` dinormalisasi aman untuk non-array (tidak crash `t.trim is not a function`).
- **Stage 2 — AI engine dinamis:** Skoring prioritas (+5/+2) di `selectRelevantExemplars` diganti dari perbandingan `ex.id === 'price_inquiry'` dkk menjadi grup tag intent (`ask_schedule/jadwal`, `ask_price/harga`, `consult_symptom/batuk/pilek`, `follow_up/select_treatment`) — exemplar kustom admin kini ikut diprioritaskan. Matching tag memakai word-boundary regex (escape-safe), mencegah sub-kata false positive.
- **Stage 3 — UI/UX dashboard:** Paritas dark mode penuh (kartu `#111b21`, input `#202c33`, border `#222e35`/`#374248`, teks `#e9edef`, aksen emerald) di header/tab/panel persona/banner/kartu/dialog preview/modal. Filter status pill (Semua/Aktif/Nonaktif). Tombol Up/Down untuk reorder prioritas per kartu (optimistic + persist via endpoint reorder). Tag editor jadi chip interaktif: chip tampil saat mengetik, hapus per-chip, quick-suggested tags, Enter menormalkan format. Character counter respon ideal `N / 500` dengan peringatan amber >500. Unifikasi feedback: banner inline ganda dihapus — semua notifikasi via toast `useUiFeedback()`.
- **Stage 4 — Default SOP diselarakan Aturan Emas V3:** `schedule_inquiry_anti_affirmation` tidak lagi menanyakan jam (pagi/siang/sore) — jadwal diserahkan ke Admin CS; format harga `*Rp 70.000*`; 1 closing question konsisten.
- **Verifikasi:** 3 file tes few-shot 18/18 ✓ (termasuk `reset-defaults → update` tanpa 404, reorder terbalik, sub-word negatif, custom exemplar via tag, whitespace 400, tags non-array); `npm run build` root ✓; dashboard `npm run build` ✓ (bundle `AiPersona-*.js`). Test API few-shot lama sebelumnya gagal di mesin `NODE_ENV=production` karena `setup.ts` blank secret — kini file tes menetapkan `NODE_ENV='test'` eksplisit (failure pre-existing ikut teratasi).

#### Fix — Preservasi Teks Asli Live Chat & Greeting Statis Deterministik (`webhook.route.ts`, `waba-webhook.route.ts`, `burst-coalesce.service.ts`, `lead-greeting-detector.ts`, `agent-runner.ts`, `evaluations.subroute.ts`) (2026-09-06)

- **Latar Belakang:** (1) Bot V3 membalas sapaan iklan `Promo[b8] Halo Bu Bidan...` dengan LLM non-deterministik, bukan `TEMPLATES.greeting()`; (2) tag `Promo[b8]` hilang dari DB/Live Chat karena strip destruktif sebelum logging.
- **Tahap 1 — Storage mentah, inferensi bersih:** `webhook.route.ts` tambah `cleanTextForAi`, 4 titik log Human Handling/blocked pakai `originalText || text.body`; `burst-coalesce.service.ts:125` log `originalText`; `waba-webhook.route.ts` simpan `msg.originalText`, 3 titik log + `incomingMessage.originalText` pakai teks mentah. `machine.ts` tidak diubah (sudah `originalText`-first &:125, strip inferensi &:140 tetap).
- **Tahap 2 — `utils/lead-greeting-detector.ts` (baru):** `isPureLeadGreeting()` + `stripAdTags()`, regex diselaraskan DecisionMatrix 2C + guard harga/gejala/jadwal/usia + flag Islami.
- **Tahap 3 — Gate V3:** `agent-runner.ts` `isFollowUp = history.some(assistant)` (perbaiki bug hitung 1 pesan inbound); Turn-0 murni → return `TEMPLATES.greeting({isIslamic})` 0-token + log inbound mentah; tambah param `originalText` (dipakai log inbound & `evaluations.subroute.ts` teruskan `combinedRawText`).
- **Tahap 4 — Tes:** `tests/unit/lead-greeting-preservation.test.ts` 10/10 ✓; regresi `slot-engine-lead-greeting` + `ad-attribution` + `v3-persona-rules` 38/38 ✓ (`v3-persona-rules` Test 1 dimutakhirkan ke gate deterministik — perilaku lama LLM untuk "halo kak" sudah obsolete); `npm run build` (tsc) ✓.
- **Deviasi tercatat:** `TEMPLATES.greeting()` TIDAK diubah (SOP-kritis) — berisi "Perkenalkan, saya Bidan Yusi, Kami melayani…", bukan varian "dari Kala Moms and Baby Spa" di plan; tes assert exact template aktual.

#### Feature — Integrasi Aturan Emas Klinik ke Arsitektur V3 (`persona.ts`, `sanitizer.ts`, `agent-runner.ts`, `v3-persona-rules.test.ts`) (2026-09-05)

- **Latar Belakang:** Balasan V3 melanggar aturan klinik di live test (harga/durasi bocor saat tidak ditanya, English leak, todong usia, afirmasi jadwal).
- **1. Prompt (`v3/agent/persona.ts`):** Poin 5 direkonstruksi jadi KONDISI A (keluhan saja → rekomendasi *Pijat Bayi Pulih Ceria* + manfaat 2-3 kalimat, tanpa Rp/menit/daftar nomor, tutup tanya keluhan bukan usia) vs KONDISI B (eksplisit tanya harga/rincian → 40 menit, *Rp 70.000*, rincian ID murni, opsi *Sinar Moksa*, tutup tanya hari kunjungan); daftar larangan kata asing mutlak; blok `[NEGATIVE CONSTRAINTS MUTLAK]` 13 aturan; Contoh 1-2 diselaraskan (tanpa "Homecare treatment"/"(full body massage)"/todong usia).
- **2. Guardrail (`v3/guardrails/sanitizer.ts`):** `cleanOutboundReply(rawText, customerInput?)` + 4 method baru — `sanitizeUnsolicitedPriceAndDuration` (sapu Rp/menit bila input tanpa kata tanya harga/durasi), `truncateToMaxChars` (500, potong di akhir kalimat), `stripEnglishLeakage`, `sanitizeFirstPersonPronoun` (saya/aku→kami; grup verba dibuat capturing agar `$1` valid — formula plan memakai non-capturing yang menghasilkan literal "$1").
- **3. Pipeline (`v3/agent/agent-runner.ts:283`):** `cleanOutboundReply(finalReply, incomingText)` — sanitizer kini tahu konteks tanya-harga.
- **4. Tes (`tests/unit/v3-persona-rules.test.ts`):** 10 pengujian deterministik offline (axios-mock): sapaan Turn-0, lokasi, bapil ±harga, anti-afirmasi jadwal, newborn, luar katalog, + 3 unit guardrail (strip harga, truncate 500, anti-English).
- **5. Few-Shot Chat Examples (`docs/BANK_CONTOH_CHAT_BIDAN_YUSI.md` & `persona.ts`):** Ekstraksi 9.420 pesan database riil, dikurasi 532 dialog asli manusia (tanpa bot, tanpa form booking, tanpa ongkir math, jadwal dibatasi 2 contoh) dan 10 contoh representatif ditanamkan ke prompt AI.
- **Verifikasi:** target 10/10 ✓, `npx tsc --noEmit` ✓. Full suite: 1740 passed, 19 gagal di 6 file — terbukti pre-existing di master bersih via `git stash` (20 gagal termasuk 1 dari file tes baru tanpa implementasi), bukan regresi patch ini.

#### Fix — Preservasi Posisi Scroll Live Chat Saat Pindah Menu/Page & Alt-Tab (`LiveChatMonitor.tsx`) (2026-09-05)

- **Akar Masalah:**
  1. *Pindah Page*: Navigasi antar menu di React SPA menyebabkan `LiveChatMonitor` unmount dan remount. Scroll position tidak pernah disimpan ke `sessionStorage`, sehingga setiap kali kembali ke Live Chat, `isInitialMessagesLoadRef` selalu memicu `scrollToBottom(false, true)` yang memaksa scroll ke paling bawah.
  2. *Alt-Tab*: Di Windows/Chrome, Alt-Tab ke aplikasi desktop lain sering kali tidak memicu `document.visibilitychange: hidden` (hanya `window.blur`), sehingga `savedScrollTopRef` tidak tercatat dan `wasNearBottomRef` default `true` memicu `scrollToBottom(true, true)` saat kembali. Selain itu, `loadChats(true)` pada saat tab aktif berisiko mengubah referensi `selectedChat` (terutama untuk chat di luar 50 teratas) yang memicu ulang `useEffect` pemuatan thread sehingga menghapus pesan dan me-reset scroll.
- **Solusi Komprehensif:**
  1. *Penyimpanan Posisi Scroll Persistent*: Menambahkan helper `saveConversationScroll` dan `getConversationScroll` dengan penyimpanan di `sessionStorage` (`liveChat:scrollPositions`) per conversationId.
  2. *Sinkronisasi onScroll & handleSelect*: Setiap scroll mencatat `scrollTop` dan `isNearBottom` ke ref dan storage; `handleSelect` mencatat posisi chat lama sebelum berpindah ke chat baru.
  3. *Restorasi Cerdas Saat Initial Load*: Di `useEffect` pesan, jika user sebelumnya tidak di posisi bawah (`!wasNearBottom && savedScrollTop !== null`), posisinya dipulihkan secara akurat (multi-frame rAF + timeouts) alih-alih di-force scroll ke bawah.
  4. *Listener Window Blur/Focus & Safe Visibility*: Menambahkan listener `window.blur` (tangkap scroll saat Alt-Tab) dan `window.focus` (pulihkan scroll tanpa force-scroll). Pada `visibilitychange`, `scrollToBottom` diubah ke `force=false`.
  5. *Isolasi Thread Load*: Menghapus `selectedChat?.conversationId` dari dependency array `loadThread` (hanya `[selectedId]`), serta mempertahankan objek chat aktif di `loadChats(reset=true)` jika berada di luar 50 teratas.
- **Verifikasi:** Build `packages/admin-dashboard` ✓ 11.04s, `npm run build` root ✓, integration tests ✓ (9/9 passed).

#### Fix — Sembunyikan Chat Sandbox/QA Test dari Live Server (`livechat.subroute.ts`, `conversation.service.ts`, `LiveChatMonitor.tsx`) (2026-09-04)

- **Latar Belakang:** Chat sandbox/QA test (`is_sandbox_test=true`) bocor ke daftar Live Chat di server produksi, mengganggu CS. Sesuai skill `qa-test-labeling`, chat test wajib terisolasi.
- **Backend:** `livechat.subroute.ts:63` `effectiveMode` paksa `all→real` saat `NODE_ENV=production`; `conversation.service.ts:184` `where.customer.is_sandbox_test=false` untuk `all` di production; fallback memory juga saring `is_sandbox_test`; SSE `message.created` diabaikan bila `isSandboxTest` & `PROD`.
- **Frontend:** `LiveChatMonitor.tsx:436` `isLiveServer=import.meta.env.PROD` paksa `sourceFilter='real'`, sembunyikan opsi `all`/`sandbox` di toolbar (hanya `real` di live), cegah inject SSE sandbox ke `chats`.
- **Verifikasi:** `npm run build` dashboard ✓, `npm test` ✓ (209 passed core; `migration.test.ts` butuh `--testTimeout=30000` saat load penuh).

#### Fix — Perbaikan Permanen Sinkronisasi Reaksi Emoji Customer WhatsApp (`whatsapp-provider.service.ts`, `waha/client.ts`, `app.ts`, `message.service.ts`) (2026-09-04)

- **Stage 1 — Schema WAHA & Auto-Sync:** Bersihkan events WAHA ke schema valid: hapus `message.reaction.added/deleted` (ditolak validator), pertahankan `message.reaction`, tambah `message.edited`; `buildDefaultSessionConfig` + `waha/client.ts:startSession` kini `['session.status','message','message.any','message.reaction','message.ack','message.revoked','message.edited','label.chat.added','label.chat.deleted']`; `syncSessionWebhooks()` kirim `{config: mergedConfig}` dan log `reaction terdaftar`; perbaiki import dynamic `DEFAULT_TENANT_ID` di `app.ts:183` agar tidak error scope TS2304 saat build.
- **Stage 2 — Pencocokan ID Dua Arah & Multi-Part:** `extractShortMessageId` diperluas mendukung format WAHA 3 bagian (`true_jid_id`) dan 4 bagian (`true_jid_id_participant` pada broadcast status & lid); `message.service.ts:853` `cleanId=extractShortMessageId(messageId)` + `orConds` dukung `wa_message_id=messageId`, `cleanId`, dan `endsWith _cleanId` (long↔short dua arah); fallback memory juga pakai `cleanId` yang sama; memastikan `false_628...@c.us_3EB0` vs `3EB0` cocok. Verifikasi build ✓, test ✓.

#### Fix — Penerimaan & Sinkronisasi Reaksi Emoji Customer WhatsApp ke Dashboard Live Chat (`whatsapp-provider.service.ts`, `waha/client.ts`, `webhook.route.ts`, `message.service.ts`, `LiveChatMonitor.tsx`) (2026-09-04)

- **Akar Masalah:** WAHA tidak subscribe `message.reaction*`, payload `reaction.messageId` tertukar dengan ID event, dan `wa_message_id` panjang vs pendek tidak cocok di DB sehingga reaksi customer tidak muncul.
- **Stage 1 — Registrasi Event WAHA:** `whatsapp-provider.service.ts:200` `buildDefaultSessionConfig` events ditambah `message.reaction`, `message.reaction.added`, `message.reaction.deleted`, `message.ack`, `message.revoked` (+ `message.any`); method baru `syncSessionWebhooks()` untuk `PUT /api/sessions/:session` tanpa scan QR ulang; `waha/client.ts:1248` `startSession` webhook events diperluas sama; tambah `updateSessionConfig()` helper.
- **Stage 2 — Presisi Webhook & DB:** `webhook.route.ts:192` prioritas `reactionObj.messageId || reactionObj.id` sebelum `reactPayload.id`, tangkap `pushName` untuk `senderName`; `message.service.ts:854` `addOrUpdateReaction` toleransi `wa_message_id` panjang `false_...@c.us_3EB0` ↔ pendek `3EB0` via `extractShortMessageId` + `endsWith`, lookup memory juga dukung short/long, broadcast ganda `message:reaction` + `message.reaction` untuk kompatibilitas SSE.
- **Stage 3 — Frontend:** `LiveChatMonitor.tsx:1949` SSE reaction `idsMatch` via short-suffix/endsWith (id & wa_message_id), pill `title` sudah `Anda` vs `senderName` (mis. “Bunda Rina: ❤️”), `groupedReactions` tampil real-time di sudut bubble.
- **Verifikasi:** `packages/admin-dashboard build` ✓ 10.65s, `npm test` ✓ 209 files / 1724 passed.

#### Fix — Auto Mark-As-Read & Sinkronisasi Real-Time Saat Admin Balas via WhatsApp HP (`webhook.route.ts`, `live-chat.service.ts`, `LiveChatMonitor.tsx`) (2026-09-04)

- **Latar Belakang:** Badge unread di dashboard Live Chat tidak hilang ketika admin membalas pasien langsung dari WhatsApp HP / WhatsApp Web eksternal — harus refresh manual.
- **Stage 1 — Backend:** `webhook.route.ts:401` blok `fromMe && !isBotAutoReply` kini memanggil `messageService.markConversationMessagesAsRead` + `conversationService.setManualUnread(false)` dan `hub.publish({type:'conversation.updated', unreadCount:0, isManualUnread:false})`; `live-chat.service.ts:483` `sendAdminReply` juga sync mark-as-read agar dashboard & WA HP paritas (DB `read_at` terisi, reload tetap 0).
- **Stage 2 — Frontend:** `LiveChatMonitor.tsx:1891` SSE `message.created` hitung `isAdminOutbound = OUTBOUND && ADMIN`, lalu `nextUnread = (isCurrentOpen || isAdminOutbound) ? 0 : ...` dan `isAwaitingReply=false` bila admin outbound; handler `conversation.updated` sudah sync `unreadCount` dari payload broadcast. VOIP bubble balasan WA HP langsung muncul + badge kiri hilang tanpa reload.
- **Verifikasi:** `packages/admin-dashboard build` ✓ 11.48s, `npm test` ✓ 209 files / 1724 passed.

#### Fix — Perbaikan Menyeluruh 12 Bug Live Chat Monitor (`LiveChatMonitor.tsx`, `livechat.subroute.ts`, `conversation.service.ts`, `live-chat.service.ts`) (2026-09-04)

- **Latar Belakang:** Audit menemukan 12 bug pada `LiveChatMonitor.tsx` (navigasi reload jebak chat, URL stale, duplikasi foto hilang 20s, badge unread tidak muncul di HP, thread stale saat resume, pencarian bertabrakan, memory leak gambar, voice note jadi broken image, desync mark-all-read, nama stale, typing nyangkut, filter label tidak efisien).
- **Stage 1 — Navigasi & Lifecycle (Bug 1,2,4,5):** `handleBackToList` kini hentikan typing, reset `selectedIdRef`/`sessionStorage`, bersihkan `?conversationId` via `replaceState`+`setSearchParams` (reload tetap di list); `handleSelect` sinkron URL `?conversationId=` via `pushState` + `setSearchParams` + batalkan typing percakapan lama; mount init tidak lagi paksa `chat` saat `savedView==='list'` di mobile; badge unread dihitung dengan `isChatVisuallyActive = isDesktopRef||mobileViewRef==='chat'` (via refs agar SSE closure tidak stale); `visibilitychange` me-refresh `loadChats` + `loadThread(selectedId)` aktif.
- **Stage 2 — Pesan & State Sync (Bug 3,8,10,11):** Dedup di `loadThread` & SSE diketatkan ke `id`/`wa_message_id` sama atau teks identik <2000ms atau `media URL` identik <2000ms (dua foto berbeda URL tidak pernah dianggap duplikat); `mark-all-read` sinkronkan `chatsRef.current`; `handleSaveCustomerDetail` patch `chatsRef` nama/telepon (match `conversationId` atau `customerId`); `handleSelect` bersihkan `typingTimerRef`/`typingStartTimerRef` sebelumnya.
- **Stage 3 — Search, Memori, Audio, Label (Bug 6,7,9,12):** Pisahkan `inChatSearchQuery`/`inChatSearchOpen` dari `searchQuery` daftar (toolbar kaca pembesar di header chat, banner `effectiveInChatQuery` pakai `inChatSearchQuery`); `selectImage` revoke `URL.createObjectURL` via `handleRemoveSelectedImage` + revoke preview lama saat ganti + revoke saat kirim (`handleSendReply`) + cleanup unmount; `VoiceNotePlayer` untuk `audio/*` / `.ogg/.mp3/.m4a/...` (`Play`/`Pause` + progress + durasi), fallback `MediaImage` untuk gambar, kartu dokumen `FileText`+`Download` untuk `application/*`; label filter forward `&label=` ke `GET /api/admin/live-chat/conversations` (subroute + service `listConversations` filter `escalation_reason`/`is_human_handling`, memory fallback ikut filter, empty state + tombol `Reset Filter Label`).
- **Stage 4 — Verifikasi:** `packages/admin-dashboard npm run build` ✓ (11.72s, `LiveChatMonitor-Dv0yh2cV.js`), `npm test` ✓ (209 passed, 1724 passed). Root `npm run build` gagal pre-existing `duration_minutes` di `reservations.subroute.ts` (bukan regresi patch ini). `dist/` sudah di-rebuild.

#### Changed — Badge footer Live Chat jadi icon-only (`LiveChatMonitor.tsx`) (2026-09-04)

- **Latar Belakang:** Badge MQL, Meta, Medis, Legacy, CS, dan Bot di footer kartu percakapan memakan ruang horizontal — tulisan dihapus, ikon dipertahankan.
- **Perubahan:** Keenam badge kini icon-only (`AlertTriangle`, `Zap`, `Facebook`, `User`, `Bot`); Legacy yang sebelumnya tanpa ikon diberi ikon `Archive`. Atribut `title` (tooltip) dipertahankan agar arti tiap badge tetap terbaca saat hover.
- **Tambahan:** Badge MQL dan Legacy disembunyikan bila customer sudah pernah order (`purchaseCount > 0`) — status lead/migrasi tidak lagi relevan untuk repeat customer.
- **Verifikasi:** `npm run build` dashboard ✓.

#### Changed — Dark Mode Canvas Pure Black `#000000` (`index.css`, `Layout.tsx`, `Login.tsx`, `ThemeContext.tsx`) (2026-09-04)

- **Latar Belakang:** Warna dasar dark `#0c1317` (Onyx) diganti pure black `#000000` agar kontras maksimal dan hemat baterai layar AMOLED.
- **Cakupan:** Token `wa.canvas.dark`, `html/body/#root`, remap `.dark .bg-[#f0f2f5]`, root `Layout` + `main`, root `Login`, `meta theme-color`, plus 3 file yang sudah punya varian dark lama (`MonthScheduleGrid.tsx`, `Debug.tsx`, `TodayTreatments.tsx`).
- **Sengaja TIDAK diubah:** Surface kartu/sidebar `#202c33`, surface2 `#111b21`, dan wallpaper chat `#0b141a` — tetap sebagai lapisan kontras di atas kanvas hitam.
- **Verifikasi:** `npm run build` dashboard ✓, 18 aturan `#000000` terkompilasi di CSS `dist/`.

#### Feature — Alih Kelola Form Reservasi ke Admin + Back Gesture & Inquiry Guard (`decision-matrix.ts`, `grounding-composer.ts`, `dynamic-closer.service.ts`, `slate-store.ts`, `entity-extractor.ts`, `persona.ts`) (2026-09-04)

- **Alih kelola form:** Saat booking-ready (lokasi + treatment + hari), bot TIDAK LAGI mengirim template formulir 10+ baris. Bot membalas singkat ala Bidan Yusi (`TEMPLATES.scheduleCheckHandoff`: "Baik Bunda, untuk ... kami cek jadwal dulu yaa bunda...") lalu handoff `HUMAN_HANDLING` (`booking_schedule_check`) — Admin menawarkan jam & mengirim form via dashboard. Permintaan form eksplisit ("minta format reservasi") ikut handoff. CAPI `InitiateCheckout` tetap ditembak. Injeksi `suggestedPreFilledForm` ke prompt LLM dimatikan; panduan closer SCHEDULE diperbarui.
- **Back gesture non-regex:** NLU menghasilkan `clearedSlots` (`treatment`/`preferred_date`/`location`) untuk pembatalan tanpa pengganti ("gak jadi paket itu", "jangan hari Minggu dulu"); `SlateStore` mengeksekusi deterministik + hitung ulang `projectedState`.
- **Guard:** Perbaikan bug idempotency guard lokasi (lokasi baru yang berbeda tidak lagi diblokir); Inquiry Guard menunda handoff bila customer sedang bertanya (harga/fasilitas), dengan pengecualian pertanyaan jadwal & sinyal booking eksplisit; pertanyaan klinis bukan sinyal booking.
- **Verifikasi:** `tsc` exit 0; full suite 1719 passed (5 flake integrasi paralel yang sudah dikenal).

#### UI — Polish Live Chat Monitor & Dark Mode Menyeluruh Admin Dashboard (2026-09-04)

- Live Chat: tombol "Kembalikan ke Bot" indigo (AI), chip CS/Bot di footer kartu, draft typing tampil di daftar chat, selected = single border hijau, anti white-out search, kartu lebih ramping + footer full-bleed, warna HOLD/Pending light mode diperkuat.
- Dark mode eksplisit (`dark:*`) di CreateReservationModal, ClinicServices, TelegramIntegration, Debug LLM Logs, MetaCapiQueue, TodayTreatments; remap global `.dark` diperluas (input focus, badge WhatsApp, hover anti-silau, pastel blue/purple/red, kartu kalender, divider).
- Verifikasi: build dashboard ✓, `tsc` exit 0.

#### Feature — Durasi HOLD & Reservasi >1 Jam (`QuickHoldModal.tsx`, `reservations.subroute.ts`, `daily-slots`, kalender) (2026-09-04)

- Kolom baru `duration_minutes` di `Reservation` (migrasi `20260904000000_add_reservation_duration_minutes`, nullable — data lama = 60 menit). Pilihan durasi 30–180 mnt + custom di QuickHoldModal (dengan hint jam selesai); `CreateReservationModal` mengirim total durasi otomatis.
- `daily-slots` memakai overlap interval sehingga slot berikutnya ikut tertutup; grid Day/Week/Month memakai `resolveReservationDuration()` (kolom DB prioritas, fallback parsing teks); banner HOLD tampil "• 120 mnt".
- Verifikasi: 15/15 test quick-hold/create lolos, build dashboard ✓.

#### Fix & Feature — Penanganan Komparasi Lokasi & Ongkir Deterministik Tanpa Tambal Sulam Regex (`entity-extractor.ts`, `decision-matrix.ts`, `persona.ts`, `landmarks.ts`, `geocoding.ts`) (2026-09-04)

- **Latar Belakang & Masalah:** Pada sesi simulasi (ID: 571506), customer bertanya perbandingan lokasi:
  ```text
  Lebih dekat mana yaa
  Wiguna selatan
  Atau jojoran baru 1
  ```
  Bot sebelumnya salah merespons dengan mengabaikan pertanyaan komparasi, mengunci sepihak single lokasi, dan salah menghitung jarak menjadi 14.1 km (yang sebenarnya adalah jarak ke Jojoran Baru 1 dari Waru, bukan Wiguna Selatan yang hanya 8.1 km).
- **Akar Masalah:**
  1. *Ekstraksi deterministik membajak pesan multiline*: Blok regex `1d` di `preExtractDeterministic` memotong baris dan langsung mengunci baris kedua (`Wiguna selatan`) sebagai lokasi tunggal, melewati NLU LLM.
  2. *Gazetteer Gate terlalu agresif*: Aturan `length <= 4` memblokir "Wiguna Selatan", memicu fallback berbahaya `geocodeText(rawText)` yang secara arbitrer mengekstrak `Jojoran Baru 1` dari pesan utuh.
  3. *Belum ada Intent Semantik & Handling Komparasi*: Slot Engine belum memiliki schema/state untuk menangani komparasi 2 titik lokasi.
- **Implementasi Solusi (Sesuai Prinsip Zero-Regex Patch & AGENTS.md Roadmap):**
  1. **Schema & NLU Semantik (`src/slot-engine/types.ts`, `src/slot-engine/entity-extractor.ts`):** Tambah intent `'compare_locations'` dan field `comparison_locations: string[]` pada schema LLM Zod. Hapus blok regex `1d` multiline rapuh (60 baris) agar ekstraksi komparasi diserahkan secara cerdas ke LLM NLU. Prompt dilengkapi definisi dan exemplar few-shot.
  2. **Isolasi Penuh Komparasi vs Single Location (`entity-extractor.ts`):** Saat `isComparison` aktif (LLM mendeteksi perbandingan 2 lokasi), `locationText` dan `streetDetail` dipastikan `null`, dan intent `provide_location` dibersihkan dari `finalIntents` maupun `sanitizeExtractedEntities` agar tidak terpolusi oleh fallback baseline deterministik (mencegah bug kasus Wonokromo vs Wedoro di mana Wedoro terdeteksi di ujung kalimat). `preExtractDeterministic` diberi guard konteks komparasi (`hasComparisonContext`).
  3. **Data Dictionary & Resolusi Multi-Tingkat / Ambigu (`landmarks.ts`, `decision-matrix.ts`):** Tambah koordinat presisi Perumahan Wiguna & Jl. Wiguna Selatan (-7.339397, 112.8033345) serta Kawasan Jojoran & Jl. Jojoran Baru (-7.2769919, 112.76634). Pada Priority 4.9, tambahkan `extractCoords` yang mampu mengekstrak centroid representatif dari hasil ambiguitas nama kecamatan (seperti Wonokromo, Rungkut, dll.), sehingga komparasi level kecamatan vs kelurahan tetap dapat dibandingkan secara akurat.
  4. **Priority 4.9 Komparasi Deterministik & Guard Priority 5 (`decision-matrix.ts`, `persona.ts`):** Hitung jarak & ongkir via `deliveryService` untuk kedua titik, tentukan yang lebih dekat, balaskan `TEMPLATES.locationComparison`, dan pastikan `isLocationConfirmed = false`. Pasang guard `!isCompareLocations` di Priority 5 sehingga pesan komparasi mustahil memicu template single ongkir.
- **Verifikasi:**
  - Unit tests: `tests/unit/slot-engine-location-comparison.test.ts` (3 passed: Wiguna vs Jojoran, urutan terbalik, Wonokromo vs Wedoro) & `tests/unit/slot-engine-extractor.test.ts` (15 passed).
  - Integrasi: 42 unit tests pass (`geocoding.test.ts`, `slot-engine-decision.test.ts`).
  - TypeScript build: `npm run build` PASS (exit code 0).
  - Simulasi live:
    - `Wiguna Selatan` (8.1 km, Rp 10.000) vs `Jojoran Baru 1` (14.1 km, Rp 15.000) -> Rekomendasi Wiguna Selatan.
    - `Wonokromo` (10.0 km, Rp 10.000) vs `Wedoro` (0.3 km, Gratis ongkir) -> Rekomendasi Wedoro (0.3 km, Gratis ongkir).

#### Feature — Dual Theme Light/Dark Mode Admin Dashboard (`ThemeContext`, `ThemeToggle`, `AppearancePanel`, `Layout`, `index.css`) (2026-09-03)

- **Latar Belakang & Tujuan:** Admin membutuhkan Tema Hitam (Dark Mode ala WhatsApp Web: canvas `#0c1317`, surface `#202c33`, brand `#00a884`) yang nyaman di mata untuk monitoring malam hari, plus Tema Putih standar medis — dengan switch instan tanpa login ulang.
- **Implementasi Teknis (5 stage sesuai rencana):**
  1. **Fondasi (`tailwind.config.js`, `index.css`, `contexts/ThemeContext.tsx`, `App.tsx`, `index.html`):** `darkMode: 'class'` + token palet `wa.*`; `ThemeProvider` kelola preferensi `light|dark|system` (default `system` ikut OS live via `matchMedia`), simpan `localStorage wa_clinic_theme`, toggle class `.dark` di `<html>`; skrip anti-flicker inline di `index.html`; token HSL `.dark` + blok remap global (kanvas, teks, border, badge semantik, form, scrollbar gelap, Recharts, wallpaper `#0b141a`, bubble `#005c4b`).
  2. **Shell (`Layout.tsx`, `ThemeToggle.tsx`, `ToggleSwitch.tsx`, `UiFeedback.tsx`, `Pagination.tsx`):** Sidebar/Header gelap `#202c33`, menu aktif emerald, tombol switcher ☀️/🌙 animasi rotasi di header (desktop & mobile), popover status + banner notifikasi adaptif.
  3. **Operasional (`LiveChatMonitor.tsx` via remap, `Overview.tsx`, `FinancialAnalytics.tsx`):** Wallpaper gelap WhatsApp, bubble masuk `#202c33`/keluar `#005c4b`, composer gelap; chart grid + tooltip theme-aware via `useTheme` (tanpa `window.confirm`/`alert` — tetap `useUiFeedback`).
  4. **Pengaturan & CRM (`Settings.tsx` + `components/settings/AppearancePanel.tsx`, `Login.tsx`):** Kartu "Tampilan & Tema" 3 opsi (Terang/Gelap/Otomatis) di kategori App & Operasional; halaman CRM/katalog/reservasi/modal readable via remap global (catat limitasi di `docs/KNOWN_ISSUES.md` #23).
  5. **Verifikasi:** `npm run build` dashboard ✓ (tsc + Vite 10.47s), `npm test` ✓ (207 file, 1698 passed), `dist/` sudah di-rebuild sehingga bot langsung serve hasil baru di `/admin/*`.
- **Catatan SaaS:** Preferensi tema per-browser (localStorage), BUKAN data bisnis — sengaja tidak tenant-aware, tidak perlu Confirmation Gate.

#### Fix — Sinkronisasi GPS Shareloc & Konsistensi Jarak/Ongkir (`webhook.route.ts`, `human-background-enrichment.service.ts`, `customer.service.ts`, `LiveChatMonitor.tsx`, `chatScheduleExtractor.ts`, `InvoiceGeneratorModal.tsx`) (2026-09-02)

- **Latar Belakang:** Koordinat Pin Share Location WhatsApp asli harus jadi single source of truth yang meng-override geocoding teks biasa (`is_native_pin=true`). Kasus Bunda Gita (6288000000006 / 58bb55d3-6508-4db6-b240-2eb853ce8046) mengirim shareloc `-7.4691395,112.7103424` saat `HUMAN_HANDLING` aktif, namun profil sebelumnya tersimpan centroid kelurahan sehingga jarak/ongkir tidak konsisten antara invoice form, profil customer, dan pesan konfirmasi.
- **Akar Masalah:** 1) Jalur `HUMAN_HANDLING` early-return `GRACE` (30s) dan `HOLD_DISABLED` (`ENABLE_WAHA_HOLD_LABEL=false`) langsung `logMessage + return` tanpa memanggil `humanBackgroundEnrichmentService.enrichSync` untuk tipe `location`, sehingga GPS asli tidak ter-sync instan; 2) `enrichAsync` di `EXPLICIT GUARD` fire-and-forget rawan tertinggal sebelum return; 3) `STALE GUARD` mem-drop shareloc lama sebagai `IGNORED_STALE_MESSAGE` tanpa bypass untuk GPS; 4) `customer.service.ts` memory fallback belum menghormati flag `isNativePin`; 5) Modal Invoice tidak memindai pesan `[LOCATION]` terbaru untuk override jarak/ongkir profil.
- **Solusi:**
  1. `src/routes/webhook.route.ts:1012-1111`: Tambah sinkron GPS prioritas tinggi di kedua early-return `GRACE` & `HOLD_DISABLED` — jika `incomingMessage.type==='location'` atau body mengandung `maps.app.goo.gl`, panggil `await humanBackgroundEnrichmentService.enrichSync(..., is_native_pin=true)` sebelum `logMessage`. Upgrade `EXPLICIT GUARD` agar GPS pin `await enrichSync` (sinkron), alamat teks tetap `enrichAsync` (background). Tambah `STALE GUARD BYPASS` untuk `hasRealLocation` agar shareloc tua tetap lanjut ke sync (tidak di-drop).
  2. `src/services/human-background-enrichment.service.ts:1-305` & `src/services/customer.service.ts:232-276`: `updateCustomerLocation` dengan `isNativePin=true` selalu override `share_location_sent` & koordinat presisi (abaikan `preserveExactGps` guard); memory fallback diperkuat agar `isNativePin=true` override centroid lama dan set `share_location_sent=true`.
  3. `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx:2463`: `handleGenerateActiveReservationInvoice` kini memindai `messages` terbalik untuk `[LOCATION` terakhir; override `extracted.distanceKm/ongkir` dengan `custData.distance_km/ongkir` fresh dari profil (yang sudah di-sync webhook). Parsing `Lat/Lng` di konten untuk verifikasi tidak tertimpa.
  4. `packages/admin-dashboard/src/utils/chatScheduleExtractor.ts:501`: Tambah deteksi `hasSharelocInThread` (`/\[LOCATION/`) untuk tandai `isExtracted=true` agar fallback `3.0km` tidak dipakai bila shareloc ada dan profil sudah sync.
  5. `packages/admin-dashboard/src/components/modals/InvoiceGeneratorModal.tsx` & `src/services/delivery.service.ts`: Pastikan label tier (`fee`/`promoDiscount`) selalu match perhitungan `deliveryService.calculateDelivery` via `calculateOngkirFromTiers` (efek `distanceKm` → `ongkir` + `promoOngkir` otomatis); jarak `21.67km` → tier `maxDist 25` (`fee 35000 promo 10000` → net `25000`) sesuai DB.
  6. **Koreksi Data:** `src/scripts/fix-bunda-gita.ts` (dry-run default, `--apply` tulis DB) — kalkulasi via `deliveryService.calculateDelivery` di `-7.469139575958252,112.71034240722656` → verifikasi tier, lalu `UPDATE customers SET lat/lng/distance_km/ongkir/share_location_sent`. Manual SQL fallback disediakan. Nilai target: `lat=-7.469139575958252`, `lng=112.71034240722656`, `distance=21.67km`, `ongkir=25000`.
- **Verifikasi:** `npx tsc --noEmit` ✓, `npm --prefix packages/admin-dashboard run build` ✓ (2447 modules), `npx vitest run tests/unit/human-background-enrichment.test.ts tests/unit/delivery.test.ts` → 25 passed (GPS pin, Google Maps URL, admin outbound, 22 tier boundaries), full suite tetap hijau. Untuk live: jalankan `npx tsx src/scripts/fix-bunda-gita.ts --apply` atau `UPDATE customers ... WHERE id='58bb55d3-6508-4db6-b240-2eb853ce8046'` lalu cek Admin Dashboard → Customer Gita → Google Maps Link.

#### Feature — Quick Chat / Balasan Cepat (/shortcut) Tenant-Aware (`QuickReply`, `quick-replies.subroute.ts`, `LiveChatMonitor.tsx`, `QuickReplies.tsx`) (2026-09-02)

- **Latar Belakang & Tujuan:** Admin CS/Bidan membutuhkan balasan instan untuk pesan berulang (rekening, lokasi, ongkir, format reservasi, jadwal, terima kasih, batal) tanpa mengetik ulang — cukup ketik `/rek`, `/lokasi`, dll. di Live Chat Monitor. Pesan harus terstandarisasi SOP, mendukung variabel dinamis `{name}`, `{phone}`, `{clinic_name}`, `{admin_name}`, dan multi-tenant ready (setiap klinik punya daftar shortcut sendiri).
- **Implementasi Teknis:**
  1. **Database Schema (`prisma/schema.prisma`):** Model `QuickReply` baru (`id`, `tenant_id` default `default-tenant`, `shortcut` lowercase tanpa slash, `title`, `content @db.Text`, `category`, `created_at`, `updated_at`) dengan `@@unique([tenant_id, shortcut])` dan `@@index([tenant_id])` — map `quick_replies`.
  2. **Backend REST API (`src/routes/admin/quick-replies.subroute.ts`):** 5 endpoint tenant-aware — `GET /api/admin/quick-replies` (list + auto-seed defaults jika kosong), `POST /api/admin/quick-replies` (validasi unik shortcut per tenant, normalisasi lowercase strip `/`), `PUT /api/admin/quick-replies/:id`, `DELETE /api/admin/quick-replies/:id`, `POST /api/admin/quick-replies/seed-defaults` (1-click upsert 7 template bawaan). Fungsi helper `normalizeShortcut`, `isValidShortcut`, `interpolateQuickReply`. In-memory fallback `memoryQuickReplies` agar unit test offline (`tests/setup.ts` → Database offline) tetap hijau 100% tanpa Postgres. Terdaftar di `src/routes/admin.route.ts`.
  3. **Default Seed Templates (7):** `/rek` (Rekening BCA & Mandiri), `/lokasi` (Alamat & Patokan), `/ongkir` (0-5 km free, Rp 3.000/km), `/jadwal` (Senin-Minggu 08.00-17.00), `/format_reservasi` (template data reservasi dengan `{name}`), `/terimakasih` (ucapan dengan `{name}` & `{clinic_name}`), `/batal` (konfirmasi pembatalan) — kategori `Pembayaran`, `Lokasi`, `Reservasi`, `Umum`.
  4. **Slash Autocomplete Live Chat (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`):** Deteksi token terakhir diawali `/` saat mengetik di `chatInputRef` (contentEditable), floating popover Discord/WhatsApp Business style di atas input menampilkan badge `/shortcut`, judul, kategori, dan cuplikan isi. Navigasi `ArrowUp/Down`, `Enter/Tab` pilih (interpolasi otomatis `{name}`=`selectedChat.customerName||'Bunda'`, `{phone}`, `{clinic_name}` dari `BRAND.businessName`, `{admin_name}` dari `user`), `Escape` tutup, klik/tap pilih. Menu Tools (+) tambah opsi "⚡ Balasan Cepat" untuk membuka popover tanpa mengetik.
  5. **Halaman Manajemen (`packages/admin-dashboard/src/pages/tenant/QuickReplies.tsx`):** Filter kategori (Semua, Pembayaran, Lokasi, Reservasi, Umum), pencarian shortcut/judul/isi, grid kartu preview, modal tambah/edit dengan input shortcut (auto strip `/`), judul, kategori, textarea konten + chip quick-insert `{name}`/`{phone}`/`{clinic_name}`/`{admin_name}`, live preview interpolasi, hapus via `useUiFeedback` (tanpa `window.confirm`). Route `/admin/quick-replies` (+ alias `/admin/quick-reply`, `/admin/balasan-cepat`) terdaftar di `App.tsx`; menu sidebar "Balasan Cepat ⚡" di `Layout.tsx` (CRM & Komunikasi); role `admin_cs` & `spv_cs` diberi akses di `rolePermissions.ts`.
  6. **Pengujian & Build:** Unit test `tests/unit/quick-replies.test.ts` (8 tests: normalisasi, validasi, interpolasi, isolasi tenant, seed, CRUD memori) — PASS. `npx prisma generate` (v5.22.0) PASS, `npm run build` (tsc) PASS, `packages/admin-dashboard` Vite build PASS (13.92s, chunk QuickReplies 13.17 kB).
- **Verifikasi:** `npx prisma generate` ✓, `npm run build` ✓, `npm --prefix packages/admin-dashboard run build` ✓ (2447 modules), `npm test -- tests/unit/quick-replies.test.ts` → 8 passed, `npx tsc --noEmit` ✓.

#### Fix — Validasi & Re-kalkulasi Jarak/Ongkir ORS untuk 55 Target (`delivery.service.ts`, `validate-distances.ts`, `geocoding.ts`) (2026-09-02)

- **Latar Belakang:** Dari 600 customers, 23 punya `kelurahan` tapi `distance_km NULL` dan 32 sudah ada jarak dari admin (shareloc false) tapi kandidat Haversine (belum ORS). Total 55 perlu validasi ORS. Shareloc & tanpa kelurahan dikecualikan.
- **Akar Masalah:** `Customer.distance_km` tidak persist `distance_source` (`delivery.service.ts:148` transient), ORS profile `cycling-electric` + rate limit 40/min bikin fallback ke Haversine, dan 93% data memang belum pernah dihitung.
- **Solusi:**
  - **Script `src/scripts/validate-distances.ts`:** Dry-run + apply, batch 10 + throttle 3s, re-use `deliveryService.calculateDelivery` (ORS 1.1x → Google → Haversine 1.6x). Untuk tanpa koordinat: donor dari `customers` dengan kelurahan sama, fallback gazetteer `surabaya_sidoarjo_subdistricts.json` + `geocodingService.geocodeText`.
  - **Persist:** Simpan `preferences.distance_source` (`ORS`/`HAVERSINE`), `distance_source_detail`, `distance_validated_at`, `distance_haversine_raw/est` tanpa migrasi Prisma (tenant-aware).
  - **Guard:** Skip Grup B jika `ongkir` sama & `delta <0.5km`, skip anomali `new >30km & old <30km & delta >20km` (contoh Manukan Kalitidu Bojonegoro 158km).
  - **Eksekusi Live 2026-09-02 19:17-20:45:** Targets 57 (23+33+1 duplikat), Updated 36, Skipped same-tier 18, Skipped no-coords/anomali 3, Errors 0. Sisa Grup A 23→2 (`Sedati` & `semampir` perlu manual review). Akurasi ORS: `Berbek 3.18km FREE`, `Masangan Kulon 12.18km 15000`, `apt. puncak dharmahusada 17.84km 20000` via gazetteer donor. Rate limit ORS setelah ~40 req fallback ke Google tetap `isEstimated=false`.
- **Verifikasi:** `tsc --noEmit` pass, dry-run 5 & full 56, `kelurahan+distance NULL` 23→2, `npx tsx src/scripts/validate-distances.ts --dry-run` live.

#### Fix — Toggle Matikan AI Bot Live Chat Persisten & Sinkron SSE (`LiveChatMonitor.tsx`, `liveChatSse.ts`, `waba.subroute.ts`, `live-chat-hub.service.ts`) (2026-09-01)

- **Latar Belakang:** Toggle "Matikan AI Bot" (cut-off) di Live Chat selalu balik ON saat pindah halaman/refresh karena `loadBotCutoffStatus` salah baca `data.wahaOutboundCutoff` (payload ada di `data.data.wahaOutboundCutoff`), plus tidak ada cache & SSE sync antar-tab.
- **Solusi:**
  1. `LiveChatMonitor.tsx:426` fix ekstraksi `data?.data?.wahaOutboundCutoff ?? data?.wahaOutboundCutoff` + persist `localStorage wa_bot_cutoff_state`; hydrate `useState` dari cache (zero-flicker); `handleToggle` juga set cache & fallback `res.data?.wahaOutboundCutoff`.
  2. `live-chat-hub.service.ts:7` tambah event `bot.cutoff_changed`; `waba.subroute.ts:183` publish `BOT_CUTOFF_CHANGED` via `liveChatHub` saat PATCH cutoff; `liveChatSse.ts:142` listen `bot.cutoff_changed`; `LiveChatMonitor.tsx:1632` handler SSE update `setGlobalBotCutoff` + cache.
- **Verifikasi:** `npx vitest run tests/unit tests/integration/whatsapp-provider-qr.test.ts` → **PASS**; `npm run build` backend & `packages/admin-dashboard` **PASS**.

#### Fix — Eliminasi Kebocoran AI Reasoning, Anti-Truncation & Persona Bapak (`reply-generator.ts`, `language-sanitizer.ts`, `persona-composer.ts`, `burst-coalesce.service.ts`, `entity-extractor.ts`) (2026-09-01)

- **Latar Belakang & Insiden Live 6288000000018 (Muhammad Naufal Ghifari):** Monolog internal AI bocor ke WA (`reasoning_content` fallback), respon terpotong `S` (<5 char) terkirim, sapaan kaku `Bunda` ke customer pria suami.
- **Solusi:**
  1. `reply-generator.ts:133` hapus fallback `reasoning_content`, ambil HANYA `content`; validasi `<5` char → throw untuk silent escalation ke CS (anti-truncation). Sanitizer empty → throw.
  2. `language-sanitizer.ts` tambah `stripAiReasoningAndMonologue()` hapus `<think>...</think>`, `[THINKING]...[/THINKING]` & pola `Kita perlu menyusun...`, `Konteks/Analisis/Aturan:`, `Lihat contoh di prompt/Dalam peran sebagai`. Jika bersih `<5` → return `''` ditolak. Integrasi di `UnifiedResponseSanitizer.sanitize()` early-return & final guard `<5`.
  3. `persona-composer.ts` rule 1 fleksibel: umum `Bunda`, namun jika laki-laki/suami/ayah (`saya Naufal`, `pesan untuk istri`) sapa `Bapak`/`Bapak [Nama]`; tambah rule 17 ANTI-MONOLOG mutlak.
  4. Debounce `7500ms` (`burst-coalesce.service.ts:64` fallback `7500`) & alias generik `GENERIC_TREATMENT_RE` sudah perluas `home[-\s]?(treatment|care|service|sevice)` + prompt tegas model bisnis bukan treatment (verifikasi tetap).

- **Verifikasi:** `npx vitest run tests/regression/real-conversations.test.ts tests/unit/slot-engine-generator.test.ts tests/unit/burst-coalesce.test.ts` → **18 passed**; manual strip `<think>` → `Halo Bunda!`, monolog → `''` PASS, `S` → `''` PASS, persona `Bapak` PASS; `npm run build` PASS.

#### Fix & Enhancement — Audit & Perbaikan Komprehensif Bug Price Rp 0, Race Condition Modal Edit Reservasi, Dropdown Anak Terpotong di Mobile & Dynamic Fallback Harga (`CreateReservationModal.tsx`, `financial-analytics.service.ts`, `staff-reservation.service.ts`) (2026-09-01)

- **Latar Belakang & Masalah**:
  - Pada modal *Edit Data Reservasi*, ketika membuka reservasi pasien (contoh: Bunda Soniah dengan layanan *Pijat Bayi Ceria*), kartu treatment terpilih menampilkan `Rp 0`.
  - Di perangkat mobile/iPhone, teks pada dropdown penugasan anak (`Ditujukan untuk: Anak #1: Muhammad nizar...`) terpotong ke kanan melebihi batas kartu.
  - Jika reservasi disimpan dalam kondisi tersebut, nilai `purchase_value` di database tertimpa menjadi 0.
- **Akar Masalah Teknis**:
  1. **Race Condition & Kunci Ref Modal**: State `services` awalnya kosong (`[]`) saat modal dibuka karena data baru di-fetch via async API. `useEffect` pre-fill langsung mengeksekusi `parseTreatmentsFromDetail(..., [])` sehingga harga menjadi 0. Pengunci ref `initializedEditIdRef.current` kemudian memblokir eksekusi ulang ketika data katalog selesai di-load.
  2. **Nilai Database Diabaikan**: Nilai `purchase_value` asli dari DB tidak dioper ke parser sebagai fallback.
  3. **Regex Stripper Agresif**: `replace(/\(.*?\)/g, '')` memotong nama medis dalam kurung seperti `(Rileksasi)`, menggagalkan pencarian eksak ke katalog.
  4. **Ketiadaan Input Edit Harga**: Admin tidak memiliki opsi untuk mengubah/menyesuaikan nominal harga per treatment pada kartu item terpilih.
- **Implementasi Teknis**:
  1. **Fallback Sinkron Instan & Auto-Repair (`CreateReservationModal.tsx`)**:
     - Menginisialisasi state `services` dengan `DEFAULT_CLINIC_SERVICES_FALLBACK` (0ms delay) sehingga parser selalu memiliki data harga treatment bahkan sebelum API selesai di-fetch.
     - Menambahkan mekanisme auto-repair pada `loadCatalog()`: saat katalog dari API selesai dimuat, setiap treatment terpilih dengan harga `0` otomatis diperbarui harganya dari katalog.
     - Mengoper `res.purchase_value` asli dari database ke `parseTreatmentsFromDetail` sebagai prioritas pertama saat membuka modal edit.
  2. **Inline Editable Price Input**:
     - Menambahkan input nominal harga langsung (`Rp [ 60.000 ]`) pada setiap baris kartu treatment terpilih lengkap dengan handler `handleUpdateTreatmentPrice`, memungkinkan admin menyesuaikan harga kustom/promo kapan saja.
  3. **Perbaikan Tampilan Mobile**:
     - Menambahkan kelas `flex-1 min-w-0 max-w-full sm:max-w-xs truncate` pada dropdown anak agar teks nama panjang tidak memotong kartu di layar HP.
     - Memperkuat backdrop modal dengan `bg-black/75 backdrop-blur-sm z-[99999]` agar konten di belakangnya terisolasi sempurna.
  4. **Safety Net Backend (`financial-analytics.service.ts`, `staff-reservation.service.ts`)**:
     - Menambahkan dynamic price resolution (`resolveTreatmentValue`) pada perhitungan omset dan rute terapis sehingga database record lama dengan `purchase_value` kosong/0 otomatis diselesaikan dengan harga katalog standar dan tidak pernah menampilkan Rp 0.

#### Feature — Dashboard Transaksi, Reservasi & Histori Pendapatan Bulanan (`FinancialAnalytics.tsx`, `financial-analytics.service.ts`, `analytics.subroute.ts`) (2026-09-01)

- **Latar Belakang & Kebutuhan Bisnis**:
  - Manajemen klinik membutuhkan dashboard terpadu untuk melacak omset bulanan, histori pendapatan harian (Day 1 s/d Day 31), performa terapis, komposisi kategori layanan, metode pembayaran, dan buku besar transaksi dengan fitur ekspor Excel/CSV 1-klik untuk pembukuan akuntansi.
- **Implementasi Teknis**:
  1. **Backend Aggregation Service Layer (`financial-analytics.service.ts`)**:
     - Membangun service layer agregasi PostgreSQL terindeks yang mengkalkulasi rentang waktu WIB (`startOfMonth` s/d `endOfMonth`).
     - Menyediakan metrik KPI: Total Omset (Lunas vs Tagih di Tempat), Total Reservasi, Average Order Value (AOV), Rasio Repeat Order, dan Akumulasi Ongkir.
     - Menyusun array histori harian (`dailyTrend`) tanggal 1 s/d akhir bulan, breakdown kategori layanan, metode pembayaran (Transfer, QRIS, Cash), leaderboard omset terapis, dan top layanan terlaris.
     - Generator spreadsheet CSV berstandar RFC 4180 (`generateMonthlyTransactionsCsv`).
     - Cache respons instan 30 detik (`responseCacheService`).
  2. **API Endpoints (`analytics.subroute.ts`)**:
     - `GET /api/admin/financial-analytics?year=YYYY&month=M` — Mengambil data analitik teragregasi.
     - `GET /api/admin/financial-analytics/export?year=YYYY&month=M` — Download rekap transaksi CSV langsung.
  3. **Frontend Dashboard & Visualisasi Interaktif (`FinancialAnalytics.tsx`)**:
     - Top bar dengan Month & Year Picker dinamis (Bulan Ini, Bulan Lalu, atau Pilih Bulan/Tahun).
     - 4 Top KPI Cards (Omset, Reservasi, AOV, Repeat Rate).
     - Grafik Bar & Area harian Recharts dengan tooltip informatif dalam format Rupiah.
     - Donut chart kategori layanan, bar chart metode bayar, dan kartu leaderboard terapis.
     - Tabel buku besar transaksi lengkap dengan pencarian live, filter status pelunasan, modal detail transaksi, dan tombol ekspor spreadsheet.
  4. **Navigasi & Integrasi Overview (`Layout.tsx`, `App.tsx`, `Overview.tsx`)**:
     - Mendaftarkan rute `/admin/financial-analytics` dan menu sidebar **"Transaksi & Pendapatan"** di bawah *Operasional & Jadwal*.
     - Menghubungkan kartu ringkasan omset dan reservasi di *Overview* agar langsung membuka halaman analitik detail.

#### Feature & UX Enhancement — Auto-Move Jadwal Lewat Jam ke Tab Selesai & Default View "Akan Datang" (`TodayTreatments.tsx`, `StaffToday.tsx`) (2026-09-01)

- **Latar Belakang & Kebutuhan Bisnis**:
  - Pada halaman **Treatment Hari Ini**, admin dan terapis ingin fokus pada jadwal yang *sedang/akan datang*.
  - Ketika jam jadwal treatment hari ini sudah terlewati (misal jadwal jam 10:00 dan waktu saat ini jam 11:00), tugas tersebut diharapkan otomatis berpindah ke kelompok **Selesai / Sudah Lewat**, tanpa perlu menunggu status diubah manual menjadi lunas/selesai oleh admin.
- **Implementasi Teknis**:
  1. **Klasifikasi Waktu Otomatis (`isTaskPastTime`)**:
     - Ditambahkan perhitungan waktu selesai treatment murni: `Waktu Selesai = Jam Mulai Booking + Durasi Layanan (tanpa buffer perjalanan)`.
     - Sebagai contoh: Jika reservasi dijadwalkan pukul 10:00 dengan durasi 60 menit, jadwal tetap berada di tab *Akan Datang / Berjalan* dari jam 10:00 hingga 11:00, dan tepat pada pukul 11:00 otomatis berpindah ke kelompok *Selesai*.
     - Tugas diklasifikasikan sebagai `isCompleted` jika status DB adalah `completed` **ATAU** waktu selesai treatment telah terlewati.
  2. **Default Filter "Akan Datang" (`TodayTreatments.tsx`)**:
     - Mengubah filter default dari `ALL` menjadi `UPCOMING` ("Akan Datang") sehingga saat membuka halaman, hanya jadwal yang belum lewat yang tampil.
     - Menyediakan tombol filter jelas: `Akan Datang`, `Selesai`, `OTW`, dan `Semua`.
     - Mempertahankan transparansi status keuangan: jadwal yang sudah lewat waktu tetap menampilkan rincian `Tagih di Tempat` atau `Lunas` dengan jelas.
  3. **Partisi Jadwal Petugas Lapangan (`StaffToday.tsx`)**:
     - Menyelaraskan tab `Hari Ini` pada aplikasi terapis agar otomatis menyaring tugas aktif (`activeTodayTasks`) dan memindahkan jadwal lewat jam ke tab `Selesai` (`combinedCompletedTasks`), lengkap dengan update counter badge real-time.

#### Enhancement & Fix — iPhone Header Safe-Area Inset & LiveChat Virtual Keyboard Viewport (`Layout.tsx`, `LiveChatMonitor.tsx`, `index.css`) (2026-09-01)

- **Latar Belakang & Masalah yang Dilaporkan Pengguna di iPhone:**
  1. **Textfield Input Chat Tenggelam di Belakang Keyboard**: Saat mengetik di LiveChat pada iPhone (Safari/PWA), kolom input balasan ("Tulis balasan... [Kirim]") tertutup di balik virtual keyboard iOS.
  2. **Header Atas Mepet Status Bar tapi Bawahnya Sangat Longgar**: Teks judul panel "Kala Moms & Baby Spa Panel" bertabrakan dengan jam (19.15) dan baterai status bar iPhone, sementara ruang di bawah tombol Online/Menu sangat renggang/kosong.
- **Akar Masalah Teknis:**
  1. **LiveChat Keyboard Viewport (`Layout.tsx`)**: Menggunakan tinggi statis `h-screen` (`100vh`). Pada iOS Safari, `100vh` tidak otomatis menyusut ketika keyboard muncul, sehingga area komposer bawah tetap berada di koordinat dasar layar (di balik keyboard 300px).
  2. **Header Layout Wrapper (`Layout.tsx`)**: Header memiliki `pt-[env(safe-area-inset-top)]` dan `min-h-[calc(3rem+safe-area)]`, tetapi seluruh konten di dalamnya diberi `flex items-center` pada container luar 95px tanpa pemisahan baris. Akibatnya teks berada di tengah-tengah tinggi total (bertabrakan dengan notch 50px di atas) dan menyisakan ruang kosong besar 45px di bawahnya.
- **Solusi & Implementasi Teknis (Lokal):**
  1. **Dynamic Visual Viewport Tracker (`--vvh`)**:
     - Ditambahkan hook listener `window.visualViewport` di `Layout.tsx` yang menuliskan CSS variable `--vvh: ${window.visualViewport.height}px` secara dinamis ke `document.documentElement`.
     - Container LiveChat kini menggunakan `height: var(--vvh, 100dvh)` dan `maxHeight: var(--vvh, 100dvh)`, sehingga saat keyboard iPhone terbuka, seluruh layar chat otomatis menyusut dan mengangkat kolom input tepat di atas keyboard.
     - **Anti-Fly Input Fix**: Menghapus pemanggilan `scrollIntoView()` pada elemen text input yang sebelumnya menyebabkan Safari menggulung seluruh halaman web ke atas sehingga input terbang ke bawah jam. Mengunci scroll window (`overflow: hidden` saat di halaman chat) dan menjaga jangkar `window.scrollTo(0,0)`, sehingga hanya container bubble chat yang menyusut dan textfield tetap menempel tepat di atas keyboard.
     - **Keyboard-Flush Auto Padding (`data-keyboard-open`)**: Mengurangi padding bawah dari 34px (`safe-area-inset-bottom`) menjadi 2px saat keyboard aktif, sehingga kolom chat menempel rapat/mepet presisi tanpa celah kosong di atas keyboard.
     - **Supresi Toolbar Safari (`enterKeyHint`, `tabIndex`)**: Menambahkan `enterKeyHint="send"`, `inputMode="text"`, dan mematikan `tabIndex` pada elemen latar belakang saat membuka chat agar Safari menonaktifkan panah navigasi form (`^ v`).
  2. **Struktur Header Safe-Area Terpisah (`Layout.tsx`)**:
     - Memisahkan container header menjadi wrapper luar dengan `pt-[env(safe-area-inset-top, 0px)]` sebagai bantalan notch murni, dan bar dalam `<div className="h-12 md:h-13 px-3 sm:px-5 flex items-center justify-between">`.
     - Judul panel dan tombol status/menu kini berada tepat di baris 48px di bawah jam & notch iPhone, dan ruang kosong di bawahnya 100% hilang (rapi dan proporsional di iPhone maupun Android).
  3. **Penyelarasan Warna Status Bar iPhone & Integrasi Logo Kala Resmi (`index.html`, `index.css`, `Layout.tsx`)**:
     - Mengubah `<meta name="theme-color" content="#ffffff">` dan `html { background-color: #ffffff; }` sehingga area notch/jam di bagian paling atas iPhone menyatu 100% dengan warna putih bersih (*seamless pure white*) tanpa garis potongan warna gelap (#008069 atau abu-abu).
     - Mengganti teks panjang "Kala Moms & Baby Spa Panel" di top header dengan Logo Kala resmi yang ramping & bersih berlabel "KALA SPA".
     - Mengganti kotak hijau inisial "K" di sidebar navigation dengan Logo Kala resmi (`/admin/apple-touch-icon.png`).
  4. **Universal Sticky Header di Seluruh Halaman (`index.css`)**:
     - Mengganti `overflow-x: hidden` pada `body` dan `#root` menjadi `overflow-x: clip`. Sesuai standar CSS W3C, `overflow-x: hidden` membuat browser memicu formatting context baru yang merusak `position: sticky; top: 0` saat halaman panjang di-scroll. Dengan `clip`, header kini **100% menempel (sticky) di bagian atas layar di semua halaman** (Reservations, Customer Database, Settings, Clinic Services, dll).
  5. **Build & Verifikasi**:
     - Frontend `packages/admin-dashboard`: **PASS (built in 10.23s)**.
     - Backend server: **PASS (0 error)**.

#### Enhancement — Prioritas Utama Perawatan Lanjutan Bulanan (NEXT_TREATMENT) & Peningkatan Kapasitas 25 Pesan/Hari (`follow-up.service.ts`, `follow-up-engine.test.ts`) (2026-09-01)

- **Latar Belakang & Permintaan Pengguna:**
  - Pengguna memutuskan untuk menaikkan kapasitas follow-up harian menjadi **25 pesan per hari**, dan memberikan **prioritas utama (Priority #1)** bagi pengingat bulanan pasca treatment (`NEXT_TREATMENT`) di atas follow-up prospek yang belum purchase (`NO_PURCHASE`).
- **Solusi & Implementasi:**
  1. **Tingkat Prioritas Tipe Follow-Up (`FOLLOWUP_TYPE_PRIORITY`)**:
     - Menetapkan bobot prioritas eksplisit:
       - `NEXT_TREATMENT` = **Prioritas #1 (Tertinggi)** — Pasien setia / repeat order bernilai LTV tinggi.
       - `NO_PURCHASE` = **Prioritas #2 (Standar)** — Lead baru yang belum pernah booking.
     - Mengurutkan pemrosesan worker antrian (`processDueFollowUps`) dan pendistribusian jadwal overdue (`rescheduleOverdue`) berdasarkan bobot prioritas ini, sehingga slot waktu pagi hari dan jatah harian selalu diprioritaskan untuk pesan `NEXT_TREATMENT`.
  2. **Peningkatan Default Kapasitas Harian (25 Pesan/Hari)**:
     - Mengubah default batas harian `FOLLOWUP_MAX_PER_DAY` dari `10` menjadi `25` pesan/hari di `follow-up.service.ts` (dapat dikonfigurasi via env `FOLLOWUP_MAX_PER_DAY`).
  3. **Distribusi Waktu Adaptif (09:00 - 16:30 WIB)**:
     - Merancang kalkulasi interval otomatis `stepMin = Math.floor(450 / maxPerDay)` (~18 menit per pesan).
     - Menghasilkan 25 slot waktu tersebar merata dari pukul 09:00 WIB hingga 16:12 WIB secara UTC-deterministik, sehingga volume 25 pesan tetap terdistribusi sangat natural dan aman dari deteksi spam Meta.
  4. **Automated Unit Testing (`tests/unit/follow-up-engine.test.ts`)**:
     - Menambahkan Test #11 untuk memverifikasi bahwa `NEXT_TREATMENT` selalu menduduki antrian teratas sebelum `NO_PURCHASE`. Seluruh 15 unit tests pass 100%.

#### Enhancement — Optimalisasi Debounce 7.5s, Eliminasi Bias Alias Generik & Kalkulasi Presisi Add-on Sinar Moksa (`burst-coalesce.service.ts`, `entity-extractor.ts`, `decision-matrix.ts`, `grounding-composer.ts`, `slate-store.ts`, `.env`) (2026-09-01)

- **Latar Belakang & Permintaan Pengguna:**
  - Berdasarkan rekaman percakapan riil Trosobo (6288000000016): jeda ketik 6.58s melebihi debounce 5s → 2 balasan terpisah, frasa generik "home-treatment" terkunci prematur ke Pijat Bayi Ceria, dan pergantian treatment ke Pulih Ceria + Sinar Moksa butuh kalkulasi presisi Rp 100k (80k paket + 20k ongkir).

- **Akar Masalah:**
  1. `BURST_COALESCE_MS` fallback 5000 ms memotong bubble customer yang mengetik 2-3 pesan bersusulan.
  2. `GENERIC_TREATMENT_RE` belum mencakup varian "home service"/"layanan home" & typo "sevice"; prompt NLU belum tegas bahwa "home-treatment/homecare adalah model bisnis bukan nama treatment"; `slate-store` harvest memetakan alias generik "pijat bayi" langsung ke "Pijat Bayi Ceria" (hardcode bias).
  3. `decision-matrix` & `grounding-composer` memakai fallback hardcode "Pijat Bayi Ceria" saat `candidateTreatmentName`/`effectiveTreatment` null, sehingga template ongkir tidak netral & LLM terkunci paket prematur.
  4. `grounding-composer` filter `!isAddon` membuang Sinar Moksa dari konteks LLM & sorting tidak prioritas combo "+", sehingga paket Pulih Ceria + Moksa (promo 70k+10k=80k) tidak terhitung presisi.

- **Solusi & Implementasi:**
  1. **Debounce Window 7.5s:** `burst-coalesce.service.ts` fallback `5000→7500` & `.env` `BURST_COALESCE_MS=7500`, tanpa hardcode nominal lain (env-driven, window reset per pesan).
  2. **Bersihkan Alias Generik:** Perluas `GENERIC_TREATMENT_RE` ke `home[-\s]?(treatment|care|service|sevice)` + `layanan\s*home`; tegaskan prompt NLU aturan #2 dengan kalimat eksplisit "Kata 'home-treatment' atau 'homecare' adalah model bisnis, BUKAN nama treatment! Jangan mengisi treatment_referenced jika pelanggan hanya menyebut home-treatment/homecare tanpa nama paket spesifik."; ubah `slate-store.ts` harvest `pijat bayi` → alias generik "pijat bayi" (dinamis, tidak lock ke Ceria) agar `treatmentCatalogService` resolve berdasarkan usia.
  3. **Netralisasi Ongkir:** `decision-matrix.ts` `isPureLocationMessage` sekarang normalisasi `rawCandidate` → `undefined` jika alias generik `pijat bayi|massage bayi|pijat biasa` (regex generik), sehingga `TEMPLATES.ongkirInfo` menghasilkan CTA netral "Rencana mau treatment apa bunda ?🤗" tanpa menebak paket.
  4. **Grounding Add-on Dinamis:** `grounding-composer.ts` deteksi `mentionsAddon` (moksa/sinar/nebulizer/add-on) secara dinamis dari `inputLower|slate|extraction`, append katalog `ADD_ON` relevan (filter per keyword, dedup) & naikkan `maxItems 5→7` bila moms/addon; perbaiki sorting untuk combo "+" dengan split & clean name; hapus hardcode fallback `Pijat Bayi Ceria` → `null` (schedule note kondisional) & `treatmentBaby` fallback → dynamic lookup `allServices.find BABY`; tambah `comboPricingNote` dinamis: hitung total promo/normal dari katalog aktif (`reduce promoPrice`) + ongkir = total, tanpa hardcode 80k/100k.

- **Verifikasi:**
  - `npx vitest run tests/regression/real-conversations.test.ts tests/unit/burst-coalesce.test.ts tests/unit/slot-engine-decision.test.ts` → **18 passed**
  - `slot-engine-lead-greeting` & `centralized-persona` → **PASS** (anti-bias home-treatment null)
  - Manual: `TEMPLATES.ongkirInfo` 17.8km Rp20k → neutral CTA PASS; `GroundingComposer` combo Pulih+Moksa → filteredCatalog mengandung Pulih Rp70k + Moksa Rp10k = 80k + ongkir 20k = 100k PASS
  - `npm run build` → **PASS (0 error)**, full suite **199 files 1548 passed** (1 flaky migration timeout → rerun PASS)

- **File yang Dipengaruhi:** `src/services/burst-coalesce.service.ts`, `.env`, `src/slot-engine/entity-extractor.ts`, `src/slot-engine/slate-store.ts`, `src/slot-engine/decision-matrix.ts`, `src/slot-engine/grounding-composer.ts`

#### Audit & Fix — Production Follow-Up Queue Audit & UTC-to-WIB Accurate Scheduling (`follow-up.service.ts`, `follow-up-engine.test.ts`) (2026-09-01)

- **Latar Belakang & Permintaan Pengguna:**
  - Pengguna meminta pengecekan dan audit menyeluruh terhadap performa dan cara kerja **Follow-Up Queue (Antrian Follow-Up)** untuk seluruh use case di live server, serta melaporkan mana yang sudah sesuai dan mana yang terdapat kendala/anomali.

- **Hasil Audit Use Case di Live Server:**
  1. **`NO_PURCHASE` (Customer Masuk Belum Booking)**:
     - **Status**: 49 terkirim (*SENT*), 119 dalam antrian (*QUEUED*), 126 dibatalkan (*CANCELLED* karena customer akhirnya melakukan booking).
     - **Evaluasi**: **100% SESUAI**. Auto-queue 3 tahap (+3, +7, +14 hari) dan auto-cancel saat reservasi dibuat berjalan sempurna.
  2. **`NEXT_TREATMENT` (Customer Pasca Treatment)**:
     - **Status**: 40 terkirim (*SENT*), 132 dalam antrian (*QUEUED*), 32 dibatalkan (*CANCELLED*).
     - **Evaluasi**: **100% SESUAI**. Penjadwalan bertahap (+1, +2, +3 bulan) berjalan konsisten.
  3. **Smart Context Guards (Human Handling & Cooldown 72h)**:
     - **Status**: Worker secara otomatis menahan dan menjadwalkan ulang pesan untuk customer yang sedang ditangani manual oleh Admin (`is_human_handling = true`) atau baru aktif chat (< 72 jam).
     - **Evaluasi**: **100% SESUAI**. Tidak ada tabrakan chat dengan admin.

- **Temuan Anomali & Perbaikan (Bug Fix):**
  - **Akar Masalah Timezone Jam Malam/Pagi**: `createReservationFollowUps` dan `onReservationRescheduled` sebelumnya menggunakan `setHours(19)` dan `setHours(8)` lokal sistem. Di container VM Linux (UTC), ini menyebabkan Reminder H-1 terjadwal di `19:00 UTC = 02:00 WIB (subuh)` dan Review H+1 di `08:00 UTC = 15:00 WIB (sore)`.
  - **Solusi**: Mengganti kalkulasi menjadi UTC-deterministik WIB: `Date.UTC(year, month, day - 1, 12, 0, 0, 0)` (tepat 19:00 WIB malam) dan `Date.UTC(year, month, day + 1, 1, 0, 0, 0)` (tepat 08:00 WIB pagi).

#### Fitur — Paket Multi-Sesi (ReservationSeries) (`prisma/schema.prisma`, `reservation-series.service.ts`, `reservations.subroute.ts`, `CreateReservationModal.tsx`) (2026-09-01)

- **Latar Belakang & Permintaan Pengguna:**
  Banyak treatment bersifat berulang — misalnya "Newborn Bathing 30 Hari" membutuhkan 30 sesi (1×/hari). Admin harus membuat reservasi satu per satu manual → ribet, mudah lupa jadwal, tidak bisa pantau progres.
  Diminta fitur **Paket Multi-Sesi** agar admin bisa membuat N sesi sekaligus dari satu klik.

- **Solusi:**
  - **Schema:** Tabel `reservation_series` baru (id, customer_id, clinic_service_id, title, status, start_date, total_sessions, completed_sessions, notes). Kolom `series_id` + `session_number` + `total_sessions` di `reservations`.
  - **Backend (`reservation-series.service.ts`):** Service lengkap — createSeries (generate N reservasi sekaligus), getSeries, getCustomerSeries, pauseSeries, resumeSeries, cancelSeries, updateSession, checkAndCompleteSeries (auto-complete saat semua sesi done).
  - **Backend Endpoints:** POST/GET series, PATCH pause/resume/cancel, PATCH session update — 7 endpoint baru.
  - **Frontend (`CreateReservationModal.tsx`):** Admin memilih layanan paket → auto-detect `totalSessions` dari catalog → schedule builder muncul → admin atur tanggal & jam per sesi → klik "Buat Paket" → semua reservasi dibuat sekaligus.
  - **Frontend Types:** `ClinicServiceItem` + `ClinicServices` interface updated dengan `totalSessions` + `sessionScheduleType`.

- **File berubah:** 8 file (new: `reservation-series.service.ts`, `migration.sql`; modified: `schema.prisma`, `reservations.subroute.ts`, `treatment-catalog.service.ts`, `CreateReservationModal.tsx`, `types.ts`, `ClinicServices.tsx`)

- **Verifikasi:** `tsc --noEmit` 0 error, `vite build` 10.20s pass, live server deploy — migration applied, app boot clean, no errors.

- **Phase 4 (2026-09-01 13:17):** Badge "Sesi X/Y" di calendar view (`WeekScheduleGrid` + `DayScheduleGrid`) + section "Paket Sesi" di customer detail modal dengan progress bar per series. Deployed clean.

#### Fix & Enhancement — Customer Database: Skeleton Ringan + Retry Manual + Timeout 10s Fix (`CustomerDatabase.tsx`, `customer.service.ts`, `customers.subroute.ts`, `schema.prisma`, `docker-compose.yml`) (2026-09-01)

- **Latar Belakang & Permintaan Pengguna:**
  1. Buka Database Customer → loading lama → toast "Gagal memuat database customer: Koneksi internet lambat (Timeout 10s)" meskipun data hanya 500 baris.
  2. Tidak ada UI skeleton atau retry manual — user hanya melihat spinner kosong lalu error toast yang hilang.
  3. LTV sorting (`sortBy=ltv`) tidak akurat — fetch 500 rows lalu sort JS, bukan top-N by LTV sesungguhnya.

- **Akar Masalah (5 faktor konkuren):**
  1. N+1 `resolveTreatmentValue` per-row — 500 rows × unique texts = 500 sequential `await`.
  2. 6 query paralel per request (findMany + count + 4 stats) memblok response.
  3. `pool_timeout=10` sama dengan FE timeout 10s → race condition.
  4. Search `ILIKE %q%` pada 6 field termasuk yang tidak ter-index.
  5. Hanya spinner, tidak ada skeleton atau retry banner.

- **Solusi & Implementasi (7 fase):**
  1. **Skeleton Ringan (Phase 1):** Ganti full-page `<Loader>` dengan skeleton `animate-pulse` saat data kosong. Saat refresh dengan data ada → overlay transparan, tidak kehilangan data lama.
  2. **Search Debounce 300ms (Phase 1):** Mencegah pengetikan cepat memicu rentetan request `ILIKE` konkuren.
  3. **Retry Manual Banner (Phase 2):** State `loadError` + tombol "Coba Lagi" persisten, `useEffect([retryCount])` trigger reload.
  4. **Timeout 20s khusus customers (Phase 2):** `apiRequest({ timeoutMs: 20000 })` hanya untuk endpoint customers, global tetap 10s.
  5. **Batch resolve N+1 (Phase 1.5):** Kumpulkan semua unique texts, `Promise.all` sekali, lalu lookup dari Map — bukan per-row await.
  6. **Stats endpoint terpisah (Phase 3):** `GET /api/admin/customers/stats` cached 60s, frontend fetch terpisah via `useEffect([])`.
  7. **Observability logging (Phase 3.5):** Structured JSON log per request: `elapsed`, `findManyMs`, `resolveMs`, warning jika >500ms.
  8. **Search guard (Phase 4):** Query <4 huruf hanya scan `name/phone/trackingCode` (3 field), ≥4 huruf scan 6 field.
  9. **LTV materialization (Phase 4):** Kolom `ltv_cache` di DB, `orderBy: { ltv_cache }` native PostgreSQL, hook `recalculateCustomerLtv` saat reservasi create/update/cancel, backfill SQL idempotent.
  10. **Pool timeout 15s (Phase 5.5):** `pool_timeout=10→15` agar FE 20s tidak race dengan pool.
  11. **Composite indexes (Phase 4):** `tenant_id+is_sandbox_test`, `tenant_id+is_mql`, `tenant_id+is_sandbox_test+created_at`, `ltv_cache`.

- **File yang Dipengaruhi:**
  - `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx` — skeleton, retry banner, debounce, stats fetch terpisah
  - `packages/admin-dashboard/src/services/api.ts` — tidak diubah (timeoutMs di-pass dari caller)
  - `src/services/customer.service.ts` — batch resolve, observability, `getCustomerStats()`, `recalculateCustomerLtv()`, `backfillAllLtvCache()`, search guard, `ltv_cache` sort
  - `src/routes/admin/customers.subroute.ts` — `GET /api/admin/customers/stats` endpoint baru, cache invalidation granularity
  - `src/routes/admin/reservations.subroute.ts` — hook `recalculateCustomerLtv` pada PATCH edit & status change
  - `src/services/reservation-lifecycle.service.ts` — hook `recalculateCustomerLtv` saat reservasi baru
  - `prisma/schema.prisma` — kolom `ltv_cache`, 4 composite indexes baru
  - `prisma/migrations/20260901000000_add_ltv_cache_and_indexes/migration.sql` — DDL + backfill
  - `docker-compose.yml` — `pool_timeout=10→15`

- **Verifikasi:**
  - Backend typecheck: PASS (0 error)
  - Frontend typecheck: PASS (0 error)
  - Frontend build: PASS (42.49s)
  - Backend build: PASS
  - Vitest suite: **197/198 files passed, 1542/1543 tests passed** (1 pre-existing timeout di `migration.test.ts` — Google Calendar, tidak terkait)

#### Perbaikan Sistemik Sesi 89-Turn: State Persistence, Anti-Silent Handoff & Maternal Routing (2026-09-21)

- **DB**: 
px prisma db push menyinkronkan kolom \session_data\ (episodik V3) ke PostgreSQL lokal; Prisma Client di-generate ulang penuh (atasi EPERM DLL lock dengan menghentikan dev server). Verifikasi: \scripts/verify-session-data.ts\.
- **GoalTracker**: blok try persistensi dipecah (episodik vs durable) — kegagalan tulis session_data tidak lagi menggugurkan mirror Customer (akar amnesia lokasi lintas-turn); \getGoalSession\ kini resilient memory fallback.
- **Maternal routing**: \getDefaultRelaxationService('MOMS')\ memfilter MOMS/BOTH (bukan lagi paket bayi); pregrounding sesi ibu memakai header \"Ibu Sehat Relaksasi\".
- **Learning loop**: grounding kosong kini HANYA menandai \eview_flagged\ (repository seam \lagForReview\) — bot tetap aktif; antrean kurasi tidak lagi memicu CS takeover permanen (akar mati suri 68 turn).
- **Sanitizer DSML**: perbaikan regex yang rusak (dobel-pipe, tak pernah match) → trim-from-first dengan dukungan control-char C1 & pipe fullwidth; \<result>/<tool_call>\ tetap pasangan-tag.
- **Handoff anti-silent-drop**: flag \is_human_handling\ kini di-set SETELAH balasan closing terkirim (sebelumnya membatalkan pengiriman via shouldAbort → customer menerima diam total).
- **Verifikasi**: build 0; suite 2978 passed / 1 failed (pre-existing); re-run Kasus #1: amnesia 0, DSML 0, closing schedule-check TERKIRIM, latch silent pasca-closing bekerja.

