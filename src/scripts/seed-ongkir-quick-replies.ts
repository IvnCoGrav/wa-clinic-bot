/**
 * src/scripts/seed-ongkir-quick-replies.ts
 *
 * Skrip CLI idempoten untuk seeding 25 template quick reply ongkir (/o1 s/d /o25)
 * ke dalam tabel `quick_replies` di database PostgreSQL.
 *
 * Penggunaan:
 *   npx tsx src/scripts/seed-ongkir-quick-replies.ts
 *   npx tsx src/scripts/seed-ongkir-quick-replies.ts --commit
 *   npx tsx src/scripts/seed-ongkir-quick-replies.ts --tenant=default-tenant --commit
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { ONGKIR_QUICK_REPLIES } from '../routes/admin/quick-replies.subroute';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      options[key] = val !== undefined ? val : true;
    }
  }

  return {
    tenantId: (options.tenant as string) || DEFAULT_TENANT_ID,
    commit: Boolean(options.commit),
  };
}

async function main() {
  const params = parseArgs();
  console.log(`[SEED ONGKIR QR] Target Tenant: ${params.tenantId}`);
  console.log(`[SEED ONGKIR QR] Mode: ${params.commit ? 'COMMIT (Write to DB)' : 'DRY RUN (No changes)'}`);
  console.log(`[SEED ONGKIR QR] Total Quick Replies: ${ONGKIR_QUICK_REPLIES.length} template (/o1 s/d /o25)`);

  let countSuccess = 0;
  for (const item of ONGKIR_QUICK_REPLIES) {
    console.log(`  - /${item.shortcut}: ${item.title}`);
    if (params.commit) {
      await (prisma as any).quickReply.upsert({
        where: {
          tenant_id_shortcut: {
            tenant_id: params.tenantId,
            shortcut: item.shortcut,
          },
        },
        update: {
          title: item.title,
          content: item.content,
          category: item.category,
          media_type: item.media_type,
          image_url: item.image_url,
        },
        create: {
          tenant_id: params.tenantId,
          shortcut: item.shortcut,
          title: item.title,
          content: item.content,
          category: item.category,
          media_type: item.media_type,
          image_url: item.image_url,
        },
      });
      countSuccess++;
    }
  }

  if (!params.commit) {
    console.log('\n[DRY RUN] Eksekusi dihentikan tanpa commit. Tambahkan --commit untuk menyimpan permanen.');
  } else {
    console.log(`\n[COMMIT BERHASIL] Berhasil meng-upsert ${countSuccess} quick reply ongkir untuk tenant '${params.tenantId}'.`);
  }

  try {
    await prisma.$disconnect();
  } catch {}
}

main().catch(async (e) => {
  console.error('[SEED ONGKIR QR] Error:', e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
