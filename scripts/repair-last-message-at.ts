import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

/**
 * Skrip Perbaikan Drift `last_message_at` (Fase C v3) — IDEMPOTEN.
 *
 * Menyelaraskan `conversations.last_message_at` ke MAX(messages.created_at)
 * per percakapan dalam SATU statement SQL transaksional (bukan loop per-row).
 * Menjalankan ulang tanpa perubahan = 0 baris tersentuh (aman diulang).
 *
 * Penggunaan:
 *   npx tsx scripts/repair-last-message-at.ts [--tenant=<id>] [--apply]
 * Tanpa --apply = dry-run (hanya hitung & tampilkan kandidat, tanpa tulisan).
 *
 * Exit code: 0 = sukses/sehat, 1 = drift tersisa (dry-run) atau gagal apply, 2 = DB offline/error.
 */

function parseArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() || fallback : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function countDrift(tenantId: string): Promise<number> {
  const rows = (await prisma.$queryRaw`
    SELECT COUNT(*) AS count
    FROM conversations c
    JOIN (
      SELECT conversation_id, MAX(created_at) AS latest
      FROM messages
      GROUP BY conversation_id
    ) sub ON sub.conversation_id = c.id
    WHERE c.tenant_id = ${tenantId}
      AND (c.last_message_at IS NULL OR c.last_message_at != sub.latest)
  `) as Array<{ count: bigint }>;
  return Number(rows?.[0]?.count ?? 0);
}

async function main() {
  const tenantId = parseArg('tenant', process.env.DEFAULT_TENANT_ID || DEFAULT_TENANT_ID);
  const apply = hasFlag('apply');

  let before = 0;
  try {
    before = await countDrift(tenantId);
  } catch (err: any) {
    console.error(`❌ [REPAIR LAST-MESSAGE-AT] Database offline/tidak terjangkau: ${err?.message || err}`);
    process.exit(2);
  }

  console.log(`🛠️  [REPAIR LAST-MESSAGE-AT] Tenant: ${tenantId} | drift: ${before} percakapan`);

  if (!apply) {
    console.log('ℹ️  Mode dry-run (read-only). Tambahkan --apply untuk mengeksekusi perbaikan idempoten.');
    process.exit(before > 0 ? 1 : 0);
  }

  if (before === 0) {
    console.log('✅ Tidak ada drift — tidak ada baris yang diubah (idempoten).');
    process.exit(0);
  }

  try {
    const affected = await prisma.$executeRaw`
      UPDATE conversations c
      SET last_message_at = sub.latest_created
      FROM (
        SELECT conversation_id, MAX(created_at) AS latest_created
        FROM messages
        GROUP BY conversation_id
      ) sub
      WHERE c.id = sub.conversation_id
        AND c.tenant_id = ${tenantId}
        AND (c.last_message_at IS NULL OR c.last_message_at != sub.latest_created)
    `;
    const after = await countDrift(tenantId);
    console.log(`✅ UPDATE selesai: ${affected} baris tersentuh, drift tersisa: ${after}.`);
    process.exit(after > 0 ? 1 : 0);
  } catch (err: any) {
    console.error(`❌ [REPAIR LAST-MESSAGE-AT] Gagal apply: ${err?.message || err}`);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error('Error repair-last-message-at:', e);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
