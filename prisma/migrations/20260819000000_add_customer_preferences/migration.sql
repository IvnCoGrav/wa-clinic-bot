-- Add preferences (long-term customer memory, Json) to customers table (additive)
ALTER TABLE "customers" ADD COLUMN "preferences" JSONB;