import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { id: DEFAULT_TENANT_ID },
  });
  console.log('Current Tenant Settings in DB:');
  console.log(tenant);
}

main().catch(console.error).finally(async () => { await prisma.$disconnect(); });
