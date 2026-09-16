import { describe, it, expect } from 'vitest';
import { buildCacheableSystemPrompt, buildCachedMessages } from '../../src/integrations/llm/prompt-cache';
import { PersonaPromptBuilder, PERSONA_STABLE_PREFIX_MARKER } from '../../src/v3/agent/persona';
import type { CustomerGoalSession } from '../../src/v3/state/goal-tracker';

/**
 * PLAN 9 FASE 9.1 — prompt caching seam.
 *
 * Menguji: pemisahan prefix stabil, no-op aman untuk provider tak dikenal,
 * anotasi cache untuk provider yang mendukung, dan invarian byte-stabil
 * pada prompt persona nyata.
 */

function baseSession(): CustomerGoalSession {
  return {
    genderGreeting: 'Bunda',
    children: [{ ageMonths: 2, symptoms: ['pilek'] }],
  };
}

describe('FASE 9.1 — prompt-cache seam', () => {
  it('memisahkan prompt pada marker', () => {
    const parts = buildCacheableSystemPrompt('AAA__MARK__BBB', '__MARK__');
    expect(parts.stablePrefix).toBe('AAA');
    expect(parts.volatileSuffix).toBe('__MARK__BBB');
  });

  it('adversarial: marker tidak ditemukan → seluruh prompt volatil (aman, tanpa cache)', () => {
    const parts = buildCacheableSystemPrompt('AAA BBB', '__MISSING__');
    expect(parts.stablePrefix).toBe('');
    expect(parts.volatileSuffix).toBe('AAA BBB');
  });

  it('adversarial: marker di awal (idx 0) → tidak ada prefix stabil', () => {
    const parts = buildCacheableSystemPrompt('__MARK__rest', '__MARK__');
    expect(parts.stablePrefix).toBe('');
    expect(parts.volatileSuffix).toBe('__MARK__rest');
  });

  it('prompt kosong → tidak melempar', () => {
    expect(buildCacheableSystemPrompt('', '__M__')).toEqual({ stablePrefix: '', volatileSuffix: '' });
  });

  it('provider TAK dikenal → prefix+suffix digabung kembali (byte-identik)', () => {
    const parts = { stablePrefix: 'PREFIX', volatileSuffix: 'SUFFIX' };
    const msgs = buildCachedMessages(parts, 'https://api.openai.com/v1', [{ role: 'user', content: 'hi' }]);
    expect(msgs[0]).toEqual({ role: 'system', content: 'PREFIXSUFFIX' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('provider Anthropic → prefix ber-anotasi cache_control', () => {
    const parts = { stablePrefix: 'PREFIX', volatileSuffix: 'SUFFIX' };
    const msgs = buildCachedMessages(parts, 'https://api.anthropic.com/v1');
    const sys = msgs[0] as any;
    expect(Array.isArray(sys.content)).toBe(true);
    expect(sys.content[0].text).toBe('PREFIX');
    expect(sys.content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(sys.content[1].text).toBe('SUFFIX');
  });

  it('tanpa prefix stabil → satu system message biasa tanpa anotasi', () => {
    const msgs = buildCachedMessages({ stablePrefix: '', volatileSuffix: 'ONLY' }, 'https://api.anthropic.com/v1');
    expect(msgs[0]).toEqual({ role: 'system', content: 'ONLY' });
  });

  it('INVARIAN: prefix prompt persona byte-stabil antar isFollowUp', () => {
    const s = baseSession();
    const p1 = PersonaPromptBuilder.buildSystemPrompt(s, false);
    const p2 = PersonaPromptBuilder.buildSystemPrompt(s, true);

    const parts1 = buildCacheableSystemPrompt(p1, PERSONA_STABLE_PREFIX_MARKER);
    const parts2 = buildCacheableSystemPrompt(p2, PERSONA_STABLE_PREFIX_MARKER);

    expect(parts1.stablePrefix.length).toBeGreaterThan(20000);
    expect(parts1.stablePrefix).toBe(parts2.stablePrefix);
    // Perbedaan isFollowUp HARUS berada di suffix volatil, bukan prefix.
    expect(parts1.volatileSuffix).not.toBe(parts2.volatileSuffix);
  });

  it('REGRESI KRITIS: pesan tool/assistant diteruskan utuh tanpa pemangkasan field', () => {
    const toolMsg = { role: 'tool', tool_call_id: 'call_1', name: 'get_catalog_and_price', content: '{"ok":true}' };
    const asstMsg = { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', function: { name: 'get_catalog_and_price' } }] };
    const msgs = buildCachedMessages({ stablePrefix: 'P', volatileSuffix: 'S' }, 'https://api.openai.com/v1', [asstMsg, toolMsg]);
    expect(msgs[1]).toBe(asstMsg);
    expect(msgs[2]).toBe(toolMsg);
    expect((msgs[2] as any).tool_call_id).toBe('call_1');
  });

  it('INVARIAN: prefix stabil tidak mengandung elemen dinamis sesi', () => {
    const s1 = baseSession();
    const s2: CustomerGoalSession = { genderGreeting: 'Bapak', children: [{ ageMonths: 5, symptoms: [] }] };
    const p1 = buildCacheableSystemPrompt(PersonaPromptBuilder.buildSystemPrompt(s1, true), PERSONA_STABLE_PREFIX_MARKER);
    const p2 = buildCacheableSystemPrompt(PersonaPromptBuilder.buildSystemPrompt(s2, true), PERSONA_STABLE_PREFIX_MARKER);
    expect(p1.stablePrefix).toBe(p2.stablePrefix);
  });
});
