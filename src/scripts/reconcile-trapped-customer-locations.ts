/**
 * reconcile-trapped-customer-locations.ts
 *
 * Skrip rekonsiliasi IDEMPOTEN untuk pelanggan yang lokasinya "terjebak" pada
 * sentroid kecamatan (fallback hijack) atau titik koordinat non-darurat akibat
 * bug toponimi majemuk lama ("Tambak Os" -> Suko/Wedoro).
 *
 * Sifat:
 * - DEFAULT = DRY-RUN (read-only, TIDAK menulis apa pun).
 * - Hanya menulis dengan flag eksplisit `--commit`.
 * - TIDAK menyentuh pelanggan dengan `location_source='manual_staff'` (terkunci
 *   oleh staf — otoritas manusia di atas otomasi).
 * - Menghitung ulang jarak/ongkir via pipeline normalizer + DeliveryService
 *   (ORS bila tersedia, fallback Haversine deterministik).
 *
 * Usage:
 *   npx tsx src/scripts/reconcile-trapped-customer-locations.ts --dry-run
 *   npx tsx src/scripts/reconcile-trapped-customer-locations.ts --commit [--tenant=ID] [--limit=N]
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { customerService } from '../services/customer.service';
import { getGazetteerCoordinates } from '../utils/gazetteer';
import { sanitizeCustomerNameForGreeting } from '../utils/name-sanitizer';
import { classifyLocationDrift, type ResolvedLocation } from '../utils/location-drift';

const isCommit = process.argv.includes('--commit');
const isDryRun = !isCommit;
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const tenantId = tenantArg ? tenantArg.split('=')[1]!.trim() : DEFAULT_TENANT_ID;
const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 1000) : 1000;

function getReferenceText(cust: any): string | null {
  const prefs = (cust.preferences as any) || {};
  const address = typeof prefs.address === 'string' ? prefs.address.trim() : '';
  if (address) return address;
  const name = (cust.name || '').trim();
  return name || null;
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`[RECONCILE TRAPPED LOCATIONS] Mode: ${isDryRun ? 'DRY-RUN (READ-ONLY)' : 'COMMIT (MENULIS KE DB)'}`);
  console.log(`[RECONCILE TRAPPED LOCATIONS] Tenant: ${tenantId} | limit=${limit}`);
  console.log(`======================================================\n`);

  const rows = await prisma.customer.findMany({
    where: { tenant_id: tenantId, deleted_at: null },
    select: {
      id: true, phone: true, name: true, kelurahan: true, kecamatan: true, kota: true,
      lat: true, lng: true, distance_km: true, ongkir: true, location_source: true, preferences: true,
    },
    take: limit,
  });

  let candidates = 0;
  let reconciled = 0;
  let failed = 0;
  let skippedLocked = 0;
  const summary: Array<Record<string, unknown>> = [];

  for (const c of rows) {
    const referenceText = getReferenceText(c);
    let resolved: ResolvedLocation | null = null;
    if (referenceText) {
      const hit = getGazetteerCoordinates(referenceText);
      if (hit) {
        resolved = { kelurahan: hit.kelurahan, kecamatan: hit.kecamatan, lat: hit.lat, lng: hit.lng };
      }
    }

    const decision = classifyLocationDrift(
      {
        kelurahan: c.kelurahan, kecamatan: c.kecamatan, lat: c.lat, lng: c.lng,
        location_source: c.location_source, preferences: c.preferences,
      },
      resolved,
      referenceText
    );

    if (decision.reason === 'locked_manual_staff') { skippedLocked++; continue; }
    if (!decision.shouldReconcile) continue;

    candidates++;
    const cleanName = sanitizeCustomerNameForGreeting(c.name);
    const nameChanged = cleanName !== (c.name || '').trim() && cleanName !== '';

    console.log(`\n[${decision.reason}] ${c.name} (${c.phone})`);
    console.log(`  kelurahan: ${c.kelurahan || '-'} -> ${resolved?.kelurahan || '-'} (drift ${decision.driftKm?.toFixed(2) ?? '?'} km)`);
    if (nameChanged) console.log(`  nama: "${c.name}" -> "${cleanName}"`);

    if (isDryRun) {
      summary.push({
        id: c.id, phone: c.phone, reason: decision.reason,
        kelurahan_from: c.kelurahan, kelurahan_to: resolved?.kelurahan,
        driftKm: decision.driftKm, name_from: c.name, name_to: nameChanged ? cleanName : null,
      });
      continue;
    }

    try {
      const res = await customerService.refreshCustomerLocationAndOngkir(c.id, tenantId, 'system_reconciliation');
      if (res.success && res.data) {
        if (nameChanged) {
          await prisma.customer.update({ where: { id: c.id }, data: { name: cleanName } });
        }
        reconciled++;
        console.log(`  [UPDATED] Kel=${res.data.kelurahan} | ${res.data.distanceKm} km | Rp ${res.data.ongkir}`);
      } else {
        failed++;
        console.error(`  [FAILED] ${res.error || 'unknown'}`);
      }
    } catch (err: any) {
      failed++;
      console.error(`  [ERROR] ${err.message}`);
    }
  }

  console.log(`\n======================================================`);
  console.log(`[RINGKASAN] Kandidat: ${candidates} | Rekonsiliasi: ${reconciled} | Gagal: ${failed} | Terkunci (skip): ${skippedLocked}`);
  if (isDryRun) {
    console.log(`\n[DRY-RUN] Tidak ada perubahan ditulis. Jalankan ulang dengan --commit setelah tinjau ringkasan.`);
    console.log(JSON.stringify(summary, null, 2));
  }
  console.log(`======================================================\n`);
}

main()
  .catch((e) => { console.error('Fatal reconcile error:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect().catch(() => {}); });
