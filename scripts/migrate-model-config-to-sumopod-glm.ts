/**
 * migrate-model-config-to-sumopod-glm.ts
 *
 * Migrasi data idempoten untuk tabel `tenant_ai_config`: menyeragamkan seluruh
 * baris task AI ke golden defaults SumoPod (server utama) dan mengunci
 * `ACTIVE_LLM_PROVIDER = SUMOPOD`.
 *
 * Peta golden (mirror `AiModelConfigService.resetToGoldenDefaults`):
 * - CHAT_REPLY            -> SumoPod / glm-5.3-flash
 * - AI_VERIFIER           -> SumoPod / glm-5.3-flash
 * - CHAT_REPLY_DEEP       -> SumoPod / deepseek-v4-flash-0731:netra
 * - HARVESTING            -> SumoPod / deepseek-v4-flash-0731:netra
 * - SUMMARIZATION         -> SumoPod / deepseek-v4-flash-0731:netra
 * - PII_SCRUBBING         -> SumoPod / deepseek-v4-flash-0731:netra
 * - INTENT_CLASSIFICATION -> SumoPod / deepseek-v4-flash-0731:netra
 * - MEDICAL_CHECK         -> TIDAK disentuh (deterministik, terkunci)
 * - GLOBAL_BOT_ENABLED    -> TIDAK disentuh
 *
 * Konteks: DB adalah sumber kebenaran (loadConfigsFromDb menimpa env).
 * Tanpa migrasi ini, .env SUMOPOD tidak berpengaruh karena baris DB lama
 * (Kenari/deepseek-v4-1-flash) tetap menang saat boot.
 *
 * Idempoten: aman dijalankan berulang. Baris yang sudah sesuai tidak diubah.
 *
 * Penggunaan (LOKAL/STAGING saja):
 *   npx tsx scripts/migrate-model-config-to-sumopod-glm.ts --dry-run
 *   npx tsx scripts/migrate-model-config-to-sumopod-glm.ts
 *
 * Guard keamanan: DILARANG dijalankan di produksi / DB non-localhost.
 */

import 'dotenv/config';

const GOLDEN_MAP: Record<string, { provider: string; model: string }> = {
  CHAT_REPLY: { provider: 'SumoPod', model: 'glm-5.3-flash' },
  AI_VERIFIER: { provider: 'SumoPod', model: 'glm-5.3-flash' },
  CHAT_REPLY_DEEP: { provider: 'SumoPod', model: 'deepseek-v4-flash-0731:netra' },
  HARVESTING: { provider: 'SumoPod', model: 'deepseek-v4-flash-0731:netra' },
  SUMMARIZATION: { provider: 'SumoPod', model: 'deepseek-v4-flash-0731:netra' },
  PII_SCRUBBING: { provider: 'SumoPod', model: 'deepseek-v4-flash-0731:netra' },
  INTENT_CLASSIFICATION: { provider: 'SumoPod', model: 'deepseek-v4-flash-0731:netra' },
};

// Task yang TIDAK BOLEH diubah migrasi ini.
const PROTECTED_TASKS = new Set(['GLOBAL_BOT_ENABLED', 'ACTIVE_LLM_PROVIDER', 'MEDICAL_CHECK']);

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
    orderBy: [{ tenant_id: 'asc' }, { task: 'asc' }],
  });

  console.log('\n=== Migrasi tenant_ai_config → golden SumoPod (glm-5.3-flash/netra) ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN (tidak ada perubahan)' : 'APPLY'}`);
  console.log(`Total baris: ${rows.length}\n`);

  let changed = 0;
  let skipped = 0;

  for (const row of rows) {
    if (PROTECTED_TASKS.has(row.task)) {
      if (row.task === 'ACTIVE_LLM_PROVIDER' && row.model_name !== 'SUMOPOD') {
        console.log(`  [${row.tenant_id}] ACTIVE_LLM_PROVIDER: ${row.model_name} → SUMOPOD`);
        if (!dryRun) {
          await prisma.tenantAiConfig.update({
            where: { id: row.id },
            data: { model_name: 'SUMOPOD' },
          });
        }
        changed++;
      } else {
        skipped++;
      }
      continue;
    }

    const golden = GOLDEN_MAP[row.task];
    if (!golden) {
      console.log(`  [${row.tenant_id}] ${row.task}: task tak dikenal — DILEWATI (${row.provider}/${row.model_name})`);
      skipped++;
      continue;
    }

    if (row.provider === golden.provider && row.model_name === golden.model) {
      skipped++;
      continue;
    }

    console.log(
      `  [${row.tenant_id}] ${row.task}: ` +
        `${row.provider}/${row.model_name} → ${golden.provider}/${golden.model}`
    );

    if (!dryRun) {
      await prisma.tenantAiConfig.update({
        where: { id: row.id },
        data: { provider: golden.provider, model_name: golden.model },
      });
    }
    changed++;
  }

  console.log(`\nSelesai. Diubah: ${changed}, sudah sesuai/dilewati: ${skipped}.`);
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
