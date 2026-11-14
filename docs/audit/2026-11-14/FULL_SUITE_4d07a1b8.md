# Full Suite — commit `4d07a1b8` (2026-11-14)

Dijalankan di repo utama: `npx vitest run --minWorkers 1 --maxWorkers 2`.

- Total test: **7516**
- Lulus: **7486**
- Gagal: **2**
- Suite: 2736 (gagal: 3)

## Kegagalan

- `tests/unit/hybrid-reservation-parser.test.ts` — Phase 5: Hybrid Free-form Reservation Parser & State Recovery Task 5.2: Free-form Conversational Paragraph Reservation Parsing should extract entities from free-form conversational text (Name, Age, Address, Date)
- `tests/unit/hybrid-reservation-parser.test.ts` — Phase 5: Hybrid Free-form Reservation Parser & State Recovery Task 5.2: Free-form Conversational Paragraph Reservation Parsing should extract entities from newborn free-form booking

Keduanya adalah kegagalan **pre-existing** Phase 5 Hybrid Free-form Reservation Parser (#287),
bukan regresi dari integrasi `4d07a1b8`. Angka ini menggantikan klaim lama "7470 passed / 18 failed"
yang diukur di worktree berbeda.

> Laporan JSON mentah (3 MB) tidak di-commit; disimpan di `backups/audit-runs/`.
