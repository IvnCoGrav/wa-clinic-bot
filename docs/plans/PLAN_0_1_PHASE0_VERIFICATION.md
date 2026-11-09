# PLAN 0.1 — Verifikasi Pasca-Phase 0 (Baseline & Diff)

- **Status:** **DRAFT — dieksekusi setelah Phase 0 selesai.**
- **Sifat:** read-only terhadap kode produksi. Hanya menjalankan test, menyimpan artifact, dan menulis dokumen verdict.
- **Tujuan:** membuktikan apakah hasil Phase 0 benar-benar hijau, lalu mencatat baseline baru.
- **Bukan:** perbaikan kode, merge branch, deploy, atau audit modul baru.

> Asumsi: “0.1” di sini adalah **langkah pertama setelah Phase 0**, yaitu baseline + diff. Jika yang dimaksud adalah task `0.1` di `FIXING_PLAN_AUDIT_2026-11-07.md` (test secret scanner), hentikan dan beri tahu saya.

---

## 0. Prasyarat — Satukan Working Tree (0.0)

**Plan 0.1 tidak menggabungkan branch/worktree.** Ia mengasumsikan sudah ada **satu working tree bersih**. Lakukan 0.0 dulu.

### Jika Phase 0 dikerjakan di branch/worktree lain

```powershell
# Di sesi Phase 0:
git branch --show-current
git add -A
git commit -m "wip(phase0): hasil eksekusi phase 0"
git push -u origin <nama-branch-phase0>

# Di workspace target:
git fetch origin
git checkout master
git merge --no-ff origin/<nama-branch-phase0>
# atau, jika ingin riwayat linear:
# git rebase origin/<nama-branch-phase0>
```

Jika ada konflik: selesaikan, `git add`, lalu `git merge --continue` / `git rebase --continue`.
Setelah selesai: `git status --short` **harus kosong**.

### Jika Phase 0 sudah ada di workspace ini

```powershell
git status --short
# Jika ada perubahan Phase 0 yang belum di-commit:
git add -A
git commit -m "wip(phase0): hasil eksekusi phase 0"
# Working tree harus bersih sebelum 0.1
```

### Jangan

- Jangan menjalankan 0.1 di working tree kotor.
- Jangan merge `fix/fase0-stabilisasi` kecuali branch itu memang output Phase 0 yang dimaksud; umurnya jauh di belakang `master`.
- Jangan mencampur artifact verifikasi 0.1 dengan commit Phase 0.

**Gate 0.0:** `git status --short` kosong; branch target sudah memuat hasil Phase 0; commit hash dicatat.

---

## 1. Precondition

| Cek | Perintah | Expected |
|---|---|---|
| Branch Phase 0 | `git branch --show-current` | Branch hasil Phase 0 |
| Commit | `git rev-parse --short HEAD` | Hash dicatat |
| Working tree | `git status --short` | Bersih (kecuali artifact yang akan dibuat) |
| Build | `npm run build` | Exit 0 |
| Typecheck | `npm run typecheck` | Exit 0 |

Jika working tree kotor karena perubahan Phase 0 yang belum di-commit: **commit dulu** di branch Phase 0, jangan campur dengan artifact verifikasi.

---

## 2. Langkah Eksekusi

### 0.1.1 — Catat identitas baseline
```powershell
git branch --show-current
git rev-parse HEAD
git status --short
```
Simpan output ke `docs/audit/2026-11-09/phase0-baseline.txt`.

### 0.1.2 — Build & typecheck
```powershell
npm run build
npm run typecheck
```
Jika salah satu gagal: **STOP**. Catat error; jangan lanjut ke full suite.

### 0.1.3 — Full suite JSON
```powershell
npx vitest run --reporter=json --outputFile=docs/audit/2026-11-09/after-phase0.json
```
Catat juga ringkasan console (total/pass/fail/skip) ke `docs/audit/2026-11-09/phase0-summary.txt`.

### 0.1.4 — Diff terhadap baseline lama
```powershell
node scripts/audit-baseline-diff.mjs docs/audit/2026-11-07/baseline-before.json docs/audit/2026-11-09/after-phase0.json
```
Simpan output ke `docs/audit/2026-11-09/phase0-diff.txt`.

Jika script tidak ada/tidak menerima argumen: gunakan perbandingan manual dari field `testResults` (daftar `fullName` + `status`).

### 0.1.5 — Klasifikasi setiap failure
Buat tabel di `docs/audit/2026-11-09/PHASE0_VERDICT.md`:

| Test | Status lama | Status baru | Klasifikasi | Bukti |
|---|---|---|---|---|
| `file :: test` | pass/fail | fail | regresi / disengaja / flaky / pre-existing | log / revert-and-rerun |

Aturan:
- **Regresi** → perbaiki kode; jangan melemahkan assertion.
- **Disengaja** → update test + catat alasan di `KNOWN_ISSUES`.
- **Pre-existing** → wajib buktikan dengan revert-and-rerun:
  ```powershell
  git stash push -m "phase0-verify-temp"
  git checkout <baseline-commit> -- <file-yang-dicurigai>
  npx vitest run <test-file>
  git checkout HEAD -- <file-yang-dicurigai>
  git stash pop
  ```
  Jika tetap gagal di baseline → pre-existing. Jika hijau di baseline → regresi.
- **Flaky** → jalankan test 3x; jika hasil berubah, catat sebagai flaky dan jangan hitung sebagai regresi.

### 0.1.6 — Verdict
Tulis di `PHASE0_VERDICT.md`:

```markdown
# Phase 0 Verdict — <tanggal>

- Commit: <hash>
- Total: <n> | Pass: <n> | Fail: <n> | Skip: <n>
- Failure baru vs baseline: <n>
- Regresi: <n>
- Disengaja: <n>
- Pre-existing: <n>
- Flaky: <n>

## Verdict
GREEN / RED

## Alasan
...

## Failure yang belum selesai
...

## Rekomendasi
Lanjut S1 / perbaiki dulu / stop
```

**GREEN** hanya jika:
- build + typecheck exit 0;
- tidak ada failure baru yang belum diklasifikasi;
- semua regresi sudah diperbaiki;
- semua failure pre-existing punya bukti revert-and-rerun.

---

## 3. Output yang Harus Dibawa Kembali

1. `docs/audit/2026-11-09/after-phase0.json`
2. `docs/audit/2026-11-09/phase0-diff.txt`
3. `docs/audit/2026-11-09/PHASE0_VERDICT.md`
4. Commit hash Phase 0.
5. Daftar failure + klasifikasi.

---

## 4. Stop Condition

- Jika verdict **RED**: **jangan mulai S1**. Kirim hasilnya ke sini untuk triage.
- Jika verdict **GREEN**: lanjut ke **S1** di `PLAN_FINISH_AUDIT_2026-11-09.md`.
- Jika build/typecheck gagal: stop sebelum full suite; kirim error.

---

## 5. Perintah Ringkas (Copy-Paste)

```powershell
# 1. identitas
git branch --show-current
git rev-parse HEAD
git status --short

# 2. gate
npm run build
npm run typecheck

# 3. full suite
npx vitest run --reporter=json --outputFile=docs/audit/2026-11-09/after-phase0.json

# 4. diff
node scripts/audit-baseline-diff.mjs docs/audit/2026-11-07/baseline-before.json docs/audit/2026-11-09/after-phase0.json
```

**Catatan:** jangan jalankan `npm run build` bersamaan dengan full suite; artifact bisa saling mengganggu. Jalankan berurutan.
