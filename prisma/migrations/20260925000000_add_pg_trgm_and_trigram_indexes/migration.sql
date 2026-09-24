-- Fase 4 retrieval: toleransi afiks Bahasa Indonesia & typo tanpa pgvector.
-- Ekstensi contrib bawaan PostgreSQL (tanpa dependensi/npm baru).
-- BUTUH superuser saat apply (live: user postgres via docker-compose = superuser).
-- Rollback jujur (Prisma tanpa down-migration): DROP INDEX manual bila perlu,
--   DROP EXTENSION hanya bila tak ada objek lain yang memakai pg_trgm.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram atas ekspresi yang SAMA PERSIS dengan query tier-4
-- knowledge.service.ts agar index terpakai operator %.
CREATE INDEX IF NOT EXISTS trgm_idx_knowledge_title_content
ON knowledge_chunks USING gin ((title || ' ' || coalesce(keywords, '') || ' ' || content) gin_trgm_ops);
