import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const dbServices = await prisma.clinicService.findMany({
    where: { tenant_id: 'default-tenant' },
    orderBy: { sort_order: 'asc' },
  });

  const list = dbServices.map((s) => {
    let bundleItemIds: string[] | undefined = undefined;
    let isAddon = s.category === 'ADD_ON';
    let desc = s.description;

    const bundleMatch = desc.match(/\[BUNDLE:([^\]]+)\]/);
    if (bundleMatch) {
      bundleItemIds = bundleMatch[1].split(',').map((id) => id.trim()).filter(Boolean);
    }

    if (desc.includes('[ADDON]')) {
      isAddon = true;
    }

    const item: any = {
      id: s.service_id,
      name: s.name,
      category: s.category,
      serviceType:
        s.category === 'BUNDLE' || (bundleItemIds && bundleItemIds.length >= 2)
          ? 'BUNDLE'
          : s.category === 'ADD_ON' || isAddon
          ? 'ADD_ON'
          : 'STANDARD',
      ageTier: {
        minAgeMonths: s.min_age_months,
        maxAgeMonths: s.max_age_months,
        label: s.age_label,
      },
      durationMinutes: s.duration_minutes,
      originalPrice: s.original_price,
      promoPrice: s.promo_price,
      description: s.description,
      isActive: s.is_active,
    };

    if (bundleItemIds && bundleItemIds.length > 0) {
      item.bundleItemIds = bundleItemIds;
    }
    if (isAddon) {
      item.isAddon = true;
    }
    if (s.total_sessions) {
      item.totalSessions = s.total_sessions;
    }
    if (s.session_schedule_type) {
      item.sessionScheduleType = s.session_schedule_type;
    }

    return item;
  });

  const targetPath = path.join(process.cwd(), 'services_custom.json');
  fs.writeFileSync(targetPath, JSON.stringify(list, null, 2) + '\n', 'utf-8');
  console.log(`✅ Successfully exported ${list.length} services to ${targetPath}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
