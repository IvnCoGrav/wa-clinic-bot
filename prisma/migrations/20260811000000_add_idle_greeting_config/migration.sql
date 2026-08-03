-- Idle greeting config per tenant (SaaS-ready):
-- Respon berbeda untuk sapaan basa-basi di sesi idle panjang (1-2 hari).
--   tenants.idle_greeting_enabled   = default ON (sapaan murni + idle >= min_hours
--                                      -> warm open-ended greeting, bukan pitch reservasi)
--   tenants.idle_greeting_min_hours = default 36 (ambang idle minimum untuk memicu warm greeting)
-- Env IDLE_GREETING_ENABLED / IDLE_GREETING_MIN_HOURS tetap berfungsi sebagai fallback
-- saat DB tidak tersedia (mis. mode offline/testing).

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "idle_greeting_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "idle_greeting_min_hours" INTEGER NOT NULL DEFAULT 36;
