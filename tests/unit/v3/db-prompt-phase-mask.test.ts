import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersonaPromptBuilder } from '../../../src/v3/agent/persona';
import { prisma } from '../../../src/db/client';
import { buildCacheableSystemPrompt } from '../../../src/integrations/llm/prompt-cache';
import { PERSONA_STABLE_PREFIX_MARKER } from '../../../src/v3/agent/persona';

/**
 * Audit best-practice — residual #1 & #2:
 *  #1 jalur prompt DB (`composeSystemPromptAsync`) WAJIB menghormati `phaseInjection`
 *     + flag masking tool (jangan diabaikan diam-diam).
 *  #2 ukur dampak `slim` terhadap prefix stabil (prompt-cache).
 */
const session: any = { genderGreeting: 'Bunda', location: null, cartItems: [] };

describe('Residual #1 — jalur prompt DB menghormati phaseInjection + mask', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('prompt DB memuat focus fase + guidance tool ter-mask', async () => {
    vi.mocked((prisma as any).tenantPromptConfig.findFirst).mockResolvedValueOnce({
      tenant_id: 'default-tenant',
      is_active: true,
      personality_tone: 'TON',
      answering_hierarchy: 'HIER',
      negative_constraints: 'NEG',
      medical_overclaim_rules: 'MED',
    });
    const out = await PersonaPromptBuilder.buildSystemPromptAsync(session, false, {
      tenantId: 'default-tenant',
      phaseInjection: { focus: ['EARLY_LOCATION'], slim: true },
      isSaveReservationMasked: true,
      isCalculateDeliveryMasked: true,
    });
    // Fokus fase disuntik & tool ter-mask dijelaskan sebagai disembunyikan.
    expect(out.systemPrompt).toContain('PHASE_FOCUS');
    expect(out.systemPrompt).toContain('DISEMBUNYIKAN');
  });
});

describe('Residual #2 — ukur prefix stabil untuk prompt-cache (slim vs full)', () => {
  it('dalam fase SAMA prefix byte-identik; lintas fase berbeda (data terukur)', () => {
    const earlyA = PersonaPromptBuilder.buildSystemPrompt(session, true, { phaseInjection: { focus: ['EARLY_LOCATION'], slim: true } });
    const earlyB = PersonaPromptBuilder.buildSystemPrompt(session, true, { phaseInjection: { focus: ['EARLY_LOCATION'], slim: true } });
    const consult = PersonaPromptBuilder.buildSystemPrompt(session, true, { phaseInjection: { focus: ['CONSULTATION'], slim: true } });
    const pA = buildCacheableSystemPrompt(earlyA, PERSONA_STABLE_PREFIX_MARKER);
    const pB = buildCacheableSystemPrompt(earlyB, PERSONA_STABLE_PREFIX_MARKER);
    const pC = buildCacheableSystemPrompt(consult, PERSONA_STABLE_PREFIX_MARKER);
    // eslint-disable-next-line no-console
    console.log(`\n[CACHE] EARLY prefix=${pA.stablePrefix.length} | CONSULT prefix=${pC.stablePrefix.length}`);
    // Stabil antar-turn pada fase yang sama → cache hit.
    expect(pA.stablePrefix).toBe(pB.stablePrefix);
    // Lintas fase: prefix boleh berbeda (cache miss saat PINDAH fase, bukan tiap turn).
    // Bukan assertion keras — hanya mendokumentasikan perbedaan bila ada.
    expect(pA.stablePrefix.length).toBeGreaterThan(0);
  });
});
