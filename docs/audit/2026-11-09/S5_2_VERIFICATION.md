# VERIFIKASI S5.2 — KATALOG DATA-DRIVEN & SEED EKSPLISIT

- **Tanggal:** 2026-11-09
- **Commit S5.2:** `b45f9d46`
- **Lingkup:** `treatment-catalog.service.ts`, `delivery.service.ts`, seed CLI/service, dokumentasi.
- **Sifat:** verifikasi lokal (tanpa DB produksi).

## Gate Lokal

| Pemeriksaan | Perintah | Hasil |
|---|---|---|
| Build backend | `npm run build` | **PASS** (exit 0) |
| Build dashboard | `npm --prefix packages/admin-dashboard run build` | **PASS** (exit 0, 27,15 dtk) |
| Typecheck | `npm run typecheck` | **PASS** (exit 0) |
| Unit S5.2 | `npx vitest run tests/unit/s5-catalog-data-driven.test.ts` | **12/12 PASS** |
| Targeted katalog/delivery | 9 file terkait | **75/75 PASS** |
| Security scan | `npm run security:scan` | **PASS** — 2.035 file, 0 kebocoran |
| Seed dry-run | `npm run seed:catalog -- --tenant=default-tenant --brand=Kala` | **PASS** — 42 layanan + 7 tier, tidak menulis DB |

## Full Suite

- **Total:** 6.771 test
- **Lulus:** 6.738
- **Gagal:** 5
- **Skip:** 28

Klasifikasi 5 kegagalan:

| Test | Klasifikasi | Bukti |
|---|---|---|
| `hybrid-reservation-parser` (2) | Pre-existing #287 | Gagal juga pada baseline `f3c6a2c4` |
| `staff-auth-and-reservation` | Flaky beban | Lulus 28/28 saat diisolasi |
| `media-mime-audio` | Flaky beban | Lulus 2/2 saat diisolasi |
| `production_edge_cases` #13 | Flaky beban/LLM | Lulus saat diisolasi (`-t` spesifik) |

**Kesimpulan:** tidak ada regresi fungsional S5.2.

> Catatan: full suite dijalankan saat working tree juga memuat perubahan zipcode dari sesi paralel. Artifact mentah disimpan di luar repo; jalankan ulang full suite setelah semua perubahan di-commit untuk gate final yang bersih.

## Acceptance S5.2

| Kriteria | Hasil |
|---|---|
| `rg "Kala" src/services/treatment-catalog.service.ts` = 0 | **PASS** (0) |
| 42 layanan + 7 tier | **PASS** |
| Auto-seed runtime dihapus | **PASS** (`loadServicesFromDb`, `getDeliveryTiersFromDb`) |
| `USE_DB_CATALOG` flag | **PASS** (default true; false = rollback) |
| Tenant non-default tanpa data = unconfigured | **PASS** |
| Dua tenant berbeda katalog | **PASS** (unit test) |
| Seed dry-run & commit atomik | **PASS** (dry-run; commit diuji via mock transaksi) |

## Belum Dijalankan (butuh environment/operator)

1. Seed `--commit` ke database produksi (backup dulu).
2. Uji dua tenant di staging dengan DB nyata.
3. Backup/restore terenkripsi + row-count.
4. Cron paralel + restart + alert.
5. Uji perangkat fisik PWA staf.
6. Deploy staging → canary → produksi.
