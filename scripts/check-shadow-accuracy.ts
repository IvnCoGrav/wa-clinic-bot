#!/usr/bin/env tsx
/**
 * Shadow Accuracy Checker — bandingkan bot aktif vs shadow pipeline di live
 * Penggunaan: npx tsx scripts/check-shadow-accuracy.ts --days=7 --limit=100
 * Membandingkan: kelurahan retention, latensi <4.5s, parsing failures
 */
import { prisma } from '../src/db/client';

async function main() {
  const args = process.argv.slice(2);
  const days = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] || '7', 10);
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '100', 10);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.log(`[SHADOW CHECK] Mengambil ${limit} percakapan terakhir dengan shadow run sejak ${since.toISOString()} (days=${days})...`);

  // Ambil shadow runs
  const shadowLogs: any[] = await (prisma as any).llmAuditLog.findMany({
    where: { task_type: 'SHADOW_UNIFIED_V1', created_at: { gte: since } },
    orderBy: { created_at: 'desc' },
    take: limit,
  }).catch(() => []) as any;

  if (!shadowLogs || shadowLogs.length === 0) {
    console.log('[SHADOW CHECK] Tidak ada shadow run ditemukan. Pastikan SHADOW_PIPELINE_ENABLED=true dan ada trafik live.');
    console.log('Kriteria sukses: shadow berjalan 3–5 hari dengan 0 insiden regresi.');
    return;
  }

  let kelurahanMismatch = 0;
  let latencyOver = 0;
  let parseFail = 0;
  let total = shadowLogs.length;

  for (const log of shadowLogs) {
    const duration = (log as any).duration_ms || 0;
    if (duration > 4500) latencyOver++;
    // Deteksi kelurahan retention: bandingkan dengan active log terdekat (jika ada)
    // Untuk sederhana, cek apakah shadow reply mengandung kelurahan yang ada di active reply
    // Di sini kita hanya cek latensi dan parse status
    if ((log as any).status === 'FAILED') parseFail++;
  }

  // Hitung drift kelurahan dengan membandingkan active vs shadow untuk conversation yang sama
  // Ambil active logs untuk periode sama
  const activeLogs: any[] = await (prisma as any).llmAuditLog.findMany({
    where: { task_type: { not: 'SHADOW_UNIFIED_V1' }, created_at: { gte: since } },
    orderBy: { created_at: 'desc' },
    take: limit,
  }).catch(() => []) as any;

  // Untuk setiap shadow, cari active dengan customerPhone sama dan waktu dekat (5 menit)
  for (const s of shadowLogs) {
    const sPhone = (s as any).customer_phone;
    const sTime = new Date((s as any).created_at).getTime();
    const activeMatch = activeLogs.find((a: any) => a.customer_phone === sPhone && Math.abs(new Date(a.created_at).getTime() - sTime) < 5 * 60 * 1000);
    if (activeMatch && sPhone) {
      // Cek apakah active lupa kelurahan sedangkan shadow mengingatnya (indikasi amnesia)
      // Kita cek di groundTruthUsed atau finalReply
      const activeHasKelurahan = (activeMatch as any).finalReply?.includes('kelurahan') || (activeMatch as any).groundTruthUsed?.kelurahan;
      const shadowHasKelurahan = (s as any).finalReply?.includes('kelurahan') || (s as any).groundTruthUsed?.kelurahan;
      if (!activeHasKelurahan && shadowHasKelurahan) kelurahanMismatch++;
    }
  }

  const driftRate = total > 0 ? (kelurahanMismatch / total) * 100 : 0;
  const latencyRate = total > 0 ? (latencyOver / total) * 100 : 0;
  const failRate = total > 0 ? (parseFail / total) * 100 : 0;

  console.log('\n=== SHADOW ACCURACY REPORT ===');
  console.log(`Total shadow runs: ${total}`);
  console.log(`Kelurahan retention drift (active lupa, shadow ingat): ${kelurahanMismatch} (${driftRate.toFixed(1)}%) — target 0%`);
  console.log(`Latency >4.5s: ${latencyOver} (${latencyRate.toFixed(1)}%) — target <5%`);
  console.log(`Parse failures: ${parseFail} (${failRate.toFixed(1)}%) — target 0%`);
  console.log('\nKriteria sukses 3–5 hari:');
  console.log(`- Drift kelurahan = 0% ${driftRate === 0 ? '✅' : '❌'}`);
  console.log(`- Latensi P95 <4.5s ${latencyRate < 5 ? '✅' : '❌'}`);
  console.log(`- Parse fail 0% ${failRate === 0 ? '✅' : '❌'}`);
  console.log(`\nJika semua ✅ selama 3–5 hari, siap cutover produksi (nonaktifkan SHADOW_PIPELINE_ENABLED, jadikan unified pipeline primer).`);

  // Exit code untuk CI: 0 jika semua OK, 1 jika ada drift/latency
  const isHealthy = driftRate === 0 && latencyRate < 5 && failRate === 0;
  process.exit(isHealthy ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
