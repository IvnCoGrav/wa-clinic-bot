-- Ensure tenants.settings column exists (Plan 6 FASE 4, Issue #30).
-- Idempotent: safe on DBs where the column already exists (live) and on
-- fresh DBs. Cures P2022 "The column tenants.settings does not exist"
-- thrown by full-row prisma.tenant.findUnique() on under-migrated envs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'settings'
  ) THEN
    ALTER TABLE "tenants" ADD COLUMN "settings" JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;
