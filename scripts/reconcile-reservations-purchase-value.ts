/**
 * Skrip rekonsiliasi purchase_value — Fase 5R
 * Tujuan: memperbaiki data 7 hari terakhir yang tercampur ongkir.
 * Invarian: purchase_value = murni subtotal promo layanan (tanpa ongkir); ongkir ∈ Customer.ongkir
 *
 * Fitur keamanan:
 * - dry-run default (tampilkan kandidat, tidak tulis) — pakai --execute untuk tulis
 * - idempoten: hanya ubah bila purchase_value == murni + ongkir (terbukti kontaminasi)
 * - per-tenant isolation, backup CSV log, transaksi per baris, hormati downside-guard (jangan turunkan tanpa verifikasi invarian)
 *
 * Usage:
 *   npx tsx scripts/reconcile-reservations-purchase-value.ts              # dry-run
 *   npx tsx scripts/reconcile-reservations-purchase-value.ts --execute    # tulis
 *   npx tsx scripts/reconcile-reservations-purchase-value.ts --execute --tenant=default-tenant
 */

import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

const DRY_RUN = !process.argv.includes('--execute');
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const targetTenant = tenantArg ? tenantArg.split('=')[1] : DEFAULT_TENANT_ID;

async function calcMurniSubtotal(treatmentDetail: string | null, tenantId: string): Promise<number | null> {
  if (!treatmentDetail) return null;
  try {
    const { treatmentCatalogService } = await import('../src/services/treatment-catalog.service');
    // Data-driven matching via katalog (nama + deskripsi)
    const catalog = treatmentCatalogService.getAllServices(true, tenantId);
    const parts = treatmentDetail
      .replace(/\[\s*Total[^]]*\]/gi, '')
      .replace(/\[\s*\d+\s*m[^]]*\]/gi, '')
      .split(/\s*[\+,]\s*/)
      .map((p) => p.replace(/\[.*?\]/g, '').trim())
      .filter(Boolean);
    let sum = 0;
    let matched = 0;
    for (const p of parts) {
      const hit = (treatmentCatalogService as any).matchCatalogItem
        ? (treatmentCatalogService as any).matchCatalogItem(p, tenantId)
        : catalog.find((s: any) => s.name.toLowerCase() === p.toLowerCase());
      if (hit) {
        sum += Number(hit.promoPrice || hit.originalPrice || 0);
        matched++;
      } else {
        // fallback per-token via catalog
        const lower = p.toLowerCase();
        const fallback = catalog.find((s: any) => s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()));
        if (fallback) {
          sum += Number(fallback.promoPrice || fallback.originalPrice || 0);
          matched++;
        }
      }
    }
    return matched > 0 ? sum : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('========================================================');
  console.log(`🔍 Rekonsiliasi purchase_value (tenant=${targetTenant}) — ${DRY_RUN ? 'DRY-RUN' : 'EXECUTE'}`);
  console.log('========================================================');
  const since = new Date();
  since.setDate(since.getDate() - 7);
  console.log(`Rentang: >= ${since.toISOString().slice(0, 10)}`);

  const rows = await prisma.reservation.findMany({
    where: {
      tenant_id: targetTenant,
      created_at: { gte: since },
    },
    include: { customer: true },
    orderBy: { created_at: 'desc' },
  });
  console.log(`Ditemukan ${rows.length} reservasi 7 hari terakhir.`);

  let contaminated = 0;
  let skipped = 0;
  let alreadyClean = 0;
  const csvLines: string[] = ['id,created_at,treatment_detail,purchase_value_before,murni,ongkir,action'];

  for (const r of rows) {
    const murni = await calcMurniSubtotal(r.treatment_detail, targetTenant);
    const ongkir = Number((r.customer as any)?.ongkir || 0);
    const pv = Number(r.purchase_value || 0);
    if (murni === null || murni <= 0) {
      csvLines.push(`${r.id},${r.created_at.toISOString()},${JSON.stringify(r.treatment_detail)},${pv},NULL,${ongkir},SKIP_NO_MATCH`);
      skipped++;
      continue;
    }
    // Terdeteksi kontaminasi bila pv == murni + ongkir (dan ongkir>0)
    const isContaminated = ongkir > 0 && pv === murni + ongkir;
    // Juga kasus pv == murni + ongkir dengan toleransi pembulatan? Tidak, harus exact.
    if (isContaminated) {
      contaminated++;
      csvLines.push(`${r.id},${r.created_at.toISOString()},${JSON.stringify(r.treatment_detail)},${pv},${murni},${ongkir},${DRY_RUN ? 'WOULD_FIX' : 'FIXED'}`);
      console.log(`[KONTAMINASI] ${r.id.slice(0, 8)} | ${r.treatment_detail?.slice(0, 40)} | pv=${pv} = murni ${murni} + ongkir ${ongkir} → ${DRY_RUN ? 'dry-run' : 'update ke ' + murni}`);
      if (!DRY_RUN) {
        try {
          await prisma.reservation.update({ where: { id: r.id }, data: { purchase_value: murni } });
        } catch (e) {
          console.warn(`  gagal update ${r.id}: ${(e as Error).message}`);
        }
      }
    } else {
      // Jika pv < murni (downside), jangan sentuh — hormati downside-guard
      if (pv > 0 && pv < murni) {
        csvLines.push(`${r.id},${r.created_at.toISOString()},${JSON.stringify(r.treatment_detail)},${pv},${murni},${ongkir},SKIP_DOWNSIDE_GUARD`);
        skipped++;
      } else {
        csvLines.push(`${r.id},${r.created_at.toISOString()},${JSON.stringify(r.treatment_detail)},${pv},${murni},${ongkir},OK`);
        alreadyClean++;
      }
    }
  }

  console.log('--------------------------------------------------------');
  console.log(`Kontaminasi terdeteksi: ${contaminated}`);
  console.log(`Sudah bersih: ${alreadyClean}`);
  console.log(`Skip (no match / guard): ${skipped}`);
  if (DRY_RUN) console.log('Mode DRY-RUN — tidak ada data yang ditulis. Jalankan dengan --execute untuk eksekusi.');
  // Tulis CSV log ke stdout / file
  const fs = await import('fs');
  const outPath = `scripts/reconcile-log-${targetTenant}-${new Date().toISOString().slice(0, 10)}.csv`;
  try {
    fs.writeFileSync(outPath, csvLines.join('\n'), 'utf-8');
    console.log(`Log CSV: ${outPath}`);
  } catch {}
  console.log('========================================================');
}

/**
 * Predikat invarian kontaminasi (seam unit-test):
 * true hanya bila purchase_value terbukti = murni + ongkir (ongkir > 0).
 * False untuk: sudah murni, downside (pv < murni), murni tak diketahui, ongkir nol.
 */
export function isContaminatedPurchaseValue(
  purchaseValue: number | null | undefined,
  murniSubtotal: number | null | undefined,
  ongkir: number | null | undefined
): boolean {
  const pv = Number(purchaseValue || 0);
  const murni = Number(murniSubtotal || 0);
  const ong = Number(ongkir || 0);
  if (murni <= 0 || ong <= 0 || pv <= 0) return false;
  return pv === murni + ong;
}

export { calcMurniSubtotal };

// Guard eksekusi langsung: import dari vitest tidak boleh menjalankan main().
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv.some((a) => String(a).endsWith('reconcile-reservations-purchase-value.ts'));
if (invokedDirectly) {
  main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
