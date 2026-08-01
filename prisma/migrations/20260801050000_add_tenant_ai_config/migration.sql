-- CreateTable
CREATE TABLE "tenant_ai_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "max_tokens" INTEGER NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "confidence_threshold" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_ai_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ai_config_tenant_id_task_key" ON "tenant_ai_config"("tenant_id", "task");
