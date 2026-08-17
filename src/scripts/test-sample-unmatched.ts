import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const baseUrl = process.env.WAHA_BASE_URL || 'http://localhost:3001';
  const apiKey = process.env.WAHA_API_KEY || '';
  const session = process.env.WAHA_SESSION_NAME || 'default';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const testPhones = ['6285855274424', '6285159080098', '6281234538460', '6285706801242', '6281357194098'];

  for (const phone of testPhones) {
    console.log(`\n🔍 Checking phone: ${phone}...`);
    // 1. Cek contact di WAHA
    try {
      const res = await axios.get(`${baseUrl}/api/${session}/contacts/${encodeURIComponent(`${phone}@c.us`)}`, { headers, timeout: 5000 });
      console.log('   WAHA Contact API:', res.data);
    } catch (e: any) {
      console.log('   WAHA Contact API Error:', e.response?.data || e.message);
    }

    // 2. Cek pesan terakhir di DB
    const cust = await prisma.customer.findUnique({
      where: { phone },
      include: {
        conversations: {
          include: {
            messages: {
              take: 5,
              orderBy: { created_at: 'asc' },
            },
          },
        },
      },
    });

    if (cust && cust.conversations[0]?.messages) {
      console.log('   First Messages in DB:');
      for (const m of cust.conversations[0].messages) {
        console.log(`     [${m.direction}] ${m.content.slice(0, 80)}`);
      }
    }
  }
}

main().catch(console.error).finally(async () => { await prisma.$disconnect(); });
