/**
 * Seed idempoten artikel klinis persiapan treatment ibu hamil / induksi alami
 * ke tabel knowledge_chunks per tenant via knowledgeBaseService.upsertChunk.
 *
 * DB-DRIVEN & tenant-aware: isi artikel hidup di database (bisa diedit kapan saja
 * via dashboard /api/admin/knowledge), BUKAN hardcoded di prompt/tool runtime.
 *
 * Cara pakai:
 *   npx tsx scripts/seed-maternal-prep-faq.ts [--tenant=default-tenant]
 */
import { knowledgeBaseService } from '../src/services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';
import { prisma } from '../src/db/client';

const TITLE = 'Persiapan Sebelum Treatment Ibu Hamil / Induksi Massage';
const CONTENT =
  'Pertanyaan: Persiapan Sebelum Treatment Ibu Hamil / Induksi Massage\n' +
  'Jawaban: Sebelum treatment ibu hamil atau induksi massage, Bunda disarankan memakai ' +
  'pakaian yang nyaman, longgar, dan berkancing depan agar Bidan mudah melakukan perawatan. ' +
  'Beri jeda makan minimal 1 jam sebelum treatment, cukupi hidrasi dengan minum air putih, ' +
  'dan siapkan ruangan yang nyaman, bersih, dan cukup luas di rumah untuk layanan homecare. ' +
  'Istirahat yang cukup malam sebelumnya membantu tubuh lebih rileks sehingga manfaat ' +
  'relaksasi dan stimulasi induksi alami lebih optimal.';
const KEYWORDS =
  'persiapan, siap, sebelum treatment, ibu hamil, bumil, induksi, pakaian longgar, berkancing, jeda makan, hidrasi, ruangan nyaman, homecare';

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
