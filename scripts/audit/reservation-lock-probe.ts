/**
 * reservation-lock-probe.ts
 *
 * Probe serialisasi `pg_advisory_xact_lock` yang dipakai `saveReservation`.
 * TIDAK membuat/mengubah baris reservasi — hanya menguji apakah transaksi
 * kedua gagal mengambil lock yang sama saat transaksi pertama memegangnya.
 *
 * Default dry-run. Jalankan di staging (butuh DATABASE_URL):
 *   npx tsx scripts/audit/reservation-lock-probe.ts --confirm
 *
 * Exit code: 0 = PASS, 1 = FAIL, 2 = error koneksi/eksekusi.
 */
import { prisma } from '../../src/db/client';
import { computeAdvisoryLockKey } from '../../src/services/reservation-core.service';

async function main(): Promise<void> {
  const confirmed = process.argv.includes('--confirm');
  const key = computeAdvisoryLockKey('probe-tenant', 'probe-staff', new Date());

  if (!confirmed) {
    console.log(JSON.stringify({
      event: 'RESERVATION_LOCK_PROBE_DRY_RUN',
      key,
      hint: 'Jalankan dengan --confirm di staging (butuh DATABASE_URL). Tidak menulis data reservasi.',
    }));
    return;
  }

  let lockHeld = false;
  const holder = prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1)', key);
    lockHeld = true;
    // Tahan lock cukup lama agar transaksi kedua sempat mencoba.
    await tx.$executeRawUnsafe('SELECT pg_sleep(3)');
  });

  const deadline = Date.now() + 2000;
  while (!lockHeld && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (!lockHeld) {
    await holder.catch(() => {});
    throw new Error('Lock holder tidak pernah mengakuisisi lock (timeout).');
  }

  const rows = await prisma.$transaction(async (tx) =>
    tx.$queryRawUnsafe<Array<{ locked: boolean }>>(
      'SELECT pg_try_advisory_xact_lock($1) AS locked',
      key
    )
  );

  const tryLocked = rows?.[0]?.locked;
  await holder;

  const pass = tryLocked === false;
  console.log(JSON.stringify({
    event: 'RESERVATION_LOCK_PROBE',
    pass,
    tryLocked,
    note: pass
      ? 'Transaksi kedua tertahan selama lock dipegang (serialisasi benar).'
      : 'Transaksi kedua berhasil mengambil lock yang sama (serialisasi GAGAL).',
  }));

  if (!pass) process.exitCode = 1;
}

main()
  .catch((err: any) => {
    console.error('[RESERVATION_LOCK_PROBE_ERROR]', err?.message || err);
    process.exitCode = 2;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
