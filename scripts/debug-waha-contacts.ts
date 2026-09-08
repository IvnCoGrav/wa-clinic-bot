import { wahaClient } from '../integrations/waha/client';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const baseUrl = process.env.WAHA_BASE_URL || 'http://localhost:3000';
  const apiKey = process.env.WAHA_API_KEY || '';
  const session = process.env.WAHA_SESSION_NAME || 'default';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  console.log(`🔍 [DEBUG WAHA] Checking WAHA at ${baseUrl}, session: ${session}...`);

  // 1. Ambil daftar chats dari WAHA
  try {
    const chatsRes = await axios.get(`${baseUrl}/api/${session}/chats`, { headers, timeout: 15000 });
    const chats = chatsRes.data?.value || chatsRes.data || [];
    console.log(`\n📋 WAHA Total Chats: ${chats.length}`);
    console.log('Sample Chats (first 10):');
    for (const c of chats.slice(0, 10)) {
      console.log(`   - ID: ${c.id} | Name: "${c.name || ''}" | Pushname: "${c.pushname || ''}" | Unread: ${c.unreadCount}`);
    }
  } catch (e: any) {
    console.error('Failed to get chats:', e.message);
  }

  // 2. Ambil daftar contacts dari WAHA (/api/contacts/all atau /api/{session}/contacts)
  try {
    const contactsRes = await axios.get(`${baseUrl}/api/contacts/all`, {
      headers,
      params: { session },
      timeout: 15000,
    }).catch(async () => {
      return await axios.get(`${baseUrl}/api/${session}/contacts`, { headers, timeout: 15000 });
    });

    const contacts = contactsRes.data?.value || contactsRes.data || [];
    console.log(`\n👥 WAHA Total Contacts: ${contacts.length}`);
    console.log('Sample Contacts (first 15 with names):');
    const withNames = contacts.filter((c: any) => c.name || c.pushname || c.shortName);
    for (const c of withNames.slice(0, 15)) {
      console.log(`   - ID: ${c.id} | Name: "${c.name || ''}" | Pushname: "${c.pushname || ''}" | Short: "${c.shortName || ''}" | Number: "${c.number || ''}"`);
    }
  } catch (e: any) {
    console.error('Failed to get contacts:', e.message);
  }
}

main().catch(console.error);
