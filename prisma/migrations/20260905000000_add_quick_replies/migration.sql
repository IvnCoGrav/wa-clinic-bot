-- CreateTable
CREATE TABLE "quick_replies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "shortcut" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quick_replies_tenant_id_idx" ON "quick_replies"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "quick_replies_tenant_id_shortcut_key" ON "quick_replies"("tenant_id", "shortcut");
