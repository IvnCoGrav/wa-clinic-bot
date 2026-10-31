/**
 * heal-customer-addresses-split-brain.ts (REVISI-1 Tahap 1.3 & Fase 3)
 *
 * Skrip healing IDEMPOTEN untuk anomali alamat pelanggan:
 *  1. Ghost primary: baris `customer_addresses` ber-`is_primary=true` dengan
 *     `address` kosong, sementara baris saudara sekustomer berisi teks jalan + koordinat
 *     → pindahkan `is_primary` ke baris terisi.
 *  2. Desync sumber: `customers.location_source` vs baris address primer beda
 *     → sinkronkan deterministik sisi pemenang.
 *  3. Duplikat teks-identik / kelurahan-NULL (Pass 3):
 *     - Kelompokkan baris se-kustomer yang merujuk pada rumah yang sama via `addressesMatch`.
 *     - Pilih pemenang (winner) berbasis skor kelengkapan (koordinat + teks + primary).
 *     - Selamatkan koordinat/kelurahan/landmark dari hantu ke pemenang bila pemenang kosong.
 *     - Upgrade ke `gps_pin` bila kustomer terbukti pernah kirim shareloc WhatsApp asli (`locationMessage`).
 *     - Pindahkan semua reservasi yang menunjuk ke baris hantu ke ID pemenang.
 *     - Hapus baris hantu (`customer_addresses`).
 *     - Sinkronkan `customers.preferences.saved_addresses` dan field root customer.
 *
 * Sifat (wajib):
 * - DEFAULT = DRY-RUN read-only. Tulis HANYA dengan `--commit` atau `--apply` eksplisit.
 * - Idempoten: rerun setelah commit menghasilkan 0 aksi duplikasi / 0 tulis.
 * - Per-customer dalam `$transaction` (atomic per customer, tanpa lock global).
 * - Bebas hardcode: tanpa if (name === 'Mery') atau semacamnya, murni data-driven.
 *
 * Usage (prod, SETELAH backup pg_dump + build image terbaru):
 *   docker compose exec -T app node dist/scripts/heal-customer-addresses-split-brain.js --dry-run [--tenant=ID]
 *   docker compose exec -T app node dist/scripts/heal-customer-addresses-split-brain.js --commit [--tenant=ID] [--limit=N]
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { addressesMatch } from '../domain/customer-address';

const isCommit = process.argv.includes('--commit') || process.argv.includes('--apply');
const isDryRun = !isCommit;
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const customerArg = process.argv.find((a) => a.startsWith('--customer='));
const tenantFilter = tenantArg ? tenantArg.split('=')[1]!.trim() : null;
const customerFilter = customerArg ? customerArg.split('=')[1]!.trim() : null;
const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 1000) : 1000;

const hasText = (s: unknown): boolean => typeof s === 'string' && s.trim().length > 0;
const hasCoords = (r: any): boolean =>
  typeof r?.lat === 'number' && typeof r?.lng === 'number' && Number.isFinite(r.lat) && Number.isFinite(r.lng);

function scoreAddressRow(r: any): number {
  let s = 0;
  if (hasText(r.address)) s += 4;
  if (hasCoords(r)) s += 4;
  if (hasText(r.kelurahan) && hasText(r.kecamatan)) s += 2;
  if (hasText(r.landmark)) s += 1;
  return s;
}

function scoreAddressWinner(r: any): number {
  let s = scoreAddressRow(r);
  if (r.is_primary) s += 10;
  // gps_pin bernilai 15 agar kartu ber-GPS presisi diutamakan di atas kartu estimasi lama
  if (r.location_source === 'gps_pin') s += 15;
  else if (r.location_source === 'manual_staff') s += 8;
  return s;
}

interface Action {
  kind: 'MOVE_PRIMARY' | 'SYNC_ADDR_FROM_CUSTOMER' | 'SYNC_CUSTOMER_FROM_ADDR' | 'MERGE_DUPLICATE' | 'REPORT_ONLY';
  customerId: string;
  tenantId: string;
  detail: string;
  apply: () => Promise<void>;
}

async function main(): Promise<void> {
  console.log(`[HEAL SPLIT-BRAIN] mode=${isDryRun ? 'DRY-RUN (read-only)' : 'COMMIT'} tenant=${tenantFilter || '(semua)'} customer=${customerFilter || '(semua)'} limit=${limit}`);
  if (isCommit) {
    console.log('[HEAL SPLIT-BRAIN] Pastikan backup pg_dump -t customer_addresses -t customers -t reservations SUDAH dibuat sebelum commit.');
  }

  const whereClause: any = {};
  if (tenantFilter) whereClause.tenant_id = tenantFilter;
  if (customerFilter) whereClause.customer_id = customerFilter;

  // Ambil seluruh customer_addresses yang ada di DB untuk filter ini
  const allAddresses: any[] = await (prisma as any).customerAddress.findMany({
    where: whereClause,
    orderBy: [{ customer_id: 'asc' }, { is_primary: 'desc' }, { last_used_at: 'desc' }],
    take: limit * 10,
  });

  const byCustomer = new Map<string, any[]>();
  for (const a of allAddresses) {
    const arr = byCustomer.get(a.customer_id) || [];
    arr.push(a);
    byCustomer.set(a.customer_id, arr);
  }

  const actions: Action[] = [];
  let scanned = 0;

  for (const [customerId, siblings] of byCustomer) {
    if (scanned >= limit) break;
    scanned++;
    const tenantId = siblings[0]?.tenant_id || DEFAULT_TENANT_ID;
    const customer: any = await (prisma as any).customer.findUnique({ where: { id: customerId } }).catch(() => null);
    if (!customer) {
      actions.push({ kind: 'REPORT_ONLY', customerId, tenantId, detail: 'customer hilang (yatim) — lapor saja', apply: async () => {} });
      continue;
    }

    // --- Pass 1: ghost primary (primer kosong, saudara isi) ---
    const primaries = siblings.filter((r) => r.is_primary);
    const ghostPrimaries = primaries.filter((r) => !hasText(r.address));
    if (ghostPrimaries.length > 0) {
      const candidates = siblings.filter((r) => hasText(r.address));
      if (candidates.length > 0) {
        candidates.sort((x, y) => scoreAddressRow(y) - scoreAddressRow(x) || (String(y.last_used_at) > String(x.last_used_at) ? 1 : -1));
        const winner = candidates[0];
        const ghostIds = ghostPrimaries.map((g: any) => g.id);
        actions.push({
          kind: 'MOVE_PRIMARY',
          customerId,
          tenantId,
          detail: `pindahkan is_primary [${ghostIds.join(',')}] → ${winner.id} (${String(winner.address).slice(0, 40)})`,
          apply: async () => {
            await (prisma as any).$transaction([
              ...(ghostIds.map((id: string) => (prisma as any).customerAddress.update({ where: { id }, data: { is_primary: false } }))),
              (prisma as any).customerAddress.update({ where: { id: winner.id }, data: { is_primary: true, last_used_at: new Date() } }),
            ]);
          },
        });
      } else if (siblings.length === 1) {
        actions.push({ kind: 'REPORT_ONLY', customerId, tenantId, detail: 'ghost primary tanpa baris isi (hanya 1 kartu) — lapor saja', apply: async () => {} });
        continue;
      }
    }

    // --- Pass 2: desync sumber (primer sah vs customers) ---
    const primary = primaries[0] || siblings[0];
    if (primary) {
      const custSrc = String(customer.location_source || '');
      const addrSrc = String(primary.location_source || '');
      if (custSrc !== addrSrc) {
        const custPrecise = custSrc === 'gps_pin' || custSrc === 'manual_staff';
        const addrPrecise = addrSrc === 'gps_pin' || addrSrc === 'manual_staff';

        if ((custSrc === 'gps_pin' || addrSrc === 'gps_pin') && custSrc !== addrSrc) {
          actions.push({ kind: 'REPORT_ONLY', customerId, tenantId, detail: `melibatkan gps_pin (${custSrc} vs ${addrSrc}) — pin asli terkunci, lapor saja`, apply: async () => {} });
        } else if (custPrecise && hasCoords(customer) && !addrPrecise) {
          actions.push({
            kind: 'SYNC_ADDR_FROM_CUSTOMER',
            customerId,
            tenantId,
            detail: `tulis koordinat+sumber customers(${custSrc}) → address ${primary.id}`,
            apply: async () => {
              await (prisma as any).customerAddress.update({
                where: { id: primary.id },
                data: { lat: customer.lat, lng: customer.lng, distance_km: customer.distance_km ?? undefined, location_source: customer.location_source },
              });
            },
          });
        } else if (addrPrecise && hasCoords(primary) && !custPrecise) {
          actions.push({
            kind: 'SYNC_CUSTOMER_FROM_ADDR',
            customerId,
            tenantId,
            detail: `tulis koordinat+sumber address(${addrSrc}) → customers`,
            apply: async () => {
              await (prisma as any).customer.update({
                where: { id: customerId },
                data: { lat: primary.lat, lng: primary.lng, distance_km: primary.distance_km ?? undefined, location_source: primary.location_source },
              });
            },
          });
        }
      }
    }

    // --- Pass 3: Dedup duplikat teks-identik / kelurahan-null (MERGE_DUPLICATE) ---
    if (siblings.length > 1) {
      const clusters: any[][] = [];
      const visited = new Set<string>();

      for (const r of siblings) {
        if (visited.has(r.id)) continue;
        const cluster = [r];
        visited.add(r.id);
        for (const other of siblings) {
          if (visited.has(other.id)) continue;
          if (addressesMatch(r, other)) {
            cluster.push(other);
            visited.add(other.id);
          }
        }
        if (cluster.length > 1) {
          clusters.push(cluster);
        }
      }

      // --- Pass 4: Kartu tanpa identitas (address kosong + kelurahan null + koordinat null) ---
      // Bila masih ada kartu hantu tanpa identitas yang belum masuk klaster, gabungkan ke
      // kartu saudara ber-identitas di kota yang sama (anti kartu yatim/kosong).
      const unvisitedGhosts = siblings.filter(
        (r) => !visited.has(r.id) && !hasText(r.address) && !hasText(r.kelurahan) && !hasCoords(r)
      );
      if (unvisitedGhosts.length > 0) {
        const identifiedCandidates = siblings.filter(
          (r) => hasText(r.address) || hasCoords(r)
        );
        if (identifiedCandidates.length > 0) {
          identifiedCandidates.sort(
            (x, y) => scoreAddressWinner(y) - scoreAddressWinner(x) || (String(y.last_used_at || '') > String(x.last_used_at || '') ? 1 : -1)
          );
          const bestIdentified = identifiedCandidates[0];
          const existingCluster = clusters.find((c) => c.some((r) => r.id === bestIdentified.id));
          for (const g of unvisitedGhosts) {
            const gKota = String(g.kota || '').toLowerCase().replace(/^(kota|kabupaten|kab)\s+/i, '').trim();
            const bKota = String(bestIdentified.kota || '').toLowerCase().replace(/^(kota|kabupaten|kab)\s+/i, '').trim();
            const kotaOk = !gKota || !bKota || gKota === bKota;
            if (kotaOk) {
              visited.add(g.id);
              if (existingCluster) {
                existingCluster.push(g);
              } else {
                clusters.push([bestIdentified, g]);
              }
            }
          }
        }
      }

      for (const cluster of clusters) {
        // Cari pemenang dalam klaster
        cluster.sort((x, y) => scoreAddressWinner(y) - scoreAddressWinner(x) || (String(y.last_used_at || '') > String(x.last_used_at || '') ? 1 : -1));
        const winner = { ...cluster[0] };
        const ghosts = cluster.slice(1);
        const ghostIds = ghosts.map((g: any) => g.id);

        let enrichedCoords = false;
        // Utamakan koordinat GPS presisi jika winner bukan gps_pin tapi ghost memiliki gps_pin
        const ghostGps = ghosts.find((g: any) => g.location_source === 'gps_pin' && hasCoords(g));
        if (winner.location_source !== 'gps_pin' && ghostGps) {
          winner.lat = ghostGps.lat;
          winner.lng = ghostGps.lng;
          winner.distance_km = ghostGps.distance_km;
          winner.ongkir = ghostGps.ongkir;
          winner.location_source = 'gps_pin';
          enrichedCoords = true;
        } else if (!hasCoords(winner)) {
          const ghostWithCoords = ghosts.find((g: any) => hasCoords(g));
          if (ghostWithCoords) {
            winner.lat = ghostWithCoords.lat;
            winner.lng = ghostWithCoords.lng;
            winner.distance_km = ghostWithCoords.distance_km;
            winner.ongkir = ghostWithCoords.ongkir;
            winner.location_source = ghostWithCoords.location_source;
            enrichedCoords = true;
          }
        }
        if (!hasText(winner.kelurahan)) {
          const ghostWithKel = ghosts.find((g: any) => hasText(g.kelurahan));
          if (ghostWithKel) winner.kelurahan = ghostWithKel.kelurahan;
        }
        if (!hasText(winner.landmark)) {
          const ghostWithLandmark = ghosts.find((g: any) => hasText(g.landmark));
          if (ghostWithLandmark) winner.landmark = ghostWithLandmark.landmark;
        }
        if (ghosts.some((g: any) => g.is_primary)) {
          winner.is_primary = true;
        }

        // Cek riwayat pesan WA lokasi asli (data-driven ground truth)
        let waGpsFound: { lat: number; lng: number } | null = null;
        try {
          const waLocs: any[] = await (prisma as any).$queryRawUnsafe(
            `SELECT m.payload_raw->'_data'->'message'->'locationMessage'->'degreesLatitude' as lat,
                    m.payload_raw->'_data'->'message'->'locationMessage'->'degreesLongitude' as lng
             FROM messages m
             JOIN conversations cv ON m.conversation_id = cv.id
             WHERE cv.customer_id = $1 AND m.direction = 'INBOUND' AND m.payload_raw::text ILIKE '%degreesLatitude%'
             ORDER BY m.created_at DESC LIMIT 1`,
            customerId
          );
          if (waLocs.length > 0 && waLocs[0].lat != null && waLocs[0].lng != null) {
            const latNum = parseFloat(waLocs[0].lat);
            const lngNum = parseFloat(waLocs[0].lng);
            if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
              waGpsFound = { lat: latNum, lng: lngNum };
            }
          }
        } catch {
          // Best-effort jika query raw tidak tersedia
        }

        let upgradeGpsPin = false;
        if (waGpsFound) {
          if (winner.location_source !== 'gps_pin' || !hasCoords(winner)) {
            winner.lat = waGpsFound.lat;
            winner.lng = waGpsFound.lng;
            winner.location_source = 'gps_pin';
            upgradeGpsPin = true;
          }
        }

        actions.push({
          kind: 'MERGE_DUPLICATE',
          customerId,
          tenantId,
          detail: `gabungkan [${ghostIds.join(', ')}] (${ghosts.map((g: any) => g.label || g.id).join(', ')}) → winner ${winner.id} (${winner.label})${enrichedCoords ? ' [koordinat dari ghost]' : ''}${upgradeGpsPin ? ' [upgrade ke gps_pin via WA shareloc asli]' : ''}`,
          apply: async () => {
            await (prisma as any).$transaction(async (tx: any) => {
              // 1. Pindahkan reservasi milik kustomer ini ke ID pemenang
              await tx.reservation.updateMany({
                where: {
                  customer_id: customerId,
                  customer_address_id: { in: ghostIds },
                  tenant_id: tenantId,
                },
                data: {
                  customer_address_id: winner.id,
                },
              });

              // 2. Perbarui baris pemenang
              await tx.customerAddress.update({
                where: { id: winner.id },
                data: {
                  lat: winner.lat != null ? winner.lat : undefined,
                  lng: winner.lng != null ? winner.lng : undefined,
                  kelurahan: winner.kelurahan != null ? winner.kelurahan : undefined,
                  landmark: winner.landmark != null ? winner.landmark : undefined,
                  distance_km: winner.distance_km != null ? winner.distance_km : undefined,
                  ongkir: winner.ongkir != null ? winner.ongkir : undefined,
                  location_source: winner.location_source != null ? winner.location_source : undefined,
                  is_primary: Boolean(winner.is_primary),
                  last_used_at: new Date(),
                },
              });

              // 3. Hapus entri-entri hantu
              await tx.customerAddress.deleteMany({
                where: {
                  id: { in: ghostIds },
                  customer_id: customerId,
                },
              });

              // 4. Baca sisa alamat di DB
              const remaining: any[] = await tx.customerAddress.findMany({
                where: { customer_id: customerId },
                orderBy: [{ is_primary: 'desc' }, { last_used_at: 'desc' }],
              });

              // 5. Sinkronkan preferences.saved_addresses
              const currentPrefs = (customer?.preferences as any) || {};
              const nextSavedAddresses = remaining.map((a: any) => ({
                id: a.id,
                label: a.label,
                address: a.address,
                kelurahan: a.kelurahan,
                kecamatan: a.kecamatan,
                kota: a.kota,
                lat: a.lat,
                lng: a.lng,
                distanceKm: a.distance_km,
                ongkir: a.ongkir,
                landmark: a.landmark,
                locationSource: a.location_source,
                isPrimary: a.is_primary,
                createdAt: a.created_at ? new Date(a.created_at).toISOString() : new Date().toISOString(),
                lastUsedAt: a.last_used_at ? new Date(a.last_used_at).toISOString() : new Date().toISOString(),
              }));

              const custUpdateData: any = {
                preferences: {
                  ...currentPrefs,
                  saved_addresses: nextSavedAddresses,
                  saved_addresses_updated_at: new Date().toISOString(),
                  location_updated_at: new Date().toISOString(),
                  location_updated_by_staff_name: 'Heal Split-Brain Auto-Dedup',
                },
              };

              if (winner.is_primary) {
                if (winner.lat != null && winner.lng != null) {
                  custUpdateData.lat = winner.lat;
                  custUpdateData.lng = winner.lng;
                  custUpdateData.location_source = winner.location_source;
                  custUpdateData.distance_km = winner.distance_km;
                  custUpdateData.ongkir = winner.ongkir;
                }
                if (winner.location_source === 'gps_pin' || upgradeGpsPin) {
                  custUpdateData.share_location_sent = true;
                }
              }

              await tx.customer.update({
                where: { id: customerId },
                data: custUpdateData,
              });
            });
          },
        });
      }
    }
  }

  const counts: Record<string, number> = {};
  for (const a of actions) {
    counts[a.kind] = (counts[a.kind] || 0) + 1;
    console.log(`[${a.kind}] customer=${a.customerId} tenant=${a.tenantId} :: ${a.detail}`);
  }

  let applied = 0;
  if (isCommit) {
    for (const a of actions) {
      if (a.kind === 'REPORT_ONLY') continue;
      try {
        await a.apply();
        applied++;
      } catch (e: any) {
        console.warn(`[HEAL SPLIT-BRAIN] Gagal apply ${a.kind} ${a.customerId}: ${e?.message} — lanjut (per-item).`);
      }
    }
  }

  console.log(`[HEAL SPLIT-BRAIN] Selesai: dipindai=${scanned} aksi=${actions.length} ditulis=${applied} rincian=${JSON.stringify(counts)}${isDryRun ? ' (DRY-RUN: 0 tulis)' : ''}`);
}

main()
  .catch((e) => {
    console.error('[HEAL SPLIT-BRAIN ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
