// R1 — Pembersihan data lama (1 null-date, 1 stale hold, 8 completed unverified).
// AMAN: default DRY-RUN (hanya menampilkan). Mutasi HANYA dengan flag --apply.
// Jalankan: npx tsx scripts/cleanup/r1-cleanup.ts            (dry-run)
//           npx tsx scripts/cleanup/r1-cleanup.ts --apply    (mutasi)
//
// WAJIB backup dulu: pg_dump -t reservations "$DATABASE_URL" > backup_reservations.sql
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient({ log: ['error'] });
const APPLY = process.argv.includes('--apply');

// 173k akan mengonfirmasi ID riil; ID di bawah dari dokumen audit (verifikasi dulu!).
const NULL_DATE_ID = 'f3b23c2e-934e-4c9a-b737-d676d222e1b3'; // Bunda Cayden
const STALE_HOLD_ID = 'e542df55-c1dd-411c-b69a-caa5af30a01f'; // [HOLD] Slot Ditawarkan (BABY)

async function main() {
  console.log(`===== R1 CLEANUP (${APPLY ? 'APPLY — MUTASI' : 'DRY-RUN'}) =====\n`);

  // R1.1 — Confirmed tanpa booking_date
  const nullDate = await prisma.reservation.findMany({
    where: { status: 'confirmed', booking_date: null },
    select: { id: true, tenant_id: true, created_at: true },
  });
  console.log(`R1.1 Confirmed tanpa tanggal: ${nullDate.length} baris`);
  nullDate.forEach((r) => console.log(`   - ${r.id} (created=${r.created_at.toISOString()})`));
  console.log('   → Tindakan manual: konfirmasi CS tanggal definitif, lalu UPDATE booking_date ATAU set cancelled.');
  if (APPLY && nullDate.length === 1 && nullDate[0].id === NULL_DATE_ID) {
    await prisma.reservation.update({ where: { id: NULL_DATE_ID }, data: { status: 'cancelled' } });
    console.log('   ✓ APPLIED: set cancelled untuk null-date.');
  }

  // R1.2 — Hold kedaluwarsa (lewat tengah malam WIB) — KB-1
  const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const startOfTodayWibUtc = new Date(Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate(), 0, 0, 0, 0) - 7 * 60 * 60 * 1000);
  const staleHolds = await prisma.reservation.findMany({
    where: { status: 'hold', created_at: { lt: startOfTodayWibUtc } },
    select: { id: true, booking_date: true, created_at: true },
  });
  console.log(`\nR1.2 Hold kedaluwarsa: ${staleHolds.length} baris`);
  staleHolds.forEach((r) => console.log(`   - ${r.id} (booking=${r.booking_date?.toISOString() ?? 'null'})`));
  if (APPLY) {
    const res = await prisma.reservation.updateMany({
      where: { status: 'hold', created_at: { lt: startOfTodayWibUtc } },
      data: { status: 'cancelled' },
    });
    console.log(`   ✓ APPLIED: ${res.count} hold → cancelled.`);
  }

  // R1.3 — Completed dengan needs_staff_verification = true
  const unverified = await prisma.reservation.findMany({
    where: { status: 'completed', needs_staff_verification: true },
    select: { id: true, tenant_id: true },
  });
  console.log(`\nR1.3 Completed unverified: ${unverified.length} baris`);
  unverified.forEach((r) => console.log(`   - ${r.id} (tenant=${r.tenant_id})`));
  if (APPLY && unverified.length > 0) {
    const res = await prisma.reservation.updateMany({
      where: { id: { in: unverified.map((r) => r.id) } },
      data: { needs_staff_verification: false },
    });
    console.log(`   ✓ APPLIED: ${res.count} flag → false.`);
  }

  console.log('\n===== Selesai =====');
  if (!APPLY) console.log('DRY-RUN: tidak ada perubahan. Jalankan ulang dengan --apply setelah backup & verifikasi.');
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect().catch(() => {}); });
