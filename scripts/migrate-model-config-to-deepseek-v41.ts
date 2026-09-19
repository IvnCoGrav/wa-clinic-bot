/**
 * migrate-model-config-to-deepseek-v41.ts
 *
 * Migrasi data idempoten untuk tabel `tenant_ai_config`: menyeragamkan seluruh
 * baris task AI non-system ke model kanonik Kenari `deepseek-v4-1-flash`
 * (label: "DeepSeek-V4.1-Flash") dan provider `Kenari`.
 *
 * Konteks: sebelum standardisasi, DB menyimpan model provider-asing
 * (mis. `gpt-4o-mini`, `MiniMax-M2.7-highspeed`, `deepseek-v4-flash`) padahal
 * provider aktif adalah KENARI — menyebabkan HTTP 400 `no price for model`.
 *
 * Idempoten: aman dijalankan berulang. Baris yang sudah sesuai tidak diubah.
 *
 * Penggunaan (LOKAL/STAGING saja):
 *   npx tsx scripts/migrate-model-config-to-deepseek-v41.ts --dry-run
 *   npx tsx scripts/migrate-model-config-to-deepseek-v41.ts
 *
 * Guard keamanan: DILARANG dijalankan di produksi / DB non-localhost.
 */

import 'dotenv/config';

const TARGET_MODEL = 'deepseek-v4-1-flash';
const TARGET_PROVIDER = 'Kenari';
const SYSTEM_TASKS = new Set(['GLOBAL_BOT_ENABLED', 'ACTIVE_LLM_PROVIDER']);

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.IS_PRODUCTION === 'true' ||
    process.env.SERVER_MODE === 'production' ||
    (process.env.DATABASE_URL &&
      !process.env.DATABASE_URL.includes('localhost') &&
      !process.env.DATABASE_URL.includes('127.0.0.1'));

  if (isProduction) {
    console.error('\n❌ [SECURITY BLOCKED]: Script migrasi model DILARANG dijalankan di Live Server / Production Database!');
    console.error('Jalankan manual dengan verifikasi di lingkungan lokal/staging.\n');
    process.exit(1);
  }

  const { prisma } = await import('../src/db/client');

  const rows = await prisma.tenantAiConfig.findMany({
    where: { task: { notIn: Array.from(SYSTEM_TASKS) } },
    orderBy: [{ tenant_id: 'asc' }, { task: 'asc' }],
  });

  console.log(`\n=== Migrasi tenant_ai_config → ${TARGET_MODEL} ===`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN (tidak ada perubahan)' : 'APPLY'}`);
  console.log(`Total baris task non-system: ${rows.length}\n`);

  let changed = 0;
  let skipped = 0;

  for (const row of rows) {
    const alreadyCanonical = row.model_name === TARGET_MODEL && row.provider === TARGET_PROVIDER;
    if (alreadyCanonical) {
      skipped++;
      continue;
    }

    console.log(
      `  [${row.tenant_id}] ${row.task}: ` +
        `${row.provider}/${row.model_name} → ${TARGET_PROVIDER}/${TARGET_MODEL}`
    );

    if (!dryRun) {
      await prisma.tenantAiConfig.update({
        where: { id: row.id },
        data: { model_name: TARGET_MODEL, provider: TARGET_PROVIDER },
      });
    }
    changed++;
  }

  console.log(`\nSelesai. Diubah: ${changed}, sudah sesuai (skip): ${skipped}.`);
  if (dryRun && changed > 0) {
    console.log('Jalankan tanpa --dry-run untuk menerapkan.\n');
  }

  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Migrasi gagal:', err?.message || err);
  process.exit(1);
});
