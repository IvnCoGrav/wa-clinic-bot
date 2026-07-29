import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MedicalDetectionService } from '../../src/services/medical-detection.service';
import { ConversationService } from '../../src/services/conversation.service';
import { buildApp } from '../../src/app';

describe('Modul 5.2 — Medical Concern Detection & Escalation Unit Tests', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
  });

  it('1. False Positive Check: Non-medical messages MUST NOT trigger medical concern', () => {
    const res1 = MedicalDetectionService.detectMedicalConcern('Berapa harga paket pijat bayi home treatment?');
    expect(res1.isMedical).toBe(false);
    expect(res1.severity).toBe('NONE');

    const res2 = MedicalDetectionService.detectMedicalConcern('Apakah melayani area Surabaya Selatan?');
    expect(res2.isMedical).toBe(false);
    expect(res2.severity).toBe('NONE');
  });

  it('2. Qualitative & Quantitative Severity Detection: HIGH (IGD 119) vs MEDIUM (Bidan Waiting)', () => {
    // 2a. Qualitative HIGH severity (kejang / demam tinggi banget)
    const resHigh1 = MedicalDetectionService.detectMedicalConcern('Anak saya demam tinggi banget dan kejang step');
    expect(resHigh1.isMedical).toBe(true);
    expect(resHigh1.severity).toBe('HIGH');
    expect(resHigh1.detectedSymptoms).toContain('kejang');

    // 2b. Quantitative HIGH severity (suhu >39.5)
    const resHigh2 = MedicalDetectionService.detectMedicalConcern('Bayi saya demam suhu 39.8 di termometer');
    expect(resHigh2.isMedical).toBe(true);
    expect(resHigh2.severity).toBe('HIGH');

    // 2c. MEDIUM severity (ruam tali pusat / bintik merah)
    const resMed = MedicalDetectionService.detectMedicalConcern('Pusar bayi saya ruam tali pusat dan bintik merah');
    expect(resMed.isMedical).toBe(true);
    expect(resMed.severity).toBe('MEDIUM');
    expect(resMed.detectedSymptoms).toContain('ruam tali pusat');
  });

  it('3. NO 6-Hour Auto-Release Exemption Guard: Medical concerns MUST NOT be auto-released', () => {
    const conversationService = new ConversationService();
    const mockMedicalConv = {
      id: 'conv_med_123',
      is_human_handling: true,
      human_handling_since: new Date(Date.now() - 10 * 60 * 60 * 1000), // 10 Hours Ago (>6h)
      escalation_reason: 'medical_concern',
      previous_state: 'INITIAL',
      current_state: 'HUMAN_HANDLING',
    };

    const result = conversationService.checkAndApplyAutoRelease(mockMedicalConv, 'default-tenant');
    expect(result.released).toBe(false);
    expect(result.updatedConversation.is_human_handling).toBe(true);
    expect(result.updatedConversation.current_state).toBe('HUMAN_HANDLING');
  });

  it('4. Manual Release API: PATCH /api/admin/conversation/:id/release MUST reset human handling state', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/conversation/conv_med_123/release',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
  });

  it('5. Medical FAQ Staging Review: GET /api/admin/medical-faq-staging and PATCH review', async () => {
    // List staging
    const resList = await app.inject({
      method: 'GET',
      url: '/api/admin/medical-faq-staging',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(resList.statusCode).toBe(200);

    // Review staging
    const resReview = await app.inject({
      method: 'PATCH',
      url: '/api/admin/medical-faq-staging/stage_123/review',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: {
        status: 'APPROVED',
        generalQuestion: 'Bagaimana penanganan awal ruam tali pusat?',
        generalAnswer: 'Jaga kebersihan dan kekeringan area pusar bayi.',
        reviewedBy: 'Bidan Kenanga',
      },
    });

    expect(resReview.statusCode).toBe(200);
    const body = JSON.parse(resReview.body);
    expect(body.success).toBe(true);
  });
});
