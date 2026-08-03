import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { IdleGreetingConfigService } from '../../src/config/idle-greeting.config';
import { prisma } from '../../src/db/client';

describe('IdleGreetingConfigService', () => {
  const tenantId = 'default-tenant';

  beforeEach(() => {
    vi.restoreAllMocks();
    IdleGreetingConfigService.clearCache();
    delete process.env.IDLE_GREETING_ENABLED;
    delete process.env.IDLE_GREETING_MIN_HOURS;
  });

  afterEach(() => {
    delete process.env.IDLE_GREETING_ENABLED;
    delete process.env.IDLE_GREETING_MIN_HOURS;
  });

  it('default: enabled + 36 jam saat DB offline', () => {
    expect(IdleGreetingConfigService.getConfig(tenantId)).toEqual({ enabled: true, minHours: 36 });
    expect(IdleGreetingConfigService.isEnabled(tenantId)).toBe(true);
    expect(IdleGreetingConfigService.getMinHours(tenantId)).toBe(36);
  });

  it('loadConfigsFromDb mengisi cache dari kolom tenant', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({ idle_greeting_enabled: false, idle_greeting_min_hours: 48 } as any);

    await IdleGreetingConfigService.loadConfigsFromDb(tenantId);

    expect(IdleGreetingConfigService.getConfig(tenantId)).toEqual({ enabled: false, minHours: 48 });
    expect(IdleGreetingConfigService.isEnabled(tenantId)).toBe(false);
    expect(IdleGreetingConfigService.getMinHours(tenantId)).toBe(48);
  });

  it('env fallback dipakai saat cache kosong', () => {
    process.env.IDLE_GREETING_ENABLED = 'false';
    process.env.IDLE_GREETING_MIN_HOURS = '72';

    expect(IdleGreetingConfigService.getConfig(tenantId)).toEqual({ enabled: false, minHours: 72 });
  });

  it('saveConfig menulis ke DB dan cache', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({ id: tenantId } as any);
    const updateSpy = vi.spyOn(prisma.tenant, 'update').mockResolvedValue({} as any);

    await IdleGreetingConfigService.saveConfig(tenantId, { enabled: false, minHours: 24 });

    expect(IdleGreetingConfigService.getConfig(tenantId)).toEqual({ enabled: false, minHours: 24 });
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: tenantId },
      data: { idle_greeting_enabled: false, idle_greeting_min_hours: 24 },
    });
  });
});
