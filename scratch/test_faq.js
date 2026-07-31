import { knowledgeBaseService } from '../src/services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

async function testFaqSearch() {
  const query = 'apakah yang treatment nanti bidan ya ?';
  console.log('Testing FAQ search for:', query);
  const chunks = await knowledgeBaseService.searchRelevantChunks(query, 3, DEFAULT_TENANT_ID);
  console.log(`Found ${chunks.length} matching chunks:`);
  chunks.forEach((c, idx) => {
    console.log(`\n--- Match #${idx + 1} ---`);
    console.log(c.content);
  });
  process.exit(0);
}

testFaqSearch().catch(err => {
  console.error('Error during search:', err);
  process.exit(1);
});
