-- CreateTable
CREATE TABLE IF NOT EXISTS "labels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default-tenant',
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#008069',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "customer_labels" (
    "customer_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_labels_pkey" PRIMARY KEY ("customer_id","label_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "labels_tenant_id_name_key" ON "labels"("tenant_id", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "labels_tenant_id_idx" ON "labels"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_labels_customer_id_idx" ON "customer_labels"("customer_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_labels_label_id_idx" ON "customer_labels"("label_id");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'customer_labels_customer_id_fkey'
    ) THEN
        ALTER TABLE "customer_labels" ADD CONSTRAINT "customer_labels_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'customer_labels_label_id_fkey'
    ) THEN
        ALTER TABLE "customer_labels" ADD CONSTRAINT "customer_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
