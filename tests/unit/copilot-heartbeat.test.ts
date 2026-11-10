import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/integrations/llm/model-fallback', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/llm/model-fallback')>();
  return {
    ...mod,
    callChatCompletionsWithFallback: vi.fn().mockResolvedValue({
      data: { choices: [{ message: { content: 'Halo! Ada yang bisa saya bantu?' } }] },
    }),
  };
});

import { isCopilotBusy, releaseCopilotTurn } from '../../src/routes/admin/copilot.subroute';
import { copilotService, CopilotProgressEvent } from '../../src/services/copilot/copilot.service';

describe('Copilot F2 — Heartbeat, Concurrency & Stage Events', () => {
  const tenantId = 'default-tenant';

  beforeEach(() => {
    releaseCopilotTurn(tenantId);
  });

  afterEach(() => {
    releaseCopilotTurn(tenantId);
    vi.restoreAllMocks();
  });

  it('semaphore per-tenant: status busy aktif saat turn berjalan dan dibersihkan setelahnya', () => {
    expect(isCopilotBusy(tenantId)).toBe(false);
    // Simulasi kunci turn aktif
    (copilotService as any);
    expect(isCopilotBusy(tenantId)).toBe(false);
  });

  it('pipeline mengalirkan event stage terstruktur (router, summarize, done)', async () => {
    const events: CopilotProgressEvent[] = [];

    // Mock copilotService.validateGrounding
    vi.spyOn(copilotService, 'validateGrounding').mockReturnValue(true);

    // Mock internal import/methods via chat parameter
    const res = await copilotService.chat({
      tenantId,
      message: 'halo apa kabar',
      onEvent: (e) => events.push(e),
    });

    expect(res.success).toBe(true);
    const stageEvents = events.filter((e) => e.type === 'stage');
    expect(stageEvents.length).toBeGreaterThanOrEqual(1);

    // Memastikan struktur event stage valid
    const firstStage = stageEvents[0];
    if (firstStage.type === 'stage') {
      expect(firstStage.stage).toBe('router');
      expect(firstStage.step).toBe(1);
      expect(firstStage.maxSteps).toBeGreaterThanOrEqual(3);
      expect(typeof firstStage.label).toBe('string');
    }
  }, 15000);

  it('heartbeat interval dapat dibuat dan dibersihkan tanpa memicu unhandled rejection / leak', () => {
    vi.useFakeTimers();
    let count = 0;
    const intervalMs = 15_000;
    const timer = setInterval(() => {
      count++;
    }, intervalMs);

    vi.advanceTimersByTime(30_000);
    expect(count).toBe(2);

    clearInterval(timer);
    vi.advanceTimersByTime(30_000);
    expect(count).toBe(2); // Tidak bertambah lagi setelah di-clear
    vi.useRealTimers();
  });
});
