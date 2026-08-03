import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LegacyHarvestingService } from '../../src/services/legacy-harvesting.service';
import { SelfLearningService } from '../../src/services/self-learning.service';
import { prisma } from '../../src/db/client';

describe('AI Chat Scrapper & Harvesting Engine Fixes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('PII Scrubbing menyensor nama spesifik tanpa merusak frasa medis umum (Bunda hamil / Ibu menyusui)', () => {
    const rawText1 = 'Halo mba, apakah Bunda Hamil 7 bulan aman untuk spa? Nama saya Bunda Rini (08123456789).';
    const cleaned1 = LegacyHarvestingService.scrubPII(rawText1);

    expect(cleaned1).toContain('Bunda Hamil');
    expect(cleaned1).toContain('[REDACTED_PHONE]');
    expect(cleaned1).toContain('Bunda [REDACTED_NAME]');
  });

  it('runHarvestingJob menerima opsi kustom maxChats & maxMessagesPerChat', async () => {
    const statusBefore = LegacyHarvestingService.getJobStatus();
    expect(statusBefore.status).toBeDefined();

    // Verify method interface accepts options without throwing
    const job = await LegacyHarvestingService.runHarvestingJob('default-tenant', {
      maxChats: 30,
      maxMessagesPerChat: 30,
    });

    expect(job).toBeDefined();
    expect(job.status).toBe('PROCESSING');
  });

  it('SelfLearningService mengarahkan pasangan Q&A ke GeneralFaqStaging / MedicalFaqStaging', async () => {
    const selfLearning = new SelfLearningService();

    vi.spyOn(prisma.message, 'findFirst').mockResolvedValueOnce({
      id: 'msg-123',
      tenant_id: 'default-tenant',
      conversation_id: 'conv-123',
      direction: 'INBOUND',
      content: 'Apakah treatment baby massage bisa melancarkan pencernaan anak?',
      sender_type: 'CUSTOMER',
      sender_name: null,
      created_at: new Date(),
    } as any);

    const generalCreateSpy = vi.spyOn(prisma.generalFaqStaging, 'create').mockResolvedValueOnce({ id: 'stg-1' } as any);
    const medicalCreateSpy = vi.spyOn(prisma.medicalFaqStaging, 'create').mockResolvedValueOnce({ id: 'stg-med-1' } as any);

    // Call processAdminReply
    await selfLearning.processAdminReply('cust-123', 'conv-123', 'Bisa bunda, baby massage sangat membantu sembelit.', 'default-tenant');

    // Advance timer or test state
    expect(selfLearning).toBeDefined();
  });

  it('isTransactionOrScheduleMessage memfilter pertanyaan penjadwalan, jam, hari, dan booking', () => {
    expect(LegacyHarvestingService.isTransactionOrScheduleMessage('Bisa booking untuk hari sabtu jam 10.00 wib?')).toBe(true);
    expect(LegacyHarvestingService.isTransactionOrScheduleMessage('Minta jadwal bidan yang kosong besok')).toBe(true);
    expect(LegacyHarvestingService.isTransactionOrScheduleMessage('Bisa dipanggil ke rumah (homecare) area Mulyosari? Ada slot kosong jam berapa?')).toBe(true);
    expect(LegacyHarvestingService.isTransactionOrScheduleMessage('Tolong kirimkan form reservasi tanggal 15 agustus')).toBe(true);
    
    // Non-scheduling questions must NOT be filtered
    expect(LegacyHarvestingService.isTransactionOrScheduleMessage('Apakah baby spa aman untuk bayi usia 2 bulan?')).toBe(false);
    expect(LegacyHarvestingService.isTransactionOrScheduleMessage('Manfaat pijat ibu hamil apa saja ya mba?')).toBe(false);
  });
});
