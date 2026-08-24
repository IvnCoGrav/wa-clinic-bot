import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selfLearningService } from '../../src/services/self-learning.service';
import { prisma } from '../../src/db/client';
import { knowledgeBaseService } from '../../src/services/knowledge.service';

vi.mock('../../src/db/client', () => ({
  prisma: {
    message: {
      findFirst: vi.fn(),
    },
    generalFaqStaging: {
      create: vi.fn(),
    },
    medicalFaqStaging: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/knowledge.service', () => ({
  knowledgeBaseService: {
    checkDuplicateFaq: vi.fn(),
  },
}));

vi.mock('../../src/services/legacy-harvesting.service', () => ({
  LegacyHarvestingService: {
    isTransactionOrScheduleMessage: vi.fn(() => false),
  },
}));

vi.mock('../../src/services/medical-detection.service', () => ({
  MedicalDetectionService: {
    detectMedicalConcern: vi.fn(() => ({ isMedical: false, detectedSymptoms: [] })),
  },
}));

describe('Self-Learning Service Unit Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    process.env.ENABLE_SELF_LEARNING = 'true';
    process.env.LLM_API_KEY = 'mock'; // paksa offline fallback (tanpa LLM)
    vi.mocked(knowledgeBaseService.checkDuplicateFaq).mockResolvedValue({
      isDuplicate: false,
      similarity: 0,
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should debounce multiple admin replies and aggregate them into a single staging entry', async () => {
    const customerId = 'cust_123';
    const conversationId = 'conv_123';
    const tenantId = 'default-tenant';

    const findFirstSpy = vi.spyOn(prisma.message, 'findFirst').mockResolvedValue({
      id: 'msg_1',
      tenant_id: tenantId,
      conversation_id: conversationId,
      direction: 'INBOUND',
      content: 'Berapa harga pijat bayi?',
      wa_message_id: 'wa_1',
      payload_raw: null,
      created_at: new Date(),
    } as any);

    const stagingCreateSpy = vi.spyOn(prisma.generalFaqStaging, 'create').mockResolvedValue({} as any);

    // Send first part of admin reply
    await selfLearningService.processAdminReply(customerId, conversationId, 'Pijat bayi harganya 60rb bund.', tenantId);

    // Fast-forward 5 seconds (not enough to trigger finalizeLearning)
    await vi.advanceTimersByTimeAsync(5000);
    expect(findFirstSpy).not.toHaveBeenCalled();

    // Send second part of admin reply
    await selfLearningService.processAdminReply(customerId, conversationId, 'Sudah free ongkir di bawah 5 km ya.', tenantId);

    // Fast-forward another 5 seconds (total 10s from start, but only 5s from second bubble, so timer reset)
    await vi.advanceTimersByTimeAsync(5000);
    expect(findFirstSpy).not.toHaveBeenCalled();

    // Fast-forward remaining 5 seconds of the debounced window
    await vi.advanceTimersByTimeAsync(5000);

    // Now it should have run finalizeLearning
    expect(findFirstSpy).toHaveBeenCalledWith({
      where: {
        conversation_id: conversationId,
        direction: 'INBOUND',
        tenant_id: tenantId,
      },
      orderBy: { created_at: 'desc' },
    });

    // Check that it stages the aggregated Q&A pair (general FAQ, non-medical)
    expect(stagingCreateSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: tenantId,
        conversation_id: conversationId,
        raw_question: 'Berapa harga pijat bayi?',
        raw_answer: 'Pijat bayi harganya 60rb bund.\nSudah free ongkir di bawah 5 km ya.',
        general_question: 'Berapa harga pijat bayi?',
        general_answer: 'Pijat bayi harganya 60rb bund.\nSudah free ongkir di bawah 5 km ya.',
        category: 'livechat_harvest',
        status: 'PENDING',
      }),
    });
  });

  it('should ignore learning if the admin reply contains transactional or greeting noise', async () => {
    const customerId = 'cust_123';
    const conversationId = 'conv_123';
    const tenantId = 'default-tenant';

    const findFirstSpy = vi.spyOn(prisma.message, 'findFirst').mockResolvedValue({
      id: 'msg_1',
      tenant_id: tenantId,
      conversation_id: conversationId,
      direction: 'INBOUND',
      content: 'Halo bidan yusi',
      wa_message_id: 'wa_1',
      payload_raw: null,
      created_at: new Date(),
    } as any);

    const stagingCreateSpy = vi.spyOn(prisma.generalFaqStaging, 'create').mockResolvedValue({} as any);
    const medicalStagingSpy = vi.spyOn(prisma.medicalFaqStaging, 'create').mockResolvedValue({} as any);

    // Admin sends greeting/transactional reply
    await selfLearningService.processAdminReply(customerId, conversationId, 'Halo bunda, iya sebentar saya otw ya.', tenantId);

    await vi.advanceTimersByTimeAsync(11000);

    expect(findFirstSpy).toHaveBeenCalled();
    // Should NOT stage anything because the offline noise filter rejects "halo"/"otw"
    expect(stagingCreateSpy).not.toHaveBeenCalled();
    expect(medicalStagingSpy).not.toHaveBeenCalled();
  });
});
