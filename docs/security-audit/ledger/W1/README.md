# Seed Coverage Ledger — Wave 1 (M01–M07)

`coverage-ledger.json` berisi **91 unit** yang menutup **98 check** pada modul M01–M07. Sudah lolos:

```
node .agents/skills/security-audit/validate-coverage-ledger.cjs docs/security-audit/ledger/W1/coverage-ledger.json
# PASS: 91 coverage units valid
```

## Status

- Semua unit `planned`, `agent_id: null`, tanpa bukti. Ini **bukan hasil audit**.
- `prior_status: "none"` karena belum ada `findings.json`/ledger mesin yang kompatibel dari run sebelumnya. Laporan audit September 2026 berbentuk prosa, bukan ledger; revalidasinya dijalankan terpisah sebagai M00.
- `module` dan `check_ids` adalah field bookkeeping (bukan bagian semantik). `check_ids` memetakan unit ke [CHECKLIST.md](../../CHECKLIST.md).

## Cara pakai

1. Buat output run di luar repo:
   ```
   ~/security-audit-skill/chatbot-ag/W1/run-1/
   ```
2. Salin seed:
   ```
   Copy-Item docs\security-audit\ledger\W1\coverage-ledger.json <output-dir>\coverage-ledger.json
   ```
3. Orkestrator menjalankan F1: verifikasi surface di seed terhadap source saat ini, tambahkan unit yang kurang, tulis `architecture.md`, lalu validasi ulang.
4. Baru sebar hunter. Jangan mengedit seed di repo saat run berjalan — edit salinan di output dir. Seed di repo adalah baseline yang stabil.
5. Jangan mengubah `coverage_id` unit yang sudah ada; tambah unit baru bila surface/boundary baru ditemukan (critic wajib melakukannya).

## Isi per modul

| Modul | Unit | Check |
|---|---|---|
| M01 Ingress WAHA | 13 | M01-01…M01-16 |
| M02 Ingress WABA | 9 | M02-01…M02-13 |
| M03 Telegram | 10 | M03-01…M03-10 |
| M04 Auth admin | 16 | M04-01…M04-17 |
| M05 Auth staf | 14 | M05-01…M05-14 |
| M06 RBAC | 12 | M06-01…M06-12 |
| M07 Tenancy/IDOR | 17 | M07-01…M07-16 |
| **Total** | **91** | **98** |

## Catatan cakupan

- M00 (revalidasi 16 temuan + sisa `#129`) **tidak** dimasukkan ke ledger ini karena bukan surface source; jalankan sebagai workstream terpisah sebelum W1 dan suplai `prior_status` bila nanti ada ledger lama.
- M08–M22 belum di-seed; dibuat saat wave-nya tiba agar ledger tidak basi.
- Block serangan yang dipilih mengikuti skill: `ATTACK-CLASSES.md` sebagai blok utama, ditambah companion `DATA-ISOLATION-AND-LIFECYCLE.md`, `WEB-PROTOCOL-AND-AUTH.md`, `PROTOCOLS-RPC-AND-MESSAGING.md`, dan `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` sesuai domain unit.
- Tiga blok companion yang tidak relevan dikecualikan per unit dengan alasan: memory-safety/binary, desktop/mobile/IPC, dan AI/LLM (batas unit berhenti sebelum pipeline model).

## Regenerasi

Bila source berubah besar sebelum wave dimulai, seed boleh diregenerasi dari daftar check yang sama. Jangan menambah unit "generik" tanpa surface/boundary konkret — validator akan menolak ID duplikat atau tuple semantik ganda.
