# Plan & Catatan Eksekusi — Perbaikan Logout Portal Staf (`StaffToday`)

> **Tanggal:** 2026-11-23  
> **Status:** EXECUTED — gerbang area terdampak hijau; full suite 1 failure flaky reuse-gate (82,9 dtk > 60 dtk saat paralel), rerun isolasi 14/14 PASS.

---

## 0. Keputusan yang Diadopsi

| No | Keputusan | Alasan |
|---|---|---|
| 1 | **Satu kontrak logout server**: `POST /api/admin/auth/logout` | Endpoint ini sudah menghancurkan `admin_session` **dan** `staff_session` serta menghapus kedua cookie (`src/routes/admin/auth.subroute.ts:353-371`). Tidak perlu dua endpoint paralel. |
| 2 | **Hard redirect** `window.location.replace('/admin/login')` | Menjamin seluruh state SPA (dua context) benar-benar hilang dan tombol Back tidak kembali ke portal. |
| 3 | **Hardening z-index ke `z-dialog-top`** | Dialog konfirmasi dipastikan selalu berada di lapisan teratas (12500) di atas base modal (12000) dan drawer sebagai hardening UI (bukan akar masalah tabrakan z-index). |
| 4 | **Akar arsitektural dual-auth dicatat sebagai tiket terpisah** | `/api/admin/auth/me` mengembalikan staf sebagai `user` admin (`auth.subroute.ts:460-490`). Dicatat di `docs/KNOWN_ISSUES.md` Issue #367. |

---

## 1. Ruang Lingkup File yang Diubah

- `packages/admin-dashboard/src/contexts/AuthContext.tsx`
- `packages/admin-dashboard/src/contexts/StaffAuthContext.tsx`
- `packages/admin-dashboard/src/services/pushNotification.ts`
- `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`
- `packages/admin-dashboard/src/components/common/UiFeedback.tsx`
- `tests/unit/staff-dashboard-hardening.test.ts`
- `docs/FEATURE_INVENTORY.md`
- `CHANGELOG.md`
- `docs/KNOWN_ISSUES.md`

---

## 2. Hasil Eksekusi Bertahap

### Fase 0 — Baseline & Gerbang Reuse
- `git status --short` bersih sebelum eksekusi.
- `npm run find:module` tidak menemukan modul logout ganda di luar context auth.

### Fase 1 — Kontrak Logout Kanonis
- `AuthContext.tsx`: `logout({ awaitServer: true })` mengirim request server dengan opsi `keepalive`.
- `StaffAuthContext.tsx`: `logout({ server: false })` membersihkan storage lokal tanpa memanggil endpoint server duplikat.
- `pushNotification.ts`: `unsubscribeFromPushNotifications()` di-deduplikasi via `unsubscribeInFlight`.
- `StaffToday.tsx`:
  - `const logout = staff ? staffLogout : adminLogout;` dihapus.
  - Implementasi `handleLogout` kanonis dengan guard `isLoggingOutRef`.
  - Pembersihan paralel `staffLogout({ server: false })` dan `adminLogout({ awaitServer: true })`.
  - Hard redirect `window.location.replace('/admin/login')`.
  - Kedua tombol (drawer & modal profil) terhubung dengan state visual loading.

### Fase 2 — Hardening Lapisan Dialog
- `UiFeedback.tsx`: Lapisan backdrop modal dialog konfirmasi dinaikkan dari `z-dialog` (12000) ke `z-dialog-top` (12500).

### Fase 3 — Gerbang Regresi & Dokumentasi
- `tests/unit/staff-dashboard-hardening.test.ts`: 3 uji statis baru lolos (19/19 PASS).
- `tests/integration/staff-routes.test.ts` & `tests/integration/admin-staff-authz-matrix.test.ts`: 32/32 PASS (30 staff-routes termasuk behavioral test endpoint server logout + 2 authz matrix), ditambah 19/19 unit guard di `staff-dashboard-hardening.test.ts`.
- `npm run build`: PASS.
- `npm --prefix packages/admin-dashboard run build`: PASS (bundle `dist/` terbarui).
- `npm run typecheck`: PASS.
- `npm run check:reuse`: PASS (0 pelanggaran baru).
- `npm run check:ui-reuse`: PASS (0 pelanggaran baru).
- `CHANGELOG.md`, `docs/FEATURE_INVENTORY.md`, `docs/KNOWN_ISSUES.md`: Terbarui.
