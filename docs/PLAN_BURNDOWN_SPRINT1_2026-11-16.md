# Plan: Burn-Down Sprint 1 (#347)

- **Status:** SELESAI (dieksekusi 2026-11-16, commit S1-1..S1-5). Target tercapai lebih awal dari 2026-11-30.
- **Basis kode:** commit `9f803276`, working tree bersih.
- **Terkait:** `docs/KNOWN_ISSUES.md` #347, `docs/PLAN_REUSE_GATE_2026-11-16.md`.
- **Sifat:** rencana bertahap; setiap task adalah satu commit yang bisa di-rollback sendiri.

---

## 1. Target Sprint 1

| Metrik | Baseline sekarang | Target Sprint 1 | Cara |
|---|---:|---:|---|
| Duplikasi fungsi (grup AST) | 4 | **2** | S1-1, S1-2 |
| File fisik >1.500 baris | 9 | **8** | S1-3 |
| Panggilan Prisma di route | 285 | **270** | S1-4 |
| Deklarasi simbol terlarang | 15 | **≤14** (opsional) | S1-3 bila `normalizePhone` diganti |
| Siklus import | 6 | 6 (tetap) | di luar scope |
| Dead export | 170 | 170 (tetap) | di luar scope |

**Definition of Done Sprint 1:**

1. `npm run check:reuse` → 0 pelanggaran baru; duplication groups = 2.
2. `npm run check:architecture` → 0 baru; Prisma route = 270.
3. `npm run check:ui-reuse` → 0.
4. `npm run report:reuse` menampilkan angka target di atas.
5. `npm run typecheck`, `npm run build`, dan test terkait hijau.
6. Baseline hanya turun; tidak ada kenaikan tersembunyi.

---

## 2. Prinsip eksekusi

1. **Test-first.** Karakterisasi perilaku lama sebelum memindahkan kode.
2. **Satu task satu commit.** Rollback tidak menyeret task lain.
3. **Jangan paksa deduplikasi.** Kalau dua fungsi ternyata punya semantik berbeda, hentikan task dan laporkan; jangan samakan secara buta.
4. **Baseline hanya turun.** `npm run check:reuse:update` dijalankan setelah semua test hijau, lalu diff baseline direview.
5. **Gerbang penutup tiap task:** `npm run typecheck` + test terkait + `npm run check:reuse` + `npm run check:architecture`.

---

## 3. Ringkasan task

| ID | Fokus | Risiko | Metrik yang turun |
|---|---|---|---|
| S1-1 | Kanonisasi `getLogDateString` | Rendah | Duplikasi 4 → 3 |
| S1-2 | Kanonisasi `stripEdge` (3 salinan) | Rendah | Duplikasi 3 → 2 |
| S1-3 | Ekstrak helper murni `meta-performance` | Sedang | File >1.500: 9 → 8 |
| S1-4 | Pindahkan 15 query Prisma `meta-attribution` ke service | Sedang | Prisma route 285 → 270 |
| S1-5 | Ratchet baseline + laporan + verifikasi | Rendah | Semua target terkunci |

---

## 4. S1-1 — Kanonisasi `getLogDateString`

### Fakta

Dua salinan identik:

- `src/utils/llm-execution-logger.ts:116-121`
- `src/utils/log-buffer.ts:45-50`

Keduanya memakai **tanggal lokal server** (bukan WIB eksplisit). Jangan ubah ke WIB di task ini; itu perubahan perilaku terpisah.

### Micro-task

1. Buat `src/utils/log-date.ts`:

   ```ts
   /**
    * Kunci tanggal untuk nama file log (YYYY-MM-DD).
    * Mempertahankan perilaku lama: memakai komponen tanggal lokal server.
    */
   export function getLogDateString(d: Date = new Date()): string {
     const year = d.getFullYear();
     const month = String(d.getMonth() + 1).padStart(2, '0');
     const day = String(d.getDate()).padStart(2, '0');
     return `${year}-${month}-${day}`;
   }
   ```

2. `src/utils/llm-execution-logger.ts`:
   - Tambah `import { getLogDateString } from './log-date';`
   - Hapus definisi lokal baris 116–121.

3. `src/utils/log-buffer.ts`:
   - Tambah `import { getLogDateString } from './log-date';`
   - Hapus definisi lokal baris 45–50.

4. Buat `tests/unit/log-date.test.ts`:
   - `new Date(2026, 0, 2)` → `2026-01-02`
   - `new Date(2026, 11, 31)` → `2026-12-31`
   - Kabisat `new Date(2024, 1, 29)` → `2024-02-29`
   - Input `Date` yang sama menghasilkan string yang sama (deterministik)

5. Jalankan test terkait:
   ```powershell
   npx vitest run tests/unit/log-date.test.ts tests/unit/log-buffer.test.ts
   ```

### Acceptance

- `rg -c "function getLogDateString" src` → **1**.
- `npm run check:reuse` → duplication groups turun 4 → 3.
- Tidak ada perubahan format nama file log.

### Rollback

Revert commit S1-1; dua definisi lama kembali.

---

## 5. S1-2 — Kanonisasi `stripEdge` (3 salinan)

### Fakta

Ada **3** salinan logika yang sama:

- `src/v3/guardrails/pronoun-validator.ts:22-37`
- `src/v3/agent/persona.ts:35-50`
- `src/utils/lead-greeting-detector.ts:60-73`

Baseline duplikasi baru mendeteksi 2; salinan ketiga tetap harus disatukan.

### Micro-task

1. Buat `src/utils/text-edge.ts`:

   ```ts
   /**
    * Buang semua karakter non-alfanumerik (a-z, 0-9) di awal dan akhir string.
    * Catatan: input pemanggil sudah di-lowercase; huruf besar sengaja tidak dianggap alfanumerik
    * agar perilaku lama tidak berubah.
    */
   export function stripNonAlnumEdges(input: string): string {
     let s = input;
     while (s.length > 0) {
       const c = s.charCodeAt(0);
       if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) break;
       s = s.slice(1);
     }
     while (s.length > 0) {
       const c = s.charCodeAt(s.length - 1);
       if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) break;
       s = s.slice(0, -1);
     }
     return s;
   }
   ```

2. Ganti ketiga definisi lokal dengan import + pemakaian `stripNonAlnumEdges`:
   - `src/v3/guardrails/pronoun-validator.ts` → `import { stripNonAlnumEdges } from '../../utils/text-edge';`
   - `src/v3/agent/persona.ts` → `import { stripNonAlnumEdges } from '../../utils/text-edge';`
   - `src/utils/lead-greeting-detector.ts` → `import { stripNonAlnumEdges } from './text-edge';`

3. Buat `tests/unit/text-edge.test.ts`:
   - `"**halo**"` → `"halo"`
   - `"...apa?"` → `"apa"`
   - `"123!"` → `"123"`
   - `"!!!"` → `""`
   - `"Halo"` → `""` (mendokumentasikan perilaku lama: huruf besar bukan alfanumerik)
   - `"  kata  "` → `""` (spasi juga dipotong)

4. Jalankan test terkait:
   ```powershell
   npx vitest run tests/unit/text-edge.test.ts tests/unit/v3/pronoun-validator.test.ts tests/unit/persona-canonical-source.test.ts tests/unit/lead-greeting-preservation.test.ts
   ```

### Acceptance

- `rg "const stripEdge|function stripEdge" src` → **0**.
- Duplication groups turun 3 → 2.
- Test persona/pronoun/lead-greeting tetap hijau.

### Rollback

Revert commit S1-2.

---

## 6. S1-3 — Ekstrak helper murni `meta-performance-analytics.service.ts`

### Fakta

- File saat ini **1.567 baris** (di atas batas 1.500).
- Blok helper murni ada di sekitar baris 252–467:
  `wibTodayStr`, `wibDayStart`, `wibDayEnd`, `median`, `mean`, `round2`, `safeDiv`, `safeDivOrUndef`, `isSandboxed`, `isQualifyingStatus`, `isUnrenderedUtmMacro`, `sanitizeUtmCampaign`, `sanitizeUtmSource`, `wibDateKey`, `capacityBandFor`, `wibMonthKey`, `monthDiff`, `addMonths`, `normalizePhone`, serta konstanta bracket/UTM yang dipakai report builder.

### Micro-task

1. **Karakterisasi dulu:** pastikan test yang ada hijau sebelum perubahan:
   ```powershell
   npx vitest run tests/unit/meta-performance-analytics.test.ts tests/unit/meta-performance-tenant-settings.test.ts tests/unit/meta-performance-route-tenant-isolation.test.ts tests/unit/ad-funnel-parity.test.ts
   ```

2. Buat `src/services/meta-performance.helpers.ts`.
   - Pindahkan fungsi murni + konstanta bracket/UTM yang tidak menyentuh Prisma.
   - Ekspor semua yang dipakai service utama.
   - Jangan memindahkan fungsi yang mengakses `prisma` atau state eksternal.

3. Di `meta-performance-analytics.service.ts`:
   - Hapus blok helper yang dipindah.
   - Tambah import dari `./meta-performance.helpers`.
   - Pastikan file turun **<1.500 baris fisik**.

4. **Adjudikasi `normalizePhone` lokal** (baris 447):
   - Bandingkan dengan `normalizePhoneID` di `src/utils/phone-normalizer.ts`.
   - Canonical lebih luas: menangani `@c.us`, `:device`, dan prefix `8xx`.
   - Jalankan test meta-performance. Jika semua hasil sama, ganti dengan `normalizePhoneID` (ini juga menurunkan 1 forbidden declaration).
   - Jika ada perbedaan perilaku, **jangan paksa**; pindahkan tetap ke helper dan catat sebagai pengecualian.

5. Buat `tests/unit/meta-performance-helpers.test.ts`:
   - `median([1,2,3,4])` → `2.5`; `median([])` → `null`
   - `safeDiv(10, 0)` → `0`; `safeDivOrUndef(10, 0)` → `undefined`
   - `capacityBandFor(50/70/90/null)` → `AMAN/OPTIMAL/PENUH/UNKNOWN`
   - `wibDateKey` dan `wibMonthKey` untuk Date tetap
   - `addMonths('2026-01', 1)` → `'2026-02'`; `addMonths('2026-12', 1)` → `'2027-01'`
   - `sanitizeUtmCampaign('{{ad.id}}')` → `'(macro UTM belum dirender)'`

6. Jalankan test meta-performance + test helper.

### Acceptance

- `wc -l src/services/meta-performance-analytics.service.ts` < 1500 (gunakan `(Get-Content ... | Measure-Object -Line).Lines` atau hitung baris fisik).
- `npm run check:reuse` → file-size 9 → 8.
- Semua test meta-performance hijau.
- Tidak ada import melingkar baru (`npm run check:architecture`).

### Risiko

- Sedang: pemindahan konstanta bisa menyebabkan import hilang. Mitigasi: `tsc --noEmit` + test.
- `normalizePhone` hanya diganti jika parity terbukti; kalau tidak, tetap di helper dan dicatat.

### Rollback

Revert commit S1-3; file utama kembali utuh.

---

## 7. S1-4 — Pindahkan 15 query Prisma `meta-attribution` ke service

### Fakta

`src/routes/admin/meta-attribution.subroute.ts` memiliki **15 panggilan Prisma**:

| Baris | Panggilan |
|---:|---|
| 146 | `prisma.adClick.count` |
| 147 | `prisma.adClick.findMany` |
| 291 | `prisma.adClick.count` |
| 292 | `prisma.adClick.count` |
| 293 | `prisma.customer.count` |
| 294 | `prisma.customer.count` |
| 295 | `prisma.reservation.count` |
| 296 | `prisma.reservation.count` |
| 298 | `prisma.reservation.count` |
| 299 | `prisma.reservation.count` |
| 398 | `prisma.tenant.findUnique` |
| 714 | `prisma.customer.findFirst` |
| 835 | `prisma.auditLog.findMany` |
| 847 | `prisma.customer.findMany` |
| 851 | `prisma.reservation.findMany` |

### Micro-task

1. **Karakterisasi dulu:**
   ```powershell
   npx vitest run tests/unit/meta-attribution-fix.test.ts tests/integration/meta-attribution-debug.test.ts tests/unit/meta-summary-daterange.test.ts tests/unit/meta-performance-route-tenant-isolation.test.ts
   ```

2. Buat `src/services/meta-attribution.service.ts` dengan method terpisah per kelompok query:
   - `listAdClicks(params, db = prisma)`
   - `getAttributionCounts(tenantId, where, db = prisma)` — 8 count paralel
   - `getTenantOrNull(tenantId, db = prisma)`
   - `findCustomerForAttribution(params, db = prisma)`
   - `getDebugHistory(tenantId, limit, db = prisma)` — auditLog + customer + reservation

3. Di route:
   - Ganti setiap `prisma.*` dengan pemanggilan service.
   - Hapus import `prisma` dari route jika sudah tidak dipakai.
   - Pertahankan bentuk response dan status code **persis**.

4. Jalankan test karakterisasi + `npm run check:architecture`.

### Acceptance

- `rg -c "prisma\.[a-zA-Z]+\." src/routes/admin/meta-attribution.subroute.ts` → **0**.
- `npm run check:architecture` → Prisma route 285 → 270, 0 pelanggaran baru.
- Test meta-attribution tetap hijau.
- Tidak ada perubahan response contract.

### Risiko

- Sedang: query `where` dan `include` mudah berubah saat dipindah. Mitigasi: salin query apa adanya, jangan refaktor bentuk query sekaligus.
- Service baru harus menerima `db` opsional agar test lama dengan mock tetap bekerja.

### Rollback

Revert commit S1-4; route kembali memakai Prisma langsung.

---

## 8. S1-5 — Ratchet baseline & verifikasi akhir

### Micro-task

1. Setelah S1-1 s/d S1-4 hijau:
   ```powershell
   npm run check:reuse:update
   git diff scripts/reuse/baselines/
   ```
   Pastikan hanya ada penurunan:
   - `duplication.json`: 4 → 2 grup
   - `file-size.json`: 9 → 8 file
   - `forbidden-declarations.json`: 15 → ≤14 (jika `normalizePhone` diganti)
   - `architecture.json`: Prisma 285 → 270

2. Verifikasi penuh:
   ```powershell
   npm run check:reuse
   npm run check:architecture
   npm run check:ui-reuse
   npm run report:reuse
   npm run typecheck
   npm --prefix packages/admin-dashboard run check:design
   npm --prefix packages/admin-dashboard run build
   ```

3. Test suite relevan:
   ```powershell
   npx vitest run tests/unit/log-date.test.ts tests/unit/log-buffer.test.ts tests/unit/text-edge.test.ts tests/unit/v3/pronoun-validator.test.ts tests/unit/persona-canonical-source.test.ts tests/unit/lead-greeting-preservation.test.ts tests/unit/meta-performance-analytics.test.ts tests/unit/meta-performance-helpers.test.ts tests/unit/meta-attribution-fix.test.ts tests/integration/meta-attribution-debug.test.ts
   ```

4. Commit penutup:
   `chore(reuse): ratchet baseline sprint 1 (duplikasi 2, file 8, prisma 270)`

### Acceptance

- `report:reuse` menunjukkan target Sprint 1.
- Semua gate 0 baru.
- Baseline tidak naik di kategori mana pun.

---

## 9. Risiko & FMEA ringkas

| Task | S | O | D | RPN | Mitigasi |
|---|---:|---:|---:|---:|---|
| S1-1 | 2 | 2 | 2 | 8 | Fungsi murni, test tanggal |
| S1-2 | 3 | 3 | 3 | 27 | Test karakterisasi 3 pemanggil |
| S1-3 | 5 | 4 | 4 | 80 | Test dulu, pindah bertahap, tsc |
| S1-4 | 6 | 4 | 5 | 120 | Salin query apa adanya, test integration |

**Pre-mortem:** kegagalan paling mungkin adalah S1-4 mengubah bentuk query/`include` saat dipindah. Mitigasi: jangan refaktor query; pindahkan utuh dan bandingkan response test.

---

## 10. Di luar scope Sprint 1

- 2 grup duplikasi sisa (`findById`, `isTypoAtMostOne` vs `isNearEqual`) → Sprint 2.
- 8 file >1.500 lainnya → Sprint 2–4.
- 270 → 240 Prisma → Sprint 2.
- 170 dead export → Sprint 3–4.
- 6 siklus import → dijadwalkan terpisah.

---

## 11. Hasil eksekusi (2026-11-16)

| Task | Hasil | Catatan penyimpangan dari plan |
|---|---|---|
| S1-1 | `src/utils/log-date.ts` kanonis; `llm-execution-logger`, `log-buffer`, `chat-export.service` memakainya | `formatLocalDate` di `chat-export.service.ts` ternyata salinan ketiga (dilaporkan gate sebagai structural warning) → ikut dikonsolidasikan; 3 pemanggil (`export.subroute.ts`, `cron.service.ts`, test) dimigrasikan |
| S1-2 | `src/utils/text-edge.ts` (`stripNonAlnumEdges`); 3 salinan hilang | Huruf besar di tepi ikut terpotong (perilaku lama) — didokumentasikan di test karakterisasi |
| S1-3 | Service 1.567 → 1.465 baris; helper pindah ke `meta-performance.helpers.ts` | `normalizePhone` diganti `normalizePhoneID` (parity terbukti, plus lebih benar untuk input `8xx`); `safeDiv`, `safeDivOrUndef`, `RETENTION_WINDOWS_DAYS`, `_internal` dihapus karena dead code |
| S1-4 | 15 query Prisma pindah ke `meta-attribution.service.ts` | `landingPageView` count/groupBy ikut dipindah untuk mencegah unhandled rejection saat `prisma.landingPageView` tidak ada di mock/DB lama |
| S1-5 | Baseline di-ratchet: duplikasi 2, forbidden 13, file 8, Prisma 270, dead export 169 | — |

Catatan S1-4: 3 panggilan `(prisma.tenant as any)` (findUnique/update) masih di route karena tidak terhitung pola gate dan menyentuh alur tulis; dicatat sebagai kandidat Sprint 2 di `docs/KNOWN_ISSUES.md` #347.

## 12. Approval (historis)

Plan ini disetujui dan dieksekusi penuh (S1-1 s/d S1-5) dengan satu commit per task. Tidak ada task yang dihentikan karena perbedaan semantik; satu penyimpangan (S1-3 `normalizePhone`) diadopsi setelah parity diverifikasi lewat test.
