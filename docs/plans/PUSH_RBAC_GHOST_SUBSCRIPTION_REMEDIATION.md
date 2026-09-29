# Staged Implementation Plan (REVISI): Remediasi Kebocoran Notifikasi Admin ke Perangkat Terapis

Status: DISETUJUI & SEDANG DIEKSEKUSI (Fase 1–3 lokal). Fase 4 (live) menunggu gate keamanan terpisah.
Tanggal: 2026-09-29
Dasar: audit plan awal — 6 koreksi P1–P6 diterapkan di bawah.

## 0. Koreksi terhadap plan awal (P1–P6)

| # | Masalah plan awal | Keputusan revisi |
|---|---|---|
| P1 | Bypass blanket `urlPath.startsWith('/api/admin/push')` membebaskan `test-staff` & `staff-device-counts` | Bypass kode DIPERSEMPIT hanya ke endpoint self-registration: `GET /public-key`, `POST /subscribe`, `POST /unsubscribe`. `test`, `test-staff`, `staff-device-counts` tetap lewat scope guard + in-handler check. Seed DB tetap ditulis (fondasional, data-driven). |
| P2 | `test-staff` `callerStaffId !== staffId → 403` memblokir Super Admin | Guard: Super Admin selalu boleh; staf hanya boleh `staffId === dirinya`; sesi staf tanpa `staffId` (tak seharusnya terjadi) → 403. |
| P3 | Micro-Task 2.3 tidak punya diff (kode sudah benar) | DIHAPUS. `pushNotification.ts` sudah selalu POST ulang ke backend (reuse subscription). Bug riil ada di 403 backend, bukan skip frontend. |
| P4 | Nama migrasi `20260929000000` bentrok/out-of-order; hardcode `default-tenant` | Migrasi baru `20260930000000_allow_push_for_therapist`, tenant-aware via `SELECT DISTINCT tenant_id FROM tenants` + `default-tenant` fallback. Cache scope TTL 60s (invalidasi alami). |
| P5 | `DELETE ... LIKE '%Chrome/154%Windows NT 10.0%'` berisiko hapus perangkat admin legit | Ganti: `SELECT` dulu (tampilkan), backup tabel, hapus by `endpoint`/`id` spesifik. Wajib 1-step verification + backup eksplisit. |
| P6 | Test gate kurang header CSRF, kasus device-counts, kasus super admin | `push-rbac.test.ts` menyertakan `X-Requested-With: XMLHttpRequest` pada semua POST cookie-auth; uji `staff-device-counts` tetap 403 therapist; uji Super Admin tetap boleh `test-staff`. |

## 1. Root cause (terverifikasi di kode)

1. `inbound-notification-router.service.ts:74` + `conversation.service.ts:512` broadcast chat umum ke role `ADMIN`.
2. Perangkat penguji terdaftar di `push_subscriptions` sebagai `user_type='ADMIN', user_id=NULL` (ghost dari pemakaian dashboard sebelumnya).
3. Rebind ke STAFF gagal: scope guard `admin.route.ts:254-266` + `role-scope.service.ts` default-deny therapist (seed `20260926000002` hanya `/staff/me` & `/staff/profile`) → `GET /api/admin/push/public-key` 403.
4. `push.subroute.ts:49-50` mempercayai `body.userType/userId` (spoofing).
5. `logout()` frontend tidak `unsubscribe`; login tidak sanitasi cookie silang → sesi tumpang tindih.
6. Dead code `admin.route.ts:244` (`isSelfPushRegister` di bawah prefix `/api/admin/staff`, rute riil `/api/admin/push` → tak pernah true).

## 2. Fase pelaksanaan

### Fase 1 — Backend (fondasional)
- `push.subroute.ts`: paksa identitas dari sesi (`STAFF`+`staffId` bila ada `staffId`, else `ADMIN`+`null`); `test-staff` caller check.
- `admin.route.ts`: hapus dead code `isSelfPushRegister`; bypass sempit `PUSH_SELF_REGISTRATION_ROUTES` sebelum scope guard.
- `staff/auth.subroute.ts` + `admin/auth.subroute.ts`: login hapus cookie sesi portal lawan (array `Set-Cookie`).
- Migrasi `20260930000000_allow_push_for_therapist`: seed `(tenant, therapist, /api/admin/push, *)` tenant-aware & idempoten.

### Fase 2 — Frontend PWA lifecycle
- `AuthContext.tsx` & `StaffAuthContext.tsx`: `unsubscribeFromPushNotifications()` SEBELUM destroy sesi backend (best-effort, tidak memblokir logout).

### Fase 3 — Test
- `tests/integration/push-rbac.test.ts` (offline, mock `prisma.roleApiScope.findMany` + `StaffAuthService.validateSession`).

### Fase 4 — Live (gate terpisah)
- Deploy + purge ghost token (dengan backup & SELECT-before-DELETE). Butuh konfirmasi eksplisit + 1-step verification.

## 3. Acceptance criteria

1. `GET /api/admin/push/public-key` role THERAPIST → 200.
2. `POST /subscribe` staf tersimpan `user_type='STAFF', user_id=staffId` (body `ADMIN` di-override).
3. `staff-device-counts` untuk therapist → 403.
4. Super Admin boleh `test-staff`; therapist hanya ke dirinya.
5. Login staf mengirim header pembersih `admin_session`; login admin mengirim header pembersih `staff_session`.
6. Logout memanggil unsubscribe push sebelum destroy sesi.
7. Chat Anne Lawrencia (0 reservasi) tidak lagi ke perangkat Tabita setelah ghost token dibersihkan (Fase 4).
