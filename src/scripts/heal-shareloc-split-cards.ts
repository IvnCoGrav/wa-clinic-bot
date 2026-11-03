/**
 * heal-shareloc-split-cards.ts
 *
 * Skrip healing IDEMPOTEN untuk anomali:
 * "Shareloc masuk tanpa teks jalan → dianggap rumah kedua (Rumah X 2)".
 *
 * Menggabungkan pasangan kartu:
 * - Kartu A (lama): teks jalan ada, belum ber-GPS presisi (estimated_area/manual_staff/null).
 * - Kartu B (baru): berkoordinat gps_pin dari shareloc WhatsApp.
 * - isRegionCompatible(A, B) === true.
 *
 * Pemenang = A (teks jalan lama bertahan, koordinat presisi disalin dari B).
 * Kartu B dihapus, reservasi dialihkan ke A.
 *
 * Sifat:
 * - DEFAULT = DRY-RUN read-only. Tulis HANYA dengan `--commit` eksplisit.
 * - Idempoten.
 * - Atomic per-customer via `$transaction`.
 */
import { prisma } from '../db/client';
import { isRegionCompatible, parseSavedAddresses, ensureSinglePrimary, type SavedCustomerAddress } from '../domain/customer-address';
import { pickHealingWinner } from '../domain/address-healing';

const isCommit = process.argv.includes('--commit') || process.argv.includes('--apply');
const isDryRun = !isCommit;
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const customerArg = process.argv.find((a) => a.startsWith('--customer='));
const tenantFilter = tenantArg ? tenantArg.split('=')[1]!.trim() : null;
const customerFilter = customerArg ? customerArg.split('=')[1]!.trim() : null;

const hasText = (s: unknown): boolean => typeof s === 'string' && s.trim().length > 0;
const norm = (s?: string | null): string => String(s ?? '').trim().toLowerCase();
const hasCoords = (r: any): boolean =>
  typeof r?.lat === 'number' && typeof r?.lng === 'number' && Number.isFinite(r.lat) && Number.isFinite(r.lng);

interface MergePair {
  customerId: string;
  tenantId: string;
  customerName: string;
  customerPhone: string;
  winnerCard: any; // kartu yang dipertahankan (identitas + teks)
  victimCard: any; // kartu yang dihapus
  gpsCard: any; // SATU-SATUNYA sumber koordinat presisi
  reason: string;
}

export async function findSharelocSplitPairs(): Promise<MergePair[]> {
  const whereCust: any = {};
  if (tenantFilter) whereCust.tenant_id = tenantFilter;
  if (customerFilter) whereCust.id = customerFilter;

  const customers = await prisma.customer.findMany({
    where: whereCust,
    include: {
      addresses: {
        orderBy: [{ created_at: 'asc' }],
      },
    },
  });

  const pairs: MergePair[] = [];

  for (const c of customers) {
    const tableCards = c.addresses || [];
    const jsonCards = parseSavedAddresses(c.preferences);

    // Kumpulkan semua representasi kartu (prioritaskan baris tabel bila ada)
    const cardMap = new Map<string, any>();
    for (const j of jsonCards) {
      cardMap.set(j.id, {
        id: j.id,
        label: j.label,
        address: j.address,
        kelurahan: j.kelurahan,
        kecamatan: j.kecamatan,
        kota: j.kota,
        lat: j.lat,
        lng: j.lng,
        distance_km: j.distanceKm,
        ongkir: j.ongkir,
        location_source: j.locationSource,
        is_primary: j.isPrimary,
        created_at: new Date(j.createdAt),
      });
    }
    for (const t of tableCards) {
      cardMap.set(t.id, t);
    }

    const cards = Array.from(cardMap.values()).sort(
      (x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime()
    );

    if (cards.length < 2) continue;

    // Cari kartu shareloc (location_source === 'gps_pin' dengan koordinat)
    const gpsCards = cards.filter((x) => x.location_source === 'gps_pin' && hasCoords(x));

    const usedCards = new Set<string>();
    for (const gpsCard of gpsCards) {
      // Cari kartu sebelumnya yang belum punya gps_pin dan kompatibel se-wilayah
      const olderCandidates = cards.filter((x) => {
        if (x.id === gpsCard.id) return false;
        if (x.location_source === 'gps_pin' && hasCoords(x)) return false; // sudah ber-GPS asli
        const timeDiffMinutes =
          (new Date(gpsCard.created_at).getTime() - new Date(x.created_at).getTime()) / 60000;
        if (timeDiffMinutes < -5) return false; // kartu GPS jauh lebih tua dari intake

        // Syarat penggabungan (deterministik, anti hapus rumah kedua yang sah):
        // 1. Teks jalan sama persis, ATAU
        // 2. Koordinat sama persis (< ~100 meter), ATAU
        // 3. Selisih waktu pembuatan <= 15 menit (intake teks lalu shareloc).
        // DILARANG menggabungkan hanya karena "satu-satunya kartu di kecamatan".
        const sameAddress =
          hasText(x.address) &&
          hasText(gpsCard.address) &&
          norm(x.address) === norm(gpsCard.address);

        const sameCoords =
          hasCoords(x) && hasCoords(gpsCard) &&
          Math.abs(Number(x.lat) - Number(gpsCard.lat)) < 0.001 &&
          Math.abs(Number(x.lng) - Number(gpsCard.lng)) < 0.001;

        if (sameAddress || sameCoords) return true;
        if (!isRegionCompatible(x, gpsCard)) return false;
        return timeDiffMinutes >= 0 && timeDiffMinutes <= 15;
      });

      if (olderCandidates.length === 0) continue;

      const picked = pickHealingWinner(gpsCard, olderCandidates);
      if (!picked) continue;
      const { winner, victim } = picked;
      if (usedCards.has(winner.id) || usedCards.has(victim.id)) continue;
      usedCards.add(winner.id);
      usedCards.add(victim.id);

      pairs.push({
        customerId: c.id,
        tenantId: c.tenant_id,
        customerName: c.name || '(tanpa nama)',
        customerPhone: c.phone,
        winnerCard: winner,
        victimCard: victim,
        gpsCard,
        reason: `Merge shareloc split: winner [${winner.label} (${winner.id.slice(0, 8)})] <- victim [${victim.label} (${victim.id.slice(0, 8)})]; GPS source ${gpsCard.id.slice(0, 8)}`,
      });
    }
  }

  return pairs;
}

export async function runHealing(): Promise<void> {
  console.log(`[HEAL SHARELOC SPLIT CARDS] Mode: ${isCommit ? 'COMMIT (MENULIS)' : 'DRY-RUN (READ-ONLY)'}`);
  const pairs = await findSharelocSplitPairs();

  console.log(`[HEAL SHARELOC SPLIT CARDS] Ditemukan ${pairs.length} pasangan kartu shareloc ganda.`);

  for (const p of pairs) {
    console.log(
      ` - Customer: ${p.customerName} (${p.customerPhone}) | Winner: ${p.winnerCard.label} (${p.winnerCard.id}) <- Victim: ${p.victimCard.label} (${p.victimCard.id})`
    );
  }

  if (isDryRun) {
    console.log('[HEAL SHARELOC SPLIT CARDS] Dry-run selesai. Jalankan dengan --commit untuk menerapkan.');
    return;
  }

  let appliedCount = 0;
  for (const p of pairs) {
    try {
      await prisma.$transaction(async (tx) => {
        const { winnerCard, victimCard, gpsCard, customerId, tenantId } = p;

        // 1. Pindahkan reservasi dari victim ke winner (tenant-scoped)
        await tx.reservation.updateMany({
          where: {
            customer_address_id: victimCard.id,
            customer_id: customerId,
            tenant_id: tenantId,
          },
          data: { customer_address_id: winnerCard.id },
        });

        // 2. Update winnerCard di tabel customer_addresses.
        //    Koordinat WAJIB dari kartu GPS (gpsCard), BUKAN dari victim.
        //    Bila pemenang hanya ada di JSON (belum tercermin di tabel), buat barisnya
        //    agar JSON dan tabel tidak kembali split-brain.
        const makePrimary = Boolean(winnerCard.is_primary || victimCard.is_primary);
        const winnerRow = {
          label: winnerCard.label ?? 'Rumah',
          address: winnerCard.address ?? '',
          kelurahan: winnerCard.kelurahan ?? null,
          kecamatan: winnerCard.kecamatan ?? null,
          kota: winnerCard.kota ?? null,
          lat: gpsCard.lat,
          lng: gpsCard.lng,
          distance_km: gpsCard.distance_km ?? winnerCard.distance_km ?? null,
          ongkir: gpsCard.ongkir ?? winnerCard.ongkir ?? null,
          landmark: winnerCard.landmark ?? null,
          location_source: 'gps_pin',
          is_primary: makePrimary,
          last_used_at: new Date(),
        };
        const updatedWinner = await tx.customerAddress.updateMany({
          where: { id: winnerCard.id, customer_id: customerId, tenant_id: tenantId },
          data: winnerRow,
        });
        if (updatedWinner.count === 0) {
          await tx.customerAddress.create({
            data: {
              id: winnerCard.id,
              tenant_id: tenantId,
              customer_id: customerId,
              ...winnerRow,
              created_at: winnerCard.created_at ? new Date(winnerCard.created_at) : new Date(),
            },
          });
        }
        if (makePrimary) {
          // Invarian: tepat 1 primary per customer.
          await tx.customerAddress.updateMany({
            where: { customer_id: customerId, tenant_id: tenantId, id: { not: winnerCard.id } },
            data: { is_primary: false },
          });
        }

        // 3. Hapus victimCard dari tabel customer_addresses (tenant-scoped)
        await tx.customerAddress.deleteMany({
          where: { id: victimCard.id, customer_id: customerId, tenant_id: tenantId },
        });

        // 4. Perbarui preferences.saved_addresses
        const cust = await tx.customer.findUnique({
          where: { id: customerId },
        });

        if (cust) {
          const list = parseSavedAddresses(cust.preferences);
          const nextList: SavedCustomerAddress[] = list
            .filter((a) => a.id !== victimCard.id)
            .map((a) => {
              if (a.id === winnerCard.id) {
                return {
                  ...a,
                  // Teks/label/region pemenang DIPERTAHANKAN; koordinat dari kartu GPS.
                  address: a.address || gpsCard.address || '',
                  lat: gpsCard.lat,
                  lng: gpsCard.lng,
                  distanceKm: gpsCard.distance_km ?? a.distanceKm,
                  ongkir: gpsCard.ongkir ?? a.ongkir,
                  locationSource: 'gps_pin' as const,
                  isPrimary: makePrimary ? true : a.isPrimary,
                  lastUsedAt: new Date().toISOString(),
                };
              }
              return a;
            });

          const currentPrefs = (cust.preferences as any) || {};
          const nowIso = new Date().toISOString();
          const normalizedList = makePrimary ? ensureSinglePrimary(nextList, winnerCard.id) : nextList;

          // TIDAK membuat tombstone: identitas alamat tetap hidup di pemenang
          // (teks + koordinat), sehingga tidak ada kartu yang perlu dicegah lahir kembali.
          const updateData: any = {
            preferences: {
              ...currentPrefs,
              saved_addresses: normalizedList,
              saved_addresses_updated_at: nowIso,
            },
          };

          if (makePrimary) {
            updateData.lat = gpsCard.lat;
            updateData.lng = gpsCard.lng;
            updateData.location_source = 'gps_pin';
            updateData.share_location_sent = true;
            if (gpsCard.distance_km != null) updateData.distance_km = gpsCard.distance_km;
            if (gpsCard.ongkir != null) updateData.ongkir = gpsCard.ongkir;
          }

          await tx.customer.updateMany({
            where: { id: customerId, tenant_id: tenantId },
            data: updateData,
          });
        }
      });

      appliedCount++;
      console.log(`[HEAL COMMIT] Berhasil merge customer ${p.customerPhone}`);
    } catch (err: any) {
      console.error(`[HEAL COMMIT ERROR] Gagal merge customer ${p.customerPhone}:`, err?.message);
    }
  }

  console.log(`[HEAL SHARELOC SPLIT CARDS] Selesai: ${appliedCount} berhasil dimerge.`);
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  runHealing()
    .catch((err) => {
      console.error('[HEAL ERROR]', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
