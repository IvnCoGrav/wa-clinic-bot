import { describe, it, expect, vi } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { PatientProfileExtractor } from '../../src/v3/state/patient-extractor';
import { GuardrailPipeline } from '../../src/v3/agent/pipeline/guardrail-pipeline';
import { ToolExecutionPipeline } from '../../src/v3/agent/pipeline/tool-pipeline';
import { CustomerGoalSession } from '../../src/v3/domain/types';

describe('Fase 1 - Anti Subject Contamination & MomStage UNKNOWN (v3-subject-contamination)', () => {
  it('1. Skenario "Kaki saya bengkak banget": TIDAK mengontaminasi childProfile, set pendingSubjectClarification', async () => {
    let session: CustomerGoalSession = {
      genderGreeting: 'Bunda',
      // targetAudience kosong/ambigu
    };

    const updateSpy = vi.spyOn(GoalTracker, 'updateGoalSession').mockImplementation(async (_convId, patch) => {
      session = { ...session, ...patch };
      return session;
    });

    const input: any = {
      toolCalls: [
        {
          id: 'tc1',
          function: {
            name: 'get_catalog_and_price',
            arguments: JSON.stringify({ symptoms: ['kaki bengkak'] }),
          },
        },
      ],
      assistantMessage: {},
      session,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-123',
      chatId: 'chat-123',
      conversationHistory: [],
      cleanIncomingText: 'Kaki saya bengkak banget',
      grounding: {} as any,
      seenChunkKeys: new Set<string>(),
      retrievedChunks: [],
      messages: [],
    };

    const res = await ToolExecutionPipeline.execute(input);

    // Asersi: TIDAK menyimpan gejala ke childProfile
    expect(res.updatedSession.childProfile?.symptoms).toBeUndefined();
    // Asersi: pendingSubjectClarification AKTIF
    expect(res.updatedSession.pendingSubjectClarification).toBe(true);

    updateSpy.mockRestore();
  });

  it('2. MomStage default UNKNOWN bila tanpa penanda eksplisit hamil/nifas/relaksasi umum', () => {
    const session: CustomerGoalSession = {
      genderGreeting: 'Bunda',
      targetAudience: 'MOMS',
    };

    // Keluhan ibu tanpa penanda klinis eksplisit
    const mom = PatientProfileExtractor.syncMomProfile(session, 'Kaki saya bengkak banget');
    // Karena targetAudience MOMS + "kaki bengkak" terdeteksi, stage default UNKNOWN (bukan GENERAL)
    expect(mom?.stage).toBe('UNKNOWN');
    expect(mom?.complaints).toContain('kaki');
    expect(mom?.complaints).toContain('bengkak');

    // formatGoalSessionForPrompt tidak menampilkan Relaksasi Umum
    const promptSummary = GoalTracker.formatGoalSessionForPrompt({
      ...session,
      momProfile: mom,
    });
    expect(promptSummary).not.toContain('Relaksasi Umum');
    expect(promptSummary).not.toContain('Data Si Kecil: Keluhan: kaki');
  });

  it('3. Guardrail pipeline deterministik meng-append pertanyaan subjek bila pendingSubjectClarification aktif', async () => {
    const session: CustomerGoalSession = {
      genderGreeting: 'Bunda',
      pendingSubjectClarification: true,
    };

    const out = await GuardrailPipeline.verifyAndReprompt({
      draftReply: 'Baik Bunda, kami memiliki beberapa pilihan perawatan yang dapat membantu meredakan keluhan tersebut.',
      session,
      incomingText: 'Kaki saya bengkak banget',
      isFollowUp: true,
      executedTools: [],
      retrievedChunks: [],
      shouldSendReply: true,
      isEscalated: false,
      emptyKnowledgeResult: false,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-123',
      selectedModel: 'test-model',
      baseUrl: 'http://localhost',
      apiKey: 'test-key',
      executeChat: vi.fn(),
      addUsage: vi.fn(),
      auditUsage: vi.fn(),
      recordCall: vi.fn(),
    } as any);

    expect(out.finalReply).toContain('Boleh tahu keluhannya untuk Bunda sendiri atau untuk si kecil ya? 😊');
  });

  it('4. Tiga parafrase adversarial (slang, tanpa tanda tanya) tidak mengontaminasi anak dan mengaktifkan klarifikasi', async () => {
    const testCases = [
      { text: 'kaki ku bengkak bgt nih', symptoms: ['kaki', 'bengkak'] },
      { text: 'aduh boyok linu bgt pegel2', symptoms: ['pegel'] },
      { text: 'badanku capek semua pinggang sakit', symptoms: ['capek', 'pinggang'] },
    ];

    for (const { text, symptoms } of testCases) {
      let session: CustomerGoalSession = { genderGreeting: 'Bunda' };

      const updateSpy = vi.spyOn(GoalTracker, 'updateGoalSession').mockImplementation(async (_convId, patch) => {
        session = { ...session, ...patch };
        return session;
      });

      const input: any = {
        toolCalls: [
          {
            id: 'tc1',
            function: {
              name: 'get_catalog_and_price',
              arguments: JSON.stringify({ symptoms }),
            },
          },
        ],
        assistantMessage: {},
        session,
        tenantId: 'default-tenant',
        phone: '628123456789',
        conversationId: 'conv-adversarial',
        chatId: 'chat-123',
        conversationHistory: [],
        cleanIncomingText: text,
        grounding: {} as any,
        seenChunkKeys: new Set<string>(),
        retrievedChunks: [],
        messages: [],
      };

      const res = await ToolExecutionPipeline.execute(input);

      expect(res.updatedSession.childProfile?.symptoms, `Gagal pada: ${text}`).toBeUndefined();
      expect(res.updatedSession.pendingSubjectClarification, `Flag klarifikasi gagal pada: ${text}`).toBe(true);

      const out = await GuardrailPipeline.verifyAndReprompt({
        draftReply: 'Halo Bunda, kami siap membantu keluhan yang sedang dirasakan.',
        session: res.updatedSession,
        incomingText: text,
        isFollowUp: true,
        executedTools: [],
        retrievedChunks: [],
        shouldSendReply: true,
        isEscalated: false,
        emptyKnowledgeResult: false,
        tenantId: 'default-tenant',
        phone: '628123456789',
        conversationId: 'conv-adversarial',
        selectedModel: 'test-model',
        baseUrl: 'http://localhost',
        apiKey: 'test-key',
        executeChat: vi.fn(),
        addUsage: vi.fn(),
        auditUsage: vi.fn(),
        recordCall: vi.fn(),
      } as any);

      expect(out.finalReply).toContain('Boleh tahu keluhannya untuk Bunda sendiri atau untuk si kecil ya? 😊');

      updateSpy.mockRestore();
    }
  });

  it('5. State-gated pruning: pertanyaan subjek TIDAK diulang jika balasan model sudah menanyakannya atau targetAudience sudah jelas', async () => {
    // Kasus 5a: Model sudah menyertakan pertanyaan
    const sessionWithFlag: CustomerGoalSession = {
      genderGreeting: 'Bunda',
      pendingSubjectClarification: true,
    };

    const outAlreadyAsks = await GuardrailPipeline.verifyAndReprompt({
      draftReply: 'Boleh tahu keluhannya untuk Bunda sendiri atau untuk si kecil ya?',
      session: sessionWithFlag,
      incomingText: 'kaki bengkak',
      isFollowUp: true,
      executedTools: [],
      retrievedChunks: [],
      shouldSendReply: true,
      isEscalated: false,
      emptyKnowledgeResult: false,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-123',
      selectedModel: 'test-model',
      baseUrl: 'http://localhost',
      apiKey: 'test-key',
      executeChat: vi.fn(),
      addUsage: vi.fn(),
      auditUsage: vi.fn(),
      recordCall: vi.fn(),
    } as any);

    const matches = outAlreadyAsks.finalReply.match(/Boleh tahu keluhannya untuk Bunda sendiri atau untuk si kecil/gi);
    expect(matches?.length).toBe(1);

    // Kasus 5b: targetAudience sudah ternilai (MOMS) -> flag pendingSubjectClarification dihapus
    const sessionResolved: CustomerGoalSession = {
      genderGreeting: 'Bunda',
      targetAudience: 'MOMS',
      pendingSubjectClarification: false,
    };

    const outResolved = await GuardrailPipeline.verifyAndReprompt({
      draftReply: 'Baik Bunda, kami rekomendasikan Oksitosin Massage untuk meredakan keluhan Bunda.',
      session: sessionResolved,
      incomingText: 'buat saya sendiri bund',
      isFollowUp: true,
      executedTools: [],
      retrievedChunks: [],
      shouldSendReply: true,
      isEscalated: false,
      emptyKnowledgeResult: false,
      tenantId: 'default-tenant',
      phone: '628123456789',
      conversationId: 'conv-123',
      selectedModel: 'test-model',
      baseUrl: 'http://localhost',
      apiKey: 'test-key',
      executeChat: vi.fn(),
      addUsage: vi.fn(),
      auditUsage: vi.fn(),
      recordCall: vi.fn(),
    } as any);

    expect(outResolved.finalReply).not.toContain('Boleh tahu keluhannya untuk Bunda sendiri atau untuk si kecil ya?');
  });

  it('6. syncMomProfile membaca riwayat 6 pesan user terakhir', () => {
    const session: CustomerGoalSession = { genderGreeting: 'Bunda' };
    const history = [
      { role: 'user', content: 'Halo saya hamil 30 minggu' },
      { role: 'assistant', content: 'Halo Bunda, selamat datang!' },
      { role: 'user', content: 'kaki saya agak pegal' },
    ];

    // Panggil syncMomProfile dengan riwayat
    const mom = PatientProfileExtractor.syncMomProfile(session, 'kaki saya agak pegal', history);
    expect(mom?.gestationalWeeks).toBe(30);
    expect(mom?.stage).toBe('PREGNANT');
  });
});
