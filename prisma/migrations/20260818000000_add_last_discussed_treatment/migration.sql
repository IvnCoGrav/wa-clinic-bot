-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "last_discussed_treatment" TEXT,
ADD COLUMN "last_discussed_treatment_at" TIMESTAMP(3);
