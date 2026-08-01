-- CreateTable
CREATE TABLE "delivery_tiers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "max_dist" DOUBLE PRECISION NOT NULL,
    "fee" INTEGER NOT NULL,
    "promo_discount" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_tiers_tenant_id_sort_order_idx" ON "delivery_tiers"("tenant_id", "sort_order");
