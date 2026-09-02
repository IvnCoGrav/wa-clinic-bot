/**
 * One-Time DB Migration: Bersihkan treatment_detail verbose di reservations
 * Format verbose: "Baby: pijat bayi ceria (Bayi: sean, Usia: 5 bln) | Moms: oksitosin full body (Kehamilan: -)"
 * Target bersih: "Pijat Bayi Ceria + Oksitosin Full Body" (+ [Total ...] jika ada)
 * Idempoten: bisa dijalankan berkali-kali tanpa merusak data bersih.
 * Batch 50 record per transaksi.
 */
import { prisma } from '../src/db/client';

function getCleanTreatmentName(detail: string | null | undefined): string {
  if (!detail) return 'Layanan Homecare';
  const sesiMatch = detail.match(/\[Sesi[^\]]*\]/i);
  const sesiTag = sesiMatch ? ` ${sesiMatch[0]}` : '';
  let main = detail.split('[Total')[0].trim();
  main = main.replace(/\[Sesi[^\]]*\]/gi, '').trim();
  const parts = main.split(/\s*(?:\+|\|)\s*/);
  const cleaned = parts
    .map((p) => {
      p = p.replace(/^(Baby|Kids|MOMS|BOTH|BUNDLE):\s*/i, '');
      p = p.replace(/\([^)]*\)/g, '').trim();
      p = p.replace(/\[[^\]]*\]/g, '').trim();
      p = p.replace(/\bUsia:\s*[^,)]+/gi, '').trim();
      p = p.replace(/\bKehamilan:\s*[^,)]+/gi, '').trim();
      p = p.replace(/\s{2,}/g, ' ').trim();
      p = p.replace(/^[.,|+\-\s]+|[.,|+\-\s]+$/g, '').trim();
      if (!p) return '';
      return p
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
        .replace(/\bPijat\b/gi, 'Pijat')
        .replace(/\bOksitosin\b/gi, 'Oksitosin');
    })
    .filter(Boolean);
  const base = cleaned.join(' + ') || 'Layanan Homecare';
  return (base + sesiTag).trim();
}

function isVerbose(detail: string | null | undefined): boolean {
  if (!detail) return false;
  return /(^|\s)(Baby|Moms):/i.test(detail) || /\(Bayi:/i.test(detail) || /\(Kehamilan:/i.test(detail) || /\bUsia:/i.test(detail) || /\s\|\s/.test(detail);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[CLEAN] Starting treatment_detail sanitization (dryRun=${dryRun})...`);

  const all = await prisma.reservation.findMany({
    where: {
      OR: [
        { treatment_detail: { contains: 'Baby:' } },
        { treatment_detail: { contains: 'Moms:' } },
        { treatment_detail: { contains: '(Bayi:' } },
        { treatment_detail: { contains: '(Kehamilan:' } },
        { treatment_detail: { contains: ' | ' } },
      ],
    },
    select: { id: true, treatment_detail: true },
  });

  console.log(`[CLEAN] Found ${all.length} verbose records.`);
  if (all.length === 0) {
    console.log('[CLEAN] Nothing to clean. Exiting.');
    return;
  }

  let updated = 0;
  const batchSize = 50;
  for (let i = 0; i < all.length; i += batchSize) {
    const batch = all.slice(i, i + batchSize);
    for (const r of batch) {
      const original = r.treatment_detail || '';
      const cleanedBase = getCleanTreatmentName(original);
      // Pertahankan tag [Total ...] jika ada di original
      const totalMatch = original.match(/\[Total[^\]]*\]/i);
      const totalTag = totalMatch ? ` ${totalMatch[0]}` : '';
      const cleaned = `${cleanedBase}${totalTag}`.trim();

      if (cleaned === original.trim()) {
        console.log(`[SKIP] ${r.id} already clean: "${original}"`);
        continue;
      }

      console.log(`[CLEAN] ${r.id}: "${original}" -> "${cleaned}"`);
      if (!dryRun) {
        await prisma.reservation.update({ where: { id: r.id }, data: { treatment_detail: cleaned } });
        updated++;
      }
    }
  }

  console.log(`[CLEAN] Done. ${dryRun ? 'Would update' : 'Updated'} ${updated}/${all.length} records.`);
  if (dryRun) console.log('[CLEAN] Run without --dry-run to apply.');
}

main()
  .catch((e) => {
    console.error('[CLEAN] Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
