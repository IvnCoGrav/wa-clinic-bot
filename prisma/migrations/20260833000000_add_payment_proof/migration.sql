-- Bukti pembayaran per reservasi: metode bayar (CASH/TRANSFER/QRIS) + URL media bukti (TF/QRIS).
-- Diisi oleh staff saat catat pembayaran (recordPayment); dipakai dashboard Reservations
-- untuk tombol "Cek Bukti Bayar" pada reservasi yang sudah selesai.

ALTER TABLE "reservations" ADD COLUMN "payment_method" TEXT;
ALTER TABLE "reservations" ADD COLUMN "proof_url" TEXT;