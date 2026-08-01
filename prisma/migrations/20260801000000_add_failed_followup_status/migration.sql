-- AlterEnum
-- Tambahkan nilai baru FAILED pada enum FollowUpStatus untuk menandai pengiriman follow-up yang gagal
ALTER TYPE "FollowUpStatus" ADD VALUE IF NOT EXISTS 'FAILED';
