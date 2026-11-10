# Audit 002: Vertikal (Hulu ke Hilir) UI/UX Admin Dashboard

- **Tanggal:** 2026-11-10
- **Jenis audit:** vertikal, lanjutan dari `anti-slop/audit-001-2026-11-10.md` (horizontal)
- **Framework:** ISO 19011 (tata cara audit) + ISO 25010 (kualitas produk: usability, accessibility, reliability) + FMEA untuk prioritas. Alasan: objeknya kualitas pemakaian produk lunak, bukan keamanan infrastruktur, sehingga butuh kerangka kualitas produk dan kerangka tata cara audit, bukan NIST/OWASP.
- **Mode:** baca-saja. Tidak ada file kode, test, atau CSS yang diubah.
- **Cakupan:** 6 alur berisiko tinggi dari Tahap 3 audit horizontal: Login, Live Chat, Buat Reservasi, Portal Terapis (StaffToday), Pengaturan/AiPersona, dan lapisan tampilan data (tabel, paginasi, loading).

---

## 1. Ringkasan Eksekutif

Audit horizontal menemukan pola di permukaan; audit vertikal menemukan bahwa **kegagalan yang sama berakar jauh lebih dalam dan lebih luas dari dugaan awal**. Tiga akar dominan: (a) validasi form tidak pernah menempel pada field, (b) tidak ada penjagaan state yang belum disimpan, (c) tidak ada satu sumber kebenaran untuk format tanggal, uang, dan istilah. Total **12 temuan baru**, semuanya terverifikasi kecuali dua yang ditandai. RPN tertinggi: validasi toast-only (324), kehilangan ketikan konfigurasi (210), dan tanggal tanpa zona waktu (192).

---

## 2. Status Temuan Lama (dari audit-001)

| ID | Temuan | Status di audit vertikal |
| :--- | :--- | :--- |
| H1 | Teks putih di atas warna solid gagal kontras gelap | MASIH TERBUKA, dan **terbukti lebih luas** (lihat V-03 untuk pola label) |
| H2 | Label login tidak terhubung input | MASIH TERBUKA, tidak terbatas di login (V-03) |
| H3 | 45 modal tanpa semantik dialog dan Escape | MASIH TERBUKA |
| H4 | 70 tombol ikon tanpa nama | MASIH TERBUKA |
| H5 | StitchShowcase publik | MASIH TERBUKA |
| H6 | Gerbang desain merah dan tidak dijalankan CI | MASIH TERBUKA |
| H7 | Em dash di teks UI | MASIH TERBUKA |
| M8 | Emoji dekoratif | MASIH TERBUKA |
| M9 | Animasi berulang | MASIH TERBUKA |
| M10 | Blur dan bayangan berlebih | MASIH TERBUKA, ditambah konflik z-index (V-11) |
| M11 | Tipografi | MASIH TERBUKA |
| M12 | Hierarki terbalik | MASIH TERBUKA |
| M13 | Tidak ada primitif state | MASIH TERBUKA, diperkuat V-04 |
| M14 | Target sentuh 38px | MASIH TERBUKA |
| M15 | Gradien teks mati | MASIH TERBUKA |

Tidak ada temuan lama yang bisa dinyatakan SELESAI.

---

## 3. Daftar Temuan Vertikal

### V-01. Bahasa dokumen HTML salah: `lang="en"` pada aplikasi berbahasa Indonesia
- **Lokasi:** `packages/admin-dashboard/index.html:2`
- **Bukti:** `<html lang="en">`, sementara seluruh 204 file UI, 331 pesan error, dan 42 label "WIB" berbahasa Indonesia.
- **Keyakinan:** TERBUKTI
- **Akar masalah (5 Whys):** pembaca layar salah melafalkan → karena dokumen mengaku Inggris → karena template Vite default tidak pernah diubah → karena tidak ada pemeriksaan `lang` di gerbang kualitas → karena Lighthouse hanya dijalankan manual, bukan di CI.
- **Risiko:** pengguna tunanetra mendengar pelafalan Inggris untuk kalimat Indonesia sepanjang sesi; ini menyulitkan di semua halaman sekaligus.
- **FMEA:** S5 × O10 × D1 = **50**
- **Dampak samping:** nol. Satu atribut.
- **Rekomendasi:** `lang="id"`.
- **Verifikasi:** Lighthouse `html-has-lang` dengan nilai `id`; baca satu halaman dengan VoiceOver/NVDA.

### V-02. Validasi form hanya lewat toast, berurutan, dan tidak menempel pada field
- **Lokasi:** seluruh aplikasi. Sampel paling parah: `components/calendar/CreateReservationModal.tsx:1625-1637`
- **Bukti terukur di 204 file UI:
  - 331 pemanggilan `toast(..., 'error')`
  - **1** pemakaian prop `error=` pada field (seluruh aplikasi)
  - **0** `aria-invalid`, **0** `setCustomValidity`
  - hanya 2 atribut `required` total
  - di modal reservasi, 6 validasi muncul satu per satu: "Pilih customer terlebih dahulu", "Pilih minimal 1 layanan treatment", "Pilih tanggal reservasi terlebih dahulu", "Pilih jam mulai reservasi terlebih dahulu", "Pilih tanggal kunjungan terlebih dahulu", "Pilih nama treatment kustom"
- **Keyakinan:** TERBUKTI
- **Akar masalah (5 Whys):** pengguna harus menekan Simpan berulang kali untuk tahu semua kesalahan → karena validasi dijalankan berurutan di handler submit → karena tidak ada skema validasi terpusat yang mengembalikan semua error sekaligus → karena field generik `Fields.tsx` menerima `error` tapi pemanggil tidak pernah mengisinya → karena tidak ada test yang menuntut pesan inline → karena tidak ada gerbang kualitas form.
- **Risiko:** pada form 21 field (16 input, 4 select, 1 textarea) pengguna bisa menekan Simpan 6 kali; pesan hilang setelah 4 detik sehingga pengguna lupa apa yang salah; pembaca layar tidak menerima error apa pun.
- **FMEA:** S6 × O9 × D6 = **324** (tertinggi)
- **Dampak samping:** menyentuh 331 titik. Jangan rombak sekaligus; mulai dari hasil submit handler yang mengembalikan daftar error, bukan satu.
- **Rekomendasi fondasional:** (1) buat satu `validateReservationDraft()` yang mengembalikan `{ field, message }[]`, (2) render semua pesan sekaligus sebagai ringkasan di atas form plus `aria-invalid` + `aria-describedby` per field, (3) sisakan toast hanya untuk kegagalan jaringan/server, (4) tambah `error` ke `<Input>`/`<Select>` yang sudah mendukungnya.
- **Verifikasi:** test unit pada validator (semua kombinasi kosong), test render bahwa semua pesan muncul dalam satu tekan, dan pembacaan NVDA pada form.

### V-03. Label tidak terhubung ke input bukan hanya di login, tapi di form terbesar
- **Lokasi:** `CreateReservationModal.tsx` (12 `<label>`, **0** `htmlFor`, 0 `aria-label`), `pages/staff/StaffToday.tsx` (7 label, 9 input, **0** `htmlFor`), `pages/auth/Login.tsx` dan `StaffLogin.tsx` (2/2 tanpa `htmlFor`)
- **Bukti:** hasil hitung langsung pada file; dikonfirmasi di DOM halaman login (`htmlFor: ["", ""]`, `firstInputId: ""`).
- **Keyakinan:** TERBUKTI
- **Akar masalah:** label ditulis manual sebagai `<label className=...>` bukan melalui komponen `Input` bersama (yang sudah menghasilkan `htmlFor` otomatis) → karena 93 file memakai `<button>`/markup mentah dan komponen bersama hanya dipakai sebagian → karena tidak ada larangan pemakaian elemen mentah di review.
- **Risiko:** klik label tidak memfokuskan field, dan nama field tidak diumumkan; mencakup form uang dan jadwal.
- **FMEA:** S6 × O9 × D3 = **162**
- **Dampak samping:** mengganti markup form bisa menggeser layout jika kelas lama dibuang. Mitigasi: pertahankan kelas, hanya tambah `id`/`htmlFor`.
- **Rekomendasi:** tambah `id` + `htmlFor` (murah, tanpa ubah desain), lalu migrasikan ke `<Input>` pada fase terpisah.
- **Verifikasi:** hitungan `label` tanpa `htmlFor` harus 0 pada 3 file itu; test render.

### V-04. Loading hampir selalu spinner tanpa ruang yang direservasi
- **Lokasi:** seluruh aplikasi
- **Bukti:** 204 pemakaian `animate-spin`, hanya 8 kemunculan pola skeleton. Contoh: `LiveChatMonitor.tsx:888-891` menampilkan `Loader` di tengah area kosong, `RetentionTab.tsx:562` teks "Memuat data pasien kohort..." di ruang kosong.
- **Keyakinan:** TERBUKTI (pola), DAMPAK CLS tidak diukur langsung → [ASUMSI] tinggi.
- **Akar masalah:** tidak ada komponen loading bersama (M13) → setiap halaman menulis spinner sendiri → tidak ada yang menyiapkan tinggi kontainer → konten melompat saat data datang.
- **Risiko:** di tabel panjang, baris bergeser tepat saat jari akan menekan tombol aksi; pada koneksi lambat layar terasa kosong tanpa progres.
- **FMEA:** S3 × O9 × D5 = **135**
- **Dampak samping:** menambah skeleton berarti menambah markup; risiko layout ganda jika skeleton dan data sama-sama tampil. Mitigasi: skeleton harus memakai tinggi baris yang sama dengan data.
- **Rekomendasi:** satu `SkeletonRow`/`SkeletonCard` dengan tinggi setara baris nyata, dipakai minimal di 4 halaman tersibuk.
- **Verifikasi:** ukur CLS dengan Lighthouse sebelum/sesudah pada satu halaman, dan pastikan tinggi baris skeleton = tinggi baris data.

### V-05. Ketikan konfigurasi bisa hilang tanpa peringatan
- **Lokasi:** `pages/tenant/Settings.tsx:739-1062` (render kondisional per `subTab`), `pages/tenant/AiPersona.tsx` (6 textarea, 0 `dirty`), 13 panel di `components/settings/`
- **Bukti:** `beforeunload` hanya ada di **1** file (`LiveChatMonitor.tsx:564`, untuk draft chat). `AiPersona.tsx`: 0 `dirty`, 0 `beforeunload`, 6 textarea (termasuk system prompt panjang). Ganti tab di Settings me-*unmount* panel sehingga state hilang.
- **Keyakinan:** TERBUKTI
- **Akar masalah (5 Whys):** editor konfigurasi kehilangan isi saat pindah tab → karena setiap panel menyimpan state lokal dan tidak ada peringatan → karena pola draft hanya dibangun untuk Live Chat → karena tidak ada kontrak "form panjang wajib punya dirty guard" → karena tidak ada gerbang kualitas form.
- **Risiko:** admin mengetik ulang system prompt AI atau tarif ongkir yang panjang; kesalahan konfigurasi bisa memengaruhi jawaban bot ke pasien.
- **FMEA:** S6 × O5 × D7 = **210**
- **Dampak samping:** peringatan `beforeunload` yang terlalu agresif mengganggu navigasi normal. Mitigasi: hanya aktif bila `dirty === true`.
- **Rekomendasi:** satu hook `useDirtyGuard(dirty)` yang memasang `beforeunload` + konfirmasi `useUiFeedback` saat pindah tab internal; simpan draft ke `sessionStorage` seperti pola Live Chat.
- **Verifikasi:** ketik di AiPersona, pindah tab, harus muncul konfirmasi; refresh halaman dengan perubahan, browser harus meminta konfirmasi.

### V-06. Tanggal ditampilkan tanpa zona waktu di 54 tempat, sementara aplikasi menulis "WIB" 42 kali
- **Lokasi:** contoh `CustomerProfilePanel.tsx:129`, `LiveChatCustomerModal.tsx:289`, `LiveChatMessagePane.tsx:594/765/841`, `ReservationDetailModal.tsx:98`, `CustomerDatabase.tsx:1474`, `CustomerFollowUpSection.tsx:272`
- **Bukti:** 54 pemanggilan `toLocale*String` tanpa `timeZone` berbanding 19 yang memakai `timeZone` (`src/utils/dateWib.ts` sudah benar, tetapi tidak dipakai konsisten). Pola berisiko: `new Date(booking_date).toLocaleDateString('id-ID')` untuk field tanggal.
- **Keyakinan:** TERBUKTI pada kode. Dampak nyata bergantung perangkat → [ASUMSI] muncul pada perangkat dengan zona waktu non-WIB atau pada render server UTC.
- **Akar masalah:** ada dua jalur format tanggal: util `dateWib.ts` (benar) dan pemanggilan ad-hoc di komponen → karena util itu belum dipakai sebagai satu-satunya jalan → karena tidak ada lint yang melarang `new Date(...).toLocale*` di komponen.
- **Risiko:** jadwal pasien bisa tampil bergeser satu hari pada perangkat tim yang zona waktunya bukan WIB; ini menyentuh jadwal klinis.
- **FMEA:** S6 × O4 × D8 = **192**
- **Dampak samping:** mengganti format bisa mengubah tampilan di 54 tempat sekaligus; lakukan per modul (Live Chat → Reservasi → Customer) dengan snapshot test.
- **Rekomendasi:** larang `toLocale*` di `src/components/**` lewat lint atau `check:tokens`-style gate, wajib lewat `formatTanggalWib()`.
- **Verifikasi:** set zona waktu perangkat ke `America/New_York`, buka halaman reservasi, tanggal harus tetap sama dengan WIB.

### V-07. Konflik z-index: 18 nilai ajaib sampai 999999
- **Lokasi:** contoh `MediaImage.tsx:254` (`z-[999999]`), `UiFeedback.tsx:125` (`zIndex: 99999`), `CreateReservationModal.tsx:1838` (`z-[99999]`), `LiveChatSyncModal.tsx:18` (`z-[9999]`), `Layout.tsx:487` (`z-[99999]`)
- **Bukti:** 18 pemakaian `z-[9xxx…]`/`zIndex: 99999` yang tidak mengikuti skala; urutan tampil bergantung besaran angka, bukan struktur.
- **Keyakinan:** TERBUKTI pada kode; kejadian nyata butuh reproduksi → [ASUMSI] sedang.
- **Akar masalah:** setiap komponen menaikkan angkanya sendiri saat bertabrakan → karena tidak ada skala lapisan (layer) bersama → karena tidak ada komponen portal/dialog bersama (H3).
- **Risiko:** toast tertutup modal, dialog konfirmasi di bawah overlay lain, tombol tidak bisa ditekan karena tertutup lapisan.
- **FMEA:** S5 × O4 × D8 = **160**
- **Dampak samping:** menyeragamkan z-index bisa menurunkan lapisan yang selama ini "menang" secara tidak sengaja. Mitigasi: audit visual 5 kombinasi (modal + toast, modal + media, sidebar + modal, copilot + modal, konfirmasi + modal).
- **Rekomendasi:** tetapkan 6 tingkat (`base`, `sticky`, `sidebar`, `overlay`, `dialog`, `toast`) sebagai token CSS, larang angka manual.
- **Verifikasi:** uji 5 kombinasi di atas di layar desktop dan mobile.

### V-08. Halaman baru membuka posisi scroll lama
- **Lokasi:** `components/common/Layout.tsx:471` (satu-satunya `window.scrollTo(0,0)`, khusus Live Chat)
- **Bukti:** 0 penanganan scroll pada perubahan rute (`useLocation` + scroll tidak ada; `<ScrollRestoration>` tidak dipakai karena memakai `BrowserRouter`).
- **Keyakinan:** TERBUKTI (kode); perilaku dapat dipastikan karena SPA tidak mereset scroll.
- **Akar masalah:** navigasi antar halaman tidak pernah memikirkan posisi gulir.
- **Risiko:** pengguna yang menggulir daftar pasien 2000px lalu membuka halaman lain akan mendarat di tengah halaman, mengira bagian atas tidak ada.
- **FMEA:** S3 × O8 × D4 = **96**
- **Dampak samping:** mereset scroll bisa mengganggu tombol Back (pengguna ingin kembali ke posisi semula). Mitigasi: reset hanya pada `PUSH`, pulihkan pada `POP`.
- **Rekomendasi:** komponen `ScrollToTop` yang membedakan `POP` dan `PUSH`.
- **Verifikasi:** gulir daftar pasien, buka detail, tekan Back, posisi harus pulih.

### V-09. Format uang tidak kanonik: disingkat, penuh, dan "Free" bercampur
- **Lokasi:** `LiveChatCustomerModal.tsx:22-25` (`Rp 1,5jt`, `Rp 250rb`), `CreateReservationModal.tsx:2992` (`Rp 50.000`), `:2093` (`Rp50.000` tanpa spasi), `InvoiceGeneratorModal.tsx:916` (`Free` saat ongkir 0)
- **Bukti:** 27 penggabungan `"Rp "` manual, hanya 2 pemakaian `Intl.NumberFormat`.
- **Keyakinan:** TERBUKTI
- **Akar masalah:** tidak ada satu fungsi format uang; setiap komponen memilih gayanya → karena util format belum menjadi kontrak → karena tidak ada test snapshot format.
- **Risiko:** admin salah baca nominal (1,5jt vs 1.500.000) saat mencocokkan pembayaran.
- **FMEA:** S4 × O8 × D2 = **64**
- **Dampak samping:** rendah, hanya tampilan. Risiko: singkatan "jt/rb" mungkin disukai di layar sempit; pertahankan varian singkat sebagai fungsi eksplisit.
- **Rekomendasi:** `formatRupiah(n)` (penuh, dengan spasi) dan `formatRupiahRingkas(n)` (untuk kartu sempit), plus `formatRupiah(0)` tidak boleh berubah jadi "Free" di konteks ongkir (pakai "Gratis").
- **Verifikasi:** snapshot test 0, 1.500, 1.500.000, dan nilai kosong.

### V-10. Istilah tidak kanonik: satu objek punya tiga nama
- **Lokasi:** seluruh UI, contoh `RetentionTab.tsx:332` ("Bidan / Staf"), `CreateReservationModal.tsx:2328` ("Pilih Layanan / Treatment"), `ReservationDetailModal.tsx:836` ("Penugasan Staff / Terapis")
- **Bukti hitung pada teks JSX:** Pasien 68, Pelanggan 17, Customer 28; Treatment 41, Layanan 44; Staf 7, Staff 11; Delivery 2, Ongkir 20.
- **Keyakinan:** TERBUKTI
- **Akar masalah:** tidak ada glosarium produk, dan label ditulis langsung di komponen → karena istilah tidak diambil dari satu sumber (konstanta/i18n) → karena belum ada kebutuhan multi-bahasa.
- **Risiko:** staf baru bingung apakah "customer" dan "pasien" entitas yang sama; istilah Inggris di nav (10 dari 27 modul) menambah beban.
- **FMEA:** S2 × O9 × D2 = **36**
- **Dampak samping:** mengganti label akan mengubah teks yang mungkin dirujuk SOP atau pelatihan staf; butuh satu kali keputusan pemilik produk.
- **Rekomendasi:** tetapkan glosarium (Pasien, Layanan, Terapis, Ongkir) dan ganti label bertahap per modul; nav memakai bahasa Indonesia, istilah teknis dipertahankan hanya bila memang nama produk (WAHA, CAPI).
- **Verifikasi:** hitungan istilah non-kanonik = 0 pada modul yang sudah dimigrasi.

### V-11. Menu aktif tidak diumumkan ke pembaca layar
- **Lokasi:** `Layout.tsx:638-660` (hanya kelas warna `bg-accent`), `aria-current` hanya 3 pemakaian di seluruh aplikasi untuk 27 menu
- **Bukti:** tidak ada `aria-current="page"` pada item nav aktif.
- **Keyakinan:** TERBUKTI
- **Akar masalah:** status aktif dianggap urusan visual.
- **Risiko:** pengguna keyboard/tunanetra tidak tahu halaman mana yang sedang terbuka.
- **FMEA:** S3 × O9 × D3 = **81**
- **Dampak samping:** nol.
- **Rekomendasi:** `aria-current={isActive ? 'page' : undefined}`.
- **Verifikasi:** snapshot aksesibilitas menunjukkan `current: page` pada satu item.

### V-12. Indikator boot tanpa peran dan tanpa pengumuman
- **Lokasi:** `components/common/BootProgress.tsx` (92 baris, 0 atribut `aria-*`)
- **Bukti:** bilah progres tanpa `role="progressbar"`, `aria-live`, atau teks status yang diumumkan.
- **Keyakinan:** TERBUKTI
- **Akar masalah:** indikator dianggap hiasan.
- **Risiko:** pengguna pembaca layar menunggu tanpa tahu aplikasi sedang memuat.
- **FMEA:** S2 × O10 × D2 = **40**
- **Dampak samping:** nol.
- **Rekomendasi:** `role="status"` + `aria-live="polite"` + teks tahap ("Menyiapkan sesi", "Memuat data").
- **Verifikasi:** snapshot aksesibilitas menampilkan status yang berubah.

---

## 4. Yang Sudah Baik (diverifikasi di alur vertikal)

1. **Live Chat punya state jujur dan lengkap:** label koneksi `Live` / `Reconnecting` (`LiveChatMonitor.tsx:768-771`), banner error yang spesifik, pemulihan pesan setelah reconnect (`:1202`), dan draft chat yang disimpan (`:564`).
2. **Portal Terapis menangani lapangan:** banner offline/sinyal lemah (`StaffToday.tsx:2920`), penarikan ulang pesan setelah online (`:1202`), dan konfirmasi yang menjelaskan konsekuensi sebelum menandai lunas atau menyelesaikan kunjungan (`:2039`, `:2056`, `:2066`).
3. **Anti dobel-klik pada aksi berisiko:** tombol "Selesaikan Kunjungan" dinonaktifkan selama proses (`StaffToday.tsx:3509`, `3704`), tombol simpan reservasi memakai `disabled={submitting}` (`CreateReservationModal.tsx:3152-3386`).
4. **Copilot punya pesan spesifik per kasus:** 403 "Fitur Copilot tidak tersedia", 429 "Copilot sedang memproses" (`AdminCopilotPanel.tsx:190`), plus pembatalan `AbortError`.
5. **Paginasi punya label aksesibel** (`Pagination.tsx`, `aria-label="Halaman sebelumnya"`).

---

## 5. Rencana Perbaikan Berurutan (belum dieksekusi)

| Urutan | Temuan | Alasan urutan | Rollback |
| :--- | :--- | :--- | :--- |
| 1 | V-01 `lang="id"` | 1 baris, dampak seluruh aplikasi | git revert |
| 2 | V-11 `aria-current`, V-12 status boot | 2 baris per titik, risiko nol | git revert |
| 3 | V-02 validator terpusat di modal reservasi | RPN tertinggi, tapi blast radius sedang | simpan versi lama handler |
| 4 | V-03 `id`/`htmlFor` di 3 file | murah, melengkapi V-02 | git revert |
| 5 | V-05 dirty guard + draft Settings/AiPersona | mencegah kehilangan kerja | hook bisa dimatikan via prop |
| 6 | V-06 format tanggal lewat `dateWib` per modul | risiko jadwal klinis | snapshot test sebelum/sesudah |
| 7 | V-07 skala z-index | perlu uji visual 5 kombinasi | daftar nilai lama dicatat dulu |
| 8 | V-04 skeleton, V-08 scroll restore | kenyamanan, bukan kebenaran | komponen opsional |
| 9 | V-09 format uang, V-10 glosarium | butuh keputusan pemilik produk | bertahap per modul |

Gerbang regresi tiap langkah: `npm run build` di `packages/admin-dashboard`, `npm run check:design`, plus uji manual di zona waktu non-WIB untuk langkah 6.

---

## 6. Batasan & Asumsi

- **Celah cakupan:** tidak ada klik-tembus 60 rute (butuh kredensial). Halaman yang dianalisis secara kode: Login, StaffLogin, LiveChat (monitor, pane, composer, thread list), CreateReservationModal, StaffToday, Settings + 13 panel, AiPersona, Overview, Pagination, komponen `ui/*`.
- **Belum diperiksa mendalam:** MetaClickCatcher, MetaCapiQueue, Debug, ChatMigration, ChatExport, FinancialAnalytics, CustomerMapTab, KnowledgeBase (dibaca sebagian), InvoiceGeneratorModal (sebagian).
- **[ASUMSI] V-04:** dampak CLS tidak diukur dengan Lighthouse, hanya disimpulkan dari tidak adanya ruang yang direservasi.
- **[ASUMSI] V-06:** dampak tanggal bergeser bergantung zona waktu perangkat; tidak direproduksi karena butuh login.
- **[ASUMSI] V-07:** tabrakan z-index tidak direproduksi; disimpulkan dari nilai yang saling menimpa.
- **Tidak ada klaim performa:** Web Vitals tidak diukur, jadi tidak dilaporkan.
