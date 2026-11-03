import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveCopilotConfig, MAX_ITERATIONS, MAX_TOTAL_ROWS, DEFAULT_TOTAL_BUDGET_MS } from '../../src/services/copilot/copilot.service';

describe('resolveCopilotConfig (Fase 1 — config resolver)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.COPILOT_MODEL;
    delete process.env.COPILOT_TOTAL_BUDGET_MS;
    delete process.env.COPILOT_CALL_TIMEOUT_MS;
    delete process.env.COPILOT_MAX_ITERATIONS;
    delete process.env.COPILOT_MAX_TOTAL_ROWS;
    delete process.env.COPILOT_HEARTBEAT_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('mengembalikan nilai default sesuai kontrak P1 (GLM-5.3 Flash, budget 5 menit, attempt 90s)', () => {
    const cfg = resolveCopilotConfig();
    expect(cfg.model).toBe('glm-5.3-flash');
    expect(cfg.totalBudgetMs).toBe(300_000);
    expect(cfg.callTimeoutMs).toBe(90_000);
    expect(cfg.maxIterations).toBe(5);
    expect(cfg.maxTotalRows).toBe(60);
    expect(cfg.heartbeatMs).toBe(15_000);
  });

  it('menghormati override environment variables', () => {
    process.env.COPILOT_MODEL = 'glm-4-plus';
    process.env.COPILOT_TOTAL_BUDGET_MS = '180000';
    process.env.COPILOT_CALL_TIMEOUT_MS = '45000';
    process.env.COPILOT_MAX_ITERATIONS = '7';
    process.env.COPILOT_MAX_TOTAL_ROWS = '100';
    process.env.COPILOT_HEARTBEAT_MS = '10000';

    const cfg = resolveCopilotConfig();
    expect(cfg.model).toBe('glm-4-plus');
    expect(cfg.totalBudgetMs).toBe(180_000);
    expect(cfg.callTimeoutMs).toBe(45_000);
    expect(cfg.maxIterations).toBe(7);
    expect(cfg.maxTotalRows).toBe(100);
    expect(cfg.heartbeatMs).toBe(10_000);
  });

  it('kebal terhadap nilai env tidak valid / negatif / non-numeric', () => {
    process.env.COPILOT_TOTAL_BUDGET_MS = '-1000';
    process.env.COPILOT_CALL_TIMEOUT_MS = 'abc';
    process.env.COPILOT_MAX_ITERATIONS = '0';
    process.env.COPILOT_MAX_TOTAL_ROWS = 'undefined';
    process.env.COPILOT_HEARTBEAT_MS = 'null';

    const cfg = resolveCopilotConfig();
    expect(cfg.totalBudgetMs).toBe(300_000);
    expect(cfg.callTimeoutMs).toBe(90_000);
    expect(cfg.maxIterations).toBe(5);
    expect(cfg.maxTotalRows).toBe(60);
    expect(cfg.heartbeatMs).toBe(15_000);
  });

  it('konstanta exported tetap kompatibel', () => {
    expect(MAX_ITERATIONS).toBe(5);
    expect(MAX_TOTAL_ROWS).toBe(60);
    expect(DEFAULT_TOTAL_BUDGET_MS).toBe(300_000);
  });
});
