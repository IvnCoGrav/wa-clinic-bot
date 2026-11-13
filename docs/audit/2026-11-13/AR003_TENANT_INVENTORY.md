# Inventaris Tenant Seam — Ar-003 (2026-11-13)

> Status register: **Ar-003 tetap OPEN**. Dokumen ini mencatat klasifikasi 497 referensi `DEFAULT_TENANT_ID` agar sisa pekerjaan terukur, bukan menebak.

## 1. Angka

| Area | Referensi | Catatan |
|---|---:|---|
| `src/services/**` | 264 | Mayoritas **default parameter** (`tenantId = DEFAULT_TENANT_ID`) yang sah untuk pemanggilan lama |
| `src/**` lainnya (v3, config, integrations, state) | 129 | Default parameter / fallback |
| `src/routes/**` | 58 | Sebagian besar fallback single-tenant mode (`isMultiTenantEnabled`) |
| `src/scripts/**` | 43 | CLI satu-kali; menerima `--tenant` dengan default |
| `src/worker.ts` / `lifecycle` | 3 | Sweep global; sudah memakai daftar tenant |
| **Total** | **497** | 140 file |

## 2. Klasifikasi Bahaya

| Kelas | Contoh | Status |
|---|---|---|
| **A. Filter DB hardcode `tenant_id: DEFAULT_TENANT_ID`** | `broadcast-queue.service.ts`, `system-debug.service.ts`, `labels.subroute.ts` (fallback memori) | **W9:** 2 service diperbaiki (broadcast sweep semua tenant; debug system/messages/conversations tenant-scoped). `labels` = fallback memori saat DB mati, sengaja default. |
| **B. Template policy dengan `tenant_id` default** | `staff-retention.service.ts` (`DEFAULT_RETENTION_POLICY`) | Aman — hasil akhir menimpa `tenant_id: tenantId` (baris 132). |
| **C. CLI/seed/backfill** | `cli/*`, `scripts/*` | Aman — argumen `--tenant` dengan default terdokumentasi. |
| **D. Default parameter service** | 264 referensi | **Sah** selama setiap pemanggil jalur produksi mengirim tenant. Audit per pemanggil masih diperlukan → sisa Ar-003. |
| **E. Landing & dashboard** | `landing.route.ts` (8), `landings.subroute.ts` (6) | Area pengguna; menunggu izin/WIP commit. |

## 3. Top File (referensi terbanyak)

| File | Ref |
|---|---:|
| `src/services/follow-up.service.ts` | 29 |
| `src/services/treatment-catalog.service.ts` | 27 |
| `src/services/staff-reservation.service.ts` | 15 |
| `src/services/follow-up-lifecycle.service.ts` | 11 |
| `src/services/whatsapp-provider.service.ts` | 10 |
| `src/config/ai-models.config.ts` | 9 |
| `src/services/reservation-series.service.ts` | 9 |
| `src/v3/state/goal-tracker.ts` | 9 |
| `src/services/delivery.service.ts` | 8 |
| `src/services/follow-up-engine.service.ts` | 8 |

## 4. Langkah Menuntaskan Ar-003 (per domain)

1. **follow-up** (29+11+8 ref): pastikan semua pemanggil meneruskan `tenantId`; jadikan parameter wajib pada seam tulis.
2. **treatment-catalog** (27): cache per tenant sudah ada; audit cache key & pemanggil.
3. **staff-reservation** (15): operasi staf sudah tenant-scoped; audit tool/agent yang memanggil tanpa tenant.
4. **config/ai-models & v3 state** (9+9+8): default sah untuk single-tenant, tetapi wajib di-wire dari sesi pada jalur multi-tenant.
5. **Landing** (14): menunggu area pengguna.

**Definition of done Ar-003:** tidak ada lagi filter DB ber-`tenant_id: DEFAULT_TENANT_ID` di jalur produksi (kelas A), dan setiap seam service yang menyentuh data bisnis menerima `tenantId` eksplisit dari pemanggil (bukan default tersembunyi).
