/**
 * heal-customer-addresses-split-brain.ts (REVISI-1 Tahap 1.3)
 *
 * Skrip healing IDEMPOTEN untuk dua anomali lokasi (temuan audit 12/10/2026):
 *  1. Ghost primary: baris `customer_addresses` ber-`is_primary=true` dengan
 *     `address` kosong, sementara baris SE-... (saudara sekustomer) berisi
 *     teks jalan + koordinat → pindahkan `is_primary` ke baris terisi.
 *  2. Desync sumber: `customers.location_source` vs baris address primer beda.
 *
 * Sifat (wajib):
 * - DEFAULT = DRY-RUN read-only. Tulis HANYA dengan `--commit` eksplisit.
 * - Otoritas deterministik (tanpa "atau sebaliknya" kabur):
 *     customers=manual+koordinat vs address=estimated/NULL → menang customers
 *       (tulis koordinat+sumber customers ke baris address).
 *     customers=estimated vs address=manual+koordinat → menang address
 *       (tulis koordinat+sumber address ke baris customers).
 *     Kedua sisi tanpa koordinat → LAPOR SAJA (tidak ada kebenaran baru).
 * - Idempoten: rerun setelah commit menghasilkan 0 tulis.
 * - Per-customer dalam `$transaction` (atomic per customer, tanpa lock global).
 * - TIDAK MENYENTUH `location_source='gps_pin'` (pin GPS asli terkunci).
 *
 * Usage (prod, SETELAH backup pg_dump + build image terbaru):
 *   docker compose exec -T app node dist/scripts/heal-customer-addresses-split-brain.js --dry-run
 *   docker compose exec -T app node dist/scripts/heal-customer-addresses-split-brain.js --commit [--tenant=ID] [--limit=N]
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

const isCommit = process.argv.includes('--commit');
const isDryRun = !isCommit;
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const tenantFilter = tenantArg ? tenantArg.split('=')[1]!.trim() : null;
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

interface Action {
  kind: 'MOVE_PRIMARY' | 'SYNC_ADDR_FROM_CUSTOMER' | 'SYNC_CUSTOMER_FROM_ADDR' | 'REPORT_ONLY';
  customerId: string;
  tenantId: string;
  detail: string;
  apply: () => Promise<void>;
}

async function main(): Promise<void> {
  console.log(`[HEAL SPLIT-BRAIN] mode=${isDryRun ? 'DRY-RUN (read-only)' : 'COMMIT'} tenant=${tenantFilter || '(semua)'} limit=${limit}`);
  if (isCommit) {
    console.log('[HEAL SPLIT-BRAIN] Pastikan backup pg_dump -t customer_addresses -t customers SUDAH dibuat sebelum commit.');
  }

  const whereTenant = tenantFilter ? { tenant_id: tenantFilter } : {};
  const primaries: any[] = await (prisma as any).customerAddress.findMany({
    where: { ...whereTenant, is_primary: true },
    take: limit * 5,
  });

  const byCustomer = new Map<string, any[]>();
  for (const p of primaries) {
    const arr = byCustomer.get(p.customer_id) || [];
    arr.push(p);
    byCustomer.set(p.customer_id, arr);
  }

  const actions: Action[] = [];
  let scanned = 0;

  for (const [customerId, rows] of byCustomer) {
    if (scanned >= limit) break;
    scanned++;
    const tenantId = rows[0]?.tenant_id || DEFAULT_TENANT_ID;
    const customer: any = await (prisma as any).customer.findUnique({ where: { id: customerId } }).catch(() => null);
    if (!customer) {
      actions.push({ kind: 'REPORT_ONLY', customerId, tenantId, detail: 'customer hilang (yatim) — lapor saja', apply: async () => {} });
      continue;
    }
    const siblings: any[] = await (prisma as any).customerAddress.findMany({ where: { customer_id: customerId } }).catch(() => rows);

    // --- Pass 1: ghost primary (primer kosong, saudara isi) ---
    const ghostPrimaries = rows.filter((r) => !hasText(r.address));
    if (ghostPrimaries.length > 0) {
      const candidates = siblings.filter((r) => hasText(r.address));
      if (candidates.length > 0) {
        candidates.sort((x, y) => scoreAddressRow(y) - scoreAddressRow(x) || (String(y.last_used_at) > String(x.last_used_at) ? 1 : -1));
        const winner = candidates[0];
        const ghostIds = ghostPrimaries.map((g: any) => g.id);
        actions.push({
          kind: 'MOVE_PRIMARY', customerId, tenantId,
          detail: `pindahkan is_primary ${ghostIds.join(',')} → ${winner.id} (${String(winner.address).slice(0, 40)})`,
          apply: async () => {
            await (prisma as any).$transaction([
              ...(ghostIds.map((id: string) => (prisma as any).customerAddress.update({ where: { id }, data: { is_primary: false } }))),
              (prisma as any).customerAddress.update({ where: { id: winner.id }, data: { is_primary: true, last_used_at: new Date() } }),
            ]);
          },
        });
        continue; // desync dinilai ulang setelah primary benar (rerun).
      }
      actions.push({ kind: 'REPORT_ONLY', customerId, tenantId, detail: 'ghost primary tanpa baris isi — lapor saja', apply: async () => {} });
      continue;
    }

    // --- Pass 2: desync sumber (primer sah vs customers) ---
    const primary = rows.find((r) => r.is_primary) || rows[0];
    const custSrc = String(customer.location_source || '');
    const addrSrc = String(primary.location_source || '');
    if (custSrc === addrSrc) continue;
    const custPrecise = custSrc === 'gps_pin' || custSrc === 'manual_staff';
    const addrPrecise = addrSrc === 'gps_pin' || addrSrc === 'manual_staff';

    if ((custSrc === 'gps_pin' || addrSrc === 'gps_pin') && custSrc !== addrSrc) {
      actions.push({ kind: 'REPORT_ONLY', customerId, tenantId, detail: `melibatkan gps_pin (${custSrc} vs ${addrSrc}) — pin asli terkunci, lapor saja`, apply: async () => {} });
      continue;
    }
    if (custPrecise && hasCoords(customer) && !addrPrecise) {
      actions.push({
        kind: 'SYNC_ADDR_FROM_CUSTOMER', customerId, tenantId,
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
        kind: 'SYNC_CUSTOMER_FROM_ADDR', customerId, tenantId,
        detail: `tulis koordinat+sumber address(${addrSrc}) → customers`,
        apply: async () => {
          await (prisma as any).customer.update({
            where: { id: customerId },
            data: { lat: primary.lat, lng: primary.lng, distance_km: primary.distance_km ?? undefined, location_source: primary.location_source },
          });
        },
      });
    } else {
      actions.push({ kind: 'REPORT_ONLY', customerId, tenantId, detail: `tanpa koordinat di sisi menang (${custSrc} vs ${addrSrc}) — lapor saja`, apply: async () => {} });
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
