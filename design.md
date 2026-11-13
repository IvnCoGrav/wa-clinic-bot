# DESIGN.md — Sistem Desain Dashboard Klinik

Dokumen ini menetapkan bahasa visual dan standar interaksi dashboard admin serta
halaman publik. Isinya sengaja memakai **nama token**, bukan hex mentah, karena
hex mentah dilarang di kode UI (`npm run check:tokens`).

---

## 1. Prinsip

1. **Satu fokus per layar.** Satu angka atau satu aksi boleh paling menonjol.
   Sisanya mendukung, bukan bersaing. Contoh: kartu "Reservasi Masuk Hari Ini"
   di Overview memakai ukuran angka lebih besar; tiga kartu lain lebih kecil.
2. **Tenang, bukan ramai.** Gerak dipakai untuk menjelaskan perubahan status,
   bukan hiasan. Tidak ada denyut tanpa akhir.
3. **Bahasa manusia.** Istilah kanonik: Pasien, Layanan, Terapis, Ongkir
   (`src/config/glossary.ts`). Nama produk teknis (WAHA, CAPI, CTA) tetap.
4. **Data bisnis dari database.** Harga, tarif ongkir, nomor WhatsApp, dan nama
   klinik tidak boleh ditulis di kode atau template statis.

## 2. Token Warna

Sumber tunggal: `packages/admin-dashboard/src/index.css` (light & dark) plus
`chartTheme`. Jangan menulis hex di komponen.

| Peran | Token | Dipakai untuk |
| :--- | :--- | :--- |
| Aksen utama | `accent`, `accent-hover`, `accent-ink` | CTA, tab aktif, ikon utama |
| Permukaan | `surface`, `surface-2`, `fill-1`, `fill-2` | Kartu, panel, latar baris |
| Teks | `ink`, `ink-2`, `ink-3` | Judul, label, metadata |
| Garis | `divider`, `strong` | Pemisah, border input |
| Status | `success`, `warning`, `danger`, `info` + `*-soft`, `*-line` | Badge, alert, status |
| Teks di atas warna | `accent-ink`, `on-solid` | Tombol dan badge solid |

Aturan kontras: teks putih hanya di atas permukaan solid yang punya token
`on-solid`/`*-ink`. Dijaga otomatis oleh `npm run check:contrast`.

## 3. Tiga Dial

Dial dipakai untuk menyetel intensitas, bukan menambah token baru.

| Dial | Dashboard admin | Halaman publik |
| :--- | :--- | :--- |
| **ENERGY** (keberanian warna & kontras) | 1 — tenang, banyak ruang kosong | 2 — lebih persuasif, tetap sopan |
| **RHYTHM** (kepadatan & ritme jarak) | 1 — padat terukur untuk kerja harian | 2 — lebih lapang untuk dibaca sekali jalan |
| **MOTION** (jumlah gerak) | 1 — hanya transisi fungsional | 1 — masuk halus, tanpa loop |

## 4. Tipografi

- Stack sistem: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
  'Helvetica Neue', Arial, sans-serif`. Tidak ada unduhan font, tidak ada
  permintaan ke Google Fonts.
- Minimum teks efektif 11px. Kelas `text-[9px]`/`text-[10px]` dinaikkan ke 11px
  oleh aturan CSS global; jangan menambah pemakaian baru.
- Angka memakai `tabular-nums` (`num`) agar kolom nominal tidak bergoyang.

## 5. Gerak

- Durasi transisi 150–220ms, easing `cubic-bezier(0.23, 1, 0.32, 1)`.
- `animate-action-pulse` maksimal 6 putaran lalu berhenti.
- Denyut permanen hanya untuk status yang benar-benar live (mis. lokasi live di
  peta). Status lain memakai warna + label.
- `prefers-reduced-motion` wajib dihormati di dashboard dan halaman publik.

## 6. Komponen & Overlay

- Modal memakai `components/ui/Modal.tsx` (focus trap, Escape, scroll lock,
  `data-modal-active`/`data-modal-close` untuk gestur swipe). Drawer, popover,
  dan lightbox tetap berdiri sendiri karena perilakunya berbeda.
- Setiap scrim layar penuh wajib memakai kelas `modal-backdrop` agar scroll di
  belakang overlay tidak ikut bergerak.
- Skala z memakai token: `z-dialog`, `z-toast`, dan nilai terdokumentasi di
  `index.css`. Jangan menulis `z-[99999]` baru.

## 7. Format Data

- Uang: `utils/money.ts` (`formatRupiah`, `formatRupiahPresisi`,
  `formatRupiahRingkas`, `formatGratis`).
- Tanggal & jam: `utils/dateWib.ts` (`formatWib`, `formatWibClock`,
  `formatWibDate`, `formatMonthYearWib`). Dilarang memanggil
  `toLocaleDateString`/`toLocaleTimeString` langsung di komponen/halaman;
  dijaga oleh `npm run check:dates`.

## 8. Aksesibilitas

- Setiap input punya label atau `aria-label`.
- Tombol ikon punya `aria-label`; status dinamis memakai `aria-live` bila perlu.
- Target sentuh minimum 44px di layar kecil (tabel dan chip dikecualikan).
- Jangan memakai `window.confirm`/`alert`; gunakan `useUiFeedback`.

## 9. Gerbang Otomatis

`npm run check:design` menjalankan:

| Gerbang | Menjaga |
| :--- | :--- |
| `check:tokens` | tidak ada hex mentah baru |
| `check:dark-parity` | kelas palet selalu punya pasangan `dark:` |
| `check:a11y` | tombol/label tanpa nama aksesibel |
| `check:contrast` | teks putih di atas solid tanpa token |
| `check:dates` | tanggal selalu lewat `dateWib.ts` |
| `check:catalog` | katalog landing tidak menyimpang dari DB |

Klaim "WCAG compliant" tidak dipakai lagi. Yang berlaku: **dijaga oleh
`check:contrast` dan `check:a11y`**, dengan pengujian Lighthouse manual untuk
halaman publik.
