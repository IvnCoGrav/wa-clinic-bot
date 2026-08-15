import { describe, it, expect, afterEach } from 'vitest';
import {
  collectSystemInfo,
  collectAiRouterSummary,
  collectRecentMessages,
  collectConversationTrace,
  humanUptime,
} from '../../src/services/system-debug.service';

describe('System Debug Service', () => {
  afterEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.AI_ROUTER_ENABLED;
    delete process.env.AI_ROUTER_SHADOW_MODE;
  });

  it('humanUptime format', () => {
    expect(humanUptime(93784)).toBe('1d 2h 3m 4s');
    expect(humanUptime(59)).toBe('0d 0h 0m 59s');
  });

  it('collectSystemInfo: secret TIDAK bocor, flag default ON (router aktif shadow), tidak throw saat DB offline', async () => {
    process.env.LLM_API_KEY = 'SUPER_SECRET_XYZ';
    const info = await collectSystemInfo();
    const json = JSON.stringify(info);

    expect(json).not.toContain('SUPER_SECRET_XYZ');
    expect(info.secretKeysPresent).toContain('LLM_API_KEY');

    const routerFlag = info.featureFlags.find((f) => f.key === 'AI_ROUTER_ENABLED');
    expect(routerFlag?.value).toBe('unset');
    expect(info.aiRouter.enabled).toBe(true); // default ON per tenant
    expect(info.aiRouter.shadowMode).toBe(false); // default shadow OFF (mode aktif penuh)

    // DB di-mock offline di test → status bukan CONNECTED, tapi service tetap return (tidak throw)
    expect(['CONNECTED', 'FAILED', 'UNKNOWN']).toContain(info.database.status);
    expect(info.counts.customers).toBeNull();
  });

  it('collectSystemInfo: AI_ROUTER_ENABLED=true terbaca sebagai aktif', async () => {
    process.env.AI_ROUTER_ENABLED = 'true';
    process.env.AI_ROUTER_SHADOW_MODE = 'true';
    const info = await collectSystemInfo();
    const routerFlag = info.featureFlags.find((f) => f.key === 'AI_ROUTER_ENABLED');
    expect(routerFlag?.value).toBe(true);
    expect(info.aiRouter.enabled).toBe(true);
    expect(info.aiRouter.shadowMode).toBe(true);
  });

  it('collectAiRouterSummary: DB offline -> angka 0 + dbNote, tidak throw', async () => {
    const summary = await collectAiRouterSummary(7);
    expect(summary.allTotal).toBe(0);
    expect(summary.medicalMismatches).toEqual([]);
    expect(summary.recentEvaluations).toEqual([]);
    expect(summary.dbNote).toBeTruthy();
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
