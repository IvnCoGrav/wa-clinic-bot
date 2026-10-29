# Queue: Optimasi Tampilan Kalender ala Google Calendar (Mobile-First)

> **Status: ANTREAN (QUEUE). Bukan eksekusi.**
> Dilarang mengeksekusi fase mana pun tanpa konfirmasi eksplisit pengguna per fase
> (Strict Human-in-the-Loop Confirmation Gate, `AGENTS.md`).
> Setiap fase wajib: TDD dulu (test merah) → `npm --prefix packages/admin-dashboard run build` → gate regresi → baru boleh lanjut.

- **Sumber rencana:** rencana user "Optimasi Tampilan Kalender ala Google Calendar" (2026-10-29).
- **Status audit:** SELESAI, read-only, semua klaim diverifikasi ke `file:line` + data produksi.
- **Konteks:** menggantikan/melanjutkan Fase 1–4 kalender (entri `docs/KNOWN_ISSUES.md` #286) yang sudah live.
- **Tambahan permintaan user:** label jam **jangan** `12:00` — cukup **dua angka** (`08`, `13`, `21`) karena hemat ruang.

---

## §0. Hasil Audit Rencana (klaim vs kode nyata)

| # | Klaim rencana | Verifikasi | Verdict |
|---|---|---|---|
| A1 | Nama di view Bulanan tampil seragam `Bu...` | `MonthScheduleGrid.tsx:163` memakai `res.customer?.name` mentah + fallback `'Bunda'`. Di DB produksi: **276 dari 1001 customer (27,6%)** memakai gelar (`Bunda/Ibu/Ny./Nn./Sdri./Mama/Mom/Moms`) | ✅ **BENAR, tapi tidak "semua"** — hanya ~28% + nama kosong. Perbaikan tetap layak |
| A2 | Regex pembersih gelar "sudah terbukti stabil di DayScheduleGrid" | Ada di `DayScheduleGrid.tsx:322` dan `WeekScheduleGrid.tsx:620` — **duplikat persis** | ⚠️ Benar stabil, **tapi menambah salinan ke-3 melanggar mandat anti-duplikasi** |
| A3 | Padding sel `p-1.5` → `p-0.5` menambah ruang "~20px → ~35px" | Hitung nyata @360px: `360 − 2×16 (Layout p-4) − 2 (border) − 6 (divide-x)` = 320/7 ≈ **45,7px/sel**. `p-1.5` (6px×2) → **≈34px**; `p-0.5` (2px×2) → **≈42px** | ❌ **Angka salah.** Keuntungan nyata **+8px (≈+24%)**, bukan +15px. Angka awal ~34px, bukan ~20px |
| A4 | Tanggal jadi `w-4.5 h-4.5 sm:w-5 sm:h-5` | `tailwind.config.js` **tidak** meng-extend `spacing`; Tailwind 3.4 default tidak punya skala `4.5` | ❌ **Kelas tidak valid** → tidak menghasilkan CSS apa pun. Ukuran tanggal tidak akan berubah |
| A5 | Kapsul `text-[8px]` | `text-[8px]` valid secara Tailwind, tetapi di bawah ambang terbaca di HP 360px | ⚠️ Valid tapi **terlalu kecil**; 9px adalah batas bawah praktis |
| A6 | `events.slice(0, 4)` | `MonthScheduleGrid.tsx:149` (`slice(0,3)`) **dan** `:178-180` (`length > 3`, `length - 3`) | ⚠️ Rencana hanya menyebut `slice`; **dua tempat lain wajib ikut** atau label "+X lainnya" jadi salah hitung |
| A7 | Format jam 24 jam via `formatHourLabel` | Ada di `DayScheduleGrid.tsx:86-90` dan `WeekScheduleGrid.tsx:330-334` | ✅ Ada di kedua file |
| A8 | Gutter 70px → 40px | `TIME_GUTTER = 70` (`WeekScheduleGrid.tsx:24`); dipakai juga di `revealDayColumn()` (`:322`, `:325`) | ⚠️ Konstanta aman (dibaca, bukan di-hardcode ulang), **tetapi** lihat A9 |
| A9 | (tidak disebut rencana) | Total lebar grid di-hardcode **dua kali**: `width: '1050px'` (`WeekScheduleGrid.tsx:482`) dan `min-w-[1050px]` (`:501`). `1050 = 70 + 7×140` | ❌ **GAP KRITIS.** Tanpa diubah, penggaris atas jadi 1050px sementara grid 950px → **ruang geser hantu** (bisa digeser melewati kolom terakhir) |
| A10 | `minmax(140px,1fr)` → `minmax(130px,1fr)` | Header `:503`, body `:549` | ⚠️ Mengurangi lebar kartu **−10px** justru saat tujuannya menambah ruang baca. **Tidak direkomendasikan** |
| A11 | `GMT+7` di header mingguan | `WeekScheduleGrid.tsx:505-507` | ✅ Ada |
| A12 | Now-indicator: `nowMinutes = (currentHour-6)*60 + currentMinutes` → `top` | Kartu event memakai `topPx = (startMinutes/60) * hourHeight` (`DayScheduleGrid.tsx:180`), dan `hourHeight` **berubah** sesuai zoom | ❌ **Rumus rencana salah** — mengabaikan `hourHeight`; garis merah akan meleset saat zoom ≠ default |
| A13 | `isToday(selectedDate)` | `DayScheduleGrid.tsx` **tidak punya** helper `isToday`; hanya mengimpor `getWibDateKey` + `getWibHoursAndMinutes` | ⚠️ Perlu impor `getTodayWibDateKey` |
| A14 | Garis merah `absolute left-0 right-0` | Kolom hari ada di `DayScheduleGrid.tsx:275` (`relative`). Kalau dipasang di container grid `:255`, garis akan menimpa kolom jam | ⚠️ Harus dipasang di dalam kolom hari (`:275`) |
| A15 | "Teks terpotong di bawah karena padding" | Kartu `:361` memakai `p-2 sm:p-3` + `justify-between` + `overflow-hidden`, sedangkan `minCardHeight = 36/52` (`:126`) bisa **lebih kecil** dari tinggi konten alami | ❌ **Akar masalah bukan padding.** Padding hanya menutupi gejala; akar sebenarnya = tinggi minimum kartu < tinggi konten, tanpa LOD berbasis tinggi |
| A16 | Gate regresi `npm test` "100% hijau" | Repo punya **22 test gagal pre-existing** di 10 file (`docs/KNOWN_ISSUES.md` #287). `packages/admin-dashboard` juga **tidak punya** script `test` | ❌ **Klaim salah.** Gate harus "tanpa kegagalan baru" |

### Temuan tambahan (di luar rencana, tapi wajib dicatat)

| # | Temuan | Bukti |
|---|---|---|
| B1 | `cleanBundaName()` **duplikat di 2 file** dengan perilaku **berbeda**: versi `chatScheduleExtractor.ts:389` memakai loop + `escapeRegexLiteral` + peleburan token kembar; versi `paymentInvoiceFormatter.ts:52` tidak | `chatScheduleExtractor.ts:389-411`, `paymentInvoiceFormatter.ts:52-70` |
| B2 | Versi `paymentInvoiceFormatter.ts:52` menyusun `new RegExp` **tanpa escape** dari `kecamatan`/`kota` → karakter regex (mis. `(`) di nama wilayah bisa melempar error | `paymentInvoiceFormatter.ts:58,65` |
| B3 | Regex gelar ditulis ulang **inline** di 2 grid (menjadi salinan ke-3 dan ke-4 bila rencana dieksekusi apa adanya) | `DayScheduleGrid.tsx:322`, `WeekScheduleGrid.tsx:620` |
| B4 | `DayScheduleGrid` masih memakai `WebkitOverflowScrolling: 'touch'` + `overscroll-contain` (F-27, belum ditutup) | `DayScheduleGrid.tsx:251-252` |
| B5 | `isOp` menganggap jam 12:00 **non-operasional** (`hour !== 12`), sehingga slot 12:00 bergaris diagonal. Perlu dikonfirmasi apakah ini memang kebijakan klinik atau bug | `DayScheduleGrid.tsx:261,278` |

---

## §1. Fase & Micro-Task (REVISI)

### FASE 1 — View Bulanan (nama bersih, padding efisien, kapsul ramping)

**Prasyarat:** Fase 4 (warna per bidan) sudah live — jangan menimpa `staffPillColor`.

#### 1.0 (BARU) Seam nama kanonis — wajib sebelum 1.1
- **File:** `packages/admin-dashboard/src/utils/patientName.ts` (baru)
- **Isi:**
  ```ts
  const HONORIFIC_PREFIX = /^(?:bunda|ibu|ny\.?|nn\.?|sdri\.?|mama|moms?|mom|kak|kakak|mrs\.?)\s+/i;
  const HONORIFIC_ONLY = /^(?:bunda|ibu|ny\.?|nn\.?|sdri\.?|mama|moms?|mom|kak|kakak|mrs\.?)$/i;

  /** Buang gelar sapaan di depan nama untuk tampilan kalender. */
  export function stripHonorific(name?: string | null): string {
    const raw = (name || '').trim();
    if (!raw) return '';
    const stripped = raw.replace(HONORIFIC_PREFIX, '').trim();
    if (!stripped) return '';
    // Nama yang HANYA berisi gelar ("Bunda") tidak informatif → kosongkan.
    return HONORIFIC_ONLY.test(stripped) ? '' : stripped;
  }
  ```
- **Kenapa bukan `cleanBundaName`:** fungsi itu juga memotong nama wilayah di ekor nama. Di kalender, wilayah sudah punya baris sendiri — memotongnya berisiko memutilasi nama asli (lihat B1/B2).
- **Refactor wajib dalam fase yang sama:** ganti regex inline di `DayScheduleGrid.tsx:322` dan `WeekScheduleGrid.tsx:620` dengan `stripHonorific()`.
- **Acceptance:** `stripHonorific('Bunda Retno') === 'Retno'`; `stripHonorific('Bunda') === ''`; `stripHonorific('Retno') === 'Retno'`; `stripHonorific('Ny. Ayu') === 'Ayu'`; `stripHonorific(null) === ''`.

#### 1.1 Nama bersih di pill Bulanan
- **File:** `MonthScheduleGrid.tsx:163`
- **Ganti:**
  ```tsx
  const cleanName = stripHonorific(res.customer?.name) || 'Pasien';
  const nameDisplay = isHold ? `[HOLD] ${cleanName}` : cleanName;
  ```
- **Acceptance:** "Bunda Annisa Radearilla" → "Annisa Radearilla"; nama kosong → "Pasien".

#### 1.2 Padding sel
- **File:** `MonthScheduleGrid.tsx:115`
- **Ganti:** `min-h-[105px] sm:min-h-[125px] p-1.5 sm:p-2` → `min-h-[96px] sm:min-h-[120px] p-0.5 sm:p-1.5`, `gap-1` → `gap-0.5 sm:gap-1`.
- **Acceptance (terukur, bukan perkiraan):** lebar konten sel @360px naik dari **≈34px → ≈42px**; tidak ada pill yang menempel ke border sel.

#### 1.3 Header tanggal di dalam sel
- **File:** `MonthScheduleGrid.tsx:126,139`
- **Ganti ukuran tanggal:** `w-6 h-6 text-xs` → `w-4 h-4 sm:w-5 sm:h-5 text-[10px] sm:text-xs`.
  **JANGAN `w-4.5`** — kelas itu tidak ada di Tailwind 3.4 (A4).
- **Counter event:** `text-[10px]` → `text-[9px] sm:text-[10px]`.
- **Acceptance:** tinggi header sel ≤ 20px; angka tanggal tidak terpotong.

#### 1.4 Kapsul agenda
- **File:** `MonthScheduleGrid.tsx:167-170, 178-181`
- **Ganti kelas pill:** `px-1.5 py-0.5 rounded text-[9px] sm:text-[10px]` → `px-1 py-0.5 rounded-[2px] sm:rounded text-[9px] sm:text-[10px] leading-tight`.
  **Jangan `text-[8px]`** (A5).
- **Kapasitas:** `slice(0, 3)` → `slice(0, 4)` **dan** `events.length > 3` → `> 4` **dan** `events.length - 3` → `- 4` (A6).
- **Acceptance:** hari dengan 5 event menampilkan 4 pill + "+1 lainnya"; hari dengan 4 event **tidak** menampilkan "+0 lainnya".

**Gerbang Fase 1:** `npm --prefix packages/admin-dashboard run build` hijau + `npx vitest run tests/unit/patient-name.test.ts` hijau + gate regresi tanpa kegagalan baru.

---

### FASE 2 — Jam 24 jam dua digit, gutter ramping, buang GMT+7

#### 2.1 Label jam (dua angka)
- **File:** `DayScheduleGrid.tsx:86-90`, `WeekScheduleGrid.tsx:330-334`
- **Ganti:**
  ```ts
  /** Label gutter: dua angka saja (08, 13, 21) — hemat ruang. */
  const formatHourLabel = (hour: number) => String(hour).padStart(2, '0');
  /** Label panjang untuk tooltip/judul — jangan "jam 13". */
  const formatHourLabelLong = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
  ```
- **Wajib:** pemakaian di `title` (`DayScheduleGrid.tsx:296`, `WeekScheduleGrid.tsx:597`) dialihkan ke `formatHourLabelLong` agar tooltip tetap "jam 13:00".
- **Acceptance:** `formatHourLabel(6)==='06'`, `(13)==='13'`, `(21)==='21'`; tidak ada `am`/`pm`/`:00` di gutter.

#### 2.2 Gutter 70 → 40 (+ perbaikan A9)
- **File:** `WeekScheduleGrid.tsx`
  - `:24` `TIME_GUTTER = 70` → `40`.
  - `:482` `width: '1050px'` → **`'1020px'`**.
  - `:501` `min-w-[1050px]` → **`min-w-[1020px]`**.
  - `:503` dan `:549` `grid-cols-[70px_repeat(7,minmax(140px,1fr))]` → `grid-cols-[40px_repeat(7,minmax(140px,1fr))]`.
  - `:558` label jam `p-2 pr-3 text-xs` → `p-1 pr-1.5 text-[10px] sm:text-xs font-mono tabular-nums`.
- **File:** `DayScheduleGrid.tsx`
  - `:255` `grid-cols-[70px_1fr] sm:grid-cols-[90px_1fr]` → `grid-cols-[40px_1fr] sm:grid-cols-[60px_1fr]`.
  - `:266` `p-2 sm:p-3 pr-3 sm:pr-4 text-xs` → `p-1 sm:p-2 pr-1.5 sm:pr-2 text-[10px] sm:text-xs font-mono tabular-nums`.
- **JANGAN ubah `minmax(140px,1fr)` → 130px** (A10): kartu mingguan justru menyempit.
- **Anggaran lebar:** `40 + 7×140 = 1020`. Angka 1020 wajib sama di `TIME_GUTTER`-turunan, spacer, dan `min-w`.
- **Acceptance:** geser ke kanan mentok **tepat di kolom Minggu** (tidak ada ruang kosong setelahnya); `revealDayColumn()` masih mendarat tepat (dibaca dari `TIME_GUTTER`, jadi otomatis ikut).

#### 2.3 Header kiri atas
- **File:** `WeekScheduleGrid.tsx:505-507`
- **Ganti:** teks `GMT+7` → `<Clock size={12} className="opacity-60" />`, padding `p-2 text-xs` → `p-1 text-[10px]`, plus `title="Waktu Indonesia Barat (WIB)"` untuk aksesibilitas.
- **Acceptance:** tidak ada teks "GMT+7"; ikon jam terlihat di light & dark mode.

#### 2.4 (BONUS, tutup F-27)
- **File:** `DayScheduleGrid.tsx:251-252`
- Hapus `WebkitOverflowScrolling: 'touch'` (deprecated) dan samakan pola dengan `WeekScheduleGrid`: `overscroll-behavior-y: auto`, hapus `overscroll-contain` + inline `overscrollBehavior`.
- **Acceptance:** scroll vertikal view Harian tidak lebih berat dari view Mingguan.

**Gerbang Fase 2:** build hijau + `tests/unit/calendar-hour-label.test.ts` hijau + verifikasi lebar grid (spacer = `TIME_GUTTER + 7×140`).

---

### FASE 3 — UX mobile & now-indicator

#### 3.1 Garis waktu sekarang (revisi A12/A13/A14)
- **File baru (pure, bisa diuji):** `packages/admin-dashboard/src/utils/calendarTimePosition.ts`
  ```ts
  export const GRID_START_HOUR = 6;
  export const GRID_END_HOUR = 22;

  /** Menit sejak 06:00 → posisi px, TERIKAT pada hourHeight (zoom). */
  export function computeNowTopPx(hours: number, minutes: number, hourHeight: number): number | null {
    const totalMinutes = (hours - GRID_START_HOUR) * 60 + minutes;
    if (totalMinutes < 0 || totalMinutes > (GRID_END_HOUR - GRID_START_HOUR) * 60) return null;
    return (totalMinutes / 60) * hourHeight;
  }
  ```
- **File:** `DayScheduleGrid.tsx`
  - Impor `getTodayWibDateKey`, `computeNowTopPx`.
  - State `nowTick` + `setInterval(60_000)` **dengan cleanup**; hitung dari `getWibHoursAndMinutes(new Date())` (WIB, bukan jam perangkat).
  - Render **di dalam kolom hari** (`:275`), bukan container grid `:255`:
    ```tsx
    {nowTopPx !== null && (
      <div className="absolute left-0 right-0 z-30 pointer-events-none flex items-center" style={{ top: `${nowTopPx}px` }}>
        <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
        <div className="flex-1 border-t-2 border-red-500" />
      </div>
    )}
    ```
  - Syarat tampil: `getWibDateKey(selectedDate) === getTodayWibDateKey()`.
- **Acceptance:** garis merah tepat di jam sekarang pada **ketiga level zoom** (compact/standard/detailed); tidak muncul di tanggal lain; tidak muncul di luar 06:00–22:00; tidak ada `setInterval` yang bocor saat komponen unmount.

#### 3.2 Kliping bawah kartu (revisi A15 — akar masalah, bukan padding)
- **Akar masalah:** `minCardHeight = 36/52` (`:126`) bisa lebih kecil dari tinggi konten, sementara kartu memakai `justify-between` + `overflow-hidden`.
- **Perbaikan (LOD berbasis tinggi kartu, bukan padding):**
  - Tambah helper `const showDetail = pos.heightPx >= 88; const showArea = pos.heightPx >= 72; const showStaff = pos.heightPx >= 64;` (nilai final ditentukan saat uji visual).
  - Bungkus baris bawah (`:454-459`) dengan `showStaff`, `areaLabel` (`:443`) dengan `showArea`, `cleanDetail` (`:439`) dengan `showDetail`.
  - Baris bawah: tambah `shrink-0 min-w-0`; teks nama terapis `truncate`.
- **Padding hanya pelengkap:** `p-2 sm:p-3` → `p-1.5 sm:p-2.5` (`:361`).
- **Acceptance:** pada slot 60 menit di **semua** level zoom, tidak ada elemen yang terpotong di batas bawah; tidak ada teks yang menimpa border.

#### 3.3 Header mobile ramping
- **File:** `DayScheduleGrid.tsx:238-259`
- Subtitle "Agenda jadwal kunjungan & perawatan harian" → `hidden sm:block`.
- Tombol tambah: `px-3.5 py-1.5 text-xs` → `px-2.5 py-1 text-[11px]`; teks "+ Tambah di Tanggal Ini" → `hidden sm:inline` (di HP cukup ikon `Plus` + label `aria-label`).
- Header padding `p-3.5 sm:p-4` → `p-2.5 sm:p-4`.
- **Acceptance:** tinggi header di 360px ≤ 96px (sebelumnya memakan ±35% layar); tombol tetap ≥ 36px tinggi sentuh.

**Gerbang Fase 3:** build hijau + `tests/unit/calendar-time-position.test.ts` hijau + uji visual 360px/390px.

---

### FASE 4 — Verifikasi & gerbang regresi (REVISI A16)

| Langkah | Perintah | Kriteria lulus |
|---|---|---|
| Typecheck + bundel | `npm --prefix packages/admin-dashboard run build` | `tsc` tanpa error, Vite sukses |
| Test unit baru | `npx vitest run tests/unit/patient-name.test.ts tests/unit/calendar-hour-label.test.ts tests/unit/calendar-time-position.test.ts` | semua hijau |
| Gate regresi penuh | `npx vitest run` (di **root**, bukan di `packages/admin-dashboard`) | **Tidak ada kegagalan baru**; baseline = **22 gagal / 10 file** (`KNOWN_ISSUES` #287). Jumlah 22 boleh turun, tidak boleh naik |
| Uji visual | viewport 360px & 390px | nama pasien terbaca, jam dua digit, garis merah tepat, tidak ada kliping |

> **Catatan:** `packages/admin-dashboard` **tidak punya** script `test`. Rencana awal menyebut `npm test` setelah `cd packages/admin-dashboard` — itu akan gagal.

---

## §2. Matriks Risiko & Mitigasi (revisi)

| Komponen | Risiko | Mitigasi |
|---|---|---|
| Gutter 70→40 | **Tinggi** — spacer & `min-w` 1050 tidak ikut berubah → ruang geser hantu | Ubah ketiganya dalam satu commit; acceptance: mentok kanan = kolom Minggu |
| Now-indicator | **Tinggi** — mengabaikan `hourHeight` → garis meleset saat zoom | Fungsi murni `computeNowTopPx` + test 3 level zoom |
| LOD kartu harian | Sedang — ambang px salah → info penting hilang | Ambang diuji visual; sembunyikan dari prioritas terendah (durasi → terapis → area → treatment) |
| `w-4.5` | Sedang — kelas mati, ukuran tak berubah | Pakai `w-4 h-4` / `w-5 h-5` |
| `text-[8px]` | Sedang — tak terbaca di HP | Minimum 9px |
| Nama tanpa gelar | Rendah — `stripHonorific` bisa memotong nama yang kebetulan diawali kata sapaan | Test adversarial; hanya memotong bila diikuti spasi + sisa nama |
| Gate regresi | Rendah | Baseline 22 kegagalan dicatat eksplisit |

---

## §3. Urutan Eksekusi yang Disarankan

1. **Fase 1** (Bulanan) — dampak terbesar, risiko terendah, tidak menyentuh scroll.
2. **Fase 2** (jam + gutter + GMT+7 + F-27) — satu file besar; jangan dicampur dengan Fase 1 dalam satu commit.
3. **Fase 3** (now-indicator + LOD + header) — paling berisiko; eksekusi terakhir, satu sub-fase satu commit.
4. **Fase 4** — gate penuh + deploy.

**Setiap fase:** commit terpisah → push → deploy live (`docker compose build app worker` + `up -d --no-deps app worker`, **tanpa** menyentuh WAHA) → verifikasi bundle → minta konfirmasi hasil di HP sebelum fase berikutnya.

---

## §4. ANTREAN SUSULAN — hasil uji HP Fase 4 (2026-10-29)

> **Status: ✅ DIEKSEKUSI 2026-10-29 (Fase 5–9) — menunggu verifikasi di HP.**
> Enam laporan user setelah melihat build Fase 4 di HP.
> **Temuan kunci: 6 laporan ≠ 6 masalah.** Semuanya bermuara pada **2 akar masalah** (F-31 & F-32)
> plus 2 permintaan penyederhanaan (F-33 & F-34).

### §4.0 Pemetaan laporan user → akar masalah

| # | Laporan user | Akar masalah | Bukti |
|---|---|---|---|
| 1 | "legend cuma nulis **Bidan**, tidak ada nama bidannya" | **F-31** `split(' ')[0]` pada nama yang semuanya diawali "Bidan"/"Staff" | `staffColors.ts:133-137`; data `staff` produksi |
| 2 | "mending dropdown, defaultnya off" | **F-34** legenda selalu terbuka, memakan tinggi | `StaffColorLegend.tsx:16-46` |
| 3 | "di Harian tidak perlu jam di kapsul… tulis jam mulai kecil… **kelurahan saja**, tidak perlu alamat lengkap" | **F-33** rentang jam + durasi ditulis penuh; `formatReservationArea` menggabung kelurahan+kecamatan | `DayScheduleGrid.tsx:414-420`; `reservationAddress.ts:48-50` |
| 4 | "di paling bawah itu harusnya **nama bidan yang handle**" | **F-32** isi kartu > tinggi kartu → elemen terakhir (chip bidan) terpotong `overflow-hidden` | `DayScheduleGrid.tsx:126,181,361,454-459` |
| 5 | "tulisan baby/moms/both diganti ikon" | **F-33** kategori ditulis teks | `DayScheduleGrid.tsx:380-382,405-407` |
| 6 | "terjadwal dan pending ikon saja" | **F-33** status ditulis teks + markup duplikat 2 file | `DayScheduleGrid.tsx:426-436`; `WeekScheduleGrid.tsx:683-693` |

### §4.1 FASE 5 — Nama bidan kanonis (F-31) ← **wajib lebih dulu**

- **File:** `packages/admin-dashboard/src/utils/resolveStaffName.ts`
- **Tambah seam:**
  ```ts
  /** Gelar/jabatan yang menempel di depan nama bidan. Hanya dipotong bila
   *  diikuti minimal satu kata lain ("Bidan Hanifah" → "Hanifah"), supaya
   *  staff yang benar-benar bernama "Admin" tidak jadi kosong. */
  const STAFF_ROLE_PREFIX = /^(?:bidan|suster|perawat|terapis|therapist|staff|karyawan|kak|kakak|ibu|bunda|mrs\.?|ny\.?|nn\.?|sdri\.?)\s+/i;
  const STAFF_ROLE_ONLY = /^(?:bidan|suster|perawat|terapis|therapist|staff|karyawan|admin|kak|kakak|ibu|bunda)$/i;

  export function staffDisplayName(name: string | null | undefined): string {
    const raw = (name || '').trim();
    if (!raw) return '';
    const stripped = raw.replace(STAFF_ROLE_PREFIX, '').trim();
    // Nama yang seluruhnya gelar ("Staff Bidan") → kembalikan apa adanya,
    // jangan mengarang nama.
    return !stripped || STAFF_ROLE_ONLY.test(stripped) ? raw : stripped;
  }

  /** Nama pendek untuk ruang sempit: kata pertama dari nama yang sudah bersih. */
  export function staffShortName(name: string | null | undefined): string {
    const clean = staffDisplayName(name);
    return clean ? clean.split(/\s+/)[0] : '';
  }
  ```
- **File:** `staffColors.ts:133-137` → `shortStaffLabel` didelegasikan ke `staffShortName` (hapus implementasi lokal; jangan biarkan dua sumber).
- **Acceptance (data produksi nyata):** `staffShortName('Bidan Hanifah') === 'Hanifah'`; `('Bidan Testing Yusi') === 'Testing'`; `('Bidan Yusi F') === 'Yusi'`; `('Admin') === 'Admin'`; `('Staff Bidan') === 'Staff Bidan'`; `('') === ''`.
- **Pemakai wajib diganti dalam fase yang sama** (kalau tidak, bug tetap ada di sebagian tempat):
  - `WeekScheduleGrid.tsx:721-725` (baris bawah kartu) → `staffShortName(resolveStaffName(res, staffList))`
  - `DayScheduleGrid.tsx:385-389` (LOD compact) → idem
  - `StaffColorLegend.tsx:40` → `staffDisplayName(s.name)` (dropdown punya ruang, tampilkan nama penuh tanpa gelar)

### §4.2 FASE 6 — Legenda jadi dropdown, default tertutup (F-34)

- **File:** `StaffColorLegend.tsx` (bongkar isi, **bukan** buat komponen baru)
- **Pola yang diikuti:** pola toggle yang sudah dipakai repo (`useState(false)` + `ChevronDown`/`ChevronUp`) — lihat `CustomerFollowUpSection.tsx:237`, `AiModelSettingsPanel.tsx:748`. Tidak ada dependency baru.
- **Bentuk tertutup (default):** satu baris tipis `h-7`, isi: label "Warna Bidan" + **4 titik warna pertama** (pratinjau) + `ChevronDown`, seluruh baris jadi `<button aria-expanded>`.
- **Bentuk terbuka:** daftar `flex-wrap` (bukan `overflow-x-auto` — biar tidak bentrok dengan gestur geser kalender) berisi `dot + nama bersih`, tiap baris `title` = nama asli.
- **Acceptance:** saat halaman dibuka, legenda hanya 1 baris ≤ 28px; setelah diklik muncul nama bidan; klik lagi menutup; `aria-expanded` berubah; tidak ada `overflow-x-auto` di dalam area kalender.

### §4.3 FASE 7 — Declutter kartu Harian & Mingguan (F-33)

- **File baru (presentasi, murni, bisa diuji):** `packages/admin-dashboard/src/utils/treatmentCategoryIcon.ts`
  ```ts
  // Pemetaan enum DB TreatmentCategory → ikon. BUKAN data bisnis:
  // enum-nya sudah ada di prisma/schema.prisma:35-40.
  export const TREATMENT_CATEGORY_META = {
    BABY:  { label: 'Bayi',        Icon: Baby },
    KIDS:  { label: 'Anak',        Icon: Smile },
    MOMS:  { label: 'Ibu',         Icon: Heart },
    BOTH:  { label: 'Ibu & Anak',  Icon: Users },
  } as const;
  export function getTreatmentCategoryMeta(category?: string | null) { /* fallback null */ }
  ```
- **File baru:** `packages/admin-dashboard/src/components/calendar/ReservationStatusIcon.tsx`
  - Satu komponen untuk **semua** status, menggantikan markup duplikat di 2 grid.
  - `hold` → **tetap teks "HOLD"** (status paling kritis, tidak boleh jadi ikon ambigu).
  - `confirmed` → `CheckCircle2`; `confirmed` + `purchase_occurred_at` → `CheckCheck` (makna "lunas" tetap ada, dibedakan ikon ganda).
  - lainnya (pending) → `AlertCircle`.
  - Wajib `title` + `aria-label` berisi teks aslinya ("Terjadwal", "Terjadwal • Lunas", "Pending").
- **Perubahan `DayScheduleGrid.tsx` (LOD normal/detailed, `:414-436`):**
  - **Buang** chip rentang jam `{timeRangeStr}` + ikon `Clock` dan chip `{pos.duration}m`.
  - **Ganti** dengan satu teks kecil `text-[10px] font-mono opacity-80` berisi **jam mulai saja** (`startTimeStr`), ditempel di samping nama pasien.
  - **Ganti** chip kategori teks → `<Icon size={12} title/aria-label>`.
  - **Ganti** chip status teks → `ReservationStatusIcon`.
  - LOD compact (`:363-390`): hapus `({pos.duration}m)`; kategori → ikon; bidan `hidden sm:inline` → **selalu tampil** (nama sudah pendek berkat Fase 5).
- **Perubahan `WeekScheduleGrid.tsx` (`:659-693`):**
  - LOD compact: hapus `({pos.duration}m)`.
  - LOD normal/detailed: status teks → `ReservationStatusIcon`; baris bawah `split(/\s+/)[0]` → `staffShortName(...)`; chip `{pos.duration}m` tetap (satu-satunya penanda durasi di view Mingguan yang tidak punya tinggi kartu lebar).
- **Acceptance:** tidak ada lagi teks `BABY`/`MOMS`/`BOTH`/`KIDS`/`Terjadwal`/`Pending` di kartu; semua ikon punya `title`/`aria-label`; `npm run build` hijau.

### §4.4 FASE 8 — Area kelurahan saja (F-33 lanjutan)

- **File:** `reservationAddress.ts` — **tambah** (jangan ubah `formatReservationArea`, view Mingguan masih butuh gabungan):
  ```ts
  /** Label area paling ringkas untuk kartu Harian: kelurahan saja.
   *  Fallback kecamatan karena 66% customer belum punya kelurahan
   *  (produksi: 337/1001 kelurahan, 413/1001 kecamatan). */
  export function formatReservationKelurahan(reservation): string {
    const c = reservation?.customer;
    return cleanPart(c?.kelurahan) || cleanPart(c?.kecamatan) || '';
  }
  ```
- **File:** `DayScheduleGrid.tsx:327` → `formatReservationKelurahan(res)`.
- **Jangan** ikut ubah `formatReservationArea` (dipakai Bulanan/Mingguan).
- **Acceptance:** kartu Harian menampilkan satu kata wilayah (mis. "Mulyorejo"), tanpa koma; kartu tanpa kelurahan tetap menampilkan kecamatan (tidak kosong).

### §4.5 FASE 9 — Anti-kliping: nama bidan selalu terlihat (F-32) ← inti

> Ini **bukan** penambalan padding. Akar masalahnya: tinggi kartu lebih kecil dari tinggi isi,
> lalu `overflow-hidden` memotong dari bawah — tepat di elemen terakhir (chip bidan).

- **File:** `DayScheduleGrid.tsx`
- **Model LOD berbasis tinggi kartu** (bukan `zoomLevel` saja), dievaluasi per kartu:
  ```tsx
  // Anggaran tinggi isi (px) — dipakai untuk memutuskan apa yang dibuang.
  const canShowDetail = pos.heightPx >= 84;   // baris detail treatment
  const canShowArea   = pos.heightPx >= 68;   // baris kelurahan
  const canShowStaff  = pos.heightPx >= 52;   // baris bidan (PRIORITAS TERTINGGI)
  ```
- **Urutan prioritas yang dipertahankan saat kartu memendek:** nama pasien → jam mulai → bidan → area → detail treatment. Artinya **bidan dibuang paling akhir**, bukan paling awal.
- **Wajib:** baris bidan diberi `shrink-0` dan dipindah **keluar** dari blok yang boleh dibuang; blok atas diberi `min-h-0 overflow-hidden`.
- **Wajib:** `justify-between` diganti `flex-col` + `gap-0.5` agar tidak ada ruang yang dipaksa kosong saat isi sedikit.
- **Acceptance:** pada slot **30, 45, dan 60 menit** di ketiga level zoom, nama bidan **selalu** terlihat; tidak ada teks yang menempel ke border bawah; `document.querySelectorAll('[data-event-card]')` tidak ada yang `scrollHeight > clientHeight + 2`.

### §4.6 Gerbang & urutan

| Fase | Isi | Kenapa urutannya di sini |
|---|---|---|
| 5 | Nama bidan kanonis | Fondasi; dipakai legenda + 2 grid |
| 6 | Legenda dropdown | Butuh nama dari Fase 5 |
| 7 | Declutter kartu (ikon) | Mengurangi lebar isi → memberi ruang untuk Fase 9 |
| 8 | Kelurahan saja | Satu baris, dampak kecil |
| 9 | Anti-kliping LOD | Terakhir karena mengukur ulang tinggi setelah Fase 7–8 |

**Gerbang tiap fase:** `npm --prefix packages/admin-dashboard run build` hijau + test unit baru hijau + gate regresi **tanpa kegagalan baru** (baseline 22 gagal / 10 file, `KNOWN_ISSUES` #287).

**Test unit wajib (adversarial, bukan happy-path):**
- `tests/unit/staff-display-name.test.ts` — 6 nama produksi nyata + `null` + `''` + nama yang seluruhnya gelar + nama tanpa gelar + gelar huruf kecil (`bidan hanifah`).
- `tests/unit/treatment-category-icon.test.ts` — 4 nilai enum + nilai tak dikenal + `null`.
- `tests/unit/reservation-area-kelurahan.test.ts` — kelurahan saja, kelurahan kosong → kecamatan, keduanya kosong → `''`, kelurahan = kecamatan.
