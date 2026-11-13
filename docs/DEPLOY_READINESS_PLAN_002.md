# Kesiapan Deploy - Plan 002 (UI/UX Lanjutan)

Tanggal: 2026-11-12
Status: **BELUM SIAP DEPLOY** - ada pekerjaan kode dan verifikasi manual yang belum selesai.

## 1. Ringkasan perubahan yang sudah selesai

| Fase | Isi | Status |
|---|---|---|
| 1 | Guard `scripts/build_pricelist.js` (`--force`) | Selesai |
| 2 | Gerbang tanggal `check-date-format.mjs` + migrasi 22 situs | Selesai |
| 3 | Kontrak error 198 -> 122 catch beralasan | Selesai |
| 5 | A11y tombol ikon + `transition-all` 176 -> 0 | Selesai |
| 6 | Filter URL di Reservations & CustomerDatabase | Selesai |
| 7 | Pemecahan berkas besar (7 berkas) | Sebagian |
| 8 | Ukur `/go` 375/412px + Lighthouse a11y 0,95 | Selesai |

## 2. Bukti gerbang terakhir

- `npx tsc --noEmit` (root): 0
- `npm run build` (root): 0
- `npx tsc --noEmit` (dashboard): 0
- `npm run build` (dashboard): 0
- `npm run check:design`: hijau (token 275, paritas dark, a11y 297, kontras, tanggal 0)
- Tes dashboard terkait: 29 lulus
- **Suite penuh (2026-11-12): 944/946 berkas lulus, 1 berkas gagal (2 tes) = `tests/unit/hybrid-reservation-parser.test.ts`, gagal pre-existing dan sudah terbukti gagal juga di checkout `HEAD` bersih (lihat `KNOWN_ISSUES` butir 301). 1 berkas di-skip. Tidak ada regresi baru.**
- **Uji browser lokal (2026-11-12):** login `local`, dev server `WAHA_MOCK=true`, DB Docker hidup.
  - Alur booking end-to-end berhasil (customer, layanan, terapis, slot, simpan; reservasi muncul di tabel).
  - Form reservasi dibuka/ditutup (Esc) tanpa error console setelah `z-[99999]`/`z-[100000]` diganti token.
  - Smoke test tanpa error console: Treatment Hari Ini, Live Chat, Customer Database, Staff Management, Follow-Up Queue, Staff Portal.
  - Temuan CSP audio `data:audio/wav` diperbaiki (`media-src` kini mengizinkan `data:`), diverifikasi console bersih.
  - Reservasi uji sudah dibatalkan (soft-cancel) agar data lokal bersih.
- Angka baris fisik (HEAD -> sekarang):
  - `StaffToday` 6.480 -> 3.822
  - `TodayTreatments` 2.482 -> 1.075
  - `Reservations` 2.284 -> 1.371
  - `LiveChatMessagePane` 1.780 -> 1.474
  - `StaffManagement` 1.635 -> 1.350
  - `FollowUpQueue` 1.635 -> 1.312
  - `CustomerDatabase` 1.719 -> 1.462

## 3. Blocker kode yang belum selesai

1. **`StaffToday` 3.708 baris** (batas 1.500). State/handler kirim/edit/tarik/retry, GPS, pembayaran, dan swipe tab masih di halaman. Hook scroll dan hook pesan sudah dipisah; hook berikutnya harus diuji dengan akun staf yang punya tugas.
2. **`CreateReservationModal` 3.462 baris.** Shell sudah dimigrasikan ke `ui/Modal` dan diuji browser end-to-end. Ukuran berkas belum turun; pemecahan form per langkah belum dikerjakan.

## 4. Verifikasi manual wajib sebelum deploy

### 4.1 Reservasi
- [ ] Filter status/terapis/pencarian bertahan setelah refresh dan tombol Back.
- [ ] Tabel desktop: sort nama/kategori/status/tanggal, pilih massal, buka detail, lihat bukti bayar.
- [ ] Kartu mobile: ketuk kartu, pilih massal, tombol di dalam kartu tidak ikut membuka detail.
- [ ] Header: navigasi tanggal, Hari Ini, ganti mode, muat ulang, buat jadwal.
- [ ] Modal edit lokasi admin: GPS, tempel shareloc, cari alamat, unggah/hapus foto, simpan.

### 4.2 Staff Today
- [ ] Hari Ini: detail, QRIS, catat bayar, salin alamat, foto rumah, update lokasi, MULAI JALAN, Sudah Sampai, Selesai, Delegasikan.
- [ ] Header chat: kembali, detail pasien, navigasi, pembayaran, OTW/tiba/selesai.
- [ ] Daftar pesan: riwayat, keadaan kosong, auto-scroll, edit/tarik, coba kirim ulang.
- [ ] Composer: teks, kamera, galeri, hapus lampiran, chip OTW/Sudah Sampai, kirim QRIS.
- [ ] Modal pembayaran: tunai/transfer/QRIS, unggah bukti, file non-gambar, simpan sampai LUNAS.
- [ ] Modal lokasi di HP: izin GPS, foto kamera/galeri, patokan, simpan.
- [ ] Tab Mendatang dan Selesai: detail, foto, peta, edit lokasi, bukti bayar, chat, QRIS, kirim tagihan.

### 4.3 Live Chat
- [ ] Pencarian dalam chat dan banner pesan tersemat.
- [ ] Media: audio, dokumen, video+caption, kontak (Telepon), foto, share location (Peta).
- [ ] Kutipan: klik menggulir ke pesan asli dan menyorot.
- [ ] Reaksi: toolbar cepat, grid tambahan, batal reaksi.

### 4.4 `/go` dan mobile
- [ ] 375px dan 412px tidak ada scroll horizontal (sudah diukur, ulangi setelah perubahan terakhir).
- [ ] Landmark `main` ada di HTML.

## 5. Langkah deploy (Fase 9)

Prasyarat: persetujuan eksplisit pemilik + akses server + verifikasi 2 langkah.

1. Di mesin deploy: `npm run build` + `npm run check:design` hijau.
2. Staging: set `USE_DB_CATALOG=false` -> `/pricelist` harus **503** "Katalog belum tersedia"; kembalikan.
3. Deploy.
4. Cek `/layanan` -> 301 ke `/pricelist`.
5. Cek `/pricelist` -> 200 dan nomor `6285794210526` tampil.
6. Cek `/go` -> 200, landmark `main`, tidak ada error console.
7. Rollback: redeploy artefak sebelumnya (tanpa perubahan DB).

## 6. Catatan

- Semua perubahan masih **belum di-commit** (ratusan entri working tree dari beberapa sesi). Commit checkpoint wajib dibuat sebelum deploy.
- Docker/Postgres lokal sedang mati; build dan tes berjalan tanpa DB.
- Jangan menjalankan `scripts/build_pricelist.js` tanpa `--force`.
