# Full Suite — commit `1eae114c` (2026-11-14)

Dijalankan di repo utama: `npm test` (vitest, config repo).

- Total test: **7530**
- Lulus: **7500**
- Gagal: **2**
- Skip: **28**
- File test: 972 (gagal: 1) + 1 skipped

## Kegagalan

- `tests/unit/hybrid-reservation-parser.test.ts` — Phase 5 Task 5.2: `should extract entities from free-form conversational text (Name, Age, Address, Date)`
- `tests/unit/hybrid-reservation-parser.test.ts` — Phase 5 Task 5.2: `should extract entities from newborn free-form booking`

Keduanya **pre-existing** (#287, parser free-form Phase 5), bukan regresi port series-billing.
Angka total naik dari 7516 → 7530 karena port menambah test series/billing
(`reservation-series`, `payment-invoice-formatter`, `meta-performance-analytics`).

## Gerbang lain pada commit yang sama

- `npx tsc --noEmit` root: **0 error**
- `npm run build` root: **OK**
- Dashboard: `npx tsc --noEmit` 0, `npm run build` OK, `npm run check:design` hijau
  (hex hardcode 275 = baseline, palet tanpa `dark:` 0).
- `npm run verify:backlog`: **PASS** (261 FIXED / 2 KNOWN).

> Log mentah run ini tidak di-commit; tersimpan di `%TEMP%\full-suite-1eae114c.log` pada mesin pengembang.
