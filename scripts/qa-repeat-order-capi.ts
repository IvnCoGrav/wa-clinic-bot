/**
 * QA live: verifikasi repeat order CAPI (DUAL_EVENT → ReturningCustomerPurchase +
 * customer_segmentation existing_customer_to_business) di akun Meta riil.
 *
 * Pemakaian:
 *   npx tsx scripts/qa-repeat-order-capi.ts            # buat data QA + kirim event (dev/offline)
 *   npx tsx scripts/qa-repeat-order-capi.ts --cleanup  # hapus data QA saja
 *
 * Di server produksi, harus dijalankan DI DALAM container app (dist CJS):
 *   docker compose cp /tmp/qa-host.cjs app:/tmp/qa.cjs
 *   docker compose exec -T app node /tmp/qa.cjs
 * (kompilasi: npx tsc scripts/qa-repeat-order-capi.ts atau tulis versi CJS manual).
 *
 * Safeguard: customer QA dibuat dengan nama/nomor di luar pola dummy-filter
 * (is_sandbox_test=false) supaya lolos CAPI GUARD dan benar-benar sampai ke Meta.
 * Data QA hanya 1 customer + 2 reservasi; --cleanup menghapusnya.
 */

'use strict';

import { PrismaClient } from '@prisma/client';
import { capiService } from '../src/services/capi.service';

const prisma = new PrismaClient();
const QA_PHONE = '628810000001';
const QA_NAME = 'QA Repeat CAPI';
const TENANT = 'default-tenant';

async function cleanup() {
  const cust = await prisma.customer.findFirst({ where: { phone: QA_PHONE, name: QA_NAME } });
  if (cust) {
    if (!cust.name || cust.name !== QA_NAME) throw new Error('Refuse to delete non-QA customer');
    await prisma.reservation.deleteMany({ where: { customer_id: cust.id } });
    await prisma.customer.delete({ where: { id: cust.id } });
    console.log(`[QA] Data QA dihapus (customer ${cust.id} + reservasi).`);
  } else {
    console.log('[QA] Tidak ada data QA.');
  }
}

async function main() {
  if (process.argv.includes('--cleanup')) {
    await cleanup();
    return;
  }
  await cleanup(); // idempotent: mulai dari kondisi bersih

  const customer = await prisma.customer.create({
    data: {
      phone: QA_PHONE,
      name: QA_NAME,
    },
  });

  const now = new Date();
  const past = new Date(now.getTime() - 40 * 24 * 3600 * 1000);
  const future = new Date(now.getTime() + 1 * 24 * 3600 * 1000);

  // Reservasi #1 (40 hari lalu, completed & Purchase terkonfirmasi) → menyebabkan order #2 dihitung REPEAT
  const r1 = await prisma.reservation.create({
    data: {
      customer_id: customer.id,
      treatment_category: 'MOMS',
      treatment_detail: 'QA Repeat CAPI - order pertama',
      booking_date: past,
      status: 'completed',
      purchase_event_sent_at: past,
      purchase_occurred_at: past,
      purchase_value: 150000,
      purchase_review_status: 'approved',
      raw_text: 'QA Repeat CAPI fixture order-1',
    },
  });

  // Reservasi #2 (repeat order uji)
  const r2 = await prisma.reservation.create({
    data: {
      customer_id: customer.id,
      treatment_category: 'MOMS',
      treatment_detail: 'QA Repeat CAPI - repeat order uji',
      booking_date: future,
      status: 'confirmed',
      purchase_review_status: 'approved',
      raw_text: 'QA Repeat CAPI fixture order-2 (REPEAT)',
    },
  });

  console.log(`[QA] customer=${customer.id} r1=${r1.id} r2=${r2.id}`);

  const result = await capiService.sendCapiEvent({
    eventName: 'Purchase',
    customer: { ...customer, id: customer.id },
    value: 150000,
    currency: 'IDR',
    tenantId: TENANT,
    reservationId: r2.id,
  });

  const firstEvent = (result.sentPayload?.data || [])[0] || {};
  const report = {
    success: result.success,
    skipped: result.skipped,
    policy: result.policy,
    metaEventName: firstEvent.event_name,
    eventId: firstEvent.event_id,
    action_source: firstEvent.action_source,
    customer_segmentation: firstEvent.custom_data?.customer_segmentation,
    is_repeat_order: firstEvent.custom_data?.is_repeat_order,
    order_id: firstEvent.custom_data?.order_id,
    order_number: firstEvent.custom_data?.order_number,
    prior_orders_count: firstEvent.custom_data?.prior_orders_count,
    events_received: result.events_received,
    metaMessages: result.metaResponse?.messages || result.message,
    fbtrace_id: result.fbtrace_id,
    alternate_event: !!result.metaResponse?.events_received_formatted,
  };
  console.log('[QA RESULT] ' + JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error('[QA] Gagal:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
