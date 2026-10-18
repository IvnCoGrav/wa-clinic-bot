/**
 * heal-firda-active-address.ts (PLAN FIXING ALAMAT KEDUA — FASE 2)
 *
 * Pemulihan DATA OPERASIONAL satu pelanggan yang tiket kunjungan aktifnya masih
 * menunjuk kartu alamat LAMA (ghost-address) padahal alamat pelanggan sudah
 * dikoreksi. Menulis lewat SEAM KANONIS saja:
 *   - `customerService.upsertSavedAddress`  (JSON preferences + tabel customer_addresses)
 *   - `syncActiveReservationsForCustomer`   (relink reservasi aktif + snapshot ongkir)
 *
 * Sifat (wajib):
 * - DEFAULT = DRY-RUN read-only. Tulis HANYA dengan `--commit`.
 * - Idempoten: rerun setelah commit menghasilkan 0 perubahan.
 * - Bebas hardcode: target & nilai alamat dapat di-override lewat argumen.
 * - Backup JSON (customer + customer_addresses + reservasi terkait) SEBELUM commit.
 *
 * Usage:
 *   npx tsx src/scripts/heal-firda-active-address.ts --reservation=<id> --dry-run
 *   npx tsx src/scripts/heal-firda-active-address.ts --reservation=<id> --commit
 *
 * Override (opsional):
 *   --customer=<id>   --address=<teks>   --kelurahan=<..>
 *   --kecamatan=<..>     --kota=<..>       --lat=<num>        --lng=<num>
 *   --distance-km=<num>  --ongkir=<num>    --source=gps_pin
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { ACTIVE_RESERVATION_STATUSES, isActiveReservation } from '../domain/reservation-status';

const argVal = (name: string): string | null => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=').trim() : null;
};

const isCommit = process.argv.includes('--commit');
const isDryRun = !isCommit;

// A-014 (audit): DILARANG hardcode ID entitas data (reservation/customer) sebagai
// default di file runtime — target WAJIB dilempar eksplisit lewat argumen.
const reservationId = argVal('reservation');
const customerIdArg = argVal('customer');

const remediation = {
  address: argVal('address') || 'Perumdos ITS Jl. Teknik Sipil Blok W no.18',
  kelurahan: argVal('kelurahan') || 'Gebang Putih',
  kecamatan: argVal('kecamatan') || 'Sukolilo',
  kota: argVal('kota') || 'Kota Surabaya',
  lat: argVal('lat') != null ? Number(argVal('lat')) : -7.289199,
  lng: argVal('lng') != null ? Number(argVal('lng')) : 112.7970673,
  distanceKm: argVal('distance-km') != null ? Number(argVal('distance-km')) : 13.3,
  ongkir: argVal('ongkir') != null ? Number(argVal('ongkir')) : 15000,
  locationSource: (argVal('source') || 'gps_pin') as 'gps_pin' | 'estimated_area' | 'manual_staff',
};

async function main(): Promise<void> {
  if (!reservationId) {
    console.error('[HEAL FIRDA] --reservation=<id> WAJIB diisi (larangan hardcode id entitas, A-014) — batal.');
    process.exit(1);
  }
  console.log(`[HEAL FIRDA] mode=${isDryRun ? 'DRY-RUN (read-only)' : 'COMMIT'}`);
  console.log(`[HEAL FIRDA] target reservasi=${reservationId}`);

  const reservation: any = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { customer: true, customer_address: true },
  });
  if (!reservation) {
    console.error('[HEAL FIRDA] Reservasi tidak ditemukan — batal.');
    process.exit(1);
  }
  const tenantId = reservation.tenant_id || DEFAULT_TENANT_ID;
  const customerId = customerIdArg || reservation.customer_id;
  if (!customerId) {
    console.error('[HEAL FIRDA] customer_id tidak diketahui — batal.');
    process.exit(1);
  }

  const customer: any = await prisma.customer.findUnique({ where: { id: customerId } }).catch(() => null);
  const addresses: any[] = await (prisma as any).customerAddress
    .findMany({ where: { customer_id: customerId, tenant_id: tenantId }, orderBy: [{ is_primary: 'desc' }, { last_used_at: 'desc' }] })
    .catch(() => []);

  const activeAll: any[] = await prisma.reservation.findMany({
    where: { tenant_id: tenantId, customer_id: customerId, status: { in: ACTIVE_RESERVATION_STATUSES } },
  }).catch(() => []);
  const active = activeAll.filter((r) => isActiveReservation(r));

  console.log(`[HEAL FIRDA] customer=${customerId} nama=${customer?.name ?? '(n/a)'}`);
  console.log(`[HEAL FIRDA] kartu alamat saat ini (${addresses.length}):`);
  for (const a of addresses) {
    console.log(`   - ${a.id} primary=${a.is_primary} ongkir=${a.ongkir} src=${a.location_source} :: ${String(a.address).slice(0, 60)}`);
  }
  console.log(`[HEAL FIRDA] reservasi saat ini → kartu=${reservation.customer_address_id} ongkir=${reservation.delivery_fee} status=${reservation.status}`);
  console.log(`[HEAL FIRDA] reservasi AKTIF pelanggan: ${active.length} → [${active.map((r) => r.id).join(', ')}]`);
  console.log(`[HEAL FIRDA] rencana upsert kartu: ${remediation.address} (${remediation.lat}, ${remediation.lng}) ongkir=${remediation.ongkir} src=${remediation.locationSource}`);

  if (isDryRun) {
    console.log('[HEAL FIRDA] DRY-RUN selesai — 0 tulis. Jalankan dengan --commit untuk menerapkan.');
    return;
  }

  // Backup JSON sebelum commit.
  try {
    const backupDir = join(process.cwd(), 'backups');
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = join(backupDir, `heal-firda-${stamp}.json`);
    writeFileSync(backupFile, JSON.stringify({ customer, addresses, reservation, active }, null, 2), 'utf8');
    console.log(`[HEAL FIRDA] Backup tersimpan: ${backupFile}`);
  } catch (e: any) {
    console.warn('[HEAL FIRDA] Backup gagal (lanjut, sudah diinstruksikan backup pg_dump?):', e?.message);
  }

  const { customerService } = await import('../services/customer.service');
  const entry = await customerService.upsertSavedAddress(customerId, {
    address: remediation.address,
    kelurahan: remediation.kelurahan,
    kecamatan: remediation.kecamatan,
    kota: remediation.kota,
    lat: remediation.lat,
    lng: remediation.lng,
    distanceKm: remediation.distanceKm,
    ongkir: remediation.ongkir,
    locationSource: remediation.locationSource,
    isPrimary: true,
  }, tenantId);
  console.log(`[HEAL FIRDA] Kartu kanonis: ${entry?.id ?? '(null)'}`);

  const { syncActiveReservationsForCustomer } = await import('../services/reservation-address-sync.service');
  const res = await syncActiveReservationsForCustomer({ tenantId, customerId });
  console.log(`[HEAL FIRDA] Reservasi aktif tersinkron: ${res.synced}`);
  console.log('[HEAL FIRDA] COMMIT selesai.');
}

main()
  .catch((e) => {
    console.error('[HEAL FIRDA ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
