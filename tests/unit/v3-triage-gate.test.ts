import { describe, it, expect } from 'vitest';
import {
  evaluateTriageGate,
  detectPhysicalTraumaSignal,
  detectHighSeverityEmergency,
  evaluateScreeningAnswer,
  detectMaternalStageAmbiguity,
} from '../../src/v3/agent/pipeline/medical-signal-detector';
import { CustomerGoalSession } from '../../src/v3/domain/types';

describe('Fase 5 — Track 2D: Triage Gate Deterministik (4 Lapis Multi-Parafrase)', () => {
  describe('Lapis 1 — Red Flag Trauma & Kegawatdaruratan Medis (ESCALATE)', () => {
    const traumaCases = [
      'anak saya jatuh dari tempat tidur kepalanya benjol',
      'adek tadi jatuh dari kasur nangis terus',
      'si kecil kebentur lantai keras sampai muntah',
      'bayi jatuh dari stroller kepalanya terbentur',
      'tadi anak jatuh ada luka memar di kepala boleh dipijat ga',
      'bayiku jatuh dari gendongan',
      'bayi kejedot lemari dahi membiru',
    ];

    traumaCases.forEach((text, i) => {
      it(`Trauma ${i + 1}: "${text}" memicu deteksi trauma fisik`, () => {
        expect(detectPhysicalTraumaSignal(text)).toBe(true);
        const triage = evaluateTriageGate({ incomingText: text });
        expect(triage.action).toBe('ESCALATE');
        expect(triage.policyTopic).toBe('triage_escalate');
      });
    });

    const emergencyCases = [
      'anak saya kejang step demam 40 derajat',
      'si kecil sesak napas dada tertarik ke dalam',
      'bayi lemas tidak sadarkan diri bibir biru',
    ];

    emergencyCases.forEach((text, i) => {
      it(`Emergency ${i + 1}: "${text}" memicu eskalasi darurat`, () => {
        const triage = evaluateTriageGate({ incomingText: text });
        expect(triage.action).toBe('ESCALATE');
        expect(triage.policyTopic).toBe('triage_escalate');
      });
    });
  });

  describe('Lapis 2 — Skrining Pasca Vaksinasi (SCREEN)', () => {
    it('baru vaksin tadi pagi -> SCREEN', () => {
      const triage = evaluateTriageGate({
        incomingText: 'anak saya baru imunisasi tadi pagi boleh pijat?',
      });
      expect(triage.action).toBe('SCREEN');
      expect(triage.policyTopic).toBe('triage_screen');
    });

    it('ade abis vaksin dpt kemarin -> SCREEN', () => {
      const triage = evaluateTriageGate({
        incomingText: 'ade abis vaksin dpt kemarin sore',
      });
      expect(triage.action).toBe('SCREEN');
      expect(triage.policyTopic).toBe('triage_screen');
    });

    it('vaksin sudah 4 hari yang lalu dan tidak demam -> SAFE', () => {
      const triage = evaluateTriageGate({
        incomingText: 'si kecil abis imunisasi campak 4 hari lalu sudah tidak demam',
      });
      expect(triage.action).toBe('SAFE');
    });
  });

  describe('Lapis 3 — Evaluasi Jawaban Skrining Lanjutan (Turn Berikutnya)', () => {
    const sessionWaiting: CustomerGoalSession = {
      genderGreeting: 'Bunda',
      awaitingScreeningAnswer: true,
      triageStatus: 'SCREEN',
    };

    it('jawaban konfirmasi jeda 3 hari & sehat -> SAFE dan clearedScreening', () => {
      const triage = evaluateTriageGate({
        incomingText: 'sudah 3 hari yang lalu kok bun, anaknya udah sehat gak demam',
        session: sessionWaiting,
      });
      expect(triage.action).toBe('SAFE');
      expect(triage.clearedScreening).toBe(true);
    });

    it('jawaban konfirmasi belum aman ("masih agak hangat demam") -> SCREEN berlanjut', () => {
      const triage = evaluateTriageGate({
        incomingText: 'badannya masih agak anget demam bun',
        session: sessionWaiting,
      });
      expect(triage.action).toBe('SCREEN');
    });
  });

  describe('Lapis 4 — Ambiguitas Tahap Hidup Maternal (ASK_STAGE)', () => {
    const sessionUnknown: CustomerGoalSession = {
      genderGreeting: 'Bunda',
      targetAudience: 'MOMS',
      momProfile: { stage: 'UNKNOWN' },
    };

    it('"Kaki saya bengkak banget" saat stage UNKNOWN -> ASK_STAGE', () => {
      expect(detectMaternalStageAmbiguity('Kaki saya bengkak banget', sessionUnknown)).toBe(true);
      const triage = evaluateTriageGate({
        incomingText: 'Kaki saya bengkak banget',
        session: sessionUnknown,
      });
      expect(triage.action).toBe('ASK_STAGE');
      expect(triage.policyTopic).toBe('triage_ask_stage');
    });

    it('"aduh boyok linu bgt pegel2" saat stage UNKNOWN -> ASK_STAGE', () => {
      const triage = evaluateTriageGate({
        incomingText: 'aduh boyok linu bgt pegel2',
        session: sessionUnknown,
      });
      expect(triage.action).toBe('ASK_STAGE');
      expect(triage.policyTopic).toBe('triage_ask_stage');
    });

    it('keluhan batuk pilek anak -> SAFE (tidak tertahan di ASK_STAGE)', () => {
      const triage = evaluateTriageGate({
        incomingText: 'anak saya batuk pilek kembung mau ambil pulih ceria',
        session: sessionUnknown,
      });
      expect(triage.action).toBe('SAFE');
    });
  });
});
