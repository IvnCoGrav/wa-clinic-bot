import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as llmGateway from '../../src/integrations/llm/llm-gateway';
import {
  detectReceipt,
  ReceiptSchema,
  type ReceiptSignal,
} from '../../src/services/payment-receipt-vision.service';
import { prisma } from '../../src/db/client';

describe('PaymentReceiptVisionService (TDD Unit Tests)', () => {
  const dummyBuffer = Buffer.from('fake-image-bytes');
  const dummyMime = 'image/jpeg';
  const tenantId = 'test-tenant';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('ReceiptSchema validation', () => {
    it('validates a valid receipt signal object', () => {
      const valid: ReceiptSignal = {
        isPaymentReceipt: true,
        bankDestination: 'BCA',
        amount: 250000,
        transferDate: '2026-10-14',
        referenceNumber: 'REF123456',
        confidence: 0.95,
      };
      const parsed = ReceiptSchema.parse(valid);
      expect(parsed.isPaymentReceipt).toBe(true);
      expect(parsed.amount).toBe(250000);
      expect(parsed.bankDestination).toBe('BCA');
    });

    it('allows nullable fields for non-receipt signals', () => {
      const nonReceipt: ReceiptSignal = {
        isPaymentReceipt: false,
        bankDestination: null,
        amount: null,
        transferDate: null,
        referenceNumber: null,
        confidence: 0,
      };
      const parsed = ReceiptSchema.parse(nonReceipt);
      expect(parsed.isPaymentReceipt).toBe(false);
      expect(parsed.amount).toBeNull();
    });
  });

  describe('detectReceipt — Valid Receipts (BCA, Mandiri, BRImo, QRIS)', () => {
    it('successfully detects and parses a valid BCA transfer receipt', async () => {
      vi.spyOn(llmGateway, 'callChatWithRetry').mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  isPaymentReceipt: true,
                  bankDestination: 'BCA',
                  amount: 250000,
                  transferDate: '2026-10-14',
                  referenceNumber: 'BCA-TRX-88912',
                  confidence: 0.95,
                }),
              },
            },
          ],
        },
        model: 'gpt-4o-mini',
        usedFallback: false,
        baseUrl: 'https://ai.sumopod.com/v1',
      });

      const result = await detectReceipt({ tenantId, buffer: dummyBuffer, mimeType: dummyMime });

      expect(result.isPaymentReceipt).toBe(true);
      expect(result.bankDestination).toBe('BCA');
      expect(result.amount).toBe(250000);
      expect(result.transferDate).toBe('2026-10-14');
      expect(result.referenceNumber).toBe('BCA-TRX-88912');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('successfully detects and parses a Mandiri Livin receipt', async () => {
      vi.spyOn(llmGateway, 'callChatWithRetry').mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: `\`\`\`json
{
  "isPaymentReceipt": true,
  "bankDestination": "MANDIRI",
  "amount": 180000,
  "transferDate": "2026-10-13",
  "referenceNumber": "MDR-9921",
  "confidence": 0.92
}
\`\`\``,
              },
            },
          ],
        },
        model: 'gpt-4o-mini',
        usedFallback: false,
        baseUrl: 'https://ai.sumopod.com/v1',
      });

      const result = await detectReceipt({ tenantId, buffer: dummyBuffer, mimeType: dummyMime });

      expect(result.isPaymentReceipt).toBe(true);
      expect(result.bankDestination).toBe('MANDIRI');
      expect(result.amount).toBe(180000);
      expect(result.referenceNumber).toBe('MDR-9921');
    });

    it('successfully detects and parses a BRImo receipt', async () => {
      vi.spyOn(llmGateway, 'callChatWithRetry').mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  isPaymentReceipt: true,
                  bankDestination: 'BRI',
                  amount: 320000,
                  transferDate: '2026-10-14',
                  referenceNumber: 'BRI-77123',
                  confidence: 0.9,
                }),
              },
            },
          ],
        },
        model: 'gpt-4o-mini',
        usedFallback: false,
        baseUrl: 'https://ai.sumopod.com/v1',
      });

      const result = await detectReceipt({ tenantId, buffer: dummyBuffer, mimeType: dummyMime });

      expect(result.isPaymentReceipt).toBe(true);
      expect(result.bankDestination).toBe('BRI');
      expect(result.amount).toBe(320000);
      expect(result.referenceNumber).toBe('BRI-77123');
    });

    it('successfully detects and parses a QRIS payment confirmation', async () => {
      vi.spyOn(llmGateway, 'callChatWithRetry').mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  isPaymentReceipt: true,
                  bankDestination: 'QRIS',
                  amount: 150000,
                  transferDate: '2026-10-14',
                  referenceNumber: 'NMID102938475',
                  confidence: 0.98,
                }),
              },
            },
          ],
        },
        model: 'gpt-4o-mini',
        usedFallback: false,
        baseUrl: 'https://ai.sumopod.com/v1',
      });

      const result = await detectReceipt({ tenantId, buffer: dummyBuffer, mimeType: dummyMime });

      expect(result.isPaymentReceipt).toBe(true);
      expect(result.bankDestination).toBe('QRIS');
      expect(result.amount).toBe(150000);
      expect(result.referenceNumber).toBe('NMID102938475');
    });
  });

  describe('detectReceipt — Non-receipts (Baby photo, shareloc, plain text/chat)', () => {
    it('returns isPaymentReceipt: false for baby photo', async () => {
      vi.spyOn(llmGateway, 'callChatWithRetry').mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  isPaymentReceipt: false,
                  bankDestination: null,
                  amount: null,
                  transferDate: null,
                  referenceNumber: null,
                  confidence: 0.05,
                }),
              },
            },
          ],
        },
        model: 'gpt-4o-mini',
        usedFallback: false,
        baseUrl: 'https://ai.sumopod.com/v1',
      });

      const result = await detectReceipt({ tenantId, buffer: dummyBuffer, mimeType: dummyMime });

      expect(result.isPaymentReceipt).toBe(false);
      expect(result.amount).toBeNull();
      expect(result.bankDestination).toBeNull();
    });

    it('returns isPaymentReceipt: false for shareloc / map screenshot', async () => {
      vi.spyOn(llmGateway, 'callChatWithRetry').mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  isPaymentReceipt: false,
                  bankDestination: null,
                  amount: null,
                  transferDate: null,
                  referenceNumber: null,
                  confidence: 0.0,
                }),
              },
            },
          ],
        },
        model: 'gpt-4o-mini',
        usedFallback: false,
        baseUrl: 'https://ai.sumopod.com/v1',
      });

      const result = await detectReceipt({ tenantId, buffer: dummyBuffer, mimeType: dummyMime });

      expect(result.isPaymentReceipt).toBe(false);
      expect(result.referenceNumber).toBeNull();
    });

    it('returns isPaymentReceipt: false for plain text / chat screenshot', async () => {
      vi.spyOn(llmGateway, 'callChatWithRetry').mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  isPaymentReceipt: false,
                  bankDestination: null,
                  amount: null,
                  transferDate: null,
                  referenceNumber: null,
                  confidence: 0.1,
                }),
              },
            },
          ],
        },
        model: 'gpt-4o-mini',
        usedFallback: false,
        baseUrl: 'https://ai.sumopod.com/v1',
      });

      const result = await detectReceipt({ tenantId, buffer: dummyBuffer, mimeType: dummyMime });

      expect(result.isPaymentReceipt).toBe(false);
    });
  });

  describe('detectReceipt — Low Confidence, Malformed JSON & Error Handling', () => {
    it('demotes to isPaymentReceipt: false when confidence is below 0.7 threshold', async () => {
      vi.spyOn(llmGateway, 'callChatWithRetry').mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  isPaymentReceipt: true,
                  bankDestination: 'BCA',
                  amount: 100000,
                  transferDate: '2026-10-14',
                  referenceNumber: 'REF-UNCERTAIN',
                  confidence: 0.65, // < 0.70 threshold!
                }),
              },
            },
          ],
        },
        model: 'gpt-4o-mini',
        usedFallback: false,
        baseUrl: 'https://ai.sumopod.com/v1',
      });

      const result = await detectReceipt({ tenantId, buffer: dummyBuffer, mimeType: dummyMime });

      expect(result.isPaymentReceipt).toBe(false);
      expect(result.confidence).toBe(0.65);
    });

    it('handles malformed / non-JSON LLM responses gracefully without throwing (fail-closed)', async () => {
      vi.spyOn(llmGateway, 'callChatWithRetry').mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: 'Mohon maaf, saya tidak dapat membaca gambar ini sebagai struk bayar.',
              },
            },
          ],
        },
        model: 'gpt-4o-mini',
        usedFallback: false,
        baseUrl: 'https://ai.sumopod.com/v1',
      });

      const result = await detectReceipt({ tenantId, buffer: dummyBuffer, mimeType: dummyMime });

      expect(result.isPaymentReceipt).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.amount).toBeNull();
    });

    it('handles LLM network/outage error gracefully without throwing (fail-closed)', async () => {
      vi.spyOn(llmGateway, 'callChatWithRetry').mockRejectedValueOnce(
        new Error('Network timeout after 20000ms')
      );

      const result = await detectReceipt({ tenantId, buffer: dummyBuffer, mimeType: dummyMime });

      expect(result.isPaymentReceipt).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.amount).toBeNull();
    });
  });

  describe('detectReceipt — Tenant-Aware Model & Prompt Config', () => {
    it('uses custom prompt and model from Tenant.settings when configured in DB', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValueOnce({
        id: tenantId,
        settings: {
          receiptVisionModel: 'gemini-2-5-flash-lite',
          receiptVisionPrompt: 'Custom prompt for tenant',
        },
      } as any);

      const gatewaySpy = vi.spyOn(llmGateway, 'callChatWithRetry').mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  isPaymentReceipt: true,
                  bankDestination: 'BSI',
                  amount: 120000,
                  transferDate: '2026-10-14',
                  referenceNumber: 'BSI-001',
                  confidence: 0.95,
                }),
              },
            },
          ],
        },
        model: 'gemini-2-5-flash-lite',
        usedFallback: false,
        baseUrl: 'https://kenari.id/v1',
      });

      const result = await detectReceipt({ tenantId, buffer: dummyBuffer, mimeType: dummyMime });

      expect(result.isPaymentReceipt).toBe(true);
      expect(result.bankDestination).toBe('BSI');
      expect(gatewaySpy).toHaveBeenCalled();
      const callArgs = gatewaySpy.mock.calls[0][0];
      expect(callArgs.model).toBe('gemini-2-5-flash-lite');
      const messages = (callArgs.payload as any).messages;
      expect(messages[0].content).toContain('Custom prompt for tenant');
    });
  });
});
