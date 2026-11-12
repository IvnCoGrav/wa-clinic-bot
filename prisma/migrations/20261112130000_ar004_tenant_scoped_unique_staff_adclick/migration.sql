-- Ar-004 (W7): unique constraint per tenant untuk Staff.phone & AdClick.trackingCode.
--
-- Kedua lookup sudah tenant-scoped di kode:
-- - Staff login: `StaffAuthService.login(phone, password, tenantId)` + `findFirst({ phone, tenant_id })`.
-- - AdClick: lookup memakai `customerId` (global unik) atau `findFirst({ trackingCode, customerId })`.
--
-- LandingPage.slug SENGAJA belum diubah: resolusi landing saat ini berbasis slug
-- global (tanpa host/tenant), sehingga melonggarkan slug akan menimbulkan
-- ambiguitas. Itu menunggu routing per-host (area landing pengguna).
--
-- SQL dihasilkan `prisma migrate diff --from-schema-datamodel <HEAD> --to-schema-datamodel <baru>`.

-- DropIndex
DROP INDEX "ad_clicks_trackingCode_key";

-- DropIndex
DROP INDEX "staff_phone_key";

-- CreateIndex
CREATE UNIQUE INDEX "ad_clicks_tenant_id_trackingCode_key" ON "ad_clicks"("tenant_id", "trackingCode");

-- CreateIndex
CREATE UNIQUE INDEX "staff_tenant_id_phone_key" ON "staff"("tenant_id", "phone");
