# ADR 0004: UI Catalog Dev-Only untuk Pencegahan Duplikasi Komponen Dashboard

## Status
Accepted (2026-11-16)

## Konteks & Masalah
Sistem menganut **Mandat Anti-Bloat & Modularity-First**, yang melarang penambahan halaman baru tanpa justifikasi arsitektur yang kuat dan mewajibkan penggunaan kembali (*reusability-first*) komponen yang sudah ada.

Namun, selama ini developer dan AI coding agents kesulitan mengetahui keberadaan komponen yang sudah ada di `src/components/ui` dan `src/components/common` karena tidak tersedianya galeri visual hidup. File `StitchShowcase.tsx` (795 baris) yang ada sebelumnya ternyata merupakan mockup visual statis murni dan tidak mengimpor komponen bersama sistem. Ketiadaan katalog komponen hidup menyebabkan maraknya pembuatan tombol ad-hoc, modal custom, dan input inline yang merusak konsistensi desain sistem.

## Keputusan
1. Membuat satu halaman katalog komponen dev-only: `packages/admin-dashboard/src/pages/UiCatalog.tsx`.
2. Halaman ini hanya aktif pada environment lokal (`import.meta.env.DEV`) dan di-mount secara dinamis / lazy-loaded di rute `/ui-catalog`.
3. Menampilkan seluruh primitif antarmuka (`Button`, `Card`, `Fields`, `Modal`, `StatusChip`, `Tag`, `Table`, `KpiCard`, `StateViews`) beserta berbagai variasinya (states: default, hover, disabled, loading).
4. Menampilkan pattern bersama (`UiFeedback`, `ToggleSwitch`, `Pagination`, `ThemeToggle`).
5. Pada build produksi (`npm run build`), rute dan bundle galeri ini dieleminasi total (tree-shaken) sehingga biaya performa produksi adalah nol.

## Konsekuensi & Mitigasi
- **Positif**: Developer dan AI agent dapat melihat dan menguji komponen UI secara interaktif dalam waktu < 5 detik.
- **Positif**: Gate `check:ui-reuse` dapat menegakkan penggunaan kembali komponen dengan bukti visual nyata.
- **Mitigasi Bundle**: Terkunci di balik `import.meta.env.DEV` sehingga tidak akan bocor ke bundle JavaScript produksi.
