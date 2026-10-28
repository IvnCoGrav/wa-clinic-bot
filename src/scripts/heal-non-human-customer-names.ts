import { prisma } from '../db/client';
import { isGenericCustomerName, sanitizeCustomerNameForStorage } from '../utils/name-sanitizer';
import { parseReservationText } from '../utils/reservation-text-parser';

interface HealAction {
  customerId: string;
  phone: string;
  oldName: string;
  newName: string | null;
  reason: string;
}

async function main() {
  const isCommit = process.argv.includes('--commit');
  console.log('================================================================');
  console.log(`[HEAL CUSTOMER NAMES] Mode: ${isCommit ? 'COMMIT (MENULIS KE DB)' : 'DRY-RUN (READ-ONLY)'}`);
  console.log('================================================================\n');

  const customers = await prisma.customer.findMany({
    where: {
      name: { not: null },
    },
    include: {
      reservations: {
        orderBy: { created_at: 'desc' },
      },
    },
  });

  console.log(`📋 Memeriksa ${customers.length} customer dengan nama terisi di DB...\n`);

  const actions: HealAction[] = [];

  for (const cust of customers) {
    const currentName = cust.name;
    if (!currentName) continue;

    // Cek apakah nama saat ini terdeteksi sebagai generic / handle non-manusia
    if (isGenericCustomerName(currentName)) {
      // 1. Coba cari nama sah dari riwayat reservasi pelanggan
      let recoveredName: string | null = null;
      for (const res of cust.reservations) {
        if (res.raw_text) {
          const parsed = parseReservationText(res.raw_text);
          if (parsed.success && parsed.reservation?.name) {
            const candidate = sanitizeCustomerNameForStorage(parsed.reservation.name);
            if (candidate && !isGenericCustomerName(candidate)) {
              recoveredName = candidate;
              break;
            }
          }
        }
      }

      const newName = recoveredName ? (recoveredName.toLowerCase().startsWith('bunda ') || recoveredName.toLowerCase().startsWith('ayah ') ? recoveredName : `Bunda ${recoveredName}`) : null;

      actions.push({
        customerId: cust.id,
        phone: cust.phone,
        oldName: currentName,
        newName,
        reason: recoveredName ? 'Dipulihkan dari form reservasi riil' : 'Dinetralkan ke null (handle/simbol/sapaan generik tanpa nama)',
      });
    }
  }

  console.log(`🔍 Ditemukan ${actions.length} customer dengan nama non-definitif/terkontaminasi:\n`);
  for (const act of actions) {
    console.log(`- [${act.phone}] "${act.oldName}" -> ${act.newName ? `"${act.newName}"` : 'null'} (${act.reason})`);
  }

  if (isCommit && actions.length > 0) {
    console.log('\n💾 Menyimpan perubahan ke basis data...');
    let updatedCount = 0;
    for (const act of actions) {
      await prisma.customer.update({
        where: { id: act.customerId },
        data: { name: act.newName },
      });

      // Audit log entry
      try {
        await prisma.auditLog.create({
          data: {
            tenant_id: 'default-tenant',
            admin_key: 'SYSTEM_NAME_HEALER',
            admin_identity: 'System (Heal Customer Names)',
            action: 'HEAL_NON_HUMAN_CUSTOMER_NAME',
            target_id: act.customerId,
            payload: JSON.stringify({
              phone: act.phone,
              oldName: act.oldName,
              newName: act.newName,
              reason: act.reason,
            }),
          },
        });
      } catch (_) {}

      updatedCount++;
    }
    console.log(`\n✅ Berhasil memperbarui ${updatedCount} profil customer di database.`);
  } else if (!isCommit && actions.length > 0) {
    console.log('\n💡 Jalankan dengan argumen --commit untuk menerapkan perubahan di atas ke database.');
  } else {
    console.log('\n✅ Semua nama customer di database sudah bersih dan definitif. Tidak ada aksi yang diperlukan.');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Error executing heal script:', err);
  process.exit(1);
});
