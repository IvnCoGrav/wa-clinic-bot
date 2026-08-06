-- Menambahkan kolom purchase_event_sent_at pada tabel reservations.
-- Digunakan untuk menandai kapan event Purchase CAPI terakhir terkirim,
-- jadi tombol "Tandai Lunas" di dashboard nonaktif selama 7 hari (mencegah
-- double-count & tetap menutupi potensi repeat order).
ALTER TABLE "reservations" ADD COLUMN "purchase_event_sent_at" TIMESTAMP(3);