import { describe, it, expect, afterEach } from 'vitest';
import {
  collectSystemInfo,
  collectRecentMessages,
  collectConversationTrace,
  humanUptime,
} from '../../src/services/system-debug.service';

describe('System Debug Service', () => {
  afterEach(() => {
    delete process.env.LLM_API_KEY;
  });

  it('humanUptime format', () => {
    expect(humanUptime(93784)).toBe('1d 2h 3m 4s');
    expect(humanUptime(59)).toBe('0d 0h 0m 59s');
  });

  it('collectSystemInfo: secret TIDAK bocor, flags bebas AI Router, tidak throw saat DB offline', async () => {
    process.env.LLM_API_KEY = 'SUPER_SECRET_XYZ';
    const info = await collectSystemInfo();
    const json = JSON.stringify(info);

    expect(json).not.toContain('SUPER_SECRET_XYZ');
    expect(info.secretKeysPresent).toContain('LLM_API_KEY');

    // AI Router sudah didekomisioning — flag/field router tidak boleh tersisa di payload.
    expect(info.featureFlags.find((f) => f.key === 'AI_ROUTER_ENABLED')).toBeUndefined();
    expect((info as any).aiRouter).toBeUndefined();
    expect((info as any).counts?.aiRouterEvaluations).toBeUndefined();

    // DB di-mock offline di test → status bukan CONNECTED, tapi service tetap return (tidak throw)
    expect(['CONNECTED', 'FAILED', 'UNKNOWN']).toContain(info.database.status);
    expect(info.counts.customers).toBeNull();
  });

  it('collectSystemInfo: flag fitur aktif tetap terbaca', async () => {
    process.env.WAHA_MOCK = 'true';
    const info = await collectSystemInfo();
    const flag = info.featureFlags.find((f) => f.key === 'WAHA_MOCK');
    expect(flag?.value).toBe(true);
    delete process.env.WAHA_MOCK;
  });

  it('collectRecentMessages: DB offline -> entries kosong + dbNote', async () => {
    const res = await collectRecentMessages(10);
    expect(res.entries).toEqual([]);
    expect(res.dbNote).toBeTruthy();
  });

  it('collectConversationTrace: DB offline -> entries kosong + dbNote', async () => {
    const res = await collectConversationTrace(10);
    expect(res.entries).toEqual([]);
    expect(res.dbNote).toBeTruthy();
  });
});
