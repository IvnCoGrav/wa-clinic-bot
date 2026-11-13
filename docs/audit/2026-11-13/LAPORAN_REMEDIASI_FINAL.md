# Laporan Ringkas Remediasi Audit F0–F6

> **Tanggal:** 2026-11-13
> **Sumber kebenaran status:** `docs/plans/REMAINING_BACKLOG_2026-11-09.md` + `docs/audit/2026-11-10/backlog-evidence.json`
> **Gerbang bukti:** `npm run verify:backlog` → **PASS** (91 item FIXED baru ber-bukti)

---

## 1. Angka Akhir

| Metrik | Nilai |
|---|---|
| Total temuan register | **268** |
| **FIXED terverifikasi** | **249** |
| UNVERIFIED | 4 |
| DUPLICATE | 5 |
| KNOWN (ber-justifikasi) | 4 |
| **OPEN** | **6** |
| Baseline historis beku | 158 FIXED |
| Full suite terakhir | **7.452 test / 7.422 lulus / 2 gagal pre-existing (#287)** |

Gate F4 belum terpenuhi karena masih ada 6 OPEN + 4 UNVERIFIED. Produksi tetap diblokir sampai migrasi + verifikasi staging.

---

## 2. Yang Sudah Diselesaikan (gelombang terakhir)

| Wave | Commit | Item | Inti |
|---|---|---|---|
| W10 | `3a625579` | `M-02`, `M-03`, `M-04`, `M-05`, `M-06`, `M-10`, `Cfg-012`, `Ar-005` | Landing admin tenant-aware + 503 jujur; `/cta` anti-spoof IP; slug 404; pixel tracker data-driven; docs CAPI dikoreksi |
| W11 | `5478b40f` | `Cfg-015` (sebagian) | Brand dashboard data-driven (`/api/admin/settings`); `x-tenant-id` dari user; hardcode Kala dihapus |
| W12 | `9dc84a50` | `Ar-004` | `LandingPage.slug` per tenant + resolusi landing via host/`?tenant=`; migrasi diverifikasi di Postgres ephemeral |
| W13 | `9337b671` | `S-011` | Token admin keluar dari `localStorage`; cookie HttpOnly + TTL 7 hari; CSP diperketat |
| W14 | `d0bcee2e` | `Ar-003` (sebagian) | Ekspor chat harian untuk semua tenant; kegagalan satu tenant tidak menghentikan tenant lain |

Gelombang sebelumnya (W1–W9) mencakup reliability, AbortSignal, humanizer struktural, kuota/circuit per tenant, endpoint setelan tenant, Google Calendar/Contacts, degradasi DB jujur, artefak audit, rekonsiliasi dokumen, secret WAHA per tenant, trip lintas proses, dan tenant seam worker/debug.

---

## 3. 6 OPEN yang Tersisa

| Item | Penghambat |
|---|---|
| `S-02`, `S-06`, `S-08`, `S-09` | Komponen utama di `packages/admin-dashboard/src/pages/staff/StaffToday.tsx` yang **sedang diedit pengguna** (uncommitted, bersama `useStaffFailedOutbox.ts` baru) |
| `Cfg-015` (sisa) | Teks di `StaffToday.tsx`, watermark foto, dan data klinik lain yang belum punya endpoint khusus |
| `Ar-003` | 497 referensi `DEFAULT_TENANT_ID` (140 file); mayoritas default parameter sah, butuh audit pemanggil per domain (2–4 hari) + keputusan fail-closed vs fallback |

---

## 4. Yang Dibutuhkan untuk Menuntaskan

1. **Commit/push** `StaffToday.tsx`, `useStaffFailedOutbox.ts`, dan perubahan `reservation-address-sync.*` → saya lanjut `S-02`/`S-06`/`S-08`/`S-09` + sisa `Cfg-015`.
2. **Keputusan Ar-003:** worker tanpa tenant **tolak (fail-closed)** atau **fallback default**?
3. **Deploy migrasi** (2 migrasi Ar-004) di staging/produksi: `prisma migrate deploy` **sebelum** kode, lalu drift check `--from-url` harus *empty*.

Dokumen rencana migrasi: `docs/plans/MIGRATION_PLAN_AR004_2026-11-12.md`.
Batas & tech debt: `docs/KNOWN_ISSUES.md`. Peta fitur: `docs/FEATURE_INVENTORY.md`.
