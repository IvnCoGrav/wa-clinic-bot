import { describe, it, expect } from 'vitest';
import {
  evaluateDomainGate,
  evaluateMedicalGate,
  SILENT_ESCALATE_REASONS,
  silentEscalateState,
} from '../../src/state-machine/conversation-gates';
import { ConversationState } from '@prisma/client';

/**
 * PLAN 8 FASE 3 — otoritas tunggal gerbang (snapshot perilaku lama).
 * Setiap kasus mereplikasi verdict kode sebelum ekstraksi.
 */

describe('FASE 3 — conversation gates', () => {
  it('domain: tanpa intent → continue', () => {
    expect(evaluateDomainGate([])).toEqual({ action: 'continue' });
    expect(evaluateDomainGate(undefined)).toEqual({ action: 'continue' });
    expect(evaluateDomainGate(['chitchat'])).toEqual({ action: 'continue' });
  });

  it('domain: out_of_domain → silent_escalate dengan reason tercatat', () => {
    expect(evaluateDomainGate(['chitchat', 'out_of_domain'])).toEqual({
      action: 'silent_escalate',
      reason: 'out_of_domain',
      note: SILENT_ESCALATE_REASONS.out_of_domain.note,
    });
  });

  it('domain: complaint & human_agent → reason masing-masing', () => {
    expect(evaluateDomainGate(['complaint']).reason).toBe('complaint');
    expect(evaluateDomainGate(['human_agent']).reason).toBe('manual_request');
  });

  it('domain: intent tak dikenal → continue (tidak eskalasi buta)', () => {
    expect(evaluateDomainGate(['ask_price', 'provide_location'])).toEqual({ action: 'continue' });
  });

  it('medis: bukan medis → continue', () => {
    expect(evaluateMedicalGate({ isMedical: false, allowFaqExemption: false })).toEqual({ action: 'continue' });
  });

  it('medis: exemption FAQ approved untuk customer baru → continue', () => {
    expect(
      evaluateMedicalGate({
        isMedical: true, severity: 'MEDIUM', allowFaqExemption: true,
        faqCategory: 'medical', faqStatus: 'APPROVED',
      })
    ).toEqual({ action: 'continue' });
  });

  it('medis: exemption tapi FAQ bukan medis → eskalasi', () => {
    const v = evaluateMedicalGate({
      isMedical: true, severity: 'HIGH', allowFaqExemption: true,
      faqCategory: 'general', faqStatus: 'APPROVED',
    });
    expect(v.action).toBe('silent_escalate');
    expect(v.reason).toBe('medical_concern');
  });

  it('medis: tanpa exemption (legacy/prior) → eskalasi walau FAQ cocok', () => {
    const v = evaluateMedicalGate({
      isMedical: true, severity: 'HIGH', allowFaqExemption: false,
      faqCategory: 'medical', faqStatus: 'APPROVED',
    });
    expect(v.action).toBe('silent_escalate');
  });

  it('medis: tanpa FAQ match → eskalasi dengan severity di note', () => {
    const v = evaluateMedicalGate({ isMedical: true, severity: 'HIGH', allowFaqExemption: true });
    expect(v.action).toBe('silent_escalate');
    expect(v.note).toContain('HIGH');
  });

  it('silentEscalateState: kontrak state tunggal', () => {
    expect(silentEscalateState()).toEqual({
      is_human_handling: true,
      current_state: ConversationState.HUMAN_HANDLING,
    });
  });
});
