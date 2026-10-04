import { knowledgeBaseService } from '../services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { prisma } from '../db/client';
import { faqs } from './faq-corpus';

/**
 * Opsi CLI:
 *   --dry-run            → hanya tampilkan target upsert, TANPA menulis DB.
 *   --only=<substr>      → filter judul (lowercase includes); aman untuk update
 *                          TERARAH satu chunk tanpa menyentuh kurasi lain.
 *
 * Plan 4 Phase 2 — NON-DESTRUKTIF: deleteMany DIHAPUS. Setiap entri di-upsert
 * idempoten berbasis (tenant_id, title): baris seed yang berubah diperbarui,
 * baris baru dibuat, kurasi admin di luar daftar seed TIDAK PERNAH disentuh.
 * PERINGATAN: upsert by title akan MENIMPA konten/keywords baris yang judulnya
 * sama dengan daftar seed — pakai `--only=` untuk perubahan terarah.
 *
 * Jalankan di container produksi (dist sudah terkompilasi):
 *   docker compose exec -T app node dist/cli/seed-faq.js --dry-run
 *   docker compose exec -T app node dist/cli/seed-faq.js --only="Induksi Massage"
 */
async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).toLowerCase().trim() : '';

  const targets = (faqs as Array<{ question: string; answer: string; keywords?: string }>).filter((f) => {
    const q = (f.question || '').trim();
    const a = (f.answer || '').trim();
    if (!q || !a) return false;
    if (only && !q.toLowerCase().includes(only)) return false;
    return true;
  });

  console.log(`\x1b[36m[SEEDING]${dryRun ? ' DRY-RUN' : ''} upsert idempoten ${targets.length} FAQ${only ? ` (filter: "${only}")` : ''} (tanpa hapus data)...\x1b[0m`);

  let created = 0;
  let updated = 0;
  for (const faq of targets) {
    const question = (faq.question || '').trim();
    const answer = (faq.answer || '').trim();
    if (dryRun) {
      console.log(`  \x1b[90m- ${question}\x1b[0m`);
      continue;
    }
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

  if (dryRun) {
    console.log(`\x1b[36m[SEEDING] DRY-RUN selesai. Tidak ada perubahan DB.\x1b[0m\n`);
    return;
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
