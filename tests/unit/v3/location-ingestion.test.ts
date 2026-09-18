import { describe, it, expect } from 'vitest';
import { evaluateToolMasking } from '../../../src/v3/tools/tool-masker';
import { ToolExecutionPipeline } from '../../../src/v3/agent/pipeline/tool-pipeline';

/**
 * Plan regresi Fase 6 — ingestion lokasi deterministik (anti-amnesia).
 * Jawaban domisili customer ("Di tenggilis kak" / "Kami di Kutisari Indah")
 * WAJIB membuka calculate_delivery di masker (bukan prioritas prose prompt),
 * dan hasil tool WAJIB tersimpan ke session.location di turn yang sama.
 * Tidak ada perubahan prompt — perilaku dikunci via gerbang kode + test.
 */
describe('location ingestion deterministik (Fase 6)', () => {
  const emptySession: any = { cartItems: [], genderGreeting: 'Bunda' };

  it('masker MEMBUKA calculate_delivery untuk jawaban domisili "Di tenggilis kak"', () => {
    const ev = evaluateToolMasking(undefined, emptySession, 'Di tenggilis kak', [
      { role: 'assistant', content: 'Kalau boleh tahu rumah Bunda di daerah mana ya?' },
      { role: 'user', content: 'Di tenggilis kak' },
    ]);
    expect(ev.maskedToolNames).not.toContain('calculate_delivery');
  });

  it('masker MENUTUP calculate_delivery bila tanpa entitas lokasi baru ("biayanya brp")', () => {
    const ev = evaluateToolMasking(undefined, emptySession, 'biayanya brp', [
      { role: 'user', content: 'biayanya brp' },
    ]);
    expect(ev.maskedToolNames).toContain('calculate_delivery');
  });

  it('hasil calculate_delivery tersimpan ke session.location (anti-amnesia turn berikut)', async () => {
    const input: any = {
      toolCalls: [
        {
          id: 'call-loc-1',
          function: {
            name: 'calculate_delivery',
            arguments: JSON.stringify({ locationText: 'Kutisari Indah' }),
          },
        },
      ],
      assistantMessage: { role: 'assistant', content: null, tool_calls: [] },
      session: { cartItems: [], genderGreeting: 'Bunda' },
      tenantId: 'default-tenant',
      customerId: 'cust-loc-1',
      phone: '6281',
      conversationId: 'conv-loc-1',
      chatId: '6281@c.us',
      conversationHistory: [{ role: 'user', content: 'Kami di Kutisari Indah' }],
      cleanIncomingText: 'Kami di Kutisari Indah',
      grounding: {
        phase: 'GENERAL',
        phaseDirective: '',
        hasScheduleSignal: false,
        hasFallInjury: false,
        hasVaccineSignal: false,
        timeHint: null,
        retrievedChunks: [],
        emptyKnowledgeResult: false,
        bundleCompositionNote: null,
        preGroundingBlock: '',
      },
      seenChunkKeys: new Set<string>(),
      retrievedChunks: [],
      messages: [{ role: 'system', content: 'sys' }] as any[],
    };
    const out = await ToolExecutionPipeline.execute(input);
    expect(out.executedTools.length).toBe(1);
    expect(out.executedTools[0].result.success).toBe(true);
    const loc = (out.updatedSession as any)?.location;
    expect(loc).toBeDefined();
    expect(`${loc?.kelurahan || ''} ${loc?.kecamatan || ''} ${loc?.rawText || ''}`).toMatch(/kutisari/i);
  });
});
