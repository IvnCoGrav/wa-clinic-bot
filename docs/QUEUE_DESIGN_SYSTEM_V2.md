# Queue & Spesifikasi Kanonis Design System v2: Satu Sistem untuk Semua Modul

Dokumen spesifikasi arsitektur dan antrean eksekusi migrasi UI kanonis untuk `packages/admin-dashboard`.

---

## 1. Prinsip & Kontrak Desain Inti

1. **Satu Sistem:** Semua modul (LiveChat, Kalender, CRM, Dashboard/Grafik, Settings) memakai token yang sama.
2. **Bukan Hitam Murni:** Dasar dark mode memakai biru-kehijauan sangat gelap (`#0B141A` / RGB `11 20 26`), bukan `#000000`.
3. **Bukan Putih Murni:** Teks utama memakai putih keabu-abuan (`#E9EDEF` / RGB `233 237 239`), bukan `#FFFFFF`.
4. **Elevasi = Lebih Terang:** Urutan elevasi: `--c-app` (paling dasar) → `--c-surface` (kartu/panel) → `--c-surface-2` (input/popover).
5. **Kanal RGB untuk Token:** Semua nilai token warna didefinisikan sebagai 3 angka kanal RGB tanpa koma (misal: `17 27 33`).
6. **Mekanisme Alpha Tailwind:** Dibaca melalui helper `rgb(var(--c-[nama]) / <alpha-value>)` agar modifier opasitas seperti `bg-surface/50` atau `border-accent/40` dapat dikompilasi dengan sempurna.
7. **Larangan Prefiks Ganda:** Penamaan kelas utilitas tidak boleh berulang canggung. Gunakan:
   - Warna `divider` → kelas `border-divider` (BUKAN `border-border-separator`)
   - Warna `ink` → kelas `text-ink` (BUKAN `text-text-primary`)
   - Warna `surface` → kelas `bg-surface`
8. **Setiap File yang Dimigrasikan Wajib:**
   - Mengganti seluruh kelas hex acak dengan kelas token semantik.
   - Menghapus aturan selektor `.dark` miliknya dari `src/index.css`.
   - Mengurangi baseline pada `design-token-baseline.json` via `npm run check:tokens -- --update`.
9. **Zero Runtime Dependencies:** Skrip gerbang hanya menggunakan bawaan Node.js (`node:fs`, `node:path`, `node:url`).

---

## 2. Tabel Token Kanonis (Kanal RGB)

| Token Semantik | Peran & Pemakaian | Nilai Light Mode (RGB / Hex) | Nilai Dark Mode (RGB / Hex) | Kelas Tailwind |
| :--- | :--- | :--- | :--- | :--- |
| `app` | Kanvas aplikasi, latar halaman dasar | `240 242 245` (`#F0F2F5`) | `11 20 26` (`#0B141A`) | `bg-app` |
| `content` | Area baca terdalam, latar dinding chat | `239 234 226` (`#EFEAE2`) | `11 20 26` (`#0B141A`) | `bg-content` |
| `surface` | Kartu, modal, toolbar, panel dasar | `255 255 255` (`#FFFFFF`) | `17 27 33` (`#111B21`) | `bg-surface` |
| `surface-2` | Header kartu, input, popover, selected row | `248 250 252` (`#F8FAFC`) | `28 39 46` (`#1C272E`) | `bg-surface-2` |
| `sidebar` | Sidebar navigasi desktop & drawer mobile | `255 255 255` (`#FFFFFF`) | `17 27 33` (`#111B21`) | `bg-sidebar` |
| `fill-1` | Hover pada baris tabel & daftar | `240 242 245` | `32 44 51` (`#202C33`) | `bg-fill-1` |
| `fill-2` | Pressed state, chip netral pressed | `233 237 239` | `42 57 66` (`#2A3942`) | `bg-fill-2` |
| `divider` | Garis pemisah daftar & tabel, border halus | `233 237 239` (`#E9EDEF`) | `42 57 66` (`#2A3942`) | `border-divider` |
| `strong` | Garis outline input fokus, tombol sekunder | `209 215 219` (`#D1D7DB`) | `55 66 72` (`#374248`) | `border-strong` |
| `ink` | Teks utama: judul, isi, nama, angka | `17 27 33` (`#111B21`) | `233 237 239` (`#E9EDEF`) | `text-ink` |
| `ink-2` | Teks sekunder: label, subhead, jam | `84 101 111` (`#54656F`) | `174 186 193` (`#AEBAC1`) | `text-ink-2` |
| `ink-3` | Teks nonaktif, placeholder, caption redup | `134 150 160` (`#8696A0`) | `134 150 160` (`#8696A0`) | `text-ink-3` |
| `accent` | Aksi utama, tombol aktif, toggle aktif | `0 128 105` (`#008069`) | `0 168 132` (`#00A884`) | `bg-accent`, `text-accent` |
| `accent-hover` | Hover pada elemen aksen utama | `0 108 90` | `6 149 120` | `hover:bg-accent-hover` |
| `accent-pressed`| Pressed state aksen utama | `0 92 75` | `0 128 105` | `active:bg-accent-pressed` |
| `accent-soft` | Latar chip aktif, item terpilih di sidebar | `232 245 242` (`#E8F5F2`) | `15 47 42` | `bg-accent-soft` |
| `accent-ink` | Teks di atas warna aksen | `255 255 255` | `11 20 26` (`#0B141A`) | `text-accent-ink` |
| `success` | Status sukses, bayar lunas, konfirmasi | `5 122 85` | `0 168 132` | `text-success`, `bg-success` |
| `success-soft` | Latar chip status sukses | `236 253 245` | `16 41 31` | `bg-success-soft` |
| `success-line` | Border chip status sukses | `167 243 208` | `28 59 48` | `border-success-line` |
| `info` | Status info, tautan, centang terbaca chat | `3 105 161` | `56 189 248` | `text-info`, `bg-info` |
| `info-soft` | Latar chip status info | `239 246 255` | `12 32 48` | `bg-info-soft` |
| `info-line` | Border chip status info | `191 219 254` | `24 60 88` | `border-info-line` |
| `warning` | Status peringatan, butuh respons segera | `180 83 9` | `245 158 11` | `text-warning`, `bg-warning` |
| `warning-soft` | Latar chip status peringatan | `255 251 235` | `45 32 8` | `bg-warning-soft` |
| `warning-line` | Border chip status peringatan | `253 230 138` | `74 52 12` | `border-warning-line` |
| `caution` | Status perhatian, mendekati jatuh tempo | `194 65 12` | `251 146 60` | `text-caution`, `bg-caution` |
| `caution-soft` | Latar chip status perhatian | `255 247 237` | `48 28 12` | `bg-caution-soft` |
| `caution-line` | Border chip status perhatian | `254 215 170` | `80 45 18` | `border-caution-line` |
| `danger` | Status bahaya, gagal, aksi destruktif | `190 18 60` | `248 113 113` | `text-danger`, `bg-danger` |
| `danger-soft` | Latar chip status bahaya | `255 241 242` | `48 18 22` | `bg-danger-soft` |
| `danger-line` | Border chip status bahaya | `254 205 211` | `84 28 34` | `border-danger-line` |
| `neutral` | Status netral, draft, unassigned | `84 101 111` | `134 150 160` | `text-neutral`, `bg-neutral` |
| `neutral-soft` | Latar chip status netral | `240 242 245` | `32 44 51` | `bg-neutral-soft` |
| `bubble-in` | Gelembung chat masuk (customer) | `255 255 255` (`#FFFFFF`) | `32 44 51` (`#202C33`) | `bg-bubble-in` |
| `bubble-out` | Gelembung chat keluar (klinik/bot) | `217 253 211` (`#D9FDD3`) | `0 92 75` (`#005C4B`) | `bg-bubble-out` |

---

## 3. Resep Migrasi per File (5 Langkah Standar)

Setiap pengembang atau agen yang memigrasikan sebuah file komponen wajib mengikuti 5 langkah berurutan:

1. **Audit Hex Eksisting:**  
   Periksa jumlah hex di file: `rg -o "#[0-9a-fA-F]{3,8}" [path-file] | wc -l`.
2. **Substitusi Kelas ke Token:**  
   Ganti pasangan kelas manual:
   - `bg-white dark:bg-[#202c33]` / `bg-white dark:bg-[#111b21]` → `bg-surface`
   - `bg-[#f8fafc] dark:bg-[#1c272e]` → `bg-surface-2`
   - `border-[#e9edef] dark:border-[#2a3942]` → `border-divider`
   - `text-[#111b21] dark:text-[#e9edef]` → `text-ink`
   - `text-[#54656f] dark:text-[#8696a0]` → `text-ink-2`
   - `text-[#8696a0]` / `placeholder:text-[#8696a0]` → `text-ink-3`
   - Badge manual `bg-emerald-50 dark:bg-emerald-950/40...` → `StatusChip` atau `bg-success-soft text-success border-success-line`
3. **Gunakan Komponen Primitif:**  
   Gunakan `Button`, `Input`, `StatusChip`, `Card`, `KpiCard`, atau `Table` dari `src/components/ui/` bila ada.
4. **Hapus Aturan `.dark` di `src/index.css`:**  
   Cari aturan override CSS manual yang menargetkan komponen tersebut di `index.css` (baris 601–917) dan hapus agar tidak terjadi konflik cascade.
5. **Jalankan Verifikasi & Perbarui Baseline:**  
   ```bash
   npm run check:tokens
   npm run check:tokens -- --update
   npm run build
   ```

---

## 4. Antrean Migrasi Modul (Batch B1 – B9)

| Batch | Cakupan File | Target Utama |
| :--- | :--- | :--- |
| **B1** | `common/*` + `meta-performance/*` | Standardisasi panel umum dan charts (`src/lib/chartTheme.ts`) |
| **B2** | `calendar/*` + `utils/staffColors.ts` | Integrasi jadwal, seam warna staf ke token, status reservasi |
| **B3** | `modals/*` | Migrasi 5 modal utama ke `src/components/ui/Modal` dengan focus trap & ARIA |
| **B4** | `settings/*` | Standardisasi 12 panel pengaturan bot, provider WA, AI model, harga |
| **B5a**| Halaman pendukung kecil (ChatExport, CustomerLabels, DeliveryTiers, dll.) | Eliminasi hex pada modul tabular ringan |
| **B5b**| Halaman menengah (AiSandbox, QuickReplies, FollowUpQueue, MetaCapiQueue) | Perbaikan form interaktif dan simulasi |
| **B5c**| Halaman kompleks (ClinicServices, Debug, AiPersona, KnowledgeBase, StaffManagement, MetaClickCatcher) | Pembersihan form besar & editor data |
| **B6** | Data & Transaksi Inti (`CustomerDatabase`, `Reservations`, `TodayTreatments`, `FinancialAnalytics`, `Overview`) | Adopsi penuh `Table`, `KpiCard`, dan `chartTheme` |
| **B7** | `livechat/*` + `LiveChatMonitor` | **Prasyarat:** Refactor pemecahan file 7.606 baris sebelum styling; gelembung chat kanonis |
| **B8** | `staff/*` + `StaffToday` + `StaffLogin` | **Prasyarat:** Refactor pemecahan file 6.227 baris sebelum styling |
| **B9** | `StitchShowcase` + `App.tsx` + Sisa Utilitas | Finalisasi token pada kanvas demo dan utilitas peta |

---

## 5. Matriks Kontras Minimum (WCAG 2.1 AA)

- **Teks Biasa (<18px / <14px bold):** Minimal **4.5:1** terhadap latar belakang tempat ia berdiri.
- **Teks Besar (≥18px / ≥14px bold):** Minimal **3.0:1**.
- **Komponen UI & Ikon Fungsional:** Minimal **3.0:1**.
- **State Teks Sekunder di atas `surface-2`:** Pada mode gelap, `text-ink-2` di atas `--c-surface-2` wajib menggunakan `--c-ink-2` (`174 186 193`) agar rasio kontras tetap di atas 4.5:1.

---

## 6. Status Eksekusi (diperbarui 2026-10-29)

### 6.1 Token yang Sudah Ada

| Grup | Anggota | Catatan |
| :--- | :--- | :--- |
| Permukaan | `app`, `content`, `surface`, `surface-2`, `sidebar`, `fill-1`, `fill-2` | — |
| Garis | `divider`, `strong` | — |
| Teks | `ink`, `ink-2`, `ink-3` | `ink` 17,4:1 · `ink-2` 7,70:1 · `ink-3` 5,20:1 di surface (semua lulus AA) |
| Aksen | `accent`, `-hover`, `-pressed`, `-soft`, `-ink` | — |
| Status | `success`, `info`, `warning`, `caution`, `danger`, `neutral` × (`DEFAULT`, `soft`, `line`, `hover`) | `neutral` tidak punya `line`/`hover` |
| Tambahan | `violet` × (`DEFAULT`, `soft`, `line`, `hover`), `on-solid` | `on-solid` = warna konten di atas permukaan solid |
| Data/chart | `d1`–`d8`, `bubble-in`, `bubble-out` | dipakai `src/lib/chartTheme.ts` |

### 6.2 Aturan Pemetaan Kelas Legacy → Token

Aturan ini yang dipakai codemod dan menjadi acuan review manual ke depan:

| Asal | Tujuan |
| :--- | :--- |
| `bg-{hue}-50`, `bg-{hue}-100` | `bg-{role}-soft` |
| `bg-{hue}-200` | `bg-{role}-line` |
| `bg-{hue}-300..950` | `bg-{role}` |
| `hover:bg-{hue}-50` | `hover:bg-{role}-soft` |
| `hover:bg-{hue}-100` | `hover:bg-{role}-line` |
| `hover:bg-{hue}-200..500` | `hover:bg-{role}` |
| `hover:bg-{hue}-600..950` | `hover:bg-{role}-hover` |
| `border-{hue}-50..300` | `border-{role}-line` |
| `border-{hue}-400..950` | `border-{role}` |
| `text-{hue}-*` | `text-{role}` |
| `bg-white` (opaque, tanpa `dark:`) | `bg-surface` |
| `bg-white/70`, `bg-white/90` | `bg-surface/70`, `bg-surface/90` |
| `text-white` di atas `bg-{role}` solid | `text-on-solid` |

Peta hue → role: `emerald/green/teal/lime` → `success` · `amber/yellow` → `warning` · `orange` → `caution` · `rose/red/pink` → `danger` · `sky/blue/indigo/cyan` → `info` · `violet/purple/fuchsia` → `violet` · `slate/gray/zinc/stone/neutral` → netral manual (`surface-2`/`fill-*`/`divider`/`strong`/`ink-2`/`ink-3`).

### 6.3 Gerbang Wajib

```bash
npm run check:design    # check:tokens + check:dark-parity
npm run build
```

Baseline `dark-parity-baseline.json` hanya boleh turun. Menambah `bg-white` atau kelas palet tanpa `dark:` akan menggagalkan gerbang.

### 6.4 Sisa Pekerjaan

Lihat `docs/KNOWN_ISSUES.md` **#290**. Entri #289 (paritas dark, kontras, `.wa-*`, D-5, `statusTone`) sudah **CLOSED**.

### 6.5 Status Test & Seam (diperbarui Fase 3)

| Item | Status |
| :--- | :--- |
| `tests/unit/customer-map-utils.test.ts` | Lulus — memakai token + invarian anti-hex |
| `tests/unit/staff-colors.test.ts` | Lulus — invarian "palet mentah wajib berpasangan `dark:bg-`" |
| `tests/unit/status-tone.test.ts` | Lulus — semantik `paid` + invarian `TONE_STYLES` |
| `reservationStatusToTone` | Dipakai `ReservationStatusIcon` (Day & Week grid) |
| `var()` di atribut presentasi SVG | **Terbukti resolve** di Chromium — bukan bug |

Aturan test design system ke depan: uji **invarian** (warna wajib bertoken, aman di dua mode), jangan uji nilai warna harfiah — nilai token boleh berubah tanpa merusak test.

### 6.6 Sumber Tunggal Warna Status (Fase 3)

| Lapisan | Berkas | Tanggung jawab |
| :--- | :--- | :--- |
| Status → nada | `src/utils/statusTone.ts` | `reservationStatusToTone(status, paid)` → `StatusTone` |
| Nada → kelas | `src/lib/statusTones.ts` | `TONE_STYLES`, `toneChipClass()`, `toneRingClass()` |
| Konsumen | `StatusChip`, `ReservationStatusIcon` | hanya menerima `tone`/`status`, tidak mendefinisikan warna |

Dilarang menulis ulang pemetaan warna status di komponen. Menambah status baru = tambah case di `statusTone.ts` + test di `tests/unit/status-tone.test.ts`.

**Semantik `paid` (tri-state):** `true` = pembayaran tercatat (lunas), `false` = sistem yakin belum lunas, `undefined` = tidak diketahui. Kolom DB kosong (`purchase_occurred_at` null) **bukan** bukti belum lunas — karena itu `DayScheduleGrid`/`WeekScheduleGrid` mengirim `undefined`, bukan `false`.

### 6.7 Pengecualian Gerbang (keputusan D-5)

`scripts/check-dark-parity.mjs` punya `EXCLUDED_FILES` berisi `src/pages/StitchShowcase.tsx` — galeri referensi desain yang isi halamannya memang memamerkan palet mentah. Pengecualian dilakukan **dengan nama + alasan tertulis**, bukan dengan menaikkan angka baseline, sehingga baseline file lain tetap 0 dan gerbang tetap ketat. Gerbang akan gagal bila file pengecualian sudah tidak ada (pengecualian basi).
