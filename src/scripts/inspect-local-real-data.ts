import { prisma } from '../db/client';

async function main() {
  const allCustomers = await prisma.customer.findMany({
    where: { is_sandbox_test: false },
    include: {
      children: true,
      reservations: true,
      conversations: {
        include: {
          messages: true,
        },
      },
    },
  });

  // Filter out any dummy / test phone patterns
  const validRealCustomers = allCustomers.filter((c) => {
    const p = (c.phone || '').trim();
    if (!/^(628|08)\d{7,12}$/.test(p)) return false;
    if (p.startsWith('6289999') || p.startsWith('08571111') || p.startsWith('628123456789') || p === '0') return false;
    if (c.name && /TEST|Dummy|Sandbox|Tester/i.test(c.name)) return false;
    return true;
  });

  const totalChildren = validRealCustomers.reduce((acc, c) => acc + c.children.length, 0);
  const totalReservations = validRealCustomers.reduce((acc, c) => acc + c.reservations.length, 0);
  const totalConversations = validRealCustomers.reduce((acc, c) => acc + c.conversations.length, 0);
  const totalMessages = validRealCustomers.reduce(
    (acc, c) => acc + c.conversations.reduce((mAcc, conv) => mAcc + conv.messages.length, 0),
    0
  );

  console.log(`\n📊 [LOCAL REAL DATA STATS]:`);
  console.log(`   - Real Customers     : ${validRealCustomers.length}`);
  console.log(`   - Real Children      : ${totalChildren}`);
  console.log(`   - Real Reservations  : ${totalReservations}`);
  console.log(`   - Real Conversations : ${totalConversations}`);
  console.log(`   - Real Messages      : ${totalMessages}`);
}

main().finally(() => prisma.$disconnect());
