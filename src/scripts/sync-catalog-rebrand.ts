/**
 * sync-catalog-rebrand.ts — Sinkronisasi rebrand "Kala" TS defaults → clinic_services DB.
 *
 * Latar: commit rebrand mengganti nama/deskripsi di DEFAULT_CLINIC_SERVICES
 * (treatment-catalog.service.ts) + services_custom.json, tetapi baris DB
 * clinic_services (sumber runtime via loadServicesFromDb) masih nama lama
 * ("Pijat Lahap Juara (< 2 thn)" vs "Kala Baby – Pijat Lahap").
 *
 * Usage:
 *   npx tsx src/scripts/sync-catalog-rebrand.ts --dry-run [--tenant=default-tenant]
 *   npx tsx src/scripts/sync-catalog-rebrand.ts --commit  [--tenant=default-tenant]
 *
 * Safety:
 * - default --dry-run (read-only). Butuh --commit eksplisit untuk tulis DB.
 * - Scope tenant tunggal (default default-tenant). Test tenants tak tersentuh.
 * - Hanya baris yang service_id-nya ada di TS defaults yang di-update.
 *   Baris kustom (kids-massage-ceria, moms-induksi-*) dan NewBorn/custom DIBIARKAN.
 * - Field milik admin DIPERTAHANKAN: promo_price, original_price, is_active, sort_order.
 *   Yang disinkron: name, category, description, duration_minutes,
 *   min/max_age_months, age_label, total_sessions, session_schedule_type.
 * - Idempoten: run kedua → 0 updated.
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { DEFAULT_CLINIC_SERVICES } from '../services/treatment-catalog.service';

const isCommit = process.argv.includes('--commit');
const isDryRun = !isCommit;
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const tenantId = tenantArg ? tenantArg.split('=')[1]!.trim() : DEFAULT_TENANT_ID;

async function main() {
  console.log(`[SYNC REBRAND] Mode: ${isDryRun ? 'DRY-RUN' : 'COMMIT'} | tenant=${tenantId}`);
  if (isDryRun) console.log('[SYNC REBRAND] Read-only — tambah --commit untuk tulis DB.');

  const dbRows: any[] = await (prisma as any).clinicService.findMany({
    where: { tenant_id: tenantId },
  });
  const dbById = new Map(dbRows.map((r: any) => [r.service_id, r]));
  console.log(`[SYNC REBRAND] DB rows tenant: ${dbRows.length} | TS defaults: ${DEFAULT_CLINIC_SERVICES.length}`);

  let updated = 0;
  let skippedCustom = 0;
  for (const ts of DEFAULT_CLINIC_SERVICES) {
    const row: any = dbById.get(ts.id);
    if (!row) {
      console.log(`[SYNC REBRAND] + MISSING IN DB (tidak dibuat otomatis): ${ts.id} | ${ts.name}`);
      continue;
    }
    const patch: Record<string, any> = {};
    const cmp = (label: string, a: any, b: any) => {
      const na = a ?? null;
      const nb = b ?? null;
      if (String(na) !== String(nb)) {
        (patch as any)[label] = nb;
        return true;
      }
      return false;
    };
    const diffs: string[] = [];
    if (cmp('name', row.name, ts.name)) diffs.push(`name: "${row.name}" → "${ts.name}"`);
    if (cmp('category', row.category, ts.category)) diffs.push(`category: "${row.category}" → "${ts.category}"`);
    if (cmp('description', row.description, ts.description)) diffs.push('description: (berbeda)');
    if (cmp('duration_minutes', row.duration_minutes, ts.durationMinutes)) diffs.push(`duration: ${row.duration_minutes} → ${ts.durationMinutes}`);
    if (cmp('min_age_months', row.min_age_months, ts.ageTier?.minAgeMonths)) diffs.push(`min_age: ${row.min_age_months} → ${ts.ageTier?.minAgeMonths}`);
    if (cmp('max_age_months', row.max_age_months, ts.ageTier?.maxAgeMonths)) diffs.push(`max_age: ${row.max_age_months} → ${ts.ageTier?.maxAgeMonths}`);
    if (cmp('age_label', row.age_label, ts.ageTier?.label)) diffs.push(`age_label: "${row.age_label}" → "${ts.ageTier?.label}"`);
    if (cmp('total_sessions', row.total_sessions, (ts as any).totalSessions ?? null)) diffs.push(`total_sessions: ${row.total_sessions} → ${(ts as any).totalSessions ?? null}`);
    if (cmp('session_schedule_type', row.session_schedule_type, (ts as any).sessionScheduleType ?? null)) diffs.push(`schedule_type: ${row.session_schedule_type} → ${(ts as any).sessionScheduleType ?? null}`);
    if (diffs.length === 0) continue;

    console.log(`[SYNC REBRAND] ~ ${ts.id} (harga/is_active/sort_order dipertahankan):`);
    for (const d of diffs) console.log(`    - ${d.slice(0, 160)}`);
    if (isCommit) {
      await (prisma as any).clinicService.update({
        where: { id: row.id },
        data: { ...patch, updated_at: new Date() },
      });
      updated++;
    }
  }

  for (const row of dbRows) {
    const inTs = DEFAULT_CLINIC_SERVICES.some((s) => s.id === (row as any).service_id);
    if (!inTs) {
      skippedCustom++;
      console.log(`[SYNC REBRAND] = KUSTOM DIBIARKAN: ${(row as any).service_id} | ${(row as any).name}`);
    }
  }

  console.log(`[SYNC REBRAND] Selesai. updated=${updated} kustom_dibiarkan=${skippedCustom} (mode ${isDryRun ? 'DRY-RUN' : 'COMMIT'})`);
  await (prisma as any).$disconnect().catch(() => {});
}

main().catch(async (e) => {
  console.error('[SYNC REBRAND] Gagal:', e?.message || e);
  try { await (prisma as any).$disconnect(); } catch {}
  process.exit(1);
});
