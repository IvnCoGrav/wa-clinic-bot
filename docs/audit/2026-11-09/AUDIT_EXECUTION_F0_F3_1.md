# AUDIT EKSEKUSI F0–F3.1 — 2026-11-09

- **Sifat:** read-only audit terhadap hasil eksekusi F0–F3.1.
- **Baseline audit:** `11e7ce37` (`master`), working tree hanya berisi plan F3.2 (untracked).
- **Baseline uji pembanding:** `docs/audit/2026-11-09/after-s5-final.json` — 6.774 test / 6.743 lulus / 3 gagal known / 28 skip.
- **Metode:** verifikasi commit, pembacaan diff, hitung baris, grep call-site, targeted test, full suite, security scan.

> **Tindak lanjut 2026-11-10:** T1 (regresi test), T3–T8 sudah diperbaiki; `SM-02` dan `SM-04` tetap PARTIAL. Status lengkap: `docs/KNOWN_ISSUES.md` #322.

---

## 1. Gate Hasil Audit

| Pemeriksaan | Hasil | Catatan |
|---|---|---|
| `npm run build` | **PASS** | exit 0 |
| `npm run typecheck` | **PASS** | exit 0 |
| Dashboard build | **PASS** | exit 0 |
| Targeted F2/F3.1 | **PASS** | 53 test |
| Targeted F2C | **PASS** | 11 test |
| **Full suite** | **FAIL** | **6.834 test / 6.802 lulus / 4 gagal / 28 skip** |
| Security scan | **PASS** | 2.073 file, 0 kebocoran |

**4 kegagalan full suite:**
1. `hybrid-reservation-parser` (2) — pre-existing #287.
2. `customer-profile-edit-drift` (2) — **regresi baru** dari F2B (test masih memock `prisma.customer.update`, padahal service sudah lewat `CustomerRepository`).

**Kesimpulan gate:** **FAIL** — belum boleh lanjut F3.2 sebelum 2 regresi diperbaiki.

---

## 2. Verdict per Fase

| Fase | Verdict | Ringkasan |
|---|---|---|
| **F0** | **PASS** | Baseline 6.774 test, register 268 item, dedupe berjalan |
| **F1** | **PASS** | Modul 11 A–G + Track B 122 temuan ter-rebaseline |
| **F2A** | **PASS** | CFG-01, UTL-01, D-01 + test; migrasi perlu dry-run |
| **F2B** | **PARTIAL** | Banyak fix benar, tetapi 2 regresi test + D-02/D-03/FN-02 belum tuntas |
| **F2C** | **PARTIAL** | CFG-04 belum end-to-end; CI merah; backup belum terenkripsi |
| **F3.1** | **PARTIAL** | SM-01/05/08/09/10/11/12/13 fixed; SM-03/04/07/14 belum; SM-02 parsial |

---

## 3. Temuan Signifikan

### T1 — Regresi full suite (Prioritas 0)

**Fakta:** `customer-profile-edit-drift.test.ts` gagal 2 test setelah F2B.

- Test masih memock `prisma.customer.update`, sedangkan `updateCustomerLocation` kini memakai `getCustomerRepository().update(...)`.
- Log runtime menunjukkan perhitungan tetap berjalan (`Auto-recalculated distance ... 3.7 km / ongkir 10000`), jadi ini **test-mock drift**, bukan bukti perilaku rusak.
- **Dampak:** gate regresi merah; klaim F2B "complete" tidak sah.
- **Perbaikan:** update test agar memock `getCustomerRepository().update` (pola yang sudah dipakai `kelurahan-write-gate.test.ts` / `sticky-gps.test.ts`), pertahankan assertion yang sama. Jangan melemahkan assertion.

### T2 — F3.1 menandai semua SM FIXED, tetapi 4 belum tuntas (Prioritas 0/1)

| ID | Backlog | Aktual | Bukti |
|---|---|---|---|
| `SM-03` | FIXED | **PARTIAL** | `memoryConversations` masih `new Map()` tanpa batas di `conversation.service.ts:14`; yang dibatasi hanya `inFlightBotOutbounds` (1000) |
| `SM-04` | FIXED | **PARTIAL** | `resetConversationToInitial` (`conversation.service.ts:953-988`) memanggil update berurutan + `catch`, bukan `prisma.$transaction`; tidak atomik |
| `SM-07` | FIXED | **BELUM** | `MessageTransport.sendText` masih `Promise<boolean>` (`transport.ts:8`); WABA tetap membuang `messageId` (`transport.ts:26-30`) |
| `SM-14` | FIXED | **BELUM** | `listConversations` masih serial `getCustomerById` (`conversation.service.ts:376, 442`) |

Tambahan:
- `SM-02` **PARTIAL**: literal form masih ada di `reservation-text-parser.ts:98-108`; yang berubah hanya lokasi (dari `machine.ts` ke parser), bukan DB-driven.
- `SM-06` **fixed untuk lokasi yang dikutip**, tetapi masih ada hardcode `"Bunda"` di pesan lain (`machine.ts:221, 222, 401, 412`) — di luar scope SM-06, perlu dicatat sebagai temuan baru.
- Test `sm-durability-observability.test.ts` hanya menguji in-flight bound, tidak menguji `memoryConversations`; test SM-04 hanya memock method, tidak menguji atomisitas.

### T3 — F2B D-02/D-03 belum tuntas (Prioritas 0/1)

- `customer.service.ts` masih punya **2** `prisma.customer.update` langsung:
  - `:2153` (MQL counter)
  - `:2952` (persist koordinat/lokasi)
- `CustomerRepository.update(id, patch, tenantId?)` masih **opsional** (`customer.repository.ts:37, 75`); bila `tenantId` tidak dikirim, jatuh ke `prisma.customer.update({ where: { id } })` tanpa guard tenant.
- Backlog menandai D-02/D-03 **FIXED**; seharusnya **PARTIAL**.

### T4 — F2B FN-02 parsial: in-flight tidak dibersihkan saat gagal kirim

- `shareloc-reminder.service.ts:269` mendaftarkan in-flight sebelum kirim.
- `:272-275` jika `sendResult.success === false` langsung `continue`, **tanpa** `messageService.clearInFlightBotOutbound(...)`.
- Entry in-flight bisa tertinggal sampai TTL dan mengganggu deteksi echo. Backlog menandai FN-02 **FIXED**; seharusnya **PARTIAL**.

### T5 — F2C CFG-04 belum end-to-end (Prioritas 1)

- `follow-up.service.ts:2184-2185` menghitung `businessName`, tetapi **tidak pernah dikirim** ke `getRollingFollowUpMessage` (call di `:2220`, `:2231`, `:2461`).
- `followup-templates.ts:359` masih fallback ke `getBrandIdentity().businessName` global (Kala) bila `businessName` kosong.
- Test `followup-templates-tenant.test.ts` hanya menguji fungsi template dengan `businessName` eksplisit, bukan jalur service.
- Backlog menandai CFG-04 **FIXED**; seharusnya **PARTIAL**.

### T6 — F2C DEL-01: CI akan selalu merah (Prioritas 1)

- `.github/workflows/ci.yml` menjalankan `npm test` polos.
- Baseline memiliki **2 pre-existing failure** (`hybrid-reservation-parser`) dan kadang flaky `production_edge_cases`; tidak ada allowlist/baseline-diff.
- **Dampak:** pipeline CI gagal pada setiap push/PR, sehingga gate tidak berguna.
- **Perbaikan:** jalankan `audit-baseline-diff.mjs` terhadap baseline resmi, atau pisahkan known-failure allowlist; jangan `npm test` polos.

### T7 — F2C DEL-07: backup belum terenkripsi (Prioritas 1)

- `scripts/backup.sh` sudah menghapus `.env` dari tar dan memakai container `postgres`, tetapi arsip tetap `tar -czf` **tanpa enkripsi**.
- `verify-backup-restore.ts --dry-run` hanya dijalankan setelah arsip dibuat; bukan enkripsi AES-256-GCM seperti rekomendasi DEL-07.
- Backlog menandai DEL-07 **FIXED**; seharusnya **PARTIAL**.

### T8 — F2B UTL-04: allowlist masih terlalu longgar (Prioritas 2)

- `isAllowedGoogleMapsHost` mengizinkan regex `^(?:(?:maps|www)\.)?google\.(?:[a-z]{2,4}|...)$` — artinya **semua** `google.<tld>` 2–4 huruf.
- Seharusnya allowlist eksplisit (`google.com`, `google.co.id`, `maps.google.com`, `maps.app.goo.gl`, `goo.gl`, `share.google`) atau validasi kepemilikan domain.
- Test SSRF sudah bagus untuk private IP dan spoof subdomain; tambahkan test `google.<tld>` asing.

### T9 — F2A D-01: migrasi perlu dry-run & drift check (Prioritas 1)

- Migrasi `20261109120000_add_conversation_closed_at` menutup duplikat conversation aktif dan membuat partial unique index.
- Belum ada bukti `prisma migrate diff` bersih; partial index tidak direpresentasikan di schema Prisma sehingga rawan drift.
- **Perbaikan:** backup + dry-run + cek drift sebelum deploy; dokumentasikan partial index di runbook.

### T10 — Plan F3.2 memakai metrik basi (Prioritas 1)

| Klaim plan | Aktual |
|---|---|
| `follow-up.service.ts` 2.682 baris | **2.898** |
| `staff-notification.service.ts` 993 baris | **1.101** |
| `follow-up.service.ts:151-2709` | baris akhir sudah bergeser |
| 15 `(prisma as any)` di shareloc | **10** |
| Batas ekstraksi `~250/~700/~800` baris | belum ada line-range fungsi yang presisi |

Plan juga masih **untracked** dan diagramnya mengandung mojibake. Sebelum eksekusi, plan wajib dikoreksi dan di-commit.

---

## 4. Koreksi Status Backlog yang Diperlukan

| ID | Status sekarang | Seharusnya | Alasan |
|---|---|---|---|
| `SM-03` | FIXED | **PARTIAL** | `memoryConversations` unbounded |
| `SM-04` | FIXED | **PARTIAL** | reset tidak transaksional |
| `SM-07` | FIXED | **OPEN/PARTIAL** | kontrak transport masih boolean |
| `SM-14` | FIXED | **OPEN** | loop serial masih ada |
| `SM-02` | FIXED | **PARTIAL** | literal parser masih hardcoded |
| `D-02` | FIXED | **PARTIAL** | 2 direct update tersisa |
| `D-03` | FIXED | **PARTIAL** | `tenantId` masih opsional |
| `FN-02` | FIXED | **PARTIAL** | in-flight tidak dibersihkan saat gagal |
| `CFG-04` | FIXED | **PARTIAL** | `businessName` tidak diteruskan ke template |
| `DEL-01` | FIXED | **PARTIAL** | CI merah pada known failures |
| `DEL-07` | FIXED | **PARTIAL** | arsip backup belum terenkripsi |
| `UTL-04` | FIXED | **PARTIAL** | allowlist `google.<tld>` longgar |

**Dampak:** angka **235 OPEN** di `REMAINING_BACKLOG_2026-11-09.md` **understated**; setelah koreksi, jumlah open bertambah minimal 12 item.

---

## 5. Rekomendasi Sebelum F3.2

Urutan wajib:

1. **Perbaiki T1** — update mock test `customer-profile-edit-drift` ke repository seam; full suite harus kembali ke 2 pre-existing failure.
2. **Koreksi status backlog** (T2–T8) — jangan tandai FIXED jika belum.
3. **Tuntaskan atau deklarasikan eksplisit** SM-03/04/07/14; pilih `PARTIAL` + target fase berikutnya, bukan FIXED.
4. **Perbaiki CFG-04 end-to-end** — teruskan `businessName` ke semua call site atau hapus fallback global.
5. **Perbaiki FN-02 failure path** — `clearInFlightBotOutbound` saat `sendFailure`.
6. **Perbaiki CI** — baseline-diff/allowlist known failures.
7. **Perbaiki backup** — enkripsi AES-256-GCM atau dokumentasikan sebagai partial.
8. **Koreksi plan F3.2** — metrik, line range presisi, commit plan.
9. Baru eksekusi F3.2.

---

## 6. Verdict Akhir

- **F0:** PASS.
- **F1:** PASS.
- **F2A:** PASS (dengan catatan migrasi).
- **F2B:** **PARTIAL / gate FAIL** (2 regresi test + 3 temuan belum tuntas).
- **F2C:** **PARTIAL** (CFG-04, CI, backup).
- **F3.1:** **PARTIAL** (4 temuan belum tuntas, 2 test tidak menguji klaim).
- **F3.2:** **BELUM DIEKSEKUSI**; plan perlu koreksi.

**Tidak disarankan** menjalankan F3.2 sebelum T1–T3 diperbaiki.
