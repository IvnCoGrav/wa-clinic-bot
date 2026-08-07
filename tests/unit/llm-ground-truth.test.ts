import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerService, customerService } from '../../src/services/customer.service';
import { LLMResponseGenerator } from '../../src/integrations/llm/generator';
import { prisma } from '../../src/db/client';
import axios from 'axios';

vi.mock('axios');

describe('Customer Ground Truth Injection & Service', () => {
  const tenantId = 'tenant-test';
  const customerId = 'cust_12345';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_API_KEY = 'sk-test-valid-key';
  });

  describe('customerService.getCustomerGroundTruth', () => {
    it('should correctly format active (pending or future confirmed) and historical (past confirmed) services, ignoring cancelled', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 hari lalu
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 hari depan

      vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({
        id: customerId,
        tenant_id: tenantId,
        name: 'Bunda Rina',
        phone: '08123456789',
        reservations: [
          {
            id: 'res_1',
            tenant_id: tenantId,
            customer_id: customerId,
            treatment_category: 'BABY_SPA',
            treatment_detail: 'Pijat Bayi Rileksasi',
            status: 'pending',
            booking_date: null,
            raw_text: null,
            google_calendar_event_id: null,
            purchase_event_sent_at: null,
            is_repeat_order: false,
            created_at: new Date(),
            updated_at: new Date(),
          },
          {
            id: 'res_2',
            tenant_id: tenantId,
            customer_id: customerId,
            treatment_category: 'BABY_SPA',
            treatment_detail: 'Pijat Bayi Flu & Batuk',
            status: 'confirmed',
            booking_date: futureDate, // Confirmed di masa depan -> Active
            raw_text: null,
            google_calendar_event_id: null,
            purchase_event_sent_at: null,
            is_repeat_order: false,
            created_at: new Date(),
            updated_at: new Date(),
          },
          {
            id: 'res_3',
            tenant_id: tenantId,
            customer_id: customerId,
            treatment_category: 'MOMS_SPA',
            treatment_detail: 'Massage Ibu Hamil',
            status: 'confirmed',
            booking_date: pastDate, // Confirmed di masa lalu -> Historical
            raw_text: null,
            google_calendar_event_id: null,
            purchase_event_sent_at: null,
            is_repeat_order: false,
            created_at: new Date(),
            updated_at: new Date(),
          },
          {
            id: 'res_4',
            tenant_id: tenantId,
            customer_id: customerId,
            treatment_category: 'BABY_SPA',
            treatment_detail: 'Pijat Bayi Mandi Mandi',
            status: 'cancelled', // Cancelled -> Diabaikan
            booking_date: pastDate,
            raw_text: null,
            google_calendar_event_id: null,
            purchase_event_sent_at: null,
            is_repeat_order: false,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      } as any);

      const gt = await customerService.getCustomerGroundTruth(customerId, tenantId);

      expect(gt).not.toBeNull();
      expect(gt?.name).toBe('Bunda Rina');
      expect(gt?.activeServices).toEqual(['Pijat Bayi Rileksasi', 'Pijat Bayi Flu & Batuk']);
      expect(gt?.historicalServices).toEqual(['Massage Ibu Hamil']);
    });

    it('should return empty active/historical lists when customer has no reservations', async () => {
      vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({
        id: customerId,
        tenant_id: tenantId,
        name: null,
        phone: '08123456789',
        reservations: [],
      } as any);

      const gt = await customerService.getCustomerGroundTruth(customerId, tenantId);

      expect(gt).not.toBeNull();
      expect(gt?.name).toBeNull();
      expect(gt?.activeServices).toEqual([]);
      expect(gt?.historicalServices).toEqual([]);
    });

    it('should catch errors gracefully and return null when DB query fails', async () => {
      vi.mocked(prisma.customer.findUnique).mockRejectedValueOnce(new Error('Database connection failed'));

      const gt = await customerService.getCustomerGroundTruth(customerId, tenantId);

      expect(gt).toBeNull();
    });
  });

  describe('LLMResponseGenerator System Prompt Injection', () => {
    it('should inject Ground Truth section into system prompt when LLM is executed', async () => {
      vi.mocked(prisma.customer.findUnique).mockResolvedValue({
        id: customerId,
        tenant_id: tenantId,
        name: 'Bunda Ani',
        phone: '08123456789',
        reservations: [
          {
            id: 'res_1',
            tenant_id: tenantId,
            customer_id: customerId,
            treatment_category: 'BABY_SPA',
            treatment_detail: 'Pijat Bayi Premium',
            status: 'pending',
          },
          {
            id: 'res_2',
            tenant_id: tenantId,
            customer_id: customerId,
            treatment_category: 'MOMS_SPA',
            treatment_detail: 'Pijat Nifas Tradisional',
            status: 'confirmed',
            booking_date: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        ],
      } as any);

      const mockedPost = vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reasoning: 'Customer menanyakan jadwal.',
                  answer: 'Halo Bunda Ani, jadwal Pijat Bayi Premium Anda sudah tercatat ya. 😊'
                }),
              },
            },
          ],
        },
      } as any);

      const generator = new LLMResponseGenerator();

      const response = await generator.generateFaqResponse(
        'Kapan jadwal treatment saya?',
        [],
        'conv_123',
        tenantId,
        undefined,
        customerId
      );

      expect(response).toContain('Halo Bunda Ani');
      expect(prisma.customer.findUnique).toHaveBeenCalledWith({
        where: { id: customerId },
        include: {
          reservations: {
            where: { tenant_id: tenantId },
            orderBy: { created_at: 'desc' },
          },
        },
      });
      expect(mockedPost).toHaveBeenCalledTimes(1);

      const payload = mockedPost.mock.calls[0][1] as any;
      const systemPrompt = payload.messages[0].content;

      expect(systemPrompt).toContain('[DATA CUSTOMER (GROUND TRUTH)]');
      expect(systemPrompt).toContain('- Nama: Bunda Ani');
      expect(systemPrompt).toContain('- Layanan Aktif Saat Ini: Pijat Bayi Premium');
      expect(systemPrompt).toContain('- Layanan yang Pernah Dipakai (Historis): Pijat Nifas Tradisional');
      expect(systemPrompt).toContain('HANYA gunakan data di section [DATA CUSTOMER (GROUND TRUTH)]');
      expect(systemPrompt).toContain('[KONTEKS PERCAKAPAN]');
      expect(systemPrompt).toContain('Treatment yang terakhir dibahas dalam percakapan ini:');
    });

    it('should fallback to default Ground Truth placeholders if getCustomerGroundTruth fails or returns null', async () => {
      vi.mocked(prisma.customer.findUnique).mockRejectedValue(new Error('DB Timeout'));

      const mockedPost = vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reasoning: 'Customer menanyakan layanan.',
                  answer: 'Kami menyediakan paket pijat bayi terfavorit. 😊'
                }),
              },
            },
          ],
        },
      } as any);

      const generator = new LLMResponseGenerator();

      const response = await generator.generateFaqResponse(
        'Ada paket apa saja?',
        [],
        'conv_123',
        tenantId,
        undefined,
        customerId
      );

      expect(response).toContain('Kami menyediakan paket pijat bayi');
      expect(mockedPost).toHaveBeenCalledTimes(1);

      const payload = mockedPost.mock.calls[0][1] as any;
      const systemPrompt = payload.messages[0].content;

      expect(systemPrompt).toContain('[DATA CUSTOMER (GROUND TRUTH)]');
      expect(systemPrompt).toContain('- Nama: Tidak diketahui');
      expect(systemPrompt).toContain('- Layanan Aktif Saat Ini: Tidak ada');
      expect(systemPrompt).toContain('- Layanan yang Pernah Dipakai (Historis): Tidak ada');
      expect(systemPrompt).toContain('[KONTEKS PERCAKAPAN]');
    });
  });

  describe('conversationService.updateLastDiscussedTreatment', () => {
    it('should update last_discussed_treatment field on conversation', async () => {
      const { conversationService } = await import('../../src/services/conversation.service');
      vi.mocked(prisma.conversation.update).mockResolvedValueOnce({
        id: 'conv_test_1',
        tenant_id: tenantId,
        customer_id: customerId,
        current_state: 'INITIAL',
        last_discussed_treatment: 'Pijat Bayi Rileksasi',
        last_discussed_treatment_at: new Date(),
      } as any);

      const updated = await conversationService.updateLastDiscussedTreatment('conv_test_1', tenantId, 'Pijat Bayi Rileksasi');
      expect(updated).not.toBeNull();
      expect(updated.last_discussed_treatment).toBe('Pijat Bayi Rileksasi');
    });
  });
});
