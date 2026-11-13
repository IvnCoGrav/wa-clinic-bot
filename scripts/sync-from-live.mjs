#!/usr/bin/env node
/**
 * Sinkronisasi katalog & identitas publik dari server live ke database lokal.
 *
 * Sumber: `GET {LIVE_BASE}/api/pricelist` (data publik, hanya baca).
 * Default: DRY RUN. Tambahkan `--apply` untuk menulis ke database.
 *
 * Yang disinkronkan otomatis (tidak ambigu):
 *  - harga per varian usia (promo & harga asli)
 *  - status aktif: baris yang tidak ada di live dinonaktifkan (tidak dihapus)
 *  - tarif ongkir
 *  - nomor WhatsApp tenant
 *  - logo brand (settings.brand.logoUrl)
 *
 * Yang hanya DILAPORKAN (tidak ditulis otomatis): nama & deskripsi layanan.
 * Alasannya, payload live berisi nama tampil yang sudah dipotong prefiks brand
 * dan kata kategori, jadi memetakannya kembali ke kolom `name` akan menebak.
 *
 * Pemakaian:
 *   npm run sync:from-live           # lihat rencana
 *   npm run sync:from-live -- --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const LIVE_BASE = process.env.LIVE_BASE || 'https://app.kalababyspa.online';
const APPLY = process.argv.includes('--apply');
const TENANT = process.env.SYNC_TENANT_ID || 'default-tenant';
const prisma = new PrismaClient();

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(process.env.TEMP || process.env.TMP || '.', 'opencode');
fs.mkdirSync(backupDir, { recursive: true });

function log(...args) {
  console.log(...args);
}

async function fetchLive() {
  const res = await fetch(`${LIVE_BASE}/api/pricelist`);
  if (!res.ok) throw new Error(`live mengembalikan HTTP ${res.status}`);
  const body = await res.json();
  return body.data ?? body;
}

function buildPlan(rows, live) {
  const items = (live.sections || []).flatMap((s) => s.items || []);
  const byId = new Map(rows.map((r) => [r.service_id, r]));
  const claimed = new Set();
  const priceUpdates = [];
  const labelReport = [];

  const consider = (row, variant) => {
    const [label, promo, original] = variant;
    claimed.add(row.service_id);
    if (row.promo_price !== promo || row.original_price !== original) {
      priceUpdates.push({
        service_id: row.service_id,
        from: `${row.promo_price}/${row.original_price}`,
        to: `${promo}/${original}`,
        promo,
        original,
      });
    }
    if (row.age_label && label && row.age_label !== label) {
      labelReport.push(`${row.service_id}: label "${row.age_label}" (live "${label}")`);
    }
  };

  for (const item of items) {
    const variants = item.v || [];
    const direct = byId.get(item.id);
    if (direct && variants.length === 1) {
      consider(direct, variants[0]);
      continue;
    }
    const base = item.id.replace(/-\d+-\d+(th|bulan|m)$/i, '').replace(/-newborn$/i, '');
    for (const variant of variants) {
      const candidate = rows.find(
        (r) =>
          !claimed.has(r.service_id) &&
          r.age_label === variant[0] &&
          (r.service_id === item.id || r.service_id.startsWith(base + '-') || r.service_id === base)
      );
      if (candidate) consider(candidate, variant);
    }
  }

  const deactivate = rows.filter((r) => r.is_active && !claimed.has(r.service_id));
  return { priceUpdates, deactivate, labelReport, itemCount: items.length };
}

async function main() {
  log(`sumber live : ${LIVE_BASE}${APPLY ? '' : '   (DRY RUN — tambahkan --apply untuk menulis)'}`);

  const live = await fetchLive();
  const rows = await prisma.clinicService.findMany({ where: { tenant_id: TENANT } });
  const plan = buildPlan(rows, live);

  log(`tenant      : ${TENANT}`);
  log(`item live   : ${plan.itemCount} | baris lokal: ${rows.length}`);
  log(`\n[harga] ${plan.priceUpdates.length} perubahan`);
  for (const p of plan.priceUpdates) log(`  ${p.service_id}: ${p.from} -> ${p.to}`);

  log(`\n[aktif] ${plan.deactivate.length} baris akan dinonaktifkan (tidak dihapus)`);
  for (const d of plan.deactivate) log(`  ${d.service_id} | ${d.name}`);

  const tenant = await prisma.tenant.findUnique({
    where: { id: TENANT },
    select: { whatsapp_number: true, settings: true },
  });
  const waBefore = tenant?.whatsapp_number || '';
  const waAfter = String(live.whatsapp_number || '');
  log(`\n[whatsapp] ${waBefore || '(kosong)'} -> ${waAfter || '(kosong)'}`);

  const settings = (tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {}) || {};
  const brand = (settings.brand && typeof settings.brand === 'object' ? settings.brand : {}) || {};
  const logoAfter = live.brand?.logoUrl || '';
  log(`[logo] ${brand.logoUrl || '(kosong)'} -> ${logoAfter || '(kosong)'}`);

  const localTiers = await prisma.deliveryTier.findMany({
    where: { tenant_id: TENANT },
    orderBy: { max_dist: 'asc' },
  });
  const liveTiers = live.deliveryTiers || [];
  // Bentuk lokal memakai kolom snake_case, payload live memakai camelCase.
  const tierSignature = (maxDist, fee, promo) => `${Number(maxDist)}:${Number(fee)}:${Number(promo || 0)}`;
  const localSig = localTiers
    .map((t) => tierSignature(t.max_dist, t.fee, t.promo_discount))
    .join('|');
  const liveSig = liveTiers.map((t) => tierSignature(t.maxDist, t.fee, t.promoDiscount)).join('|');
  log(`\n[ongkir] ${localSig === liveSig ? 'sama' : 'BEDA'}`);
  if (localSig !== liveSig) {
    log(`  lokal: ${localSig}`);
    log(`  live : ${liveSig}`);
  }

  if (plan.labelReport.length) {
    log(`\n[label usia, hanya laporan] ${plan.labelReport.length}`);
    for (const l of plan.labelReport.slice(0, 10)) log('  ' + l);
  }

  if (!APPLY) {
    log('\nTidak ada yang ditulis. Jalankan dengan --apply untuk menerapkan.');
    return;
  }

  // Backup sebelum menulis.
  const servicesBackup = path.join(backupDir, `sync-clinic-services-${stamp}.json`);
  const settingsBackup = path.join(backupDir, `sync-tenant-settings-${stamp}.json`);
  fs.writeFileSync(servicesBackup, JSON.stringify(rows, null, 2), 'utf8');
  fs.writeFileSync(settingsBackup, JSON.stringify(tenant?.settings ?? null, null, 2), 'utf8');
  log(`\nbackup: ${servicesBackup}`);
  log(`backup: ${settingsBackup}`);

  let wrote = 0;
  for (const p of plan.priceUpdates) {
    const r = await prisma.clinicService.updateMany({
      where: { tenant_id: TENANT, service_id: p.service_id },
      data: { promo_price: p.promo, original_price: p.original },
    });
    wrote += r.count;
  }
  for (const d of plan.deactivate) {
    const r = await prisma.clinicService.updateMany({
      where: { tenant_id: TENANT, service_id: d.service_id },
      data: { is_active: false },
    });
    wrote += r.count;
  }
  if (waAfter && waAfter !== waBefore) {
    await prisma.tenant.update({ where: { id: TENANT }, data: { whatsapp_number: waAfter } });
  }
  if (logoAfter && logoAfter !== brand.logoUrl) {
    const next = { ...settings, brand: { ...brand, logoUrl: logoAfter } };
    await prisma.tenant.update({ where: { id: TENANT }, data: { settings: next } });
  }
  if (localSig !== liveSig && liveTiers.length) {
    await prisma.deliveryTier.deleteMany({ where: { tenant_id: TENANT } });
    await prisma.deliveryTier.createMany({
      data: liveTiers.map((t, idx) => ({
        tenant_id: TENANT,
        max_dist: Number(t.maxDist),
        fee: Number(t.fee),
        promo_discount: Number(t.promoDiscount || 0),
        sort_order: idx + 1,
      })),
    });
  }

  log(`\nselesai: ${wrote} baris katalog diperbarui.`);
  log('Nama/deskripsi layanan tidak diubah otomatis — periksa laporan label di atas.');
}

main()
  .catch((e) => {
    console.error('GAGAL sync:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
