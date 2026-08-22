import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenantId = 'default-tenant';
  
  // Get recent conversations with their last few messages
  const conversations = await prisma.conversation.findMany({
    where: { tenant_id: tenantId },
    include: {
      customer: true,
      messages: {
        orderBy: { created_at: 'desc' },
        take: 10,
      },
    },
    orderBy: { last_message_at: 'desc' },
    take: 20,
  });

  console.log(`\n=== RECENT CHAT LOGS (last ${conversations.length} conversations) ===\n`);

  for (const conv of conversations) {
    const customer = conv.customer;
    const msgs = conv.messages.reverse(); // chronological order
    
    console.log(`┌─ Conversation: ${conv.id}`);
    console.log(`│  Customer: ${customer?.name || 'Unknown'} (${customer?.phone || 'No phone'})`);
    console.log(`│  State: ${conv.current_state} | Human: ${conv.is_human_handling ? 'YES' : 'NO'}`);
    console.log(`│  Last message: ${conv.last_message_at?.toISOString() || 'N/A'}`);
    console.log(`│  Sandbox test: ${customer?.is_sandbox_test ? 'YES' : 'NO'}`);
    console.log(`├─ Messages (${msgs.length}):`);
    
    for (const msg of msgs) {
      const direction = msg.direction === 'INBOUND' ? '📥 IN' : '📤 OUT';
      const sender = msg.sender_type || (msg.direction === 'INBOUND' ? 'Customer' : 'Bot');
      const content = msg.content?.substring(0, 100) || '[Media/Image]';
      const time = msg.created_at.toLocaleString('id-ID');
      console.log(`│  ${direction} [${time}] ${sender}: ${content}${msg.content?.length > 100 ? '...' : ''}`);
    }
    
    console.log(`└─\n`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});