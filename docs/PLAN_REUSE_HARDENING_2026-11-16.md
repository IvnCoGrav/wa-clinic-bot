# Plan: Pengerasan Gerbang Anti-Duplikasi & Integritas Baseline (2026-11-16)

- **Status:** SELESAI — dieksekusi 2026-11-16 setelah Sprint 2.
- **Terkait:** `docs/KNOWN_ISSUES.md` #334 (RESOLVED) dan #355 (RESOLVED).
- **Tujuan:** mendekati jaminan "tidak ada modul baru yang duplikat" dengan menutup celah yang sebelumnya hanya berupa peringatan atau bisa dilewati manual.

---

## 1. Celah yang ditutup

| Celah sebelumnya | Perilaku baru |
|---|---|
| Duplikasi "ganti nama variabel" hanya `STRUCTURAL_DUPLICATION_WARN` | Menjadi pelanggaran `STRUCTURAL_DUPLICATION`; 5 grup lama dibekukan di baseline |
| `--update-baseline` bisa menaikkan angka | Ditolak; wajib `--allow-increase --reason="…"` (alasan ≥15 karakter) |
| Tukar pelanggaran lama ↔ baru dengan jumlah sama | Terdeteksi karena perbandingan berbasis key-set/hash, bukan jumlah |
| `--update-baseline --only=X` menghapus baseline kategori lain | Hanya kategori yang dihitung yang ditulis |
| Baseline bisa diedit manual naik lalu CI lolos | `check:baseline-ratchet` membandingkan dengan base ref di CI |
| `verify:backlog` gagal saat nomor baris bergeser | `contains` dicari di seluruh file; `line` hanya petunjuk (warning) |

---

## 2. Fase eksekusi

### Fase A — Gerbang bukti backlog (#334)
1. Ubah `scripts/verify-backlog-evidence.mjs`: keberadaan `contains` di file tetap wajib; ketidakcocokan `line` menjadi warning berisi baris aktual.
2. Jalankan `npm run verify:backlog` → PASS dengan 15 warning pergeseran.
3. Test `tests/unit/backlog-evidence-gate.test.ts` tetap hijau.

### Fase B — Ratchet hanya boleh turun
1. Buat `scripts/reuse/lib/baseline-ratchet.mjs` (key-set comparison untuk 5 kategori reuse + 4 kategori arsitektur).
2. Integrasikan ke `check-reuse.mjs` dan `check-architecture.mjs` pada blok `--update-baseline`.
3. Tambah `--allow-increase` + `--reason=`; alasan <15 karakter ditolak.
4. Perbaiki update per-kategori agar tidak menghapus baseline lain.

### Fase C — Duplikasi struktural menjadi pelanggaran
1. Tambah `structuralGroups` ke baseline `duplication.json` (versi 2).
2. Deteksi grup struktural baru / menyebar ke file baru sebagai pelanggaran.
3. Inisialisasi baseline 5 grup lama lewat `--allow-increase --reason="…"`.

### Fase D — Gerbang CI
1. Buat `scripts/reuse/check-baseline-ratchet.mjs` (base ref dari argumen/env, fallback `origin/master` / `HEAD~1`).
2. Tambah `npm run check:baseline-ratchet`.
3. CI: `fetch-depth: 0`, fetch base branch PR, jalankan step **Baseline Ratchet Integrity**.

### Fase E — Verifikasi
```powershell
npm run check:reuse
npm run check:architecture
npm run check:baseline-ratchet
npm run verify:backlog
npx vitest run tests/unit/baseline-ratchet.test.ts tests/unit/baseline-ratchet-ci.test.ts tests/unit/reuse-gate.test.ts tests/unit/backlog-evidence-gate.test.ts tests/unit/architecture-gate.test.ts
npm run typecheck
```

**Acceptance:** semua gate 0 pelanggaran baru; baseline hanya turun (kecuali inisialisasi `structuralGroups` yang dicatat); test adversarial hijau.

---

## 3. Batas jaminan (jujur)

1. Gerbang membandingkan **bentuk kode**, bukan makna. Dua modul berbeda struktur tetapi konsepnya sama tetap bisa lolos.
2. `--allow-increase` tetap ada sebagai escape hatch yang disengaja; penggunaannya tercetak keras di log dan wajib beralasan.
3. Registry hanya mengenal kapabilitas yang didaftarkan; pengetahuan bisnis baru wajib didaftarkan agar simbolnya dilarang di tempat lain.
4. Branch protection GitHub (required check) adalah setelan eksternal dan tidak dapat diubah dari repo ini.

---

## 4. Hasil

| Item | Hasil |
|---|---|
| Duplikasi struktural lama dibekukan | 5 grup di `duplication.json` v2 |
| Baseline total setelah inisialisasi | 191 (sebelumnya 186; +5 struktural) |
| `check:reuse` | 0 pelanggaran baru |
| `check:architecture` | 0 pelanggaran baru (240 Prisma / 6 siklus) |
| `check:baseline-ratchet` vs `9b60a1d4`/`16e09e19` | OK (tidak ada kenaikan) |
| `verify:backlog` | PASS (15 warning pergeseran) |
| Test adversarial | 9 + 1 + 14 + 6 hijau |
