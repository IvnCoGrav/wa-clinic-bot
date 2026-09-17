import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';
import { treatmentCatalogService } from '../src/services/treatment-catalog.service';

/**
 * Backfill `duration_minutes` untuk reservasi lama yang NULL — IDEMPOTEN.
 *
 * Sumber tunggal durasi = katalog kanonis (`resolveDurationBreakdown`). Angka
 * HANYA ditulis bila seluruh item dikenali katalog / ada tag eksplisit
 * (`confident`/`usedExplicitTag`) — mencegah fabrikasi durasi untuk teks bebas.
 *
 * Penggunaan:
 *   npx tsx scripts/backfill-reservation-duration.ts [--tenant=<id>] [--apply]
 * Tanpa --apply = dry-run (hitung & tampilkan distribusi, tanpa tulisan).
 *
 * Exit code: 0 = sukses, 1 = masih ada NULL yang tak dapat diresolusi, 2 = DB/error.
 */

function parseArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() || fallback : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const tenantId = parseArg('tenant', process.env.DEFAULT_TENANT_ID || DEFAULT_TENANT_ID);
  const apply = hasFlag('apply');

  let rows: Array<{ id: string; treatment_detail: string | null }> = [];
  try {
    rows = await prisma.reservation.findMany({
      where: { tenant_id: tenantId, duration_minutes: null },
      select: { id: true, treatment_detail: true },
    });
  } catch (err: any) {
    console.error(`❌ [BACKFILL DURATION] Database offline: ${err?.message || err}`);
    process.exit(2);
  }

  console.log(`🛠️  [BACKFILL DURATION] Tenant: ${tenantId} | NULL: ${rows.length} reservasi`);

  let resolvable = 0;
  let unresolved = 0;
  let empty = 0;
  const dist = new Map<number, number>();

  for (const r of rows) {
    const detail = (r.treatment_detail || '').trim();
    if (!detail) {
      empty++;
      unresolved++;
      continue;
    }
    const b = treatmentCatalogService.resolveDurationBreakdown(detail, tenantId);
    if (!b.confident && !b.usedExplicitTag) {
      unresolved++;
      console.log(`⚠️  Tidak resolusi (dibiarkan NULL): ${r.id.slice(0, 8)} :: ${JSON.stringify(detail.slice(0, 120))}`);
      continue;
    }
    resolvable++;
    dist.set(b.totalMinutes, (dist.get(b.totalMinutes) || 0) + 1);
    if (apply) {
      await prisma.reservation.update({ where: { id: r.id }, data: { duration_minutes: b.totalMinutes } });
    }
  }

  console.log(`📊 Distribusi durasi resolusi: ${JSON.stringify([...dist.entries()].sort((a, b) => a[0] - b[0]))}`);
  console.log(
    `${apply ? '✅ APPLIED' : 'ℹ️  DRY-RUN'} | resolvable=${resolvable} | unresolved=${unresolved} (kosong=${empty})`
  );
  process.exit(unresolved > 0 ? 1 : 0);
}

main()
  .catch((e) => {
    console.error('Error backfill-reservation-duration:', e);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
