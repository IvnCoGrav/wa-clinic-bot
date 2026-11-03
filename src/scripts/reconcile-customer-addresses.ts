/**
 * reconcile-customer-addresses.ts
 *
 * Rekonsiliasi deterministik antara `customers.preferences.saved_addresses` (JSON)
 * dan tabel relasional `customer_addresses`.
 *
 * Aturan (lihat `src/domain/address-reconciliation.ts`):
 *  - Baris tabel yatim yang DIPAKAI reservasi  -> diadopsi ke JSON (riwayat aman).
 *  - Baris tabel yatim TANPA reservasi         -> dihapus.
 *  - Kartu JSON yang belum ada di tabel        -> di-upsert ke tabel.
 *  - Primary mengikuti tabel (operasional), fallback JSON, lalu lastUsedAt.
 *
 * Default = DRY-RUN (read-only). Tulis hanya dengan `--commit`.
 * Idempoten & tenant-scoped.
 */
import { prisma } from '../db/client';
import { parseSavedAddresses, type SavedCustomerAddress } from '../domain/customer-address';
import { buildReconciliationPlan, type TableAddressRow } from '../domain/address-reconciliation';

const isCommit = process.argv.includes('--commit') || process.argv.includes('--apply');
const isDryRun = !isCommit;
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const customerArg = process.argv.find((a) => a.startsWith('--customer='));
const tenantFilter = tenantArg ? tenantArg.split('=')[1]!.trim() : null;
const customerFilter = customerArg ? customerArg.split('=')[1]!.trim() : null;

function toDate(value: string | null | undefined, fallback = new Date()): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function cardToRow(card: SavedCustomerAddress) {
  return {
    label: card.label,
    address: card.address ?? '',
    kelurahan: card.kelurahan ?? null,
    kecamatan: card.kecamatan ?? null,
    kota: card.kota ?? null,
    lat: card.lat ?? null,
    lng: card.lng ?? null,
    distance_km: card.distanceKm ?? null,
    ongkir: card.ongkir != null ? Math.round(card.ongkir) : null,
    landmark: card.landmark ?? null,
    location_source: card.locationSource ?? null,
    is_primary: Boolean(card.isPrimary),
    last_used_at: toDate(card.lastUsedAt),
  };
}

function rowMatchesCard(row: TableAddressRow, card: SavedCustomerAddress): boolean {
  const n = (v: unknown) => (v == null ? '' : String(v).trim().toLowerCase());
  return (
    n(row.label) === n(card.label) &&
    n(row.address) === n(card.address) &&
    n(row.kelurahan) === n(card.kelurahan) &&
    n(row.kecamatan) === n(card.kecamatan) &&
    n(row.kota) === n(card.kota) &&
    n(row.lat) === n(card.lat) &&
    n(row.lng) === n(card.lng) &&
    n(row.ongkir) === n(card.ongkir != null ? Math.round(card.ongkir) : null) &&
    n(row.location_source) === n(card.locationSource) &&
    Boolean(row.is_primary) === Boolean(card.isPrimary)
  );
}

async function run(): Promise<void> {
  console.log(`[RECONCILE ADDRESSES] Mode: ${isCommit ? 'COMMIT (MENULIS)' : 'DRY-RUN (READ-ONLY)'}`);

  const whereCust: any = {};
  if (tenantFilter) whereCust.tenant_id = tenantFilter;
  if (customerFilter) whereCust.id = customerFilter;

  const customers = await prisma.customer.findMany({
    where: whereCust,
    include: { addresses: true },
  });

  let changedCustomers = 0;
  let adoptedTotal = 0;
  let deletedTotal = 0;
  let upsertedTotal = 0;

  for (const c of customers) {
    const json = parseSavedAddresses(c.preferences);
    const rows: TableAddressRow[] = (c.addresses || []) as any[];
    if (json.length === 0 && rows.length === 0) continue;

    const referencedRows = await prisma.reservation.findMany({
      where: {
        tenant_id: c.tenant_id,
        customer_id: c.id,
        customer_address_id: { not: null },
      },
      select: { customer_address_id: true },
    });
    const referenced = new Set(
      referencedRows.map((r) => r.customer_address_id).filter((v): v is string => Boolean(v))
    );

    const plan = buildReconciliationPlan(json, rows, referenced);

    const rowById = new Map(rows.map((r) => [r.id, r]));
    const jsonPrimary = json.find((a) => a.isPrimary)?.id ?? null;
    const tablePrimary = rows.find((r) => r.is_primary)?.id ?? null;

    const needsUpsert = plan.nextJson.some((a) => !rowById.has(a.id));
    const needsFieldSync = plan.nextJson.some((a) => {
      const r = rowById.get(a.id);
      return r ? !rowMatchesCard(r, a) : true;
    });
    const needsJsonUpdate =
      plan.adoptedIds.length > 0 ||
      plan.deletedIds.length > 0 ||
      plan.nextJson.length !== json.length ||
      json.filter((a) => a.isPrimary).length !== 1 ||
      plan.primaryId !== jsonPrimary;
    const needsPrimaryUpdate = plan.primaryId !== tablePrimary;

    if (!needsUpsert && !needsFieldSync && !needsJsonUpdate && !needsPrimaryUpdate) continue;

    changedCustomers++;
    adoptedTotal += plan.adoptedIds.length;
    deletedTotal += plan.deletedIds.length;
    upsertedTotal += plan.nextJson.filter((a) => !rowById.has(a.id)).length;

    console.log(
      ` - ${c.name || '(tanpa nama)'} (${c.phone}) | adopt=${plan.adoptedIds.length} hapus=${plan.deletedIds.length} ` +
        `upsert=${plan.nextJson.filter((a) => !rowById.has(a.id)).length} primary=${plan.primaryId ?? '-'} ` +
        `[json ${json.length} / tabel ${rows.length}]`
    );

    if (isDryRun) continue;

    await prisma.$transaction(async (tx) => {
      for (const card of plan.nextJson) {
        const data = cardToRow(card);
        const updated = await tx.customerAddress.updateMany({
          where: { id: card.id, customer_id: c.id, tenant_id: c.tenant_id },
          data,
        });
        if (updated.count === 0) {
          await tx.customerAddress.create({
            data: {
              id: card.id,
              tenant_id: c.tenant_id,
              customer_id: c.id,
              ...data,
              created_at: toDate(card.createdAt),
            },
          });
        }
      }

      if (plan.deletedIds.length > 0) {
        await tx.customerAddress.deleteMany({
          where: {
            id: { in: plan.deletedIds },
            customer_id: c.id,
            tenant_id: c.tenant_id,
          },
        });
      }

      // Invarian: tepat 1 primary (mengikuti plan).
      await tx.customerAddress.updateMany({
        where: { customer_id: c.id, tenant_id: c.tenant_id },
        data: { is_primary: false },
      });
      if (plan.primaryId) {
        await tx.customerAddress.updateMany({
          where: { id: plan.primaryId, customer_id: c.id, tenant_id: c.tenant_id },
          data: { is_primary: true },
        });
      }

      const prefs = (c.preferences as any) || {};
      await tx.customer.updateMany({
        where: { id: c.id, tenant_id: c.tenant_id },
        data: {
          preferences: {
            ...prefs,
            saved_addresses: plan.nextJson,
            saved_addresses_updated_at: new Date().toISOString(),
          },
        },
      });
    });
  }

  console.log(
    `[RECONCILE ADDRESSES] ${isCommit ? 'Selesai' : 'Dry-run selesai'}: ${changedCustomers} customer berubah, ` +
      `adopt=${adoptedTotal}, hapus=${deletedTotal}, upsert=${upsertedTotal}.`
  );
  if (isDryRun) {
    console.log('[RECONCILE ADDRESSES] Jalankan dengan --commit untuk menerapkan (wajib backup pg_dump).');
  }
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  run()
    .catch((err) => {
      console.error('[RECONCILE ADDRESSES ERROR]', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
