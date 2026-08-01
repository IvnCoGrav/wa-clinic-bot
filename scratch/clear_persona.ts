import { prisma } from '../src/db/client';
const result = await prisma.tenantPersona.deleteMany({});
console.log('Cleared tenant_persona:', result.count, 'rows deleted — app will re-seed from updated file on next start');
await prisma.$disconnect();
