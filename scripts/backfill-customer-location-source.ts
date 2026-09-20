import { prisma } from '../src/db/client';

async function main() {
  const all = await prisma.customer.findMany({
    where: { lat: { not: null }, lng: { not: null } },
    select: { id: true, location_source: true, preferences: true },
  });
  let manual = 0, estimated = 0, gps = 0, skipped = 0;
  for (const c of all) {
    if (c.location_source) { skipped++; continue; }
    const prefs: any = (c as any).preferences || {};
    let src: 'manual_staff' | 'estimated_area' | 'gps_pin' | null = null;
    if (prefs.location_updated_by_staff_name || prefs.location_updated_by_staff_id || prefs.field_gps_lat) src = 'manual_staff';
    else if (prefs.source === 'geocoding' || prefs.location_source === 'geocoding') src = 'estimated_area';
    else src = 'gps_pin';
    await prisma.customer.update({ where: { id: c.id }, data: { location_source: src as any } });
    if (src === 'manual_staff') manual++;
    else if (src === 'estimated_area') estimated++;
    else gps++;
  }
  console.log(`Backfill done: manual_staff=${manual}, estimated_area=${estimated}, gps_pin=${gps}, skipped(already set)=${skipped}, total berkoordinat=${all.length}`);

  // Sanitasi kota kotor (idempotent)
  const fixes: Array<{ id: string; kota: string; kecamatan: string; kelurahan?: string }> = [
    { id: 'aca1875d-4f10-4879-bee1-ba353ff87b9a', kota: 'Surabaya', kecamatan: 'Mulyorejo' },
    { id: '3159f0fb-6a73-402c-9dcf-881e31974a40', kota: 'Sidoarjo', kecamatan: 'Waru', kelurahan: 'Tambak Oso' },
    { id: '97cae799-7786-41a7-914f-fcc65d2dbc0d', kota: 'Surabaya', kecamatan: 'Sukolilo', kelurahan: 'Keputih' },
    { id: '73ffc48b-1422-4cc8-b4c8-e790fadd4a65', kota: 'Sidoarjo', kecamatan: 'Waru' },
  ];
  for (const f of fixes) {
    await prisma.customer.update({
      where: { id: f.id },
      data: { kota: f.kota, kecamatan: f.kecamatan, ...(f.kelurahan ? { kelurahan: f.kelurahan } : {}) },
    });
    console.log(`Sanitized ${f.id} -> ${f.kota}/${f.kecamatan}/${f.kelurahan || '-'}`);
  }
  const dirty = await prisma.customer.count({
    where: { OR: [{ kota: { contains: 'No. Hp', mode: 'insensitive' } }, { kecamatan: { contains: 'Kota :', mode: 'insensitive' } }] },
  });
  console.log(`Dirty remaining: ${dirty}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
