/**
 * sync-prep-knowledge.ts — 391501 Fase 3
 * Idempotent sync: perbarui chunk FAQ persiapan & keywords di knowledge_chunks.
 * Dijalankan via `npx tsx scripts/sync-prep-knowledge.ts` (memerlukan DATABASE_URL).
 * Aman diulang; memakai upsert berdasar question.
 */
import { resolveChunkKeywords } from '../src/services/keyword-enrichment.service';
import { faqs } from '../src/cli/faq-corpus';

async function main() {
  const { prisma } = await import('../src/db/client');
  const targetQ = 'Apa saja yang perlu disiapkan sebelum treatment?';
  const faq = faqs.find((f) => f.question === targetQ);
  if (!faq) {
    console.error('[SYNC-PREP] FAQ target tidak ditemukan di faq-corpus.ts');
    process.exit(1);
  }
  const keywords = resolveChunkKeywords(faq.question, null) || faq.keywords || '';
  const existing = await (prisma as any).knowledgeChunk.findFirst({
    where: { title: targetQ },
  });
  if (existing) {
    await (prisma as any).knowledgeChunk.update({
      where: { id: existing.id },
      data: { content: faq.answer, keywords },
    });
    console.log(`[SYNC-PREP] Updated chunk ${existing.id}: keywords=${keywords.slice(0, 80)}...`);
  } else {
    const created = await (prisma as any).knowledgeChunk.create({
      data: {
        title: faq.question,
        content: faq.answer,
        keywords,
        tenant_id: 'default-tenant',
      },
    });
    console.log(`[SYNC-PREP] Created chunk ${created.id}`);
  }
  // Invalidate FAQ cache jika ada
  try {
    const { redis } = await import('../src/db/redis');
    await redis.del('faq:*');
  } catch (_) {}
  console.log('[SYNC-PREP] Done');
  await (prisma as any).$disconnect();
}

main().catch((e) => {
  console.error('[SYNC-PREP] Failed:', e);
  process.exit(1);
});
