-- AlterTable: add labels_synced_at to track when labels were verified/synced from WAHA
ALTER TABLE "customers" ADD COLUMN "labels_synced_at" TIMESTAMP(3);
