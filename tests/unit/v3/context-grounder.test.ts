import { describe, it, expect } from 'vitest';
import {
  ContextGrounder,
  FastResponseGate,
  isShortAcknowledgement,
  resolvePostReservationAck,
} from '../../../src/v3/agent/pipeline/context-grounder';

/**
 * Stage 1 isolation: ekstraksi sinyal, derivasi fase, dan fast gate —
 * 100% deterministik tanpa LLM.
 */
describe('ContextGrounder — sinyal & fase (tanpa LLM)', () => {
  it('hasScheduleSignal: "3 minggu" (usia) BUKAN jadwal; "hari sabtu" YA', () => {
    expect(ContextGrounder.hasScheduleSignal('usia bayi 3 minggu bisa pijat?')).toBe(false);
    expect(ContextGrounder.hasScheduleSignal('hari sabtu bisa kak?')).toBe(true);
    expect(ContextGrounder.hasScheduleSignal('batuknya kambuh sekarang')).toBe(false);
    expect(ContextGrounder.hasScheduleSignal('kalau sekarang apakah bisa')).toBe(true);
  });

  it('extractTimeHint: token pertama menang; "3 minggu" dilewati', () => {
    expect(ContextGrounder.extractTimeHint('bisa besok pagi?')).toBe('besok');
    expect(ContextGrounder.extractTimeHint('bayi 3 minggu')).toBeNull();
    expect(ContextGrounder.extractTimeHint('mau hari ini')).toBe('hari ini');
  });

  it('hasVaccineSignal: "suntik KB" dewasa TIDAK memicu; "habis imunisasi" YA', () => {
    expect(ContextGrounder.hasVaccineSignal('suntik KB di klinik bisa?')).toBe(false);
    expect(ContextGrounder.hasVaccineSignal('anak habis imunisasi boleh pijat?')).toBe(true);
  });

  it('hasFallInjurySignal: "bentur" polos TANPA konteks bayi TIDAK memicu', () => {
    expect(ContextGrounder.hasFallInjurySignal('lengan saya bentur pintu')).toBe(false);
    expect(ContextGrounder.hasFallInjurySignal('bayi jatuh dari kasur')).toBe(true);
    expect(ContextGrounder.hasFallInjurySignal('anak kebentur tembok')).toBe(true);
  });

  it('deriveConversationPhase: prioritas SCHEDULING > TREATMENT > ONGKIR > LOCATION > GREETING', () => {
    expect(ContextGrounder.deriveConversationPhase({} as any, false)).toBe('GREETING');
    expect(ContextGrounder.deriveConversationPhase({} as any, true)).toBe('GENERAL');
    expect(ContextGrounder.deriveConversationPhase({ location: { kelurahan: 'X' } } as any, true)).toBe('LOCATION_KNOWN');
    expect(ContextGrounder.deriveConversationPhase({ selectedTreatment: 'Y' } as any, true)).toBe('TREATMENT_DISCUSSED');
  });

  it('isSubstantiveForPreGrounding: sapaan murni false; keluhan true', () => {
    expect(ContextGrounder.isSubstantiveForPreGrounding('halo kak')).toBe(false);
    expect(ContextGrounder.isSubstantiveForPreGrounding('anak batuk pilek plus kembung')).toBe(true);
  });

  it('ground("halo"): tanpa RAG, preGroundingBlock kosong, fase GREETING', async () => {
    const retrievedChunks: any[] = [];
    const out = await ContextGrounder.ground({
      incomingText: 'halo',
      cleanIncomingText: 'halo',
      session: {} as any,
      tenantId: 'default-tenant',
      phone: '6281',
      conversationId: 'conv-g',
      isFollowUp: false,
      seenChunkKeys: new Set<string>(),
      retrievedChunks,
    });
    expect(out.phase).toBe('GREETING');
    expect(out.preGroundingBlock).toBe('');
    expect(out.bundleCompositionNote).toBeNull();
  });

  it('FastResponseGate: bukan sapaan & bukan ack → tidak handled', async () => {
    const r = await FastResponseGate.check({
      tenantId: 'default-tenant',
      conversationId: 'conv-g2',
      phone: '6281',
      incomingText: 'pijat bayi berapa kak?',
      cleanIncomingText: 'pijat bayi berapa kak?',
      isFollowUp: true,
      session: {} as any,
      currentSystemPrompt: 'sys',
      fewShotExemplars: [],
    });
    expect(r.handled).toBe(false);
  });

  it('isShortAcknowledgement + resolvePostReservationAck (pure)', () => {
    expect(isShortAcknowledgement('oke kak')).toBe(true);
    expect(isShortAcknowledgement('bayar pake apa?')).toBe(false);
    expect(resolvePostReservationAck({} as any, 'oke kak')).toBeNull();
    expect(
      resolvePostReservationAck(
        { booking: { reservationId: 'r1', needsStaffVerification: true } } as any,
        'siap'
      )
    ).toBe('closing');
  });
});
