# Tata Kelola Pengecualian Reuse & Arsitektur (Exception Registry)

Dokumen ini mengatur prosedur pemberian dispensasi teknis sementara (*technical debt waiver*) terhadap aturan Reuse Gate dan Architecture Gate di repositori ini.

## Prinsip Dasar
1. **Tidak Ada Pengecualian Abadi**: Seluruh pengecualian teknis wajib memiliki tanggal kedaluwarsa tegas (`expiresAt`, maksimal 60 hari kalender).
2. **Deterministic Enforcement**: Mesin gate (`scripts/reuse/check-reuse.mjs`) secara otomatis memvalidasi file `scripts/reuse/exceptions.json`. Bila sebuah entri melewati tanggal `expiresAt`, gate akan **gagal otomatis** di lingkungan lokal dan CI, memaksa tim untuk menyelesaikan refaktor atau memperbarui izin.
3. **Pemberian Terbatas**: Pengecualian HANYA diberikan untuk situasi khusus:
   - Migrasi bertahap antar versi protokol (misal transisi WAHA ke WABA).
   - Hotfix darurat produksi di mana isolasi blast radius lebih diutamakan.
   - Dependensi pihak ketiga yang memerlukan mock paralel.

## Format File Registry
File: `scripts/reuse/exceptions.json`

```json
{
  "version": 1,
  "exceptions": [
    {
      "rule": "DUPLICATE_FUNCTION",
      "fingerprint": "sha256:...",
      "reason": "Adapter WAHA vs WABA sengaja paralel selama masa uji coba Cloud API",
      "owner": "backend",
      "expiresAt": "2026-12-31"
    }
  ]
}
```

## Prosedur Pengajuan Pengecualian
1. Buat PR yang menambahkan entri ke `scripts/reuse/exceptions.json`.
2. Cantumkan rincian `reason`, `owner`, dan `expiresAt` yang realistis.
3. Cantumkan issue/task tracking untuk pembersihan utang teknis tersebut.
4. Dapatkan persetujuan tim arsitektur sebelum merge.
