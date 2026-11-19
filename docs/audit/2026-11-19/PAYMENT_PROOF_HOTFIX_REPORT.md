# Laporan Hotfix — Bukti Pembayaran Otomatis (19 Nov 2026)

- **Status:** DEPLOYED & VERIFIED (app `healthy`)
- **Commit produksi:** `b10304fa` (`feat(payment-proof): rekonsiliasi bukti pembayaran otomatis`)
- **Branch produksi:** `deploy/2026-11-13-merged` (fast-forward dari `374f403d`)
- **Image:** `wa-clinic-bot-app:latest` / `wa-clinic-bot-worker:latest`
- **Rollback:** `wa-clinic-bot-app:pre-hotfix-20261119` (`7b6dd2a5`), `wa-clinic-bot-worker:pre-hotfix-20261119` (`dc5a9893`)

## 1. Masalah yang diperbaiki

1. **Fallback tanpa filter** di `customer-payment-proof.service.ts`: `findFirst` hanya memfilter `customer_id` + `tenant_id` ketika query utama kosong, sehingga bukti transfer bisa menempel ke reservasi lama/`cancelled` dan melewati jendela tanggal.
2. **Error DB ditelan** (`catch { // ignore }`) sehingga gangguan database diperlakukan sebagai "tidak ada kandidat".
3. **Status terminal** (`cancelled`/`rejected`) belum ditolak di lapisan pemilihan kandidat.
4. **Validasi jendela** di route settings belum menjepit nilai (bisa 0 atau 9999) dan audit belum mencatat nilai sebelum → sesudah.
5. **Skrip rekonsiliasi** masih memakai data hardcode + regex parsing invoice, dan update billing tidak atomik.

## 2. Perubahan yang ter-deploy

| Area | Perubahan |
|---|---|
| Service bukti bayar | fallback dihapus; query `findMany` dengan status + jendela + `purchase_occurred_at IS NULL` + `proof_url IS NULL`; error → `INTERNAL_ERROR`; log `kandidat=… terpilih=… exact=…` |
| Domain | `TERMINAL_RESERVATION_STATUSES` + filter status terminal di `selectPaymentProofCandidate` |
| Konfigurasi tenant | `clampPaymentProofWindowDays` (1–30 hari) dipakai route settings; audit `paymentProofWindowBefore/After` |
| Skrip rekonsiliasi | kasus dibaca dari `reconcile-cases.json`; `amount` wajib cocok tagihan; snapshot billing + rollback; `already_paid` mengisi `proof_url` bila kosong; mode `--validate-cases` |
| Dashboard | panel jendela otomasi di `PaymentInfoPanel.tsx` |

## 3. Verifikasi pasca-deploy

| Pemeriksaan | Hasil |
|---|---|
| `docker compose ps` | app **healthy**, worker **Up** |
| `/health` (dalam container) | **200** |
| `grep legacyRes` di dist produksi | **0** |
| Penanda fail-closed | ada |
| Filter status terminal | ada |
| Dashboard memuat "Jendela Otomasi" | ada |
| Log error/fatal app & worker | nihil |
| `/proof/0975f422-4f19-43ef-b03e-7ee9d13d6f2c` | **200** |

**Gerbang regresi:** `npm run typecheck` bersih; `npm run build` bersih; `npm run check:reuse` 189/0; 76 test terkait hijau (unit + integrasi) pada kode produksi; `reconcile-payment-proof-rows.ts --validate-cases` OK.

**Full suite (`npx vitest run`) pada commit produksi `b10304fa`:** 8.007 test → **7.971 lulus, 8 gagal, 28 skip**. Kedelapan kegagalan **terbukti pre-existing** (revert-and-rerun): dijalankan ulang pada commit dasar `374f403d` (sebelum hotfix) menghasilkan **8 kegagalan yang sama persis** — `admin-config-write-rbac`, `cta-redirect-delay`, `fase05-audit-artifact`, `fase10-audit-artifact`, `hybrid-reservation-parser` (2), `production_edge_cases`, `trustproxy-ip`. Tidak ada failure baru dari hotfix.

## 4. Catatan penting

- Deploy ini **tidak menyentuh WAHA**; `app` dan `worker` di-recreate (±30 detik, webhook sempat tertunda singkat).
- **Tidak ada data reservasi yang diubah** pada deploy ini.
- Source produksi kini sinkron dengan commit (`git status` bersih), sehingga build berikutnya tidak akan menghapus fitur.
- **Sisa pekerjaan:** remediasi 8 reservasi belum lunas tanpa bukti dan 4 lunas tanpa bukti non-tunai (butuh berkas bukti asli); dukungan PDF dan WABA (lihat #361/#271).
