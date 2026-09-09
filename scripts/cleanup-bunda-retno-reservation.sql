-- ============================================================================
-- Runbook: Penyesuaian reservasi Bunda Retno (6282132249740) di live server
-- Reservasi: a0c5e10c-8f25-4e06-a033-4a8adfae7a6e (9 Sept 2026, 11:00, pending)
-- Dibuat otomatis oleh AI sebelum Active Appointment Guard diterapkan.
-- Status: SIAPKAN SAJA — eksekusi menunggu instruksi operasional admin
-- (pilih BLOK 1 = cancelled ATAU BLOK 2 = confirmed, jalankan salah satu).
-- Eksekusi via SSH ke PostgreSQL live (verifikasi 2-langkah, gate server).
-- Sifat: idempoten — aman dijalankan ulang (UPDATE bersyarat nilai/status).
-- ============================================================================

-- 0. Pra-verifikasi: pastikan kondisi sesuai rencana
SELECT id, customer_id, treatment_detail, booking_date, purchase_value, status
FROM reservations
WHERE id = 'a0c5e10c-8f25-4e06-a033-4a8adfae7a6e';
-- Ekspektasi: 1 baris, booking 2026-09-09 11:00, status pending.
-- Konfirmasi riwayat completed Retno (29 Agu) masih ada:
SELECT id, booking_date, status
FROM reservations
WHERE customer_id = (SELECT customer_id FROM reservations WHERE id = 'a0c5e10c-8f25-4e06-a033-4a8adfae7a6e')
  AND status IN ('confirmed', 'completed')
ORDER BY booking_date;

-- BLOK 1 (pilih ini bila admin memutuskan BATALKAN jadwal 9 Sept 11:00):
-- UPDATE reservations
-- SET status = 'cancelled', updated_at = NOW()
-- WHERE id = 'a0c5e10c-8f25-4e06-a033-4a8adfae7a6e'
--   AND status IS DISTINCT FROM 'cancelled';

-- BLOK 2 (pilih ini bila admin memutuskan KONFIRMASI jadwal 9 Sept 11:00):
-- UPDATE reservations
-- SET status = 'confirmed', updated_at = NOW()
-- WHERE id = 'a0c5e10c-8f25-4e06-a033-4a8adfae7a6e'
--   AND status IS DISTINCT FROM 'confirmed';

-- 3. Verifikasi akhir (setelah salah satu blok dijalankan):
-- SELECT id, booking_date, purchase_value, status
-- FROM reservations
-- WHERE id = 'a0c5e10c-8f25-4e06-a033-4a8adfae7a6e';
-- Ekspektasi: status = cancelled ATAU confirmed sesuai pilihan admin.
