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
import { getGazetteerCoordinates, isCrossCityDuplicate, haversineKm } from '../utils/gazetteer';
import { sanitizeCustomerNameForGreeting } from '../utils/name-sanitizer';
import { classifyLocationDrift, type ResolvedLocation } from '../utils/location-drift';
import { STAFF_VERIFIED_LOCATION_LABEL } from '../services/staff-reservation.service';

const isCommit = process.argv.includes('--commit');
const isDryRun = !isCommit;
const isSyncStaffLabels = process.argv.includes('--sync-staff-labels');
const isAuditHomonym = process.argv.includes('--audit-homonym');
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

async function runSyncStaffLabels() {
  console.log(`\n======================================================`);
  console.log(`[SYNC STAFF LABELS] Mode: ${isDryRun ? 'DRY-RUN (READ-ONLY)' : 'COMMIT (MENULIS KE DB)'}`);
  console.log(`[SYNC STAFF LABELS] Tenant: ${tenantId} | limit=${limit}`);
  console.log(`======================================================\n`);

  const staffRows = await prisma.customer.findMany({
    where: {
      tenant_id: tenantId,
      deleted_at: null,
      location_source: 'manual_staff',
    },
    select: {
      id: true,
      phone: true,
      name: true,
      location_source: true,
      preferences: true,
    },
    take: limit,
  });

  const desynced = staffRows.filter((c) => {
    const prefs = (c.preferences as any) || {};
    return prefs.location_source !== 'manual_staff' || prefs.location_source_label !== STAFF_VERIFIED_LOCATION_LABEL;
  });

  console.log(`Ditemukan ${staffRows.length} customer manual_staff. ${desynced.length} baris metadata preferences belum tersinkronisasi.`);

  let synced = 0;
  let failed = 0;
  const summary: Array<Record<string, unknown>> = [];

  for (const c of desynced) {
    const currentPrefs = (c.preferences as any) || {};
    const updatedPrefs = {
      ...currentPrefs,
      location_source: 'manual_staff',
      location_source_label: STAFF_VERIFIED_LOCATION_LABEL,
    };

    console.log(`[DESYNC] ${c.name || 'No Name'} (${c.phone}) - Prefs lama: source=${currentPrefs.location_source || 'null'}, label=${currentPrefs.location_source_label || 'null'}`);

    if (isDryRun) {
      summary.push({
        id: c.id,
        phone: c.phone,
        name: c.name,
        old_location_source: currentPrefs.location_source || null,
        new_location_source: 'manual_staff',
        new_location_source_label: STAFF_VERIFIED_LOCATION_LABEL,
      });
      continue;
    }

    try {
      await prisma.customer.update({
        where: { id: c.id },
        data: { preferences: updatedPrefs },
      });
      synced++;
      console.log(`  [SYNCED] preferences.location_source & location_source_label diperbarui.`);
    } catch (err: any) {
      failed++;
      console.error(`  [FAILED] ${err.message}`);
    }
  }

  console.log(`\n======================================================`);
  console.log(`[RINGKASAN SYNC STAFF] Total Desync: ${desynced.length} | Berhasil Sync: ${synced} | Gagal: ${failed}`);
  if (isDryRun) {
    console.log(`\n[DRY-RUN] Tidak ada data diubah. Jalankan ulang dengan --commit untuk menerapkan pembaruan.`);
  }
  console.log(`======================================================\n`);
}

async function runAuditHomonym() {
  console.log(`\n======================================================`);
  console.log(`[AUDIT CROSS-CITY HOMONYM] (READ-ONLY)`);
  console.log(`[AUDIT CROSS-CITY HOMONYM] Tenant: ${tenantId} | Ambang Drift: 3.0 km`);
  console.log(`======================================================\n`);

  const rows = await prisma.customer.findMany({
    where: {
      tenant_id: tenantId,
      deleted_at: null,
      lat: { not: null },
      lng: { not: null },
    },
    select: {
      id: true,
      phone: true,
      name: true,
      kelurahan: true,
      kecamatan: true,
      kota: true,
      lat: true,
      lng: true,
      location_source: true,
      preferences: true,
    },
    take: limit,
  });

  const duplicateCandidates = rows.filter((c) => {
    const kel = (c.kelurahan || '').trim().toLowerCase();
    const kec = (c.kecamatan || '').trim().toLowerCase();
    return (kel && isCrossCityDuplicate(kel)) || (kec && isCrossCityDuplicate(kec));
  });

  console.log(`Memeriksa ${rows.length} customer dengan koordinat... Ditemukan ${duplicateCandidates.length} customer dengan nama wilayah duplikat lintas kota.`);

  let driftedCount = 0;
  const auditReport: Array<Record<string, unknown>> = [];

  for (const c of duplicateCandidates) {
    const kel = (c.kelurahan || '').trim();
    const kec = (c.kecamatan || '').trim();
    const kota = (c.kota || '').trim();
    const queryWithCity = [kel, kec, kota].filter(Boolean).join(', ');
    const hitWithCity = getGazetteerCoordinates(queryWithCity);

    if (hitWithCity && c.lat != null && c.lng != null) {
      const driftKm = haversineKm(c.lat, c.lng, hitWithCity.lat, hitWithCity.lng);
      if (driftKm > 3.0) {
        driftedCount++;
        const item = {
          id: c.id,
          phone: c.phone,
          name: c.name,
          wilayah_tercatat: `${kel ? kel + ', ' : ''}${kec ? kec + ', ' : ''}${kota}`,
          current_coords: `${c.lat}, ${c.lng}`,
          expected_centroid: `${hitWithCity.lat}, ${hitWithCity.lng} (${hitWithCity.kelurahan || ''}, ${hitWithCity.kecamatan}, ${hitWithCity.kota})`,
          drift_km: Math.round(driftKm * 100) / 100,
          location_source: c.location_source,
        };
        auditReport.push(item);
        console.log(`[DRIFT > 3KM] ${c.name || 'No Name'} (${c.phone}) | Drift: ${item.drift_km} km`);
        console.log(`  Tercatat: ${item.wilayah_tercatat}`);
        console.log(`  Titik DB: ${item.current_coords} vs Centroid Wilayah: ${item.expected_centroid}`);
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`[HASIL AUDIT] Kandidat Duplikat: ${duplicateCandidates.length} | Terdeteksi Drift > 3 km: ${driftedCount}`);
  if (auditReport.length > 0) {
    console.log(`\nDaftar customer terdampak (rekomendasi: review via geocode-text-wilayah-drift atau admin refresh):`);
    console.log(JSON.stringify(auditReport, null, 2));
  } else {
    console.log(`Tidak ada customer di wilayah duplikat lintas kota yang menyimpang > 3 km.`);
  }
  console.log(`======================================================\n`);
}

async function main() {
  if (isSyncStaffLabels) {
    await runSyncStaffLabels();
    return;
  }
  if (isAuditHomonym) {
    await runAuditHomonym();
    return;
  }

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
