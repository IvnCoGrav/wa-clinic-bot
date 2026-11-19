-- CreateEnum
CREATE TYPE "ArrivalEvidenceSource" AS ENUM ('TAP', 'GEOFENCE', 'PHOTO', 'CHAT', 'OTW', 'ESTIMATE');

-- CreateEnum
CREATE TYPE "ArrivalEvidenceReview" AS ENUM ('AUTO', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "staff_scorecard_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "weight_punctuality" INTEGER NOT NULL DEFAULT 50,
    "weight_retention" INTEGER NOT NULL DEFAULT 30,
    "weight_volume" INTEGER NOT NULL DEFAULT 20,
    "tolerance_minutes" INTEGER NOT NULL DEFAULT 30,
    "chat_evidence_minutes" INTEGER NOT NULL DEFAULT 30,
    "target_visits_per_day" INTEGER NOT NULL DEFAULT 3,
    "working_days_per_month" INTEGER NOT NULL DEFAULT 26,
    "min_sample_punctuality" INTEGER NOT NULL DEFAULT 10,
    "min_sample_retention" INTEGER NOT NULL DEFAULT 40,
    "min_tenure_months" INTEGER NOT NULL DEFAULT 4,
    "grade_a_min" INTEGER NOT NULL DEFAULT 90,
    "grade_b_min" INTEGER NOT NULL DEFAULT 75,
    "grade_c_min" INTEGER NOT NULL DEFAULT 60,
    "grade_d_min" INTEGER NOT NULL DEFAULT 40,
    "formula_version" TEXT NOT NULL DEFAULT 'v1',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_scorecard_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_arrival_evidence" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "reservation_id" TEXT NOT NULL,
    "source" "ArrivalEvidenceSource" NOT NULL,
    "evidence_at" TIMESTAMP(3) NOT NULL,
    "observed_minutes" INTEGER,
    "confidence" DOUBLE PRECISION,
    "message_id" TEXT,
    "model" TEXT,
    "review_status" "ArrivalEvidenceReview" NOT NULL DEFAULT 'AUTO',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_arrival_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_scorecard_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "staff_id" TEXT NOT NULL,
    "staff_name" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "policy_id" TEXT,
    "punctuality_pct" DOUBLE PRECISION,
    "retention_pct" DOUBLE PRECISION,
    "volume_pct" DOUBLE PRECISION,
    "weighted_score" DOUBLE PRECISION,
    "grade" TEXT,
    "coverage_pct" DOUBLE PRECISION,
    "measured_n" INTEGER NOT NULL DEFAULT 0,
    "chat_late_n" INTEGER NOT NULL DEFAULT 0,
    "unknown_n" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_by" TEXT,
    "notes" TEXT,

    CONSTRAINT "staff_scorecard_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_scorecard_policies_tenant_id_effective_from_idx" ON "staff_scorecard_policies"("tenant_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "staff_scorecard_policies_tenant_id_effective_from_key" ON "staff_scorecard_policies"("tenant_id", "effective_from");

-- CreateIndex
CREATE INDEX "visit_arrival_evidence_tenant_id_review_status_idx" ON "visit_arrival_evidence"("tenant_id", "review_status");

-- CreateIndex
CREATE INDEX "visit_arrival_evidence_reservation_id_idx" ON "visit_arrival_evidence"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_arrival_evidence_tenant_id_reservation_id_source_evid_key" ON "visit_arrival_evidence"("tenant_id", "reservation_id", "source", "evidence_at");

-- CreateIndex
CREATE INDEX "staff_scorecard_snapshots_tenant_id_period_year_period_mont_idx" ON "staff_scorecard_snapshots"("tenant_id", "period_year", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "staff_scorecard_snapshots_tenant_id_staff_id_period_year_pe_key" ON "staff_scorecard_snapshots"("tenant_id", "staff_id", "period_year", "period_month");

-- AddForeignKey
ALTER TABLE "visit_arrival_evidence" ADD CONSTRAINT "visit_arrival_evidence_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_scorecard_snapshots" ADD CONSTRAINT "staff_scorecard_snapshots_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
