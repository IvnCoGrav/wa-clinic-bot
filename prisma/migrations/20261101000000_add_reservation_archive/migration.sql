-- CreateTable
CREATE TABLE "reservation_archives" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "reservation_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "customer_phone" TEXT,
    "customer_name" TEXT,
    "booking_date" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "treatment_detail" TEXT,
    "purchase_value" INTEGER,
    "reason" TEXT,
    "archived_by" TEXT,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restore_until" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "restored_at" TIMESTAMP(3),

    CONSTRAINT "reservation_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservation_archives_tenant_id_archived_at_idx" ON "reservation_archives"("tenant_id", "archived_at");

-- CreateIndex
CREATE INDEX "reservation_archives_tenant_id_restore_until_idx" ON "reservation_archives"("tenant_id", "restore_until");

-- CreateIndex
CREATE INDEX "reservation_archives_reservation_id_idx" ON "reservation_archives"("reservation_id");

-- CreateIndex
CREATE INDEX "reservation_archives_customer_id_idx" ON "reservation_archives"("customer_id");
