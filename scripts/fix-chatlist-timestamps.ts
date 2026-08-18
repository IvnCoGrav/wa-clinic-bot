import { prisma } from '../src/db/client';

async function main() {
  console.log('🔄 [TIMESTAMP SYNC] Memulai sinkronisasi dan perbaikan timestamp chatlist...');

  // 1. Ambil seluruh data raw message dari LegacyStaging yang memiliki timestamp asli WhatsApp
  const stagings = await prisma.legacyStaging.findMany({
    select: {
      phoneNumber: true,
      rawMessagesJson: true,
    },
  });

  console.log(`📋 Memproses ${stagings.length} data staging dengan transkrip asli WhatsApp...`);

  // Bangun map wa_message_id -> real Date
  const msgDateMap = new Map<string, Date>();
  for (const s of stagings) {
    const list = (s.rawMessagesJson as any[]) || [];
    for (const m of list) {
      if (m.id && m.timestamp) {
        const d = new Date(m.timestamp);
        if (!isNaN(d.getTime())) {
          msgDateMap.set(m.id, d);
        }
      }
    }
  }

  console.log(`📦 Ditemukan ${msgDateMap.size} pesan ber-timestamp asli.`);

  // 2. Batch update messages table
  const allMessages = await prisma.message.findMany({
    select: { id: true, wa_message_id: true, created_at: true },
  });

  let messageFixedCount = 0;
  for (const m of allMessages) {
    if (m.wa_message_id && msgDateMap.has(m.wa_message_id)) {
      const realDate = msgDateMap.get(m.wa_message_id)!;
      if (Math.abs(realDate.getTime() - new Date(m.created_at).getTime()) > 5000) {
        await prisma.message.update({
          where: { id: m.id },
          data: { created_at: realDate },
        });
        messageFixedCount++;
      }
    }
  }
  console.log(`✅ Berhasil memperbaiki created_at pada ${messageFixedCount} pesan.`);

  // 3. Update conversation.last_message_at & updated_at ke MAX(created_at) pesan terakhir
  const conversations = await prisma.conversation.findMany({
    include: {
      messages: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: { created_at: true },
      },
    },
  });

  let convFixedCount = 0;
  for (const c of conversations) {
    const latestMsg = c.messages[0];
    if (latestMsg) {
      const realLatestDate = latestMsg.created_at;
      if (Math.abs(new Date(c.last_message_at).getTime() - new Date(realLatestDate).getTime()) > 5000) {
        await prisma.conversation.update({
          where: { id: c.id },
          data: {
            last_message_at: realLatestDate,
            updated_at: realLatestDate,
          },
        });
        convFixedCount++;
      }
    }
  }

  console.log(`✅ Berhasil menyelaraskan last_message_at pada ${convFixedCount} percakapan.`);
  console.log('🎉 Selesai! Semua percakapan di chatlist kini menampilkan waktu asli chat customer.');
}

main()
  .catch((e) => {
    console.error('Error fixing timestamps:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
