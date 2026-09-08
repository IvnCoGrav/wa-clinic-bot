import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const baseUrl = process.env.WAHA_BASE_URL || 'http://localhost:3001';
  const apiKey = process.env.WAHA_API_KEY || '';
  const session = process.env.WAHA_SESSION_NAME || 'default';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  console.log('🔍 Checking archived chats in WAHA...');
  const chatsRes = await axios.get(`${baseUrl}/api/${session}/chats`, { headers, timeout: 15000 });
  const chats = chatsRes.data?.value || chatsRes.data || [];

  let archivedCount = 0;
  let nonArchivedCount = 0;

  for (const c of chats) {
    if (c.archived || c.archive || c.isArchived) {
      archivedCount++;
      if (archivedCount <= 5) {
        console.log('   Sample Archived Chat:', c);
      }
    } else {
      nonArchivedCount++;
    }
  }

  console.log(`\nStats:`);
  console.log(`- Total Chats in WAHA: ${chats.length}`);
  console.log(`- Archived Chats: ${archivedCount}`);
  console.log(`- Non-Archived: ${nonArchivedCount}`);
}

main().catch(console.error);
