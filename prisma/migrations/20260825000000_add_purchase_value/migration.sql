-- Menyimpan nominal rupiah transaksi Purchase yang terdeteksi/dimoderasi,
-- dipakai meja kerja Advertiser (Meta CAPI Queue) untuk menampilkan value
-- event yang akan dikirim ke Meta.
ALTER TABLE "reservations" ADD COLUMN "purchase_value" INTEGER;
