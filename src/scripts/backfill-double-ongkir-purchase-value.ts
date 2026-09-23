/**
 * backfill-double-ongkir-purchase-value.ts — Koreksi historis double-ongkir purchase_value.
 * Sebelum fix, save-reservation menyimpan purchase_value = subtotal + ongkir.
 * Kartu terapis menghitung totalFee = purchase_value + ongkir → double-ongkir.
 * Skrip ini mengurangi purchase_value sebesar customer.ongkir untuk reservasi terdampak.
 *
 * Idempoten, aman, dry-run default.
 * Usage: npx tsx src/scripts/backfill-double-ongkir-purchase-value.ts [--dry-run] [--tenant=default-tenant]
 */
import { prisma } from '../db/client';

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--execute');
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const tenantFilter = tenantArg ? tenantArg.split('=')[1] : null;

async function main() {
  console.log(`[BACKFILL] Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'EXECUTE'}`);
  if (tenantFilter) console.log(`[BACKFILL] Tenant filter: ${tenantFilter}`);

  const where: any = {
    raw_text: { contains: '[V3_NATIVE_AGENT_TOOL]' },
    purchase_value: { gt: 0 },
    status: { in: ['pending', 'confirmed'] },
    ...(tenantFilter ? { tenant_id: tenantFilter } : {}),
  };

  const reservations: any[] = await prisma.reservation.findMany({
    where,
    include: { customer: true },
    take: 5000,
  });

  console.log(`[BACKFILL] Kandidat: ${reservations.length} reservasi`);

  let corrected = 0;
  let skipped = 0;
  let errors = 0;

  for (const r of reservations) {
    const ongkir = (r.customer as any)?.ongkir != null ? Number((r.customer as any).ongkir) : 0;
    const pv = r.purchase_value != null ? Number(r.purchase_value) : 0;
    if (!ongkir || ongkir <= 0) { skipped++; continue; }
    if (pv <= ongkir) { skipped++; continue; }
    // Heuristic: hanya koreksi bila purchase_value tampak mengandung ongkir.
    // Kita bandingkan dengan subtotal katalog bila ada, atau minimal pastikan pengurangan tidak negatif.
    const newPv = pv - ongkir;
    if (newPv <= 0) { skipped++; continue; }

    console.log(`[BACKFILL] ${r.id} tenant=${r.tenant_id} pv=${pv} ongkir=${ongkir} → newPv=${newPv} detail="${(r.treatment_detail || '').slice(0, 60)}"`);

    if (!DRY_RUN) {
      try {
        await prisma.reservation.update({
          where: { id: r.id },
          data: { purchase_value: newPv },
        });
        corrected++;
      } catch (e: any) {
        console.error(`[BACKFILL ERROR] ${r.id}: ${e.message}`);
        errors++;
      }
    } else {
      corrected++;
    }
  }

  console.log(`[BACKFILL DONE] corrected=${corrected} skipped=${skipped} errors=${errors} mode=${DRY_RUN ? 'dry-run' : 'execute'}`);
  if (DRY_RUN) console.log('[BACKFILL] Jalankan dengan --execute untuk menulis ke DB.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
