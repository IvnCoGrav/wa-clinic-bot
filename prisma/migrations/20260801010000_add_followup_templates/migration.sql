-- CreateTable
CREATE TABLE "follow_up_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "type" TEXT NOT NULL,
    "variant" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_templates_tenant_id_type_variant_key" ON "follow_up_templates"("tenant_id", "type", "variant");

-- CreateIndex
CREATE INDEX "follow_up_templates_tenant_id_type_idx" ON "follow_up_templates"("tenant_id", "type");
