import { describe, it, expect } from 'vitest';
import { isRecruitmentInquiry, FastResponseGate } from '../../../src/v3/agent/pipeline/context-grounder';
import { ConversationState } from '@prisma/client';

describe('Temporary Recruitment / Lowongan Kerja (Loker) Gate', () => {
  describe('isRecruitmentInquiry (Regex Matcher)', () => {
    it('mendeteksi variasi pertanyaan lowongan kerja & rekrutmen', () => {
      const positives = [
        'halo kak, ada loker?',
        'info loker bidan ada kah kak?',
        'mau tanya lowongan kerja di kala spa',
        'apakah ada lowongan pekerjaan?',
        'bisa kirim lamaran kerja disini?',
        'saya mau kirim surat lamaran',
        'info rekrutmen bidan homecare',
        'recruitment kala spa masih buka?',
        'apakah sedang open recruitment?',
        'info oprec bidan kak',
        'saya mau melamar pekerjaan sebagai bidan',
        'mau melamar kerja disini kak',
        'bisa kirim cv kesini ya kak?',
        'mau drop cv kemana ya kak?',
        'kirim resume kemana kak?',
        'lagi cari kerja kak, apakah ada posisi kosong?',
        'apakah ada job vacancy?',
        'job opening untuk perawat/bidan ada kak?',
      ];

      for (const text of positives) {
        expect(isRecruitmentInquiry(text), `Expected true for: "${text}"`).toBe(true);
      }
    });

    it('tidak memicu false positive pada pertanyaan umum klinik/pasien', () => {
      const negatives = [
        'halo bun, mau tanya pijat bayi',
        'alamat kliniknya dimana ya?',
        'lokasi saya di semolowaru sukolilo sby',
        'paket pijat laktasi harganya berapa?',
        'anak saya lagi batuk pilek',
        'anak rewel susah makan',
        'bisa panggil bidan ke rumah besok?',
        'pijat relaksasi bayi berapa menit?',
        'berapa ongkir ke waru sidoarjo?',
        'jadwal hari senin bisa?',
        'oke siap kak makasih ya',
      ];

      for (const text of negatives) {
        expect(isRecruitmentInquiry(text), `Expected false for: "${text}"`).toBe(false);
      }
    });
  });

  describe('FastResponseGate.check (Direct Escalation)', () => {
    it('mengalihkan langsung ke HUMAN_HANDLING tanpa LLM (0 token)', async () => {
      const result = await FastResponseGate.check({
        tenantId: 'default-tenant',
        conversationId: 'test-recruitment-conv',
        phone: '6281234567890',
        incomingText: 'Halo kak, apakah ada lowongan kerja untuk bidan?',
        cleanIncomingText: 'Halo kak, apakah ada lowongan kerja untuk bidan?',
        skipDbLogging: true,
        isFollowUp: false,
        session: { genderGreeting: 'Bunda' } as any,
        currentSystemPrompt: 'prompt',
        fewShotExemplars: [],
      });

      expect(result.handled).toBe(true);
      if (result.handled) {
        expect(result.output.isEscalated).toBe(true);
        expect(result.output.escalationReason).toBe('recruitment_inquiry');
        expect(result.output.nextState).toBe(ConversationState.HUMAN_HANDLING);
        expect(result.output.shouldSendReply).toBe(false); // Bot diam total (senyap)
        expect(result.output.replyText).toBe(''); // Tanpa respon teks
        expect(result.output.executedTools.length).toBe(0); // Tanpa panggil tool apapun
        expect(result.output.tokens.total).toBe(0); // 0 LLM tokens!
      }
    });
  });
});
