-- 2026-08-08 · Production Performance Audit (P2)
-- GIN expression index untuk Full-Text Search knowledge_chunks
-- (to_tsvector('simple', content)). Prisma tidak bisa mengekspresikan
-- expression index ini, jadi dibuat raw SQL dan dibiarkan "unmanaged"
-- (migrate/schema drift tidak mendeteksi perubahannya).
CREATE INDEX "knowledge_chunks_content_fts_idx" ON "knowledge_chunks" USING GIN (to_tsvector('simple', "content"));