const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- DB COLUMN VERIFICATION ---');
  const customerColumns = await prisma.$queryRaw`
    SELECT column_name, data_type, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'is_sandbox_test';
  `;
  console.log('Customer columns match:', customerColumns);

  const stagingMedicalColumns = await prisma.$queryRaw`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'medical_faq_staging' AND column_name IN ('matched_chunk_id', 'matched_similarity');
  `;
  console.log('Medical staging columns match:', stagingMedicalColumns);

  const stagingGeneralColumns = await prisma.$queryRaw`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'general_faq_staging' AND column_name IN ('matched_chunk_id', 'matched_similarity');
  `;
  console.log('General staging columns match:', stagingGeneralColumns);

  console.log('\n--- ORPHAN & INTEGRITY AUDIT ---');
  // 1. Check orphan conversations (customer_id not in customers)
  const orphanConversations = await prisma.$queryRaw`
    SELECT c.id, c.customer_id, c.created_at 
    FROM conversations c 
    LEFT JOIN customers cust ON c.customer_id = cust.id 
    WHERE cust.id IS NULL;
  `;
  console.log('Orphan Conversations (no Customer):', orphanConversations);

  // 2. Check orphan messages (conversation_id not in conversations)
  const orphanMessages = await prisma.$queryRaw`
    SELECT m.id, m.conversation_id, m.created_at 
    FROM messages m 
    LEFT JOIN conversations conv ON m.conversation_id = conv.id 
    WHERE conv.id IS NULL;
  `;
  console.log('Orphan Messages (no Conversation):', orphanMessages);

  // 3. Check recent non-sandbox customer activity in DB
  const recentCustomers = await prisma.customer.findMany({
    take: 10,
    orderBy: { created_at: 'desc' },
    select: { id: true, phone: true, name: true, is_sandbox_test: true, created_at: true }
  });
  console.log('Recent Customer Records:', recentCustomers);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  prisma.$disconnect();
});
