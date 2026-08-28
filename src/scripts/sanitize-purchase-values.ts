import { prisma } from '../db/client';
import { resolveTreatmentValue, extractValueByFormat } from '../services/capi.service';
import { extractRupiahAmount } from '../services/purchase-detection.service';
import { parsePaymentSection } from '../utils/conversation-transaction-extractor';

async function sanitizePurchaseValues() {
  console.log('========================================================');
  console.log('🔄 Memulai Sanitasi & Backfill Purchase Values Database');
  console.log('========================================================');

  const reservations = await prisma.reservation.findMany({
    where: {
      status: { not: 'cancelled' },
    },
    include: {
      customer: true,
    },
    orderBy: { created_at: 'desc' },
  });

  console.log(`Ditemukan total ${reservations.length} data reservasi aktif.`);

  let updatedCount = 0;
  let alreadyValidCount = 0;

  for (const r of reservations) {
    const raw = r.raw_text || '';
    let treatmentDetail = r.treatment_detail || '';

    // Sanitize placeholder texts
    if (
      treatmentDetail.includes('Mohon bisa diisi') ||
      treatmentDetail.includes('bisa diisi Bunda') ||
      treatmentDetail.toLowerCase().includes('jika hamil') ||
      treatmentDetail.toLowerCase().includes('jika ada')
    ) {
      const parts = treatmentDetail.split('|').map((p) => p.trim());
      const filtered = parts.filter((p) => {
        const low = p.toLowerCase();
        return (
          !low.includes('mohon bisa diisi') &&
          !low.includes('bisa diisi bunda') &&
          !low.includes('jika hamil') &&
          !low.includes('jika ada')
        );
      });
      treatmentDetail = filtered.length > 0 ? filtered.join(' | ') : 'Treatment Homecare';
    }

    let calculatedValue = r.purchase_value && r.purchase_value > 0 ? r.purchase_value : undefined;

    if (!calculatedValue) {
      if (raw && /payment|pembayaran|total\s*[:=]|treatment\s*[:=]/i.test(raw)) {
        const fin = parsePaymentSection(raw);
        if (fin.treatmentPrice > 0) calculatedValue = fin.treatmentPrice;
        else if (fin.totalPrice > 0) calculatedValue = Math.max(0, fin.totalPrice - fin.ongkir + fin.promo);
      }

      if (!calculatedValue) {
        calculatedValue =
          extractValueByFormat(raw, 'Treatment = %VALUE%') ??
          extractRupiahAmount(raw, 'Treatment = %VALUE%') ??
          (await resolveTreatmentValue(treatmentDetail || raw));
      }
    }

    const finalVal = calculatedValue ?? 60000;

    if (r.purchase_value !== finalVal) {
      await prisma.reservation.update({
        where: { id: r.id },
        data: { purchase_value: finalVal },
      });
      console.log(
        `[UPDATED] Reservasi ID: ${r.id.slice(0, 8)}... (${r.customer?.name || 'Customer'}) | Treatment: ${treatmentDetail.slice(0, 35)} | Nilai: ${r.purchase_value ?? 'NULL'} -> Rp ${finalVal.toLocaleString('id-ID')}`
      );
      updatedCount++;
    } else {
      alreadyValidCount++;
    }
  }

  console.log('========================================================');
  console.log(`✅ Sanitasi Selesai!`);
  console.log(`- Berhasil Diupdate: ${updatedCount} reservasi`);
  console.log(`- Sudah Valid Sebelumnya: ${alreadyValidCount} reservasi`);
  console.log('========================================================');
}

sanitizePurchaseValues()
  .catch((err) => {
    console.error('❌ Error saat sanitasi purchase values:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
