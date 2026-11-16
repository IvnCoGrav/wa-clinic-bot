# Plan: Burn-Down Sprint 2 (#353)

- **Status:** SELESAI (dieksekusi 2026-11-16, commit S2-1..S2-5).
- **Basis kode:** commit `1f3f6cdc`; eksekusi berjalan bersamaan dengan merge #348/#354 sehingga gate akhir dihitung pada `16e09e19` + commit Sprint 2.
- **Terkait:** `docs/KNOWN_ISSUES.md` #353, `docs/PLAN_BURNDOWN_SPRINT1_2026-11-16.md`, `docs/PLAN_REUSE_GATE_2026-11-16.md`.
- **Sifat:** satu task = satu commit; baseline hanya boleh turun.

---

## 1. Target Sprint 2

| Metrik | Baseline Sprint 1 | Target Sprint 2 | Hasil |
|---|---:|---:|---:|
| Duplikasi fungsi (grup AST) | 2 | **0** | **0** |
| File fisik >1.500 baris | 8 | **6** | **6** |
| Panggilan Prisma di route | 270 | **240** | **240** (33 file) |
| Deklarasi simbol terlarang | 13 | ≤13 | **12** |
| Dead export runtime | 169 | tetap/turun | **168** |
| Siklus import | 6 | 6 | **6** |

**Definition of Done:** `check:reuse` + `check:architecture` 0 pelanggaran baru, `check:ui-reuse` 0, `typecheck`/build hijau, test terkait hijau, baseline tidak naik.

---

## 2. Ringkasan task

| ID | Fokus | Risiko | Metrik |
|---|---|---|---|
| S2-1 | Kanonisasi guard isolasi tenant `findById` | Rendah | Duplikasi 2 → 1 |
| S2-2 | Hapus `isNearEqual`, pakai `isTypoAtMostOne` | Rendah | Duplikasi 1 → 0 |
| S2-3 | Ekstrak helper murni CAPI + serializer/tipe LiveChat | Sedang | File >1.500: 8 → 6; forbidden 13 → 12 |
| S2-4 | Pindahkan 33 query Prisma ke service + putus siklus billing/CAPI | Sedang | Prisma route 270 → 240 |
| S2-5 | Ratchet baseline + laporan + verifikasi | Rendah | Semua target terkunci |

---

## 3. Hasil per task

### S2-1 — Guard isolasi tenant kanonis

- Fakta: `findById` identik di `conversation.repository.ts:200` dan `customer.repository.ts:128`; pola guard yang sama juga hidup di fallback cache `conversation.service.ts` dan `customer.service.ts`.
- Aksi: buat `src/utils/tenant-scope.ts` (`tenantScopedRow`), pakai di 4 titik repository + 2 fallback cache. Registrasi kapabilitas `tenant.scope`.
- Test: `tests/unit/tenant-scope.test.ts` (7 kasus adversarial: null, tenant cocok/beda, guard nonaktif, data lama tanpa `tenant_id`, identitas objek) + kasus in-memory di dua test repository.

### S2-2 — Hapus duplikasi `isNearEqual`

- Fakta: `isNearEqual` di `calculate-delivery.tool.ts` byte-identik dengan `isTypoAtMostOne` kanonis; file yang sama sudah mengimpor versi kanonis.
- Aksi: hapus fungsi lokal, pakai `isTypoAtMostOne`; rapikan import mid-file ke blok import atas; tambah test adversarial substitusi/sisipan/penghapusan 1 huruf + detail alamat sah.

### S2-3 — Ekstraksi file raksasa

- `capi.service.ts` 1.632 → 1.093 baris: helper murni pindah ke `src/services/capi.helpers.ts`; salinan `normalizePhoneToE164` dihapus, memakai normalizer kanonis.
- `live-chat.service.ts` 1.570 → 1.252 baris: DTO ke `live-chat.types.ts`, proyeksi ke `live-chat.serializer.ts`.
- Registrasi kapabilitas `capi.pure_helpers` dan `livechat.serialize`; test LiveChat diarahkan ke serializer kanonis.

### S2-4 — Prisma route 270 → 240 + siklus import

- `migration.subroute.ts`: 30 query pindah ke `src/services/migration-staging.service.ts`; route 723 → 597 baris, 0 `prisma.`.
- `reservation-dispatch-payment-proof.subroute.ts`: logika `verify-payment` (dari #348) pindah ke `src/services/reservation-payment-verification.service.ts`; per-file Prisma kembali 19 → 16.
- `meta-attribution.subroute.ts`: 3 `(prisma.tenant as any)` pindah ke `meta-attribution.service.ts`; route bebas Prisma.
- Pemutusan siklus 35 file (diperbesar merge origin): `resolveDeliveryFeeSnapshot` dan `resolveReservationPaymentEvaluation` pindah ke `src/domain/payment-expected.ts`; `resolveTreatmentValue` pindah ke `src/services/treatment-value.service.ts`.
- Test: `tests/unit/migration-staging.test.ts` (13 kasus, tenant-scoping + anti-injection sort + pagination + batch chunk).

---

## 4. Penyimpangan & keputusan

1. **Eksekusi bersamaan dengan #348/#354.** Working tree sempat berisi pekerjaan lain; Sprint 2 dihentikan sebelum ratchet, lalu dilanjutkan setelah pekerjaan tersebut di-commit dan merge selesai.
2. **Siklus import dari merge origin** (`reservation-billing.service.ts` masuk SCC) diperbaiki di akar: pemisahan modul domain/service, bukan ratchet baseline untuk meloloskan siklus baru.
3. **LTV staging di-scope tenant.** Query `customer.findMany` pada daftar staging sebelumnya hanya memfilter `phone`; kini menambah `tenant_id` untuk mencegah LTV lintas tenant bocor ke panel admin.
4. **Dedupe `matched_chunk_id`.** Lookup chunk staging memakai `Set` agar ID duplikat tidak dikirim berulang.
5. **`clearPendingFaqStaging` mengembalikan count** agar route tetap dapat menampilkan jumlah yang dibersihkan tanpa query langsung.

---

## 5. Verifikasi penutup

```powershell
npm run check:reuse          # 186 pelanggaran baseline, 0 baru
npm run check:architecture   # 240 Prisma / 33 file, 6 siklus, 0 baru
npm run check:ui-reuse       # 0
npm run typecheck
npm --prefix packages/admin-dashboard run check:design
npm --prefix packages/admin-dashboard run build
```

Baseline di-ratchet: duplikasi 0, forbidden 12, file 6, Prisma 240, dead export 168, siklus 6.

---

## 6. Sisa untuk Sprint 3

- File >1.500 baris: `customer.service.ts` (3.324), `staff-reservation.service.ts` (3.119), `treatment-catalog.service.ts` (2.536), `copilot-tools.ts` (1.795), `waha/client.ts` (1.767), `webhook.route.ts` (1.624).
- Prisma di route 240 → 200 (20 file tersisa).
- Dead export 168 → 100.
- 6 siklus import tersisa (scheduled separate).
