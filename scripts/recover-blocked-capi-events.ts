/**
 * Script Pemulihan Transaksi CAPI yang Terblokir
 * 
 * Script idempotent untuk memulihkan 3 transaksi yang terblokir oleh circuit breaker:
 * 1. 69ef6fe1-14df-479a-8c37-057b7a400a82 (Bunda Agnes, Rp 70.000, 4 Sept)
 * 2. d9f76026-fe88-48d7-b7a4-91487556dd08 (Bunda Fitria, Rp 180.000, 7 Sept)
 * 3. 49df5573-849a-4eb8-a3b0-a6217a95138c (Bunda Ella, Rp 105.000, 6 Sept - status confirmed)
 * 
 * Usage: npx tsx scripts/recover-blocked-capi-events.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BLOCKED_TRANSACTIONS = [
  {
    id: '69ef6fe1-14df-479a-8c37-057b7a400a82',
    customerName: 'Bunda Agnes',
    value: 70000,
    date: '2026-09-04',
  },
  {
    id: 'd9f76026-fe88-48d7-b7a4-91487556dd08',
    customerName: 'Bunda Fitria',
    value: 180000,
    date: '2026-09-07',
  },
  {
    id: '49df5573-849a-4eb8-a3b0-a6217a95138c',
    customerName: 'Bunda Ella',
    value: 105000,
    date: '2026-09-06',
    needsStatusReset: true, // Status 'confirmed' perlu di-reset ke 'pending' terlebih dahulu
  },
];

async function recoverBlockedEvents() {
  console.log('=== RECOVERY: Memulihkan transaksi CAPI yang terblokir ===\n');

  const { capiService } = await import('../src/services/capi.service');

  for (const txn of BLOCKED_TRANSACTIONS) {
    console.log(`\n--- Memproses: ${txn.customerName} (${txn.id}) ---`);
    
    try {
      // 1. Ambil data reservasi
      const reservation = await prisma.reservation.findUnique({
        where: { id: txn.id },
        include: {
          customer: {
            include: { adClick: true },
          },
        },
      });

      if (!reservation) {
        console.error(`  [SKIP] Reservasi ${txn.id} tidak ditemukan.`);
        continue;
      }

      console.log(`  Status saat ini: ${reservation.purchase_review_status}`);
      console.log(`  purchase_event_sent_at: ${reservation.purchase_event_sent_at || 'belum terkirim'}`);

      // 2. Reset status jika perlu (Bunda Ella yang status 'confirmed')
      if (txn.needsStatusReset && reservation.purchase_review_status !== 'pending') {
        console.log(`  [RESET] Mengubah status dari '${reservation.purchase_review_status}' ke 'pending'...`);
        await prisma.reservation.update({
          where: { id: txn.id },
          data: { purchase_review_status: 'pending' },
        });
        console.log(`  [RESET] Status berhasil di-reset.`);
      }

      // 3. Kirim CAPI event dengan force: true
      const eventTime = Math.floor(new Date(reservation.purchase_occurred_at || reservation.created_at).getTime() / 1000);
      
      console.log(`  [CAPI] Mengirim event Purchase ke Meta...`);
      console.log(`  event_time: ${eventTime} (${new Date(eventTime * 1000).toISOString()})`);
      console.log(`  value: ${reservation.purchase_value || txn.value} IDR`);

      const result = await capiService.sendCapiEvent({
        eventName: 'Purchase',
        customer: reservation.customer,
        adClick: reservation.customer?.adClick || undefined,
        value: reservation.purchase_value || txn.value,
        currency: 'IDR',
        tenantId: reservation.tenant_id,
        eventTime,
        customData: {
          source: 'RECOVERY_SCRIPT',
          original_transaction_id: txn.id,
          recovery_date: new Date().toISOString(),
        },
      });

      if (result.success) {
        console.log(`  [CAPI SUCCESS] Event berhasil dikirim!`);
        console.log(`    events_received: ${result.events_received}`);
        console.log(`    fbtrace_id: ${result.fbtrace_id}`);

        // 4. Update database ke 'approved'
        await prisma.reservation.update({
          where: { id: txn.id },
          data: {
            purchase_review_status: 'approved',
            purchase_event_sent_at: new Date(),
          },
        });
        console.log(`  [DB] Status diupdate ke 'approved'.`);
      } else {
        console.error(`  [CAPI FAILURE] Event gagal dikirim: ${result.message}`);
        if (result.metaResponse) {
          console.error(`  Meta response:`, JSON.stringify(result.metaResponse, null, 2));
        }
        // Tetap update status ke 'pending' agar bisa dicoba manual
        await prisma.reservation.update({
          where: { id: txn.id },
          data: { purchase_review_status: 'pending' },
        });
        console.log(`  [DB] Status diupdate ke 'pending' untuk retry manual.`);
      }
    } catch (error: any) {
      console.error(`  [ERROR] Gagal memproses ${txn.customerName}:`, error.message);
    }
  }

  console.log('\n=== RECOVERY SELESAI ===');
}

recoverBlockedEvents()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
