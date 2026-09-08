// Jalankan: npx tsx src/scripts/check-router-accuracy.ts --days=7
// Hitung akurasi AI Router (shadow mode) terhadap legacy pipeline.
// Kriteria matikan AI_ROUTER_SHADOW_MODE:
//   1. escalation match rate >= 98% selama >= 7 hari berturut-turut, DAN
//   2. mismatch terkait MEDICAL_CONCERN = 0 (hard-zero), DAN
//   3. UNMAPPED rate di legacy_intent < 5%.
import { prisma } from '../db/client';

function parseDays(): number {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  return arg ? parseInt(arg.split('=')[1], 10) || 7 : 7;
}

async function checkAccuracy(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const total = await prisma.aiRouterEvaluation.count({
    where: { created_at: { gte: since }, legacy_intent: { not: 'UNMAPPED' } },
  });

  const intentMatches = await prisma.aiRouterEvaluation.count({
    where: { created_at: { gte: since }, legacy_intent: { not: 'UNMAPPED' }, intent_match: true },
  });

  const escalationMatches = await prisma.aiRouterEvaluation.count({
    where: { created_at: { gte: since }, legacy_intent: { not: 'UNMAPPED' }, escalation_match: true },
  });

  const unmappedTotal = await prisma.aiRouterEvaluation.count({
    where: { created_at: { gte: since }, legacy_intent: 'UNMAPPED' },
  });

  const escalationMismatchesMedical = await prisma.aiRouterEvaluation.findMany({
    where: {
      created_at: { gte: since },
      escalation_match: false,
      OR: [{ legacy_intent: 'MEDICAL_CONCERN' }, { llm_intent: 'MEDICAL_CONCERN' }],
    },
    select: { message_text: true, llm_intent: true, legacy_intent: true, created_at: true },
  });

  const allTotal = await prisma.aiRouterEvaluation.count({ where: { created_at: { gte: since } } });

  const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(2) : 'N/A');

  console.log(`Periode: ${days} hari terakhir`);
  console.log(`Total evaluasi (semua): ${allTotal}`);
  console.log(`Total evaluasi (excl. UNMAPPED): ${total}`);
  console.log(`Intent match rate: ${pct(intentMatches, total)}%`);
  console.log(`Escalation match rate: ${pct(escalationMatches, total)}%`);
  console.log(`UNMAPPED rate: ${pct(unmappedTotal, allTotal)}% (target < 5%)`);

  console.log(`\n⚠️ Mismatch terkait MEDICAL_CONCERN (WAJIB 0 sebelum matikan shadow mode):`);
  if (escalationMismatchesMedical.length === 0) {
    console.log('  (tidak ada — OK)');
  } else {
    console.table(escalationMismatchesMedical);
  }

  const medicalOk = escalationMismatchesMedical.length === 0;
  const escOk = total > 0 ? escalationMatches / total >= 0.98 : false;
  const unmappedOk = allTotal > 0 ? unmappedTotal / allTotal < 0.05 : false;

  console.log(`\n[GATE CHECK] escalation>=98%: ${escOk ? 'PASS' : 'FAIL'} | medical mismatch=0: ${medicalOk ? 'PASS' : 'FAIL'} | unmapped<5%: ${unmappedOk ? 'PASS' : 'FAIL'}`);
  if (escOk && medicalOk && unmappedOk) {
    console.log('✅ Semua gate lolos — aman utk mematikan AI_ROUTER_SHADOW_MODE.');
  } else {
    console.log('❌ Belum lolos gate — tetap shadow mode.');
  }
}

checkAccuracy(parseDays()).catch((err) => {
  console.error('Gagal menjalankan cek akurasi:', err);
  process.exit(1);
});
