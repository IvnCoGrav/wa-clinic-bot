# Handoff — Perbaikan Sistem Reservasi (Fase 0–4.2)

Status: **BELUM DI-COMMIT / BELUM DI-PUSH.** Dokumen ini mencatat pekerjaan
yang menunggu di-commit ke git, agar bisa dilanjutkan kapan saja.

Tanggal: 2026-09-28 · Branch: `feat/staff-chat-window-lifecycle`

---

## 1. File yang HARUS di-commit (milik plan audit reservasi)

### Modifikasi (M)
| File | Fase | Ringkasan |
|---|---|---|
| `src/utils/date-confirmation.ts` | 2 | `isAvailabilityInquiryText`, `hasBookingRetreatSignal`; `verifyDayMentioned` tolak tanya-slot tanpa `?` |
| `src/v3/agent/pipeline/booking-commit-gate.ts` | 2 | `isBookingCommitReady` hormati guard interogatif |
| `src/v3/agent/pipeline/context-grounder.ts` | 2 | Unlatch `bookingCommitConfirmed` saat customer mundur |
| `src/v3/state/cart-manager.ts` | 2 | Sapaan pembuka tidak lagi mengunci keranjang (`hasSubstantiveUserTurn`) |
| `src/v3/tools/tool-masker.ts` | 2 | Alasan `AVAILABILITY_INQUIRY`; blokir save_reservation saat tanya slot |
| `src/v3/tools/save-reservation.tool.ts` | 1 | Hapus bug `if (opts.isMulti) return 'BOTH'` |
| `src/routes/admin/stores.ts` | 1 | `filterMemoryByTenant` |
| `src/routes/admin/reservations.subroute.ts` | 1,3 | Filter tenant fallback (count/list/detail); collision check PATCH status + series 409 |
| `src/services/reservation-core.service.ts` | 3,4.1 | Kontrak durasi tunggal (hapus buffer ganda); tag `[OUTSIDE_HOURS]` |
| `src/services/reservation-series.service.ts` | 3.3 | Collision check per sesi sebelum transaksi |
| `src/services/cron.service.ts` | 4.2 | `runExpiredHoldSweep` |
| `src/app.ts` | 4.2 | Registrasi cron expired-hold sweep |
| `packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx` | 1,3 | Hapus downgrade KIDS→BABY; selaraskan cek bentrok tanpa +20 |
| `tests/setup.ts` | 4.2 | Tambah mock `reservation.updateMany` |
| `tests/unit/v3-audit-homecare-fix.test.ts` | 1.2 | Test multi-item BOTH |
| `tests/unit/v3-save-reservation-multi.test.ts` | 1.2 | Fixture nama katalog dinamis |
| `tests/unit/v3/tool-masking-commitment.test.ts` | 2.2 | Kontrak alasan AVAILABILITY_INQUIRY |
| `tests/unit/reservation-series.test.ts` | 3.3 | Test collision series |
| `docs/KNOWN_ISSUES.md` | — | Entri #157a–#157n |

### Baru (??)
| File | Fase |
|---|---|
| `src/config/operational-hours.ts` | 4.1 |
| `tests/unit/admin-reservations-tenant.test.ts` | 1.1 |
| `tests/unit/reservation-duration-contract.test.ts` | 3.1 |
| `tests/unit/operational-hours-flexible.test.ts` | 4.1 |
| `tests/unit/expired-hold-sweep.test.ts` | 4.2 |
| `tests/unit/v3/booking-commit-availability.test.ts` | 2.2 |
| `tests/unit/v3/cart-greeting-lock-repro.test.ts` | 0.2/2 |

> **PERHATIAN:** working tree berisi BANYAK perubahan dari sesi paralel
> (copilot, scorer, abuse-detection, CTWA, dll). JANGAN `git add -A`.
> Commit HANYA file di tabel di atas.

---

## 2. Saran commit (jalankan saat lanjut)

```powershell
git add src/utils/date-confirmation.ts src/v3/agent/pipeline/booking-commit-gate.ts `
  src/v3/agent/pipeline/context-grounder.ts src/v3/state/cart-manager.ts `
  src/v3/tools/tool-masker.ts src/v3/tools/save-reservation.tool.ts `
  src/routes/admin/stores.ts src/routes/admin/reservations.subroute.ts `
  src/services/reservation-core.service.ts src/services/reservation-series.service.ts `
  src/services/cron.service.ts src/app.ts src/config/operational-hours.ts `
  packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx `
  tests/setup.ts tests/unit/v3-audit-homecare-fix.test.ts `
  tests/unit/v3-save-reservation-multi.test.ts tests/unit/v3/tool-masking-commitment.test.ts `
  tests/unit/reservation-series.test.ts tests/unit/admin-reservations-tenant.test.ts `
  tests/unit/reservation-duration-contract.test.ts tests/unit/operational-hours-flexible.test.ts `
  tests/unit/expired-hold-sweep.test.ts tests/unit/v3/booking-commit-availability.test.ts `
  tests/unit/v3/cart-greeting-lock-repro.test.ts docs/KNOWN_ISSUES.md

git commit -m "fix(reservasi): audit lapis-2 — tenant fallback, tool-masking tanya-slot, kontrak durasi, jam fleksibel, hold expire"
```

Gerbang sebelum commit:
```powershell
npm run build
npm run build   # di packages/admin-dashboard
npx vitest run tests/unit/operational-hours-flexible.test.ts tests/unit/expired-hold-sweep.test.ts `
  tests/unit/reservation-duration-contract.test.ts tests/unit/reservation-series.test.ts `
  tests/unit/admin-reservations-tenant.test.ts tests/unit/v3/booking-commit-availability.test.ts `
  tests/unit/v3/cart-greeting-lock-repro.test.ts tests/unit/v3-audit-homecare-fix.test.ts `
  tests/unit/v3-save-reservation-multi.test.ts tests/unit/v3/tool-masking-commitment.test.ts
```

---

## 3. Sudah selesai (Fase 0–4.2)

- **Fase 0** — verifikasi: TZ container=UTC (bug drift), sapaan mengunci keranjang (repro merah), akar sistemik jalur form WA tanpa gerbang.
- **Fase 1** — isolasi tenant fallback in-memory; fix kategori BOTH; hapus downgrade KIDS→BABY dashboard.
- **Fase 2** — unlatch komitmen; tanya-slot tanpa `?` diblokir; sapaan tidak mengunci cart.
- **Fase 3** — kontrak durasi tunggal (hapus 409 palsu); collision check PATCH status & series.
- **Fase 4.1** — jam operasional fleksibel (tag `[OUTSIDE_HOURS]`, tidak menolak).
- **Fase 4.2** — worker auto-expire hold.

Gerbang terakhir: `tsc` Exit 0, dashboard build Exit 0, 55 test terkait hijau.

---

## 4. Belum dikerjakan (lanjutan)

### Fase 4.3 — GCal outbox (BUTUH PERSETUJUAN MIGRASI DB)
- Migrasi Prisma: tambah `Reservation.gcal_sync_status String @default("synced")` + `gcal_last_error String?`.
- `npx prisma migrate dev --name add_gcal_sync_status` → `npm run prisma:generate`.
- Gagal update GCal → set `pending_retry` + simpan error (bukan `console.error` saja); worker retry; tetap HTTP 200 + info.
- Cek drift: `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` → harus `-- This is an empty migration.`
- KNOWN_ISSUES #157e → RESOLVED.

### Fase 5 — konkurensi + WIB + notifikasi
- **5.1** Advisory lock `pg_advisory_xact_lock` (tenant+staf+hari) di `reservation-core.service.ts` — tutup race condition double booking (KNOWN_ISSUES #157d).
- **5.2** WIB-eksplisit di `indonesian-date-parser.ts` (ganti `setHours(9)` lokal) + frontend bangun ISO dari komponen WIB (`CreateReservationModal.tsx:1365`). Dampak: jalur V3 saja (parser form WA sudah WIB).
- **5.3** Validator silang hari↔tanggal (selisih >1 hari) di `reservation-text-parser.ts:602-613` (saat ini >1 hari diabaikan senyap).
- **5.4** Batas retry + health-check admin staf tanpa channel notifikasi (`staff-notification.service.ts:437-441`).

### Tugas operasional (bukan kode)
- **0.4** Minta bukti SQL/log produksi (18 customer, double booking 4 Okt, hold 17 Sep) — belum diverifikasi.
- Alokasi 2 terapis untuk 4 Okt 09:00; tutup hold usang 17 Sep; pasang Telegram/Web Push Bidan Yusi F.

---

## 5. Catatan penting

- Suite penuh `npm test` di working tree ini **FLAKY** (baseline tanpa perubahan ini pun ~49 gagal; daftar gagal berubah tiap run; semua lulus saat diisolasi). Bukan regresi Fase 0–4.2 — verifikasi via stash baseline sudah dilakukan.
- Jangan commit file sesi paralel (`scripts/lib/scorer.ts`, `src/utils/prompt-injection-sanitizer.ts`, `src/integrations/whatsapp/waha-ctwa-referral.ts`, dll) di commit ini.
