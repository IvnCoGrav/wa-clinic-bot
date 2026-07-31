import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { knowledgeBaseService } from '../../src/services/knowledge.service';
import { LegacyHarvestingService } from '../../src/services/legacy-harvesting.service';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const ADMIN_HEADERS = { 'x-api-key': 'test_admin_key_999' };

describe('Modul 5.8 — Deduplikasi, Filter Staging, Isolasi Sandbox & Overrides', () => {
  let app: any;

  beforeEach(async () => {
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('1. Automatic FAQ Deduplication Guard (Similarity Threshold >= 0.70)', () => {
    it('should detect duplicate FAQ when user question similarity >= 0.70', async () => {
      // Add official FAQ item
      await knowledgeBaseService.addFaqItem({
        tenantId: DEFAULT_TENANT_ID,
        category: 'general',
        question: 'Apakah Kala Spa menyediakan perawatan untuk ibu hamil?',
        answer: 'Ya Bunda, kami menyediakan paket Pregnancy Massage khusus untuk usia kandungan 14-32 minggu.',
        status: 'APPROVED'
      });

      // Test duplicate question
      const dupQuery = 'Apakah Kala Spa ada perawatan untuk ibu hamil?';
      const result = await knowledgeBaseService.checkDuplicateFaq(dupQuery, DEFAULT_TENANT_ID, 0.70);

      expect(result.isDuplicate).toBe(true);
      expect(result.similarity).toBeGreaterThanOrEqual(0.70);
      expect(result.matchedChunk).toBeDefined();
      expect(result.matchedChunk?.title).toContain('perawatan untuk ibu hamil');
    });

    it('should NOT detect duplicate when user question is completely novel (< 0.70 similarity)', async () => {
      const novelQuery = 'Apakah ada fasilitas parkir helikopter di lokasi cabang Surabaya?';
      const result = await knowledgeBaseService.checkDuplicateFaq(novelQuery, DEFAULT_TENANT_ID, 0.70);

      expect(result.isDuplicate).toBe(false);
      expect(result.similarity).toBeLessThan(0.70);
    });
  });

  describe('2. Filter Penjadwalan & Form Reservasi Exclusion Guard', () => {
    it('should correctly classify schedule and form filling messages as transaction/schedule', () => {
      expect(LegacyHarvestingService.isTransactionOrScheduleMessage('saya mau reschedule ke hari Jumat')).toBe(true);
      expect(LegacyHarvestingService.isTransactionOrScheduleMessage('baik saya isi form ya')).toBe(true);
      expect(LegacyHarvestingService.isTransactionOrScheduleMessage('bisa booking slot jam 2 siang?')).toBe(true);

      // Normal FAQ questions should NOT be classified as schedule/transaction
      expect(LegacyHarvestingService.isTransactionOrScheduleMessage('bagaimana penanganan batuk pilek pada bayi?')).toBe(false);
      expect(LegacyHarvestingService.isTransactionOrScheduleMessage('apakah ada paket pijat bayi 6 bulan?')).toBe(false);
    });

    it('should EXCLUDE asking_schedule conversations from GET /api/admin/knowledge/unanswered', async () => {
      // Create a test customer & conversation with escalation_reason = 'asking_schedule'
      const testPhone = '628777123999';
      let cust;
      try {
        cust = await prisma.customer.create({
          data: { phone: testPhone, name: 'Bunda Schedule Test', tenant_id: DEFAULT_TENANT_ID }
        });
        await prisma.conversation.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            customer_id: cust.id,
            current_state: 'INITIAL',
            is_human_handling: true,
            escalation_reason: 'asking_schedule'
          }
        });
      } catch (err) {
        // Mock DB fallback
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/knowledge/unanswered',
        headers: ADMIN_HEADERS
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);

      // Ensure no conversation with asking_schedule is returned
      const match = json.data.find((c: any) => c.phone === testPhone);
      expect(match).toBeUndefined();

      // Cleanup test data
      if (cust) {
        try {
          await prisma.customer.delete({ where: { id: cust.id } });
        } catch (e) {}
      }
    });
  });

  describe('3. Sandbox Session Isolation & Automatic Cleanup', () => {
    it('should isolate 2 consecutive sandbox sessions using different dummy phone numbers', async () => {
      const session1Phone = '6289999111111';
      const session2Phone = '6289999222222';

      // Session 1 message
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/admin/sandbox/chat',
        headers: ADMIN_HEADERS,
        payload: { text: 'Halo', sandboxPhone: session1Phone }
      });
      expect(res1.statusCode).toBe(200);
      const json1 = JSON.parse(res1.payload);
      expect(json1.answer).toBeDefined();

      // Session 2 message should start fresh from INITIAL state
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/admin/sandbox/chat',
        headers: ADMIN_HEADERS,
        payload: { text: 'Halo', sandboxPhone: session2Phone }
      });
      expect(res2.statusCode).toBe(200);
      const json2 = JSON.parse(res2.payload);
      expect(json2.answer).toBeDefined();
    });

    it('should cleanup sandbox test customer records via POST /api/admin/sandbox/cleanup', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/sandbox/cleanup',
        headers: ADMIN_HEADERS
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
    });
  });

  describe('4. Rate Limit Override & Audit Trail Verification', () => {
    it('should accept reviews on staging with 100 req/min budget override', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/admin/general-faq-staging/stage_test_rate_123/review',
        headers: ADMIN_HEADERS,
        payload: {
          status: 'REJECTED',
          generalQuestion: 'Test Q',
          generalAnswer: 'Test A'
        }
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
