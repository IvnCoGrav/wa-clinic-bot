import { prisma } from '../db/client';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('📦 [EXPORTER] Mengekstrak seluruh data REAL dari database lokal...');

  const allCustomers = await prisma.customer.findMany({
    where: { is_sandbox_test: false },
    include: {
      children: true,
      reservations: true,
      conversations: {
        include: {
          messages: {
            orderBy: { created_at: 'asc' },
          },
        },
      },
    },
    orderBy: { created_at: 'asc' },
  });

  // Filter ketat nomor HP valid & non-dummy
  const realCustomers = allCustomers.filter((c) => {
    const p = (c.phone || '').trim();
    if (!/^(628|08)\d{7,12}$/.test(p)) return false;
    if (p.startsWith('6289999') || p.startsWith('08571111') || p.startsWith('628123456789') || p === '0') return false;
    if (c.name && /TEST|Dummy|Sandbox|Tester/i.test(c.name)) return false;
    return true;
  });

  const legacyStaging = await prisma.legacyStaging.findMany({
    where: {
      status: { in: ['APPROVED', 'COMMITTED'] },
      phoneNumber: {
        notIn: ['0', '628123456789', '6289999999999'],
      },
    },
  });

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    customerCount: realCustomers.length,
    customers: realCustomers,
    legacyStaging,
  };

  const outputDir = path.resolve(process.cwd(), 'storage');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'real_data_export.json');
  fs.writeFileSync(outputPath, JSON.stringify(exportPayload, null, 2), 'utf-8');

  console.log(`✅ [EXPORTER] Berhasil mengekspor:`);
  console.log(`   - File: ${outputPath}`);
  console.log(`   - Pelanggan Riil : ${realCustomers.length}`);
  console.log(`   - Data Anak      : ${realCustomers.reduce((acc, c) => acc + c.children.length, 0)}`);
  console.log(`   - Reservasi Riil : ${realCustomers.reduce((acc, c) => acc + c.reservations.length, 0)}`);
  console.log(`   - Percakapan     : ${realCustomers.reduce((acc, c) => acc + c.conversations.length, 0)}`);
  console.log(`   - Pesan Riil     : ${realCustomers.reduce((acc, c) => acc + c.conversations.reduce((m, cv) => m + cv.messages.length, 0), 0)}`);
  console.log(`   - Legacy Staging : ${legacyStaging.length}`);
}

main()
  .catch((e) => {
    console.error('❌ Export failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
