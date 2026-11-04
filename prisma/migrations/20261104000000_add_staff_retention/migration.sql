-- AlterTable
ALTER TABLE "staff" ADD COLUMN "incentive_eligible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "staff" ADD COLUMN "incentive_scheme" TEXT NOT NULL DEFAULT 'RETENTION';
ALTER TABLE "staff" ADD COLUMN "employment_started_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "window_days" INTEGER NOT NULL DEFAULT 60,
    "pool_months" INTEGER NOT NULL DEFAULT 6,
    "benchmark_pct" DOUBLE PRECISION NOT NULL DEFAULT 34.6,
    "tier1_max_pct" DOUBLE PRECISION NOT NULL DEFAULT 31.1,
    "tier2_max_pct" DOUBLE PRECISION NOT NULL DEFAULT 38.1,
    "split_tier1" INTEGER NOT NULL DEFAULT 50,
    "split_tier2" INTEGER NOT NULL DEFAULT 55,
    "split_tier3" INTEGER NOT NULL DEFAULT 60,
    "min_sample" INTEGER NOT NULL DEFAULT 40,
    "min_tenure_months" INTEGER NOT NULL DEFAULT 4,
    "downgrade_periods" INTEGER NOT NULL DEFAULT 2,
    "soft_landing_until" TIMESTAMP(3),
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "formula_version" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_retention_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "staff_id" TEXT NOT NULL,
    "staff_name" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "policy_id" TEXT,
    "window_days" INTEGER NOT NULL,
    "pool_start" TIMESTAMP(3) NOT NULL,
    "pool_end" TIMESTAMP(3) NOT NULL,
    "cohort_n" INTEGER NOT NULL,
    "retained_n" INTEGER NOT NULL,
    "retention_pct" DOUBLE PRECISION,
    "benchmark_pct" DOUBLE PRECISION NOT NULL,
    "retention_index" DOUBLE PRECISION,
    "raw_tier" INTEGER,
    "final_tier" INTEGER,
    "split_pct" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "skip_reason" TEXT,
    "formula_version" TEXT NOT NULL DEFAULT 'v1',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_by" TEXT,
    "applied_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "staff_retention_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_staff_assignment_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "reservation_id" TEXT NOT NULL,
    "from_staff_id" TEXT,
    "to_staff_id" TEXT,
    "reason" TEXT,
    "actor" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_staff_assignment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_tenant_id_effective_from_key" ON "retention_policies"("tenant_id", "effective_from");

-- CreateIndex
CREATE INDEX "retention_policies_tenant_id_effective_from_idx" ON "retention_policies"("tenant_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "staff_retention_snapshots_tenant_id_staff_id_period_year_period_month_key" ON "staff_retention_snapshots"("tenant_id", "staff_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "staff_retention_snapshots_tenant_id_period_year_period_month_idx" ON "staff_retention_snapshots"("tenant_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "reservation_staff_assignment_logs_tenant_id_reservation_id_idx" ON "reservation_staff_assignment_logs"("tenant_id", "reservation_id");

-- CreateIndex
CREATE INDEX "reservation_staff_assignment_logs_tenant_id_created_at_idx" ON "reservation_staff_assignment_logs"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "staff_retention_snapshots" ADD CONSTRAINT "staff_retention_snapshots_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Initial Seed (default policy & staff eligibility)
INSERT INTO "retention_policies"
  ("id", "tenant_id", "window_days", "pool_months", "benchmark_pct",
   "tier1_max_pct", "tier2_max_pct", "split_tier1", "split_tier2", "split_tier3",
   "min_sample", "min_tenure_months", "downgrade_periods",
   "soft_landing_until", "effective_from", "formula_version")
VALUES
  (gen_random_uuid(), 'default-tenant', 60, 6, 34.6,
   31.1, 38.1, 50, 55, 60,
   40, 4, 2,
   '2027-02-28', '2026-11-04', 'v1')
ON CONFLICT ("tenant_id", "effective_from") DO NOTHING;

UPDATE "staff" SET "incentive_eligible" = false
WHERE "name" = 'Bidan Yusi F' AND "tenant_id" = 'default-tenant';

UPDATE "staff" SET "incentive_scheme" = 'VOLUME'
WHERE "name" = 'Bidan Hanifah' AND "tenant_id" = 'default-tenant';
