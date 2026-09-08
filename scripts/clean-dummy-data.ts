import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

async function main() {
  console.log('🧹 [CLEANUP] Memulai pembersihan data dummy & non-customer di database...\n');

  // 1. Identifikasi customer dummy & nomor tidak valid (LID tanpa resolusi, mock 628123456789, phone '0', dsb)
  const allCustomers = await prisma.customer.findMany({
    select: {
      id: true,
      phone: true,
      name: true,
      is_sandbox_test: true,
    },
  });

  const dummyCustomers = allCustomers.filter((c) => {
    const p = c.phone.trim();
    if (c.is_sandbox_test) return true;
    if (p === '0' || p === '628123456789' || p === '6281234567890' || p.startsWith('6289999') || p.startsWith('08571111') || p.startsWith('628571111')) return true;
    if (p.startsWith('dummy_') || p.startsWith('cust_test_') || p.startsWith('mock_')) return true;
    if (p.includes('test') || p.includes('status') || p.includes('newsletter') || p.includes('broadcast')) return true;
    if (c.name && /TEST|Dummy|Sandbox/i.test(c.name)) return true;
    // Nomor HP bukan format telepon seluler valid (misal raw LID 15 digit '79903991054369', '216878702153853')
    if (!/^(628|08)\d{7,12}$/.test(p)) return true;
    return false;
  });

  console.log(`📋 Ditemukan ${dummyCustomers.length} record customer dummy:`);
  for (const c of dummyCustomers) {
    console.log(`   - [ID: ${c.id}] ${c.name || '(tanpa nama)'} (HP: ${c.phone})`);
  }

  const dummyIds = dummyCustomers.map((c) => c.id);

  if (dummyIds.length > 0) {
    // 2. Hapus relasi terkait (Prisma onDelete: Cascade akan otomatis menghapus Message, Conversation, Child, Reservation, FollowUp)
    const deletedCustomers = await prisma.customer.deleteMany({
      where: { id: { in: dummyIds } },
    });
    console.log(`\n✅ Berhasil menghapus ${deletedCustomers.count} data customer dummy beserta seluruh riwayat percakapan & pesannya.`);
  } else {
    console.log('\n✨ Tidak ada customer dummy yang ditemukan.');
  }

  // 3. Bersihkan staging FAQ test/dummy
  const deletedMedicalFaq = await prisma.medicalFaqStaging.deleteMany({
    where: {
      OR: [
        { customer_phone: { startsWith: '6289999' } },
        { customer_phone: { startsWith: '08571111' } },
        { customer_phone: { contains: 'test' } },
      ],
    },
  });
  console.log(`✅ Berhasil membersihkan ${deletedMedicalFaq.count} data MedicalFaqStaging dummy.`);

  // 4. Bersihkan AdClick dummy / unmatched tanpa data valid
  const deletedAdClicks = await prisma.adClick.deleteMany({
    where: {
      OR: [
        { phone: { startsWith: '6289999' } },
        { phone: { startsWith: '08571111' } },
        { phone: { contains: 'test' } },
      ],
    },
  });
  console.log(`✅ Berhasil membersihkan ${deletedAdClicks.count} data AdClick tracking dummy.`);

  // 5. Hitung sisa customer riil yang bersih
  const remainingCount = await prisma.customer.count({
    where: { tenant_id: DEFAULT_TENANT_ID },
  });

  const remainingCustomers = await prisma.customer.findMany({
    where: { tenant_id: DEFAULT_TENANT_ID },
    select: {
      phone: true,
      name: true,
      _count: { select: { conversations: true, reservations: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  console.log(`\n📊 Status Akhir Database:`);
  console.log(`   Total Customer Riil Asli: ${remainingCount} customer`);
  for (const rc of remainingCustomers) {
    console.log(`   - ${rc.name || '(Customer WhatsApp)'} (${rc.phone}) — ${rc._count.conversations} conv, ${rc._count.reservations} reservasi`);
  }
}

main()
  .catch((e) => {
    console.error('❌ Error during cleanup:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
