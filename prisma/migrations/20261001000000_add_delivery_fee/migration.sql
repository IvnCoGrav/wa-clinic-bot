-- KB-6 (2026-09-30): snapshot ongkir per-reservasi agar riwayat biaya abadi
-- meski customer pindah alamat. Nullable + tanpa default keras sehingga
-- baris lama tetap valid; kode membaca dengan fallback ke Customer.ongkir.
-- IF NOT EXISTS agar aman bila kolom sudah ada secara manual (tidak mengulang error).
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "delivery_fee" INTEGER;
