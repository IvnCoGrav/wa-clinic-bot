const { prisma } = require('./dist/db/client');

async function diagnose() {
  console.log('='.repeat(80));
  console.log('🔍 LIVE SERVER AI & CONVERSATION DIAGNOSTIC');
  console.log('='.repeat(80));

  const tenants = await prisma.tenant.findMany();
  console.log('\n--- 🏢 TENANTS CONFIG ---');
  for (const t of tenants) {
    console.log(`Tenant ID: ${t.id} (${t.name})`);
    console.log(`- is_active: ${t.is_active}`);
    console.log(`- ai_customer_scope: ${t.ai_customer_scope}`);
    console.log(`- telegram_chat_id: ${t.telegram_chat_id || 'NOT SET'}`);
  }

  const aiConfigs = await prisma.tenantAiConfig.findMany();
  console.log('\n--- 🤖 AI MODEL CONFIGS ---');
  for (const c of aiConfigs) {
    console.log(`Task: ${c.task.padEnd(25)} | Provider: ${c.provider.padEnd(10)} | Model: ${c.model_name.padEnd(25)}`);
  }

  console.log('\n--- 💬 RECENT 20 CONVERSATIONS & HUMAN HANDLING REASONS ---');
  const recentConvs = await prisma.conversation.findMany({
    orderBy: { updated_at: 'desc' },
    take: 20,
    include: {
      customer: true,
      messages: {
        orderBy: { timestamp: 'desc' },
        take: 3,
      },
    },
  });

  for (const c of recentConvs) {
    const phone = c.customer?.phone || 'UNKNOWN';
    const name = c.customer?.name || '-';
    const updated = c.updated_at.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    console.log(`\n📱 Phone: ${phone} (${name}) | State: ${c.current_state}`);
    console.log(`   is_human_handling: ${c.is_human_handling} | Reason: ${c.escalation_reason || 'N/A'}`);
    console.log(`   Human Handling Since: ${c.human_handling_since ? c.human_handling_since.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'N/A'}`);
    console.log(`   Last Discussed Treatment: ${c.last_discussed_treatment || 'None'}`);
    console.log(`   Updated: ${updated}`);
    if (c.messages && c.messages.length > 0) {
      console.log('   Recent Messages:');
      for (const m of c.messages.reverse()) {
        const dir = m.direction === 'inbound' ? '📥 Cust' : '📤 Bot';
        const txt = (m.content || '').replace(/\n/g, ' ').substring(0, 80);
        console.log(`     ${dir}: "${txt}" (${m.timestamp.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })})`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  process.exit(0);
}

diagnose().catch(err => {
  console.error('Diagnostic error:', err);
  process.exit(1);
});
