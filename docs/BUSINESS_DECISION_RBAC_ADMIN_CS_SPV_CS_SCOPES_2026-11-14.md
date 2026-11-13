# Keputusan Bisnis Resmi: Hak Akses Operasional Katalog Layanan & Reservasi Staf (2026-11-14)

> **Status:** RESMI, MENGIKAT & FINAL  
> **Tanggal Keputusan:** 14 November 2026  
> **Otoritas:** Pemilik Klinik / Pengguna Sistem  
> **Prinsip:** DILARANG KERAS DIREVISI ATAU DICABUT DI KEMUDIAN HARI

---

## 1. Latar Belakang & Masalah
Pada 14 November 2026, staf operasional klinik (**Bidan Yusi**, peran `ADMIN_CS`) mendapati bahwa pilihan treatment pada form pembuatan/edit reservasi dan antarmuka Live Chat muncul **kosong**. 

Hasil audit sistemik membuktikan bahwa penyebabnya adalah penegakan keamanan berlapis berbasis data (*Data-Driven RBAC Scope Guard / Fail-Closed* via tabel basis data `role_api_scopes`). Ketika sistem penguncian diperkenalkan, peran `ADMIN_CS` dan `SPV_CS` belum didaftarkan untuk membaca endpoint katalog treatment (`GET /api/admin/services`), daftar staf terapis (`GET /api/admin/staff`), dan tarif ongkir (`GET /api/admin/delivery-tiers`). Akibatnya, server menolak permintaan data dengan status **403 Forbidden** (`FORBIDDEN_ROLE_SCOPE`), dan form antarmuka web secara otomatis mengosongkan daftar pilihan layanan.

---

## 2. Ketetapan Keputusan Bisnis Mutlak (KB-RBAC-01)

Untuk menjamin kelancaran operasional layanan reservasi klinik homecare oleh Bidan dan tim CS tanpa mengorbankan keamanan sistem:

### A. Hak Baca Katalog & Parameter Operasional (GET)
Peran **`ADMIN_CS`** dan **`SPV_CS`** **WAJIB SELALU DIBERIKAN IZIN BACA (`GET`)** ke endpoint-endpoint berikut di setiap tenant:
1. **`/api/admin/services` (`GET`)** — Katalog master layanan treatment, durasi, dan harga resmi. Tanpa izin ini, staf tidak dapat memilih paket terapi untuk pasien.
2. **`/api/admin/delivery-tiers` (`GET`)** — Master zonasi jarak dan tarif ongkir transport terapis homecare.
3. **`/api/admin/staff` (`GET`)** — Daftar nama bidan/terapis aktif yang dapat ditugaskan ke janji temu pasien.
4. **`/api/admin/geo/areas` (`GET`)** — Daftar kelurahan/wilayah cakupan layanan klinik.
5. **`/api/admin/knowledge` (`GET`)** — Basis pengetahuan SOP klinis dan FAQ.
6. **`/api/admin/gateway-capability` (`GET`)**, **`/api/admin/health` (`GET`)**, **`/api/admin/capi-queue` (`GET`)** — Indikator kesiapan konektivitas WhatsApp dan antrean data.

### B. Hak Eksekusi Transaksi & Pelayanan Pasien (*)
Peran **`ADMIN_CS`** dan **`SPV_CS`** **WAJIB SELALU DIBERIKAN IZIN PENUH (`*`)** untuk alur pelayanan pasien:
1. **`/api/admin/reservations` & `/api/admin/reservation` (`*`)** — Membuat, menjadwalkan, mengubah, dan membatalkan reservasi.
2. **`/api/admin/reservation-series` (`*`)** — Membuat reservasi berulang (paket pendampingan multi-sesi).
3. **`/api/admin/customers` (`GET,POST,PUT,PATCH`)** — Mengelola profil pasien, riwayat, dan buku alamat rumah.
4. **`/api/admin/labels` (`*`)** — Menandai tag / label pasien (misal: "tanya jadwal", repeat, VIP).
5. **`/api/admin/quick-replies` (`*`)** — Menyiapkan dan menggunakan template balasan instan chat WhatsApp.
6. **`/api/admin/live-chat` (`*`)** — Komunikasi langsung dua arah dengan pasien.

---

## 3. Batasan Keamanan yang Tetap Terjaga (Boundary Super Admin)

Keputusan ini **TIDAK MENGURANGI** postur keamanan sistem klinik karena pemisahan wewenang tetap ditegakkan secara deterministik pada layer mutasi data master:
* **Pengubahan / Pembuatan Master Tarif Layanan**: Tetap eksklusif untuk **`SUPER_ADMIN`**. Staf CS hanya boleh membaca (`GET`), percobaan mengubah (`POST/PUT/DELETE /api/admin/services`) tetap diblokir oleh guard `FORBIDDEN_SUPER_ADMIN_ONLY_WRITE`.
* **Pengubahan / Pembuatan Master Ongkir**: Tetap eksklusif untuk **`SUPER_ADMIN`**.
* **Kredensial Sensitif & Infrastruktur**: Konfigurasi koneksi WAHA/QR, token CAPI Meta, API Key LLM, dan cadangan database (`/api/admin/settings`, `/api/admin/backup`, `/api/admin/debug`) tetap eksklusif hak **`SUPER_ADMIN`**.

---

## 4. Larangan Revisi & Perlindungan Regresi

1. **Larangan Revisi Sepihak**:
   Pengembang atau agen AI mana pun **DILARANG KERAS** menghapus, memodifikasi, atau mencabut baris izin baca operasional di atas dari tabel `role_api_scopes` atau dari migrasi basis data dengan alasan "minimal privilege" atau penyempitan peran.
2. **Jaring Pengaman Otomatis**:
   Integritas keputusan ini dijaga oleh:
   * Migrasi resmi Prisma: `prisma/migrations/20261114000000_add_admin_cs_spv_cs_operational_scopes`
   * Unit test regresi: `tests/unit/rbac-scope-fail-closed.test.ts`
   * Dokumentasi inventaris fitur: `docs/FEATURE_INVENTORY.md`
   * Log perubahan resmi: `CHANGELOG.md`
