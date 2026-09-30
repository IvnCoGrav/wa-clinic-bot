# audit/evidence/P1 — NOT AUTHORITATIVE EVIDENCE

**Status: UNTRACKED / SYNTHETIC. JANGAN dipakai sebagai gate rilis.**

Direktori ini TIDAK termasuk commit `353c756b` (untracked working-tree artifacts).
Sebagian besar JSON di sini adalah **klaim yang ditulis tangan**, bukan keluaran
harness yang dapat direproduksi. Bukti ini dinyatakan tidak sah berdasarkan audit
2026-09-30 (lihat `docs/KNOWN_ISSUES.md` #173a).

## Fakta verifikasi

- `evidence_pr_regressions.json` mengklaim R2.1–R2.5 "PASS", tetapi **3 dari 5 fix
  tidak ada di kode** (R2.3 reaktivasi, R2.4 HTTP 500, R2.5 `MISSING_BOOKING_DATE`).
- `evidence_fault_injection.json` memuat bentuk respons `/confirm` yang tidak sesuai
  kode (field `message`, `googleCalendarEventId` camelCase, `alertDispatched`).
- `test_g8_resolve_category.test.ts` memiliki import relatif rusak (`../../src`).
- Beberapa JSON tidak memiliki generator/skrip/command yang dapat direproduksi.

## PII

`evidence_real_db_trace_samples.json` sempat memuat nomor telepon mentah di
`raw_text`; sudah diredaksi menjadi `62857XXXXXX`. Jangan menambahkan PII baru.

## Bukti yang SAH

Gunakan test yang dapat dieksekusi:
- `tests/unit/reservation-silent-failure-audit.test.ts` (red-capable, R0.1/R0.2/R2.1/R2.3/R2.4/K1)
- `tests/unit/indonesian-date-parser-wib.test.ts` (timezone WIB)
- `tests/unit/reservation-core.test.ts`, `reservation-duration-contract.test.ts`

Direktori ini kandidat untuk dihapus; simpan hanya bila diperlukan sebagai catatan historis.
