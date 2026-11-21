import { describe, it, expect } from 'vitest';
import { ContextGrounder } from '../../src/v3/agent/pipeline/context-grounder';
import type { CustomerGoalSession } from '../../src/types/session';

describe('V3 Quoted Message Grounding (Tugas 4.2 & Tugas 4.3)', () => {
  const mockSession: CustomerGoalSession = {
    customerPhone: '6281200000001',
    conversationId: 'conv_quoted_test',
    currentGoal: 'CONSULTATION',
    cartItems: [],
    collectedData: {},
    historySummary: '',
    updatedAt: new Date().toISOString(),
  } as any;

  it('1. buildContextSummary menyematkan blok [PESAN YANG DIBALAS CUSTOMER] saat quotedContext ada', () => {
    const quoted = {
      content: 'Paket 2: Pijat Bayi + Tindik Medis Rp 225.000',
      direction: 'OUTBOUND' as const,
      sender_type: 'ADMIN' as const,
    };

    const summary = ContextGrounder.buildContextSummary(
      mockSession,
      'Mau yang ini ya kak',
      [],
      quoted
    );

    expect(summary).toContain('[PESAN YANG DIBALAS CUSTOMER]: "Paket 2: Pijat Bayi + Tindik Medis Rp 225.000"');
    expect(summary).toContain('(Respon dan pilihan customer di bawah ini merujuk langsung pada pesan yang dikutip tersebut.)');
  });

  it('2. Cuplikan quote >140 karakter dipotong menjadi 137 karakter + ...', () => {
    const longText = 'A'.repeat(200);
    const quoted = {
      content: longText,
      direction: 'OUTBOUND' as const,
    };

    const summary = ContextGrounder.buildContextSummary(
      mockSession,
      'Oke saya pilih ini',
      [],
      quoted
    );

    const expectedSnippet = 'A'.repeat(137) + '...';
    expect(summary).toContain(`[PESAN YANG DIBALAS CUSTOMER]: "${expectedSnippet}"`);
  });

  it('3. Tanpa quotedContext: output identik tanpa blok pesan rujukan (zero-regression)', () => {
    const summaryWithoutQuote = ContextGrounder.buildContextSummary(
      mockSession,
      'Berapa harga paket?',
      []
    );

    expect(summaryWithoutQuote).not.toContain('[PESAN YANG DIBALAS CUSTOMER]');
    expect(summaryWithoutQuote).not.toContain('(Respon dan pilihan customer di bawah ini');
  });

  it('4. quotedContext dengan content kosong tidak menghasilkan blok rujukan kosong', () => {
    const emptyQuoted = {
      content: '   \n\t  ',
      direction: 'OUTBOUND' as const,
    };

    const summary = ContextGrounder.buildContextSummary(
      mockSession,
      'Halo kak',
      [],
      emptyQuoted
    );

    expect(summary).not.toContain('[PESAN YANG DIBALAS CUSTOMER]');
  });
});
