-- ============================================================================
-- Runbook: Pembersihan duplikat reservasi Bunda Bella (6289670370062)
-- Slot: 2026-09-09 09:30 WIB | Customer: 1d9f96ab-c733-4bc0-9a74-2d9ac78a7a35
-- Eksekusi: via SSH ke container PostgreSQL live server (butuh verifikasi
-- 2-langkah sesuai gate server-update + peringatan risiko WAHA).
-- Sifat: idempoten — aman dijalankan ulang (UPDATE bersyarat nilai/status).
-- ============================================================================

-- 0. Pra-verifikasi: pastikan kondisi sesuai rencana (2 pending, 1 tanpa anak)
SELECT id, treatment_category, treatment_detail, booking_date, purchase_value, status
FROM reservations
WHERE customer_id = '1d9f96ab-c733-4bc0-9a74-2d9ac78a7a35'
ORDER BY booking_date;

-- 1. Pulihkan purchase_value resmi + pastikan aktif pada reservasi utama
--    (bbbde4bd… = terhubung ke anak Arhan & Ardhan; nominal resmi Rp 160.000)
UPDATE reservations
SET purchase_value = 160000, updated_at = NOW()
WHERE id = 'bbbde4bd-1d86-48fc-b911-f14f9bff13d7'
  AND (purchase_value IS DISTINCT FROM 160000);

-- 2. Batalkan reservasi duplikat yatim (7a6e494a… = tanpa relasi anak)
UPDATE reservations
SET status = 'cancelled', updated_at = NOW()
WHERE id = '7a6e494a-bab3-4774-9309-9a6d0123849f'
  AND status IS DISTINCT FROM 'cancelled';

-- 3. Verifikasi akhir: HARUS tepat 1 reservasi aktif Rp 160.000 di slot tsb
SELECT id, treatment_category, treatment_detail, booking_date, purchase_value, status
FROM reservations
WHERE customer_id = '1d9f96ab-c733-4bc0-9a74-2d9ac78a7a35'
ORDER BY booking_date;
-- Ekspektasi:
--  bbbde4bd-... | ... | 2026-09-09 09:30 | 160000 | pending/confirmed (AKTIF)
--  7a6e494a-... | ... | 2026-09-09 09:30 | ...    | cancelled
