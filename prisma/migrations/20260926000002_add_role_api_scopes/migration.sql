-- SEC-AUDIT-04: tabel pemetaan cakupan API per peran (data-driven, bukan hardcode).
-- Enforcement default-deny HANYA untuk role_key yang punya baris (managed).
-- Seed awal: therapist dikunci ke baca profil diri (portal terapis memakai /api/staff/*,
-- endpoint /api/admin/auth/* memang bypass guard). Idempoten (ON CONFLICT DO NOTHING).
-- admin_cs/spv_cs: belum di-seed (Fase 2b setelah verifikasi pemetaan today-treatments).

-- CreateTable
CREATE TABLE IF NOT EXISTS "role_api_scopes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "role_key" TEXT NOT NULL,
    "api_prefix" TEXT NOT NULL,
    "methods" TEXT NOT NULL DEFAULT '*',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_api_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "role_api_scopes_tenant_id_role_key_api_prefix_key"
  ON "role_api_scopes"("tenant_id", "role_key", "api_prefix");

INSERT INTO "role_api_scopes" (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'default-tenant', 'therapist', '/api/admin/staff/me', 'GET', NOW(), NOW()),
  (gen_random_uuid(), 'default-tenant', 'therapist', '/api/admin/staff/profile', 'GET', NOW(), NOW())
ON CONFLICT (tenant_id, role_key, api_prefix) DO NOTHING;
