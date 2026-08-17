import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

async function main() {
  console.log('🔄 [BACKFILL] Memperbarui nama kontak di database dari WAHA Contacts & Chat messages...\n');

  // 1. Ambil seluruh kontak dari WAHA
  const contacts = await wahaClient.getAllContacts();
  console.log(`📥 Diunduh ${contacts.length} kontak dari WAHA`);

  const contactMap = new Map<string, string>();
  for (const c of contacts) {
    const contactName = (c.name || c.pushname || c.shortName || '').trim();
    if (!contactName) continue;
    const clean = (c.id || '').replace(/@.*$/, '');
    if (clean) {
      contactMap.set(clean, contactName);
      contactMap.set(`${clean}@c.us`, contactName);
      contactMap.set(`${clean}@s.whatsapp.net`, contactName);
    }
    if (c.id) contactMap.set(c.id, contactName);
  }

  // 2. Ambil semua customer di DB
  const customers = await prisma.customer.findMany({
    where: { tenant_id: DEFAULT_TENANT_ID },
    include: {
      conversations: {
        include: {
          messages: {
            where: { direction: 'INBOUND' },
            take: 20,
          },
        },
      },
    },
  });

  console.log(`📋 Memproses ${customers.length} customer di database...\n`);

  let updatedCount = 0;
  for (const cust of customers) {
    const phone = cust.phone.trim();
    let bestName = contactMap.get(phone) || contactMap.get(`${phone}@c.us`) || contactMap.get(`${phone}@s.whatsapp.net`);

    // Jika belum ketemu di buku kontak, coba ekstraksi dari pesan chat
    if (!bestName) {
      for (const conv of cust.conversations) {
        for (const msg of conv.messages) {
          const match = msg.content.match(/(?:Nama(?:\s+Bunda|\s+Moms|\s+Ibu|\s+Pasien|\s+Lengkap|\s+Pemesan)?\s*[:=]\s*)([A-Za-z\s'.]{3,35})/i);
          if (match && match[1]) {
            const candidate = match[1].trim();
            if (!/^(alamat|jadwal|tanggal|treatment|paket|pilihan|kelurahan|kecamatan|terapi|pijat|surabaya|sidoarjo)/i.test(candidate)) {
              bestName = candidate;
              break;
            }
          }
        }
        if (bestName) break;
      }
    }

    if (bestName && bestName !== cust.name) {
      await prisma.customer.update({
        where: { id: cust.id },
        data: { name: bestName },
      });
      console.log(`   ✨ [UPDATED] HP: ${phone} -> Nama: "${bestName}" (sebelumnya: "${cust.name || '(kosong)'}")`);
      updatedCount++;
    }
  }

  console.log(`\n🎉 Selesai! Berhasil memperbarui ${updatedCount} nama kontak.`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
