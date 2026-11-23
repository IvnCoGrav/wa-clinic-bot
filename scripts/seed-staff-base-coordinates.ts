#!/usr/bin/env tsx
/**
 * seed-staff-base-coordinates.ts
 * Seeding koordinat titik awal (base) staf bidan dari data lokal gitignored.
 *
 * Usage:
 *   npx tsx scripts/seed-staff-base-coordinates.ts          # dry-run (simulasi)
 *   npx tsx scripts/seed-staff-base-coordinates.ts --apply  # eksekusi DB nyata
 *   npx tsx scripts/seed-staff-base-coordinates.ts --tenant=default-tenant --apply
 */

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';
import { auditService } from '../src/services/audit.service';

interface StaffBaseRecord {
  id: string;
  name?: string;
  baseAddress?: string;
  baseLat: number;
  baseLng: number;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = !apply;
  const tenantArg = args.find((a) => a.startsWith('--tenant='));
  const tenantId = tenantArg ? tenantArg.split('=')[1] : DEFAULT_TENANT_ID;

  console.log(`[SEED STAFF BASE] Mode: ${dryRun ? 'DRY-RUN (Simulasi)' : 'APPLY (Menulis ke DB)'}`);
  console.log(`[SEED STAFF BASE] Tenant: ${tenantId}`);

  const localFilePath = path.resolve(process.cwd(), 'data', 'staff-base.local.json');
  if (!fs.existsSync(localFilePath)) {
    console.error(`[SEED STAFF BASE] File data lokal tidak ditemukan di: ${localFilePath}`);
    console.error(`[SEED STAFF BASE] Buat file data/staff-base.local.json terlebih dahulu.`);
    process.exit(1);
  }

  let items: StaffBaseRecord[];
  try {
    const raw = fs.readFileSync(localFilePath, 'utf8');
    items = JSON.parse(raw);
    if (!Array.isArray(items)) {
      throw new Error('Data JSON harus berupa array objek.');
    }
  } catch (err: any) {
    console.error(`[SEED STAFF BASE] Gagal membaca JSON: ${err.message}`);
    process.exit(1);
  }

  console.log(`[SEED STAFF BASE] Ditemukan ${items.length} entri staf untuk diproses.`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const item of items) {
    if (!item.id || typeof item.baseLat !== 'number' || typeof item.baseLng !== 'number') {
      console.warn(`[SEED STAFF BASE] Skip entri tidak lengkap: ${JSON.stringify(item)}`);
      continue;
    }

    try {
      const staff = await (prisma as any).staff.findFirst({
        where: { id: item.id, tenant_id: tenantId },
        select: {
          id: true,
          name: true,
          base_lat: true,
          base_lng: true,
          base_address: true,
        },
      });

      if (!staff) {
        console.warn(`[SEED STAFF BASE] Staf ID ${item.id} (${item.name || 'Unknown'}) tidak ditemukan di tenant ${tenantId}.`);
        continue;
      }

      // Cek apakah data sudah sama (idempoten)
      const isAlreadySame =
        staff.base_lat === item.baseLat &&
        staff.base_lng === item.baseLng &&
        (staff.base_address || '') === (item.baseAddress || '');

      if (isAlreadySame) {
        console.log(`[SEED STAFF BASE] [IDEMPOTENT] ${staff.name} (${staff.id}) sudah memiliki koordinat base yang sama. Dilewati.`);
        skippedCount++;
        continue;
      }

      if (dryRun) {
        console.log(
          `[SEED STAFF BASE] [WOULD UPDATE] ${staff.name} (${staff.id}) -> Lat: ${item.baseLat}, Lng: ${item.baseLng}, Alamat: ${item.baseAddress || '-'}`
        );
        updatedCount++;
      } else {
        await (prisma as any).staff.update({
          where: { id: staff.id },
          data: {
            base_lat: item.baseLat,
            base_lng: item.baseLng,
            base_address: item.baseAddress || null,
          },
        });

        await auditService.logAdminAction({
          action: 'UPDATE_STAFF_BASE',
          adminIdentity: 'SYSTEM_SEED',
          tenantId,
          payload: {
            staffId: staff.id,
            staffName: staff.name,
            baseLat: item.baseLat,
            baseLng: item.baseLng,
            baseAddress: item.baseAddress || null,
          },
        });

        console.log(`[SEED STAFF BASE] [UPDATED] ${staff.name} (${staff.id}) berhasil diperbarui.`);
        updatedCount++;
      }
    } catch (err: any) {
      console.error(`[SEED STAFF BASE] Error saat memproses staf ${item.id}:`, err.message);
    }
  }

  console.log(`[SEED STAFF BASE] Selesai. Total diproses: ${items.length}, Diperbarui: ${updatedCount}, Dilewati: ${skippedCount}.`);
}

main()
  .catch((err) => {
    console.error('[SEED STAFF BASE] Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
