-- CreateTable
CREATE TABLE "clinic_services" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "min_age_months" INTEGER NOT NULL,
    "max_age_months" INTEGER,
    "age_label" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "original_price" INTEGER NOT NULL,
    "promo_price" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_services_tenant_id_service_id_key" ON "clinic_services"("tenant_id", "service_id");

-- CreateIndex
CREATE INDEX "clinic_services_tenant_id_idx" ON "clinic_services"("tenant_id");
