/**
 * Migrasi data satu-kali (idempoten, per tenant): perkaya kolom
 * `knowledge_chunks.keywords` (44 dari 48 baris masih NULL) dan
 * `few_shot_exemplars.tags` dengan kosakata alami pelanggan.
 *
 * Latar belakang: FTS Postgres memakai kamus 'simple' tanpa stemming Indonesia
 * (persiapan ≠ disiapkan), sehingga artikel yang ADA gagal ter-retrieve.
 * Aturan kurasi terpusat di src/services/keyword-enrichment.service.ts
 * (single source of truth — dipakai juga oleh seed-faq.ts & unit test).
 *
 * DB-DRIVEN & tenant-aware. Aman dijalankan ulang (hanya mengubah baris yang
 * keywords/tags-nya berbeda dari hasil resolusi; baris tak cocok dilaporkan).
 *
 * Cara pakai:
 *   npx tsx scripts/enrich-kb-and-bank-chat-keywords.ts [--tenant=default-tenant] [--dry-run]
 */
import { enrichTenantKeywords } from '../src/services/keyword-enrichment.service';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';
import { prisma } from '../src/db/client';

async function main() {
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
  const tenantId = tenantArg ? tenantArg.split('=')[1] : DEFAULT_TENANT_ID;
  const dryRun = process.argv.includes('--dry-run');

  console.log(`[ENRICH] tenant=${tenantId}${dryRun ? ' (DRY-RUN)' : ''}`);
  const stats = await enrichTenantKeywords(tenantId, { dryRun });

  console.log(`[ENRICH] chunks: ${stats.chunksUpdated}/${stats.chunksScanned} diperbarui`);
  if (stats.chunksUnmatched.length > 0) {
    console.log('[ENRICH] chunk TANPA aturan (tidak diubah):');
    for (const t of stats.chunksUnmatched) console.log(`  - ${t}`);
  }
  console.log(`[ENRICH] exemplars: ${stats.exemplarsUpdated}/${stats.exemplarsScanned} diperbarui`);
  if (stats.exemplarsUnmatched.length > 0) {
    console.log('[ENRICH] exemplar TANPA aturan (tidak diubah):');
    for (const s of stats.exemplarsUnmatched) console.log(`  - ${s}`);
  }
}

main()
  .catch((e) => {
    console.error('[ENRICH ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch (_) {}
  });
