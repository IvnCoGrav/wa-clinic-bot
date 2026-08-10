import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

/**
 * SEED DUMMY DATA — queue moderasi Purchase Meta CAPI (QA TEST).
 * Semua customer diberi is_sandbox_test=true (bisa dibersihkan via
 * /api/admin/sandbox/cleanup). JANGAN dipakai untuk data produksi.
 */
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

const dummyReservations = [
  {
    name: 'Dummy Bunda Sari',
    treatment: 'Pijat Bayi',
    raw: 'Bayi: Kenzie, Usia: 4 bulan',
    occurredAt: hoursAgo(1),
    review: 'pending',
  },
  {
    name: 'Dummy Bunda Dewi',
    treatment: 'Baby Massage',
    raw: 'Bayi: Alika, Usia: 6 bulan',
    occurredAt: hoursAgo(3),
    review: 'pending',
  },
  {
    name: 'Dummy Bunda Rina',
    treatment: 'Refleksi Bayi',
    raw: 'Bayi: Rafa, Usia: 8 bulan',
    occurredAt: hoursAgo(24),
    review: 'pending',
  },
  {
    name: 'Dummy Bunda Lestari',
    treatment: 'Pijat Bayi',
    raw: 'Bayi: Sakha, Usia: 2 bulan',
    occurredAt: hoursAgo(8 * 24), // >7 hari → approve akan diblokir, harus Mark as Outlier
    review: 'pending',
  },
  {
    name: 'Dummy Bunda Ayu',
    treatment: 'Pijat Ibu Nifas',
    raw: 'Ibu: Ayu, Nifas 3 minggu',
    occurredAt: hoursAgo(48),
    review: 'approved', // sudah terkirim ke Meta (badge hijau)
  },
  {
    name: 'Dummy Bunda Mila',
    treatment: 'Baby Spa',
    raw: 'Bayi: Naura, Usia: 5 bulan',
    occurredAt: hoursAgo(5 * 24),
    review: 'ignored_outlier', // sudah ditandai outlier (badge merah)
  },
];

(async () => {
  const created: Array<{ name: string; phone: string; reservationId: string }> = [];
  for (const [i, d] of dummyReservations.entries()) {
    const phone = '6281111' + String(2000 + i * 37);
    const customer = await prisma.customer.create({
      data: {
        tenant_id: DEFAULT_TENANT_ID,
        phone,
        name: d.name,
        is_sandbox_test: true,
      },
    });
    const reservation = await prisma.reservation.create({
      data: {
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: customer.id,
        treatment_category: 'BABY',
        treatment_detail: d.treatment,
        raw_text: d.raw,
        status: 'pending',
        booking_date: hoursAgo(1),
        purchase_occurred_at: d.occurredAt,
        purchase_review_status: d.review,
        purchase_event_sent_at: d.review === 'approved' ? hoursAgo(1) : null,
      },
    });
    created.push({ name: d.name, phone, reservationId: reservation.id });
  }
  console.log(JSON.stringify({ seeded: created.length, data: created }));
  await prisma.$disconnect();
})();
