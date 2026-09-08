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

  const phoneToContact = new Map<string, any>();
  const lidToContact = new Map<string, any>();

  for (const c of contacts) {
    if (c.id) {
      if (c.id.includes('@lid')) {
        lidToContact.set(c.id, c);
        lidToContact.set(c.id.replace(/@.*$/, ''), c);
      } else {
        const p = c.id.replace(/@.*$/, '');
        phoneToContact.set(p, c);
        phoneToContact.set(c.id, c);
      }
    }
  }

  // 2. Fetch chats
  const chatsRes = await axios.get(`${baseUrl}/api/${session}/chats`, { headers, timeout: 15000 });
  const chats = chatsRes.data?.value || chatsRes.data || [];

  console.log(`Analyzing unmatched chats:`);
  let lidChats = 0;
  let groupChats = 0;
  let noNameChats = 0;

  for (const chat of chats) {
    if (chat.id.includes('@g.us') || chat.id.includes('broadcast') || chat.id.includes('@newsletter')) {
      groupChats++;
      continue;
    }
    const phone = chat.id.replace(/@.*$/, '');
    const isLid = chat.id.includes('@lid');
    if (isLid) lidChats++;

    const contact = phoneToContact.get(phone) || phoneToContact.get(chat.id) || (isLid ? lidToContact.get(chat.id) : null);
    const name = contact?.name || contact?.pushname || contact?.shortName || chat.name;

    if (!name) {
      noNameChats++;
      if (noNameChats <= 10) {
        console.log(`   - ID: ${chat.id} | isLid: ${isLid} | HasContactRecord: ${!!contact}`);
        if (contact) console.log('     Contact data:', contact);
      }
    }
  }

  console.log(`\nStats:`);
  console.log(`- LID chats: ${lidChats}`);
  console.log(`- Group/Broadcast: ${groupChats}`);
  console.log(`- Purely without names (stranger numbers / never saved): ${noNameChats}`);
}

main().catch(console.error);
