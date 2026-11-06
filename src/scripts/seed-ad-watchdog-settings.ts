/**
 * src/scripts/seed-ad-watchdog-settings.ts
 *
 * Skrip CLI idempoten untuk seeding & konfigurasi Ad Watchdog per tenant
 * (Tenant.settings.adWatchdog).
 *
 * Contoh pemakaian:
 *   npx tsx src/scripts/seed-ad-watchdog-settings.ts --tenant=default-tenant --enabled=true
 *   npx tsx src/scripts/seed-ad-watchdog-settings.ts --tenant=default-tenant --enabled=true --min-views=30 --commit
 */

import { prisma } from '../db/client';
import { AdWatchdogSettingsSchema, DEFAULT_AD_WATCHDOG_SETTINGS } from '../services/ad-watchdog.service';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      if (val !== undefined) {
        options[key] = val;
      } else {
        options[key] = true;
      }
    }
  }

  return {
    tenantId: (options.tenant as string) || 'default-tenant',
    enabled: options.enabled !== undefined ? options.enabled === 'true' || options.enabled === true : undefined,
    minViews: options['min-views'] ? Number(options['min-views']) : undefined,
    minCtr: options['min-ctr'] ? Number(options['min-ctr']) : undefined,
    minAgedClicks: options['min-aged-clicks'] ? Number(options['min-aged-clicks']) : undefined,
    graceMinutes: options['grace-minutes'] ? Number(options['grace-minutes']) : undefined,
    cooldownMinutes: options['cooldown-minutes'] ? Number(options['cooldown-minutes']) : undefined,
    lowTrafficRatio: options['low-traffic-ratio'] ? Number(options['low-traffic-ratio']) : undefined,
    startHour: options['start-hour'] ? Number(options['start-hour']) : undefined,
    endHour: options['end-hour'] ? Number(options['end-hour']) : undefined,
    telegramTopic: options['telegram-topic'] !== undefined
      ? (options['telegram-topic'] === 'null' ? null : Number(options['telegram-topic']))
      : undefined,
    commit: Boolean(options.commit),
  };
}

async function main() {
  const params = parseArgs();
  console.log(`[SEED AD WATCHDOG] Target Tenant: ${params.tenantId}`);
  console.log(`[SEED AD WATCHDOG] Mode: ${params.commit ? 'COMMIT (Write to DB)' : 'DRY RUN (No changes)'}`);

  let tenant: any = null;
  try {
    tenant = await prisma.tenant.findUnique({
      where: { id: params.tenantId },
      select: { id: true, name: true, settings: true },
    });
  } catch (err: any) {
    console.warn(`[SEED AD WATCHDOG] Database connection note: ${err?.message?.split('\n')[0]}`);
  }

  const currentSettings = ((tenant?.settings as Record<string, any>) || {});
  const currentWatchdog = (currentSettings.adWatchdog as Record<string, any>) || {};

  const merged = {
    ...DEFAULT_AD_WATCHDOG_SETTINGS,
    ...currentWatchdog,
  };

  if (params.enabled !== undefined) merged.enabled = params.enabled;
  if (params.minViews !== undefined) merged.minViews = params.minViews;
  if (params.minCtr !== undefined) merged.minCtr = params.minCtr;
  if (params.minAgedClicks !== undefined) merged.minAgedClicks = params.minAgedClicks;
  if (params.graceMinutes !== undefined) merged.graceMinutes = params.graceMinutes;
  if (params.cooldownMinutes !== undefined) merged.cooldownMinutes = params.cooldownMinutes;
  if (params.lowTrafficRatio !== undefined) merged.lowTrafficRatio = params.lowTrafficRatio;
  if (params.startHour !== undefined) merged.activeStartHourWib = params.startHour;
  if (params.endHour !== undefined) merged.activeEndHourWib = params.endHour;
  if (params.telegramTopic !== undefined) merged.telegramTopicId = params.telegramTopic;

  const parsed = AdWatchdogSettingsSchema.safeParse(merged);
  if (!parsed.success) {
    console.error('[SEED AD WATCHDOG] Validasi gagal:', parsed.error.issues);
    process.exit(1);
  }

  const targetSettings = parsed.data;

  console.log('\n[SEED AD WATCHDOG] Konfigurasi saat ini:');
  console.log(JSON.stringify(currentWatchdog, null, 2));

  console.log('\n[SEED AD WATCHDOG] Nilai yang akan disimpan:');
  console.log(JSON.stringify(targetSettings, null, 2));

  if (!params.commit) {
    console.log('\n[DRY RUN] Eksekusi dihentikan tanpa commit. Tambahkan --commit untuk menyimpan permanen.');
    try { await prisma.$disconnect(); } catch {}
    return;
  }

  if (!tenant) {
    console.error(`[SEED AD WATCHDOG] Gagal menyimpan: Database offline atau tenant '${params.tenantId}' tidak ditemukan.`);
    process.exit(1);
  }

  await prisma.tenant.update({
    where: { id: params.tenantId },
    data: {
      settings: {
        ...currentSettings,
        adWatchdog: targetSettings,
      },
    },
  });

  console.log('\n[SUCCESS] Konfigurasi Ad Watchdog berhasil disimpan ke database.');
  try { await prisma.$disconnect(); } catch {}
}

main().catch((err) => {
  console.error('[SEED AD WATCHDOG ERROR]', err);
  process.exit(1);
});
