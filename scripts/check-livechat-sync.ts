import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

/**
 * Skrip Diagnostik Drift Riwayat LiveChat (Fase C v3) — READ-ONLY, tanpa tulisan.
 *
 * Memeriksa, per tenant:
 *  1. Drift `conversations.last_message_at` vs MAX(messages.created_at)
 *     (di luar toleransi 1 detik; NULL + ada pesan = drift).
 *  2. Pesan tanpa `wa_message_id` per arah (INBOUND/OUTBOUND).
 *  3. Percakapan phantom (tanpa pesan riil).
 *
 * Penggunaan:
 *   npx tsx scripts/check-livechat-sync.ts [--tenant=<id>]
 *
 * Exit code: 0 = sehat, 1 = drift/anomali ditemukan, 2 = DB offline/error.
 */

const TOLERANCE_MS = 1000;

function parseArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() || fallback : fallback;
}

async function main() {
  const tenantId = parseArg('tenant', process.env.DEFAULT_TENANT_ID || DEFAULT_TENANT_ID);
  console.log(`🔍 [LIVECHAT SYNC CHECK] Tenant: ${tenantId} (read-only)`);

  let conversations: Array<{ id: string; last_message_at: Date | null }>;
  let latestByConv: Array<{ conversation_id: string; _max: { created_at: Date | null } }>;
  let missingWaId: Array<{ direction: string; _count: { id: number } }>;
  let totalMessages = 0;
  try {
    conversations = await prisma.conversation.findMany({
      where: { tenant_id: tenantId },
      select: { id: true, last_message_at: true },
    });
    // groupBy di-cast ke any mengikuti pola live-chat.service.ts (typing
    // generated client untuk agregasi tidak stabil di versi Prisma ini).
    latestByConv = await (prisma.message as any).groupBy({
      by: ['conversation_id'],
      where: { tenant_id: tenantId },
      _max: { created_at: true },
    });
    missingWaId = (await (prisma.message as any).groupBy({
      by: ['direction'],
      where: { tenant_id: tenantId, wa_message_id: null },
      _count: { id: true },
    })) as any;
    totalMessages = await prisma.message.count({ where: { tenant_id: tenantId } });
  } catch (err: any) {
    console.error(`❌ [LIVECHAT SYNC CHECK] Database offline/tidak terjangkau: ${err?.message || err}`);
    process.exit(2);
  }

  const latestMap = new Map<string, Date>();
  for (const row of latestByConv) {
    if (row._max.created_at) latestMap.set(row.conversation_id, new Date(row._max.created_at));
  }

  let drifts = 0;
  let phantoms = 0;
  const driftSample: Array<{ conversationId: string; lastMessageAt: string | null; latestMessage: string }> = [];
  for (const conv of conversations) {
    const latest = latestMap.get(conv.id);
    if (!latest) {
      phantoms++;
      continue;
    }
    const base = conv.last_message_at ? new Date(conv.last_message_at).getTime() : NaN;
    if (Number.isNaN(base) || Math.abs(base - latest.getTime()) > TOLERANCE_MS) {
      drifts++;
      if (driftSample.length < 10) {
        driftSample.push({
          conversationId: conv.id,
          lastMessageAt: conv.last_message_at ? new Date(conv.last_message_at).toISOString() : null,
          latestMessage: latest.toISOString(),
        });
      }
    }
  }

  let missingTotal = 0;
  let missingInbound = 0;
  let missingOutbound = 0;
  for (const row of missingWaId) {
    const n = row._count.id;
    missingTotal += n;
    if (row.direction === 'INBOUND') missingInbound += n;
    else if (row.direction === 'OUTBOUND') missingOutbound += n;
  }

  console.log('——————————————————————————————————————————');
  console.log(`📊 Percakapan           : ${conversations.length}`);
  console.log(`📊 Pesan total          : ${totalMessages}`);
  console.log(`⚠️  Drift last_message_at : ${drifts}`);
  console.log(`👻 Phantom (tanpa pesan) : ${phantoms}`);
  console.log(`🆔 Tanpa wa_message_id   : total=${missingTotal} (INBOUND=${missingInbound}, OUTBOUND=${missingOutbound})`);
  if (driftSample.length > 0) {
    console.log('🧾 Contoh drift (maks 10):');
    for (const d of driftSample) {
      console.log(`   - ${d.conversationId} last_message_at=${d.lastMessageAt} latest=${d.latestMessage}`);
    }
    console.log('💡 Perbaiki dengan: npx tsx scripts/repair-last-message-at.ts --apply');
  } else {
    console.log('✅ Tidak ada drift last_message_at di luar toleransi 1 detik.');
  }
  console.log('——————————————————————————————————————————');

  const unhealthy = drifts > 0;
  process.exit(unhealthy ? 1 : 0);
}

main()
  .catch((e) => {
    console.error('Error check-livechat-sync:', e);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
