import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cronService } from '../../src/services/cron.service';

describe('CronService Maintenance — Auto-Purge LegacyStaging', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('purgeOldLegacyStaging dipanggil tanpa melempar exception saat DB offline / fallback', async () => {
    await expect(cronService.purgeOldLegacyStaging()).resolves.not.toThrow();
  });
});
