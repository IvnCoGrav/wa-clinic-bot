import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  customerFindMany: vi.fn(),
  callChat: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    customer: { findMany: h.customerFindMany },
  },
}));

vi.mock('../../src/integrations/llm/model-fallback', () => ({
  callChatCompletionsWithFallback: (...a: any[]) => h.callChat(...a),
}));

vi.mock('../../src/integrations/llm/llm-gateway', () => ({
  getLlmEndpointConfig: () => ({ model: 'test', fallbackModel: 'test', baseUrl: 'http://x', apiKey: 'k', timeoutMs: 1000 }),
}));

import { parseCopilotAllowlist, isCopilotTenantAllowed, COPILOT_DEPRECATED_ERROR } from '../../src/config/copilot-tenant';
import { copilotService } from '../../src/services/copilot/copilot.service';

/**
 * ADR-001 (single-tenant Copilot): gerbang deterministik fail-closed.
 * Menguji murni helper + guard service (tanpa DB/LLM nyata).
 */

describe('parseCopilotAllowlist — fail-closed', () => {
  it('env kosong → hanya default-tenant', () => {
    expect(parseCopilotAllowlist('')).toEqual(['default-tenant']);
    expect(parseCopilotAllowlist('   ')).toEqual(['default-tenant']);
    expect(parseCopilotAllowlist(',,,')).toEqual(['default-tenant']);
  });

  it('parse daftar, trim, buang entri kosong', () => {
    expect(parseCopilotAllowlist(' default-tenant , tenant-a ,, tenant-b ')).toEqual([
      'default-tenant',
      'tenant-a',
      'tenant-b',
    ]);
  });
});

describe('isCopilotTenantAllowed', () => {
  it('owner diizinkan dengan default env (tanpa konfigurasi)', () => {
    expect(isCopilotTenantAllowed('default-tenant', '')).toBe(true);
  });

  it('tenant lain ditolak saat allowlist hanya owner', () => {
    expect(isCopilotTenantAllowed('tenant-lain', 'default-tenant')).toBe(false);
  });

  it('tenantId null/undefined → dianggap owner', () => {
    expect(isCopilotTenantAllowed(null, 'default-tenant')).toBe(true);
    expect(isCopilotTenantAllowed(undefined, 'default-tenant')).toBe(true);
  });

  it('allowlist eksplisit multi-tenant (adversarial: spasi & koma)', () => {
    expect(isCopilotTenantAllowed('tenant-b', 'tenant-a,tenant-b')).toBe(true);
    expect(isCopilotTenantAllowed('tenant-c', 'tenant-a,tenant-b')).toBe(false);
  });

  it('wildcard `*` hanya bila ditulis eksplisit (test/dev), bukan default', () => {
    expect(isCopilotTenantAllowed('tenant-apa-saja', '*')).toBe(true);
    expect(isCopilotTenantAllowed('tenant-apa-saja', '')).toBe(false);
  });
});

describe('CopilotService.chat — gerbang single-tenant lapis service', () => {
  const ORIGINAL_ALLOWLIST = process.env.COPILOT_ALLOWED_TENANT_IDS;

  beforeEach(() => {
    // Suite wildcard global (tests/setup.ts) di-override agar default owner-only teruji.
    process.env.COPILOT_ALLOWED_TENANT_IDS = 'default-tenant';
    vi.resetAllMocks();
    h.customerFindMany.mockResolvedValue([]);
    h.callChat.mockResolvedValue({ data: { choices: [{ message: { content: '{"tool": null, "args": {}}' } }] } });
  });

  afterEach(() => {
    process.env.COPILOT_ALLOWED_TENANT_IDS = ORIGINAL_ALLOWLIST;
  });

  it('tenant non-owner → ditolak SEBELUM panggil tool/LLM', async () => {
    const res = await copilotService.chat({ tenantId: 'tenant-lain', message: 'jadwal besok siapa?' });
    expect(res.success).toBe(false);
    expect(res.error).toBe(COPILOT_DEPRECATED_ERROR);
    expect(res.llmCalls).toBe(0);
    expect(res.toolsUsed).toEqual([]);
    expect(h.callChat).not.toHaveBeenCalled();
    expect(h.customerFindMany).not.toHaveBeenCalled();
  });

  it('owner → lolos gerbang dan lanjut ke pipeline (router dipanggil)', async () => {
    const res = await copilotService.chat({ tenantId: 'default-tenant', message: 'halo' });
    expect(res.error).not.toBe(COPILOT_DEPRECATED_ERROR);
    expect(h.callChat).toHaveBeenCalled();
  });
});
