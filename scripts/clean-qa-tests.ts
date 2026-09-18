/**
 * clean-qa-tests.ts
 *
 * Script pembersih database lokal untuk menghapus seluruh data sampah hasil simulasi testing:
 * - Customer dengan is_sandbox_test = true atau nomor telepon test (62899real..., dummy...)
 * - Seluruh percakapan, pesan, dan reservasi terkait terhapus bersih secara cascade.
 *
 * Penggunaan:
 *   npm run test:clean
 *   npx tsx scripts/clean-qa-tests.ts
 */

import { prisma } from '../src/db/client';

async function main() {
  // Strict Safety Guard: Hanya izinkan eksekusi di lingkungan LOKAL
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.IS_PRODUCTION === 'true' ||
    process.env.SERVER_MODE === 'production' ||
    (process.env.DATABASE_URL &&
      !process.env.DATABASE_URL.includes('localhost') &&
      !process.env.DATABASE_URL.includes('127.0.0.1'));

  if (isProduction) {
    console.error('\n❌ [SECURITY BLOCKED]: Script clean-qa-tests DILARANG dijalankan di Live Server / Database Produksi!');
    process.exit(1);
  }

  console.log('\n🧹 [QA CLEANUP] Mencari data simulasi pengujian / QA tester di database lokal...');

  try {
    // Cari customer sandbox atau nomor test
    const sandboxCustomers = await prisma.customer.findMany({
      where: {
        OR: [
          { is_sandbox_test: true },
          { phone: { contains: 'real' } },
          { phone: { startsWith: '62899' } },
          { name: { startsWith: '[QA Tester' } },
        ],
      },
      select: { id: true, phone: true, name: true },
    });

    if (sandboxCustomers.length === 0) {
      console.log('✨ Database lokal sudah bersih! Tidak ada data sampah QA / sandbox.');
      process.exit(0);
    }

    const customerIds = sandboxCustomers.map((c) => c.id);
    console.log(`Ditemukan ${sandboxCustomers.length} kontak QA tester / sandbox.`);

    // Hitung pesan dan percakapan sebelum dihapus
    const convCount = await prisma.conversation.count({
      where: { customer_id: { in: customerIds } },
    });
    const msgCount = await prisma.message.count({
      where: {
        conversation: {
          customer_id: { in: customerIds },
        },
      },
    });

    // Hapus customer (cascade Prisma menghapus conversation, messages, dll)
    const deleteResult = await prisma.customer.deleteMany({
      where: { id: { in: customerIds } },
    });

    console.log(`\n✅ [BERHASIL DIBERSIHKAN]`);
    console.log(`   - Customer Dihapus     : ${deleteResult.count}`);
    console.log(`   - Percakapan Dihapus   : ${convCount}`);
    console.log(`   - Pesan Terhapus       : ${msgCount}`);
    console.log(`✨ Database lokal kembali bersih 100% tanpa sisa sampah pengujian!\n`);
  } catch (err: any) {
    console.error('❌ Gagal membersihkan data QA:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main();
