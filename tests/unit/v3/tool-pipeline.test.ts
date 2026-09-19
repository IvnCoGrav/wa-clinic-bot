import { describe, it, expect } from 'vitest';
import { ToolExecutionPipeline } from '../../../src/v3/agent/pipeline/tool-pipeline';

/**
 * Stage 2-3 isolation: eksekusi tool + reduksi session tanpa LLM.
 * Tool get_catalog_and_price berjalan offline via katalog in-memory.
 */
describe('ToolExecutionPipeline — eksekusi & state reducer (tanpa LLM)', () => {
  const baseInput = (overrides: any = {}) => ({
    toolCalls: [
      {
        id: 'call-1',
        function: {
          name: 'get_catalog_and_price',
          arguments: JSON.stringify({ specificTreatmentName: 'Pijat Bayi Ceria', inquirePrice: true }),
        },
      },
    ],
    assistantMessage: { role: 'assistant', content: null, tool_calls: [] },
    session: { cartItems: [] } as any,
    tenantId: 'default-tenant',
    customerId: 'cust-1',
    phone: '6281',
    conversationId: 'conv-tp-1',
    chatId: '6281@c.us',
    conversationHistory: [],
    cleanIncomingText: 'pijat bayi ceria harganya berapa?',
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
    retrievedChunks: [] as any[],
    messages: [{ role: 'system', content: 'sys' }] as any[],
    ...overrides,
  });

  it('mengeksekusi get_catalog_and_price + push pesan tool + observability katalog', async () => {
    const input = baseInput();
    const out = await ToolExecutionPipeline.execute(input);
    expect(out.executedTools.length).toBe(1);
    expect(out.executedTools[0].name).toBe('get_catalog_and_price');
    expect(out.executedTools[0].result.success).toBe(true);
    expect(out.isEscalated).toBe(false);
    expect(out.inquirePriceSignal).toBe(true);
    // messages: system + assistant + tool
    expect(input.messages.length).toBe(3);
    expect(input.messages[2].role).toBe('tool');
    // katalog terdaftar di observability chunks
    expect(input.retrievedChunks.some((c: any) => String(c.id).startsWith('catalog-'))).toBe(true);
  });

  it('escalate_to_human → isEscalated tanpa balasan lanjutan', async () => {
    const input = baseInput({
      toolCalls: [
        {
          id: 'call-2',
          function: {
            name: 'escalate_to_human',
            arguments: JSON.stringify({ reason: 'test', severity: 'CUSTOMER_REQUEST' }),
          },
        },
      ],
    });
    const out = await ToolExecutionPipeline.execute(input);
    expect(out.isEscalated).toBe(true);
    expect(out.executedTools[0].name).toBe('escalate_to_human');
  });

  it('argumen tak valid → result error tanpa throw', async () => {
    const input = baseInput({
      toolCalls: [
        { id: 'call-3', function: { name: 'save_reservation', arguments: JSON.stringify({}) } },
      ],
    });
    const out = await ToolExecutionPipeline.execute(input);
    expect(out.executedTools[0].result.error).toBeDefined();
    expect(out.isEscalated).toBe(false);
  });

  it('T0.4: setelah save_reservation gagal (DB offline), tool berikutnya tetap dieksekusi', async () => {
    const input = baseInput({
      toolCalls: [
        { id: 'call-4a', function: { name: 'save_reservation', arguments: JSON.stringify({ treatmentName: 'Pijat Bayi Ceria', bookingDate: '2026-09-15T10:00:00' }) } },
        { id: 'call-4b', function: { name: 'get_catalog_and_price', arguments: JSON.stringify({ specificTreatmentName: 'Pijat Bayi Ceria' }) } },
      ],
    });
    const out = await ToolExecutionPipeline.execute(input);
    // save_reservation gagal (DB offline) → reservationCommitted tetap false → tool kedua jalan
    expect(out.executedTools.length).toBe(2);
    expect(out.executedTools[0].name).toBe('save_reservation');
    expect(out.executedTools[0].result.success).toBeFalsy();
    expect(out.executedTools[1].name).toBe('get_catalog_and_price');
    expect(out.executedTools[1].result.success).toBe(true);
  });

  // Kontrak 779408: ongkirStatus QUOTED bila nominal benar-benar diekspos —
  // customer menanya biaya ATAU lokasi presisi terverifikasi. Area luas
  // (imprecise) tetap UNQUOTED.
  it('calculate_delivery area LUAS (imprecise, tanpa tanya biaya) → ongkirStatus tetap UNQUOTED', async () => {
    const input = baseInput({
      cleanIncomingText: 'rumah saya di Menganti Gresik',
      toolCalls: [
        {
          id: 'call-5',
          function: {
            name: 'calculate_delivery',
            arguments: JSON.stringify({ locationText: 'Menganti Gresik' }),
          },
        },
      ],
    });
    const out = await ToolExecutionPipeline.execute(input);
    const delivery = out.executedTools.find((t: any) => t.name === 'calculate_delivery')!;
    expect(delivery.result.success).toBeFalsy();
    expect(out.updatedSession.ongkirStatus).not.toBe('QUOTED');
  });

  it('calculate_delivery lokasi PRESISI tanpa tanya biaya → ongkirStatus QUOTED (kontrak 779408)', async () => {
    const input = baseInput({
      cleanIncomingText: 'rumah saya di Kebraon Karangpilang',
      toolCalls: [
        {
          id: 'call-5b',
          function: {
            name: 'calculate_delivery',
            arguments: JSON.stringify({ locationText: 'Kebraon Karangpilang' }),
          },
        },
      ],
    });
    const out = await ToolExecutionPipeline.execute(input);
    const delivery = out.executedTools.find((t: any) => t.name === 'calculate_delivery')!;
    expect(delivery.result.success).toBe(true);
    expect(out.updatedSession.ongkirStatus).toBe('QUOTED');
  });

  it('calculate_delivery mode transaksional (asksDeliveryFee true) → ongkirStatus QUOTED', async () => {
    const input = baseInput({
      cleanIncomingText: 'kalau ke Kebraon Karangpilang ongkirnya berapa kak?',
      toolCalls: [
        {
          id: 'call-6',
          function: {
            name: 'calculate_delivery',
            arguments: JSON.stringify({ locationText: 'Kebraon Karangpilang', asksDeliveryFee: true }),
          },
        },
      ],
    });
    const out = await ToolExecutionPipeline.execute(input);
    const delivery = out.executedTools.find((t: any) => t.name === 'calculate_delivery')!;
    expect(delivery.result.success).toBe(true);
    expect(out.updatedSession.ongkirStatus).toBe('QUOTED');
  });

  // RC-4 (sesi 535222): router menggabungkan kecamatan basi + kelurahan baru
  // ("Buduran Bungurasih") padahal sesi sudah mengenal "Buduran". Guard
  // deterministik harus memakai hanya entitas baru ("Bungurasih").
  it('calculate_delivery: argumen gabungan wilayah basi+baru dipangkas ke entitas baru', async () => {
    const input = baseInput({
      cleanIncomingText: 'bungurasih kak',
      session: { cartItems: [], location: { kecamatan: 'Buduran' } } as any,
      toolCalls: [
        {
          id: 'call-7',
          function: {
            name: 'calculate_delivery',
            arguments: JSON.stringify({ locationText: 'Buduran Bungurasih' }),
          },
        },
      ],
    });
    const out = await ToolExecutionPipeline.execute(input);
    const delivery = out.executedTools.find((t: any) => t.name === 'calculate_delivery')!;
    expect(delivery.args.locationText).toBe('Bungurasih');
    expect(out.updatedSession.location?.kelurahan).toBe('Bungurasih');
  });

  // RC-2 (keputusan user 2026-09-19): kecamatan TARGET adalah fakta geografis
  // SAH (mis. "Bungurasih" memang kelurahan Kecamatan Waru) — payload LLM
  // DILARANG menghapusnya. Yang dilarang Rule 11 hanyalah kecamatan yang BUKAN
  // wilayah target (halusinasi murni).
  it('buildLlmSafeToolPayload(calculate_delivery) MEMPERTAHANKAN kecamatan target', () => {
    const toolResult = {
      success: true,
      isPrecise: true,
      kelurahan: 'Bungurasih',
      kecamatan: 'Waru',
      kota: 'Kabupaten Sidoarjo',
      distanceKm: 5.51,
      ongkirNormal: 15000,
      ongkirPromo: 5000,
      suggestedTemplateReply: 'Area Bungurasih masuk dalam area jangkauan...',
      message: 'Area Bungurasih masuk dalam area jangkauan layanan homecare Bidan kami (5.51 km).',
    };
    const payload: any = ToolExecutionPipeline.buildLlmSafeToolPayload('calculate_delivery', toolResult);
    expect(payload.kecamatan).toBe('Waru');
    expect(payload.kelurahan).toBe('Bungurasih');
    // Template prosa tetap dicabut (anti parrot-effect) — hanya data mentah yang lolos.
    expect(payload.suggestedTemplateReply).toBeUndefined();
  });
});
