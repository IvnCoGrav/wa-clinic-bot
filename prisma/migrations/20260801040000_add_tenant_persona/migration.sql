-- CreateTable
CREATE TABLE "tenant_persona" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_persona_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_persona_tenant_id_key" ON "tenant_persona"("tenant_id");
