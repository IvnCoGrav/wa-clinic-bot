import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const phone = process.argv[2];
  if (!phone) {
    console.error('❌ Harap masukkan nomor HP yang ingin di-reset. Contoh: npx tsx src/cli/reset-customer.ts 79903991054369');
    process.exit(1);
  }

  // Bersihkan input nomor HP (hanya ambil angka saja)
  const cleanedPhone = phone.replace(/\D/g, '');
  console.log(`🔄 Sedang menghapus data dan mereset sesi chat untuk nomor: ${cleanedPhone}...`);

  try {
    // Hapus customer dari database (akan menghapus relasi conversation, messages, & reservations karena onDelete: Cascade)
    const result = await prisma.customer.deleteMany({
      where: {
        phone: cleanedPhone,
      },
    });

    if (result.count > 0) {
      console.log(`✅ [SUKSES] Berhasil mereset data! Nomor ${cleanedPhone} telah bersih dan siap diuji coba dari awal lagi.`);
    } else {
      console.log(`⚠️ Nomor ${cleanedPhone} tidak ditemukan di database. Chatbot Anda memang belum pernah berinteraksi dengan nomor ini.`);
    }
  } catch (error: any) {
    console.error(`❌ Terjadi error saat mereset database:`, error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
