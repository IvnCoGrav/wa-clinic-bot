-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant';

-- AlterTable
ALTER TABLE "knowledge_chunks" ADD COLUMN     "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant';

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant';

-- CreateIndex
CREATE INDEX "conversations_tenant_id_idx" ON "conversations"("tenant_id");

-- CreateIndex
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_tenant_id_idx" ON "knowledge_chunks"("tenant_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_idx" ON "messages"("tenant_id");

-- CreateIndex
CREATE INDEX "reservations_tenant_id_idx" ON "reservations"("tenant_id");
