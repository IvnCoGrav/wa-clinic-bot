-- Ar-004 lanjutan (W12): unique constraint LandingPage.slug PER TENANT.
--
-- Resolusi landing kini tenant-aware:
-- - `?tenant=<id|slug>` (diverifikasi DB) atau host `Tenant.landing_domain`.
-- - Tanpa hint/host → mode slug-global lama (single-tenant tetap aman).
-- Dengan demikian dua tenant boleh memakai slug yang sama tanpa saling menimpa.
--
-- SQL dihasilkan `prisma migrate diff --from-schema-datamodel <HEAD> --to-schema-datamodel <baru>`.

-- DropIndex
DROP INDEX "landing_pages_slug_key";

-- CreateIndex
CREATE UNIQUE INDEX "landing_pages_tenant_id_slug_key" ON "landing_pages"("tenant_id", "slug");
