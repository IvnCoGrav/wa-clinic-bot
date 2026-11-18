/**
 * heal-single-card-provenance.ts (Plan v2.1 — Fase 5, direvisi v2.2 F4)
 *
 * Skrip healing IDEMPOTEN untuk anomali:
 * "1 kartu, koordinat ≈ pin WA pelanggan, tapi label bukan gps_pin dan alamat/patokan hilang".
 *
 * DEFAULT = DRY-RUN read-only. Tulis HANYA dengan --commit / --apply.
 *
 * Usage:
 *   npx tsx src/scripts/heal-single-card-provenance.ts --dry-run [--tenant=ID] [--customer=ID] [--limit=N]
 *   npx tsx src/scripts/heal-single-card-provenance.ts --commit [--tenant=ID] [--customer=ID]
 *   npx tsx src/scripts/heal-single-card-provenance.ts --dry-run --all-tenants
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { distanceMeters, hasValidCoords, type Coordinates } from '../domain/location-adequacy';
import { ensureSinglePrimary, parseSavedAddresses } from '../domain/customer-address';

export interface HealOptions {
  commit?: boolean;
  tenantId?: string | null;
  allTenants?: boolean;
  customerId?: string | null;
  limit?: number;
}

function parseArgs(argv: string[]): HealOptions {
  const commit = argv.includes('--commit') || argv.includes('--apply');
  const allTenants = argv.includes('--all-tenants');
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const customerArg = argv.find((a) => a.startsWith('--customer='));
  const tenantId = allTenants ? null : (tenantArg ? tenantArg.split('=')[1]!.trim() : DEFAULT_TENANT_ID);
  const customerId = customerArg ? customerArg.split('=')[1]!.trim() : null;
  const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1]!, 10) || 1000) : 1000;
  return { commit, tenantId, allTenants, customerId, limit };
}

const hasText = (s: unknown): boolean => typeof s === 'string' && s.trim().length > 0;
const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export function hasWaGpsEvidence(c: any): boolean {
  const prefs = (c?.preferences as any) || {};
  const srcs = [c?.location_source, prefs.location_source, prefs.source].map((x) => String(x || '').toLowerCase());
  // A-001 (F3): pin bidan (bidan_shareloc / pin_from_staff_at tanpa konfirmasi customer)
  // BUKAN bukti konfirmasi pelanggan → tidak boleh dipakai sebagai dasar healing provenance customer.
  if (prefs.pin_from_staff_at && !prefs.pin_from_customer_at && c?.share_location_sent !== true) return false;
  return (
    c?.share_location_sent === true ||
    Boolean(prefs.pin_from_customer_at) ||
    srcs.includes('gps_pin') ||
    srcs.includes('customer_shareloc')
  );
}

async function findLatestWaPin(customerId: string): Promise<{ lat: number; lng: number; address?: string; name?: string } | null> {
  try {
    const rows: any[] = await (prisma as any).$queryRawUnsafe(
      `SELECT m.payload_raw->'_data'->'message'->'locationMessage'->>'degreesLatitude' as lat,
              m.payload_raw->'_data'->'message'->'locationMessage'->>'degreesLongitude' as lng,
              m.payload_raw->'_data'->'message'->'locationMessage'->>'address' as addr,
              m.payload_raw->'_data'->'message'->'locationMessage'->>'name' as name
       FROM messages m
       JOIN conversations cv ON m.conversation_id = cv.id
       WHERE cv.customer_id = $1 AND m.direction = 'INBOUND' AND m.payload_raw::text ILIKE '%degreesLatitude%'
       ORDER BY m.created_at DESC LIMIT 1`,
      customerId
    );
    if (rows.length === 0) return null;
    const latNum = parseFloat(rows[0].lat);
    const lngNum = parseFloat(rows[0].lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
    return {
      lat: latNum,
      lng: lngNum,
      address: hasText(rows[0].addr) ? String(rows[0].addr).trim() : undefined,
      name: hasText(rows[0].name) ? String(rows[0].name).trim() : undefined,
    };
  } catch {
    return null;
  }
}

interface HealAction {
  customerId: string;
  tenantId: string;
  cardId: string;
  before: any;
  after: any;
  detail: string;
  apply: () => Promise<void>;
}

export async function runHeal(options: HealOptions = {}): Promise<{ scanned: number; candidates: number; applied: number; actions: HealAction[] }> {
  const commit = Boolean(options.commit);
  const isDryRun = !commit;
  const tenantFilter = options.allTenants ? null : (options.tenantId ?? DEFAULT_TENANT_ID);
  const customerFilter = options.customerId ?? null;
  const limit = Math.max(1, options.limit ?? 1000);

  const whereCust: any = {};
  if (tenantFilter) whereCust.tenant_id = tenantFilter;
  if (customerFilter) whereCust.id = customerFilter;

  const customers = await (prisma as any).customer.findMany({
    where: whereCust,
    take: limit,
    orderBy: { created_at: 'desc' },
    include: { addresses: true },
  });

  let scanned = 0;
  const actions: HealAction[] = [];

  for (const c of customers) {
    scanned++;
    const cards = (c as any).addresses || [];
    if (cards.length !== 1) continue;
    if (!hasWaGpsEvidence(c)) continue;

    const card = cards[0];
    if (String(card.location_source || '').toLowerCase() === 'gps_pin') continue;

    const custCoords: Coordinates = {
      lat: c.lat != null ? Number(c.lat) : null,
      lng: c.lng != null ? Number(c.lng) : null,
    };
    const cardCoords: Coordinates = {
      lat: card.lat != null ? Number(card.lat) : null,
      lng: card.lng != null ? Number(card.lng) : null,
    };
    if (!hasValidCoords(custCoords) || !hasValidCoords(cardCoords)) continue;
    const d = distanceMeters(custCoords, cardCoords);
    if (d > 150) continue;

    const wa = await findLatestWaPin(c.id);
    const cardAddress = String(card.address || '').trim();
    const cardKel = String(card.kelurahan || '').trim();
    const needsAddressFill = !hasText(cardAddress) || norm(cardAddress) === norm(cardKel);
    const newAddress = needsAddressFill && wa?.address ? wa.address : cardAddress;
    const newLandmark = !hasText(card.landmark) && wa?.name ? wa.name : (card.landmark || null);

    const before = {
      card_location_source: card.location_source,
      card_address: card.address,
      card_landmark: card.landmark,
      customer_location_source: c.location_source,
      customer_preferences_location_source: (c.preferences as any)?.location_source ?? null,
      customer_preferences_location_source_label: (c.preferences as any)?.location_source_label ?? null,
    };
    const after = {
      card_location_source: 'gps_pin',
      card_address: newAddress,
      card_landmark: newLandmark,
      customer_location_source: 'gps_pin',
      customer_preferences_location_source: 'gps_pin',
      customer_preferences_location_source_label: null,
    };

    actions.push({
      customerId: c.id,
      tenantId: c.tenant_id,
      cardId: card.id,
      before,
      after,
      detail: `${c.name || c.phone || c.id}: card ${card.id} ${d.toFixed(1)}m dari pin, ${card.location_source}→gps_pin${needsAddressFill && wa?.address ? `, address←WA` : ''}${!hasText(card.landmark) && wa?.name ? `, landmark←WA` : ''}`,
      apply: async () => {
        await (prisma as any).$transaction(async (tx: any) => {
          await tx.customerAddress.update({
            where: { id: card.id },
            data: {
              location_source: 'gps_pin',
              address: newAddress || card.address || '',
              landmark: newLandmark,
              // last_used_at TIDAK diubah (invarian)
            },
          });

          const prefs = (c.preferences as any) || {};
          const saved = parseSavedAddresses(prefs);
          const nextSaved = saved.map((s: any) =>
            s.id === card.id
              ? {
                  ...s,
                  locationSource: 'gps_pin',
                  address: newAddress || s.address || '',
                  landmark: newLandmark ?? s.landmark ?? null,
                }
              : s
          );
          const normalized = ensureSinglePrimary(nextSaved);
          const { location_source_label: _drop, ...restPrefs } = prefs;
          await tx.customer.update({
            where: { id: c.id },
            data: {
              location_source: 'gps_pin',
              preferences: {
                ...restPrefs,
                location_source: 'gps_pin',
                saved_addresses: normalized,
                saved_addresses_updated_at: new Date().toISOString(),
              },
            },
          });

          await tx.auditLog.create({
            data: {
              tenant_id: c.tenant_id,
              admin_key: 'SYSTEM',
              admin_identity: 'heal-single-card-provenance',
              action: 'HEAL_SINGLE_CARD_PROVENANCE',
              target_id: c.id,
              payload: JSON.stringify({ cardId: card.id, distanceM: d, before, after, waPin: wa ? { address: wa.address, name: wa.name } : null }),
              ip_address: 'script',
            },
          });
        });
      },
    });
  }

  for (const a of actions) {
    console.log(`[HEAL] ${a.detail}`);
    console.log('  before:', JSON.stringify(a.before));
    console.log('  after :', JSON.stringify(a.after));
  }

  let applied = 0;
  if (commit) {
    for (const a of actions) {
      try {
        await a.apply();
        applied++;
      } catch (e: any) {
        console.warn(`[HEAL] Gagal apply ${a.customerId}: ${e?.message}`);
      }
    }
    if (applied !== actions.length) process.exitCode = 1;
  }

  console.log(`[HEAL SINGLE-CARD PROVENANCE] scanned=${scanned} candidates=${actions.length} applied=${applied}${isDryRun ? ' (DRY-RUN: 0 tulis)' : ''}`);
  return { scanned, candidates: actions.length, applied, actions };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  await runHeal(opts);
}

const isMainScript = typeof process !== 'undefined' && process.argv[1] &&
  (process.argv[1].includes('heal-single-card-provenance') && !process.argv[1].includes('.test.'));

if (isMainScript) {
  main()
    .catch((e) => {
      console.error('[HEAL SINGLE-CARD PROVENANCE ERROR]', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect().catch(() => {});
    });
}
