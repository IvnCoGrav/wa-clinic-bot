/**
 * Seed script: Buat 10 dummy data Follow-Up untuk cek UI.
 * Jalankan: npx tsx scripts/seed-followups.ts
 */
import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

const dummyCustomers = [
  { phone: '6281234567801', name: 'Bunda Sari', kelurahan: 'Wedoro', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo' },
  { phone: '6281234567802', name: 'Bunda Dewi', kelurahan: 'Betro', kecamatan: 'Sedati', kota: 'Kabupaten Sidoarjo' },
  { phone: '6281234567803', name: 'Bunda Rina', kelurahan: 'Sepande', kecamatan: 'Candi', kota: 'Kabupaten Sidoarjo' },
  { phone: '6281234567804', name: 'Bunda Ani', kelurahan: 'Berbek', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo' },
  { phone: '6281234567805', name: 'Bunda Maya', kelurahan: 'Kureksari', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo' },
  { phone: '6281234567806', name: 'Bunda Lilis', kelurahan: 'Gempolsari', kecamatan: 'Tanggulangin', kota: 'Kabupaten Sidoarjo' },
  { phone: '6281234567807', name: 'Bunda Ningsih', kelurahan: 'Pucanganom', kecamatan: 'Sidoarjo', kota: 'Kabupaten Sidoarjo' },
  { phone: '6281234567808', name: 'Bunda Putri', kelurahan: 'Tropodo', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo' },
  { phone: '6281234567809', name: 'Bunda Wati', kelurahan: 'Sidoklumpuk', kecamatan: 'Sidoarjo', kota: 'Kabupaten Sidoarjo' },
  { phone: '6281234567810', name: 'Bunda Ratna', kelurahan: 'Janti', kecamatan: 'Waru', kota: 'Kabupaten Sidoarjo' },
];

function addDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

async function seed() {
  console.log('🚀 Mulai seed 10 dummy follow-up data...\n');

  for (let i = 0; i < dummyCustomers.length; i++) {
    const c = dummyCustomers[i];
    try {
      // 1. Buat / ambil customer
      let customer = await prisma.customer.findFirst({
        where: { phone: c.phone, tenant_id: DEFAULT_TENANT_ID },
      });
      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            phone: c.phone,
            name: c.name,
            kelurahan: c.kelurahan,
            kecamatan: c.kecamatan,
            kota: c.kota,
          },
        });
      }

      // 2. Buat follow-up dengan variasi status & tipe
      const followUpData: any[] = [];

      // Variasi: NO_PURCHASE (3 stage) untuk beberapa, NEXT_TREATMENT untuk lainnya
      if (i % 2 === 0) {
        // NO_PURCHASE: 3 stage +3, +7, +14 hari
        followUpData.push(
          { type: 'NO_PURCHASE', stage: 1, scheduled_at: addDays(3), status: 'PENDING' },
          { type: 'NO_PURCHASE', stage: 2, scheduled_at: addDays(7), status: 'PENDING' },
          { type: 'NO_PURCHASE', stage: 3, scheduled_at: addDays(14), status: 'PENDING' },
        );
      } else {
        // NEXT_TREATMENT: 3 stage +1, +2, +3 bulan
        followUpData.push(
          { type: 'NEXT_TREATMENT', stage: 1, scheduled_at: addMonths(1), status: 'PENDING' },
          { type: 'NEXT_TREATMENT', stage: 2, scheduled_at: addMonths(2), status: 'PENDING' },
          { type: 'NEXT_TREATMENT', stage: 3, scheduled_at: addMonths(3), status: 'PENDING' },
        );
      }

      // Tambah 1 follow-up SENT (riwayat) & 1 CANCELLED untuk variasi status di UI
      followUpData.push(
        { type: 'NO_PURCHASE', stage: 1, scheduled_at: addDays(-5), sent_at: new Date(Date.now() - 5 * 86400000), status: 'SENT' },
        { type: 'NEXT_TREATMENT', stage: 1, scheduled_at: addDays(-2), sent_at: new Date(Date.now() - 2 * 86400000), status: 'SENT' },
        { type: 'NO_PURCHASE', stage: 2, scheduled_at: addDays(-1), status: 'CANCELLED' },
      );

      // Buat semua follow-up untuk customer ini
      for (const f of followUpData) {
        await prisma.followUp.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            customer_id: customer.id,
            type: f.type,
            stage: f.stage,
            scheduled_at: f.scheduled_at,
            sent_at: f.sent_at || null,
            status: f.status,
          },
        });
      }

      console.log(`  ✅ ${c.name} (${c.phone}) — ${followUpData.length} follow-ups dibuat`);
    } catch (err: any) {
      console.error(`  ❌ Gagal seed untuk ${c.name}:`, err.message);
    }
  }

  console.log('\n✅ Seed selesai! Buka UI /admin/follow-ups untuk melihat data.');
  await prisma.$disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
