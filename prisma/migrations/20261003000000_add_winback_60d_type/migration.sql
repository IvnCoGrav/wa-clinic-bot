-- Re-engagement pelanggan dormant (>60 hari) dengan kualifikasi MQL/legacy.
-- Append-only & non-blocking: satu statement saja (ALTER TYPE ADD VALUE tidak
-- boleh dijalankan dalam transaksi yang sama dengan pemakaian nilai barunya).
ALTER TYPE "FollowUpType" ADD VALUE IF NOT EXISTS 'WINBACK_60D';
