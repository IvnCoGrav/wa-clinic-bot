/**
 * sanitize-customer-names-and-kelurahan.ts — Pembersihan data master (idempoten).
 * Fase 5 plan integritas penamaan Google Contacts & Database.
 *
 * 3 aturan (semua HANYA melengkapi kolom kosong — tidak menimpa data existing):
 *  1. kelurahan tercemar (URL maps / alamat jalan / >40 char) → pindah ke
 *     preferences.address bila kosong, lalu kelurahan = null.
 *  2. Nama bersuffix wilayah ("Bunda Retno Gedangan") → nama bersih +
 *     kecamatan bila kosong (else kelurahan bila kosong, else skip).
 *  3. Nama komposit impor ("Pelanggan 8247 - Manukan Kulon") → belah +
 *     klasifikasi gazetteer, isi kolom kosong saja.
 *
 * Aman: --dry-run default (tanpa tulis). Tulis HANYA dengan --apply.
 * Usage:
 *   npx tsx src/scripts/sanitize-customer-names-and-kelurahan.ts --dry-run [--tenant=ID] [--limit=N]
 *   npx tsx src/scripts/sanitize-customer-names-and-kelurahan.ts --apply [--tenant=ID] [--limit=N]
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { COMMON_DISTRICTS } from '../utils/name-sanitizer';
import {
  isCorruptedKelurahan,
  stripTrailingDistrict,
  toTitleCase,
} from '../utils/customer-name-healing';
import { splitImportedContactName } from '../services/google-contacts-formatter';
import { classifyImportedAreaTag } from '../services/google-contacts.service';

const APPLY = process.argv.includes('--apply');
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const TENANT = tenantArg ? tenantArg.split('=')[1] : DEFAULT_TENANT_ID;
const LIMIT = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 500) : 500;

async function main() {
  console.log(`[SANITIZE] Mode: ${APPLY ? 'APPLY (tulis DB)' : 'DRY-RUN (tanpa tulis)'} | tenant=${TENANT} | limit=${LIMIT}`);

  const rows = await prisma.customer.findMany({
    where: { tenant_id: TENANT },
    select: { id: true, name: true, kelurahan: true, kecamatan: true, preferences: true },
    take: LIMIT,
  });

  let fixKelurahan = 0;
  let fixSuffix = 0;
  let fixComposite = 0;
  let skipped = 0;
  const samples: string[] = [];

  for (const r of rows) {
    const patch: any = {};
    const reasons: string[] = [];

    // Aturan 1: kelurahan tercemar → preferences.address + null
    if (isCorruptedKelurahan(r.kelurahan)) {
      const prefs = ((r.preferences as any) || {});
      if (!prefs.address) {
        patch.preferences = { ...prefs, address: (r.kelurahan || '').trim() };
      }
      patch.kelurahan = null;
      reasons.push(`kelurahan tercemar → address + null`);
      fixKelurahan++;
    }

    const name = (r.name || '').trim();

    // Aturan 3 dulu (komposit punya delimiter eksplisit, lebih spesifik)
    if (name.includes(' - ')) {
      const { cleanName, areaTag } = splitImportedContactName(name);
      const area = classifyImportedAreaTag(areaTag);
      let touched = false;
      const finalName = cleanName || name;
      if (area.kelurahan && !r.kelurahan && !patch.kelurahan) {
        patch.kelurahan = area.kelurahan;
        touched = true;
      }
      if (area.kecamatan && !r.kecamatan) {
        patch.kecamatan = area.kecamatan;
        touched = true;
      }
      if (touched && finalName !== name) {
        patch.name = finalName;
        reasons.push(`komposit → "${finalName}" + wilayah`);
        fixComposite++;
      } else if (touched) {
        reasons.push('komposit → wilayah dilengkapi');
        fixComposite++;
      } else {
        skipped++;
        continue;
      }
    } else if (name) {
      // Aturan 2: suffix wilayah di akhir nama
      const { cleanName, district } = stripTrailingDistrict(name, COMMON_DISTRICTS);
      if (district && cleanName && cleanName !== name) {
        const proper = toTitleCase(district);
        if (!r.kecamatan) {
          patch.name = cleanName;
          patch.kecamatan = proper;
          reasons.push(`suffix → "${cleanName}" + kec ${proper}`);
          fixSuffix++;
        } else if (!r.kelurahan && !patch.kelurahan) {
          patch.name = cleanName;
          patch.kelurahan = proper;
          reasons.push(`suffix → "${cleanName}" + kel ${proper}`);
          fixSuffix++;
        } else {
          skipped++;
          continue;
        }
      } else if (Object.keys(patch).length === 0) {
        skipped++;
        continue;
      }
    } else if (Object.keys(patch).length === 0) {
      skipped++;
      continue;
    }

    if (Object.keys(patch).length === 0) {
      skipped++;
      continue;
    }

    if (samples.length < 10) samples.push(`${r.id} :: ${name} → ${JSON.stringify(patch)} (${reasons.join('; ')})`);
    if (APPLY) {
      await prisma.customer.update({ where: { id: r.id }, data: patch });
    }
  }

  console.log(`[SANITIZE] Hasil: kelurahan=${fixKelurahan} suffix=${fixSuffix} komposit=${fixComposite} dilewati=${skipped} diperiksa=${rows.length}`);
  for (const s of samples) console.log(`  • ${s}`);
  if (!APPLY) console.log('[SANITIZE] DRY-RUN selesai — tanpa perubahan. Ulangi dengan --apply untuk eksekusi.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[SANITIZE] Gagal:', e?.message);
    process.exit(1);
  });
