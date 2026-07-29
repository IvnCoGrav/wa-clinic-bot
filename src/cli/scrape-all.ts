import { wahaClient } from '../integrations/waha/client';
import { customerService } from '../services/customer.service';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Simple utility script to scrape all non‑group chats from WAHA and persist
 * messages into the database. Useful for testing or bulk import of historic
 * conversations.
 *
 * Run with: npx -y ts-node ./src/cli/scrape-all.ts
 */
async function main() {
  console.log('\x1b[36m[SCRAPE] Fetching chat list from WAHA...\x1b[0m');
  const chats = await wahaClient.getChats();
  console.log(`\x1b[32m[SCRAPE] Retrieved ${chats.length} chats.\x1b[0m`);

  for (const chat of chats) {
    // Skip group chats (they end with @g.us)
    if (chat.id.endsWith('@g.us')) continue;

    const phone = await wahaClient.getPhoneNumberFromLid(chat.id);
    console.log(`\x1b[36m[SCRAPE] Processing chat ${chat.id} (phone: ${phone})...\x1b[0m`);

    const customer = await customerService.getOrCreateCustomer(phone, undefined, DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    const messages = await wahaClient.getMessages(chat.id, 200);
    console.log(`\x1b[32m[SCRAPE] Fetched ${messages.length} messages for ${phone}.\x1b[0m`);

    for (const msg of messages) {
      const isDup = await messageService.isDuplicateMessage(msg.id, DEFAULT_TENANT_ID);
      if (isDup) continue;

      await messageService.logMessage({
        tenantId: DEFAULT_TENANT_ID,
        conversationId: conversation.id,
        direction: msg.fromMe ? 'OUTBOUND' : 'INBOUND',
        content: msg.body,
        waMessageId: msg.id,
        payloadRaw: msg,
      });
    }
  }

  console.log('\x1b[32m[SCRAPE] Completed scraping all chats.\x1b[0m');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('\x1b[31m[SCRAPE ERROR]\x1b[0m', e);
  process.exit(1);
});
