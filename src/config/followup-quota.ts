import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';
import { parsePositiveInt } from '../utils/env-numeric';
import { DEFAULT_FOLLOWUP_MAX_PER_DAY } from './followup-scheduling';

export async function getFollowUpMaxPerDay(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
  const envDefault = parsePositiveInt(process.env.FOLLOWUP_MAX_PER_DAY, DEFAULT_FOLLOWUP_MAX_PER_DAY);

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    const settings = (tenant?.settings && typeof tenant.settings === 'object' && !Array.isArray(tenant.settings))
      ? (tenant.settings as Record<string, any>)
      : null;

    const quotaSetting = settings?.followUpQuota?.maxPerDay;
    if (typeof quotaSetting === 'number' && Number.isInteger(quotaSetting) && quotaSetting >= 1 && quotaSetting <= 200) {
      return quotaSetting;
    }
  } catch (err: any) {
    // Fail-safe jika DB offline / Prisma mock test
  }

  return envDefault;
}
