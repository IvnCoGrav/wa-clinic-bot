import { migrationService } from '../src/services/migration.service';
import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

async function main() {
  console.log('=== MEMULAI EKSTRAKSI CHAT DARI DATABASE LOKAL ===\n');

  const convCount = await prisma.conversation.count({ where: { tenant_id: DEFAULT_TENANT_ID } });
  const msgCount = await prisma.message.count({ where: { tenant_id: DEFAULT_TENANT_ID } });

  console.log(`Statistik Database Lokal:`);
  console.log(`- Total Percakapan: ${convCount}`);
  console.log(`- Total Pesan: ${msgCount}\n`);

  const startTime = Date.now();
  const result = await migrationService.extractFromLocalDatabase(DEFAULT_TENANT_ID);
  const duration = Date.now() - startTime;

  console.log('Hasil Ekstraksi:');
  console.log(`- Sukses: ${result.success}`);
  console.log(`- Total Chat Dipindai: ${result.totalScanned}`);
  console.log(`- Kontak Terekstrak ke Staging: ${result.extractedCount}`);
  console.log(`- Durasi Eksekusi: ${duration} ms (Sangat cepat & tanpa panggil WAHA!)\n`);

  const stagingCounts = {
    COMMITTED: await prisma.legacyStaging.count({ where: { tenantId: DEFAULT_TENANT_ID, status: 'COMMITTED' } }),
    PENDING: await prisma.legacyStaging.count({ where: { tenantId: DEFAULT_TENANT_ID, status: 'PENDING' } }),
    APPROVED: await prisma.legacyStaging.count({ where: { tenantId: DEFAULT_TENANT_ID, status: 'APPROVED' } }),
    REJECTED: await prisma.legacyStaging.count({ where: { tenantId: DEFAULT_TENANT_ID, status: 'REJECTED' } }),
  };

  console.log('Status Antrean Staging Terkini:');
  console.table(stagingCounts);
}

main()
  .catch((e) => {
    console.error('Error saat menjalankan ekstraksi:', e);
  })
  .finally(() => prisma.$disconnect());
