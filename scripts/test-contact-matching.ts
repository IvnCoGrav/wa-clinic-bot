import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const baseUrl = process.env.WAHA_BASE_URL || 'http://localhost:3001';
  const apiKey = process.env.WAHA_API_KEY || '';
  const session = process.env.WAHA_SESSION_NAME || 'default';

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  // 1. Fetch contacts
  const contactsRes = await axios.get(`${baseUrl}/api/contacts/all`, {
    headers,
    params: { session },
    timeout: 15000,
  }).catch(async () => {
    return await axios.get(`${baseUrl}/api/${session}/contacts`, { headers, timeout: 15000 });
  });

  const contacts = contactsRes.data?.value || contactsRes.data || [];
  console.log(`Total WAHA contacts: ${contacts.length}`);

  // Build lookup maps
  const phoneToName = new Map<string, string>();
  for (const c of contacts) {
    const name = c.name || c.pushname || c.shortName || '';
    if (!name) continue;

    // c.id could be 628xxx@c.us, 628xxx@s.whatsapp.net, or xxx@lid
    const rawId = c.id || '';
    const cleanPhone = rawId.replace(/@.*$/, '');
    if (cleanPhone && /^\d+$/.test(cleanPhone)) {
      phoneToName.set(cleanPhone, name);
      phoneToName.set(`${cleanPhone}@c.us`, name);
      phoneToName.set(`${cleanPhone}@s.whatsapp.net`, name);
    }
  }

  // 2. Fetch chats
  const chatsRes = await axios.get(`${baseUrl}/api/${session}/chats`, { headers, timeout: 15000 });
  const chats = chatsRes.data?.value || chatsRes.data || [];
  console.log(`Total WAHA chats: ${chats.length}`);

  let matchedWithContactName = 0;
  let matchedWithChatName = 0;
  let unmatched = 0;

  for (const chat of chats) {
    if (chat.id.includes('@g.us') || chat.id.includes('broadcast') || chat.id.includes('@newsletter')) continue;
    const phone = chat.id.replace(/@.*$/, '');
    const chatName = chat.name;
    const contactName = phoneToName.get(phone) || phoneToName.get(chat.id);

    if (contactName) {
      matchedWithContactName++;
    } else if (chatName) {
      matchedWithChatName++;
    } else {
      unmatched++;
      // console.log(`Unmatched chat: ${chat.id}`);
    }
  }

  console.log(`\nResults:`);
  console.log(`- Matched with Contacts (name/pushname): ${matchedWithContactName}`);
  console.log(`- Matched with Chat Name: ${matchedWithChatName}`);
  console.log(`- Unmatched: ${unmatched}`);
}

main().catch(console.error);
