-- AlterTable: Add keywords to knowledge_chunks (tag intent & sinonim pencarian RAG)
ALTER TABLE "knowledge_chunks" ADD COLUMN "keywords" TEXT;
