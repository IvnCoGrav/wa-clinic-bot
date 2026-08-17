import { prisma } from '../src/db/client';
import { DEFAULT_SYSTEM_LABELS } from '../src/routes/admin/labels.subroute';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

async function seed() {
  console.log(`[SEED LABELS] Seeding default system labels for tenant ${DEFAULT_TENANT_ID}...`);
  for (const item of DEFAULT_SYSTEM_LABELS) {
    const label = await prisma.label.upsert({
      where: {
        tenant_id_name: {
          tenant_id: DEFAULT_TENANT_ID,
          name: item.name,
        },
      },
      update: { color: item.color },
      create: {
        tenant_id: DEFAULT_TENANT_ID,
        name: item.name,
        color: item.color,
      },
    });
    console.log(`- [OK] Label: ${label.name} (${label.color})`);
  }

  const all = await prisma.label.findMany({
    where: { tenant_id: DEFAULT_TENANT_ID },
  });
  console.log(`[SEED LABELS] Done. Total ${all.length} labels seeded.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('[SEED LABELS ERROR]', err);
  process.exit(1);
});
