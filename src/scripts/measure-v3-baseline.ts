/**
 * src/scripts/measure-v3-baseline.ts
 * Mengukur metrik baseline V3: Tool Call Rate, Token Usage, dan Cost per Turn.
 * Jalankan: npx tsx src/scripts/measure-v3-baseline.ts --days=7
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

async function runBaselineMeasurement() {
  const args = process.argv.slice(2);
  const daysArg = args.find((a) => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7;
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.log(`\n📊 [V3 BASELINE AUDIT] Menganalisa log pesan ${days} hari terakhir (sejak ${sinceDate.toISOString()})...\n`);

  try {
    const outboundMessages = await prisma.message.findMany({
      where: {
        tenant_id: DEFAULT_TENANT_ID,
        direction: 'OUTBOUND',
        created_at: { gte: sinceDate },
      },
      select: {
        id: true,
        created_at: true,
        payload_raw: true,
      },
    });

    const v3Messages = outboundMessages.filter((m) => {
      const p: any = m.payload_raw;
      return p && p.v3Execution;
    });

    if (v3Messages.length === 0) {
      console.log('⚠️ Belum ditemukan pesan dengan metadata v3Execution di database.');
      console.log('Pastikan Task 0.5.1 sudah aktif di lingkungan pengujian sebelum menjalankan pengukuran.');
      return;
    }

    let totalTokens = 0;
    let totalCostIdr = 0;
    let turnsWithTools = 0;
    const toolFrequency: Record<string, number> = {};

    for (const msg of v3Messages) {
      const meta = (msg.payload_raw as any).v3Execution;
      const tokens = meta.tokens?.total || 0;
      const cost = meta.costIdr || 0;
      const tools: Array<{ name: string }> = meta.executedTools || [];

      totalTokens += tokens;
      totalCostIdr += cost;

      if (tools.length > 0) {
        turnsWithTools++;
        for (const t of tools) {
          toolFrequency[t.name] = (toolFrequency[t.name] || 0) + 1;
        }
      }
    }

    const totalTurns = v3Messages.length;
    const toolCallRate = ((turnsWithTools / totalTurns) * 100).toFixed(1);
    const avgTokens = (totalTokens / totalTurns).toFixed(0);
    const avgCostIdr = (totalCostIdr / totalTurns).toFixed(2);

    console.log('====================================================');
    console.log('📈 RINGKASAN METRIK BASELINE V3 AGENT');
    console.log('====================================================');
    console.log(`Total Turn Dianalisa      : ${totalTurns}`);
    console.log(`Tool-Call Rate (% Turn)   : ${toolCallRate}% (${turnsWithTools}/${totalTurns})`);
    console.log(`Rata-Rata Token / Turn    : ${avgTokens} tokens`);
    console.log(`Rata-Rata Biaya / Turn    : Rp ${avgCostIdr}`);
    console.log('----------------------------------------------------');
    console.log('Distribusi Pemanggilan Tool:');
    for (const [toolName, count] of Object.entries(toolFrequency)) {
      console.log(`  • ${toolName.padEnd(25)} : ${count}x (${((count / totalTurns) * 100).toFixed(1)}%)`);
    }
    console.log('====================================================\n');
  } catch (err: any) {
    console.error('Gagal menjalankan audit baseline:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

void runBaselineMeasurement();
