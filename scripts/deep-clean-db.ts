import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

async function main() {
  console.log('🧹 [DEEP CLEANUP] Memeriksa seluruh tabel database dari data dummy & data generate...\n');

  // 1. Periksa tabel Customer
  const allCustomers = await prisma.customer.findMany({
    select: {
      id: true,
      phone: true,
      name: true,
      is_sandbox_test: true,
      _count: {
        select: {
          conversations: true,
          reservations: true,
        },
      },
    },
  });

  const dummyCustomers = allCustomers.filter((c) => {
    const p = c.phone.trim();
    if (c.is_sandbox_test) return true;
    if (
      p === '0' ||
      p === '628123456789' ||
      p === '6281234567890' ||
      p === '08123456789' ||
      p === '08129876543' ||
      p.startsWith('6289999') ||
      p.startsWith('08571111') ||
      p.startsWith('628571111') ||
      p.startsWith('dummy_') ||
      p.startsWith('cust_test_') ||
      p.startsWith('mock_') ||
      p.includes('test') ||
      p.includes('status') ||
      p.includes('newsletter') ||
      p.includes('broadcast')
    ) {
      return true;
    }
    if (c.name && /TEST|Dummy|Sandbox|Tester/i.test(c.name)) return true;
    // Format nomor WhatsApp seluler Indonesia valid: 628... atau 08... dengan 9-14 digit
    if (!/^(628|08)\d{7,12}$/.test(p)) return true;
    return false;
  });

  console.log(`🔍 Customer Dummy/Generate ditemukan: ${dummyCustomers.length} record`);
  const dummyIds = dummyCustomers.map((c) => c.id);
  const dummyPhones = dummyCustomers.map((c) => c.phone);

  if (dummyIds.length > 0) {
    const delCust = await prisma.customer.deleteMany({
      where: { id: { in: dummyIds } },
    });
    console.log(`   ✅ Dihapus ${delCust.count} customer dummy (beserta relasi conversation, messages, reservations).`);
  }

  // 2. Periksa tabel Reservation yang tidak memiliki customer riil atau berisi data test
  const dummyReservations = await prisma.reservation.deleteMany({
    where: {
      OR: [
        { raw_text: { contains: 'TEST', mode: 'insensitive' } },
        { raw_text: { contains: 'Dummy', mode: 'insensitive' } },
        { treatment_detail: { contains: 'TEST', mode: 'insensitive' } },
      ],
    },
  });
  console.log(`🔍 Reservasi Dummy dihapus: ${dummyReservations.count} record`);

  // 3. Periksa tabel AiRouterEvaluation & AiEvaluation dari nomor dummy
  const delRouterEval = await prisma.aiRouterEvaluation.deleteMany({
    where: {
      OR: [
        { customer_phone: { in: dummyPhones } },
        { customer_phone: { startsWith: '6289999' } },
        { customer_phone: { startsWith: '08571111' } },
        { customer_phone: { contains: 'test' } },
      ],
    },
  });
  console.log(`🔍 AiRouterEvaluation dummy dihapus: ${delRouterEval.count} record`);

  const delAiEval = await prisma.aiEvaluation.deleteMany({
    where: {
      OR: [
        { customer_phone: { in: dummyPhones } },
        { customer_phone: { startsWith: '6289999' } },
        { customer_phone: { startsWith: '08571111' } },
        { customer_phone: { contains: 'test' } },
      ],
    },
  });
  console.log(`🔍 AiEvaluation dummy dihapus: ${delAiEval.count} record`);

  // 4. Periksa tabel LlmAuditLog dari nomor dummy
  const delLlmAudit = await prisma.llmAuditLog.deleteMany({
    where: {
      OR: [
        { customer_phone: { in: dummyPhones } },
        { customer_phone: { startsWith: '6289999' } },
        { customer_phone: { startsWith: '08571111' } },
        { customer_phone: { contains: 'test' } },
        { customer_phone: 'unknown' },
      ],
    },
  });
  console.log(`🔍 LlmAuditLog dummy dihapus: ${delLlmAudit.count} record`);

  // 5. Periksa tabel Staff Dummy
  const dummyStaff = await prisma.staff.findMany({
    where: {
      OR: [
        { phone: '08123456789' },
        { phone: '08129876543' },
        { name: { contains: 'Dummy', mode: 'insensitive' } },
      ],
    },
  });
  if (dummyStaff.length > 0) {
    const delStaff = await prisma.staff.deleteMany({
      where: { id: { in: dummyStaff.map((s) => s.id) } },
    });
    console.log(`🔍 Staff Dummy dihapus: ${delStaff.count} record (${dummyStaff.map((s) => s.name).join(', ')})`);
  } else {
    console.log(`🔍 Staff Dummy: 0 record`);
  }

  // 6. Periksa tabel LegacyStaging, MedicalFaqStaging, GeneralFaqStaging
  const delLegacy = await prisma.legacyStaging.deleteMany({
    where: {
      OR: [
        { phoneNumber: { in: dummyPhones } },
        { phoneNumber: { startsWith: '6289999' } },
        { phoneNumber: { startsWith: '08571111' } },
        { phoneNumber: { contains: 'test' } },
      ],
    },
  });
  console.log(`🔍 LegacyStaging dummy dihapus: ${delLegacy.count} record`);

  const delMedicalFaq = await prisma.medicalFaqStaging.deleteMany({
    where: {
      OR: [
        { customer_phone: { in: dummyPhones } },
        { customer_phone: { startsWith: '6289999' } },
        { customer_phone: { startsWith: '08571111' } },
        { customer_phone: { contains: 'test' } },
      ],
    },
  });
  console.log(`🔍 MedicalFaqStaging dummy dihapus: ${delMedicalFaq.count} record`);

  const delGeneralFaq = await prisma.generalFaqStaging.deleteMany({
    where: {
      OR: [
        { raw_question: { contains: 'test', mode: 'insensitive' } },
        { raw_question: { contains: 'dummy', mode: 'insensitive' } },
      ],
    },
  });
  console.log(`🔍 GeneralFaqStaging dummy dihapus: ${delGeneralFaq.count} record`);

  // 7. Ringkasan Akhir Database
  const [realCustomersCount, realConvsCount, realMsgsCount, realReservationsCount] = await Promise.all([
    prisma.customer.count({ where: { tenant_id: DEFAULT_TENANT_ID } }),
    prisma.conversation.count({ where: { tenant_id: DEFAULT_TENANT_ID } }),
    prisma.message.count({ where: { tenant_id: DEFAULT_TENANT_ID } }),
    prisma.reservation.count({ where: { tenant_id: DEFAULT_TENANT_ID } }),
  ]);

  console.log('\n======================================================');
  console.log('✨ [BERSIH 100%] DATABASE HANYA BERISI DATA ORANG ASLI:');
  console.log(`   - Customer Riil Asli : ${realCustomersCount} customer`);
  console.log(`   - Percakapan Asli    : ${realConvsCount} percakapan`);
  console.log(`   - Pesan Riwayat Asli : ${realMsgsCount} pesan`);
  console.log(`   - Reservasi Riil     : ${realReservationsCount} reservasi`);
  console.log('======================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Error during cleanup:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
