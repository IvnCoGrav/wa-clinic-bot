import { V3AgentRunner } from '../src/v3/agent/agent-runner';
import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

async function runCustomerCaseTest() {
  console.log('=== TEST CASE REPRODUKSI CUSTOMER 62895622156277 ===\n');

  const testPhone = '62895622156277_test';
  const tenantId = DEFAULT_TENANT_ID;

  let customer = await prisma.customer.findUnique({
    where: { phone: testPhone },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        phone: testPhone,
        name: 'Bunda 62895622156277',
        tenant_id: tenantId,
        preferences: {},
      },
    });
  } else {
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        name: 'Bunda 62895622156277',
        kelurahan: null,
        kecamatan: null,
        kota: null,
        distance_km: null,
        ongkir: null,
        preferences: {},
      },
    });
  }

  let conv = await prisma.conversation.findFirst({
    where: { customer_id: customer.id },
  });

  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        customer_id: customer.id,
        tenant_id: tenantId,
        current_state: 'INITIAL',
      },
    });
  } else {
    await prisma.message.deleteMany({ where: { conversation_id: conv.id } });
  }

  const turns = [
    'Kak ini area mana?',
    'Kalau terapi batuk pilek harganya berapa kak? Dapat apa aja?',
    'Sedati ada ongkirkah kak?',
    'Sedati pepe',
  ];

  for (let i = 0; i < turns.length; i++) {
    const text = turns[i];
    console.log(`\n==================================================`);
    console.log(`[USER TURN ${i + 1}]: "${text}"`);
    console.log(`==================================================`);

    const result = await V3AgentRunner.processMessage({
      tenantId,
      customerId: customer.id,
      conversationId: conv.id,
      phone: testPhone,
      chatId: `${testPhone}@c.us`,
      incomingText: text,
    });

    console.log(`\n[BOT REPLY]:\n${result.replyText}`);
    console.log(`\n[EXECUTED TOOLS]:`, result.executedTools.map((t: any) => `${t.name}(${JSON.stringify(t.args)})`));
  }

  console.log('\n=== TEST CASE SELESAI ===');
  await prisma.$disconnect();
}

runCustomerCaseTest().catch(err => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});
