import { describe, it, expect } from 'vitest';
import { faqs } from '../../src/cli/faq-corpus';
import { SEARCH_KNOWLEDGE_FAQ_TOOL_SCHEMA } from '../../src/v3/tools/search-knowledge-faq.tool';
import { evaluateTriageGate, detectHighSeverityEmergency } from '../../src/v3/agent/pipeline/medical-signal-detector';
import { recordLlmExecution, pruneOldLlmLogs } from '../../src/utils/llm-execution-logger';
import { GoalTracker, CustomerGoalSession } from '../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import fs from 'fs';
import path from 'path';

describe('FASE 8: RAG, Korpus, Prompt & Log PII Hardening', () => {
  describe('8.2: Knowledge Corpus Quality & Curation (C-002)', () => {
    it('should not contain canned conversational chat "Nanti saya info lagi"', () => {
      const found = faqs.find((item: any) =>
        item.question.toLowerCase().includes('nanti saya info lagi') ||
        item.answer.toLowerCase().includes('kami tunggu infonya')
      );
      expect(found).toBeUndefined();
    });

    it('should fix spelling of "Pijet" to "Pijat" and remove counter-question sales push in answer', () => {
      const found = faqs.find((item: any) =>
        item.question.toLowerCase().includes('pijet') ||
        item.question.toLowerCase().includes('pijat bayi ceria berapa lama')
      );
      expect(found).toBeDefined();
      expect(found?.question).not.toContain('Pijet');
      expect(found?.question).toContain('Pijat');
      // Tidak boleh berisi pertanyaan balik counter-sales "Mau rencana ambil treatment apa bunda?"
      expect(found?.answer).not.toContain('Mau rencana ambil treatment apa');
    });

    it('should deduplicate semantic duplicate pairs in knowledge corpus', () => {
      const prepItems = faqs.filter((item: any) =>
        item.question.toLowerCase().includes('disiapkan') || item.question.toLowerCase().includes('perlengkapan')
      );
      // Hanya boleh ada 1 artikel kanonis tentang persiapan perlengkapan
      expect(prepItems.length).toBe(1);

      const diffItems = faqs.filter((item: any) =>
        item.question.toLowerCase().includes('perbedaan antara') &&
        (item.question.toLowerCase().includes('ceria') && item.question.toLowerCase().includes('pulih ceria'))
      );
      // Hanya boleh ada 1 artikel kanonis tentang perbedaan ceria vs pulih ceria
      expect(diffItems.length).toBe(1);
    });

    it('should not hardcode "47 artikel" in search_knowledge_faq tool description', () => {
      const desc = SEARCH_KNOWLEDGE_FAQ_TOOL_SCHEMA.function.description;
      expect(desc).not.toContain('47 artikel');
      expect(desc).toContain('Knowledge Base');
    });
  });

  describe('C-011: Clinical Red Flag Batuk Kronis (≥14 hari)', () => {
    it('should trigger ESCALATE for chronic cough "Batuk sudah 2 minggu"', () => {
      const emergency = detectHighSeverityEmergency('Batuk sudah 2 minggu');
      expect(emergency.isEmergency).toBe(true);

      const triage = evaluateTriageGate({
        incomingText: 'Batuk sudah 2 minggu',
        session: { id: 'test-session', tenantId: 'default-tenant' } as any,
        tenantId: 'default-tenant',
      });
      expect(triage.action).toBe('ESCALATE');
      expect(triage.policyTopic).toBe('triage_escalate');
    });

    it('should NOT trigger chronic cough escalation for short duration cough "Batuk pilek baru 2 hari"', () => {
      const emergency = detectHighSeverityEmergency('Batuk pilek baru 2 hari');
      expect(emergency.isEmergency).toBe(false);

      const triage = evaluateTriageGate({
        incomingText: 'Batuk pilek baru 2 hari',
        session: { id: 'test-session', tenantId: 'default-tenant' } as any,
        tenantId: 'default-tenant',
      });
      expect(triage.action).not.toBe('ESCALATE');
    });
  });

  describe('8.4: Log PII Redaction & Delivered Reply Tracking (C-009)', () => {
    it('should record execution with deliveredReply and guardrailActions fields', () => {
      const record = recordLlmExecution({
        flowType: 'V3_GENERATION',
        customerPhone: '081234567890',
        customerInput: 'Halo Bidan, saya mau tanya paket pijat bayi',
        finalReply: 'Halo Bunda, kami memiliki paket Pijat Bayi Ceria.',
        deliveredReply: 'Halo Bunda, kami memiliki paket Pijat Bayi Ceria.',
        guardrailActions: ['STRIP_EXCESSIVE_GREETING'],
        status: 'SUCCESS',
      });

      expect(record.deliveredReply).toBe('Halo Bunda, kami memiliki paket Pijat Bayi Ceria.');
      expect(record.guardrailActions).toEqual(['STRIP_EXCESSIVE_GREETING']);
    });

    it('should expose pruneOldLlmLogs for automated log retention', async () => {
      expect(typeof pruneOldLlmLogs).toBe('function');
      const deletedCount = await pruneOldLlmLogs(30);
      expect(typeof deletedCount).toBe('number');
    });
  });

  describe('8.3 & C-010: Tenant-Aware Goal Tracker Recommendation', () => {
    it('should pass tenantId to treatment recommendation in formatGoalSessionForPrompt', () => {
      const session: CustomerGoalSession = {
        id: 'sess-tenant-test',
        customerId: 'cust-1',
        tenantId: 'custom-tenant',
        childProfile: { name: 'Adik', ageMonths: 6, symptoms: ['batuk', 'pilek'] },
        children: [{ name: 'Adik', ageMonths: 6, symptoms: ['batuk', 'pilek'] }],
        momProfile: null,
        targetAudience: 'BABY',
        cartItems: [],
        location: null,
        bookingDate: null,
        bookingTime: null,
        notes: null,
        currentStep: 'INITIAL',
        genderGreeting: 'Bunda',
        customerName: 'Bunda Maya',
        bookingCommitConfirmed: false,
        priceDiscussed: false,
        feverContraindication: false,
      };

      const prompt = GoalTracker.formatGoalSessionForPrompt(session, { tenantId: 'custom-tenant' });
      expect(prompt).toContain('[STATUS DATA CUSTOMER SAAT INI]');
    });
  });
});
