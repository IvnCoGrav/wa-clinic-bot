import { prisma } from '../db/client';
import { isGenericCustomerName, sanitizeCustomerNameForStorage } from '../utils/name-sanitizer';
import { parseReservationText } from '../utils/reservation-text-parser';
import { toTitleCasePreservingPrefix } from '../utils/customer-name-healing';
import { maskPhoneNumber } from '../utils/pii-masker';
import * as fs from 'fs';

interface HealAction {
  customerId: string;
  tenantId: string;
  phone: string;
  oldName: string;
  newName: string | null;
  newSource: string | null;
  actionClass: 'A' | 'B' | 'C';
  reason: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      if (val !== undefined) {
        options[key] = val;
      } else {
        options[key] = true;
      }
    }
  }

  return {
    tenantId: (options.tenant as string) || null,
    limit: options.limit ? Number(options.limit) : null,
    exportPath: (options.export as string) || null,
    commit: Boolean(options.commit),
  };
}

async function main() {
  const params = parseArgs();
  console.log('================================================================');
  console.log(`[HEAL CUSTOMER NAMES] Target Tenant: ${params.tenantId || 'SEMUA TENANT'}`);
  console.log(`[HEAL CUSTOMER NAMES] Mode: ${params.commit ? 'COMMIT (MENULIS KE DB)' : 'DRY-RUN (READ-ONLY)'}`);
  console.log('================================================================\n');

  const customers = await prisma.customer.findMany({
    where: {
      name: { not: null },
      ...(params.tenantId ? { tenant_id: params.tenantId } : {}),
    },
    include: {
      reservations: {
        where: { status: { not: 'cancelled' } },
        orderBy: { created_at: 'desc' },
        select: { raw_text: true },
      },
    },
    ...(params.limit ? { take: params.limit } : {}),
  });

  console.log(`📋 Memeriksa ${customers.length} customer di DB...\n`);

  const actions: HealAction[] = [];

  for (const cust of customers) {
    const currentName = cust.name;
    if (!currentName || !currentName.trim()) continue;

    const isGeneric = isGenericCustomerName(currentName, { strictPushnameGate: true });

    if (isGeneric) {
      // Kelas A: Coba cari nama sah dari riwayat reservasi pelanggan
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

      if (recoveredName) {
        const formatted = toTitleCasePreservingPrefix(recoveredName);
        const newName = formatted.toLowerCase().startsWith('bunda ') || formatted.toLowerCase().startsWith('ayah ')
          ? formatted
          : `Bunda ${formatted}`;

        actions.push({
          customerId: cust.id,
          tenantId: cust.tenant_id,
          phone: cust.phone,
          oldName: currentName,
          newName,
          newSource: 'reservation',
          actionClass: 'A',
          reason: 'Kelas A: Nama generic/handle dipulihkan dari form reservasi riil',
        });
      } else {
        // Kelas C: generic tanpa reservasi valid -> dinetralkan ke null
        actions.push({
          customerId: cust.id,
          tenantId: cust.tenant_id,
          phone: cust.phone,
          oldName: currentName,
          newName: null,
          newSource: null,
          actionClass: 'C',
          reason: 'Kelas C: Handle/simbol/sapaan generic tanpa riwayat reservasi valid dinetralkan ke null',
        });
      }
    } else {
      // Kelas B: nama valid tapi format bukan Title Case (mis. "Bunda anggi zulfika")
      const titleCased = toTitleCasePreservingPrefix(currentName);
      if (titleCased !== currentName) {
        actions.push({
          customerId: cust.id,
          tenantId: cust.tenant_id,
          phone: cust.phone,
          oldName: currentName,
          newName: titleCased,
          newSource: (cust as any).name_source || 'reservation',
          actionClass: 'B',
          reason: 'Kelas B: Format kapitalisasi dirapikan ke Title Case',
        });
      }
    }
  }

  console.log(`🔍 Ditemukan ${actions.length} customer yang memerlukan tindakan healing:\n`);
  for (const act of actions) {
    console.log(`- [${maskPhoneNumber(act.phone)}] [${act.actionClass}] "${act.oldName}" -> ${act.newName ? `"${act.newName}"` : 'null'} (${act.reason})`);
  }

  if (params.exportPath) {
    fs.writeFileSync(params.exportPath, JSON.stringify(actions, null, 2), 'utf8');
    console.log(`\n📁 Data aksi diekspor ke: ${params.exportPath}`);
  }

  if (!params.commit) {
    console.log('\n[DRY RUN] Tidak ada perubahan data yang disimpan. Tambahkan flag --commit untuk mengeksekusi.');
    try { await prisma.$disconnect(); } catch {}
    return;
  }

  if (actions.length > 0) {
    console.log('\n💾 Menyimpan perubahan ke basis data...');
    let updatedCount = 0;

    for (const act of actions) {
      await prisma.$transaction(async (tx) => {
        await tx.customer.update({
          where: { id: act.customerId },
          data: {
            name: act.newName,
            name_source: act.newSource,
          },
        });

        await tx.auditLog.create({
          data: {
            tenant_id: act.tenantId,
            admin_key: 'SYSTEM_NAME_HEALER',
            admin_identity: 'System (Heal Customer Names)',
            action: 'HEAL_NON_HUMAN_CUSTOMER_NAME',
            target_id: act.customerId,
            payload: JSON.stringify({
              phoneMasked: maskPhoneNumber(act.phone),
              actionClass: act.actionClass,
              oldName: act.oldName,
              newName: act.newName,
              newSource: act.newSource,
              reason: act.reason,
            }),
          },
        });
      });

      updatedCount++;
    }

    console.log(`\n✅ Berhasil memperbarui dan mengaudit ${updatedCount} customer.`);
  }

  try { await prisma.$disconnect(); } catch {}
}

main().catch(async (e) => {
  console.error('[HEAL CUSTOMER NAMES] Error:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
