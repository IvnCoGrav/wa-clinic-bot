-- AI Router default-ON per tenant (SaaS-ready):
-- Toggle AI Router Engine bisa di-on/off dari admin dashboard per tenant.
--   tenants.ai_router_enabled      = default ON (router aktif & mengevaluasi)
--   tenants.ai_router_shadow_mode  = default ON (aman: hanya LOG ke ai_router_evaluations,
--                                    tidak mengubah keputusan produksi sampai dimatikan
--                                    setelah gate akurasi README lolos)
-- Env AI_ROUTER_ENABLED / AI_ROUTER_SHADOW_MODE tetap berfungsi sebagai fallback
-- saat DB tidak tersedia (mis. mode offline/testing).

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "ai_router_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "ai_router_shadow_mode" BOOLEAN NOT NULL DEFAULT true;
