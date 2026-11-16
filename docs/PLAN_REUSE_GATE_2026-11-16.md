# Plan: Reuse Gate & Anti-Spaghetti (2026-11-16)

- **Status:** DRAFT — menunggu persetujuan eksekusi eksplisit dari manusia.
- **Basis kode:** commit `8e65834d`, working tree bersih.
- **Terkait:** `docs/KNOWN_ISSUES.md` #345, `docs/MODULE_AUDIT_03_UTILS.md` (UTL-02, UTL-11), `docs/KNOWN_ISSUES.md` #326.
- **Sifat:** rencana bertahap. Tidak ada fase yang boleh dimulai tanpa persetujuan pada fase sebelumnya bila fase tersebut menyentuh kode runtime.

---

## 1. Tujuan

Membuat **reuse menjadi jalur termurah** dan **duplikasi pengetahuan menjadi otomatis gagal**, bukan bergantung pada ingatan manusia/AI.

Hasil akhir yang ingin dicapai:

1. Setiap kapabilitas inti punya satu modul kanonis yang terdaftar dan mudah dicari.
2. PR baru tidak bisa menambah duplikasi, modul pengganti, file raksasa, atau halaman baru tanpa justifikasi.
3. UI/UX memakai primitif, pattern, hook, util, dan API client yang sudah ada sebelum membuat baru.
4. Utang lama turun terukur (ratchet), bukan hanya "tidak bertambah".
5. `AGENTS.md` tetap ramping: kontrak di sana, detail di registry.

### Non-goals (sengaja tidak dikerjakan di plan ini)

- Menghapus seluruh kandidat export mati sekaligus (170 runtime function/const/class).
- Memecah seluruh 9 file >1.500 baris fisik dalam satu PR.
- Menambah ESLint/Knip/jscpd (dependency baru; butuh persetujuan terpisah).
- Redesign visual dashboard.
- Menyentuh logika RAG/LLM.

---

## 2. Prinsip yang mengikat semua fase

1. **Satu pengetahuan, satu modul.** Duplikasi sah hanya bila *reason to change*-nya berbeda (adapter WAHA vs WABA, fixture test, komposisi layout).
2. **Ratchet.** Baseline mencatat kondisi sekarang; PR gagal jika menambah; baseline hanya boleh turun.
3. **Warn dulu, fail kemudian.** Gate baru masuk mode peringatan 1–2 minggu untuk menyetel false positive.
4. **Zero dependency baru.** Semua gate memakai Node built-in + `typescript` yang sudah ada di devDependencies.
5. **Satu PR satu perbaikan.** Untuk deduplikasi runtime, satu temuan satu PR agar rollback bersih.
6. **Karakterisasi sebelum ubah perilaku.** Untuk overlap/tanggal/PII, tulis test yang mengunci perilaku lama dulu, baru ganti implementasi.

---

## 3. Ringkasan fase

| Fase | Nama | Dependency | Blast radius | Effort | Gerbang penutup |
|---|---|---|---|---|---|
| 0 | Baseline & pembekuan angka | — | Nol (read-only) | 0,5 hari | Angka baseline tercatat |
| 1 | Registry modul + discovery | F0 | Nol (tooling) | 1 hari | Registry valid, `find:module` jalan |
| 2 | Gate reuse inti (warn) | F1 | CI saja | 2 hari | Self-test gate hijau |
| 3 | Gate arsitektur (warn) | F2 | CI saja | 1,5 hari | Tidak ada pelanggaran baru |
| 4 | Perbaikan duplikasi berisiko tinggi | F3 | Runtime (tinggi) | 3 hari | Build + test parity + full suite |
| 5 | UI registry + galeri + gate | F1 | Dashboard | 2 hari | Registry 100% + gate hijau |
| 6 | Amendemen `AGENTS.md` + pointer guard | F2, F5 | Perilaku agent | 0,5 hari | Test pointer hijau |
| 7 | Burn-down & operasional | Semua | Proses | berkelanjutan | Metrik turun per sprint |

**Total perkiraan:** 10–11 hari kerja efektif, belum termasuk burn-down berkelanjutan.

---

## 4. Fase 0 — Baseline & pembekuan angka (read-only)

### Tujuan

Mengunci angka awal agar setiap klaim "turun" bisa dibuktikan. Tidak ada file source yang diubah.

### Micro-tasks

| ID | Aksi | Perintah | Output |
|---|---|---|---|
| F0-1 | Catat commit & status | `git rev-parse --short HEAD`; `git status --porcelain` | Commit + `changed_files=0` |
| F0-2 | Hitung file & baris | script scan `src/**/*.ts` | 424 file / 125.611 baris |
| F0-3 | Hitung file >1.500 baris | `Get-ChildItem src -Recurse -Filter *.ts \| ForEach-Object { ... }` | 9 file baris fisik (7 jika tanpa baris kosong; daftar di #345) |
| F0-4 | Hitung panggilan Prisma di route | `rg -c "prisma\.[a-zA-Z]+\\." src/routes` | 285 panggilan / 35 file |
| F0-5 | Hitung `fetch` mentah dashboard | `rg -n "fetch\\(" packages/admin-dashboard/src` | 9 lokasi |
| F0-6 | Hitung halaman & komponen | `Get-ChildItem packages/admin-dashboard/src/pages -Recurse -Filter *.tsx` | 60 page / 99 komponen |
| F0-7 | Simpan artefak | tulis `docs/audit/2026-11-16/reuse-baseline.md` | tabel angka + perintah reproduksi |

### Acceptance criteria

- `docs/audit/2026-11-16/reuse-baseline.md` memuat angka + perintah yang bisa dijalankan ulang.
- Angka cocok dengan #345 (9 file >1.500 baris fisik, 285 Prisma, 9 fetch, 60 page).
- Tidak ada perubahan pada `src/**`, `tests/**`, `packages/**`.

### Regression gate

Tidak perlu build/test karena read-only. Cukup `git status --porcelain` menunjukkan hanya file docs baru.

---

## 5. Fase 1 — Registry modul + discovery

### Tujuan

Membuat "modul yang ada" bisa ditemukan dalam <5 detik, tanpa enforcement apa pun.

### Struktur file baru

```
scripts/
  module-registry.json                 # sumber kebenaran mesin
  reuse/
    lib/paths.mjs                      # root, glob file, resolve path
    lib/registry.mjs                   # load + validasi + generate markdown
    find-module.mjs                    # CLI pencarian
    generate-module-index.mjs          # generate docs/MODULE_INDEX.md
docs/
  MODULE_INDEX.md                      # generated, untuk manusia
tests/unit/module-registry.test.ts     # validasi registry + CLI
```

### F1-0 — Verifikasi environment (sudah dilakukan 2026-11-16)

Verifikasi read-only terhadap commit `8e65834d` menemukan 3 ketidaksesuaian pada draft awal, sehingga isi registry F1 dikoreksi:

1. `effectiveDuration`/`intervalsOverlap` di `slot-overlap.service.ts` masih **private**, belum bisa menjadi `exports` yang valid → kapabilitas `schedule.overlap` ditunda ke F4-2.
2. `src/utils/regex-escape.ts` belum ada → kapabilitas `regex.escape` ditunda ke F4-6.
3. `ensureLogsDir`/`getLogDateString` di `log-buffer.ts` juga masih **private** → kapabilitas `log.dir` ditunda (di luar F1–F4).
4. Sebagian path test di draft awal tidak ada. Path aktual sudah diganti di tabel F1-2 (`staff-chat-pii-masker.test.ts`, `wib-time-consolidation.test.ts`, `v3/indonesian-date-parser.test.ts`).

Prinsip koreksi: registry F1 hanya memuat kapabilitas yang **canonical + exports-nya sudah valid sekarang**. Entri yang belum siap ditunda agar validasi tidak gagal dan `find:module` tidak menunjuk file yang belum ada.

### F1-1 — Skema `scripts/module-registry.json`

```json
{
  "version": 1,
  "capabilities": [
    {
      "id": "pii.mask_phone",
      "title": "Masking nomor telepon",
      "description": "Menyensor nomor HP untuk log, audit, dan tampilan staf.",
      "canonical": "src/utils/pii-masker.ts",
      "exports": ["maskPhoneNumber", "maskPhoneInText"],
      "forbiddenDeclarations": ["maskPhone", "maskPhoneNumber", "maskPhoneInText"],
      "allowedFiles": ["src/utils/pii-masker.ts"],
      "test": "tests/unit/staff-chat-pii-masker.test.ts"
    }
  ]
}
```

**Aturan validasi registry:**

- `id` unik, format `domain.kapabilitas`.
- `canonical` ada dan mengekspor semua nama di `exports`.
- `test` **opsional**; bila diisi, file harus ada.
- Tidak ada dua kapabilitas dengan `canonical` sama.
- `allowedFiles` semua ada.

### F1-2 — Isi awal registry (8 kapabilitas aktif)

| ID | Canonical | Exports (aktual) | Forbidden declarations (di luar canonical) | Test aktual |
|---|---|---|---|---|
| `time.wib` | `src/utils/wib-time.ts` | `WIB_OFFSET_MS`, `getWibNow`, `wibDayBoundsUtc`, `formatWibTime`, `wibDayRangeToUtc`, `formatWibDateYYYYMMDD`, `getWibDayName` | `WIB_OFFSET_MS`, `getWibNow`, `wibDayBoundsUtc`, `formatWibTime`, `wibDayRangeToUtc` | `tests/unit/wib-time-consolidation.test.ts` |
| `phone.normalize` | `src/utils/phone-normalizer.ts` | `normalizePhoneID`, `normalizePhoneToE164` | `normalizePhone`, `normalizePhoneID`, `normalizePhoneToE164` | `tests/unit/security-and-parsing-helpers.test.ts` |
| `pii.mask_phone` | `src/utils/pii-masker.ts` | `maskPhoneNumber`, `maskPhoneInText` | `maskPhone`, `maskPhoneNumber`, `maskPhoneInText` | `tests/unit/staff-chat-pii-masker.test.ts` |
| `date.parse_indonesian` | `src/utils/indonesian-date-parser.ts` | `parseIndonesianDate`, `applyBookingTimeToDate` | `parseIndonesianDate` | `tests/unit/v3/indonesian-date-parser.test.ts` |
| `location.clinic_question` | `src/utils/location-classifier.ts` | `isClinicLocationQuestion` | `isClinicLocationQuestion` | `null` (dibuat di F4-1) |
| `reservation.payment_evaluation` | `src/services/reservation-core.service.ts` | `resolveReservationPaymentEvaluation` | `resolveReservationPaymentEvaluation` | `null` (dibuat di F4-5) |
| `tenant.resolve` | `src/routes/admin/settings-helpers.ts` | `resolveTenantId`, `requireTenantId` | `resolveTenant`, `resolveTenantId` | `null` |
| `json.extract` | `src/utils/json-extract.ts` | `extractBalancedJson`, `extractJsonContent`, `repairTruncatedJson` | `extractBalancedJson` | `tests/unit/json-extract.test.ts` |

**Ditunda dari F1 (sengaja):**

| ID | Alasan | Ditangani di |
|---|---|---|
| `schedule.overlap` | `effectiveDuration`/`intervalsOverlap` masih private | F4-2 (export + hapus salinan) |
| `regex.escape` | `src/utils/regex-escape.ts` belum ada | F4-6 (buat modul + re-export) |
| `log.dir` | `ensureLogsDir`/`getLogDateString` masih private | Fase lanjutan di luar F1–F4 |

Catatan: `allowedFiles` dipakai untuk file kompatibilitas (mis. `src/utils/time-wib.ts` untuk `time.wib`).

### F1-3 — CLI `find-module.mjs`

Perilaku:

```powershell
npm run find:module -- "masking hp"
```

Output minimal:

```
CANONICAL  pii.mask_phone
  File     src/utils/pii-masker.ts
  Exports  maskPhoneNumber, maskPhoneInText
  Dipakai  12 file
  Test     tests/unit/staff-chat-pii-masker.test.ts
  Alias    maskPhone (DEPRECATED — lihat baseline)
```

Aturan pencarian:

- Skor cocok pada `id`, `title`, `description`, `exports`, dan nama file.
- Tampilkan maksimal 5 hasil, terurut skor.
- Exit 0 bila ada hasil; exit 1 bila tidak ada (agar agent tahu harus membuat baru + mendaftarkan).

### F1-4 — Generator `docs/MODULE_INDEX.md`

- Sumber satu-satunya: `module-registry.json`.
- Output deterministik (urutan berdasarkan `id`; tanpa timestamp).
- Dijalankan via `npm run docs:modules`.
- CI (fase 2) memeriksa: generate ulang → `git diff --exit-code docs/MODULE_INDEX.md`.

### F1-5 — Package scripts

Tambahkan ke `package.json`:

```json
"find:module": "node scripts/reuse/find-module.mjs",
"docs:modules": "node scripts/reuse/generate-module-index.mjs",
"check:reuse": "node scripts/reuse/check-reuse.mjs",
"check:reuse:update": "node scripts/reuse/check-reuse.mjs --update-baseline --allow-update"
```

### F1-6 — Test `tests/unit/module-registry.test.ts`

Kasus:

1. Semua `canonical` + `exports` valid.
2. Semua `test` yang dideklarasikan ada.
3. Tidak ada `id`/`canonical` duplikat.
4. `find:module "masking hp"` mengembalikan `pii.mask_phone` dan exit 0.
5. `find:module "tidak-ada-kapabilitas-xyz"` exit 1.
6. Generate markdown dua kali menghasilkan output identik.

### Acceptance criteria Fase 1

- `npm run find:module -- "masking hp"` menampilkan `src/utils/pii-masker.ts`, exit 0.
- `npm run docs:modules` dua kali → `git diff` kosong.
- `npx vitest run tests/unit/module-registry.test.ts` hijau.
- `npm run typecheck` hijau.
- Tidak ada perubahan runtime.

### Regression gate

```powershell
npm run typecheck
npx vitest run tests/unit/module-registry.test.ts
npm test
```

### Rollback

Hapus file baru + 4 script di `package.json`. Tidak ada runtime yang terpengaruh.

---

## 6. Fase 2 — Gate reuse inti (warn-only)

### Tujuan

Mendeteksi duplikasi, deklarasi simbol terlarang, export mati, dan file raksasa; belum memblokir PR.

### Struktur file baru

```
scripts/reuse/
  lib/ast.mjs               # baca file TS, collect function/class/export
  lib/fingerprint.mjs       # hash exact + structural
  lib/baseline.mjs          # baca/tulis/bandingkan baseline
  check-reuse.mjs           # orkestrator + CLI
  baselines/
    duplication.json
    forbidden-declarations.json
    dead-exports.json
    file-size.json
tests/
  unit/reuse-gate.test.ts
  fixtures/reuse-gate/*.fixture.ts
```

### F2-1 — `lib/ast.mjs`

Fungsi yang diekspor:

```js
export function listTsFiles(root, { exclude = [] }) {}
export function parseTsFile(filePath) {}          // return ts.SourceFile
export function collectFunctionLike(sourceFile) {} // { name, startLine, endLine, tokenCount, node }
export function collectTopLevelDeclarations(sourceFile) {} // { name, kind, startLine }
export function collectExports(sourceFile) {}      // { name, kind, startLine }
```

Aturan:

- Hanya `src/**/*.ts`; exclude `src/scripts/**`, `src/cli/**`.
- File test tidak dipindai untuk duplikasi; hanya dipakai untuk menghitung "dipakai test".

### F2-2 — `lib/fingerprint.mjs`

Dua mode:

1. **Exact hash** — token body apa adanya (identifier + literal dipertahankan), komentar dibuang oleh AST. Dipakai untuk **fail**.
2. **Structural hash** — identifier lokal dan literal diganti placeholder (`ID`, `LIT`). Dipakai untuk **warn** saja (mendeteksi salinan yang variabelnya diganti nama).

Ambang:

- Minimal 40 token untuk fungsi.
- Minimal 12 baris normalisasi untuk blok non-fungsi (opsional, fase lanjutan).

### F2-3 — `check-reuse.mjs`

Urutan pemeriksaan:

1. **Registry valid** (dari F1).
2. **Forbidden declarations** — nama di `forbiddenDeclarations` hanya boleh dideklarasikan di `canonical`/`allowedFiles`. Bandingkan dengan baseline.
3. **Duplikasi exact** — grup hash dengan ≥2 file. Baseline menyimpan hash + daftar file. Fail bila hash baru atau file baru masuk grup lama.
4. **Dead exports** — export function/const/class dengan 0 referensi di `src` + `tests`. Baseline menyimpan daftar. Fail bila ada export baru tanpa referensi.
5. **File size** — baseline map file >1.500. Fail bila file baseline bertambah baris, atau file baru >1.500.

Opsi CLI:

```
--warn             # laporkan, exit 0
--json             # output JSON untuk CI/artefak
--only=<check>     # duplication|forbidden|dead-exports|file-size
--root=<dir>       # untuk self-test fixture
--update-baseline  # hanya bila --allow-update juga ada
--allow-update     # sengaja eksplisit; CI tidak pernah memakainya
```

Format pesan:

```
[REUSE GATE] 3 violation(s)
1. FORBIDDEN_DECLARATION src/services/capi.service.ts:57  maskPhone
   canonical: src/utils/pii-masker.ts
   fix: import { maskPhoneNumber } from '../utils/pii-masker'
2. DUPLICATE_FUNCTION src/services/slot-overlap.service.ts:115
   same as src/services/reservation-core.service.ts:321
3. FILE_TOO_LARGE src/services/customer.service.ts  3128 > 1500
```

### F2-4 — Baseline awal

Generate dengan `npm run check:reuse:update` **sekali**, lalu review manual:

- `duplication.json`: semua grup duplikat saat ini (exact hash).
- `forbidden-declarations.json`: semua pelanggaran saat ini per kapabilitas.
- `dead-exports.json`: semua export tanpa referensi.
- `file-size.json`: 9 file >1.500 baris fisik + jumlah barisnya.

Baseline **tidak boleh** memuat timestamp yang berubah-ubah; gunakan `generatedFromCommit`.

### F2-5 — Integrasi CI (warn)

Tambahkan langkah di `.github/workflows/ci.yml` setelah typecheck:

```yaml
      - name: Reuse Gate (warn)
        run: npm run check:reuse -- --warn --json > reuse-report.json || true

      - name: Upload Reuse Report
        uses: actions/upload-artifact@v4
        with:
          name: reuse-report
          path: reuse-report.json
```

### F2-6 — Self-test `tests/unit/reuse-gate.test.ts`

Fixture di `tests/fixtures/reuse-gate/`:

| Fixture | Harapan |
|---|---|
| `duplicate-a.fixture.ts` + `duplicate-b.fixture.ts` | exit 1, `DUPLICATE_FUNCTION` |
| `banned.fixture.ts` mendeklarasikan `isClinicLocationQuestion` | exit 1, `FORBIDDEN_DECLARATION` |
| `unused-export.fixture.ts` | exit 1, `DEAD_EXPORT` |
| `oversized.fixture.ts` (1.501 baris) | exit 1, `FILE_TOO_LARGE` (dengan `--max-lines=1500`) |
| `clean.fixture.ts` | exit 0 |
| `allowed-reexport.fixture.ts` | exit 0 (re-export dari canonical) |
| `renamed-copy.fixture.ts` | exit 0 untuk exact, muncul di `structuralWarn` |

Pengujian memanggil script dengan `--root=<temp-fixture>` dan memeriksa exit code + isi JSON.

### Acceptance criteria Fase 2

- `npm run check:reuse -- --warn` selesai <30 detik.
- Jumlah temuan sama dengan baseline (0 "new").
- Self-test 7 kasus hijau.
- CI tetap hijau (warn-only).
- `docs/MODULE_INDEX.md` tidak berubah saat generate ulang.

### Regression gate

```powershell
npm run typecheck
npx vitest run tests/unit/reuse-gate.test.ts tests/unit/module-registry.test.ts
npm test
```

### Rollback

Hapus langkah CI + file `scripts/reuse/*` baru. Baseline tidak memengaruhi runtime.

---

## 7. Fase 3 — Gate arsitektur (warn-only)

### Tujuan

Mencegah spaghetti struktural: import lintas lapisan, siklus, Prisma di route, dan integrasi langsung di admin route.

### F3-1 — `lib/import-graph.mjs`

- Parse import statis + `import('...')` + `require('...')`.
- Resolve path relatif ke file `.ts` / `index.ts`.
- Output: `Map<file, imports[]>` + daftar siklus (Tarjan SCC).

### F3-2 — Aturan `check-architecture.mjs`

| Aturan | Definisi | Baseline awal |
|---|---|---|
| `LAYER_UTILS` | `src/utils/**` tidak boleh import `services`, `routes`, `db`, `integrations` | 3 pelanggaran (`customer-bypass`, `jid`, `reservation-text-parser`) |
| `LAYER_DOMAIN` | `src/domain/**` tidak boleh import `services`, `routes`, `db`, `integrations` | 0 |
| `LAYER_SERVICES` | `src/services/**` tidak boleh import `routes` | 0 |
| `ADMIN_NO_NEW_INTEGRATION` | `src/routes/admin/**` tidak boleh menambah import `integrations/**` | 8 file existing |
| `NO_NEW_CYCLE` | Tidak ada siklus import baru | baseline siklus existing |
| `PRISMA_BUDGET` | Jumlah `prisma.<model>.<method>` per file route tidak boleh naik | 285 / 35 file |
| `ROUTE_UNIQUE` | Tidak ada method+path ganda | 0 (Fastify sudah menolak) |

Catatan: aturan `LAYER_UTILS` dan `ADMIN_NO_NEW_INTEGRATION` memakai baseline karena pelanggaran lama sudah ada. Yang dilarang adalah **penambahan baru**.

### F3-3 — Integrasi CI (warn)

```yaml
      - name: Architecture Gate (warn)
        run: npm run check:architecture -- --warn --json > architecture-report.json || true
```

`package.json`:

```json
"check:architecture": "node scripts/reuse/check-architecture.mjs"
```

### F3-4 — Self-test

Fixture:

- `cycle-a.ts` ↔ `cycle-b.ts` → fail.
- `utils-imports-service.ts` → fail.
- `route-prisma-budget.ts` dengan panggilan melebihi baseline → fail.
- `clean.ts` → pass.

### Acceptance criteria Fase 3

- 0 pelanggaran baru terhadap baseline.
- Self-test 4 kasus hijau.
- Runtime gate <10 detik.
- CI hijau (warn).

### Regression gate

Sama seperti Fase 2 + `npm run check:architecture -- --warn`.

---

## 8. Fase 4 — Perbaikan duplikasi berisiko tinggi (runtime)

**Ini fase paling berisiko.** Setiap perbaikan adalah satu PR kecil dengan test karakterisasi lebih dulu.

### Urutan berdasarkan RPN

| ID | Temuan | RPN | Test karakterisasi dulu? |
|---|---|---|---|
| F4-1 | `isClinicLocationQuestion` ganda | 96 | Tidak (identik) |
| F4-2 | `effectiveDuration`/`intervalsOverlap` ganda | 224 | Ya |
| F4-3 | Masking PII 4 varian | 245 | Ya |
| F4-4 | Dua `parseIndonesianDate` | 240 | Ya (paling ketat) |
| F4-5 | `withPaymentEvaluation` ganda | 120 | Tidak |
| F4-6 | `escapeRegex` 5 salinan | 60 | Tidak |
| F4-7 | `parseArgs` 10 salinan (scripts) | 18 | Tidak |

---

### F4-1 — `isClinicLocationQuestion`

**File:** `src/services/entity-extractor.service.ts:33-54`

**Aksi:**

1. Tambahkan import di blok import atas:
   ```ts
   import { isClinicLocationQuestion } from '../utils/location-classifier';
   ```
2. Hapus tiga konstanta (`QUESTION_LEAD_RE`, `CLINIC_LOCATION_QUESTION_RE`, `LOCATION_QUESTION_PHRASE_RE`) dan fungsi lokal (baris 33–54).
3. Tambahkan re-export kompatibilitas tepat setelah import:
   ```ts
   export { isClinicLocationQuestion };
   ```
4. Pemakaian internal di baris 215 tetap valid (nama sama).

**Test:** `tests/unit/location-classifier.test.ts` (tambahkan kasus parafrase: "lokasinya dimana ya", "tanya alamat klinik", "di mana tempatnya", "saya di rungkut").

**Acceptance:**

- `rg -c "function isClinicLocationQuestion" src` → 1 (hanya di `utils/location-classifier.ts`).
- Test lama + baru hijau.
- `npm run check:reuse -- --warn` tidak menambah temuan.

---

### F4-2 — `effectiveDuration` + `intervalsOverlap`

**File:**

- `src/services/slot-overlap.service.ts:108-121` → jadikan `export`.
- `src/services/reservation-core.service.ts:315-325` → hapus.
- `src/services/reservation-core.service.ts:363, 440` → sesuaikan call site.

**Aksi:**

1. Di `slot-overlap.service.ts`:
   ```ts
   export function effectiveDuration(v: unknown, fallback = 60): number { ... }
   export function intervalsOverlap(aStartMs: number, aMins: number, bStartMs: number, bMins: number): boolean { ... }
   ```
2. Di `reservation-core.service.ts`, hapus kedua fungsi lokal, tambahkan:
   ```ts
   import { effectiveDuration, intervalsOverlap } from './slot-overlap.service';
   ```
3. Ubah 2 call site:
   ```ts
   return intervalsOverlap(
     bookingDate.getTime(),
     durationMinutes,
     existingStart.getTime(),
     existingDur
   );
   ```
4. `effectiveDuration` di baris 867/873 tetap valid (signature sama).

**Test karakterisasi:** `tests/unit/slot-overlap-parity.test.ts`

- Back-to-back (10:00–11:00 vs 11:00–12:00) → tidak overlap.
- Overlap parsial (10:30–11:30 vs 11:00–12:00) → overlap.
- Durasi invalid (`null`, `0`, `-5`, `999`) → clamp 60/15..480 sesuai perilaku lama.
- Reservasi panjang mulai sebelum window → tetap terdeteksi (regresi R2.1).

**Acceptance:** test parity hijau; `rg "function intervalsOverlap" src` → 1.

---

### F4-3 — Masking PII

**Keputusan kontrak yang harus disepakati sebelum eksekusi:**

| Kebutuhan | Fungsi kanonis | Format |
|---|---|---|
| Log/audit internal | `maskPhoneNumber` | `0812****789` (4 + **** + 3) |
| Tampilan teks bebas | `maskPhoneInText` | `0812-345*****` |
| Log CAPI dengan suffix tenant | `maskPhoneWithTenantSuffix` (pindah dari `capi.service.ts`) | `0812****789:tenant` |

**Aksi:**

1. Pindahkan `maskPhone` dari `src/services/capi.service.ts:57-70` ke `src/utils/pii-masker.ts` sebagai:
   ```ts
   export function maskPhoneWithTenantSuffix(phone?: string | null): string { ... }
   ```
   `capi.service.ts` mengimpor fungsi itu; hapus definisi lokal.
2. Hapus `maskPhoneNumber` lokal di `src/services/staff-retention.service.ts:718-723`; impor dari `pii-masker`.
3. **Adjudikasi** `src/services/nightly-watchdog.service.ts:40-44`: fungsi bernama `maskPhone` tetapi **tidak memasking** (hanya memberi tanda hubung). Jika nomor penuh memang dibutuhkan untuk laporan internal, ganti nama menjadi `formatPhoneForReport` dan daftarkan sebagai kapabilitas `phone.format_report`; jika tidak, ganti dengan `maskPhoneNumber`. Jangan deduplikasi secara buta.
4. Tambahkan test: `tests/unit/pii-masker.test.ts` (format log, suffix tenant, input kosong, nomor pendek, idempotensi).

**Acceptance:**

- `rg "function maskPhone" src` → 1 (atau 0 bila `formatPhoneForReport` dipisah).
- Tidak ada perubahan pada isi pesan customer (hanya log/display).
- Test PII hijau + test capi/staff-retention hijau.

---

### F4-4 — Dua `parseIndonesianDate`

**File:**

- `src/utils/indonesian-date-parser.ts:61` (kanonis)
- `src/utils/conversation-transaction-extractor.ts:208-293` (salinan)

**Langkah wajib (test-first):**

1. Buat `tests/fixtures/date-parser/corpus.ts` berisi ≥30 string nyata:
   - `"Rabu, 12 agustus 26 jam 12.30"`
   - `"Selasa tgl 7 Juli 2026"`
   - `"26 july 2026"`
   - `"besok jam 10"`
   - `"tanpa tanggal"`
   - `"7-07-2026"`
   - `"jam 00.30 senin 5 oktober 2026"`
   - variasi typo dan tanpa tahun.
2. Buat `tests/unit/date-parser-parity.test.ts` yang membandingkan output kedua parser. Untuk kasus yang tidak dikenali, keduanya harus `null`/`isRecognized=false`.
3. Jika ada perbedaan, **perbaiki parser kanonis** (bukan menambah cabang di adapter) sampai parity tercapai.
4. Ganti isi `conversation-transaction-extractor.ts` menjadi adapter:
   ```ts
   import { parseIndonesianDate as parseCanonical } from './indonesian-date-parser';

   export function parseIndonesianDate(dateStr: string): Date | null {
     if (!dateStr || typeof dateStr !== 'string') return null;
     const parsed = parseCanonical(dateStr);
     return parsed.isRecognized ? parsed.date : null;
   }
   ```
5. Jika canonical belum menangani `jam`, tambahkan ekstraksi jam ke `indonesian-date-parser.ts` + `applyBookingTimeToDate`, lalu uji parity.

**Acceptance:**

- Hanya satu implementasi parser tanggal Indonesia.
- 30+ kasus parity hijau.
- Test `save-reservation` dan `conversation-transaction-extractor` hijau.
- Tidak ada booking date fiktif (regresi UTL-01).

**Risiko:** perubahan perilaku pada data historis/backfill. Mitigasi: corpus dari log nyata + jalankan test pada fixture, bukan DB produksi.

---

### F4-5 — `withPaymentEvaluation`

**File baru:** `src/routes/admin/shared/reservation-response.ts`

```ts
import { resolveReservationPaymentEvaluation } from '../../../services/reservation-core.service';

export function withPaymentEvaluation<T extends Record<string, any> | null>(r: T) {
  if (!r) return r;
  return { ...r, paymentEvaluation: resolveReservationPaymentEvaluation(r) };
}
```

**Aksi:**

1. Hapus definisi lokal di `reservation-crud.route.ts:23-25` dan `reservation-dispatch-crud.subroute.ts:26-29`.
2. Tambahkan import dari `./shared/reservation-response`.
3. Daftarkan di registry sebagai `reservation.payment_evaluation` dengan `allowedFiles` termasuk file shared tersebut.

**Test:** `tests/unit/reservation-payment-response.test.ts` (null, objek biasa, objek dengan paymentEvaluation existing).

---

### F4-6 — `escapeRegex`

**File baru:** `src/utils/regex-escape.ts`

```ts
/** Escape karakter regex untuk dipakai di dalam RegExp dinamis. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

**Aksi:**

1. `src/utils/gazetteer.ts:14` → ganti definisi dengan re-export:
   ```ts
   export { escapeRegex } from './regex-escape';
   ```
2. `gazetteer-zipcode-resolver.ts:56`, `staff-signature.ts:12` → hapus lokal, impor.
3. `copilot.service.ts` / `pricelist.service.ts` (`escapeRegExp`) → impor `escapeRegex` dan ganti nama pemakaian.
4. Daftarkan `regex.escape` di registry.

**Justifikasi modul baru:** `escapeRegex` memang sudah ada di `gazetteer.ts`, tetapi mengimpor `gazetteer` dari `pricelist`/`copilot` akan menarik data gazetteer besar. Deletion test: jika modul kecil ini dihapus, kompleksitas escape muncul di 5 tempat. Jadi seam baru ini benar.

**Test:** `tests/unit/regex-escape.test.ts` (karakter `.*+?^${}()|[]\\`, string kosong, unicode).

---

### F4-7 — `parseArgs` scripts (prioritas rendah)

**File baru:** `src/scripts/lib/parse-args.ts` (atau `scripts/lib/cli-args.mjs` bila script tidak di-compile).

**Aksi:**

- Ekstrak pola `parseArgs` yang sama dari 10 script.
- Dukung `--key=value`, `--key value`, `--flag`.
- Migrasikan 10 script satu per satu; test unit untuk parser.

**Acceptance:** `rg "function parseArgs" src/scripts` → 1.

---

## 9. Fase 5 — UI/UX registry + galeri + gate

### Tujuan

Membuat komponen/halaman yang ada **terlihat**, lalu memaksa reuse.

### F5-1 — `ui-registry.json`

**File:** `packages/admin-dashboard/src/ui-registry.json`

```json
{
  "version": 1,
  "layers": {
    "primitive": "src/components/ui",
    "pattern": "src/components/common",
    "domain": "src/components",
    "page": "src/pages"
  },
  "components": [
    {
      "name": "Button",
      "layer": "primitive",
      "path": "src/components/ui/Button.tsx",
      "whenToUse": "Semua aksi klik. Varian lewat prop variant, bukan komponen baru.",
      "states": ["default", "hover", "disabled", "loading"],
      "reviewed": true
    }
  ],
  "pages": [
    {
      "path": "src/pages/tenant/Overview.tsx",
      "module": "overview",
      "parent": null,
      "adr": null,
      "reviewed": false
    }
  ],
  "allow": {
    "rawFetch": [
      { "file": "src/components/copilot/AdminCopilotPanel.tsx", "reason": "SSE stream" },
      { "file": "src/components/customer/CustomerMapTab.tsx", "reason": "GeoJSON statis" },
      { "file": "src/pages/tenant/TodayTreatments.tsx", "reason": "Nominatim eksternal" }
    ]
  }
}
```

**Catatan:** 60 page + 28 komponen `ui`/`common` di-generate awal dengan `reviewed: false`; peninjauan dilakukan bertahap. Gate hanya memblokir **entri baru** yang tidak terdaftar.

### F5-2 — `check-ui-reuse.mjs`

**File:** `packages/admin-dashboard/scripts/check-ui-reuse.mjs`

Pemeriksaan:

1. **Coverage page** — setiap `src/pages/**/*.tsx` punya entri. Page baru tanpa entri → fail.
2. **Coverage komponen** — setiap `src/components/ui/**` dan `common/**` punya entri.
3. **Nama komponen ganda** — dua file mengekspor nama komponen sama → fail.
4. **Util lokal menyalin util** — fungsi lokal di `pages`/`components` yang namanya sama dengan export `src/utils/**` → fail (baseline: `formatMinutesToTime`, `isValidLatLng`, `norm`).
5. **Raw fetch** — `fetch(` di luar `services/api.ts` dan `allow.rawFetch` → fail.
6. **Dialog terlarang** — `window.confirm` / `alert` → fail (target 0).
7. **Page baru tanpa ADR** — entri page dengan `adr: null` yang tidak ada di baseline → fail.

Tambahkan script:

```json
"check:ui-reuse": "node scripts/check-ui-reuse.mjs"
```

Dan langkah CI:

```yaml
      - name: UI Reuse Gate
        run: |
          cd packages/admin-dashboard
          npm run check:ui-reuse
```

### F5-3 — Galeri hidup (dev-only)

**Evaluasi yang sudah dilakukan:** `StitchShowcase.tsx` (795 baris) adalah mockup statis; **tidak** mengimpor `components/ui`/`common`. Jadi bukan katalog komponen.

**Keputusan:** buat satu dev-only page baru `src/pages/UiCatalog.tsx`, lazy-loaded dan di-guard `import.meta.env.DEV`, route `/ui-catalog`. Ini satu-satunya page baru yang diizinkan plan ini, dengan ADR.

**File:**

- `packages/admin-dashboard/src/pages/UiCatalog.tsx`
- `docs/adr/ADR-0001-ui-catalog-dev-only.md`
- Entri registry: `{ "path": "src/pages/UiCatalog.tsx", "module": "dev-tools", "parent": null, "adr": "ADR-0001" }`

**Isi katalog:**

- Render setiap primitif `components/ui` dalam state: default, disabled, loading, error.
- Render pattern `components/common` yang relevan (Pagination, UiFeedback, ToggleSwitch, StateViews).
- Tampilkan dark mode dan lebar 360px (mobile).
- Tautan ke file sumber.

**Justifikasi (deletion test):** tanpa katalog, developer/agent tidak tahu komponen ada → membuat duplikat. Biaya bundle produksi nol karena dev-only + lazy.

### F5-4 — Perbaiki duplikasi UI

| Temuan | Aksi |
|---|---|
| `formatMinutesToTime` 2x | Hapus lokal di `CreateReservationModal.tsx:81-85`; impor dari `utils/slotRecommendations.ts` |
| `isValidLatLng` 3x | Jadikan `utils/geoUtils.ts` kanonis; ekspor `isValidLatLng(lat,lng)` + `isValidLatLngPoint(p)`; `customerMapUtils`/`dispatchMap` impor |
| `norm` 3x | **Adjudikasi dulu**: bandingkan semantik `addressMatch`, `reservationChildPrefill`, `reservationFormGuards`. Jika beda tujuan, rename agar tidak tabrakan; jika sama, satukan di `utils/` |

**Test:** `tests/unit/geo-utils.test.ts`, `tests/unit/slot-recommendations.test.ts`, test util yang disatukan.

### Acceptance criteria Fase 5

- `npm run check:ui-reuse` hijau di baseline.
- Menambah page baru tanpa entri registry → gate gagal (self-test).
- Menambah `fetch` baru di komponen → gate gagal.
- `npm run build` dashboard hijau.
- `/ui-catalog` hanya muncul di dev; build produksi tidak memuat chunk-nya.

### Regression gate

```powershell
npm --prefix packages/admin-dashboard run build
npm --prefix packages/admin-dashboard run check:design
npm --prefix packages/admin-dashboard run check:ui-reuse
npm run build
npm test
```

---

## 10. Fase 6 — Amendemen `AGENTS.md` + pointer guard

**Dependency:** F1 (script ada), F2 (check:reuse ada), F5 (ui-registry ada).

### F6-1 — Empat edit minimum

**Edit 1 — `## Commands` baris 7:**

Ganti:

```md
- `npm run dev` — hot-reload dev server (`tsx watch src/app.ts`). No separate lint/typecheck script exists; `npm run build` (`tsc`) is the typecheck.
```

Menjadi:

```md
- `npm run dev` — hot-reload dev server (`tsx watch src/app.ts`). `npm run typecheck` (`tsc --noEmit`) untuk typecheck; `npm run build` untuk build penuh.
- `npm run find:module -- "<kebutuhan>"` — cari modul kanonis sebelum membuat baru; `npm run check:reuse` — gerbang anti-duplikasi/reuse.
```

**Edit 2 — Mandat Anti-Bloat baris 69 (tambahkan di akhir):**

```md
Sebelum membuat modul/komponen/halaman baru: cek `docs/MODULE_INDEX.md` dan jalankan `npm run find:module -- "<kebutuhan>"`. Plan wajib mencantumkan modul yang dipakai atau alasan belum ada. Komponen baru memakai primitif `components/ui`/`common` dan terdaftar di `ui-registry.json`; halaman baru butuh ADR.
```

**Edit 3 — Kontrak Kanonis Tunggal baris 74:**

Ganti kalimat pertama menjadi:

```md
4. **Kontrak Kanonis Tunggal**: Satu seam kebenaran per operasi **dan per pengetahuan** (contoh: `reservationCoreService.saveReservation`, `utils/pii-masker.ts`). Modul kanonis terdaftar di `docs/MODULE_INDEX.md`; alias DEPRECATED hanya boleh hidup selama masih ada pemanggil; pemanggil terakhir WAJIB dimigrasikan sebelum fungsi dihapus.
```

**Edit 4 — Gerbang Regresi Wajib baris 75:**

Ganti pembuka menjadi:

```md
5. **Gerbang Regresi Wajib**: Setiap fase eksekusi ditutup `npm run build` + `npm run check:reuse` + suite relevan hijau + full suite tanpa failure baru. Failure yang diklaim pre-existing WAJIB dibuktikan pre-existing (revert-and-rerun: kembalikan file ke HEAD, jalankan test yang sama, harus tetap gagal) sebelum dinyatakan bukan regresi.
```

### F6-2 — Pointer guard test

**File:** `tests/unit/agents-md-pointers.test.ts`

Aturan:

1. Baca `AGENTS.md`.
2. Ekstrak path di dalam backtick yang cocok `^(docs|src|tests|scripts|packages)/`.
3. Abaikan wildcard (`*`), placeholder (`<...>`), dan path generated.
4. Assert `fs.existsSync(path)`.
5. Ekstrak `npm run <script>` dari backtick; assert script ada di `package.json`.

**Acceptance:** test hijau; menghapus `docs/MODULE_INDEX.md` membuat test gagal (self-test).

### F6-3 — CI fail mode

Setelah 1–2 minggu warn-only dan false positive <5%:

```yaml
      - name: Reuse Gate
        run: npm run check:reuse -- --json

      - name: Architecture Gate
        run: npm run check:architecture -- --json

      - name: UI Reuse Gate
        run: |
          cd packages/admin-dashboard
          npm run check:ui-reuse
```

### Acceptance criteria Fase 6

- 4 edit diterapkan; `AGENTS.md` bertambah ≤10 baris.
- `npx vitest run tests/unit/agents-md-pointers.test.ts` hijau.
- Gate fail mode hijau di baseline.
- Tidak ada path/script yang disebut tetapi tidak ada.

---

## 11. Fase 7 — Burn-down & operasional

### F7-1 — Laporan mingguan

**File:** `scripts/reuse/report-reuse.mjs`

Output:

```
Kategori                 Baseline   Sekarang   Delta
Duplikasi (grup)         27         27         0
File >1500 baris fisik   9          9          0
Prisma di route          285        285        0
Dead export (runtime)    170        170        0
Raw fetch dashboard      9          9          0
Page tanpa ADR           0          0          0
```

### F7-2 — Target per sprint

| Sprint | Duplikasi | File >1500 | Prisma route | Raw fetch | Page baru |
|---|---|---|---|---|---|
| 1 | 27 → 22 | 9 → 8 | 285 → 270 | 9 → 8 | 0 |
| 2 | 22 → 16 | 8 → 6 | 270 → 250 | 8 → 6 | 0 |
| 3 | 16 → 10 | 6 → 3 | 250 → 230 | 6 → 4 | 0 |
| 4 | 10 → ≤5 | 3 → 0 | 230 → 210 | 4 → allowlist | 0 |

Angka final dapat disesuaikan setelah baseline gate nyata; yang penting arahnya turun.

### F7-3 — PR template

**File:** `.github/pull_request_template.md`

```md
## Reuse checklist
- [ ] Sudah cek `docs/MODULE_INDEX.md` dan `npm run find:module`
- [ ] Tidak menambah deklarasi simbol terlarang
- [ ] Tidak menambah Prisma langsung di route
- [ ] Tidak menambah `fetch` di komponen (kecuali allowlist)
- [ ] File baru <1.500 baris
- [ ] Komponen/halaman baru terdaftar di `ui-registry.json`
- [ ] `npm run check:reuse` hijau
```

### F7-4 — Exception registry

**File:** `scripts/reuse/exceptions.json`

```json
{
  "exceptions": [
    {
      "rule": "DUPLICATE_FUNCTION",
      "fingerprint": "sha256:...",
      "reason": "Adapter WAHA vs WABA sengaja paralel",
      "owner": "backend",
      "expiresAt": "2027-01-31"
    }
  ]
}
```

Gate gagal bila exception kedaluwarsa. Ini mencegah "pengecualian abadi".

---

## 12. Pengujian adversarial gerbang

Wajib ada sebelum gate di-flip ke fail:

| Kasus | Harapan |
|---|---|
| Dua fungsi identik di dua file | fail (`DUPLICATE_FUNCTION`) |
| Salinan dengan variabel diganti nama | warn (`structuralWarn`), tidak fail |
| Re-export dari canonical | pass |
| Duplikasi hanya di file test | pass (test dikecualikan) |
| Fungsi <40 token | pass (ambang) |
| File tepat 1.500 baris | pass |
| File 1.501 baris | fail |
| Export dipakai lewat dynamic import string | dihitung dipakai (tidak fail) |
| Simbol terlarang di nested scope | tidak dipindai (hanya top-level) |
| Registry menunjuk file hilang | fail validasi registry |
| Baseline dihapus | fail (bukan otomatis pass) |
| `--update-baseline` tanpa `--allow-update` | fail |
| Page baru tanpa entri registry | fail |
| `fetch` di file allowlist | pass |
| `window.confirm` | fail |

---

## 13. Risiko & mitigasi (FMEA ringkas)

| Risiko | S | O | D | RPN | Mitigasi |
|---|---:|---:|---:|---:|---|
| False positive gate memblokir PR sah | 5 | 7 | 4 | 140 | Warn 1–2 minggu; exception registry; ambang token |
| Regresi runtime saat deduplikasi | 8 | 4 | 5 | 160 | Test karakterisasi dulu; satu PR satu temuan |
| Baseline di-update sembarangan | 6 | 5 | 6 | 180 | `--allow-update` eksplisit; CI tidak pernah update; review PR |
| Gate lambat → di-bypass | 4 | 4 | 3 | 48 | Budget <30 detik; cache AST in-memory |
| Registry basi | 5 | 6 | 5 | 150 | Generate docs + test validasi path |
| `AGENTS.md` pointer basi | 4 | 5 | 6 | 120 | `agents-md-pointers.test.ts` |
| UI registry 88 entri melelahkan | 3 | 6 | 3 | 54 | `reviewed:false` + burn-down; gate hanya entri baru |
| Gate memblokir hotfix produksi | 7 | 3 | 3 | 63 | Label `hotfix` + exception berbatas waktu, tetap dicatat |

---

## 14. Definition of Done keseluruhan

1. `npm run check:reuse` dan `npm run check:architecture` berjalan di CI mode fail.
2. `npm run check:ui-reuse` berjalan di CI dashboard.
3. `npm run find:module` mengembalikan modul kanonis untuk 11 kapabilitas.
4. Empat duplikasi berisiko tinggi (F4-1..F4-4) hilang, dibuktikan `rg` + test parity.
5. `docs/MODULE_INDEX.md` 100% di-generate dari registry; tidak ada drift.
6. `ui-registry.json` mencakup 100% page + komponen `ui`/`common`.
7. `AGENTS.md` hanya bertambah ≤10 baris dan lolos pointer test.
8. Metrik baseline turun sesuai target sprint 1 (minimal tidak ada kenaikan).
9. Tidak ada dependency runtime baru.
10. Semua fase ditutup dengan `npm run build` + full suite tanpa failure baru.

---

## 15. Yang harus disetujui sebelum eksekusi

Plan ini belum mengubah kode apa pun. Untuk mulai, dibutuhkan persetujuan eksplisit dengan salah satu opsi:

- **"Setuju, lanjut Fase 0"** — hanya baseline read-only.
- **"Setuju, lanjut Fase 0–1"** — baseline + registry + `find:module` (tanpa enforcement).
- **"Setuju, lanjut Fase 0–2"** — sampai gate warn-only + self-test.

Fase 4 (perubahan runtime) akan meminta persetujuan terpisah setelah Fase 0–3 selesai dan baseline gate terbukti stabil.
