import { prisma } from '../src/db/client';

async function keep5Customers() {
  console.log('[CUSTOMER CLEANUP] Fetching existing customers...');
  const customers = await prisma.customer.findMany({
    orderBy: { created_at: 'desc' },
  });

  console.log(`Found ${customers.length} total customers.`);

  if (customers.length <= 5) {
    console.log('Customer count is already 5 or less. No deletion needed.');
    return;
  }

  const keep = customers.slice(0, 5);
  const deleteList = customers.slice(5);

  console.log('\n--- 5 CUSTOMERS TO KEEP ---');
  keep.forEach((c, idx) => {
    console.log(`${idx + 1}. ID: ${c.id} | Name: ${c.name || 'Unnamed'} | Phone: ${c.phone}`);
  });

  console.log(`\nDeleting ${deleteList.length} excess customers...`);

  const deleteIds = deleteList.map((c) => c.id);

  // Clean up related records first to prevent foreign key constraint errors
  await prisma.child.deleteMany({
    where: { customer_id: { in: deleteIds } },
  });

  await prisma.message.deleteMany({
    where: { conversation: { customer_id: { in: deleteIds } } },
  });

  await prisma.conversation.deleteMany({
    where: { customer_id: { in: deleteIds } },
  });

  await prisma.reservation.deleteMany({
    where: { customer_id: { in: deleteIds } },
  });

  await prisma.followUp.deleteMany({
    where: { customer_id: { in: deleteIds } },
  });

  await prisma.adClick.deleteMany({
    where: { customerId: { in: deleteIds } },
  });

  const res = await prisma.customer.deleteMany({
    where: { id: { in: deleteIds } },
  });

  console.log(`\n[CLEANUP SUCCESS] Deleted ${res.count} dummy customers. Exactly 5 customers remain in database.`);
}

keep5Customers()
  .catch((e) => {
    console.error('Cleanup error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
