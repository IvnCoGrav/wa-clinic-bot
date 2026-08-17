import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

async function main() {
  console.log('🔍 [AUDIT NAMA CUSTOMER] Memeriksa seluruh customer di database...');

  const customers = await prisma.customer.findMany({
    where: { tenant_id: DEFAULT_TENANT_ID },
    select: {
      id: true,
      phone: true,
      name: true,
      _count: {
        select: {
          conversations: true,
        },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  const matched = customers.filter((c) => c.name && c.name.trim() !== '' && c.name !== '~');
  const unmatched = customers.filter((c) => !c.name || c.name.trim() === '' || c.name === '~');

  console.log(`\n📊 Ringkasan Customer di Database:`);
  console.log(`   - Total Customer: ${customers.length}`);
  console.log(`   - Sudah Cocok (Memiliki Nama): ${matched.length} (${Math.round((matched.length / customers.length) * 100)}%)`);
  console.log(`   - Belum Ada Nama: ${unmatched.length} (${Math.round((unmatched.length / customers.length) * 100)}%)`);

  if (unmatched.length > 0) {
    console.log('\n📋 Daftar Customer yang Belum Ada Nama:');
    for (const u of unmatched) {
      console.log(`   - HP: ${u.phone} | Name: "${u.name || '(null)'}"`);
    }
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
