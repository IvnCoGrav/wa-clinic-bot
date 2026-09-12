import { knowledgeBaseService } from '../services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { prisma } from '../db/client';
import { faqs } from './faq-corpus';

async function main() {
  // Plan 4 Phase 2 — NON-DESTRUKTIF: deleteMany DIHAPUS. Setiap entri di-upsert
  // idempoten berbasis (tenant_id, title): baris seed yang berubah diperbarui,
  // baris baru dibuat, kurasi admin di luar daftar seed TIDAK PERNAH disentuh.
  console.log(`\x1b[36m[SEEDING] Upsert idempoten ${faqs.length} FAQ (tanpa hapus data)...\x1b[0m`);
  let created = 0;
  let updated = 0;
  for (const faq of faqs as Array<{ question: string; answer: string; keywords?: string }>) {
    const question = (faq.question || '').trim();
    const answer = (faq.answer || '').trim();
    if (!question || !answer) continue;
    try {
      const res = await knowledgeBaseService.upsertChunk({
        tenantId: DEFAULT_TENANT_ID,
        title: question,
        content: `Pertanyaan: ${question}\nJawaban: ${answer}`,
        keywords: faq.keywords,
      });
      if (res.created) created++;
      else updated++;
    } catch (err) {
      console.warn('\x1b[33m[SEEDING] Upsert gagal, lanjut entri berikut...\x1b[0m', (err as Error).message);
    }
  }
  try {
    const { faqCacheService } = await import('../services/faq-cache.service');
    await faqCacheService.invalidateAll(DEFAULT_TENANT_ID).catch(() => {});
  } catch (_) {}
  console.log(`\x1b[32m[SEEDING] Sukses! Baru: ${created}, diperbarui: ${updated}.\x1b[0m\n`);
}

main()
  .catch((e) => {
    console.error('\x1b[31m[SEEDING ERROR] Gagal menjalankan seed:\x1b[0m', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
