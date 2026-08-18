import { prisma } from '../src/db/client';
import fs from 'fs/promises';
import path from 'path';

function parseWibTimestamp(raw: string): Date | null {
  // Format: [DD/MM/YYYY, HH.mm.ss] misal [14/07/2026, 15.56.21]
  const match = raw.match(/\[(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2})\.(\d{2})\.(\d{2})\]/);
  if (!match) return null;
  const [, d, m, y, h, min, s] = match;
  // WIB adalah UTC+7
  const isoStr = `${y}-${m}-${d}T${h}:${min}:${s}+07:00`;
  const date = new Date(isoStr);
  return isNaN(date.getTime()) ? null : date;
}

async function main() {
  console.log('🚀 [TIMESTAMP RESTORE] Membaca file transkrip lengkap...');
  const filePath = path.resolve(__dirname, '../exports/TRANSKRIP_LENGKAP_SEMUA_CHAT.md');
  const content = await fs.readFile(filePath, 'utf8');

  const sections = content.split(/\n(?=## #\d+\.)/);
  console.log(`📋 Ditemukan ${sections.length - 1} blok percakapan customer di file transkrip.`);

  let updatedMessagesCount = 0;
  let updatedConversationsCount = 0;

  for (let i = 1; i < sections.length; i++) {
    const sec = sections[i];
    const headerMatch = sec.match(/## #\d+\.\s*(.+?)\s*—\s*`(\d+)`/);
    if (!headerMatch) continue;

    const [, name, phone] = headerMatch;
    const customer = await prisma.customer.findFirst({
      where: { phone },
      include: {
        conversations: {
          include: {
            messages: {
              orderBy: { created_at: 'asc' },
            },
          },
        },
      },
    });

    if (!customer || customer.conversations.length === 0) continue;
    const conv = customer.conversations[0];

    // Ekstrak semua bubble dan timestamp di section ini
    const bubbleRegex = /> \*\*([^\*]+)\*\* `(\[\d{2}\/\d{2}\/\d{4},\s*\d{2}\.\d{2}\.\d{2}\])`\n>([\s\S]*?)(?=\n> \*\*|\n---|\n## |$)/g;
    let bMatch;
    const parsedBubbles: Array<{ sender: string; timestampStr: string; date: Date; text: string }> = [];

    while ((bMatch = bubbleRegex.exec(sec)) !== null) {
      const [, sender, tsStr, body] = bMatch;
      const date = parseWibTimestamp(tsStr);
      if (date) {
        const cleanText = body.replace(/\n> /g, '\n').trim();
        parsedBubbles.push({
          sender,
          timestampStr: tsStr,
          date,
          text: cleanText,
        });
      }
    }

    if (parsedBubbles.length === 0) continue;

    const latestBubbleDate = parsedBubbles[parsedBubbles.length - 1].date;

    // 1. Update last_message_at & updated_at conversation ke waktu bubble terakhir
    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        last_message_at: latestBubbleDate,
        updated_at: latestBubbleDate,
      },
    });
    updatedConversationsCount++;

    // 2. Cocokkan pesan-pesan di database dan perbaiki created_at
    const dbMessages = conv.messages;
    for (let pIdx = 0; pIdx < parsedBubbles.length; pIdx++) {
      const pb = parsedBubbles[pIdx];
      // Cari db message yang isinya paling cocok
      const matchedDbMsg = dbMessages.find(
        (dm) =>
          dm.content?.trim() === pb.text ||
          (pb.text.length > 15 && dm.content?.includes(pb.text.slice(0, 15)))
      );

      if (matchedDbMsg) {
        if (Math.abs(new Date(matchedDbMsg.created_at).getTime() - pb.date.getTime()) > 5000) {
          await prisma.message.update({
            where: { id: matchedDbMsg.id },
            data: { created_at: pb.date },
          });
          updatedMessagesCount++;
        }
      }
    }
  }

  console.log(`✅ Sukses menyelaraskan ${updatedConversationsCount} percakapan ke waktu asli chat terakhir.`);
  console.log(`✅ Sukses memperbaiki ${updatedMessagesCount} timestamp pesan ke waktu riil WhatsApp.`);
}

main()
  .catch((err) => {
    console.error('Error restoring timestamps:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
