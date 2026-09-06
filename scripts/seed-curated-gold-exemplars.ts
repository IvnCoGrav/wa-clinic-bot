/**
 * SEED KOLEKSI EMAS — Contoh Chat Bidan Yusi (25 Master) ke Database
 * ==================================================================
 * NON-DESTRUKTIF & IDEMPOTEN:
 * - Mencocokkan per natural key `(tenant_id, scenario)` — sama dengan strategi
 *   resetToDefaults() di few-shot-exemplars.ts.
 * - Contoh KUSTOM buatan admin (mis. "Pertanyaan Jam Oprasional") TIDAK pernah
 *   dihapus/ditimpa karena scenarionya tidak ada di dataset ini.
 * - Bila record sudah ada (scenario cocok): isi & tags diperbarui agar sinkron
 *   dengan versi terbaru, ID/sort_order dipertahankan.
 * - Bila belum ada: dibuat dengan sort_order di belakang urutan yang sudah ada.
 *
 * Jalankan (dari repo root, env DATABASE_URL menunjuk DB tujuan):
 *   npx tsx scripts/seed-curated-gold-exemplars.ts
 */
import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';
import { GOLD_FEW_SHOT_EXEMPLARS } from '../src/slot-engine/gold-few-shot-exemplars';

async function main() {
  const tenantId = process.env.FEW_SHOT_TENANT_ID || DEFAULT_TENANT_ID;
  console.log(`🚀 Seed Koleksi Emas (${GOLD_FEW_SHOT_EXEMPLARS.length} contoh) untuk tenant "${tenantId}"...\n`);

  // Ambil seluruh record tenant untuk menghitung sort_order lanjutan & deteksi duplikat.
  const existing = await prisma.fewShotExemplar.findMany({
    where: { tenant_id: tenantId },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
  });
  const byScenario = new Map<string, (typeof existing)[number]>();
  for (const row of existing) byScenario.set(row.scenario, row);
  let maxSort = existing.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const gold of GOLD_FEW_SHOT_EXEMPLARS) {
    const found = byScenario.get(gold.scenario);
    if (found) {
      // Sudah ada → sinkronkan isi/tags (pertahankan ID & sort_order admin).
      await prisma.fewShotExemplar.update({
        where: { id: found.id },
        data: {
          customer_message: gold.customerMessage,
          ideal_response: gold.idealResponse,
          tags: gold.tags,
          is_active: true,
        },
      });
      updated++;
    } else {
      // Baru → tambahkan di urutan paling belakang.
      maxSort += 1;
      await prisma.fewShotExemplar.create({
        data: {
          tenant_id: tenantId,
          scenario: gold.scenario,
          customer_message: gold.customerMessage,
          ideal_response: gold.idealResponse,
          tags: gold.tags,
          is_active: true,
          sort_order: maxSort,
        },
      });
      inserted++;
    }
  }

  const total = existing.length + inserted;
  console.log('✅ Seed selesai.');
  console.log(`   - Insert baru   : ${inserted}`);
  console.log(`   - Sinkron (update): ${updated}`);
  console.log(`   - Tidak berubah : ${skipped}`);
  console.log(`   - Total row tenant "${tenantId}": ${total}`);
  console.log('\nℹ️  Contoh kustom admin dipertahankan (tidak dihapus/ditimpa).');
}

main()
  .catch((e) => {
    console.error('❌ Seed gagal:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
