/**
 * src/scripts/seed-tenant-catalog.ts
 *
 * Seed eksplisit katalog treatment & delivery tiers per tenant.
 * Default DRY RUN; gunakan --commit untuk menulis ke database.
 *
 * Contoh:
 *   npx tsx src/scripts/seed-tenant-catalog.ts --tenant=default-tenant
 *   npx tsx src/scripts/seed-tenant-catalog.ts --tenant=default-tenant --brand=Kala --commit
 *   npx tsx src/scripts/seed-tenant-catalog.ts --tenant=tenant-baru --commit
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { seedTenantCatalog } from '../services/tenant-catalog-seed.service';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};

  for (const arg of args) {
    if (!arg.startsWith('--')) continue;
    const [key, val] = arg.slice(2).split('=');
    options[key] = val !== undefined ? val : true;
  }

  return {
    tenantId: typeof options.tenant === 'string' ? options.tenant.trim() : DEFAULT_TENANT_ID,
    brandPrefix: typeof options.brand === 'string' ? options.brand.trim() : '',
    commit: Boolean(options.commit),
    help: Boolean(options.help),
  };
}

async function main() {
  const params = parseArgs();

  if (params.help) {
    console.log(`Usage: npx tsx src/scripts/seed-tenant-catalog.ts --tenant=<id> [--brand=<prefix>] [--commit]

  --tenant   Tenant ID target (default: ${DEFAULT_TENANT_ID})
  --brand    Prefix nama layanan (mis. "Kala"); kosong = nama generik
  --commit   Tulis ke database (default: dry-run)
  --help     Tampilkan bantuan`);
    return;
  }

  console.log(`[SEED CATALOG] Target Tenant: ${params.tenantId}`);
  console.log(`[SEED CATALOG] Brand Prefix : ${params.brandPrefix || '(generic / unbranded)'}`);
  console.log(`[SEED CATALOG] Mode         : ${params.commit ? 'COMMIT (write to DB)' : 'DRY RUN (no changes)'}`);

  const result = await seedTenantCatalog({
    tenantId: params.tenantId,
    brandPrefix: params.brandPrefix,
    commit: params.commit,
  });

  console.log(`\n1. CLINIC SERVICES: ${result.services} layanan siap di-seed.`);
  result.sample.forEach((s) => console.log(`   - [${s.service_id}] ${s.name}`));
  console.log(`\n2. DELIVERY TIERS: ${result.tiers} tier siap di-seed.`);

  if (!result.committed) {
    console.log(`\n[DRY RUN SELESAI] Tidak ada data ditulis. Tambahkan --commit untuk menerapkan.`);
    return;
  }

  console.log(`\n[SEED SELESAI] ${result.services} layanan + ${result.tiers} tier ditulis untuk tenant '${result.tenantId}'.`);
}

main()
  .catch((err: any) => {
    console.error('[SEED CATALOG] Gagal:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
