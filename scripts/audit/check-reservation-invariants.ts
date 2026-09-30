// 173k — Verifikasi invariant reservasi (READ-ONLY). Aman dijalankan di server.
// Jalankan: npx tsx scripts/audit/check-reservation-invariants.ts
// Output: ringkasan 6 invariant + baris pelanggaran (ID) untuk tindak lanjut R1.
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient({ log: ['error'] });

function line(label: string, n: number, target = 0) {
  const ok = n <= target ? '✅' : '❌';
  console.log(`${ok} ${label}: ${n}`);
}

async function main() {
  console.log('===== 173k — Reservation Invariant Audit (READ-ONLY) =====');
  console.log(`DB: ${(process.env.DATABASE_URL || '').replace(/\/\/[^@]+@/, '//***@')}\n`);

  const total = await prisma.reservation.count();
  console.log(`Total reservasi: ${total}\n`);

  // INV1: confirmed tanpa booking_date
  const inv1 = await prisma.reservation.findMany({
    where: { status: 'confirmed', booking_date: null },
    select: { id: true, tenant_id: true, created_at: true },
  });
  line('INV1 Confirmed tanpa booking_date', inv1.length);
  inv1.forEach((r) => console.log(`   - ${r.id} (tenant=${r.tenant_id}, created=${r.created_at.toISOString()})`));

  // INV2: hold kedaluwarsa (> tengah malam WIB hari pembuatan) — KB-1
  const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const startOfTodayWibUtc = new Date(Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate(), 0, 0, 0, 0) - 7 * 60 * 60 * 1000);
  const inv2 = await prisma.reservation.findMany({
    where: { status: 'hold', created_at: { lt: startOfTodayWibUtc } },
    select: { id: true, tenant_id: true, booking_date: true, created_at: true },
  });
  line('INV2 Hold kedaluwarsa (lewat tengah malam WIB)', inv2.length);
  inv2.forEach((r) => console.log(`   - ${r.id} (booking=${r.booking_date?.toISOString() ?? 'null'}, created=${r.created_at.toISOString()})`));

  // INV3: completed dengan needs_staff_verification = true
  const inv3 = await prisma.reservation.findMany({
    where: { status: 'completed', needs_staff_verification: true },
    select: { id: true, tenant_id: true },
  });
  line('INV3 Completed dengan needs_staff_verification=true', inv3.length);
  inv3.forEach((r) => console.log(`   - ${r.id} (tenant=${r.tenant_id})`));

  // INV4: confirmed masa lampau
  const inv4 = await prisma.reservation.count({ where: { status: 'confirmed', booking_date: { lt: new Date() } } });
  line('INV4 Confirmed masa lampau (< now())', inv4);

  // INV5: slot bentrok tanpa staf (tenant+booking_date sama, assigned_staff_id NULL)
  const inv5 = await prisma.$queryRawUnsafe<Array<{ tenant_id: string; booking_date: Date; cnt: number }>>(
    `SELECT tenant_id, booking_date, count(*)::int AS cnt FROM reservations
     WHERE status IN ('confirmed','hold','pending') AND assigned_staff_id IS NULL
     GROUP BY tenant_id, booking_date HAVING count(*) > 1 ORDER BY booking_date`
  );
  line('INV5 Slot bentrok tanpa staf (assigned_staff_id NULL)', inv5.length);
  inv5.forEach((r) => console.log(`   - tenant=${r.tenant_id} booking=${new Date(r.booking_date).toISOString()} cnt=${r.cnt}`));

  console.log('\n===== Selesai =====');
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect().catch(() => {}); });
