import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AiModelConfigService } from '../../src/config/ai-models.config';
import { DistributedKv } from '../../src/utils/distributed-kv';

/** CFG-17: simpan konfigurasi AI wajib memakai lease lintas proses. */
describe('AiModelConfigService save lock (CFG-17)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('membungkus penyimpanan dengan lock tenant di KV bersama', async () => {
    const innerSpy = vi
      .spyOn(AiModelConfigService as any, 'saveConfigsToDbInner')
      .mockResolvedValue(true);
    const lockSpy = vi.spyOn(DistributedKv.prototype, 'withLock');

    await expect(AiModelConfigService.saveConfigsToDb('tenant-lock')).resolves.toBe(true);

    expect(innerSpy).toHaveBeenCalledTimes(1);
    expect(lockSpy).toHaveBeenCalledWith(
      'lock:ai-config-save:tenant-lock',
      expect.any(Number),
      expect.any(Function),
      { waitMs: 10_000 }
    );
  });

  it('tiga penyimpanan bersamaan tetap serial (tidak saling menimpa)', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;

    vi.spyOn(AiModelConfigService as any, 'saveConfigsToDbInner').mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls += 1;
      await new Promise((r) => setTimeout(r, 25));
      active -= 1;
      return true;
    });

    const results = await Promise.all([
      AiModelConfigService.saveConfigsToDb('tenant-serial'),
      AiModelConfigService.saveConfigsToDb('tenant-serial'),
      AiModelConfigService.saveConfigsToDb('tenant-serial'),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(calls).toBe(3);
    expect(maxActive).toBe(1);
  });

  it('hasil false dari penyimpanan diteruskan apa adanya (bukan sukses palsu)', async () => {
    vi.spyOn(AiModelConfigService as any, 'saveConfigsToDbInner').mockResolvedValue(false);
    await expect(AiModelConfigService.saveConfigsToDb('tenant-gagal')).resolves.toBe(false);
  });

  it('tenant berbeda tidak memblokir satu sama lain', async () => {
    const lockSpy = vi.spyOn(DistributedKv.prototype, 'withLock');
    vi.spyOn(AiModelConfigService as any, 'saveConfigsToDbInner').mockResolvedValue(true);

    await Promise.all([
      AiModelConfigService.saveConfigsToDb('tenant-a'),
      AiModelConfigService.saveConfigsToDb('tenant-b'),
    ]);

    const keys = lockSpy.mock.calls.map((c) => c[0]);
    expect(keys).toContain('lock:ai-config-save:tenant-a');
    expect(keys).toContain('lock:ai-config-save:tenant-b');
  });
});
