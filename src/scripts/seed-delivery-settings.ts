/**
 * src/scripts/seed-delivery-settings.ts
 *
 * Skrip CLI idempoten untuk seeding konfigurasi ongkir per tenant
 * (estimateTtlDays).
 *
 * Contoh pemakaian:
 *   npx tsx src/scripts/seed-delivery-settings.ts --tenant=default-tenant --ttl-days=14
 *   npx tsx src/scripts/seed-delivery-settings.ts --tenant=default-tenant --ttl-days=14 --commit
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
    tenantId: (options.tenant as string) || 'default-tenant',
    ttlDays: options['ttl-days'] !== undefined ? Number(options['ttl-days']) : 14,
    commit: Boolean(options.commit),
  };
}

async function main() {
  const params = parseArgs();
  console.log(`[SEED DELIVERY] Target Tenant: ${params.tenantId}`);
  console.log(`[SEED DELIVERY] Mode: ${params.commit ? 'COMMIT (Write to DB)' : 'DRY RUN (No changes)'}`);

  let tenant: any = null;
  try {
    tenant = await prisma.tenant.findUnique({
      where: { id: params.tenantId },
      select: { id: true, name: true, settings: true },
    });
  } catch (err: any) {
    console.warn(`[SEED DELIVERY] Database connection note: ${err?.message?.split('\n')[0]}`);
  }

  const currentSettings = ((tenant?.settings as Record<string, any>) || {});
  const currentDelivery = (currentSettings.deliverySettings as Record<string, any>) || {};

  const validatedTtl =
    Number.isFinite(params.ttlDays) && params.ttlDays > 0
      ? Math.round(params.ttlDays)
      : (currentDelivery.estimateTtlDays ?? 14);

  const targetDeliverySettings = {
    ...currentDelivery,
    estimateTtlDays: validatedTtl,
  };

  console.log('\n[SEED DELIVERY] Nilai yang akan disimpan:');
  console.log(JSON.stringify(targetDeliverySettings, null, 2));

  if (!params.commit) {
    console.log('\n[DRY RUN] Eksekusi dihentikan tanpa commit. Tambahkan --commit untuk menyimpan permanen.');
    try { await prisma.$disconnect(); } catch {}
    return;
  }

  if (!tenant) {
    console.error(`[SEED DELIVERY] Gagal menyimpan: Database offline atau tenant '${params.tenantId}' tidak ditemukan.`);
    process.exit(1);
  }

  await prisma.tenant.update({
    where: { id: params.tenantId },
    data: {
      settings: {
        ...currentSettings,
        deliverySettings: targetDeliverySettings,
      },
    },
  });

  console.log(`\n[SEED DELIVERY] Berhasil memperbarui deliverySettings untuk tenant '${params.tenantId}'.`);
  try { await prisma.$disconnect(); } catch {}
}

main().catch(async (e) => {
  console.error('[SEED DELIVERY] Error:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
