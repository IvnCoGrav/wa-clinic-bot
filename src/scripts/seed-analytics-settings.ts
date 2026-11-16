/**
 * src/scripts/seed-analytics-settings.ts
 *
 * Skrip CLI idempoten untuk seeding konfigurasi analitik per tenant
 * (cohortStartMonth, excludedCohortMonths, dailySlotsPerTherapist).
 *
 * Contoh pemakaian:
 *   npx tsx src/scripts/seed-analytics-settings.ts --tenant=default-tenant --cohort-start=2026-01 --excluded=2025-08 --slots=4
 *   npx tsx src/scripts/seed-analytics-settings.ts --tenant=default-tenant --cohort-start=2026-01 --excluded=2025-08 --slots=4 --commit
 */

import { prisma } from '../db/client';
import { parseCliArgs, getArgBoolean, getArgNumber, getArgString } from './lib/parse-args';

function loadParams() {
  const options = parseCliArgs();
  return {
    tenantId: getArgString(options, 'tenant', 'default-tenant'),
    cohortStartMonth: (options['cohort-start'] as string) || null,
    excludedMonths: options.excluded ? (options.excluded as string).split(',').map((s) => s.trim()) : [],
    dailySlots: getArgNumber(options, 'slots') ?? null,
    commit: getArgBoolean(options, 'commit', false),
  };
}

async function main() {
  const params = loadParams();
  console.log(`[SEED ANALYTICS] Target Tenant: ${params.tenantId}`);
  console.log(`[SEED ANALYTICS] Mode: ${params.commit ? 'COMMIT (Write to DB)' : 'DRY RUN (No changes)'}`);

  let tenant: any = null;
  try {
    tenant = await prisma.tenant.findUnique({
      where: { id: params.tenantId },
      select: { id: true, name: true, settings: true },
    });
  } catch (err: any) {
    console.warn(`[SEED ANALYTICS] Database connection note: ${err?.message?.split('\n')[0]}`);
  }

  const currentSettings = ((tenant?.settings as Record<string, any>) || {});
  const currentPerf = (currentSettings.metaPerformanceSettings as Record<string, any>) || {};

  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  const validatedCohortStart =
    params.cohortStartMonth && MONTH_RE.test(params.cohortStartMonth)
      ? params.cohortStartMonth
      : currentPerf.cohortStartMonth ?? null;

  const validatedExcluded =
    params.excludedMonths.length > 0
      ? Array.from(new Set(params.excludedMonths.filter((m) => MONTH_RE.test(m))))
      : currentPerf.excludedCohortMonths ?? [];

  const validatedSlots =
    params.dailySlots !== null && Number.isFinite(params.dailySlots) && params.dailySlots > 0
      ? Math.round(params.dailySlots)
      : currentPerf.dailySlotsPerTherapist ?? null;

  const targetPerfSettings = {
    ...currentPerf,
    cohortStartMonth: validatedCohortStart,
    excludedCohortMonths: validatedExcluded,
    dailySlotsPerTherapist: validatedSlots,
  };

  console.log('\n[SEED ANALYTICS] Nilai yang akan disimpan:');
  console.log(JSON.stringify(targetPerfSettings, null, 2));

  if (!params.commit) {
    console.log('\n[DRY RUN] Eksekusi dihentikan tanpa commit. Tambahkan --commit untuk menyimpan permanen.');
    try { await prisma.$disconnect(); } catch {}
    return;
  }

  if (!tenant) {
    console.error(`[SEED ANALYTICS] Gagal menyimpan: Database offline atau tenant '${params.tenantId}' tidak ditemukan.`);
    process.exit(1);
  }

  await prisma.tenant.update({
    where: { id: params.tenantId },
    data: {
      settings: {
        ...currentSettings,
        metaPerformanceSettings: targetPerfSettings,
      },
    },
  });

  console.log('\n[SUCCESS] Konfigurasi analitik berhasil disimpan ke database.');
  try { await prisma.$disconnect(); } catch {}
}

main().catch((err) => {
  console.error('[SEED ANALYTICS ERROR]', err);
  process.exit(1);
});
