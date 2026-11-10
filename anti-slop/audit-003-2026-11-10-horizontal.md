# Audit 003: Horizontal (Lintas Area) UI/UX

- **Tanggal:** 2026-11-10
- **Jenis audit:** horizontal (Tahap 3 `audit-sistem-berlapis`), melengkapi `audit-001` (pemindaian slop) dan `audit-002` (vertikal per alur)
- **Framework:** ISO 25010 (usability, accessibility, consistency) + ISO 19011 (tata cara audit) + FMEA untuk prioritas
- **Metode:** 30 halaman dashboard + 3 halaman publik dinilai dengan **kriteria yang sama**, lalu diperiksa dengan hitungan otomatis. Tabel matriks di bawah adalah bukti mentahnya.
- **Mode:** baca-saja. Tidak ada file kode, test, CSS, atau HTML yang diubah.

---

## 1. Ringkasan Eksekutif

Audit horizontal menemukan **12 pola lintas area** yang tidak terlihat saat memeriksa satu halaman. Tiga yang paling berbahaya: (a) katalog dan tarif ongkir **diduplikasi hardcoded** di halaman publik `layanan.html`, padahal dashboard dan bot membaca database, (b) halaman publik punya **tiga sistem tipografi berbeda** dan satu di antaranya fontnya tidak pernah dimuat, (c) **izin hanya dijaga di level rute**, bukan level aksi, sehingga tombol yang tidak berhak tetap tampil. Cakupan state juga tidak merata: paginasi hanya ada di 5 dari 30 halaman, skeleton di 3 dari 30.

Satu catatan kejujuran: **tidak ada satu pun halaman dashboard yang memakai komponen `Modal` bersama** (0 dari 30). Ini menjelaskan mengapa temuan modal di audit sebelumnya menyebar ke 45 file.

---

## 2. Cakupan & Celah Cakupan

**Diperiksa dengan kriteria sama:**

- 30 halaman dashboard (`packages/admin-dashboard/src/pages/**`), termasuk 2 halaman login dan portal terapis.
- 3 halaman publik (`src/landing/public/`): `go.html`, `layanan.html`, `pricelist.html`.
- 13 panel Settings, komponen `ui/*` dan `common/*` sebagai pembanding.

**Di luar cakupan:**

- Aplikasi tidak dibuka dengan kredensial, jadi tidak ada klik-tembus. Semua temuan berasal dari kode, hitungan otomatis, DOM halaman login, dan Lighthouse.
- Halaman yang dilayani backend di luar `src/landing/public` tidak ada.

---

## 3. Matriks Cakupan 30 Halaman

Kolom: **L** = loading state, **E** = empty state, **R** = error state, **S** = pencarian, **P** = paginasi, **M** = modal bersama, **H1** = jumlah `h1`.

| Halaman | Baris | L | E | R | S | P | M | H1 |
| :--- | ---: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Overview | 349 | ya | ya | ya | - | - | - | 0 |
| LiveChatMonitor | 1212 | ya | ya | ya | - | - | - | 1 |
| Reservations | 2285 | ya | ya | ya | ya | ya | - | 0 |
| TodayTreatments | 2483 | ya | ya | ya | ya | - | - | 1 |
| CustomerDatabase | 1735 | ya | ya | ya | ya | ya | - | 1 |
| CustomerLabels | 441 | ya | ya | ya | - | - | - | 1 |
| CustomerService | 365 | ya | **tidak** | ya | - | - | - | 0 |
| ClinicServices | 1384 | ya | ya | ya | ya | - | - | 1 |
| DeliveryTiers | 374 | ya | ya | ya | - | - | - | 0 |
| FollowUpQueue | 1583 | ya | ya | ya | ya | ya | - | 1 |
| FollowUpTemplates | 643 | ya | ya | ya | ya | - | - | 0 |
| KnowledgeBase | 1271 | ya | ya | ya | ya | - | - | 0 |
| QuickReplies | 725 | ya | ya | ya | ya | - | - | 0 |
| FinancialAnalytics | 1084 | ya | ya | ya | ya | - | - | 1 |
| Settings | 1273 | ya | **tidak** | ya | - | - | - | 0 |
| StaffManagement | 1636 | ya | ya | ya | ya | - | - | 1 |
| AiPersona | 1196 | ya | ya | ya | ya | - | - | 1 |
| AiSandbox | 1167 | ya | ya | ya | - | - | - | 0 |
| AiEvaluations | 471 | ya | ya | ya | - | - | - | 0 |
| LandingPage | 757 | ya | ya | ya | - | - | - | 0 |
| MetaClickCatcher | 1410 | ya | ya | ya | ya | ya | - | 0 |
| MetaCapiQueue | 1373 | ya | ya | ya | ya | - | - | 0 |
| TelegramIntegration | 433 | ya | ya | ya | ya | - | - | 1 |
| ChatExport | 275 | ya | ya | ya | - | - | - | 0 |
| ChatMigration | 862 | ya | ya | ya | ya | ya | - | 1 |
| Debug | 1470 | ya | ya | ya | ya | - | - | 0 |
| StaffToday | 6481 | ya | ya | ya | ya | - | - | 1 |
| StaffSchedule | 14 | proxy | proxy | proxy | proxy | proxy | proxy | proxy |
| Login | 117 | ya | n/a | ya | - | - | - | 0 |
| StaffLogin | 113 | ya | n/a | ya | - | - | - | 0 |

**Rekap:** loading 29/30 (skeleton hanya 3), empty 25/30, error 29/30, pencarian 17/30, paginasi 5/30, modal bersama **0/30**, h1 hanya 12/30.

---

## 4. Temuan Horizontal

### X-01. Katalog layanan dan tarif ongkir diduplikasi hardcoded di halaman publik
- **Lokasi:** `src/landing/public/layanan.html:818` (`const CLINIC_SERVICES = [...]`, 39 layanan lengkap dengan `originalPrice`, `promoPrice`, `durationMinutes`) dan `:1885-1910` (fungsi tarif ongkir per km + teks promo diskon).
- **Bukti:** file berisi **0 placeholder** runtime (`__...__`), artinya tidak ada penyuntikan data dari server. Bandingkan: `go.html` punya 12 placeholder, `pricelist.html` mengambil `/api/pricelist`. Dashboard `ClinicServices.tsx` dan `DeliveryTiers.tsx` membaca API. Jadi ada **dua sumber kebenaran** untuk harga dan ongkir.
- **Keyakinan:** TERBUKTI
- **Akar masalah (5 Whys):** pelanggan bisa melihat harga yang berbeda dari yang dihitung bot → karena halaman publik menyimpan salinan katalog sendiri → karena `layanan.html` dibuat sebagai file statis sekali jadi, bukan dirender dari DB → karena hanya `go.html` dan `pricelist.html` yang dibangun sebagai template → karena tidak ada gerbang yang memeriksa duplikasi data bisnis di luar TS.
- **Risiko:** pelanggan melihat "Rp 25.000" di landing lalu bot menagih harga lain, atau sebaliknya. Ini menyentuh uang dan kepercayaan, serta melanggar mandat Non-Hardcode di AGENTS.md.
- **FMEA:** S7 × O7 × D9 = **441** (tertinggi di seluruh tiga audit)
- **Dampak samping:** memindahkan katalog ke API mengubah cara halaman dilayani (dari statis menjadi template). Risiko: cache/CDN dan jalur Meta Pixel di halaman yang sama. Mitigasi: sajikan katalog lewat endpoint yang sudah ada (`/api/pricelist`) seperti `pricelist.html`, dan pertahankan fallback statis yang ditandai jelas sebagai fallback.
- **Rekomendasi:** jadikan `layanan.html` template dengan placeholder yang sama seperti `go.html`, isi dari DB treatment dan tier ongkir; hapus `CLINIC_SERVICES` dan fungsi tarif manual.
- **Verifikasi:** ubah satu harga di dashboard, buka `layanan.html`, harga harus ikut berubah dalam satu siklus tanpa deploy. Uji juga tier ongkir km 3, 7, 12, 22, 27.

### X-02. Tiga sistem tipografi berbeda di halaman publik, satu di antaranya tidak pernah dimuat
- **Lokasi:** `go.html` (Outfit), `layanan.html` (`'Plus Jakarta Sans'` dengan **0** tautan font), `pricelist.html` (Fredoka + Nunito), dashboard (stack sistem, tanpa font yang dimuat).
- **Bukti:** hasil pindai: `layanan.html` 0 `<link>` ke Google Fonts dan 0 file CSS eksternal; `document.fonts` di dashboard kosong (0 font).
- **Keyakinan:** TERBUKTI
- **Akar masalah:** setiap halaman dibuat pada waktu berbeda tanpa token tipografi bersama → karena brand tidak punya satu berkas arah desain yang dipakai lintas permukaan (`design.md` hanya membahas warna) → karena halaman publik dan dashboard dikelola terpisah.
- **Risiko:** pelanggan melihat tiga kepribadian visual berbeda dalam satu perjalanan (iklan → landing → pricelist → panel admin). Ini melemahkan R-20 dan R-31.
- **FMEA:** S4 × O9 × D3 = **108**
- **Dampak samping:** mengganti font mengubah metrik teks dan bisa memicu overflow pada kartu harga. Mitigasi: uji di 360px dan 1440px setelah penggantian.
- **Rekomendasi:** satu keluarga font (atau satu stack sistem yang dinyatakan resmi), dipakai di 4 permukaan; hapus deklarasi `Plus Jakarta Sans` bila tidak dimuat.
- **Verifikasi:** `document.fonts` terisi di setiap permukaan, dan tidak ada halaman yang mendeklarasikan keluarga font yang tidak dimuat.

### X-03. Halaman publik tidak punya metadata berbagi maupun data terstruktur
- **Lokasi:** ketiga file di `src/landing/public/`
- **Bukti:** 0 tag `og:`/`twitter:`, 0 blok `application/ld+json`, 0 `rel="canonical"`. `go.html` juga tanpa `meta description`. Hanya `layanan.html` dan `pricelist.html` yang punya description.
- **Keyakinan:** TERBUKTI
- **Akar masalah:** halaman dibuat untuk iklan berbayar, bukan untuk dibagikan atau ditemukan → karena keberhasilan diukur dari klik iklan, bukan dari tautan organik.
- **Risiko:** tautan yang dibagikan di WhatsApp (kanal utama produk ini) tampil tanpa judul/gambar yang benar; mesin pencari tidak mendapat data klinik, layanan, dan wilayah.
- **FMEA:** S4 × O8 × D4 = **128**
- **Dampak samping:** menambah OG image perlu aset; boleh memakai logo SVG yang sudah ada (`kala-logo.svg`) sebagai gambar awal.
- **Rekomendasi:** tambah `og:title`, `og:description`, `og:image`, `og:url`, `twitter:card`, `canonical`, dan satu blok JSON-LD `MedicalClinic` (nama, alamat, jam buka, area layanan) yang diisi dari konfigurasi tenant.
- **Verifikasi:** pratinjau tautan di WhatsApp/Telegram menampilkan judul dan gambar; uji Rich Results untuk JSON-LD.

### X-04. Outline judul tidak konsisten: 18 dari 30 halaman tanpa `h1`
- **Lokasi:** 18 halaman, contoh `Overview.tsx:149` (`<h2>Overview</h2>`), `Reservations.tsx`, `Settings.tsx`, `Reservations`, `KnowledgeBase`.
- **Bukti:** matriks kolom H1 di atas; hanya 12 halaman punya `h1`.
- **Keyakinan:** TERBUKTI
- **Akar masalah:** judul halaman ditulis sebagai `h2` karena dianggap "judul di dalam layout", padahal layout tidak punya `h1` → karena tidak ada komponen `PageHeader` bersama → karena setiap halaman menyusun header sendiri.
- **Risiko:** navigasi landmark dan daftar heading pembaca layar tidak konsisten antar halaman; pengguna tunanetra tidak bisa melompat ke judul halaman.
- **FMEA:** S3 × O10 × D2 = **60**
- **Dampak samping:** mengganti `h2` menjadi `h1` bisa mengubah ukuran font bila kelas tidak disesuaikan. Mitigasi: pertahankan kelas yang sama.
- **Rekomendasi:** komponen `PageHeader` tunggal yang selalu merender `h1` dengan gaya yang sama.
- **Verifikasi:** setiap rute punya tepat satu `h1`; snapshot aksesibilitas menunjukkan satu `heading level=1`.

### X-05. Cakupan state tidak merata antar halaman
- **Lokasi:** rekap matriks
- **Bukti:** paginasi 5/30 (Reservations, CustomerDatabase, FollowUpQueue, MetaClickCatcher, ChatMigration), skeleton 3/30, pencarian 17/30, empty 25/30. Beberapa daftar besar tanpa paginasi: `KnowledgeBase` (1271 baris), `ClinicServices` (1384), `StaffManagement` (1636), `MetaCapiQueue` (1373).
- **Keyakinan:** TERBUKTI
- **Akar masalah:** setiap halaman memilih sendiri pola daftar → karena tidak ada komponen `DataList`/`DataTable` bersama yang membawa pencarian, paginasi, dan state kosong sekaligus → karena komponen `Table` hanya menyediakan markup, bukan perilaku.
- **Risiko:** pada data besar, halaman merender seluruh baris; pengguna sulit menemukan satu item, dan perangkat lapangan melambat.
- **FMEA:** S4 × O7 × D4 = **112**
- **Dampak samping:** menyeragamkan daftar menyentuh banyak halaman sekaligus. Mitigasi: mulai dari dua halaman dengan data terbesar (MetaCapiQueue, ClinicServices), ukur jumlah baris nyata dari API sebelum memutuskan paginasi server.
- **Rekomendasi:** satu `DataList` dengan kontrak `{ items, loading, error, searchable, paginated }`, diterapkan bertahap.
- **Verifikasi:** halaman dengan >200 baris tidak merender lebih dari satu halaman data; pencarian mengubah hasil; state kosong tetap muncul.

### X-06. Tidak ada halaman yang memakai komponen `Modal` bersama
- **Lokasi:** 0 dari 30 halaman; 45 file membuat overlay sendiri (bukti di audit-001)
- **Bukti:** pencarian `<Modal` di seluruh `src/pages/**` = 0 kemunculan; komponen `Modal` hanya dirujuk 1 file.
- **Keyakinan:** TERBUKTI
- **Akar masalah:** komponen bersama ada tetapi tidak pernah menjadi jalur wajib → karena tidak ada larangan membuat overlay manual → karena review tidak memeriksa hal ini dan gerbang desain tidak berjalan di CI.
- **Risiko:** setiap overlay baru mengulang cacat yang sama (tanpa Escape, tanpa `role="dialog"`, tanpa fokus awal) yang sudah terukur di audit-002.
- **FMEA:** S5 × O9 × D3 = **135**
- **Dampak samping:** migrasi 45 overlay berisiko mengubah perilaku modal yang punya kekhususan (drawer bawah di mobile, modal bersarang). Mitigasi: migrasi per modul, bukan per file, dan pertahankan varian `sheet`.
- **Rekomendasi:** perluas `Modal` dengan varian `sheet` dan `nested`, lalu jadikan satu-satunya jalan; tambahkan pemeriksaan build untuk `fixed inset-0` baru di luar komponen itu.
- **Verifikasi:** hitungan overlay manual turun bertahap; setiap modal baru punya Escape dan `role="dialog"` otomatis.

### X-07. Izin hanya dijaga di level rute, bukan level aksi
- **Lokasi:** `components/auth/ProtectedRoute.tsx`, `config/rolePermissions.ts`, `App.tsx`
- **Bukti:** prop `allowedRoles` tersedia di `ProtectedRoute` tetapi **0 rute** memakainya. Hanya 8 file menyentuh role, dan semuanya plumbing (AuthContext, Layout filter, route guard). Tidak ada komponen izin per aksi. Contoh: role `advertiser` boleh membuka `/admin/overview` dan `/admin/landing`, tetapi tombol hapus/publish di halaman itu tidak disembunyikan.
- **Keyakinan:** TERBUKTI pada kode; dampak bergantung penolakan backend → [ASUMSI] backend menolak (harus dikonfirmasi saat uji).
- **Akar masalah:** RBAC dirancang sebagai daftar path → karena kebutuhan awalnya "boleh buka halaman apa" → karena belum ada kasus yang menuntut izin lebih halus.
- **Risiko:** pengguna menekan tombol yang tidak berhak, lalu mendapat toast error; tombol mati yang tampak berfungsi (R-26).
- **FMEA:** S4 × O6 × D5 = **120**
- **Dampak samping:** menyembunyikan tombol bisa mengubah alur kerja admin CS yang selama ini mengandalkan tombol tertentu (backend mungkin mengizinkan). Mitigasi: petakan izin aksi ke backend dulu, jangan menebak.
- **Rekomendasi:** `canDo(role, 'reservation.delete')` yang memakai matriks izin backend, dipakai untuk menonaktifkan atau menyembunyikan aksi, bukan menebak dari role.
- **Verifikasi:** login sebagai `advertiser`, pastikan tidak ada aksi yang berakhir 403.

### X-08. Aksesibilitas halaman publik tidak merata, dan ada tautan mati
- **Lokasi:** `go.html`, `layanan.html`, `pricelist.html`
- **Bukti:** `layanan.html`: 5 input, 4 label, hanya 2 `label[for]`, **0 atribut `aria-*`** untuk 43 tombol. `go.html`: 0 `aria-*`, 1 `<a href="#">` (CTA WhatsApp yang `href`-nya diisi JavaScript), 1 `<img>` tanpa `alt`. `pricelist.html`: 3 `<a href="#">`, 1 gambar tanpa dimensi, tetapi justru punya 27 `aria-*` dan 6 `role`.
- **Keyakinan:** TERBUKTI
- **Akar masalah:** tiga halaman dibuat terpisah dengan standar berbeda → karena tidak ada satu basis komponen publik.
- **Risiko:** pelanggan yang memakai pembaca layar menghadapi tombol tanpa nama; bila JavaScript gagal, CTA utama `go.html` tidak mengarah ke mana pun (R-26).
- **FMEA:** S5 × O6 × D4 = **120**
- **Dampak samping:** mengubah markup CTA berisiko memutus pelacakan klik Meta. Mitigasi: pertahankan `id`, hanya isi `href` default ke `wa.me` sejak HTML.
- **Rekomendasi:** isi `href` CTA dengan tautan `wa.me` sejak HTML, beri `alt` pada gambar, ubah `href="#"` menjadi tombol nyata atau hapus, dan beri `aria-label` pada tombol ikon.
- **Verifikasi:** Lighthouse aksesibilitas pada ketiga halaman; matikan JavaScript, CTA tetap membuka WhatsApp.

### X-09. Tidak ada kontrak penanganan error: 99 catch kosong
- **Lokasi:** 12 file terbanyak: `StaffToday` (13), `CustomerMapTab` (12), `CreateReservationModal` (11), `AuthContext` (10), `LiveChatMonitor` (8), `AiSandbox` (7), `CustomerDatabase` (7).
- **Bukti:** 99 `catch {}` atau `.catch(() => {})`. Setelah diperiksa satu per satu, mayoritas **wajar** (penyimpanan lokal, pembersihan peta, telemetri, `revokeObjectURL`), tetapi beberapa menelan kegagalan data: `ensurePaymentInfo` hanya `console.warn` (`StaffToday.tsx:681`), dan `markConversationRead` sengaja *fire-and-forget* (`:964`, terdokumentasi).
- **Keyakinan:** TERBUKTI (hitungan), penilaian risiko per titik = analisis.
- **Akar masalah:** tidak ada kebijakan "error mana yang wajib sampai ke pengguna" → karena setiap pemanggilan API menangani sendiri → karena tidak ada pembungkus yang membedakan kegagalan opsional dan wajib.
- **Risiko:** kegagalan yang tidak terlihat (badge tidak padam, info pembayaran kosong) tidak pernah dilaporkan dan tidak pernah diperbaiki.
- **FMEA:** S4 × O6 × D7 = **168**
- **Dampak samping:** menampilkan semua error akan membanjiri pengguna dengan toast untuk hal sepele. Mitigasi: klasifikasikan tiga tingkat (opsional senyap, opsional dengan retry, wajib terlihat).
- **Rekomendasi:** tiga pembungkus eksplisit: `fireAndForget()`, `retrySilently(n)`, dan `mustSucceed()` yang memunculkan toast.
- **Verifikasi:** hitungan `catch {}` baru tidak bertambah; jalur uang dan status percakapan memakai `mustSucceed`.

### X-10. State filter dan tab tidak tersimpan di URL (hanya 6 file)
- **Lokasi:** 30 halaman; hanya 6 file memakai `useSearchParams` (`LiveChatMonitor`, `CustomerDatabase`, `Settings`, `Reservations` sebagian, dan 2 lainnya)
- **Bukti:** 6 dari 204 file; sisanya menyimpan filter di `useState`.
- **Keyakinan:** TERBUKTI
- **Akar masalah:** filter dianggap state komponen, bukan state halaman.
- **Risiko:** refresh menghapus filter, tombol Back tidak mengembalikan tampilan sebelumnya, dan admin tidak bisa mengirim tautan "daftar pasien yang belum lunas" ke rekan kerja.
- **FMEA:** S3 × O7 × D3 = **63**
- **Dampak samping:** menaruh filter di URL menambah entri riwayat; perlu `replace` untuk perubahan kecil.
- **Rekomendasi:** hook `useUrlState(key, default)` untuk filter/tab di halaman daftar.
- **Verifikasi:** set filter, refresh, filter tetap; salin URL ke jendela lain, hasil sama.

### X-11. `prefers-reduced-motion` hanya di sebagian permukaan
- **Lokasi:** `go.html` (0), `layanan.html` (0), `pricelist.html` (1), dashboard (ada, global)
- **Bukti:** hitungan pada tiga file.
- **Keyakinan:** TERBUKTI
- **Akar masalah:** halaman publik tidak mewarisi aturan aksesibilitas dashboard.
- **Risiko:** pengguna yang meminta gerak minimal tetap mendapat animasi di dua halaman publik.
- **FMEA:** S2 × O8 × D2 = **32**
- **Dampak samping:** nol.
- **Rekomendasi:** salin blok `@media (prefers-reduced-motion: reduce)` ke kedua halaman.
- **Verifikasi:** aktifkan reduced motion di OS, tidak ada animasi transform.

### X-12. Teks publik masih memakai em dash dan emoji hiasan
- **Lokasi:** `go.html` (em dash di `<title>`, 1 baris emoji), `layanan.html` (34 baris emoji), `pricelist.html` (18 baris emoji, mis. `🩺 Bidan ber-STR`, `🏠 Datang ke rumah`, `📍 Surabaya & Sidoarjo`)
- **Bukti:** pindai emoji/em dash per file.
- **Keyakinan:** TERBUKTI
- **Akar masalah:** sama dengan M8/M7 di audit-001, tetapi pada permukaan yang dilihat pelanggan.
- **Risiko:** nada tulisan terasa seperti konten mesin di halaman yang justru harus paling dipercaya (klaim medis, harga).
- **FMEA:** S2 × O9 × D2 = **36**
- **Dampak samping:** mengganti emoji dengan ikon SVG menambah aset; boleh memakai teks saja.
- **Rekomendasi:** ganti emoji baris kepercayaan dengan ikon SVG atau teks biasa; ganti em dash di judul.
- **Verifikasi:** hitungan emoji di tiga file = 0 untuk teks dekoratif.

---

## 5. Yang Sudah Baik (lintas area)

1. **`apiRequest` mengekstrak pesan error dengan benar** (`services/api.ts:384-400`): objek error `{code, message}` diubah jadi pesan yang bisa dibaca, bukan `[object Object]`. Ada timeout, cache, dan retry.
2. **66 dialog konfirmasi, 65 di antaranya memakai `title` + `message`** yang menjelaskan konsekuensi. Ini praktik yang jarang ada dan patut dipertahankan.
3. **Semua halaman kecuali `StaffSchedule` (proxy) punya state error**, dan `StaffSchedule` sendiri hanya meneruskan ke `StaffToday`, jadi tidak ada halaman tanpa penanganan error.
4. **Pencarian sudah ada di 17 halaman**, dan `StaffToday`, `Reservations`, `CustomerDatabase`, `MetaClickCatcher`, `FollowUpQueue` sudah memakai paginasi server.
5. **`pricelist.html` adalah contoh terbaik di repo**: mengambil data dari `/api/pricelist`, punya 27 atribut ARIA, 6 `role`, dan blok `prefers-reduced-motion`.
6. **Dashboard punya safe area, scroll lock, dan `hoverOnlyWhenSupported`** yang menunjukkan perhatian pada perangkat sentuh.

---

## 6. Urutan Perbaikan (belum dieksekusi)

| Urutan | Temuan | RPN | Kenapa duluan |
| :--- | :--- | ---: | :--- |
| 1 | X-01 katalog hardcoded | 441 | Menyentuh uang pelanggan dan melanggar mandat non-hardcode |
| 2 | X-09 kontrak error | 168 | Fondasi agar kegagalan tidak hilang sebelum memperbaiki layar lain |
| 3 | X-06 modal bersama | 135 | Menutup 45 titik cacat aksesibilitas sekaligus |
| 4 | X-03 metadata publik | 128 | Murah, langsung berpengaruh pada tautan yang dibagikan |
| 5 | X-08 aksesibilitas publik, X-07 izin aksi | 120 | Keduanya menyentuh kepercayaan dan kejelasan |
| 6 | X-05 state daftar | 112 | Butuh keputusan desain daftar bersama |
| 7 | X-02 tipografi | 108 | Butuh keputusan pemilik produk lebih dulu |
| 8 | X-04 h1, X-10 URL state, X-12 teks | 60-63 | Perbaikan konsistensi, risiko rendah |
| 9 | X-11 reduced motion | 32 | Satu blok CSS per file |

---

## 7. Batasan & Asumsi

- Tidak ada klik-tembus (butuh kredensial). `[ASUMSI] X-07`: backend benar-benar menolak aksi yang tidak berhak; belum diuji.
- `[ASUMSI] X-01`: harga di `layanan.html` saat ini mungkin masih sama dengan DB. Yang terbukti adalah **strukturnya** memungkinkan perbedaan, bukan bahwa sudah berbeda hari ini. Verifikasi butuh query DB.
- Angka matriks dihitung dari pencocokan pola teks per file, bukan dari render. Satu-dua halaman bisa salah terdeteksi (mis. state kosong yang ditulis dengan kalimat tak lazim). Sampel sudah diperiksa manual pada halaman terbesar.
- Web Vitals tidak diukur, jadi tidak ada klaim performa.
