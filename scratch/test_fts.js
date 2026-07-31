import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

async function testFTS() {
  const query = 'apakah yang treatment nanti bidan ya ?';
  
  // Clean stop words:
  const cleanQuery = query
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\b(apakah|yang|nanti|ya|dong|kah|sih|min|bunda|kak|ga|gak|apa)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  console.log('Cleaned Query:', cleanQuery);

  const rawResults = await prisma.$queryRaw`
    SELECT id, title, content,
           ts_rank(to_tsvector('simple', content), websearch_to_tsquery('simple', ${cleanQuery})) as rank
    FROM knowledge_chunks
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND to_tsvector('simple', content) @@ websearch_to_tsquery('simple', ${cleanQuery})
    ORDER BY rank DESC
    LIMIT 3;
  `;

  console.log('FTS Results count:', rawResults.length);
  rawResults.forEach(r => console.log('Match Title:', r.title));
  process.exit(0);
}

testFTS().catch(console.error);
