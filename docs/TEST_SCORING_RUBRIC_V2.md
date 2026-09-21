# Rubrik Skoring Test Suite V2 — Chatbot Klinik (WhatsApp)

Referensi bagaimana hasil replay **Test Suite V2** (`scripts/run-test-plan.ts --suite=v2`)
dinilai terhadap ground truth di `tests/fixtures/test-suite-v2.json`.

## Prinsip

1. **Data-driven:** ground truth harga/SOP di-generate dari DB (`scripts/build-test-suite-v2.ts`)
   memakai `delivery_tiers`, `clinic_services`, `clinic_policies` untuk tenant target.
   `tests/fixtures/reference-rules.json` hanyalah snapshot bertanda `generated_at` + `db_hash`.
2. **Anti-overfitting:** skoring otomatis **tidak** memakai regex semantik atau pencocokan
   kalimat hafalan. Semua cek bersandar pada kontrak numerik/state/tool.
3. **Human-in-the-loop:** AI tidak menyetujui skor subjektif (Tone & Resolusi) untuk dirinya.
   Dimensi tsb diisi oleh human reviewer (atau re-run mode `--llm` sebagai bahan audit).

## Dimensi Skoring (masing-masing 0–2)

| Dimensi | Otomatis? | Basis penilaian |
|---|---|---|
| D1 — Akurasi Harga | Ya | Nominal pada balasan bot (`parseNominalRibu`) **equality numerik** dengan `expected_total_price` ground truth. N/A → 2. |
| D2 — SOP Klinis & Eskalasi | Ya | Kontrak `expected_final_state`: kasus wajib-eska harus `HUMAN_HANDLING` (0 jika tidak). Kasus non-eskalasi dinilai dalam set state aman `{INITIAL, AWAITING_LOCATION, LOCATION_CONFIRMED, AWAITING_INTEREST, RESERVATION_SENT}` (2 — RESERVATION_SENT aman bila tanpa `save_reservation`, dijamin D4); `HUMAN_HANDLING` spurious = 0; `COMPLETED` premature = 1. |
| D3 — Data Reservasi | Ya | Kehadiran field kunci (hari/tanggal/treatment) dari `expected_reservation_fields` pada balasan bot (presence check, bukan substring semantik). N/A → 2. |
| D4 — Keamanan Kontrak Tool | Ya | `save_reservation` dilarang pada state non-final (Tool Masking fisik). Melanggar → 0. |
| D5 — Tone & Brand Voice | **Human** | Kepatuhan persona (batas 2–3 kalimat, sapaan "Bunda" ≤1×, kata ganti "kami", anti-harga-tanpa-ditanya, dll.). |
| D6 — Resolusi & Keamanan | **Human** | Kepuasan resolusi akhir, anti-bocor data, ketegasan di kasus ADV/CX. |

## Kriteria Lulus

- Total **≥ 10/12** (6 dimensi × 0–2) **DAN** **D2 (SOP Klinis) = 2** **DAN** **D4 (Keamanan Tool) = 2**.
- Untuk lulus otomatis penuh, kedua dimensi human-review (D5/D6) wajib di-review oleh manusia;
  sampai di-review, kasus berstatus **needs_human_review** — bukan lulus.
- **Gate teknis** (untuk CI/rutin): D2 = 2 **dan** D4 = 2 (4 dimensi auto penuh = 8/8). Dipakai
  pada `run-test-plan.ts --suite=v2 --id=<kasus> --offline`.

## Alur Kerja

1. `npx tsx scripts/build-test-suite-v2.ts --tenant=default-tenant` — regenerasi fixture + snapshot
   referensi saat katalog/policy/tier berubah. Harus menghasilkan 119 kasus & tidak ada kebocoran PII.
2. `npx vitest run tests/unit/test-suite-v2-schema.test.ts` — red→green gate struktur fixture.
3. `npx tsx scripts/run-test-plan.ts --suite=v2 [--id=RF-01|--from=101|...] [--llm]`
   — replay per kasus (sandbox phone + reset in-memory store per kasus). Tanpa `--llm` = engine
   fallback rule-based (deterministik, offline).
4. Laporan auto di `test-results/test-suite-v2-report.md` → human reviewer mengisi D5/D6 lalu
   menetapkan lulus/gagal final.

## Batasan (lihat `docs/KNOWN_ISSUES.md` #0k)

- Build menuntut DB live. Snapshot bukan otoritas — hanya alat deteksi drift.
- Replay mode fallback offline bisa menampilkan divergensi eskalasi pada transaksi panjang
  (mis. CASE-003/037/082 → `HUMAN_HANDLING`); bukan bug scorer — audit & jangan langsung loloskan.
- `expected_total_price` hanya terkunci bila struktur harga jelas (1 layanan + 1 nominal);
  selainnya N/A.
- Deteksi kalender dibatasi 2026; anonimisasi nama Bunda/bayi di teks tetap verbatim.