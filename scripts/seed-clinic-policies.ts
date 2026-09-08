/**
 * scripts/seed-clinic-policies.ts
 * Seed 7 topik awal SOP klinik ke tabel clinic_policies per-tenant
 * Jalankan: npx tsx scripts/seed-clinic-policies.ts
 */
import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';
import { getStaticFallbackTopics } from '../src/v3/tools/clinic-faq.tool';

async function seed() {
  const topics = getStaticFallbackTopics();
  console.log(`[SEED] Seeding ${topics.length} clinic policies untuk tenant ${DEFAULT_TENANT_ID}...`);
  for (const t of topics) {
    const existing = await (prisma as any).clinicPolicy.findUnique({
      where: { tenant_id_topic: { tenant_id: DEFAULT_TENANT_ID, topic: t.topic } },
    });
    if (existing) {
      console.log(`  - ${t.topic} sudah ada, skip`);
      continue;
    }
    await (prisma as any).clinicPolicy.create({
      data: {
        tenant_id: DEFAULT_TENANT_ID,
        topic: t.topic,
        title: t.topic,
        factual_summary: t.factualSummary,
        suggested_reply: t.suggestedReply,
        is_active: true,
      },
    });
    console.log(`  + ${t.topic} seeded`);
  }
  console.log('[SEED] Done');
  await prisma.$disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
