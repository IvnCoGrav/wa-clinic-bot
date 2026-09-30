# Keputusan Bisnis & Teknis — Audit Reservasi (2026-09-30)

Dokumen ini mencatat keputusan eksplisit pemilik klinik atas Confirmation Gate
audit sistemik reservasi. Semua item di bawah adalah otoritas untuk eksekusi.

## Keputusan Bisnis Klinik (KB)

| Kode | Topik | Keputusan | Implikasi |
|---|---|---|---|
| **KB-1** | Kedaluwarsa hold | Hold berlaku **sampai tengah malam WIB** hari pembuatan | Sweep diubah dari `booking_date` → `created_at` (tanpa migrasi) |
| **KB-2** | Same-day booking | Terima sebagai **pending** + alert admin; **pisahkan cart/chat** agar admin aware; hilang setelah direspon admin | ✅ Dieksekusi (disatukan): status `pending` + `[SAME_DAY_REQUEST]` (sudah ada) + Web Push/Telegram admin + badge "⏰ Hari Ini — Perlu Cek" (hilang saat status diubah) |
| **KB-3** | Batas kapasitas bot (staf null) | **Ya**, batasi kuota paralel | ✅ Dieksekusi: kuota = jumlah terapis aktif; BOT/AGENT tanpa staf ditolak bila penuh (`CAPACITY_EXCEEDED`) |
| **KB-4** | Form tanpa jam | **Wajib isi**; bila kosong beri notif bahwa akan default jam 09:00 | ✅ Dieksekusi: notif di pesan tool V3 bila `bookingTime` kosong |
| **KB-5** | 15 confirmed lampau | **Konfirmasi manual** per baris oleh bidan | Operasional (tidak diotomasi) |
| **KB-6** | Ongkir | **Pindah ke Reservation** (snapshot). Ongkir terakhir **dipakai sebagai referensi** agar admin tidak input ulang di next treatment | ✅ Dieksekusi Tahap 1: kolom `delivery_fee` + migrasi + persist core + prefill; baca memakai fallback bila null |
| **KB-7** | Pelepasan hold | **Hapus permanen** (hard delete) | Pertahankan perilaku `release-hold` saat ini |

## Keputusan Teknis

| Item | Keputusan | Catatan |
|---|---|---|
| **R2.6** | Transaksionalisasi `POST /api/admin/reservation` | Disetujui |
| **173d** | Cek bentrok gagal → **TOLAK** (fail-closed) di production | Non-production tetap fail-open + alert (test offline aman) |
| **173a** | Bukti `audit/evidence/P1/` | **Simpan** file kecil sebagai catatan; hapus yang berukuran besar |
| **173k** | Verifikasi invariant DB produksi | **Jalankan** (read-only) |
| **R1** | Cleanup data (1 null date, 1 stale hold, 8 flag) | Disetujui (wajib backup) |
| **Google Calendar** | Masih **mock** di produksi | Catatan untuk tindak lanjut; tidak diaktifkan sekarang |

## Urutan Eksekusi (staged)

1. **Batch aman (tanpa DB/infra baru):** 173a, 173d, R3.1/KB-1, R2.6.
2. **Butuh migrasi DB:** KB-6 (R5.2 `delivery_fee`), KB-3 (kuota).
3. **Butuh akses server:** R1 cleanup + 173k verifikasi invariant.
4. **Butuh desain UI/state:** KB-2 (cart same-day terpisah + awareness admin).
5. **Ditunda:** Google Calendar (masih mock).
