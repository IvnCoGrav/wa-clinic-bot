# Audit 004: Konsolidasi 41 Temuan + Audit Collateral Damage

- **Tanggal:** 2026-11-10
- **Jenis:** konsolidasi tiga audit sebelumnya + Tahap 5 `audit-sistem-berlapis` (Audit Collateral Damage)
- **Framework:** ISO 19011 (tata cara) + ISO 25010 (kualitas produk: maintainability, usability, keandalan) + FMEA (S × O × D) + pre-mortem
- **Mode:** baca-saja. Tidak ada file kode, test, CSS, HTML, atau `package.json` yang diubah.
- **Sumber:** `anti-slop/audit-001` (17 temuan), `anti-slop/audit-002` (12), `anti-slop/audit-003` (12).

---

## 1. Ringkasan Eksekutif

Ke-41 temuan ternyata berakar pada **10 paket perbaikan**, bukan 41 pekerjaan terpisah. Enam paket pertama menutup 31 temuan. Penemuan paling menentukan dalam audit kolateral ini: **dashboard tidak punya satu pun test UI** (0 file test, tanpa konfigurasi vitest/jest), sehingga setiap perbaikan visual atau aksesibilitas punya deteksi regresi mendekati nol. Itu yang membuat skor Detection (D) tinggi di hampir semua paket, bukan besarnya perubahan.

Dua risiko kolateral terbesar: (a) mengaktifkan gerbang desain di CI akan **mematikan pipeline seketika** karena gerbang itu sekarang merah, dan (b) memperbaiki halaman `layanan.html` menyentuh jalur atribusi klik Meta, sehingga kesalahan kecil bisa menghilangkan jejak iklan tanpa terlihat. Keduanya butuh urutan bertahap, bukan sekali jalan.

Rekomendasi utama: bangun **tiga jaring pengaman berbasis skrip Node tanpa dependency baru** sebelum menyentuh UI, lalu kerjakan paket sesuai urutan dependensi di Bagian 5.

---

## 2. Register Konsolidasi 41 Temuan

Kolom **Sumber**: `001` = audit horizontal pertama, `002` = vertikal, `003` = horizontal lintas area. Kolom **Paket** menunjuk paket perbaikan di Bagian 3.

| ID | Judul singkat | Sumber | Tier | Paket |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Teks putih di atas warna solid gagal kontras mode gelap | 001 | Hard Gate | P1 |
| 2 | Label login tidak terhubung ke input | 001 | Hard Gate | P3 |
| 3 | 45 modal buatan sendiri tanpa semantik dan Escape | 001 | Hard Gate | P2 |
| 4 | 70 tombol ikon tanpa nama aksesibel | 001 | Hard Gate | P2 |
| 5 | StitchShowcase publik di 4 rute | 001 | Hard Gate | P10 |
| 6 | panduan desain basi + 2 gerbang desain merah + CI tidak menjalankan | 001 | Hard Gate | P9 |
| 7 | Em dash di teks UI | 001 | Hard Gate | P8 |
| 8 | Emoji dekoratif di teks UI | 001 | Purpose | P8 |
| 9 | 62 animasi berulang | 001 | Purpose | P6 |
| 10 | 84 blur + 100 bayangan besar | 001 | Purpose | P6 |
| 11 | Tipografi tidak nyata (font tidak dimuat, 833 teks 9-10px) | 001 | Purpose | P5 |
| 12 | Hierarki terbalik pada layar utama | 001 | Quality | P7 |
| 13 | Tidak ada primitif state bersama | 001 | Hard Gate | P4 |
| 14 | Target sentuh 38px | 001 | Hard Gate | P5 |
| 15 | Gradien teks dan CSS mati | 001 | Purpose | P6 |
| 16 | Brand tertanam di artefak build (index.html, manifest, brand.ts) | 001 | Quality | P10 |
| 17 | Satu tabel dipaksa 1240px | 001 | Quality | P7 |
| V-01 | `lang="en"` pada aplikasi Indonesia | 002 | Hard Gate | P8 |
| V-02 | Validasi form hanya toast, berurutan, tanpa ikatan field | 002 | Hard Gate | P3 |
| V-03 | Label tidak terhubung di form terbesar | 002 | Hard Gate | P3 |
| V-04 | Loading spinner tanpa ruang cadangan | 002 | Hard Gate | P4 |
| V-05 | Ketikan konfigurasi bisa hilang | 002 | Quality | P6 |
| V-06 | Tanggal tanpa zona waktu di 54 tempat | 002 | Quality | P7 |
| V-07 | Konflik z-index (18 nilai ajaib) | 002 | Purpose | P2 |
| V-08 | Halaman baru membuka di posisi scroll lama | 002 | Quality | P6 |
| V-09 | Format uang tidak seragam | 002 | Quality | P7 |
| V-10 | Istilah tidak kanonik (Pasien/Customer/Pelanggan) | 002 | Quality | P7 |
| V-11 | Menu aktif tanpa `aria-current` | 002 | Hard Gate | P8 |
| V-12 | Indikator boot tanpa peran aksesibilitas | 002 | Hard Gate | P8 |
| X-01 | Katalog dan tarif ongkir hardcoded di `layanan.html` | 003 | Hard Gate | P10 |
| X-02 | Tiga sistem tipografi di halaman publik | 003 | Purpose | P5 |
| X-03 | Halaman publik tanpa OG/JSON-LD/canonical | 003 | Purpose | P9 |
| X-04 | 18 dari 30 halaman tanpa `h1` | 003 | Hard Gate | P4 |
| X-05 | Cakupan state daftar tidak merata | 003 | Hard Gate | P4 |
| X-06 | 0 dari 30 halaman memakai `Modal` bersama | 003 | Hard Gate | P2 |
| X-07 | Izin hanya di level rute, bukan aksi | 003 | Quality | P10 |
| X-08 | Aksesibilitas halaman publik tidak merata + tautan mati | 003 | Hard Gate | P9 |
| X-09 | 99 catch kosong, tanpa kontrak error | 003 | Quality | P1 |
| X-10 | Filter tidak tersimpan di URL | 003 | Quality | P6 |
| X-11 | `prefers-reduced-motion` hanya di sebagian permukaan | 003 | Purpose | P6 |
| X-12 | Em dash dan emoji di teks publik | 003 | Hard Gate | P8 |

---

## 3. Sepuluh Paket Perbaikan

| Paket | Isi | Menutup | Titik yang disentuh |
| :--- | :--- | :--- | :--- |
| P1 | Fondasi token & kontrak error | 1, X-09 | 110 situs `text-white` di 40 file; 99 catch di 12 file utama |
| P2 | Modal & dialog bersama | 3, 4, V-07, X-06 | 45 file overlay, 70 tombol ikon, 18 nilai z-index |
| P3 | Form: label + validasi terpusat | 2, V-02, V-03 | 4 file form utama, 331 toast error, 30 halaman dengan submit |
| P4 | Header halaman + state + daftar bersama | 13, V-04, X-04, X-05 | 30 halaman, 4 daftar besar |
| P5 | Tipografi & ukuran sentuh | 11, 14, X-02 | `index.css`, `tailwind.config.js`, 3 halaman publik, 833 teks mikro |
| P6 | Motion, elevasi, dan state navigasi | 9, 10, 15, V-05, V-08, X-10, X-11 | 62 animasi, 84 blur, 1 layout, 13 panel Settings, 6 file URL state |
| P7 | Format data kanonik (tanggal, uang, istilah) | 12, 17, V-06, V-09, V-10 | 54 panggilan tanggal, 27 format uang, 1 tabel 1240px, ~300 label |
| P8 | Bahasa dokumen & teks | 7, 8, V-01, V-11, V-12 | `index.html`, 123 baris em dash, 395 baris emoji, 27 menu nav, 1 bilah boot |
| P9 | Metadata publik + gerbang mutu | 6, X-03, X-08 | 3 halaman publik, `design.md`, `ci.yml`, 2 skrip gerbang |
| P10 | Data bisnis & otorisasi | 5, 16, X-01, X-07 | `build_landing.js`, `services_custom.json`, `layanan.html`, `index.html`, `manifest.json`, 4 rute, 1 matriks izin |

---

## 4. Audit Collateral Damage per Paket

Format tiap paket: **blast radius**, **dependensi**, **risiko regresi dan deteksinya**, **FMEA**, **pre-mortem**, **rollback**, **dampak bila dibiarkan**.

### P1. Fondasi token & kontrak error

- **Blast radius:** 40 file komponen, semua tombol dan chip dengan latar solid di mode gelap. Pengguna yang terkena: seluruh admin dan terapis yang memakai tema gelap. Perubahan hanya di kelas warna, bukan struktur.
- **Dependensi:** tidak ada. Paling aman dikerjakan paling awal. Menjadi prasyarat P2 karena migrasi modal juga menyentuh warna tombol.
- **Risiko regresi:** teks yang tadinya putih di latar terang (mis. tombol di atas banner kuning) bisa berubah jadi gelap dan menghilang. Deteksi saat ini: **nol otomatis**, karena tidak ada test UI dan gerbang token hanya memeriksa hex, bukan pasangan teks/latar. Cara deteksi yang harus dibangun dulu: skrip Node yang membaca token dan menghitung kontras untuk setiap pasangan `bg-*` + `text-*` yang muncul berdampingan, tanpa dependency baru.
- **FMEA:** S5 × O6 × D7 = **210**
- **Pre-mortem:** perbaikan gagal karena ada 110 situs dan 8 di antaranya memakai latar `bg-white/10` di atas header gelap; mengganti ke `text-on-solid` membuat teks nyaris tak terlihat di header yang justru butuh putih. Mitigasi: pisahkan dua kelompok, permukaan solid token (pakai `on-solid`) dan permukaan kaca/transparan (tetap putih), dan jangan lakukan penggantian massal dengan satu regex.
- **Rollback:** murni kelas CSS, `git revert` satu commit per kelompok.
- **Bila dibiarkan:** kegagalan WCAG berlanjut di semua tema gelap; ini temuan yang paling mungkin terlihat oleh pengguna dan paling sulit dibela.

### P2. Modal & dialog bersama

- **Blast radius:** 45 file overlay, seluruh alur yang punya dialog (reservasi, invoice, chat, peta, pelanggan, pengaturan). Ini paket dengan permukaan terluas setelah P3.
- **Dependensi:** butuh P1 selesai (warna) dan skala z-index diputuskan **sebelum** migrasi, bukan sesudah. Jika z-index diubah setelah migrasi, dua variabel berubah bersamaan dan regresi sulit dilacak.
- **Risiko regresi:** modal bersarang (dialog konfirmasi di atas modal invoice), drawer bawah di mobile, `body scroll lock` ganda yang membuat halaman tidak bisa digulir setelah modal ditutup, dan portal yang salah urutan. Deteksi: tanpa test, wajib uji manual 5 kombinasi (modal + konfirmasi, modal + toast, modal + penampil media, modal + sidebar, modal + copilot). Uji ini yang harus dicatat sebagai bukti, bukan diklaim.
- **FMEA:** S6 × O6 × D7 = **252** (tertinggi kedua)
- **Pre-mortem:** migrasi massal 45 file dalam satu commit; satu modal punya perilaku khusus (mis. `CreateReservationModal` mengunci scroll dan mengatur tinggi sendiri) sehingga setelah migrasi formulir reservasi tidak bisa digulir di iPhone. Mitigasi: migrasi **per modul**, mulai dari 5 modal yang paling sederhana, dan biarkan `CreateReservationModal` paling akhir karena paling kaya kekhususan.
- **Rollback:** per file, karena setiap migrasi harus commit sendiri. Modal lama tetap ada sampai modul terakhir dimigrasikan (pola strangler).
- **Bila dibiarkan:** cacat aksesibilitas terus berulang setiap ada modal baru, dan jumlahnya bertambah, bukan berkurang.

### P3. Form: label dan validasi terpusat

- **Blast radius:** 331 pemanggilan toast error, 30 halaman dengan tombol submit. Perubahan menyentuh alur kerja harian admin CS dan terapis. Ini paket dengan **risiko operasional tertinggi** karena mengubah cara orang menyelesaikan pekerjaan.
- **Dependensi:** butuh P4 untuk wadah ringkasan error (komponen state), dan P1 untuk warna error.
- **Risiko regresi:** validasi yang tadinya berurutan bisa jadi terlalu ketat dan memblokir alur yang dulu lolos (mis. reservasi tanpa layanan tambahan yang sah). Deteksi: tidak ada test, jadi wajib membuat test unit validator lebih dulu (ini yang paling layak dites karena murni logika, tanpa DOM). Test unit bisa memakai vitest yang sudah ada di root, tanpa dependency baru.
- **FMEA:** S6 × O7 × D6 = **252**
- **Pre-mortem:** validator baru menolak kombinasi yang sebenarnya sah (mis. paket bundle tanpa layanan utama) sehingga admin tidak bisa menyimpan reservasi, tepat saat klinik ramai. Mitigasi: tulis test dari **data reservasi nyata** (ambil 20 contoh dari DB atau log), jalankan validator baru terhadap data itu, dan wajib 100 persen lolos sebelum mengganti handler.
- **Rollback:** pertahankan handler lama di balik flag sementara (`USE_NEW_VALIDATOR`), cara termurah untuk kembali tanpa revert besar.
- **Bila dibiarkan:** admin tetap menekan Simpan berulang, error tetap tidak terbaca pembaca layar, dan setiap form baru mengulang pola yang sama.

### P4. Header halaman, state, dan daftar bersama

- **Blast radius:** 30 halaman untuk `PageHeader`, 4 daftar besar untuk `DataList`. Perubahan struktur DOM bisa menggeser layout dan mengubah tinggi halaman.
- **Dependensi:** `DataList` bergantung pada P1 (warna) dan P3 (pola error). `PageHeader` bisa jalan mandiri dan paling aman dimulai lebih dulu.
- **Risiko regresi:** menambah `h1` bisa menghasilkan dua `h1` pada 12 halaman yang sudah punya, dan `DataList` bisa memotong fitur khusus yang sudah ada (seleksi massal, grup per tanggal). Deteksi: hitungan `h1` per rute bisa diperiksa otomatis; fitur khusus hanya bisa dicek manual.
- **FMEA:** S4 × O6 × D6 = **144**
- **Pre-mortem:** `DataList` dipaksakan ke `TodayTreatments` yang punya pengelompokan per status dan aksi massal, sehingga fitur itu hilang tanpa disadari. Mitigasi: `DataList` hanya untuk daftar datar; halaman dengan pengelompokan khusus tetap memakai pola sendiri tetapi memakai `PageHeader` dan `EmptyState`.
- **Rollback:** komponen baru bersifat aditif, halaman bisa dikembalikan satu per satu.
- **Bila dibiarkan:** setiap halaman baru terus menambah variasi loading, kosong, dan error.

### P5. Tipografi dan ukuran sentuh

- **Blast radius:** seluruh permukaan (dashboard, portal, 3 halaman publik). Perubahan font menggeser metrik semua teks; perubahan target sentuh menggeser semua tata letak padat.
- **Dependensi:** harus **sesudah** P4 (struktur) dan **tidak bersamaan** dengan P7 (format data), karena keduanya mengubah lebar teks dan bisa menimbulkan overflow yang sulit dilacak.
- **Risiko regresi:** font baru bisa memperlebar label sehingga tombol terpotong di 360px; menaikkan target sentuh ke 44px di tabel akan membuat baris jauh lebih tinggi dan tabel jadi tidak nyaman di desktop. Deteksi: cek visual di 360, 768, 1440; tidak ada otomatis.
- **FMEA:** S4 × O7 × D6 = **168**
- **Pre-mortem:** memuat font web baru menambah permintaan jaringan; di jaringan klinik yang lambat, teks berkedip dari font sistem ke font web di setiap halaman. Mitigasi: `font-display: swap` dan preload satu berkas saja, atau tetap dengan stack sistem dan hapus deklarasi yang menyesatkan.
- **Rollback:** kembalikan deklarasi font di satu berkas dan kelas ukuran di `index.css`.
- **Bila dibiarkan:** keputusan tipografi tetap tidak nyata dan teks 9px tetap ada di perangkat lapangan.

### P6. Motion, elevasi, dan state navigasi

- **Blast radius:** 62 animasi, 84 blur, `Layout.tsx` (scroll dan sebelum-unload), 13 panel Settings. Menyentuh navigasi berarti menyentuh semua halaman.
- **Dependensi:** `useDirtyGuard` butuh `useUiFeedback` yang sudah ada, jadi bisa mandiri. Scroll restore harus **sesudah** P4, karena perubahan tinggi halaman akibat header baru akan mengubah perilaku scroll.
- **Risiko regresi:** menghapus animasi bisa menghilangkan isyarat status yang penting (denyut tombol "Selesai" saat terapis tiba); `beforeunload` yang terlalu agresif membuat pengguna tidak bisa menutup tab; scroll restore bisa merusak tombol Back. Deteksi: manual, ditambah pemeriksaan bahwa tidak ada `beforeunload` aktif ketika `dirty === false`.
- **FMEA:** S4 × O5 × D6 = **120**
- **Pre-mortem:** dirty guard dipasang di semua form; admin yang hanya membuka Settings lalu menutup tab tanpa mengubah apa pun tetap mendapat peringatan, sehingga ia mengabaikan semua peringatan berikutnya. Mitigasi: hanya aktif bila nilai benar-benar berbeda dari baseline awal.
- **Rollback:** hook bisa dimatikan per halaman lewat prop; animasi dikembalikan per kelas.
- **Bila dibiarkan:** admin tetap kehilangan ketikan panjang, dan halaman tetap terbuka di tengah gulir.

### P7. Format data kanonik (tanggal, uang, istilah)

- **Blast radius:** 54 panggilan tanggal di 20 file, 27 format uang, ~300 label istilah. Semua tampilan data, termasuk jadwal klinis dan nominal pembayaran.
- **Dependensi:** wajib **sesudah** P5 (tipografi) dan **tidak bersamaan** dengan P4. Tanggal dan uang juga saling terkait karena keduanya muncul di kartu yang sama.
- **Risiko regresi:** konversi zona waktu ganda (mengubah string yang sudah WIB menjadi WIB lagi) bisa menggeser tanggal satu hari; penggantian istilah bisa bertabrakan dengan teks SOP atau pelatihan staf yang sudah dicetak. Deteksi: snapshot test per fungsi format (murni logika, bisa dites dengan vitest yang ada) dan uji perangkat dengan zona waktu non-WIB.
- **FMEA:** S6 × O5 × D7 = **210**
- **Pre-mortem:** fungsi `formatTanggalWib` dipakai pada string `YYYY-MM-DD` yang sudah tanggal lokal, sehingga `new Date('2026-11-10')` dibaca sebagai tengah malam UTC lalu ditampilkan sebagai 10 November 07.00 WIB, benar; tetapi pada perangkat UTC-5 bisa tampil 9 November. Bila fungsi baru menambahkan konversi lagi, hasilnya bergeser dua kali. Mitigasi: satu fungsi, satu kontrak input (ISO dengan atau tanpa waktu), dan test untuk kedua bentuk.
- **Rollback:** per modul; snapshot test dijadikan pembanding sebelum dan sesudah.
- **Bila dibiarkan:** risiko tanggal bergeser pada perangkat non-WIB tetap ada, dan nominal tetap ditulis dengan tiga gaya berbeda.

### P8. Bahasa dokumen dan teks

- **Blast radius:** `index.html` (satu atribut), 123 baris em dash, 395 baris emoji, 27 menu, 1 bilah boot. Dampak pengguna luas tetapi risiko teknis paling rendah di seluruh daftar.
- **Dependensi:** tidak ada. Boleh dikerjakan kapan saja, termasuk bersamaan dengan paket lain, karena tidak menyentuh struktur.
- **Risiko regresi:** mengganti emoji di judul bisa menghilangkan penanda visual yang selama ini membantu staf membedakan konfirmasi bahaya (mis. ⚠️). Mitigasi: ganti dengan ikon SVG yang sama maknanya, jangan hapus tanpa pengganti pada dialog berisiko.
- **FMEA:** S2 × O9 × D2 = **36**
- **Pre-mortem:** penggantian teks massal menyentuh label yang dipakai test backend (mis. teks tombol yang dicari test integrasi). Mitigasi: cari dulu referensi string tersebut di `tests/`.
- **Rollback:** trivial.
- **Bila dibiarkan:** bahasa aplikasi tetap dinyatakan Inggris untuk pembaca layar, dan teks tetap terasa seperti hasil mesin.

### P9. Metadata publik dan gerbang mutu

- **Blast radius:** 3 halaman publik (dilihat pelanggan), `design.md`, `ci.yml`. **Mengaktifkan gerbang di CI berdampak pada seluruh alur deploy**, karena build bisa gagal.
- **Dependensi:** **harus sesudah** P1, P5, dan P10, karena gerbang yang dinyalakan sekarang akan langsung merah (293 hex, paritas dark gagal) dan memblokir semua pekerjaan lain.
- **Risiko regresi:** pipeline mati total bila baseline tidak di-ratchet; menambahkan metadata OG bisa bentrok dengan penyuntikan runtime yang sudah ada (`layanan.route.ts` hanya memproses `go.html` dan `pricelist.html`, bukan `layanan.html`).
- **FMEA:** S5 × O6 × D4 = **120**
- **Pre-mortem:** gerbang diaktifkan sebelum baseline diturunkan, CI gagal di setiap PR, tim melemahkan gerbang dengan `|| true`, dan gerbang kehilangan arti seperti sebelumnya. Mitigasi: urutan wajib, yaitu perbaiki pelanggaran, turunkan baseline (`check:tokens -- --update`), baru aktifkan CI, dan larang `|| true` pada langkah itu.
- **Rollback:** hapus satu langkah dari `ci.yml`.
- **Bila dibiarkan:** drift desain akan terus bertambah karena tidak ada penjaga.

### P10. Data bisnis dan otorisasi

- **Blast radius:** `scripts/build_landing.js` (1387 baris), `services_custom.json` (22,7 KB, terakhir diubah 19 Oktober 2026), `src/landing/public/layanan.html` (89 KB), `index.html`, `manifest.json`, 4 rute showcase, dan matriks izin aksi. Termasuk **halaman yang dilihat pelanggan dan jalur atribusi iklan Meta**.
- **Dependensi:** bagian katalog butuh keputusan pemilik produk lebih dulu (halaman ini tidak dirutekan bot; lihat catatan di bawah). Bagian showcase bisa dikerjakan mandiri. Bagian izin butuh matriks izin backend.
- **Risiko regresi:** perubahan pada `layanan.html` atau `go.html` bisa memutus `clientParamBuilder.bundle.js`, `external-tracker.js`, dan pencatatan klik yang dipakai Meta CAPI. Menghapus `/stitch-preview` bisa memutus tautan internal yang masih dipakai tim desain. Menyembunyikan tombol berdasarkan izin bisa mematikan alur kerja admin CS yang sebenarnya sah.
- **FMEA:** S7 × O6 × D8 = **336** (tertinggi di seluruh 10 paket)
- **Pre-mortem:** katalog dipindah ke runtime, tetapi `layanan.html` ternyata dilayani host statis eksternal, sehingga perubahan di repo tidak pernah sampai ke pelanggan; atau sebaliknya, halaman berubah tetapi CSP nonce tidak diterapkan sehingga skrip diblokir dan tombol pesan WhatsApp mati di halaman yang sedang dipakai iklan berbayar. Mitigasi: **verifikasi lebih dulu** bagaimana `layanan.html` sampai ke pelanggan (rutekan lewat bot seperti pricelist, atau host statis?), dan jangan mengubah `go.html` tanpa uji ulang pelacakan klik.
- **Rollback:** simpan artefak lama; karena `layanan.html` adalah hasil generator, rollback cukup menjalankan ulang generator versi lama.
- **Bila dibiarkan:** harga di halaman publik bisa berbeda dari harga yang ditagih bot, dan ini satu-satunya temuan yang berpotensi menjadi keluhan pelanggan langsung.

**Catatan verifikasi penting untuk P10 (bukti baru):**
- `layanan.html` **tidak dirutekan** oleh `src/routes/landing.route.ts`; yang dirutekan hanya `/go`, `/pricelist.html`, `/promo/:slug`, dan `/assets/:filename`.
- File itu dihasilkan `scripts/build_landing.js` dari `services_custom.json` (snapshot katalog yang di-commit), dan skrip itu **tidak ada** di `package.json` maupun CI.
- Artinya ada **tiga representasi katalog**: DB (dipakai bot dan dashboard), `services_custom.json` (snapshot 19 Oktober), dan `layanan.html` (artefak hasil generate).
- Berdasarkan temuan ini, X-01 harus direvisi dari "duplikasi harga di halaman publik" menjadi **"rantai snapshot katalog tanpa gerbang regenerasi, plus artefak publik yang tidak dirutekan"**. Tingkat keyakinan: TERBUKTI untuk struktur, [ASUMSI] untuk cara halaman itu sampai ke pelanggan.

---

## 5. Urutan Aman (dependency-ordered)

| Fase | Paket | Alasannya | Gerbang sebelum lanjut | Rollback |
| :--- | :--- | :--- | :--- | :--- |
| 0 | Jaring pengaman | Tanpa ini semua fase punya D tinggi | Tiga skrip Node lolos: kontras pasangan kelas, label tanpa `htmlFor`, tombol ikon tanpa nama. Dijalankan manual dulu, belum di CI | hapus skrip |
| 1 | P1 token & error | Menutup temuan paling terlihat, blast radius terukur, tanpa dependency | 110 situs diganti per kelompok; skrip kontras 0 pelanggaran di kedua tema; Build dashboard hijau | revert per commit |
| 2 | P8 bahasa & teks | Risiko teknis terendah, tidak menyentuh struktur, boleh paralel | `lang="id"`, 0 em dash non-komentar, emoji dekoratif 0, snapshot aksesibilitas nav dan boot | trivial |
| 3 | P2 modal & z-index | Butuh P1; menyentuh 45 file sehingga harus bertahap per modul | Skala z-index disepakati lebih dulu; 5 kombinasi modal diuji manual dan dicatat; `role`/Escape/fokus ada di semua modal yang dimigrasikan | per file, strangler |
| 4 | P4 header & state | Butuh P1; menjadi fondasi P3 dan P5 | Setiap rute tepat satu `h1`; `EmptyState` dan `ErrorState` terpasang di 4 halaman tersibuk | per halaman |
| 5 | P3 form & validasi | Butuh P3/P4; risiko operasional tertinggi | Validator baru lulus 100 persen terhadap 20 reservasi nyata; handler lama tetap ada di balik flag | flag `USE_NEW_VALIDATOR` |
| 6 | P5 tipografi & sentuh | Butuh P4; mengubah metrik teks | Uji 360/768/1440 tanpa overflow; tidak ada teks < 11px | kembalikan deklarasi |
| 7 | P6 motion & navigasi | Butuh P4 karena tinggi halaman berubah | Tidak ada `beforeunload` saat `dirty === false`; Back memulihkan posisi; denyut status live tetap ada | prop/hapus kelas |
| 8 | P7 format data | Butuh P5; snapshot test jadi pembanding | Snapshot test tanggal dan uang hijau; uji perangkat non-WIB; istilah sesuai glosarium | per modul |
| 9 | P10 data bisnis & izin | Butuh keputusan pemilik produk dan verifikasi jalur hosting | Verifikasi cara halaman sampai ke pelanggan; pelacakan klik Meta diuji ulang; izin aksi dicocokkan dengan backend | artefak lama + generator lama |
| 10 | P9 metadata & CI | **Harus paling akhir**, setelah baseline turun | `check:design` hijau dua kali berturut-turut sebelum masuk CI; tanpa `|| true` | hapus langkah CI |

---

## 6. Larangan Kombinasi (konflik antar paket)

1. **P2 (modal) + P2 (z-index) dalam satu commit:** dua variabel berubah, regresi tidak bisa dilacak. Pisahkan: skala dulu, migrasi kemudian.
2. **P5 (tipografi) bersamaan P7 (format data):** keduanya mengubah lebar teks; overflow yang muncul tidak bisa diatribusikan.
3. **P4 (struktur header) bersamaan P6 (scroll restore):** perubahan tinggi halaman mengubah perilaku scroll, sehingga bug scroll tidak bisa dipisahkan dari bug layout.
4. **P9 (gerbang CI) sebelum P1/P5/P10:** pipeline akan merah dan mendorong orang memakai `|| true`, persis pola yang membuat gerbang sekarang tidak berjalan.
5. **P10 (katalog) bersamaan P9 (metadata):** keduanya menyentuh `<head>` halaman publik dan penyuntikan runtime, sehingga bentrok nonce/CSP sulit dipisahkan.

---

## 7. Jaring Pengaman yang Disarankan (tanpa dependency baru)

Ketiga skrip mengikuti pola yang sudah ada di repo (`scripts/check-design-tokens.mjs`), memakai Node saja.

1. **`scripts/check-a11y-strings.mjs`**: menolak `<label>` tanpa `htmlFor`, `<button>` berisi hanya ikon tanpa `aria-label`, `<div onClick>` tanpa `role`, `outline-none` tanpa pengganti fokus, `aria-current` hilang pada nav aktif.
2. **`scripts/check-contrast-pairs.mjs`**: membaca token dari `src/index.css`, lalu memeriksa setiap baris kelas yang memuat `bg-(accent|success|danger|warning|info|violet)` bersama `text-white`, dan melaporkan rasio kontras untuk kedua tema.
3. **`scripts/check-catalog-sync.mjs`**: membandingkan jumlah dan harga di `services_custom.json` dengan hasil query DB (bila `DATABASE_URL` tersedia), dan memeriksa bahwa `layanan.html` cocok dengan hasil generator. Bila tidak tersedia, cukup memeriksa waktu ubah berkas dan memberi peringatan.

Perkiraan: ketiganya menutup penyebab D tinggi pada P1, P2, P3, dan P10, dan bisa dijalankan manual sebelum ada keputusan untuk memasukkannya ke CI.

---

## 8. Ringkasan FMEA per Paket

| Paket | S | O | D | RPN | Peringkat |
| :--- | --: | --: | --: | --: | --: |
| P10 data bisnis & izin | 7 | 6 | 8 | **336** | 1 |
| P2 modal & dialog | 6 | 6 | 7 | **252** | 2 |
| P3 form & validasi | 6 | 7 | 6 | **252** | 2 |
| P1 token & error | 5 | 6 | 7 | **210** | 4 |
| P7 format data | 6 | 5 | 7 | **210** | 4 |
| P5 tipografi & sentuh | 4 | 7 | 6 | **168** | 6 |
| P4 header & state | 4 | 6 | 6 | **144** | 7 |
| P6 motion & navigasi | 4 | 5 | 6 | **120** | 8 |
| P9 metadata & CI | 5 | 6 | 4 | **120** | 8 |
| P8 bahasa & teks | 2 | 9 | 2 | **36** | 10 |

Urutan pengerjaan **tidak** mengikuti RPN, melainkan **dependensi dan risiko deploy**. P10 punya RPN tertinggi tetapi dikerjakan setelah P1, P4, P5 karena butuh fondasi dan keputusan pemilik produk. P8 punya RPN terendah tetapi dikerjakan di fase 2 karena murah dan tidak menghalangi apa pun.

---

## 9. Verifikasi per Paket

| Paket | Cara membuktikan beres | Cara membuktikan tidak ada regresi baru |
| :--- | :--- | :--- |
| P1 | Skrip kontras 0 pelanggaran di terang dan gelap; Lighthouse login tanpa `color-contrast` | Bandingkan tangkapan layar 4 halaman tersibuk sebelum/sesudah di kedua tema |
| P2 | Uji Tab/Shift+Tab/Escape pada 5 kombinasi modal, dicatat per elemen | Hitung overlay manual turun; tidak ada scroll terkunci setelah modal ditutup |
| P3 | Validator lulus 20 reservasi nyata; semua pesan muncul dalam satu tekan | Reservasi baru, edit, dan batal di staging; tidak ada alur yang dulu sah jadi terblokir |
| P4 | Setiap rute tepat satu `h1`; 4 halaman punya tiga state | Halaman dengan pengelompokan khusus tidak kehilangan fitur |
| P5 | Tidak ada teks < 11px; target sentuh aksi utama 44px | Uji 360/768/1440 tanpa overflow horizontal |
| P6 | Tidak ada `beforeunload` saat tidak ada perubahan; Back memulihkan posisi | Denyut status live tetap berfungsi; tab Settings tidak kehilangan draft |
| P7 | Snapshot test tanggal/uang hijau; uji perangkat zona non-WIB | Jadwal yang tampil di dashboard sama dengan yang dihitung bot |
| P8 | `lang="id"`; 0 em dash non-komentar; emoji dekoratif 0 | Test integrasi yang mencari teks tombol tetap hijau |
| P9 | OG terlihat di pratinjau WhatsApp; JSON-LD lolos Rich Results | `check:design` hijau dua kali berturut-turut; deploy tidak berubah |
| P10 | Harga landing sama dengan harga bot; klik Meta tetap tercatat | Bandingkan atribusi sebelum/sesudah perubahan halaman |

---

## 10. Batasan & Asumsi

- **Celah cakupan:** tidak ada klik-tembus dengan kredensial, sehingga seluruh verifikasi di Bagian 9 adalah rencana, bukan hasil.
- **Tidak ada test UI** di `packages/admin-dashboard` (0 file test, tanpa konfigurasi). Ini fakta yang mendasari seluruh skor D.
- **[ASUMSI] P10:** cara `layanan.html` sampai ke pelanggan belum diketahui (tidak dirutekan bot). Dua kemungkinan: host statis eksternal, atau halaman tidak dipakai lagi. Ini harus dipastikan sebelum paket dijalankan.
- **[ASUMSI] P3:** backend saat ini menerima reservasi tanpa layanan utama dalam kondisi tertentu (paket bundle). Validator baru wajib diuji terhadap data nyata sebelum dipakai.
- **[ASUMSI] P7:** dampak tanggal bergeser hanya muncul pada perangkat non-WIB; belum direproduksi.
- **Tidak ada klaim performa:** Web Vitals belum diukur.
- **Tidak ada perubahan kode:** seluruh dokumen ini rencana, dan tetap menunggu persetujuan eksplisit sebelum eksekusi.
