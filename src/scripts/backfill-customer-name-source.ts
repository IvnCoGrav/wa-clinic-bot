/**
 * src/scripts/backfill-customer-name-source.ts
 *
 * Skrip CLI idempoten untuk backfill kolom `name_source` pada tabel `customers`.
 *
 * Logika:
 *  - name_source = 'reservation' bila customer memiliki minimal 1 reservasi non-cancelled
 *  - name_source = 'pushname' bila customer memiliki nama terisi tanpa reservasi
 *  - name_source = NULL bila nama kosong / null
 *
 * Pemakaian:
 *   npx tsx src/scripts/backfill-customer-name-source.ts                   # dry-run
 *   npx tsx src/scripts/backfill-customer-name-source.ts --commit          # commit
 *   npx tsx src/scripts/backfill-customer-name-source.ts --tenant=default-tenant --commit
 */

import { prisma } from '../db/client';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      if (val !== undefined) {
        options[key] = val;
      } else {
        options[key] = true;
      }
    }
  }

  return {
    tenantId: (options.tenant as string) || null,
    commit: Boolean(options.commit),
  };
}

async function main() {
  const params = parseArgs();
  console.log(`[BACKFILL NAME SOURCE] Target Tenant: ${params.tenantId || 'SEMUA TENANT'}`);
  console.log(`[BACKFILL NAME SOURCE] Mode: ${params.commit ? 'COMMIT (Write to DB)' : 'DRY RUN (Read only)'}`);

  try {
    const tenantFilter = params.tenantId ? `AND tenant_id = '${params.tenantId.replace(/'/g, "''")}'` : '';

    const summary: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        CASE 
          WHEN name IS NULL OR btrim(name) = '' THEN 'NULL (kosong)'
          WHEN EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = c.id AND r.status <> 'cancelled') THEN 'reservation'
          ELSE 'pushname'
        END AS target_source,
        COUNT(*)::int AS count
      FROM customers c
      WHERE name_source IS NULL ${tenantFilter}
      GROUP BY 1
      ORDER BY 2 DESC;
    `);

    console.log('\n[BACKFILL NAME SOURCE] Distribusi baris yang akan diperbarui:');
    console.table(summary);

    if (!params.commit) {
      console.log('\n[DRY RUN] Tidak ada perubahan data. Jalankan dengan flag --commit untuk mengeksekusi migrasi data.');
      try { await prisma.$disconnect(); } catch {}
      return;
    }

    const updatedCount = await prisma.$executeRawUnsafe(`
      UPDATE customers c SET name_source = CASE
        WHEN c.name IS NULL OR btrim(c.name) = '' THEN NULL
        WHEN EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = c.id AND r.status <> 'cancelled')
          THEN 'reservation'
        ELSE 'pushname' END
      WHERE c.name_source IS NULL ${tenantFilter};
    `);

    console.log(`\n[BACKFILL NAME SOURCE] Berhasil memperbarui ${updatedCount} baris customers.`);
  } catch (err: any) {
    console.warn(`[BACKFILL NAME SOURCE] Note: ${err?.message?.split('\n')[0] || err}`);
  } finally {
    try { await prisma.$disconnect(); } catch {}
  }
}

main().catch(async (e) => {
  console.error('[BACKFILL NAME SOURCE] Error:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
