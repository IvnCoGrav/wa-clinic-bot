-- CreateEnum
CREATE TYPE "AiCustomerScope" AS ENUM ('NEW_ONLY', 'ALL');

-- CreateEnum
CREATE TYPE "AiOverride" AS ENUM ('FORCE_ON', 'FORCE_OFF');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "ai_override" "AiOverride";

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "ai_customer_scope" "AiCustomerScope" NOT NULL DEFAULT 'NEW_ONLY',
ADD COLUMN     "ai_scope_cutoff_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;