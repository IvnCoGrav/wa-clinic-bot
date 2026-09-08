/**
 * Seed idempoten artikel klinis maternal (induksi alami + relaksasi bumil capek)
 * ke tabel knowledge_chunks per tenant via knowledgeBaseService.upsertChunk.
 *
 * DB-DRIVEN & tenant-aware: isi artikel hidup di database (bisa diedit kapan saja
 * via dashboard /api/admin/knowledge), BUKAN hardcoded di prompt/tool runtime.
 *
 * Cara pakai:
 *   npx tsx src/scripts/seed-maternal-induction-knowledge.ts [--tenant=default-tenant]
 */
import { knowledgeBaseService } from '../services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { prisma } from '../db/client';

const TITLE = 'Panduan Usia Kehamilan untuk Pijat Induksi Alami (Induksi Massage)';
const CONTENT =
  'Pertanyaan: Panduan Usia Kehamilan untuk Pijat Induksi Alami (Induksi Massage)\n' +
  'Jawaban: Pijat induksi alami aman dan sangat dianjurkan dilakukan pada usia kehamilan ' +
  'cukup bulan (aterm), yaitu mulai 37-38 minggu ke atas hingga menjelang HPL. Perawatan ini ' +
  'membantu merangsang hormon oksitosin alami, menstimulasi titik akupresur persalinan, dan ' +
  'melenturkan otot panggul. Untuk ibu hamil yang juga merasakan capek, pegal seluruh tubuh, ' +
  'atau ketegangan otot di trimester akhir, paket Induksi Massage Fullbody (relaksasi seluruh ' +
  'tubuh dipadukan dengan titik induksi) merupakan pilihan yang paling tepat.';
const KEYWORDS =
  '38 weeks, 37 weeks, induksi, induksi alami, pijat induksi, capek, hamil trimester 3, aterm, cukup bulan, hpl';

async function main() {
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
  const tenantId = tenantArg ? tenantArg.split('=')[1] : DEFAULT_TENANT_ID;
  const result = await knowledgeBaseService.upsertChunk({
    tenantId,
    title: TITLE,
    content: CONTENT,
    keywords: KEYWORDS,
  });
  console.log(`[SEED] tenant=${tenantId} id=${result.id} created=${result.created} title="${TITLE}"`);
}

main()
  .catch((e) => {
    console.error('[SEED ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch (_) {}
  });
