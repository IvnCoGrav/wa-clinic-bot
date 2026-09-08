import { PrismaClient } from '@prisma/client';
import { resolveTreatmentValue } from '../services/capi.service';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Starting Database Reservation Sanitizer ===');

  const reservations = await prisma.reservation.findMany({
    where: {
      OR: [
        { treatment_detail: { contains: 'Mohon' } },
        { treatment_detail: { contains: 'bisa diisi' } },
        { treatment_detail: { contains: 'Jika hamil' } },
        { treatment_detail: { contains: 'Jika ada' } },
      ],
    },
    include: {
      customer: {
        include: { children: true },
      },
    },
  });

  console.log(`Found ${reservations.length} reservations with template placeholder texts.`);

  let updatedCount = 0;

  for (const r of reservations) {
    const rawDetail = r.treatment_detail || '';
    const parts = rawDetail.split('|').map((p) => p.trim());
    const cleanParts = parts.filter((p) => {
      const low = p.toLowerCase();
      return (
        !low.includes('mohon bisa diisi') &&
        !low.includes('bisa diisi bunda') &&
        !low.includes('jika hamil') &&
        !low.includes('jika ada') &&
        !low.includes('opsional')
      );
    });

    const newTreatmentDetail = cleanParts.length > 0 ? cleanParts.join(' | ') : 'Treatment Homecare';
    const newValue = (await resolveTreatmentValue(newTreatmentDetail)) ?? r.purchase_value;

    console.log(`[RESERVATION ${r.id.slice(0, 8)}]`);
    console.log(`  BEFORE: "${rawDetail}" (Val: ${r.purchase_value})`);
    console.log(`  AFTER : "${newTreatmentDetail}" (Val: ${newValue})`);

    await prisma.reservation.update({
      where: { id: r.id },
      data: {
        treatment_detail: newTreatmentDetail,
        purchase_value: newValue,
      },
    });

    // Periksa apakah nama customer adalah "Bunda" generic dan punya nama anak
    if (r.customer && r.customer.name && r.customer.name.trim().toLowerCase() === 'bunda') {
      const childMatch = newTreatmentDetail.match(/Bayi:\s*([^,\s|)]+)/i);
      if (childMatch && childMatch[1] && childMatch[1] !== '-' && childMatch[1].toLowerCase() !== 'bayi') {
        const babyName = childMatch[1].trim();
        console.log(`  [CUSTOMER REPAIR] Updating customer ${r.customer.phone} name from "Bunda" -> "Bunda (${babyName})"`);
        await prisma.customer.update({
          where: { id: r.customer.id },
          data: { name: `Bunda (${babyName})` },
        });
      }
    }

    updatedCount++;
  }

  console.log(`\n✅ Successfully sanitized ${updatedCount} reservation records in database.`);
}

main()
  .catch((err) => {
    console.error('Error running reservation sanitizer:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
