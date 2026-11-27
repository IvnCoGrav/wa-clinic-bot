import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  aggregate: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    llmAuditLog: { aggregate: (...a: any[]) => h.aggregate(...a) },
  },
}));

import {
  assertCopilotDailyBudget,
  getCopilotDailyTokensUsed,
  estimateTurnTokens,
  maxTokensPerDay,
  recordCopilotTokens,
  resetCopilotBudgetCache,
} from '../../src/services/copilot/copilot-budget';
import { wibDayBoundsUtc } from '../../src/utils/wib-time';

describe('F6 — anggaran token harian Copilot', () => {
  beforeEach(() => {
    delete process.env.COPILOT_MAX_TOKENS_PER_DAY;
    resetCopilotBudgetCache();
    h.aggregate.mockReset();
  });

  afterEach(() => {
    delete process.env.COPILOT_MAX_TOKENS_PER_DAY;
    resetCopilotBudgetCache();
    vi.restoreAllMocks();
  });

  it('hanya menghitung trafik Copilot (task_type), bukan seluruh LLM tenant', async () => {
    h.aggregate.mockResolvedValue({ _sum: { prompt_tokens: 10, completion_tokens: 5 } });
    await getCopilotDailyTokensUsed('default-tenant');

    const arg = h.aggregate.mock.calls[0][0];
    expect(arg.where.task_type).toBe('AI_COPILOT_CHAT');
    expect(arg.where.tenant_id).toBe('default-tenant');
    const expected = wibDayBoundsUtc(0);
    expect(new Date(arg.where.created_at.gte).toISOString()).toBe(expected.start.toISOString());
    expect(new Date(arg.where.created_at.lte).toISOString()).toBe(expected.end.toISOString());
  });

  it('DB tertinggal (buffer audit) → pemakaian in-memory tetap menutup anggaran', async () => {
    process.env.COPILOT_MAX_TOKENS_PER_DAY = '1000';
    h.aggregate.mockResolvedValue({ _sum: { prompt_tokens: 0, completion_tokens: 0 } });
    recordCopilotTokens('default-tenant', 1500);

    const result = await assertCopilotDailyBudget('default-tenant', 10);
    expect(result.used).toBeGreaterThanOrEqual(1500);
    expect(result.allowed).toBe(false);
  });

  it('DB mati (offline) → fallback in-memory, bukan izin tanpa batas', async () => {
    process.env.COPILOT_MAX_TOKENS_PER_DAY = '5000';
    h.aggregate.mockRejectedValue(new Error('Database offline'));
    recordCopilotTokens('default-tenant', 4900);

    const allowed = await assertCopilotDailyBudget('default-tenant', 200);
    expect(allowed.used).toBe(4900);
    expect(allowed.allowed).toBe(false);
  });

  it('tenant lain tidak memakai anggaran tenant ini (isolasi)', async () => {
    h.aggregate.mockImplementation(async ({ where }: any) => ({
      _sum:
        where.tenant_id === 'tenant-a'
          ? { prompt_tokens: 100, completion_tokens: 20 }
          : { prompt_tokens: 0, completion_tokens: 0 },
    }));

    expect(await getCopilotDailyTokensUsed('tenant-a')).toBe(120);
    expect(await getCopilotDailyTokensUsed('tenant-b')).toBe(0);
  });

  it('estimasi per turn punya lantai overhead dan naik sesuai panjang riwayat', () => {
    expect(estimateTurnTokens('halo')).toBeGreaterThanOrEqual(2000);
    const withHistory = estimateTurnTokens('halo', [
      { content: 'x'.repeat(4000) },
      { content: 'y'.repeat(4000) },
    ]);
    expect(withHistory).toBeGreaterThan(estimateTurnTokens('halo'));
    expect(maxTokensPerDay()).toBe(500_000);
  });

  it('env tidak valid tidak boleh melemahkan plafon (fallback ke default)', () => {
    process.env.COPILOT_MAX_TOKENS_PER_DAY = '-1';
    expect(maxTokensPerDay()).toBe(500_000);
    process.env.COPILOT_MAX_TOKENS_PER_DAY = 'abc';
    expect(maxTokensPerDay()).toBe(500_000);
  });
});
