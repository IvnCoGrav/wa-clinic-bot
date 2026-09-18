import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PLAN 8 FASE 2c — verifikasi ClinicPolicy DB-first dengan fallback sengaja.
 * Membuktikan: DB terisi → jawaban DB; DB kosong → fallback; DB error → fallback tanpa throw.
 */

const findUnique = vi.fn();

vi.mock('../../src/db/client', () => ({
  prisma: {
    clinicPolicy: {
      findUnique: (...args: any[]) => findUnique(...args),
    },
  },
}));

async function loadTool() {
  vi.resetModules();
  const mod = await import('../../src/v3/tools/clinic-faq.tool');
  mod.clearClinicPolicyCache('t-2c');
  return mod;
}

describe('FASE 2c — ClinicPolicy DB-first', () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it('DB terisi & aktif → jawaban dari DB, bukan fallback', async () => {
    findUnique.mockResolvedValue({
      factual_summary: 'DB_FACT',
      suggested_reply: 'DB_REPLY',
      is_active: true,
    });
    const tool = await loadTool();
    const out = await tool.executeGetClinicFaq({ topic: 'operational_hours_and_booking' } as any, 't-2c');
    expect(out.factualSummary).toBe('DB_FACT');
    expect(out.suggestedReply).toBe('DB_REPLY');
  });

  it('DB kosong (null) → fallback statis', async () => {
    findUnique.mockResolvedValue(null);
    const tool = await loadTool();
    const out = await tool.executeGetClinicFaq({ topic: 'operational_hours_and_booking' } as any, 't-2c');
    expect(out.factualSummary.length).toBeGreaterThan(0);
    expect(out.factualSummary).not.toBe('DB_FACT');
  });

  it('DB non-aktif → fallback statis', async () => {
    findUnique.mockResolvedValue({ factual_summary: 'X', suggested_reply: 'Y', is_active: false });
    const tool = await loadTool();
    const out = await tool.executeGetClinicFaq({ topic: 'operational_hours_and_booking' } as any, 't-2c');
    expect(out.factualSummary).not.toBe('X');
  });

  it('adversarial: DB error → fallback tanpa throw', async () => {
    findUnique.mockRejectedValue(new Error('Database offline'));
    const tool = await loadTool();
    await expect(
      tool.executeGetClinicFaq({ topic: 'operational_hours_and_booking' } as any, 't-2c')
    ).resolves.toMatchObject({ success: true });
  });

  it('parity: seluruh 7 topik punya fallback statis lengkap (guard kelengkapan seed DB)', async () => {
    findUnique.mockResolvedValue(null);
    const tool = await loadTool();
    const expectedTopics = [
      'therapist_qualification',
      'payment_methods',
      'multi_child_transport',
      'post_vaccine_rules',
      'homebase_and_coverage',
      'operational_hours_and_booking',
      'general_homecare_info',
    ];
    const fallbacks = tool.getStaticFallbackTopics();
    expect(fallbacks.length).toBe(expectedTopics.length);
    for (const t of expectedTopics) {
      const out = await tool.executeGetClinicFaq({ topic: t } as any, 't-parity');
      expect(out.success, `topic ${t}`).toBe(true);
      expect(out.topic, `topic ${t}`).toBe(t);
      expect(out.factualSummary.trim().length, `factualSummary ${t}`).toBeGreaterThan(0);
      expect(out.suggestedReply.trim().length, `suggestedReply ${t}`).toBeGreaterThan(0);
    }
  });
});
