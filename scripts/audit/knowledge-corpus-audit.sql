-- Audit kualitas korpus knowledge (C-002) — READ-ONLY.
--
-- Jalankan terhadap SALINAN dump produksi (bukan DB live):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/audit/knowledge-corpus-audit.sql
--
-- Tidak ada DDL/DML: seluruh pernyataan hanya SELECT.

\echo '== 1. Ringkasan korpus per tenant =='
SELECT tenant_id,
       count(*)                        AS chunks,
       count(DISTINCT document_name)   AS dokumen,
       count(DISTINCT source_type)     AS jenis_sumber
FROM knowledge_chunks
GROUP BY tenant_id
ORDER BY chunks DESC;

\echo '== 2. Duplikat isi (hash konten ternormalisasi) =='
SELECT tenant_id,
       md5(lower(btrim(content))) AS content_hash,
       count(*)                   AS salinan,
       min(title)                 AS contoh_judul,
       min(id)                    AS contoh_id
FROM knowledge_chunks
GROUP BY tenant_id, md5(lower(btrim(content)))
HAVING count(*) > 1
ORDER BY salinan DESC
LIMIT 50;

\echo '== 3. Indikasi cuplikan percakapan (bukan artikel/SOP) =='
SELECT tenant_id, count(*) AS terindikasi
FROM knowledge_chunks
WHERE content ~* '(^|\n)\s*(nama|usia|alamat|keluhan|no\.?\s*hp|nomor\s*hp)\s*[:=]'
   OR content ~* '(^|\n)\s*(bunda|bidan|customer|admin|cs)\s*[:=]'
GROUP BY tenant_id;

\echo '== 4. Distribusi jenis sumber =='
SELECT tenant_id, source_type, count(*) AS jumlah
FROM knowledge_chunks
GROUP BY tenant_id, source_type
ORDER BY tenant_id, jumlah DESC;

\echo '== 5. Kualitas minimal: kosong / sangat pendek / tanpa keyword =='
SELECT tenant_id,
       count(*) FILTER (WHERE btrim(content) = '')                            AS kosong,
       count(*) FILTER (WHERE char_length(btrim(content)) BETWEEN 1 AND 40)   AS sangat_pendek,
       count(*) FILTER (WHERE keywords IS NULL OR btrim(keywords) = '')       AS tanpa_keywords
FROM knowledge_chunks
GROUP BY tenant_id;

\echo '== 6. Jumlah artikel per dokumen (bandingkan dengan metadata) =='
SELECT tenant_id,
       coalesce(document_name, '(tanpa_dokumen)') AS dokumen,
       count(*)                                   AS chunks
FROM knowledge_chunks
GROUP BY tenant_id, coalesce(document_name, '(tanpa_dokumen)')
ORDER BY tenant_id, chunks DESC
LIMIT 100;
