/**
 * sync-few-shot-defaults.ts — sinkronisasi teks default exemplar ke DB (idempoten).
 * Fase B batch kecerdasan: DEFAULT_FEW_SHOT_EXEMPLARS hanya ter-seed saat tabel
 * kosong, sehingga edit kode tidak menyentuh baris live. Skrip ini memutakhirkan
 * HANYA baris yang teksnya masih sama persis dengan default lama (belum dikustom
 * admin); baris kustom di-skip dan dilaporkan.
 *
 * Aman: --dry-run default (tanpa tulis). Tulis HANYA dengan --apply.
 * Usage:
 *   npx tsx scripts/sync-few-shot-defaults.ts --dry-run [--tenant=ID]
 *   npx tsx scripts/sync-few-shot-defaults.ts --apply [--tenant=ID]
 */
import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

const APPLY = process.argv.includes('--apply');
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const TENANT = tenantArg ? tenantArg.split('=')[1] : DEFAULT_TENANT_ID;

// Kunci pencocokan: scenario (stabil) + teks lama (bukti belum dikustom admin).
const SYNC_TARGETS: Array<{
  scenario: string;
  oldIdealResponse: string;
  newIdealResponse: string;
  oldTag: string;
  newTag: string;
}> = [
  {
    scenario: 'Pasien berkonsultasi keluhan batuk / pilek / flu / grok-grok pada bayi',
    oldIdealResponse:
      'Iya Bunda, untuk membantu melegakan pernapasan dan ketidaknyamanan si kecil, kami ada layanan *Pijat Bayi Pulih Ceria* yang dikombinasikan dengan teknik akupresur dan aromaterapi khusus flu/batuk pilek yaa 😊 Rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🤗',
    newIdealResponse:
      'Iya Bunda, untuk membantu melegakan pernapasan dan ketidaknyamanan si kecil, kami ada layanan *Pijat Bayi Pulih Ceria* yang dikombinasikan dengan teknik akupresur dan aromaterapi khusus flu/batuk pilek yaa 😊 Bunda tinggal di daerah/kelurahan mana? Biar kami cek jangkauan homecare ke lokasi Bunda 🤗',
    oldTag: 'closing_schedule_ask',
    newTag: 'closing_domicile_ask',
  },
  {
    scenario: 'Pasien menanyakan pijat laktasi / oksitosin untuk Ibu Menyusui',
    oldIdealResponse:
      'Benar sekali Bunda 😊 *Pijat Oksitosin* khusus untuk Bunda menyusui/nifas guna merangsang hormon oksitosin alami, membantu melancarkan aliran ASI, serta merilekskan otot punggung dan leher yang tegang. Rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🤗',
    newIdealResponse:
      'Benar sekali Bunda 😊 *Pijat Oksitosin* khusus untuk Bunda menyusui/nifas guna merangsang hormon oksitosin alami, membantu melancarkan aliran ASI, serta merilekskan otot punggung dan leher yang tegang. Bunda tinggal di daerah/kelurahan mana? Biar kami pastikan jangkauan homecare ke lokasi Bunda 😊',
    oldTag: 'closing_schedule_ask',
    newTag: 'closing_domicile_ask',
  },
];

async function main() {
  console.log(`[FEWSHOT-SYNC] Mode: ${APPLY ? 'APPLY (tulis DB)' : 'DRY-RUN (tanpa tulis)'} | tenant=${TENANT}`);
  let updated = 0;
  let skipped = 0;

  for (const t of SYNC_TARGETS) {
    const rows: any[] = await (prisma as any).fewShotExemplar.findMany({
      where: { tenant_id: TENANT, scenario: t.scenario },
    });
    if (rows.length === 0) {
      console.log(`  • "${t.scenario.slice(0, 40)}...": tidak ada baris (seed ulang via dashboard bila perlu)`);
      continue;
    }
    for (const r of rows) {
      const tags: string[] = Array.isArray(r.tags) ? r.tags : [];
      const untouched = r.ideal_response === t.oldIdealResponse && tags.includes(t.oldTag);
      if (!untouched) {
        console.log(`  • ${r.id}: SKIP (kustom admin / sudah baru)`);
        skipped++;
        continue;
      }
      const nextTags = tags.map((x) => (x === t.oldTag ? t.newTag : x));
      console.log(`  • ${r.id}: UPDATE ideal_response + tag ${t.oldTag}→${t.newTag}`);
      if (APPLY) {
        await (prisma as any).fewShotExemplar.update({
          where: { id: r.id },
          data: { ideal_response: t.newIdealResponse, tags: nextTags },
        });
      }
      updated++;
    }
  }

  console.log(`[FEWSHOT-SYNC] Hasil: update=${updated} skip=${skipped}`);
  if (!APPLY) console.log('[FEWSHOT-SYNC] DRY-RUN selesai — tanpa perubahan. Ulangi dengan --apply untuk eksekusi.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[FEWSHOT-SYNC] Gagal:', e?.message);
    process.exit(1);
  });
