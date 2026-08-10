import { prisma } from '../src/db/client';
import { maybeFirePurchaseEvent } from '../src/services/purchase-detection.service';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

(async () => {
  const phone = '6280000' + String(Math.floor(Math.random() * 90000 + 10000));
  const customer = await prisma.customer.create({
    data: {
      tenant_id: DEFAULT_TENANT_ID,
      phone,
      name: 'QA Moderation Test',
      is_sandbox_test: true,
    },
  });
  const reservation = await prisma.reservation.create({
    data: {
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: customer.id,
      treatment_category: 'BABY',
      treatment_detail: 'Pijat Bayi',
      raw_text: 'Bayi: Naya, Usia: 3 bulan',
      status: 'pending',
    },
  });

  const fired = await maybeFirePurchaseEvent({
    customer: { id: customer.id, phone, name: 'QA Moderation Test' },
    conversation: {},
    text: 'Payment 250000',
    tenantId: DEFAULT_TENANT_ID,
  });

  const after = await prisma.reservation.findUnique({
    where: { id: reservation.id },
    select: {
      id: true,
      purchase_occurred_at: true,
      purchase_review_status: true,
      purchase_event_sent_at: true,
    },
  });
  console.log(JSON.stringify({ customerId: customer.id, fired, after }));
  await prisma.$disconnect();
})();
